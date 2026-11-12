import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Clock,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Timer,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { Badge, EmptyState, ErrorBanner, LoadingBlock, Modal, ProgressBar, Spinner, Tabs, useToast } from '../components/ui';
import { AnswerSheet } from '../components/AnswerSheet';

const KIND_LABELS = {
  topic_quiz: 'Topic quiz',
  unit_test: 'Unit test',
  practical: 'Practical',
  conceptual: 'Conceptual understanding',
  revision: 'Revision',
};

export default function Assessments() {
  const [params] = useSearchParams();
  const [classrooms, setClassrooms] = useState(null);
  const [classroomId, setClassroomId] = useState(params.get('classroom') || '');
  const [data, setData] = useState(null);
  const [outline, setOutline] = useState(null);
  const [tab, setTab] = useState('all');
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [active, setActive] = useState(null);
  const [result, setResult] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api('/tutor/classrooms')
      .then((res) => {
        setClassrooms(res.classrooms);
        if (!classroomId && res.classrooms.length) {
          setClassroomId(params.get('classroom') || res.classrooms[0].id);
        }
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!classroomId) return;
    try {
      const [a, o] = await Promise.all([api(`/learning/classrooms/${classroomId}/assessments`), api(`/tutor/classrooms/${classroomId}/outline`)]);
      setData(a);
      setOutline(o);
    } catch (e) {
      setError(e.message);
    }
  }, [classroomId]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (tab === 'recommended') return data.assessments.filter((a) => a.origin === 'ai' && a.status !== 'completed');
    if (tab === 'completed') return data.assessments.filter((a) => a.status === 'completed');
    if (tab === 'postponed') return data.assessments.filter((a) => a.status === 'postponed');
    return data.assessments;
  }, [data, tab]);

  const postpone = async (id) => {
    try {
      await api(`/learning/classrooms/${classroomId}/assessments/${id}/postpone`, { method: 'POST' });
      toast.success('Assessment postponed — you can take it later');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (error && !classrooms) return <ErrorBanner message={error} />;
  if (!classrooms) return <LoadingBlock rows={4} />;
  if (!classrooms.length) {
    return <EmptyState icon={ClipboardList} title="Join a classroom first" description="Assessments are classroom-scoped and update that classroom's learning profile." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Assessments</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Take them when you choose. Recommended assessments are optional and can be postponed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto" value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> New assessment
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {!data ? (
        <LoadingBlock rows={4} />
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'all', label: 'All', count: data.assessments.length },
              { key: 'recommended', label: 'Recommended', count: data.assessments.filter((a) => a.origin === 'ai' && a.status !== 'completed').length },
              { key: 'completed', label: 'Completed', count: data.assessments.filter((a) => a.status === 'completed').length },
              { key: 'postponed', label: 'Postponed', count: data.assessments.filter((a) => a.status === 'postponed').length },
            ]}
          />

          {filtered.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No assessments here"
              description="Create one whenever you want evidence of your understanding — or wait for the AI to recommend one after repeated difficulty."
              action={
                <button onClick={() => setCreateOpen(true)} className="btn-primary btn-sm">
                  Create assessment
                </button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((a) => (
                <div key={a.id} className="card card-pad">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{a.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {a.conceptName} · {KIND_LABELS[a.kind] || a.kind}
                      </p>
                    </div>
                    <Badge tone={a.origin === 'ai' ? 'violet' : a.origin === 'teacher' ? 'brand' : 'neutral'}>
                      {a.origin === 'ai' ? 'AI recommended' : a.origin === 'teacher' ? 'Assigned' : 'Self-initiated'}
                    </Badge>
                  </div>
                  {a.recommendedReason ? <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{a.recommendedReason}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <ClipboardList className="h-3 w-3" /> {a.questionCount} questions
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Timer className="h-3 w-3" /> {a.durationMinutes}m
                    </span>
                    <span>{timeAgo(a.createdAt)}</span>
                  </div>
                  {a.result ? (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-slate-400">Score</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {a.result.score}/{a.result.maxScore} ({a.result.percentage}%)
                        </span>
                      </div>
                      <ProgressBar value={a.result.percentage} className="mt-1" tone={a.result.percentage >= 70 ? 'success' : a.result.percentage >= 40 ? 'warning' : 'danger'} />
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={async () => {
                          const detail = await api(`/learning/classrooms/${classroomId}/assessments/${a.id}`);
                          setActive(detail);
                        }}
                        className="btn-primary btn-sm"
                      >
                        {a.status === 'postponed' ? 'Resume' : 'Start'}
                      </button>
                      {a.origin === 'ai' && a.status !== 'postponed' ? (
                        <button onClick={() => postpone(a.id)} className="btn-secondary btn-sm">
                          Postpone
                        </button>
                      ) : null}
                    </div>
                  )}
                  {a.status === 'postponed' ? <Badge tone="warning" className="mt-2">Postponed</Badge> : null}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {createOpen ? (
        <CreateAssessmentModal
          classroomId={classroomId}
          concepts={outline?.subjects?.flatMap((s) => s.units.flatMap((u) => u.concepts)) || []}
          defaultConceptId={params.get('concept') || ''}
          onClose={() => setCreateOpen(false)}
          onCreated={async (a) => {
            setCreateOpen(false);
            load();
            const detail = await api(`/learning/classrooms/${classroomId}/assessments/${a.id}`).catch(() => ({ assessment: a, questions: a.questions || [] }));
            setActive({ assessment: { ...a, concept: detail.assessment?.concept ?? a.concept }, questions: detail.questions || a.questions || [] });
          }}
        />
      ) : null}

      {active ? (
        <AttemptModal
          classroomId={classroomId}
          detail={active}
          onClose={() => setActive(null)}
          onSubmitted={(res) => {
            setResult(res);
            setActive(null);
            load();
          }}
          result={result}
          onCloseResult={() => setResult(null)}
        />
      ) : null}

      {result ? <ResultModal result={result} onClose={() => setResult(null)} /> : null}
    </div>
  );
}

function CreateAssessmentModal({ classroomId, concepts, defaultConceptId, onClose, onCreated }) {
  const [conceptId, setConceptId] = useState(defaultConceptId || concepts[0]?.id || '');
  const [kind, setKind] = useState('topic_quiz');
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api(`/learning/classrooms/${classroomId}/assessments`, {
        method: 'POST',
        body: { conceptId, kind, origin: 'student', questionCount: count },
      });
      onCreated({ ...res.assessment, questions: res.questions });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create an assessment"
      description="The AI authors questions targeting this concept and your known gaps."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={create} className="btn-primary" disabled={busy || !conceptId}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorBanner message={error} onDismiss={() => setError('')} />
        <div>
          <label className="label">Concept</label>
          <select className="input" value={conceptId} onChange={(e) => setConceptId(e.target.value)}>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Questions ({count})</label>
          <input type="range" min={3} max={12} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-brand-600" />
        </div>
      </div>
    </Modal>
  );
}

function AttemptModal({ classroomId, detail, onClose, onSubmitted, result, onCloseResult }) {
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started] = useState(() => Date.now());
  const questions = detail.questions || [];

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = {
        answers: questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? null })),
        durationSeconds: Math.round((Date.now() - started) / 1000),
        hintUsage: 0,
      };
      const res = await api(`/learning/classrooms/${classroomId}/assessments/${detail.assessment.id}/submit`, {
        method: 'POST',
        body: payload,
      });
      onSubmitted(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} width="max-w-4xl" title="" bare>
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <AnswerSheet
        title={detail.assessment.title}
        level={difficultyLevel(questions)}
        marks={questions.length}
        minutes={detail.assessment.durationMinutes}
        questions={questions}
        answers={answers}
        onAnswer={(qid, value) => setAnswers((a) => ({ ...a, [qid]: value }))}
        onSubmit={submit}
        submitting={busy}
        footer={
          <p className="mt-2 text-center text-[11px] text-slate-400">
            {KIND_LABELS[detail.assessment.kind] || 'Assessment'} · close without submitting to return later
          </p>
        }
      />
    </Modal>
  );
}

/** Derive a single level label from the per-question difficulties. */
function difficultyLevel(questions) {
  const order = { easy: 1, medium: 2, hard: 3 };
  const avg = questions.reduce((sum, q) => sum + (order[q.difficulty] || 2), 0) / (questions.length || 1);
  if (avg < 1.7) return 'Beginner';
  if (avg < 2.4) return 'Intermediate';
  return 'Advanced';
}

function ResultModal({ result, onClose }) {
  const r = result.result;
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title="Assessment result" description={`${r.score} / ${r.maxScore} correct`}>
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-end justify-between">
            <p className="text-3xl font-semibold text-slate-900 dark:text-white">{r.percentage}%</p>
            <Badge tone={r.percentage >= 70 ? 'success' : r.percentage >= 40 ? 'warning' : 'danger'}>
              {result.profile?.conceptMastery?.level || 'recorded'}
            </Badge>
          </div>
          <ProgressBar value={r.percentage} className="mt-2" tone={r.percentage >= 70 ? 'success' : r.percentage >= 40 ? 'warning' : 'danger'} />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Profile updated · knowledge level now <strong>{result.profile?.knowledgeLevel}</strong>
            {r.gapsResolved ? ` · ${r.gapsResolved} earlier gap(s) resolved` : ''}
          </p>
        </div>

        {r.aiFeedback?.strengths?.length || r.aiFeedback?.gaps?.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/30">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Strengths</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-emerald-800 dark:text-emerald-200">
                {(r.aiFeedback.strengths || []).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Gaps</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-amber-800 dark:text-amber-200">
                {(r.aiFeedback.gaps || []).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {r.gapsDetected?.length ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New weaknesses recorded</p>
            <ul className="mt-1 space-y-1">
              {r.gapsDetected.map((g) => (
                <li key={g.id} className="text-xs text-slate-600 dark:text-slate-300">
                  <Badge tone={g.severity === 'high' || g.severity === 'critical' ? 'danger' : 'warning'}>{g.category.replace('_', ' ')}</Badge>{' '}
                  {g.description}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Review</p>
          <ul className="mt-1 space-y-1.5">
            {(r.answers || []).map((a, i) => (
              <li key={a.questionId} className="flex items-start gap-2 text-xs">
                {a.correct ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
                <span className="text-slate-600 dark:text-slate-300">
                  <span className="font-medium">Q{i + 1}</span> {a.analysis || 'Correct.'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
