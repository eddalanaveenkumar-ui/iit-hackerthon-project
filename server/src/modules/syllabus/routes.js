import { Router } from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../../utils/errors.js';
import { validate, slugify } from '../../utils/validation.js';
import { requireClassroomStaff, requireClassroomMember, logAudit, toOid } from '../classrooms/access.js';
import { extractDocument, chunkText } from './extract.js';
import { runEmbeddings } from '../ai/orchestrator.js';
import { hashedEmbedding } from '../ai/providers/local.js';
import { parseDocumentToSyllabus } from './parser.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 5 },
});

const SUBJECT_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#ea580c', '#db2777'];

function buildTree(nodes) {
  const subjects = nodes
    .filter((n) => n.type === 'subject')
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      id: String(s._id),
      name: s.name,
      description: s.description || '',
      order: s.order,
      color: s.color,
      units: nodes
        .filter((n) => n.type === 'unit' && String(n.parentId) === String(s._id))
        .sort((a, b) => a.order - b.order)
        .map((u) => ({
          id: String(u._id),
          name: u.name,
          description: u.description || '',
          order: u.order,
          estimatedMinutes: u.estimatedMinutes || 45,
          concepts: nodes
            .filter((n) => n.type === 'concept' && String(n.parentId) === String(u._id))
            .sort((a, b) => a.order - b.order)
            .map((c) => ({
              id: String(c._id),
              name: c.name,
              description: c.description || '',
              objectives: c.objectives || [],
              keywords: c.keywords || [],
              estimatedMinutes: c.estimatedMinutes || 20,
              order: c.order,
              subtopics: nodes
                .filter((n) => n.type === 'subtopic' && String(n.parentId) === String(c._id))
                .sort((a, b) => a.order - b.order)
                .map((st) => ({ id: String(st._id), name: st.name, description: st.description || '' })),
            })),
        })),
    }));
  return subjects;
}

export async function getSyllabusTree(classroomId) {
  const db = getDb();
  const cid = toOid(classroomId);
  const syllabus = await db.collection('syllabuses').findOne({ classroomId: cid, status: 'active' });
  const nodes = await db.collection('syllabus_units').find({ classroomId: cid }).toArray();
  return { syllabus, subjects: buildTree(nodes) };
}

/** Root-level syllabus view used by the /start flow. */
router.get(
  '/:classroomId',
  asyncHandler(async (req, res) => {
    await requireClassroomMember(req.params.classroomId, req.userId);
    const { syllabus, subjects } = await getSyllabusTree(req.params.classroomId);
    res.json({
      syllabus: syllabus
        ? {
            id: String(syllabus._id),
            title: syllabus.title,
            version: syllabus.version,
            source: syllabus.source,
            status: syllabus.status,
            documents: syllabus.documents || [],
            materialStats: syllabus.materialStats || { documents: 0, chunks: 0 },
            updatedAt: syllabus.updatedAt,
          }
        : null,
      subjects,
    });
  }),
);

const conceptSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1200).optional(),
  objectives: z.array(z.string().max(300)).max(10).optional(),
  keywords: z.array(z.string().max(60)).max(15).optional(),
  estimatedMinutes: z.number().int().min(5).max(240).optional(),
  subtopics: z.array(z.object({ name: z.string().trim().min(2).max(160), description: z.string().max(600).optional() })).max(20).optional(),
});

const unitSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(800).optional(),
  estimatedMinutes: z.number().int().min(10).max(1200).optional(),
  concepts: z.array(conceptSchema).min(1).max(40),
});

const subjectSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(800).optional(),
  units: z.array(unitSchema).min(1).max(30),
});

async function persistSyllabus({ classroomId, userId, source, title, subjects, replace = true }) {
  const db = getDb();
  const cid = toOid(classroomId);
  const now = new Date();

  if (replace) {
    const previous = await db.collection('syllabuses').find({ classroomId: cid }).toArray();
    if (previous.length) {
      await db.collection('syllabuses').updateMany({ classroomId: cid }, { $set: { status: 'archived', updatedAt: now } });
    }
  }
  const existingCount = await db.collection('syllabuses').countDocuments({ classroomId: cid });
  const syllabusDoc = {
    classroomId: cid,
    version: existingCount + 1,
    title,
    source,
    status: 'active',
    subjects: [],
    materialStats: { documents: 0, chunks: 0 },
    documents: [],
    createdBy: toOid(userId),
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId: syllabusId } = await db.collection('syllabuses').insertOne(syllabusDoc);

  const docs = [];
  let subjectOrder = 0;
  for (const subject of subjects) {
    const subjectId = new ObjectId();
    docs.push({
      _id: subjectId,
      classroomId: cid,
      syllabusId,
      parentId: null,
      type: 'subject',
      name: subject.name,
      description: subject.description || '',
      order: subjectOrder,
      color: SUBJECT_COLORS[subjectOrder % SUBJECT_COLORS.length],
      estimatedMinutes: 0,
      createdAt: now,
    });
    let unitOrder = 0;
    for (const unit of subject.units) {
      const unitId = new ObjectId();
      docs.push({
        _id: unitId,
        classroomId: cid,
        syllabusId,
        subjectId,
        parentId: subjectId,
        type: 'unit',
        name: unit.name,
        description: unit.description || '',
        order: unitOrder,
        estimatedMinutes: unit.estimatedMinutes || 60,
        createdAt: now,
      });
      let conceptOrder = 0;
      for (const concept of unit.concepts) {
        const conceptId = new ObjectId();
        docs.push({
          _id: conceptId,
          classroomId: cid,
          syllabusId,
          subjectId,
          unitId,
          parentId: unitId,
          type: 'concept',
          name: concept.name,
          description: concept.description || '',
          order: conceptOrder,
          objectives: concept.objectives || [],
          keywords: concept.keywords || [],
          estimatedMinutes: concept.estimatedMinutes || 25,
          createdAt: now,
        });
        if (concept.subtopics?.length) {
          concept.subtopics.forEach((st, stIdx) => {
            docs.push({
              _id: new ObjectId(),
              classroomId: cid,
              syllabusId,
              subjectId,
              unitId,
              parentId: conceptId,
              type: 'subtopic',
              name: st.name,
              description: st.description || '',
              order: stIdx,
              createdAt: now,
            });
          });
        }
        conceptOrder += 1;
      }
      unitOrder += 1;
    }
    subjectOrder += 1;
  }

  if (docs.length) await db.collection('syllabus_units').insertMany(docs);

  const subjectSummaries = subjects.map((s, i) => ({
    subjectId: docs.find((d) => d.type === 'subject' && d.order === i)._id,
    name: s.name,
    order: i,
    unitCount: s.units.length,
    conceptCount: s.units.reduce((a, u) => a + u.concepts.length, 0),
  }));

  await db.collection('syllabuses').updateOne(
    { _id: syllabusId },
    { $set: { subjects: subjectSummaries, updatedAt: now } },
  );
  await db.collection('classrooms').updateOne({ _id: cid }, { $set: { 'stats.lastActivityAt': now, updatedAt: now } });
  return { syllabusId, nodeCount: docs.length, subjects: subjectSummaries };
}

router.post(
  '/:classroomId/manual',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomStaff(req.params.classroomId, req.userId, 'manageSyllabus');
    const data = validate(
      z.object({ title: z.string().trim().min(2).max(140), subjects: z.array(subjectSchema).min(1).max(10) }),
      req.body,
    );
    const result = await persistSyllabus({
      classroomId: classroom._id,
      userId: req.userId,
      source: 'manual',
      title: data.title,
      subjects: data.subjects,
    });
    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'syllabus.manual_created', target: String(result.syllabusId), ip: req.ip });
    const tree = await getSyllabusTree(classroom._id);
    res.status(201).json({ ok: true, ...result, syllabus: tree.syllabus, subjects: tree.subjects });
  }),
);

/**
 * File upload -> text extraction -> AI structure parsing -> review -> save.
 * `preview=true` returns the parsed structure without persisting so the owner
 * can correct it before publishing.
 */
router.post(
  '/:classroomId/upload',
  upload.array('files', 5),
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomStaff(req.params.classroomId, req.userId, 'manageSyllabus');
    const files = req.files || [];
    if (!files.length) throw badRequest('No files uploaded');
    const subjectHint = req.body.subject || '';

    const extracted = [];
    for (const file of files) {
      try {
        const result = await extractDocument({
          buffer: file.buffer,
          mimetype: file.mimetype,
          originalname: file.originalname,
        });
        extracted.push(result);
      } catch (err) {
        extracted.push({ filename: file.originalname, error: err.message });
      }
    }
    const usable = extracted.filter((e) => !e.error && e.text?.trim().length > 10);
    if (!usable.length) {
      const reason = extracted.map((e) => `${e.filename}: ${e.error || 'no readable text'}`).join('; ');
      throw badRequest(`Could not read any content from the upload. ${reason}`);
    }

    const combined = usable.map((e) => `## ${e.filename}\n${e.text}`).join('\n\n');
    const parsed = await parseDocumentToSyllabus({
      text: combined,
      subject: subjectHint || classroom.subject || '',
      userId: req.userId,
      classroomId: classroom._id,
    });

    if (req.body.preview === 'true' || req.body.preview === '1') {
      return res.json({
        preview: true,
        files: extracted.map((e) => ({ filename: e.filename, error: e.error || null, words: e.words || 0, pages: e.pages || null })),
        syllabus: parsed,
      });
    }

    const result = await persistSyllabus({
      classroomId: classroom._id,
      userId: req.userId,
      source: parsed.source || 'pdf',
      title: parsed.title || `${classroom.subject} Syllabus`,
      subjects: parsed.subjects,
    });

    // Index uploaded material for retrieval (RAG).
    const db = getDb();
    const chunks = [];
    for (const file of usable) {
      for (const [i, text] of chunkText(file.text).entries()) {
        chunks.push({
          classroomId: classroom._id,
          syllabusId: result.syllabusId,
          conceptId: null,
          documentName: file.filename,
          page: null,
          chunkIndex: i,
          text,
          tokens: Math.ceil(text.length / 4),
          createdAt: new Date(),
        });
      }
    }
    if (chunks.length) {
      const vectors = await runEmbeddings(
        chunks.map((c) => c.text),
        { userId: req.userId, classroomId: classroom._id },
      );
      await db.collection('syllabus_chunks').insertMany(
        chunks.map((c, i) => ({ ...c, embedding: vectors[i] || hashedEmbedding(c.text), vectorDims: vectors[i]?.length || 0 })),
      );
    }

    await db.collection('syllabuses').updateOne(
      { _id: result.syllabusId },
      {
        $set: {
          documents: extracted.map((e) => ({ filename: e.filename, words: e.words || 0, pages: e.pages || null, error: e.error || null })),
          'materialStats.documents': usable.length,
          'materialStats.chunks': chunks.length,
        },
      },
    );
    await logAudit({ actorId: req.userId, classroomId: classroom._id, action: 'syllabus.uploaded', target: String(result.syllabusId), meta: { files: usable.length, chunks: chunks.length }, ip: req.ip });

    const tree = await getSyllabusTree(classroom._id);
    res.status(201).json({ ok: true, ...result, syllabus: tree.syllabus, subjects: tree.subjects, files: extracted });
  }),
);

/** Bulk paste of text material -> same AI parse pipeline. */
router.post(
  '/:classroomId/text',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomStaff(req.params.classroomId, req.userId, 'manageSyllabus');
    const data = validate(
      z.object({ title: z.string().trim().min(2).max(140), text: z.string().min(30).max(200_000) }),
      req.body,
    );
    const parsed = await parseDocumentToSyllabus({
      text: data.text,
      subject: classroom.subject,
      userId: req.userId,
      classroomId: classroom._id,
    });
    const result = await persistSyllabus({
      classroomId: classroom._id,
      userId: req.userId,
      source: 'manual',
      title: data.title,
      subjects: parsed.subjects,
    });
    const tree = await getSyllabusTree(classroom._id);
    res.status(201).json({ ok: true, ...result, syllabus: tree.syllabus, subjects: tree.subjects });
  }),
);

/** Append a unit to an existing subject without rebuilding the syllabus. */
router.post(
  '/:classroomId/units',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomStaff(req.params.classroomId, req.userId, 'manageSyllabus');
    const data = validate(
      z.object({ subjectId: z.string(), unit: unitSchema }),
      req.body,
    );
    const db = getDb();
    const cid = toOid(classroom._id);
    const syllabus = await db.collection('syllabuses').findOne({ classroomId: cid, status: 'active' });
    if (!syllabus) throw notFound('Create a syllabus before adding units');
    const subject = await db.collection('syllabus_units').findOne({ _id: toOid(data.subjectId), classroomId: cid, type: 'subject' });
    if (!subject) throw notFound('Subject not found in this classroom');
    const unitCount = await db.collection('syllabus_units').countDocuments({ classroomId: cid, type: 'unit', parentId: subject._id });
    const now = new Date();
    const unitId = new ObjectId();
    const docs = [
      {
        _id: unitId,
        classroomId: cid,
        syllabusId: syllabus._id,
        subjectId: subject._id,
        parentId: subject._id,
        type: 'unit',
        name: data.unit.name,
        description: data.unit.description || '',
        order: unitCount,
        estimatedMinutes: data.unit.estimatedMinutes || 60,
        createdAt: now,
      },
    ];
    data.unit.concepts.forEach((c, i) => {
      docs.push({
        _id: new ObjectId(),
        classroomId: cid,
        syllabusId: syllabus._id,
        subjectId: subject._id,
        unitId,
        parentId: unitId,
        type: 'concept',
        name: c.name,
        description: c.description || '',
        order: i,
        objectives: c.objectives || [],
        keywords: c.keywords || [],
        estimatedMinutes: c.estimatedMinutes || 25,
        createdAt: now,
      });
    });
    await db.collection('syllabus_units').insertMany(docs);
    await db.collection('syllabuses').updateOne(
      { _id: syllabus._id },
      { $set: { updatedAt: now }, $inc: { 'subjects.$[el].unitCount': 0 } },
    ).catch(() => {});
    const tree = await getSyllabusTree(cid);
    res.status(201).json({ ok: true, subjects: tree.subjects });
  }),
);

router.delete(
  '/:classroomId/concepts/:conceptId',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomStaff(req.params.classroomId, req.userId, 'manageSyllabus');
    const db = getDb();
    const cid = toOid(classroom._id);
    const conceptId = toOid(req.params.conceptId);
    const node = await db.collection('syllabus_units').findOne({ _id: conceptId, classroomId: cid, type: 'concept' });
    if (!node) throw notFound('Concept not found');
    const covered = await db.collection('topic_mastery').countDocuments({ classroomId: cid, conceptId });
    if (covered > 0) throw forbidden('This concept already has student learning records and cannot be deleted');
    await db.collection('syllabus_units').deleteMany({ parentId: conceptId, classroomId: cid });
    await db.collection('syllabus_units').deleteOne({ _id: conceptId, classroomId: cid });
    const tree = await getSyllabusTree(cid);
    res.json({ ok: true, subjects: tree.subjects });
  }),
);

router.get(
  '/:classroomId/materials',
  asyncHandler(async (req, res) => {
    await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const cid = toOid(req.params.classroomId);
    const chunks = await db
      .collection('syllabus_chunks')
      .find({ classroomId: cid }, { projection: { embedding: 0 } })
      .limit(50)
      .toArray();
    res.json({
      materials: chunks.map((c) => ({
        id: String(c._id),
        documentName: c.documentName,
        chunkIndex: c.chunkIndex,
        excerpt: c.text.slice(0, 220),
        tokens: c.tokens,
      })),
    });
  }),
);

export default router;
