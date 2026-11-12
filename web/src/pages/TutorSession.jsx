import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Lightbulb,
  Send,
  Sparkles,
  Target,
  X,
  XCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api } from '../lib/api';
import { Badge, ErrorBanner, LoadingBlock, Spinner, cx, useToast } from '../components/ui';
import { VisualBlocks, VisualHint } from '../components/visuals';
import { categoryStyles, levelStyles, timeAgo } from '../lib/format';

export default function TutorSession() {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [session, setSession] = useState(location.state?.fresh || null);
  const [messages, setMessages] = useState(location.state?.fresh?.messages || []);
  const [context, setContext] = useState(location.state?.fresh?.context || null);
  const [profile, setProfile] = useState(location.state?.fresh?.profile || null);
  const [intelligence, setIntelligence] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hintOpen, setHintOpen] = useState(null);
  const [showHints, setShowHints] = useState(false);
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api(`/tutor/sessions/${sessionId}`);
      setSession(res.session);
      setMessages(res.messages);
      setContext(res.context);
    } catch (e) {
      setError(e.message);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!location.state?.fresh) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  const send = async (signalOverride) => {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setError('');
    setInput('');
    const optimistic = { id: `tmp-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await api(`/tutor/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: { content, signal: signalOverride },
      });
      if (res.blocked) {
        setMessages((m) => [...m, res.message]);
        return;
      }
      setMessages((m) => [...m, res.message]);
      setIntelligence(res.intelligence);
      if (res.intelligence?.gapsDetected?.length) {
        const severe = res.intelligence.gapsDetected.filter((g) => ['high', 'critical'].includes(g.severity));
        if (severe.length) toast.info(`${severe.length} weakness${severe.length > 1 ? 'es' : ''} recorded from this answer`);
      }
      if (res.intelligence?.recommendAssessment) {
        toast.info('The AI recommends a short assessment');
      }
    } catch (e) {
      setError(e.message);
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(content);
    } finally {
      setBusy(false);
    }
  };

  const signalSend = (signal, label) => {
    const content = input.trim();
    if (!content) {
      setError('Write your answer first, then mark how confident you are.');
      return;
    }
    send(signal);
    toast.info(label);
  };

  const endSession = async () => {
    try {
      await api(`/tutor/sessions/${sessionId}/end`, { method: 'POST' });
      toast.success('Session ended — your records are saved');
      navigate(`/app/progress`);
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (error && !session) return <ErrorBanner message={error} />;
  if (!session) return <LoadingBlock rows={5} />;

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const hints = lastAssistant?.meta?.hints || [];
  const recommendation = intelligence?.recommendAssessment || lastAssistant?.meta?.assessmentRecommendation;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="flex min-h-[calc(100vh-9rem)] flex-col">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <button onClick={() => navigate('/app/start')} className="btn-ghost -ml-2 btn-sm">
              <ArrowLeft className="h-3.5 w-3.5" /> New session
            </button>
            <h1 className="mt-1 truncate text-lg font-semibold text-slate-900 dark:text-white">{context?.concept?.name || 'Learning session'}</h1>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {context?.classroom?.name} · {context?.unit?.name} · {session.modeLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={session.scaffoldingLevel === 'independent' ? 'success' : session.scaffoldingLevel === 'guided' ? 'warning' : 'brand'}>
              {session.scaffoldingLevel} support
            </Badge>
            <button onClick={endSession} className="btn-secondary btn-sm">
              End session
            </button>
          </div>
        </div>

        <div className="card flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {busy ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Spinner /> The tutor is thinking…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <div className="px-4 pb-2">
              <ErrorBanner message={error} onDismiss={() => setError('')} />
            </div>
          ) : null}

          {recommendation?.recommend ? (
            <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="flex items-start gap-2">
                <Target className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">Assessment recommended</p>
                  <p className="text-[11px] text-amber-800 dark:text-amber-300">{recommendation.reason}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Link to={`/app/assessments?concept=${context?.concept?.id}&classroom=${context?.classroom?.id}`} className="btn-primary btn-sm">
                  Take assessment
                </Link>
              </div>
            </div>
          ) : null}

          {hints.length ? (
            <div className="border-t border-slate-100 px-4 pt-2 dark:border-slate-800">
              <button onClick={() => setShowHints((s) => !s)} className="flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400">
                <Lightbulb className="h-3.5 w-3.5" />
                {showHints ? 'Hide' : 'Show'} progressive hints ({hints.length})
                <ChevronDown className={cx('h-3 w-3 transition-transform', showHints && 'rotate-180')} />
              </button>
              {showHints ? (
                <ol className="mt-2 space-y-1.5">
                  {hints.map((h, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-200">
                      <span className="mr-1.5 font-semibold uppercase tracking-wide text-slate-500">{h.level}</span>
                      {hintOpen === i || i === 0 ? h.text : <button onClick={() => setHintOpen(i)} className="link">Reveal hint {i + 1}</button>}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}

          <div className="border-t border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-end gap-2">
              <textarea
                className="input max-h-40 min-h-[44px] resize-y"
                rows={2}
                placeholder="Explain your thinking, or answer the tutor's question…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={busy}
              />
              <button onClick={() => send()} className="btn-primary h-11 px-3" disabled={busy || !input.trim()} aria-label="Send message">
                {busy ? <Spinner /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">Evidence for the gap engine:</span>
              <button onClick={() => signalSend({ correct: true, independent: true }, 'Recorded as independent success')} className="chip text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" /> I solved it myself
              </button>
              <button onClick={() => signalSend({ correct: true, hintUsed: true }, 'Recorded as success with hints')} className="chip text-brand-700 dark:text-brand-400">
                <Lightbulb className="h-3 w-3" /> Got it with a hint
              </button>
              <button onClick={() => signalSend({ wrongAnswer: true }, 'Recorded as an incorrect attempt')} className="chip text-rose-700 dark:text-rose-400">
                <XCircle className="h-3 w-3" /> I got it wrong
              </button>
            </div>
          </div>
        </div>
      </div>

      <aside className="space-y-3">
        <div className="card card-pad">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Learning profile</h2>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">This classroom only</p>
          {profile ? (
            <div className="mt-3 space-y-2 text-sm">
              <Row label="Level" value={<span className={cx('badge', levelStyles[profile.knowledgeLevel])}>{profile.knowledgeLevel}</span>} />
              <Row label="Learning speed" value={`${profile.learningSpeed?.label} (${profile.learningSpeed?.score})`} />
              <Row label="Independence" value={`${profile.independence?.score ?? 0}/100`} />
              <Row label="Concept mastery" value={profile.conceptMastery === null || profile.conceptMastery === undefined ? 'Not assessed' : `${profile.conceptMastery}%`} />
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Profile loads after the first session.</p>
          )}
          {profile?.openGaps?.length ? (
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Known gaps</p>
              <ul className="mt-1.5 space-y-1.5">
                {profile.openGaps.slice(0, 4).map((g, i) => (
                  <li key={i} className="text-xs">
                    <span className={cx('badge border', categoryStyles[g.category])}>{g.category.replace('_', ' ')}</span>
                    <p className="mt-0.5 line-clamp-2 text-slate-600 dark:text-slate-300">{g.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {intelligence ? (
          <div className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Last turn</h2>
            <div className="mt-2 space-y-2 text-xs">
              <Row label="Support" value={intelligence.scaffoldingLevel} />
              {intelligence.mastery ? <Row label="Mastery" value={`${intelligence.mastery.score}% (${intelligence.mastery.level})`} /> : null}
              {intelligence.recommendAssessment ? <Row label="Assessment" value="Recommended" /> : null}
            </div>
            {intelligence.gapsDetected?.length ? (
              <ul className="mt-2 space-y-1.5">
                {intelligence.gapsDetected.map((g) => (
                  <li key={g.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                    <span className={cx('badge border', categoryStyles[g.category])}>{g.category.replace('_', ' ')}</span>
                    <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{g.description}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {context?.concept ? (
          <div className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Syllabus concept</h2>
            <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">{context.concept.description || 'No description in the syllabus.'}</p>
            {context.concept.objectives?.length ? (
              <>
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Objectives</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600 dark:text-slate-300">
                  {context.concept.objectives.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right text-xs font-medium text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const [visualsOpen, setVisualsOpen] = useState(true);
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2.5 text-sm text-white">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }
  const meta = message.meta || {};
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="prose-tutor max-w-none text-sm text-slate-700 dark:text-slate-200">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        {meta.visuals?.length ? (
          <>
            <VisualHint count={meta.visuals.length} open={visualsOpen} onToggle={() => setVisualsOpen((v) => !v)} />
            {visualsOpen ? <VisualBlocks blocks={meta.visuals} /> : null}
          </>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {meta.scaffoldingLevel ? <Badge tone={meta.scaffoldingLevel === 'independent' ? 'success' : meta.scaffoldingLevel === 'guided' ? 'warning' : 'brand'}>{meta.scaffoldingLevel}</Badge> : null}
          {meta.difficultyShift && meta.difficultyShift !== 'steady' ? <Badge tone={meta.difficultyShift === 'harder' ? 'violet' : 'neutral'}>{meta.difficultyShift}</Badge> : null}
          {meta.citations?.length ? <span className="text-[11px] text-slate-400">Grounded in: {meta.citations.slice(0, 2).join(', ')}</span> : null}
          {meta.simulated ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400" title="No NVIDIA API key configured — deterministic local analysis adapter in use">
              <AlertTriangle className="h-3 w-3" /> local analyser
            </span>
          ) : null}
        </div>
        {meta.followUpQuestion ? (
          <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            <span className="font-semibold">Next: </span>
            {meta.followUpQuestion}
          </p>
        ) : null}
      </div>
    </div>
  );
}
