import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Code2,
  Lightbulb,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Send,
  Terminal,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBanner, LoadingBlock, Spinner, cx, useToast } from '../components/ui';
import { useTheme } from '../contexts/ThemeContext';
import { timeAgo } from '../lib/format';

const LANGS = [
  { key: 'javascript', label: 'JavaScript', note: 'Executed in the sandbox' },
  { key: 'python', label: 'Python', note: 'Executed with an isolated interpreter' },
  { key: 'java', label: 'Java', note: 'Static analysis only in this deployment' },
  { key: 'sql', label: 'SQL', note: 'Static analysis only in this deployment' },
];

export default function Practice() {
  const [params, setParams] = useSearchParams();
  const [classrooms, setClassrooms] = useState(null);
  const [classroomId, setClassroomId] = useState(params.get('classroom') || '');
  const [outline, setOutline] = useState(null);
  const [exercises, setExercises] = useState(null);
  const [activeId, setActiveId] = useState(params.get('exercise') || '');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newFor, setNewFor] = useState({ conceptId: '', language: 'javascript' });

  useEffect(() => {
    api('/tutor/classrooms')
      .then((res) => {
        setClassrooms(res.classrooms.filter((c) => c.hasSyllabus));
        if (!classroomId && res.classrooms.length) setClassroomId(res.classrooms[0].id);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadExercises = useCallback(async () => {
    if (!classroomId) return;
    try {
      const [o, e] = await Promise.all([api(`/tutor/classrooms/${classroomId}/outline`), api(`/practice/classrooms/${classroomId}/exercises`)]);
      setOutline(o);
      setExercises(e.exercises);
      if (!activeId && e.exercises.length) setActiveId(e.exercises[0].id);
    } catch (err) {
      setError(err.message);
    }
  }, [classroomId, activeId]);

  useEffect(() => {
    setExercises(null);
    setOutline(null);
    loadExercises();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  const concepts = useMemo(() => outline?.subjects?.flatMap((s) => s.units.flatMap((u) => u.concepts.map((c) => ({ ...c, unit: u.name })))) || [], [outline]);

  useEffect(() => {
    if (concepts.length && !newFor.conceptId) setNewFor((n) => ({ ...n, conceptId: concepts[0].id }));
  }, [concepts, newFor.conceptId]);

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      const res = await api(`/practice/classrooms/${classroomId}/exercises`, {
        method: 'POST',
        body: { conceptId: newFor.conceptId, language: newFor.language, difficulty: 'medium' },
      });
      setActiveId(res.exercise.id);
      await loadExercises();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  if (error && !classrooms) return <ErrorBanner message={error} />;
  if (!classrooms) return <LoadingBlock rows={4} />;

  if (!classrooms.length) {
    return (
      <EmptyState
        icon={Code2}
        title="No classroom with a syllabus yet"
        description="Practical exercises are generated from syllabus concepts. Join a classroom that has a syllabus first."
        action={
          <Link to="/app/classrooms" className="btn-primary btn-sm">
            Browse classrooms
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Practical practice</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Generate coding tasks from your syllabus and submit them to a sandboxed evaluator. Code never runs on the API server.
          </p>
        </div>
        <select
          className="input w-auto"
          value={classroomId}
          onChange={(e) => {
            setClassroomId(e.target.value);
            setActiveId('');
            setParams({ classroom: e.target.value });
          }}
        >
          {classrooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <div className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Generate exercise</h2>
            <div className="mt-2 space-y-2">
              <select className="input" value={newFor.conceptId} onChange={(e) => setNewFor((n) => ({ ...n, conceptId: e.target.value }))}>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select className="input" value={newFor.language} onChange={(e) => setNewFor((n) => ({ ...n, language: e.target.value }))}>
                {LANGS.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label} — {l.note}
                  </option>
                ))}
              </select>
              <button onClick={create} className="btn-primary w-full btn-sm" disabled={creating || !newFor.conceptId}>
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Generate
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-white">
              Exercises {exercises ? `(${exercises.length})` : ''}
            </p>
            {!exercises ? (
              <div className="p-4">
                <LoadingBlock rows={3} />
              </div>
            ) : exercises.length === 0 ? (
              <p className="p-4 text-xs text-slate-500 dark:text-slate-400">No exercises yet — generate one.</p>
            ) : (
              <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {exercises.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => setActiveId(e.id)}
                      className={cx(
                        'flex w-full items-start justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50',
                        activeId === e.id && 'bg-brand-50/60 dark:bg-brand-950/30',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{e.title}</span>
                        <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {e.conceptName} · {e.language} · {e.myAttempts} attempt{e.myAttempts === 1 ? '' : 's'}
                        </span>
                      </span>
                      {e.solved ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {activeId ? <ExerciseWorkspace key={activeId} classroomId={classroomId} exerciseId={activeId} onSubmitted={loadExercises} /> : (
          <div className="card card-pad flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            Select or generate an exercise to begin.
          </div>
        )}
      </div>
    </div>
  );
}

function ExerciseWorkspace({ classroomId, exerciseId, onSubmitted }) {
  const { theme } = useTheme();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [code, setCode] = useState('');
  const [output, setOutput] = useState(null);
  const [review, setReview] = useState(null);
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hint, setHint] = useState(null);
  const [error, setError] = useState('');
  const [startedAt] = useState(() => Date.now());

  useEffect(() => {
    api(`/practice/classrooms/${classroomId}/exercises/${exerciseId}`)
      .then((res) => {
        setData(res);
        setCode(res.submissions[0]?.code || res.exercise.starterCode || '');
      })
      .catch((e) => setError(e.message));
  }, [classroomId, exerciseId]);

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      const res = await api(`/practice/classrooms/${classroomId}/exercises/${exerciseId}/run`, { method: 'POST', body: { code } });
      setOutput(res);
      if (!res.executed) toast.info(res.reason || 'Static analysis only');
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await api(`/practice/classrooms/${classroomId}/exercises/${exerciseId}/submit`, {
        method: 'POST',
        body: { code, hintsUsed, timeSpentSeconds: Math.round((Date.now() - startedAt) / 1000) },
      });
      setOutput(res.submission);
      setReview(res.review);
      onSubmitted?.();
      if (res.submission.passed) toast.success('All tests passed');
      else toast.info(`${res.submission.passedCount}/${res.submission.totalTests} visible tests passed`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const getHint = async () => {
    try {
      const level = Math.min(3, hint ? hint.level + 1 : 1);
      const res = await api(`/practice/classrooms/${classroomId}/exercises/${exerciseId}/hint`, { method: 'POST', body: { level } });
      setHint(res);
      setHintsUsed((h) => h + 1);
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (error && !data) return <ErrorBanner message={error} />;
  if (!data) return <LoadingBlock rows={5} />;

  const ex = data.exercise;
  const languageMap = { javascript: 'javascript', python: 'python', java: 'java', sql: 'sql' };

  return (
    <div className="space-y-3">
      <div className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{ex.title}</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {ex.concept?.name} · {ex.language} · {ex.difficulty} · {ex.hiddenTestCount} hidden test{ex.hiddenTestCount === 1 ? '' : 's'}
            </p>
          </div>
          <Badge tone="brand">Attempt {data.submissions.length + 1}</Badge>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{ex.prompt}</p>
        {ex.rubric?.length ? (
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            {ex.rubric.map((r, i) => (
              <li key={i}>• {r.criterion} {r.weight ? `(${Math.round(r.weight * 100)}%)` : ''}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Code2 className="h-3.5 w-3.5" /> {ex.language}
          </span>
          <div className="flex gap-2">
            <button onClick={getHint} className="btn-secondary btn-sm">
              <Lightbulb className="h-3.5 w-3.5" /> Hint
            </button>
            <button onClick={run} className="btn-secondary btn-sm" disabled={running}>
              {running ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} Run
            </button>
            <button onClick={submit} className="btn-primary btn-sm" disabled={submitting}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Submit
            </button>
          </div>
        </div>
        <Editor
          height="360px"
          language={languageMap[ex.language] || 'javascript'}
          value={code}
          onChange={(v) => setCode(v || '')}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          options={{
            fontSize: 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 12, bottom: 12 },
            tabSize: 2,
            renderLineHighlight: 'line',
            fontFamily: 'JetBrains Mono, monospace',
          }}
          loading={<div className="flex h-[360px] items-center justify-center text-sm text-slate-500"><Spinner /> Loading editor…</div>}
        />
      </div>

      {hint ? (
        <div className="card card-pad border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-slate-800 dark:text-slate-100">
              <span className="font-semibold">Hint {hint.level}: </span>
              {hint.hint}
            </p>
            <button onClick={() => setHint(null)} className="btn-ghost btn-sm">
              Hide
            </button>
          </div>
        </div>
      ) : null}

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {output ? <ExecutionResult output={output} review={review} language={ex.language} /> : null}
    </div>
  );
}

function ExecutionResult({ output, review, language }) {
  const tests = output.results || [];
  const passed = tests.filter((t) => t.passed).length;
  return (
    <div className="card card-pad space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Result</h3>
          {output.executed === false ? <Badge tone="warning">static analysis only</Badge> : null}
          {output.timedOut ? <Badge tone="danger">timed out</Badge> : null}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {tests.length ? `${passed}/${tests.length} passed` : output.runtime}
        </span>
      </div>

      {output.reason ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          {output.reason}
        </p>
      ) : null}

      {output.loadError ? (
        <pre className="overflow-x-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{String(output.loadError).slice(0, 1200)}</pre>
      ) : null}

      {tests.length ? (
        <ul className="space-y-1.5">
          {tests.map((t) => (
            <li key={t.id} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2 text-xs dark:border-slate-800">
              {t.passed ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-slate-800 dark:text-slate-100">{t.id}</span>
                {t.output ? <span className="block font-mono text-[11px] text-slate-500 dark:text-slate-400">output: {String(t.output).slice(0, 200)}</span> : null}
                {t.error ? <span className="block font-mono text-[11px] text-rose-600 dark:text-rose-400">{String(t.error).slice(0, 200)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {output.hiddenSummary?.length ? (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] text-slate-500">Hidden tests:</span>
          {output.hiddenSummary.map((h) => (
            <Badge key={h.id} tone={h.passed ? 'success' : 'danger'}>
              {h.id} {h.passed ? 'pass' : 'fail'}
            </Badge>
          ))}
        </div>
      ) : null}

      {output.stdout ? (
        <pre className="max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{output.stdout}</pre>
      ) : null}

      {output.staticAnalysis ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Static analysis</p>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
            <Badge tone="neutral">similarity to solution: {output.staticAnalysis.similarityToSolution ?? 0}%</Badge>
            <Badge tone={output.staticAnalysis.copyPasteSuspected ? 'danger' : 'success'}>
              {output.staticAnalysis.copyPasteSuspected ? 'copy-paste suspected' : 'independent work'}
            </Badge>
            {(output.staticAnalysis.issues || []).map((i, idx) => (
              <Badge key={idx} tone={i.type === 'syntax' ? 'danger' : i.type === 'logic' ? 'warning' : 'neutral'}>
                {i.type}: {i.message.slice(0, 60)}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {review ? (
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI code review</p>
          {review.understandingVerdict ? <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{review.understandingVerdict}</p> : null}
          {review.logicWarnings?.length ? (
            <ul className="mt-1.5 list-disc pl-4 text-xs text-amber-700 dark:text-amber-400">
              {review.logicWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          {review.syntaxErrors?.length ? (
            <ul className="mt-1.5 list-disc pl-4 text-xs text-rose-700 dark:text-rose-400">
              {review.syntaxErrors.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          {review.progressiveHints?.length ? (
            <div className="mt-2">
              <p className="text-[11px] font-semibold text-slate-500">Next hints</p>
              <ol className="mt-0.5 list-decimal pl-4 text-xs text-slate-600 dark:text-slate-300">
                {review.progressiveHints.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}

      {language === 'java' || language === 'sql' ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          Runtime execution for {language} is disabled in this deployment, so these results come from static analysis only — they are
          not test results.
        </p>
      ) : null}
    </div>
  );
}
