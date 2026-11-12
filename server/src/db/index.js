import { MongoClient } from 'mongodb';
import config from '../config/index.js';

let client = null;
let db = null;
let embeddedServer = null;
let connectionUri = '';

/**
 * Starts the database.
 *
 * Two modes:
 *  - external: standard MongoDB / MongoDB Atlas via MONGODB_URI
 *  - embedded: a MongoDB wire-protocol compatible engine bundled as an npm
 *    dependency (no external install). Great for demos, tests and local dev.
 *    The same application code, indexes, queries and aggregations run in both
 *    modes because we use the official `mongodb` driver.
 */
export async function connectDb() {
  if (db) return db;

  if (config.db.mode === 'external') {
    if (!config.db.uri) throw new Error('DB_MODE=external but MONGODB_URI is not set');
    client = new MongoClient(config.db.uri, { maxPoolSize: 20 });
    await client.connect();
    connectionUri = config.db.uri;
  } else {
    const { NoSqlDbServer } = await import('@lossless.org/nosqldb');
    embeddedServer = new NoSqlDbServer({
      port: config.db.port,
      storage: 'file',
      storagePath: config.db.path,
      engineLog: () => {},
    });
    await embeddedServer.start();
    connectionUri = `mongodb://127.0.0.1:${config.db.port}`;
    client = new MongoClient(connectionUri, { directConnection: true, maxPoolSize: 20 });
    await client.connect();
  }

  db = client.db(config.db.name);
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not connected');
  return db;
}

export function getClient() {
  if (!client) throw new Error('Database not connected');
  return client;
}

export function dbInfo() {
  return { mode: config.db.mode, database: config.db.name, connected: Boolean(db), uri: config.db.mode === 'external' ? 'external' : connectionUri };
}

export async function closeDb() {
  if (client) {
    await client.close().catch(() => {});
    client = null;
    db = null;
  }
  if (embeddedServer) {
    await embeddedServer.stop().catch(() => {});
    embeddedServer = null;
  }
}

export const collections = {
  users: 'users',
  classrooms: 'classrooms',
  memberships: 'classroom_memberships',
  roles: 'classroom_roles',
  teacherPermissions: 'teacher_permissions',
  joinRequests: 'join_requests',
  syllabuses: 'syllabuses',
  syllabusUnits: 'syllabus_units',
  syllabusConcepts: 'syllabus_concepts',
  syllabusChunks: 'syllabus_chunks',
  learningSessions: 'learning_sessions',
  learningProfiles: 'student_learning_profiles',
  knowledgeGaps: 'knowledge_gaps',
  misconceptions: 'misconceptions',
  practicalDifficulties: 'practical_difficulties',
  topicMastery: 'topic_mastery',
  assessments: 'assessments',
  assessmentResults: 'assessment_results',
  activities: 'student_activities',
  chatMessages: 'chat_messages',
  chatSessions: 'chat_sessions',
  chatPrivacy: 'chat_privacy_permissions',
  privacyAudit: 'chat_privacy_audit',
  aiConfig: 'ai_config',
  aiModels: 'ai_models',
  aiRouting: 'ai_task_routing',
  aiFeatures: 'ai_feature_flags',
  aiUsage: 'ai_usage_logs',
  practicalExercises: 'practical_exercises',
  codeSubmissions: 'code_submissions',
  auditLogs: 'audit_logs',
  notifications: 'notifications',
};
