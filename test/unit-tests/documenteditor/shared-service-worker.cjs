/* Run: node test/unit-tests/documenteditor/shared-service-worker.cjs
 * Shared static cache worker (apps/common/main/lib/util/document_editor_shared_service_worker.js)
 * in vm with in-memory Cache Storage and fetch: one cache entry per version path for every
 * session prefix, what it never handles, version cleanup on activation and precaching
 * of files loaded before the worker controlled the page.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const WORKER = path.join(ROOT, 'apps/common/main/lib/util/document_editor_shared_service_worker.js');
const source = fs.readFileSync(WORKER, 'utf8');

const ORIGIN = 'http://gw.test';
const VERSION = '9.4.0-abc';
const workerUrl = (version) => `${ORIGIN}/s/session-a/${version}/web-apps/apps/common/main/lib/util/document_editor_shared_service_worker.js`;
const keyOf = (request) => (typeof request === 'string' ? request : request.url);

function createCacheStorage(initial) {
    // Map keeps insertion order, as Cache Storage keeps creation order of cache names
    const store = new Map();
    const open = (name) => {
        if (!store.has(name)) store.set(name, new Map());
        return store.get(name);
    };
    const cacheApi = (entries) => ({
        match: async (request) => entries.get(keyOf(request)),
        put: async (request, response) => { entries.set(keyOf(request), response); },
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
        delete: async (request) => entries.delete(keyOf(request))
    });
    (initial || []).forEach((name) => open(name));
    return {
        store,
        api: {
            open: async (name) => cacheApi(open(name)),
            keys: async () => [...store.keys()],
            delete: async (name) => store.delete(name),
            match: async (request, options) => {
                const entries = store.get(options.cacheName);
                return entries ? entries.get(keyOf(request)) : undefined;
            }
        }
    };
}

function loadWorker(version, cacheNames, network) {
    const handlers = {};
    const fetched = [];
    const storage = createCacheStorage(cacheNames);
    const self = {
        location: new URL(workerUrl(version)),
        addEventListener: (type, handler) => { handlers[type] = handler; },
        skipWaiting: async () => {},
        clients: { claim: async () => {} }
    };
    const fetchMock = async (request) => {
        const url = keyOf(request);
        fetched.push(url);
        const answer = network(url);
        const response = new Response(answer.body, { status: answer.status || 200, headers: { 'content-type': 'text/javascript' } });
        // A constructed Response has type "default"; a same-origin network answer is "basic"
        Object.defineProperty(response, 'type', { value: 'basic' });
        return response;
    };
    const context = vm.createContext({
        self, caches: storage.api, fetch: fetchMock, navigator: { userAgent: 'node' },
        Request, Response, Headers, URL, Promise, console, setTimeout
    });
    vm.runInContext(source, context, { filename: WORKER });
    return { handlers, fetched, storage };
}

function fetchEvent(url, init) {
    // A plain request: the Request of Node does not accept the "navigate" mode
    const options = init || {};
    const event = {
        request: { url, method: options.method || 'GET', mode: options.mode || 'cors', headers: new Headers(options.headers) },
        responded: null,
        pending: [],
        respondWith(promise) { this.responded = promise; },
        waitUntil(promise) { this.pending.push(promise); }
    };
    return event;
}

async function dispatchFetch(worker, url, init) {
    const event = fetchEvent(url, init);
    worker.handlers.fetch(event);
    if (!event.responded) return { handled: false };
    const response = await event.responded;
    await Promise.all(event.pending);
    return { handled: true, status: response.status, body: await response.text() };
}

const staticUrl = (session, version, file) => `${ORIGIN}/s/${session}/${version}/${file}`;
const sharedCache = (version) => 'document_editor_shared_static_' + version;
const dynamicCache = (version) => 'document_editor_shared_dynamic_' + version;

async function testOneEntryForAllSessions() {
    const worker = loadWorker(VERSION, [], (url) => ({ body: 'body of ' + url.replace(/^.*\/s\/[^/]+/, '') }));
    const file = 'sdkjs/word/sdk-all-min.js';

    const first = await dispatchFetch(worker, staticUrl('session-a', VERSION, file));
    assert.equal(first.handled, true);
    assert.equal(first.status, 200);
    assert.deepEqual(worker.fetched, [staticUrl('session-a', VERSION, file)],
        'a miss goes to the network by the URL of the current session');

    const entries = worker.storage.store.get(sharedCache(VERSION));
    assert.deepEqual([...entries.keys()], [`${ORIGIN}/${VERSION}/${file}`],
        'the cache key has no session prefix');

    const second = await dispatchFetch(worker, staticUrl('session-b', VERSION, file));
    assert.equal(second.handled, true);
    assert.equal(second.body, first.body);
    assert.equal(worker.fetched.length, 1, 'another session gets the stored body without a network request');
}

async function testFilesItDoesNotHandle() {
    const worker = loadWorker(VERSION, [], (url) => ({ body: url }));
    const notHandled = [
        [staticUrl('a', VERSION, 'web-apps/apps/documenteditor/main/index.html'), { mode: 'navigate' }, 'navigation'],
        [staticUrl('a', VERSION, 'sdkjs/word/sdk-all-min.js'), { method: 'POST' }, 'POST'],
        [staticUrl('a', VERSION, 'fonts/001'), { headers: { range: 'bytes=0-10' } }, 'Range'],
        [staticUrl('a', '9.4.0-other', 'sdkjs/word/sdk-all-min.js'), undefined, 'another version'],
        [`http://other.test/s/a/${VERSION}/sdkjs/word/sdk-all-min.js`, undefined, 'another origin'],
        [staticUrl('a', VERSION, 'web-apps-copy/apps/x.js'), undefined, 'look-alike static root'],
        [staticUrl('a', VERSION, 'doc/key/c/?EIO=4'), undefined, 'socket.io'],
        [`${ORIGIN}/cache/files/data/key/Editor.bin/Editor.bin?md5=m&expires=1`, undefined, 'document file without document id'],
        [`${ORIGIN}/cache/files/data-copy/x?shardkey=key`, undefined, 'look-alike document path']
    ];
    for (const [url, init, label] of notHandled) {
        const result = await dispatchFetch(worker, url, init);
        assert.equal(result.handled, false, label + ' is not handled by the worker');
    }
    assert.equal(worker.fetched.length, 0);
    assert.equal(worker.storage.store.has(sharedCache(VERSION)), false, 'nothing is stored');
}

async function testDocumentFilesStayOutOfSharedCache() {
    const worker = loadWorker(VERSION, [], (url) => ({ body: url }));
    const url = `${ORIGIN}/cache/files/data/key.1/Editor.bin/Editor.bin?md5=m&expires=1&shardkey=key`;
    const result = await dispatchFetch(worker, url);
    assert.equal(result.handled, true, 'the per-document cache of the stock worker is kept');
    assert.equal(worker.storage.store.has(sharedCache(VERSION)), false, 'document files never reach the shared cache');
    assert.deepEqual([...worker.storage.store.get(dynamicCache(VERSION)).keys()], [url],
        'the per-document cache is keyed by the full signed URL');
}

async function testFailedResponsesAreNotStored() {
    const worker = loadWorker(VERSION, [], () => ({ body: 'denied', status: 401 }));
    const url = staticUrl('expired', VERSION, 'sdkjs/common/AllFonts.js');
    const result = await dispatchFetch(worker, url);
    assert.equal(result.status, 401, 'the network answer reaches the page as is');
    const entries = worker.storage.store.get(sharedCache(VERSION));
    assert.ok(!entries || entries.size === 0, 'an error is not stored');
}

async function testStoredEntryTakesTheCurrentUrl() {
    const worker = loadWorker(VERSION, [], () => ({ body: 'from network' }));
    const file = 'sdkjs/common/spell/spell/spell.js';
    const stored = new Response('stored body', { headers: { 'content-type': 'text/javascript' } });
    // The worker or style that stored the entry was loaded in another, now closed session
    Object.defineProperty(stored, 'url', { value: staticUrl('closed', VERSION, file) });
    worker.storage.store.set(sharedCache(VERSION), new Map([[`${ORIGIN}/${VERSION}/${file}`, stored]]));

    const event = fetchEvent(staticUrl('current', VERSION, file));
    worker.handlers.fetch(event);
    const response = await event.responded;
    assert.equal(await response.text(), 'stored body');
    assert.equal(response.url, '', 'no stored URL: relative URLs resolve against the current request');
    assert.equal(response.headers.get('content-type'), 'text/javascript');
    assert.equal(worker.fetched.length, 0);
}

async function testQueryDoesNotChooseTheKey() {
    const worker = loadWorker(VERSION, [], (url) => ({ body: url }));
    const disguised = staticUrl('a', '9.4.0-other', 'web-apps/x.js')
        + `?q=/${VERSION}/web-apps/apps/api/documents/api.js`;
    const result = await dispatchFetch(worker, disguised);
    assert.equal(result.handled, false, 'a version path in the query does not make the file cacheable');

    const event = { data: { type: 'precache', urls: [disguised] }, pending: [], waitUntil(promise) { this.pending.push(promise); } };
    worker.handlers.message(event);
    await Promise.all(event.pending);
    assert.equal(worker.fetched.length, 0, 'nor is it precached');
    assert.equal(worker.storage.store.has(sharedCache(VERSION)), false);
}

async function testUnreadableCacheFallsBackToNetwork() {
    const worker = loadWorker(VERSION, [], () => ({ body: 'from network' }));
    worker.storage.api.match = async () => { throw new Error('storage is broken'); };
    const url = staticUrl('a', VERSION, 'sdkjs/word/sdk-all-min.js');
    const result = await dispatchFetch(worker, url);
    assert.equal(result.status, 200);
    assert.equal(result.body, 'from network', 'the page still gets the file');
    assert.deepEqual(worker.fetched, [url]);
}

async function testPartialAnswersAreNotStored() {
    const worker = loadWorker(VERSION, [], () => ({ body: 'part', status: 206 }));
    const result = await dispatchFetch(worker, staticUrl('a', VERSION, 'fonts/001'));
    assert.equal(result.status, 206, 'the network answer reaches the page as is');
    const entries = worker.storage.store.get(sharedCache(VERSION));
    assert.ok(!entries || entries.size === 0, 'a partial answer is not stored');
}

async function activate(worker) {
    const event = { pending: [], waitUntil(promise) { this.pending.push(promise); } };
    worker.handlers.activate(event);
    await Promise.all(event.pending);
    return [...worker.storage.store.keys()];
}

async function testActivationKeepsPreviousVersion() {
    const initial = [
        'document_editor_static_9.4.0-old', 'document_editor_dynamic_9.4.0-old',
        sharedCache('9.4.0-v1'), sharedCache('9.4.0-v2'), dynamicCache('9.4.0-v2'), 'unrelated'
    ];
    const v3 = loadWorker('9.4.0-v3', initial, () => ({ body: '' }));
    assert.deepEqual(await activate(v3), [sharedCache('9.4.0-v2'), 'unrelated'],
        'the newest other version stays, older versions and caches of the stock worker go');

    // Same storage, the worker of v2 comes back: v3 is now the previous version
    const cachesAfterV3 = [sharedCache('9.4.0-v2'), 'unrelated', sharedCache('9.4.0-v3')];
    const v2 = loadWorker('9.4.0-v2', cachesAfterV3, () => ({ body: '' }));
    assert.deepEqual(await activate(v2), cachesAfterV3, 'switching back keeps both versions');

    // Activation of the same version again (every new session URL installs the worker anew)
    const same = loadWorker('9.4.0-v2', cachesAfterV3, () => ({ body: '' }));
    assert.deepEqual(await activate(same), cachesAfterV3);
}

async function testPrecacheOfLoadedFiles() {
    const worker = loadWorker(VERSION, [], (url) => ({ body: 'body of ' + url }));
    const stored = `${ORIGIN}/${VERSION}/sdkjs/common/AllFonts.js`;
    worker.storage.store.set(sharedCache(VERSION), new Map([[stored, new Response('cached')]]));
    const missing = staticUrl('a', VERSION, 'web-apps/apps/documenteditor/main/app.js');
    const urls = [
        missing,
        staticUrl('a', VERSION, 'sdkjs/common/AllFonts.js'),
        `http://other.test/s/a/${VERSION}/sdkjs/word/sdk-all-min.js`,
        `${ORIGIN}/cache/files/data/key/Editor.bin/Editor.bin?shardkey=key`,
        42
    ];
    const event = { data: { type: 'precache', urls }, pending: [], waitUntil(promise) { this.pending.push(promise); } };
    worker.handlers.message(event);
    await Promise.all(event.pending);
    assert.deepEqual(worker.fetched, [missing], 'only a missing static file of this origin and version is fetched');
    assert.deepEqual([...worker.storage.store.get(sharedCache(VERSION)).keys()],
        [stored, `${ORIGIN}/${VERSION}/web-apps/apps/documenteditor/main/app.js`]);

    const ignored = { data: { type: 'other', urls: [missing] }, pending: [], waitUntil(promise) { this.pending.push(promise); } };
    worker.handlers.message(ignored);
    assert.equal(ignored.pending.length, 0, 'other messages are ignored');
}

(async () => {
    await testOneEntryForAllSessions();
    await testFilesItDoesNotHandle();
    await testDocumentFilesStayOutOfSharedCache();
    await testFailedResponsesAreNotStored();
    await testStoredEntryTakesTheCurrentUrl();
    await testQueryDoesNotChooseTheKey();
    await testUnreadableCacheFallsBackToNetwork();
    await testPartialAnswersAreNotStored();
    await testActivationKeepsPreviousVersion();
    await testPrecacheOfLoadedFiles();
    console.log('shared-service-worker: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
