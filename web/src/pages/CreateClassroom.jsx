import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Palette } from 'lucide-react';
import { api } from '../lib/api';
import { ErrorBanner, Switch, cx, useToast } from '../components/ui';

const COVERS = [
  { key: 'blue', label: 'Blue', gradient: 'linear-gradient(135deg,#1e3a8a,#2563eb 45%,#38bdf8)' },
  { key: 'teal', label: 'Teal', gradient: 'linear-gradient(135deg,#064e3b,#0891b2 45%,#22d3ee)' },
  { key: 'amber', label: 'Amber', gradient: 'linear-gradient(135deg,#7c2d12,#ea580c 45%,#fbbf24)' },
  { key: 'violet', label: 'Violet', gradient: 'linear-gradient(135deg,#4c1d95,#7c3aed 45%,#c084fc)' },
  { key: 'rose', label: 'Rose', gradient: 'linear-gradient(135deg,#881337,#e11d48 45%,#fb7185)' },
  { key: 'slate', label: 'Slate', gradient: 'linear-gradient(135deg,#0f172a,#334155 50%,#64748b)' },
];

const SETTINGS = [
  { key: 'aiTutorEnabled', label: 'AI tutor', description: 'Allow learners to start personalised tutoring sessions.', default: true },
  { key: 'knowledgeGapDetection', label: 'Knowledge gap detection', description: 'Detect gaps, misconceptions and practical difficulties from evidence.', default: true },
  { key: 'adaptiveDifficulty', label: 'Adaptive scaffolding', description: 'Increase difficulty as understanding improves and fade help when independent.', default: true },
  { key: 'practicalEnabled', label: 'Practical coding exercises', description: 'Enable the Monaco editor and sandboxed code evaluation.', default: true },
  { key: 'autoAssessments', label: 'AI-recommended assessments', description: 'Allow the system to suggest optional assessments.', default: true },
  { key: 'monitoringDefault', label: 'Default teacher monitoring', description: 'New teachers start with monitoring enabled (each teacher can override).', default: true },
];

export default function CreateClassroom() {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    description: '',
    subject: '',
    joinApprovalRequired: true,
    cover: COVERS[0].gradient,
  });
  const [settings, setSettings] = useState(Object.fromEntries(SETTINGS.map((s) => [s.key, s.default])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/classrooms', {
        method: 'POST',
        body: {
          name: form.name,
          description: form.description,
          subject: form.subject,
          coverImage: form.cover,
          joinApprovalRequired: form.joinApprovalRequired,
          settings,
        },
      });
      toast.success(`Classroom created · ${res.classroom.code}`);
      navigate(`/app/classrooms/${res.classroom.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <button onClick={() => navigate(-1)} className="btn-ghost -ml-2">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Create a classroom</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          You become the primary owner. A unique classroom ID is generated automatically and can be shared with learners.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <ErrorBanner message={error} onDismiss={() => setError('')} />

        <div className="card card-pad space-y-4">
          <div>
            <label htmlFor="name" className="label">
              Classroom name
            </label>
            <input
              id="name"
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Java Programming — Section A"
              minLength={3}
              maxLength={90}
              required
            />
          </div>
          <div>
            <label htmlFor="subject" className="label">
              Subject / course
            </label>
            <input
              id="subject"
              className="input"
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="Java Programming"
              minLength={2}
              maxLength={90}
              required
            />
          </div>
          <div>
            <label htmlFor="description" className="label">
              Description
            </label>
            <textarea
              id="description"
              className="input"
              rows={3}
              maxLength={600}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What will learners study in this classroom?"
            />
          </div>
          <div>
            <span className="label flex items-center gap-1.5">
              <Palette className="h-3.5 w-3.5" /> Classroom profile image
            </span>
            <div className="flex flex-wrap gap-2">
              {COVERS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, cover: c.gradient }))}
                  className={cx(
                    'h-12 w-20 rounded-lg ring-offset-2 transition-all',
                    form.cover === c.gradient ? 'ring-2 ring-brand-500' : 'ring-1 ring-slate-200 hover:ring-slate-300 dark:ring-slate-700',
                  )}
                  style={{ background: c.gradient }}
                  aria-label={`Use ${c.label} cover`}
                  aria-pressed={form.cover === c.gradient}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="card card-pad space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Membership</h2>
          <Switch
            checked={form.joinApprovalRequired}
            onChange={(v) => setForm((f) => ({ ...f, joinApprovalRequired: v }))}
            label="Require owner approval to join"
            description="When off, anyone with the classroom ID joins immediately. When on, you approve each request."
          />
        </div>

        <div className="card card-pad space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Learning & monitoring</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              These classroom-level controls do not affect other classrooms, and never expose global AI credentials.
            </p>
          </div>
          <div className="space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {SETTINGS.map((s) => (
              <Switch
                key={s.key}
                checked={settings[s.key]}
                onChange={(v) => setSettings((prev) => ({ ...prev, [s.key]: v }))}
                label={s.label}
                description={s.description}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => navigate('/app/classrooms')} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create classroom
          </button>
        </div>
      </form>
    </div>
  );
}
