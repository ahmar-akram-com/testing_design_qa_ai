const QA_TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS || 180000);

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

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`TIMEOUT: The analysis took longer than ${Math.round(QA_TIMEOUT_MS / 1000)} seconds. The report may be too large; try a smaller Figma node or set MAX_VISUAL_MATCHES lower.`)), QA_TIMEOUT_MS);
  });

  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';
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
