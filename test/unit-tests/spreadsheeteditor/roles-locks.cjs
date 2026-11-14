/* Run: node test/unit-tests/spreadsheeteditor/roles-locks.cjs [path to CompactShell.js] [path to SheetActions.js] [path to CompactToolbar.js]
 * Roles and restrictions of the spreadsheet editor "Compact" shell: lockState() is the top of the standard stack of
 * restriction reasons (Main.stackDisableActions) over the right, as in Documents; a reader -
 * there is no mode switch, as in Documents, the menu row edit items are
 * inactive with a reason, search, download and print are alive; "File → Edit spreadsheet" -
 * by the stock miEdit condition and the standard path; a connection loss is the panel mask, and
 * the menu row items follow the stock: the doubles of the standard ribbon under its mask are inactive, the others -
 * by their own state; a missing double is a shell warning only for an editor
 * (a reader has no edit doubles in the standard). The "View" commands that the engine performs only
 * when editing (freeze panes, normal view and page layout - canEdit() in
 * asc_freezePane and asc_SetSheetViewType; show formulas and the sheet direction - canEdit() in
 * changeSheetViewSettings; macro recording) or that write to the workbook without checking
 * canEdit() (named views), in "Viewing" are inactive with a
 * reason by the engine verdict, not by the stock ribbon mask; reading in "View" is alive.
 * A restriction is not the absence of a right: the comment items,
 * for which the stock disables canComments for the time of its reason (the comments "preview"),
 * stay in place inactive, while without the right they are absent. The edit right and the
 * comment right at the start are read by one path for the switch, the menu row and the panel:
 * a shell built under a standard reason (a background open disables isEdit and canComments)
 * builds the formatting panel with the comment button. "File →
 * Rename" follows the same rule as the title field in the header (CompactShell.canRename): without
 * the edit right there is no item, in "Viewing" it is inactive with a reason.
 *
 * The stock is real where it decides: Main.disableEditing and Main.onEditingDisable (the stack of
 * reasons and restoring the others), LeftMenu.SetDisabled, LeftMenu.clickMenuFileItem,
 * Comments.setPreviewMode/updatePreviewMode (lib/controller/Comments.js), the miEdit condition from
 * view/FileMenu.js; the stack is Common.IrregularStack; the engine canEdit() verdict is by the formula of
 * common/apiBase.js (!isViewMode && restrictions === None). The shell modules
 * are loaded in node via vm on top of a fake DOM (as side-panels.cjs); the menu row is the shared one
 * (Common.UI.Compact.MenuBar) with the spreadsheet editor adapter, a section is opened by a click on its button, the rows
 * are read from its markup. The shared reason texts of the menu row ("Viewing", protection) are the same as those of
 * the shell and the spreadsheet editor catalog, as the spreadsheet editor locale puts them.
 * The optional arguments are broken copies of the modules for the negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const APP = path.join(ROOT, 'apps/spreadsheeteditor/main/app');
const VIEW = path.join(APP, 'view');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactShell.js');
const actionsFile = process.argv[3] ? path.resolve(process.argv[3]) : path.join(VIEW, 'SheetActions.js');
const toolbarFile = process.argv[4] ? path.resolve(process.argv[4]) : path.join(VIEW, 'CompactToolbar.js');
const ICONS = path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js');
const MAIN = path.join(APP, 'controller/Main.js');
const LEFT_MENU = path.join(APP, 'controller/LeftMenu.js');
const FILE_MENU = path.join(VIEW, 'FileMenu.js');
const STACK = path.join(ROOT, 'apps/common/IrregularStack.js');
const COMMENTS = path.join(ROOT, 'apps/common/main/lib/controller/Comments.js');

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
const STOCK_LEFT_SET_DISABLED = readStock(LEFT_SRC, 'SetDisabled', 'controller/LeftMenu.js');
const STOCK_FILE_ITEM = readStock(LEFT_SRC, 'clickMenuFileItem', 'controller/LeftMenu.js');
const COMMENTS_SRC = fs.readFileSync(COMMENTS, 'utf8');
const STOCK_COMMENTS_SET_PREVIEW = readStock(COMMENTS_SRC, 'setPreviewMode', 'lib/controller/Comments.js');
const STOCK_COMMENTS_UPDATE_PREVIEW = readStock(COMMENTS_SRC, 'updatePreviewMode', 'lib/controller/Comments.js');
/* The condition of the "Edit" item of the standard file menu (view/FileMenu.js applyMode, miEdit). */
const MI_EDIT = (() => {
    const m = /this\.miEdit\[(.+?)\s*\?\s*'show'\s*:\s*'hide'\]/.exec(fs.readFileSync(FILE_MENU, 'utf8'));
    assert.ok(m, 'miEdit condition not found in view/FileMenu.js');
    return new Function('mode', 'return !!(' + m[1].replace(/this\.mode/g, 'mode') + ');');
})();

const R = {None: 0x00, OnlyForms: 0x01, OnlyComments: 0x02, OnlySignatures: 0x04, View: 0x80};
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

/* Visibility, focus, siblings and closest - for the shared menu row (lib/fake-dom.cjs); a closed menu row list is
   hidden, as the styles hide it (.vo-mn-drop without open). */
require(path.join(__dirname, 'lib/fake-dom.cjs')).patch(El, {matches, replaceClosest: true, capture: true,
    hidden: n => n.classList.contains('vo-mn-drop') && !n.classList.contains('open')});

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

/* A ribbon button and the bridge root that has any btn* (a double is born on the first
   access); for a reader - only the listed ones. */
function button(ref, log) {
    const b = events();
    Object.assign(b, {disabled: false, pressed: false, visible: true, hidden: false, keepState: [], options: {lock: []}, cmpEl: [{}]});
    b.isDisabled = function () { return this.disabled; };
    b.setDisabled = function (v) { this.disabled = !!v; };
    b.click = function () { if (!this.disabled) log.push('click ' + ref); };
    return b;
}
/* A ribbon button with a standard menu of items {caption, value}: choosing an item is the stock menu 'item:click' (journal). This is "Format →
   Format cells" (the 'formatCells' item of the "Format" button), "Clear format" (the "Formatting" item of the "Clear" button). */
function menuButton(ref, log, items) {
    const b = button(ref, log);
    const m = Object.assign(events(), {items: []});
    items.forEach(({caption, value}) => m.items.push({caption, value, options: {caption, value}, hidden: false, visible: true, rendered: true,
        disabled: false, keepState: [], menu: null, isDisabled() { return this.disabled; }, setDisabled(v) { this.disabled = !!v; },
        onItemClick() { if (!this.disabled) { log.push('pick ' + ref + ' ' + caption); m.trigger('item:click', m, this); } }}));
    b.menu = m;
    return b;
}
function autoRoot(name, log, preset = {}, only = null) {
    const made = Object.assign({}, preset);
    return new Proxy(made, {
        get(t, k) {
            if (typeof k !== 'string') return t[k];
            if (!(k in t) && /^btn/.test(k) && (!only || only.includes(k))) {
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
    const log = [];
    const reader = !!opt.reader;

    const info = () => ({asc_getSelectionType: () => T.RangeCells, asc_getPivotTableInfo: () => null});
    /* canEdit() is the engine formula (common/apiBase.js): for a reader the engine is in isViewMode. */
    const api = {
        handlers: {}, calls: [], restrictions: 0, isViewMode: reader,
        asc_registerCallback(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
        asc_unregisterCallback(name, fn) { const a = this.handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        sendEvent(name, ...args) { (this.handlers[name] || []).slice().forEach(fn => fn.apply(this, args)); },
        asc_addRestriction(v) { this.calls.push(['add', v]); this.restrictions |= v; },
        asc_removeRestriction(v) { this.calls.push(['remove', v]); this.restrictions &= ~v; },
        canEdit() { return !this.isViewMode && this.restrictions === R.None; },
        asc_isDocumentModified() { return false; },
        asc_getCellInfo() { return info(); },
        asc_getActiveWorksheetIndex() { return 0; },
        asc_isProtectedSheet() { return false; },
        asc_isWorkbookLocked() { return false; },
        asc_isProtectedWorkbook() { return false; },
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

    const appOptions = Object.assign({spreadsheet: {title: 'Отчёт.xlsx'}, isEdit: !reader, canEdit: !reader,
        canRequestEditRights: false, canCoAuthoring: true, canViewComments: true, canComments: true, canDownload: true,
        canPrint: true, canHelp: true, canUseHistory: true, canRename: false}, opt.options || {});

    const leftButton = name => ({
        name, pressed: false, options: {}, disabled: false, keepState: [],
        isDisabled() { return this.disabled; },
        setDisabled(v) { this.disabled = !!v; stockLog.push(name + (v ? ' disabled' : ' enabled')); },
        click() { if (this.disabled) return; this.pressed = !this.pressed; log.push('click LeftMenu:' + name); NC.trigger('layout:changed', 'leftmenu'); }
    });
    const fileButtons = {protect: {disabled: false, isDisabled() { return this.disabled; }, setDisabled(v) { this.disabled = !!v; }}};
    const fileMenu = {
        SetDisabled(d, o) { if (o && o.protect) fileButtons.protect.setDisabled(d); stockLog.push('file menu ' + d); },
        applyMode() {}, getButton: k => fileButtons[k] || null
    };
    const leftMenu = {
        btnSearchBar: leftButton('btnSearchBar'), btnComments: leftButton('btnComments'), btnChat: leftButton('btnChat'),
        btnSpellcheck: leftButton('btnSpellcheck'), btnAbout: leftButton('btnAbout'), buttons: [],
        _state: {disabled: false}, menuFile: fileMenu,
        close() { stockLog.push('left close'); },
        setDisabledPluginButtons() {},
        getMenu() { return fileMenu; },
        showMenu(p) { log.push('show ' + p); }
    };
    const lmCtl = {leftMenu, mode: appOptions, requestEditRightsText: 'Request',
        setPreviewMode(m) { stockLog.push('left preview ' + m); },
        clickSaveAsFormat(m, f) { log.push('saveas ' + f); }};

    /* The ribbon. For a reader the stock builds it without edit commands: in the roots only what is listed. */
    /* The reader ribbon (measured in the editor): copy, paste, undo, redo - without print and "Select all". */
    const ribbonOnly = reader ? ['btnCopy', 'btnPaste', 'btnUndo', 'btnRedo'] : null;
    /* listStyles is the cell styles combo of the edit ribbon (the double of "Format → Cell styles"). */
    const toolbarView = autoRoot('Toolbar', log, Object.assign(events(), {el: toolbarEl},
        reader ? {} : {cmbNumberFormat: button('Toolbar:cmbNumberFormat', log), listStyles: button('Toolbar:listStyles', log),
            btnFormatCell: menuButton('Toolbar:btnFormatCell', log, [{caption: 'Row height'}, {caption: 'Format cells', value: 'formatCells'}]),
            btnClearStyle: menuButton('Toolbar:btnClearStyle', log, [{caption: 'All', value: 0}, {caption: 'Formatting', value: 2}])}), ribbonOnly);
    /* The standard checkboxes of the "View" tab (Common.UI.CheckBox: isChecked, setValue, onItemCheck) - the stock builds them only with isEdit
       (view/ViewTab.js); these are also "View → Show ▸". */
    const checkbox = ref => ({checked: false, disabled: false, rendered: true, keepState: [], options: {},
        isChecked() { return this.checked; }, isDisabled() { return this.disabled; }, setDisabled(v) { this.disabled = !!v; },
        setValue(v) { this.checked = !!v; log.push('check ' + ref + ' ' + this.checked); },
        onItemCheck() { if (!this.disabled) this.setValue(!this.checked); }});
    const roots = {
        DataTab: reader ? undefined : autoRoot('DataTab', log),
        Formula: reader ? undefined : autoRoot('Formula', log),
        /* The stock builds the macro buttons only with isEdit too (view/ViewTab.js). */
        ViewTab: autoRoot('ViewTab', log, reader ? {btnMacros: undefined, btnRecMacro: undefined, btnPauseMacro: undefined} : {chGridlines: checkbox('ViewTab:chGridlines'),
            chHeadings: checkbox('ViewTab:chHeadings'), chZeros: checkbox('ViewTab:chZeros')}),
        WBProtection: reader ? undefined : autoRoot('WBProtection', log, Object.fromEntries(
            ['chHiddenFormula', 'chLockedShape', 'chLockedText'].map(name => [name, checkbox('WBProtection:' + name)]))),
        PivotTable: reader ? undefined : autoRoot('PivotTable', log),
        Review: autoRoot('Review', log)
    };
    const comment = button('ToolbarCtl:btnsComment.0', log);

    const rightView = Object.assign(events(), {
        minimizedMode: true, active: null, mode: {isEdit: !reader, customization: {}},
        fireEvent(name, args) { this.trigger(name, args); },
        SetActivePane() {}, GetActivePane() { return null; }, clearSelection() {}
    });
    if (!reader) rightView.cellSettings = {};
    const rightCtl = {rightmenu: rightView, getView() { return rightView; }, SetDisabled(d) { stockLog.push('right menu ' + d); }};

    /* The comments controller: the "preview" is standard code (setPreviewMode/updatePreviewMode
       below, after the context): for the time of the restriction reason it disables canComments in the shared appOptions
       (Main gives it appOptions through setMode) and keeps the previous value in prevcanComments. */
    const comments = {mode: appOptions, viewmode: false, prevcanComments: undefined,
        _state: {disableEditing: false, docProtection: {isReadOnly: false, isReviewOnly: false, isFormsOnly: false, isCommentsOnly: false}},
        closeEditing() {}, setMode(m) { this.mode = m; return this; }, updateComments() {}, getPopover() { return null; }};

    const controllers = {
        RightMenu: rightCtl,
        /* The sheet row: the zoom buttons are the availability of "View → Zoom ▸"; in the stock both roles have them, and
           "Viewing" does not disable them. The tab menu is "View → Hidden sheets ▸": the workbook has a hidden sheet, the "Hidden" item is shown.
           The sheet "+" ("Insert → Sheet"): the stock builds the button for both roles (for a reader its box hides it, the button itself is alive). */
        Statusbar: {SetDisabled(s, t) { stockLog.push('statusbar ' + s + ' ' + t); }, setStatusCaption(t) { log.push('status ' + t); },
            statusbar: {btnZoomUp: button('Statusbar:btnZoomUp', log), btnZoomDown: button('Statusbar:btnZoomDown', log),
                btnAddWorksheet: button('Statusbar:btnAddWorksheet', log), mode: {},
                tabMenu: {items: [0, 1, 2, 3, 4].map(i => button('Statusbar:tabMenu.items.' + i, log)).concat([Object.assign(
                    button('Statusbar:tabMenu.items.5', log), {menu: {items: [{caption: 'Hidden 1', value: 1}], trigger() {}, on() {}}})])}}},
        /* The stock: SetDisabled → lockToolbar(viewMode); for the comments "Resolve" and "Delete" buttons
           viewMode is in lock (lib/view/ReviewChanges.js) - they are disabled, history is not. */
        'Common.Controllers.ReviewChanges': {view: roots.Review, SetDisabled(s) {
            stockLog.push('review ' + s);
            ['btnCommentResolve', 'btnCommentRemove'].forEach(n => roots.Review[n].setDisabled(s));
        }},
        Viewport: {viewport: {vlayout, hlayout, celayout}, getApi: () => api, SetDisabled() {}},
        Toolbar: {toolbar: toolbarView, btnsComment: reader ? [] : [comment], api,
            DisableToolbar(d, v) { stockLog.push('ribbon mask ' + d + ' viewMode ' + v); }},
        DataTab: roots.DataTab && {view: roots.DataTab},
        FormulaDialog: roots.Formula && {formulaTab: roots.Formula},
        /* The click handler of "Macros" on the "View" tab (controller/ViewTab.js onClickMacros: the standard macros window) - both roles have it. */
        ViewTab: {view: roots.ViewTab, onClickMacros() { log.push('stock macros window'); }},
        WBProtection: roots.WBProtection && {view: roots.WBProtection},
        PivotTable: roots.PivotTable && {view: roots.PivotTable},
        DocumentHolder: {clearSelection() {}, SetDisabled(s) { stockLog.push('context menu ' + s); }},
        LeftMenu: lmCtl,
        'Common.Controllers.Comments': comments,
        CellEditor: {setPreviewMode(m) { stockLog.push('cell editor preview ' + m); }}
    };

    const main = {
        editorConfig: {ui: {shell: 'modern'}},
        appOptions,
        _state: {isDisconnected: false},
        headerView: null,
        getApplication() { return {getController: n => controllers[n]}; }
    };
    lmCtl.getApplication = main.getApplication;

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
        console: {warn: (...a) => warnings.push(a), log() {}, error() {}},
        setTimeout: fn => { timers.push(fn); return timers.length; },
        clearTimeout() {},
        Event: class { constructor(type) { this.type = type; } },
        URL,
        innerWidth: 1440, innerHeight: 900,
        _: {extend: Object.assign},
        Asc: {c_oAscSelectionType: T, c_oAscRestrictionType: R, c_oAscFileType: {XLSX: 257, PDF: 513, CSV: 260, ODS: 259},
            /* sdkjs cell/apiDefines.js: "Format → Clear format" is the "Formatting" item by the Format value. */
            c_oAscCleanOptions: {All: 0, Text: 1, Format: 2, Comments: 5, Hyperlinks: 6}},
        Common: {
            NotificationCenter: NC,
            Utils: {documentSettingsType: D},
            UI: {LayoutManager: {isElementVisible: () => true}, Menu: {Manager: {hideAll() {}}}},
            Gateway: {requestEditRights() { log.push('gateway: request edit rights'); }},
            localStorage: {getItem: () => null, setItem() {}, removeItem() {}, getBool: (k, d) => !!d, setBool() {}}
        },
        getComputedStyle: () => ({overflowX: 'visible', overflowY: 'visible', getPropertyValue: () => ''}),
        resizes: 0
    };
    context.window = context;
    context.dispatchEvent = ev => { if (ev && ev.type === 'resize') context.resizes++; return true; };
    context.onpointerdown = null;
    /* Window listeners (Escape of the menu row and the shell - keydown capture on window): the keydown
       of a press is env.press. */
    const winListeners = [];
    context.addEventListener = (t, fn, capture) => { winListeners.push({t, fn, capture: capture === true || !!(capture && capture.capture)}); };
    context.removeEventListener = (t, fn) => { const i = winListeners.findIndex(l => l.t === t && l.fn === fn); if (i >= 0) winListeners.splice(i, 1); };
    vm.createContext(context);

    vm.runInContext(fs.readFileSync(STACK, 'utf8'), context, {filename: STACK});
    main.stackDisableActions = new context.Common.IrregularStack({
        strongCompare: (a, b) => a.type === b.type, weakCompare: (a, b) => a.type === b.type});
    main.disableEditing = vm.runInContext('(' + STOCK_DISABLE_EDITING + ')', context);
    main.onEditingDisable = vm.runInContext('(' + STOCK_ON_EDITING_DISABLE + ')', context);
    lmCtl.SetDisabled = vm.runInContext('(' + STOCK_LEFT_SET_DISABLED + ')', context);
    const fileItem = vm.runInContext('(' + STOCK_FILE_ITEM + ')', context);
    lmCtl.clickMenuFileItem = function (menuArg, action) { log.push('file ' + action); return fileItem.call(this, menuArg, action); };
    const commentsPreview = vm.runInContext('(' + STOCK_COMMENTS_SET_PREVIEW + ')', context);
    comments.updatePreviewMode = vm.runInContext('(' + STOCK_COMMENTS_UPDATE_PREVIEW + ')', context);
    comments.setPreviewMode = function (m) { stockLog.push('comments preview ' + m); return commentsPreview.call(this, m); };
    NC.on('editing:disable', (...a) => main.onEditingDisable(...a));

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
    load('spreadsheeteditor/main/app/view/SheetActions', actionsFile);
    load('spreadsheeteditor/main/app/view/CompactToolbar', toolbarFile);
    load('spreadsheeteditor/main/app/view/CompactShell', file);
    const shell = SSE.Views.CompactShell;
    const A = SSE.Views.SheetActions;
    const MB = context.Common.UI.Compact.MenuBar;
    MB.textReasonView = shell.textModeLockedView;
    MB.textReasonProtected = A.textProtected;
    const fakeDom = require(path.join(__dirname, 'lib/fake-dom.cjs'));

    const env = {
        shell, A, SSE, doc, NC, api, main, appOptions, leftMenu, fileButtons, stockLog, log, timers, warnings, context, toolbarView, roots, comments,
        flush() { let n = 0; while (timers.length && n++ < 100) timers.shift()(); },
        create() { shell.create(); env.flush(); return env; },
        modeButton() { return doc.querySelector('#vo-shell .vo-hd .vo-docmode .vo-mode'); },
        modeItem(v) { return doc.querySelector('#vo-shell .vo-docmode [data-mode="' + v + '"]'); },
        choose(v) { env.modeButton().click(); env.modeItem(v).click(); env.flush(); },
        bar() { return doc.getElementById('vo-tb'); },
        shellRows() { return vlayout.getItem('toolbar').height; },
        /* A menu row section button by caption (null - there is none) and its list. */
        sectionButton(label) {
            return doc.querySelectorAll('#vo-shell .vo-mn-item').find(b => b.textContent === label) || null;
        },
        dropOf(btn) { return btn.parentNode.querySelector('.vo-mn-drop'); },
        /* A menu row section by a real click; rows are {k: {off, reason}}; keep - do not close. */
        section(label, keep) {
            shell.closeSurfaces();
            const btn = env.sectionButton(label);
            assert.ok(btn, 'no menu section ' + label);
            btn.click();
            const out = env.rows(env.dropOf(btn));
            if (!keep) shell.closeSurfaces();
            return out;
        },
        /* The section list rows (without the rows of its submenu): {k: {off, reason, row}}. */
        rows(drop) {
            const out = {};
            drop.descendants().filter(r => r.getAttribute('data-k') !== null && r.closest('.vo-mn-drop') === drop).forEach(r => {
                out[r.getAttribute('data-k')] = {off: r.getAttribute('aria-disabled') === 'true', reason: r.getAttribute('title'), row: r};
            });
            return out;
        },
        /* A key press as in the browser: keydown capture on window, then the focused node and bubbling. */
        press(key, init) {
            const target = doc.activeElement || doc.body;
            const ev = Object.assign({type: 'keydown', key, target, defaultPrevented: false, propagationStopped: false,
                preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }}, init || {});
            winListeners.filter(l => l.t === 'keydown' && l.capture).slice().forEach(l => l.fn.call(context, ev));
            if (!ev.propagationStopped) {
                const tail = fakeDom.bubble(target, 'keydown', ev);
                if (!tail.propagationStopped) winListeners.filter(l => l.t === 'keydown' && !l.capture).slice().forEach(l => l.fn.call(context, ev));
            }
            return ev;
        },
        /* The rows of the layer of a composite item k of a section ("Download ▸" and
           others) by a real click on its row: {k: {off, reason}}; no holder - null. */
        kids(label, k) {
            const rows = env.section(label, true);
            if (!rows[k]) { shell.closeSurfaces(); return null; }
            rows[k].row.click();
            const out = {};
            doc.querySelectorAll('#vo-shell .vo-mn-fly .vo-mn-sub').filter(r => r.getAttribute('data-k')).forEach(r => {
                out[r.getAttribute('data-k')] = {off: r.getAttribute('aria-disabled') === 'true', reason: r.getAttribute('title')};
            });
            shell.closeSurfaces();
            return out;
        },
        /* The section rows and the children of its composite items ("Show ▸",
           "Views ▸", "Macros ▸"): the section rows by a real click, the children by the state that the layer
           row will show (SheetActions.itemState; a disabled layer holder does not open, and the item must be inactive there too). */
        deep(label) {
            const out = env.section(label);
            const g = A.groups().find(x => x.label === label);
            (g ? g.items : []).forEach(it => {
                if (!it.items) return;
                A.children(it).forEach(c => {
                    if (c.sep || c.head != null || c.mirror) return;
                    const st = A.itemState(c, shell);
                    out[c.k] = {off: st.disabled, reason: st.reason, holder: it.k};
                });
            });
            return out;
        },
        /* The row of item k of section label by real clicks - also of a composite item child (first the holder row); no
           row (the holder is disabled and did not open the layer) - false. The menu is closed. */
        clickItem(label, k) {
            shell.closeSurfaces();
            env.sectionButton(label).click();
            const g = A.groups().find(x => x.label === label);
            const holder = g && g.items.find(it => it.items && A.children(it).some(c => c.k === k));
            if (holder) {
                const h = doc.querySelector('#vo-shell [data-k="' + holder.k + '"]');
                h && h.click();
            }
            const row = doc.querySelector('#vo-shell [data-k="' + k + '"]');
            if (row) row.click();
            shell.closeSurfaces();
            return !!row;
        },
        stackTypes() {
            const s = main.stackDisableActions, out = [];
            for (let i = 0; i < s.length(); i++) out.push(s.get(i).type);
            return out;
        }
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

/* The menu row items by section: editing - the ribbon doubles; always alive - the file menu and
   the left area panels. */
/* "Increase indent · Decrease indent" are merged into "Format → Indent ▸": the section row is the holder. */
const EDIT_ITEMS = {Format: ['borders', 'merge', 'conditional', 'indent'], Data: ['sortAZ', 'filter', 'validation'],
    Insert: ['insertCells', 'link', 'comment'], Edit: ['fill']};
const SECTION = (env, key) => env.A['text' + key];
/* "View": the commands that the engine performs only when editing or that write to the workbook (macro
   recording, named views; show formulas and the sheet direction -
   the engine rejects them without editing), and reading (without edit). */
/* "View": "Named views ▸" - stock menu rows in place in "Views
   ▸" (the views holder below), not an item of its own. */
const VIEW_ENGINE_EDIT = ['freeze', 'viewNormal', 'viewPageLayout', 'showFormulas', 'sheetDirection', 'createView',
    'recordMacro', 'pauseMacro',
    /* "View → Show ▸ ✓ Gridlines · ✓ Headings · ✓ Zeros" - the sheet view is changed by
       the same changeSheetViewSettings as for show formulas; "Show ▸" is unavailable in "Viewing". */
    'gridlines', 'headings', 'zeros',
    /* "View → Hidden sheets ▸" - showing a sheet changes the workbook; it is unavailable in "Viewing". */
    'hiddenSheets'];
/* The "View" holders whose children are all edit commands (unavailable as a whole in "Viewing"): "Show ▸",
   "Views ▸". */
const VIEW_EDIT_HOLDERS = ['show', 'views'];
/* The doubles of the "View" commands with the edit sign, whose click writes the fake ribbon journal. */
const VIEW_EDIT_CLICK = /^(click|check) (ViewTab:|Formula:btnShowFormulas|Toolbar:btnRtlSheet)/;
/* There are no "Dark sheet" and "Interface theme" - the look is set by the portal. */
const VIEW_READING = ['macros', 'focus'];
/* The comment items with the canComments right: "Insert → Add comment" and two in "Collaboration"
   ("Review → Add comment" is in "Insert", one item). */
const COMMENT_ROWS = ['comment', 'resolveComments', 'deleteComments'];

test('reader_has_no_mode_switch', () => {
    const env = makeEnv({reader: true}).create();
    /* A reader has no switch at all, as in Documents. A boolean, not a node: an assert message
       about a fake node would unfold the whole DOM. */
    assert.equal(!!env.modeButton(), false, 'reader has a mode switch');
    assert.equal(!!env.doc.querySelector('#vo-shell .vo-hd .vo-docmode'), false, 'reader has .vo-docmode in the header');
    assert.equal(!!env.modeItem('edit'), false, 'reader is offered «Editing»');
    assert.equal(env.bar(), null, 'reader has a formatting toolbar');
    const st = env.shell.lockState();
    assert.equal(st.on, true, 'reader is not locked by the right');
    assert.equal(st.type, 'rights');
    /* The edit items are inactive with the "no right" reason. */
    Object.keys(EDIT_ITEMS).forEach(sec => {
        const rows = env.section(SECTION(env, sec));
        EDIT_ITEMS[sec].forEach(k => {
            assert.ok(rows[k], k + ' is not in ' + sec);
            assert.equal(rows[k].off, true, k + ' is active for a reader');
            assert.equal(rows[k].reason, env.shell.textModeLockedRights, k + ': reason ' + rows[k].reason);
        });
    });
    const view = env.section(SECTION(env, 'View'));
    assert.equal(view.hideToolbar.off, true, '«Hide toolbar» is active without a toolbar');
    assert.equal(view.hideToolbar.reason, env.shell.textModeLockedRights);
    /* There is no "Object properties". */
    assert.equal(view.objectProps, undefined, '«Object settings» is still in View for a reader');
    /* Search, download and print are alive; there is no way into editing - the stock does not give it. */
    const file = env.section(SECTION(env, 'File'));
    /* The download formats are in "Download ▸". */
    ['download', 'print'].forEach(k => assert.equal(file[k] && file[k].off, false, k + ' is not alive for a reader'));
    const formats = env.kids(SECTION(env, 'File'), 'download');
    ['downloadXlsx', 'downloadPdf', 'downloadCsv', 'downloadOds'].forEach(k => assert.equal(formats[k] && formats[k].off, false, k + ' is not alive for a reader'));
    assert.equal(file.editDoc, undefined, '«Edit spreadsheet» without canRequestEditRights');
    const edit = env.section(SECTION(env, 'Edit'));
    assert.equal(edit.findReplace.off, false, 'search is not alive for a reader');
    /* Print and "Select all" in the reader stock are alive by another path (the file menu, Ctrl+A), although
       there are no ribbon buttons: the items are alive and go their own way. */
    assert.equal(edit.selectAll.off, false, '«Select all» is inactive for a reader');
    env.api.asc_EditSelectAll = () => env.log.push('engine: select all');
    env.sectionButton(SECTION(env, 'Edit')).click();
    env.doc.querySelector('[data-k="selectAll"]').click();
    env.sectionButton(SECTION(env, 'File')).click();
    env.NC.on('print', () => env.log.push('stock: print'));
    env.doc.querySelector('[data-k="print"]').click();
    assert.deepEqual(env.log.filter(s => /^engine|^stock/.test(s)), ['engine: select all', 'stock: print'], 'reader select all / print did not reach the stock');
    /* A reader has no edit doubles in the standard - there are no warnings. */
    noWarnings(env);
});

test('request_edit_rights_by_stock_condition', () => {
    /* The item exists exactly when the standard file menu would show miEdit. */
    for (const isEdit of [false, true]) for (const canEdit of [false, true]) for (const req of [false, true]) {
        const opts = {isEdit, canEdit, canRequestEditRights: req};
        const env = makeEnv({reader: !isEdit, options: opts}).create();
        const file = env.section(SECTION(env, 'File'));
        const want = MI_EDIT(env.appOptions);
        assert.equal(!!file.editDoc, want, 'editDoc presence differs from stock miEdit for ' + JSON.stringify(opts));
        if (!want) continue;
        assert.equal(file.editDoc.off, false, '«Edit spreadsheet» is inactive for ' + JSON.stringify(opts));
        /* The standard path: a row click → LeftMenu.clickMenuFileItem(null, 'edit') → Gateway. */
        env.sectionButton(SECTION(env, 'File')).click();
        const row = env.doc.querySelector('[data-k="editDoc"]');
        row.click();
        assert.deepEqual(env.log.filter(s => /^file |gateway/.test(s)), ['file edit', 'gateway: request edit rights'],
            'not one stock request: ' + JSON.stringify(env.log));
        noWarnings(env);
    }
});

/* There is no "Access rights" in "File" for anyone: it led to the same portal access window as "Collaboration → Access to the
   document", and the portal does not pass the list of those who have access to the editor. The item is absent for an editor in "Editing" and in
   "Viewing", for a reader with the right to request editing and without it - both with the document access list and with the integration access settings
   handler (the former item condition); the menu row does not open the standard rights panel. */
const SHARE_DOC = {info: {sharingSettings: [{user: 'u', permissions: 'Full Access'}]}};
test('file_has_no_access_rights_in_any_role', () => {
    const share = {canRequestSharingSettings: true, sharingSettingsUrl: 'https://portal/share'};
    const roles = [
        ['an editor', {options: share}, null],
        ['an editor in «Viewing»', {options: share}, 'view'],
        ['a reader who may ask for editing', {reader: true, options: Object.assign({isEdit: false, canEdit: true, canRequestEditRights: true}, share)}, null],
        ['a plain reader', {reader: true, options: share}, null]
    ];
    roles.forEach(([who, opt, mode]) => {
        const env = makeEnv(opt).create();
        env.SSE.getController('LeftMenu').leftMenu.menuFile.document = SHARE_DOC;
        if (mode) env.choose(mode);
        const file = env.section(SECTION(env, 'File'));
        assert.ok(!('accessRights' in file), '«Access rights» is in File for ' + who);
        const g = env.A.groups().find(x => x.label === SECTION(env, 'File'));
        assert.ok(!g.items.some(it => it.k === 'accessRights' || (it.items && it.items.some(c => c.k === 'accessRights'))),
            '«Access rights» is offered to ' + who);
        assert.equal(env.A.item('accessRights') === null, true, '«Access rights» is in the catalog for ' + who);
        assert.ok(!env.log.some(l => /^show file:rights/.test(l)), 'the stock rights panel is opened for ' + who);
        noWarnings(env);
    });
});

/* "Edit spreadsheet" - for a reader who can ask for the edit right it is the first "File" item and alive, with no
   restriction reason: for them it is the only way into editing. The click is the standard edit request. The condition of appearing is the former
   one (the stock miEdit); for an editor in "Viewing" there is no item (the stock does not give it). */
test('edit_document_stays_first_in_file_for_a_reader', () => {
    const opts = {isEdit: false, canEdit: true, canRequestEditRights: true};
    const reader = makeEnv({reader: true, options: opts}).create();
    reader.SSE.getController('LeftMenu').leftMenu.menuFile.document = SHARE_DOC;
    assert.equal(MI_EDIT(reader.appOptions), true, 'precondition: the stock file menu shows «Edit spreadsheet» to this reader');
    const g = reader.A.groups().find(x => x.label === SECTION(reader, 'File'));
    assert.equal(g.items[0].k, 'editDoc', '«Edit spreadsheet» is not the first item of File: ' + g.items.map(i => i.k || '--').join(' '));
    const rows = reader.section(SECTION(reader, 'File'));
    assert.deepEqual([rows.editDoc.off, rows.editDoc.reason], [false, null], '«Edit spreadsheet» is inactive for a reader');
    reader.shell.closeSurfaces();
    reader.sectionButton(SECTION(reader, 'File')).click();
    const drop = reader.doc.querySelector('[data-k="editDoc"]').parentNode;
    assert.equal(Array.from(drop.children).filter(c => c.getAttribute('data-k'))[0].getAttribute('data-k'), 'editDoc',
        '«Edit spreadsheet» is not the first row of File');
    reader.shell.closeSurfaces();
    reader.log.length = 0;
    reader.clickItem(SECTION(reader, 'File'), 'editDoc');
    assert.deepEqual(reader.log.filter(l => /^show |^file |gateway/.test(l)), ['file edit', 'gateway: request edit rights'],
        'not one stock request of editing');
    noWarnings(reader);
    const editor = makeEnv().create();
    editor.choose('view');
    assert.ok(!('editDoc' in editor.section(SECTION(editor, 'File'))), 'an editor in «Viewing» is offered «Edit spreadsheet» (the stock miEdit hides it)');
    editor.choose('edit');
    noWarnings(editor);
});

/* "Normal · Page layout" are "View" section items with the edit rule: in "Viewing" both are in place and inactive with the reason
   "Viewing", for a reader - with the reason of the right; they have no holder; the click does not reach the standard view buttons. After returning to
   editing both are alive. */
test('view_pair_is_inactive_in_viewing', () => {
    const editor = makeEnv().create();
    editor.choose('view');
    const v = editor.section(SECTION(editor, 'View'));
    ['viewNormal', 'viewPageLayout'].forEach(k => {
        assert.ok(v[k], k + ' is not a row of View in «Viewing»');
        assert.deepEqual([v[k].off, v[k].reason], [true, editor.shell.textModeLockedView], k + ' is not inactive in «Viewing»');
    });
    assert.ok(!('mode' in v), '«Mode ▸» is still in View');
    editor.log.length = 0;
    ['viewNormal', 'viewPageLayout'].forEach(k => editor.clickItem(SECTION(editor, 'View'), k));
    assert.deepEqual(editor.log.filter(l => /^click ViewTab:/.test(l)), [], 'a view button was clicked in «Viewing»');
    editor.choose('edit');
    const back = editor.section(SECTION(editor, 'View'));
    ['viewNormal', 'viewPageLayout'].forEach(k => assert.equal(back[k].off, false, k + ' stays inactive after «Viewing»'));
    noWarnings(editor);
    const reader = makeEnv({reader: true}).create();
    const r = reader.section(SECTION(reader, 'View'));
    ['viewNormal', 'viewPageLayout'].forEach(k => {
        assert.ok(r[k], k + ' is not a row of View for a reader');
        assert.deepEqual([r[k].off, r[k].reason], [true, reader.shell.textModeLockedRights], k + ' is not inactive for a reader');
    });
    noWarnings(reader);
});

/* In "Viewing" "Macros ▸ → Macros" is available (the macros window does not change the workbook, a
   macro cannot be saved without the edit right); "Record macro" and "Pause recording" are unavailable. A reader is always in "Viewing", and the macro
   buttons are not built for them by the stock (view/ViewTab.js: only with isEdit): "Macros" is alive without a reason, the click is the handler of the standard button (the macros
   window, controller/ViewTab.js onClickMacros), one; recording is inactive with the reason of the right; the holder is alive; there are no missing-item warnings.
   The integration turned macros off (customization.macros: false) - there is no "Macros ▸" for anyone (the stock button condition). The negative
   control is a catalog where for a reader "Macros ▸" is disabled as a whole, and a catalog without the when condition on the holder. */
test('macros_live_for_reader', () => {
    const reader = makeEnv({reader: true}).create();
    const view = reader.deep(SECTION(reader, 'View'));
    assert.ok(view.macrosMenu, '«Macros ▸» is not in View for a reader');
    assert.deepEqual([view.macrosMenu.off, view.macrosMenu.reason], [false, null], '«Macros ▸» is inactive for a reader');
    assert.deepEqual([view.macros.off, view.macros.reason], [false, null], '«Macros» is inactive for a reader');
    ['recordMacro', 'pauseMacro'].forEach(k => {
        assert.equal(view[k].off, true, k + ' is live for a reader');
        assert.equal(view[k].reason, reader.shell.textModeLockedRights, k + ': reason ' + view[k].reason);
    });
    reader.log.length = 0;
    assert.equal(reader.clickItem(SECTION(reader, 'View'), 'macros'), true, 'precondition: the row of «Macros» is on screen');
    assert.deepEqual(reader.log.filter(l => /macros/i.test(l)), ['stock macros window'], 'not one stock macros window for a reader');
    noWarnings(reader);
    const off = makeEnv({options: {customization: {macros: false}}}).create();
    assert.equal(!!off.section(SECTION(off, 'View')).macrosMenu, false, '«Macros ▸» without macros at the integration');
    const offReader = makeEnv({reader: true, options: {customization: {macros: false}}}).create();
    assert.equal(!!offReader.section(SECTION(offReader, 'View')).macrosMenu, false, '«Macros ▸» for a reader without macros at the integration');
});

test('disconnect_masks_toolbar_and_menu', () => {
    const env = makeEnv().create();
    assert.ok(env.bar(), 'precondition: editor toolbar');
    env.main.disableEditing(true);                       // a standard connection loss (type 'disconnect')
    const bar = env.bar();
    assert.ok(bar.classList.contains('vo-masked'), 'toolbar is not masked');
    assert.ok(bar.querySelector('.vo-tb-mask'), 'no mask layer over the toolbar');
    /* The ribbon doubles are under the stock ribbon mask: inactive. */
    const format = env.section(SECTION(env, 'Format'));
    ['borders', 'merge', 'conditional', 'indent'].forEach(k => assert.equal(format[k].off, true, k + ' is active under the stock mask'));
    assert.equal(env.section(SECTION(env, 'Data')).sortAZ.off, true);
    /* The others follow their own state in the stock: the file menu, search, history (the stock has its own reason). */
    const file = env.section(SECTION(env, 'File'));
    ['download', 'print', 'docInfo'].forEach(k => assert.equal(file[k].off, false, k + ' is inactive on lost connection'));
    /* The download formats are in "Download ▸". */
    const formats = env.kids(SECTION(env, 'File'), 'download');
    assert.equal(formats.downloadXlsx && formats.downloadXlsx.off, false, 'downloadXlsx is inactive on lost connection');
    assert.equal(env.section(SECTION(env, 'Edit')).findReplace.off, false, 'search is inactive on lost connection');
    const review = env.section(SECTION(env, 'Collaboration'));
    assert.equal(review.history.off, false, 'history follows the ribbon mask, not its own stock state');
    assert.equal(review.comments.off, true, 'comments panel is alive while the stock disabled its button');
    assert.ok(env.modeButton().classList.contains('vo-locked'), 'mode switch is not locked on lost connection');
    /* The connection returned - no mask, the items are alive. */
    env.main.disableEditing(false);
    assert.equal(env.bar().classList.contains('vo-masked'), false, 'toolbar stays masked');
    assert.equal(env.bar().querySelector('.vo-tb-mask'), null);
    assert.equal(env.section(SECTION(env, 'Format')).borders.off, false, 'borders stay inactive');
    assert.equal(env.modeButton().classList.contains('vo-locked'), false);
    noWarnings(env);
});

test('event_lock_over_right_lock', () => {
    /* A reader: the stack event lies on top of the right, its removal returns to the right, not to editing. */
    const reader = makeEnv({reader: true}).create();
    reader.main.disableEditing(true, 'reconnect');
    let st = reader.shell.lockState();
    assert.equal(st.type, 'reconnect', 'stack cause is not on top of the right');
    assert.equal(st.options.viewMode, true, 'stack cause options are not used');
    reader.main.disableEditing(false, 'reconnect');
    st = reader.shell.lockState();
    assert.equal(st.on, true, 'restored connection gave the reader editing');
    assert.equal(st.type, 'rights');
    /* An editor in "Viewing": a connection loss on top, its removal returns "Viewing". */
    const editor = makeEnv().create();
    assert.equal(editor.shell.lockState().on, false, 'editor starts locked');
    editor.choose('view');
    assert.equal(editor.shell.lockState().type, 'vo-view');
    editor.main.disableEditing(true, 'reconnect');
    assert.equal(editor.shell.lockState().type, 'reconnect');
    editor.main.disableEditing(false, 'reconnect');
    assert.equal(editor.shell.lockState().type, 'vo-view', 'stack did not restore the own cause');
    editor.choose('edit');
    assert.equal(editor.shell.lockState().on, false);
    noWarnings(reader);
    noWarnings(editor);
});

test('view_mode_menu_follows_stock_mask', () => {
    const env = makeEnv().create();
    env.choose('view');
    const format = env.section(SECTION(env, 'Format'));
    ['borders', 'merge'].forEach(k => {
        assert.equal(format[k].off, true, k + ' is active in view');
        assert.equal(format[k].reason, env.shell.textModeLockedView, k + ': reason ' + format[k].reason);
    });
    const edit = env.section(SECTION(env, 'Edit'));
    assert.equal(edit.undo.off, true, 'undo is active in view');
    assert.equal(edit.selectAll.off, false, 'select all is not reading');
    assert.equal(edit.findReplace.off, false);
    /* With the children of composite items ("Show ▸" and others). */
    const view = env.deep(SECTION(env, 'View'));
    /* The "View" commands that the engine performs only when editing: in "Viewing" they are inactive with a
       reason - otherwise the item is alive and the engine silently rejects the click. */
    VIEW_ENGINE_EDIT.forEach(k => {
        assert.ok(view[k], k + ' is not in View');
        assert.equal(view[k].off, true, k + ' is active in view while the engine refuses it');
        assert.equal(view[k].reason, env.shell.textModeLockedView, k + ': reason ' + view[k].reason);
    });
    /* A holder whose children are all editing is inactive with the reason of the first. */
    VIEW_EDIT_HOLDERS.forEach(k => {
        assert.ok(view[k] && view[k].off, k + ' is active in view: all its items are editing');
        assert.equal(view[k].reason, env.shell.textModeLockedView, k + ': reason ' + view[k].reason);
    });
    /* Reading in "View" is alive. */
    VIEW_READING.forEach(k => assert.equal(view[k].off, false, k + ' is inactive in view: ' + view[k].reason));
    /* "View → Macros ▸": "Macros" is alive, recording
       is disabled - the holder is alive. */
    assert.ok(view.macrosMenu, '«Macros ▸» is not in View');
    assert.equal(view.macrosMenu.off, false, '«Macros ▸» is inactive in view: ' + view.macrosMenu.reason);
    assert.equal(view.macros.holder, 'macrosMenu', '«Macros» is not a child of «Macros ▸»');
    assert.equal(view.hideToolbar.off, true, '«Hide toolbar» is active without a toolbar row');
    assert.equal(view.hideToolbar.reason, env.shell.textModeLockedView);
    assert.equal(view.objectProps, undefined, '«Object settings» is still in View');
    assert.equal(view.focus.off, false, 'focus mode is not editing');
    const file = env.section(SECTION(env, 'File'));
    assert.equal(file.print.off, false, 'print follows the ribbon mask: its stock path is the File menu');
    /* "Margins ▸" was removed from "File" (it is in the print window) - the page layout
       in "File" is represented by "Print area ▸", a double of the same "Layout" tab under the ribbon mask. */
    assert.ok(!file.margins, '«Margins ▸» is still in File');
    assert.equal(file.printArea.off, true, 'page setup is active in view');
    env.choose('edit');
    assert.equal(env.section(SECTION(env, 'Format')).borders.off, false, 'borders stay inactive after view');
    const back = env.deep(SECTION(env, 'View'));
    assert.equal(back.hideToolbar.off, false);
    ['freeze', 'viewNormal', 'viewPageLayout', 'showFormulas', 'sheetDirection', 'createView', 'recordMacro']
        .concat(VIEW_EDIT_HOLDERS, ['gridlines', 'headings', 'zeros'])
        .forEach(k => assert.equal(back[k].off, false, k + ' stays inactive after view'));
    noWarnings(env);
});

/* In "Viewing" "Copy" is available (if copying is allowed by the rights),
   "Cut" and "Paste" are unavailable. A reader is always in "Viewing": their ribbon is copy,
   paste, undo, redo, without handlers; "Copy" is alive, "Cut" and "Paste" are inactive with the reason of the right.
   An editor who chose "Viewing": the same, the reason is "Viewing"; back to editing - all three are alive. Without the copy right
   "Copy" is inactive for both the reader and the editor. */
test('edit_copy_live_in_view_cut_paste_off', () => {
    const reader = makeEnv({reader: true}).create();
    const r = reader.section(SECTION(reader, 'Edit'));
    assert.ok(r.cut && r.copy && r.paste, 'a reader lost an item of Edit: ' + Object.keys(r).join(' '));
    assert.equal(r.copy.off, false, '«Copy» is inactive for a reader: ' + r.copy.reason);
    ['cut', 'paste'].forEach(k => {
        assert.equal(r[k].off, true, k + ' is active for a reader');
        assert.equal(r[k].reason, reader.shell.textModeLockedRights, k + ': reason ' + r[k].reason);
    });
    noWarnings(reader);
    const editor = makeEnv().create();
    const live = editor.section(SECTION(editor, 'Edit'));
    ['cut', 'copy', 'paste'].forEach(k => assert.equal(live[k].off, false, k + ' is inactive in «Editing»'));
    editor.choose('view');
    const v = editor.section(SECTION(editor, 'Edit'));
    assert.equal(v.copy.off, false, '«Copy» is inactive in «Viewing»: ' + v.copy.reason);
    ['cut', 'paste'].forEach(k => {
        assert.equal(v[k].off, true, k + ' is active in «Viewing»');
        assert.equal(v[k].reason, editor.shell.textModeLockedView, k + ': reason ' + v[k].reason);
    });
    editor.choose('edit');
    const back = editor.section(SECTION(editor, 'Edit'));
    ['cut', 'copy', 'paste'].forEach(k => assert.equal(back[k].off, false, k + ' stays inactive after «Viewing»'));
    noWarnings(editor);
    for (const opt of [{reader: true, options: {canCopy: false}}, {options: {canCopy: false}}]) {
        const env = makeEnv(opt).create();
        const rows = env.section(SECTION(env, 'Edit'));
        assert.ok(rows.copy, '«Copy» disappeared without the copy right (' + (opt.reader ? 'reader' : 'editor') + ')');
        assert.equal(rows.copy.off, true, '«Copy» is active without the copy right (' + (opt.reader ? 'reader' : 'editor') + ')');
    }
});

/* "Edit → Clear ▸" and "Delete cells ▸" are unavailable in "Viewing" -
   the ribbon buttons are under the stock mask, the reason is "Viewing"; a reader has no such buttons - the items are in place inactive with the reason of the right,
   without missing-item warnings. */
test('edit_clear_and_delete_cells_off_in_view', () => {
    const editor = makeEnv().create();
    const live = editor.section(SECTION(editor, 'Edit'));
    ['deleteCells', 'clear'].forEach(k => assert.equal(live[k] && live[k].off, false, k + ' is not live in «Editing»'));
    editor.choose('view');
    const v = editor.section(SECTION(editor, 'Edit'));
    ['deleteCells', 'clear'].forEach(k => {
        assert.equal(v[k] && v[k].off, true, k + ' is active in «Viewing»');
        assert.equal(v[k].reason, editor.shell.textModeLockedView, k + ': reason ' + v[k].reason);
    });
    noWarnings(editor);
    const reader = makeEnv({reader: true}).create();
    const r = reader.section(SECTION(reader, 'Edit'));
    ['deleteCells', 'clear'].forEach(k => {
        assert.equal(r[k] && r[k].off, true, k + ' is active for a reader');
        assert.equal(r[k].reason, reader.shell.textModeLockedRights, k + ': reason ' + r[k].reason);
    });
    noWarnings(reader);
});

/* In "Viewing" "View → Zoom ▸" is available - zoom does not change the
   workbook. Availability comes from the sheet row zoom button: the row is not the ribbon, the restriction mask does not disable it, the item has no edit sign;
   a reader is always in "Viewing" - the same. The stock disabled the row buttons (a cell edit) - the holder and all six rows are inactive. */
test('view_zoom_live_in_view_and_for_reader', () => {
    const ZOOMS = ['zoom50', 'zoom75', 'zoom100', 'zoom125', 'zoom150', 'zoom200'];
    for (const opt of [{}, {reader: true}]) {
        const who = opt.reader ? 'reader' : '«Viewing»';
        const env = makeEnv(opt).create();
        if (!opt.reader) env.choose('view');
        const view = env.section(SECTION(env, 'View'));
        assert.ok(view.zoom, '«Zoom ▸» is not in View (' + who + ')');
        assert.equal(view.zoom.off, false, '«Zoom ▸» is inactive (' + who + '): ' + view.zoom.reason);
        const kids = env.kids(SECTION(env, 'View'), 'zoom');
        assert.deepEqual(Object.keys(kids), ZOOMS, '«Zoom ▸» rows (' + who + ')');
        ZOOMS.forEach(k => assert.equal(kids[k].off, false, k + ' is inactive (' + who + ')'));
        env.SSE.getController('Statusbar').statusbar.btnZoomUp.setDisabled(true);
        assert.equal(env.section(SECTION(env, 'View')).zoom.off, true, '«Zoom ▸» is live while the stock zoom is locked (' + who + ')');
        noWarnings(env);
    }
});

/* "Insert → Sheet" changes the workbook - in "Viewing" it is unavailable, although the sheet row
   "+" button is alive (the row is not the ribbon, the restriction mask does not disable it): the engine verdict (edit), the reason is "Viewing"; for a reader -
   the reason of the right. Back to editing - alive; a click in "Viewing" does not reach the standard button. */
test('insert_sheet_off_in_view_and_for_reader', () => {
    const editor = makeEnv().create();
    assert.equal(editor.section(SECTION(editor, 'Insert')).sheet.off, false, '«Sheet» is inactive in «Editing»');
    editor.choose('view');
    const v = editor.section(SECTION(editor, 'Insert')).sheet;
    assert.ok(v && v.off, '«Sheet» is live in «Viewing» while the engine refuses to edit');
    assert.equal(v.reason, editor.shell.textModeLockedView, '«Sheet»: reason ' + v.reason);
    assert.equal(editor.clickItem(SECTION(editor, 'Insert'), 'sheet'), true, 'precondition: the row of «Sheet» is on screen');
    assert.deepEqual(editor.log.filter(l => /Statusbar:btnAddWorksheet/.test(l)), [], 'a «Sheet» click in «Viewing» reached the stock «+»');
    editor.choose('edit');
    assert.equal(editor.section(SECTION(editor, 'Insert')).sheet.off, false, '«Sheet» stays inactive after «Viewing»');
    noWarnings(editor);
    const reader = makeEnv({reader: true}).create();
    const r = reader.section(SECTION(reader, 'Insert')).sheet;
    assert.ok(r && r.off, '«Sheet» is live for a reader');
    assert.equal(r.reason, reader.shell.textModeLockedRights, '«Sheet» for a reader: reason ' + r.reason);
    noWarnings(reader);
});

/* "Data → Formulas ▸" and "Analysis ▸" are unavailable in "Viewing" - their items (the buttons of the
   "Formula" and "Data" ribbon tabs) are under the restriction mask: the holder is inactive as a whole with the "Viewing" reason, there is no layer; a reader has no
   tabs - inactive with the reason of the right, without missing-item warnings. Back to editing - alive. */
test('data_formulas_off_in_view_and_for_reader', () => {
    const editor = makeEnv().create();
    const HOLDERS = ['formulas', 'analysis'];
    HOLDERS.forEach(k => assert.equal(editor.section(SECTION(editor, 'Data'))[k].off, false, k + ' is inactive in «Editing»'));
    editor.choose('view');
    HOLDERS.forEach(k => {
        const v = editor.section(SECTION(editor, 'Data'))[k];
        assert.ok(v && v.off, k + ' is live in «Viewing»');
        assert.equal(v.reason, editor.shell.textModeLockedView, k + ': reason ' + v.reason);
        assert.equal(editor.kids(SECTION(editor, 'Data'), k) && Object.keys(editor.kids(SECTION(editor, 'Data'), k)).length, 0,
            'a locked ' + k + ' opened its layer in «Viewing»');
    });
    editor.choose('edit');
    HOLDERS.forEach(k => assert.equal(editor.section(SECTION(editor, 'Data'))[k].off, false, k + ' stays inactive after «Viewing»'));
    noWarnings(editor);
    const reader = makeEnv({reader: true}).create();
    HOLDERS.forEach(k => {
        const r = reader.section(SECTION(reader, 'Data'))[k];
        assert.ok(r && r.off, k + ' is live for a reader');
        assert.equal(r.reason, reader.shell.textModeLockedRights, k + ' for a reader: reason ' + r.reason);
    });
    noWarnings(reader);
});

/* In "Viewing" "Rows, columns and sheet ▸ · Format cells · Text ▸ ·
   Alignment ▸ · Wrap text · Indent ▸" are unavailable: the new and moved "Format" items are inactive in "Viewing" and for a reader (the doubles are
   ribbon buttons under the stock restriction mask; a reader has no edit ribbon), the reason is "Viewing" or the right; the holder does not open the layer.
   Back in "Editing" - alive. */
const FORMAT_VIEW_OFF = ['rowsColsSheet', 'formatCells', 'text', 'align', 'wrap', 'indent', 'clearFormat'];
const FORMAT_VIEW_HOLDERS = ['text', 'align', 'indent'];
test('format_items_off_in_view_and_for_reader', () => {
    const editor = makeEnv().create();
    const fmt = () => editor.section(SECTION(editor, 'Format'));
    FORMAT_VIEW_OFF.forEach(k => assert.ok(fmt()[k] && fmt()[k].off === false, k + ' is not live in «Editing»'));
    editor.choose('view');
    const v = fmt();
    FORMAT_VIEW_OFF.forEach(k => {
        assert.ok(v[k] && v[k].off, k + ' is live in «Viewing»');
        assert.equal(v[k].reason, editor.shell.textModeLockedView, k + ': reason ' + v[k].reason);
    });
    FORMAT_VIEW_HOLDERS.forEach(k => assert.equal(Object.keys(editor.kids(SECTION(editor, 'Format'), k) || {}).length, 0, 'a locked ' + k + ' opened its layer in «Viewing»'));
    assert.equal(editor.clickItem(SECTION(editor, 'Format'), 'formatCells'), true, 'precondition: the row of «Format cells» is on screen');
    assert.deepEqual(editor.log.filter(l => /btnFormatCell/.test(l)), [], 'a «Format cells» click in «Viewing» reached the stock');
    editor.choose('edit');
    FORMAT_VIEW_OFF.forEach(k => assert.equal(fmt()[k].off, false, k + ' stays inactive after «Viewing»'));
    noWarnings(editor);
    const reader = makeEnv({reader: true}).create();
    const r = reader.section(SECTION(reader, 'Format'));
    FORMAT_VIEW_OFF.forEach(k => {
        assert.ok(r[k] && r[k].off, k + ' is live for a reader');
        assert.equal(r[k].reason, reader.shell.textModeLockedRights, k + ' for a reader: reason ' + r[k].reason);
    });
    noWarnings(reader);
});

/* The stock disables "Dark sheet" in the light interface theme with its own reason
   (controller/ViewTab.js: lockControls(enumLock.inLightTheme) - the spreadsheet editor has no such key, undefined
   goes into keepState) and does not name it. The restriction caption ("Not available in view mode") of
   such an item is foreign - it is neither in "Editing" nor in "Viewing". The restriction reason
   stays where the restriction was disabled: the stock viewMode reason (ReviewChanges.SetDisabled) or
   a double disabled directly (SetDisabled without a reason). There is no "Dark sheet" item in the catalog,
   and the rule is general (SheetActions.modeCaused) - it is held by a case item on the same standard double. */
test('stock_own_cause_gets_no_mode_reason', () => {
    const env = makeEnv();
    const A = env.A, orig = A.catalog;
    A.catalog = function () {
        const c = orig.call(this);
        c[2].items.push({sep: true}, {k: 'tstDark', t: 'Dark sheet', twin: 'ViewTab:btnDarkDocument', check: true});
        return c;
    };
    env.create();
    const dark = env.roots.ViewTab.btnDarkDocument;
    const darkRow = () => { const r = env.section(SECTION(env, 'View')).tstDark; return [r.off, r.reason]; };
    dark.keepState = [undefined];
    dark.setDisabled(true);
    assert.deepEqual(darkRow(), [true, null], '«Editing», light interface theme: dark sheet is not inactive without a reason');
    env.choose('view');
    assert.deepEqual(darkRow(), [true, null], '«Viewing», light interface theme: dark sheet got the reason of the view mode');
    dark.keepState = ['view-mode'];
    assert.deepEqual(darkRow(), [true, env.shell.textModeLockedView], 'locked by the view mode cause: the reason is lost');
    dark.keepState = [undefined, 'view-mode'];
    assert.deepEqual(darkRow(), [true, env.shell.textModeLockedView], 'own cause next to the view mode cause: the reason is lost');
    dark.keepState = [];
    assert.deepEqual(darkRow(), [true, env.shell.textModeLockedView], 'disabled without a cause under the view mode: the reason is lost');
    /* The dark interface theme - the double is alive, the item is alive in "Viewing" too (reading). */
    dark.setDisabled(false);
    assert.deepEqual(darkRow(), [false, null], 'dark interface theme: dark sheet is not alive in «Viewing»');
    env.choose('edit');
    dark.keepState = [undefined];
    dark.setDisabled(true);
    assert.deepEqual(darkRow(), [true, null], 'back in «Editing»: dark sheet is not inactive without a reason');
    noWarnings(env);
});

test('view_named_sheet_views_do_not_write', () => {
    /* "New view" and "Named views ▸ View
       manager" write to the workbook, and the engine does not reject them without editing (sdkjs cell/api.js:
       asc_addNamedSheetView, asc_deleteNamedSheetViews and CT_NamedSheetView.asc_setName take
       the collaborativeEditing.lock lock, where canEdit() is not checked - unlike
       checkObjectsLock of macros). The stock hides them only for a reader (view/ViewTab.js builds the buttons
       with isEdit), while "Viewing" leaves the editor an editor. In "Viewing" a real row click
       reaches neither the double nor the view manager menu mirror, and no views are added;
       in "Editing" the same click is the standard path (a control). */
    const env = makeEnv();
    const views = [];
    /* The engine as in sdkjs: writes without checking canEdit(). */
    env.api.asc_getNamedSheetViews = () => views.slice();
    env.api.asc_addNamedSheetView = () => { views.push('Представление' + (views.length + 1)); };
    /* The stock: controller/ViewTab.js onCreateView - asc_addNamedSheetView(null, true). */
    const create = env.roots.ViewTab.btnCreateView, stockClick = create.click;
    create.click = function () { stockClick.call(this); if (!this.disabled) env.api.asc_addNamedSheetView(null, true); };
    env.create();
    const B = env.SSE.Views.StockBridge, mirrored = [], mirror = B.mirror;
    B.mirror = function (ref) { mirrored.push(ref); return mirror.apply(this, arguments); };
    /* "Named views ▸ · New view" → "Views ▸"
       with the same items: the stock menu rows in place are read when the layer opens, "New view" is its row. */
    const clickRow = k => env.clickItem(SECTION(env, 'View'), k);
    env.choose('view');
    assert.equal(env.api.canEdit(), false, 'precondition: canEdit() in view');
    const view = env.deep(SECTION(env, 'View'));
    ['views', 'createView'].forEach(k => {
        assert.equal(!!view[k], true, k + ' disappeared in view (inactive, not hidden)');
        assert.equal(view[k].off, true, k + ' is active in view while it writes to the workbook');
        assert.equal(view[k].reason, env.shell.textModeLockedView, k + ': reason ' + view[k].reason);
    });
    ['createView', 'views'].forEach(clickRow);
    assert.equal(env.api.asc_getNamedSheetViews().length, 0, 'a named view was added in view: ' + JSON.stringify(views));
    assert.deepEqual(mirrored, [], 'named views manager menu was read from the stock in view');
    assert.deepEqual(env.log.filter(s => /^click ViewTab:/.test(s)), [], 'named view command reached the stock in view');
    env.choose('edit');
    assert.ok(clickRow('createView'), 'control: no «Create view» row in edit');
    assert.deepEqual(env.api.asc_getNamedSheetViews(), ['Представление1'], 'control: «Create view» did not reach the engine in edit');
    assert.deepEqual(mirrored, ['ViewTab:btnSheetView'], 'control: named views manager menu is not read in edit');
    assert.deepEqual(env.log.filter(s => /^click ViewTab:/.test(s)), ['click ViewTab:btnCreateView'], 'control: command did not reach the stock in edit');
    noWarnings(env);
});

test('view_engine_edit_commands_do_not_run', () => {
    /* The second end of the gate: a real row click in "Viewing" does not reach the double - neither
       the standard button click nor the mirror of its menu (the freeze submenu); in "Editing" the same
       click is the standard path of the double. */
    const env = makeEnv().create();
    const B = env.SSE.Views.StockBridge, mirrored = [], mirror = B.mirror;
    B.mirror = function (ref) { mirrored.push(ref); return mirror.apply(this, arguments); };
    /* A row - also of a composite item child ("Show ▸"): in "Viewing"
       the holder is disabled and does not open the layer - the child row cannot be reached, as the double cannot. */
    const clickRow = k => env.clickItem(SECTION(env, 'View'), k);
    env.choose('view');
    ['freeze', 'viewNormal', 'viewPageLayout', 'gridlines', 'showFormulas', 'sheetDirection', 'recordMacro'].forEach(clickRow);
    assert.deepEqual(mirrored, [], '«Freeze panes» submenu was read from the stock in view');
    assert.deepEqual(env.log.filter(s => VIEW_EDIT_CLICK.test(s)), [], 'engine edit command reached the stock in view');
    env.choose('edit');
    ['freeze', 'viewPageLayout', 'gridlines', 'showFormulas', 'sheetDirection'].forEach(k => assert.ok(clickRow(k), 'no row ' + k + ' in edit'));
    assert.deepEqual(mirrored, ['ViewTab:btnFreezePanes'], '«Freeze panes» submenu is not read in edit');
    assert.deepEqual(env.log.filter(s => VIEW_EDIT_CLICK.test(s)),
        ['click ViewTab:btnViewPageBreak', 'check ViewTab:chGridlines true', 'click Formula:btnShowFormulas', 'click Toolbar:btnRtlSheet'],
        'command did not reach the stock in edit');
    noWarnings(env);
});

test('engine_verdict_gates_view_commands_without_mask', () => {
    /* "Show formulas" and "Sheet direction" are visible in "Viewing", but the engine does not perform them without
       editing - both go to WorksheetView.changeSheetViewSettings (sdkjs
       cell/view/WorksheetView.js), which exits right away when !canEdit(). The items are disabled by
       the engine verdict (the edit sign), like the other "View" commands with editing, not by the ribbon mask of the
       stock: the engine refuses editing, but there is no reason in the stack and no mask - the items are inactive all the same,
       reading in "View" is alive. The engine accepts editing again - the items are alive. */
    const env = makeEnv().create();
    env.api.isViewMode = true;
    assert.equal(env.api.canEdit(), false, 'precondition: the engine refuses editing');
    assert.equal(env.shell.lockState().on, false, 'precondition: no stock cause, no ribbon mask');
    /* With the children of composite items. */
    let view = env.deep(SECTION(env, 'View'));
    VIEW_ENGINE_EDIT.forEach(k => {
        assert.ok(view[k], k + ' is not in View');
        assert.equal(view[k].off, true, k + ' is active while the engine refuses editing');
    });
    VIEW_READING.forEach(k => assert.equal(view[k].off, false, k + ' is inactive while it only reads: ' + view[k].reason));
    env.api.isViewMode = false;
    view = env.deep(SECTION(env, 'View'));
    VIEW_ENGINE_EDIT.filter(k => k !== 'pauseMacro').forEach(k => assert.equal(view[k].off, false, k + ' stays inactive after the engine accepts editing'));
    noWarnings(env);
});

test('comment_rows_stay_visible_and_inactive_in_view', () => {
    const env = makeEnv().create();
    const rows = () => Object.assign({}, env.section(SECTION(env, 'Insert')), env.section(SECTION(env, 'Collaboration')));
    let r = rows();
    COMMENT_ROWS.forEach(k => {
        assert.ok(r[k], k + ' is not in the menu in edit');
        assert.equal(r[k].off, false, k + ' is inactive in edit');
    });
    env.choose('view');
    /* A precondition: for the time of "Viewing" the stock really disabled the right in the shared appOptions. */
    assert.deepEqual(env.stockLog.filter(s => /^comments preview/.test(s)), ['comments preview true']);
    assert.equal(env.appOptions.canComments, false, 'precondition: stock comments preview did not drop canComments');
    r = rows();
    COMMENT_ROWS.forEach(k => {
        assert.ok(r[k], k + ' disappeared in view (inactive, not hidden)');
        assert.equal(r[k].off, true, k + ' is active in view');
        assert.equal(r[k].reason, env.shell.textModeLockedView, k + ': reason ' + r[k].reason);
    });
    assert.equal(r.comments.off, false, 'comments panel is not alive in view');
    env.choose('edit');
    assert.equal(env.appOptions.canComments, true, 'stock did not restore canComments');
    r = rows();
    COMMENT_ROWS.forEach(k => assert.ok(r[k] && r[k].off === false, k + ' after view: ' + JSON.stringify(r[k] && {off: r[k].off})));
    /* A connection loss is the same stock "preview": the items are in place, inactive. */
    env.main.disableEditing(true);
    r = rows();
    COMMENT_ROWS.forEach(k => {
        assert.ok(r[k], k + ' disappeared on lost connection');
        assert.equal(r[k].off, true, k + ' is active on lost connection');
    });
    env.main.disableEditing(false);
    r = rows();
    COMMENT_ROWS.forEach(k => assert.ok(r[k] && r[k].off === false, k + ' after reconnect'));
    noWarnings(env);
});

test('no_comment_right_no_comment_rows', () => {
    /* Without the right to comment there are no items either in "Editing" or in
       "Viewing" (the stock saved prevcanComments = false). The comparison is boolean: the menu row
       holds a fake DOM node, and an assert that unfolds such an object in a message eats memory. */
    const env = makeEnv({options: {canComments: false}}).create();
    const rows = () => Object.assign({}, env.section(SECTION(env, 'Insert')), env.section(SECTION(env, 'Collaboration')));
    COMMENT_ROWS.forEach(k => assert.equal(!!rows()[k], false, k + ' without canComments in edit'));
    env.choose('view');
    COMMENT_ROWS.forEach(k => assert.equal(!!rows()[k], false, k + ' without canComments in view'));
    env.choose('edit');
    COMMENT_ROWS.forEach(k => assert.equal(!!rows()[k], false, k + ' without canComments after view'));
    noWarnings(env);
});

test('toolbar_built_under_stock_cause_at_start', () => {
    /* The shell is built while the stock holds its restriction reason (a background open:
       LeftMenu.SetDisabled disables appOptions.isEdit and puts the previous value into previsEdit). The switch
       takes the right from what the stock saved (readEditRight) - and so does the formatting panel: the same
       snapshot, otherwise the editor would stay without the panel until reload. Under the reason the panel is in
       place and under a mask, when the reason is removed - alive. */
    const env = makeEnv();
    env.main.disableEditing(true, 'background-open');
    assert.equal(env.appOptions.isEdit, false, 'precondition: the stock dropped isEdit under its cause');
    env.create();
    assert.equal(env.shell.editRight, true, 'precondition: the switch took the right saved by the stock');
    const bar = env.bar();
    assert.ok(bar, 'formatting toolbar is not built when the shell starts under a stock cause');
    assert.equal(env.shellRows(), 132, 'editor rows (header, menu bar, toolbar)');
    assert.ok(bar.classList.contains('vo-masked'), 'toolbar is not masked under the stock cause');
    env.main.disableEditing(false, 'background-open');
    assert.equal(env.bar().classList.contains('vo-masked'), false, 'toolbar stays masked after the stock cause');
    assert.equal(env.appOptions.isEdit, true);
    /* A reader under the same reason - no panel (the right is a snapshot, not a reason). */
    const reader = makeEnv({reader: true});
    reader.main.disableEditing(true, 'background-open');
    reader.create();
    assert.equal(reader.bar(), null, 'reader got a formatting toolbar');
    assert.equal(reader.shellRows(), 76, 'reader rows');
    noWarnings(env);
    noWarnings(reader);
});

test('toolbar_comment_under_stock_comments_preview_at_start', () => {
    /* The same reason holds the comments "preview" (Comments.updatePreviewMode
       disables canComments and puts the previous value into prevcanComments). The panel comment button takes
       the right the same way as the menu row (SheetActions.commentRight) - the button is in place; without the right
       to comment it is absent. */
    const env = makeEnv();
    env.main.disableEditing(true, 'background-open');
    assert.equal(env.appOptions.canComments, false, 'precondition: stock comments preview dropped canComments');
    env.create();
    const btn = () => env.bar() && env.bar().querySelector('[data-ctrl="comment"]');
    assert.ok(btn(), 'comment button is missing from the toolbar built under the stock comments preview');
    const insert = env.section(SECTION(env, 'Insert'));
    assert.ok(insert.comment, 'precondition: menu bar keeps «Insert → Comment» under the same cause');
    env.main.disableEditing(false, 'background-open');
    assert.equal(env.appOptions.canComments, true, 'stock did not restore canComments');
    assert.ok(btn(), 'comment button is missing after the stock cause');
    const none = makeEnv({options: {canComments: false}});
    none.main.disableEditing(true, 'background-open');
    none.create();
    assert.equal(!!(none.bar() && none.bar().querySelector('[data-ctrl="comment"]')), false, 'comment button without the right to comment');
    noWarnings(env);
    noWarnings(none);
});

test('rename_item_follows_title_field_rule', () => {
    /* "File → Rename" and the header title field have one rule
       (CompactShell.canRename: the portal right, not desktop, the edit right, not "Viewing"): the
       item has edit, a reader has no "Rename". Without the edit
       right there is no item; in "Viewing" it is in place inactive with a reason,
       the click reaches neither the field nor the standard path; in "Editing" - like a click on the header title:
       the title field is focused, the text is selected, there is no stock
       rename window. */
    const reader = makeEnv({reader: true, options: {canRename: true}}).create();
    assert.equal(!!reader.section(SECTION(reader, 'File')).rename, false, 'reader with the portal rename right has «Rename»');
    assert.equal(reader.shell.canRename(), false, 'precondition: the title field is closed for a reader');
    noWarnings(reader);

    const env = makeEnv({options: {canRename: true}});
    const lm = env.SSE.getController('LeftMenu');
    lm.api = env.api;
    env.api.asc_getDocumentName = () => 'Отчёт.xlsx';
    env.context.Common.Views = {RenameDialog: function (o) { return {show() { env.log.push('rename dialog ' + o.filename); }}; }};
    env.create();
    /* Focus and selection of the title field are as in the browser (a fake node cannot do them): into the journal. */
    const title = env.doc.querySelector('#vo-shell .vo-hd-title');
    assert.equal(title && title.tagName, 'INPUT', 'precondition: the name is a field with the rename right');
    title.focus = () => { env.log.push('title focus'); env.doc.activeElement = title; };
    title.select = () => env.log.push('title select');
    const clickRename = () => {
        env.shell.closeSurfaces();
        env.sectionButton(SECTION(env, 'File')).click();
        env.doc.querySelector('#vo-shell [data-k="rename"]').click();
        env.shell.closeSurfaces();
    };
    let file = env.section(SECTION(env, 'File'));
    assert.ok(file.rename, 'editor with the portal rename right has no «Rename»');
    assert.equal(file.rename.off, false, '«Rename» is inactive in edit');
    assert.equal(env.shell.canRename(), true, 'precondition: the title field is open in edit');
    env.choose('view');
    assert.equal(env.shell.canRename(), false, 'precondition: the title field is closed in view');
    file = env.section(SECTION(env, 'File'));
    assert.ok(file.rename, '«Rename» disappeared in view (inactive, not hidden)');
    assert.equal(file.rename.off, true, '«Rename» is alive in view while the title field is closed');
    assert.equal(file.rename.reason, env.shell.textModeLockedView, '«Rename»: reason ' + file.rename.reason);
    clickRename();
    assert.deepEqual(env.log.filter(s => /^file rename|^rename dialog|^title /.test(s)), [], 'rename reached the name or the stock in view');
    env.choose('edit');
    file = env.section(SECTION(env, 'File'));
    assert.equal(file.rename.off, false, '«Rename» stays inactive after view');
    clickRename();
    assert.deepEqual(env.log.filter(s => /^file rename|^rename dialog|^title /.test(s)), ['title focus', 'title select'],
        'control: «Rename» in edit is not the name field of the header (focus, selection, no stock window)');
    noWarnings(env);

    /* Desktop is a stock condition (FileMenu: miRename without isDesktopApp): there is no item for an editor either. */
    const desk = makeEnv({options: {canRename: true, isDesktopApp: true}}).create();
    assert.equal(!!desk.section(SECTION(desk, 'File')).rename, false, 'desktop app has «Rename»');
    noWarnings(desk);
});

test('open_section_follows_lock_live', () => {
    const env = makeEnv().create();
    const btn = env.sectionButton(SECTION(env, 'Format'));
    btn.click();
    const s = env.dropOf(btn);
    assert.equal(env.rows(s).borders.off, false);
    /* The menu row re-reads the open section on the next frame (refresh). */
    env.main.disableEditing(true);
    env.flush();
    assert.equal(env.rows(s).borders.off, true, 'open section did not follow the lock');
    env.main.disableEditing(false);
    env.flush();
    assert.equal(env.rows(s).borders.off, false, 'open section did not follow the unlock');
    noWarnings(env);
});

test('missing_twin_warns_editor_only', () => {
    const editor = makeEnv();
    editor.roots.ViewTab.btnFreezePanes = null;
    editor.create();
    const view = editor.section(SECTION(editor, 'View'));
    assert.equal(view.freeze.off, true, 'item with a missing twin is active');
    editor.section(SECTION(editor, 'View'));
    const own = editor.warnings.filter(w => /^Compact shell:/.test(String(w[0])) && /ViewTab:btnFreezePanes/.test(String(w[0])));
    assert.equal(own.length, 1, 'missing twin is not reported once for an editor: ' + JSON.stringify(editor.warnings.map(w => String(w[0]))));
    const reader = makeEnv({reader: true}).create();
    reader.section(SECTION(reader, 'Format'));
    reader.section(SECTION(reader, 'Data'));
    noWarnings(reader);
});

/* The start as in the stock: the shell is built on app:ready (controller/Viewport.js), and the
   "Add comment" buttons are inserted into the ribbon by a subscriber of the same notification, set up later
   (controller/Toolbar.js onAppReady). The menu row snapshots the sections already at build. */
function startOnAppReady(env, stockOnAppReady) {
    env.NC.on('app:ready', () => env.shell.start());
    env.NC.on('app:ready', stockOnAppReady);
    env.NC.trigger('app:ready', env.appOptions);
    env.flush();
    return env;
}

const twinWarnings = (env, ref) => env.warnings.filter(w => /^Compact shell: stock control /.test(String(w[0])) &&
    String(w[0]).includes('"' + ref + '"'));

test('twin_added_by_the_stock_later_on_app_ready_is_not_reported_missing', () => {
    const env = makeEnv();
    const toolbarCtl = env.SSE.getController('Toolbar');
    const stockButtons = toolbarCtl.btnsComment;
    delete toolbarCtl.btnsComment;
    startOnAppReady(env, () => { toolbarCtl.btnsComment = stockButtons; });
    assert.ok(env.doc.getElementById('vo-shell'), 'the shell is not built on app:ready');
    assert.deepEqual(twinWarnings(env, 'ToolbarCtl:btnsComment.0').map(w => String(w[0])), [],
        'a twin the stock adds later on app:ready is reported missing');
    assert.equal(env.SSE.Views.StockBridge.gaps.filter(g => g.kind === 'missing' && g.ref === 'ToolbarCtl:btnsComment.0').length, 0,
        'a twin the stock adds later on app:ready is recorded as a gap');
    assert.equal(env.section(SECTION(env, 'Insert')).comment.off, false, '«Add comment» is inactive');
    noWarnings(env);
});

test('twin_missing_after_the_stock_is_built_warns_once_at_start', () => {
    const env = makeEnv();
    const toolbarCtl = env.SSE.getController('Toolbar');
    delete toolbarCtl.btnsComment;
    startOnAppReady(env, () => {});
    assert.equal(twinWarnings(env, 'ToolbarCtl:btnsComment.0').length, 1,
        'a twin still missing after the stock is built is not reported once: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
    assert.ok(env.SSE.Views.StockBridge.gaps.some(g => g.kind === 'missing' && g.ref === 'ToolbarCtl:btnsComment.0'),
        'a twin still missing after the stock is built is not recorded as a gap');
    assert.equal(env.section(SECTION(env, 'Insert')).comment.off, true, '«Add comment» without its twin is active');
    assert.equal(twinWarnings(env, 'ToolbarCtl:btnsComment.0').length, 1, 'the missing twin is reported again');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
