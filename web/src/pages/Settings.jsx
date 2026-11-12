import { useState } from 'react';
import { Loader2, Palette, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Avatar, ErrorBanner, Switch, cx, useToast } from '../components/ui';

const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#059669', '#4f46e5', '#b45309'];

export default function Settings() {
  const { user, updateProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const [form, setForm] = useState({ name: user?.name || '', headline: user?.headline || '', avatarColor: user?.avatarColor || COLORS[0] });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const saveProfile = async () => {
    setBusy('profile');
    setError('');
    try {
      await updateProfile(form);
      toast.success('Profile updated');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const savePassword = async () => {
    setBusy('password');
    setError('');
    try {
      await api('/auth/change-password', { method: 'POST', body: passwords });
      setPasswords({ currentPassword: '', newPassword: '' });
      toast.success('Password changed');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const saveAppearance = async (nextTheme) => {
    setTheme(nextTheme);
    try {
      await api('/auth/me', { method: 'PATCH', body: { preferences: { theme: nextTheme } } });
    } catch {
      /* non-critical */
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Account settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          One unified account. Your classroom roles are managed inside each classroom.
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="card card-pad space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <UserRound className="h-4 w-4 text-slate-400" /> Profile
        </h2>
        <div className="flex items-center gap-3">
          <Avatar name={form.name || user?.name} color={form.avatarColor} size={52} />
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setForm((f) => ({ ...f, avatarColor: c }))}
                className={cx('h-6 w-6 rounded-full ring-offset-2 dark:ring-offset-slate-900', form.avatarColor === c ? 'ring-2 ring-brand-500' : '')}
                style={{ background: c }}
                aria-label={`Use ${c} avatar colour`}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="label">Full name</label>
          <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input bg-slate-50 dark:bg-slate-800/60" value={user?.email || ''} disabled />
        </div>
        <div>
          <label className="label">Headline</label>
          <input className="input" value={form.headline} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))} />
        </div>
        <button onClick={saveProfile} className="btn-primary" disabled={busy === 'profile'}>
          {busy === 'profile' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save profile
        </button>
      </div>

      <div className="card card-pad space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Palette className="h-4 w-4 text-slate-400" /> Appearance
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {['light', 'dark'].map((t) => (
            <button
              key={t}
              onClick={() => saveAppearance(t)}
              className={cx(
                'rounded-lg border p-3 text-sm capitalize transition-colors',
                theme === t ? 'border-brand-500 bg-brand-50/60 text-brand-800 dark:border-brand-500 dark:bg-brand-950/30 dark:text-brand-200' : 'border-slate-200 dark:border-slate-700',
              )}
            >
              {t} theme
            </button>
          ))}
        </div>
      </div>

      <div className="card card-pad space-y-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Change password</h2>
        <div>
          <label className="label">Current password</label>
          <input type="password" className="input" value={passwords.currentPassword} onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))} autoComplete="current-password" />
        </div>
        <div>
          <label className="label">New password</label>
          <input type="password" className="input" value={passwords.newPassword} minLength={8} onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))} autoComplete="new-password" />
        </div>
        <button onClick={savePassword} className="btn-primary" disabled={busy === 'password' || passwords.newPassword.length < 8 || !passwords.currentPassword}>
          {busy === 'password' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Change password
        </button>
      </div>
    </div>
  );
}
