import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../../ui';
import { Empty, Panel, WIDTH_CLASS } from './shared';

/**
 * `layout`, `tabs`, `accordion` — the structural components.
 *
 * They never change content, only arrangement. Each one delegates to
 * `renderChildren`, which DynamicRenderer supplies, so children keep their own
 * error boundaries and lazy loading.
 */

const GAP = { sm: 'gap-2', md: 'gap-3', lg: 'gap-5' };

function Layout({ component, depth, renderChildren }) {
  const children = component.children || [];
  if (!children.length) return <Empty label="This section is empty." />;

  const width = WIDTH_CLASS[component.style?.width] || 'w-full';
  const gap = GAP[component.gap] || GAP.md;

  if (component.layout === 'grid' || component.layout === 'columns') {
    const columns = component.columns || 2;
    const gridClass = columns >= 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
    return (
      <div className={cx('grid grid-cols-1', gridClass, gap, width)}>{renderChildren(children, depth + 1)}</div>
    );
  }

  if (component.layout === 'split') {
    return (
      <div className={cx('grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]', width)}>
        {renderChildren(children, depth + 1)}
      </div>
    );
  }

  return <div className={cx('space-y-3', width)}>{renderChildren(children, depth + 1)}</div>;
}

function Tabs({ component, depth, renderChildren }) {
  const tabs = component.tabs || [];
  const [activeId, setActiveId] = useState(component.default_tab || tabs[0]?.id);
  if (!tabs.length) return <Empty label="This tab group is empty." />;
  const active = tabs.find((t) => t.id === activeId) || tabs[0];

  return (
    <Panel title={component.title} subtitle={component.subtitle} className={WIDTH_CLASS[component.style?.width] || 'w-full'}>
      <div role="tablist" aria-label={component.title || 'Lesson tabs'} className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-0 dark:border-slate-800">
        {tabs.map((tab) => {
          const selected = tab.id === active.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`tab-${component.id}-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${component.id}-${tab.id}`}
              onClick={() => setActiveId(tab.id)}
              className={cx(
                'relative whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium transition-colors',
                selected ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {tab.label}
              {selected ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" /> : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`panel-${component.id}-${active.id}`} aria-labelledby={`tab-${component.id}-${active.id}`} className="pt-3">
        {renderChildren(active.children || [], depth + 1)}
      </div>
    </Panel>
  );
}

function Accordion({ component, depth, renderChildren }) {
  const items = component.items || [];
  const [open, setOpen] = useState(() => new Set(component.open_first && items[0] ? [items[0].id] : []));
  if (!items.length) return <Empty label="This accordion is empty." />;

  const toggle = (id) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Panel title={component.title} subtitle={component.subtitle} className={WIDTH_CLASS[component.style?.width] || 'w-full'}>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((item) => {
          const expanded = open.has(item.id);
          return (
            <div key={item.id}>
              <h4>
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-expanded={expanded}
                  aria-controls={`acc-${component.id}-${item.id}`}
                  className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm font-medium text-slate-800 hover:text-brand-700 dark:text-slate-100 dark:hover:text-brand-300"
                >
                  {item.title}
                  <ChevronDown className={cx('h-4 w-4 shrink-0 text-slate-400 transition-transform', expanded && 'rotate-180')} aria-hidden />
                </button>
              </h4>
              {expanded ? (
                <div id={`acc-${component.id}-${item.id}`} className="pb-3">
                  {renderChildren(item.children || [], depth + 1)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export default function LayoutRenderer({ component, depth, renderChildren }) {
  if (component.type === 'tabs') return <Tabs component={component} depth={depth} renderChildren={renderChildren} />;
  if (component.type === 'accordion') return <Accordion component={component} depth={depth} renderChildren={renderChildren} />;
  return <Layout component={component} depth={depth} renderChildren={renderChildren} />;
}
