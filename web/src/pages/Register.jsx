import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, GraduationCap, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ErrorBanner } from '../components/ui';

export default function Register() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', headline: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/app" replace />;

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(form);
      navigate('/app');
    } catch (err) {
      setError(err.message || 'Could not create the account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
            <GraduationCap className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">LearnMate AI</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Create your unified account</p>
          </div>
        </div>

        <div className="card card-pad">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Create account</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            One account works for everything: learn with the AI tutor, create classrooms, and teach in others.
          </p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <ErrorBanner message={error} onDismiss={() => setError('')} />
            <div>
              <label htmlFor="name" className="label">
                Full name
              </label>
              <input id="name" className="input" value={form.name} onChange={update('name')} minLength={2} required autoComplete="name" />
            </div>
            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input id="email" type="email" className="input" value={form.email} onChange={update('email')} required autoComplete="email" />
            </div>
            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={form.password}
                onChange={update('password')}
                minLength={8}
                required
                autoComplete="new-password"
              />
              <p className="mt-1 text-[11px] text-slate-400">At least 8 characters.</p>
            </div>
            <div>
              <label htmlFor="headline" className="label">
                Headline <span className="font-normal normal-case text-slate-400">(optional)</span>
              </label>
              <input id="headline" className="input" value={form.headline} onChange={update('headline')} maxLength={120} placeholder="CSE undergraduate · learning Java" />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create account
              {!busy ? <ArrowRight className="h-4 w-4" /> : null}
            </button>
          </form>

          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            Already have an account?{' '}
            <Link to="/login" className="link font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
