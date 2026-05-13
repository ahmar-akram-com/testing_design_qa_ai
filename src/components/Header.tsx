import { Activity, Bell, Moon, Sun, UserCircle } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

type AppView = 'home' | 'dashboard' | 'projects' | 'team' | 'profile' | 'notifications' | 'comparison';

export function Header({ activeView, onNavigate }: { activeView: AppView; onNavigate: (view: AppView) => void }) {
  const { theme, toggleTheme } = useTheme();
  const navClass = (view: AppView) =>
    activeView === view
      ? 'text-slate-900 dark:text-white'
      : 'text-slate-500 transition-colors hover:text-slate-950 dark:text-slate-400 dark:hover:text-white';

  return (
    <header className="h-16 border-b border-slate-200 bg-white/85 px-6 backdrop-blur-xl transition-colors dark:border-slate-800/50 dark:bg-slate-950/85">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between">
        <div className="flex items-center gap-6">
          <button className="flex items-center gap-3 text-left" onClick={() => onNavigate('home')}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-600 shadow-lg shadow-indigo-500/20">
              <Activity className="h-4 w-4 text-white" />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">Design QA</span>
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                System Operative
              </span>
            </span>
          </button>
          <nav className="flex items-center gap-3 text-sm font-medium text-slate-500 dark:text-slate-400 md:gap-4">
            <button onClick={() => onNavigate('dashboard')} className={navClass('dashboard')}>Dashboard</button>
            <button onClick={() => onNavigate('projects')} className={navClass('projects')}>Projects</button>
            <button onClick={() => onNavigate('team')} className={navClass('team')}>Team</button>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={toggleTheme} className="text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200" title="Toggle theme">
            {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </button>
          <button onClick={() => onNavigate('notifications')} className="relative text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200" title="Notifications">
            <Bell className="h-5 w-5" />
            <span className="absolute right-0 top-0 h-2 w-2 rounded-full border-2 border-white bg-indigo-500 dark:border-slate-950" />
          </button>
          <button onClick={() => onNavigate('profile')} className="text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200" title="Profile">
            <UserCircle className="h-6 w-6" />
          </button>
        </div>
      </div>
    </header>
  );
}
