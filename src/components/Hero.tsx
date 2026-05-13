import { ArrowRight, Loader2, Play } from 'lucide-react';

export function Hero({ onRun, isLoading }: { onRun: () => void; onLoadSession?: () => void; isLoading: boolean }) {
  return (
    <section className="mx-auto max-w-5xl space-y-6 px-6 py-12 text-center md:py-16">
      <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
        Comparison Engine v2.0
      </div>

      <h2 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white md:text-5xl">
        Compare Figma designs with <br className="hidden md:block" />
        <span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">production pages.</span>
      </h2>

      <p className="mx-auto max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-400">
        Detect layout, spacing, typography, and missing element issues before they reach clients.
      </p>

      <div className="flex items-center justify-center pt-5">
        <button
          onClick={onRun}
          disabled={isLoading}
          className="group flex h-14 min-w-[240px] items-center justify-center gap-3 rounded-xl bg-gradient-to-b from-indigo-500 to-violet-600 px-8 text-base font-semibold text-white shadow-xl shadow-indigo-500/30 ring-1 ring-white/20 transition-all hover:-translate-y-0.5 hover:from-indigo-400 hover:to-violet-500 hover:shadow-2xl hover:shadow-indigo-500/40 active:translate-y-0 active:scale-95 disabled:opacity-60"
        >
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-current" />}
          {isLoading ? 'Testing Comparison...' : 'Test Comparison'}
          {!isLoading && <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />}
        </button>
      </div>
    </section>
  );
}
