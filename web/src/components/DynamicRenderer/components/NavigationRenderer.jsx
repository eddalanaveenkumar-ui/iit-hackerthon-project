import { ArrowRight, BookOpen, ClipboardCheck, Code2, Compass } from 'lucide-react';
import { useDynamicActions } from '../DynamicContext';
import { sanitizeNavTarget } from '../utils/validateUI';
import { Empty, Panel } from './shared';
import NavigationGroups from './NavigationGroups';
import { cx } from '../../ui';

/**
 * `navigation` — wayfinding between lesson sections or app surfaces.
 *
 * The action vocabulary is closed and every handler comes from the host page.
 * `navigate` targets are re-checked against the internal allowlist here, so a
 * model cannot send the learner to `https://…` by writing it into a target
 * field.
 */

const ACTION_ICON = {
  navigate: Compass,
  continue_lesson: ArrowRight,
  next_step: ArrowRight,
  start_assessment: ClipboardCheck,
  open_practice: Code2,
};

export default function NavigationRenderer({ component }) {
  const { actions } = useDynamicActions();

  // The presentation shape (`components: [carousel | popover]`) is not
  // wayfinding — it cannot act — so it takes a separate path.
  if (Array.isArray(component.components) && component.components.length) {
    return <NavigationGroups component={component} />;
  }

  const run = (item) => {
    switch (item.action) {
      case 'navigate': {
        const target = sanitizeNavTarget(item.target);
        if (target) actions.navigate(target);
        break;
      }
      case 'continue_lesson':
        actions.continueLesson();
        break;
      case 'next_step':
        actions.continueLesson();
        break;
      case 'start_assessment':
        actions.startAssessment();
        break;
      case 'open_practice':
        actions.openPractice();
        break;
      default:
        break;
    }
  };

  if (!component.items?.length) return <Empty label="No navigation options." />;

  const horizontal = component.orientation !== 'vertical';

  return (
    <Panel title={component.title} subtitle={component.subtitle}>
      <nav aria-label={component.title || 'Lesson navigation'}>
        <ul className={cx(horizontal ? 'flex flex-wrap gap-2' : 'space-y-1.5')}>
          {component.items.map((item) => {
            const IconComponent = ACTION_ICON[item.action] || BookOpen;
            return (
              <li key={item.id}>
                <button type="button" onClick={() => run(item)} className="chip w-full justify-between text-left sm:w-auto">
                  <span className="flex items-center gap-1.5">
                    <IconComponent className="h-3.5 w-3.5" aria-hidden />
                    {item.label}
                  </span>
                  <ArrowRight className="h-3 w-3 text-slate-300 group-hover:text-brand-500" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </Panel>
  );
}
