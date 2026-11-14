/* Run: node test/unit-tests/documenteditor/compact-menu-edit.cjs [<sdkjs dir>]
 * Edit section of the compact menu of the document editor (DocumentActions.sections): undo and
 * redo follow what the engine can undo, cut and copy need a selection, paste shows its shortcut
 * hint only when nothing was pasted, find goes to the stock search panel and autocorrect opens the
 * stock window.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs. The paste
 * checks run the clipboard code of sdkjs itself (common/clipboard_base.js): sdkjs is taken from the
 * argument, then SDKJS_DIR, then ../sdkjs next to web-apps; without it those checks are skipped.
 * The paste call of the engine is word/api.js Paste: no document or a busy clipboard — false
 * without a try, otherwise the result of Button_Paste.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const docs = require('../common/compact/lib/documents-editor.cjs');

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const actions = G.DE.Views.DocumentActions;
const command = k => actions.command(k);
const plain = value => JSON.parse(JSON.stringify(value));

let passed = 0, failed = 0, skipped = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}
function skip(name, why) {
    console.log('SKIP', name, '—', why);
    skipped++;
}

const state = (k, ctx) => Model.state(command(k), ctx);
const calls = (ctx, name) => ctx.log.filter(e => e.api === name).map(e => e.args);

/* --- The clipboard of the engine ------------------------------------------------------------- */

function sdkjsDir() {
    const explicit = process.argv[2] || process.env.SDKJS_DIR;
    if (explicit) return explicit;
    const sibling = path.join(ROOT, '../sdkjs');
    return fs.existsSync(path.join(sibling, 'common/clipboard_base.js')) ? sibling : null;
}

/* sdkjs clipboard loaded into the editor context once; each paste check sets up its own state. */
let clipboardLoaded = null;
function loadClipboard() {
    if (clipboardLoaded !== null) return clipboardLoaded;
    const dir = sdkjsDir();
    if (!dir) return (clipboardLoaded = false);
    const file = path.join(dir, 'common/clipboard_base.js');
    G.AscCommon = G.AscCommon || {};
    G.AscCommon.AscBrowser = G.AscCommon.AscBrowser || {};
    G.navigator = G.navigator || {};
    G.document = G.document || {};
    /* The special paste helper of the same file wants the options class of its button. */
    G.Asc.SpecialPasteShowOptions = G.Asc.SpecialPasteShowOptions || function () {};
    vm.runInContext(fs.readFileSync(file, 'utf8'), G, {filename: file});
    return (clipboardLoaded = true);
}

/* An editor where the browser answers execCommand('paste') with `browser`, the engine buffer holds
   what was copied in it (`buffer`), the clipboard is busy or not, and the engine pastes or refuses
   by a lock. The hint place of the menu bar, the timers and the platform are the test's own. */
function pasteWorld({browser = false, buffer = null, busy = false, lock = false, mac = false} = {}) {
    const cb = G.AscCommon.g_clipboardBase;
    const out = {exec: 0, pasted: [], refused: 0, timers: []};
    G.document.execCommand = name => { if (name === 'paste') out.exec++; return browser; };
    G.document.queryCommandSupported = () => true;
    cb.inputContext = null;
    cb.CopyFlag = false;
    cb.PasteFlag = busy;
    cb.LastCopyBinary = buffer;
    cb.Api = {
        asc_enableKeyEvents() {},
        asc_PasteData(format, data) {
            if (lock) { out.refused++; return; }
            out.pasted.push({format, data});
        }
    };
    const ctx = docs.context({
        engine: {
            /* word/api.js Paste */
            Paste: () => (cb.IsWorking() ? false : cb.Button_Paste())
        }
    });
    out.status = {textContent: ''};
    ctx.shell.menu = {status: () => out.status};
    G.Common.Utils.isMac = mac;
    out.ctx = ctx;
    return out;
}

/* Runs the paste item with the timers of the hint caught. */
function paste(world) {
    const saved = {set: G.setTimeout, clear: G.clearTimeout};
    G.setTimeout = (fn, ms) => { world.timers.push({fn, ms}); return world.timers.length; };
    G.clearTimeout = () => {};
    try {
        const ran = docs.adapter(world.ctx).exec(command('edit.paste'));
        assert.equal(ran, true, 'the paste item runs');
    } finally {
        G.setTimeout = saved.set;
        G.clearTimeout = saved.clear;
    }
    return world;
}

const INTERNAL = 4, TEXT = 1;
const COPIED = [{type: INTERNAL, data: 'internal binary'}, {type: TEXT, data: 'plain'}];

function pasteCheck(name, fn) {
    if (!loadClipboard()) {
        skip(name, 'sdkjs not found next to web-apps (pass its path or set SDKJS_DIR)');
        return;
    }
    check(name, fn);
}

/* --- Checks ---------------------------------------------------------------------------------- */

check('undo is greyed without a reason when nothing to undo', () => {
    for (const [k, flag] of [['edit.undo', 'undo'], ['edit.redo', 'redo']]) {
        const none = state(k, docs.context({[flag]: false}));
        assert.equal(none.disabled, true, k + ': nothing to do');
        assert.equal(none.reason, null, k + ': no reason of the item');
        assert.equal(state(k, docs.context({[flag]: true})).disabled, false, k + ': something to do');
        /* A common reason still shows over it. */
        assert.equal(state(k, docs.context({[flag]: false, reasons: ['view']})).reason, 'view', k);
    }
    /* The state is asked at the snapshot: undo becomes possible without a new menu. */
    const ctx = docs.context({undo: false});
    assert.equal(state('edit.undo', ctx).disabled, true);
    ctx.undo = true;
    assert.equal(state('edit.undo', ctx).disabled, false);
});

check('cut and copy are greyed with the no-text-selected reason', () => {
    const ctx = docs.context({selection: false});
    for (const k of ['edit.cut', 'edit.copy']) {
        const st = state(k, ctx);
        assert.equal(st.disabled, true, k);
        assert.equal(st.reason, 'noSelection', k);
    }
    assert.equal(docs.reasonText('noSelection'), 'No text selected');
    const selected = docs.context({selection: true});
    for (const k of ['edit.cut', 'edit.copy']) assert.equal(state(k, selected).disabled, false, k);
    /* Both go to the engine clipboard commands. */
    command('edit.cut').run();
    command('edit.copy').run();
    assert.deepEqual(plain(selected.log.filter(e => e.api === 'Cut' || e.api === 'Copy').map(e => e.api)), ['Cut', 'Copy']);
    /* Copy is for anyone who reads the document: no edit reason greys it. */
    const viewer = docs.context({rights: 'view', reasons: ['view'], selection: true});
    assert.equal(state('edit.copy', viewer).disabled, false, 'a viewer copies');
    assert.equal(state('edit.copy', docs.context({rights: 'view', selection: false})).reason, 'noSelection');
});

check('cut carries the edit reason in view', () => {
    const view = docs.context({reasons: ['view'], selection: true});
    assert.equal(state('edit.cut', view).reason, 'view');
    /* The common reason is the senior one, also without a selection. */
    assert.equal(state('edit.cut', docs.context({reasons: ['view'], selection: false})).reason, 'view');
    assert.equal(state('edit.cut', docs.context({reasons: ['protected'], selection: false})).reason, 'protected');
    assert.equal(state('edit.cut', docs.context({reasons: ['offline'], selection: true})).reason, 'offline');
    /* A user with the view right only has no cut and no paste at all. */
    const viewer = docs.context({rights: 'view'});
    for (const k of ['edit.cut', 'edit.paste']) assert.equal(state(k, viewer).visible, false, k);
    assert.equal(state('edit.paste', docs.context({reasons: ['form']})).reason, 'form', 'paste carries the edit reason');
});

pasteCheck('browser refusal without an internal buffer shows the shortcut hint', () => {
    const w = paste(pasteWorld({browser: false, buffer: null}));
    assert.equal(w.exec, 1, 'the browser was asked once');
    assert.deepEqual(w.pasted, [], 'nothing was pasted');
    assert.equal(w.status.textContent, 'Paste with Ctrl+V');
    /* The hint goes away by itself. */
    assert.equal(w.timers.length, 1);
    assert.equal(w.timers[0].ms, 5000);
    w.timers[0].fn();
    assert.equal(w.status.textContent, '');
    /* On a Mac the command key. */
    assert.equal(paste(pasteWorld({mac: true})).status.textContent, 'Paste with ⌘V');
    /* An empty engine buffer pastes nothing either. */
    assert.equal(paste(pasteWorld({buffer: []})).status.textContent, 'Paste with Ctrl+V');
});

pasteCheck('fallback paste from the internal buffer shows no hint', () => {
    const w = paste(pasteWorld({browser: false, buffer: COPIED.slice()}));
    assert.equal(w.exec, 1);
    assert.deepEqual(plain(w.pasted), [{format: INTERNAL, data: 'internal binary'}], 'the engine pasted its own copy');
    assert.equal(w.status.textContent, '', 'no hint');
    assert.equal(w.timers.length, 0);
});

pasteCheck('busy clipboard with a filled internal buffer shows no success message', () => {
    const w = paste(pasteWorld({busy: true, buffer: COPIED.slice()}));
    assert.equal(w.exec, 0, 'the engine does not try while the clipboard is busy');
    assert.deepEqual(w.pasted, [], 'and the item does not paste again to find out');
    assert.equal(w.status.textContent, '', 'neither a hint nor a pasted message');
    assert.equal(w.timers.length, 0);
    /* Busy without a buffer: the running operation pastes, no hint either. */
    assert.equal(paste(pasteWorld({busy: true})).status.textContent, '');
});

pasteCheck('successful browser paste shows no hint', () => {
    const w = paste(pasteWorld({browser: true, buffer: COPIED.slice()}));
    assert.equal(w.exec, 1);
    assert.deepEqual(w.pasted, [], 'the browser pasted, the engine buffer is not used');
    assert.equal(w.status.textContent, '');
    assert.equal(paste(pasteWorld({browser: true})).status.textContent, '', 'also with an empty engine buffer');
});

pasteCheck('engine lock refusal shows no paste hint', () => {
    const w = paste(pasteWorld({browser: false, buffer: COPIED.slice(), lock: true}));
    assert.equal(w.refused, 1, 'the engine refused by the lock');
    assert.deepEqual(w.pasted, []);
    assert.equal(w.status.textContent, '', 'the shortcut would not help: no hint');
});

check('viewer gets find without replace', () => {
    const viewer = docs.context({rights: 'view', reasons: ['view']});
    const st = state('edit.find', viewer);
    assert.equal(st.visible, true);
    assert.equal(st.disabled, false);
    /* The item goes to the stock search panel, where the replace field depends on the edit right. */
    const left = stockLeftMenu({isEdit: false});
    const getController = G.DE.getController;
    G.DE.getController = name => (name === 'LeftMenu' ? left.controller : getController(name));
    try {
        command('edit.find').run();
    } finally {
        G.DE.getController = getController;
    }
    assert.deepEqual(plain(viewer.log.filter(e => e.shell === 'ensureLeftPanel').map(e => e.args)), [['search']],
        'the shell reveals the search panel');
    assert.equal(left.modes.at(-1), 'no-replace', 'no replace field for a viewer');
    /* Control: an editor gets the replace field. */
    const editor = stockLeftMenu({isEdit: true});
    G.DE.getController = name => (name === 'LeftMenu' ? editor.controller : getController(name));
    try {
        docs.context();
        command('edit.find').run();
    } finally {
        G.DE.getController = getController;
    }
    assert.equal(editor.modes.at(-1), undefined);
});

check('autocorrect opens a dialog', () => {
    const opened = [];
    let visible = false;
    G.Common.Views = Object.assign(G.Common.Views || {}, {
        AutoCorrectDialog: function (options) {
            opened.push(options);
            this.show = () => { visible = true; };
            this.isVisible = () => visible;
        }
    });
    try {
        const ctx = docs.context();
        assert.equal(Model.kindOf(command('edit.autocorrect')), 'action');
        assert.equal(state('edit.autocorrect', ctx).disabled, false);
        assert.equal(docs.adapter(ctx).exec(command('edit.autocorrect')), true);
        assert.equal(opened.length, 1, 'the stock window is built');
        assert.equal(opened[0].api, ctx.api, 'with the editor api');
        assert.equal(visible, true, 'and shown');
        command('edit.autocorrect').run();
        assert.equal(opened.length, 1, 'an open window is not opened twice');
        visible = false;
        command('edit.autocorrect').run();
        assert.equal(opened.length, 2, 'a closed one opens again');
        /* Only the connection greys it; a viewer has no such item. */
        assert.equal(state('edit.autocorrect', docs.context({reasons: ['offline']})).reason, 'offline');
        assert.equal(state('edit.autocorrect', docs.context({reasons: ['view']})).disabled, false);
        assert.equal(state('edit.autocorrect', docs.context({rights: 'view'})).visible, false);
    } finally {
        delete G.Common.Views.AutoCorrectDialog;
    }
});

/* The stock LeftMenu controller (controller/LeftMenu.js) over a stand-in left menu: the search
   panel records the search modes it gets. */
function stockLeftMenu(mode) {
    const DE = {Controllers: {}, Views: {}};
    const Common = {NotificationCenter: {trigger() {}},
        UI: {Menu: {Manager: {hideAll() {}}}, LayoutManager: {isElementVisible: () => true}}};
    const $ = () => ({hasClass: () => false});
    const context = {DE, window: {DE}, Common, $, _: {extend: Object.assign},
        Backbone: {Controller: {extend: value => value}}, define: (deps, factory) => factory()};
    const file = path.join(ROOT, 'apps/documenteditor/main/app/controller/LeftMenu.js');
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
    let visible = false;
    const modes = [];
    const button = {isDisabled: () => false, isVisible: () => true, pressed: false};
    const panel = {inputText: {getValue: () => ''}, setFindText() {}, isVisible: () => visible,
        setSearchMode: m => modes.push(m), focus() {}};
    const viewport = {isSearchBarVisible: () => false, searchBar: {inputSearch: {val: () => ''}, hide() {}}};
    const controller = Object.assign({}, DE.Controllers.LeftMenu, {
        mode: mode, _state: {docProtection: {}}, api: {asc_GetSelectedText: () => ''},
        getApplication: () => ({getController: () => viewport}),
        tryToShowLeftMenu() {},
        leftMenu: {btnSearchBar: button, panelSearch: panel, menuFile: {isVisible: () => false},
            isButtonInMoreMenu: () => false,
            /* Pressing the stock button fires its toggle, bound to onMenuSearchBar (LeftMenu.js). */
            onBtnMenuClick(btn) { visible = true; btn.pressed = true; controller.onMenuSearchBar(btn, true); },
            showMenu() { visible = true; button.pressed = true; controller.onMenuSearchBar(button, true); },
            fireEvent() {}}
    });
    return {controller, modes};
}

console.log(`${passed} passed, ${failed} failed` + (skipped ? `, ${skipped} skipped` : ''));
process.exitCode = failed ? 1 : 0;
