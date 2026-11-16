import { ArrowRight, BookOpen, ClipboardCheck, Loader2 } from 'lucide-react';

/**
 * THE EXTRACTED SYLLABUS, BEFORE THE CHAT
 * =======================================
 *
 * Uploading a syllabus used to drop the learner straight into a chat with no
 * idea what had been read out of their document. This shows the extraction in
 * the form it was actually parsed into — units of concepts:
 *
 *   ### Unit 1: Java Fundamentals
 *   - Variables and primitive types
 *   - Operators and expressions
 *
 * and then asks the question the chat would otherwise have to guess at: which
 * unit do you want to study?
 *
 * The units come from the server's own parse, so what is listed here is exactly
 * what will be tested. Nothing is re-derived on the client.
 */
export default function SyllabusReview({ units = [], onChoose, chosen = null, busyUnit = null, title = '' }) {
  if (!units.length) return null;

  return (
    <section className="mx-auto w-full max-w-2xl px-4 pb-2" aria-label="Extracted syllabus">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title ? `What we read from “${title}”` : 'What we read from your syllabus'}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {units.length} unit{units.length === 1 ? '' : 's'} · {units.reduce((n, u) => n + u.concepts.length, 0)} concepts.
          Choose the unit you want to work on.
        </p>
      </header>

      <div className="space-y-3">
        {units.map((unit) => {
          const isChosen = chosen?.title === unit.title;
          return (
            <div
              key={`${unit.index}-${unit.title}`}
              className={`rounded-xl border p-3 transition-colors ${
                isChosen
                  ? 'border-brand-400 bg-brand-50/50 dark:border-brand-700 dark:bg-brand-950/30'
                  : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Unit {unit.index}: {unit.title}
                  </h3>
                  <ul className="mt-1.5 space-y-0.5">
                    {unit.concepts.map((concept) => (
                      <li key={concept.id} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <span aria-hidden className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                        {concept.title}
                      </li>
                    ))}
                  </ul>
                </div>

                {isChosen ? (
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => onChoose(unit, 'learn')}
                      disabled={Boolean(busyUnit)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
                    >
                      {busyUnit === 'learn' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <BookOpen className="h-3 w-3" aria-hidden />}
                      Learn
                    </button>
                    <button
                      type="button"
                      onClick={() => onChoose(unit, 'test')}
                      disabled={Boolean(busyUnit)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {busyUnit === 'test' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <ClipboardCheck className="h-3 w-3" aria-hidden />}
                      Test
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChoose(unit, null)}
                    disabled={Boolean(busyUnit)}
                    className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Choose
                    <ArrowRight className="ml-1 inline h-3 w-3" aria-hidden />
                  </button>
                )}
              </div>

              {isChosen ? (
                <p className="mt-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  <strong className="font-medium">Learn</strong> explains the unit’s concepts, then tests them.
                  <strong className="ml-1 font-medium">Test</strong> skips the explanation and goes straight to questions.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
