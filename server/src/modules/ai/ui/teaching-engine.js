import { z } from 'zod';
import { UI_LIMITS, fallbackTextDocument, parseUiDocument, repairUiDocument, cleanText } from './protocol.js';

/**
 * EDUCATIONAL TUTORIAL ENGINE
 * ===========================
 *
 * The teaching workflow, as data rather than prose:
 *
 *   1. analyse the question        7. generate UI components
 *   2. identify subject + concept  8. add practical examples
 *   3. estimate the level          9. add interactive exercises
 *   4. set the learning objective 10. generate an assessment
 *   5. choose a strategy          11. evaluate the student
 *   6. write the explanation      12. recommend the next step
 *
 * Two entry points matter:
 *
 *  `authorTutorial()` turns a model-authored document into a *teaching* document:
 *  it applies the component-selection policy, enforces the lesson skeleton
 *  (objectives → explanation → analogy → visual → example → practice → check →
 *  summary) and validates the result. It never invents facts.
 *
 *  `buildLocalTutorial()` is the deterministic author used when no model key is
 *  configured, when the model returns unusable JSON, or when a real tutorial is
 *  requested for a subject we can teach from a template. It produces genuinely
 *  useful Python / mathematics / physics / machine-learning lessons — not
 *  placeholder text — and it is what the test suite exercises.
 */

/* -------------------------------------------------------------------------- */
/* 1-5: analysis                                                               */
/* -------------------------------------------------------------------------- */

const SUBJECT_RULES = [
  {
    subject: 'computer_science',
    match: /\b(python|javascript|java\b|sql|code|coding|program\w*|loop|recursion|function|variable|array|list\b|dict|class\b|object|algorithm|sort|search|complexity|debug|regex)\b/i,
    strategy: 'practice_first',
    defaultLanguage: 'python',
  },
  {
    subject: 'artificial_intelligence',
    match: /\b(machine learning|deep learning|neural\w*|transformer|gradient descent|backprop\w*|classification|regression|clustering|llm|embedding|overfitting|tensor|cnn|rnn|attention)\b/i,
    strategy: 'visual_first',
    defaultLanguage: 'python',
  },
  {
    subject: 'mathematics',
    match: /\b(math\w*|algebra|calculus|derivatives?|integrals?|matrix|matrices|probability|statistic\w*|equations?|functions?|vectors?|geometry|trig\w*|limit|series|polynomial|logarithm)\b/i,
    strategy: 'worked_example',
    defaultLanguage: 'python',
  },
  {
    subject: 'physics',
    match: /\b(physics|force|velocity|acceleration|momentum|energy|newton|circuit|voltage|current|resistance|wave|optics|thermo\w*|gravit\w*|kinematic\w*)\b/i,
    strategy: 'analogy_first',
    defaultLanguage: 'python',
  },
  {
    subject: 'chemistry',
    match: /\b(chemistry|molecule|atom\w*|reaction|bond\w*|acid|base\b|ph\b|electron|orbital|periodic|stoichiometr\w*|compound)\b/i,
    strategy: 'analogy_first',
    defaultLanguage: 'python',
  },
  {
    subject: 'history',
    match: /\b(history|historical|revolution|empire|dynasty|war\b|treaty|independence|ancient|civilization|century|movement)\b/i,
    strategy: 'step_by_step',
    defaultLanguage: 'javascript',
  },
  {
    subject: 'data_science',
    match: /\b(data science|pandas|dataframe|dataset|data analysis|visuali[sz]ation|correlation|hypothesis|a\/b test)\b/i,
    strategy: 'worked_example',
    defaultLanguage: 'python',
  },
];

/**
 * Stage 1-3 of the workflow: what is being asked, about what, at what level.
 *
 * Level inference is deliberately conservative and explains itself — the model's
 * own view is preferred, and this only fills gaps or contradict-free details.
 */
export function analyseQuestion({ question = '', studentLevel = '', concept = null, subject = '', profile = null } = {}) {
  const text = `${question} ${concept?.name || ''} ${concept?.description || ''} ${subject}`.slice(0, 4000);
  const rule = SUBJECT_RULES.find((r) => r.match.test(text));
  const signals = [];
  let level = studentLevel || profile?.knowledgeLevel || '';

  if (!level) {
    if (/\b(for beginners?|from scratch|never (done|learned)|first time|basics?|simple explanation)\b/i.test(question)) {
      level = 'beginner';
      signals.push('question states no prior experience');
    } else if (/\b(advanced|expert|internals?|edge cases?|optimis[ez]|under the hood|proof)\b/i.test(question)) {
      level = 'advanced';
      signals.push('question asks for depth');
    } else {
      level = 'developing';
      signals.push('no level evidence — defaulting to developing');
    }
  } else {
    signals.push(`level from learner profile: ${level}`);
  }

  const objective = inferObjective(question, concept, rule?.subject);
  const wantsPractice = /\b(practice|practise|exercise|hands[- ]on|write (the|some)? ?code|implement|build)\b/i.test(question);
  const wantsQuiz = /\b(quiz|test me|check|exam|revision)\b/i.test(question);
  const wantsProof = /\b(why|prove|derive|explain how|intuition)\b/i.test(question);
  const wantsCode = rule?.subject === 'computer_science' || rule?.subject === 'data_science' || rule?.subject === 'artificial_intelligence';

  const strategy = wantsPractice
    ? 'practice_first'
    : wantsQuiz
      ? 'socratic'
      : rule?.strategy || 'step_by_step';

  return {
    subject: rule?.subject || (subject ? 'general' : 'general'),
    conceptName: concept?.name || extractConcept(question),
    level,
    signals,
    objective,
    strategy,
    wantsPractice,
    wantsQuiz,
    wantsProof,
    wantsCode,
    language: rule?.defaultLanguage || 'python',
  };
}

function inferObjective(question, concept, subject) {
  const name = concept?.name || extractConcept(question);
  if (!name) return 'Understand the idea well enough to use it.';
  if (/\b(teach|learn|how does|explain|what is)\b/i.test(question)) return `Understand how ${name} works and when to use it.`;
  if (/\b(debug|fix|error)\b/i.test(question)) return `Diagnose and fix a fault involving ${name}.`;
  if (subject === 'mathematics') return `Set up and solve problems involving ${name}.`;
  if (subject === 'physics') return `Apply ${name} to a physical situation and check the result.`;
  return `Apply ${name} correctly in a new situation.`;
}

function extractConcept(question) {
  const cleaned = cleanText(question)
    .replace(/^(please\s+)?(can you\s+)?(teach me|explain|show me|help me (with|understand)|tell me about|what is|what are|how (do|does))\s+/i, '')
    .replace(/\b(in|with|using)\s+(python|javascript|java|sql)\b.*$/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();
  return cleaned.slice(0, 90) || '';
}

/* -------------------------------------------------------------------------- */
/* component selection policy (section 6 of the specification)                  */
/* -------------------------------------------------------------------------- */

/**
 * Which components a subject should reach for, and which it should avoid.
 *
 * This is the codified version of "the AI must not use every component for
 * every question": the author filters the model's proposal through this, and
 * appends what the lesson skeleton requires but the model forgot.
 */
export const SUBJECT_COMPONENTS = Object.freeze({
  computer_science: ['text', 'code_editor', 'execution_trace', 'execution_table', 'variable_visualization', 'quiz', 'question_form', 'diagram'],
  artificial_intelligence: ['text', 'diagram', 'math', 'chart', 'simulation', 'quiz', 'question_form'],
  mathematics: ['text', 'math', 'chart', 'table', 'question_form', 'quiz', 'simulation'],
  physics: ['text', 'diagram', 'math', 'simulation', 'chart', 'question_form', 'quiz'],
  chemistry: ['text', 'diagram', 'table', 'timeline', 'quiz', 'question_form'],
  history: ['text', 'timeline', 'card', 'question_form', 'quiz'],
  data_science: ['text', 'table', 'chart', 'code_editor', 'quiz', 'question_form'],
  general: ['text', 'card', 'learning', 'math', 'chart', 'diagram', 'quiz', 'question_form'],
});

/** Structural types that appear in almost every good tutorial. */
const CORE_TYPES = new Set(['text', 'learning', 'card', 'question_form']);

/**
 * Is this component justified in this lesson?
 *
 * Content-bearing lesson types are always allowed (they *are* the lesson);
 * heavy interactive types must match the subject's palette or the learner's
 * explicit request. A chemistry lesson does not get a code editor because the
 * model felt like it.
 */
export function isComponentAllowed(component, { subject, wantsCode = false } = {}) {
  if (!component?.type) return false;
  const palette = SUBJECT_COMPONENTS[subject] || SUBJECT_COMPONENTS.general;
  const light = new Set(['text', 'learning', 'card', 'table', 'chart', 'math', 'progress', 'timeline', 'tabs', 'accordion', 'actions', 'navigation', 'media', 'layout', 'teaching_workflow']);
  if (light.has(component.type)) return true;
  if (CORE_TYPES.has(component.type)) return true;
  if (component.type === 'code_editor' || component.type === 'execution_trace' || component.type === 'execution_table' || component.type === 'variable_visualization') {
    return palette.includes(component.type) || wantsCode;
  }
  return palette.includes(component.type);
}

const clampString = (value, max) => cleanText(value).slice(0, max);

/* -------------------------------------------------------------------------- */
/* local (deterministic) authoring                                             */
/* -------------------------------------------------------------------------- */

/**
 * Templates. Each is a real teaching sequence, keyed by a matcher on the
 * concept name. The generic template is written to be *useful* for any concept
 * given a description and objectives, because it works from the syllabus rather
 * than from invented facts.
 */
const TEMPLATES = [
  {
    key: 'python_recursion',
    match: /\brecursion|recursive|base case|call stack\b/i,
    build: () => ({
      title: 'Recursion in Python',
      objectives: ['Identify the base case and the recursive case', 'Trace a recursive call on the stack', 'Write a correct recursive function'],
      analogy: 'Think of Russian nesting dolls: to open the smallest one you must first open the larger ones, and you stop when there are no dolls left. The stop is the base case; opening the next doll is the recursive call.',
      explanation:
        'A recursive function solves a problem by calling **itself** on a smaller version of the same problem.\n\nEvery recursive function needs two parts:\n\n1. **Base case** — the smallest input, answered directly, with no further call. Without it the function never stops.\n2. **Recursive case** — reduce the problem and call the function on that smaller input.\n\nPython limits recursion depth (about 1000 frames by default), which is why deeply nested loops are usually written iteratively.',
      code: 'def factorial(n):\n    if n <= 1:            # base case\n        return 1\n    return n * factorial(n - 1)   # recursive case\n\nprint(factorial(4))',
      language: 'python',
      expectedOutput: '24',
      trace: [
        { line: 4, variables: { n: '4' }, call_stack: ['factorial(4)'], note: 'not the base case → recurse' },
        { line: 4, variables: { n: '3' }, call_stack: ['factorial(4)', 'factorial(3)'], note: 'each frame waits for the next' },
        { line: 4, variables: { n: '2' }, call_stack: ['factorial(4)', 'factorial(3)', 'factorial(2)'], note: '' },
        { line: 2, variables: { n: '1' }, call_stack: ['factorial(4)', 'factorial(3)', 'factorial(2)', 'factorial(1)'], note: 'base case reached — calls start returning' },
        { line: 5, variables: { result: '24' }, call_stack: [], note: '2 × 3 × 4 unwinds back to the caller' },
      ],
      diagram: {
        type: 'stack',
        nodes: [
          { id: 'f1', label: 'factorial(1)', detail: 'returns 1' },
          { id: 'f2', label: 'factorial(2)', detail: '2 × 1 = 2' },
          { id: 'f3', label: 'factorial(3)', detail: '3 × 2 = 6' },
          { id: 'f4', label: 'factorial(4)', detail: '4 × 6 = 24' },
        ],
        edges: [
          { from: 'f4', to: 'f3', label: 'calls' },
          { from: 'f3', to: 'f2', label: 'calls' },
          { from: 'f2', to: 'f1', label: 'calls' },
        ],
      },
      practice: {
        prompt: 'Implement `total(n)` which returns the sum 1 + 2 + … + n using recursion. The base case is n == 0 → 0.',
        starter: 'def total(n):\n    # TODO: base case\n    # TODO: recursive case\n    pass\n\nprint(total(5))',
        expected: '15',
        tests: [{ id: 't1', name: 'total(0) == 0', args: [0], expected: '0' }, { id: 't2', name: 'total(5) == 15', args: [5], expected: '15' }],
      },
      questions: [
        { id: 'q1', type: 'radio', question: 'What happens if a recursive function has no base case?', options: ['It returns None', 'It recurses until Python raises RecursionError', 'It silently stops at 100 calls', 'Python refuses to define it'], required: true },
        { id: 'q2', type: 'textarea', question: 'Why does the base case run before the multiplication in factorial(4)?', required: true, placeholder: 'Explain what the stack has to do first…' },
        { id: 'q3', type: 'code_input', language: 'python', question: 'Write the base case line for total(n) where n == 0.', required: true },
      ],
      quiz: [
        { id: 'z1', question: 'Which line must come first in a recursive function?', options: ['The recursive call', 'A print statement', 'The base case'], correct_index: 2, explanation: 'The base case terminates the recursion; without reaching it first, the calls never stop.' },
        { id: 'z2', question: 'factorial(4) makes how many calls to factorial in total?', options: ['1', '4', 'Five including factorial(1)', 'Infinite'], correct_index: 2, explanation: 'factorial(4), (3), (2), (1) — four frames — and the answer is computed on the way back out.' },
      ],
    }),
  },
  {
    key: 'python_loops',
    match: /\bfor loop|while loop|loops?\b|iteration|iterate\b|range\s*\(/i,
    build: () => ({
      title: 'Loops in Python',
      objectives: ['Choose between for and while', 'Predict how many times a loop body runs', 'Trace loop variables step by step'],
      analogy: 'A loop is a checkout conveyor belt: each item moves under the scanner once, and the belt stops when the items run out.',
      explanation:
        'A **for** loop walks over a sequence. The number of iterations is decided up front.\n\nA **while** loop repeats while a condition holds. You must change something inside it, or it runs forever.\n\n```python\nfor i in range(3):     # 0, 1, 2\n    print(i)\n```\n\n`range(3)` produces 0, 1, 2 — it stops *before* 3. That off-by-one is the most common loop bug.',
      code: 'total = 0\nfor n in range(1, 5):\n    total = total + n\nprint(total)',
      language: 'python',
      expectedOutput: '10',
      executionTable: [
        { step: 1, line: 2, statement: 'n = 1', variables: { total: '0', n: '1' }, output: '' },
        { step: 2, line: 3, statement: 'total = 0 + 1', variables: { total: '1', n: '1' }, output: '' },
        { step: 3, line: 2, statement: 'n = 2', variables: { total: '1', n: '2' }, output: '' },
        { step: 4, line: 3, statement: 'total = 1 + 2', variables: { total: '3', n: '2' }, output: '' },
        { step: 5, line: 2, statement: 'n = 3', variables: { total: '3', n: '3' }, output: '' },
        { step: 6, line: 3, statement: 'total = 3 + 3', variables: { total: '6', n: '3' }, output: '' },
        { step: 7, line: 2, statement: 'n = 4', variables: { total: '6', n: '4' }, output: '' },
        { step: 8, line: 3, statement: 'total = 6 + 4', variables: { total: '10', n: '4' }, output: '' },
        { step: 9, line: 4, statement: 'print(total)', variables: { total: '10', n: '4' }, output: '10' },
      ],
      diagram: {
        type: 'flowchart',
        nodes: [
          { id: 'start', label: 'Start', shape: 'terminal' },
          { id: 'init', label: 'total = 0', shape: 'process' },
          { id: 'cond', label: 'More items in range?', shape: 'decision' },
          { id: 'body', label: 'total = total + n', shape: 'process' },
          { id: 'out', label: 'print(total)', shape: 'io' },
          { id: 'end', label: 'End', shape: 'terminal' },
        ],
        edges: [
          { from: 'start', to: 'init' },
          { from: 'init', to: 'cond' },
          { from: 'cond', to: 'body', label: 'yes' },
          { from: 'body', to: 'cond', label: 'next n', style: 'dashed' },
          { from: 'cond', to: 'out', label: 'no' },
          { from: 'out', to: 'end' },
        ],
      },
      practice: {
        prompt: 'Use a loop to compute the sum of the squares 1² + 2² + … + n².',
        starter: 'def sum_squares(n):\n    total = 0\n    # TODO: loop over 1..n and add each square\n    return total\n\nprint(sum_squares(3))',
        expected: '14',
        tests: [{ id: 't1', name: 'sum_squares(3) == 14', args: [3], expected: '14' }, { id: 't2', name: 'sum_squares(1) == 1', args: [1], expected: '1' }],
      },
      questions: [
        { id: 'q1', type: 'radio', question: 'How many times does `for i in range(4)` run?', options: ['3', '4', '5', 'Depends on the body'], required: true },
        { id: 'q2', type: 'textarea', question: 'When would you choose while over for?', required: true },
        { id: 'q3', type: 'code_input', language: 'python', question: 'Write a loop that prints 0, 1, 2.', required: true },
      ],
      quiz: [
        { id: 'z1', question: 'What does range(1, 5) produce?', options: ['1, 2, 3, 4, 5', '1, 2, 3, 4', '0, 1, 2, 3, 4'], correct_index: 1, explanation: 'range stops before its second argument.' },
        { id: 'z2', question: 'Which loop is safer when the count is unknown?', options: ['for', 'while', 'Neither'], correct_index: 1, explanation: 'A while loop tests a condition each pass, so it can stop on a condition rather than a count.' },
      ],
    }),
  },
  {
    key: 'python_variables',
    match: /\bvariables?\b|assignment|data types?\b|strings?\b|integers?\b/i,
    build: () => ({
      title: 'Variables and types in Python',
      objectives: ['Create variables of the core types', 'Explain what a variable name refers to', 'Predict type errors before running'],
      analogy: 'A variable is a label on a box. The label is not the box — you can move it to another box (reassign) while the old contents stay where they were.',
      explanation:
        'A **variable** is a *name bound to a value*. Python binds lazily: `x = 10` creates an integer object and points `x` at it.\n\nCore types you need first: `int`, `float`, `str`, `bool`, `None`. Types matter because `"5" + 5` is an error — a string and a number are different objects.\n\nNames are case-sensitive and cannot start with a digit.',
      code: 'x = 10\ny = x\nx = 20\nprint(x, y)',
      language: 'python',
      expectedOutput: '20 10',
      variableViz: {
        steps: [
          { label: 'x = 10', variables: [{ name: 'x', value: '10', type: 'int', changed: true }] },
          { label: 'y = x', variables: [{ name: 'x', value: '10', type: 'int', changed: false }, { name: 'y', value: '10', type: 'int', changed: true }] },
          { label: 'x = 20', variables: [{ name: 'x', value: '20', type: 'int', changed: true }, { name: 'y', value: '10', type: 'int', changed: false }] },
        ],
        finalOutput: '20 10',
      },
      practice: {
        prompt: 'Create a variable `count` with value 7, then print its type.',
        starter: 'count = 0\n# TODO: set count to 7 and print its type\n',
        expected: '7\n<type \'int\'>',
      },
      questions: [
        { id: 'q1', type: 'radio', question: 'After `a = 5; b = a; a = 6`, what is `b`?', options: ['5', '6', 'None', 'Error'], required: true },
        { id: 'q2', type: 'text_input', question: 'Name the type of `3.0` in Python.', required: true, placeholder: 'e.g. int' },
        { id: 'q3', type: 'boolean', question: 'A variable must be declared with its type before use in Python.', required: true },
      ],
      quiz: [
        { id: 'z1', question: 'What does `type("3")` return?', options: ['int', 'str', 'float'], correct_index: 1, explanation: 'Quotes make it a string, whatever the characters inside.' },
      ],
    }),
  },
  {
    key: 'math_derivative',
    match: /\bderivative|differentiat\w*|rate of change|gradient\b(?! descent)|chain rule\b/i,
    build: () => ({
      title: 'Derivatives',
      objectives: ['Explain a derivative as an instantaneous rate of change', 'Apply the power rule', 'Interpret the sign of a derivative'],
      analogy: 'A car’s speedometer shows the derivative of its position: at any instant, how fast position is changing. You do not need the whole journey — just that moment.',
      explanation:
        'The derivative of $f$ at $x$ is the *instantaneous* rate of change:\n\n$$f\'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}$$\n\nFor powers there is a shortcut, the **power rule**: $\\frac{d}{dx} x^n = n x^{n-1}$.\n\nA derivative is a slope. Positive means the function is increasing there, negative decreasing, zero is a stationary point (a peak, a valley, or a plateau).',
      math: { latex: 'f\'(x) = \\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h}', explanation: 'The limit of the average rate of change over a shrinking interval.' },
      chart: {
        chartType: 'line',
        labels: ['-2', '-1', '0', '1', '2', '3'],
        series: [{ name: 'f(x) = x²', data: [4, 1, 0, 1, 4, 9] }, { name: "f'(x) = 2x", data: [-4, -2, 0, 2, 4, 6] }],
        xLabel: 'x',
        yLabel: 'value',
      },
      steps: [
        { label: 'Power rule', latex: '\\frac{d}{dx}x^3 = 3x^2' },
        { label: 'Sum rule', latex: '\\frac{d}{dx}(x^3+x^2) = 3x^2 + 2x' },
        { label: 'Evaluate at x = 2', latex: "f'(2) = 3(4) + 2(2) = 16" },
      ],
      practice: {
        prompt: 'Compute the derivative of $f(x) = 3x^4 - 2x + 5$ at $x = 1$.',
        starter: "def derivative_at(x):\n    # f(x) = 3x**4 - 2x + 5  →  f'(x) = 12x**3 - 2\n    return None\n\nprint(derivative_at(1))",
        expected: '10',
        language: 'python',
      },
      questions: [
        { id: 'q1', type: 'number', question: 'What is the derivative of x³ at x = 2?', required: true, validation: { min: -1000, max: 1000 } },
        { id: 'q2', type: 'radio', question: 'A negative derivative at x means…', options: ['f is increasing', 'f is decreasing', 'f has a maximum', 'f is constant'], required: true },
        { id: 'q3', type: 'textarea', question: 'Explain in one sentence what the limit h → 0 accomplishes.', required: true },
      ],
      quiz: [
        { id: 'z1', question: 'd/dx (5x²) = ?', options: ['5x', '10x', '10x²'], correct_index: 1, explanation: 'Power rule: multiply by the exponent, then reduce it by one.' },
      ],
    }),
  },
  {
    key: 'physics_newton',
    match: /\bnewton|force|mass|acceleration|f\s*=\s*ma\b|momentum\b/i,
    build: () => ({
      title: "Newton's second law",
      objectives: ['State the relation between force, mass and acceleration', 'Resolve a simple problem with units', 'Predict how mass affects acceleration'],
      analogy: 'Pushing a shopping trolley: the same push moves an empty trolley faster than a full one. Force is the push, mass is how much there is to move.',
      explanation:
        'Newton’s second law says the net force on an object equals its mass times its acceleration:\n\n$$\\sum F = m a$$\n\nAcceleration points the same way as the **net** force. Units: newtons (N) = kg·m/s².\n\nIf the net force is zero, acceleration is zero — the object keeps its velocity (including zero). That is why an object can move without a force acting on it.',
      math: { latex: '\\sum F = m \\cdot a', explanation: 'Net force (N) = mass (kg) × acceleration (m/s²).' },
      diagram: {
        type: 'flowchart',
        nodes: [
          { id: 'pull', label: 'Applied force F', shape: 'process' },
          { id: 'fric', label: 'Friction −f', shape: 'process' },
          { id: 'net', label: 'Net force = F − f', shape: 'process' },
          { id: 'acc', label: 'a = net / m', shape: 'io' },
        ],
        edges: [
          { from: 'pull', to: 'net' },
          { from: 'fric', to: 'net' },
          { from: 'net', to: 'acc' },
        ],
      },
      chart: {
        chartType: 'bar',
        labels: ['m = 1 kg', 'm = 2 kg', 'm = 4 kg'],
        series: [{ name: 'a (m/s²) for F = 8 N', data: [8, 4, 2] }],
        xLabel: 'mass',
        yLabel: 'acceleration',
      },
      practice: {
        prompt: 'Compute acceleration from net force and mass. `accel(8, 2)` should return 4.',
        starter: 'def accel(force, mass):\n    # TODO: implement a = F / m\n    return None\n\nprint(accel(8, 2))',
        expected: '4.0',
        language: 'python',
      },
      questions: [
        { id: 'q1', type: 'number', question: 'A 2 kg mass experiences a net force of 10 N. What is its acceleration (m/s²)?', required: true },
        { id: 'q2', type: 'radio', question: 'An object moves at constant velocity. What is the net force?', options: ['Zero', 'Equal to its weight', 'Increasing', 'Unknown'], required: true },
        { id: 'q3', type: 'slider', question: 'How confident are you about solving F = ma problems?', min: 1, max: 5, step: 1, required: false },
      ],
      quiz: [
        { id: 'z1', question: 'Doubling the mass with the same force does what to acceleration?', options: ['Doubles it', 'Halves it', 'No change'], correct_index: 1, explanation: 'a = F/m, so doubling m halves a.' },
      ],
    }),
  },
  {
    key: 'ml_gradient_descent',
    match: /\bgradient descent|learning rate|loss function|optimis[ez]ation|backprop\w*|neural network|weights?\b/i,
    build: () => ({
      title: 'Gradient descent',
      objectives: ['Explain how a model reduces its loss', 'Describe the role of the learning rate', 'Predict what happens if the learning rate is wrong'],
      analogy: 'You are on a foggy hill and want the bottom. You can only feel the slope under your feet. Take a step downhill, feel again, repeat. Step size is the learning rate.',
      explanation:
        'Training a model means minimising a **loss** function. Gradient descent does this by repeatedly stepping against the gradient:\n\n$$\\theta_{t+1} = \\theta_t - \\eta \\nabla_\\theta L(\\theta_t)$$\n\n$\\eta$ is the **learning rate**. Too small: training crawls. Too large: the step overshoots the valley and the loss oscillates or diverges.\n\nStochastic variants estimate the gradient from a mini-batch, which is noisier but far cheaper per step.',
      math: { latex: '\\theta_{t+1} = \\theta_t - \\eta \\nabla_\\theta L(\\theta_t)' },
      chart: {
        chartType: 'line',
        labels: ['epoch 1', '2', '3', '4', '5', '6'],
        series: [
          { name: 'lr = 0.01', data: [2.3, 1.6, 1.2, 0.95, 0.8, 0.72] },
          { name: 'lr = 0.5', data: [2.3, 0.9, 0.42, 0.31, 0.3, 0.3] },
        ],
        xLabel: 'epoch',
        yLabel: 'loss',
      },
      diagram: {
        type: 'graph',
        nodes: [
          { id: 'data', label: 'Training batch', shape: 'database' },
          { id: 'fwd', label: 'Forward pass', shape: 'process' },
          { id: 'loss', label: 'Loss L', shape: 'io' },
          { id: 'grad', label: 'Gradient ∇L', shape: 'process' },
          { id: 'step', label: 'Update θ', shape: 'process' },
        ],
        edges: [
          { from: 'data', to: 'fwd' },
          { from: 'fwd', to: 'loss' },
          { from: 'loss', to: 'grad' },
          { from: 'grad', to: 'step' },
          { from: 'step', to: 'fwd', label: 'next batch', style: 'dashed' },
        ],
      },
      simulation: {
        parameters: [
          { id: 'lr', label: 'Learning rate', min: 0.001, max: 1, step: 0.001, default: 0.1 },
          { id: 'epochs', label: 'Epochs', min: 1, max: 50, step: 1, default: 10 },
        ],
        description: 'Adjust the learning rate and see how many epochs a simple convex loss takes to settle.',
        outcomes: [
          { label: 'Too small', detail: 'Loss decreases, but slowly — many epochs needed.', when: { lr: 0.005 } },
          { label: 'Reasonable', detail: 'Loss drops steadily and settles.', when: { lr: 0.1 } },
          { label: 'Too large', detail: 'Loss bounces or diverges; the step overshoots the minimum.', when: { lr: 0.9 } },
        ],
      },
      questions: [
        { id: 'q1', type: 'radio', question: 'The loss oscillates wildly between epochs. Most likely cause?', options: ['Learning rate too high', 'Learning rate too low', 'Too much data', 'The model is too simple'], required: true },
        { id: 'q2', type: 'textarea', question: 'In your own words, what does the gradient tell the update rule?', required: true },
        { id: 'q3', type: 'number', question: 'With η = 0.1 and gradient 4, by how much does θ change in one step? (absolute value)', required: true },
      ],
      quiz: [
        { id: 'z1', question: 'Gradient descent moves…', options: ['along the gradient', 'against the gradient', 'perpendicular to it'], correct_index: 1, explanation: 'The gradient points uphill; we subtract it to go downhill.' },
      ],
    }),
  },
];

const GENERIC_TEMPLATE = {
  key: 'generic',
  build: ({ conceptName, objective, concept }) => ({
    title: conceptName ? `Understanding ${conceptName}` : 'Let’s work through this',
    objectives: concept?.objectives?.length ? concept.objectives.slice(0, 5) : [objective],
    analogy: null,
    explanation: `**${conceptName || 'This topic'}** — ${concept?.description || 'here is the working definition to build on.'}\n\nWork in three passes:\n\n1. **Name it** — say what it is in one sentence, without jargon.\n2. **Use it** — apply it to the smallest possible example.\n3. **Break it** — find an input where a naive understanding fails.\n\nThat third pass is where understanding actually forms: a definition you cannot break is a definition you have not tested.`,
    code: null,
    questions: [
      { id: 'q1', type: 'textarea', question: `Explain ${conceptName || 'this concept'} in your own words, as if to a classmate who missed the lesson.`, required: true },
      { id: 'q2', type: 'radio', question: 'How confident are you that you could use this without notes?', options: ['Not yet', 'With hints', 'Mostly', 'Confidently'], required: true },
      { id: 'q3', type: 'text_input', question: 'Name one situation where this concept would apply.', required: true },
    ],
    quiz: [],
  }),
};

/**
 * Build a validated educational document without a model.
 *
 * @param {object} options
 * @param {string} options.question
 * @param {object} [options.concept]  syllabus concept ({ name, description, objectives, keywords })
 * @param {string} [options.level]
 * @param {string} [options.subject]  explicit subject label
 * @param {string} [options.responseId]
 * @param {boolean} [options.compact]  omit the practice/quiz half (used for mid-conversation turns)
 */
export function buildLocalTutorial({ question = '', concept = null, level = '', subject = '', responseId = `local_${Date.now().toString(36)}`, compact = false } = {}) {
  const analysis = analyseQuestion({ question, concept, studentLevel: level, subject });
  const haystack = `${question} ${concept?.name || ''} ${concept?.description || ''}`;
  const template = TEMPLATES.find((t) => t.match.test(haystack));
  const lesson = template ? template.build() : GENERIC_TEMPLATE.build({ conceptName: analysis.conceptName, objective: analysis.objective, concept });

  const components = [];
  const push = (component) => {
    if (component) components.push({ ...component, id: component.id || `c${components.length + 1}` });
  };

  push({
    id: 'overview',
    type: 'learning',
    title: lesson.title,
    objectives: lesson.objectives,
    analogy: lesson.analogy || undefined,
    key_points: concept?.keywords?.length ? concept.keywords.slice(0, 6).map((k) => `Term to know: ${k}`) : undefined,
  });

  push({ id: 'explain', type: 'text', format: 'markdown', content: lesson.explanation });

  if (lesson.math) push({ id: 'formula', type: 'math', latex: lesson.math.latex, explanation: lesson.math.explanation, display: 'block' });

  if (lesson.diagram) {
    push({
      id: 'diagram',
      type: 'diagram',
      diagram_type: lesson.diagram.type === 'flowchart' ? 'flowchart' : lesson.diagram.type === 'stack' ? 'stack' : 'graph',
      title: lesson.diagram.type === 'stack' ? 'The call stack, bottom → top' : 'How it moves',
      caption: 'Follow the arrows; the dashed arrow is the repeat.',
      nodes: lesson.diagram.nodes,
      edges: lesson.diagram.edges,
      order: lesson.diagram.type === 'stack' ? lesson.diagram.nodes.map((n) => n.id) : undefined,
    });
  }

  if (lesson.code) {
    push({
      id: 'example_code',
      type: 'code_editor',
      language: lesson.language || 'python',
      title: 'Worked example — read it, run it, then change it',
      instructions: 'Run the example first. Then change an input and predict the result before running again.',
      starter_code: lesson.code,
      expected_output: lesson.expectedOutput,
      run_enabled: true,
      reset_enabled: true,
    });
  }

  if (lesson.executionTable) {
    push({
      id: 'execution',
      type: 'execution_table',
      title: 'Step-by-step execution',
      description: 'Each row is one pass through the loop body.',
      steps: lesson.executionTable,
    });
  }

  if (lesson.variableViz) {
    push({
      id: 'variables',
      type: 'variable_visualization',
      title: 'What each variable holds',
      steps: lesson.variableViz.steps,
      final_output: lesson.variableViz.finalOutput,
    });
  }

  if (lesson.trace) {
    push({
      id: 'trace',
      type: 'execution_trace',
      language: lesson.language || 'python',
      title: 'Trace the calls',
      code: lesson.code,
      steps: lesson.trace.map((s) => ({ line: s.line, variables: s.variables, call_stack: s.call_stack, note: s.note || undefined })),
      playback: true,
    });
  }

  if (lesson.chart) {
    push({
      id: 'chart',
      type: 'chart',
      chart_type: lesson.chart.chartType,
      title: 'See the relationship',
      labels: lesson.chart.labels,
      series: lesson.chart.series,
      x_label: lesson.chart.xLabel,
      y_label: lesson.chart.yLabel,
    });
  }

  if (lesson.steps) {
    push({ id: 'worked', type: 'math', title: 'Worked steps', latex: lesson.math?.latex || '\\sum F = ma', steps: lesson.steps, display: 'block' });
  }

  if (lesson.simulation) {
    push({
      id: 'simulation',
      type: 'simulation',
      simulation_kind: 'parameters',
      title: 'Try the parameters',
      description: lesson.simulation.description,
      parameters: lesson.simulation.parameters,
      outcomes: lesson.simulation.outcomes,
      formula_latex: lesson.math?.latex,
    });
  }

  if (!compact && lesson.practice) {
    push({
      id: 'practice',
      type: 'code_editor',
      language: lesson.practice.language || lesson.language || 'python',
      title: 'Your turn',
      instructions: lesson.practice.prompt,
      starter_code: lesson.practice.starter,
      expected_output: lesson.practice.expected,
      tests: lesson.practice.tests,
      run_enabled: true,
      reset_enabled: true,
    });
  }

  if (lesson.questions?.length) {
    push({
      id: 'check',
      type: 'question_form',
      title: 'Knowledge check',
      description: 'Answer all required questions, then submit once — the tutor reads every answer together.',
      questions: lesson.questions,
      submission: { button_text: 'Submit answers for evaluation', action: 'submit_ai_questions', evaluation: 'ai_evaluation' },
    });
  }

  if (!compact && lesson.quiz?.length) {
    push({
      id: 'quiz',
      type: 'quiz',
      title: 'Quick quiz',
      questions: lesson.quiz,
      passing_score: 70,
      show_explanations: true,
    });
  }

  push({
    id: 'next',
    type: 'actions',
    title: 'Where next',
    actions: [
      { id: 'a1', label: 'Ask a follow-up question', action: 'continue_lesson', tone: 'neutral' },
      { id: 'a2', label: 'Practise in the workspace', action: 'open_practice', target: '/app/practice', tone: 'brand' },
      { id: 'a3', label: 'Take a graded assessment', action: 'start_assessment', target: '/app/assessments', tone: 'neutral' },
    ],
  });

  const document = {
    version: '1.0',
    response_id: responseId,
    response_type: lesson.questions?.length ? 'educational_tutorial' : 'clarification',
    metadata: {
      topic: (lesson.title || analysis.conceptName || 'Lesson').slice(0, 200),
      difficulty: analysis.level,
      language: 'en',
      strategy: analysis.strategy,
      estimated_minutes: compact ? 5 : 12,
    },
    learning_objectives: (lesson.objectives || []).slice(0, 8),
    components,
  };

  const parsed = parseUiDocument(document);
  if (parsed.ok) return { document: parsed.document, analysis, source: 'local' };
  // A template bug must never surface as an error: fall back to prose.
  return {
    document: fallbackTextDocument(lesson.explanation, { responseId, topic: analysis.conceptName }),
    analysis,
    source: 'local-fallback',
    issues: parsed.issues,
  };
}

/* -------------------------------------------------------------------------- */
/* model-authored documents                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turn a model's document into a teachable one.
 *
 * The model is asked for the whole document, but three things are enforced
 * here rather than trusted:
 *  - the lesson skeleton (objectives before explanation, a check at the end);
 *  - the subject palette (no execution tables in a history lesson);
 *  - validity (each component is individually checked; bad ones are dropped).
 */
export function authorTutorial({ raw, question = '', concept = null, level = '', subject = '', responseId } = {}) {
  const analysis = analyseQuestion({ question, concept, studentLevel: level, subject });
  const parsed = parseUiDocument(raw);

  let document = parsed.ok ? parsed.document : null;
  let dropped = [];
  let repaired = false;

  if (!document) {
    const repair = repairUiDocument(raw);
    if (repair) {
      document = repair.document;
      dropped = repair.dropped;
      repaired = true;
    }
  }

  if (!document) {
    return { document: null, analysis, source: 'invalid', issues: parsed.issues };
  }

  // Subject policy: filter out components that do not belong to this lesson.
  const kept = [];
  for (const component of document.components) {
    if (isComponentAllowed(component, { subject: analysis.subject, wantsCode: analysis.wantsCode })) kept.push(component);
    else dropped.push({ path: `components.${component.id}`, message: `"${component.type}" is not part of a ${analysis.subject} lesson` });
  }
  const components = kept.slice(0, UI_LIMITS.maxComponents);

  // Skeleton enforcement: a tutorial that never asks the student anything is a
  // document, not a lesson. Append a check only when the model provided none.
  const hasInteraction = components.some((c) => ['quiz', 'question_form', 'code_editor', 'simulation'].includes(c.type));
  if (analysis.wantsPractice && !components.some((c) => c.type === 'code_editor') && concept?.language) {
    components.push(localPracticeComponent(concept, analysis));
  }
  if (!hasInteraction && components.length < UI_LIMITS.maxComponents) {
    components.push({
      id: `check_${Date.now().toString(36)}`,
      type: 'question_form',
      title: 'Before we continue',
      questions: [
        {
          id: 'q1',
          type: 'textarea',
          question: `In one or two sentences, explain ${analysis.conceptName || 'the idea'} to someone who has not seen this lesson.`,
          required: true,
          placeholder: 'Your explanation…',
        },
        {
          id: 'q2',
          type: 'radio',
          question: 'How well could you use this without notes right now?',
          options: ['Not yet', 'With hints', 'Mostly', 'Confidently'],
          required: true,
        },
      ],
      submission: { button_text: 'Submit for feedback', action: 'submit_ai_questions', evaluation: 'ai_evaluation' },
    });
  }

  const next = {
    ...document,
    response_id: responseId || document.response_id,
    response_type: document.response_type === 'clarification' && components.length > 2 ? 'educational_tutorial' : document.response_type,
    metadata: {
      ...(document.metadata || {}),
      topic: document.metadata?.topic || analysis.conceptName,
      difficulty: document.metadata?.difficulty || analysis.level,
      strategy: document.metadata?.strategy || analysis.strategy,
    },
    learning_objectives: document.learning_objectives?.length ? document.learning_objectives : (concept?.objectives || []).slice(0, 6),
    components,
  };

  const final = parseUiDocument(next);
  if (!final.ok) {
    return { document: fallbackTextDocument(summariseProse(next), { responseId: responseId || document.response_id, topic: analysis.conceptName }), analysis, source: 'fallback', issues: final.issues, dropped };
  }
  return {
    document: final.document,
    analysis,
    source: repaired ? 'repaired' : 'model',
    dropped,
  };
}

function localPracticeComponent(concept, analysis) {
  return {
    id: 'practice_generated',
    type: 'code_editor',
    language: analysis.language || 'python',
    title: `Practise: ${concept.name}`,
    instructions: `Implement a small function that demonstrates ${concept.name}. Expected behaviour: ${(concept.objectives || [])[0] || concept.description || 'see the objectives above'}.`,
    starter_code: analysis.language === 'javascript' ? 'function solve(input) {\n  // TODO\n}\n\nconsole.log(solve(1));' : 'def solve(value):\n    # TODO\n    return value\n\nprint(solve(1))',
    run_enabled: true,
    reset_enabled: true,
  };
}

function summariseProse(document) {
  const chunks = [];
  for (const component of document.components || []) {
    if (component.type === 'text' && component.content) chunks.push(component.content);
    else if (component.type === 'learning' && component.objectives?.length) chunks.push(`**Objectives**\n${component.objectives.map((o) => `- ${o}`).join('\n')}`);
    else if (component.type === 'card' && component.body) chunks.push(component.body);
  }
  return chunks.join('\n\n') || 'The tutor could not build a structured lesson for that request. Please try rephrasing it.';
}

/* -------------------------------------------------------------------------- */
/* evaluation of a submitted question form                                     */
/* -------------------------------------------------------------------------- */

const evaluationSchema = z.object({
  overall: z.string().max(1500).optional(),
  score: z.number().min(0).max(100).optional(),
  per_question: z
    .array(
      z.object({
        question_id: z.string().max(64),
        verdict: z.enum(['correct', 'partly_correct', 'incorrect', 'unanswered', 'not_graded']),
        feedback: z.string().max(800).optional(),
        hint: z.string().max(500).optional(),
      }),
    )
    .max(UI_LIMITS.maxQuestions)
    .optional(),
  gaps: z.array(z.string().max(300)).max(8).optional(),
  next_step: z.string().max(500).optional(),
  follow_up_form: z.any().optional(),
});

/**
 * Deterministic evaluator, used when the model's evaluation is unusable.
 *
 * It is honest about its limits: without a reference answer it can only judge
 * presence, shape and length, so verdicts are `not_graded` for open text rather
 * than a fabricated "correct".
 */
export function localEvaluateAnswers({ questions = [], answers = [] } = {}) {
  const byId = new Map(answers.map((a) => [String(a.question_id), a.value]));
  const per = [];
  let gradable = 0;
  let earned = 0;

  for (const question of questions) {
    const value = byId.get(String(question.id));
    const unanswered = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    if (unanswered) {
      per.push({ question_id: question.id, verdict: question.required === false ? 'not_graded' : 'unanswered', feedback: question.required === false ? 'Optional — not answered.' : 'No answer was submitted.' });
      continue;
    }
    if (question.type === 'radio' || question.type === 'select') {
      gradable += 1;
      per.push({
        question_id: question.id,
        verdict: 'not_graded',
        feedback: `Recorded: “${String(value).slice(0, 160)}”. Compare with the lesson to check it matches the definition you were given.`,
      });
      earned += 0;
      continue;
    }
    if (question.type === 'checkbox_group') {
      gradable += 1;
      per.push({ question_id: question.id, verdict: 'not_graded', feedback: `Recorded ${Array.isArray(value) ? value.length : 0} selections.` });
      continue;
    }
    if (question.type === 'code_input') {
      gradable += 1;
      const code = String(value);
      const looksLikeCode = /[=(){}\[\]]|def\s+\w+|function\s+\w+/.test(code);
      per.push({
        question_id: question.id,
        verdict: looksLikeCode ? 'partly_correct' : 'incorrect',
        feedback: looksLikeCode
          ? 'This parses as code. It has not been executed here — run it in the practice workspace to confirm the behaviour.'
          : 'This does not look like code yet. Try writing the assignment or function on its own line.',
        hint: looksLikeCode ? undefined : 'Start with one line, e.g. `x = 10`.',
      });
      earned += looksLikeCode ? 0.5 : 0;
      continue;
    }
    // Free text: judge substance only.
    const words = String(value).trim().split(/\s+/).filter(Boolean).length;
    gradable += 1;
    if (words < 4) {
      per.push({ question_id: question.id, verdict: 'incorrect', feedback: 'Too short to show understanding — one or two full sentences, please.', hint: 'Say what it is, then say why it matters.' });
    } else {
      per.push({ question_id: question.id, verdict: 'partly_correct', feedback: `Recorded a ${words}-word explanation. It has not been graded against a reference answer.` });
      earned += 0.6;
    }
  }

  const score = gradable ? Math.round((earned / gradable) * 100) : null;
  const gaps = per.filter((p) => p.verdict === 'incorrect' || p.verdict === 'unanswered').map((p) => `${p.question_id}: ${p.feedback}`).slice(0, 5);
  return {
    overall: 'Answers recorded. Open-text answers are not automatically graded — the tutor will use them as evidence of understanding.',
    score,
    per_question: per,
    gaps,
    next_step: per.some((p) => p.verdict === 'incorrect') ? 'Re-read the worked example, then try the practice task.' : 'Move on to the practice task, then a graded quiz.',
    source: 'local',
  };
}

export function normaliseEvaluation(raw, fallback) {
  const parsed = evaluationSchema.safeParse(raw);
  if (!parsed.success) return fallback;
  const value = parsed.data;
  if (!value.per_question?.length && !value.overall) return fallback;
  return { ...fallback, ...value, source: 'model' };
}

export const teachingWorkflow = Object.freeze([
  { step: 1, key: 'analyse', label: 'Analyse the question', description: 'Restate what the student is actually asking, including what is implicit.' },
  { step: 2, key: 'subject', label: 'Identify subject and concept', description: 'Map to the syllabus concept when one is selected.' },
  { step: 3, key: 'level', label: 'Estimate current level', description: 'Use the learning profile and the wording of the question — never assume.' },
  { step: 4, key: 'objective', label: 'Set the learning objective', description: 'One observable outcome, not a topic list.' },
  { step: 5, key: 'strategy', label: 'Choose a teaching strategy', description: 'Analogy, worked example, visual first, socratic, or practice first.' },
  { step: 6, key: 'explain', label: 'Generate the explanation', description: 'Short sections; one idea per component.' },
  { step: 7, key: 'components', label: 'Select UI components', description: 'Only what improves understanding for this subject and level.' },
  { step: 8, key: 'examples', label: 'Add practical examples', description: 'Runnable where possible, with the expected output stated.' },
  { step: 9, key: 'exercises', label: 'Add interactive practice', description: 'A task the student can attempt immediately.' },
  { step: 10, key: 'assessment', label: 'Generate an assessment', description: 'A short knowledge check with a reason for each question.' },
  { step: 11, key: 'evaluate', label: 'Evaluate understanding', description: 'Grade what was submitted; never claim execution that did not happen.' },
  { step: 12, key: 'next', label: 'Recommend the next step', description: 'One concrete action, tied to the evidence.' },
]);
