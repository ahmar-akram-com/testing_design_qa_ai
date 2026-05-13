export default function handler(_req: any, res: any) {
  res.status(200).json({
    status: 'ok',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    figmaConfigured: Boolean(process.env.FIGMA_ACCESS_TOKEN),
  });
}
