import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, GraduationCap, Loader2, Moon, Sun } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ErrorBanner } from '../components/ui';

const DEMO_ACCOUNTS = [
  { email: 'naveen@learnmate.ai', label: 'Naveen Kumar', note: 'Learner in 2 classrooms, owner of 1' },
  { email: 'aisha@learnmate.ai', label: 'Aisha Rahman', note: 'Owner — Java Programming' },
  { email: 'rohit@learnmate.ai', label: 'Rohit Verma', note: 'Teacher with monitoring OFF' },
  { email: 'admin@learnmate.ai', label: 'Platform Admin', note: 'AI configuration access' },
];

export default function Login() {
  const { user, loading, login } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState('naveen@learnmate.ai');
  const [password, setPassword] = useState('LearnMate123!');
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

          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Demo accounts</p>
            <div className="mt-2 space-y-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setEmail(acc.email);
                    setPassword('LearnMate123!');
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-xs transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-800 dark:hover:border-brand-700 dark:hover:bg-brand-950/30"
                >
                  <span>
                    <span className="block font-medium text-slate-800 dark:text-slate-100">{acc.label}</span>
                    <span className="block text-slate-500 dark:text-slate-400">{acc.note}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-400">use</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">All demo accounts use the password LearnMate123!</p>
          </div>
        </div>
      </div>
    </div>
  );
}
