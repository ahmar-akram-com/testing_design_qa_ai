import { ComparisonEngine } from '../services/comparisonEngine.js';
import { DOMCaptureService } from '../services/domCaptureService.js';
import { FigmaService } from '../services/figmaService.js';
import { MappingEngine } from '../services/mappingEngine.js';
import type { UINode } from '../types';

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
const MAX_VISUAL_MATCHES = Number(process.env.MAX_VISUAL_MATCHES || (IS_SERVERLESS ? 0 : 10));
const TARGET_HTML_TIMEOUT_MS = Number(process.env.TARGET_HTML_TIMEOUT_MS || 10000);

export async function runDesignQA(body: any) {
  const { figmaUrl, pageUrl, viewport, preset, figmaPageName, figmaNodeId, figmaToken } = body;
  if (!figmaUrl || !pageUrl) throw httpError(400, 'Figma URL and Page URL are required');
  const activeFigmaToken = String(figmaToken || '').trim() || process.env.FIGMA_ACCESS_TOKEN;
  if (!activeFigmaToken) throw httpError(401, 'Figma access token is required. Add it in the dashboard Figma Access Token field or set FIGMA_ACCESS_TOKEN in .env.local.');

  const { fileId, nodeId } = parseFigmaTarget(figmaUrl, figmaNodeId);
  if (!nodeId && !figmaPageName) {
    throw httpError(400, 'This Figma file is too large for a full-file scan. Open the specific frame in Figma, copy its URL with node-id, and paste that URL here, or enter a Figma Node ID.');
  }

  const figmaService = new FigmaService(activeFigmaToken);
  const domService = new DOMCaptureService();
  const mappingEngine = new MappingEngine();
  const comparisonEngine = new ComparisonEngine({
    layoutTolerance: process.env.COMP_LAYOUT_TOLERANCE ? parseFloat(process.env.COMP_LAYOUT_TOLERANCE) : undefined,
    spacingTolerance: process.env.COMP_SPACING_TOLERANCE ? parseFloat(process.env.COMP_SPACING_TOLERANCE) : undefined,
    typographyTolerance: process.env.COMP_TYPO_TOLERANCE ? parseFloat(process.env.COMP_TYPO_TOLERANCE) : undefined,
    preset,
  });

  console.log(`[QA] Checking Figma token for file ${fileId}`);
  if (!IS_SERVERLESS) await figmaService.checkToken();
  console.log('[QA] Extracting Figma nodes');
  let figmaNodes: UINode[];
  try {
    figmaNodes = await figmaService.extractFile(fileId, { nodeId, pageName: figmaPageName });
  } catch (error) {
    if (IS_SERVERLESS && isRateLimitError(error)) {
      console.warn('[QA] Figma API rate-limited. Returning controlled rate-limit report.');
    }
    throw error;
  }
  console.log(`[QA] Figma nodes extracted: ${figmaNodes.length}`);

  if (IS_SERVERLESS) {
    return runFastServerlessQA({
      figmaNodes,
      fileId,
      pageUrl,
      mappingEngine,
      comparisonEngine,
    });
  }

  try {
    console.log(`[QA] Capturing target page: ${pageUrl}`);
    const { nodes: domNodes, screenshot: domScreenshot } = await domService.start(pageUrl, viewport, { includeScreenshot: !IS_SERVERLESS });
    console.log(`[QA] DOM roots captured: ${domNodes.length}`);
    console.log('[QA] Running direct component comparison.');

    console.log('[QA] Matching nodes');
    const matches = mappingEngine.matchNodes(figmaNodes, domNodes);
    console.log(`[QA] Matches created: ${matches.length}`);
    console.log('[QA] Comparing matched nodes');
    const results = comparisonEngine.compare(matches);

    const visualMatches = selectVisualMatches(results);
    console.log(`[QA] Generating visual assets for ${visualMatches.length} prioritized matches`);
    const nodeIds = visualMatches.map((match) => match.figmaNode.id);
    const nodeImageUrls = visualMatches.length ? await figmaService.getNodesImages(fileId, nodeIds) : {};

    for (const match of visualMatches) {
      if (!match.domNode) continue;

      try {
        const figmaImageUrl = nodeImageUrls[match.figmaNode.id];
        let figmaBase64 = '';

        if (figmaImageUrl) {
          const imageBuffer = await figmaService.getImageBuffer(figmaImageUrl);
          figmaBase64 = imageBuffer.toString('base64');
          match.figmaNodeImage = `data:image/png;base64,${figmaBase64}`;
        }

        const domNodeBase64 = await domService.captureNodeImage(match.domNode.layout);
        if (domNodeBase64) match.domNodeImage = `data:image/png;base64,${domNodeBase64}`;

        if (match.score < 100 && figmaBase64 && domNodeBase64) {
          const visualResult = await comparisonEngine.generateVisualDiffFromBase64(figmaBase64, domNodeBase64);
          if (visualResult.diffBase64) match.visualDiff = `data:image/png;base64,${visualResult.diffBase64}`;
        }
      } catch (error) {
        console.error(`Failed to generate visual data for ${match.figmaNode.name}:`, error);
      }
    }
    console.log('[QA] Report ready');

    const matchedComponents = results.filter((result) => result.domNode).length;
    const overallScore = calculateOverallScore(results);

    return {
      id: Math.random().toString(36).slice(2, 11),
      timestamp: new Date().toISOString(),
      figmaFileId: fileId,
      pageUrl,
      overallScore,
      matches: results,
      screenshot: domScreenshot,
      summary: {
        totalComponents: figmaNodes.length,
        matchedComponents,
        totalIssues: results.reduce((acc, result) => acc + result.issues.length, 0),
        passCount: results.filter((result) => result.score >= 90).length,
        failCount: results.filter((result) => result.score < 90).length,
      },
    };
  } finally {
    await domService.close();
  }
}

async function runFastServerlessQA({
  figmaNodes,
  fileId,
  pageUrl,
  mappingEngine,
  comparisonEngine,
}: {
  figmaNodes: UINode[];
  fileId: string;
  pageUrl: string;
  mappingEngine: MappingEngine;
  comparisonEngine: ComparisonEngine;
}) {
  console.log(`[QA] Running fast deployed analysis for ${pageUrl}`);
  const html = await fetchTargetHtml(pageUrl);
  const targetSnapshot = buildTargetSnapshotFromHtml(html, pageUrl);
  const matches = mappingEngine.matchNodes(figmaNodes, targetSnapshot.nodes);
  const results = comparisonEngine.compare(matches);

  const matchedComponents = results.filter((result) => result.domNode).length;
  const overallScore = calculateOverallScore(results);

  return {
    id: Math.random().toString(36).slice(2, 11),
    timestamp: new Date().toISOString(),
    figmaFileId: fileId,
    pageUrl,
    overallScore,
    matches: results.slice(0, Number(process.env.MAX_SERVERLESS_MATCHES || 120)),
    screenshot: '',
    summary: {
      totalComponents: flattenNodes(figmaNodes).length,
      matchedComponents,
      totalIssues: results.reduce((acc, result) => acc + result.issues.length, 0),
      passCount: results.filter((result) => result.score >= 90).length,
      failCount: results.filter((result) => result.score < 90).length,
    },
  };
}

function isRateLimitError(error: unknown) {
  const value = error as { statusCode?: number; code?: string; response?: { status?: number }; message?: string };
  const message = String(value?.message || '');
  return (
    value?.statusCode === 429 ||
    value?.response?.status === 429 ||
    value?.code === 'FIGMA_RATE_LIMIT' ||
    message.includes('Figma API 429') ||
    message.includes('status code 429') ||
    message.includes('HTTP 429') ||
    message.toLowerCase().includes('rate limit')
  );
}

function calculateOverallScore(results: ReturnType<ComparisonEngine['compare']>) {
  if (results.length === 0) return 0;

  const matchedResults = results.filter((result) => result.domNode);
  if (matchedResults.length === 0) return 0;

  const matchedRatio = matchedResults.length / results.length;
  const averageConfidence = matchedResults.reduce((sum, result) => sum + result.confidence, 0) / matchedResults.length;
  const coverageScore = matchedRatio * 100;
  const qualityScore = matchedResults.reduce((acc, result) => acc + result.score, 0) / matchedResults.length;
  return Math.round((coverageScore * 0.35) + (averageConfidence * 100 * 0.25) + (qualityScore * 0.4));
}

async function fetchTargetHtml(pageUrl: string) {
  const headers = [
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
    {
      'User-Agent': 'Mozilla/5.0 DesignQA-AI/1.0',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  ];

  let lastResponse: Response | null = null;
  for (const requestHeaders of headers) {
    const response = await fetch(pageUrl, {
      headers: requestHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(TARGET_HTML_TIMEOUT_MS),
    });
    lastResponse = response;
    if (response.ok) return response.text();
    if (response.status !== 429 && response.status !== 403) break;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw httpError(lastResponse?.status || 500, `Target URL returned HTTP ${lastResponse?.status || 500}.`);
}

function buildTargetSnapshotFromHtml(html: string, pageUrl: string) {
  const text = decodeHtml(stripHtmlNoise(html));
  const textNodes = extractTextNodes(html);
  const imageNodes = extractImageNodes(html, pageUrl);
  const host = getPageHost(pageUrl);
  const pageText = [host, text.slice(0, 800)].filter(Boolean).join(' ');
  const children: UINode[] = [
    ...imageNodes,
    ...textNodes,
    {
      id: 'html-page-text',
      name: 'body',
      type: 'FRAME',
      layout: { x: 0, y: 0, width: 1440, height: 1200 },
      styles: {},
      text: pageText,
    },
  ];

  return {
    nodes: [{
      id: 'html-root',
      name: 'body',
      type: 'FRAME',
      layout: { x: 0, y: 0, width: 1440, height: 1200 },
      styles: {},
      text: host,
      children,
    } as UINode],
  };
}

function extractImageNodes(html: string, pageUrl: string) {
  const images: Array<{ url: string; label: string; index: number }> = [];
  const imgRegex = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) && images.length < 24) {
    const tag = match[0];
    const src = attrValue(tag, 'src') || attrValue(tag, 'data-src') || attrValue(tag, 'data-lazy-src');
    if (!src || src.startsWith('data:')) continue;
    const label = [
      attrValue(tag, 'alt'),
      attrValue(tag, 'title'),
      attrValue(tag, 'class'),
      attrValue(tag, 'id'),
      src.split('/').pop(),
    ].filter(Boolean).join(' ');
    images.push({ url: resolveUrl(src, pageUrl), label: normalizeText(label || src), index: images.length });
  }

  return images.map((image) => ({
    id: `html-image-${image.index}`,
    name: 'img',
    type: 'IMAGE',
    layout: { x: 0, y: 40 + image.index * 28, width: 240, height: 120 },
    styles: {},
    text: image.label,
  } as UINode));
}

function extractTextNodes(html: string) {
  const nodes: UINode[] = [];
  const textRegex = /<(h1|h2|h3|p|a|button|li|span)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(html)) && nodes.length < 80) {
    const content = decodeHtml(stripTags(match[2])).replace(/\s+/g, ' ').trim();
    if (content.length < 3 || content.length > 180) continue;
    nodes.push({
      id: `html-text-${nodes.length}`,
      name: match[1].toLowerCase(),
      type: 'TEXT',
      layout: { x: 0, y: 120 + nodes.length * 24, width: Math.min(900, content.length * 8), height: 24 },
      styles: {},
      text: content,
    });
  }
  return nodes;
}

function attrValue(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1] || '';
}

function resolveUrl(value: string, pageUrl: string) {
  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return value;
  }
}

function stripHtmlNoise(html: string) {
  return stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')).replace(/\s+/g, ' ').trim();
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getPageHost(pageUrl: string) {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function flattenNodes(nodes: UINode[]): UINode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenNodes(node.children) : [])]);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/\.(png|jpg|jpeg|svg|webp)$/g, '')
    .replace(/[_\-|/\\]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function selectVisualMatches(results: ReturnType<ComparisonEngine['compare']>) {
  const severityRank = { high: 0, medium: 1, low: 2 };
  return results
    .filter((match) => match.domNode && match.issues.length > 0)
    .sort((a, b) => {
      const aSeverity = a.issues[0]?.severity || 'low';
      const bSeverity = b.issues[0]?.severity || 'low';
      const severityDelta = severityRank[aSeverity] - severityRank[bSeverity];
      if (severityDelta !== 0) return severityDelta;
      return a.score - b.score;
    })
    .slice(0, Math.max(0, MAX_VISUAL_MATCHES));
}

function parseFigmaTarget(figmaUrl: string, explicitNodeId?: string) {
  let fileId = '';
  let nodeId = '';

  try {
    const figmaUrlObj = new URL(figmaUrl);
    const fileIdMatch = figmaUrlObj.pathname.match(/(?:file|design|proto|board)\/([a-zA-Z0-9\-_]+)/);
    if (fileIdMatch) {
      fileId = fileIdMatch[1];
      nodeId = figmaUrlObj.searchParams.get('node-id')?.replace(/-/g, ':').replace(/%3A/gi, ':') || '';
    }
  } catch {
    if (/^[a-zA-Z0-9\-_]{15,60}$/.test(figmaUrl)) fileId = figmaUrl;
  }

  if (explicitNodeId) nodeId = explicitNodeId.trim().replace(/-/g, ':').replace(/%3A/gi, ':');
  if (!fileId) throw httpError(400, 'Invalid Figma URL or key. Expected https://www.figma.com/design/:id/... or a valid file key.');

  return { fileId, nodeId };
}

function httpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}
