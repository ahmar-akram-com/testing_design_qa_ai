import { ComparisonEngine } from '../services/comparisonEngine.js';
import { DOMCaptureService } from '../services/domCaptureService.js';
import { FigmaService } from '../services/figmaService.js';
import { MappingEngine } from '../services/mappingEngine.js';
import { PNG } from 'pngjs';
import type { UINode } from '../types';

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
const MAX_VISUAL_MATCHES = Number(process.env.MAX_VISUAL_MATCHES || (IS_SERVERLESS ? 0 : 10));
const LOGO_IMAGE_MATCH_THRESHOLD = Number(process.env.LOGO_IMAGE_MATCH_THRESHOLD || 72);
const MAX_LOGO_CANDIDATES = Number(process.env.MAX_LOGO_CANDIDATES || (IS_SERVERLESS ? 1 : 4));
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
  const figmaNodes = await figmaService.extractFile(fileId, { nodeId, pageName: figmaPageName });
  console.log(`[QA] Figma nodes extracted: ${figmaNodes.length}`);

  if (IS_SERVERLESS) {
    return runFastServerlessQA({
      figmaNodes,
      fileId,
      pageUrl,
      figmaService,
      mappingEngine,
      comparisonEngine,
    });
  }

  try {
    console.log(`[QA] Capturing target page: ${pageUrl}`);
    const { nodes: domNodes, screenshot: domScreenshot } = await domService.start(pageUrl, viewport, { includeScreenshot: !IS_SERVERLESS });
    console.log(`[QA] DOM roots captured: ${domNodes.length}`);
    const designMatch = await analyzeDesignIdentity(figmaNodes, domNodes, pageUrl, fileId, figmaService, domService);
    console.log(`[QA] Design identity check: ${designMatch.status} (${designMatch.score}%)`);

    if (designMatch.status !== 'matched') {
      console.log('[QA] Target URL identity does not match Figma design. Skipping component comparison.');
      return {
        id: Math.random().toString(36).slice(2, 11),
        timestamp: new Date().toISOString(),
        figmaFileId: fileId,
        pageUrl,
        overallScore: 0,
        designMatch,
        matches: [],
        screenshot: domScreenshot,
        summary: {
          totalComponents: flattenNodes(figmaNodes).length,
          matchedComponents: 0,
          totalIssues: 0,
          passCount: 0,
          failCount: 0,
        },
      };
    }

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
    const overallScore = calculateOverallScore(results, designMatch.status);

    return {
      id: Math.random().toString(36).slice(2, 11),
      timestamp: new Date().toISOString(),
      figmaFileId: fileId,
      pageUrl,
      overallScore,
      designMatch,
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
  figmaService,
  mappingEngine,
  comparisonEngine,
}: {
  figmaNodes: UINode[];
  fileId: string;
  pageUrl: string;
  figmaService: FigmaService;
  mappingEngine: MappingEngine;
  comparisonEngine: ComparisonEngine;
}) {
  console.log(`[QA] Running fast deployed analysis for ${pageUrl}`);
  const html = await fetchTargetHtml(pageUrl);
  const targetSnapshot = buildTargetSnapshotFromHtml(html, pageUrl);
  const initialDesignMatch = analyzeSignalIdentity(figmaNodes, targetSnapshot.nodes, pageUrl);
  const matches = mappingEngine.matchNodes(figmaNodes, targetSnapshot.nodes);
  const results = comparisonEngine.compare(matches);
  const designMatch = resolveServerlessDesignMatch(initialDesignMatch, results);

  if (designMatch.status === 'mismatch') {
    return {
      id: Math.random().toString(36).slice(2, 11),
      timestamp: new Date().toISOString(),
      figmaFileId: fileId,
      pageUrl,
      overallScore: 0,
      designMatch,
      matches: [],
      screenshot: '',
      summary: {
        totalComponents: flattenNodes(figmaNodes).length,
        matchedComponents: 0,
        totalIssues: 0,
        passCount: 0,
        failCount: 0,
      },
    };
  }

  const matchedComponents = results.filter((result) => result.domNode).length;
  const overallScore = calculateOverallScore(results, designMatch.status);

  return {
    id: Math.random().toString(36).slice(2, 11),
    timestamp: new Date().toISOString(),
    figmaFileId: fileId,
    pageUrl,
    overallScore,
    designMatch,
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

function resolveServerlessDesignMatch(
  designMatch: ReturnType<typeof analyzeSignalIdentity>,
  results: ReturnType<ComparisonEngine['compare']>,
) {
  if (designMatch.status === 'matched') return designMatch;

  const matchedComponents = results.filter((result) => result.domNode).length;
  const strongMatches = results.filter((result) => result.domNode && result.confidence >= 0.85).length;
  const totalComponents = Math.max(1, results.length);
  const matchedRatio = matchedComponents / totalComponents;
  const strongMatchRatio = strongMatches / totalComponents;
  const hasComponentEvidence = matchedRatio >= 0.15 || strongMatchRatio >= 0.08;

  if (hasComponentEvidence) {
    const score = Math.max(
      designMatch.score,
      Math.min(100, Math.round(Math.max(matchedRatio, strongMatchRatio) * 100)),
    );

    return {
      ...designMatch,
      status: 'matched' as const,
      score,
      message: 'Both Figma design file and target URL matched. Test comparison begins.',
      checkName: 'Component/content match check',
      reason: `The deployed comparison found ${matchedComponents} shared component/content candidate${matchedComponents === 1 ? '' : 's'}, so the target URL is treated as the same design.`,
      matchedSignals: designMatch.matchedSignals.length
        ? designMatch.matchedSignals
        : [`${matchedComponents} component/content candidate${matchedComponents === 1 ? '' : 's'} matched`],
    };
  }

  return {
    ...designMatch,
    status: 'mismatch' as const,
    score: 0,
    message: 'Figma design file and target URL are not the same. Comparison was stopped.',
    checkName: 'Component/content match check',
    reason: 'No distinctive shared identity signal or component/content structure was found between the selected Figma design and target URL.',
    matchedSignals: [],
  };
}

function calculateOverallScore(results: ReturnType<ComparisonEngine['compare']>, designMatchStatus?: 'matched' | 'mismatch' | 'unknown') {
  if (designMatchStatus === 'mismatch') return 0;
  if (results.length === 0) return 0;

  const matchedResults = results.filter((result) => result.domNode);
  if (matchedResults.length === 0) return 0;

  const matchedRatio = matchedResults.length / results.length;
  const averageConfidence = matchedResults.reduce((sum, result) => sum + result.confidence, 0) / matchedResults.length;
  const strongMatchRatio = results.filter((result) => result.domNode && result.confidence >= 0.85).length / results.length;

  const designDoesNotMatch =
    matchedRatio < 0.15 ||
    strongMatchRatio < 0.08 ||
    (matchedRatio < 0.35 && averageConfidence < 0.85);

  if (designDoesNotMatch) return 0;

  return Math.round(results.reduce((acc, result) => acc + result.score, 0) / results.length);
}

async function analyzeDesignIdentity(figmaNodes: UINode[], domNodes: UINode[], pageUrl: string, fileId: string, figmaService: FigmaService, domService: DOMCaptureService) {
  const logoImageCheck = await compareLogoImages(figmaNodes, domNodes, fileId, figmaService, domService);
  if (logoImageCheck.status !== 'unknown') return logoImageCheck;

  return analyzeSignalIdentity(figmaNodes, domNodes, pageUrl);
}

function analyzeSignalIdentity(figmaNodes: UINode[], targetNodes: UINode[], pageUrl: string) {
  const figmaSignals = collectIdentitySignals(figmaNodes, 'figma');
  const targetSignals = [...collectDomainSignals(pageUrl), ...collectIdentitySignals(targetNodes, 'target')].filter(uniqueOnly);
  const importantFigmaSignals = selectDistinctiveSignals(figmaSignals);
  const importantTargetSignals = selectDistinctiveSignals(targetSignals);
  const matchedSignals = importantFigmaSignals
    .filter((figmaSignal) => targetSignals.some((targetSignal) => signalsMatch(figmaSignal, targetSignal)))
    .filter(uniqueOnly)
    .slice(0, 8);

  const denominator = Math.max(1, Math.min(importantFigmaSignals.length, 8));
  const score = Math.round((matchedSignals.length / denominator) * 100);
  const hasFigmaIdentity = importantFigmaSignals.length > 0;
  const hasTargetIdentity = importantTargetSignals.length > 0;
  const status: 'matched' | 'mismatch' | 'unknown' =
    matchedSignals.length > 0 && score >= 12 ? 'matched' : hasFigmaIdentity && hasTargetIdentity ? 'mismatch' : 'unknown';
  const message =
    status === 'matched'
      ? 'Both Figma design file and target URL matched. Test comparison begins.'
      : status === 'mismatch'
        ? 'Figma design file and target URL are not the same. Comparison was stopped.'
        : 'Design identity could not be confirmed from unique logo, brand, header, or hero text. Comparison was stopped.';

  return {
    status,
    score,
    message,
    checkName: 'Design identity match check',
    reason:
      status === 'matched'
        ? 'At least one distinctive Figma identity signal was found on the target URL.'
        : 'No distinctive shared identity signal was found between the Figma frame/component and the target URL.',
    figmaSignals: importantFigmaSignals.slice(0, 8),
    targetSignals: importantTargetSignals.slice(0, 8),
    matchedSignals,
  };
}

async function compareLogoImages(figmaNodes: UINode[], domNodes: UINode[], fileId: string, figmaService: FigmaService, domService: DOMCaptureService) {
  const figmaLogoCandidates = collectLogoImageCandidates(figmaNodes, 'figma').slice(0, MAX_LOGO_CANDIDATES);
  const targetLogoCandidates = collectLogoImageCandidates(domNodes, 'target').slice(0, MAX_LOGO_CANDIDATES);
  const figmaLabels = figmaLogoCandidates.map(candidateLabel).filter(uniqueOnly);
  const targetLabels = targetLogoCandidates.map(candidateLabel).filter(uniqueOnly);

  if (figmaLogoCandidates.length === 0 || targetLogoCandidates.length === 0) {
    return {
      status: 'unknown' as const,
      score: 0,
      message: 'Design identity could not be confirmed. Comparison was stopped.',
      checkName: 'Design identity match check',
      reason: figmaLogoCandidates.length === 0
        ? 'No logo image candidate was found in the selected Figma frame/component.'
        : 'No logo image candidate was found on the target URL.',
      figmaSignals: figmaLabels,
      targetSignals: targetLabels,
      matchedSignals: [],
    };
  }

  const figmaImageUrls = await figmaService.getNodesImages(fileId, figmaLogoCandidates.map((candidate) => candidate.id));
  const figmaImages = await Promise.all(
    figmaLogoCandidates.map(async (candidate) => {
      const imageUrl = figmaImageUrls[candidate.id];
      if (!imageUrl) return null;
      try {
        const buffer = await figmaService.getImageBuffer(imageUrl);
        return { candidate, base64: buffer.toString('base64') };
      } catch {
        return null;
      }
    }),
  );

  const targetImages = await Promise.all(
    targetLogoCandidates.map(async (candidate) => {
      const base64 = await domService.captureNodeImage(candidate.layout);
      return base64 ? { candidate, base64 } : null;
    }),
  );

  let best: { score: number; figma: UINode; target: UINode } | null = null;
  for (const figmaImage of figmaImages.filter(Boolean) as Array<{ candidate: UINode; base64: string }>) {
    for (const targetImage of targetImages.filter(Boolean) as Array<{ candidate: UINode; base64: string }>) {
      const score = compareImageFingerprints(figmaImage.base64, targetImage.base64);
      if (!best || score > best.score) best = { score, figma: figmaImage.candidate, target: targetImage.candidate };
    }
  }

  if (!best) {
    return {
      status: 'unknown' as const,
      score: 0,
      message: 'Design identity could not be confirmed. Comparison was stopped.',
      checkName: 'Design identity match check',
      reason: 'Logo candidates were found, but one or more logo images could not be rendered for comparison.',
      figmaSignals: figmaLabels,
      targetSignals: targetLabels,
      matchedSignals: [],
    };
  }

  const score = Math.round(best.score);
  const matched = score >= LOGO_IMAGE_MATCH_THRESHOLD;
  return {
    status: matched ? 'matched' as const : 'mismatch' as const,
    score,
    message: matched
      ? 'Figma design file and target URL matched. Test comparison begins.'
      : 'Figma design file and target URL are not the same. Comparison was stopped.',
    checkName: 'Design identity match check',
    reason: matched
      ? `The strongest visual identity match scored ${score}%, so the target URL is treated as the same design.`
      : `The strongest visual identity match scored ${score}%, below the required ${LOGO_IMAGE_MATCH_THRESHOLD}%.`,
    figmaSignals: figmaLabels,
    targetSignals: targetLabels,
    matchedSignals: matched ? [`${candidateLabel(best.figma)} -> ${candidateLabel(best.target)}`] : [],
  };
}

async function compareLogoImagesFromHtml(figmaNodes: UINode[], targetLogoImages: Array<{ url: string; label: string }>, fileId: string, figmaService: FigmaService, pageUrl: string) {
  const figmaLogoCandidates = collectLogoImageCandidates(figmaNodes, 'figma').slice(0, MAX_LOGO_CANDIDATES);
  const targetCandidates = targetLogoImages.slice(0, MAX_LOGO_CANDIDATES);
  const figmaLabels = figmaLogoCandidates.map(candidateLabel).filter(uniqueOnly);
  const targetLabels = targetCandidates.map((candidate) => normalizeSignal(candidate.label || candidate.url)).filter(Boolean).filter(uniqueOnly);

  if (figmaLogoCandidates.length === 0 || targetCandidates.length === 0) {
    return {
      status: 'unknown' as const,
      score: 0,
      message: 'Design identity could not be confirmed. Comparison was stopped.',
      checkName: 'Design identity match check',
      reason: figmaLogoCandidates.length === 0
        ? 'No logo image candidate was found in the selected Figma frame/component.'
        : 'No logo image candidate was found on the target URL.',
      figmaSignals: figmaLabels,
      targetSignals: targetLabels.length ? targetLabels : collectDomainSignals(pageUrl),
      matchedSignals: [],
    };
  }

  const figmaImageUrls = await figmaService.getNodesImages(fileId, figmaLogoCandidates.map((candidate) => candidate.id));
  const figmaImages = await Promise.all(figmaLogoCandidates.map(async (candidate) => {
    const imageUrl = figmaImageUrls[candidate.id];
    if (!imageUrl) return null;
    try {
      const buffer = await figmaService.getImageBuffer(imageUrl);
      return { candidate, base64: buffer.toString('base64') };
    } catch {
      return null;
    }
  }));

  const targetImages = await Promise.all(targetCandidates.map(async (candidate) => {
    try {
      const buffer = await fetchBinary(candidate.url, 8000);
      return { candidate, base64: buffer.toString('base64') };
    } catch {
      return null;
    }
  }));

  let best: { score: number; figma: UINode; target: { url: string; label: string } } | null = null;
  for (const figmaImage of figmaImages.filter(Boolean) as Array<{ candidate: UINode; base64: string }>) {
    for (const targetImage of targetImages.filter(Boolean) as Array<{ candidate: { url: string; label: string }; base64: string }>) {
      const score = compareImageFingerprints(figmaImage.base64, targetImage.base64);
      if (!best || score > best.score) best = { score, figma: figmaImage.candidate, target: targetImage.candidate };
    }
  }

  if (!best) {
    return {
      status: 'unknown' as const,
      score: 0,
      message: 'Design identity could not be confirmed. Comparison was stopped.',
      checkName: 'Design identity match check',
      reason: 'Logo candidates were found, but one or more logo images could not be downloaded for comparison.',
      figmaSignals: figmaLabels,
      targetSignals: targetLabels,
      matchedSignals: [],
    };
  }

  const score = Math.round(best.score);
  const matched = score >= LOGO_IMAGE_MATCH_THRESHOLD;
  return {
    status: matched ? 'matched' as const : 'mismatch' as const,
    score,
    message: matched
      ? 'Figma design file and target URL matched. Test comparison begins.'
      : 'Figma design file and target URL are not the same. Comparison was stopped.',
    checkName: 'Design identity match check',
    reason: matched
      ? `The strongest visual identity match scored ${score}%, so the target URL is treated as the same design.`
      : `The strongest visual identity match scored ${score}%, below the required ${LOGO_IMAGE_MATCH_THRESHOLD}%.`,
    figmaSignals: figmaLabels,
    targetSignals: targetLabels,
    matchedSignals: matched ? [`${candidateLabel(best.figma)} -> ${normalizeSignal(best.target.label || best.target.url)}`] : [],
  };
}

async function fetchTargetHtml(pageUrl: string) {
  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 DesignQA-AI/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(TARGET_HTML_TIMEOUT_MS),
  });

  if (!response.ok) throw httpError(response.status, `Target URL returned HTTP ${response.status}.`);
  return response.text();
}

async function fetchBinary(url: string, timeoutMs: number) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 DesignQA-AI/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Failed to download image ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function buildTargetSnapshotFromHtml(html: string, pageUrl: string) {
  const text = decodeHtml(stripHtmlNoise(html));
  const logoImages = extractImageCandidates(html, pageUrl);
  const textNodes = extractTextNodes(html);
  const imageNodes = logoImages.map((image, index) => ({
    id: `html-logo-${index}`,
    name: 'img',
    type: 'IMAGE',
    layout: { x: 0, y: 40 + index * 20, width: 160, height: 60 },
    styles: {},
    text: image.label,
  }));
  const children: UINode[] = [
    ...imageNodes,
    ...textNodes,
    {
      id: 'html-page-text',
      name: 'body',
      type: 'FRAME',
      layout: { x: 0, y: 0, width: 1440, height: 1200 },
      styles: {},
      text: text.slice(0, 800),
    },
  ];

  return {
    logoImages,
    nodes: [{
      id: 'html-root',
      name: 'body',
      type: 'FRAME',
      layout: { x: 0, y: 0, width: 1440, height: 1200 },
      styles: {},
      text: collectDomainSignals(pageUrl).join(' '),
      children,
    } as UINode],
  };
}

function extractImageCandidates(html: string, pageUrl: string) {
  const images: Array<{ url: string; label: string; score: number }> = [];
  const imgRegex = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html))) {
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
    const normalized = normalizeSignal(label);
    const logoScore = /\blogo\b|brand|site identity|navbar/.test(normalized) ? 100 : 0;
    const earlyScore = Math.max(0, 40 - Math.floor(match.index / 4000));
    const formatScore = /\.(svg|png|webp|jpg|jpeg)(\?|$)/i.test(src) ? 20 : 0;
    images.push({ url: resolveUrl(src, pageUrl), label: normalized || src, score: logoScore + earlyScore + formatScore });
  }

  return images
    .sort((a, b) => b.score - a.score)
    .filter((image, index, items) => items.findIndex((item) => item.url === image.url) === index)
    .slice(0, 6)
    .map(({ url, label }) => ({ url, label }));
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

function collectLogoImageCandidates(nodes: UINode[], source: 'figma' | 'target') {
  return flattenNodes(nodes)
    .filter((node) => {
      const label = normalizeSignal(`${node.name} ${node.text || ''}`);
      const width = node.layout?.width || 0;
      const height = node.layout?.height || 0;
      const y = node.layout?.y || 0;
      const hasLogoLabel = /\blogo\b|brandmark|logomark|site logo|company logo/.test(label);
      const isImageLike = source === 'target'
        ? node.type === 'IMAGE'
        : ['VECTOR', 'RECTANGLE', 'GROUP', 'COMPONENT', 'INSTANCE', 'FRAME'].includes(node.type);
      const isHeaderSized = y <= 420 && width >= 16 && height >= 16 && width <= 900 && height <= 320;
      const isLikelyHeaderImage = source === 'target' && node.type === 'IMAGE' && y <= 260 && width >= 24 && height >= 16 && width <= 600 && height <= 220;
      return isImageLike && (hasLogoLabel || isLikelyHeaderImage) && isHeaderSized;
    })
    .sort((a, b) => logoCandidateScore(b, source) - logoCandidateScore(a, source))
    .filter((candidate, index, candidates) => candidates.findIndex((item) => item.id === candidate.id) === index);
}

function logoCandidateScore(node: UINode, source: 'figma' | 'target') {
  const label = normalizeSignal(`${node.name} ${node.text || ''}`);
  const y = node.layout?.y || 0;
  const width = node.layout?.width || 0;
  const height = node.layout?.height || 0;
  const explicitLogo = /\blogo\b|brandmark|logomark|site logo|company logo/.test(label) ? 100 : 0;
  const headerScore = Math.max(0, 60 - Math.round(y / 8));
  const shapeScore = width > height ? 20 : 8;
  const imageScore = source === 'target' && node.type === 'IMAGE' ? 30 : 0;
  return explicitLogo + headerScore + shapeScore + imageScore;
}

function candidateLabel(node: UINode) {
  return normalizeSignal(`${node.name} ${node.text || ''}`) || node.id;
}

function compareImageFingerprints(figmaBase64: string, targetBase64: string) {
  const figma = imageFingerprint(figmaBase64);
  const target = imageFingerprint(targetBase64);
  if (!figma || !target) return 0;

  const hashScore = bitSimilarity(figma.hash, target.hash) * 100;
  const colorScore = paletteSimilarity(figma.palette, target.palette) * 100;
  const aspectScore = Math.max(0, 100 - Math.abs(figma.aspect - target.aspect) * 45);

  return Math.round(hashScore * 0.55 + colorScore * 0.25 + aspectScore * 0.2);
}

function imageFingerprint(base64: string) {
  try {
    const png = PNG.sync.read(Buffer.from(base64, 'base64'));
    const size = 16;
    const grayValues: number[] = [];
    const palette = new Map<string, number>();

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const sourceX = Math.min(png.width - 1, Math.floor((x / size) * png.width));
        const sourceY = Math.min(png.height - 1, Math.floor((y / size) * png.height));
        const index = (png.width * sourceY + sourceX) << 2;
        const alpha = png.data[index + 3] / 255;
        const r = Math.round(png.data[index] * alpha + 255 * (1 - alpha));
        const g = Math.round(png.data[index + 1] * alpha + 255 * (1 - alpha));
        const b = Math.round(png.data[index + 2] * alpha + 255 * (1 - alpha));
        grayValues.push(0.299 * r + 0.587 * g + 0.114 * b);

        const key = `${Math.round(r / 48)}-${Math.round(g / 48)}-${Math.round(b / 48)}`;
        palette.set(key, (palette.get(key) || 0) + 1);
      }
    }

    const average = grayValues.reduce((sum, value) => sum + value, 0) / grayValues.length;
    return {
      hash: grayValues.map((value) => value >= average),
      palette,
      aspect: png.width / Math.max(1, png.height),
    };
  } catch {
    return null;
  }
}

function bitSimilarity(left: boolean[], right: boolean[]) {
  const total = Math.min(left.length, right.length);
  if (total === 0) return 0;
  let same = 0;
  for (let index = 0; index < total; index += 1) {
    if (left[index] === right[index]) same += 1;
  }
  return same / total;
}

function paletteSimilarity(left: Map<string, number>, right: Map<string, number>) {
  const leftTotal = [...left.values()].reduce((sum, value) => sum + value, 0) || 1;
  const rightTotal = [...right.values()].reduce((sum, value) => sum + value, 0) || 1;
  const keys = new Set([...left.keys(), ...right.keys()]);
  let overlap = 0;
  for (const key of keys) {
    overlap += Math.min((left.get(key) || 0) / leftTotal, (right.get(key) || 0) / rightTotal);
  }
  return overlap;
}

function collectIdentitySignals(nodes: UINode[], source: 'figma' | 'target') {
  const flattened = flattenNodes(nodes);
  const signals: string[] = [];

  for (const node of flattened) {
    const y = node.layout?.y || 0;
    const name = normalizeSignal(node.name);
    const text = normalizeSignal(node.text || '');
    const isIdentityNode = /logo|brand|header|nav|site|company/i.test(node.name) || y < 360 || node.type === 'TEXT';

    if (!isIdentityNode) continue;
    if (text) signals.push(text);
    if (source === 'figma' && /logo|brand|company|site/i.test(node.name) && name) signals.push(name);
    if (source === 'target' && node.type === 'IMAGE' && name) signals.push(name);
  }

  return signals.filter((signal) => signal.length >= 3 && !isGenericSignal(signal)).filter(uniqueOnly).slice(0, 30);
}

function selectDistinctiveSignals(signals: string[]) {
  return signals
    .map(normalizeSignal)
    .filter((signal) => signal.length >= 3 && !isGenericSignal(signal))
    .sort((a, b) => signalSpecificity(b) - signalSpecificity(a))
    .filter(uniqueOnly)
    .slice(0, 16);
}

function collectDomainSignals(pageUrl: string) {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    return host
      .split(/[.\-_]/)
      .map(normalizeSignal)
      .filter((signal) => signal.length >= 3 && !isGenericSignal(signal));
  } catch {
    return [];
  }
}

function flattenNodes(nodes: UINode[]): UINode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenNodes(node.children) : [])]);
}

function signalsMatch(figmaSignal: string, targetSignal: string) {
  if (figmaSignal === targetSignal) return true;
  if (figmaSignal.length >= 4 && targetSignal.includes(figmaSignal)) return true;
  if (targetSignal.length >= 4 && figmaSignal.includes(targetSignal)) return true;

  const figmaWords = new Set(figmaSignal.split(' ').filter((word) => word.length >= 3));
  const targetWords = new Set(targetSignal.split(' ').filter((word) => word.length >= 3));
  if (figmaWords.size === 0 || targetWords.size === 0) return false;
  const overlap = [...figmaWords].filter((word) => targetWords.has(word)).length;
  return overlap / Math.min(figmaWords.size, targetWords.size) >= 0.65;
}

function signalSpecificity(signal: string) {
  const words = signal.split(' ').filter(Boolean);
  const lengthScore = Math.min(signal.length, 40);
  const wordScore = Math.min(words.length, 6) * 8;
  const hasNumberScore = /\d/.test(signal) ? 4 : 0;
  return lengthScore + wordScore + hasNumberScore;
}

function normalizeSignal(value: string) {
  return value
    .toLowerCase()
    .replace(/\.(png|jpg|jpeg|svg|webp)$/g, '')
    .replace(/[_\-|/\\]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericSignal(signal: string) {
  const generic = new Set([
    'logo',
    'brand',
    'header',
    'footer',
    'nav',
    'navbar',
    'menu',
    'home',
    'about',
    'contact',
    'services',
    'button',
    'image',
    'icon',
    'frame',
    'group',
    'section',
    'container',
    'main',
    'body',
    'page',
    'website',
    'design',
  ]);
  return generic.has(signal) || /^\d+$/.test(signal);
}

function uniqueOnly<T>(item: T, index: number, items: T[]) {
  return items.indexOf(item) === index;
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
