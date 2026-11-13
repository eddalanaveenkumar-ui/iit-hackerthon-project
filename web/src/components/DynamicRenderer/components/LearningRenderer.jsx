import { BookOpen, Lightbulb, Target } from 'lucide-react';
import { Body, Empty, Panel, WIDTH_CLASS } from './shared';

/**
 * `learning` — the pedagogical envelope of a tutorial.
 *
 * Objectives, an optional real-world analogy, optional sections, key points and
 * a summary. This is one component rather than five `card`s because it is
 * semantically one thing: the lesson's framing. Screen readers get it as a
 * single section with a normal heading hierarchy.
 */
export default function LearningRenderer({ component }) {
  const width = WIDTH_CLASS[component.style?.width] || 'w-full';
  const hasAnything =
    component.objectives?.length || component.analogy || component.sections?.length || component.key_points?.length || component.summary;
  if (!hasAnything) return <Empty label="This lesson summary has no content." />;

  return (
    <Panel title={component.title} subtitle={component.subtitle} icon={component.style?.icon || 'book'} className={width}>
      <div className="space-y-3.5">
        {component.objectives?.length ? (
          <section aria-label="Learning objectives">
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Target className="h-3.5 w-3.5" aria-hidden /> By the end of this you can
            </h4>
            <ul className="space-y-1">
              {component.objectives.map((objective, index) => (
                <li key={index} className="flex items-start gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                  <span>{objective}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {component.analogy ? (
          <aside className="rounded-lg border border-violet-200 bg-violet-50/70 p-2.5 dark:border-violet-900 dark:bg-violet-950/25" aria-label="Real-world analogy">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Think of it like this
            </p>
            <Body>{component.analogy}</Body>
          </aside>
        ) : null}

        {component.sections?.map((section, index) => (
          <section key={index}>
            <h4 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{section.heading}</h4>
            <Body>{section.body}</Body>
          </section>
        ))}

        {component.key_points?.length ? (
          <section aria-label="Key points">
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <BookOpen className="h-3.5 w-3.5" aria-hidden /> Keep these
            </h4>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {component.key_points.map((point, index) => (
                <li key={index} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                  {point}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {component.summary ? (
          <div className="border-t border-slate-100 pt-2.5 dark:border-slate-800">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Summary</p>
            <Body>{component.summary}</Body>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
