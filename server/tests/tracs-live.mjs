/**
 * TRACS — LIVE HTTP TEST
 * ======================
 *
 * Real server, real database, real auth. `tests/tracs.mjs` tests the pure
 * logic in-process; this tests the wire.
 *
 * It exists because two bugs were invisible to the in-process tests and
 * obvious here:
 *
 *   - the form re-prefixed the question id (`q_…`), so the server saw every
 *     answer as arriving for a question that had "moved on" and refused it;
 *   - the checking loop re-served an already-answered question instead of
 *     re-teaching, so a learner who missed a check was asked the same thing
 *     again rather than being taught differently.
 *
 * Both were only reachable through a real request. Run it with the harness:
 *
 *   node tests/run-tracs-live.mjs
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3199';
let pass = 0, fail = 0;
const ok = (label, cond, detail='') => { cond ? (pass++, console.log('  PASS', label)) : (fail++, console.log('  FAIL', label, detail)); };

const post = async (path, body, token, raw) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
};
const get = async (path, token) => {
  const res = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: await res.json().catch(() => null) };
};

// wait for health
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch { /* not up */ }
  await new Promise(r => setTimeout(r, 500));
}

const login = await post('/api/auth/login', { email: 'naveen@learnmate.ai', password: 'LearnMate123!' });
ok('demo learner can sign in', login.status === 200 && Boolean(login.json?.token), `${login.status} ${login.text.slice(0,120)}`);
const token = login.json?.token;

const SYLLABUS = `# CS 201 — Data Structures

## Unit 1: Linear Structures

## Lists and tuples
A list is an ordered, mutable sequence. A tuple is ordered and immutable, which makes it safe to use as a dictionary key.

## Stacks and queues
A stack is last-in-first-out. A queue is first-in-first-out.

## Unit 2: Hashing

## Dictionaries
A dictionary maps keys to values with constant-time average lookup.
`;

// 1. upload
const up = await post('/api/tracs/syllabus', { text: SYLLABUS, title: 'Data Structures' }, token);
ok('syllabus uploads', up.status === 201, `${up.status} ${up.text.slice(0,200)}`);
const sessionId = up.json?.session?.id;
ok('session is returned', Boolean(sessionId));
ok('topics were extracted', (up.json?.session?.topics?.length || 0) >= 2, JSON.stringify(up.json?.session?.topics?.map(t=>t.title)));
ok('exactly two commands are advertised', JSON.stringify(up.json?.commands) === JSON.stringify(['/test','/learn']));

// 2. an unknown command is refused
const bad = await post(`/api/tracs/${sessionId}/turn`, { command: 'quiz' }, token);
ok('an unknown command is rejected (400)', bad.status === 400, `${bad.status} ${bad.text.slice(0,120)}`);

// 3. /test asks exactly one question
const t1 = await post(`/api/tracs/${sessionId}/turn`, { command: 'test' }, token);
ok('/test succeeds', t1.status === 200, `${t1.status} ${t1.text.slice(0,200)}`);
const forms = (t1.json?.document?.components || []).filter(c => c.type === 'question_form');
ok('exactly one form is returned', forms.length === 1, `got ${forms.length}`);
ok('that form holds exactly one question', forms[0]?.questions?.length === 1, `got ${forms[0]?.questions?.length}`);
ok('the document has a version envelope', t1.json?.document?.version === '1.0');
const q1 = forms[0]?.questions?.[0];
ok('the question has a protocol type', ['radio','text_input','textarea','code_input','number','boolean','select','slider','date','checkbox_group','file_upload'].includes(q1?.type), q1?.type);

// 4. answer it (a deliberate wrong/blank answer -> next question still comes)
const ans = await post(`/api/tracs/${sessionId}/turn`, {
  command: 'test',
  question_id: q1.id,
  answer: q1.type === 'radio' ? 'a deliberately wrong answer' : 'I do not know',
}, token);
ok('an answer is graded', ans.status === 200, `${ans.status} ${ans.text.slice(0,200)}`);
ok('a verdict comes back', ['correct','incorrect','partly_correct','unanswered','not_graded'].includes(ans.json?.result?.verdict), ans.json?.result?.verdict);
const forms2 = (ans.json?.document?.components || []).filter(c => c.type === 'question_form');
ok('the next question is also exactly one form', forms2.length <= 1);
ok('and it has one question', !forms2[0] || forms2[0].questions.length === 1);

// 5. /learn explains, and asks nothing
const l1 = await post(`/api/tracs/${sessionId}/turn`, { command: 'learn' }, token);
ok('/learn succeeds', l1.status === 200, `${l1.status} ${l1.text.slice(0,200)}`);
const comps = l1.json?.document?.components || [];
ok('/learn returns renderings', comps.length >= 2, `got ${comps.length}`);
ok('the explanation is not empty', comps.some(c => ['learning','text','code_editor','diagram','math','card_group'].includes(c.type)), JSON.stringify(comps.map(c=>c.type)));

// /learn is explanation-only. It used to end with two checking questions, which
// made it feel like /test with a preamble: someone who only wanted to read had
// to answer a graded question first.
ok('/learn asks no question at all', comps.every(c => c.type !== 'question_form'), JSON.stringify(comps.map(c=>c.type)));
ok('/learn reports no pending checks', !l1.json?.session?.mode || l1.json.session.mode === 'learn');

{
  // The only way forward is one button, and it names the command it runs.
  const rows = comps.filter(c => c.type === 'actions');
  ok('/learn offers exactly one action row', rows.length === 1, `got ${rows.length}`);
  const buttons = rows[0]?.actions || [];
  ok('/learn offers exactly one button', buttons.length === 1, JSON.stringify(buttons.map(b=>b.label)));
  ok('and that button is /test', buttons[0]?.command === 'test', JSON.stringify(buttons[0]));
  ok('labelled with the command', /\/test/.test(buttons[0]?.label || ''), buttons[0]?.label);
}

// 6. /test is what asks a question
const tLearn = await post(`/api/tracs/${sessionId}/turn`, { command: 'test' }, token);
ok('/test succeeds', tLearn.status === 200, `${tLearn.status} ${tLearn.text.slice(0,200)}`);
const checks = (tLearn.json?.document?.components || []).filter(c => c.type === 'question_form');
ok('/test asks exactly one question', checks.length === 1, JSON.stringify((tLearn.json?.document?.components||[]).map(c=>c.type)));
ok('with exactly one question on screen', checks[0]?.questions?.length === 1);

// 6. a checking question is answerable
const cq = checks[0]?.questions?.[0];
const checkAns = await post(`/api/tracs/${sessionId}/turn`, {
  command: 'test',
  question_id: cq.id,
  answer: cq.type === 'radio' ? (cq.options?.[0] || 'A') : 'A variable stores a value.',
}, token);
ok('a checking answer is accepted', checkAns.status === 200, `${checkAns.status} ${checkAns.text.slice(0,200)}`);
ok('the loop reports what happened', ['check','understood','reteach','first_exposure'].includes(checkAns.json?.outcome), checkAns.json?.outcome);
ok('and stays one question at a time', (checkAns.json?.document?.components || []).filter(c=>c.type==='question_form').every(f=>f.questions.length===1));

// 6b. missing every check must repeat the explanation, not repeat the question
{
  const up2 = await post('/api/tracs/syllabus', {
    text: '## Lists and tuples\nA list is ordered and mutable. A tuple is immutable and hashable.\n\n## Dictionaries\nMaps keys to values with constant-time lookup.',
    title: 'Reteach',
  }, token);
  const id2 = up2.json?.session?.id;
  const teach = await post(`/api/tracs/${id2}/turn`, { command: 'test' }, token);
  const firstForm = (teach.json?.document?.components || []).filter((c) => c.type === 'question_form')[0];
  const asked = new Set();
  let last = null;

  // Answer every check wrongly, one at a time, until the loop stops asking.
  // This drives /test: /learn no longer opens a checking round at all.
  for (let turn = 0; turn < 4; turn += 1) {
    // `last` is the HTTP wrapper ({ status, json }), so the document hangs off
    // `last.json`. Reading `last.document` silently fell through to the *first*
    // explanation's form on every turn, which re-answered question 1 forever.
    const form = (last?.json?.document?.components || teach.json?.document?.components || []).filter((c) => c.type === 'question_form')[0];
    if (!form) break;
    const question = form.questions[0];
    if (!question || asked.has(`${turn}:${question.id}`)) break;
    asked.add(`${turn}:${question.id}`);
    last = await post(`/api/tracs/${id2}/turn`, { command: 'test', question_id: question.id, answer: 'deliberately wrong' }, token);
    if (last.json?.outcome === 'reteach') break;
  }

  ok('missing every check produces a re-teach', ['reteach', 'needs_teaching'].includes(last?.json?.outcome), last?.json?.outcome);
  const reteachTypes = (last?.json?.document?.components || []).map((c) => c.type);
  ok('the re-teach carries a fresh explanation', reteachTypes.includes('learning') || reteachTypes.includes('text'), JSON.stringify(reteachTypes));
  ok('the re-teach says why', (last?.json?.document?.components || []).some((c) => c.type === 'text' && /not quite there|working definition|again|different way/i.test(c.content || '')));
  const reteachForms = (last?.json?.document?.components || []).filter((c) => c.type === 'question_form');
  ok('and re-checks with exactly one question', reteachForms.length === 1 && reteachForms[0].questions.length === 1);
  await fetch(`${BASE}/api/tracs/${id2}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}

// 7. reload resumes
const reload = await get(`/api/tracs/${sessionId}`, token);
ok('a session reloads', reload.status === 200);
ok('topics are listed with mastery', Array.isArray(reload.json?.session?.topics) && reload.json.session.topics.length >= 2);
ok('reload keeps the two-command contract', JSON.stringify(reload.json?.commands) === JSON.stringify(['/test','/learn']));

// 8. isolation: another learner cannot read it
const other = await post('/api/auth/login', { email: 'aisha@learnmate.ai', password: 'LearnMate123!' });
if (other.status === 200 && other.json?.token) {
  const stolen = await get(`/api/tracs/${sessionId}`, other.json.token);
  ok('another learner cannot read the session (404)', stolen.status === 404, String(stolen.status));
} else ok('second demo learner signs in', false, String(other.status));

// 9. no auth at all
const anon = await get(`/api/tracs/${sessionId}`);
ok('an anonymous request is refused', anon.status === 401 || anon.status === 403, String(anon.status));

// 10. cleanup
const del = await fetch(`${BASE}/api/tracs/${sessionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
ok('the session can be deleted', del.status === 200, String(del.status));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
