import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { cx } from '../ui';

/**
 * CHAT PRIMITIVES
 * ===============
 *
 * The small pieces the chat surface is built from. They live together because
 * they share one concern: making a conversation feel immediate without
 * guessing at what the server is doing.
 *
 * Two rules run through all of it.
 *
 * 1. **Nothing blocks typing.** The composer never disables itself while a
 *    reply is pending; the learner can keep writing, and the send button turns
 *    into a queue button. A disabled input is the most common way a chat feels
 *    slow, because it makes you wait for the machine.
 *
 * 2. **Motion never carries meaning.** The dots, the caret and the entrance
 *    animation are decoration. Every state is also expressed in text or a static
 *    attribute, so `prefers-reduced-motion` users lose nothing.
 */

/* -------------------------------------------------------------------------- */
/* typing indicator                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Three dots while the model is working.
 *
 * A spinner says "busy". Dots in a message-shaped bubble say "a reply is
 * coming", which is what the learner is actually waiting for — and it holds the
 * space the reply will occupy, so nothing jumps when it lands.
 */
export function TypingBubble({ label = 'Thinking' }) {
  return (
    <div className="msg-in flex items-end gap-2.5" role="status" aria-live="polite" aria-label={`${label}…`}>
      <Avatar />
      <div className="rounded-2xl rounded-bl-md border border-slate-200/80 bg-white px-3.5 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="dot h-1.5 w-1.5 rounded-full bg-brand-500" />
          <span className="dot dot-2 h-1.5 w-1.5 rounded-full bg-brand-500" />
          <span className="dot dot-3 h-1.5 w-1.5 rounded-full bg-brand-500" />
        </span>
      </div>
    </div>
  );
}

/** The assistant's avatar, used beside every reply. */
export function Avatar({ className = '' }) {
  return (
    <span
      className={cx(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-900',
        className,
      )}
      aria-hidden="true"
    >
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* scroll                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Stick to the bottom, but only if the reader is already there.
 *
 * Naively scrolling on every message change yanks the view away from anyone
 * reading back through the conversation. This tracks whether the reader is
 * within ~80 px of the bottom and only follows when they are. It reports that
 * as `atBottom` so the UI can offer a "jump to latest" affordance instead.
 *
 * Listens to the container's scroll event with `passive: true` so it can never
 * delay scrolling itself.
 */
export function useStickToBottom(deps = []) {
  const ref = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const pinned = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const near = distance < 80;
      pinned.current = near;
      setAtBottom((prev) => (prev === near ? prev : near));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Layout effect, not effect: the scroll happens before the browser paints, so
  // the new message is never seen at the wrong offset for a frame.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = ref.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  return { ref, atBottom, scrollToBottom };
}

/* -------------------------------------------------------------------------- */
/* reveal                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Reveal text at a readable pace.
 *
 * The server answers in one piece; a wall of text appearing at once reads as a
 * jolt. This plays the text out over at most ~700 ms regardless of length, so a
 * long reply is not artificially slow — the *rate* adapts, the ceiling does not.
 *
 * The full text is what gets rendered in the end; this only decides how much of
 * it is visible on each frame. When `instant` is true (reduced motion, or a
 * message restored from history) it is shown immediately.
 */
export function useRevealedText(text, { instant = false } = {}) {
  const full = String(text ?? '');
  const [shown, setShown] = useState(instant ? full : '');

  useEffect(() => {
    if (instant) {
      setShown(full);
      return undefined;
    }
    if (!full) {
      setShown('');
      return undefined;
    }
    // Aim for a 700 ms reveal, but never slower than ~60 chars a frame batch.
    const duration = Math.min(700, Math.max(240, full.length * 4));
    const started = performance.now();
    let frame = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      // Ease-out so the beginning of the sentence lands quickly.
      const eased = 1 - (1 - t) * (1 - t);
      setShown(full.slice(0, Math.ceil(eased * full.length)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [full, instant]);

  return { text: shown, done: shown.length >= full.length };
}

/* -------------------------------------------------------------------------- */
/* messages                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One message bubble.
 *
 * Memoised on the parts that identify it: in a long thread React re-renders the
 * list on every keystroke in the composer, and without this each bubble's
 * markdown is re-parsed every time. `onChoose` and `onCopy` are stable
 * callbacks from the parent for the same reason.
 */
export const Message = memo(function Message({ message, onChoose, onCopy, disabled, reduced }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="msg-in flex justify-end pl-8">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-sm">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="msg-in group flex gap-2.5">
      <Avatar className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <AssistantBody message={message} reduced={reduced} />

        {message.choices?.length ? (
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {message.choices.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={disabled}
                onClick={() => onChoose(c)}
                className="group/choice flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition-all hover:-translate-y-px hover:border-brand-400 hover:shadow-sm disabled:pointer-events-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-600"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.label}</span>
                  {c.hint ? <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">{c.hint}</span> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {message.content ? (
          <div className="mt-1 flex h-5 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onCopy?.(message.content)}
              className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              Copy
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});

/**
 * The assistant's text, with the code/lists/bold a reply actually contains.
 *
 * Deliberately not `react-markdown`: pulling the full pipeline in for a chat
 * bubble costs ~116 kB in its own chunk and re-parses on every stream frame.
 * A reply is short prose with inline code and the occasional list, which this
 * covers in a few lines — and it never interprets HTML.
 */
function AssistantBody({ message, reduced }) {
  if (message.role === 'user') return null;
  const streaming = Boolean(message.streaming);
  const { text } = useRevealedText(message.content, { instant: reduced || !streaming });

  return (
    <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
      <RichText text={text} />
      {streaming && text ? <Caret /> : null}
    </div>
  );
}

function Caret() {
  return (
    <span
      className="ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-[2px] rounded-full bg-brand-500 align-baseline"
      style={{ animation: 'lm-caret 900ms steps(1, end) infinite' }}
      aria-hidden="true"
    />
  );
}

/**
 * Renders a reply: paragraphs, `-` bullets, and inline code/bold/links.
 * Inline formatting is done by splitting on the delimiter, never by injecting
 * HTML, so model output cannot introduce an element or a handler.
 */
export function RichText({ text }) {
  const blocks = splitBlocks(String(text ?? ''));
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'ul') {
          return (
            <ul key={i} className="my-1.5 space-y-1 pl-1">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" aria-hidden="true" />
                  <span className="min-w-0">
                    <Inline text={item} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={i} className="my-1.5 space-y-1 pl-1">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">{j + 1}.</span>
                  <span className="min-w-0">
                    <Inline text={item} />
                  </span>
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i} className={cx('whitespace-pre-wrap break-words', i > 0 && 'mt-2')}>
            <Inline text={block.text} />
          </p>
        );
      })}
    </>
  );
}

function splitBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let list = null;
  let buffer = [];

  const flushParagraph = () => {
    if (buffer.length) {
      blocks.push({ type: 'p', text: buffer.join('\n') });
      buffer = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const line of lines) {
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((bullet || numbered)[1]);
      continue;
    }
    flushList();
    buffer.push(line);
  }
  flushParagraph();
  flushList();
  return blocks.length ? blocks : [{ type: 'p', text: '' }];
}

/** Inline `code`, **bold** and bare URLs. No HTML is ever interpreted. */
function Inline({ text }) {
  const segments = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g);
  return (
    <>
      {segments.filter(Boolean).map((seg, i) => {
        if (seg.startsWith('`') && seg.endsWith('`')) {
          return (
            <code key={i} className="rounded-[5px] bg-slate-100 px-1 py-0.5 font-mono text-[12.5px] text-slate-800 dark:bg-slate-800 dark:text-slate-100">
              {seg.slice(1, -1)}
            </code>
          );
        }
        if (seg.startsWith('**') && seg.endsWith('**')) {
          return (
            <strong key={i} className="font-semibold text-slate-900 dark:text-white">
              {seg.slice(2, -2)}
            </strong>
          );
        }
        if (/^https?:\/\//.test(seg)) {
          return (
            <a key={i} href={seg} target="_blank" rel="noopener noreferrer nofollow" className="link break-all">
              {seg}
            </a>
          );
        }
        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}
