/* Run: node test/unit-tests/presentationeditor/compact-header.cjs [path to CompactShell.js]
 * The presentation shell header: the order of the right cluster, the mode switch
 * only with the edit right, the "Download ▾" items by rights, the portal controls by its
 * capabilities, the title and renaming it, the save state by the engine,
 * the switch look by the vo:mode notification, the switch is locked by the stock editing ban
 * (version history) and by a connection loss, the classes the header look relies on.
 * The optional argument is the path to a CompactShell.js copy for checking on
 * a corrupted copy; the zones are taken from the tree.
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
let doc;

class El {
    constructor(tag) {
        this.localName = tag;
        this.attrs = {};
        this.childNodes = [];
        this.parentNode = null;
        this.listeners = {};
        this.value = '';
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
        addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    };
    for (const id of ['toolbar', 'statusbar']) { const e = new El('div'); e.setAttribute('id', id); e.appendChild(new El('section')); body.appendChild(e); }
    return d;
}

/* --- stock environment --------------------------------------------------- */
let main, viewport, leftMenuCtl, review, handlers, timers, calls, callbacks, modified, header;
const panel = h => ({height: h, el: {css() {}}});

const context = {
    PE: {Views: {}, getController(name) {
        if (name === 'Main') return main;
        if (name === 'Viewport') return viewport;
        if (name === 'LeftMenu') return leftMenuCtl;
        if (name === 'Common.Controllers.ReviewChanges') return review;
        return null;
    }},
    _,
    URL,
    Asc: {
        c_oAscFileType: {PPTX: 129, ODP: 131, PDF: 513},
        c_oAscAsyncAction: {Open: 1, Save: 4, ForceSaveButton: 9}
    },
    setTimeout: (f, ms) => { timers.push({f, ms}); return timers.length; },
    clearTimeout: () => {},
    console: {warn: (...a) => { throw new Error('warning: ' + a.map(x => (x && x.stack) || String(x)).join(' ')); }, log: console.log},
    $: () => ({trigger() {}}),
    Common: {
        NotificationCenter: {
            on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
            trigger: (ev, ...a) => { calls.push(['NC', ev, a]); (handlers[ev] || []).slice().forEach(f => f(...a)); }
        },
        Gateway: {requestRename: name => calls.push(['Gateway', 'requestRename', [name]])},
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

const FULL = {isEdit: true, canRename: true, canUseHistory: true, canRequestSharingSettings: true,
    sharingSettingsUrl: undefined, canDownload: true, canPrint: true};

const item = visible => ({visible, isDisabled() { return false; }});

/* The shell built on the stock environment with the `rights` options. */
function boot(rights, opts) {
    opts = opts || {};
    Object.keys(shell).forEach(k => { if (!(k in pristine)) delete shell[k]; });
    Object.assign(shell, pristine, {boot: null, booted: false, startupFailed: false, advanced: false, api: null,
        base: null, ours: false, rows: null, commands: null, rightSnapshot: null, hdr: null, pops: null});
    for (const z of ZONES) { Object.keys(PE.Views[z]).forEach(k => delete PE.Views[z][k]); Object.assign(PE.Views[z], zonesPristine[z]); }
    doc = makeDoc();
    handlers = {}; timers = []; calls = []; callbacks = {}; modified = false;
    const api = {
        Resize() {},
        asc_registerCallback(name, fn) { (callbacks[name] = callbacks[name] || []).push(fn); },
        asc_isDocumentModified() { return modified; },
        asc_enableKeyEvents(on) { calls.push(['api', 'asc_enableKeyEvents', [on]]); }
    };
    main = {editorConfig: {ui: {shell: 'modern'}}, appOptions: Object.assign({}, FULL, rights || {}), api,
        document: {title: 'Отчёт.pptx'}, _state: {}};
    const fileMenu = {
        miDownload: item(opts.twinDownload !== false),
        miPrint: item(opts.twinPrint !== false),
        miPrintWithPreview: item(false)
    };
    leftMenuCtl = {
        leftMenu: {getMenu: name => (name === 'file' ? fileMenu : null)},
        clickSaveAsFormat(menu, format) { calls.push(['LeftMenu', 'clickSaveAsFormat', [format]]); menu.hide(); },
        clickToolbarPrint() { calls.push(['LeftMenu', 'clickToolbarPrint', []]); },
        clickMenuFileItem(menu, action) { calls.push(['LeftMenu', 'clickMenuFileItem', [action]]); }
    };
    review = {view: {
        btnHistory: {disabled: !!opts.historyLocked, isDisabled() { return this.disabled; }},
        btnSharing: {disabled: false, isDisabled() { return this.disabled; }}
    }};
    header = opts.stockHeader ? {fireEvent(name, args) { calls.push(['Header', name, args]); }} : null;
    const tb = panel(88), st = panel(25);
    viewport = {
        viewport: {
            vlayout: {panels: [tb, st], getItem: a => (a === 'toolbar' ? tb : a === 'statusbar' ? st : null), doLayout() {}},
            hlayout: {doLayout() {}}
        },
        api,
        getView: name => (name === 'Common.Views.Header' ? header : null)
    };
    shell.start();
    drainStart();
    assert.ok(doc.getElementById('vo-shell'), 'the shell is not built');
    return shell;
}

/* Start timers; the "Saving…" hold is separate (runHold). */
function drainStart() {
    let n = 0;
    while (n < 50) {
        const i = timers.findIndex(t => t.ms !== 3000);
        if (i < 0) break;
        timers.splice(i, 1)[0].f();
        n++;
    }
}
function runHold() {
    const hold = timers.filter(t => t.ms === 3000);
    timers = timers.filter(t => t.ms !== 3000);
    hold.forEach(t => t.f());
}

const fire = (name, ...a) => (callbacks[name] || []).forEach(f => f(...a));
const headerEl = () => doc.getElementById('vo-header');
const find = (cls, root) => (root || headerEl()).all().filter(e => e.classList.contains(cls));
const one = (cls, root) => find(cls, root)[0] || null;
const right = () => one('vo-hd-right');
const title = () => one('vo-hd-title');
const state = () => one('vo-hd-state');
const label = e => e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent;
const popItems = wrap => find('vo-pop-item', wrap);
const used = (who, what) => calls.filter(c => c[0] === who && (!what || c[1] === what));

/* The look of a right cluster element. */
function kind(e) {
    if (e.id === 'vo-hdr-show') return 'show';
    if (e.classList.contains('vo-hd-history')) return 'history';
    if (e.classList.contains('vo-download')) return 'download';
    if (e.classList.contains('vo-hd-sharing')) return 'sharing';
    if (e.classList.contains('vo-docmode')) return 'mode';
    return e.localName + '.' + e.className;
}

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('ok ' + name); passed++; }
    catch (e) { console.log('FAIL ' + name + ': ' + e.message); failed++; }
}

check('right_cluster_order_history_download_access_mode', () => {
    boot();
    const hd = one('vo-hd');
    assert.ok(hd, 'no .vo-hd in #vo-header');
    assert.deepEqual(right().childNodes.map(kind), ['show', 'history', 'download', 'sharing', 'mode']);
    const show = doc.getElementById('vo-hdr-show');
    assert.equal(show.childNodes.length, 0, 'the slot of the show button is empty until the show zone fills it');
    const kids = hd.childNodes;
    assert.ok(kids.indexOf(title()) >= 0 && kids.indexOf(title()) < kids.indexOf(right()), 'title is not left of the right cluster');
    assert.ok(kids.indexOf(state()) > kids.indexOf(title()) && kids.indexOf(state()) < kids.indexOf(right()), 'save state is not between the title and the cluster');
    const comments = headerEl().all().filter(e => /comment/i.test(e.className + ' ' + (e.innerHTML || '') + ' ' + label(e)));
    assert.deepEqual(comments.map(e => e.className), [], 'the header has a comments control');
    /* without the edit right there is no switch, the order of the rest is the same */
    boot({isEdit: false});
    assert.deepEqual(right().childNodes.map(kind), ['show', 'history', 'download', 'sharing']);
});

check('mode_switch_only_with_edit_right', () => {
    boot({isEdit: false, canEdit: true});
    assert.equal(find('vo-docmode').length, 0, 'a reader has a mode switch');
    boot();
    const sw = one('vo-docmode');
    assert.ok(sw, 'with the edit right there is no mode switch');
    assert.deepEqual(popItems(sw).map(e => e.getAttribute('data-mode')), ['edit', 'view']);
    assert.equal(right().childNodes[right().childNodes.length - 1], sw, 'the switch is not the rightmost');
    /* the edit right is revoked: there is no switch any more */
    context.Common.NotificationCenter.trigger('collaboration:sharingdeny');
    assert.equal(find('vo-docmode').length, 0, 'the switch stays after sharingdeny');
});

check('download_items_follow_rights_empty_hides_button', () => {
    const texts = () => popItems(one('vo-download')).map(e => e.textContent);
    boot();
    const s = shell;
    assert.deepEqual(texts(), [s.textDownloadPptx, s.textDownloadPdf, s.textDownloadOdp, s.textPrint]);
    assert.equal(find('vo-pop-sep', one('vo-download')).length, 1, 'formats and print are not split by one separator');
    const btn = one('vo-download').childNodes[0];
    assert.equal(btn.localName, 'button');
    btn.click();
    assert.ok(one('vo-download').classList.contains('open'), 'the button does not open its menu');
    popItems(one('vo-download'))[0].click();
    assert.deepEqual(used('LeftMenu', 'clickSaveAsFormat').map(c => c[2][0]), [129], 'PPTX does not go to the stock save-as handler');
    assert.equal(one('vo-download').classList.contains('open'), false, 'the menu stays open after the choice');
    popItems(one('vo-download'))[3].click();
    assert.equal(used('LeftMenu', 'clickToolbarPrint').length, 1, 'print does not go to the stock print handler');

    boot({canDownload: false});
    assert.deepEqual(texts(), [s.textPrint]);
    assert.equal(find('vo-pop-sep', one('vo-download')).length, 0);
    boot({canPrint: false});
    assert.deepEqual(texts(), [s.textDownloadPptx, s.textDownloadPdf, s.textDownloadOdp]);
    assert.equal(find('vo-pop-sep', one('vo-download')).length, 0);
    /* the right is there, but the stock "File" hid the item: there is no item */
    boot({}, {twinDownload: false});
    assert.deepEqual(texts(), [s.textPrint]);
    boot({canDownload: false, canPrint: false});
    assert.equal(find('vo-download').length, 0, 'an empty "Download" menu still has a button');
    assert.deepEqual(right().childNodes.map(kind), ['show', 'history', 'sharing', 'mode']);
});

check('portal_buttons_absent_without_capability', () => {
    boot({canUseHistory: false, canRequestSharingSettings: false, sharingSettingsUrl: undefined});
    assert.deepEqual(right().childNodes.map(kind), ['show', 'download', 'mode']);
    boot({canRequestSharingSettings: false, sharingSettingsUrl: 'https://portal.test/share'});
    assert.ok(one('vo-hd-sharing'), 'the sharing url alone gives no access button');
    boot();
    one('vo-hd-history').click();
    one('vo-hd-sharing').click();
    assert.deepEqual(used('NC').map(c => c[1]).filter(n => /^collaboration:/.test(n)), ['collaboration:history', 'collaboration:sharing']);
    /* the stock history button is disabled: a press sends nothing */
    boot({}, {historyLocked: true});
    const h = one('vo-hd-history');
    assert.equal(h.getAttribute('aria-disabled'), 'true');
    h.click();
    assert.deepEqual(used('NC', 'collaboration:history'), []);
});

check('title_readonly_without_rename_or_edit_right', () => {
    boot();
    let t = title();
    assert.equal(t.localName, 'input', 'with rename and edit rights the title is not a field');
    assert.equal(t.hasAttribute('readonly'), false);
    assert.equal(t.value, 'Отчёт', 'the extension is shown');
    t.focus();
    t.value = 'Итоги';
    t.blur();
    assert.deepEqual(used('Gateway', 'requestRename').map(c => c[2][0]), ['Итоги']);

    for (const rights of [{canRename: false}, {isEdit: false}]) {
        boot(rights);
        t = title();
        assert.notEqual(t.localName, 'input', JSON.stringify(rights) + ': the title is a field');
        assert.equal(t.textContent, 'Отчёт');
        assert.equal(t.getAttribute('title'), 'Отчёт.pptx');
    }

    /* a co-authoring loss clears canRename: the field is closed, the name does not go out */
    boot();
    t = title();
    main.appOptions.canRename = false;
    context.Common.NotificationCenter.trigger('api:disconnect');
    assert.equal(t.hasAttribute('readonly'), true, 'the field stays open after the right is gone');
    t.value = 'Другое';
    t.dispatch('blur');
    assert.deepEqual(used('Gateway', 'requestRename'), []);
    assert.equal(t.value, 'Отчёт', 'the typed name is not reverted');

    /* the stock header exists: the name goes by its rename event */
    boot({}, {stockHeader: true});
    title().focus();
    title().value = 'Итоги';
    title().dispatch('keydown', {key: 'Enter', keyCode: 13});
    assert.deepEqual(used('Header', 'rename').map(c => c[2][0]), ['Итоги']);
    assert.deepEqual(used('Gateway', 'requestRename'), []);
});

check('title_follows_on_meta', () => {
    boot();
    fire('asc_onMeta', {title: 'Квартал.pptx'});
    assert.equal(title().value, 'Квартал');
    fire('asc_onMeta', {});
    assert.equal(title().value, 'Квартал', 'meta without a title changed the name');
    fire('asc_onDocumentName', 'Год.pptx');
    assert.equal(title().value, 'Год');
    /* an incoming name does not go back */
    title().focus();
    title().blur();
    assert.deepEqual(used('Gateway', 'requestRename'), []);
    /* typing in focus is not overwritten */
    title().focus();
    title().value = 'Мой набор';
    fire('asc_onMeta', {title: 'Чужое.pptx'});
    assert.equal(title().value, 'Мой набор');
    boot({canRename: false});
    fire('asc_onMeta', {title: 'Квартал.pptx'});
    assert.equal(title().textContent, 'Квартал');
});

check('save_state_reads_engine', () => {
    boot();
    const s = shell, st = state();
    assert.ok(st.classList.contains('saved'));
    assert.equal(st.getAttribute('title'), s.textSaved);
    assert.match(st.innerHTML, /vo-air/, '"Saved" is not the AIR check mark');
    modified = true;
    fire('asc_onDocumentModifiedChanged', true);
    assert.ok(st.classList.contains('dirty'), 'the modified flag of the engine is not shown');
    assert.equal(st.textContent, s.textUnsaved);
    fire('asc_onStartAction', 0, 1);
    assert.ok(st.classList.contains('dirty'), 'a non-save action changed the state');
    fire('asc_onStartAction', 0, 4);
    assert.ok(st.classList.contains('saving'));
    assert.equal(st.textContent, s.textSaving);
    assert.equal(st.getAttribute('aria-label'), s.textSaving);
    modified = false;
    fire('asc_onEndAction', 0, 4);
    assert.ok(st.classList.contains('saving'), '"Saving…" is not held after a short save');
    runHold();
    assert.ok(st.classList.contains('saved'), 'after the hold the engine is not read again');
    fire('asc_onStartAction', 0, 9);
    assert.ok(st.classList.contains('saving'), 'the forced save is not shown');
    /* the event argument flag is not read: only the engine */
    modified = false;
    fire('asc_onEndAction', 0, 9);
    runHold();
    fire('asc_onDocumentModifiedChanged', true);
    assert.ok(st.classList.contains('saved'), 'the event argument is read instead of the engine');
});

/* The header look is set by styles (compact-shell.less, comparison with documents is compact-parity.cjs);
   here are the classes they rely on: without them "Download" would bring back the border, and
   the switch and lists the former size. */
check('header_controls_carry_look_classes', () => {
    boot();
    const cls = e => e.className.split(/\s+/).filter(Boolean).sort().join(' ');
    const has = (e, ...c) => c.every(x => e.classList.contains(x));
    assert.ok(has(right(), 'vo-hd-right') && right().parentNode === one('vo-hd'), 'the cluster is not .vo-hd-right of .vo-hd');
    assert.equal(cls(one('vo-hd-history')), 'vo-hd-history vo-ib');
    assert.equal(cls(one('vo-hd-sharing')), 'vo-hd-sharing vo-ib vo-tinted');
    const dl = one('vo-download');
    assert.equal(cls(dl), 'vo-download vo-pop-wrap');
    const [dlBtn, dlPop] = dl.childNodes;
    assert.equal(dlBtn.localName, 'button');
    assert.equal(cls(dlBtn), 'vo-ib vo-outlined', '"Download" is not the bare icon button of the header styles');
    assert.match(dlBtn.innerHTML, /vo-air/, '"Download" has no AIR glyph');
    assert.ok(has(dlPop, 'vo-pop', 'vo-pop-list'), 'the download list is not .vo-pop.vo-pop-list');
    popItems(dl).forEach(row => assert.ok(one('vo-pop-i', row), 'a download row has no icon column'));
    const sw = one('vo-docmode');
    assert.equal(cls(sw), 'vo-docmode vo-pop-wrap');
    const [modeBtn, modePop] = sw.childNodes;
    assert.equal(cls(modeBtn), 'accent vo-mode');
    assert.ok(one('vo-mode-label', modeBtn) && one('vo-heading-caret', modeBtn), 'the switch has no label or caret');
    assert.ok(has(modePop, 'vo-pop', 'vo-pop-list', 'vo-pop-rich'), 'the mode list is not .vo-pop.vo-pop-list.vo-pop-rich');
    popItems(sw).forEach(row => {
        assert.ok(one('vo-pop-i', row) && one('vo-pop-t', row) && one('vo-pop-d', row) && one('vo-pop-check', row),
            'a mode row lacks its icon, two lines or check');
    });
    assert.ok(state().classList.contains('saved'));
    assert.match(state().innerHTML, /vo-air/, '"Saved" is not the AIR check mark');
});

check('header_switch_follows_vo_mode', () => {
    boot();
    const s = shell, modes = PE.Views.CompactModes;
    const sw = one('vo-docmode'), btn = sw.childNodes[0];
    const set = [];
    modes.setMode = m => set.push(m);
    assert.equal(one('vo-mode-label', sw).textContent, s.textModeEdit);
    assert.equal(btn.getAttribute('title'), s.textModeEditHint);
    btn.click();
    assert.ok(sw.classList.contains('open'));
    const view = popItems(sw).find(e => e.getAttribute('data-mode') === 'view');
    view.click();
    assert.deepEqual(set, ['view'], 'the switch does not call CompactModes.setMode');
    assert.equal(one('vo-mode-label', sw).textContent, s.textModeEdit, 'the look changed before vo:mode');
    context.Common.NotificationCenter.trigger('vo:mode', {mode: 'view'});
    assert.equal(one('vo-mode-label', sw).textContent, s.textModeView);
    assert.equal(btn.getAttribute('title'), s.textModeViewHint);
    assert.equal(view.getAttribute('aria-checked'), 'true');
    assert.ok(view.classList.contains('on'));
    context.Common.NotificationCenter.trigger('vo:mode', {mode: 'edit'});
    assert.equal(one('vo-mode-label', sw).textContent, s.textModeEdit);
    assert.equal(view.classList.contains('on'), false);
    /* opening one list closes another */
    btn.click();
    one('vo-download').childNodes[0].click();
    assert.equal(sw.classList.contains('open'), false, 'the mode list stays open with the download menu');
    doc.body.click();
    assert.equal(one('vo-download').classList.contains('open'), false, 'a click outside does not close the menu');
});

/* Version history and connection loss: stock puts the reason on its stack (Main.stackDisableActions) and
   sends editing:disable: the switch is locked like the stock document mode button, and
   unlocked together with the reason. The own "View" reason does not lock it. */
check('mode_switch_locked_under_stock_lock', () => {
    boot();
    const modes = PE.Views.CompactModes, nc = context.Common.NotificationCenter;
    const sw = one('vo-docmode'), btn = sw.childNodes[0];
    const view = () => popItems(sw).find(e => e.getAttribute('data-mode') === 'view');
    const set = [];
    modes.setMode = m => set.push(m);
    const stack = [];
    main.stackDisableActions = {length: () => stack.length, get: i => stack[i]};
    assert.notEqual(btn.getAttribute('aria-disabled'), 'true', 'the switch is locked without a reason');
    btn.click();
    assert.ok(sw.classList.contains('open'), 'the switch does not open before the lock');

    stack.push({type: 'disconnect', disable: true, options: {viewMode: true, toolbar: true}});
    nc.trigger('editing:disable', true, stack[0].options, 'disconnect');
    assert.ok(btn.classList.contains('vo-locked'), 'the switch is not locked by the stock lock');
    assert.equal(btn.getAttribute('aria-disabled'), 'true');
    assert.equal(sw.classList.contains('open'), false, 'the open list stays open under the lock');
    btn.click();
    btn.dispatch('keydown', {key: 'Enter'});
    assert.equal(sw.classList.contains('open'), false, 'the locked switch opens its list');
    view().click();
    shell.switchMode('view');
    assert.deepEqual(set, [], 'the locked switch changes the mode');
    assert.equal(one('vo-mode-label', sw).textContent, shell.textModeEdit, 'the locked switch lost the mode it shows');

    /* An own reason on top of a stock one does not unlock, without a stock one it does not lock. */
    stack.push({type: 'vo-view', disable: true, options: {viewMode: true, toolbar: true}});
    nc.trigger('editing:disable', true, stack[1].options, 'vo-view');
    assert.equal(btn.getAttribute('aria-disabled'), 'true', 'own «Просмотр» on top unlocks the switch');
    stack.splice(0, 1);
    nc.trigger('editing:disable', false, {viewMode: false}, 'disconnect');
    assert.equal(btn.getAttribute('aria-disabled'), 'false', 'own «Просмотр» locks the switch');
    assert.equal(btn.classList.contains('vo-locked'), false);
    btn.click();
    view().click();
    assert.deepEqual(set, ['view'], 'the switch does not work after the stock lock');

    /* A co-authoring loss (Main.onCoAuthoringDisconnect) does too. */
    boot();
    const b2 = one('vo-docmode').childNodes[0];
    main._state.isDisconnected = true;
    nc.trigger('api:disconnect');
    assert.equal(b2.getAttribute('aria-disabled'), 'true', 'the switch is not locked after the disconnect');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
