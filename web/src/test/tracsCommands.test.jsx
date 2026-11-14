import { describe, expect, it, vi } from 'vitest';
import { createDynamicActions } from '../lib/dynamicUi';

/**
 * WHERE THE COMMAND COMES FROM
 * ============================
 *
 * A button labelled "/learn" once ran `/test`. Two things had to both be wrong
 * for that: `createDynamicActions` dropped the action object before calling
 * `onContinue`, and the caller then defaulted anything unnamed to `/test`. The
 * first is invisible in a unit test of the caller, so it is pinned here.
 */
describe('actions carry their command', () => {
  const build = (onContinue) => createDynamicActions({ navigate: vi.fn(), notify: vi.fn(), onContinue });

  it('forwards the whole action to onContinue', async () => {
    const onContinue = vi.fn().mockResolvedValue({ ok: true });
    const actions = build(onContinue);
    await actions.continueLesson({ id: 'go_learn', action: 'continue_lesson', command: 'learn' });
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ command: 'learn' }));
  });

  it('keeps the command for a /test button too', async () => {
    const onContinue = vi.fn().mockResolvedValue({ ok: true });
    const actions = build(onContinue);
    await actions.continueLesson({ id: 'go_test', action: 'continue_lesson', command: 'test' });
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ command: 'test' }));
  });

  it('reports rather than throwing when nothing handles the continuation', async () => {
    const actions = createDynamicActions({ navigate: vi.fn() });
    const result = await actions.continueLesson({ command: 'learn' });
    expect(result.ok).toBe(false);
  });
});
