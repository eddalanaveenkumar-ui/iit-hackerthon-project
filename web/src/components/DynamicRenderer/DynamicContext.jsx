import { createContext, useContext, useMemo } from 'react';
import { ThemeContext } from '../../contexts/ThemeContext';
import { ToastContext } from '../ui';

/**
 * THE ONLY CHANNEL FROM A RENDERER TO THE APPLICATION
 * ===================================================
 *
 * Interactive components (quiz, question_form, code editor, actions, progress)
 * need to *do* something. They never fetch, never navigate directly and never
 * receive a callback from the model — they call `actions.*`, which the host page
 * provides. That keeps one place where network access, navigation and progress
 * persistence happen, and it means a component cannot be tricked into calling an
 * endpoint the host did not offer.
 *
 *   submitAnswers(formId, payload)  -> POST /api/learning/forms/submit
 *   submitQuiz(quizId, payload)     -> POST /api/learning/quiz/submit
 *   runCode(code, language, opts)   -> POST /api/learning/code/execute
 *   markComplete(componentId)       -> POST /api/learning/progress
 *   navigate(target)                -> router navigation (allowlisted paths)
 *   continueLesson()                -> POST /api/ai-tutor/continue
 *   startAssessment()               -> route to assessments
 *   openPractice()                  -> route to the practice workspace
 *   notify(tone, message)           -> toast
 *
 * `progress` is the current learner progress for this lesson (may be null).
 * `lessonId` / `classroomId` scope every write.
 */

const DynamicContext = createContext(null);

const noop = async () => ({ ok: false, reason: 'unavailable' });

const DEFAULT_ACTIONS = {
  submitAnswers: noop,
  submitQuiz: noop,
  runCode: noop,
  markComplete: noop,
  navigate: () => {},
  continueLesson: noop,
  startAssessment: () => {},
  openPractice: () => {},
  notify: () => {},
};

export function DynamicProvider({ actions, lessonId = null, classroomId = null, conversationId = null, progress = null, children }) {
  const value = useMemo(
    () => ({
      actions: { ...DEFAULT_ACTIONS, ...(actions || {}) },
      lessonId,
      classroomId,
      conversationId,
      progress,
    }),
    [actions, lessonId, classroomId, conversationId, progress],
  );
  return <DynamicContext.Provider value={value}>{children}</DynamicContext.Provider>;
}

/**
 * Access the host actions.
 *
 * Returns the safe defaults when no provider is mounted (unit tests, a renderer
 * used in isolation), so a component never crashes because it was rendered
 * outside a lesson.
 */
/**
 * Read the theme without requiring a ThemeProvider.
 *
 * `useTheme()` throws outside its provider. The renderer is embedded in places
 * that may not mount the app shell (a chat bubble in isolation, a component
 * test, a future embed), and a dark-mode preference is never a reason to fail a
 * lesson — so an absent provider falls back to light, and charts/editors simply
 * render in their light palette.
 *
 * @returns {{ theme: 'light'|'dark', toggleTheme?: () => void }}
 */
export function useSafeTheme() {
  const context = useContext(ThemeContext);
  if (context && (context.theme === 'dark' || context.theme === 'light')) return context;
  return FALLBACK_THEME;
}

/** Read toasts without requiring a ToastProvider (same reasoning as above). */
export function useSafeToast() {
  const context = useContext(ToastContext);
  return context || FALLBACK_TOAST;
}

const FALLBACK_THEME = Object.freeze({ theme: 'light', toggleTheme: () => {} });
const FALLBACK_TOAST = Object.freeze({
  // A toast is an enhancement. Outside the provider the caller still surfaces
  // the same information inline, so these are deliberately silent no-ops.
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {},
  toast: () => {},
});

export function useDynamicActions() {
  const ctx = useContext(DynamicContext);
  return ctx || { actions: DEFAULT_ACTIONS, lessonId: null, classroomId: null, progress: null };
}

export function useMaybeDynamicActions() {
  return useContext(DynamicContext);
}
