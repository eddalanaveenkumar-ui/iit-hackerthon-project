import { lazy, Suspense } from 'react';
import { cx } from '../../ui';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import ArrowRight from 'lucide-react/icons/arrow-right';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import BookOpen from 'lucide-react/icons/book-open';
import BookOpenCheck from 'lucide-react/icons/book-open-check';
import Brain from 'lucide-react/icons/brain';
import Bug from 'lucide-react/icons/bug';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Clock from 'lucide-react/icons/clock';
import Code2 from 'lucide-react/icons/code-2';
import Cpu from 'lucide-react/icons/cpu';
import Database from 'lucide-react/icons/database';
import Eye from 'lucide-react/icons/eye';
import Flag from 'lucide-react/icons/flag';
import FlaskConical from 'lucide-react/icons/flask-conical';
import GitBranch from 'lucide-react/icons/git-branch';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import Info from 'lucide-react/icons/info';
import Layers from 'lucide-react/icons/layers';
import Lightbulb from 'lucide-react/icons/lightbulb';
import ListChecks from 'lucide-react/icons/list-checks';
import PenTool from 'lucide-react/icons/pen-tool';
import PlayCircle from 'lucide-react/icons/play-circle';
import Puzzle from 'lucide-react/icons/puzzle';
import Repeat from 'lucide-react/icons/repeat';
import Rocket from 'lucide-react/icons/rocket';
import Search from 'lucide-react/icons/search';
import Shapes from 'lucide-react/icons/shapes';
import Sigma from 'lucide-react/icons/sigma';
import Sparkles from 'lucide-react/icons/sparkles';
import SquareFunction from 'lucide-react/icons/square-function';
import Star from 'lucide-react/icons/star';
import Target from 'lucide-react/icons/target';
import Terminal from 'lucide-react/icons/terminal';
import Trophy from 'lucide-react/icons/trophy';
import Wrench from 'lucide-react/icons/wrench';
import Zap from 'lucide-react/icons/zap';

/**
 * Shared primitives for the DynamicRenderer.
 *
 * The rules encoded here are the design system's, not each renderer's:
 *  - `Panel`   one frame, one heading style, one caption style;
 *  - `Body`    markdown rendering, with no raw HTML path;
 *  - `Empty`   every renderer has a defined "nothing to show" state;
 *  - `Notice`  a recoverable problem inside a component (not an exception).
 */

const Markdown = lazy(() => import('../../Markdown'));

export const TONE_ACCENT = {
  neutral: 'border-slate-200 dark:border-slate-700',
  brand: 'border-brand-200 dark:border-brand-900',
  success: 'border-emerald-200 dark:border-emerald-900',
  warning: 'border-amber-200 dark:border-amber-900',
  danger: 'border-rose-200 dark:border-rose-900',
  violet: 'border-violet-200 dark:border-violet-900',
  info: 'border-sky-200 dark:border-sky-900',
};

export const TONE_BG = {
  neutral: 'bg-slate-50 dark:bg-slate-800/40',
  brand: 'bg-brand-50 dark:bg-brand-950/30',
  success: 'bg-emerald-50 dark:bg-emerald-950/30',
  warning: 'bg-amber-50 dark:bg-amber-950/30',
  danger: 'bg-rose-50 dark:bg-rose-950/30',
  violet: 'bg-violet-50 dark:bg-violet-950/30',
  info: 'bg-sky-50 dark:bg-sky-950/30',
};

export const BAR_TONE = {
  brand: 'bg-brand-600',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  neutral: 'bg-slate-400',
  violet: 'bg-violet-500',
  info: 'bg-sky-500',
};

export const WIDTH_CLASS = { full: 'w-full', half: 'sm:w-1/2', third: 'sm:w-1/3' };

/**
 * The frame every block component uses.
 *
 * @param {object} props
 * @param {string} [props.title]
 * @param {string} [props.subtitle]
 * @param {string} [props.icon]  lucide name resolved by <Icon/>
 * @param {string} [props.tone]
 * @param {React.ReactNode} [props.action]  right-aligned header content
 * @param {boolean} [props.flush]  remove body padding (tables, code)
 */
export function Panel({ title, subtitle, icon, tone = 'neutral', action, footer, children, flush = false, className = '', as: Tag = 'section', titleId }) {
  const hasHeader = Boolean(title || subtitle || action);
  return (
    <Tag
      className={cx('overflow-hidden rounded-xl2 border bg-white shadow-card dark:bg-slate-900', TONE_ACCENT[tone] || TONE_ACCENT.neutral, className)}
      aria-labelledby={title ? titleId : undefined}
    >
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5 dark:border-slate-800">
          <div className="flex min-w-0 items-start gap-2">
            {icon ? <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" /> : null}
            <div className="min-w-0">
              {title ? (
                <h3 id={titleId} className="text-[13.5px] font-semibold leading-snug text-slate-800 dark:text-slate-100">
                  {title}
                </h3>
              ) : null}
              {subtitle ? <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={flush ? '' : 'p-3.5'}>{children}</div>
      {footer ? <div className="border-t border-slate-100 px-3.5 py-2 text-[11.5px] text-slate-500 dark:border-slate-800 dark:text-slate-400">{footer}</div> : null}
    </Tag>
  );
}

/** Markdown without any HTML execution path. */
export function Body({ children, className = '', format = 'markdown' }) {
  if (!children) return null;
  if (format === 'plain') return <p className={cx('whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200', className)}>{children}</p>;
  return (
    <div className={cx('prose-tutor max-w-none text-sm text-slate-700 dark:text-slate-200', className)}>
      <Suspense fallback={<p className="whitespace-pre-wrap text-sm leading-relaxed">{children}</p>}>
        <Markdown text={children} />
      </Suspense>
    </div>
  );
}

/** The "nothing to render" state every component must handle. */
export function Empty({ label = 'Nothing to display here yet.', icon: IconComponent }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {IconComponent ? <IconComponent className="h-3.5 w-3.5" aria-hidden /> : null}
      {label}
    </div>
  );
}

/** A recoverable, component-local problem (bad reference, empty options…). */
export function Notice({ children, tone = 'warning' }) {
  return (
    <div className={cx('flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs', TONE_ACCENT[tone], TONE_BG[tone], 'text-slate-700 dark:text-slate-200')} role="note">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* icons                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The icons, imported individually.
 *
 * This was `await import('lucide-react')` — a namespace import, which defeats
 * tree-shaking for the *entire* library. Every one of lucide's ~2 350 icons was
 * bundled and downloaded before the chat could paint: 839 kB raw, 213 kB
 * gzipped, on every page. The set below is fixed and small (the protocol only
 * allows these names), so importing them directly costs a few kB.
 */

/** Registry of icon names the protocol allows. Anything else renders nothing. */
const ICONS = {
  book: BookOpen,
  bulb: Lightbulb,
  target: Target,
  code: Code2,
  chart: BarChart3,
  sparkles: Sparkles,
  check: CheckCircle2,
  flag: Flag,
  clock: Clock,
  layers: Layers,
  sigma: Sigma,
  flask: FlaskConical,
  brain: Brain,
  terminal: Terminal,
  list: ListChecks,
  alert: AlertTriangle,
  // kebab-case lucide names used by the authoring sketches
  'book-open': BookOpen,
  'book-open-check': BookOpenCheck,
  'play-circle': PlayCircle,
  'arrow-right': ArrowRight,
  lightbulb: Lightbulb,
  'chevron-right': ChevronRight,
  'graduation-cap': GraduationCap,
  puzzle: Puzzle,
  rocket: Rocket,
  cpu: Cpu,
  'function-square': SquareFunction,
  database: Database,
  'git-branch': GitBranch,
  repeat: Repeat,
  shapes: Shapes,
  'pen-tool': PenTool,
  trophy: Trophy,
  bug: Bug,
  wrench: Wrench,
  star: Star,
  info: Info,
  zap: Zap,
  eye: Eye,
  search: Search,
};

export function Icon({ name, className = 'h-4 w-4' }) {
  // `ICONS` maps a protocol name straight to the component, so the value is
  // already what we need to render.
  const Component = ICONS[name];
  if (!Component) return null;
  return <Component className={className} aria-hidden />;
}

/** Accessible label for a section, used by containers. */
export function sectionLabel(component, fallback = 'Section') {
  return component?.title || component?.subtitle || fallback;
}
