/* Run: node test/unit-tests/spreadsheeteditor/view-mode.cjs [path to CompactShell.js] [path to compact-shell.less]
 * The mode switch and "Viewing" of the spreadsheet editor "Compact" shell:
 * the "Editing / Viewing" switch in the header, rightmost, after "Download", looking like the Documents mode
 * buttons (AIR filled primary, a chevron, a list of two modes);
 * "Viewing" is a real input lock by the engine (asc_addRestriction(View)) plus the
 * standard editing:disable with its own reason type 'vo-view' and the spreadsheet editor Main.disableEditing
 * composition - the stock itself disables things; the return removes only its own reason and its own restriction bit.
 * In "Viewing" there is no panel row, the grid takes its height; search, download and print stay alive
 *. The right is a snapshot at the start (in "Viewing" the stock disables appOptions.isEdit), without the right
 * there is no switch at all, as in Documents; a click rechecks
 * the right and the lock. An open comments panel in "Viewing" stays - the stock
 * closes it (LeftMenu.SetDisabled → close), the shell opens it again in the comments "preview"
 * with a single grid recalculation; leaving for the Standard from "Viewing" removes its own
 * reason - the Standard does not show "Viewing" and has nothing to remove it with there. The mode buttons have
 * a state transition (background-color, color, box-shadow 0.15s): the styles are the real spreadsheet editor compact-shell.less in headless Chrome (playwright),
 * the hover is with a real mouse. The header "Download" list is the same shell surface as
 * the mode list.
 *
 * The stock here is real where it decides: Main.disableEditing (the composition of the restriction),
 * Main.onEditingDisable (the reason stack and restoring the others), LeftMenu.SetDisabled (what
 * is disabled for isEdit) - the text of the spreadsheet editor controllers, the stack is Common.IrregularStack. The shell
 * module is loaded in node via vm on top of a fake DOM (as side-panels.cjs).
 * The optional argument is a broken copy of the module for the negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const APP = path.join(ROOT, 'apps/spreadsheeteditor/main/app');
const VIEW = path.join(APP, 'view');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactShell.js');
const LESS = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/compact-shell.less');
const ICONS = path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js');
const MAIN = path.join(APP, 'controller/Main.js');
const LEFT_MENU = path.join(APP, 'controller/LeftMenu.js');
const STACK = path.join(ROOT, 'apps/common/IrregularStack.js');

/* A stock controller method as the text 'function (…) {…}' - by balanced braces. */
function readStock(src, name, where) {
    const head = name + ': function(';
    const start = src.indexOf(head);
    assert.ok(start >= 0, name + ' not found in ' + where);
    let depth = 0, end = src.indexOf('{', start);
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    return src.slice(start + name.length + 2, end + 1);
}
const MAIN_SRC = fs.readFileSync(MAIN, 'utf8');
const STOCK_DISABLE_EDITING = readStock(MAIN_SRC, 'disableEditing', 'controller/Main.js');
const STOCK_ON_EDITING_DISABLE = readStock(MAIN_SRC, 'onEditingDisable', 'controller/Main.js');
const STOCK_LEFT_SET_DISABLED = readStock(fs.readFileSync(LEFT_MENU, 'utf8'), 'SetDisabled', 'controller/LeftMenu.js');

/* The engine Asc.c_oAscRestrictionType (sdkjs/common/apiBase.js). */
const R = {None: 0x00, OnlyForms: 0x01, OnlyComments: 0x02, OnlySignatures: 0x04, View: 0x80};
/* The engine Asc.c_oAscAsyncActionType and Asc.c_oAscAsyncAction - those that come with a restriction. */
const AT = {Information: 0, BlockInteraction: 1};
const A = {Disconnect: 'Disconnect', BackgroundOpen: 'BackgroundOpen'};
const T = {RangeCells: 1, RangeCol: 2, RangeRow: 3, RangeMax: 4, RangeImage: 5, RangeChart: 6, RangeShape: 7,
    RangeSlicer: 8, RangeShapeText: 9, RangeChartText: 10, RangeFrozen: 11};
const D = {Paragraph: 0, Table: 1, Header: 2, TextArt: 3, Shape: 4, Image: 5, Slide: 6, Chart: 7, MailMerge: 8,
    Signature: 9, Pivot: 10, Cell: 11, Slicer: 12};

/* --- Fake DOM ---------------------------------------------------------------- */

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
        this.nodeType = 1;
        this.ownerDocument = doc;
        this.children = [];
        this.parentNode = null;
        this.attrs = {};
        this.style = {setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; }, getPropertyPriority() { return ''; }};
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
    get offsetWidth() { return 0; }
    get offsetHeight() { return 0; }
    getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}; }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    closest() { return null; }
    appendChild(c) { c.remove(); c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) {
        c.remove();
        c.parentNode = this;
        const i = ref ? this.children.indexOf(ref) : -1;
        if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
        return c;
    }
    replaceChild(c, old) {
        const i = this.children.indexOf(old);
        assert.ok(i >= 0, 'replaceChild: not a child');
        c.remove();
        this.children[i] = c;
        c.parentNode = this;
        old.parentNode = null;
        return old;
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

function matchSimple(el, s) {
    let m;
    if ((m = /^\[id\^="([^"]*)"\]$/.exec(s))) return el.id.indexOf(m[1]) === 0;
    if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(s))) return el.getAttribute(m[1]) === m[2];
    if (s[0] === '#') return el.id === s.slice(1);
    const parts = s.split('.');
    if (parts[0] && el.tagName !== parts[0].toUpperCase()) return false;
    return parts.slice(1).every(c => el.classList.contains(c));
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
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};
    return doc;
}

/* --- Fake stock --------------------------------------------------------------- */

function events() {
    const handlers = {};
    const fired = [];
    return {
        handlers, fired,
        on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
        off(name, fn) { const a = handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        trigger(name, ...args) { fired.push([name, ...args]); (handlers[name] || []).slice().forEach(fn => fn.apply(null, args)); }
    };
}

function layout(items) {
    return {
        layouts: 0,
        getItem(alias) { return items.find(p => p.alias === alias); },
        doLayout() { this.layouts++; }
    };
}

/* A ribbon button and the bridge root that has any btn*: a double is born on the first
   access (the editor ribbon is full). */
function button(ref, log) {
    const b = events();
    Object.assign(b, {disabled: false, pressed: false, visible: true, hidden: false, keepState: [], options: {lock: []}, cmpEl: [{}]});
    b.isDisabled = function () { return this.disabled; };
    b.setDisabled = function (v) { this.disabled = !!v; };
    b.click = function () { if (!this.disabled) log.push('click ' + ref); };
    return b;
}
function autoRoot(name, log, preset = {}) {
    const made = Object.assign({}, preset);
    return new Proxy(made, {
        get(t, k) {
            if (typeof k !== 'string') return t[k];
            if (!(k in t) && /^btn/.test(k)) {
                const ref = name + ':' + k;
                t[k] = /^btns/.test(k) ? [button(ref + '.0', log)] : button(ref, log);
            }
            return t[k];
        }
    });
}

function makeEnv(opt = {}) {
    const doc = makeDocument();
    const toolbarEl = doc.body.appendChild(new El('div', doc));
    toolbarEl.id = 'toolbar';
    const ribbon = toolbarEl.appendChild(new El('section', doc));
    ribbon.className = 'toolbar';
    const rightEl = doc.body.appendChild(new El('div', doc));
    rightEl.id = 'right-menu';

    const NC = events();
    const timers = [];
    const warnings = [];
    const stockLog = [];
    let current = {type: T.RangeCells, panes: [D.Cell]};

    const info = sel => ({
        asc_getSelectionType: () => sel.type,
        asc_getPivotTableInfo: () => null
    });
    /* The engine: the restrictions are a bit mask, as in baseEditorsApi (asc_addRestriction |=,
       asc_removeRestriction &= ~, canEdit - with no restrictions). */
    const api = {
        handlers: {}, calls: [], restrictions: 0,
        asc_registerCallback(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
        asc_unregisterCallback(name, fn) { const a = this.handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        sendEvent(name, ...args) { (this.handlers[name] || []).slice().forEach(fn => fn.apply(this, args)); },
        asc_addRestriction(v) { this.calls.push(['add', v]); this.restrictions |= v; },
        asc_removeRestriction(v) { this.calls.push(['remove', v]); this.restrictions &= ~v; },
        asc_setRestriction(v) { this.calls.push(['set', v]); this.restrictions = v; },
        canEdit() { return this.restrictions === R.None; },
        /* An engine action with a restriction (a connection loss, a background open) - as in baseEditorsApi
           (sdkjs common/apiBase.js: sync_StartAction/sync_EndAction with actionRestriction,
           increment/decrementCounterActionRestriction): on the first action the engine saves
           the current restrictions (IsActionRestrictionPrev) and sets its own, on the last it returns
           the saved ones. The action event goes before the counter (sendEvent('asc_onStartAction') /
           'asc_onEndAction'); the stock puts and removes its own reason on it (below). */
        IsActionRestrictionCurrent: 0, IsActionRestrictionPrev: null,
        isActionWithRestriction() { return this.IsActionRestrictionCurrent !== 0; },
        sync_StartAction(type, id, restr) {
            this.sendEvent('asc_onStartAction', type, id);
            if (restr === undefined) return;
            if (this.IsActionRestrictionCurrent === 0) {
                this.IsActionRestrictionPrev = this.restrictions;
                this.asc_setRestriction(restr);
            }
            ++this.IsActionRestrictionCurrent;
        },
        sync_EndAction(type, id, restr) {
            this.sendEvent('asc_onEndAction', type, id);
            if (restr === undefined) return;
            this.IsActionRestrictionCurrent = Math.max(0, this.IsActionRestrictionCurrent - 1);
            if (this.IsActionRestrictionCurrent === 0 && this.IsActionRestrictionPrev !== null) {
                this.asc_setRestriction(this.IsActionRestrictionPrev);
                this.IsActionRestrictionPrev = null;
            }
        },
        asc_isDocumentModified() { return false; },
        asc_getCellInfo() { return info(current); },
        asc_getActiveWorksheetIndex() { return 0; },
        resizes: 0,
        asc_Resize() { this.resizes++; },
        asc_setSkin() {}
    };

    const vlayout = layout([
        {alias: 'title', height: 28},
        {alias: 'toolbar', height: 92},
        {stretch: true},
        {alias: 'statusbar', height: 25}
    ]);
    const hlayout = layout([{alias: 'left'}, {stretch: true}, {alias: 'right'}]);
    const celayout = layout([{alias: 'celleditor'}, {stretch: true}]);

    const appOptions = Object.assign({spreadsheet: {title: 'Отчёт.xlsx'}, isEdit: true, canEdit: true,
        canCoAuthoring: true, canViewComments: true, canComments: true, canDownload: true, canPrint: true,
        canHelp: true}, opt.options || {});

    /* The stock left menu: the panel buttons and the real LeftMenu.SetDisabled. */
    const leftButton = name => ({
        name, pressed: false, options: {}, disabled: false,
        isDisabled() { return this.disabled; },
        setDisabled(v) { this.disabled = !!v; stockLog.push(name + (v ? ' disabled' : ' enabled')); },
        click() { if (this.disabled) return; this.pressed = !this.pressed; stockLog.push(name + (this.pressed ? ' open' : ' closed')); NC.trigger('layout:changed', 'leftmenu'); }
    });
    const fileMenu = {SetDisabled(d, o) { stockLog.push('file menu ' + d + ' ' + JSON.stringify(o)); }, applyMode() {}};
    const leftMenu = {
        btnSearchBar: leftButton('search'), btnComments: leftButton('comments'), btnChat: leftButton('chat'),
        btnSpellcheck: leftButton('spellcheck'), btnAbout: leftButton('about'), buttons: [],
        _state: {disabled: false},
        /* Like the standard LeftMenu.close: unpress the panel buttons and tell the layout. */
        close() {
            stockLog.push('left close');
            ['btnSearchBar', 'btnComments', 'btnChat', 'btnSpellcheck', 'btnAbout'].forEach(k => { leftMenu[k].pressed = false; });
            NC.trigger('layout:changed', 'leftmenu');
        },
        setDisabledPluginButtons() {},
        getMenu() { return fileMenu; },
        showMenu() {}
    };
    const lmCtl = {leftMenu, mode: appOptions, setPreviewMode(m) { stockLog.push('left preview ' + m); }};

    const clicks = [];
    const toolbarView = autoRoot('Toolbar', clicks, Object.assign(events(), {el: toolbarEl,
        cmbNumberFormat: button('Toolbar:cmbNumberFormat', clicks)}));
    const tab = name => ({view: autoRoot(name, clicks)});

    const rightView = Object.assign(events(), {
        minimizedMode: true, active: null, cellSettings: {}, mode: {isEdit: true, customization: {}},
        fireEvent(name, args) { this.trigger(name, args); },
        SetActivePane(type, open) {
            if (this.minimizedMode && open !== true) return;
            if (this.minimizedMode) { this.minimizedMode = false; NC.trigger('layout:changed', 'rightmenu'); }
            this.active = type;
        },
        GetActivePane() { return this.minimizedMode ? null : this.active; },
        clearSelection() { this.minimizedMode = true; this.active = null; NC.trigger('layout:changed', 'rightmenu'); }
    });
    Object.entries({btnText: D.Paragraph, btnImage: D.Image, btnShape: D.Shape, btnTextArt: D.TextArt, btnPivot: D.Pivot,
        btnCell: D.Cell, btnSlicer: D.Slicer}).forEach(([k, t]) => {
        rightView[k] = {asctype: t, isDisabled() { return current.panes.indexOf(t) < 0; }};
    });
    const rightCtl = {rightmenu: rightView, getView() { return rightView; },
        SetDisabled(d) { stockLog.push('right menu ' + d); }};

    const controllers = {
        RightMenu: rightCtl,
        Statusbar: {SetDisabled(s, t) { stockLog.push('statusbar ' + s + ' ' + t); }},
        'Common.Controllers.ReviewChanges': {view: autoRoot('Review', clicks), SetDisabled(s) { stockLog.push('review ' + s); }},
        DataTab: tab('DataTab'), ViewTab: tab('ViewTab'), WBProtection: tab('WBProtection'), PivotTable: tab('PivotTable'),
        FormulaDialog: {formulaTab: autoRoot('Formula', clicks)},
        Viewport: {viewport: {vlayout, hlayout, celayout}, getApi: () => api, SetDisabled() {}},
        Toolbar: {toolbar: toolbarView, api, btnsComment: [button('ToolbarCtl:btnsComment.0', clicks)],
            DisableToolbar(d, v) { stockLog.push('ribbon mask ' + d + ' viewMode ' + v); }},
        DocumentHolder: {clearSelection() {}, SetDisabled(s) { stockLog.push('context menu ' + s); }},
        LeftMenu: lmCtl,
        'Common.Controllers.Comments': {setPreviewMode(m) { stockLog.push('comments preview ' + m); }},
        CellEditor: {setPreviewMode(m) { stockLog.push('cell editor preview ' + m); }}
    };

    const main = {
        editorConfig: {ui: {shell: 'modern'}},
        appOptions,
        _state: {isDisconnected: false},
        headerView: null,
        getApplication() { return {getController: n => controllers[n]}; }
    };

    const SSE = {
        Views: {},
        getController(name) {
            if (name === 'Main') return main;
            return controllers[name];
        }
    };

    const context = {
        SSE,
        document: doc,
        /* The menu row snapshots all sections already at the start (section visibility): a missing menu item double is
           a catalog warning, this stock has no menu doubles. It is checked by roles-locks.cjs. */
        console: {warn: (...a) => { if (!/^Compact shell: stock control ".*" is missing, menu item/.test(String(a[0]))) warnings.push(a); }, log() {}, error() {}},
        setTimeout: fn => { timers.push(fn); return timers.length; },
        clearTimeout() {},
        Event: class { constructor(type) { this.type = type; } },
        URL,
        innerWidth: 1440, innerHeight: 900,
        _: {extend: Object.assign},
        Asc: {c_oAscSelectionType: T, c_oAscRestrictionType: R, c_oAscFileType: {XLSX: 257, PDF: 513, CSV: 260, ODS: 259}},
        Common: {
            NotificationCenter: NC,
            Utils: {documentSettingsType: D},
            UI: {LayoutManager: {isElementVisible: () => true}, Menu: {Manager: {hideAll() {}}}},
            localStorage: {getItem: () => null, setItem() {}, removeItem() {}, getBool: (k, d) => !!d, setBool() {}}
        },
        getComputedStyle: () => ({overflowX: 'visible', overflowY: 'visible', getPropertyValue: () => ''}),
        resizes: 0
    };
    context.window = context;
    context.dispatchEvent = ev => { if (ev && ev.type === 'resize') context.resizes++; return true; };
    context.onpointerdown = null;
    context.winListeners = [];
    context.addEventListener = (t, fn, capture) => { context.winListeners.push({t, fn, capture: capture === true || !!(capture && capture.capture)}); };
    context.removeEventListener = (t, fn, capture) => {
        const c = capture === true || !!(capture && capture.capture);
        context.winListeners = context.winListeners.filter(l => l.t !== t || l.fn !== fn || l.capture !== c);
    };
    context.fire = (type, ev) => {
        context.winListeners.filter(l => l.t === type && l.capture).slice().forEach(l => l.fn.call(context, ev));
    };
    vm.createContext(context);

    /* The stock reason stack and its handlers are real. */
    vm.runInContext(fs.readFileSync(STACK, 'utf8'), context, {filename: STACK});
    main.stackDisableActions = new context.Common.IrregularStack({
        strongCompare: (a, b) => a.type === b.type, weakCompare: (a, b) => a.type === b.type});
    main.disableEditing = vm.runInContext('(' + STOCK_DISABLE_EDITING + ')', context);
    main.onEditingDisable = vm.runInContext('(' + STOCK_ON_EDITING_DISABLE + ')', context);
    lmCtl.SetDisabled = vm.runInContext('(' + STOCK_LEFT_SET_DISABLED + ')', context);
    /* Main is subscribed to editing:disable in onLaunch - before the shell. */
    NC.on('editing:disable', (...a) => main.onEditingDisable(...a));
    /* Engine actions with a restriction: the stock puts its own reason at their start and removes it at the end
       (Main.setLongActionView / onLongActionEnd: Disconnect - 'reconnect', BackgroundOpen -
       'background-open'). */
    const ACTION_CAUSE = {[A.Disconnect]: 'reconnect', [A.BackgroundOpen]: 'background-open'};
    api.asc_registerCallback('asc_onStartAction', (type, id) => { if (ACTION_CAUSE[id]) main.disableEditing(true, ACTION_CAUSE[id]); });
    api.asc_registerCallback('asc_onEndAction', (type, id) => { if (ACTION_CAUSE[id]) main.disableEditing(false, ACTION_CAUSE[id]); });

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
    modules['common/main/lib/view/compact/Icons'] = load('common/main/lib/view/compact/Icons', ICONS);
    load('spreadsheeteditor/main/app/view/CompactShell', file);
    const shell = SSE.Views.CompactShell;

    const env = {
        shell, SSE, doc, NC, api, main, appOptions, vlayout, leftMenu, lmCtl, rightView, stockLog, timers, warnings, context,
        flush() { let n = 0; while (timers.length && n++ < 100) timers.shift()(); },
        create() { shell.create(); env.flush(); return env; },
        select(type, panes) {
            current = {type, panes};
            api.sendEvent('asc_onSelectionChanged', info(current));
            env.flush();
        },
        right() { return doc.querySelector('#vo-shell .vo-hd .vo-hd-right'); },
        modeWrap() { return doc.querySelector('#vo-shell .vo-hd .vo-docmode'); },
        modeButton() { return doc.querySelector('#vo-shell .vo-hd .vo-docmode .vo-mode'); },
        modeItem(v) { return doc.querySelector('#vo-shell .vo-docmode [data-mode="' + v + '"]'); },
        modeOpen() { const w = env.modeWrap(); return !!w && w.classList.contains('open'); },
        downloadWrap() { return doc.querySelector('#vo-shell .vo-hd .vo-download'); },
        downloadButton() { return doc.querySelector('#vo-shell .vo-hd .vo-download .vo-hd-download'); },
        downloadOpen() { const w = env.downloadWrap(); return !!w && w.classList.contains('open'); },
        /* Choosing a mode the way a human does it: the button, then a list row. */
        choose(v) {
            env.modeButton().click();
            assert.ok(env.modeOpen(), 'mode list did not open');
            env.modeItem(v).click();
            env.flush();
        },
        toolbarHeight() { return vlayout.getItem('toolbar').height; },
        shellEvents(name) { return NC.fired.filter(e => e[0] === name); },
        stackTypes() {
            const s = main.stackDisableActions, out = [];
            for (let i = 0; i < s.length(); i++) out.push(s.get(i).type);
            return out;
        },
        /* The rows of the layer of a composite item k of a section ("Download ▸" and
           others) by a real click on its row: {k: aria-disabled}; no holder - null. */
        kids(label, k) {
            shell.closeSurfaces();
            const btn = env.sectionButton(label);
            assert.ok(btn, 'no menu section ' + label);
            btn.click();
            const row = env.sectionRows(btn).find(r => r.getAttribute('data-k') === k);
            if (!row) { shell.closeSurfaces(); return null; }
            row.click();
            const out = {};
            doc.querySelectorAll('#vo-shell .vo-mn-fly .vo-mn-sub').filter(r => r.getAttribute('data-k')).forEach(r => {
                out[r.getAttribute('data-k')] = r.getAttribute('aria-disabled') === 'true';
            });
            shell.closeSurfaces();
            return out;
        },
        /* A menu row section and its rows: {k: aria-disabled}. */
        section(label) {
            shell.closeSurfaces();
            const btn = env.sectionButton(label);
            assert.ok(btn, 'no menu section ' + label);
            btn.click();
            const out = {};
            env.sectionRows(btn).forEach(r => { out[r.getAttribute('data-k')] = r.getAttribute('aria-disabled') === 'true'; });
            shell.closeSurfaces();
            return out;
        },
        /* The menu row section buttons (the shared row: the "…" of a narrow window is also a button, it has no data-k). */
        sectionButtons() { return doc.querySelectorAll('#vo-shell .vo-mn-item').filter(b => b.getAttribute('data-k') !== null); },
        sectionButton(label) { return env.sectionButtons().find(b => b.textContent === label) || null; },
        /* The section list rows (without the rows of its submenu). */
        sectionRows(btn) {
            const drop = btn.parentNode.querySelector('.vo-mn-drop');
            return drop.descendants().filter(r => r.getAttribute('data-k') !== null && r.closest('.vo-mn-drop') === drop);
        },
        menuOpen() { return shell.menu.isOpen(); }
    };
    return env;
}

/* --- Run ------------------------------------------------------------------- */

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

const noWarnings = env => assert.equal(env.warnings.length, 0, 'unexpected warnings: ' +
    JSON.stringify(env.warnings.map(w => String(w[0]) + ' ' + String(w[1] && w[1].stack || w[1]))));

/* The stock restriction composition: the spreadsheet editor Main.disableEditing, as the stock hands it out. */
function stockPayload(disable, type) {
    const fired = [];
    const ctx = {Common: {NotificationCenter: {trigger: (...a) => fired.push(a)}}};
    vm.createContext(ctx);
    const fn = vm.runInContext('(' + STOCK_DISABLE_EDITING + ')', ctx);
    fn.call({}, disable, type);
    assert.equal(fired.length, 1, 'stock disableEditing did not trigger editing:disable once');
    return JSON.parse(JSON.stringify(fired[0][2]));
}

/* The paths of an object's leaves: 'a.b' → the value. */
function leaves(o, prefix = '', out = {}) {
    Object.keys(o).forEach(k => {
        const v = o[k], p = prefix ? prefix + '.' + k : k;
        if (v && typeof v === 'object') leaves(v, p, out); else out[p] = v;
    });
    return out;
}

test('mode_switch_rightmost_in_header_after_download', () => {
    const env = makeEnv().create();
    const right = env.right();
    assert.ok(right, 'no right cluster in the header');
    const kids = right.children, n = kids.length;
    assert.ok(n >= 2 && kids[n - 1].classList.contains('vo-docmode'), 'the mode switch is not the last (rightmost) in the right cluster');
    assert.ok(kids[n - 2].classList.contains('vo-download'), '«Download» does not stand right before the mode switch');
    const btn = env.modeButton();
    assert.ok(btn.classList.contains('vo-mode') && btn.classList.contains('accent'), 'switch is not AIR filled primary (.vo-mode.accent)');
    assert.ok(btn.querySelector('.vo-heading-caret'), 'no chevron on the switch');
    assert.equal(btn.textContent, env.shell.textModeEdit, 'editor starts in «Editing»');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    const items = env.modeWrap().querySelectorAll('.vo-pop-item');
    assert.deepEqual(items.map(i => i.getAttribute('data-mode')), ['edit', 'view'], 'modes and their order');
    assert.deepEqual(items.map(i => i.querySelector('.vo-pop-t').textContent), [env.shell.textModeEdit, env.shell.textModeView]);
    assert.deepEqual(items.map(i => i.querySelector('.vo-pop-d').textContent), [env.shell.textModeEditHint, env.shell.textModeViewHint]);
    assert.deepEqual(items.map(i => i.getAttribute('aria-checked')), ['true', 'false'], 'current mode is not checked');
    assert.ok(items.every(i => i.querySelector('.vo-pop-check')), 'no check mark slot');
    noWarnings(env);
});

test('view_adds_restriction_and_stock_lock', () => {
    const env = makeEnv().create();
    assert.equal(env.toolbarHeight(), 132, 'editor shell rows');
    env.choose('view');
    assert.deepEqual(env.api.calls, [['add', R.View]], 'engine restriction View is not added once');
    assert.equal(env.api.canEdit(), false, 'engine still accepts input');
    const own = env.shellEvents('editing:disable');
    assert.equal(own.length, 1, 'one stock editing:disable');
    assert.equal(own[0][1], true);
    assert.equal(own[0][3], 'vo-view', 'own cause type');
    assert.deepEqual(env.stackTypes(), ['vo-view'], 'stock stack does not hold the own cause');
    /* What the stock itself disables: the ribbon under a mask, the context menu, the right panel, the sheet row, the left menu. */
    ['ribbon mask true viewMode true', 'context menu true', 'right menu true', 'statusbar true vo-view', 'left preview true']
        .forEach(s => assert.ok(env.stockLog.includes(s), 'stock did not lock: ' + s + ' — ' + JSON.stringify(env.stockLog)));
    assert.equal(env.appOptions.isEdit, false, 'stock LeftMenu.SetDisabled did not run');
    assert.ok(env.doc.body.classList.contains('vo-view'), 'no body class vo-view');
    assert.equal(env.toolbarHeight(), 76, 'the grid did not take the toolbar row');
    assert.equal(env.modeButton().textContent, env.shell.textModeView, 'switch label');
    assert.equal(env.modeItem('view').getAttribute('aria-checked'), 'true');
    assert.equal(env.modeOpen(), false, 'mode list stays open after the choice');
    assert.ok(env.doc.querySelector('#vo-shell .vo-mn'), 'menu bar is gone in view');
    noWarnings(env);
});

test('edit_removes_only_own_reason', () => {
    const env = makeEnv().create();
    /* A foreign engine restriction (signatures) lives its own life. */
    env.api.restrictions |= R.OnlySignatures;
    env.choose('view');
    /* The connection was lost on top of "Viewing": a foreign reason is on top of the stack - switching is not allowed. */
    env.main.disableEditing(true, 'reconnect');
    assert.deepEqual(env.stackTypes(), ['vo-view', 'reconnect']);
    assert.equal(env.modeButton().classList.contains('vo-locked'), true, 'switch is not locked under a foreign cause');
    assert.equal(env.modeButton().getAttribute('aria-disabled'), 'true');
    env.modeButton().click();
    assert.equal(env.modeOpen(), false, 'locked switch opened its list');
    assert.equal(env.shell.setSheetMode('edit'), false, 'mode switched under a foreign cause');
    /* The connection returned: the stock removed its own reason and restored ours (prev_options). */
    env.main.disableEditing(false, 'reconnect');
    assert.deepEqual(env.stackTypes(), ['vo-view'], 'stock did not keep the own cause');
    assert.equal(env.api.canEdit(), false, 'view was lost with the foreign cause');
    assert.equal(env.modeButton().classList.contains('vo-locked'), false, 'switch stays locked');
    env.choose('edit');
    assert.deepEqual(env.api.calls, [['add', R.View], ['remove', R.View]], 'engine calls');
    assert.equal(env.api.restrictions, R.OnlySignatures, 'a foreign engine restriction was removed');
    const own = env.shellEvents('editing:disable').filter(e => e[3] === 'vo-view');
    assert.equal(own.length, 2);
    assert.equal(own[1][1], false, 'own cause is not removed');
    assert.equal(own[1][2].viewMode, false, 'viewMode follows disable, as in stock disableEditing(false)');
    assert.deepEqual(env.stackTypes(), [], 'stock stack is not empty');
    assert.equal(env.stockLog[env.stockLog.length - 1] === undefined, false);
    assert.ok(env.stockLog.lastIndexOf('ribbon mask false viewMode false') > env.stockLog.lastIndexOf('ribbon mask true viewMode true'),
        'stock ribbon is left masked');
    assert.equal(env.appOptions.isEdit, true, 'stock did not return isEdit');
    assert.equal(env.doc.body.classList.contains('vo-view'), false);
    assert.equal(env.toolbarHeight(), 132, 'toolbar row did not come back');
    noWarnings(env);
});

test('no_switch_without_edit_right', () => {
    /* A reader: there is no switch at all, as in Documents; the workbook is in "Viewing". A boolean, not
       a node: an assert message about a fake node would unfold the whole DOM. */
    const reader = makeEnv({options: {isEdit: false, canEdit: false}}).create();
    assert.equal(!!reader.modeWrap(), false, 'reader has a mode switch');
    assert.equal(!!reader.modeButton(), false, 'reader has a mode button');
    assert.equal(!!reader.doc.querySelector('#vo-shell .vo-hd .vo-mode'), false, 'reader has a .vo-mode in the header');
    assert.equal(reader.shell.modeUi, null, 'reader switch state is kept');
    assert.equal(reader.modeOpen(), false);
    assert.equal(reader.shell.setSheetMode('edit'), false, 'reader switched to editing');
    assert.equal(reader.shell.setSheetMode('view'), false);
    assert.deepEqual(reader.api.calls, [], 'engine restriction touched without the right');
    assert.equal(reader.shellEvents('editing:disable').length, 0, 'stock lock touched without the right');
    assert.ok(reader.doc.body.classList.contains('vo-view'), 'reader is not in view');
    assert.equal(reader.toolbarHeight(), 76, 'reader rows');
    noWarnings(reader);

    /* The right is a snapshot: in "Viewing" the stock disables appOptions.isEdit, and going back is possible. */
    const editor = makeEnv().create();
    editor.choose('view');
    assert.equal(editor.appOptions.isEdit, false);
    editor.choose('edit');
    assert.equal(editor.api.canEdit(), true, 'snapshot right did not allow the way back');

    /* A standard loss of rights resets the snapshot: there is no switch, as for a reader. */
    const lost = makeEnv().create();
    lost.modeButton().click();
    assert.ok(lost.modeOpen(), 'precondition: the mode list is open');
    lost.NC.trigger('collaboration:sharingdeny');
    assert.equal(!!lost.modeWrap(), false, 'switch still offers editing after the rights are lost');
    assert.equal(lost.shell.modeUi, null, 'switch state is kept after the rights are lost');
    assert.equal(lost.shell.hasOpenSurfaces(), false, 'the mode list of the removed switch is still a surface');
    assert.ok(lost.downloadWrap(), '«Download» was removed with the switch');
    assert.equal(lost.shell.setSheetMode('view'), false, 'mode switched after the rights are lost');
    assert.deepEqual(lost.api.calls, []);

    /* A start during a standard reason (a background open disables isEdit): the right is from what the stock saved. */
    const late = makeEnv();
    late.main.disableEditing(true, 'background-open');
    assert.equal(late.appOptions.isEdit, false);
    late.create();
    assert.ok(late.modeButton().querySelector('.vo-heading-caret'), 'editor taken for a reader when started under a stock cause');
    assert.equal(late.modeButton().classList.contains('vo-locked'), true, 'switch is not locked under the stock cause');
    late.main.disableEditing(false, 'background-open');
    assert.equal(late.modeButton().classList.contains('vo-locked'), false);
    late.choose('view');
    assert.equal(late.api.canEdit(), false);
});

test('view_options_keys_match_stock_disable_editing', () => {
    const env = makeEnv();
    /* The own values are only these, and each must differ from the stock's. */
    const INTENDED = {
        'comments.disable': 'reading comments is not editing: the panel stays, previewMode as in documents «Viewing»',
        'chat': 'chat is not editing'
    };
    for (const disable of [true, false]) {
        const stock = leaves(stockPayload(disable, 'disconnect'));
        const ours = leaves(JSON.parse(JSON.stringify(env.shell.viewOptions(disable))));
        assert.deepEqual(Object.keys(ours).sort(), Object.keys(stock).sort(),
            'composition differs from stock disableEditing(' + disable + ')');
        Object.keys(stock).forEach(k => {
            if (INTENDED[k]) {
                assert.notEqual(ours[k], stock[k], k + ' is listed as intended but equals stock');
                return;
            }
            assert.equal(ours[k], stock[k], k + ' differs from stock disableEditing(' + disable + ')');
        });
    }
    /* viewMode follows disable - otherwise DisableToolbar leaves the ribbon under a mask. */
    assert.equal(env.shell.viewOptions(true).viewMode, true);
    assert.equal(env.shell.viewOptions(false).viewMode, false);
});

test('view_keeps_search_download_print', () => {
    const env = makeEnv().create();
    env.choose('view');
    const o = env.shell.viewOptions(true);
    assert.equal(o.shortcuts, false, 'stock shortcuts (Ctrl+F, Ctrl+P) suspended');
    assert.equal(o.header.search, false, 'stock search is locked');
    assert.equal(o.fileMenu.protect, true);
    assert.equal(env.leftMenu.btnSearchBar.disabled, false, 'stock search panel button is disabled in view');
    assert.equal(env.leftMenu.btnComments.disabled, false, 'comments panel button is disabled in view');
    const file = env.section(env.SSE.Views.SheetActions.textFile);
    /* The download formats are in "Download ▸" ("Download ▸" is alive in
       "Viewing"): the holder and its rows. */
    ['download', 'print'].forEach(k => {
        assert.ok(k in file, k + ' is not in «File» in view');
        assert.equal(file[k], false, k + ' is inactive in view');
    });
    const formats = env.kids(env.SSE.Views.SheetActions.textFile, 'download');
    ['downloadXlsx', 'downloadPdf', 'downloadCsv', 'downloadOds'].forEach(k => {
        assert.ok(k in formats, k + ' is not in «File → Download ▸» in view');
        assert.equal(formats[k], false, k + ' is inactive in view');
    });
    const edit = env.section(env.SSE.Views.SheetActions.textEdit);
    assert.equal(edit.findReplace, false, '«Find and replace» is inactive in view');
    noWarnings(env);
});

/* In "Viewing" "Copy" is available, "Cut" and "Paste" are not
   ("Edit", new items): copying does not change the workbook, the engine does not perform cutting and pasting without editing. */
test('view_keeps_copy_not_cut_paste', () => {
    const env = makeEnv().create();
    const before = env.section(env.SSE.Views.SheetActions.textEdit);
    ['cut', 'copy', 'paste'].forEach(k => assert.equal(before[k], false, k + ' is not in «Edit» or inactive in «Editing»'));
    env.choose('view');
    const edit = env.section(env.SSE.Views.SheetActions.textEdit);
    assert.equal(edit.copy, false, '«Copy» is not live in «Viewing»');
    assert.equal(edit.cut, true, '«Cut» is live in «Viewing»');
    assert.equal(edit.paste, true, '«Paste» is live in «Viewing»');
    noWarnings(env);
});

test('mode_list_is_one_of_the_shell_surfaces', () => {
    const env = makeEnv().create();
    const ev = {key: 'Escape', keyCode: 27, prevented: 0, stopped: 0,
        preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }};
    env.modeButton().click();
    assert.equal(env.shell.hasOpenSurfaces(), true, 'open mode list is not a surface');
    env.context.fire('keydown', ev);
    assert.equal(env.modeOpen(), false, 'Escape did not close the mode list');
    assert.equal(ev.prevented, 1, 'Escape went further than the list');
    /* A repeated click on the button closes the list, a click outside does too. */
    env.modeButton().click();
    env.modeButton().click();
    assert.equal(env.modeOpen(), false, 'second click did not close the list');
    env.modeButton().click();
    env.context.fire('pointerdown', {target: env.modeItem('view')});
    assert.equal(env.modeOpen(), true, 'press inside the list closed it');
    env.context.fire('pointerdown', {target: env.doc.body});
    assert.equal(env.modeOpen(), false, 'click outside did not close the list');
    /* Opening a menu row section closes the mode list - the surfaces do not live at the same time. */
    env.modeButton().click();
    env.sectionButtons()[0].click();
    assert.equal(env.modeOpen(), false, 'menu section opened over the mode list');
    env.shell.closeSurfaces();
    env.modeButton().click();
    env.sectionButtons()[0].click();
    env.modeButton().click();
    assert.equal(env.menuOpen(), false, 'mode list opened over a menu section');
    noWarnings(env);
});

test('download_menu_is_one_of_the_shell_surfaces', () => {
    const env = makeEnv().create();
    const ev = {key: 'Escape', keyCode: 27, prevented: 0, stopped: 0,
        preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }};
    env.downloadButton().click();
    assert.equal(env.downloadOpen(), true, 'precondition: the button opened the list');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'open «Download» list is not a surface');
    env.context.fire('keydown', ev);
    assert.equal(env.downloadOpen(), false, 'Escape did not close the «Download» list');
    assert.equal(ev.prevented, 1, 'Escape went further than the list');
    assert.equal(ev.stopped, 1, 'Escape went further than the list');
    assert.equal(env.shell.hasOpenSurfaces(), false);
    /* A repeated click on the button closes the list, a click outside does too, a press inside does not. */
    env.downloadButton().click();
    env.downloadButton().click();
    assert.equal(env.downloadOpen(), false, 'second click did not close the list');
    env.downloadButton().click();
    env.context.fire('pointerdown', {target: env.downloadWrap().querySelector('[data-k="downloadPdf"]')});
    assert.equal(env.downloadOpen(), true, 'press inside the list closed it');
    env.context.fire('pointerdown', {target: env.downloadButton()});
    assert.equal(env.downloadOpen(), true, 'press on the button closed the list before its click');
    env.context.fire('pointerdown', {target: env.doc.body});
    assert.equal(env.downloadOpen(), false, 'click outside did not close the list');
    /* A menu row section and the mode list close "Download", and it closes them. */
    env.downloadButton().click();
    env.sectionButtons()[0].click();
    assert.equal(env.downloadOpen(), false, 'menu section opened over the «Download» list');
    env.downloadButton().click();
    assert.equal(env.menuOpen(), false, '«Download» list opened over a menu section');
    assert.equal(env.downloadOpen(), true);
    env.modeButton().click();
    assert.equal(env.downloadOpen(), false, 'mode list opened over the «Download» list');
    assert.equal(env.modeOpen(), true);
    env.downloadButton().click();
    assert.equal(env.modeOpen(), false, '«Download» list opened over the mode list');
    assert.equal(env.downloadOpen(), true);
    /* Focus mode hides the header - the list is closed. */
    env.shell.setChrome({focus: true});
    assert.equal(env.downloadOpen(), false, 'focus mode left the «Download» list open');
    env.shell.setChrome({focus: false});
    noWarnings(env);
});

test('view_hides_right_panel_and_returns_it', () => {
    const env = makeEnv().create();
    env.select(T.RangeImage, [D.Shape, D.Image]);
    assert.ok(env.doc.body.classList.contains('vo-right-open'), 'precondition: image opens the right panel');
    env.choose('view');
    assert.equal(env.doc.body.classList.contains('vo-right-open'), false, 'right panel stays in view');
    env.select(T.RangeShape, [D.Shape]);
    assert.equal(env.doc.body.classList.contains('vo-right-open'), false, 'right panel opened in view');
    env.choose('edit');
    env.flush();
    assert.ok(env.doc.body.classList.contains('vo-right-open'), 'right panel decision is lost after view');
    noWarnings(env);
});

test('switch_locked_on_lost_connection', () => {
    const env = makeEnv().create();
    env.main._state.isDisconnected = true;
    env.NC.trigger('api:disconnect');
    assert.equal(env.modeButton().classList.contains('vo-locked'), true, 'switch is not locked after api:disconnect');
    env.modeButton().click();
    assert.equal(env.modeOpen(), false, 'locked switch opened');
    assert.equal(env.shell.setSheetMode('view'), false);
    assert.deepEqual(env.api.calls, []);
    /* Disconnect from the engine: Main updates the state in the same delivery - the view is recalculated after it. */
    const late = makeEnv().create();
    late.api.sendEvent('asc_onCoAuthoringDisconnect');
    late.main._state.isDisconnected = true;
    late.flush();
    assert.equal(late.modeButton().classList.contains('vo-locked'), true, 'switch is not locked after the engine disconnect');
    noWarnings(env);
});

test('view_keeps_open_comments_panel', () => {
    /* The comments panel stays in "Viewing". On entering the
       restriction the stock closes the left panel (LeftMenu.SetDisabled → close), but comments can be read
       (comments.disable false - the panel button is alive): the shell opens the panel again with the standard
       button - already in the stock comments "preview" (without adding and replies). The grid
       is recalculated once for the whole transition. */
    const env = makeEnv().create();
    /* The standard Viewport.onLayoutChanged: each layout:changed is a grid recalculation by the engine. */
    env.NC.on('layout:changed', () => env.api.asc_Resize());
    /* The panel is the "Collaboration → Comments" item (there is no comments button in the header). */
    env.sectionButton(env.SSE.Views.SheetActions.textCollaboration).click();
    const row = env.doc.querySelector('[data-k="comments"]');
    assert.ok(row, 'precondition: no «Collaboration → Comments» row');
    row.click();
    env.flush();
    assert.equal(env.leftMenu.btnComments.pressed, true, 'precondition: comments panel is open');
    assert.ok(env.doc.body.classList.contains('vo-left-open'), 'precondition: left area is shown');
    env.stockLog.length = 0;
    env.api.resizes = 0;
    env.choose('view');
    assert.ok(env.stockLog.includes('left close'), 'precondition: the stock closed the left panel on view');
    assert.equal(env.leftMenu.btnComments.pressed, true, 'comments panel was closed by view (the shell keeps it)');
    assert.ok(env.doc.body.classList.contains('vo-left-open'), 'left area is hidden in view');
    const preview = env.stockLog.indexOf('comments preview true'), reopen = env.stockLog.lastIndexOf('comments open');
    assert.ok(preview >= 0 && reopen > preview, 'comments panel did not reopen after the stock comments preview: ' + JSON.stringify(env.stockLog));
    assert.ok(env.stockLog.indexOf('left close') < reopen, 'reopen went before the stock close');
    assert.equal(env.api.resizes, 1, 'grid recalculated ' + env.api.resizes + ' times on the way to view');
    /* Back: the panel is in place, the stock does not touch it. */
    env.choose('edit');
    assert.equal(env.leftMenu.btnComments.pressed, true, 'comments panel was closed on the way back');
    /* A closed panel is not opened by "Viewing". */
    const closed = makeEnv().create();
    closed.choose('view');
    assert.equal(closed.leftMenu.btnComments.pressed, false, 'view opened a closed comments panel');
    assert.equal(closed.doc.body.classList.contains('vo-left-open'), false);
    /* Another panel (search) is open - the stock closes it, as before; comments are not opened. */
    const search = makeEnv().create();
    search.leftMenu.btnSearchBar.click();
    search.choose('view');
    assert.equal(search.leftMenu.btnComments.pressed, false, 'view opened comments instead of the search panel');
    noWarnings(env);
    noWarnings(closed);
    noWarnings(search);
});

test('advanced_from_view_drops_own_cause', () => {
    /* "Viewing" is a compact mode. The Standard does not show it and has nothing to remove it with there: the ribbon
       is under a mask of its own reason. Switching the interface removes
       its own reason and its own engine restriction bit the same way as "Editing"; after
       the return the switch is "Editing", the panel row is in place. */
    const env = makeEnv().create();
    env.choose('view');
    assert.deepEqual(env.stackTypes(), ['vo-view'], 'precondition: own cause');
    env.shell.toggleMode();
    env.flush();
    assert.ok(env.doc.body.classList.contains('vo-advanced'), 'precondition: standard interface');
    assert.deepEqual(env.stackTypes(), [], 'own cause stays in the stock stack in the standard interface');
    assert.equal(env.api.restrictions & R.View, 0, 'engine View restriction stays in the standard interface');
    assert.equal(env.api.canEdit(), true, 'the engine still refuses input in the standard interface');
    assert.ok(env.stockLog.lastIndexOf('ribbon mask false viewMode false') > env.stockLog.lastIndexOf('ribbon mask true viewMode true'),
        'stock ribbon is left under the mask in the standard interface');
    assert.equal(env.appOptions.isEdit, true, 'stock did not return isEdit');
    assert.equal(env.doc.body.classList.contains('vo-view'), false, 'body keeps vo-view in the standard interface');
    const own = env.shellEvents('editing:disable').filter(e => e[3] === 'vo-view');
    assert.deepEqual(own.map(e => e[1]), [true, false], 'own cause is not removed once');
    assert.equal(own[1][2].viewMode, false);
    /* The return: "Editing", the panel row, no new reasons. */
    env.shell.toggleMode();
    env.flush();
    assert.equal(env.doc.body.classList.contains('vo-advanced'), false);
    assert.equal(env.modeButton().textContent, env.shell.textModeEdit, 'switch is not «Editing» after the standard interface');
    assert.equal(env.modeItem('edit').getAttribute('aria-checked'), 'true');
    assert.equal(env.toolbarHeight(), 132, 'toolbar row did not come back');
    assert.equal(env.shellEvents('editing:disable').filter(e => e[3] === 'vo-view').length, 2, 'return added a cause');
    noWarnings(env);

    /* A foreign reason on top of "Viewing" (connection lost): our own is removed from under it, the foreign one
       stays - the stock restores the top of the stack; when the connection returns, it is editing, not
       "Viewing", which cannot be removed in the Standard. */
    const under = makeEnv().create();
    under.choose('view');
    under.main.disableEditing(true, 'reconnect');
    under.shell.toggleMode();
    assert.deepEqual(under.stackTypes(), ['reconnect'], 'own cause stays under a foreign one');
    assert.equal(under.api.restrictions & R.View, 0, 'engine View restriction stays under a foreign cause');
    assert.ok(under.stockLog.lastIndexOf('ribbon mask true viewMode true') > under.stockLog.lastIndexOf('ribbon mask false viewMode false'),
        'the foreign cause lost its ribbon mask');
    under.main.disableEditing(false, 'reconnect');
    assert.deepEqual(under.stackTypes(), []);
    assert.equal(under.appOptions.isEdit, true);
    noWarnings(under);

    /* Editing and a reader: into the Standard - without requests to the engine and the stack. */
    for (const opt of [{}, {options: {isEdit: false, canEdit: false}}]) {
        const e = makeEnv(opt).create();
        e.shell.toggleMode();
        assert.deepEqual(e.api.calls, [], 'engine restriction touched on the way to the standard interface');
        assert.equal(e.shellEvents('editing:disable').length, 0, 'stock lock touched on the way to the standard interface');
        noWarnings(e);
    }
});

test('advanced_from_view_under_engine_action_returns_editing', () => {
    /* Leaving for the Standard under an engine action with a restriction: a connection loss and
       a background open go in the engine with their own restriction - sync_StartAction(Information, …, View).
       While the action lasts, the current restrictions are its own, and the shell "Viewing" bit lies in
       the saved ones (IsActionRestrictionPrev), which the engine will return on sync_EndAction. Leaving for the
       Standard removes its own bit there: removed from the current ones, it would come back with the restore - the stock and
       the shell would show editing (the stack is empty, no mask, "Editing"), while the input would silently go
       nowhere. The engine own restriction stays while the action lasts. */
    for (const [id, cause] of [[A.Disconnect, 'reconnect'], [A.BackgroundOpen, 'background-open']]) {
        const env = makeEnv().create();
        env.choose('view');
        env.api.sync_StartAction(AT.Information, id, R.View);
        assert.deepEqual(env.stackTypes(), ['vo-view', cause], 'precondition: engine cause on top of own view (' + id + ')');
        assert.equal(env.api.IsActionRestrictionPrev & R.View, R.View, 'precondition: engine saved own view (' + id + ')');
        env.shell.toggleMode();
        env.flush();
        assert.ok(env.doc.body.classList.contains('vo-advanced'), 'precondition: standard interface (' + id + ')');
        assert.deepEqual(env.stackTypes(), [cause], 'own cause stays under the engine cause (' + id + ')');
        assert.equal(env.api.restrictions & R.View, R.View, 'the engine restriction of its own action was removed while it lasts (' + id + ')');
        assert.equal(env.api.canEdit(), false, 'input is open while the engine action lasts (' + id + ')');
        assert.equal(env.api.IsActionRestrictionPrev & R.View, 0, 'own view stays in the engine saved restrictions (' + id + ')');
        /* The action ended: the engine returned the saved ones - editing, as the interface says. */
        env.api.sync_EndAction(AT.Information, id, R.View);
        env.flush();
        assert.deepEqual(env.stackTypes(), [], 'stock stack after the engine action (' + id + ')');
        assert.equal(env.appOptions.isEdit, true, 'stock did not return isEdit (' + id + ')');
        assert.equal(env.api.restrictions & R.View, 0, 'the engine restored own «View» after its action: the UI says editing, input goes nowhere (' + id + ')');
        assert.equal(env.api.canEdit(), true, 'the engine refuses input after its action (' + id + ')');
        /* The return to the compact: "Editing", and the engine agrees with it. */
        env.shell.toggleMode();
        env.flush();
        assert.equal(env.modeButton().textContent, env.shell.textModeEdit, 'switch after the standard interface (' + id + ')');
        assert.equal(env.api.canEdit(), true, 'the engine refuses input under «Editing» (' + id + ')');
        assert.equal(env.toolbarHeight(), 132, 'toolbar row did not come back (' + id + ')');
        noWarnings(env);
    }

    /* The connection returned while the shell is still in the Standard, and then "Viewing" again → a loss → the Standard:
       the value saved by the engine is its own every time - the removal does not stick. */
    const twice = makeEnv().create();
    for (let i = 0; i < 2; i++) {
        if (twice.doc.body.classList.contains('vo-advanced')) { twice.shell.toggleMode(); twice.flush(); }
        twice.choose('view');
        twice.api.sync_StartAction(AT.Information, A.Disconnect, R.View);
        twice.shell.toggleMode();
        twice.api.sync_EndAction(AT.Information, A.Disconnect, R.View);
        assert.equal(twice.api.canEdit(), true, 'round ' + (i + 1) + ': engine refuses input after the reconnect');
    }
    noWarnings(twice);

    /* A control of the engine model: in the compact "Viewing" survives a loss - the engine returns its bit,
       the switch and the stack are "Viewing". */
    const stay = makeEnv().create();
    stay.choose('view');
    stay.api.sync_StartAction(AT.Information, A.Disconnect, R.View);
    assert.equal(stay.shell.setSheetMode('edit'), false, 'switch is not locked under the engine cause');
    stay.api.sync_EndAction(AT.Information, A.Disconnect, R.View);
    stay.flush();
    assert.deepEqual(stay.stackTypes(), ['vo-view'], 'own view lost over the reconnect');
    assert.equal(stay.api.restrictions & R.View, R.View, 'engine lost own view over the reconnect');
    assert.equal(stay.modeButton().textContent, stay.shell.textModeView);
    noWarnings(stay);
});

/* The mode button has the editor switch and the return-from-Standard button (the shared
   .vo-mode) - a state transition, as in .vo-ib, .vo-mode…
   (background-color, color, box-shadow 0.15s ease-out; the literal below). Hovering
   with a real mouse starts the background transition (getAnimations); under "reduce motion" there is neither a transition
   nor animations, the hover look is the same. The markup is from the shell itself (buildModeSwitch, the return button). */
async function modeButtonTransition() {
    const EXPECTED = {property: 'background-color, color, box-shadow', duration: '0.15s, 0.15s, 0.15s', timing: 'ease-out, ease-out, ease-out'};
    let chromium;
    try { ({chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
    catch (e) { throw new Error('playwright is not available (set NODE_PATH or PLAYWRIGHT_MODULE): ' + e.message); }
    const less = require(path.join(ROOT, 'build/node_modules/less'));
    /* The styles layer is as in app.less: the shared shell files (tokens.less, menu.less) and compact-shell.less. */
    const layer = require('./lib/compact-less.cjs');
    const css = (await less.render(layer.source(LESS),
        {filename: layer.APP_LESS, globalVars: {'app-image-const-path': '"resources/img"'}})).css;
    const buttons = {editor: makeEnv().create().modeButton().className, back: 'vo-mode'};
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    try {
        const page = await browser.newPage({viewport: {width: 700, height: 200}});
        await page.setContent(`<style>${css}</style><body class="vo-compact" style="margin:0;padding:40px">` +
            Object.entries(buttons).map(([id, c]) => `<button id="${id}" type="button" class="${c}" style="margin-right:40px">Режим</button>`).join('') + '</body>');
        const read = id => page.evaluate(id => {
            const s = getComputedStyle(document.getElementById(id));
            return {property: s.transitionProperty, duration: s.transitionDuration, timing: s.transitionTimingFunction};
        }, id);
        const hover = async id => {
            await page.mouse.move(5, 190);
            await page.waitForTimeout(250);
            const box = await page.locator('#' + id).boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            return page.evaluate(id => document.getElementById(id).getAnimations().map(a => a.transitionProperty || a.animationName || '?'), id);
        };
        for (const id of Object.keys(buttons)) {
            assert.deepEqual(await read(id), EXPECTED, id + ' (' + buttons[id] + '): state transition differs');
            assert.ok((await hover(id)).indexOf('background-color') >= 0, id + ': a real hover does not run the background transition');
        }
        await page.emulateMedia({reducedMotion: 'reduce'});
        for (const id of Object.keys(buttons)) {
            assert.equal((await read(id)).duration, '0s', id + ': the state transition stays under reduced motion');
            assert.deepEqual(await hover(id), [], id + ': a hover still animates under reduced motion');
        }
    } finally {
        await browser.close();
    }
}

(async () => {
    try {
        await modeButtonTransition();
        console.log('PASS mode_button_state_transition_150ms');
        passed++;
    } catch (error) {
        console.error('FAIL mode_button_state_transition_150ms —', error && error.message);
        failed++;
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})();
