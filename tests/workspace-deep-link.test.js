import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceDeepLink } from '../src/workspace-deep-link.js';

test('knowledge note deep link opens the matching knowledge detail', () => {
  const noteId = '12345678-1234-1234-1234-1234567890ab';
  assert.deepEqual(workspaceDeepLink('#knowledge', `?knowledgeNote=${noteId}`), { view: 'knowledge', collector: false, noteId });
  assert.deepEqual(workspaceDeepLink('#knowledge-collector', '?knowledgeNote=bad'), { view: 'knowledge', collector: true, noteId: null });
  assert.deepEqual(workspaceDeepLink('#unknown', ''), { view: 'home', collector: false, noteId: null });
});
