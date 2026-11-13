import { useCallback, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { CheckCircle2, Lightbulb, Play, RotateCcw, Terminal, XCircle } from 'lucide-react';
import { useDynamicActions, useSafeTheme } from '../DynamicContext';
import { Empty, Panel } from './shared';
import { Spinner, cx } from '../../ui';

/**
 * `code_editor` — read, edit, run and check code inside a lesson.
 *
 * Security boundary: this component never executes anything. "Run" posts the
 * code to `/api/learning/code/execute`, which runs it in the server's isolated
 * sandbox (a separate process with the permission model, an empty environment and
 * a hard timeout). The UI only displays what that endpoint reported — including
 * when it reports that a language is analysed statically rather than executed,
 * which is a sentence the student must see rather than a silent pass.
 *
 * Test cases come from the stored lesson when a lesson id is present, so the
 * client cannot invent its own passing tests.
 */

const LANGUAGE_LABEL = { javascript: 'JavaScript', python: 'Python', java: 'Java', sql: 'SQL' };

function monacoLanguage(language) {
  return language === 'javascript' ? 'javascript' : language === 'python' ? 'python' : language === 'java' ? 'java' : 'sql';
}

export default function CodeRenderer({ component }) {
  const { actions, lessonId } = useDynamicActions();
  const { theme } = useSafeTheme();
  const starter = component.starter_code || '';
  const [code, setCode] = useState(starter);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [dirty, setDirty] = useState(false);
  const mountedRef = useRef(true);

  const dirtyFromStarter = code !== starter;

  const run = useCallback(async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError('');
    setOutcome(null);
    try {
      const payload = {
        lesson_id: lessonId || undefined,
        component_id: lessonId ? component.id : undefined,
        language: component.language,
        code,
        tests: lessonId ? undefined : component.tests,
      };
      const response = await actions.runCode(code, component.language, payload);
      if (response?.ok === false) throw new Error(response.reason || 'The code could not be run.');
      if (mountedRef.current) {
        setOutcome(response);
        // Running counts as progress on this section.
        if (component.id) actions.markComplete(component.id);
      }
    } catch (e) {
      if (mountedRef.current) setError(e.message || 'The code could not be run.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [actions, busy, code, component.id, component.language, component.tests, lessonId]);

  const reset = () => {
    setCode(starter);
    setOutcome(null);
    setError('');
  };

  if (!starter && !component.instructions) {
    return <Empty label="This code exercise has no content." />;
  }

  const passed = outcome?.results?.filter((r) => r.passed).length || 0;
  const total = outcome?.results?.length || 0;
  const allPassed = total > 0 && passed === total;

  return (
    <Panel
      title={component.title || `Code — ${LANGUAGE_LABEL[component.language] || component.language}`}
      subtitle={component.instructions}
      action={<span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{LANGUAGE_LABEL[component.language] || component.language}</span>}
      flush
    >
      <div className="border-b border-slate-100 dark:border-slate-800">
        <div className="h-[248px] w-full sm:h-[280px]">
          <Editor
            height="100%"
            language={monacoLanguage(component.language)}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={code}
            onChange={(value) => {
              setCode(value ?? '');
              setDirty(true);
            }}
            loading={<div className="flex h-full items-center justify-center text-xs text-slate-500"><Spinner /> Loading editor…</div>}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              renderLineHighlight: 'none',
              automaticLayout: true,
              tabSize: 4,
              padding: { top: 8, bottom: 8 },
              ariaLabel: 'Code editor',
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <button type="button" onClick={run} className="btn-primary btn-sm" disabled={busy || !code.trim()}>
          {busy ? <Spinner className="h-3 w-3" /> : <Play className="h-3 w-3" aria-hidden />} {busy ? 'Running…' : component.run_enabled === false ? 'Run' : 'Run code'}
        </button>
        {component.reset_enabled !== false ? (
          <button type="button" onClick={reset} className="btn-secondary btn-sm" disabled={busy || (!dirtyFromStarter && !outcome)}>
            <RotateCcw className="h-3 w-3" aria-hidden /> Reset
          </button>
        ) : null}
        {component.solution_hint ? (
          <button type="button" onClick={() => setShowHint((v) => !v)} className="btn-ghost btn-sm ml-auto">
            <Lightbulb className="h-3 w-3" aria-hidden /> {showHint ? 'Hide hint' : 'Hint'}
          </button>
        ) : null}
        {outcome?.runtime ? <span className="text-[11px] text-slate-400">{outcome.runtime}</span> : null}
      </div>

      {showHint && component.solution_hint ? (
        <p className="border-b border-slate-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:border-slate-800 dark:bg-amber-950/25 dark:text-amber-200">
          <Lightbulb className="mr-1 inline h-3 w-3" aria-hidden />
          {component.solution_hint}
        </p>
      ) : null}

      <div className="px-3 py-2.5">
        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
            {error} Your code is unchanged — you can run it again.
          </p>
        ) : null}

        {!outcome && !error ? (
          <div className="space-y-1.5">
            {component.expected_output ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Expected output: <code className="mono rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">{component.expected_output}</code>
              </p>
            ) : null}
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Terminal className="h-3 w-3" aria-hidden /> Code runs in an isolated sandbox with a time and memory limit — it never runs in your browser.
            </p>
          </div>
        ) : null}

        {outcome ? (
          <div className="space-y-2" aria-live="polite">
            {outcome.executed === false ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                {outcome.reason || 'This language is analysed statically in this environment — the result below is analysis, not execution.'}
              </p>
            ) : null}

            {total ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx('badge', allPassed ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300')}>
                  {passed}/{total} tests passed
                </span>
              </div>
            ) : null}

            {total ? (
              <ul className="space-y-1">
                {outcome.results.map((test, index) => {
                  const definition = (component.tests || []).find((t) => t.id === test.id);
                  // The sandbox echoes an id per test, but a run with no declared
                  // tests returns results without one — fall back to the index so
                  // the list never renders two children with an undefined key.
                  return (
                    <li key={test.id ?? `result-${index}`} className="flex items-start gap-1.5 text-xs">
                      {test.passed ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="passed" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" aria-label="failed" />
                      )}
                      <span className="min-w-0">
                        <span className="font-medium text-slate-700 dark:text-slate-200">{definition?.name || test.id}</span>
                        {test.error ? <span className="block text-rose-600 dark:text-rose-400">{test.error}</span> : null}
                        {test.output && !test.error ? <span className="block font-mono text-[11px] text-slate-500 dark:text-slate-400">→ {String(test.output).slice(0, 200)}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {outcome.stdout ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Program output</p>
                <pre className="max-h-48 overflow-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[12px] text-slate-100">{outcome.stdout}</pre>
              </div>
            ) : null}

            {outcome.loadError ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">Error</p>
                <pre className="max-h-40 overflow-auto rounded-lg bg-rose-950/90 p-2.5 font-mono text-[12px] text-rose-100">{outcome.loadError}</pre>
              </div>
            ) : null}

            {outcome.timedOut ? <p className="text-xs text-amber-700 dark:text-amber-300">Execution timed out — check for an infinite loop.</p> : null}

            {outcome.staticAnalysis?.issues?.length ? (
              <details>
                <summary className="cursor-pointer text-[11px] text-slate-500 dark:text-slate-400">Static analysis ({outcome.staticAnalysis.issues.length})</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-slate-600 dark:text-slate-300">
                  {outcome.staticAnalysis.issues.slice(0, 8).map((issue, i) => (
                    <li key={i}>
                      <span className="font-semibold uppercase">{issue.type}</span> — {issue.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** Exposed for tests and for callers that need the same label mapping. */
export { LANGUAGE_LABEL };
