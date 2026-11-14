import { z } from 'zod';
import { runJsonTask } from '../ai/orchestrator.js';
import { prompts } from '../ai/prompts.js';
import { parseComponent, repairUiDocument, UI_PROTOCOL_VERSION, UI_LIMITS } from '../ai/ui/protocol.js';
import { localEvaluateAnswers } from '../ai/ui/teaching-engine.js';
import { gradeCodingAnswers, applyExecutionVerdicts } from '../learning/code-grading.js';
import { executeCode } from '../../utils/sandbox.js';
import { factsFor, languageFor } from './question-bank.js';

/**
 * TRACS ENGINE
 * ============
 *
 * Two loops, both returning a **UI document** the existing renderer already
 * knows how to draw. Nothing here emits HTML, and nothing here invents a second
 * component vocabulary: a question is a `question_form` with exactly one
 * question in it, a lesson is whatever the protocol allows.
 *
 *   /test   ask one question -> grade it -> record the gap -> pick the next
 *   /learn  explain with renderings -> check understanding -> re-teach if missed
 *
 * Everything model-authored passes through `parseComponent` before it is
 * returned. That is the same gate the rest of the engine uses, so a malformed
 * component degrades to the deterministic fallback instead of reaching React.
 */

/* -------------------------------------------------------------------------- */
/* documents                                                                  */
/* -------------------------------------------------------------------------- */

const encoder = () => Math.random().toString(36).slice(2, 10);

export function makeDocument(components, { responseType = 'educational_tutorial', topic = '' } = {}) {
  const valid = [];
  for (const component of components.flat(Infinity)) {
    if (!component) continue;
    const parsed = parseComponent(component);
    if (parsed.ok) valid.push(parsed.component);
  }
  return {
    version: UI_PROTOCOL_VERSION,
    response_id: `tracs_${encoder()}`,
    response_type: responseType,
    metadata: topic ? { topic: String(topic).slice(0, UI_LIMITS.maxShortText) } : {},
    components: valid.slice(0, UI_LIMITS.maxComponents),
  };
}

/** A short text component. Used for the connective tissue between steps. */
export function say(content, { tone } = {}) {
  return {
    id: `say_${encoder()}`,
    type: 'text',
    format: 'markdown',
    content: String(content || '').slice(0, UI_LIMITS.maxText),
    ...(tone ? { style: { tone } } : {}),
  };
}

/**
 * A one-question `question_form`.
 *
 * The brief is explicit that `/test` asks *one* question at a time, so the
 * form is built with a single question and one full-width submit. Using the
 * ordinary question_form — rather than a bespoke "answer this" widget — means
 * the answer travels the same validated path as every other form: required
 * checks, field-level errors, duplicate-submit protection, and a structured
 * payload the backend can grade.
 */
export function oneQuestionForm({ question, topic, index, total, sessionId }) {
  // The question keeps its own id. The renderer echoes back the id it was
  // shown, and the session is matched against the id it stored — rewriting it
  // here would make every answer look stale.
  const id = String(question.id || `q${encoder()}`).slice(0, 64);
  return {
    id: `form_${sessionId || 's'}_${id}`.slice(0, 80),
    type: 'question_form',
    // Only claim "of N" when N is a real, fixed count. `/test` chooses the next
    // question from the answer just given, so it has no fixed length; printing
    // "question 1 of 14" there was counting topics, not questions.
    title: topic
      ? `${topic.title}${Number.isFinite(Number(total)) && Number(total) > 0 ? ` — question ${index} of ${total}` : ''}`
      : `Question ${Number.isFinite(Number(total)) && Number(total) > 0 ? `${index} of ${total}` : index}`,
    description: question.question,
    questions: [
      {
        id,
        type: question.type,
        question: question.question,
        description: question.description || undefined,
        placeholder: question.placeholder || undefined,
        options: question.options || undefined,
        required: true,
        hint: question.hint || undefined,
        language: question.language || undefined,
        expected_output: question.expected_output || undefined,
        tests: question.tests || undefined,
        min: question.min,
        max: question.max,
        step: question.step,
      },
    ],
    submission: { button_text: 'Submit answer', action: 'submit_ai_questions', evaluation: 'ai_evaluation' },
  };
}

/* -------------------------------------------------------------------------- */
/* question authoring                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The question types are the *protocol's* — there is no tracs-only vocabulary.
 * A "multiple choice" is a `radio` question and a "short answer" is a
 * `text_input`, which is why the authoring prompt asks for those names.
 */
const QUESTION_TYPES = ['radio', 'text_input', 'textarea', 'code_input', 'number', 'boolean', 'slider', 'select'];

/** The prompt-facing alias, so the model can ask for "multiple_choice". */
const MODEL_TO_PROTOCOL = {
  multiple_choice: 'radio',
  short_answer: 'text_input',
  numeric: 'number',
  text_input: 'text_input',
  textarea: 'textarea',
  code_input: 'code_input',
  boolean: 'boolean',
};

/** Which question type fits which topic, so the mix is not all multiple choice. */
export function pickQuestionType(topic, { attempt = 1, subject = '' } = {}) {
  const text = `${topic?.title || ''} ${(topic?.keywords || []).join(' ')}`.toLowerCase();
  const isCode = /python|java|sql|javascript|code|program|function|loop|array|recursion|algorithm|complexity|class/.test(text);
  const isNumeric = /math|equation|derivative|integral|probability|statistic|calculation|formula|mean|variance/.test(text)
    || /math|physics|chemistry|statistics/.test(subject);
  const isDefinitional = /definition|term|concept|principle|theory|law|process|stage/.test(text);

  // Later attempts get easier formats: a learner who missed a short answer
  // benefits from a multiple-choice that isolates the misconception.
  // A second attempt always gets an easier format than the first, so a learner
  // who missed a free-recall question gets a recognisable one.
  if (attempt >= 2) return 'radio';
  if (isCode) return /code|program|function|loop/.test(text) ? 'code_input' : 'radio';
  if (isNumeric) return 'number';
  if (isDefinitional) return 'text_input';
  return topic?.attempts ? 'text_input' : 'radio';
}

/**
 * A code question that has a checkable answer.
 *
 * The answer must have a definite result for the grader to credit it: the
 * program is run and its stdout compared with `expected_output`. A prompt like
 * "demonstrate loops" has no single right output, so it could never be marked
 * correct — only "runs".
 */
function codeStub(topic) {
  const text = `${topic?.title || ''} ${(topic?.keywords || []).join(' ')}`.toLowerCase();
  if (/function|recursion|argument|parameter|return/.test(text)) {
    return { prompt: 'Write a function `add(a, b)` that returns the sum, then print `add(2, 3)`.', expected: '5' };
  }
  if (/loop|iterat|range|repeat/.test(text)) {
    return { prompt: 'Write a loop that adds the numbers 1 to 4 together and prints the total.', expected: '10' };
  }
  if (/array|list|element|index|slice/.test(text)) {
    return { prompt: 'Make a list of the numbers 1, 2 and 3, then print how many items it holds.', expected: '3' };
  }
  return { prompt: `Declare a variable called \`answer\` set to 42, then print it.`, expected: '42' };
}

/**
 * A multiple-choice question worth answering.
 *
 * Three sources, in order of quality:
 *
 * 1. **A known concept.** "Loops and Iteration" gets asked how many times
 *    `range(3)` runs, with three wrong answers a student might actually believe.
 * 2. **The syllabus's own words**, when it said anything under this heading.
 * 3. **The title's own structure**, when it did not — "Type Casting" asks what a
 *    cast does, not what its "main idea" is.
 *
 * What is never produced is the old fallback: a question whose answer is always
 * the first option and whose distractors are absurdities ("It has no practical
 * use"). That is not a question, it is a coin that always lands heads.
 */
function multipleChoice(topic, { attempt = 1, summary = '', language = null } = {}) {
  const [fact] = factsFor(topic, { language });

  if (fact) {
    const options = shuffleStable([fact.answer, ...fact.wrong].slice(0, 4), topic?.title || '');
    return {
      question: fact.ask,
      options,
      correct_index: options.indexOf(fact.answer),
      hint: `Think about how ${fact.label.toLowerCase()} actually behaves, not what it sounds like it should do.`,
      explanation: fact.explain,
      source: 'local',
    };
  }

  // The syllabus said something under this heading: quiz on its own claim.
  const clean = String(summary || '').replace(/\s+/g, ' ').trim();
  if (clean.length > 40) {
    const trueStatement = clean.split(/(?<=[.;])\s+/)[0].trim().slice(0, 160);
    const options = shuffleStable(
      [trueStatement, `It is only relevant to advanced students`, `It has no practical use`, `It is unrelated to the rest of the syllabus`],
      topic?.title || '',
    );
    return {
      question: `According to your syllabus, which of these is true about "${topic.title}"?`,
      options,
      correct_index: options.indexOf(trueStatement),
      hint: 'One of these is the sentence your own syllabus used.',
      source: 'local',
    };
  }

  // Nothing but a title, and no fact for it. Rather than a coin-flip on a
  // definition, ask the learner to *do* something with it: the options are
  // distinguishable by reasoning even without background knowledge, because only
  // one of them can be true of a syllabus item.
  const title = String(topic?.title || 'this topic');
  const correct = `Work through an example of ${title} by hand, then check it against the rule`;
  const options = shuffleStable(
    [
      correct,
      `Memorise the definition of ${title} and move on`,
      `Skip ${title} until the exam, then read the summary`,
      `Wait for someone to demonstrate ${title} first`,
    ],
    title,
  );
  return {
    question: `You meet "${title}" for the first time. Which way of working actually builds understanding of it?`,
    options,
    correct_index: options.indexOf(correct),
    hint: 'A syllabus heading names a skill. Which option involves doing it rather than reading about it?',
    source: 'local',
  };
}

/**
 * Shuffle so the right answer is not always first, while staying deterministic:
 * a stable string hash seeds the order, so the same topic always renders the
 * same way (a re-render cannot move the answer) but different topics differ.
 */
function shuffleStable(items, seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 48271) + 11) % 2147483647;
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The deterministic question, used when the model is unavailable or malformed. */
export function localQuestion(topic, { attempt = 1, subject = '', language = null } = {}) {
  const type = pickQuestionType(topic, { attempt, subject });
  const summary = String(topic?.summary || '').slice(0, 240);
  const base = { id: `q${Date.now().toString(36)}`, type, hint: undefined };

  if (type === 'radio') {
    const mc = multipleChoice(topic, { attempt, summary, language });
    return { ...base, ...mc };
  }
  if (type === 'number') {
    return {
      ...base,
      question: `Give a number that appears in, or is directly implied by, the material on "${topic.title}".`,
      min: 0,
      max: 10_000,
      // A numeric question with no computable answer cannot be auto-graded, so
      // it is graded as "answered" rather than guessed at.
      auto_gradable: false,
    };
  }
  if (type === 'code_input') {
    // Every code question carries an expected output. Without one the grader can
    // only prove the program *runs*, so a correct answer is stuck at
    // "Almost — not checked" forever and the learner is never credited. Each
    // stub below prints a fixed value, so any correct program for it matches.
    return {
      ...base,
      question: `${codeStub(topic).prompt} (Your program should print ${codeStub(topic).expected}.)`,
      language: 'python',
      expected_output: codeStub(topic).expected,
    };
  }
  return {
    ...base,
    question: `In one or two sentences, explain "${topic.title}".`,
    placeholder: 'Explain it in your own words…',
  };
}

/**
 * Ask the model for the next question, then insist on the answer being usable.
 *
 * The model is given the syllabus excerpt, the learner's history on this topic
 * and the verdict of the previous answer — that last part is how "the next
 * question is chosen from the answer the user just gave" is realised: a wrong
 * answer gets a question that isolates the misconception, a right answer gets
 * one that extends.
 *
 * A malformed or unavailable model response falls back to `localQuestion`, so
 * `/test` never dies because a provider did.
 */
export async function authorQuestion({
  topic,
  syllabusExcerpt,
  attempt = 1,
  previous = null,
  subject = '',
  language = null,
  userId,
  conversationId,
}) {
  const fallback = localQuestion(topic, { attempt, subject, language });

  const previousBlock = previous
    ? `THE PREVIOUS ANSWER: verdict "${previous.verdict}".
${previous.verdict === 'correct'
    ? 'They understood it. Ask something that extends it — an application, an edge case, or a link to another part of the syllabus. Do not repeat the same question.'
    : `They did not fully understand. ${previous.misconception ? `The specific confusion: ${previous.misconception}.` : ''} Ask a question that isolates exactly that confusion. Prefer a smaller, more concrete question over a bigger one.`}`
    : 'THIS IS THE FIRST QUESTION on this topic.';

  const { data } = await runJsonTask('assessment_generation', {
    messages: [
      {
        role: 'system',
        content: `You write ONE assessment question for a learner working through their own syllabus.

Rules:
- Exactly one question. Never a list.
- It must be answerable from the syllabus excerpt, and must test understanding rather than recall of a phrase.
- Choose the type that fits the concept: "radio" (multiple choice), "text_input" (short answer), "textarea" (explain in your own words), "code_input", "number", "boolean".
- For "radio" give 2-4 options and say which index is correct.
- For "code_input" you MUST give both a "language" and an "expected_output": the exact stdout the program prints. Write the question so it has one provable result — print a computed value, not "demonstrate X". A code question without an expected output cannot be graded and will be discarded.
- Do not reveal the answer in the question.
- Keep the question under 300 characters.
- STAY IN ONE LANGUAGE. ${language ? `This syllabus is ${LANGUAGE_NAMES[language] || language}; write every code sample in ${LANGUAGE_NAMES[language] || language} and use its real syntax.` : 'Use one language consistently.'} Never mix two languages in the same snippet, and never ask about another language's behaviour — "what happens in Python?" is wrong on a Java syllabus.
- A code sample must be something the learner could actually type and run. Do not invent syntax that would not execute: \`x = 10; x = 'hello'; x = 3.14\` is valid in neither Python nor Java. If you cannot write it correctly, ask in prose instead.

Return ONLY JSON:
{"question":"…","type":"radio","options":["…"],"correct_index":0,"expected_output":"…","language":"python","hint":"a nudge that does not give it away","tests":[]}`,
      },
      {
        role: 'system',
        content: `TOPIC: ${topic.title}\nSYLLABUS EXCERPT:\n${String(syllabusExcerpt || topic.summary || '').slice(0, 3000)}\n\nATTEMPT NUMBER: ${attempt}\n${previousBlock}`,
      },
      { role: 'user', content: `Write the next question for "${topic.title}".` },
    ],
    meta: { task: 'assessment_generation', topic: topic.title, attempt },
    feature: 'dynamic_ui',
    userId,
    classroomId: null,
    timeoutMs: 25_000,
  }).catch(() => ({ data: null }));

  return normaliseQuestion(data, fallback, topic);
}

/**
 * Make a model-authored question safe to render and possible to grade.
 *
 * A question whose type the form does not support, or a multiple choice with no
 * correct index, is *not* usable — it would show the learner a control that
 * cannot be answered or an answer that cannot be marked. Those fall back rather
 * than being rendered broken.
 */
export function normaliseQuestion(raw, fallback, topic) {
  if (!raw || typeof raw !== 'object') return { ...fallback, source: 'local' };
  const question = String(raw.question || '').trim();
  if (question.length < 8) return { ...fallback, source: 'local' };

  // Accept both the protocol name and the friendlier alias a model may use.
  const requested = MODEL_TO_PROTOCOL[raw.type] || raw.type;
  const type = QUESTION_TYPES.includes(requested) ? requested : fallback.type;
  const out = {
    id: `q${encoder()}`,
    question: question.slice(0, 400),
    type,
    hint: raw.hint ? String(raw.hint).slice(0, 240) : fallback.hint,
    source: 'model',
    topic: topic?.title,
  };

  if (type === 'radio' || type === 'select') {
    const options = (Array.isArray(raw.options) ? raw.options : []).map((o) => String(o).slice(0, 200)).filter(Boolean).slice(0, 6);
    const correct = Number(raw.correct_index);
    if (options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      // Unusable: no defensible marking scheme.
      return { ...fallback, source: 'local' };
    }
    out.options = options;
    out.correct_index = correct;
  }
  if (type === 'code_input') {
    out.language = ['python', 'javascript', 'java', 'sql'].includes(raw.language) ? raw.language : 'python';
    // A code question with no definable result cannot be graded, so it is not
    // rendered: the fallback always carries one. Accepting it would mean a
    // correct program could never be marked correct.
    const expected = raw.expected_output === undefined || raw.expected_output === null
      ? ''
      : String(raw.expected_output);
    if (!expected.trim()) return { ...fallback, source: 'local' };
    out.expected_output = expected.slice(0, 4000);
    if (Array.isArray(raw.tests)) {
      out.tests = raw.tests.slice(0, 8).map((t, i) => ({
        id: String(t?.id || `t${i + 1}`).slice(0, 40),
        name: String(t?.name || `case ${i + 1}`).slice(0, 120),
        args: Array.isArray(t?.args) ? t.args.slice(0, 4) : [],
        expected: t?.expected,
      }));
    }
  }
  if (type === 'number') {
    if (Number.isFinite(Number(raw.min))) out.min = Number(raw.min);
    if (Number.isFinite(Number(raw.max))) out.max = Number(raw.max);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* grading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Grade one answer.
 *
 * Order of authority matters here and is deliberate:
 *   1. **code is executed first** — the sandbox's verdict is the verdict;
 *   2. **multiple choice is marked against its stored index** — no model needed;
 *   3. **short prose is sent to the model**, which may only say how close it is;
 *   4. anything the model fails to do falls back to a deterministic evaluator.
 *
 * The model is never asked whether code is right. That is the one rule the
 * brief states twice.
 */
export async function gradeAnswer({ question, answer, topic, userId }) {
  const kind = question.type;
  const text = Array.isArray(answer) ? answer.join(', ') : answer === null || answer === undefined ? '' : String(answer);
  const unanswered = !String(text).trim();

  if (unanswered) {
    return {
      verdict: 'unanswered',
      score: 0,
      feedback: 'No answer was given.',
      misconception: null,
      correct_answer: (question.type === 'radio' || question.type === 'select') ? question.options?.[question.correct_index] : null,
      execution: null,
    };
  }

  // --- 1. code: real execution -----------------------------------------
  // The sandbox decides. The model is never asked whether code is correct, and
  // a snippet that could not be run is reported as `not_graded` rather than
  // being guessed at either way.
  if (kind === 'code_input') {
    const [execution] = await gradeCodingAnswers({
      questions: [question],
      answers: [{ question_id: question.id, value: text }],
    }).catch(() => []);
    const verbatim = execution?.verdict;
    const verdict = ['correct', 'partly_correct', 'incorrect', 'not_graded'].includes(verbatim)
      ? verbatim
      : 'not_graded';
    // A question with no checkable result can only be smoke-tested: the program
    // runs but nothing is compared. Its "partly_correct" therefore means "ran",
    // not "partly right", and must not be scheduled as a retry.
    const unverified = Boolean(execution?.runtimeUnavailable) || Boolean(execution?.checks?.length === 1 && execution.checks[0]?.id === 'smoke');
    return {
      verdict,
      unverified,
      score: verdict === 'correct' ? 100 : verdict === 'partly_correct' ? 60 : 0,
      feedback: execution?.feedback || (verdict === 'not_graded'
        ? 'Your code could not be run, so it was not marked right or wrong.'
        : 'Your code ran, but it did not produce the expected result.'),
      // Distinguishes "this server cannot run Python" from "your Python was
      // wrong". Only the second one is evidence about the learner.
      runtimeUnavailable: Boolean(execution?.runtimeUnavailable),
      misconception: verdict === 'incorrect' && execution?.output
        ? `output was “${String(execution.output).trim().slice(0, 160)}”`
        : null,
      correct_answer: question.expected_output ? `Expected output: ${question.expected_output}` : null,
      execution: execution || null,
    };
  }

  // --- 2. choice: marked locally, no model involved ---------------------
  if ((kind === 'radio' || kind === 'select') && Number.isInteger(question.correct_index)) {
    const chosenIndex = question.options?.findIndex((option) => String(option).toLowerCase() === String(text).toLowerCase());
    const correct = chosenIndex === question.correct_index;
    return {
      verdict: correct ? 'correct' : 'incorrect',
      score: correct ? 100 : 0,
      // The verdict label ("Correct." / "Not quite.") is added by
      // feedbackDocument. Repeating it here produced "Not quite. Not quite. The
      // answer is: ..." in the learner's view — so this says only the reason.
      // On a miss, say what the right answer is *and why*. A verdict without a
      // reason teaches nothing — the learner needs the rule, not the letter.
      feedback: correct
        ? (question.explanation ? `That is right. ${question.explanation}` : 'That is right.')
        : `The answer is: ${question.options?.[question.correct_index]}${question.explanation ? ` — ${question.explanation}` : ''}`,
      misconception: correct ? null : `chose "${String(text).slice(0, 160)}" instead of "${String(question.options?.[question.correct_index] || '').slice(0, 160)}"`,
      correct_answer: question.options?.[question.correct_index] || null,
      execution: null,
    };
  }

  // --- 3. numeric: compare when the question carries a value ------------
  if (kind === 'number' && Number.isFinite(Number(question.expected_value))) {
    const got = Number(String(text).replace(/[^0-9.eE+-]/g, ''));
    const want = Number(question.expected_value);
    const correct = Number.isFinite(got) && Math.abs(got - want) <= Math.abs(want * 0.01) + 1e-9;
    return {
      verdict: correct ? 'correct' : 'incorrect',
      score: correct ? 100 : 0,
      feedback: correct ? 'Correct.' : `The expected value is ${want}.`,
      misconception: correct ? null : `answered ${got} instead of ${want}`,
      correct_answer: String(want),
      execution: null,
    };
  }

  // --- 4. prose: the model may judge, but only as an opinion ------------
  const fallback = localEvaluateAnswers({
    questions: [{ id: question.id, question: question.question, type: kind, options: question.options }],
    answers: [{ question_id: question.id, value: text }],
  });

  const { data } = await runJsonTask('ui_evaluation', {
    messages: prompts.uiEvaluation({
      questions: [{ id: question.id, type: kind, question: question.question, options: question.options, language: question.language }],
      answers: [{ question_id: question.id, value: text }],
      execution: [],
      context: { concept: { id: topic?.id, name: topic?.title || '' }, syllabus: String(topic?.summary || '').slice(0, 1500) },
    }),
    meta: { task: 'ui_evaluation', question: question.question, answer: text },
    feature: 'dynamic_ui',
    userId,
    classroomId: null,
    timeoutMs: 25_000,
  }).catch(() => ({ data: null }));

  const perQuestion = Array.isArray(data?.per_question) ? data.per_question[0] : null;
  const verdict = ['correct', 'partly_correct', 'incorrect', 'unanswered', 'not_graded'].includes(perQuestion?.verdict)
    ? perQuestion.verdict
    : fallback.per_question?.[0]?.verdict || 'not_graded';

  return {
    verdict,
    score: Number.isFinite(Number(data?.score)) ? Math.max(0, Math.min(100, Number(data.score))) : verdict === 'correct' ? 100 : verdict === 'partly_correct' ? 60 : 0,
    feedback: String(perQuestion?.feedback || fallback.per_question?.[0]?.feedback || data?.overall || '').slice(0, 1200)
      // Same rule as the multiple-choice branch: feedbackDocument owns the
      // verdict label, so this string must not open with one of its own.
      || (verdict === 'correct' ? 'That is right.' : 'Have another look at the explanation.'),
    misconception: verdict === 'correct' ? null : String(perQuestion?.hint || data?.gaps?.[0] || '').slice(0, 300) || null,
    correct_answer: null,
    execution: null,
  };
}

/* -------------------------------------------------------------------------- */
/* /test — feedback and the next step                                         */
/* -------------------------------------------------------------------------- */

const MILESTONE = 5;

/**
 * The feedback document shown after an answer.
 *
 * It carries the verdict, what went wrong, and — when there is one — the next
 * question, so the learner sees one continuous conversation rather than a page
 * that reloads between questions.
 */
export function feedbackDocument({
  verdict,
  feedback,
  topic,
  stats,
  nextQuestion = null,
  sessionId,
  commands = true,
}) {
  const components = [];
  const tone = verdict === 'correct' ? 'success' : verdict === 'partly_correct' ? 'warning' : 'danger';

  components.push({
    id: `verdict_${encoder()}`,
    type: 'text',
    content: verdict === 'correct'
      ? `**Correct.** ${feedback}`.trim()
      : verdict === 'partly_correct'
        ? `**Almost.** ${feedback}`.trim()
        : verdict === 'unanswered'
          ? `**No answer given.** ${feedback}`.trim()
          : `**Not quite.** ${feedback}`.trim(),
    style: { tone },
  });

  if (topic) {
    components.push({
      id: `topic_progress_${encoder()}`,
      type: 'progress',
      title: 'Where this topic stands',
      items: [
        { id: 'correct', label: 'Correct answers', value: Math.round(((topic.correct || 0) / Math.max(topic.attempts || 1, 1)) * 100), detail: `${topic.correct || 0} of ${topic.attempts || 0}` },
        { id: 'mastery', label: 'Mastery', value: Math.round(((topic.mastery || 0) / 4) * 100), detail: ['Not started', 'Needs work', 'Getting there', 'Solid', 'Mastered'][Math.min(topic.mastery || 0, 4)] },
      ],
    });
  }

  if (nextQuestion) {
    components.push(say('Next question:', { tone: 'neutral' }));
    components.push(nextQuestion);
  }

  if (stats && stats.answered > 0 && stats.answered % MILESTONE === 0) {
    components.push({
      id: `milestone_${encoder()}`,
      type: 'learning',
      title: `${stats.answered} questions in`,
      analogy: null,
      summary: `You have answered ${stats.answered} question${stats.answered === 1 ? '' : 's'} across ${stats.topics} topic${stats.topics === 1 ? '' : 's'}. ${stats.correct} correct so far.`,
      sections: [],
    });
  }

  if (commands) {
    components.push({
      id: `commands_${encoder()}`,
      type: 'actions',
      actions: [
        { id: 'go_test', label: 'Next question (/test)', action: 'continue_lesson', tone: 'brand' },
        { id: 'go_learn', label: 'Explain it (/learn)', action: 'continue_lesson', tone: 'neutral' },
      ],
    });
  }

  return makeDocument(components, { responseType: 'assessment', topic: topic?.title });
}

/* -------------------------------------------------------------------------- */
/* /learn — explanation, then checking                                        */
/* -------------------------------------------------------------------------- */

/** How many checking questions must be answered before the loop closes. */
export const CHECK_COUNT = 2;

/** How to name a language in a prompt. Mirrors `languageFor`. */
const LANGUAGE_NAMES = { python: 'Python', javascript: 'JavaScript', java: 'Java', sql: 'SQL' };

/**
 * Ask for an explanation *as a UI document*.
 *
 * The prompt asks for the components that fit the subject (the "G — dynamic
 * teaching" rule): a flowchart and an execution trace for control flow, a
 * worked example and a chart for maths, and so on. Because the model returns
 * the protocol's own component JSON, the renderings are the engine's existing
 * ones — no new renderer, no new vocabulary.
 */
export async function authorExplanation({ topic, syllabusExcerpt, level = '', userId, reTeach = false, previous = null }) {
  const { data } = await runJsonTask('ui_authoring', {
    messages: [
      ...prompts.uiAuthoring({
        context: { concept: { id: topic.id, name: topic.title }, subject: '', level },
        studentMessage: `Teach me "${topic.title}" from my syllabus.`,
        mode: 'learn',
      }),
      {
        role: 'system',
        content: reTeach
          ? `THE LEARNER DID NOT UNDERSTAND THIS. This is a re-teach of the same topic.
Teach it DIFFERENTLY: use a plainer analogy, a smaller worked example, and a different kind of rendering from last time.
Previous attempt used: ${(previous?.components || []).join(', ') || 'unknown'}. Do not repeat it verbatim.`
          : `This is a first explanation of "${topic.title}".`,
      },
      {
        role: 'system',
        content: `SYLLABUS EXCERPT for this topic:\n${String(syllabusExcerpt || topic.summary || '').slice(0, 3500)}`,
      },
    ],
    meta: { task: 'ui_authoring', topic: topic.title, reTeach },
    feature: 'dynamic_ui',
    userId,
    classroomId: null,
    timeoutMs: 40_000,
  }).catch(() => ({ data: null }));

  const repaired = data ? repairUiDocument(normalizeDocument(data), { minComponents: 1 }) : null;
  if (repaired) {
    return { document: withoutAuthoredForms(repaired.document), source: 'model' };
  }
  return { document: localExplanation(topic, { reTeach }), source: 'local' };
}

/**
 * Drop any question form the model wrote into its explanation.
 *
 * tracs owns the checking loop: the checks are authored separately, asked one at
 * a time, and graded against a stored record. A form baked into the explanation
 * would ask several questions at once and its answers would have nothing to be
 * graded against — so it is removed rather than merged.
 */
function withoutAuthoredForms(document) {
  return {
    ...document,
    components: (document.components || [])
      .filter((component) => component.type !== 'question_form' && component.type !== 'form')
      .map((component) => (component.type === 'layout'
        ? { ...component, children: (component.children || []).filter((child) => child.type !== 'question_form' && child.type !== 'form') }
        : component)),
  };
}

/** Model output may arrive wrapped; the repairer wants the bare document. */
function normalizeDocument(raw) {
  const candidate = raw?.document || raw?.ui_document || raw?.lesson || raw;
  if (candidate && Array.isArray(candidate.components)) return { version: UI_PROTOCOL_VERSION, response_id: `tracs_${encoder()}`, response_type: 'educational_tutorial', ...candidate };
  // Some responses put the array at the top level.
  if (Array.isArray(candidate)) return { version: UI_PROTOCOL_VERSION, response_id: `tracs_${encoder()}`, response_type: 'educational_tutorial', components: candidate };
  return null;
}

/**
 * The explanation used when the model is unavailable, or returned something the
 * protocol rejected. It is deliberately plain — a definition, the syllabus's own
 * words, and a worked structure — because a learner is better served by a short
 * honest explanation than by a broken rich one.
 */
export function localExplanation(topic, { reTeach = false } = {}) {
  const summary = String(topic.summary || '').slice(0, 1000);
  const keywords = (topic.keywords || []).slice(0, 8);

  const components = [
    {
      id: 'learning_local',
      type: 'learning',
      title: topic.title,
      sections: [
        {
          heading: reTeach ? 'A different way to see it' : 'What it is',
          body: summary || `${topic.title} is one of the topics in your syllabus. The syllabus text under this heading will appear here once a fuller explanation is available.`,
        },
        ...(keywords.length
          ? [{ heading: 'The ideas it involves', body: keywords.map((k) => `**${k}**`).join(', ') }]
          : []),
      ],
      key_points: keywords.length ? keywords.slice(0, 5).map((k) => `Be able to explain ${k} in your own words.`) : [],
    },
  ];

  if (keywords.length >= 3) {
    components.push({
      id: 'flow_local',
      type: 'diagram',
      diagram_type: 'flowchart',
      caption: `How the parts of ${topic.title} relate`,
      nodes: keywords.slice(0, 4).map((keyword, index) => ({
        id: `n${index + 1}`,
        label: keyword,
        shape: index === 0 ? 'terminal' : 'process',
      })),
      edges: keywords.slice(1, 4).map((_, index) => ({ from: `n${index + 1}`, to: `n${index + 2}` })),
    });
  }

  return makeDocument(components, { topic: topic.title });
}

/**
 * The checking questions that close the `/learn` loop.
 *
 * The brief requires that understanding is *verified* before the topic is
 * considered taught, and that a miss repeats the explanation. These questions
 * are generated from the explanation itself so they test the thing that was
 * just shown rather than something adjacent to it.
 */
export async function authorChecks({ topic, explanation, count = CHECK_COUNT, userId, language = null }) {
  // What the checks should test. When the explanation is supplied it is the best
  // source — the checks then probe what was actually shown. When it is not
  // (because the two calls run in parallel to stay inside a gateway timeout) the
  // topic's own syllabus excerpt is used instead, which is still a fair basis
  // for asking whether the idea landed.
  const fromExplanation = (explanation?.components || [])
    .flatMap((component) => {
      if (component.type === 'learning') return [component.title, ...(component.sections || []).map((s) => s.heading)];
      if (component.type === 'text') return [String(component.content || '').slice(0, 120)];
      if (component.type === 'card_group') return (component.items || []).map((i) => i.title);
      return [];
    })
    .filter(Boolean);

  const headings = (fromExplanation.length
    ? fromExplanation
    : [topic.title, ...(topic.keywords || []), String(topic.summary || '').slice(0, 160)])
    .filter(Boolean)
    .slice(0, 8);

  const { data } = await runJsonTask('assessment_generation', {
    messages: [
      {
        role: 'system',
        content: `You check whether a learner actually understood an explanation you just gave.

Write ${count} short questions that test understanding — not recall of wording.
Each must be answerable from the explanation, and at least one must ask the learner to apply the idea rather than define it.
${language ? `Write any code in ${LANGUAGE_NAMES[language] || language}, using that language's real syntax. Never mix two languages in one snippet.` : 'Use one language consistently in any code you write.'}
Return ONLY JSON: {"questions":[{"question":"…","type":"radio","options":["…"],"correct_index":0}]}`,
      },
      {
        role: 'system',
        content: `TOPIC: ${topic.title}\nTHE EXPLANATION COVERED: ${headings.join(' | ').slice(0, 1200)}\nSYLLABUS EXCERPT: ${String(topic.summary || '').slice(0, 1200)}`,
      },
    ],
    meta: { task: 'assessment_generation', topic: topic.title, checks: true },
    feature: 'dynamic_ui',
    userId,
    classroomId: null,
    timeoutMs: 25_000,
  }).catch(() => ({ data: null }));

  const raw = Array.isArray(data?.questions) ? data.questions : [];
  // A FRESH fallback per question. This was `localQuestion(...)` evaluated once
  // and reused, so when the provider's questions were unusable every check fell
  // back to the *same object* — same id. Two checks sharing one id is poison:
  // answering one marks both attempted, so the round ends after a single answer
  // (and the "question 1 of 2" label becomes a lie).
  const questions = raw.slice(0, count).map((q) => normaliseQuestion(q, localQuestion(topic, { attempt: 1, language }), topic));

  // A deterministic fallback that still tests understanding: restate the idea,
  // then apply it. It is graded by the prose evaluator, so "I don't know" is
  // correctly treated as not understood.
  const fallback = [
    {
      id: `q${encoder()}`,
      type: 'textarea',
      question: `Explain "${topic.title}" in your own words, as if teaching it to someone else.`,
      placeholder: 'Two or three sentences is enough…',
      source: 'local',
    },
    {
      id: `q${encoder()}`,
      type: 'text_input',
      question: `Give one example where "${topic.title}" matters, and say what would happen without it.`,
      placeholder: 'One sentence is enough…',
      source: 'local',
    },
  ];

  // Top up rather than return early.
  //
  // This used to be `if (questions.length) return questions`, which was wrong in
  // a way that broke the whole /learn loop: a provider that returns *fewer*
  // questions than asked (the built-in local analyser returns one) produced a
  // one-question check set. That looks fine, but the closing rule is "re-teach
  // when every check was missed", so a single wrong answer ended the round — and
  // the second check the learner was told about ("question 1 of 2") never
  // existed. Two checks are the point: one lucky guess must not close the loop.
  const filled = [...questions];
  for (let i = 0; filled.length < count && i < fallback.length; i += 1) {
    const candidate = fallback[i];
    // Never repeat a question that is already in the set.
    if (filled.some((q) => String(q.question) === String(candidate.question))) continue;
    filled.push(candidate);
  }

  // Ids must be unique. `normaliseQuestion` falls back to a shared object when a
  // provider's question is unusable, so two checks could arrive with the same id
  // — and then answering one satisfies `every(... answered ...)` for both, which
  // silently ends the round after a single answer.
  const seen = new Set();
  return filled.slice(0, Math.max(1, count)).map((q) => {
    let id = String(q.id || '');
    if (!id || seen.has(id)) id = `q${encoder()}`;
    while (seen.has(id)) id = `q${encoder()}`;
    seen.add(id);
    return id === q.id ? q : { ...q, id };
  });
}

/**
 * Decide whether the learner understood, from the checks.
 *
 * Passing means every check was answered and none was wrong. A partly-correct
 * answer is *not* a pass: the brief says the explanation repeats when
 * understanding is not demonstrated, and a half-answer is not a demonstration.
 * The one exception is a check that could not be graded at all — a code answer
 * that failed to run, say — which is treated as unanswered rather than wrong.
 */
/**
 * Every check must be answered, and every one correct.
 *
 * `expected` is how many checks were set. It is required, because "no misses so
 * far" is not the same as "understood": without it, getting the first of two
 * checks right declared the topic understood and the second check was never
 * asked — the learner was credited for a question they were never shown.
 */
export function assessUnderstanding(results, expected = null) {
  const graded = (results || []).filter((r) => r.verdict !== 'not_graded');
  const total = Number.isFinite(Number(expected)) ? Number(expected) : graded.length;
  if (!graded.length) {
    return { understood: false, reason: 'ungraded', correct: 0, total, answered: 0, missed: [] };
  }
  const missed = graded.filter((r) => r.verdict !== 'correct');
  const allAnswered = graded.length >= total;
  const understood = missed.length === 0 && allAnswered;
  return {
    understood,
    reason: !allAnswered ? 'incomplete' : missed.length === 0 ? 'demonstrated' : 'missed_check',
    correct: graded.length - missed.length,
    total,
    answered: graded.length,
    missed: missed.map((r) => ({ question_id: r.question_id, verdict: r.verdict, feedback: r.feedback, misconception: r.misconception })),
  };
}

/* -------------------------------------------------------------------------- */
/* gap recording                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Turn a wrong answer into a knowledge gap, using the existing gap engine.
 *
 * The categories the engine already models are exactly the three the brief
 * asks for — knowledge gap, misconception, practical difficulty — so this maps
 * a verdict onto one of them rather than inventing a parallel store:
 *
 *   code that fails to build a correct result  -> practical_difficulty
 *   a multiple-choice that picked a specific wrong option -> misconception
 *   anything else wrong                        -> knowledge_gap
 */
export function gapCategory({ question, verdict, runtimeUnavailable = false }) {
  if (verdict === 'correct' || verdict === 'not_graded' || verdict === 'unanswered') return null;
  // A missing interpreter on the server says nothing about the learner. Filing
  // it as a practical difficulty would put a server outage in their record.
  if (runtimeUnavailable) return null;
  if (question?.type === 'code_input') return 'practical_difficulty';
  if ((question?.type === 'radio' || question?.type === 'select') && verdict === 'incorrect') return 'misconception';
  return 'knowledge_gap';
}

export { executeCode, applyExecutionVerdicts };
export const tracsSchemas = { z };
