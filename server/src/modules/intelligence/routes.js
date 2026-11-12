import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, notFound, forbidden } from '../../utils/errors.js';
import { validate, round, average } from '../../utils/validation.js';
import {
  requireClassroomMember,
  requireClassroomStaff,
  requireMonitoring,
  requireProfileAccess,
  getMembership,
  logAudit,
  toOid,
} from '../classrooms/access.js';
import { getOrCreateProfile, refreshProfileAggregates } from './profile.js';
import { classroomGapOverview } from './gap-engine.js';

const router = Router();

/** Names for concepts referenced by a profile. */
async function conceptMap(db, classroomId, ids) {
  const oids = [...new Set(ids.map(String))].map(toOid).filter(Boolean);
  if (!oids.length) return {};
  const nodes = await db.collection('syllabus_units').find({ _id: { $in: oids }, classroomId: toOid(classroomId) }).toArray();
  const units = await db
    .collection('syllabus_units')
    .find({ _id: { $in: nodes.map((n) => n.parentId).filter(Boolean) } })
    .toArray();
  const unitById = Object.fromEntries(units.map((u) => [String(u._id), u.name]));
  return Object.fromEntries(
    nodes.map((n) => [String(n._id), { name: n.name, unitName: unitById[String(n.parentId)] || '', description: n.description }]),
  );
}

/**
 * Individual learning profile for one classroom.
 * Own profile: always allowed.
 * Someone else's: staff role + monitoring ON, otherwise 403.
 */
router.get(
  '/classrooms/:classroomId/students/:userId/profile',
  asyncHandler(async (req, res) => {
    const { classroom, self } = await requireProfileAccess(req.params.classroomId, req.userId, req.params.userId);
    const db = getDb();
    const targetUserId = toOid(req.params.userId);
    const profile = await getOrCreateProfile(targetUserId, classroom._id);
    const mastery = await db.collection('topic_mastery').find({ userId: targetUserId, classroomId: classroom._id }).toArray();
    const gaps = await db
      .collection('knowledge_gaps')
      .find({ userId: targetUserId, classroomId: classroom._id, status: { $ne: 'resolved' } })
      .toArray();
    const misconceptions = await db
      .collection('misconceptions')
      .find({ userId: targetUserId, classroomId: classroom._id, status: { $ne: 'resolved' } })
      .toArray();
    const practical = await db
      .collection('practical_difficulties')
      .find({ userId: targetUserId, classroomId: classroom._id, status: { $ne: 'resolved' } })
      .toArray();
    const results = await db
      .collection('assessment_results')
      .find({ userId: targetUserId, classroomId: classroom._id })
      .sort({ submittedAt: -1 })
      .limit(20)
      .toArray();
    const activities = await db
      .collection('student_activities')
      .find({ userId: targetUserId, classroomId: classroom._id })
      .sort({ createdAt: -1 })
      .limit(15)
      .toArray();
    const user = await db.collection('users').findOne({ _id: targetUserId });

    const allIds = [...mastery.map((m) => m.conceptId), ...gaps.map((g) => g.conceptId), ...misconceptions.map((g) => g.conceptId), ...practical.map((g) => g.conceptId)];
    const concepts = await conceptMap(db, classroom._id, allIds);

    const privacy = await db.collection('chat_privacy_permissions').findOne({ userId: targetUserId, classroomId: classroom._id });

    res.json({
      student: {
        id: String(targetUserId),
        name: user?.name || 'Unknown',
        email: self ? user?.email : undefined,
        avatarColor: user?.avatarColor,
      },
      classroom: { id: String(classroom._id), name: classroom.name, subject: classroom.subject },
      isSelf: self,
      profile: {
        knowledgeLevel: profile.knowledgeLevel,
        learningSpeed: profile.learningSpeed,
        independence: profile.independence,
        stats: profile.stats,
        weaknessCounts: profile.weaknessCounts,
        timeline: profile.timeline || [],
        lastActivityAt: profile.lastActivityAt,
      },
      mastery: mastery
        .sort((a, b) => b.score - a.score)
        .map((m) => ({
          conceptId: String(m.conceptId),
          conceptName: concepts[String(m.conceptId)]?.name || 'Removed concept',
          unitName: concepts[String(m.conceptId)]?.unitName || '',
          score: m.score,
          level: m.level,
          evidenceCount: m.evidenceCount,
          trend: m.trend || 0,
          updatedAt: m.updatedAt,
        })),
      weaknesses: [...gaps, ...misconceptions, ...practical]
        .sort((a, b) => new Date(b.lastDetectedAt) - new Date(a.lastDetectedAt))
        .map((g) => ({
          id: String(g._id),
          category: g.category,
          description: g.description,
          conceptId: String(g.conceptId),
          conceptName: concepts[String(g.conceptId)]?.name || 'Removed concept',
          severity: g.severity,
          confidence: g.confidence,
          occurrences: g.occurrences,
          status: g.status,
          firstDetectedAt: g.firstDetectedAt,
          lastDetectedAt: g.lastDetectedAt,
          evidence: (g.evidence || []).slice(-3).map((e) => ({ type: e.type, excerpt: e.excerpt, at: e.at })),
          improvementHistory: g.improvementHistory || [],
        })),
      assessments: results.map((r) => ({
        id: String(r._id),
        percentage: r.percentage,
        score: r.score,
        maxScore: r.maxScore,
        submittedAt: r.submittedAt,
        aiFeedback: r.aiFeedback,
      })),
      assessmentAverage: results.length ? round(average(results.map((r) => r.percentage)), 1) : null,
      activity: activities.map((a) => ({ id: String(a._id), type: a.type, title: a.title, at: a.createdAt, minutes: a.minutes })),
      chatPrivacy: {
        shareWithTeachers: Boolean(privacy?.shareWithTeachers),
        shareWithOwner: Boolean(privacy?.shareWithOwner),
        updatedAt: privacy?.updatedAt || null,
      },
    });
  }),
);

/** Classroom analytics for teachers — monitoring gate enforced server-side. */
router.get(
  '/classrooms/:classroomId/analytics',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomStaff(req.params.classroomId, req.userId);
    const db = getDb();
    const isOwner = membership.role === 'owner';
    const tp = await db.collection('teacher_permissions').findOne({ classroomId: classroom._id, userId: toOid(req.userId) });
    const monitoringEnabled = tp ? tp.monitoringEnabled : isOwner;
    const canViewAnalytics = isOwner || membership.permissions?.viewAnalytics;
    if (!canViewAnalytics) throw forbidden('Your classroom role does not include analytics access');

    const memberships = await db
      .collection('classroom_memberships')
      .find({ classroomId: classroom._id, status: 'active', role: 'student' })
      .toArray();
    const userIds = memberships.map((m) => m.userId);
    const users = userIds.length ? await db.collection('users').find({ _id: { $in: userIds } }).toArray() : [];
    const userById = Object.fromEntries(users.map((u) => [String(u._id), u]));
    const profiles = userIds.length
      ? await db.collection('student_learning_profiles').find({ classroomId: classroom._id, userId: { $in: userIds } }).toArray()
      : [];
    const profileByUser = Object.fromEntries(profiles.map((p) => [String(p.userId), p]));
    const gaps = await db
      .collection('knowledge_gaps')
      .find({ classroomId: classroom._id, status: { $ne: 'resolved' } })
      .toArray();
    const misc = await db.collection('misconceptions').find({ classroomId: classroom._id, status: { $ne: 'resolved' } }).toArray();
    const practical = await db
      .collection('practical_difficulties')
      .find({ classroomId: classroom._id, status: { $ne: 'resolved' } })
      .toArray();

    const gapOverview = await classroomGapOverview(classroom._id);

    // Without monitoring rights, only aggregate, non-identifying figures are exposed.
    if (!monitoringEnabled) {
      return res.json({
        monitoringEnabled: false,
        restricted: true,
        message:
          'Monitoring is switched off for your teacher profile. Individual student profiles, per-student analytics and chat history are hidden. Turn monitoring on (or ask the classroom owner) to view them. Your own learning access is unaffected.',
        classroom: { id: String(classroom._id), name: classroom.name, subject: classroom.subject },
        aggregate: {
          studentCount: memberships.length,
          totalOpenWeaknesses: gaps.length + misc.length + practical.length,
          byCategory: gapOverview.byCategory,
          bySeverity: gapOverview.bySeverity,
          conceptHotspots: gapOverview.hotspots.map((h) => ({ conceptName: h.conceptName, total: h.total, studentsAffected: h.studentsAffected })),
        },
        students: [],
      });
    }

    const students = memberships.map((m) => {
      const p = profileByUser[String(m.userId)];
      const studentGaps = [...gaps, ...misc, ...practical].filter((g) => String(g.userId) === String(m.userId));
      return {
        userId: String(m.userId),
        name: userById[String(m.userId)]?.name || 'Unknown',
        email: userById[String(m.userId)]?.email,
        avatarColor: userById[String(m.userId)]?.avatarColor,
        joinedAt: m.joinedAt,
        knowledgeLevel: p?.knowledgeLevel || 'beginner',
        masteryAverage: p?.mastery?.length ? round(average(p.mastery.map((x) => x.score)), 1) : null,
        learningSpeed: p?.learningSpeed?.label || 'unknown',
        independenceScore: p?.independence?.score ?? 0,
        openWeaknesses: studentGaps.length,
        byCategory: {
          knowledge_gap: studentGaps.filter((g) => g.category === 'knowledge_gap').length,
          repeated_error: studentGaps.filter((g) => g.category === 'repeated_error').length,
          misconception: studentGaps.filter((g) => g.category === 'misconception').length,
          practical_difficulty: studentGaps.filter((g) => g.category === 'practical_difficulty').length,
        },
        sessions: p?.stats?.sessions || 0,
        assessmentsTaken: p?.stats?.assessmentsTaken || 0,
        lastActivityAt: p?.lastActivityAt || null,
        atRisk: studentGaps.filter((g) => g.severity === 'high' || g.severity === 'critical').length > 0,
      };
    });

    const results = await db.collection('assessment_results').find({ classroomId: classroom._id }).toArray();
    const assessed = students.filter((s) => s.masteryAverage !== null);

    // Agent-level analytic consent: who allows chat review (does NOT expose content).
    const privacy = await db.collection('chat_privacy_permissions').find({ classroomId: classroom._id }).toArray();
    const privacyByUser = Object.fromEntries(privacy.map((p) => [String(p.userId), p]));

    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'analytics.viewed', ip: req.ip });

    res.json({
      monitoringEnabled: true,
      restricted: false,
      classroom: { id: String(classroom._id), name: classroom.name, subject: classroom.subject },
      aggregate: {
        studentCount: memberships.length,
        activeLast7Days: students.filter((s) => s.lastActivityAt && Date.now() - new Date(s.lastActivityAt).getTime() < 7 * 86_400_000).length,
        averageMastery: assessed.length ? round(average(assessed.map((s) => s.masteryAverage)), 1) : null,
        averageIndependence: students.length ? round(average(students.map((s) => s.independenceScore)), 1) : 0,
        totalOpenWeaknesses: gaps.length + misc.length + practical.length,
        byCategory: gapOverview.byCategory,
        bySeverity: gapOverview.bySeverity,
        conceptHotspots: gapOverview.hotspots,
        assessmentAverage: results.length ? round(average(results.map((r) => r.percentage)), 1) : null,
        assessmentCount: results.length,
        levelDistribution: ['beginner', 'developing', 'proficient', 'advanced'].map((lvl) => ({
          level: lvl,
          count: students.filter((s) => s.knowledgeLevel === lvl).length,
        })),
        speedDistribution: ['slow', 'steady', 'fast'].map((lvl) => ({
          speed: lvl,
          count: students.filter((s) => s.learningSpeed === lvl).length,
        })),
      },
      students: students.map((s) => ({
        ...s,
        chatShared: Boolean(privacyByUser[s.userId]?.shareWithTeachers || privacyByUser[s.userId]?.shareWithOwner && isOwner),
      })),
      weaknesses: [...gaps, ...misc, ...practical] // detail table for permitted staff
        .sort((a, b) => new Date(b.lastDetectedAt) - new Date(a.lastDetectedAt))
        .slice(0, 80)
        .map((g) => ({
          id: String(g._id),
          userId: String(g.userId),
          name: userById[String(g.userId)]?.name || 'Unknown',
          category: g.category,
          description: g.description,
          severity: g.severity,
          confidence: g.confidence,
          occurrences: g.occurrences,
          status: g.status,
          lastDetectedAt: g.lastDetectedAt,
        })),
    });
  }),
);

/** Student's own progress in a classroom. */
router.get(
  '/classrooms/:classroomId/my-progress',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const profile = await getOrCreateProfile(req.userId, classroom._id);
    const refreshed = await refreshProfileAggregates(req.userId, classroom._id);
    const mastery = await db.collection('topic_mastery').find({ userId: req.userId, classroomId: classroom._id }).sort({ score: -1 }).toArray();
    const concepts = await conceptMap(db, classroom._id, mastery.map((m) => m.conceptId));
    const gaps = await db
      .collection('knowledge_gaps')
      .find({ userId: req.userId, classroomId: classroom._id, status: { $ne: 'resolved' } })
      .sort({ lastDetectedAt: -1 })
      .limit(10)
      .toArray();
    const results = await db
      .collection('assessment_results')
      .find({ userId: req.userId, classroomId: classroom._id })
      .sort({ submittedAt: -1 })
      .limit(12)
      .toArray();
    const activities = await db
      .collection('student_activities')
      .find({ userId: req.userId, classroomId: classroom._id })
      .sort({ createdAt: -1 })
      .limit(12)
      .toArray();
    const pendingAssessment = profile.pendingAssessmentId
      ? await db.collection('assessments').findOne({ _id: profile.pendingAssessmentId, status: { $in: ['available', 'draft'] } })
      : null;
    const weaknessNames = await conceptMap(db, classroom._id, gaps.map((g) => g.conceptId));

    res.json({
      profile: {
        knowledgeLevel: refreshed.knowledgeLevel,
        learningSpeed: refreshed.learningSpeed,
        independence: refreshed.independence,
        stats: refreshed.stats,
        weaknessCounts: refreshed.weaknessCounts,
        timeline: refreshed.timeline,
      },
      mastery: mastery.map((m) => ({
        conceptId: String(m.conceptId),
        conceptName: concepts[String(m.conceptId)]?.name || 'Removed concept',
        unitName: concepts[String(m.conceptId)]?.unitName || '',
        score: m.score,
        level: m.level,
        trend: m.trend || 0,
        evidenceCount: m.evidenceCount,
      })),
      weaknesses: gaps.map((g) => ({
        id: String(g._id),
        category: g.category,
        description: g.description,
        conceptName: weaknessNames[String(g.conceptId)]?.name || 'Removed concept',
        severity: g.severity,
        occurrences: g.occurrences,
        status: g.status,
      })),
      assessments: results.map((r) => ({
        id: String(r._id),
        percentage: r.percentage,
        submittedAt: r.submittedAt,
        aiFeedback: r.aiFeedback,
      })),
      pendingAssessment: pendingAssessment
        ? { id: String(pendingAssessment._id), title: pendingAssessment.title, reason: pendingAssessment.recommendedReason, kind: pendingAssessment.kind }
        : null,
      activity: activities.map((a) => ({ id: String(a._id), type: a.type, title: a.title, at: a.createdAt, minutes: a.minutes })),
    });
  }),
);

/** Classroom learning analytics (owner/teacher high-level view). */
router.get(
  '/classrooms/:classroomId/overview',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomStaff(req.params.classroomId, req.userId);
    const db = getDb();
    const memberships = await db.collection('classroom_memberships').find({ classroomId: classroom._id, status: 'active' }).toArray();
    const students = memberships.filter((m) => m.role === 'student');
    const teachers = memberships.filter((m) => m.role !== 'student');
    const profiles = await db.collection('student_learning_profiles').find({ classroomId: classroom._id }).toArray();
    const syllabus = await db.collection('syllabuses').findOne({ classroomId: classroom._id, status: 'active' });
    const conceptCount = await db.collection('syllabus_units').countDocuments({ classroomId: classroom._id, type: 'concept' });
    const gaps = await db.collection('knowledge_gaps').find({ classroomId: classroom._id, status: { $ne: 'resolved' } }).toArray();
    const sessions = await db.collection('learning_sessions').find({ classroomId: classroom._id }).limit(500).toArray();
    const results = await db.collection('assessment_results').find({ classroomId: classroom._id }).toArray();
    const pending = await db.collection('join_requests').countDocuments({ classroomId: classroom._id, status: 'pending' });

    const timeline = [];
    for (let i = 13; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      timeline.push({
        date: day,
        sessions: sessions.filter((s) => new Date(s.startedAt).toISOString().slice(0, 10) === day).length,
        assessments: results.filter((r) => new Date(r.submittedAt).toISOString().slice(0, 10) === day).length,
      });
    }

    res.json({
      classroom: {
        id: String(classroom._id),
        name: classroom.name,
        code: classroom.code,
        subject: classroom.subject,
        description: classroom.description,
        coverImage: classroom.coverImage,
        joinApprovalRequired: classroom.joinApprovalRequired,
        settings: classroom.settings,
        createdAt: classroom.createdAt,
      },
      counts: {
        students: students.length,
        teachers: teachers.length,
        pendingRequests: pending,
        concepts: conceptCount,
        sessions: sessions.length,
        assessments: results.length,
      },
      syllabus: syllabus
        ? { id: String(syllabus._id), title: syllabus.title, source: syllabus.source, version: syllabus.version, documents: syllabus.documents || [], materialStats: syllabus.materialStats }
        : null,
      analytics: {
        averageMastery: profiles.length
          ? round(average(profiles.flatMap((p) => (p.mastery || []).map((m) => m.score))), 1)
          : null,
        averageIndependence: profiles.length ? round(average(profiles.map((p) => p.independence?.score || 0)), 1) : 0,
        openWeaknesses: gaps.length,
        assessmentAverage: results.length ? round(average(results.map((r) => r.percentage)), 1) : null,
        timeline,
      },
    });
  }),
);

export default router;
