import { Empty, Panel, Icon } from './shared';

/**
 * `timeline` — a chronological sequence (history, the stages of a process,
 * the evolution of a model). Vertical by default because that is the only
 * orientation that survives a narrow screen with real text in it.
 */
export default function TimelineRenderer({ component }) {
  const events = component.events || [];
  if (!events.length) return <Empty label="This timeline has no events." />;

  return (
    <Panel title={component.title || 'Timeline'} subtitle={component.description}>
      <ol className="relative space-y-3.5 border-l border-slate-200 pl-5 dark:border-slate-700">
        {events.map((event, index) => (
          <li key={index} className="relative">
            <span className="absolute -left-[26px] flex h-3 w-3 items-center justify-center rounded-full border-2 border-white bg-brand-500 dark:border-slate-900" aria-hidden />
            <div className="flex flex-wrap items-baseline gap-x-2">
              {event.date ? <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">{event.date}</span> : null}
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{event.label}</span>
              {event.icon ? <Icon name={event.icon} className="h-3.5 w-3.5 text-slate-400" /> : null}
            </div>
            {event.detail ? <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-300">{event.detail}</p> : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
