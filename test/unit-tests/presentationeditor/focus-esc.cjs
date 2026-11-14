/* Run: node test/unit-tests/presentationeditor/focus-esc.cjs [path to CompactShell.js]
 * Focus mode, "Hide toolbar" and the shell Esc queue of the
 * presentations: focus collapses the header and the menu bar, without the toolbar everything together
 * with "Slide show ▾"; hiding the toolbar moves the show button to the header; each
 * reason has its own row owner; focus and hiding exclude each other;
 * Esc is one action per press, during a show it is the stock one.
 * The optional argument is the path to a CompactShell.js copy for checking on
 * a corrupted copy; the bridge and icons are taken from the tree, the menu bar, toolbar,
 * selection, status bar and modes are stubs.
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

/* --- a small DOM with a capture phase ------------------------------------ */
let doc;

class El {
    constructor(tag) {
        this.localName = tag;
        this.nodeType = 1;
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
    closest(sel) {
        const cls = sel.replace(/^\./, '');
        for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (x.classList.contains(cls)) return x;
        return null;
    }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    /* capture on document → target and ancestors → bubbling on document */
    dispatch(type, props) {
        const ev = Object.assign({type, target: this, defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }}, props || {});
        (doc.capture[type] || []).slice().forEach(f => f(ev));
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

let stockMenus;    // open stock menus: what '.open > .dropdown-menu' returns

function makeDoc() {
    const root = new El('html');
    const body = new El('body');
    root.appendChild(body);
    const d = {
        body, listeners: {}, capture: {}, activeElement: body,
        baseURI: 'http://stand.test/web-apps/apps/presentationeditor/main/index.html',
        createElement: tag => new El(tag),
        getElementById: id => root.all().find(e => e.getAttribute('id') === id) || null,
        querySelectorAll: sel => {
            if (sel === '[id^="vo-"]') return root.all().filter(e => (e.getAttribute('id') || '').startsWith('vo-'));
            if (sel === '.open > .dropdown-menu') return stockMenus;
            throw new Error('unexpected selector ' + sel);
        },
        addEventListener(t, f, capture) { const m = capture ? this.capture : this.listeners; (m[t] = m[t] || []).push(f); }
    };
    for (const id of ['toolbar', 'statusbar']) { const e = new El('div'); e.setAttribute('id', id); e.appendChild(new El('section')); body.appendChild(e); }
    const area = new El('textarea');
    area.setAttribute('id', 'area_id');
    body.appendChild(area);
    return d;
}

/* --- stock environment ---------------------------------------------------- */
function events(o) {
    o.ls = {};
    o.on = (ev, fn) => { ev.split(' ').forEach(e => (o.ls[e] = o.ls[e] || []).push(fn)); return o; };
    o.off = () => o;
    o.trigger = (ev, ...a) => { (o.ls[ev] || []).slice().forEach(f => f(...a)); return o; };
    return o;
}
function previewButton(owner) {
    const btn = events({disabled: false, isDisabled() { return this.disabled; }});
    btn.click = function () { if (!btn.disabled) btn.trigger('click', btn); };
    const menu = events({items: []});
    btn.menu = menu;
    btn.on('click', () => calls.push(['stock', owner, 'onPreviewBtnClick']));
    return btn;
}

let main, viewport, toolbarCtl, statusCtl, handlers, timers, calls, mode, kind, engine, modal, preview;
const panel = h => ({height: h, el: {css() {}}});

const context = {
    PE: {Views: {Toolbar: {prototype: {tipPreview: 'Stock: start slideshow'}}}, getController(name) {
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
        UI: {Themes: {available: () => true}, Menu: {Manager: {hideAll() { calls.push(['stock', 'Menu', 'hideAll']); stockMenus = []; return true; }}}},
        Utils: {ModalWindow: {isVisible: () => modal}},
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
for (const name of ['StockBridge']) {
    const file = path.join(VIEW, name + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
}
const PE = context.PE;
const B = PE.Views.StockBridge;
let gallery;
B.galleryOpen = () => gallery;
B.closeGallery = how => { calls.push(['bridge', 'closeGallery', how]); gallery = false; return true; };

PE.Views.CompactModes = {MODE_EVENT: 'vo:mode', mode: () => mode, setMode() {}, reason: () => null, install() {}};
PE.Views.SlideSelection = {kind: () => kind, install() {}};
/* The menu bar: whether a section is open and closing it (as in the catalog). */
PE.Views.SlideActions = {
    open: false,
    install() { this.open = false; },
    isMenuOpen() { return this.open; },
    closeMenu() { calls.push(['menu', 'close']); this.open = false; },
    itemState: () => ({disabled: false, reason: null})
};
/* The status bar: the language list. */
PE.Views.CompactStatus = {
    pop: null,
    install() { this.pop = null; },
    closeLanguages() { calls.push(['status', 'closeLanguages']); this.pop = null; }
};
/* The toolbar: the right edge with the chevron last, own popup panels and "⋯". */
PE.Views.CompactToolbar = {
    install(shell) {
        const me = this;
        const row = shell.rowEl('toolbar');
        const pop = key => { const w = doc.createElement('span'); w.setAttribute('data-vo-wrap', key); return w; };
        this.text = pop('text');
        this.palette = pop('palette');
        this.text.appendChild(this.palette);
        this.align = pop('align');
        row.appendChild(this.text);
        row.appendChild(this.align);
        this.pops = [this.text, this.palette, this.align];
        this.more = false;
        const end = doc.createElement('div');
        end.setAttribute('id', 'vo-tb-end');
        const chevron = doc.createElement('button');
        chevron.setAttribute('data-vo', 'focus');
        chevron.setAttribute('class', 'vo-ib vo-focus-btn');
        chevron.addEventListener('click', () => shell.command('focus')());
        end.appendChild(chevron);
        row.appendChild(end);
        me.chevron = chevron;
    },
    setOpen(w, open) { calls.push(['toolbar', 'setOpen', w.getAttribute('data-vo-wrap'), open]); w.classList.toggle('open', !!open); },
    moreOpen() { return this.more; },
    closeMore() { calls.push(['toolbar', 'closeMore']); this.more = false; }
};
const TB = PE.Views.CompactToolbar;

vm.runInContext(fs.readFileSync(SHELL_FILE, 'utf8'), context, {filename: SHELL_FILE});
const shell = PE.Views.CompactShell;
const pristine = Object.assign({}, shell);
const bridgePristine = Object.assign({}, B);

let tbPanel;
function boot(rights) {
    Object.keys(shell).forEach(k => { if (!(k in pristine)) delete shell[k]; });
    Object.assign(shell, pristine, {boot: null, booted: false, startupFailed: false, advanced: false, api: null,
        base: null, ours: false, rows: null, commands: null, rightSnapshot: null, hdr: null, pops: null, show: null, showing: false});
    Object.assign(B, bridgePristine, {gaps: []});
    doc = makeDoc();
    handlers = {}; timers = []; calls = []; mode = 'edit'; kind = 'none'; engine = []; modal = false; preview = false;
    stockMenus = []; gallery = false;
    const api = {Resize() {}, asc_registerCallback() {}, asc_isDocumentModified() { return false; }, asc_enableKeyEvents() {}};
    const ao = Object.assign({isEdit: true, canDownload: true, canPrint: false}, rights || {});
    main = {editorConfig: {ui: {shell: 'modern'}}, appOptions: ao, api, document: {title: 'Deck.pptx'}, _state: {}};
    toolbarCtl = {toolbar: ao.isEdit ? {btnPreview: previewButton('Toolbar')} : {}};
    statusCtl = {statusbar: {btnPreview: previewButton('Statusbar')}};
    tbPanel = panel(88);
    const st = panel(25);
    viewport = {
        viewport: {
            vlayout: {panels: [tbPanel, st], getItem: a => (a === 'toolbar' ? tbPanel : a === 'statusbar' ? st : null), doLayout() {}},
            hlayout: {doLayout() {}}
        },
        api,
        getView: () => null,
        previewPanel: {isVisible: () => preview}
    };
    shell.start();
    let n = 0;
    while (timers.length && n++ < 50) timers.shift().f();
    assert.ok(doc.getElementById('vo-shell'), 'the shell is not built');
    /* Engine: Esc in its field leaves the text, then clears the selection. */
    area().addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (kind === 'typing') { kind = 'text'; engine.push('leave text'); }
        else if (kind !== 'none') { kind = 'none'; engine.push('deselect'); }
    });
    return shell;
}

const area = () => doc.getElementById('area_id');
const row = name => doc.getElementById('vo-' + name);
const shown = name => !row(name).hasAttribute('hidden');
const rows = () => ({header: shown('header'), menubar: shown('menubar'), toolbar: shown('toolbar')});
const control = () => { const w = doc.body.all().filter(e => e.classList.contains('vo-show')); assert.equal(w.length, 1); return w[0]; };
const slot = () => doc.getElementById('vo-hdr-show');
const end = () => doc.getElementById('vo-tb-end');
const esc = target => (target || doc.body).dispatch('keydown', {key: 'Escape', keyCode: 27});
const run = name => shell.command(name)();
const FULL = 46 + 30 + 4 + 44 + 8;

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('ok ' + name); passed++; }
    catch (e) { console.log('FAIL ' + name + ': ' + e.message); failed++; }
}

check('focus_collapses_header_and_menu_keeps_toolbar', () => {
    boot();
    assert.equal(shell.hasCommand('focus'), true, 'no owner of the focus command');
    assert.equal(tbPanel.height, FULL);
    TB.chevron.click();
    assert.deepEqual(rows(), {header: false, menubar: false, toolbar: true}, 'the chevron does not collapse the header and the menu bar');
    assert.equal(shell.rowVisible('header'), false);
    assert.equal(tbPanel.height, 4 + 44 + 8, 'the layout keeps the room of the collapsed rows');
    assert.equal(TB.chevron.getAttribute('aria-pressed'), 'true', 'the chevron is not pressed in the focus mode');
    assert.ok(TB.chevron.classList.contains('on'));
    assert.equal(control().parentNode, end(), 'the show control left the toolbar');
    TB.chevron.click();
    assert.deepEqual(rows(), {header: true, menubar: true, toolbar: true}, 'the second press does not return the rows');
    assert.equal(tbPanel.height, FULL);
    assert.equal(TB.chevron.getAttribute('aria-pressed'), 'false');
    /* "View → Focus mode" is the same command; after it the keyboard belongs to the engine */
    const mark = calls.length;
    run('focus');
    assert.deepEqual(rows(), {header: false, menubar: false, toolbar: true});
    assert.ok(calls.slice(mark).some(c => c[0] === 'NC' && c[1] === 'edit:complete'), 'the keyboard is not returned to the editor');
    /* an open header list closes when collapsing */
    run('focus');
    const dl = shell.pops[0];
    dl.open();
    run('focus');
    assert.equal(dl.isOpen(), false, 'a header list stays open in the collapsed header');
});

check('focus_without_toolbar_collapses_all', () => {
    for (const [why, setup] of [['no edit right', () => boot({isEdit: false})], ['view mode', () => {
        boot(); mode = 'view'; shell.setRow('toolbar', false, 'view'); context.Common.NotificationCenter.trigger('vo:mode', {mode: 'view'});
    }]]) {
        setup();
        assert.equal(shell.hasToolbar(), false, why);
        assert.equal(slot().children[0], control(), why + ': the show control is not in the header');
        run('focus');
        assert.deepEqual(rows(), {header: false, menubar: false, toolbar: false}, why + ': not everything collapsed');
        assert.equal(tbPanel.height, 0, why + ': the shell keeps room');
        assert.ok(row('header').contains(control()), why + ': the show control left the collapsed header');
        assert.equal(end().children.filter(n => n.classList.contains('vo-show')).length, 0, why + ': the show control is on the toolbar');
        esc();
        assert.deepEqual(rows(), {header: true, menubar: true, toolbar: false}, why + ': Esc does not return the header and the menu bar');
        assert.equal(slot().children[0], control(), why + ': the show control is not back in the header');
    }
});

check('hide_toolbar_moves_show_to_header', () => {
    boot();
    assert.equal(shell.hasCommand('hideToolbar'), true, 'no owner of the hide toolbar command');
    assert.equal(control().parentNode, end());
    run('hideToolbar');
    assert.deepEqual(rows(), {header: true, menubar: true, toolbar: false}, 'only the toolbar must hide');
    assert.equal(slot().children[0], control(), 'the show control did not move to the header');
    assert.equal(tbPanel.height, 46 + 30);
    run('hideToolbar');
    assert.deepEqual(rows(), {header: true, menubar: true, toolbar: true}, 'the second choice does not return the toolbar');
    assert.equal(end().children[0], control(), 'the show control is not back before the chevron');
    assert.equal(end().children[1], TB.chevron, 'the chevron is no longer the last');
    assert.equal(slot().children.length, 0);
});

check('hide_toolbar_owner_independent_of_view', () => {
    boot();
    run('hideToolbar');
    shell.setRow('toolbar', false, 'view');
    shell.setRow('toolbar', true, 'view');
    assert.equal(shell.rowVisible('toolbar'), false, 'leaving «Просмотр» dropped the hiding');
    run('hideToolbar');
    assert.equal(shell.rowVisible('toolbar'), true);
    shell.setRow('toolbar', false, 'view');
    run('hideToolbar');
    run('hideToolbar');
    assert.equal(shell.rowVisible('toolbar'), false, 'the hiding removed the reason of «Просмотр»');
    shell.setRow('toolbar', true, 'view');
    assert.equal(shell.rowVisible('toolbar'), true);
    /* focus is also its own owner: the right and "View" do not remove it */
    run('focus');
    shell.setRow('header', true, 'view');
    assert.equal(shell.rowVisible('header'), false, 'another owner dropped the focus mode');
});

check('focus_and_hide_toolbar_exclusive', () => {
    boot();
    run('focus');
    run('hideToolbar');
    assert.deepEqual(rows(), {header: true, menubar: true, toolbar: false}, 'hiding the toolbar does not switch the focus mode off');
    assert.equal(shell.focusOn(), false);
    assert.equal(TB.chevron.getAttribute('aria-pressed'), 'false');
    run('focus');
    assert.deepEqual(rows(), {header: false, menubar: false, toolbar: true}, 'the focus mode does not switch the hiding off');
    assert.equal(shell.toolbarHidden(), false);
    assert.equal(control().parentNode, end(), 'the show control did not come back to the toolbar');
    assert.equal(TB.chevron.getAttribute('aria-pressed'), 'true');
});

check('esc_one_layer_per_press', () => {
    boot();
    run('focus');
    kind = 'typing';
    const step = (target, expect, msg) => {
        const before = calls.length, eng = engine.length;
        const ev = esc(target);
        const did = calls.slice(before).filter(c => c[0] !== 'NC').map(c => c.slice(0, 3).join(' ')).concat(engine.slice(eng));
        assert.deepEqual(did, expect, msg);
        assert.equal(shell.focusOn(), true, msg + ': the focus mode is off');
        return ev;
    };
    /* shell layers go one at a time, neither the engine nor leaving focus goes below */
    PE.Views.SlideActions.open = true;
    gallery = true;
    TB.text.classList.add('open');
    TB.palette.classList.add('open');
    TB.more = true;
    PE.Views.CompactStatus.pop = {};
    stockMenus = [{getClientRects: () => [{}]}];
    let ev = step(area(), ['menu close'], 'Esc #1 closes the menu bar section');
    assert.equal(ev.defaultPrevented, true);
    step(area(), ['bridge closeGallery escape'], 'Esc #2 closes the stock gallery of the toolbar');
    step(area(), ['toolbar setOpen palette'], 'Esc #3 closes the nested palette first');
    step(area(), ['toolbar setOpen text'], 'Esc #4 closes the outer popup');
    shell.pops[0].open();
    ev = step(area(), [], 'Esc #5 closes the header list');
    assert.equal(shell.pops[0].isOpen(), false, 'Esc #5 does not close the header list');
    assert.equal(ev.defaultPrevented, true);
    step(area(), ['toolbar closeMore'], 'Esc #6 closes «⋯»');
    step(area(), ['status closeLanguages'], 'Esc #7 closes the language list');
    step(area(), ['stock Menu hideAll'], 'Esc #8 closes the stock menu');
    /* focus in a stock menu: Esc is its own, the shell does not interfere */
    const ul = doc.createElement('ul');
    ul.setAttribute('class', 'dropdown-menu');
    doc.body.appendChild(ul);
    stockMenus = [{getClientRects: () => [{}]}];
    ev = step(ul, [], 'Esc inside a stock menu');
    assert.equal(ev.defaultPrevented, false);
    stockMenus = [];
    /* an open header list catches Esc itself when focus is in it */
    const dl = shell.pops[0];
    dl.open();
    ev = step(dl.wrap.children[1].children[0], [], 'Esc inside a header list');
    assert.equal(dl.isOpen(), false, 'the header list does not close itself');
    /* the shell input field and a foreign taken press */
    const field = doc.createElement('input');
    doc.body.appendChild(field);
    step(field, [], 'Esc in an input field of the shell');
    ev = doc.body.dispatch('keydown', {key: 'Escape', keyCode: 27, defaultPrevented: true});
    assert.equal(shell.focusOn(), true, 'Esc already taken by another handler');
    modal = true;
    kind = 'none';
    esc();
    assert.equal(shell.focusOn(), true, 'Esc over a modal window');
    modal = false;
    kind = 'typing';
    /* text and selection belong to the engine, one at a time */
    ev = step(area(), ['leave text'], 'Esc while typing');
    assert.equal(ev.defaultPrevented, false, 'Esc in the text is taken by the shell');
    step(area(), ['deselect'], 'Esc with a selected object');
    /* nothing left to clear: leaving focus */
    ev = esc(area());
    assert.deepEqual(rows(), {header: true, menubar: true, toolbar: true}, 'Esc with nothing open or selected does not exit the focus mode');
    esc(area());
    assert.deepEqual(rows(), {header: true, menubar: true, toolbar: true});
    /* Esc does not return a hidden toolbar: only choosing it again returns it */
    run('hideToolbar');
    esc();
    assert.equal(shell.rowVisible('toolbar'), false, 'Esc returned the hidden toolbar');
    /* the shell does not take other keys and combinations with Esc */
    run('focus');
    for (const props of [{key: 'Escape', keyCode: 27, ctrlKey: true}, {key: 'F5', keyCode: 116}, {key: 'Enter', keyCode: 13}]) {
        const e = doc.body.dispatch('keydown', props);
        assert.equal(e.defaultPrevented, false);
        assert.equal(shell.focusOn(), true, JSON.stringify(props) + ' exits the focus mode');
    }
});

check('esc_ignored_during_show', () => {
    for (const how of ['notice', 'panel']) {
        boot();
        run('focus');
        if (how === 'notice') context.Common.NotificationCenter.trigger('preview:show');
        else preview = true;
        PE.Views.SlideActions.open = true;
        const before = calls.length;
        const ev = esc();
        assert.equal(ev.defaultPrevented, false, how + ': Esc during the show is taken by the shell');
        assert.equal(shell.focusOn(), true, how + ': Esc during the show exits the focus mode');
        assert.deepEqual(calls.slice(before).filter(c => c[0] !== 'NC'), [], how + ': Esc during the show runs shell code');
        PE.Views.SlideActions.open = false;
        if (how === 'notice') context.Common.NotificationCenter.trigger('preview:hide');
        else preview = false;
        esc();
        assert.equal(shell.focusOn(), false, how + ': after the show Esc does not exit the focus mode');
    }
    /* in the "Stock interface" Esc is the stock one */
    boot();
    run('focus');
    run('stockInterface');
    esc();
    assert.equal(shell.focusOn(), true, 'Esc in the stock interface exits the focus mode');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
