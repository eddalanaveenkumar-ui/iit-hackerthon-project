import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * RENDERER ERROR BOUNDARY
 * =======================
 *
 * A lesson is 20-40 independent components. Without a boundary, one renderer
 * throwing (a chart with a NaN, a diagram whose edges reference a node that was
 * dropped during repair) blanks the entire lesson — and in a React 19 root that
 * is the whole page.
 *
 * This boundary is scoped per component by DynamicRenderer, so a failure is
 * local: the lesson keeps its place, the student sees which section failed, and
 * they can retry it without losing their answers elsewhere.
 */
export default class RendererErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the console signal for developers without surfacing a stack to the
    // student. Component name only — never the payload, which may contain
    // student answers.
    if (typeof console !== 'undefined') {
      console.warn('[DynamicRenderer] component failed:', this.props.componentType, error?.message, info?.componentStack?.split('\n')[1]?.trim());
    }
  }

  render() {
    const { error } = this.state;
    const { children, componentType, onRetry } = this.props;
    if (!error) return children;

    return (
      <div
        className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30"
        role="alert"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              This {String(componentType || 'section').replace(/_/g, ' ')} could not be displayed
            </p>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
              The rest of the lesson is still available. You can retry this section or continue.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              onRetry?.();
            }}
            className="btn-secondary btn-sm shrink-0"
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> Retry
          </button>
        </div>
      </div>
    );
  }
}
