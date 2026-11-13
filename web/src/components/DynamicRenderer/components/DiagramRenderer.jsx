import { useId, useMemo } from 'react';
import { ArrowDown, ArrowRight, Database, Diamond, Square, StickyNote } from 'lucide-react';
import { Empty, Notice, Panel, WIDTH_CLASS } from './shared';
import { sanitizeText } from '../utils/validateUI';
import { cx } from '../../ui';

/**
 * `diagram` — flowcharts, graphs, call stacks and architecture sketches.
 *
 * Rendered as accessible SVG/CSS, never as an image and never as raw SVG markup
 * from the model. Two layouts:
 *
 *   layered  flowchart / graph / tree — nodes are placed in columns by distance
 *            from the first node, so a flowchart reads top-to-bottom and a
 *            left-to-right comparison is still legible on a phone (it stacks).
 *   stack    an ordered list rendered bottom-up, which is how a call stack is
 *            actually explained.
 *
 * Every edge is validated against the node set before drawing: an edge to a node
 * that does not exist is reported, not silently dropped into a line to nowhere.
 */

const SHAPE_ICON = { decision: Diamond, terminal: Square, io: ArrowRight, database: Database, note: StickyNote, process: Square };

const SHAPE_CLASS = {
  process: 'rounded-lg border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900',
  decision: 'rounded-2xl border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30',
  terminal: 'rounded-full border-slate-400 bg-slate-100 dark:border-slate-500 dark:bg-slate-800',
  io: 'rounded-lg border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30',
  database: 'rounded-lg border-cyan-300 bg-cyan-50 dark:border-cyan-800 dark:bg-cyan-950/30',
  note: 'rounded-lg border-dashed border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/30',
};

/** Compute a reading order: breadth-first from the first node, then any orphans. */
export function layoutNodes(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }
  const levels = new Map();
  const queue = nodes.length ? [[nodes[0].id, 0]] : [];
  while (queue.length) {
    const [id, depth] = queue.shift();
    if (levels.has(id)) continue;
    levels.set(id, depth);
    for (const next of adjacency.get(id) || []) {
      if (!levels.has(next)) queue.push([next, depth + 1]);
    }
  }
  // Back-edges (loops) and disconnected nodes: place at the level after their
  // predecessor so a return edge does not invent a new column.
  for (const edge of edges) {
    if (levels.has(edge.to) && levels.has(edge.from) && levels.get(edge.to) <= levels.get(edge.from)) {
      levels.set(edge.to, levels.get(edge.from) + 1);
    }
  }
  for (const node of nodes) if (!levels.has(node.id)) levels.set(node.id, 0);

  const columns = [];
  for (const node of nodes) {
    const level = levels.get(node.id);
    if (!columns[level]) columns[level] = [];
    columns[level].push(node);
  }
  return columns;
}

function ShapeNode({ node, compact = false }) {
  const IconComponent = SHAPE_ICON[node.shape || 'process'];
  return (
    <div
      className={cx(
        'relative flex min-w-0 flex-col gap-0.5 border px-2.5 py-1.5 text-left shadow-sm',
        SHAPE_CLASS[node.shape || 'process'],
        compact ? 'text-[11.5px]' : 'text-xs',
      )}
    >
      <span className="flex items-start gap-1.5 font-medium text-slate-800 dark:text-slate-100">
        <IconComponent className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" aria-hidden />
        <span className="min-w-0 break-words">{node.label}</span>
      </span>
      {node.detail ? <span className="pl-[18px] text-[10.5px] leading-snug text-slate-500 dark:text-slate-400">{node.detail}</span> : null}
    </div>
  );
}

function Flowchart({ nodes, edges }) {
  const columns = useMemo(() => layoutNodes(nodes, edges), [nodes, edges]);
  const edgeLabels = useMemo(() => {
    const map = new Map();
    for (const edge of edges) {
      if (edge.to === nodes[0]?.id && edge.label) {
        // A back-edge to the start is the loop, and is described in the caption.
        continue;
      }
      if (edge.label) map.set(`${edge.from}->${edge.to}`, edge.label);
    }
    return map;
  }, [edges, nodes]);

  return (
    <div className="space-y-1.5">
      {nodes.length ? (
        <>
          <div className="max-w-[520px]">
            <ShapeNode node={nodes[0]} />
          </div>
          {columns.slice(1).map((column, levelIndex) => (
            <div key={levelIndex} className="space-y-1.5">
              <div className="flex items-center gap-1.5 pl-3 text-[10px] uppercase tracking-wide text-slate-400">
                <ArrowDown className="h-3 w-3" aria-hidden />
                {column.length > 1 ? `then (any of ${column.length})` : 'then'}
              </div>
              <div className={cx('grid gap-2', column.length > 1 ? 'sm:grid-cols-2' : 'max-w-[520px]')}>
                {column.map((node) => {
                  const incoming = edges.find((e) => e.to === node.id);
                  const label = incoming ? edgeLabels.get(`${incoming.from}->${incoming.to}`) : null;
                  return (
                    <div key={node.id} className="space-y-0.5">
                      {label ? <p className="text-[10px] font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">if {label}</p> : null}
                      <ShapeNode node={node} compact />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      ) : null}
      <p className="pt-1 text-[10.5px] text-slate-400">Read top to bottom. Each box is one step.</p>
    </div>
  );
}

function StackDiagram({ nodes, edges, order }) {
  const ordered = order?.length
    ? order.map((id) => nodes.find((n) => n.id === id)).filter(Boolean)
    : [...nodes].reverse();
  const labels = new Map(edges.map((e) => [e.from, e.label]));

  return (
    <ol className="space-y-1" aria-label="Call stack, from the bottom up">
      {ordered.map((node, index) => (
        <li key={node.id} className="flex items-stretch gap-2">
          <span className="flex w-6 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <ShapeNode node={node} />
            {labels.get(node.id) ? <p className="pl-1 pt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{labels.get(node.id)}</p> : null}
          </div>
        </li>
      ))}
      <li className="pl-8 text-[10.5px] text-slate-400">Top of the stack = the call that is currently running.</li>
    </ol>
  );
}

function ArchitectureList({ nodes, edges }) {
  return (
    <div className="space-y-1.5">
      {nodes.map((node) => {
        const outgoing = edges.filter((e) => e.from === node.id);
        return (
          <div key={node.id} className="flex flex-wrap items-center gap-1.5">
            <div className="min-w-[160px] flex-1">
              <ShapeNode node={node} compact />
            </div>
            {outgoing.map((edge, i) => (
              <span key={i} className="flex items-center gap-0.5 text-[10px] text-slate-400">
                <ArrowRight className="h-3 w-3" aria-hidden />
                {edge.label || nodes.find((n) => n.id === edge.to)?.label}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function DiagramRenderer({ component }) {
  const width = WIDTH_CLASS[component.style?.width] || 'w-full';
  const captionId = useId();
  const nodes = component.nodes || [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const badEdges = (component.edges || []).filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to));

  if (!nodes.length) {
    return (
      <Panel title={component.title} className={width}>
        <Empty label="This diagram has no nodes." />
      </Panel>
    );
  }

  return (
    <Panel
      title={component.title || 'Diagram'}
      subtitle={component.caption}
      className={width}
      footer={component.caption ? <span id={captionId}>{sanitizeText(component.caption)}</span> : undefined}
    >
      <div className="space-y-2">
        {badEdges.length ? <Notice>{badEdges.length} connection(s) referenced a node that does not exist and were omitted.</Notice> : null}
        {component.diagram_type === 'stack' ? (
          <StackDiagram nodes={nodes} edges={component.edges || []} order={component.order} />
        ) : component.diagram_type === 'flowchart' && nodes.length <= 12 ? (
          <Flowchart nodes={nodes} edges={component.edges || []} />
        ) : (
          <ArchitectureList nodes={nodes} edges={component.edges || []} />
        )}
        {component.diagram_type === 'flowchart' && nodes.length > 12 ? (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Large flowchart shown as an ordered list for readability.</p>
        ) : null}
      </div>
    </Panel>
  );
}
