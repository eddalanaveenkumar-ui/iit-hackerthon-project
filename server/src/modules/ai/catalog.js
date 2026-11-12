/**
 * AI catalogue: task definitions, default model routes, feature flags and
 * per-model metadata used for cost estimation.
 *
 * Model IDs are registered exactly as specified in the product requirements.
 * Availability is NEVER assumed: the admin panel runs a live catalogue check
 * against the NVIDIA API and stores the verified status in the ai_models
 * collection (`availability`, `validatedAt`, `validationMessage`).
 */

export const NVIDIA_PROVIDER = 'nvidia';

export const MODEL_REGISTRY_SEED = [
  {
    provider: NVIDIA_PROVIDER,
    modelId: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    displayName: 'Nemotron 3.5 Lightning 30B A3B',
    category: 'chat',
    capabilities: ['chat', 'tutoring', 'structured_json', 'fast', 'gap_analysis'],
    params: { temperature: 0.4, topP: 0.95, maxTokens: 1400 },
    pricingPer1k: { input: 0.00012, output: 0.0004 },
    notes: 'Default tutoring + knowledge-gap engine: low latency, strong instruction following.',
  },
  {
    provider: NVIDIA_PROVIDER,
    modelId: 'nvidia/nemotron-3-ultra-550b-a55b',
    displayName: 'Nemotron 3 Ultra 550B A55B',
    category: 'reasoning',
    capabilities: ['chat', 'deep_reasoning', 'assessment_generation', 'structured_json'],
    params: { temperature: 0.25, topP: 0.9, maxTokens: 2400 },
    pricingPer1k: { input: 0.0012, output: 0.0036 },
    notes: 'Complex multi-step reasoning, adaptive teaching plans, assessment authoring.',
  },
  {
    provider: NVIDIA_PROVIDER,
    modelId: 'nvidia/nemotron-3.5-embed-1b',
    displayName: 'Nemotron 3.5 Embed 1B',
    category: 'embedding',
    capabilities: ['embeddings', 'retrieval'],
    params: { maxTokens: 2048 },
    pricingPer1k: { input: 0.00002, output: 0 },
    notes: 'Syllabus + learning material embeddings for retrieval.',
  },
  {
    provider: NVIDIA_PROVIDER,
    modelId: 'nvidia/nemotron-3.5-rerank-8b',
    displayName: 'Nemotron 3.5 Rerank 8B',
    category: 'rerank',
    capabilities: ['rerank', 'retrieval_ranking'],
    params: { maxTokens: 1024 },
    pricingPer1k: { input: 0.00005, output: 0 },
    notes: 'Ranks retrieved syllabus chunks for relevance before prompting.',
  },
  {
    provider: NVIDIA_PROVIDER,
    modelId: 'nvidia/nemotron-3.5-parse',
    displayName: 'Nemotron 3.5 Parse',
    category: 'parse',
    capabilities: ['document_parsing', 'ocr', 'structure_extraction'],
    params: { maxTokens: 4096 },
    pricingPer1k: { input: 0.0002, output: 0.0002 },
    notes: 'Extracts syllabus structure from uploaded PDF/DOCX/PPTX material.',
  },
  {
    provider: NVIDIA_PROVIDER,
    modelId: 'deepseek-ai/deepseek-v4.1-flash',
    displayName: 'DeepSeek V4.1 Flash',
    category: 'chat',
    capabilities: ['chat', 'fast', 'structured_json', 'vision', 'fallback'],
    params: { temperature: 0.5, topP: 0.95, maxTokens: 1600 },
    pricingPer1k: { input: 0.0002, output: 0.0006 },
    notes: 'Fast general model used as an alternate / fallback path. Multimodal: accepts image_url parts, so it can read a photo of a whiteboard or a screenshot of broken code.',
  },
];

export const DEFAULT_MODEL_REGISTRY = MODEL_REGISTRY_SEED;

/**
 * Models that were in the seed but are NOT callable on NVIDIA's free endpoint.
 *
 * Kept so that an existing database is cleaned up on boot instead of leaving
 * dead routes behind, and so the admin console can explain why something is
 * gone rather than silently dropping it.
 */
export const RETIRED_MODELS = {
  'nvidia/nemotron-content-safety-reasoning-4b':
    'Not available on the NVIDIA free endpoint. Moderation now routes to Nemotron 3.5 Lightning.',
  'qwen/qwen2.5-coder-32b-instruct':
    'Not available on the NVIDIA free endpoint. Code analysis and practical detection now route to Nemotron 3 Ultra.',
  'deepseek-ai/deepseek-v4-flash':
    'Superseded by deepseek-ai/deepseek-v4.1-flash (same family, multimodal). Routes were migrated automatically.',
};

/** Seed id -> replacement id, applied to stored routes during bootstrap. */
export const RETIRED_MODEL_REPLACEMENTS = {
  'nvidia/nemotron-content-safety-reasoning-4b': 'nvidia/nemotron-3.5-lightning-30b-a3b',
  'qwen/qwen2.5-coder-32b-instruct': 'nvidia/nemotron-3-ultra-550b-a55b',
  'deepseek-ai/deepseek-v4-flash': 'deepseek-ai/deepseek-v4.1-flash',
};

export const AI_TASKS = [
  {
    key: 'tutoring',
    label: 'General tutoring',
    description: 'Conversational personalised teaching inside a learning session.',
    defaultModel: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    defaultFallback: 'deepseek-ai/deepseek-v4-flash',
    feature: 'tutoring',
  },
  {
    key: 'complex_reasoning',
    label: 'Complex reasoning',
    description: 'Teaching-plan synthesis, multi-step diagnostics, adaptive strategy selection.',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    defaultFallback: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    feature: 'adaptive_learning',
  },
  {
    key: 'gap_detection',
    label: 'Knowledge gap detection',
    description: 'Extracts gaps, misconceptions and practical difficulties from evidence.',
    defaultModel: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    defaultFallback: 'nvidia/nemotron-3-ultra-550b-a55b',
    feature: 'gap_detection',
  },
  {
    key: 'misconception_detection',
    label: 'Misconception detection',
    description: 'Identifies incorrect mental models in student explanations/answers.',
    defaultModel: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    defaultFallback: 'nvidia/nemotron-3-ultra-550b-a55b',
    feature: 'misconception_detection',
  },
  {
    key: 'practical_detection',
    label: 'Practical difficulty detection',
    description: 'Diagnoses implementation-level difficulties from practice attempts.',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    defaultFallback: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    feature: 'practical_detection',
  },
  {
    key: 'embeddings',
    label: 'Syllabus embeddings',
    description: 'Vector embeddings for retrieval over classroom material.',
    defaultModel: 'nvidia/nemotron-3.5-embed-1b',
    defaultFallback: '',
    feature: 'syllabus_retrieval',
  },
  {
    key: 'rerank',
    label: 'Syllabus retrieval ranking',
    description: 'Re-orders retrieved chunks by relevance to the student question.',
    defaultModel: 'nvidia/nemotron-3.5-rerank-8b',
    defaultFallback: '',
    feature: 'syllabus_retrieval',
  },
  {
    key: 'document_parsing',
    label: 'Syllabus document processing',
    description: 'Turns uploaded documents into a structured syllabus outline.',
    defaultModel: 'nvidia/nemotron-3.5-parse',
    defaultFallback: 'nvidia/nemotron-3-ultra-550b-a55b',
    feature: 'syllabus_retrieval',
  },
  {
    key: 'code_analysis',
    label: 'Programming analysis',
    description: 'Reviews submitted code, finds syntax/logic errors, detects copying.',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    defaultFallback: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    feature: 'code_analysis',
  },
  {
    key: 'assessment_generation',
    label: 'AI assessment generation',
    description: 'Authors quizzes, unit tests and rubric-based practical tasks.',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    defaultFallback: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    feature: 'assessment_generation',
  },
  {
    key: 'assessment_analysis',
    label: 'Assessment analysis',
    description: 'Grades free-text answers and summarises strengths/gaps post-assessment.',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    defaultFallback: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    feature: 'ai_assessments',
  },
  {
    key: 'moderation',
    label: 'Content moderation',
    description: 'Safety check on student + generated content.',
    defaultModel: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    defaultFallback: '',
    feature: 'content_moderation',
  },
];

export const FEATURE_DEFINITIONS = [
  { key: 'tutoring', label: 'Personalised AI tutoring', description: 'Adaptive in-session teaching.', category: 'learning', defaultEnabled: true },
  { key: 'gap_detection', label: 'Knowledge gap detection', description: 'Evidence-based gap scanning.', category: 'intelligence', defaultEnabled: true },
  { key: 'misconception_detection', label: 'Misconception detection', description: 'Incorrect-model spotting.', category: 'intelligence', defaultEnabled: true },
  { key: 'practical_detection', label: 'Practical difficulty detection', description: 'Implementation-level diagnostics.', category: 'intelligence', defaultEnabled: true },
  { key: 'adaptive_learning', label: 'Adaptive learning', description: 'Scaffolding + difficulty adaptation.', category: 'learning', defaultEnabled: true },
  { key: 'assessment_generation', label: 'AI assessment generation', description: 'Author quizzes and tests on demand.', category: 'assessment', defaultEnabled: true },
  { key: 'ai_assessments', label: 'AI-triggered assessments', description: 'Recommend assessments when evidence is missing.', category: 'assessment', defaultEnabled: true },
  { key: 'syllabus_retrieval', label: 'Syllabus retrieval', description: 'RAG over uploaded classroom material.', category: 'learning', defaultEnabled: true },
  { key: 'code_analysis', label: 'Code analysis', description: 'Static + AI analysis of practical submissions.', category: 'practical', defaultEnabled: true },
  { key: 'content_moderation', label: 'Content moderation', description: 'Safety filtering of chat content.', category: 'safety', defaultEnabled: true },
];

export const MODEL_PRICING = Object.fromEntries(
  MODEL_REGISTRY_SEED.map((m) => [m.modelId, m.pricingPer1k]),
);

export const TASK_FEATURE_MAP = Object.fromEntries(AI_TASKS.map((t) => [t.key, t.feature]));
