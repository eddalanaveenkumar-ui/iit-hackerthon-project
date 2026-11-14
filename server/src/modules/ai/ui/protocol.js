import { z } from 'zod';

/**
 * THE DYNAMIC UI PROTOCOL
 * =======================
 *
 * Every AI-generated interface in LearnMate is described by one JSON document
 * that this module validates. The model writes the document; the client renders
 * it with fixed React components. The model therefore never controls *code*,
 * only a bounded vocabulary of component types — which is what makes "the AI
 * draws the lesson" safe to ship.
 *
 * Design rules encoded here:
 *
 *  1. Closed vocabulary. A component type is either declared below or rejected.
 *     `strictObject` everywhere means an unexpected property is an error, not
 *     something silently forwarded to a renderer.
 *  2. Bounded. Component count, nesting depth, string lengths, list lengths,
 *     table rows, chart points and serialised size all have hard ceilings. A
 *     model that rambles into a 2 MB document is truncated/rejected, not sent
 *     to a phone.
 *  3. No executable content. Actions are an allowlisted enum; media must be an
 *     https URL or a small inline image; math is a LaTeX string (KaTeX renders
 *     it with `trust: false`). No HTML, no JavaScript, no `javascript:` URLs.
 *  4. Repairable. `parseUiDocument` validates strictly. When a model returns one
 *     bad component among good ones, `repairUiDocument` drops the bad components
 *     and keeps the lesson — a degraded tutorial beats an error dialog.
 *  5. Deterministic fallback. `fallbackTextDocument` always produces a valid
 *     document from plain prose, so the renderer is never handed nothing.
 */

export const UI_PROTOCOL_VERSION = '1.0';

/** Hard ceilings. Exported so tests and the prompt can quote the same numbers. */
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
  // Visual groups: 4 across, 12 cells. Keeps a "grid" an arrangement rather
  // than a bulk-layout escape hatch.
  maxGridColumns: 4,
  maxGridCells: 12,
});

/** Actions the UI is allowed to hand back to the application. */
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

/** Icons the renderer knows how to draw (lucide names resolved client-side). */
/**
 * Icon names the protocol allows. The first block is the original short
 * vocabulary; the second adds the kebab-case lucide names the authoring
 * sketches use (`book-open`, `play-circle`, …). Both resolve through one
 * registry on the client, and an unknown name renders nothing rather than
 * throwing.
 */
export const UI_ICONS = Object.freeze([
  'book', 'bulb', 'target', 'code', 'chart', 'sparkles', 'check', 'flag',
  'clock', 'layers', 'sigma', 'flask', 'brain', 'terminal', 'list', 'alert',
  'book-open', 'book-open-check', 'play-circle', 'arrow-right', 'lightbulb',
  'chevron-right', 'graduation-cap', 'puzzle', 'rocket', 'cpu', 'function-square',
  'database', 'git-branch', 'repeat', 'shapes', 'pen-tool', 'trophy', 'bug',
  'wrench', 'star', 'info', 'zap', 'eye', 'search',
]);

export const QUESTION_TYPES = Object.freeze([
  'text_input', 'textarea', 'radio', 'checkbox_group', 'select', 'number',
  'slider', 'date', 'code_input', 'boolean', 'file_upload',
]);

const TONES = ['neutral', 'brand', 'success', 'warning', 'danger', 'violet', 'info'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/* -------------------------------------------------------------------------- */
/* primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** Strip control characters (keeping newlines/tabs) and trim. */
export function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

const id = z.string().regex(ID_RE, 'ids must be 1-64 characters of [A-Za-z0-9_-]');
const optId = z.string().regex(ID_RE, 'ids must be 1-64 characters of [A-Za-z0-9_-]').optional();

const text = (max = UI_LIMITS.maxShortText) =>
  z.string().max(max).transform(cleanText);

const title = text(UI_LIMITS.maxTitle);
const short = text(UI_LIMITS.maxShortText);
const paragraph = text(UI_LIMITS.maxText);

const optTitle = title.optional();
const optShort = short.optional();
const optParagraph = paragraph.optional();

const bool = z.boolean();
const optBool = z.boolean().optional();

const tone = z.enum(TONES);

const percent = z.number().finite().min(0).max(100);

/**
 * A URL the renderer is allowed to load.
 *
 * https only. A `data:image/...` URI is accepted but only for the four raster
 * formats a camera/screenshot produces and only under the inline size cap —
 * SVG is refused because it can carry script, and `javascript:`/`file:` are
 * refused outright.
 */
export function isSafeMediaUrl(value) {
  const url = String(value || '').trim();
  if (!url) return false;
  if (url.length > 2000) return false;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url)) {
    // base64 inflates by 4/3: cap the decoded size
    return Math.ceil((url.length - url.indexOf(',') - 1) * 0.75) <= UI_LIMITS.maxInlineImageBytes;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    // Refuse hosts that are clearly not image sources.
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(parsed.hostname)) return false;
    const allow = (process.env.MEDIA_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allow.length && !allow.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) return false;
    return true;
  } catch {
    return false;
  }
}

const mediaUrl = z
  .string()
  .max(2000)
  .refine(isSafeMediaUrl, 'media source must be an https URL or a small inline raster image');

const styleSchema = z
  .strictObject({
    tone: tone.optional(),
    emphasis: z.enum(['low', 'normal', 'high']).optional(),
    width: z.enum(['full', 'half', 'third']).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    icon: z.enum(UI_ICONS).optional(),
  })
  .optional();

/** question_form / form field validation rules — JS numbers only, no regex source from the model. */
const fieldValidation = z
  .strictObject({
    min_length: z.number().int().min(0).max(UI_LIMITS.maxText).optional(),
    max_length: z.number().int().min(1).max(UI_LIMITS.maxText).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    pattern: z.enum(['email', 'url', 'alphanumeric']).optional(),
  })
  .optional();

const options = z
  .array(short)
  .min(2, 'provide at least two options')
  .max(UI_LIMITS.maxOptions)
  .optional();

/* -------------------------------------------------------------------------- */
/* recursive plumbing                                                          */
/* -------------------------------------------------------------------------- */

const children = () => z.array(z.lazy(() => componentSchema)).max(UI_LIMITS.maxComponents);

/** A value shown inside a variable table: any scalar, printed as text. */
const variableValue = z.union([z.string().max(300), z.number().finite(), z.boolean(), z.null()]);

const base = {
  id,
  style: styleSchema,
  title: optTitle,
};

/* -------------------------------------------------------------------------- */
/* component schemas                                                           */
/* -------------------------------------------------------------------------- */

const textComponent = z.strictObject({
  ...base,
  type: z.literal('text'),
  format: z.enum(['markdown', 'plain']).optional(),
  content: paragraph,
});

/**
 * A layout may also contain *visual groups* rather than only components:
 * a `row` of boxes and a `grid` of cells. These are the low-level presentation
 * primitives a lesson reaches for when it wants columns side by side or a
 * 3-across tile block — the shape authored UI sketches use. They are data, not
 * markup and not code, so they are described here rather than treated as a
 * raw escape hatch.
 */
const layoutItemSchema = z.lazy(() => z.union([
  componentSchema,
  z.strictObject({
    type: z.literal('row'),
    id: optId,
    gap: z.enum(['sm', 'md', 'lg']).optional(),
    children: z.array(layoutItemSchema).min(1).max(6),
  }),
  z.strictObject({
    type: z.literal('grid'),
    id: optId,
    columns: z.number().int().min(1).max(4).optional(),
    gap: z.enum(['sm', 'md', 'lg']).optional(),
    children: z.array(layoutItemSchema).min(1).max(12),
  }),
  z.strictObject({ type: z.literal('box'), id: optId, content: short, tone: tone.optional() }),
]));

/**
 * Give every layout cell a stable id, recursively, before the schema sees it.
 *
 * A bare cell — `{ "type": "text", "content": "A" }` inside a `grid` — is
 * exactly what an author writes by hand, and rejecting it for missing an id
 * would make the documented layout shape unusable. Both the strict parser and
 * the repairing parser run this first, so the two paths agree.
 */
let layoutCellCounter = 0;
function normaliseLayoutItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== 'object') return item;
    if (item.type === 'box') return item;
    if (item.type === 'row' || item.type === 'grid') {
      return { ...item, children: normaliseLayoutItems(item.children) };
    }
    if (!item.id) return { ...item, id: `cell-${(layoutCellCounter += 1).toString(36)}` };
    return item;
  });
}

/**
 * Map the authoring sketches' field spellings onto the canonical ones.
 *
 * The sketches write `questions[].title` and `submit.label`; the protocol grew
 * `questions[].question` and `submission.button_text`. Both are legitimate
 * spellings of the same thing, so they are normalised once here rather than
 * being duplicated through every consumer. Canonical always wins if both are
 * present.
 */
function normaliseAliases(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(normaliseAliases);
  const next = { ...node };

  if (Array.isArray(next.questions)) {
    next.questions = next.questions.map((q) => {
      if (!q || typeof q !== 'object') return q;
      const copy = { ...q };
      if (!copy.question && copy.title) copy.question = copy.title;
      return copy;
    });
  }

  // question_form: `submit` → `submission`
  if (next.type === 'question_form' && next.submit && !next.submission) {
    next.submission = {
      ...next.submit,
      button_text: next.submit.button_text || next.submit.label,
      action: next.submit.action || 'submit_ai_questions',
    };
    delete next.submit;
  }
  // form: `submit.action` defaults to the only safe handler
  if (next.type === 'form' && next.submit && !next.submit.action) {
    next.submit = { ...next.submit, action: 'submit_ai_questions' };
  }

  if (Array.isArray(next.children)) next.children = next.children.map(normaliseAliases);
  if (Array.isArray(next.components)) next.components = next.components.map(normaliseAliases);
  if (Array.isArray(next.tabs)) next.tabs = next.tabs.map((t) => (t && Array.isArray(t.children) ? { ...t, children: t.children.map(normaliseAliases) } : t));
  if (Array.isArray(next.items) && next.type === 'accordion') {
    next.items = next.items.map((i) => (i && Array.isArray(i.children) ? { ...i, children: i.children.map(normaliseAliases) } : i));
  }
  return next;
}

/** Apply the cell-id pass to every layout anywhere in a document. */
function normaliseDocumentLayouts(raw) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(visit);
    const next = { ...node };
    // A layout's own cells are normalised wholesale (the pass recurses through
    // rows and grids itself); every other container is descended into.
    if (next.type === 'layout' && Array.isArray(next.children)) {
      next.children = normaliseLayoutItems(next.children);
    } else if (Array.isArray(next.children)) {
      next.children = next.children.map(visit);
    }
    if (Array.isArray(next.components)) next.components = next.components.map(visit);
    if (Array.isArray(next.tabs)) next.tabs = next.tabs.map((t) => (Array.isArray(t?.children) ? { ...t, children: t.children.map(visit) } : t));
    if (Array.isArray(next.items) && next.type === 'accordion') {
      next.items = next.items.map((i) => (Array.isArray(i?.children) ? { ...i, children: i.children.map(visit) } : i));
    }
    return next;
  };
  return normaliseAliases(visit(raw));
}

const layoutComponent = z.strictObject({
  ...base,
  type: z.literal('layout'),
  // `layout` defaults: an author who writes `direction: "vertical"` (or nothing
  // at all) should not be rejected for omitting a synonym.
  layout: z.enum(['stack', 'grid', 'columns', 'split', 'vertical']).default('stack'),
  direction: z.enum(['vertical', 'horizontal']).optional(),
  columns: z.number().int().min(1).max(4).optional(),
  gap: z.enum(['sm', 'md', 'lg']).optional(),
  children: z.array(layoutItemSchema).min(1).max(UI_LIMITS.maxComponents),
});

const cardComponent = z.strictObject({
  ...base,
  type: z.literal('card'),
  subtitle: optShort,
  icon: z.enum(UI_ICONS).optional(),
  body: optParagraph,
  children: z.array(z.lazy(() => componentSchema)).max(20).optional(),
  footer: optShort,
});

/**
 * `card_group` — a grid of comparable cards (a syllabus's modules, a set of
 * resources). Distinct from `card` because the *collection* is the component:
 * layout, column count and each card's icon/badge belong to the group. Items
 * never carry children, so a group cannot nest arbitrarily.
 */
const cardGroupItem = z.strictObject({
  id,
  title: short,
  icon: z.enum(UI_ICONS).optional(),
  badge: optShort,
  description: optShort,
});

const cardGroupComponent = z.strictObject({
  ...base,
  type: z.literal('card_group'),
  layout: z.enum(['grid', 'list']).optional(),
  columns: z.number().int().min(1).max(UI_LIMITS.maxGridColumns).optional(),
  items: z.array(cardGroupItem).min(1).max(UI_LIMITS.maxItems),
});

/**
 * One media item. `media_type` decides which of the other fields apply — an
 * `icon` names a glyph, an `image` / `video` names an https source. Every URL
 * still goes through `mediaUrl`, so the group shape is not a way to smuggle in
 * a `javascript:` source.
 */
const mediaItem = z.strictObject({
  id,
  media_type: z.enum(['image', 'video', 'icon']),
  src: mediaUrl.optional(),
  alt: optShort,
  caption: optShort,
  poster: mediaUrl.optional(),
  controls: optBool,
  aspect_ratio: z.enum(['16:9', '4:3', '1:1', '3:2', '9:16']).optional(),
  name: z.enum(UI_ICONS).optional(),
  title: optShort,
});

/**
 * `media` — either the single-media shape (`media_kind` + `src`) that existing
 * lessons use, *or* a group of items under `items`, each declaring its own
 * `media_type`. Exactly one must be present: the single shape keeps existing
 * lessons rendering, and the refine keeps "media with nothing to show" invalid.
 */
const mediaComponent = z
  .strictObject({
    ...base,
    type: z.literal('media'),
    media_kind: z.enum(['image', 'video', 'audio']).optional(),
    src: mediaUrl.optional(),
    alt: optShort,
    caption: optShort,
    poster: mediaUrl.optional(),
    items: z.array(mediaItem).min(1).max(6).optional(),
  })
  .refine((m) => Boolean(m.items) !== Boolean(m.media_kind && m.src), {
    message: 'media needs either items[] or media_kind + src, not both',
  });

const chartComponent = z.strictObject({
  ...base,
  type: z.literal('chart'),
  chart_type: z.enum(['bar', 'line', 'area', 'pie']),
  description: optShort,
  labels: z.array(short).min(1).max(UI_LIMITS.maxChartPoints),
  series: z
    .array(
      z.strictObject({
        name: short,
        data: z.array(z.number().finite()).min(1).max(UI_LIMITS.maxChartPoints),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      }),
    )
    .min(1)
    .max(UI_LIMITS.maxChartSeries),
  x_label: optShort,
  y_label: optShort,
});

const tableComponent = z.strictObject({
  ...base,
  type: z.literal('table'),
  description: optShort,
  columns: z
    .array(
      z.strictObject({
        key: z.string().regex(ID_RE),
        label: short,
        align: z.enum(['left', 'center', 'right']).optional(),
      }),
    )
    .min(1)
    .max(UI_LIMITS.maxTableColumns),
  rows: z
    .array(z.record(z.string().max(64), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()])))
    .max(UI_LIMITS.maxTableRows),
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

/**
 * `data` — a chart and/or a table describing the same dataset. The chart uses
 * the explicit `x_key` / `y_key` shape from the authoring sketch; the older
 * `chart` component keeps its `labels` / `series` shape so existing lessons are
 * untouched.
 */
const dataChartItem = z.strictObject({
  id,
  type: z.literal('chart'),
  chart_type: z.enum(['bar', 'line', 'area', 'pie']),
  title: optShort,
  description: optShort,
  x_key: z.string().regex(ID_RE),
  y_key: z.string().regex(ID_RE),
  data: z
    .array(z.record(z.string().max(64), z.union([z.string().max(200), z.number().finite()])))
    .min(1)
    .max(UI_LIMITS.maxChartPoints),
  x_label: optShort,
  y_label: optShort,
});

const dataTableItem = z.strictObject({
  id,
  type: z.literal('table'),
  title: optShort,
  description: optShort,
  columns: z.array(z.string().max(80)).min(1).max(UI_LIMITS.maxTableColumns),
  rows: z
    .array(z.array(z.union([z.string().max(500), z.number().finite(), z.boolean()])).max(UI_LIMITS.maxTableColumns))
    .min(1)
    .max(UI_LIMITS.maxTableRows),
});

const dataComponent = z.strictObject({
  ...base,
  type: z.literal('data'),
  components: z.array(z.union([dataChartItem, dataTableItem])).min(1).max(2),
});

const formComponent = z.strictObject({
  ...base,
  type: z.literal('form'),
  description: optShort,
  fields: z.array(formField).min(1).max(UI_LIMITS.maxQuestions),
  submit: z
    .strictObject({
      // `button_text` is the original name; `label` is what the authoring
      // sketches use. Both are accepted, exactly one is required.
      button_text: optShort,
      label: optShort,
      action: z.enum(['save_progress', 'submit_ai_questions', 'navigate']).optional(),
    })
    .refine((sub) => Boolean(sub.button_text || sub.label), { message: 'submit needs button_text or label' })
    .optional(),
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
  options: options,
  default_value: z.union([z.string().max(2000), z.number().finite(), z.boolean()]).optional(),
});

/**
 * `carousel` and `popover` — the two navigation *presentations* from the
 * authoring sketch. They advance or open locally and cannot navigate, so the
 * richer authoring shape does not widen what the model can drive.
 */
const carouselItem = z.strictObject({
  id,
  title: short,
  lesson: optShort,
  description: optShort,
  icon: z.enum(UI_ICONS).optional(),
});

const carouselComponent = z.strictObject({
  ...base,
  type: z.literal('carousel'),
  items: z.array(carouselItem).min(1).max(UI_LIMITS.maxItems),
});

const popoverComponent = z.strictObject({
  ...base,
  type: z.literal('popover'),
  trigger: short,
  items: z
    .array(z.strictObject({ id, label: short, description: optShort }))
    .min(1)
    .max(UI_LIMITS.maxItems),
});

/**
 * `navigation` — either the wayfinding `items` shape
 * (navigate / continue_lesson / …) or the presentation `components` shape
 * (carousel / popover). Exactly one.
 */
const navigationComponent = z
  .strictObject({
    ...base,
    type: z.literal('navigation'),
    orientation: z.enum(['horizontal', 'vertical']).optional(),
    items: z
      .array(
        z.strictObject({
          id,
          label: short,
          action: z.enum(['navigate', 'continue_lesson', 'next_step', 'start_assessment', 'open_practice']),
          target: z.enum(NAV_TARGETS).optional(),
        }),
      )
      .min(1)
      .max(UI_LIMITS.maxItems)
      .optional(),
    components: z.array(z.union([carouselComponent, popoverComponent])).min(1).max(2).optional(),
  })
  .refine((n) => Boolean(n.items) !== Boolean(n.components), {
    message: 'navigation needs either items[] or components[], not both',
  });

const quizQuestion = z.strictObject({
  id,
  question: short,
  options: z.array(short).min(2).max(UI_LIMITS.maxOptions),
  correct_index: z.number().int().min(0).max(UI_LIMITS.maxOptions - 1),
  explanation: optShort,
  hint: optShort,
});

const quizComponent = z.strictObject({
  ...base,
  type: z.literal('quiz'),
  description: optShort,
  questions: z.array(quizQuestion).min(1).max(UI_LIMITS.maxQuizQuestions),
  passing_score: z.number().int().min(0).max(100).optional(),
  show_explanations: optBool,
});

const learningComponent = z.strictObject({
  ...base,
  type: z.literal('learning'),
  objectives: z.array(short).max(UI_LIMITS.maxItems).optional(),
  analogy: optParagraph,
  sections: z
    .array(z.strictObject({ heading: short, body: paragraph }))
    .max(UI_LIMITS.maxItems)
    .optional(),
  key_points: z.array(short).max(UI_LIMITS.maxItems).optional(),
  summary: optParagraph,
});

const codeTest = z.strictObject({
  id,
  name: short,
  args: z.array(z.union([z.string().max(2000), z.number().finite(), z.boolean()])).max(4).optional(),
  expected: z.union([z.string().max(2000), z.number().finite()]).optional(),
  hidden: optBool,
});

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
  steps: z
    .array(z.strictObject({ label: short, latex: z.string().max(2000) }))
    .max(UI_LIMITS.maxItems)
    .optional(),
});

const diagramNode = z.strictObject({
  id,
  label: short,
  detail: optShort,
  shape: z.enum(['process', 'decision', 'terminal', 'io', 'database', 'note']).optional(),
});

const diagramComponent = z.strictObject({
  ...base,
  type: z.literal('diagram'),
  diagram_type: z.enum(['flowchart', 'graph', 'tree', 'stack', 'network']),
  caption: optShort,
  nodes: z.array(diagramNode).min(1).max(UI_LIMITS.maxDiagramNodes),
  edges: z
    .array(
      z.strictObject({
        from: z.string().regex(ID_RE),
        to: z.string().regex(ID_RE),
        label: optShort,
        style: z.enum(['solid', 'dashed']).optional(),
      }),
    )
    .max(UI_LIMITS.maxDiagramEdges),
  // Optional ordered node ids used by `stack` diagrams (bottom → top).
  order: z.array(z.string().regex(ID_RE)).max(UI_LIMITS.maxDiagramNodes).optional(),
});

const actionsComponent = z.strictObject({
  ...base,
  type: z.literal('actions'),
  actions: z
    .array(
      z.strictObject({
        id,
        label: short,
        action: z.enum(UI_ACTIONS),
        tone: tone.optional(),
        target: z.enum(NAV_TARGETS).optional(),
        confirm: optShort,
        // Which tracs command this button runs. It used to be inferred from
        // `action`, and every `continue_lesson` fell through to `/test` — so a
        // button labelled "/learn" asked a question. Carrying it explicitly (and
        // allowing it through the schema) removes the guess.
        command: z.enum(['test', 'learn']).optional(),
      }),
    )
    .min(1)
    .max(6),
});

const progressComponent = z.strictObject({
  ...base,
  type: z.literal('progress'),
  description: optShort,
  items: z
    .array(
      z.strictObject({
        id: optId,
        label: short,
        value: percent,
        detail: optShort,
        tone: tone.optional(),
      }),
    )
    .min(1)
    .max(UI_LIMITS.maxItems),
  show_percent: optBool,
});

const timelineComponent = z.strictObject({
  ...base,
  type: z.literal('timeline'),
  description: optShort,
  events: z
    .array(
      z.strictObject({
        label: short,
        detail: optShort,
        date: optShort,
        icon: z.enum(UI_ICONS).optional(),
      }),
    )
    .min(1)
    .max(UI_LIMITS.maxTimelineEvents),
});

const tabsComponent = z.strictObject({
  ...base,
  type: z.literal('tabs'),
  tabs: z
    .array(
      z.strictObject({
        id,
        label: short,
        children: children(),
      }),
    )
    .min(1)
    .max(UI_LIMITS.maxTabsOrPanels),
  default_tab: optId,
});

const accordionComponent = z.strictObject({
  ...base,
  type: z.literal('accordion'),
  items: z
    .array(
      z.strictObject({
        id,
        title: short,
        children: children(),
      }),
    )
    .min(1)
    .max(UI_LIMITS.maxTabsOrPanels),
  open_first: optBool,
});

const simulationParameter = z.strictObject({
  id,
  label: short,
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().finite().positive(),
  default: z.number().finite(),
  unit: optShort,
});

const simulationComponent = z.strictObject({
  ...base,
  type: z.literal('simulation'),
  simulation_kind: z.enum(['parameters', 'prediction', 'sequence']),
  description: optParagraph,
  parameters: z.array(simulationParameter).min(1).max(6).optional(),
  formula_latex: z.string().max(2000).optional(),
  outcomes: z
    .array(
      z.strictObject({
        label: short,
        detail: optShort,
        when: z.record(z.string().max(64), z.number().finite()).optional(),
      }),
    )
    .max(8)
    .optional(),
  steps: z.array(z.strictObject({ label: short, detail: optShort })).max(UI_LIMITS.maxItems).optional(),
});

/* ------------------------- extended educational types --------------------- */

const teachingWorkflowComponent = z.strictObject({
  ...base,
  type: z.literal('teaching_workflow'),
  description: optShort,
  steps: z
    .array(
      z.strictObject({
        id: optId,
        title: short,
        description: optShort,
        status: z.enum(['pending', 'active', 'done']).optional(),
      }),
    )
    .min(1)
    .max(UI_LIMITS.maxItems),
});

const executionTableComponent = z.strictObject({
  ...base,
  type: z.literal('execution_table'),
  description: optShort,
  code_lines: z.array(z.string().max(400)).max(120).optional(),
  steps: z
    .array(
      z.strictObject({
        id: optId,
        step: z.number().int().min(1).max(999),
        line: z.number().int().min(1).max(999).optional(),
        statement: z.string().max(600),
        // Values are printed as text, so a scalar (number / boolean / null) is
        // as safe as a string — and accepting it stops the very common
        // `{"x": 5}` shape from being rejected as an invalid lesson.
        variables: z.record(z.string().max(64), variableValue).optional(),
        output: z.string().max(600).optional(),
      }),
    )
    .min(1)
    .max(UI_LIMITS.maxExecutionSteps),
});

const variableVisualizationComponent = z.strictObject({
  ...base,
  type: z.literal('variable_visualization'),
  description: optShort,
  variables: z
    .array(z.strictObject({ name: z.string().max(64), value: z.string().max(300), type: optShort, changed: optBool }))
    .max(UI_LIMITS.maxItems)
    .optional(),
  steps: z
    .array(
      z.strictObject({
        label: short,
        line: z.number().int().min(1).max(999).optional(),
        variables: z
          .array(z.strictObject({ name: z.string().max(64), value: z.string().max(300), type: optShort, changed: optBool }))
          .max(UI_LIMITS.maxItems),
        output: z.string().max(600).optional(),
      }),
    )
    .max(UI_LIMITS.maxExecutionSteps)
    .optional(),
  final_output: z.string().max(600).optional(),
});

const executionTraceComponent = z.strictObject({
  ...base,
  type: z.literal('execution_trace'),
  language: z.enum(['javascript', 'python', 'java', 'sql']),
  description: optShort,
  code: z.string().max(UI_LIMITS.maxCodeChars),
  steps: z
    .array(
      z.strictObject({
        line: z.number().int().min(1).max(999),
        variables: z.record(z.string().max(64), variableValue).optional(),
        call_stack: z.array(z.string().max(200)).max(30).optional(),
        output: z.string().max(600).optional(),
        note: optShort,
      }),
    )
    .min(1)
    .max(UI_LIMITS.maxExecutionSteps),
  playback: optBool,
});

const questionValidation = fieldValidation;

const dynamicQuestion = z.strictObject({
  id,
  type: z.enum(QUESTION_TYPES),
  // `question` is the original name, `title` the authoring-sketch one. A
  // normalisation pass copies `title` → `question` before parsing, so the rest
  // of the pipeline only ever reads one field.
  question: optShort,
  title: optShort,
  description: optShort,
  placeholder: optShort,
  required: optBool,
  options: z.array(z.union([short, fieldOption])).min(1).max(UI_LIMITS.maxOptions).optional(),
  default_value: z
    .union([z.string().max(2000), z.number().finite(), z.boolean(), z.array(z.string().max(200))])
    .optional(),
  validation: questionValidation,
  hint: optShort,
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  language: z.enum(['javascript', 'python', 'java', 'sql']).optional(),
  accept: z.array(z.string().max(20)).max(6).optional(),
  // A coding question is graded by *running* the answer, so the author declares
  // what correct looks like. Without one of these the answer is executed and
  // reported as "runs without error" — never silently marked correct.
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
  // `submission` is the original name, `submit` the sketch's. Normalised before
  // parsing.
  submission: z
    .strictObject({
      button_text: optShort,
      label: optShort,
      action: z.literal('submit_ai_questions').optional(),
      evaluation: z.enum(['ai_evaluation', 'local_evaluation']).optional(),
    })
    .refine((sub) => Boolean(sub.button_text || sub.label), { message: 'submission needs button_text or label' })
    .optional(),
  submit: z
    .strictObject({
      label: optShort,
      button_text: optShort,
      action: z.literal('submit_ai_questions').optional(),
      evaluation: z.enum(['ai_evaluation', 'local_evaluation']).optional(),
    })
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* registry + union                                                            */
/* -------------------------------------------------------------------------- */

/** Type name → schema. The renderer's registry mirrors these keys exactly. */
export const COMPONENT_SCHEMAS = Object.freeze({
  text: textComponent,
  layout: layoutComponent,
  card: cardComponent,
  card_group: cardGroupComponent,
  media: mediaComponent,
  chart: chartComponent,
  table: tableComponent,
  data: dataComponent,
  form: formComponent,
  input: inputComponent,
  navigation: navigationComponent,
  carousel: carouselComponent,
  popover: popoverComponent,
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

/** Types whose children contain other components (used by depth/count checks). */
const CONTAINER_KEYS = Object.freeze({
  layout: (c) => c.children,
  card: (c) => c.children || [],
  tabs: (c) => (c.tabs || []).flatMap((t) => t.children || []),
  accordion: (c) => (c.items || []).flatMap((i) => i.children || []),
});

export const componentSchema = z.lazy(() =>
  z.discriminatedUnion('type', Object.values(COMPONENT_SCHEMAS)),
);

export const metadataSchema = z.strictObject({
  topic: optShort,
  subject: optShort,
  difficulty: z.enum(['beginner', 'developing', 'proficient', 'advanced']).optional(),
  language: z.string().max(12).optional(),
  estimated_minutes: z.number().int().min(1).max(240).optional(),
  strategy: z
    .enum(['worked_example', 'analogy_first', 'socratic', 'step_by_step', 'visual_first', 'practice_first'])
    .optional(),
  concept_id: optId,
  classroom_id: optId,
  session_id: optId,
});

export const uiDocumentSchema = z.strictObject({
  version: z.literal(UI_PROTOCOL_VERSION),
  response_id: z.string().max(80).regex(/^[A-Za-z0-9_-]+$/),
  response_type: z.enum([
    'educational_tutorial',
    'concept_check',
    'question_form',
    'code_practice',
    'assessment',
    'progress_summary',
    'clarification',
  ]),
  metadata: metadataSchema.optional(),
  learning_objectives: z.array(short).max(12).optional(),
  components: z.array(componentSchema).min(1).max(UI_LIMITS.maxComponents),
});

/* -------------------------------------------------------------------------- */
/* structural checks: depth, count, ids, bytes                                 */
/* -------------------------------------------------------------------------- */

const PRESENTATION_TYPES = new Set(['row', 'grid', 'box']);

/**
 * Depth-first walk over components *and* presentation groups.
 *
 * A `layout` may hold `row` / `grid` groups rather than components, and those
 * groups hold cells. Groups are not components — they have no id and should not
 * count toward the component total — but the components inside them must still
 * be visited, or their depth and their ids go unchecked.
 */
function walk(items, depth, visit) {
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    if (!PRESENTATION_TYPES.has(item.type)) visit(item, depth);
    const get = CONTAINER_KEYS[item?.type];
    if (get) walk(get(item) || [], PRESENTATION_TYPES.has(item.type) ? depth : depth + 1, visit);
    // A group's cells live one level below the group itself.
    if (PRESENTATION_TYPES.has(item.type) && Array.isArray(item.children)) {
      walk(item.children, depth, visit);
    }
  }
}

/**
 * @returns {{ ok: boolean, issues: string[], stats: object }}
 */
export function inspectStructure(document) {
  const issues = [];
  const ids = new Set();
  let total = 0;
  let maxDepth = 0;
  walk(document?.components || [], 1, (component, depth) => {
    total += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (depth > UI_LIMITS.maxDepth) issues.push(`nesting deeper than ${UI_LIMITS.maxDepth} levels`);
    if (component?.id) {
      if (ids.has(component.id)) issues.push(`duplicate component id "${component.id}"`);
      ids.add(component.id);
    }
  });
  if (total > UI_LIMITS.maxTotalComponents) issues.push(`more than ${UI_LIMITS.maxTotalComponents} components in total`);
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(document || {}), 'utf8');
  } catch {
    bytes = UI_LIMITS.maxDocumentBytes + 1;
  }
  if (bytes > UI_LIMITS.maxDocumentBytes) issues.push(`document larger than ${Math.round(UI_LIMITS.maxDocumentBytes / 1000)} KB`);
  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
    stats: { total, maxDepth, bytes, ids: ids.size },
  };
}

/* -------------------------------------------------------------------------- */
/* validation entry points                                                     */
/* -------------------------------------------------------------------------- */

function flatten(error) {
  return error.issues.slice(0, 30).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Strict validation. Returns `{ ok, document, issues, stats }`.
 * Invalid input never throws — the caller decides between repair and fallback.
 */
export function parseUiDocument(raw) {
  const result = uiDocumentSchema.safeParse(normaliseDocumentLayouts(raw));
  if (!result.success) {
    return { ok: false, document: null, issues: flatten(result.error), stats: null };
  }
  const structure = inspectStructure(result.data);
  if (!structure.ok) {
    return { ok: false, document: null, issues: structure.issues.map((message) => ({ path: 'components', message, code: 'structural' })), stats: structure.stats };
  }
  return { ok: true, document: result.data, issues: [], stats: structure.stats };
}

/** Validate one component on its own (used by repair and by the client). */
export function parseComponent(raw) {
  const result = componentSchema.safeParse(raw);
  return result.success ? { ok: true, component: result.data, issues: [] } : { ok: false, component: null, issues: flatten(result.error) };
}

/**
 * Lenient validation: keep every component that is individually valid, drop the
 * rest, and renumber ids that collide. Returns `null` when too little survives
 * to be worth rendering.
 *
 * Depth is enforced here by flattening beyond the limit (an over-deep subtree is
 * dropped rather than re-parented, because re-parenting would change meaning).
 */
export function repairUiDocument(raw, { minComponents = 1 } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const dropped = [];

  /**
   * Give every visual group cell a stable id and normalise its shape before the
   * schema sees it. A bare cell — `{ "type": "text", "content": "A" }` inside a
   * `grid` — is exactly what an author writes by hand, and rejecting it would
   * make the documented layout shape unusable.
   */
  const repairList = (list, depth) => {
    const out = [];
    for (const candidate of Array.isArray(list) ? list : []) {
      // A layout's cells must be normalised (ids, group shapes) *before* the
      // component parser runs, or a bare `{ type: "text", content: "A" }` cell is
      // rejected for having no id and the whole layout is dropped.
      const prepared = candidate && typeof candidate === 'object' && candidate.type === 'layout'
        ? { ...candidate, children: normaliseLayoutItems(candidate.children) }
        : candidate;
      const single = parseComponent(prepared);
      if (!single.ok) {
        dropped.push({ path: `components.${candidate?.id || candidate?.type || '?'}`, message: single.issues[0]?.message || 'invalid component' });
        continue;
      }
      let component = single.component;
      const get = CONTAINER_KEYS[component.type];
      // At the depth ceiling a container is *flattened*: its valid children are
      // promoted to this level and the wrapper is dropped. Content survives,
      // nesting stays bounded, and the renderer's recursion is capped.
      const flatten = Boolean(get) && depth >= UI_LIMITS.maxDepth;
      if (get) {
        if (component.type === 'layout') {
          // Groups (`row` / `grid` / `box`) are presentation, not components:
          // they are normalised here and validated by the layout schema itself,
          // which knows how to parse them. Anything that is a real component goes
          // through the component repair.
          const items = normaliseLayoutItems(component.children);
          const repaired = [];
          for (const item of items) {
            if (item && typeof item === 'object' && ['row', 'grid', 'box'].includes(item.type)) {
              repaired.push(item);
            } else if (item && typeof item === 'object') {
              repaired.push(...repairList([item], depth + 1));
            }
          }
          component = { ...component, children: repaired };
        }
        if (component.type === 'card' && component.children) component = { ...component, children: repairList(component.children, depth + 1) };
        if (component.type === 'tabs') component = { ...component, tabs: component.tabs.map((t) => ({ ...t, children: repairList(t.children, depth + 1) })) };
        if (component.type === 'accordion') component = { ...component, items: component.items.map((i) => ({ ...i, children: repairList(i.children, depth + 1) })) };
        if (component.type === 'layout' && !component.children.length) continue;
        if (component.type === 'tabs' && component.tabs.every((t) => !t.children.length)) continue;
        if (component.type === 'accordion' && component.items.every((i) => !i.children.length)) continue;
        if (flatten) {
          dropped.push({ path: `components.${component.id}`, message: 'flattened: nesting limit reached' });
          const promoted = component.type === 'layout'
            ? component.children
            : component.type === 'card'
              ? component.children || []
              : component.type === 'tabs'
                ? component.tabs.flatMap((t) => t.children)
                : component.items.flatMap((i) => i.children);
          out.push(...promoted);
          continue;
        }
      }
      out.push(component);
    }
    return out;
  };

  const components = repairList(raw.components, 1).slice(0, UI_LIMITS.maxComponents);
  if (components.length < minComponents) return null;

  // Unique ids: suffix duplicates rather than dropping otherwise-valid content.
  const seen = new Set();
  const dedupe = (list) => {
    for (const component of list) {
      let nextId = component.id;
      let n = 2;
      while (seen.has(nextId)) nextId = `${component.id}-${n++}`.slice(0, 64);
      seen.add(nextId);
      component.id = nextId;
      const get = CONTAINER_KEYS[component.type];
      if (get && component.type === 'layout') dedupe(component.children);
      if (get && component.type === 'card' && component.children) dedupe(component.children);
      if (get && component.type === 'tabs') component.tabs.forEach((t) => dedupe(t.children));
      if (get && component.type === 'accordion') component.items.forEach((i) => dedupe(i.children));
    }
  };
  dedupe(components);

  const base = {
    version: UI_PROTOCOL_VERSION,
    response_id: typeof raw.response_id === 'string' && /^[A-Za-z0-9_-]+$/.test(raw.response_id) ? raw.response_id.slice(0, 80) : `repaired_${Date.now().toString(36)}`,
    response_type: ['educational_tutorial', 'concept_check', 'question_form', 'code_practice', 'assessment', 'progress_summary', 'clarification'].includes(raw.response_type)
      ? raw.response_type
      : 'educational_tutorial',
    components,
  };
  const meta = metadataSchema.safeParse(raw.metadata || {});
  if (meta.success) base.metadata = meta.data;
  const objectives = z.array(short).max(12).safeParse(raw.learning_objectives || []);
  if (objectives.success) base.learning_objectives = objectives.data;

  const doc = uiDocumentSchema.safeParse(base);
  if (!doc.success) return null;
  const structure = inspectStructure(doc.data);
  if (!structure.ok) return null;
  return { document: doc.data, dropped, stats: structure.stats };
}

/** Last resort: wrap prose in a single valid `text` component. */
export function fallbackTextDocument(content, { responseId = `fallback_${Date.now().toString(36)}`, responseType = 'clarification', topic = '', title: docTitle = '' } = {}) {
  const body = cleanText(content) || 'The tutor could not produce a structured answer. Please ask again.';
  const component = { id: 'fallback_text', type: 'text', format: 'markdown', content: body.slice(0, UI_LIMITS.maxText) };
  if (docTitle) component.title = docTitle.slice(0, UI_LIMITS.maxTitle);
  return {
    version: UI_PROTOCOL_VERSION,
    response_id: responseId,
    response_type: responseType,
    metadata: topic ? { topic: String(topic).slice(0, UI_LIMITS.maxShortText) } : {},
    components: [component],
  };
}

/** Compact description of the protocol for the system prompt. */
export function protocolSummary() {
  return {
    version: UI_PROTOCOL_VERSION,
    component_types: COMPONENT_TYPES,
    limits: UI_LIMITS,
    actions: UI_ACTIONS,
    question_types: QUESTION_TYPES,
  };
}
