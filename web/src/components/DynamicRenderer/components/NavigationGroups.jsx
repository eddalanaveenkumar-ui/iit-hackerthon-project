import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Empty, Icon, Panel } from './shared';
import { cx } from '../../ui';

/**
 * `carousel` and `popover` — the presentation half of navigation
 * ==============================================================
 *
 * Neither of these can navigate. A carousel advances its own slides and a
 * popover opens its own list; both are local state. That is deliberate: the
 * wayfinding `navigation` component is the only thing whose items carry
 * actions, and those actions are checked against an allowlist before they run.
 * A model therefore cannot use a carousel to make the app go somewhere.
 *
 * Both are keyboard-operable and announce their state, so they are usable
 * without a mouse and without sight.
 */

export function Carousel({ item }) {
  const slides = item.items || [];
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!slides.length) return <Empty label="This carousel has no slides." />;

  const safeIndex = Math.min(index, slides.length - 1);
  const slide = slides[safeIndex];
  const many = slides.length > 1;

  const go = (delta) => {
    setIndex((current) => {
      const next = current + delta;
      if (next < 0) return slides.length - 1;
      if (next >= slides.length) return 0;
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700" role="group" aria-roledescription="carousel" aria-label={item.title || 'Lesson carousel'}>
      <div className="flex items-start justify-between gap-3 p-3" aria-live="polite">
        <div className="flex min-w-0 items-start gap-2">
          {slide.icon ? (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
              <Icon name={slide.icon} className="h-4 w-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{slide.title}</p>
            {slide.lesson ? <p className="text-xs text-slate-500 dark:text-slate-400">{slide.lesson}</p> : null}
            {slide.description ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{slide.description}</p> : null}
          </div>
        </div>
        {many ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous slide"
              className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[2.5rem] text-center text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {safeIndex + 1}/{slides.length}
            </span>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next slide"
              className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
      {many ? (
        <div className="flex gap-1 px-3 pb-3" aria-hidden>
          {slides.map((s, i) => (
            <span
              key={s.id || i}
              className={cx('h-1 flex-1 rounded-full', i === safeIndex ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700')}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Popover({ item }) {
  const [open, setOpen] = useState(false);
  const items = item.items || [];
  if (!items.length) return <Empty label="This popover has no items." />;

  return (
    <div className="relative inline-block w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <span className="truncate">{item.trigger}</span>
        <ChevronDown className={cx('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <div
          role="region"
          aria-label={item.trigger}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <ul className="list-none space-y-1 p-0">
            {items.map((entry, index) => (
              <li key={entry.id || index} className="rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                <p className="text-sm text-slate-800 dark:text-slate-100">{entry.label}</p>
                {entry.description ? <p className="text-xs text-slate-500 dark:text-slate-400">{entry.description}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The `navigation` component when it carries `components[]` rather than links. */
export default function NavigationGroups({ component }) {
  const parts = component.components || [];
  if (!parts.length) return <Empty label="This navigation block has nothing to show." />;

  return (
    <Panel title={component.title}>
      <div className="space-y-3">
        {parts.map((part, index) => {
          const key = part.id || `${part.type}-${index}`;
          if (part.type === 'carousel') return <Carousel key={key} item={part} />;
          if (part.type === 'popover') return <Popover key={key} item={part} />;
          return null;
        })}
      </div>
    </Panel>
  );
}
