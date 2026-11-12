import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden, conflict } from '../../utils/errors.js';
import { validate, pick } from '../../utils/validation.js';
import { generateClassroomCode } from '../../utils/ids.js';
import {
  DEFAULT_TEACHER_PERMISSIONS,
  DEFAULT_CLASSROOM_SETTINGS,
  getMembership,
  requireClassroomMember,
  requireClassroomStaff,
  requireClassroomOwner,
  logAudit,
  toOid,
} from './access.js';

const router = Router();

const permissionSchema = z.object({
  manageMembers: z.boolean().optional(),
  manageSyllabus: z.boolean().optional(),
  monitorStudents: z.boolean().optional(),
  manageAssessments: z.boolean().optional(),
  viewAnalytics: z.boolean().optional(),
});

const settingsSchema = z.object({
  allowStudentChat: z.boolean().optional(),
  monitoringDefault: z.boolean().optional(),
  adaptiveDifficulty: z.boolean().optional(),
  practicalEnabled: z.boolean().optional(),
  aiTutorEnabled: z.boolean().optional(),
  knowledgeGapDetection: z.boolean().optional(),
  autoAssessments: z.boolean().optional(),
  chatHistoryDays: z.number().int().min(1).max(365).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(3).max(90),
  description: z.string().trim().max(600).optional(),
  subject: z.string().trim().min(2).max(90),
  coverImage: z.string().max(2_000_000).optional(),
  joinApprovalRequired: z.boolean().optional(),
  settings: settingsSchema.optional(),
});

async function classroomStats(classroomId) {
  const db = getDb();
  const [members, teachers, pending] = await Promise.all([
    db.collection('classroom_memberships').countDocuments({ classroomId, status: 'active', role: 'student' }),
    db.collection('classroom_memberships').countDocuments({ classroomId, status: 'active', role: { $in: ['owner', 'co_owner', 'teacher'] } }),
    db.collection('join_requests').countDocuments({ classroomId, status: 'pending' }),
  ]);
  return { memberCount: members, teacherCount: teachers, pendingRequests: pending };
}

function serializeClassroom(c) {
  return {
    id: String(c._id),
    code: c.code,
    name: c.name,
    description: c.description,
    subject: c.subject,
    coverImage: c.coverImage || null,
    ownerId: String(c.ownerId),
    joinApprovalRequired: Boolean(c.joinApprovalRequired),
    settings: c.settings,
    stats: c.stats || {},
    archived: Boolean(c.archived),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function serializeMembership(m) {
  return {
    id: String(m._id),
    classroomId: String(m.classroomId),
    userId: String(m.userId),
    role: m.role,
    status: m.status,
    permissions: m.permissions,
    monitoringEnabled: m.monitoringEnabled,
    joinedAt: m.joinedAt,
  };
}

/** Creates a classroom; the creator automatically becomes the primary owner. */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = validate(createSchema, req.body);
    const db = getDb();

    let code = generateClassroomCode();
    // eslint-disable-next-line no-await-in-loop
    while (await db.collection('classrooms').findOne({ code })) code = generateClassroomCode();

    const now = new Date();
    const doc = {
      code,
      name: data.name,
      description: data.description || '',
      subject: data.subject,
      coverImage: data.coverImage || null,
      ownerId: req.userId,
      joinApprovalRequired: data.joinApprovalRequired ?? true,
      settings: { ...DEFAULT_CLASSROOM_SETTINGS, ...(data.settings || {}) },
      stats: { memberCount: 0, teacherCount: 1, pendingRequests: 0, lastActivityAt: now },
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await db.collection('classrooms').insertOne(doc);

    await db.collection('classroom_memberships').insertOne({
      classroomId: insertedId,
      userId: req.userId,
      role: 'owner',
      status: 'active',
      permissions: { ...DEFAULT_TEACHER_PERMISSIONS },
      monitoringEnabled: true,
      invitedBy: null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('teacher_permissions').insertOne({
      classroomId: insertedId,
      userId: req.userId,
      monitoringEnabled: true,
      permissions: { ...DEFAULT_TEACHER_PERMISSIONS },
      assignedBy: req.userId,
      updatedAt: now,
    });
    await logAudit({ actorId: req.userId, classroomId: insertedId, action: 'classroom.created', target: code, ip: req.ip });

    res.status(201).json({ classroom: serializeClassroom({ _id: insertedId, ...doc }) });
  }),
);

/** Classrooms the current user belongs to (as any role) + pending join state. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const memberships = await db
      .collection('classroom_memberships')
      .find({ userId: req.userId, status: 'active' })
      .toArray();
    const ids = memberships.map((m) => m.classroomId);
    const classrooms = ids.length
      ? await db.collection('classrooms').find({ _id: { $in: ids } }).sort({ 'stats.lastActivityAt': -1 }).toArray()
      : [];
    const byId = Object.fromEntries(classrooms.map((c) => [String(c._id), c]));
    const pendingRequests = await db
      .collection('join_requests')
      .find({ userId: req.userId, status: 'pending' })
      .toArray();
    const pendingClassrooms = pendingRequests.length
      ? await db.collection('classrooms').find({ _id: { $in: pendingRequests.map((p) => p.classroomId) } }).toArray()
      : [];

    // Teacher monitoring flags for badge display
    const tps = await db.collection('teacher_permissions').find({ userId: req.userId }).toArray();
    const monitoringByClassroom = Object.fromEntries(tps.map((t) => [String(t.classroomId), t.monitoringEnabled]));

    res.json({
      classrooms: memberships
        .filter((m) => byId[String(m.classroomId)])
        .map((m) => ({
          ...serializeClassroom(byId[String(m.classroomId)]),
          myRole: m.role,
          myPermissions: m.permissions,
          monitoringEnabled: monitoringByClassroom[String(m.classroomId)] ?? (m.role === 'owner'),
          joinedAt: m.joinedAt,
        })),
      created: memberships.filter((m) => m.role === 'owner').map((m) => String(m.classroomId)),
      teaching: memberships.filter((m) => ['co_owner', 'teacher'].includes(m.role)).map((m) => String(m.classroomId)),
      learning: memberships.map((m) => String(m.classroomId)),
      pendingRequests: pendingClassrooms.map((c) => ({
        classroomId: String(c._id),
        name: c.name,
        code: c.code,
        subject: c.subject,
      })),
    });
  }),
);

/** Join with a classroom ID. Respects the classroom approval setting. */
router.post(
  '/join',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({ code: z.string().trim().min(4).max(20), message: z.string().trim().max(400).optional() }),
      req.body,
    );
    const db = getDb();
    const code = data.code.toUpperCase();
    const classroom = await db.collection('classrooms').findOne({
      $or: [{ code }, { code: code.replace(/\s/g, '') }, { _id: toOid(code) || new ObjectId('000000000000000000000000') }],
    });
    if (!classroom) throw notFound('No classroom matches that classroom ID');
    if (classroom.archived) throw badRequest('This classroom has been archived');

    const existing = await db
      .collection('classroom_memberships')
      .findOne({ classroomId: classroom._id, userId: req.userId });
    if (existing?.status === 'active') throw conflict('You are already a member of this classroom');

    const now = new Date();

    if (!classroom.joinApprovalRequired) {
      if (existing) {
        await db.collection('classroom_memberships').updateOne(
          { _id: existing._id },
          {
            $set: {
              status: 'active',
              role: 'student',
              permissions: {},
              joinedAt: now,
              updatedAt: now,
            },
          },
        );
      } else {
        await db.collection('classroom_memberships').insertOne({
          classroomId: classroom._id,
          userId: req.userId,
          role: 'student',
          status: 'active',
          permissions: {},
          monitoringEnabled: false,
          invitedBy: null,
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      const stats = await classroomStats(classroom._id);
      await db.collection('classrooms').updateOne(
        { _id: classroom._id },
        { $set: { stats: { ...classroom.stats, ...stats, lastActivityAt: now }, updatedAt: now } },
      );
      await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'classroom.joined_direct', ip: req.ip });
      return res.status(201).json({
        status: 'joined',
        classroom: serializeClassroom({ ...classroom, stats: { ...classroom.stats, ...stats } }),
        message: `You have joined ${classroom.name}`,
      });
    }

    const pending = await db
      .collection('join_requests')
      .findOne({ classroomId: classroom._id, userId: req.userId, status: 'pending' });
    if (pending) return res.json({ status: 'pending', classroom: serializeClassroom(classroom), message: 'Your request is already awaiting approval' });

    await db.collection('join_requests').insertOne({
      classroomId: classroom._id,
      userId: req.userId,
      message: data.message || '',
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      createdAt: now,
    });
    const stats = await classroomStats(classroom._id);
    await db.collection('classrooms').updateOne(
      { _id: classroom._id },
      { $set: { stats: { ...classroom.stats, ...stats }, updatedAt: now } },
    );
    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'classroom.join_requested', ip: req.ip });
    res.status(201).json({
      status: 'requested',
      classroom: serializeClassroom(classroom),
      message: 'Join request sent. A classroom owner must approve it.',
    });
  }),
);

/** Dashboard data for a single classroom, with role-aware permissions. */
router.get(
  '/:classroomId',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const tp = await db.collection('teacher_permissions').findOne({ classroomId: classroom._id, userId: toOid(req.userId) });
    const owner = await db.collection('users').findOne({ _id: classroom.ownerId });
    const pendingRequests =
      membership.role === 'owner' || membership.permissions?.manageMembers
        ? await db.collection('join_requests').find({ classroomId: classroom._id, status: 'pending' }).toArray()
        : [];
    const requestUsers = pendingRequests.length
      ? await db.collection('users').find({ _id: { $in: pendingRequests.map((r) => r.userId) } }).toArray()
      : [];
    const userById = Object.fromEntries(requestUsers.map((u) => [String(u._id), u]));

    res.json({
      classroom: serializeClassroom(classroom),
      membership: {
        ...serializeMembership(membership),
        monitoringEnabled: tp ? tp.monitoringEnabled : membership.role === 'owner',
        effectivePermissions: membership.role === 'owner' ? DEFAULT_TEACHER_PERMISSIONS : membership.permissions,
      },
      owner: owner ? { id: String(owner._id), name: owner.name, email: owner.email, avatarColor: owner.avatarColor } : null,
      joinRequests: pendingRequests.map((r) => ({
        id: String(r._id),
        userId: String(r.userId),
        name: userById[String(r.userId)]?.name || 'Unknown user',
        email: userById[String(r.userId)]?.email || '',
        avatarColor: userById[String(r.userId)]?.avatarColor,
        message: r.message,
        createdAt: r.createdAt,
      })),
    });
  }),
);

router.patch(
  '/:classroomId',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomOwner(req.params.classroomId, req.userId);
    const data = validate(
      z.object({
        name: z.string().trim().min(3).max(90).optional(),
        description: z.string().trim().max(600).optional(),
        subject: z.string().trim().min(2).max(90).optional(),
        coverImage: z.string().max(2_000_000).nullable().optional(),
        joinApprovalRequired: z.boolean().optional(),
        archived: z.boolean().optional(),
        settings: settingsSchema.optional(),
      }),
      req.body,
    );
    const db = getDb();
    const update = { updatedAt: new Date() };
    for (const k of ['name', 'description', 'subject', 'coverImage', 'joinApprovalRequired', 'archived']) {
      if (data[k] !== undefined) update[k] = data[k];
    }
    if (data.settings) {
      update.settings = { ...classroom.settings, ...data.settings };
      if (data.settings.monitoringDefault !== undefined) {
        // Propagate the classroom default to teachers who never overrode it.
        await db.collection('teacher_permissions').updateMany(
          { classroomId: classroom._id, inheritedMonitoring: true },
          { $set: { monitoringEnabled: data.settings.monitoringDefault, updatedAt: new Date() } },
        );
      }
    }
    await db.collection('classrooms').updateOne({ _id: classroom._id }, { $set: update });
    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'classroom.settings_updated', meta: data, ip: req.ip });
    const updated = await db.collection('classrooms').findOne({ _id: classroom._id });
    res.json({ classroom: serializeClassroom(updated) });
  }),
);

/** Member list. Students see a minimal roster; staff see roles/permissions. */
router.get(
  '/:classroomId/members',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const isStaff = ['owner', 'co_owner', 'teacher'].includes(membership.role);
    const memberships = await db
      .collection('classroom_memberships')
      .find({ classroomId: classroom._id, status: 'active' })
      .sort({ createdAt: 1 })
      .toArray();
    const users = await db.collection('users').find({ _id: { $in: memberships.map((m) => m.userId) } }).toArray();
    const userById = Object.fromEntries(users.map((u) => [String(u._id), u]));
    const tps = await db.collection('teacher_permissions').find({ classroomId: classroom._id }).toArray();
    const tpByUser = Object.fromEntries(tps.map((t) => [String(t.userId), t]));

    res.json({
      members: memberships.map((m) => {
        const u = userById[String(m.userId)];
        const base = {
          membershipId: String(m._id),
          userId: String(m.userId),
          name: u?.name || 'Unknown',
          email: isStaff || String(m.userId) === String(req.userId) ? u?.email : null,
          avatarColor: u?.avatarColor,
          role: m.role,
          joinedAt: m.joinedAt,
          isMe: String(m.userId) === String(req.userId),
        };
        if (!isStaff && String(m.userId) !== String(req.userId)) {
          return { ...base, permissions: null, monitoringEnabled: null };
        }
        return {
          ...base,
          permissions: m.role === 'owner' ? DEFAULT_TEACHER_PERMISSIONS : m.permissions,
          monitoringEnabled: tpByUser[String(m.userId)]?.monitoringEnabled ?? null,
          inheritedMonitoring: tpByUser[String(m.userId)]?.inheritedMonitoring ?? null,
        };
      }),
      canManage: membership.role === 'owner' || Boolean(membership.permissions?.manageMembers),
    });
  }),
);

async function getUserByEmailOrId(identifier) {
  const db = getDb();
  const id = toOid(identifier);
  if (id) {
    const byId = await db.collection('users').findOne({ _id: id });
    if (byId) return byId;
  }
  return db.collection('users').findOne({ email: String(identifier).trim().toLowerCase() });
}

/** Approve / reject a pending join request. */
router.post(
  '/:classroomId/join-requests/:requestId',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomStaff(req.params.classroomId, req.userId, 'manageMembers');
    const data = validate(z.object({ action: z.enum(['approve', 'reject']) }), req.body);
    const db = getDb();
    const request = await db
      .collection('join_requests')
      .findOne({ _id: toOid(req.params.requestId), classroomId: classroom._id, status: 'pending' });
    if (!request) throw notFound('Join request not found or already decided');
    if (String(request.userId) === String(req.userId)) throw badRequest('You cannot decide your own request');

    const now = new Date();
    await db.collection('join_requests').updateOne(
      { _id: request._id },
      { $set: { status: data.action === 'approve' ? 'approved' : 'rejected', decidedBy: req.userId, decidedAt: now } },
    );

    if (data.action === 'approve') {
      const existing = await db.collection('classroom_memberships').findOne({ classroomId: classroom._id, userId: request.userId });
      if (existing) {
        await db.collection('classroom_memberships').updateOne(
          { _id: existing._id },
          { $set: { status: 'active', role: 'student', joinedAt: now, updatedAt: now } },
        );
      } else {
        await db.collection('classroom_memberships').insertOne({
          classroomId: classroom._id,
          userId: request.userId,
          role: 'student',
          status: 'active',
          permissions: {},
          monitoringEnabled: false,
          invitedBy: req.userId,
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    const stats = await classroomStats(classroom._id);
    await db.collection('classrooms').updateOne(
      { _id: classroom._id },
      { $set: { stats: { ...classroom.stats, ...stats, lastActivityAt: now } } },
    );
    await logAudit({
      actorId: req.userId,
      classroomId: classroom._id,
      action: `classroom.join_request_${data.action}`,
      target: String(request.userId),
      ip: req.ip,
    });
    res.json({ ok: true, status: data.action === 'approve' ? 'approved' : 'rejected', stats });
  }),
);

/** Owner invites a user directly (by email or user id) with a role. */
router.post(
  '/:classroomId/members',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomStaff(req.params.classroomId, req.userId, 'manageMembers');
    const data = validate(
      z.object({
        identifier: z.string().trim().min(3).max(120),
        role: z.enum(['co_owner', 'teacher', 'student']).default('student'),
        permissions: permissionSchema.optional(),
        monitoringEnabled: z.boolean().optional(),
      }),
      req.body,
    );
    if (data.role !== 'student' && membership.role !== 'owner') {
      throw forbidden('Only the primary owner can appoint co-owners and teachers');
    }
    const db = getDb();
    const user = await getUserByEmailOrId(data.identifier);
    if (!user) throw notFound('No LearnMate account matches that email or user ID');
    if (String(user._id) === String(req.userId)) throw badRequest('You are already in this classroom');

    const now = new Date();
    const existing = await db.collection('classroom_memberships').findOne({ classroomId: classroom._id, userId: user._id });
    const perms = data.role === 'student' ? {} : { ...DEFAULT_TEACHER_PERMISSIONS, ...(data.permissions || {}) };
    if (existing) {
      if (existing.status === 'active') throw conflict('That user is already an active member');
      await db.collection('classroom_memberships').updateOne(
        { _id: existing._id },
        { $set: { status: 'active', role: data.role, permissions: perms, joinedAt: now, updatedAt: now, invitedBy: req.userId } },
      );
    } else {
      await db.collection('classroom_memberships').insertOne({
        classroomId: classroom._id,
        userId: user._id,
        role: data.role,
        status: 'active',
        permissions: perms,
        monitoringEnabled: false,
        invitedBy: req.userId,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (data.role !== 'student') {
      const monitoringEnabled =
        data.monitoringEnabled ?? data.permissions?.monitorStudents ?? classroom.settings?.monitoringDefault ?? true;
      await db.collection('teacher_permissions').updateOne(
        { classroomId: classroom._id, userId: user._id },
        {
          $set: {
            monitoringEnabled,
            permissions: perms,
            assignedBy: req.userId,
            inheritedMonitoring: data.monitoringEnabled === undefined,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
    }

    const stats = await classroomStats(classroom._id);
    await db.collection('classrooms').updateOne({ _id: classroom._id }, { $set: { stats: { ...classroom.stats, ...stats } } });
    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'classroom.member_added', target: String(user._id), meta: { role: data.role }, ip: req.ip });
    res.status(201).json({
      ok: true,
      member: { userId: String(user._id), name: user.name, email: user.email, role: data.role, permissions: perms },
      stats,
    });
  }),
);

/** Change a member's role/permissions (owner only for staff roles). */
router.patch(
  '/:classroomId/members/:userId',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomStaff(req.params.classroomId, req.userId, 'manageMembers');
    const targetUserId = toOid(req.params.userId);
    if (!targetUserId) throw badRequest('Invalid user id');
    const data = validate(
      z.object({
        role: z.enum(['co_owner', 'teacher', 'student']).optional(),
        permissions: permissionSchema.optional(),
        monitoringEnabled: z.boolean().optional(),
      }),
      req.body,
    );
    const db = getDb();
    const target = await db.collection('classroom_memberships').findOne({
      classroomId: classroom._id,
      userId: targetUserId,
      status: 'active',
    });
    if (!target) throw notFound('Member not found in this classroom');
    if (target.role === 'owner') throw forbidden('The primary owner role cannot be changed here. Use ownership transfer.');

    const isOwner = membership.role === 'owner';
    const setsOwnerLevel = data.role && data.role !== 'student';
    if ((setsOwnerLevel || data.permissions || data.monitoringEnabled !== undefined) && !isOwner) {
      throw forbidden('Only the primary owner can change teaching roles, permissions or monitoring');
    }

    const now = new Date();
    const update = { updatedAt: now };
    if (data.role) update.role = data.role;
    if (data.permissions) update.permissions = { ...(target.permissions || {}), ...data.permissions };
    if (data.role === 'student') update.permissions = {};
    await db.collection('classroom_memberships').updateOne({ _id: target._id }, { $set: update });

    if (data.role && data.role !== 'student') {
      const perms = update.permissions || target.permissions || DEFAULT_TEACHER_PERMISSIONS;
      await db.collection('teacher_permissions').updateOne(
        { classroomId: classroom._id, userId: targetUserId },
        {
          $set: {
            permissions: perms,
            monitoringEnabled: data.monitoringEnabled ?? perms.monitorStudents ?? true,
            assignedBy: req.userId,
            inheritedMonitoring: data.monitoringEnabled === undefined,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
    } else if (data.monitoringEnabled !== undefined) {
      await db.collection('teacher_permissions').updateOne(
        { classroomId: classroom._id, userId: targetUserId },
        { $set: { monitoringEnabled: data.monitoringEnabled, inheritedMonitoring: false, updatedAt: now }, $setOnInsert: { createdAt: now, permissions: target.permissions || {} } },
        { upsert: true },
      );
    }
    if (data.role === 'student') {
      await db.collection('teacher_permissions').deleteOne({ classroomId: classroom._id, userId: targetUserId });
    }

    const stats = await classroomStats(classroom._id);
    await db.collection('classrooms').updateOne({ _id: classroom._id }, { $set: { stats: { ...classroom.stats, ...stats } } });
    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'classroom.member_updated', target: String(targetUserId), meta: data, ip: req.ip });
    res.json({ ok: true, stats });
  }),
);

/**
 * Independent monitoring switch for one teacher.
 * Requirements: each teacher has their own ON/OFF; turning it off never affects
 * their own ability to learn in that classroom.
 */
router.patch(
  '/:classroomId/teachers/:userId/monitoring',
  asyncHandler(async (req, res) => {
    const data = validate(z.object({ monitoringEnabled: z.boolean() }), req.body);
    const db = getDb();
    const classroomId = toOid(req.params.classroomId);
    const targetUserId = toOid(req.params.userId);
    if (!classroomId || !targetUserId) throw badRequest('Invalid identifiers');

    const classroom = await db.collection('classrooms').findOne({ _id: classroomId });
    if (!classroom) throw notFound('Classroom not found');
    const actor = await getMembership(classroomId, req.userId);
    if (!actor || actor.status !== 'active') throw forbidden('You are not a member of this classroom');

    const isSelf = String(req.userId) === String(targetUserId);
    const isOwner = actor.role === 'owner';
    if (!isSelf && !isOwner) throw forbidden('You can only change your own monitoring setting');

    const target = await db.collection('classroom_memberships').findOne({ classroomId, userId: targetUserId, status: 'active' });
    if (!target) throw notFound('Teacher not found in this classroom');
    if (target.role === 'owner' && !isSelf) throw forbidden('The primary owner controls their own monitoring setting');

    const now = new Date();
    await db.collection('teacher_permissions').updateOne(
      { classroomId, userId: targetUserId },
      {
        $set: { monitoringEnabled: data.monitoringEnabled, inheritedMonitoring: false, updatedAt: now },
        $setOnInsert: { permissions: target.permissions || DEFAULT_TEACHER_PERMISSIONS, assignedBy: req.userId, createdAt: now },
      },
      { upsert: true },
    );
    await db
      .collection('classroom_memberships')
      .updateOne({ _id: target._id }, { $set: { 'permissions.monitorStudents': data.monitoringEnabled, updatedAt: now } })
      .catch(() => {});
    await logAudit({
      actorId: req.userId,
      classroomId,
      action: data.monitoringEnabled ? 'monitoring.enabled' : 'monitoring.disabled',
      target: String(targetUserId),
      ip: req.ip,
    });
    res.json({ ok: true, monitoringEnabled: data.monitoringEnabled });
  }),
);

/** Remove a member (staff with manageMembers, or owner). */
router.delete(
  '/:classroomId/members/:userId',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomStaff(req.params.classroomId, req.userId, 'manageMembers');
    const targetUserId = toOid(req.params.userId);
    const db = getDb();
    const target = await db.collection('classroom_memberships').findOne({ classroomId: classroom._id, userId: targetUserId, status: 'active' });
    if (!target) throw notFound('Member not found');
    if (target.role === 'owner') throw forbidden('The primary owner cannot be removed. Transfer ownership first.');
    if (String(targetUserId) === String(req.userId)) throw badRequest('Use “Leave classroom” to leave');
    if (target.role !== 'student' && membership.role !== 'owner') {
      throw forbidden('Only the primary owner can remove teachers');
    }
    await db.collection('classroom_memberships').updateOne(
      { _id: target._id },
      { $set: { status: 'removed', updatedAt: new Date() } },
    );
    await db.collection('teacher_permissions').deleteOne({ classroomId: classroom._id, userId: targetUserId });
    const stats = await classroomStats(classroom._id);
    await db.collection('classrooms').updateOne({ _id: classroom._id }, { $set: { stats: { ...classroom.stats, ...stats } } });
    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'classroom.member_removed', target: String(targetUserId), ip: req.ip });
    res.json({ ok: true, stats });
  }),
);

/** Leave a classroom. Learning records are preserved (history is never deleted). */
router.post(
  '/:classroomId/leave',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomMember(req.params.classroomId, req.userId);
    if (membership.role === 'owner') {
      throw badRequest('Transfer ownership before leaving this classroom');
    }
    const db = getDb();
    await db.collection('classroom_memberships').updateOne(
      { _id: membership._id },
      { $set: { status: 'left', updatedAt: new Date() } },
    );
    await db.collection('teacher_permissions').deleteOne({ classroomId: classroom._id, userId: req.userId });
    const stats = await classroomStats(classroom._id);
    await db.collection('classrooms').updateOne({ _id: classroom._id }, { $set: { stats: { ...classroom.stats, ...stats } } });
    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'classroom.left', ip: req.ip });
    res.json({ ok: true });
  }),
);

/** Transfer primary ownership to another active member. */
router.post(
  '/:classroomId/transfer-ownership',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomOwner(req.params.classroomId, req.userId);
    const data = validate(z.object({ userId: z.string() }), req.body);
    const newOwnerId = toOid(data.userId);
    if (!newOwnerId) throw badRequest('Invalid user id');
    if (String(newOwnerId) === String(req.userId)) throw badRequest('You already own this classroom');
    const db = getDb();
    const target = await db.collection('classroom_memberships').findOne({
      classroomId: classroom._id,
      userId: newOwnerId,
      status: 'active',
    });
    if (!target) throw notFound('That user is not an active member of this classroom');

    const now = new Date();
    await db.collection('classrooms').updateOne({ _id: classroom._id }, { $set: { ownerId: newOwnerId, updatedAt: now } });
    await db.collection('classroom_memberships').updateOne(
      { _id: target._id },
      { $set: { role: 'owner', permissions: { ...DEFAULT_TEACHER_PERMISSIONS }, updatedAt: now } },
    );
    await db.collection('classroom_memberships').updateOne(
      { _id: membership._id },
      { $set: { role: 'co_owner', permissions: { ...DEFAULT_TEACHER_PERMISSIONS }, updatedAt: now } },
    );
    await db.collection('teacher_permissions').updateOne(
      { classroomId: classroom._id, userId: newOwnerId },
      { $set: { monitoringEnabled: true, permissions: { ...DEFAULT_TEACHER_PERMISSIONS }, updatedAt: now }, $setOnInsert: { createdAt: now, assignedBy: req.userId } },
      { upsert: true },
    );
    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'classroom.ownership_transferred', target: String(newOwnerId), ip: req.ip });
    res.json({ ok: true });
  }),
);

/** Per-classroom AI feature overrides (classroom owners only; never global credentials). */
router.get(
  '/:classroomId/ai-settings',
  asyncHandler(async (req, res) => {
    const { classroom, membership } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const globalFlags = await db.collection('ai_feature_flags').find({}).toArray();
    res.json({
      settings: classroom.settings,
      canEdit: membership.role === 'owner',
      globalFeatures: globalFlags.map((f) => ({ key: f._id, label: f.label, enabled: f.enabled })),
    });
  }),
);

router.patch(
  '/:classroomId/ai-settings',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomOwner(req.params.classroomId, req.userId);
    const data = validate(settingsSchema, req.body);
    const db = getDb();
    const settings = { ...classroom.settings, ...pick(data, Object.keys(settingsSchema.shape)) };
    await db.collection('classrooms').updateOne({ _id: classroom._id }, { $set: { settings, updatedAt: new Date() } });
    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'classroom.ai_settings_updated', meta: data, ip: req.ip });
    res.json({ settings });
  }),
);

router.get(
  '/:classroomId/audit',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomOwner(req.params.classroomId, req.userId);
    const db = getDb();
    const logs = await db.collection('audit_logs').find({ classroomId: classroom._id }).sort({ at: -1 }).limit(60).toArray();
    const actorIds = [...new Set(logs.map((l) => String(l.actorId)).filter(Boolean))].map((id) => toOid(id)).filter(Boolean);
    const actors = actorIds.length ? await db.collection('users').find({ _id: { $in: actorIds } }).toArray() : [];
    const actorById = Object.fromEntries(actors.map((a) => [String(a._id), a.name]));
    res.json({
      logs: logs.map((l) => ({
        id: String(l._id),
        action: l.action,
        actor: actorById[String(l.actorId)] || 'System',
        target: l.target,
        meta: l.meta,
        at: l.at,
      })),
    });
  }),
);

export default router;
