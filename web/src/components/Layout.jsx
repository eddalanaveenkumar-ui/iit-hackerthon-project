import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, GraduationCap, LogOut, Menu, Moon, Settings, ShieldCheck, Sun } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Avatar, cx } from './ui';
import { Sidebar, SidebarDrawer } from './Sidebar';

/**
 * App shell: persistent navigation rail plus a chat-width content column.
 *
 * The rail carries what a learner navigates to repeatedly — the conversation,
 * their learning profile (classrooms, account), classroom creation and the chat
 * archive. Commands inside the chat (`/start`, `/help`) remain for power users;
 * the sidebar means nobody has to memorise them.
 */

/** Pages that are not the chat get a back affordance instead of a menu. */
const SECONDARY = {
  '/app/classrooms': 'Classrooms',
  '/app/classrooms/new': 'New classroom',
  '/app/lesson': 'Lesson',
  '/app/tracs': 'tracs',
  '/app/practice': 'Practice',
  '/app/assessments': 'Assessments',
  '/app/progress': 'Progress',
  '/app/settings': 'Settings',
  '/app/history': 'Chat history',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMenu(false);
    setDrawer(false);
  }, [location.pathname]);

  const secondaryLabel =
    SECONDARY[location.pathname] ||
    (location.pathname.startsWith('/app/classrooms/') ? 'Classroom' : null) ||
    (location.pathname.startsWith('/app/admin') ? 'AI configuration' : null);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar user={user} />
      <SidebarDrawer open={drawer} onClose={() => setDrawer(false)} user={user} />

      <div className="flex min-h-screen flex-col lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-slate-50/85 backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/85">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-2 px-3 sm:px-4">
          <button
            onClick={() => setDrawer(true)}
            className="btn-ghost -ml-1 p-1.5 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/app" className="flex items-center gap-2 rounded-lg py-1 pr-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <GraduationCap className="h-4.5 w-4.5" />
            </span>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">LearnMate</span>
          </Link>

          {secondaryLabel ? (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="text-slate-300 dark:text-slate-600">/</span>
              <span className="font-medium text-slate-600 dark:text-slate-300">{secondaryLabel}</span>
            </span>
          ) : null}

          <div className="flex-1" />

          <button onClick={toggle} className="btn-ghost p-2" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div className="relative">
            <button
              onClick={() => setMenu((m) => !m)}
              className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Account menu"
            >
              <Avatar name={user?.name} color={user?.avatarColor} size={26} />
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>
            {menu ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop dark:border-slate-700 dark:bg-slate-900">
                  <div className="border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{user?.name}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
                  </div>
                  <MenuLink to="/app/classrooms" icon={GraduationCap} label="My classrooms" onDone={() => setMenu(false)} />
                  <MenuLink to="/app/settings" icon={Settings} label="Account settings" onDone={() => setMenu(false)} />
                  {user?.role === 'admin' ? (
                    <MenuLink to="/app/admin/ai" icon={ShieldCheck} label="AI configuration" onDone={() => setMenu(false)} />
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
        </div>
      </header>

        <main className={cx('mx-auto w-full flex-1 px-3 sm:px-4', isChat(location.pathname) ? 'max-w-4xl py-3' : 'max-w-[1200px] py-5')}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function isChat(pathname) {
  return pathname === '/app' || pathname === '/app/';
}

function MenuLink({ to, icon: Icon, label, onDone }) {
  return (
    <NavLink
      to={to}
      onClick={onDone}
      end={to === '/app'}
      className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}
