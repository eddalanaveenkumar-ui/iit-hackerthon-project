import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Brain, Gauge, Lock, MessageSquare, ShieldCheck, Target, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { Avatar, Badge, ErrorBanner, LoadingBlock, ProgressBar, StatCard, Tabs, cx } from '../components/ui';
import { ConceptMasteryBar, MasteryTrendChart } from '../components/charts';
import { categoryLabels, categoryStyles, levelStyles, masteryColor, severityStyles, timeAgo } from '../lib/format';

export default function StudentProfile() {
  const { classroomId, userId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [chat, setChat] = useState(null);
  const [chatError, setChatError] = useState('');

  useEffect(() => {
    api(`/intelligence/classrooms/${classroomId}/students/${userId}/profile`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [classroomId, userId]);

  const loadChat = async () => {
    setChatError('');
    try {
      const res = await api(`/tutor/classrooms/${classroomId}/students/${userId}/chat`);
      setChat(res);
    } catch (e) {
      setChatError(e.message);
    }
  };

  useEffect(() => {
    if (tab === 'chat' && data && !data.isSelf) loadChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, data]);

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <Link to={`/app/classrooms/${classroomId}`} className="btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>
    );
  }
  if (!data) return <LoadingBlock rows={5} />;

  const masteryChart = data.mastery.slice(0, 9).map((m) => ({
    label: m.conceptName.length > 20 ? `${m.conceptName.slice(0, 19)}…` : m.conceptName,
    score: m.score,
    color: masteryColor(m.score),
  }));

  return (
    <div className="space-y-5">
      <Link to={data.isSelf ? '/app/progress' : `/app/classrooms/${classroomId}/monitor`} className="btn-ghost -ml-2">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <div className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Avatar name={data.student.name} color={data.student.avatarColor} size={48} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{data.student.name}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {data.classroom.name} · {data.classroom.subject}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={cx('badge', levelStyles[data.profile.knowledgeLevel])}>{data.profile.knowledgeLevel}</span>
                <Badge tone="neutral">{data.profile.learningSpeed?.label} learner</Badge>
                {data.isSelf ? <Badge tone="brand">This is your profile</Badge> : <Badge tone="violet">Teacher view</Badge>}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
            <p className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
              <MessageSquare className="h-3.5 w-3.5" /> Chat history
            </p>
            <p className="mt-0.5 text-slate-500 dark:text-slate-400">
              {data.chatPrivacy.shareWithTeachers ? 'Shared by the student' : 'Private — not shared'}
            </p>
            {data.chatPrivacy.updatedAt ? <p className="text-[10px] text-slate-400">updated {timeAgo(data.chatPrivacy.updatedAt)}</p> : null}
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Learning records in this classroom are completely separate from the student&apos;s other classrooms.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sessions" value={data.profile.stats?.sessions || 0} sub={`${data.profile.stats?.totalStudyMinutes || 0} minutes`} icon={Brain} />
        <StatCard label="Independence" value={`${data.profile.independence?.score ?? 0}%`} sub={`${data.profile.independence?.hintsPerSession ?? 0} hints/session`} icon={Target} tone="success" />
        <StatCard label="Learning speed" value={<span className="capitalize">{data.profile.learningSpeed?.label}</span>} sub={`Score ${data.profile.learningSpeed?.score ?? 0}`} icon={Gauge} tone="violet" />
        <StatCard label="Assessment average" value={data.assessmentAverage === null ? '—' : `${data.assessmentAverage}%`} sub={`${data.profile.stats?.assessmentsTaken || 0} taken`} icon={TrendingUp} tone="warning" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'weaknesses', label: 'Weaknesses', count: data.weaknesses.length },
          { key: 'mastery', label: 'Concept mastery' },
          { key: 'assessments', label: 'Assessments' },
          ...(data.isSelf ? [] : [{ key: 'chat', label: 'Chat history' }]),
        ]}
      />

      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card card-pad lg:col-span-2">
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Improvement over time</h2>
            <MasteryTrendChart data={data.profile.timeline || []} />
          </div>
          <div className="card card-pad">
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Activity</h2>
            {data.activity.length ? (
              <ol className="relative space-y-2.5 border-l border-slate-200 pl-3 dark:border-slate-800">
                {data.activity.slice(0, 8).map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[17px] top-1.5 h-1.5 w-1.5 rounded-full bg-brand-500 ring-2 ring-white dark:ring-slate-900" />
                    <p className="text-xs text-slate-700 dark:text-slate-200">{a.title}</p>
                    <p className="text-[10px] text-slate-400">{timeAgo(a.at)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">No activity yet.</p>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'weaknesses' ? (
        <div className="card overflow-hidden">
          {data.weaknesses.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">No open weaknesses for this classroom.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.weaknesses.map((w) => (
                <li key={w.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cx('badge border', categoryStyles[w.category])}>{categoryLabels[w.category]}</span>
                    <span className={cx('badge border', severityStyles[w.severity])}>{w.severity}</span>
                    <span className="text-xs text-slate-500">{w.conceptName}</span>
                    <span className="text-[11px] text-slate-400">· confidence {Math.round(w.confidence * 100)}%</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{w.description}</p>
                  {w.evidence?.length ? (
                    <div className="mt-1.5 space-y-1">
                      {w.evidence.map((e, i) => (
                        <p key={i} className="rounded bg-slate-50 px-2 py-1 text-[11px] italic text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                          “{String(e.excerpt).slice(0, 220)}”
                        </p>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-1 text-[11px] text-slate-400">
                    seen {w.occurrences}× · first {timeAgo(w.firstDetectedAt)} · last {timeAgo(w.lastDetectedAt)} · {w.status}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === 'mastery' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card card-pad">
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Concept mastery</h2>
            <ConceptMasteryBar data={masteryChart} height={Math.max(200, masteryChart.length * 34)} />
          </div>
          <div className="card overflow-hidden">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Concept</th>
                  <th>Level</th>
                  <th>Score</th>
                  <th>Evidence</th>
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
                      <div className="flex items-center gap-1.5">
                        <ProgressBar value={m.score} className="w-14" />
                        <span className="text-xs">{m.score}%</span>
                      </div>
                    </td>
                    <td className="text-xs">{m.evidenceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'assessments' ? (
        <div className="card overflow-hidden">
          {data.assessments.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">No assessments taken yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.assessments.map((a) => (
                <li key={a.id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {a.score}/{a.maxScore} · {a.percentage}%
                    </span>
                    <span className="text-xs text-slate-400">{timeAgo(a.submittedAt)}</span>
                  </div>
                  <ProgressBar value={a.percentage} className="mt-1" tone={a.percentage >= 70 ? 'success' : a.percentage >= 40 ? 'warning' : 'danger'} />
                  {a.aiFeedback?.nextSteps?.length ? (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Next: {a.aiFeedback.nextSteps[0]}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === 'chat' ? (
        <div className="card card-pad">
          {chatError ? (
            <div className="flex items-start gap-3 rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Chat history is private</p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{chatError}</p>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  The student controls this from their classroom privacy page. Analytics, knowledge gaps and assessment results remain
                  available to you.
                </p>
                <Link to={`/app/classrooms/${classroomId}/monitor`} className="btn-secondary btn-sm mt-2">
                  <ShieldCheck className="h-3.5 w-3.5" /> View analytics instead
                </Link>
              </div>
            </div>
          ) : !chat ? (
            <LoadingBlock />
          ) : chat.sessions.length === 0 ? (
            <p className="text-sm text-slate-500">No chat sessions recorded.</p>
          ) : (
            <div className="space-y-4">
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                The student has granted chat access for this classroom. This view is audited.
              </p>
              {chat.sessions.map((s) => (
                <div key={s.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{s.conceptName}</p>
                    <span className="text-[11px] text-slate-400">
                      {s.mode} · {timeAgo(s.startedAt)} · {s.messageCount} messages
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {s.messages.map((m) => (
                      <li key={m.id} className={cx('rounded-lg px-2.5 py-1.5 text-xs', m.role === 'user' ? 'bg-brand-50 dark:bg-brand-950/30' : 'bg-slate-50 dark:bg-slate-800/50')}>
                        <span className="font-semibold text-slate-600 dark:text-slate-300">{m.role === 'user' ? 'Student' : 'Tutor'}: </span>
                        <span className="text-slate-700 dark:text-slate-200">{String(m.content).slice(0, 500)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
