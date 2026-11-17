/* Run: node test/unit-tests/presentationeditor/slide-show.cjs [path to CompactShell.js]
 * The "Slide show ▾" button of the presentation shell: the place at the right edge of the toolbar
 * or first in the right header cluster, the main part is the stock show from
 * the current slide, ▾ is a snapshot of the stock show menu, a twin by mode and right,
 * "Show settings" without a twin are gray with a reason, there are no own combinations.
 * The optional argument is the path to a CompactShell.js copy for checking on
 * a corrupted copy; the bridge, icons and catalog are taken from the tree, the toolbar and
 * modes are stubs.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/presentationeditor/main/app/view');
const SHELL_FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactShell.js');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

/* --- a small DOM --------------------------------------------------------- */
let doc;

class El {
    constructor(tag) {
        this.localName = tag;
        this.attrs = {};
        this.childNodes = [];
        this.parentNode = null;
        this.listeners = {};
        this.html = '';
        this.text = '';
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
    get firstChild() { return this.childNodes[0] || null; }
    get children() { return this.childNodes; }
    get textContent() { return this.childNodes.length ? this.childNodes.map(c => c.textContent).join('') : this.text; }
    set textContent(v) { this.childNodes.forEach(c => { c.parentNode = null; }); this.childNodes = []; this.text = String(v); this.html = ''; }
    get innerHTML() { return this.html; }
    set innerHTML(v) { this.childNodes = []; this.text = ''; this.html = String(v); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(c) { return this.insertBefore(c, null); }
    insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c);
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        if (ref && i < 0) throw new Error('insertBefore: the reference node is not a child');
        if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
        c.parentNode = this;
        return c;
    }
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null; return c; }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    dispatch(type, props) {
        const ev = Object.assign({type, target: this, defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }}, props || {});
        for (let x = this; x && !ev.stopped; x = x.parentNode) (x.listeners[type] || []).slice().forEach(f => f.call(x, ev));
        if (!ev.stopped) (doc.listeners[type] || []).slice().forEach(f => f(ev));
        return ev;
    }
    click() { return this.dispatch('click'); }
    focus() {
        if (doc.activeElement === this) return;
        const prev = doc.activeElement;
        doc.activeElement = this;
        if (prev && prev !== doc.body) { prev.dispatch('blur'); prev.dispatch('focusout', {relatedTarget: this}); }
        this.dispatch('focus');
    }
    blur() {
        if (doc.activeElement !== this) return;
        doc.activeElement = doc.body;
        this.dispatch('blur');
        this.dispatch('focusout', {relatedTarget: null});
    }
    all() { return this.childNodes.reduce((a, c) => a.concat([c], c.all()), []); }
}

function makeDoc() {
    const root = new El('html');
    const body = new El('body');
    root.appendChild(body);
    const d = {
        body, listeners: {}, activeElement: body, baseURI: 'http://stand.test/web-apps/apps/presentationeditor/main/index.html',
        createElement: tag => new El(tag),
        getElementById: id => root.all().find(e => e.getAttribute('id') === id) || null,
        querySelectorAll: sel => {
            assert.equal(sel, '[id^="vo-"]');
            return root.all().filter(e => (e.getAttribute('id') || '').startsWith('vo-'));
        },
        addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
        dispatch(type, props) {
            const ev = Object.assign({type, target: d.body, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}}, props || {});
            (d.listeners[type] || []).slice().forEach(f => f(ev));
            return ev;
        }
    };
    for (const id of ['toolbar', 'statusbar']) { const e = new El('div'); e.setAttribute('id', id); e.appendChild(new El('section')); body.appendChild(e); }
    return d;
}

/* --- stock show buttons -------------------------------------------------- */
/* A button (Common.UI.Button): click() sends 'click' to subscribers unless disabled.
   An item (Common.UI.MenuItem): onItemClick sends the item's 'click' and the menu's 'item:click'. */
function events(o) {
    o.ls = {};
    o.on = (ev, fn) => { ev.split(' ').forEach(e => (o.ls[e] = o.ls[e] || []).push(fn)); return o; };
    o.off = () => o;
    o.trigger = (ev, ...a) => { (o.ls[ev] || []).slice().forEach(f => f(...a)); return o; };
    return o;
}
function menuItem(menu, caption, value) {
    const it = {caption, value, disabled: false, hidden: false, checkable: false, isDisabled() { return this.disabled; }};
    it.onItemClick = function () { if (it.disabled || it.hidden) return; menu.trigger('item:click', menu, it); };
    return it;
}
function previewButton(owner, withSettings) {
    const btn = events({disabled: false, isDisabled() { return this.disabled; }});
    btn.click = function () { if (!btn.disabled) btn.trigger('click', btn); };
    btn.setDisabled = v => { btn.disabled = !!v; btn.trigger('disabled', btn, !!v); };
    const menu = events({items: []});
    menu.items.push(menuItem(menu, owner + ': from the beginning', 0), menuItem(menu, owner + ': from the current slide', 1),
        menuItem(menu, owner + ': presenter view', 2));
    if (withSettings) menu.items.push({caption: '--', hidden: false}, menuItem(menu, 'Toolbar: show settings', 3));
    btn.menu = menu;
    /* stock handlers (controller/Toolbar.js, controller/Statusbar.js) */
    btn.on('click', () => calls.push(['stock', owner, 'onPreviewBtnClick']));
    menu.on('item:click', (m, item) => calls.push(['stock', owner, 'onPreviewItemClick', item.value]));
    return btn;
}

/* --- stock environment --------------------------------------------------- */
let main, viewport, toolbarCtl, statusCtl, handlers, timers, calls, apiCalls, mode;
const panel = h => ({height: h, el: {css() {}}});

const context = {
    PE: {Views: {
        /* the stock ribbon view: translated captions on the prototype */
        Toolbar: {prototype: {tipPreview: 'Stock: start slideshow', textShowSettings: 'Stock: show settings'}}
    }, getController(name) {
        if (name === 'Main') return main;
        if (name === 'Viewport') return viewport;
        if (name === 'Toolbar') return toolbarCtl;
        if (name === 'Statusbar') return statusCtl;
        return null;
    }},
    _,
    URL,
    Asc: {c_oAscAsyncAction: {Save: 4}},
    setTimeout: (f, ms) => { timers.push({f, ms}); return timers.length; },
    clearTimeout: () => {},
    console: {warn: (...a) => { throw new Error('warning: ' + a.map(x => (x && x.stack) || String(x)).join(' ')); }, log: console.log},
    $: () => ({trigger() {}}),
    Common: {
        NotificationCenter: {
            on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
            trigger: (ev, ...a) => { calls.push(['NC', ev, a]); (handlers[ev] || []).slice().forEach(f => f(...a)); }
        },
        UI: {Themes: {available: () => true}},
        Views: {}
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
for (const name of ['StockBridge', 'SlideActions']) {
    const file = path.join(VIEW, name + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
}
const PE = context.PE;
/* The catalog only for the reason "No edit right": the menu bar is not built. */
PE.Views.SlideActions.install = function () {};
/* Modes: mode() and reason() are a stub with a vo:mode notification, like the modes zone. */
PE.Views.CompactModes = {
    MODE_EVENT: 'vo:mode',
    mode: () => mode,
    setMode() {},
    reason: it => (mode === 'view' && it && it.edit ? 'Unavailable in view mode' : null),
    install() {}
};
/* The toolbar: its own right edge with the focus chevron last, like the toolbar zone. */
PE.Views.CompactToolbar = {
    install(shell) {
        const end = doc.createElement('div');
        end.setAttribute('id', 'vo-tb-end');
        const chevron = doc.createElement('button');
        chevron.setAttribute('data-vo', 'focus');
        end.appendChild(chevron);
        shell.rowEl('toolbar').appendChild(end);
    }
};
vm.runInContext(fs.readFileSync(SHELL_FILE, 'utf8'), context, {filename: SHELL_FILE});
const shell = PE.Views.CompactShell;
const pristine = Object.assign({}, shell);
const bridgePristine = Object.assign({}, PE.Views.StockBridge);

/* The shell on the stock environment: rights are appOptions fields. */
function boot(rights) {
    Object.keys(shell).forEach(k => { if (!(k in pristine)) delete shell[k]; });
    Object.assign(shell, pristine, {boot: null, booted: false, startupFailed: false, advanced: false, api: null,
        base: null, ours: false, rows: null, commands: null, rightSnapshot: null, hdr: null, pops: null, show: null});
    Object.assign(PE.Views.StockBridge, bridgePristine, {gaps: []});
    doc = makeDoc();
    handlers = {}; timers = []; calls = []; apiCalls = []; mode = 'edit';
    const api = new Proxy({
        Resize() {},
        asc_registerCallback() {},
        asc_isDocumentModified() { return false; },
        asc_enableKeyEvents() {}
    }, {get(t, p) {
        if (typeof p !== 'string' || !(p in t)) return t[p];
        return (...a) => { apiCalls.push(p); return t[p](...a); };
    }});
    const ao = Object.assign({isEdit: true, canDownload: false, canPrint: false}, rights || {});
    main = {editorConfig: {ui: {shell: 'modern'}}, appOptions: ao, api, document: {title: 'Deck.pptx'}, _state: {}};
    toolbarCtl = {toolbar: ao.isEdit ? {btnPreview: previewButton('Toolbar', true)} : {}};
    if (ao.isEdit) toolbarCtl.toolbar.mnuShowSettings = toolbarCtl.toolbar.btnPreview.menu.items[4];
    statusCtl = {statusbar: {btnPreview: previewButton('Statusbar', false)}};
    const tb = panel(88), st = panel(25);
    viewport = {
        viewport: {
            vlayout: {panels: [tb, st], getItem: a => (a === 'toolbar' ? tb : a === 'statusbar' ? st : null), doLayout() {}},
            hlayout: {doLayout() {}}
        },
        api,
        getView: () => null
    };
    shell.start();
    let n = 0;
    while (timers.length && n++ < 50) timers.shift().f();
    assert.ok(doc.getElementById('vo-shell'), 'the shell is not built');
    return shell;
}

const by = cls => doc.body.all().filter(e => e.classList.contains(cls));
const control = () => { const w = by('vo-show'); assert.equal(w.length, 1, 'there must be exactly one show control'); return w[0]; };
const part = cls => control().all().find(e => e.classList.contains(cls));
const rows = () => control().all().filter(e => e.classList.contains('vo-show-item') || e.classList.contains('vo-show-sep'));
const caption = r => (r.classList.contains('vo-show-sep') ? '—' : r.textContent);
const stock = () => calls.filter(c => c[0] === 'stock').map(c => c.slice(1));
const slot = () => doc.getElementById('vo-hdr-show');
const end = () => doc.getElementById('vo-tb-end');
const setMode = m => { mode = m; context.Common.NotificationCenter.trigger('vo:mode', {mode: m}); };
const openMenu = () => { part('vo-show-arrow').click(); assert.ok(control().classList.contains('open'), '▾ does not open the list'); };

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('ok ' + name); passed++; }
    catch (e) { console.log('FAIL ' + name + ': ' + e.message); failed++; }
}

check('show_in_toolbar_end_with_toolbar', () => {
    boot();
    assert.equal(shell.hasToolbar(), true);
    const kids = end().children;
    assert.equal(control().parentNode, end(), 'with the toolbar the control is not in #vo-tb-end');
    assert.equal(kids.length, 2);
    assert.equal(kids[0], control(), 'the control is not before the chevron');
    assert.equal(kids[1].getAttribute('data-vo'), 'focus', 'the focus chevron is no longer the last');
    assert.equal(slot().children.length, 0, 'the header keeps a show control while the toolbar is shown');
    assert.equal(part('vo-show-label').textContent, shell.textSlideShow);
    assert.equal(part('vo-show-main').getAttribute('title'), 'Stock: start slideshow', 'the main part has no stock hint');
    /* focus mode hides the header, the toolbar stays, so does the button */
    shell.setRow('header', false, 'focus');
    shell.setRow('menubar', false, 'focus');
    assert.equal(control().parentNode, end(), 'the focus mode moved the control off the toolbar');
});

check('show_first_in_header_without_toolbar', () => {
    boot({isEdit: false});
    assert.equal(shell.hasToolbar(), false);
    assert.equal(slot().children[0], control(), 'without the toolbar the control is not first in #vo-hdr-show');
    assert.equal(slot().parentNode.children[0], slot(), '#vo-hdr-show is not first in the right cluster');
    assert.equal(end().children.length, 1, 'the toolbar edge keeps a show control');

    boot();
    for (const owner of ['hidden', 'view']) {
        shell.setRow('toolbar', false, owner);
        assert.equal(slot().children[0], control(), owner + ': the control did not move to the header');
        assert.equal(end().children.length, 1, owner + ': the toolbar edge keeps a show control');
        shell.setRow('toolbar', true, owner);
        assert.equal(end().children[0], control(), owner + ': the control did not come back before the chevron');
        assert.equal(slot().children.length, 0, owner + ': the header keeps the control');
    }
    /* an open list closes on relocation */
    openMenu();
    shell.setRow('toolbar', false, 'hidden');
    assert.equal(control().classList.contains('open'), false, 'the list stays open after the move');
    /* the right is revoked: there is no toolbar, the button is in the header */
    shell.setRow('toolbar', true, 'hidden');
    context.Common.NotificationCenter.trigger('collaboration:sharingdeny');
    assert.equal(slot().children[0], control(), 'after sharingdeny the control is not in the header');
});

check('main_part_starts_from_current', () => {
    boot();
    part('vo-show-main').click();
    assert.deepEqual(stock(), [['Toolbar', 'onPreviewBtnClick']], 'the main part does not go to the stock show from the current slide');
    assert.deepEqual(apiCalls.filter(n => !/^(Resize|asc_registerCallback|asc_isDocumentModified|asc_enableKeyEvents)$/.test(n)), [],
        'the shell drives the engine itself');
    assert.deepEqual(calls.filter(c => c[0] === 'NC' && /preview/.test(c[1])), [], 'the shell starts the show itself');
    /* a disabled twin is a gray button, a click does nothing */
    toolbarCtl.toolbar.btnPreview.setDisabled(true);
    assert.equal(part('vo-show-main').getAttribute('aria-disabled'), 'true', 'the stock lock is not shown');
    assert.ok(part('vo-show-arrow').classList.contains('vo-locked'));
    calls.length = 0;
    part('vo-show-main').click();
    part('vo-show-arrow').click();
    assert.deepEqual(stock(), []);
    assert.equal(control().classList.contains('open'), false, 'a locked control opens its list');
    toolbarCtl.toolbar.btnPreview.setDisabled(false);
    assert.equal(part('vo-show-main').getAttribute('aria-disabled'), 'false');
});

check('menu_mirrors_stock_preview_menu', () => {
    boot();
    const m = toolbarCtl.toolbar.btnPreview.menu;
    openMenu();
    assert.equal(part('vo-show-arrow').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(rows().map(caption), ['Toolbar: from the beginning', 'Toolbar: from the current slide', 'Toolbar: presenter view', '—', 'Toolbar: show settings']);
    for (const [i, value] of [[0, 0], [1, 1], [2, 2], [4, 3]]) {
        calls.length = 0;
        if (!control().classList.contains('open')) openMenu();
        rows()[i].click();
        assert.deepEqual(stock(), [['Toolbar', 'onPreviewItemClick', value]], 'row ' + i + ' does not go to its stock item');
        assert.equal(control().classList.contains('open'), false, 'the list stays open after the choice');
    }
    /* the snapshot is taken at the moment of opening: a stock hidden item is absent, a disabled one is gray and does not work */
    m.items[2].hidden = true;
    m.items[0].disabled = true;
    openMenu();
    assert.deepEqual(rows().map(caption), ['Toolbar: from the beginning', 'Toolbar: from the current slide', '—', 'Toolbar: show settings']);
    assert.equal(rows()[0].getAttribute('aria-disabled'), 'true');
    calls.length = 0;
    rows()[0].click();
    assert.deepEqual(stock(), [], 'a locked stock item still runs');
    /* Esc closes the list and returns focus to ▾ */
    rows()[1].focus();
    part('vo-show-pop').dispatch('keydown', {key: 'Escape'});
    assert.equal(control().classList.contains('open'), false, 'Esc does not close the list');
    assert.equal(doc.activeElement, part('vo-show-arrow'));
});

check('twin_by_mode_and_right', () => {
    boot();
    setMode('view');
    part('vo-show-main').click();
    assert.deepEqual(stock(), [['Statusbar', 'onPreviewBtnClick']], '«Просмотр»: the twin is not the status bar button');
    boot({isEdit: false});
    part('vo-show-main').click();
    openMenu();
    rows()[0].click();
    assert.deepEqual(stock(), [['Statusbar', 'onPreviewBtnClick'], ['Statusbar', 'onPreviewItemClick', 0]], 'reader: the twin is not the status bar button');
});

check('twin_recomputed_on_vo_mode', () => {
    boot();
    /* in "View" the stock ribbon is disabled, the status bar is not */
    toolbarCtl.toolbar.btnPreview.setDisabled(true);
    assert.equal(part('vo-show-main').getAttribute('aria-disabled'), 'true');
    setMode('view');
    assert.equal(part('vo-show-main').getAttribute('aria-disabled'), 'false', 'vo:mode did not switch to the status bar twin');
    openMenu();
    setMode('edit');
    assert.equal(control().classList.contains('open'), false, 'the list of the old twin stays open');
    assert.equal(part('vo-show-main').getAttribute('aria-disabled'), 'true', 'back in editing the toolbar twin is not read');
    toolbarCtl.toolbar.btnPreview.setDisabled(false);
    calls.length = 0;
    part('vo-show-main').click();
    assert.deepEqual(stock(), [['Toolbar', 'onPreviewBtnClick']]);
    /* observing the former twin is removed */
    setMode('view');
    statusCtl.statusbar.btnPreview.setDisabled(true);
    assert.equal(part('vo-show-main').getAttribute('aria-disabled'), 'true', 'the status bar lock is not watched');
    toolbarCtl.toolbar.btnPreview.setDisabled(true);
    statusCtl.statusbar.btnPreview.setDisabled(false);
    assert.equal(part('vo-show-main').getAttribute('aria-disabled'), 'false');
});

check('settings_grey_with_reason', () => {
    boot();
    setMode('view');
    openMenu();
    /* the caption is of the stock ribbon item (it exists though disabled by the mode) */
    assert.deepEqual(rows().map(caption), ['Statusbar: from the beginning', 'Statusbar: from the current slide', 'Statusbar: presenter view', '—', 'Toolbar: show settings']);
    const s = rows()[4];
    assert.equal(s.getAttribute('aria-disabled'), 'true', '«show settings» is not grey in view mode');
    assert.equal(s.getAttribute('title'), 'Unavailable in view mode');
    assert.equal(s.getAttribute('aria-description'), 'Unavailable in view mode');
    calls.length = 0;
    s.click();
    assert.deepEqual(stock(), []);
    assert.ok(control().classList.contains('open'), 'a grey row closes the list');

    boot({isEdit: false});
    openMenu();
    const r = rows()[rows().length - 1];
    assert.equal(caption(r), 'Stock: show settings', 'reader: no toolbar item, the caption is not the stock text');
    assert.equal(r.getAttribute('title'), PE.Views.SlideActions.textNoEditRight, 'reader: the reason is not the missing edit right');
    /* in "Editing" it is the stock ribbon row, without a reason */
    boot();
    openMenu();
    assert.equal(rows()[4].hasAttribute('title'), false);
    assert.equal(rows()[4].getAttribute('aria-disabled'), 'false');
});

check('no_own_f5_handlers', () => {
    const src = fs.readFileSync(SHELL_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    assert.doesNotMatch(src, /['"](?:(?:ctrl|shift|alt|command|cmd|meta)\+)*f5['"]|keyCode\s*={2,3}\s*116|\bF5\b/i, 'the shell names a show shortcut of its own');
    boot();
    const before = calls.length;
    for (const props of [{key: 'F5', keyCode: 116}, {key: 'F5', keyCode: 116, shiftKey: true}, {key: 'F5', keyCode: 116, ctrlKey: true},
        {key: 'Enter', keyCode: 13, metaKey: true, shiftKey: true}]) {
        for (const target of [doc.body, part('vo-show-main'), part('vo-show-arrow')]) {
            const ev = target === doc.body ? doc.dispatch('keydown', props) : target.dispatch('keydown', props);
            assert.equal(ev.defaultPrevented, false, JSON.stringify(props) + ' is taken by the shell');
        }
    }
    assert.deepEqual(calls.slice(before), [], 'a show shortcut reached shell code');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
