import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, GraduationCap, Loader2, Moon, Sun } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ErrorBanner } from '../components/ui';

export default function Login() {
  const { user, loading, login } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  // Empty, not pre-filled: the form should not arrive holding someone's
  // credentials.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/app" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigate('/app');
    } catch (err) {
      setError(err.message || 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-slate-900 p-10 text-white lg:flex">
        <div className="absolute inset-0 opacity-90" style={{ background: 'radial-gradient(circle at 20% 20%, #1d4ed8 0%, transparent 45%), radial-gradient(circle at 80% 70%, #0e7490 0%, transparent 45%)' }} />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <GraduationCap className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold">LearnMate AI</span>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            One-to-one tutoring that adapts to what each learner actually understands.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            LearnMate detects knowledge gaps, misconceptions and practical difficulties from real evidence — quizzes,
            explanations and code — then adapts teaching, scaffolding and assessment for every classroom separately.
          </p>
          <dl className="mt-8 grid grid-cols-2 gap-4 text-sm">
            {[
              ['Syllabus-anchored', 'Tutoring stays on the classroom syllabus'],
              ['Evidence-based', 'Self-reported understanding is never accepted'],
              ['Privacy-first', 'Chat history stays private unless shared'],
              ['Classroom-scoped', 'Separate profile for every classroom'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
                <dt className="font-medium text-white">{title}</dt>
                <dd className="mt-0.5 text-xs text-slate-300">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="relative text-xs text-slate-400">Unified accounts · classroom-specific permissions</p>
      </div>

      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
                <GraduationCap className="h-5 w-5" />
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">LearnMate AI</span>
            </div>
            <button onClick={toggle} className="btn-ghost p-2" aria-label="Toggle theme">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            New here?{' '}
            <Link to="/register" className="link font-medium">
              Create an account
            </Link>
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <ErrorBanner message={error} onDismiss={() => setError('')} />
            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sign in
              {!busy ? <ArrowRight className="h-4 w-4" /> : null}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
