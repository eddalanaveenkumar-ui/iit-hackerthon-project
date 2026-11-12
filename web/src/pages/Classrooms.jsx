import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, KeyRound, Loader2, Plus, Search, Users } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBanner, LoadingBlock, Modal, Tabs, cx, useToast } from '../components/ui';
import { coverStyle, levelStyles, roleLabels, roleStyles, timeAgo } from '../lib/format';

export default function Classrooms() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [joinOpen, setJoinOpen] = useState(false);

  const load = () => api('/classrooms').then(setData).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.classrooms;
    if (tab === 'created') list = list.filter((c) => c.myRole === 'owner');
    if (tab === 'teaching') list = list.filter((c) => ['co_owner', 'teacher'].includes(c.myRole));
    if (tab === 'joined') list = list.filter((c) => c.myRole === 'student');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
    }
    return list;
  }, [data, tab, search]);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <LoadingBlock rows={4} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">My classrooms</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            One account, many roles. Create classrooms, join with an ID, and teach in someone else&apos;s classroom.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setJoinOpen(true)} className="btn-secondary">
            <KeyRound className="h-4 w-4" /> Join with ID
          </button>
          <Link to="/app/classrooms/new" className="btn-primary">
            <Plus className="h-4 w-4" /> New classroom
          </Link>
        </div>
      </div>

      {data.pendingRequests.length ? (
        <div className="card card-pad border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Pending join requests</p>
          <ul className="mt-2 space-y-1.5">
            {data.pendingRequests.map((p) => (
              <li key={p.classroomId} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-700 dark:text-slate-200">
                  {p.name} <span className="font-mono text-xs text-slate-400">{p.code}</span>
                </span>
                <Badge tone="warning">Awaiting approval</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'all', label: 'All', count: data.classrooms.length },
            { key: 'created', label: 'Created', count: data.created.length },
            { key: 'teaching', label: 'Teaching', count: data.teaching.length },
            { key: 'joined', label: 'Joined', count: data.classrooms.filter((c) => c.myRole === 'student').length },
          ]}
          className="flex-1"
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input w-56 pl-8" placeholder="Search classrooms" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No classrooms in this view"
          description="Create a classroom to start teaching, or join an existing one with its classroom ID."
          action={
            <div className="flex gap-2">
              <button onClick={() => setJoinOpen(true)} className="btn-secondary btn-sm">
                Join with ID
              </button>
              <Link to="/app/classrooms/new" className="btn-primary btn-sm">
                Create classroom
              </Link>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <ClassroomCard key={c.id} classroom={c} />
          ))}
        </div>
      )}

      <JoinModal open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={load} />
    </div>
  );
}

function ClassroomCard({ classroom: c }) {
  return (
    <Link to={`/app/classrooms/${c.id}`} className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-pop">
      <div className="relative h-24" style={coverStyle(c.coverImage)}>
        <span className={cx('badge absolute right-2 top-2 shadow-sm', roleStyles[c.myRole])}>{roleLabels[c.myRole]}</span>
        <span className="absolute bottom-2 left-3 font-mono text-[11px] text-white/90">{c.code}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">{c.name}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{c.subject}</p>
        <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{c.description || 'No description yet.'}</p>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span className={cx('badge', levelStyles[c.knowledgeLevel] || levelStyles.not_started)}>{c.knowledgeLevel?.replace('_', ' ')}</span>
          <span>{c.stats?.memberCount ?? 0} learners</span>
          {c.myRole !== 'student' ? <span>· {c.stats?.pendingRequests ?? 0} pending</span> : null}
        </div>
        <div className="mt-auto flex items-center justify-between pt-3 text-[11px] text-slate-400">
          <span>{timeAgo(c.lastActivityAt || c.joinedAt)}</span>
          <span className="inline-flex items-center gap-1 font-medium text-brand-600 dark:text-brand-400">
            Open <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function JoinModal({ open, onClose, onJoined }) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const toast = useToast();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/classrooms/join', { method: 'POST', body: { code: code.trim(), message } });
      setResult(res);
      onJoined();
      if (res.status === 'joined') {
        toast.success(`Joined ${res.classroom.name}`);
        navigate(`/app/classrooms/${res.classroom.id}`);
        onClose();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Join a classroom" description="Enter the classroom ID shared by the owner (for example LM-7KQ4-9XZ2).">
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} onDismiss={() => setError('')} />
        {result ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {result.message}
          </div>
        ) : null}
        <div>
          <label htmlFor="classcode" className="label">
            Classroom ID
          </label>
          <input
            id="classcode"
            className="input font-mono uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="LM-XXXX-XXXX"
            required
          />
        </div>
        <div>
          <label htmlFor="joinmsg" className="label">
            Message to the owner <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <textarea id="joinmsg" className="input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={400} />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Classrooms with approval enabled will send a request to the owner. Open classrooms grant access immediately.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !code.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Join
          </button>
        </div>
      </form>
    </Modal>
  );
}
