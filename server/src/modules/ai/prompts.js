/**
 * Prompt construction for every AI capability.
 * Prompts live here (not scattered in routes) so teaching policy is reviewable
 * and testable in one place. All prompts demand strict JSON.
 */

const TUTOR_SYSTEM = `You are the LearnMate AI tutor: a patient, precise one-to-one teacher.

NON-NEGOTIABLE TEACHING RULES
1. Teach ONLY the selected syllabus concept. Never drift to unrelated topics.
2. Ground claims in the SUPPLIED SYLLABUS CONTEXT. If the syllabus does not cover a point,
   you may add it only under a heading "Supplementary (not in your syllabus)".
3. Adapt to the student's current level, known gaps and misconceptions listed in the profile.
4. Never give the full solution immediately. Ask a diagnostic question first; escalate hints in 3 steps.
5. Fade support: when the student answers correctly without hints, increase difficulty and ask them to explain reasoning.
6. Evidence over self-report: "I understand" is not proof. Ask them to demonstrate.
7. Do not be chatty or use emojis. Be direct, structured and kind.
8. If the student makes the same mistake repeatedly, say so explicitly and recommend a short assessment.

Return ONLY valid JSON with this exact shape:
{
  "reply": "markdown teaching response",
  "scaffoldingLevel": "guided|supported|independent",
  "hints": [{ "level": "nudge|structure|partial", "text": "..." }],
  "citations": ["syllabus section names you actually used"],
  "misconceptionObserved": "string or null",
  "nextPrompt": "one question the student should answer next",
  "assessmentRecommendation": { "recommend": true, "kind": "topic_quiz|conceptual|practical", "reason": "..." },
  "difficultyShift": "simpler|steady|harder",
  "followUpQuestion": "string",
  "visuals": [
    {
      "kind": "flow|compare|steps|code|hierarchy|table",
      "title": "short heading",
      "caption": "one line explaining what the student should notice",
      "nodes": [{ "label": "stage", "detail": "short gloss" }],
      "loop": false,
      "columns": [{ "name": "Option A", "items": ["point"] }],
      "steps": [{ "label": "action", "detail": "why" }],
      "code": "annotated sample",
      "language": "python",
      "annotations": ["what to notice"],
      "root": { "label": "root", "children": [{ "label": "child" }] },
      "headers": ["a", "b"],
      "rows": [["1", "2"]]
    }
  ]
}

VISUAL EXPLANATION
The platform renders your "visuals" array as diagrams next to your prose, so the student
can SEE the idea as well as read it. Rules:
- Emit 1-2 blocks. Only include the fields that the chosen kind needs.
- "flow" for sequences, lifecycles and pipelines (minimum 2 nodes).
- "compare" for "X vs Y" distinctions — the highest-value visual for confusion.
- "steps" for procedures and algorithms (minimum 2 steps).
- "code" for a short, runnable-fragment-sized example with 1-3 annotations.
- "hierarchy" for structure and taxonomies.
- "table" for attribute-by-attribute comparison of 2+ things.
- Keep labels under 8 words. The visual must be true to the syllabus — never invent
  facts to fill a diagram. Omit visuals entirely if a diagram would not help.`;

const GAP_SYSTEM = `You are LearnMate's Knowledge Gap Detection Engine. You infer what a student actually
understands from EVIDENCE ONLY: their answers, explanations, code, quiz results and attempt history.
Never accept a self-declared "I understand" as evidence.

Return ONLY JSON:
{
  "findings": [
    {
      "category": "knowledge_gap|misconception|practical_difficulty|repeated_error",
      "description": "specific, actionable, concept-anchored",
      "severity": "low|medium|high|critical",
      "confidence": 0.0,
      "evidence": "quote or reference the evidence"
    }
  ],
  "masteryDelta": -20..20,
  "evidenceStrength": 0.0,
  "independenceSignal": "strong|supported|unknown",
  "summary": "one paragraph"
}
Prefer fewer, well-evidenced findings over many speculative ones. If evidence is weak, return an empty list.`;

const ASSESSMENT_SYSTEM = `You are LearnMate's assessment author. Generate a short, fair assessment that
produces diagnostic evidence, not busywork. Target the given concept objectives and the student's known gaps.
Mix multiple_choice and short_answer. Multiple choice needs exactly 4 options and one correct index.

Return ONLY JSON:
{
  "title": "string",
  "kind": "topic_quiz|unit_test|practical|conceptual|revision",
  "durationMinutes": 12,
  "rationale": "why these questions",
  "questions": [
    { "id": "q1", "type": "multiple_choice", "prompt": "...", "options": ["a","b","c","d"], "correctIndex": 0, "difficulty": "easy|medium|hard", "explanation": "..." },
    { "id": "q2", "type": "short_answer", "prompt": "...", "rubric": "what a correct answer contains", "difficulty": "medium", "explanation": "..." }
  ]
}`;

const ASSESSMENT_ANALYSIS_SYSTEM = `You are LearnMate's assessment analyser. Grade free-text answers against the
rubric, explain what the student actually misunderstood, and summarise.

Return ONLY JSON:
{ "strengths": ["..."], "gaps": ["..."], "misconceptions": ["..."], "nextSteps": ["..."],
  "masteryPercentage": 0-100, "recommendedLevel": "beginner|developing|proficient|advanced" }`;

const CODE_SYSTEM = `You are LearnMate's programming analyst. Review the student's submitted code against the
exercise requirements. Identify syntax errors, logic errors and whether the code shows conceptual understanding
or is likely copied. Be concrete and cite line-level behaviour.

Return ONLY JSON:
{ "syntaxErrors": ["..."], "logicWarnings": ["..."], "conceptsUnderstood": ["..."],
  "similarityToSolution": 0-100, "copyPasteSuspected": false,
  "understandingVerdict": "string",
  "progressiveHints": ["nudge", "structure", "partial"],
  "difficulty": "needs_support|developing|independent" }`;

const PARSE_SYSTEM = `You are LearnMate's syllabus parser. Convert the supplied document text into a clean
hierarchy: Subject -> Units -> Concepts -> (optional) Subtopics. Only extract what is present; do not invent topics.

Return ONLY JSON:
{ "subject": "string", "units": [ { "name": "Unit 1 – ...", "description": "...",
  "concepts": [ { "name": "...", "description": "...", "keywords": ["..."], "objectives": ["..."],
    "subtopics": ["..."] } ] } ], "confidence": 0.0 }`;

const PLAN_SYSTEM = `You are LearnMate's adaptive teaching planner. Produce a short teaching sequence for the
concept given the student's profile and gaps.

Return ONLY JSON:
{ "approach": "string", "sequence": [ { "step": 1, "goal": "...", "technique": "..." } ],
  "difficultyTarget": "easy|medium|hard", "scaffolding": "guided|supported|independent", "watchFor": ["..."] }`;

const MODERATION_SYSTEM = `You are LearnMate's content safety filter for a school-age learning platform.
Return ONLY JSON: { "flagged": false, "category": "none|self_harm_or_illegal|abuse|sexual|violence|academic_dishonesty",
"action": "allow|escalate_and_block", "reason": "...", "confidence": 0.0 }`;

const EXERCISE_SYSTEM = `You are LearnMate's practical exercise generator for a programming classroom.
Create one task with hidden tests that verifies conceptual understanding, not just output.

Return ONLY JSON:
{ "title": "...", "language": "javascript|python|java|sql", "prompt": "...", "starterCode": "...",
  "tests": [{ "id": "t1", "name": "...", "args": ["..."], "expected": "...", "hidden": false }],
  "rubric": [{ "id": "r1", "criterion": "...", "weight": 0.5 }], "difficulty": "easy|medium|hard" }`;

function contextBlock({ concept, classmates, syllabusContext, retrieved, profile, openGaps, history, mode, scaffoldingLevel, adaptiveLevel }) {
  const parts = [];
  if (concept) {
    parts.push(
      `SELECTED SYLLABUS CONCEPT\n- Subject: ${concept.subjectName || ''}\n- Unit: ${concept.unitName || ''}\n- Concept: ${concept.name}\n- Description: ${concept.description || '(none provided)'}\n- Objectives: ${(concept.objectives || []).join('; ') || '(none listed)'}\n- Keywords: ${(concept.keywords || []).join(', ') || '(none)'}\n- Subtopics: ${(concept.subtopics || []).join('; ') || '(none)'}`,
    );
  }
  if (mode) parts.push(`LEARNING MODE: ${mode}`);
  if (syllabusContext) parts.push(`SYLLABUS CONTEXT (primary teaching reference)\n${syllabusContext}`);
  if (retrieved?.length) {
    parts.push(
      `RETRIEVED CLASSROOM MATERIAL (ranked)\n${retrieved
        .slice(0, 4)
        .map((r, i) => `[${i + 1}] ${r.documentName || 'material'}${r.page ? ` p.${r.page}` : ''}: ${String(r.text).slice(0, 600)}`)
        .join('\n')}`,
    );
  }
  if (profile) {
    parts.push(
      `STUDENT LEARNING PROFILE (this classroom only)\n- Knowledge level: ${adaptiveLevel || profile.knowledgeLevel}\n- Learning speed: ${profile.learningSpeed?.label || 'unknown'} (${profile.learningSpeed?.score ?? 0})\n- Independence score: ${profile.independence?.score ?? 0}/100\n- Hints per session: ${profile.independence?.hintsPerSession ?? 0}\n- Sessions: ${profile.stats?.sessions ?? 0}\n- Mastery in this concept: ${profile.conceptMastery ?? 'not assessed'}`,
    );
  }
  if (openGaps?.length) {
    parts.push(
      `KNOWN GAPS / MISCONCEPTIONS (evidence-backed)\n${openGaps
        .map((g) => `- [${g.category} | ${g.severity} | conf ${g.confidence}] ${g.description} (seen ${g.occurrences}x)`)
        .join('\n')}`,
    );
  }
  if (scaffoldingLevel) parts.push(`TARGET SCAFFOLDING LEVEL: ${scaffoldingLevel}`);
  if (history?.length) {
    parts.push(
      `RECENT EXCHANGE (oldest first)\n${history
        .slice(-8)
        .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${String(m.content).slice(0, 700)}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

export const prompts = {
  tutor: ({ context, studentMessage, isCorrection, nextPrompt }) => [
    { role: 'system', content: TUTOR_SYSTEM },
    { role: 'system', content: contextBlock(context) },
    ...(isCorrection ? [{ role: 'system', content: 'IMPORTANT: The student just answered incorrectly. Do not reveal the answer. Diagnose the thinking that produced the wrong answer and give a nudge-level hint only.' }] : []),
    ...(nextPrompt ? [{ role: 'system', content: `Your previous next-step question was: ${nextPrompt}` }] : []),
    { role: 'user', content: studentMessage },
  ],

  gaps: ({ context, evidence }) => [
    { role: 'system', content: GAP_SYSTEM },
    { role: 'system', content: contextBlock(context) },
    { role: 'user', content: `EVIDENCE TO ANALYSE\n${evidence}` },
  ],

  assessment: ({ context, kind, count }) => [
    { role: 'system', content: ASSESSMENT_SYSTEM },
    { role: 'system', content: contextBlock(context) },
    { role: 'user', content: `Generate a ${kind} with ${count} questions.` },
  ],

  assessmentAnalysis: ({ concept, gradedAnswers }) => [
    { role: 'system', content: ASSESSMENT_ANALYSIS_SYSTEM },
    { role: 'user', content: `CONCEPT: ${concept?.name || 'General'}\nGRADED ANSWERS:\n${JSON.stringify(gradedAnswers, null, 2)}` },
  ],

  code: ({ exercise, code, runSummary }) => [
    { role: 'system', content: CODE_SYSTEM },
    { role: 'user', content: `EXERCISE\nTitle: ${exercise.title}\nPrompt: ${exercise.prompt}\nLanguage: ${exercise.language}\nRubric: ${JSON.stringify(exercise.rubric || [])}\n\nSANDBOX RESULTS\n${runSummary}\n\nSTUDENT CODE\n\`\`\`${exercise.language}\n${code}\n\`\`\`` },
  ],

  parse: ({ text, subject }) => [
    { role: 'system', content: PARSE_SYSTEM },
    { role: 'user', content: `SUBJECT HINT: ${subject || 'infer'}\n\nDOCUMENT TEXT\n${text.slice(0, 22000)}` },
  ],

  plan: ({ context }) => [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'system', content: contextBlock(context) },
    { role: 'user', content: 'Produce the teaching plan.' },
  ],

  moderation: ({ text }) => [
    { role: 'system', content: MODERATION_SYSTEM },
    { role: 'user', content: `TEXT TO SCREEN\n${text}` },
  ],

  exercise: ({ concept, language, difficulty }) => [
    { role: 'system', content: EXERCISE_SYSTEM },
    { role: 'user', content: `CONCEPT: ${concept.name}\nDESCRIPTION: ${concept.description || ''}\nOBJECTIVES: ${(concept.objectives || []).join('; ')}\nLANGUAGE: ${language}\nDIFFICULTY: ${difficulty || 'medium'}` },
  ],
};

export default prompts;
