/* Run: node test/unit-tests/spreadsheeteditor/header-collab.cjs [path to CompactShell.js]
 * The collaboration header of the spreadsheet editor "Compact" shell: the order is as in Documents -
 * title · save state · on the right history · "Download" ·
 * access · mode (the mode is rightmost); there is no comments button in the header. "Download" is a list
 * of the "File" items (formats, print) from the SheetActions catalog, only when the right to download or
 * print is there; the name and hint are the caption of "File → Download ▸". Access is the standard collaboration:sharing, only when the
 * portal allows (canRequestSharingSettings || sharingSettingsUrl); history is the standard
 * collaboration:history, only with canUseHistory; without the possibility there is no control at all, no
 * stubs. The title is edited in place with canRename: the right is asked on every
 * access, api:disconnect closes the field, in "Viewing" and for a reader there is no renaming;
 * the name is updated by asc_onDocumentName and asc_onMeta with title; outward goes the standard renaming
 * path of LeftMenu (the 'rename' event of the standard header). The save state is as in
 * Documents: "Not saved" and "Saving…" are a badge, "Saved" is a checkmark;
 * "Saved" comes only from an engine event, not from a timer. There is no user and no burger in the header.
 *
 * The stock here is real where it decides: Main.onCoAuthoringDisconnect (removes canRename),
 * Main.disableEditing / onEditingDisable (the "Viewing" reason stack), LeftMenu.SetDisabled and
 * the 'rename' handler of the standard header in LeftMenu (wopi → asc_wopi_renameFile, otherwise
 * Common.Gateway.requestRename) - the text of the spreadsheet editor controllers. The shell module is loaded in node
 * via vm on top of a fake DOM (as view-mode.cjs). The optional argument is a broken
 * copy of the module for the negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const APP = path.join(ROOT, 'apps/spreadsheeteditor/main/app');
const VIEW = path.join(APP, 'view');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactShell.js');
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
const LEFT_SRC = fs.readFileSync(LEFT_MENU, 'utf8');
const STOCK_DISABLE_EDITING = readStock(MAIN_SRC, 'disableEditing', 'controller/Main.js');
const STOCK_ON_EDITING_DISABLE = readStock(MAIN_SRC, 'onEditingDisable', 'controller/Main.js');
const STOCK_ON_DISCONNECT = readStock(MAIN_SRC, 'onCoAuthoringDisconnect', 'controller/Main.js');
const STOCK_LEFT_SET_DISABLED = readStock(LEFT_SRC, 'SetDisabled', 'controller/LeftMenu.js');
/* LeftMenu server disconnect: disables the panel buttons, including comments. */
const STOCK_LEFT_ON_DISCONNECT = readStock(LEFT_SRC, 'onApiServerDisconnect', 'controller/LeftMenu.js');
/* The standard renaming path: the handler of the 'rename' event of the standard header in LeftMenu.control. */
const STOCK_RENAME = (() => {
    const m = /'Common\.Views\.Header'\s*:\s*\{[\s\S]*?'rename'\s*:\s*_\.bind\((function\s*\(value\)\s*\{[\s\S]*?\n\s*\}), this\)/.exec(LEFT_SRC);
    assert.ok(m, "LeftMenu: 'rename' handler of Common.Views.Header not found");
    return m[1];
})();

/* The engine Asc.c_oAscRestrictionType (sdkjs/common/apiBase.js). */
const R = {None: 0x00, OnlyForms: 0x01, OnlyComments: 0x02, OnlySignatures: 0x04, View: 0x80};
const T = {RangeCells: 1, RangeImage: 5, RangeShape: 7};
const D = {Paragraph: 0, Table: 1, Header: 2, TextArt: 3, Shape: 4, Image: 5, Slide: 6, Chart: 7, MailMerge: 8,
    Signature: 9, Pivot: 10, Cell: 11, Slicer: 12};
/* Asc.c_oAscAsyncAction / c_oAscAsyncActionType - a subset of the engine. */
const A = {Open: 0, Save: 3, ForceSaveButton: 21, ForceSaveTimeout: 22, Disconnect: 25, Print: 9};
const AT = {Information: 0, BlockInteraction: 1};

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
        this._value = '';
    }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = String(v); }
    get className() { return this.attrs.class || ''; }
    set className(v) {
        this.classList.splice(0);
        String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.push(c));
        this.attrs.class = this.classList.join(' ');
    }
    get value() { return this._value; }
    set value(v) { this._value = String(v); }
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
    /* The text width at the title measuring double is 10 px per character minus 0.6: fractional, as in the
       browser (getBoundingClientRect), while offsetWidth rounds it. Only when the node is in the
       document and rendered (before insertion and under display: none the browser measures 0, as here). */
    sizerWidth() {
        if (!this.classList.contains('vo-hd-sizer') || !this.ownerDocument.documentElement.contains(this)) return 0;
        if (hiddenByShellCss(this)) return 0;
        const n = this.textContent.length;
        return n ? n * 10 - 0.6 : 0;
    }
    get offsetWidth() { return Math.round(this.sizerWidth()); }
    get offsetHeight() { return 0; }
    getBoundingClientRect() { const w = this.sizerWidth(); return {left: 0, top: 0, right: w, bottom: 0, width: w, height: 0}; }
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
    /* An event as in the browser: preventDefault and stopPropagation are tracked - the cases check them. */
    dispatch(t, extra = {}) {
        const ev = Object.assign({type: t, target: this, prevented: 0, stopped: 0,
            preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }}, extra);
        (this.listeners[t] || []).slice().forEach(fn => fn.call(this, ev));
        return ev;
    }
    click() { return this.dispatch('click'); }
    /* Focus: by mouse - mousedown, then focus, if mousedown did not cancel it (as the browser does). */
    press() {
        const ev = this.dispatch('mousedown', {button: 0});
        if (!ev.prevented) this.focus();
        return ev;
    }
    focus() {
        const doc = this.ownerDocument;
        if (doc.activeElement === this) return;
        if (doc.activeElement && doc.activeElement !== doc.body) doc.activeElement.blur();
        doc.activeElement = this;
        this.dispatch('focus');
    }
    blur() {
        const doc = this.ownerDocument;
        if (doc.activeElement !== this) return;
        doc.activeElement = doc.body;
        this.dispatch('blur');
    }
    /* The field text selection (the browser select()): start and end; typing replaces the selection. */
    select() { this.selection = [0, this._value.length]; }
    /* Typing into the field: the whole value and an input event, as from the keyboard. readonly - does not type. */
    type(text) {
        if (this.hasAttribute('readonly')) return;
        this.value = text;
        this.dispatch('input');
    }
    key(key) {
        const codes = {Enter: 13, Escape: 27, a: 65};
        return this.dispatch('keydown', {key, keyCode: codes[key] || 0});
    }
    descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
    querySelectorAll(sel) { return this.descendants().filter(e => matches(e, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

/* The compact-shell.less rules that hide the header: focus mode -
   `.vo-compact.vo-focus #vo-shell > .vo-hd { display: none }`, the Standard -
   `.vo-advanced [id^="vo-"]:not(#vo-back) { display: none !important }`. A node under them is not
   rendered, and the browser measures it as 0. */
function hiddenByShellCss(el) {
    const body = el.ownerDocument.body, cl = body.classList;
    for (let n = el; n && n !== body; n = n.parentNode) {
        if (cl.contains('vo-advanced') && n.id.indexOf('vo-') === 0 && n.id !== 'vo-back') return true;
        if (cl.contains('vo-compact') && cl.contains('vo-focus') && n.classList.contains('vo-hd') &&
            n.parentNode && n.parentNode.id === 'vo-shell') return true;
    }
    return false;
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

/* opt.options - the stock appOptions fields over the defaults; opt.modified - the workbook is modified at the start. */
function makeEnv(opt = {}) {
    const doc = makeDocument();
    const toolbarEl = doc.body.appendChild(new El('div', doc));
    toolbarEl.id = 'toolbar';
    const ribbon = toolbarEl.appendChild(new El('section', doc));
    ribbon.className = 'toolbar';
    const rightEl = doc.body.appendChild(new El('div', doc));
    rightEl.id = 'right-menu';

    const NC = events();
    const warnings = [];
    const stockLog = [];
    /* The integration journal, written to only by the standard 'rename' handler of LeftMenu (its sandbox is
       below, stockRename). The shell sandbox Gateway has its own one and writes to its own direct journal: a shell
       that called Common.Gateway.requestRename bypassing LeftMenu (its own copy of the "wopi ? … :
       Gateway.requestRename" branch) will not end up in gateway. */
    const gateway = [];
    const direct = [];
    let clock = 1000000;
    const timers = [];
    let current = {type: T.RangeCells, panes: [D.Cell]};

    const info = sel => ({
        asc_getSelectionType: () => sel.type,
        asc_getPivotTableInfo: () => null
    });
    /* The engine: the restrictions are a bit mask, as in baseEditorsApi; "modified" is the modified field. */
    const api = {
        handlers: {}, calls: [], restrictions: 0, modified: !!opt.modified,
        asc_registerCallback(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
        asc_unregisterCallback(name, fn) { const a = this.handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        sendEvent(name, ...args) { (this.handlers[name] || []).slice().forEach(fn => fn.apply(this, args)); },
        asc_addRestriction(v) { this.calls.push(['add', v]); this.restrictions |= v; },
        asc_removeRestriction(v) { this.calls.push(['remove', v]); this.restrictions &= ~v; },
        canEdit() { return this.restrictions === R.None; },
        asc_isDocumentModified() { return this.modified; },
        asc_enableKeyEvents(v) { this.calls.push(['keys', v]); },
        asc_wopi_renameFile(v) { this.calls.push(['wopi rename', v]); },
        asc_getCellInfo() { return info(current); },
        asc_getActiveWorksheetIndex() { return 0; },
        asc_Resize() {},
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

    const appOptions = Object.assign({spreadsheet: {title: 'Отчёт за квартал.xlsx'}, isEdit: true, canEdit: true,
        canCoAuthoring: true, canViewComments: true, canComments: true, canDownload: true, canPrint: true,
        canHelp: true, canRename: true, canUseHistory: true, canRequestSharingSettings: true, sharingSettingsUrl: ''},
        opt.options || {});

    /* The stock left menu: the panel buttons and the real LeftMenu.SetDisabled. */
    const leftButton = name => ({
        name, pressed: false, options: {}, disabled: false,
        isDisabled() { return this.disabled; },
        setDisabled(v) { this.disabled = !!v; stockLog.push(name + (v ? ' disabled' : ' enabled')); },
        click() { this.pressed = !this.pressed; NC.trigger('layout:changed', 'leftmenu'); }
    });
    const fileMenu = {SetDisabled(d, o) { stockLog.push('file menu ' + d + ' ' + JSON.stringify(o)); }, applyMode() {},
        setMode(m) { stockLog.push('file menu mode ' + JSON.stringify(m)); }};
    const leftMenu = {
        btnSearchBar: leftButton('search'), btnComments: leftButton('comments'), btnChat: leftButton('chat'),
        btnSpellcheck: leftButton('spellcheck'), btnAbout: leftButton('about'), buttons: [],
        _state: {disabled: false},
        close() { stockLog.push('left close'); },
        setDisabledPluginButtons() {},
        getMenu() { return fileMenu; },
        showMenu() {}
    };
    const lmCtl = {leftMenu, mode: appOptions, api, setPreviewMode(m) { stockLog.push('left preview ' + m); }};

    const clicks = [];
    const toolbarView = autoRoot('Toolbar', clicks, Object.assign(events(), {el: toolbarEl,
        cmbNumberFormat: button('Toolbar:cmbNumberFormat', clicks)}));
    const tab = name => ({view: autoRoot(name, clicks)});
    /* The "Collaboration" tab: the "Access" and "History" doubles (lib/view/ReviewChanges.js). */
    const reviewView = autoRoot('Review', clicks);

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

    /* The standard header: its 'rename' event is listened to by LeftMenu.control (the real handler text). */
    const stockRename = vm.runInNewContext('(' + STOCK_RENAME + ')', {Common: {Gateway: {
        requestRename: t => gateway.push(['requestRename', t])}}});
    const headerView = {
        renames: [],
        setCanRename(v) { stockLog.push('stock header rename ' + v); },
        setDocumentCaption() {},
        lockHeaderBtns(name, lock) { stockLog.push('stock header ' + name + ' ' + lock); },
        fireEvent(name, args) { if (name === 'rename') stockRename.apply(lmCtl, args); }
    };
    const viewportView = {setMode(m) { stockLog.push('viewport mode ' + JSON.stringify(m)); }};

    const controllers = {
        RightMenu: rightCtl,
        Statusbar: {SetDisabled(s, t) { stockLog.push('statusbar ' + s + ' ' + t); }},
        'Common.Controllers.ReviewChanges': opt.noReview ? undefined : {view: reviewView, SetDisabled(s) { stockLog.push('review ' + s); }},
        DataTab: tab('DataTab'), ViewTab: tab('ViewTab'), WBProtection: tab('WBProtection'), PivotTable: tab('PivotTable'),
        FormulaDialog: {formulaTab: autoRoot('Formula', clicks)},
        Viewport: {viewport: {vlayout, hlayout, celayout}, getApi: () => api, SetDisabled() {},
            getView(name) { return name === 'Common.Views.Header' ? headerView : name === 'Viewport' ? viewportView : null; }},
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
        headerView,
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
        /* Timers with time: they fire when the clock has reached them (tick); flush - only the ripe ones. */
        setTimeout: (fn, ms) => { timers.push({fn, at: clock + (ms || 0)}); return timers.length; },
        clearTimeout() {},
        Date: {now: () => clock},
        Event: class { constructor(type) { this.type = type; } },
        URL,
        innerWidth: 1440, innerHeight: 900,
        _: {extend: Object.assign},
        Asc: {c_oAscSelectionType: T, c_oAscRestrictionType: R, c_oAscAsyncAction: A, c_oAscAsyncActionType: AT,
            c_oAscFileType: {XLSX: 257, PDF: 513, CSV: 260, ODS: 259}},
        Common: {
            NotificationCenter: NC,
            enumLock: {lostConnect: 'lostConnect'},
            Gateway: {requestRename: t => direct.push(['requestRename', t])},
            Utils: {documentSettingsType: D},
            UI: {LayoutManager: {isElementVisible: () => true}, Menu: {Manager: {hideAll() {}}}},
            /* opt.stockDownloadTip - the phrase of the standard header download button (lib/view/Header.js,
               tipDownload) after the locale is applied; without it there is no standard header look. */
            Views: opt.stockDownloadTip ? {Header: {prototype: {tipDownload: opt.stockDownloadTip}}} : undefined,
            localStorage: {getItem: () => null, setItem() {}, removeItem() {}, getBool: (k, d) => !!d, setBool() {}}
        },
        getComputedStyle: () => ({overflowX: 'visible', overflowY: 'visible', getPropertyValue: () => ''}),
        resizes: 0
    };
    context.window = context;
    context.dispatchEvent = ev => { if (ev && ev.type === 'resize') context.resizes++; return true; };
    context.winListeners = [];
    context.addEventListener = (t, fn, capture) => { context.winListeners.push({t, fn, capture: capture === true || !!(capture && capture.capture)}); };
    context.removeEventListener = (t, fn, capture) => {
        const c = capture === true || !!(capture && capture.capture);
        context.winListeners = context.winListeners.filter(l => l.t !== t || l.fn !== fn || l.capture !== c);
    };
    vm.createContext(context);

    /* The stock reason stack and its handlers are real. */
    vm.runInContext(fs.readFileSync(STACK, 'utf8'), context, {filename: STACK});
    main.stackDisableActions = new context.Common.IrregularStack({
        strongCompare: (a, b) => a.type === b.type, weakCompare: (a, b) => a.type === b.type});
    main.disableEditing = vm.runInContext('(' + STOCK_DISABLE_EDITING + ')', context);
    main.onEditingDisable = vm.runInContext('(' + STOCK_ON_EDITING_DISABLE + ')', context);
    main.onCoAuthoringDisconnect = vm.runInContext('(' + STOCK_ON_DISCONNECT + ')', context);
    lmCtl.SetDisabled = vm.runInContext('(' + STOCK_LEFT_SET_DISABLED + ')', context);
    lmCtl.onApiServerDisconnect = vm.runInContext('(' + STOCK_LEFT_ON_DISCONNECT + ')', context);
    /* The stock subscriptions are set up in onLaunch - before the shell: Main (editing:disable, api:disconnect,
       asc_onCoAuthoringDisconnect), LeftMenu (api:disconnect and asc_onCoAuthoringDisconnect disable
       the panel buttons - onApiServerDisconnect) and the "Collaboration" tab (lostConnect disables
       "Access" and "History" - ReviewChanges.onCoAuthoringDisconnect → lockToolbar). */
    NC.on('editing:disable', (...a) => main.onEditingDisable(...a));
    NC.on('api:disconnect', () => main.onCoAuthoringDisconnect());
    api.asc_registerCallback('asc_onCoAuthoringDisconnect', () => main.onCoAuthoringDisconnect());
    NC.on('api:disconnect', (...a) => lmCtl.onApiServerDisconnect(...a));
    api.asc_registerCallback('asc_onCoAuthoringDisconnect', (...a) => lmCtl.onApiServerDisconnect(...a));
    const lostConnect = () => { if (!opt.noReview) { reviewView.btnSharing.setDisabled(true); reviewView.btnHistory.setDisabled(true); } };
    NC.on('api:disconnect', lostConnect);
    api.asc_registerCallback('asc_onCoAuthoringDisconnect', lostConnect);

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
        shell, SSE, doc, NC, api, main, appOptions, leftMenu, lmCtl, reviewView, headerView, stockLog, gateway, direct, warnings, context,
        /* The ripe timers (their time has come). */
        flush() {
            for (let n = 0; n < 200; n++) {
                const i = timers.findIndex(t => t.at <= clock);
                if (i < 0) return;
                timers.splice(i, 1)[0].fn();
            }
        },
        tick(ms) { clock += ms; env.flush(); },
        pending() { return timers.length; },
        create() { shell.create(); env.flush(); return env; },
        header() { return doc.querySelector('#vo-shell .vo-hd'); },
        right() { return doc.querySelector('#vo-shell .vo-hd .vo-hd-right'); },
        title() { return doc.querySelector('#vo-shell .vo-hd .vo-hd-title'); },
        state() { return doc.querySelector('#vo-shell .vo-hd .vo-hd-state'); },
        history() { return doc.querySelector('#vo-shell .vo-hd .vo-hd-history'); },
        sharing() { return doc.querySelector('#vo-shell .vo-hd .vo-hd-sharing'); },
        modeButton() { return doc.querySelector('#vo-shell .vo-hd .vo-docmode .vo-mode'); },
        modeItem(v) { return doc.querySelector('#vo-shell .vo-docmode [data-mode="' + v + '"]'); },
        choose(v) { env.modeButton().click(); env.modeItem(v).click(); env.flush(); },
        downloadWrap() { return doc.querySelector('#vo-shell .vo-hd .vo-download'); },
        downloadButton() { return doc.querySelector('#vo-shell .vo-hd .vo-download .vo-hd-download'); },
        /* The rows of the "Download" list in order: an item (data-k) or a separator ('|'). */
        downloadRows() {
            const pop = env.downloadWrap().querySelector('.vo-pop');
            return pop.children.map(n => n.classList.contains('vo-pop-sep') ? '|' : n.getAttribute('data-k'));
        },
        downloadRow(k) { return env.downloadWrap().querySelector('[data-k="' + k + '"]'); },
        downloadOpen() { const w = env.downloadWrap(); return !!w && w.classList.contains('open'); },
        notes(name) { return NC.fired.filter(e => e[0] === name); },
        keys() { return api.calls.filter(c => c[0] === 'keys').map(c => c[1]); },
        /* Renaming the way a human does it: press the title, type, a key. */
        rename(text, key = 'Enter') {
            const t = env.title();
            t.press();
            t.type(text);
            if (key) t.key(key); else t.blur();
            env.flush();
        },
        save(phase, id = A.Save) { api.sendEvent(phase === 'start' ? 'asc_onStartAction' : 'asc_onEndAction', AT.Information, id); env.flush(); },
        setModified(v) { api.modified = !!v; api.sendEvent('asc_onDocumentModifiedChanged', !v); env.flush(); }
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
const kind = el => ['vo-hd-title', 'vo-hd-state', 'vo-hd-right', 'vo-hd-history', 'vo-docmode', 'vo-download',
    'vo-hd-sharing'].find(c => el.classList.contains(c)) || el.className;

test('header_order_as_documents', () => {
    const env = makeEnv().create();
    const hd = env.header();
    /* The visible header parts - the title, the save state, the right cluster (the double for measuring
       the name width is a service one, hidden from the screen reader). */
    const visible = hd.children.filter(e => e.getAttribute('aria-hidden') !== 'true');
    assert.deepEqual(visible.map(kind), ['vo-hd-title', 'vo-hd-state', 'vo-hd-right'], 'header parts');
    /* The right corner: history · "Download" · access · mode - the mode is rightmost. */
    assert.deepEqual(env.right().children.map(kind), ['vo-hd-history', 'vo-download', 'vo-hd-sharing', 'vo-docmode'],
        'right cluster order');
    /* There is no comments button in the header: the panel is "Collaboration → Comments" and Ctrl+Shift+H. */
    assert.equal(!!env.header().querySelector('.vo-hd-comments'), false, '«Comments» in the header');
    assert.ok(!env.header().querySelectorAll('button').some(b => /comment/.test(b.innerHTML)), 'a header button with the comment glyph');
    /* "Download" is a button with a list, the download glyph; the name and the hover hint are the caption of "File → Download ▸"
       (one command, one name; in English Download as), no title - the browser would draw a second hint. */
    const SA = env.SSE.Views.SheetActions, dlName = SA.label(SA.item('download'));
    assert.equal(dlName, 'Download as', 'precondition: the English name of «File → Download ▸»');
    const d = env.downloadButton();
    assert.ok(d, 'no «Download» in the header');
    assert.equal(d.tagName, 'BUTTON');
    assert.equal(d.getAttribute('type'), 'button');
    assert.equal(d.getAttribute('aria-haspopup'), 'menu');
    assert.equal(d.getAttribute('aria-expanded'), 'false');
    assert.ok(d.innerHTML.indexOf('download') >= 0, 'download glyph');
    assert.equal(d.getAttribute('title'), null, '«Download» keeps title — a second tip');
    assert.equal(d.getAttribute('aria-description'), dlName, 'the «Download» tip is not the «File → Download ▸» name');
    assert.equal(d.getAttribute('aria-label'), dlName, 'the «Download» name is not the «File → Download ▸» name');
    const pop = env.downloadWrap().querySelector('.vo-pop');
    assert.equal(pop.getAttribute('role'), 'menu');
    assert.equal(d.getAttribute('aria-controls'), pop.id, 'aria-controls is not the list');
    assert.equal(pop.getAttribute('aria-label'), dlName);
    /* The phrase of the standard header download button (tipDownload) is the name of another button: the shell "Download" does not have it. */
    const stock = makeEnv({stockDownloadTip: 'Скачать файл'}).create();
    assert.equal(stock.downloadButton().getAttribute('aria-label'), dlName, 'the name follows the stock header phrase tipDownload');
    assert.equal(stock.downloadButton().getAttribute('aria-description'), dlName);
    noWarnings(stock);
    const h = env.history(), s = env.sharing();
    assert.equal(h.tagName, 'BUTTON');
    assert.equal(h.getAttribute('type'), 'button');
    assert.ok(h.classList.contains('vo-ib') && !h.classList.contains('vo-tinted') && !h.classList.contains('vo-outlined'),
        'history is a flat icon button: ' + h.className);
    /* The hover hint text is aria-description (it used to be title). */
    assert.equal(h.getAttribute('aria-description'), env.shell.tipHistory);
    assert.equal(h.getAttribute('title'), null, 'history keeps title — a second tip');
    assert.equal(h.getAttribute('aria-label'), env.shell.tipHistory);
    assert.ok(h.innerHTML.indexOf('history') >= 0, 'history glyph');
    assert.ok(s.classList.contains('vo-ib') && s.classList.contains('vo-tinted'), 'sharing is AIR tinted: ' + s.className);
    assert.equal(s.getAttribute('aria-description'), env.shell.tipSharing);
    assert.equal(s.getAttribute('title'), null, 'sharing keeps title — a second tip');
    assert.equal(s.getAttribute('aria-label'), env.shell.tipSharing);
    assert.ok(s.innerHTML.indexOf('share') >= 0, 'sharing glyph');
    /* The shortcuts go the standard way, the same as for the "Review" items. */
    h.click();
    assert.equal(env.notes('collaboration:history').length, 1, 'history did not go through the stock notification');
    s.click();
    assert.equal(env.notes('collaboration:sharing').length, 1, 'sharing did not go through the stock notification');
    noWarnings(env);
});

test('sharing_absent_without_integration', () => {
    /* Without an integration handler and without a settings address - no control at all. */
    const none = makeEnv({options: {canRequestSharingSettings: false, sharingSettingsUrl: ''}}).create();
    assert.equal(!!none.sharing(), false, 'sharing is drawn without the integration');
    assert.deepEqual(none.right().children.map(kind), ['vo-hd-history', 'vo-download', 'vo-docmode'], 'right cluster without sharing');
    assert.ok(!none.header().querySelectorAll('button').some(b => /share/.test(b.innerHTML)), 'a stub with the sharing glyph');
    const undef = makeEnv({options: {canRequestSharingSettings: undefined, sharingSettingsUrl: undefined}}).create();
    assert.equal(!!undef.sharing(), false, 'sharing is drawn when the portal says nothing');
    /* The access settings address is also a possibility (the standard dialog by sharingSettingsUrl). */
    const url = makeEnv({options: {canRequestSharingSettings: false, sharingSettingsUrl: 'https://portal.test/share'}}).create();
    assert.ok(url.sharing(), 'no sharing with sharingSettingsUrl');
    /* Connection loss: the stock disables "Access" (lostConnect) - the shortcut is inactive and does not call the stock. */
    const env = makeEnv().create();
    env.NC.trigger('api:disconnect');
    env.flush();
    const s = env.sharing();
    assert.equal(s.getAttribute('aria-disabled'), 'true', 'sharing is active after the stock locked it');
    assert.ok(s.classList.contains('vo-locked'));
    s.click();
    assert.equal(env.notes('collaboration:sharing').length, 0, 'locked sharing reached the stock');
    noWarnings(env);
    noWarnings(none);
});

test('history_absent_without_right', () => {
    const none = makeEnv({options: {canUseHistory: false}}).create();
    assert.equal(!!none.history(), false, 'history is drawn without canUseHistory');
    assert.deepEqual(none.right().children.map(kind), ['vo-download', 'vo-hd-sharing', 'vo-docmode'], 'right cluster without history');
    assert.ok(!none.header().querySelectorAll('button').some(b => /history/.test(b.innerHTML)), 'a stub with the history glyph');
    /* No portal possibilities at all - the right cluster: "Download" and the mode. */
    const bare = makeEnv({options: {canUseHistory: false, canRequestSharingSettings: false, sharingSettingsUrl: '', canRename: false}}).create();
    assert.deepEqual(bare.right().children.map(kind), ['vo-download', 'vo-docmode']);
    /* The right is asked at the moment of the press too: the stock removed canUseHistory - the shortcut does not call it. */
    const env = makeEnv().create();
    env.appOptions.canUseHistory = false;
    env.history().click();
    assert.equal(env.notes('collaboration:history').length, 0, 'history reached the stock without the right');
    env.appOptions.canUseHistory = true;
    /* Connection loss: the stock "History" is disabled (lostConnect) - the shortcut is inactive. */
    env.api.sendEvent('asc_onCoAuthoringDisconnect');
    env.flush();
    assert.equal(env.history().getAttribute('aria-disabled'), 'true', 'history is active after the stock locked it');
    env.history().click();
    assert.equal(env.notes('collaboration:history').length, 0, 'locked history reached the stock');
    noWarnings(env);
});

/* "Download" has the same items as "File": the formats XLSX · PDF · CSV · ODS, a separator, print;
   the captions are SheetActions.label of the same item, the glyphs are download for formats and print for print.
   A row is a catalog item path: a format is the standard LeftMenu.clickSaveAsFormat with the file type,
   print is the standard 'print' notification; after the command the list is closed. A disabled row has the menu
   item look (vo-locked, aria-disabled, the reason in the hint) and does nothing. */
test('download_menu_rows_as_file_menu', () => {
    const env = makeEnv().create();
    const SA = env.SSE.Views.SheetActions;
    const saves = [];
    env.lmCtl.clickSaveAsFormat = (menu, type) => saves.push(type);
    const FORMATS = ['downloadXlsx', 'downloadPdf', 'downloadCsv', 'downloadOds'];
    assert.deepEqual(env.downloadRows(), FORMATS.concat(['|', 'print']), 'rows of «Download»');
    const rows = FORMATS.concat(['print']).map(k => env.downloadRow(k));
    assert.deepEqual(rows.map(r => r.querySelector('.vo-pop-t').textContent),
        FORMATS.concat(['print']).map(k => SA.label(SA.offered(k))), 'labels differ from the «File» items');
    assert.deepEqual(rows.map(r => /download\.svg/.test(r.querySelector('.vo-pop-i').innerHTML) ? 'download'
        : /print\.svg/.test(r.querySelector('.vo-pop-i').innerHTML) ? 'print' : '?'),
        ['download', 'download', 'download', 'download', 'print'], 'row glyphs');
    rows.forEach(r => {
        assert.equal(r.tagName, 'BUTTON');
        assert.equal(r.getAttribute('role'), 'menuitem');
        assert.equal(r.getAttribute('tabindex'), '-1', 'a row is a Tab stop');
        assert.equal(r.getAttribute('aria-disabled'), 'false');
    });
    const sep = env.downloadWrap().querySelector('.vo-pop-sep');
    assert.equal(sep.getAttribute('role'), 'separator');
    /* A click on the button opens the list, a repeated one closes it. */
    env.downloadButton().click();
    assert.equal(env.downloadOpen(), true, 'the button did not open the list');
    assert.equal(env.downloadButton().getAttribute('aria-expanded'), 'true');
    env.downloadButton().click();
    assert.equal(env.downloadOpen(), false, 'the second click did not close the list');
    assert.equal(env.downloadButton().getAttribute('aria-expanded'), 'false');
    /* A format is the standard saving of a copy with its type, once. */
    const TYPES = {downloadXlsx: 257, downloadPdf: 513, downloadCsv: 260, downloadOds: 259};
    FORMATS.forEach(k => {
        saves.length = 0;
        env.downloadButton().click();
        env.downloadRow(k).click();
        env.flush();
        assert.deepEqual(saves, [TYPES[k]], k + ': not one stock clickSaveAsFormat with its type');
        assert.equal(env.downloadOpen(), false, k + ': the list stayed open');
    });
    /* Print is one standard notification. */
    env.downloadButton().click();
    env.downloadRow('print').click();
    env.flush();
    assert.equal(env.notes('print').length, 1, 'print did not go through the stock notification once');
    assert.equal(env.downloadOpen(), false, 'print: the list stayed open');
    /* A disabled row: print during a cell edit (the standard print button is disabled). */
    const pb = env.SSE.getController('Toolbar').toolbar.btnPrint;
    pb.keepState = ['cell-editing'];
    pb.setDisabled(true);
    env.downloadButton().click();
    const off = env.downloadRow('print');
    assert.ok(off.classList.contains('vo-locked'), 'a locked row is not vo-locked');
    assert.equal(off.getAttribute('aria-disabled'), 'true');
    assert.equal(off.getAttribute('title'), SA.textEditing, 'a locked row does not name the reason');
    off.click();
    env.flush();
    assert.equal(env.notes('print').length, 1, 'a locked row ran the command');
    assert.equal(env.downloadOpen(), true, 'a locked row closed the list');
    /* The lock is removed - the row is alive again at the next opening. */
    pb.setDisabled(false);
    env.downloadButton().click();
    env.downloadButton().click();
    assert.equal(env.downloadRow('print').getAttribute('aria-disabled'), 'false', 'the row stays locked after the stock unlocked print');
    noWarnings(env);
});

/* Empty by rights - no button; one group - without a separator; for a reader - "Download" without
   the mode switch. */
test('download_needs_rights', () => {
    const none = makeEnv({options: {canDownload: false, canPrint: false}}).create();
    assert.equal(!!none.downloadWrap(), false, '«Download» without canDownload and canPrint');
    assert.deepEqual(none.right().children.map(kind), ['vo-hd-history', 'vo-hd-sharing', 'vo-docmode']);
    const print = makeEnv({options: {canDownload: false}}).create();
    assert.deepEqual(print.downloadRows(), ['print'], 'print only');
    const dl = makeEnv({options: {canPrint: false}}).create();
    assert.deepEqual(dl.downloadRows(), ['downloadXlsx', 'downloadPdf', 'downloadCsv', 'downloadOds'], 'download only');
    const reader = makeEnv({options: {isEdit: false, canEdit: false, canUseHistory: false, canRequestSharingSettings: false,
        sharingSettingsUrl: ''}}).create();
    assert.deepEqual(reader.right().children.map(kind), ['vo-download'], 'reader right cluster');
    assert.deepEqual(reader.downloadRows(), ['downloadXlsx', 'downloadPdf', 'downloadCsv', 'downloadOds', '|', 'print'], 'reader rows');
    [none, print, dl, reader].forEach(noWarnings);
});

test('rename_asks_right_each_time', () => {
    const env = makeEnv().create();
    const t = env.title();
    assert.equal(t.tagName, 'INPUT', 'name is not editable with canRename');
    assert.equal(t.value, 'Отчёт за квартал', 'name without the extension');
    assert.equal(t.hasAttribute('readonly'), false);
    assert.equal(t.getAttribute('title'), env.shell.tipRename);

    /* In-place editing → outward by the standard LeftMenu path: Common.Gateway.requestRename. The entry in
       gateway is made only by the standard 'rename' handler of LeftMenu; a direct Gateway call from
       the shell would go into its own direct journal. */
    env.rename('Бюджет 2027');
    assert.deepEqual(env.direct, [], 'the shell called Common.Gateway.requestRename itself, past the stock LeftMenu handler');
    assert.deepEqual(env.gateway, [['requestRename', 'Бюджет 2027']], 'rename did not go the stock LeftMenu way');
    assert.equal(t.value, 'Бюджет 2027');
    assert.equal(env.doc.activeElement === t, false, 'Enter left the focus in the name');
    assert.ok(env.notes('edit:complete').length >= 1, 'focus is not returned to the sheet (edit:complete)');
    /* The keyboard goes to the field while it is being edited; on exit - to the engine. */
    assert.deepEqual(env.keys().slice(-2), [false, true], 'engine keys during the name edit: ' + JSON.stringify(env.keys()));
    /* The keypresses do not go to the sheet. */
    t.press();
    const kd = t.key('a');
    assert.ok(kd.stopped > 0, 'keydown in the name reached the sheet');
    t.key('Escape');

    /* The right is asked on every access: the stock removed canRename without any event. */
    env.appOptions.canRename = false;
    env.rename('Без права');
    assert.equal(env.gateway.length, 1, 'rename sent without the right');
    assert.equal(t.value, 'Бюджет 2027', 'edit without the right is not rolled back');
    env.appOptions.canRename = true;

    /* An empty name, invalid characters, the same name, Escape - nothing goes out. */
    env.rename('   ');
    env.rename('Итоги: квартал');
    env.rename('Бюджет 2027');
    env.rename('Черновик', 'Escape');
    assert.equal(env.gateway.length, 1, 'rename sent for an empty/invalid/same/escaped name: ' + JSON.stringify(env.gateway));
    assert.equal(t.value, 'Бюджет 2027', 'escaped edit is not rolled back');
    /* Focus leaving by mouse is also a commit (the engine calls it too, checkInterfaceElementBlur). */
    env.rename('Сводка', null);
    assert.deepEqual(env.gateway[env.gateway.length - 1], ['requestRename', 'Сводка'], 'blur did not commit');
    assert.deepEqual(env.direct, [], 'the shell called Common.Gateway.requestRename itself on blur');

    /* WOPI is asc_wopi_renameFile, as in the stock. */
    const wopi = makeEnv({options: {wopi: {FileNameMaxLength: 250}}}).create();
    wopi.rename('Wopi-имя');
    assert.deepEqual(wopi.api.calls.filter(c => c[0] === 'wopi rename'), [['wopi rename', 'Wopi-имя']], 'wopi rename path');
    assert.equal(wopi.gateway.length, 0);
    assert.equal(wopi.direct.length, 0, 'wopi: the shell called Common.Gateway.requestRename itself');
    noWarnings(env);
});

test('rename_right_lost_while_field_focused', () => {
    /* The right went away while the field is in focus - without an event (the press gate on the field
       has already been passed, nobody calls applyRenameRight). The second end of the gate decides - the right check in
       commitTitle: the typing is rolled back, nothing goes outward. Enter and focus leaving by mouse - both paths. */
    const env = makeEnv().create();
    const t = env.title();
    t.press();
    assert.equal(env.doc.activeElement, t, 'precondition: the name field has the focus');
    t.type('Без права после нажатия');
    env.appOptions.canRename = false;
    t.key('Enter');
    env.flush();
    assert.deepEqual(env.gateway, [], 'rename sent by Enter after the right was lost in the focused field');
    assert.deepEqual(env.direct, [], 'rename sent past LeftMenu after the right was lost');
    assert.equal(t.value, 'Отчёт за квартал', 'the name typed without the right is not rolled back on Enter');
    assert.equal(env.doc.activeElement === t, false, 'Enter left the focus in the name');

    /* Focus leaving by mouse is also a commit, and the same rollback. */
    env.appOptions.canRename = true;
    t.press();
    t.type('Без права до ухода фокуса');
    env.appOptions.canRename = false;
    t.blur();
    env.flush();
    assert.deepEqual(env.gateway, [], 'rename sent on blur after the right was lost in the focused field');
    assert.equal(t.value, 'Отчёт за квартал', 'the name typed without the right is not rolled back on blur');

    /* A control: the right returned - the same edit goes by the standard path. */
    env.appOptions.canRename = true;
    env.rename('С правом');
    assert.deepEqual(env.gateway, [['requestRename', 'С правом']], 'control: rename with the right did not go out');
    noWarnings(env);
});

test('rename_closed_by_disconnect_view_and_reader', () => {
    /* api:disconnect closes the field: the standard Main removes canRename, the field is read-only,
       the started edit is rolled back and does not go out. */
    const env = makeEnv().create();
    const t = env.title();
    t.press();
    t.type('Наполовину');
    env.NC.trigger('api:disconnect');
    env.flush();
    assert.equal(env.appOptions.canRename, false, 'precondition: stock took the rename right');
    assert.equal(t.hasAttribute('readonly'), true, 'name field stays open after api:disconnect');
    assert.equal(t.getAttribute('title'), env.shell.tipRenameDisabled);
    assert.equal(t.getAttribute('tabindex'), '-1', 'closed name stays in the tab order');
    assert.equal(env.doc.activeElement === t, false, 'closed name keeps the focus');
    assert.equal(t.value, 'Отчёт за квартал', 'half-typed name is not rolled back');
    assert.equal(env.gateway.length, 0, 'half-typed name was sent on disconnect');
    /* A closed field is text: a press does not take focus from the sheet. */
    const ev = t.press();
    assert.ok(ev.prevented > 0 && env.doc.activeElement !== t, 'closed name takes the focus on press');

    /* "Viewing": there is no renaming; "Editing" brings it back. */
    const view = makeEnv().create();
    view.choose('view');
    assert.equal(view.title().hasAttribute('readonly'), true, 'name is editable in «Viewing»');
    view.rename('В просмотре');
    assert.equal(view.gateway.length, 0, 'rename sent in «Viewing»');
    view.choose('edit');
    assert.equal(view.title().hasAttribute('readonly'), false, 'name stays closed after «Editing»');
    view.rename('После просмотра');
    assert.deepEqual(view.gateway, [['requestRename', 'После просмотра']]);
    assert.deepEqual(view.direct, [], 'the shell called Common.Gateway.requestRename itself after «Viewing»');

    /* A reader with a portal handler: there is no renaming - the title is text. */
    const reader = makeEnv({options: {isEdit: false, canEdit: false}}).create();
    assert.notEqual(reader.title().tagName, 'INPUT', 'reader gets an editable name');
    assert.equal(reader.title().textContent, 'Отчёт за квартал');
    /* Without a portal handler - text, no stub. */
    const plain = makeEnv({options: {canRename: false}}).create();
    assert.equal(plain.title().tagName, 'SPAN', 'name is a field without canRename');
    assert.equal(plain.title().getAttribute('title'), 'Отчёт за квартал.xlsx', 'full name is not in the tooltip');
    /* The loss of editing rights (sharingdeny) closes the field. */
    const deny = makeEnv().create();
    deny.NC.trigger('collaboration:sharingdeny');
    assert.equal(deny.title().hasAttribute('readonly'), true, 'name stays open after the rights are lost');
    noWarnings(env);
    noWarnings(view);
});

/* "File → Rename" is like a click on the title in the header. The menu row item
   puts focus into the title field and selects the text, the keyboard goes to the field; then the former in-place edit: Enter sends the name
   by the standard LeftMenu path (the 'rename' event of the standard header → Gateway.requestRename) and returns the keyboard to the sheet, Escape
   rolls back and sends nothing. In "Viewing" the item is disabled and does not open the field. No field (the title is text) - the item
   goes by the former standard window (editTitle refuses). */
test('rename_from_menu_edits_title', () => {
    const env = makeEnv().create();
    const A = env.SSE.Views.SheetActions, t = env.title();
    const item = () => A.item('rename');
    assert.equal(t.tagName, 'INPUT', 'precondition: the name is a field with canRename');
    env.api.calls.length = 0;
    assert.equal(A.exec(item(), env.shell), true, '«Rename» did not run');
    assert.ok(env.doc.activeElement === t, '«Rename» did not focus the name field');
    assert.deepEqual(t.selection, [0, 'Отчёт за квартал'.length], '«Rename» did not select the name');
    assert.deepEqual(env.keys().slice(-1), [false], 'the keyboard is not given to the name field: ' + JSON.stringify(env.keys()));
    /* Enter is one portal request by the standard path, the keyboard goes to the sheet. */
    t.type('Бюджет из меню');
    t.key('Enter');
    env.flush();
    assert.deepEqual(env.gateway, [['requestRename', 'Бюджет из меню']], 'Enter after «Rename» did not go the stock LeftMenu way');
    assert.deepEqual(env.direct, [], 'the shell called Common.Gateway.requestRename itself');
    assert.equal(env.doc.activeElement === t, false, 'Enter left the focus in the name');
    assert.ok(env.notes('edit:complete').length >= 1, 'focus is not returned to the sheet (edit:complete)');
    assert.deepEqual(env.keys().slice(-1), [true], 'the keyboard is not back at the sheet');
    /* Escape is a rollback, nothing goes out. */
    A.exec(item(), env.shell);
    assert.ok(env.doc.activeElement === t, 'the second «Rename» did not focus the name field');
    t.type('Не то имя');
    t.key('Escape');
    env.flush();
    assert.equal(t.value, 'Бюджет из меню', 'Escape after «Rename» did not roll the name back');
    assert.equal(env.gateway.length, 1, 'Escape after «Rename» sent a rename: ' + JSON.stringify(env.gateway));
    assert.equal(env.doc.activeElement === t, false, 'Escape left the focus in the name');
    /* "Viewing": the item is disabled by the same rule as the field, and does not open the field. */
    env.choose('view');
    assert.equal(A.itemState(item(), env.shell).disabled, true, '«Rename» is live in «Viewing»');
    assert.equal(A.exec(item(), env.shell), false, '«Rename» ran in «Viewing»');
    assert.equal(env.doc.activeElement === t, false, '«Rename» focused the closed name in «Viewing»');
    env.choose('edit');
    /* No field - editTitle refuses: the item will go by the former standard window. */
    const text = makeEnv({options: {canRename: false}}).create();
    assert.equal(text.title().tagName, 'SPAN', 'precondition: the name is text without canRename');
    assert.equal(text.shell.editTitle(), false, 'editTitle took a text name');
    noWarnings(env);
    noWarnings(text);
});

test('title_field_fits_name_in_document', () => {
    /* The title field is as wide as the text, measured when the header is already in the document. The margin is
       Math.ceil(measureText + 2):
       the fractional width of the double (without tracking, as measureText) + 2, rounded up to an integer - not
       the rounded offsetWidth + 1 of Documents. There are no 40…520 bounds: a long name is held by
       the field max-width (40 % of the header), a short field is not stretched to 40. The double measures
       "Quarterly report" at 159.4: the field is 162 (Documents would give 160). */
    const env = makeEnv().create();
    const t = env.title();
    const fit = s => (s.length * 10 + 2) + 'px';
    assert.equal(t.style.width, fit('Отчёт за квартал'), 'name field is not fitted to «Отчёт за квартал» with the margin (ceil(text + 2))');
    const sizer = env.header().querySelector('.vo-hd-sizer');
    assert.ok(sizer && sizer.getAttribute('aria-hidden') === 'true', 'the measuring twin is not hidden from the screen reader');
    t.press();
    t.type('Q4');
    assert.equal(t.style.width, fit('Q4'), 'short name: the field is not its text + 2 (no 40 floor)');
    t.type('Я'.repeat(80));
    assert.equal(t.style.width, fit('Я'.repeat(80)), 'long name: the field is capped in JS (the cap is max-width 40 %)');
    t.key('Escape');
    assert.equal(t.style.width, fit('Отчёт за квартал'), 'Escape did not refit the restored name');
    noWarnings(env);
});

test('title_refits_when_header_returns', () => {
    /* The name came while the header is hidden (focus mode, the Standard): the double under display: none measures 0.
       When the header returned, the field is again by the text, not squeezed to 40 with a cut-off name
      . */
    const env = makeEnv().create();
    const t = env.title();
    const fit = s => (s.length * 10 + 2) + 'px';
    assert.equal(t.style.width, fit('Отчёт за квартал'), 'precondition: field fitted at start');

    /* Focus mode is the panel chevron (toggleFocus); Escape and the "View" item go through the same setChrome. */
    env.shell.toggleFocus();
    assert.ok(env.doc.body.classList.contains('vo-focus'), 'precondition: focus mode');
    assert.equal(env.header().querySelector('.vo-hd-sizer').offsetWidth, 0, 'precondition: the twin is not drawn in focus mode');
    env.api.sendEvent('asc_onMeta', {title: 'Сводный отчёт о продажах за квартал.xlsx'});
    assert.equal(t.value, 'Сводный отчёт о продажах за квартал');
    env.shell.toggleFocus();
    env.flush();
    assert.ok(!env.doc.body.classList.contains('vo-focus'), 'precondition: focus mode is off');
    assert.equal(t.style.width, fit('Сводный отчёт о продажах за квартал'), 'name field is not refitted after focus mode');

    env.shell.toggleMode();
    assert.ok(env.doc.body.classList.contains('vo-advanced'), 'precondition: standard interface');
    env.api.sendEvent('asc_onDocumentName', 'Итоги продаж по регионам.xlsx');
    env.doc.getElementById('vo-back').click();
    env.flush();
    assert.ok(env.doc.body.classList.contains('vo-compact'), 'precondition: back in compact');
    assert.equal(t.style.width, fit('Итоги продаж по регионам'), 'name field is not refitted after the standard interface');

    /* Focus survives a round through the Standard: the header will return only on leaving focus. */
    env.shell.toggleFocus();
    env.shell.toggleMode();
    env.api.sendEvent('asc_onMeta', {title: 'Сводка по филиалам за год.xlsx'});
    env.doc.getElementById('vo-back').click();
    env.flush();
    assert.ok(env.doc.body.classList.contains('vo-focus'), 'precondition: focus survived the round');
    env.shell.toggleFocus();
    env.flush();
    assert.equal(t.style.width, fit('Сводка по филиалам за год'), 'name field is not refitted after focus + standard round');
    env.api.sendEvent('asc_onMeta', {title: 'Бюджет отдела продаж.xlsx'});
    assert.equal(t.style.width, fit('Бюджет отдела продаж'), 'visible header: name is not fitted at once');
    noWarnings(env);
});

test('title_follows_meta_and_document_name', () => {
    const env = makeEnv().create();
    const t = env.title();
    env.api.sendEvent('asc_onDocumentName', 'Бюджет.xlsx');
    assert.equal(t.value, 'Бюджет', 'name does not follow asc_onDocumentName');
    /* Renaming through the portal arrives as the meta command (asc_onMeta), not asc_onDocumentName. */
    env.api.sendEvent('asc_onMeta', {title: 'Итоги года.xlsx'});
    assert.equal(t.value, 'Итоги года', 'name does not follow asc_onMeta');
    env.api.sendEvent('asc_onMeta', {favorite: true});
    assert.equal(t.value, 'Итоги года', 'meta without title changed the name');
    /* The arrived name is not sent back by the very first focus leave. */
    t.press();
    t.blur();
    env.flush();
    assert.equal(env.gateway.length, 0, 'the incoming name was echoed back: ' + JSON.stringify(env.gateway));
    /* While a human is editing, the arrived name does not overwrite their typing; their edit goes out on top. */
    t.press();
    t.type('Мой вариант');
    env.api.sendEvent('asc_onMeta', {title: 'Чужое имя.xlsx'});
    assert.equal(t.value, 'Мой вариант', 'incoming name overwrote the typing');
    t.key('Enter');
    env.flush();
    assert.deepEqual(env.gateway, [['requestRename', 'Мой вариант']]);
    assert.deepEqual(env.direct, [], 'the shell called Common.Gateway.requestRename itself');
    /* A text title (without the right) follows the engine too. */
    const plain = makeEnv({options: {canRename: false}}).create();
    plain.api.sendEvent('asc_onMeta', {title: 'Новое.xlsx'});
    assert.equal(plain.title().textContent, 'Новое');
    noWarnings(env);
});

test('no_user_or_burger_in_header', () => {
    const env = makeEnv().create();
    const hd = env.header();
    const all = hd.descendants();
    assert.ok(all.length > 10, 'header subtree is not read: ' + all.length);
    assert.ok(!all.some(e => /vo-hd-user|avatar|burger|vo-burger/i.test(e.className)), 'user or burger in the header');
    const buttons = hd.querySelectorAll('button').filter(b => !b.classList.contains('vo-pop-item'));
    const owner = b => b.parentNode.classList.contains('vo-docmode') || b.parentNode.classList.contains('vo-download') ? b.parentNode : b;
    assert.deepEqual(buttons.map(b => kind(owner(b))),
        ['vo-hd-history', 'vo-download', 'vo-hd-sharing', 'vo-docmode'], 'header buttons');
    assert.ok(!buttons.some(b => /menu|search|panelR/.test(b.getAttribute('data-act') || '')), 'burger, search or panel button');
    assert.ok(!all.some(e => /onlyoffice|logo|brand/i.test(e.className + ' ' + e.textContent)), 'brand mark in the header');
});

test('save_state_badge_and_check_from_engine', () => {
    const env = makeEnv().create();
    const st = env.state();
    assert.equal(st.getAttribute('role'), 'status');
    /* "Saved" is a checkmark without a caption, the text is in the hint and in the screen reader name. */
    assert.ok(st.classList.contains('saved'), 'initial state: ' + st.className);
    assert.ok(st.innerHTML.indexOf('accept') >= 0, '«Saved» is not the check glyph');
    /* The hover hint text is aria-description (it used to be title). */
    assert.equal(st.getAttribute('aria-description'), env.shell.textSaved);
    assert.equal(st.getAttribute('aria-label'), env.shell.textSaved);
    /* An edit is the "Not saved" badge. */
    env.setModified(true);
    assert.ok(st.classList.contains('dirty') && !st.classList.contains('saved'), 'dirty: ' + st.className);
    assert.equal(st.textContent, env.shell.textUnsaved, 'unsaved badge text');
    /* Saving is the "Saving…" badge (the engine long Save action). */
    env.save('start');
    assert.ok(st.classList.contains('saving'), 'saving: ' + st.className);
    assert.equal(st.textContent, env.shell.textSaving);
    /* The end of saving and clearing "modified" - "Saving…" holds for 3 s, then the checkmark. */
    env.api.modified = false;
    env.save('end');
    assert.ok(st.classList.contains('saving'), 'saving badge blinked away');
    env.tick(3000);
    assert.ok(st.classList.contains('saved'), 'after the hold: ' + st.className);
    assert.ok(st.innerHTML.indexOf('accept') >= 0);
    /* Saving by the button (ForceSaveButton) is the same; other actions do not touch the state. */
    env.save('start', A.ForceSaveButton);
    assert.ok(st.classList.contains('saving'), 'force save is not «Saving…»');
    env.save('end', A.ForceSaveButton);
    env.tick(3000);
    env.save('start', A.Print);
    assert.ok(st.classList.contains('saved'), 'a non-save action changed the state: ' + st.className);
    noWarnings(env);
});

test('saved_only_on_engine_event_not_timer', () => {
    const env = makeEnv({modified: true}).create();
    const st = env.state();
    assert.ok(st.classList.contains('dirty'), 'initial state not read from the engine');
    /* Saving started and has not finished: neither the timer nor the "Saved" time is set. */
    env.save('start');
    env.tick(10000);
    assert.ok(st.classList.contains('saving'), 'timer ended «Saving…» without the engine: ' + st.className);
    /* The engine finished saving, but the workbook is modified again - "Not saved", not a checkmark. */
    env.save('end');
    env.tick(3000);
    assert.ok(st.classList.contains('dirty'), 'saved by timer while the engine says modified: ' + st.className);
    /* Saving finished in the hold window, but the workbook is already modified again: when the window expires -
       "Not saved" (the engine re-read), not a checkmark by the timer. */
    env.save('start');
    env.save('end');
    assert.ok(st.classList.contains('saving'), 'hold after a short save');
    env.tick(3000);
    assert.ok(st.classList.contains('dirty'), 'the hold timer put «Saved» over a modified book: ' + st.className);
    /* The event argument lies - the engine knows the truth. */
    env.api.sendEvent('asc_onDocumentModifiedChanged', false);
    env.flush();
    assert.ok(st.classList.contains('dirty'), 'state taken from the event argument');
    env.api.modified = false;
    env.api.sendEvent('asc_onDocumentModifiedChanged', true);
    env.flush();
    assert.ok(st.classList.contains('saved'), 'engine says saved: ' + st.className);
    assert.equal(env.pending(), 0, 'timers left after the state settled');
    noWarnings(env);
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
