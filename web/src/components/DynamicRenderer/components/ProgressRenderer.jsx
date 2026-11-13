import { CheckCircle2, Circle, CircleDot, Clock } from 'lucide-react';
import { useDynamicActions } from '../DynamicContext';
import { BAR_TONE, Empty, Panel } from './shared';
import { cx } from '../../ui';

/**
 * `progress` and `teaching_workflow`.
 *
 * `progress` shows measured progress: either the server's `learning_progress`
 * for this lesson (preferred — it is the durable record) or the values the
 * author wrote into the document (used for "you are 2 of 3 sections in" style
 * summaries where no server state exists).
 *
 * `teaching_workflow` is the numbered teaching sequence itself, so a student can
 * see where in the lesson they are — the vertical timeline from the spec.
 */
export default function ProgressRenderer({ component }) {
  const { progress } = useDynamicActions();

  if (component.type === 'teaching_workflow') {
    return <Workflow component={component} />;
  }

  const items = component.items || [];
  if (!items.length) return <Empty label="No progress to show yet." />;

  const showPercent = component.show_percent !== false;

  return (
    <Panel title={component.title || 'Your progress'} subtitle={component.description}>
      <div className="space-y-3">
        {progress ? (
          <div className="rounded-lg bg-brand-50/70 px-3 py-2 dark:bg-brand-950/25">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-brand-900 dark:text-brand-200">This lesson</p>
              <p className="text-xs font-semibold text-brand-800 dark:text-brand-300">
                {progress.completedCount}/{progress.totalComponents || '—'} sections
              </p>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-900">
              <div className="h-full rounded-full bg-brand-600 dark:bg-brand-400" style={{ width: `${Math.min(100, progress.percent || 0)}%` }} />
            </div>
          </div>
        ) : null}

        <ul className="space-y-2.5">
          {items.map((item, index) => (
            <li key={item.id || index}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
                {showPercent ? <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{Math.round(item.value)}%</span> : null}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow={Math.round(item.value)} aria-valuemin={0} aria-valuemax={100} aria-label={item.label}>
                <div className={cx('h-full rounded-full transition-[width]', BAR_TONE[item.tone] || BAR_TONE.brand)} style={{ width: `${Math.max(0, Math.min(100, item.value))}%` }} />
              </div>
              {item.detail ? <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{item.detail}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function Workflow({ component }) {
  const steps = component.steps || [];
  if (!steps.length) return <Empty label="No workflow steps." />;

  const statusIcon = (status) => {
    if (status === 'done') return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="done" />;
    if (status === 'active') return <CircleDot className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-label="in progress" />;
    return <Circle className="h-4 w-4 text-slate-300 dark:text-slate-600" aria-label="not started" />;
  };

  return (
    <Panel title={component.title || 'Teaching workflow'} subtitle={component.description}>
      <ol className="relative space-y-3 border-l border-slate-200 pl-5 dark:border-slate-700">
        {steps.map((step, index) => (
          <li key={step.id || index} className="relative">
            <span className="absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full bg-white dark:bg-slate-900">{statusIcon(step.status)}</span>
            <p className={cx('text-sm font-medium', step.status === 'active' ? 'text-brand-700 dark:text-brand-300' : 'text-slate-800 dark:text-slate-100')}>
              <span className="mr-1.5 text-[11px] text-slate-400">{index + 1}.</span>
              {step.title}
            </p>
            {step.description ? <p className="text-xs text-slate-500 dark:text-slate-400">{step.description}</p> : null}
            {step.status === 'active' ? (
              <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">
                <Clock className="h-3 w-3" aria-hidden /> you are here
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
