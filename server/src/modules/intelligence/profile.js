import { getDb } from '../../db/index.js';
import { toOid } from '../classrooms/access.js';
import { clamp, round, average } from '../../utils/validation.js';

/**
 * Classroom-scoped student learning profile.
 *
 * Isolation rule: there is exactly ONE profile document per (userId, classroomId).
 * Nothing in this module ever reads or writes another classroom's profile, so a
 * learner's Java profile can never leak into their Machine Learning profile.
 */

export function emptyProfile(userId, classroomId) {
  const now = new Date();
  return {
    userId: toOid(userId),
    classroomId: toOid(classroomId),
    knowledgeLevel: 'beginner',
    learningSpeed: { label: 'steady', score: 50, samples: 0 },
    independence: { score: 0, hintsPerSession: 0, unaidedSuccessRate: 0, totalHints: 0, totalAttempts: 0 },
    mastery: [],
    stats: {
      sessions: 0,
      messages: 0,
      assessmentsTaken: 0,
      practicalSolved: 0,
      totalStudyMinutes: 0,
      streakDays: 0,
      lastStudyDay: null,
      hintsUsedTotal: 0,
    },
    weaknessCounts: { knowledge_gap: 0, misconception: 0, practical_difficulty: 0, repeated_error: 0 },
    timeline: [],
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getOrCreateProfile(userId, classroomId) {
  const db = getDb();
  const uid = toOid(userId);
  const cid = toOid(classroomId);
  const existing = await db.collection('student_learning_profiles').findOne({ userId: uid, classroomId: cid });
  if (existing) return existing;
  const doc = emptyProfile(uid, cid);
  await db.collection('student_learning_profiles').insertOne(doc);
  return { ...doc, _id: (await db.collection('student_learning_profiles').findOne({ userId: uid, classroomId: cid }))._id };
}

export function masteryLevel(score) {
  if (score >= 85) return 'mastered';
  if (score >= 70) return 'secure';
  if (score >= 45) return 'developing';
  if (score > 0) return 'emerging';
  return 'not_started';
}

export function levelFromScore(score) {
  if (score >= 80) return 'advanced';
  if (score >= 60) return 'proficient';
  if (score >= 35) return 'developing';
  return 'beginner';
}

/**
 * Applies one piece of evidence to the topic-mastery record.
 * Evidence is weighted: independent success > hinted success > failure.
 */
export async function applyMasteryEvidence({
  userId,
  classroomId,
  conceptId,
  unitId,
  subjectId,
  correct,
  hinted = false,
  weight = 1,
  source = 'tutor',
}) {
  const db = getDb();
  const uid = toOid(userId);
  const cid = toOid(classroomId);
  const conId = toOid(conceptId);
  if (!conId) return null;
  const now = new Date();
  const existing = await db.collection('topic_mastery').findOne({ userId: uid, classroomId: cid, conceptId: conId });

  // EMA-style scoring: recent evidence dominates but history is not lost.
  const alpha = clamp(0.35 * weight, 0.12, 0.6);
  const prevScore = existing?.score ?? 40;
  const target = correct ? (hinted ? 62 : 88) : 22;
  const newScore = clamp(round(prevScore + (target - prevScore) * alpha, 1), 0, 100);

  const last10 = [...(existing?.last10 || []), { correct: Boolean(correct), hinted: Boolean(hinted), source, at: now }].slice(-10);
  const doc = {
    userId: uid,
    classroomId: cid,
    conceptId: conId,
    unitId: toOid(unitId) || existing?.unitId || null,
    subjectId: toOid(subjectId) || existing?.subjectId || null,
    score: newScore,
    level: masteryLevel(newScore),
    evidenceCount: (existing?.evidenceCount || 0) + 1,
    correct: (existing?.correct || 0) + (correct ? 1 : 0),
    incorrect: (existing?.incorrect || 0) + (correct ? 0 : 1),
    independentCorrect: (existing?.independentCorrect || 0) + (correct && !hinted ? 1 : 0),
    hintedCorrect: (existing?.hintedCorrect || 0) + (correct && hinted ? 1 : 0),
    last10,
    trend:
      last10.length >= 4
        ? round(
            average(last10.slice(-2).map((e) => (e.correct ? 100 : 0))) -
              average(last10.slice(0, last10.length - 2).map((e) => (e.correct ? 100 : 0))),
            1,
          )
        : 0,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  };
  await db.collection('topic_mastery').updateOne(
    { userId: uid, classroomId: cid, conceptId: conId },
    { $set: doc },
    { upsert: true },
  );
  return doc;
}

export async function getTopicMastery(userId, classroomId, conceptId) {
  const db = getDb();
  return db.collection('topic_mastery').findOne({
    userId: toOid(userId),
    classroomId: toOid(classroomId),
    conceptId: toOid(conceptId),
  });
}

export async function listTopicMastery(userId, classroomId) {
  const db = getDb();
  return db
    .collection('topic_mastery')
    .find({ userId: toOid(userId), classroomId: toOid(classroomId) })
    .toArray();
}

/** Recomputes knowledge level, learning speed, independence + timeline point. */
export async function refreshProfileAggregates(userId, classroomId, patch = {}) {
  const db = getDb();
  const uid = toOid(userId);
  const cid = toOid(classroomId);
  const profile = await getOrCreateProfile(uid, cid);
  const mastery = await listTopicMastery(uid, cid);
  const gaps = await db
    .collection('knowledge_gaps')
    .find({ userId: uid, classroomId: cid, status: { $ne: 'resolved' } })
    .toArray();

  const avgMastery = mastery.length ? average(mastery.map((m) => m.score)) : 0;
  const evidenceTotal = mastery.reduce((a, m) => a + (m.evidenceCount || 0), 0);
  const independentCorrect = mastery.reduce((a, m) => a + (m.independentCorrect || 0), 0);
  const hintedCorrect = mastery.reduce((a, m) => a + (m.hintedCorrect || 0), 0);
  const incorrect = mastery.reduce((a, m) => a + (m.incorrect || 0), 0);

  // Learning speed: mastery gained per unit of evidence, normalised.
  const speedScore = evidenceTotal ? clamp(round((avgMastery / 100) * 60 + Math.min(40, evidenceTotal * 2), 1), 0, 100) : 50;
  const speedLabel = speedScore >= 72 ? 'fast' : speedScore >= 42 ? 'steady' : 'slow';

  const unaided = independentCorrect + hintedCorrect + incorrect;
  const unaidedSuccessRate = unaided ? round((independentCorrect / unaided) * 100, 1) : 0;
  const hintsPerSession = profile.stats.sessions ? round((profile.stats.hintsUsedTotal || 0) / profile.stats.sessions, 1) : 0;
  const independenceScore = clamp(
    round(unaidedSuccessRate * 0.7 + Math.max(0, 30 - hintsPerSession * 6), 1),
    0,
    100,
  );

  const strengthByCategory = { knowledge_gap: 0, misconception: 0, practical_difficulty: 0, repeated_error: 0 };
  for (const g of gaps) strengthByCategory[g.category] = (strengthByCategory[g.category] || 0) + 1;

  const timeline = [...(profile.timeline || [])];
  const today = new Date().toISOString().slice(0, 10);
  const point = { date: today, masteryScore: round(avgMastery, 1), independenceScore, gapCount: gaps.length };
  const lastPoint = timeline[timeline.length - 1];
  if (lastPoint && lastPoint.date === today) timeline[timeline.length - 1] = point;
  else timeline.push(point);

  const update = {
    knowledgeLevel: levelFromScore(avgMastery || 40),
    learningSpeed: { label: speedLabel, score: speedScore, samples: evidenceTotal },
    independence: {
      ...profile.independence,
      score: independenceScore,
      hintsPerSession,
      unaidedSuccessRate,
    },
    mastery: mastery
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 120)
      .map((m) => ({
        conceptId: m.conceptId,
        score: m.score,
        level: m.level,
        attempts: m.evidenceCount,
        lastAssessedAt: m.updatedAt,
        trend: m.trend || 0,
      })),
    weaknessCounts: strengthByCategory,
    timeline: timeline.slice(-60),
    lastActivityAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  };
  await db.collection('student_learning_profiles').updateOne({ _id: profile._id }, { $set: update });
  return { ...profile, ...update };
}

export function confidenceFromOccurrences(occurrences, baseConfidence) {
  return round(clamp(baseConfidence + Math.min(0.25, (occurrences - 1) * 0.06), 0, 0.99), 2);
}

export function severityFor(category, occurrences) {
  if (category === 'repeated_error') return occurrences >= 3 ? 'critical' : occurrences >= 2 ? 'high' : 'medium';
  if (occurrences >= 4) return 'high';
  if (occurrences >= 2) return 'medium';
  return 'low';
}
