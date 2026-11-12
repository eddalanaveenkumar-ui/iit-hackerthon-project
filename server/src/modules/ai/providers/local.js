import crypto from 'node:crypto';
import { AIProviderAdapter } from './base.js';
import { estimateTokens } from './nvidia.js';

/**
 * Deterministic on-device adapter.
 *
 * Purpose: when no NVIDIA key is present (demo, CI, offline review) every AI
 * workflow must still produce genuine, evidence-linked output rather than a
 * hard-coded "AI unavailable" placeholder. It implements the same adapter
 * contract as NvidiaProvider, so switching providers changes nothing upstream.
 *
 * It is NOT a language model: it performs deterministic analysis over the
 * structured context the orchestrator supplies (concept outline, retrieved
 * syllabus chunks, student evidence, code text) and emits the same JSON shapes
 * the remote models are asked for.
 */

const STOPWORDS = new Set(
  ('a an the and or but if then than that this these those is are was were be been being to of in on for with as by at from it its into about over under '
    + 'you your yours i my we our they them he she his her not no do does did done can could should would will just also more most some any all very much many '
    + 'how what why when where which who whom whose there here use used using make makes made').split(' '),
);

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#._\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Deterministic hashed bag-of-words embedding (256 dims, L2 normalised). */
export function hashedEmbedding(text, dims = 256) {
  const vec = new Array(dims).fill(0);
  for (const tok of tokenize(text)) {
    const h = crypto.createHash('md5').update(tok).digest();
    const idx = ((h[0] << 8) | h[1]) % dims;
    const sign = h[2] % 2 === 0 ? 1 : -1;
    vec[idx] += sign * (1 + Math.log(1 + tok.length));
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

export function cosine(a, b) {
  if (!a?.length || !b?.length) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const HEDGES = ['i think', 'maybe', 'not sure', 'i guess', 'probably', 'kind of', 'sort of', 'i dont know', "i don't know", 'no idea', 'confused', 'never learned'];
const CONFUSION = ['confused', 'stuck', 'dont understand', "don't understand", 'not clear', 'lost', 'hard to', 'difficult to understand'];
const DECLARED_UNDERSTANDING = ['i understand', 'got it', 'makes sense', 'i know this', 'clear now'];

export class LocalProvider extends AIProviderAdapter {
  constructor() {
    super('local');
  }

  async chat({ model, messages, temperature = 0.4, meta = {} }) {
    const started = Date.now();
    const promptText = messages.map((m) => m.content).join('\n');
    const payload = this.#build(meta, promptText);
    const text = payload === null ? this.#narrative(meta, promptText) : JSON.stringify(payload);
    const simulatedLatency = 120 + Math.min(680, Math.round(text.length / 12));
    await new Promise((r) => setTimeout(r, simulatedLatency));
    return {
      text,
      finishReason: 'stop',
      usage: { inputTokens: estimateTokens(promptText), outputTokens: estimateTokens(text) },
      latencyMs: Date.now() - started,
      model: `${model} (local-analyser)`,
      provider: 'local',
      simulated: true,
    };
  }

  async embed({ model, input }) {
    const list = Array.isArray(input) ? input : [input];
    const started = Date.now();
    return {
      vectors: list.map((t) => hashedEmbedding(t)),
      usage: { inputTokens: list.reduce((a, t) => a + estimateTokens(t), 0), outputTokens: 0 },
      latencyMs: Date.now() - started,
      model: `${model} (local-hashing)`,
    };
  }

  async rerank({ model, query, documents }) {
    const q = new Set(tokenize(query));
    const started = Date.now();
    const results = documents.map((doc, index) => {
      const toks = tokenize(doc);
      if (!toks.length) return { index, score: 0 };
      const hit = toks.filter((t) => q.has(t)).length;
      return { index, score: Number((hit / Math.sqrt(toks.length + 1)).toFixed(4)) };
    });
    return {
      results: results.sort((a, b) => b.score - a.score),
      usage: { inputTokens: estimateTokens(query + documents.join(' ')), outputTokens: 0 },
      latencyMs: Date.now() - started,
      model: `${model} (local-overlap)`,
    };
  }

  async listModels() {
    return [];
  }

  async healthCheck() {
    return { ok: true, latencyMs: 1, detail: 'Local deterministic analyser active (no external provider configured)' };
  }

  // ---------------------------------------------------------------------------
  // Task-specific structured output
  // ---------------------------------------------------------------------------
  #build(meta = {}, promptText) {
    switch (meta.task) {
      case 'tutor_reply':
        return this.#tutorReply(meta);
      case 'gap_analysis':
        return this.#gapAnalysis(meta, promptText);
      case 'assessment_generation':
        return this.#assessment(meta);
      case 'assessment_analysis':
        return this.#assessmentAnalysis(meta);
      case 'code_analysis':
        return this.#codeAnalysis(meta);
      case 'syllabus_parse':
        return this.#syllabusParse(meta);
      case 'teaching_plan':
        return this.#teachingPlan(meta);
      case 'moderation':
        return this.#moderation(meta, promptText);
      case 'exercise_generation':
        return this.#exercise(meta);
      default:
        return null;
    }
  }

  #narrative(meta, promptText) {
    const c = meta.concept || {};
    return [
      `Let's work through ${c.name || 'this concept'} step by step.`,
      '',
      c.description ? `Core idea: ${c.description}` : 'We will start from the core idea and build up.',
      '',
      '1. Restate the goal in your own words.',
      '2. Identify the inputs and the expected result.',
      '3. Work one small example, then generalise.',
      '',
      `Your message: "${String(promptText).slice(0, 180)}"`,
      '',
      'What is your first step here? Take a guess — being wrong is useful evidence for me.',
    ].join('\n');
  }

  #tutorReply(meta) {
    const c = meta.concept || {};
    const profile = meta.profile || {};
    const gaps = (meta.openGaps || []).slice(0, 3);
    const gap = gaps[0];
    const level = meta.adaptiveLevel || profile.knowledgeLevel || 'developing';
    const scaffolding = meta.scaffoldingLevel || 'supported';
    const isRetry = Boolean(meta.isCorrection);
    const objectives = c.objectives?.length ? c.objectives : (c.keywords || []).map((k) => `Use ${k} correctly`);
    const citations = (meta.retrieved || []).slice(0, 3).map((r) => r.documentName || 'syllabus');

    const teaching = [];
    teaching.push(
      level === 'beginner'
        ? `${c.name} looks intimidating, so let's anchor it to something familiar first.`
        : level === 'advanced'
          ? `You already have the basics of ${c.name}; let's push on the edge cases.`
          : `Let's tighten your grasp of ${c.name}.`,
    );
    teaching.push('');
    teaching.push(`**Core idea.** ${c.description || `The purpose of ${c.name} is to ${objectives[0]?.toLowerCase() || 'solve the problem it was designed for'}.`}`);
    teaching.push('');
    teaching.push('**Worked example.**');
    teaching.push(`1. Start with a concrete case of ${c.name}.`);
    teaching.push(`2. Apply ${c.keywords?.[0] || 'the main rule'} explicitly, one step at a time.`);
    teaching.push('3. Check the result against the expected behaviour, not against intuition.');
    teaching.push('');
    if (isRetry && gap) {
      teaching.push('**Where your last attempt slipped.**');
      teaching.push(`You treated "${gap.description}" as if it were already handled. It isn't yet — that is the same trap as before.`);
      teaching.push('');
    }
    teaching.push(`**Your next step.** ${meta.nextPrompt || `Explain in one sentence why step 2 is necessary for ${c.name}.`}`);

    const hints = [
      { level: 'nudge', text: `Re-read the definition of ${c.keywords?.[0] || c.name} and check whether your answer uses it exactly.` },
      { level: 'structure', text: `Break the task into: input → transformation → output. Which part can you not name yet?` },
      { level: 'partial', text: `Here is the shape of the solution, without the answer: ${objectives[0] || 'identify the rule'}, then apply it to one value.` },
    ];

    const assessmentRecommendation = meta.recommendAssessment
      ? {
          recommend: true,
          kind: 'topic_quiz',
          reason: meta.recommendAssessmentReason
            || `You have hit the same misunderstanding on ${c.name} ${gap?.occurrences || 3} times; a short quiz will give us clean evidence.`,
        }
      : { recommend: false, reason: '' };

    return {
      reply: teaching.join('\n'),
      scaffoldingLevel: scaffolding === 'independent' ? 'independent' : scaffolding,
      hints,
      citations,
      misconceptionObserved: gap ? gap.description : null,
      nextPrompt: meta.nextPrompt || `Explain ${c.name} in your own words, then give one example that would break a naive implementation.`,
      assessmentRecommendation,
      difficultyShift: level === 'advanced' ? 'harder' : level === 'beginner' ? 'simpler' : 'steady',
      followUpQuestion: `Which part of ${c.name} would you still get wrong if you had no notes?`,
    };
  }

  #gapAnalysis(meta, promptText) {
    const c = meta.concept || {};
    const signal = meta.signal || {};
    // Analyse the student's own evidence, never the system prompt text.
    const source = meta.evidenceText !== undefined && meta.evidenceText !== null ? meta.evidenceText : promptText;
    const text = String(source || '').toLowerCase();
    const findings = [];
    const keywords = c.keywords || [];
    const mentioned = keywords.filter((k) => text.includes(String(k).toLowerCase()));
    const missingKeywords = keywords.filter((k) => !mentioned.includes(k));
    const hedged = HEDGES.some((h) => text.includes(h));
    const confused = CONFUSION.some((h) => text.includes(h));
    const declared = DECLARED_UNDERSTANDING.some((h) => text.includes(h));
    const length = tokenize(source).length;

    if (signal.assessmentMiss || signal.wrongAnswer) {
      findings.push({
        category: 'knowledge_gap',
        description: `${c.name}: core rule applied incorrectly in an assessed answer.`,
        severity: 'high',
        confidence: 0.86,
        topicHint: c.name,
      });
    }
    if (missingKeywords.length && length > 6) {
      findings.push({
        category: 'misconception',
        description: `Explanation of ${c.name} omits ${missingKeywords.slice(0, 2).join(' and ')}, suggesting the underlying model is incomplete rather than a casual slip.`,
        severity: missingKeywords.length > 1 ? 'medium' : 'low',
        confidence: 0.62,
      });
    }
    if (hedged) {
      findings.push({
        category: 'knowledge_gap',
        description: `Low-confidence language while working on ${c.name} — the student is guessing at the rule instead of deriving it.`,
        severity: 'medium',
        confidence: 0.7,
      });
    }
    if (confused) {
      findings.push({
        category: 'practical_difficulty',
        description: `Cannot translate ${c.name} from definition into an implementation step.`,
        severity: 'medium',
        confidence: 0.68,
      });
    }
    if (declared && length < 12) {
      // Explicitly do NOT accept self-report as understanding.
      findings.push({
        category: 'knowledge_gap',
        description: `Student declared understanding of ${c.name} with no supporting explanation — self-report is not evidence.`,
        severity: 'low',
        confidence: 0.55,
        note: 'self_report_only',
      });
    }
    if (signal.repeatedMistake) {
      findings.push({
        category: 'repeated_error',
        description: `Same incorrect approach to ${c.name} repeated across attempts.`,
        severity: 'high',
        confidence: 0.9,
      });
    }
    if (meta.retrieved?.length && length > 25) {
      const overlap = cosine(hashedEmbedding(source), meta.retrieved[0].embedding || []);
      if (overlap > 0.72) {
        findings.push({
          category: 'knowledge_gap',
          description: `Answer closely mirrors the syllabus wording for ${c.name}; comprehension vs recall cannot be separated from text alone.`,
          severity: 'low',
          confidence: 0.5,
          note: 'possible_copying',
        });
      }
    }

    const masteryDelta =
      (signal.correct ? 6 : 0) - (signal.wrongAnswer ? 6 : 0) - (hedged ? 2 : 0) + (signal.independent ? 4 : 0);

    return {
      findings,
      masteryDelta,
      evidenceStrength: findings.length ? Math.max(...findings.map((f) => f.confidence)) : 0.2,
      independenceSignal: signal.independent ? 'strong' : signal.hintUsed ? 'supported' : 'unknown',
      summary: findings.length
        ? `${findings.length} evidence-backed issue(s) on ${c.name}.`
        : `No contradiction found for ${c.name}; keep collecting evidence.`,
    };
  }

  #assessment(meta) {
    const c = meta.concept || {};
    const kind = meta.kind || 'topic_quiz';
    const objectives = c.objectives?.length ? c.objectives : [`Explain ${c.name}`, `Apply ${c.name}`, `Spot a wrong use of ${c.name}`];
    const keywords = c.keywords?.length ? c.keywords : ['definition', 'application', 'edge case'];
    const gaps = (meta.openGaps || []).slice(0, 3);
    const count = kind === 'unit_test' ? 8 : kind === 'revision' ? 6 : 5;
    const questions = [];

    for (let i = 0; i < count; i += 1) {
      const objective = objectives[i % objectives.length];
      const kw = keywords[i % keywords.length];
      if (i % 3 === 2) {
        questions.push({
          id: `q${i + 1}`,
          type: 'short_answer',
          prompt: `In your own words, ${objective.toLowerCase()}. Give one example.`,
          rubric: `Mentions ${kw}; gives a concrete example; no contradictions.`,
          conceptId: meta.conceptId,
          difficulty: i < 2 ? 'easy' : i < 4 ? 'medium' : 'hard',
          explanation: `A strong answer defines ${kw} and anchors it in an example.`,
        });
      } else {
        const correct = `${objective} by applying ${kw} deliberately`;
        const distractors = [
          `Skip ${kw} and rely on trial and error`,
          `Use ${kw} only when the input is empty`,
          `Apply ${kw} after the result has been produced`,
        ];
        const options = [correct, ...distractors];
        const shuffled = options
          .map((o, idx) => ({ o, k: (idx * 7919 + i * 104729) % 101 }))
          .sort((a, b) => a.k - b.k)
          .map((x) => x.o);
        questions.push({
          id: `q${i + 1}`,
          type: 'multiple_choice',
          prompt: `Which statement about ${c.name} is correct? (${objective})`,
          options: shuffled,
          correctIndex: shuffled.indexOf(correct),
          conceptId: meta.conceptId,
          difficulty: i < 2 ? 'easy' : i < 4 ? 'medium' : 'hard',
          explanation: `${kw} must be applied deliberately — the other options misplace or skip it.`,
        });
      }
    }

    if (gaps.length) {
      questions[0].prompt = `Targeting your earlier gap — ${gaps[0].description} Which approach avoids it?`;
      questions[0].type = 'multiple_choice';
      questions[0].options = questions[0].options || ['Applying the rule before the result', 'Verifying the rule at the point of use', 'Ignoring the rule'];
    }

    return {
      title: `${kind === 'unit_test' ? 'Unit Test' : kind === 'revision' ? 'Revision Check' : 'Topic Quiz'} — ${c.name || 'Concept'}`,
      kind,
      questions,
      maxScore: questions.length,
      durationMinutes: kind === 'unit_test' ? 25 : 12,
      rationale: gaps.length
        ? `Focused on ${gaps[0].description}`
        : `Covers the syllabus objectives for ${c.name}.`,
    };
  }

  #assessmentAnalysis(meta) {
    const answers = meta.answers || [];
    const correct = answers.filter((a) => a.correct).length;
    const pct = answers.length ? Math.round((correct / answers.length) * 100) : 0;
    const wrong = answers.filter((a) => !a.correct);
    return {
      strengths: correct ? [`Answered ${correct}/${answers.length} correctly.`] : ['Attempted the assessment honestly.'],
      gaps: wrong.length
        ? wrong.slice(0, 3).map((a) => `Question ${a.questionId}: ${a.analysis || 'incorrect reasoning'}`)
        : [],
      misconceptions: wrong.length
        ? wrong.slice(0, 2).map((a) => a.misconception || `Misapplied the rule on question ${a.questionId}.`)
        : [],
      nextSteps: pct >= 80
          ? ['Move to the next concept and try a harder practical task.']
          : ['Revisit the worked example, then retry the same assessment type.'],
      masteryPercentage: pct,
      recommendedLevel: pct >= 85 ? 'advanced' : pct >= 65 ? 'proficient' : pct >= 40 ? 'developing' : 'beginner',
    };
  }

  #codeAnalysis(meta) {
    const code = String(meta.code || '');
    const exercise = meta.exercise || {};
    const language = exercise.language || 'javascript';
    const syntaxErrors = [];
    const logicWarnings = [];
    const conceptsUnderstood = [];

    // Structural checks that hold for any language.
    const open = (code.match(/[{([]/g) || []).length;
    const close = (code.match(/[})\]]/g) || []).length;
    if (open !== close) syntaxErrors.push(`Unbalanced brackets (${open} opening vs ${close} closing).`);

    if (language === 'javascript') {
      if (/\bvar\s+\w+/.test(code)) logicWarnings.push('Uses `var`; block scoping with let/const avoids accidental leaks.');
      if (/==(?!=)/.test(code)) logicWarnings.push('Uses loose equality (==); type coercion can silently change results.');
      if (/for\s*\(/.test(code) && /\.length/.test(code) && !/<\s*\w+\.length/.test(code)) {
        logicWarnings.push('Loop bound may not be tied to the collection length (off-by-one risk).');
      }
      if (/function\s+\w+\s*\([^)]*\)\s*{[^}]*\breturn\b/.test(code) === false && /return/.test(code) === false) {
        logicWarnings.push('No return statement found; the function may always yield undefined.');
      }
      try {
        // eslint-disable-next-line no-new-func
        new Function(code);
      } catch (err) {
        syntaxErrors.push(`Syntax error: ${err.message}`);
      }
      if (/console\.log\(/.test(code) && !/return/.test(code)) {
        logicWarnings.push('Logs the result instead of returning it — tests receive undefined.');
      }
      if (/=>/.test(code) || /\bfunction\b/.test(code)) conceptsUnderstood.push('function definition');
      if (/\bfor\b|\bwhile\b|\.map\(|\.reduce\(|\.filter\(/.test(code)) conceptsUnderstood.push('iteration');
      if (/\bif\b|\bswitch\b|\?\s*/.test(code)) conceptsUnderstood.push('conditional flow');
    } else if (language === 'python') {
      if (/^\s*print\s*\(/m.test(code) && !/^\s*return\b/m.test(code)) {
        logicWarnings.push('Prints instead of returning a value.');
      }
      if (/\brange\(len\(/.test(code) === false && /for\s+\w+\s+in\s+/.test(code) === false) {
        logicWarnings.push('No iteration detected although the task needs traversal.');
      }
      if (/==\s*True|==\s*False/.test(code)) logicWarnings.push('Comparisons to True/False are redundant.');
      if (/^\s*\t/m.test(code) && /^    /m.test(code)) syntaxErrors.push('Mixed tabs and spaces.');
    } else if (language === 'java') {
      if (!/class\s+\w+/.test(code)) syntaxErrors.push('No class declaration found.');
      if (!/public\s+static\s+void\s+main/.test(code) && !/static\s+\w+/.test(code)) {
        logicWarnings.push('No static method detected for the runner to invoke.');
      }
      if (/==/.test(code) && /String/.test(code)) logicWarnings.push('Uses == to compare Strings; use equals().');
    } else if (language === 'sql') {
      if (!/select/i.test(code)) syntaxErrors.push('Query must contain SELECT.');
      if (/select\s+\*/i.test(code)) logicWarnings.push('SELECT * returns unneeded columns; name them explicitly.');
    }

    const solution = String(exercise.solutionHint || exercise.starterCode || '');
    const similarity = solution
      ? Number((cosine(hashedEmbedding(code), hashedEmbedding(solution)) * 100).toFixed(1))
      : 0;
    const copyPasteSuspected = similarity > 88 && code.length > 120;

    return {
      syntaxErrors,
      logicWarnings,
      conceptsUnderstood,
      similarityToSolution: similarity,
      copyPasteSuspected,
      understandingVerdict: copyPasteSuspected
        ? 'Code matches the reference solution too closely to demonstrate understanding.'
        : syntaxErrors.length
          ? 'Blocked by syntax errors; the underlying idea cannot be verified yet.'
          : logicWarnings.length
            ? 'Runs, but the implementation shows gaps in the underlying rule.'
            : 'Implementation is consistent with understanding the concept.',
      progressiveHints: [
        syntaxErrors.length ? `Fix this first: ${syntaxErrors[0]}` : 'Re-read the requirement and confirm each branch returns a value.',
        logicWarnings.length ? `Check: ${logicWarnings[0]}` : 'Trace the function with an empty input.',
        'Write one test of your own that would fail if you swapped the comparison operator.',
      ],
      difficulty: syntaxErrors.length ? 'needs_support' : logicWarnings.length ? 'developing' : 'independent',
    };
  }

  #syllabusParse(meta) {
    const text = String(meta.text || '').slice(0, 6000);
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const units = [];
    let current = null;
    for (const line of lines) {
      const unitMatch = line.match(/^(?:unit|module|chapter)\s*[-–:.]?\s*(\d+|[ivxlcdm]+)\b[.:\-–]?\s*(.*)$/i);
      if (unitMatch && line.length < 160) {
        current = { name: `${/^\d+$/.test(unitMatch[1]) ? `Unit ${unitMatch[1]}` : `Unit ${unitMatch[1].toUpperCase()}`}${unitMatch[2] ? ` – ${unitMatch[2]}` : ''}`, concepts: [] };
        units.push(current);
        continue;
      }
      const conceptMatch = line.match(/^(\d+(?:\.\d+)+)\s*[-–:.]?\s*(.{3,120})$/);
      if (conceptMatch && current) {
        current.concepts.push({ name: conceptMatch[2].trim(), description: '' });
      }
    }
    if (!units.length) {
      units.push({
        name: 'Unit 1 – Extracted Content',
        concepts: lines.slice(0, 8).map((l) => ({ name: l.slice(0, 90), description: '' })),
      });
    }
    return {
      subject: meta.subject || 'Extracted Syllabus',
      units: units.slice(0, 12).map((u) => ({
        name: u.name,
        description: '',
        concepts: u.concepts.slice(0, 10).map((c) => ({ ...c, keywords: tokenize(c.name).slice(0, 4), objectives: [`Explain ${c.name}`] })),
      })),
      confidence: lines.length > 12 ? 0.78 : 0.55,
    };
  }

  #teachingPlan(meta) {
    const c = meta.concept || {};
    const gaps = meta.openGaps || [];
    return {
      approach: gaps.length ? 'remediate_then_extend' : 'bloom_progression',
      sequence: [
        { step: 1, goal: `Diagnose what the student already believes about ${c.name}`, technique: 'elicit prior model' },
        { step: 2, goal: gaps[0]?.description || `Establish the core rule of ${c.name}`, technique: 'targeted counterexample' },
        { step: 3, goal: 'Independent application on a small case', technique: 'faded worked example' },
        { step: 4, goal: 'Transfer to an unfamiliar case', technique: 'near-transfer task' },
      ],
      difficultyTarget: meta.level === 'advanced' ? 'hard' : meta.level === 'beginner' ? 'easy' : 'medium',
      scaffolding: meta.level === 'advanced' ? 'independent' : 'supported',
      watchFor: gaps.slice(0, 3).map((g) => g.description),
    };
  }

  #moderation(meta, promptText) {
    const text = String(promptText || '').toLowerCase();
    const blocked = ['kill myself', 'suicide', 'how to make a bomb', 'credit card dump'];
    const hit = blocked.find((b) => text.includes(b));
    return {
      flagged: Boolean(hit),
      category: hit ? 'self_harm_or_illegal' : 'none',
      action: hit ? 'escalate_and_block' : 'allow',
      reason: hit ? `Matched safety pattern: ${hit}` : 'No safety issue detected.',
      confidence: hit ? 0.95 : 0.9,
    };
  }

  #exercise(meta) {
    const c = meta.concept || {};
    const language = meta.language || 'javascript';
    return {
      title: `Practice: ${c.name || 'Concept'}`,
      language,
      prompt: `Implement a function that demonstrates ${c.name}. Handle the empty input and one invalid input.`,
      starterCode:
        language === 'python'
          ? 'def solve(values):\n    # TODO: implement\n    pass\n'
          : language === 'java'
            ? 'public class Solution {\n    public static int solve(int[] values) {\n        // TODO\n        return 0;\n    }\n}\n'
            : language === 'sql'
              ? '-- Write a query that returns the required rows\nSELECT\n'
              : 'function solve(values) {\n  // TODO: implement\n}\n\nmodule.exports = { solve };\n',
      tests: [
        { id: 't1', name: 'empty input', args: ['[]'], expected: 'handles gracefully', hidden: false },
        { id: 't2', name: 'typical input', args: ['[1,2,3]'], expected: 'correct result', hidden: false },
        { id: 't3', name: 'invalid input', args: ["['a']"], expected: 'rejects clearly', hidden: true },
      ],
      rubric: [
        { id: 'r1', criterion: 'Correct result on typical input', weight: 0.5 },
        { id: 'r2', criterion: 'Edge cases handled', weight: 0.3 },
        { id: 'r3', criterion: 'Clear naming and structure', weight: 0.2 },
      ],
      difficulty: 'medium',
    };
  }
}
