import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { sanitizeText } from './DynamicRenderer/utils/validateUI';

/**
 * Markdown for tutor content.
 *
 * `react-markdown` without `rehype-raw` renders markdown into React elements —
 * embedded HTML in the source is *not* interpreted, it is escaped. Combined with
 * this component's URL filter, model output cannot introduce an element or an
 * event handler into the page.
 *
 * Deliberately no `dangerouslySetInnerHTML` anywhere in this file.
 */
export default function Markdown({ text, className = '' }) {
  const safe = useMemo(() => sanitizeText(text), [text]);

  const components = useMemo(
    () => ({
      // Links: only http(s), and always opened away from the app.
      a({ href, children, ...props }) {
        const ok = typeof href === 'string' && /^https?:\/\//i.test(href);
        if (!ok) return <span>{children}</span>;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...props}>
            {children}
          </a>
        );
      },
      // Images: model-authored markdown images are reduced to a link — lesson
      // media must come through the validated `media` component, not prose.
      img({ src, alt }) {
        const ok = typeof src === 'string' && /^https:\/\//i.test(src);
        if (!ok) return null;
        return (
          <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="link">
            {alt || 'image'}
          </a>
        );
      },
      // Code: monospace, never executed, no highlighting service.
      //
      // react-markdown v10 removed the `inline` flag this used to branch on, so
      // every inline code span fell through to the block branch and rendered a
      // `<pre>` in the middle of a sentence — which is why "Type `code` for a
      // question" broke across three lines. Inline is now detected from the
      // node: a span inside a `pre` is a block, everything else is inline.
      code({ className: codeClass, children, ...props }) {
        // Two signals, both reliable in v10: a fenced block names its language
        // (`language-python`), and a fence containing more than one line has a
        // newline in its text. An inline span has neither.
        const isBlock = Array.isArray(codeClass)
          ? codeClass.some((name) => String(name).startsWith('language-'))
          : typeof codeClass === 'string' && codeClass.startsWith('language-');
        const multiline = String(children ?? '').includes('\n');
        if (isBlock || multiline) {
          return (
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-[12.5px] leading-relaxed text-slate-100 dark:bg-slate-950">
              <code {...props}>{children}</code>
            </pre>
          );
        }
        return (
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12.5px] dark:bg-slate-800" {...props}>
            {children}
          </code>
        );
      },
      table({ children }) {
        return (
          <div className="my-2 overflow-x-auto">
            <table className="table-base">{children}</table>
          </div>
        );
      },
    }),
    [],
  );

  return (
    <div className={className}>
      <ReactMarkdown components={components}>{safe}</ReactMarkdown>
    </div>
  );
}
