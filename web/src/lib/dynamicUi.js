import { api } from './api';

/**
 * HOST ACTIONS FOR THE DYNAMIC RENDERER
 * =====================================
 *
 * The renderer's interactive components call these. Keeping them in one module
 * (rather than inline in a page) means:
 *  - every network call the renderer can make is visible in one file;
 *  - each action normalises a server error into `{ ok: false, reason }` instead
 *    of throwing through React, so a component shows an inline message;
 *  - the "in-flight" guard lives here too, so two components on the same lesson
 *    cannot double-submit the same payload.
 */

const inFlight = new Map();

function guard(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = Promise.resolve()
    .then(fn)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Generate a lesson document. Returns `{ ok, document, lesson, ... }`. */
export async function generateLesson({ prompt, mode = 'learn', classroomId, conceptId, sessionId, level, stream = false, onStage }) {
  if (stream && typeof onStage === 'function') {
    // Streaming is used for its *progress stages*, not for partial JSON: a lesson
    // is only renderable once it validates, so the value of the stream is telling
    // the student what the engine is doing while it works.
    const token = (() => {
      try {
        return localStorage.getItem('learnmate.token');
      } catch {
        return null;
      }
    })();
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/ai-tutor/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ prompt, mode, classroomId, conceptId, sessionId, level, stream: true }),
      });
      if (!response.ok || !response.body) throw new Error(`Generation failed (${response.status})`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let final = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.event === 'stage') onStage(event);
          if (event.event === 'document') final = event;
        }
      }
      if (!final) throw new Error('The lesson stream ended without a document');
      return { ok: true, ...final };
    } catch (error) {
      // Fall back to the non-streaming endpoint: a proxy that buffers NDJSON
      // should not cost the student their lesson.
      const result = await generateLesson({ prompt, mode, classroomId, conceptId, sessionId, level });
      onStage?.({ event: 'stage', stage: 'complete', source: 'buffered' });
      if (!result.ok) return { ...result, reason: result.reason || error.message };
      return result;
    }
  }

  try {
    const payload = await api('/ai-tutor/generate', { method: 'POST', body: { prompt, mode, classroomId, conceptId, sessionId, level } });
    return { ok: true, ...payload };
  } catch (error) {
    return { ok: false, reason: error.message, code: error.code };
  }
}

export async function continueLesson({ lessonId, prompt, classroomId }) {
  try {
    const payload = await api('/ai-tutor/continue', { method: 'POST', body: { lessonId, prompt, classroomId } });
    return { ok: true, ...payload };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export async function loadLesson(lessonId) {
  try {
    const payload = await api(`/ai-tutor/lessons/${encodeURIComponent(lessonId)}`);
    return { ok: true, ...payload };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export async function submitFormAnswers(formId, payload) {
  return guard(`form:${formId}`, async () => {
    try {
      const response = await api('/learning/forms/submit', { method: 'POST', body: payload });
      return { ok: true, ...response };
    } catch (error) {
      // Field-level validation errors are surfaced as details, not as a reason
      // string, so the form can mark individual questions.
      return { ok: false, reason: error.message, details: error.details };
    }
  });
}

export async function submitQuiz(quizId, payload) {
  return guard(`quiz:${quizId}`, async () => {
    try {
      const response = await api('/learning/quiz/submit', { method: 'POST', body: payload });
      return { ok: true, ...response };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  });
}

export async function runCode(code, language, extra = {}) {
  try {
    const response = await api('/learning/code/execute', { method: 'POST', body: { code, language, ...extra } });
    return { ok: true, ...response };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export async function saveProgress({ lessonId, classroomId, completedComponentId, totalComponents, title, conceptId }) {
  try {
    const response = await api('/learning/progress', {
      method: 'POST',
      body: {
        lesson_id: lessonId,
        classroom_id: classroomId || undefined,
        completed_component_id: completedComponentId,
        total_components: totalComponents,
        title,
        concept_id: conceptId || undefined,
      },
    });
    return { ok: true, ...response };
  } catch {
    // Progress is best-effort: a failure here must never interrupt a lesson.
    return { ok: false };
  }
}

export async function fetchProgress(lessonId, classroomId) {
  try {
    const query = new URLSearchParams({ lessonId, ...(classroomId ? { classroomId } : {}) });
    const response = await api(`/learning/progress/me?${query.toString()}`);
    return response.lessons?.[0] || null;
  } catch {
    return null;
  }
}

export async function fetchMyProgress(classroomId) {
  try {
    const query = classroomId ? `?classroomId=${encodeURIComponent(classroomId)}` : '';
    return await api(`/learning/progress/me${query}`);
  } catch (error) {
    return { lessons: [], summary: null, error: error.message };
  }
}

export async function fetchResume() {
  try {
    return await api('/learning/resume');
  } catch {
    return { lesson: null, progress: null };
  }
}

/**
 * Build the action bag a `<DynamicRenderer>` needs.
 *
 * @param {object} options
 * @param {(path: string) => void} options.navigate
 * @param {(tone: string, message: string) => void} [options.notify]
 */
export function createDynamicActions({ navigate, notify, onProgress, onFollowUp, onContinue, classroomId, lessonId, title, conceptId, totalComponents }) {
  return {
    submitAnswers: (formId, payload) => submitFormAnswers(formId, payload),
    submitQuiz: (quizId, payload) => submitQuiz(quizId, payload),
    runCode: (code, language, extra) => runCode(code, language, extra),
    markComplete: async (componentId) => {
      if (!lessonId) return { ok: false };
      const result = await saveProgress({ lessonId, classroomId, completedComponentId: componentId, totalComponents, title, conceptId });
      if (result.ok && result.progress) onProgress?.(result.progress);
      return result;
    },
    navigate: (target) => navigate(target),
    continueLesson: async () => {
      if (onContinue) return onContinue();
      return { ok: false, reason: 'Continuation is not available here.' };
    },
    startAssessment: () => navigate('/app/assessments'),
    openPractice: () => navigate('/app/practice'),
    notify: (tone, message) => notify?.(tone, message),
    onFollowUp,
  };
}
