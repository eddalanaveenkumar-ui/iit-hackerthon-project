import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Brain,
  ClipboardList,
  Clock,
  GraduationCap,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Avatar, Badge, ErrorBanner, LoadingBlock, ProgressBar, StatCard, cx } from '../components/ui';
import { categoryLabels, categoryStyles, coverStyle, levelStyles, roleLabels, roleStyles, timeAgo } from '../lib/format';

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <LoadingBlock rows={5} />;

  const { counts, classrooms, learning, pendingAssessments } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Welcome back, {user?.name?.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {counts.classrooms} classrooms · {counts.owned} owned · {counts.teaching} teaching roles
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/app/classrooms/new" className="btn-secondary">
            <Plus className="h-4 w-4" /> New classroom
          </Link>
          <Link to="/app/start" className="btn-primary">
            <Sparkles className="h-4 w-4" /> Start learning
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Learning sessions" value={learning.totalSessions} sub={`${learning.totalMinutes} minutes studied`} icon={BookOpen} />
        <StatCard
          label="Assessment average"
          value={learning.averageAssessment === null ? '—' : `${learning.averageAssessment}%`}
          sub={`${learning.assessmentsTaken} assessments taken`}
          icon={Target}
          tone="success"
        />
        <StatCard label="Classrooms" value={counts.classrooms} sub={`${counts.owned} created · ${counts.teaching} teaching`} icon={Users} tone="violet" />
        <StatCard
          label="Requests to review"
          value={counts.requestsToReview}
          sub={counts.pendingJoinRequests ? `${counts.pendingJoinRequests} of your joins pending` : 'No pending join requests'}
          icon={ClipboardList}
          tone={counts.requestsToReview ? 'warning' : 'brand'}
        />
      </div>

      {pendingAssessments.length ? (
        <div className="card card-pad border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                <Target className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  The AI recommends {pendingAssessments.length} assessment{pendingAssessments.length > 1 ? 's' : ''}
                </p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                  {pendingAssessments[0].reason || 'Repeated difficulty detected — a short check will give us clean evidence.'}
                </p>
              </div>
            </div>
            <Link to="/app/assessments" className="btn-secondary btn-sm shrink-0">
              Review <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">My classrooms</h2>
          <Link to="/app/classrooms" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            View all
          </Link>
        </div>
        {classrooms.length === 0 ? (
          <div className="card card-pad text-center">
            <p className="text-sm text-slate-600 dark:text-slate-300">You are not in any classroom yet.</p>
            <div className="mt-3 flex justify-center gap-2">
              <Link to="/app/classrooms/new" className="btn-primary btn-sm">
                Create a classroom
              </Link>
              <Link to="/app/classrooms" className="btn-secondary btn-sm">
                Join with a classroom ID
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {classrooms.map((c) => (
              <Link key={c.id} to={`/app/classrooms/${c.id}`} className="card group overflow-hidden transition-shadow hover:shadow-pop">
                <div className="h-20" style={coverStyle(c.coverImage)} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">{c.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{c.subject}</p>
                    </div>
                    <span className={cx('badge shrink-0', roleStyles[c.myRole])}>{roleLabels[c.myRole]}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Mastery</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{c.mastery === null ? 'Not started' : `${c.mastery}%`}</span>
                  </div>
                  <ProgressBar value={c.mastery || 0} className="mt-1.5" tone={c.mastery >= 70 ? 'success' : c.mastery >= 40 ? 'brand' : 'warning'} />
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span className={cx('badge', levelStyles[c.knowledgeLevel] || levelStyles.not_started)}>
                      {c.knowledgeLevel?.replace('_', ' ')}
                    </span>
                    <span>{c.openWeaknesses} open gaps</span>
                    <span>{timeAgo(c.lastActivityAt)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card card-pad">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Recent learning</h2>
          </div>
          {learning.recentTopics.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No sessions yet. Start with the AI tutor.</p>
          ) : (
            <ul className="space-y-2.5">
              {learning.recentTopics.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800 dark:text-slate-100">{t.concept}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {t.classroom} · {t.mode}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(t.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card card-pad">
          <div className="mb-3 flex items-center gap-2">
            <Brain className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Detected weaknesses</h2>
          </div>
          {learning.weaknesses.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No open weaknesses. Keep practising to build evidence.</p>
          ) : (
            <ul className="space-y-2.5">
              {learning.weaknesses.slice(0, 6).map((w) => (
                <li key={w.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className={cx('badge border', categoryStyles[w.category])}>{categoryLabels[w.category]}</span>
                    <span className="truncate text-xs text-slate-400">{w.classroom}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{w.description}</p>
                </li>
              ))}
            </ul>
          )}
          <Link to="/app/progress" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
            Full progress view <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="card card-pad">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Activity</h2>
        </div>
        {learning.activity.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Your learning activity will appear here.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-slate-200 pl-4 dark:border-slate-800">
            {learning.activity.slice(0, 8).map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white dark:ring-slate-900" />
                <p className="text-sm text-slate-700 dark:text-slate-200">{a.title}</p>
                <p className="text-[11px] text-slate-400">
                  {a.classroom} · {timeAgo(a.at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
