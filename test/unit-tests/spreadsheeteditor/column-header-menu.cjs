/* Run: node test/unit-tests/spreadsheeteditor/column-header-menu.cjs [ColumnHeaderMenu.js] [StockBridge.js] [locale directory] [compact-shell.less]
 * The column header menu of the spreadsheet editor "Compact" shell.
 * The chevron layer (#vo-colh) lies in #ws-canvas-outer and does not get in the way of the mouse: the chevron is at the column
 * under the cursor and always at the column of the current cell; the column under a point is the only adapter
 * to the engine internals (getCursorTypeFromXY), its failure leaves the chevron of the current column and
 * one warning. A left click on a header without a drag (the engine selects, the layer only
 * listens to pointerdown/pointerup on window) opens the menu under the header, a repeated one
 * closes it; the right one is a wrapper over showObjectMenu of the DocumentHolder controller instance:
 * a column selection gets our menu from the click point, otherwise the standard show. The items, order and
 * availability are a snapshot of the standard menu at the moment of opening (StockBridge.contextMenu: the standard
 * showObjectMenu without an event fills ssMenu or viewModeMenu and does not show), a choice is the
 * standard item click (StockBridge.pick). Escape and closeSurfaces() close it as the first
 * layer; the selection is not touched after closing; detach() restores the standard showObjectMenu.
 * The shell modules are real (CompactShell and its dependencies), the DOM and the stock are fake.
 * The arguments are broken copies for the negative control; the third is the spreadsheet editor locale directory
 * from which the case clear_contents_label_from_locale takes the standard labels of "Clear ▸";
 * the fourth is the spreadsheet editor compact-shell.less for the case column_header_menu_keeps_its_own_layout.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/spreadsheeteditor/main/app/view');
const MENU_FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'ColumnHeaderMenu.js');
const BRIDGE_FILE = process.argv[3] ? path.resolve(process.argv[3]) : path.join(VIEW, 'StockBridge.js');
const LOCALE = process.argv[4] ? path.resolve(process.argv[4]) : path.join(ROOT, 'apps/spreadsheeteditor/main/locale');
const OVERRIDE = {
    'spreadsheeteditor/main/app/view/ColumnHeaderMenu': MENU_FILE,
    'spreadsheeteditor/main/app/view/StockBridge': BRIDGE_FILE
};

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
        this.rect = null;
    }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = String(v); }
    get className() { return this.attrs.class || ''; }
    set className(v) {
        this.classList.splice(0);
        String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.push(c));
        this.attrs.class = this.classList.join(' ');
    }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
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
    /* The menu list is 220 × (36 per row), the rest has no size. */
    get offsetWidth() { return this.classList.contains('vo-mn-drop') ? 220 : 0; }
    get offsetHeight() { return this.classList.contains('vo-mn-drop') ? 36 * this.children.length : 0; }
    get clientWidth() { return this.rect ? this.rect.width : 0; }
    get clientHeight() { return this.rect ? this.rect.height : 0; }
    getBoundingClientRect() {
        if (this.rect) return this.rect;
        const left = parseFloat(this.style.left) || 0, top = parseFloat(this.style.top) || 0;
        return {left, top, right: left, bottom: top, width: 0, height: 0};
    }
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
    dispatch(t, extra) {
        const ev = Object.assign({type: t, target: this, preventDefault() {}, stopPropagation() {}}, extra || {});
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

function events(target) {
    const handlers = {};
    target = target || {};
    target.handlers = handlers;
    target.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return target; };
    target.off = (name, fn) => { const a = handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); return target; };
    target.trigger = function (name, ...args) { (handlers[name] || []).slice().forEach(fn => fn.apply(target, args)); return target; };
    target.count = name => (handlers[name] || []).length;
    return target;
}

function layout(items) {
    return {panels: items, layouts: 0, getItem(alias) { return items.find(p => p.alias === alias); }, doLayout() { this.layouts++; }};
}

/* The stock numbers: Asc.c_oAscSelectionType and AscCommonExcel.c_oTargetType (cell/apiDefines.js). */
const T = {RangeCells: 1, RangeCol: 2, RangeRow: 3, RangeMax: 4, RangeImage: 5, RangeChart: 6, RangeShape: 7};
const TARGET = {None: 0, ColumnResize: 1, Cells: 6, ColumnHeader: 7, RowHeader: 8, ColumnRowHeaderMove: 23};

/* The grid geometry: the canvas is at (100, 200) of the window, the column header 0…22, columns of 80 from 40
   (the row headers on the left). All CSS pixels, the engine counts in buffer pixels (× ratio). */
const OUTER = {left: 100, top: 200, width: 1000, height: 600};
const HEAD_H = 22, CELLS_LEFT = 40, COL_W = 80;
const colLeft = col => CELLS_LEFT + COL_W * col;

function makeEnv(opt = {}) {
    const doc = makeDocument();
    const toolbarEl = doc.body.appendChild(new El('div', doc));
    toolbarEl.id = 'toolbar';
    toolbarEl.appendChild(new El('section', doc)).className = 'toolbar';
    const sdk = doc.body.appendChild(new El('div', doc));
    sdk.id = 'editor_sdk';
    const outer = sdk.appendChild(new El('div', doc));
    outer.id = 'ws-canvas-outer';
    outer.rect = Object.assign({right: OUTER.left + OUTER.width, bottom: OUTER.top + OUTER.height}, OUTER);
    const canvas = outer.appendChild(new El('canvas', doc));
    canvas.id = 'ws-canvas-graphic-overlay';

    const NC = events();
    const timers = [];
    const warnings = [];
    const log = [];
    const ratio = opt.ratio || 1;

    /* The engine selection: the type and the active cell (column). */
    const sel = {type: T.RangeCells, col: 1, protected: false};
    const info = () => ({
        asc_getSelectionType: () => sel.type,
        asc_getPivotTableInfo: () => null,
        asc_getLocked: () => sel.protected
    });
    const rect = col => ({asc_getX: () => colLeft(col), asc_getY: () => HEAD_H, asc_getWidth: () => COL_W, asc_getHeight: () => 20});
    const ws = {
        headersTop: 0, headersHeight: HEAD_H * ratio, cellsLeft: CELLS_LEFT * ratio,
        calls: [],
        getCursorTypeFromXY(x, y) {
            this.calls.push([x, y]);
            if (opt.brokenAdapter) throw new Error('getCursorTypeFromXY is gone');
            const cx = x / ratio, cy = y / ratio;
            if (cy < HEAD_H && cx >= CELLS_LEFT) {
                const col = Math.floor((cx - CELLS_LEFT) / COL_W);
                const selected = sel.type === T.RangeCol && sel.col === col;
                return {cursor: 'x', target: selected ? TARGET.ColumnRowHeaderMove : TARGET.ColumnHeader, col, row: -1};
            }
            if (cy < HEAD_H) return {cursor: 'x', target: TARGET.None, col: -1, row: -1};
            return {cursor: 'cell', target: TARGET.Cells, col: Math.floor((cx - CELLS_LEFT) / COL_W), row: 1};
        },
        getCellCoord(col) { return rect(col); }
    };
    const api = {
        handlers: {},
        asc_registerCallback(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
        asc_unregisterCallback(name, fn) { const a = this.handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
        sendEvent(name, ...args) { (this.handlers[name] || []).slice().forEach(fn => fn.apply(this, args)); },
        asc_isDocumentModified() { return false; },
        asc_getCellInfo() { return info(); },
        asc_getActiveCellCoord() { return rect(sel.col); },
        asc_getActiveWorksheetIndex() { return 0; },
        asc_isProtectedSheet() { return sel.protected; },
        asc_getZoom() { return 1; },
        asc_Resize() {},
        /* A selection change is only by the engine; the shell must not call it. */
        selectionCalls: [],
        asc_findCell(ref) { this.selectionCalls.push('findCell ' + ref); },
        wb: {getWorksheet: () => ws}
    };

    /* The standard grid menus (view/DocumentHolderExt.js), fake: an item with a caption, an icon,
       visibility (hidden), availability, a submenu; a click is onItemClick → the item 'click' and
       the submenu menu 'item:click', as in MenuItem/Menu. */
    const menuOf = (id, items) => events({id, items, isVisible: () => false});
    const item = (caption, o = {}) => {
        const it = events({caption, hidden: false, disabled: false, menu: null, iconCls: o.icon ? 'menu__icon ' + o.icon : undefined,
            options: {caption, iconCls: o.icon ? 'menu__icon ' + o.icon : undefined, exampleval: o.example}});
        it.isDisabled = function () { return this.disabled; };
        it.setDisabled = function (v) { this.disabled = !!v; };
        it.setVisible = function (v) { this.hidden = !v; };
        it.onItemClick = function (e) {
            if (e.which != 1 && (e.which !== undefined || this.menu)) return false;
            if (this.menu) return;
            if (!this.disabled) {
                this.trigger('click', this, e);
                if (this.parentMenu) this.parentMenu.trigger('item:click', this.parentMenu, this, e);
            }
        };
        if (o.sub) {
            it.menu = menuOf('sub-' + caption, o.sub.map(c => item(c, {example: o.examples ? 'old' : undefined})));
            it.menu.items.forEach(s => { s.parentMenu = it.menu; });
        }
        return it;
    };
    const sep = () => item('--');
    const view = {};
    const ssItems = {
        cut: item('Cut', {icon: 'btn-cut'}), copy: item('Copy', {icon: 'btn-copy'}), paste: item('Paste', {icon: 'btn-paste'}),
        sep1: sep(),
        insertEntire: item('Insert column left'), insertCells: item('Insert cells'),
        deleteEntire: item('Delete'), deleteCells: item('Delete cells'),
        clear: item(opt.clear ? opt.clear.caption : 'Clear', {icon: 'btn-clearstyle', sub: opt.clear ? opt.clear.sub : ['All', 'Text', 'Formats']}),
        cellSep: sep(), sort: item('Sort'),
        cellMenuSep: sep(),
        cellFormat: item('Format cells'),
        numFormat: item('Number format', {sub: ['General', 'Number'], examples: true}),
        condFormat: item('Conditional formatting'), entries: item('Pick from list'),
        functionSep: sep(), insFunction: item('Insert function'),
        rowHeight: item('Row height', {sub: ['Auto', 'Custom']}),
        colWidth: item('Column width', {sub: ['Auto fit', 'Custom width']}),
        hide: item('Hide'), show: item('Show'),
        freezeSep: sep(), freeze: item('Freeze panes')
    };
    view.ssMenu = menuOf('id-context-menu-cell', Object.values(ssItems));
    /* A plugin item (AI): the stock adds such items when the menu is shown (onPluginContextMenuShow) and
       removes them on hiding (clearCustomItems). */
    if (opt.pluginItem) { const ai = item('AI'); ai.isCustomItem = true; view.ssMenu.items.push(ai); }
    view.pmiNumFormat = ssItems.numFormat;
    const viewItems = {copy: item('Copy', {icon: 'btn-copy'}), undo: item('Undo', {icon: 'btn-undo'})};
    view.viewModeMenu = menuOf('view-mode-menu', Object.values(viewItems));
    view.copyPasteMenu = menuOf('copy-paste-menu', [item('Copy')]);
    view.ssMenu.items.concat(view.viewModeMenu.items).forEach(it => {
        it.on('click', () => log.push('stock click ' + it.caption));
        if (it.menu) it.menu.on('item:click', (m, i) => log.push('stock pick ' + it.caption + ' → ' + i.caption));
    });

    /* The DocumentHolder controller: methods on the prototype, as in the stock, the instance is its own. */
    const proto = {
        showObjectMenu(event, type) {
            log.push('stock showObjectMenu' + (event ? ' event' : ''));
            if (this.api && !this.mouse.isLeftButtonDown && !this.rangeSelectionMode) {
                (this.permissions.isEdit && !this._isDisabled) ? this.fillMenuProps(this.api.asc_getCellInfo(), true, event)
                    : this.fillViewMenuProps(this.api.asc_getCellInfo(), true, event);
            }
        },
        fillMenuProps(cellinfo, showMenu, event) {
            const t = cellinfo.asc_getSelectionType(), col = t === T.RangeCol, cell = t === T.RangeCells, row = t === T.RangeRow;
            if (opt.headerFooter) { if (showMenu) this.showPopupMenu(view.copyPasteMenu, {}, event); return; }
            ssItems.insertEntire.setVisible(col || row);
            ssItems.deleteEntire.setVisible(col || row);
            ssItems.insertCells.setVisible(cell);
            ssItems.deleteCells.setVisible(cell);
            ssItems.cellSep.setVisible(cell);
            ssItems.sort.setVisible(cell);
            ssItems.insFunction.setVisible(cell);
            ssItems.rowHeight.setVisible(row);
            ssItems.colWidth.setVisible(col);
            ssItems.hide.setVisible(col || row);
            ssItems.show.setVisible(col || row);
            const locked = sel.protected;
            view.ssMenu.items.forEach(i => i.setDisabled(locked));
            ssItems.copy.setDisabled(false);
            ssItems.freeze.setDisabled(false);
            ssItems.paste.setDisabled(locked || !!opt.pasteOff);
            if (showMenu) this.showPopupMenu(view.ssMenu, {}, event);
            ssItems.functionSep.setVisible(cell || col || row);
            /* As in the stock: pmiFreezeSeparator.setVisible(pmiFreezePanes.isVisible()) - the item
               visibility in the DOM, that is, only for a shown menu. */
            ssItems.freezeSep.setVisible(this.shown === view.ssMenu.id);
        },
        fillViewMenuProps(cellinfo, showMenu, event) {
            viewItems.undo.setVisible(!!opt.commenter);
            if (showMenu) this.showPopupMenu(view.viewModeMenu, {}, event);
        },
        showPopupMenu(menu, value, event) {
            if (menu && event) { log.push('stock shows ' + menu.id); this.shown = menu.id; }
            else this.shown = null;
        },
        onNumberFormatOpenAfter(menu) {
            menu.items.forEach(i => { i.options.exampleval = 'ex ' + i.caption + ' @' + sel.col; });
        }
    };
    const dh = Object.assign(Object.create(proto), {
        api, documentHolder: view, permissions: {isEdit: opt.edit !== false}, _isDisabled: false,
        mouse: {isLeftButtonDown: false}, rangeSelectionMode: false, shown: null
    });

    const vlayout = layout([{alias: 'title', height: 28}, {alias: 'toolbar', height: 92}, {stretch: true}, {alias: 'statusbar', height: 25}]);
    const hlayout = layout([{alias: 'left'}, {stretch: true}, {alias: 'right'}]);
    const celayout = layout([{alias: 'celleditor'}, {stretch: true}]);
    const btn = () => ({pressed: false, options: {}, disabled: false, isDisabled() { return this.disabled; }, click() {}});
    const leftMenu = {btnSearchBar: btn(), btnComments: btn(), btnChat: btn(), btnSpellcheck: btn(), btnAbout: btn(), buttons: []};
    const toolbarView = Object.assign(events(), {el: toolbarEl});
    const main = {
        editorConfig: {ui: {shell: 'modern'}},
        appOptions: {spreadsheet: {title: 'Отчёт.xlsx'}, isEdit: opt.edit !== false, canCoAuthoring: true, canViewComments: true}
    };
    const SSE = {
        Views: {},
        getController(name) {
            if (name === 'Main') return main;
            if (name === 'Toolbar') return {toolbar: toolbarView, api};
            if (name === 'Viewport') return {viewport: {vlayout, hlayout, celayout}, getApi: () => api};
            if (name === 'LeftMenu') return {leftMenu};
            if (name === 'DocumentHolder') return opt.noDocumentHolder ? undefined : dh;
            return undefined;
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
        _: {extend: Object.assign},
        Asc: {c_oAscSelectionType: T, c_oAscContextMenuTypes: {common: 0, changeSeries: 1}},
        AscCommonExcel: {c_oTargetType: TARGET},
        AscCommon: {AscBrowser: {retinaPixelRatio: ratio}},
        Common: {
            NotificationCenter: NC,
            Utils: {documentSettingsType: {}},
            UI: {LayoutManager: {isElementVisible: () => true}, Menu: {Manager: {hideAll() { log.push('stock hideAll'); }}}},
            localStorage: {getItem: () => null, setItem() {}, removeItem() {}}
        },
        innerWidth: 1440,
        innerHeight: 900,
        resizes: 0
    };
    context.window = context;
    /* A window with pointer events: the shell listens to pointerdown, not mousedown (the engine suppresses
       the canvas pointerdown, and the compatible mousedown is not born). */
    context.onpointerdown = null;
    context.dispatchEvent = ev => { if (ev && ev.type === 'resize') context.resizes++; return true; };
    context.listeners = {};
    context.addEventListener = (t, fn, capture) => { (context.listeners[t] = context.listeners[t] || []).push({fn, capture: !!capture}); };
    context.removeEventListener = (t, fn) => { const a = context.listeners[t] || []; const i = a.findIndex(x => x.fn === fn); if (i >= 0) a.splice(i, 1); };
    context.getComputedStyle = () => ({overflowY: 'visible', overflowX: 'visible'});

    const modules = {};
    const load = (rel, abs) => {
        if (modules[rel]) return modules[rel];
        const src = fs.readFileSync(OVERRIDE[rel] || abs, 'utf8');
        let result;
        context.define = (deps, factory) => {
            const args = deps.map(d => load(d, path.join(ROOT, 'apps', d + '.js')));
            result = factory(...args);
        };
        vm.runInContext(src, context, {filename: OVERRIDE[rel] || abs});
        return (modules[rel] = result);
    };
    vm.createContext(context);
    load('spreadsheeteditor/main/app/view/CompactShell', path.join(VIEW, 'CompactShell.js'));
    const shell = SSE.Views.CompactShell;
    const menu = SSE.Views.ColumnHeaderMenu;

    /* A window event: the capture listeners go first, as in the browser. */
    const fire = (type, ev) => {
        const all = context.listeners[type] || [];
        all.filter(x => x.capture).concat(all.filter(x => !x.capture)).slice().forEach(x => x.fn(ev));
    };
    const pointer = (type, x, y, extra = {}) => Object.assign({
        type, clientX: x, clientY: y, button: 0, buttons: type === 'pointerdown' ? 1 : 0, target: canvas,
        preventDefault() {}, stopPropagation() {}
    }, extra);
    /* The column col header point in window coordinates. */
    const headerPoint = col => ({x: OUTER.left + colLeft(col) + 30, y: OUTER.top + 10});

    const env = {
        shell, menu, SSE, doc, NC, api, ws, dh, proto, view, ssItems, viewItems, sel, timers, warnings, log, context, outer, canvas,
        flush() { let n = 0; while (timers.length && n++ < 200) timers.shift()(); },
        create() { shell.create(); env.flush(); return env; },
        layer() { return doc.getElementById('vo-colh'); },
        host() { return doc.getElementById('vo-colh-menu'); },
        drop() { const h = env.host(); return h ? h.querySelector('.vo-mn-drop') : null; },
        rows(level = 0) {
            const h = env.host();
            const box = h && h.children.find(c => c.getAttribute('data-level') === String(level));
            return box ? box.children.filter(r => r.classList.contains('vo-mn-sub')) : [];
        },
        captions(level = 0) {
            const h = env.host();
            const box = h && h.children.find(c => c.getAttribute('data-level') === String(level));
            return box ? box.children.map(r => r.classList.contains('vo-mn-sep') ? '--' : r.querySelector('.vo-mn-t').textContent) : [];
        },
        chevrons() { const l = env.layer(); return l ? l.querySelectorAll('.vo-colh-chev') : []; },
        visibleChevrons() {
            return env.chevrons().filter(c => c.classList.contains('on')).map(c => ({left: parseFloat(c.style.left), top: parseFloat(c.style.top)}));
        },
        hover(col) {
            const p = col === null ? {x: OUTER.left + 500, y: OUTER.top + 300} : headerPoint(col);
            const ev = pointer('pointermove', p.x, p.y, {buttons: 0});
            outer.dispatch('pointermove', ev);
            fire('pointermove', ev);
            env.flush();
        },
        /* A left click on the header: pointerdown on window (capture - the shell, then the engine
           selects the column, as in the standard), pointerup, deferred steps. */
        leftClick(col, opts = {}) {
            const p = headerPoint(col);
            fire('pointerdown', pointer('pointerdown', p.x, p.y));
            /* What the engine selected after the click: the standard is a column; selType - another (the whole sheet,
               cells) when the click on the header did not end with a column. */
            sel.type = opts.selType !== undefined ? opts.selType : T.RangeCol;
            sel.col = col;
            api.sendEvent('asc_onSelectionChanged', info());
            const dx = opts.drag || 0;
            fire('pointerup', pointer('pointerup', p.x + dx, p.y));
            env.flush();
        },
        /* A right click: the engine selects the column under the point and sends asc_onContextMenu; the stock
           calls the instance showObjectMenu after 10 ms (controller/DocumentHolder.js). */
        rightClick(col, opts = {}) {
            const p = opts.point || headerPoint(col);
            const ev = pointer('pointerdown', p.x, p.y, {button: 2, buttons: 2});
            fire('pointerdown', ev);
            if (opts.selType !== undefined) sel.type = opts.selType; else sel.type = T.RangeCol;
            sel.col = col;
            api.sendEvent('asc_onSelectionChanged', info());
            dh.showObjectMenu(ev, undefined);
            env.flush();
        },
        key(k) {
            const ev = {type: 'keydown', key: k, keyCode: k === 'Escape' ? 27 : 0, target: doc.body, defaultPrevented: false,
                preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}};
            fire('keydown', ev);
            env.flush();
            return ev;
        },
        clickRow(text, level = 0) {
            const row = env.rows(level).find(r => r.querySelector('.vo-mn-t').textContent === text);
            assert.ok(row, 'no row «' + text + '» at level ' + level + ': ' + JSON.stringify(env.captions(level)));
            fire('pointerdown', pointer('pointerdown', 0, 0, {target: row}));
            row.click();
            env.flush();
            return row;
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

/* The visible items of the standard menu - by the same rule as the stock draws (hidden), with
   separators collapsed as in the stock. */
function stockList(menu) {
    const out = [];
    menu.items.forEach(i => {
        if (i.hidden) return;
        if (i.caption === '--') { if (out.length && out[out.length - 1] !== '--') out.push('--'); return; }
        out.push(i.caption);
    });
    while (out[out.length - 1] === '--') out.pop();
    return out;
}

const chevronAt = col => colLeft(col) + COL_W - 7 - 14;

test('chevron_on_hover_and_current_column', () => {
    const env = makeEnv().create();
    assert.ok(env.layer(), 'no chevron layer');
    assert.ok(env.layer().parentNode === env.outer, 'the layer is not inside #ws-canvas-outer');
    /* At the start - only the chevron of the current column (B: the active cell is in B). */
    assert.deepEqual(env.visibleChevrons(), [{left: chevronAt(1), top: 4}], 'current column chevron on start');
    /* Hovering D: the chevron of D and the chevron of the current column. */
    env.hover(3);
    assert.deepEqual(env.visibleChevrons().map(c => c.left).sort((a, b) => a - b), [chevronAt(1), chevronAt(3)], 'hover chevron');
    /* Hovering the current column - one chevron, not two on top of each other. */
    env.hover(1);
    assert.deepEqual(env.visibleChevrons(), [{left: chevronAt(1), top: 4}], 'hover over the current column doubles the chevron');
    /* The cursor left the headers - only the current one again. */
    env.hover(null);
    assert.deepEqual(env.visibleChevrons(), [{left: chevronAt(1), top: 4}], 'hover chevron left after the pointer moved away');
    /* The current column changed - the chevron moved. */
    env.sel.col = 5;
    env.api.sendEvent('asc_onSelectionChanged', env.api.asc_getCellInfo());
    env.flush();
    assert.deepEqual(env.visibleChevrons(), [{left: chevronAt(5), top: 4}], 'current chevron did not follow the selection');
    /* An object is selected - there is no current column. */
    env.sel.type = T.RangeImage;
    env.api.sendEvent('asc_onSelectionChanged', env.api.asc_getCellInfo());
    env.flush();
    assert.deepEqual(env.visibleChevrons(), [], 'chevron shown while an object is selected');
    /* Buffer pixels: on retina the engine is asked in its own units. */
    const hi = makeEnv({ratio: 2}).create();
    hi.ws.calls.length = 0;
    hi.hover(2);
    const last = hi.ws.calls[hi.ws.calls.length - 1];
    assert.deepEqual(last, [(colLeft(2) + 30) * 2, 10 * 2], 'engine asked in CSS pixels on a retina screen');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

test('left_click_opens_under_header_second_closes', () => {
    const env = makeEnv().create();
    env.leftClick(2);
    assert.ok(env.drop(), 'left click on the header did not open the menu');
    const host = env.host();
    assert.ok(host.parentNode === env.doc.body, 'the menu lives outside the clipped grid');
    assert.equal(parseFloat(host.style.left), OUTER.left + colLeft(2), 'menu is not under the left edge of the header');
    assert.equal(parseFloat(host.style.top), OUTER.top + HEAD_H + 4, 'menu is not 4 px under the header');
    /* The menu name for the screen reader is the textColumnMenu_ARIA string with the column letter in place of {0}:
       "Column C", not the template and not "C" somewhere in the word "Column". */
    const named = tpl => String(env.menu.textColumnMenu_ARIA).replace('{0}', tpl);
    assert.equal(env.drop().getAttribute('aria-label'), 'Column C', 'menu is not named after the column');
    assert.equal(env.drop().getAttribute('aria-label'), named('C'), 'menu name is not the locale string with the column letter');
    assert.equal(env.drop().getAttribute('role'), 'menu');
    assert.ok(!env.log.some(l => /stock shows/.test(l)), 'the stock menu was shown too');
    /* As on opening any standard menu (and a menu row section): the open standard
       dropdown menus are closed. */
    assert.ok(env.log.includes('stock hideAll'), 'stock dropdown menus are not closed when the column menu opens');

    /* A repeated click on the same header closes it. */
    env.leftClick(2);
    assert.ok(!env.drop(), 'the second click did not close the menu');
    /* Once more - it opens again. */
    env.leftClick(2);
    assert.ok(env.drop(), 'third click did not open the menu again');
    /* A click on another header - the menu of that column, with its letter in the name. */
    env.leftClick(4);
    assert.ok(env.drop(), 'click on another header did not open its menu');
    assert.equal(parseFloat(env.host().style.left), OUTER.left + colLeft(4), 'menu did not move to the other column');
    assert.equal(env.drop().getAttribute('aria-label'), 'Column E', 'menu of the other column is not named after it');
    env.leftClick(5);
    assert.equal(env.drop().getAttribute('aria-label'), 'Column F', 'menu of column F is not named after it');
    /* A right click - the same name for the column under the point. */
    env.shell.closeSurfaces();
    env.rightClick(3);
    assert.equal(env.drop().getAttribute('aria-label'), 'Column D', 'right-click menu is not named after the column');
    env.shell.closeSurfaces();
    env.leftClick(4);

    /* A drag (selecting a column range) does not open the menu. */
    env.shell.closeSurfaces();
    env.leftClick(1, {drag: 40});
    assert.ok(!env.drop(), 'a drag across headers opened the menu');

    /* A click on a header after which a non-column is selected (the engine selected the whole sheet or
       cells) does not open the menu: the menu is only for a selected column. */
    env.leftClick(3, {selType: T.RangeMax});
    assert.ok(!env.drop(), 'a header click that left the whole sheet selected opened the column menu');
    env.leftClick(3, {selType: T.RangeCells});
    assert.ok(!env.drop(), 'a header click that left cells selected opened the column menu');
    env.leftClick(3);
    assert.ok(env.drop(), 'control: the same header click with the column selected did not open the menu');
    env.shell.closeSurfaces();

    /* Selecting a column from the keyboard (Ctrl+Space) does not open the menu. */
    env.sel.type = T.RangeCol;
    env.sel.col = 6;
    env.api.sendEvent('asc_onSelectionChanged', env.api.asc_getCellInfo());
    env.flush();
    assert.ok(!env.drop(), 'a keyboard column selection opened the menu');

    /* A click on a cell is not a header: no menu. */
    const p = {x: OUTER.left + 300, y: OUTER.top + 200};
    const fire = (t, e) => (env.context.listeners[t] || []).forEach(x => x.fn(e));
    fire('pointerdown', {type: 'pointerdown', clientX: p.x, clientY: p.y, button: 0, target: env.canvas, preventDefault() {}, stopPropagation() {}});
    fire('pointerup', {type: 'pointerup', clientX: p.x, clientY: p.y, button: 0, target: env.canvas, preventDefault() {}, stopPropagation() {}});
    env.flush();
    assert.ok(!env.drop(), 'a click on a cell opened the column menu');
});

test('right_click_opens_at_point_for_column', () => {
    const env = makeEnv().create();
    env.rightClick(3);
    assert.ok(env.drop(), 'right click on the header did not open our menu');
    assert.ok(!env.log.some(l => /stock shows/.test(l)), 'the stock context menu was shown: ' + JSON.stringify(env.log));
    const host = env.host();
    assert.equal(parseFloat(host.style.left), OUTER.left + colLeft(3) + 30, 'menu is not at the click point');
    assert.equal(parseFloat(host.style.top), OUTER.top + HEAD_H + 4, 'right click on the header: menu not under the header');
    /* A right click into a cell of the selected column - the menu from the point itself. */
    env.shell.closeSurfaces();
    env.rightClick(3, {point: {x: OUTER.left + colLeft(3) + 10, y: OUTER.top + 300}});
    assert.ok(env.drop(), 'right click inside the selected column did not open our menu');
    assert.equal(parseFloat(env.host().style.top), OUTER.top + 300, 'menu is not at the click point inside the grid');
});

/* The menu from the keyboard is Shift+F10 (DocumentHolder.onKeyDown
   calls showObjectMenu with a keydown event), the context menu key (engine: keyCode 93 →
   onContextMenu with a keyboard event) - the standard one: the stock focuses its menu and drives it with
   arrows, Enter and Escape, while our menu has no keyboard of its own (the column
   menu opens only with the mouse). The sign is an event without coordinates; mouse clicks - our menu. */
test('keyboard_context_menu_stays_stock', () => {
    const env = makeEnv().create();
    env.sel.type = T.RangeCol;
    env.sel.col = 3;
    env.api.sendEvent('asc_onSelectionChanged', env.api.asc_getCellInfo());
    const calls = [
        ['Shift+F10', {type: 'keydown', keyCode: 121, shiftKey: true, preventDefault() {}, stopPropagation() {}}],
        ['context menu key', {KeyCode: 93, CtrlKey: false, ShiftKey: false, AltKey: false, MacCmdKey: false}]
    ];
    calls.forEach(([what, ev]) => {
        env.log.length = 0;
        env.dh.showObjectMenu(ev, undefined);
        env.flush();
        assert.ok(!env.drop(), what + ' on a column selection opened our menu (it has no keyboard)');
        assert.ok(env.log.includes('stock shows id-context-menu-cell'), what + ': the stock column menu was not shown: ' + JSON.stringify(env.log));
    });
    /* A call without any event (the stock calls this way on a click on grouping) - the stock decides (it shows
       nothing), our menu does not open. */
    env.log.length = 0;
    env.dh.showObjectMenu(null, undefined);
    env.flush();
    assert.ok(!env.drop(), 'a call without an event opened our menu');
    assert.ok(env.log.includes('stock showObjectMenu'), 'a call without an event did not reach the stock');
    /* The mouse - our menu as before: a right click and a left one on the header. */
    env.log.length = 0;
    env.rightClick(3);
    assert.ok(env.drop(), 'right click on the header did not open our menu');
    assert.ok(!env.log.some(l => /stock shows/.test(l)), 'the stock menu was shown for a right click');
    env.shell.closeSurfaces();
    env.flush();
    env.leftClick(3);
    assert.ok(env.drop(), 'left click on the header did not open our menu');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* The wheel over the column menu and its submenu (propagation): the lists have the same
   menu row wheel handler (CompactShell.bindListScroll) - the event does not go beyond the list
   (the SDK wheel handler on an ancestor will not get it), the browser does not lose the list scrolling. */
test('column_menu_lists_keep_the_wheel', () => {
    const env = makeEnv().create();
    env.leftClick(2);
    env.clickRow('Clear');
    const fly = env.host().children.find(c => c.getAttribute('data-level') === '1');
    assert.ok(env.drop() && fly, 'precondition: the menu and its submenu are open');
    env.context.getComputedStyle = el => ({overflowY: el.classList && el.classList.contains('vo-mn-drop') ? 'auto' : 'visible', overflowX: 'visible'});
    [['menu', env.drop()], ['submenu', fly]].forEach(([what, list]) => {
        list.scrollHeight = 900;
        list.rect = {left: 0, top: 0, right: 220, bottom: 200, width: 220, height: 200};
        const row = list.children.find(r => r.classList.contains('vo-mn-sub'));
        let stopped = false, prevented = false;
        ['wheel', 'mousewheel', 'DOMMouseScroll'].forEach(type => {
            stopped = prevented = false;
            /* The event path as in the browser: from the row up to the list (the fake DOM nodes have
               no bubbling - we walk it ourselves), until it is stopped. */
            const ev = {type, target: row, deltaY: 120, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
                stopPropagation() { stopped = true; }, preventDefault() { prevented = true; }};
            for (let n = row; n && !stopped; n = n.parentNode) (n.listeners[type] || []).slice().forEach(fn => fn.call(n, ev));
            assert.ok(stopped, what + ': ' + type + ' goes on past the list to the SDK handler');
            assert.ok(!prevented, what + ': ' + type + ' scroll of the list itself is cancelled');
        });
    });
});

test('cell_context_menu_stays_stock', () => {
    const env = makeEnv().create();
    env.rightClick(2, {selType: T.RangeCells, point: {x: OUTER.left + colLeft(2) + 10, y: OUTER.top + 300}});
    assert.ok(!env.drop(), 'our menu opened for a cell selection');
    assert.ok(env.log.includes('stock shows id-context-menu-cell'), 'the stock cell menu was not shown: ' + JSON.stringify(env.log));
    /* The row is standard too. */
    env.log.length = 0;
    env.rightClick(2, {selType: T.RangeRow});
    assert.ok(!env.drop(), 'our menu opened for a row selection');
    assert.ok(env.log.includes('stock shows id-context-menu-cell'), 'the stock row menu was not shown');
    /* The series row (changeSeries) is standard, even on a column. */
    env.log.length = 0;
    env.sel.type = T.RangeCol;
    env.dh.showObjectMenu({clientX: 10, clientY: 10, button: 2}, 1);
    env.flush();
    assert.ok(!env.drop(), 'our menu took the fill-series menu');
    /* The stock would choose another menu (headers/footers) - it shows it itself. */
    const hf = makeEnv({headerFooter: true}).create();
    hf.rightClick(2);
    assert.ok(!hf.drop(), 'our menu opened in the header/footer mode');
    assert.ok(hf.log.includes('stock shows copy-paste-menu'), 'the stock header/footer menu was not shown: ' + JSON.stringify(hf.log));
});

test('menu_is_stock_snapshot_at_open', () => {
    /* What the stock would show for a column: its own show (a right click in the Standard). */
    const ref = makeEnv();
    ref.sel.type = T.RangeCol;
    ref.sel.col = 2;
    ref.proto.showObjectMenu.call(ref.dh, {clientX: 1, clientY: 1, button: 2});
    const shown = stockList(ref.view.ssMenu);
    const env = makeEnv({pluginItem: true}).create();
    env.leftClick(2);
    /* The set and order are the standard menu of the same column, as the stock shows it: separators follow the
       menu structure (in the stock some of them depend on the visibility of the already shown menu in the DOM),
       plugin items (the stock adds them on show) are not included. */
    assert.deepEqual(env.captions(), shown, 'menu differs from the menu the stock shows');
    assert.deepEqual(env.captions(), ['Cut', 'Copy', 'Paste', '--', 'Insert column left', 'Delete', 'Clear', '--', 'Format cells',
        'Number format', 'Conditional formatting', 'Pick from list', '--', 'Column width', 'Hide', 'Show', '--', 'Freeze panes'],
    'column menu composition');
    assert.ok(env.SSE.Views.StockBridge.gaps.some(g => g.kind === 'plugin' && g.what === 'AI'), 'plugin item is not recorded in gaps');
    /* Icons are on the same items as in the stock; the place for the glyph is held for all. */
    const glyphs = env.rows().map(r => { const i = r.querySelector('.vo-mn-i'); return i ? (i.innerHTML ? 'g' : '_') : 'none'; });
    assert.deepEqual(glyphs.slice(0, 3), ['g', 'g', 'g'], 'cut/copy/paste have no glyph');
    assert.ok(glyphs.every(g => g !== 'none'), 'glyph column is not kept for every row');
    /* A submenu with ▸ is a mirror of the standard one, the format examples are from the standard preparation on opening. */
    const nf = env.rows().find(r => r.querySelector('.vo-mn-t').textContent === 'Number format');
    assert.equal(nf.getAttribute('aria-haspopup'), 'menu', 'number format has no submenu mark');
    env.clickRow('Number format');
    assert.deepEqual(env.captions(1), ['General', 'Number'], 'number format submenu');
    const hints = env.rows(1).map(r => (r.querySelector('.vo-mn-h') || {}).textContent);
    assert.deepEqual(hints, ['ex General @2', 'ex Number @2'], 'examples are not prepared by the stock handler at open');
    /* Availability is at the moment of opening: the stock disabled "Paste" - ours is disabled. */
    env.shell.closeSurfaces();
    const off = makeEnv({pasteOff: true}).create();
    off.leftClick(2);
    const paste = off.rows().find(r => r.querySelector('.vo-mn-t').textContent === 'Paste');
    assert.equal(paste.getAttribute('aria-disabled'), 'true', 'disabled stock item is active in our menu');
    /* The stock would show nothing (a mouse button is held) - no menu. */
    const busy = makeEnv().create();
    busy.dh.mouse.isLeftButtonDown = true;
    busy.leftClick(2);
    assert.ok(!busy.drop(), 'menu opened while the stock would not show one');
    /* The standard showPopupMenu is in place: the snapshot returned it. */
    assert.ok(!Object.prototype.hasOwnProperty.call(env.dh, 'showPopupMenu'), 'showPopupMenu left patched on the controller');
});

/* The column letter menu: in "Clear ▸" - "Contents" instead of "Text".
   The column letter menu is a snapshot of the standard context menu, the captions of its items are the standard DocumentHolder keys in the spreadsheet editor
   locale (the stock overrides the defaults with them). Here the captions of the "Clear" item and its submenu are taken from the real
   ru/en locale: the column menu shows "All · Contents · Formatting · Comments · Hyperlinks", there is no "Text". German is standard
   (German is not changed here, the standard items are as they were): "Alle · Text · …".
   The negative control is the locale directory before the edit (argument 3): it has "Text". */
const CLEAR_KEYS = ['txtClearAll', 'txtClearText', 'txtClearFormat', 'txtClearComments', 'txtClearHyper'];
const CONTENTS = {ru: ['Всё', 'Содержимое'], en: ['All', 'Contents'], de: ['Alle', 'Text']};
test('clear_contents_label_from_locale', () => {
    Object.keys(CONTENTS).forEach(lang => {
        const loc = JSON.parse(fs.readFileSync(path.join(LOCALE, lang + '.json'), 'utf8'));
        const key = k => 'SSE.Views.DocumentHolder.' + k;
        const env = makeEnv({clear: {caption: loc[key('txtClear')], sub: CLEAR_KEYS.map(k => loc[key(k)])}}).create();
        env.leftClick(2);
        env.clickRow(loc[key('txtClear')]);
        const rows = env.captions(1);
        assert.deepEqual(rows.slice(0, 2), CONTENTS[lang].slice(0, 2), lang + ': «Clear ▸» of the column menu is not «… · Contents · …»: ' + JSON.stringify(rows));
        assert.equal(rows.length, 5, lang + ': «Clear ▸» rows: ' + JSON.stringify(rows));
        if (lang !== 'de') assert.ok(!rows.includes(lang === 'ru' ? 'Текст' : 'Text'), lang + ': «Text» is still in «Clear ▸» of the column menu');
        env.shell.closeSurfaces();
    });
});

test('view_menu_is_stock_view_menu', () => {
    const env = makeEnv({edit: false}).create();
    env.leftClick(2);
    assert.deepEqual(env.captions(), ['Copy'], 'reader column menu is not the stock view menu');
    env.shell.closeSurfaces();
    /* For a commenter the stock adds "Undo" - as is: the set is the stock's. */
    const commenter = makeEnv({edit: false, commenter: true}).create();
    commenter.rightClick(2);
    assert.deepEqual(commenter.captions(), ['Copy', 'Undo'], 'commenter column menu is not the stock view menu');
    commenter.clickRow('Copy');
    assert.deepEqual(commenter.log.filter(l => /stock click/.test(l)), ['stock click Copy'], 'view menu pick');
});

test('protected_sheet_inactive_with_reason', () => {
    const env = makeEnv().create();
    env.sel.protected = true;
    env.leftClick(2);
    const rows = env.rows();
    const active = rows.filter(r => r.getAttribute('aria-disabled') === 'false').map(r => r.querySelector('.vo-mn-t').textContent);
    assert.deepEqual(active, ['Copy', 'Freeze panes'], 'active items on a protected sheet');
    const reason = env.SSE.Views.SheetActions.textProtected;
    rows.filter(r => r.getAttribute('aria-disabled') === 'true').forEach(r =>
        assert.equal(r.getAttribute('title'), reason, '«' + r.querySelector('.vo-mn-t').textContent + '» has no reason'));
    /* A disabled item does not call the stock and does not close the menu. */
    env.clickRow('Cut');
    assert.ok(env.drop(), 'a click on an inactive item closed the menu');
    assert.ok(!env.log.some(l => /stock click/.test(l)), 'inactive item reached the stock');
    env.clickRow('Freeze panes');
    assert.deepEqual(env.log.filter(l => /stock click/.test(l)), ['stock click Freeze panes']);
});

test('pick_through_stock_item_click', () => {
    const env = makeEnv().create();
    env.leftClick(2);
    env.clickRow('Hide');
    assert.deepEqual(env.log.filter(l => /stock (click|pick)/.test(l)), ['stock click Hide'], 'one stock click per item');
    assert.ok(!env.drop(), 'menu stayed open after the pick');
    /* A submenu item is the standard submenu item click, its 'item:click' goes to the standard handler. */
    env.log.length = 0;
    env.leftClick(2);
    env.clickRow('Column width');
    assert.ok(env.drop(), 'opening a submenu closed the menu');
    env.clickRow('Auto fit', 1);
    assert.deepEqual(env.log.filter(l => /stock (click|pick)/.test(l)), ['stock pick Column width → Auto fit'],
        'submenu pick is not the stock item click');
    assert.ok(!env.drop(), 'menu stayed open after the submenu pick');
    /* Our code does not call the engine API bypassing the standard item. */
    assert.deepEqual(env.api.selectionCalls, [], 'the shell called the engine directly');
});

test('selection_stays_after_close', () => {
    const env = makeEnv().create();
    env.leftClick(4);
    const before = {type: env.sel.type, col: env.sel.col};
    const ev = env.key('Escape');
    assert.ok(!env.drop(), 'Escape did not close the menu');
    assert.ok(ev.defaultPrevented, 'Escape went on past our layer');
    assert.deepEqual({type: env.sel.type, col: env.sel.col}, before, 'selection changed after close');
    assert.deepEqual(env.api.selectionCalls, [], 'the shell touched the selection');
    /* Escape removes layers one at a time: first the submenu, then the menu. */
    env.leftClick(4);
    env.clickRow('Clear');
    assert.equal(env.captions(1).length, 3, 'clear submenu did not open');
    env.key('Escape');
    assert.equal(env.captions(1).length, 0, 'Escape did not close the submenu first');
    assert.ok(env.drop(), 'Escape closed the whole menu instead of the submenu');
    env.key('Escape');
    assert.ok(!env.drop(), 'our menu is open');
    /* closeSurfaces() is the common point: it closes our menu too. */
    env.leftClick(4);
    env.shell.closeSurfaces();
    assert.ok(!env.drop(), 'closeSurfaces left the column menu open');
    /* Opening a menu row section closes the column menu - surfaces one at a time. */
    env.leftClick(4);
    env.doc.querySelector('#vo-shell .vo-mn-item').click();
    assert.ok(!env.drop(), 'a menu section opened over the column menu');
    assert.deepEqual({type: env.sel.type, col: env.sel.col}, before, 'selection changed');
    /* The selection left the column (an arrow) - the menu closes. */
    env.shell.closeSurfaces();
    env.leftClick(4);
    env.sel.type = T.RangeCells;
    env.api.sendEvent('asc_onSelectionChanged', env.api.asc_getCellInfo());
    env.flush();
    assert.ok(!env.drop(), 'menu stayed after the selection left the column');
});

test('detach_restores_stock_show_object_menu', () => {
    const env = makeEnv().create();
    assert.ok(Object.prototype.hasOwnProperty.call(env.dh, 'showObjectMenu'), 'showObjectMenu is not wrapped on the instance');
    env.leftClick(2);
    /* Leaving for the Standard: the menu is closed, there is no layer, the instance has the standard prototype method. */
    env.shell.toggleMode();
    assert.ok(!env.drop(), 'menu left open in advanced');
    assert.ok(!env.layer(), 'chevron layer left in advanced');
    assert.ok(!Object.prototype.hasOwnProperty.call(env.dh, 'showObjectMenu'), 'stock showObjectMenu is not restored');
    assert.ok(env.dh.showObjectMenu === env.proto.showObjectMenu, 'instance method is not the prototype one');
    env.log.length = 0;
    env.rightClick(2);
    assert.ok(env.log.includes('stock shows id-context-menu-cell'), 'advanced right click is not stock');
    assert.ok(!env.drop(), 'our menu is open');
    env.leftClick(2);
    assert.ok(!env.drop(), 'advanced header click opened our menu');
    /* Return to the compact - ours again. */
    env.shell.toggleMode();
    assert.ok(env.layer(), 'chevron layer is not back');
    env.log.length = 0;
    env.rightClick(2);
    assert.ok(env.drop(), 'our menu is not back after the round trip');
    /* An outside click is listened to by the shell, its menu row and the column menu - one each. */
    assert.equal(env.context.listeners.pointerdown.length, 1 + 1 + 1, 'pointer listeners doubled after the round trip');
    /* Rollback after a build failure - the standard method is in place. */
    const broken = makeEnv();
    broken.api.asc_isDocumentModified = () => { throw new Error('engine is not ready'); };
    broken.shell.start();
    broken.flush();
    assert.ok(!broken.doc.getElementById('vo-shell'), 'precondition: the start failed');
    assert.ok(!Object.prototype.hasOwnProperty.call(broken.dh, 'showObjectMenu'), 'rollback left showObjectMenu wrapped');
    assert.ok(!broken.layer(), 'rollback left the chevron layer');
});

test('adapter_failure_keeps_current_chevron', () => {
    const env = makeEnv({brokenAdapter: true}).create();
    assert.deepEqual(env.visibleChevrons().map(c => c.left), [chevronAt(1)], 'current column chevron lost with the adapter');
    env.hover(3);
    env.hover(4);
    assert.deepEqual(env.visibleChevrons().map(c => c.left), [chevronAt(1)], 'hover chevron without the adapter');
    const warned = env.warnings.filter(w => /Compact shell/.test(String(w[0])));
    assert.equal(warned.length, 1, 'adapter failure must be reported once: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
    /* The right click rests on the selection, not on the adapter: the menu works. */
    env.rightClick(3);
    assert.ok(env.drop(), 'right click menu lost with the adapter');
    /* Without a DocumentHolder controller - the shell is built, the menu is not, no failure. */
    const bare = makeEnv({noDocumentHolder: true}).create();
    assert.ok(bare.doc.getElementById('vo-shell'), 'the shell did not start without DocumentHolder');
    bare.leftClick(2);
    assert.ok(!bare.drop(), 'menu opened without DocumentHolder');
});

/* --- The column menu look in headless Chrome ------------------------------------------------ */
/* The column menu stays its own: the spreadsheet editor menu row rules are shared (menu.less) on the spreadsheet editor
   values (and their item description), while the differences of the column menu from the shared .vo-mn root are set by the rules for
   #vo-colh-menu in the spreadsheet editor compact-shell.less.
   The markup is real: the menu opened by a right click in the fake DOM is moved into the page
   (lib/compact-less.cjs is the styles layer, as in app.less; playwright: NODE_PATH or PLAYWRIGHT_MODULE,
   CHROMIUM_PATH). An item with a description is rowNode markup (the stock snapshot has no descriptions). The former look:
   the node is a zero-size anchor point without the menu row strip, the list from it, width from 214,
   padding 10, rounding 18, rows 36 with padding 18; the description on the second line - no wider than 220 (as in the
   stock, lib/view/ReviewChanges.js), 2 lines under the caption, line height 1.3; the list width is set by the
   item rows (for a zero-width node the list is shrunk to them), a long description wraps. */
const LESS_FILE = process.argv[5] ? path.resolve(process.argv[5]) : path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/compact-shell.less');
const layer = require('./lib/compact-less.cjs');
const chromeTests = [];
const chromeTest = (name, fn) => chromeTests.push([name, fn]);
let page = null;

const escHtml = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function outerHtml(el) {
    const tag = el.tagName.toLowerCase();
    const attrs = Object.keys(el.attrs).map(k => ' ' + k + '="' + escHtml(el.attrs[k]) + '"').join('');
    const inner = el._html ? el._html : escHtml(el._text) + el.children.map(outerHtml).join('');
    return '<' + tag + attrs + '>' + inner + '</' + tag + '>';
}

const COLUMN_MENU_BEFORE = {
    host: {position: 'fixed', display: 'block', w: 0, h: 0, pad: '0px', bg: 'rgba(0, 0, 0, 0)', gap: true},
    drop: {dx: 0, dy: 0, position: 'absolute', minW: '214px', padT: '10px', padB: '10px', radius: '18px'},
    row: {h: 36, padL: '18px', padR: '18px', fs: '14px'},
    desc: {maxW: '220px', mt: '2px', lh: '14.3px', fs: '11px'}
};

chromeTest('column_header_menu_keeps_its_own_layout', async () => {
    const env = makeEnv().create();
    env.rightClick(3);
    const host = env.drop() && env.drop().parentNode;
    assert.ok(host && host.id === 'vo-colh-menu', 'precondition: the column menu is open');
    const less = require(path.join(ROOT, 'build/node_modules/less'));
    const css = (await less.render(layer.source(LESS_FILE), {filename: layer.APP_LESS, globalVars: {'app-image-const-path': '"resources/img"'}})).css;
    await page.setContent('<style>* { box-sizing: border-box; } ' + css + '</style><body class="theme-light theme-type-light vo-compact" style="margin:0">' +
        outerHtml(host) + '</body>');
    const look = await page.evaluate(() => {
        const host = document.getElementById('vo-colh-menu'), drop = host.querySelector('.vo-mn-drop');
        const row = drop.querySelector('.vo-mn-sub');
        const desc = document.createElement('button');
        desc.className = 'vo-mn-sub vo-has-desc';
        desc.innerHTML = '<span class="vo-mn-tc"><span class="vo-mn-t">Strict</span><span class="vo-mn-d">' +
            'Changes of the other users are shown only after you save your own changes</span></span>';
        drop.appendChild(desc);
        document.getAnimations().forEach(a => a.finish());
        const hs = getComputedStyle(host), ds = getComputedStyle(drop), rs = getComputedStyle(row), d = desc.querySelector('.vo-mn-d');
        const dd = getComputedStyle(d), hb = host.getBoundingClientRect(), db = drop.getBoundingClientRect();
        return {
            host: {position: hs.position, display: hs.display, w: hb.width, h: hb.height, pad: hs.padding, bg: hs.backgroundColor,
                gap: hs.display === 'block'},
            drop: {dx: Math.round(db.left - hb.left), dy: Math.round(db.top - hb.top), position: ds.position, minW: ds.minWidth,
                padT: ds.paddingTop, padB: ds.paddingBottom, radius: ds.borderTopLeftRadius},
            row: {h: row.getBoundingClientRect().height, padL: rs.paddingLeft, padR: rs.paddingRight, fs: rs.fontSize},
            desc: {maxW: dd.maxWidth, mt: dd.marginTop, lh: dd.lineHeight, fs: dd.fontSize},
            width: {description: d.getBoundingClientRect().width, dropdown: db.width}
        };
    });
    Object.keys(COLUMN_MENU_BEFORE).forEach(part =>
        assert.deepEqual(look[part], COLUMN_MENU_BEFORE[part], 'column menu ' + part + ': ' + JSON.stringify(look[part])));
    // AIR uses a system font: text metrics vary, but the content width and padding contract does not.
    assert.ok(look.width.dropdown >= 214 && look.width.dropdown <= 220 + 2 * 18,
        'column menu stays between its minimum width and the description maximum plus padding');
    assert.ok(Math.abs(look.width.description + 2 * 18 - look.width.dropdown) < 1,
        'description fills the column menu content width without overflow');
});

(async () => {
    let chromium;
    try { ({chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
    catch (e) { throw new Error('playwright is not available (set NODE_PATH or PLAYWRIGHT_MODULE): ' + e.message); }
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    try {
        page = await (await browser.newContext({viewport: {width: 1280, height: 800}})).newPage();
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
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
