'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const noop = () => {};

function handler(file, name, context, receiver) {
    const source = read(file);
    const start = new RegExp(`^([ ]*)(const )?${name}(?=[: (]).*?\\{[ \\t]*$`, 'm').exec(source);
    assert.ok(start, `${name} in ${file}`);
    const rest = source.slice(start.index + start[0].length);
    const end = new RegExp(`^${start[1]}\\}[,;]?[ \\t]*$`, 'm').exec(rest);
    assert.ok(end, `closing brace for ${name} in ${file}`);
    const definition = start[0].trim() + rest.slice(0, end.index) + '}';
    if (start[2]) {
        const expression = definition.slice(definition.indexOf('=') + 1);
        return vm.runInContext(`(function() { return ${expression}; })`, context).call(receiver);
    }
    return vm.runInContext(`({${definition}}).${name}`, context).bind(receiver);
}

function createEventBus(notices) {
    const subscribers = new Map();
    return {
        on(name, listener) {
            if (!subscribers.has(name)) subscribers.set(name, []);
            subscribers.get(name).push(listener);
        },
        off(name, listener) {
            const list = subscribers.get(name);
            if (!list) return;
            const index = list.indexOf(listener);
            if (index >= 0) list.splice(index, 1);
        },
        trigger(name, ...args) {
            notices.push(name);
            for (const listener of [...(subscribers.get(name) || [])]) {
                listener(...args);
            }
        }
    };
}

function fixture() {
    const messages = [];
    const notices = [];
    const settings = new Map([['sse-doc-info-key', 'old-key']]);
    const origin = 'https://editor.example';
    let receive;
    const listeners = new Map();
    const gatewayEvents = {
        on: (name, listener) => listeners.set(name, listener),
        trigger: (name, data) => listeners.get(name)?.(null, data)
    };
    const bus = createEventBus(notices);
    const uiTips = [];
    const uiInfos = [];
    const uiWarnings = [];
    const Common = {
        NotificationCenter: bus,
        Notifications: bus,
        EditorApi: {get: () => null},
        UI: {
            warning: opts => uiWarnings.push(opts),
            info: opts => uiInfos.push(opts),
            TooltipManager: {showTip: opts => uiTips.push(opts), closeTip: noop}
        },
        localStorage: {getItem: () => null},
        Utils: {InternalSettings: {set: (key, value) => settings.set(key, value)}}
    };
    const dialogs = [];
    const dialog = {
        alert: noop,
        create: options => ({open: () => dialogs.push(options)})
    };
    const notification = {create: () => ({open: noop})};
    const Asc = {
        asc_CDocInfo: class {
            put_Id(id) { this.id = id; }
        },
        asc_CUserInfo: class {},
        c_oLicenseResult: {
            Success: 0,
            Expired: 1,
            Error: 2,
            ExpiredTrial: 3,
            NotBefore: 4,
            ExpiredLimited: 5,
            ConnectionsOS: 6,
            UsersCountOS: 7,
            SuccessLimit: 8,
            Connections: 9,
            UsersCount: 10,
            ConnectionsLive: 11,
            ConnectionsLiveOS: 12,
            UsersViewCount: 13,
            UsersViewCountOS: 14
        },
        c_oLicenseMode: {Limited: 1},
        c_oAscError: {
            Level: {Critical: -1, NoCritical: 0},
            ID: {
                Unknown: 0,
                LoadingScriptError: 1,
                CanNotPasteImage: 2,
                DocumentAndChangeMismatch: 3,
                UpdateVersion: 4,
                SessionIdle: 5,
                SessionToken: 6,
                UserDrop: 7,
                ConvertationTimeout: 8,
                Database: 9,
                MailMergeLoadFile: 10,
                Warning: 11
            }
        },
        c_oAscAsyncActionType: {Information: 0, BlockInteraction: 1},
        c_oAscAsyncAction: {Disconnect: 98, RefreshFile: 99}
    };
    for (const field of ['Url', 'Title', 'Options', 'Format', 'Lang', 'Mode', 'Permissions', 'UserInfo',
        'DirectUrl', 'VKey', 'EncryptedInfo', 'CoEditingMode']) {
        Asc.asc_CDocInfo.prototype['put_' + field] = noop;
    }
    Asc.asc_CDocInfo.prototype.asc_putIsEnabledMacroses = noop;
    Asc.asc_CDocInfo.prototype.asc_putIsEnabledPlugins = noop;
    for (const field of ['Id', 'FullName', 'IsAnonymousUser']) {
        Asc.asc_CUserInfo.prototype['put_' + field] = noop;
    }
    const context = vm.createContext({
        Common, Asc,
        $: Object.assign(() => gatewayEvents, {extend: Object.assign}),
        f7: {dialog, notification, emit: noop},
        About: {
            appVersion: () => '9.4.0',
            compareVersions: () => false,
            text: () => ({textProductName: 'Docs'})
        },
        EditorUIController: {isSupportEditFeature: () => true},
        __COMPANY_NAME__: 'TestCo',
        __PUBLISHER_URL__: 'https://example.test',
        __SALES_EMAIL__: 'sales@example.test',
        DocsAPI: {DocEditor: {version: () => '9.4.0'}},
        LoadingDocument: 1,
        labelDocName: null,
        appHeader: {setCanRename: noop, setDocumentCaption: noop},
        window: {
            Common, JSON, parentOrigin: origin, location: {origin},
            parent: {postMessage: payload => messages.push(JSON.parse(payload))},
            addEventListener: (name, callback) => { if (name === 'message') receive = callback; }
        }
    });
    vm.runInContext(read('apps/common/IrregularStack.js'), context);
    vm.runInContext(read('apps/common/Gateway.js'), context);
    return {
        context, gateway: Common.Gateway, messages, notices, settings, dialogs, uiTips, uiInfos, uiWarnings,
        command: (command, data) => receive({origin, data: JSON.stringify({command, data})})
    };
}

const events = messages => messages.map(({event, data}) => [event, data]);
const readyEvents = mode => [['onInfo', {mode}], ['onDocumentReady', undefined]];

test('Gateway completes a pending refresh only once, publishing mode before readiness', () => {
    const {gateway, messages} = fixture();
    assert.equal(gateway.completeRefreshFile({mode: 'edit'}), false);
    gateway.beginRefreshFile();
    assert.equal(gateway.completeRefreshFile({mode: 'edit'}), true);
    assert.equal(gateway.completeRefreshFile({mode: 'edit'}), false);
    assert.deepEqual(events(messages), readyEvents('edit'));
});

test('Gateway keeps pending refresh after non-fatal warning', () => {
    const {gateway, messages} = fixture();
    gateway.beginRefreshFile();
    gateway.reportWarning('b24_no_capacity', 'view mode');
    assert.equal(gateway.completeRefreshFile({mode: 'view'}), true);
    assert.equal(messages[0].event, 'onWarning');
    assert.deepEqual(events(messages.slice(1)), readyEvents('view'));
});

for (const [title, interrupt] of [
    ['explicit cancellation', ({gateway}) => gateway.cancelRefreshFile()],
    ['critical error', ({gateway}) => gateway.reportError(-1, 'load failed')],
    ['outdated version', ({gateway}) => gateway.updateVersion()],
    ['initial readiness', ({gateway}) => gateway.documentReady()]
]) {
    test(`Gateway drops pending refresh after ${title}`, () => {
        const session = fixture();
        session.gateway.beginRefreshFile();
        interrupt(session);
        session.messages.length = 0;
        assert.equal(session.gateway.completeRefreshFile({mode: 'view'}), false);
        assert.deepEqual(session.messages, []);
    });
}

test('Gateway keeps pending refresh on setHistoryData until revision actually opens', () => {
    const {gateway, command, messages} = fixture();
    gateway.beginRefreshFile();
    command('setHistoryData', {error: 'stale history reply'});
    assert.equal(gateway.completeRefreshFile({mode: 'edit'}), true);
    assert.deepEqual(events(messages), readyEvents('edit'));
});

const editors = [
    ['Document desktop', 'documenteditor/main/app/controller/Main.js', ['document', 'fileKey']],
    ['Spreadsheet desktop', 'spreadsheeteditor/main/app/controller/Main.js', ['spreadsheet', 'settings']],
    ['Presentation desktop', 'presentationeditor/main/app/controller/Main.js', ['document']],
    ['PDF desktop', 'pdfeditor/main/app/controller/Main.js', ['document', 'fileKey']],
    ['Visio desktop', 'visioeditor/main/app/controller/Main.js', ['document']],
    ['Forms', 'documenteditor/forms/app/controller/ApplicationController.js', ['document', 'fileKey']],
    ['Document mobile', 'documenteditor/mobile/src/controller/Main.jsx', ['document', 'mobileKey']],
    ['Spreadsheet mobile', 'spreadsheeteditor/mobile/src/controller/Main.jsx', ['document']],
    ['Presentation mobile', 'presentationeditor/mobile/src/controller/Main.jsx', ['document']],
    ['Visio mobile', 'visioeditor/mobile/src/controller/Main.jsx', ['document']]
];

const desktopMainEditors = editors.filter(([, file]) => file.endsWith('/Main.js'));
const editorsWithSessionHelper = new Set([
    'documenteditor/main/app/controller/Main.js',
    'spreadsheeteditor/main/app/controller/Main.js',
    'presentationeditor/main/app/controller/Main.js',
    'pdfeditor/main/app/controller/Main.js',
    'visioeditor/main/app/controller/Main.js'
]);

function editorFixture(file, keyFields) {
    const session = fixture();
    const sdkCalls = [];
    const user = {id: 'user', fullname: 'Test User'};
    const leftMenu = {
        leftMenu: {
            _state: {disabled: false},
            getMenu: () => ({txtVersionNum: '9.4.0'})
        },
        mode: null,
        previsEdit: undefined,
        prevcanEdit: undefined,
        SetDisabled(disable) {
            if (this.leftMenu._state.disabled !== disable) {
                this.leftMenu._state.disabled = disable;
                if (this.mode) {
                    if (disable) {
                        this.previsEdit = this.mode.isEdit;
                        this.prevcanEdit = this.mode.canEdit;
                        this.mode.isEdit = this.mode.canEdit = false;
                    } else {
                        this.mode.isEdit = this.previsEdit;
                        this.mode.canEdit = this.prevcanEdit;
                    }
                }
            }
        },
        onApiServerDisconnect() {
            // Mirrors real LeftMenu.onApiServerDisconnect: clears mode.isEdit without resetting previsEdit.
            if (this.mode) this.mode.isEdit = false;
        }
    };
    const viewportView = {setMode: noop, setCanRename: noop};
    const controllers = {
        LeftMenu: leftMenu,
        Statusbar: {setStatusCaption: noop, statusbar: {hideStatusMessage: noop}},
        Viewport: {getView: () => viewportView},
        Toolbar: {getView: () => viewportView},
        'Common.Controllers.History': {onHashError: noop}
    };
    const editor = {
        _isDocReady: true,
        _state: {isDisconnected: false, refreshFileLicense: null, pendingEditingAvailable: false},
        document: keyFields.includes('document') ? {key: 'old-key', fileType: 'docx'} : undefined,
        editorConfig: {mode: 'edit'},
        appOptions: {user, isEdit: true, canEdit: true, fileKey: 'old-key', spreadsheet: {key: 'old-key', fileType: 'xlsx'}},
        props: {
            t: () => ({
                warnNoResources: 'no resources %1',
                warnNoLicenseUsers: 'no users %1',
                textNoLicenseTitle: 'license %1',
                textNoResourcesTitle: 'resources %1',
                warnLicenseLimitedRenewed: 'limited',
                titleReadOnly: 'read only',
                tipLicenseExceeded: 'exceeded',
                tipLicenseUsersExceeded: 'users exceeded',
                textOk: 'OK',
                textBuyNow: 'Buy',
                textContactUs: 'Contact',
                notcriticalErrorTitle: 'warn',
                warnLicenseAnonymous: 'anon',
                textPaidFeature: 'paid',
                textCustomLoader: 'loader',
                textClose: 'close'
            }),
            storeAppOptions: {
                user,
                config: {mode: 'edit', user},
                isEdit: true,
                canEdit: true,
                isAnonymousSupport: true,
                canLiveView: false,
                trialMode: 0,
                fileKey: 'old-key'
            },
            users: {
                isDisconnected: false,
                resetDisconnected(value) { this.isDisconnected = value; }
            }
        },
        headerView: {setCanRename: noop, setDocumentCaption: noop},
        api: {
            asc_refreshFile: info => sdkCalls.push(info.id),
            asc_LoadDocument: () => sdkCalls.push('load'),
            asc_isDocumentModified: () => false,
            asc_coAuthoringDisconnect: () => sdkCalls.push('disconnect'),
            asc_SetFastCollaborative: value => sdkCalls.push(['fastCollab', value]),
            asc_getDocumentName: () => 'doc',
            asc_enableKeyEvents: noop
        },
        disableEditing: noop,
        onLongActionEnd: noop,
        onLicenseChanged: noop,
        onLanguageLoaded: () => true,
        showTips: noop,
        hidePreloader: noop,
        updateWindowTitle: noop,
        onEditComplete: noop,
        getApplication: () => ({getController: name => controllers[name] || {}})
    };
    leftMenu.mode = editor.appOptions;
    const methods = ['onRefreshFile', 'onDocumentContentReady', 'onUpdateVersion', 'onServerVersion', 'onEditorPermissions'];
    if (editorsWithSessionHelper.has(file)) methods.push('getSessionEditRight');
    if (file.endsWith('/Main.js')) methods.push('onError', 'onCoAuthoringDisconnect');
    if (file.endsWith('/ApplicationController.js')) methods.push('onError', 'onApiServerDisconnect');
    for (const name of methods) {
        editor[name] = handler('apps/' + file, name, session.context, editor);
    }
    if (editor.onCoAuthoringDisconnect) {
        session.context.Common.NotificationCenter.on('api:disconnect', () => {
            editor.onCoAuthoringDisconnect();
            leftMenu.onApiServerDisconnect();
        });
    } else if (editor.onApiServerDisconnect) {
        session.context.Common.NotificationCenter.on('api:disconnect', () => editor.onApiServerDisconnect());
    } else if (file.endsWith('.jsx')) {
        const mobileDisconnect = handler('apps/common/mobile/lib/controller/collaboration/Collaboration.jsx', 'onCoAuthoringDisconnect', session.context, editor);
        session.context.Common.Notifications.on('api:disconnect', () => mobileDisconnect());
    }
    const readKey = {
        document: () => editor.document.key,
        spreadsheet: () => editor.appOptions.spreadsheet.key,
        settings: () => session.settings.get('sse-doc-info-key'),
        fileKey: () => editor.appOptions.fileKey,
        mobileKey: () => editor.props.storeAppOptions.fileKey
    };
    session.gateway.on('refreshfile', editor.onRefreshFile);
    return {
        ...session, editor, leftMenu, sdkCalls,
        keys: () => keyFields.map(field => readKey[field]()),
        refresh: (key = 'new-key') => session.command('refreshFile', {document: {key}})
    };
}

function attachDesktopLocks(session, file) {
    const {editor, leftMenu, context} = session;
    const {Common} = context;
    editor.stackLongActions = new Common.IrregularStack({
        strongCompare: (a, b) => a.type === b.type && a.id === b.id,
        weakCompare: (a, b) => a.type === b.type
    });
    editor.stackDisableActions = new Common.IrregularStack({
        strongCompare: (a, b) => a.type === b.type,
        weakCompare: (a, b) => a.type === b.type
    });
    const applyDisable = (disable, type = 'disconnect') => {
        if (disable) {
            if (!editor.stackDisableActions.exist({type})) {
                editor.stackDisableActions.push({type});
            }
            leftMenu.SetDisabled(true);
        } else {
            editor.stackDisableActions.pop({type});
            leftMenu.SetDisabled(false);
            const prev = editor.stackDisableActions.get(editor.stackDisableActions.length() - 1);
            if (prev) applyDisable(true, prev.type);
        }
    };
    editor.disableEditing = (disable, type = 'disconnect') => applyDisable(disable, type);
    editor.setLongActionView = noop;
    editor.onLongActionBegin = handler('apps/' + file, 'onLongActionBegin', context, editor);
    for (const name of ['onLicenseChanged', 'applyLicense', 'onLongActionEnd', 'disableLiveViewing', 'onRequestRefreshFile', 'onRefreshFileCancel']) {
        editor[name] = handler('apps/' + file, name, context, editor);
    }
    Common.NotificationCenter.on('refreshfile:cancel', editor.onRefreshFileCancel);
    const origBegin = editor.onLongActionBegin;
    editor.onLongActionBegin = (type, id) => {
        origBegin(type, id);
        if (id === context.Asc.c_oAscAsyncAction.RefreshFile) {
            editor.disableEditing(true, 'refresh-file');
        }
    };
}

for (const [label, file, keyFields] of editors) {
    test(`${label} completes host refresh exactly once when the engine is ready`, () => {
        const {editor, sdkCalls, messages, notices, refresh, keys} = editorFixture(file, keyFields);
        editor.onDocumentContentReady();
        assert.deepEqual(messages, [], 'unrelated readiness is silent');
        if (file.endsWith('/Main.js')) {
            editor._state.refreshFileLicense = {stale: true};
        }
        refresh();
        if (file.endsWith('/Main.js')) {
            assert.equal(editor._state.refreshFileLicense, null, 'starting refresh clears stale deferred license');
        }
        assert.deepEqual(sdkCalls, ['new-key']);
        assert.deepEqual(messages, [], 'host waits for the engine');
        editor.onDocumentContentReady();
        editor.onDocumentContentReady();
        assert.deepEqual(events(messages), readyEvents(label === 'Forms' ? 'view' : 'edit'));
        assert.deepEqual(keys(), keyFields.map(() => 'new-key'));
        assert.deepEqual(notices, [], 'refresh skips initial UI setup');
    });

    test(`${label} completes another refresh in view mode after api:disconnect and a capacity warning`, () => {
        const {editor, gateway, context, messages, refresh} = editorFixture(file, keyFields);
        refresh();
        editor.onDocumentContentReady();
        messages.length = 0;
        refresh('latest-key');
        context.Common[file.endsWith('.jsx') ? 'Notifications' : 'NotificationCenter'].trigger('api:disconnect');
        if (file.endsWith('.jsx')) {
            assert.equal(editor.props.users.isDisconnected, true, 'real mobile disconnect handler executed');
            assert.equal(editor.props.storeAppOptions.isEdit, true, 'mobile storeAppOptions.isEdit stays true after disconnect');
        } else if (editor.onCoAuthoringDisconnect || editor.onApiServerDisconnect) {
            assert.equal(editor._state.isDisconnected, true, 'real disconnect handler executed');
        }
        gateway.reportWarning('b24_no_capacity', 'view mode');
        editor.onDocumentContentReady();
        assert.deepEqual(events(messages.slice(1)), readyEvents('view'));
        assert.equal(messages[0].event, 'onWarning');
    });

    test(`${label} does not emit a duplicate readiness when refresh starts before initial readiness`, () => {
        const {editor, gateway, messages, refresh} = editorFixture(file, keyFields);
        const enteredInitialReady = Symbol('enteredInitialReady');
        let docReady = false;
        Object.defineProperty(editor, '_isDocReady', {
            configurable: true,
            get: () => docReady,
            set(value) {
                docReady = value;
                if (value) throw enteredInitialReady;
            }
        });
        refresh();
        // Executing onDocumentContentReady while _isDocReady is false bypasses completeRefreshFile and enters initial load.
        assert.throws(() => editor.onDocumentContentReady(), err => err === enteredInitialReady);
        assert.equal(editor._isDocReady, true);
        assert.equal(messages.some(m => m.event === 'onInfo' || m.event === 'onDocumentReady'), false);
        // Initial readiness completes via Gateway.documentReady(), clearing pending refreshFile.
        gateway.documentReady();
        messages.length = 0;
        editor.onDocumentContentReady();
        assert.deepEqual(messages, []);
    });

    test(`${label} ignores refresh data without a key while keeping an in-flight refresh intact`, () => {
        const {editor, sdkCalls, messages, refresh, command} = editorFixture(file, keyFields);
        const payloads = [undefined, {}, {document: {}}, {document: {key: ''}}];
        const expectedMode = file.includes('/forms/') ? 'view' : 'edit';
        for (const [index, data] of payloads.entries()) {
            refresh(`valid-key-${index}`);
            const deferredLicense = {deferred: index};
            if (file.endsWith('/Main.js')) {
                editor._state.refreshFileLicense = deferredLicense;
            }
            command('refreshFile', data);
            if (file.endsWith('/Main.js')) {
                assert.equal(editor._state.refreshFileLicense, deferredLicense, 'invalid refresh must not wipe deferred license');
            }
            editor.onDocumentContentReady();
            assert.equal(sdkCalls.length, index + 1);
            assert.deepEqual(events(messages), readyEvents(expectedMode));
            messages.length = 0;
        }
        assert.deepEqual(sdkCalls, payloads.map((_, index) => `valid-key-${index}`));
    });

    test(`${label} keeps the old key and emits no readiness when SDK refresh throws`, () => {
        const {editor, messages, refresh, keys} = editorFixture(file, keyFields);
        const error = new Error('refresh failure');
        editor.api.asc_refreshFile = () => {
            if (file.endsWith('/Main.js')) {
                editor._state.refreshFileLicense = {stale: true};
            }
            throw error;
        };
        assert.throws(refresh, value => value === error);
        if (file.endsWith('/Main.js')) {
            assert.equal(editor._state.refreshFileLicense, null, 'throwing refresh clears deferred license');
        }
        editor.onDocumentContentReady();
        assert.deepEqual(keys(), keyFields.map(() => 'old-key'));
        assert.deepEqual(messages, []);
    });

    const permissions = type => ({
        asc_getLicenseType: () => type,
        asc_getBuildVersion: () => '9.4.0'
    });
    const refusals = [
        ['update notice', editor => editor.onUpdateVersion()],
        ['server version mismatch', editor => assert.equal(editor.onServerVersion('1.2.3'), true)],
        ['repeat server version mismatch', editor => {
            editor.changeServerVersion = true;
            assert.equal(editor.onServerVersion('9.4.0'), true);
        }],
        ['expired license', editor => editor.onEditorPermissions(permissions(1))],
        ['error license', editor => editor.onEditorPermissions(permissions(2))],
        ['expired trial license', editor => editor.onEditorPermissions(permissions(3))],
        ['not-before license', editor => editor.onEditorPermissions(permissions(4))],
        ['expired limited license', editor => editor.onEditorPermissions(permissions(5))]
    ];
    if (file.endsWith('/Main.js')) {
        refusals.push(['language check', editor => {
            editor.onLanguageLoaded = () => false;
            editor.onEditorPermissions(permissions(42));
        }]);
    }
    for (const [reason, refuse] of refusals) {
        test(`${label} cancels refresh on ${reason}`, () => {
            const {editor, sdkCalls, messages, refresh} = editorFixture(file, keyFields);
            refresh();
            if (file.endsWith('/Main.js')) {
                editor._state.refreshFileLicense = {stale: true};
            }
            refuse(editor);
            if (file.endsWith('/Main.js')) {
                assert.equal(editor._state.refreshFileLicense, null, `${reason} clears deferred license`);
            }
            editor.onDocumentContentReady();
            assert.deepEqual(sdkCalls, ['new-key']);
            assert.deepEqual(messages, []);
        });
    }
}

for (const [label, file, keyFields] of desktopMainEditors) {
    test(`${label} cancels refresh on critical early-return errors and ignores non-critical errors`, () => {
        const errorIds = file.startsWith('visioeditor/')
            ? ['LoadingScriptError', 'UpdateVersion', 'SessionIdle', 'SessionToken', 'UserDrop']
            : ['LoadingScriptError', 'DocumentAndChangeMismatch', 'UpdateVersion', 'SessionIdle', 'SessionToken', 'UserDrop'];
        for (const idName of errorIds) {
            const {editor, context, messages, refresh} = editorFixture(file, keyFields);
            const {Asc} = context;
            refresh();
            editor._state.refreshFileLicense = {asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS};
            editor.onError(Asc.c_oAscError.ID[idName], Asc.c_oAscError.Level.Critical);
            assert.equal(editor._state.refreshFileLicense, null, `${idName} clears deferred license`);
            editor.onDocumentContentReady();
            assert.deepEqual(messages, [], `${idName} cancels pending refresh`);
        }

        if (file.startsWith('spreadsheeteditor/')) {
            const {editor, context, messages, refresh} = editorFixture(file, keyFields);
            const {Asc} = context;
            editor.isFrameClosed = true;
            refresh();
            editor._state.refreshFileLicense = {asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS};
            editor.onError(Asc.c_oAscError.ID.Unknown, Asc.c_oAscError.Level.Critical);
            assert.equal(editor._state.refreshFileLicense, null, 'isFrameClosed critical error clears deferred license');
            editor.onDocumentContentReady();
            assert.deepEqual(messages, [], 'isFrameClosed critical error still cancels refresh');
        }

        const {editor, context, messages, refresh} = editorFixture(file, keyFields);
        const {Asc} = context;
        refresh();
        const deferred = {asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS};
        editor._state.refreshFileLicense = deferred;
        editor.onError(Asc.c_oAscError.ID.UserDrop, Asc.c_oAscError.Level.NoCritical);
        assert.equal(editor._state.refreshFileLicense, deferred, 'non-critical error keeps deferred license');
        editor.onDocumentContentReady();
        assert.deepEqual(events(messages), readyEvents('edit'));

        // End-to-end: critical onError during refresh-file lock clears deferred ConnectionsOS so later RefreshFile unlock does not replay b24_no_capacity.
        const errUnlock = editorFixture(file, keyFields);
        attachDesktopLocks(errUnlock, file);
        errUnlock.editor.appOptions.canEdit = true;
        errUnlock.editor.appOptions.isEdit = true;
        if (file.startsWith('pdfeditor/')) {
            errUnlock.editor.appOptions.isPDFAnnotate = true;
            errUnlock.editor.appOptions.canPDFAnnotate = true;
        }
        errUnlock.refresh();
        errUnlock.editor.disableEditing(true, 'refresh-file');
        errUnlock.editor.onLicenseChanged({asc_getLicenseType: () => errUnlock.context.Asc.c_oLicenseResult.ConnectionsOS});
        assert.ok(errUnlock.editor._state.refreshFileLicense);
        errUnlock.editor.onError(errUnlock.context.Asc.c_oAscError.ID.SessionToken, errUnlock.context.Asc.c_oAscError.Level.Critical);
        assert.equal(errUnlock.editor._state.refreshFileLicense, null);
        errUnlock.editor.onLongActionEnd(errUnlock.context.Asc.c_oAscAsyncActionType.Information, errUnlock.context.Asc.c_oAscAsyncAction.RefreshFile);
        errUnlock.editor.onDocumentContentReady();
        assert.deepEqual(errUnlock.messages, []);
    });

    test(`${label} defers license limit under refresh lock, applies it on release, and publishes editing availability on success`, () => {
        const session = editorFixture(file, keyFields);
        const {editor, context, messages, notices, sdkCalls, refresh} = session;
        const {Asc} = context;
        attachDesktopLocks(session, file);
        const isPdf = file.startsWith('pdfeditor/');
        editor.appOptions.canEdit = true;
        editor.appOptions.isEdit = true;
        if (isPdf) {
            editor.appOptions.isPDFAnnotate = true;
            editor.appOptions.canPDFAnnotate = true;
        }

        refresh();
        editor.disableEditing(true, 'refresh-file');
        editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
        // Must stay deferred while the refresh lock is active.
        assert.deepEqual(messages, []);
        assert.equal(notices.includes('api:disconnect'), false);
        assert.equal(editor._state.isDisconnected, false);

        editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        assert.deepEqual(messages, [], 'RefreshFile end alone must not apply deferred capacity limit before ready');
        assert.equal(notices.includes('api:disconnect'), false);
        editor.onDocumentContentReady();

        assert.equal(messages[0].data.warningCode, 'b24_no_capacity');
        assert.deepEqual(events(messages.slice(1)), readyEvents('view'));
        assert.ok(notices.includes('api:disconnect'));
        assert.ok(sdkCalls.includes('disconnect'));
        assert.equal(editor._state.isDisconnected, true);
        assert.ok(editor.stackDisableActions.get({type: 'disconnect'}));
        assert.equal(editor.appOptions.isEdit, false);

        // Success license during refresh publishes b24EditingAvailable after lock release and document readiness.
        const okSession = editorFixture(file, keyFields);
        attachDesktopLocks(okSession, file);
        okSession.editor.appOptions.canEdit = true;
        okSession.editor.appOptions.isEdit = true;
        if (isPdf) {
            okSession.editor.appOptions.isPDFAnnotate = true;
            okSession.editor.appOptions.canPDFAnnotate = true;
        }
        okSession.refresh();
        okSession.editor.disableEditing(true, 'refresh-file');
        okSession.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.Success});
        assert.deepEqual(okSession.messages, []);
        okSession.editor.onLongActionEnd(okSession.context.Asc.c_oAscAsyncActionType.Information, okSession.context.Asc.c_oAscAsyncAction.RefreshFile);
        assert.deepEqual(okSession.messages, []);
        okSession.editor.onDocumentContentReady();
        assert.deepEqual(events(okSession.messages), [
            ['onInfo', {mode: 'edit', b24EditingAvailable: true}],
            ...readyEvents('edit')
        ]);
    });

    test(`${label} applies the refresh capacity limit when ready arrives before reconnection`, () => {
        const session = editorFixture(file, keyFields);
        const {editor, context, messages} = session;
        const {Asc} = context;
        attachDesktopLocks(session, file);
        if (file.startsWith('pdfeditor/')) {
            editor.appOptions.isPDFAnnotate = true;
            editor.appOptions.canPDFAnnotate = true;
        }

        session.refresh();
        editor.onLongActionBegin(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
        editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        editor.onLongActionBegin(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.Disconnect);
        editor.onDocumentContentReady();

        const refreshMessages = messages.filter(message => !message.data?.b24TransportState);
        assert.equal(refreshMessages[0]?.data.warningCode, 'b24_no_capacity');
        assert.deepEqual(events(refreshMessages.slice(1)), readyEvents('view'));
        assert.equal(editor._state.isDisconnected, true);
    });

    test(`${label} defers reconnect onLicenseChanged after RefreshFile end until ready and overwrites stale license`, () => {
        const isPdf = file.startsWith('pdfeditor/');
        // L1=ConnectionsOS followed by L2=Success before ready must apply only Success.
        const upgraded = editorFixture(file, keyFields);
        const {Asc} = upgraded.context;
        attachDesktopLocks(upgraded, file);
        upgraded.editor.appOptions.canEdit = true;
        upgraded.editor.appOptions.isEdit = true;
        if (isPdf) {
            upgraded.editor.appOptions.isPDFAnnotate = true;
            upgraded.editor.appOptions.canPDFAnnotate = true;
        }
        upgraded.refresh();
        upgraded.editor.disableEditing(true, 'refresh-file');
        upgraded.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
        upgraded.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        assert.deepEqual(upgraded.messages, []);

        upgraded.editor.onLongActionBegin(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.Disconnect);
        upgraded.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.Disconnect);
        upgraded.messages.length = 0;
        upgraded.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.Success});
        assert.deepEqual(upgraded.messages, [], 'reconnect license must stay deferred until document ready');

        upgraded.editor.onDocumentContentReady();
        assert.deepEqual(events(upgraded.messages), [
            ['onInfo', {mode: 'edit', b24EditingAvailable: true}],
            ...readyEvents('edit')
        ]);
        assert.equal(upgraded.editor._state.isDisconnected, false);

        // L1=Success followed by L2=ConnectionsOS before ready must apply only ConnectionsOS.
        const downgraded = editorFixture(file, keyFields);
        attachDesktopLocks(downgraded, file);
        downgraded.editor.appOptions.canEdit = true;
        downgraded.editor.appOptions.isEdit = true;
        if (isPdf) {
            downgraded.editor.appOptions.isPDFAnnotate = true;
            downgraded.editor.appOptions.canPDFAnnotate = true;
        }
        downgraded.refresh();
        downgraded.editor.disableEditing(true, 'refresh-file');
        downgraded.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.Success});
        downgraded.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        downgraded.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
        assert.deepEqual(downgraded.messages, []);

        downgraded.editor.onDocumentContentReady();
        assert.equal(downgraded.messages[0].data.warningCode, 'b24_no_capacity');
        assert.deepEqual(events(downgraded.messages.slice(1)), readyEvents('view'));
        assert.equal(downgraded.editor._state.isDisconnected, true);
    });

    test(`${label} applies deferred refreshFileLicense on RefreshFile end if document became ready first`, () => {
        const isPdf = file.startsWith('pdfeditor/');

        // 1. Reverse order + ConnectionsOS: applies capacity limit immediately before completeRefreshFile (mode: view), no false edit.
        const limited = editorFixture(file, keyFields);
        attachDesktopLocks(limited, file);
        limited.editor.appOptions.canEdit = true;
        limited.editor.appOptions.isEdit = true;
        if (isPdf) {
            limited.editor.appOptions.isPDFAnnotate = true;
            limited.editor.appOptions.canPDFAnnotate = true;
        }
        limited.refresh();
        limited.editor.disableEditing(true, 'refresh-file');
        limited.editor.onLicenseChanged({asc_getLicenseType: () => limited.context.Asc.c_oLicenseResult.ConnectionsOS});

        limited.editor.onDocumentContentReady();
        assert.equal(limited.editor._state.refreshFileLicense, null);
        assert.equal(limited.editor._state.pendingEditingAvailable, false);
        assert.equal(limited.editor._state.isDisconnected, true);
        assert.ok(limited.notices.includes('api:disconnect'));
        assert.equal(limited.messages[0].data.warningCode, 'b24_no_capacity');
        assert.deepEqual(events(limited.messages.slice(1)), readyEvents('view'));

        limited.messages.length = 0;
        limited.editor.onLongActionEnd(limited.context.Asc.c_oAscAsyncActionType.Information, limited.context.Asc.c_oAscAsyncAction.RefreshFile);
        assert.deepEqual(limited.messages, []);
        assert.equal(limited.editor._state.isDisconnected, true);
        assert.ok(limited.editor.stackDisableActions.get({type: 'disconnect'}));

        // 2. Reverse order + Success (with custom loader warning): ready publishes edit, unlock publishes b24EditingAvailable once without duplicate warning.
        const ok = editorFixture(file, keyFields);
        attachDesktopLocks(ok, file);
        ok.editor.appOptions.canEdit = true;
        ok.editor.appOptions.isEdit = true;
        ok.editor.appOptions.isDesktopApp = false;
        ok.editor.appOptions.canBrandingExt = false;
        ok.editor.editorConfig.customization = {loaderName: 'Custom'};
        if (isPdf) {
            ok.editor.appOptions.isPDFAnnotate = true;
            ok.editor.appOptions.canPDFAnnotate = true;
        }
        ok.refresh();
        ok.editor.disableEditing(true, 'refresh-file');
        ok.editor.onLicenseChanged({asc_getLicenseType: () => ok.context.Asc.c_oLicenseResult.Success});

        ok.editor.onDocumentContentReady();
        assert.equal(ok.editor._state.pendingEditingAvailable, true);
        assert.equal(ok.uiWarnings.length, 1, 'custom loader warning shown once on ready');
        assert.deepEqual(events(ok.messages), readyEvents('edit'));

        ok.messages.length = 0;
        ok.editor.onLongActionEnd(ok.context.Asc.c_oAscAsyncActionType.Information, ok.context.Asc.c_oAscAsyncAction.RefreshFile);
        assert.equal(ok.editor._state.pendingEditingAvailable, false);
        assert.equal(ok.uiWarnings.length, 1, 'custom loader warning not repeated on unlock');
        assert.deepEqual(events(ok.messages), [['onInfo', {mode: 'edit', b24EditingAvailable: true}]]);

        // 3. Reverse order + SuccessLimit: tooltip shown once on ready, b24EditingAvailable emitted once on unlock.
        const lim = editorFixture(file, keyFields);
        attachDesktopLocks(lim, file);
        lim.editor.appOptions.canEdit = true;
        lim.editor.appOptions.isEdit = true;
        lim.editor.appOptions.trialMode = lim.context.Asc.c_oLicenseMode.Limited;
        if (isPdf) {
            lim.editor.appOptions.isPDFAnnotate = true;
            lim.editor.appOptions.canPDFAnnotate = true;
        }
        lim.refresh();
        lim.editor.disableEditing(true, 'refresh-file');
        lim.editor.onLicenseChanged({asc_getLicenseType: () => lim.context.Asc.c_oLicenseResult.SuccessLimit});

        lim.editor.onDocumentContentReady();
        assert.equal(lim.editor._state.pendingEditingAvailable, true);
        assert.equal(lim.uiTips.length + lim.uiInfos.length, 1);
        assert.deepEqual(events(lim.messages), readyEvents('edit'));

        lim.messages.length = 0;
        lim.editor.onLongActionEnd(lim.context.Asc.c_oAscAsyncActionType.Information, lim.context.Asc.c_oAscAsyncAction.RefreshFile);
        assert.equal(lim.editor._state.pendingEditingAvailable, false);
        assert.equal(lim.uiTips.length + lim.uiInfos.length, 1, 'SuccessLimit notice not repeated on unlock');
        assert.deepEqual(events(lim.messages), [['onInfo', {mode: 'edit', b24EditingAvailable: true}]]);

        // 4. RefreshFile end without prior ready (WOPI / post-requestRefreshFile disconnect) must not replay deferred license.
        const wopiDrop = editorFixture(file, keyFields);
        attachDesktopLocks(wopiDrop, file);
        wopiDrop.editor.appOptions.canEdit = true;
        wopiDrop.editor.appOptions.isEdit = true;
        if (isPdf) {
            wopiDrop.editor.appOptions.isPDFAnnotate = true;
            wopiDrop.editor.appOptions.canPDFAnnotate = true;
        }
        wopiDrop.editor.disableEditing(true, 'refresh-file');
        wopiDrop.editor.onLicenseChanged({asc_getLicenseType: () => wopiDrop.context.Asc.c_oLicenseResult.Success});
        wopiDrop.editor.onLongActionEnd(wopiDrop.context.Asc.c_oAscAsyncActionType.Information, wopiDrop.context.Asc.c_oAscAsyncAction.RefreshFile);
        assert.deepEqual(wopiDrop.messages, []);
        wopiDrop.editor.onLongActionBegin(wopiDrop.context.Asc.c_oAscAsyncActionType.Information, wopiDrop.context.Asc.c_oAscAsyncAction.Disconnect);
        assert.equal(wopiDrop.editor._state.refreshFileLicense, null);
        assert.equal(wopiDrop.editor._state.pendingEditingAvailable, false);

        // 5. History revision cancel event clears deferred refreshFileLicense before revision readiness arrives.
        const histCancel = editorFixture(file, keyFields);
        attachDesktopLocks(histCancel, file);
        histCancel.editor.appOptions.canEdit = true;
        histCancel.editor.appOptions.isEdit = true;
        if (isPdf) {
            histCancel.editor.appOptions.isPDFAnnotate = true;
            histCancel.editor.appOptions.canPDFAnnotate = true;
        }
        histCancel.refresh();
        histCancel.editor.disableEditing(true, 'refresh-file');
        histCancel.editor.onLicenseChanged({asc_getLicenseType: () => histCancel.context.Asc.c_oLicenseResult.ConnectionsOS});
        histCancel.gateway.cancelRefreshFile();
        histCancel.context.Common.NotificationCenter.trigger('refreshfile:cancel');
        histCancel.editor.onLongActionEnd(histCancel.context.Asc.c_oAscAsyncActionType.Information, histCancel.context.Asc.c_oAscAsyncAction.RefreshFile);
        histCancel.editor.onDocumentContentReady();
        assert.deepEqual(histCancel.messages, []);
        assert.equal(histCancel.editor._state.isDisconnected, false);
    });

    test(`${label} clears deferred refreshFileLicense on cancellation so it cannot leak into a later unlock`, () => {
        const session = editorFixture(file, keyFields);
        const {editor, context, messages, refresh} = session;
        const {Asc} = context;
        attachDesktopLocks(session, file);
        if (file.startsWith('pdfeditor/')) {
            editor.appOptions.isPDFAnnotate = true;
            editor.appOptions.canPDFAnnotate = true;
        }

        refresh();
        editor.disableEditing(true, 'refresh-file');
        editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
        assert.ok(editor._state.refreshFileLicense);

        editor.onUpdateVersion();
        assert.equal(editor._state.refreshFileLicense, null);

        editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        editor.onDocumentContentReady();
        assert.deepEqual(messages, []);
    });

    test(`${label} does not emit b24EditingAvailable when RefreshFile ends before disconnect or retry`, () => {
        const isPdf = file.startsWith('pdfeditor/');
        for (const termination of ['disconnect', 'request-refresh']) {
            const session = editorFixture(file, keyFields);
            const {editor, context, messages, refresh} = session;
            const {Asc} = context;
            attachDesktopLocks(session, file);
            editor.appOptions.canEdit = true;
            editor.appOptions.isEdit = true;
            if (isPdf) {
                editor.appOptions.isPDFAnnotate = true;
                editor.appOptions.canPDFAnnotate = true;
                editor.appOptions.canPDFEdit = true;
            }

            refresh('key-fail');
            editor.onLongActionBegin(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
            assert.equal(editor.stackLongActions.length(), 1);
            editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.Success});
            assert.ok(editor._state.refreshFileLicense);

            // SDK ends RefreshFile before emitting disconnect or requesting a retry.
            editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
            assert.equal(editor.stackLongActions.length(), 0);
            assert.deepEqual(messages, [], 'RefreshFile end alone must not publish b24EditingAvailable');

            if (termination === 'disconnect') {
                editor.onCoAuthoringDisconnect();
                assert.equal(editor._state.refreshFileLicense, null);
                assert.deepEqual(messages, []);
                editor.onDocumentContentReady();
                assert.deepEqual(events(messages), readyEvents('view'));
            } else {
                editor.onRequestRefreshFile();
                assert.equal(editor._state.refreshFileLicense, null);
                editor.onDocumentContentReady();
                assert.deepEqual(events(messages), [['onRequestRefreshFile', undefined]]);
            }
        }
    });
    test(`${label} does not replay stale license limit after disconnect on a later refreshFile`, () => {
        const session = editorFixture(file, keyFields);
        const {editor, context, messages, notices, sdkCalls, refresh} = session;
        const {Asc} = context;
        attachDesktopLocks(session, file);
        const isPdf = file.startsWith('pdfeditor/');
        editor.appOptions.canEdit = true;
        editor.appOptions.isEdit = true;
        if (isPdf) {
            editor.appOptions.isPDFAnnotate = true;
            editor.appOptions.canPDFAnnotate = true;
            editor.appOptions.canPDFEdit = true;
        }

        // First refresh triggers capacity downgrade and disconnects the live iframe.
        refresh('key-1');
        editor.disableEditing(true, 'refresh-file');
        editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
        editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        editor.onDocumentContentReady();
        assert.equal(editor._state.licenseType, Asc.c_oLicenseResult.ConnectionsOS);
        assert.equal(editor._state.isDisconnected, true);

        // Subsequent refresh with Success must not re-emit b24_no_capacity, disconnect again, or clear licenseType.
        messages.length = 0;
        notices.length = 0;
        sdkCalls.length = 0;
        refresh('key-2');
        editor.disableEditing(true, 'refresh-file');
        editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.Success});
        editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        editor.onDocumentContentReady();
        assert.deepEqual(events(messages), readyEvents('view'));
        assert.equal(notices.includes('api:disconnect'), false);
        assert.equal(sdkCalls.includes('disconnect'), false);
        assert.equal(editor._state.licenseType, Asc.c_oLicenseResult.ConnectionsOS);

        // Subsequent refresh with ConnectionsOS on the already-disconnected session must also stay silent.
        messages.length = 0;
        notices.length = 0;
        sdkCalls.length = 0;
        refresh('key-3');
        editor.disableEditing(true, 'refresh-file');
        editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
        editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        editor.onDocumentContentReady();
        assert.deepEqual(events(messages), readyEvents('view'));
        assert.equal(notices.includes('api:disconnect'), false);
        assert.equal(sdkCalls.includes('disconnect'), false);
    });
    test(`${label} handles SuccessLimit, ConnectionsLive, and pre-disconnected sessions on refreshFile`, () => {
        const isPdf = file.startsWith('pdfeditor/');
        const isVisio = file.startsWith('visioeditor/');
        const initEditFlags = editor => {
            editor.appOptions.canEdit = true;
            editor.appOptions.isEdit = true;
            editor.appOptions.isAnonymousSupport = true;
            if (isPdf) {
                editor.appOptions.isPDFAnnotate = true;
                editor.appOptions.canPDFAnnotate = true;
                editor.appOptions.canPDFEdit = true;
            }
        };

        // 1. Repeat SuccessLimit must not re-show license UI or re-emit b24EditingAvailable; later ConnectionsOS still escalates.
        const limited = editorFixture(file, keyFields);
        const {Asc} = limited.context;
        attachDesktopLocks(limited, file);
        initEditFlags(limited.editor);
        limited.editor.appOptions.trialMode = Asc.c_oLicenseMode.Limited;

        limited.refresh('limit-1');
        limited.editor.disableEditing(true, 'refresh-file');
        limited.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.SuccessLimit});
        limited.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        limited.editor.onDocumentContentReady();
        assert.equal(limited.editor._state.licenseType, Asc.c_oLicenseResult.SuccessLimit);
        assert.equal(limited.editor._state.isDisconnected, false);
        assert.equal(isVisio ? limited.uiInfos.length : limited.uiTips.length, 1);
        assert.equal(isVisio ? limited.uiTips.length : limited.uiInfos.length, 0);
        assert.deepEqual(events(limited.messages), [
            ['onInfo', {mode: 'edit', b24EditingAvailable: true}],
            ...readyEvents('edit')
        ]);

        limited.messages.length = 0;
        limited.uiTips.length = 0;
        limited.uiInfos.length = 0;
        limited.uiWarnings.length = 0;
        limited.refresh('limit-2');
        limited.editor.disableEditing(true, 'refresh-file');
        limited.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.SuccessLimit});
        limited.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        limited.editor.onDocumentContentReady();
        assert.deepEqual(limited.uiTips, []);
        assert.deepEqual(limited.uiInfos, []);
        assert.deepEqual(limited.uiWarnings, []);
        assert.deepEqual(events(limited.messages), readyEvents('edit'));

        limited.messages.length = 0;
        limited.notices.length = 0;
        limited.sdkCalls.length = 0;
        limited.refresh('limit-3');
        limited.editor.disableEditing(true, 'refresh-file');
        limited.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
        limited.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        limited.editor.onDocumentContentReady();
        assert.equal(limited.messages[0].data.warningCode, 'b24_no_capacity');
        assert.deepEqual(events(limited.messages.slice(1)), readyEvents('view'));
        assert.equal(limited.editor._state.isDisconnected, true);
        assert.ok(limited.notices.includes('api:disconnect'));
        assert.ok(limited.sdkCalls.includes('disconnect'));

        // 2. Non-license pre-disconnected anonymous session with falsy licenseType must not re-run applyLicense on refreshFile.
        const anonDisc = editorFixture(file, keyFields);
        attachDesktopLocks(anonDisc, file);
        initEditFlags(anonDisc.editor);
        anonDisc.editor.appOptions.isAnonymousSupport = false;
        anonDisc.editor.appOptions.user.anonymous = true;
        anonDisc.editor._state.licenseType = false;
        anonDisc.editor.disableEditing(true, 'disconnect');
        anonDisc.context.Common.NotificationCenter.trigger('api:disconnect');
        anonDisc.notices.length = 0;
        anonDisc.sdkCalls.length = 0;
        anonDisc.uiWarnings.length = 0;

        for (const [key, licType] of [['anon-1', Asc.c_oLicenseResult.Success], ['anon-2', Asc.c_oLicenseResult.ConnectionsOS]]) {
            anonDisc.messages.length = 0;
            anonDisc.notices.length = 0;
            anonDisc.sdkCalls.length = 0;
            anonDisc.uiWarnings.length = 0;
            anonDisc.refresh(key);
            anonDisc.editor.disableEditing(true, 'refresh-file');
            anonDisc.editor.onLicenseChanged({asc_getLicenseType: () => licType});
            anonDisc.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
            anonDisc.editor.onDocumentContentReady();
            assert.deepEqual(anonDisc.uiWarnings, []);
            assert.equal(anonDisc.notices.includes('api:disconnect'), false);
            assert.equal(anonDisc.sdkCalls.includes('disconnect'), false);
            assert.deepEqual(events(anonDisc.messages), readyEvents('view'));
        }

        // 3. Pre-disconnected session with custom loader branding must not re-open textCustomLoader warning on refreshFile.
        const brandedDisc = editorFixture(file, keyFields);
        attachDesktopLocks(brandedDisc, file);
        initEditFlags(brandedDisc.editor);
        brandedDisc.editor.appOptions.isDesktopApp = false;
        brandedDisc.editor.appOptions.canBrandingExt = false;
        brandedDisc.editor.editorConfig.customization = {loaderName: 'Brand'};
        brandedDisc.editor._state.licenseType = false;
        brandedDisc.editor.disableEditing(true, 'disconnect');
        brandedDisc.context.Common.NotificationCenter.trigger('api:disconnect');
        brandedDisc.notices.length = 0;
        brandedDisc.sdkCalls.length = 0;
        brandedDisc.uiWarnings.length = 0;
        brandedDisc.refresh('brand-1');
        brandedDisc.editor.disableEditing(true, 'refresh-file');
        brandedDisc.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.Success});
        brandedDisc.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        brandedDisc.editor.onDocumentContentReady();
        assert.deepEqual(brandedDisc.uiWarnings, []);
        assert.deepEqual(events(brandedDisc.messages), readyEvents('view'));

        // 4. Active 'not-loaded' lock blocks both ConnectionsOS capacity downgrade and Success applyLicense side effects.
        const notLoaded = editorFixture(file, keyFields);
        attachDesktopLocks(notLoaded, file);
        initEditFlags(notLoaded.editor);
        notLoaded.editor.appOptions.isDesktopApp = false;
        notLoaded.editor.appOptions.canBrandingExt = false;
        notLoaded.editor.editorConfig.customization = {loaderName: 'Brand'};
        notLoaded.editor._state.licenseType = false;
        notLoaded.editor.disableEditing(true, 'not-loaded');
        for (const [key, licType] of [['nl-1', Asc.c_oLicenseResult.ConnectionsOS], ['nl-2', Asc.c_oLicenseResult.Success]]) {
            notLoaded.messages.length = 0;
            notLoaded.notices.length = 0;
            notLoaded.sdkCalls.length = 0;
            notLoaded.uiWarnings.length = 0;
            notLoaded.refresh(key);
            notLoaded.editor.disableEditing(true, 'refresh-file');
            notLoaded.editor.onLicenseChanged({asc_getLicenseType: () => licType});
            notLoaded.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
            notLoaded.editor.onDocumentContentReady();
            assert.equal(notLoaded.editor._state.licenseType, false);
            assert.equal(notLoaded.notices.includes('api:disconnect'), false);
            assert.equal(notLoaded.sdkCalls.includes('disconnect'), false);
            assert.deepEqual(notLoaded.uiWarnings, []);
            assert.deepEqual(events(notLoaded.messages), readyEvents('view'));
        }

        // 5. canLiveView disables live viewing once on ConnectionsLive and does not re-run on subsequent Success.
        const liveView = editorFixture(file, keyFields);
        attachDesktopLocks(liveView, file);
        liveView.editor.editorConfig.mode = 'view';
        liveView.editor.appOptions.canLiveView = true;
        liveView.editor.appOptions.isEdit = false;
        liveView.editor.appOptions.canEdit = false;
        liveView.editor.appOptions.isAnonymousSupport = true;

        liveView.refresh('live-1');
        liveView.editor.disableEditing(true, 'refresh-file');
        liveView.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsLive});
        liveView.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        liveView.editor.onDocumentContentReady();
        assert.equal(liveView.editor.appOptions.canLiveView, false);
        assert.deepEqual(liveView.sdkCalls, ['live-1', ['fastCollab', false]]);
        assert.deepEqual(events(liveView.messages), readyEvents('view'));

        liveView.messages.length = 0;
        liveView.sdkCalls.length = 0;
        liveView.refresh('live-2');
        liveView.editor.disableEditing(true, 'refresh-file');
        liveView.editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.Success});
        liveView.editor.onLongActionEnd(Asc.c_oAscAsyncActionType.Information, Asc.c_oAscAsyncAction.RefreshFile);
        liveView.editor.onDocumentContentReady();
        assert.deepEqual(liveView.sdkCalls, ['live-2']);
        assert.deepEqual(events(liveView.messages), readyEvents('view'));
    });
}

for (const [label, file, keyFields, viewLockType] of [
    ['Document desktop', 'documenteditor/main/app/controller/Main.js', ['document', 'fileKey'], 'view'],
    ['Spreadsheet desktop', 'spreadsheeteditor/main/app/controller/Main.js', ['spreadsheet', 'settings'], 'vo-view'],
    ['Presentation desktop', 'presentationeditor/main/app/controller/Main.js', ['document'], 'vo-view'],
    ['Visio desktop', 'visioeditor/main/app/controller/Main.js', ['document'], 'reconnect']
]) {
    test(`${label} preserves session edit mode during user view lock and still enforces capacity limit`, () => {
        // 1. Successful refresh while user toggled UI view mode reports session mode 'edit' and keeps UI lock.
        const okSession = editorFixture(file, keyFields);
        attachDesktopLocks(okSession, file);
        okSession.editor.disableEditing(true, viewLockType);
        assert.equal(okSession.editor.appOptions.isEdit, false);
        assert.equal(okSession.leftMenu.previsEdit, true);

        okSession.refresh();
        okSession.editor.disableEditing(true, 'refresh-file');
        okSession.editor.onLicenseChanged({asc_getLicenseType: () => okSession.context.Asc.c_oLicenseResult.Success});
        okSession.editor.onLongActionEnd(okSession.context.Asc.c_oAscAsyncActionType.Information, okSession.context.Asc.c_oAscAsyncAction.RefreshFile);
        okSession.editor.onDocumentContentReady();
        assert.ok(okSession.editor.stackDisableActions.get({type: viewLockType}), 'user view lock stays active');
        assert.deepEqual(events(okSession.messages), readyEvents('edit'));

        // 2. Capacity limit while user is in view mode still disconnects coauthoring and reports 'view' despite previsEdit=true.
        const deniedSession = editorFixture(file, keyFields);
        attachDesktopLocks(deniedSession, file);
        deniedSession.editor.disableEditing(true, viewLockType);
        deniedSession.refresh();
        deniedSession.editor.disableEditing(true, 'refresh-file');
        deniedSession.editor.onLicenseChanged({asc_getLicenseType: () => deniedSession.context.Asc.c_oLicenseResult.ConnectionsOS});
        deniedSession.editor.onLongActionEnd(deniedSession.context.Asc.c_oAscAsyncActionType.Information, deniedSession.context.Asc.c_oAscAsyncAction.RefreshFile);
        deniedSession.editor.onDocumentContentReady();

        assert.equal(deniedSession.messages[0].data.warningCode, 'b24_no_capacity');
        assert.deepEqual(events(deniedSession.messages.slice(1)), readyEvents('view'));
        assert.equal(deniedSession.editor._state.isDisconnected, true);
        assert.ok(deniedSession.sdkCalls.includes('disconnect'));
        assert.ok(deniedSession.editor.stackDisableActions.get({type: 'disconnect'}));
        assert.equal(deniedSession.leftMenu.previsEdit, true, 'previsEdit stays true but disconnected state wins');
    });
}

test('PDF desktop enforces capacity limit in PDF edit and temporary view modes, and skips read-only view sessions', () => {
    const file = 'pdfeditor/main/app/controller/Main.js';
    const keyFields = ['document', 'fileKey'];
    for (const [modeLabel, opts] of [
        ['isPDFEdit', {isPDFEdit: true, isPDFAnnotate: false, canPDFEdit: true, canPDFAnnotate: true}],
        ['temporary view / holdView', {isPDFEdit: false, isPDFAnnotate: false, canPDFEdit: true, canPDFAnnotate: true}]
    ]) {
        const session = editorFixture(file, keyFields);
        attachDesktopLocks(session, file);
        Object.assign(session.editor.appOptions, opts);
        session.refresh();
        session.editor.disableEditing(true, 'refresh-file');
        session.editor.onLicenseChanged({asc_getLicenseType: () => session.context.Asc.c_oLicenseResult.ConnectionsOS});
        assert.deepEqual(session.messages, [], `${modeLabel}: deferred until refresh lock ends`);
        session.editor.onLongActionEnd(session.context.Asc.c_oAscAsyncActionType.Information, session.context.Asc.c_oAscAsyncAction.RefreshFile);
        session.editor.onDocumentContentReady();
        assert.equal(session.messages[0].data.warningCode, 'b24_no_capacity', `${modeLabel}: warns host`);
        assert.deepEqual(events(session.messages.slice(1)), readyEvents('view'), `${modeLabel}: reports view mode`);
        assert.ok(session.sdkCalls.includes('disconnect'), `${modeLabel}: disconnects coauthoring`);
        assert.ok(session.editor.stackDisableActions.get({type: 'disconnect'}), `${modeLabel}: locks editing`);
    }

    // Read-only view PDF still has canPDFEdit/canPDFAnnotate/isEdit = true in onEditorPermissions;
    // editorConfig.mode !== 'view' must block capacity downgrade.
    const roSession = editorFixture(file, keyFields);
    attachDesktopLocks(roSession, file);
    roSession.editor.editorConfig.mode = 'view';
    Object.assign(roSession.editor.appOptions, {
        isEdit: true, canEdit: true, isPDFEdit: false, isPDFAnnotate: false, canPDFEdit: true, canPDFAnnotate: true
    });
    roSession.refresh();
    roSession.editor.disableEditing(true, 'refresh-file');
    roSession.editor.onLicenseChanged({asc_getLicenseType: () => roSession.context.Asc.c_oLicenseResult.ConnectionsOS});
    roSession.editor.onLongActionEnd(roSession.context.Asc.c_oAscAsyncActionType.Information, roSession.context.Asc.c_oAscAsyncAction.RefreshFile);
    roSession.editor.onDocumentContentReady();
    assert.deepEqual(events(roSession.messages), readyEvents('view'));
    assert.equal(roSession.sdkCalls.includes('disconnect'), false);
    assert.equal(roSession.editor._state.isDisconnected, false);
    assert.equal(Boolean(roSession.editor.stackDisableActions.get({type: 'disconnect'})), false);

    // Already disconnected PDF session (e.g. after EditingError) keeps canPDF*/isPDF* flags true,
    // so refreshFile with ConnectionsOS must not disconnect or warn b24_no_capacity again.
    const discSession = editorFixture(file, keyFields);
    attachDesktopLocks(discSession, file);
    Object.assign(discSession.editor.appOptions, {
        isEdit: true, canEdit: true, isPDFEdit: true, isPDFAnnotate: true, canPDFEdit: true, canPDFAnnotate: true
    });
    discSession.editor.disableEditing(true, 'disconnect');
    discSession.context.Common.NotificationCenter.trigger('api:disconnect');
    discSession.notices.length = 0;
    discSession.sdkCalls.length = 0;
    discSession.refresh();
    discSession.editor.disableEditing(true, 'refresh-file');
    discSession.editor.onLicenseChanged({asc_getLicenseType: () => discSession.context.Asc.c_oLicenseResult.ConnectionsOS});
    discSession.editor.onLongActionEnd(discSession.context.Asc.c_oAscAsyncActionType.Information, discSession.context.Asc.c_oAscAsyncAction.RefreshFile);
    discSession.editor.onDocumentContentReady();
    assert.deepEqual(events(discSession.messages), readyEvents('view'));
    assert.equal(discSession.notices.includes('api:disconnect'), false);
    assert.equal(discSession.sdkCalls.includes('disconnect'), false);
});

test('PDF desktop reports view mode for view and read-only edit sessions and edit mode when PDF editing is allowed', () => {
    const file = 'pdfeditor/main/app/controller/Main.js';
    const keyFields = ['document', 'fileKey'];

    // 1. View config (even with isEdit/canPDF* = true) and read-only/form/XPS sessions report 'view' even under refresh-file lock.
    for (const [label, mode, opts] of [
        ['view config with canPDF*', 'view', {isEdit: true, canEdit: true, isPDFEdit: false, isPDFAnnotate: false, isPDFFill: false, canPDFEdit: true, canPDFAnnotate: true}],
        ['view config without permissions', 'view', {isEdit: true, canEdit: true, isPDFEdit: false, isPDFAnnotate: false, isPDFFill: false, canPDFEdit: false, canPDFAnnotate: false}],
        ['edit config without PDF rights', 'edit', {isEdit: true, canEdit: true, isPDFEdit: false, isPDFAnnotate: false, isPDFFill: false, canPDFEdit: false, canPDFAnnotate: false}],
        ['PDF form', 'edit', {isForm: true, isRestrictedEdit: true, isEdit: false, canEdit: false, isPDFEdit: false, isPDFAnnotate: false, isPDFFill: false, canPDFEdit: false, canPDFAnnotate: false}],
        ['XPS/DjVu viewer', 'edit', {isXpsViewer: true, isEdit: false, canEdit: false, isPDFEdit: false, isPDFAnnotate: false, isPDFFill: false, canPDFEdit: false, canPDFAnnotate: false}]
    ]) {
        const viewSession = editorFixture(file, keyFields);
        attachDesktopLocks(viewSession, file);
        viewSession.editor.editorConfig.mode = mode;
        Object.assign(viewSession.editor.appOptions, opts);
        viewSession.refresh();
        viewSession.editor.disableEditing(true, 'refresh-file');
        viewSession.editor.onDocumentContentReady();
        assert.deepEqual(events(viewSession.messages), readyEvents('view'), `${label}: reports view mode`);
    }

    // 2. Edit config with PDF annotate/edit/fill rights reports 'edit' (including while refresh-file lock holds LeftMenu).
    for (const [label, opts] of [
        ['isPDFAnnotate', {isEdit: true, canEdit: true, isPDFAnnotate: true, isPDFEdit: false, isPDFFill: false, canPDFAnnotate: true, canPDFEdit: true}],
        ['isPDFEdit', {isEdit: true, canEdit: true, isPDFAnnotate: false, isPDFEdit: true, isPDFFill: false, canPDFAnnotate: true, canPDFEdit: true}],
        ['isPDFFill', {isEdit: true, canEdit: true, isPDFAnnotate: false, isPDFEdit: false, isPDFFill: true, canPDFAnnotate: false, canPDFEdit: false}],
        ['holdView', {isEdit: true, canEdit: true, isPDFAnnotate: false, isPDFEdit: false, isPDFFill: false, canPDFAnnotate: true, canPDFEdit: true}]
    ]) {
        const editSession = editorFixture(file, keyFields);
        attachDesktopLocks(editSession, file);
        editSession.editor.editorConfig.mode = 'edit';
        Object.assign(editSession.editor.appOptions, opts);
        editSession.refresh();
        editSession.editor.disableEditing(true, 'refresh-file');
        editSession.editor.onDocumentContentReady();
        assert.deepEqual(events(editSession.messages), readyEvents('edit'), `${label}: reports edit mode`);
    }

    // 3. CompactShell holdView keeps b24EditingAvailable published after releasing refresh-file lock.
    {
        const holdSession = editorFixture(file, keyFields);
        attachDesktopLocks(holdSession, file);
        holdSession.editor.editorConfig.mode = 'edit';
        Object.assign(holdSession.editor.appOptions, {
            isEdit: true, canEdit: true, isPDFAnnotate: false, isPDFEdit: false, isPDFFill: false, canPDFAnnotate: true, canPDFEdit: true
        });
        holdSession.refresh();
        holdSession.editor.disableEditing(true, 'refresh-file');
        holdSession.editor.onLicenseChanged({asc_getLicenseType: () => holdSession.context.Asc.c_oLicenseResult.Success});
        holdSession.editor.onLongActionEnd(holdSession.context.Asc.c_oAscAsyncActionType.Information, holdSession.context.Asc.c_oAscAsyncAction.RefreshFile);
        holdSession.editor.onDocumentContentReady();
        assert.deepEqual(events(holdSession.messages), [
            ['onInfo', {mode: 'edit', b24EditingAvailable: true}],
            ...readyEvents('edit')
        ]);
    }

    // 4. Initial readiness in pdfeditor Main.js uses getSessionEditRight('isEdit') so initial onInfo matches refreshFile.
    const pdfMainSource = fs.readFileSync(path.join(root, 'apps', file), 'utf8');
    assert.match(
        pdfMainSource,
        /Common\.Gateway\.sendInfo\(\{\s*mode:\s*me\.getSessionEditRight\('isEdit'\)\s*\?\s*'edit'\s*:\s*'view'\s*\}\)/,
        'initial pdfeditor sendInfo must use getSessionEditRight'
    );
});

test('Forms cancels refresh on critical LoadingScriptError', () => {
    const {editor, context, messages, refresh} = editorFixture('documenteditor/forms/app/controller/ApplicationController.js', ['document', 'fileKey']);
    const {Asc} = context;
    refresh();
    editor.onError(Asc.c_oAscError.ID.LoadingScriptError, Asc.c_oAscError.Level.Critical);
    editor.onDocumentContentReady();
    assert.deepEqual(messages, []);

    const nonCritical = editorFixture('documenteditor/forms/app/controller/ApplicationController.js', ['document', 'fileKey']);
    nonCritical.refresh();
    nonCritical.editor.onError(nonCritical.context.Asc.c_oAscError.ID.LoadingScriptError, nonCritical.context.Asc.c_oAscError.Level.NoCritical);
    nonCritical.editor.onDocumentContentReady();
    assert.deepEqual(events(nonCritical.messages), readyEvents('view'));
});

test('Forms does not replay stale license limit or b24_no_capacity after disconnect on a later refreshFile', () => {
    const file = 'documenteditor/forms/app/controller/ApplicationController.js';
    const formsSession = () => {
        const result = editorFixture(file, ['document', 'fileKey']);
        let tips = 0;
        result.context.Common.UI.TooltipManager.showTip = () => { tips++; };
        result.editor.onLicenseChanged = handler('apps/' + file, 'onLicenseChanged', result.context, result.editor);
        result.editor.applyLicense = handler('apps/' + file, 'applyLicense', result.context, result.editor);
        result.editor.appOptions.canFillForms = true;
        result.editor.appOptions.isAnonymousSupport = true;
        return {...result, getTips: () => tips, resetTips: () => { tips = 0; }};
    };

    // Success license on a connected form publishes b24EditingAvailable before refresh completion.
    const ok = formsSession();
    ok.refresh('key-0');
    ok.editor.onLicenseChanged({asc_getLicenseType: () => ok.context.Asc.c_oLicenseResult.Success});
    ok.editor.onDocumentContentReady();
    assert.deepEqual(events(ok.messages), [
        ['onInfo', {mode: 'view', b24EditingAvailable: true}],
        ...readyEvents('view')
    ]);

    const session = formsSession();
    const {editor, context, messages, notices, sdkCalls, refresh} = session;
    const {Asc} = context;

    refresh('key-1');
    editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
    editor.onDocumentContentReady();
    assert.equal(messages[0].data.warningCode, 'b24_no_capacity');
    assert.deepEqual(events(messages.slice(1)), readyEvents('view'));
    assert.ok(notices.includes('api:disconnect'));
    assert.ok(sdkCalls.includes('disconnect'));
    assert.equal(editor._state.isDisconnected, true);

    // Subsequent refresh with Success must not replay b24_no_capacity or disconnect again.
    messages.length = 0;
    notices.length = 0;
    sdkCalls.length = 0;
    refresh('key-2');
    editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.Success});
    editor.onDocumentContentReady();
    assert.deepEqual(events(messages), readyEvents('view'));
    assert.equal(notices.includes('api:disconnect'), false);
    assert.equal(sdkCalls.includes('disconnect'), false);

    // Subsequent refresh with ConnectionsOS on the already-disconnected form must stay silent.
    messages.length = 0;
    notices.length = 0;
    sdkCalls.length = 0;
    refresh('key-3');
    editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
    editor.onDocumentContentReady();
    assert.deepEqual(events(messages), readyEvents('view'));
    assert.equal(notices.includes('api:disconnect'), false);
    assert.equal(sdkCalls.includes('disconnect'), false);

    // A form disconnected for a non-license reason (isDisconnected or isFormDisconnected) ignores limits and Success.
    for (const flag of ['isDisconnected', 'isFormDisconnected']) {
        const preDisconnected = formsSession();
        preDisconnected.editor._state[flag] = true;
        for (const [key, licType] of [
            ['key-4', preDisconnected.context.Asc.c_oLicenseResult.ConnectionsOS],
            ['key-5', preDisconnected.context.Asc.c_oLicenseResult.Success]
        ]) {
            preDisconnected.messages.length = 0;
            preDisconnected.notices.length = 0;
            preDisconnected.sdkCalls.length = 0;
            preDisconnected.refresh(key);
            preDisconnected.editor.onLicenseChanged({asc_getLicenseType: () => licType});
            preDisconnected.editor.onDocumentContentReady();
            assert.deepEqual(events(preDisconnected.messages), readyEvents('view'));
            assert.equal(preDisconnected.notices.includes('api:disconnect'), false);
            assert.equal(preDisconnected.sdkCalls.includes('disconnect'), false);
        }
    }

    // Repeat SuccessLimit does not re-show the tooltip, while a later ConnectionsOS still disconnects.
    const limited = formsSession();
    limited.editor.appOptions.trialMode = limited.context.Asc.c_oLicenseMode.Limited;
    limited.refresh('key-6');
    limited.editor.onLicenseChanged({asc_getLicenseType: () => limited.context.Asc.c_oLicenseResult.SuccessLimit});
    limited.editor.onDocumentContentReady();
    assert.equal(limited.getTips(), 1);
    assert.equal(limited.editor._state.isDisconnected, false);
    assert.deepEqual(events(limited.messages), [
        ['onInfo', {mode: 'view', b24EditingAvailable: true}],
        ...readyEvents('view')
    ]);

    limited.resetTips();
    limited.messages.length = 0;
    limited.refresh('key-7');
    limited.editor.onLicenseChanged({asc_getLicenseType: () => limited.context.Asc.c_oLicenseResult.SuccessLimit});
    limited.editor.onDocumentContentReady();
    assert.equal(limited.getTips(), 0);
    assert.deepEqual(events(limited.messages), readyEvents('view'));

    limited.resetTips();
    limited.messages.length = 0;
    limited.notices.length = 0;
    limited.sdkCalls.length = 0;
    limited.refresh('key-8');
    limited.editor.onLicenseChanged({asc_getLicenseType: () => limited.context.Asc.c_oLicenseResult.ConnectionsOS});
    limited.editor.onDocumentContentReady();
    assert.equal(limited.getTips(), 0);
    assert.equal(limited.messages[0].data.warningCode, 'b24_no_capacity');
    assert.deepEqual(events(limited.messages.slice(1)), readyEvents('view'));
    assert.ok(limited.notices.includes('api:disconnect'));
    assert.ok(limited.sdkCalls.includes('disconnect'));
    assert.equal(limited.editor._state.isDisconnected, true);

    // Deferred license during refreshFile: Success does not leak b24EditingAvailable before ready,
    // and ConnectionsOS overwritten by Success before ready does not disconnect.
    const deferred = editorFixture('documenteditor/forms/app/controller/ApplicationController.js', ['document', 'fileKey']);
    deferred.editor.appOptions.canFillForms = true;
    deferred.editor.onLicenseChanged = handler('apps/documenteditor/forms/app/controller/ApplicationController.js', 'onLicenseChanged', deferred.context, deferred.editor);
    deferred.editor.applyLicense = handler('apps/documenteditor/forms/app/controller/ApplicationController.js', 'applyLicense', deferred.context, deferred.editor);
    deferred.editor.onDisconnectEveryone = handler('apps/documenteditor/forms/app/controller/ApplicationController.js', 'onDisconnectEveryone', deferred.context, deferred.editor);
    deferred.editor.showFillingForms = noop;
    deferred.refresh('key-defer-1');
    deferred.editor.onLicenseChanged({asc_getLicenseType: () => deferred.context.Asc.c_oLicenseResult.ConnectionsOS});
    assert.deepEqual(deferred.messages, []);
    assert.equal(deferred.editor._state.isDisconnected, false);
    deferred.editor.onLicenseChanged({asc_getLicenseType: () => deferred.context.Asc.c_oLicenseResult.Success});
    assert.deepEqual(deferred.messages, [], 'Success stays deferred until ready');
    deferred.editor.onDocumentContentReady();
    assert.equal(deferred.editor._state.isDisconnected, false);
    assert.deepEqual(events(deferred.messages), [
        ['onInfo', {mode: 'view', b24EditingAvailable: true}],
        ...readyEvents('view')
    ]);

    // onDisconnectEveryone clears deferred refreshFileLicense.
    deferred.messages.length = 0;
    deferred.refresh('key-defer-2');
    deferred.editor.onLicenseChanged({asc_getLicenseType: () => deferred.context.Asc.c_oLicenseResult.Success});
    deferred.editor.onDisconnectEveryone();
    assert.equal(deferred.editor._state.refreshFileLicense, null);
});

for (const [label, file, keyFields] of editors.filter(([, entry]) => entry.endsWith('.jsx'))) {
    test(`${label} does not replay stale license limit or reopen dialog after disconnect on a later refreshFile`, () => {
        const session = editorFixture(file, keyFields);
        const {editor, context, messages, notices, sdkCalls, dialogs, refresh} = session;
        const {Asc} = context;
        editor.onLicenseChanged = handler('apps/' + file, 'onLicenseChanged', context, editor);
        editor.applyLicense = handler('apps/' + file, 'applyLicense', context, editor);

        // First refresh with capacity limit opens one dialog and disconnects the mobile session.
        refresh('key-1');
        editor.onLicenseChanged({asc_getLicenseType: () => Asc.c_oLicenseResult.ConnectionsOS});
        editor.onDocumentContentReady();
        assert.equal(dialogs.length, 1);
        assert.ok(sdkCalls.includes('disconnect'));
        assert.ok(notices.includes('api:disconnect'));
        assert.equal(editor.props.users.isDisconnected, true);
        assert.deepEqual(events(messages), readyEvents('view'));

        // Subsequent refresh with Success or ConnectionsOS must not reopen dialogs or disconnect again.
        for (const [key, licType] of [['key-2', Asc.c_oLicenseResult.Success], ['key-3', Asc.c_oLicenseResult.ConnectionsOS]]) {
            dialogs.length = 0;
            messages.length = 0;
            notices.length = 0;
            sdkCalls.length = 0;
            refresh(key);
            editor.onLicenseChanged({asc_getLicenseType: () => licType});
            editor.onDocumentContentReady();
            assert.equal(dialogs.length, 0);
            assert.equal(sdkCalls.includes('disconnect'), false);
            assert.equal(notices.includes('api:disconnect'), false);
            assert.deepEqual(events(messages), readyEvents('view'));
        }

        // An already-disconnected mobile session ignores ConnectionsOS on refreshFile.
        const preDisc = editorFixture(file, keyFields);
        preDisc.editor.onLicenseChanged = handler('apps/' + file, 'onLicenseChanged', preDisc.context, preDisc.editor);
        preDisc.editor.applyLicense = handler('apps/' + file, 'applyLicense', preDisc.context, preDisc.editor);
        preDisc.editor.props.users.resetDisconnected(true);
        preDisc.refresh('key-4');
        preDisc.editor.onLicenseChanged({asc_getLicenseType: () => preDisc.context.Asc.c_oLicenseResult.ConnectionsOS});
        preDisc.editor.onDocumentContentReady();
        assert.equal(preDisc.dialogs.length, 0);
        assert.equal(preDisc.sdkCalls.includes('disconnect'), false);
        assert.deepEqual(events(preDisc.messages), readyEvents('view'));

        // Repeat SuccessLimit does not spam dialogs, while a later ConnectionsOS still disconnects.
        const limited = editorFixture(file, keyFields);
        limited.editor.onLicenseChanged = handler('apps/' + file, 'onLicenseChanged', limited.context, limited.editor);
        limited.editor.applyLicense = handler('apps/' + file, 'applyLicense', limited.context, limited.editor);
        limited.editor.props.storeAppOptions.trialMode = limited.context.Asc.c_oLicenseMode.Limited;
        limited.refresh('key-5');
        limited.editor.onLicenseChanged({asc_getLicenseType: () => limited.context.Asc.c_oLicenseResult.SuccessLimit});
        limited.editor.onDocumentContentReady();
        assert.equal(limited.dialogs.length, 1);
        assert.equal(limited.editor.props.users.isDisconnected, false);
        assert.deepEqual(events(limited.messages), readyEvents('edit'));

        limited.dialogs.length = 0;
        limited.messages.length = 0;
        limited.refresh('key-6');
        limited.editor.onLicenseChanged({asc_getLicenseType: () => limited.context.Asc.c_oLicenseResult.SuccessLimit});
        limited.editor.onDocumentContentReady();
        assert.equal(limited.dialogs.length, 0);
        assert.deepEqual(events(limited.messages), readyEvents('edit'));

        limited.dialogs.length = 0;
        limited.messages.length = 0;
        limited.refresh('key-7');
        limited.editor.onLicenseChanged({asc_getLicenseType: () => limited.context.Asc.c_oLicenseResult.ConnectionsOS});
        limited.editor.onDocumentContentReady();
        assert.equal(limited.dialogs.length, 1);
        assert.equal(limited.editor.props.users.isDisconnected, true);
        assert.deepEqual(events(limited.messages), readyEvents('view'));

        // Live-view limit disables fast collaboration once and stays quiet on subsequent refreshes.
        const liveView = editorFixture(file, keyFields);
        liveView.editor.onLicenseChanged = handler('apps/' + file, 'onLicenseChanged', liveView.context, liveView.editor);
        liveView.editor.applyLicense = handler('apps/' + file, 'applyLicense', liveView.context, liveView.editor);
        liveView.editor.props.storeAppOptions.config.mode = 'view';
        liveView.editor.props.storeAppOptions.isEdit = false;
        liveView.editor.props.storeAppOptions.canEdit = false;
        liveView.editor.props.storeAppOptions.canLiveView = true;
        liveView.refresh('key-8');
        liveView.editor.onLicenseChanged({asc_getLicenseType: () => liveView.context.Asc.c_oLicenseResult.ConnectionsLive});
        liveView.editor.onDocumentContentReady();
        assert.equal(liveView.editor.props.storeAppOptions.canLiveView, false);
        assert.deepEqual(liveView.sdkCalls.filter(Array.isArray), [['fastCollab', false]]);
        assert.deepEqual(events(liveView.messages), readyEvents('view'));

        liveView.sdkCalls.length = 0;
        liveView.messages.length = 0;
        liveView.refresh('key-9');
        liveView.editor.onLicenseChanged({asc_getLicenseType: () => liveView.context.Asc.c_oLicenseResult.Success});
        liveView.editor.onDocumentContentReady();
        assert.deepEqual(liveView.sdkCalls.filter(Array.isArray), []);
        assert.deepEqual(events(liveView.messages), readyEvents('view'));

        // Deferred license during mobile refreshFile: ConnectionsOS waits for ready and can be superseded by Success;
        // cancellation from Error.jsx (Gateway.cancelRefreshFile) drops deferred license on subsequent readiness.
        const deferred = editorFixture(file, keyFields);
        deferred.editor.onLicenseChanged = handler('apps/' + file, 'onLicenseChanged', deferred.context, deferred.editor);
        deferred.editor.applyLicense = handler('apps/' + file, 'applyLicense', deferred.context, deferred.editor);
        deferred.refresh('key-10');
        deferred.editor.onLicenseChanged({asc_getLicenseType: () => deferred.context.Asc.c_oLicenseResult.ConnectionsOS});
        assert.equal(deferred.dialogs.length, 0, 'limit dialog deferred until ready');
        assert.equal(deferred.editor.props.users.isDisconnected, false);
        deferred.editor.onLicenseChanged({asc_getLicenseType: () => deferred.context.Asc.c_oLicenseResult.Success});
        deferred.editor.onDocumentContentReady();
        assert.equal(deferred.dialogs.length, 0);
        assert.equal(deferred.editor.props.users.isDisconnected, false);
        assert.deepEqual(events(deferred.messages), readyEvents('edit'));

        deferred.messages.length = 0;
        deferred.refresh('key-11');
        deferred.editor.onLicenseChanged({asc_getLicenseType: () => deferred.context.Asc.c_oLicenseResult.ConnectionsOS});
        deferred.gateway.cancelRefreshFile();
        deferred.editor.onDocumentContentReady();
        assert.equal(deferred.dialogs.length, 0);
        assert.equal(deferred.editor.props.users.isDisconnected, false);
        assert.deepEqual(deferred.messages, []);
    });
}

for (const [label, errorFile] of [
    ['Document mobile', 'apps/documenteditor/mobile/src/controller/Error.jsx'],
    ['Spreadsheet mobile', 'apps/spreadsheeteditor/mobile/src/controller/Error.jsx'],
    ['Presentation mobile', 'apps/presentationeditor/mobile/src/controller/Error.jsx'],
    ['Visio mobile', 'apps/visioeditor/mobile/src/controller/Error.jsx']
]) {
    test(`${label} Error controller cancels refresh on critical early-return errors`, () => {
        for (const idName of ['LoadingScriptError', 'UserDrop']) {
            const {context, gateway, messages} = fixture();
            const {Asc} = context;
            Object.assign(context, {
                _t: {criticalErrorTitle: 'err', scriptLoadError: 'script'},
                storeAppOptions: {lostEditingRights: true, changeEditingRights: noop}
            });
            const onError = handler(errorFile, 'onError', context, {});
            gateway.beginRefreshFile();
            onError(Asc.c_oAscError.ID[idName], Asc.c_oAscError.Level.Critical);
            assert.equal(gateway.completeRefreshFile({mode: 'view'}), false, `${idName} cancels refresh`);
            assert.deepEqual(messages, []);

            gateway.beginRefreshFile();
            onError(Asc.c_oAscError.ID[idName], Asc.c_oAscError.Level.NoCritical);
            assert.equal(gateway.completeRefreshFile({mode: 'view'}), true, `${idName} non-critical keeps refresh`);
            assert.deepEqual(events(messages), readyEvents('view'));
        }
    });
}

for (const mobile of [false, true]) {
    const file = mobile ? 'apps/common/mobile/lib/controller/VersionHistory.jsx' :
        'apps/common/main/lib/controller/History.js';
    for (const fromHost of [false, true]) {
        test(`${mobile ? 'Mobile' : 'Desktop'} history cancels refresh before showing a ${fromHost ? 'fetched' : 'cached'} revision`, () => {
            const {context, gateway, messages} = fixture();
            const revision = {revision: 2, url: '/revision', urlGetTime: new Date()};
            const historyStore = {findRevisions: () => [], changeVersion: noop};
            let shown = 0;
            const api = {
                asc_showRevision(info) {
                    shown++;
                    assert.equal(info.url, '/revision');
                    gateway.completeRefreshFile({mode: 'view'});
                }
            };
            context.Asc.asc_CVersionHistory = class {
                asc_setUrl(url) { this.url = url; }
            };
            for (const setter of ['setDocId', 'setUrlChanges', 'setCurrentChangeId', 'setArrColors', 'setToken',
                'setIsRequested', 'setServerVersion', 'SetUserId', 'SetUserName', 'SetUserColor',
                'SetDateOfRevision', 'setDocumentSha256']) {
                context.Asc.asc_CVersionHistory.prototype['asc_' + setter] = noop;
            }
            const mode = {canUseHistory: true};
            const controller = {api, mode, getApplication: () => ({
                getCollection: () => historyStore,
                getController: () => undefined
            })};
            Object.assign(context, {
                api, historyStore, appOptions: mode, timeoutIdRef: {}, currentArrColors: {},
                _: {isEmpty: value => !value}
            });
            for (const name of ['currentRev', 'currentChangeId', 'currentDocId', 'currentDocIdPrev',
                'currentServerVersion', 'currentUserId', 'currentUserName', 'currentUserColor', 'currentDateCreated']) {
                context[name] = undefined;
            }
            gateway.beginRefreshFile();
            if (fromHost) {
                handler(file, 'onSetHistoryData', context, controller)({data: {version: 2, url: revision.url}});
            } else {
                const select = handler(file, 'onSelectRevision', context, controller);
                if (mobile) {
                    select(revision);
                } else {
                    select({}, null, {get: name => revision[name]});
                }
            }
            assert.equal(shown, 1);
            assert.deepEqual(messages, []);
        });

        test(`${mobile ? 'Mobile' : 'Desktop'} history preserves pending refresh when asc_showRevision rejects a ${fromHost ? 'fetched' : 'cached'} revision`, () => {
            const {context, gateway, messages} = fixture();
            const revision = {revision: 2, url: '/revision', urlGetTime: new Date()};
            const historyStore = {findRevisions: () => [], changeVersion: noop};
            let shown = 0;
            const api = {
                asc_showRevision(info) {
                    shown++;
                    assert.equal(info.url, '/revision');
                    return false;
                }
            };
            context.Asc.asc_CVersionHistory = class {
                asc_setUrl(url) { this.url = url; }
            };
            for (const setter of ['setDocId', 'setUrlChanges', 'setCurrentChangeId', 'setArrColors', 'setToken',
                'setIsRequested', 'setServerVersion', 'SetUserId', 'SetUserName', 'SetUserColor',
                'SetDateOfRevision', 'setDocumentSha256']) {
                context.Asc.asc_CVersionHistory.prototype['asc_' + setter] = noop;
            }
            const mode = {canUseHistory: true};
            const controller = {api, mode, getApplication: () => ({
                getCollection: () => historyStore,
                getController: () => undefined
            })};
            Object.assign(context, {
                api, historyStore, appOptions: mode, timeoutIdRef: {}, currentArrColors: {},
                _: {isEmpty: value => !value}
            });
            for (const name of ['currentRev', 'currentChangeId', 'currentDocId', 'currentDocIdPrev',
                'currentServerVersion', 'currentUserId', 'currentUserName', 'currentUserColor', 'currentDateCreated']) {
                context[name] = undefined;
            }
            gateway.beginRefreshFile();
            if (fromHost) {
                handler(file, 'onSetHistoryData', context, controller)({data: {version: 2, url: revision.url}});
            } else {
                const select = handler(file, 'onSelectRevision', context, controller);
                if (mobile) {
                    select(revision);
                } else {
                    select({}, null, {get: name => revision[name]});
                }
            }
            assert.equal(shown, 1);
            assert.equal(gateway.completeRefreshFile({mode: 'edit'}), true);
            assert.deepEqual(events(messages), readyEvents('edit'));

            // When no refresh is pending, a rejected revision must not arm refreshFilePending.
            messages.length = 0;
            if (fromHost) {
                handler(file, 'onSetHistoryData', context, controller)({data: {version: 2, url: revision.url}});
            } else {
                const select = handler(file, 'onSelectRevision', context, controller);
                if (mobile) {
                    select(revision);
                } else {
                    select({}, null, {get: name => revision[name]});
                }
            }
            assert.equal(shown, 2);
            assert.equal(gateway.isRefreshFilePending(), false);
            assert.equal(gateway.completeRefreshFile({mode: 'edit'}), false);
            assert.deepEqual(messages, []);
        });
    }
}

test('Gateway clears pending refresh when the engine requests a new refreshFile', () => {
    const {gateway, messages} = fixture();
    gateway.beginRefreshFile();
    gateway.requestRefreshFile();
    assert.deepEqual(events(messages), [['onRequestRefreshFile', undefined]]);
    messages.length = 0;

    assert.equal(gateway.completeRefreshFile({mode: 'edit'}), false);
    assert.deepEqual(messages, []);
});
