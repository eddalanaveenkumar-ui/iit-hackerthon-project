import { useMemo, useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import { cx } from './ui';

/**
 * The assessment answering surface.
 *
 * Shape follows the reference the user supplied: a document-style sheet with a
 * live "answered" counter, one numbered question per block, a type chip, and a
 * single answer field underneath. Deliberately plain — an assessment is a form,
 * not a dashboard.
 */
export function AnswerSheet({ title, level, marks, minutes, questions, answers, onAnswer, onSubmit, submitting, footer }) {
  const [collapsed, setCollapsed] = useState({});
  const answered = useMemo(
    () => questions.filter((q) => String(answers?.[q.id] ?? '').trim().length > 0).length,
    [questions, answers],
  );
  const pct = questions.length ? Math.round((answered / questions.length) * 100) : 0;
  const allAnswered = answered === questions.length && questions.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-3">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {level ? <Chip tone="green">{level}</Chip> : null}
          <Chip tone="blue">{marks} Marks</Chip>
          <Chip tone="slate">
            <Clock className="mr-1 h-3 w-3" />
            {minutes} Minutes
          </Chip>
        </div>
      </header>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Student Answer Sheet</h2>
            <span
              className={cx(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                allAnswered
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
              )}
            >
              {answered}/{questions.length} answered
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <ol>
          {questions.map((q, i) => {
            const value = answers?.[q.id] ?? '';
            const filled = String(value).trim().length > 0;
            const isOpen = !collapsed[q.id];
            return (
              <li key={q.id} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      onClick={() => setCollapsed((c) => ({ ...c, [q.id]: isOpen }))}
                      className="flex min-w-0 items-center gap-1.5 text-left"
                    >
                      <ChevronDown
                        className={cx('h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform', !isOpen && '-rotate-90')}
                      />
                      <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Question {i + 1}</span>
                      {filled ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="answered" /> : null}
                    </button>
                    <span className="flex shrink-0 items-center gap-1">
                      {q.difficulty ? <Chip tone="slate">{q.difficulty}</Chip> : null}
                      <Chip tone={q.type === 'multiple_choice' ? 'violet' : 'blue'}>
                        {q.type === 'multiple_choice' ? 'Objective' : 'Theory'}
                      </Chip>
                    </span>
                  </div>

                  {isOpen ? (
                    <>
                      <p className="mt-2 pl-5 text-[13.5px] leading-relaxed text-slate-700 dark:text-slate-200">{q.prompt}</p>

                      {q.type === 'multiple_choice' && q.options?.length ? (
                        <div className="mt-2.5 space-y-1.5 pl-5">
                          {q.options.map((opt, oi) => (
                            <label
                              key={oi}
                              className={cx(
                                'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors',
                                value === String(oi)
                                  ? 'border-brand-400 bg-brand-50/60 text-brand-900 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-100'
                                  : 'border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600',
                              )}
                            >
                              <input
                                type="radio"
                                name={`q-${q.id}`}
                                className="mt-1 accent-brand-600"
                                checked={value === String(oi)}
                                onChange={() => onAnswer(q.id, String(oi))}
                              />
                              <span>{opt}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2.5 pl-5">
                          <textarea
                            rows={3}
                            value={value}
                            onChange={(e) => onAnswer(q.id, e.target.value)}
                            placeholder="Type your answer here..."
                            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {allAnswered ? 'All questions answered.' : `${questions.length - answered} remaining.`} Answers save as you type.
          </p>
          {onSubmit ? (
            <button onClick={onSubmit} disabled={submitting || answered === 0} className="btn-primary btn-sm">
              {submitting ? 'Submitting…' : 'Submit assessment'}
            </button>
          ) : null}
        </div>
      </section>
      {footer}
    </div>
  );
}

const TONES = {
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function Chip({ children, tone = 'slate' }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', TONES[tone])}>
      {children}
    </span>
  );
}
