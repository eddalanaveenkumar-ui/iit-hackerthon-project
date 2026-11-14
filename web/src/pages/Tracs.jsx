import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BookOpen,
  ClipboardCheck,
  FileText,
  Loader2,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';
import { Spinner, useToast } from '../components/ui';
import { createDynamicActions } from '../lib/dynamicUi';
import {
  deleteTracsSession,
  fetchTracsSession,
  listTracsSessions,
  sendTracsTurn,
  uploadTracsSyllabus,
} from '../lib/tracs';

/**
 * TRACS
 * =====
 *
 * A syllabus goes in; a conversation comes out. The conversation has exactly
 * two commands — `/test` and `/learn` — and everything either of them produces
 * is an ordinary UI document, drawn by the same renderer the lesson page uses.
 *
 * This page is only a host: it uploads, it sends turns, and it hands the
 * renderer the actions it needs. It deliberately contains no question-rendering
 * logic of its own, because a second rendering path would drift from the first
 * and the whole point of the engine is that there is one.
 */

const COMMANDS = [
  { command: '/test', label: '/test', hint: 'One question at a time', icon: ClipboardCheck },
  { command: '/learn', label: '/learn', hint: 'An explanation, then checks', icon: BookOpen },
];

/**
 * Turn a failed request into something a learner can act on.
 *
 * A 504 on `/learn` is the common failure here: authoring an explanation plus
 * its checking questions takes longer than a serverless gateway will wait. The
 * generic message ("Request failed (504)") reads like a bug in the page, when in
 * fact the work was likely done and only the reply was lost. Saying so — and
 * offering a retry that asks again — is the difference between "this is broken"
 * and "this timed out, try once more".
 */
function describeTurnFailure(error) {
  const status = Number(error?.status || 0);
  const slow = status === 504 || status === 502 || status === 408 || error?.code === 'ABORTED';

  if (slow) {
    return {
      title: 'That took too long and the connection was closed.',
      detail: 'Explanations are the slowest thing tracs does. Send /learn again — the work is often already saved, so the second attempt is quicker.',
    };
  }
  if (status === 401 || status === 403) {
    return { title: 'You are not signed in for this session.', detail: 'Sign in again, then reopen tracs from the sidebar.' };
  }
  if (status === 404) {
    return { title: 'This session no longer exists.', detail: 'It may have been deleted in another tab. Start a new one from the tracs page.' };
  }
  if (status === 0) {
    return { title: 'The server did not respond.', detail: 'Check your connection and send the command again.' };
  }
  return {
    title: 'That command could not be completed.',
    detail: error?.message || 'Try again, or send the other command.',
  };
}

/* -------------------------------------------------------------------------- */

function UploadPanel({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const submit = async (event) => {
    event?.preventDefault?.();
    if (!file && !text.trim()) {
      setError('Choose a syllabus file or paste its text.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await uploadTracsSyllabus({ file, text, title });
      onUploaded(result);
    } catch (err) {
      setError(err.message || 'The syllabus could not be read.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">tracs</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Upload your syllabus. It becomes a conversation with two commands:
          <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">/test</span>
          and
          <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">/learn</span>.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) setFile(dropped);
          }}
          className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.txt,.md"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            aria-label="Syllabus file"
          />
          <Upload className="mx-auto h-6 w-6 text-slate-400" aria-hidden />
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
            {file ? file.name : 'Drop a syllabus here, or choose a file'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">PDF, DOCX, PPTX, TXT or Markdown — up to 15 MB</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Choose file
          </button>
        </div>

        <details className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">
            No file? Paste the syllabus text
          </summary>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            placeholder={'## Unit 1: Python Basics\n- Variables\n- Loops\n- Functions'}
            className="mt-3 w-full rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </details>

        <div>
          <label htmlFor="tracs-title" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Name this session (optional)
          </label>
          <input
            id="tracs-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Semester 4 — Data Structures"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
          {busy ? 'Reading your syllabus…' : 'Start tracs'}
        </button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SessionList({ sessions, loading, onOpen, onDelete }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-slate-500 dark:text-slate-400">
        <Spinner className="mr-2 h-4 w-4" /> Loading your sessions…
      </div>
    );
  }
  if (!sessions.length) return null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Your sessions</h2>
      <ul className="space-y-2">
        {sessions.map((session) => (
          <li key={session.id}>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <button type="button" onClick={() => onOpen(session.id)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{session.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {session.stats?.topics || session.topics?.length || 0} topics · {session.stats?.answered || 0} answered
                </p>
              </button>
              <button
                type="button"
                onClick={() => onDelete(session.id)}
                aria-label={`Delete ${session.title}`}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ChatMessage({ entry, actions, onFollowUp, busy }) {
  const isUser = entry.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2 text-sm text-white shadow-sm">
          {entry.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[95%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {entry.pending ? (
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {entry.pending}
          </p>
        ) : (
          <>
            {entry.command ? (
              <p className="mb-2 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {entry.command}
              </p>
            ) : null}
            {entry.document ? (
              <DynamicRenderer document={entry.document} actions={actions} onFollowUp={onFollowUp} busy={busy} />
            ) : null}
          </>
        )}
        {entry.error ? (
          <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
            <p className="font-medium">{entry.error.title}</p>
            <p className="mt-0.5 text-rose-700/90 dark:text-rose-300/90">{entry.error.detail}</p>
            {entry.error.retry ? (
              <button
                type="button"
                onClick={entry.error.retry}
                className="mt-1.5 rounded border border-rose-300 px-2 py-0.5 font-medium text-rose-800 transition-colors hover:bg-rose-100 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-900/60"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export default function Tracs() {
  const { sessionId: routeSessionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [sessionId, setSessionId] = useState(routeSessionId || null);
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [listing, setListing] = useState(!routeSessionId);
  const [loading, setLoading] = useState(Boolean(routeSessionId));
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);

  /* ------------------------------ sessions ------------------------------ */

  useEffect(() => {
    let cancelled = false;
    if (routeSessionId) return undefined;
    setListing(true);
    listTracsSessions()
      .then((result) => {
        if (!cancelled) setSessions(result.sessions || []);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setListing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routeSessionId]);

  useEffect(() => {
    let cancelled = false;
    if (!routeSessionId) return undefined;
    setLoading(true);
    setError('');
    fetchTracsSession(routeSessionId)
      .then((result) => {
        if (cancelled) return;
        setSession(result.session);
        setMessages([
          {
            id: 'welcome',
            role: 'assistant',
            document: {
              version: '1.0',
              response_id: 'tracs_welcome',
              response_type: 'clarification',
              components: [
                {
                  id: 'welcome_text',
                  type: 'text',
                  content: `**${result.session.title}** is loaded with **${(result.session.topics || []).length} topics**.\n\nType \`/test\` for a question, or \`/learn\` for an explanation followed by checks. Nothing else is available here.`,
                },
              ],
            },
          },
        ]);
        // A session reloaded mid-question resumes on that question rather than
        // dropping the learner back to an empty chat.
        if (result.open_question?.question) {
          setMessages((current) => [
            ...current,
            {
              id: 'resume',
              role: 'assistant',
              command: 'resuming',
              document: {
                version: '1.0',
                response_id: 'tracs_resume',
                response_type: 'question_form',
                components: [
                  {
                    id: `resume_${result.open_question.question.id}`,
                    type: 'question_form',
                    title: result.open_question.topicTitle || 'In progress',
                    questions: [{ ...result.open_question.question, required: true }],
                    submission: { button_text: 'Submit answer', action: 'submit_ai_questions' },
                  },
                ],
              },
            },
          ]);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'That session could not be opened.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  /* ------------------------------- actions ------------------------------ */

  const send = useCallback(
    async ({ command, answer, questionId, optimistic }) => {
      if (!sessionId) return { ok: false };
      setBusy(true);
      const stamp = Date.now();
      if (optimistic) {
        setMessages((current) => [
          ...current,
          { id: `u-${stamp}`, role: 'user', text: optimistic },
          { id: `p-${stamp}`, role: 'assistant', pending: command === 'test' ? 'Preparing a question…' : 'Writing an explanation…' },
        ]);
      }
      try {
        const result = await sendTracsTurn(sessionId, { command, answer, question_id: questionId });
        setSession(result.session);
        setMessages((current) => [
          ...current.filter((entry) => !entry.pending),
          {
            id: `a-${stamp}`,
            role: 'assistant',
            command: `/${result.command}${result.outcome ? ` · ${result.outcome}` : ''}`,
            document: result.document,
          },
        ]);
        return { ok: true, result };
      } catch (err) {
        setMessages((current) => [
          ...current.filter((entry) => !entry.pending),
          { id: `e-${stamp}`, role: 'assistant', error: describeTurnFailure(err), document: null },
        ]);
        return { ok: false, reason: err.message };
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  /**
   * The two commands, as the renderer calls them.
   *
   * `submitAnswers` is how a `question_form` reports its answer. In tracs the
   * form always holds exactly one question, so the payload reduces to one
   * answer — which is sent as a `/test` or `/learn` turn and graded server-side.
   * The command is remembered per form id so an answer to a checking question
   * stays in `/learn` rather than jumping into the assessment loop.
   */
  const formCommands = useRef(new Map());

  const actions = useMemo(
    () => ({
      ...createDynamicActions({
        navigate,
        notify: (tone, message) => (tone === 'error' ? toast.error(message) : toast.info(message)),
        onContinue: async (metadata) => {
          const command = metadata?.command === 'learn' ? 'learn' : 'test';
          return send({ command, optimistic: `/${command}` });
        },
      }),
      submitAnswers: async (formId, payload) => {
        const answers = payload?.answers || [];
        const first = answers[0];
        const command = formCommands.current.get(formId) || (session?.mode === 'learn' ? 'learn' : 'test');
        const result = await send({
          command,
          answer: first?.value ?? '',
          questionId: first?.question_id,
          optimistic: typeof first?.value === 'string' ? first.value : String(first?.value ?? ''),
        });
        if (!result.ok) throw new Error(result.reason || 'That answer could not be submitted.');
        return { ok: true, evaluation: null };
      },
    }),
    [navigate, send, session?.mode, toast],
  );

  const runCommand = useCallback(
    (command) => {
      const name = command.replace('/', '');
      // A fresh command abandons any open question's mapping, which is correct:
      // the learner asked for something new.
      formCommands.current.clear();
      send({ command: name, optimistic: command });
    },
    [send],
  );

  const onFollowUp = useCallback(
    async (payload) => {
      // A follow-up form is a form: remember which command it belongs to, then
      // let the renderer submit it through `submitAnswers`.
      if (payload?.form_id) formCommands.current.set(payload.form_id, session?.mode === 'learn' ? 'learn' : 'test');
      return { ok: true };
    },
    [session?.mode],
  );

  const onSend = (event) => {
    event.preventDefault();
    const value = input.trim();
    if (!value || busy) return;

    // The composer accepts only the two commands. Anything else is refused with
    // a message that names them, rather than being treated as chat.
    const match = value.match(/^\/([a-z]+)\s*$/i);
    if (!match || !['test', 'learn'].includes(match[1].toLowerCase())) {
      setMessages((current) => [
        ...current,
        { id: `u-${Date.now()}`, role: 'user', text: value },
        {
          id: `r-${Date.now()}`,
          role: 'assistant',
          error: {
            title: 'Only /test and /learn are available here.',
            detail: 'Use /test for a question, or /learn for an explanation followed by checks.',
          },
          document: null,
        },
      ]);
      setInput('');
      return;
    }

    setInput('');
    runCommand(`/${match[1].toLowerCase()}`);
  };

  const openSession = (id) => {
    navigate(`/app/tracs/${id}`);
  };

  const handleUploaded = (result) => {
    setSession(result.session);
    navigate(`/app/tracs/${result.session.id}`);
  };

  const remove = async (id) => {
    try {
      await deleteTracsSession(id);
      setSessions((current) => current.filter((s) => s.id !== id));
      toast.info('Session deleted.');
    } catch (err) {
      toast.error(err.message || 'That session could not be deleted.');
    }
  };

  /* -------------------------------- views ------------------------------- */

  if (!routeSessionId && !sessionId) {
    return (
      <>
        <UploadPanel onUploaded={handleUploaded} />
        <SessionList sessions={sessions} loading={listing} onOpen={openSession} onDelete={remove} />
      </>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-slate-500 dark:text-slate-400">
        <Spinner className="mr-2 h-4 w-4" /> Opening your session…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>
        <button type="button" onClick={() => navigate('/app/tracs')} className="mt-3 text-sm font-medium text-brand-700 dark:text-brand-300">
          ← back to tracs
        </button>
      </div>
    );
  }

  const topics = session?.topics || [];
  const learned = topics.filter((t) => (t.mastery || 0) >= 3).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* A single line of context instead of the old topic sidebar: which
          syllabus this is, and how far through it the learner is. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 sm:px-4">
        <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={session?.title}>
          {session?.title}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {learned} of {topics.length} topics solid · {session?.stats?.answered || 0} answered
        </p>
      </div>

      <section className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
        <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
          {messages.map((entry) => (
            <ChatMessage key={entry.id} entry={entry} actions={actions} onFollowUp={onFollowUp} busy={busy} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* the only two commands */}
        <div className="border-t border-slate-200 bg-white px-3 pb-3 pt-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2 flex flex-wrap gap-2">
            {COMMANDS.map(({ command, hint, icon: Icon }) => (
              <button
                key={command}
                type="button"
                onClick={() => runCommand(command)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span className="font-mono">{command}</span>
                <span className="hidden text-slate-400 sm:inline">· {hint}</span>
              </button>
            ))}
          </div>

          <form onSubmit={onSend} className="flex items-end gap-2">
            <label htmlFor="tracs-input" className="sr-only">Command</label>
            <input
              id="tracs-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="/test or /learn"
              disabled={busy}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send command"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            </button>
          </form>
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            Only <span className="font-mono">/test</span> and <span className="font-mono">/learn</span> are available here.
          </p>
        </div>
      </section>
    </div>
  );
}
