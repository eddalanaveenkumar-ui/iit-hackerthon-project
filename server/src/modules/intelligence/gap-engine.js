import { getDb } from '../../db/index.js';
import { toOid } from '../classrooms/access.js';
import { runJsonTask } from '../ai/orchestrator.js';
import { prompts } from '../ai/prompts.js';
import { confidenceFromOccurrences, severityFor } from './profile.js';
import { round } from '../../utils/validation.js';

/**
 * Knowledge Gap Detection Engine.
 *
 * Separate intelligence module: takes EVIDENCE (not self-reports), asks the
 * gap-detection model for findings, merges them with rule-engine signals and
 * persists deduplicated weakness records with severity, confidence and
 * improvement tracking.
 *
 * Categories: knowledge_gap | misconception | practical_difficulty | repeated_error
 */

/** Cheap text similarity used for de-duplicating detected weaknesses. */
function similarity(a, b) {
  const norm = (t) => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  const A = norm(a);
  const B = norm(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.max(A.size, B.size);
}

const CATEGORY_TO_COLLECTION = {
  knowledge_gap: 'knowledge_gaps',
  misconception: 'misconceptions',
  practical_difficulty: 'practical_difficulties',
  repeated_error: 'knowledge_gaps',
};

export async function getOpenGaps(userId, classroomId, { conceptId, limit = 20 } = {}) {
  const db = getDb();
  const query = {
    userId: toOid(userId),
    classroomId: toOid(classroomId),
    status: { $ne: 'resolved' },
  };
  if (conceptId) query.conceptId = toOid(conceptId);
  const gaps = await db.collection('knowledge_gaps').find(query).sort({ lastDetectedAt: -1 }).limit(limit).toArray();
  const misc = await db.collection('misconceptions').find({ ...query }).sort({ lastDetectedAt: -1 }).limit(limit).toArray();
  const practical = await db
    .collection('practical_difficulties')
    .find({ ...query })
    .sort({ lastDetectedAt: -1 })
    .limit(limit)
    .toArray();
  return [...gaps, ...misc, ...practical].sort((a, b) => new Date(b.lastDetectedAt) - new Date(a.lastDetectedAt));
}

function normaliseFinding(f, ctx) {
  const category = ['knowledge_gap', 'misconception', 'practical_difficulty', 'repeated_error'].includes(f.category)
    ? f.category
    : 'knowledge_gap';
  const sev = ['low', 'medium', 'high', 'critical'].includes(f.severity) ? f.severity : 'medium';
  return {
    category,
    description: String(f.description || '').slice(0, 600).trim(),
    severity: sev,
    confidence: round(Math.min(0.99, Math.max(0.05, Number(f.confidence) || 0.6)), 2),
    evidence: f.evidence ? String(f.evidence).slice(0, 800) : '',
    conceptId: ctx.conceptId,
    unitId: ctx.unitId,
    subjectId: ctx.subjectId,
  };
}

/**
 * Records a finding with de-duplication: the same weakness on the same concept
 * in the same category increments occurrences instead of creating noise, and
 * raises severity/confidence.
 */
export async function recordGap({
  userId,
  classroomId,
  subjectId,
  unitId,
  conceptId,
  category,
  description,
  descriptionKey,
  evidence,
  severity = 'low',
  confidence = 0.6,
  detectedBy = 'ai',
  evidenceRef,
  evidenceType = 'message',
}) {
  const db = getDb();
  const uid = toOid(userId);
  const cid = toOid(classroomId);
  const conId = toOid(conceptId);
  const now = new Date();
  const collectionName = CATEGORY_TO_COLLECTION[category] || 'knowledge_gaps';
  const key = String(descriptionKey || description || '').trim().toLowerCase().slice(0, 140);

  const openInCategory = await db
    .collection(collectionName)
    .find({ userId: uid, classroomId: cid, conceptId: conId, category, status: { $ne: 'resolved' } })
    .toArray();
  const existing = openInCategory.find((g) => (g.descKey || g.description) && similarity(g.descKey || g.description, key) >= 0.6);

  if (existing) {
    const occurrences = (existing.occurrences || 1) + 1;
    const newSeverity = severityRank(severityFor(category, occurrences), existing.severity);
    const newConfidence = confidenceFromOccurrences(occurrences, Math.max(confidence, existing.confidence || 0.6));
    const improved = new Date(existing.lastDetectedAt).getTime() - new Date(existing.firstDetectedAt).getTime() > 86_400_000;
    const update = {
      occurrences,
      severity: newSeverity,
      confidence: newConfidence,
      lastDetectedAt: now,
      status: improved ? 'improving' : existing.status,
      evidence: [...(existing.evidence || []).slice(-9), { type: evidenceType, refId: evidenceRef ? String(evidenceRef) : null, excerpt: String(evidence || '').slice(0, 500), at: now }],
      improvementHistory: [...(existing.improvementHistory || []).slice(-19), { at: now, severity: newSeverity, confidence: newConfidence, note: `repeat #${occurrences}` }],
    };
    await db.collection(collectionName).updateOne({ _id: existing._id }, { $set: update });
    return { ...existing, ...update, repeated: true };
  }

  const doc = {
    userId: uid,
    classroomId: cid,
    subjectId: toOid(subjectId) || null,
    unitId: toOid(unitId) || null,
    conceptId: conId,
    topicId: `${subjectId || 'na'}/${unitId || 'na'}/${conceptId || 'na'}`,
    category,
    descKey: key,
    description: String(description || '').slice(0, 600),
    evidence: [{ type: evidenceType, refId: evidenceRef ? String(evidenceRef) : null, excerpt: String(evidence || '').slice(0, 500), at: now }],
    severity,
    confidence,
    occurrences: 1,
    status: 'open',
    detectedBy,
    firstDetectedAt: now,
    lastDetectedAt: now,
    resolvedAt: null,
    improvementHistory: [{ at: now, severity, confidence, note: 'first detected' }],
  };
  const { insertedId } = await db.collection(collectionName).insertOne(doc);
  return { _id: insertedId, ...doc, repeated: false };
}

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];
function severityRank(a, b) {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b || 'low') ? a : b;
}

/** Builds a de-duplication key that keeps different issues on one concept distinct. */
function ruleKey(prefix, text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5)
    .join(' ');
  return `${prefix} ${words}`;
}

/**
 * Full analysis pass for one interaction.
 * Combines deterministic rule signals (accepted instantly, no AI needed) with
 * one structured AI call for the semantic findings.
 */
export async function analyseInteraction({
  userId,
  classroomId,
  concept,
  text,
  signal = {},
  context = {},
  evidenceRef,
}) {
  const db = getDb();
  const recorded = [];
  const now = new Date();

  // ---- Rule engine: zero-latency deterministic detections -------------------
  if (signal.wrongAnswer && signal.repeatedMistake) {
    recorded.push(
      await recordGap({
        userId,
        classroomId,
        subjectId: concept.subjectId,
        unitId: concept.unitId,
        conceptId: concept.id,
        category: 'repeated_error',
        description: `Repeating the same incorrect approach to ${concept.name} — ${String(signal.excerpt || text).slice(0, 120)}`,
        evidence: signal.excerpt || text,
        descriptionKey: ruleKey(`repeated-error ${concept.name}`, text),
        severity: 'high',
        confidence: 0.9,
        detectedBy: 'rule_engine',
        evidenceRef,
      }),
    );
  }
  if (signal.selfReportOnly) {
    recorded.push(
      await recordGap({
        userId,
        classroomId,
        subjectId: concept.subjectId,
        unitId: concept.unitId,
        conceptId: concept.id,
        category: 'knowledge_gap',
        description: `Declared understanding of ${concept.name} without demonstrating it with an answer or example — "${String(text).slice(0, 90)}"`,
        evidence: text,
        descriptionKey: ruleKey(`self-report ${concept.name}`, text),
        severity: 'low',
        confidence: 0.55,
        detectedBy: 'rule_engine',
        evidenceRef,
      }),
    );
  }

  // ---- AI analysis ---------------------------------------------------------
  const { data, meta } = await runJsonTask('gap_detection', {
    messages: prompts.gaps({
      context: { ...context, concept },
      evidence: JSON.stringify(
        {
          studentMessage: text,
          signals: signal,
          priorGaps: (context.openGaps || []).slice(0, 5).map((g) => ({ category: g.category, description: g.description, occurrences: g.occurrences })),
        },
        null,
        2,
      ),
    }),
    meta: { task: 'gap_analysis', concept, signal, conceptId: concept.id, evidenceText: text, retrieved: context.retrieved },
    feature: 'gap_detection',
    userId,
    classroomId,
  });

  const findings = Array.isArray(data?.findings) ? data.findings : [];
  const persisted = [];
  for (const raw of findings.slice(0, 5)) {
    const f = normaliseFinding(raw, { conceptId: concept.id, unitId: concept.unitId, subjectId: concept.subjectId });
    if (!f.description || f.confidence < 0.35) continue;
    // Avoid re-recording what was already captured this turn (fuzzy match), and
    // never duplicate a repeated_error for a concept that the rule engine
    // already recorded — repeated errors are concept-level findings.
    if (recorded.some((r) => r.category === f.category && similarity(r.description, f.description) >= 0.6)) continue;
    if (f.category === 'repeated_error' && recorded.some((r) => r.category === 'repeated_error')) continue;
    const rec = await recordGap({
      userId,
      classroomId,
      subjectId: f.subjectId,
      unitId: f.unitId,
      conceptId: f.conceptId,
      category: f.category,
      description: f.description,
      evidence: f.evidence || text,
      severity: f.severity,
      confidence: f.confidence,
      detectedBy: 'ai',
      evidenceRef,
    });
    persisted.push(rec);
  }

  const all = [...recorded, ...persisted];

  // ---- Assessment recommendation trigger -----------------------------------
  const openGaps = await getOpenGaps(userId, classroomId, { conceptId: concept.id });
  const repeated = openGaps.filter((g) => (g.occurrences || 1) >= 2 || g.category === 'repeated_error');
  const recommendAssessment =
    Boolean(meta.disabled) === false &&
    (repeated.length >= 1 || (openGaps.length >= 3 && signal.wrongAnswer));

  if (recommendAssessment) {
    await db.collection('student_learning_profiles').updateOne(
      { userId: toOid(userId), classroomId: toOid(classroomId) },
      { $set: { assessmentRecommendedAt: now, assessmentRecommendationReason: repeated[0]?.description || 'Multiple open gaps detected' } },
    );
  }

  return {
    detected: all.length,
    findings: all.map((g) => ({
      id: String(g._id),
      category: g.category,
      description: g.description,
      severity: g.severity,
      confidence: g.confidence,
      occurrences: g.occurrences,
      repeated: Boolean(g.repeated),
    })),
    masteryDelta: Number(data?.masteryDelta) || 0,
    evidenceStrength: Number(data?.evidenceStrength) || 0,
    independenceSignal: data?.independenceSignal || 'unknown',
    summary: data?.summary || '',
    recommendAssessment,
    recommendReason: recommendAssessment ? repeated[0]?.description || 'Uncertain understanding' : '',
    model: meta.model,
    disabled: Boolean(meta.disabled),
  };
}

/** Marks a weakness as resolved after strong counter-evidence (e.g. passed assessment). */
export async function resolveGap(gapId, note = 'resolved by improved evidence') {
  const db = getDb();
  const oid = toOid(gapId);
  if (!oid) return;
  const now = new Date();
  for (const col of ['knowledge_gaps', 'misconceptions', 'practical_difficulties']) {
    await db.collection(col).updateOne(
      { _id: oid },
      {
        $set: { status: 'resolved', resolvedAt: now },
        $push: { improvementHistory: { at: now, note } },
      },
    );
  }
}

/** Reopens a gap if the same weakness is seen again after resolution. */
export async function reopenGapIfNeeded(userId, classroomId, conceptId, category, description) {
  const db = getDb();
  const collectionName = CATEGORY_TO_COLLECTION[category] || 'knowledge_gaps';
  const resolved = await db.collection(collectionName).findOne({
    userId: toOid(userId),
    classroomId: toOid(classroomId),
    conceptId: toOid(conceptId),
    category,
    status: 'resolved',
    descKey: String(description || '').toLowerCase().slice(0, 120),
  });
  if (!resolved) return null;
  await db.collection(collectionName).updateOne(
    { _id: resolved._id },
    { $set: { status: 'open', lastDetectedAt: new Date(), resolvedAt: null }, $inc: { occurrences: 1 } },
  );
  return resolved._id;
}

/** Aggregate weakness overview for a classroom (teacher analytics). */
export async function classroomGapOverview(classroomId) {
  const db = getDb();
  const cid = toOid(classroomId);
  const [gaps, misc, practical] = await Promise.all([
    db.collection('knowledge_gaps').find({ classroomId: cid, status: { $ne: 'resolved' } }).toArray(),
    db.collection('misconceptions').find({ classroomId: cid, status: { $ne: 'resolved' } }).toArray(),
    db.collection('practical_difficulties').find({ classroomId: cid, status: { $ne: 'resolved' } }).toArray(),
  ]);
  const all = [...gaps, ...misc, ...practical];
  const byConcept = {};
  for (const g of all) {
    const key = String(g.conceptId);
    byConcept[key] = byConcept[key] || { conceptId: key, total: 0, byCategory: {}, students: new Set() };
    byConcept[key].total += 1;
    byConcept[key].byCategory[g.category] = (byConcept[key].byCategory[g.category] || 0) + 1;
    byConcept[key].students.add(String(g.userId));
  }
  const conceptIds = Object.keys(byConcept).map((k) => toOid(k)).filter(Boolean);
  const concepts = conceptIds.length
    ? await db.collection('syllabus_units').find({ _id: { $in: conceptIds } }).toArray()
    : [];
  const nameById = Object.fromEntries(concepts.map((c) => [String(c._id), c.name]));
  return {
    total: all.length,
    byCategory: {
      knowledge_gap: gaps.filter((g) => g.category !== 'repeated_error').length,
      repeated_error: gaps.filter((g) => g.category === 'repeated_error').length,
      misconception: misc.length,
      practical_difficulty: practical.length,
    },
    bySeverity: all.reduce((acc, g) => {
      acc[g.severity] = (acc[g.severity] || 0) + 1;
      return acc;
    }, {}),
    hotspots: Object.values(byConcept)
      .map((c) => ({
        conceptId: c.conceptId,
        conceptName: nameById[c.conceptId] || 'Removed concept',
        total: c.total,
        byCategory: c.byCategory,
        studentsAffected: c.students.size,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12),
  };
}
