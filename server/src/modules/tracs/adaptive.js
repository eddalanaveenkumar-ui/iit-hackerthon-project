/**
 * THE ADAPTIVE TEST
 * =================
 *
 * A test used to be one form of 5–15 questions. A form has a fatal property for
 * diagnosis: every question is chosen before the first answer exists. Nothing
 * the learner writes can change what comes next, so the "test" cannot follow a
 * wrong answer down the branch where the misunderstanding actually lives — it
 * just collects a fixed sample and reports on it.
 *
 * This module owns the opposite: one question at a time, where the next question
 * is chosen *from the answer just given*.
 *
 * The plan
 *   Every concept in the unit is probed once. That is the finish line, so the
 *   length is the unit's size (bounded), not a number picked in advance.
 *
 * The direction
 *   - A miss on a concept earns it a *probe*: a second, different question on
 *     the same concept, which is what separates "misconception" (wrong the same
 *     way twice, or wrong on the specific claim being tested) from "knowledge
 *     gap" (never had it) and "practical difficulty" (knew it, could not do it).
 *   - A correct answer retires the concept, and the next unprobed concept is
 *     asked — usually the one nearest what was just shown, so the test moves
 *     through related ideas rather than jumping.
 *
 * Nothing is shown between questions. A wrong answer is *recorded*, not
 * announced, so the direction can change without telling the learner which way
 * it changed — which is the difference between testing and coaching.
 */

/** How many questions a concept may take before the test moves on regardless. */
export const MAX_ATTEMPTS_PER_CONCEPT = 2;

/** The floor and ceiling on a test, whatever the unit's size. */
export const TEST_LIMITS = Object.freeze({ min: 4, max: 15 });

/**
 * Begin a test over a unit's concepts.
 *
 * @param {Array<{id,title}>} concepts  the chosen unit's concepts, in syllabus order
 * @returns {{order: string[], probed: string[], current: string|null}}
 */
export function beginTest(concepts = []) {
  const order = (concepts || []).map((c) => c.id).filter(Boolean);
  return { order, probed: [], attempts: {}, answers: [], current: null, finished: false };
}

/**
 * Choose the first concept to ask about.
 *
 * The syllabus order is the default, but a concept the learner has already
 * struggled with goes first: it is the one whose state is most in doubt, and
 * asking it early means the rest of the test can rely on the answer.
 */
export function firstConcept(concepts = [], topics = []) {
  const list = (concepts || []).filter((c) => c && c.id);
  if (!list.length) return null;
  const byId = new Map((topics || []).map((t) => [t.id, t]));
  const weakest = [...list].sort((a, b) => {
    const ta = byId.get(a.id) || {};
    const tb = byId.get(b.id) || {};
    // Never answered correctly first, then lowest mastery, then syllabus order.
    const seenA = ta.correct ? 1 : 0;
    const seenB = tb.correct ? 1 : 0;
    return seenA - seenB || (ta.mastery || 0) - (tb.mastery || 0);
  })[0];
  return weakest.id;
}

/**
 * What to ask next, given the answer just given.
 *
 * This function owns the plan: it returns the next state as well as the next
 * concept, so the caller never has to re-derive how many times a concept has
 * been asked. Getting that count wrong in two places is exactly how a "probe the
 * concept you just missed" rule silently stops probing.
 *
 * @param {object} state     the plan (`{probed, attempts, answers, finished}`)
 * @param {object} last      `{conceptId, verdict, verified}` for the answer just graded
 * @param {Array}  concepts  the unit's concepts, in syllabus order
 * @returns {{state, conceptId, reason, done}}
 */
export function nextStep(state, last, concepts = []) {
  const plan = {
    probed: [...(state?.probed || [])],
    attempts: { ...(state?.attempts || {}) },
    answers: [...(state?.answers || [])],
    finished: Boolean(state?.finished),
  };
  const list = (concepts || []).filter((c) => c && c.id);
  const asked = last?.conceptId || null;

  if (asked) {
    // One question was just asked about `asked`, and it has been answered.
    plan.attempts[asked] = (plan.attempts[asked] || 0) + 1;
    if (!plan.probed.includes(asked)) plan.probed.push(asked);
    plan.answers.push({ conceptId: asked, verdict: last.verdict ?? null, verified: last.verified !== false });
    plan.current = asked;
  }

  // A miss earns one more question on the same concept. Only a *judged* wrong
  // answer counts: an answer the server could not grade says nothing about the
  // learner, so re-asking would punish them for an outage.
  const judgedWrong = last
    && last.verified !== false
    && last.verdict
    && !['correct', 'not_graded', 'unanswered'].includes(last.verdict);

  if (asked && judgedWrong && plan.attempts[asked] < MAX_ATTEMPTS_PER_CONCEPT) {
    return { state: plan, conceptId: asked, reason: 'probe_same_concept', done: false };
  }

  const remaining = list.filter((c) => !plan.probed.includes(c.id));
  if (!remaining.length) {
    plan.finished = true;
    return { state: plan, conceptId: null, reason: 'unit_covered', done: true };
  }
  if (plan.answers.length >= TEST_LIMITS.max) {
    plan.finished = true;
    return { state: plan, conceptId: null, reason: 'reached_ceiling', done: true };
  }

  // Prefer a concept adjacent to the one just asked: a test that walks related
  // ideas produces answers that can be compared, while one that jumps at random
  // produces a scatter of unrelated misses that diagnoses nothing.
  const lastIndex = list.findIndex((c) => c.id === asked);
  const ordered = [...remaining].sort((a, b) => {
    const ia = list.findIndex((c) => c.id === a.id);
    const ib = list.findIndex((c) => c.id === b.id);
    return Math.abs(ia - lastIndex) - Math.abs(ib - lastIndex) || ia - ib;
  });
  return { state: plan, conceptId: ordered[0].id, reason: 'next_concept', done: false };
}

/**
 * Whether a test has asked enough to be worth reporting on.
 *
 * The floor matters: a three-question test that happens to cover a three-concept
 * unit cannot distinguish the three categories, and reporting confidently on it
 * would be inventing precision.
 */
export function isComplete(state, concepts = []) {
  const total = Math.min(Math.max((concepts || []).length, TEST_LIMITS.min), TEST_LIMITS.max);
  const answered = (state?.answers || []).length;
  if (state?.finished) return true;
  return answered >= total;
}

/**
 * How many questions this test will ask at most, given the unit.
 *
 * Every concept once, plus one probe per concept that was missed, is the worst
 * case — which is why it is capped rather than passed through.
 */
export function testCeiling(concepts = []) {
  const n = (concepts || []).length || TEST_LIMITS.min;
  return Math.min(TEST_LIMITS.max, Math.max(TEST_LIMITS.min, n * MAX_ATTEMPTS_PER_CONCEPT));
}
