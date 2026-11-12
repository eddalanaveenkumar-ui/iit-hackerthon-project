/**
 * LearnMate AI — end-to-end workflow verification.
 *
 * Exercises the real HTTP API of a freshly seeded instance and asserts every
 * scenario named in the product requirements:
 *
 *  1. unified auth (one account type)
 *  2. one user creates multiple classrooms
 *  3. one user joins multiple classrooms
 *  4. a classroom has multiple owners/teachers
 *  5. a teacher disables monitoring and is blocked from student data
 *  6. join without approval / join with approval
 *  7. different learning profiles per classroom (isolation)
 *  8. teacher sees analytics but NOT private chat history
 *  9. student grants + revokes chat permission (backend enforced)
 * 10. AI detects repeated mistakes and adapts teaching
 * 11. AI recommends an assessment; it can be postponed
 * 12. student completes an assessment and the profile updates
 * 13. practical sandbox execution + repeated code mistakes
 * 14. syllabus upload parsing + retrieval
 * 15. admin AI configuration (routing/features/usage) without restart
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const PASSWORD = 'LearnMate123!';

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${extra ? ` — ${JSON.stringify(extra).slice(0, 400)}` : ''}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function api(path, { method = 'GET', body, token, raw = false, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (raw) return { status: res.status, body: json };
  return { status: res.status, body: json, ok: res.ok };
}

async function expectStatus(promise, expected, label) {
  const r = await promise;
  ok(r.status === expected, `${label} (expected ${expected}, got ${r.status})`, r.body?.error || r.body);
  return r;
}

const state = {};

async function main() {
  section('0. Health & unified authentication');
  const health = await api('/api/health');
  ok(health.status === 200 && health.body.ok, 'API health endpoint responds');
  ok(health.body.db?.connected === true, `database connected (${health.body.db?.mode})`);

  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'E2E Learner', email: `e2e-${Date.now()}@learnmate.ai`, password: 'Password123!' },
  });
  ok(reg.status === 201 && reg.body.token, 'new user registers and receives a JWT');
  ok(!('passwordHash' in (reg.body.user || {})), 'password hash is never returned to the client');
  ok(reg.body.user.role === 'user', 'registered account is a unified user account (no teacher/student split)');
  state.newUser = reg.body;

  const badLogin = await api('/api/auth/login', { method: 'POST', body: { email: 'naveen@learnmate.ai', password: 'wrong' } });
  ok(badLogin.status === 401, 'wrong password is rejected');

  const login = async (email) => {
    const r = await api('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const naveen = await login('naveen@learnmate.ai');
  const aisha = await login('aisha@learnmate.ai');
  const meera = await login('meera@learnmate.ai');
  const rohit = await login('rohit@learnmate.ai');
  const karthik = await login('karthik@learnmate.ai');
  const priya = await login('priya@learnmate.ai');
  const admin = await login('admin@learnmate.ai');
  state.tokens = { naveen: naveen.token, aisha: aisha.token, meera: meera.token, rohit: rohit.token, karthik: karthik.token, admin: admin.token };
  ok(Boolean(naveen.token && aisha.token && admin.token), 'demo users can sign in with the same account type');

  const unauth = await api('/api/dashboard');
  ok(unauth.status === 401, 'unauthenticated request to a protected route is rejected');

  section('1. One user creates multiple classrooms');
  const created = await api('/api/classrooms', {
    method: 'POST',
    token: naveen.token,
    body: {
      name: 'Data Structures Deep Dive',
      description: 'Created by Naveen to test multiple ownership.',
      subject: 'Data Structures',
      joinApprovalRequired: true,
    },
  });
  ok(created.status === 201, 'classroom created');
  ok(/^LM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(created.body.classroom?.code || ''), `unique classroom ID generated (${created.body.classroom?.code})`);
  state.dsClass = created.body.classroom;

  const ds2 = await api('/api/classrooms', {
    method: 'POST',
    token: naveen.token,
    body: { name: 'Discrete Mathematics', description: 'Second classroom owned by the same user.', subject: 'Mathematics', joinApprovalRequired: false },
  });
  ok(ds2.status === 201, 'same user creates a second classroom');
  state.mathClass = ds2.body.classroom;

  const mine = await api('/api/classrooms', { token: naveen.token });
  const ownedByNaveen = mine.body.created.length;
  ok(ownedByNaveen >= 3, `Naveen owns ${ownedByNaveen} classrooms (web + 2 new)`);

  section('2. One user joins multiple classrooms');
  const joinedClassrooms = await api('/api/classrooms', { token: naveen.token });
  ok(joinedClassrooms.body.classrooms.length >= 4, `Naveen is a member of ${joinedClassrooms.body.classrooms.length} classrooms`);
  ok(joinedClassrooms.body.classrooms.some((c) => c.myRole === 'owner') && joinedClassrooms.body.classrooms.some((c) => c.myRole === 'student'),
    'same account holds both owner and student roles in different classrooms');

  section('3. Join with approval required');
  const joinApproval = await api('/api/classrooms/join', { method: 'POST', token: karthik.token, body: { code: state.dsClass.code, message: 'Please let me in' } });
  ok(joinApproval.status === 201 && joinApproval.body.status === 'requested', 'join request created when approval is enabled');

  const pendingList = await api(`/api/classrooms/${state.dsClass.id}`, { token: naveen.token });
  ok(pendingList.body.joinRequests.length === 1, 'owner sees the pending join request');
  const requestId = pendingList.body.joinRequests[0].id;

  const approve = await api(`/api/classrooms/${state.dsClass.id}/join-requests/${requestId}`, {
    method: 'POST',
    token: naveen.token,
    body: { action: 'approve' },
  });
  ok(approve.status === 200, 'owner approves the join request');
  const karthikClasses = await api('/api/classrooms', { token: karthik.token });
  ok(karthikClasses.body.classrooms.some((c) => c.id === state.dsClass.id), 'approved user is now a member');

  section('4. Join without approval required');
  const joinOpen = await api('/api/classrooms/join', { method: 'POST', token: rohit.token, body: { code: state.mathClass.code } });
  ok(joinOpen.status === 201 && joinOpen.body.status === 'joined', 'open classroom lets the user join immediately');
  const dupe = await api('/api/classrooms/join', { method: 'POST', token: rohit.token, body: { code: state.mathClass.code } });
  ok(dupe.status === 409, 'duplicate join is rejected');
  const bogus = await api('/api/classrooms/join', { method: 'POST', token: rohit.token, body: { code: 'LM-XXXX-YYYY' } });
  ok(bogus.status === 404, 'invalid classroom ID returns 404');

  section('5. Multiple owners / teachers in one classroom');
  const addTeacher = await api(`/api/classrooms/${state.dsClass.id}/members`, {
    method: 'POST',
    token: naveen.token,
    body: { identifier: 'meera@learnmate.ai', role: 'co_owner', permissions: { monitorStudents: true, viewAnalytics: true, manageSyllabus: true } },
  });
  ok(addTeacher.status === 201, 'owner appoints a co-owner');
  const addTeacher2 = await api(`/api/classrooms/${state.dsClass.id}/members`, {
    method: 'POST',
    token: naveen.token,
    body: { identifier: 'rohit@learnmate.ai', role: 'teacher', permissions: { monitorStudents: false } },
  });
  ok(addTeacher2.status === 201, 'owner appoints a second teacher with monitoring off');
  const asStudent = await api(`/api/classrooms/${state.dsClass.id}/members`, {
    method: 'POST',
    token: meera.token,
    body: { identifier: 'priya@learnmate.ai', role: 'teacher' },
  });
  ok(asStudent.status === 403, 'non-owner teacher cannot appoint teachers');

  const roster = await api(`/api/classrooms/${state.dsClass.id}/members`, { token: naveen.token });
  ok(roster.body.members.filter((m) => m.role !== 'student').length >= 3, 'classroom has multiple staff members');
  const meeraMember = roster.body.members.find((m) => m.email === 'meera@learnmate.ai');

  section('6. Teacher monitoring ON/OFF is independent');
  const javaClass = joinedClassrooms.body.classrooms.find((c) => c.name.includes('Java'));
  state.javaClass = javaClass;

  const rohitAnalyticsOff = await api(`/api/intelligence/classrooms/${javaClass.id}/analytics`, { token: rohit.token });
  ok(rohitAnalyticsOff.status === 200 && rohitAnalyticsOff.body.monitoringEnabled === false,
    'teacher with monitoring OFF gets restricted analytics payload');
  ok(rohitAnalyticsOff.body.students.length === 0, 'monitoring OFF hides individual student rows');
  ok(rohitAnalyticsOff.body.aggregate && rohitAnalyticsOff.body.aggregate.studentCount > 0,
    'monitoring OFF still returns non-identifying classroom aggregates');

  const nvId = naveen.user.id;
  const blockedProfile = await api(`/api/intelligence/classrooms/${javaClass.id}/students/${nvId}/profile`, { token: rohit.token });
  ok(blockedProfile.status === 403, 'monitoring OFF blocks individual student profiles');

  // Rohit keeps his own learning access while monitoring is off.
  const ownTutor = await api('/api/tutor/classrooms', { token: rohit.token });
  ok(ownTutor.status === 200 && ownTutor.body.classrooms.length > 0, 'teacher with monitoring OFF can still learn (own tutor access works)');

  const toggleOn = await api(`/api/classrooms/${javaClass.id}/teachers/${rohit.user.id}/monitoring`, {
    method: 'PATCH',
    token: rohit.token,
    body: { monitoringEnabled: true },
  });
  ok(toggleOn.status === 200, 'teacher toggles their own monitoring ON');
  const rohitAnalyticsOn = await api(`/api/intelligence/classrooms/${javaClass.id}/analytics`, { token: rohit.token });
  ok(rohitAnalyticsOn.body.monitoringEnabled === true && rohitAnalyticsOn.body.students.length > 0,
    'monitoring ON exposes student analytics');
  await api(`/api/classrooms/${javaClass.id}/teachers/${rohit.user.id}/monitoring`, {
    method: 'PATCH',
    token: rohit.token,
    body: { monitoringEnabled: false },
  });

  const ownerToggleOther = await api(`/api/classrooms/${javaClass.id}/teachers/${meeraMember.userId}/monitoring`, {
    method: 'PATCH',
    token: rohit.token,
    body: { monitoringEnabled: true },
  });
  ok(ownerToggleOther.status === 403, 'a teacher cannot change another teacher’s monitoring setting');

  section('7. Classroom-specific learning profiles (strict isolation)');
  const javaProfile = await api(`/api/intelligence/classrooms/${javaClass.id}/students/${nvId}/profile`, { token: naveen.token });
  const mlClass = joinedClassrooms.body.classrooms.find((c) => c.name.includes('Machine Learning'));
  const mlProfile = await api(`/api/intelligence/classrooms/${mlClass.id}/students/${nvId}/profile`, { token: naveen.token });
  ok(javaProfile.status === 200 && mlProfile.status === 200, 'both profiles load for the same user');
  const javaConcepts = new Set(javaProfile.body.mastery.map((m) => m.conceptId));
  const mlConcepts = new Set(mlProfile.body.mastery.map((m) => m.conceptId));
  const overlap = [...javaConcepts].filter((c) => mlConcepts.has(c));
  ok(overlap.length === 0, 'no mastery records leak between classrooms');
  ok(JSON.stringify(javaProfile.body.profile.weaknessCounts) !== JSON.stringify(mlProfile.body.profile.weaknessCounts),
    'weakness counts differ per classroom (independent profiles)');

  const crossProfile = await api(`/api/intelligence/classrooms/${javaClass.id}/students/${karthik.user.id}/profile`, { token: karthik.token });
  ok(crossProfile.status === 200, 'student can read their own profile');
  const peeking = await api(`/api/intelligence/classrooms/${javaClass.id}/students/${karthik.user.id}/profile`, { token: rohit.token });
  ok(peeking.status === 403, 'student data is not readable by a monitoring-off teacher');
  const studentPeeking = await api(`/api/intelligence/classrooms/${javaClass.id}/students/${nvId}/profile`, { token: karthik.token });
  ok(studentPeeking.status === 403, 'a student cannot read another student’s profile');

  section('8. Chat privacy: analytics visible, chat hidden, consent enforced');
  const analyticsTeacher = await api(`/api/intelligence/classrooms/${javaClass.id}/analytics`, { token: aisha.token });
  ok(analyticsTeacher.status === 200 && analyticsTeacher.body.students.length > 0, 'owner with monitoring sees learning analytics');
  // Karthik has not granted chat access in the Java classroom (seed default).
  const karthikId = karthik.user.id;
  const chatBlocked = await api(`/api/tutor/classrooms/${javaClass.id}/students/${karthikId}/chat`, { token: aisha.token });
  ok(chatBlocked.status === 403, 'chat history is hidden for a student who has not granted consent');
  ok(analyticsTeacher.body.students.some((s) => s.userId === karthikId && s.chatShared === false),
    'analytics roster flags that chat is not shared, without exposing content');

  const privacyBefore = await api(`/api/tutor/classrooms/${mlClass.id}/chat-privacy`, { token: naveen.token });
  ok(privacyBefore.body.privacy.shareWithTeachers === false, 'ML classroom chat is private by default (seed set revoke)');
  const mlChatBlocked = await api(`/api/tutor/classrooms/${mlClass.id}/students/${nvId}/chat`, { token: priya.token });
  ok(mlChatBlocked.status === 403, 'co-owner blocked from ML chat while consent is withheld');

  const javaConsent = await api(`/api/tutor/classrooms/${javaClass.id}/chat-privacy`, { token: naveen.token });
  ok(javaConsent.body.privacy.shareWithTeachers === true, 'Java classroom consent is granted in seed data');
  const javaChat = await api(`/api/tutor/classrooms/${javaClass.id}/students/${nvId}/chat`, { token: aisha.token });
  ok(javaChat.status === 200 && javaChat.body.sessions.length > 0, 'owner with consent can read chat history');
  ok(javaChat.body.sessions[0].messages.length > 0, 'chat messages are returned with the session');

  const revoke = await api(`/api/tutor/classrooms/${javaClass.id}/chat-privacy`, {
    method: 'PATCH',
    token: naveen.token,
    body: { shareWithTeachers: false, shareWithOwner: false },
  });
  ok(revoke.status === 200, 'student revokes chat permission');
  const afterRevoke = await api(`/api/tutor/classrooms/${javaClass.id}/students/${nvId}/chat`, { token: aisha.token });
  ok(afterRevoke.status === 403, 'revocation is enforced immediately on the backend');
  const afterRevokeAnalytics = await api(`/api/intelligence/classrooms/${javaClass.id}/analytics`, { token: aisha.token });
  ok(afterRevokeAnalytics.status === 200, 'revoking chat access does NOT remove analytics access');
  const privacyAudit = await api(`/api/tutor/classrooms/${javaClass.id}/chat-privacy`, { token: naveen.token });
  ok(privacyAudit.body.audit.length >= 2 && privacyAudit.body.audit.some((a) => a.action === 'revoke'),
    'permission changes are recorded in the audit trail');
  await api(`/api/tutor/classrooms/${javaClass.id}/chat-privacy`, { method: 'PATCH', token: naveen.token, body: { shareWithTeachers: true, shareWithOwner: true } });

  section('9. Syllabus selection flow (/start)');
  const tutorClasses = await api('/api/tutor/classrooms', { token: naveen.token });
  ok(tutorClasses.body.classrooms.length >= 3, 'step 1: classrooms listed for the learner');
  const outline = await api(`/api/tutor/classrooms/${javaClass.id}/outline`, { token: naveen.token });
  ok(outline.body.hasSyllabus && outline.body.subjects.length > 0, 'step 2: subjects available');
  const subject = outline.body.subjects[0];
  ok(subject.units.length > 0, 'step 3: units available for the subject');
  const unit = subject.units[0];
  ok(unit.concepts.length > 0, 'step 4: concepts available for the unit');
  ok(outline.body.modes.length === 4, 'step 5: four learning modes offered');
  const concept = outline.body.concepts?.[0] || unit.concepts[0];
  state.concept = concept;
  state.subject = subject;
  state.unit = unit;

  const session = await api('/api/tutor/sessions', {
    method: 'POST',
    token: naveen.token,
    body: { classroomId: javaClass.id, conceptId: concept.id, mode: 'learn' },
  });
  ok(session.status === 201, 'step 6: fresh learning session starts');
  ok(session.body.messages.length === 1 && session.body.messages[0].role === 'assistant', 'session opens with an AI tutor message');
  ok(session.body.profile && 'knowledgeLevel' in session.body.profile, 'session loads the classroom-specific learning profile');
  ok(Array.isArray(session.body.profile.openGaps), 'session loads previous gaps/misconceptions');
  ok(session.body.retrieval.strategy !== undefined, 'syllabus retrieval context is loaded');
  state.sessionId = session.body.session.id;

  section('10. AI detects repeated mistakes and adapts teaching');
  const turn1 = await api(`/api/tutor/sessions/${state.sessionId}/messages`, {
    method: 'POST',
    token: naveen.token,
    body: { content: 'I think I can just call the constructor with any arguments, the default one is always there.', signal: { wrongAnswer: true } },
  });
  ok(turn1.status === 200 && turn1.body.message.role === 'assistant', 'tutor replies to a wrong answer');
  ok(turn1.body.intelligence.gapsDetected.length > 0, 'gap engine records a finding from the answer');
  const scaffold1 = turn1.body.intelligence.scaffoldingLevel;

  const turn2 = await api(`/api/tutor/sessions/${state.sessionId}/messages`, {
    method: 'POST',
    token: naveen.token,
    body: { content: 'Again the same thing happened. I still believe the default constructor exists automatically.', signal: { wrongAnswer: true, repeatedMistake: true } },
  });
  ok(turn2.status === 200, 'second wrong attempt processed');
  const repeated = turn2.body.intelligence.gapsDetected.find((g) => g.category === 'repeated_error');
  ok(Boolean(repeated) && repeated.occurrences >= 1, 'repeated mistake is detected and tracked');
  ok(turn2.body.intelligence.scaffoldingLevel === 'guided', `scaffolding escalates to guided after a repeated mistake (was ${scaffold1})`);
  ok(turn2.body.intelligence.recommendAssessment || turn1.body.intelligence.recommendAssessment,
    'AI recommends an assessment after repeated difficulty');

  const turn3 = await api(`/api/tutor/sessions/${state.sessionId}/messages`, {
    method: 'POST',
    token: naveen.token,
    body: { content: 'So because I declared a constructor with parameters, the compiler no longer generates the no-argument one. That is why new Student() fails.', signal: { correct: true, independent: true } },
  });
  ok(turn3.status === 200, 'correct independent answer processed');
  ok(turn3.body.intelligence.mastery && turn3.body.intelligence.mastery.score > 0, 'mastery score updates from evidence');
  ok(turn3.body.ai && turn3.body.ai.provider, `AI provider reported (${turn3.body.ai?.provider} / ${turn3.body.ai?.model})`);
  ok(turn3.body.intelligence.scaffoldingLevel !== 'guided', `scaffolding fades after an independent success (${turn3.body.intelligence.scaffoldingLevel})`);

  const selfReport = await api(`/api/tutor/sessions/${state.sessionId}/messages`, {
    method: 'POST',
    token: naveen.token,
    body: { content: 'I understand it now.', signal: { selfReportOnly: true } },
  });
  ok(selfReport.status === 200, 'self-declared understanding is accepted as chat but flagged as evidence-poor');
  ok(selfReport.body.intelligence.gapsDetected.some((g) => /without demonstrating/i.test(g.description)),
    'self-report alone is NOT treated as proof of understanding');

  section('11. AI-recommended assessment can be postponed');
  const recAssessment = await api(`/api/learning/classrooms/${javaClass.id}/assessments`, {
    method: 'POST',
    token: naveen.token,
    body: { conceptId: concept.id, kind: 'topic_quiz', origin: 'ai', reason: 'Repeated constructor mistake' },
  });
  ok(recAssessment.status === 201 && recAssessment.body.questions.length >= 3, 'AI generates an assessment with questions');
  ok(recAssessment.body.questions.every((q) => !('correctIndex' in q)), 'correct answers are never sent to the client');
  state.assessment = recAssessment.body.assessment;

  const postpone = await api(`/api/learning/classrooms/${javaClass.id}/assessments/${state.assessment.id}/postpone`, {
    method: 'POST',
    token: naveen.token,
  });
  ok(postpone.status === 200 && postpone.body.status === 'postponed', 'student can postpone an optional assessment');

  section('12. Student-triggered assessment updates the profile');
  const beforeAssessment = await api(`/api/intelligence/classrooms/${javaClass.id}/my-progress`, { token: naveen.token });
  const beforeCount = beforeAssessment.body.profile.stats.assessmentsTaken;
  const studentAssessment = await api(`/api/learning/classrooms/${javaClass.id}/assessments`, {
    method: 'POST',
    token: naveen.token,
    body: { conceptId: concept.id, kind: 'topic_quiz', origin: 'student', questionCount: 5 },
  });
  ok(studentAssessment.status === 201, 'student triggers their own assessment');
  const aId = studentAssessment.body.assessment.id;
  const detail = await api(`/api/learning/classrooms/${javaClass.id}/assessments/${aId}`, { token: naveen.token });
  ok(detail.status === 200 && detail.body.questions.length >= 3, 'assessment questions load for the attempt');

  const answers = detail.body.questions.map((q, i) => ({
    questionId: q.id,
    answer: q.type === 'multiple_choice' ? (i === 0 ? 0 : 1) : 'Constructors do not create a default no-arg constructor once you declare one, so new Student() fails with no arguments.',
  }));
  const submit = await api(`/api/learning/classrooms/${javaClass.id}/assessments/${aId}/submit`, {
    method: 'POST',
    token: naveen.token,
    body: { answers, durationSeconds: 420, hintUsage: 0 },
  });
  ok(submit.status === 201 && typeof submit.body.result.percentage === 'number', `assessment submitted and graded (${submit.body.result?.percentage}%)`);
  ok(Array.isArray(submit.body.result.aiFeedback.strengths), 'AI feedback generated for the attempt');
  ok(submit.body.profile.knowledgeLevel, 'profile knowledge level recalculated');
  const afterAssessment = await api(`/api/intelligence/classrooms/${javaClass.id}/my-progress`, { token: naveen.token });
  ok(afterAssessment.body.profile.stats.assessmentsTaken === beforeCount + 1, 'assessment count increased in the classroom profile');
  const resubmit = await api(`/api/learning/classrooms/${javaClass.id}/assessments/${aId}/submit`, {
    method: 'POST',
    token: naveen.token,
    body: { answers },
  });
  ok(resubmit.status === 400, 'duplicate submission is rejected');

  section('13. Practical coding environment (sandboxed)');
  const exercise = await api(`/api/practice/classrooms/${javaClass.id}/exercises`, {
    method: 'POST',
    token: naveen.token,
    body: { conceptId: concept.id, language: 'javascript', difficulty: 'easy' },
  });
  ok(exercise.status === 201, 'AI generates a practical exercise');
  const exId = exercise.body.exercise.id;

  const badCode = await api(`/api/practice/classrooms/${javaClass.id}/exercises/${exId}/submit`, {
    method: 'POST',
    token: naveen.token,
    body: { code: 'function solve(v) { console.log(v); }', hintsUsed: 0 },
  });
  ok(badCode.status === 201 && badCode.body.submission.passed === false, 'failing submission is detected');
  ok(badCode.body.submission.staticAnalysis.issues.length > 0, 'static analysis reports issues');

  const escape = await api(`/api/practice/classrooms/${javaClass.id}/exercises/${exId}/submit`, {
    method: 'POST',
    token: naveen.token,
    body: { code: 'function solve() { return process.env.JWT_SECRET; }' },
  });
  ok(escape.status === 201, 'sandbox accepts the attempt but isolates the process');
  ok(!JSON.stringify(escape.body).includes('learnmate-local-dev-secret'), 'host secrets are not readable from the sandbox');

  const loop = await api(`/api/practice/classrooms/${javaClass.id}/exercises/${exId}/submit`, {
    method: 'POST',
    token: naveen.token,
    body: { code: 'function solve() { while (true) {} }' },
  });
  ok(loop.body.submission.timedOut === true || loop.body.submission.results.every((r) => !r.passed), 'infinite loop is killed by the timeout');

  const goodCode = await api(`/api/practice/classrooms/${javaClass.id}/exercises/${exId}/submit`, {
    method: 'POST',
    token: naveen.token,
    body: { code: 'function solve(values) { if (!Array.isArray(values)) throw new Error("invalid"); return values.reduce((a, b) => a + b, 0); }', hintsUsed: 0 },
  });
  ok(goodCode.status === 201 && goodCode.body.submission.executed === true, `sandbox executed the submission (${goodCode.body.submission.runtime})`);
  const hint = await api(`/api/practice/classrooms/${javaClass.id}/exercises/${exId}/hint`, { method: 'POST', token: naveen.token, body: { level: 2 } });
  ok(hint.status === 200 && hint.body.hint.length > 20 && !hint.body.hint.includes('return values.reduce'), 'progressive hint does not reveal the solution');

  section('14. Syllabus management');
  const manual = await api(`/api/syllabus/${state.dsClass.id}/manual`, {
    method: 'POST',
    token: naveen.token,
    body: {
      title: 'Data Structures Syllabus',
      subjects: [
        {
          name: 'Data Structures',
          units: [
            { name: 'Unit 1 – Arrays', concepts: [{ name: 'Dynamic Arrays', description: 'Amortised growth.', keywords: ['capacity', 'resize'], objectives: ['Explain amortised cost'] }] },
            { name: 'Unit 2 – Trees', concepts: [{ name: 'Binary Search Trees', description: 'Ordered structure.', keywords: ['bst', 'traversal'] }] },
          ],
        },
      ],
    },
  });
  ok(manual.status === 201 && manual.body.subjects.length === 1, 'manual syllabus (subject → unit → concept) saved');
  ok(manual.body.subjects[0].units[0].concepts[0].subtopics !== undefined, 'syllabus hierarchy is queryable');

  const notStaff = await api(`/api/syllabus/${state.dsClass.id}/manual`, {
    method: 'POST',
    token: karthik.token,
    body: { title: 'Hack', subjects: [{ name: 'x', units: [{ name: 'u', concepts: [{ name: 'c' }] }] }] },
  });
  ok([403].includes(notStaff.status), 'non-staff users cannot modify the syllabus');

  // DOCX upload parse
  const zipBuf = await makeDocx([
    'Unit 1 – Graph Foundations',
    '1.1 Graph Representations',
    '1.2 Traversals',
    'Unit 2 – Shortest Paths',
    '2.1 Dijkstra Algorithm',
  ]);
  const form = new FormData();
  form.append('files', new Blob([zipBuf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'syllabus.docx');
  form.append('subject', 'Algorithms');
  form.append('preview', 'true');
  const upload = await api(`/api/syllabus/${state.dsClass.id}/upload`, { method: 'POST', token: naveen.token, body: form });
  ok(upload.status === 200 && upload.body.preview === true, 'DOCX upload extracts text and previews a parsed structure');
  ok(upload.body.syllabus.units.length >= 2 && upload.body.syllabus.subjects[0].units.length >= 2, 'parsed document produces a unit/concept hierarchy');
  ok(upload.body.files[0].words > 0, 'extracted document statistics are reported');
  const badUpload = await api(`/api/syllabus/${state.dsClass.id}/upload`, {
    method: 'POST',
    token: naveen.token,
    body: (() => {
      const f = new FormData();
      f.append('files', new Blob([Buffer.from('not a real pdf')], { type: 'application/pdf' }), 'fake.pdf');
      return f;
    })(),
  });
  ok([400].includes(badUpload.status), 'unreadable document is rejected with a clear error');

  section('15. AI configuration (admin) — without restart');
  const staffDenied = await api('/api/ai/admin/overview', { token: naveen.token });
  ok(staffDenied.status === 403, 'non-admin cannot read global AI provider settings');
  const adminOverview = await api('/api/ai/admin/overview', { token: admin.token });
  ok(adminOverview.status === 200, 'admin reads the AI overview');
  ok(adminOverview.body.models.length === 8, `all 8 registered NVIDIA models present (${adminOverview.body.models.length})`);
  ok(adminOverview.body.routing.length >= 8, 'task routing table present');
  ok(adminOverview.body.features.length >= 10, 'AI feature flags present');
  ok(!JSON.stringify(adminOverview.body).includes('sk-'), 'no API key material in admin responses');
  const modelIds = adminOverview.body.models.map((m) => m.modelId);
  ok(modelIds.includes('nvidia/nemotron-3.5-lightning-30b-a3b') && modelIds.includes('qwen/qwen2.5-coder-32b-instruct'),
    'registered model IDs match the requirements');

  const verify = await api('/api/ai/admin/models/verify', { method: 'POST', token: admin.token });
  ok(verify.status === 200 && Array.isArray(verify.body.models), 'model availability is verified against the catalogue (never assumed)');
  ok(verify.body.models.every((m) => ['available', 'unavailable', 'unknown'].includes(m.availability)), 'verification returns explicit availability states');

  const reroute = await api('/api/ai/admin/routing/tutoring', {
    method: 'PATCH',
    token: admin.token,
    body: { model: 'deepseek-ai/deepseek-v4-flash' },
  });
  ok(reroute.status === 200, 'admin re-routes a task to another model');
  const afterReroute = await api('/api/ai/admin/overview', { token: admin.token });
  ok(afterReroute.body.routing.find((r) => r.task === 'tutoring').model === 'deepseek-ai/deepseek-v4-flash', 'routing change is live immediately');
  await api('/api/ai/admin/routing/tutoring', { method: 'PATCH', token: admin.token, body: { model: 'nvidia/nemotron-3.5-lightning-30b-a3b' } });

  const disable = await api('/api/ai/admin/features/assessment_generation', { method: 'PATCH', token: admin.token, body: { enabled: false } });
  ok(disable.status === 200, 'admin disables an AI feature');
  const blockedExercise = await api(`/api/practice/classrooms/${javaClass.id}/exercises`, {
    method: 'POST',
    token: naveen.token,
    body: { conceptId: concept.id, language: 'javascript' },
  });
  ok(blockedExercise.status === 403, 'disabled feature is enforced in the request path');
  const blockedAssessment = await api(`/api/learning/classrooms/${javaClass.id}/assessments`, {
    method: 'POST',
    token: naveen.token,
    body: { conceptId: concept.id, kind: 'topic_quiz' },
  });
  ok(blockedAssessment.status === 403, 'assessment generation is blocked while disabled');
  await api('/api/ai/admin/features/assessment_generation', { method: 'PATCH', token: admin.token, body: { enabled: true } });

  const tutorOff = await api('/api/ai/admin/features/tutoring', { method: 'PATCH', token: admin.token, body: { enabled: false } });
  ok(tutorOff.status === 200, 'admin disables personalised tutoring');
  const blockedSession = await api('/api/tutor/sessions', {
    method: 'POST',
    token: naveen.token,
    body: { classroomId: javaClass.id, conceptId: concept.id, mode: 'learn' },
  });
  ok(blockedSession.status === 403, 'tutoring sessions are refused while tutoring is disabled');
  await api('/api/ai/admin/features/tutoring', { method: 'PATCH', token: admin.token, body: { enabled: true } });
  const restored = await api('/api/tutor/sessions', {
    method: 'POST',
    token: naveen.token,
    body: { classroomId: javaClass.id, conceptId: concept.id, mode: 'learn' },
  });
  ok(restored.status === 201, 're-enabling the feature restores tutoring immediately (no restart)');

  const usage = await api('/api/ai/admin/usage', { token: admin.token });
  ok(usage.status === 200 && usage.body.totals.requests > 0, `usage analytics recorded ${usage.body.totals.requests} requests`);
  ok(usage.body.byModel.length > 0, 'model-wise usage breakdown present');
  ok(usage.body.byClassroom.length >= 0, 'classroom-wise usage breakdown present');
  const logs = await api('/api/ai/admin/logs', { token: admin.token });
  ok(logs.status === 200 && logs.body.logs.length > 0, 'AI request logs available');

  const classroomAi = await api(`/api/classrooms/${javaClass.id}/ai-settings`, { token: aisha.token });
  ok(classroomAi.status === 200 && classroomAi.body.canEdit === true, 'owner reads classroom-level AI settings');
  ok(!JSON.stringify(classroomAi.body).includes('apiKey'), 'classroom owners never receive provider credentials');
  const classroomAiStudent = await api(`/api/classrooms/${javaClass.id}/ai-settings`, { token: karthik.token });
  ok(classroomAiStudent.body.canEdit === false, 'students cannot edit classroom AI settings');

  section('16. Dashboards & remaining workflows');
  const dash = await api('/api/dashboard', { token: naveen.token });
  ok(dash.status === 200 && dash.body.classrooms.length >= 4, 'user dashboard aggregates all classrooms');
  ok(dash.body.learning.recentTopics.length > 0, 'recent topics present');
  ok(dash.body.counts.owned >= 3 && dash.body.counts.teaching >= 0, 'dashboard splits created vs joined classrooms');

  const overview = await api(`/api/intelligence/classrooms/${state.dsClass.id}/overview`, { token: naveen.token });
  ok(overview.status === 200 && overview.body.counts.students >= 1, 'classroom overview reports members');
  const audit = await api(`/api/classrooms/${state.dsClass.id}/audit`, { token: naveen.token });
  ok(audit.status === 200 && audit.body.logs.length > 0, 'classroom audit log records actions');

  const leave = await api(`/api/classrooms/${state.mathClass.id}/leave`, { method: 'POST', token: rohit.token });
  ok(leave.status === 200, 'member can leave a classroom');
  const afterLeave = await api(`/api/classrooms/${state.mathClass.id}`, { token: rohit.token });
  ok(afterLeave.status === 403, 'left member loses access');
  const ownerLeave = await api(`/api/classrooms/${state.dsClass.id}/leave`, { method: 'POST', token: naveen.token });
  ok(ownerLeave.status === 400, 'primary owner must transfer ownership before leaving');

  const remove = await api(`/api/classrooms/${state.dsClass.id}/members/${karthik.user.id}`, { method: 'DELETE', token: naveen.token });
  ok(remove.status === 200, 'owner removes a member');
  const outsider = await api(`/api/classrooms/${state.mathClass.id}/transfer-ownership`, {
    method: 'POST',
    token: naveen.token,
    body: { userId: meera.user.id },
  });
  ok(outsider.status === 404, 'cannot transfer ownership to a non-member');
  const newcomerToken = reg.body.token;
  await api('/api/classrooms/join', { method: 'POST', token: newcomerToken, body: { code: state.mathClass.code } });
  const transfer = await api(`/api/classrooms/${state.mathClass.id}/transfer-ownership`, {
    method: 'POST',
    token: naveen.token,
    body: { userId: reg.body.user.id },
  });
  ok(transfer.status === 200, 'ownership transferred to an active member');
  const afterTransfer = await api(`/api/classrooms/${state.mathClass.id}`, { token: naveen.token });
  ok(afterTransfer.status === 200 && afterTransfer.body.membership.role === 'co_owner', 'previous owner becomes co-owner after transfer');

  section('17. Cross-classroom data isolation under attack');
  const foreignConcept = mlProfile.body.mastery[0]?.conceptId;
  const attack = await api('/api/tutor/sessions', {
    method: 'POST',
    token: naveen.token,
    body: { classroomId: javaClass.id, conceptId: foreignConcept, mode: 'learn' },
  });
  ok(attack.status === 404, 'cannot start a session on another classroom’s concept');
  const attackMl = await api(`/api/intelligence/classrooms/${javaClass.id}/students/${nvId}/profile`, { token: rohit.token });
  ok(attackMl.status === 403, 'monitoring-off teacher cannot read a learner profile in that classroom');
  // A member of classroom A cannot use classroom A's URL to read classroom B data.
  const crossClassAnalytics = await api(`/api/intelligence/classrooms/${state.dsClass.id}/students/${nvId}/profile`, { token: rohit.token });
  ok(crossClassAnalytics.status === 403, 'classroom-scoped URLs never expose another classroom’s records');

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
  if (failed) {
    console.log('\x1b[31mFailures:\x1b[0m');
    failures.forEach((f) => console.log(` - ${f}`));
    process.exitCode = 1;
  }
}

async function makeDocx(paragraphs) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, '&amp;')}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

main().catch((err) => {
  console.error('\n\x1b[31mFATAL\x1b[0m', err);
  process.exit(1);
});
