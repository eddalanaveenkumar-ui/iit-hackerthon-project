import { ObjectId } from 'mongodb';
import { getDb } from '../db/index.js';
import { runJsonTask, runEmbeddings } from '../modules/ai/orchestrator.js';
import { prompts } from '../modules/ai/prompts.js';
import { analyseInteraction } from '../modules/intelligence/gap-engine.js';
import { applyMasteryEvidence, refreshProfileAggregates, getOrCreateProfile } from '../modules/intelligence/profile.js';
import { hashedEmbedding } from '../modules/ai/providers/local.js';

/**
 * Simulates a realistic learning history through the SAME intelligence modules
 * the live app uses (gap analysis, mastery evidence, profile aggregation), so
 * seeded dashboards show genuine evidence-derived numbers rather than fixtures.
 */

async function conceptsOf(classroomId) {
  const db = getDb();
  const nodes = await db.collection('syllabus_units').find({ classroomId }).toArray();
  const concepts = nodes.filter((n) => n.type === 'concept');
  const byName = Object.fromEntries(concepts.map((c) => [c.name, c]));
  return { nodes, concepts, byName };
}

function daysAgo(n, hourOffset = 0) {
  return new Date(Date.now() - n * 86_400_000 + hourOffset * 3_600_000);
}

async function simulateTurn({
  userId,
  classroomId,
  concept,
  unitName,
  subjectName,
  studentText,
  signal,
  when,
  mode = 'learn',
}) {
  const db = getDb();
  const conceptPayload = {
    id: concept._id,
    name: concept.name,
    description: concept.description,
    unitId: concept.parentId,
    subjectId: concept.subjectId,
  };
  const profile = await getOrCreateProfile(userId, classroomId);
  const gapResult = await analyseInteraction({
    userId,
    classroomId,
    concept: conceptPayload,
    text: studentText,
    signal,
    context: {
      syllabusContext: `${unitName} → ${concept.name}: ${concept.description}`,
      profile,
      openGaps: [],
      adaptiveLevel: profile.knowledgeLevel,
      mode,
    },
  });
  const { data: tutor } = await runJsonTask('tutoring', {
    messages: prompts.tutor({
      context: {
        concept: { ...concept, unitName, subjectName },
        syllabusContext: concept.description,
        profile,
        openGaps: [],
        adaptiveLevel: profile.knowledgeLevel,
        scaffoldingLevel: 'supported',
        mode,
      },
      studentMessage: studentText,
      isCorrection: Boolean(signal.wrongAnswer),
    }),
    meta: {
      task: 'tutor_reply',
      concept: { ...concept, unitName, subjectName },
      conceptId: concept._id,
      profile,
      openGaps: [],
      adaptiveLevel: profile.knowledgeLevel,
      scaffoldingLevel: 'supported',
      isCorrection: Boolean(signal.wrongAnswer),
      recommendAssessment: gapResult.recommendAssessment,
    },
    feature: 'tutoring',
    userId,
    classroomId,
  });
  if (signal.correct !== undefined || signal.wrongAnswer !== undefined) {
    await applyMasteryEvidence({
      userId,
      classroomId,
      conceptId: concept._id,
      unitId: concept.parentId,
      subjectId: concept.subjectId,
      correct: Boolean(signal.correct),
      hinted: Boolean(signal.hintUsed),
      source: 'tutor',
    });
  }
  const sessionId = new ObjectId();
  await db.collection('learning_sessions').insertOne({
    _id: sessionId,
    classroomId,
    userId,
    subjectId: concept.subjectId || null,
    unitId: concept.parentId || null,
    conceptId: concept._id,
    mode,
    status: 'ended',
    startedAt: when,
    endedAt: new Date(when.getTime() + 22 * 60_000),
    durationMinutes: 22,
    messageCount: 2,
    hintsUsed: signal.hintUsed ? 1 : 0,
    scaffoldingLevel: signal.wrongAnswer ? 'guided' : 'supported',
    conceptsCovered: [concept._id],
    createdAt: when,
  });
  await db.collection('chat_messages').insertMany([
    {
      sessionId,
      userId,
      classroomId,
      conceptId: concept._id,
      role: 'user',
      content: studentText,
      meta: { signal },
      createdAt: when,
    },
    {
      sessionId,
      userId,
      classroomId,
      conceptId: concept._id,
      role: 'assistant',
      content: typeof tutor === 'string' ? tutor : tutor?.reply || 'Let us work through this together.',
      meta: {
        kind: 'tutor',
        hints: tutor?.hints || [],
        gapFindings: gapResult.findings,
        scaffoldingLevel: signal.wrongAnswer ? 'guided' : 'supported',
        provider: 'seed',
      },
      createdAt: new Date(when.getTime() + 30_000),
    },
  ]);
  await db.collection('student_activities').insertOne({
    userId,
    classroomId,
    type: 'chat_message',
    title: `Tutoring on ${concept.name}`,
    meta: { sessionId: String(sessionId) },
    conceptId: concept._id,
    minutes: 22,
    createdAt: when,
  });
  const prof = await getOrCreateProfile(userId, classroomId);
  await refreshProfileAggregates(userId, classroomId, {
    stats: {
      ...prof.stats,
      sessions: (prof.stats.sessions || 0) + 1,
      messages: (prof.stats.messages || 0) + 2,
      totalStudyMinutes: (prof.stats.totalStudyMinutes || 0) + 22,
      hintsUsedTotal: (prof.stats.hintsUsedTotal || 0) + (signal.hintUsed ? 1 : 0),
      lastStudyDay: when.toISOString().slice(0, 10),
    },
  });
  return gapResult;
}

async function seedAssessmentResult({ userId, classroomId, concept, questions, correctCount, when, origin = 'student', kind = 'topic_quiz' }) {
  const db = getDb();
  const assessmentId = new ObjectId();
  const sanitised = questions.map((q, i) => ({
    id: q.id || `q${i + 1}`,
    type: 'multiple_choice',
    prompt: q.prompt,
    options: q.options,
    correctIndex: q.correctIndex,
    conceptId: concept._id,
    difficulty: q.difficulty || 'medium',
    explanation: q.explanation || '',
  }));
  await db.collection('assessments').insertOne({
    _id: assessmentId,
    classroomId,
    conceptId: concept._id,
    unitId: concept.parentId || null,
    subjectId: concept.subjectId || null,
    userId,
    createdByUserId: userId,
    origin,
    kind,
    title: `Topic Quiz — ${concept.name}`,
    status: 'completed',
    recommendedReason: origin === 'ai' ? `Repeated difficulty detected on ${concept.name}` : '',
    questions: sanitised,
    maxScore: sanitised.length,
    durationMinutes: 12,
    createdAt: when,
    completedAt: when,
  });

  const answers = sanitised.map((q, i) => {
    const correct = i < correctCount;
    return {
      questionId: q.id,
      prompt: q.prompt,
      answer: correct ? q.options[q.correctIndex] : q.options[(q.correctIndex + 1) % q.options.length],
      correct,
      score: correct ? 1 : 0,
      analysis: correct ? '' : `Misapplied the rule. ${q.explanation}`,
      misconception: correct ? null : q.explanation,
      difficulty: q.difficulty,
    };
  });
  const score = answers.filter((a) => a.correct).length;
  const percentage = Math.round((score / sanitised.length) * 1000) / 10;
  const resultId = new ObjectId();
  await db.collection('assessment_results').insertOne({
    _id: resultId,
    assessmentId,
    userId,
    classroomId,
    conceptIds: [concept._id],
    answers,
    score,
    maxScore: sanitised.length,
    percentage,
    durationSeconds: 540,
    hintUsage: 1,
    aiFeedback: {
      strengths: correctCount >= 3 ? ['Handled the standard cases correctly.'] : ['Completed the assessment honestly.'],
      gaps: answers.filter((a) => !a.correct).slice(0, 2).map((a) => a.analysis),
      misconceptions: answers.filter((a) => !a.correct).slice(0, 2).map((a) => a.misconception),
      nextSteps: percentage >= 70 ? ['Move to the next concept.'] : ['Revisit the worked example and retake a short quiz.'],
    },
    submittedAt: when,
  });
  for (const a of answers) {
    await applyMasteryEvidence({
      userId,
      classroomId,
      conceptId: concept._id,
      unitId: concept.parentId,
      subjectId: concept.subjectId,
      correct: a.correct,
      hinted: true,
      source: 'assessment',
    });
  }
  const profile = await getOrCreateProfile(userId, classroomId);
  await refreshProfileAggregates(userId, classroomId, {
    stats: { ...profile.stats, assessmentsTaken: (profile.stats.assessmentsTaken || 0) + 1 },
  });
  await db.collection('student_activities').insertOne({
    userId,
    classroomId,
    type: 'assessment_completed',
    title: `Scored ${percentage}% on Topic Quiz — ${concept.name}`,
    meta: { assessmentId: String(assessmentId), percentage },
    conceptId: concept._id,
    minutes: 9,
    createdAt: when,
  });
  return { assessmentId, percentage };
}

function makeQuestions(concept) {
  const kw = concept.keywords?.[0] || 'the core rule';
  const kw2 = concept.keywords?.[1] || 'the definition';
  return [
    {
      prompt: `Which statement about ${concept.name} is correct?`,
      options: [
        `${kw} must be applied deliberately at the point of use`,
        `${kw} is optional when the input is small`,
        `${kw} only matters after the output is produced`,
        `${kw2} replaces ${kw} entirely`,
      ],
      correctIndex: 0,
      difficulty: 'easy',
      explanation: `${kw} is a deliberate part of the rule, not an optional step.`,
    },
    {
      prompt: `A student's code works for typical input but fails on an empty input while using ${concept.name}. What is the most likely cause?`,
      options: [
        `The ${kw} was assumed to always have data`,
        `The compiler optimised away the check`,
        `The output type changed`,
        `The loop ran twice`,
      ],
      correctIndex: 0,
      difficulty: 'medium',
      explanation: `Missing the empty case means the rule for ${kw} was only half-applied.`,
    },
    {
      prompt: `Which failure mode indicates a misconception rather than a typo in ${concept.name}?`,
      options: [
        'The same wrong result appears across different inputs',
        'A variable is misspelled once',
        'A semicolon is missing',
        'An import is unused',
      ],
      correctIndex: 0,
      difficulty: 'medium',
      explanation: 'Systematic wrongness across inputs signals a wrong mental model.',
    },
    {
      prompt: `When would you deliberately prefer a simpler approach over ${concept.name}?`,
      options: [
        `When ${kw2} is irrelevant to the problem being solved`,
        'Never — it is always optimal',
        'Only in production',
        'Only when tests are missing',
      ],
      correctIndex: 0,
      difficulty: 'hard',
      explanation: `Technique choice must follow the requirement, not habit.`,
    },
  ];
}

async function seedChatPrivacy(userId, classroomId, { shareWithTeachers, shareWithOwner }) {
  const db = getDb();
  const now = new Date();
  await db.collection('chat_privacy_permissions').insertOne({
    userId,
    classroomId,
    shareWithTeachers,
    shareWithOwner,
    updatedAt: now,
    createdAt: now,
  });
  await db.collection('chat_privacy_audit').insertOne({
    userId,
    classroomId,
    actorId: userId,
    action: shareWithTeachers || shareWithOwner ? 'grant' : 'revoke',
    scope: JSON.stringify({ shareWithTeachers, shareWithOwner }),
    ip: '127.0.0.1',
    at: now,
  });
}

async function seedSyllabusChunks(classroomId, nodes) {
  const db = getDb();
  const concepts = nodes.filter((n) => n.type === 'concept');
  const chunks = concepts.map((c) => ({
    classroomId,
    syllabusId: c.syllabusId,
    conceptId: c._id,
    documentName: 'Course-Handbook.pdf',
    page: null,
    chunkIndex: 0,
    text: `${c.name}. ${c.description} Key terms: ${(c.keywords || []).join(', ')}. Objectives: ${(c.objectives || []).join('; ')}`,
    tokens: Math.ceil(String(c.description).length / 4),
    createdAt: new Date(),
  }));
  const vectors = await runEmbeddings(chunks.map((c) => c.text), { classroomId });
  await db.collection('syllabus_chunks').insertMany(
    chunks.map((c, i) => ({ ...c, embedding: vectors[i] || hashedEmbedding(c.text), vectorDims: 256 })),
  );
  await db.collection('syllabuses').updateMany(
    { classroomId },
    { $set: { 'materialStats.documents': 1, 'materialStats.chunks': chunks.length, documents: [{ filename: 'Course-Handbook.pdf', words: 4200, pages: 18, error: null }] } },
  );
}

export async function triggerSeedWorkflows({ userIds, javaClass, mlClass, webClass }) {
  const db = getDb();
  const naveen = userIds['naveen@learnmate.ai'];
  const priya = userIds['priya@learnmate.ai'];
  const rohit = userIds['rohit@learnmate.ai'];
  const karthik = userIds['karthik@learnmate.ai'];

  const java = await conceptsOf(javaClass._id);
  const ml = await conceptsOf(mlClass._id);
  const web = await conceptsOf(webClass._id);
  await seedSyllabusChunks(javaClass._id, java.nodes);
  await seedSyllabusChunks(mlClass._id, ml.nodes);
  await seedSyllabusChunks(webClass._id, web.nodes);

  // ===== Naveen — Java classroom: struggling with constructors & hashCode =====
  const nvConstructors = java.byName['Classes and Constructors'];
  const nvHash = java.byName['HashMaps and Equals/HashCode'];
  const nvVars = java.byName['Variables and Primitive Types'];
  const nvControl = java.byName['Control Flow'];

  await simulateTurn({
    userId: naveen,
    classroomId: javaClass._id,
    concept: nvVars,
    unitName: 'Unit 1 – Introduction to Java',
    subjectName: 'Java Programming',
    studentText: 'I think int and double are basically the same, you can just assign either one right?',
    signal: { wrongAnswer: true },
    when: daysAgo(9, 2),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: javaClass._id,
    concept: nvVars,
    unitName: 'Unit 1 – Introduction to Java',
    subjectName: 'Java Programming',
    studentText: 'Casting a double to int truncates, so 3.9 becomes 3. I understand it now.',
    signal: { correct: true, independent: true },
    when: daysAgo(7, 3),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: javaClass._id,
    concept: nvControl,
    unitName: 'Unit 1 – Introduction to Java',
    subjectName: 'Java Programming',
    studentText: 'In a switch statement, if I forget break the next case also runs. This is the fall-through behaviour.',
    signal: { correct: true },
    when: daysAgo(6, 1),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: javaClass._id,
    concept: nvConstructors,
    unitName: 'Unit 2 – Objects and Classes',
    subjectName: 'Java Programming',
    studentText: 'I understand constructors fully. They are just methods that create objects.',
    signal: { selfReportOnly: true },
    when: daysAgo(5, 2),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: javaClass._id,
    concept: nvConstructors,
    unitName: 'Unit 2 – Objects and Classes',
    subjectName: 'Java Programming',
    studentText: 'I added a constructor with parameters, so I can still call new Student() with no arguments right?',
    signal: { wrongAnswer: true },
    when: daysAgo(4, 1),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: javaClass._id,
    concept: nvConstructors,
    unitName: 'Unit 2 – Objects and Classes',
    subjectName: 'Java Programming',
    studentText: 'Again I tried new Student() and it failed to compile. I thought the default constructor always exists.',
    signal: { wrongAnswer: true, repeatedMistake: true },
    when: daysAgo(2, 2),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: javaClass._id,
    concept: nvHash,
    unitName: 'Unit 3 – Collections and Error Handling',
    subjectName: 'Java Programming',
    studentText: 'I overrode equals but not hashCode, and map.get() keeps returning null. Not sure why.',
    signal: { wrongAnswer: true, hintUsed: true },
    when: daysAgo(2, 4),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: javaClass._id,
    concept: nvHash,
    unitName: 'Unit 3 – Collections and Error Handling',
    subjectName: 'Java Programming',
    studentText: 'So if equals is true but hashCode differs, they land in different buckets, so lookups miss. Same problem as before.',
    signal: { wrongAnswer: true, repeatedMistake: true, hintUsed: true },
    when: daysAgo(1, 2),
  });

  await seedAssessmentResult({
    userId: naveen,
    classroomId: javaClass._id,
    concept: nvVars,
    questions: makeQuestions(nvVars),
    correctCount: 4,
    when: daysAgo(6, 5),
  });
  await seedAssessmentResult({
    userId: naveen,
    classroomId: javaClass._id,
    concept: nvConstructors,
    questions: makeQuestions(nvConstructors),
    correctCount: 1,
    when: daysAgo(3, 4),
    origin: 'ai',
  });

  // ===== Naveen — Machine Learning classroom: a genuinely different profile =====
  const mlLinear = ml.byName['Linear Regression'];
  const mlBias = ml.byName['Bias–Variance Trade-off'];
  const mlPrec = ml.byName['Precision, Recall and F1'];

  await simulateTurn({
    userId: naveen,
    classroomId: mlClass._id,
    concept: mlLinear,
    unitName: 'Unit 1 – Foundations',
    subjectName: 'Machine Learning',
    studentText: 'The gradient of MSE with respect to w is (2/n) Xᵀ(Xw − y). Feature scaling only changes convergence speed, not the optimum.',
    signal: { correct: true, independent: true },
    when: daysAgo(8, 1),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: mlClass._id,
    concept: mlBias,
    unitName: 'Unit 1 – Foundations',
    subjectName: 'Machine Learning',
    studentText: 'High variance means the model fits the training noise, so more data should help. High bias needs a richer model instead.',
    signal: { correct: true },
    when: daysAgo(5, 3),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: mlClass._id,
    concept: mlBias,
    unitName: 'Unit 1 – Foundations',
    subjectName: 'Machine Learning',
    studentText: 'Both train and validation error are high and close together, which I believe is high variance.',
    signal: { wrongAnswer: true },
    when: daysAgo(3, 1),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: mlClass._id,
    concept: mlPrec,
    unitName: 'Unit 2 – Classification',
    subjectName: 'Machine Learning',
    studentText: 'Precision is the same as recall when the classes are balanced, so I can use accuracy in every case.',
    signal: { wrongAnswer: true, repeatedMistake: true },
    when: daysAgo(1, 3),
  });
  await seedAssessmentResult({
    userId: naveen,
    classroomId: mlClass._id,
    concept: mlLinear,
    questions: makeQuestions(mlLinear),
    correctCount: 4,
    when: daysAgo(4, 2),
  });
  await seedAssessmentResult({
    userId: naveen,
    classroomId: mlClass._id,
    concept: mlBias,
    questions: makeQuestions(mlBias),
    correctCount: 3,
    when: daysAgo(2, 3),
  });

  // ===== Naveen — Web classroom (he owns it, and learns in it) ================
  const webScope = web.byName['Scope and Closures'];
  const webPromise = web.byName['Promises and async/await'];
  await simulateTurn({
    userId: naveen,
    classroomId: webClass._id,
    concept: webScope,
    unitName: 'Unit 1 – JavaScript Fundamentals',
    subjectName: 'Web Development',
    studentText: 'With var in the loop, all callbacks log the final value because they share one binding. let creates a new binding per iteration.',
    signal: { correct: true, independent: true },
    when: daysAgo(3, 5),
  });
  await simulateTurn({
    userId: naveen,
    classroomId: webClass._id,
    concept: webPromise,
    unitName: 'Unit 2 – Asynchronous JavaScript',
    subjectName: 'Web Development',
    studentText: 'fetch resolves even on 404, so I have to check response.ok before parsing JSON.',
    signal: { correct: true },
    when: daysAgo(1, 1),
  });

  // ===== Other learners (so teacher analytics has depth) =====================
  const priyaCtor = java.byName['Encapsulation and Access Modifiers'];
  await simulateTurn({
    userId: priya,
    classroomId: javaClass._id,
    concept: priyaCtor,
    unitName: 'Unit 2 – Objects and Classes',
    subjectName: 'Java Programming',
    studentText: 'private fields with public getters keep the invariant safe; protected is also visible to subclasses.',
    signal: { correct: true, independent: true },
    when: daysAgo(4, 2),
  });
  await seedAssessmentResult({
    userId: priya,
    classroomId: javaClass._id,
    concept: priyaCtor,
    questions: makeQuestions(priyaCtor),
    correctCount: 3,
    when: daysAgo(3, 2),
  });

  const karthikArrays = java.byName['Arrays and ArrayLists'];
  await simulateTurn({
    userId: karthik,
    classroomId: javaClass._id,
    concept: karthikArrays,
    unitName: 'Unit 3 – Collections and Error Handling',
    subjectName: 'Java Programming',
    studentText: 'An ArrayList can grow, an array cannot. But can an ArrayList hold int directly?',
    signal: { wrongAnswer: true, hintUsed: true },
    when: daysAgo(2, 5),
  });
  const karthikWeb = web.byName['Array Methods (map/filter/reduce)'];
  await simulateTurn({
    userId: karthik,
    classroomId: webClass._id,
    concept: karthikWeb,
    unitName: 'Unit 1 – JavaScript Fundamentals',
    subjectName: 'Web Development',
    studentText: 'reduce takes an accumulator and the current value; map and filter return new arrays.',
    signal: { correct: true },
    when: daysAgo(2, 1),
  });

  const rohitWeb = web.byName['useEffect and Dependencies'];
  await simulateTurn({
    userId: rohit,
    classroomId: webClass._id,
    concept: rohitWeb,
    unitName: 'Unit 3 – React Essentials',
    subjectName: 'Web Development',
    studentText: 'If I leave the dependency array out my effect runs on every render and I get an infinite loop.',
    signal: { correct: true },
    when: daysAgo(1, 5),
  });

  // ===== Chat privacy: different choices per classroom =======================
  await seedChatPrivacy(naveen, javaClass._id, { shareWithTeachers: true, shareWithOwner: true });
  await seedChatPrivacy(naveen, mlClass._id, { shareWithTeachers: false, shareWithOwner: false });
  await seedChatPrivacy(naveen, webClass._id, { shareWithTeachers: true, shareWithOwner: true });
  await seedChatPrivacy(karthik, javaClass._id, { shareWithTeachers: false, shareWithOwner: false });
  await seedChatPrivacy(priya, javaClass._id, { shareWithTeachers: true, shareWithOwner: true });

  // Ensure aggregate profiles are current
  for (const [uid, cid] of [
    [naveen, javaClass._id],
    [naveen, mlClass._id],
    [naveen, webClass._id],
    [priya, javaClass._id],
    [karthik, javaClass._id],
    [karthik, webClass._id],
    [rohit, webClass._id],
  ]) {
    await refreshProfileAggregates(uid, cid);
  }

  const gapCount = await db.collection('knowledge_gaps').countDocuments();
  return { knowledgeGaps: gapCount };
}

export default triggerSeedWorkflows;
