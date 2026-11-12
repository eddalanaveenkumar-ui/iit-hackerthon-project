import { getDb } from '../../db/index.js';
import { ObjectId } from 'mongodb';
import { forbidden, notFound, badRequest } from '../../utils/errors.js';

export const TEACHER_ROLES = ['owner', 'co_owner', 'teacher'];
export const STAFF_ROLES = ['owner', 'co_owner', 'teacher'];

export function toOid(id) {
  if (id instanceof ObjectId) return id;
  if (!id || !ObjectId.isValid(String(id))) return null;
  return new ObjectId(String(id));
}

export const DEFAULT_TEACHER_PERMISSIONS = {
  manageMembers: true,
  manageSyllabus: true,
  monitorStudents: true,
  manageAssessments: true,
  viewAnalytics: true,
};

export const DEFAULT_CLASSROOM_SETTINGS = {
  allowStudentChat: true,
  monitoringDefault: true,
  adaptiveDifficulty: true,
  practicalEnabled: true,
  aiTutorEnabled: true,
  knowledgeGapDetection: true,
  autoAssessments: true,
  chatHistoryDays: 90,
};

export async function getMembership(classroomId, userId) {
  if (!classroomId || !userId) return null;
  const db = getDb();
  return db.collection('classroom_memberships').findOne({
    classroomId: toOid(classroomId),
    userId: toOid(userId),
    status: 'active',
  });
}

export async function getClassroom(id) {
  const db = getDb();
  const classroomId = toOid(id);
  if (!classroomId) return null;
  const byId = await db.collection('classrooms').findOne({ _id: classroomId });
  if (byId) return byId;
  return db.collection('classrooms').findOne({ code: String(id).toUpperCase() });
}

export async function requireClassroomMember(classroomId, userId) {
  const classroom = await getClassroom(classroomId);
  if (!classroom) throw notFound('Classroom not found');
  const membership = await getMembership(classroom._id, userId);
  if (!membership) throw forbidden('You are not a member of this classroom');
  return { classroom, membership };
}

export async function requireClassroomStaff(classroomId, userId, capability) {
  const { classroom, membership } = await requireClassroomMember(classroomId, userId);
  if (!STAFF_ROLES.includes(membership.role)) {
    throw forbidden('Classroom management permission required');
  }
  if (capability) {
    if (membership.role === 'owner') {
      return { classroom, membership, permissions: { ...DEFAULT_TEACHER_PERMISSIONS } };
    }
    if (!membership.permissions?.[capability]) {
      throw forbidden(`Your classroom role does not include the "${capability}" permission`);
    }
  }
  return { classroom, membership, permissions: membership.permissions || {} };
}

export async function requireClassroomOwner(classroomId, userId) {
  const { classroom, membership } = await requireClassroomMember(classroomId, userId);
  if (membership.role !== 'owner') throw forbidden('Only the classroom owner can perform this action');
  return { classroom, membership };
}

/**
 * Monitoring gate. Every read of another user's learning data goes through here.
 * Owners may switch their own monitoring off too (requirement: each teacher has an
 * independent monitoring ON/OFF setting), so the rule is identical for all staff.
 */
export async function requireMonitoring(classroomId, userId) {
  const { classroom, membership } = await requireClassroomStaff(classroomId, userId);
  const db = getDb();
  const tp = await db
    .collection('teacher_permissions')
    .findOne({ classroomId: classroom._id, userId: toOid(userId) });
  const enabled = tp ? tp.monitoringEnabled : membership.role === 'owner';
  if (!enabled) {
    throw forbidden('Monitoring is disabled for your teacher profile in this classroom');
  }
  return { classroom, membership, monitoring: tp };
}

/** Students may only read their own learning data; staff need monitoring rights. */
export async function requireProfileAccess(classroomId, requesterId, targetUserId) {
  const { classroom, membership } = await requireClassroomMember(classroomId, requesterId);
  const isSelf = String(requesterId) === String(targetUserId);
  if (isSelf) return { classroom, membership, self: true };
  if (!STAFF_ROLES.includes(membership.role)) {
    throw forbidden('You can only access your own learning profile');
  }
  await requireMonitoring(classroom._id, requesterId);
  return { classroom, membership, self: false };
}

export function assertNotSelfTransfer(classroom, actorId, newOwnerId) {
  if (String(actorId) === String(newOwnerId)) throw badRequest('You already own this classroom');
  if (String(classroom.ownerId) !== String(actorId)) throw forbidden('Only the primary owner can transfer ownership');
}

export async function logAudit({ actorId, classroomId, action, target, meta, ip }) {
  const db = getDb();
  await db.collection('audit_logs').insertOne({
    actorId: toOid(actorId),
    classroomId: classroomId ? toOid(classroomId) : null,
    action,
    target: target || null,
    meta: meta || {},
    ip: ip || null,
    at: new Date(),
  });
}
