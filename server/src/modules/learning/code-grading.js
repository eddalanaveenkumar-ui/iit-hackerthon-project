import crypto from 'node:crypto';
import { executeCode } from '../../utils/sandbox.js';

/**
 * SANDBOX-VERIFIED CODING ANSWERS
 * ===============================
 *
 * Spec 2, hard requirement: a coding question is graded by *running it*, not by
 * asking a language model whether it looks right. A model cannot know what
 * `return n * f(n - 1)` evaluates to for a given input, and it will confidently
 * call broken code correct.
 *
 * A `question_form` answer of type `code_input` is an arbitrary snippet the
 * student typed. To run it we need three things the answer does not carry:
 * a language, an entry point, and something to assert. So this module:
 *
 *   1. finds the submitted code answer and the authored question;
 *   2. derives a deterministic test (an expected value declared by the lesson
 *      author, or a small built-in check that proves the code *runs*);
 *   3. executes it in the same sandbox the practice workspace uses;
 *   4. turns the result into a verdict the evaluator must honour.
 *
 * The result is authoritative. It is merged into the evaluation *after* the
 * model responds, so a model that disagrees cannot override a failed test.
 *
 * Nothing here runs in the request handler synchronously — the caller awaits it,
 * and a sandbox failure is reported as `executed: false` rather than as a pass.
 */

/** Languages the sandbox can actually execute (see utils/sandbox.js). */
const RUNNABLE = new Set(['python', 'javascript']);

/**
 * Resolve the language a coding answer is written in.
 *
 * Returns the language the *question declares* even when it is not runnable
 * (java, sql). Collapsing that to python — as an earlier version did — meant a
 * Java answer was executed as Python and reported as a syntax error, which is
 * both wrong and confusing. Non-runnable languages are analysed statically and
 * reported as unverified.
 */
export function resolveLanguage(question, fallback = '') {
  const declared = String(question?.language || '').toLowerCase();
  if (declared) return declared;
  const hint = String(fallback || '').toLowerCase();
  if (hint) return hint;
  return 'python';
}

/**
 * Build the tests to run against a student's snippet.
 *
 * Priority:
 *   1. an expectation declared on the question (`expected_output` / `tests`);
 *   2. otherwise a smoke assertion that the code executes without error.
 *
 * The smoke assertion is honest about what it proves: it verifies the code
 * *runs*, not that it is correct. The verdict is `partly_correct`, never
 * `correct`, so a student is not told "right" on the strength of "did not crash".
 */
export function buildChecks(question, language) {
  const declared = [];

  // An author may supply a full test list (same shape as a code_editor's tests).
  for (const test of question?.tests || []) {
    if (!test || typeof test !== 'object') continue;
    declared.push({
      id: String(test.id || `t${declared.length + 1}`).slice(0, 64),
      name: String(test.name || 'Declared check').slice(0, 200),
      args: Array.isArray(test.args) ? test.args.slice(0, 4) : [],
      expected: test.expected,
    });
  }

  if (declared.length) return { tests: declared, kind: 'declared' };

  const expected = question?.expected_output;
  if (typeof expected === 'string' && expected.trim()) {
    // A single expected-output check: run the snippet, compare its stdout.
    return {
      tests: [{ id: 'expected_output', name: 'Produces the expected output', expectStdout: expected.trim() }],
      kind: 'output',
    };
  }

  return { tests: [{ id: 'smoke', name: 'Runs without error' }], kind: 'smoke' };
}

/** Compare stdout to an expected string, tolerating trailing whitespace. */
function stdoutMatches(stdout, expected) {
  const normalise = (value) =>
    String(value ?? '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim();
  return normalise(stdout) === normalise(expected);
}

/**
 * Execute one coding answer and summarise it for the evaluator.
 *
 * @returns {Promise<{
 *   question_id: string, language: string, executed: boolean,
 *   verdict: 'correct'|'partly_correct'|'incorrect',
 *   runtimeUnavailable?: boolean — set when this server could not run the code
 *     at all (no interpreter). Not evidence about the learner.
 *   feedback: string, output?: string, error?: string, checks: object[]
 * }>}
 */
export async function gradeCodeAnswer({ question, code }) {
  const language = resolveLanguage(question);
  const source = String(code ?? '');
  const base = { question_id: String(question?.id || ''), language, executed: false, checks: [] };

  if (!source.trim()) {
    return { ...base, verdict: 'incorrect', feedback: 'No code was submitted.' };
  }
  if (source.length > 20_000) {
    return { ...base, verdict: 'incorrect', feedback: 'The submission is too long to execute (limit 20 000 characters).' };
  }

  const { tests, kind } = buildChecks(question, language);

  if (!RUNNABLE.has(language)) {
    // Java/SQL: static analysis only, and say so rather than guessing.
    let analysis = null;
    try {
      const probe = await executeCode({ code: source, language, tests: [] });
      analysis = probe?.staticAnalysis || null;
    } catch {
      analysis = null;
    }
    const summary = Array.isArray(analysis?.issues) && analysis.issues.length
      ? analysis.issues.map((issue) => issue.message).slice(0, 2).join(' ')
      : 'No structural problems were detected.';
    return {
      ...base,
      verdict: 'partly_correct',
      static_only: true,
      feedback: `This deployment cannot execute ${language}, so the answer was reviewed statically and not verified by running it. ${summary}`,
    };
  }

  let result;
  try {
    // 'run' mode executes the snippet as a program and captures what it prints;
    // the solve()-with-tests mode is for function-shaped answers.
    result = await executeCode({ code: source, language, tests: kind === 'smoke' ? [] : tests, mode: 'run' });
  } catch {
    return { ...base, verdict: 'partly_correct', feedback: 'The code could not be executed just now, so it was not verified. Your answer was kept.' };
  }

  if (!result?.executed) {
    // Java/SQL, or a runtime that refused to start: never pretend it passed.
    const reason = result?.reason || result?.loadError || 'The sandbox did not run this submission.';
    return {
      ...base,
      verdict: 'partly_correct',
      // A missing interpreter is a fault in *this server*, not in the answer.
      // Callers must be able to tell the two apart so they do not file it as a
      // weakness of the learner.
      runtimeUnavailable: Boolean(result?.runtimeUnavailable),
      feedback: `${reason} It has been recorded but not verified.`,
    };
  }

  const stdout = String(result.stdout || '');
  const loadError = result.loadError ? String(result.loadError).slice(0, 400) : '';

  // A timeout is a failure, not a quiet success. Reporting "ran without error"
  // for a program that never finished would be the same class of lie this module
  // exists to prevent.
  if (result.timedOut) {
    return {
      ...base,
      executed: true,
      verdict: 'incorrect',
      error: 'Execution timed out',
      feedback: 'The code did not finish within the 5 second limit. Check for a loop that never ends, or an input it is waiting for.',
    };
  }

  if (kind === 'output') {
    const expected = tests[0].expectStdout;
    if (loadError) {
      return { ...base, executed: true, verdict: 'incorrect', output: stdout.slice(0, 400), error: loadError, feedback: `Running the code raised an error: ${loadError}` };
    }
    const passed = stdoutMatches(stdout, expected);
    return {
      ...base,
      executed: true,
      verdict: passed ? 'correct' : 'incorrect',
      output: stdout.slice(0, 400),
      checks: [{ id: 'expected_output', name: 'Produces the expected output', passed }],
      feedback: passed
        ? 'Executed in the sandbox and produced exactly the expected output.'
        : `Executed in the sandbox, but the output did not match. Expected “${expected.slice(0, 120)}”, got “${stdout.trim().slice(0, 120) || '(no output)'}”.`,
    };
  }

  if (kind === 'declared') {
    const passed = (result.results || []).filter((r) => r.passed).length;
    const total = (result.results || []).length;
    const allPassed = total > 0 && passed === total;
    return {
      ...base,
      executed: true,
      verdict: allPassed ? 'correct' : passed > 0 ? 'partly_correct' : 'incorrect',
      output: stdout.slice(0, 400),
      checks: result.results || [],
      feedback: allPassed
        ? `Passed all ${total} checks by real execution.`
        : `Passed ${passed} of ${total} checks by real execution.`,
    };
  }

  // Smoke: proves the snippet runs, nothing more.
  if (loadError) {
    return { ...base, executed: true, verdict: 'incorrect', output: stdout.slice(0, 400), error: loadError, feedback: `Running the code raised an error: ${loadError}` };
  }
  return {
    ...base,
    executed: true,
    verdict: 'partly_correct',
    output: stdout.slice(0, 400),
    checks: [{ id: 'smoke', name: 'Runs without error', passed: true }],
    feedback: 'Executed in the sandbox without error. This confirms the code runs; it was not checked against an expected result.',
  };
}

/**
 * Grade every coding answer in a submission.
 *
 * @returns {Promise<Array>} one entry per `code_input` answer, in question order
 */
export async function gradeCodingAnswers({ questions = [], answers = [] }) {
  const byId = new Map((answers || []).map((answer) => [String(answer?.question_id), answer?.value]));
  const coding = (questions || []).filter((q) => q?.type === 'code_input' && RUNNABLE.has(resolveLanguage(q)));

  const results = [];
  for (const question of coding) {
    const value = byId.get(String(question.id));
    if (value === undefined || value === null || value === '') continue;
    results.push(await gradeCodeAnswer({ question, code: value }));
  }
  return results;
}

/**
 * Force the execution verdict into an evaluation.
 *
 * The model is shown the execution results and *asked* to account for them, but
 * a model that contradicts a failed test must not be believed. Each graded
 * question's verdict is replaced by the sandbox's, and the feedback is prefixed
 * with what actually happened.
 */
export function applyExecutionVerdicts(evaluation, executions) {
  if (!Array.isArray(executions) || !executions.length) return evaluation;
  const byId = new Map(executions.map((execution) => [String(execution.question_id), execution]));
  const perQuestion = Array.isArray(evaluation?.per_question) ? evaluation.per_question.map((entry) => {
    const execution = byId.get(String(entry?.question_id));
    if (!execution) return entry;
    const verified = execution.verdict === 'correct';
    return {
      ...entry,
      // The sandbox is the authority on whether the code worked.
      verdict: execution.verdict,
      executed: true,
      verified,
      language: execution.language,
      output: execution.output,
      error: execution.error,
      feedback: execution.feedback,
    };
  }) : [];

  // A coding question the model did not mention still gets its verdict.
  for (const execution of executions) {
    if (perQuestion.some((entry) => String(entry?.question_id) === String(execution.question_id))) continue;
    perQuestion.push({
      question_id: execution.question_id,
      verdict: execution.verdict,
      executed: true,
      verified: execution.verdict === 'correct',
      language: execution.language,
      output: execution.output,
      error: execution.error,
      feedback: execution.feedback,
    });
  }

  const graded = perQuestion.filter((entry) => entry.verdict !== 'not_graded');
  const correct = perQuestion.filter((entry) => entry.verdict === 'correct').length;
  const score = graded.length ? Math.round((correct / perQuestion.length) * 100) : evaluation?.score ?? null;

  return {
    ...evaluation,
    per_question: perQuestion,
    score,
    // Recorded so the UI and any audit can see that code was verified, not judged.
    verified_by: executions.filter((e) => e.executed).length,
    ...(executions.some((execution) => execution.verdict === 'incorrect')
      ? { next_step: 'Fix the failing code in the practice workspace, then resubmit — the test that failed is shown with your answer.' }
      : {}),
  };
}

/**
 * Deterministic evaluator for a coding answer, used when the model is
 * unavailable. Mirrors the shape of the model's per-question entries.
 */
export function executionAsVerdict(execution) {
  return {
    question_id: execution.question_id,
    verdict: execution.verdict,
    feedback: execution.feedback,
    executed: true,
    verified: execution.verdict === 'correct',
    language: execution.language,
    output: execution.output,
    error: execution.error,
  };
}

/** Stable identifier for one execution attempt (used in logs, never trusted). */
export function executionId() {
  return `exec_${crypto.randomBytes(6).toString('hex')}`;
}
