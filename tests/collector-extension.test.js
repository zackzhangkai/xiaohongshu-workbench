import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { extractNote } from '../extensions/xhs-collector/extract.js';

// Serialize exactly as Chrome does: no module closure is available in the page.
function injectedResult({ video = false, list = false, login = false, empty = false, broken = false } = {}) {
  const text = value => ({ innerText: value });
  const root = {
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
    getAttribute: () => null,
    querySelector: selector => {
      if (selector === '#detail-desc, .note-text') return text('正文');
      if (selector === '#detail-desc') return text(empty ? '' : '正文');
      if (selector === '#detail-title') return text('标题');
      if (selector === 'video' && video) return {};
      return null;
    },
    querySelectorAll: () => [],
  };
  const document = {
    querySelectorAll: selector => {
      if (broken) throw new Error('测试读取异常');
      if (selector.includes('role="dialog"') && login) return [{ ...root, innerText: '安全验证' }];
      if (selector === '#noteContainer, .note-container' && !list) return [root];
      return [];
    },
  };
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${extractNote.toString()})(false)`, {
    document, location: { hostname: 'www.xiaohongshu.com', pathname: '/explore/aaaaaaaaaaaaaaaaaaaaaaaa' },
    getComputedStyle: () => ({ visibility: 'visible' }), URL,
  })));
}

test('injected extractor returns serializable page errors, never loses them across the boundary', () => {
  for (const [options, message] of [
    [{ video: true }, /视频下载尚未接入/],
    [{ list: true }, /列表页/],
    [{ login: true }, /登录或验证/],
    [{ empty: true }, /正文尚未加载/],
    [{ broken: true }, /测试读取异常/],
  ]) {
    const result = injectedResult(options);
    assert.match(result.error, message);
    assert.equal(result.noteId, undefined);
  }
});

test('successful injected image-note extraction retains its existing payload contract', () => {
  const result = injectedResult();
  assert.equal(result.error, undefined);
  assert.equal(result.noteId, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(result.title, '标题');
  assert.equal(result.content, '正文');
  assert.deepEqual(result.imageUrls, []);
  assert.equal(result.includeComments, false);
});

test('worker shows page error and does not submit a failed capture; valid capture still saves', async t => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; });
  for (const [name, injection, expectedError] of [
    ['video', () => [{ frameId: 0, result: injectedResult({ video: true }) }], /视频下载尚未接入/],
    ['list', () => [{ frameId: 0, result: injectedResult({ list: true }) }], /列表页/],
    ['missing-result', () => [{ frameId: 0 }], /页面读取未返回结果/],
    ['injection-rejected', () => { throw new Error('Cannot access contents of url'); }, /Cannot access/],
    ['success', () => [{ frameId: 0, result: injectedResult() }], null],
  ]) {
    await t.test(name, async () => {
      let listener;
      let finish;
      const terminal = new Promise(resolve => { finish = resolve; });
      const requests = [];
      globalThis.chrome = {
        tabs: { query: async () => [{ id: 1, url: 'https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa' }] },
        storage: { local: {
          setAccessLevel: async () => {},
          get: async () => ({ endpoint: 'http://127.0.0.1:8788', key: 'a'.repeat(64) }),
          set: async ({ captureStatus }) => { if (['done', 'error'].includes(captureStatus.state)) finish(captureStatus); },
        } },
        runtime: { id: 'test', getURL: file => `chrome-extension://test/${file}`, onMessage: { addListener: fn => { listener = fn; } } },
        scripting: { executeScript: async options => {
          assert.equal(options.func, extractNote);
          assert.deepEqual(options.args, [false]);
          return injection();
        } },
      };
      globalThis.fetch = async (url, options) => {
        requests.push({ url, body: options.body });
        return new Response(JSON.stringify({ ok: true, service: 'xhs-collector', duplicate: false, images: 0, comments: 0, warnings: [], preserved: [] }), { status: 200 });
      };
      await import(`../extensions/xhs-collector/background.js?test=${name}`);
      let reply;
      listener({ type: 'capture', includeComments: false }, { id: 'test', url: 'chrome-extension://test/popup.html' }, value => { reply = value; });
      assert.deepEqual(reply, { started: true });
      const status = await terminal;
      if (expectedError) {
        assert.equal(status.state, 'error');
        assert.match(status.message, expectedError);
        assert.equal(requests.length, 1, 'only health; no invalid note saved');
      } else {
        assert.equal(status.state, 'done');
        assert.equal(requests.length, 2);
        assert.equal(JSON.parse(requests[1].body).content, '正文');
      }
    });
  }
});

test('successful pairing saves settings and opens search, while failed pairing stays on settings', async t => {
  const originals = {
    chrome: globalThis.chrome,
    document: globalThis.document,
    fetch: globalThis.fetch,
    window: globalThis.window,
  };
  t.after(() => Object.assign(globalThis, originals));

  for (const [name, responseOk, expectedNavigations] of [['success', true, 1], ['failure', false, 0]]) {
    await t.test(name, async () => {
      const elements = {
        endpoint: { value: 'http://127.0.0.1:8788' },
        key: { value: 'a'.repeat(64) },
        status: { textContent: '' },
        form: { addEventListener: (_type, listener) => { elements.submit = listener; } },
        'open-workspace': { addEventListener: (_type, listener) => { elements.guide = listener; } },
      };
      const writes = [], navigations = [], openedTabs = [];
      globalThis.document = { getElementById: id => elements[id] };
      globalThis.window = { location: { assign: url => navigations.push(url) } };
      globalThis.chrome = {
        runtime: { getURL: file => `chrome-extension://test/${file}` },
        tabs: { create: async ({ url }) => { openedTabs.push(url); } },
        storage: { local: {
          get: async () => ({ endpoint: 'http://127.0.0.1:8788', key: 'a'.repeat(64) }),
          set: async values => { writes.push(values); },
          setAccessLevel: async () => {},
        } },
      };
      globalThis.fetch = async () => new Response(JSON.stringify(responseOk ? { ok: true } : { error: '配对码不正确' }), { status: responseOk ? 200 : 401 });

      await import(`../extensions/xhs-collector/options.js?test=${name}`);
      const button = { disabled: false };
      await elements.submit({ preventDefault() {}, submitter: button });

      assert.equal(button.disabled, false);
      assert.equal(navigations.length, expectedNavigations);
      if (responseOk) {
        assert.deepEqual(writes, [{ endpoint: 'http://127.0.0.1:8788', key: 'a'.repeat(64) }]);
        assert.equal(navigations[0], 'chrome-extension://test/search.html');
        assert.match(elements.status.textContent, /打开搜索界面/);
      } else {
        assert.deepEqual(writes, []);
        assert.match(elements.status.textContent, /配对码不正确/);
      }

      // The pairing guide button opens the workspace pairing page; an invalid
      // endpoint surfaces its message instead of opening anything.
      await elements.guide();
      assert.deepEqual(openedTabs, ['http://127.0.0.1:8788/#knowledge-collector']);
      elements.endpoint.value = 'https://evil.example';
      await elements.guide();
      assert.equal(openedTabs.length, 1);
      assert.match(elements.status.textContent, /地址必须为/);
    });
  }
});
