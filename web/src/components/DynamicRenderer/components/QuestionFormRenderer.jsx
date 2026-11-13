import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Lightbulb,
  Send,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useDynamicActions, useSafeToast } from '../DynamicContext';
import { QUESTION_LABELS } from '../schemas/uiSchema';
import { sanitizeAnswers } from '../utils/validateUI';
import { Empty, Panel } from './shared';
import { Spinner, cx } from '../../ui';

/**
 * DYNAMIC QUESTION FORM ENGINE
 * ============================
 *
 * One form, many questions, ONE submit button at the end. This is the component
 * the whole "ask the student something" workflow depends on, so its behaviour is
 * specified rather than incidental:
 *
 *  - every answer lives in one reducer, keyed by form id, so a re-render caused
 *    by a sibling component cannot lose it;
 *  - validation runs on submit (not on every keystroke), then re-runs on change
 *    once it has failed — the student is told what is missing, then sees the
 *    error clear as they fix it;
 *  - optional questions can be left blank;
 *  - submission is disabled while invalid *or* in flight, and duplicate
 *    submissions are blocked in three places: this component's `submitting` flag,
 *    the host action's in-flight promise, and the server's idempotency record;
 *  - on a recoverable error the entered answers are preserved and the button is
 *    re-enabled;
 *  - the result renders per-question verdicts, a hint where the verdict is wrong,
 *    and a follow-up form when the tutor asked for one.
 *
 * Files: `file_upload` is enforced here (type + size) before anything is sent,
 * and the payload carries a reference, never the bytes.
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

function normaliseOptions(options = []) {
  return options.map((option, index) => (typeof option === 'string' ? { value: option, label: option } : { value: String(option.value ?? option.label ?? index), label: option.label ?? option.value ?? String(index) }));
}

function initialValue(question, answers) {
  if (Object.prototype.hasOwnProperty.call(answers, question.id)) return answers[question.id];
  if (question.default_value !== undefined) return question.default_value;
  switch (question.type) {
    case 'checkbox_group':
      return [];
    case 'boolean':
      return null;
    default:
      return '';
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'set':
      return { ...state, values: { ...state.values, [action.id]: action.value } };
    case 'reset':
      return { values: {}, errors: {}, touched: {}, submitted: false };
    case 'submit-start':
      return { ...state, submitting: true, submitError: '', submitted: false };
    case 'submit-error':
      return { ...state, submitting: false, submitError: action.message };
    case 'validate':
      return { ...state, errors: action.errors, touched: { ...state.touched, ...action.touched } };
    case 'submitted':
      // The evaluation is its own field. Storing it inside `values` (as
      // `values.__result`) put a response object where the form expects an
      // answer, which leaked into the payload and into draft persistence.
      return { ...state, submitting: false, submitted: true, result: action.result, submitError: '' };
    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* field                                                                      */
/* -------------------------------------------------------------------------- */

function Field({ question, value, error, disabled, onChange, onBlur, fieldId }) {
  // Every control is identified by `fieldId` so the surrounding <label htmlFor>
  // resolves. A label that points at an id no control uses is not merely an
  // accessibility defect: clicking the label does nothing, and `getByLabelText`
  // (how a screen reader and this test suite both find a control) finds nothing.
  const id = fieldId;
  const describedBy = [question.description ? `${id}-desc` : null, question.hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(' ') || undefined;
  const invalid = Boolean(error);
  const inputClass = cx('input', invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20');

  switch (question.type) {
    case 'textarea':
      return <textarea id={id} className={cx(inputClass, 'min-h-[92px]')} placeholder={question.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} disabled={disabled} aria-describedby={describedBy} aria-invalid={invalid} />;
    case 'radio':
      return (
        <div className="space-y-1.5" role="radiogroup" id={id} aria-labelledby={`${id}-label`} aria-describedby={describedBy} aria-invalid={invalid}>
          {normaliseOptions(question.options).map((option, index) => (
            <label
              key={`${option.value}-${index}`}
              className={cx(
                'flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm transition-colors',
                value === option.value ? 'border-brand-500 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-950/30' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input type="radio" name={id} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" checked={value === option.value} onChange={() => onChange(option.value)} disabled={disabled} />
              <span className="min-w-0 flex-1">{option.label}</span>
            </label>
          ))}
        </div>
      );
    case 'checkbox_group': {
      const list = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-1.5" role="group" id={id} aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
          {normaliseOptions(question.options).map((option, index) => {
            const checked = list.includes(option.value);
            return (
              <label
                key={`${option.value}-${index}`}
                className={cx(
                  'flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm transition-colors',
                  checked ? 'border-brand-500 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-950/30' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange(checked ? list.filter((v) => v !== option.value) : [...list, option.value])}
                />
                <span className="min-w-0 flex-1">{option.label}</span>
              </label>
            );
          })}
        </div>
      );
    }
    case 'select':
      return (
        <select id={id} className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} disabled={disabled} aria-describedby={describedBy} aria-invalid={invalid}>
          <option value="">{question.placeholder || 'Choose…'}</option>
          {normaliseOptions(question.options).map((option, index) => (
            <option key={`${option.value}-${index}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case 'number':
      return (
        <input
          id={id}
          type="number"
          className={inputClass}
          placeholder={question.placeholder}
          value={value ?? ''}
          min={question.min ?? question.validation?.min}
          max={question.max ?? question.validation?.max}
          step={question.step ?? question.validation?.step}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      );
    case 'slider': {
      const min = question.min ?? question.validation?.min ?? 0;
      const max = question.max ?? question.validation?.max ?? 10;
      const step = question.step ?? question.validation?.step ?? 1;
      const current = value === '' || value === null || value === undefined ? min : Number(value);
      return (
        <div>
          <div className="flex items-center gap-3">
            <input
              id={id}
              type="range"
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600 dark:bg-slate-700"
              min={min}
              max={max}
              step={step}
              value={Number.isFinite(current) ? current : min}
              onChange={(e) => onChange(Number(e.target.value))}
              disabled={disabled}
              aria-describedby={describedBy}
            />
            <span className="w-12 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center font-mono text-xs tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {Number.isFinite(current) ? current : min}
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{min}</span>
            <span>{max}</span>
          </div>
        </div>
      );
    }
    case 'date':
      return <input id={id} type="date" className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} disabled={disabled} aria-describedby={describedBy} aria-invalid={invalid} />;
    case 'boolean':
      return (
        <div className="flex gap-2" role="radiogroup" id={id} aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
          {[
            { label: 'Yes', v: true },
            { label: 'No', v: false },
          ].map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="radio"
              aria-checked={value === choice.v}
              disabled={disabled}
              onClick={() => onChange(choice.v)}
              className={cx(
                'btn-sm rounded-lg border px-3 py-1.5 text-sm',
                value === choice.v ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-300' : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300',
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
      );
    case 'code_input':
      return (
        <textarea
          id={id}
          className={cx(inputClass, 'min-h-[132px] font-mono text-[12.5px] leading-relaxed')}
          spellCheck={false}
          autoComplete="off"
          placeholder={question.placeholder || `Write ${question.language || 'code'}…`}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      );
    case 'file_upload':
      return (
        <div>
          <input
            id={id}
            type="file"
            className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-300 dark:file:bg-slate-800 dark:file:text-slate-200"
            accept={(question.accept?.length ? question.accept : DEFAULT_ACCEPT).join(',')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.files?.[0] || null)}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
          {value?.name ? (
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {value.name} · {Math.round((value.size || 0) / 1024)} KB
            </p>
          ) : null}
        </div>
      );
    default:
      return <input id={id} type="text" className={inputClass} placeholder={question.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} disabled={disabled} aria-describedby={describedBy} aria-invalid={invalid} />;
  }
}

/* -------------------------------------------------------------------------- */
/* validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Validate every question. Returns `{ errors, missing }` — errors keyed by
 * question id for field-level display, `missing` as the count of required
 * questions that are still empty (used for the button's helper text).
 */
export function validateForm(questions, values) {
  const errors = {};
  let missing = 0;

  for (const question of questions) {
    const value = values[question.id];
    const options = normaliseOptions(question.options).map((o) => o.value);
    const isEmpty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

    if (isEmpty) {
      // `required` defaults to *false*. The field is optional in the protocol and
      // the server treats only `required === true` as mandatory; defaulting to
      // true here made every question mandatory and could not be satisfied by a
      // generated form that omitted the flag.
      if (question.required === true) {
        missing += 1;
        errors[question.id] = question.type === 'checkbox_group' ? 'Choose at least one option.' : 'This question is required.';
      }
      continue;
    }

    if (question.type === 'radio' && options.length && !options.includes(String(value))) {
      errors[question.id] = 'Choose one of the offered options.';
      continue;
    }

    if (question.type === 'checkbox_group') {
      const list = Array.isArray(value) ? value.map(String) : [];
      if (options.length && list.some((v) => !options.includes(v))) errors[question.id] = 'One or more selections are not offered options.';
      continue;
    }

    if (question.type === 'number' || question.type === 'slider') {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        errors[question.id] = 'Enter a number.';
        continue;
      }
      const min = question.min ?? question.validation?.min;
      const max = question.max ?? question.validation?.max;
      if (min !== undefined && number < Number(min)) errors[question.id] = `Must be at least ${min}.`;
      else if (max !== undefined && number > Number(max)) errors[question.id] = `Must be at most ${max}.`;
      continue;
    }

    if (question.type === 'boolean' && typeof value !== 'boolean') {
      errors[question.id] = 'Answer yes or no.';
      continue;
    }

    if (question.type === 'file_upload') {
      if (!value || typeof value !== 'object') {
        errors[question.id] = 'Choose a file.';
      } else if (value.size > MAX_FILE_BYTES) {
        errors[question.id] = `Files are limited to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`;
      } else if (value.type) {
        const accept = question.accept?.length ? question.accept : DEFAULT_ACCEPT;
        const allowed = accept.some((type) => (type.includes('/') ? type === value.type : value.type.includes(type)));
        if (!allowed) errors[question.id] = `Accepted types: ${accept.map((t) => t.split('/').pop()).join(', ')}.`;
      }
      continue;
    }

    if (typeof value === 'string') {
      const minLength = question.validation?.min_length;
      const maxLength = question.validation?.max_length;
      if (minLength && value.trim().length < Number(minLength)) errors[question.id] = `Write at least ${minLength} characters.`;
      else if (maxLength && value.length > Number(maxLength)) errors[question.id] = `Write at most ${maxLength} characters.`;
      else if (question.validation?.pattern === 'email' && value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) errors[question.id] = 'Enter a valid email address.';
      else if (question.validation?.pattern === 'url' && value && !/^https?:\/\//i.test(value)) errors[question.id] = 'Enter a URL starting with https://';
      else if (question.validation?.pattern === 'alphanumeric' && value && !/^[A-Za-z0-9 ]+$/.test(value)) errors[question.id] = 'Use letters and numbers only.';
    }
  }

  return { errors, missing, valid: Object.keys(errors).length === 0 };
}

/* -------------------------------------------------------------------------- */
/* result                                                                     */
/* -------------------------------------------------------------------------- */

const VERDICT_STYLE = {
  correct: { tone: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2, label: 'Correct' },
  partly_correct: { tone: 'text-amber-700 dark:text-amber-400', icon: CircleAlert, label: 'Partly correct' },
  incorrect: { tone: 'text-rose-700 dark:text-rose-400', icon: XCircle, label: 'Needs work' },
  unanswered: { tone: 'text-slate-500 dark:text-slate-400', icon: CircleAlert, label: 'Not answered' },
  not_graded: { tone: 'text-slate-500 dark:text-slate-400', icon: CircleAlert, label: 'Recorded' },
};

function EvaluationResult({ result, onFollowUp }) {
  // The route nests everything under `evaluation`; older lessons stored the
  // fields at the top level. Read both so a stored or replayed response renders
  // its score instead of silently dropping it.
  const evaluation = result?.evaluation || result || {};
  const perQuestion = evaluation.per_question || [];
  const score = evaluation.score;

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/30">
        <Sparkles className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <p className="text-xs font-medium text-emerald-900 dark:text-emerald-200">
          Answers submitted{score !== null && score !== undefined ? ` · ${score}%` : ''}
        </p>
        {evaluation.source === 'local' ? <span className="badge bg-white/70 text-[10px] text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">local grading</span> : null}
      </div>

      {evaluation.overall ? (
        <p className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">{evaluation.overall}</p>
      ) : null}

      {evaluation.gaps?.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Knowledge gaps</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-900 dark:text-amber-200">
            {evaluation.gaps.slice(0, 5).map((gap, i) => (
              <li key={i}>{typeof gap === 'string' ? gap : gap?.message || ''}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {perQuestion.length ? (
        <ul className="space-y-1.5">
          {perQuestion.map((entry) => {
            const style = VERDICT_STYLE[entry.verdict] || VERDICT_STYLE.not_graded;
            const IconComponent = style.icon;
            return (
              <li key={entry.question_id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <p className={cx('flex items-center gap-1.5 text-[11.5px] font-semibold', style.tone)}>
                  <IconComponent className="h-3.5 w-3.5" aria-hidden />
                  {style.label} · {entry.question_id}
                </p>
                {entry.feedback ? <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{entry.feedback}</p> : null}
                {entry.hint ? (
                  <p className="mt-1 flex items-start gap-1 text-[11px] text-brand-700 dark:text-brand-300">
                    <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {entry.hint}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {evaluation.next_step ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900 dark:bg-brand-950/30 dark:text-brand-200">
          <span className="font-semibold">Next step: </span>
          {evaluation.next_step}
        </p>
      ) : null}

      {result?.follow_up_form ? (
        <div className="rounded-xl2 border border-dashed border-brand-300 p-2.5 dark:border-brand-800">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">One more thing</p>
          <QuestionFormRenderer component={result.follow_up_form} embedded onFollowUp={onFollowUp} />
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* the form                                                                   */
/* -------------------------------------------------------------------------- */

export default function QuestionFormRenderer({ component, embedded = false, onFollowUp }) {
  const { actions, lessonId, classroomId, conversationId } = useDynamicActions();
  const toast = useSafeToast();
  const questions = component.questions || component.fields || [];
  const formId = component.id;

  const [state, dispatch] = useReducer(reducer, { values: {}, errors: {}, touched: {}, submitting: false, submitted: false, submitError: '', result: null });
  const [attempted, setAttempted] = useState(false);
  const inFlight = useRef(false);
  const topRef = useRef(null);
  const submittedSnapshot = useRef(null);

  // Answers are restored for this form if the component remounts (tab switch in
  // a `tabs` container, for example). State is isolated by form id, so two forms
  // on one page never share a value.
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(`lm.form.${formId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        for (const [key, value] of Object.entries(parsed || {})) {
          if (questions.some((q) => q.id === key) && typeof value !== 'object') dispatch({ type: 'set', id: key, value });
        }
      }
    } catch {
      /* storage unavailable — start empty */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  const persist = useCallback(
    (values) => {
      try {
        const safe = {};
        for (const [key, value] of Object.entries(values)) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) safe[key] = value;
        }
        window.sessionStorage.setItem(`lm.form.${formId}`, JSON.stringify(safe));
      } catch {
        /* storage unavailable */
      }
    },
    [formId],
  );

  // Mirror of the current values, read by the async submit handler and by
  // `setValue` for persistence. It is declared before both so neither closes
  // over a `const` that has not been initialised yet (a temporal dead zone, which
  // throws at render time and blanks the whole form).
  const valuesRef = useRef({});
  valuesRef.current = state.values;

  const setValue = useCallback(
    (questionId, value) => {
      dispatch({ type: 'set', id: questionId, value });
      // Persist immediately so a remount (tab switch, navigation) restores the
      // draft. Only primitives and string arrays are stored — never a File.
      persist({ ...valuesRef.current, [questionId]: value });
    },
    [persist],
  );

  const { errors, missing, valid } = useMemo(() => {
    const result = validateForm(questions, state.values);
    return { errors: result.errors, missing: result.missing, valid: result.valid };
  }, [questions, state.values]);

  if (!questions.length) return <Empty label="This form has no questions." />;

  const submitLabel = component.submission?.button_text || 'Submit answers for evaluation';

  const submit = async () => {
    if (inFlight.current || state.submitting) return;
    setAttempted(true);

    const { errors: currentErrors, valid: currentValid, missing: currentMissing } = validateForm(questions, valuesRef.current);
    if (!currentValid) {
      dispatch({ type: 'validate', errors: currentErrors, touched: Object.fromEntries(questions.map((q) => [q.id, true])) });
      toast?.error?.(currentMissing ? `${currentMissing} required question${currentMissing > 1 ? 's are' : ' is'} still empty.` : 'Some answers need attention.');
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    inFlight.current = true;
    dispatch({ type: 'submit-start' });

    try {
      const payloadAnswers = questions
        .map((q) => {
          const value = valuesRef.current[q.id];
          const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
          if (empty) return null;
          if (q.type === 'file_upload' && value) {
            // Files are described, never embedded in the JSON payload.
            return { question_id: q.id, value: { file_id: `client-${formId}-${q.id}`, name: String(value.name || '').slice(0, 200), size: value.size, type: value.type } };
          }
          return { question_id: q.id, value };
        })
        .filter(Boolean);

      const response = await actions.submitAnswers(formId, {
        form_id: formId,
        lesson_id: lessonId || undefined,
        // The AI conversation this question belongs to. It is the lesson when the
        // form came from one, and the form itself otherwise — an ad-hoc form in
        // chat still needs a conversation for the evaluator to reply into.
        conversation_id: lessonId || conversationId || formId,
        classroom_id: classroomId || undefined,
        answers: payloadAnswers.map((a) => ({ ...a, value: typeof a.value === 'string' ? sanitizeAnswers({ v: a.value }).v : a.value })),
      });

      if (!response || response.ok === false) {
        throw new Error(response?.reason || 'The answers could not be submitted.');
      }

      submittedSnapshot.current = valuesRef.current;
      dispatch({ type: 'submitted', result: response });
      try {
        window.sessionStorage.removeItem(`lm.form.${formId}`);
      } catch {
        /* ignore */
      }
      if (lessonId) actions.markComplete(formId);
      if (response.evaluation?.score !== null && response.evaluation?.score !== undefined) {
        toast?.info?.(`Evaluated — ${response.evaluation.score}%`);
      }
    } catch (e) {
      dispatch({ type: 'submit-error', message: e.message || 'The answers could not be submitted.' });
      // Answers are deliberately NOT cleared: a network failure must not cost the
      // student what they wrote.
      toast?.error?.('Submission failed — your answers are kept.');
    } finally {
      inFlight.current = false;
    }
  };

  const retry = () => {
    dispatch({ type: 'validate', errors: {}, touched: {} });
    dispatch({ type: 'submit-error', message: '' });
    submit();
  };

  const result = state.submitted ? state.result : null;
  const body = (
    <div className="space-y-4" ref={topRef}>
      {state.submitted && result ? (
        <EvaluationResult result={result} onFollowUp={onFollowUp} />
      ) : (
        <>
          <ol className="space-y-4">
            {questions.map((question, index) => {
              const fieldId = `${formId}-${question.id}`;
              const error = attempted ? errors[question.id] : state.errors[question.id];
              return (
                <li key={question.id} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <label id={`${fieldId}-label`} htmlFor={fieldId} className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                      <span className="mr-1.5 text-xs tabular-nums text-slate-400">{index + 1}.</span>
                      {question.question}
                      {question.required === true ? (
                        <span className="ml-1 text-rose-500" aria-hidden>
                          *
                        </span>
                      ) : (
                        <span className="ml-1.5 text-[10.5px] font-normal uppercase tracking-wide text-slate-400">optional</span>
                      )}
                    </label>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {QUESTION_LABELS[question.type] || question.type}
                    </span>
                  </div>

                  {question.description ? (
                    <p id={`${fieldId}-desc`} className="text-[11.5px] leading-snug text-slate-500 dark:text-slate-400">
                      {question.description}
                    </p>
                  ) : null}

                  <Field
                    question={question}
                    fieldId={fieldId}
                    value={initialValue(question, state.values)}
                    error={error}
                    disabled={state.submitting}
                    onChange={(value) => setValue(question.id, value)}
                    onBlur={() => {
                      if (!attempted) return;
                      const current = validateForm(questions, valuesRef.current);
                      dispatch({ type: 'validate', errors: current.errors, touched: { [question.id]: true } });
                    }}
                  />

                  {error ? (
                    <p id={`${fieldId}-err`} className="flex items-center gap-1 text-[11.5px] font-medium text-rose-600 dark:text-rose-400" role="alert">
                      <CircleAlert className="h-3 w-3 shrink-0" aria-hidden /> {error}
                    </p>
                  ) : null}

                  {question.hint ? (
                    <details className="group">
                      <summary id={`${fieldId}-hint`} className="cursor-pointer list-none text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400">
                        <Lightbulb className="mr-1 inline h-3 w-3" aria-hidden /> Hint
                      </summary>
                      <p className="mt-0.5 text-[11.5px] text-slate-600 dark:text-slate-300">{question.hint}</p>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {state.submitError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/40" role="alert">
              <p className="text-xs text-rose-800 dark:text-rose-300">{state.submitError} Your answers have been kept.</p>
              <button type="button" onClick={retry} className="btn-secondary btn-sm" disabled={state.submitting}>
                Try again
              </button>
            </div>
          ) : null}

          {/* Exactly one submit button, full width, after the last question. */}
          <div className="space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
            <button type="button" onClick={submit} className="btn-primary w-full" disabled={state.submitting || (attempted && !valid)} aria-disabled={state.submitting}>
              {state.submitting ? <Spinner /> : <Send className="h-4 w-4" aria-hidden />}
              {state.submitting ? 'Submitting for evaluation…' : submitLabel}
            </button>
            <p className="text-center text-[11px] text-slate-400">
              {missing > 0 ? `${missing} required question${missing > 1 ? 's' : ''} left. ` : ''}
              One submission sends every answer together.
            </p>
          </div>
        </>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <Panel title={component.title || 'A few questions'} subtitle={component.description}>
      {body}
    </Panel>
  );
}

export { MAX_FILE_BYTES };
