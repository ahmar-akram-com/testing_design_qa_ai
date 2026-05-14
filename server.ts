import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { runDesignQA } from './src/lib/designQaRunner.js';
import { ComparisonEngine } from './src/services/comparisonEngine.js';
import { DOMCaptureService } from './src/services/domCaptureService.js';
import { FigmaService } from './src/services/figmaService.js';
import { MappingEngine } from './src/services/mappingEngine.js';
import { isValidRepository, normalizeRepository } from './src/lib/githubIssue.js';
import type { UINode } from './src/types';

dotenv.config();
dotenv.config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QA_TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS || 180000);
const MAX_VISUAL_MATCHES = Number(process.env.MAX_VISUAL_MATCHES || 10);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      figmaConfigured: Boolean(process.env.FIGMA_ACCESS_TOKEN),
    });
  });

  app.post('/api/qa/run', async (req, res) => {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`TIMEOUT: The analysis took longer than ${Math.round(QA_TIMEOUT_MS / 1000)} seconds. The report may be too large; try a smaller Figma node or set MAX_VISUAL_MATCHES lower.`)), QA_TIMEOUT_MS);
    });

    try {
      const report = await Promise.race([runDesignQA(req.body), timeout]);
      res.json(report);
    } catch (error: any) {
      console.error('QA Run failed:', error);
      res.status(error.message?.startsWith('TIMEOUT') ? 504 : error.statusCode || 500).json({ error: error.message || 'QA run failed' });
    }
  });

  app.post('/api/github/issues/bulk', async (req, res) => {
    try {
      const repository = normalizeRepository(String(req.body?.repository || ''));
      const issues = Array.isArray(req.body?.issues) ? req.body.issues : [];

      if (!isValidRepository(repository)) throw httpError(400, 'Enter a valid GitHub repository in owner/repository format.');
      if (issues.length === 0) throw httpError(400, 'No issues were selected for GitHub logging.');
      if (issues.length > 100) throw httpError(400, 'Please log 100 issues or fewer at one time.');

      const token = await getGitHubToken(String(req.body?.githubToken || ''));
      if (!token) {
        throw httpError(401, 'GitHub authentication is not configured. Paste a GitHub token in the dashboard field, run gh auth login on this laptop, or set GITHUB_TOKEN/GH_TOKEN in .env.local, then try again.');
      }

      const created = [];
      for (const issue of issues) {
        const title = String(issue.title || '').trim();
        const body = String(issue.body || '').trim();
        if (!title || !body) continue;
        created.push(await createGitHubIssue(repository, { title, body }, token));
      }

      res.json({ repository, createdCount: created.length, issues: created });
    } catch (error: any) {
      console.error('GitHub issue logging failed:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'GitHub issue logging failed' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: __dirname,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DesignQA-AI listening on http://localhost:${PORT}`);
  });
}

async function createGitHubIssue(repository: string, issue: { title: string; body: string }, token: string) {
  const [owner, repo] = repository.split('/');
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
  const basePayload = {
    title: issue.title,
    body: issue.body,
    labels: [],
    type: 'Bug',
  };

  let response = await postGitHubIssue(endpoint, token, basePayload);
  if (!response.ok && response.status === 422) {
    response = await postGitHubIssue(endpoint, token, { title: issue.title, body: issue.body, labels: [] });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message ? `GitHub rejected the issue: ${data.message}` : `GitHub issue creation failed with HTTP ${response.status}`;
    throw httpError(response.status, message);
  }

  return {
    number: data.number,
    title: data.title,
    url: data.html_url,
  };
}

function postGitHubIssue(endpoint: string, token: string, payload: Record<string, unknown>) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DesignQA-AI',
    },
    body: JSON.stringify(payload),
  });
}

async function getGitHubToken(explicitToken = '') {
  if (explicitToken.trim()) return explicitToken.trim();
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken?.trim()) return envToken.trim();

  return new Promise<string>((resolve) => {
    execFile('gh', ['auth', 'token'], { windowsHide: true, timeout: 10000 }, (error, stdout) => {
      if (error) {
        resolve('');
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function legacyRunDesignQA(body: any) {
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
  await figmaService.checkToken();
  console.log('[QA] Extracting Figma nodes');
  const figmaNodes = await figmaService.extractFile(fileId, { nodeId, pageName: figmaPageName });
  console.log(`[QA] Figma nodes extracted: ${figmaNodes.length}`);

  try {
    console.log(`[QA] Capturing target page: ${pageUrl}`);
    const { nodes: domNodes, screenshot: domScreenshot } = await domService.start(pageUrl, viewport);
    console.log(`[QA] DOM roots captured: ${domNodes.length}`);
    const designMatch = analyzeDesignIdentity(figmaNodes, domNodes, pageUrl);
    console.log(`[QA] Design identity check: ${designMatch.status} (${designMatch.score}%)`);

    if (designMatch.status === 'mismatch') {
      console.log('[QA] Target URL identity does not match Figma design. Skipping component comparison.');
      const mismatchResults = comparisonEngine.compare(
        flattenNodes(figmaNodes).map((figmaNode) => ({
          figmaNode,
          domNode: null,
          confidence: 0,
          issues: [],
          score: 0,
        })),
      );

      return {
        id: Math.random().toString(36).slice(2, 11),
        timestamp: new Date().toISOString(),
        figmaFileId: fileId,
        pageUrl,
        overallScore: 0,
        designMatch,
        matches: mismatchResults,
        screenshot: domScreenshot,
        summary: {
          totalComponents: figmaNodes.length,
          matchedComponents: 0,
          totalIssues: mismatchResults.reduce((acc, result) => acc + result.issues.length, 0),
          passCount: 0,
          failCount: mismatchResults.length,
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
    const nodeImageUrls = await figmaService.getNodesImages(fileId, nodeIds);

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

function analyzeDesignIdentity(figmaNodes: UINode[], domNodes: UINode[], pageUrl: string) {
  const figmaSignals = collectIdentitySignals(figmaNodes, 'figma');
  const targetSignals = [...collectDomainSignals(pageUrl), ...collectIdentitySignals(domNodes, 'target')].filter(uniqueOnly);
  const importantFigmaSignals = figmaSignals.filter((signal) => !isGenericSignal(signal));
  const matchedSignals = importantFigmaSignals
    .filter((figmaSignal) => targetSignals.some((targetSignal) => signalsMatch(figmaSignal, targetSignal)))
    .filter(uniqueOnly)
    .slice(0, 8);

  const score = importantFigmaSignals.length === 0 ? 0 : Math.round((matchedSignals.length / Math.min(importantFigmaSignals.length, 8)) * 100);
  const hasFigmaIdentity = importantFigmaSignals.length > 0;
  const hasTargetIdentity = targetSignals.length > 0;
  const status: 'matched' | 'mismatch' | 'unknown' = matchedSignals.length > 0 ? 'matched' : hasFigmaIdentity && hasTargetIdentity ? 'mismatch' : 'unknown';
  const message =
    status === 'matched'
      ? 'Figma design matches with the target URL. Test comparison begins.'
      : status === 'mismatch'
        ? 'Figma and target URL are not same.'
        : 'Design identity could not be confirmed from logo or brand text. Test comparison continues.';

  return {
    status,
    score,
    message,
    figmaSignals: importantFigmaSignals.slice(0, 8),
    targetSignals: targetSignals.slice(0, 8),
    matchedSignals,
  };
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
  return overlap / Math.min(figmaWords.size, targetWords.size) >= 0.75;
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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
