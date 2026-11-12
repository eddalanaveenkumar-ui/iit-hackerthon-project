/**
 * Front-end contract smoke test.
 *
 * Verifies that every API call the React client makes returns a shape the
 * corresponding page actually reads. Run against a live server:
 *
 *   node tests/smoke-web.mjs            # uses http://127.0.0.1:3001
 *   BASE=http://host:port node tests/smoke-web.mjs
 *
 * This is not a replacement for tests/e2e.mjs (which drives the isolated
 * harness); it guards the client/server contract specifically.
 */
const BASE = (process.env.BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
const PASSWORD = 'LearnMate123!';

let passed = 0;
const failures = [];

function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

async function login(email) {
  const res = await call('/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

function section(name) {
  console.log(`\n${name}`);
}

const run = async () => {
  console.log(`LearnMate AI web contract smoke test → ${BASE}`);

  // --------------------------------------------------------------------- auth
  const student = await login('naveen@learnmate.ai');
  const teacher = await login('meera@learnmate.ai');
  const offTeacher = await login('rohit@learnmate.ai');
  const admin = await login('admin@learnmate.ai');

  // ---------------------------------------------------------------- SPA shell
  section('SPA shell');
  for (const route of ['/', '/login', '/register', '/app', '/app/progress', '/app/admin/ai', '/app/classrooms/x/monitor']) {
    const res = await fetch(`${BASE}${route}`);
    const html = await res.text();
    check(`GET ${route} serves the SPA shell`, res.status === 200 && html.includes('<div id="root">'));
  }
  const notApi = await fetch(`${BASE}/api/does-not-exist`, { headers: { authorization: `Bearer ${student}` } });
  check('unknown /api path returns a JSON 404 instead of the SPA shell', notApi.status === 404 && (await notApi.text()).includes('NOT_FOUND'));

  // --------------------------------------------------------------------- auth
  section('Auth');
  check('student, teacher, monitoring-off teacher and admin can all log in', Boolean(student && teacher && offTeacher && admin));

  const me = await call('/auth/me', { token: student });
  check('/auth/me returns the profile the sidebar renders', me.status === 200 && me.body.user.name === 'Naveen Kumar' && me.body.user.avatarColor);

  const patched = await call('/auth/me', { token: student, method: 'PATCH', body: { headline: 'CSE undergraduate · learning Java and ML' } });
  check('Settings saves a profile patch', patched.status === 200 && typeof patched.body.user.headline === 'string');

  const prefs = await call('/auth/me', { token: student, method: 'PATCH', body: { preferences: { theme: 'dark' } } });
  check('Settings persists the dark theme preference', prefs.status === 200 && prefs.body.user.preferences.theme === 'dark');
  await call('/auth/me', { token: student, method: 'PATCH', body: { preferences: { theme: 'light' } } });

  // ---------------------------------------------------------------- dashboard
  section('Dashboard');
  const dash = await call('/dashboard', { token: student });
  check('/dashboard returns counts + classroom cards', dash.status === 200 && dash.body.counts && Array.isArray(dash.body.classrooms));
  check('dashboard cards expose role, stats and cover image', dash.body.classrooms.every((c) => c.id && c.myRole && c.stats && 'coverImage' in c));

  // --------------------------------------------------------------- classrooms
  section('Classrooms');
  const rooms = await call('/classrooms', { token: student });
  check('/classrooms lists memberships with permissions', rooms.status === 200 && rooms.body.classrooms.every((c) => c.myPermissions && c.code.startsWith('LM-')));

  const joinable = (await call('/classrooms/joinable', { token: student }).catch(() => ({ status: 0 }))) || {};
  check('joinable directory responds (or is not required)', [200, 404].includes(joinable.status));

  const classroom = rooms.body.classrooms.find((c) => c.name.includes('Java Programming'));
  const classroomId = classroom.id;
  const detail = await call(`/classrooms/${classroomId}`, { token: student });
  check('classroom detail returns classroom + membership + owner', detail.status === 200 && detail.body.membership.role && detail.body.owner);

  const members = await call(`/classrooms/${classroomId}/members`, { token: student });
  check('member roster renders roles and monitoring flags', members.status === 200 && members.body.members.every((m) => m.role && 'monitoringEnabled' in m));

  const audit = await call(`/classrooms/${classroomId}/audit`, { token: student });
  check('audit log endpoint answers for staff', [200, 403].includes(audit.status));

  // ----------------------------------------------------------------- syllabus
  section('Syllabus + outline');
  const syllabus = await call(`/syllabus/${classroomId}`, { token: student });
  check('syllabus tree returns subjects → units → concepts', syllabus.status === 200 && syllabus.body.subjects[0].units[0].concepts.length > 0);

  const outline = await call(`/tutor/classrooms/${classroomId}/outline`, { token: student });
  check('guided-start outline returns modes', outline.status === 200 && outline.body.modes.length === 4 && outline.body.hasSyllabus);
  const concept = outline.body.subjects[0].units[0].concepts[0];
  check('outline concepts carry objectives and keywords', concept.id && concept.objectives.length > 0 && concept.keywords.length > 0);

  const resume = await call(`/tutor/classrooms/${classroomId}/resume`, { token: student });
  check('resume payload powers the Continue mode', resume.status === 200 && Array.isArray(resume.body.lowestMastery));

  // -------------------------------------------------------------------- tutor
  section('Tutor session');
  const started = await call('/tutor/sessions', {
    token: student,
    method: 'POST',
    body: { classroomId, conceptId: concept.id, mode: 'learn' },
  });
  check('POST /tutor/sessions opens a fresh session', started.status === 201 && started.body.session.id);
  check('opening reply + context + profile are returned together', started.body.messages.length === 1 && started.body.context.concept.name && started.body.profile.knowledgeLevel);
  const sessionId = started.body.session.id;

  const turn = await call(`/tutor/sessions/${sessionId}/messages`, { token: student, method: 'POST', body: { content: 'I think int is 8 bytes on every JVM.', signal: { wrongAnswer: true } } });
  check(
    `a tutor turn returns the reply + intelligence block (HTTP ${turn.status}, keys: ${Object.keys(turn.body || {}).join('/') || 'none'}${turn.body?.blocked ? ' · blocked' : ''}${turn.body?.error ? ` · ${turn.body.error.code || turn.body.error.message}` : ''})`,
    turn.status === 200 && turn.body.message?.content?.length > 20 && turn.body.intelligence,
  );
  // Guard the property rather than dereferencing it: this suite drives dozens of
  // AI-backed flows as one user, so a 429 here is about the rate limit, not about
  // the payload. Crashing on `in undefined` hid that distinction for three runs.
  check('turn intelligence drives the right-hand rail', Boolean(turn.body.intelligence) && 'scaffoldingLevel' in turn.body.intelligence && 'gapsDetected' in turn.body.intelligence);
  if (turn.status === 429) {
    console.log('  \u001b[33m!\u001b[0m the AI rate limit was hit — raise AI_RATE_LIMIT_MAX for the deployment running this suite');
  }
  check('retrieval sources are exposed for citation chips', Array.isArray(turn.body.retrieval?.sources));

  const reloaded = await call(`/tutor/sessions/${sessionId}`, { token: student });
  check('session can be reloaded with its messages', reloaded.status === 200 && reloaded.body.messages.length >= 3);

  const otherView = await call(`/tutor/sessions/${sessionId}`, { token: teacher });
  check('another user cannot open someone else\'s session', otherView.status === 403);

  // ---------------------------------------------------------------- practice
  section('Practical coding');
  const exercises = await call(`/practice/classrooms/${classroomId}/exercises`, { token: student });
  check('exercise list returns attempts/solved flags', exercises.status === 200 && exercises.body.exercises.every((e) => 'myAttempts' in e && 'solved' in e));

  const generated = await call(`/practice/classrooms/${classroomId}/exercises`, {
    token: student,
    method: 'POST',
    body: { conceptId: concept.id, language: 'javascript', difficulty: 'easy' },
  });
  check('exercise generation returns tests + starter code', generated.status === 201 && generated.body.exercise.tests.length >= 1);
  const exerciseId = generated.body.exercise.id;

  const run1 = await call(`/practice/classrooms/${classroomId}/exercises/${exerciseId}/run`, { token: student, method: 'POST', body: { code: 'function solve(){ return 1; }' } });
  check('Run executes in the sandbox and reports per-test results', run1.status === 200 && Array.isArray(run1.body.results) && 'staticAnalysis' in run1.body);

  const hint = await call(`/practice/classrooms/${classroomId}/exercises/${exerciseId}/hint`, { token: student, method: 'POST', body: { level: 2 } });
  check('progressive hint endpoint returns a hint level', hint.status === 200 && hint.body.hint.length > 10);

  const submitted = await call(`/practice/classrooms/${classroomId}/exercises/${exerciseId}/submit`, {
    token: student,
    method: 'POST',
    body: { code: 'function solve(){ return 1; }', hintsUsed: 1, timeSpentSeconds: 120 },
  });
  check('submit returns visible results + hidden summary + intelligence', submitted.status === 201 && submitted.body.submission && submitted.body.intelligence);
  check('hidden tests never leak their expectations', !JSON.stringify(submitted.body.submission.hiddenSummary).includes('expected'));

  // ------------------------------------------------------------- assessments
  section('Assessments');
  const created = await call(`/learning/classrooms/${classroomId}/assessments`, {
    token: student,
    method: 'POST',
    body: { conceptId: concept.id, kind: 'topic_quiz', origin: 'student', questionCount: 3 },
  });
  check('student can trigger an assessment', created.status === 201 && created.body.questions.length >= 3);
  check('questions are served without correct answers', created.body.questions.every((q) => !('correctIndex' in q)));

  const assessmentId = created.body.assessment.id;
  const list = await call(`/learning/classrooms/${classroomId}/assessments`, { token: student });
  check('assessment list computes status and results', list.status === 200 && list.body.assessments.some((a) => a.id === assessmentId));

  const detailView = await call(`/learning/classrooms/${classroomId}/assessments/${assessmentId}`, { token: student });
  check('assessment detail powers the attempt modal', detailView.status === 200 && detailView.body.questions.length >= 3);

  const answers = detailView.body.questions.map((q) => ({ questionId: q.id, answer: q.type === 'multiple_choice' ? 0 : 'A short answer.' }));
  const result = await call(`/learning/classrooms/${classroomId}/assessments/${assessmentId}/submit`, { token: student, method: 'POST', body: { answers, durationSeconds: 90 } });
  check('submission grades and updates the profile', result.status === 201 && typeof result.body.result.percentage === 'number' && result.body.profile.knowledgeLevel);
  check('result modal receives per-question analysis', result.body.result.answers.length === answers.length && result.body.result.aiFeedback);

  const duplicate = await call(`/learning/classrooms/${classroomId}/assessments/${assessmentId}/submit`, { token: student, method: 'POST', body: { answers, durationSeconds: 10 } });
  check('duplicate submission is rejected', duplicate.status === 400);

  const second = await call(`/learning/classrooms/${classroomId}/assessments`, { token: student, method: 'POST', body: { conceptId: concept.id, kind: 'revision', origin: 'ai', questionCount: 3 } });
  const postponed = await call(`/learning/classrooms/${classroomId}/assessments/${second.body.assessment.id}/postpone`, { token: student, method: 'POST' });
  check('AI-recommended assessment can be postponed', postponed.status === 200 || postponed.status === 201);

  // ------------------------------------------------------------- progress
  section('Progress');
  const progress = await call(`/intelligence/classrooms/${classroomId}/my-progress`, { token: student });
  check('progress returns profile, mastery, weaknesses, assessments, activity', progress.status === 200 && progress.body.profile && Array.isArray(progress.body.mastery));
  check('mastery rows carry trend + evidence counts', progress.body.mastery.every((m) => typeof m.trend === 'number' && typeof m.evidenceCount === 'number'));

  // ------------------------------------------------------------ monitoring
  section('Teacher monitoring');
  const teachingRoomId = (await call('/classrooms', { token: teacher })).body.classrooms.find((c) => c.name.includes('Machine Learning')).id;
  const analytics = await call(`/intelligence/classrooms/${teachingRoomId}/analytics`, { token: teacher });
  check('teacher analytics exposes students when monitoring is ON', analytics.status === 200 && analytics.body.monitoringEnabled === true && analytics.body.students.length > 0);
  check('analytics rows cover mastery/independence/weaknesses', analytics.body.students.every((s) => 'masteryAverage' in s && 'independenceScore' in s && 'openWeaknesses' in s));

  const overview = await call(`/intelligence/classrooms/${teachingRoomId}/overview`, { token: teacher });
  check('classroom overview returns counts + 14-day timeline', overview.status === 200 && overview.body.analytics.timeline.length === 14);

  const assessmentOverview = await call(`/learning/classrooms/${teachingRoomId}/assessment-overview`, { token: teacher });
  check('assessment overview lists per-student averages', assessmentOverview.status === 200 && Array.isArray(assessmentOverview.body.students));

  const meTeacher = await call('/auth/me', { token: teacher });
  const toggled = await call(`/classrooms/${teachingRoomId}/teachers/${meTeacher.body.user.id}/monitoring`, { token: teacher, method: 'PATCH', body: { monitoringEnabled: false } });
  check('teacher can switch their own monitoring OFF', toggled.status === 200 && toggled.body.monitoringEnabled === false);

  const restricted = await call(`/intelligence/classrooms/${teachingRoomId}/analytics`, { token: teacher });
  check('monitoring OFF hides the student list', restricted.status === 200 && restricted.body.monitoringEnabled === false && restricted.body.students.length === 0);
  check('monitoring OFF still returns aggregate figures', restricted.body.aggregate.studentCount >= 1);

  const profileBlocked = await call(`/intelligence/classrooms/${teachingRoomId}/students/${me.body.user.id}/profile`, { token: teacher });
  check('monitoring OFF blocks the profile endpoint only for accessible classrooms', profileBlocked.status === 403 || profileBlocked.status === 404);
  check('monitoring OFF blocks student profiles', profileBlocked.status === 403);

  const ownLearning = await call('/tutor/sessions', { token: teacher, method: 'POST', body: { classroomId: teachingRoomId, conceptId: (await call(`/tutor/classrooms/${teachingRoomId}/outline`, { token: teacher })).body.subjects[0].units[0].concepts[0].id, mode: 'learn' } });
  check('monitoring OFF does not affect the teacher\'s own learning', ownLearning.status === 201);

  await call(`/classrooms/${teachingRoomId}/teachers/${meTeacher.body.user.id}/monitoring`, { token: teacher, method: 'PATCH', body: { monitoringEnabled: true } });

  const otherTeacher = await call('/auth/me', { token: offTeacher });
  const forbiddenToggle = await call(`/classrooms/${classroomId}/teachers/${otherTeacher.body.user.id}/monitoring`, { token: teacher, method: 'PATCH', body: { monitoringEnabled: true } });
  check('a non-owner teacher cannot flip another teacher\'s monitoring', forbiddenToggle.status === 403);

  // ---------------------------------------------------------- chat privacy
  section('Chat privacy');
  const privacy = await call(`/tutor/classrooms/${classroomId}/chat-privacy`, { token: student });
  check('privacy settings load with an audit trail', privacy.status === 200 && privacy.body.privacy && Array.isArray(privacy.body.audit));

  await call(`/tutor/classrooms/${classroomId}/chat-privacy`, { token: student, method: 'PATCH', body: { shareWithTeachers: false, shareWithOwner: false } });
  const staffViewer = await login('aisha@learnmate.ai');
  const chatBlocked = await call(`/tutor/classrooms/${classroomId}/students/${me.body.user.id}/chat`, { token: staffViewer });
  check('revoked chat access is refused server-side', chatBlocked.status === 403);

  await call(`/tutor/classrooms/${classroomId}/chat-privacy`, { token: student, method: 'PATCH', body: { shareWithTeachers: true, shareWithOwner: true } });
  const chatAllowed = await call(`/tutor/classrooms/${classroomId}/students/${me.body.user.id}/chat`, { token: staffViewer });
  check('granted chat access returns sessions + messages', chatAllowed.status === 200 && Array.isArray(chatAllowed.body.sessions));
  const privacyAfter = await call(`/tutor/classrooms/${classroomId}/chat-privacy`, { token: student });
  check('audit trail records grant and revoke events', privacyAfter.body.audit.length >= 2);
  await call(`/tutor/classrooms/${classroomId}/chat-privacy`, { token: student, method: 'PATCH', body: { shareWithTeachers: false, shareWithOwner: false } });

  // ------------------------------------------------------------- admin AI
  section('Admin AI console');
  const denied = await call('/ai/admin/overview', { token: student });
  check('non-admins cannot read AI configuration', denied.status === 403);

  const aiOverview = await call('/ai/admin/overview', { token: admin });
  const liveModels = aiOverview.body.models.filter((m) => m.enabled).map((m) => m.modelId);
  // Migrated deployments keep retired documents for usage history, so the total
  // is a superset of six rather than exactly six.
  check('admin overview returns provider, models, routing, generation, features', aiOverview.status === 200 && aiOverview.body.models.length >= 6 && aiOverview.body.routing.length > 0 && aiOverview.body.generation);
  // The deployed registry must not advertise a model the endpoint cannot serve.
  const RETIRED = ['nvidia/nemotron-content-safety-reasoning-4b', 'qwen/qwen2.5-coder-32b-instruct', 'deepseek-ai/deepseek-v4-flash'];
  const stillLive = RETIRED.filter((id) => liveModels.includes(id));
  check(`deployed registry carries no retired model${stillLive.length ? ` — still enabled: ${stillLive.join(', ')}` : ''}`, stillLive.length === 0);
  const deadRoutes = aiOverview.body.routing.filter((r) => r.model && !liveModels.includes(r.model));
  const retiredEnabled = aiOverview.body.models.filter((m) => m.retired && m.enabled);
  check(
    `every deployed route points at a live model${deadRoutes.length ? ` — dead: ${deadRoutes.map((r) => `${r.task}->${r.model}`).join(', ')}` : ''}${retiredEnabled.length ? ` — retired but enabled: ${retiredEnabled.map((m) => m.modelId).join(', ')}` : ''}`,
    deadRoutes.length === 0 && retiredEnabled.length === 0,
  );
  check('provider credentials are never returned', !JSON.stringify(aiOverview.body).toLowerCase().includes('apikey') || !JSON.stringify(aiOverview.body).match(/"apiKey"\s*:\s*"[^"]{12,}"/));
  check('feature flags are grouped for the toggles tab', aiOverview.body.features.every((f) => f.key && f.label && f.category));

  // One key per model: the page needs to know which slots are filled before it
  // renders the keys tab, and must never receive the secrets themselves.
  const creds = await call('/ai/admin/credentials', { token: admin });
  check('credential slots are exposed for the API keys tab', creds.status === 200 && creds.body.slots === 8 && creds.body.callableSlots === 6);
  check('the keys tab is told which models are unserved', creds.body.unavailable.length === 2 && creds.body.unavailable.every((u) => u.reason));
  check('each callable model reports its credential slot and source', creds.body.models.every((m) => m.credentialSlot && typeof m.source === 'string'));
  check('no key material reaches the browser', !JSON.stringify(creds.body).includes('nvapi-'));

  const usage = await call('/ai/admin/usage?days=30', { token: admin });
  check('usage analytics has totals, by-model, by-classroom and daily series', usage.status === 200 && usage.body.totals && usage.body.byModel.length > 0 && Array.isArray(usage.body.daily));

  const logs = await call('/ai/admin/logs?limit=20', { token: admin });
  check('usage log feed renders task/model/latency rows', logs.status === 200 && logs.body.logs.every((l) => l.task && l.model && typeof l.latencyMs === 'number'));

  const health = await call('/ai/admin/provider/test', { token: admin, method: 'POST' });
  check('provider health check answers without a key', health.status === 200 && typeof health.body.ok === 'boolean');

  const routeTask = aiOverview.body.routing.find((r) => r.task === 'tutoring');
  const rerouted = await call('/ai/admin/routing/tutoring', { token: admin, method: 'PATCH', body: { model: 'nvidia/nemotron-3-ultra-550b-a55b' } });
  check('routing can be changed live', rerouted.status === 200);
  const afterReroute = await call('/ai/admin/overview', { token: admin });
  check('routing change is immediately visible (no restart)', afterReroute.body.routing.find((r) => r.task === 'tutoring').model === 'nvidia/nemotron-3-ultra-550b-a55b');
  await call('/ai/admin/routing/tutoring', { token: admin, method: 'PATCH', body: { model: routeTask.model } });

  const featureOff = await call('/ai/admin/features/tutoring', { token: admin, method: 'PATCH', body: { enabled: false } });
  check('feature toggle can be switched off', featureOff.status === 200);
  const blockedByFlag = await call('/tutor/sessions', { token: student, method: 'POST', body: { classroomId, conceptId: concept.id, mode: 'learn' } });
  check('disabled feature is enforced immediately', blockedByFlag.status === 403);
  await call('/ai/admin/features/tutoring', { token: admin, method: 'PATCH', body: { enabled: true } });
  const restored = await call('/tutor/sessions', { token: student, method: 'POST', body: { classroomId, conceptId: concept.id, mode: 'learn' } });
  check('re-enabling the feature restores tutoring', restored.status === 201);

  const generation = aiOverview.body.generation;
  const savedGen = await call('/ai/admin/generation', { token: admin, method: 'PUT', body: { temperature: generation.temperature, topP: generation.topP, maxTokens: generation.maxTokens } });
  check('generation parameters save', savedGen.status === 200);

  await call(`/tutor/sessions/${sessionId}/end`, { token: student, method: 'POST' });

  // --------------------------------------------------------------- summary
  console.log(`\n${'-'.repeat(52)}`);
  console.log(`Web contract smoke test: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  • ${f}`));
    process.exitCode = 1;
  }
};

run().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exitCode = 1;
});
