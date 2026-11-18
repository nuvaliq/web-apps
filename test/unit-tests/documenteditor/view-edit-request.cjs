/* Run: node test/unit-tests/documenteditor/view-edit-request.cjs
 * Edit request from a view session. The host declares onRequestEditRights (canRequestEditRights), the signed
 * config is permissions.edit=false, review=false, mode='view' and carries a non-empty editorConfig.ui.shell.
 * In such a session the document, spreadsheet and presentation editors offer their stock edit entry (the header
 * button, the compact "Edit document" item of the document editor, the "File" menu item), while every option
 * derived from the rights stays as with edit=false. Integrations without the handler or without ui.shell and
 * sessions opened for editing keep the stock options.
 * Main.js does not load in vm: onEditorPermissions of each editor is cut out of the source and run in vm on stubs;
 * the options are recorded where the views receive them (applyModeCommonElements, app:face, the end of the call).
 * The entry conditions of Header.js and FileMenu.js are cut out of the source and evaluated on those options.
 * The spreadsheet compact header offers Edit only when CompactShell.buildEditButton is gated by
 * canRequestEdit. DocumentActions.js and the document CompactShell.js load in vm as they are.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const EDITORS = {
    docx: {
        main: 'apps/documenteditor/main/app/controller/Main.js',
        fileMenu: 'apps/documenteditor/main/app/view/FileMenu.js'
    },
    xlsx: {
        main: 'apps/spreadsheeteditor/main/app/controller/Main.js',
        fileMenu: 'apps/spreadsheeteditor/main/app/view/FileMenu.js'
    },
    pptx: {
        main: 'apps/presentationeditor/main/app/controller/Main.js',
        fileMenu: 'apps/presentationeditor/main/app/view/FileMenu.js'
    }
};
const TYPES = Object.keys(EDITORS);
const HEADER = 'apps/common/main/lib/view/Header.js';
const VIEW = 'apps/documenteditor/main/app/view';
/* Values of ui.shell a session may carry: 'modern' turns the compact shell of the document editor on,
 * any other string keeps the stock interface. The editors read no other value of the key. */
const STOCK_SHELL = 'standard';
const SHELLS = [STOCK_SHELL, 'modern'];
/* Values that do not mark the session: the key is missing, empty or not a string. */
const NOT_A_SHELL = [undefined, null, '', 0, 1, true, false, {}, ['modern'], {shell: 'modern'}];

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* From the match of `start` to the bracket that closes the first "{" after it. Strings and comments are skipped,
 * so braces in them do not count. */
function cutBlock(text, start) {
    const m = start.exec(text);
    assert.ok(m, 'source has ' + start);
    let depth = 0, opened = false;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
        const c = text[i];
        if (c === '\'' || c === '"' || c === '`') {
            for (i++; i < text.length && text[i] !== c; i++)
                if (text[i] === '\\') i++;
        } else if (c === '/' && text[i + 1] === '/') {
            i = text.indexOf('\n', i);
        } else if (c === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i + 2) + 1;
        } else if (c === '{') {
            depth++; opened = true;
        } else if (c === '}' && --depth === 0 && opened) {
            return text.slice(m.index + m[0].length - 1, i + 1);
        }
    }
    assert.fail('block ' + start + ' is not closed');
}

/* Plain copies of vm-realm values, for deepEqual. */
const plain = value => JSON.parse(JSON.stringify(value));

/* Keys whose values differ between two plain objects. */
function changedKeys(a, b) {
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    return Array.from(keys).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

/* ---- onEditorPermissions on stubs ------------------------------------------------------------------------- */

/* Distinct values are enough: the function only compares them. */
const LICENSE = {};
['Error', 'Expired', 'Success', 'UnknownUser', 'Connections', 'ExpiredTrial', 'SuccessLimit', 'UsersCount',
    'ConnectionsOS', 'UsersCountOS', 'ExpiredLimited', 'ConnectionsLiveOS', 'ConnectionsLive', 'UsersViewCount',
    'UsersViewCountOS', 'NotBefore'].forEach((name, index) => { LICENSE[name] = index + 1; });
const RIGHTS = {None: 0, Edit: 1, Review: 2, Comment: 3, View: 4};

/* Setters with nothing to return: header view, plugins controller and the like. */
const sink = () => new Proxy(function () {}, {get: (t, k) => (k === 'then' ? undefined : sink()), apply: () => undefined});

const compiled = {};
function permissionsFunction(type) {
    if (!compiled[type])
        compiled[type] = 'function (params) ' + cutBlock(read(EDITORS[type].main), /\bonEditorPermissions:\s*function\s*\(params\)\s*\{/);
    return compiled[type];
}

/* A session as the host and the platform hand it over. Keys of `config` go over the defaults; a key set to
 * undefined is dropped, so `{ui: undefined}` is a config without ui. */
function session({edit = false, review = false, mode = 'view', config = {}} = {}) {
    const editorConfig = {mode, canRequestEditRights: true, canSendEmailAddresses: true, canRename: false,
        canUseHistory: false, customization: {}, user: {id: 'u1', name: 'User'}};
    for (const [key, value] of Object.entries(config)) {
        if (value === undefined) delete editorConfig[key];
        else editorConfig[key] = value;
    }
    return {permissions: {edit, review, download: true, print: true, comment: false, chat: false}, editorConfig};
}
const withShell = (shell, extra) => Object.assign({ui: {shell}}, extra);

/* Runs onEditorPermissions of the editor on a fresh controller over plain copies of the session.
 * Returns the options where the views receive them and the session objects after the call. */
function run(type, input) {
    const {permissions, editorConfig} = plain(input);
    const seen = {};
    const controller = {
        permissions, editorConfig,
        document: {fileType: type, key: 'key-1', info: {favorite: null}},
        appOptions: {user: {id: 'u1', fullname: 'User'}, customization: {}, isDesktopApp: false, isPDFForm: false,
            canCreateNew: true, canRequestUsers: false, spreadsheet: {info: {favorite: null}}},
        api: {
            asc_isOffline: () => false, asc_isCrypto: () => false, asc_isSignaturesSupport: () => false,
            asc_isProtectionSupport: () => true, asc_isAnonymousSupport: () => true,
            asc_setViewMode() {}, asc_setCanSendChanges() {}, asc_setRestriction() {}, asc_LoadDocument() {}
        },
        headerView: sink(),
        _isDocReady: false, _isPermissionsInited: false,
        onServerVersion: () => false,
        onLanguageLoaded: () => true,
        getApplication: () => ({getController: () => sink()}),
        loadCoAuthSettings() {},
        applyModeCommonElements() { seen.common = plain(this.appOptions); },
        applyModeEditorElements() {},
        hidePreloader() {}, onLongActionBegin() {}, onClearDummyComment() {}, onShowDummyComment() {}, disableEditing() {}
    };
    const params = {
        asc_getLicenseType: () => LICENSE.Success, asc_getRights: () => RIGHTS.Edit, asc_getBuildVersion: () => '9.4.0',
        asc_getIsAnalyticsEnable: () => false, asc_getIsLight: () => false, asc_getLicenseMode: () => 0,
        asc_getIsBeta: () => false, asc_getCanBranding: () => false, asc_getCustomization: () => false,
        asc_getLiveViewerSupport: () => true
    };
    const context = {
        Asc: {c_oLicenseResult: LICENSE, c_oRights: RIGHTS, c_oAscAsyncActionType: {BlockInteraction: 1},
            c_oAscRestrictionType: {OnlyComments: 1, OnlyForms: 2}},
        Common: {
            UI: {warning() {}, LayoutManager: sink(), FeaturesManager: sink(), TabStyler: sink(), ExternalUsers: sink()},
            Utils: {isMac: false},
            NotificationCenter: {on() {}, trigger: (event, options) => { if (event === 'app:face') seen.face = plain(options); }}
        },
        AscCommon: {UserInfoParser: {setParser() {}, setCurrentName() {}, getCurrentName: () => 'User', getParsedName: n => n,
            setReviewPermissions() {}, setCommentPermissions() {}, setUserInfoPermissions() {}}},
        appHeader: sink(),
        LoadingDocument: -256,
        _: {bind: fn => fn},
        console: {log() {}}
    };
    vm.runInNewContext('(' + permissionsFunction(type) + ')', context, {filename: EDITORS[type].main}).call(controller, params);
    seen.final = plain(controller.appOptions);
    assert.ok(seen.common, type + ': applyModeCommonElements is reached');
    return {seen, permissions: plain(controller.permissions), editorConfig: plain(controller.editorConfig)};
}

/* The options a view gets, by the moment it reads them: the header renders on app:face, the document editor's
 * "File" menu gets them in applyModeCommonElements, the other "File" menus and the compact menu later. */
const faceOptions = r => r.seen.face || r.seen.final;
const fileMenuOptions = (type, r) => (type === 'docx' ? r.seen.common : r.seen.final);
const allOptions = r => [['applyModeCommonElements', r.seen.common], ['app:face', r.seen.face], ['end', r.seen.final]]
    .filter(([, options]) => options);

/* ---- Entry conditions from the views ---------------------------------------------------------------------- */

const headerSource = read(HEADER);
/* The header button: `if ( config.canRequestEditRights && (…) ) this.btnEdit = createTitleButton(…)`. */
const headerCondition = (() => {
    const m = /if\s*\(\s*(config\.canRequestEditRights\s*&&[\s\S]*?)\)\s*\n\s*this\.btnEdit\s*=\s*createTitleButton\(/.exec(headerSource);
    assert.ok(m, 'Header.js creates btnEdit under a canRequestEditRights condition');
    /* isPDFEditor is `!!window.PDFE`: false in the three editors. */
    return vm.runInNewContext('(function (config, isPDFEditor) { return !!(' + m[1] + '); })', {});
})();
const headerOffersEdit = options => headerCondition(options, false);

/* The "File" menu item: `this.miEdit[<condition> ? 'show' : 'hide']()`, the condition maybe in `var canEdit`. */
const fileMenuConditions = {};
for (const type of TYPES) {
    const source = read(EDITORS[type].fileMenu);
    const m = /this\.miEdit\[\s*([\s\S]*?)\s*\?\s*'show'\s*:\s*'hide'\s*\]\(\)/.exec(source);
    assert.ok(m, type + ' FileMenu.js shows or hides miEdit');
    let condition = m[1];
    if (/^\w+$/.test(condition)) {
        const v = new RegExp('var\\s+' + condition + '\\s*=\\s*([^;]*);').exec(source.slice(0, m.index));
        assert.ok(v, type + ' FileMenu.js defines ' + condition);
        condition = v[1];
    }
    fileMenuConditions[type] = vm.runInNewContext('(function () { return !!(' + condition + '); })', {});
}
const fileMenuOffersEdit = (type, options) => fileMenuConditions[type].call({mode: options});

/* Spreadsheet compact header: the same canRequestEdit the "File" item uses, and only once
   buildEditButton refuses to build without that condition. */
const SHEET_SHELL = 'apps/spreadsheeteditor/main/app/view/CompactShell.js';
const sheetShellSource = read(SHEET_SHELL);
const sheetCanRequestEdit = (() => {
    const m = /canRequestEdit:\s*function\s*\(\)\s*\{([\s\S]*?)\n        \},/.exec(sheetShellSource);
    assert.ok(m, 'SSE CompactShell.js defines canRequestEdit');
    return vm.runInNewContext(
        '(function (options) {\n' +
        '  var SSE = {getController: function () { return {appOptions: options || {}}; }};\n' +
        m[1] + '\n})',
        {});
})();
const sheetEditButtonGated = /buildEditButton:\s*function\s*\(\)\s*\{[\s\S]*?if\s*\(\s*!this\.canRequestEdit\(\)\s*\)\s*return null/.test(sheetShellSource);
const sheetHeaderOffersEdit = r => sheetEditButtonGated && sheetCanRequestEdit(r.seen.final);

/* The compact shell and its menu, loaded as they are. */
let compactMain = {appOptions: {}, editorConfig: {}};
const compactContext = {
    DE: null,
    document: {body: {classList: {add() {}, remove() {}, contains: () => false, toggle() {}}}, getElementById: () => null},
    $: () => new Proxy({length: 0}, {get: (t, k) => (k in t ? t[k] : () => t)}),
    setTimeout() {}, clearTimeout() {},
    console: {warn() {}, log() {}},
    _: {extend: Object.assign},
    Common: {NotificationCenter: {on() {}, trigger() {}}, Locale: {getCurrentLanguage: () => 'en'}, Utils: {},
        localStorage: {itemExists: () => false, getBool: () => false}},
    define: (dependencies, factory) => factory({})
};
compactContext.DE = {Views: {}, Controllers: {}, getController: name => (name === 'Main' ? compactMain : null)};
compactContext.window = {DE: compactContext.DE, open: () => null};
vm.createContext(compactContext);
for (const file of ['apps/common/main/lib/view/compact/MenuModel.js', VIEW + '/DocumentActions.js', VIEW + '/CompactShell.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), compactContext, {filename: path.join(ROOT, file)});
const menuModel = compactContext.Common.UI.Compact.MenuModel;
const actions = compactContext.DE.Views.DocumentActions;
const compactShell = compactContext.DE.Views.CompactShell;

compactContext.PE = {Views: {}, getController: name => name === 'Main' ? compactMain : null};
compactContext.window.PE = compactContext.PE;
vm.runInContext(read('apps/presentationeditor/main/app/view/CompactShell.js'), compactContext);
const presentationShell = compactContext.PE.Views.CompactShell;

/* Rows of the compact menu built on these options: every SDK method is there and returns nothing, the shell
   offers nothing, the only common reason is the one of a session opened for viewing. The menu shows what the
   shared model shows: items whose rights hold, separators tidied. */
function compactRows(r) {
    compactMain = {appOptions: r.seen.final, editorConfig: r.editorConfig};
    actions.api = new Proxy({}, {get: () => () => undefined});
    actions.shell = new Proxy({}, {get: () => () => false});
    const options = () => compactMain.appOptions || {};
    const ctx = {has: () => true, options, canEdit: () => !!(options().canEdit || options().isEdit),
        edit: () => (options().isEdit ? null : ['view']), net: () => null, on: code => code === 'view' && !options().isEdit};
    return actions.sections().map(group => ({label: group.t, rows: menuModel.section(group.items, ctx).rows}));
}
function compactMenu(r) {
    return compactRows(r).map(group => ({label: group.label,
        items: group.rows.map(row => (row.kind === 'sep' ? '-' : row.label))}));
}
/* The menu without the edit item, separators tidied as the menu tidies them: no leading, double or closing ones. */
const withoutEditItem = menu => menu.map(group => {
    const items = [];
    for (const item of group.items.filter(t => t !== actions.textEditDoc))
        if (item !== '-' || items.length && items[items.length - 1] !== '-') items.push(item);
    while (items.length && items[items.length - 1] === '-') items.pop();
    return {label: group.label, items};
});
const compactOffersEdit = r => compactMenu(r).some(group => group.items.includes(actions.textEditDoc));

/* Every entry of the editor on the options its view gets. */
function entries(type, r) {
    const list = {header: headerOffersEdit(faceOptions(r)), fileMenu: fileMenuOffersEdit(type, fileMenuOptions(type, r))};
    if (type === 'docx') list.compact = compactOffersEdit(r);
    if (type === 'xlsx') list.sheetHeader = sheetHeaderOffersEdit(r);
    return list;
}
const noEntries = (type, r) => Object.fromEntries(Object.keys(entries(type, r)).map(k => [k, false]));

/* Options of a session must match the same session run with another config, at every point the views read them. */
function sameOptions(type, a, b, label) {
    for (const [point, options] of allOptions(a)) {
        const other = point === 'app:face' ? b.seen.face : point === 'end' ? b.seen.final : b.seen.common;
        assert.ok(other, label + ': ' + point + ' is reached in both runs');
        assert.deepEqual(changedKeys(options, other), [], label + ': options at ' + point + ' differ');
    }
    assert.equal(!!a.seen.face, !!b.seen.face, label + ': app:face in both runs or in neither');
}

const VIEW_SESSION = shell => session({config: withShell(shell)});
const WITHOUT_SHELL = (extra = {}) => session(Object.assign({}, extra, {config: Object.assign({ui: undefined}, extra.config)}));

check('document_compact_header_uses_actual_main_options', () => {
    for (const shell of [undefined, 'standard', 'modern', 'other']) {
        const r = run('docx', shell === undefined ? WITHOUT_SHELL() : VIEW_SESSION(shell));
        compactMain = {appOptions: r.seen.final, editorConfig: r.editorConfig,
            document: {fileType: 'docx'}, markEditRequest() {}, isEditRequestWaiting() { return false; }};
        assert.equal(compactShell.canRequestEdit(), shell === 'modern', String(shell));
        for (const type of ['PDF', 'djvu', 'xps', 'oxps', 'docxf', 'OFORM']) {
            compactMain.document.fileType = type;
            assert.equal(compactShell.canRequestEdit(), false, type);
        }
        compactMain.document.fileType = 'docx';
        delete compactMain.markEditRequest;
        assert.equal(compactShell.canRequestEdit(), false);
    }
});

check('presentation_compact_header_uses_actual_main_options', () => {
    for (const shell of [undefined, 'standard', 'modern', 'other']) {
        const r = run('pptx', shell === undefined ? WITHOUT_SHELL() : VIEW_SESSION(shell));
        compactMain = {appOptions: r.seen.final, editorConfig: r.editorConfig,
            markEditRequest() {}, isEditRequestWaiting() { return false; }};
        presentationShell.rightSnapshot = false;
        assert.equal(presentationShell.canRequestEdit(), shell === 'modern', String(shell));
        delete compactMain.isEditRequestWaiting;
        assert.equal(presentationShell.canRequestEdit(), false);
    }
});

/* ---- Raised edit right in a view session ------------------------------------------------------------------ */

check('test_view_session_lifts_can_edit_in_three_editors', () => {
    for (const type of TYPES)
        for (const shell of SHELLS) {
            const r = run(type, VIEW_SESSION(shell));
            assert.equal(r.seen.final.canEdit, true, type + ' ' + shell + ': canEdit is raised (canEdit=' + r.seen.final.canEdit + ')');
            assert.equal(r.seen.final.canRequestEditRights, true, type + ' ' + shell + ': canRequestEditRights stays');
        }
});

check('test_lift_differs_from_session_without_shell_only_in_can_edit', () => {
    for (const type of TYPES)
        for (const shell of SHELLS) {
            const label = type + ' ' + shell;
            const lifted = run(type, VIEW_SESSION(shell)), stock = run(type, WITHOUT_SHELL());
            assert.equal(stock.seen.final.canEdit, false, label + ': without ui.shell canEdit is false');
            assert.deepEqual(changedKeys(lifted.seen.final, stock.seen.final), ['canEdit'],
                label + ': only canEdit differs from the session without ui.shell (canEdit=' + lifted.seen.final.canEdit + ')');
            assert.equal(lifted.seen.final.canEdit, true, label + ': canEdit is true');
        }
});

check('test_lift_is_visible_when_views_receive_options', () => {
    for (const type of TYPES)
        for (const shell of SHELLS) {
            const r = run(type, VIEW_SESSION(shell));
            assert.ok(r.seen.face, type + ' ' + shell + ': a view session reaches app:face');
            for (const [point, options] of allOptions(r))
                assert.equal(options.canEdit, true, type + ' ' + shell + ': canEdit is raised at ' + point + ' (canEdit=' + options.canEdit + ')');
        }
});

check('test_docx_mail_merge_email_and_styles_stay_false', () => {
    for (const shell of SHELLS) {
        const r = run('docx', VIEW_SESSION(shell));
        assert.equal(r.seen.final.canEdit, true, shell + ': canEdit is raised (canEdit=' + r.seen.final.canEdit + ')');
        for (const [point, options] of allOptions(r))
            for (const key of ['canUseMailMerge', 'canSendEmailAddresses', 'canEditStyles'])
                assert.equal(options[key], false, shell + ': ' + key + ' at ' + point);
    }
});

check('test_is_edit_stays_false_in_three_editors', () => {
    for (const type of TYPES)
        for (const shell of SHELLS) {
            const r = run(type, VIEW_SESSION(shell));
            assert.equal(r.seen.final.canEdit, true, type + ' ' + shell + ': canEdit is raised (canEdit=' + r.seen.final.canEdit + ')');
            for (const [point, options] of allOptions(r)) {
                assert.equal(options.isEdit, false, type + ' ' + shell + ': isEdit at ' + point);
                assert.equal(options.twoLevelHeader, false, type + ' ' + shell + ': twoLevelHeader at ' + point);
            }
        }
});

/* The stubs do not hide the derived options: with edit=true they come out true. */
check('test_control_stock_request_session_keeps_derived_flags', () => {
    const view = run('docx', WITHOUT_SHELL({edit: true, review: true}));
    for (const key of ['canEdit', 'canUseMailMerge', 'canSendEmailAddresses', 'canEditStyles'])
        assert.equal(view.seen.final[key], true, 'docx view with edit=true: ' + key);
    assert.equal(view.seen.final.isEdit, false, 'docx view with edit=true: isEdit');
    for (const type of TYPES) {
        assert.equal(run(type, WITHOUT_SHELL({edit: true})).seen.final.canEdit, true, type + ' view with edit=true: canEdit');
        const edit = run(type, WITHOUT_SHELL({edit: true, review: true, mode: 'edit'})).seen.final;
        assert.equal(edit.isEdit, true, type + ' edit mode: isEdit');
        assert.equal(edit.twoLevelHeader, true, type + ' edit mode: twoLevelHeader');
        if (type === 'docx')
            for (const key of ['canUseMailMerge', 'canSendEmailAddresses', 'canEditStyles'])
                assert.equal(edit[key], true, 'docx edit mode: ' + key);
    }
});

/* ---- Stock integrations ----------------------------------------------------------------------------------- */

const NO_HANDLER = [false, undefined];

check('test_no_lift_without_edit_request_handler', () => {
    for (const type of TYPES)
        for (const handler of NO_HANDLER)
            for (const shell of SHELLS) {
                const label = type + ' handler=' + handler + ' ' + shell;
                const r = run(type, session({config: withShell(shell, {canRequestEditRights: handler})}));
                const stock = run(type, session({config: {ui: undefined, canRequestEditRights: handler}}));
                assert.equal(r.seen.final.canEdit, false, label + ': canEdit');
                sameOptions(type, r, stock, label);
                assert.deepEqual(entries(type, r), noEntries(type, r), label + ': no edit entry');
            }
});

check('test_no_lift_without_ui_shell', () => {
    for (const type of TYPES) {
        const stock = run(type, WITHOUT_SHELL());
        for (const ui of [undefined, {}, {mode: 'compact'}, {shell: undefined}]) {
            const label = type + ' ui=' + JSON.stringify(ui);
            const r = run(type, session({config: {ui}}));
            assert.equal(r.seen.final.canEdit, false, label + ': canEdit');
            sameOptions(type, r, stock, label);
            assert.deepEqual(entries(type, r), noEntries(type, r), label + ': no edit entry');
        }
    }
});

check('test_no_lift_with_empty_or_non_string_ui_shell', () => {
    for (const type of TYPES) {
        const stock = run(type, WITHOUT_SHELL());
        for (const shell of NOT_A_SHELL) {
            const label = type + ' ui.shell=' + JSON.stringify(shell);
            const r = run(type, VIEW_SESSION(shell));
            assert.equal(r.seen.final.canEdit, false, label + ': canEdit');
            sameOptions(type, r, stock, label);
            assert.deepEqual(entries(type, r), noEntries(type, r), label + ': no edit entry');
        }
    }
});

/* Opened for editing: with edit rights, and with mode='edit' but no edit rights, where canEdit is false. */
check('test_no_lift_in_edit_mode', () => {
    for (const type of TYPES)
        for (const rights of [{edit: true, review: true}, {edit: false, review: false}])
            for (const shell of SHELLS) {
                const label = type + ' mode=edit edit=' + rights.edit + ' ' + shell;
                const r = run(type, session(Object.assign({mode: 'edit', config: withShell(shell)}, rights)));
                const stock = run(type, session(Object.assign({mode: 'edit', config: {ui: undefined}}, rights)));
                assert.equal(r.seen.final.canEdit, rights.edit, label + ': canEdit');
                sameOptions(type, r, stock, label);
                assert.deepEqual(entries(type, r), noEntries(type, r), label + ': no edit entry');
            }
});

/* ---- Entries of the view session -------------------------------------------------------------------------- */

check('test_docx_compact_menu_offers_edit_document_in_view_session', () => {
    const r = run('docx', VIEW_SESSION('modern'));
    assert.equal(compactShell.wanted(r.editorConfig), true, 'ui.shell=modern turns the compact shell on');
    assert.equal(compactOffersEdit(r), true, 'the compact menu has "' + actions.textEditDoc + '" (canEdit=' + r.seen.final.canEdit + ')');
});

check('test_docx_header_offers_edit_button_in_view_session', () => {
    const r = run('docx', VIEW_SESSION(STOCK_SHELL));
    assert.equal(compactShell.wanted(r.editorConfig), false, 'ui.shell=' + STOCK_SHELL + ' keeps the stock interface');
    assert.ok(r.seen.face, 'the header gets its options on app:face');
    assert.equal(headerOffersEdit(r.seen.face), true, 'the header has the edit button (canEdit=' + r.seen.face.canEdit + ')');
});

check('test_sheet_and_slide_headers_offer_edit_button_in_view_session', () => {
    for (const type of ['xlsx', 'pptx'])
        for (const shell of SHELLS) {
            const r = run(type, VIEW_SESSION(shell));
            assert.ok(r.seen.face, type + ' ' + shell + ': the header gets its options on app:face');
            assert.equal(headerOffersEdit(r.seen.face), true,
                type + ' ' + shell + ': the header has the edit button (canEdit=' + r.seen.face.canEdit + ')');
        }
});

check('test_xlsx_compact_header_follows_can_request_edit', () => {
    for (const shell of SHELLS) {
        const r = run('xlsx', VIEW_SESSION(shell));
        assert.equal(entries('xlsx', r).sheetHeader, true,
            'xlsx ' + shell + ': the compact header offers Edit when the session can request editing');
    }
    const editor = run('xlsx', session({mode: 'edit', edit: true, review: true, config: withShell('modern')}));
    assert.equal(entries('xlsx', editor).sheetHeader, false, 'an editing session has no extra header Edit button');
    const plain = run('xlsx', session({config: withShell('modern', {canRequestEditRights: false})}));
    assert.equal(entries('xlsx', plain).sheetHeader, false, 'without the request right the compact header has no Edit button');
});

check('test_file_menus_offer_edit_item_in_view_session', () => {
    const cases = [['docx', STOCK_SHELL], ['xlsx', STOCK_SHELL], ['xlsx', 'modern'], ['pptx', STOCK_SHELL], ['pptx', 'modern']];
    for (const [type, shell] of cases) {
        const r = run(type, VIEW_SESSION(shell));
        const options = fileMenuOptions(type, r);
        assert.equal(fileMenuOffersEdit(type, options), true,
            type + ' ' + shell + ': the "File" menu has the edit item (canEdit=' + options.canEdit + ')');
    }
});

check('test_view_session_with_edit_entry_keeps_signed_permissions_and_mode', () => {
    for (const type of TYPES)
        for (const shell of SHELLS) {
            const label = type + ' ' + shell;
            const input = VIEW_SESSION(shell);
            const r = run(type, input);
            const offered = entries(type, r);
            assert.ok(Object.values(offered).some(Boolean),
                label + ': the session offers an edit entry (canEdit=' + r.seen.final.canEdit + ', ' + JSON.stringify(offered) + ')');
            assert.deepEqual(r.permissions, input.permissions, label + ': permissions are not changed');
            assert.equal(r.permissions.edit, false, label + ': permissions.edit');
            assert.equal(r.permissions.review, false, label + ': permissions.review');
            assert.deepEqual(r.editorConfig, input.editorConfig, label + ': editorConfig is not changed');
            assert.equal(r.editorConfig.mode, 'view', label + ': editorConfig.mode');
        }
});

check('test_view_session_with_edit_entry_changes_nothing_but_the_entry', () => {
    for (const type of TYPES)
        for (const shell of SHELLS) {
            const label = type + ' ' + shell;
            const lifted = run(type, VIEW_SESSION(shell)), stock = run(type, WITHOUT_SHELL());
            for (const [point, options] of allOptions(lifted)) {
                const other = point === 'app:face' ? stock.seen.face : point === 'end' ? stock.seen.final : stock.seen.common;
                assert.deepEqual(changedKeys(options, other), ['canEdit'],
                    label + ': at ' + point + ' only canEdit differs from the session without ui.shell (canEdit=' + options.canEdit + ')');
                assert.equal(options.canEdit, true, label + ': canEdit at ' + point);
                assert.equal(options.isEdit, false, label + ': isEdit at ' + point);
                if (type === 'docx')
                    for (const key of ['canUseMailMerge', 'canSendEmailAddresses', 'canEditStyles'])
                        assert.equal(options[key], false, label + ': ' + key + ' at ' + point);
            }
            if (type === 'docx') {
                /* Besides the edit item, the compact menu of a user with the edit right opened for viewing keeps
                   every item of the plain view session in its order, and the items it adds for the edit right
                   are greyed with the view reason: nothing more can be done in the session. The one exception is
                   AutoCorrect: its rules belong to the user's browser, not to the document, and only the lost
                   connection greys it. */
                const own = withoutEditItem(compactMenu(lifted)), plainView = withoutEditItem(compactMenu(stock));
                const rows = compactRows(lifted);
                const userSettings = [actions.textMenuAutoCorrect];
                own.forEach((group, i) => {
                    const items = group.items.filter(t => t !== '-');
                    const base = plainView[i].items.filter(t => t !== '-');
                    assert.deepEqual(items.filter(t => base.includes(t)), base, label + ': ' + group.label + ' keeps the view items');
                    for (const row of rows[i].rows.filter(row => row.kind !== 'sep' && !base.includes(row.label) &&
                        row.label !== actions.textEditDoc))
                        assert.deepEqual([row.label, row.disabled, row.reason],
                            userSettings.includes(row.label) ? [row.label, false, null] : [row.label, true, 'view'],
                            label + ': ' + group.label + ' adds only greyed items');
                });
                assert.ok(rows.some(group => group.rows.some(row => row.label === actions.textMenuAutoCorrect)),
                    label + ': AutoCorrect is offered to the user with the edit right');
            }
        }
    /* Control: with edit=true the same stubs give true derived options, so the false ones above are not masked. */
    const control = run('docx', WITHOUT_SHELL({edit: true, review: true})).seen.final;
    for (const key of ['canEdit', 'canUseMailMerge', 'canSendEmailAddresses', 'canEditStyles'])
        assert.equal(control[key], true, 'docx control with edit=true: ' + key);
    for (const type of TYPES)
        assert.equal(run(type, WITHOUT_SHELL({edit: true, mode: 'edit'})).seen.final.isEdit, true, type + ' control in edit mode: isEdit');
});

check('test_stock_integrations_without_handler_or_ui_shell_offer_no_edit_entry', () => {
    for (const type of TYPES) {
        const cases = [];
        for (const handler of NO_HANDLER)
            for (const shell of SHELLS)
                cases.push(['handler=' + handler + ' ' + shell, session({config: withShell(shell, {canRequestEditRights: handler})}),
                    session({config: {ui: undefined, canRequestEditRights: handler}})]);
        for (const ui of [undefined, {}, {mode: 'compact'}])
            cases.push(['ui=' + JSON.stringify(ui), session({config: {ui}}), WITHOUT_SHELL()]);
        for (const shell of NOT_A_SHELL)
            cases.push(['ui.shell=' + JSON.stringify(shell), VIEW_SESSION(shell), WITHOUT_SHELL()]);
        for (const [name, input, baseline] of cases) {
            const label = type + ' ' + name;
            const r = run(type, input);
            sameOptions(type, r, run(type, baseline), label);
            assert.deepEqual(entries(type, r), noEntries(type, r), label + ': no edit entry');
        }
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
