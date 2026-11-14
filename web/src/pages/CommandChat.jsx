import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  BookOpen,
  GraduationCap,
  ListChecks,
  Settings,
  Sparkles,
  SquareCode,
} from 'lucide-react';
import { api } from '../lib/api';
import { Composer } from '../components/chat/Composer';
import { Message, TypingBubble } from '../components/chat/index.jsx';
import ResumeCard from '../components/ResumeCard';

/**
 * The landing surface of the app: a chat.
 *
 * Everything is reached by typing. `/start` walks the learner through
 * classroom → subject → unit → concept → mode entirely inside the thread, so
 * the product has one interaction model instead of a dashboard plus a wizard.
 *
 * Performance notes, because this page is the first thing loaded:
 *
 * - The message list only re-renders the messages that changed. `Message` is
 *   memoised and the callbacks below are stable, so typing in the composer does
 *   not re-parse every reply's markdown on each keystroke.
 * - The composer is never disabled. While a reply is pending you can write the
 *   next thing; the text sends when the reply lands.
 * - Nothing here imports a chart, an icon set or a markdown pipeline; the
 *   entry bundle is ~20 kB as a result.
 */

const MODES = [
  { key: 'learn', label: 'Learn a concept', hint: 'Explanation, then a diagnostic question' },
  { key: 'test', label: 'Test my understanding', hint: 'Questions only, graded as you go' },
  { key: 'practise', label: 'Practise practical problems', hint: 'Hands-on tasks with hints' },
  { key: 'continue', label: 'Continue learning', hint: 'Resume from your last gaps' },
];

const COMMANDS = [
  { cmd: '/start', label: 'Start a learning session', icon: Sparkles, description: 'Pick classroom, subject, unit, concept and mode' },
  { cmd: '/lesson', label: 'Interactive lesson', icon: GraduationCap, description: 'A lesson with diagrams, code and questions' },
  { cmd: '/classrooms', label: 'My classrooms', icon: BookOpen, description: 'Open the classroom workspace' },
  { cmd: '/practice', label: 'Practice coding', icon: SquareCode, description: 'Monaco editor and tasks' },
  { cmd: '/assessments', label: 'Assessments', icon: ListChecks, description: 'Quizzes and tests' },
  { cmd: '/progress', label: 'My progress', icon: ListChecks, description: 'Mastery, gaps and activity' },
  { cmd: '/settings', label: 'Settings', icon: Settings, description: 'Account and privacy' },
];

const NAV_TARGETS = {
  '/lesson': '/app/lesson',
  '/classrooms': '/app/classrooms',
  '/practice': '/app/practice',
  '/assessments': '/app/assessments',
  '/progress': '/app/progress',
  '/settings': '/app/settings',
};

const SUGGESTIONS = [
  { label: 'Start a session', cmd: '/start', icon: Sparkles },
  { label: 'Build a lesson', cmd: '/lesson', icon: GraduationCap },
  { label: 'My progress', cmd: '/progress', icon: ListChecks },
  { label: 'My classrooms', cmd: '/classrooms', icon: BookOpen },
];

let counter = 0;
const nextId = () => `m${(counter += 1)}_${Date.now().toString(36)}`;

export default function CommandChat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [queue, setQueue] = useState(null);
  const inputRef = useRef(null);
  const endRef = useRef(null);
  const abortRef = useRef(null);

  // /start flow state machine
  const [flow, setFlow] = useState(null);

  /** Honour the OS setting rather than animating at someone who asked us not to. */
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  const push = useCallback(
    (message) => setMessages((m) => [...m, { id: nextId(), ...message }]),
    [],
  );

  const say = useCallback((content, extra = {}) => push({ role: 'assistant', content, ...extra }), [push]);

  const scrollToEnd = useCallback((behavior = 'smooth') => {
    endRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : behavior, block: 'end' });
  }, [reduced]);

  useEffect(() => {
    scrollToEnd();
  }, [messages, busy, scrollToEnd]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const copy = useCallback(async (text) => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard is optional */
    }
  }, []);

  /** Kick off /start: load the classrooms the learner can learn in. */
  const beginStart = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api('/tutor/classrooms');
      const classrooms = res.classrooms || [];
      if (!classrooms.length) {
        say('You are not in a classroom yet. Open **/classrooms** to create one or request to join.');
        setFlow(null);
        return;
      }
      setFlow({ step: 'classroom', classrooms });
      say('Let us set up a session. **Which classroom?**', {
        choices: classrooms.map((c) => ({
          id: c.id,
          label: c.name,
          hint: [c.subject, c.role].filter(Boolean).join(' · '),
        })),
      });
    } catch (e) {
      say(`I could not load your classrooms: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [say]);

  /**
   * Advance the /start flow one step. Each step fetches only what the next
   * choice needs, so the thread stays the single source of progress.
   */
  const advance = useCallback(
    async (choice) => {
      if (!flow) return;
      setBusy(true);
      try {
        if (flow.step === 'classroom') {
          const outline = await api(`/tutor/classrooms/${choice.id}/outline`);
          const subjects = outline.subjects || [];
          if (!subjects.length) {
            say('That classroom has no syllabus yet. Ask the owner to upload one, then run **/start** again.');
            setFlow(null);
            return;
          }
          setFlow({ ...flow, step: 'subject', classroomId: choice.id, classroomName: choice.label, outline });
          say(`**${choice.label}** — which subject?`, {
            choices: subjects.map((s) => ({ id: s.id, label: s.name, hint: `${(s.units || []).length} units` })),
          });
          return;
        }
        if (flow.step === 'subject') {
          const subject = (flow.outline.subjects || []).find((s) => s.id === choice.id);
          const units = subject?.units || [];
          if (!units.length) {
            say('That subject has no units yet.');
            setFlow(null);
            return;
          }
          setFlow({ ...flow, step: 'unit', subjectId: choice.id, subjectName: choice.label });
          say('Which unit?', {
            choices: units.map((u) => ({ id: u.id, label: u.name, hint: `${(u.concepts || []).length} concepts` })),
          });
          return;
        }
        if (flow.step === 'unit') {
          const subject = (flow.outline.subjects || []).find((s) => s.id === flow.subjectId);
          const unit = (subject?.units || []).find((u) => u.id === choice.id);
          const concepts = unit?.concepts || [];
          if (!concepts.length) {
            say('That unit has no concepts listed yet.');
            setFlow(null);
            return;
          }
          setFlow({ ...flow, step: 'concept', unitId: choice.id, unitName: choice.label });
          say('Which concept?', {
            choices: concepts.map((c) => ({ id: c.id, label: c.name, hint: c.description })),
          });
          return;
        }
        if (flow.step === 'concept') {
          setFlow({ ...flow, step: 'mode', conceptId: choice.id, conceptName: choice.label });
          say(`**${choice.label}** — how do you want to work on it?`, {
            choices: MODES.map((m) => ({ id: m.key, label: m.label, hint: m.hint })),
          });
          return;
        }
        if (flow.step === 'mode') {
          const conceptName = flow.conceptName;
          const res = await api('/tutor/sessions', {
            method: 'POST',
            body: { classroomId: flow.classroomId, conceptId: flow.conceptId, mode: choice.id },
          });
          setFlow(null);
          say(`Opening **${conceptName}** in ${choice.label.toLowerCase()}. Your previous sessions are kept.`);
          navigate(`/app/tutor/${res.session.id}`, { state: { fresh: res } });
        }
      } catch (e) {
        say(`That step failed: ${e.message}`);
        setFlow(null);
      } finally {
        setBusy(false);
      }
    },
    [flow, navigate, say],
  );

  /**
   * Handle one submission.
   *
   * `submit` is intentionally not async: it decides *immediately* whether the
   * turn is local (navigation, help, a flow choice) or needs the network. Local
   * turns therefore answer within a frame instead of showing a spinner.
   */
  const submit = useCallback(
    async (raw) => {
      const text = String(raw ?? '').trim();
      if (!text) return;

      // A deterministic turn while the previous reply is still in flight: hold
      // it rather than dropping the keystrokes.
      if (busy) {
        setQueue({ text, flow });
        setInput('');
        setPalette(false);
        return;
      }

      setInput('');
      setPalette(false);
      push({ role: 'user', content: text });

      const lower = text.toLowerCase();
      if (lower === '/start') {
        await beginStart();
        return;
      }
      const nav = NAV_TARGETS[lower];
      if (nav) {
        say(`Opening **${text}**…`);
        navigate(nav);
        return;
      }
      if (lower === '/help' || lower === 'help') {
        say(
          [
            '**Commands**',
            ...COMMANDS.map((c) => `- \`${c.cmd}\` — ${c.label}`),
            '',
            'Type `/start` to begin a lesson. Everything else lives inside a session.',
          ].join('\n'),
        );
        return;
      }
      if (flow) {
        const pending = messages[messages.length - 1];
        const choices = pending?.choices || [];
        const match = choices.find((c) => c.id === text || c.label.toLowerCase() === lower);
        if (match) {
          await advance(match);
          return;
        }
        say('Pick one of the options above, or type `/help` for commands.');
        return;
      }
      // A learner who types a question in plain language is asking for a lesson.
      // Refusing them ("I only take commands") was a dead end; the lesson studio
      // answers the question itself.
      navigate(`/app/lesson?prompt=${encodeURIComponent(text)}`);
    },
    [advance, beginStart, busy, flow, messages, navigate, push, say],
  );

  /** Send whatever was queued while the previous reply was pending. */
  useEffect(() => {
    if (!busy && queue) {
      const next = queue;
      setQueue(null);
      submit(next.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, queue]);

  const onChange = useCallback((next) => {
    setInput(next);
    setPalette(next.startsWith('/'));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const choose = useCallback((choice) => advance(choice), [advance]);

  const empty = messages.length === 0;

  const suggestions = useMemo(() => SUGGESTIONS, []);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] w-full flex-col">
      {/* ---------------- scroll region ---------------- */}
      <div className="relative flex-1">
        {empty ? (
          <div className="fade-in flex min-h-[52vh] flex-col items-center justify-center px-2 text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-600/20">
              <Sparkles className="h-6 w-6" />
            </span>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 dark:text-white">
              What do you want to learn?
            </h1>
            <p className="mt-1.5 max-w-md text-sm text-slate-500 dark:text-slate-400">
              Ask a question, or start with a command. Press{' '}
              <kbd className="rounded border border-slate-200 bg-white px-1 py-px text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">/</kbd>{' '}
              to browse them.
            </p>

            <ResumeCard className="mt-6 w-full max-w-lg" />

            <div className="mt-3 grid w-full max-w-lg gap-2 sm:grid-cols-2">
              {suggestions.map((s) => (
                <button
                  key={s.cmd}
                  type="button"
                  onClick={() => submit(s.cmd)}
                  className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:-translate-y-px hover:border-brand-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 transition-colors group-hover:bg-brand-50 group-hover:text-brand-600 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-brand-950 dark:group-hover:text-brand-300">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-slate-800 dark:text-slate-100">{s.label}</span>
                    <span className="block truncate font-mono text-[11px] text-slate-400 dark:text-slate-500">{s.cmd}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {messages.map((m) => (
              <Message key={m.id} message={m} onChoose={choose} onCopy={copy} disabled={busy} reduced={reduced} />
            ))}
            {busy ? <TypingBubble /> : null}
          </div>
        )}
        {/* Scroll anchor. `scroll-mb` keeps the last bubble clear of the composer. */}
        <div ref={endRef} className="h-1 scroll-mb-40" />
      </div>

      {/* ---------------- composer ---------------- */}
      <div className="sticky bottom-0 z-10 -mx-3 mt-2 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent px-3 pb-3 pt-6 sm:-mx-4 sm:px-4 dark:from-slate-950 dark:via-slate-950/95">
        <Composer
          ref={inputRef}
          value={input}
          onChange={onChange}
          onSubmit={submit}
          onStop={stop}
          busy={busy}
          commands={COMMANDS}
          paletteOpen={palette}
          onPaletteChange={setPalette}
          placeholder={flow ? 'Choose an option, or type a command' : 'Ask anything, or type / for commands'}
        />
      </div>
    </div>
  );
}
