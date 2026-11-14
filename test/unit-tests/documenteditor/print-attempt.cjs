/* Native CJS harness: executes the AMD utility and controller sources with a mock DOM/clock.
 * node test/unit-tests/documenteditor/print-attempt.cjs
 * Native PDF rendering and browser modality are checked separately by the browser owner.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const utility = fs.readFileSync(path.join(root, 'apps/documenteditor/main/app/util/PrintAttempt.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'apps/documenteditor/main/app/util/PrintPdfLoader.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
}
function harness(fetcher) {
    let now = 1000, seq = 0, PrintAttempt, PdfLoader;
    const timers = new Map(), allTimers = [], frames = [], blobs = [], revoked = [], calls = [];
    const errors = [], waits = [], events = {}, sdk = [], alerts = [], stack = [], downloads = [];
    let printCalls = 0, openCalls = 0, printThrows = false, focusThrows = false, modal = false;
    function node(tag) {
        const n = {tag, style: {}, children: [], attributes: {}, parentNode: null,
            appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
            removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; },
            setAttribute(k, v) { this.attributes[k] = v; }, getAttribute(k) { return k === 'src' ? this.src : this.attributes[k]; }};
        if (tag === 'iframe') {
            n.contentWindow = {location: {href: 'about:blank'},
                focus() { if (focusThrows) throw Error('focus'); }, blur() {},
                print() { printCalls++; if (printThrows) throw Error('ambiguous print'); }};
            frames.push(n);
        }
        return n;
    }
    const document = {body: node('body'), createElement: node, getElementById: () => document.body};
    const window = {document, focus() {}, open() { openCalls++; },
        addEventListener(name, fn) { (events[name] ||= new Set()).add(fn); },
        removeEventListener(name, fn) { events[name]?.delete(fn); }};
    const Url = class extends URL {};
    Url.createObjectURL = blob => { blobs.push(blob); return 'blob:https://editor.example.test/' + blobs.length; };
    Url.revokeObjectURL = url => revoked.push(url);
    const context = {window, document, URL: Url, Blob, AbortController, Promise, Uint8Array,
        location: {origin: 'https://editor.example.test'}, Date: {now: () => now},
        setTimeout(fn, delay) { const id = ++seq; timers.set(id, {fn, at: now + delay}); allTimers.push(fn); return id; },
        clearTimeout(id) { timers.delete(id); },
        fetch(url, opts) { calls.push({url, opts}); return fetcher ? fetcher(url, opts) : Promise.resolve(response()); },
        define(deps, factory) { PdfLoader = factory(); }};
    window.URL = Url;
    vm.runInNewContext(loader, context);
    context.define = (deps, factory) => {
        assert.deepEqual(Array.from(deps), ['documenteditor/main/app/util/PrintPdfLoader']);
        PrintAttempt = factory(PdfLoader);
    };
    vm.runInNewContext(utility, context);
    const owner = {api: {}, document: {key: 'A'}, key: 'A'};
    let current = owner, allowed = true;
    function create() {
        return new PrintAttempt({isCurrent: o => current === o && allowed,
            showWait() { const w = {removed: 0}; waits.push(w); return () => w.removed++; },
            onError(e) { errors.push(e); }});
    }
    const controller = create();
    function tick(value = now) {
        now = value;
        for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
    }
    const h = {context, controller, owner, create, timers, allTimers, frames, blobs, revoked, calls, errors, waits,
        events, sdk, alerts, stack, downloads, tick,
        get now() { return now; }, set now(v) { now = v; },
        set allowed(v) { allowed = v; }, set current(v) { current = v; },
        get printCalls() { return printCalls; }, get openCalls() { return openCalls; },
        set printThrows(v) { printThrows = v; }, set focusThrows(v) { focusThrows = v; },
        set modal(v) { modal = v; },
        request(c = controller, o = owner) { return c.request(o, () => { sdk.push(o); c.observeStart(); }); },
        async ready(url = '/printfile/a', c = controller) {
            h.request(c); c.acceptUrl(url); tick(); await flush(); return frames.at(-1);
        },
        load(frame = frames.at(-1), href = frame.src) { frame.contentWindow.location.href = href; frame.onload?.(); },
        // Built-in PDF viewers need not expose a readable location to the parent.
        loadViewer(frame = frames.at(-1), error = new DOMException('Protected PDF viewer', 'SecurityError')) {
            Object.defineProperty(frame.contentWindow.location, 'href', {
                configurable: true, get() { throw error; }
            });
            frame.onload?.();
        },
        emit(name) { for (const fn of [...(events[name] || [])]) fn(); },
        liveFrames() { return frames.filter(f => f.parentNode); }};

    // Evaluate complete controller files, not copied/extracted method implementations.
    h.wire = function () {
        function extend(proto) { function C() {} C.prototype = proto; return C; }
        const DE = {Controllers: {DocumentHolder: function () {}}, Views: {}, getController: () => main};
        window.DE = DE;
        const Common = {UI: {blockOperations: {LoadingDocument: 90}, alert(config) { alerts.push(config); return {$window: {attr() {}}}; }},
            Utils: {isChrome: true, ModalWindow: {isVisible: () => modal}},
            Gateway: {reportWarning() {}},
            localStorage: {setId() {}, setKeysFilter() {}, sync() {}},
            NotificationCenter: {trigger(name) { if (name === 'file:print') left.clickToolbarPrint(); }},
            component: {Analytics: {trackEvent() {}}}};
        const AscCommon = {
            DownloadFileFromBytes(blob, filename, mime) { downloads.push({blob, filename, mime}); },
            changeFileExtention(title, extension, limit) {
                assert.equal(extension, 'pdf'); assert.equal(limit, 255);
                return title.replace(/\.[^.]*$/, '').slice(0, limit - 4) + '.pdf';
            }
        };
        const Asc = {c_nMaxDownloadTitleLen: 255, c_oAscChartTypeSettings: new Proxy({}, {get: (_, name) => name}),
            c_oAscError: {ID: new Proxy({}, {get: (_, name) => name}), Level: {Critical: 1}},
            c_oAscAsyncAction: {Print: 7}, c_oAscAsyncActionType: {BlockInteraction: 1},
            c_oAscPrintType: {Selection: 2},
            asc_CDownloadOptions: function (fileType, isDownloadEvent) {
                this.fileType = fileType; this.isDownloadEvent = isDownloadEvent;
                this.asc_setAdvancedOptions = v => { this.advancedOptions = v; };
            }, asc_CAdjustPrint: function () { this.asc_setPrintType = v => { this.printType = v; }; }};
        Object.assign(context, {DE, Common, Asc, AscCommon, Backbone: {Controller: {extend}},
            _: {extend: Object.assign, bind: (fn, that) => fn.bind(that)},
            define(deps, factory) { factory(deps[0] === 'documenteditor/main/app/util/PrintAttempt' ? PrintAttempt : undefined); }});
        for (const rel of ['controller/Main.js', 'controller/LeftMenu.js', 'view/DocumentActions.js', 'controller/DocumentHolderExt.js']) {
            const file = path.join(root, 'apps/documenteditor/main/app', rel);
            vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
        }
        const main = new DE.Controllers.Main();
        const left = new DE.Controllers.LeftMenu();
        Object.assign(main, {appOptions: {canPrint: true}, permissions: {print: true}, document: {key: 'A'},
            stackLongActions: {push: a => stack.push(a), pop(a) {
                const i = stack.findIndex(v => v.type === a.type && v.id === a.id); if (i >= 0) stack.splice(i, 1);
            }, get(a) { return stack.find(v => v.type === a.type); }}, setLongActionView() {},
            updateWindowTitle() {}, hidePreloader() {}, onEditComplete() {},
            getApplication: () => ({getController: () => ({setStatusCaption() {}})}),
            printTextText: 'Printing document...', errorAccessDeny: 'ACCESS', downloadErrorText: 'DOWNLOAD', notcriticalErrorTitle: 'Warning'});
        main.api = {asc_Print(opts) { sdk.push(opts); main.onLongActionBegin(1, 7); }, asc_enableKeyEvents() {},
            asc_registerCallback() {}, asc_setDocInfo() {}, asc_getEditorPermissions() {}};
        Object.assign(left, {api: main.api, mode: main.appOptions, getApplication: () => ({getController: () => main}),
            leftMenu: {menuFile: {hide() {}}, showMenu() {}}, onEditComplete() {}});
        const actions = DE.Views.DocumentActions;
        actions.init(main.api, {});
        const selection = new DE.Controllers.DocumentHolder();
        Object.assign(selection, {api: main.api, mode: main.appOptions, editComplete() {}});
        Object.assign(h, {main, left, actions, selection, Common, Asc});
        return h;
    };
    return h;
}
function response(bytes = pdf, status = 200) {
    return {status, headers: {get: () => 'application/pdf'}, blob: () => Promise.resolve(new Blob([bytes]))};
}
let passed = 0, failed = 0;
async function check(name, fn) {
    let watchdog;
    try {
        await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
            watchdog = setTimeout(() => reject(Error('test did not settle')), 5000);
        })]);
        console.log('PASS', name); passed++;
    } catch (e) { console.error('FAIL', name, e.stack); failed++; }
    finally { clearTimeout(watchdog); }
}
async function run() {
    await check('silent SDK rejection creates no wait, timer or lock; later explicit request converts afresh', async () => {
        const h = harness();
        h.controller.request(h.owner, () => {});
        h.controller.acceptUrl('/unrequested'); h.tick(); await flush();
        assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0); assert.equal(h.waits.length, 0);
        await h.ready(); assert.equal(h.sdk.length, 1); assert.equal(h.calls.length, 1);
    });
    await check('accepted expectation survives silent rejection and consumes one URL; no SDK conversion gate', async () => {
        const h = harness(); h.request(); h.controller.request(h.owner, () => {});
        h.controller.acceptUrl('/printfile/a'); h.controller.acceptUrl('/duplicate');
        h.tick(); await flush(); assert.equal(h.calls.length, 1);
        h.load(); h.controller.acceptUrl('/duplicate-after-handoff'); h.tick(); await flush();
        assert.equal(h.printCalls, 1); assert.equal(h.calls.length, 1);
        h.request(); assert.equal(h.sdk.length, 2);
    });
    await check('dispatch reentrancy and GET duplicates are suppressed without queued conversion', async () => {
        const pending = deferred(), h = harness(() => pending.promise);
        h.controller.request(h.owner, () => { h.controller.observeStart(); assert.equal(h.request(), false); });
        h.controller.acceptUrl('/printfile/a'); assert.equal(h.request(), false);
        h.tick(); assert.equal(h.request(), false); pending.resolve(response()); await flush();
        assert.equal(h.request(), false); h.load(); await flush(); assert.equal(h.sdk.length, 0);
    });
    await check('URL handling defers GET/wait until after the SDK callback returns', async () => {
        const h = harness(); h.request(); h.controller.acceptUrl('/printfile/a');
        assert.equal(h.calls.length, 0); assert.equal(h.waits.length, 0);
        h.tick(); await flush(); assert.equal(h.calls.length, 1); assert.equal(h.waits.length, 1);
    });
    await check('same validated bytes only; blank and duplicate load ignored, at most one print', async () => {
        const h = harness(); const frame = await h.ready();
        assert.equal(h.blobs[0].type, 'application/pdf');
        assert.deepEqual(Buffer.from(await h.blobs[0].arrayBuffer()), pdf);
        assert.match(frame.src, /^blob:/); assert.equal(frame.style.display, undefined);
        assert.equal(frame.id, 'id-print-frame');
        h.load(frame, 'about:blank'); assert.equal(h.printCalls, 0);
        const lateLoad = frame.onload; h.load(frame); lateLoad();
        assert.equal(h.printCalls, 1); assert.equal(h.openCalls, 0);
        assert.equal(h.waits[0].removed, 1); assert.equal(h.liveFrames().length, 1);
    });
    await check('protected PDF viewer prints once after early blank load and retains its Blob until unload', async () => {
        const h = harness(), frame = await h.ready(), lateLoad = frame.onload;
        h.load(frame, 'about:blank');
        assert.equal(h.printCalls, 0); assert.equal(h.errors.length, 0);
        assert.equal(h.waits[0].removed, 0); assert.deepEqual(h.liveFrames(), [frame]);
        h.loadViewer(frame); lateLoad();
        assert.equal(h.printCalls, 1); assert.equal(h.errors.length, 0); assert.equal(h.openCalls, 0);
        assert.equal(h.calls.length, 1); assert.equal(h.waits[0].removed, 1); assert.equal(h.timers.size, 0);
        h.controller.dispose(); h.tick(61000);
        assert.deepEqual(h.liveFrames(), [frame]); assert.equal(h.revoked.length, 0);
        h.emit('unload'); assert.equal(h.liveFrames().length, 0); assert.deepEqual(h.revoked, [frame.src]);
    });
    await check('changed assigned src cannot bypass the Blob guard with a protected location', async () => {
        const h = harness(), frame = await h.ready(), assigned = frame.src;
        frame.src = 'https://other.example.test/not-the-pdf'; h.loadViewer(frame);
        assert.equal(h.printCalls, 0); assert.equal(h.errors.length, 0); assert.equal(h.waits[0].removed, 0);
        h.tick(31000);
        assert.equal(h.printCalls, 0); assert.equal(h.errors[0].code, 'timeout');
        assert.deepEqual(h.revoked, [assigned]); assert.equal(h.liveFrames().length, 0);
    });
    await check('readable unexpected viewer navigation still fails without print or fallback', async () => {
        const h = harness(), frame = await h.ready();
        h.load(frame, 'https://editor.example.test/not-the-pdf');
        assert.equal(h.printCalls, 0); assert.equal(h.openCalls, 0); assert.equal(h.errors.length, 1);
        assert.equal(h.waits[0].removed, 1); assert.deepEqual(h.revoked, [frame.src]);
        assert.equal(h.liveFrames().length, 0);
    });
    await check('unexpected location getter failure is reported and releases the unhanded Blob', async () => {
        const h = harness(), frame = await h.ready(), error = new TypeError('broken viewer');
        h.loadViewer(frame, error);
        assert.equal(h.printCalls, 0); assert.equal(h.openCalls, 0); assert.deepEqual(h.errors, [error]);
        assert.equal(h.waits[0].removed, 1); assert.deepEqual(h.revoked, [frame.src]);
        assert.equal(h.liveFrames().length, 0);
    });
    for (const kind of ['rights', 'document', 'dispose']) {
        await check(kind + ' invalidation prevents protected viewer handoff', async () => {
            const h = harness(), frame = await h.ready();
            if (kind === 'rights') h.allowed = false;
            if (kind === 'document') h.current = {};
            if (kind === 'dispose') h.controller.dispose();
            h.loadViewer(frame);
            assert.equal(h.printCalls, 0); assert.equal(h.errors.length, 0);
            assert.equal(h.waits[0].removed, 1); assert.deepEqual(h.revoked, [frame.src]);
            assert.equal(h.liveFrames().length, 0);
        });
    }
    await check('late protected viewer load cannot print or release a newer attempt', async () => {
        const h = harness(), old = await h.ready(), lateLoad = old.onload;
        h.tick(31000); const fresh = await h.ready('/printfile/fresh');
        h.loadViewer(old); lateLoad();
        assert.equal(h.printCalls, 0); assert.equal(h.waits[1].removed, 0);
        assert.deepEqual(h.liveFrames(), [fresh]); assert.deepEqual(h.revoked, [old.src]);
        h.loadViewer(fresh);
        assert.equal(h.printCalls, 1); assert.equal(h.errors.length, 1);
        assert.equal(h.waits[1].removed, 1); assert.deepEqual(h.liveFrames(), [fresh]);
    });
    for (const kind of ['rights', 'document', 'dispose']) {
        await check(kind + ' invalidation before deferred GET makes no request', async () => {
            const h = harness(); h.request(); h.controller.acceptUrl('/printfile/a');
            if (kind === 'rights') h.allowed = false;
            if (kind === 'document') h.current = {};
            if (kind === 'dispose') h.controller.dispose();
            h.tick(); await flush(); assert.equal(h.calls.length, 0); assert.equal(h.printCalls, 0);
        });
        await check(kind + ' invalidation during body never hands PDF to a frame', async () => {
            const body = deferred(), h = harness(() => Promise.resolve({...response(), blob: () => body.promise}));
            h.request(); h.controller.acceptUrl('/printfile/a'); h.tick(); await flush();
            if (kind === 'rights') h.allowed = false;
            if (kind === 'document') h.current = {};
            if (kind === 'dispose') h.controller.dispose();
            body.resolve(new Blob([pdf])); await flush();
            assert.equal(h.frames.length, 0); assert.equal(h.printCalls, 0); assert.equal(h.waits[0].removed, 1);
        });
    }
    for (const status of [401, 403, 404, 500, 502, 503]) {
        await check('HTTP ' + status + ' visibly fails without print/open and permits fresh conversion', async () => {
            let ok = false; const h = harness(() => Promise.resolve(response(pdf, ok ? 200 : status)));
            await h.ready(); assert.equal(h.errors.length, 1); assert.equal(h.errors[0].status, status);
            assert.equal(h.printCalls, 0); assert.equal(h.openCalls, 0); assert.equal(h.waits[0].removed, 1);
            ok = true; await h.ready('/printfile/fresh'); h.load();
            assert.equal(h.sdk.length, 2); assert.equal(h.calls.length, 2); assert.equal(h.printCalls, 1);
        });
    }
    for (const failure of ['network', 'invalid', 'empty-url', 'print', 'focus']) {
        await check(failure + ' error has no raw URL fallback', async () => {
            const h = harness(failure === 'network' ? () => Promise.reject(Error('offline')) :
                failure === 'invalid' ? () => Promise.resolve(response(Buffer.from('<html>error</html>'))) : undefined);
            if (failure === 'print') h.printThrows = true;
            if (failure === 'focus') h.focusThrows = true;
            await h.ready(failure === 'empty-url' ? '' : '/printfile/a');
            if (h.frames.length) h.load();
            assert.equal(h.errors.length, 1); assert.equal(h.openCalls, 0);
            assert.equal(h.printCalls, failure === 'print' ? 1 : 0);
            assert.equal(h.liveFrames().length, failure === 'print' ? 1 : 0);
        });
    }
    await check('30s post-body deadline includes viewer wait and frozen timers', async () => {
        const h = harness(); const frame = await h.ready(); const late = frame.onload;
        h.now = 31000; h.load(); assert.equal(h.printCalls, 0); assert.equal(h.errors.length, 1);
        assert.equal(h.errors[0].code, 'timeout'); assert.equal(h.liveFrames().length, 0);
        late(); h.tick(); assert.equal(h.errors.length, 1);
    });
    await check('timeout aborts stalled fetch; old completion/timer/load cannot change retry', async () => {
        const old = deferred(); let first = true;
        const h = harness(() => { if (first) { first = false; return old.promise; } return Promise.resolve(response()); });
        h.request(); h.controller.acceptUrl('/printfile/old'); h.tick();
        const oldTimers = [...h.allTimers]; h.tick(31000); await flush();
        assert.equal(h.errors.length, 1); assert.equal(h.calls[0].opts.signal.aborted, true);
        const fresh = await h.ready('/printfile/new'); old.resolve(response()); oldTimers.forEach(fn => fn()); await flush();
        assert.equal(h.waits[1].removed, 0); assert.equal(h.liveFrames().length, 1);
        h.load(fresh); assert.equal(h.printCalls, 1); assert.equal(h.errors.length, 1);
    });
    await check('late load after viewer timeout cannot print or remove the new frame/wait', async () => {
        const h = harness(); const old = await h.ready(); const lateLoad = old.onload;
        h.tick(31000); await flush(); const fresh = await h.ready('/printfile/b');
        old.contentWindow.location.href = old.src; lateLoad();
        assert.equal(h.printCalls, 0); assert.equal(h.waits[1].removed, 0); h.load(fresh);
        assert.equal(h.printCalls, 1); assert.equal(h.liveFrames()[0], fresh);
    });
    await check('handed preview survives all input, deadlines, disposal and failing new document GET', async () => {
        let fail = false; const h = harness(() => Promise.resolve(response(pdf, fail ? 404 : 200)));
        const old = await h.ready(); h.load(old); const oldTimers = [...h.allTimers];
        for (const name of ['pointerdown', 'keydown', 'afterprint', 'focus']) h.emit(name);
        h.tick(61000); oldTimers.forEach(fn => fn()); h.controller.dispose();
        assert.equal(h.liveFrames()[0], old); assert.equal(h.revoked.length, 0);
        const other = h.create(); fail = true; await h.ready('/printfile/new-document', other);
        assert.equal(h.liveFrames()[0], old); assert.equal(h.revoked.length, 0);
        fail = false; const fresh = await h.ready('/printfile/new-document-current', other);
        assert.equal(old.parentNode, null, 'validated bytes replace the old viewer before new load');
        assert.equal(h.liveFrames().length, 1);
        h.load(fresh); assert.deepEqual(h.liveFrames(), [fresh]); assert.equal(h.revoked.length, 1);
        h.emit('unload'); assert.equal(h.liveFrames().length, 0); assert.equal(h.revoked.length, 2);
    });
    await check('print throw retains handed resources and allows explicit retry without permanent gate', async () => {
        const h = harness(); h.printThrows = true; const old = await h.ready(); h.load(old);
        h.controller.dispose(); assert.equal(h.revoked.length, 0);
        h.printThrows = false; const fresh = await h.ready('/printfile/fresh', h.create()); h.load(fresh);
        assert.equal(h.printCalls, 2); assert.equal(h.errors.length, 1);
        assert.equal(h.liveFrames().length, 1); assert.equal(h.openCalls, 0);
    });
    await check('repeated prints retain only one handed frame and release only their wait', async () => {
        const h = harness();
        for (let i = 0; i < 6; i++) { const frame = await h.ready('/printfile/' + i); h.load(frame); }
        assert.equal(h.liveFrames().length, 1); assert.equal(h.revoked.length, 5); assert.equal(h.printCalls, 6);
        assert.ok(h.waits.every(w => w.removed === 1));
    });
    await check('actual Main/compact/LeftMenu/CtrlP/Selection route through the same controller', async () => {
        const h = harness().wire();
        h.actions.print(); h.main.onPrintUrl('/printfile/a'); h.tick(); await flush();
        h.main.onPrint(); h.selection.onPrintSelection(); h.actions.print(); assert.equal(h.sdk.length, 1);
        h.load(); h.main.onPrint(); assert.equal(h.sdk.length, 2);
        assert.equal(h.sdk[1].isDownloadEvent, true);
        h.selection.onPrintSelection(); assert.equal(h.sdk.length, 3);
        assert.equal(h.sdk[2].advancedOptions.printType, 2);
    });
    await check('web UA split uses validated Blob print or download while preserving SDK options', async () => {
        for (const [ua, inline] of [[{isChrome: true}, true], [{isOpera: true}, true],
            [{isGecko: true, firefoxVersion: 86}, false], [{isGecko: true, firefoxVersion: 154}, true],
            [{isSafari: true}, false], [{isIE: true}, false], [{isEdge: true}, false], [{}, false]]) {
            const h = harness().wire(); h.main.document.title = 'Quarterly report.docx';
            Object.assign(h.Common.Utils, {isChrome: false, isOpera: false, isGecko: false}, ua);
            const options = {isDownloadEvent: false, advancedOptions: {selection: 2}, callback: null, custom: 'preserve', withoutPassword: false};
            h.main.requestPrint(options, h.main.api);
            assert.equal(h.sdk.at(-1), options); assert.equal(options.isDownloadEvent, true);
            assert.equal(options.custom, 'preserve'); assert.equal(options.withoutPassword, false);
            assert.equal(options.advancedOptions.selection, 2);
            h.main.onPrintUrl('/printfile/validated'); h.tick(); await flush();
            assert.equal(h.calls.length, 1); assert.equal(h.blobs.length, inline ? 1 : 0);
            const delivered = inline ? h.blobs[0] : h.downloads[0].blob;
            assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), pdf);
            assert.equal(delivered.type, 'application/pdf');
            assert.equal(h.frames.length, inline ? 1 : 0);
            if (inline) h.load();
            assert.equal(h.printCalls, inline ? 1 : 0); assert.equal(h.downloads.length, inline ? 0 : 1);
            if (!inline) {
                assert.equal(h.downloads[0].filename, 'Quarterly report.pdf');
                assert.equal(h.downloads[0].mime, 'application/pdf');
            }
            assert.equal(h.alerts.length, 0); assert.equal(h.openCalls, 0); assert.equal(h.revoked.length, 0);
        }
    });
    await check('download hands validated Selection to SDK helper once and does not own or revoke its resources', async () => {
        const h = harness().wire(); h.Common.Utils.isChrome = false;
        h.main.document.title = 'Selected pages.docx';
        h.selection.onPrintSelection(); h.main.onPrintUrl('/printfile/selection'); h.tick(); await flush();
        assert.equal(h.sdk[0].advancedOptions.printType, 2); assert.equal(h.downloads.length, 1);
        assert.equal(h.downloads[0].filename, 'Selected pages.pdf');
        assert.equal(h.frames.length, 0); assert.equal(h.printCalls, 0); assert.equal(h.openCalls, 0);
        assert.equal(h.context.document.body.children.length, 0, 'own wait is removed');
        h.main.onPrintUrl('/duplicate'); h.main.disposePrint(); h.tick(61000);
        assert.equal(h.downloads.length, 1); assert.equal(h.blobs.length, 0); assert.equal(h.revoked.length, 0);
        h.actions.print(); h.main.onPrintUrl('/printfile/fresh'); h.tick(); await flush();
        assert.equal(h.downloads.length, 2); assert.equal(h.calls.length, 2);
        h.emit('unload'); assert.equal(h.revoked.length, 0);
        assert.deepEqual(Buffer.from(await h.downloads[0].blob.arrayBuffer()), pdf);
    });
    await check('download helper failure reports once, releases the gate and never retries the original URL', async () => {
        const h = harness().wire(); h.Common.Utils.isChrome = false;
        const helper = h.context.AscCommon.DownloadFileFromBytes;
        h.context.AscCommon.DownloadFileFromBytes = () => { throw Error('download handoff'); };
        h.actions.print(); h.main.onPrintUrl('/printfile/old'); h.tick(); await flush();
        assert.equal(h.alerts.length, 1); assert.equal(h.frames.length, 0); assert.equal(h.openCalls, 0);
        assert.equal(h.context.document.body.children.length, 0);
        h.context.AscCommon.DownloadFileFromBytes = helper;
        h.actions.print(); h.main.onPrintUrl('/printfile/fresh'); h.tick(); await flush();
        assert.equal(h.downloads.length, 1); assert.equal(h.calls.length, 2); assert.equal(h.alerts.length, 1);
        assert.match(h.calls[1].url, /fresh$/);
    });
    await check('download branch validates before handoff and respects late permission loss', async () => {
        for (const reason of ['invalid', 'rights']) {
            const body = deferred(), h = harness(() => Promise.resolve({...response(), blob: () => body.promise})).wire();
            h.Common.Utils.isChrome = false;
            h.actions.print(); h.main.onPrintUrl('/printfile/a'); h.tick(); await flush();
            if (reason === 'rights') h.main.permissions.print = false;
            body.resolve(new Blob([reason === 'invalid' ? '<html>error</html>' : pdf])); await flush();
            assert.equal(h.downloads.length, 0); assert.equal(h.frames.length, 0); assert.equal(h.blobs.length, 0);
            assert.equal(h.alerts.length, reason === 'invalid' ? 1 : 0);
        }
    });
    for (const stall of [false, true]) {
        await check('controller shares streaming progress deadline: ' + (stall ? 'stall cancels' : 'over 30s succeeds'), async () => {
            const reads = []; let cancelled = 0;
            const h = harness(() => Promise.resolve({...response(), body: {getReader: () => ({
                read() { const d = deferred(); reads.push(d); return d.promise; },
                cancel() { cancelled++; return Promise.resolve(); }, releaseLock() {}
            })}}));
            await h.ready();
            h.tick(20000); assert.equal(reads.length, 1);
            reads.shift().resolve({value: pdf.subarray(0, 9), done: false}); await flush();
            if (stall) {
                h.tick(50000); await flush();
                assert.equal(h.errors[0].code, 'timeout'); assert.equal(cancelled, 1);
                assert.equal(h.frames.length, 0); assert.equal(h.waits[0].removed, 1);
            } else {
                h.tick(40000); reads.shift().resolve({value: pdf.subarray(9), done: false}); await flush();
                reads.shift().resolve({done: true}); await flush();
                h.tick(65000); assert.equal(h.errors.length, 0); assert.equal(h.waits[0].removed, 0);
                h.load(); assert.equal(h.printCalls, 1); assert.equal(h.calls.length, 1);
                assert.equal(h.waits[0].removed, 1); assert.equal(cancelled, 0);
            }
        });
    }
    await check('actual entry points recheck rights/modal and API ownership before conversion or GET', async () => {
        const h = harness().wire();
        for (const reason of ['right', 'modal', 'api']) {
            h.main.appOptions.canPrint = reason !== 'right'; h.modal = reason === 'modal';
            const original = h.main.api; if (reason === 'api') h.main.api = {asc_Print() { throw Error('wrong api'); }};
            h.actions.print(); h.selection.onPrintSelection(); h.left.clickMenuFileItem(null, 'print');
            h.main.onPrintUrl('/unexpected'); h.tick(); await flush(); h.main.api = original;
        }
        assert.equal(h.sdk.length, 0); assert.equal(h.calls.length, 0);
    });
    await check('actual Main binds owner document/key/API/rights and dispose; late events do not cross owners', async () => {
        for (const change of ['key', 'document', 'api', 'rights', 'dispose']) {
            const h = harness().wire(); h.actions.print(); h.main.onPrintUrl('/printfile/a');
            if (change === 'key') h.main.document.key = 'B';
            if (change === 'document') h.main.document = {key: 'B'};
            if (change === 'api') h.main.api = {};
            if (change === 'rights') h.main.permissions.print = false;
            if (change === 'dispose') h.main.disposePrint();
            h.tick(); await flush(); assert.equal(h.calls.length, 0, change);
        }
    });
    await check('actual Main maps access/download errors to existing localized alerts, without SDK stack cleanup', async () => {
        for (const status of [401, 403, 404, 503]) {
            const h = harness(() => Promise.resolve(response(pdf, status))).wire();
            h.actions.print(); h.main.onPrintUrl('/printfile/a'); h.tick(); await flush();
            assert.equal(h.alerts.length, 1); assert.equal(h.alerts[0].msg, status === 401 || status === 403 ? 'ACCESS' : 'DOWNLOAD');
            assert.equal(h.stack.length, 1); assert.equal(h.stack[0].id, 7);
        }
    });
    await check('desktop dispatch keeps original options and bypasses web controller', () => {
        const h = harness().wire(); h.main.appOptions.isDesktopApp = true;
        h.main.api.asc_Print = opts => h.sdk.push(opts);
        const options = {isDownloadEvent: false, advancedOptions: {print: 1}};
        h.main.requestPrint(options, h.main.api); assert.equal(h.sdk[0], options);
        assert.equal(options.isDownloadEvent, false); assert.equal(h.main._printController, undefined);
    });
    await check('SDK early End and late generic error preserve permit and active GET; SDK UI retains its own stack', async () => {
        const body = deferred();
        const h = harness(() => Promise.resolve({...response(), blob: () => body.promise})).wire();
        h.actions.print(); h.main.onLongActionEnd(1, 7);
        h.main.onPrintUrl('/printfile/a'); h.tick(); await flush();
        const ownMask = h.context.document.body.children[0];
        h.main.onError('DownloadError', 0);
        assert.equal(h.alerts.length, 1, 'existing SDK error still shown');
        assert.ok(ownMask.parentNode, 'SDK error does not remove GET wait');
        h.actions.print(); assert.equal(h.sdk.length, 1, 'GET gate remains occupied');
        body.resolve(new Blob([pdf])); await flush(); h.load();
        assert.equal(h.printCalls, 1); assert.equal(ownMask.parentNode, null);
    });
    await check('actual silent rejection of Selection does not clear an accepted menu URL', async () => {
        const h = harness().wire(); h.actions.print();
        h.main.api.asc_Print = opts => h.sdk.push(opts); // SDK busy: no StartAction
        h.selection.onPrintSelection(); h.main.onPrintUrl('/printfile/menu');
        h.tick(); await flush(); h.load();
        assert.equal(h.calls.length, 1); assert.equal(h.printCalls, 1);
        assert.equal(h.sdk[1].advancedOptions.printType, 2);
    });
    await check('actual retry passes fresh Selection to SDK and never refetches disappeared old URL', async () => {
        let ok = false;
        const h = harness(() => Promise.resolve(response(pdf, ok ? 200 : 404))).wire();
        h.actions.print(); h.main.onPrintUrl('/printfile/disappeared'); h.tick(); await flush();
        assert.equal(h.alerts.length, 1);
        ok = true; h.selection.onPrintSelection(); h.main.onPrintUrl('/printfile/current-selection');
        h.tick(); await flush(); h.load();
        assert.equal(h.sdk.length, 2); assert.equal(h.sdk[1].advancedOptions.printType, 2);
        assert.match(h.calls[1].url, /current-selection$/); assert.equal(h.printCalls, 1);
    });
    await check('actual loadDocument invalidates permit/GET before replacing document identity', async () => {
        const pending = deferred(), h = harness(() => pending.promise).wire();
        h.actions.print(); h.main.onPrintUrl('/printfile/a'); h.tick();
        h.main.editorConfig = {customization: {toolbarNoTabs: true}};
        h.main.loadDocument({doc: null});
        assert.equal(h.calls[0].opts.signal.aborted, true);
        pending.resolve(response()); await flush();
        assert.equal(h.frames.length, 0); assert.equal(h.alerts.length, 0);
        h.main.onPrintUrl('/printfile/late'); h.tick(); assert.equal(h.calls.length, 1);
    });
    await check('unrelated StartAction and asynchronous Print Start create no URL permit', async () => {
        const h = harness().wire();
        h.main.api.asc_Print = () => h.main.onLongActionBegin(1, 99);
        h.actions.print(); h.main.onLongActionBegin(1, 7); h.main.onPrintUrl('/printfile/unexpected');
        h.tick(); await flush(); assert.equal(h.calls.length, 0);
    });
    await check('synchronous SDK exception propagates unchanged and finally releases dispatch guard', async () => {
        const h = harness().wire(), boom = Error('SDK failure'), original = h.main.api.asc_Print;
        h.main.api.asc_Print = () => { throw boom; };
        assert.throws(() => h.actions.print(), e => e === boom);
        h.main.api.asc_Print = original; h.actions.print(); h.main.onPrintUrl('/printfile/fresh');
        h.tick(); await flush(); h.load(); assert.equal(h.printCalls, 1);
    });
    await check('sync PrintUrl during dispatch consumes permit without reentrant GET or SDK throw', async () => {
        const h = harness().wire();
        h.main.api.asc_Print = () => {
            h.main.onLongActionBegin(1, 7); h.main.onPrintUrl('');
            assert.equal(h.calls.length, 0); assert.equal(h.alerts.length, 0);
            h.main.onLongActionEnd(1, 7);
        };
        assert.doesNotThrow(() => h.actions.print()); h.tick(); await flush();
        assert.equal(h.alerts.length, 1); assert.equal(h.calls.length, 0);
    });
    await check('foreign wait node remains through own failure, SDK End and disposal', async () => {
        const h = harness(() => Promise.resolve(response(pdf, 404))).wire();
        const foreign = h.context.document.createElement('div'); h.context.document.body.appendChild(foreign);
        h.actions.print(); h.main.onPrintUrl('/printfile/a'); h.tick(); await flush();
        h.main.onLongActionEnd(1, 7); h.main.disposePrint();
        assert.deepEqual(h.context.document.body.children, [foreign]); assert.equal(h.alerts.length, 1);
    });
    await check('old viewer stays during deferred validation; replacement never has two frame/object URLs', async () => {
        const body = deferred(); let count = 0;
        const h = harness(() => Promise.resolve(++count === 1 ? response() : {...response(), blob: () => body.promise}));
        const old = await h.ready(); h.load(old);
        h.request(); h.controller.acceptUrl('/printfile/b'); h.tick(); await flush();
        assert.deepEqual(h.liveFrames(), [old]); assert.equal(h.blobs.length - h.revoked.length, 1);
        body.resolve(new Blob([pdf])); await flush();
        assert.equal(old.parentNode, null); assert.equal(h.liveFrames().length, 1);
        assert.equal(h.blobs.length - h.revoked.length, 1);
        h.load(); assert.equal(h.printCalls, 2);
    });
    for (const failure of ['load-error', 'timeout', 'dispose', 'object-url', 'frame-allocation']) {
        await check('partial replacement ' + failure + ' clears only new unhanded resources without restoring old preview', async () => {
            const h = harness(); const old = await h.ready(); h.load(old);
            if (failure === 'object-url') h.context.URL.createObjectURL = () => { throw Error('allocation'); };
            if (failure === 'frame-allocation') h.context.document.createElement = () => { throw Error('allocation'); };
            const next = await h.ready('/printfile/b');
            if (failure === 'load-error') next.onerror();
            if (failure === 'timeout') h.tick(31000);
            if (failure === 'dispose') h.controller.dispose();
            await flush();
            assert.equal(old.parentNode, null); assert.equal(h.liveFrames().length, 0);
            assert.equal(h.blobs.length - h.revoked.length, 0);
            assert.equal(h.printCalls, 1); assert.equal(h.openCalls, 0);
            assert.equal(h.errors.length, failure === 'dispose' ? 0 : 1);
        });
    }
    await check('stalled body reaches deadline, aborts once and never opens late content', async () => {
        const body = deferred(), h = harness(() => Promise.resolve({...response(), blob: () => body.promise}));
        await h.ready(); h.tick(31000); await flush();
        assert.equal(h.errors.length, 1); assert.equal(h.calls[0].opts.signal.aborted, true);
        body.resolve(new Blob([pdf])); await flush(); assert.equal(h.frames.length, 0);
        assert.equal(h.waits[0].removed, 1);
    });
    await check('frozen deferred start checks initial inactivity deadline before issuing any GET', async () => {
        const h = harness(); h.request(); h.controller.acceptUrl('/printfile/a');
        h.tick(31000); await flush();
        assert.equal(h.errors.length, 1); assert.equal(h.calls.length, 0); assert.equal(h.waits.length, 0);
    });
    await check('SDK error/old success before the next URL is not misrepresented as transport correlation', async () => {
        const h = harness().wire();
        h.actions.print(); h.main.onError('DownloadError', 0); h.main.onLongActionEnd(1, 7);
        h.selection.onPrintSelection(); h.main.onPrintUrl('/printfile/uncorrelated-sdk-result');
        h.tick(); await flush(); assert.equal(h.sdk.length, 2); assert.equal(h.calls.length, 1);
        // Main cannot tell whether this URL was produced by A or B. This test
        // explicitly documents the bounded permit, not a promise of correct SDK correlation.
        h.main.onError('DownloadError', 0); h.load(); assert.equal(h.printCalls, 1);
        assert.equal(h.alerts.length, 2, 'both SDK errors retain baseline visibility');
    });
    await check('missing optional access translation falls back to the existing localized download error', async () => {
        const h = harness(() => Promise.resolve(response(pdf, 401))).wire();
        h.main.errorAccessDeny = undefined; h.actions.print(); h.main.onPrintUrl('/printfile/a');
        h.tick(); await flush(); assert.equal(h.alerts[0].msg, 'DOWNLOAD');
    });
    console.log(`${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
}
run().catch(e => { console.error(e); process.exitCode = 1; });
