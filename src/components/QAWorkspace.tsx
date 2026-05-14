import { AlertCircle, CheckCircle2, CheckSquare, Copy, ExternalLink, Eye, FileJson, Github, Image as ImageIcon, Loader2, Settings, Square, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ComponentMatch, Issue, QAReport } from '../types';
import { cn } from '../lib/utils';
import { PlaceholderGenerator } from './PlaceholderGenerator';
import { DEFAULT_TEMPLATE, buildGitHubIssueDraft, buildIssueTitle, formatValue, isValidRepository, labelForIssue, normalizeRepository } from '../lib/githubIssue';

interface ReportIssue {
  match: ComponentMatch;
  issue: Issue;
  issueIndex: number;
  globalIndex: number;
}

const issueKey = (reportIssue: ReportIssue) => `${reportIssue.match.figmaNode.id}-${reportIssue.issueIndex}-${reportIssue.globalIndex}`;

export function QAWorkspace({
  report,
  selectedMatch,
  setSelectedMatch,
  figmaUrl,
  setFigmaUrl,
  pageUrl,
  setPageUrl,
  figmaPageName,
  setFigmaPageName,
  figmaNodeId,
  setFigmaNodeId,
  figmaToken,
  setFigmaToken,
  viewport,
  setViewport,
  tolerance,
  setTolerance,
  preset,
  setPreset,
  onRun,
  onLoadSession,
  isLoading,
}: {
  report: QAReport | null;
  selectedMatch: ComponentMatch | null;
  setSelectedMatch: (match: ComponentMatch | null) => void;
  figmaUrl: string;
  setFigmaUrl: (v: string) => void;
  pageUrl: string;
  setPageUrl: (v: string) => void;
  figmaPageName: string;
  setFigmaPageName: (v: string) => void;
  figmaNodeId: string;
  setFigmaNodeId: (v: string) => void;
  figmaToken: string;
  setFigmaToken: (v: string) => void;
  viewport: string;
  setViewport: (v: string) => void;
  tolerance: string;
  setTolerance: (v: string) => void;
  preset: string;
  setPreset: (v: string) => void;
  onRun: () => void;
  onLoadSession: () => void;
  isLoading: boolean;
}) {
  const [githubRepo, setGithubRepo] = useState(() => localStorage.getItem('designqa.githubRepo') || '');
  const [issueTemplate, setIssueTemplate] = useState(() => {
    const savedTemplate = localStorage.getItem('designqa.issueTemplate');
    return savedTemplate && savedTemplate !== 'issue-form.yml' ? savedTemplate : DEFAULT_TEMPLATE;
  });
  const [copyStatus, setCopyStatus] = useState('');
  const reportIssues = useMemo<ReportIssue[]>(() => {
    if (!report) return [];
    let globalIndex = 0;
    return report.matches.flatMap((match) =>
      match.issues.map((issue, issueIndex) => ({
        match,
        issue,
        issueIndex,
        globalIndex: globalIndex++,
      })),
    );
  }, [report]);

  if (!report) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 px-6 pb-24">
        <div className="rounded-2xl border border-slate-200 bg-white/60 p-6 shadow-xl backdrop-blur-sm transition-colors dark:border-slate-800 dark:bg-slate-900/50">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <Field label="Figma URL" value={figmaUrl} onChange={setFigmaUrl} placeholder="https://figma.com/design/..." invalid={figmaUrl !== '' && !figmaUrl.match(/^https:\/\/(www\.)?figma\.com\//)} />
              <Field label="Target Page URL" value={pageUrl} onChange={setPageUrl} placeholder="https://staging.example.com" invalid={pageUrl !== '' && !pageUrl.match(/^https?:\/\//)} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Figma Page Name" value={figmaPageName} onChange={setFigmaPageName} placeholder="Optional" />
                <Field label="Figma Node ID" value={figmaNodeId} onChange={setFigmaNodeId} placeholder="Optional" />
              </div>
              <SecretField
                label="Figma Access Token"
                value={figmaToken}
                onChange={setFigmaToken}
                placeholder="Uses server token if left blank"
                hint="Clears on refresh. Leave blank to use the local Figma token."
              />
            </div>
            <div className="space-y-4">
              <Select
                label="Viewport"
                value={viewport}
                onChange={setViewport}
                options={[
                  ['1920', 'Desktop 1920px'],
                  ['1680', 'Desktop 1680px'],
                  ['1440', 'Desktop 1440px'],
                  ['1366', 'Laptop 1366px'],
                  ['1024', 'Tablet Landscape 1024px'],
                  ['810', 'Tablet Portrait 810px'],
                  ['425', 'Mobile 425px'],
                ]}
              />
              <Select label="Tolerance" value={tolerance} onChange={setTolerance} options={[['strict', 'Strict (0px)'], ['standard', 'Standard (2px)'], ['relaxed', 'Relaxed (4px)']]} />
              <Select label="Preset Framework" value={preset} onChange={setPreset} options={[['none', 'None'], ['tailwind', 'Tailwind CSS'], ['mui', 'Material UI'], ['bootstrap', 'Bootstrap']]} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  onClick={onRun}
                  disabled={isLoading || !figmaUrl || !pageUrl}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Start Comparison
                </button>
                <button
                  type="button"
                  onClick={onLoadSession}
                  disabled={isLoading}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  Load Session
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-6 pb-24">
      {report.designMatch && <DesignIdentityBanner designMatch={report.designMatch} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Summary label="Overall Match Score" value={`${report.overallScore}%`} tone={report.overallScore >= 90 ? 'good' : report.overallScore >= 70 ? 'warn' : 'bad'} />
        <Summary label="Components Found" value={report.summary.totalComponents} />
        <Summary label="Issues Found" value={report.summary.totalIssues} tone="warn" />
        <Summary label="Critical Failures" value={report.summary.failCount} tone="bad" />
      </div>

      {report.designMatch?.status === 'matched' && (
        <IssueBacklog
          report={report}
          issues={reportIssues}
          selectedMatch={selectedMatch}
          setSelectedMatch={setSelectedMatch}
          viewport={viewport}
          githubRepo={githubRepo}
          setGithubRepo={setGithubRepo}
          issueTemplate={issueTemplate}
          setIssueTemplate={setIssueTemplate}
          copyStatus={copyStatus}
          setCopyStatus={setCopyStatus}
        />
      )}

      {report.designMatch?.status !== 'matched' ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-800 shadow-sm dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100">
          <AlertCircle className="mx-auto mb-3 h-10 w-10" />
          <h3 className="text-lg font-semibold">Comparison did not start</h3>
          <p className="mx-auto mt-2 max-w-2xl text-sm opacity-85">
            Figma design file and target URL link are different, so the test was stopped before component comparison. Use the correct target URL or select the exact Figma frame/component and run the test again.
          </p>
        </div>
      ) : (
      <div className="grid min-h-[620px] grid-cols-1 gap-6 lg:grid-cols-12">
        <aside className="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-900/50 lg:col-span-3">
          <h3 className="px-2 pb-3 text-sm font-medium text-slate-800 dark:text-slate-200">Component Scans</h3>
          <div className="space-y-1">
            {report.matches.map((match, index) => (
              <button
                key={`${match.figmaNode.id}-${index}`}
                onClick={() => setSelectedMatch(match)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition',
                  selectedMatch === match ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200' : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/50',
                )}
              >
                <span className="truncate">{match.figmaNode.name}</span>
                <span className="font-mono text-xs text-slate-500">{Math.round(match.score)}%</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="rounded-xl border border-slate-200 bg-white/70 p-6 dark:border-slate-800 dark:bg-slate-950 lg:col-span-9">
          {!selectedMatch ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
              <FileJson className="h-12 w-12 opacity-40" />
              <p>Select a component to inspect.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{selectedMatch.figmaNode.name}</h2>
                  <p className="text-sm text-slate-500">{selectedMatch.figmaNode.type}</p>
                </div>
                <span className="rounded-full border border-slate-200 px-3 py-1 text-sm font-medium dark:border-slate-700">{Math.round(selectedMatch.score)}% affinity</span>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Preview title="Figma Image" src={selectedMatch.figmaNodeImage} fallback={<PlaceholderGenerator nodeName={selectedMatch.figmaNode.name} nodeType={selectedMatch.figmaNode.type} onPlaceholderGenerated={(url) => setSelectedMatch({ ...selectedMatch, figmaNodeImage: url })} />} />
                <Preview title="DOM Image" src={selectedMatch.domNodeImage} fallback={<div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400"><ImageIcon className="h-8 w-8" />No DOM image available</div>} />
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium dark:border-slate-800">Selected Component Issues</div>
                {selectedMatch.issues.length === 0 ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-emerald-500"><CheckCircle2 className="h-4 w-4" />No issues found.</div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {selectedMatch.issues.map((issue, index) => (
                      <div key={index} className="grid grid-cols-1 gap-3 p-4 text-sm md:grid-cols-[160px_1fr_1fr]">
                        <span className={cn('flex items-center gap-2 font-medium capitalize', severityTextClass(issue.severity))}><AlertCircle className="h-4 w-4" />{issue.severity} {issue.type}</span>
                        <div>
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Expected</div>
                          <div className="font-mono text-xs text-emerald-600 dark:text-emerald-400">{formatValue(issue.expected)}</div>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Actual</div>
                          <div className="font-mono text-xs text-rose-600 dark:text-rose-400">{formatValue(issue.actual)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  );
}

function DesignIdentityBanner({ designMatch }: { designMatch: NonNullable<QAReport['designMatch']> }) {
  const isMatched = designMatch.status === 'matched';
  const isMismatch = designMatch.status === 'mismatch';
  const toneClass = isMatched
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 shadow-emerald-900/5 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200'
    : isMismatch
      ? 'border-rose-200 bg-rose-50 text-rose-800 shadow-rose-900/5 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200'
      : 'border-amber-200 bg-amber-50 text-amber-800 shadow-amber-900/5 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200';

  return (
    <div className={cn('rounded-xl border p-5 shadow-sm', toneClass)}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-semibold">
            {isMatched ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
            <span>{designMatch.message}</span>
          </div>
          <p className="mt-1 text-sm opacity-85">{designMatch.reason}</p>
          <div className="mt-4 grid gap-3 text-xs md:grid-cols-4">
            <IdentitySignalPanel label="Check" values={[designMatch.checkName || 'Unique design identity check']} />
            <IdentitySignalPanel label="Matched signals" values={designMatch.matchedSignals} empty="No shared identity signal" />
            <IdentitySignalPanel label="Figma signals checked" values={designMatch.figmaSignals} empty="No unique Figma signal found" />
            <IdentitySignalPanel label="Target signals checked" values={designMatch.targetSignals} empty="No unique target signal found" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-semibold uppercase">{designMatch.status}</span>
          <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-semibold">{designMatch.score}%</span>
        </div>
      </div>
    </div>
  );
}

function IdentitySignalPanel({ label, values, empty = 'None' }: { label: string; values: string[]; empty?: string }) {
  return (
    <div className="rounded-lg border border-current/15 bg-white/35 p-3 dark:bg-slate-950/20">
      <div className="mb-2 font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {values.length ? values.slice(0, 5).map((value) => <span key={value} className="rounded-full bg-white/60 px-2 py-1 dark:bg-slate-950/40">{value}</span>) : <span className="opacity-70">{empty}</span>}
      </div>
    </div>
  );
}

function IssueBacklog({
  report,
  issues,
  selectedMatch,
  setSelectedMatch,
  viewport,
  githubRepo,
  setGithubRepo,
  issueTemplate,
  setIssueTemplate,
  copyStatus,
  setCopyStatus,
}: {
  report: QAReport;
  issues: ReportIssue[];
  selectedMatch: ComponentMatch | null;
  setSelectedMatch: (match: ComponentMatch | null) => void;
  viewport: string;
  githubRepo: string;
  setGithubRepo: (value: string) => void;
  issueTemplate: string;
  setIssueTemplate: (value: string) => void;
  copyStatus: string;
  setCopyStatus: (value: string) => void;
}) {
  const normalizedRepo = normalizeRepository(githubRepo);
  const repoIsValid = isValidRepository(githubRepo);
  const issueKeys = useMemo(() => issues.map(issueKey), [issues]);
  const [selectedIssueKeys, setSelectedIssueKeys] = useState<string[]>([]);
  const [previewIssue, setPreviewIssue] = useState<ReportIssue | null>(null);
  const [templateSetupOpen, setTemplateSetupOpen] = useState(true);
  const [githubLogStatus, setGithubLogStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [githubLoggingKey, setGithubLoggingKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const selectedIssueSet = useMemo(() => new Set(selectedIssueKeys), [selectedIssueKeys]);
  const selectedIssues = useMemo(() => issues.filter((reportIssue) => selectedIssueSet.has(issueKey(reportIssue))), [issues, selectedIssueSet]);
  const selectedCount = selectedIssues.length;

  useEffect(() => {
    setSelectedIssueKeys((current) => {
      const validCurrent = current.filter((key) => issueKeys.includes(key));
      return validCurrent.length > 0 ? validCurrent : issueKeys;
    });
  }, [issueKeys]);

  const handleRepoChange = (value: string) => {
    setGithubRepo(value);
    localStorage.setItem('designqa.githubRepo', value);
  };

  const handleTemplateChange = (value: string) => {
    setIssueTemplate(value);
    localStorage.setItem('designqa.issueTemplate', value);
  };

  const buildDraftFor = (reportIssue: ReportIssue) => {
    if (!repoIsValid) return null;
    return buildGitHubIssueDraft(report, reportIssue.match, normalizedRepo, issueTemplate, {
      issue: reportIssue.issue,
      issueIndex: reportIssue.issueIndex,
      viewport,
    });
  };

  const toggleIssue = (reportIssue: ReportIssue) => {
    const key = issueKey(reportIssue);
    setSelectedIssueKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const selectAllIssues = () => setSelectedIssueKeys(issueKeys);
  const clearSelectedIssues = () => setSelectedIssueKeys([]);

  const createGitHubIssues = async (targetIssues: ReportIssue[], statusKey: string) => {
    if (!repoIsValid || targetIssues.length === 0 || githubLoggingKey) return;
    const drafts = targetIssues
      .map((reportIssue) => buildDraftFor(reportIssue))
      .filter((draft): draft is NonNullable<ReturnType<typeof buildDraftFor>> => Boolean(draft))
      .map((draft) => ({ title: draft.title, body: draft.body }));

    setGithubLoggingKey(statusKey);
    setGithubLogStatus(null);

    try {
      const response = await fetch('/api/github/issues/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repository: normalizedRepo, githubToken, issues: drafts }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || 'GitHub issue logging failed');

      const allIssuesLogged = targetIssues.length === issues.length;
      setGithubLogStatus({
        tone: 'success',
        message: allIssuesLogged
          ? `All ${data.createdCount} issues have been logged into ${data.repository}.`
          : `${data.createdCount} issue${data.createdCount === 1 ? '' : 's'} logged into ${data.repository}.`,
      });
    } catch (error: any) {
      setGithubLogStatus({ tone: 'error', message: error.message || 'GitHub issue logging failed' });
    } finally {
      setGithubLoggingKey('');
    }
  };

  const copyIssue = async (reportIssue: ReportIssue) => {
    const draft = buildDraftFor(reportIssue);
    if (!draft) return;
    await navigator.clipboard.writeText(draft.body);
    setCopyStatus(`issue-${reportIssue.globalIndex}`);
    window.setTimeout(() => setCopyStatus(''), 1500);
  };

  const copyIssueLinks = async (targetIssues: ReportIssue[], statusKey: string) => {
    if (!repoIsValid || targetIssues.length === 0) return;
    const links = targetIssues
      .map((reportIssue) => {
        const draft = buildDraftFor(reportIssue);
        return draft ? `${reportIssue.globalIndex + 1}. ${draft.title}\n${draft.url}` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    await navigator.clipboard.writeText(links);
    setCopyStatus(statusKey);
    window.setTimeout(() => setCopyStatus(''), 1500);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white/70 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Issue Backlog
          </div>
          <p className="mt-1 text-sm text-slate-500">QA-ready issues generated from the comparison results.</p>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-[1fr_180px] lg:max-w-xl">
          <Field label="GitHub Repository" value={githubRepo} onChange={handleRepoChange} placeholder="owner/repository" invalid={githubRepo !== '' && !repoIsValid} />
          <Field label="Issue Template" value={issueTemplate} onChange={handleTemplateChange} placeholder={DEFAULT_TEMPLATE} />
          <div className="sm:col-span-2">
            <SecretField label="GitHub Token" value={githubToken} onChange={setGithubToken} placeholder="Uses .env or GitHub CLI if left blank" hint="Clears on refresh. Needs repo access with issues:write permission." />
          </div>
        </div>
      </div>

      {githubRepo !== '' && !repoIsValid && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400">
          Use the format owner/repository, for example ComputanTeam/client-name-project-name-template.
        </p>
      )}

      <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
        <button
          type="button"
          onClick={() => setTemplateSetupOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
            <Settings className="h-4 w-4 text-indigo-500" />
            GitHub Template Setup
          </span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-950 dark:text-slate-400">{issueTemplate || DEFAULT_TEMPLATE}</span>
        </button>
        {templateSetupOpen && (
          <div className="grid gap-3 border-t border-slate-200 px-3 py-3 dark:border-slate-800 md:grid-cols-2 xl:grid-cols-4">
            <TemplateField label="Template" value={issueTemplate || DEFAULT_TEMPLATE} />
            <TemplateField label="Issue Type" value="UI" />
            <TemplateField label="GitHub Type" value="Bug" />
            <TemplateField label="Title" value="[Page]: section - UI mismatch" />
            <TemplateField label="testing-url" value="Target page URL" />
            <TemplateField label="section" value="Detected Figma section" />
            <TemplateField label="actual-results" value="Detected DOM result" />
            <TemplateField label="expected-results" value="Expected Figma result" />
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Bulk GitHub Logging</div>
          <p className="mt-0.5 text-xs text-slate-500">{selectedCount} of {issues.length} issues selected for GitHub.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            onClick={selectAllIssues}
            disabled={issues.length === 0 || selectedCount === issues.length}
            className="flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            Select All
          </button>
          <button
            onClick={clearSelectedIssues}
            disabled={selectedCount === 0}
            className="flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <Square className="h-3.5 w-3.5" />
            Clear
          </button>
          <button
            onClick={() => createGitHubIssues(selectedIssues, 'selected')}
            disabled={!repoIsValid || selectedCount === 0 || Boolean(githubLoggingKey)}
            className="flex h-9 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-50"
          >
            {githubLoggingKey === 'selected' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
            {githubLoggingKey === 'selected' ? 'Logging...' : 'Log Selected Directly'}
          </button>
          <button
            onClick={() => createGitHubIssues(issues, 'all')}
            disabled={!repoIsValid || issues.length === 0 || Boolean(githubLoggingKey)}
            className="flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            {githubLoggingKey === 'all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
            {githubLoggingKey === 'all' ? 'Logging...' : 'Log All Directly'}
          </button>
          <button
            onClick={() => copyIssueLinks(selectedIssues, 'selected-issue-links')}
            disabled={!repoIsValid || selectedCount === 0}
            className="flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <Copy className="h-3.5 w-3.5" />
            {copyStatus === 'selected-issue-links' ? 'Copied' : 'Copy Links'}
          </button>
        </div>
      </div>

      {githubLogStatus && (
        <div className={cn('mb-4 rounded-lg border px-4 py-3 text-sm', githubLogStatus.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300')}>
          {githubLogStatus.message}
        </div>
      )}

      {issues.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          No QA issues were found in this run.
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map((reportIssue) => {
            const draftTitle = buildIssueTitle(reportIssue.match, reportIssue.issue, report.pageUrl);
            const isComponentSelected = selectedMatch === reportIssue.match;
            const key = issueKey(reportIssue);
            const isIssueSelected = selectedIssueSet.has(key);

            return (
              <article
                key={key}
                className={cn(
                  'rounded-lg border bg-white p-4 transition dark:bg-slate-900/70',
                  isComponentSelected ? 'border-indigo-300 shadow-sm shadow-indigo-500/10 dark:border-indigo-500/40' : 'border-slate-200 dark:border-slate-800',
                )}
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <button
                    type="button"
                    onClick={() => toggleIssue(reportIssue)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    aria-label={isIssueSelected ? 'Unselect issue' : 'Select issue'}
                  >
                    {isIssueSelected ? <CheckSquare className="h-4 w-4 text-indigo-500" /> : <Square className="h-4 w-4" />}
                  </button>
                  <button onClick={() => setSelectedMatch(reportIssue.match)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase', severityBadgeClass(reportIssue.issue.severity))}>
                        {reportIssue.issue.severity}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {reportIssue.issue.type}
                      </span>
                      <span className="text-xs text-slate-400">#{reportIssue.globalIndex + 1}</span>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{draftTitle}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Component: {reportIssue.match.figmaNode.name} | Score: {Math.round(reportIssue.match.score)}% | Property: {reportIssue.issue.property}
                    </p>
                  </button>

                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => setPreviewIssue(reportIssue)}
                      className="flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Preview
                    </button>
                    <button
                      onClick={() => createGitHubIssues([reportIssue], `issue-${reportIssue.globalIndex}`)}
                      disabled={!repoIsValid || Boolean(githubLoggingKey)}
                      className="flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                    >
                      {githubLoggingKey === `issue-${reportIssue.globalIndex}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
                      {githubLoggingKey === `issue-${reportIssue.globalIndex}` ? 'Logging...' : 'Log Issue'}
                    </button>
                    <button
                      onClick={() => copyIssue(reportIssue)}
                      disabled={!repoIsValid}
                      className="flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copyStatus === `issue-${reportIssue.globalIndex}` ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <IssueValue label="Expected" tone="expected" value={formatValue(reportIssue.issue.expected)} />
                  <IssueValue label="Actual" tone="actual" value={formatValue(reportIssue.issue.actual)} />
                </div>
              </article>
            );
          })}
        </div>
      )}

      {previewIssue && (
        <IssuePreviewDialog
          report={report}
          reportIssue={previewIssue}
          repository={repoIsValid ? normalizedRepo : 'owner/repository'}
          repoIsValid={repoIsValid}
          issueTemplate={issueTemplate}
          viewport={viewport}
          onClose={() => setPreviewIssue(null)}
          onOpen={() => createGitHubIssues([previewIssue], `issue-${previewIssue.globalIndex}`)}
          onCopy={() => copyIssue(previewIssue)}
          copied={copyStatus === `issue-${previewIssue.globalIndex}`}
          isLogging={githubLoggingKey === `issue-${previewIssue.globalIndex}`}
        />
      )}
    </section>
  );
}

function TemplateField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="break-words text-xs font-medium text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  );
}

function IssuePreviewDialog({
  report,
  reportIssue,
  repository,
  repoIsValid,
  issueTemplate,
  viewport,
  onClose,
  onOpen,
  onCopy,
  copied,
  isLogging,
}: {
  report: QAReport;
  reportIssue: ReportIssue;
  repository: string;
  repoIsValid: boolean;
  issueTemplate: string;
  viewport: string;
  onClose: () => void;
  onOpen: () => void;
  onCopy: () => void;
  copied: boolean;
  isLogging: boolean;
}) {
  const draft = buildGitHubIssueDraft(report, reportIssue.match, repository, issueTemplate, {
    issue: reportIssue.issue,
    issueIndex: reportIssue.issueIndex,
    viewport,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Github className="h-4 w-4" />
              GitHub Issue Preview
            </div>
            <h3 className="mt-2 break-words text-base font-semibold text-slate-900 dark:text-slate-100">{draft.title}</h3>
            <p className="mt-1 text-xs text-slate-500">
              Template: {issueTemplate || DEFAULT_TEMPLATE} | Repository: {repository}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid max-h-[calc(88vh-150px)] gap-4 overflow-y-auto p-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-3">
            <TemplateField label="issue-type" value="UI" />
            <TemplateField label="testing-url" value={report.pageUrl} />
            <TemplateField label="section" value={reportIssue.match.figmaNode.name} />
            <TemplateField label="device-name" value={viewport === '425' ? 'Mobile' : viewport === '810' || viewport === '1024' ? 'Tablet' : 'Desktop'} />
            <TemplateField label="browsers" value="Chrome" />
            <TemplateField label="actual-results" value={formatValue(reportIssue.issue.actual)} />
          </div>
          <pre className="min-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            {draft.body}
          </pre>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:justify-end">
          <button
            onClick={onCopy}
            disabled={!repoIsValid}
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <Copy className="h-4 w-4" />
            {copied ? 'Copied' : 'Copy Body'}
          </button>
          <button
            onClick={onOpen}
            disabled={!repoIsValid}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-50"
          >
            {isLogging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
            {isLogging ? 'Logging...' : 'Log This Issue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GitHubIssuePanel({
  report,
  selectedMatch,
  githubRepo,
  setGithubRepo,
  issueTemplate,
  setIssueTemplate,
  copyStatus,
  setCopyStatus,
}: {
  report: QAReport;
  selectedMatch: ComponentMatch;
  githubRepo: string;
  setGithubRepo: (value: string) => void;
  issueTemplate: string;
  setIssueTemplate: (value: string) => void;
  copyStatus: string;
  setCopyStatus: (value: string) => void;
}) {
  const normalizedRepo = normalizeRepository(githubRepo);
  const repoIsValid = isValidRepository(githubRepo);
  const issueDraft = useMemo(() => {
    if (!repoIsValid) return null;
    return buildGitHubIssueDraft(report, selectedMatch, normalizedRepo, issueTemplate);
  }, [issueTemplate, normalizedRepo, report, repoIsValid, selectedMatch]);

  const handleRepoChange = (value: string) => {
    setGithubRepo(value);
    localStorage.setItem('designqa.githubRepo', value);
  };

  const handleTemplateChange = (value: string) => {
    setIssueTemplate(value);
    localStorage.setItem('designqa.issueTemplate', value);
  };

  const handleOpenIssue = () => {
    if (!issueDraft) return;
    window.open(issueDraft.url, '_blank', 'noopener,noreferrer');
  };

  const handleCopy = async () => {
    if (!issueDraft) return;
    await navigator.clipboard.writeText(issueDraft.body);
    setCopyStatus('Copied');
    window.setTimeout(() => setCopyStatus(''), 1500);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-900/70">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Github className="h-4 w-4" />
            GitHub Issue
          </div>
          <p className="mt-1 text-xs text-slate-500">Open a prefilled QA issue in the target repository.</p>
        </div>
        {issueDraft && (
          <div className="max-w-full rounded-md bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300 md:max-w-md">
            {issueDraft.title}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">
        <Field label="Repository" value={githubRepo} onChange={handleRepoChange} placeholder="owner/repository" invalid={githubRepo !== '' && !repoIsValid} />
        <Field label="Template" value={issueTemplate} onChange={handleTemplateChange} placeholder="issue-form.yml" />
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          onClick={handleOpenIssue}
          disabled={!issueDraft}
          className="flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
        >
          <ExternalLink className="h-4 w-4" />
          Open GitHub Issue
        </button>
        <button
          onClick={handleCopy}
          disabled={!issueDraft}
          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          <Copy className="h-4 w-4" />
          {copyStatus || 'Copy QA Body'}
        </button>
      </div>

      {githubRepo !== '' && !repoIsValid && (
        <p className="mt-2 text-xs text-rose-500">Use the format owner/repository, for example ComputanTeam/client-name-project-name-template.</p>
      )}
    </div>
  );
}

function IssueValue({ label, value, tone }: { label: string; value: string; tone: 'expected' | 'actual' }) {
  return (
    <div className={cn('rounded-lg border p-3', tone === 'expected' ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-500/10' : 'border-rose-200 bg-rose-50/70 dark:border-rose-500/20 dark:bg-rose-500/10')}>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={cn('break-words font-mono text-xs leading-relaxed', tone === 'expected' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>{value}</div>
    </div>
  );
}

function severityBadgeClass(severity: Issue['severity']) {
  if (severity === 'high') return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
  if (severity === 'medium') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
  return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
}

function severityTextClass(severity: Issue['severity']) {
  if (severity === 'high') return 'text-rose-600 dark:text-rose-400';
  if (severity === 'medium') return 'text-amber-600 dark:text-amber-400';
  return 'text-blue-600 dark:text-blue-400';
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(response.ok ? 'Server returned an invalid JSON response.' : text);
  }
}

function Field({ label, value, onChange, placeholder, invalid }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; invalid?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn('w-full rounded-lg border bg-slate-50 px-4 py-2.5 text-sm text-slate-800 shadow-inner outline-none transition focus:ring-2 dark:bg-slate-950 dark:text-slate-200', invalid ? 'border-rose-500 focus:ring-rose-500/40' : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/40 dark:border-slate-800')}
      />
    </label>
  );
}

function SecretField({ label, value, onChange, placeholder, hint = 'Clears on refresh. Leave blank to use the local server token.' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string }) {
  const [show, setShow] = useState(false);

  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <div className="flex rounded-lg border border-slate-200 bg-slate-50 shadow-inner transition focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/40 dark:border-slate-800 dark:bg-slate-950">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-sm text-slate-800 outline-none dark:text-slate-200"
        />
        <button
          type="button"
          onClick={() => setShow((current) => !current)}
          className="border-l border-slate-200 px-3 text-xs font-medium text-slate-500 transition hover:text-slate-800 dark:border-slate-800 dark:hover:text-slate-200"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 shadow-inner outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
        {options.map(([optionValue, labelText]) => <option key={optionValue} value={optionValue}>{labelText}</option>)}
      </select>
    </label>
  );
}

function Summary({ label, value, tone = 'plain' }: { label: string; value: string | number; tone?: 'plain' | 'good' | 'warn' | 'bad' }) {
  const toneClass = tone === 'good' ? 'text-emerald-500' : tone === 'warn' ? 'text-amber-500' : tone === 'bad' ? 'text-rose-500' : 'text-slate-900 dark:text-slate-100';
  return (
    <div className="rounded-xl border border-slate-200 bg-white/60 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
      <div className="mb-1 text-sm font-medium text-slate-500">{label}</div>
      <div className={cn('text-3xl font-bold tracking-tight', toneClass)}>{value}</div>
    </div>
  );
}

function Preview({ title, src, fallback }: { title: string; src?: string; fallback: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</div>
      {src ? <img src={src} alt={title} className="h-64 w-full rounded object-contain" /> : fallback}
    </div>
  );
}
