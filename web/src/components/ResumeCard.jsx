import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Clock, PlayCircle } from 'lucide-react';
import { fetchResume } from '../lib/dynamicUi';
import { cx } from './ui';

/**
 * RESUME CARD
 * ===========
 *
 * `GET /api/learning/resume` existed but nothing called it, so a student who
 * closed a half-finished lesson had no way back to it except remembering the
 * topic and regenerating it. This surfaces the most recent lesson with its real
 * progress, and hides itself entirely when there is nothing to resume.
 *
 * It renders nothing on failure. A resume prompt is a convenience, never a
 * reason to show an error on the landing page.
 */
export default function ResumeCard({ className = '' }) {
  const [state, setState] = useState({ loading: true, lesson: null, progress: null, concept: null });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchResume().then((result) => {
      if (cancelled) return;
      setState({
        loading: false,
        lesson: result?.lesson || null,
        progress: result?.progress || null,
        concept: result?.concept || null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading || dismissed || !state.lesson) return null;

  const { lesson, progress, concept } = state;
  const percent = Math.round(progress?.percent || 0);
  const completed = progress?.status === 'completed' || percent >= 100;
  const title = concept?.name || lesson.document?.metadata?.topic || lesson.prompt || 'Your lesson';
  const topicLine = lesson.document?.metadata?.topic && lesson.document.metadata.topic !== title ? lesson.document.metadata.topic : '';

  return (
    <div
      className={cx(
        'group relative flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-800 dark:hover:bg-brand-950/20',
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
        {completed ? <BookOpen className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-medium uppercase tracking-wide text-slate-400">
          {completed ? 'Revisit' : 'Pick up where you left off'}
        </p>
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{title}</p>
        {topicLine ? <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{topicLine}</p> : null}
        {!completed && percent > 0 ? (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <span className="block h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{percent}%</span>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {lesson.createdAt ? (
          <span className="hidden items-center gap-1 text-[10.5px] text-slate-400 sm:flex">
            <Clock className="h-3 w-3" aria-hidden />
            {relativeDay(lesson.createdAt)}
          </span>
        ) : null}
        <Link
          to={`/app/lesson/${encodeURIComponent(lesson.lessonId)}`}
          className="btn-secondary btn-sm"
          aria-label={`Open ${title}`}
        >
          {completed ? 'Open' : 'Continue'}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-1 top-1 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-slate-500 focus:opacity-100 group-hover:opacity-100 dark:text-slate-600 dark:hover:text-slate-300"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

function relativeDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
