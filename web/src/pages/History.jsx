import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, History, MessageSquare, PlayCircle } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBanner, LoadingBlock, cx } from '../components/ui';
import { timeAgo } from '../lib/format';

const PAGE = 20;

/**
 * The chat archive.
 *
 * Sessions are never deleted, so this is a complete history rather than a feed.
 * Grouped by day to make a long list readable, and paginated by keyset cursor so
 * it stays cheap as the archive grows.
 */
export default function HistoryPage() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);

  const load = useCallback(async (before) => {
    const path = `/tutor/sessions?limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const res = await api(path);
    return res;
  }, []);

  useEffect(() => {
    load()
      .then((res) => {
        setSessions(res.sessions || []);
        setHasMore(Boolean(res.hasMore));
        setCursor(res.nextBefore);
      })
      .catch((e) => setError(e.message));
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await load(cursor);
      setSessions((s) => [...(s || []), ...(res.sessions || [])]);
      setHasMore(Boolean(res.hasMore));
      setCursor(res.nextBefore);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  if (error && !sessions) return <ErrorBanner message={error} />;
  if (sessions === null) return <LoadingBlock rows={6} />;

  const groups = groupByDay(sessions);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          <History className="h-4.5 w-4.5 text-slate-400" />
          Chat history
        </h1>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {sessions.length}
          {hasMore ? '+' : ''} conversation{sessions.length === 1 ? '' : 's'} across all your classrooms. Nothing is deleted — starting a new
          session keeps the old ones.
        </p>
      </header>

      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}

      {sessions.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No conversations yet"
          description="Open the chat and type /start to begin your first session."
          action={
            <Link to="/app" className="btn-primary btn-sm">
              Go to chat
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map(([label, items]) => (
            <section key={label}>
              <h2 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {label}
              </h2>
              <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                {items.map((s) => (
                  <li key={s.id} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                    <Link
                      to={`/app/tutor/${s.id}`}
                      className="flex items-start gap-3 px-3.5 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <MessageSquare className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">
                            {s.concept?.name || 'Conversation'}
                          </p>
                          {s.status === 'active' ? (
                            <Badge tone="success">
                              <PlayCircle className="h-2.5 w-2.5" /> active
                            </Badge>
                          ) : null}
                          <Badge tone="neutral">{s.modeLabel}</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {s.classroom?.name || 'Unknown classroom'} · {timeAgo(s.startedAt)} · {s.messageCount} message
                          {s.messageCount === 1 ? '' : 's'}
                        </p>
                        {s.preview ? (
                          <p className="mt-1 line-clamp-1 text-[11.5px] italic text-slate-400 dark:text-slate-500">{s.preview}</p>
                        ) : null}
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {hasMore ? (
            <div className="flex justify-center pb-2">
              <button onClick={loadMore} disabled={loadingMore} className="btn-secondary btn-sm">
                {loadingMore ? 'Loading…' : 'Load older conversations'}
              </button>
            </div>
          ) : (
            <p className={cx('pb-2 text-center text-[11px] text-slate-400')}>End of history</p>
          )}
        </div>
      )}
    </div>
  );
}

const dayKey = (date) => {
  const d = new Date(date);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  if (days < 30) return 'Earlier this month';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

function groupByDay(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = dayKey(s.startedAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.entries()];
}
