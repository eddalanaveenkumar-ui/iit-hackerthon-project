import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Eye,
  EyeOff,
  MessageSquareLock,
  ShieldAlert,
  Target,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { Avatar, Badge, EmptyState, ErrorBanner, LoadingBlock, ProgressBar, StatCard, Switch, Tabs, cx, useToast } from '../components/ui';
import { ActivityChart, WeaknessPie } from '../components/charts';
import { categoryLabels, categoryStyles, levelStyles, roleLabels, severityStyles, timeAgo } from '../lib/format';

export default function Monitoring() {
  const { classroomId } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(['students', 'weaknesses', 'analytics', 'assessment'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'students');
  const [overview, setOverview] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [toggling, setToggling] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api(`/intelligence/classrooms/${classroomId}/analytics`);
      setData(res);
      if (res.monitoringEnabled) {
        const [o, a] = await Promise.all([
          api(`/intelligence/classrooms/${classroomId}/overview`),
          api(`/learning/classrooms/${classroomId}/assessment-overview`),
        ]);
        setOverview(o);
        setAssessment(a);
      }
    } catch (e) {
      setError(e.message);
    }
  }, [classroomId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleMonitoring = async (value) => {
    setToggling(true);
    try {
      const me = await api('/auth/me');
      await api(`/classrooms/${classroomId}/teachers/${me.user.id}/monitoring`, { method: 'PATCH', body: { monitoringEnabled: value } });
      toast.success(`Monitoring ${value ? 'enabled' : 'disabled'}`);
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setToggling(false);
    }
  };

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <LoadingBlock rows={5} />;

  return (
    <div className="space-y-5">
      <Link to={`/app/classrooms/${classroomId}`} className="btn-ghost -ml-2">
        <ArrowLeft className="h-4 w-4" /> Back to classroom
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Student monitoring</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {data.classroom.name} · {data.aggregate.studentCount} learners · monitoring is {data.monitoringEnabled ? 'enabled' : 'disabled'} for your role
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
          <ShieldAlert className="h-4 w-4 text-slate-400" />
          <span className="text-xs text-slate-500 dark:text-slate-400">Monitoring</span>
          <Switch checked={data.monitoringEnabled} onChange={toggleMonitoring} disabled={toggling} label="" />
        </div>
      </div>

      {!data.monitoringEnabled ? (
        <div className="card card-pad border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <EyeOff className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Monitoring is switched off for your teacher profile</p>
              <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{data.message}</p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Only classroom-level aggregates are shown below. Your own learning in this classroom is unaffected.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Learners" value={data.aggregate.studentCount} sub={`${data.aggregate.activeLast7Days ?? 0} active this week`} icon={Users} />
        <StatCard label="Average mastery" value={data.aggregate.averageMastery == null ? '—' : `${data.aggregate.averageMastery}%`} sub={`Independence ${data.aggregate.averageIndependence ?? 0}%`} icon={Target} tone="success" />
        <StatCard label="Open weaknesses" value={data.aggregate.totalOpenWeaknesses} sub={`${data.aggregate.byCategory?.misconception || 0} misconceptions`} icon={AlertTriangle} tone="warning" />
        <StatCard label="Assessment average" value={data.aggregate.assessmentAverage == null ? '—' : `${data.aggregate.assessmentAverage}%`} sub={`${data.aggregate.assessmentCount ?? 0} attempts`} icon={ClipboardList} tone="violet" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'students', label: 'Students' },
          { key: 'weaknesses', label: 'Weaknesses' },
          { key: 'analytics', label: 'Classroom analytics' },
          { key: 'assessment', label: 'Assessment results' },
        ]}
      />

      {tab === 'students' ? (
        data.monitoringEnabled ? (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th>Level</th>
                    <th>Mastery</th>
                    <th>Independence</th>
                    <th>Weaknesses</th>
                    <th>Sessions</th>
                    <th>Chat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.userId}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar name={s.name} color={s.avatarColor} size={30} />
                          <div>
                            <p className="font-medium text-slate-800 dark:text-slate-100">{s.name}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{s.email}</p>
                          </div>
                          {s.atRisk ? <Badge tone="danger">at risk</Badge> : null}
                        </div>
                      </td>
                      <td>
                        <span className={cx('badge', levelStyles[s.knowledgeLevel])}>{s.knowledgeLevel}</span>
                      </td>
                      <td>
                        {s.masteryAverage === null ? (
                          <span className="text-xs text-slate-400">No evidence</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <ProgressBar value={s.masteryAverage} className="w-16" tone={s.masteryAverage >= 70 ? 'success' : 'brand'} />
                            <span className="text-xs">{s.masteryAverage}%</span>
                          </div>
                        )}
                      </td>
                      <td className="text-xs">{s.independenceScore}%</td>
                      <td className="text-xs">
                        {s.openWeaknesses}
                        <span className="ml-1 text-[10px] text-slate-400">({s.byCategory.misconception} miscon.)</span>
                      </td>
                      <td className="text-xs">{s.sessions}</td>
                      <td>
                        {s.chatShared ? (
                          <Badge tone="success">
                            <Eye className="h-3 w-3" /> shared
                          </Badge>
                        ) : (
                          <Badge tone="neutral">
                            <MessageSquareLock className="h-3 w-3" /> private
                          </Badge>
                        )}
                      </td>
                      <td className="text-right">
                        <Link to={`/app/classrooms/${classroomId}/profile/${s.userId}`} className="btn-secondary btn-sm">
                          Profile
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.students.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No learners in this classroom yet.</p> : null}
          </div>
        ) : (
          <EmptyState
            icon={EyeOff}
            title="Individual student data is hidden"
            description="Monitoring is off for your teacher profile, so student profiles, per-student analytics and chat history are not available. Turn monitoring on to view them."
          />
        )
      ) : null}

      {tab === 'weaknesses' ? (
        data.monitoringEnabled ? (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Severity</th>
                    <th>Seen</th>
                    <th>Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {data.weaknesses.map((w) => (
                    <tr key={w.id}>
                      <td className="whitespace-nowrap">{w.name}</td>
                      <td>
                        <span className={cx('badge border', categoryStyles[w.category])}>{categoryLabels[w.category]}</span>
                      </td>
                      <td className="max-w-[380px] text-xs text-slate-600 dark:text-slate-300">{w.description}</td>
                      <td>
                        <span className={cx('badge border', severityStyles[w.severity])}>{w.severity}</span>
                      </td>
                      <td className="text-xs">{w.occurrences}×</td>
                      <td className="whitespace-nowrap text-xs text-slate-400">{timeAgo(w.lastDetectedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.weaknesses.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No open weaknesses detected.</p> : null}
          </div>
        ) : (
          <EmptyState icon={EyeOff} title="Detailed weaknesses hidden" description="Enable monitoring to see which learner has which weakness." />
        )
      ) : null}

      {tab === 'analytics' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card card-pad">
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Concept hotspots</h2>
            {data.aggregate.conceptHotspots?.length ? (
              <ul className="space-y-2">
                {data.aggregate.conceptHotspots.map((h) => (
                  <li key={h.conceptName} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-slate-700 dark:text-slate-200">{h.conceptName}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {h.total} issues {h.studentsAffected ? `· ${h.studentsAffected} learners` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No hotspots detected yet.</p>
            )}
          </div>
          <div className="card card-pad">
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Weakness distribution</h2>
            <WeaknessPie
              data={[
                { name: 'Knowledge gap', value: data.aggregate.byCategory?.knowledge_gap || 0 },
                { name: 'Misconception', value: data.aggregate.byCategory?.misconception || 0 },
                { name: 'Practical', value: data.aggregate.byCategory?.practical_difficulty || 0 },
                { name: 'Repeated', value: data.aggregate.byCategory?.repeated_error || 0 },
              ]}
            />
          </div>
          {overview ? (
            <div className="card card-pad lg:col-span-2">
              <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Sessions & assessments (14 days)</h2>
              <ActivityChart data={overview.analytics.timeline} />
            </div>
          ) : null}
          {data.monitoringEnabled ? (
            <>
              <div className="card card-pad">
                <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Knowledge level distribution</h2>
                <ul className="space-y-1.5">
                  {(data.aggregate.levelDistribution || []).map((l) => (
                    <li key={l.level}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="capitalize text-slate-600 dark:text-slate-300">{l.level}</span>
                        <span className="font-medium">{l.count}</span>
                      </div>
                      <ProgressBar value={(l.count / Math.max(1, data.aggregate.studentCount)) * 100} className="mt-0.5" />
                    </li>
                  ))}
                </ul>
              </div>
              <div className="card card-pad">
                <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Learning speed distribution</h2>
                <ul className="space-y-1.5">
                  {(data.aggregate.speedDistribution || []).map((l) => (
                    <li key={l.speed}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="capitalize text-slate-600 dark:text-slate-300">{l.speed}</span>
                        <span className="font-medium">{l.count}</span>
                      </div>
                      <ProgressBar value={(l.count / Math.max(1, data.aggregate.studentCount)) * 100} className="mt-0.5" tone="violet" />
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === 'assessment' ? (
        data.monitoringEnabled ? (
          assessment ? (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Learner</th>
                      <th>Attempts</th>
                      <th>Average</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assessment.students.map((s) => (
                      <tr key={s.userId}>
                        <td>{s.name}</td>
                        <td className="text-xs">{s.attempts}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <ProgressBar value={s.averagePercentage} className="w-24" tone={s.averagePercentage >= 70 ? 'success' : 'warning'} />
                            <span className="text-xs">{s.averagePercentage}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {assessment.students.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No assessments submitted yet.</p> : null}
            </div>
          ) : (
            <LoadingBlock />
          )
        ) : (
          <EmptyState icon={EyeOff} title="Assessment results hidden" description="Enable monitoring to view per-learner assessment performance." />
        )
      ) : null}
    </div>
  );
}
