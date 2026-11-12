import { getDb } from '../../db/index.js';
import { toOid } from '../classrooms/access.js';
import { runEmbeddings, runRerank } from '../ai/orchestrator.js';
import { cosine, hashedEmbedding } from '../ai/providers/local.js';

/**
 * Syllabus Retrieval (RAG).
 *
 * Primary reference for teaching is the classroom's structured syllabus. When
 * uploaded learning material exists, relevant chunks are retrieved with
 * embeddings + reranking and passed to the tutor as supporting context, clearly
 * separated from the syllabus outline itself.
 */

const embeddingCache = new Map();

export async function retrieveContext({ classroomId, concept, query, limit = 5 }) {
  const db = getDb();
  const cid = toOid(classroomId);
  const chunks = await db.collection('syllabus_chunks').find({ classroomId: cid }).limit(600).toArray();
  if (!chunks.length) return { chunks: [], strategy: 'syllabus_only' };

  const scoringQuery = `${concept?.name || ''} ${concept?.description || ''} ${(concept?.keywords || []).join(' ')} ${query || ''}`.trim();
  const cacheKey = `${cid}:${scoringQuery}`;
  let queryVec = embeddingCache.get(cacheKey);
  if (!queryVec) {
    const [vec] = await runEmbeddings([scoringQuery], { classroomId: cid });
    queryVec = vec || hashedEmbedding(scoringQuery);
    embeddingCache.set(cacheKey, queryVec);
  }

  const scored = chunks
    .map((c) => ({
      id: String(c._id),
      text: c.text,
      documentName: c.documentName,
      page: c.page,
      chunkIndex: c.chunkIndex,
      embedding: c.embedding?.length ? c.embedding : hashedEmbedding(c.text),
      score: cosine(queryVec, c.embedding?.length ? c.embedding : hashedEmbedding(c.text)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limit * 3, 10));

  // Rerank the shortlist with the rerank model route.
  let ranked = scored;
  try {
    const reranked = await runRerank(scoringQuery, scored.map((c) => c.text), { classroomId: cid });
    ranked = reranked
      .map((r) => ({ ...scored[r.index], rerankScore: r.score }))
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    ranked = scored.slice(0, limit);
  }

  return {
    chunks: ranked.filter((c) => c.score > 0.05),
    strategy: 'embedding+rerank',
  };
}

/** Builds the "SYLLABUS CONTEXT" block: outline first, material second. */
export function buildSyllabusContext({ concept, unit, subject, retrieved }) {
  const lines = [];
  if (subject) lines.push(`Subject: ${subject.name}`);
  if (unit) lines.push(`Unit: ${unit.name}${unit.description ? ` — ${unit.description}` : ''}`);
  if (concept) {
    lines.push(`Concept: ${concept.name}`);
    if (concept.description) lines.push(`Syllabus definition: ${concept.description}`);
    if (concept.objectives?.length) lines.push(`Learning objectives: ${concept.objectives.join('; ')}`);
    if (concept.keywords?.length) lines.push(`Key terms: ${concept.keywords.join(', ')}`);
    if (concept.subtopics?.length) lines.push(`Subtopics: ${concept.subtopics.join('; ')}`);
  }
  if (retrieved?.length) {
    lines.push('');
    lines.push('Supporting excerpts from uploaded classroom material:');
    retrieved.forEach((r, i) => {
      lines.push(`[${i + 1}] ${r.documentName || 'material'}: ${String(r.text).slice(0, 700)}`);
    });
  }
  return lines.join('\n');
}
