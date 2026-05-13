import { type ComponentType, useEffect, useState } from 'react';
import { Activity, AlertCircle, Bell, CheckCircle2, Clock, Eye, FileSearch, FolderKanban, Gauge, Loader2, Monitor, ScanLine, UserCircle, Users, X } from 'lucide-react';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { QAWorkspace } from './components/QAWorkspace';
import type { ComponentMatch, QAReport } from './types';

type AppView = 'home' | 'dashboard' | 'projects' | 'team' | 'profile' | 'notifications' | 'comparison';

interface RunRecord {
  id: string;
  timestamp: string;
  pageUrl: string;
  figmaFileId: string;
  viewport: string;
  overallScore: number;
  totalIssues: number;
  totalComponents: number;
  matchedComponents?: number;
  failCount?: number;
  status: 'Completed' | 'Failed';
  issuePreview?: Array<{
    component: string;
    score: number;
    issueCount: number;
    issues: Array<{
      severity: string;
      type: string;
      property: string;
      expected: string;
      actual: string;
    }>;
  }>;
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
}

const demoProjects = [
  { name: 'Computan Marketing Site', client: 'Computan', status: 'Active QA', pages: 18, lastRun: 'Today' },
  { name: 'SaaS Dashboard Refresh', client: 'Internal Product', status: 'Design Review', pages: 9, lastRun: 'Yesterday' },
  { name: 'Ecommerce Landing Pages', client: 'Retail QA', status: 'Ready', pages: 24, lastRun: 'May 10, 2026' },
  { name: 'Healthcare Portal UI', client: 'Portal Team', status: 'Blocked', pages: 12, lastRun: 'May 8, 2026' },
];

const defaultTeam: TeamMember[] = [
  { id: 'qa-lead', name: 'Ayaan Malik', role: 'QC Lead' },
  { id: 'frontend-qa', name: 'Mira Shah', role: 'Frontend QA' },
  { id: 'design-reviewer', name: 'Noah Carter', role: 'Design Reviewer' },
  { id: 'project-owner', name: 'Sara Ahmed', role: 'Project Owner' },
];

export default function App() {
  const [figmaUrl, setFigmaUrl] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [viewport, setViewport] = useState('1440');
  const [tolerance, setTolerance] = useState('standard');
  const [preset, setPreset] = useState('none');
  const [figmaPageName, setFigmaPageName] = useState('');
  const [figmaNodeId, setFigmaNodeId] = useState('');
  const [figmaToken, setFigmaToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<QAReport | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<ComponentMatch | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [activeView, setActiveView] = useState<AppView>('home');
  const [runRecords, setRunRecords] = useState<RunRecord[]>(() => readJson<RunRecord[]>('designqa.runRecords', []));
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => readJson<TeamMember[]>('designqa.teamMembers', defaultTeam));

  const isFigmaUrlValid = figmaUrl === '' || /^https:\/\/(www\.)?figma\.com\//.test(figmaUrl);
  const isPageUrlValid = pageUrl === '' || /^https?:\/\//.test(pageUrl);
  const isRunDisabled = !figmaUrl.trim() || !pageUrl.trim() || !isFigmaUrlValid || !isPageUrlValid;
  const loadSession = () => window.location.reload();

  useEffect(() => {
    localStorage.removeItem('designqa.figmaToken');
  }, []);

  const runQA = async () => {
    if (isRunDisabled) {
      setShowConfig(true);
      window.setTimeout(() => document.getElementById('qa-config')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
      return;
    }
    setIsLoading(true);
    setErrorStatus(null);

    try {
      const healthCheck = await fetch('/api/health', { cache: 'no-store' });
      if (!healthCheck.ok) throw new Error('Server health check failed.');

      const response = await fetch('/api/qa/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ figmaUrl, pageUrl, viewport, tolerance, preset, figmaPageName, figmaNodeId, figmaToken }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Automation failed');

      setReport(data);
      setSelectedMatch(data.matches?.[0] ?? null);
      setActiveView('comparison');
      setRunRecords((current) => {
        const next = [recordFromReport(data, viewport), ...current.filter((item) => item.id !== data.id)].slice(0, 20);
        localStorage.setItem('designqa.runRecords', JSON.stringify(next));
        return next;
      });
    } catch (error: any) {
      setErrorStatus(error.message || 'Analysis failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 transition-colors selection:bg-indigo-500/30 dark:bg-slate-950 dark:text-slate-200">
      <div className="fixed inset-0 z-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 transition-opacity dark:opacity-20" />
      <div className="relative z-10 flex min-h-screen flex-col">
        <Header
          activeView={activeView}
          onNavigate={(view) => {
            setActiveView(view);
            if (view === 'home') {
              setReport(null);
              setSelectedMatch(null);
              setShowConfig(false);
            }
          }}
        />

        {activeView === 'home' && !report && !showConfig && <Hero onRun={() => { setShowConfig(true); setActiveView('comparison'); }} onLoadSession={loadSession} isLoading={isLoading} />}

        <main className="flex-1 pt-6 md:pt-10">
          {errorStatus && (
            <div className="mx-auto mb-6 max-w-5xl px-6">
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400">
                <h4 className="font-medium text-rose-800 dark:text-rose-300">Analysis Failed</h4>
                <p className="mt-1 text-sm opacity-90">{errorStatus}</p>
              </div>
            </div>
          )}

          {activeView === 'dashboard' && <DashboardView records={runRecords} currentReport={report} onOpenComparison={() => setActiveView('comparison')} />}
          {activeView === 'projects' && <ProjectsView />}
          {activeView === 'team' && <TeamView members={teamMembers} setMembers={setTeamMembers} />}
          {activeView === 'profile' && <ProfileView records={runRecords} />}
          {activeView === 'notifications' && <NotificationsView records={runRecords} />}

          {activeView === 'comparison' && (showConfig || report) && (
            <div id="qa-config">
              <QAWorkspace
                report={report}
                selectedMatch={selectedMatch}
                setSelectedMatch={setSelectedMatch}
                figmaUrl={figmaUrl}
                setFigmaUrl={setFigmaUrl}
                pageUrl={pageUrl}
                setPageUrl={setPageUrl}
                figmaPageName={figmaPageName}
                setFigmaPageName={setFigmaPageName}
                figmaNodeId={figmaNodeId}
                setFigmaNodeId={setFigmaNodeId}
                figmaToken={figmaToken}
                setFigmaToken={setFigmaToken}
                viewport={viewport}
                setViewport={setViewport}
                tolerance={tolerance}
                setTolerance={setTolerance}
                preset={preset}
                setPreset={setPreset}
                onRun={runQA}
                onLoadSession={loadSession}
                isLoading={isLoading}
              />
            </div>
          )}
        </main>
      </div>
      <AnalysisLoadingOverlay show={isLoading} />
    </div>
  );
}

function DashboardView({ records, currentReport, onOpenComparison }: { records: RunRecord[]; currentReport: QAReport | null; onOpenComparison: () => void }) {
  const [previewRecord, setPreviewRecord] = useState<RunRecord | null>(null);
  const latest = records[0];
  const averageScore = records.length ? Math.round(records.reduce((total, item) => total + item.overallScore, 0) / records.length) : 0;
  const issueTotal = records.reduce((total, item) => total + item.totalIssues, 0);

  return (
    <section className="mx-auto w-full max-w-7xl space-y-6 px-6 pb-24">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <DashboardStat label="Recorded Runs" value={records.length} icon={Activity} />
        <DashboardStat label="Average Score" value={records.length ? `${averageScore}%` : '-'} icon={Gauge} />
        <DashboardStat label="Logged Issues" value={issueTotal} icon={AlertCircle} />
        <DashboardStat label="Latest Viewport" value={latest?.viewport ? `${latest.viewport}px` : '-'} icon={Monitor} />
      </div>

      {currentReport && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Current comparison result</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{currentReport.pageUrl}</p>
            </div>
            <button onClick={onOpenComparison} className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-500">Open Result</button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white/70 p-5 dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Run Records</h2>
          <span className="text-xs font-medium text-slate-500">Last {Math.min(records.length, 20)} sessions</span>
        </div>
        {records.length === 0 ? (
          <EmptyState icon={Clock} title="No comparison records yet" text="Completed comparison runs will appear here automatically." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <div className="grid grid-cols-[1.3fr_80px_80px_80px_120px_150px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              <span>Page</span>
              <span>Score</span>
              <span>Issues</span>
              <span>Viewport</span>
              <span>Recorded</span>
              <span>Preview</span>
            </div>
            {records.map((record) => (
              <div key={record.id} className="grid grid-cols-[1.3fr_80px_80px_80px_120px_150px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 dark:border-slate-800">
                <span className="truncate text-slate-800 dark:text-slate-200">{record.pageUrl}</span>
                <span className={scoreClass(record.overallScore)}>{record.overallScore}%</span>
                <span>{record.totalIssues}</span>
                <span>{record.viewport}px</span>
                <span className="text-xs text-slate-500">{formatDate(record.timestamp)}</span>
                <button onClick={() => setPreviewRecord(record)} className="flex h-8 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                  <Eye className="h-3.5 w-3.5" />
                  Preview Results
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {previewRecord && <RunRecordPreviewDialog record={previewRecord} onClose={() => setPreviewRecord(null)} />}
    </section>
  );
}

function RunRecordPreviewDialog({ record, onClose }: { record: RunRecord; onClose: () => void }) {
  const previewItems = record.issuePreview || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Preview Results</h2>
            <p className="mt-1 text-sm text-slate-500">{record.pageUrl}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900" aria-label="Close preview">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(88vh-80px)] overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <DashboardStat label="Overall Score" value={`${record.overallScore}%`} icon={Gauge} />
            <DashboardStat label="Issues" value={record.totalIssues} icon={AlertCircle} />
            <DashboardStat label="Components" value={record.totalComponents} icon={Activity} />
            <DashboardStat label="Failed" value={record.failCount ?? '-'} icon={Clock} />
            <DashboardStat label="Viewport" value={`${record.viewport}px`} icon={Monitor} />
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800">
            <div className="grid gap-2 md:grid-cols-2">
              <ProjectMeta label="Figma File" value={record.figmaFileId} />
              <ProjectMeta label="Recorded" value={formatDate(record.timestamp)} />
              <ProjectMeta label="Matched Components" value={(record.matchedComponents ?? '-').toString()} />
              <ProjectMeta label="Status" value={record.status} />
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {previewItems.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="No issue details saved" text="Older records may only include the main run summary." />
            ) : (
              previewItems.map((item) => (
                <article key={`${record.id}-${item.component}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{item.component}</h3>
                    <span className={scoreClass(item.score)}>{item.score}%</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {item.issues.map((issue, index) => (
                      <div key={`${issue.property}-${index}`} className="rounded border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
                        <div className="mb-1 font-semibold capitalize text-slate-800 dark:text-slate-200">{issue.severity} {issue.type} - {issue.property}</div>
                        <div className="text-emerald-600 dark:text-emerald-400">Expected: {issue.expected}</div>
                        <div className="mt-1 text-rose-600 dark:text-rose-400">Actual: {issue.actual}</div>
                      </div>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectsView() {
  return (
    <section className="mx-auto w-full max-w-7xl space-y-6 px-6 pb-24">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Projects</h1>
        <p className="mt-1 text-sm text-slate-500">Dummy project list for local QA tracking.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {demoProjects.map((project) => (
          <article key={project.name} className="rounded-xl border border-slate-200 bg-white/70 p-5 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
              <FolderKanban className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{project.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{project.client}</p>
            <div className="mt-4 space-y-2 text-sm">
              <ProjectMeta label="Status" value={project.status} />
              <ProjectMeta label="Pages" value={project.pages.toString()} />
              <ProjectMeta label="Last Run" value={project.lastRun} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TeamView({ members, setMembers }: { members: TeamMember[]; setMembers: (members: TeamMember[]) => void }) {
  const updateMember = (id: string, key: keyof TeamMember, value: string) => {
    const next = members.map((member) => (member.id === id ? { ...member, [key]: value } : member));
    setMembers(next);
    localStorage.setItem('designqa.teamMembers', JSON.stringify(next));
  };

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6 px-6 pb-24">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Team</h1>
        <p className="mt-1 text-sm text-slate-500">Unique local team names can be edited and reused later.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {members.map((member) => (
          <article key={member.id} className="rounded-xl border border-slate-200 bg-white/70 p-5 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Users className="h-5 w-5" />
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-500">Name</span>
              <input value={member.name} onChange={(event) => updateMember(member.id, 'name', event.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-800 dark:bg-slate-900" />
            </label>
            <label className="mt-3 block space-y-1.5">
              <span className="text-xs font-medium text-slate-500">Role</span>
              <input value={member.role} onChange={(event) => updateMember(member.id, 'role', event.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-800 dark:bg-slate-900" />
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProfileView({ records }: { records: RunRecord[] }) {
  return (
    <section className="mx-auto w-full max-w-5xl space-y-6 px-6 pb-24">
      <div className="rounded-xl border border-slate-200 bg-white/70 p-6 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-950">
            <UserCircle className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Local QA Operator</h1>
            <p className="mt-1 text-sm text-slate-500">DesignQA-AI local workspace profile</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <DashboardStat label="Runs Completed" value={records.length} icon={CheckCircle2} />
          <DashboardStat label="Saved Projects" value={demoProjects.length} icon={FolderKanban} />
          <DashboardStat label="Workspace" value="Local" icon={Monitor} />
        </div>
      </div>
    </section>
  );
}

function NotificationsView({ records }: { records: RunRecord[] }) {
  const notifications = records.length
    ? records.slice(0, 6).map((record) => ({ id: record.id, title: 'Comparison completed', text: `${record.totalIssues} issues found on ${record.pageUrl}`, time: formatDate(record.timestamp) }))
    : [{ id: 'welcome', title: 'Dashboard ready', text: 'Run a comparison to start collecting QA records.', time: 'Now' }];

  return (
    <section className="mx-auto w-full max-w-4xl space-y-6 px-6 pb-24">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Notifications</h1>
        <p className="mt-1 text-sm text-slate-500">Recent QA activity and workflow updates.</p>
      </div>
      <div className="space-y-3">
        {notifications.map((notification) => (
          <article key={notification.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
              <Bell className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{notification.title}</h2>
              <p className="mt-1 truncate text-sm text-slate-500">{notification.text}</p>
              <p className="mt-2 text-xs text-slate-400">{notification.time}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AnalysisLoadingOverlay({ show }: { show: boolean }) {
  const steps = [
    { label: 'Reading Figma frames', icon: FileSearch },
    { label: 'Capturing target page', icon: Monitor },
    { label: 'Matching components', icon: ScanLine },
    { label: 'Preparing QA report', icon: CheckCircle2 },
  ];
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (!show) {
      setActiveStep(0);
      return;
    }

    const timer = window.setInterval(() => {
      setActiveStep((current) => Math.min(current + 1, steps.length - 1));
    }, 3500);

    return () => window.clearInterval(timer);
  }, [show, steps.length]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white p-6 shadow-2xl dark:bg-slate-950">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Analyzing comparison</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your Figma design and target page are being reviewed. Results will appear shortly.</p>
          </div>
        </div>

        <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full bg-indigo-600 transition-all duration-700" style={{ width: `${((activeStep + 1) / steps.length) * 100}%` }} />
        </div>

        <div className="mt-6 grid gap-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = index === activeStep;
            const isDone = index < activeStep;
            const isWaiting = index > activeStep;

            return (
              <div
                key={step.label}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                  isActive
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200'
                    : isDone
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : 'border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400'
                }`}
              >
                <Icon className={`h-4 w-4 ${isDone ? 'text-emerald-500' : ''}`} />
                <span className="font-medium">{step.label}</span>
                {isActive && <span className="ml-auto text-xs">In progress</span>}
                {isDone && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-500" />}
                {isWaiting && <span className="ml-auto h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-700" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DashboardStat({ label, value, icon: Icon }: { label: string; value: string | number; icon: ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 p-5 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, text }: { icon: ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
      <Icon className="h-10 w-10 text-slate-300 dark:text-slate-700" />
      <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  );
}

function ProjectMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function recordFromReport(report: QAReport, viewport: string): RunRecord {
  return {
    id: report.id,
    timestamp: report.timestamp,
    pageUrl: report.pageUrl,
    figmaFileId: report.figmaFileId,
    viewport,
    overallScore: Math.round(report.overallScore),
    totalIssues: report.summary.totalIssues,
    totalComponents: report.summary.totalComponents,
    matchedComponents: report.summary.matchedComponents,
    failCount: report.summary.failCount,
    status: 'Completed',
    issuePreview: report.matches
      .filter((match) => match.issues.length > 0)
      .slice(0, 25)
      .map((match) => ({
        component: match.figmaNode.name,
        score: Math.round(match.score),
        issueCount: match.issues.length,
        issues: match.issues.slice(0, 5).map((issue) => ({
          severity: issue.severity,
          type: issue.type,
          property: issue.property,
          expected: previewValue(issue.expected),
          actual: previewValue(issue.actual),
        })),
      })),
  };
}

function scoreClass(score: number) {
  if (score >= 90) return 'font-semibold text-emerald-600 dark:text-emerald-400';
  if (score >= 70) return 'font-semibold text-amber-600 dark:text-amber-400';
  return 'font-semibold text-rose-600 dark:text-rose-400';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function previewValue(value: unknown) {
  if (value === null || value === undefined) return 'Not available';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
