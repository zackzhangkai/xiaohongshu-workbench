import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TranscriptionService, mediaSignature } from '../server/transcription.js';
test('rejects playlists and invalid paths; restart records interrupted jobs without resubmitting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-asr-test-'));
  try {
    const service = new TranscriptionService(dir);
    assert.equal(mediaSignature(Buffer.from('#EXTM3U\nhttp://example.com/audio')), false);
    assert.throws(() => service.get('../secret'));
    const id = '12345678-1234-1234-1234-123456789abc';
    fs.mkdirSync(service.folder(id)); service.save({ id, status: 'running', createdAt: Date.now() });
    const restarted = new TranscriptionService(dir);
    assert.equal(restarted.get(id).status, 'failed'); assert.equal(restarted.busy, false);
    restarted.python = path.join(dir, 'missing-python');
    await assert.rejects(restarted.create(Buffer.alloc(20), 'test'), /不会自动安装/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
