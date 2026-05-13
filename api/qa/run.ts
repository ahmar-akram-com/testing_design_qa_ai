import { runDesignQA } from '../../server.ts';

const QA_TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS || 180000);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`TIMEOUT: The analysis took longer than ${Math.round(QA_TIMEOUT_MS / 1000)} seconds. The report may be too large; try a smaller Figma node or set MAX_VISUAL_MATCHES lower.`)), QA_TIMEOUT_MS);
  });

  try {
    const report = await Promise.race([runDesignQA(req.body || {}), timeout]);
    res.status(200).json(report);
  } catch (error: any) {
    res.status(error.message?.startsWith('TIMEOUT') ? 504 : error.statusCode || 500).json({
      error: error.message || 'QA run failed',
    });
  }
}
