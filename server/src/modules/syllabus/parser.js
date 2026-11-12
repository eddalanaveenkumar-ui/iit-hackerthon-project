import { runJsonTask } from '../ai/orchestrator.js';
import { prompts } from '../ai/prompts.js';
import { slugify } from '../../utils/validation.js';

/**
 * Turns raw document text into a structured syllabus:
 * Subject -> Units -> Concepts -> Subtopics.
 *
 * Uses the configured document-parsing model route, then normalises and
 * validates the result so a malformed model response can never corrupt the
 * syllabus tree.
 */

function normalise(parsed, fallbackSubject) {
  const raw = parsed && typeof parsed === 'object' ? parsed : {};
  let units = Array.isArray(raw.units) ? raw.units : [];
  if (!units.length && Array.isArray(raw.subjects)) {
    units = raw.subjects.flatMap((s) => (s.units || []).map((u) => ({ ...u, subjectHint: s.name })));
  }
  const cleanedUnits = units
    .filter((u) => u && (u.name || u.title))
    .slice(0, 30)
    .map((u, idx) => {
      const concepts = (Array.isArray(u.concepts) ? u.concepts : [])
        .filter((c) => c && (c.name || c.title))
        .slice(0, 40)
        .map((c) => ({
          name: String(c.name || c.title).trim().slice(0, 160),
          description: String(c.description || '').trim().slice(0, 1200),
          objectives: (Array.isArray(c.objectives) ? c.objectives : []).map((o) => String(o).slice(0, 300)).slice(0, 10),
          keywords: (Array.isArray(c.keywords) ? c.keywords : []).map((k) => String(k).slice(0, 60)).slice(0, 15),
          estimatedMinutes: Number(c.estimatedMinutes) > 0 ? Math.min(240, Number(c.estimatedMinutes)) : 25,
          subtopics: (Array.isArray(c.subtopics) ? c.subtopics : [])
            .map((s) => (typeof s === 'string' ? { name: s } : s))
            .filter((s) => s && s.name)
            .slice(0, 20)
            .map((s) => ({ name: String(s.name).slice(0, 160), description: String(s.description || '').slice(0, 600) })),
        }));
      return {
        name: String(u.name || u.title).trim().slice(0, 160),
        description: String(u.description || '').trim().slice(0, 800),
        estimatedMinutes: Number(u.estimatedMinutes) > 0 ? Math.min(1200, Number(u.estimatedMinutes)) : 60,
        concepts: concepts.length
          ? concepts
          : [{ name: `${String(u.name || u.title).trim()} overview`, description: '', objectives: [], keywords: [], subtopics: [] }],
      };
    });

  if (!cleanedUnits.length) {
    cleanedUnits.push({
      name: 'Unit 1 – Extracted Overview',
      description: 'Automatically created because the document did not contain recognisable unit headings.',
      concepts: [
        {
          name: String(raw.subject || fallbackSubject || 'Syllabus content').slice(0, 120),
          description: 'Review this concept and rename it to match your syllabus.',
          objectives: [],
          keywords: [],
          subtopics: [],
          estimatedMinutes: 25,
        },
      ],
    });
  }

  return {
    subject: String(raw.subject || fallbackSubject || 'General').slice(0, 160),
    units: cleanedUnits,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.6,
  };
}

export async function parseDocumentToSyllabus({ text, subject, userId, classroomId }) {
  const { data, meta } = await runJsonTask('document_parsing', {
    messages: prompts.parse({ text, subject }),
    meta: { task: 'syllabus_parse', subject, text },
    feature: 'syllabus_retrieval',
    userId,
    classroomId,
  });

  const normalised = normalise(data, subject);
  const syllabus = {
    title: `${normalised.subject} Syllabus`,
    source: 'pdf',
    confidence: normalised.confidence,
    meta: { provider: meta.provider, model: meta.model, fallback: Boolean(meta.fallbackUsed) },
    subjects: [
      {
        name: normalised.subject,
        description: '',
        units: normalised.units,
      },
    ],
  };
  // Convenience aliases so a preview can be read as either the persistence
  // payload (`subjects`) or a flat outline (`units` from the primary subject).
  return { ...syllabus, subject: normalised.subject, units: syllabus.subjects[0].units };
}

export function syllabusSlug(subject, unit, concept) {
  return slugify(`${subject}-${unit}-${concept}`);
}
