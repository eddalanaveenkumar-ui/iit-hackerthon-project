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
      // Code: monospace block, no execution, no highlighting service.
      code({ inline, children, className: codeClass, ...props }) {
        if (inline) {
          return (
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12.5px] dark:bg-slate-800" {...props}>
              {children}
            </code>
          );
        }
        return (
          <pre className={codeClass}>
            <code>{children}</code>
          </pre>
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
