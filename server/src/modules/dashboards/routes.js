import { Router } from 'express';
import { getDb } from '../../db/index.js';
import { asyncHandler } from '../../utils/errors.js';
import { round, average } from '../../utils/validation.js';
import { toOid } from '../classrooms/access.js';

const router = Router();

/** Unified user dashboard: learning + teaching in one place, one account. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const memberships = await db.collection('classroom_memberships').find({ userId: req.userId, status: 'active' }).toArray();
    const classroomIds = memberships.map((m) => m.classroomId);
    const classrooms = classroomIds.length
      ? await db.collection('classrooms').find({ _id: { $in: classroomIds } }).toArray()
      : [];
    const classroomById = Object.fromEntries(classrooms.map((c) => [String(c._id), c]));
    const profiles = await db.collection('student_learning_profiles').find({ userId: req.userId }).toArray();
    const profileByClassroom = Object.fromEntries(profiles.map((p) => [String(p.classroomId), p]));
    const activities = await db
      .collection('student_activities')
      .find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(12)
      .toArray();
    const sessions = await db
      .collection('learning_sessions')
      .find({ userId: req.userId })
      .sort({ startedAt: -1 })
      .limit(8)
      .toArray();
    const conceptIds = [...new Set(sessions.map((s) => String(s.conceptId)))].map(toOid).filter(Boolean);
    const concepts = conceptIds.length ? await db.collection('syllabus_units').find({ _id: { $in: conceptIds } }).toArray() : [];
    const conceptById = Object.fromEntries(concepts.map((c) => [String(c._id), c.name]));
    const pendingAssessments = await db
      .collection('assessments')
      .find({ userId: req.userId, status: 'available', origin: 'ai' })
      .limit(5)
      .toArray();
    const pendingRequests = await db
      .collection('join_requests')
      .find({ userId: req.userId, status: 'pending' })
      .toArray();
    const myClassroomsAwaitingRequests = await db
      .collection('join_requests')
      .find({ classroomId: { $in: memberships.filter((m) => m.role === 'owner' || m.permissions?.manageMembers).map((m) => m.classroomId) }, status: 'pending' })
      .toArray();
    const results = await db.collection('assessment_results').find({ userId: req.userId }).toArray();
    const gaps = await db
      .collection('knowledge_gaps')
      .find({ userId: req.userId, status: { $ne: 'resolved' } })
      .sort({ lastDetectedAt: -1 })
      .limit(6)
      .toArray();
    const gapConceptNames = gaps.length
      ? await db.collection('syllabus_units').find({ _id: { $in: gaps.map((g) => g.conceptId) } }).toArray()
      : [];
    const gapNameById = Object.fromEntries(gapConceptNames.map((c) => [String(c._id), c.name]));

    res.json({
      user: { id: String(req.userId), name: req.user.name, role: req.user.role },
      counts: {
        classrooms: memberships.length,
        owned: memberships.filter((m) => m.role === 'owner').length,
        teaching: memberships.filter((m) => ['co_owner', 'teacher'].includes(m.role)).length,
        pendingJoinRequests: pendingRequests.length,
        requestsToReview: myClassroomsAwaitingRequests.length,
        pendingAssessments: pendingAssessments.length,
      },
      classrooms: memberships
        .filter((m) => classroomById[String(m.classroomId)])
        .map((m) => {
          const c = classroomById[String(m.classroomId)];
          const p = profileByClassroom[String(m.classroomId)];
          const mastery = p?.mastery || [];
          return {
            id: String(c._id),
            name: c.name,
            code: c.code,
            subject: c.subject,
            description: c.description,
            coverImage: c.coverImage,
            myRole: m.role,
            stats: c.stats,
            knowledgeLevel: p?.knowledgeLevel || 'not_started',
            mastery: mastery.length ? round(average(mastery.map((x) => x.score)), 1) : null,
            independence: p?.independence?.score ?? 0,
            openWeaknesses: p ? Object.values(p.weaknessCounts || {}).reduce((a, b) => a + b, 0) : 0,
            lastActivityAt: p?.lastActivityAt || m.joinedAt,
          };
        })
        .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt)),
      learning: {
        totalSessions: profiles.reduce((a, p) => a + (p.stats?.sessions || 0), 0),
        totalMinutes: profiles.reduce((a, p) => a + (p.stats?.totalStudyMinutes || 0), 0),
        assessmentsTaken: profiles.reduce((a, p) => a + (p.stats?.assessmentsTaken || 0), 0),
        averageAssessment: results.length ? round(average(results.map((r) => r.percentage)), 1) : null,
        recentTopics: sessions.map((s) => ({
          id: String(s._id),
          concept: conceptById[String(s.conceptId)] || 'Removed concept',
          classroom: classroomById[String(s.classroomId)]?.name || '',
          mode: s.mode,
          at: s.startedAt,
          status: s.status,
        })),
        activity: activities.map((a) => ({
          id: String(a._id),
          type: a.type,
          title: a.title,
          classroom: classroomById[String(a.classroomId)]?.name || '',
          at: a.createdAt,
        })),
        weaknesses: gaps.map((g) => ({
          id: String(g._id),
          description: g.description,
          category: g.category,
          severity: g.severity,
          concept: gapNameById[String(g.conceptId)] || '',
          classroom: classroomById[String(g.classroomId)]?.name || '',
        })),
      },
      pendingAssessments: pendingAssessments.map((a) => ({
        id: String(a._id),
        title: a.title,
        classroomId: String(a.classroomId),
        classroomName: classroomById[String(a.classroomId)]?.name || '',
        reason: a.recommendedReason,
        kind: a.kind,
      })),
    });
  }),
);

export default router;
