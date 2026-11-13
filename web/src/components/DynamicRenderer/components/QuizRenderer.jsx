import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Lightbulb, RotateCcw, XCircle } from 'lucide-react';
import { useDynamicActions } from '../DynamicContext';
import { Empty, Panel } from './shared';
import { ProgressBar, Spinner, cx } from '../../ui';

/**
 * `quiz` — multiple-choice with server grading.
 *
 * Local state is only for selection and for rendering the result the server
 * returned. The correct answers are *not* trusted from the component: the
 * submission goes to `/api/learning/quiz/submit`, which compares against the
 * stored lesson. That is what makes the score meaningful rather than decorative.
 *
 * Feedback is per question, with the explanation shown only after submission —
 * otherwise the quiz teaches nothing, it just tests clicking.
 */
export default function QuizRenderer({ component }) {
  const { actions, lessonId } = useDynamicActions();
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [hintFor, setHintFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const questions = component.questions || [];
  const answeredCount = useMemo(() => Object.values(answers).filter((v) => Number.isInteger(v)).length, [answers]);
  const complete = answeredCount === questions.length;
  const score = result?.score ?? null;
  const passingScore = component.passing_score ?? 70;

  if (!questions.length) return <Empty label="This quiz has no questions." />;

  const submit = async () => {
    if (busy || !complete) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        quiz_id: component.id,
        lesson_id: lessonId,
        answers: questions.map((q) => ({ question_id: q.id, value: answers[q.id] })),
      };
      const response = await actions.submitQuiz(component.id, payload);
      if (response?.ok === false) throw new Error(response.reason || 'The quiz could not be submitted.');
      setResult(response);
    } catch (e) {
      setError(e.message || 'The quiz could not be submitted.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setAnswers({});
    setResult(null);
    setError('');
  };

  return (
    <Panel
      title={component.title || 'Knowledge check'}
      subtitle={component.description}
      action={
        result ? (
          <span className={cx('badge', score >= passingScore ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300')}>
            {score}% · {result.correct}/{result.max}
          </span>
        ) : (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {answeredCount}/{questions.length} answered
          </span>
        )
      }
    >
      <div className="space-y-4">
        {!result ? <ProgressBar value={(answeredCount / questions.length) * 100} className="mb-1" /> : null}

        {questions.map((question, index) => {
          const chosen = answers[question.id];
          const outcome = result?.results?.find((r) => r.questionId === question.id);
          return (
            <fieldset key={question.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" disabled={Boolean(result) || busy}>
              <legend className="px-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                <span className="mr-1.5 text-slate-400">{index + 1}.</span>
                {question.question}
              </legend>
              <div className="mt-2 space-y-1.5" role="radiogroup" aria-label={question.question}>
                {question.options.map((option, optionIndex) => {
                  const selected = chosen === optionIndex;
                  const isCorrect = outcome?.correctIndex === optionIndex;
                  const isWrongPick = outcome && selected && !outcome.correct;
                  return (
                    <label
                      key={optionIndex}
                      className={cx(
                        'flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm transition-colors',
                        selected && !result && 'border-brand-500 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-950/30',
                        !selected && !result && 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
                        result && isCorrect && 'border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30',
                        result && isWrongPick && 'border-rose-400 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30',
                        result && !isCorrect && !isWrongPick && 'border-slate-200 opacity-70 dark:border-slate-700',
                      )}
                    >
                      <input
                        type="radio"
                        name={`${component.id}-${question.id}`}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                        checked={selected}
                        onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))}
                      />
                      <span className="min-w-0 flex-1">{option}</span>
                      {result && isCorrect ? <span className="shrink-0 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">correct</span> : null}
                      {result && isWrongPick ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-label="Your answer was incorrect" /> : null}
                    </label>
                  );
                })}
              </div>

              {!result && question.hint ? (
                <div className="mt-2">
                  {hintFor === question.id ? (
                    <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                      <Lightbulb className="mr-1 inline h-3 w-3" aria-hidden />
                      {question.hint}
                    </p>
                  ) : (
                    <button type="button" onClick={() => setHintFor(question.id)} className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400">
                      Need a hint?
                    </button>
                  )}
                </div>
              ) : null}

              {result && component.show_explanations !== false && outcome?.explanation ? (
                <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  <span className="font-semibold">Why: </span>
                  {outcome.explanation}
                </p>
              ) : null}
            </fieldset>
          );
        })}

        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
            {error} Your selections are kept — you can try submitting again.
          </p>
        ) : null}

        {result ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
              {score >= passingScore ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> : <ChevronRight className="h-4 w-4 text-amber-600" aria-hidden />}
              {score >= passingScore ? `Passed — ${score}%` : `Scored ${score}% — target is ${passingScore}%`}
            </p>
            <button type="button" onClick={reset} className="btn-secondary btn-sm">
              <RotateCcw className="h-3 w-3" aria-hidden /> Try again
            </button>
          </div>
        ) : (
          <button type="button" onClick={submit} className="btn-primary w-full" disabled={!complete || busy}>
            {busy ? <Spinner /> : null}
            {busy ? 'Grading…' : complete ? 'Submit answers' : `Answer all ${questions.length} questions to submit`}
          </button>
        )}
      </div>
    </Panel>
  );
}
