import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ClipboardList,
  Copy,
  FileText,
  GraduationCap,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { Avatar, Badge, EmptyState, ErrorBanner, LoadingBlock, Modal, Spinner, Switch, Tabs, cx, useToast } from '../components/ui';
import { coverStyle, levelStyles, roleLabels, roleStyles, severityStyles, timeAgo } from '../lib/format';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'syllabus', label: 'Syllabus' },
  { key: 'members', label: 'Members' },
  { key: 'settings', label: 'Settings' },
  { key: 'audit', label: 'Audit log' },
];

export default function ClassroomDetail() {
  const { classroomId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const toast = useToast();
  const navigate = useNavigate();

  const load = () =>
    api(`/classrooms/${classroomId}`)
      .then(setData)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <button onClick={() => navigate('/app/classrooms')} className="btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Back to classrooms
        </button>
      </div>
    );
  }
  if (!data) return <LoadingBlock rows={5} />;

  const { classroom, membership, owner } = data;
  const isOwner = membership.role === 'owner';
  const permissions = membership.effectivePermissions || {};
  const isStaff = ['owner', 'co_owner', 'teacher'].includes(membership.role);
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(classroom.code);
      toast.success('Classroom ID copied');
    } catch {
      toast.error('Could not copy — select the ID manually');
    }
  };

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/app/classrooms')} className="btn-ghost -ml-2">
        <ArrowLeft className="h-4 w-4" /> Classrooms
      </button>

      <div className="card overflow-hidden">
        <div className="h-28" style={coverStyle(classroom.coverImage)} />
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{classroom.name}</h1>
              <span className={cx('badge', roleStyles[membership.role])}>{roleLabels[membership.role]}</span>
              {classroom.joinApprovalRequired ? <Badge tone="warning">Approval required</Badge> : <Badge tone="success">Open enrolment</Badge>}
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {classroom.subject} · Owner {owner?.name} · {classroom.stats?.memberCount ?? 0} learners
            </p>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{classroom.description || 'No description provided.'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={copyCode} className="btn-secondary font-mono text-xs">
              <Copy className="h-3.5 w-3.5" /> {classroom.code}
            </button>
            {isStaff && permissions.monitorStudents !== false ? (
              <Link to={`/app/classrooms/${classroomId}/monitor`} className="btn-secondary">
                <Users className="h-4 w-4" /> Monitoring
              </Link>
            ) : null}
            <Link to={`/app/start?classroom=${classroomId}`} className="btn-primary">
              <Sparkles className="h-4 w-4" /> Start learning
            </Link>
          </div>
        </div>
      </div>

      {!isStaff ? (
        <div className="card card-pad flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">You are learning in this classroom</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Your learning profile here is separate from every other classroom.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to={`/app/classrooms/${classroomId}/profile/${data.membership.userId}`} className="btn-secondary btn-sm">
              My classroom profile
            </Link>
            <Link to={`/app/classrooms/${classroomId}/privacy`} className="btn-secondary btn-sm">
              Chat privacy
            </Link>
          </div>
        </div>
      ) : null}

      <Tabs tabs={isStaff ? TABS : TABS.filter((t) => ['overview', 'syllabus', 'members'].includes(t.key))} value={tab} onChange={setTab} />

      {tab === 'overview' ? <Overview classroomId={classroomId} classroom={classroom} isStaff={isStaff} /> : null}
      {tab === 'syllabus' ? <Syllabus classroomId={classroomId} canEdit={isOwner || permissions.manageSyllabus} /> : null}
      {tab === 'members' ? (
        <Members classroomId={classroomId} isOwner={isOwner} canManage={data.canManage || isOwner || permissions.manageMembers} />
      ) : null}
      {tab === 'settings' && isOwner ? <Settings classroom={classroom} onSaved={load} /> : null}
      {tab === 'audit' && isOwner ? <AuditLog classroomId={classroomId} /> : null}
    </div>
  );
}

function Overview({ classroomId, classroom, isStaff }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/intelligence/classrooms/${classroomId}/overview`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [classroomId]);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <LoadingBlock />;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card card-pad lg:col-span-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Classroom status</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Learners', data.counts.students],
            ['Teaching staff', data.counts.teachers],
            ['Concepts', data.counts.concepts],
            ['Sessions', data.counts.sessions],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
              <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">Average mastery</p>
            <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
              {data.analytics.averageMastery === null ? 'No evidence yet' : `${data.analytics.averageMastery}%`}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">Assessment average</p>
            <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
              {data.analytics.assessmentAverage === null ? '—' : `${data.analytics.assessmentAverage}%`}
            </p>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Syllabus</h2>
        {data.syllabus ? (
          <div className="mt-2 space-y-2 text-sm">
            <p className="font-medium text-slate-800 dark:text-slate-100">{data.syllabus.title}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Version {data.syllabus.version} · source: {data.syllabus.source} · {data.counts.concepts} concepts
            </p>
            {data.syllabus.documents?.length ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {data.syllabus.materialStats?.documents || 0} document(s), {data.syllabus.materialStats?.chunks || 0} indexed chunks
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            No syllabus yet. {isStaff ? 'Add one in the Syllabus tab so the AI tutor has a reference.' : 'Ask the classroom owner to add one.'}
          </p>
        )}
        {isStaff ? (
          <div className="mt-4 space-y-2">
            <Link to={`/app/classrooms/${classroomId}/monitor`} className="btn-primary w-full btn-sm">
              <Users className="h-3.5 w-3.5" /> Student monitoring
            </Link>
            <Link to={`/app/classrooms/${classroomId}/monitor?tab=assessment`} className="btn-secondary w-full btn-sm">
              <ClipboardList className="h-3.5 w-3.5" /> Assessment results
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Syllabus({ classroomId, canEdit }) {
  const [tree, setTree] = useState(null);
  const [error, setError] = useState('');
  const [openModal, setOpenModal] = useState(null);
  const toast = useToast();

  const load = () =>
    api(`/syllabus/${classroomId}`)
      .then(setTree)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  if (error) return <ErrorBanner message={error} />;
  if (!tree) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            {tree.syllabus ? tree.syllabus.title : 'No syllabus'}
          </h2>
          {tree.syllabus ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Version {tree.syllabus.version} · source {tree.syllabus.source} · updated {timeAgo(tree.syllabus.updatedAt)}
              {tree.syllabus.materialStats?.chunks ? ` · ${tree.syllabus.materialStats.chunks} indexed chunks` : ''}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <button onClick={() => setOpenModal('manual')} className="btn-secondary btn-sm">
              <Plus className="h-3.5 w-3.5" /> Create manually
            </button>
            <button onClick={() => setOpenModal('upload')} className="btn-primary btn-sm">
              <Upload className="h-3.5 w-3.5" /> Upload document
            </button>
          </div>
        ) : null}
      </div>

      {tree.subjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No syllabus structure yet"
          description={
            canEdit
              ? 'Upload a PDF, DOCX or PPTX to extract the syllabus automatically, or build the subject → unit → concept tree by hand.'
              : 'The classroom owner has not added a syllabus yet.'
          }
          action={
            canEdit ? (
              <button onClick={() => setOpenModal('manual')} className="btn-primary btn-sm">
                Create syllabus
              </button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {tree.subjects.map((subject) => (
            <div key={subject.id} className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: subject.color || '#2563eb' }} />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{subject.name}</p>
                <span className="text-xs text-slate-400">
                  {subject.units.length} units · {subject.units.reduce((a, u) => a + u.concepts.length, 0)} concepts
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {subject.units.map((unit) => (
                  <details key={unit.id} className="group px-4 py-3" open>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{unit.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {unit.concepts.length} concepts{unit.description ? ` · ${unit.description}` : ''}
                        </p>
                      </div>
                      <span className="text-xs text-slate-400 group-open:hidden">expand</span>
                    </summary>
                    <ul className="mt-2.5 space-y-1.5 pl-1">
                      {unit.concepts.map((concept) => (
                        <li key={concept.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-700 dark:text-slate-200">{concept.name}</p>
                            {concept.objectives?.length ? (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">{concept.objectives.join(' · ')}</p>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-[11px] text-slate-400">{concept.estimatedMinutes}m</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {openModal === 'manual' ? <ManualSyllabusModal classroomId={classroomId} onClose={() => setOpenModal(null)} onSaved={load} /> : null}
      {openModal === 'upload' ? (
        <UploadModal
          classroomId={classroomId}
          onClose={() => setOpenModal(null)}
          onSaved={() => {
            load();
            toast.success('Syllabus saved from document');
          }}
        />
      ) : null}
    </div>
  );
}

function ManualSyllabusModal({ classroomId, onClose, onSaved }) {
  const [title, setTitle] = useState('Course Syllabus');
  const [subjects, setSubjects] = useState([
    {
      name: '',
      units: [{ name: '', concepts: [{ name: '', description: '', objectives: '' }] }],
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const update = (fn) => setSubjects((prev) => fn(structuredClone(prev)));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = {
        title,
        subjects: subjects.map((s) => ({
          name: s.name,
          units: s.units.map((u) => ({
            name: u.name,
            concepts: u.concepts
              .filter((c) => c.name.trim())
              .map((c) => ({
                name: c.name,
                description: c.description,
                objectives: c.objectives ? c.objectives.split(',').map((o) => o.trim()).filter(Boolean) : [],
              })),
          })),
        })),
      };
      await api(`/syllabus/${classroomId}/manual`, { method: 'POST', body: payload });
      toast.success('Syllabus created');
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title="Create syllabus manually"
      description="Subject → Unit → Concept. The AI tutor will use this structure as its primary teaching reference."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={submit} className="btn-primary" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save syllabus
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner message={error} onDismiss={() => setError('')} />
        <div>
          <label className="label">Syllabus title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        {subjects.map((subject, si) => (
          <div key={si} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <input
                className="input"
                placeholder="Subject name"
                value={subject.name}
                onChange={(e) => update((d) => ((d[si].name = e.target.value), d))}
              />
              {subjects.length > 1 ? (
                <button className="btn-ghost p-2 text-rose-600" onClick={() => update((d) => (d.splice(si, 1), d))} aria-label="Remove subject">
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            {subject.units.map((unit, ui) => (
              <div key={ui} className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/40">
                <div className="flex items-center gap-2">
                  <input
                    className="input"
                    placeholder="Unit name (e.g. Unit 1 – Introduction)"
                    value={unit.name}
                    onChange={(e) => update((d) => ((d[si].units[ui].name = e.target.value), d))}
                  />
                  <button
                    className="btn-ghost p-2 text-rose-600"
                    onClick={() => update((d) => (d[si].units.splice(ui, 1), d))}
                    aria-label="Remove unit"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {unit.concepts.map((concept, ci) => (
                    <div key={ci} className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex gap-2">
                        <input
                          className="input"
                          placeholder="Concept name"
                          value={concept.name}
                          onChange={(e) => update((d) => ((d[si].units[ui].concepts[ci].name = e.target.value), d))}
                        />
                        <button
                          className="btn-ghost p-2 text-rose-600"
                          onClick={() => update((d) => (d[si].units[ui].concepts.splice(ci, 1), d))}
                          aria-label="Remove concept"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <textarea
                        className="input mt-2 text-xs"
                        rows={2}
                        placeholder="Syllabus description — the AI tutor treats this as the primary reference"
                        value={concept.description}
                        onChange={(e) => update((d) => ((d[si].units[ui].concepts[ci].description = e.target.value), d))}
                      />
                      <input
                        className="input mt-2 text-xs"
                        placeholder="Learning objectives (comma separated)"
                        value={concept.objectives}
                        onChange={(e) => update((d) => ((d[si].units[ui].concepts[ci].objectives = e.target.value), d))}
                      />
                    </div>
                  ))}
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => update((d) => (d[si].units[ui].concepts.push({ name: '', description: '', objectives: '' }), d))}
                  >
                    <Plus className="h-3 w-3" /> Concept
                  </button>
                </div>
              </div>
            ))}
            <button
              className="btn-secondary btn-sm mt-2"
              onClick={() => update((d) => (d[si].units.push({ name: '', concepts: [{ name: '', description: '', objectives: '' }] }), d))}
            >
              <Plus className="h-3 w-3" /> Unit
            </button>
          </div>
        ))}
        <button
          className="btn-secondary btn-sm"
          onClick={() => setSubjects((s) => [...s, { name: '', units: [{ name: '', concepts: [{ name: '', description: '', objectives: '' }] }] }])}
        >
          <Plus className="h-3 w-3" /> Subject
        </button>
      </div>
    </Modal>
  );
}

function UploadModal({ classroomId, onClose, onSaved }) {
  const [files, setFiles] = useState([]);
  const [subject, setSubject] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (isPreview) => {
    if (!files.length) return setError('Choose at least one PDF, DOCX, PPTX, TXT or MD file');
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      if (subject) fd.append('subject', subject);
      if (isPreview) fd.append('preview', 'true');
      const res = await api(`/syllabus/${classroomId}/upload`, { method: 'POST', body: fd });
      if (isPreview) setPreview(res);
      else {
        onSaved();
        onClose();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title="Upload syllabus document"
      description="PDF, DOCX or PPTX (up to 15 MB each, 5 files). Text is extracted and parsed into units and concepts for review."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          {preview ? (
            <button onClick={() => send(false)} className="btn-primary" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save parsed syllabus
            </button>
          ) : (
            <button onClick={() => send(true)} className="btn-primary" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Extract & preview
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <ErrorBanner message={error} onDismiss={() => setError('')} />
        <div>
          <label className="label">Document(s)</label>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.pptx,.txt,.md"
            onChange={(e) => {
              setFiles(Array.from(e.target.files || []));
              setPreview(null);
            }}
            className="block w-full rounded-lg border border-dashed border-slate-300 px-3 py-6 text-sm text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white dark:border-slate-700 dark:text-slate-400"
          />
          {files.length ? <p className="mt-1 text-xs text-slate-500">{files.map((f) => f.name).join(', ')}</p> : null}
        </div>
        <div>
          <label className="label">Subject hint (optional)</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Algorithms" />
        </div>

        {preview ? (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Extracted structure</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {preview.files.map((f) => `${f.filename}${f.error ? ` (${f.error})` : ` · ${f.words} words`}`).join(' · ')}
            </p>
            {preview.syllabus.units.map((unit, i) => (
              <div key={i} className="rounded border border-slate-100 p-2 dark:border-slate-800">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{unit.name}</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
                  {unit.concepts.map((c, j) => (
                    <li key={j}>{c.name}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Members({ classroomId, isOwner, canManage }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState([]);
  const toast = useToast();

  const load = async () => {
    try {
      const res = await api(`/classrooms/${classroomId}/members`);
      setData(res);
      const overview = await api(`/classrooms/${classroomId}`);
      setPending(overview.joinRequests || []);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  const decide = async (id, action) => {
    try {
      await api(`/classrooms/${classroomId}/join-requests/${id}`, { method: 'POST', body: { action } });
      toast.success(action === 'approve' ? 'Member approved' : 'Request rejected');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const setMonitoring = async (userId, value) => {
    try {
      await api(`/classrooms/${classroomId}/teachers/${userId}/monitoring`, { method: 'PATCH', body: { monitoringEnabled: value } });
      toast.success(`Monitoring ${value ? 'enabled' : 'disabled'}`);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const setRole = async (userId, role) => {
    try {
      await api(`/classrooms/${classroomId}/members/${userId}`, { method: 'PATCH', body: { role } });
      toast.success('Role updated');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const remove = async (userId) => {
    if (!window.confirm('Remove this member from the classroom? Their learning records are kept.')) return;
    try {
      await api(`/classrooms/${classroomId}/members/${userId}`, { method: 'DELETE' });
      toast.success('Member removed');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      {pending.length ? (
        <div className="card card-pad">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Join requests ({pending.length})</h2>
          <ul className="mt-3 space-y-2">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-2.5 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Avatar name={r.name} color={r.avatarColor} size={30} />
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {r.email} · {timeAgo(r.createdAt)}
                    </p>
                    {r.message ? <p className="mt-0.5 text-xs italic text-slate-500 dark:text-slate-400">“{r.message}”</p> : null}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => decide(r.id, 'approve')} className="btn-primary btn-sm">
                    Approve
                  </button>
                  <button onClick={() => decide(r.id, 'reject')} className="btn-secondary btn-sm">
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Members ({data.members.length})</h2>
          {canManage || isOwner ? (
            <button onClick={() => setAddOpen(true)} className="btn-primary btn-sm">
              <UserPlus className="h-3.5 w-3.5" /> Add member
            </button>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Monitoring</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.membershipId}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Avatar name={m.name} color={m.avatarColor} size={28} />
                      <div>
                        <p className="font-medium text-slate-800 dark:text-slate-100">
                          {m.name} {m.isMe ? <span className="text-xs text-slate-400">(you)</span> : null}
                        </p>
                        {m.email ? <p className="text-xs text-slate-500 dark:text-slate-400">{m.email}</p> : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    {isOwner && m.role !== 'owner' ? (
                      <select className="input py-1 text-xs" value={m.role} onChange={(e) => setRole(m.userId, e.target.value)}>
                        <option value="student">Learner</option>
                        <option value="teacher">Teacher</option>
                        <option value="co_owner">Co-owner</option>
                      </select>
                    ) : (
                      <span className={cx('badge', roleStyles[m.role])}>{roleLabels[m.role]}</span>
                    )}
                  </td>
                  <td>
                    {m.monitoringEnabled === null || m.role === 'student' ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <Switch
                        checked={Boolean(m.monitoringEnabled)}
                        onChange={(v) => setMonitoring(m.userId, v)}
                        disabled={!isOwner && !m.isMe}
                        label=""
                      />
                    )}
                  </td>
                  <td className="text-xs text-slate-500 dark:text-slate-400">{timeAgo(m.joinedAt)}</td>
                  <td className="text-right">
                    {canManage && m.role !== 'owner' && !m.isMe ? (
                      <button onClick={() => remove(m.userId)} className="btn-ghost btn-sm text-rose-600">
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {addOpen ? <AddMemberModal classroomId={classroomId} isOwner={isOwner} onClose={() => setAddOpen(false)} onSaved={load} /> : null}
    </div>
  );
}

function AddMemberModal({ classroomId, isOwner, onClose, onSaved }) {
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState('student');
  const [monitoring, setMonitoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/classrooms/${classroomId}/members`, {
        method: 'POST',
        body: { identifier, role, monitoringEnabled: role === 'student' ? undefined : monitoring },
      });
      toast.success('Member added');
      onSaved();
      onClose();
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
      title="Add a member"
      description="Add an existing LearnMate user by email. Teaching roles require the primary owner."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={submit} className="btn-primary" disabled={busy || identifier.length < 3}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add member
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorBanner message={error} onDismiss={() => setError('')} />
        <div>
          <label className="label">Email address</label>
          <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="priya@learnmate.ai" />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="student">Learner</option>
            {isOwner ? <option value="teacher">Teacher</option> : null}
            {isOwner ? <option value="co_owner">Co-owner</option> : null}
          </select>
        </div>
        {role !== 'student' ? (
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <Switch
              checked={monitoring}
              onChange={setMonitoring}
              label="Monitoring enabled"
              description="Each teacher has an independent monitoring switch. Turning it off hides student profiles, analytics and chat for that teacher only."
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Settings({ classroom, onSaved }) {
  const [form, setForm] = useState({
    name: classroom.name,
    description: classroom.description,
    subject: classroom.subject,
    joinApprovalRequired: classroom.joinApprovalRequired,
  });
  const [settings, setSettings] = useState(classroom.settings || {});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async () => {
    setBusy(true);
    try {
      await api(`/classrooms/${classroom.id}`, { method: 'PATCH', body: { ...form, settings } });
      toast.success('Classroom updated');
      onSaved();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const TOGGLES = [
    ['aiTutorEnabled', 'AI tutor', 'Personalised tutoring sessions'],
    ['knowledgeGapDetection', 'Knowledge gap detection', 'Detect gaps and misconceptions from evidence'],
    ['adaptiveDifficulty', 'Adaptive scaffolding', 'Adjust difficulty and fade assistance'],
    ['practicalEnabled', 'Practical exercises', 'Sandboxed coding practice'],
    ['autoAssessments', 'AI-recommended assessments', 'Suggest optional assessments'],
    ['allowStudentChat', 'Learner chat with tutor', 'Allow learners to message the tutor'],
    ['monitoringDefault', 'Default monitoring for new teachers', 'Each teacher can override'],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card card-pad space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Classroom details</h2>
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="label">Subject</label>
          <input className="input" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <Switch
          checked={form.joinApprovalRequired}
          onChange={(v) => setForm((f) => ({ ...f, joinApprovalRequired: v }))}
          label="Require approval to join"
          description="Turning this off lets anyone with the classroom ID join immediately."
        />
        <button onClick={save} className="btn-primary w-full" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save changes
        </button>
      </div>

      <div className="card card-pad space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Learning features</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Classroom-level controls. Global AI provider settings remain administrator-only.
          </p>
        </div>
        <div className="space-y-3.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          {TOGGLES.map(([key, label, description]) => (
            <Switch
              key={key}
              checked={settings[key] !== false}
              onChange={(v) => setSettings((s) => ({ ...s, [key]: v }))}
              label={label}
              description={description}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AuditLog({ classroomId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/classrooms/${classroomId}/audit`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [classroomId]);
  if (error) return <ErrorBanner message={error} />;
  if (!data) return <LoadingBlock />;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {data.logs.map((l) => (
              <tr key={l.id}>
                <td className="font-mono text-xs">{l.action}</td>
                <td>{l.actor}</td>
                <td className="max-w-[220px] truncate text-xs text-slate-500">{l.target || '—'}</td>
                <td className="text-xs text-slate-500">{timeAgo(l.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.logs.length === 0 ? <p className="p-4 text-sm text-slate-500">No audit entries yet.</p> : null}
    </div>
  );
}
