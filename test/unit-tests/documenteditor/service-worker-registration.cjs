/* Run: node test/unit-tests/documenteditor/service-worker-registration.cjs
 * Service worker registration (apps/common/main/lib/util/docserviceworker.js) in vm:
 * behind the session gateway the shared worker is registered for the scope above the
 * session prefix, other editor workers are removed and the files loaded before the
 * worker took the page are handed over; elsewhere, and when the shared registration
 * is refused, the stock worker is registered exactly as before. Every page with a
 * registration takes it from the common file.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const REGISTRATION = path.join(ROOT, 'apps/common/main/lib/util/docserviceworker.js');
const source = fs.readFileSync(REGISTRATION, 'utf8');

const ORIGIN = 'http://gw.test';
const SHARED = 'document_editor_shared_service_worker.js';
const STOCK = 'document_editor_service_worker.js';
const SHARED_PATH = '../../common/main/lib/util/' + SHARED;
const STOCK_PATH = '../../../../' + STOCK;

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Values from the vm realm are copied, so that deepStrictEqual compares plain data
function worker(scriptURL) {
    return { scriptURL, messages: [], postMessage(message) { this.messages.push(JSON.parse(JSON.stringify(message))); } };
}

function registration(scope, scriptURL) {
    return {
        scope: ORIGIN + scope,
        active: scriptURL ? worker(scriptURL) : null,
        unregistered: false,
        unregister() { this.unregistered = true; return Promise.resolve(true); }
    };
}

function run(pathname, options) {
    const opts = options || {};
    const calls = [];
    const existing = opts.existing || [];
    let registered = null;
    const serviceWorker = {
        register(url, registerOptions) {
            calls.push({ url, options: registerOptions ? JSON.parse(JSON.stringify(registerOptions)) : undefined });
            if (opts.refuseShared && url === SHARED_PATH) {
                return Promise.reject(new Error('SecurityError'));
            }
            const scope = registerOptions && registerOptions.scope ? registerOptions.scope : '/stock-scope/';
            registered = registration(scope, ORIGIN + '/s/current/9.4.0-abc/' + url.replace(/^(\.\.\/)+/, ''));
            return Promise.resolve(registered);
        },
        getRegistrations: () => Promise.resolve(existing.concat(registered ? [registered] : [])),
        // The worker that controls the page: the shared one when the page starts under control
        controller: opts.controlledBy ? worker(opts.controlledBy) : null,
        swListeners: {},
        addEventListener(type, handler) { this.swListeners[type] = handler; }
    };
    const observers = [];
    const listeners = {};
    const warnings = [];
    const window = {
        location: { origin: ORIGIN, pathname },
        PerformanceObserver: true,
        addEventListener: (type, handler) => { listeners[type] = handler; },
        performance: {
            getEntriesByType: () => opts.entries || [],
            now: () => 100
        }
    };
    const context = vm.createContext({
        window, navigator: { serviceWorker }, performance: window.performance,
        PerformanceObserver: class {
            constructor(callback) { observers.push(this); this.callback = callback; }
            observe(options) { this.options = JSON.parse(JSON.stringify(options)); }
        },
        console: { error: (m) => warnings.push(m), warn: (m) => warnings.push(m), log() {} }
    });
    vm.runInContext(source, context, { filename: REGISTRATION });
    return { calls, existing, listeners, warnings, observers, serviceWorker, registered: () => registered };
}

const EDITOR = '/s/token-1/9.4.0-abc/web-apps/apps/documenteditor/main/index.html';

async function testSharedWorkerBehindGateway() {
    const stockOld = registration('/s/token-0/9.4.0-abc/', ORIGIN + '/s/token-0/9.4.0-abc/' + STOCK);
    const sharedOtherScope = registration('/docs/', ORIGIN + '/docs/s/t/9.4.0-abc/web-apps/apps/common/main/lib/util/' + SHARED);
    const unrelated = registration('/other/', ORIGIN + '/other/worker.js');
    const result = run(EDITOR, { existing: [stockOld, sharedOtherScope, unrelated] });
    await flush(); await flush();

    assert.deepEqual(result.calls, [{ url: SHARED_PATH, options: { scope: '/', updateViaCache: 'none' } }],
        'one registration of the shared worker for the scope above the session prefix');
    assert.equal(stockOld.unregistered, true, 'the stock worker of an older session is removed');
    assert.equal(sharedOtherScope.unregistered, true, 'the shared worker of another scope is removed');
    assert.equal(unrelated.unregistered, false, 'a foreign worker stays');
    assert.equal(result.registered().unregistered, false, 'the new registration stays');
}

async function testScopeKeepsPathPrefix() {
    const result = run('/docs/s/token-1/9.4.0-abc/web-apps/apps/api/documents/preload.html');
    await flush();
    assert.deepEqual(result.calls[0], { url: SHARED_PATH, options: { scope: '/docs/', updateViaCache: 'none' } });
}

async function testStockRegistrationElsewhere() {
    for (const pathname of [
        '/9.4.0-abc/web-apps/apps/documenteditor/main/index.html',
        '/web-apps/apps/documenteditor/embed/index.html',
        '/s/token-1/develop/web-apps/apps/documenteditor/main/index.html'
    ]) {
        const stockOld = registration('/9.4.0-old/', ORIGIN + '/9.4.0-old/' + STOCK);
        const result = run(pathname, { existing: [stockOld] });
        await flush(); await flush();
        assert.deepEqual(result.calls, [{ url: STOCK_PATH, options: undefined }], pathname + ': stock registration');
        assert.equal(stockOld.unregistered, true, pathname + ': the stock cleanup is kept');
    }
}

async function testFallbackWhenSharedScopeIsRefused() {
    const result = run(EDITOR, { refuseShared: true });
    await flush(); await flush(); await flush();
    assert.deepEqual(result.calls.map((call) => call.url), [SHARED_PATH, STOCK_PATH],
        'a refused shared registration falls back to the stock worker');
    assert.equal(result.warnings.length, 1);
}

async function testHandOverOfFilesLoadedBeforeControl() {
    const sharedOf = (version) => ORIGIN + '/s/token-0/' + version + '/web-apps/apps/common/main/lib/util/' + SHARED;
    // The takeover happens at 100 ms (performance.now of the mock)
    const before = { name: ORIGIN + '/s/token-1/9.4.0-abc/web-apps/apps/documenteditor/main/app.js', startTime: 10, workerStart: 0 };
    const passed = { name: ORIGIN + '/s/token-1/9.4.0-abc/web-apps/vendor/requirejs/require.js', startTime: 12, workerStart: 3.1 };
    const served = { name: ORIGIN + '/s/token-1/9.4.0-abc/sdkjs/word/sdk-all-min.js', startTime: 150, workerStart: 151 };
    const inFlight = { name: ORIGIN + '/s/token-1/9.4.0-abc/web-apps/vendor/underscore/underscore.js', startTime: 90, workerStart: 0 };
    const passedInFlight = { name: ORIGIN + '/s/token-1/9.4.0-abc/web-apps/apps/documenteditor/main/resources/css/app.css', startTime: 95, workerStart: 96 };

    // First session: no worker at the start, the shared worker takes the page over while it loads
    const first = run(EDITOR, { entries: [before] });
    await flush(); await flush();
    assert.equal(typeof first.serviceWorker.swListeners.controllerchange, 'function', 'waits for the takeover');
    const taken = worker(sharedOf('9.4.0-abc'));
    first.serviceWorker.controller = taken;
    first.serviceWorker.swListeners.controllerchange();
    assert.deepEqual(taken.messages, [{ type: 'precache', urls: [before.name] }], 'files finished before the takeover');
    assert.equal(first.observers.length, 1);
    assert.deepEqual(first.observers[0].options, { type: 'resource' });
    first.observers[0].callback({ getEntries: () => [inFlight, served] });
    assert.deepEqual(taken.messages[1], { type: 'precache', urls: [inFlight.name] },
        'a request in flight at the takeover goes when it finishes, files requested after it do not');

    // The shared worker of another version controlled the page: what passed through it goes too
    const switched = run(EDITOR, { entries: [passed, before], controlledBy: sharedOf('9.4.0-old') });
    await flush(); await flush();
    const newer = worker(sharedOf('9.4.0-abc'));
    switched.serviceWorker.controller = newer;
    switched.serviceWorker.swListeners.controllerchange();
    assert.deepEqual(newer.messages, [{ type: 'precache', urls: [passed.name, before.name] }]);
    switched.observers[0].callback({ getEntries: () => [passedInFlight, served] });
    assert.deepEqual(newer.messages[1], { type: 'precache', urls: [passedInFlight.name] },
        'a request in flight through the previous worker goes when it finishes');

    // Under the shared worker of its own version from the start: nothing to hand over
    const controlled = run(EDITOR, { entries: [served], controlledBy: sharedOf('9.4.0-abc') });
    await flush(); await flush();
    assert.equal(controlled.serviceWorker.swListeners.controllerchange, undefined);
    assert.equal(controlled.observers.length, 0);

    // The stock worker after a refused shared registration gets nothing
    const stock = run(EDITOR, { entries: [before], refuseShared: true });
    await flush(); await flush(); await flush();
    const stockWorker = worker(ORIGIN + '/s/token-1/9.4.0-abc/' + STOCK);
    stock.serviceWorker.controller = stockWorker;
    stock.serviceWorker.swListeners.controllerchange();
    assert.deepEqual(stockWorker.messages, []);
    assert.equal(stock.observers.length, 0);
}

function testPagesUseCommonRegistration() {
    const pages = [];
    const walk = (dir) => {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, item.name);
            if (item.isDirectory()) {
                if (item.name !== 'node_modules') walk(full);
            } else if (/\.html(\.deploy)?$/.test(item.name)) {
                pages.push(full);
            }
        }
    };
    walk(path.join(ROOT, 'apps'));
    const ownRegistration = pages.filter((file) => fs.readFileSync(file, 'utf8').includes('serviceWorker.register'));
    assert.deepEqual(ownRegistration, [], 'no page registers a worker by itself');
    const required = [
        'apps/documenteditor/main/index.html.deploy', 'apps/documenteditor/embed/index.html.deploy',
        'apps/documenteditor/forms/index.html.deploy', 'apps/spreadsheeteditor/main/index.html.deploy',
        'apps/presentationeditor/main/index.html.deploy', 'apps/pdfeditor/main/index.html.deploy',
        'apps/visioeditor/main/index.html.deploy', 'apps/api/documents/preload.html',
        'apps/api/documents/cache-scripts.html'
    ];
    for (const page of required) {
        assert.ok(fs.readFileSync(path.join(ROOT, page), 'utf8').includes('apps/common/main/lib/util/docserviceworker.js'),
            page + ' takes the common registration');
    }
}

(async () => {
    await testSharedWorkerBehindGateway();
    await testScopeKeepsPathPrefix();
    await testStockRegistrationElsewhere();
    await testFallbackWhenSharedScopeIsRefused();
    await testHandOverOfFilesLoadedBeforeControl();
    testPagesUseCommonRegistration();
    console.log('service-worker-registration: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
