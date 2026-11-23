/* Run: node test/unit-tests/presentationeditor/compact-shell-gate.cjs [path to CompactShell.js]
 * The presentation shell scaffold: enabling strictly by editorConfig.ui.shell === 'modern',
 * the vo-boot claim class and the scaffold on app:face, starting with retries and a fallback to stock,
 * zone order, row hiding owners, the edit right snapshot, the command registry,
 * the "Stock interface" and returning.
 * The optional argument is the path to a CompactShell.js copy for checking on a corrupted copy;
 * the zones are taken from the tree.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/presentationeditor/main/app/view');
const SHELL_FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactShell.js');
const ZONES = ['StockBridge', 'CompactWindows', 'SlideSelection', 'CompactModes', 'SlideActions',
    'CompactToolbar', 'SlideSections', 'CompactLeft', 'CompactStatus'];
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

/* --- a small DOM --------------------------------------------------------- */
class El {
    constructor(tag) {
        this.localName = tag;
        this.attrs = {};
        this.childNodes = [];
        this.parentNode = null;
        this.listeners = {};
        this.textContent = '';
        const self = this;
        this.classList = {
            list: () => (self.attrs.class || '').split(/\s+/).filter(Boolean),
            add(...c) { self.attrs.class = Array.from(new Set(this.list().concat(c))).join(' '); },
            remove(...c) { self.attrs.class = this.list().filter(x => !c.includes(x)).join(' '); },
            contains(c) { return this.list().includes(c); },
            toggle(c, on) { const v = on === undefined ? !this.contains(c) : !!on; v ? this.add(c) : this.remove(c); return v; }
        };
    }
    get className() { return this.attrs.class || ''; }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = String(v); }
    get firstChild() { return this.childNodes[0] || null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(c) { return this.insertBefore(c, null); }
    insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c);
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
        c.parentNode = this;
        return c;
    }
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null; return c; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    click() { (this.listeners.click || []).forEach(f => f({})); }
    all() { return this.childNodes.reduce((a, c) => a.concat([c], c.all()), []); }
}

let doc, main, viewport, leftMenu, holder, handlers, timers, warnings, installs, tb, st, layouts, resized;
const panel = h => { const p = {height: h, writes: [], el: {css: (k, v) => p.writes.push(v)}}; return p; };

const context = {
    PE: {Views: {}, getController(name) {
        if (name === 'Main') return main;
        if (name === 'Viewport') return viewport;
        if (name === 'LeftMenu') return leftMenu;
        if (name === 'DocumentHolder') return holder;
        return null;
    }},
    _,
    setTimeout: f => { timers.push(f); return timers.length; },
    clearTimeout: () => {},
    console: {warn: (...a) => warnings.push(a.map(String).join(' ')), log: console.log},
    $: () => ({trigger: () => { resized++; }}),
    Common: {
        NotificationCenter: {
            on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
            trigger: (ev, ...a) => (handlers[ev] || []).slice().forEach(f => f(...a))
        },
        Gateway: {
            on: (ev, fn) => { (handlers['gateway:' + ev] = handlers['gateway:' + ev] || []).push(fn); }
        },
        UI: {Themes: {available: () => true}}
    }
};
context.window = context;
Object.defineProperty(context, 'document', {get: () => doc});
vm.createContext(context);
context.define = (deps, factory) => factory();
/* Icons are the shared editor set (Common.UI.Compact.Icons): a module of the shared compact layer. */
const SHARED_ICONS = path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js');
vm.runInContext(fs.readFileSync(SHARED_ICONS, 'utf8'), context, {filename: SHARED_ICONS});
/* The window mechanics of the CompactWindows zone are shared (Common.UI.Compact.Windows). */
const SHARED_WINDOWS = path.join(ROOT, 'apps/common/main/lib/view/compact/Windows.js');
vm.runInContext(fs.readFileSync(SHARED_WINDOWS, 'utf8'), context, {filename: SHARED_WINDOWS});
for (const name of ZONES) {
    const file = path.join(VIEW, name + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
}
vm.runInContext(fs.readFileSync(SHELL_FILE, 'utf8'), context, {filename: SHELL_FILE});
const PE = context.PE;
const shell = PE.Views.CompactShell;
const pristine = Object.assign({}, shell);
const zonesPristine = {};
for (const z of ZONES) zonesPristine[z] = Object.assign({}, PE.Views[z]);

function makeDoc(withChrome) {
    const root = new El('html');
    const body = new El('body');
    root.appendChild(body);
    const d = {
        body,
        createElement: tag => new El(tag),
        getElementById: id => root.all().find(e => e.getAttribute('id') === id) || null,
        querySelectorAll: sel => {
            assert.equal(sel, '[id^="vo-"]');
            return root.all().filter(e => (e.getAttribute('id') || '').startsWith('vo-'));
        }
    };
    if (withChrome !== false) {
        for (const id of ['toolbar', 'statusbar']) { const e = new El('div'); e.setAttribute('id', id); e.appendChild(new El('section')); body.appendChild(e); }
        const group = new El('section');
        group.setAttribute('id', 'box-right-btn-group');
        d.getElementById('toolbar').firstChild.appendChild(group);
    }
    return d;
}

function fresh(cfg, appOptions) {
    Object.keys(shell).forEach(k => { if (!(k in pristine)) delete shell[k]; });
    Object.assign(shell, pristine, {boot: null, booted: false, startupFailed: false, advanced: false, api: null,
        base: null, ours: false, rows: null, commands: null, rightSnapshot: null});
    for (const z of ZONES) { Object.keys(PE.Views[z]).forEach(k => delete PE.Views[z][k]); Object.assign(PE.Views[z], zonesPristine[z]); }
    doc = makeDoc();
    handlers = {}; timers = []; warnings = []; installs = []; layouts = 0; resized = 0;
    main = {editorConfig: cfg, appOptions: appOptions || {isEdit: true}, api: {Resize() {}}};
    leftMenu = null;
    tb = panel(88); st = panel(25);
    const panels = [tb, st];
    viewport = {viewport: {
        vlayout: {panels, getItem: a => (a === 'toolbar' ? tb : a === 'statusbar' ? st : null), doLayout: () => { layouts++; }},
        hlayout: {doLayout() {}}
    }, api: main.api};
}
const SHELL = {ui: {shell: 'modern'}};
const face = (opts = {isEdit: true}) => (handlers['app:face'] || []).forEach(f => f(opts));
const drain = () => { let n = 0; while (timers.length && n < 100) { timers.shift()(); n++; } };
const classes = () => doc.body.classList.list();
const hidden = id => doc.getElementById(id).hasAttribute('hidden');
const SHELL_H = 46 + 30 + 4 + 44 + 8;

function startWith(create) {
    let calls = 0;
    shell.create = function () { calls++; return create.call(this, calls); };
    shell.start();
    drain();
    return calls;
}
function boot(cfg, appOptions) {
    fresh(cfg || SHELL, appOptions);
    shell.announce(cfg || SHELL);
    face(appOptions || {isEdit: true});
    shell.start();
    drain();
    assert.ok(doc.getElementById('vo-shell'), 'the shell is not built' + (warnings.length ? ': ' + warnings[0] : ''));
}

/* The loading skeleton from index.html: the #loading-mask node the stock code removes by id. */
function mask() {
    const node = new El('div');
    node.setAttribute('id', 'loading-mask');
    doc.body.appendChild(node);
    return node;
}
/* The engine error subscription of the api the shell finds (Main.api). */
function engine() {
    const errors = [];
    main.api.asc_registerCallback = (name, fn) => { if (name === 'asc_onError') errors.push(fn); };
    return (...args) => errors.slice().forEach(f => f(...args));
}

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('ok ' + name); passed++; }
    catch (e) { console.log('FAIL ' + name + ': ' + e.message); failed++; }
}

check('gate_ui_shell_modern_only', () => {
    fresh(SHELL); assert.equal(shell.wanted(), true);
    fresh({ui: {shell: 'modern', mode: 'compact'}}); assert.equal(shell.wanted(), true);
    for (const v of ['Modern', 'MODERN', 'modern ', ' modern', 'compact', 'vibe', '', null, true, 1, {}]) {
        fresh({ui: {shell: v}});
        assert.equal(shell.wanted(), false, JSON.stringify(v));
    }
    fresh({ui: {mode: 'compact'}}); assert.equal(shell.wanted(), false);
    fresh({}); assert.equal(shell.wanted(), false);
    fresh(undefined); assert.equal(shell.wanted(), false);
    fresh({});
    assert.equal(shell.wanted(SHELL), true, 'the init config is read before Main has it');
    assert.equal(shell.wanted({}), false);
});

check('gate_false_on_throw_or_startup_failed', () => {
    fresh({get ui() { throw new Error('boom'); }});
    assert.equal(shell.wanted(), false);
    fresh(SHELL);
    main = null;
    assert.equal(shell.wanted(), false, 'no Main controller');
    fresh(SHELL);
    shell.startupFailed = true;
    assert.equal(shell.wanted(), false);
    assert.equal(shell.wanted(SHELL), false);
});

check('announce_sets_boot_class_once', () => {
    fresh({});
    shell.announce({ui: {mode: 'compact'}});
    assert.equal(classes().includes('vo-boot'), false);
    shell.announce(SHELL);
    shell.announce(SHELL);
    assert.equal(classes().includes('vo-boot'), true);
    assert.equal((handlers['app:face'] || []).length, 1);
});

const plainObj = o => JSON.parse(JSON.stringify(o));   // an object from the vm context, brought to the test prototype
check('announce_tunes_stock_settings', () => {
    /* Without the shell the integrator config does not change. */
    fresh({});
    const plain = {ui: {mode: 'compact'}, customization: {plugins: true}};
    shell.announce(plain);
    assert.deepEqual(plain.customization, {plugins: true}, 'without the shell the config is untouched');
    assert.equal((handlers['gateway:opendocument'] || []).length, 0);

    /* With the shell: "Suggest a feature" and "New" hints are removed, plugins stay
       stock; the integrator's nested objects are copies, other keys stay in place. */
    fresh({});
    const own = {logo: {image: 'x'}, features: {spellcheck: {mode: true}}};
    const cfg = {ui: {shell: 'modern'}, customization: own};
    shell.announce(cfg);
    assert.notEqual(cfg.customization, own, 'the integrator object is replaced by a copy');
    assert.deepEqual(own, {logo: {image: 'x'}, features: {spellcheck: {mode: true}}}, 'the integrator object is untouched');
    assert.equal('plugins' in cfg.customization, false, 'the shell switches the plugins off');
    assert.equal(cfg.customization.suggestFeature, false);
    assert.deepEqual(plainObj(cfg.customization.features), {spellcheck: {mode: true}, featuresTips: false});
    assert.equal(cfg.customization.logo, own.logo, 'other keys are kept');

    fresh({});
    const bare = {ui: {shell: 'modern'}};
    shell.announce(bare);
    assert.deepEqual(plainObj(bare.customization), {suggestFeature: false, features: {featuresTips: false}});

    fresh({});
    const withPlugins = {ui: {shell: 'modern'}, customization: {plugins: true}};
    shell.announce(withPlugins);
    assert.equal(withPlugins.customization.plugins, true, 'the plugins of the integrator are kept');

    /* "Protect" is a stock right: the copy of the Main rights is not changed. */
    main.permissions = {edit: true, protect: true};
    (handlers['gateway:opendocument'] || []).forEach(f => f({doc: {}}));
    assert.deepEqual(main.permissions, {edit: true, protect: true}, 'the protect right is taken away');
});

/* Plugins and "Protect" stay stock, the compact shell hides only their items: "AI" of the context menu
   (the AI plugin items do not reach the stock updateCustomItems) and "Protect" of the "File" screen —
   by a rule under body.vo-compact. In the "Stock interface" the "AI" item is in place, other plugin items —
   always. */
check('ai_item_and_protect_hidden_only_in_compact', () => {
    fresh(SHELL);
    const got = [];
    /* As in the stock: the view prototype first has a stub, the real method comes later. */
    const proto = {updateCustomItems() { got.push('stub'); }};
    const view = Object.create(proto);
    holder = {documentHolder: view};
    try {
        shell.hideAiItem();
        shell.hideAiItem();
        proto.updateCustomItems = function (menu, data) { got.push(data.map(d => d.guid)); };
        const AI = 'asc.{9DC93CDB-B576-4F0C-B55E-FCC9C48DD007}';
        const data = () => [{guid: AI, items: [{text: 'AI'}]}, {guid: 'asc.{other}', items: [{text: 'Other'}]}];
        doc.body.classList.add('vo-compact');
        view.updateCustomItems({}, data());
        assert.deepEqual(got.pop(), ['asc.{other}'], 'the AI item reaches the menu in the compact shell');
        shell.advanced = true;
        doc.body.classList.remove('vo-compact');
        view.updateCustomItems({}, data());
        assert.deepEqual(got.pop(), [AI, 'asc.{other}'], 'the stock interface loses the AI item');
        assert.equal(got.length, 0, 'the stock method is wrapped twice');
    } finally {
        holder = null;
    }
    const less = fs.readFileSync(path.join(ROOT, 'apps/presentationeditor/main/resources/less/compact-shell.less'), 'utf8');
    const rule = /body\.vo-compact #file-menu-panel #fm-btn-rights,\s*body\.vo-compact #file-menu-panel #fm-btn-protect\s*\{\s*display:\s*none !important;/;
    assert.ok(rule.test(less), 'no compact rule hiding «Protect» on the File screen');
});

check('boot_heights_on_app_face_stock_back_on_end_boot', () => {
    fresh(SHELL);
    shell.announce(SHELL);
    face();
    assert.deepEqual([tb.height, st.height], [SHELL_H, 0]);
    assert.equal(tb.writes.at(-1), SHELL_H + 'px');
    assert.ok(layouts > 0);
    shell.endBoot(true);
    assert.equal(classes().includes('vo-boot'), false);
    assert.deepEqual([tb.height, st.height], [88, 25]);
    assert.equal(tb.writes.at(-1), '88px');

    fresh(SHELL, {isEdit: false});
    shell.announce(SHELL);
    face({isEdit: false});
    assert.equal(tb.height, 46 + 30, 'a reader gets header and menu bar only');

    fresh(SHELL);
    shell.announce(SHELL);
    face();
    tb.height = 116;
    shell.endBoot(true);
    assert.equal(tb.height, 116, 'a fresher stock height is kept');

    fresh(SHELL);
    shell.announce(SHELL);
    face();
    tb.writes.length = 0;
    shell.endBoot(false);
    assert.deepEqual([tb.height, st.height, tb.writes.length], [88, 25, 0], 'hand-over restores the model only');
});

check('loading_skeleton_kept_under_another_id_until_end_boot', () => {
    fresh({ui: {mode: 'compact'}});
    const stock = mask();
    shell.announce({ui: {mode: 'compact'}});
    assert.equal(stock.id, 'loading-mask', 'without the shell the stock removes it as before');

    fresh(SHELL);
    const held = mask();
    shell.announce(SHELL);
    assert.equal(held.id, 'vo-loading', 'the skeleton keeps the stock id');
    assert.equal(doc.getElementById('loading-mask'), null, 'the stock lookup finds it');
    face();
    assert.ok(held.parentNode, 'app:face took the skeleton');
    shell.endBoot(false);
    assert.ok(held.parentNode === null, 'the hand-over frame left the skeleton');

    fresh(SHELL);
    const failed = mask();
    shell.announce(SHELL);
    shell.endBoot(true);
    assert.ok(failed.parentNode === null, 'the fail-safe left the skeleton');

    fresh(SHELL);
    shell.announce(SHELL);
    assert.doesNotThrow(() => shell.endBoot(true), 'no skeleton on the page');
});

/* An opening error arrives before app:ready, and no app:ready follows it: the error itself
   has to remove the skeleton and the claim, otherwise the stock window hangs over the
   skeleton and the loading band keeps running after OK. */
check('loading_skeleton_opening_error_before_the_shell_takes_it_and_the_claim', () => {
    fresh(SHELL);
    const fire = engine();
    const late = mask();
    shell.announce(SHELL);
    face();
    assert.notEqual(tb.height, 88, 'the skeleton heights are not on');
    fire(-4, 2);
    assert.ok(late.parentNode === null, 'the skeleton stays under the error window');
    assert.equal(classes().includes('vo-boot'), false, 'the claim stays under the error window');
    assert.equal(tb.height, 88, 'stock heights are not back');
    assert.equal(st.height, 25);
    assert.doesNotThrow(() => fire(-4, 2), 'a second error throws');

    fresh(SHELL);
    const fireEarly = engine();
    const early = mask();
    shell.announce(SHELL);
    fireEarly(-4, 2);
    assert.ok(early.parentNode === null, 'an error before app:face left the skeleton');
    face();
    assert.equal(tb.height, 88, 'a late app:face laid out the skeleton again');

    fresh(SHELL);
    const fireAfter = engine();
    shell.announce(SHELL);
    face();
    shell.endBoot(false);
    doc.body.classList.add('vo-compact');
    fireAfter(-4, 2);
    assert.equal(classes().includes('vo-compact'), true, 'after the build errors are the stock business');

    fresh(SHELL);
    assert.doesNotThrow(() => shell.announce(SHELL), 'an engine without callbacks');
    assert.equal(classes().includes('vo-boot'), true);
});

check('start_twenty_attempts_then_stock', () => {
    fresh({ui: {mode: 'compact'}});
    assert.equal(startWith(() => shell), 0, 'no ui.shell — no attempts');
    fresh(SHELL);
    shell.announce(SHELL);
    face();
    assert.equal(startWith(() => shell), 20);
    assert.equal(classes().includes('vo-boot'), false);
    assert.deepEqual([tb.height, st.height], [88, 25]);

    fresh(SHELL);
    shell.announce(SHELL);
    face();
    const calls = startWith(function (n) {
        if (n < 3) return shell;
        this.endBoot(false); doc.getElementById('toolbar').appendChild(Object.assign(new El('div'), {})).setAttribute('id', 'vo-shell');
        return shell;
    });
    assert.equal(calls, 3, 'success on the third attempt stops the loop');
});

check('start_failure_contained_not_retried', () => {
    fresh(SHELL);
    shell.announce(SHELL);
    face();
    assert.doesNotThrow(() => assert.equal(startWith(() => { throw new Error('create failed'); }), 1));
    assert.equal(classes().includes('vo-boot'), false);
    assert.deepEqual([tb.height, st.height], [88, 25]);
    assert.equal(warnings.length, 1, 'the failure is reported once');

    fresh(SHELL);
    shell.announce(SHELL);
    face();
    const before = layouts;
    assert.equal(startWith(function () { this.endBoot(false); throw new Error('snapshot failed'); }), 1);
    assert.ok(layouts > before, 'failure after hand-over re-lays the stock layout');
});

check('zone_install_order', () => {
    fresh(SHELL);
    for (const z of ZONES) PE.Views[z].install = s => installs.push([z, s]);
    shell.announce(SHELL);
    face();
    shell.start();
    drain();
    assert.deepEqual(Array.from(shell.ZONES), ZONES);
    assert.deepEqual(installs.map(i => i[0]), ZONES);
    assert.ok(installs.every(i => i[1] === shell), 'every zone gets the shell');
    assert.ok(doc.getElementById('vo-shell'));
    for (const z of ZONES) {
        assert.equal(typeof zonesPristine[z].install, 'function', z + '.install');
        assert.doesNotThrow(() => zonesPristine[z].install(shell), z + '.install');
    }
    assert.equal(zonesPristine.SlideSelection.kind(), 'none');
    assert.equal(zonesPristine.CompactModes.mode(), 'edit');
    assert.equal(zonesPristine.CompactModes.reason({edit: true}), null);
    assert.equal(zonesPristine.CompactModes.MODE_EVENT, 'vo:mode');
    const sent = [];
    handlers['vo:mode'] = [m => sent.push(m)];
    zonesPristine.CompactModes.setMode('view');
    assert.deepEqual(sent, [], 'the stub sends no vo:mode');
    assert.equal(zonesPristine.CompactModes.mode(), 'edit');
});

check('zone_failure_rolls_back_to_stock', () => {
    fresh(SHELL);
    PE.Views.SlideActions.install = () => { throw new Error('zone failed'); };
    PE.Views.CompactToolbar.install = s => installs.push('CompactToolbar');
    shell.announce(SHELL);
    face();
    let calls = 0;
    const create = shell.create;
    shell.create = function () { calls++; return create.apply(this, arguments); };
    shell.start();
    drain();
    assert.equal(calls, 1, 'not retried');
    assert.equal(shell.startupFailed, true);
    assert.deepEqual(installs, [], 'zones after the failed one are not installed');
    assert.equal(doc.getElementById('vo-shell'), null);
    assert.equal(doc.getElementById('vo-status'), null);
    assert.deepEqual(classes().filter(c => c.startsWith('vo-')), []);
    assert.deepEqual([tb.height, st.height], [88, 25]);
    assert.equal(tb.writes.at(-1), '88px');
    assert.equal(shell.wanted(), false, 'no second start in this session');
    assert.ok(warnings.length <= 1, 'the failure is reported at most once');
});

check('rollback_releases_zone_patches', () => {
    fresh(SHELL);
    /* Zones that replaced stock methods on install remove the replacements on rollback;
       a failure of one does not hinder the others, a zone without unbind does not hinder the rollback. */
    const released = [];
    for (const z of ZONES) PE.Views[z].install = () => installs.push(z);
    PE.Views.SlideSections.unbind = () => released.push('SlideSections');
    PE.Views.CompactLeft.unbind = () => { released.push('CompactLeft'); throw new Error('unbind failed'); };
    PE.Views.CompactStatus.install = () => { throw new Error('zone failed'); };
    shell.announce(SHELL);
    face();
    shell.start();
    drain();
    assert.equal(shell.startupFailed, true);
    assert.deepEqual(installs, ZONES.slice(0, -1), 'the zones before the failed one are installed');
    assert.deepEqual(released.slice().sort(), ['CompactLeft', 'SlideSections'], 'the zone patches stay after the rollback');
    assert.equal(doc.getElementById('vo-shell'), null, 'a failing unbind stops the rollback');
    assert.deepEqual([tb.height, st.height], [88, 25], 'a failing unbind keeps the shell heights');
});

check('row_hidden_while_any_owner_hides', () => {
    boot();
    const events = [];
    handlers['shell:toolbar'] = [(on, name) => events.push([on, name])];
    assert.equal(shell.hasToolbar(), true);
    assert.equal(tb.height, SHELL_H);
    shell.setRow('toolbar', false, 'view');
    shell.setRow('toolbar', false, 'hidden');
    assert.equal(shell.hasToolbar(), false);
    assert.ok(hidden('vo-toolbar'));
    assert.equal(tb.height, 46 + 30);
    shell.setRow('toolbar', true, 'view');
    assert.equal(shell.hasToolbar(), false, 'another owner still hides the row');
    shell.setRow('toolbar', true, 'focus');
    assert.equal(shell.hasToolbar(), false, 'an owner removes only its own reason');
    shell.setRow('toolbar', true, 'hidden');
    assert.equal(shell.hasToolbar(), true);
    assert.ok(!hidden('vo-toolbar'));
    assert.equal(tb.height, SHELL_H);
    assert.deepEqual(events, [[false, 'toolbar'], [true, 'toolbar']], 'shell:toolbar on visibility changes only');
    shell.setRow('header', false, 'focus');
    shell.setRow('menubar', false, 'focus');
    assert.ok(hidden('vo-header') && hidden('vo-menubar'));
    assert.equal(shell.rowVisible('header'), false);
    assert.equal(tb.height, 4 + 44 + 8);
});

check('row_hidden_for_reader', () => {
    boot(SHELL, {isEdit: false});
    assert.equal(shell.editRight(), false);
    assert.equal(shell.hasToolbar(), false);
    assert.ok(hidden('vo-toolbar'));
    assert.equal(tb.height, 46 + 30);
    shell.setRow('toolbar', true, 'hidden');
    assert.equal(shell.hasToolbar(), false, 'no edit right keeps the row hidden');
});

check('row_hidden_after_sharingdeny', () => {
    boot();
    assert.equal(shell.hasToolbar(), true);
    Common().NotificationCenter.trigger('collaboration:sharingdeny');
    assert.equal(shell.hasToolbar(), false);
    assert.ok(hidden('vo-toolbar'));
    assert.equal(tb.height, 46 + 30);
});

check('edit_right_snapshot_survives_editing_disable', () => {
    boot();
    assert.equal(shell.editRight(), true);
    main.appOptions.isEdit = main.appOptions.canEdit = false;
    assert.equal(shell.editRight(), true, 'a stock editing lock does not take the right away');
    assert.equal(shell.hasToolbar(), true);

    fresh(SHELL, {isEdit: false});
    leftMenu = {leftMenu: {_state: {disabled: true}}, previsEdit: true};
    shell.announce(SHELL); face(); shell.start(); drain();
    assert.equal(shell.editRight(), true, 'locked on start by a stock reason: LeftMenu.previsEdit');
    assert.equal(shell.hasToolbar(), true);
});

check('edit_right_reset_on_sharingdeny', () => {
    boot();
    Common().NotificationCenter.trigger('collaboration:sharingdeny');
    assert.equal(shell.editRight(), false);
    main.appOptions.isEdit = true;
    assert.equal(shell.editRight(), false, 'the reset sticks');
});

check('command_without_owner_inactive', () => {
    boot();
    const run = shell.command('objectProperties');
    assert.equal(typeof run, 'function');
    assert.equal(shell.hasCommand('objectProperties'), false);
    assert.equal(run('x'), undefined);
    const got = [];
    shell.command('objectProperties', (...a) => { got.push(a); return 'done'; });
    assert.equal(shell.hasCommand('objectProperties'), true);
    assert.equal(run('x'), 'done', 'a runner taken before the owner reaches it');
    assert.deepEqual(got, [['x']]);
    assert.equal(shell.hasCommand('stockInterface'), true, 'the stock interface is a shell command');
});

check('advanced_roundtrip_restores_stock_heights', () => {
    boot();
    const advanced = [];
    handlers['shell:advanced'] = [v => advanced.push(v)];
    assert.deepEqual([tb.height, st.height], [SHELL_H, 0]);
    shell.command('stockInterface')();
    assert.ok(classes().includes('vo-advanced') && !classes().includes('vo-compact'));
    assert.deepEqual([tb.height, st.height], [88, 25]);
    const back = doc.getElementById('vo-back');
    assert.ok(back, 'the way back is drawn');
    assert.equal(back.parentNode.getAttribute('id'), 'box-right-btn-group');
    shell.setRow('toolbar', false, 'hidden');
    assert.deepEqual([tb.height, st.height], [88, 25], 'rows do not touch the stock layout');
    shell.setRow('toolbar', true, 'hidden');
    back.click();
    assert.ok(classes().includes('vo-compact') && !classes().includes('vo-advanced'));
    assert.equal(doc.getElementById('vo-back'), null);
    assert.deepEqual([tb.height, st.height], [SHELL_H, 0]);
    assert.deepEqual(advanced, [true, false]);
    tb.height = 120;
    shell.toggleMode();
    assert.deepEqual([tb.height, st.height], [88, 25], 'the stock height taken on leaving the shell, not a later one');
    shell.toggleMode();
    handlers['uitheme:changed'] = handlers['uitheme:changed'] || [];
    tb.height = 104; st.height = 32;
    handlers['uitheme:changed'].forEach(f => f());
    assert.deepEqual([tb.height, st.height], [SHELL_H, 0], 'shell heights come back after a theme change');
    shell.toggleMode();
    assert.deepEqual([tb.height, st.height], [104, 32], 'stock heights of the new theme');
});

function Common() { return context.Common; }

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
