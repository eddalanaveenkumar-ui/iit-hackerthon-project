import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cx } from '../../ui';

/**
 * READ-ONLY CODE BLOCK
 * ====================
 *
 * Code that a question is *about* — not an editor, not runnable. The point is
 * legibility: a program the learner has to reason about should look like a
 * program, with its statements on their own lines and its punctuation
 * distinguishable from the prose around it.
 *
 * Deliberately not Monaco. The editor bundle is ~430 kB and is already split out
 * for the practice workspace; loading it to display six lines of Python would
 * cost more than the whole chat page. This is a `<pre>` with line numbers, which
 * is all a read-only snippet needs.
 *
 * Nothing here is executed and nothing is `dangerouslySetInnerHTML`: the text is
 * rendered as text, so a snippet cannot introduce markup.
 */

const LABELS = { javascript: 'JavaScript', python: 'Python', java: 'Java', sql: 'SQL' };

export default function CodeBlock({ code, language, title, className = '' }) {
  const [copied, setCopied] = useState(false);
  const text = String(code ?? '').replace(/\t/g, '  ');
  const lines = useMemo(() => text.split('\n'), [text]);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — copying is a convenience, not a requirement */
    }
  };

  if (!text.trim()) return null;

  return (
    <figure className={cx('my-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-700 dark:bg-slate-950', className)}>
      <figcaption className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          <span className="flex gap-1" aria-hidden>
            <i className="h-2 w-2 rounded-full bg-rose-400/70" />
            <i className="h-2 w-2 rounded-full bg-amber-400/70" />
            <i className="h-2 w-2 rounded-full bg-emerald-400/70" />
          </span>
          {title || LABELS[language] || 'Code'}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>

      <div className="overflow-x-auto">
        <pre className="m-0 py-2.5 text-[12.5px] leading-relaxed">
          <code className="block">
            {lines.map((line, index) => (
              // Line numbers are `aria-hidden`: a screen reader should read the
              // program, not a column of digits.
              <span key={index} className="flex">
                <span aria-hidden className="w-8 shrink-0 select-none pr-2 text-right text-[11px] text-slate-600">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre pr-3 text-slate-100">{line || ' '}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </figure>
  );
}
