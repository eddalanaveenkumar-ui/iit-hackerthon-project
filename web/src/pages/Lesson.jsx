import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Check, ChevronDown, GraduationCap, RotateCcw, Sparkles } from 'lucide-react';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';
import { ProgressBar, Spinner, cx, useToast } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { generateLesson, createDynamicActions, loadLesson, continueLesson, fetchProgress } from '../lib/dynamicUi';

/**
 * THE LESSON SURFACE
 * ==================
 *
 * `/app/lesson?prompt=…` authors a lesson; `/app/lesson/:lessonId` re-opens a
 * stored one. This page is the *host*: it owns the network, the actions the
 * renderer may call, progress state and the "ask again" affordance. The renderer
 * owns everything inside the document.
 *
 * The student can also keep asking questions in a plain chat box — a lesson is
 * not a dead end, and the free-text path stays available because typing is the
 * fastest way to ask a follow-up.
 */

const SUGGESTIONS = [
  { prompt: 'Teach me recursion in Python.', label: 'Recursion in Python', icon: 'code' },
  { prompt: 'Explain loops in Python with an execution trace.', label: 'Python loops', icon: 'code' },
  { prompt: 'Teach me derivatives with worked examples.', label: 'Derivatives', icon: 'sigma' },
  { prompt: 'Explain Newton’s second law with a diagram.', label: 'Newton’s laws', icon: 'flask' },
  { prompt: 'How does gradient descent work?', label: 'Gradient descent', icon: 'brain' },
];

export default function Lesson() {
  const { lessonId: routeLessonId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const initialPrompt = params.get('prompt') || '';
  const classroomId = params.get('classroom') || null;
  const conceptId = params.get('concept') || null;
  const initialMode = params.get('mode') || 'learn';

  const [prompt, setPrompt] = useState(initialPrompt);
  const [input, setInput] = useState('');
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(Boolean(initialPrompt || routeLessonId));
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [progress, setProgress] = useState(null);
  const [continuing, setContinuing] = useState(false);
  const [showStages, setShowStages] = useState(false);
  const requested = useRef(false);

  const author = useCallback(
    async (text, mode = initialMode) => {
      if (!text?.trim()) return;
      setLoading(true);
      setError('');
      setStage('Analysing your question…');
      const result = await generateLesson({
        prompt: text.trim(),
        mode,
        classroomId,
        conceptId,
        level: user?.knowledgeLevel,
        stream: true,
        onStage: (event) => {
          if (event.stage === 'analysed') setStage(`Teaching ${event.subject?.replace(/_/g, ' ') || 'this'} at ${event.level || 'your'} level…`);
          if (event.stage === 'authored') setStage('Checking every section…');
        },
      });
      if (!result.ok) {
        setError(result.reason || 'The lesson could not be generated.');
        setLoading(false);
        return;
      }
      setLesson(result);
      setSource(result.source || '');
      setProgress(null);
      setStage('');
      setLoading(false);
      if (result.lesson?.lessonId && routeLessonId !== result.lesson.lessonId) {
        navigate(`/app/lesson/${result.lesson.lessonId}`, { replace: true, state: { generated: true } });
      }
      // Load whatever progress already exists (a lesson can be re-opened).
      fetchProgress(result.lesson?.lessonId, classroomId).then(setProgress).catch(() => {});
    },
    [classroomId, conceptId, initialMode, navigate, routeLessonId, user?.knowledgeLevel],
  );

  // Author on mount when a prompt was supplied, or open a stored lesson by id.
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    if (routeLessonId) {
      setLoading(true);
      loadLesson(routeLessonId)
        .then((result) => {
          if (!result.ok) {
            setError(result.reason || 'That lesson could not be loaded.');
            return;
          }
          setLesson({ document: result.document, lesson: { lessonId: result.lessonId || routeLessonId, plainText: '' }, source: result.source });
          setSource(result.source || '');
          fetchProgress(result.lessonId || routeLessonId, classroomId).then(setProgress).catch(() => {});
        })
        .finally(() => setLoading(false));
      return;
    }
    if (initialPrompt) author(initialPrompt);
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLessonId]);

  const totalComponents = useMemo(() => {
    const document = lesson?.document;
    if (!document) return 0;
    const walk = (list) => (list || []).reduce((sum, c) => sum + (['layout', 'tabs', 'accordion'].includes(c.type) ? 0 : 1) + walk(c.children) + walk((c.tabs || []).flatMap((t) => t.children)) + walk((c.items || []).flatMap((i) => i.children)), 0);
    return walk(document.components);
  }, [lesson]);

  const actions = useMemo(
    () =>
      createDynamicActions({
        navigate: (path) => navigate(path),
        notify: (tone, message) => toast?.[tone]?.(message),
        onProgress: setProgress,
        classroomId,
        lessonId: lesson?.lesson?.lessonId,
        title: lesson?.document?.metadata?.topic || lesson?.lesson?.conceptName || '',
        conceptId,
        totalComponents,
      }),
    [classroomId, conceptId, lesson, navigate, toast, totalComponents],
  );

  const handleContinue = async () => {
    if (!lesson?.lesson?.lessonId || continuing) return { ok: false, reason: 'Nothing to continue yet.' };
    setContinuing(true);
    const result = await continueLesson({ lessonId: lesson.lesson.lessonId, prompt: input.trim() || 'Continue the lesson with the next step.', classroomId });
    setContinuing(false);
    if (!result.ok) {
      toast.error(result.reason || 'Could not continue the lesson.');
      return result;
    }
    navigate(`/app/lesson/${result.lesson.lessonId}`);
    setLesson(result);
    setSource(result.source || '');
    setInput('');
    return result;
  };

  const askFollowUp = async (text) => {
    const question = String(text ?? input).trim();
    if (!question) return;
    setInput('');
    if (!lesson) {
      author(question);
      return;
    }
    setContinuing(true);
    const result = await continueLesson({ lessonId: lesson.lesson.lessonId, prompt: question, classroomId });
    setContinuing(false);
    if (!result.ok) {
      toast.error(result.reason || 'Could not build the follow-up lesson.');
      return;
    }
    navigate(`/app/lesson/${result.lesson.lessonId}`);
    setLesson(result);
    setSource(result.source || '');
  };

  /* ---------------------------------------------------------------- authoring */
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl py-10">
        <div className="card card-pad">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <Sparkles className="h-4 w-4 text-brand-600" aria-hidden />
            Building your lesson
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{stage || 'Working…'}</p>
          <div className="mt-4 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-10 w-full" style={{ opacity: 1 - i * 0.15 }} />
            ))}
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] text-slate-400">What is happening?</summary>
            <button type="button" onClick={() => setShowStages((s) => !s)} className="mt-1 block text-[11px] text-brand-600 hover:underline dark:text-brand-400">
              {showStages ? 'Hide' : 'Show'} the teaching workflow
            </button>
            {showStages ? <TeachingWorkflow /> : null}
          </details>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- no lesson yet */
  if (!lesson) {
    return (
      <div className="mx-auto w-full max-w-2xl py-6">
        <div className="mb-4 flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-brand-600" aria-hidden />
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Lesson studio</h1>
        </div>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          Ask for a topic and the tutor builds an interactive lesson: explanations, diagrams, code you can run, and questions it will
          evaluate. Ask for something specific — “teach me recursion in Python” gives a better lesson than “recursion”.
        </p>
        {error ? (
          <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mb-5 grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.prompt}
              type="button"
              onClick={() => {
                setPrompt(suggestion.prompt);
                author(suggestion.prompt);
              }}
              className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-800 dark:hover:bg-brand-950/20"
            >
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{suggestion.label}</span>
                <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{suggestion.prompt}</span>
              </span>
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            author(input);
          }}
          className="flex items-end gap-2"
        >
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What should the lesson teach?"
            aria-label="Lesson topic"
          />
          <button type="submit" className="btn-primary shrink-0" disabled={!input.trim()}>
            Teach me
          </button>
        </form>
      </div>
    );
  }

  /* ------------------------------------------------------------------- lesson */
  const meta = lesson.document?.metadata || {};
  const progressPercent = progress?.percent || 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <button type="button" onClick={() => navigate('/app')} className="btn-ghost -ml-2 btn-sm">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to chat
          </button>
          <h1 className="mt-1 truncate text-lg font-semibold text-slate-900 dark:text-white">{meta.topic || 'Lesson'}</h1>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {meta.subject ? `${String(meta.subject).replace(/_/g, ' ')} · ` : ''}
            {meta.difficulty || 'developing'}
            {progress?.status === 'completed' ? ' · completed' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {source === 'local' || source === 'local-fallback' ? (
            <span className="badge bg-amber-50 text-[10px] text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title="Generated by the deterministic teaching engine (no model key configured)">
              offline engine
            </span>
          ) : null}
          <button type="button" onClick={() => { requested.current = false; setLesson(null); setPrompt(''); }} className="btn-secondary btn-sm">
            <RotateCcw className="h-3 w-3" aria-hidden /> New lesson
          </button>
        </div>
      </div>

      {progressPercent > 0 ? (
        <div className="mb-3 flex items-center gap-2">
          <ProgressBar value={progressPercent} className="flex-1" />
          <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            {progressPercent >= 100 ? <Check className="h-3 w-3 text-emerald-600" aria-hidden /> : null}
            {progress?.completedCount ?? 0}/{progress?.totalComponents || totalComponents || '—'} sections
          </span>
        </div>
      ) : null}

      {error ? (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      <DynamicRenderer
        document={lesson.document}
        actions={actions}
        lessonId={lesson.lesson?.lessonId}
        classroomId={classroomId}
        progress={progress}
        onInvalid={() => author(prompt || 'Explain that again, more simply.')}
      />

      <div className="sticky bottom-0 mt-4 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent pb-3 pt-6 dark:from-slate-950 dark:via-slate-950">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            askFollowUp(input);
          }}
          className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
        >
          <textarea
            rows={1}
            className="max-h-32 min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
            placeholder="Ask a follow-up, or say “go deeper”, “quiz me”, “simpler”…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                askFollowUp(input);
              }
            }}
            disabled={continuing}
            aria-label="Follow-up question"
          />
          <button type="submit" className="btn-primary h-10 shrink-0 px-3" disabled={continuing || !input.trim()}>
            {continuing ? <Spinner /> : 'Send'}
          </button>
        </form>
        <button type="button" onClick={() => setShowStages((s) => !s)} className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          <ChevronDown className={cx('h-3 w-3 transition-transform', showStages && 'rotate-180')} aria-hidden />
          How this lesson was built
        </button>
        {showStages ? <TeachingWorkflow /> : null}
      </div>
    </div>
  );
}

const WORKFLOW = [
  ['Analyse the question', 'Restate what is actually being asked.'],
  ['Identify subject and concept', 'Map to a syllabus concept when one is selected.'],
  ['Estimate your level', 'From the learning profile and the wording of the question.'],
  ['Set the learning objective', 'One observable outcome.'],
  ['Choose a strategy', 'Analogy, worked example, visual first, socratic or practice first.'],
  ['Explain', 'Short sections, one idea each.'],
  ['Select UI components', 'Only what helps this subject.'],
  ['Add practical examples', 'Runnable where possible, with expected output.'],
  ['Add interactive practice', 'Something you can attempt immediately.'],
  ['Generate an assessment', 'A short knowledge check.'],
  ['Evaluate understanding', 'What you submit is graded.'],
  ['Recommend the next step', 'One concrete action.'],
];

function TeachingWorkflow() {
  return (
    <ol className="mt-1.5 grid gap-1 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2">
      {WORKFLOW.map(([title, detail], index) => (
        <li key={title} className="flex items-start gap-1.5">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[9px] font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">{index + 1}</span>
          <span>
            <span className="font-medium text-slate-700 dark:text-slate-200">{title}</span>
            <span className="block text-slate-500 dark:text-slate-400">{detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
