import { z } from 'zod';

/**
 * CLIENT-SIDE UI PROTOCOL
 * =======================
 *
 * A mirror of `server/src/modules/ai/ui/protocol.js`. It exists because the
 * renderer must not trust its own network: a lesson arrives from the server (and
 * the server got it from a language model), so every document is validated again
 * before a component reaches `dangerouslySetInnerHTML`'s neighbourhood — which
 * is to say, before it reaches a renderer at all. The renderers never use
 * `dangerouslySetInnerHTML`, and this schema is what guarantees the data they
 * receive is the shape they expect.
 *
 * The rules match the server exactly: closed vocabulary, no unknown keys, hard
 * ceilings on arrays and strings, allowlisted actions, https-only media.
 */

export const UI_PROTOCOL_VERSION = '1.0';

export const UI_LIMITS = Object.freeze({
  maxComponents: 40,
  maxTotalComponents: 80,
  maxDepth: 5,
  maxDocumentBytes: 200_000,
  maxTitle: 200,
  maxText: 12_000,
  maxShortText: 400,
  maxItems: 20,
  maxQuestions: 12,
  maxQuizQuestions: 8,
  maxOptions: 12,
  maxTableRows: 60,
  maxTableColumns: 8,
  maxChartPoints: 60,
  maxChartSeries: 6,
  maxDiagramNodes: 40,
  maxDiagramEdges: 60,
  maxTimelineEvents: 20,
  maxExecutionSteps: 40,
  maxTabsOrPanels: 8,
  maxCodeChars: 20_000,
  maxInlineImageBytes: 400_000,
});

export const UI_ACTIONS = Object.freeze([
  'submit_ai_questions',
  'submit_quiz',
  'run_code',
  'reset_code',
  'save_progress',
  'continue_lesson',
  'next_step',
  'start_assessment',
  'open_practice',
  'navigate',
  'show_hint',
  'bookmark',
]);

export const NAV_TARGETS = Object.freeze(['/app/practice', '/app/assessments', '/app/progress', '/app/classrooms', '/app']);

export const QUESTION_TYPES = Object.freeze([
  'text_input', 'textarea', 'radio', 'checkbox_group', 'select', 'number',
  'slider', 'date', 'code_input', 'boolean', 'file_upload',
]);

const TONES = ['neutral', 'brand', 'success', 'warning', 'danger', 'violet', 'info'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

const id = z.string().regex(ID_RE);
const optId = id.optional();
const text = (max = UI_LIMITS.maxShortText) => z.string().max(max).transform(cleanText);
const title = text(UI_LIMITS.maxTitle);
const short = text(UI_LIMITS.maxShortText);
const paragraph = text(UI_LIMITS.maxText);

const optTitle = title.optional();
const optShort = short.optional();
const optParagraph = paragraph.optional();
const optBool = z.boolean().optional();
const tone = z.enum(TONES);
const percent = z.number().finite().min(0).max(100);

export function isSafeMediaUrl(value) {
  const url = String(value || '').trim();
  if (!url) return false;
  if (url.length > 2000) return false;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url)) {
    return Math.ceil((url.length - url.indexOf(',') - 1) * 0.75) <= UI_LIMITS.maxInlineImageBytes;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

const mediaUrl = z.string().max(2000).refine(isSafeMediaUrl, 'unsafe media source');

const styleSchema = z
  .strictObject({
    tone: tone.optional(),
    emphasis: z.enum(['low', 'normal', 'high']).optional(),
    width: z.enum(['full', 'half', 'third']).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    icon: z.string().max(20).optional(),
  })
  .optional();

const fieldValidation = z
  .strictObject({
    min_length: z.number().int().min(0).optional(),
    max_length: z.number().int().min(1).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    pattern: z.enum(['email', 'url', 'alphanumeric']).optional(),
  })
  .optional();

const options = z.array(short).min(2).max(UI_LIMITS.maxOptions).optional();

const children = () => z.array(z.lazy(() => componentSchema)).max(UI_LIMITS.maxComponents);

const base = { id, style: styleSchema, title: optTitle };

const textComponent = z.strictObject({ ...base, type: z.literal('text'), format: z.enum(['markdown', 'plain']).optional(), content: paragraph });

const layoutComponent = z.strictObject({
  ...base,
  type: z.literal('layout'),
  layout: z.enum(['stack', 'grid', 'columns', 'split']),
  columns: z.number().int().min(1).max(4).optional(),
  gap: z.enum(['sm', 'md', 'lg']).optional(),
  children: children(),
});

const cardComponent = z.strictObject({ ...base, type: z.literal('card'), subtitle: optShort, icon: z.string().max(20).optional(), body: optParagraph, children: z.array(z.lazy(() => componentSchema)).max(20).optional(), footer: optShort });

const mediaComponent = z.strictObject({ ...base, type: z.literal('media'), media_kind: z.enum(['image', 'video', 'audio']), src: mediaUrl, alt: optShort, caption: optShort, poster: mediaUrl.optional() });

const chartComponent = z.strictObject({
  ...base,
  type: z.literal('chart'),
  chart_type: z.enum(['bar', 'line', 'area', 'pie']),
  description: optShort,
  labels: z.array(short).min(1).max(UI_LIMITS.maxChartPoints),
  series: z.array(z.strictObject({ name: short, data: z.array(z.number().finite()).min(1).max(UI_LIMITS.maxChartPoints), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })).min(1).max(UI_LIMITS.maxChartSeries),
  x_label: optShort,
  y_label: optShort,
});

const tableComponent = z.strictObject({
  ...base,
  type: z.literal('table'),
  description: optShort,
  columns: z.array(z.strictObject({ key: z.string().regex(ID_RE), label: short, align: z.enum(['left', 'center', 'right']).optional() })).min(1).max(UI_LIMITS.maxTableColumns),
  rows: z.array(z.record(z.string().max(64), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]))).max(UI_LIMITS.maxTableRows),
  caption: optShort,
});

const fieldOption = z.strictObject({ value: short, label: short });

const formField = z.strictObject({
  id,
  type: z.enum(QUESTION_TYPES),
  label: short,
  placeholder: optShort,
  required: optBool,
  options: z.array(fieldOption).min(1).max(UI_LIMITS.maxOptions).optional(),
  default_value: z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.array(z.string().max(200))]).optional(),
  validation: fieldValidation,
  help: optShort,
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  language: z.enum(['javascript', 'python', 'java', 'sql']).optional(),
  accept: z.array(z.string().max(20)).max(6).optional(),
});

const formComponent = z.strictObject({
  ...base,
  type: z.literal('form'),
  description: optShort,
  fields: z.array(formField).min(1).max(UI_LIMITS.maxQuestions),
  submit: z.strictObject({ button_text: short, action: z.enum(['save_progress', 'submit_ai_questions', 'navigate']) }).optional(),
});

const inputComponent = z.strictObject({
  ...base,
  type: z.literal('input'),
  input_type: z.enum(QUESTION_TYPES),
  name: z.string().regex(ID_RE),
  label: short,
  placeholder: optShort,
  help: optShort,
  required: optBool,
  options,
  default_value: z.union([z.string().max(2000), z.number().finite(), z.boolean()]).optional(),
});

const navigationComponent = z.strictObject({
  ...base,
  type: z.literal('navigation'),
  orientation: z.enum(['horizontal', 'vertical']).optional(),
  items: z.array(z.strictObject({ id, label: short, action: z.enum(['navigate', 'continue_lesson', 'next_step', 'start_assessment', 'open_practice']), target: z.enum(NAV_TARGETS).optional() })).min(1).max(UI_LIMITS.maxItems),
});

const quizQuestion = z.strictObject({ id, question: short, options: z.array(short).min(2).max(UI_LIMITS.maxOptions), correct_index: z.number().int().min(0).max(UI_LIMITS.maxOptions - 1), explanation: optShort, hint: optShort });

const quizComponent = z.strictObject({ ...base, type: z.literal('quiz'), description: optShort, questions: z.array(quizQuestion).min(1).max(UI_LIMITS.maxQuizQuestions), passing_score: z.number().int().min(0).max(100).optional(), show_explanations: optBool });

const learningComponent = z.strictObject({
  ...base,
  type: z.literal('learning'),
  objectives: z.array(short).max(UI_LIMITS.maxItems).optional(),
  analogy: optParagraph,
  sections: z.array(z.strictObject({ heading: short, body: paragraph })).max(UI_LIMITS.maxItems).optional(),
  key_points: z.array(short).max(UI_LIMITS.maxItems).optional(),
  summary: optParagraph,
});

const codeTest = z.strictObject({ id, name: short, args: z.array(z.union([z.string().max(2000), z.number().finite(), z.boolean()])).max(4).optional(), expected: z.union([z.string().max(2000), z.number().finite()]).optional(), hidden: optBool });

const codeEditorComponent = z.strictObject({
  ...base,
  type: z.literal('code_editor'),
  language: z.enum(['javascript', 'python', 'java', 'sql']),
  instructions: optParagraph,
  starter_code: z.string().max(UI_LIMITS.maxCodeChars),
  expected_output: z.string().max(4000).optional(),
  solution_hint: optShort,
  tests: z.array(codeTest).max(8).optional(),
  run_enabled: optBool,
  reset_enabled: optBool,
});

const mathComponent = z.strictObject({
  ...base,
  type: z.literal('math'),
  latex: z.string().min(1).max(4000),
  display: z.enum(['block', 'inline']).optional(),
  explanation: optParagraph,
  steps: z.array(z.strictObject({ label: short, latex: z.string().max(2000) })).max(UI_LIMITS.maxItems).optional(),
});

const diagramNode = z.strictObject({ id, label: short, detail: optShort, shape: z.enum(['process', 'decision', 'terminal', 'io', 'database', 'note']).optional() });

const diagramComponent = z.strictObject({
  ...base,
  type: z.literal('diagram'),
  diagram_type: z.enum(['flowchart', 'graph', 'tree', 'stack', 'network']),
  caption: optShort,
  nodes: z.array(diagramNode).min(1).max(UI_LIMITS.maxDiagramNodes),
  edges: z.array(z.strictObject({ from: z.string().regex(ID_RE), to: z.string().regex(ID_RE), label: optShort, style: z.enum(['solid', 'dashed']).optional() })).max(UI_LIMITS.maxDiagramEdges),
  order: z.array(z.string().regex(ID_RE)).max(UI_LIMITS.maxDiagramNodes).optional(),
});

const actionsComponent = z.strictObject({ ...base, type: z.literal('actions'), actions: z.array(z.strictObject({ id, label: short, action: z.enum(UI_ACTIONS), tone: tone.optional(), target: z.enum(NAV_TARGETS).optional(), confirm: optShort })).min(1).max(6) });

const progressComponent = z.strictObject({
  ...base,
  type: z.literal('progress'),
  description: optShort,
  items: z.array(z.strictObject({ id: optId, label: short, value: percent, detail: optShort, tone: tone.optional() })).min(1).max(UI_LIMITS.maxItems),
  show_percent: optBool,
});

const timelineComponent = z.strictObject({ ...base, type: z.literal('timeline'), description: optShort, events: z.array(z.strictObject({ label: short, detail: optShort, date: optShort, icon: z.string().max(20).optional() })).min(1).max(UI_LIMITS.maxTimelineEvents) });

const tabsComponent = z.strictObject({ ...base, type: z.literal('tabs'), tabs: z.array(z.strictObject({ id, label: short, children: children() })).min(1).max(UI_LIMITS.maxTabsOrPanels), default_tab: optId });

const accordionComponent = z.strictObject({ ...base, type: z.literal('accordion'), items: z.array(z.strictObject({ id, title: short, children: children() })).min(1).max(UI_LIMITS.maxTabsOrPanels), open_first: optBool });

const simulationParameter = z.strictObject({ id, label: short, min: z.number().finite(), max: z.number().finite(), step: z.number().finite().positive(), default: z.number().finite(), unit: optShort });

const simulationComponent = z.strictObject({
  ...base,
  type: z.literal('simulation'),
  simulation_kind: z.enum(['parameters', 'prediction', 'sequence']),
  description: optParagraph,
  parameters: z.array(simulationParameter).min(1).max(6).optional(),
  formula_latex: z.string().max(2000).optional(),
  outcomes: z.array(z.strictObject({ label: short, detail: optShort, when: z.record(z.string().max(64), z.number().finite()).optional() })).max(8).optional(),
  steps: z.array(z.strictObject({ label: short, detail: optShort })).max(UI_LIMITS.maxItems).optional(),
});

const teachingWorkflowComponent = z.strictObject({
  ...base,
  type: z.literal('teaching_workflow'),
  description: optShort,
  steps: z.array(z.strictObject({ id: optId, title: short, description: optShort, status: z.enum(['pending', 'active', 'done']).optional() })).min(1).max(UI_LIMITS.maxItems),
});

const executionTableComponent = z.strictObject({
  ...base,
  type: z.literal('execution_table'),
  description: optShort,
  code_lines: z.array(z.string().max(400)).max(120).optional(),
  steps: z.array(z.strictObject({ id: optId, step: z.number().int().min(1).max(999), line: z.number().int().min(1).max(999).optional(), statement: z.string().max(600), variables: z.record(z.string().max(64), z.string().max(300)).optional(), output: z.string().max(600).optional() })).min(1).max(UI_LIMITS.maxExecutionSteps),
});

const variableVisualizationComponent = z.strictObject({
  ...base,
  type: z.literal('variable_visualization'),
  description: optShort,
  variables: z.array(z.strictObject({ name: z.string().max(64), value: z.string().max(300), type: optShort, changed: optBool })).max(UI_LIMITS.maxItems).optional(),
  steps: z.array(z.strictObject({ label: short, line: z.number().int().min(1).max(999).optional(), variables: z.array(z.strictObject({ name: z.string().max(64), value: z.string().max(300), type: optShort, changed: optBool })).max(UI_LIMITS.maxItems), output: z.string().max(600).optional() })).max(UI_LIMITS.maxExecutionSteps).optional(),
  final_output: z.string().max(600).optional(),
});

const executionTraceComponent = z.strictObject({
  ...base,
  type: z.literal('execution_trace'),
  language: z.enum(['javascript', 'python', 'java', 'sql']),
  description: optShort,
  code: z.string().max(UI_LIMITS.maxCodeChars),
  steps: z.array(z.strictObject({ line: z.number().int().min(1).max(999), variables: z.record(z.string().max(64), z.string().max(300)).optional(), call_stack: z.array(z.string().max(200)).max(30).optional(), output: z.string().max(600).optional(), note: optShort })).min(1).max(UI_LIMITS.maxExecutionSteps),
  playback: optBool,
});

const dynamicQuestion = z.strictObject({
  id,
  type: z.enum(QUESTION_TYPES),
  question: short,
  description: optShort,
  placeholder: optShort,
  required: optBool,
  options: z.array(z.union([short, fieldOption])).min(1).max(UI_LIMITS.maxOptions).optional(),
  default_value: z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.array(z.string().max(200))]).optional(),
  validation: fieldValidation,
  hint: optShort,
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  language: z.enum(['javascript', 'python', 'java', 'sql']).optional(),
  accept: z.array(z.string().max(20)).max(6).optional(),
  // A coding answer is executed, so the author declares the expected result.
  // The client never evaluates it — verification belongs to the server.
  expected_output: z.string().max(4000).optional(),
  tests: z
    .array(
      z.strictObject({
        id,
        name: short,
        args: z.array(z.union([z.string().max(2000), z.number().finite(), z.boolean()])).max(4).optional(),
        expected: z.union([z.string().max(2000), z.number().finite()]).optional(),
        hidden: optBool,
      }),
    )
    .max(8)
    .optional(),
});

const questionFormComponent = z.strictObject({
  ...base,
  type: z.literal('question_form'),
  description: optShort,
  questions: z.array(dynamicQuestion).min(1).max(UI_LIMITS.maxQuestions),
  submission: z.strictObject({ button_text: short, action: z.literal('submit_ai_questions'), evaluation: z.enum(['ai_evaluation', 'local_evaluation']).optional() }).optional(),
});

export const COMPONENT_SCHEMAS = Object.freeze({
  text: textComponent,
  layout: layoutComponent,
  card: cardComponent,
  media: mediaComponent,
  chart: chartComponent,
  table: tableComponent,
  form: formComponent,
  input: inputComponent,
  navigation: navigationComponent,
  quiz: quizComponent,
  learning: learningComponent,
  code_editor: codeEditorComponent,
  math: mathComponent,
  diagram: diagramComponent,
  actions: actionsComponent,
  progress: progressComponent,
  timeline: timelineComponent,
  tabs: tabsComponent,
  accordion: accordionComponent,
  simulation: simulationComponent,
  teaching_workflow: teachingWorkflowComponent,
  execution_table: executionTableComponent,
  variable_visualization: variableVisualizationComponent,
  execution_trace: executionTraceComponent,
  question_form: questionFormComponent,
});

export const COMPONENT_TYPES = Object.freeze(Object.keys(COMPONENT_SCHEMAS));

export const componentSchema = z.lazy(() => z.discriminatedUnion('type', Object.values(COMPONENT_SCHEMAS)));

export const uiDocumentSchema = z.strictObject({
  version: z.literal(UI_PROTOCOL_VERSION),
  response_id: z.string().max(80).regex(ID_RE),
  response_type: z.enum(['educational_tutorial', 'concept_check', 'question_form', 'code_practice', 'assessment', 'progress_summary', 'clarification']),
  metadata: z
    .strictObject({
      topic: optShort,
      subject: optShort,
      difficulty: z.enum(['beginner', 'developing', 'proficient', 'advanced']).optional(),
      language: z.string().max(12).optional(),
      estimated_minutes: z.number().int().min(1).max(240).optional(),
      strategy: z.string().max(40).optional(),
      concept_id: optShort,
      classroom_id: optShort,
      session_id: optShort,
    })
    .optional(),
  learning_objectives: z.array(short).max(12).optional(),
  components: z.array(componentSchema).min(1).max(UI_LIMITS.maxComponents),
});

export const QUESTION_LABELS = Object.freeze({
  text_input: 'Short answer',
  textarea: 'Written answer',
  radio: 'Single choice',
  checkbox_group: 'Multiple choice',
  select: 'Select from list',
  number: 'Number',
  slider: 'Scale',
  date: 'Date',
  code_input: 'Code',
  boolean: 'Yes / no',
  file_upload: 'File',
});
