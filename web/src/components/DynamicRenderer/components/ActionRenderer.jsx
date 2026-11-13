import { useState } from 'react';
import { ArrowRight, Bookmark, ClipboardCheck, Code2, Flag, Play, RotateCcw, Save, Sparkles } from 'lucide-react';
import { useDynamicActions } from '../DynamicContext';
import { sanitizeNavTarget } from '../utils/validateUI';
import { Empty, Panel } from './shared';
import { cx } from '../../ui';

/**
 * `actions` — the buttons that end a lesson.
 *
 * Every action maps to a host handler. Nothing here can reach the network by
 * itself, and `navigate` targets are validated against the internal allowlist.
 * Destructive-looking actions can carry a `confirm` sentence, which is shown
 * inline (not as a `window.confirm`) so it is styleable, translatable and
 * accessible.
 */

const ACTION_META = {
  continue_lesson: { label: 'Continue lesson', icon: ArrowRight, variant: 'primary' },
  next_step: { label: 'Next step', icon: ArrowRight, variant: 'primary' },
  start_assessment: { label: 'Start assessment', icon: ClipboardCheck, variant: 'secondary' },
  open_practice: { label: 'Open practice', icon: Code2, variant: 'secondary' },
  navigate: { label: 'Open', icon: ArrowRight, variant: 'secondary' },
  save_progress: { label: 'Save progress', icon: Save, variant: 'secondary' },
  submit_ai_questions: { label: 'Submit', icon: Sparkles, variant: 'primary' },
  submit_quiz: { label: 'Submit quiz', icon: Sparkles, variant: 'primary' },
  run_code: { label: 'Run', icon: Play, variant: 'primary' },
  reset_code: { label: 'Reset', icon: RotateCcw, variant: 'ghost' },
  show_hint: { label: 'Show hint', icon: Flag, variant: 'ghost' },
  bookmark: { label: 'Bookmark', icon: Bookmark, variant: 'ghost' },
};

const TONE_BUTTON = {
  brand: 'btn-primary',
  success: 'btn-primary',
  danger: 'btn-danger',
  neutral: 'btn-secondary',
  warning: 'btn-secondary',
  violet: 'btn-secondary',
  info: 'btn-secondary',
};

export default function ActionRenderer({ component }) {
  const { actions } = useDynamicActions();
  const [confirming, setConfirming] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [done, setDone] = useState(null);

  const run = async (action) => {
    if (busyId) return;
    if (action.confirm && confirming !== action.id) {
      setConfirming(action.id);
      return;
    }
    setConfirming(null);
    setBusyId(action.id);
    try {
      switch (action.action) {
        case 'continue_lesson':
        case 'next_step':
          await actions.continueLesson(action);
          break;
        case 'open_practice':
          actions.openPractice();
          break;
        case 'start_assessment':
          actions.startAssessment();
          break;
        case 'navigate': {
          const target = sanitizeNavTarget(action.target);
          if (target) actions.navigate(target);
          break;
        }
        case 'save_progress':
          await actions.markComplete(`action:${action.id}`);
          setDone(action.id);
          actions.notify?.('success', 'Progress saved');
          break;
        default:
          actions.notify?.('info', 'That action is handled inside its own section.');
      }
    } catch (e) {
      actions.notify?.('error', e.message || 'That action failed.');
    } finally {
      setBusyId(null);
    }
  };

  if (!component.actions?.length) return <Empty label="No follow-up actions." />;

  return (
    <Panel title={component.title || 'What next'} subtitle={component.subtitle}>
      <div className="flex flex-wrap items-center gap-2">
        {component.actions.map((action) => {
          const meta = ACTION_META[action.action] || ACTION_META.navigate;
          const IconComponent = meta.icon;
          const variant = action.tone ? TONE_BUTTON[action.tone] || 'btn-secondary' : meta.variant === 'primary' ? 'btn-primary' : 'btn-secondary';
          return (
            <div key={action.id} className="flex flex-col items-start gap-1">
              <button type="button" onClick={() => run(action)} className={cx(variant, 'btn-sm')} disabled={busyId === action.id}>
                <IconComponent className="h-3.5 w-3.5" aria-hidden />
                {done === action.id ? 'Saved' : action.label || meta.label}
              </button>
              {confirming === action.id ? (
                <span className="max-w-[240px] rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
                  {action.confirm} Press the button again to continue.
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
