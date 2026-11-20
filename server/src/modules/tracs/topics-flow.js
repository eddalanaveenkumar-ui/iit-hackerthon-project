/**
 * CHOOSING WHAT TO LEARN
 * ======================
 *
 * Learn used to explain a whole unit at once and then test all of it. That is
 * not how anyone revises: you pick one thing, have it explained, and only then
 * decide whether to move on or prove you have it.
 *
 * So the unit is presented as its concepts, the learner picks one, and the
 * explanation is followed by exactly two choices — the next concept, or a test
 * of this one. These helpers own that walk, so the choice is stored once and
 * every entry point (the buttons, a typed command, a reloaded page) reads the
 * same state.
 */

/**
 * Build the picker for a unit's concepts.
 *
 * Every concept is a button. The one the learner is on is marked, and anything
 * already demonstrated is marked too, so the list doubles as the unit's progress
 * without a separate progress bar competing with it.
 */
export function conceptPicker({ unit, topics = [], currentId = null, title = null }) {
  const concepts = (unit?.concepts || []).map((concept) => {
    const topic = topics.find((t) => t.id === concept.id) || concept;
    return {
      id: concept.id,
      title: topic.title || concept.title,
      mastered: (topic.mastery || 0) > 0,
      current: concept.id === currentId,
    };
  });
  if (!concepts.length) return null;
  return {
    id: `unit_concepts_${unit?.index ?? 0}`,
    type: 'actions',
    title: title || `Which topic in ${unit?.title || 'this unit'}?`,
    actions: concepts.slice(0, 20).map((concept) => ({
      id: `learn_${concept.id}`,
      // A tick keeps the list readable when a unit has been half covered.
      label: `${concept.current ? '▸ ' : ''}${concept.mastered ? '✓ ' : ''}${concept.title}`.slice(0, 80),
      action: 'continue_lesson',
      command: 'learn',
      topic_id: concept.id,
      tone: concept.current ? 'brand' : undefined,
    })),
  };
}

/**
 * The two ways out of an explanation: the next concept, or a test of this one.
 *
 * Deliberately exactly two. An explanation that offers five things to do next
 * makes the learner choose between interfaces instead of thinking about the
 * subject.
 */
export function explanationChoices({ unit, concept, nextConcept, topics = [] }) {
  const mastered = (id) => {
    const topic = topics.find((t) => t.id === id);
    return (topic?.mastery || 0) > 0;
  };
  const actions = [
    {
      id: 'test_this_topic',
      label: `Test this topic: ${concept?.title || ''}`.slice(0, 80),
      action: 'continue_lesson',
      command: 'test',
      topic_id: concept?.id,
      tone: 'brand',
    },
  ];
  if (nextConcept) {
    actions.push({
      id: 'learn_next_topic',
      label: `Learn next topic: ${nextConcept.title}`.slice(0, 80),
      action: 'continue_lesson',
      command: 'learn',
      topic_id: nextConcept.id,
      tone: mastered(nextConcept.id) ? 'info' : undefined,
    });
  }
  return {
    id: `after_${concept?.id || 'topic'}`,
    type: 'actions',
    title: 'Where next',
    actions,
  };
}

/**
 * The concept after `currentId`, in syllabus order.
 *
 * "Next" means the next one the learner has not demonstrated; when the unit is
 * fully covered it falls back to the literal next so the walk never dead-ends
 * mid-unit.
 */
export function nextConceptAfter(unit, currentId, topics = []) {
  const concepts = unit?.concepts || [];
  const index = concepts.findIndex((c) => c.id === currentId);
  if (index === -1) return concepts[1] ? { ...concepts[1], id: concepts[1].id } : null;
  const after = concepts.slice(index + 1);
  const unattempted = after.filter((c) => {
    const topic = topics.find((t) => t.id === c.id);
    return !topic || (topic.mastery || 0) === 0;
  });
  return unattempted[0] || after[0] || null;
}

/**
 * Which concept a Learn turn should explain.
 *
 * An explicit choice wins. Otherwise the first concept of the unit that has not
 * been demonstrated — so "Learn" with nothing chosen opens the unit where the
 * learner actually is, rather than always at the top of the list.
 */
export function conceptToLearn({ unit, topics = [], topicId = null, currentId = null }) {
  const concepts = unit?.concepts || [];
  if (!concepts.length) return null;
  if (topicId) {
    const chosen = concepts.find((c) => c.id === topicId);
    if (chosen) return chosen;
  }
  if (currentId) {
    const current = concepts.find((c) => c.id === currentId);
    if (current) return current;
  }
  const undemonstrated = concepts.find((c) => {
    const topic = topics.find((t) => t.id === c.id);
    return !topic || (topic.mastery || 0) === 0;
  });
  return undemonstrated || concepts[0];
}
