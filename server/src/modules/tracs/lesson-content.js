/**
 * FROM A TUTORIAL TO UI COMPONENTS
 * ================================
 *
 * `tutorials.js` holds the teaching; this turns one into the document the
 * renderer draws. Keeping the two apart matters: the prose and code can be
 * edited and read as writing, without wading through component shapes.
 *
 * The shape a learner sees, for a concept we have a tutorial for:
 *
 *   1. a `learning` block — what it is, why it exists, the syntax, and one
 *      section per worked example (code fence + what it prints + why)
 *   2. the traps, in their own block, because "here is what goes wrong" is a
 *      different kind of reading from "here is how it works"
 *   3. a closing block — how to check yourself, and the key points
 *
 * For a concept we have no tutorial for, `genericLesson` still produces
 * something worth reading: what the name means, the questions to ask of it, a
 * worked example to trace, and how to check the answer. It is shorter than a
 * curated tutorial and built from the concept's own keywords, but it is a
 * structured walk-through rather than the single sentence this used to be.
 */

import { findTutorial, tutorialLanguage } from './tutorials.js';

const fence = (code, language = 'python') => `\`\`\`${language}\n${code}\n\`\`\``;

/** A worked example as one teachable section. */
function exampleSection(example, language) {
  const parts = [fence(example.code, language)];
  if (example.output) {
    parts.push(`**Output**\n\n${fence(example.output, 'text')}`);
  }
  if (example.why) parts.push(`**Why** — ${example.why}`);
  return { heading: example.title, body: parts.join('\n\n') };
}

/**
 * The components for a concept with a curated tutorial.
 *
 * Returns `null` when there is no tutorial, so the caller can fall back without
 * having to know how matching works.
 */
export function tutorialLesson(topic, { language = 'python' } = {}) {
  const tutorial = findTutorial(topic.title, topic.summary);
  if (!tutorial) return null;

  const lang = language || tutorialLanguage(`${topic.title} ${topic.summary || ''}`);

  const sections = [
    { heading: 'What it is', body: tutorial.what },
    { heading: 'Why it exists', body: tutorial.why },
    { heading: 'The syntax', body: fence(tutorial.syntax, lang) },
    ...tutorial.examples.map((example) => exampleSection(example, lang)),
  ];

  const components = [
    {
      id: 'learn_local_tutorial',
      type: 'learning',
      title: topic.title,
      objectives: [
        `Explain ${tutorial.label.toLowerCase()} in your own words`,
        'Read a line of code and say what it will do',
        'Spot the mistakes that break it',
      ],
      sections,
      key_points: tutorial.examples.map((e) => e.title),
    },
    {
      id: 'learn_local_traps',
      type: 'learning',
      title: 'Where it goes wrong',
      sections: tutorial.traps.map((trap) => ({
        heading: trap.title,
        body: [
          fence(trap.code, lang),
          trap.output ? `**Output**\n\n${fence(trap.output, 'text')}` : '',
          trap.why,
        ].filter(Boolean).join('\n\n'),
      })),
      key_points: ['Read the error before changing the code — it usually names the cause.'],
    },
    {
      id: 'learn_local_check',
      type: 'learning',
      title: 'Check yourself',
      sections: [{ heading: 'A way to test that you have it', body: tutorial.check }],
    },
  ];

  return components;
}

/**
 * The lesson for a concept with no curated tutorial.
 *
 * Built from the concept's own name and keywords, this is the structure a
 * person would use to teach themselves an unfamiliar idea: define it, place it
 * among the things around it, trace one small case, then state what would show
 * you had understood. It cannot supply domain facts it does not have, so it
 * does the next best thing — it turns "learn this topic" into a sequence of
 * concrete questions and one worked exercise.
 */
export function genericLesson(topic, { language = 'python' } = {}) {
  const title = String(topic.title || 'This concept').trim();
  const keywords = (topic.keywords || []).filter(Boolean).slice(0, 6);
  const summary = String(topic.summary || '').trim();
  const lang = language || 'python';

  const parts = [];
  if (summary) parts.push(summary);

  const structure = keywords.length
    ? `It is usually taught in terms of ${keywords.map((k) => `**${k}**`).join(', ')}. Those are the pieces to be able to explain separately before you can explain how ${title.toLowerCase()} behaves as a whole.`
    : `Break it into the pieces its name promises, and be able to say what each one does on its own.`;

  const example = keywords.length >= 2
    ? `x = ${2}          # a case to trace\n# what happens to x when ${keywords[0].toLowerCase()} is involved?\nprint(x)`
    : `value = 0          # pick a real case, not a placeholder\nprint(value)`;

  const components = [
    {
      id: 'learn_local_concept',
      type: 'learning',
      title,
      objectives: [
        `Describe ${title.toLowerCase()} without using its name`,
        'Give one example where it is the right tool',
        'Name one mistake it causes',
      ],
      sections: [
        { heading: 'What it is', body: parts.join('\n\n') || `**${title}** is the idea your syllabus is pointing at next. The name is the whole definition you have been given, so it has to be unpacked by hand.` },
        { heading: 'What the name promises', body: structure },
        {
          heading: 'A case to trace',
          body: [
            'Pick the smallest input you can imagine — two values, one loop, one call — and write down what each line does before running it.',
            fence(example, lang),
          ].join('\n\n'),
        },
        {
          heading: 'How to know you have it',
          body: `You have understood ${title.toLowerCase()} when you can predict the result of a small example before running it, and explain **why** when the prediction was wrong. Reading a definition until it feels familiar is not the same thing — prediction is the test.`,
        },
      ],
      key_points: keywords.length ? keywords.map((k) => `Be able to explain ${k} on its own.`) : [],
    },
  ];

  return components;
}
