import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { ensureIndexes } from '../db/schema.js';
import { bootstrapAiCatalog } from '../modules/ai/config-store.js';
import { triggerSeedWorkflows } from './workflows.js';
import { JAVA_SYLLABUS, ML_SYLLABUS, WEB_SYLLABUS } from './syllabi.js';

/**
 * Sample users and classrooms, for tests and deliberate demos only.
 *
 * Nothing here runs unless a deployment sets SEED_DEMO=true. It used to default
 * to on, which put seven accounts sharing one password — one of them an
 * administrator — into every fresh database, production included. The default is
 * now off, the login page no longer advertises these accounts, and a fresh
 * deployment is opened with the administrator account instead (ADMIN_EMAIL /
 * ADMIN_PASSWORD, created by `ensureAdminAccount`).
 *
 * The e2e harnesses turn SEED_DEMO back on because they exercise classroom
 * membership, permissions and monitoring — flows that need populated classrooms.
 */
const DEMO_PASSWORD = 'LearnMate123!';

const DEMO_USERS = [
  { name: 'Naveen Kumar', email: 'naveen@learnmate.ai', headline: 'CSE undergraduate · learning Java and ML', avatarColor: '#2563eb', role: 'user' },
  { name: 'Aisha Rahman', email: 'aisha@learnmate.ai', headline: 'Classroom owner · Java Programming', avatarColor: '#7c3aed', role: 'user' },
  { name: 'Dr. Meera Iyer', email: 'meera@learnmate.ai', headline: 'Machine Learning faculty', avatarColor: '#0891b2', role: 'user' },
  { name: 'Rohit Verma', email: 'rohit@learnmate.ai', headline: 'Backend developer · JS practice', avatarColor: '#059669', role: 'user' },
  { name: 'Priya Suresh', email: 'priya@learnmate.ai', headline: 'Full-stack learner', avatarColor: '#db2777', role: 'user' },
  { name: 'Karthik Raman', email: 'karthik@learnmate.ai', headline: 'Web development enthusiast', avatarColor: '#ea580c', role: 'user' },
  { name: 'Platform Admin', email: 'admin@learnmate.ai', headline: 'LearnMate platform administrator', avatarColor: '#b45309', role: 'admin' },
];

const COVER_IMAGES = {
  java: 'linear-gradient(135deg,#1e3a8a,#2563eb 45%,#38bdf8)',
  ml: 'linear-gradient(135deg,#064e3b,#0891b2 45%,#22d3ee)',
  web: 'linear-gradient(135deg,#7c2d12,#ea580c 45%,#fbbf24)',
};

const SUBJECT_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#ea580c', '#db2777'];

function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i += 1) s += A[Math.floor(Math.random() * A.length)];
  let t = '';
  for (let i = 0; i < 4; i += 1) t += A[Math.floor(Math.random() * A.length)];
  return `LM-${s}-${t}`;
}

async function insertSyllabus(classroomId, userId, data, source = 'manual') {
  const db = getDb();
  const now = new Date();
  const syllabusDoc = {
    classroomId,
    version: 1,
    title: data.title,
    source,
    status: 'active',
    subjects: [],
    materialStats: { documents: 0, chunks: 0 },
    documents: [],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId: syllabusId } = await db.collection('syllabuses').insertOne(syllabusDoc);
  const docs = [];
  const subjectSummaries = [];
  let sIdx = 0;
  for (const subject of data.subjects) {
    const subjectId = new ObjectId();
    docs.push({
      _id: subjectId,
      classroomId,
      syllabusId,
      parentId: null,
      type: 'subject',
      name: subject.name,
      description: subject.description || '',
      order: sIdx,
      color: SUBJECT_COLORS[sIdx % SUBJECT_COLORS.length],
      createdAt: now,
    });
    let uIdx = 0;
    let conceptCount = 0;
    for (const unit of subject.units) {
      const unitId = new ObjectId();
      docs.push({
        _id: unitId,
        classroomId,
        syllabusId,
        subjectId,
        parentId: subjectId,
        type: 'unit',
        name: unit.name,
        description: unit.description || '',
        order: uIdx,
        estimatedMinutes: 60,
        createdAt: now,
      });
      let cIdx = 0;
      for (const concept of unit.concepts) {
        const conceptId = new ObjectId();
        docs.push({
          _id: conceptId,
          classroomId,
          syllabusId,
          subjectId,
          unitId,
          parentId: unitId,
          type: 'concept',
          name: concept.name,
          description: concept.description || '',
          objectives: concept.objectives || [],
          keywords: concept.keywords || [],
          order: cIdx,
          estimatedMinutes: 25,
          createdAt: now,
        });
        (concept.subtopics || []).forEach((st, i) => {
          docs.push({
            _id: new ObjectId(),
            classroomId,
            syllabusId,
            subjectId,
            unitId,
            parentId: conceptId,
            type: 'subtopic',
            name: st,
            description: '',
            order: i,
            createdAt: now,
          });
        });
        cIdx += 1;
        conceptCount += 1;
      }
      uIdx += 1;
    }
    subjectSummaries.push({ subjectId, name: subject.name, order: sIdx, unitCount: subject.units.length, conceptCount });
    sIdx += 1;
  }
  await db.collection('syllabus_units').insertMany(docs);
  await db.collection('syllabuses').updateOne({ _id: syllabusId }, { $set: { subjects: subjectSummaries } });
  return syllabusId;
}

async function createClassroom({ name, description, subject, coverImage, ownerId, joinApprovalRequired, code }) {
  const db = getDb();
  const now = new Date();
  const doc = {
    code: code || randomCode(),
    name,
    description,
    subject,
    coverImage,
    ownerId,
    joinApprovalRequired,
    settings: {
      allowStudentChat: true,
      monitoringDefault: true,
      adaptiveDifficulty: true,
      practicalEnabled: true,
      aiTutorEnabled: true,
      knowledgeGapDetection: true,
      autoAssessments: true,
      chatHistoryDays: 90,
    },
    stats: { memberCount: 0, teacherCount: 1, pendingRequests: 0, lastActivityAt: now },
    archived: false,
    createdAt: new Date(Date.now() - 21 * 86_400_000),
    updatedAt: now,
  };
  const { insertedId } = await db.collection('classrooms').insertOne(doc);
  await db.collection('classroom_memberships').insertOne({
    classroomId: insertedId,
    userId: ownerId,
    role: 'owner',
    status: 'active',
    permissions: { manageMembers: true, manageSyllabus: true, monitorStudents: true, manageAssessments: true, viewAnalytics: true },
    monitoringEnabled: true,
    invitedBy: null,
    joinedAt: doc.createdAt,
    createdAt: doc.createdAt,
    updatedAt: now,
  });
  await db.collection('teacher_permissions').insertOne({
    classroomId: insertedId,
    userId: ownerId,
    monitoringEnabled: true,
    permissions: { manageMembers: true, manageSyllabus: true, monitorStudents: true, manageAssessments: true, viewAnalytics: true },
    assignedBy: ownerId,
    inheritedMonitoring: false,
    updatedAt: now,
  });
  return { ...doc, _id: insertedId };
}

async function addMember(classroomId, userId, role, permissions = {}, monitoringEnabled = true) {
  const db = getDb();
  const now = new Date();
  const existing = await db.collection('classroom_memberships').findOne({ classroomId, userId });
  if (existing) {
    await db.collection('classroom_memberships').updateOne({ _id: existing._id }, { $set: { role, status: 'active', permissions, updatedAt: now } });
  } else {
    await db.collection('classroom_memberships').insertOne({
      classroomId,
      userId,
      role,
      status: 'active',
      permissions,
      monitoringEnabled: false,
      invitedBy: null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (role !== 'student') {
    await db.collection('teacher_permissions').updateOne(
      { classroomId, userId },
      {
        $set: { monitoringEnabled, permissions, inheritedMonitoring: false, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
  }
}

async function refreshClassroomStats(classroomId) {
  const db = getDb();
  const [students, teachers, pending] = await Promise.all([
    db.collection('classroom_memberships').countDocuments({ classroomId, status: 'active', role: 'student' }),
    db.collection('classroom_memberships').countDocuments({ classroomId, status: 'active', role: { $in: ['owner', 'co_owner', 'teacher'] } }),
    db.collection('join_requests').countDocuments({ classroomId, status: 'pending' }),
  ]);
  await db.collection('classrooms').updateOne(
    { _id: classroomId },
    {
      $set: {
        'stats.memberCount': students,
        'stats.teacherCount': teachers,
        'stats.pendingRequests': pending,
        'stats.lastActivityAt': new Date(),
      },
    },
  );
}

export async function runSeed({ force = false } = {}) {
  const db = getDb();
  await ensureIndexes();
  await bootstrapAiCatalog();

  // Only the *sample* users count as "already seeded". A real signup — which the
  // e2e suite makes before it signs in — must not disqualify the sample data.
  const alreadySeeded = await db.collection('users').countDocuments({ email: { $in: DEMO_USERS.map((u) => u.email) } });
  if (alreadySeeded > 0 && !force) {
    console.log(`[seed] ${alreadySeeded} demo users already present — skipping demo seed`);
    return { seeded: false };
  }
  if (force) {
    for (const col of await db.listCollections().toArray()) {
      if (col.name.startsWith('system.')) continue;
      await db.collection(col.name).deleteMany({});
    }
    await bootstrapAiCatalog();
  }

  console.log('[seed] creating demo users and classrooms…');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userIds = {};
  for (const u of DEMO_USERS) {
    const { insertedId } = await db.collection('users').insertOne({
      name: u.name,
      email: u.email,
      passwordHash,
      avatarColor: u.avatarColor,
      role: u.role,
      headline: u.headline,
      preferences: { theme: 'light', notifications: true },
      lastActiveAt: new Date(),
      createdAt: new Date(Date.now() - 30 * 86_400_000),
      updatedAt: new Date(),
    });
    userIds[u.email] = insertedId;
  }

  // ---- Classrooms -----------------------------------------------------------
  const javaClass = await createClassroom({
    name: 'Java Programming — Section A',
    description: 'Core Java for second-semester CSE students. Weekly concepts, practicals and unit tests.',
    subject: 'Java Programming',
    coverImage: COVER_IMAGES.java,
    ownerId: userIds['aisha@learnmate.ai'],
    joinApprovalRequired: true,
  });
  await insertSyllabus(javaClass._id, userIds['aisha@learnmate.ai'], JAVA_SYLLABUS);

  const mlClass = await createClassroom({
    name: 'Machine Learning Foundations',
    description: 'Supervised learning foundations with weekly practical notebooks and concept checks.',
    subject: 'Machine Learning',
    coverImage: COVER_IMAGES.ml,
    ownerId: userIds['meera@learnmate.ai'],
    joinApprovalRequired: false,
  });
  await insertSyllabus(mlClass._id, userIds['meera@learnmate.ai'], ML_SYLLABUS);

  const webClass = await createClassroom({
    name: 'Modern Web Development',
    description: 'JavaScript, async patterns and React. Open enrolment for the whole cohort.',
    subject: 'Web Development',
    coverImage: COVER_IMAGES.web,
    ownerId: userIds['naveen@learnmate.ai'],
    joinApprovalRequired: false,
  });
  await insertSyllabus(webClass._id, userIds['naveen@learnmate.ai'], WEB_SYLLABUS);

  const staffPerms = { manageMembers: true, manageSyllabus: true, monitorStudents: true, manageAssessments: true, viewAnalytics: true };

  // Java classroom: Naveen + Priya + Karthik learn; Rohit is a teacher with monitoring OFF.
  await addMember(javaClass._id, userIds['naveen@learnmate.ai'], 'student');
  await addMember(javaClass._id, userIds['priya@learnmate.ai'], 'student');
  await addMember(javaClass._id, userIds['karthik@learnmate.ai'], 'student');
  await addMember(javaClass._id, userIds['rohit@learnmate.ai'], 'teacher', staffPerms, false); // monitoring OFF

  // ML classroom: Naveen + Rohit learn; Priya is a co-owner.
  await addMember(mlClass._id, userIds['naveen@learnmate.ai'], 'student');
  await addMember(mlClass._id, userIds['rohit@learnmate.ai'], 'student');
  await addMember(mlClass._id, userIds['priya@learnmate.ai'], 'co_owner', staffPerms, true);

  // Web classroom (owned by Naveen): everyone learns.
  await addMember(webClass._id, userIds['karthik@learnmate.ai'], 'student');
  await addMember(webClass._id, userIds['priya@learnmate.ai'], 'student');
  await addMember(webClass._id, userIds['rohit@learnmate.ai'], 'student');
  await addMember(webClass._id, userIds['meera@learnmate.ai'], 'student');

  // Pending join requests so the approval workflow has real data.
  await db.collection('join_requests').insertOne({
    classroomId: javaClass._id,
    userId: userIds['rohit@learnmate.ai'],
    message: 'I would like to also learn the Java material alongside teaching it.',
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    createdAt: new Date(Date.now() - 2 * 86_400_000),
  });

  for (const c of [javaClass, mlClass, webClass]) await refreshClassroomStats(c._id);

  // Example practical exercise for the web classroom
  await db.collection('practical_exercises').insertOne({
    classroomId: webClass._id,
    conceptId: null,
    createdByUserId: userIds['naveen@learnmate.ai'],
    title: 'Sum with validation',
    prompt: 'Write solve(values) that returns the sum of numbers in the array. Throw an error for non-arrays and treat empty arrays as 0.',
    language: 'javascript',
    starterCode: 'function solve(values) {\n  // TODO\n}\n',
    solutionHint: 'function solve(values) {\n  if (!Array.isArray(values)) throw new Error("invalid");\n  return values.reduce((a, b) => a + b, 0);\n}',
    tests: [
      { id: 't1', name: 'empty array', args: ['[[]]'], expected: '0', hidden: false },
      { id: 't2', name: 'typical array', args: ['[[1,2,3]]'], expected: '6', hidden: false },
      { id: 't3', name: 'invalid input', args: ['["x"]'], expected: 'any', hidden: true },
    ],
    rubric: [
      { id: 'r1', criterion: 'Correct sum for typical input', weight: 0.5 },
      { id: 'r2', criterion: 'Empty array handled', weight: 0.3 },
      { id: 'r3', criterion: 'Invalid input rejected', weight: 0.2 },
    ],
    difficulty: 'easy',
    createdBy: 'teacher',
    createdAt: new Date(),
  });

  console.log('[seed] simulating realistic learning history…');
  const summary = await triggerSeedWorkflows({ userIds, javaClass, mlClass, webClass });

  console.log('[seed] done');
  return {
    seeded: true,
    credentials: DEMO_USERS.map((u) => ({ email: u.email, password: DEMO_PASSWORD, name: u.name, role: u.role })),
    classrooms: [
      { id: String(javaClass._id), code: javaClass.code, name: javaClass.name, approvalRequired: true },
      { id: String(mlClass._id), code: mlClass.code, name: mlClass.name, approvalRequired: false },
      { id: String(webClass._id), code: webClass.code, name: webClass.name, approvalRequired: false },
    ],
    ...summary,
  };
}

/**
 * Create the administrator account if it is missing.
 *
 * This replaces the seeded demo users. The account comes from the environment:
 *
 *   ADMIN_EMAIL      default admin@gmail.com
 *   ADMIN_PASSWORD   default adimin
 *
 * An existing account with that email is left alone — its password is not
 * reset on every boot, so changing it in the app survives a restart. The role is
 * only ever raised, never lowered, for the configured address.
 *
 * The defaults are weak on purpose (this is what the operator asked to sign in
 * with), so a deployment should set ADMIN_PASSWORD. Nothing else in the product
 * is exposed by this account beyond what any signed-in user gets, plus the AI
 * configuration page.
 */
export async function ensureAdminAccount() {
  const email = config.adminEmail;
  const password = config.adminPassword;
  const db = getDb();

  const existing = await db.collection('users').findOne({ email });
  if (existing) {
    if (existing.role !== 'admin') {
      await db.collection('users').updateOne({ _id: existing._id }, { $set: { role: 'admin', updatedAt: new Date() } });
      console.log(`[seed] promoted ${email} to administrator`);
    }
    return { created: false, email };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.collection('users').insertOne({
    name: 'Administrator',
    email,
    passwordHash,
    avatarColor: '#b45309',
    role: 'admin',
    headline: 'Platform administrator',
    preferences: { theme: 'light', notifications: true },
    lastActiveAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`[seed] administrator account ready: ${email}`);
  return { created: true, email };
}

export async function ensureSeed() {
  // Demo content is off (see DEMO_CONTENT_ENABLED). The administrator account is
  // still created, because without it the deployment has no way in except
  // self-registration.
  await ensureAdminAccount();

  // Demo content only when a deployment explicitly asks for it (SEED_DEMO=true).
  // It exists for the test harnesses and for a deliberate local demo — never for
  // a deployment that did not request it.
  if (!config.seedDemo) return { seeded: false, credentials: [] };

  // Count the *seeded* users, not users in general. A signup that happened
  // before the first seed used to disqualify the sample data entirely, which is
  // why this suite could pass one run and fail the next.
  const db = getDb();
  const seeded = await db.collection('users').countDocuments({ email: { $in: DEMO_USERS.map((u) => u.email) } });
  if (seeded === 0) {
    await runSeed();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { connectDb, closeDb } = await import('../db/index.js');
  await connectDb();
  const force = process.argv.includes('--force');
  await runSeed({ force });
  await closeDb();
  process.exit(0);
}
