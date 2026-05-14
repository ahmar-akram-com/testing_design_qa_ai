const DEFAULT_QA_TIMEOUT_MS = process.env.VERCEL ? 55000 : 180000;
const QA_TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS || DEFAULT_QA_TIMEOUT_MS);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!req.body?.figmaUrl || !req.body?.pageUrl) {
    res.status(400).json({ error: 'Figma URL and Page URL are required' });
    return;
  }

  const timeout = new Promise((resolve, reject) => {
    setTimeout(() => {
      if (process.env.VERCEL) {
        resolve(createTimeoutUnknownReport(req.body || {}));
        return;
      }
      reject(new Error(`TIMEOUT: The analysis took longer than ${Math.round(QA_TIMEOUT_MS / 1000)} seconds. Use a specific Figma frame/node URL, reduce the target page size, or run the local version for large pages.`));
    }, QA_TIMEOUT_MS);
  });

  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';
    if (process.env.VERCEL) {
      process.env.MAX_VISUAL_MATCHES ||= '0';
      process.env.MAX_LOGO_CANDIDATES ||= '1';
      process.env.FIGMA_REQUEST_TIMEOUT_MS ||= '12000';
      process.env.FIGMA_REQUEST_RETRIES ||= '1';
      process.env.MAX_FIGMA_NODES ||= '70';
      process.env.MAX_DOM_NODES ||= '220';
      process.env.TARGET_HTML_TIMEOUT_MS ||= '6000';
    }
    const { runDesignQA } = await import('../../src/lib/designQaRunner.js');
    const report = await Promise.race([runDesignQA(req.body || {}), timeout]);
    res.status(200).json(report);
  } catch (error: any) {
    console.error('QA Run failed:', error);
    res.status(error.message?.startsWith('TIMEOUT') ? 504 : error.statusCode || 500).json({
      error: error.message || 'QA run failed',
    });
  }
}

function createTimeoutUnknownReport(body: any) {
  return {
    id: Math.random().toString(36).slice(2, 11),
    timestamp: new Date().toISOString(),
    figmaFileId: extractFigmaFileId(String(body?.figmaUrl || '')),
    pageUrl: String(body?.pageUrl || ''),
    overallScore: 0,
    designMatch: {
      status: 'unknown',
      score: 0,
      message: 'Design match could not be verified in the deployed runtime. Comparison was stopped.',
      checkName: 'Design match preflight',
      reason: 'The deployed analysis timed out before it could complete a genuine design identity check, so it did not mark the target URL as matched or different.',
      figmaSignals: [],
      targetSignals: [],
      matchedSignals: [],
    },
    matches: [],
    screenshot: '',
    summary: {
      totalComponents: 0,
      matchedComponents: 0,
      totalIssues: 0,
      passCount: 0,
      failCount: 0,
    },
  };
}

function extractFigmaFileId(figmaUrl: string) {
  try {
    const url = new URL(figmaUrl);
    return url.pathname.match(/(?:file|design|proto|board)\/([a-zA-Z0-9\-_]+)/)?.[1] || 'unknown';
  } catch {
    return figmaUrl || 'unknown';
  }
}
