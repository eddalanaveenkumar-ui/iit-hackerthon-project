import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  GraduationCap,
  Loader2,
  Sparkles,
  Target,
  TestTube2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { Badge, ErrorBanner, LoadingBlock, RadioOption, cx } from '../components/ui';
import { levelStyles } from '../lib/format';

const MODES = [
  { key: 'learn', label: 'Learn a concept', description: 'Explanation, worked example, then a diagnostic question.', icon: BookOpen },
  { key: 'test', label: 'Test my understanding', description: 'Questions only — the tutor evaluates each answer.', icon: Check },
  { key: 'practise', label: 'Practise practical problems', description: 'Hands-on tasks guided with progressive hints.', icon: TestTube2 },
  { key: 'continue', label: 'Continue learning', description: 'Resume from your last gaps and session.', icon: TrendingUp },
];

const STEPS = ['Classroom', 'Subject', 'Unit', 'Concept', 'Mode'];

export default function StartLearning() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [classrooms, setClassrooms] = useState(null);
  const [outline, setOutline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const [classroomId, setClassroomId] = useState(params.get('classroom') || '');
  const [subjectId, setSubjectId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [conceptId, setConceptId] = useState('');
  const [mode, setMode] = useState('learn');

  useEffect(() => {
    api('/tutor/classrooms')
      .then((res) => {
        setClassrooms(res.classrooms);
        if (res.classrooms.length === 1) {
          setClassroomId(res.classrooms[0].id);
          setStep(1);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!classroomId) return;
    setOutline(null);
    api(`/tutor/classrooms/${classroomId}/outline`)
      .then(setOutline)
      .catch((e) => setError(e.message));
  }, [classroomId]);

  const classroom = classrooms?.find((c) => c.id === classroomId);
  const subject = outline?.subjects?.find((s) => s.id === subjectId);
  const unit = subject?.units?.find((u) => u.id === unitId);
  const concept = unit?.concepts?.find((c) => c.id === conceptId);

  const canNext = useMemo(() => {
    if (step === 0) return Boolean(classroomId);
    if (step === 1) return Boolean(subjectId);
    if (step === 2) return Boolean(unitId);
    if (step === 3) return Boolean(conceptId);
    return Boolean(mode);
  }, [step, classroomId, subjectId, unitId, conceptId, mode]);

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const res = await api('/tutor/sessions', {
        method: 'POST',
        body: { classroomId, conceptId, mode },
      });
      navigate(`/app/tutor/${res.session.id}`, { state: { fresh: res } });
    } catch (e) {
      setError(e.message);
      setStarting(false);
    }
  };

  if (loading) return <LoadingBlock rows={5} />;

  if (!classrooms?.length) {
    return (
      <div className="card card-pad text-center">
        <Users className="mx-auto h-8 w-8 text-slate-400" />
        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">You are not in any classroom yet</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Join a classroom with its ID or create your own to start learning.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Link to="/app/classrooms" className="btn-secondary">
            Join classroom
          </Link>
          <Link to="/app/classrooms/new" className="btn-primary">
            Create classroom
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Start a learning session</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Choose exactly what to learn. A fresh chat opens with the classroom syllabus loaded — previous records are kept.
        </p>
      </div>

      {/* Stepper */}
      <ol className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-1">
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={cx(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                i === step
                  ? 'bg-brand-600 text-white'
                  : i < step
                    ? 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300'
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
              )}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px]">{i < step ? '✓' : i + 1}</span>
              {label}
            </button>
            {i < STEPS.length - 1 ? <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" /> : null}
          </li>
        ))}
      </ol>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="card card-pad">
        {step === 0 ? (
          <div>
            <StepTitle title="Select a classroom" hint={`You belong to ${classrooms.length} classrooms. Progress is tracked separately for each.`} />
            <div className="grid gap-2 sm:grid-cols-2">
              {classrooms.map((c) => (
                <RadioOption
                  key={c.id}
                  name="classroom"
                  checked={classroomId === c.id}
                  onChange={() => {
                    setClassroomId(c.id);
                    setSubjectId('');
                    setUnitId('');
                    setConceptId('');
                  }}
                  title={c.name}
                  description={`${c.subject} · ${c.myRole === 'student' ? 'learner' : c.myRole}${c.hasSyllabus ? '' : ' · no syllabus yet'}`}
                  meta={
                    <>
                      {c.conceptMasteryAvg !== null ? <Badge tone="brand">{c.conceptMasteryAvg}% mastery</Badge> : null}
                      {!c.hasSyllabus ? <Badge tone="warning">No syllabus</Badge> : null}
                    </>
                  }
                  disabled={!c.hasSyllabus}
                />
              ))}
            </div>
            {classroom && !classroom.hasSyllabus ? (
              <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                This classroom has no syllabus yet. The tutor needs one to teach from — ask the classroom owner to add it.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <StepTitle title="Select a subject" hint={classroom ? `${classroom.name} · ${classroom.subject}` : ''} />
            {!outline ? (
              <LoadingBlock rows={2} />
            ) : (
              <div className="grid gap-2">
                {outline.subjects.map((s) => (
                  <RadioOption
                    key={s.id}
                    name="subject"
                    checked={subjectId === s.id}
                    onChange={() => {
                      setSubjectId(s.id);
                      setUnitId('');
                      setConceptId('');
                    }}
                    title={s.name}
                    description={`${s.units.length} units · ${s.units.reduce((a, u) => a + u.concepts.length, 0)} concepts`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <StepTitle title="Select a unit" hint={subject?.name} />
            <div className="grid gap-2">
              {subject?.units.map((u) => (
                <RadioOption
                  key={u.id}
                  name="unit"
                  checked={unitId === u.id}
                  onChange={() => {
                    setUnitId(u.id);
                    setConceptId('');
                  }}
                  title={u.name}
                  description={`${u.concepts.length} concepts`}
                  meta={u.avgMastery !== null ? <Badge tone="brand">{u.avgMastery}% mastery</Badge> : null}
                />
              ))}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <StepTitle title="Select a concept" hint={unit?.name} />
            <div className="grid gap-2">
              {unit?.concepts.map((c) => (
                <RadioOption
                  key={c.id}
                  name="concept"
                  checked={conceptId === c.id}
                  onChange={() => setConceptId(c.id)}
                  title={c.name}
                  description={c.description?.slice(0, 160)}
                  meta={
                    <>
                      <span className={cx('badge', levelStyles[c.masteryLevel] || levelStyles.not_started)}>{c.masteryLevel?.replace('_', ' ')}</span>
                      {c.openGaps ? <Badge tone="warning">{c.openGaps} open gaps</Badge> : null}
                    </>
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div>
            <StepTitle title="Select a learning mode" hint={concept ? `${concept.name}` : ''} />
            <div className="grid gap-2 sm:grid-cols-2">
              {MODES.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    className={cx(
                      'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      mode === m.key
                        ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500/30 dark:border-brand-500 dark:bg-brand-950/30'
                        : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
                    )}
                  >
                    <span
                      className={cx(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                        mode === m.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{m.label}</span>
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{m.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {concept ? (
              <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Session summary</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                  <span>{classroom?.name}</span>
                  <ChevronRight className="h-3 w-3 text-slate-400" />
                  <span>{subject?.name}</span>
                  <ChevronRight className="h-3 w-3 text-slate-400" />
                  <span>{unit?.name}</span>
                  <ChevronRight className="h-3 w-3 text-slate-400" />
                  <span className="font-medium">{concept.name}</span>
                </div>
                {concept.objectives?.length ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Objectives: {concept.objectives.join(' · ')}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => (step === 0 ? navigate(-1) : setStep((s) => s - 1))} className="btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {step < 4 ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            className="btn-primary"
            disabled={!canNext || (step === 0 && !outline)}
          >
            Continue <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button onClick={start} className="btn-primary" disabled={!canNext || starting}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Start session
          </button>
        )}
      </div>
    </div>
  );
}

function StepTitle({ title, hint }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}
