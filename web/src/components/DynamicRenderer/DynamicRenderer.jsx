import { Suspense, useCallback, useId, useMemo } from 'react';
import { FileQuestion, ShieldAlert } from 'lucide-react';
import { getRenderer, isContainer } from './ComponentRegistry';
import RendererErrorBoundary from './RendererErrorBoundary';
import { DynamicProvider } from './DynamicContext';
import { validateUI } from './utils/validateUI';
import { cx, Spinner } from '../ui';
import { UI_LIMITS } from './schemas/uiSchema';

/**
 * DYNAMIC RENDERER
 * ================
 *
 * Turns a validated UI document into a lesson.
 *
 *   <DynamicRenderer document={doc} actions={actions} lessonId={id} />
 *
 * Responsibilities, in order:
 *   1. validate the document (again — the client does not trust its own network);
 *   2. render the envelope (title area, objectives) when asked to;
 *   3. map each component to its registry renderer, in order;
 *   4. isolate failures per component through an error boundary;
 *   5. guard recursion depth so a pathological document cannot hang the tab.
 *
 * It renders *nothing* the model wrote as HTML or JavaScript. Everything is a
 * React component receiving validated props.
 */

const SAFE_FALLBACK_TYPES = new Set(['text', 'card', 'learning']);

function ComponentSkeleton() {
  return (
    <div className="flex items-center gap-2 py-2 text-xs text-slate-400" role="status" aria-label="Loading section">
      <Spinner className="h-3.5 w-3.5" /> Loading section…
    </div>
  );
}

/** Shown when a component type is unknown (should be impossible post-validation). */
function UnknownComponent({ type }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400" role="note">
      <ShieldAlert className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
      This section uses an unsupported component type (<code className="mono">{String(type || 'unknown').slice(0, 40)}</code>) and was not rendered.
    </div>
  );
}

/** Rendered when the document itself cannot be used. */
export function InvalidDocumentNotice({ issues = [], onRetry }) {
  return (
    <div className="rounded-xl2 border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/30" role="alert">
      <div className="flex items-start gap-2">
        <FileQuestion className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">This lesson could not be displayed</p>
          <p className="mt-0.5 text-xs text-rose-800 dark:text-rose-300">
            The response from the tutor did not match the lesson format, so it was not rendered. Nothing you typed was lost.
          </p>
          {issues?.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-rose-700 dark:text-rose-300">
              {issues.slice(0, 3).map((issue, i) => (
                <li key={i}>{issue.message}{issue.path ? ` (${issue.path})` : ''}</li>
              ))}
            </ul>
          ) : null}
          {onRetry ? (
            <button type="button" onClick={onRetry} className="btn-secondary btn-sm mt-3">
              Ask the tutor again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Render one component subtree.
 *
 * Container types receive `renderChildren`, so they can decide *how* their
 * children are laid out (grid, tabs, accordion) without knowing how each child
 * renders. Leaves ignore it.
 */
function RenderNode({ component, depth, renderChildren }) {
  const Renderer = getRenderer(component?.type);
  if (!Renderer) return <UnknownComponent type={component?.type} />;
  if (depth > UI_LIMITS.maxDepth + 1) return null;

  const props = { component, depth };
  if (isContainer(component.type)) props.renderChildren = renderChildren;
  return <Renderer {...props} />;
}

export default function DynamicRenderer({
  document: rawDocument,
  actions,
  lessonId = null,
  classroomId = null,
  conversationId = null,
  progress = null,
  showHeader = true,
  className = '',
  onInvalid,
  renderFooter,
}) {
  const validation = useMemo(() => validateUI(rawDocument), [rawDocument]);
  const document = validation.document;
  const headerId = useId();

  // One stable callback for the whole tree: containers call it with their own
  // children, and it recurses with an incremented depth.
  const renderChildren = useCallback(
    (children, depth) => (
      <ComponentList components={children} depth={depth} renderChildren={renderChildren} />
    ),
    [],
  );

  if (!document) {
    return (
      <div className={className}>
        <InvalidDocumentNotice issues={validation.issues} onRetry={() => onInvalid?.()} />
      </div>
    );
  }

  const meta = document.metadata || {};
  const objectives = document.learning_objectives || [];

  return (
    <DynamicProvider actions={actions} lessonId={lessonId} classroomId={classroomId} conversationId={conversationId} progress={progress}>
      <article className={cx('space-y-4', className)} aria-labelledby={showHeader && meta.topic ? headerId : undefined}>
        {showHeader && (meta.topic || objectives.length) ? (
          <header className="space-y-2">
            {meta.topic ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={headerId} className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
                  {meta.topic}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {meta.difficulty ? <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{meta.difficulty}</span> : null}
                  {meta.subject ? <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{String(meta.subject).replace(/_/g, ' ')}</span> : null}
                  {meta.estimated_minutes ? <span>{meta.estimated_minutes} min</span> : null}
                </div>
              </div>
            ) : null}
            {objectives.length ? (
              <ul className="grid gap-1 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2" aria-label="Learning objectives">
                {objectives.map((objective, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                    <span>{objective}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </header>
        ) : null}

        <ComponentList components={document.components} depth={1} renderChildren={renderChildren} />

        {renderFooter ? renderFooter(document) : null}

        {validation.dropped?.length ? (
          <p className="text-[11px] text-slate-400" role="note">
            {validation.dropped.length} section{validation.dropped.length > 1 ? 's were' : ' was'} skipped because the tutor’s response was malformed.
          </p>
        ) : null}
      </article>
    </DynamicProvider>
  );
}

function ComponentList({ components, depth, renderChildren }) {
  return (
    <div className="space-y-4">
      {(components || []).map((component, index) => (
        <div key={component.id || `c-${depth}-${index}`} data-component-type={component.type}>
          <RendererErrorBoundary componentType={component.type}>
            <Suspense fallback={<ComponentSkeleton />}>
              <RenderNode component={component} depth={depth} renderChildren={renderChildren} />
            </Suspense>
          </RendererErrorBoundary>
        </div>
      ))}
    </div>
  );
}

export { SAFE_FALLBACK_TYPES };
