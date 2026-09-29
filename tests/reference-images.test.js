import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attachReferenceImages, IMAGE_LIMITS } from '../server/reference-images.js';
import { visionSample } from '../server/vision-test.js';
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-reference-images-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const importsDir = path.join(dir, 'imports'); fs.mkdirSync(importsDir);
  const write = (name, bytes = visionSample()) => { fs.writeFileSync(path.join(importsDir, name), bytes); return `/imports/${name}`; };
  const attach = (refs, options = {}) => attachReferenceImages({ text: '正文', references: [{ id: 'test', imageRefs: refs }], importsDir, manual: true, enabled: true, ...options });
  return { dir, importsDir, write, attach };
}
test('real bytes attached only for explicitly enabled manual calls', t => {
  const { write, attach } = fixture(t); const ref = write('test.png');
  const result = attach([ref]);
  assert.equal(result.count, 1);
  assert.equal(result.content.at(-1).image_url.url, `data:image/png;base64,${visionSample().toString('base64')}`);
  for (const options of [{ manual: false }, { enabled: false }]) {
    const disabled = attach([ref], options);
    assert.equal(disabled.count, 0); assert.equal(typeof disabled.content, 'string'); assert.ok(!disabled.content.includes('base64'));
  }
});
test('missing, corrupt, mismatched, remote, traversal, encoded paths and symlinks never attach', t => {
  const { dir, importsDir, write, attach } = fixture(t);
  write('bad.png', Buffer.from('not an image')); write('wrong.jpg');
  fs.writeFileSync(path.join(dir, 'secret.png'), visionSample());
  fs.symlinkSync(path.join(dir, 'secret.png'), path.join(importsDir, 'linked.png'));
  fs.symlinkSync(path.join(importsDir, 'bad.png'), path.join(importsDir, 'internal.png'));
  const refs = ['/imports/missing.png', '/imports/bad.png', '/imports/wrong.jpg', '/imports/../secret.png', '/imports/%2e%2e%2fsecret.png', '/imports/linked.png', '/imports/internal.png', 'https://example.com/test.png', 'file:///private/secret.png'];
  const result = attach(refs); assert.equal(result.count, 0);
  assert.match(result.report, /缺失/); assert.match(result.report, /格式/); assert.match(result.report, /路径不安全/);
  const linkedRoot = path.join(dir, 'link'); fs.symlinkSync(importsDir, linkedRoot);
  assert.equal(attach([write('good.png')], { importsDir: linkedRoot }).count, 0);
});
test('count, per-file and total size limits are enforced', t => {
  const { write, attach } = fixture(t);
  const refs = Array.from({ length: 7 }, (_, i) => write(`small${i}.png`));
  assert.equal(attach(refs).count, 6); assert.match(attach(refs).report, /6 张限制/);
  const tooBig = Buffer.alloc(IMAGE_LIMITS.perImage + 1); visionSample().copy(tooBig);
  assert.match(attach([write('large.png', tooBig)]).report, /单图超过/);
  const max = tooBig.subarray(0, IMAGE_LIMITS.perImage);
  const largeRefs = Array.from({ length: 5 }, (_, i) => write(`max${i}.png`, max));
  const result = attach(largeRefs); assert.equal(result.count, 4); assert.match(result.report, /总量超过/);
});
test('legacy snapshots explicitly require re-reference and do not read current notes', t => {
  const { attach } = fixture(t);
  const result = attach([], { references: [{ id: 'old', imageCount: 2, content: 'old text' }] });
  assert.equal(result.count, 0); assert.match(result.report, /旧会话没有图片引用/); assert.match(result.report, /重新引用/);
});
