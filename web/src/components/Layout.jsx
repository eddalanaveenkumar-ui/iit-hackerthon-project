import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  User,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Avatar, cx } from './ui';

const NAV = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/classrooms', label: 'My classrooms', icon: Users },
  { to: '/app/start', label: 'AI tutor', icon: Sparkles },
  { to: '/app/practice', label: 'Practice', icon: BookOpen },
  { to: '/app/assessments', label: 'Assessments', icon: BarChart3 },
  { to: '/app/progress', label: 'My progress', icon: GraduationCap },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [location.pathname]);

  const nav = useMemo(
    () => (user?.role === 'admin' ? [...NAV, { to: '/app/admin/ai', label: 'AI configuration', icon: ShieldCheck }] : NAV),
    [user?.role],
  );

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link to="/app" className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
          <GraduationCap className="h-5 w-5" />
        </span>
        <span>
          <span className="block text-sm font-semibold leading-tight text-slate-900 dark:text-white">LearnMate AI</span>
          <span className="block text-[11px] leading-tight text-slate-500 dark:text-slate-400">Personalised learning</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}

        <div className="px-3 pb-1 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Create</p>
        </div>
        <NavLink
          to="/app/classrooms/new"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New classroom
        </NavLink>
      </nav>

      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
          <Avatar name={user?.name} color={user?.avatarColor} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{user?.name}</p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {user?.role === 'admin' ? 'Platform admin' : 'Learner & classroom owner'}
            </p>
          </div>
          <Link to="/app/settings" className="btn-ghost p-1.5" aria-label="Settings">
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
        {sidebar}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl dark:bg-slate-900">
            <div className="flex justify-end p-2">
              <button className="btn-ghost p-1.5" onClick={() => setOpen(false)} aria-label="Close navigation">
                <X className="h-4 w-4" />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-6">
          <button className="btn-ghost -ml-1.5 p-1.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-500 dark:text-slate-400">
              {NAV.find((n) => n.to === location.pathname)?.label || 'LearnMate AI'}
            </p>
          </div>
          <button onClick={toggle} className="btn-ghost p-2" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Avatar name={user?.name} color={user?.avatarColor} size={28} />
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>
            {menu ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-pop dark:border-slate-700 dark:bg-slate-900">
                  <div className="border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{user?.name}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
                  </div>
                  <Link to="/app/settings" className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                    <User className="h-4 w-4" /> Account settings
                  </Link>
                  {user?.role === 'admin' ? (
                    <Link to="/app/admin/ai" className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                      <ShieldCheck className="h-4 w-4" /> AI configuration
                    </Link>
                  ) : null}
                  <button
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                    className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:border-slate-800 dark:hover:bg-rose-950/40"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
