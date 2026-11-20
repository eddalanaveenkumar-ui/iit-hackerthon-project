import { z } from 'zod';
import { runJsonTask } from '../ai/orchestrator.js';
import { prompts } from '../ai/prompts.js';
import { parseComponent, repairUiDocument, UI_PROTOCOL_VERSION, UI_LIMITS } from '../ai/ui/protocol.js';
import { localEvaluateAnswers } from '../ai/ui/teaching-engine.js';
import { gradeCodingAnswers, applyExecutionVerdicts } from '../learning/code-grading.js';
import { executeCode, runtimeAvailability } from '../../utils/sandbox.js';
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
        code_snippet: question.code_snippet || undefined,
        code_inline: question.code_inline || undefined,
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
export function pickQuestionType(topic, { attempt = 1, subject = '', language = null } = {}) {
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
  if (isCode) {
    // Only ask for code the server can actually run.
    //
    // The generated snippets are Python, and a Node-only deployment has no
    // interpreter: the answer came back "could not be run, analysed statically,
    // not verified", which tells the learner about our infrastructure and marks
    // nothing. A multiple choice on the same topic is gradeable everywhere, so
    // that is what an ungradeable topic falls back to.
    const runnable = runtimeAvailability(language || 'python') !== false;
    if (!runnable) return 'radio';
    return /code|program|function|loop/.test(text) ? 'code_input' : 'radio';
  }
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
/**
 * A different question about the same concept.
 *
 * Used when a round needs more questions than the curated bank has facts for.
 * Each variant is still answerable from the syllabus excerpt and still has a
 * defensible answer, which is the bar every question here has to clear — a
 * variant that could not be marked would be worse than a shorter round.
 *
 * The angles are the ones that actually test understanding rather than recall:
 * apply it, recognise it, predict its output, say what it is not.
 */
function localVariant(topic, { variant = 1, language = null } = {}) {
  const [fact] = factsFor(topic, { language });
  const title = String(topic?.title || 'this idea');
  const summary = String(topic?.summary || '').trim();
  const angle = ((variant - 1) % 7) + 1;

  // A parsed bullet concept usually has no summary — only its title. So every
  // angle below has to work from the title and, when present, a curated fact.
  // An angle that needed prose would return nothing for most units, and the
  // round would silently shrink back to one question per concept.
  const claim = summary.length >= 30 ? summary.split(/(?<=[.;])\s+/)[0].slice(0, 160) : null;

  if (fact) {
    const wrong = fact.wrong.filter(Boolean);
    const angles = {
      // Which statement is true
      1: () => ({
        type: 'radio',
        question: `Which of these is true about ${title.toLowerCase()}?`,
        options: shuffleStable([fact.answer, ...wrong].slice(0, 4), `${fact.label}#a1`),
        correct_index: 0,
        explanation: fact.explain,
      }),
      // Spot the false claim
      2: () => ({
        type: 'radio',
        question: `Someone claims: “${wrong[0] || 'the rule does not apply here'}” — about ${title.toLowerCase()}. Are they right?`,
        options: shuffleStable([
          `No — ${fact.answer.charAt(0).toLowerCase()}${fact.answer.slice(1)}`,
          'Yes, that is exactly how it works',
          'Only in some versions',
          'It depends on the variable name',
        ], `${fact.label}#a2`),
        correct_index: 0,
        explanation: fact.explain,
      }),
      // Choose the right correction
      3: () => ({
        type: 'radio',
        question: `A learner gets ${title.toLowerCase()} wrong. Which correction is right?`,
        options: shuffleStable([
          fact.explain.slice(0, 180),
          'They should memorise the syntax and not ask why',
          'They should skip it and come back later',
          'It is a matter of preference and has no right answer',
        ], `${fact.label}#a3`),
        correct_index: 0,
        explanation: fact.explain,
      }),
      // Predict the outcome
      4: () => ({
        type: 'radio',
        question: `What is the outcome in this unit's language when ${title.toLowerCase()} is applied as described?`,
        options: shuffleStable([fact.answer, ...wrong].slice(0, 4), `${fact.label}#a4`),
        correct_index: 0,
        explanation: fact.explain,
      }),
      // Reject the misconception
      5: () => ({
        type: 'radio',
        question: `Which of these is a common misconception about ${title.toLowerCase()}?`,
        options: shuffleStable([
          wrong[0] || 'It behaves the same in every language',
          'It follows from the rules stated in the syllabus',
          'It can be checked by running a small example',
          'It is covered in this unit',
        ], `${fact.label}#a5`),
        correct_index: 0,
        explanation: `That is the belief to drop. ${fact.explain}`,
      }),
    };
    const built = angles[angle]?.() || angles[1]();
    if (claim && angle === 6) {
      return {
        type: 'radio',
        question: `Which statement matches what the material says about ${title.toLowerCase()}?`,
        options: shuffleStable([claim, 'It is only relevant once the rest of the unit is finished', 'It behaves the same in every language, regardless of rules', 'It can be skipped and picked up by trial and error'], `${fact.label}#a6`),
        correct_index: 0,
        explanation: claim,
      };
    }
    if (angle === 7) {
      return {
        type: 'textarea',
        question: `Explain ${title.toLowerCase()} in your own words, then give one example of it going wrong.`,
        placeholder: 'The idea, then an example…',
      };
    }
    return built;
  }

  // No curated fact for this concept. Ask in the learner's own words — real
  // questions, gradeable by the same rubric as any explanation question, and
  // each one asks something different.
  const open = [
    `Explain ${title} in your own words, as if to someone who has not seen this unit.`,
    `Name one situation where ${title} decides what the code does, and say why.`,
    `What is the most common mistake people make with ${title}, and why is it wrong?`,
    `Describe a case where ${title} does not behave the way a beginner would expect.`,
    `How would you check whether you had understood ${title} correctly?`,
  ];
  return {
    type: angle % 2 === 0 ? 'text_input' : 'textarea',
    question: open[(angle - 1) % open.length],
    placeholder: 'In your own words…',
  };
}

function multipleChoice(topic, { attempt = 1, summary = '', language = null } = {}) {
  const [fact] = factsFor(topic, { language });

  if (fact) {
    const options = shuffleStable([fact.answer, ...fact.wrong].slice(0, 4), topic?.title || '');
    // Curated questions carry code too ("In `int total = 7; total = 7.5;`, what
    // happens?"). Lift it into its own field so it renders as a block here as
    // well — otherwise only model-authored questions would get the treatment.
    //
    // A fact may also state its program outright (`code`). That is the better
    // form: the sentence is then written to be read *with* the block above it
    // ("This Java program does not compile. What is the reason?") instead of
    // pointing at code that has been moved out from under it.
    // The program shown *with* the question is `prompt`, which deliberately does
    // not run to an answer: "What does this print?" followed by a program that
    // prints the answer is not a question. `code` is the full run, and it is what
    // the post-answer worked example uses (`explainMistake`). A fact may have
    // either, both, or neither.
    const shownAtAsk = [fact.prompt, fact.code].find((c) => typeof c === 'string' && c.trim());
    const authorCode = shownAtAsk ? shownAtAsk.trim().slice(0, 2000) : null;
    const snippet = authorCode
      ? { code_snippet: authorCode, inline: null }
      : extractCodeSnippet(fact.ask, { type: 'radio', language: fact.lang || language });
    return {
      question: fact.ask,
      options,
      correct_index: options.indexOf(fact.answer),
      hint: `Think about how ${fact.label.toLowerCase()} actually behaves, not what it sounds like it should do.`,
      explanation: fact.explain,
      source: 'local',
      ...(snippet.code_snippet
        ? { code_snippet: snippet.code_snippet, ...(snippet.inline ? { code_inline: snippet.inline } : {}) }
        : {}),
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
export function localQuestion(topic, { attempt = 1, subject = '', language = null, variant = 0 } = {}) {
  const type = pickQuestionType(topic, { attempt, subject, language });
  const summary = String(topic?.summary || '').slice(0, 240);
  // Ids must be unique across a whole round, and a round authors every question
  // in parallel. `Date.now()` is the same for all of them — two questions from
  // different concepts got the same id, so grading matched both answers to
  // whichever question was found first and the report listed each miss twice.
  const base = { id: `q${encoder()}`, type, hint: undefined };

  // A round asks several questions about one concept, and this fallback used to
  // return the *same* question every time — so a five-question round collapsed
  // to however many concepts the unit happened to have. Variants ask about the
  // same idea from different angles, which is also what makes a retest a retest.
  if (variant > 0) {
    const asked = localVariant(topic, { variant, language });
    if (asked) return { ...base, ...asked };
  }

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
  // Stems already asked this session. A retest must not re-ask the question that
  // produced the gap — repeating it tests recall of the question, not the idea.
  avoid = [],
  // Which angle on this concept to take when falling back to the local bank.
  variant = 0,
}) {
  const fallback = localQuestion(topic, { attempt, subject, language, variant });
  // Read per call: the probe caches for the process, so this is cheap, and it
  // keeps the prompt honest on a deployment that cannot run the learner's code.
  const codeRunnable = language ? runtimeAvailability(language) !== false : runtimeAvailability() !== false;

  const avoidBlock = Array.isArray(avoid) && avoid.length
    ? `\n\nQUESTIONS ALREADY ASKED (do not repeat or paraphrase these — ask about the same idea a different way):\n${avoid.slice(0, 12).map((q) => `- ${String(q).slice(0, 160)}`).join('\n')}`
    : '';

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
- A code sample goes in its own field, never inside the question sentence: put the program in "code_snippet" (real newlines and indentation) and ask about it in "question" (for example "What does this program print?"). Backticks inside the sentence are only for short inline terms like \`None\` or \`7 // 2\`. Never write a whole program into the question sentence, and never put a program on a single line with its statements run together.
- A code sample must be something the learner could actually type and run. Do not invent syntax that would not execute: \`x = 10; x = 'hello'; x = 3.14\` is valid in neither Python nor Java. If you cannot write it correctly, ask in prose instead.
- ${codeRunnable
    ? 'Code questions are executed and graded against their expected output.'
    : 'THIS SERVER CANNOT EXECUTE CODE. Do not use the "code_input" type and do not ask the learner to write a program — it could not be graded and would be reported as unverified. Ask a "radio" or "text_input" question that tests the same idea in words, or by reading a snippet.'}

Return ONLY JSON:
{"question":"…","type":"radio","options":["…"],"correct_index":0,"expected_output":"…","language":"python","hint":"a nudge that does not give it away","tests":[]}`,
      },
      {
        role: 'system',
        content: `TOPIC: ${topic.title}\nSYLLABUS EXCERPT:\n${String(syllabusExcerpt || topic.summary || '').slice(0, 3000)}\n\nATTEMPT NUMBER: ${attempt}\n${previousBlock}${avoidBlock}`,
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
 * Keywords that belong to a program rather than to the sentence around it.
 * Matched as whole words, so "format" does not look like "for" and "classify"
 * does not look like "class".
 */
const CODE_WORDS = /\b(?:if|elif|else|for|while|print|def|return|class|public|private|static|void|int|double|float|boolean|char|String|var|let|const|function|import|from|range|len|input|str|list|dict|None|True|False|null|nil|System\.out|console\.log|echo|select|where|try|except|catch|finally|switch|case|break|continue|with|lambda|super|this)\b/;
const INDENT_START = /^(?:\s*(?:if|elif|else|for|while|try|except|finally|def|class|switch|case|with)\b)/;
const PROSE_TAIL = /\?\s*$/;

const collapseSpaces = (s) => String(s).replace(/[ \t]+/g, ' ').trim();

/**
 * Lay a one-line program out as a program.
 *
 * A model will happily send "x = 7 if x > 10: print('A') elif x > 5: print('B')
 * else: print('C')" — correct Python, and unreadable as a sentence. Python's
 * grammar gives exactly three shapes, and each one starts a new line:
 *
 *   the colon that opens a suite          "if x > 10:"        -> newline
 *   a keyword that starts a new clause    "elif", "else", ... -> newline
 *   a semicolon between statements        "a = 1; b = 2"      -> newline
 *
 * Braced languages (Java, JavaScript) have no colon form, so for them a semicolon
 * is the only split. The body of a suite is indented one level; a keyword at the
 * outer level closes it.
 *
 * This only runs on a single line whose caller has already decided it is code —
 * it never rewrites prose.
 */
function layoutOneLiner(oneLine, language = 'python') {
  const lang = String(language || 'python').toLowerCase();
  const braced = ['java', 'javascript', 'c', 'cpp', 'csharp', 'go', 'rust', 'typescript'].includes(lang);
  const trimmed = oneLine.trim();
  if (!trimmed) return '';

  // 1. Cut into logical lines. In Python a suite opens at ":" and a new clause
  //    starts at elif/else/except/finally; in a braced language only ";"
  //    separates statements.
  const chunks = [];
  let buffer = '';
  let quote = null;

  const pushChunk = () => {
    if (buffer.trim()) chunks.push(buffer);
    buffer = '';
  };

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];

    if (quote) {
      buffer += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === ';') {
      // Java/JS statements end in ";", so it belongs to the program. In Python
      // it is only a separator between statements and can go.
      if (braced) buffer += ch;
      pushChunk();
      continue;
    }
    if (ch === ':' && !braced) {
      buffer += ch;
      // "x = 7 if x > 10:" is an assignment run into a condition — the model
      // wrote two statements as one. Split before the "if" so the block shows
      // the program it meant.
      const glued = /^([A-Za-z_]\w*\s*=\s*.+?)\s+if\s+([\s\S]+)$/.exec(buffer.replace(/:\s*$/, ''));
      if (glued) {
        chunks.push(glued[1]);
        buffer = `if ${glued[2]}:`;
      }
      pushChunk();
      continue;
    }
    // A clause keyword begins a new logical line even without punctuation.
    if (/\s/.test(trimmed[i - 1] || '') && !braced) {
      const rest = trimmed.slice(i);
      const clause = /^(elif|else|except|finally)(?![\w])/.exec(rest);
      if (clause && buffer.trim()) {
        pushChunk();
        // fall through: this character starts the new chunk
        buffer += ch;
        continue;
      }
    }
    buffer += ch;
  }
  pushChunk();
  if (!chunks.length) return '';

  // 2. Indent. A line ending in ":" opens a suite; the matching elif/else sits
  //    back at the level of the "if" it belongs to.
  const lines = [];
  let depth = 0;
  for (const chunk of chunks) {
    const piece = collapseSpaces(chunk);
    if (!piece) continue;
    const isElseClause = /^(?:else|elif|except|finally|catch)\b/.test(piece);
    if (isElseClause && depth > 0) depth -= 1;
    lines.push(`${'    '.repeat(depth)}${piece}`);
    if (!braced && piece.endsWith(':') && !piece.endsWith('::')) depth += 1;
  }
  return lines.join('\n');
}

/**
 * Pull the program out of a stem that does not mark it as code.
 *
 * Models ignore the instruction to use backticks often enough that keying only on
 * backticks left whole programs in running text:
 *
 *   "What does this code print? x = 7 if x > 10: print('A') elif x > 5: print('B')"
 *
 * So identify the program by its shape instead: the question starts with prose,
 * and from some word onwards the rest of the string is program. The split is only
 * accepted when the tail really looks like code — it carries code keywords and is
 * either punctuated like a statement or long enough that it cannot be prose.
 * Anything doubtful is left alone; a missing block is a cosmetic problem, a
 * mangled question is a wrong question.
 */
function extractBareCode(text, { language = 'python' } = {}) {
  const match = /^(.*?\?)\s+(.*)$/s.exec(text);
  // "What does this code print? <program>" — prose, then program. A stem with no
  // question mark is not this shape; leave it to the backtick path.
  if (!match) return { question: text, code_snippet: null };

  const instruction = match[1].trim();
  const tail = match[2].trim();
  if (tail.length < 12) return { question: text, code_snippet: null };
  if (tail.includes('`')) return { question: text, code_snippet: null };

  const codeish = [
    CODE_WORDS.test(tail),
    /[=:;{}()[\]]/.test(tail),
    tail.includes('\n') || tail.length >= 16,
  ].filter(Boolean).length;
  if (codeish < 3) return { question: text, code_snippet: null };
  // A tail that is still asking something is prose that happens to mention code.
  if (PROSE_TAIL.test(tail) && !/[:;{}]\s*$/.test(tail)) return { question: text, code_snippet: null };

  const code = tail.includes('\n') ? tail : layoutOneLiner(tail, language);
  if (!code || code.length < 8) return { question: text, code_snippet: null };
  return { question: instruction, code_snippet: code.slice(0, 2000) };
}

/**
 * Find the program a question is about, so it can be shown as a program.
 *
 * A question like
 *
 *   After executing `x = 10; x = 'hello'; x = 3.14`, what is the type of `x`?
 *
 * carries its code inside backticks in the middle of a sentence. Rendered as
 * running text that is a syntax soup to decode; rendered as a block it is a
 * program, which is the thing being asked about.
 *
 * The *prose is never rewritten*. Cutting a clause out of a sentence produced
 * "What does evaluate to in Python 3?", which is not a question. Instead the
 * snippet is lifted alongside the untouched text, and the renderer shows the code
 * above the sentence and points at it ("the code above"). Both halves stay
 * grammatical and the code stays readable.
 *
 * Only substantial code is lifted — more than one statement, or a span long
 * enough that reading it inline is work. A short expression like `7 // 2` reads
 * perfectly well in a sentence and is left alone.
 *
 * @returns {{ question: string, code_snippet: string|null, inline: string|null }}
 *          `inline` is the exact backticked text that was lifted, so the renderer
 *          can swap that one span for a reference and leave every other span.
 */
export function extractCodeSnippet(question, { type, language = null } = {}) {
  const text = String(question || '');
  const aboutCode = type === 'code_input' || Boolean(language);
  const bare = extractBareCode(text, { language });
  if (!aboutCode || !text) return { question: text, code_snippet: null, inline: null, ...bare };
  if (bare.code_snippet) return { question: bare.question, code_snippet: bare.code_snippet, inline: null };

  const spans = [...text.matchAll(/`([^`]{1,400})`/g)].map((m) => ({ raw: m[0], code: m[1].trim(), index: m.index }));
  if (!spans.length) return { question: text, code_snippet: null, inline: null };

  // Substantial = more than one statement, or long enough that a sentence cannot
  // carry it. Everything else is a term or a short expression and stays inline.
  const substantial = (c) => c.includes('\n') || /;\s*\S/.test(c) || c.length >= 28;

  let best = null;
  for (const span of spans) {
    if (!substantial(span.code)) continue;
    const score = span.code.length;
    if (!best || score > best.code.length) best = span;
  }
  // Also consider a run of nearby spans that together form one program. Curated
  // questions write it two ways: `x = 10; x = 'hello'` in one span, or
  // `int total = 7;` and later `total = 7.5;` in two. The second only reads as a
  // program when both halves are shown together, so collect the runs.
  const partOfProgram = (c) => substantial(c) || /[=()]/.test(c);
  for (let i = 0; i < spans.length; i += 1) {
    const run = [spans[i]];
    for (let j = i + 1; j < spans.length && j <= i + 3; j += 1) {
      const gap = text.slice(spans[j - 1].index + spans[j - 1].raw.length, spans[j].index);
      // Only a short joining phrase ("and later", ", then") may sit between them.
      if (gap.length > 24) break;
      run.push(spans[j]);
    }
    if (run.length < 2) continue;
    if (!run.every((span) => partOfProgram(span.code))) continue;
    // Join the fragments themselves — never the prose between them ("and later").
    const code = run.map((span) => span.code).join('\n');
    if (!substantial(code) && code.length < 12) continue;
    if (!best || code.length > best.code.length) {
      best = {
        raw: text.slice(run[0].index, run[run.length - 1].index + run[run.length - 1].raw.length),
        code,
        index: run[0].index,
        inline: run.map((span) => span.raw),
      };
    }
  }
  if (!best) return { question: text, code_snippet: null, inline: null };

  const code = String(best.code || best.raw.replace(/`/g, '')).trim();
  if (code.length < 4) return { question: text, code_snippet: null, inline: null };
  return {
    question: text,
    code_snippet: code.slice(0, 2000),
    // The exact spans lifted, so the renderer replaces those and only those.
    inline: best.inline ? best.inline : [best.raw],
  };
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
  const snippet = raw.code_snippet
    ? { code_snippet: String(raw.code_snippet).slice(0, 2000), inline: null }
    : extractCodeSnippet(question, { type, language: raw.language || fallback.language || null });
  const out = {
    id: `q${encoder()}`,
    // `snippet.question` is the cleaned stem — when the program was pulled out of
    // the sentence, this is the sentence without it. It is otherwise the model's
    // wording, untouched.
    question: String(snippet.question || question).slice(0, 400),
    type,
    hint: raw.hint ? String(raw.hint).slice(0, 240) : fallback.hint,
    source: 'model',
    topic: topic?.title,
  };
  // The program the question is about, kept as its own field so the renderer can
  // put it in a block instead of leaving it inline in a sentence.
  if (snippet.code_snippet) out.code_snippet = snippet.code_snippet;
  if (snippet.inline) out.code_inline = snippet.inline;

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
      // The technical why, kept separate from the learner-facing feedback so the
      // admin console and the logs can still answer "why was this not graded?"
      reason: execution?.reason || null,
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
 * Why the learner's answer was wrong, at length, with a worked example.
 *
 * The old feedback was one line — "The answer is: X — because Y". That states
 * the right answer but never names the mistake. A learner who picked a specific
 * wrong option is holding a specific wrong idea, and naming it is the part that
 * teaches. This produces the shape asked for:
 *
 *   what you chose  ->  the rule  ->  a concrete example  ->  the caller appends
 *   "try this one" and the next question
 *
 * Pure string assembly over what grading already knows, so it costs no model
 * call and cannot fail. When the question carries no explanation it says what it
 * does know rather than inventing one.
 *
 * @returns {{ text: string, example: string|null }|null} null when there is
 *          nothing specific to say (a correct answer has no mistake to explain).
 */
export function explainMistake({ question, chosen, verdict = 'incorrect' }) {
  if (!question || verdict === 'correct') return null;

  const options = Array.isArray(question.options) ? question.options.map((o) => String(o)) : [];
  const right = Number.isInteger(question.correct_index) ? options[question.correct_index] : null;
  const picked = String(chosen ?? '').trim();
  const explanation = String(question.explanation || '').trim();
  if (!right && !explanation) return null;

  const parts = [];
  const pickedOne = picked && options.find((o) => o.toLowerCase() === picked.toLowerCase());
  if (pickedOne && right && pickedOne !== right) {
    parts.push(`You chose **"${pickedOne}"** — that is the answer most people land on, and it is the part worth unlearning.`);
  } else if (picked) {
    parts.push(`Your answer was **"${picked.slice(0, 140)}"**.`);
  }
  if (right) parts.push(`The correct answer is **${right}**.`);
  if (explanation) parts.push(explanation);

  // A worked example, built from the question's own code when it has some, so
  // the illustration is about the thing just asked rather than a generic analogy.
  let example = null;
  if (question.code) {
    const code = String(question.code).trim();
    example = question.print ? `${code}  →  ${question.print}` : code;
    parts.push(`Here it is, run once:\n\n${example}`);
  } else if (right) {
    example = `Apply the rule to one concrete case before choosing: the rule above decides "${right.slice(0, 90)}", not any of the others.`;
    parts.push('Worked through once, slowly: read the options as claims, and ask of each whether the rule you just read would produce it. Only one survives that test.');
  }

  return { text: parts.join('\n\n'), example };
}

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
  mistake = null,
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
    // `mistake` is the long form: what you chose, the rule, a worked example.
    // It replaces the one-line reason for a miss, because "the answer is X" does
    // not tell a learner which idea to give up.
    content: verdict === 'correct'
      ? `**Correct.** ${feedback}`.trim()
      : verdict === 'partly_correct'
        ? `**Almost.** ${mistake || feedback}`.trim()
        : verdict === 'unanswered'
          ? `**No answer given.** ${feedback}`.trim()
          : `**Not quite.** ${mistake || feedback}`.trim(),
    style: { tone },
  });

  if (topic) {
    // A topic with no recorded attempts shows "0 of 0 — 0%", which reads as "you
    // scored nothing". It means "nothing has been judged yet", and after an
    // unverified answer that is the honest statement: the server could not run
    // the code, so no attempt was recorded. Say that instead of a zero.
    const attempts = topic.attempts || 0;
    const scored = attempts > 0;
    components.push({
      id: `topic_progress_${encoder()}`,
      type: 'progress',
      title: 'Where this topic stands',
      items: scored
        ? [
          { id: 'correct', label: 'Correct answers', value: Math.round(((topic.correct || 0) / attempts) * 100), detail: `${topic.correct || 0} of ${attempts}` },
          { id: 'mastery', label: 'Mastery', value: Math.round(((topic.mastery || 0) / 4) * 100), detail: ['Not started', 'Needs work', 'Getting there', 'Solid', 'Mastered'][Math.min(topic.mastery || 0, 4)] },
        ]
        : [
          { id: 'correct', label: 'Graded answers', value: 0, detail: 'none yet' },
          { id: 'mastery', label: 'Mastery', value: 0, detail: 'Nothing recorded yet' },
        ],
    });
  }

  if (nextQuestion) {
    // The hand-off is explicit: explain, then ask. The learner should never have
    // to wonder whether the question below is a new topic or the same one again.
    components.push(say(
      verdict === 'correct'
        ? 'Try this one — same idea, one step further.'
        : 'Try this one — it targets exactly the step that went wrong.',
      { tone: 'neutral' },
    ));
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
      // `command` is carried explicitly. Without it the client had to guess
      // from `action`, and every `continue_lesson` fell through to `/test` —
      // which is why pressing /learn sometimes took the /test path.
      actions: [
        { id: 'go_test', label: 'Try a question (/test)', action: 'continue_lesson', command: 'test', tone: 'brand' },
        { id: 'go_learn', label: 'Explain it (/learn)', action: 'continue_lesson', command: 'learn', tone: 'neutral' },
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
  const { data, meta: runMeta } = await runJsonTask('ui_authoring', {
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
    // The local provider builds its lesson from `meta.concept`, not from the
    // prompt text. Without it, a deployment with no API key got the engine's
    // generic template — "**This topic** — here is the working definition to
    // build on" — instead of the concept being taught.
    meta: {
      task: 'ui_authoring',
      topic: topic.title,
      reTeach,
      concept: {
        id: topic.id,
        name: topic.title,
        description: String(topic.summary || '').slice(0, 800),
      },
      question: `Teach me "${topic.title}" from my syllabus.`,
      subject: '',
      level,
    },
    feature: 'dynamic_ui',
    userId,
    classroomId: null,
    timeoutMs: 40_000,
  }).catch(() => ({ data: null }));

  // A simulated response is the local adapter standing in for a model: it
  // returns the same generic "work in three passes" lesson whatever the topic,
  // which is boilerplate dressed as teaching. The tracs explanation is better
  // than that, and it quotes what the syllabus actually said — so a simulated
  // run falls through to it rather than being shown as authored content.
  const repaired = data && !runMeta?.simulated ? repairUiDocument(normalizeDocument(data), { minComponents: 1 }) : null;
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
 * A plain description of a concept from its name alone.
 *
 * Used when the syllabus named the concept but said nothing about it — the usual
 * shape of a real syllabus, which is a list of topics and no prose. "Variables
 * and Primitive Types" becomes a sentence about the three things its name
 * promises; anything unparseable becomes a prompt to work the example out, which
 * is still more useful than an apology.
 */
export function describeConcept(title) {
  const name = String(title || '').trim();
  if (!name) return 'This concept is named in your syllabus but has no description.';
  return `**${name}** is one of the topics in your syllabus, and this syllabus does not spell it out. Start from a case you already understand, write down what changes when it is involved, and check that rule against a second example.`;
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
          // A syllabus that lists concepts as bare bullets has no prose to
          // quote, and saying so was both unhelpful and a promise the app could
          // not keep. Say what the concept is *from its name* instead, and name
          // the parts it is made of when the name contains them.
          body: summary || describeConcept(topic.title),
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

/* -------------------------------------------------------------------------- */
/* DIAGNOSIS                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The three categories the brief asks for, in the learner's words.
 *
 * The existing gap engine already files these; what was missing was telling the
 * learner which one their mistake was. A bare "not quite" does not say whether
 * they never knew the idea, believed something false about it, or knew it and
 * could not apply it — and those need different follow-ups.
 */
export const DIAGNOSIS_LABELS = Object.freeze({
  knowledge_gap: 'knowledge gap',
  misconception: 'misconception',
  practical_difficulty: 'practical difficulty',
});

/**
 * Classify one wrong answer.
 *
 * Deliberately conservative and rule-based rather than model-guessed: the label
 * is shown to the learner as a claim about their understanding, so it must be
 * defensible from what they actually did.
 *
 *   misconception      they chose a specific wrong option. They held a belief and
 *                      it is identifiable — a blank answer is not a belief.
 *   practical_difficulty  the work was a program to write, or the answer shows the
 *                      right idea applied wrongly (a near miss on a calculation).
 *   knowledge_gap      everything else: no answer, or a miss with no diagnostic
 *                      signal to distinguish it.
 */
export function diagnoseMistake({ question, verdict, chosen, graded = null, runtimeUnavailable = false } = {}) {
  if (verdict === 'correct') return null;
  if (runtimeUnavailable) return null;
  // A judgement that could not be made is not evidence about the learner.
  if (verdict === 'not_graded' || verdict === 'unanswered') {
    return {
      category: null,
      label: 'nothing to diagnose',
      detail: 'This answer could not be judged, so it is not counted as a mistake.',
    };
  }

  const kind = question?.type;
  const answer = String(chosen ?? '').trim();
  const correct = (question?.type === 'radio' || question?.type === 'select')
    ? String(question?.options?.[question?.correct_index] ?? '')
    : String(graded?.correct_answer ?? '');

  if (kind === 'code_input') {
    return {
      category: 'practical_difficulty',
      label: DIAGNOSIS_LABELS.practical_difficulty,
      detail: 'The idea may be clear; turning it into working code is where it broke.',
    };
  }

  if ((kind === 'radio' || kind === 'select') && answer) {
    return {
      category: 'misconception',
      label: DIAGNOSIS_LABELS.misconception,
      detail: `You chose “${answer.slice(0, 120)}” rather than “${correct.slice(0, 120)}”. That is a specific belief about how this works, and it is the thing to correct.`,
    };
  }

  // A near miss on a short answer — the right idea with the wrong detail — is a
  // practical difficulty, not a blank.
  if (answer && correct && answer.toLowerCase() !== correct.toLowerCase()) {
    const overlap = answer.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && correct.toLowerCase().includes(w));
    if (overlap.length) {
      return {
        category: 'practical_difficulty',
        label: DIAGNOSIS_LABELS.practical_difficulty,
        detail: `Your answer has the right idea in it — “${answer.slice(0, 120)}” — but lands on a different detail than “${correct.slice(0, 120)}”.`,
      };
    }
  }

  return {
    category: 'knowledge_gap',
    label: DIAGNOSIS_LABELS.knowledge_gap,
    detail: answer
      ? 'This part of the idea did not come back at all, which usually means it has not been learned yet rather than misremembered.'
      : 'No answer was given, so there is nothing yet to correct — this is a gap to fill.',
  };
}

/**
 * The end-of-round report: every miss, its category, and a clean explanation.
 *
 * Shown before the retest so the learner sees what the round found before being
 * asked again. One text component per miss keeps each explanation attached to
 * the question it belongs to instead of one wall of prose.
 */
export function diagnosisReport({ results = [], questions = [] } = {}) {
  const byId = new Map((questions || []).map((q) => [q.id, q]));
  const misses = [];
  const components = [];

  for (const result of results) {
    if (!result || result.verdict === 'correct') continue;
    const question = byId.get(result.question_id) || result.question || null;
    const diagnosis = result.diagnosis || diagnoseMistake({
      question,
      verdict: result.verdict,
      chosen: result.answer,
      graded: result,
      runtimeUnavailable: Boolean(result.runtimeUnavailable),
    });
    if (!diagnosis?.category) continue;
    misses.push({
      question_id: result.question_id,
      question: question?.question || '',
      category: diagnosis.category,
      label: diagnosis.label,
      chosen: String(result.answer ?? '').slice(0, 300),
      correct: String((question?.options?.[question?.correct_index]) ?? result.correct_answer ?? '').slice(0, 300),
      detail: diagnosis.detail,
      explanation: String(result.explanation || result.feedback || '').slice(0, 1200),
    });
  }

  if (!misses.length) return { misses, components };

  const counts = misses.reduce((acc, m) => ({ ...acc, [m.category]: (acc[m.category] || 0) + 1 }), {});
  // "2 practical difficultys" — a plain `+'s'` does not pluralise an -y noun.
  const pluralise = (label) => (label.endsWith('y') ? `${label.slice(0, -1)}ies` : `${label}s`);
  const summary = Object.entries(counts)
    .map(([category, n]) => {
      const label = DIAGNOSIS_LABELS[category] || category;
      return `${n} ${n === 1 ? label : pluralise(label)}`;
    })
    .join(', ');

  components.push(say(`**Where this round went wrong:** ${summary}. Each one is broken down below, then the same ideas come back as new questions.`));

  misses.forEach((miss, index) => {
    const lines = [
      `**${index + 1}. ${miss.label[0].toUpperCase()}${miss.label.slice(1)} — ${miss.question.slice(0, 200)}**`,
      '',
      miss.detail,
    ];
    if (miss.correct) lines.push('', `**The right answer:** ${miss.correct}`);
    if (miss.explanation) lines.push('', miss.explanation);
    components.push(say(lines.join('\n')));
  });

  return { misses, components };
}

export { groupTopicsByUnit, syllabusMarkdown, questionsPerRound } from './topics.js';

/**
 * A whole test round in one form.
 *
 * `/test` used to ask one question at a time, but a round of 5–15 is a single
 * sitting: the learner answers them together and gets one diagnosis of the round,
 * not fourteen separate verdicts. Batch submission is also what makes an honest
 * "which category was that mistake" possible — the round is analysed as a whole.
 *
 * `index`/`total` on the form title count questions; the session counts rounds.
 */
export function testRoundForm({ questions = [], topic, sessionId, title = null }) {
  const fieldLike = questions.map((question) => ({
    id: String(question.id).slice(0, 64),
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
    code_snippet: question.code_snippet || undefined,
    code_inline: question.code_inline || undefined,
    min: question.min,
    max: question.max,
    step: question.step,
  }));

  return {
    id: `round_${sessionId || 's'}_${encoder()}`.slice(0, 80),
    type: 'question_form',
    title: title || `${topic?.title ? `${topic.title} — ` : ''}${questions.length} questions`,
    description: 'Answer all of them, then submit once. The whole round is marked together.',
    questions: fieldLike,
    submission: {
      button_text: `Submit ${questions.length} answer${questions.length === 1 ? '' : 's'}`,
      action: 'submit_ai_questions',
      evaluation: 'ai_evaluation',
    },
  };
}

/**
 * Choose the next round's questions for a set of concepts.
 *
 * A round covers the *unit*, not one concept: the learner picked a unit and
 * expects it tested. Concepts are cycled so the questions spread across the
 * unit, and concepts that were missed last round are asked again first — that is
 * what makes the retest a retest rather than a different quiz.
 *
 * Every question is authored fresh. `avoid` carries the stems already asked, so
 * a retest does not repeat the questions that produced the gaps.
 */
export async function authorRound({
  concepts = [],
  count = 8,
  syllabusExcerptFor = null,
  sessionText = '',
  language = null,
  weakConceptIds = [],
  avoid = [],
  userId,
  conversationId,
} = {}) {
  const ordered = [
    ...concepts.filter((c) => weakConceptIds.includes(c.id)),
    ...concepts.filter((c) => !weakConceptIds.includes(c.id)),
  ];
  const target = ordered.length ? ordered : concepts;
  const questions = [];
  const seen = new Set(avoid.map((s) => String(s).toLowerCase().slice(0, 80)));

  // Author in parallel: a round of 15 sequential model calls would take minutes
  // and hit the gateway timeout long before it finished.
  const slots = Array.from({ length: count }, (_, i) => target[i % target.length]).filter(Boolean);
  const drafted = await Promise.all(slots.map((concept, i) => authorQuestion({
    topic: concept,
    syllabusExcerpt: syllabusExcerptFor ? syllabusExcerptFor(concept) : `${concept.summary || ''}\n\n${String(sessionText).slice(0, 800)}`,
    attempt: (concept.attempts || 0) + 1 + Math.floor(i / target.length),
    previous: null,
    language: language || languageFor(`${sessionText} ${concept.title}`),
    userId,
    conversationId,
    // How many times this concept has already appeared in *this* round. The local
    // fallback uses it to ask about the same idea from a different angle, which is
    // what keeps a 5–15 question round from being the same question five times.
    variant: i < target.length ? 0 : 1 + Math.floor(i / target.length) - 1,
    avoid: [...seen],
  })));

  drafted.forEach((question, i) => {
    if (!question || !String(question.question || '').trim()) return;
    const stem = String(question.question || '').toLowerCase().slice(0, 80);
    // A repeated stem inside one round reads as a copy-paste error, so it is
    // skipped — but only when there is something else to show. Dropping it always
    // is what silently left a five-question round with three questions in it.
    if (seen.has(stem)) return;
    seen.add(stem);
    questions.push({ ...question, topicId: slots[i]?.id || null, concept: slots[i]?.title || null });
  });

  // Top the round up if drafts were dropped. The variants are cheap (no model
  // call on the fallback path) and a round of fewer than `count` questions is
  // still a round — it is not worth failing over one duplicate.
  let top = 1;
  while (questions.length < count && top <= 6) {
    for (const concept of target) {
      if (questions.length >= count) break;
      const extra = localQuestion(concept, { attempt: 1, language: language || languageFor(`${sessionText} ${concept.title}`), variant: top });
      const stem = String(extra?.question || '').toLowerCase().slice(0, 80);
      if (!extra?.question || seen.has(stem)) continue;
      seen.add(stem);
      questions.push({ ...extra, topicId: concept.id, concept: concept.title });
    }
    top += 1;
  }

  return questions;
}
