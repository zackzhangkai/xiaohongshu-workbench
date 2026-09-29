import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip, imageName, imageBytes } from '../src/publish-download.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('ZIP opens with standard Python reader, validates CRC and exact binary bytes', async () => {
 const dir = await mkdtemp(join(tmpdir(),'xhs-zip-test-'));
 try {
  const text = new TextEncoder().encode('标题\n\n正文与话题 #测试');
  const image = Uint8Array.from([137,80,78,71,13,10,26,10,0,255,14]);
  const blob = createZip([{name:'文案.txt',bytes:text},{name:'01-封面.png',bytes:image}]);
  await writeFile(join(dir,'result.zip'),new Uint8Array(await blob.arrayBuffer()));
  const output = execFileSync('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n assert z.namelist()==['文案.txt','01-封面.png']\n assert z.read('文案.txt').decode()=='标题\\n\\n正文与话题 #测试'\n assert z.read('01-封面.png')==bytes([137,80,78,71,13,10,26,10,0,255,14])\n print('ok')`,join(dir,'result.zip')],{encoding:'utf8'});
  assert.equal(output.trim(),'ok');
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('image fetch rejects missing resources and HTML fallback', async () => {
 const original = globalThis.fetch;
 try {
  globalThis.fetch = async () => new Response('missing',{status:404});
  await assert.rejects(imageBytes('/images/no.png'));
  globalThis.fetch = async () => new Response('<html/>',{headers:{'Content-Type':'text/html'}});
  await assert.rejects(imageBytes('/images/no.png'));
  globalThis.fetch = async () => new Response('not an image',{headers:{'Content-Type':'image/png'}});
  await assert.rejects(imageBytes('/images/no.png'));
 } finally { globalThis.fetch = original; }
 assert.equal(imageName('/images/one.webp',1),'02-配图.webp');
});
