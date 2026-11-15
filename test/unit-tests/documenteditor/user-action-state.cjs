/* Run: node test/unit-tests/documenteditor/user-action-state.cjs
 * Runs the complete Gateway and DocsAPI sources in separate vm contexts, connected through postMessage.
 * The host DOM is a stub; event routing and callback arguments come from the real sources.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const GATEWAY = 'apps/common/Gateway.js';
const API = 'apps/api/documents/api.js';
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const FRAME_ID = 'editor';
const EDITOR_ORIGIN = 'https://editor.example.test';
const HOST_ORIGIN = 'https://host.example.test';
const state = (name = 'required', requestId = 1) => ({version: 1, state: name, requestId});

function host(events, source = read(API)) {
    const listeners = new Set();
    const frames = [];
    const placeholder = {parentNode: {replaceChild(frame, previous) {
        assert.equal(previous, placeholder);
        frames.push(frame);
    }}};
    const document = {
        getElementById(id) { assert.equal(id, FRAME_ID); return placeholder; },
        getElementsByTagName(tag) {
            assert.equal(tag, 'script');
            return [{src: EDITOR_ORIGIN + '/web-apps/apps/api/documents/api.js'}];
        },
        createElement(tag) {
            assert.equal(tag, 'iframe');
            return {style: {}, setAttribute() {}, contentWindow: {postMessage() {}}};
        }
    };
    const window = {
        JSON,
        location: {origin: HOST_ORIGIN, search: ''},
        addEventListener(name, listener) { if (name === 'message') listeners.add(listener); },
        removeEventListener(name, listener) { if (name === 'message') listeners.delete(listener); },
        alert(message) { assert.fail(message); }
    };
    window.parent = window;
    vm.runInNewContext(source, {window, document, console}, {filename: API});
    new window.DocsAPI.DocEditor(FRAME_ID, {events});
    assert.equal(frames.length, 1, 'real DocEditor creates its iframe');
    assert.equal(listeners.size, 1, 'real MessageDispatcher subscribes');
    return {
        window,
        receive(data, origin = EDITOR_ORIGIN, source = frames[0].contentWindow) {
            for (const listener of listeners) listener({data, origin, source});
        }
    };
}

function gateway(receiver, frameId = FRAME_ID, source = read(GATEWAY)) {
    const messages = [];
    const window = {
        Common: {}, JSON, frameEditorId: frameId,
        addEventListener() {},
        parent: {postMessage(data, origin) {
            messages.push({data, origin});
            if (receiver) receiver.receive(data);
        }}
    };
    vm.runInNewContext(source, {
        window, Common: window.Common,
        $: () => ({on() {}, trigger() {}})
    }, {filename: GATEWAY});
    return {api: window.Common.Gateway, messages};
}

function recordingCallback(calls) {
    return function(event) { calls.push({context: this, event}); };
}

let passed = 0, failed = 0;
function check(name, run) {
    try { run(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

check('gatewayPayloadContainsOnlyStateAndId', () => {
    const g = gateway();
    for (const name of ['required', 'resumed']) {
        const payload = state(name, Number.MAX_SAFE_INTEGER);
        g.api.userActionStateChanged(Object.assign({}, payload, {
            password: 'unused', title: 'unused', url: 'unused', token: 'unused', options: {encoding: 1}
        }));
        const message = g.messages.at(-1);
        assert.equal(message.origin, '*');
        assert.equal(typeof message.data, 'string');
        assert.deepEqual(JSON.parse(message.data), {
            event: 'onUserActionStateChanged', data: payload, frameEditorId: FRAME_ID
        });
    }
    assert.equal(g.messages.length, 2);
});

check('legacyCallbackUnchanged', () => {
    const calls = [];
    const h = host({onUserActionRequired: recordingCallback(calls)});
    const g = gateway(h);
    g.api.userActionRequired();
    g.api.userActionRequired();
    assert.equal(calls.length, 2);
    for (const message of g.messages) {
        assert.deepEqual(JSON.parse(message.data), {event: 'onUserActionRequired', frameEditorId: FRAME_ID});
    }
    for (const call of calls) {
        assert.deepEqual(Object.keys(call.event).sort(), ['data', 'target']);
        assert.equal(call.event.data, undefined);
        assert.equal(call.context, call.event.target);
    }
});

check('genericRouterDeliversWithFunctionOnly', () => {
    const calls = [];
    const h = host({onUserActionStateChanged: recordingCallback(calls)});
    const g = gateway(h);
    g.api.userActionStateChanged(state());
    g.api.userActionStateChanged(state('resumed'));
    assert.equal(calls.length, 2);
    calls.forEach((call, index) => {
        assert.deepEqual(Object.keys(call.event).sort(), ['data', 'target']);
        assert.deepEqual(plain(call.event.data), state(index ? 'resumed' : 'required'));
        assert.equal(call.context, call.event.target);
        assert.ok(call.event.target instanceof h.window.DocsAPI.DocEditor);
    });
    let nonFunctionCalls = 0;
    for (const callback of [true, 'callback', 1, {}, {call() { nonFunctionCalls++; }}]) {
        const other = host({onUserActionStateChanged: callback});
        gateway(other).api.userActionStateChanged(state());
    }
    assert.equal(nonFunctionCalls, 0);
});

check('frameIdMismatchIgnored', () => {
    const calls = [];
    const h = host({onUserActionStateChanged: recordingCallback(calls)});
    gateway(h, 'other-editor').api.userActionStateChanged(state());
    assert.equal(calls.length, 0);
    gateway(h).api.userActionStateChanged(state());
    assert.equal(calls.length, 1, 'the same router accepts the active iframe id');
});

check('oldApiDeliversNewIframeEvent', () => {
    const original = execFileSync('git', ['show', 'v9.4.0.129:' + API], {cwd: ROOT, encoding: 'utf8'});
    const calls = [];
    const h = host({onUserActionStateChanged: recordingCallback(calls)}, original);
    const g = gateway(h);
    g.api.userActionStateChanged(state());
    g.api.userActionStateChanged(state('resumed'));
    assert.deepEqual(calls.map(call => plain(call.event.data)), [state(), state('resumed')]);
});

check('readyCallbackDistinguishesCurrentFrameFromForeignAndLegacy', () => {
    const original = execFileSync('git', ['show', 'v9.4.0.129:' + API], {cwd: ROOT, encoding: 'utf8'});
    const calls = [];
    const events = {onDocumentReady: recordingCallback(calls)};
    const ready = JSON.stringify({event: 'onDocumentReady', frameEditorId: FRAME_ID});
    const current = host(events);
    current.receive(ready, EDITOR_ORIGIN, {});
    current.receive(ready);
    host(events, original).receive(ready);
    assert.deepEqual(calls.map(call => call.event.sourceVerified), [false, true, undefined]);
});

check('unsubscribedHostIgnoresEvent', () => {
    let legacyCalls = 0;
    for (const events of [undefined, {}, {onUserActionStateChanged: undefined}, {
        onUserActionRequired() { legacyCalls++; }
    }]) {
        const h = host(events);
        const g = gateway(h);
        g.api.userActionStateChanged(state());
        g.api.userActionStateChanged(state('resumed'));
        assert.equal(g.messages.length, 2);
    }
    assert.equal(legacyCalls, 0, 'new state must not call the legacy handler');
});

const MAIN = 'apps/documenteditor/main/app/controller/Main.js';
const ADVANCED = {TXT: 1, DRM: 2};

/* Complete Main.js on a stub OpenDialog and SDK. No controller method is copied into this harness. */
function controller({fileType = 'docx', ready = false, requireUserAction = true, receiver} = {}) {
    const timeline = [], dialogs = [], sdk = [];
    const g = gateway({receive(raw) {
        timeline.push(JSON.parse(raw));
        if (receiver) receiver.receive(raw);
    }});
    const DE = {Controllers: {}};
    const Common = {
        Gateway: g.api,
        UI: {blockOperations: {ApplyEditRights: 3, LoadingDocument: 4}},
        Utils: {importTextType: {TXT: 'txt', DRM: 'drm'}},
        Controllers: {Desktop: {requestClose() { timeline.push('desktop-close'); }}},
        localStorage: {setId() {}, setKeysFilter() {}, sync() {}},
        Views: {OpenDialog: function(options) {
            this.options = options;
            this.show = () => timeline.push('show');
            dialogs.push(this);
        }}
    };
    Common.Views.OpenDialog.prototype.txtTitle = 'Choose %1 options';
    Common.Views.OpenDialog.prototype.txtTitleProtected = 'Protected File';
    const Asc = {
        c_oAscAdvancedOptionsID: ADVANCED,
        c_oAscChartTypeSettings: new Proxy({}, {get: (_, name) => name}),
        c_oAscAsyncActionType: {BlockInteraction: 1},
        c_oAscError: {ID: new Proxy({}, {get: (_, name) => name}), Level: {Critical: 1}}
    };
    const context = {
        Common, Asc, DE, window: {}, console,
        _: {extend: Object.assign},
        Backbone: {Controller: {extend(proto) {
            function Main() {}
            Main.prototype = proto;
            return Main;
        }}},
        define(dependencies, factory) { factory(); }
    };
    vm.runInNewContext(read(MAIN), context, {filename: MAIN});
    const main = new DE.Controllers.Main();
    const h = {main, timeline, dialogs, sdk, messages: g.messages, onSdk: null, maskVisible: false};
    Object.assign(main, {
        document: {fileType}, _isDocReady: ready,
        _state: {requireUserAction},
        appOptions: {canRequestClose: true, isDesktopApp: false, isOffline: false},
        loadMask: {
            show() { h.maskVisible = true; timeline.push('mask-show'); },
            hide() { h.maskVisible = false; timeline.push('mask-hide'); }
        },
        onLongActionEnd() { timeline.push('long-action-end'); },
        api: {
            asc_setAdvancedOptions(type, options) {
                sdk.push({type, options}); timeline.push('sdk');
                if (h.onSdk) h.onSdk(type, options);
            },
            asc_DownloadAs(options) { sdk.push({download: options}); timeline.push('download'); }
        }
    });
    h.open = (type = ADVANCED.DRM, options, mode, formatOptions) => {
        if (type === ADVANCED.TXT && options === undefined) options = {
            asc_getData: () => 'preview', asc_getCodePages: () => [65001],
            asc_getRecommendedSettings: () => ({codepage: 65001})
        };
        main.onAdvancedOptions(type, options, mode, formatOptions);
        return dialogs.at(-1);
    };
    h.states = () => timeline.filter(item => item.event === 'onUserActionStateChanged').map(item => item.data);
    h.legacyCount = () => timeline.filter(item => item.event === 'onUserActionRequired').length;
    h.submit = (dialog = dialogs.at(-1), result = 'ok', value = {drmOptions: 'fixture-input'}) =>
        dialog.options.handler(result, value);
    return h;
}

function eventIndex(h, event, name) {
    return h.timeline.findIndex(item => item.event === event && (!name || item.data.state === name));
}

check('drmShowThenSubmit', () => {
    const calls = [];
    const h = controller({receiver: host({onUserActionStateChanged: recordingCallback(calls)})});
    const dialog = h.open();
    assert.deepEqual(plain(h.states()), [state()]);
    assert.ok(h.timeline.indexOf('show') < eventIndex(h, 'onUserActionStateChanged', 'required'));
    assert.ok(Number.isSafeInteger(h.states()[0].requestId) && h.states()[0].requestId > 0);
    assert.equal(dialog.options.validatePwd, false);
    assert.equal(h.main._state.openDlg, dialog);
    h.submit(dialog);
    assert.deepEqual(plain(h.states()), [state(), state('resumed')]);
    assert.ok(eventIndex(h, 'onUserActionStateChanged', 'resumed') < h.timeline.indexOf('sdk'));
    assert.equal(h.main._state.openDlg, null);
    assert.equal(h.main.isShowOpenDialog, false);
    assert.equal(h.sdk[0].options, 'fixture-input');
    assert.equal(h.maskVisible, true);
    assert.equal(JSON.stringify(h.messages).includes('fixture-input'), false);
    assert.deepEqual(calls.map(call => plain(call.event.data)), [state(), state('resumed')]);
});

check('invalidPasswordReopensWithNewId', () => {
    const h = controller();
    h.submit(h.open());
    const next = h.open(ADVANCED.DRM, 'try again');
    assert.equal(next.options.validatePwd, true);
    h.submit(next);
    assert.deepEqual(plain(h.states()), [state(), state('resumed'), state('required', 2), state('resumed', 2)]);
    assert.equal(h.legacyCount(), 1);
});

check('localValidationKeepsRequired', () => {
    const h = controller();
    const dialog = h.open();
    /* A rejected local input does not invoke the dialog handler. The active window still guards reentry. */
    h.open();
    assert.equal(h.dialogs.length, 1);
    assert.equal(h.main._state.openDlg, dialog);
    assert.equal(h.main.isShowOpenDialog, true);
    assert.deepEqual(plain(h.states()), [state()]);
    assert.equal(h.sdk.length, 0);
});

check('cancelResumesBeforeRequestClose', () => {
    const h = controller();
    h.submit(h.open(), 'cancel');
    assert.deepEqual(plain(h.states()), [state(), state('resumed')]);
    assert.ok(eventIndex(h, 'onUserActionStateChanged', 'resumed') < eventIndex(h, 'onRequestClose'));
    assert.ok(eventIndex(h, 'onRequestClose') < h.timeline.indexOf('desktop-close'));
    assert.equal(h.main._state.openDlg, null);
    assert.equal(h.sdk.length, 0);
});

check('synchronousSdkReentryRetainsNewDialog', () => {
    for (const [fileType, type] of [['docx', ADVANCED.DRM], ['txt', ADVANCED.TXT]]) {
        const h = controller({fileType});
        const first = h.open(type);
        h.onSdk = () => { h.onSdk = null; h.open(type); };
        h.submit(first);
        assert.equal(h.dialogs.length, 2);
        assert.equal(h.main._state.openDlg, h.dialogs[1]);
        assert.equal(h.main.isShowOpenDialog, true);
        assert.equal(h.maskVisible, false, 'the previous handler must not cover the new dialog');
        assert.deepEqual(plain(h.states()), [state(), state('resumed'), state('required', 2)]);
        h.submit(h.dialogs[1]);
        assert.deepEqual(plain(h.states()), [state(), state('resumed'), state('required', 2), state('resumed', 2)]);
    }
});

check('txtOpeningReportsPair', () => {
    const h = controller({fileType: 'txt'});
    const dialog = h.open(ADVANCED.TXT);
    assert.equal(dialog.options.type, 'txt');
    assert.equal(dialog.options.closable, false);
    h.submit(dialog, 'ok', {textOptions: {codepage: 65001}});
    assert.deepEqual(plain(h.states()), [state(), state('resumed')]);
    assert.deepEqual(h.sdk, [{type: ADVANCED.TXT, options: {codepage: 65001}}]);
    assert.ok(eventIndex(h, 'onUserActionStateChanged', 'resumed') < h.timeline.indexOf('sdk'));
    assert.equal(h.main._state.openDlg, null);
});

check('txtSaveSettingsAndReadyDocumentDoNotReport', () => {
    const saving = controller({fileType: 'txt'});
    const format = {asc_setAdvancedOptions(options) { this.textOptions = options; }};
    const dialog = saving.open(ADVANCED.TXT, undefined, 2, format);
    assert.equal(dialog.options.closable, true);
    saving.submit(dialog, 'ok', {textOptions: {codepage: 65001}});
    assert.deepEqual(saving.states(), []);
    assert.equal(saving.sdk[0].download, format);
    assert.deepEqual(format.textOptions, {codepage: 65001});
    for (const [fileType, type] of [['txt', ADVANCED.TXT], ['docx', ADVANCED.DRM]]) {
        const h = controller({fileType, ready: true});
        h.submit(h.open(type));
        assert.deepEqual(h.states(), []);
    }
});

check('pdfAndOtherFileTypesDoNotReport', () => {
    for (const fileType of ['pdf', 'doc', 'odt', 'xlsx', 'pptx', 'txt', null]) {
        const h = controller({fileType});
        h.submit(h.open());
        assert.deepEqual(h.states(), [], String(fileType));
        assert.equal(h.sdk.length, 1);
    }
    const h = controller();
    h.submit(h.open(ADVANCED.TXT), 'ok', {textOptions: {codepage: 65001}});
    assert.deepEqual(h.states(), []);
});

check('oldUserActionCallbackCountPreserved', () => {
    for (const requireUserAction of [true, false]) {
        const h = controller({requireUserAction});
        h.submit(h.open());
        h.submit(h.open());
        assert.equal(h.legacyCount(), requireUserAction ? 1 : 0);
        assert.equal(h.states().length, 4, 'the new protocol is independent of the one-shot legacy flag');
    }
    const h = controller();
    h.open(99);
    assert.equal(h.legacyCount(), 1);
    assert.equal(h.dialogs.length, 0);
    assert.deepEqual(h.states(), []);
});

check('newApiWithOldIframeKeepsLegacyOnly', () => {
    const calls = [], legacy = [];
    const h = host({onUserActionStateChanged: recordingCallback(calls), onUserActionRequired: recordingCallback(legacy)});
    const oldGateway = execFileSync('git', ['show', 'v9.4.0.129:' + GATEWAY], {cwd: ROOT, encoding: 'utf8'});
    const g = gateway(h, FRAME_ID, oldGateway);
    assert.equal(g.api.userActionStateChanged, undefined);
    g.api.userActionRequired();
    assert.equal(legacy.length, 1);
    assert.equal(calls.length, 0);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
