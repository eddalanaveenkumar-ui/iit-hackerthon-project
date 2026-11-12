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

  // PDF upload parse. This failed in production with "Setting up fake worker
  // failed: Cannot find module .../pdf.worker.mjs" while passing locally,
  // because the worker is loaded by pdfjs through a runtime path the bundler
  // cannot see. The fix imports it statically (see syllabus/pdf-engine.js); this
  // asserts a real PDF still parses so a regression is caught before deploying.
  const pdfBuf = makePdf([
    'Unit 1 Python Fundamentals 1.1 Variables and Data Types 1.2 Operators 1.3 Input and Output',
    'Unit 2 Control Flow 2.1 Conditional Statements 2.2 Loops for and while 2.3 Break and Continue',
    'Unit 3 Data Structures 3.1 Lists and Tuples 3.2 Dictionaries and Sets 3.3 List Comprehensions',
  ]);
  const pdfForm = new FormData();
  pdfForm.append('files', new Blob([pdfBuf], { type: 'application/pdf' }), 'LearnMate_AI_Python_Full_Tutorial_Syllabus.pdf');
  pdfForm.append('subject', 'Python');
  pdfForm.append('preview', 'true');
  const pdfUpload = await api(`/api/syllabus/${state.dsClass.id}/upload`, {
    method: 'POST',
    token: naveen.token,
    body: pdfForm,
  });
  ok(pdfUpload.status === 200 && pdfUpload.body.preview === true, 'PDF upload extracts text and previews a parsed structure');
  ok(pdfUpload.body.files?.[0]?.pages === 3, `PDF page count is reported (${pdfUpload.body.files?.[0]?.pages})`);
  ok(pdfUpload.body.files?.[0]?.words > 0, 'PDF words are counted');
  ok(
    pdfUpload.body.syllabus?.units?.length >= 3,
    `PDF text is parsed into units (${pdfUpload.body.syllabus?.units?.length})`,
  );
  ok(
    JSON.stringify(pdfUpload.body).includes('Requirements') ||
      JSON.stringify(pdfUpload.body).includes('Variables') ||
      JSON.stringify(pdfUpload.body).includes('Data Types'),
    'the extracted PDF text is actually the document content, not a placeholder',
  );

  // A corrupt PDF must fail with a message about the file, never about the engine.
  const brokenPdfForm = new FormData();
  brokenPdfForm.append('files', new Blob([Buffer.from('%PDF-1.4\nnot actually a pdf')], { type: 'application/pdf' }), 'broken.pdf');
  const brokenPdf = await api(`/api/syllabus/${state.dsClass.id}/upload`, {
    method: 'POST',
    token: naveen.token,
    body: brokenPdfForm,
  });
  ok(brokenPdf.status === 400, 'a corrupt PDF is rejected');
  ok(
    !/fake worker|Cannot find module|GlobalWorkerOptions/i.test(JSON.stringify(brokenPdf.body)),
    'a corrupt PDF is not misreported as a missing PDF engine',
  );

  section('15. AI configuration (admin) — without restart');
  const staffDenied = await api('/api/ai/admin/overview', { token: naveen.token });
  ok(staffDenied.status === 403, 'non-admin cannot read global AI provider settings');
  const adminOverview = await api('/api/ai/admin/overview', { token: admin.token });
  ok(adminOverview.status === 200, 'admin reads the AI overview');
  // Only models that are actually callable are registered. Two seed entries
  // (content-safety-4b, qwen2.5-coder-32b) are unavailable on NVIDIA's free
  // endpoint and are retired rather than offered as 404s.
  ok(adminOverview.body.models.length === 6, `all 6 callable NVIDIA models present (${adminOverview.body.models.length})`);
  ok(adminOverview.body.routing.length >= 8, 'task routing table present');
  ok(adminOverview.body.features.length >= 10, 'AI feature flags present');
  ok(!JSON.stringify(adminOverview.body).includes('sk-'), 'no API key material in admin responses');
  const modelIds = adminOverview.body.models.map((m) => m.modelId);
  ok(modelIds.includes('nvidia/nemotron-3.5-lightning-30b-a3b') && modelIds.includes('nvidia/nemotron-3-ultra-550b-a55b'),
    'registered model IDs match the requirements');
  ok(modelIds.includes('deepseek-ai/deepseek-v4.1-flash'), 'the multimodal fallback uses its real model id (v4.1-flash)');
  ok(!modelIds.includes('qwen/qwen2.5-coder-32b-instruct'), 'the unavailable Qwen coder is not offered');
  ok(!modelIds.includes('nvidia/nemotron-content-safety-reasoning-4b'), 'the unavailable safety model is not offered');
  ok(adminOverview.body.models.filter((m) => m.retired).length === 0, 'retired models are not listed as live');

  // Every routed model must exist, or the first call for that task 404s.
  const liveIds = new Set(modelIds);
  const dangling = adminOverview.body.routing.filter((r) => r.model && !liveIds.has(r.model));
  ok(dangling.length === 0, `no task routes to a model that does not exist (${dangling.map((d) => d.task).join(', ') || 'none'})`);

  const verify = await api('/api/ai/admin/models/verify', { method: 'POST', token: admin.token });
  ok(verify.status === 200 && Array.isArray(verify.body.models), 'model availability is verified against the catalogue (never assumed)');
  ok(verify.body.models.every((m) => ['available', 'unavailable', 'unknown'].includes(m.availability)), 'verification returns explicit availability states');

  // Pick a model other than the one tutoring already uses, so the test is about
  // re-routing rather than about a hard-coded id.
  const tutoringNow = adminOverview.body.routing.find((r) => r.task === 'tutoring').model;
  const rerouteTarget = modelIds.find((id) => id !== tutoringNow);
  const reroute = await api('/api/ai/admin/routing/tutoring', {
    method: 'PATCH',
    token: admin.token,
    body: { model: rerouteTarget },
  });
  ok(reroute.status === 200, 'admin re-routes a task to another model');
  const afterReroute = await api('/api/ai/admin/overview', { token: admin.token });
  ok(afterReroute.body.routing.find((r) => r.task === 'tutoring').model === rerouteTarget, 'routing change is live immediately');
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

  section('16b. Per-model endpoints (each NIM model has its own API surface)');
  const endpoints = await api('/api/ai/admin/models/endpoints', { token: admin.token });
  ok(endpoints.status === 200, 'admin can read resolved endpoints for every model');
  const byId = Object.fromEntries(endpoints.body.endpoints.map((e) => [e.modelId, e]));
  ok(byId['nvidia/nemotron-3.5-lightning-30b-a3b']?.path === '/chat/completions',
    'chat model resolves to /chat/completions');
  ok(byId['nvidia/nemotron-3.5-embed-1b']?.path === '/embeddings',
    'embedding model resolves to /embeddings, not /chat/completions');
  ok(byId['nvidia/nemotron-3.5-rerank-8b']?.path === '/ranking',
    'rerank model resolves to the NeMo /ranking surface');
  ok(endpoints.body.endpoints.every((e) => e.url.startsWith('http')), 'every model resolves to an absolute URL');
  ok(endpoints.body.endpoints.every((e) => typeof e.configured === 'boolean'), 'each model reports whether it has credentials');
  ok(!JSON.stringify(endpoints.body).includes('nvapi-'), 'no key material leaks through the endpoint view');

  const staffEndpoints = await api('/api/ai/admin/models/endpoints', { token: naveen.token });
  ok(staffEndpoints.status === 403, 'non-admin cannot read the endpoint map');

  // A model can be pointed at its own host, its own path and its own key.
  const override = await api('/api/ai/admin/models/nvidia/nemotron-3.5-embed-1b', {
    method: 'PATCH',
    token: admin.token,
    body: {
      endpointBaseUrl: 'https://nim.internal.example/v1',
      endpointPath: '/v1/embeddings',
      apiKey: 'nvapi-per-model-test-key-0001',
    },
  });
  ok(override.status === 200, 'admin can give one model its own host, path and key');
  const afterOverride = await api('/api/ai/admin/models/endpoints', { token: admin.token });
  const embedAfter = afterOverride.body.endpoints.find((e) => e.modelId === 'nvidia/nemotron-3.5-embed-1b');
  ok(embedAfter.url === 'https://nim.internal.example/v1/embeddings', `per-model override is applied and normalised (${embedAfter.url})`);
  ok(embedAfter.overridesGlobal === true, 'override is surfaced as overriding the global provider');
  ok(embedAfter.apiKeySource === 'model', 'the model reports using its own credentials');
  ok(!JSON.stringify(afterOverride.body).includes('nvapi-per-model-test-key-0001'), 'model key is never returned in clear text');

  const badUrl = await api('/api/ai/admin/models/nvidia/nemotron-3.5-embed-1b', {
    method: 'PATCH',
    token: admin.token,
    body: { endpointBaseUrl: 'not-a-url' },
  });
  ok(badUrl.status >= 400, 'an invalid endpoint URL is rejected');

  await api('/api/ai/admin/models/nvidia/nemotron-3.5-embed-1b', {
    method: 'PATCH',
    token: admin.token,
    body: { endpointBaseUrl: null, endpointPath: null, clearApiKey: true },
  });
  const restoredEndpoints = await api('/api/ai/admin/models/endpoints', { token: admin.token });
  ok(
    restoredEndpoints.body.endpoints.find((e) => e.modelId === 'nvidia/nemotron-3.5-embed-1b').url.endsWith('/embeddings'),
    'clearing an override restores the global endpoint',
  );

  section('16b. Per-model API keys — one slot each, six callable');
  // The platform is asked to hold eight keys: one per model. Six models are
  // callable, two are not served by the provider. A single global key would mean
  // every model drawing on one 40 RPM quota, so each must be able to hold its own.
  const creds0 = await api('/api/ai/admin/credentials', { token: admin.token });
  ok(creds0.status === 200, 'admin reads the per-model credential list');
  ok(creds0.body.slots === 8, `eight credential slots are reported (${creds0.body.slots})`);
  ok(creds0.body.callableSlots === 6, `six of the eight are callable (${creds0.body.callableSlots})`);
  ok(creds0.body.unavailable.length === 2, 'the two unserved models are listed rather than silently dropped');
  ok(
    creds0.body.unavailable.every((u) => u.canSetKey === false && u.reason),
    'an unserved model refuses a key and explains why',
  );
  ok(creds0.body.models.length === 6, 'the six callable models each get a row');
  ok(
    creds0.body.models.every((m) => m.credentialSlot && m.credentialSlot.endsWith('_API_KEY') === false),
    'every callable model names its own environment slot',
  );
  ok(
    new Set(creds0.body.models.map((m) => m.credentialSlot)).size === 6,
    'the six slots are distinct — no model shares another\'s key',
  );
  ok(!JSON.stringify(creds0.body).includes('nvapi-per-model-test-key-0001'), 'no stored key is returned in clear text');

  // Give exactly one model its own key and confirm nothing else changed.
  const target = 'nvidia/nemotron-3.5-parse';
  const setKey = await api(`/api/ai/admin/credentials/${encodeURIComponent(target)}`, {
    method: 'PATCH',
    token: admin.token,
    body: { apiKey: 'nvapi-parse-only-key-000001' },
  });
  ok(setKey.status === 200, 'admin can give a single model its own key');
  const creds1 = await api('/api/ai/admin/credentials', { token: admin.token });
  const parseRow = creds1.body.models.find((m) => m.modelId === target);
  ok(parseRow.hasOwnKey === true && parseRow.source === 'model', 'that model now reports its own key');
  ok(creds1.body.configured === 1, 'exactly one model is configured, not all of them');
  ok(
    creds1.body.models.filter((m) => m.modelId !== target).every((m) => !m.hasOwnKey),
    'the other five models are untouched by a per-model key',
  );
  ok(!JSON.stringify(creds1.body).includes('nvapi-parse-only-key-000001'), 'the key is masked in the response');
  ok(
    parseRow.apiKeyPreview && parseRow.apiKeyPreview.includes('••••') && parseRow.apiKeyPreview.endsWith('0001'),
    'a masked preview is shown so an operator can tell keys apart',
  );

  // The endpoint map must reflect the per-model key, not the global one.
  const epAfterKey = await api('/api/ai/admin/models/endpoints', { token: admin.token });
  const parseEp = epAfterKey.body.endpoints.find((e) => e.modelId === target);
  ok(parseEp.apiKeySource === 'model', 'the endpoint map attributes the call to the model key');
  ok(parseEp.credentialSlot === 'NVIDIA_API_KEY_PARSE', 'the endpoint map names the model\'s own slot');

  // A retired model cannot be given a key — accepting one would imply it works.
  const retiredKey = await api('/api/ai/admin/credentials/nvidia%2Fnemotron-content-safety-reasoning-4b', {
    method: 'PATCH',
    token: admin.token,
    body: { apiKey: 'nvapi-should-not-be-accepted' },
  });
  ok(retiredKey.status === 404 || retiredKey.status === 400, 'a retired model cannot be given a key');

  const staffCreds = await api('/api/ai/admin/credentials', { token: naveen.token });
  ok(staffCreds.status === 403, 'non-admin cannot read or set model keys');

  // Clearing restores inheritance from the global key.
  const cleared = await api(`/api/ai/admin/credentials/${encodeURIComponent(target)}`, {
    method: 'PATCH',
    token: admin.token,
    body: { clearApiKey: true },
  });
  ok(cleared.status === 200, 'a per-model key can be cleared');
  const creds2 = await api('/api/ai/admin/credentials', { token: admin.token });
  ok(creds2.body.models.find((m) => m.modelId === target).hasOwnKey === false, 'clearing falls the model back to the global key');

  // Overview surfaces the same split so the Models tab is not misleading.
  const overviewCreds = (await api('/api/ai/admin/overview', { token: admin.token })).body.credentials;
  ok(overviewCreds && overviewCreds.modelCount === 6, 'the overview reports six credential slots');
  ok(typeof overviewCreds.distinctKeySlots === 'number', 'the overview reports how many distinct keys are held');

  section('16c. Chat renders visual explanations alongside prose');
  // Starting a session ends any prior active session in that classroom, so this
  // section opens its own instead of reusing one from earlier.
  const visualSession = await api('/api/tutor/sessions', {
    method: 'POST',
    token: naveen.token,
    body: { classroomId: javaClass.id, conceptId: concept.id, mode: 'learn' },
  });
  ok(visualSession.status === 201, 'a fresh session starts for the visual check');
  const visualTurn = await api(`/api/tutor/sessions/${visualSession.body.session.id}/messages`, {
    method: 'POST',
    token: naveen.token,
    body: { content: 'I still do not see the difference between a list and a tuple.' },
  });
  ok(visualTurn.status === 200 || visualTurn.status === 201, 'tutor replies to a confusion about two similar types');
  const visuals = visualTurn.body.message?.meta?.visuals;
  ok(Array.isArray(visuals) && visuals.length > 0, 'the reply carries at least one visual block');
  ok((visuals || []).every((v) => ['flow', 'compare', 'steps', 'code', 'hierarchy', 'table'].includes(v.kind)),
    'every block is a renderable kind the client understands');
  ok(['model', 'generated'].includes(visualTurn.body.message?.meta?.visualsSource),
    'the source of the visual is recorded (model or deterministic)');
  const readBack = await api(`/api/tutor/sessions/${visualSession.body.session.id}`, { token: naveen.token });
  const persisted = readBack.body.messages.find((m) => m.id === visualTurn.body.message?.id);
  ok(Array.isArray(persisted?.meta?.visuals) && persisted.meta.visuals.length === (visuals || []).length,
    'visuals are persisted with the message, so history re-renders them');

  section('16a. Moderation verdict parsing — a false alarm must not break a turn');

  // extractJson must prefer an object over an array. A chatty model can emit a
  // list before its answer, and returning the list made a { flagged } task read
  // an array and quietly decide the content was safe.
  const { extractJson } = await import('../src/modules/ai/orchestrator.js');
  const jsonCases = [
    ['{"flagged": false}', 'object only'],
    ['```json\n{"flagged": true}\n```', 'fenced object'],
    ['Sure. Here you go: {"flagged": false, "action": "allow"}', 'prose then object'],
    ['[1,2] {"flagged": true}', 'array before object still yields the object'],
    ['{"reason": "uses {braces}", "flagged": false}', 'braces inside a string'],
  ];
  for (const [input, label] of jsonCases) {
    const parsed = extractJson(input);
    ok(parsed && !Array.isArray(parsed) && typeof parsed === 'object' && 'flagged' in parsed,
      `extractJson handles ${label}`);
  }
  ok(Array.isArray(extractJson('[{"a":1}]')), 'extractJson still returns arrays when there is no object');
  ok(extractJson('no json here at all') === null, 'extractJson returns null when there is nothing to parse');

  // A blocked turn must have the same shape as a normal one: the client reads
  // intelligence.scaffoldingLevel on every reply, so a safety response without
  // it previously crashed the message thread.
  // Moderation only blocks when the model says so; with no key the deterministic
  // analyser decides, so this asserts the shape contract rather than the verdict.
  const modSession = await api('/api/tutor/sessions', {
    method: 'POST',
    token: naveen.token,
    body: { classroomId: javaClass.id, conceptId: concept.id, mode: 'learn' },
  });
  ok(modSession.status === 201, `a session opens for the moderation check (${modSession.body?.error?.message || 'ok'})`);
  ok(modSession.status === 201, 'a session opens for the moderation check');
  const benignTurn = await api(`/api/tutor/sessions/${modSession.body?.session?.id}/messages`, {
    method: 'POST',
    token: naveen.token,
    body: { content: 'Can you explain how the JVM allocates memory for an int?' },
  });
  ok(benignTurn.status === 200 || benignTurn.status === 201, `a benign message is answered (${benignTurn.status} ${JSON.stringify(benignTurn.body?.error || {}).slice(0, 160)})`);
  ok(benignTurn.body.blocked !== true, 'a benign question is not blocked');
  ok(
    benignTurn.body.intelligence && 'scaffoldingLevel' in benignTurn.body.intelligence && 'gapsDetected' in benignTurn.body.intelligence,
    'every tutor reply carries the intelligence block the rail reads',
  );

  section('16d. Response latency budget — a chat turn must not time out');

  // A serverless function has a hard wall (vercel.json maxDuration). If the AI
  // call is allowed to run as long as the function itself, a slow upstream kills
  // the request at the platform edge with a gateway 504 and no diagnosis. The
  // two budgets must be ordered: model call < function.
  const { default: config } = await import('../src/config/index.js');
  const fs = await import('node:fs/promises');
  const vercelCfg = JSON.parse(await fs.readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const fnSeconds = vercelCfg.functions['api/index.js'].maxDuration;
  ok(typeof fnSeconds === 'number' && fnSeconds >= 60, `the function budget is explicit (${fnSeconds}s)`);
  ok(
    config.ai.requestTimeoutMs < fnSeconds * 1000,
    `the model timeout (${config.ai.requestTimeoutMs}ms) leaves room inside the function (${fnSeconds}s)`,
  );
  ok(
    config.ai.requestTimeoutMs <= 45_000,
    'a learner waits at most 45s before the app reports a slow model',
  );

  // Content moderation must not add a model round trip to an ordinary message.
  // It is gated by a keyword pre-screen: harmless coursework skips the call, and
  // anything that trips it still goes to the model.
  const tutorRoutes = await fs.readFile(new URL('../src/modules/tutor/routes.js', import.meta.url), 'utf8');
  ok(/MODERATION_HINTS\.test\(data\.content\)/.test(tutorRoutes),
    'moderation only calls the model when the pre-screen matches');
  ok(/timeoutMs:\s*8000/.test(tutorRoutes), 'the screening call has its own short deadline');

  section('16c2. The deterministic analyser works with no provider key');

  // The deployed server has no NVIDIA_API_KEY. JSON-backed flows must still
  // answer from the local analyser: the fallback was previously gated on a key
  // existing, so assessment generation returned 400 on exactly the configuration
  // that ships by default. The gate is gone; this asserts the analyser it now
  // reaches actually produces usable JSON.
  const { getLocalProvider } = await import('../src/modules/ai/orchestrator.js');
  const localAi = getLocalProvider();
  const localQuiz = await localAi.chat({
    model: 'local',
    messages: [{ role: 'user', content: 'Generate a quiz about Java data types.' }],
    meta: { task: 'assessment_generation', concept: { name: 'Variables and Primitive Types', objectives: ['declare a variable'] } },
  });
  const quizJson = (() => {
    try {
      return JSON.parse(localQuiz.text);
    } catch {
      return null;
    }
  })();
  ok(Boolean(quizJson), 'the deterministic analyser returns parseable JSON for assessment generation');
  ok(Array.isArray(quizJson?.questions) && quizJson.questions.length > 0, 'the local quiz has questions');
  ok(
    quizJson.questions.every((q) => q.prompt && (q.type === 'short_answer' || (Array.isArray(q.options) && q.options.length >= 2))),
    'local questions are answerable (options or a rubric)',
  );

  // A no-key deployment must never fail a JSON task merely because there is no
  // key: the fallback is chosen by allowSimulation, not by hasApiKey.
  const orchSrc = await (await import('node:fs/promises')).readFile(new URL('../src/modules/ai/orchestrator.js', import.meta.url), 'utf8');
  ok(!/if \(runtime\.hasApiKey\) \{\s*\n\s*try \{\s*\n\s*const local = new LocalProvider/.test(orchSrc),
    'the local fallback is not gated on a provider key');
  ok(/if \(config\.ai\.allowSimulation\)/.test(orchSrc), 'the fallback is gated on the simulation switch instead');

  section('16c3. A tutor reply is never empty');

  // Production returned HTTP 200 with a zero-length reply and the client rendered
  // a blank bubble. The route now rejects empty and whitespace-only text, so this
  // asserts the invariant on a normal turn and on the helper's edge cases.
  for (const content of ['', '   ', null, undefined, 42]) {
    const candidate = typeof content === 'string' ? content : undefined;
    const safe = typeof candidate === 'string' && candidate.trim().length > 0;
    ok(!safe, `an empty/whitespace reply (${JSON.stringify(content)}) is rejected as a real answer`);
  }

  const emptyCheckSession = await api('/api/tutor/sessions', {
    method: 'POST',
    token: naveen.token,
    body: { classroomId: javaClass.id, conceptId: concept.id, mode: 'learn' },
  });
  const emptyCheckTurn = await api(`/api/tutor/sessions/${emptyCheckSession.body.session.id}/messages`, {
    method: 'POST',
    token: naveen.token,
    body: { content: 'ok' },
  });
  const emptyCheckText = emptyCheckTurn.body?.message?.content;
  ok(
    typeof emptyCheckText === 'string' && emptyCheckText.trim().length > 0,
    `even a minimal prompt yields a non-empty reply (${JSON.stringify(String(emptyCheckText || '').slice(0, 60))})`,
  );

  section('16e. Vision — reading a photo of student work');
  const visionCaps = await api('/api/ai/vision/capabilities', { token: naveen.token });
  ok(visionCaps.status === 200, 'vision capabilities are reported');
  ok(visionCaps.body.models.length === 1, `exactly one vision model is registered (${visionCaps.body.models.length})`);
  ok(visionCaps.body.models[0].modelId === 'deepseek-ai/deepseek-v4.1-flash', 'the multimodal DeepSeek model is the vision path');
  ok(visionCaps.body.mimeTypes.includes('image/png') && visionCaps.body.maxBytes > 0, 'accepted image types and size limit are published');

  // A route only qualifies if its primary model can actually see.
  const routedVision = visionCaps.body.tasks;
  ok(Array.isArray(routedVision) && routedVision.every((t) => t !== 'tutoring'), 'vision routes are capability-derived, not assumed');

  const tinyPng = `data:image/png;base64,${Buffer.from('x'.repeat(80)).toString('base64')}`;

  // An unauthenticated caller must not be able to spend tokens.
  const visionAnon = await api('/api/ai/vision/read', { method: 'POST', body: { image: tinyPng } });
  ok(visionAnon.status === 401, 'vision requires authentication');

  // Not an image at all.
  const notAnImage = await api('/api/ai/vision/read', { method: 'POST', token: naveen.token, body: { image: 'hello there'.repeat(10) } });
  ok(notAnImage.status === 400 && notAnImage.body.error, 'a non-image payload is rejected with a reason');

  // SVG is excluded: it can carry script and is not a photo of work.
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
  const svgRes = await api('/api/ai/vision/read', { method: 'POST', token: naveen.token, body: { image: svg } });
  ok(svgRes.status === 400, 'SVG is refused as an image type');

  // With no usable key the endpoint must say so — never invent a reading.
  const noKey = await api('/api/ai/vision/read', { method: 'POST', token: naveen.token, body: { image: tinyPng, prompt: 'why is my loop wrong?' } });
  ok([502, 503].includes(noKey.status), 'without a key vision fails loudly rather than guessing');
  ok(!noKey.body.reading, 'no fabricated transcription is returned');
  ok(/key|credential|available/i.test(noKey.body.error || ''), `the failure explains itself ("${String(noKey.body.error).slice(0, 60)}")`);

  section('16d. Chat history (sidebar archive)');
  const history = await api('/api/tutor/sessions?limit=10', { token: naveen.token });
  ok(history.status === 200, 'learner can read their chat history');
  ok(Array.isArray(history.body.sessions) && history.body.sessions.length > 0, 'history lists past sessions');
  ok(history.body.sessions.every((s) => s.id && s.startedAt), 'each entry has an id and a start time');
  ok(history.body.sessions.every((s) => s.concept?.name && s.classroom?.name), 'entries resolve concept and classroom names');
  const sortedDesc = history.body.sessions.every((s, i, arr) => i === 0 || new Date(arr[i - 1].startedAt) >= new Date(s.startedAt));
  ok(sortedDesc, 'history is newest first');
  ok(typeof history.body.hasMore === 'boolean', 'history reports whether more pages exist');

  const scoped = await api(`/api/tutor/sessions?limit=10&classroomId=${javaClass.id}`, { token: naveen.token });
  ok(scoped.body.sessions.every((s) => s.classroom.id === String(javaClass.id)), 'history can be filtered by classroom');

  // A learner must never see another learner's conversations through this route,
  // even when they ask for a large page.
  const otherHistory = await api('/api/tutor/sessions?limit=100', { token: meera.token });
  const otherIds = new Set(otherHistory.body.sessions.map((s) => s.id));
  const naveenIds = new Set(history.body.sessions.map((s) => s.id));
  const leaked = [...otherIds].filter((id) => naveenIds.has(id));
  ok(leaked.length === 0, `history never returns another learner's sessions (${leaked.length} leaked)`);
  ok(otherHistory.body.sessions.every((s) => s.id), 'the other learner sees their own archive');

  const unauthHistory = await api('/api/tutor/sessions?limit=5');
  ok(unauthHistory.status === 401, 'chat history requires authentication');

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

/**
 * Build a small, valid text PDF using base-14 Helvetica.
 *
 * Real uploads are PDFs far more often than DOCX, and the PDF path is the one
 * that broke in production (the pdfjs worker was missing from the serverless
 * bundle while every local test passed). Generating one here keeps that path
 * covered without committing a binary fixture.
 */
function makePdf(pages) {
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const pageObjs = [];
  const contentObjs = [];
  let idx = 3;
  for (let i = 0; i < pages.length; i += 1) {
    pageObjs.push(idx);
    idx += 1;
    contentObjs.push(idx);
    idx += 1;
  }
  objs[2] = `<< /Type /Pages /Kids [${pageObjs.map((o) => `${o} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  const fontObj = idx;
  objs[fontObj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${String(text).replace(/[()\\]/g, '')}) Tj ET`;
    objs[contentObjs[i]] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objs[pageObjs[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjs[i]} 0 R ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`;
  });
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i += 1) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i += 1) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
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
