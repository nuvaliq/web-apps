/* Run: node test/unit-tests/spreadsheeteditor/side-panels.cjs [path to CompactShell.js] [path to compact-shell.less]
 * The right panel and the left area of the spreadsheet editor "Compact" shell:
 * the right panel (#right-menu) in the compact is visible only under body.vo-right-open; it opens
 * by itself on selecting an image, a shape, TextArt (it comes as a shape) and a slicer, when the
 * cursor enters a pivot table and on the standard commands that open it in the stock ("Format
 * cells": the ribbon view rightmenu:open and a direct call of the right panel controller) - by the stock
 * showing it, not by a request: a stock refusal (the cell tab is disabled for an object) leaves the panel alone; on a
 * chart - it neither opens nor goes off, as in Documents; on cells it does not
 * close by itself; manually - "View → Object properties" (toggleRightPanel).
 * An open panel unfolds on the object tab with the standard SetActivePane - the tab choice
 * is deferred behind all selection subscribers, because the standard right panel subscriber
 * may stand after ours too; a closed one keeps the standard panel collapsed, otherwise the standard
 * "Format cells" with the cell tab already active would exit before showing - including
 * when the stock unfolds the hidden panel itself, without an engine event (loading with the remembered
 * "not collapsed"): a closed one collapses it on the standard layout:changed 'rightmenu'. Our
 * unfolding does not write the standard remembered collapsed state to localStorage.
 * The header: there are no comments, search and right panel buttons in it; the comments panel is opened by
 * the "Collaboration → Comments" item (the standard LeftMenu:btnComments button), only with
 * canCoAuthoring && canViewComments.
 * The left area: the stock search panel (Ctrl+H - the standard onShortcut('replace') and
 * onShowHideSearch as text from the file, the "Open panel" button of the floating search bar) in the compact
 * opens by the path of the "Edit → Find and replace" item; likewise the comments and chat
 * panels (Ctrl+Shift+H, Alt+Q, a document comment - the standard onShortcut, onAppAddComment,
 * onShowHideChat, showMenu and onCoauthOptions as text from the file) - by the path of "Review →
 * Comments" and "Review → Chat"; in the Standard - the standard way, the substitution of the
 * standard showMenu is removed, as after dismantling the shell.
 * The module is loaded in node via vm on top of a fake DOM and stock (as compact-shell-core.cjs).
 * The optional arguments are broken copies of the module and compact-shell.less for the negative
 * control. The section at the end is real headless Chrome (playwright, as formula-bar.cjs: NODE_PATH
 * or PLAYWRIGHT_MODULE, CHROMIUM_PATH) on the built spreadsheet editor app.less and the real jQuery of the tree:
 * the compact left menu through jQuery eyes (the MENU_FRAME model of the fake stock) and showing a closed
 * area versus the stock inline show().
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/spreadsheeteditor/main/app/view');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactShell.js');
const ICONS = path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js');
const lessFile = process.argv[3] ? path.resolve(process.argv[3])
    : path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/compact-shell.less');

/* The compact #left-menu through jQuery eyes (box-sizing: border-box): the horizontal border of
   a shown area (vo-left-open - the compact divider, border-right 1px) and of a hidden one.
   $el.width(v) writes v + the border at the time of writing, $el.width() reads style.width − the border at
   the time of reading. The fake stock (opt.stockMenu) holds this model; the Chrome section checks it against the
   real jQuery on the built app.less. */
const MENU_FRAME = {shown: 1, hidden: 0};

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
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { const a = this.listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    dispatch(t) {
        const ev = {type: t, target: this, preventDefault() {}, stopPropagation() {}};
        (this.listeners[t] || []).slice().forEach(fn => fn.call(this, ev));
    }
    click() { this.dispatch('click'); }
    /* Focus and visibility: a node is visible while neither it nor its ancestors are hidden (style.display) and it is not in the
       header or the menu row of focus mode (compact-shell.less: .vo-focus #vo-shell > .vo-hd and .vo-mn -
       display: none); focus() of an invisible node does nothing, as in the browser. */
    getClientRects() {
        const body = this.ownerDocument.body;
        for (let n = this; n; n = n.parentNode) {
            if (n.style && n.style.display === 'none') return [];
            if (body.classList.contains('vo-focus') && n.parentNode && n.parentNode.id === 'vo-shell' &&
                (n.classList.contains('vo-hd') || n.classList.contains('vo-mn'))) return [];
        }
        return this.ownerDocument.documentElement.contains(this) ? [{}] : [];
    }
    focus() { if (this.getClientRects().length) this.ownerDocument.activeElement = this; }
    descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
    querySelectorAll(sel) { return this.descendants().filter(e => matches(e, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

/* Selectors: '#id', '.cls', 'tag', '[id^="vo-"]', '[data-k="x"]', compound 'tag.cls', a descendant
   via a space, a list via commas. */
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

/* Common.Utils.documentSettingsType and Asc.c_oAscSelectionType - the stock numbers. */
const D = {Paragraph: 0, Table: 1, Header: 2, TextArt: 3, Shape: 4, Image: 5, Slide: 6, Chart: 7, MailMerge: 8,
    Signature: 9, Pivot: 10, Cell: 11, Slicer: 12};
const T = {RangeCells: 1, RangeCol: 2, RangeRow: 3, RangeMax: 4, RangeImage: 5, RangeChart: 6, RangeShape: 7,
    RangeSlicer: 8, RangeShapeText: 9, RangeChartText: 10, RangeFrozen: 11};
const BTN = {btnText: D.Paragraph, btnImage: D.Image, btnShape: D.Shape, btnTextArt: D.TextArt, btnPivot: D.Pivot,
    btnCell: D.Cell, btnSlicer: D.Slicer};

/* Selections as the stock sees them (controller/RightMenu.js onFocusObject): the engine selection type
   and the tabs the stock makes available. An image in the stock is two records
   (the picture and its shape): Image and Shape; TextArt is a shape with TextArt: TextArt and Shape. */
const SEL = {
    cells:    {type: T.RangeCells, panes: [D.Cell]},
    column:   {type: T.RangeCol, panes: [D.Cell]},
    image:    {type: T.RangeImage, panes: [D.Shape, D.Image]},
    shape:    {type: T.RangeShape, panes: [D.Shape, D.Paragraph]},
    textart:  {type: T.RangeShape, panes: [D.TextArt, D.Shape, D.Paragraph]},
    shapeText: {type: T.RangeShapeText, panes: [D.Shape, D.Paragraph]},
    slicer:   {type: T.RangeSlicer, panes: [D.Slicer]},
    chart:    {type: T.RangeChart, panes: []},
    chartText: {type: T.RangeChartText, panes: [D.Paragraph]},
    pivotA:   {type: T.RangeCells, panes: [D.Cell, D.Pivot], pivot: 'PivotA'},
    pivotB:   {type: T.RangeCells, panes: [D.Cell, D.Pivot], pivot: 'PivotB'}
};

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
    const store = new Map(Object.entries(opt.storage || {}));
    const lsWrites = [];

    let current = SEL.cells;
    const info = sel => ({
        asc_getSelectionType: () => sel.type,
        asc_getPivotTableInfo: () => (sel.pivot ? {asc_getName: () => sel.pivot} : null)
    });
    const api = {
        handlers: {},
        asc_registerCallback(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
        asc_unregisterCallback(name, fn) { const a = this.handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        sendEvent(name, ...args) { (this.handlers[name] || []).slice().forEach(fn => fn.apply(this, args)); },
        asc_isDocumentModified() { return false; },
        asc_getCellInfo() { return info(current); },
        asc_getActiveWorksheetIndex() { return 0; },
        asc_Resize() {}
    };

    const vlayout = layout([
        {alias: 'title', height: 28},
        {alias: 'toolbar', height: 92},
        {stretch: true},
        {alias: 'statusbar', height: 25}
    ]);
    const hlayout = layout([{alias: 'left'}, {stretch: true}, {alias: 'right'}]);
    const celayout = layout([{alias: 'celleditor'}, {stretch: true}]);

    /* The left menu: pressing a standard panel button toggles it and sends layout:changed. With
       opt.stockMenu - the standard menu: the #left-menu node as jQuery sees it (MENU_FRAME:
       border-box with the compact divider only for a shown area - $el.width(v) writes
       v into style.width together with the border at the time of writing, $el.width() reads style.width without
       the border at the time of reading; checked against the real jQuery on the built app.less in Chrome,
       left_menu_frame_model_matches_jquery_and_less), the button is like Common.UI.Button
       (a press with toggleGroup 'leftMenuGroup', then 'click' → the real stock onBtnMenuClick),
       btnAbout.toggle is its onBtnMenuToggle (layout:changed 'leftmenu'), and before the shell - the real
       stock Viewport.onLayoutChanged (the layout divider by the menu width). The button
       is visible (isVisible - the node is in the icon column) only outside the compact: in the compact the icon column
       is always hidden (compact-shell.less, .tool-menu-btns). The stock search: the real
       view showMenu and the controller onShortcut / onShowHideSearch / tryToShowLeftMenu / onLeftMenuHide /
       isSearchPanelVisible (env.lmCtl), the search panel is visible while shown and the left
       area is visible (for the compact - vo-left-open), its show is the search block of the standard onCoauthOptions;
       the floating search bar is env.searchBar (Viewport.searchBar and header.btnSearch). */
    const menuNode = {style: {width: '40px'}};    // Viewport.template: #left-menu style="width: 40px;"
    const frame = () => (doc.body.classList.contains('vo-left-open') ? MENU_FRAME.shown : MENU_FRAME.hidden);
    const menuEl = {
        0: menuNode, length: 1,
        width(v) {
            if (v === undefined) return parseFloat(menuNode.style.width) - frame();
            menuNode.style.width = (+v + frame()) + 'px';
            return this;
        }
    };
    /* The button $el is a node in the icon column: focus() of the standard showMenu('comments') sets focus
       only if the button is visible (outside the compact) - into the stockFocus journal. */
    const stockFocus = [];
    const leftButton = (action, name) => ({
        pressed: false, options: action ? {action} : {}, disabled: false, clicks: 0,
        $el: {
            notify: false,
            focus() { if (!doc.body.classList.contains('vo-compact')) stockFocus.push(name); },
            hasClass(c) { return c === 'notify' && this.notify; },
            removeClass(c) { if (c === 'notify') this.notify = false; },
            addClass(c) { if (c === 'notify') this.notify = true; }
        },
        isDisabled() { return this.disabled; },
        setDisabled(v) { this.disabled = !!v; },
        isVisible() { return !doc.body.classList.contains('vo-compact'); },
        toggle(v, silent) {
            this.pressed = v === undefined ? !this.pressed : !!v;
            if (!opt.stockMenu || silent) return;
            if (this === leftMenu.btnAbout) { NC.trigger('layout:changed', 'leftmenu'); return; }
            if (this.pressed) GROUP().forEach(b => { if (b !== this && b.pressed) b.toggle(false); });
        },
        click() {
            this.clicks++;
            if (!opt.stockMenu) {
                this.pressed = !this.pressed;
                NC.trigger('layout:changed', 'leftmenu');
                return;
            }
            this.toggle(!this.pressed);
            leftMenu.onBtnMenuClick(this);
        }
    });
    const leftMenu = {
        btnSearchBar: leftButton('advancedsearch', 'search'), btnComments: leftButton(undefined, 'comments'), btnChat: leftButton(undefined, 'chat'),
        btnSpellcheck: leftButton(undefined, 'spellcheck'), btnAbout: leftButton(undefined, 'about'), buttons: []
    };
    const GROUP = () => [leftMenu.btnSearchBar, leftMenu.btnComments, leftMenu.btnChat, leftMenu.btnSpellcheck, leftMenu.btnAbout];
    const panelLog = [];
    const stockView = {resizer: null, sdkBorder: null};
    /* The left area is visible: for the compact - under vo-left-open, in the Standard - always; the stock inline hide()
       (the integrator, "View → Left panel") hides it in both. */
    const areaShown = () => menuNode.style.display !== 'none' &&
        (doc.body.classList.contains('vo-left-open') || !doc.body.classList.contains('vo-compact'));
    const leftEvents = [];
    const panelSearch = {
        shown: false, focuses: [], finds: [],
        show() { this.shown = true; }, hide() { this.shown = false; },
        isVisible() { return this.shown && areaShown(); },
        focus(type) { this.focuses.push(type || 'search'); },
        setFindText(t) { this.finds.push(t); }, setSearchMode() {}
    };
    /* The comments and chat panels: visible while shown and the left area is visible; the chat focus is
       into the stockFocus journal ('chat field'), as the stock Chat.focus (the message field). */
    const panelComments = {
        shown: false,
        show() { this.shown = true; }, hide() { this.shown = false; panelLog.push('comments hide'); },
        isVisible() { return this.shown && areaShown(); }
    };
    const panelChat = {
        shown: false,
        show() { this.shown = true; }, hide() { this.shown = false; },
        isVisible() { return this.shown && areaShown(); },
        focus() { stockFocus.push('chat field'); }
    };
    if (opt.stockMenu) Object.assign(leftMenu, {
        $el: menuEl, _state: {pluginIsRunning: false},
        panelComments, panelChat,
        toggleActivePluginButton() {}, setDisabledPluginButtons() {},
        fireEvent(name, args) { leftEvents.push([name, args === leftMenu || (args && args[0] === leftMenu) ? 'view' : args]); },
        getMenu() { return {setMode() {}}; },
        isVisible() { return areaShown(); },
        panelSearch,
        menuFile: {isVisible: () => false, hide() {}},
        isButtonInMoreMenu: btn => leftMenu.buttons.indexOf(btn) > -1,
        show() { menuNode.style.display = ''; leftEvents.push(['menu show']); },
        hide() { menuNode.style.display = 'none'; leftEvents.push(['menu hide']); }
    });
    if (opt.noCommentsButton) delete leftMenu.btnComments;
    /* The editor ribbon is full: every btn* of the tabs has a double (born on the first
       access) - otherwise a menu row opened in the case would mark the missing doubles
       with a shell warning. */
    const twin = () => ({disabled: false, pressed: false, keepState: [], options: {}, isDisabled() { return this.disabled; }, click() {}});
    const autoRoot = (preset = {}) => new Proxy(preset, {
        get(t, k) {
            if (typeof k === 'string' && !(k in t) && /^btn/.test(k)) t[k] = /^btns/.test(k) ? [twin()] : twin();
            return t[k];
        }
    });
    /* The menu row snapshots all sections already at the start (section visibility): "Format → Cell styles" reads the styles combo. */
    const toolbarView = autoRoot(Object.assign(events(), {el: toolbarEl, cmbNumberFormat: twin(), listStyles: twin()}));
    /* The standard checkboxes of the "View" tab (Common.UI.CheckBox) - the stock builds them for an editor ("View → Show ▸":
       the doubles of the "Gridlines", "Headings", "Zeros" items). */
    const checkbox = () => ({checked: true, disabled: false, rendered: true, keepState: [], isChecked() { return this.checked; },
        isDisabled() { return this.disabled; }, setValue(v) { this.checked = !!v; }, onItemCheck() { this.setValue(!this.checked); }});
    const tabs = {DataTab: {view: autoRoot()}, ViewTab: {view: autoRoot({chGridlines: checkbox(), chHeadings: checkbox(), chZeros: checkbox()})},
        WBProtection: {view: autoRoot()},
        PivotTable: {view: autoRoot()}, FormulaDialog: {formulaTab: autoRoot()}, 'Common.Controllers.ReviewChanges': {view: autoRoot()},
        /* The sheet row: the tab menu ("View → Hidden sheets ▸" - the double of its "Hidden" item), there are no hidden sheets. */
        Statusbar: {statusbar: autoRoot({mode: {}, tabMenu: {items: [0, 1, 2, 3, 4, 5].map(i => Object.assign(twin(), {hidden: i === 5}))}})}};

    /* The stock right panel (view/RightMenu.js): collapsed (only the tab column) or
       unfolded on a tab. SetActivePane(type, true) on a collapsed one presses the tab button:
       unfolding and remembering "not collapsed" in localStorage (onBtnMenuClick); clearSelection
       collapses without writing. */
    const log = [];
    const rightView = Object.assign(events(), {
        minimizedMode: true,
        active: null,
        mode: {isEdit: true, customization: {}},
        fireEvent(name, args) { this.trigger(name, args); },
        SetActivePane(type, open) {
            log.push('pane ' + type + (open ? ' open' : ''));
            if (this.minimizedMode && open !== true) return;
            if (this.minimizedMode) {
                this.minimizedMode = false;
                store.set('sse-hide-right-settings', '0');
                lsWrites.push('sse-hide-right-settings');
                NC.trigger('layout:changed', 'rightmenu');
            }
            this.active = type;
        },
        GetActivePane() { return this.minimizedMode ? null : this.active; },
        clearSelection() {
            log.push('collapse');
            this.minimizedMode = true;
            this.active = null;
            NC.trigger('layout:changed', 'rightmenu');
        }
    });
    if (opt.rendered !== false) rightView.cellSettings = {};
    Object.keys(BTN).forEach(k => {
        rightView[k] = {disabled: true, isDisabled() { return this.disabled; }, asctype: BTN[k]};
    });
    const paneButton = type => Object.keys(BTN).map(k => rightView[k]).find(b => b.asctype === type);
    /* The standard right panel selection subscriber: tab availability by the selection. */
    const stockSelection = () => {
        Object.keys(BTN).forEach(k => { rightView[k].disabled = current.panes.indexOf(BTN[k]) < 0; });
        if (!rightView.minimizedMode && current.panes.length && current.panes.indexOf(rightView.active) < 0)
            rightView.active = current.panes[current.panes.length - 1];
    };
    /* The right panel controller: both the ribbon rightmenu:open and direct calls (the context menu
       "Format cells", the border and orientation "Options") go to onRightMenuOpen; it
       exits early if the tab is unavailable or already active, otherwise it shows the panel
       (tryToShowRightMenu → onRightMenuHide(null, true) → 'view:hide' [ctl, false]) and
       unfolds it on the tab. */
    const rightCtl = {
        rightmenu: rightView,
        getView() { return rightView; },
        onRightMenuOpen(type) {
            const btn = paneButton(type);
            if (!btn || btn.isDisabled() || rightView.GetActivePane() === type) return;
            /* opt.showExpands: the show (onRightMenuHide(null, true) → the stock onSelectionChanged) by
               the remembered "not collapsed" unfolds the panel itself even before 'view:hide'. */
            if (opt.showExpands && store.get('sse-hide-right-settings') === '0' && current.panes.length)
                rightView.SetActivePane(current.panes[current.panes.length - 1], true);
            rightView.fireEvent('view:hide', [rightCtl, false]);
            rightView.SetActivePane(type, true);
        }
    };

    const main = {
        editorConfig: {ui: {shell: 'modern'}},
        appOptions: Object.assign({spreadsheet: {title: 'Отчёт.xlsx'}, isEdit: true, canCoAuthoring: true,
            canViewComments: true, canComments: true}, opt.options || {})
    };

    /* The menu view shares the application options with the others (the stock setMode passes the same object). */
    if (opt.stockMenu) {
        leftMenu.mode = main.appOptions;
        main._state = {};
    }

    /* The left menu controller. With opt.stockMenu - its real search methods (below, after
       Common): Ctrl+H - keymaster calls onShortcut('replace') bound to the controller;
       the Viewport floating search bar (Ctrl+F) is searchBar, its "Open panel" button sends
       'search:show' [true, text] - in the stock that is the controller onShowHideSearch. */
    const lmCtl = {leftMenu};
    /* The comments controller (Common.Controllers.Comments): onAfterShow and the new document
       comment field (showEditContainer) - into the commentsLog journal. */
    const commentsLog = [];
    const commentsCtl = {
        onAfterShow() { commentsLog.push('afterShow'); },
        getView() { return {showEditContainer(v) { commentsLog.push('edit ' + v); }}; }
    };
    const searchBar = {
        visible: false, text: '',
        isVisible() { return this.visible; },
        inputSearch: {val: () => searchBar.text},
        show(t) { this.visible = true; if (t !== undefined) this.text = t; },
        hide() { this.visible = false; },
        setText(t) { this.text = t; }, focus() {}
    };
    /* Viewport.onSearchToggle: the header search button shows and hides the bar. */
    const viewportCtl = {
        searchBar,
        header: {btnSearch: {pressed: false, toggle(v) { this.pressed = !!v; if (v) searchBar.show(); else searchBar.hide(); }}},
        isSearchBarVisible() { return searchBar.isVisible(); }
    };

    const SSE = {
        Views: {},
        getController(name) {
            if (name === 'Main') return main;
            if (name === 'Toolbar') return {toolbar: toolbarView, api, btnsComment: [twin()]};
            if (tabs[name]) return tabs[name];
            if (name === 'Viewport') return {viewport: {vlayout, hlayout, celayout}, getApi: () => api};
            if (name === 'LeftMenu') return lmCtl;
            if (name === 'Common.Controllers.Comments') return commentsCtl;
            if (name === 'RightMenu') return opt.noRightMenu ? undefined : rightCtl;
            return undefined;
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
        _: {extend: Object.assign},
        Asc: {c_oAscSelectionType: T},
        Common: {
            NotificationCenter: NC,
            Utils: {documentSettingsType: D},
            UI: {LayoutManager: {isElementVisible: name => !(opt.hidden || []).includes(name)}, Menu: {Manager: {hideAll() {}}}},
            localStorage: {
                getItem: k => (store.has(k) ? store.get(k) : null),
                setItem: (k, v) => { store.set(k, String(v)); lsWrites.push(k); },
                removeItem: k => { store.delete(k); lsWrites.push(k); },
                setBool: (k, v) => { store.set(k, v ? '1' : '0'); lsWrites.push(k); },
                getBool: (k, d) => (store.has(k) ? store.get(k) === '1' || store.get(k) === 'true' : !!d)
            }
        },
        resizes: 0
    };
    context.window = context;
    context.dispatchEvent = ev => { if (ev && ev.type === 'resize') context.resizes++; return true; };
    context.listeners = {};
    context.addEventListener = (t, fn) => { (context.listeners[t] = context.listeners[t] || []).push(fn); };
    context.removeEventListener = () => {};

    if (opt.stockMenu) {
        leftMenu.onBtnMenuClick = STOCK_LEFT.menuClick(context.Common);
        leftMenu.onCoauthOptions = STOCK_LEFT.coauth(context.Common);
        leftMenu.showMenu = STOCK_LEFT.showMenu(context.Common);
        Object.assign(lmCtl, {
            mode: main.appOptions,
            api: {asc_GetSelectedText: () => opt.selectedText || ''},
            getApplication: () => ({getController: name => (name === 'Viewport' ? viewportCtl :
                name === 'Common.Controllers.Comments' ? commentsCtl : undefined)})
        }, STOCK_LEFT.search(context.Common), {
            onAppAddComment: STOCK_LEFT.appAddComment(context.Common, SSE),
            onShowHideChat: STOCK_LEFT.showHideChat(context.Common)
        });
        /* The standard layout subscriber is set up in onLaunch - before the shell. Its 'leftmenu':
           a menu wider than 40 - show the layout divider (4 px to the left of the sheet) and the sheet border. */
        const vp = {
            api,
            viewport: {vlayout: layout([]), celayout: layout([]), hlayout: {
                getItem: () => ({el: menuEl, resize: {el: {show() { stockView.resizer = true; }, hide() { stockView.resizer = false; }}}}),
                doLayout() {}
            }},
            boxSdk: {css(k, v) { if (k === 'border-left') stockView.sdkBorder = v; }},
            boxFormula: {css() {}}
        };
        NC.on('layout:changed', area => { if (area === 'leftmenu') STOCK_LEFT.viewportLayout.call(vp, area); });
    }

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
    const shell = SSE.Views.CompactShell;

    const env = {
        shell, SSE, doc, NC, api, main, hlayout, leftMenu, toolbarView, rightView, rightCtl, store, lsWrites,
        timers, warnings, context, log,
        flush() { let n = 0; while (timers.length && n++ < 100) timers.shift()(); },
        body() { return doc.body.classList; },
        open() { return doc.body.classList.contains('vo-right-open'); },
        /* The selection changes: engine subscribers in subscription order. stockFirst - the standard
           right panel subscriber was set up before the shell, otherwise - after (in the stock it
           is set up in createDelayedElements when the styles are ready, the order is not defined). */
        select(name) {
            current = SEL[name];
            api.sendEvent('asc_onSelectionChanged', info(current));
            env.flush();
        },
        create() {
            if (opt.stockFirst !== false) api.asc_registerCallback('asc_onSelectionChanged', stockSelection);
            shell.create();
            if (opt.stockFirst === false) api.asc_registerCallback('asc_onSelectionChanged', stockSelection);
            stockSelection();
            env.flush();
            return env;
        },
        /* A menu row item by a real click on the section and the row, without a tick after (the revealLeft
           allowances live to the end of the task - both the middle and the tick after are checked). */
        menuRow(section, k) {
            const btn = env.sectionButton(SSE.Views.SheetActions[section]);
            assert.ok(btn, 'no menu section ' + section);
            btn.click();
            const row = doc.querySelector('[data-k="' + k + '"]');
            assert.ok(row, 'no menu row ' + k);
            assert.equal(row.getAttribute('aria-disabled'), 'false', 'menu row ' + k + ' is inactive');
            row.click();
        },
        /* A menu row section button by caption (null - there is none). */
        sectionButton(label) { return doc.querySelectorAll('#vo-shell .vo-mn-item').find(b => b.textContent === label) || null; },
        header() { return doc.querySelector('#vo-shell .vo-hd'); },
        /* The comments panel the way a human opens it: "Collaboration → Comments". */
        openComments() { env.menuRow('textCollaboration', 'comments'); },
        /* The integration took away the edit right (processRightsChange → asc_coAuthoringDisconnect,
           api:disconnect): the standard subscribers in subscription order - Main.onCoAuthoringDisconnect
           (Viewport.setMode({isDisconnected}) removes canCoAuthoring from the shared options), then
           LeftMenu.onApiServerDisconnect (the menu view close() and disabling the buttons). The methods are real. */
        disconnect() {
            const viewport = {mode: main.appOptions, setMode: STOCK_LEFT.viewportSetMode};
            const app = {getController: () => ({getView: name => name === 'Viewport' ? viewport : {setCanRename() {}}})};
            STOCK_LEFT.mainDisconnect.call(Object.assign(main, {getApplication: () => app}));
            leftMenu.close = STOCK_LEFT.close(context.Common);
            STOCK_LEFT.serverDisconnect.call({mode: main.appOptions, leftMenu});
            env.flush();
        },
        /* A real Ctrl+H for the stock: keymaster calls the controller onShortcut('replace') (without a
           tick after - the cases check it). */
        ctrlH() { return lmCtl.onShortcut('replace', {}); },
        /* Ctrl+Shift+H and Alt+Q (on macOS Ctrl+Alt+Q) - keymaster calls onShortcut('comments') and
           onShortcut('chat'); a document comment is 'app:comment:add' with to_doc (onAppAddComment). */
        ctrlShiftH() { return lmCtl.onShortcut('comments', {}); },
        altQ() { return lmCtl.onShortcut('chat', {}); },
        addDocComment() { return lmCtl.onAppAddComment('toolbar', true); },
        panelLog, stockView, lmCtl, searchBar, viewportCtl, panelSearch, leftEvents, menuNode, panelComments, panelChat,
        stockFocus, commentsLog
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

/* A stock method as text from the file (from "name: function(" or "name: function (" to the closing
   brace), with the outer names of its module from scope (SCALE_MIN of the menu view, Common, _). */
function stockMethod(rel, name, scope) {
    const src = fs.readFileSync(path.join(ROOT, 'apps/spreadsheeteditor/main/app', rel), 'utf8');
    const found = [...src.matchAll(new RegExp('\\b' + name + ': function ?\\(', 'g'))];
    assert.ok(found.length === 1, name + ' is not found once in ' + rel);
    const start = found[0].index, head = found[0][0].length;
    let depth = 0, end = src.indexOf('{', start);
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    const names = Object.keys(scope);
    return new Function(...names, 'return function(' + src.slice(start + head, end + 1))(...names.map(k => scope[k]));
}
/* The left menu controller search (controller/LeftMenu.js) - its methods under their own names. */
const STOCK_SEARCH = ['onShortcut', 'onShowHideSearch', 'tryToShowLeftMenu', 'onLeftMenuHide', 'isSearchPanelVisible'];
/* A Promise for the stock onAppAddComment: then runs at once (in the stock - as a microtask; the call order is the same). */
function SyncPromise(fn) {
    fn(() => {}, () => {});
    return {then(cb) { cb(); return this; }};
}
const STOCK_LEFT = {
    viewportSetMode: stockMethod('view/Viewport.js', 'setMode', {_: {isUndefined: v => v === undefined}}),
    mainDisconnect: stockMethod('controller/Main.js', 'onCoAuthoringDisconnect', {}),
    serverDisconnect: stockMethod('controller/LeftMenu.js', 'onApiServerDisconnect', {}),
    close: Common => stockMethod('view/LeftMenu.js', 'close', {SCALE_MIN: 40, Common}),
    menuClick: Common => stockMethod('view/LeftMenu.js', 'onBtnMenuClick', {SCALE_MIN: 40, MENU_SCALE_PART: 300, Common,
        $: () => ({toggleClass() {}})}),
    showMenu: Common => stockMethod('view/LeftMenu.js', 'showMenu', {Common}),
    coauth: Common => stockMethod('view/LeftMenu.js', 'onCoauthOptions', {Common}),
    appAddComment: (Common, SSE) => stockMethod('controller/LeftMenu.js', 'onAppAddComment', {Common, SSE, Promise: SyncPromise}),
    showHideChat: Common => stockMethod('controller/LeftMenu.js', 'onShowHideChat', {Common}),
    search: Common => Object.fromEntries(STOCK_SEARCH.map(n => [n, stockMethod('controller/LeftMenu.js', n, {Common, $: () => ({find: () => []})})])),
    viewportLayout: stockMethod('controller/Viewport.js', 'onLayoutChanged', {})
};

const noWarnings = env => assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]) + ' ' + String(w[1]))));

/* Open on a tab: the class on body, the standard panel is unfolded on the expected tab. */
function openOn(env, pane, what) {
    assert.equal(env.open(), true, what + ': panel is not shown');
    assert.equal(env.rightView.minimizedMode, false, what + ': stock panel is left collapsed (only the tab column)');
    assert.equal(env.rightView.active, pane, what + ': opened on tab ' + env.rightView.active + ', expected ' + pane);
}

test('right_opens_on_image_shape_textart_slicer', () => {
    /* The tab is the one the stock itself would choose (the senior available): for TextArt - "Shape", as
       for any shape with text (the TextArt tab in the stock is available for a plain shape too). */
    const cases = [['image', D.Image], ['shape', D.Shape], ['textart', D.Shape], ['shapeText', D.Shape], ['slicer', D.Slicer]];
    for (const stockFirst of [true, false]) {
        for (const [sel, pane] of cases) {
            const env = makeEnv({stockFirst}).create();
            assert.equal(env.open(), false, 'panel is open on start');
            const before = env.hlayout.layouts;
            env.select(sel);
            openOn(env, pane, sel + (stockFirst ? '' : ' (stock subscriber after the shell)'));
            assert.ok(env.hlayout.layouts > before, sel + ': no relayout after showing the panel');
            assert.ok(env.context.resizes > 0, sel + ': grid is not resized');
            noWarnings(env);
        }
    }
    /* Our own opening does not become the standard remembering of "panel not collapsed": neither an empty
       key nor a saved "collapsed". */
    for (const stored of [undefined, '1']) {
        const env = makeEnv({storage: stored === undefined ? {} : {'sse-hide-right-settings': stored}}).create();
        env.select('image');
        openOn(env, D.Image, 'image');
        assert.equal(env.store.has('sse-hide-right-settings') ? env.store.get('sse-hide-right-settings') : undefined, stored,
            'own expand changed the stock collapse preference');
    }
});

test('right_opens_on_pivot_entry', () => {
    const env = makeEnv().create();
    env.select('pivotA');
    openOn(env, D.Pivot, 'cursor entered a pivot table');
    /* A human decision: closed - walking inside the same pivot table does not bring the panel back. */
    env.shell.toggleRightPanel();
    env.flush();
    assert.equal(env.open(), false, 'manual close did not close');
    env.select('pivotA');
    env.select('pivotA');
    assert.equal(env.open(), false, 'moving inside the same pivot reopened a closed panel');
    env.select('pivotB');
    openOn(env, D.Pivot, 'cursor entered another pivot');
    env.shell.toggleRightPanel();
    env.flush();
    env.select('cells');
    env.select('pivotA');
    openOn(env, D.Pivot, 'cursor re-entered a pivot');
    noWarnings(env);
});

test('chart_selection_leaves_panel_as_is', () => {
    /* Focus on a chart neither opens nor turns off the right panel (there is no "Chart" tab
       in 9.4). */
    for (const sel of ['chart', 'chartText']) {
        const closed = makeEnv().create();
        closed.select(sel);
        assert.equal(closed.open(), false, sel + ' opened the panel');
        closed.select('image');
        openOn(closed, D.Image, 'image after ' + sel);

        const open = makeEnv().create();
        open.select('image');
        const layouts = open.hlayout.layouts;
        open.select(sel);
        assert.equal(open.open(), true, sel + ' closed the panel');
        assert.equal(open.hlayout.layouts, layouts, sel + ': relayout without a change');
        noWarnings(open);
    }
});

test('right_stays_open_on_cells', () => {
    const env = makeEnv().create();
    env.select('image');
    openOn(env, D.Image, 'image');
    for (const sel of ['cells', 'column', 'cells']) {
        env.select(sel);
        assert.equal(env.open(), true, 'back to cells (' + sel + ') closed the panel');
        assert.equal(env.rightView.minimizedMode, false, sel + ': stock panel collapsed');
    }
    /* A manual opening on cells is the cell tab, a click into a cell does not remove it. */
    const manual = makeEnv().create();
    manual.shell.toggleRightPanel();
    manual.flush();
    openOn(manual, D.Cell, 'manual open on cells');
    manual.select('cells');
    assert.equal(manual.open(), true, 'a cell click closed the manually opened panel');
    noWarnings(manual);
});

test('right_opens_on_stock_rightmenu_open', () => {
    /* "Format → Format cells": the ribbon view sends rightmenu:open, the right panel controller
       unfolds it on the cell tab. */
    const env = makeEnv().create();
    env.toolbarView.trigger('rightmenu:open', [D.Cell]);
    env.rightCtl.onRightMenuOpen(D.Cell);
    openOn(env, D.Cell, 'rightmenu:open');
    env.select('cells');
    assert.equal(env.open(), true, 'cells closed the panel opened by a stock command');

    /* The context menu "Format cells" and the border and orientation "Options" call
       the controller directly, without a ribbon event. */
    const direct = makeEnv().create();
    direct.rightCtl.onRightMenuOpen(D.Cell);
    openOn(direct, D.Cell, 'direct stock open');

    /* The panel was closed manually with the cell tab active: the standard command opens it again -
       a closed one keeps the standard one collapsed, and the stock does not exit before showing. */
    direct.shell.toggleRightPanel();
    direct.flush();
    assert.equal(direct.open(), false, 'manual close did not close');
    assert.equal(direct.rightView.minimizedMode, true, 'closed panel keeps the stock panel expanded');
    direct.rightCtl.onRightMenuOpen(D.Cell);
    openOn(direct, D.Cell, 'stock open after a manual close');

    /* The stock itself unfolded the hidden panel (the remembered "not collapsed"): the next selection
       collapses it back - otherwise "Format cells" would exit without showing. */
    const restored = makeEnv().create();
    restored.rightView.minimizedMode = false;
    restored.rightView.active = D.Cell;
    restored.select('cells');
    assert.equal(restored.open(), false, 'cells opened the panel');
    assert.equal(restored.rightView.minimizedMode, true, 'hidden stock panel stays expanded');
    restored.rightCtl.onRightMenuOpen(D.Cell);
    openOn(restored, D.Cell, 'stock open after the stock expanded itself');

    /* Hiding the right panel is not a reason to open. */
    const hide = makeEnv().create();
    hide.rightView.fireEvent('view:hide', [hide.rightCtl, true]);
    assert.equal(hide.open(), false, 'hiding the stock right menu opened ours');
    noWarnings(env);
    noWarnings(direct);
});

/* "Format → Format cells" is a separate menu row item; it and
   the context "Format cells" open one and the same right cell settings panel. The item is the standard menu item of the ribbon "Format" button
   by the value 'formatCells' (its stock handler - the ribbon rightmenu:open, the right panel controller - onRightMenuOpen(Cell)), without
   its own rightmenu:open: one controller call per command, the panel is open on the cell tab; the context one is a direct call of the same
   controller - the same tab. */
test('format_cells_item_opens_cell_tab', () => {
    const env = makeEnv().create();
    const calls = [];
    const open = env.rightCtl.onRightMenuOpen;
    env.rightCtl.onRightMenuOpen = function (type) { calls.push(type); return open.call(this, type); };
    /* The ribbon "Format" button menu in the stock shape: the "Format cells" item - onCellFormatMenu: toolbar.fireEvent('rightmenu:open',
       [Cell]), the right panel controller is subscribed to it (controller/RightMenu.js). */
    const menu = Object.assign(events(), {items: []});
    const item = {caption: 'Format cells', value: 'formatCells', hidden: false, visible: true, rendered: true, disabled: false, menu: null,
        options: {caption: 'Format cells', value: 'formatCells'}, isDisabled() { return this.disabled; },
        onItemClick() { if (!this.disabled) menu.trigger('item:click', menu, this); }};
    menu.items.push({caption: 'Row height', hidden: false, visible: true, rendered: true, options: {caption: 'Row height'}, isDisabled: () => false,
        onItemClick() {}}, {caption: '--', options: {caption: '--'}}, item);
    menu.on('item:click', (m, it) => { if (it.value === 'formatCells') { env.toolbarView.trigger('rightmenu:open', [D.Cell]); env.rightCtl.onRightMenuOpen(D.Cell); } });
    env.toolbarView.btnFormatCell = Object.assign({disabled: false, pressed: false, keepState: [], options: {}, isDisabled() { return this.disabled; }, click() {}}, {menu});
    const A = env.SSE.Views.SheetActions;
    const it = A.offered('formatCells');
    assert.ok(it, 'no «Format → Format cells» with the stock item');
    assert.equal(A.exec(it, env.shell), true, '«Format cells» did not run');
    env.flush();
    openOn(env, D.Cell, '«Format → Format cells»');
    assert.deepEqual(calls, [D.Cell], 'not one stock open of the cell tab');
    /* The context "Format cells" - the same panel and tab. */
    env.shell.toggleRightPanel();
    env.flush();
    assert.equal(env.open(), false, 'precondition: the panel is closed by hand');
    calls.length = 0;
    env.rightCtl.onRightMenuOpen(D.Cell);
    env.flush();
    openOn(env, D.Cell, 'context «Format cells»');
    assert.deepEqual(calls, [D.Cell]);
    noWarnings(env);
});

test('stock_open_refused_leaves_panel_as_is', () => {
    /* "Format → Format cells…" with an object or chart selected: the ribbon sends
       rightmenu:open, but the cell tab is disabled in the stock, and the right panel controller exits
       before showing - in the stock the command does nothing. The panel is opened only by the stock showing it,
       not by a request: otherwise in the compact a collapsed tab column without a tab (40 px) is visible, and on
       cells it stays. The order of the ribbon listeners in the stock is not defined - both. */
    const formatCells = (env, ribbonFirst) => {
        if (ribbonFirst) env.toolbarView.trigger('rightmenu:open', [D.Cell]);
        env.rightCtl.onRightMenuOpen(D.Cell);
        if (!ribbonFirst) env.toolbarView.trigger('rightmenu:open', [D.Cell]);
        env.flush();
    };
    for (const ribbonFirst of [true, false]) {
        const order = ribbonFirst ? '' : ' (stock listener first)';
        /* Closed by a human with an object selected. */
        for (const sel of ['image', 'shape', 'slicer']) {
            const env = makeEnv().create();
            env.select(sel);
            assert.equal(env.open(), true, sel + ': did not open');
            env.shell.toggleRightPanel();
            env.flush();
            assert.equal(env.open(), false, sel + ': manual close did not close');
            const layouts = env.hlayout.layouts;
            formatCells(env, ribbonFirst);
            assert.equal(env.open(), false, sel + ': refused «Format cells» showed the panel' + order +
                (env.rightView.minimizedMode ? ' as a collapsed tab column' : ''));
            assert.equal(env.hlayout.layouts, layouts, sel + ': relayout without a change' + order);
            env.select('cells');
            assert.equal(env.open(), false, sel + ': a cell click after the refused command shows the panel' + order);
            noWarnings(env);
        }
        /* Chart: the panel is closed from the start. */
        for (const sel of ['chart', 'chartText']) {
            const env = makeEnv().create();
            env.select(sel);
            formatCells(env, ribbonFirst);
            assert.equal(env.open(), false, sel + ': refused «Format cells» showed the panel' + order);
            env.select('cells');
            assert.equal(env.open(), false, sel + ': a cell click after the refused command shows the panel' + order);
            noWarnings(env);
        }
        /* Open on an object: a stock refusal does not touch it. */
        const open = makeEnv().create();
        open.select('image');
        const layouts = open.hlayout.layouts;
        formatCells(open, ribbonFirst);
        openOn(open, D.Image, 'refused «Format cells» with the panel open' + order);
        assert.equal(open.hlayout.layouts, layouts, 'open panel: relayout without a change' + order);
        noWarnings(open);
    }
});

test('stock_self_expand_while_closed_keeps_format_cells', () => {
    /* The stock unfolds the hidden panel itself too, without asc_onSelectionChanged: on load
       createDelayedElements → onChangeProtectSheet → onSelectionChanged calls SetActivePane(Cell,
       true) by the remembered "not collapsed" ('0' in sse-hide-right-settings - it is also written by the
       standard "Format cells" itself). A closed panel must collapse the standard one then too: otherwise
       "Format cells" exits before showing until the first click on the grid ("the tab is already
       active") and does not open the panel. Both command paths - the ribbon and a direct call. */
    const KEY = 'sse-hide-right-settings';
    const load = env => { env.rightView.SetActivePane(D.Cell, true); env.flush(); };
    const paths = [
        ['«Format → Format cells»', env => { env.toolbarView.trigger('rightmenu:open', [D.Cell]); env.rightCtl.onRightMenuOpen(D.Cell); env.flush(); }],
        ['context «Format cells»', env => { env.rightCtl.onRightMenuOpen(D.Cell); env.flush(); }]
    ];
    for (const showExpands of [false, true]) {
        for (const [what, run] of paths) {
            const how = what + (showExpands ? ' (the stock show expands before view:hide)' : '');
            const env = makeEnv({storage: {[KEY]: '0'}, showExpands}).create();
            load(env);
            assert.equal(env.open(), false, how + ': the stock self-expand on load showed the panel');
            assert.equal(env.rightView.minimizedMode, true, how + ': hidden stock panel stays expanded after load');
            assert.equal(env.store.get(KEY), '0', how + ': collapsing the hidden panel changed the stock preference');
            run(env);
            openOn(env, D.Cell, how + ' right after load');
            env.select('cells');
            assert.equal(env.open(), true, how + ': a cell click closed the panel opened by a stock command');
            assert.equal(env.rightView.minimizedMode, false, how + ': the open panel collapsed');
            noWarnings(env);
        }
    }
    /* An open panel is not touched by the stock unfolding signal (the stock tab was pressed by a human). */
    const open = makeEnv().create();
    open.select('image');
    open.NC.trigger('layout:changed', 'rightmenu');
    open.flush();
    openOn(open, D.Image, 'stock layout signal with the panel open');
    /* In the Standard the stock manages the right panel: we do not collapse its unfolding there. */
    const adv = makeEnv().create();
    adv.shell.toggleMode();
    adv.rightView.SetActivePane(D.Cell, true);
    adv.flush();
    assert.equal(adv.rightView.minimizedMode, false, 'the stock panel was collapsed in advanced');
    noWarnings(open);
    noWarnings(adv);
});

/* "View" without "Object properties": the right panel opens by itself when selecting an
   image, a shape, a text box, a slicer, on entering a pivot table and by the "Format cells" command. The panel was closed, but the object settings
   need to be opened again - clear the selection and select the object again: the panel opens by itself. There is no item in "View"; to close - with
   the shell command (toggleRightPanel remains) or collapse with the standard tab (the stock collapses the panel to the tab column):
   repeating the same selection does not bring the panel back, a new object selection brings it back unfolded on its tab. */
test('object_panel_reopens_on_select', () => {
    const env = makeEnv().create();
    const A = env.SSE.Views.SheetActions;
    const walk = list => list.some(i => i.k === 'objectProps' || (i.items && walk(i.items)));
    assert.ok(!A.catalog().some(g => walk(g.items)), '«Object settings» is still in the menu');
    env.select('image');
    openOn(env, D.Image, 'image');
    env.shell.toggleRightPanel();
    env.flush();
    assert.equal(env.open(), false, 'the shell command did not close the panel');
    assert.equal(env.rightView.minimizedMode, true, 'closed panel keeps the stock panel expanded');
    env.select('image');
    assert.equal(env.open(), false, 'the same image selection reopened a closed panel');
    env.select('cells');
    env.select('image');
    openOn(env, D.Image, 'a new image selection');
    /* Collapsed by the standard tab (only the tab column) - a new object selection unfolds it again on its tab. */
    env.rightView.clearSelection();
    env.flush();
    assert.equal(env.rightView.minimizedMode, true, 'precondition: the stock panel is collapsed');
    env.select('cells');
    env.select('shape');
    openOn(env, D.Shape, 'a new shape selection after the stock collapse');
    noWarnings(env);
});

test('right_decision_survives_advanced_roundtrip', () => {
    const env = makeEnv().create();
    env.select('image');
    openOn(env, D.Image, 'image');
    env.shell.toggleMode();
    assert.ok(env.body().contains('vo-advanced'), 'not in advanced');
    assert.equal(env.open(), false, 'own class kept in advanced');
    /* In the Standard the stock manages the panel: it was collapsed - on the return an open panel
       is unfolded again on the object tab. */
    env.rightView.minimizedMode = true;
    env.rightView.active = null;
    env.shell.toggleMode();
    openOn(env, D.Image, 'back from advanced');

    /* The decision is kept in the Standard too: an image was selected there - on the return the panel is open. */
    const adv = makeEnv().create();
    adv.shell.toggleMode();
    adv.select('image');
    assert.equal(adv.open(), false, 'own class set in advanced');
    adv.shell.toggleMode();
    openOn(adv, D.Image, 'image selected in advanced');

    /* Closed - a round through the Standard does not open it. */
    const closed = makeEnv().create();
    closed.select('cells');
    closed.shell.toggleMode();
    closed.shell.toggleMode();
    assert.equal(closed.open(), false, 'closed panel opened after the round trip');
    noWarnings(env);
    noWarnings(adv);
});

test('right_panel_needs_stock_panel', () => {
    /* There is no standard right panel - a reader (not rendered), the integrator hid it, or
       there is no controller: our class does not show it, a manual entry breaks nothing. */
    const variants = [
        ['not rendered (reader)', {rendered: false}],
        ['hidden by the integrator', {hidden: ['rightMenu']}],
        ['no controller', {noRightMenu: true}]
    ];
    for (const [what, opt] of variants) {
        const env = makeEnv(opt).create();
        env.select('image');
        assert.equal(env.open(), false, what + ': image opened the panel');
        assert.doesNotThrow(() => { env.shell.toggleRightPanel(); env.flush(); }, what);
        assert.equal(env.open(), false, what + ': manual open showed the panel');
        noWarnings(env);
    }
    const branded = makeEnv().create();
    branded.rightView.mode = {isEdit: true, canBrandingExt: true, customization: {rightMenu: false}};
    branded.select('image');
    assert.equal(branded.open(), false, 'customization.rightMenu = false: image opened the panel');
});

/* There is no comments button in the header: the panel is opened and closed by the "Collaboration →
   Comments" item - with the standard panel button (LeftMenu:btnComments); closing with the panel close (X) button
   hides the area. A disabled standard button - the item is inactive and presses nothing. Without the right
   (canCoAuthoring && canViewComments) there is no item; without the standard button the item is inactive. */
test('comments_panel_from_menu_not_header', () => {
    const env = makeEnv().create();
    const SA = env.SSE.Views.SheetActions;
    /* A boolean, not a node: an assert message about a fake node would unfold the whole DOM. */
    assert.equal(!!env.header().querySelector('.vo-hd-comments'), false, '«Comments» in the header');
    env.openComments();
    env.flush();
    assert.equal(env.leftMenu.btnComments.pressed, true, '«Collaboration → Comments» did not press the stock comments button');
    assert.ok(env.body().contains('vo-left-open'), 'left area is not shown for comments');
    env.openComments();
    env.flush();
    assert.equal(env.leftMenu.btnComments.pressed, false, 'the second «Collaboration → Comments» did not close the panel');
    assert.equal(env.body().contains('vo-left-open'), false, 'left area stays after the panel closed');
    /* Closed with the panel close (X) button - the area hides. */
    env.openComments();
    env.flush();
    env.leftMenu.btnComments.pressed = false;
    env.NC.trigger('layout:changed', 'leftmenu');
    assert.equal(env.body().contains('vo-left-open'), false, 'left area stays after a stock close');
    /* A disabled standard button - the item is inactive, a click presses nothing. */
    env.leftMenu.btnComments.disabled = true;
    env.sectionButton(SA.textCollaboration).click();
    const row = env.doc.querySelector('[data-k="comments"]');
    assert.ok(row, 'no «Collaboration → Comments» row');
    assert.equal(row.getAttribute('aria-disabled'), 'true', 'the row is active with the stock button disabled');
    row.click();
    env.flush();
    assert.equal(env.leftMenu.btnComments.pressed, false, 'disabled stock button was pressed');
    env.shell.closeSurfaces();
    noWarnings(env);

    /* Without the right - there is no item. */
    for (const [what, opt] of [
        ['no canViewComments', {options: {canViewComments: false}}],
        ['no canCoAuthoring', {options: {canCoAuthoring: false}}]
    ]) {
        const no = makeEnv(opt).create();
        assert.equal(no.SSE.Views.SheetActions.offered('comments'), null, what + ': «Collaboration → Comments» is offered');
        assert.equal(!!no.header().querySelector('.vo-hd-comments'), false, what + ': «Comments» in the header');
        noWarnings(no);
    }
    /* Without the standard panel button: the menu row item is inactive (a missing double is a Compact shell
       warning, as for the other items), the header without comments. */
    const gone = makeEnv({noCommentsButton: true}).create();
    const it = gone.SSE.Views.SheetActions.offered('comments');
    assert.ok(it, 'precondition: the catalog keeps the item without the stock button');
    assert.equal(gone.SSE.Views.SheetActions.itemState(it, gone.shell).disabled, true, 'no stock button: the item is active');
    assert.equal(!!gone.header().querySelector('.vo-hd-comments'), false, 'no stock button: «Comments» in the header');
    assert.ok(gone.warnings.length === 1 && /LeftMenu:btnComments/.test(String(gone.warnings[0][0])),
        'no stock button: not one warning about the missing control: ' + JSON.stringify(gone.warnings.map(w => String(w[0]))));
});

/* Closings of the left area (vo-left-open) during a step: the shell removing the class. */
function spyCloses(env) {
    const closes = [];
    const cl = env.body(), remove = cl.remove, toggle = cl.toggle;
    cl.remove = (...n) => { if (n.includes('vo-left-open') && cl.contains('vo-left-open')) closes.push('remove'); return remove(...n); };
    cl.toggle = (n, f) => { if (n === 'vo-left-open' && f === false && cl.contains(n)) closes.push('toggle'); return toggle(n, f); };
    return closes;
}

/* The edit right is taken away while the comments panel is open ("Collaboration → Comments" is open). */
function rightsTakenWithComments() {
    const env = makeEnv({stockMenu: true}).create();
    env.openComments();
    env.flush();
    assert.ok(env.body().contains('vo-left-open') && env.leftMenu.$el.width() > 40, 'precondition: the comments panel is open');
    env.disconnect();
    assert.deepEqual([env.main._state.isDisconnected, env.main.appOptions.canCoAuthoring, env.leftMenu.btnComments.pressed,
        env.leftMenu.btnComments.disabled], [true, false, true, true],
        'precondition: the stock left the comments button pressed and disabled');
    return env;
}

/* The edit right was taken away while the comments panel is open. The stock squeezes
   the menu to the icon column (close(): SCALE_MIN 40), and unpresses the comments button only with
   canCoAuthoring, which Main.onCoAuthoringDisconnect has already removed by this time: the button
   stays pressed and goes disabled. In the stock 40 px is its icon column, the panel is hidden; the compact has no
   column, and the area by the pressed button stayed a 40 px strip of the panel with a sheet shift.
   The area goes by the place for a panel, as in the stock: a menu no wider than the icon column - hidden (one
   layout recalculation). The place is by the stock record, not by $el.width() - jQuery reads
   the menu of a shown area without the compact divider (40), of a hidden one - with it (41), and the next
   layout:changed brought the strip back; the standard readers of the hidden menu (Viewport.onLayoutChanged)
   see the icon column - without the layout divider to the left of the sheet. A control: the button is disabled,
   but the menu is wider than the icon column (a temporary edit restriction) - the area is visible, being disabled does not
   count as closing. */
test('rights_taken_hides_left_area_as_stock', () => {
    const env = makeEnv({stockMenu: true}).create();
    /* Opening by the standard path: the first layout:changed comes while the menu is still the icon column - the
       area shown in advance (revealLeft) is not closed in the middle of opening. */
    const closes = spyCloses(env);
    env.openComments();
    env.flush();
    assert.ok(env.body().contains('vo-left-open') && env.leftMenu.$el.width() > 40, 'precondition: the comments panel is open');
    assert.deepEqual(closes, [], 'the left area closed in the middle of the stock open (layout change before the menu got wider)');
    const before = env.hlayout.layouts;
    env.disconnect();
    assert.deepEqual([env.main._state.isDisconnected, env.main.appOptions.canCoAuthoring, env.leftMenu.btnComments.pressed,
        env.leftMenu.btnComments.disabled], [true, false, true, true],
        'precondition: the stock left the comments button pressed and disabled');
    assert.equal(env.body().contains('vo-left-open'), false, 'the left area stays: a 40 px strip of the comments panel, the sheet shifted');
    assert.ok(env.hlayout.layouts > before, 'no relayout after the left area was hidden');
    /* The next layout:changed (for example, the right panel) does not bring the area back, and the standard
       layout subscriber sees the icon column. */
    env.NC.trigger('layout:changed', 'leftmenu');
    env.flush();
    assert.equal(env.body().contains('vo-left-open'), false, 'the left area came back on the next layout change (a 40 px strip of the comments panel)');
    assert.equal(env.leftMenu.$el.width(), 40, 'the hidden menu reads ' + env.leftMenu.$el.width() + ' for the stock (jQuery) — a panel, not the icon column');
    assert.deepEqual([env.stockView.resizer, env.stockView.sdkBorder], [false, 'none'],
        'the stock layout shows its resizer and the sheet border left of the sheet (sheet 4 px right): ' + JSON.stringify(env.stockView));
    noWarnings(env);

    const lock = makeEnv({stockMenu: true}).create();
    lock.openComments();
    lock.flush();
    lock.leftMenu.btnComments.disabled = true;
    lock.NC.trigger('layout:changed', 'leftmenu');
    assert.ok(lock.body().contains('vo-left-open'), 'a disabled but open panel (menu wider than the icon column) was hidden');
    noWarnings(lock);
});

/* After the right is taken away with the comments panel open, "Edit → Find and replace"
   opens the search panel at full width: the shell shows the area
   (revealLeft), the standard onBtnMenuClick sends the first layout:changed before it widens the menu -
   until the end of the task the place check does not close the area, and the stock, having read the width of the shown
   area (the icon column), widens the menu. Before, the area was closed in the middle of opening, the stock
   read the hidden menu as wide and did not widen it - the search did not open. On the next tick it is
   open. Opening again after closing the search - the same. */
test('rights_taken_find_replace_opens_search', () => {
    const env = rightsTakenWithComments();
    assert.equal(env.body().contains('vo-left-open'), false, 'precondition: no left area after the rights were taken');
    for (const round of ['first', 'again']) {
        const closes = spyCloses(env);
        env.menuRow('textEdit', 'findReplace');
        assert.ok(env.leftMenu.btnSearchBar.pressed, round + ': precondition: the stock pressed the search button');
        assert.deepEqual(closes, [], round + ': the left area closed in the middle of the stock open');
        assert.deepEqual([env.body().contains('vo-left-open'), env.leftMenu.$el.width()], [true, 300],
            round + ': «Edit → Find and replace» did not open the search panel (left area, menu width)');
        env.flush();
        assert.deepEqual([env.body().contains('vo-left-open'), env.leftMenu.$el.width()], [true, 300],
            round + ': the search panel closed on the next tick');
        /* Close the search the standard way (onShowHideSearch(false): the button is unpressed, onBtnMenuClick). */
        env.leftMenu.btnSearchBar.toggle(false, true);
        env.leftMenu.onBtnMenuClick(env.leftMenu.btnSearchBar);
        env.flush();
        assert.deepEqual([env.body().contains('vo-left-open'), env.leftMenu.$el.width()], [false, 40], round + ': the search panel did not close');
    }
    noWarnings(env);
});

/* After the right is taken away the standard Ctrl+H (onShortcut('replace') → onShowHideSearch:
   showMenu refuses - the search button is not visible in the compact - then the button is pressed without an event,
   the menu is not widened) and the next layout:changed 'leftmenu' do not bring the strip back: a pressed
   button without a place for the panel is not an open panel. Showing a closed area versus the inline
   show() of the stock is the Chrome section (left_menu_closed_against_stock_show). */
test('rights_taken_stock_search_shortcut_leaves_no_strip', () => {
    const env = rightsTakenWithComments();
    env.leftMenu.btnSearchBar.toggle(true, true);
    env.NC.trigger('layout:changed', 'leftmenu');
    assert.equal(env.body().contains('vo-left-open'), false, 'Ctrl+H brought back the left area: a strip without room for a panel');
    env.flush();
    assert.equal(env.body().contains('vo-left-open'), false, 'the left area came back on the next tick');
    assert.deepEqual([env.stockView.resizer, env.stockView.sdkBorder], [false, 'none'],
        'the stock layout shows its resizer left of the sheet: ' + JSON.stringify(env.stockView));
    noWarnings(env);
});

/* The place for the panel after disconnect does not depend on whether the area itself is shown.
   The stock record goes into a shown area (with the divider) or a hidden one (without it): the icon
   column - no room, the menu with a panel - there is room, for both a shown and a hidden area. Before,
   the check read $el.width(): the column recorded into a shown area was read by a hidden one as
   41 - "there is room". */
test('left_room_same_shown_and_hidden', () => {
    const env = makeEnv({stockMenu: true}).create();
    env.main._state.isDisconnected = true;
    const cl = env.body();
    const room = shown => { cl.toggle('vo-left-open', shown); return env.shell.leftRoom(); };
    for (const [w, want] of [[40, false], [300, true]]) {
        for (const writtenShown of [true, false]) {
            cl.toggle('vo-left-open', writtenShown);
            env.leftMenu.$el.width(w);
            const got = [room(true), room(false)];
            assert.deepEqual(got, [want, want], 'menu ' + w + ' written into a ' + (writtenShown ? 'shown' : 'hidden') + ' area (' +
                env.leftMenu.$el[0].style.width + '): room shown/hidden ' + JSON.stringify(got) + ', want ' + want);
        }
    }
    cl.toggle('vo-left-open', false);
});

/* The revealLeft allowance lives until the end of the task. The area is shown for opening, but the stock
   did not widen the menu (the button is disabled - Bridge.run does not press it) - on the next tick the check without
   the allowance hides the area: no strip is left. */
test('reveal_without_stock_open_hides_next_tick', () => {
    const env = rightsTakenWithComments();
    env.shell.revealLeft();
    assert.ok(env.body().contains('vo-left-open'), 'precondition: the area is shown for an open');
    env.NC.trigger('layout:changed', 'leftmenu');
    assert.ok(env.body().contains('vo-left-open'), 'the area shown for an open closed within the task');
    env.flush();
    assert.equal(env.body().contains('vo-left-open'), false, 'the area stays without a panel after the task: a 40 px strip');
    noWarnings(env);
});

/* The stock search panel in the compact. The search state through human eyes: the area,
   the menu width (jQuery), whether the search button is pressed, whether the panel is visible. Open search is as for the
   "Edit → Find and replace" item: the area, the menu 300 (MENU_SCALE_PART), the panel is visible. */
const searchState = env => ({area: env.body().contains('vo-left-open'), menu: env.leftMenu.$el.width(),
    pressed: !!env.leftMenu.btnSearchBar.pressed, panel: env.panelSearch.isVisible()});
const SEARCH_OPEN = {area: true, menu: 300, pressed: true, panel: true};
const afterShowTexts = env => env.leftEvents.filter(e => e[0] === 'search:aftershow' && e[1] !== 'view').map(e => e[1] && e[1][0]);

/* Ctrl+H in the compact is the same "Find and replace" as the menu row item. The standard
   onShortcut('replace') → onShowHideSearch → showMenu('advancedsearch'): the stock opens the panel
   only if its button in the icon column is visible, and the compact has no column. Before, showMenu
   refused, onShortcut pressed the search button without an event - neither the area nor the panel; the next
   layout:changed 'leftmenu' showed an empty 40 px area, and "Edit → Find and replace" after
   that only set focus (the button was already pressed). Now Ctrl+H gives the area, the menu 300, the search
   panel is visible, focus is in the search field, the button is pressed with one click (the item path, revealLeft without
   closings in the middle of opening); the result is the same as for the menu item in a fresh environment; the next tick
   and layout:changed do not change it; "Find and replace" after Ctrl+H - focus in the visible panel;
   close the search the standard way and Ctrl+H again - open. */
test('ctrl_h_opens_find_replace_like_menu_item', () => {
    const env = makeEnv({stockMenu: true}).create();
    const closes = spyCloses(env);
    assert.equal(env.ctrlH(), false, 'the stock shortcut handler did not take Ctrl+H');
    assert.deepEqual(searchState(env), SEARCH_OPEN, 'Ctrl+H did not open «Find and replace»: ' + JSON.stringify(searchState(env)));
    assert.deepEqual(closes, [], 'the left area closed in the middle of the open');
    assert.equal(env.leftMenu.btnSearchBar.clicks, 1, 'Ctrl+H did not go the way of «Edit → Find and replace» (one press of the stock search button)');
    assert.equal(env.panelSearch.focuses[env.panelSearch.focuses.length - 1], 'search', 'Ctrl+H without selected text: focus is not in the search field');
    env.flush();
    assert.deepEqual(searchState(env), SEARCH_OPEN, 'the search panel closed on the next tick: ' + JSON.stringify(searchState(env)));
    env.NC.trigger('layout:changed', 'leftmenu');
    env.flush();
    assert.deepEqual(searchState(env), SEARCH_OPEN, 'the next layout change: ' + JSON.stringify(searchState(env)) + ' (an empty 40 px area?)');
    const menu = makeEnv({stockMenu: true}).create();
    menu.menuRow('textEdit', 'findReplace');
    menu.flush();
    assert.deepEqual(searchState(env), searchState(menu), 'Ctrl+H and «Edit → Find and replace» differ');
    const n = env.panelSearch.focuses.length;
    env.menuRow('textEdit', 'findReplace');
    env.flush();
    assert.ok(env.panelSearch.focuses.length > n && env.panelSearch.isVisible(), '«Edit → Find and replace» after Ctrl+H: no focus in a visible search panel');
    assert.deepEqual(searchState(env), SEARCH_OPEN, '«Edit → Find and replace» after Ctrl+H closed the search');
    env.leftMenu.btnSearchBar.toggle(false, true);
    env.leftMenu.onBtnMenuClick(env.leftMenu.btnSearchBar);
    env.flush();
    assert.deepEqual([env.body().contains('vo-left-open'), env.leftMenu.$el.width()], [false, 40], 'precondition: the search panel closed');
    env.ctrlH();
    env.flush();
    assert.deepEqual(searchState(env), SEARCH_OPEN, 'Ctrl+H again: ' + JSON.stringify(searchState(env)));
    noWarnings(env);
    noWarnings(menu);
});

/* Ctrl+H with selected text is the standard continuation: the text goes into the search
   (search:aftershow), focus goes to the replace field; with the comments panel open the search replaces it
   (one area, the menu of the same width). */
test('ctrl_h_keeps_stock_text_and_replace_focus', () => {
    const env = makeEnv({stockMenu: true, selectedText: 'Март'}).create();
    env.ctrlH();
    env.flush();
    assert.deepEqual(searchState(env), SEARCH_OPEN, 'Ctrl+H with a selection: ' + JSON.stringify(searchState(env)));
    assert.deepEqual(afterShowTexts(env), ['Март'], 'the selected text did not go to the search');
    assert.equal(env.panelSearch.focuses[env.panelSearch.focuses.length - 1], 'replace', 'Ctrl+H with a selection: focus is not in the replace field');

    const com = makeEnv({stockMenu: true}).create();
    com.openComments();
    com.flush();
    assert.ok(com.leftMenu.btnComments.pressed && com.leftMenu.$el.width() === 300, 'precondition: the comments panel is open');
    com.ctrlH();
    com.flush();
    assert.deepEqual(searchState(com), SEARCH_OPEN, 'Ctrl+H over the comments panel: ' + JSON.stringify(searchState(com)));
    assert.equal(com.leftMenu.btnComments.pressed, false, 'the comments button stays pressed under the search');
    noWarnings(env);
    noWarnings(com);
});

/* Handing the search from the floating bar (Ctrl+F) to the panel. Ctrl+H with a visible bar
   (standard: the header search button is unpressed - the bar is hidden, onShowHideSearch with the bar text) and
   the bar "Open panel" button ('search:show' [true, text] → onShowHideSearch) open the panel
   with the bar text. Before, the bar hid and the panel did not open. */
test('search_bar_hands_off_to_panel', () => {
    const key = makeEnv({stockMenu: true}).create();
    key.viewportCtl.header.btnSearch.toggle(true);
    key.searchBar.setText('Март');
    key.ctrlH();
    key.flush();
    assert.equal(key.searchBar.isVisible(), false, 'Ctrl+H left the floating search bar');
    assert.deepEqual(searchState(key), SEARCH_OPEN, 'Ctrl+H from the search bar: ' + JSON.stringify(searchState(key)));
    assert.deepEqual(afterShowTexts(key), ['Март'], 'the search bar text did not go to the panel');

    const btn = makeEnv({stockMenu: true}).create();
    btn.viewportCtl.header.btnSearch.toggle(true);
    btn.searchBar.setText('Март');
    btn.searchBar.hide();
    btn.lmCtl.onShowHideSearch(true, 'Март');
    btn.flush();
    assert.deepEqual(searchState(btn), SEARCH_OPEN, '«Open panel» of the search bar: ' + JSON.stringify(searchState(btn)));
    assert.deepEqual(afterShowTexts(btn), ['Март'], 'the search bar text did not go to the panel');
    noWarnings(key);
    noWarnings(btn);
});

/* In the Standard Ctrl+H is standard: the icon column is visible, the stock showMenu opens
   the panel itself (the button is pressed by toggle, without a shell click), there is no compact area class. A refusal is as in the
   stock: the left menu is hidden by the integrator (LayoutManager, customization.leftMenu) or the search
   button is disabled - the shell does not open the panel. */
test('ctrl_h_stock_in_advanced_and_refusals', () => {
    const adv = makeEnv({stockMenu: true}).create();
    adv.shell.toggleMode();
    assert.ok(adv.body().contains('vo-advanced'), 'precondition: the standard interface');
    adv.ctrlH();
    adv.flush();
    assert.deepEqual([adv.leftMenu.btnSearchBar.clicks, adv.leftMenu.btnSearchBar.pressed, adv.panelSearch.isVisible(),
        adv.leftMenu.$el.width(), adv.body().contains('vo-left-open')], [0, true, true, 300, false],
        'standard interface: Ctrl+H is not the stock one (shell press, area class)');
    noWarnings(adv);

    for (const [what, opt] of [['left menu hidden by the integrator', {hidden: ['leftMenu']}],
        ['customization.leftMenu false', {options: {canBrandingExt: true, customization: {leftMenu: false}}}]]) {
        const env = makeEnv(Object.assign({stockMenu: true}, opt)).create();
        env.ctrlH();
        env.flush();
        assert.deepEqual([env.leftMenu.btnSearchBar.clicks, env.panelSearch.shown], [0, false], what + ': the shell opened the search panel');
        noWarnings(env);
    }
    const off = makeEnv({stockMenu: true}).create();
    off.leftMenu.btnSearchBar.disabled = true;
    off.lmCtl.onShowHideSearch(true, 'Март');
    off.flush();
    assert.deepEqual([off.leftMenu.btnSearchBar.clicks, off.panelSearch.shown, off.body().contains('vo-left-open')], [0, false, false],
        'a disabled search button: the shell opened the search panel');
    noWarnings(off);
});

/* After the right is taken away with the comments panel open the real Ctrl+H
   (the standard onShortcut) is "Find and replace" at full width, like the menu item in the same state
   (rights_taken_find_replace_opens_search): the area without closings in the middle of opening (the
   revealLeft allowance - the stock reads the shown menu and widens it), the menu 300, the panel is visible; close the search
   the standard way - without a strip and without the layout divider. Before, Ctrl+H here opened nothing (the button
   was pressed without a panel). */
test('rights_taken_ctrl_h_opens_search', () => {
    const env = rightsTakenWithComments();
    assert.equal(env.body().contains('vo-left-open'), false, 'precondition: no left area after the rights were taken');
    const closes = spyCloses(env);
    env.ctrlH();
    assert.deepEqual(closes, [], 'the left area closed in the middle of the stock open');
    assert.deepEqual(searchState(env), SEARCH_OPEN, 'Ctrl+H after the rights were taken: ' + JSON.stringify(searchState(env)));
    env.flush();
    assert.deepEqual(searchState(env), SEARCH_OPEN, 'the search panel closed on the next tick: ' + JSON.stringify(searchState(env)));
    env.leftMenu.btnSearchBar.toggle(false, true);
    env.leftMenu.onBtnMenuClick(env.leftMenu.btnSearchBar);
    env.flush();
    assert.deepEqual([env.body().contains('vo-left-open'), env.leftMenu.$el.width(), env.stockView.resizer], [false, 40, false],
        'the search panel closed with a trace (area, menu width, stock resizer)');
    noWarnings(env);
});

/* The stock comments and chat panels in the compact. The panel state through human
   eyes: the area, the menu width (jQuery), whether the standard button is pressed, whether the panel is visible. Open is
   as for the "Review" items: the area, the menu 300, the panel is visible. */
const panelState = (env, which) => {
    const btn = which === 'chat' ? env.leftMenu.btnChat : env.leftMenu.btnComments;
    const panel = which === 'chat' ? env.panelChat : env.panelComments;
    return {area: env.body().contains('vo-left-open'), menu: env.leftMenu.$el.width(), pressed: !!btn.pressed, panel: panel.isVisible()};
};
const PANEL_OPEN = {area: true, menu: 300, pressed: true, panel: true};
const PANEL_SHUT = {area: false, menu: 40, pressed: false, panel: false};

/* Ctrl+Shift+H in the compact is the same comments panel as the item
   "Collaboration → Comments". The standard onShortcut('comments') → showMenu('comments'): the stock
   opens the panel only if its button in the icon column is visible, and the compact has no column -
   before, the key did nothing. Now - the area, the menu 300, the panel is visible, the button is pressed with one
   click (the item path, without closings in the middle of opening), the result is the same as for the item; the standard
   continuation (onAfterShow) is its own. Focus stays where it was: its own panel button, where the standard
   showMenu puts it, the stock keeps in the icon column. The next tick and layout:changed do not change the result.
   A repeated key does not close an open panel (the standard showMenu does not touch it), the item
   does close it. In focus mode - the same. */
test('ctrl_shift_h_opens_comments_like_menu_item', () => {
    const env = makeEnv({stockMenu: true}).create();
    const closes = spyCloses(env);
    assert.equal(env.ctrlShiftH(), false, 'the stock shortcut handler did not take Ctrl+Shift+H');
    assert.deepEqual(panelState(env), PANEL_OPEN, 'Ctrl+Shift+H did not open the comments panel: ' + JSON.stringify(panelState(env)));
    assert.deepEqual(closes, [], 'the left area closed in the middle of the open');
    assert.equal(env.leftMenu.btnComments.clicks, 1, 'Ctrl+Shift+H did not go the way of «Comments» (one press of the stock comments button)');
    /* A boolean, not a node: an assert message about a fake node would unfold the whole DOM. */
    assert.deepEqual([env.doc.activeElement === env.doc.body, env.stockFocus], [true, []],
        'Ctrl+Shift+H moved the focus (to the hidden stock button)');
    assert.deepEqual(env.commentsLog, ['afterShow'], 'the stock follow-up of Ctrl+Shift+H (onAfterShow of the comments) did not run once');
    env.flush();
    assert.deepEqual(panelState(env), PANEL_OPEN, 'the comments panel closed on the next tick: ' + JSON.stringify(panelState(env)));
    env.NC.trigger('layout:changed', 'leftmenu');
    env.flush();
    assert.deepEqual(panelState(env), PANEL_OPEN, 'the next layout change: ' + JSON.stringify(panelState(env)) + ' (an empty 40 px area?)');
    const hd = makeEnv({stockMenu: true}).create();
    hd.openComments();
    hd.flush();
    assert.deepEqual(panelState(env), panelState(hd), 'Ctrl+Shift+H and «Collaboration → Comments» differ');
    env.ctrlShiftH();
    env.flush();
    assert.deepEqual(panelState(env), PANEL_OPEN, 'Ctrl+Shift+H again closed the open comments panel');
    assert.equal(env.leftMenu.btnComments.clicks, 1, 'Ctrl+Shift+H again pressed the stock comments button');
    env.openComments();
    env.flush();
    assert.deepEqual(panelState(env), PANEL_SHUT, 'precondition: «Collaboration → Comments» closed the panel');
    env.shell.setChrome({focus: true});
    env.ctrlShiftH();
    env.flush();
    assert.deepEqual(panelState(env), PANEL_OPEN, 'focus mode: Ctrl+Shift+H did not open the comments panel: ' + JSON.stringify(panelState(env)));
    assert.deepEqual([env.doc.activeElement === env.doc.body, env.stockFocus], [true, []], 'focus mode: Ctrl+Shift+H moved the focus');
    noWarnings(env);
    noWarnings(hd);
});

/* "Collaboration": there is no "Chat" (discussion is in the
   portal messenger), and the former key path (Alt+Q - by the path of "Review → Chat") is removed:
   Alt+Q (on macOS Ctrl+Alt+Q) in the compact opens nothing, like the stock without an icon column - neither the area nor a pressed
   chat button nor the panel, focus stays in place; the shell does not drive the standard showMenu('chat'); the "Chat" of the "Collaboration
   " tab (collaboration:chat → onShowHideChat) - the same. Ctrl+Shift+H and comments are as before; in the Standard Alt+Q is
   standard (comments_chat_keys_stock_in_advanced_and_refusals). */
test('alt_q_silent_without_chat', () => {
    const env = makeEnv({stockMenu: true, options: {canChat: true}}).create();
    const closes = spyCloses(env);
    assert.equal(env.shell.leftInShell(env.leftMenu, 'chat'), false, 'the shell still takes the stock showMenu(\'chat\')');
    env.altQ();
    env.flush();
    env.NC.trigger('layout:changed', 'leftmenu');
    env.flush();
    assert.deepEqual(panelState(env, 'chat'), PANEL_SHUT, 'Alt+Q opened the chat in compact: ' + JSON.stringify(panelState(env, 'chat')));
    assert.deepEqual([env.leftMenu.btnChat.clicks, env.stockFocus, env.doc.activeElement === env.doc.body], [0, [], true],
        'Alt+Q pressed the stock chat button or moved the focus');
    assert.deepEqual(closes, [], 'Alt+Q closed the left area');
    assert.equal(env.SSE.Views.SheetActions.offered('chat'), null, 'the menu row still offers «Chat»');
    const rev = makeEnv({stockMenu: true, options: {canChat: true}}).create();
    rev.lmCtl.onShowHideChat(true);
    rev.flush();
    assert.deepEqual([panelState(rev, 'chat'), rev.leftMenu.btnChat.clicks], [PANEL_SHUT, 0], '«Chat» of the collaboration tab opened the chat in compact');
    /* Ctrl+Shift+H after Alt+Q - the former comments. */
    env.ctrlShiftH();
    env.flush();
    assert.deepEqual(panelState(env), PANEL_OPEN, 'Ctrl+Shift+H after Alt+Q: ' + JSON.stringify(panelState(env)));
    noWarnings(env);
    noWarnings(rev);
});

/* A document comment (the "Comment" button when a non-cell-range is selected:
   'app:comment:add' with to_doc → onAppAddComment → showMenu('comments')) opens the comments panel
   with the new comment field - the standard continuation (showEditContainer, onAfterShow). Before, in the
   compact there was no panel, the field opened in a hidden one. */
test('document_comment_opens_comments_panel', () => {
    const env = makeEnv({stockMenu: true}).create();
    env.addDocComment();
    env.flush();
    assert.deepEqual(panelState(env), PANEL_OPEN, 'a document comment did not open the comments panel: ' + JSON.stringify(panelState(env)));
    assert.equal(env.leftMenu.btnComments.clicks, 1, 'not the way of «Comments»');
    assert.deepEqual(env.commentsLog, ['edit true', 'afterShow'], 'the stock follow-up (new comment field) did not run');
    noWarnings(env);
});

/* In the Standard the keys are standard: the icon column is visible, the stock showMenu opens
   the panel itself (without a shell click), focus goes to its comments button, there is no compact area class.
   The refusals are as in the stock: the left menu is hidden by the integrator (LayoutManager, customization.leftMenu),
   the panel button is disabled, no right (there is no item in the menu row) - the shell does not open the panel. */
test('comments_chat_keys_stock_in_advanced_and_refusals', () => {
    const adv = makeEnv({stockMenu: true, options: {canChat: true}}).create();
    adv.shell.toggleMode();
    assert.ok(adv.body().contains('vo-advanced'), 'precondition: the standard interface');
    adv.ctrlShiftH();
    adv.flush();
    assert.deepEqual([adv.leftMenu.btnComments.clicks, panelState(adv), adv.stockFocus], [0, Object.assign({}, PANEL_OPEN, {area: false}), ['comments']],
        'standard interface: Ctrl+Shift+H is not the stock one (shell press, area class, focus)');
    adv.altQ();
    adv.flush();
    assert.deepEqual([adv.leftMenu.btnChat.clicks, panelState(adv, 'chat')], [0, Object.assign({}, PANEL_OPEN, {area: false})],
        'standard interface: Alt+Q is not the stock one');
    noWarnings(adv);

    for (const [what, opt] of [['left menu hidden by the integrator', {hidden: ['leftMenu']}],
        ['customization.leftMenu false', {options: {canChat: true, canBrandingExt: true, customization: {leftMenu: false}}}]]) {
        const env = makeEnv(Object.assign({stockMenu: true, options: {canChat: true}}, opt)).create();
        env.ctrlShiftH();
        env.altQ();
        env.addDocComment();
        env.flush();
        assert.deepEqual([env.leftMenu.btnComments.clicks, env.leftMenu.btnChat.clicks, env.panelComments.shown, env.panelChat.shown],
            [0, 0, false, false], what + ': the shell opened the comments or the chat');
        noWarnings(env);
    }
    const off = makeEnv({stockMenu: true, options: {canChat: true}}).create();
    off.leftMenu.btnComments.disabled = true;
    off.leftMenu.btnChat.disabled = true;
    off.ctrlShiftH();
    off.altQ();
    off.flush();
    assert.deepEqual([off.leftMenu.btnComments.clicks, off.leftMenu.btnChat.clicks, off.panelComments.shown, off.panelChat.shown,
        off.body().contains('vo-left-open')], [0, 0, false, false, false], 'disabled stock buttons: the shell opened a panel');
    noWarnings(off);
    /* Without the right the standard onShortcut does not drive the key; the direct standard showMenu (onAppAddComment,
       onShowHideChat) - there is no item in the menu row, the shell does not open. */
    for (const [what, opts, menuName] of [['no canViewComments', {canViewComments: false}, 'comments'], ['no canChat', {canChat: false}, 'chat']]) {
        const env = makeEnv({stockMenu: true, options: opts}).create();
        env.leftMenu.showMenu(menuName);
        env.flush();
        assert.deepEqual([env.leftMenu.btnComments.clicks, env.leftMenu.btnChat.clicks, env.body().contains('vo-left-open')], [0, 0, false],
            what + ': the shell opened the ' + menuName + ' panel');
        noWarnings(env);
    }
});

/* The substitution of the standard left menu showMenu (bindStockPanels) is only in the compact. Leaving for the
   Standard returns the standard method to the view, the return substitutes again (the keys open the panels again);
   dismantling the shell (a start rollback after bindStock) - the standard method. The stock keeps showMenu in
   the view prototype (Backbone): after the removal the instance has no method of its own; a method of the instance itself
   is returned the same. */
test('stock_show_menu_back_in_advanced_and_after_teardown', () => {
    for (const where of ['prototype', 'instance']) {
        const env = makeEnv({stockMenu: true, options: {canChat: true}});
        const stock = env.leftMenu.showMenu;
        if (where === 'prototype') {
            delete env.leftMenu.showMenu;
            Object.setPrototypeOf(env.leftMenu, {showMenu: stock});
        }
        const back = () => env.leftMenu.showMenu === stock && Object.prototype.hasOwnProperty.call(env.leftMenu, 'showMenu') === (where === 'instance');
        env.create();
        assert.equal(back(), false, where + ': precondition: showMenu is wrapped in compact');
        env.shell.toggleMode();
        assert.equal(back(), true, where + ': the standard interface keeps a wrapped showMenu on the left menu');
        env.shell.toggleMode();
        assert.equal(back(), false, where + ': back to compact, showMenu is not wrapped again');
        env.ctrlShiftH();
        env.flush();
        assert.deepEqual(panelState(env), PANEL_OPEN, where + ': after the round trip Ctrl+Shift+H did not open the comments');
        noWarnings(env);

        const bad = makeEnv({stockMenu: true, options: {canChat: true}});
        const stock2 = bad.leftMenu.showMenu;
        if (where === 'prototype') {
            delete bad.leftMenu.showMenu;
            Object.setPrototypeOf(bad.leftMenu, {showMenu: stock2});
        }
        bad.shell.bindMotion = () => { throw new Error('startup step failed'); };
        assert.throws(() => bad.create(), /startup step failed/, where + ': precondition: the startup failed after bindStock');
        assert.ok(bad.shell.startupFailed, where + ': precondition: the startup was rolled back');
        assert.deepEqual([bad.leftMenu.showMenu === stock2, Object.prototype.hasOwnProperty.call(bad.leftMenu, 'showMenu')], [true, where === 'instance'],
            where + ': after the shell teardown the left menu keeps a wrapped showMenu');
    }
    /* The shell substitution was overlaid (a foreign wrapper): it cannot be removed - in the Standard it passes
       the call to the standard method (standard keys), in the compact a key opens the panel once. */
    const over = makeEnv({stockMenu: true, options: {canChat: true}}).create();
    const ours = over.leftMenu.showMenu;
    over.leftMenu.showMenu = function () { return ours.apply(this, arguments); };
    over.shell.toggleMode();
    over.ctrlShiftH();
    over.altQ();
    over.flush();
    assert.deepEqual([over.leftMenu.btnComments.clicks, over.leftMenu.btnChat.clicks, panelState(over, 'chat'), over.body().contains('vo-left-open')],
        [0, 0, Object.assign({}, PANEL_OPEN, {area: false}), false], 'standard interface under a foreign wrapper: the keys are not the stock ones');
    over.leftMenu.btnChat.toggle(false, true);
    over.leftMenu.onBtnMenuClick(over.leftMenu.btnChat);
    over.shell.toggleMode();
    over.ctrlShiftH();
    over.flush();
    assert.deepEqual([panelState(over), over.leftMenu.btnComments.clicks], [PANEL_OPEN, 1], 'back to compact under a foreign wrapper: Ctrl+Shift+H');
    noWarnings(over);
});

test('header_has_no_search_or_panel_button', () => {
    const env = makeEnv().create();
    const hd = env.header();
    /* The header buttons are the mode switch (the rows of its list are inside it) and "Download", if
       the environment gives download or print; here there are none - only the switch. */
    const buttons = hd.querySelectorAll('button');
    const rows = buttons.filter(b => b.classList.contains('vo-pop-item'));
    const own = buttons.filter(b => !b.classList.contains('vo-pop-item'));
    /* The hover hint is aria-description (title removed, CompactToolbar.setTip). */
    assert.deepEqual(own.map(b => b.getAttribute('aria-description')), [env.shell.textModeSwitch],
        'header buttons other than the mode switch: ' + JSON.stringify(own.map(b => b.className)));
    const mode = hd.querySelector('.vo-docmode');
    assert.ok(mode && rows.length === 2 && rows.every(r => mode.contains(r)), 'header list rows outside the mode switch');
    const all = hd.descendants();
    assert.ok(!all.some(e => /search|right-?panel|panelR|burger|avatar|user/i.test(e.className + ' ' + (e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-description') || ''))),
        'search, right panel, burger or avatar in the header');
    assert.ok(!/panelR|search/.test(hd.innerHTML + all.map(e => e.innerHTML).join('')), 'search or right panel glyph in the header');
});

/* --- The compact left menu in real Chrome ---------------------------------------------------
   The built spreadsheet editor app.less (standard styles, the default theme, the tree compact-shell.less or its
   broken copy - the second argument), the real jQuery of the tree (vendor/jquery/jquery.js, which
   the application takes) and the Viewport.template nodes around #left-menu. */
const chromeTests = [];
const chromeTest = (name, fn) => chromeTests.push([name, fn]);
let page = null, CSS = '';

async function appCss() {
    const lessLib = require(path.join(ROOT, 'build/node_modules/less'));
    const appLess = path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/app.less');
    const own = '@import "compact-shell.less";';
    const src = fs.readFileSync(appLess, 'utf8');
    assert.ok(src.indexOf(own) >= 0, 'app.less: ' + own + ' not found');
    const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/spreadsheeteditor.json'), 'utf8')).main.less.vars;
    return (await lessLib.render(src.replace(own, '@import ' + JSON.stringify(lessFile) + ';'), {filename: appLess, modifyVars: vars})).css;
}

async function stageMenu() {
    await page.setContent(`<style>${CSS}</style><body class="theme-light theme-type-light vo-compact" style="margin:0">
<div id="viewport-hbox-layout" class="layout-ct hbox" style="width:1200px;height:600px">
  <div id="left-menu" class="layout-item hint-section" data-layout-name="leftMenu" style="width: 40px;"><div id="view-left-menu" class="tool-menu left">
    <div class="tool-menu-btns"></div><div class="left-panel side-panel"><div id="left-panel-comments" class="content-box"></div></div></div></div>
  <div id="about-menu-panel" class="left-menu-full-ct" style="display:none;"></div>
  <div class="layout-item"><div id="editor_sdk" class="layout-item"></div></div>
</div></body>`);
    await page.addScriptTag({path: path.join(ROOT, 'vendor/jquery/jquery.js')});
}

/* The MENU_FRAME model of the fake stock is real: the compact divider on a shown area
   (border-right; the shell LEFT_DIVIDER_W is the same width), a hidden one has no border; jQuery writes and
   reads the border-box menu width with the border at the time of writing and reading. Hence the danger that
   the shell holds against: the icon column recorded into a shown area (41) is read as 41 by a hidden one. */
chromeTest('left_menu_frame_model_matches_jquery_and_less', async () => {
    await stageMenu();
    const divider = /var LEFT_DIVIDER_W = (\d+);/.exec(fs.readFileSync(file, 'utf8'));
    assert.ok(divider, 'CompactShell: no LEFT_DIVIDER_W');
    const frames = await page.evaluate(() => {
        const m = document.getElementById('left-menu'), cl = document.body.classList;
        const frame = () => { const s = getComputedStyle(m); return ['borderLeftWidth', 'borderRightWidth', 'paddingLeft', 'paddingRight'].reduce((a, k) => a + parseFloat(s[k]), 0); };
        cl.add('vo-left-open');
        const shown = {frame: frame(), display: getComputedStyle(m).display, sizing: getComputedStyle(m).boxSizing};
        cl.remove('vo-left-open');
        return {shown, hidden: {frame: frame(), display: getComputedStyle(m).display}};
    });
    assert.deepEqual([frames.shown.display, frames.shown.sizing, frames.hidden.display], ['block', 'border-box', 'none'],
        'precondition: the compact left menu (border-box) is shown only under vo-left-open ' + JSON.stringify(frames));
    assert.deepEqual([frames.shown.frame, frames.hidden.frame], [MENU_FRAME.shown, MENU_FRAME.hidden],
        'the compact left menu frame shown/hidden is not the MENU_FRAME of the fake stock: ' + JSON.stringify(frames));
    assert.equal(+divider[1], frames.shown.frame, 'LEFT_DIVIDER_W of the shell is not the divider of the shown area');
    for (const v of [40, 300]) for (const writtenShown of [true, false]) for (const readShown of [true, false]) {
        const r = await page.evaluate(([v, ws, rs]) => {
            const $m = window.jQuery('#left-menu'), cl = document.body.classList;
            cl.toggle('vo-left-open', ws);
            $m.width(v);
            const style = $m[0].style.width;
            cl.toggle('vo-left-open', rs);
            return {style, read: $m.width()};
        }, [v, writtenShown, readShown]);
        const fr = sh => (sh ? MENU_FRAME.shown : MENU_FRAME.hidden);
        const want = {style: (v + fr(writtenShown)) + 'px', read: v + fr(writtenShown) - fr(readShown)};
        assert.deepEqual(r, want, 'jQuery $el.width(' + v + ') into a ' + (writtenShown ? 'shown' : 'hidden') + ' area, read ' +
            (readShown ? 'shown' : 'hidden') + ': ' + JSON.stringify(r) + ', the fake stock model ' + JSON.stringify(want));
    }
});

/* A closed area is closed against the inline show() of the stock too (Ctrl+H: onShowHideSearch →
   tryToShowLeftMenu → leftMenu.show()): before, the menu was shown as a 40 px column without a panel (after
   the right was taken away - as a comments panel strip). An open one still yields to the inline
   hide() (the integrator hid the left menu: customization.leftMenu false). In the Standard (without
   vo-compact) the stock show()/hide() is as in the stock. */
chromeTest('left_menu_closed_against_stock_show', async () => {
    await stageMenu();
    const state = () => page.evaluate(() => {
        const m = document.getElementById('left-menu');
        return {display: getComputedStyle(m).display, width: Math.round(m.getBoundingClientRect().width)};
    });
    await page.evaluate(() => window.jQuery('#left-menu').show());
    const shownByStock = await state();
    assert.deepEqual(shownByStock, {display: 'none', width: 0}, 'the closed area is shown by the stock show() (Ctrl+H): ' + JSON.stringify(shownByStock));
    await page.evaluate(() => { document.body.classList.add('vo-left-open'); });
    assert.equal((await state()).display, 'block', 'the open area is hidden');
    await page.evaluate(() => window.jQuery('#left-menu').hide());
    assert.equal((await state()).display, 'none', 'the open area ignores the stock hide() (left menu hidden by the integrator)');
    await page.evaluate(() => { const cl = document.body.classList; cl.remove('vo-left-open', 'vo-compact'); cl.add('vo-advanced'); window.jQuery('#left-menu').show(); });
    assert.equal((await state()).display, 'block', 'advanced: the stock show() does not show the left menu');
    await page.evaluate(() => window.jQuery('#left-menu').hide());
    assert.equal((await state()).display, 'none', 'advanced: the stock hide() does not hide the left menu');
});

(async () => {
    let chromium = null;
    try { ({chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
    catch (e) { console.error('FAIL playwright is not available (set NODE_PATH or PLAYWRIGHT_MODULE): ' + e.message); failed++; }
    if (chromium) {
        CSS = await appCss();
        const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
        try {
            page = await browser.newPage({viewport: {width: 1280, height: 640}, deviceScaleFactor: 1});
            for (const [name, fn] of chromeTests) {
                try {
                    await fn();
                    console.log('PASS', name);
                    passed++;
                } catch (error) {
                    console.error('FAIL', name, '—', error && error.message);
                    failed++;
                }
            }
        } finally {
            await browser.close();
        }
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
