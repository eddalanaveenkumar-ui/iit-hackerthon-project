import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  GraduationCap,
  History,
  Lightbulb,
  MessageSquare,
  Plus,
  Settings,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { cx } from './ui';
import { timeAgo } from '../lib/format';

/**
 * Primary navigation.
 *
 * The product is chat-first, so this is not a wall of links: one clear entry to
 * the conversation, a "Learning profile" group (classrooms + account), classroom
 * creation, and the chat archive. Recent conversations are listed inline under
 * Chat history so resuming one is a single click.
 */

const RECENT_LIMIT = 6;

export function SidebarContent({ onNavigate, user }) {
  const location = useLocation();
  const [recent, setRecent] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [error, setError] = useState('');

  const loadRecent = useCallback(async () => {
    try {
      const res = await api(`/tutor/sessions?limit=${RECENT_LIMIT}`);
      setRecent(res.sessions || []);
      setError('');
    } catch (e) {
      setError(e.message);
      setRecent([]);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // Reloading on navigation keeps the archive current after finishing a session.
  useEffect(() => {
    if (location.pathname === '/app' || location.pathname.startsWith('/app/tutor')) loadRecent();
  }, [location.pathname, loadRecent]);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <Link to="/app" onClick={onNavigate} className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <GraduationCap className="h-4.5 w-4.5" />
          </span>
          <span>
            <span className="block text-sm font-semibold leading-tight text-slate-900 dark:text-white">LearnMate</span>
            <span className="block text-[11px] leading-tight text-slate-500 dark:text-slate-400">Personalised learning</span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 pb-4">
        <div className="space-y-0.5">
          <SideLink to="/app" end icon={MessageSquare} label="Chat" onNavigate={onNavigate} />
          <SideLink to="/app/lesson" icon={Lightbulb} label="Interactive lesson" onNavigate={onNavigate} />
        </div>

        <Group label="Learning profile">
          <SideLink to="/app/classrooms" icon={Users} label="My classrooms" onNavigate={onNavigate} />
          <SideLink to="/app/settings" icon={Settings} label="Account settings" onNavigate={onNavigate} />
          {user?.name ? (
            <div className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0 truncate text-[11.5px] text-slate-500 dark:text-slate-400">{user.email}</span>
            </div>
          ) : null}
        </Group>

        <div className="space-y-0.5">
          <SideLink to="/app/classrooms/new" icon={Plus} label="Create classroom" onNavigate={onNavigate} />
        </div>

        <Group
          label="Chat history"
          action={
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              className="rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label={historyOpen ? 'Collapse chat history' : 'Expand chat history'}
            >
              <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', !historyOpen && '-rotate-90')} />
            </button>
          }
        >
          {historyOpen ? (
            <>
              {recent === null ? (
                <p className="px-3 py-1.5 text-[11px] text-slate-400">Loading…</p>
              ) : error ? (
                <p className="px-3 py-1.5 text-[11px] text-rose-500">{error}</p>
              ) : recent.length === 0 ? (
                <p className="px-3 py-1.5 text-[11px] text-slate-400">
                  No conversations yet. Type <code className="font-mono">/start</code> in the chat.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {recent.map((s) => (
                    <li key={s.id}>
                      <NavLink
                        to={`/app/tutor/${s.id}`}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cx(
                            'block rounded-lg px-3 py-1.5 transition-colors',
                            isActive
                              ? 'bg-brand-50 dark:bg-brand-950/50'
                              : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                          )
                        }
                      >
                        <span className="block truncate text-[12.5px] font-medium text-slate-700 dark:text-slate-200">
                          {s.concept?.name || 'Conversation'}
                        </span>
                        <span className="block truncate text-[10.5px] text-slate-400">
                          {s.classroom?.name ? `${s.classroom.name} · ` : ''}
                          {timeAgo(s.startedAt)}
                        </span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
              <SideLink to="/app/history" icon={History} label="View all history" onNavigate={onNavigate} muted />
            </>
          ) : null}
        </Group>
      </nav>
    </div>
  );
}

function Group({ label, action, children }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function SideLink({ to, icon: Icon, label, end, onNavigate, muted }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
          isActive
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
            : muted
              ? 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </NavLink>
  );
}

/** Fixed desktop rail. Hidden below lg, where Layout shows a drawer instead. */
export function Sidebar({ user }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-200 dark:border-slate-800 lg:block">
      <SidebarContent user={user} />
    </aside>
  );
}

/** Mobile drawer, opened from the header. */
export function SidebarDrawer({ open, onClose, user }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <aside className="absolute inset-y-0 left-0 w-72 border-r border-slate-200 shadow-xl dark:border-slate-800">
        <button onClick={onClose} className="btn-ghost absolute right-2 top-3 z-10 p-1.5" aria-label="Close navigation">
          <X className="h-4 w-4" />
        </button>
        <SidebarContent onNavigate={onClose} user={user} />
      </aside>
    </div>
  );
}
