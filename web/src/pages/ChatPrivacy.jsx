import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Lock, MessageSquare, ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, ErrorBanner, LoadingBlock, Switch, cx, useToast } from '../components/ui';
import { timeAgo } from '../lib/format';

export default function ChatPrivacy() {
  const { classroomId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () =>
    api(`/tutor/classrooms/${classroomId}/chat-privacy`)
      .then(setData)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  const update = async (patch) => {
    setBusy(true);
    try {
      await api(`/tutor/classrooms/${classroomId}/chat-privacy`, { method: 'PATCH', body: patch });
      toast.success('Privacy setting updated');
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <LoadingBlock />;

  const { privacy, audit } = data;
  const shared = privacy.shareWithTeachers || privacy.shareWithOwner;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to={`/app/classrooms/${classroomId}`} className="btn-ghost -ml-2">
        <ArrowLeft className="h-4 w-4" /> Back to classroom
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Chat privacy</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          You decide whether teachers in this classroom can read your AI conversations. Analytics, gaps and assessment results are
          always visible to teachers with monitoring enabled — chat content is separate.
        </p>
      </div>

      <div
        className={cx(
          'card card-pad border',
          shared ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20' : 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20',
        )}
      >
        <div className="flex items-start gap-3">
          {shared ? <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /> : <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />}
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {shared ? 'Chat history is currently shared' : 'Chat history is private'}
            </p>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{privacy.defaultNote}</p>
            {privacy.updatedAt ? <p className="mt-1 text-[11px] text-slate-400">Last changed {timeAgo(privacy.updatedAt)}</p> : null}
          </div>
        </div>
      </div>

      <div className="card card-pad space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <MessageSquare className="h-4 w-4 text-slate-400" /> Permissions for this classroom
        </h2>
        <div className="space-y-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Switch
            checked={privacy.shareWithTeachers}
            onChange={(v) => update({ shareWithTeachers: v })}
            disabled={busy}
            label="Allow teachers to read my chat history"
            description="Applies to co-owners and teachers with monitoring enabled. Revoking takes effect immediately."
          />
          <Switch
            checked={privacy.shareWithOwner}
            onChange={(v) => update({ shareWithOwner: v })}
            disabled={busy}
            label="Allow the classroom owner to read my chat history"
            description="The primary owner can have a separate permission from other teachers."
          />
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
          <p className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
            <Lock className="h-3.5 w-3.5" /> Enforced on the server
          </p>
          <p className="mt-1">
            Access is checked on every request, not just in the interface. Every grant, revocation and denied access attempt is
            recorded in the audit trail below.
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <Clock className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Permission history</h2>
        </div>
        {audit.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No permission changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs">
                <span className="flex items-center gap-2">
                  <Badge tone={a.action === 'grant' ? 'warning' : a.action === 'revoke' ? 'success' : a.action === 'access_denied' ? 'danger' : 'brand'}>
                    {a.action.replace('_', ' ')}
                  </Badge>
                  <span className="text-slate-500 dark:text-slate-400">{a.scope?.startsWith('{') ? 'chat visibility' : a.scope}</span>
                </span>
                <span className="text-slate-400">{timeAgo(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
