import { useMemo, useState } from 'react';
import { FlaskConical, Info } from 'lucide-react';
import { Empty, Panel, TONE_BG } from './shared';
import { cx } from '../../ui';

/**
 * `simulation` — parameter exploration without executing model code.
 *
 * This is the safe version of "a simulation": the author supplies parameter
 * ranges and *outcome descriptions* with conditions, and the component tells the
 * student which described regime their current parameters fall in. It never
 * evaluates a formula from the document — a formula is displayed as LaTeX text,
 * and the numeric feedback comes from the declared `when` conditions.
 *
 * A simulation kind of `sequence` walks declared steps; `prediction` asks the
 * student to commit to a prediction before revealing the outcome, which is the
 * pedagogically useful version of the same data.
 */
export default function SimulationRenderer({ component }) {
  const parameters = component.parameters || [];
  const [values, setValues] = useState(() => Object.fromEntries(parameters.map((p) => [p.id, clamp(p.default, p)])));
  const [prediction, setPrediction] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const activeOutcomes = useMemo(() => {
    return (component.outcomes || []).filter((outcome) => {
      if (!outcome.when) return false;
      return Object.entries(outcome.when).every(([key, expected]) => {
        const actual = values[key];
        if (actual === undefined) return false;
        return Math.abs(Number(actual) - Number(expected)) <= 1e-9;
      });
    });
  }, [component.outcomes, values]);

  if (!parameters.length && !component.steps?.length) {
    return (
      <Panel title={component.title} className={cx(component.style?.width === 'half' ? 'sm:w-1/2' : 'w-full')}>
        <Empty label="This simulation has no parameters." icon={FlaskConical} />
      </Panel>
    );
  }

  const steps = component.steps || [];

  return (
    <Panel title={component.title || 'Try it'} subtitle={component.description} icon={component.style?.icon || 'flask'}>
      <div className="space-y-3">
        {parameters.length ? (
          <div className="space-y-2.5">
            {parameters.map((parameter) => (
              <div key={parameter.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <label htmlFor={`${component.id}-${parameter.id}`} className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    {parameter.label}
                  </label>
                  <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                    {values[parameter.id]}
                    {parameter.unit ? ` ${parameter.unit}` : ''}
                  </span>
                </div>
                <input
                  id={`${component.id}-${parameter.id}`}
                  type="range"
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step}
                  value={values[parameter.id]}
                  onChange={(e) => setValues((current) => ({ ...current, [parameter.id]: Number(e.target.value) }))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600 dark:bg-slate-700"
                />
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>{parameter.min}</span>
                  <span>{parameter.max}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {component.formula_latex ? (
          <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            <Info className="mr-1 inline h-3 w-3" aria-hidden /> The model behind this: {component.formula_latex}
          </p>
        ) : null}

        {component.simulation_kind === 'prediction' ? (
          <div className="space-y-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
            <label htmlFor={`${component.id}-prediction`} className="text-xs font-medium text-slate-700 dark:text-slate-200">
              What do you expect to happen?
            </label>
            <input
              id={`${component.id}-prediction`}
              className="input"
              value={prediction}
              onChange={(e) => setPrediction(e.target.value)}
              placeholder="Commit to a prediction before revealing the outcome…"
            />
            <button type="button" className="btn-secondary btn-sm" onClick={() => setRevealed(true)} disabled={!prediction.trim() || revealed}>
              Reveal the outcome
            </button>
            {revealed ? (
              <div className="space-y-1">
                {activeOutcomes.length ? (
                  activeOutcomes.map((outcome, index) => (
                    <div key={index} className={cx('rounded-lg px-2.5 py-1.5 text-xs', TONE_BG.brand, 'text-slate-700 dark:text-slate-200')}>
                      <span className="font-semibold">{outcome.label}</span>
                      {outcome.detail ? <span> — {outcome.detail}</span> : null}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">No declared outcome matches these settings. Try moving a slider, then predict again.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : activeOutcomes.length ? (
          <div className="space-y-1.5">
            {activeOutcomes.map((outcome, index) => (
              <div key={index} className={cx('rounded-lg px-2.5 py-2 text-xs', TONE_BG.brand, 'text-slate-700 dark:text-slate-200')}>
                <p className="font-semibold text-brand-800 dark:text-brand-300">{outcome.label}</p>
                {outcome.detail ? <p className="mt-0.5">{outcome.detail}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">Adjust a parameter to see which regime you are in.</p>
        )}

        {steps.length ? (
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Step {stepIndex + 1} of {steps.length}
              </p>
              <div className="flex gap-1">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={stepIndex === 0}>
                  Back
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))} disabled={stepIndex === steps.length - 1}>
                  Next
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">{steps[stepIndex].label}</p>
            {steps[stepIndex].detail ? <p className="text-xs text-slate-600 dark:text-slate-300">{steps[stepIndex].detail}</p> : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function clamp(value, parameter) {
  const n = Number(value);
  if (!Number.isFinite(n)) return parameter.min;
  return Math.min(parameter.max, Math.max(parameter.min, n));
}
