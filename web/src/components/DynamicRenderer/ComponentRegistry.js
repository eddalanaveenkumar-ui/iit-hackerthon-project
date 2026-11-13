import { lazy } from 'react';

/**
 * THE COMPONENT REGISTRY
 * ======================
 *
 * One map from a validated component `type` to the React component that knows
 * how to draw it. There is deliberately no dynamic import by name, no `eval`, and
 * no string-to-component lookup outside this object: an AI cannot introduce a
 * component type that is not listed here, and adding one is a code change, a
 * review and a test.
 *
 * Renderers are lazy so a lesson with a chart does not pull Recharts into the
 * initial bundle, and a lesson with a code editor does not pull in Monaco until
 * the student actually reaches it.
 */

const TextRenderer = lazy(() => import('./components/TextRenderer'));
const LayoutRenderer = lazy(() => import('./components/LayoutRenderer'));
const CardRenderer = lazy(() => import('./components/CardRenderer'));
const CardGroupRenderer = lazy(() => import('./components/CardGroupRenderer'));
const MediaRenderer = lazy(() => import('./components/MediaRenderer'));
const DataRenderer = lazy(() => import('./components/DataRenderer'));
const InputRenderer = lazy(() => import('./components/InputRenderer'));
const NavigationRenderer = lazy(() => import('./components/NavigationRenderer'));
const DataGroupRenderer = lazy(() => import('./components/DataGroupRenderer'));
const NavigationGroups = lazy(() => import('./components/NavigationGroups'));
const QuizRenderer = lazy(() => import('./components/QuizRenderer'));
const LearningRenderer = lazy(() => import('./components/LearningRenderer'));
const CodeRenderer = lazy(() => import('./components/CodeRenderer'));
const MathRenderer = lazy(() => import('./components/MathRenderer'));
const DiagramRenderer = lazy(() => import('./components/DiagramRenderer'));
const ActionRenderer = lazy(() => import('./components/ActionRenderer'));
const ProgressRenderer = lazy(() => import('./components/ProgressRenderer'));
const TimelineRenderer = lazy(() => import('./components/TimelineRenderer'));
const SimulationRenderer = lazy(() => import('./components/SimulationRenderer'));
const ExecutionRenderer = lazy(() => import('./components/ExecutionRenderer'));
const QuestionFormRenderer = lazy(() => import('./components/QuestionFormRenderer'));

/**
 * Container types render their own children; everything else is a leaf.
 * DynamicRenderer uses this to decide whether to pass the `renderChildren`
 * callback (it also keeps the depth guard meaningful).
 */
export const CONTAINER_TYPES = Object.freeze(['layout', 'card', 'tabs', 'accordion']);

export const COMPONENT_REGISTRY = Object.freeze({
  text: TextRenderer,
  layout: LayoutRenderer,
  card: CardRenderer,
  card_group: CardGroupRenderer,
  media: MediaRenderer,
  // DataRenderer owns chart/table: both are "render this dataset" components with
  // the same empty-state, caption and overflow behaviour.
  chart: DataRenderer,
  table: DataRenderer,
  form: QuestionFormRenderer,
  input: InputRenderer,
  navigation: NavigationRenderer,
  // Presentation-only navigation: a carousel and a popover cannot act.
  carousel: NavigationGroups,
  popover: NavigationGroups,
  data: DataGroupRenderer,
  quiz: QuizRenderer,
  learning: LearningRenderer,
  code_editor: CodeRenderer,
  math: MathRenderer,
  diagram: DiagramRenderer,
  actions: ActionRenderer,
  progress: ProgressRenderer,
  timeline: TimelineRenderer,
  tabs: LayoutRenderer,
  accordion: LayoutRenderer,
  simulation: SimulationRenderer,
  teaching_workflow: ProgressRenderer,
  execution_table: ExecutionRenderer,
  variable_visualization: ExecutionRenderer,
  execution_trace: ExecutionRenderer,
  question_form: QuestionFormRenderer,
});

export const REGISTERED_TYPES = Object.freeze(Object.keys(COMPONENT_REGISTRY));

export function getRenderer(type) {
  return COMPONENT_REGISTRY[type] || null;
}

export function isContainer(type) {
  return CONTAINER_TYPES.includes(type);
}
