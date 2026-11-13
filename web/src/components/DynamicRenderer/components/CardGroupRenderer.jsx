import { Empty, Icon, Panel, WIDTH_CLASS, Body } from './shared';
import { cx } from '../../ui';
import { sanitizeUrl } from '../utils/validateUI';

/**
 * `card_group` — several comparable cards as one block
 * ====================================================
 *
 * A syllabus maps onto this directly: one card per module, each with an icon, a
 * level badge and a one-line description. It is a *collection* component, so
 * the layout decision (grid vs list, how many columns) belongs to the group
 * and not to each card.
 *
 * Accessibility: the group is a list, each card a list item, so a screen reader
 * announces "list, 2 items" before reading them.
 */

const GRID = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

/**
 * A badge is a short piece of state ("Beginner"). It is never markup: the text
 * is rendered as a React node, so a hostile value stays visible text.
 */
function Badge({ children }) {
  // Status words get semantic colours; anything else stays neutral rather than
  // being guessed at.
  const key = String(children || '').toLowerCase();
  const toneKey =
    /beginner|easy|intro/.test(key) ? 'success'
      : /advanced|hard|expert/.test(key) ? 'danger'
        : /intermediate|medium|core/.test(key) ? 'warning'
          : 'neutral';

  const tones = {
    neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
    danger: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  };

  return (
    <span className={cx('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium', tones[toneKey])}>
      {children}
    </span>
  );
}

export default function CardGroupRenderer({ component }) {
  const items = component.items || [];
  const width = WIDTH_CLASS[component.style?.width] || 'w-full';

  if (!items.length) return <Empty label="This card group has no items." />;

  const isList = component.layout === 'list';
  const columns = Math.min(Math.max(component.columns || 2, 1), 4);

  return (
    <Panel title={component.title} className={width}>
      <ul
        className={cx(
          'grid list-none gap-3 p-0',
          isList ? 'grid-cols-1' : GRID[columns],
        )}
      >
        {items.map((item, index) => (
          <li
            key={item.id || `card-${index}`}
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {item.icon ? (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                    <Icon name={item.icon} className="h-4 w-4" />
                  </span>
                ) : null}
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</h4>
              </div>
              {item.badge ? <Badge>{item.badge}</Badge> : null}
            </div>
            {item.description ? (
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{item.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * `media` with `items[]` — several media in one block.
 *
 * Exported separately because the single-media `media` shape keeps its own
 * renderer path; this one takes over only when `items` is present.
 */
const ASPECT = {
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '1:1': 'aspect-square',
  '3:2': 'aspect-[3/2]',
  '9:16': 'aspect-[9/16]',
};

export function MediaGroup({ items }) {
  if (!items?.length) return <Empty label="This media group has no items." />;

  return (
    <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
      {items.map((item, index) => {
        const key = item.id || `media-${index}`;
        const src = item.src ? sanitizeUrl(item.src) : null;

        if (item.media_type === 'icon') {
          return (
            <li key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                <Icon name={item.name} className="h-5 w-5" />
              </span>
              {item.title || item.caption ? (
                <span className="text-sm text-slate-700 dark:text-slate-200">{item.title || item.caption}</span>
              ) : null}
            </li>
          );
        }

        // A media item without a usable URL is an authoring error, not an
        // attack: say so in place rather than leaving a broken frame.
        if (!src) {
          return (
            <li key={key} className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              This media item has no valid source.
            </li>
          );
        }

        return (
          <li key={key} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            {item.media_type === 'video' ? (
              <video
                src={src}
                controls={item.controls !== false}
                poster={item.poster ? sanitizeUrl(item.poster) || undefined : undefined}
                className={cx('w-full bg-black', ASPECT[item.aspect_ratio] || 'aspect-video')}
              >
                {item.caption || 'Your browser cannot play this video.'}
              </video>
            ) : (
              <img
                src={src}
                alt={item.alt || item.caption || ''}
                loading="lazy"
                className={cx('w-full object-cover', ASPECT[item.aspect_ratio] || 'aspect-video')}
              />
            )}
            {item.caption ? (
              <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                <Body>{item.caption}</Body>
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
