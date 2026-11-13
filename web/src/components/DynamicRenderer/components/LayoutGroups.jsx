import { cx } from '../../ui';
import { TONE_BG } from './shared';

/**
 * ROW / GRID / BOX — visual groups inside a layout
 * ================================================
 *
 * A lesson sometimes wants plain arrangement rather than a component: two
 * labelled columns side by side, or a 3-across block of tiles. These groups are
 * *presentation only* — they hold no behaviour, cannot run anything, and their
 * content is text — so they are rendered here rather than being treated as free
 * markup.
 *
 * Responsive rules, because a fixed N-column grid is unreadable on a phone:
 *   - a row stacks on mobile and becomes a row from `sm` up;
 *   - a grid is one column on mobile, two from `sm`, and its declared column
 *     count only from `lg` — so a 3-column grid never produces three 90px cells
 *     on a 360px screen.
 */

const GAP = { sm: 'gap-2', md: 'gap-3', lg: 'gap-5' };

function gridClassFor(columns) {
  const n = Math.min(Math.max(Number(columns) || 2, 1), 4);
  if (n === 1) return 'grid-cols-1';
  if (n === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (n === 3) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
}

/** A single cell. Rendered as text, never as markup. */
export function LayoutBox({ item }) {
  const tone = TONE_BG[item.tone] || TONE_BG.neutral;
  return (
    <div className={cx('flex min-h-[3rem] items-center justify-center rounded-lg border border-slate-200 px-3 py-2.5 text-center text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200', tone)}>
      {item.content}
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.item      the row/grid group
 * @param {number} props.depth
 * @param {(children: any[], depth: number) => React.ReactNode} props.renderChildren
 */
export default function LayoutGroup({ item, depth, renderChildren }) {
  const children = item.children || [];
  if (!children.length) return null;
  const gap = GAP[item.gap] || GAP.md;

  // Separate presentation cells from real components: a grid may mix a label
  // box with a chart, and each has to be rendered by its own path.
  const cells = [];
  const components = [];
  for (const child of children) {
    if (child?.type === 'row' || child?.type === 'grid' || child?.type === 'box') cells.push(child);
    else components.push(child);
  }

  const renderCell = (cell, index) => {
    if (cell.type === 'box') return <LayoutBox key={cell.id || `box-${index}`} item={cell} />;
    return <LayoutGroup key={cell.id || `${cell.type}-${index}`} item={cell} depth={depth} renderChildren={renderChildren} />;
  };

  if (item.type === 'row') {
    return (
      <div className={cx('flex flex-col sm:flex-row sm:items-stretch', gap)}>
        {cells.map(renderCell)}
        {components.length ? <div className={cx('contents', gap)}>{renderChildren(components, depth + 1)}</div> : null}
      </div>
    );
  }

  return (
    <div className={cx('grid', gridClassFor(item.columns), gap)}>
      {cells.map(renderCell)}
      {components.length ? renderChildren(components, depth + 1) : null}
    </div>
  );
}

/** Is this item a presentation group rather than a component? */
export function isLayoutGroup(item) {
  return Boolean(item) && ['row', 'grid', 'box'].includes(item.type);
}
