import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { Empty, Panel } from './shared';
import { cx } from '../../ui';

/**
 * EXECUTION COMPONENTS
 * ====================
 *
 * Three ways to show what a program does, all read-only renderings of a
 * pre-computed trace (the platform never executes model-authored code here):
 *
 *   execution_table        one row per step: statement, variables, output
 *   variable_visualization variables as cards, highlighting what just changed
 *   execution_trace        line-stepper with variables and call stack, play/pause
 *
 * They share one invariant: **if the author supplied no steps, nothing is
 * claimed**. There is no synthetic "step 1" invented by the UI, because an
 * execution visualisation that is not derived from the code is a lie a student
 * will learn from.
 */

/* -------------------------------------------------------------------------- */
/* execution_table                                                            */
/* -------------------------------------------------------------------------- */

function ExecutionTable({ component }) {
  const steps = component.steps || [];
  if (!steps.length) return <Empty label="No execution steps were provided." />;

  // Columns are the union of variable names across steps, in first-seen order —
  // a variable introduced on step 4 must still have a column on step 1.
  const variableNames = useMemo(() => {
    const names = [];
    for (const step of steps) for (const name of Object.keys(step.variables || {})) if (!names.includes(name)) names.push(name);
    return names.slice(0, 8);
  }, [steps]);

  return (
    <Panel title={component.title || 'Step-by-step execution'} subtitle={component.description} flush>
      <div className="overflow-x-auto">
        <table className="table-base min-w-[520px]">
          <thead>
            <tr>
              <th scope="col" className="w-10">#</th>
              {component.code_lines?.length ? <th scope="col" className="w-10">Line</th> : null}
              <th scope="col">Statement</th>
              {variableNames.map((name) => (
                <th key={name} scope="col" className="font-mono normal-case">
                  {name}
                </th>
              ))}
              <th scope="col">Output</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step, index) => (
              <tr key={step.id || index} className="align-top">
                <td className="tabular-nums text-slate-400">{step.step ?? index + 1}</td>
                {component.code_lines?.length ? <td className="tabular-nums text-slate-400">{step.line ?? '—'}</td> : null}
                <td>
                  <code className="mono block max-w-[320px] whitespace-pre-wrap break-words text-[12px] text-slate-800 dark:text-slate-100">{step.statement}</code>
                </td>
                {variableNames.map((name) => (
                  <td key={name} className="font-mono text-[12px] text-slate-700 dark:text-slate-200">
                    {step.variables?.[name] ?? <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </td>
                ))}
                <td className="font-mono text-[12px] text-emerald-700 dark:text-emerald-400">{step.output || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-3.5 py-2 text-[11px] text-slate-400 dark:border-slate-800">
        Scroll sideways to see every variable. Each row is the state after that statement ran.
      </p>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* variable_visualization                                                     */
/* -------------------------------------------------------------------------- */

function VariableVisualization({ component }) {
  const steps = component.steps || [];
  const [index, setIndex] = useState(0);

  const current = steps.length ? steps[Math.min(index, steps.length - 1)] : null;
  const variables = current?.variables?.length ? current.variables : component.variables || [];

  if (!variables.length && !steps.length) return <Empty label="No variables were provided for this example." />;

  const atEnd = index >= steps.length - 1;

  return (
    <Panel
      title={component.title || 'Variables'}
      subtitle={component.description}
      action={
        steps.length > 1 ? (
          <div className="flex items-center gap-1">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="Previous step">
              <ChevronLeft className="h-3 w-3" aria-hidden />
            </button>
            <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {index + 1}/{steps.length}
            </span>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))} disabled={atEnd} aria-label="Next step">
              <ChevronRight className="h-3 w-3" aria-hidden />
            </button>
          </div>
        ) : null
      }
    >
      <div className="space-y-3">
        {current?.label ? (
          <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[12px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            {current.label}
            {current.line ? <span className="ml-2 text-slate-400">line {current.line}</span> : null}
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
          {variables.map((variable) => (
            <div
              key={variable.name}
              className={cx(
                'rounded-lg border p-2.5 transition-colors',
                variable.changed
                  ? 'border-brand-400 bg-brand-50/70 dark:border-brand-700 dark:bg-brand-950/30'
                  : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400">{variable.name}</span>
                {variable.changed ? <span className="badge bg-brand-100 text-[10px] text-brand-700 dark:bg-brand-900 dark:text-brand-300">changed</span> : null}
              </div>
              <p className="mt-0.5 break-words font-mono text-sm text-slate-900 dark:text-slate-100">{variable.value}</p>
              {variable.type ? <p className="text-[10.5px] text-slate-400">{variable.type}</p> : null}
            </div>
          ))}
        </div>

        {current?.output ? (
          <p className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-mono text-[12px] text-slate-100">
            <span className="text-slate-400">output → </span>
            {current.output}
          </p>
        ) : null}

        {atEnd && component.final_output ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <span className="font-semibold">Final output: </span>
            <code className="mono">{component.final_output}</code>
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* execution_trace                                                            */
/* -------------------------------------------------------------------------- */

function ExecutionTrace({ component }) {
  const steps = component.steps || [];
  const codeLines = useMemo(() => String(component.code || '').split('\n'), [component.code]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Playback is a timer, not an animation: no transitions on the highlighted
  // line, so the state change is instant and readable. Stops at the last step.
  useEffect(() => {
    if (!playing || !steps.length) return undefined;
    if (index >= steps.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => setIndex((i) => Math.min(steps.length - 1, i + 1)), 900);
    return () => clearTimeout(timer);
  }, [playing, index, steps.length]);

  if (!steps.length) return <Empty label="No trace was provided for this code." />;

  const step = steps[Math.min(index, steps.length - 1)];
  const currentLine = step.line;
  const variables = Object.entries(step.variables || {});

  return (
    <Panel
      title={component.title || 'Execution trace'}
      subtitle={component.description}
      action={
        <div className="flex items-center gap-1">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="Previous step">
            <ChevronLeft className="h-3 w-3" aria-hidden />
          </button>
          {component.playback !== false ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                setPlaying((p) => !p);
                if (index >= steps.length - 1) setIndex(0);
              }}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}
            </button>
          ) : null}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))} disabled={index >= steps.length - 1} aria-label="Next step">
            <ChevronRight className="h-3 w-3" aria-hidden />
          </button>
          <span className="ml-1 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            {index + 1}/{steps.length}
          </span>
        </div>
      }
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Code</p>
          <ol className="overflow-x-auto rounded-lg bg-slate-950 py-1.5 font-mono text-[12px] leading-5">
            {codeLines.map((line, lineIndex) => {
              const number = lineIndex + 1;
              const active = number === currentLine;
              return (
                <li key={number} className={cx('flex gap-2 px-2', active ? 'bg-brand-500/25' : '')} aria-current={active ? 'step' : undefined}>
                  <span className="w-5 shrink-0 select-none text-right text-slate-500">{number}</span>
                  <span className="whitespace-pre text-slate-100">{line || ' '}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="space-y-2" aria-live="polite">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Variables</p>
            {variables.length ? (
              <dl className="grid grid-cols-2 gap-1.5">
                {variables.map(([name, value]) => (
                  <div key={name} className="rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700">
                    <dt className="font-mono text-[10.5px] text-slate-500 dark:text-slate-400">{name}</dt>
                    <dd className="break-words font-mono text-xs text-slate-800 dark:text-slate-100">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-slate-400">No variables in scope at this step.</p>
            )}
          </div>

          {step.call_stack?.length ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Call stack</p>
              <ol className="space-y-0.5 font-mono text-[11.5px] text-slate-700 dark:text-slate-200">
                {step.call_stack.map((frame, i) => (
                  <li key={i} className={cx('rounded px-1.5 py-0.5', i === step.call_stack.length - 1 ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200' : 'bg-slate-50 dark:bg-slate-800/50')}>
                    {frame}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {step.output ? (
            <p className="rounded-lg bg-slate-900 px-2 py-1.5 font-mono text-[12px] text-slate-100">
              <span className="text-slate-400">output → </span>
              {step.output}
            </p>
          ) : null}

          {step.note ? <p className="text-[11.5px] italic text-slate-500 dark:text-slate-400">{step.note}</p> : null}
        </div>
      </div>
    </Panel>
  );
}

export default function ExecutionRenderer({ component }) {
  if (component.type === 'execution_table') return <ExecutionTable component={component} />;
  if (component.type === 'variable_visualization') return <VariableVisualization component={component} />;
  return <ExecutionTrace component={component} />;
}
