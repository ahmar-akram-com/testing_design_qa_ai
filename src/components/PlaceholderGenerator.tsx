import { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Loader2, Sparkles } from 'lucide-react';

export function PlaceholderGenerator({
  nodeName,
  nodeType,
  onPlaceholderGenerated,
}: {
  nodeName: string;
  nodeType: string;
  onPlaceholderGenerated: (imageUrl: string) => void;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is missing from environment variables');

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `A clean wireframe UI placeholder for a ${nodeType} named "${nodeName}". No text.` }],
        },
        config: {
          imageConfig: { aspectRatio: '4:3' },
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          onPlaceholderGenerated(`data:image/png;base64,${part.inlineData.data}`);
          return;
        }
      }
      throw new Error('No image returned by Gemini.');
    } catch (err: any) {
      setError(err.message || 'Failed to generate placeholder');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex max-w-sm flex-col items-center justify-center space-y-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10">
        <Sparkles className="h-5 w-5 text-indigo-500" />
      </div>
      <div>
        <h4 className="text-sm font-medium text-slate-800 dark:text-slate-200">Missing Component Image</h4>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Generate a wireframe placeholder using Gemini.</p>
      </div>
      {error && <div className="w-full rounded bg-rose-50 p-2 text-xs text-rose-500 dark:bg-rose-500/10">{error}</div>}
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {isGenerating ? 'Generating...' : 'Generate Placeholder'}
      </button>
    </div>
  );
}
