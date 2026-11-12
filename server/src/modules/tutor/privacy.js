import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, notFound, forbidden } from '../../utils/errors.js';
import { validate } from '../../utils/validation.js';
import { requireClassroomMember, requireClassroomStaff, requireMonitoring, toOid } from '../classrooms/access.js';

/**
 * Chat privacy.
 *
 * Default: student AI conversations are visible only to the student.
 * Students can grant/revoke access; every change and every teacher read attempt
 * is written to an immutable audit trail. Enforcement is server-side: the
 * frontend can hide buttons, but the API refuses regardless.
 */

const router = Router();

router.get(
  '/classrooms/:classroomId/chat-privacy',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const doc = await db.collection('chat_privacy_permissions').findOne({
      userId: req.userId,
      classroomId: classroom._id,
    });
    const audit = await db
      .collection('chat_privacy_audit')
      .find({ userId: req.userId, classroomId: classroom._id })
      .sort({ at: -1 })
      .limit(12)
      .toArray();
    res.json({
      privacy: {
        shareWithTeachers: Boolean(doc?.shareWithTeachers),
        shareWithOwner: Boolean(doc?.shareWithOwner),
        updatedAt: doc?.updatedAt || null,
        defaultNote:
          'Your AI conversations are private by default. Teachers can see your analytics, gaps, misconceptions and assessment results unless you grant chat access.',
      },
      audit: audit.map((a) => ({ id: String(a._id), action: a.action, scope: a.scope, at: a.at })),
    });
  }),
);

router.patch(
  '/classrooms/:classroomId/chat-privacy',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({ shareWithTeachers: z.boolean().optional(), shareWithOwner: z.boolean().optional() }),
      req.body,
    );
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const now = new Date();
    const existing = await db.collection('chat_privacy_permissions').findOne({
      userId: req.userId,
      classroomId: classroom._id,
    });
    const next = {
      shareWithTeachers: data.shareWithTeachers ?? existing?.shareWithTeachers ?? false,
      shareWithOwner: data.shareWithOwner ?? existing?.shareWithOwner ?? false,
    };
    await db.collection('chat_privacy_permissions').updateOne(
      { userId: req.userId, classroomId: classroom._id },
      {
        $set: { ...next, updatedAt: now, lastChangedBy: req.userId },
        $setOnInsert: { createdAt: now },
        $unset: { revokedAt: '' },
      },
      { upsert: true },
    );
    const granting = next.shareWithTeachers || next.shareWithOwner;
    await db.collection('chat_privacy_audit').insertOne({
      userId: req.userId,
      classroomId: classroom._id,
      actorId: req.userId,
      action: granting ? 'grant' : 'revoke',
      scope: JSON.stringify(next),
      ip: req.ip,
      at: now,
    });
    res.json({ ok: true, privacy: next });
  }),
);

/** Teacher request-denial is logged so students can review attempted access. */
export async function assertChatAccess({ classroomId, studentId, requesterId, requesterMembership }) {
  const db = getDb();
  const classroomOid = toOid(classroomId);
  const studentOid = toOid(studentId);
  const privacy = await db.collection('chat_privacy_permissions').findOne({ userId: studentOid, classroomId: classroomOid });
  const isOwner = requesterMembership?.role === 'owner';
  const allowed = Boolean(
    privacy && (privacy.shareWithTeachers || (isOwner && privacy.shareWithOwner)),
  );
  if (!allowed) {
    await db.collection('chat_privacy_audit').insertOne({
      userId: studentOid,
      classroomId: classroomOid,
      actorId: toOid(requesterId),
      action: 'access_denied',
      scope: 'chat_history',
      ip: null,
      at: new Date(),
    });
    throw forbidden('This student has not granted chat-history access for this classroom');
  }
  await db.collection('chat_privacy_audit').insertOne({
    userId: studentOid,
    classroomId: classroomOid,
    actorId: toOid(requesterId),
    action: 'access_granted',
    scope: 'chat_history',
    ip: null,
    at: new Date(),
  });
}

/**
 * Teacher view of a student's chat history.
 * Requires: staff role in the classroom + monitoring ON + student consent.
 */
router.get(
  '/classrooms/:classroomId/students/:userId/chat',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomStaff(req.params.classroomId, req.userId);
    await requireMonitoring(classroom._id, req.userId);
    await assertChatAccess({
      classroomId: classroom._id,
      studentId: req.params.userId,
      requesterId: req.userId,
      requesterMembership: membership,
    });
    const db = getDb();
    const sessions = await db
      .collection('learning_sessions')
      .find({ classroomId: classroom._id, userId: toOid(req.params.userId) })
      .sort({ startedAt: -1 })
      .limit(20)
      .toArray();
    const conceptIds = [...new Set(sessions.map((s) => String(s.conceptId)))].map(toOid).filter(Boolean);
    const concepts = conceptIds.length ? await db.collection('syllabus_units').find({ _id: { $in: conceptIds } }).toArray() : [];
    const conceptById = Object.fromEntries(concepts.map((c) => [String(c._id), c.name]));
    const messages = sessions.length
      ? await db.collection('chat_messages').find({ sessionId: { $in: sessions.map((s) => s._id) } }).sort({ createdAt: 1 }).toArray()
      : [];
    const bySession = {};
    messages.forEach((m) => {
      const k = String(m.sessionId);
      bySession[k] = bySession[k] || [];
      bySession[k].push({ id: String(m._id), role: m.role, content: m.content, createdAt: m.createdAt, meta: { kind: m.meta?.kind } });
    });
    const student = await db.collection('users').findOne({ _id: toOid(req.params.userId) });
    res.json({
      student: { id: String(student?._id), name: student?.name },
      sessions: sessions.map((s) => ({
        id: String(s._id),
        conceptName: conceptById[String(s.conceptId)] || 'Removed concept',
        mode: s.mode,
        startedAt: s.startedAt,
        messageCount: s.messageCount,
        messages: bySession[String(s._id)] || [],
      })),
    });
  }),
);

export default router;
export { router as privacyRouter };
