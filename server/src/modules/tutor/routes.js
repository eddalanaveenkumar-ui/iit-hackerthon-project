import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../../utils/errors.js';
import { validate } from '../../utils/validation.js';
import { requireClassroomMember, toOid, getMembership } from '../classrooms/access.js';
import privacyRouter from './privacy.js';
import { isFeatureEnabled } from '../ai/config-store.js';
import { runJsonTask } from '../ai/orchestrator.js';
import { prompts } from '../ai/prompts.js';
import { getOrCreateProfile, refreshProfileAggregates, applyMasteryEvidence, getTopicMastery } from '../intelligence/profile.js';
import { analyseInteraction, getOpenGaps } from '../intelligence/gap-engine.js';
import { retrieveContext, buildSyllabusContext } from './retrieval.js';
import { normaliseVisuals, buildFallbackVisuals } from './visuals.js';

const router = Router();

const MODES = {
  learn: { label: 'Learn a concept', instruction: 'Teach from first principles with a worked example, then ask a diagnostic question.' },
  test: { label: 'Test my understanding', instruction: 'Do not teach yet. Ask 3 progressively harder questions and evaluate each answer.' },
  practise: { label: 'Practise practical problems', instruction: 'Give a hands-on implementation task and guide through it with hints, not answers.' },
  continue: { label: 'Continue learning', instruction: 'Continue from the student\'s previous gaps and build on their last session.' },
};

/** Step 1 of /start: classrooms the user can learn in. */
router.get(
  '/classrooms',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const memberships = await db
      .collection('classroom_memberships')
      .find({ userId: req.userId, status: 'active' })
      .toArray();
    const classrooms = await db
      .collection('classrooms')
      .find({ _id: { $in: memberships.map((m) => m.classroomId) }, archived: { $ne: true } })
      .toArray();
    const syllabusCounts = await db
      .collection('syllabuses')
      .find({ classroomId: { $in: classrooms.map((c) => c._id) }, status: 'active' })
      .toArray();
    const withSyllabus = new Set(syllabusCounts.map((s) => String(s.classroomId)));
    const profiles = await db
      .collection('student_learning_profiles')
      .find({ userId: req.userId, classroomId: { $in: classrooms.map((c) => c._id) } })
      .toArray();
    const profileByClassroom = Object.fromEntries(profiles.map((p) => [String(p.classroomId), p]));

    res.json({
      classrooms: classrooms.map((c) => {
        const m = memberships.find((mm) => String(mm.classroomId) === String(c._id));
        const p = profileByClassroom[String(c._id)];
        return {
          id: String(c._id),
          name: c.name,
          code: c.code,
          subject: c.subject,
          description: c.description,
          coverImage: c.coverImage,
          myRole: m?.role,
          hasSyllabus: withSyllabus.has(String(c._id)),
          knowledgeLevel: p?.knowledgeLevel || 'beginner',
          conceptMasteryAvg: p?.mastery?.length
            ? Math.round(p.mastery.reduce((a, m2) => a + m2.score, 0) / p.mastery.length)
            : null,
          openGaps: p ? Object.values(p.weaknessCounts || {}).reduce((a, b) => a + b, 0) : 0,
        };
      }),
    });
  }),
);

/** Steps 2-4: subject -> unit -> concept for the chosen classroom. */
router.get(
  '/classrooms/:classroomId/outline',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const cid = classroom._id;
    const nodes = await db.collection('syllabus_units').find({ classroomId: cid }).toArray();
    if (!nodes.length) {
      return res.json({ subjects: [], hasSyllabus: false, message: 'This classroom has no syllabus yet. Ask the classroom owner to add one.' });
    }
    const mastery = await db.collection('topic_mastery').find({ userId: req.userId, classroomId: cid }).toArray();
    const masteryById = Object.fromEntries(mastery.map((m) => [String(m.conceptId), m]));
    const gaps = await db
      .collection('knowledge_gaps')
      .find({ userId: req.userId, classroomId: cid, status: { $ne: 'resolved' } })
      .toArray();
    const gapsByConcept = gaps.reduce((acc, g) => {
      acc[String(g.conceptId)] = (acc[String(g.conceptId)] || 0) + 1;
      return acc;
    }, {});

    const subjects = nodes
      .filter((n) => n.type === 'subject')
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: String(s._id),
        name: s.name,
        description: s.description,
        color: s.color,
        units: nodes
          .filter((n) => n.type === 'unit' && String(n.parentId) === String(s._id))
          .sort((a, b) => a.order - b.order)
          .map((u) => {
            const concepts = nodes
              .filter((n) => n.type === 'concept' && String(n.parentId) === String(u._id))
              .sort((a, b) => a.order - b.order)
              .map((c) => {
                const m = masteryById[String(c._id)];
                return {
                  id: String(c._id),
                  name: c.name,
                  description: c.description,
                  objectives: c.objectives || [],
                  keywords: c.keywords || [],
                  estimatedMinutes: c.estimatedMinutes || 25,
                  subtopics: nodes
                    .filter((n) => n.type === 'subtopic' && String(n.parentId) === String(c._id))
                    .map((st) => st.name),
                  masteryScore: m?.score ?? null,
                  masteryLevel: m?.level || 'not_started',
                  openGaps: gapsByConcept[String(c._id)] || 0,
                };
              });
            return {
              id: String(u._id),
              name: u.name,
              description: u.description,
              conceptCount: concepts.length,
              avgMastery: concepts.filter((c) => c.masteryScore !== null).length
                ? Math.round(
                    concepts.filter((c) => c.masteryScore !== null).reduce((a, c) => a + c.masteryScore, 0) /
                      concepts.filter((c) => c.masteryScore !== null).length,
                  )
                : null,
              concepts,
            };
          }),
      }));

    res.json({ hasSyllabus: true, subjects, modes: Object.entries(MODES).map(([key, v]) => ({ key, label: v.label })) });
  }),
);

/** Step 6: start a fresh session. Previous records are never deleted. */
router.post(
  '/sessions',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        classroomId: z.string(),
        conceptId: z.string(),
        mode: z.enum(['learn', 'test', 'practise', 'continue']).default('learn'),
      }),
      req.body,
    );
    const { classroom, membership } = await requireClassroomMember(data.classroomId, req.userId);
    if (classroom.settings?.aiTutorEnabled === false) throw forbidden('The AI tutor is disabled for this classroom');
    if (!(await isFeatureEnabled('tutoring'))) throw forbidden('AI tutoring is currently disabled platform-wide');

    const db = getDb();
    const concept = await db.collection('syllabus_units').findOne({ _id: toOid(data.conceptId), classroomId: classroom._id, type: 'concept' });
    if (!concept) throw notFound('Concept not found in this classroom syllabus');
    const unit = await db.collection('syllabus_units').findOne({ _id: concept.parentId, classroomId: classroom._id });
    const subject = concept.subjectId
      ? await db.collection('syllabus_units').findOne({ _id: concept.subjectId, classroomId: classroom._id })
      : null;
    const subtopics = await db.collection('syllabus_units').find({ parentId: concept._id, type: 'subtopic' }).toArray();

    // End any previous active session in this classroom (history preserved).
    await db.collection('learning_sessions').updateMany(
      { userId: req.userId, classroomId: classroom._id, status: 'active' },
      { $set: { status: 'ended', endedAt: new Date() } },
    );

    const profile = await getOrCreateProfile(req.userId, classroom._id);
    const now = new Date();
    const sessionDoc = {
      classroomId: classroom._id,
      userId: req.userId,
      subjectId: concept.subjectId || null,
      unitId: concept.parentId || null,
      conceptId: concept._id,
      mode: data.mode,
      status: 'active',
      startedAt: now,
      endedAt: null,
      messageCount: 0,
      hintsUsed: 0,
      scaffoldingLevel: profile.knowledgeLevel === 'advanced' ? 'independent' : 'supported',
      conceptsCovered: [concept._id],
      createdAt: now,
    };
    const { insertedId: sessionId } = await db.collection('learning_sessions').insertOne(sessionDoc);

    await db.collection('student_learning_profiles').updateOne(
      { _id: profile._id },
      { $set: { lastActivityAt: now, updatedAt: now } },
    );
    await db.collection('student_activities').insertOne({
      userId: req.userId,
      classroomId: classroom._id,
      type: 'session_started',
      title: `Started ${MODES[data.mode].label.toLowerCase()} — ${concept.name}`,
      meta: { mode: data.mode, conceptName: concept.name, unitName: unit?.name },
      conceptId: concept._id,
      minutes: 0,
      createdAt: now,
    });

    const openGaps = await getOpenGaps(req.userId, classroom._id, { conceptId: concept._id });
    const mastery = await getTopicMastery(req.userId, classroom._id, concept._id);
    const retrieved = await retrieveContext({
      classroomId: classroom._id,
      concept: { ...concept, id: concept._id },
      query: unit?.name || '',
    });
    const syllabusContext = buildSyllabusContext({
      concept: { ...concept, subtopics: subtopics.map((s) => s.name) },
      unit,
      subject,
      retrieved: retrieved.chunks,
    });

    // Opening tutor message — generated with the same adaptive context.
    const { data: opening, meta: aiMeta } = await runJsonTask('tutoring', {
      messages: prompts.tutor({
        context: {
          concept: { ...concept, unitName: unit?.name, subjectName: subject?.name, subtopics: subtopics.map((s) => s.name) },
          syllabusContext,
          retrieved: retrieved.chunks,
          profile: { ...profile, conceptMastery: mastery?.score ?? 'not assessed' },
          openGaps,
          mode: MODES[data.mode].label,
          scaffoldingLevel: sessionDoc.scaffoldingLevel,
          adaptiveLevel: profile.knowledgeLevel,
        },
        studentMessage: `I want to ${MODES[data.mode].label.toLowerCase()} for "${concept.name}". Where do we start?`,
      }),
      meta: { task: 'tutor_reply', concept: { ...concept, unitName: unit?.name, subjectName: subject?.name }, conceptId: concept._id, profile, openGaps, retrieved: retrieved.chunks, adaptiveLevel: profile.knowledgeLevel, scaffoldingLevel: sessionDoc.scaffoldingLevel },
      feature: 'tutoring',
      userId: req.userId,
      classroomId: classroom._id,
    });

    const replyText = typeof opening === 'string' ? opening : opening?.reply || `Let's begin with ${concept.name}.`;
    const assistantMsg = {
      sessionId,
      userId: req.userId,
      classroomId: classroom._id,
      conceptId: concept._id,
      role: 'assistant',
      content: replyText,
      meta: {
        kind: 'opening',
        mode: data.mode,
        scaffoldingLevel: sessionDoc.scaffoldingLevel,
        hints: opening?.hints || [],
        citations: opening?.citations || retrieved.chunks.slice(0, 3).map((c) => c.documentName),
        nextPrompt: opening?.nextPrompt || '',
        provider: aiMeta.provider,
        model: aiMeta.model,
        simulated: aiMeta.simulated,
      },
      createdAt: new Date(),
    };
    await db.collection('chat_messages').insertOne(assistantMsg);
    await db.collection('learning_sessions').updateOne({ _id: sessionId }, { $set: { messageCount: 1 } });
    await refreshProfileAggregates(req.userId, classroom._id, {
      stats: { ...profile.stats, sessions: (profile.stats.sessions || 0) + 1 },
    });

    res.status(201).json({
      session: {
        id: String(sessionId),
        mode: data.mode,
        modeLabel: MODES[data.mode].label,
        scaffoldingLevel: sessionDoc.scaffoldingLevel,
      },
      context: {
        classroom: { id: String(classroom._id), name: classroom.name, subject: classroom.subject },
        subject: subject ? { id: String(subject._id), name: subject.name } : null,
        unit: unit ? { id: String(unit._id), name: unit.name } : null,
        concept: { id: String(concept._id), name: concept.name, description: concept.description, objectives: concept.objectives || [], keywords: concept.keywords || [], subtopics: subtopics.map((s) => s.name) },
      },
      profile: {
        knowledgeLevel: profile.knowledgeLevel,
        learningSpeed: profile.learningSpeed,
        independence: profile.independence,
        conceptMastery: mastery?.score ?? null,
        openGaps: openGaps.map((g) => ({ category: g.category, description: g.description, severity: g.severity, occurrences: g.occurrences })),
      },
      messages: [
        {
          id: String(assistantMsg._id || new ObjectId()),
          role: 'assistant',
          content: replyText,
          meta: assistantMsg.meta,
          createdAt: assistantMsg.createdAt,
        },
      ],
      retrieval: {
        strategy: retrieved.strategy,
        sources: retrieved.chunks.map((c) => ({ documentName: c.documentName, excerpt: String(c.text).slice(0, 180) })),
      },
      ai: { provider: aiMeta.provider, model: aiMeta.model, simulated: Boolean(aiMeta.simulated) },
    });
  }),
);

/** Active session with its message history. */
router.get(
  '/sessions/:sessionId',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const session = await db.collection('learning_sessions').findOne({ _id: toOid(req.params.sessionId) });
    if (!session) throw notFound('Session not found');
    if (String(session.userId) !== String(req.userId)) throw forbidden('This session belongs to another learner');
    const messages = await db.collection('chat_messages').find({ sessionId: session._id }).sort({ createdAt: 1 }).toArray();
    const concept = await db.collection('syllabus_units').findOne({ _id: session.conceptId });
    const unit = session.unitId ? await db.collection('syllabus_units').findOne({ _id: session.unitId }) : null;
    const classroom = await db.collection('classrooms').findOne({ _id: session.classroomId });
    res.json({
      session: {
        id: String(session._id),
        mode: session.mode,
        modeLabel: MODES[session.mode]?.label || session.mode,
        status: session.status,
        scaffoldingLevel: session.scaffoldingLevel,
        startedAt: session.startedAt,
        messageCount: session.messageCount,
        hintsUsed: session.hintsUsed,
      },
      context: {
        classroom: { id: String(classroom._id), name: classroom.name, subject: classroom.subject },
        unit: unit ? { id: String(unit._id), name: unit.name } : null,
        concept: concept ? { id: String(concept._id), name: concept.name, description: concept.description, objectives: concept.objectives || [], keywords: concept.keywords || [], subtopics: [] } : null,
      },
      messages: messages.map((m) => ({
        id: String(m._id),
        role: m.role,
        content: m.content,
        meta: m.meta,
        createdAt: m.createdAt,
      })),
    });
  }),
);

/** One tutoring turn: reply + evidence-based gap analysis + adaptive update. */
router.post(
  '/sessions/:sessionId/messages',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        content: z.string().trim().min(1).max(6000),
        signal: z
          .object({
            correct: z.boolean().optional(),
            wrongAnswer: z.boolean().optional(),
            hintUsed: z.boolean().optional(),
            independent: z.boolean().optional(),
            selfReportOnly: z.boolean().optional(),
            repeatedMistake: z.boolean().optional(),
          })
          .optional(),
      }),
      req.body,
    );
    const db = getDb();
    const session = await db.collection('learning_sessions').findOne({ _id: toOid(req.params.sessionId), userId: req.userId, status: 'active' });
    if (!session) throw notFound('Active session not found');
    const { classroom } = await requireClassroomMember(session.classroomId, req.userId);

    const concept = await db.collection('syllabus_units').findOne({ _id: session.conceptId });
    const unit = session.unitId ? await db.collection('syllabus_units').findOne({ _id: session.unitId }) : null;
    const subject = session.subjectId ? await db.collection('syllabus_units').findOne({ _id: session.subjectId }) : null;
    const subtopics = await db.collection('syllabus_units').find({ parentId: concept._id, type: 'subtopic' }).toArray();
    const profile = await getOrCreateProfile(req.userId, session.classroomId);
    const openGaps = await getOpenGaps(req.userId, session.classroomId, { conceptId: session.conceptId });
    const priorMessages = await db.collection('chat_messages').find({ sessionId: session._id }).sort({ createdAt: 1 }).toArray();
    const lastAssistant = [...priorMessages].reverse().find((m) => m.role === 'assistant');
    const wrongStreak = countWrongStreak(priorMessages);

    const now = new Date();
    const userMessage = {
      sessionId: session._id,
      userId: req.userId,
      classroomId: session.classroomId,
      conceptId: session.conceptId,
      role: 'user',
      content: data.content,
      meta: { signal: data.signal || {} },
      createdAt: now,
    };
    await db.collection('chat_messages').insertOne(userMessage);

    // ---- Moderation --------------------------------------------------------
    let flagged = false;
    let moderation = null;
    if (await isFeatureEnabled('content_moderation')) {
      const mod = await runJsonTask('moderation', {
        messages: prompts.moderation({ text: data.content }),
        meta: { task: 'moderation' },
        feature: 'content_moderation',
        userId: req.userId,
        classroomId: session.classroomId,
      });
      moderation = mod.data && typeof mod.data === 'object' ? mod.data : null;
      flagged = Boolean(moderation?.flagged);
      if (flagged) {
        const safetyReply = {
          sessionId: session._id,
          userId: req.userId,
          classroomId: session.classroomId,
          conceptId: session.conceptId,
          role: 'assistant',
          content: 'I can\'t help with that request. If something is worrying you, please speak to a trusted adult or your teacher. When you\'re ready, we can return to the concept.',
          meta: { kind: 'safety', moderation },
          createdAt: new Date(),
        };
        await db.collection('chat_messages').insertOne(safetyReply);
        return res.status(200).json({
          blocked: true,
          message: { id: String(safetyReply._id), role: 'assistant', content: safetyReply.content, meta: safetyReply.meta, createdAt: safetyReply.createdAt },
        });
      }
    }

    // ---- Retrieval ---------------------------------------------------------
    const retrieved = await retrieveContext({
      classroomId: session.classroomId,
      concept: { ...concept, id: concept._id },
      query: data.content,
    });
    const syllabusContext = buildSyllabusContext({
      concept: { ...concept, subtopics: subtopics.map((s) => s.name) },
      unit,
      subject,
      retrieved: retrieved.chunks,
    });

    // ---- Gap analysis on this evidence -------------------------------------
    const signal = {
      ...data.signal,
      repeatedMistake: data.signal?.repeatedMistake || (Boolean(data.signal?.wrongAnswer) && wrongStreak >= 1),
      hintUsed: data.signal?.hintUsed || (lastAssistant?.meta?.hints?.length ? Boolean(lastAssistant.meta.hintRequested) : false),
    };
    const gapResult = await analyseInteraction({
      userId: req.userId,
      classroomId: session.classroomId,
      concept: { id: concept._id, name: concept.name, unitId: session.unitId, subjectId: session.subjectId, description: concept.description },
      text: data.content,
      signal,
      context: {
        syllabusContext,
        retrieved: retrieved.chunks,
        profile,
        openGaps,
        mode: MODES[session.mode]?.label,
        adaptiveLevel: profile.knowledgeLevel,
      },
      evidenceRef: userMessage._id,
    });

    // ---- Adaptive teaching decision ---------------------------------------
    const scaffoldingLevel = decideScaffolding({ profile, signal, gapResult, wrongStreak });
    const adaptiveLevel = decideLevel({ profile, gapResult, signal });
    const shouldRecommendAssessment =
      gapResult.recommendAssessment ||
      (wrongStreak >= 2 && (await isFeatureEnabled('ai_assessments')));
    const isCorrection = Boolean(signal.wrongAnswer || signal.repeatedMistake);

    // ---- Tutoring call -----------------------------------------------------
    const { data: tutorData, meta: aiMeta } = await runJsonTask('tutoring', {
      messages: prompts.tutor({
        context: {
          concept: { ...concept, unitName: unit?.name, subjectName: subject?.name, subtopics: subtopics.map((s) => s.name) },
          syllabusContext,
          retrieved: retrieved.chunks,
          profile: { ...profile, conceptMastery: gapResult.masteryDelta },
          openGaps,
          history: priorMessages,
          mode: MODES[session.mode]?.label,
          scaffoldingLevel,
          adaptiveLevel,
        },
        studentMessage: data.content,
        isCorrection,
        nextPrompt: lastAssistant?.meta?.nextPrompt,
      }),
      meta: {
        task: 'tutor_reply',
        concept: { ...concept, unitName: unit?.name, subjectName: subject?.name },
        conceptId: concept._id,
        profile,
        openGaps,
        retrieved: retrieved.chunks,
        adaptiveLevel,
        scaffoldingLevel,
        isCorrection,
        recommendAssessment: shouldRecommendAssessment,
        recommendAssessmentReason: gapResult.recommendReason,
        nextPrompt: lastAssistant?.meta?.nextPrompt,
      },
      feature: 'tutoring',
      userId: req.userId,
      classroomId: session.classroomId,
    });

    const reply = typeof tutorData === 'string' ? tutorData : tutorData?.reply || 'Let me put that another way — which part feels unclear?';
    const assessmentRecommendation = tutorData?.assessmentRecommendation?.recommend
      ? tutorData.assessmentRecommendation
      : shouldRecommendAssessment
        ? { recommend: true, kind: 'topic_quiz', reason: gapResult.recommendReason || 'Repeated difficulty on this concept' }
        : { recommend: false };

    // ---- Visual explanation ------------------------------------------------
    // Prefer the model's own diagram (it knows what it just explained). If it
    // returned nothing usable, derive one from the syllabus so a lesson is
    // never left with prose only.
    let visuals = normaliseVisuals(tutorData?.visuals);
    let visualsSource = visuals.length ? 'model' : 'syllabus';
    if (!visuals.length) {
      visuals = buildFallbackVisuals({
        concept,
        subtopics,
        chunks: retrieved.chunks,
        mode: session.mode,
      });
      visualsSource = 'generated';
    }

    const assistantMessage = {
      sessionId: session._id,
      userId: req.userId,
      classroomId: session.classroomId,
      conceptId: session.conceptId,
      role: 'assistant',
      content: reply,
      meta: {
        kind: 'tutor',
        visuals,
        visualsSource,
        scaffoldingLevel,
        hints: tutorData?.hints || [],
        citations: tutorData?.citations || [],
        misconceptionObserved: tutorData?.misconceptionObserved || null,
        nextPrompt: tutorData?.nextPrompt || '',
        difficultyShift: tutorData?.difficultyShift,
        followUpQuestion: tutorData?.followUpQuestion,
        gapFindings: gapResult.findings,
        assessmentRecommendation,
        provider: aiMeta.provider,
        model: aiMeta.model,
        simulated: aiMeta.simulated,
        sources: retrieved.chunks.slice(0, 3).map((c) => c.documentName),
      },
      createdAt: new Date(),
    };
    await db.collection('chat_messages').insertOne(assistantMessage);

    // ---- Persist evidence: mastery + profile + activity -------------------
    let masteryDoc = null;
    if (signal.correct !== undefined || signal.wrongAnswer !== undefined) {
      masteryDoc = await applyMasteryEvidence({
        userId: req.userId,
        classroomId: session.classroomId,
        conceptId: session.conceptId,
        unitId: session.unitId,
        subjectId: session.subjectId,
        correct: Boolean(signal.correct),
        hinted: Boolean(signal.hintUsed),
        source: 'tutor',
      });
    }
    const hintsUsed = (session.hintsUsed || 0) + (signal.hintUsed ? 1 : 0);
    await db.collection('learning_sessions').updateOne(
      { _id: session._id },
      { $inc: { messageCount: 2, hintsUsed: signal.hintUsed ? 1 : 0 }, $set: { scaffoldingLevel } },
    );
    await db.collection('student_activities').insertOne({
      userId: req.userId,
      classroomId: session.classroomId,
      type: 'chat_message',
      title: `Tutoring on ${concept.name}`,
      meta: { sessionId: String(session._id), gapsDetected: gapResult.detected, scaffoldingLevel },
      conceptId: session.conceptId,
      minutes: 2,
      createdAt: new Date(),
    });
    const updatedProfile = await refreshProfileAggregates(req.userId, session.classroomId, {
      stats: {
        ...profile.stats,
        messages: (profile.stats.messages || 0) + 2,
        totalStudyMinutes: (profile.stats.totalStudyMinutes || 0) + 2,
        hintsUsedTotal: (profile.stats.hintsUsedTotal || 0) + (signal.hintUsed ? 1 : 0),
        lastStudyDay: new Date().toISOString().slice(0, 10),
      },
    });
    if (!(await isFeatureEnabled('adaptive_learning'))) {
      // adaptive learning disabled: keep profile but skip behaviour adaptation
    }

    res.json({
      message: {
        id: String(assistantMessage._id),
        role: 'assistant',
        content: reply,
        meta: assistantMessage.meta,
        createdAt: assistantMessage.createdAt,
      },
      intelligence: {
        gapsDetected: gapResult.findings,
        recommendAssessment: assessmentRecommendation.recommend ? assessmentRecommendation : null,
        scaffoldingLevel,
        adaptiveLevel,
        mastery: masteryDoc ? { score: masteryDoc.score, level: masteryDoc.level, trend: masteryDoc.trend } : null,
        independenceScore: updatedProfile.independence?.score,
        learningSpeed: updatedProfile.learningSpeed,
        hintsUsed,
      },
      retrieval: {
        strategy: retrieved.strategy,
        sources: retrieved.chunks.map((c) => ({ documentName: c.documentName, excerpt: String(c.text).slice(0, 160), score: Math.round((c.score || 0) * 100) })),
      },
      ai: { provider: aiMeta.provider, model: aiMeta.model, latencyMs: aiMeta.latencyMs, simulated: Boolean(aiMeta.simulated), fallback: Boolean(aiMeta.fallbackUsed) },
    });
  }),
);

/** Ends a session (records are retained). */
router.post(
  '/sessions/:sessionId/end',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const session = await db.collection('learning_sessions').findOne({ _id: toOid(req.params.sessionId), userId: req.userId });
    if (!session) throw notFound('Session not found');
    const durationMinutes = Math.max(1, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000));
    await db.collection('learning_sessions').updateOne(
      { _id: session._id },
      { $set: { status: 'ended', endedAt: new Date(), durationMinutes } },
    );
    const profile = await getOrCreateProfile(req.userId, session.classroomId);
    await refreshProfileAggregates(req.userId, session.classroomId, {
      stats: {
        ...profile.stats,
        totalStudyMinutes: (profile.stats.totalStudyMinutes || 0) + durationMinutes,
        streakDays: computeStreak(profile.stats),
        lastStudyDay: new Date().toISOString().slice(0, 10),
      },
    });
    res.json({ ok: true, durationMinutes });
  }),
);

/** "Continue learning" suggestions: gaps + last concept. */
router.get(
  '/classrooms/:classroomId/resume',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const lastSession = await db
      .collection('learning_sessions')
      .find({ userId: req.userId, classroomId: classroom._id })
      .sort({ startedAt: -1 })
      .limit(1)
      .toArray();
    const gaps = await getOpenGaps(req.userId, classroom._id, { limit: 5 });
    const conceptIds = [...new Set([...lastSession.map((s) => s.conceptId), ...gaps.map((g) => g.conceptId)].filter(Boolean))];
    const concepts = conceptIds.length ? await db.collection('syllabus_units').find({ _id: { $in: conceptIds } }).toArray() : [];
    const conceptById = Object.fromEntries(concepts.map((c) => [String(c._id), c]));
    const mastery = await db.collection('topic_mastery').find({ userId: req.userId, classroomId: classroom._id }).toArray();
    res.json({
      lastConcept: lastSession[0]?.conceptId ? {
        id: String(lastSession[0].conceptId),
        name: conceptById[String(lastSession[0].conceptId)]?.name || 'Unknown',
        lastActive: lastSession[0].startedAt,
      } : null,
      weakConcepts: gaps.slice(0, 5).map((g) => ({
        conceptId: String(g.conceptId),
        name: conceptById[String(g.conceptId)]?.name || 'Unknown',
        gap: g.description,
        category: g.category,
        severity: g.severity,
        occurrences: g.occurrences,
      })),
      lowestMastery: mastery
        .sort((a, b) => a.score - b.score)
        .slice(0, 5)
        .map((m) => ({
          conceptId: String(m.conceptId),
          name: conceptById[String(m.conceptId)]?.name || 'Unknown',
          score: m.score,
          level: m.level,
        })),
    });
  }),
);

function countWrongStreak(messages) {
  let streak = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (m.meta?.signal?.wrongAnswer) streak += 1;
    else break;
  }
  return streak;
}

function decideScaffolding({ profile, signal, gapResult, wrongStreak }) {
  const independence = profile.independence?.score ?? 0;
  // Fade support as soon as the learner demonstrates independence unaided.
  if (signal.wrongAnswer || signal.repeatedMistake) {
    // handled below — wrong signals never trigger fading
  } else if (signal.independent && signal.correct && !signal.hintUsed) {
    return 'independent';
  } else if (signal.correct && !signal.hintUsed && independence > 45) {
    return 'independent';
  }
  // Escalate support on repetition — this is the core adaptive-scaffolding rule.
  if (signal.repeatedMistake || wrongStreak >= 1 || gapResult.findings.some((f) => ['high', 'critical'].includes(f.severity))) {
    return 'guided';
  }
  return 'supported';
}

function decideLevel({ profile, gapResult, signal }) {
  const base = profile.knowledgeLevel || 'beginner';
  const order = ['beginner', 'developing', 'proficient', 'advanced'];
  let idx = order.indexOf(base);
  if (signal.independent && signal.correct) idx += 1;
  if (gapResult.findings.some((f) => f.severity === 'high' || f.severity === 'critical')) idx -= 1;
  return order[Math.max(0, Math.min(order.length - 1, idx))];
}

function computeStreak(stats) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (stats.lastStudyDay === today) return stats.streakDays || 1;
  if (stats.lastStudyDay === yesterday) return (stats.streakDays || 0) + 1;
  return 1;
}

router.use('/', privacyRouter);

export { MODES };
export default router;
