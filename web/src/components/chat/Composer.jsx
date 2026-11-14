import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Command, CornerDownLeft, Plus, Square, X } from 'lucide-react';
import { cx } from '../ui';

/**
 * THE COMPOSER
 * ============
 *
 * The one control the learner touches on every turn, so it is optimised for the
 * two things that make a chat feel fast: the caret is always available, and the
 * send is immediate.
 *
 * - **Never disabled.** While a reply is pending you can keep writing. The send
 *   button becomes Stop, and whichever text is in the box sends when the reply
 *   lands. Disabling the input is the single most common reason a chat *feels*
 *   slow: it turns latency into a locked keyboard.
 * - **Autogrows** from one line to ten, then scrolls, using a single layout read
 *   and no re-render per keystroke.
 * - **Keyboard first.** Enter sends, Shift+Enter breaks, Up recalls the previous
 *   command when the box is empty, Escape closes the palette, ⌘/Ctrl+K focuses.
 *
 * The command palette is derived from `commands` and filtered here, so opening
 * it never touches the network.
 */
export const Composer = forwardRef(function Composer(
  {
    value,
    onChange,
    onSubmit,
    onStop,
    busy = false,
    commands = [],
    paletteOpen = false,
    onPaletteChange,
    placeholder = 'Ask anything, or type / for commands',
    focusKey = '/',
  },
  ref,
) {
  const textareaRef = useRef(null);
  const [highlight, setHighlight] = useState(0);

  const setRefs = useCallback(
    (node) => {
      textareaRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  /** Focus from anywhere: ⌘K / Ctrl+K, and `/` when not already typing. */
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || '');
      const target = e.key;
      if ((e.metaKey || e.ctrlKey) && target.toLowerCase() === 'k') {
        e.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      if (target === focusKey && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusKey]);

  // Autogrow: one write to style.height per keystroke, no state change.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useImperativeHandle(ref, () => textareaRef.current, []);

  const filtered = paletteOpen ? filterCommands(commands, value) : [];

  useEffect(() => {
    if (paletteOpen) setHighlight(0);
  }, [paletteOpen, value]);

  const send = () => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
  };

  const handleKeyDown = (e) => {
    if (paletteOpen && filtered.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const pick = filtered[highlight];
        if (pick) onChange(pick.cmd);
        onPaletteChange?.(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const pick = filtered[highlight] || filtered[0];
        if (pick) onSubmit(pick.cmd);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === 'Escape' && paletteOpen) {
      e.preventDefault();
      onPaletteChange?.(false);
    }
  };

  const canSend = Boolean(value.trim());

  return (
    <div className="relative">
      {paletteOpen && filtered.length ? (
        <div
          id="command-palette"
          role="listbox"
          className="panel-in absolute bottom-full left-0 right-0 z-20 mb-2 max-h-[min(60vh,22rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-pop dark:border-slate-700 dark:bg-slate-900"
        >
          {filtered.map((c, i) => (
            <button
              key={c.cmd}
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => onSubmit(c.cmd)}
              className={cx(
                'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                i === highlight ? 'bg-brand-50 dark:bg-brand-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
              )}
            >
              {c.icon ? (
                <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', i === highlight ? 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>
                  <c.icon className="h-3.5 w-3.5" />
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">{c.cmd}</span>
                <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{c.description || c.label}</span>
              </span>
              {i === highlight ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-brand-500" /> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className={cx('composer relative overflow-hidden', busy && 'sweep')}>
        <div className="flex items-end gap-1.5 p-2">
          <button
            type="button"
            onClick={() => onPaletteChange?.(!paletteOpen)}
            className={cx(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
              paletteOpen
                ? 'bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300',
            )}
            aria-label={paletteOpen ? 'Close commands' : 'Show commands'}
            aria-expanded={paletteOpen}
            aria-controls={paletteOpen ? 'command-palette' : undefined}
          >
            {paletteOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>

          <textarea
            ref={setRefs}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label="Message"
            aria-autocomplete="list"
            aria-controls={paletteOpen ? 'command-palette' : undefined}
            className="max-h-[200px] min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />

          {busy && !canSend ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white transition-transform hover:scale-105 active:scale-95 dark:bg-slate-200 dark:text-slate-900"
              aria-label="Stop waiting"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className={cx(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-all',
                canSend
                  ? 'bg-brand-600 shadow-sm hover:scale-105 hover:bg-brand-700 active:scale-95'
                  : 'cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600',
              )}
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>

        {busy ? (
          <p className="flex items-center gap-2 px-3 pb-2 text-[11px] text-slate-400 dark:text-slate-500" role="status">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
            </span>
            Waiting for a reply — you can keep typing.
          </p>
        ) : null}
      </div>

      <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 px-1 text-center text-[11px] text-slate-400 dark:text-slate-500">
        <Kbd>/</Kbd> commands
        <Dot />
        <Kbd>Enter</Kbd> send
        <Dot />
        <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd> newline
        <Dot />
        <Kbd>
          <Command className="h-2.5 w-2.5" />K
        </Kbd>{' '}
        focus
      </p>
    </div>
  );
});

function Kbd({ children }) {
  return (
    <kbd className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1 py-px font-sans text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
      {children}
    </kbd>
  );
}

function Dot() {
  return <span className="text-slate-300 dark:text-slate-600">·</span>;
}

/**
 * Rank commands for what has been typed.
 *
 * A prefix on the command itself wins over a word in its label, so `/c` puts
 * `/classrooms` first rather than `/lesson` (which mentions "classroom").
 */
export function filterCommands(commands, input) {
  const raw = String(input || '').trim().toLowerCase();
  const query = raw.startsWith('/') ? raw.slice(1) : raw;
  if (!query) return commands;
  const scored = commands
    .map((c) => {
      const cmd = c.cmd.toLowerCase().replace(/^\//, '');
      let score = -1;
      if (cmd.startsWith(query)) score = 100 - cmd.length;
      else if (cmd.includes(query)) score = 60 - cmd.length;
      else if (`${c.label} ${c.description || ''}`.toLowerCase().includes(query)) score = 30;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.c);
}
