import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, BookOpen, Check, ChevronLeft, Plus, Sparkles, X } from 'lucide-react';
import { api } from '../lib/api';
import { cx, Spinner } from '../components/ui';
import ResumeCard from '../components/ResumeCard';

/**
 * The landing surface of the app: a chat.
 *
 * Everything is reached by typing. `/start` walks the learner through
 * classroom → subject → unit → concept → mode entirely inside the thread, so the
 * product has one interaction model instead of a dashboard plus a wizard.
 */

const MODES = [
  { key: 'learn', label: 'Learn a concept', hint: 'Explanation, then a diagnostic question' },
  { key: 'test', label: 'Test my understanding', hint: 'Questions only, graded as you go' },
  { key: 'practise', label: 'Practise practical problems', hint: 'Hands-on tasks with hints' },
  { key: 'continue', label: 'Continue learning', hint: 'Resume from your last gaps' },
];

const COMMANDS = [
  { cmd: '/start', label: 'Start a learning session', icon: Sparkles, description: 'Pick classroom, subject, unit, concept and mode' },
  { cmd: '/lesson', label: 'Interactive lesson', icon: Sparkles, description: 'AI builds a lesson with diagrams, code and questions' },
  { cmd: '/classrooms', label: 'My classrooms', icon: BookOpen, description: 'Open the classroom workspace' },
  { cmd: '/practice', label: 'Practice coding', icon: BookOpen, description: 'Monaco environment and tasks' },
  { cmd: '/assessments', label: 'Assessments', icon: BookOpen, description: 'Quizzes and tests' },
  { cmd: '/progress', label: 'My progress', icon: BookOpen, description: 'Mastery, gaps and activity' },
  { cmd: '/settings', label: 'Settings', icon: BookOpen, description: 'Account and privacy' },
];

const NAV_TARGETS = {
  '/lesson': '/app/lesson',
  '/classrooms': '/app/classrooms',
  '/practice': '/app/practice',
  '/assessments': '/app/assessments',
  '/progress': '/app/progress',
  '/settings': '/app/settings',
};

export default function CommandChat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // /start flow state machine
  const [flow, setFlow] = useState(null);

  const push = useCallback((message) => {
    setMessages((m) => [...m, { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...message }]);
  }, []);

  const say = useCallback((content, extra = {}) => push({ role: 'assistant', content, ...extra }), [push]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  useEffect(() => {
    inputRef.current?.focus();
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
          const res = await api('/tutor/sessions', {
            method: 'POST',
            body: { classroomId: flow.classroomId, conceptId: flow.conceptId, mode: choice.id },
          });
          setFlow(null);
          say(`Opening **${flow.conceptName}** in ${choice.label.toLowerCase()}. Your previous sessions are kept.`);
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

  const submit = async (raw) => {
    const text = String(raw ?? '').trim();
    if (!text || busy) return;
    setInput('');
    setPalette(false);
    push({ role: 'user', content: text });

    // An active /start flow intercepts free text as an answer when it matches a
    // choice; otherwise the learner can still type a command to switch.
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
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-3xl flex-col">
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white">
            <Sparkles className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">What do you want to learn?</h1>
          <p className="mt-1.5 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Type a command. <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px] dark:bg-slate-800">/start</code> begins a
            guided session in one of your classrooms.
          </p>
          {/* The way back into an unfinished lesson. Renders nothing when there
              is none, so the landing page is unchanged for a new learner. */}
          <ResumeCard className="mt-6 w-full max-w-lg" />
          <div className="mt-2 grid w-full max-w-lg gap-2 sm:grid-cols-2">
            {COMMANDS.slice(0, 4).map((c) => (
              <button
                key={c.cmd}
                onClick={() => submit(c.cmd)}
                className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-800 dark:hover:bg-brand-950/20"
              >
                <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{c.cmd}</span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{c.label}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-4 py-2">
          {messages.map((m) => (
            <Bubble key={m.id} message={m} onChoose={advance} disabled={busy} />
          ))}
          {busy ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Spinner /> Working…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="sticky bottom-0 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent pb-3 pt-4 dark:from-slate-950 dark:via-slate-950">
        {palette ? (
          <div className="mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {COMMANDS.filter((c) => c.cmd.includes(input.trim().toLowerCase().replace(/^\//, '')) || !input.trim()).map((c) => (
              <button
                key={c.cmd}
                onClick={() => submit(c.cmd)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <c.icon className="h-4 w-4 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{c.cmd}</span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{c.description}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
          <button
            onClick={() => setPalette((p) => !p)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label="Show commands"
          >
            {palette ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setPalette(e.target.value.startsWith('/'));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
              if (e.key === 'Escape') setPalette(false);
            }}
            placeholder="Ask, or type / for commands"
            className="max-h-32 min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
            disabled={busy}
          />
          <button
            onClick={() => submit(input)}
            disabled={busy || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-opacity disabled:opacity-40"
            aria-label="Send"
          >
            {busy ? <Spinner className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-center text-[11px] text-slate-400">
          <kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">/</kbd> for commands ·{' '}
          <kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">Enter</kbd> to send
        </p>
      </div>
    </div>
  );
}

function Bubble({ message, onChoose, disabled }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2.5 text-sm text-white">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <Markdown text={message.content} />
        {message.choices?.length ? (
          <div className="mt-2.5 space-y-1.5">
            {message.choices.map((c) => (
              <button
                key={c.id}
                disabled={disabled}
                onClick={() => onChoose(c)}
                className="group flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-brand-400 hover:bg-brand-50/50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-700 dark:hover:bg-brand-950/30"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 group-hover:bg-brand-100 group-hover:text-brand-700 dark:bg-slate-800 dark:group-hover:bg-brand-900 dark:group-hover:text-brand-300">
                  <Check className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.label}</span>
                  {c.hint ? <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{c.hint}</span> : null}
                </span>
                <ChevronLeft className="h-3.5 w-3.5 shrink-0 rotate-180 text-slate-300 group-hover:text-brand-500" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Minimal bold/code/linebreak renderer — this surface only emits short prose. */
function Markdown({ text }) {
  return (
    <div className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
      {String(text).split('\n').map((line, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((seg, j) => {
            if (seg.startsWith('**') && seg.endsWith('**')) {
              return (
                <strong key={j} className="font-semibold text-slate-900 dark:text-white">
                  {seg.slice(2, -2)}
                </strong>
              );
            }
            if (seg.startsWith('`') && seg.endsWith('`')) {
              return (
                <code key={j} className={cx('rounded bg-slate-100 px-1 py-0.5 text-[12.5px] dark:bg-slate-800')}>
                  {seg.slice(1, -1)}
                </code>
              );
            }
            return <span key={j}>{seg}</span>;
          })}
        </p>
      ))}
    </div>
  );
}
