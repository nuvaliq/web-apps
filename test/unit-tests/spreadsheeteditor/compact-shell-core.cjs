/* Run: node test/unit-tests/spreadsheeteditor/compact-shell-core.cjs [path to CompactShell.js]
 * The skeleton of the spreadsheet editor "Compact" shell: gate, start and rollback, layout, modes, the left
 * area, the header. The module is loaded in node via vm on top of a small fake DOM
 * and a fake stock (the Main/Toolbar/Viewport/LeftMenu controllers, the engine, notifications).
 * The optional argument is a broken copy of the module for the negative control:
 * a copy with wanted() always returning true and a copy without the rollback must fail their cases.
 * The gate is ui.shell; the detailed cases of the gate, the claim and the start cycle are in
 * compact-shell-gate.cjs, here is the skeleton hand-over by the real create().
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/spreadsheeteditor/main/app/view');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactShell.js');
const ICONS = path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js');

/* --- Fake DOM: exactly what the shell uses ------------------------------- */

function classList(el) {
    const list = [];
    const sync = () => { el.attrs.class = list.join(' '); };
    list.add = (...names) => { names.forEach(n => { if (!list.includes(n)) list.push(n); }); sync(); };
    list.remove = (...names) => { names.forEach(n => { const i = list.indexOf(n); if (i >= 0) list.splice(i, 1); }); sync(); };
    list.contains = n => list.includes(n);
    list.toggle = (n, force) => {
        const on = force === undefined ? !list.includes(n) : !!force;
        on ? list.add(n) : list.remove(n);
        return on;
    };
    return list;
}

class El {
    constructor(tag, doc) {
        this.tagName = String(tag).toUpperCase();
        this.ownerDocument = doc;
        this.children = [];
        this.parentNode = null;
        this.attrs = {};
        this.style = {};
        this.listeners = {};
        this.classList = classList(this);
        this._text = '';
        this._html = '';
    }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = String(v); }
    get className() { return this.attrs.class || ''; }
    set className(v) {
        this.classList.splice(0);
        String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.push(c));
        this.attrs.class = this.classList.join(' ');
    }
    setAttribute(k, v) { if (k === 'class') this.className = v; else if (k === 'id') this.id = v; else this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
    removeAttribute(k) { delete this.attrs[k]; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.children.slice().forEach(c => c.remove()); this._text = String(v); this._html = ''; }
    get innerHTML() { return this._html || this._text; }
    set innerHTML(v) { this.children.slice().forEach(c => c.remove()); this._html = String(v); this._text = ''; }
    get firstChild() { return this.children[0] || null; }
    get childElementCount() { return this.children.length; }
    appendChild(c) { c.remove(); c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) {
        c.remove();
        c.parentNode = this;
        const i = ref ? this.children.indexOf(ref) : -1;
        if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
        return c;
    }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { const a = this.listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    dispatch(t) {
        const ev = {type: t, target: this, preventDefault() {}, stopPropagation() {}};
        (this.listeners[t] || []).slice().forEach(fn => fn.call(this, ev));
    }
    click() { this.dispatch('click'); }
    descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
    querySelectorAll(sel) { return this.descendants().filter(e => matches(e, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

/* Selectors: '#id', '.cls', 'tag', '[id^="vo-"]', a descendant via a space, a list via commas. */
function matchSimple(el, s) {
    let m;
    if ((m = /^\[id\^="([^"]*)"\]$/.exec(s))) return el.id.indexOf(m[1]) === 0;
    if (s[0] === '#') return el.id === s.slice(1);
    if (s[0] === '.') return el.classList.contains(s.slice(1));
    return el.tagName === s.toUpperCase();
}
function matches(el, sel) {
    return sel.split(',').some(part => {
        const chain = part.trim().split(/\s+/);
        if (!matchSimple(el, chain[chain.length - 1])) return false;
        let node = el.parentNode;
        for (let i = chain.length - 2; i >= 0; i--) {
            while (node && !matchSimple(node, chain[i])) node = node.parentNode;
            if (!node) return false;
            node = node.parentNode;
        }
        return true;
    });
}

/* Visibility, focus, siblings and closest - for the shared menu row (lib/fake-dom.cjs). */
require(path.join(__dirname, 'lib/fake-dom.cjs')).patch(El, {matches, replaceClosest: true, capture: true});

function makeDocument() {
    const doc = {baseURI: 'http://ds.test/9.4.0-x/web-apps/apps/spreadsheeteditor/main/index.html'};
    doc.documentElement = new El('html', doc);
    doc.body = doc.documentElement.appendChild(new El('body', doc));
    doc.activeElement = doc.body;
    doc.createElement = tag => new El(tag, doc);
    doc.getElementById = id => doc.documentElement.descendants().find(e => e.id === id) || null;
    doc.querySelectorAll = sel => doc.documentElement.querySelectorAll(sel);
    doc.querySelector = sel => doc.documentElement.querySelector(sel);
    doc.listeners = {};
    doc.addEventListener = (t, fn) => { (doc.listeners[t] = doc.listeners[t] || []).push(fn); };
    doc.removeEventListener = () => {};
    return doc;
}

/* --- Fake stock ------------------------------------------------------------ */

function events() {
    const handlers = {};
    return {
        handlers,
        on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
        off(name, fn) { const a = handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        trigger(name, ...args) { (handlers[name] || []).slice().forEach(fn => fn.apply(null, args)); },
        count(name) { return (handlers[name] || []).length; }
    };
}

function layout(items) {
    return {
        panels: items,
        layouts: 0,
        getItem(alias) { return items.find(p => p.alias === alias); },
        doLayout() { this.layouts++; }
    };
}

function makeEnv(opt = {}) {
    const doc = makeDocument();
    const toolbarEl = doc.body.appendChild(new El('div', doc));
    toolbarEl.id = 'toolbar';
    if (opt.rendered !== false) {
        const ribbon = toolbarEl.appendChild(new El('section', doc));
        ribbon.className = 'toolbar';
        const right = ribbon.appendChild(new El('section', doc));
        right.id = 'box-right-btn-group';
    }

    const NC = events();
    const timers = [];
    const warnings = [];
    let modified = false;
    let modifiedThrows = false;

    /* An engine color (sdkjs CColor): the sheet settings hold it as an object, the standard one is 72,121,92. */
    class Colour {
        constructor(r, g, b, a) { this.r = r; this.g = g; this.b = b; this.a = a === undefined ? 1 : a; }
    }
    const api = {
        /* The engine sheet settings: wb.defaults.worksheetView. noWb - an engine without them. */
        wb: opt.noWb ? undefined : {defaults: {worksheetView: {activeCellBorderColor: new Colour(72, 121, 92)}}},
        handlers: {},
        asc_registerCallback(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
        asc_unregisterCallback(name, fn) { const a = this.handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        sendEvent(name, ...args) { (this.handlers[name] || []).slice().forEach(fn => fn.apply(this, args)); },
        asc_isDocumentModified() { if (modifiedThrows) throw new Error('engine is not ready'); return modified; },
        asc_Resize() {},
        /* The canvas skin: the engine takes the theme colors as a whole. */
        skins: [],
        asc_setSkin(obj) { this.skins.push(obj); }
    };

    const vlayout = layout([
        {alias: 'title', height: 28},
        {alias: 'toolbar', height: 92},
        {stretch: true},
        {alias: 'statusbar', height: 25}
    ]);
    const hlayout = layout([{alias: 'left'}, {stretch: true}, {alias: 'right'}]);
    const celayout = layout([{alias: 'celleditor'}, {stretch: true}]);

    const button = () => ({pressed: false, options: {}});
    const leftMenu = {
        btnSearchBar: button(), btnComments: button(), btnChat: button(), btnSpellcheck: button(),
        btnAbout: button(), buttons: []
    };
    const toolbarView = Object.assign(events(), {el: toolbarEl});

    const main = {
        editorConfig: 'editorConfig' in opt ? opt.editorConfig : {ui: {shell: 'modern'}},
        appOptions: {spreadsheet: {title: 'Отчёт за квартал.xlsx'}, isEdit: true}
    };

    const SSE = {
        Views: {},
        getController(name) {
            if (opt.controllerThrows) throw new Error('controller is not built yet');
            if (name === 'Main') return opt.noMain ? undefined : main;
            if (name === 'Toolbar') return opt.rendered === false ? {} : {toolbar: toolbarView, api};
            if (name === 'Viewport') return {viewport: {vlayout, hlayout, celayout}, getApi: () => api};
            if (name === 'LeftMenu') return {leftMenu};
            return undefined;
        }
    };

    const context = {
        SSE,
        document: doc,
        /* The menu row takes a snapshot of all sections already at the start (section visibility): a missing menu item double is
           a catalog warning, this stock has no menu doubles. It is checked by roles-locks.cjs. */
        console: {warn: (...a) => { if (!/^Compact shell: stock control ".*" is missing, menu item/.test(String(a[0]))) warnings.push(a); }, log() {}, error() {}},
        setTimeout: fn => { timers.push(fn); return timers.length; },
        clearTimeout() {},
        Event: class { constructor(type) { this.type = type; } },
        URL,
        _: {extend: Object.assign},
        Common: {
            NotificationCenter: NC,
            /* The stock Themes.getThemeColors - theme variables with the computed style of body: in any
               mode the standard ones (the shell does not override them). */
            UI: {Themes: {getThemeColors() {
                return {'canvas-cell-title-background-hover': '#dfdfdf', 'canvas-cell-title-background-selected': '#cfcfcf',
                        'canvas-cell-title-border': '#d8d8d8', 'canvas-cell-title-border-hover': '#c0c0c0',
                        'canvas-cell-title-border-selected': '#a8a8a8', type: 'light', name: 'theme-white'};
            }}}
        },
        /* The compact own variables (compact-shell.less) are visible only under body.vo-compact. Both borders in LESS
           are the standard header border; here the selected one is a unit darker so that the cases
           tell which variable went to which skin key. */
        getComputedStyle(el) {
            const compact = el === doc.body && doc.body.classList.contains('vo-compact');
            const vars = compact ? {'--vo-cell-title-hover': ' #deedff', '--vo-cell-title-selected': '#e6f4ff',
                '--vo-cell-title-border-hover': '#d8d8d8', '--vo-cell-title-border-selected': '#d7d7d7',
                '--vo-cell-selection': ' #0075ff'} : {};
            return {transitionDuration: '0s', getPropertyValue: n => vars[n] || ''};
        },
        resizes: 0
    };
    context.window = context;
    context.dispatchEvent = ev => { if (ev && ev.type === 'resize') context.resizes++; return true; };
    /* Window listeners: the menu row catches an outside click and Escape on window in the capture phase. */
    context.listeners = {};
    context.addEventListener = (t, fn) => { (context.listeners[t] = context.listeners[t] || []).push(fn); };
    context.removeEventListener = () => {};

    const modules = {};
    const load = (rel, abs) => {
        if (modules[rel]) return modules[rel];
        const src = fs.readFileSync(abs, 'utf8');
        let result;
        context.define = (deps, factory) => {
            const args = deps.map(d => load(d, path.join(ROOT, 'apps', d + '.js')));
            result = factory(...args);
        };
        vm.runInContext(src, context, {filename: abs});
        return (modules[rel] = result);
    };
    vm.createContext(context);
    modules['common/main/lib/view/compact/Icons'] = load('common/main/lib/view/compact/Icons', ICONS);
    load('spreadsheeteditor/main/app/view/CompactShell', file);

    return {
        shell: SSE.Views.CompactShell, SSE, doc, NC, api, main, vlayout, hlayout, leftMenu, toolbarView,
        timers, warnings, context, toolbarEl,
        setModified(v) { modified = v; },
        setModifiedThrows(v) { modifiedThrows = v; },
        flush() { let n = 0; while (timers.length && n++ < 100) timers.shift()(); },
        heights() { return {title: vlayout.getItem('title').height, toolbar: vlayout.getItem('toolbar').height}; },
        body() { return doc.body.classList; },
        /* The start exactly as controller/Viewport.js does it: the claim on Gateway
           init, the skeleton on app:face, start() on app:ready. */
        announce() { SSE.Views.CompactShell.announce(main.editorConfig); },
        face() { NC.trigger('app:face', main.appOptions); },
        start() { SSE.Views.CompactShell.start(); }
    };
}

/* --- Run ----------------------------------------------------------------- */

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, '—', error && error.message);
        failed++;
    }
}

const voNodes = env => env.doc.querySelectorAll('[id^="vo-"]');
const voClasses = env => env.body().filter(c => c.indexOf('vo-') === 0);

test('wanted_true_only_for_exact_ui_shell', () => {
    assert.equal(makeEnv({editorConfig: {ui: {shell: 'modern'}}}).shell.wanted(), true);
    assert.equal(makeEnv({editorConfig: {ui: {shell: 'modern', mode: 'compact'}}}).shell.wanted(), true,
        'ui.shell together with ui.mode');
    ['Modern', 'MODERN', ' modern', 'modern ', 'compact', 'advanced', '', null, undefined, 1, true, {}]
        .forEach(shell => assert.equal(makeEnv({editorConfig: {ui: {shell}}}).shell.wanted(), false,
            'shell ' + JSON.stringify(shell)));
    /* ui.mode is only a "ring", it does not enable the shell (as in Documents). */
    ['compact', 'Compact', 'advanced'].forEach(mode => assert.equal(makeEnv({editorConfig: {ui: {mode}}}).shell.wanted(),
        false, 'mode ' + JSON.stringify(mode) + ' alone'));
});

test('wanted_false_without_ui_or_on_throw', () => {
    assert.equal(makeEnv({editorConfig: {}}).shell.wanted(), false, 'no ui');
    assert.equal(makeEnv({editorConfig: {ui: 'modern'}}).shell.wanted(), false, 'ui as a string');
    assert.equal(makeEnv({editorConfig: {customization: {compactToolbar: true, compactHeader: true}}}).shell.wanted(),
        false, 'stock compact flags are not the gate');
    assert.equal(makeEnv({editorConfig: {ui: {mode: 'compact'}, customization: {compactToolbar: true}}}).shell.wanted(),
        false, 'ui.mode with stock compact flags is not the gate');
    assert.equal(makeEnv({editorConfig: undefined}).shell.wanted(), false, 'no editorConfig');
    assert.equal(makeEnv({noMain: true}).shell.wanted(), false, 'no Main controller');
    assert.equal(makeEnv({controllerThrows: true}).shell.wanted(), false, 'getController throws');
    const throwing = {};
    Object.defineProperty(throwing, 'ui', {get() { throw new Error('broken config'); }});
    assert.equal(makeEnv({editorConfig: throwing}).shell.wanted(), false, 'reading ui throws');
});

test('create_is_idempotent', () => {
    const early = makeEnv({rendered: false});
    early.shell.create();
    assert.equal(early.doc.getElementById('vo-shell'), null, 'shell is built before the ribbon is rendered');
    assert.deepEqual(voClasses(early), [], 'body classes set before the ribbon is rendered');

    const env = makeEnv();
    env.shell.create();
    const layoutSubs = env.NC.count('layout:changed');
    const apiSubs = (env.api.handlers.asc_onDocumentModifiedChanged || []).length;
    env.shell.create();
    env.start();
    env.flush();
    assert.equal(env.doc.querySelectorAll('#vo-shell').length, 1, 'one #vo-shell');
    assert.equal(env.toolbarEl.firstChild.id, 'vo-shell', '#vo-shell is the first child of #toolbar');
    assert.equal(env.NC.count('layout:changed'), layoutSubs, 'notification subscriptions doubled');
    assert.equal((env.api.handlers.asc_onDocumentModifiedChanged || []).length, apiSubs, 'engine callbacks doubled');
    assert.ok(apiSubs >= 1, 'save state is not subscribed to the engine');
    assert.ok(env.body().contains('vo-compact'));
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => w[0])));
});

test('create_failure_rolls_back_once', () => {
    const env = makeEnv();
    const stockHeights = env.heights();
    env.setModifiedThrows(true);
    assert.doesNotThrow(() => env.start(), 'startup failure escaped to app:ready');
    env.flush();
    assert.deepEqual(voNodes(env).map(e => e.id), [], 'shell nodes left after rollback');
    assert.deepEqual(voClasses(env), [], 'shell classes left on body after rollback');
    assert.deepEqual(env.heights(), stockHeights, 'stock heights are not restored');
    assert.equal(env.shell.wanted(), false, 'gate is open after the failure');
    assert.equal(env.warnings.length, 1, 'the failure is reported once');

    /* There are no more repeats: neither from the attempt cycle nor by a direct call. */
    env.setModifiedThrows(false);
    env.shell.create();
    env.start();
    env.flush();
    assert.equal(env.doc.getElementById('vo-shell'), null, 'shell rebuilt after the failure');

    /* The shell subscriptions are silent: the left area and the engine no longer touch the stock. */
    env.leftMenu.btnComments.pressed = true;
    env.NC.trigger('layout:changed', 'leftmenu');
    assert.equal(env.body().contains('vo-left-open'), false, 'left-area subscription survived rollback');
    env.vlayout.getItem('toolbar').height = 64;
    env.NC.trigger('uitheme:changed');
    env.NC.trigger('layout:changed', 'toolbar');
    assert.equal(env.heights().toolbar, 64, 'layout subscription survived rollback');
    assert.doesNotThrow(() => env.api.sendEvent('asc_onDocumentModifiedChanged', true));
});

/* The role of the #toolbar area (Viewport.template: role=toolbar). In the compact the whole
   shell is in it - the header, the menu row and our panel - and the role is removed (role=none); in the Standard it is the
   standard again (the ribbon is in it), on return it is removed again. A start failure returns the standard role. */
test('area_role_follows_mode_and_rollback', () => {
    const env = makeEnv();
    env.toolbarEl.setAttribute('role', 'toolbar');
    env.shell.create();
    env.flush();
    assert.equal(env.toolbarEl.getAttribute('role'), 'none', 'compact: the shell area is still announced as a toolbar');
    env.shell.toggleMode();
    assert.equal(env.toolbarEl.getAttribute('role'), 'toolbar', 'advanced: the ribbon area lost its stock toolbar role');
    env.shell.toggleMode();
    assert.equal(env.toolbarEl.getAttribute('role'), 'none', 'back to compact: the shell area is announced as a toolbar');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));

    const failed = makeEnv();
    failed.toolbarEl.setAttribute('role', 'toolbar');
    failed.setModifiedThrows(true);
    failed.start();
    failed.flush();
    assert.equal(failed.doc.getElementById('vo-shell'), null, 'precondition: the start failed and rolled back');
    assert.equal(failed.toolbarEl.getAttribute('role'), 'toolbar', 'rollback did not return the stock toolbar role');
});

/* The early start skeleton hand-over by the real create(): the claim and the skeleton heights
   are removed before the stock snapshot, so the layout base is the standard heights, not the skeleton, and
   the Standard gets its own; a build failure after the hand-over leaves the standard view without the claim. */
test('create_takes_over_boot_skeleton', () => {
    const env = makeEnv();
    env.announce();
    env.face();
    assert.ok(env.body().contains('vo-boot'), 'no request class for ui.shell');
    const skeleton = env.heights().toolbar;
    assert.ok(skeleton > 92, 'no skeleton height on app:face: ' + skeleton);
    env.start();
    env.flush();
    assert.ok(env.doc.getElementById('vo-shell'), 'shell is not built');
    assert.equal(env.body().contains('vo-boot'), false, 'request class left after the shell is built');
    assert.deepEqual(env.heights(), {title: 0, toolbar: env.shell.shellHeight()}, 'compact heights');
    env.shell.toggleMode();
    assert.deepEqual(env.heights(), {title: 28, toolbar: 92}, 'advanced got the skeleton instead of the stock heights');
    env.shell.toggleMode();
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => w[0])));

    const broken = makeEnv();
    broken.announce();
    broken.face();
    broken.setModifiedThrows(true);
    assert.doesNotThrow(() => broken.start(), 'startup failure escaped to app:ready');
    broken.flush();
    assert.deepEqual(voClasses(broken), [], 'shell classes left after a failed hand-over');
    assert.deepEqual(broken.heights(), {title: 28, toolbar: 92}, 'stock heights are not back after a failed hand-over');
});

test('engine_callback_failure_is_contained', () => {
    const env = makeEnv();
    env.shell.create();
    let stockCalls = 0;
    env.shell.onApi('asc_onSelectionChanged', () => { throw new Error('shell bug'); });
    env.api.asc_registerCallback('asc_onSelectionChanged', () => { stockCalls++; });
    assert.doesNotThrow(() => env.api.sendEvent('asc_onSelectionChanged', {}));
    assert.doesNotThrow(() => env.api.sendEvent('asc_onSelectionChanged', {}));
    assert.equal(stockCalls, 2, 'stock callback after ours did not run');
    assert.equal(env.warnings.length, 1, 'repeated failure of one place must be reported once');

    /* The same path for the real shell subscription: the engine stopped answering the question. */
    let docStock = 0;
    env.api.asc_registerCallback('asc_onDocumentModifiedChanged', () => { docStock++; });
    env.setModifiedThrows(true);
    assert.doesNotThrow(() => env.api.sendEvent('asc_onDocumentModifiedChanged', true));
    assert.equal(docStock, 1, 'stock callback after the save-state one did not run');
});

/* The recalculation hold cap (HOLD_CAP) is a timer, called by the browser. The standard
   asc_Resize thrown on release is one shell warning, it does not go outside;
   the hold is removed, the substitution is restored before the call. */
test('resize_hold_cap_is_guarded', () => {
    const env = makeEnv();
    env.shell.create();
    env.flush();
    assert.equal(env.warnings.length, 0, 'precondition: no warnings after start');
    let calls = 0;
    const failing = function () { calls++; throw new Error('engine resize failed'); };
    env.api.asc_Resize = failing;
    env.shell.holdResize();
    env.api.asc_Resize();
    assert.equal(calls, 0, 'precondition: the stock call is held');
    assert.doesNotThrow(() => env.flush(), 'a failure of asc_Resize escaped the hold cap timer');
    assert.equal(calls, 1, 'the cap did not release the held resize');
    assert.equal(env.shell.resizeHold, null, 'the hold stays after the cap');
    assert.equal(env.api.asc_Resize, failing, 'the stub stays on the engine after the cap');
    assert.deepEqual(env.warnings.map(w => String(w[0])), ['Compact shell: "shell: resize hold cap" failed, the editor keeps working without it.'],
        'one shell warning for the failed cap');
});

test('advanced_roundtrip_restores_stock_heights', () => {
    const env = makeEnv();
    env.shell.create();
    assert.deepEqual(env.heights(), {title: 0, toolbar: 132}, 'compact heights');
    assert.equal(env.shell.shellHeight(), 132, 'shellHeight = header + menu + toolbar row (46 + 30 + 4 + 44 + 8)');
    assert.ok(env.doc.getElementById('vo-tb'), 'the toolbar row is built for an editor');

    env.shell.toggleMode();
    assert.ok(env.body().contains('vo-advanced') && !env.body().contains('vo-compact'), 'advanced classes');
    assert.deepEqual(env.heights(), {title: 28, toolbar: 92}, 'advanced returns stock heights');
    const back = env.doc.getElementById('vo-back');
    assert.ok(back, 'no back button in advanced');
    assert.equal(back.parentNode.id, 'box-right-btn-group', 'back button is not in the stock header');

    /* In the Standard the stock drives the heights: collapse the ribbon - the shell does not interfere. */
    env.vlayout.getItem('toolbar').height = 64;
    env.NC.trigger('layout:changed', 'toolbar');
    env.NC.trigger('uitheme:changed');
    assert.equal(env.heights().toolbar, 64, 'shell touched stock heights in advanced');

    back.click();
    assert.ok(env.body().contains('vo-compact') && !env.body().contains('vo-advanced'), 'back to compact');
    assert.deepEqual(env.heights(), {title: 0, toolbar: 132});
    assert.equal(env.doc.getElementById('vo-back'), null, 'back button left in compact');
    env.shell.toggleMode();
    assert.equal(env.heights().toolbar, 64, 'advanced lost the stock height set there');
    env.shell.toggleMode();

    /* A theme change in the compact: the standard handler puts the new theme heights and sends
       layout:changed - the shell re-asserts its own and remembers the new standard ones. */
    env.vlayout.getItem('toolbar').height = 99;
    env.NC.trigger('layout:changed', 'toolbar');
    env.NC.trigger('uitheme:changed');
    assert.equal(env.heights().toolbar, 132, 'own height not reasserted after theme change');
    env.shell.toggleMode();
    assert.equal(env.heights().toolbar, 99, 'theme change in compact lost the new stock height');
    env.shell.toggleMode();

    /* view:compact: the view handler is called before the standard controller - the order
       is as in the stock: our view listener, then Viewport writes its height. */
    env.toolbarView.trigger('view:compact', env.toolbarView, true);
    env.vlayout.getItem('toolbar').height = 70;
    env.flush();
    assert.equal(env.heights().toolbar, 132, 'own height not reasserted after view:compact');
    env.shell.toggleMode();
    assert.deepEqual(env.heights(), {title: 28, toolbar: 70}, 'view:compact lost the new stock height');
});

test('left_area_follows_stock_buttons', () => {
    const env = makeEnv();
    env.shell.create();
    assert.equal(env.body().contains('vo-left-open'), false);
    const before = env.hlayout.layouts;
    env.leftMenu.btnComments.pressed = true;
    env.NC.trigger('layout:changed', 'leftmenu');
    assert.ok(env.body().contains('vo-left-open'), 'comments opened, area hidden');
    assert.ok(env.hlayout.layouts > before, 'area shown without relayout');
    env.leftMenu.btnComments.pressed = false;
    env.NC.trigger('layout:changed', 'leftmenu');
    assert.equal(env.body().contains('vo-left-open'), false, 'comments closed by stock, area stays');

    ['btnSearchBar', 'btnChat', 'btnSpellcheck'].forEach(name => {
        env.leftMenu[name].pressed = true;
        env.NC.trigger('layout:changed', 'leftmenu');
        assert.ok(env.body().contains('vo-left-open'), name + ' opened, area hidden');
        env.leftMenu[name].pressed = false;
        env.NC.trigger('layout:changed', 'leftmenu');
        assert.equal(env.body().contains('vo-left-open'), false, name + ' closed, area stays');
    });

    const plugin = {pressed: true, options: {type: 'plugin'}};
    env.leftMenu.buttons.push(plugin);
    env.NC.trigger('layout:changed', 'leftmenu');
    assert.ok(env.body().contains('vo-left-open'), 'plugin panel opened, area hidden');
    plugin.pressed = false;
    env.leftMenu.btnAbout.pressed = true;     // "About" is not a left area panel
    env.NC.trigger('layout:changed', 'leftmenu');
    assert.equal(env.body().contains('vo-left-open'), false, 'about is not a left-area panel');
});

test('left_state_survives_advanced_roundtrip', () => {
    const env = makeEnv();
    env.shell.create();
    env.leftMenu.btnChat.pressed = true;
    env.NC.trigger('layout:changed', 'leftmenu');
    assert.ok(env.body().contains('vo-left-open'));
    env.shell.toggleMode();
    assert.equal(env.body().contains('vo-left-open'), false, 'own class kept in advanced');
    env.shell.toggleMode();
    assert.ok(env.body().contains('vo-left-open'), 'open panel lost after the round trip');

    /* The panel was closed in the Standard - after the return the area is gone. */
    env.shell.toggleMode();
    env.leftMenu.btnChat.pressed = false;
    env.NC.trigger('layout:changed', 'leftmenu');
    env.shell.toggleMode();
    assert.equal(env.body().contains('vo-left-open'), false, 'panel closed in advanced came back');
});

test('save_state_reads_engine', () => {
    const env = makeEnv();
    env.setModified(true);
    env.shell.create();
    const state = env.doc.querySelector('#vo-shell .vo-hd-state');
    assert.ok(state, 'no save state in the header');
    assert.equal(state.getAttribute('role'), 'status');
    assert.ok(state.classList.contains('dirty'), 'initial state not read from the engine');
    /* The hover hint text is aria-description (it used to be title). */
    assert.equal(state.getAttribute('aria-description'), env.shell.textUnsaved);
    assert.equal(state.getAttribute('title'), null, 'the save state keeps title — the browser would show a second tip');

    env.setModified(false);
    env.api.sendEvent('asc_onDocumentModifiedChanged', true);       // the argument lies - the engine knows the truth
    assert.equal(state.classList.contains('dirty'), false, 'state taken from the event argument');
    assert.equal(state.getAttribute('aria-description'), env.shell.textSaved);
    assert.equal(state.getAttribute('aria-label'), env.shell.textSaved);

    env.setModified(true);
    env.api.sendEvent('asc_onDocumentModifiedChanged', false);
    assert.ok(state.classList.contains('dirty'), 'state taken from the event argument');
});

test('header_shows_name_without_brand', () => {
    const env = makeEnv();
    env.shell.create();
    const title = env.doc.querySelector('#vo-shell .vo-hd-title');
    assert.ok(title, 'no document name');
    assert.equal(title.tagName, 'SPAN', 'name is text, not a field');
    assert.equal(title.textContent, 'Отчёт за квартал');
    env.api.sendEvent('asc_onDocumentName', 'Бюджет.xlsx');
    assert.equal(title.textContent, 'Бюджет', 'name does not follow the engine');
    const all = env.doc.querySelectorAll('#vo-shell *');
    assert.ok(!all.some(e => /onlyoffice|logo|brand/i.test(e.className + ' ' + e.textContent)), 'brand mark in the header');
});

/* The formula bar: its modes are driven by the shell - apply() on start and on return,
   release() on leaving for the Standard, dispose() on rolling back a start failure. */
function spyBar(env) {
    const bar = env.SSE.Views.FormulaBar, log = [];
    ['apply', 'release', 'dispose'].forEach(m => {
        const orig = bar[m];
        bar[m] = function () { log.push(m + (env.body().contains('vo-compact') ? '@compact' : '@stock')); return orig.apply(this, arguments); };
    });
    return log;
}

test('formula_bar_follows_modes', () => {
    const env = makeEnv();
    const log = spyBar(env);
    env.shell.create();
    assert.deepEqual(log, ['apply@compact'], 'apply() must run on start, after body.vo-compact');
    env.shell.toggleMode();
    env.shell.toggleMode();
    assert.deepEqual(log, ['apply@compact', 'release@stock', 'apply@compact'], 'release/apply must follow the mode classes');

    const broken = makeEnv();
    const blog = spyBar(broken);
    broken.setModifiedThrows(true);
    broken.start();
    assert.deepEqual(blog, ['apply@compact', 'dispose@stock'], 'rollback must dispose the formula bar');
});

/* --- Card: panel and formula bar --------------------------------------------- */
/* The third shell row is the card: the panel in it and the formula bar under it (its node is moved by
   FormulaBar; here the stock has no CellEditor, and the test supplies the bar height in the card). The card
   height is 4 + the visible rows + 8, there is no empty card; the classes are the line between rows, the bar edge;
   the card bottom is on body (the search card). Focus in the formula bar is not focus in the shell. */
test('plate_holds_toolbar_and_formula_rows', () => {
    const env = makeEnv();
    const bar = env.SSE.Views.FormulaBar;
    let fx = 36;
    bar.plateRowHeight = () => fx;
    const vars = {};
    env.doc.body.style.setProperty = (k, v) => { vars[k] = v; };
    env.doc.body.style.removeProperty = k => { delete vars[k]; };
    env.shell.create();
    const plate = env.doc.getElementById('vo-plate');
    assert.ok(plate, 'no plate');
    assert.equal(plate.parentNode, env.doc.getElementById('vo-shell'), 'the plate is not a shell row');
    assert.equal(env.doc.getElementById('vo-tb').parentNode, plate, 'the toolbar row is not in the plate');
    const cls = () => ['vo-plate-off', 'vo-plate-split', 'vo-plate-fx'].filter(c => plate.classList.contains(c));
    assert.equal(env.heights().toolbar, 168, 'header + menu + 4 + toolbar 44 + formula 36 + 8');
    assert.deepEqual(cls(), ['vo-plate-split', 'vo-plate-fx']);
    assert.equal(vars['--vo-plate-bottom'], '160px', 'plate bottom for the search card');
    /* Expanding the bar - by a standard notification or from FormulaBar: the card grows. */
    fx = 76;
    env.NC.trigger('layout:changed', 'celleditor');
    assert.equal(env.heights().toolbar, 208, 'the expanded formula row did not grow the plate');
    assert.equal(vars['--vo-plate-bottom'], '200px');
    fx = 36;
    env.shell.formulaRowChanged(false);
    assert.equal(env.heights().toolbar, 168);
    /* Focus mode is the whole card, without the header and the menu row. */
    env.shell.toggleFocus();
    assert.equal(env.heights().toolbar, 92, 'focus mode: the plate with both rows');
    assert.equal(vars['--vo-plate-bottom'], '84px');
    env.shell.toggleFocus();
    /* "Hide panel" - the card has one formula bar. */
    env.shell.toggleToolbar();
    assert.equal(env.heights().toolbar, 46 + 30 + 4 + 36 + 8, 'hidden toolbar: the plate with the formula row');
    assert.deepEqual(cls(), ['vo-plate-fx'], 'no line between rows when the toolbar row is hidden');
    /* The formula bar is hidden the standard way and the panel is hidden - there is no card at all, the bottom is under the menu row. */
    fx = 0;
    env.shell.formulaRowChanged(false);
    assert.equal(env.heights().toolbar, 76, 'an empty plate keeps room');
    assert.deepEqual(cls(), ['vo-plate-off']);
    assert.equal(vars['--vo-plate-bottom'], '76px');
    env.shell.toggleToolbar();
    assert.equal(env.heights().toolbar, 46 + 30 + 4 + 44 + 8, 'the toolbar row alone in the plate');
    assert.deepEqual(cls(), [], 'the line or the formula edge without the formula row');
    fx = 36;
    env.shell.formulaRowChanged(false);
    /* Focus in the formula bar: the shell does not hold the engine keyboard. */
    const field = plate.appendChild(env.doc.createElement('textarea'));
    bar.owns = el => el === field;
    env.doc.activeElement = field;
    assert.equal(env.shell.focusInShell(), false, 'the formula field counts as a shell control');
    env.doc.activeElement = env.doc.querySelector('#vo-tb button') || env.doc.getElementById('vo-tb');
    assert.equal(env.shell.focusInShell(), true, 'a toolbar control is not in the shell');
    /* The Standard - the card bottom is removed. */
    env.shell.toggleMode();
    assert.equal('--vo-plate-bottom' in vars, false, 'plate bottom left on body in the advanced mode');
});

/* --- Header colors from the theme -------------------------------------------- */
/* The engine reads the theme colors once, through asc_setSkin (sdkjs common/skin.js), and our LESS in the
   browser is compiled later than the standard call: the shell re-applies the theme itself - after
   create() (and once more after 600 ms, as in Documents), after the standard uitheme:changed and in
   both directions Compact ↔ Standard, always after the body classes change. */
const hover = skin => skin && skin['canvas-cell-title-background-hover'];

test('skin_reapplied_after_create_and_theme', () => {
    const idle = makeEnv();
    idle.announce();
    idle.face();
    idle.NC.trigger('uitheme:changed');
    assert.equal(idle.api.skins.length, 0, 'skin applied before the shell exists');

    const env = makeEnv();
    env.shell.create();
    assert.equal(env.api.skins.length, 1, 'create() did not apply the skin');
    assert.equal(hover(env.api.skins[0]), '#deedff', 'skin applied before body.vo-compact');
    env.flush();
    assert.equal(env.api.skins.length, 2, 'no second application for LESS compiled in the browser');
    assert.equal(hover(env.api.skins[1]), '#deedff');

    env.NC.trigger('uitheme:changed');
    assert.equal(hover(env.api.skins[env.api.skins.length - 1]), '#deedff', 'theme change did not re-apply the compact skin');
    const n = env.api.skins.length;
    assert.ok(n >= 3, 'uitheme:changed did not re-apply the skin');
    env.flush();
    assert.equal(hover(env.api.skins[env.api.skins.length - 1]), '#deedff');

    /* In the Standard a theme change also reaches the engine - with the standard colors. */
    env.shell.toggleMode();
    env.NC.trigger('uitheme:changed');
    env.flush();
    assert.equal(hover(env.api.skins[env.api.skins.length - 1]), '#dfdfdf', 'advanced theme change applied compact colours');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => w[0])));
});

test('advanced_returns_stock_title_colors', () => {
    const env = makeEnv();
    env.shell.create();
    env.flush();
    env.shell.toggleMode();
    assert.equal(hover(env.api.skins[env.api.skins.length - 1]), '#dfdfdf', 'advanced kept the compact header colours');
    env.flush();
    assert.equal(hover(env.api.skins[env.api.skins.length - 1]), '#dfdfdf', 'a late retry brought compact colours into advanced');
    env.shell.toggleMode();
    assert.equal(hover(env.api.skins[env.api.skins.length - 1]), '#deedff', 'back to compact without compact header colours');

    /* Rollback after a build failure: the standard colors, and the late repeat does not override them. */
    const broken = makeEnv();
    broken.setModifiedThrows(true);
    broken.start();
    broken.flush();
    assert.equal(broken.doc.getElementById('vo-shell'), null, 'precondition: the start failed');
    assert.ok(broken.api.skins.length >= 1, 'rollback did not return the stock skin');
    assert.equal(hover(broken.api.skins[broken.api.skins.length - 1]), '#dfdfdf', 'rollback left compact header colours');
});

/* All four compact header colors go into the engine skin - hover, current and
   selected, the hovered border and the selected border (CompactShell TITLE_SKIN: --vo-cell-title-*
   instead of canvas-cell-title-*), the other theme colors are standard as is; in the Standard all
   four are standard, on return to the compact - ours again. */
const TITLE_KEYS = ['canvas-cell-title-background-hover', 'canvas-cell-title-background-selected',
    'canvas-cell-title-border-hover', 'canvas-cell-title-border-selected'];
const titles = skin => Object.fromEntries(TITLE_KEYS.map(k => [k, skin && skin[k]]));
const COMPACT_TITLES = {'canvas-cell-title-background-hover': '#deedff', 'canvas-cell-title-background-selected': '#e6f4ff',
    'canvas-cell-title-border-hover': '#d8d8d8', 'canvas-cell-title-border-selected': '#d7d7d7'};
const STOCK_TITLES = {'canvas-cell-title-background-hover': '#dfdfdf', 'canvas-cell-title-background-selected': '#cfcfcf',
    'canvas-cell-title-border-hover': '#c0c0c0', 'canvas-cell-title-border-selected': '#a8a8a8'};

test('skin_takes_all_four_title_colors', () => {
    const env = makeEnv();
    env.shell.create();
    env.flush();
    const last = () => env.api.skins[env.api.skins.length - 1];
    assert.deepEqual(titles(last()), COMPACT_TITLES, 'compact: header colours of the engine skin');
    assert.deepEqual([last()['canvas-cell-title-border'], last().type, last().name], ['#d8d8d8', 'light', 'theme-white'],
        'compact: the rest of the theme colours changed');
    env.shell.toggleMode();
    env.flush();
    assert.deepEqual(titles(last()), STOCK_TITLES, 'advanced: header colours are not the stock ones');
    env.shell.toggleMode();
    env.flush();
    assert.deepEqual(titles(last()), COMPACT_TITLES, 'back to compact: header colours of the engine skin');
    env.NC.trigger('uitheme:changed');
    assert.deepEqual(titles(last()), COMPACT_TITLES, 'theme change: header colours of the engine skin');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => w[0])));
});

/* The cell selection color: the border, the range fill and the lines of highlighted headers are drawn by the engine
   with one sheet settings color (activeCellBorderColor). pushSkin sets it before asc_setSkin: in the
   compact - from --vo-cell-selection as an object of the same class, outside the compact - the same standard object. */
const selectionOf = env => env.api.wb.defaults.worksheetView.activeCellBorderColor;
const rgba = c => [c.r, c.g, c.b, c.a].join(',');

test('selection_colour_follows_modes', () => {
    const env = makeEnv();
    const stock = selectionOf(env);
    env.shell.create();
    assert.equal(rgba(selectionOf(env)), '0,117,255,1', 'create(): the engine selection colour is not ours');
    assert.ok(selectionOf(env) instanceof stock.constructor, 'create(): the selection colour is not of the engine class');
    env.flush();
    assert.equal(rgba(selectionOf(env)), '0,117,255,1', 'retry after create(): the selection colour is not ours');
    env.shell.toggleMode();
    assert.equal(selectionOf(env), stock, 'advanced: not the stock selection colour object');
    env.flush();
    assert.equal(selectionOf(env), stock, 'advanced: a late retry brought our selection colour');
    env.NC.trigger('uitheme:changed');
    env.flush();
    assert.equal(selectionOf(env), stock, 'advanced theme change: not the stock selection colour object');
    env.shell.toggleMode();
    assert.equal(rgba(selectionOf(env)), '0,117,255,1', 'back to compact: the selection colour is not ours');
    env.NC.trigger('uitheme:changed');
    assert.equal(rgba(selectionOf(env)), '0,117,255,1', 'theme change: the selection colour is not ours');
    assert.equal(rgba(stock), '72,121,92,1', 'the stock colour object was changed in place');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => w[0])));
});

test('selection_colour_stock_after_rollback', () => {
    const broken = makeEnv();
    const stock = selectionOf(broken);
    /* The engine color on each asc_setSkin: a build before the failure sets ours, the rollback - the standard one. */
    const seen = [], push = broken.api.asc_setSkin;
    broken.api.asc_setSkin = function (obj) { seen.push(rgba(selectionOf(broken))); return push.call(this, obj); };
    broken.setModifiedThrows(true);
    broken.start();
    broken.flush();
    assert.equal(broken.doc.getElementById('vo-shell'), null, 'precondition: the start failed');
    assert.ok(seen.includes('0,117,255,1'), 'precondition: the build before the failure did not set our colour: ' + JSON.stringify(seen));
    assert.equal(selectionOf(broken), stock, 'rollback: not the stock selection colour object');
    assert.equal(rgba(stock), '72,121,92,1', 'rollback: the stock colour object was changed in place');
});

/* An engine without sheet settings: no exceptions, no warnings, the skin goes as usual. Once the
   settings appear, the next pass sets our color. */
test('selection_colour_without_engine_settings', () => {
    const env = makeEnv({noWb: true});
    env.shell.create();
    env.flush();
    env.shell.toggleMode();
    env.shell.toggleMode();
    env.NC.trigger('uitheme:changed');
    env.flush();
    assert.ok(env.api.skins.length >= 4, 'the skin was not applied without engine settings');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => w[0])));
    const EngineColour = selectionOf(makeEnv()).constructor;
    env.api.wb = {defaults: {worksheetView: {activeCellBorderColor: new EngineColour(72, 121, 92)}}};
    env.NC.trigger('uitheme:changed');
    assert.equal(rgba(selectionOf(env)), '0,117,255,1', 'settings appeared: the next pass did not set our colour');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
