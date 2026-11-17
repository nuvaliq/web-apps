/* Run: node test/unit-tests/documenteditor/compact-shell-gate.cjs
 * The compact shell gate and early start:
 * enabling strictly by editorConfig.ui.shell === 'modern', the vo-boot claim class
 * with Gateway init, the scaffold on app:face, starting with retries and fail-safe, the default for rulers.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const VIEW = path.resolve(__dirname, '../../../apps/documenteditor/main/app/view');

let main = null, viewport = null, shellNode = null, maskNode = null;
const classes = new Set();
const handlers = {};
const timers = [];
const store = {};
const DE = {
    Views: {},
    getController(name) {
        if (name === 'Main') return main;
        if (name === 'Viewport') return viewport;
        return null;
    }
};
const jq = () => {
    const chain = new Proxy({length: 0}, {get: (t, k) => (k in t ? t[k] : () => chain)});
    return chain;
};
const context = {
    window: {DE},
    DE,
    document: {
        body: {classList: {
            add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
            toggle: (c, on) => ((on === undefined ? !classes.has(c) : on) ? classes.add(c) : classes.delete(c))
        }},
        getElementById: id => (id === 'vo-shell' ? shellNode : maskNode && maskNode.id === id ? maskNode : null)
    },
    $: jq,
    setTimeout: f => timers.push(f),
    clearTimeout: () => {},
    console: {warn: () => {}, log: console.log},
    _: {extend: Object.assign},
    Common: {
        NotificationCenter: {on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); }, trigger: () => {}},
        localStorage: {itemExists: k => k in store, getBool: k => !!store[k]}
    },
    define: (dependencies, factory) => factory({})
};
vm.createContext(context);
for (const name of ['DocumentActions', 'CompactShell']) {
    const file = path.join(VIEW, name + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
}
const shell = DE.Views.CompactShell;
const da = DE.Views.DocumentActions;

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

let tb, st, layouts;
const panel = h => ({height: h, writes: [], el: {css(k, v) { this.owner.writes.push(v); }}});
function fresh(cfg, appOptions = {isEdit: true, customization: {}}) {
    classes.clear();
    for (const k of Object.keys(handlers)) delete handlers[k];
    timers.length = 0;
    shellNode = null;
    maskNode = null;
    shell.boot = null; shell.booted = false; shell.startupFailed = false;
    main = {editorConfig: cfg, appOptions};
    tb = panel(112); tb.el.owner = tb;
    st = panel(25); st.el.owner = st;
    layouts = 0;
    viewport = {viewport: {
        vlayout: {getItem: a => (a === 'toolbar' ? tb : a === 'statusbar' ? st : null), doLayout: () => { layouts++; }},
        hlayout: {doLayout: () => {}}
    }, api: {Resize: () => {}}};
}
function face(opts = {isEdit: true}) { (handlers['app:face'] || []).forEach(f => f(opts)); }
function drain() { let n = 0; while (timers.length && n < 100) { timers.shift()(); n++; } }
function run(create) {
    let calls = 0;
    shell.create = function () { calls++; return create.call(this, calls); };
    shell.start();
    drain();
    return calls;
}

const SHELL = {ui: {shell: 'modern'}};

check('gate: ui.shell = modern enables, ui.mode alone does not', () => {
    fresh(SHELL); assert.equal(shell.wanted(), true);
    fresh({ui: {shell: 'modern', mode: 'compact'}}); assert.equal(shell.wanted(), true);
    fresh({ui: {mode: 'compact'}}); assert.equal(shell.wanted(), false);
    fresh({}); assert.equal(shell.wanted(), false);
    fresh(undefined); assert.equal(shell.wanted(), false);
});
check('gate: foreign values keep the stock editor', () => {
    for (const v of ['Modern', 'MODERN', 'modern ', ' modern', 'compact', '', null, true, 1, {}]) {
        fresh({ui: {shell: v}});
        assert.equal(shell.wanted(), false, JSON.stringify(v));
    }
    fresh({get ui() { throw new Error('boom'); }});
    assert.equal(shell.wanted(), false);
});
check('gate: explicit init config is read before Main has it', () => {
    fresh({});
    assert.equal(shell.wanted(SHELL), true);
    assert.equal(shell.wanted({ui: {mode: 'compact'}}), false);
});
check('announce: request class only for ui.shell, one subscription', () => {
    fresh({});
    shell.announce({ui: {mode: 'compact'}});
    assert.equal(classes.has('vo-boot'), false);
    shell.announce(SHELL);
    shell.announce(SHELL);
    assert.equal(classes.has('vo-boot'), true);
    assert.equal((handlers['app:face'] || []).length, 1);
});
/* The loading skeleton from index.html: the #loading-mask node the stock code removes by id. */
function mask() {
    const node = {id: 'loading-mask', removed: false};
    node.parentNode = {removeChild: n => { n.removed = true; if (maskNode === n) maskNode = null; }};
    return node;
}
check('loading skeleton: kept from the stock under another id until endBoot', () => {
    fresh({ui: {mode: 'compact'}});
    const stock = maskNode = mask();
    shell.announce({ui: {mode: 'compact'}});
    assert.equal(stock.id, 'loading-mask', 'without the shell the stock removes it as before');

    fresh(SHELL);
    const held = maskNode = mask();
    shell.announce(SHELL);
    assert.equal(held.id, 'vo-loading');
    assert.equal(context.document.getElementById('loading-mask'), null, 'the stock lookup misses it');
    face();
    assert.equal(held.removed, false, 'app:face does not take it');
    shell.endBoot(false);
    assert.equal(held.removed, true, 'the hand-over frame takes it');

    fresh(SHELL);
    const failed = maskNode = mask();
    shell.announce(SHELL);
    shell.endBoot(true);
    assert.equal(failed.removed, true, 'the fail-safe takes it too');

    fresh(SHELL);
    shell.announce(SHELL);
    assert.doesNotThrow(() => shell.endBoot(true), 'no skeleton on the page');
});
/* An opening error arrives before app:ready, and no app:ready follows it: the error
   itself has to remove the skeleton and the claim, otherwise the stock window hangs
   over the skeleton and the loading band keeps running after OK. */
check('loading skeleton: an opening error before the shell takes it and the request', () => {
    const errors = [];
    const fire = (...args) => errors.forEach(f => f(...args));
    const session = () => {
        fresh(SHELL);
        errors.length = 0;
        viewport.api.asc_registerCallback = (name, fn) => { if (name === 'asc_onError') errors.push(fn); };
        const node = maskNode = mask();
        shell.announce(SHELL);
        return node;
    };

    const late = session();
    face();
    assert.equal(errors.length, 1, 'one error subscription per session');
    assert.notEqual(tb.height, 112, 'the skeleton heights are on');
    fire(-4, 2);
    assert.equal(late.removed, true, 'the skeleton does not stay under the error window');
    assert.equal(classes.has('vo-boot'), false, 'the stock interface is back under the window');
    assert.equal(tb.height, 112, 'stock heights are back');
    assert.equal(st.height, 25);
    assert.doesNotThrow(() => fire(-4, 2), 'a second error is harmless');

    const early = session();
    fire(-4, 2);
    assert.equal(early.removed, true, 'an error before app:face takes it too');
    assert.equal(classes.has('vo-boot'), false);
    face();
    assert.equal(tb.height, 112, 'a late app:face does not lay out the skeleton again');
    const saved = shell.create;
    try {
        assert.equal(run(() => { shellNode = {}; }), 1, 'a load that still reaches app:ready gets the shell');
    } finally {
        shell.create = saved;
    }

    session();
    face();
    shell.endBoot(false);
    classes.add('vo-compact');
    const before = layouts;
    fire(-4, 2);
    assert.equal(classes.has('vo-compact'), true, 'after the shell is built errors are the stock business');
    assert.equal(layouts, before, 'and they do not re-lay the shell');

    fresh(SHELL);
    viewport.api = {Resize: () => {}};
    assert.doesNotThrow(() => shell.announce(SHELL), 'an engine without callbacks');
    assert.equal(classes.has('vo-boot'), true);
});

check('skeleton: shell heights on app:face, stock heights back on endBoot(true)', () => {
    fresh(SHELL);
    shell.announce(SHELL);
    face();
    assert.deepEqual([tb.height, st.height], [80, 0]);
    assert.ok(layouts > 0);
    shell.endBoot(true);
    assert.equal(classes.has('vo-boot'), false);
    assert.deepEqual([tb.height, st.height], [112, 25]);
    assert.equal(tb.writes.at(-1), '112px');
});
check('skeleton: read-only document gets header + menu (76)', () => {
    fresh(SHELL, {isEdit: false, customization: {}});
    shell.announce(SHELL);
    face({isEdit: false});
    assert.equal(tb.height, 76);
});
check('skeleton: fresher stock height is not overwritten', () => {
    fresh(SHELL);
    shell.announce(SHELL);
    face();
    tb.height = 116;
    shell.endBoot(true);
    assert.equal(tb.height, 116);
    assert.equal(st.height, 25);
});
check('hand-over: endBoot(false) restores the model only, DOM untouched', () => {
    fresh(SHELL);
    shell.announce(SHELL);
    face();
    tb.writes.length = 0; st.writes.length = 0;
    shell.endBoot(false);
    assert.deepEqual([tb.height, st.height], [112, 25]);
    assert.deepEqual([tb.writes, st.writes], [[], []]);
    assert.equal(classes.has('vo-boot'), false);
});
check('start: no ui.shell — create() never called, no request class', () => {
    fresh({ui: {mode: 'compact'}});
    assert.equal(run(() => shell), 0);
    assert.equal(classes.has('vo-boot'), false);
});
check('start: 20 attempts, then stock layout is back', () => {
    fresh(SHELL);
    shell.announce(SHELL);
    face();
    assert.equal(run(() => shell), 20);
    assert.equal(classes.has('vo-boot'), false);
    assert.deepEqual([tb.height, st.height], [112, 25]);
});
check('start: create() failure is contained, not retried, stock is back', () => {
    fresh(SHELL);
    shell.announce(SHELL);
    face();
    assert.equal(run(() => { throw new Error('create failed'); }), 1);
    assert.equal(classes.has('vo-boot'), false);
    assert.deepEqual([tb.height, st.height], [112, 25]);
});
check('start: failure after hand-over re-lays the stock layout', () => {
    fresh(SHELL);
    shell.announce(SHELL);
    face();
    const before = layouts;
    assert.equal(run(function () { this.endBoot(false); throw new Error('snapshot failed'); }), 1);
    assert.ok(layouts > before);
    assert.deepEqual([tb.height, st.height], [112, 25]);
});
check('start: success on the third attempt', () => {
    fresh(SHELL);
    shell.announce(SHELL);
    face();
    const calls = run(function (n) {
        if (n < 3) return shell;
        this.endBoot(false); shellNode = {}; return shell;
    });
    assert.equal(calls, 3);
    assert.equal(classes.has('vo-boot'), false);
});
check('rulers: restoring a mode uses the current document, not a previous saved choice', () => {
    for (const k of Object.keys(store)) delete store[k];
    da.api = {asc_GetViewRulers: () => false};
    assert.equal(da.rulersWanted(false), false);
    store['de-hidden-rulers'] = false;
    assert.equal(da.rulersWanted(false), false);
    assert.equal(da.rulersWanted(true), false);
    da.api.asc_GetViewRulers = () => true;
    store['de-hidden-rulers'] = true;
    assert.equal(da.rulersWanted(false), true);
    assert.equal(da.rulersWanted(true), true);
    da.api = {};
    da.rulers = false;
    assert.equal(da.rulersWanted(false), false);
    da.rulers = true;
    assert.equal(da.rulersWanted(false), true);
    da.api = null;
});

/* The "Rename" and "Edit" items of the shell file menu go through the
   stock LeftMenu.clickMenuFileItem. We take its real text from the controller:
   after the action it calls hide() on the passed menu, and a string instead of a menu failed the
   click with an exception (changesError on DS, editor reload). */
function stockClickMenuFileItem(calls) {
    const src = fs.readFileSync(path.resolve(VIEW, '../controller/LeftMenu.js'), 'utf8');
    const head = 'clickMenuFileItem: function(menu, action, isopts) {';
    const start = src.indexOf(head);
    assert.ok(start >= 0, 'clickMenuFileItem not found in LeftMenu.js');
    let depth = 0, end = start + head.length - 1;
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    const body = src.slice(start + 'clickMenuFileItem: '.length, end + 1);
    const sandbox = {
        _: {isEmpty: v => !v},
        Common: {
            Views: {RenameDialog: function (o) { calls.push('dialog:' + o.filename); this.show = () => calls.push('show'); }},
            Gateway: {requestRename: v => calls.push('rename:' + v), requestEditRights: () => calls.push('edit-rights')},
            NotificationCenter: {trigger: () => {}}
        }
    };
    vm.createContext(sandbox);
    return vm.runInContext('(' + body + ')', sandbox);
}
check('file menu: rename and edit reach the stock handler without throwing', () => {
    const calls = [];
    const click = stockClickMenuFileItem(calls);
    const lm = {
        api: {asc_getDocumentName: () => 'Doc.docx'},
        mode: {},
        requestEditRightsText: 'Requested',
        getApplication: () => ({getController: () => ({setStatusCaption: t => calls.push('caption:' + t)})}),
        clickMenuFileItem(menu, action, isopts) { return click.call(this, menu, action, isopts); }
    };
    const saved = main;
    main = null;
    const getController = DE.getController;
    DE.getController = name => (name === 'LeftMenu' ? lm : getController(name));
    try {
        assert.doesNotThrow(() => da.rename());
        assert.doesNotThrow(() => da.requestEditRights());
    } finally {
        DE.getController = getController;
        main = saved;
    }
    assert.deepEqual(calls, ['dialog:Doc.docx', 'show', 'caption:Requested', 'edit-rights']);
});

/* A rename via the host reaches the engine by the meta command (asc_onMeta), not by
   asc_onDocumentName: the name field in the shell header must update on both. */
check('title: host rename via meta updates the shell title', () => {
    const callbacks = {};
    let value = 'Old';
    const input = {ownerDocument: {activeElement: null}};
    const saved = {api: shell.api, $title: shell.$title, titleWas: shell.titleWas, fitTitle: shell.fitTitle};
    shell.api = {asc_registerCallback: (name, fn) => { callbacks[name] = fn; }};
    shell.$title = {0: input, val: v => (v === undefined ? value : (value = v))};
    shell.titleWas = 'Old';
    shell.fitTitle = () => {};
    try {
        shell.watchRename();
        assert.equal(typeof callbacks.asc_onMeta, 'function');
        callbacks.asc_onMeta({title: 'Renamed.docx'});
        assert.equal(value, 'Renamed');
        assert.equal(shell.titleWas, 'Renamed');
        callbacks.asc_onMeta({});
        assert.equal(value, 'Renamed');
        callbacks.asc_onDocumentName('Again.docx');
        assert.equal(value, 'Again');
    } finally {
        Object.assign(shell, saved);
    }
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
