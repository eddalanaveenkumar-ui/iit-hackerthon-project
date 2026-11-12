export function timeAgo(input) {
  if (!input) return '—';
  const then = new Date(input).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(input).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortDate(input) {
  if (!input) return '—';
  return new Date(input).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function fullDate(input) {
  if (!input) return '—';
  return new Date(input).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function pct(n) {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n)}%`;
}

export const severityStyles = {
  low: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
  medium: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  high: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900',
  critical: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
};

export const categoryLabels = {
  knowledge_gap: 'Knowledge gap',
  misconception: 'Misconception',
  practical_difficulty: 'Practical difficulty',
  repeated_error: 'Repeated error',
};

export const categoryStyles = {
  knowledge_gap: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900',
  misconception: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
  practical_difficulty: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  repeated_error: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900',
};

export const levelStyles = {
  beginner: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  emerging: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  developing: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  secure: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  proficient: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  mastered: 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300',
  advanced: 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300',
  not_started: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

export const roleLabels = {
  owner: 'Owner',
  co_owner: 'Co-owner',
  teacher: 'Teacher',
  student: 'Learner',
};

export const roleStyles = {
  owner: 'bg-brand-600 text-white',
  co_owner: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  teacher: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  student: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export function masteryColor(score) {
  if (score === null || score === undefined) return '#94a3b8';
  if (score >= 80) return '#059669';
  if (score >= 60) return '#2563eb';
  if (score >= 40) return '#d97706';
  return '#dc2626';
}

export function coverStyle(coverImage) {
  if (!coverImage) return { background: 'linear-gradient(135deg,#1e293b,#334155 50%,#475569)' };
  if (coverImage.startsWith('linear-gradient') || coverImage.startsWith('#') || coverImage.startsWith('rgb')) {
    return { background: coverImage };
  }
  return { backgroundImage: `url(${coverImage})`, backgroundSize: 'cover', backgroundPosition: 'center' };
}

export function pluralize(n, word, plural) {
  return `${n} ${n === 1 ? word : plural || `${word}s`}`;
}
