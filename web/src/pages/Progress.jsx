import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Brain, Gauge, GraduationCap, Shield, Target, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBanner, LoadingBlock, ProgressBar, StatCard, cx, useToast } from '../components/ui';
import { ConceptMasteryBar, MasteryTrendChart, SkillRadar, WeaknessPie } from '../components/charts';
import { categoryLabels, categoryStyles, levelStyles, masteryColor, severityStyles, timeAgo } from '../lib/format';

export default function Progress() {
  const [classrooms, setClassrooms] = useState(null);
  const [classroomId, setClassroomId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/tutor/classrooms')
      .then((res) => {
        setClassrooms(res.classrooms);
        if (res.classrooms.length) setClassroomId(res.classrooms[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const load = useCallback(async () => {
    if (!classroomId) return;
    try {
      setData(await api(`/intelligence/classrooms/${classroomId}/my-progress`));
    } catch (e) {
      setError(e.message);
    }
  }, [classroomId]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const chartData = useMemo(() => {
    if (!data) return { mastery: [], radar: [], weaknesses: [] };
    return {
      mastery: data.mastery.slice(0, 8).map((m) => ({
        label: m.conceptName.length > 22 ? `${m.conceptName.slice(0, 21)}…` : m.conceptName,
        score: m.score,
        color: masteryColor(m.score),
      })),
      radar: [
        { skill: 'Mastery', score: data.profile.independence ? Math.round((data.mastery.reduce((a, m) => a + m.score, 0) / (data.mastery.length || 1))) : 0 },
        { skill: 'Independence', score: data.profile.independence?.score || 0 },
        { skill: 'Speed', score: data.profile.learningSpeed?.score || 0 },
        { skill: 'Consistency', score: Math.min(100, (data.profile.stats?.sessions || 0) * 8) },
        { skill: 'Assessment', score: data.assessments.length ? Math.round(data.assessments.reduce((a, x) => a + (x.percentage ?? 0), 0) / data.assessments.length) : 0 },
        { skill: 'Coverage', score: Math.min(100, data.mastery.length * 12) },
      ],
      weaknesses: [
        { name: 'Knowledge gap', value: data.profile.weaknessCounts?.knowledge_gap || 0 },
        { name: 'Misconception', value: data.profile.weaknessCounts?.misconception || 0 },
        { name: 'Practical', value: data.profile.weaknessCounts?.practical_difficulty || 0 },
        { name: 'Repeated', value: data.profile.weaknessCounts?.repeated_error || 0 },
      ],
    };
  }, [data]);

  if (error && !classrooms) return <ErrorBanner message={error} />;
  if (!classrooms) return <LoadingBlock rows={4} />;
  if (!classrooms.length) {
    return <EmptyState icon={GraduationCap} title="No classrooms yet" description="Your learning profile is created per classroom as soon as you start a session." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">My progress</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Every classroom has its own profile. Evidence comes from answers, assessments and practical work — never from self-report.
          </p>
        </div>
        <div className="flex gap-2">
          <select className="input w-auto" value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Link to={`/app/classrooms/${classroomId}/privacy`} className="btn-secondary">
            <Shield className="h-4 w-4" /> Chat privacy
          </Link>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {!data ? (
        <LoadingBlock rows={5} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Knowledge level" value={<span className="capitalize">{data.profile.knowledgeLevel}</span>} sub={`${data.mastery.length} concepts with evidence`} icon={Brain} />
            <StatCard label="Learning speed" value={<span className="capitalize">{data.profile.learningSpeed?.label}</span>} sub={`Score ${data.profile.learningSpeed?.score ?? 0}/100`} icon={Gauge} tone="violet" />
            <StatCard label="Independence" value={`${data.profile.independence?.score ?? 0}%`} sub={`${data.profile.independence?.hintsPerSession ?? 0} hints per session`} icon={Target} tone="success" />
            <StatCard label="Assessments" value={data.profile.stats?.assessmentsTaken || 0} sub={`${data.profile.stats?.totalStudyMinutes || 0} study minutes`} icon={Activity} tone="warning" />
          </div>

          {data.pendingAssessment ? (
            <div className="card card-pad border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Assessment recommended: {data.pendingAssessment.title}</p>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{data.pendingAssessment.reason}</p>
                </div>
                <Link to={`/app/assessments?classroom=${classroomId}`} className="btn-primary btn-sm">
                  Review
                </Link>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card card-pad lg:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Mastery over time</h2>
                <span className="text-[11px] text-slate-400">mastery · independence</span>
              </div>
              <MasteryTrendChart data={data.profile.timeline || []} />
            </div>
            <div className="card card-pad">
              <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Skill profile</h2>
              <SkillRadar data={chartData.radar} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card card-pad">
              <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Concept mastery</h2>
              <ConceptMasteryBar data={chartData.mastery} height={Math.max(180, chartData.mastery.length * 34)} />
            </div>
            <div className="card card-pad">
              <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Open weaknesses</h2>
              <WeaknessPie data={chartData.weaknesses} height={200} />
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Detected knowledge gaps & misconceptions</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Each finding is evidence-backed with severity and repeat count.</p>
            </div>
            {data.weaknesses.length === 0 ? (
              <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No open weaknesses. Keep practising — the engine only records what the evidence supports.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.weaknesses.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cx('badge border', categoryStyles[w.category])}>{categoryLabels[w.category]}</span>
                        <span className={cx('badge border', severityStyles[w.severity])}>{w.severity}</span>
                        <span className="text-[11px] text-slate-400">{w.conceptName}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{w.description}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        seen {w.occurrences}× · {w.status} · {timeAgo(w.firstDetectedAt)}
                      </p>
                    </div>
                    <Link to={`/app/start?classroom=${classroomId}`} className="btn-secondary btn-sm shrink-0">
                      Practise <ArrowRight className="h-3 w-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Concept detail</h2>
              </div>
              {data.mastery.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No concept evidence yet.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Concept</th>
                        <th>Level</th>
                        <th>Score</th>
                        <th>Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.mastery.map((m) => (
                        <tr key={m.conceptId}>
                          <td>
                            <p className="font-medium text-slate-800 dark:text-slate-100">{m.conceptName}</p>
                            <p className="text-[11px] text-slate-400">{m.unitName}</p>
                          </td>
                          <td>
                            <span className={cx('badge', levelStyles[m.level])}>{m.level.replace('_', ' ')}</span>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <ProgressBar value={m.score} className="w-16" tone={m.score >= 70 ? 'success' : m.score >= 40 ? 'brand' : 'warning'} />
                              <span className="text-xs font-medium">{m.score}%</span>
                            </div>
                          </td>
                          <td>
                            {m.trend > 0 ? (
                              <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600">
                                <TrendingUp className="h-3 w-3" /> +{m.trend}
                              </span>
                            ) : m.trend < 0 ? (
                              <span className="text-xs text-rose-600">{m.trend}</span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Assessment history</h2>
              </div>
              {data.assessments.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No assessments in this classroom yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.assessments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{a.percentage}%</p>
                        <p className="text-[11px] text-slate-400">{timeAgo(a.submittedAt)}</p>
                      </div>
                      <Badge tone={a.percentage >= 70 ? 'success' : a.percentage >= 40 ? 'warning' : 'danger'}>
                        {a.aiFeedback?.nextSteps?.[0]?.slice(0, 40) || 'recorded'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
