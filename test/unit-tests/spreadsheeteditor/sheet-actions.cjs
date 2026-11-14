/* Run: node test/unit-tests/spreadsheeteditor/sheet-actions.cjs [path to SheetActions.js] [path to CompactShell.js]
 * The catalog of eight menu sections and the menu row of the spreadsheet editor "Compact" shell:
 * the composition and order of sections with gallery items, the when conditions (no possibility of the
 * integration or right of the document - no item), an unavailable command (the command is
 * unavailable - the item is inactive, with a reason where one can be named), the "View" items
 * without a shell command, commands without a double through the standard handlers (download,
 * print, rename, entering editing), a submenu from the live standard menu, the second
 * end of the gate on a click, Escape. The modules (CompactShell, SheetActions, StockBridge, Icons,
 * FormulaBar) are loaded in node via vm on top of a fake DOM and stock; the standard
 * clickSaveAsFormat and clickMenuFileItem are the real text of the spreadsheet editor controller/LeftMenu.js.
 * The last case - scrolling a long menu with the wheel - goes
 * in headless Chrome (playwright, as documenteditor/compact-toolbar-scroll.cjs):
 * NODE_PATH or PLAYWRIGHT_MODULE for the package, CHROMIUM_PATH for the browser.
 * The arguments are broken copies for the negative control: a catalog without the standard
 * shortcut names and a shell with outside click and Escape listeners on document in bubbling
 * must fail their cases.
 * Galleries: Chart, Sparkline, Shape, Format as table, Cell styles -
 * gallery items in their places (there is no "Tables", SmartArt, TextArt and "Equations" in "Insert"
 * );
 * a gallery row opens the standard popup at the row (StockBridge.popup, here
 * fake per the bridge contract), the menu stays alive; galleries inside the mirror are
 * gallery rows and a counter row; StockBridge.gaps is empty. A catalog and shell
 * without galleries fail these cases.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/spreadsheeteditor/main/app/view');
const ACTIONS = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'SheetActions.js');
const SHELL = process.argv[3] ? path.resolve(process.argv[3]) : path.join(VIEW, 'CompactShell.js');
const LEFT_MENU = path.join(ROOT, 'apps/spreadsheeteditor/main/app/controller/LeftMenu.js');

/* --- Fake DOM ------------------------------------------------------------------ */

function classList(el) {
    const list = [];
    const sync = () => { el.attrs.class = list.join(' '); };
    list.add = (...n) => { n.forEach(c => { if (!list.includes(c)) list.push(c); }); sync(); };
    list.remove = (...n) => { n.forEach(c => { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); }); sync(); };
    list.contains = c => list.includes(c);
    list.toggle = (c, force) => { const on = force === undefined ? !list.includes(c) : !!force; on ? list.add(c) : list.remove(c); return on; };
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
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    setAttribute(k, v) { if (k === 'class') this.className = v; else this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
    removeAttribute(k) { delete this.attrs[k]; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.children.slice().forEach(c => c.remove()); this._text = String(v); this._html = ''; }
    get innerHTML() { return this._html || this._text; }
    set innerHTML(v) { this.children.slice().forEach(c => c.remove()); this._html = String(v); this._text = ''; }
    get firstChild() { return this.children[0] || null; }
    get childElementCount() { return this.children.length; }
    get offsetWidth() { return 200; }
    get offsetHeight() { return 100; }
    getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}; }
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
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    closest(sel) { let n = this; while (n && n.nodeType === 1) { if (matches(n, sel)) return n; n = n.parentNode; } return null; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { const a = this.listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    /* The event path as in the browser: capture on window, then the node and bubbling up to the
       document and window. stopPropagation at any step stops the rest of the path. */
    dispatch(type, extra) {
        const ev = Object.assign({type, target: this, defaultPrevented: false, propagationStopped: false,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }}, extra || {});
        const doc = this.ownerDocument, win = doc.win;
        win && win.fireListeners(type, ev, true);
        let n = ev.propagationStopped ? null : this;
        while (n && !ev.propagationStopped) {
            (n.listeners[type] || []).slice().forEach(fn => fn.call(n, ev));
            n = n.parentNode || (n.nodeType === 1 ? doc.root : null);
            if (n === doc.root) {
                if (!ev.propagationStopped) doc.fire(type, ev);
                if (!ev.propagationStopped && win) win.fireListeners(type, ev, false);
                break;
            }
        }
        return ev;
    }
    click() { return this.dispatch('click'); }
    descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
    querySelectorAll(sel) { return this.descendants().filter(e => matches(e, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

/* Selectors: compound '#id', '.a.b', 'tag', '[attr]', '[attr="v"]', a descendant via a space,
   a list via commas. */
function matchCompound(el, s) {
    const parts = s.match(/(#[\w-]+|\.[\w-]+|\[[^\]]+\]|^[a-zA-Z]+)/g) || [];
    return parts.every(p => {
        if (p[0] === '#') return el.id === p.slice(1);
        if (p[0] === '.') return el.classList.contains(p.slice(1));
        if (p[0] === '[') {
            const m = /^\[([\w-]+)(?:(\^?=)"([^"]*)")?\]$/.exec(p);
            if (!m) return false;
            const v = el.getAttribute(m[1]);
            if (!m[2]) return v !== null;
            return m[2] === '=' ? v === m[3] : v !== null && v.indexOf(m[3]) === 0;
        }
        return el.tagName === p.toUpperCase();
    });
}
function matches(el, sel) {
    return sel.split(',').some(part => {
        const chain = part.trim().split(/\s+/);
        if (!matchCompound(el, chain[chain.length - 1])) return false;
        let n = el.parentNode;
        for (let i = chain.length - 2; i >= 0; i--) {
            while (n && n.nodeType === 1 && !matchCompound(n, chain[i])) n = n.parentNode;
            if (!n || n.nodeType !== 1) return false;
            n = n.parentNode;
        }
        return true;
    });
}

/* Visibility, focus, siblings and closest - for the shared menu row (lib/fake-dom.cjs); a closed menu row list is
   hidden, as the styles hide it (.vo-mn-drop without open). */
require(path.join(__dirname, 'lib/fake-dom.cjs')).patch(El, {matches, capture: true,
    hidden: n => n.classList.contains('vo-mn-drop') && !n.classList.contains('open')});

function makeDocument() {
    const doc = {baseURI: 'http://ds.test/9.4.0-x/web-apps/apps/spreadsheeteditor/main/index.html', nodeType: 9};
    doc.root = {nodeType: 9};
    doc.documentElement = new El('html', doc);
    doc.documentElement.parentNode = doc.root;
    doc.body = doc.documentElement.appendChild(new El('body', doc));
    doc.activeElement = doc.body;
    doc.createElement = tag => new El(tag, doc);
    doc.getElementById = id => doc.documentElement.descendants().find(e => e.id === id) || null;
    doc.querySelectorAll = sel => doc.documentElement.querySelectorAll(sel);
    doc.querySelector = sel => doc.documentElement.querySelector(sel);
    doc.listeners = [];
    doc.addEventListener = (t, fn, capture) => { doc.listeners.push({t, fn, capture: capture === true || !!(capture && capture.capture)}); };
    doc.removeEventListener = (t, fn) => { doc.listeners = doc.listeners.filter(l => l.t !== t || l.fn !== fn); };
    doc.fire = (type, ev) => { doc.listeners.filter(l => l.t === type).slice().forEach(l => l.fn.call(doc, ev)); };
    return doc;
}

/* --- Fake stock ------------------------------------------------------------------ */

function events(target) {
    const handlers = {};
    target.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return target; };
    target.off = (name, fn) => { const a = handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); return target; };
    target.trigger = function (name, ...args) { (handlers[name] || []).slice().forEach(fn => fn.apply(target, args)); return target; };
    target.count = name => (handlers[name] || []).length;
    return target;
}

function item(caption, opt = {}) {
    const options = {caption};
    ['subtitle', 'description'].forEach(k => { if (opt[k] !== undefined) options[k] = opt[k]; });
    const it = events({caption, value: opt.value, disabled: !!opt.disabled, hidden: false, visible: true, rendered: true, menu: opt.menu || null,
                       checkable: !!opt.checkable, checked: !!opt.checked, options});
    it.isDisabled = function () { return this.disabled; };
    it.isChecked = function () { return this.checked; };
    it.setDisabled = function (v) { this.disabled = !!v; };
    it.onItemClick = function (e) {
        if (this.menu || this.disabled) return false;
        this.trigger('click', this, e);
    };
    return it;
}

function menu(captions) {
    const m = events({items: captions.map(c => typeof c === 'string' ? item(c) : c), rendered: true, parentEl: [{}]});
    m.items.forEach(i => i.on('click', (it, e) => m.trigger('item:click', m, it, e)));
    return m;
}

/* A ribbon button: clicks are counted in the journal under the double address. */
function button(ref, log, opt = {}) {
    const b = events({disabled: !!opt.disabled, pressed: !!opt.pressed, enableToggle: !!opt.toggle, visible: opt.visible !== false,
                      hidden: !!opt.hidden, keepState: opt.keepState || [], menu: opt.menu || null, options: {lock: []}, cmpEl: [{}]});
    b.isDisabled = function () { return this.disabled; };
    b.setDisabled = function (v) { this.disabled = !!v; };
    b.click = function () {
        if (this.disabled) return;
        if (this.enableToggle) this.pressed = !this.pressed;
        log.push('click ' + ref);
        this.trigger('click', this);
    };
    return b;
}

/* A standard ribbon checkbox (Common.UI.CheckBox: isChecked, setValue → 'change', onItemCheck - the click path): the "View" tab checkboxes
   "Gridlines", "Headings", "Zeros" ("View → Show ▸"). */
function checkbox(ref, log, opt = {}) {
    const c = events({checked: !!opt.checked, disabled: !!opt.disabled, rendered: true, keepState: opt.keepState || [], options: {}});
    c.isChecked = function () { return this.checked; };
    c.isDisabled = function () { return this.disabled; };
    c.setDisabled = function (v) { this.disabled = !!v; };
    c.setValue = function (v) { this.checked = !!v; log.push('check ' + ref + ' ' + this.checked); this.trigger('change', this, v); };
    c.onItemCheck = function () { if (!this.disabled) this.setValue(!this.checked); };
    return c;
}

/* The sheet tab menu of the sheet row (view/Statusbar.js tabMenu): the fifth item "Hidden" holds a submenu with the hidden workbook sheets in
   workbook order (the caption is the name, the value is the sheet index); without hidden sheets the stock hides the item (update: items[5].hide()). Choosing a
   row is the submenu 'item:click' → show:hidden → asc_showWorksheet (here - a journal entry). This is also "View → Hidden sheets ▸". */
function tabMenu(log, hidden = []) {
    const sheets = menu(hidden.map(([name, index]) => item(name, {value: index})));
    sheets.on('item:click', (m, it) => log.push('show hidden ' + it.value));
    const holder = item('Hidden', {menu: sheets});
    holder.hidden = !hidden.length;
    return {items: ['Insert', 'Delete', 'Rename', 'Move or copy', 'Hide'].map(c => item(c))
        .concat([holder], ['Protect', 'Tab color', '--', 'Select all sheets', 'Ungroup sheets'].map(c => item(c)))};
}

/* The "Formula" ribbon tab (view/FormulaTab.js onAppReady): the "Calculate" menu - "Calculate workbook" (Asc.c_oAscCalculateType.All) and
   "Calculate current sheet" (ActiveSheet), the "Remove arrows" menu - all, to precedents, to dependents (c_oAscRemoveArrowsType); a choice is the
   menu 'item:click' (here - a journal entry). "Watch window" is a toggle button (enableToggle). This is also "Data →
   Formulas ▸". */
const CALC = {WorkbookOnlyChanged: 1, ActiveSheet: 2, Workbook: 3, All: 4};
/* Asc.c_oAscCleanOptions (sdkjs cell/apiDefines.js): the values of the standard "Clear" menu items ("Format → Clear format" is the item
   "Formatting" by the Format value). */
const CLEAN = {All: 0, Text: 1, Format: 2, Formula: 4, Comments: 5, Hyperlinks: 6};
const ARROWS = {all: 0, precedent: 1, dependent: 2};
function formulaTab(log) {
    const calc = menu([item('Calculate workbook', {value: CALC.All}), item('Calculate current sheet', {value: CALC.ActiveSheet})]);
    calc.on('item:click', (m, it) => log.push('pick Formula:btnCalculate ' + it.caption));
    const arrows = menu([item('Remove arrows', {value: ARROWS.all}), item('Remove precedent arrows', {value: ARROWS.precedent}),
        item('Remove dependent arrows', {value: ARROWS.dependent})]);
    arrows.on('item:click', (m, it) => log.push('pick Formula:btnRemArrows ' + it.caption));
    return {btnCalculate: button('Formula:btnCalculate', log, {menu: calc}), btnRemArrows: button('Formula:btnRemArrows', log, {menu: arrows}),
        btnWatch: button('Formula:btnWatch', log, {toggle: true})};
}

/* The "Format" button of the "Home" ribbon tab (view/Toolbar.js: btnFormatCell.setMenu) in the stock shape: "Row height ▸" and "Column
   width ▸" - separator - "Hide ▸", "Show ▸" - separator - sheet actions (stock values) - separator - "Locked cell"
   (a checkbox, the checkmark is set by onShowBeforeCellFormat) and, only with a visible right panel (customization.rightMenu !== false), a separator and
   "Format cells" (value 'formatCells': controller/Toolbar.js onCellFormatMenu → rightmenu:open). A choice is the menu 'item:click'
   (journal). This is "Format → Rows, columns and sheet ▸" and "Format cells". */
function formatCellMenu(log, opt = {}) {
    const sub = caps => { const s = menu(caps); s.on('item:click', (mm, it) => log.push('pick Toolbar:btnFormatCell > ' + it.caption)); return s; };
    const m = menu([item('Row height', {menu: sub(['Auto row height', 'Custom row height'])}),
        item('Column width', {menu: sub(['Auto column width', 'Custom column width'])}), item('--'),
        item('Hide', {menu: sub(['Rows', 'Columns', 'Sheet'])}), item('Show', {menu: sub(['Rows', 'Columns'])}), item('--'),
        item('Rename sheet', {value: 'renameSheet'}), item('Move or copy sheet', {value: 'moveCopySheet'}), item('Tab color', {value: 'fillColor'}),
        item('Protect sheet', {value: 'protectSheet'}), item('--'), item('Locked cell', {value: 'lockedCell', checkable: true, checked: opt.locked !== false})]
        .concat(opt.rightMenu === false ? [] : [item('--'), item('Format cells', {value: 'formatCells'})]));
    m.on('item:click', (mm, it) => log.push('pick Toolbar:btnFormatCell ' + it.caption));
    return m;
}

/* The ribbon "Superscript/subscript" button (view/Toolbar.js btnSubscript: split, enableToggle) - two menu checkboxes by the values 'super'
   and 'sub' (the checkmark is set by the stock by selection, controller/Toolbar.js onApiSelectionChanged; the stock caption has the shortcut written in); a choice is the
   menu 'item:click' (journal). This is "Format → Text ▸ Superscript · Subscript". */
function subscriptMenu(log) {
    const m = menu([item('Superscript (Ctrl+.)', {value: 'super', checkable: true}), item('Subscript (Ctrl+,)', {value: 'sub', checkable: true})]);
    m.on('item:click', (mm, it) => log.push('pick Toolbar:btnSubscript ' + it.value));
    return m;
}

/* The bridge root is a view that has any btn*: a double is created on the first
   access (with a small menu - the submenu reads it). The explicit doubles are set by the case. */
function autoRoot(name, log, preset = {}) {
    const made = Object.assign({}, preset);
    return new Proxy(made, {
        get(t, k) {
            if (typeof k !== 'string') return t[k];
            if (!(k in t) && /^btn/.test(k)) {
                const ref = name + ':' + k;
                const m = menu(['First ' + k, 'Second ' + k]);
                m.on('item:click', (mm, it) => log.push('pick ' + ref + ' ' + it.caption));
                t[k] = /^btns/.test(k) ? [button(ref + '.0', log, {menu: m})] : button(ref, log, {menu: m});
            }
            return t[k];
        }
    });
}

function readStock(name) {
    const src = fs.readFileSync(LEFT_MENU, 'utf8');
    const head = name + ': function(';
    const start = src.indexOf(head);
    assert.ok(start >= 0, name + ' not found in controller/LeftMenu.js');
    let depth = 0, end = src.indexOf('{', start);
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    return src.slice(start + name.length + 2, end + 1);
}
const STOCK_SAVE_AS = readStock('clickSaveAsFormat');
const STOCK_FILE_ITEM = readStock('clickMenuFileItem');

const FILE_TYPE = {XLSX: 257, ODS: 259, CSV: 260, PDF: 513, PDFA: 2305};

function makeEnv(opt = {}) {
    const doc = makeDocument();
    const toolbarEl = doc.body.appendChild(new El('div', doc));
    toolbarEl.id = 'toolbar';
    const ribbon = toolbarEl.appendChild(new El('section', doc));
    ribbon.className = 'toolbar';

    const log = [];
    const NC = events({});
    const notes = [];
    const ncTrigger = NC.trigger;
    NC.trigger = function (name, ...args) { notes.push({name, args}); return ncTrigger.apply(NC, [name, ...args]); };
    const timers = [];
    const warnings = [];
    const copyWarnings = [];

    const api = {
        handlers: {}, indent: 3, protectedSheet: false, isCellEdited: false, calls: [],
        asc_registerCallback(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
        asc_unregisterCallback() {},
        asc_isDocumentModified() { return false; },
        asc_isProtectedSheet() { return this.protectedSheet; },
        asc_getCellInfo() { const me = this; return {asc_getXfs: () => ({asc_getIndent: () => me.indent})}; },
        asc_setCellIndent(v) { this.calls.push('indent ' + v); },
        asc_DownloadAs(o) { this.calls.push('download ' + o.type); },
        asc_getAdvancedOptions() { return {}; },
        asc_getDocumentName() { return 'Report.xlsx'; },
        asc_Resize() {},
        /* The sheet zoom ("View → Zoom ▸"): the engine holds a fraction, like sdkjs asc_getZoom/asc_setZoom. */
        zoom: 1,
        asc_getZoom() { return this.zoom; },
        asc_setZoom(z) { this.calls.push('zoom ' + z); this.zoom = z; },
        /* The workbook structure ("View → Hidden sheets ▸"): locking by a co-author and protection. */
        workbookLocked: false, workbookProtected: false,
        asc_isWorkbookLocked() { return this.workbookLocked; },
        asc_isProtectedWorkbook() { return this.workbookProtected; }
    };

    const appOptions = Object.assign({
        isEdit: true, canEdit: true, canRequestEditRights: false, canDownload: true, canPrint: true, canRename: true,
        isDesktopApp: false, isOffline: false, canHelp: true, canCoAuthoring: true, canComments: true, canViewComments: true,
        canChat: true, canUseHistory: true, isDisconnected: false, canRequestSharingSettings: true, sharingSettingsUrl: '',
        isSignatureSupport: false, isPasswordSupport: true, canChangeCoAuthoring: true, spreadsheet: {title: 'Report.xlsx'}
    }, opt.options || {});
    const hiddenLayout = new Set(opt.hiddenLayout || []);

    const nf = events({store: null, displayField: 'displayValue', disabled: false, getValue() { return 'General'; },
                       isDisabled() { return this.disabled; }, itemClicked() {}, cmpEl: [{querySelectorAll: () => []}]});
    nf.store = {length: 2, at: i => [{get: k => ({id: 'nf-0', displayValue: 'General', exampleval: '1'})[k]},
                                    {get: k => ({id: 'nf-1', displayValue: 'Number', exampleval: '1.00'})[k]}][i]};

    /* The explicit doubles of the case (standard menus with galleries) - a function of the document and the journal. */
    const pre = typeof opt.presets === 'function' ? opt.presets(doc, log) : {};
    const roots = {
        /* listStyles is the cell styles combo (ComboDataView): the double of "Cell styles". */
        Toolbar: autoRoot('Toolbar', log, Object.assign({cmbNumberFormat: nf,
            listStyles: button('Toolbar:listStyles', log, {menu: menu(['Normal', 'Bad'])}),
            /* The ribbon "Format" button in the stock shape (formatCellMenu) - "Format → Rows, columns and sheet ▸", "Format cells". */
            btnFormatCell: button('Toolbar:btnFormatCell', log, {menu: formatCellMenu(log, opt.formatCell || {})}),
            /* "Format → Text ▸" - the font style buttons (toggles) and superscript/subscript (items by value). */
            btnBold: button('Toolbar:btnBold', log, {toggle: true}), btnItalic: button('Toolbar:btnItalic', log, {toggle: true}),
            btnUnderline: button('Toolbar:btnUnderline', log, {toggle: true}), btnStrikeout: button('Toolbar:btnStrikeout', log, {toggle: true}),
            btnSubscript: button('Toolbar:btnSubscript', log, {toggle: true, menu: subscriptMenu(log)}),
            /* The ribbon "Clear" - items with stock values (Asc.c_oAscCleanOptions): "Format → Clear format" chooses
               "Formatting" by the Format value. */
            btnClearStyle: button('Toolbar:btnClearStyle', log, {menu: (() => {
                const m = menu([item('First btnClearStyle', {value: CLEAN.All}), item('Second btnClearStyle', {value: CLEAN.Format})]);
                m.on('item:click', (mm, it) => log.push('pick Toolbar:btnClearStyle ' + it.caption));
                return m;
            })()})}, pre.toolbar || {})),
        DataTab: autoRoot('DataTab', log),
        Formula: autoRoot('Formula', log, Object.assign(formulaTab(log), pre.formula || {})),
        ViewTab: autoRoot('ViewTab', log, Object.assign({chGridlines: checkbox('ViewTab:chGridlines', log, {checked: true}),
            chHeadings: checkbox('ViewTab:chHeadings', log, {checked: true}), chZeros: checkbox('ViewTab:chZeros', log, {checked: true})},
            pre.viewTab || {})),
        WBProtection: autoRoot('WBProtection', log, Object.fromEntries(
            ['chHiddenFormula', 'chLockedShape', 'chLockedText'].map(name => [name, checkbox('WBProtection:' + name, log)]))),
        PivotTable: autoRoot('PivotTable', log),
        Review: autoRoot('Review', log, opt.review || {}),
        /* The bottom row (the zoom buttons - the availability of "View → Zoom ▸", the tab menu - "Hidden sheets ▸"). */
        Statusbar: autoRoot('Statusbar', log, Object.assign({tabMenu: tabMenu(log, opt.hiddenSheets || []), mode: {}}, pre.statusbar || {}))
    };
    const comment = button('ToolbarCtl:btnsComment.0', log);

    const searchPanel = {focused: 0, focus() { this.focused++; }};
    const leftButtons = {};
    ['btnSearchBar', 'btnComments', 'btnChat', 'btnSpellcheck', 'btnAbout'].forEach(n => {
        leftButtons[n] = button('LeftMenu:' + n, log, {toggle: true, hidden: (opt.hiddenLeft || []).includes(n)});
    });
    const fileButtons = {rename: item('Rename'), protect: item('Protect'), save: item('Save')};
    const leftMenu = Object.assign({
        buttons: [], panelSearch: searchPanel,
        menuFile: {document: 'fileDoc' in opt ? opt.fileDoc : {info: {sharingSettings: [{user: 'u'}]}}, getButton: t => fileButtons[t] || null},
        showMenu(p, o) { log.push('showMenu ' + p + (o !== undefined ? ' ' + o : '')); },
        getMenu(t) { return t === 'file' ? this.menuFile : null; }
    }, leftButtons);
    const lmCtl = {
        api, mode: {}, leftMenu, requestEditRightsText: 'Requested',
        getApplication: () => ({getController: () => ({setStatusCaption: t => log.push('caption ' + t)})}),
        showLostDataWarning(cb) { log.push('warning csv'); cb(); },
        showLostDataWarningOds(cb) { log.push('warning ods'); cb(); }
    };

    /* The standard shortcut registry (common/main/lib/controller/Shortcuts.js): action →
       shortcuts, hidden ones filtered; keys - as the stock writes them in hints. */
    const shortcuts = {map: Object.assign({}, opt.shortcuts || {}), calls: 0, throws: false, registry: null};
    shortcuts.registry = 'shortcuts' in opt && opt.shortcuts === null ? null : {
        getShortcutsByActionType(name) {
            shortcuts.calls++;
            if (shortcuts.throws) throw new Error('registry is not filled yet');
            return shortcuts.map[name] ? [{keys: shortcuts.map[name].slice(), isCustom: false}] : null;
        }
    };
    const vlayout = {getItem: a => vlayout.items[a], items: {title: {height: 28}, toolbar: {height: 92}}, doLayout() {}};
    const main = {editorConfig: {ui: {shell: 'modern'}}, appOptions};
    /* The ribbon and context menu controllers: the copy, cut and paste handlers are set by the case (the real text of
       the stock, edit_cut_copy_paste). */
    const toolbarCtl = {toolbar: roots.Toolbar, btnsComment: [comment], api};
    const holderCtl = {api, permissions: appOptions, documentHolder: {}};
    /* The stock storage (Common.localStorage): what is written is read. */
    const store = Object.assign({}, opt.storage || {});
    const SSE = {
        Views: {},
        getController(name) {
            switch (name) {
                case 'Main': return main;
                case 'Toolbar': return toolbarCtl;
                case 'DocumentHolder': return holderCtl;
                case 'Viewport': return {viewport: {vlayout, hlayout: {doLayout() {}}, celayout: {doLayout() {}}}, getApi: () => api};
                case 'LeftMenu': return lmCtl;
                case 'DataTab': return {view: roots.DataTab};
                case 'FormulaDialog': return {formulaTab: roots.Formula};
                /* onClickMacros is the click handler of "Macros" of the "View" tab (controller/ViewTab.js: the standard macros window). */
                case 'ViewTab': return {view: roots.ViewTab, onClickMacros() { log.push('stock macros window'); }};
                case 'WBProtection': return {view: roots.WBProtection};
                case 'PivotTable': return {view: roots.PivotTable};
                case 'Common.Controllers.ReviewChanges': return {view: roots.Review};
                case 'Statusbar': return {statusbar: roots.Statusbar};
                case 'Common.Controllers.Shortcuts': return shortcuts.registry;
                default: return undefined;
            }
        }
    };

    const Asc = {c_oAscFileType: FILE_TYPE, c_oAscAdvancedOptionsID: {CSV: 0}, c_oAscCalculateType: CALC, c_oAscRemoveArrowsType: ARROWS, c_oAscCleanOptions: CLEAN,
                 asc_CDownloadOptions: function (type) { this.type = type; }};
    const context = {
        SSE, Asc, document: doc, innerWidth: 1440, innerHeight: 900,
        console: {warn: (...a) => warnings.push(a), log() {}, error() {}},
        setTimeout: fn => { timers.push(fn); return timers.length; },
        clearTimeout() {},
        Event: class { constructor(type) { this.type = type; } },
        URL, _: {extend: Object.assign, isEmpty: v => !v},
        getComputedStyle: () => ({overflowX: 'visible', overflowY: 'visible'}),
        Common: {
            NotificationCenter: NC,
            UI: {Menu: {Manager: {hideAll() { log.push('stock menus hidden'); }}},
                 LayoutManager: {isElementVisible: k => !hiddenLayout.has(k)}},
            Views: {RenameDialog: function (o) { log.push('rename dialog ' + o.filename); this.show = () => {}; },
                    /* The standard keyboard shortcuts window (common/main/lib/view/ShortcutsDialog.js): creation and show - into the journal. */
                    ShortcutsDialog: function (o) { log.push('shortcuts dialog ' + (o && o.api === api ? 'api' : 'no api')); this.show = () => log.push('shortcuts show'); },
                    /* The standard "Copy, cut and paste actions" window (common/main/lib/view/CopyWarningDialog.js): the show -
                       into the journal, the "do not show again" answer is given by the case (copyWarnings). */
                    CopyWarningDialog: function (o) { log.push('copy warning dialog'); copyWarnings.push(o); this.show = () => log.push('copy warning show'); }},
            localStorage: {setItem(k, v) { store[k] = String(v); log.push('localStorage ' + k + ' ' + v); }, getItem: k => k in store ? store[k] : null},
            component: {Analytics: {trackEvent() {}}},
            Gateway: {requestEditRights: () => log.push('request edit rights'), requestRename() {}}
        }
    };
    context.window = context;
    context.dispatchEvent = () => true;
    /* The window: listeners with a phase (capture - before the node, bubbling - after the document) and
       pointer events support, as in the browser. */
    context.onpointerdown = null;
    context.winListeners = [];
    context.addEventListener = (t, fn, capture) => { context.winListeners.push({t, fn, capture: capture === true || !!(capture && capture.capture)}); };
    context.removeEventListener = (t, fn, capture) => {
        const c = capture === true || !!(capture && capture.capture);
        context.winListeners = context.winListeners.filter(l => l.t !== t || l.fn !== fn || l.capture !== c);
    };
    context.fireListeners = (type, ev, capture) => {
        context.winListeners.filter(l => l.t === type && l.capture === capture).slice().forEach(l => l.fn.call(context, ev));
    };
    doc.win = context;
    vm.createContext(context);
    /* The standard "File" handlers are the real text of the spreadsheet editor controller. */
    lmCtl.clickSaveAsFormat = vm.runInContext('(' + STOCK_SAVE_AS + ')', context);
    lmCtl.clickMenuFileItem = vm.runInContext('(' + STOCK_FILE_ITEM + ')', context);
    const saveAs = lmCtl.clickSaveAsFormat;
    lmCtl.clickSaveAsFormat = function (menuArg, format) {
        log.push('saveas ' + format + (menuArg && typeof menuArg.hide === 'function' ? ' (menu with hide)' : ' (NO hide)'));
        return saveAs.call(this, menuArg, format);
    };
    const fileItem = lmCtl.clickMenuFileItem;
    lmCtl.clickMenuFileItem = function (menuArg, action) {
        log.push('file ' + action);
        return fileItem.call(this, menuArg, action);
    };

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
    load('spreadsheeteditor/main/app/view/SheetActions', ACTIONS);
    load('spreadsheeteditor/main/app/view/CompactShell', SHELL);
    const shell = SSE.Views.CompactShell;
    const A = SSE.Views.SheetActions;
    const B = SSE.Views.StockBridge;
    /* The shared menu row reason texts ("Viewing", protection) are the same as those of the shell and the spreadsheet editor catalog,
       as the spreadsheet editor locale puts them. */
    const MB = context.Common.UI.Compact.MenuBar;
    MB.textReasonView = shell.textModeLockedView;
    MB.textReasonProtected = A.textProtected;
    return {
        doc, SSE, shell, A, B, api, NC, notes, log, roots, leftButtons, fileButtons, searchPanel, appOptions, timers, warnings, comment, nf, shortcuts,
        main, toolbarCtl, holderCtl, store, copyWarnings, context,
        flush() { let n = 0; while (timers.length && n++ < 100) timers.shift()(); },
        create() { shell.create(); return doc.querySelector('#vo-shell .vo-mn'); },
        /* Arrays from the vm context are from another "realm": outward - as plain copies. */
        keys(g) { return Array.from(g.items, i => i.sep ? '--' : i.k); },
        group(label) { return A.groups().find(g => g.label === label); },
        sectionBtn(label) { return doc.querySelectorAll('#vo-shell .vo-mn-item').find(b => b.textContent === label); },
        row(k) { return doc.querySelector('#vo-shell .vo-mn-drop.open [data-k="' + k + '"]'); },
        /* The menu row re-reads open lists by restriction on the next frame (refresh). */
        relock() { shell.menu.refresh(); this.flush(); },
        /* The submenu rows of level level in order (and inside groups), without the rows of its submenu. */
        flyRows(level = 1) {
            const fly = doc.querySelectorAll('#vo-shell .vo-mn-fly').find(f => f.getAttribute('data-level') === String(level));
            return fly ? fly.descendants().filter(c => c.classList.contains('vo-mn-sub') && c.closest('.vo-mn-drop') === fly) : [];
        },
        /* The real key path: from the focused node (body by default). */
        escape(target) { return (target || doc.body).dispatch('keydown', {key: 'Escape', keyCode: 27}); }
    };
}

/* --- Run -------------------------------------------------------------------------- */

let passed = 0, failed = 0;
const pending = [];
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
const plain = v => JSON.parse(JSON.stringify(v));

/* The section composition with all possibilities and rights - with
   gallery items (Chart, Sparkline, Shape, Format as table, Cell styles;
   there is no "Tables", SmartArt, TextArt and "Equations" in "Insert"); without "Document language" (the spreadsheet editor
   stock does not have it). The order and separators are as in the catalog. */
const COMPOSITION = {
    /* "File": "Download ▸ (XLSX · PDF · CSV · ODS)" and "Import ▸" after "Save"; print titles, margins, orientation,
       page size and scale - in the print window. There is no "Access rights" and "Workbook password protection": access to the file is set by the portal.
       The compact spreadsheet menu has no way to switch to the standard interface. */
    textFile: ['save', 'download', 'import', '--', 'print', 'printArea', 'pageBreaks', 'headerFooter', '--', 'rename', 'docInfo',
        'advancedSettings'],
    /* "Edit": "Cut · Copy · Paste" - as a group after "Undo · Redo"; "Delete cells ▸ · Clear ▸ ·
       Fill ▸" - as one group; "Spelling" - after "Find and replace"; "Remove duplicates" - only in "Data". */
    textEdit: ['undo', 'redo', '--', 'cut', 'copy', 'paste', '--', 'deleteCells', 'clear', 'fill', '--', 'selectAll', 'findReplace', 'spelling'],
    /* "View": "Zoom ▸" - after "Freeze panes ▸", after it "Show ▸ (✓ Gridlines · ✓ Headings · ✓ Zeros ·
       ✓ Show formulas)"; "Normal · Page layout (a checkmark on the current one) · Views ▸ · Hidden sheets ▸ ·
       ✓ Sheet direction" - as one group; "Hide toolbar · Focus mode" - as its own group, without "Dark sheet",
       "Interface themes ▸" and "Object properties"; "Macros ▸ (Macros · Record macro · Pause recording)" - last. */
    textView: ['freeze', 'zoom', 'show', '--', 'viewNormal', 'viewPageLayout', 'views', 'hiddenSheets', 'sheetDirection', '--',
        'hideToolbar', 'focus', '--', 'macrosMenu'],
    /* "Insert": "Sheet" - after "Insert cells ▸"; without "Delete cells ▸" and "Slicer" - they are in "Edit" and "Data"; without
       "Tables" (this is "Format as table"), SmartArt, TextArt and "Equations". */
    textInsert: ['insertCells', 'sheet', '--', 'function', 'chart', 'sparkline', 'pivot', '--', 'image', 'shape', 'textBox', 'symbol',
        '--', 'link', 'comment'],
    /* "Format": "Rows, columns and sheet ▸" instead of "Format cells… ▸", "Format cells" - as a separate item after it;
       "Text ▸" instead of "Superscript and subscript ▸"; "Alignment ▸" - after "Case ▸", after it "✓ Wrap text";
       "Indent ▸" instead of "Increase indent · Decrease indent"; "Clear format" - without a submenu. */
    textFormat: ['numberFormat', 'rowsColsSheet', 'formatCells', '--', 'text', 'changeCase', 'align', 'wrap', 'textRotation', 'textDirection', 'indent',
        '--', 'borders', 'merge', '--', 'conditional', 'formatAsTable', 'cellStyles', 'colorScheme', '--', 'clearFormat'],
    /* "Data": "Slicer" - after "Clear filter"; "Get data from text ▸" - in "File → Import ▸"; "Calculation
       options ▸ · Trace precedents · Trace dependents · Remove arrows ▸ · Watch window" - in "Formulas ▸";
       "Goal Seek · Solver" - in "Analysis ▸" after "Formulas ▸". */
    textData: ['sortAZ', 'sortZA', 'customSort', '--', 'filter', 'clearFilter', 'slicer', 'validation', '--', 'textToColumns', 'removeDuplicatesData',
        'externalLinks', '--', 'group', 'ungroup', 'namedRanges', '--', 'formulas', 'analysis'],
    /* The "Review" section is called "Collaboration". */
    /* "Collaboration": there is no "Chat". */
    /* "Add comment" is in "Insert". */
    textCollaboration: ['sharing', 'coauthMode', 'history', '--', 'comments', 'resolveComments', 'deleteComments',
        /* "Collaboration": the four protection items are the "Protection ▸" submenu. */
        /* "Spelling" is in "Edit". */
        '--', 'protect'],
    /* "Help": "Keyboard shortcuts" and "Function list". */
    textHelp: ['help', 'shortcuts', 'functionList', 'about']
};
/* The keys of the items the menu row offers now - and of the children of composite items. */
const deepKeys = env => {
    const out = [];
    const walk = list => Array.from(list).forEach(i => { if (i.sep || i.head != null || i.mirror) return; out.push(i.k); if (i.items) walk(i.items); });
    env.A.groups().forEach(g => walk(g.items));
    return out;
};
const SECTIONS = ['textFile', 'textEdit', 'textView', 'textInsert', 'textFormat', 'textData', 'textCollaboration', 'textHelp'];

test('eight_sections_in_order', () => {
    const env = makeEnv();
    const bar = env.create();
    assert.ok(bar, 'no menu row in #vo-shell');
    assert.equal(bar.getAttribute('role'), 'menubar');
    const labels = SECTIONS.map(k => env.A[k]);
    /* The seventh section is "Collaboration", as in the
       document editor; the menu row has no "Review" key. */
    assert.deepEqual(labels, ['File', 'Edit', 'View', 'Insert', 'Format', 'Data', 'Collaboration', 'Help'], 'section defaults');
    assert.equal(env.A.textReview, undefined, 'the menu row still has the «Review» label');
    assert.deepEqual(plain(env.A.SECTION_KEYS), ['file', 'edit', 'view', 'insert', 'format', 'data', 'collaboration', 'help'],
        'service keys of the sections (coverage addresses «menu collaboration > …»)');
    assert.deepEqual(plain(env.A.groups().map(g => g.label)), labels, 'catalog order');
    assert.deepEqual(env.doc.querySelectorAll('#vo-shell .vo-mn-item[data-k]').map(b => b.textContent), labels, 'menu row order');
    /* The "…" of a narrow window is before "Help" pinned on the right (the shared menu row). */
    assert.deepEqual(env.doc.querySelectorAll('#vo-shell .vo-mn-item').map(b => b.textContent), labels.slice(0, 7).concat(['…', 'Help']),
        '«…» before the pinned «Help»');
    env.A.groups().forEach((g, i) => assert.deepEqual(plain(env.keys(g)), COMPOSITION[SECTIONS[i]], g.label + ': composition and order'));
    /* The rows take space in the layout: header 46 + menu row 30 + panel 4 + 44 + 8. */
    assert.equal(env.shell.shellHeight(), 132, 'shell rows: header + menu + toolbar');
    /* The catalog invariant (a submenu
       can also be its own - a composite item made of catalog items): an item has exactly one of twin | run, a
       composite one - neither but children; its children are the same items, plus a group header and
       stock menu rows in place; keys are unique among children too. */
    checkCatalog(env.A.catalog());
});

/* The menu row catalog invariant - recursively over composite items. */
function checkCatalog(catalog) {
    const all = [];
    const walk = (list, depth) => list.forEach(i => {
        if (i.sep) return;
        if (i.head != null) {
            assert.ok(depth > 0, 'a group header outside a submenu');
            assert.ok(typeof i.head === 'string' && i.head.length, 'a group header without a text');
            return;
        }
        if (i.mirror) {
            assert.ok(depth > 0, 'stock menu rows in place outside a submenu');
            assert.ok(typeof i.mirror === 'string' && !i.twin && !i.run && !i.items, i.mirror + ': stock rows in place are only a twin to mirror');
            return;
        }
        all.push(i);
        /* An item by value (pick: {value}) without its own caption takes the caption of the standard item. */
        const byValue = i.twin && i.pick && typeof i.pick === 'object' && !Array.isArray(i.pick);
        assert.ok(typeof i.t === 'string' && i.t.length || byValue, i.k + ': no label');
        if (i.items) {
            assert.ok(depth === 0, i.k + ': a submenu inside a submenu (one level only)');
            assert.ok(!i.twin && !i.run && !i.sub && !i.gallery, i.k + ': a composite item is neither a command nor a mirror');
            assert.ok(i.items.some(c => !c.sep && c.head == null), i.k + ': a composite item without children');
            walk(i.items, depth + 1);
            return;
        }
        assert.ok(!!i.twin !== !!i.run, i.k + ': exactly one of twin | run');
        if (i.sub) assert.ok(i.twin, i.k + ': a submenu needs a twin to mirror');
        if (i.gallery) assert.ok(i.twin && !i.sub, i.k + ': a gallery needs a twin and is not a mirrored submenu');
    });
    catalog.forEach(g => walk(g.items, 0));
    assert.equal(new Set(all.map(i => i.k)).size, all.length, 'item keys are unique');
}

test('integration_absent_hides_item', () => {
    const none = makeEnv({options: {canRename: false, canUseHistory: false, canRequestSharingSettings: false, sharingSettingsUrl: '',
        isPasswordSupport: false, isSignatureSupport: false, canHelp: false, canRequestEditRights: true, canCoAuthoring: false},
        hiddenLayout: ['toolbar-file-info', 'toolbar-file-settings', 'toolbar-file-save'], hiddenLeft: ['btnSpellcheck'], fileDoc: {}});
    /* With the children of composite items. */
    const keys = deepKeys(none);
    /* "Function list" - with the help connected, like "Help". */
    ['rename', 'history', 'sharing', 'help', 'functionList', 'docInfo', 'advancedSettings', 'save', 'coauthMode', 'chat', 'comments',
     'addComment', 'comment', 'resolveComments', 'deleteComments', 'spelling']
        .forEach(k => assert.ok(!keys.includes(k), k + ' is drawn without the capability'));
    /* Entering editing is by the stock condition (miEdit): only a read-only document with the edit right. */
    assert.ok(!keys.includes('editDoc'), 'edit entry in an edit session');
    const reader = makeEnv({options: {isEdit: false, canEdit: true, canRequestEditRights: true}});
    assert.equal(reader.group('File').items[0].k, 'editDoc', 'reader with the right to request editing gets the entry first');
    assert.equal(reader.A.itemState(reader.group('File').items[0]).disabled, false, 'entry to editing is never locked by the role');
    const full = makeEnv();
    const fk = deepKeys(full);
    ['rename', 'history', 'sharing', 'help', 'functionList', 'docInfo', 'advancedSettings', 'coauthMode', 'spelling']
        .forEach(k => assert.ok(fk.includes(k), k + ' is missing with the capability'));
    /* Separators do not dangle: a separator is not first, not last and not in a row. */
    none.A.groups().forEach(g => {
        const k = none.keys(g);
        assert.notEqual(k[0], '--', g.label + ' starts with a separator');
        assert.notEqual(k[k.length - 1], '--', g.label + ' ends with a separator');
        assert.ok(!k.some((x, i) => x === '--' && k[i + 1] === '--'), g.label + ': two separators in a row');
    });
});

test('download_print_not_drawn_without_rights', () => {
    const off = makeEnv({options: {canDownload: false, canPrint: false}});
    const file = off.keys(off.group('File'));
    assert.deepEqual(file.filter(k => /^download|^print$/.test(k)), [], 'download and print are drawn without the rights');
    /* "Download ▸": without the right there is neither a submenu nor its items. */
    assert.ok(!deepKeys(off).some(k => /^download/.test(k)), 'download formats are offered without the right');
    assert.ok(file.includes('printArea'), 'page setup stays (it is not printing)');
    const on = makeEnv();
    assert.deepEqual(on.keys(on.group('File')).filter(k => /^download|^print$/.test(k)), ['download', 'print']);
    assert.deepEqual(Array.from(on.A.offered('download').items, i => i.sep ? '--' : i.k), ['downloadXlsx', 'downloadPdf', 'downloadCsv', 'downloadOds']);
    /* The right is asked at every section build, not remembered from the start. */
    on.appOptions.canDownload = false;
    assert.ok(!on.keys(on.group('File')).includes('download'), 'download right is cached');
});

test('unavailable_item_inactive_with_reason', () => {
    const env = makeEnv();
    env.create();
    const sort = env.roots.DataTab.btnCustomSort;
    sort.setDisabled(true);
    sort.keepState = ['Sort'];
    env.api.protectedSheet = true;
    const it = env.group('Data').items.find(i => i.k === 'customSort');
    assert.deepEqual(plain(env.A.itemState(it)), {disabled: true, reason: env.A.textProtected, checked: false}, 'protected sheet');
    env.sectionBtn('Data').click();
    const row = env.row('customSort');
    assert.ok(row, 'locked item is hidden instead of inactive');
    assert.ok(row.classList.contains('vo-locked'));
    assert.equal(row.getAttribute('aria-disabled'), 'true');
    assert.equal(row.getAttribute('title'), env.A.textProtected);
    row.click();
    assert.ok(!env.log.includes('click DataTab:btnCustomSort'), 'locked item ran the stock command');
    /* The reason is from the standard lock reasons of the double; without a named reason - without a hint. "Increase indent" is in "Format → Indent ▸"
       ("Increase indent · Decrease indent" are merged into "Indent ▸"). */
    const bold = env.A.item('indentInc');
    env.roots.Toolbar.btnAlignLeft.setDisabled(true);
    env.roots.Toolbar.btnAlignLeft.keepState = ['cell-editing'];
    assert.equal(env.A.itemState(bold).reason, env.A.textEditing, 'cell editing');
    env.roots.Toolbar.btnAlignLeft.keepState = ['sel-chart'];
    assert.equal(env.A.itemState(bold).reason, null, 'object selected: inactive without a reason');
    /* There is no double - the item is visible inactive, it does not disappear. */
    const missing = makeEnv({review: {btnCoAuthMode: null}});
    const co = missing.group('Collaboration').items.find(i => i.k === 'coauthMode');
    assert.ok(co, 'item with a missing twin is hidden');
    assert.equal(missing.A.itemState(co).disabled, true);
});

test('view_items_inactive_until_owner_phase', () => {
    const env = makeEnv();
    const view = env.keys(env.group('View'));
    /* "View": "— Hide toolbar · Focus mode —"; there is no "Object properties"
       (the right panel opens by itself) - the shell command toggleRightPanel remains. */
    assert.deepEqual(view.slice(view.indexOf('hideToolbar') - 1, view.indexOf('hideToolbar') + 3), ['--', 'hideToolbar', 'focus', '--'],
        'positions of the items with a shell command');
    assert.ok(!view.includes('objectProps'), '«Object settings» is still in View');
    assert.equal(typeof env.shell.toggleRightPanel, 'function', 'the shell lost toggleRightPanel');
    /* An item without a shell command stands in place inactive and is not executed:
       the shell without toggleFocus. */
    const focus = env.group('View').items.find(i => i.k === 'focus');
    const ownFocus = env.shell.toggleFocus;
    delete env.shell.toggleFocus;
    assert.equal(env.A.itemState(focus, env.shell).disabled, true, 'focus is active without its command');
    assert.equal(env.A.exec(focus, env.shell), false, 'focus ran without its command');
    env.shell.toggleFocus = ownFocus;
    /* The shell got the command - the item comes alive without editing the catalog:
       the shell has toggleToolbar and toggleFocus, and "Hide panel" and "Focus mode" are alive. */
    const calls = [];
    const own = {toggleToolbar: env.shell.toggleToolbar, toggleFocus: env.shell.toggleFocus};
    assert.equal(typeof own.toggleToolbar, 'function', 'the shell has toggleToolbar');
    assert.equal(typeof own.toggleFocus, 'function', 'the shell has toggleFocus');
    env.shell.toggleToolbar = () => { calls.push('toolbar'); };
    env.shell.toggleFocus = () => { calls.push('focus'); };
    ['hideToolbar', 'focus'].forEach(k => {
        const it = env.group('View').items.find(i => i.k === k);
        assert.equal(env.A.itemState(it, env.shell).disabled, false, k + ' is inactive with its shell command');
        assert.equal(env.A.exec(it, env.shell), true, k + ' did not run');
    });
    assert.deepEqual(calls, ['toolbar', 'focus'], 'one shell command per item');
    env.shell.toggleToolbar = own.toggleToolbar;
    env.shell.toggleFocus = own.toggleFocus;
});

/* "View": without "Dark sheet · Interface themes ▸" (the look is set by the portal);
   "Object properties" - remove (the right panel opens by itself when selecting an object and by the "Format cells" command).
   They are in the catalog at no level, the menu row has no defaults for them; the standard buttons are only in the Standard interface (ADVANCED with a
   reason), the right panel is "other places"; the shell command toggleRightPanel remains. */
test('view_without_dark_theme_object_props', () => {
    const env = makeEnv();
    env.create();
    const all = deepKeys(env);
    ['darkSheet', 'uiTheme', 'objectProps'].forEach(k => {
        assert.ok(!all.includes(k), k + ' is still in the menu');
        assert.equal(env.A.item(k), null, k + ' is still in the catalog');
    });
    ['textDarkSheet', 'textUiTheme', 'textObjectProps'].forEach(k => assert.equal(env.A[k], undefined, k + ': the default is still there'));
    const twins = [];
    const walk = list => list.forEach(i => { if (/btnDarkDocument|btnInterfaceTheme/.test(i.twin || '')) twins.push(i.k); if (i.items) walk(i.items); });
    env.A.catalog().forEach(g => walk(g.items));
    assert.deepEqual(twins, [], 'a menu item on the dark sheet or the interface theme');
    const r = env.A.coverage();
    ['ViewTab:btnDarkDocument', 'ViewTab:btnInterfaceTheme'].forEach(ref => {
        assert.deepEqual(plain(r.byRef[ref].where), [], ref + ' has a compact address');
        assert.ok(/^Not in the compact shell: .*; the look is set by the portal$/.test(r.byRef[ref].why), ref + ': ' + r.byRef[ref].why);
    });
    assert.ok(/opens by itself/.test(r.byRef['ViewTab:chRightMenu'].where.join(' ')), 'the right panel address');
    assert.equal(typeof env.shell.toggleRightPanel, 'function', 'the shell command of the right panel is gone');
    assert.deepEqual(plain(r.missing), [], 'coverage holes');
});

test('insert_comment_needs_comment_right', () => {
    const off = makeEnv({options: {canComments: false}});
    assert.ok(!off.keys(off.group('Insert')).includes('comment'), 'comment without canComments');
    assert.ok(!deepKeys(off).some(k => /omment$/.test(k) && k !== 'comments'), 'add comment without canComments');
    const on = makeEnv();
    const it = on.group('Insert').items.find(i => i.k === 'comment');
    assert.equal(it.twin, 'ToolbarCtl:btnsComment.0', 'twin of the stock comment button');
    assert.equal(on.A.exec(it, on.shell), true);
    assert.deepEqual(on.log, ['click ToolbarCtl:btnsComment.0'], 'one stock click');
    on.comment.setDisabled(true);
    assert.equal(on.A.itemState(it).disabled, true, 'comment lock comes from the twin');
});

test('download_csv_goes_through_stock_save_as', () => {
    const env = makeEnv();
    /* The format items are children of "Download ▸". */
    const it = env.A.item('downloadCsv');
    assert.equal(env.A.exec(it, env.shell), true);
    assert.deepEqual(env.log, ['saveas ' + FILE_TYPE.CSV + ' (menu with hide)', 'warning csv'], 'stock save-as with its CSV warning');
    assert.ok(env.notes.some(n => n.name === 'download:advanced'), 'stock CSV options path');
    env.log.length = 0;
    env.A.exec(env.A.item('downloadOds'), env.shell);
    assert.deepEqual(env.log, ['saveas ' + FILE_TYPE.ODS + ' (menu with hide)', 'warning ods']);
    assert.deepEqual(env.api.calls, ['download ' + FILE_TYPE.ODS]);
});

test('save_as_gets_menu_with_hide', () => {
    const env = makeEnv();
    assert.doesNotThrow(() => env.A.exec(env.A.item('downloadXlsx'), env.shell));
    assert.deepEqual(env.api.calls, ['download ' + FILE_TYPE.XLSX], 'stock asc_DownloadAs');
    assert.doesNotThrow(() => env.A.exec(env.A.item('downloadPdf'), env.shell),
        'stock clickSaveAsFormat calls menu.hide() without a check');
    assert.ok(env.notes.some(n => n.name === 'download:settings'), 'PDF goes to the stock download settings');
    assert.ok(env.log.every(l => !/NO hide/.test(l)), 'save-as got a menu without hide()');
});

test('rename_and_edit_reach_stock_without_throw', () => {
    const env = makeEnv();
    /* There is no title field (the shell is not built) - the former standard rename window. */
    assert.doesNotThrow(() => env.A.rename());
    assert.doesNotThrow(() => env.A.requestEditRights());
    assert.deepEqual(env.log, ['file rename', 'rename dialog Report.xlsx', 'file edit', 'caption Requested', 'request edit rights']);
    /* The "Rename" item is disabled together with the standard file menu item. */
    const it = env.group('File').items.find(i => i.k === 'rename');
    env.fileButtons.rename.setDisabled(true);
    assert.equal(env.A.itemState(it).disabled, true, 'rename lock comes from the stock file menu');
    env.fileButtons.rename.setDisabled(false);
    /* "File → Rename" is like a click on the title in the header: the field is in focus, the text
       is selected, the keyboard is with the field, the menu is closed; there is no stock window. Focus and selection of the fake field - into the journal. */
    const live = makeEnv();
    live.create();
    const title = live.doc.querySelector('#vo-shell .vo-hd-title');
    assert.equal(title && title.tagName, 'INPUT', 'precondition: the name is a field with the rename right');
    title.focus = () => live.log.push('title focus');
    title.select = () => live.log.push('title select');
    title.getClientRects = () => [{}];
    const keys = [];
    live.api.asc_enableKeyEvents = v => keys.push(v);
    live.sectionBtn('File').click();
    live.row('rename').click();
    assert.deepEqual(plain(live.log.filter(l => /^title |^file rename|^rename dialog/.test(l))), ['title focus', 'title select'],
        '«Rename» is not the name field of the header');
    assert.equal(keys[keys.length - 1], false, 'the keyboard is not given to the name field');
    assert.equal(live.shell.hasOpenSurfaces(), false, 'the menu stayed open over the name field');
    /* The field is not visible (the header is hidden) - the former standard window, the field is not touched. */
    live.log.length = 0;
    title.getClientRects = () => [];
    live.sectionBtn('File').click();
    live.row('rename').click();
    assert.deepEqual(plain(live.log.filter(l => /^title |^file rename|^rename dialog/.test(l))), ['file rename', 'rename dialog Report.xlsx'],
        'a hidden name field took the rename');
});

test('print_goes_through_stock_print', () => {
    const env = makeEnv();
    const it = env.group('File').items.find(i => i.k === 'print');
    assert.equal(env.A.exec(it, env.shell), true);
    const prints = env.notes.filter(n => n.name === 'print');
    assert.equal(prints.length, 1, 'one stock print notification');
    assert.equal(prints[0].args[0], env.SSE.getController('LeftMenu').leftMenu, 'with the left menu view, as the file menu sends it');
    env.roots.Toolbar.btnPrint.setDisabled(true);
    assert.equal(env.A.itemState(it).disabled, true, 'print lock comes from the stock print button');
    assert.equal(env.A.exec(it, env.shell), false);
    assert.equal(env.notes.filter(n => n.name === 'print').length, 1, 'locked print went through');
});

test('submenu_from_live_stock_menu', () => {
    const env = makeEnv();
    env.create();
    const borders = env.roots.Toolbar.btnBorders;
    let opened = 0;
    borders.menu.on('show:before', () => { opened++; });
    env.sectionBtn('Format').click();
    assert.ok(env.log.includes('stock menus hidden'), 'stock dropdowns are closed when ours opens');
    env.row('borders').click();
    assert.equal(opened, 1, "stock menu prepared on our open ('show:before')");
    assert.deepEqual(plain(env.flyRows().map(r => r.querySelector('.vo-mn-t').textContent)), ['First btnBorders', 'Second btnBorders']);
    /* The stock changed the menu - the next opening shows the new one, without a snapshot from the start. */
    borders.menu.items[1].setDisabled(true);
    borders.menu.items[0].caption = 'Renamed';
    env.row('borders').click();
    assert.equal(opened, 2, 'mirror is not cached');
    const rows = env.flyRows();
    assert.deepEqual(plain(rows.map(r => r.querySelector('.vo-mn-t').textContent)), ['Renamed', 'Second btnBorders']);
    assert.ok(rows[1].classList.contains('vo-locked') && rows[1].getAttribute('aria-disabled') === 'true', 'stock disabled → inactive');
    rows[1].click();
    assert.ok(!env.log.some(l => /^pick Toolbar:btnBorders/.test(l)), 'disabled stock item picked');
    rows[0].click();
    assert.deepEqual(env.log.filter(l => /^pick /.test(l)), ['pick Toolbar:btnBorders Renamed'], 'stock item click, once');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'menu closes after the pick');
    /* The number format is a combo: examples and the checkmark come from the stock, a choice is a click on its list. */
    env.sectionBtn('Format').click();
    env.row('numberFormat').click();
    const nf = env.flyRows();
    assert.deepEqual(plain(nf.map(r => [r.querySelector('.vo-mn-t').textContent, (r.querySelector('.vo-mn-h') || {}).textContent || ''])),
        [['General', '1'], ['Number', '1.00']], 'number format examples from the stock');
});

test('click_rechecks_lock', () => {
    const env = makeEnv();
    env.create();
    env.sectionBtn('Data').click();
    const row = env.row('customSort');
    assert.ok(!row.classList.contains('vo-locked'), 'precondition: active at open');
    env.roots.DataTab.btnCustomSort.setDisabled(true);           // the stock disabled it after opening
    row.click();
    assert.ok(!env.log.includes('click DataTab:btnCustomSort'), 'click ran a command locked after the open');
    assert.ok(row.classList.contains('vo-locked'), 'row look not refreshed by the click');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'locked click closed the menu (stock keeps it open)');
    /* The same for a submenu: the double went disabled after opening - the choice does not go out. */
    env.sectionBtn('Data').click();
    env.sectionBtn('Data').click();
    env.row('group').click();
    env.roots.DataTab.btnGroup.setDisabled(true);
    env.flyRows()[0].click();
    assert.ok(!env.log.some(l => /^pick DataTab:btnGroup/.test(l)), 'submenu pick under a lock taken after the open');
    /* An active item - one standard call and closing the menu. */
    env.roots.DataTab.btnCustomSort.setDisabled(false);
    env.shell.closeSurfaces();
    env.sectionBtn('Data').click();
    env.row('customSort').click();
    assert.equal(env.log.filter(l => l === 'click DataTab:btnCustomSort').length, 1);
    assert.equal(env.shell.hasOpenSurfaces(), false);
});

/* A top-level toggle item (check in the catalog: "Show formulas",
   "Dark sheet", "Filter", "Watch window", protection…) - for the screen reader
   a toggle even when off: role=menuitemcheckbox and aria-checked true/false by the pressed state of the
   double; the state is re-read together with availability (rowState), the checkmark is only on
   an enabled one. The other items are menuitem without aria-checked. "Normal" and "Page
   layout" are one choice of two (check: 'radio'): menuitemradio with aria-checked, between
   separators; the other toggles are checkboxes. */
const RADIO_KEYS = ['viewNormal', 'viewPageLayout',
    /* "Format → Alignment ▸" - 7 variants, checkmarks on the current ones - two choices (horizontal,
       vertical) through a separator. */
    'alignLeft', 'alignCenter', 'alignRight', 'alignJust', 'alignTop', 'alignMiddle', 'alignBottom'];
test('menu_toggles_announce_their_state', () => {
    const env = makeEnv();
    env.create();
    const sections = env.SSE.Views.SheetActions.sections();
    const checks = {};
    env.A.catalog().forEach((g, i) => g.items.forEach(it => {
        if (it.check && env.A.offered(it.k)) checks[it.k] = {section: sections[i], holder: null};
        /* Toggles inside composite items ("Show ▸ ✓ Gridlines ·
           ✓ Headings · ✓ Zeros · ✓ Show formulas") - the same rules in the layer row. The zoom choice is marked by the sheet
           zoom (on), not by the double - it is checked by view_zoom_submenu. */
        if (it.items) it.items.forEach(c => { if (c.check && !c.on) checks[c.k] = {section: sections[i], holder: it.k}; });
    }));
    /* "View": "✓ Sheet direction" is a toggle. */
    /* There is no "Dark sheet" - the top-level toggle of "View" is now "✓ Sheet direction". */
    assert.ok(['showFormulas', 'filter', 'watchWindow', 'gridlines', 'headings', 'zeros', 'sheetDirection'].concat(RADIO_KEYS).every(k => checks[k]),
        'precondition: toggles in the catalog');
    /* An item's section - and the layer of its holder. */
    const open = k => {
        env.shell.closeSurfaces();
        env.sectionBtn(checks[k].section).click();
        if (checks[k].holder) env.row(checks[k].holder).click();
    };
    const state = k => {
        const r = env.row(k);
        assert.ok(r, 'no row ' + k);
        return [r.getAttribute('role'), r.getAttribute('aria-checked'), !!r.querySelector('.vo-mn-chk')];
    };
    ['chGridlines', 'chHeadings', 'chZeros'].forEach(n => { env.roots.ViewTab[n].checked = false; });
    /* Unpressed doubles are "off" toggles: a radio for the view pair, checkboxes for the rest. */
    Object.keys(checks).forEach(k => {
        open(k);
        const role = RADIO_KEYS.includes(k) ? 'menuitemradio' : 'menuitemcheckbox';
        assert.deepEqual(state(k), [role, 'false', false], k + ': released toggle is not announced as an unchecked ' + role);
    });
    /* Not toggles - menu items without state. */
    env.shell.closeSurfaces();
    env.sectionBtn('View').click();
    ['freeze', 'focus'].forEach(k =>
        assert.deepEqual(state(k).slice(0, 2), ['menuitem', null], k + ' is not a plain menu item'));
    /* A pressed "Show formulas" double is "on", with a checkmark (in the "Show ▸" layer). */
    env.roots.Formula.btnShowFormulas.pressed = true;
    open('showFormulas');
    assert.deepEqual(state('showFormulas'), ['menuitemcheckbox', 'true', true], 'pressed twin: toggle is not checked');
    assert.deepEqual(state('sheetDirection'), ['menuitemcheckbox', 'false', false], 'another toggle took the state');
    assert.deepEqual(state('gridlines'), ['menuitemcheckbox', 'false', false], 'another toggle in the layer took the state');
    /* The double was unpressed with the section open - the state is re-read together with availability (in the open layer too). */
    env.roots.Formula.btnShowFormulas.pressed = false;
    env.roots.ViewTab.chGridlines.checked = true;
    env.relock();
    assert.deepEqual(state('showFormulas'), ['menuitemcheckbox', 'false', false], 'state is not re-read with the lock');
    assert.deepEqual(state('gridlines'), ['menuitemcheckbox', 'true', true], 'a stock checkbox state is not re-read with the lock');
    env.roots.Toolbar.btnRtlSheet.pressed = true;
    env.relock();
    assert.deepEqual(state('sheetDirection'), ['menuitemcheckbox', 'true', true], 'state is not re-read with the lock');
    /* There is one checkmark and in its place - before ▸ (toggles do not have it) and after the caption. */
    const dark = env.row('sheetDirection');
    assert.equal(dark.querySelectorAll('.vo-mn-chk').length, 1, 'duplicated check mark');
    assert.equal(dark.children[dark.children.length - 1].className, 'vo-mn-chk', 'check mark is not the last element');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Normal · Page layout" - a radio pair right in the "View" section, without a submenu: both rows are menuitemradio
   with aria-checked, they go in a row right after the separator after "Show ▸"; the choice changed with the section open - the state
   is re-read together with availability, the checkmark is only on the current one. */
test('view_mode_pair_is_menuitemradio_at_section_level', () => {
    const env = makeEnv();
    env.create();
    const state = k => {
        const r = env.row(k);
        assert.ok(r, 'no row ' + k);
        return [r.getAttribute('role'), r.getAttribute('aria-checked'), !!r.querySelector('.vo-mn-chk')];
    };
    env.sectionBtn('View').click();
    const normal = env.row('viewNormal'), layout = env.row('viewPageLayout');
    assert.ok(normal && layout, 'the view pair is not at the top of View');
    const drop = normal.parentNode;
    assert.ok(drop.classList.contains('vo-mn-drop'), 'the view pair is not a row of the section');
    assert.equal(layout.parentNode === drop, true, '«Page layout» is not a row of the section');
    assert.equal(env.flyRows().length, 0, 'a submenu layer is open');
    const kids = Array.from(drop.children);
    const at = kids.indexOf(normal);
    assert.equal(kids[at + 1] === layout, true, '«Page layout» does not follow «Normal»');
    assert.equal(kids[at - 1].getAttribute('role'), 'separator', 'the view pair does not open its group');
    assert.equal(kids[at - 2].getAttribute('data-k'), 'show', 'the view pair is not after «Show ▸ —»');
    assert.equal(env.row('mode') === null, true, 'the «Mode ▸» row is left');
    [normal, layout].forEach(r => assert.equal(r.classList.contains('vo-has-sub'), false, r.getAttribute('data-k') + ' opens a submenu'));
    assert.deepEqual([state('viewNormal'), state('viewPageLayout')], [['menuitemradio', 'false', false], ['menuitemradio', 'false', false]],
        'released twins: the radio pair state');
    env.roots.ViewTab.btnViewNormal.pressed = true;
    env.relock();
    assert.deepEqual([state('viewNormal'), state('viewPageLayout')], [['menuitemradio', 'true', true], ['menuitemradio', 'false', false]],
        'pressed «Normal»: the radio pair state');
    env.roots.ViewTab.btnViewNormal.pressed = false;
    env.roots.ViewTab.btnViewPageBreak.pressed = true;
    env.relock();
    assert.deepEqual([state('viewNormal'), state('viewPageLayout')], [['menuitemradio', 'false', false], ['menuitemradio', 'true', true]],
        'pressed «Page layout»: the radio pair state is not re-read');
    /* The other rows of the group are not radios. */
    ['views', 'hiddenSheets'].forEach(k => assert.equal(env.row(k).getAttribute('role'), 'menuitem', k + ' joined the radio pair'));
    assert.equal(env.row('sheetDirection').getAttribute('role'), 'menuitemcheckbox', '«Sheet direction» joined the radio pair');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

test('escape_closes_one_layer', () => {
    const env = makeEnv();
    env.create();
    env.sectionBtn('Format').click();
    env.row('conditional').click();
    assert.equal(env.flyRows().length, 2, 'precondition: submenu open');
    env.escape();
    assert.equal(env.flyRows().length, 0, 'Escape closes the top layer first');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'and only it');
    env.escape();
    assert.equal(env.shell.hasOpenSurfaces(), false, 'next Escape closes the section');
    assert.doesNotThrow(() => env.escape(), 'nothing open');
    /* A click outside the menu and a standard modal window close everything. */
    env.sectionBtn('Format').click();
    env.doc.body.dispatch('pointerdown');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'outside press');
    env.sectionBtn('Format').click();
    env.NC.trigger('modal:show');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'stock modal window');
    /* In the Standard the key is silent; leaving for the Standard closes the menu. */
    env.sectionBtn('Format').click();
    env.shell.toggleMode();
    assert.equal(env.shell.hasOpenSurfaces(), false, 'advanced left the menu open');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* The shell menu row is shared (Common.UI.Compact.MenuBar) with the spreadsheet editor adapter: its node is the menu row in #vo-shell
   (a menubar with the shell name, the status slot is a live region, the "…" before the pinned "Help"), the shell has no drawing
   or row keyboard of its own. The spreadsheet editor shell is recorded in the shared layer shell registry: chosen by the config,
   the personal review mode is standard. */
test('menu_bar_is_the_shared_one', () => {
    const env = makeEnv();
    const bar = env.create();
    const S = env.shell, M = S.menu;
    ['enter', 'open', 'close', 'isOpen', 'refresh', 'status', 'exec', 'ownClosed', 'destroy'].forEach(n =>
        assert.equal(typeof M[n], 'function', 'the menu bar has no ' + n + '()'));
    assert.equal(M.el === bar, true, 'the menu row in the shell is not the shared menu bar');
    assert.equal(bar.getAttribute('role'), 'menubar');
    assert.equal(bar.getAttribute('aria-label'), S.textMenuBar_ARIA, 'the menu bar is not named by the shell');
    const status = M.status();
    assert.equal(!!status && bar.contains(status), true, 'no status place in the menu bar');
    assert.equal(status.getAttribute('aria-live'), 'polite', 'the status place is not a live region');
    assert.equal(S.menuAdapter.depth, 2, 'the spreadsheet adapter allows two submenu levels');
    assert.equal(S.menuAdapter.reasons.indexOf('cellEdit') >= 0, true, 'the spreadsheet adapter does not declare its reasons');
    ['openSection', 'menuRow', 'rowNode', 'stepRow', 'menuKey', 'refreshMenuLocks', 'openFly', 'openOwn', 'flyRow', 'hoverRow',
        'placeFly', 'closeFlies', 'galleryRoot', 'sectionOf', 'focusSection'].forEach(n =>
        assert.equal(typeof S[n], 'undefined', 'the shell still draws or drives its own menu row: ' + n));
    /* The shared layer shell registry. */
    const shells = env.context.Common.UI.Compact.Shells;
    const cur = shells && shells.current();
    assert.equal(!!cur, true, 'the spreadsheet shell is not registered in the shared layer');
    assert.equal(cur.personalReviewFollowsShared, false, 'the personal track changes mode of spreadsheets follows the shared flag');
    assert.equal(typeof cur.forAllText, 'undefined', 'spreadsheets give a reason for the personal track changes mode');
    env.main.editorConfig.ui.shell = 'classic';
    assert.equal(shells.current(), null, 'the registry picks the spreadsheet shell without ui.shell');
    env.main.editorConfig.ui.shell = 'modern';
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* F10 is entering the menu row from the keyboard: the engine keyboard is with the shell, focus is on the row stop (the first
   section), the key goes no further. A cell edit is in progress or a standard window is open - F10 belongs to them: the keyboard and focus are
   untouched, the key goes on. Shift+F10 is the standard context menu. Escape without layers - to the sheet. */
test('f10_enters_the_menu_unless_a_cell_is_edited', () => {
    const env = makeEnv();
    env.create();
    const keys = [];
    env.api.asc_enableKeyEvents = v => keys.push(v);
    const press = (key, extra) => env.doc.body.dispatch('keydown', Object.assign({key}, extra || {}));
    const first = env.doc.querySelectorAll('#vo-shell .vo-mn-item[data-k]')[0];
    env.api.isCellEdited = true;
    let ev = press('F10');
    assert.deepEqual([ev.defaultPrevented, keys.length, env.doc.activeElement === env.doc.body], [false, 0, true], 'F10 during a cell edit was taken');
    env.api.isCellEdited = false;
    const C = env.context.Common;
    C.Utils = Object.assign({}, C.Utils, {ModalWindow: {isVisible: () => true}});
    ev = press('F10');
    assert.deepEqual([ev.defaultPrevented, keys.length, env.doc.activeElement === env.doc.body], [false, 0, true], 'F10 over a stock window was taken');
    delete C.Utils.ModalWindow;
    ev = press('F10', {shiftKey: true});
    assert.deepEqual([ev.defaultPrevented, keys.length], [false, 0], 'Shift+F10 was taken');
    ev = press('F10');
    assert.equal(ev.defaultPrevented, true, 'F10 went on past the shell');
    assert.equal(env.doc.activeElement === first, true, 'F10 did not focus the first section');
    assert.deepEqual(plain(keys), [false], 'F10 did not take the keyboard from the engine');
    env.notes.length = 0;
    press('Escape');
    env.flush();
    assert.equal(first.contains(env.doc.activeElement), false, 'Escape left the focus in the menu bar');
    assert.deepEqual(plain(keys), [false, true], 'Escape did not give the keyboard back to the engine');
    assert.equal(env.notes.some(n => n.name === 'edit:complete'), true, 'Escape did not return the focus to the sheet (edit:complete)');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* Escape and an outside click close the shared menu row: Escape removes one layer and returns focus to whoever
   opened it (a submenu - to its item, a section - to its button), the shell does not handle this key a second time; a press
   inside the row does not close it, outside - closes and gives the sheet the keyboard taken by F10. */
test('escape_and_outside_click_close_the_shared_menu', () => {
    const env = makeEnv();
    env.create();
    const keys = [];
    env.api.asc_enableKeyEvents = v => keys.push(v);
    const press = key => (env.doc.activeElement || env.doc.body).dispatch('keydown', {key});
    const at = () => { const a = env.doc.activeElement; return a ? (a.getAttribute('data-k') || a.textContent) : null; };
    press('F10');
    for (let i = 0; i < 4; i++) press('ArrowRight');
    assert.equal(at(), 'format', 'precondition: «Format» in focus');
    press('ArrowDown');
    while (at() !== 'conditional') press('ArrowDown');
    press('ArrowRight');
    assert.equal(env.flyRows().length > 0, true, 'precondition: «Conditional formatting ▸» open');
    let ev = press('Escape');
    assert.deepEqual([env.flyRows().length, env.shell.menu.isOpen(), at()], [0, true, 'conditional'], 'Escape did not close only the submenu');
    assert.equal(ev.defaultPrevented, true);
    press('Escape');
    assert.deepEqual([env.shell.menu.isOpen(), env.shell.hasOpenSurfaces(), at()], [false, false, 'format'], 'Escape did not close only the section');
    assert.equal(keys.indexOf(true), -1, 'the keyboard went back to the sheet with the focus in the menu bar');
    /* A press inside the menu row - the menu is open; outside - closed, the keyboard goes to the sheet. */
    press('ArrowDown');
    env.row('borders').dispatch('pointerdown');
    assert.equal(env.shell.menu.isOpen(), true, 'a press inside the menu row closed it');
    const area = env.doc.body.appendChild(env.doc.createElement('textarea'));
    area.id = 'area_id';
    area.dispatch('pointerdown');
    area.focus();
    env.flush();
    assert.equal(env.shell.menu.isOpen(), false, 'a press outside left the menu open');
    assert.deepEqual([keys.indexOf(true), keys[keys.length - 1]], [keys.length - 1, true], 'a press outside did not give the keyboard back once');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* Over the grid the engine cancels pointerdown of its canvas, and the browser
   does not give birth to the compatible mousedown - a click on a cell (and on the sheet row buttons) must
   close the menu on the press itself. A press inside the menu row does not close it. */
test('outside_pointerdown_closes_menu', () => {
    const env = makeEnv();
    env.create();
    const canvas = env.doc.body.appendChild(env.doc.createElement('canvas'));
    canvas.id = 'ws-canvas-graphic-overlay';
    let engine = 0;
    canvas.addEventListener('pointerdown', ev => { engine++; ev.preventDefault(); });
    const tab = env.doc.body.appendChild(env.doc.createElement('button'));
    tab.addEventListener('pointerdown', ev => ev.stopPropagation());
    env.sectionBtn('Format').click();
    env.row('conditional').click();
    assert.equal(env.flyRows().length, 2, 'precondition: section and submenu open');
    env.flyRows()[0].dispatch('pointerdown');
    env.row('borders').dispatch('pointerdown');
    env.sectionBtn('Format').dispatch('pointerdown');
    assert.equal(env.flyRows().length, 2, 'a press inside the menu row closed it');
    canvas.dispatch('pointerdown');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'a press on the grid (pointerdown prevented by the engine, no mousedown) left the menu open');
    assert.equal(engine, 1, 'the grid did not get its press');
    env.sectionBtn('Data').click();
    const ev = tab.dispatch('pointerdown');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'a press on a sheet-row button (stopped at the node) left the menu open');
    assert.equal(ev.defaultPrevented, false, 'the shell must not take the press from the stock');
    assert.doesNotThrow(() => canvas.dispatch('pointerdown'), 'nothing open');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* During a cell edit focus is in the engine input field, and its handler suppresses
   Escape bubbling. While our layer is open, Escape must reach the shell before the engine:
   close the layer and go no further - the edit is alive. Without open layers the key goes to the engine. */
test('escape_reaches_shell_before_engine', () => {
    const env = makeEnv();
    env.create();
    const area = env.doc.body.appendChild(env.doc.createElement('textarea'));
    area.id = 'area_id';
    const engine = [];
    area.addEventListener('keydown', ev => { engine.push(ev.key); ev.stopPropagation(); });
    env.sectionBtn('Format').click();
    env.row('conditional').click();
    let ev = env.escape(area);
    assert.equal(env.flyRows().length, 0, 'Escape in the cell editor did not close the submenu');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'one press closed more than the top layer');
    assert.deepEqual(engine, [], 'the engine got the Escape that closed our layer (the cell edit is cancelled)');
    assert.equal(ev.defaultPrevented, true, 'the consumed Escape is not prevented');
    env.escape(area);
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the second Escape did not close the section');
    assert.deepEqual(engine, [], 'the engine got an Escape while our section was open');
    ev = env.escape(area);
    assert.deepEqual(engine, ['Escape'], 'with nothing open the Escape must reach the engine');
    assert.equal(ev.defaultPrevented, false, 'with nothing open the shell must not touch the key');
    /* In the Standard the key is not ours, even if a layer was somehow opened. The shell in the Standard is hidden by styles
       (compact-shell.less) - there are no styles here, we hide it the same way. */
    env.shell.toggleMode();
    const shellEl = env.doc.getElementById('vo-shell');
    shellEl.style.display = 'none';
    env.shell.menu.open('format');
    env.escape(area);
    assert.deepEqual(engine, ['Escape', 'Escape'], 'advanced: the shell took the key');
    shellEl.style.display = '';
    env.shell.toggleMode();
});

/* The menu row items have keyboard shortcuts
   (Ctrl+S, Ctrl+P, Ctrl+Z, Ctrl+Y, Ctrl+A, Ctrl+F, Ctrl+`, Ctrl+K, Ctrl+Shift+L, F1), from the
   standard registry: a shortcut reassigned by the user is visible at the next
   section opening. */
const MENU_HINTS = {save: 'Ctrl+S', print: 'Ctrl+P', undo: 'Ctrl+Z', redo: 'Ctrl+Y', selectAll: 'Ctrl+A', findReplace: 'Ctrl+F',
    showFormulas: 'Ctrl+`', link: 'Ctrl+K', filter: 'Ctrl+Shift+L', help: 'F1',
    /* Keyboard shortcuts are shown to the right of a menu item if the command has
       one; "Cut · Copy · Paste" are the same actions as the shortcuts: the new "Edit"
       items - with the standard shortcuts Ctrl+X, Ctrl+C, Ctrl+V. */
    cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V',
    /* "View → Zoom ▸ 100 %" is the same command as
       the standard zoom reset shortcut (Zoom100). */
    zoom100: 'Ctrl+0'};
const STOCK_KEYS = {Save: ['Ctrl', 'S'], PrintPreviewAndPrint: ['Ctrl', 'P'], EditUndo: ['Ctrl', 'Z'], EditRedo: ['Ctrl', 'Y'],
    EditSelectAll: ['Ctrl', 'A'], OpenFindDialog: ['Ctrl', 'F'], OpenFindAndReplaceMenu: ['Ctrl', 'H'], ShowFormulas: ['Ctrl', '`'],
    InsertHyperlink: ['Ctrl', 'K'], ToggleAutoFilter: ['Ctrl', 'Shift', 'L'], OpenHelpMenu: ['F1'], OpenCommentsPanel: ['Ctrl', 'Shift', 'H'],
    OpenFormatCell: ['Ctrl', '1'], CellInsertSumFunction: ['Alt', '='], Cut: ['Ctrl', 'X'], Copy: ['Ctrl', 'C'], Paste: ['Ctrl', 'V'],
    Zoom100: ['Ctrl', '0']};
test('shortcut_hints_from_stock_registry', () => {
    const env = makeEnv({shortcuts: STOCK_KEYS});
    env.create();
    const hints = {};
    const collect = () => env.doc.querySelectorAll('#vo-shell .vo-mn-drop.open [data-k]').forEach(r => {
        const h = r.querySelector('.vo-mn-h');
        if (h) hints[r.getAttribute('data-k')] = h.textContent;
    });
    SECTIONS.forEach(key => {
        env.shell.closeSurfaces();
        env.sectionBtn(env.A[key]).click();
        collect();
        /* And for the items of composite submenus: "Show formulas" - in "View → Show ▸". */
        env.A.groups().find(g => g.label === env.A[key]).items.filter(i => i.items).forEach(h => { env.row(h.k).click(); collect(); });
    });
    assert.deepEqual(hints, MENU_HINTS, 'menu hints are the expected shortcuts, read from the stock registry');
    /* The user reassigned a shortcut - the section opens anew and shows the new one. */
    env.shortcuts.map.Save = ['⌘', 'S'];
    env.shell.closeSurfaces();
    env.sectionBtn('File').click();
    assert.equal(env.row('save').querySelector('.vo-mn-h').textContent, '⌘+S', 'the registry is cached');
    /* No action in the registry or the registry threw - there is no hint, the item is in place. */
    delete env.shortcuts.map.Save;
    env.shell.closeSurfaces();
    env.sectionBtn('File').click();
    assert.equal(env.row('save').querySelector('.vo-mn-h'), null, 'a hint without a stock shortcut');
    env.shortcuts.throws = true;
    env.shell.closeSurfaces();
    assert.doesNotThrow(() => env.sectionBtn('Edit').click());
    assert.ok(env.row('undo') && !env.row('undo').querySelector('.vo-mn-h'), 'registry failure must leave the item without a hint');
    const none = makeEnv({shortcuts: null});
    none.create();
    none.sectionBtn('Edit').click();
    assert.ok(none.row('undo') && !none.row('undo').querySelector('.vo-mn-h'), 'no registry — no hint');
    assert.equal(env.warnings.length + none.warnings.length, 0, 'unexpected warnings');
});

/* The standard item notes of a submenu - the value on the right (the page
   size, as the stock shows it now), the description on the second line (the co-editing
   modes); the caption is separate, .vo-mn-t without a note. */
test('submenu_shows_stock_notes', () => {
    const env = makeEnv();
    /* "Page size ▸" is no longer in "File" (it is in the print window) -
       the value on the right of a mirror row is checked on a case item with the same standard menu. */
    withMirrorItem(env, {k: 'tstPageSize', t: 'Page size', twin: 'Toolbar:btnPageSize', sub: true});
    env.create();
    env.roots.Toolbar.btnPageSize = button('Toolbar:btnPageSize', env.log, {menu: menu([
        item('A4', {subtitle: '21cm x 29,7cm', checkable: true, checked: true}), item('A3', {subtitle: '29,7cm x 42cm'}), item('Custom')])});
    const coMenu = menu([item('Fast', {description: 'Real-time co-editing.', checkable: true, checked: true}),
                         item('Strict', {description: 'Use Save to sync.'})]);
    coMenu.on('item:click', (m, it) => env.log.push('pick coauth ' + it.caption));
    env.roots.Review.btnCoAuthMode = button('Review:btnCoAuthMode', env.log, {menu: coMenu});
    env.sectionBtn('View').click();
    env.row('tstPageSize').click();
    const size = env.flyRows();
    assert.deepEqual(plain(size.map(r => [r.querySelector('.vo-mn-t').textContent, (r.querySelector('.vo-mn-h') || {}).textContent || ''])),
        [['A4', '21cm x 29,7cm'], ['A3', '29,7cm x 42cm'], ['Custom', '']], 'page size values on the right');
    assert.ok(size[0].querySelector('.vo-mn-chk'), 'the stock check mark stays next to the value');
    env.shell.closeSurfaces();
    env.sectionBtn('Collaboration').click();
    env.row('coauthMode').click();
    const co = env.flyRows();
    assert.deepEqual(plain(co.map(r => [r.querySelector('.vo-mn-t').textContent, (r.querySelector('.vo-mn-d') || {}).textContent || '',
        r.classList.contains('vo-has-desc'), !!r.querySelector('.vo-mn-h')])),
        [['Fast', 'Real-time co-editing.', true, false], ['Strict', 'Use Save to sync.', true, false]], 'co-editing descriptions under the caption');
    co[1].click();
    assert.deepEqual(env.log.filter(l => /^pick /.test(l)), ['pick coauth Strict'], 'a described item is picked by the stock item click, once');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'a pick on a described item closes the menu');
});

test('left_panels_open_through_stock_buttons', () => {
    const env = makeEnv();
    env.create();
    const find = env.group('Edit').items.find(i => i.k === 'findReplace');
    assert.equal(env.A.exec(find, env.shell), true);
    assert.deepEqual(env.log, ['click LeftMenu:btnSearchBar'], 'search panel through its stock button');
    assert.ok(env.doc.body.classList.contains('vo-left-open'), 'left area shown for the stock panel');
    /* Already open - we do not close it with a second press, but return focus into it. */
    env.A.exec(find, env.shell);
    assert.equal(env.log.length, 1, 'find closed the open search panel');
    assert.equal(env.searchPanel.focused, 1);
    const comments = env.group('Collaboration').items.find(i => i.k === 'comments');
    env.A.exec(comments, env.shell);
    env.A.exec(comments, env.shell);
    assert.deepEqual(env.log.slice(1), ['click LeftMenu:btnComments', 'click LeftMenu:btnComments'], 'comments toggle');
});

/* --- Galleries ------------------------------------------------------------------------------ */

/* The menu row gallery items: the double is a standard button with a gallery menu (for "Cell styles" - the
   styles combo). The glyphs are own for each item. In "Insert" there is no:
   "Table" (a duplicate of "Format as table" - the same btnTableTemplate gallery), SmartArt,
   TextArt and "Equations" - they have no galleries in the menu row. */
const GALLERIES = {
    chart: ['Toolbar:btnInsertChart', 'chart', 'textChart', 'Chart'],
    sparkline: ['Toolbar:btnInsertSparkline', undefined, 'textSparkline', 'Sparkline'],
    shape: ['Toolbar:btnInsertShape', 'shape', 'textShape', 'Shape'],
    formatAsTable: ['Toolbar:btnTableTemplate', undefined, 'textFormatAsTable', 'Format as table'],
    cellStyles: ['Toolbar:listStyles', undefined, 'textCellStyles', 'Cell styles']
};

test('gallery_items_in_positions', () => {
    const env = makeEnv();
    const all = [].concat(...env.A.catalog().map(g => g.items)).filter(i => !i.sep);
    const gal = all.filter(i => i.gallery);
    assert.deepEqual(plain(gal.map(i => i.k)).sort(), Object.keys(GALLERIES).sort(), 'gallery items of the menu bar');
    gal.forEach(i => {
        const [twin, glyph, key, label] = GALLERIES[i.k];
        assert.equal(i.twin, twin, i.k + ': twin');
        assert.equal(i.i, glyph, i.k + ': glyph');
        assert.equal(i.t, env.A[key], i.k + ': label from the locale key ' + key);
        assert.equal(env.A[key], label, i.k + ': English default');
        assert.ok(!i.sub && !i.run && i.pick === undefined, i.k + ': a gallery is shown, not mirrored or run');
    });
    /* The positions: "Function ▸ · Chart ▸ · Sparkline · Pivot table — Image ▸ · Shape ▸ · Text box · Symbol"
       in "Insert", "Conditional formatting ▸ · Format as table ▸ · Cell
       styles ▸ · Color scheme ▸". */
    assert.deepEqual(plain(env.keys(env.group('Insert'))), COMPOSITION.textInsert);
    assert.deepEqual(plain(env.keys(env.group('Format'))), COMPOSITION.textFormat);
    /* A gallery row has an arrow ▸, like a row with a submenu. */
    env.create();
    env.sectionBtn('Insert').click();
    ['chart', 'sparkline', 'shape'].forEach(k => {
        const row = env.row(k);
        assert.ok(row && row.classList.contains('vo-has-sub') && row.getAttribute('aria-haspopup') === 'menu', k + ': gallery row has ▸');
    });
    env.shell.closeSurfaces();
    env.sectionBtn('Format').click();
    ['formatAsTable', 'cellStyles'].forEach(k => assert.ok(env.row(k).classList.contains('vo-has-sub'), k + ': gallery row has ▸'));
    /* Under the stock ribbon mask ("Viewing", connection loss) a gallery item
       is inactive with a reason, like the other ribbon doubles. */
    const masked = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    gal.forEach(i => assert.deepEqual(plain(env.A.itemCode(i, masked)), {disabled: true, reason: 'view', checked: false}, i.k + ' under the mask'));
});

/* A fake gallery show per the bridge contract (StockBridge.popup / closePopup / popupOpen /
   popupOwns / dialog - their mechanics are checked by stock-bridge.cjs): the show dispatches the standard
   menu:show, like the stock Menu.show; the gallery node is outside the menu row. */
function stubGallery(env, opt = {}) {
    const B = env.B, calls = [];
    const gallery = env.doc.body.appendChild(env.doc.createElement('ul'));
    gallery.className = 'dropdown-menu';
    const cell = gallery.appendChild(env.doc.createElement('div'));
    cell.className = 'item';
    let shown = null;
    B.popup = function (ref, anchor, o) {
        calls.push({fn: 'popup', ref, anchor, align: o && o.align, padY: o && o.padY});
        if (opt.refuse) return false;
        if (shown) B.closePopup('replace');
        shown = {ref, o: o || {}};
        env.NC.trigger('menu:show');
        return true;
    };
    B.closePopup = function (how) {
        if (!shown) return false;
        const s = shown;
        shown = null;
        calls.push({fn: 'close', ref: s.ref, how: how || 'close'});
        s.o.onClose && s.o.onClose(how || 'close');
        return true;
    };
    B.popupOpen = () => !!shown;
    B.popupOwns = n => !!shown && gallery.contains(n);
    B.dialog = ref => { calls.push({fn: 'dialog', ref}); return !!opt.dialog; };
    return {calls, gallery, cell, pops: () => calls.filter(c => c.fn === 'popup'), closes: () => calls.filter(c => c.fn === 'close').map(c => c.how)};
}

test('gallery_row_opens_stock_popup_at_the_row', () => {
    const env = makeEnv();
    env.create();
    const g = stubGallery(env);
    env.sectionBtn('Insert').click();
    const row = env.row('chart');
    row.click();
    assert.equal(g.pops().length, 1);
    const p = g.pops()[0];
    assert.deepEqual([p.ref, p.anchor === row, p.align, p.padY], ['Toolbar:btnInsertChart', true, 'tl-tr', 10], 'stock gallery of the twin at our row');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'menu:show of our own gallery does not close the menu');
    assert.ok(env.row('chart'), 'section stays open next to the gallery');
    assert.ok(row.classList.contains('vo-sub-open') && row.getAttribute('aria-expanded') === 'true', 'row marked as open');
    assert.deepEqual(plain(env.log), ['stock menus hidden'], 'no stock command on opening a gallery');
    /* A press in the gallery is not "outside". */
    g.cell.dispatch('pointerdown');
    assert.equal(env.B.popupOpen(), true, 'a press inside the gallery closed it');
    assert.equal(env.shell.hasOpenSurfaces(), true);
    /* Escape removes the gallery first, then the section. */
    env.escape();
    assert.equal(env.B.popupOpen(), false, 'Escape closes the gallery first');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'and only it');
    assert.ok(!row.classList.contains('vo-sub-open'), 'row mark cleared');
    env.escape();
    assert.equal(env.shell.hasOpenSurfaces(), false);
    /* A choice in the gallery closes everything. */
    env.sectionBtn('Insert').click();
    env.row('shape').click();
    assert.equal(g.pops().pop().ref, 'Toolbar:btnInsertShape');
    env.B.closePopup('pick');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'a pick in the gallery closes the menu');
    /* The stock removed the gallery itself - the menu is alive, the row is closed again. ("Equation" and TextArt were removed from "Insert" -
       the same mechanics - on "Sparkline".) */
    env.sectionBtn('Insert').click();
    env.row('sparkline').click();
    env.B.closePopup('hide');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'stock-side hide leaves our menu');
    assert.ok(!env.row('sparkline').classList.contains('vo-sub-open'));
    /* Hovering a neighboring row closes the gallery (like a submenu). */
    env.row('sparkline').click();
    env.row('link').dispatch('mouseenter');
    env.flush();
    assert.equal(env.B.popupOpen(), false, 'hover on a plain row closes the gallery');
    assert.equal(env.shell.hasOpenSurfaces(), true);
    /* Hovering a gallery row opens it with a delay, like a submenu. */
    env.row('sparkline').dispatch('mouseenter');
    env.flush();
    assert.equal(g.pops().pop().ref, 'Toolbar:btnInsertSparkline', 'hover opens the gallery');
    /* An outside click closes everything, a standard modal window too. */
    env.doc.body.dispatch('pointerdown');
    assert.equal(env.B.popupOpen(), false);
    assert.equal(env.shell.hasOpenSurfaces(), false, 'outside press closes the gallery and the menu');
    env.sectionBtn('Insert').click();
    env.row('chart').click();
    env.NC.trigger('modal:show');
    assert.equal(env.B.popupOpen(), false, 'stock modal window closes the gallery');
    /* A disabled double - the gallery does not open. */
    env.roots.Toolbar.btnInsertChart.setDisabled(true);
    const before = g.pops().length;
    env.sectionBtn('Insert').click();
    env.row('chart').click();
    assert.equal(g.pops().length, before, 'locked gallery item opened');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* An open standard gallery at a menu row closes together with its row: the row went disabled (an edit restriction, an access
   denial - a re-read by restriction) or disappeared (the stock hid the double). The section stays open, the row is again a
   closed ▸ item; a choice in a closed gallery will no longer perform the standard command. */
test('open_gallery_closes_with_its_row', () => {
    const env = makeEnv();
    env.create();
    const g = stubGallery(env);
    const chart = env.roots.Toolbar.btnInsertChart;
    env.sectionBtn('Insert').click();
    env.row('chart').click();
    assert.equal(env.B.popupOpen(), true, 'precondition: the gallery is open');
    chart.setDisabled(true);
    env.relock();
    assert.equal(env.B.popupOpen(), false, 'the gallery of a row that went off stayed open');
    assert.deepEqual(g.closes(), ['close'], 'the gallery is closed by the menu');
    let row = env.row('chart');
    assert.ok(row, 'the row left the section');
    assert.deepEqual([row.getAttribute('aria-disabled'), row.getAttribute('aria-expanded'), row.classList.contains('vo-sub-open')],
        ['true', 'false', false], 'the row is an inactive closed ▸ item');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'the section closed with the gallery');
    /* The row is alive - the gallery stays in place. */
    chart.setDisabled(false);
    env.relock();
    env.row('chart').click();
    env.relock();
    assert.equal(env.B.popupOpen(), true, 'a refresh closed the gallery of a live row');
    /* The row disappeared. */
    chart.hidden = true;
    env.relock();
    assert.equal(env.row('chart'), null, 'precondition: the row is gone');
    assert.equal(env.B.popupOpen(), false, 'the gallery of a row that is gone stayed open');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'the section closed with the gallery');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

test('gallery_refused_falls_back_to_stock_dialog', () => {
    const env = makeEnv();
    env.create();
    const g = stubGallery(env, {refuse: true, dialog: true});
    env.sectionBtn('Insert').click();
    env.row('chart').click();
    assert.deepEqual(plain(g.calls.map(c => c.fn + ' ' + c.ref)), ['popup Toolbar:btnInsertChart', 'dialog Toolbar:btnInsertChart'],
        'no popup — the stock dialog of the command');
    /* The result is on the next tick: the menu row marks its surface after openRow. */
    env.flush();
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the dialog took over, menu closed');
    const none = stubGallery(env, {refuse: true, dialog: false});
    env.sectionBtn('Insert').click();
    env.row('shape').click();
    env.flush();
    assert.equal(env.shell.hasOpenSurfaces(), true, 'nothing to open — the menu stays');
    assert.equal(none.calls.length, 2);
});

/* A gallery item executed bypassing the menu row (SheetActions.exec without a row - nowhere to show
   the gallery): the standard command dialog through the bridge, exactly once, with its result; no
   double click in the hidden ribbon, no popup show, no item choice. A disabled item
   does not reach the bridge. The branch `if (it.gallery) return Bridge.dialog(it.twin)` is intercepted by CompactShell
   earlier (openGallery), so it is held only by this case. */
test('gallery_exec_without_row_opens_stock_dialog', () => {
    const env = makeEnv();
    const B = env.B, calls = [];
    const gal = [].concat(...env.A.catalog().map(g => g.items)).filter(i => !i.sep && i.gallery);
    assert.equal(gal.length, Object.keys(GALLERIES).length, 'gallery items of the catalog');
    let answer;
    const RESULT = {dialog: 'stock dialog result'};
    B.dialog = ref => { calls.push('dialog ' + ref); return answer; };
    ['run', 'popup', 'pick', 'prime'].forEach(fn => {
        B[fn] = ref => { calls.push(fn + ' ' + ref); return true; };
    });
    gal.forEach(it => {
        [true, false, RESULT].forEach(value => {
            calls.length = 0;
            answer = value;
            const got = env.A.exec(it, env.shell);
            assert.deepEqual(plain(calls), ['dialog ' + it.twin], it.k + ': only the stock dialog of the twin, once');
            assert.equal(got, value, it.k + ': exec returns what the stock dialog returned');
        });
    });
    /* A disabled double - the second end of the gate: neither a dialog nor a click. */
    env.roots.Toolbar.btnInsertChart.setDisabled(true);
    calls.length = 0;
    answer = true;
    assert.equal(env.A.exec(gal.find(i => i.k === 'chart'), env.shell), false, 'locked gallery item ran');
    assert.deepEqual(plain(calls), [], 'locked gallery item reached the bridge');
});

/* The standard menus with galleries in the stock shape in the editor: gallery submenus at borders and
   conditional formatting, the tab color in "Format cells", the sheet views inner menu,
   the print scale counter, "Symbol" with a recent gallery. */
function galleryPresets(doc, log) {
    const gal = n => menu(Array.from({length: n}, () => item(undefined)));
    const borders = menu(['Bottom', 'Top', item('--'), item('Border style', {menu: gal(3)}),
        item('Border color', {menu: menu([item('Automatic'), item('--'), item(undefined), item('--'), item(undefined)])}),
        item('More borders', {value: 'options'})]);
    const cond = menu([item('Value is', {menu: menu(['Greater', 'Less'])}), item('--'), item('Data bars', {menu: gal(1)}),
        item('Color scales', {menu: gal(1)}), item('Icon sets', {menu: gal(1)}), item('--'), item('New rule', {value: 'new'}),
        item('Manage rules', {value: 'manage'})]);
    const format = menu([item('Row height'), item('--'), item('Tab color', {menu: menu([item(undefined), item('--'), item(undefined)])}),
        item('Format cells')]);
    const scaleEl = new El('div', doc);
    scaleEl.className = 'custom-scale';
    const part = (tag, cls, text) => { const n = scaleEl.appendChild(new El(tag, doc)); n.className = cls; if (text) n.textContent = text; return n; };
    part('label', 'title', 'Scale');
    const up = part('button', 'btn updown-picker-button-up');
    const value = part('label', 'updown-picker-value', '100%');
    const down = part('button', 'btn updown-picker-button-down');
    up.addEventListener('click', () => { log.push('scale up'); value.textContent = '105%'; });
    down.addEventListener('click', () => { log.push('scale down'); value.textContent = '100%'; });
    const scaleItem = item(undefined);
    scaleItem.cmpEl = [scaleEl];
    const scale = menu([item('Width', {menu: menu(['Auto', '1 page'])}), scaleItem, item('--'), item('Custom')]);
    const inner = menu([item('Default', {checkable: true, checked: true}), item('View 1', {checkable: true})]);
    inner.on('item:click', (m, it) => log.push('pick ViewTab:btnSheetView ' + it.caption));
    const views = menu([item(undefined), item('--'), item('Manager')]);
    views.options = {innerMenus: [{menu: inner, index: 0}]};
    const symbol = menu([item(undefined), item('--'), item('More symbols')]);
    symbol.on('item:click', (m, it) => log.push('pick Toolbar:btnInsertSymbol ' + it.caption));
    return {
        toolbar: {btnBorders: button('Toolbar:btnBorders', log, {menu: borders}), btnCondFormat: button('Toolbar:btnCondFormat', log, {menu: cond}),
                  btnFormatCell: button('Toolbar:btnFormatCell', log, {menu: format}), btnScale: button('Toolbar:btnScale', log, {menu: scale}),
                  btnInsertSymbol: button('Toolbar:btnInsertSymbol', log, {menu: symbol})},
        viewTab: {btnSheetView: button('ViewTab:btnSheetView', log, {menu: views})},
        /* "View → Hidden sheets ▸": the workbook has a hidden sheet - the tab submenu is not empty (the stock hides an empty one, and the
           item is inactive - the mirror is not read). */
        statusbar: {tabMenu: tabMenu(log, [['Hidden 1', 1]])},
        scale: {up, down, value}
    };
}

test('gaps_empty_after_gallery_phase', () => {
    const env = makeEnv({presets: galleryPresets});
    env.create();
    env.B.gaps.length = 0;
    const subs = [].concat(...env.A.groups().map(g => g.items)).filter(i => i.sub);
    subs.forEach(it => env.B.mirror(it.twin));
    /* "Symbol" - a choice of a standard menu item next to the recent gallery: the menu is prepared,
       the gallery is not read and does not go into gaps. */
    const sym = env.group('Insert').items.find(i => i.k === 'symbol');
    assert.equal(env.A.exec(sym, env.shell), true);
    assert.ok(env.log.includes('pick Toolbar:btnInsertSymbol More symbols'), 'symbol dialog through the stock item');
    assert.deepEqual(plain(env.B.gaps), [], 'nothing skipped after the gallery phase');
    const rowsOf = ref => plain(env.B.mirror(ref).filter(e => !e.sep)
        .map(e => e.caption + (e.gallery ? ' [gallery]' : e.stepper ? ' [stepper ' + e.value + ']' : '')));
    assert.deepEqual(rowsOf('Toolbar:btnBorders'), ['Bottom', 'Top', 'Border style [gallery]', 'Border color [gallery]', 'More borders']);
    assert.deepEqual(rowsOf('Toolbar:btnCondFormat'), ['Value is', 'Data bars [gallery]', 'Color scales [gallery]', 'Icon sets [gallery]',
        'New rule', 'Manage rules']);
    assert.deepEqual(rowsOf('Toolbar:btnFormatCell'), ['Row height', 'Tab color [gallery]', 'Format cells']);
    assert.deepEqual(rowsOf('Toolbar:btnScale'), ['Width', 'Scale [stepper 100%]', 'Custom']);
    assert.deepEqual(rowsOf('ViewTab:btnSheetView'), ['Default', 'View 1', 'Manager']);
    assert.deepEqual(plain(env.B.gaps), []);
});

/* Galleries inside menu row submenus: a gallery row opens the standard gallery submenu
   by the item address (itemRef), an inner menu row is chosen with a standard click,
   a counter row steps with the standard counter buttons, the menu stays alive. */
test('gallery_rows_and_stepper_inside_submenus', () => {
    const env = makeEnv({presets: galleryPresets});
    /* "Print scale ▸" is no longer in "File" (it is in the print window), but the counter row
       of the standard menu remains the mechanics of the bridge and the menu row - it is checked on a case item with the same standard menu. */
    withMirrorItem(env, {k: 'tstScale', t: 'Scale to fit', twin: 'Toolbar:btnScale', sub: true});
    env.create();
    const g = stubGallery(env);
    env.sectionBtn('Format').click();
    env.row('borders').click();
    const rows = env.flyRows();
    const style = rows.find(r => r.querySelector('.vo-mn-t').textContent === 'Border style');
    assert.ok(style.classList.contains('vo-has-sub'), 'gallery row has ▸');
    style.click();
    const p = g.pops().pop();
    assert.deepEqual([p.ref, p.anchor === style, p.align], ['Toolbar:btnBorders.menu.items.3', true, 'tl-tr'], 'stock submenu gallery at the row');
    assert.equal(env.flyRows().length, rows.length, 'the submenu stays open');
    assert.deepEqual(plain(env.log.filter(l => /^pick /.test(l))), [], 'no stock command on opening');
    /* Hovering a neighboring row of the same submenu closes the gallery, the submenu stays alive. */
    rows[0].dispatch('mouseenter');
    env.flush();
    assert.equal(env.B.popupOpen(), false);
    assert.equal(env.flyRows().length, rows.length);
    /* Hovering a section row closes both the submenu and the gallery. */
    style.click();
    env.row('merge').dispatch('mouseenter');
    env.flush();
    assert.equal(env.B.popupOpen(), false, 'hover on the section closes deeper layers');
    env.shell.closeSurfaces();
    /* Sheet views: inner menu rows, the choice is a standard row click. In "View"
       they are stock menu rows in place in "Views ▸" (in the "Named views" group), followed by "New
       view". */
    env.sectionBtn('View').click();
    env.row('views').click();
    const views = env.doc.querySelectorAll('#vo-shell .vo-mn-fly .vo-mn-sub');
    assert.deepEqual(plain(views.map(r => [r.querySelector('.vo-mn-t').textContent, r.getAttribute('aria-checked') === 'true'])),
        [['Default', true], ['View 1', false], ['Manager', false], ['Create view', false]]);
    views[1].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick /.test(l))), ['pick ViewTab:btnSheetView View 1'], 'inner row through the stock item, once');
    assert.equal(env.shell.hasOpenSurfaces(), false);
    /* Print scale: a counter row - the caption and the stock value, a step is the standard button. */
    env.sectionBtn('View').click();
    env.row('tstScale').click();
    const step = env.doc.querySelector('#vo-shell .vo-mn-fly .vo-mn-step');
    assert.ok(step, 'stepper row in the submenu');
    assert.equal(step.querySelector('.vo-mn-t').textContent, 'Scale');
    assert.equal(step.querySelector('.vo-mn-step-v').textContent, '100%');
    const [dec, inc] = step.querySelectorAll('.vo-mn-step-btn');
    assert.ok(dec.getAttribute('aria-label') && inc.getAttribute('aria-label'), 'step buttons are named for the screen reader');
    inc.click();
    assert.equal(step.querySelector('.vo-mn-step-v').textContent, '105%', 'value read back from the stock');
    dec.click();
    assert.deepEqual(plain(env.log.filter(l => /^scale /.test(l))), ['scale up', 'scale down'], 'one stock button click per step');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'stepping keeps the menu open');
    assert.ok(env.doc.querySelector('#vo-shell .vo-mn-fly .vo-mn-step'), 'and the submenu');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* --- Composite submenus ----------------------------------------------------------------------------------------
   A submenu can be its own: a catalog composite item {k, t, items}, the children are ordinary catalog items
   (double, run, check, sc, when, lockLike, edit), group headers {head} through a separator and stock
   menu rows in place {mirror}. Catalog items with such submenus are checked at their sections;
   here is a case item at the end of "View". A menu row with only a mirror fails these cases. */
/* A case item with a double mirror submenu at the end of "View" - for the menu row mechanics that "File" no longer holds
   ("Page size ▸" and "Print scale ▸" are in the print window). */
function withMirrorItem(env, it) {
    const A = env.A, orig = A.catalog;
    A.catalog = function () { const c = orig.call(this); c[2].items.push({sep: true}, it); return c; };
    return it;
}
function withHolder(env, items, opt = {}) {
    const A = env.A, orig = A.catalog;
    const holder = Object.assign({k: 'tstHolder', t: 'Holder', i: 'layers', items}, opt);
    A.catalog = function () { const c = orig.call(this); c[2].items.push({sep: true}, holder); return c; };
    return holder;
}
const KIDS = log => [
    {head: 'Group one'},
    {k: 'kidA', t: 'Kid A', twin: 'DataTab:btnKidA', sc: 'KidA'},
    {k: 'kidB', t: 'Kid B', twin: 'ViewTab:btnKidB', check: true},
    {k: 'kidR', t: 'Kid R', run: () => log.push('run kidR')},
    {sep: true},
    {head: 'Empty group'},
    {k: 'kidNo', t: 'Never', twin: 'DataTab:btnKidNo', when: () => false},
    {sep: true},
    {head: 'Stock rows'},
    {mirror: 'Toolbar:btnKidMenu'},
    {k: 'kidRadio', t: 'Kid radio', twin: 'Toolbar:btnKidRadio', check: 'radio'},
    {sep: true}
];
const kidKeys = list => Array.from(list, i => i.sep ? '--' : i.head != null ? '#' + i.head : i.mirror ? 'mirror ' + i.mirror : i.k);
/* The layer of a level level submenu and its rows - inside groups too. */
const flyOf = (env, level = 1) => env.doc.querySelectorAll('#vo-shell .vo-mn-fly').find(f => f.getAttribute('data-level') === String(level)) || null;
const ownRows = (env, level = 1) => { const f = flyOf(env, level); return f ? f.querySelectorAll('.vo-mn-sub') : []; };
const rowText = r => r.querySelector('.vo-mn-t').textContent;

test('own_submenu_from_catalog', () => {
    const env = makeEnv({shortcuts: {KidA: ['Ctrl', 'K']}});
    const holder = withHolder(env, KIDS(env.log));
    checkCatalog(env.A.catalog());
    env.create();
    /* Filtering children by the same rule 1: a group without items goes along with its header,
       separators do not dangle. */
    const view = env.group('View');
    assert.deepEqual(plain(env.keys(view).slice(-2)), ['--', 'tstHolder'], 'the composite item is in the section');
    const offered = view.items[view.items.length - 1];
    assert.deepEqual(kidKeys(offered.items), ['#Group one', 'kidA', 'kidB', 'kidR', '--', '#Stock rows', 'mirror Toolbar:btnKidMenu', 'kidRadio'],
        'children offered now: a header without items and its separator are gone');
    assert.equal(holder.items.length, 12, 'the catalog itself is not changed by the filter');
    /* The holder row is an item with ▸ in the section; a click is a layer with the child rows. */
    env.sectionBtn('View').click();
    const row = env.row('tstHolder');
    assert.ok(row.classList.contains('vo-has-sub') && row.getAttribute('aria-haspopup') === 'menu', 'the holder row is not a submenu opener');
    assert.equal(row.getAttribute('role'), 'menuitem');
    row.click();
    const fly = flyOf(env);
    assert.ok(fly, 'no submenu layer');
    assert.deepEqual([fly.getAttribute('role'), fly.getAttribute('aria-label')], ['menu', 'Holder'], 'the layer is a menu named by its item');
    assert.equal(row.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(plain(fly.children.map(c => c.getAttribute('role') + (c.getAttribute('aria-label') ? ' ' + c.getAttribute('aria-label') : ''))),
        ['group Group one', 'separator', 'group Stock rows'], 'groups with headers, through a separator');
    assert.deepEqual(plain(ownRows(env).map(rowText)), ['Kid A', 'Kid B', 'Kid R', 'First btnKidMenu', 'Second btnKidMenu', 'Kid radio'],
        'rows: own items, then the stock menu rows in place');
    assert.deepEqual(plain(ownRows(env).map(r => r.getAttribute('data-level'))), ['1', '1', '1', '1', '1', '1']);
    /* The keyboard shortcut on the right - for a composite submenu item too. */
    const a = env.row('kidA');
    assert.equal((a.querySelector('.vo-mn-h') || {}).textContent, 'Ctrl+K', 'the shortcut of a child item is not shown on the right');
    a.click();
    assert.deepEqual(plain(env.log.filter(l => /KidA|kidR|KidMenu/.test(l))), ['click DataTab:btnKidA'], 'one stock call of the child twin');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the command closes the menu');
    env.sectionBtn('View').click();
    env.row('tstHolder').click();
    env.row('kidR').click();
    assert.ok(env.log.includes('run kidR'), 'a child without a twin runs its own command');
    env.sectionBtn('View').click();
    env.row('tstHolder').click();
    ownRows(env).find(r => rowText(r) === 'First btnKidMenu').click();
    assert.ok(env.log.includes('pick Toolbar:btnKidMenu First btnKidMenu'), 'a stock row in place is picked by its stock item');
    /* A holder is not a command; children are found by key; a child without a right is not offered. */
    assert.equal(env.A.exec(env.A.item('tstHolder')), false, 'the holder ran a command');
    assert.equal(env.A.item('kidA').k, 'kidA', 'a child is not found by its key');
    assert.equal(env.A.offered('kidNo'), null, 'a child without the right is offered');
    assert.equal(env.A.offered('kidB').k, 'kidB');
    /* The coverage check: a child address is "menu <section> > <holder> > <child>", rows in place - the holder. */
    const book = env.A.addressBook();
    assert.deepEqual(plain(book['DataTab:btnKidA']), ['menu view > tstHolder > kidA']);
    assert.deepEqual(plain(book['Toolbar:btnKidMenu']), ['menu view > tstHolder']);
    /* There is not a single child - there is no holder either. */
    const none = makeEnv();
    withHolder(none, [{head: 'Only'}, {k: 'gone', t: 'Gone', twin: 'DataTab:btnGone', when: () => false}]);
    assert.ok(!none.keys(none.group('View')).includes('tstHolder'), 'an empty composite item is drawn');
    /* The last "View" item is "Macros ▸". */
    assert.equal(none.keys(none.group('View')).slice(-1)[0], 'macrosMenu', 'its separator stayed behind');
    assert.equal(env.warnings.length + none.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* The holder is disabled when all its visible children are disabled; the reason is the first one's. */
test('holder_off_when_all_children_off', () => {
    const env = makeEnv();
    withHolder(env, [
        {k: 'offA', t: 'Off A', twin: 'DataTab:btnOffA'},
        {k: 'offB', t: 'Off B', twin: 'DataTab:btnOffB'},
        {mirror: 'Toolbar:btnOffMenu'},
        {k: 'offHidden', t: 'Hidden', twin: 'DataTab:btnOffHidden', when: () => false}
    ]);
    env.create();
    const holder = () => env.A.offered('tstHolder');
    const st = () => plain(env.A.itemState(holder()));
    assert.deepEqual(st(), {disabled: false, reason: null, checked: false}, 'all children live');
    const A = env.roots.DataTab.btnOffA, Bt = env.roots.DataTab.btnOffB, M = env.roots.Toolbar.btnOffMenu;
    /* A hidden child (without a right) does not keep the holder alive - it is not visible either. */
    env.roots.DataTab.btnOffHidden.setDisabled(false);
    A.setDisabled(true); A.keepState = ['cell-editing'];
    Bt.setDisabled(true); Bt.keepState = ['cell-editing'];
    assert.equal(env.A.itemState(holder()).disabled, false, 'stock rows in place are still live');
    M.setDisabled(true); M.keepState = ['cell-editing'];
    assert.deepEqual(st(), {disabled: true, reason: env.A.textEditing, checked: false}, 'every child is off: the holder is off with the reason');
    /* The reason is that of the first visible child, not any. */
    A.keepState = [];
    assert.deepEqual(st(), plain(Object.assign(env.A.itemState(env.A.item('offA')), {checked: false})), 'the reason is not the first child’s');
    A.keepState = ['cell-editing'];
    /* A disabled holder - the item is inactive: the submenu does not open, the reason is in the hint. */
    env.sectionBtn('View').click();
    const row = env.row('tstHolder');
    assert.ok(row.classList.contains('vo-locked') && row.getAttribute('aria-disabled') === 'true', 'the holder row is not inactive');
    assert.equal(row.getAttribute('title'), env.A.textEditing);
    row.click();
    assert.equal(flyOf(env), null, 'an inactive holder opened its submenu');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'a click on the inactive holder closed the menu');
    /* One child came alive - the holder is alive. */
    Bt.setDisabled(false);
    assert.equal(env.A.itemState(holder()).disabled, false, 'one live child keeps the holder live');
    /* An edit child - by the engine verdict (as for the "View" items). */
    const ed = makeEnv();
    withHolder(ed, [{k: 'edA', t: 'Edit A', twin: 'DataTab:btnEdA', edit: true}, {k: 'edB', t: 'Edit B', twin: 'DataTab:btnEdB', edit: true}]);
    ed.api.canEdit = () => false;
    assert.equal(ed.A.itemState(ed.A.offered('tstHolder')).disabled, true, 'children the engine refuses keep the holder live');
    ed.api.canEdit = () => true;
    assert.equal(ed.A.itemState(ed.A.offered('tstHolder')).disabled, false);
});

/* A group header is not an item: not a button, without an item role and without focus; for the screen reader the group
   is named by the header (role=group, aria-label), the header itself is removed from the accessibility tree. */
test('head_rows_are_not_items', () => {
    const env = makeEnv();
    withHolder(env, KIDS(env.log));
    env.create();
    env.sectionBtn('View').click();
    env.row('tstHolder').click();
    const fly = flyOf(env);
    /* The group header of the shared menu row is a visible name in the group container (vo-mn-grp-t). */
    const heads = fly.querySelectorAll('.vo-mn-grp-t');
    assert.deepEqual(plain(heads.map(h => h.textContent)), ['Group one', 'Stock rows']);
    heads.forEach(h => {
        assert.notEqual(h.tagName, 'BUTTON', 'a header is a button');
        assert.equal(h.getAttribute('role'), null, 'a header has a menu role');
        assert.equal(h.getAttribute('tabindex'), null, 'a header is focusable');
        assert.equal(h.getAttribute('aria-hidden'), 'true', 'a header is read twice (its group is named by it)');
        assert.equal(h.parentNode.getAttribute('role'), 'group');
        assert.equal(h.parentNode.getAttribute('aria-label'), h.textContent, 'the group is not named by its header');
        assert.equal(h.parentNode.children[0], h, 'the header is not the first row of its group');
    });
    /* The layer buttons are only items: headers do not get into the arrow walk (menuItems takes buttons). */
    assert.deepEqual(plain(fly.querySelectorAll('button').map(rowText)), plain(ownRows(env).map(rowText)), 'buttons of the layer are not exactly its items');
    assert.equal(fly.querySelectorAll('button').length, 6);
    /* A click on a header does nothing and does not close the menu. */
    const before = env.log.length;
    heads[0].click();
    assert.equal(env.log.length, before, 'a header ran something');
    assert.ok(flyOf(env), 'a click on a header closed the submenu');
    /* A group without a header (before the first header) - rows right in the layer. */
    const flat = makeEnv();
    withHolder(flat, [{k: 'flatA', t: 'Flat A', twin: 'DataTab:btnFlatA'}, {sep: true}, {head: 'Tail'}, {k: 'flatB', t: 'Flat B', twin: 'DataTab:btnFlatB'}]);
    flat.create();
    flat.sectionBtn('View').click();
    flat.row('tstHolder').click();
    assert.deepEqual(plain(flyOf(flat).children.map(c => c.getAttribute('role') || c.className)),
        ['menuitem', 'separator', 'group'], 'rows before the first header are not plain rows of the layer');
});

/* The children are executed and marked each by its own path: a double, run, mirror rows - choosing a standard
   menu item; a toggle - a checkbox or radio by the pressed state of its double; a disabled
   child is inactive and does not close the menu; edit and lockLike - as for the section items. */
test('children_run_and_check_their_own_way', () => {
    const env = makeEnv();
    withHolder(env, KIDS(env.log).concat([
        {k: 'kidEdit', t: 'Kid edit', twin: 'DataTab:btnKidEdit', edit: true},
        {k: 'kidLock', t: 'Kid lock', run: () => env.log.push('run kidLock'), lockLike: 'DataTab:btnKidLockSrc'}
    ]));
    env.create();
    const open = () => { env.shell.closeSurfaces(); env.sectionBtn('View').click(); env.row('tstHolder').click(); };
    const role = k => { const r = env.row(k); return [r.getAttribute('role'), r.getAttribute('aria-checked'), !!r.querySelector('.vo-mn-chk')]; };
    open();
    assert.deepEqual(role('kidB'), ['menuitemcheckbox', 'false', false], 'a released child toggle');
    assert.deepEqual(role('kidRadio'), ['menuitemradio', 'false', false], 'a child of a one-choice group');
    assert.deepEqual(role('kidA').slice(0, 2), ['menuitem', null], 'a plain child');
    env.roots.ViewTab.btnKidB.pressed = true;
    env.roots.Toolbar.btnKidRadio.pressed = true;
    open();
    assert.deepEqual(role('kidB'), ['menuitemcheckbox', 'true', true], 'the check mark is not the twin’s state');
    assert.deepEqual(role('kidRadio'), ['menuitemradio', 'true', true]);
    env.row('kidB').click();
    assert.equal(env.log.filter(l => l === 'click ViewTab:btnKidB').length, 1, 'the toggle is not its twin’s click');
    /* edit - the engine without editing: the child is inactive, the others are alive. */
    env.api.canEdit = () => false;
    open();
    assert.equal(env.row('kidEdit').getAttribute('aria-disabled'), 'true', 'an edit child is live while the engine refuses editing');
    env.row('kidEdit').click();
    assert.ok(!env.log.includes('click DataTab:btnKidEdit'), 'the engine-refused child ran');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'an inactive child closed the menu');
    delete env.api.canEdit;
    /* lockLike is the source of availability of a command without a double. */
    env.roots.DataTab.btnKidLockSrc.setDisabled(true);
    open();
    assert.equal(env.row('kidLock').getAttribute('aria-disabled'), 'true', 'lockLike is not read for a child');
    env.row('kidLock').click();
    assert.ok(!env.log.includes('run kidLock'), 'a locked child ran its command');
    env.roots.DataTab.btnKidLockSrc.setDisabled(false);
    open();
    env.row('kidLock').click();
    assert.ok(env.log.includes('run kidLock'));
    /* Rows in place - the mirror root is disabled: the row is not chosen. */
    open();
    env.roots.Toolbar.btnKidMenu.setDisabled(true);
    ownRows(env).find(r => rowText(r) === 'Second btnKidMenu').click();
    assert.ok(!env.log.some(l => /^pick Toolbar:btnKidMenu/.test(l)), 'a stock row was picked under a locked twin');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* A recalculation by restriction (the menu row refresh): the rows of an open composite submenu are re-read together with
   the section rows - availability, reason, checkmark; rows in place go disabled together with their root and
   with a live root return to the snapshot; the holder went disabled - its layer is closed. */
/* Re-reading the menu row (the start and end of a cell edit, restrictions) is one snapshot of all sections: the catalog is collected for it
   once, both with the menu closed and open. The snapshot is the same as on a fresh read: the rows of an open section after
   re-reading are the same as for this section opened anew, and follow the stock from one re-read to the next. */
test('menu_refresh_builds_the_catalog_once', () => {
    const env = makeEnv();
    env.create();
    const A = env.A, catalog = A.catalog;
    let built = 0;
    A.catalog = function () { built++; return catalog.apply(this, arguments); };
    try {
        env.relock();
        assert.equal(built, 1, 'catalog builds for one refresh of a closed menu');
        const shown = () => plain(env.doc.querySelectorAll('#vo-shell .vo-mn-item[data-k]')
            .map(b => b.getAttribute('data-k') + ':' + (b.parentNode.style.display === 'none' ? 'off' : 'on')));
        const before = shown();
        env.sectionBtn('Insert').click();
        const rows = () => plain(env.doc.querySelectorAll('#vo-shell .vo-mn-drop.open [data-k]')
            .map(r => [r.getAttribute('data-k'), r.getAttribute('aria-disabled'), r.getAttribute('title')].join(' ')));
        const chart = env.roots.Toolbar.btnInsertChart;
        chart.setDisabled(true);
        built = 0;
        env.relock();
        assert.equal(built, 1, 'catalog builds for one refresh of an open menu');
        const relocked = rows();
        assert.ok(relocked.some(r => /^chart true /.test(r)), 'the refresh did not follow the stock: ' + relocked.join(' | '));
        env.shell.menu.close();
        env.sectionBtn('Insert').click();
        assert.deepEqual(rows(), relocked, 'rows after a refresh differ from a fresh reading');
        chart.setDisabled(false);
        env.relock();
        assert.ok(rows().some(r => /^chart false/.test(r)), 'the next refresh reused the former reading');
        assert.deepEqual(shown(), before, 'sections of the menu bar');
    } finally {
        A.catalog = catalog;
    }
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

test('relock_children_of_open_layer', () => {
    const env = makeEnv();
    withHolder(env, KIDS(env.log));
    env.roots.Toolbar.btnKidMenu.menu.items[1].setDisabled(true);
    env.create();
    env.sectionBtn('View').click();
    env.row('tstHolder').click();
    const a = env.row('kidA');
    assert.equal(a.getAttribute('aria-disabled'), 'false', 'precondition');
    const twinA = env.roots.DataTab.btnKidA;
    twinA.setDisabled(true);
    twinA.keepState = ['cell-editing'];
    env.relock();
    assert.equal(a.getAttribute('aria-disabled'), 'true', 'a child of the open layer is not re-read');
    assert.equal(a.getAttribute('title'), env.A.textEditing, 'and its reason');
    env.roots.ViewTab.btnKidB.pressed = true;
    env.relock();
    assert.equal(env.row('kidB').getAttribute('aria-checked'), 'true', 'the check of a child is not re-read');
    const stock = () => plain(ownRows(env).filter(r => /btnKidMenu/.test(rowText(r))).map(r => r.getAttribute('aria-disabled')));
    assert.deepEqual(stock(), ['false', 'true'], 'precondition: the snapshot of the stock rows');
    env.roots.Toolbar.btnKidMenu.setDisabled(true);
    env.relock();
    assert.deepEqual(stock(), ['true', 'true'], 'stock rows in place are live under a locked twin');
    env.roots.Toolbar.btnKidMenu.setDisabled(false);
    env.relock();
    assert.deepEqual(stock(), ['false', 'true'], 'stock rows did not return to the snapshot');
    /* All children went disabled - the holder is inactive, its layer is closed; the section is open. */
    ['ViewTab:btnKidB', 'Toolbar:btnKidMenu', 'Toolbar:btnKidRadio'].forEach(ref => {
        const [root, name] = ref.split(':');
        env.roots[root][name].setDisabled(true);
    });
    env.log.push('mark');
    const runKid = env.A.item('kidR');
    runKid.lockLike = 'DataTab:btnKidRSrc';                     // and for a run child the source of availability went off
    env.roots.DataTab.btnKidRSrc.setDisabled(true);
    env.relock();
    assert.equal(env.row('tstHolder').getAttribute('aria-disabled'), 'true', 'the holder row is not re-read');
    assert.equal(flyOf(env), null, 'the layer of a holder that went off stayed open');
    assert.equal(env.shell.hasOpenSurfaces(), true, 'the section closed');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* A standard menu item by value ("Clear format" is the item
   "Formatting" of the "Clear" button by Asc.c_oAscCleanOptions.Format; the children of "Clear ▸"):
   the caption is the standard item's if there is no own one (one command - one name); available when both the
   button and the item are available (items have their own locks: a cell edit disables the "Clear" items, not the button -
   so in the stock), the reason is by the item lock; the checkmark is from the item; if the stock has no item - neither do we
   (the stock conditions); a choice is a standard item click after the menu preparation. */
const CLEAR = {All: 0, Text: 1, Format: 2};
const clearPresets = (doc, log) => {
    const m = menu([item('All', {value: CLEAR.All}), item('Text', {value: CLEAR.Text}), item('Format', {value: CLEAR.Format, checkable: true})]);
    m.on('item:click', (mm, it) => log.push('pick Toolbar:btnKidClear ' + it.caption));
    m.on('show:before', () => log.push('prepare Toolbar:btnKidClear'));
    return {toolbar: {btnKidClear: button('Toolbar:btnKidClear', log, {menu: m})}};
};
test('pick_child_by_value', () => {
    const env = makeEnv({presets: clearPresets});
    let fmt = CLEAR.Format;
    withHolder(env, [
        {k: 'kidFormat', twin: 'Toolbar:btnKidClear', pick: {value: () => fmt}, check: true},
        {k: 'kidText', t: 'Own label', twin: 'Toolbar:btnKidClear', pick: {value: CLEAR.Text}},
        {k: 'kidNone', twin: 'Toolbar:btnKidClear', pick: {value: 9}}
    ]);
    checkCatalog(env.A.catalog());
    env.create();
    const btn = env.roots.Toolbar.btnKidClear, fmtItem = btn.menu.items[2];
    assert.deepEqual(kidKeys(env.A.offered('tstHolder').items), ['kidFormat', 'kidText'], 'a child whose stock item the stock did not build is offered');
    assert.equal(env.A.label(env.A.item('kidFormat')), 'Format', 'a child without a label does not take the stock caption');
    assert.equal(env.A.label(env.A.item('kidText')), 'Own label', 'an own label lost to the stock caption');
    const st = k => plain(env.A.itemState(env.A.item(k)));
    assert.deepEqual(st('kidFormat'), {disabled: false, reason: null, checked: false});
    /* The item is disabled by its own lock (a cell edit), the button is alive - the item is inactive with a reason. */
    fmtItem.setDisabled(true);
    fmtItem.keepState = ['cell-editing'];
    assert.deepEqual(st('kidFormat'), {disabled: true, reason: env.A.textEditing, checked: false}, 'the lock of the stock item is not read');
    assert.equal(st('kidText').disabled, false, 'another item of the same button went off');
    fmtItem.setDisabled(false);
    fmtItem.keepState = [];
    /* The button is disabled - all its items are disabled. */
    btn.setDisabled(true);
    btn.keepState = ['worksheet-lock'];
    env.api.protectedSheet = true;
    assert.deepEqual(st('kidText'), {disabled: true, reason: env.A.textProtected, checked: false}, 'a child is live under a locked button');
    btn.setDisabled(false);
    btn.keepState = [];
    /* The checkmark is from the item, not from the button. */
    fmtItem.checked = true;
    btn.pressed = false;
    assert.equal(st('kidFormat').checked, true, 'the check is not the stock item’s');
    fmtItem.checked = false;
    /* A row and a choice: the stock caption in the row, a click - the menu preparation and a standard item click, one. */
    env.sectionBtn('View').click();
    env.row('tstHolder').click();
    const row = env.row('kidFormat');
    assert.equal(rowText(row), 'Format', 'the row has no stock caption');
    assert.equal(row.getAttribute('role'), 'menuitemcheckbox');
    env.log.length = 0;
    row.click();
    assert.deepEqual(plain(env.log.filter(l => /btnKidClear/.test(l))), ['prepare Toolbar:btnKidClear', 'pick Toolbar:btnKidClear Format'],
        'the stock item is not picked by its value once, after the stock preparation');
    /* The value is read at call time. */
    fmt = CLEAR.All;
    assert.equal(env.A.label(env.A.item('kidFormat')), 'All', 'the value of the pick is cached');
    /* There is no item by value - there is no command; a refusal without a call. */
    assert.deepEqual(st('kidNone'), {disabled: true, reason: null, checked: false}, 'a child without its stock item is live');
    assert.equal(env.A.exec(env.A.item('kidNone')), false);
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* --- "Collaboration" and "Help" ---------- */

test('protection_submenu_includes_the_stock_protection_flags', () => {
    for (const options of [{}, {isPasswordSupport: true, isSignatureSupport: true}, {isPasswordSupport: false, isSignatureSupport: true}]) {
        const env = makeEnv({options});
        env.create();
        checkCatalog(env.A.catalog());
        const collab = env.group('Collaboration');
        const holder = collab.items.find(i => i.k === 'protect');
        assert.ok(holder, 'no «Protection ▸» in Collaboration: ' + env.keys(collab).join(' '));
        assert.equal(env.keys(collab).slice(-2).join(' '), '-- protect', '«Protection ▸» is not the last group of Collaboration');
        assert.deepEqual(kidKeys(holder.items), ['protectWorkbook', 'protectSheet', 'allowRanges', 'protectRange', '--',
            'hiddenFormula', 'lockedShape', 'lockedText'], 'Protection commands with ' + JSON.stringify(options));
        assert.ok(!deepKeys(env).includes('protectPassword'), 'the password is offered with ' + JSON.stringify(options));
    }
    const env = makeEnv();
    env.create();
    const holder = env.A.offered('protect');
    assert.equal(holder.t, env.A.textProtection);
    assert.equal(env.A.textProtection, 'Protection', 'the default of «Protection»');
    assert.ok(!holder.twin && !holder.run && !holder.sub, '«Protection ▸» is a composite item, not a command');
    assert.equal(env.A.item('protectPassword') === null, true, 'the password item is still in the catalog');
    assert.ok(!('textProtectPassword' in env.A), 'the default of «Protect with password» is left');
    env.sectionBtn('Collaboration').click();
    const row = env.row('protect');
    assert.ok(row && row.classList.contains('vo-has-sub'), '«Protection ▸» row is not a submenu opener');
    assert.equal(rowText(row), 'Protection');
    row.click();
    const fly = flyOf(env);
    assert.ok(fly, 'no «Protection ▸» layer');
    assert.equal(fly.getAttribute('aria-label'), 'Protection', 'the layer is not named by its item');
    assert.deepEqual(plain(fly.children.map(c => c.classList.contains('vo-mn-sep') || c.getAttribute('role') === 'separator' ? '--' : rowText(c))),
        ['Protect workbook', 'Protect sheet', 'Allow edit ranges', 'Protect range', '--',
            'Hidden Formulas', 'Shape Locked', 'Lock Text'], 'rows of «Protection ▸»');
    assert.deepEqual(plain(['protectWorkbook', 'protectSheet', 'allowRanges', 'protectRange'].map(k => env.row(k).getAttribute('role'))),
        ['menuitemcheckbox', 'menuitemcheckbox', 'menuitem', 'menuitem'], 'workbook and sheet protection are toggles');
    /* The command is the standard click of the "Protection" tab button; the standard file menu password panel does not open. */
    env.row('protectRange').click();
    assert.deepEqual(plain(env.log.filter(l => /WBProtection/.test(l))), ['click WBProtection:btnProtectRange'], 'one stock click of the twin');
    assert.deepEqual(plain(env.log.filter(l => /^showMenu file:protect/.test(l))), [], 'the stock password panel is opened from the menu');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

test('protection_flags_use_the_stock_checkbox_state_and_handler', () => {
    const env = makeEnv();
    env.create();
    env.roots.WBProtection.chLockedShape.checked = true;
    env.roots.WBProtection.chLockedText.setDisabled(true);
    env.sectionBtn('Collaboration').click();
    env.row('protect').click();
    assert.equal(env.row('lockedShape').getAttribute('aria-checked'), 'true');
    assert.equal(env.row('lockedText').getAttribute('aria-disabled'), 'true');
    env.row('hiddenFormula').click();
    assert.equal(env.roots.WBProtection.chHiddenFormula.isChecked(), true);
    assert.deepEqual(env.log.filter(line => line.startsWith('check WBProtection:')), ['check WBProtection:chHiddenFormula true']);
});

test('mixed_object_protection_is_announced_before_clearing_it', () => {
    const env = makeEnv();
    env.create();
    const shape = env.roots.WBProtection.chLockedShape;
    shape.indeterminate = true;
    shape.onItemCheck = function () {
        assert.equal(this.indeterminate, true);
        this.indeterminate = false;
        this.setValue(false);
    };
    const openProtection = () => {
        env.sectionBtn('Collaboration').click();
        env.row('protect').click();
        return env.row('lockedShape');
    };
    const mixed = openProtection();
    assert.equal(mixed.getAttribute('aria-checked'), 'mixed');
    assert.equal(mixed.querySelector('.vo-mn-chk').textContent, '−');
    mixed.click();
    assert.equal(shape.indeterminate, false);
    assert.equal(openProtection().getAttribute('aria-checked'), 'false');
});

test('layout_can_hide_the_stock_protection_flags', () => {
    const env = makeEnv({hiddenLayout: ['toolbar-protect']});
    env.create();
    assert.equal(env.A.offered('lockedShape'), null);
    assert.equal(env.A.offered('lockedText'), null);
    assert.equal(env.A.offered('hiddenFormula'), null);
});

/* "Protect workbook" and "Protect sheet" have a checkmark for enabled protection, by the pressed state of the standard buttons
   of the "Protection" tab (a protected sheet - ✓ on "Protect sheet"); after protection is removed there is no checkmark. */
test('protect_checks_by_twins', () => {
    const env = makeEnv();
    env.create();
    const sheet = env.roots.WBProtection.btnProtectSheet, wb = env.roots.WBProtection.btnProtectWB;
    sheet.pressed = true;
    wb.pressed = false;
    const st = k => plain(env.A.itemState(env.A.item(k)));
    assert.equal(st('protectSheet').checked, true, 'the protected sheet has no check');
    assert.equal(st('protectWorkbook').checked, false, 'the unprotected workbook has a check');
    env.sectionBtn('Collaboration').click();
    env.row('protect').click();
    assert.deepEqual(plain(['protectWorkbook', 'protectSheet'].map(k => env.row(k).getAttribute('aria-checked'))), ['false', 'true'],
        'the checks of the rows do not follow the stock buttons');
    env.shell.closeSurfaces();
    sheet.pressed = false;
    wb.pressed = true;
    env.sectionBtn('Collaboration').click();
    env.row('protect').click();
    assert.deepEqual(plain(['protectWorkbook', 'protectSheet'].map(k => env.row(k).getAttribute('aria-checked'))), ['true', 'false'],
        'after the change the checks are stale');
});

/* "Protection ▸" in "Viewing" is unavailable - the holder goes disabled by the "all children are disabled" rule: the buttons of the "Protection"
   tab are under the restriction mask. The live standard file menu password item does not keep the holder: there is no password in the submenu. */
test('protect_holder_off_in_view', () => {
    const env = makeEnv();
    env.create();
    const holder = () => env.A.offered('protect');
    assert.equal(env.A.itemState(holder()).disabled, false, 'precondition: «Protection ▸» is live in editing');
    ['btnProtectWB', 'btnProtectSheet', 'btnAllowRanges', 'btnProtectRange', 'chHiddenFormula', 'chLockedShape', 'chLockedText'].forEach(n => {
        env.roots.WBProtection[n].setDisabled(true);
        env.roots.WBProtection[n].keepState = ['view-mode'];
    });
    assert.equal(env.fileButtons.protect.isDisabled(), false, 'precondition: the stock password item of the file menu is live');
    assert.equal(env.A.itemState(holder()).disabled, true, '«Protection ▸» is live while every child is off');
});

/* "Collaboration": there is no "Chat" (discussion is in the portal messenger, the
   menus of common spreadsheet editors have no chat). The item is in no section and in no submenu, even with the chat right; the separators
   of "Collaboration" do not dangle; the standard chat button in the compact is pressed by no one. */
test('chat_gone_from_compact', () => {
    const env = makeEnv({options: {canChat: true, canCoAuthoring: true}});
    env.create();
    assert.ok(!deepKeys(env).includes('chat'), '«Chat» is offered with the chat right');
    assert.equal(env.A.item('chat'), null, '«Chat» is still in the catalog');
    assert.equal(env.A.textChat, undefined, 'the default of «Chat» is left');
    const walk = list => list.some(i => i.twin === 'LeftMenu:btnChat' || (i.items && walk(i.items)));
    assert.ok(!env.A.catalog().some(g => walk(g.items)), 'an item with the stock chat button as its twin');
    const k = env.keys(env.group('Collaboration'));
    assert.ok(!k.some((x, i) => x === '--' && k[i + 1] === '--'), 'two separators in a row where «Chat» was: ' + k.join(' '));
    /* The coverage check: the standard chat button of the tab is "Standard only", with a reason. */
    const r = env.A.coverage();
    assert.deepEqual(plain(r.byRef['Review:btnChat'].where), [], 'the stock chat still has an address in compact');
    assert.ok(/^Not in the compact shell: the built-in chat; /.test(r.byRef['Review:btnChat'].why), 'the chat has no reason: ' + r.byRef['Review:btnChat'].why);
});

/* "Insert" and "Collaboration": "Review → Add comment" → "Insert → Add comment",
   the name is the former; there is one item ("Insert" already had "Comment" with the same double - it now has the caption "Add
   comment"), the last in "Insert"; "Collaboration" does not have it. The command is the standard comment button. */
test('insert_add_comment_label', () => {
    const env = makeEnv();
    env.create();
    const ins = env.group('Insert');
    assert.equal(env.keys(ins).slice(-1)[0], 'comment', '«Add comment» is not the last item of Insert: ' + env.keys(ins).join(' '));
    const it = env.A.item('comment');
    assert.equal(it.t, env.A.textAddComment, 'Insert → the comment item is not «Add comment»');
    assert.equal(env.A.textComment, undefined, 'the default of the old «Comment» label is left');
    assert.ok(!env.keys(env.group('Collaboration')).includes('addComment'), '«Add comment» is still in Collaboration');
    assert.equal(env.A.item('addComment'), null, '«addComment» is still in the catalog');
    const twins = [];
    const walk = list => list.forEach(i => { if (i.twin === 'ToolbarCtl:btnsComment.0') twins.push(i.k); if (i.items) walk(i.items); });
    env.A.catalog().forEach(g => walk(g.items));
    assert.deepEqual(twins, ['comment'], 'the stock comment button is the twin of more than one item (one command, one name)');
    env.sectionBtn('Insert').click();
    assert.equal(rowText(env.row('comment')), 'Add comment', 'the row label');
    env.row('comment').click();
    assert.deepEqual(plain(env.log.filter(l => /^(click|pick) /.test(l))), ['click ToolbarCtl:btnsComment.0'], 'one stock click of the comment button');
});

/* "Edit" and "Collaboration": "Review → Spelling" → "Edit → Spelling": opens the spelling check
   panel, as now - with the standard left area panel button, a repeated item closes it; "Collaboration" has
   no such item. The composition of "Collaboration" is complete. */
test('spelling_from_edit', () => {
    const env = makeEnv();
    env.create();
    const edit = env.keys(env.group('Edit'));
    assert.equal(edit[edit.indexOf('findReplace') + 1], 'spelling', '«Spelling» is not right after «Find and replace» in Edit: ' + edit.join(' '));
    assert.ok(!env.keys(env.group('Collaboration')).includes('spelling'), '«Spelling» is still in Collaboration');
    assert.equal(deepKeys(env).filter(k => k === 'spelling').length, 1, '«Spelling» is in two places');
    assert.deepEqual(plain(env.keys(env.group('Collaboration'))), ['sharing', 'coauthMode', 'history', '--', 'comments', 'resolveComments',
        'deleteComments', '--', 'protect'], 'Collaboration composition');
    const it = env.A.item('spelling');
    assert.deepEqual([it.t, it.twin, it.left], [env.A.textSpelling, 'LeftMenu:btnSpellcheck', 'toggle'], 'the spelling item moved not as it was');
    env.sectionBtn('Edit').click();
    assert.equal(rowText(env.row('spelling')), 'Spelling');
    env.row('spelling').click();
    assert.deepEqual(plain(env.log.filter(l => /btnSpellcheck/.test(l))), ['click LeftMenu:btnSpellcheck'], 'the stock spellcheck button is not pressed once');
    assert.equal(env.leftButtons.btnSpellcheck.pressed, true, 'the spellcheck panel did not open');
    env.sectionBtn('Edit').click();
    env.row('spelling').click();
    assert.equal(env.leftButtons.btnSpellcheck.pressed, false, 'the second «Spelling» did not close the panel');
});

/* "Help → Keyboard shortcuts" is the standard window with a list of keyboard shortcuts, by the same path as the stock "Advanced
   settings → Keyboard shortcuts" (onClickKeyboardShortcut: a window with the api and a mark of the new feature hint); the item is after
   "Help". */
test('shortcuts_opens_stock_dialog', () => {
    const env = makeEnv();
    env.create();
    assert.equal(env.keys(env.group('Help'))[1], 'shortcuts', '«Keyboard shortcuts» is not right after «Help»');
    const it = env.A.item('shortcuts');
    assert.equal(it.t, env.A.textShortcuts);
    /* The English default is the original ONLYOFFICE name, the case is as there. */
    assert.equal(env.A.textShortcuts, 'Keyboard Shortcuts', 'the default of «Keyboard Shortcuts»');
    env.sectionBtn('Help').click();
    assert.equal(rowText(env.row('shortcuts')), 'Keyboard Shortcuts');
    env.log.length = 0;
    env.row('shortcuts').click();
    assert.deepEqual(plain(env.log.filter(l => /^(shortcuts|localStorage|click|showMenu)/.test(l))),
        ['shortcuts dialog api', 'shortcuts show', 'localStorage help-tip-customize-shortcuts 1'], 'not the stock keyboard shortcuts window');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stayed open over the window');
});

/* "Keyboard shortcuts" are available in "Viewing" (the window does not change the workbook) - both with an edit restriction, and for a reader, and during
   a cell edit; there is no condition - the item exists even without help (without help only "Help" and "Function list" are missing). */
test('shortcuts_live_in_view', () => {
    const env = makeEnv();
    env.create();
    env.shell.lockState = () => ({on: true, type: 'view', options: {toolbar: true, viewMode: true}});
    env.api.canEdit = () => false;
    assert.deepEqual(plain(env.A.itemState(env.A.item('shortcuts'))), {disabled: false, reason: null, checked: false}, '«Keyboard shortcuts» is off in view');
    const reader = makeEnv({options: {isEdit: false, canEdit: false}});
    assert.ok(reader.A.offered('shortcuts'), 'the reader has no «Keyboard shortcuts»');
    assert.equal(reader.A.itemState(reader.A.offered('shortcuts')).disabled, false, '«Keyboard shortcuts» is off for the reader');
    const noHelp = makeEnv({options: {canHelp: false}});
    assert.ok(noHelp.A.offered('shortcuts'), '«Keyboard shortcuts» depends on the help');
});

/* "Help → Function list" opens the help at the section with the spreadsheet editor function list - the standard help
   screen of the file menu with the "Insert function" page (UsageInstructions/InsertFunction.htm, the table of all functions), by the same
   call by which the stock opens the help at the needed page (showMenu('file:help', address)). The item is after "Keyboard shortcuts". */
test('function_list_opens_help_on_insert_function', () => {
    const env = makeEnv();
    env.create();
    assert.deepEqual(plain(env.keys(env.group('Help'))), ['help', 'shortcuts', 'functionList', 'about'], 'Help composition');
    const it = env.A.item('functionList');
    assert.equal(it.t, env.A.textFunctionList);
    assert.equal(env.A.textFunctionList, 'Function list', 'the default of «Function list»');
    env.sectionBtn('Help').click();
    assert.equal(rowText(env.row('functionList')), 'Function list');
    env.log.length = 0;
    env.row('functionList').click();
    assert.deepEqual(plain(env.log.filter(l => /^showMenu /.test(l))), ['showMenu file:help UsageInstructions/InsertFunction.htm'],
        'not the stock help on the functions page');
    /* "Help" is the former call without an address. */
    env.log.length = 0;
    env.A.exec(env.A.item('help'));
    assert.deepEqual(plain(env.log.filter(l => /^showMenu /.test(l))), ['showMenu file:help'], 'Help → Help changed its call');
});

/* Help is not connected (customization.help = false → canHelp) - there is neither "Help" nor "Function list"; "Keyboard
   shortcuts" and "About" are in place. */
test('help_items_absent_without_can_help', () => {
    const env = makeEnv({options: {canHelp: false}});
    assert.deepEqual(plain(env.keys(env.group('Help'))), ['shortcuts', 'about'], 'Help without the help connected');
    assert.equal(env.A.offered('functionList'), null);
    assert.equal(env.A.offered('help'), null);
    /* The condition is asked at every section build. */
    env.appOptions.canHelp = true;
    assert.deepEqual(plain(env.keys(env.group('Help'))), ['help', 'shortcuts', 'functionList', 'about'], 'the help right is cached');
});

/* "Help → About" is a window with a close (X) button (the shared Common.UI.Compact.AboutWindow, as in Documents), not the standard
   #about-menu-panel panel of the left menu button: in the compact it covered the whole editor, and returning to the sheet was possible only with
   the Esc key. The window closes - focus goes to the sheet (edit:complete). The item is alive in "Viewing" and for a reader: the window does not
   change the workbook. */
test('about_opens_window_not_stock_panel', () => {
    const env = makeEnv();
    env.create();
    const it = env.A.item('about');
    assert.equal(it.t, env.A.textAbout);
    assert.equal(typeof it.twin, 'undefined', '«About» still has the stock twin');
    const shown = [], closers = [];
    env.context.Common.UI.Compact.AboutWindow = function (o) {
        shown.push('about window ' + (o && o.title));
        this.on = (name, fn) => { if (name === 'close') closers.push(fn); return this; };
        this.show = () => shown.push('about show');
    };
    env.sectionBtn('Help').click();
    assert.equal(rowText(env.row('about')), 'About');
    env.log.length = 0;
    env.notes.length = 0;
    env.row('about').click();
    assert.deepEqual(shown, ['about window About', 'about show'], 'the item does not open the About window');
    assert.deepEqual(plain(env.log.filter(l => /LeftMenu:btnAbout|^showMenu/.test(l))), [], 'the stock About panel is opened');
    assert.equal(env.leftButtons.btnAbout.pressed, false, 'the stock About button is pressed');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stayed open over the window');
    assert.equal(env.notes.filter(n => n.name === 'edit:complete').length, 0, 'the sheet takes the focus while the window is open');
    assert.equal(closers.length, 1, 'nothing waits for the window to close');
    closers[0]();
    assert.equal(env.notes.filter(n => n.name === 'edit:complete').length, 1, 'the sheet does not take the focus after the window');

    env.shell.lockState = () => ({on: true, type: 'view', options: {toolbar: true, viewMode: true}});
    env.api.canEdit = () => false;
    assert.equal(env.A.itemState(env.A.item('about')).disabled, false, '«About» is off in view');
    const reader = makeEnv({options: {isEdit: false, canEdit: false}});
    assert.ok(reader.A.offered('about'), 'the reader has no «About»');
    assert.equal(reader.A.itemState(reader.A.offered('about')).disabled, false, '«About» is off for the reader');
});

/* After renaming the section: "Collaboration → Co-editing mode ▸" is a mirror of the
   standard menu of the mode button; the checkmark is on the current mode, from the checkmark of the standard item; the stock mode changed - the checkmark
   moves. The item is by the condition "the document is open for collaboration". */
test('coauth_mode_rows_checked_by_stock', () => {
    const own = [];
    const modes = menu([item('Fast', {checkable: true, checked: true}), item('Strict', {checkable: true})]);
    const env = makeEnv({review: {btnCoAuthMode: button('Review:btnCoAuthMode', own, {menu: modes})}});
    env.create();
    const rows = () => {
        env.shell.closeSurfaces();
        env.sectionBtn('Collaboration').click();
        env.row('coauthMode').click();
        return plain(env.flyRows().map(r => [rowText(r), r.getAttribute('aria-checked') === 'true']));
    };
    assert.deepEqual(rows(), [['Fast', true], ['Strict', false]], 'the check is not at the current mode');
    modes.items[0].checked = false;
    modes.items[1].checked = true;
    assert.deepEqual(rows(), [['Fast', false], ['Strict', true]], 'the check did not move with the stock mode');
    const off = makeEnv({options: {canChangeCoAuthoring: false}});
    assert.equal(off.A.offered('coauthMode'), null, '«Co-editing mode ▸» without the co-editing change right');
});

/* --- The "File" menu ------------------------------------------------------------------------------------------- */

/* "File": "Download XLSX · Download PDF · Download CSV · Download ODS" → "Download ▸ (XLSX · PDF · CSV · ODS)" - the same
   actions, merged into a submenu after "Save"; the item captions are the format names (not from the locale), the submenu has "Download"
   (textDownload) and the former glyph. A format item is the standard file menu handler (clickSaveAsFormat) once.
   "Download ▸" is alive in "Viewing" (the ribbon mask and the engine refusal do not disable it) and for a reader. */
test('download_holder_four_formats', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const file = env.keys(env.group('File'));
    assert.equal(file[file.indexOf('save') + 1], 'download', '«Download ▸» is not right after «Save»: ' + file.join(' '));
    assert.ok(!file.some(k => /^download./.test(k)), 'a «Download <format>» item is still in File: ' + file.join(' '));
    const holder = env.A.item('download');
    assert.deepEqual([holder.t, holder.i, !!holder.twin, !!holder.run, !!holder.sub], [env.A.textDownload, 'download', false, false, false],
        '«Download ▸» is not a composite item with the label «Download» and the download glyph');
    /* The English default is the original ONLYOFFICE name, the case is as there. */
    assert.equal(env.A.textDownload, 'Download as', 'the default of «Download as»');
    ['textDownloadXlsx', 'textDownloadPdf', 'textDownloadCsv', 'textDownloadOds'].forEach(k => assert.equal(env.A[k], undefined, 'the default ' + k + ' is left'));
    assert.deepEqual(plain(holder.items.map(i => [i.k, i.t])), [['downloadXlsx', 'XLSX'], ['downloadPdf', 'PDF'], ['downloadCsv', 'CSV'], ['downloadOds', 'ODS']],
        'the four formats of «Download ▸»');
    /* A row with ▸ in the section, the layer is four rows without glyphs, a click on a format is one standard download, the menu is closed. */
    env.sectionBtn('File').click();
    const row = env.row('download');
    assert.ok(row && row.classList.contains('vo-has-sub') && row.getAttribute('aria-haspopup') === 'menu', '«Download ▸» is not a submenu opener');
    assert.equal(rowText(row), 'Download as');
    row.click();
    assert.equal(flyOf(env).getAttribute('aria-label'), 'Download as', 'the layer is not named «Download as»');
    assert.deepEqual(plain(ownRows(env).map(rowText)), ['XLSX', 'PDF', 'CSV', 'ODS'], 'rows of «Download ▸»');
    env.log.length = 0;
    env.row('downloadPdf').click();
    assert.deepEqual(plain(env.log.filter(l => /^saveas /.test(l))), ['saveas ' + FILE_TYPE.PDF + ' (menu with hide)'], 'PDF is not one stock save-as');
    assert.ok(env.notes.some(n => n.name === 'download:settings'), 'PDF does not open the stock download settings');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stayed open after a format');
    /* "Viewing": the ribbon mask, the engine does not accept editing - "Download ▸" and the formats are alive. */
    const view = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true, viewMode: true}}), modeCode: () => 'view',
        canUse: () => false, canRename: () => false};
    env.api.canEdit = () => false;
    assert.deepEqual(plain(env.A.itemState(env.A.offered('download'), view)), {disabled: false, reason: null, checked: false}, '«Download ▸» is off in «Viewing»');
    env.A.children(env.A.offered('download')).forEach(k =>
        assert.equal(env.A.itemState(k, view).disabled, false, k.k + ' is off in «Viewing»'));
    delete env.api.canEdit;
    const reader = makeEnv({options: {isEdit: false, canEdit: false}});
    assert.ok(reader.A.offered('download') && reader.A.itemState(reader.A.offered('download')).disabled === false, '«Download ▸» is not live for a reader');
    assert.equal(env.warnings.length + reader.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "File" and "Data": "Data → Get data from text ▸" → "File → Import ▸" after "Download ▸" - the same three items with the same
   names: the submenu is a mirror of the live standard menu of the "From text/CSV" button of the "Data" tab, a choice is a standard item click.
   "Data" no longer has the item, the command in the catalog is one. "Import ▸" in "Viewing" is unavailable (the stock ribbon mask
   disables the "Data" tab), for a reader there is no button - the item is in place inactive, without a missing-item warning. */
test('import_moved_from_data_to_file', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const file = env.keys(env.group('File'));
    assert.equal(file[file.indexOf('download') + 1], 'import', '«Import ▸» is not right after «Download ▸»: ' + file.join(' '));
    const it = env.A.item('import');
    assert.deepEqual([it.t, it.twin, !!it.sub], [env.A.textImport, 'DataTab:btnDataFromText', true], '«Import ▸» is not the mirror of the stock «From text/CSV»');
    assert.equal(env.A.textImport, 'Import', 'the default of «Import»');
    assert.equal(env.A.textFromText, undefined, 'the default of «Get data from text» is left');
    assert.ok(!env.keys(env.group('Data')).some(k => k === 'fromText' || k === 'import'), 'the import is still in Data: ' + env.keys(env.group('Data')).join(' '));
    const twins = [];
    const walk = list => list.forEach(i => { if (i.twin === 'DataTab:btnDataFromText' || i.mirror === 'DataTab:btnDataFromText') twins.push(i.k); if (i.items) walk(i.items); });
    env.A.catalog().forEach(g => walk(g.items));
    assert.deepEqual(twins, ['import'], 'the stock «From text/CSV» is the twin of more than one item');
    /* The rows are the standard button menu at the moment of opening; a choice is a standard item click, one; the menu is closed. */
    const btn = env.roots.DataTab.btnDataFromText;
    let opened = 0;
    btn.menu.on('show:before', () => { opened++; });
    env.sectionBtn('File').click();
    const row = env.row('import');
    assert.ok(row && row.classList.contains('vo-has-sub'), '«Import ▸» row is not a submenu opener');
    assert.equal(rowText(row), 'Import');
    row.click();
    assert.equal(opened, 1, 'the stock menu is not prepared on our open');
    assert.deepEqual(plain(env.flyRows().map(rowText)), ['First btnDataFromText', 'Second btnDataFromText'], 'rows are not the stock menu of «From text/CSV»');
    env.flyRows()[1].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick DataTab:btnDataFromText/.test(l))), ['pick DataTab:btnDataFromText Second btnDataFromText'], 'not one stock item click');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stayed open after the pick');
    /* "Viewing": the stock ribbon mask - the item is inactive with a reason. */
    const masked = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    assert.deepEqual(plain(env.A.itemCode(it, masked)), {disabled: true, reason: 'view', checked: false}, '«Import ▸» is live in «Viewing»');
    /* A reader: the stock has no button - the item is in place inactive, no warning. */
    const reader = makeEnv({options: {isEdit: false, canEdit: false}});
    reader.roots.DataTab.btnDataFromText = null;
    const rit = reader.A.offered('import');
    assert.ok(rit, '«Import ▸» disappeared for a reader (inactive, not hidden)');
    reader.shell.editRight = false;
    assert.equal(reader.A.itemState(rit, reader.shell).disabled, true, '«Import ▸» is live without its stock button');
    assert.equal(env.warnings.length + reader.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(reader.warnings.map(w => String(w[0]))));
});

/* "File": "Print titles · Margins ▸ · Orientation ▸ · Page size ▸ · Print scale ▸" were removed - all of this is
   in the standard print window: print titles, margins, orientation, size, scale. The catalog has no items with these doubles, their
   defaults do not exist; the address of each of the five "Layout" ribbon buttons is "File → Print" (and the PDF options window "Download ▸ PDF"), not a
   check hole; "Print" is the former item, the path is the standard print notification. Print area, page breaks and
   headers/footers are in place. */
const PAGE_SETUP = {printTitles: 'Toolbar:btnPrintTitles', margins: 'Toolbar:btnPageMargins', orientation: 'Toolbar:btnPageOrient',
    pageSize: 'Toolbar:btnPageSize', scale: 'Toolbar:btnScale'};
test('page_setup_only_in_print_dialog', () => {
    const env = makeEnv();
    const file = env.keys(env.group('File'));
    Object.keys(PAGE_SETUP).forEach(k => assert.ok(!file.includes(k), k + ' is still in File: ' + file.join(' ')));
    ['printArea', 'pageBreaks', 'headerFooter'].forEach(k => assert.ok(file.includes(k), k + ' is gone from File (the «later» queue keeps it)'));
    const twins = [];
    const walk = list => list.forEach(i => { if (Object.values(PAGE_SETUP).includes(i.twin || i.mirror)) twins.push(i.k); if (i.items) walk(i.items); });
    env.A.catalog().forEach(g => walk(g.items));
    assert.deepEqual(twins, [], 'items with a page setup twin are left in the menu');
    ['textPrintTitles', 'textMargins', 'textOrientation', 'textPageSize', 'textScale'].forEach(k => assert.equal(env.A[k], undefined, 'the default ' + k + ' is left'));
    const r = env.A.coverage();
    Object.values(PAGE_SETUP).forEach(ref => {
        const where = plain(r.byRef[ref].where);
        assert.equal(where.length, 1, ref + ' addresses: ' + JSON.stringify(where));
        assert.ok(/^menu file > print; menu file > download > downloadPdf \(the stock print settings dialog: [a-z ]+\)$/.test(where[0]),
            ref + ' is not addressed by the print window: ' + where[0]);
    });
    assert.deepEqual(plain(r.missing), [], 'coverage holes after the page setup left File');
    const print = env.A.item('print');
    assert.equal(env.A.exec(print, env.shell), true);
    assert.equal(env.notes.filter(n => n.name === 'print').length, 1, '«Print» is not one stock print notification');
});

/* The standard copy, cut and paste handlers are the real stock text: the ribbon buttons (controller/Toolbar.js
   onCopyPaste, subscribed to the button click in the editor - attachUIEvents) and the context menu item (controller/
   DocumentHolderExt.js dh.onCopyPaste). */
function stockText(file, head) {
    const src = fs.readFileSync(path.join(ROOT, 'apps/spreadsheeteditor/main/app/controller', file), 'utf8');
    const start = src.indexOf(head);
    assert.ok(start >= 0, head + ' not found in controller/' + file);
    let depth = 0, end = src.indexOf('{', start);
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    return src.slice(src.indexOf('function', start), end + 1);
}
const STOCK_TOOLBAR_COPY_PASTE = stockText('Toolbar.js', 'onCopyPaste: function(');
const STOCK_HOLDER_COPY_PASTE = stockText('DocumentHolderExt.js', 'dh.onCopyPaste = function(');
/* The stock as in the editor: the handlers are in place, the engine answers with a journal (refuse - the browser denied the menu the clipboard). */
function wireCopyPaste(env, refuse = {}) {
    env.toolbarCtl.onCopyPaste = vm.runInContext('(' + STOCK_TOOLBAR_COPY_PASTE + ')', env.context);
    env.holderCtl.onCopyPaste = vm.runInContext('(' + STOCK_HOLDER_COPY_PASTE + ')', env.context);
    env.roots.Toolbar.mode = {canCopy: env.appOptions.canCopy !== false};
    ['cut', 'copy', 'paste'].forEach(type => {
        const name = 'asc_' + type[0].toUpperCase() + type.slice(1);
        env.api[name] = () => { env.log.push('engine ' + type); return !refuse[type]; };
        const btn = env.roots.Toolbar['btn' + type[0].toUpperCase() + type.slice(1)];
        btn.on('click', () => env.toolbarCtl.onCopyPaste(type));
    });
}

/* "Edit": "Cut · Copy · Paste" as a group after "Undo · Redo" - the same actions as the
   keyboard shortcuts (the hints on the right are the standard shortcuts) and the items of the same name of the context menu (the captions and
   glyphs are as theirs). Cut and paste are the standard ribbon buttons, their handler and locks; copy is the handler of
   the "Copy" context menu item, the button is not pressed. The browser did not give the menu the clipboard - the standard
   "Copy, cut and paste actions" window; after "Do not show again" there is no window. "Copy" is alive in
   "Viewing" (the ribbon mask does not disable it), "Cut" and "Paste" are not, as without editing in the engine; without the right to
   copy "Copy" is in place inactive with the stock reason. */
test('edit_cut_copy_paste', () => {
    const env = makeEnv({shortcuts: STOCK_KEYS});
    env.main.errorCopyDisabled = 'Copying is disabled';
    env.create();
    checkCatalog(env.A.catalog());
    const edit = env.keys(env.group('Edit'));
    assert.deepEqual(edit.slice(0, 7), ['undo', 'redo', '--', 'cut', 'copy', 'paste', '--'], 'Edit does not start with «Undo · Redo — Cut · Copy · Paste —»: ' + edit.join(' '));
    const [cut, copy, paste] = ['cut', 'copy', 'paste'].map(k => env.A.item(k));
    assert.deepEqual([cut.t, copy.t, paste.t], ['Cut', 'Copy', 'Paste'], 'labels');
    assert.deepEqual([cut.i, copy.i, paste.i], ['cut', 'copy', 'paste'], 'glyphs are not those of the context and column menus');
    assert.deepEqual([cut.twin, paste.twin, copy.lockLike, !!copy.sameCommand], ['Toolbar:btnCut', 'Toolbar:btnPaste', 'Toolbar:btnCopy', true], 'stock controls of the commands');
    env.sectionBtn('Edit').click();
    assert.deepEqual(['cut', 'copy', 'paste'].map(k => rowText(env.row(k))), ['Cut', 'Copy', 'Paste'], 'row labels');
    assert.deepEqual(['cut', 'copy', 'paste'].map(k => env.row(k).querySelector('.vo-mn-h').textContent), ['Ctrl+X', 'Ctrl+C', 'Ctrl+V'], 'shortcut hints');
    assert.ok(['cut', 'copy', 'paste'].every(k => (env.row(k).querySelector('.vo-mn-i') || {}).innerHTML), 'a row without its glyph');
    env.shell.closeSurfaces();
    /* The commands are by the standard handlers. */
    wireCopyPaste(env, {paste: true});
    const run = k => { env.log.length = 0; env.sectionBtn('Edit').click(); env.row(k).click(); return plain(env.log.filter(l => !/stock menus hidden/.test(l))); };
    assert.deepEqual(run('cut'), ['click Toolbar:btnCut', 'engine cut'], '«Cut» is not the stock cut button');
    assert.deepEqual(run('copy'), ['engine copy'], '«Copy» is not the stock context menu copy (the ribbon button must not be clicked)');
    /* The browser does not give the menu paste - the standard window; "Do not show again" - and there is no window. */
    assert.deepEqual(run('paste'), ['click Toolbar:btnPaste', 'engine paste', 'copy warning dialog', 'copy warning show'], '«Paste» refused by the browser: no stock warning');
    env.copyWarnings[0].handler(true);
    assert.equal(env.store['sse-hide-copywarning'], '1', '«Do not show this message again» is not kept by the stock');
    assert.deepEqual(run('paste'), ['click Toolbar:btnPaste', 'engine paste'], 'the warning came again after «Do not show again»');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stayed open after the command');
    /* "Viewing" (the ribbon mask): copy is alive, cut and paste are not, with a reason. */
    const view = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    assert.deepEqual(plain(env.A.itemState(copy, view)), {disabled: false, reason: null, checked: false}, '«Copy» is off in «Viewing»');
    [cut, paste].forEach(it => assert.deepEqual(plain(env.A.itemCode(it, view)), {disabled: true, reason: 'view', checked: false}, it.k + ' is live in «Viewing»'));
    /* The engine does not accept editing (a reader, "Viewing" without a mask) - the same. */
    env.api.canEdit = () => false;
    assert.equal(env.A.itemState(copy).disabled, false, '«Copy» follows the engine edit verdict');
    [cut, paste].forEach(it => assert.equal(env.A.itemState(it).disabled, true, it.k + ' is live while the engine refuses editing'));
    delete env.api.canEdit;
    /* A ribbon button lock (a co-author, protection) is the item lock. */
    env.roots.Toolbar.btnCut.setDisabled(true);
    env.roots.Toolbar.btnCut.keepState = ['coauth'];
    assert.equal(env.A.itemState(cut).disabled, true, '«Cut» is live while the stock button is locked');
    /* Without the copy right - "Copy" is in place inactive, the reason is the standard phrase. */
    env.appOptions.canCopy = false;
    assert.ok(env.A.offered('copy'), '«Copy» disappeared without the copy right (inactive, not hidden)');
    assert.deepEqual(plain(env.A.itemState(copy)), {disabled: true, reason: 'Copying is disabled', checked: false}, '«Copy» without the copy right');
    assert.equal(env.A.exec(copy, env.shell), false, '«Copy» ran without the copy right');
    assert.equal(env.warnings.length, 0, 'unexpected warnings');
});

/* A reader. The "Cut" button is absent from their ribbon, "Copy" and "Paste" are built but without handlers
   (Toolbar.attachUIEvents - only for an editor); the engine does not accept editing. "Copy" is alive and copies with the context menu
   handler, "Cut" and "Paste" are inactive, there are no missing-button warnings. */
test('edit_copy_for_reader', () => {
    const env = makeEnv({options: {isEdit: false, canEdit: false}});
    env.create();
    env.shell.editRight = false;
    env.holderCtl.onCopyPaste = vm.runInContext('(' + STOCK_HOLDER_COPY_PASTE + ')', env.context);
    env.api.asc_Copy = () => { env.log.push('engine copy'); return true; };
    env.api.canEdit = () => false;
    env.roots.Toolbar.btnCut = null;
    const copy = env.A.offered('copy'), cut = env.A.offered('cut'), paste = env.A.offered('paste');
    assert.ok(copy && cut && paste, 'a reader lost an item of Edit (inactive, not hidden)');
    assert.equal(env.A.itemState(copy, env.shell).disabled, false, '«Copy» is off for a reader');
    assert.equal(env.A.itemState(cut, env.shell).disabled, true, '«Cut» is live for a reader');
    assert.equal(env.A.itemState(paste, env.shell).disabled, true, '«Paste» is live for a reader');
    assert.equal(env.A.exec(copy, env.shell), true);
    assert.deepEqual(plain(env.log.filter(l => /engine|click/.test(l))), ['engine copy'], 'reader copy is not the stock context menu copy');
    assert.equal(env.warnings.length, 0, 'warnings for the reader: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Edit" and "Insert": "Insert → Delete cells ▸" → "Edit → Delete cells ▸", the composition and name are the former - a mirror of the
   live standard menu of the "Delete cells" button (a choice is a standard item click); "Insert" has no item, the command in the catalog is one.
   During a cell edit the stock disables the button (lock editCell, reason cell-editing) - the item is in place inactive with the reason
   "Finish editing the cell" and does not open a layer; on a co-author lock - the same, by the button lock. */
test('delete_cells_moved_from_insert_to_edit', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const edit = env.keys(env.group('Edit'));
    assert.deepEqual(edit.slice(edit.indexOf('paste') + 1, edit.indexOf('paste') + 3), ['--', 'deleteCells'], '«Delete cells ▸» does not open the group after «Paste»: ' + edit.join(' '));
    assert.ok(!env.keys(env.group('Insert')).includes('deleteCells'), '«Delete cells ▸» is still in Insert');
    const twins = [];
    const walk = list => list.forEach(i => { if (i.twin === 'Toolbar:btnDeleteCell' || i.mirror === 'Toolbar:btnDeleteCell') twins.push(i.k); if (i.items) walk(i.items); });
    env.A.catalog().forEach(g => walk(g.items));
    assert.deepEqual(twins, ['deleteCells'], 'the stock «Delete cells» is the twin of more than one item');
    const it = env.A.item('deleteCells');
    assert.deepEqual([it.t, it.twin, !!it.sub], [env.A.textDeleteCells, 'Toolbar:btnDeleteCell', true], 'the item moved not as it was');
    const btn = env.roots.Toolbar.btnDeleteCell;
    env.sectionBtn('Edit').click();
    assert.equal(rowText(env.row('deleteCells')), 'Delete cells');
    env.row('deleteCells').click();
    assert.deepEqual(plain(env.flyRows().map(rowText)), ['First btnDeleteCell', 'Second btnDeleteCell'], 'rows are not the stock menu of «Delete cells»');
    env.flyRows()[0].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick Toolbar:btnDeleteCell/.test(l))), ['pick Toolbar:btnDeleteCell First btnDeleteCell'], 'not one stock item click');
    /* A cell edit - the button is disabled by the stock. */
    btn.setDisabled(true);
    btn.keepState = ['cell-editing'];
    assert.deepEqual(plain(env.A.itemState(it)), {disabled: true, reason: env.A.textEditing, checked: false}, '«Delete cells ▸» during the cell edit');
    env.sectionBtn('Edit').click();
    const row = env.row('deleteCells');
    assert.equal(row.getAttribute('aria-disabled'), 'true', 'the row is live during the cell edit');
    assert.equal(row.getAttribute('title'), env.A.textEditing, 'the row reason');
    row.click();
    assert.equal(env.flyRows().length, 0, 'a locked «Delete cells ▸» opened its submenu');
    btn.setDisabled(false);
    btn.keepState = [];
    assert.equal(env.A.itemState(it).disabled, false, '«Delete cells ▸» stays locked after the cell edit');
    const r = env.A.coverage();
    assert.deepEqual(plain(r.byRef['Toolbar:btnDeleteCell'].where), ['menu edit > deleteCells'], 'the coverage address of «Delete cells»');
});

/* "Edit": "Clear ▸" between "Delete cells ▸" and "Fill ▸" - the same five actions as "Clear ▸" of the
   context menu: a mirror of the live standard menu of the ribbon "Clear" button (rows, their captions and availability are standard, a choice is a
   standard item click); the caption is "Clear", the glyph is the same as for "Clear format" and the column letter menu. */
test('edit_clear_holder', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const edit = env.keys(env.group('Edit'));
    assert.deepEqual(edit.slice(edit.indexOf('deleteCells'), edit.indexOf('deleteCells') + 3), ['deleteCells', 'clear', 'fill'], '«Clear ▸» is not between «Delete cells ▸» and «Fill ▸»: ' + edit.join(' '));
    const it = env.A.item('clear');
    assert.deepEqual([it.t, it.i, it.twin, !!it.sub], ['Clear', 'clear', 'Toolbar:btnClearStyle', true], '«Clear ▸» is not the mirror of the stock «Clear»');
    assert.equal(env.A.textClear, 'Clear', 'the default of «Clear»');
    const btn = env.roots.Toolbar.btnClearStyle;
    let opened = 0;
    btn.menu.on('show:before', () => { opened++; });
    btn.menu.items[1].setDisabled(true);
    env.sectionBtn('Edit').click();
    assert.equal(rowText(env.row('clear')), 'Clear');
    assert.ok(env.row('clear').classList.contains('vo-has-sub'), '«Clear» row is not a submenu opener');
    env.row('clear').click();
    assert.equal(opened, 1, 'the stock menu is not prepared on our open');
    const rows = env.flyRows();
    assert.deepEqual(plain(rows.map(rowText)), ['First btnClearStyle', 'Second btnClearStyle'], 'rows are not the stock menu of «Clear»');
    assert.equal(rows[1].getAttribute('aria-disabled'), 'true', 'a stock disabled row is live in «Clear ▸»');
    rows[0].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick Toolbar:btnClearStyle/.test(l))), ['pick Toolbar:btnClearStyle First btnClearStyle'], 'not one stock item click');
    assert.ok(env.A.coverage().byRef['Toolbar:btnClearStyle'].where.includes('menu edit > clear'), 'the coverage address «menu edit > clear»');
});

/* Each "Edit → Clear ▸" item is available exactly like the standard command: during a cell edit in "Edit → Clear ▸"
   "All" is available, while "Contents", "Formatting", "Comments" and "Links" are unavailable - the same as now in the context menu "Clear ▸". The submenu as a whole is not disabled if it has an available item.
   During an edit the stock disables the "Clear" button menu items, not the button (controller/Toolbar.js onEditCell, keepState cell-editing):
   the holder is alive, the layer opens, the rows have the availability of the standard items, a click on a live one is a standard item choice. All
   rows disabled ("All" has its own lock - no right to change the filter) - the holder is disabled with the cell edit reason, no layer. The end of the edit -
   the rows are alive again. The open section is recalculated by asc_onEditCell (after the stock subscribers). The negative control is a catalog
   with the former cellEditOff sign on "Clear ▸" (the holder is disabled during an edit) and without the byRows sign (all rows are disabled - the holder is
   alive). */
test('clear_rows_as_stock_in_cell_edit', () => {
    const env = makeEnv();
    env.create();
    const it = env.A.item('clear'), btn = env.roots.Toolbar.btnClearStyle, rowsOf = btn.menu.items;
    assert.equal(env.A.itemState(it).disabled, false, 'precondition: «Clear ▸» is off without a cell edit');
    env.sectionBtn('Edit').click();
    const fire = () => { (env.api.handlers.asc_onEditCell || []).forEach(fn => fn(0)); env.flush(); };
    /* The stock at the start of an edit: the button is alive, the menu items are disabled except the first. */
    const edit = on => {
        env.api.isCellEdited = on;
        rowsOf.slice(1).forEach(i => { i.setDisabled(on); i.keepState = on ? ['cell-editing'] : []; });
        fire();
    };
    edit(true);
    assert.equal(btn.disabled, false, 'precondition: the stock button stays live during the cell edit');
    assert.deepEqual(plain(env.A.itemState(it)), {disabled: false, reason: null, checked: false}, '«Clear ▸» during the cell edit (a live row inside)');
    const row = env.row('clear');
    assert.ok(row, 'the open section lost «Clear ▸»');
    assert.equal(row.getAttribute('aria-disabled'), 'false', '«Clear ▸» is off during the cell edit');
    row.click();
    const rows = env.flyRows();
    assert.deepEqual(plain(rows.map(r => [rowText(r), r.getAttribute('aria-disabled')])),
        [['First btnClearStyle', 'false'], ['Second btnClearStyle', 'true']], 'the rows are not the stock rows with their availability');
    rows[1].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick Toolbar:btnClearStyle/.test(l))), [], 'a locked stock row was picked');
    rows[0].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick Toolbar:btnClearStyle/.test(l))), ['pick Toolbar:btnClearStyle First btnClearStyle'], 'the live row is not one stock pick');
    /* All rows are disabled - the holder is disabled, the reason is the cell edit. */
    rowsOf[0].setDisabled(true);
    rowsOf[0].keepState = ['cantModifyFilter'];
    assert.deepEqual(plain(env.A.itemState(it)), {disabled: true, reason: env.A.textEditing, checked: false}, '«Clear ▸» with all rows off');
    env.sectionBtn('Edit').click();
    env.row('clear').click();
    assert.equal(env.flyRows().length, 0, '«Clear ▸» with all rows off opened its submenu');
    rowsOf[0].setDisabled(false);
    rowsOf[0].keepState = [];
    assert.equal(env.A.itemState(env.A.item('cut')).disabled, false, 'the cell edit locked an item that follows its stock button');
    env.shell.closeSurfaces();
    env.sectionBtn('Edit').click();
    edit(false);
    assert.equal(env.row('clear').getAttribute('aria-disabled'), 'false', 'the open section was not relocked after the cell edit');
    env.row('clear').click();
    assert.deepEqual(plain(env.flyRows().map(r => r.getAttribute('aria-disabled'))), ['false', 'false'], 'the rows stay off after the cell edit');
    assert.equal(env.warnings.length, 0, 'unexpected warnings');
});

/* "Edit": "Remove duplicates" - only in "Data" ("Edit" had it as a duplicate). The command in the catalog is one - the "Data"
   item with the same standard button, the check address is "menu data > removeDuplicatesData": the function did not disappear.
   The composition of "Edit" is complete, the captions are the English defaults (the locale is in the live case). */
test('remove_duplicates_only_in_data', () => {
    const env = makeEnv();
    env.create();
    assert.ok(!env.keys(env.group('Edit')).includes('removeDuplicates'), '«Remove duplicates» is still in Edit');
    assert.equal(env.A.item('removeDuplicates'), null, '«removeDuplicates» is still in the catalog');
    const twins = [];
    const walk = list => list.forEach(i => { if (i.twin === 'DataTab:btnRemoveDuplicates') twins.push(i.k); if (i.items) walk(i.items); });
    env.A.catalog().forEach(g => walk(g.items));
    assert.deepEqual(twins, ['removeDuplicatesData'], 'the stock «Remove duplicates» is not one item of Data');
    assert.ok(env.keys(env.group('Data')).includes('removeDuplicatesData'), '«Remove duplicates» left Data');
    assert.equal(env.A.item('removeDuplicatesData').t, 'Remove duplicates');
    const r = env.A.coverage();
    assert.deepEqual(plain(r.byRef['DataTab:btnRemoveDuplicates'].where), ['menu data > removeDuplicatesData'], 'the coverage address of «Remove duplicates»');
    assert.deepEqual(plain(r.missing), [], 'coverage holes');
    env.sectionBtn('Edit').click();
    assert.deepEqual(plain(env.doc.querySelectorAll('#vo-shell .vo-mn-drop.open [data-k]').map(rowText)),
        ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete cells', 'Clear', 'Fill', 'Select all', 'Find and replace', 'Spelling'], 'Edit rows');
});

/* --- The "View" menu ------------------------------------------------------------------------------------------------------ */

/* "View": "Zoom ▸ 50 % · 75 % · 100 % · 125 % · 150 % · 200 %" (the Documents list) after "Freeze panes ▸" - changes the
   sheet zoom; the checkmark is on the current one; with a non-standard zoom (110 % after a gesture) - on none. The list and command are the
   panel zoom helpers (CompactToolbar.ZOOMS, setZoom: one asc_setZoom), after a choice the keyboard goes to
   the sheet (edit:complete, as for the standard bottom row zoom list). "100 %" has the standard zoom reset shortcut.
   Availability comes from the sheet row zoom button: during a cell edit the stock disables it - the item and its submenu are inactive.
   Zoom is in "View → Zoom ▸" - even with the panel hidden. */
test('view_zoom_submenu', () => {
    const env = makeEnv({shortcuts: {Zoom100: ['Ctrl', '0']}});
    env.create();
    const ZOOMS = plain(env.SSE.Views.CompactToolbar.ZOOMS);
    assert.deepEqual(ZOOMS, [50, 75, 100, 125, 150, 200], 'the zoom list of the toolbar');
    const view = env.keys(env.group('View'));
    assert.equal(view[view.indexOf('freeze') + 1], 'zoom', '«Zoom ▸» is not right after «Freeze panes ▸»: ' + view.join(' '));
    const zoom = env.A.offered('zoom');
    assert.equal(zoom.t, 'Zoom', 'the label of «Zoom ▸»');
    assert.deepEqual(plain(Array.from(zoom.items, i => [i.k, i.t])), ZOOMS.map(z => ['zoom' + z, z + '%']), '«Zoom ▸»: six percentages from 50 to 200');
    env.sectionBtn('View').click();
    assert.ok(env.row('zoom').classList.contains('vo-has-sub'), '«Zoom» row is not a submenu opener');
    env.row('zoom').click();
    const look = () => plain(env.flyRows().map(r => [rowText(r), r.getAttribute('role'), r.getAttribute('aria-checked'), !!r.querySelector('.vo-mn-chk')]));
    assert.deepEqual(look(), ZOOMS.map(z => [z + '%', 'menuitemradio', z === 100 ? 'true' : 'false', z === 100]), 'at 100 %: one selected radio with a check mark');
    const hundred = env.flyRows()[ZOOMS.indexOf(100)];
    assert.equal((hundred.querySelector('.vo-mn-h') || {}).textContent, 'Ctrl+0', '«100%» without the stock shortcut of the zoom reset');
    assert.ok(env.flyRows().filter((r, i) => i !== ZOOMS.indexOf(100)).every(r => !r.querySelector('.vo-mn-h')), 'a shortcut at a percentage without its own');
    /* A non-standard zoom - not a single checkmark; returned to 75 % - the checkmark is on "75%" (re-read together with availability). */
    env.api.zoom = 1.1;
    env.relock();
    assert.ok(look().every(r => r[2] === 'false' && !r[3]), 'at 110 % a percentage is checked: ' + JSON.stringify(look()));
    env.api.zoom = 0.75;
    env.relock();
    assert.deepEqual(look().filter(r => r[2] === 'true').map(r => r[0]), ['75%'], 'at 75 %');
    /* A choice is one zoom command, the menu is closed, the keyboard goes to the sheet. */
    env.api.zoom = 1;
    env.notes.length = 0;
    env.flyRows()[ZOOMS.indexOf(125)].click();
    assert.deepEqual(plain(env.api.calls), ['zoom 1.25'], 'not one asc_setZoom(1.25)');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stays open after the choice');
    assert.ok(env.notes.some(n => n.name === 'edit:complete'), 'the keyboard is not given back to the sheet');
    /* A cell edit: the stock disables the sheet row zoom buttons - the items and the holder are inactive, the layer does not open. */
    env.roots.Statusbar.btnZoomUp.setDisabled(true);
    assert.equal(env.A.itemState(zoom).disabled, true, '«Zoom ▸» is live while the stock zoom is locked');
    env.sectionBtn('View').click();
    env.row('zoom').click();
    assert.equal(env.flyRows().length, 0, 'a locked «Zoom ▸» opened its submenu');
    env.roots.Statusbar.btnZoomUp.setDisabled(false);
    assert.equal(env.A.itemState(zoom).disabled, false);
    /* Without the zoom helpers (there is no panel) there is no submenu. */
    const tb = env.SSE.Views.CompactToolbar, zooms = tb.ZOOMS;
    tb.ZOOMS = undefined;
    assert.ok(!env.keys(env.group('View')).includes('zoom'), '«Zoom ▸» without the zoom list');
    tb.ZOOMS = zooms;
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "View": "Show formulas" as a separate item → "Show ▸ ✓ Gridlines · ✓ Headings · ✓ Zeros · ✓ Show formulas"
   (the first three are new: they are now toggled only in the "Standard interface"). The names are standard: the phrases of the stock "View" tab in
   the interface language, without copies in the shell locale (for zeros - "Show zeros"); they act on the current sheet -
   the checkmark is by the standard checkbox, which the stock re-reads on a sheet change; a click is the checkbox click path (onItemCheck → change);
   the locks are standard (a cell edit). The engine does not change the sheet view without editing - in "Viewing" the submenu
   is unavailable as a whole, like "Show formulas". The checkmarks are on the current state. */
test('view_show_submenu', () => {
    const env = makeEnv();
    const stockView = {prototype: {textGridlines: 'Линии сетки', textHeadings: 'Заголовки', textZeros: 'Отображать нули'}};
    env.create();
    const view = env.keys(env.group('View'));
    assert.deepEqual(view.slice(0, 4), ['freeze', 'zoom', 'show', '--'], '«Show ▸» is not right after «Zoom ▸»: ' + view.join(' '));
    assert.ok(!view.includes('showFormulas'), '«Show formulas» is still a top item of View');
    const show = env.A.offered('show');
    assert.equal(show.t, 'Show', 'the label of «Show ▸»');
    assert.deepEqual(plain(Array.from(show.items, i => [i.k, i.t, i.twin])), [
        ['gridlines', 'Gridlines', 'ViewTab:chGridlines'], ['headings', 'Headings', 'ViewTab:chHeadings'],
        /* "Show Zeros" is the standard English checkbox caption (en.json ViewTab.textZeros). */
        ['zeros', 'Show Zeros', 'ViewTab:chZeros'], ['showFormulas', 'Show formulas', 'Formula:btnShowFormulas']],
        'without the stock view: its English defaults');
    /* The captions are the standard phrases of the "View" tab in the interface language (put by the standard localization into the view prototype). */
    env.SSE.Views.ViewTab = stockView;
    assert.deepEqual(plain(Array.from(env.A.offered('show').items, i => i.t)), ['Линии сетки', 'Заголовки', 'Отображать нули', 'Show formulas'],
        'the labels are not the stock phrases of the View tab');
    delete env.SSE.Views.ViewTab;
    const V = env.roots.ViewTab;
    V.chHeadings.checked = false;
    env.sectionBtn('View').click();
    env.row('show').click();
    const look = () => plain(env.flyRows().map(r => [r.getAttribute('data-k'), r.getAttribute('role'), r.getAttribute('aria-checked'), !!r.querySelector('.vo-mn-chk'),
        r.getAttribute('aria-disabled')]));
    assert.deepEqual(look(), [['gridlines', 'menuitemcheckbox', 'true', true, 'false'], ['headings', 'menuitemcheckbox', 'false', false, 'false'],
        ['zeros', 'menuitemcheckbox', 'true', true, 'false'], ['showFormulas', 'menuitemcheckbox', 'false', false, 'false']], 'checks by the stock checkboxes');
    /* Another sheet: the stock re-read the checkboxes - the open submenu re-reads the checkmarks together with availability. */
    V.chGridlines.checked = false;
    env.relock();
    assert.equal(look()[0][2], 'false', 'the gridlines check of the other sheet is not re-read');
    /* A click is the standard checkbox click path, once; the menu is closed. */
    env.row('headings').click();
    assert.deepEqual(plain(env.log.filter(l => /^check /.test(l))), ['check ViewTab:chHeadings true'], 'not one stock checkbox command');
    assert.equal(V.chHeadings.checked, true);
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stays open after the toggle');
    /* A standard checkbox lock (a cell edit) - the child is inactive with a reason; the others are alive. */
    V.chZeros.setDisabled(true);
    V.chZeros.keepState = ['cell-editing'];
    assert.deepEqual(plain(env.A.itemState(env.A.item('zeros'))), {disabled: true, reason: env.A.textEditing, checked: true}, 'a locked stock checkbox');
    assert.equal(env.A.itemState(show).disabled, false, 'the holder is off while a child is live');
    V.chZeros.setDisabled(false);
    /* The engine does not accept editing ("Viewing"): all four are inactive - the holder is disabled and does not open a layer. */
    env.api.canEdit = () => false;
    assert.equal(env.A.itemState(show).disabled, true, '«Show ▸» is live while the engine refuses editing');
    ['gridlines', 'headings', 'zeros', 'showFormulas'].forEach(k => assert.equal(env.A.itemState(env.A.item(k)).disabled, true, k + ' is live in view'));
    env.sectionBtn('View').click();
    env.row('show').click();
    assert.equal(env.flyRows().length, 0, 'a locked «Show ▸» opened its layer');
    delete env.api.canEdit;
    /* The coverage check: the checkboxes are the addresses "menu view > show > …", they are not in "Standard only". */
    const r = env.A.coverage();
    [['ViewTab:chGridlines', 'gridlines'], ['ViewTab:chHeadings', 'headings'], ['ViewTab:chZeros', 'zeros']].forEach(([ref, k]) => {
        assert.deepEqual(plain(r.byRef[ref].where), ['menu view > show > ' + k], ref + ': the coverage address');
        assert.equal(env.A.ADVANCED[ref], undefined, ref + ' is still advanced-only');
    });
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "View": "— Normal · Page layout (a checkmark on the current one) ·" - two items right in the section, without the "Mode ▸" submenu (the word
   "Mode" is taken by the "Editing / Viewing" switch in the header and by "Focus mode"): after "Show ▸" after a separator, first
   in the group with views. The items are the former - doubles of the view buttons, captions, the edit rule; a choice is one standard click of the
   button, the checkmark is on the current view; the engine does not change the sheet view without editing - both items are disabled. */
test('view_has_normal_and_page_layout_with_a_mark_on_the_current', () => {
    const env = makeEnv();
    env.create();
    const view = env.keys(env.group('View'));
    assert.deepEqual(view.slice(view.indexOf('show') + 1, view.indexOf('show') + 4), ['--', 'viewNormal', 'viewPageLayout'],
        'the view pair is not right after «Show ▸ —»: ' + view.join(' '));
    assert.ok(!deepKeys(env).includes('mode'), '«Mode ▸» is still in View');
    assert.equal(env.A.item('mode') === null, true, '«Mode ▸» is still in the catalog');
    assert.ok(!('textMode' in env.A), 'the default of «Mode» is left');
    assert.deepEqual(plain(['viewNormal', 'viewPageLayout'].map(k => env.A.offered(k)).map(i => [i.k, i.t, i.twin, i.check, i.edit])), [
        ['viewNormal', 'Normal', 'ViewTab:btnViewNormal', 'radio', true], ['viewPageLayout', 'Page layout', 'ViewTab:btnViewPageBreak', 'radio', true]],
        'the view pair is not the former items');
    env.roots.ViewTab.btnViewNormal.pressed = true;
    env.sectionBtn('View').click();
    const rows = () => ['viewNormal', 'viewPageLayout'].map(k => env.row(k));
    assert.deepEqual(plain(rows().map(r => [rowText(r), r.getAttribute('aria-checked'), !!r.querySelector('.vo-mn-chk')])),
        [['Normal', 'true', true], ['Page layout', 'false', false]], 'the mark is not at the current view');
    rows()[1].click();
    assert.deepEqual(plain(env.log.filter(l => /^click ViewTab:/.test(l))), ['click ViewTab:btnViewPageBreak'], 'not one stock click');
    assert.equal(env.shell.hasOpenSurfaces(), false);
    env.roots.ViewTab.btnViewNormal.pressed = false;
    env.roots.ViewTab.btnViewPageBreak.pressed = true;
    env.sectionBtn('View').click();
    assert.deepEqual(plain(rows().map(r => [rowText(r), r.getAttribute('aria-checked'), !!r.querySelector('.vo-mn-chk')])),
        [['Normal', 'false', false], ['Page layout', 'true', true]], 'the mark did not move to «Page layout»');
    env.log.length = 0;
    rows()[1].click();
    assert.deepEqual(plain(env.log.filter(l => /^click ViewTab:/.test(l))), [], 'the current view is chosen again');
    env.shell.closeSurfaces();
    env.api.canEdit = () => false;
    ['viewNormal', 'viewPageLayout'].forEach(k =>
        assert.equal(env.A.itemState(env.A.item(k)).disabled, true, k + ' is live while the engine refuses editing'));
    delete env.api.canEdit;
    const r = env.A.coverage();
    assert.deepEqual(plain(r.byRef['ViewTab:btnViewNormal'].where), ['menu view > viewNormal']);
    assert.deepEqual(plain(r.byRef['ViewTab:btnViewPageBreak'].where), ['menu view > viewPageLayout']);
    assert.equal(env.warnings.length, 0, 'unexpected warnings');
});

/* "View": "Named views ▸ · New view" → "Views ▸ (Named views: Default
   · the workbook views - View manager · New view)", merged. One layer: a group with the header "Named
   views" (the former item caption) - stock menu rows in place (the stock inner menu: "Default" and the workbook
   views with a checkmark on the open one); the stock separator closes the group (groups go through a separator) - "View
   manager" is already outside it; after it "New view". A header is not an item. Choosing a row is a standard item click; "New
   view" is the standard button. "Close view" is "Default" (also). In "Viewing" all are disabled - and the holder. */
test('view_views_submenu', () => {
    const env = makeEnv({presets: galleryPresets});
    env.create();
    const view = env.keys(env.group('View'));
    assert.deepEqual(view.slice(view.indexOf('viewPageLayout'), view.indexOf('viewPageLayout') + 2), ['viewPageLayout', 'views'],
        '«Views ▸» is not right after «Page layout»: ' + view.join(' '));
    assert.ok(!view.includes('sheetViews') && !view.includes('createView'), 'the former items are still at the top of View');
    const views = env.A.offered('views');
    /* The English default is the original ONLYOFFICE name, the case is as there. */
    assert.equal(views.t, 'Sheet View', 'the label of «Sheet View ▸»');
    assert.deepEqual(plain(kidKeys(views.items)), ['#Named views', 'mirror ViewTab:btnSheetView', 'createView'], 'the composition of «Views ▸»');
    env.sectionBtn('View').click();
    env.row('views').click();
    const fly = flyOf(env);
    assert.equal(fly.getAttribute('aria-label'), 'Sheet View');
    const kids = fly.children.map(c => c.getAttribute('role') === 'group' ? 'group:' + c.getAttribute('aria-label') + '[' +
        c.children.map(x => x.classList.contains('vo-mn-grp-t') ? '#' + x.textContent : x.classList.contains('vo-mn-sep') ? '--' : rowText(x)).join(', ') + ']'
        : c.classList.contains('vo-mn-sep') ? '--' : rowText(c));
    assert.deepEqual(plain(kids), ['group:Named views[#Named views, Default, View 1]', '--', 'Manager', 'Create view'],
        'the layer of «Views ▸»: the group ends at the stock separator');
    assert.notEqual(fly.querySelector('.vo-mn-grp-t').tagName, 'BUTTON', 'the group header is an item');
    assert.deepEqual(plain(ownRows(env).map(r => [rowText(r), r.getAttribute('aria-checked')])),
        [['Default', 'true'], ['View 1', null], ['Manager', null], ['Create view', null]], 'the check of the open view');
    ownRows(env)[1].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick /.test(l))), ['pick ViewTab:btnSheetView View 1'], 'a stock row is not picked by its stock item once');
    env.sectionBtn('View').click();
    env.row('views').click();
    ownRows(env)[3].click();
    assert.deepEqual(plain(env.log.filter(l => /^click ViewTab:/.test(l))), ['click ViewTab:btnCreateView'], '«Create view» is not one stock click');
    /* "Viewing": the holder is disabled, there is no layer. */
    env.api.canEdit = () => false;
    assert.equal(env.A.itemState(views).disabled, true, '«Views ▸» is live while the engine refuses editing');
    env.sectionBtn('View').click();
    env.row('views').click();
    assert.equal(flyOf(env), null, 'a locked «Views ▸» opened its layer');
    delete env.api.canEdit;
    const r = env.A.coverage();
    assert.deepEqual(plain(r.byRef['ViewTab:btnCloseView'].where), ['menu view > views > default'], 'Close view is not «Views ▸ Default»');
    assert.equal(env.warnings.length, 0, 'unexpected warnings');
});

/* "View": "Hidden sheets ▸" after "Views ▸" - the list of the hidden workbook sheets in workbook order; a choice shows
   the sheet and makes it current (the standard "Hidden" item of the tab menu: show:hidden → asc_showWorksheet). Sheets that are not in the
   standard hidden list are not here: the rows are a mirror of the standard submenu. No hidden ones - the item is visible and unavailable (the stock
   hides its own item). The workbook structure is protected or locked by a co-author - unavailable, like the standard command; the
   checkmark is set by the stock only on a right click on the tab and holds it until the next one - the item does not inherit it. During a cell
   edit it is unavailable with a reason. In "Viewing" it is unavailable. */
test('view_hidden_sheets', () => {
    /* There are no hidden sheets. */
    const none = makeEnv();
    none.create();
    const view = none.keys(none.group('View'));
    assert.deepEqual(view.slice(view.indexOf('views'), view.indexOf('views') + 2), ['views', 'hiddenSheets'],
        '«Hidden sheets ▸» is not right after «Views ▸»: ' + view.join(' '));
    const it0 = none.A.offered('hiddenSheets');
    assert.ok(it0, '«Hidden sheets ▸» is hidden without hidden sheets (it stays visible and unavailable)');
    assert.deepEqual([it0.t, it0.twin], ['Hidden sheets', 'Statusbar:tabMenu.items.5'], 'not the stock «Hidden» of the sheet tab menu');
    assert.equal(none.A.itemState(it0).disabled, true, '«Hidden sheets ▸» is live without hidden sheets');
    none.B.gaps.length = 0;
    none.sectionBtn('View').click();
    const row0 = none.row('hiddenSheets');
    assert.ok(row0.classList.contains('vo-has-sub'), '«Hidden sheets» row is not a submenu opener');
    assert.equal(row0.getAttribute('aria-disabled'), 'true');
    row0.click();
    assert.equal(none.flyRows().length, 0, 'an empty «Hidden sheets ▸» opened a layer');
    assert.deepEqual(plain(none.B.gaps), [], 'an empty «Hidden sheets ▸» was read as a stock gap');
    assert.equal(none.warnings.length, 0, 'unexpected warnings');
    /* Two hidden sheets: the rows are the standard list in workbook order; a choice is the standard item, the menu is closed. */
    const env = makeEnv({hiddenSheets: [['Plan', 1], ['Archive', 3]]});
    env.create();
    const it = env.A.offered('hiddenSheets');
    assert.equal(env.A.itemState(it).disabled, false, '«Hidden sheets ▸» is not live with hidden sheets');
    env.sectionBtn('View').click();
    env.row('hiddenSheets').click();
    assert.deepEqual(plain(env.flyRows().map(rowText)), ['Plan', 'Archive'], 'the rows are not the stock list of hidden sheets in the workbook order');
    env.flyRows()[1].click();
    assert.deepEqual(plain(env.log.filter(l => /^show hidden/.test(l))), ['show hidden 3'], 'the choice is not the stock item of the sheet');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stays open after the choice');
    /* A protected or locked workbook structure; the stock checkmark from the last right click is not ours. */
    env.roots.Statusbar.tabMenu.items[5].setDisabled(true);
    assert.equal(env.A.itemState(it).disabled, false, 'the stale stock mark of the last right click locked the item');
    env.api.workbookProtected = true;
    assert.equal(env.A.itemState(it).disabled, true, 'live with the workbook structure protected');
    env.api.workbookProtected = false;
    env.api.workbookLocked = true;
    assert.equal(env.A.itemState(it).disabled, true, 'live with the workbook structure locked by a co-author');
    env.api.workbookLocked = false;
    /* A cell edit, a connection loss, "Viewing". */
    env.api.isCellEdited = true;
    assert.deepEqual(plain(env.A.itemState(it)), {disabled: true, reason: env.A.textEditing, checked: false}, 'during a cell edit');
    env.api.isCellEdited = false;
    env.roots.Statusbar.mode.isDisconnected = true;
    assert.equal(env.A.itemState(it).disabled, true, 'live without the connection');
    env.roots.Statusbar.mode.isDisconnected = false;
    env.api.canEdit = () => false;
    assert.equal(env.A.itemState(it).disabled, true, 'live while the engine refuses editing');
    delete env.api.canEdit;
    assert.equal(env.A.itemState(it).disabled, false);
    assert.equal(env.warnings.length, 0, 'unexpected warnings');
});

/* "View": "Sheet direction" → "✓ Sheet direction" - the name is the former, the checkmark is when the right-to-left direction is on:
   a toggle by the pressed state of the standard "Sheet direction" button (the stock drives it by the sheet); after "Hidden sheets ▸"
   in one group, followed by a separator. A click is one standard button click; without editing the engine does not change the direction - in "Viewing"
   it is inactive (as before). */
test('view_sheet_direction_check', () => {
    const env = makeEnv();
    env.create();
    const view = env.keys(env.group('View'));
    assert.deepEqual(view.slice(view.indexOf('hiddenSheets'), view.indexOf('hiddenSheets') + 3), ['hiddenSheets', 'sheetDirection', '--'],
        '«Sheet direction» is not right after «Hidden sheets ▸», before the separator: ' + view.join(' '));
    const it = env.A.offered('sheetDirection');
    assert.deepEqual([it.t, it.twin, it.check, it.edit], ['Sheet direction', 'Toolbar:btnRtlSheet', true, true], 'not the former item with a check');
    const rtl = env.roots.Toolbar.btnRtlSheet;
    const look = () => { const r = env.row('sheetDirection'); return [r.getAttribute('role'), r.getAttribute('aria-checked'), !!r.querySelector('.vo-mn-chk')]; };
    env.sectionBtn('View').click();
    assert.deepEqual(look(), ['menuitemcheckbox', 'false', false], 'left to right: not an unchecked toggle');
    rtl.pressed = true;
    env.relock();
    assert.deepEqual(look(), ['menuitemcheckbox', 'true', true], 'right to left: the toggle is not checked');
    env.row('sheetDirection').click();
    assert.deepEqual(plain(env.log.filter(l => /btnRtlSheet/.test(l))), ['click Toolbar:btnRtlSheet'], 'not one stock click');
    env.api.canEdit = () => false;
    assert.equal(env.A.itemState(it).disabled, true, '«Sheet direction» is live while the engine refuses editing');
    delete env.api.canEdit;
    assert.equal(env.warnings.length, 0, 'unexpected warnings');
});

/* "View": "Macros · Record macro · Pause recording" → "Macros ▸" with the same items (merged), last after
   a separator. The captions and availability of the commands follow the state of the standard buttons throughout the whole recording cycle.
   In "Viewing" "Macros" is alive - the window does not change the workbook, "Record" and "Pause" are disabled -
   the holder is alive. */
test('view_macros_submenu', () => {
    const env = makeEnv();
    env.create();
    const view = env.keys(env.group('View'));
    assert.deepEqual(view.slice(-2), ['--', 'macrosMenu'], '«Macros ▸» is not the last item of View after a separator: ' + view.join(' '));
    assert.ok(!['macros', 'recordMacro', 'pauseMacro'].some(k => view.includes(k)), 'a macro item is still at the top of View');
    const holder = env.A.offered('macrosMenu');
    assert.equal(holder.t, 'Macros', 'the label of «Macros ▸»');
    assert.deepEqual(plain(Array.from(holder.items, i => [i.k, i.t, i.twin, !!i.edit])), [
        ['macros', 'Macros', 'ViewTab:btnMacros', false], ['recordMacro', 'Record macro', 'ViewTab:btnRecMacro', true],
        ['pauseMacro', 'Pause recording', 'ViewTab:btnPauseMacro', true]], 'the items of «Macros ▸» are not the former ones');
    const {btnRecMacro, btnPauseMacro} = env.roots.ViewTab;
    const setStockState = (record, pause, disabled) => {
        btnRecMacro.caption = record;
        btnPauseMacro.caption = pause;
        btnPauseMacro.setDisabled(disabled);
    };
    const openMacros = () => {
        env.sectionBtn('View').click();
        env.row('macrosMenu').click();
        return env.flyRows();
    };
    const expectRows = (record, pause, disabled) => {
        assert.deepEqual(plain(openMacros().map(r => [rowText(r), r.getAttribute('aria-disabled')])),
            [['Macros', 'false'], [record, 'false'], [pause, String(disabled)]]);
    };
    setStockState('Record macro', 'Pause recording', true);
    expectRows('Record macro', 'Pause recording', true);
    env.flyRows()[0].click();
    openMacros()[1].click();
    setStockState('Stop recording', 'Pause recording', false);
    expectRows('Stop recording', 'Pause recording', false);
    env.flyRows()[2].click();
    setStockState('Stop recording', 'Resume recording', false);
    expectRows('Stop recording', 'Resume recording', false);
    env.flyRows()[2].click();
    setStockState('Stop recording', 'Pause recording', false);
    expectRows('Stop recording', 'Pause recording', false);
    env.flyRows()[1].click();
    setStockState('Record macro', 'Pause recording', true);
    expectRows('Record macro', 'Pause recording', true);
    assert.deepEqual(plain(env.log.filter(l => /^click ViewTab:btn(Macros|RecMacro|PauseMacro)/.test(l))), [
        'click ViewTab:btnMacros', 'click ViewTab:btnRecMacro', 'click ViewTab:btnPauseMacro',
        'click ViewTab:btnPauseMacro', 'click ViewTab:btnRecMacro'
    ]);
    /* "Viewing": "Macros" is alive, recording is disabled, the holder is alive. */
    env.api.canEdit = () => false;
    assert.equal(env.A.itemState(holder).disabled, false, '«Macros ▸» is off in view («Macros» stays live)');
    assert.equal(env.A.itemState(env.A.item('macros')).disabled, false, '«Macros» is off in view');
    ['recordMacro', 'pauseMacro'].forEach(k => assert.equal(env.A.itemState(env.A.item(k)).disabled, true, k + ' is live in view'));
    delete env.api.canEdit;
    const r = env.A.coverage();
    [['ViewTab:btnMacros', 'macros'], ['ViewTab:btnRecMacro', 'recordMacro'], ['ViewTab:btnPauseMacro', 'pauseMacro']].forEach(([ref, k]) =>
        assert.deepEqual(plain(r.byRef[ref].where), ['menu view > macrosMenu > ' + k], ref + ': the coverage address'));
    assert.equal(env.warnings.length, 0, 'unexpected warnings');
});

/* In "Viewing" "Macros ▸ → Macros" is available; for a reader the stock does not build macro buttons
   (view/ViewTab.js - only with the edit right) - "Macros" is alive and opens the window with the click handler of the standard button (onClickMacros), once;
   "Record" and "Pause" without buttons are inactive. The button exists - the command is by its click, as before (view_macros_submenu). The integration
   turned macros off (customization.macros: false) - there is no "Macros ▸". */
test('macros_without_stock_button_open_stock_window', () => {
    const env = makeEnv({presets: () => ({viewTab: {btnMacros: undefined, btnRecMacro: undefined, btnPauseMacro: undefined}})});
    env.create();
    const holder = env.A.offered('macrosMenu');
    assert.ok(holder, '«Macros ▸» is not offered without the stock macro buttons');
    assert.equal(env.A.itemState(holder).disabled, false, '«Macros ▸» is off without the stock buttons');
    assert.equal(env.A.itemState(env.A.item('macros')).disabled, false, '«Macros» is off without the stock button');
    ['recordMacro', 'pauseMacro'].forEach(k => assert.equal(env.A.itemState(env.A.item(k)).disabled, true, k + ' is live without its stock button'));
    env.sectionBtn('View').click();
    env.row('macrosMenu').click();
    env.log.length = 0;
    env.flyRows()[0].click();
    assert.deepEqual(plain(env.log.filter(l => /macros/i.test(l))), ['stock macros window'], 'not one stock macros window');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stayed open over the window');
    const off = makeEnv({options: {customization: {macros: false}}});
    off.create();
    assert.equal(off.A.offered('macrosMenu'), null, '«Macros ▸» without macros at the integration');
});

/* The full "View" composition: Freeze panes ▸ · Zoom ▸ · Show ▸ (✓ Gridlines
   · ✓ Headings · ✓ Zeros · ✓ Show formulas) — Normal · Page layout · Views ▸ (Named
   views: Default · the workbook views — View manager · New view) · Hidden sheets ▸ ·
   ✓ Sheet direction — Hide toolbar · Focus mode — Macros ▸ (Macros · Record macro · Pause recording).
   The captions are defaults (English; the locale is in the live case), for "Zeros" - the standard "Show zeros". */
test('view_composition', () => {
    const env = makeEnv({presets: galleryPresets});
    env.create();
    const view = env.A.groups()[2];
    assert.deepEqual(plain(env.keys(view)), ['freeze', 'zoom', 'show', '--', 'viewNormal', 'viewPageLayout', 'views', 'hiddenSheets', 'sheetDirection', '--',
        'hideToolbar', 'focus', '--', 'macrosMenu'], 'View');
    const kids = k => plain(kidKeys(env.A.offered(k).items));
    assert.deepEqual(kids('zoom'), [50, 75, 100, 125, 150, 200].map(z => 'zoom' + z));
    assert.deepEqual(kids('show'), ['gridlines', 'headings', 'zeros', 'showFormulas']);
    assert.deepEqual(kids('views'), ['#Named views', 'mirror ViewTab:btnSheetView', 'createView']);
    assert.deepEqual(kids('macrosMenu'), ['macros', 'recordMacro', 'pauseMacro']);
    env.sectionBtn('View').click();
    assert.deepEqual(plain(env.doc.querySelectorAll('#vo-shell .vo-mn-drop.open [data-k]').map(r => [rowText(r), r.classList.contains('vo-has-sub')])), [
        /* "Sheet View" is the original English ONLYOFFICE name. */
        ['Freeze panes', true], ['Zoom', true], ['Show', true], ['Normal', false], ['Page layout', false], ['Sheet View', true], ['Hidden sheets', true], ['Sheet direction', false],
        ['Hide toolbar', false], ['Focus mode', false], ['Macros', true]], 'View rows and ▸');
    assert.equal(env.row('sheetDirection').getAttribute('role'), 'menuitemcheckbox', '«✓ Sheet direction» is not a toggle');
});

test('view_opens_the_selected_contextual_ribbon_panel', () => {
    const env = makeEnv();
    const {doc, roots, shell, api, NC} = env;
    let selected = null;
    const cellInfo = api.asc_getCellInfo.bind(api);
    env.context.Asc.c_oAscSelectionType = {RangeCells: 1, RangeChart: 2, RangeChartText: 3, RangeImage: 4};
    api.asc_getCellInfo = () => Object.assign(cellInfo(), {
        asc_getSelectionType: () => selected === 'charttab' ? 2 : selected === 'image' ? 4 : 1,
        asc_getPivotTableInfo: () => selected === 'pivot' ? {} : null,
        asc_getFormatTableInfo: () => selected === 'tabledesign' ? {} : null,
        asc_getSparklineInfo: () => selected === 'sparklinetab' ? {} : null
    });
    const ribbon = doc.querySelector('#toolbar .toolbar');
    const tabs = ribbon.appendChild(doc.createElement('ul'));
    const controls = ribbon.appendChild(doc.createElement('section'));
    controls.className = 'box-controls';
    const panels = {};
    const tabsByAction = {};
    const moreContainer = ribbon.appendChild(doc.createElement('div'));
    moreContainer.className = 'dropdown-menu more-container';
    const overflow = moreContainer.appendChild(doc.createElement('div'));
    const overflowButton = overflow.appendChild(doc.createElement('button'));
    overflowButton.setAttribute('data-toggle', 'dropdown');
    moreContainer.style.display = 'none';
    for (const action of ['pivot', 'tabledesign', 'charttab', 'sparklinetab']) {
        const li = tabs.appendChild(doc.createElement('li'));
        const link = li.appendChild(doc.createElement('a'));
        link.setAttribute('data-tab', action);
        li.style.display = 'none';
        tabsByAction[action] = li;
        panels[action] = controls.appendChild(doc.createElement('section'));
    }
    roots.Toolbar.getTab = action => panels[action] ? [panels[action]] : undefined;
    roots.Toolbar.getMorePanel = action => action === 'pivot' ? [overflow] : undefined;
    roots.Toolbar.closeVisibleMoreDropdown = () => { moreContainer.style.display = 'none'; };
    const moreBox = panels.pivot.appendChild(doc.createElement('div'));
    moreBox.className = 'more-box';
    const moreButton = moreBox.appendChild(doc.createElement('button'));
    roots.Toolbar.setTab = action => {
        roots.Toolbar.activeTab = action;
        NC.trigger('tab:active', action);
    };
    roots.Toolbar.isTabActive = action => roots.Toolbar.activeTab === action;
    env.create();
    for (const action of Object.keys(panels)) {
        assert.equal(env.A.offered('context-' + action), null);
        tabsByAction[action].style.display = '';
        if (action === 'sparklinetab') {
            assert.equal(env.A.offered('context-' + action), null, 'the stock tab can start visible before a sparkline is selected');
        }
        selected = action;
        api.isCellEdited = true;
        assert.equal(env.A.exec(env.A.offered('context-' + action), shell), false);
        api.isCellEdited = false;
        env.sectionBtn('View').click();
        env.row('context-' + action).click();
        assert.equal(roots.Toolbar.activeTab, action);
        assert.equal(doc.body.classList.contains('vo-context-ribbon'), true);
        assert.equal(doc.body.classList.contains('vo-compact'), true);
        assert.equal(doc.activeElement, panels[action]);
        if (action === 'pivot') {
            assert.equal(overflowButton.classList.contains('move-focus'), true);
            moreContainer.style.display = '';
            overflowButton.focus();
            assert.equal(env.escape(overflowButton).defaultPrevented, true);
            assert.equal(moreContainer.style.display, 'none');
            assert.equal(doc.activeElement, moreButton);
            assert.equal(doc.body.classList.contains('vo-context-ribbon'), true);
        }
        env.sectionBtn('View').click();
        assert.equal(env.row('context-' + action).getAttribute('aria-checked'), 'true');
        env.shell.closeSurfaces();
        selected = 'image';
        api.handlers.asc_onSelectionChanged.forEach(fn => fn(api.asc_getCellInfo()));
        assert.equal(doc.body.classList.contains('vo-context-ribbon'), false);
        assert.equal(env.A.offered('context-' + action), null, 'the stock tab may still be visible after selection changes');
        tabsByAction[action].style.display = 'none';
    }
    selected = 'charttab';
    tabsByAction.charttab.style.display = '';
    env.sectionBtn('View').click();
    env.row('context-charttab').click();
    const width = panels.charttab.appendChild(doc.createElement('input'));
    assert.equal(env.escape(width).defaultPrevented, false, 'the input keeps its own Escape behavior');
    assert.equal(doc.body.classList.contains('vo-context-ribbon'), true);
    const leftMenu = doc.body.appendChild(doc.createElement('div'));
    leftMenu.id = 'left-menu';
    const search = leftMenu.appendChild(doc.createElement('input'));
    assert.equal(env.escape(search).defaultPrevented, false, 'search keeps its own Escape behavior');
    assert.equal(doc.body.classList.contains('vo-context-ribbon'), true);
    const dropdown = panels.charttab.appendChild(doc.createElement('div'));
    dropdown.className = 'btn-group open';
    const toggle = dropdown.appendChild(doc.createElement('button'));
    const item = dropdown.appendChild(doc.createElement('a'));
    for (const target of [toggle, item]) {
        target.focus();
        assert.equal(env.escape(target).defaultPrevented, false, 'the stock dropdown handles Escape');
        assert.equal(doc.body.classList.contains('vo-context-ribbon'), true);
    }
    dropdown.classList.remove('open');
    env.escape();
    assert.equal(doc.body.classList.contains('vo-context-ribbon'), false);
    assert.equal(roots.Toolbar.activeTab, 'home');
    env.sectionBtn('View').click();
    env.row('context-charttab').click();
    env.sectionBtn('View').click();
    env.row('context-charttab').click();
    assert.equal(doc.body.classList.contains('vo-context-ribbon'), false, 'selecting the same command closes its panel');
    env.sectionBtn('View').click();
    env.row('context-charttab').click();
    env.sectionBtn('View').click();
    env.row('hideToolbar').click();
    assert.equal(doc.body.classList.contains('vo-tb-hidden'), true);
    assert.equal(doc.body.classList.contains('vo-context-ribbon'), false, 'hiding the toolbar also hides the contextual panel');
    const contextCommand = env.A.offered('context-charttab');
    assert.equal(env.A.exec(contextCommand, shell), false, 'the context command is unavailable while the toolbar is hidden');
    env.sectionBtn('View').click();
    env.row('hideToolbar').click();
    assert.equal(env.A.exec(contextCommand, shell), true, 'showing the toolbar restores access to the panel');
});

/* Keyboard shortcuts are shown to the right of a menu item if the command has one: "Edit → Clear ▸ Contents" is the same
   command as the Delete key (WorkbookView._onEmpty: emptySelection(Text)), - to the right of the row is the shortcut of the ClearSelectedCellsContent action
   from the standard registry; the other "Clear ▸" rows have no shortcuts. No action in the registry - no hint either. The row and its choice are
   standard. The negative control is a catalog without rowSc and a shell with a mirror without mirrorRows. */
const CLEAR_FIVE = (doc, log) => ({toolbar: {btnClearStyle: button('Toolbar:btnClearStyle', log, {menu: (() => {
    const m = menu([item('All', {value: CLEAN.All}), item('Contents', {value: CLEAN.Text}), item('Format', {value: CLEAN.Format}),
        item('Comments', {value: CLEAN.Comments}), item('Links', {value: CLEAN.Hyperlinks})]);
    m.on('item:click', (mm, it) => log.push('pick Toolbar:btnClearStyle ' + it.caption));
    return m;
})()})}});
test('clear_contents_shows_delete_shortcut', () => {
    const env = makeEnv({presets: CLEAR_FIVE, shortcuts: {ClearSelectedCellsContent: ['Delete']}});
    env.create();
    env.sectionBtn('Edit').click();
    env.row('clear').click();
    const rows = () => plain(env.flyRows().map(r => [rowText(r), (r.querySelector('.vo-mn-h') || {}).textContent || '']));
    assert.deepEqual(rows(), [['All', ''], ['Contents', 'Delete'], ['Format', ''], ['Comments', ''], ['Links', '']], '«Clear ▸» rows and their shortcuts');
    env.flyRows()[1].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick Toolbar:btnClearStyle/.test(l))), ['pick Toolbar:btnClearStyle Contents'], 'not one stock pick of «Contents»');
    const none = makeEnv({presets: CLEAR_FIVE, shortcuts: {}});
    none.create();
    none.sectionBtn('Edit').click();
    none.row('clear').click();
    assert.ok(none.flyRows().every(r => !r.querySelector('.vo-mn-h')), 'a hint without the stock action in the registry');
    assert.equal(env.warnings.length + none.warnings.length, 0, 'unexpected warnings');
});

/* Hovering a disabled row with a submenu does not open its layer; the open neighboring layer is not closed by the shared menu row
   in that case (that is how it is there and in Documents). The "Clear ▸" layer is open; "Delete cells ▸" is disabled (the stock disabled the button); the live
   "Fill ▸" - opens its own and replaces the neighboring one. */
test('hover_locked_submenu_row_opens_no_layer', () => {
    const env = makeEnv();
    env.create();
    env.sectionBtn('Edit').click();
    env.row('clear').click();
    assert.deepEqual(plain(env.flyRows().map(rowText)), ['First btnClearStyle', 'Second btnClearStyle'], 'precondition: «Clear ▸» is open');
    env.roots.Toolbar.btnDeleteCell.setDisabled(true);
    env.relock();
    assert.equal(env.row('deleteCells').getAttribute('aria-disabled'), 'true', 'precondition: «Delete cells ▸» is locked');
    env.row('deleteCells').dispatch('mouseenter');
    env.flush();
    assert.deepEqual(plain(env.flyRows().map(rowText)), ['First btnClearStyle', 'Second btnClearStyle'], 'hover on a locked row with a submenu replaced the layer');
    assert.ok(!env.row('deleteCells').classList.contains('vo-sub-open'), 'a locked row opened its submenu');
    env.row('clear').dispatch('mouseenter');
    env.flush();
    assert.deepEqual(plain(env.flyRows().map(rowText)), ['First btnClearStyle', 'Second btnClearStyle'], 'hover on a live row did not open its layer');
    env.row('fill').dispatch('mouseenter');
    env.flush();
    assert.deepEqual(plain(env.flyRows().map(rowText)), ['First btnFillNumbers', 'Second btnFillNumbers'], 'hover on the next live row did not switch the layer');
    env.roots.Toolbar.btnDeleteCell.setDisabled(false);
    assert.equal(env.warnings.length, 0, 'unexpected warnings');
});

/* --- "Insert" and "Data" ----------------------------- */

/* "Insert → Sheet" is after "Insert cells ▸", in one group: a click of the sheet row "+" button (Statusbar:btnAddWorksheet), one -
   the new sheet is placed right after the current one, as from "+"; availability comes from this button (the stock disables it on a cell edit, a lock and
   workbook structure protection); a sheet changes the workbook - when the engine does not accept editing, the item is inactive. There is no glyph. The check address is
   "menu insert > sheet". */
test('insert_sheet_clicks_stock_button', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const ins = env.keys(env.group('Insert'));
    assert.deepEqual(ins.slice(0, 3), ['insertCells', 'sheet', '--'], '«Sheet» is not right after «Insert cells ▸» in its group: ' + ins.join(' '));
    const it = env.A.item('sheet');
    assert.deepEqual([it.t, it.twin, it.edit, it.i, !!it.sub], [env.A.textSheet, 'Statusbar:btnAddWorksheet', true, undefined, false],
        '«Sheet» is not the stock «+» of the sheet tabs row (label, twin, edit, no glyph, no submenu)');
    assert.equal(env.A.textSheet, 'Sheet', 'the default of «Sheet»');
    assert.equal(deepKeys(env).filter(k => k === 'sheet').length, 1, '«Sheet» is in two places');
    const btn = env.roots.Statusbar.btnAddWorksheet;
    env.sectionBtn('Insert').click();
    const row = env.row('sheet');
    assert.equal(rowText(row), 'Sheet', 'the row label');
    assert.ok(!row.classList.contains('vo-has-sub'), '«Sheet» has ▸');
    assert.equal(row.getAttribute('aria-disabled'), 'false', '«Sheet» is inactive in editing');
    row.click();
    assert.deepEqual(plain(env.log.filter(l => /Statusbar:btnAddWorksheet/.test(l))), ['click Statusbar:btnAddWorksheet'], 'not one stock click of «+»');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stays open after «Sheet»');
    /* The stock disabled "+" (a cell edit, a lock or workbook structure protection) - the item is inactive, the click goes nowhere. */
    btn.setDisabled(true);
    assert.equal(env.A.itemState(it).disabled, true, '«Sheet» is live while the stock «+» is locked');
    env.log.length = 0;
    env.sectionBtn('Insert').click();
    env.row('sheet').click();
    assert.deepEqual(plain(env.log.filter(l => /Statusbar:btnAddWorksheet/.test(l))), [], 'a locked «Sheet» reached the stock button');
    btn.setDisabled(false);
    /* The engine does not accept editing ("Viewing") - inactive, although the sheet row button is alive (the row is not the ribbon, there is no mask). */
    env.api.canEdit = () => false;
    assert.equal(env.A.itemState(it).disabled, true, '«Sheet» is live in «Viewing»');
    delete env.api.canEdit;
    assert.equal(env.A.itemState(it).disabled, false, '«Sheet» stays locked after «Viewing»');
    assert.ok(plain(env.A.addressBook()['Statusbar:btnAddWorksheet'] || []).includes('menu insert > sheet'), 'the address of «Sheet»');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Insert" and "Data": "Insert → Slicer" → "Data → Slicer" after "Clear filter" (a filtering tool): the same item -
   the standard "Slicer" button of the "Insert" ribbon tab, one click; without a source it is inactive, as in the stock; "Insert" does not have it. The check
   address is "menu data > slicer" (and for the "Slicer" of the formatted table tab - the same command). */
test('slicer_moved_from_insert_to_data', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    assert.ok(!env.keys(env.group('Insert')).includes('slicer'), '«Slicer» is still in Insert');
    const data = env.keys(env.group('Data'));
    assert.deepEqual(data.slice(data.indexOf('filter'), data.indexOf('filter') + 4), ['filter', 'clearFilter', 'slicer', 'validation'],
        '«Slicer» is not right after «Clear filter» in Data: ' + data.join(' '));
    const twins = [];
    const walk = list => list.forEach(i => { if (i.twin === 'Toolbar:btnInsertSlicer') twins.push(i.k); if (i.items) walk(i.items); });
    env.A.catalog().forEach(g => walk(g.items));
    assert.deepEqual(twins, ['slicer'], 'the stock «Slicer» is the twin of more than one item');
    const it = env.A.item('slicer');
    assert.deepEqual([it.t, it.twin, !!it.sub, !!it.gallery], [env.A.textSlicer, 'Toolbar:btnInsertSlicer', false, false], '«Slicer» moved not as it was');
    env.sectionBtn('Data').click();
    assert.equal(rowText(env.row('slicer')), 'Slicer');
    env.row('slicer').click();
    assert.deepEqual(plain(env.log.filter(l => /btnInsertSlicer/.test(l))), ['click Toolbar:btnInsertSlicer'], 'not one stock click of «Slicer»');
    env.roots.Toolbar.btnInsertSlicer.setDisabled(true);
    assert.equal(env.A.itemState(it).disabled, true, '«Slicer» without a source is live');
    const r = env.A.coverage();
    assert.deepEqual(plain(r.byRef['Toolbar:btnInsertSlicer'].where), ['menu data > slicer'], 'the coverage address of «Slicer»');
    assert.deepEqual(plain(r.byRef['TableDesign:btnInsertSlicer'].where), ['menu data > slicer'], 'the table design «Slicer» is the same command');
});

/* "Insert": without "Table" (a duplicate of "Format → Format as table") and without "SmartArt · TextArt · Equations"
   (they are hardly needed in spreadsheets). In no section or submenu are there these items,
   or items with their standard buttons; the standard table style gallery is one item "Format as table"; "Insert" is exactly
   the full composition. The coverage check: SmartArt, TextArt and the equation are "Standard only" with a reason, the ribbon
   "Table" button is the address "Format as table" (the same command, SAME); no holes. No caption defaults are left. */
test('insert_without_table_smartart_textart_equation', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    assert.deepEqual(plain(env.keys(env.group('Insert'))), ['insertCells', 'sheet', '--', 'function', 'chart', 'sparkline', 'pivot', '--',
        'image', 'shape', 'textBox', 'symbol', '--', 'link', 'comment'], 'Insert');
    const gone = ['table', 'smartArt', 'textArt', 'equation'];
    assert.deepEqual(deepKeys(env).filter(k => gone.includes(k)), [], 'a removed item is still offered');
    gone.forEach(k => assert.equal(env.A.item(k), null, k + ' is still in the catalog'));
    const REFS = ['Toolbar:btnInsertSmartArt', 'Toolbar:btnInsertTextArt', 'Toolbar:btnInsertEquation', 'Toolbar:btnInsertTable'];
    const twins = [], tables = [];
    const walk = list => list.forEach(i => {
        if (REFS.includes(i.twin) || REFS.includes(i.mirror)) twins.push(i.k);
        if (i.twin === 'Toolbar:btnTableTemplate') tables.push(i.k);
        if (i.items) walk(i.items);
    });
    env.A.catalog().forEach(g => walk(g.items));
    assert.deepEqual(twins, [], 'an item on a removed stock command: ' + twins.join(' '));
    assert.deepEqual(tables, ['formatAsTable'], 'the stock table style gallery is not one «Format as table»');
    ['textTable', 'textSmartArt', 'textTextArt', 'textEquation'].forEach(k => assert.equal(env.A[k], undefined, 'the default ' + k + ' is left'));
    env.sectionBtn('Insert').click();
    assert.deepEqual(plain(env.doc.querySelectorAll('#vo-shell .vo-mn-drop.open [data-k]').map(r => r.getAttribute('data-k'))),
        ['insertCells', 'sheet', 'function', 'chart', 'sparkline', 'pivot', 'image', 'shape', 'textBox', 'symbol', 'link', 'comment'], 'Insert rows');
    const r = env.A.coverage();
    ['Toolbar:btnInsertSmartArt', 'Toolbar:btnInsertTextArt', 'Toolbar:btnInsertEquation'].forEach(ref => {
        assert.deepEqual(plain(r.byRef[ref].where), [], ref + ' still has an address in compact');
        assert.ok(/^Not in the compact shell: .* is not in Insert /.test(r.byRef[ref].why), ref + ' has no reason: ' + r.byRef[ref].why);
    });
    assert.deepEqual(plain(r.byRef['Toolbar:btnInsertTable'].where), ['menu format > formatAsTable'], 'the stock «Table» is not «Format as table»');
    assert.deepEqual(plain(r.missing), [], 'coverage holes: ' + r.missing.join(', '));
});

/* "Data": "Calculation options ▸ · Trace precedents · Trace dependents · Remove arrows ▸ · Watch window" →
   "Formulas ▸" - one level, two groups with headers: "Calculation options: Calculate workbook · Calculate current
   sheet — Formula auditing: Trace precedents · Trace dependents · Remove arrows · Remove precedent arrows · Remove
   dependent arrows · ✓ Watch window". The same actions and names: the calculate and arrow rows are the items of the
   standard menus of the "Calculate" and "Remove arrows" buttons by value (stock captions), the others are the former items; two submenus became
   groups, there are no submenus inside a submenu. On the right are the standard shortcuts F9 and ⇧+F9; "Watch window" has a
   checkmark by the button pressed state. Each row is one standard call. */
test('formulas_one_level_two_headed_groups', () => {
    const env = makeEnv({shortcuts: {RecalculateAll: ['F9'], RecalculateActiveSheet: ['⇧', 'F9']}});
    env.create();
    checkCatalog(env.A.catalog());
    const data = env.keys(env.group('Data'));
    /* "Data": "— Formulas ▸ · Analysis ▸" - "Analysis ▸" after "Formulas ▸" in the same group. */
    assert.deepEqual(data.slice(-3, -1), ['--', 'formulas'], '«Formulas ▸» does not open the last group of Data: ' + data.join(' '));
    ['calcOptions', 'tracePrecedents', 'traceDependents', 'removeArrows', 'watchWindow'].forEach(k =>
        assert.ok(!data.includes(k), k + ' is still at the top of Data'));
    const holder = env.A.offered('formulas');
    assert.equal(holder.t, 'Formulas', 'the label of «Formulas ▸»');
    assert.equal(env.A.textFormulas, 'Formulas');
    assert.ok(!holder.twin && !holder.run && !holder.sub, '«Formulas ▸» is a composite item, not a command');
    assert.deepEqual(kidKeys(holder.items), ['#Calculation options', 'recalcWorkbook', 'recalcSheet', '--', '#Formula auditing', 'tracePrecedents',
        'traceDependents', 'removeArrows', 'removePrecedentArrows', 'removeDependentArrows', 'watchWindow'], '«Formulas ▸»: two headed groups');
    assert.equal(env.A.textFormulaAuditing, 'Formula auditing');
    const kids = {};
    holder.items.forEach(i => { if (i.k) kids[i.k] = i; });
    [['recalcWorkbook', 'Formula:btnCalculate', CALC.All], ['recalcSheet', 'Formula:btnCalculate', CALC.ActiveSheet],
     ['removeArrows', 'Formula:btnRemArrows', ARROWS.all], ['removePrecedentArrows', 'Formula:btnRemArrows', ARROWS.precedent],
     ['removeDependentArrows', 'Formula:btnRemArrows', ARROWS.dependent]].forEach(([k, twin, v]) => {
        const it = kids[k];
        assert.equal(it.twin, twin, k + ': twin');
        assert.ok(it.pick && typeof it.pick.value === 'function' && it.pick.value() === v, k + ': not the stock item by its value ' + v);
        assert.equal(it.t, undefined, k + ': an own label instead of the stock caption');
        assert.ok(!it.items && !it.sub, k + ': a submenu inside a submenu');
    });
    assert.deepEqual([kids.watchWindow.twin, kids.watchWindow.check, kids.watchWindow.t], ['Formula:btnWatch', true, env.A.textWatchWindow], '«Watch window»');
    assert.deepEqual([kids.tracePrecedents.twin, kids.traceDependents.twin], ['Formula:btnTracePrec', 'Formula:btnTraceDep'], 'trace items');
    /* The layer: two groups with headers through a separator, the rows are stock captions, on the right are the shortcuts. */
    env.sectionBtn('Data').click();
    env.row('formulas').click();
    const fly = flyOf(env);
    assert.ok(fly, 'no «Formulas ▸» layer');
    assert.equal(fly.getAttribute('aria-label'), 'Formulas');
    const groups = fly.children.filter(c => c.getAttribute('role') === 'group');
    assert.deepEqual(plain(fly.children.map(c => c.getAttribute('role') === 'group' ? 'group ' + c.getAttribute('aria-label') : c.classList.contains('vo-mn-sep') ? '--' : 'row')),
        ['group Calculation options', '--', 'group Formula auditing'], 'the layer is not two groups through a separator');
    assert.ok(groups.every(g => g.children[0].classList.contains('vo-mn-grp-t') && g.children[0].tagName !== 'BUTTON'), 'a group without its header');
    assert.deepEqual(plain(ownRows(env).map(r => [r.getAttribute('data-k'), rowText(r), (r.querySelector('.vo-mn-h') || {textContent: ''}).textContent])), [
        ['recalcWorkbook', 'Calculate workbook', 'F9'], ['recalcSheet', 'Calculate current sheet', '⇧+F9'],
        ['tracePrecedents', 'Trace precedents', ''], ['traceDependents', 'Trace dependents', ''], ['removeArrows', 'Remove arrows', ''],
        ['removePrecedentArrows', 'Remove precedent arrows', ''], ['removeDependentArrows', 'Remove dependent arrows', ''], ['watchWindow', 'Watch window', '']],
        'rows of «Formulas ▸»: stock captions and shortcuts');
    assert.ok(ownRows(env).every(r => !r.classList.contains('vo-has-sub')), 'a row with ▸ inside «Formulas ▸»');
    /* A row is one standard call. */
    const picks = {recalcWorkbook: 'pick Formula:btnCalculate Calculate workbook', recalcSheet: 'pick Formula:btnCalculate Calculate current sheet',
        tracePrecedents: 'click Formula:btnTracePrec', traceDependents: 'click Formula:btnTraceDep', removeArrows: 'pick Formula:btnRemArrows Remove arrows',
        removePrecedentArrows: 'pick Formula:btnRemArrows Remove precedent arrows', removeDependentArrows: 'pick Formula:btnRemArrows Remove dependent arrows',
        watchWindow: 'click Formula:btnWatch'};
    Object.keys(picks).forEach(k => {
        env.log.length = 0;
        env.shell.closeSurfaces();
        env.sectionBtn('Data').click();
        env.row('formulas').click();
        env.row(k).click();
        assert.deepEqual(plain(env.log.filter(l => /Formula:/.test(l))), [picks[k]], k + ': not one stock call');
        assert.equal(env.shell.hasOpenSurfaces(), false, k + ': the menu stays open');
    });
    /* A checkmark on an open "Watch window" - by the button pressed state. */
    env.sectionBtn('Data').click();
    env.row('formulas').click();
    assert.deepEqual([env.row('watchWindow').getAttribute('role'), env.row('watchWindow').getAttribute('aria-checked')], ['menuitemcheckbox', 'true'],
        'the open watch window has no check');
    env.roots.Formula.btnWatch.pressed = false;
    env.relock();
    assert.equal(env.row('watchWindow').getAttribute('aria-checked'), 'false', 'the closed watch window keeps its check');
    const r = env.A.coverage();
    assert.deepEqual(plain(r.byRef['Formula:btnCalculate'].where), ['menu data > formulas > recalcWorkbook', 'menu data > formulas > recalcSheet']);
    assert.deepEqual(plain(r.byRef['Formula:btnRemArrows'].where), ['menu data > formulas > removeArrows', 'menu data > formulas > removePrecedentArrows',
        'menu data > formulas > removeDependentArrows']);
    assert.deepEqual(plain(r.byRef['Formula:btnWatch'].where), ['menu data > formulas > watchWindow']);
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Formulas ▸" is available under the same conditions as the standard buttons of the "Formula" tab: a cell edit or
   a co-author lock disables all of them - the holder is inactive with the reason of the first child, no layer; under the restriction mask ("Viewing")
   - inactive with the "Viewing" reason (in "Viewing" "Formulas ▸" is unavailable). One button is disabled - its rows are inactive, the others are
   alive. */
test('formulas_holder_follows_stock_locks', () => {
    const env = makeEnv();
    env.create();
    const holder = () => env.A.offered('formulas');
    const F = env.roots.Formula;
    const all = ['btnCalculate', 'btnTracePrec', 'btnTraceDep', 'btnRemArrows', 'btnWatch'];
    F.btnCalculate.setDisabled(true);
    F.btnCalculate.keepState = ['cell-editing'];
    assert.equal(env.A.itemState(env.A.item('recalcWorkbook')).disabled, true, 'a recalculation row is live under a locked «Calculation» button');
    assert.equal(env.A.itemState(env.A.item('removeArrows')).disabled, false, 'another button went off');
    assert.equal(env.A.itemState(holder()).disabled, false, '«Formulas ▸» is off while some rows are live');
    all.forEach(n => { F[n].setDisabled(true); F[n].keepState = ['cell-editing']; });
    assert.deepEqual(plain(env.A.itemState(holder())), {disabled: true, reason: env.A.textEditing, checked: false}, '«Formulas ▸» during the cell edit');
    env.sectionBtn('Data').click();
    env.row('formulas').click();
    assert.equal(flyOf(env), null, 'a locked «Formulas ▸» opened its layer');
    all.forEach(n => { F[n].setDisabled(false); F[n].keepState = []; });
    env.shell.closeSurfaces();
    const masked = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    assert.deepEqual(plain(env.A.itemCode(holder(), masked)), {disabled: true, reason: 'view', checked: false}, '«Formulas ▸» in «Viewing»');
});

/* "Data": "Goal Seek · Solver" → "Analysis ▸ Goal Seek · Solver" - merged, after "Formulas ▸" in the same
   group. The items are the former: the buttons of the "Data" ribbon tab (their standard windows), the captions are shell keys (the Russian "Solution search" is the
   standard name, staple_names_as_stock); at the top level of "Data" they are absent. The holder is disabled when both buttons are disabled (a cell
   edit, a co-author; the "Viewing" mask). The check addresses are "menu data > analysis > …". */
test('analysis_holder_two_items', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const data = env.keys(env.group('Data'));
    assert.deepEqual(data.slice(-3), ['--', 'formulas', 'analysis'], '«Analysis ▸» is not right after «Formulas ▸» at the end of Data: ' + data.join(' '));
    assert.ok(!data.includes('goalSeek') && !data.includes('solver'), 'goal seek or solver is still at the top of Data');
    const holder = env.A.offered('analysis');
    assert.equal(holder.t, 'Analysis', 'the label of «Analysis ▸»');
    assert.equal(env.A.textAnalysis, 'Analysis');
    assert.ok(!holder.twin && !holder.run && !holder.sub, '«Analysis ▸» is a composite item, not a command');
    /* The English default is the original ONLYOFFICE name, the case is as there. */
    assert.deepEqual(plain(Array.from(holder.items, i => [i.k, i.t, i.twin])), [['goalSeek', 'Goal Seek', 'DataTab:btnGoalSeek'],
        ['solver', 'Solver', 'DataTab:btnSolver']], 'the items of «Analysis ▸» are not the former ones');
    env.sectionBtn('Data').click();
    const row = env.row('analysis');
    assert.ok(row && row.classList.contains('vo-has-sub'), '«Analysis ▸» row is not a submenu opener');
    row.click();
    assert.deepEqual(plain(env.flyRows().map(rowText)), ['Goal Seek', 'Solver'], 'the rows of «Analysis ▸»');
    ['goalSeek', 'solver'].forEach(k => {
        env.log.length = 0;
        env.shell.closeSurfaces();
        env.sectionBtn('Data').click();
        env.row('analysis').click();
        env.row(k).click();
        assert.deepEqual(plain(env.log.filter(l => /DataTab:btn(GoalSeek|Solver)/.test(l))), ['click ' + env.A.item(k).twin], k + ': not one stock click');
    });
    const T = env.roots.DataTab;
    T.btnGoalSeek.setDisabled(true);
    assert.equal(env.A.itemState(env.A.offered('analysis')).disabled, false, '«Analysis ▸» is off while «Solver» is live');
    T.btnSolver.setDisabled(true);
    T.btnGoalSeek.keepState = T.btnSolver.keepState = ['cell-editing'];
    assert.deepEqual(plain(env.A.itemState(env.A.offered('analysis'))), {disabled: true, reason: env.A.textEditing, checked: false},
        '«Analysis ▸» during the cell edit');
    T.btnGoalSeek.setDisabled(false);
    T.btnSolver.setDisabled(false);
    const masked = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    assert.deepEqual(plain(env.A.itemCode(env.A.offered('analysis'), masked)), {disabled: true, reason: 'view', checked: false}, '«Analysis ▸» in «Viewing»');
    const r = env.A.coverage();
    assert.deepEqual(plain(r.byRef['DataTab:btnGoalSeek'].where), ['menu data > analysis > goalSeek']);
    assert.deepEqual(plain(r.byRef['DataTab:btnSolver'].where), ['menu data > analysis > solver']);
});

/* The full "Data" composition: Sort A to Z · Sort Z to A · Custom sort —
   Filter · Clear filter · Slicer · Data validation — Text to columns · Remove duplicates · External links — Group ▸ ·
   Ungroup ▸ · Named ranges ▸ — Formulas ▸ (Calculation options: Calculate workbook · Calculate current sheet —
   Formula auditing: Trace precedents · Trace dependents · Remove arrows · … precedents · … dependents · ✓ Watch window)
   · Analysis ▸ (Goal Seek · Solver). The captions are defaults (English; the locale is in the live case). */
test('data_composition', () => {
    const env = makeEnv();
    env.create();
    const data = env.A.groups()[5];
    assert.deepEqual(plain(env.keys(data)), ['sortAZ', 'sortZA', 'customSort', '--', 'filter', 'clearFilter', 'slicer', 'validation', '--',
        'textToColumns', 'removeDuplicatesData', 'externalLinks', '--', 'group', 'ungroup', 'namedRanges', '--', 'formulas', 'analysis'], 'Data');
    const kids = k => plain(kidKeys(env.A.offered(k).items));
    assert.deepEqual(kids('formulas'), ['#Calculation options', 'recalcWorkbook', 'recalcSheet', '--', '#Formula auditing', 'tracePrecedents',
        'traceDependents', 'removeArrows', 'removePrecedentArrows', 'removeDependentArrows', 'watchWindow']);
    assert.deepEqual(kids('analysis'), ['goalSeek', 'solver']);
    env.sectionBtn('Data').click();
    assert.deepEqual(plain(env.doc.querySelectorAll('#vo-shell .vo-mn-drop.open [data-k]').map(r => [rowText(r), r.classList.contains('vo-has-sub')])), [
        ['Sort A to Z', false], ['Sort Z to A', false], ['Custom sort', false], ['Filter', false], ['Clear filter', false], ['Slicer', false],
        ['Data validation', false], ['Text to columns', false], ['Remove duplicates', false], ['External links', false], ['Group', true], ['Ungroup', true],
        ['Named ranges', true], ['Formulas', true], ['Analysis', true]], 'Data rows and ▸');
    assert.equal(env.row('filter').getAttribute('role'), 'menuitemcheckbox', '«Filter» is not a toggle');
});

/* --- "Format" and "Horizontal" -------------------------------------------------------------------------------------- */

/* "Format": 'The "Format cells… ▸" submenu with actions on rows, columns and the sheet' → 'The "Rows, columns and sheet ▸" submenu with
   the same items' (the name was invented by the shell and promises a window). The same mirror of the standard menu of the ribbon "Format" button: stock rows,
   the second level ("Row height ▸" …), "✓ Locked cell" is a checkbox with the checkmark of the standard item
  . The check addresses are "menu format > rowsColsSheet", the "Locked cell" of the "Protection" tab is in the same place. */
test('rows_cols_sheet_submenu', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const it = env.A.offered('rowsColsSheet');
    assert.ok(it, '«Rows, columns and sheet ▸» is not in Format');
    assert.deepEqual([it.t, it.twin, !!it.sub], ['Rows, columns and sheet', 'Toolbar:btnFormatCell', true], '«Rows, columns and sheet ▸» is not the mirror of the stock «Format»');
    assert.equal(env.A.textRowsColsSheet, 'Rows, columns and sheet');
    assert.equal(env.keys(env.group('Format'))[1], 'rowsColsSheet', '«Rows, columns and sheet ▸» is not right after «Number format ▸»');
    env.sectionBtn('Format').click();
    assert.equal(rowText(env.row('rowsColsSheet')), 'Rows, columns and sheet');
    env.row('rowsColsSheet').click();
    const rows = env.flyRows();
    assert.deepEqual(plain(rows.map(rowText)).slice(0, 9), ['Row height', 'Column width', 'Hide', 'Show', 'Rename sheet', 'Move or copy sheet', 'Tab color',
        'Protect sheet', 'Locked cell'], 'rows are not the stock menu of «Format»');
    const locked = rows.find(r => rowText(r) === 'Locked cell');
    assert.deepEqual([locked.getAttribute('aria-checked'), !!locked.querySelector('.vo-mn-chk')], ['true', true], '«Locked cell» has no check of the stock item');
    /* The second level is a submenu of the standard item. */
    rows[0].click();
    assert.deepEqual(plain(env.flyRows(2).map(rowText)), ['Auto row height', 'Custom row height'], 'the second level of «Row height ▸»');
    env.flyRows(2)[1].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick Toolbar:btnFormatCell/.test(l))), ['pick Toolbar:btnFormatCell > Custom row height'],
        'a second level row is not one stock pick of its item');
    const r = env.A.coverage();
    assert.ok(r.byRef['Toolbar:btnFormatCell'].where.includes('menu format > rowsColsSheet'), 'the coverage address «menu format > rowsColsSheet»');
    assert.deepEqual(plain(r.byRef['WBProtection:chLockedCell'].where), ['menu format > rowsColsSheet > locked cell'], 'the locked cell of the Protection tab');
    assert.ok(!Object.keys(r.byRef).some(ref => r.byRef[ref].where.some(w => /menu format > formatCells >/.test(w))), 'an address inside the former «Format cells… ▸»');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Format": "Rows, columns and sheet ▸" - with the same items, except the last: "Format cells" is a separate item.
   The mirror of the "Format" button without the 'formatCells' row and without the dangling separator before it (StockBridge.OMIT); the standard ribbon menu is untouched,
   the bridge finds the item by value. */
test('rows_cols_sheet_mirror_without_format_cells', () => {
    const env = makeEnv();
    env.create();
    env.sectionBtn('Format').click();
    env.row('rowsColsSheet').click();
    const fly = flyOf(env);
    assert.deepEqual(plain(fly.children.map(c => c.classList.contains('vo-mn-sep') ? '--' : rowText(c))), ['Row height', 'Column width', '--', 'Hide', 'Show',
        '--', 'Rename sheet', 'Move or copy sheet', 'Tab color', 'Protect sheet', '--', 'Locked cell'],
        'the layer is not the stock «Format» menu without «Format cells» and its separator');
    const stock = env.roots.Toolbar.btnFormatCell.menu.items;
    assert.equal(stock[stock.length - 1].caption, 'Format cells', 'the stock menu lost «Format cells»');
    assert.equal(env.B.locate('Toolbar:btnFormatCell', {value: 'formatCells'}), stock[stock.length - 1], 'the bridge does not find the omitted stock item by value');
    assert.equal(typeof env.B.OMIT['Toolbar:btnFormatCell'], 'function', 'no mirror exception for the stock «Format»');
});

/* The engine constants (sdkjs: Asc.c_oAscCFType - cell/model/Serialize.js ECfType; c_oAscBorderOptions, c_oAscSelectionForCFType -
   cell/apiDefines.js) and a standard menu item in the stock shape: the configuration properties are in options (Common.UI.MenuItem: type, value, borderId). */
const CF_TYPE = {aboveAverage: 0, beginsWith: 1, cellIs: 2, colorScale: 3, containsBlanks: 4, containsErrors: 5, containsText: 6, dataBar: 7,
    duplicateValues: 8, expression: 9, iconSet: 10, notContainsBlanks: 11, notContainsErrors: 12, notContainsText: 13, timePeriod: 14, top10: 15,
    uniqueValues: 16, endsWith: 17};
const BORDER_OPT = {Top: 0, Right: 1, Bottom: 2, Left: 3, DiagD: 4, DiagU: 5, InnerV: 6, InnerH: 7};
const stockOpt = (caption, options = {}, opt = {}) => { const it = item(caption, Object.assign({value: options.value}, opt)); Object.assign(it.options, options); return it; };
const pickLog = (ref, log, items) => { const m = menu(items); m.on('item:click', (mm, it) => log.push('pick ' + ref + ' ' + it.caption)); return m; };
const layerLine = (env, level = 1) => { const f = flyOf(env, level); return f ? plain(f.children.map(c => c.classList.contains('vo-mn-sep') ? '--' : rowText(c) + (c.classList.contains('vo-has-sub') ? ' ▸' : ''))) : null; };

/* "Format → Conditional formatting ▸" is the same mirror as the panel
   button list: without "Formula" and the six standard deviation items of "Average ▸", without a dangling separator; the rows
   of "Average ▸" are Above · Below · Equal or above · Equal or below, and a click on them is the same standard item; the standard ribbon menu is untouched. */
test('format_conditional_without_formula_and_std_dev', () => {
    const env = makeEnv();
    const ref = 'Toolbar:btnCondFormat';
    const avg = ['Above', 'Below', 'Equal or above', 'Equal or below', '1 std dev above', '1 std dev below', '2 std dev above', '2 std dev below',
        '3 std dev above', '3 std dev below'].map((c, v) => stockOpt(c, {type: CF_TYPE.aboveAverage, value: v}));
    const cond = pickLog(ref, env.log, [
        stockOpt('Cell value', {}, {menu: pickLog(ref, env.log, [stockOpt('Greater than', {type: CF_TYPE.cellIs, value: 5})])}),
        stockOpt('Average', {}, {menu: pickLog(ref, env.log, avg)}),
        item('--'), stockOpt('Formula', {type: CF_TYPE.expression}), item('--'),
        stockOpt('New rule', {value: 'new'}), stockOpt('Manage rules', {value: 'manage'})]);
    env.roots.Toolbar.btnCondFormat = button(ref, env.log, {menu: cond});
    env.context.Asc.c_oAscCFType = CF_TYPE;
    env.create();
    env.sectionBtn('Format').click();
    env.row('conditional').click();
    assert.deepEqual(layerLine(env), ['Cell value ▸', 'Average ▸', '--', 'New rule', 'Manage rules'], '«Formula» or a dangling separator in Format → Conditional formatting ▸');
    env.flyRows()[1].click();
    assert.deepEqual(layerLine(env, 2), ['Above', 'Below', 'Equal or above', 'Equal or below'], 'standard deviations in «Average ▸»');
    env.flyRows(2)[1].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick /.test(l))), ['pick Toolbar:btnCondFormat Below'], 'the row picked another stock item');
    assert.equal(cond.items.length, 7, 'the stock menu changed');
    assert.equal(cond.items[1].menu.items.length, 10, 'the stock «Average» changed');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Format → Borders ▸" is the same mirror as the panel button list: without two
   diagonals and without a dangling separator; "More borders" (the right cell panel, the diagonals are there) is in place and chooses the same standard
   item; the standard ribbon menu is untouched. */
test('format_borders_without_diagonals', () => {
    const env = makeEnv();
    const ref = 'Toolbar:btnBorders';
    const b = (caption, borderId) => stockOpt(caption, {borderId});
    const borders = pickLog(ref, env.log, [b('Bottom', BORDER_OPT.Bottom), b('Top', BORDER_OPT.Top), item('--'), b('All', 'all'), item('--'),
        b('Inside vertical', BORDER_OPT.InnerV), b('Diagonal down', BORDER_OPT.DiagD), b('Diagonal up', BORDER_OPT.DiagU), item('--'),
        stockOpt('More borders', {value: 'options'})]);
    env.roots.Toolbar.btnBorders = button(ref, env.log, {menu: borders});
    env.context.Asc.c_oAscBorderOptions = BORDER_OPT;
    env.create();
    env.sectionBtn('Format').click();
    env.row('borders').click();
    assert.deepEqual(layerLine(env), ['Bottom', 'Top', '--', 'All', '--', 'Inside vertical', '--', 'More borders'], 'a diagonal or a dangling separator in Format → Borders ▸');
    env.flyRows()[4].click();
    assert.deepEqual(plain(env.log.filter(l => /^pick /.test(l))), ['pick Toolbar:btnBorders More borders'], 'the row picked another stock item');
    assert.equal(borders.items.length, 10, 'the stock menu changed');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Format": "Format cells" is a separate item, the name is the former; "Opens the right panel with the cell settings, as
   now. The context menu item is called the same". The item is the same standard menu item of the "Format" button by the value
   'formatCells' (its stock handler sends rightmenu:open - the right panel on the cell tab): one menu preparation and one standard
   choice; without ▸. Availability is of the button and the item: a cell edit disables the button, under the "Viewing" mask - inactive. */
test('format_cells_picks_stock_item_by_value', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const format = env.keys(env.group('Format'));
    assert.deepEqual(plain(format.slice(0, 4)), ['numberFormat', 'rowsColsSheet', 'formatCells', '--'], '«Format cells» is not right after «Rows, columns and sheet ▸»: ' + format.join(' '));
    const it = env.A.offered('formatCells');
    assert.deepEqual([it.t, it.twin, !!it.sub, !!it.items], ['Format cells', 'Toolbar:btnFormatCell', false, false], '«Format cells» is not a plain item of the stock «Format»');
    assert.ok(it.pick && it.pick.value === 'formatCells', '«Format cells» does not pick the stock item by its value');
    assert.equal(env.A.textCellFormat, 'Format cells', 'the default of «Format cells» (as the context menu, no ellipsis)');
    assert.equal(env.A.textFormatCells, undefined, '«Format cells» still has the key of the former «Format cells… ▸» holder');
    const m = env.roots.Toolbar.btnFormatCell.menu;
    let prepared = 0;
    m.on('show:before', () => prepared++);
    env.sectionBtn('Format').click();
    const row = env.row('formatCells');
    assert.equal(rowText(row), 'Format cells');
    assert.ok(!row.classList.contains('vo-has-sub') && row.getAttribute('role') === 'menuitem', '«Format cells» row is a submenu or a toggle');
    row.click();
    assert.deepEqual(plain(env.log.filter(l => /btnFormatCell/.test(l))), ['pick Toolbar:btnFormatCell Format cells'], 'not one stock pick of «Format cells»');
    assert.equal(prepared, 1, 'the stock menu is not prepared before the pick');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the command leaves the menu open');
    const btn = env.roots.Toolbar.btnFormatCell;
    btn.setDisabled(true);
    btn.keepState = ['cell-editing'];
    assert.deepEqual(plain(env.A.itemState(env.A.item('formatCells'))), {disabled: true, reason: env.A.textEditing, checked: false}, '«Format cells» during the cell edit');
    env.log.length = 0;
    assert.equal(env.A.exec(env.A.item('formatCells'), env.shell), false);
    assert.deepEqual(plain(env.log.filter(l => /btnFormatCell/.test(l))), [], 'a locked «Format cells» picked');
    btn.setDisabled(false);
    btn.keepState = [];
    const masked = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    assert.deepEqual(plain(env.A.itemCode(env.A.item('formatCells'), masked)), {disabled: true, reason: 'view', checked: false}, '«Format cells» in «Viewing»');
    assert.ok(env.A.coverage().byRef['Toolbar:btnFormatCell'].where.includes('menu format > formatCells'), 'the coverage address «menu format > formatCells»');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* There is no standard "Format cells" item when the right panel is hidden by the integration (customization.rightMenu === false,
   layout rightMenu - view/Toolbar.js: without the item and its separator) - and no item of ours; the separator does not dangle, "Rows, columns and sheet ▸" is
   in place. */
test('format_cells_absent_without_right_menu', () => {
    const env = makeEnv({formatCell: {rightMenu: false}});
    env.create();
    const format = env.keys(env.group('Format'));
    assert.ok(!format.includes('formatCells'), '«Format cells» without the stock item: ' + format.join(' '));
    assert.deepEqual(plain(format.slice(0, 3)), ['numberFormat', 'rowsColsSheet', '--'], 'Format around the absent «Format cells»: ' + format.join(' '));
    assert.equal(env.A.offered('formatCells'), null);
    env.sectionBtn('Format').click();
    assert.equal(env.row('formatCells'), null, 'a row of «Format cells» without the stock item');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Format": "Superscript and subscript ▸ (Superscript · Subscript)" → "Text ▸ - six font style switches
   (the first four are new)": "A checkmark on the one enabled for the current cell. Bold, italic, underline, strikethrough were only in the toolbar;
   the names are as in the toolbar hints". A one-level submenu; the children are the standard font style buttons and the items of the
   superscript/subscript button by value; on the right are the standard shortcuts; a row is one standard call. Availability is of the
   buttons: all disabled - the holder is inactive; under the "Viewing" mask - inactive. */
const TEXT_KIDS = [['bold', 'Toolbar:btnBold', 'Bold'], ['italic', 'Toolbar:btnItalic', 'Italic'], ['underline', 'Toolbar:btnUnderline', 'Underline'],
    ['strikeout', 'Toolbar:btnStrikeout', 'Strikeout'], ['superscript', 'Toolbar:btnSubscript', 'Superscript'], ['subscript', 'Toolbar:btnSubscript', 'Subscript']];
test('text_submenu_six_toggles_checked_by_twins', () => {
    const env = makeEnv({shortcuts: {Bold: ['Ctrl', 'B'], Italic: ['Ctrl', 'I'], Underline: ['Ctrl', 'U'], Strikeout: ['Ctrl', '5'],
        Superscript: ['Ctrl', '.'], Subscript: ['Ctrl', ',']}});
    env.create();
    checkCatalog(env.A.catalog());
    const format = env.keys(env.group('Format'));
    assert.deepEqual(plain(format.slice(3, 5)), ['--', 'text'], '«Text ▸» does not open the second group of Format: ' + format.join(' '));
    assert.ok(!format.includes('script'), '«Superscript and subscript ▸» is still in Format');
    assert.equal(env.A.textScript, undefined, 'the default of «Superscript and subscript» is still there');
    const holder = env.A.offered('text');
    assert.equal(holder.t, 'Text', 'the label of «Text ▸»');
    assert.equal(env.A.textText, 'Text');
    assert.ok(!holder.twin && !holder.run && !holder.sub, '«Text ▸» is a composite item, not a command');
    assert.deepEqual(plain(Array.from(holder.items, i => [i.k, i.twin, i.check, i.sc])), TEXT_KIDS.map(([k, twin, sc]) => [k, twin, true, sc]),
        'the six toggles of «Text ▸»: twins, checks, shortcuts');
    /* The names are the panel hints and the standard "Superscript" / "Subscript" (ribbon views), at build time. */
    const T = env.SSE.Views.CompactToolbar;
    assert.deepEqual(plain(Array.from(holder.items, i => i.t)), [T.tipBold, T.tipItalic, T.tipUnderline, T.tipStrikeout, 'Superscript', 'Subscript'],
        'the labels are not the toolbar tips');
    T.tipStrikeout = 'Durchgestrichen';
    env.SSE.Views.Toolbar = function () {};
    env.SSE.Views.Toolbar.prototype.textSuperscript = 'Надстрочные знаки';
    assert.deepEqual([env.A.offered('strikeout').t, env.A.offered('superscript').t], ['Durchgestrichen', 'Надстрочные знаки'],
        'the labels are not read from the toolbar and the stock view at the build');
    T.tipStrikeout = 'Strikethrough';
    delete env.SSE.Views.Toolbar;
    /* The layer: six checkboxes by the button pressed state and the item checkmark, shortcuts on the right. */
    const R = env.roots.Toolbar;
    R.btnBold.pressed = true;
    R.btnSubscript.menu.items[1].checked = true;
    env.sectionBtn('Format').click();
    env.row('text').click();
    const fly = flyOf(env);
    assert.ok(fly && fly.getAttribute('aria-label') === 'Text', 'no «Text ▸» layer');
    assert.deepEqual(plain(ownRows(env).map(r => [r.getAttribute('data-k'), rowText(r), r.getAttribute('role'), r.getAttribute('aria-checked'),
        (r.querySelector('.vo-mn-h') || {textContent: ''}).textContent])), [
        ['bold', 'Bold', 'menuitemcheckbox', 'true', 'Ctrl+B'], ['italic', 'Italic', 'menuitemcheckbox', 'false', 'Ctrl+I'],
        ['underline', 'Underline', 'menuitemcheckbox', 'false', 'Ctrl+U'], ['strikeout', 'Strikethrough', 'menuitemcheckbox', 'false', 'Ctrl+5'],
        ['superscript', 'Superscript', 'menuitemcheckbox', 'false', 'Ctrl+.'], ['subscript', 'Subscript', 'menuitemcheckbox', 'true', 'Ctrl+,']],
        'rows of «Text ▸»: toggles checked by the stock');
    assert.ok(ownRows(env).every(r => !r.classList.contains('vo-has-sub')), 'a submenu inside «Text ▸»');
    /* The glyphs are of the panel font style buttons and of the former "Superscript" / "Subscript" rows (the "Superscript and subscript" submenu). */
    const I = env.context.Common.UI.Compact.Icons, GLYPHS = {bold: 'bold', italic: 'italic', underline: 'underline', strikeout: 'strike', superscript: 'sup', subscript: 'sub'};
    assert.deepEqual(plain(ownRows(env).map(r => (r.querySelector('.vo-mn-i') || {}).innerHTML === I.svg(GLYPHS[r.getAttribute('data-k')], 16) && I.has(GLYPHS[r.getAttribute('data-k')]))),
        [true, true, true, true, true, true], 'a row of «Text ▸» without the glyph of its toolbar button or former row');
    R.btnBold.pressed = false;
    env.relock();
    assert.equal(env.row('bold').getAttribute('aria-checked'), 'false', 'the check does not follow the stock button');
    /* A row is one standard call. */
    const calls = {bold: 'click Toolbar:btnBold', italic: 'click Toolbar:btnItalic', underline: 'click Toolbar:btnUnderline',
        strikeout: 'click Toolbar:btnStrikeout', superscript: 'pick Toolbar:btnSubscript super', subscript: 'pick Toolbar:btnSubscript sub'};
    Object.keys(calls).forEach(k => {
        env.log.length = 0;
        env.shell.closeSurfaces();
        env.sectionBtn('Format').click();
        env.row('text').click();
        env.row(k).click();
        assert.deepEqual(plain(env.log.filter(l => /Toolbar:btn(Bold|Italic|Underline|Strikeout|Subscript)/.test(l))), [calls[k]], k + ': not one stock call');
        assert.equal(env.shell.hasOpenSurfaces(), false, k + ': the menu stays open');
    });
    /* All buttons are disabled (formula editing, an image) - the holder is inactive; the "Viewing" mask - inactive with a reason. */
    ['btnBold', 'btnItalic', 'btnUnderline', 'btnStrikeout', 'btnSubscript'].forEach(n => { R[n].setDisabled(true); R[n].keepState = ['cell-editing']; });
    assert.deepEqual(plain(env.A.itemState(env.A.offered('text'))), {disabled: true, reason: env.A.textEditing, checked: false}, '«Text ▸» with every button off');
    ['btnBold', 'btnItalic', 'btnUnderline', 'btnStrikeout', 'btnSubscript'].forEach(n => { R[n].setDisabled(false); R[n].keepState = []; });
    assert.equal(env.A.itemState(env.A.offered('text')).disabled, false);
    const masked = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    assert.deepEqual(plain(env.A.itemCode(env.A.offered('text'), masked)), {disabled: true, reason: 'view', checked: false}, '«Text ▸» in «Viewing»');
    const r = env.A.coverage();
    assert.deepEqual(plain(r.byRef['Toolbar:btnSubscript'].where), ['menu format > text > superscript', 'menu format > text > subscript'], 'Superscript/subscript addresses');
    assert.ok(r.byRef['Toolbar:btnBold'].where.includes('menu format > text > bold'), 'Bold is not in Format → Text: ' + r.byRef['Toolbar:btnBold'].where);
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Format → Text ▸": "✓ Superscript · ✓ Subscript" - the checkmark is from the standard button menu item (the stock sets it by
   selection), availability is of the button and the item; a choice is a menu preparation and a standard item click. No stock item - no row.
   Editing cell text does not disable the button (in the stock superscripts apply to the text selected in the cell): the item is alive, like the button (its
   availability is as for the standard command). */
test('super_sub_check_from_item_lock_from_button', () => {
    const env = makeEnv();
    env.create();
    const btn = env.roots.Toolbar.btnSubscript, [sup, sub] = btn.menu.items;
    const st = k => plain(env.A.itemState(env.A.item(k)));
    btn.pressed = true;
    sup.checked = false;
    sub.checked = false;
    assert.deepEqual([st('superscript').checked, st('subscript').checked], [false, false], 'the check is the button\'s, not the item\'s');
    sup.checked = true;
    assert.deepEqual([st('superscript').checked, st('subscript').checked], [true, false], 'the check of the stock item is not read');
    sup.setDisabled(true);
    assert.deepEqual([st('superscript').disabled, st('subscript').disabled], [true, false], 'the lock of the stock item is not read');
    sup.setDisabled(false);
    btn.setDisabled(true);
    btn.keepState = ['worksheet-lock-format'];
    env.api.protectedSheet = true;
    assert.deepEqual(st('subscript'), {disabled: true, reason: env.A.textProtected, checked: false}, 'a child is live under a locked button');
    btn.setDisabled(false);
    btn.keepState = [];
    env.api.protectedSheet = false;
    env.api.isCellEdited = true;
    assert.equal(st('superscript').disabled, false, 'the cell edit locked «Superscript» while the stock button is live');
    env.api.isCellEdited = false;
    let prepared = 0;
    btn.menu.on('show:before', () => prepared++);
    env.log.length = 0;
    assert.equal(env.A.exec(env.A.item('superscript'), env.shell), true);
    assert.deepEqual(plain(env.log.filter(l => /btnSubscript/.test(l))), ['pick Toolbar:btnSubscript super'], 'not one stock pick of «Superscript»');
    assert.equal(prepared, 1, 'the stock menu is not prepared before the pick');
    sub.hidden = true;
    assert.equal(env.A.offered('subscript'), null, 'a row without the stock item');
    assert.deepEqual(plain(kidKeys(env.A.offered('text').items)), ['bold', 'italic', 'underline', 'strikeout', 'superscript']);
});

/* "Format → Alignment ▸" - 7 variants: "Checkmarks on the current ones; the names are as in the toolbar lists. It was only in the toolbar.
   "Justify", which leaves the toolbar, moves here too". Composition: Align left ·
   Center · Align right · Justify — Align top · Align middle · Align bottom. Two groups with one choice (radio) through a
   separator; a row is a click of the standard alignment button, one; an already chosen variant changes nothing (for the standard button a repeated click
   would unpress it and reset the alignment - that is not a choice). Availability is of the buttons (a cell edit), the "Viewing" mask. */
const ALIGN_KIDS = [['alignLeft', 'Toolbar:btnAlignLeft', 'textAlignLeft'], ['alignCenter', 'Toolbar:btnAlignCenter', 'textAlignCenter'],
    ['alignRight', 'Toolbar:btnAlignRight', 'textAlignRight'], ['alignJust', 'Toolbar:btnAlignJust', 'textAlignJust'], '--',
    ['alignTop', 'Toolbar:btnAlignTop', 'textAlignTop'], ['alignMiddle', 'Toolbar:btnAlignMiddle', 'textAlignMiddle'], ['alignBottom', 'Toolbar:btnAlignBottom', 'textAlignBottom']];
test('align_submenu_seven_radio_by_twins', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const format = env.keys(env.group('Format'));
    assert.deepEqual(plain(format.slice(format.indexOf('changeCase'), format.indexOf('changeCase') + 2)), ['changeCase', 'align'],
        '«Alignment ▸» is not right after «Change case ▸»: ' + format.join(' '));
    const holder = env.A.offered('align');
    /* The English default is the original ONLYOFFICE name, the case is as there. */
    assert.equal(holder.t, 'Align', 'the label of «Align ▸»');
    assert.equal(env.A.textAlign, 'Align');
    assert.ok(!holder.twin && !holder.run && !holder.sub, '«Alignment ▸» is a composite item, not a command');
    const T = env.SSE.Views.CompactToolbar;
    assert.deepEqual(plain(Array.from(holder.items, i => i.sep ? '--' : [i.k, i.twin, i.check, i.t])),
        ALIGN_KIDS.map(x => x === '--' ? '--' : [x[0], x[1], 'radio', T[x[2]]]), 'the seven choices of «Alignment ▸»: twins, radio, labels of the toolbar lists');
    T.textAlignJust = 'Blocksatz';
    assert.equal(env.A.offered('alignJust').t, 'Blocksatz', 'the label is not read from the toolbar at the build');
    T.textAlignJust = 'Justified';
    const R = env.roots.Toolbar;
    R.btnAlignCenter.pressed = true;
    R.btnAlignBottom.pressed = true;
    env.sectionBtn('Format').click();
    env.row('align').click();
    const fly = flyOf(env);
    assert.ok(fly && fly.getAttribute('aria-label') === 'Align', 'no «Align ▸» layer');
    assert.deepEqual(plain(fly.children.map(c => c.classList.contains('vo-mn-sep') ? '--' : [c.getAttribute('data-k'), c.getAttribute('role'), c.getAttribute('aria-checked')])), [
        ['alignLeft', 'menuitemradio', 'false'], ['alignCenter', 'menuitemradio', 'true'], ['alignRight', 'menuitemradio', 'false'], ['alignJust', 'menuitemradio', 'false'],
        '--', ['alignTop', 'menuitemradio', 'false'], ['alignMiddle', 'menuitemradio', 'false'], ['alignBottom', 'menuitemradio', 'true']],
        'two radio groups through a separator, checks at the pressed stock buttons');
    assert.ok(ownRows(env).every(r => !r.classList.contains('vo-has-sub')), 'a submenu inside «Alignment ▸»');
    /* The glyphs are of the rows of the panel "Horizontal" and "Vertical" lists ("Justify" has its former glyph in the list). */
    const I = env.context.Common.UI.Compact.Icons, GLYPHS = {alignLeft: 'alignL', alignCenter: 'alignC', alignRight: 'alignR', alignJust: 'alignJ', alignTop: 'valignT',
        alignMiddle: 'alignC', alignBottom: 'caption'};
    assert.deepEqual(plain(ownRows(env).filter(r => r.getAttribute('data-k')).map(r => (r.querySelector('.vo-mn-i') || {}).innerHTML === I.svg(GLYPHS[r.getAttribute('data-k')], 16) && I.has(GLYPHS[r.getAttribute('data-k')]))),
        [true, true, true, true, true, true, true], 'a row of «Alignment ▸» without the glyph of its toolbar list row');
    /* A row is one click of the standard button; an already chosen variant - nothing (nothing to change), the menu is closed. */
    const pick = k => { env.log.length = 0; env.shell.closeSurfaces(); env.sectionBtn('Format').click(); env.row('align').click(); env.row(k).click();
        return plain(env.log.filter(l => /Toolbar:btnAlign/.test(l))); };
    assert.deepEqual(pick('alignJust'), ['click Toolbar:btnAlignJust'], '«Justified» is not one stock click');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the menu stays open');
    assert.deepEqual(pick('alignTop'), ['click Toolbar:btnAlignTop']);
    assert.deepEqual(pick('alignCenter'), [], 'the chosen «Align center» was clicked again (the stock would depress it and drop the alignment)');
    assert.equal(env.shell.hasOpenSurfaces(), false, 'the chosen variant left the menu open');
    assert.deepEqual(pick('alignBottom'), [], 'the chosen «Align bottom» was clicked again');
    /* During a cell edit the stock disables the alignment buttons - the holder is inactive with a reason. */
    ALIGN_KIDS.filter(x => x !== '--').forEach(([, ref]) => { const b = R[ref.split(':')[1]]; b.setDisabled(true); b.keepState = ['cell-editing']; });
    assert.deepEqual(plain(env.A.itemState(env.A.offered('align'))), {disabled: true, reason: env.A.textEditing, checked: false}, '«Alignment ▸» during the cell edit');
    ALIGN_KIDS.filter(x => x !== '--').forEach(([, ref]) => { const b = R[ref.split(':')[1]]; b.setDisabled(false); b.keepState = []; });
    const masked = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    assert.deepEqual(plain(env.A.itemCode(env.A.offered('align'), masked)), {disabled: true, reason: 'view', checked: false}, '«Alignment ▸» in «Viewing»');
    /* "Justify" is here, not on the panel. */
    const r = env.A.coverage();
    assert.deepEqual(plain(r.byRef['Toolbar:btnAlignJust'].where), ['menu format > align > alignJust'], '«Justified» is not only in Format → Alignment');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Format → ✓ Wrap text" turns wrapping on and off (before it was only in the toolbar): a toggle of the standard
   ribbon "Wrap text" button - the checkmark by its pressed state, a click is one standard click of it; the name is the panel button hint, the glyph is
   its too. A cell edit disables the button, the "Viewing" mask - the item. */
test('wrap_toggle_checked_by_twin', () => {
    const env = makeEnv();
    env.create();
    const format = env.keys(env.group('Format'));
    assert.deepEqual(plain(format.slice(format.indexOf('align'), format.indexOf('align') + 2)), ['align', 'wrap'], '«Wrap text» is not right after «Alignment ▸»: ' + format.join(' '));
    const it = env.A.offered('wrap');
    const T = env.SSE.Views.CompactToolbar;
    assert.deepEqual([it.t, it.i, it.twin, it.check, !!it.sub], [T.tipWrap, 'hyphen', 'Toolbar:btnWrap', true, false], '«Wrap text» is not the toggle of the stock wrap');
    /* Wrap text - as for the ribbon "Wrap text" button (it was Text wrapping). */
    assert.equal(T.tipWrap, 'Wrap text', 'the toolbar tip default');
    const btn = env.roots.Toolbar.btnWrap;
    env.sectionBtn('Format').click();
    assert.deepEqual([env.row('wrap').getAttribute('role'), env.row('wrap').getAttribute('aria-checked')], ['menuitemcheckbox', 'false'], 'an unwrapped cell: «Wrap text» unchecked');
    btn.pressed = true;
    env.relock();
    assert.deepEqual([env.row('wrap').getAttribute('aria-checked'), !!env.row('wrap').querySelector('.vo-mn-chk')], ['true', true], 'a wrapped cell: «Wrap text» has no check');
    env.log.length = 0;
    env.row('wrap').click();
    assert.deepEqual(plain(env.log.filter(l => /btnWrap/.test(l))), ['click Toolbar:btnWrap'], 'not one stock wrap click');
    assert.equal(env.shell.hasOpenSurfaces(), false);
    btn.setDisabled(true);
    btn.keepState = ['cell-editing'];
    assert.deepEqual(plain(env.A.itemState(env.A.item('wrap'))), {disabled: true, reason: env.A.textEditing, checked: true}, '«Wrap text» during the cell edit');
    btn.setDisabled(false);
    btn.keepState = [];
    const masked = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    assert.equal(env.A.itemState(env.A.item('wrap'), masked).disabled, true, '«Wrap text» in «Viewing»');
    assert.ok(env.A.coverage().byRef['Toolbar:btnWrap'].where.includes('menu format > wrap'), 'the coverage address «menu format > wrap»');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Format": "Increase indent · Decrease indent" → "Indent ▸" with the same items (merged). The holder is after "Text direction ▸";
   the items are the former - the engine cell indent with a step of 1 (asc_setCellIndent, from 0), the glyphs are the former, availability is from the ribbon "Align
   left": the button is disabled - the holder is inactive with a reason, the "Viewing" mask - inactive. */
test('indent_holder_two_items', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const format = env.keys(env.group('Format'));
    assert.deepEqual(plain(format.slice(format.indexOf('textDirection'), format.indexOf('textDirection') + 3)), ['textDirection', 'indent', '--'],
        '«Indent ▸» does not close the second group of Format after «Text direction ▸»: ' + format.join(' '));
    ['indentInc', 'indentDec'].forEach(k => assert.ok(!format.includes(k), k + ' is still at the top of Format'));
    const holder = env.A.offered('indent');
    assert.equal(holder.t, 'Indent', 'the label of «Indent ▸»');
    assert.equal(env.A.textIndent, 'Indent');
    assert.ok(!holder.twin && !holder.run && !holder.sub, '«Indent ▸» is a composite item, not a command');
    assert.deepEqual(plain(Array.from(holder.items, i => [i.k, i.t, i.i, i.lockLike, typeof i.run])), [
        ['indentInc', 'Increase indent', 'indentIn', 'Toolbar:btnAlignLeft', 'function'], ['indentDec', 'Decrease indent', 'indentOut', 'Toolbar:btnAlignLeft', 'function']],
        'the items of «Indent ▸» are not the former ones');
    env.sectionBtn('Format').click();
    env.row('indent').click();
    const I = env.context.Common.UI.Compact.Icons;
    assert.deepEqual(plain(env.flyRows().map(r => [rowText(r), (r.querySelector('.vo-mn-i') || {}).innerHTML === I.svg(r.getAttribute('data-k') === 'indentInc' ? 'indentIn' : 'indentOut', 16)])),
        [['Increase indent', true], ['Decrease indent', true]], 'the rows of «Indent ▸» lost their glyphs');
    env.api.indent = 3;
    env.api.calls.length = 0;
    env.row('indentInc').click();
    assert.deepEqual(plain(env.api.calls), ['indent 4'], '«Increase indent» is not one engine indent +1');
    env.api.indent = 0;
    env.api.calls.length = 0;
    env.sectionBtn('Format').click();
    env.row('indent').click();
    env.row('indentDec').click();
    assert.deepEqual(plain(env.api.calls), ['indent 0'], '«Decrease indent» went below zero');
    const left = env.roots.Toolbar.btnAlignLeft;
    left.setDisabled(true);
    left.keepState = ['cell-editing'];
    assert.deepEqual(plain(env.A.itemState(env.A.offered('indent'))), {disabled: true, reason: env.A.textEditing, checked: false}, '«Indent ▸» during the cell edit');
    left.setDisabled(false);
    left.keepState = [];
    const masked = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    assert.deepEqual(plain(env.A.itemCode(env.A.offered('indent'), masked)), {disabled: true, reason: 'view', checked: false}, '«Indent ▸» in «Viewing»');
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* "Format": "Clear format ▸ (All · Text · Formatting · Comments · Links)" → "Clear format" without a submenu: "Now the
   item resets only formatting, like the toolbar button. The other variants are "Edit → Clear ▸" and the context menu". The item is the
   standard "Formatting" item of the "Clear" button by the value Asc.c_oAscCleanOptions.Format (the shared CLEAR_FORMAT helper - the panel button
   chooses the same one); without ▸, the caption and glyph are the former; one menu preparation and one standard choice. */
test('clear_format_is_format_only_no_submenu', () => {
    const env = makeEnv();
    env.create();
    checkCatalog(env.A.catalog());
    const it = env.A.offered('clearFormat');
    assert.deepEqual([it.t, it.i, it.twin, !!it.sub, !!it.items], ['Clear format', 'clear', 'Toolbar:btnClearStyle', false, false], '«Clear format» is a submenu or not the stock «Clear»');
    assert.equal(it.pick, env.A.CLEAR_FORMAT, 'the item does not use the shared helper');
    assert.equal(env.A.CLEAR_FORMAT.value(), CLEAN.Format, 'the helper is not Asc.c_oAscCleanOptions.Format');
    const m = env.roots.Toolbar.btnClearStyle.menu;
    let prepared = 0;
    m.on('show:before', () => prepared++);
    env.sectionBtn('Format').click();
    const row = env.row('clearFormat');
    assert.equal(rowText(row), 'Clear format');
    assert.ok(!row.classList.contains('vo-has-sub') && row.getAttribute('role') === 'menuitem', '«Clear format» row still opens a submenu');
    row.click();
    assert.deepEqual(plain(env.log.filter(l => /btnClearStyle/.test(l))), ['pick Toolbar:btnClearStyle Second btnClearStyle'], 'not one stock pick of «Formatting»');
    assert.equal(prepared, 1, 'the stock menu is not prepared before the pick');
    assert.equal(env.shell.hasOpenSurfaces(), false);
    /* "Edit → Clear ▸" still has all variants (the others are there). */
    assert.ok(env.A.offered('clear') && env.A.offered('clear').sub, '«Edit → Clear ▸» lost its submenu');
    const r = env.A.coverage();
    assert.ok(r.byRef['Toolbar:btnClearStyle'].where.includes('menu format > clearFormat') && r.byRef['Toolbar:btnClearStyle'].where.includes('menu edit > clear'),
        'the coverage addresses of «Clear»: ' + r.byRef['Toolbar:btnClearStyle'].where);
    /* The stock has no "Formatting" item - there is no item either. */
    m.items[1].hidden = true;
    assert.equal(env.A.offered('clearFormat'), null, '«Clear format» without the stock «Formatting»');
    m.items[1].hidden = false;
    assert.equal(env.warnings.length, 0, 'unexpected warnings: ' + JSON.stringify(env.warnings.map(w => String(w[0]))));
});

/* A chart, shape or image is selected - "Clear format" behaves like the standard "Clear → Formatting" command:
   the standard item is disabled (its selChart, selShape, selImage locks are on the item, not on the button) - the item is inactive; on a cell
   edit the stock disables the item - inactive with a reason; the button is disabled (a co-author, the connection) - inactive; the "Viewing" mask - inactive. */
test('clear_format_off_on_object', () => {
    const env = makeEnv();
    env.create();
    const btn = env.roots.Toolbar.btnClearStyle, fmt = btn.menu.items[1];
    const st = () => plain(env.A.itemState(env.A.item('clearFormat')));
    assert.deepEqual(st(), {disabled: false, reason: null, checked: false});
    fmt.setDisabled(true);
    fmt.keepState = ['sel-chart'];
    assert.deepEqual(st(), {disabled: true, reason: null, checked: false}, '«Clear format» is live on a chart');
    env.sectionBtn('Format').click();
    assert.equal(env.row('clearFormat').getAttribute('aria-disabled'), 'true', 'the row is not inactive on a chart');
    env.log.length = 0;
    env.row('clearFormat').click();
    assert.deepEqual(plain(env.log.filter(l => /btnClearStyle/.test(l))), [], 'a locked «Clear format» picked');
    fmt.keepState = ['cell-editing'];
    assert.deepEqual(st(), {disabled: true, reason: env.A.textEditing, checked: false}, '«Clear format» during the cell edit');
    fmt.setDisabled(false);
    fmt.keepState = [];
    btn.setDisabled(true);
    assert.equal(st().disabled, true, '«Clear format» is live under a locked «Clear» button');
    btn.setDisabled(false);
    const masked = {lockState: () => ({on: true, type: 'vo-view', options: {toolbar: true}}), modeCode: () => 'view'};
    assert.deepEqual(plain(env.A.itemCode(env.A.item('clearFormat'), masked)), {disabled: true, reason: 'view', checked: false}, '«Clear format» in «Viewing»');
});

/* The full "Format" composition: Number format ▸ · Rows, columns and sheet ▸ · Format cells — Text ▸ ·
   Case ▸ · Alignment ▸ · ✓ Wrap text · Text rotation ▸ · Text direction ▸ · Indent ▸ — Borders ▸ · Merge cells ▸ —
   Conditional formatting ▸ · Format as table · Cell styles · Color scheme ▸ — Clear format (▸ - on submenus and galleries).
   The captions are defaults (English; the locale is in the live case). */
test('format_composition', () => {
    const env = makeEnv();
    env.create();
    const format = env.A.groups()[4];
    assert.deepEqual(plain(env.keys(format)), ['numberFormat', 'rowsColsSheet', 'formatCells', '--', 'text', 'changeCase', 'align', 'wrap', 'textRotation',
        'textDirection', 'indent', '--', 'borders', 'merge', '--', 'conditional', 'formatAsTable', 'cellStyles', 'colorScheme', '--', 'clearFormat'], 'Format');
    const kids = k => plain(kidKeys(env.A.offered(k).items));
    assert.deepEqual(kids('text'), ['bold', 'italic', 'underline', 'strikeout', 'superscript', 'subscript']);
    assert.deepEqual(kids('align'), ['alignLeft', 'alignCenter', 'alignRight', 'alignJust', '--', 'alignTop', 'alignMiddle', 'alignBottom']);
    assert.deepEqual(kids('indent'), ['indentInc', 'indentDec']);
    env.sectionBtn('Format').click();
    assert.deepEqual(plain(env.doc.querySelectorAll('#vo-shell .vo-mn-drop.open [data-k]').map(r => [rowText(r), r.classList.contains('vo-has-sub')])), [
        /* "Align", "Wrap text" are the original English ONLYOFFICE names. */
        ['Number format', true], ['Rows, columns and sheet', true], ['Format cells', false], ['Text', true], ['Change case', true], ['Align', true],
        ['Wrap text', false], ['Text rotation', true], ['Text direction', true], ['Indent', true], ['Borders', true], ['Merge cells', true],
        ['Conditional formatting', true], ['Format as table', true], ['Cell styles', true], ['Color scheme', true], ['Clear format', false]], 'Format rows and ▸');
    assert.equal(env.row('wrap').getAttribute('role'), 'menuitemcheckbox', '«Wrap text» is not a toggle');
});

/* A group choice (check: 'radio') on an item without its own double (zoom: run and on) is executed even when chosen: the "choice is made" rule is
   only for the standard button that a repeated click would unpress. */
test('radio_rule_only_for_pressed_twins', () => {
    const env = makeEnv();
    env.create();
    env.api.zoom = 1;
    env.api.calls.length = 0;
    assert.equal(env.A.exec(env.A.item('zoom100'), env.shell), true);
    assert.deepEqual(plain(env.api.calls), ['zoom 1'], 'the chosen zoom without a twin did not run');
    env.roots.ViewTab.btnViewNormal.pressed = true;
    env.log.length = 0;
    assert.equal(env.A.exec(env.A.item('viewNormal'), env.shell), true);
    assert.deepEqual(plain(env.log.filter(l => /btnViewNormal/.test(l))), [], 'the chosen «Normal» was clicked again');
    env.roots.ViewTab.btnViewNormal.pressed = false;
    assert.equal(env.A.exec(env.A.item('viewNormal'), env.shell), true);
    assert.deepEqual(plain(env.log.filter(l => /btnViewNormal/.test(l))), ['click ViewTab:btnViewNormal']);
});

/* Scrolling a long menu with the wheel: the SDK suppresses the wheel on bubbling, so
   lists have their own handlers. A real browser and real wheel events. */
pending.push(['long_menu_scrolls_with_wheel', async () => {
    let chromium;
    try { ({chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
    catch (e) { throw new Error('playwright is not available (set NODE_PATH or PLAYWRIGHT_MODULE): ' + e.message); }
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    try {
        const page = await browser.newPage({viewport: {width: 900, height: 600}});
        await page.setContent(`<style>
            body {height:3000px;margin:0} #viewport {position:fixed;top:20px;left:20px}
            .vo-mn-drop {width:220px;height:140px;overflow-x:hidden;overflow-y:auto;background:#fff}
            .vo-mn-sub {display:block;height:40px;width:100%}
            </style><div id="viewport"><div class="vo-mn"><div class="vo-mn-wrap"><div id="menu" class="vo-mn-drop open"></div></div></div></div>`);
        await page.evaluate(() => {
            window.SSE = {Views: {}};
            window._ = {extend: Object.assign};
            window.Common = {NotificationCenter: {on() {}, off() {}, trigger() {}}};
            window.define = (deps, factory) => factory({svg: () => ''}, {apply() {}, release() {}, dispose() {}}, {}, {});
            window.received = [];
            /* The SDK handler on viewport: a plain wheel is suppressed, with modifiers - not. */
            ['wheel', 'mousewheel', 'DOMMouseScroll'].forEach(type => document.getElementById('viewport').addEventListener(type, ev => {
                received.push(type);
                if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.altKey) ev.preventDefault();
            }, {passive: false}));
        });
        await page.addScriptTag({content: fs.readFileSync(SHELL, 'utf8')});
        const rows = n => page.evaluate(n => {
            const m = document.getElementById('menu');
            m.innerHTML = Array.from({length: n}, (_, i) => `<button class="vo-mn-sub">${i}</button>`).join('');
            m.scrollTop = 0; window.scrollTo(0, 300); received.length = 0;
        }, n);
        await page.evaluate(() => SSE.Views.CompactShell.bindListScroll(document.getElementById('menu')));
        const wheel = async delta => {
            const box = await page.locator('#menu').boundingBox();
            await page.mouse.move(box.x + 40, box.y + 20);
            await page.mouse.wheel(0, delta);
            await page.waitForTimeout(200);
        };
        const pos = () => page.evaluate(() => ({menu: document.getElementById('menu').scrollTop, doc: scrollY, sdk: received.length}));
        await rows(20);
        await wheel(240);
        let p = await pos();
        assert.ok(p.menu > 0, 'long menu did not scroll: ' + JSON.stringify(p));
        assert.equal(p.doc, 300, 'the page scrolled under the menu');
        assert.equal(p.sdk, 0, 'the SDK wheel handler saw the event');
        await wheel(5000); await wheel(5000);
        p = await pos();
        assert.equal(p.menu, 20 * 40 - 140, 'bottom edge');
        assert.equal(p.doc, 300, 'scroll chained to the page at the edge');
        await rows(2);
        await wheel(240);
        p = await pos();
        assert.deepEqual([p.menu, p.doc, p.sdk], [0, 300, 0], 'short list: no scroll, page shielded');
        const mod = await page.evaluate(() => {
            const m = document.getElementById('menu');
            received.length = 0;
            const ev = new WheelEvent('wheel', {bubbles: true, cancelable: true, deltaY: 80, ctrlKey: true});
            m.dispatchEvent(ev);
            return received.length;
        });
        assert.equal(mod, 1, 'Ctrl+wheel must reach the stock handler (zoom)');
    } finally {
        await browser.close();
    }
}]);

(async () => {
    for (const [name, fn] of pending) {
        try {
            await fn();
            console.log('PASS', name);
            passed++;
        } catch (error) {
            console.error('FAIL', name, '—', error && error.message);
            failed++;
        }
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})();
