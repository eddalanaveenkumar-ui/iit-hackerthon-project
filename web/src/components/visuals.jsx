import { useState } from 'react';
import { ArrowDown, ArrowRight, ChevronRight, Copy, Check, Repeat } from 'lucide-react';
import { cx } from './ui';

/**
 * Renders the tutor's visual explanation blocks.
 *
 * Deliberately NOT a general-purpose HTML/markdown renderer: each block kind has
 * one component and a fixed shape validated server-side, so a model cannot inject
 * markup into a lesson. Everything degrades to text if a field is missing.
 */
export function VisualBlocks({ blocks = [] }) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  return (
    <div className="mt-3 space-y-2.5">
      {blocks.map((block, i) => (
        <VisualBlock key={`${block.kind}-${i}`} block={block} />
      ))}
    </div>
  );
}

function Frame({ title, caption, children, tone = 'brand' }) {
  return (
    <figure
      className={cx(
        'overflow-hidden rounded-xl border',
        tone === 'brand'
          ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60',
      )}
    >
      {title ? (
        <figcaption className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
          <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{title}</p>
          {caption ? <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{caption}</p> : null}
        </figcaption>
      ) : null}
      <div className="p-3">{children}</div>
    </figure>
  );
}

export function VisualBlock({ block }) {
  switch (block.kind) {
    case 'flow':
      return <FlowBlock block={block} />;
    case 'compare':
      return <CompareBlock block={block} />;
    case 'steps':
      return <StepsBlock block={block} />;
    case 'code':
      return <CodeBlock block={block} />;
    case 'hierarchy':
      return <HierarchyBlock block={block} />;
    case 'table':
      return <TableBlock block={block} />;
    default:
      return null;
  }
}

function FlowBlock({ block }) {
  const nodes = block.nodes || [];
  return (
    <Frame title={block.title} caption={block.caption}>
      <ol className="flex flex-col gap-0">
        {nodes.map((node, i) => (
          <li key={i}>
            <div className="flex items-start gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-[13px] font-medium text-slate-800 dark:text-slate-100">{node.label}</p>
                {node.detail ? <p className="text-[11px] text-slate-500 dark:text-slate-400">{node.detail}</p> : null}
              </div>
            </div>
            {i < nodes.length - 1 ? <span className="ml-3 block h-3 w-px bg-slate-200 dark:bg-slate-700" /> : null}
          </li>
        ))}
      </ol>
      {block.loop ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <Repeat className="h-3 w-3" /> Repeats from the top
        </p>
      ) : null}
    </Frame>
  );
}

function CompareBlock({ block }) {
  const columns = block.columns || [];
  return (
    <Frame title={block.title} caption={block.caption}>
      <div className={cx('grid gap-2', columns.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {columns.map((col, i) => (
          <div
            key={i}
            className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-700 dark:bg-slate-800/40"
          >
            <p className="mb-1.5 text-[12px] font-semibold text-brand-700 dark:text-brand-300">{col.name}</p>
            <ul className="space-y-1">
              {(col.items || []).map((item, j) => (
                <li key={j} className="flex gap-1.5 text-[11.5px] leading-snug text-slate-600 dark:text-slate-300">
                  <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function StepsBlock({ block }) {
  return (
    <Frame title={block.title} caption={block.caption}>
      <ol className="space-y-2">
        {(block.steps || []).map((step, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-slate-800 dark:text-slate-100">{step.label}</p>
              {step.detail ? <p className="text-[11px] text-slate-500 dark:text-slate-400">{step.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

function CodeBlock({ block }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block.code || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is still readable */
    }
  };
  return (
    <Frame title={block.title} caption={block.caption}>
      <div className="relative rounded-lg bg-slate-950 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-800 px-2.5 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{block.language || 'code'}</span>
          <button onClick={copy} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed text-slate-100">
          <code>{block.code}</code>
        </pre>
      </div>
      {block.annotations?.length ? (
        <ul className="mt-2 space-y-1">
          {block.annotations.map((a, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />
              {a}
            </li>
          ))}
        </ul>
      ) : null}
    </Frame>
  );
}

function HierarchyBlock({ block }) {
  const renderNode = (node, depth = 0) => (
    <li key={`${depth}-${node.label}`} className={cx(depth > 0 && 'ml-3 border-l border-slate-200 pl-3 dark:border-slate-700')}>
      <p className={cx('text-[12.5px]', depth === 0 ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300')}>
        {node.label}
      </p>
      {node.children?.length ? <ul className="mt-1 space-y-1">{node.children.map((c) => renderNode(c, depth + 1))}</ul> : null}
    </li>
  );
  return (
    <Frame title={block.title} caption={block.caption}>
      <ul className="space-y-1">{block.root ? renderNode(block.root) : null}</ul>
    </Frame>
  );
}

function TableBlock({ block }) {
  const headers = block.headers || [];
  return (
    <Frame title={block.title} caption={block.caption}>
      <div className="-mx-3 overflow-x-auto px-3">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="border-b border-slate-200 pb-1.5 pr-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 last:pr-0 dark:border-slate-700 dark:text-slate-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(block.rows || []).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="border-b border-slate-100 py-1.5 pr-3 align-top text-[11.5px] text-slate-600 last:pr-0 dark:border-slate-800 dark:text-slate-300"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

/** Compact toggle used above a tutor reply when it carries visuals. */
export function VisualHint({ count, open, onToggle }) {
  if (!count) return null;
  return (
    <button
      onClick={onToggle}
      className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand-700"
    >
      <ArrowDown className={cx('h-3 w-3 transition-transform', open && 'rotate-180')} />
      {open ? 'Hide' : 'Show'} visual explanation ({count})
    </button>
  );
}
