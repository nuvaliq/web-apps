/* Run: node test/unit-tests/spreadsheeteditor/a11y.cjs [path to CompactToolbar.js] [path to CompactShell.js] [path to compact-shell.less]
 * Keyboard, focus and screen reader of the spreadsheet editor "Compact" shell
 * (WCAG 2.1 AA): the menubar / menu / menuitem and toolbar roles, arrows within a row, Tab between
 * rows (a row has one Tab stop - roving tabindex, WAI-ARIA APG "Menubar" and "Toolbar"),
 * a visible focus (the AIR ring) on the light-blue panel card and on white, inactive - aria-disabled
 * with the reason in the hint. Real headless Chrome (playwright) and real key presses
 * (page.keyboard: Tab moves focus the standard way), the styles are the real spreadsheet editor layer, as in app.less: the shared
 * menu row rules (common/main/resources/less/compact) and compact-shell.less (lib/compact-less.cjs).
 * The environment is the same as in compact-toolbar.cjs: the real shell modules (Icons, StockBridge,
 * SheetActions, CompactToolbar, FormulaBar, ColumnHeaderMenu, CompactShell), the stock is fake
 * doubles with nodes in the DOM, the standard Bootstrap delegate on keydown in [role=menu] and the standard
 * ":focus { outline: none }". The arguments are broken copies of modules for the negative control
 * (a copy of CompactToolbar.js without aria-disabled must fail disabled_announced; without handling
 * Enter on a leaf item - leaf_items_run_from_keyboard; compact-shell.less without a ring on the palette
 * reset row - focus_ring_on_every_palette_node; a copy of CompactShell.js that after a keyboard command
 * returns focus to the sheet via edit:complete - menu_command_focus_like_mouse; a copy of CompactShell.js
 * without stopping the F10 entry in focus mode - f10_in_focus_mode_keeps_keyboard_alive; copies without focus in the standard
 * gallery opened from the keyboard (focusRow of the menu row adapter, CompactToolbar.focusSub for the panel
 * list), and without ← from a gallery list - stock_gallery_entered_from_keyboard; a copy of CompactShell.js without ← at the edge of
 * the nested gallery DataView, with it also for a submenu inside a gallery, for a DataView without a nested submenu or without
 * checking the left column - stock_dataview_gallery_left_edge_returns_to_row; copies of CompactShell.js without holding the focus move
 * from a field into the shell (keepFieldMove), without returning focus to the field on a failed F10 entry and with a plain focus on the
 * stop without a return after the deferred sheet focus (keepFocus) - f10_from_a_field_enters_the_menu; with a return
 * after any entry - f10_from_a_field_enters_the_menu (a quick Tab out of the shell) and toolbar_command_focus_like_mouse). */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/spreadsheeteditor/main/app/view');
const TOOLBAR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactToolbar.js');
const SHELL = process.argv[3] ? path.resolve(process.argv[3]) : path.join(VIEW, 'CompactShell.js');
const LESS = process.argv[4] ? path.resolve(process.argv[4]) : path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/compact-shell.less');
const layer = require('./lib/compact-less.cjs');
const STOCK_TOOLBAR_CTL = path.join(ROOT, 'apps/spreadsheeteditor/main/app/controller/Toolbar.js');
/* The standard stock rule ":focus { outline: none }" (common/main/resources/less/asc-mixins.less) - it
   turns off the browser focus ring for the whole editor: a shell node ring is only its own
   (without this rule the test would see the browser ring where a human does not have it). */
const STOCK_FOCUS = (() => {
    const src = fs.readFileSync(path.join(ROOT, 'apps/common/main/resources/less/asc-mixins.less'), 'utf8');
    const m = /^:focus\s*\{[^}]*\}/m.exec(src);
    assert.ok(m && /outline:\s*none/.test(m[0]), 'the stock «:focus { outline: none }» rule is not in asc-mixins.less');
    return m[0];
})();
const BASE = 'file://' + path.join(ROOT, 'apps/spreadsheeteditor/main/index.html');

/* The text of a standard controller method - from "name: function(" to the closing brace. */
function readStock(file, name) {
    const src = fs.readFileSync(file, 'utf8');
    const head = name + ': function(';
    const start = src.indexOf(head);
    assert.ok(start >= 0, name + ' not found in ' + path.basename(file));
    let depth = 0, end = src.indexOf('{', start);
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    return src.slice(start + name.length + 2, end + 1);
}

/* A fake stock in the page: ribbon doubles, the engine, controllers. opt - rights and state. */
const HARNESS = (opt, stockFontSize, stockFontSizeSelect) => `
window.log = [];
window.notes = [];
function events(t) {
    const h = {};
    t.on = (n, f) => { (h[n] = h[n] || []).push(f); return t; };
    t.off = (n, f) => { const a = h[n] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); return t; };
    t.trigger = function (n, ...a) { (h[n] || []).slice().forEach(f => f.apply(t, a)); return t; };
    return t;
}
const stock = document.getElementById('stock');
function stockNode(ref) {
    const el = document.createElement('button');
    el.setAttribute('data-ref', ref);
    stock.appendChild(el);
    return el;
}
/* A ribbon button modeled on Common.UI.Button: disabled and aria-pressed on the node. */
function twin(ref, o = {}) {
    const el = stockNode(ref);
    const b = events({ref, disabled: false, pressed: !!o.pressed, enableToggle: !!o.toggle, allowDepress: o.allowDepress,
        menu: o.menu || null, keepState: [], options: {}, rendered: true, visible: true});
    b.cmpEl = Object.assign([el], {trigger: name => { el.dispatchEvent(new Event(name)); }});
    b.isDisabled = function () { return this.disabled; };
    b.setDisabled = function (v) { this.disabled = !!v; if (v) el.setAttribute('disabled', ''); else el.removeAttribute('disabled'); };
    b.toggle = function (v, suppress) {
        this.pressed = v === undefined ? !this.pressed : !!v;
        el.setAttribute('aria-pressed', String(this.pressed));
        if (!suppress) this.trigger('toggle', this, this.pressed);
    };
    b.click = function () {
        if (this.disabled) return;
        if (this.enableToggle && (this.allowDepress !== false || !this.pressed)) this.toggle();
        log.push('click ' + ref);
        this.trigger('click', this);
    };
    el.addEventListener('dblclick', () => log.push('dblclick ' + ref));
    return b;
}
function item(caption, o = {}) {
    const it = events({caption, options: {caption}, value: o.value, disabled: !!o.disabled, hidden: false, visible: true, rendered: true,
        checkable: !!o.checkable, checked: !!o.checked, menu: o.menu || null});
    it.isDisabled = function () { return this.disabled; };
    it.isChecked = function () { return this.checked; };
    it.onItemClick = function (e) { if (this.menu || this.disabled) return false; this.trigger('click', this, e); };
    return it;
}
function menu(ref, list) {
    const m = events({items: list.map(c => typeof c === 'string' ? item(c) : c), rendered: true, parentEl: [document.createElement('div')]});
    m.items.forEach(i => i.on('click', (it, e) => m.trigger('item:click', m, it, e)));
    m.on('item:click', (mm, it) => log.push('pick ' + ref + ' ' + it.caption));
    m.on('show:before', () => log.push('prepare ' + ref));
    return m;
}
/* The submenu records its own choice (menu() above) - one entry per standard click. */
function withMenu(ref, list, o = {}) { return twin(ref, Object.assign({menu: menu(ref, list)}, o)); }

const O = ${JSON.stringify(opt)};
/* sdkjs cell/apiDefines.js: the values of the "Clear" items (SheetActions.CLEAR_FORMAT reads them at call time). */
window.Asc = {c_oAscCleanOptions: {All: 0, Text: 1, Format: 2, Comments: 5, Hyperlinks: 6},
    /* sdkjs cell/apiDefines.js: the number format types. */
    c_oAscNumFormatType: {None: -1, General: 0, Number: 1, Scientific: 2, Accounting: 3, Currency: 4, Date: 5, LongDate: 6, Time: 7,
        Percent: 8, Fraction: 9, Text: 10, Custom: 11}};
/* The number format is a combo: a store with examples, "More formats" in the markup (as in ComboBoxCustom). */
const nfEl = document.createElement('div');
nfEl.innerHTML = '<ul><li id="nf-0"><a>General</a></li><li id="nf-1"><a>Currency</a></li><li class="divider"></li><li id="nf-more"><a>More formats</a></li></ul>';
stock.appendChild(nfEl);
const nfModels = [{id: 'nf-0', displayValue: 'General', exampleval: '1234'}, {id: 'nf-1', displayValue: 'Currency', exampleval: '1 234,00 ₽'}];
const numFormat = events({disabled: false, raw: O.numFormat || 'General', displayField: 'displayValue', cmpEl: [nfEl],
    store: {length: nfModels.length, at: i => ({get: k => nfModels[i][k], id: nfModels[i].id})},
    getValue() { return this.raw; }, getRawValue() { return this.raw; }, isDisabled() { return this.disabled; }, itemClicked() {}});
numFormat.setDisabled = function (v) { this.disabled = !!v; };
numFormat.on('show:before', () => log.push('prepare numFormat'));
nfEl.querySelectorAll('a').forEach(a => a.addEventListener('click', () => log.push('pick numFormat ' + a.textContent)));
/* Fonts - the ComboBoxFonts store. */
const fontNames = O.fonts || ['Arial', 'Calibri', 'Cambria', 'Arial', 'Verdana'];
const fontName = events({disabled: false, raw: 'Calibri', store: {models: fontNames.map(n => ({get: k => k === 'name' ? n : undefined, toJSON: () => ({name: n, type: 1})}))},
    getRawValue() { return this.raw; }, isDisabled() { return this.disabled; }, itemClicked() {}});
fontName.on('selected', (cmb, rec) => log.push('font ' + rec.name));
/* Font size is a combo with the real standard row selection ('selected') and typing (changed:before/after) handlers; the store is the sizes of
   the standard font size list of the spreadsheet editor ribbon (view/Toolbar.js, cmbFontSize). */
const sizeModels = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '22', '24', '26', '28', '36', '48', '72', '96'].map(v => ({
    get: k => k === 'displayValue' ? v : (k === 'value' ? Number(v) : undefined), toJSON: () => ({value: Number(v), displayValue: v})}));
const fontSize = events({disabled: false, raw: '11', cmpEl: [document.createElement('div')],
    store: {models: sizeModels, length: sizeModels.length, at: i => sizeModels[i],
        findWhere: q => sizeModels.some(m => m.get('displayValue') === q.displayValue) ? {} : null},
    getRawValue() { return this.raw; }, setRawValue(v) { this.raw = String(v); }, isDisabled() { return this.disabled; }});
window.api = {calls: [], zoom: 1, handlers: {}, isCellEdited: false, fontColor: null, fillColor: null, numType: null, angle: 0, frozen: false,
    asc_registerCallback(n, f) { (this.handlers[n] = this.handlers[n] || []).push(f); },
    asc_unregisterCallback(n, f) { const a = this.handlers[n] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    send(n, ...a) { (this.handlers[n] || []).slice().forEach(f => f.apply(this, a)); },
    asc_getZoom() { return this.zoom; }, asc_setZoom(z) { this.calls.push('asc_setZoom ' + z); },
    asc_enableKeyEvents(v) { this.calls.push('keys ' + v); }, asc_setCellFontSize(v) { this.calls.push('asc_setCellFontSize ' + v); },
    asc_isDocumentModified() { return false; }, asc_Resize() {}, asc_isProtectedSheet() { return false; },
    /* The number format (type), the text angle and freezing sheet panes - for the pressed state of ₽ % "123", rotation and freeze. */
    asc_getCellInfo() { const me = this; return {asc_getXfs: () => ({asc_getFontColor: () => me.fontColor, asc_getFillColor: () => me.fillColor,
        asc_getFontName: () => me.fontName, asc_getNumFormatInfo: () => me.numType == null ? null : {asc_getType: () => me.numType},
        asc_getAngle: () => me.angle})}; },
    asc_getSheetViewSettings() { const me = this; return {asc_getIsFreezePane: () => me.frozen}; }};
window.Common = {NotificationCenter: events({}), Utils: {String: {parseFloat: s => { (typeof s === 'string') && (s = s.replace(',', '.')); return parseFloat(s); }}},
    UI: {warning: o => log.push('warning'), Menu: {Manager: {hideAll() {}}}, LayoutManager: {isElementVisible: () => true}},
    component: {Analytics: {trackEvent() {}}}};
const ntr = Common.NotificationCenter.trigger;
Common.NotificationCenter.trigger = function (n, ...a) { notes.push(n); return ntr.apply(this, [n, ...a]); };
const fsCtl = {api, _state: {}, toolbar: {}, textFontSizeErr: 'bad size', _getApiTextSize: () => 11};
fsCtl.onFontSizeChanged = (${stockFontSize});
fsCtl.onFontSizeSelect = (${stockFontSizeSelect});
fontSize.on('selected', fsCtl.onFontSizeSelect.bind(fsCtl));
fontSize.on('changed:before', fsCtl.onFontSizeChanged.bind(fsCtl, true));
fontSize.on('changed:after', fsCtl.onFontSizeChanged.bind(fsCtl, false));

const condSub = menu('Toolbar:btnCondFormat', ['Greater than', 'Less than']);
const toolbarView = {
    btnUndo: twin('Toolbar:btnUndo'), btnRedo: twin('Toolbar:btnRedo'),
    /* The ribbon "Print" button is the availability source of the panel "Print". */
    btnPrint: twin('Toolbar:btnPrint'),
    cmbNumberFormat: numFormat, cmbFontName: fontName, cmbFontSize: fontSize,
    btnCurrencyStyle: twin('Toolbar:btnCurrencyStyle'), btnPercentStyle: twin('Toolbar:btnPercentStyle'),
    btnDecDecimal: twin('Toolbar:btnDecDecimal'), btnIncDecimal: twin('Toolbar:btnIncDecimal'),
    btnDecFontSize: twin('Toolbar:btnDecFontSize'), btnIncFontSize: twin('Toolbar:btnIncFontSize'),
    btnBold: twin('Toolbar:btnBold', {toggle: true}), btnItalic: twin('Toolbar:btnItalic', {toggle: true}),
    btnUnderline: twin('Toolbar:btnUnderline', {toggle: true}), btnStrikeout: twin('Toolbar:btnStrikeout', {toggle: true}),
    btnTextColor: twin('Toolbar:btnTextColor'), btnBackColor: twin('Toolbar:btnBackColor'),
    btnBorders: withMenu('Toolbar:btnBorders', ['Bottom border', 'Top border', 'No borders']),
    btnMerge: withMenu('Toolbar:btnMerge', ['Merge & center', 'Merge across', 'Unmerge']),
    btnAlignLeft: twin('Toolbar:btnAlignLeft', {toggle: true, allowDepress: false, pressed: true}),
    btnAlignCenter: twin('Toolbar:btnAlignCenter', {toggle: true, allowDepress: false}),
    btnAlignRight: twin('Toolbar:btnAlignRight', {toggle: true, allowDepress: false}),
    btnAlignJust: twin('Toolbar:btnAlignJust', {toggle: true, allowDepress: false}),
    btnAlignTop: twin('Toolbar:btnAlignTop', {toggle: true, allowDepress: false}),
    btnAlignMiddle: twin('Toolbar:btnAlignMiddle', {toggle: true, allowDepress: false}),
    btnAlignBottom: twin('Toolbar:btnAlignBottom', {toggle: true, allowDepress: false, pressed: true}),
    btnWrap: twin('Toolbar:btnWrap', {toggle: true}),
    btnInsertHyperlink: twin('Toolbar:btnInsertHyperlink'),
    btnInsertFormula: withMenu('Toolbar:btnInsertFormula', ['SUM', 'AVERAGE', 'MIN']),
    btnInsertImage: withMenu('Toolbar:btnInsertImage', ['From file', 'From URL']),
    btnInsertChartRecommend: twin('Toolbar:btnInsertChartRecommend'),
    btnTextOrient: withMenu('Toolbar:btnTextOrient', ['Horizontal', 'Rotate up']),
    btnCondFormat: withMenu('Toolbar:btnCondFormat', [item('Highlight cells rules', {menu: condSub}), 'Clear rules']),
    /* The "Clear" button menu in the stock shape: items with the value Asc.c_oAscCleanOptions (the panel "Clear format" button is the item
       "Formatting" by value). */
    btnClearStyle: withMenu('Toolbar:btnClearStyle', [item('All', {value: 0}), item('Text', {value: 1}), item('Format', {value: 2})]),
    btnCopyStyle: twin('Toolbar:btnCopyStyle', {toggle: true})
};
const dataView = {btnsSetAutofilter: [twin('DataTab:btnsSetAutofilter.0', {toggle: true})], btnsSortDown: [twin('DataTab:btnsSortDown.0')],
    btnsSortUp: [twin('DataTab:btnsSortUp.0')], btnCustomSort: twin('DataTab:btnCustomSort'), btnDataValidation: twin('DataTab:btnDataValidation')};
const viewView = {btnFreezePanes: withMenu('ViewTab:btnFreezePanes', ['Freeze panes', 'Freeze top row'])};
const comment = twin('ToolbarCtl:btnsComment.0');
window.twins = Object.assign({}, toolbarView, {filter: dataView.btnsSetAutofilter[0], sortDown: dataView.btnsSortDown[0], sortUp: dataView.btnsSortUp[0],
    customSort: dataView.btnCustomSort, validation: dataView.btnDataValidation, freeze: viewView.btnFreezePanes, comment});
const appOptions = Object.assign({isEdit: true, canCoAuthoring: true, canComments: true, canDownload: true, canPrint: true}, O.options || {});
const shortcuts = {EditUndo: ['Ctrl', 'Z'], Bold: ['Ctrl', 'B'], ToggleAutoFilter: ['Ctrl', 'Shift', 'L']};
/* The shortcut registry follows the contract of the standard one (common/main/lib/controller/Shortcuts.js): before
   setApi it is empty; updateShortcutHints calls the callback at once and remembers it; setApi fills the
   registry and calls all the remembered ones (_eventsTrigger). O.lateShortcuts - empty at build. */
window.registry = {map: O.lateShortcuts ? {} : shortcuts, events: [],
    getShortcutsByActionType(n) { return this.map[n] ? [{keys: this.map[n]}] : null; },
    updateShortcutHints(hints) { Object.keys(hints).forEach(n => { const it = hints[n]; const cb = () => it.applyCallback(it, it.label);
        cb(); this.events.push(cb); }); },
    setApi() { this.map = shortcuts; this.events.forEach(cb => cb()); }};
/* O.domLayout - doLayout puts the area height into the DOM, like the standard layout (the search bar
   reads it); without it the layout is only in the model. */
window.vlayout = {items: {title: {height: 28}, toolbar: {height: 92}}, getItem(a) { return this.items[a]; },
    doLayout() { const tb = O.domLayout && document.getElementById('toolbar'); if (tb) tb.style.height = this.items.toolbar.height + 'px'; }};
window.leftMenu = {btnSearchBar: {pressed: false}, btnComments: {pressed: false}, btnChat: {pressed: false}, btnSpellcheck: {pressed: false}, buttons: []};
window.SSE = {Views: {}, getController(name) {
    switch (name) {
        case 'Main': return {appOptions, editorConfig: {ui: {shell: 'modern'}}};
        case 'Toolbar': return {toolbar: Object.assign(events({}), toolbarView), btnsComment: [comment]};
        case 'DataTab': return {view: dataView};
        case 'ViewTab': return {view: viewView};
        case 'Viewport': return {getApi: () => api, searchBar: window.searchBar || undefined,
            viewport: {vlayout, hlayout: {doLayout() {}}, celayout: {doLayout() {}}}};
        case 'LeftMenu': return {leftMenu};
        case 'Common.Controllers.Shortcuts': return registry;
        default: return null;
    }
}};
window.__mods = {};
window.define = (deps, factory) => { window.__mods[window.__mod] = factory(...deps.map(d => window.__mods[d])); };
/* The standard stock Bootstrap delegate (common/main/lib/extend/Bootstrap.js: $(document).on(
   'keydown.bs.dropdown.data-api', '[data-toggle=dropdown], [role=menu]', onDropDownKeyDown)) - in
   the branch without no-stop-propagate and move-focus for any key inside [role=menu] it calls preventDefault and
   stopPropagation: the standard button press (Enter, space) and the Tab step go dead. The jQuery delegate
   fires on bubbling at document - this listener hangs there too. stockMenuKeys - the keys
   that reached it. */
window.stockMenuKeys = [];
document.addEventListener('keydown', e => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function' || !t.closest('[data-toggle=dropdown], [role=menu]')) return;
    stockMenuKeys.push(e.key);
    e.preventDefault();
    e.stopPropagation();
});
true;`;

const MODULES = [
    ['common/main/lib/view/compact/Icons', path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js')],
    ['spreadsheeteditor/main/app/view/StockBridge', path.join(VIEW, 'StockBridge.js')],
    ['spreadsheeteditor/main/app/view/SheetActions', path.join(VIEW, 'SheetActions.js')],
    ['spreadsheeteditor/main/app/view/CompactToolbar', TOOLBAR]
];
/* With the shell: the formula bar and the shell itself, create() - as on app:ready;
   the shell depends on the column header menu too. */
const SHELL_MODULES = [
    ['spreadsheeteditor/main/app/view/FormulaBar', path.join(VIEW, 'FormulaBar.js')],
    ['spreadsheeteditor/main/app/view/ColumnHeaderMenu', path.join(VIEW, 'ColumnHeaderMenu.js')],
    /* The menu row is shared: the model, the adapter helper, the row, the shell registry and the spreadsheet editor adapter. */
    ['common/main/lib/view/compact/MenuModel', path.join(ROOT, 'apps/common/main/lib/view/compact/MenuModel.js')],
    ['common/main/lib/view/compact/AdapterKit', path.join(ROOT, 'apps/common/main/lib/view/compact/AdapterKit.js')],
    ['common/main/lib/view/compact/MenuBar', path.join(ROOT, 'apps/common/main/lib/view/compact/MenuBar.js')],
    ['common/main/lib/view/compact/Shells', path.join(ROOT, 'apps/common/main/lib/view/compact/Shells.js')],
    ['spreadsheeteditor/main/app/view/CompactMenuAdapter', path.join(VIEW, 'CompactMenuAdapter.js')],
    ['spreadsheeteditor/main/app/view/CompactShell', SHELL]
];

let chromium;
try { ({chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch (e) { console.error('FAIL playwright is not available (set NODE_PATH or PLAYWRIGHT_MODULE): ' + e.message); process.exit(1); }

let browser, page, css = '';
const STOCK_FS = readStock(STOCK_TOOLBAR_CTL, 'onFontSizeChanged');
const STOCK_FS_SELECT = readStock(STOCK_TOOLBAR_CTL, 'onFontSizeSelect');

/* The default width - all 35 controls in the row (the row measurement hides the extra ones in "⋯").
   withShell - the real shell: the standard ribbon in #toolbar and create(), as on app:ready;
   before - code in the page before create() (section captions from the locale). */
async function fresh(opt = {}, width = 2000, withShell = false, before = null) {
    if (page) await page.close();
    page = await browser.newPage({viewport: {width, height: 800}});
    page.on('pageerror', e => console.error('  page error:', e.message));
    const body = withShell
        ? '<body><div id="stock" style="display:none"></div><div id="toolbar" role="toolbar"><section class="toolbar"><div id="box-right-btn-group"></div></section></div></body>'
        : '<body class="vo-compact"><div id="stock" style="display:none"></div><div id="toolbar"><div id="vo-shell"></div></div></body>';
    /* The document base is the editor directory: Icons builds the AIR set address from document.baseURI. */
    await page.setContent(`<!doctype html><html><head><base href="${BASE}"><style>${STOCK_FOCUS}\n${css}</style></head>${body}</html>`);
    await page.addScriptTag({path: path.join(ROOT, 'vendor/underscore/underscore.js')});
    await page.evaluate(HARNESS(opt, STOCK_FS, STOCK_FS_SELECT));
    for (const [name, file] of MODULES.concat(withShell ? SHELL_MODULES : [])) {
        await page.evaluate(n => { window.__mod = n; }, name);
        await page.addScriptTag({content: fs.readFileSync(file, 'utf8') + '\n//# sourceURL=' + path.basename(file)});
    }
    if (withShell) {
        if (before) await page.evaluate(before);
        /* The shared menu row reason texts ("Viewing", protection) are the same as those of the shell and the spreadsheet editor catalog,
           as the spreadsheet editor locale puts them. */
        await page.evaluate(() => {
            const MB = Common.UI.Compact.MenuBar;
            MB.textReasonView = SSE.Views.CompactShell.textModeLockedView;
            MB.textReasonProtected = SSE.Views.SheetActions.textProtected;
        });
        await page.evaluate(() => { SSE.Views.CompactShell.create(); });
        await flush();
    }
    return page;
}

/* Build the panel and caption it as the shell will. */
const BUILD = `(() => { const T = SSE.Views.CompactToolbar; const bar = T.build(null);
    if (bar) { document.getElementById('vo-shell').appendChild(bar); T.bind(null); } return !!bar; })()`;
const keysOf = () => page.evaluate(() => [...document.querySelectorAll('#vo-tb [data-ctrl]')].map(n => n.getAttribute('data-ctrl')));
const ctrlSel = k => `#vo-tb [data-ctrl="${k}"]`;
const btnOf = k => `${ctrlSel(k)} > button, #vo-tb button[data-ctrl="${k}"]`;
const flush = () => page.evaluate(() => new Promise(r => setTimeout(r, 30)));
const listRows = k => page.evaluate(sel => [...document.querySelectorAll(sel + ' > .vo-pop > .vo-pop-item')].map(r => ({
    t: r.querySelector('.vo-pop-t').textContent, on: r.classList.contains('on'), off: r.classList.contains('vo-locked'),
    ex: (r.querySelector('.vo-pop-ex') || {}).textContent || '', sub: r.classList.contains('vo-has-sub')})), ctrlSel(k));
const clickRow = (k, text) => page.evaluate(([sel, t]) => {
    const r = [...document.querySelectorAll(sel + ' .vo-pop-item')].find(x => x.querySelector('.vo-pop-t').textContent === t);
    if (!r) throw new Error('no row ' + t);
    r.click();
}, [ctrlSel(k), text]);
const state = () => page.evaluate(() => ({log: log.slice(), calls: api.calls.slice(), notes: notes.slice()}));
const clear = () => page.evaluate(() => { log.length = 0; api.calls.length = 0; notes.length = 0; });

/* Two render frames: the size observer delivers the measurement in a frame. */
const resizeTo = async width => {
    await page.setViewportSize({width, height: 800});
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
};

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* A focused node: what it is and whether the focus ring is visible (a box-shadow of the AIR focus color or
   an outline) - computed, at the moment of focus. The ring is a shadow of the focus color with a spread of at least 1 px
   (outer or inset) or an outline thicker than zero: a shadow of the needed color with zero thickness
   (0 0 0 0) is invisible and does not count as a ring. */
const FOCUS = () => page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return {none: true};
    /* The ring appears with a transition (0.15 s) - we read the final value. */
    el.getAnimations().forEach(a => a.finish());
    const s = getComputedStyle(el);
    /* computed box-shadow: "<color> <x> <y> <blur> <spread> [inset]" separated by commas. */
    const shadows = s.boxShadow === 'none' ? [] : s.boxShadow.split(/,(?![^(]*\))/).map(x => x.trim());
    const spread = sh => { const px = sh.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) || []; return px.length >= 4 ? parseFloat(px[3]) : 0; };
    const ring = shadows.some(sh => /^rgb\(74, 157, 255\)/.test(sh) && spread(sh) >= 1) ||
                 (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0);
    return {tag: el.tagName, cls: String(el.className), ctrl: (el.closest('[data-ctrl]') || {getAttribute: () => null}).getAttribute('data-ctrl'),
        text: (el.textContent || '').trim().slice(0, 40), label: el.getAttribute('aria-label'), role: el.getAttribute('role'),
        tab: el.getAttribute('tabindex'), ring, visible: el.matches(':focus-visible'),
        inMenu: !!el.closest('#vo-shell > .vo-mn'), inBar: !!el.closest('#vo-tb'), inShell: !!el.closest('#vo-shell'),
        level: el.getAttribute('data-level'), k: el.getAttribute('data-k')};
});
const press = async (key, times = 1) => { for (let i = 0; i < times; i++) await page.keyboard.press(key); };
/* The visible nodes of a row with a Tab stop and without: a row has exactly one. */
const STOPS = sel => page.evaluate(sel => {
    const vis = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const all = [...document.querySelectorAll(sel)].filter(vis);
    return {n: all.length, zero: all.filter(el => el.tabIndex === 0 && el.getAttribute('tabindex') !== '-1').map(el =>
        (el.closest('[data-ctrl]') || el).getAttribute('data-ctrl') || el.className + ':' + el.textContent.trim().slice(0, 20))};
}, sel);
const SECTIONS = () => page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-mn-item[data-k]')].map(b => ({t: b.textContent,
    role: b.getAttribute('role'), pop: b.getAttribute('aria-haspopup'), exp: b.getAttribute('aria-expanded'), tab: b.getAttribute('tabindex')})));

test('menubar_roles_and_arrows', async () => {
    await fresh({}, 1440, true);
    const bar = await page.evaluate(() => { const m = document.querySelector('#vo-shell > .vo-mn');
        return {role: m.getAttribute('role'), label: !!m.getAttribute('aria-label'), drops: [...m.querySelectorAll('.vo-mn-drop')].map(x => x.getAttribute('role'))}; });
    assert.equal(bar.role, 'menubar');
    assert.ok(bar.label, 'the menubar has no accessible name');
    /* Eight sections and the "…" of the narrow window of the shared menu row. */
    assert.ok(bar.drops.length === 9 && bar.drops.every(r => r === 'menu'), 'section lists are not menus: ' + bar.drops);
    let s = await SECTIONS();
    assert.equal(s.length, 8);
    assert.ok(s.every(x => x.role === 'menuitem' && x.pop === 'menu' && x.exp === 'false'), 'section buttons: ' + JSON.stringify(s));
    assert.deepEqual(s.map(x => x.tab), ['0', '-1', '-1', '-1', '-1', '-1', '-1', '-1'], 'the menubar is one Tab stop (roving tabindex)');
    /* Entry from the sheet is F10 (the engine keeps focus in its own field while its keyboard is on):
       the engine keyboard is off, focus is on the menu row stop. Escape without layers - to the sheet. */
    await clear();
    await press('F10');
    let f = await FOCUS();
    assert.ok(f.inMenu && f.text === s[0].t, 'F10 did not focus the menubar stop: ' + JSON.stringify(f));
    assert.deepEqual((await state()).calls.filter(c => /^keys /.test(c)), ['keys false'], 'F10 did not take the keyboard from the engine');
    await press('Escape');
    let st = await state();
    assert.deepEqual(st.calls.filter(c => /^keys /.test(c)), ['keys false', 'keys true'], 'Escape did not give the keyboard back to the engine');
    assert.ok(st.notes.includes('edit:complete'), 'Escape did not return focus to the sheet (edit:complete)');
    await press('F10');
    f = await FOCUS();
    assert.ok(f.inMenu && f.text === s[0].t, 'focus: ' + JSON.stringify(f));
    await press('ArrowRight');
    f = await FOCUS();
    assert.equal(f.text, s[1].t, 'ArrowRight goes to the next section');
    assert.ok(f.ring && f.visible, 'no visible focus ring on a menubar item: ' + JSON.stringify(f));
    assert.deepEqual((await SECTIONS()).map(x => x.tab), ['-1', '0', '-1', '-1', '-1', '-1', '-1', '-1'], 'the Tab stop follows the focus');
    await press('ArrowLeft', 2);
    assert.equal((await FOCUS()).text, s[7].t, 'ArrowLeft wraps to the last section');
    await press('Home');
    assert.equal((await FOCUS()).text, s[0].t, 'Home');
    await press('End');
    assert.equal((await FOCUS()).text, s[7].t, 'End');
    /* ↓ opens a section and puts focus on the first item; ↓/↑ over the items, in a circle. */
    await press('Home');
    await press('ArrowRight', 4);                                   // "Format"
    await press('ArrowDown');
    s = await SECTIONS();
    assert.equal(s[4].exp, 'true', 'ArrowDown did not open the section');
    f = await FOCUS();
    assert.ok(f.role === 'menuitem' || f.role === 'menuitemcheckbox', 'focus is not on a menu item: ' + JSON.stringify(f));
    assert.equal(f.tab, '-1', 'menu items must not be Tab stops');
    assert.ok(f.ring, 'no focus ring on a menu item');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-mn-drop.open:not(.vo-mn-fly) > button')].map(r => r.getAttribute('data-k')));
    assert.equal(f.k, rows[0], 'focus is not on the first item');
    const seen = [f.k];
    for (let i = 1; i < rows.length; i++) { await press('ArrowDown'); seen.push((await FOCUS()).k); }
    assert.deepEqual(seen, rows, 'ArrowDown visits every item of the section in order');
    await press('ArrowDown');
    assert.equal((await FOCUS()).k, rows[0], 'ArrowDown wraps to the first item');
    await press('ArrowUp');
    assert.equal((await FOCUS()).k, rows[rows.length - 1], 'ArrowUp wraps to the last item');
    /* → on an item with a submenu: the submenu is open, focus on its first item; ← - back. */
    const bi = rows.indexOf('borders');
    assert.ok(bi >= 0, 'precondition: Format → Borders');
    await press('Home');
    await press('ArrowDown', bi);
    assert.equal((await FOCUS()).k, 'borders');
    await press('ArrowRight');
    f = await FOCUS();
    assert.equal(f.level, '1', 'ArrowRight did not move into the submenu: ' + JSON.stringify(f));
    assert.equal(await page.evaluate(() => document.querySelector('#vo-shell .vo-mn-fly').getAttribute('role')), 'menu');
    await press('ArrowLeft');
    f = await FOCUS();
    assert.equal(f.k, 'borders', 'ArrowLeft did not return to the parent item');
    assert.equal(await page.evaluate(() => !!document.querySelector('#vo-shell .vo-mn-fly')), false, 'the submenu stayed open');
    /* → on an item without a submenu - the next section is open, focus on its first item; ← - back. */
    const plain = await page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-mn-drop.open:not(.vo-mn-fly) > button')]
        .findIndex(r => !r.classList.contains('vo-has-sub')));
    assert.ok(plain >= 0, 'precondition: a plain item in Format');
    await press('Home');
    await press('ArrowDown', plain);
    await press('ArrowRight');
    s = await SECTIONS();
    assert.ok(s[5].exp === 'true' && s[4].exp === 'false', 'ArrowRight on a plain item did not move to the next section');
    assert.equal((await FOCUS()).level, '0');
    await press('ArrowLeft');
    assert.equal((await SECTIONS())[4].exp, 'true', 'ArrowLeft did not move back');
    /* Escape closes a section and returns focus to the section. */
    await press('Escape');
    s = await SECTIONS();
    assert.ok(s.every(x => x.exp === 'false'), 'Escape left the section open');
    f = await FOCUS();
    assert.ok(f.inMenu && f.text === s[4].t, 'focus after Escape: ' + JSON.stringify(f));
    /* Tab from an open section leaves the menu row: to the panel stop. */
    await press('ArrowDown');
    await press('Tab');
    f = await FOCUS();
    assert.ok(f.inBar && !f.inMenu, 'Tab did not leave the menubar to the toolbar: ' + JSON.stringify(f));
    assert.ok((await SECTIONS()).every(x => x.exp === 'false'), 'Tab left the section open');
    await press('Shift+Tab');
    assert.equal((await FOCUS()).text, s[4].t, 'Shift+Tab returns to the last focused section');
});

/* Entering with F10, a Tab round to the panel and Shift+Tab back into the menu row: Escape without layers - to the sheet again, as right after F10
   (the keyboard to the engine, focus to the sheet), not onto the panel control from which focus returned to the row. An Escape that removed a layer
   (a section) does not lead to the sheet: focus is on the section, the keyboard is with the shell. */
test('escape_after_a_tab_round_trip_returns_to_the_sheet', async () => {
    /* The sheet is the engine field #area_id: the engine keyboard turned on and edit:complete (DocumentHolder.focus) put focus into it. */
    await fresh({}, 1440, true, () => {
        const area = document.createElement('textarea');
        area.id = 'area_id';
        document.body.appendChild(area);
        const keys = api.asc_enableKeyEvents;
        api.asc_enableKeyEvents = function (v) {
            keys.call(this, v);
            if (v === true && document.activeElement !== area) area.focus();
        };
        Common.NotificationCenter.on('edit:complete', () => _.defer(() => area.focus()));
    });
    const onSheet = () => page.evaluate(() => new Promise(r => setTimeout(() => r(document.activeElement && document.activeElement.id === 'area_id'), 30)));
    const s = await SECTIONS();
    await page.evaluate(() => document.getElementById('area_id').focus());
    await clear();
    await press('F10');
    await press('Tab');
    let f = await FOCUS();
    assert.ok(f.inBar && !f.inMenu, 'precondition: Tab leaves the menubar to the toolbar: ' + JSON.stringify(f));
    await press('Shift+Tab');
    f = await FOCUS();
    assert.ok(f.inMenu && f.text === s[0].t, 'precondition: Shift+Tab returns to the menubar: ' + JSON.stringify(f));
    await press('Escape');
    assert.ok(await onSheet(), 'Escape put the focus elsewhere than the sheet: ' + JSON.stringify(await FOCUS()));
    let st = await state();
    assert.deepEqual(st.calls.filter(c => /^keys /.test(c)), ['keys false', 'keys true'], 'Escape did not give the keyboard back to the engine');
    assert.ok(st.notes.includes('edit:complete'), 'Escape did not return focus to the sheet (edit:complete)');
    /* An Escape that removed a section stays in the menu row. */
    await clear();
    await press('F10');
    await press('Tab');
    await press('Shift+Tab');
    await press('ArrowDown');
    assert.equal((await SECTIONS())[0].exp, 'true', 'precondition: ArrowDown opens the section');
    await press('Escape');
    await page.evaluate(() => new Promise(r => setTimeout(r, 30)));
    st = await state();
    f = await FOCUS();
    assert.ok(f.inMenu && f.text === s[0].t, 'Escape that closed the section left the menubar: ' + JSON.stringify(f));
    assert.deepEqual(st.calls.filter(c => /^keys /.test(c)), ['keys false'], 'Escape that closed the section gave the keyboard away');
    assert.ok(!st.notes.includes('edit:complete'), 'Escape that closed the section went to the sheet');
});

/* The standard #toolbar area with role=toolbar (Viewport.template; the markup here
   is the same) wraps the whole shell - the header, the menu row (menubar) and our panel (toolbar). In the compact
   the area role is removed: in the accessibility tree there is no toolbar above the menu row and the header, and
   there is one toolbar - ours, not nested in another. In the Standard the area role is standard (the ribbon
   is in it), on return it is removed again. The tree is real (CDP Accessibility.getFullAXTree). */
test('shell_area_is_not_a_toolbar', async () => {
    await fresh({}, 1440, true);
    const cdp = await page.context().newCDPSession(page);
    const ax = async () => {
        const {nodes} = await cdp.send('Accessibility.getFullAXTree');
        const byId = new Map(nodes.map(n => [n.nodeId, n]));
        const role = n => n && n.role && n.role.value;
        const chain = n => { const out = []; for (let p = n && byId.get(n.parentId); p; p = byId.get(p.parentId)) out.push(role(p)); return out; };
        const of = r => nodes.filter(n => !n.ignored && role(n) === r);
        return {toolbars: of('toolbar').length, menubarUp: of('menubar').map(chain)[0] || null, toolbarUp: of('toolbar').map(chain)};
    };
    const area = () => page.evaluate(() => document.getElementById('toolbar').getAttribute('role'));
    assert.equal(await area(), 'none', 'compact: the area around the shell keeps the stock toolbar role');
    let t = await ax();
    assert.ok(t.menubarUp, 'precondition: the menubar is in the accessibility tree');
    assert.equal(t.menubarUp.includes('toolbar'), false, 'compact: the menubar sits inside a toolbar: ' + JSON.stringify(t.menubarUp));
    assert.equal(t.toolbars, 1, 'compact: toolbars in the tree: ' + t.toolbars + ' (only ours is expected)');
    assert.equal(t.toolbarUp[0].includes('toolbar'), false, 'compact: our toolbar is nested in another toolbar');
    await page.evaluate(() => SSE.Views.CompactShell.toggleMode());
    assert.equal(await area(), 'toolbar', 'advanced: the ribbon area lost its stock toolbar role');
    await page.evaluate(() => SSE.Views.CompactShell.toggleMode());
    assert.equal(await area(), 'none', 'back to compact: the area is announced as a toolbar again');
    t = await ax();
    assert.equal(t.menubarUp.includes('toolbar'), false, 'back to compact: the menubar sits inside a toolbar');
    await cdp.detach();
});

test('toolbar_roving_tabindex', async () => {
    await fresh({}, 1440, true);
    const bar = await page.evaluate(() => { const b = document.getElementById('vo-tb'); return [b.getAttribute('role'), !!b.getAttribute('aria-label')]; });
    assert.deepEqual(bar, ['toolbar', true]);
    let st = await STOPS('#vo-tb button, #vo-tb input');
    assert.deepEqual(st.zero, ['undo'], 'the toolbar is one Tab stop: ' + JSON.stringify(st));
    /* Tab: the menu row → the panel → on from the panel. */
    await page.focus('#vo-shell .vo-mn-item');
    await press('Tab');
    let f = await FOCUS();
    assert.equal(f.ctrl, 'undo', 'Tab from the menubar lands on the toolbar stop: ' + JSON.stringify(f));
    assert.ok(f.ring && f.visible, 'no visible focus ring on the blue plate: ' + JSON.stringify(f));
    /* → over the visible available row controls up to the chevron. */
    const order = await page.evaluate(() => {
        const vis = el => el.getClientRects().length > 0;
        return [...document.querySelectorAll('#vo-tb > .vo-g > [data-ctrl]')].filter(vis).map(n => n.getAttribute('data-ctrl'));
    });
    const seen = [];
    for (let i = 0; i < 60; i++) {
        f = await FOCUS();
        const key = f.ctrl || (f.cls.indexOf('vo-focus-btn') >= 0 ? 'chevron' : f.cls.indexOf('vo-more') >= 0 ? 'more' : '?');
        if (seen[seen.length - 1] !== key) seen.push(key);
        if (key === 'chevron') break;
        assert.ok(f.ring, 'no focus ring on ' + key);
        await press('ArrowRight');
    }
    const ctrls = seen.filter(k => k !== 'chevron' && k !== 'more');
    assert.deepEqual(ctrls, order, 'ArrowRight visits the visible controls in order: ' + JSON.stringify(seen));
    /* The start of the walk is as in Documents: Undo · Redo · Search · Comment · Zoom, then the numbers block (as in Google). */
    assert.deepEqual(ctrls.slice(0, 6), ['undo', 'redo', 'search', 'comment', 'zoom', 'currency'], 'the toolbar does not start as in documents: ' + ctrls.join(' '));
    /* The font style is like "Font" in Excel: font · size · Bold · Italic · Underline · Strikethrough · format painter, then the text color. */
    const typeface = ctrls.indexOf('font');
    assert.deepEqual(ctrls.slice(typeface, typeface + 8), ['font', 'size', 'bold', 'italic', 'underline', 'strike', 'paint', 'textColor'],
        'the typeface controls are not in the row order: ' + ctrls.join(' '));
    await press('ArrowRight');
    assert.equal((await FOCUS()).ctrl, 'undo', 'ArrowRight wraps from the chevron to the first control');
    await press('End');
    assert.ok((await FOCUS()).cls.indexOf('vo-focus-btn') >= 0, 'End goes to the chevron');
    await press('Home');
    assert.equal((await FOCUS()).ctrl, 'undo', 'Home');
    st = await STOPS('#vo-tb button, #vo-tb input');
    assert.equal(st.zero.length, 1, 'one Tab stop after moving: ' + JSON.stringify(st));
    /* The font size field: an arrow moves the cursor, at the field edge - to the neighbor; the font size has one stop - the field (the chevron is not a stop,
       there is no "−" and "+"), to the right of it - Bold. */
    await page.focus('#vo-tb [data-ctrl="size"] input');
    await page.evaluate(() => { const i = document.querySelector('#vo-tb [data-ctrl="size"] input'); i.value = '11'; i.setSelectionRange(1, 1); });
    await press('ArrowRight');
    f = await FOCUS();
    assert.equal(f.tag, 'INPUT', 'ArrowRight inside the size field left it');
    assert.equal(f.role, 'combobox', 'the font size field is not a combobox');
    await press('ArrowRight');
    f = await FOCUS();
    assert.equal(f.ctrl, 'bold', 'ArrowRight at the field end did not move to «Bold»: ' + JSON.stringify(f));
    /* ↓ in the font size field - the size list (listbox), focus stays in the field: aria-expanded and the row under the cursor
       (aria-activedescendant - the selected size); Escape - the list is closed, focus in the field. */
    await page.focus('#vo-tb [data-ctrl="size"] input');
    await press('ArrowDown');
    const combo = () => page.evaluate(() => { const i = document.querySelector('#vo-tb [data-ctrl="size"] input'), d = i.getAttribute('aria-activedescendant');
        const o = d && document.getElementById(d), l = document.getElementById(i.getAttribute('aria-controls'));
        return {focus: document.activeElement === i, expanded: i.getAttribute('aria-expanded'), list: l && l.getAttribute('role'),
            option: o ? [o.getAttribute('role'), o.getAttribute('aria-selected'), o.textContent.trim()] : null}; });
    assert.deepEqual(await combo(), {focus: true, expanded: 'true', list: 'listbox', option: ['option', 'true', '11']},
        'ArrowDown in the font size field: not a combobox with its listbox');
    await press('Escape');
    assert.deepEqual(await combo(), {focus: true, expanded: 'false', list: 'listbox', option: null}, 'Escape in the font size list');
    /* ↓ on a list: the list is open, focus on the selected row; ↓ - the next; Escape - the list
       is closed, focus on the button again. */
    /* The value list is the number format. */
    await page.focus('#vo-tb [data-ctrl="numfmt"] > button');
    await press('ArrowDown');
    f = await FOCUS();
    assert.ok(f.cls.indexOf('vo-pop-item') >= 0 && f.text.indexOf('General') === 0, 'ArrowDown on the number format: focus ' + JSON.stringify(f));
    assert.equal(f.tab, '-1', 'list rows must not be Tab stops');
    assert.ok(f.ring, 'no focus ring on a list row');
    await press('ArrowDown');
    assert.equal((await FOCUS()).text.indexOf('Currency'), 0, 'ArrowDown in the list did not move to the next row');
    await press('Escape');
    f = await FOCUS();
    assert.equal(f.ctrl, 'numfmt', 'focus did not return to the number format button after Escape: ' + JSON.stringify(f));
    assert.equal(await page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="numfmt"]').classList.contains('open')), false);
    /* The zoom at the start of the row is the same value list: ↓ - focus on the current 100 %, ↓ - 125 %, Escape - the button again. */
    await page.focus('#vo-tb [data-ctrl="zoom"] > button');
    await press('ArrowDown');
    f = await FOCUS();
    assert.ok(f.cls.indexOf('vo-pop-item') >= 0 && f.text === '100%', 'ArrowDown on zoom: focus ' + JSON.stringify(f));
    await press('ArrowDown');
    assert.equal((await FOCUS()).text, '125%', 'ArrowDown in the zoom list did not move to the next row');
    await press('Escape');
    f = await FOCUS();
    assert.equal(f.ctrl, 'zoom', 'focus did not return to the zoom button after Escape: ' + JSON.stringify(f));
    assert.equal(await page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="zoom"]').classList.contains('open')), false);
    /* Enter on a list button opens the list, focus in it. */
    await page.focus('#vo-tb [data-ctrl="borders"] > button');
    await press('Enter');
    f = await FOCUS();
    assert.ok(f.cls.indexOf('vo-pop-item') >= 0, 'Enter on a list button did not focus its first row: ' + JSON.stringify(f));
    /* Tab from a list: the list is closed, focus leaves the panel. */
    await press('Tab');
    f = await FOCUS();
    assert.ok(!f.inBar, 'Tab from a list stayed in the toolbar: ' + JSON.stringify(f));
    assert.equal(await page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="borders"]').classList.contains('open')), false, 'Tab left the list open');
    /* A control disabled by the stock drops out of the walk. */
    await page.evaluate(() => { twins.btnBold.setDisabled(true); });
    await page.evaluate(() => new Promise(r => setTimeout(r, 40)));
    await page.focus('#vo-tb [data-ctrl="size"] input');
    await press('End');                                             // the cursor to the end of the field
    await press('ArrowRight');                                      // Bold is disabled - Italic is next
    assert.equal((await FOCUS()).ctrl, 'italic', 'a dimmed control is in the arrow order');
    await page.evaluate(() => { twins.btnBold.setDisabled(false); });
    /* "⋯" in a narrow window: Enter opens the list, focus on the first control that went away, arrows go
       over them. */
    await fresh({}, 1280, true);
    const gone = await page.evaluate(() => [...document.querySelectorAll('#vo-tb [data-ctrl].vo-collapsed')].map(n => n.getAttribute('data-ctrl')));
    assert.ok(gone.length > 0, 'precondition: something went to «⋯» at 1280');
    await page.focus('#vo-tb .vo-more');
    await press('Enter');
    f = await FOCUS();
    assert.equal(f.ctrl, gone[0], 'Enter on «⋯» did not focus the first overflowed control: ' + JSON.stringify(f));
    await press('ArrowRight');
    assert.equal((await FOCUS()).ctrl, gone[1], 'ArrowRight inside «⋯»');
    await press('Escape');
    assert.ok((await FOCUS()).cls.indexOf('vo-more') >= 0, 'Escape did not return focus to «⋯»');
    /* Below the floor a truncated core is not a Tab stop and not an arrow target. */
    await resizeTo(520);
    const clipped = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('#vo-tb .vo-g.vo-g-clip').forEach(g => {
            const gr = g.getBoundingClientRect();
            g.querySelectorAll('button, input').forEach(el => { const r = el.getBoundingClientRect();
                if (r.width && r.right > gr.right + 0.5) out.push({ctrl: el.closest('[data-ctrl]').getAttribute('data-ctrl'), tab: el.getAttribute('tabindex')}); });
        });
        return out;
    });
    assert.ok(clipped.length > 0, 'precondition: controls clipped at 520');
    assert.ok(clipped.every(x => x.tab === '-1'), 'clipped controls stay in the tab order: ' + JSON.stringify(clipped));
    /* An arrow walk in a circle: not a single stop on a truncated node. */
    await page.focus('#vo-tb [data-ctrl="undo"] > button, #vo-tb button[data-ctrl="undo"]');
    const onClipped = [];
    for (let i = 0; i < 20; i++) {
        await press('ArrowRight');
        const c = await page.evaluate(() => { const el = document.activeElement, g = el && el.closest('.vo-g');
            if (!g || !g.classList.contains('vo-g-clip')) return null;
            return el.getBoundingClientRect().right > g.getBoundingClientRect().right + 0.5 ? (el.closest('[data-ctrl]') || el).getAttribute('data-ctrl') : null; });
        if (c) onClipped.push(c);
    }
    assert.deepEqual(onClipped, [], 'ArrowRight reached a clipped control (clipped: ' + JSON.stringify(clipped) + ')');
    /* A restriction: there are no stops; removed - one stop again (roving tabindex instead of "no tabindex"). */
    await resizeTo(1440);
    await page.evaluate(() => SSE.Views.CompactToolbar.setLocked(true));
    st = await STOPS('#vo-tb button, #vo-tb input');
    assert.deepEqual(st.zero, [], 'Tab stops under the lock');
    await page.evaluate(() => SSE.Views.CompactToolbar.setLocked(false));
    st = await STOPS('#vo-tb button, #vo-tb input');
    assert.equal(st.zero.length, 1, 'the toolbar Tab stop is not back after the lock: ' + JSON.stringify(st));
});

/* A pressed fill for the screen reader, like Bold: the "pressed" state of the button in the accessibility tree (aria-pressed) while the selection has a
   fill; without a fill - "not pressed". The tree is real (CDP Accessibility.getFullAXTree). */
test('fill_pressed_announced_as_bold', async () => {
    await fresh({}, 1440, true);
    const cdp = await page.context().newCDPSession(page);
    const pressed = async () => {
        const {nodes} = await cdp.send('Accessibility.getFullAXTree');
        const of = name => { const n = nodes.find(m => !m.ignored && m.role && m.role.value === 'button' && m.name && m.name.value === name);
            const p = n && (n.properties || []).find(x => x.name === 'pressed'); return p ? String(p.value.value) : null; };
        return {bold: of('Bold'), fill: of('Fill color')};
    };
    const fill = on => page.evaluate(on => {
        api.fillColor = on ? {get_auto: () => false, get_r: () => 0xd0, get_g: () => 0xe6, get_b: () => 0xf6} : {get_auto: () => true};
        api.send('asc_onSelectionChanged', api.asc_getCellInfo());
    }, on);
    await page.evaluate(() => { twins.btnBold.toggle(true); });
    await fill(true);
    await page.evaluate(() => new Promise(r => setTimeout(r, 40)));
    assert.deepEqual(await pressed(), {bold: 'true', fill: 'true'}, 'fill with a fill is not announced pressed as «Bold»');
    await page.evaluate(() => { twins.btnBold.toggle(false); });
    await fill(false);
    await page.evaluate(() => new Promise(r => setTimeout(r, 40)));
    assert.deepEqual(await pressed(), {bold: 'false', fill: 'false'}, 'fill without a fill is not announced as not pressed');
    await cdp.detach();
});

/* For the screen reader pressed state is on the toggles, like Bold: text color, ₽, % - "pressed" while the format is on, "not pressed" when it is removed.
   Buttons with a list ("123", horizontal and vertical, wrap, merge, rotation, freeze) are pressed only by look, like
   "Borders": they have no "pressed" state in the tree - a click opens the list, it does not toggle; they stay list buttons
   (aria-haspopup). The tree is real (CDP Accessibility.getFullAXTree). The negative control is the code before the edit: toggles have no
   "pressed" state in the tree; list buttons have it. */
test('pressed_announced_on_toggles_only', async () => {
    await fresh({}, 2000, true);
    const keys = ['bold', 'textColor', 'currency', 'percent', 'numfmt', 'halign', 'valign', 'wrap', 'merge', 'rotate', 'freeze'];
    const names = await page.evaluate(ks => Object.fromEntries(ks.map(k => {
        const b = document.querySelector('#vo-tb [data-ctrl="' + k + '"] > button, #vo-tb button[data-ctrl="' + k + '"]');
        return [k, b.getAttribute('aria-label')];
    })), keys);
    const cdp = await page.context().newCDPSession(page);
    const pressed = async () => {
        const {nodes} = await cdp.send('Accessibility.getFullAXTree');
        return Object.fromEntries(keys.map(k => {
            const n = nodes.find(m => !m.ignored && m.role && m.role.value === 'button' && m.name && m.name.value === names[k]);
            const p = n && (n.properties || []).find(x => x.name === 'pressed');
            return [k, p ? String(p.value.value) : null];
        }));
    };
    const set = on => page.evaluate(on => {
        twins.btnBold.toggle(on, true);
        ['btnAlignLeft', 'btnAlignCenter', 'btnAlignRight', 'btnAlignJust'].forEach(n => twins[n].toggle(on && n === 'btnAlignCenter', true));
        ['btnAlignTop', 'btnAlignMiddle', 'btnAlignBottom'].forEach(n => twins[n].toggle(on ? n === 'btnAlignTop' : n === 'btnAlignBottom', true));
        twins.btnWrap.toggle(on, true);
        twins.btnMerge.toggle(on, true);
        api.fontColor = on ? {get_auto: () => false, get_r: () => 0xe1, get_g: () => 0x1d, get_b: () => 0x48} : {get_auto: () => true};
        api.numType = on ? Asc.c_oAscNumFormatType.Accounting : Asc.c_oAscNumFormatType.General;
        api.angle = on ? 90 : 0;
        api.frozen = on;
        api.send('asc_onSelectionChanged', api.asc_getCellInfo());
    }, on);
    await set(true);
    await page.evaluate(() => new Promise(r => setTimeout(r, 40)));
    const lists = ['numfmt', 'halign', 'valign', 'wrap', 'merge', 'rotate', 'freeze'];
    assert.deepEqual(await pressed(), {bold: 'true', textColor: 'true', currency: 'true', percent: 'false', numfmt: null, halign: null,
        valign: null, wrap: null, merge: null, rotate: null, freeze: null}, 'a toggle with its format on is not announced pressed as «Bold», or a list button is');
    const shown = await page.evaluate(ks => ks.filter(k => document.querySelector('#vo-tb [data-ctrl="' + k + '"] > button').classList.contains('on')), lists);
    assert.deepEqual(shown, lists, 'a list button with its format on is not shown pressed');
    await set(false);
    await page.evaluate(() => new Promise(r => setTimeout(r, 40)));
    const off = await pressed();
    assert.deepEqual(off, Object.fromEntries(keys.map(k => [k, lists.includes(k) ? null : 'false'])),
        'a toggle with its format off is not announced as not pressed, or a list button got a pressed state');
    const popup = await page.evaluate(() => ['numfmt', 'halign', 'wrap', 'freeze', 'textColor'].map(k =>
        document.querySelector('#vo-tb [data-ctrl="' + k + '"] > button').getAttribute('aria-haspopup')));
    assert.deepEqual(popup, ['menu', 'menu', 'menu', 'menu', 'dialog'], 'a pressed list button lost its popup');
    await cdp.detach();
});

test('disabled_announced', async () => {
    await fresh({}, 1440, true);
    await page.evaluate(() => {
        api.asc_isProtectedSheet = () => true;
        ['btnBold', 'btnBorders'].forEach(k => { twins[k].keepState = ['worksheet-lock']; twins[k].setDisabled(true); });
        api.send('asc_onSelectionChanged', api.asc_getCellInfo());
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 40)));
    const reason = await page.evaluate(() => SSE.Views.SheetActions.textProtected);
    /* The reason is in the hint; its text is aria-description (it used to be title): the hover hint shows it, and it is also the button description
       for the screen reader (in the accessibility tree - description after the name). */
    const tb = await page.evaluate(() => ['bold', 'borders', 'italic'].map(k => {
        const n = document.querySelector('#vo-tb [data-ctrl="' + k + '"]'), b = n.tagName === 'BUTTON' ? n : n.querySelector('button');
        return {k, aria: b.getAttribute('aria-disabled'), title: b.getAttribute('aria-description'), disabled: b.disabled, label: b.getAttribute('aria-label')};
    }));
    tb.slice(0, 2).forEach(x => {
        assert.equal(x.aria, 'true', x.k + ': an inactive control is not announced as unavailable (aria-disabled)');
        assert.ok(x.disabled, x.k + ': precondition — the stock twin is disabled');
        assert.ok((x.title || '').indexOf(reason) >= 0, x.k + ': no reason in the hint: ' + x.title);
    });
    assert.notEqual(tb[2].aria, 'true', 'an active control is announced as unavailable');
    const cdp = await page.context().newCDPSession(page);
    const {nodes} = await cdp.send('Accessibility.getFullAXTree');
    await cdp.detach();
    const said = tb.map(x => { const n = nodes.find(m => !m.ignored && m.role && m.role.value === 'button' && m.name && m.name.value === x.label);
        return n ? [n.name.value, n.description ? n.description.value : null] : null; });
    tb.slice(0, 2).forEach((x, i) => {
        assert.ok(said[i], x.k + ': the button is not in the accessibility tree by its name ' + x.label);
        assert.ok((said[i][1] || '').indexOf(reason) >= 0, x.k + ': the screen reader does not hear the reason (AX description ' + JSON.stringify(said[i][1]) + ')');
    });
    assert.equal(said[2] && said[2][1], tb[2].title, 'the active control: the AX description is not its tip text');
    /* A menu row item: aria-disabled and the reason in the hint. */
    await page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-mn-item')][4].click());
    const row = await page.evaluate(() => { const r = document.querySelector('#vo-shell .vo-mn-drop.open [data-k="borders"]');
        return {aria: r.getAttribute('aria-disabled'), title: r.getAttribute('title'), cls: r.className}; });
    assert.equal(row.aria, 'true', 'an inactive menu item is not aria-disabled: ' + JSON.stringify(row));
    assert.ok((row.title || '').indexOf(reason) >= 0, 'no reason on the inactive menu item: ' + JSON.stringify(row));
    const live = await page.evaluate(() => document.querySelector('#vo-shell .vo-mn-drop.open [data-k="merge"]').getAttribute('aria-disabled'));
    assert.equal(live, 'false', 'an active menu item is announced as unavailable');
    /* An inactive item stays in the arrow walk - the screen reader names it and the reason. */
    await page.focus('#vo-shell .vo-mn-drop.open [data-k="merge"]');
    await press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-k')), 'borders', 'an inactive menu item is skipped by arrows');
    await press('Escape');
    /* A reader who can request editing: the reason is how to start editing, not
       "no right", "File → Edit spreadsheet" is alive beside it. */
    await fresh({options: {isEdit: false, canEdit: true, canRequestEditRights: true}}, 1440, true);
    const req = await page.evaluate(() => { const S = SSE.Views.CompactShell;
        return {reason: SSE.Views.SheetActions.reasonText(S.modeCode({on: true, type: 'rights', options: {}})), want: S.textModeLockedRequest,
                rights: S.textModeLockedRights, mode: !!document.querySelector('#vo-shell .vo-docmode')}; });
    assert.ok(req.want && req.want !== req.rights, 'no own phrase for a reader who can request editing');
    assert.equal(req.reason, req.want, 'reader with the request right hears «no permission»');
    assert.equal(req.mode, false, 'a reader with the request right has a mode switch (none, as in documents)');
    await fresh({options: {isEdit: false, canEdit: false}}, 1440, true);
    const plain = await page.evaluate(() => { const S = SSE.Views.CompactShell;
        return {reason: SSE.Views.SheetActions.reasonText(S.modeCode({on: true, type: 'rights', options: {}})), rights: S.textModeLockedRights,
                mode: !!document.querySelector('#vo-shell .vo-docmode')}; });
    assert.equal(plain.reason, plain.rights, 'a plain reader: «no permission»');
    assert.equal(plain.mode, false, 'a plain reader has a mode switch (none, as in documents)');
});

/* The shell lists are role=menu, and the standard Bootstrap
   delegate (here its copy, HARNESS) suppresses any key in [role=menu]: Enter and space on a
   leaf item must run it (the item click - once), Tab - leave the layer; keys
   that the shell drives itself do not reach the delegate. The mode switch is the same keyboard
   as the panel lists. Every palette node, including the reset row, has a visible focus ring. */
test('leaf_items_run_from_keyboard', async () => {
    await fresh({}, 1440, true);
    const count = (list, x) => list.filter(y => y === x).length;
    const open = () => page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-mn-item')].filter(b => b.getAttribute('aria-expanded') === 'true').length);
    /* 1. A menu row, a leaf item: "Data → Sort A to Z" - Enter. */
    await clear();
    await page.evaluate(() => { stockMenuKeys.length = 0; });
    await press('F10');
    await press('Home');
    await press('ArrowRight', 5);
    await press('ArrowDown');
    let f = await FOCUS();
    assert.equal(f.k, 'sortAZ', 'precondition: Data → Sort A to Z is focused: ' + JSON.stringify(f));
    await press('Enter');
    let st = await state();
    assert.equal(count(st.log, 'click DataTab:btnsSortDown.0'), 1, 'Enter on a leaf menu item did not run it once: ' + JSON.stringify(st.log));
    assert.equal(await open(), 0, 'the section stayed open after the command');
    /* Space - the same, on a neighboring item. */
    await clear();
    await press('F10');
    await press('ArrowDown');
    await press('ArrowDown');
    f = await FOCUS();
    assert.equal(f.k, 'sortZA', 'precondition: Data → Sort Z to A is focused: ' + JSON.stringify(f));
    await press(' ');
    st = await state();
    assert.equal(count(st.log, 'click DataTab:btnsSortUp.0'), 1, 'Space on a leaf menu item did not run it once: ' + JSON.stringify(st.log));
    /* 2. A submenu leaf item: "Format → Borders ▸ → first row" - Enter, the standard item click. */
    await clear();
    await press('F10');
    await press('Home');
    await press('ArrowRight', 4);
    await press('ArrowDown');
    for (let i = 0; i < 30 && (await FOCUS()).k !== 'borders'; i++) await press('ArrowDown');
    await press('ArrowRight');
    f = await FOCUS();
    assert.equal(f.level, '1', 'precondition: in the Borders submenu: ' + JSON.stringify(f));
    await press('Enter');
    st = await state();
    assert.equal(count(st.log, 'pick Toolbar:btnBorders Bottom border'), 1, 'Enter on a submenu item did not pick it once: ' + JSON.stringify(st.log));
    assert.equal(await page.evaluate(() => !!document.querySelector('#vo-shell .vo-mn-fly')), false, 'the submenu stayed open');
    /* 3. Panel lists: "Borders" (a mirror) - Enter, "Horizontal alignment" (a choice) - space. */
    await clear();
    await page.focus('#vo-tb [data-ctrl="borders"] > button');
    await press('Enter');
    await press('ArrowDown');
    f = await FOCUS();
    assert.equal(f.text, 'Top border', 'precondition: the second Borders row: ' + JSON.stringify(f));
    await press('Enter');
    st = await state();
    assert.equal(count(st.log, 'pick Toolbar:btnBorders Top border'), 1, 'Enter on a toolbar list row did not pick it once: ' + JSON.stringify(st.log));
    assert.equal(await page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="borders"]').classList.contains('open')), false, 'the list stayed open');
    await clear();
    await page.focus('#vo-tb [data-ctrl="halign"] > button');
    await press('ArrowDown');
    await press('ArrowDown');
    await press(' ');
    st = await state();
    assert.equal(count(st.log, 'click Toolbar:btnAlignCenter'), 1, 'Space on a toolbar choice row did not run it once: ' + JSON.stringify(st.log));
    /* 4. The palette: the reset row and a swatch - Enter and space, one choice each. */
    await page.evaluate(() => { twins.btnBackColor.on('color:select', (b, c) => log.push('fill ' + c)); });
    await clear();
    await page.focus('#vo-tb [data-ctrl="fillColor"] > button');
    await press('ArrowDown');
    f = await FOCUS();
    assert.ok(/vo-cb-reset/.test(f.cls), 'precondition: no fill — focus on the reset row: ' + JSON.stringify(f));
    await press('Enter');
    st = await state();
    assert.equal(count(st.log, 'fill transparent'), 1, 'Enter on «No fill» did not run it once: ' + JSON.stringify(st.log));
    await clear();
    await page.focus('#vo-tb [data-ctrl="fillColor"] > button');
    await press('ArrowDown');
    await press('ArrowDown');
    f = await FOCUS();
    assert.ok(/vo-pal-item/.test(f.cls), 'precondition: a swatch: ' + JSON.stringify(f));
    await press(' ');
    st = await state();
    assert.equal(st.log.filter(x => /^fill [0-9A-F]{6}$/.test(x)).length, 1, 'Space on a swatch did not pick it once: ' + JSON.stringify(st.log));
    /* 5. Tab from an open panel list and a menu row section - leaves the layer and the row. */
    await page.focus('#vo-tb [data-ctrl="halign"] > button');
    await press('ArrowDown');
    await press('Tab');
    f = await FOCUS();
    assert.ok(!f.inBar, 'Tab from an open toolbar list stayed in the toolbar: ' + JSON.stringify(f));
    await press('F10');
    await press('ArrowDown');
    await press('Tab');
    f = await FOCUS();
    assert.ok(f.inBar && !f.inMenu, 'Tab from an open menu section did not move to the toolbar: ' + JSON.stringify(f));
    const leaked = await page.evaluate(() => stockMenuKeys.filter(k => ['Enter', ' ', 'Tab', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(k)));
    assert.deepEqual(leaked, [], 'keys handled by the shell reached the stock dropdown delegate');
    /* 6. The mode switch: Enter - the list, focus on the selected row; ↓ and Enter - the mode
       is chosen (its click), the list is closed, focus on the button again; ↑ on the button - the last row;
       Tab from the list - onward out of the switch. */
    await page.evaluate(() => { SSE.Views.CompactShell.setSheetMode = m => { log.push('mode ' + m); return true; }; });
    await clear();
    const MODE = '#vo-shell .vo-docmode .vo-mode';
    const modeOpen = () => page.evaluate(() => document.querySelector('#vo-shell .vo-docmode').classList.contains('open'));
    const items = await page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-docmode [data-mode]')].map(b => ({m: b.getAttribute('data-mode'), tab: b.getAttribute('tabindex')})));
    assert.ok(items.length === 2 && items.every(x => x.tab === '-1'), 'mode rows must not be Tab stops: ' + JSON.stringify(items));
    await page.focus(MODE);
    await press('Enter');
    assert.equal(await modeOpen(), true, 'Enter on the mode switch did not open its list');
    f = await page.evaluate(() => ({mode: document.activeElement.getAttribute('data-mode'), checked: document.activeElement.getAttribute('aria-checked')}));
    assert.deepEqual(f, {mode: 'edit', checked: 'true'}, 'focus is not on the checked mode row');
    assert.ok((await FOCUS()).ring, 'no focus ring on a mode row');
    await press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-mode')), 'view', 'ArrowDown in the mode list');
    await press('Enter');
    st = await state();
    assert.equal(count(st.log, 'mode view'), 1, 'Enter on a mode row did not choose it once: ' + JSON.stringify(st.log));
    assert.equal(await modeOpen(), false, 'the mode list stayed open');
    assert.ok(await page.evaluate(sel => document.activeElement === document.querySelector(sel), MODE), 'focus did not return to the mode switch');
    await press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-mode')), 'view', 'ArrowUp on the mode switch — the last row');
    await press('Escape');
    assert.equal(await modeOpen(), false, 'Escape left the mode list open');
    await press(' ');
    assert.equal(await modeOpen(), true, 'Space on the mode switch did not open its list');
    await press('Tab');
    assert.equal(await modeOpen(), false, 'Tab left the mode list open');
    f = await page.evaluate(() => ({inMode: !!document.activeElement.closest('.vo-docmode'), tag: document.activeElement.tagName}));
    assert.ok(!f.inMode, 'Tab from the mode list stayed in the mode switch: ' + JSON.stringify(f));
    /* 7. "Download": rows are not Tab stops; Enter on the button - the list and focus on the first row,
       ↑ - on the last ("Print"); ↓/↑ in a circle, Home/End; Enter on a row - the command once,
       the list is closed; Escape - the list is closed, focus on the button; Tab from the list - onward out of "Download".
       The keys that "Download" drives do not reach the Bootstrap delegate. */
    const DL = '#vo-shell .vo-hd .vo-download > .vo-ib';
    const dlOpen = () => page.evaluate(() => document.querySelector('#vo-shell .vo-hd .vo-download').classList.contains('open'));
    const dlKey = () => page.evaluate(() => document.activeElement.getAttribute('data-k'));
    const dlRows = await page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-hd .vo-download .vo-pop-item')]
        .map(b => ({k: b.getAttribute('data-k'), tab: b.getAttribute('tabindex'), role: b.getAttribute('role')})));
    assert.deepEqual(dlRows.map(x => x.k), ['downloadXlsx', 'downloadPdf', 'downloadCsv', 'downloadOds', 'print'], '«Download» rows');
    assert.ok(dlRows.every(x => x.tab === '-1' && x.role === 'menuitem'), '«Download» rows must be menu items, not Tab stops: ' + JSON.stringify(dlRows));
    await page.evaluate(() => { stockMenuKeys.length = 0; SSE.Views.SheetActions.download = t => log.push('download ' + t); });
    await clear();
    await page.focus(DL);
    await press('Enter');
    assert.equal(await dlOpen(), true, 'Enter on «Download» did not open its list');
    assert.equal(await page.evaluate(sel => document.querySelector(sel).getAttribute('aria-expanded'), DL), 'true');
    assert.equal(await dlKey(), 'downloadXlsx', 'Enter on «Download»: focus is not on the first row');
    assert.ok((await FOCUS()).ring, 'no focus ring on a «Download» row');
    await press('ArrowUp');
    assert.equal(await dlKey(), 'print', 'ArrowUp from the first row did not wrap to the last');
    await press('ArrowDown');
    assert.equal(await dlKey(), 'downloadXlsx', 'ArrowDown from the last row did not wrap to the first');
    await press('End');
    assert.equal(await dlKey(), 'print', 'End in the «Download» list');
    await press('Home');
    assert.equal(await dlKey(), 'downloadXlsx', 'Home in the «Download» list');
    await press('ArrowDown');
    assert.equal(await dlKey(), 'downloadPdf', 'ArrowDown in the «Download» list');
    await press('ArrowUp');
    await press('Enter');
    st = await state();
    assert.deepEqual(st.log.filter(x => /^download /.test(x)), ['download XLSX'], 'Enter on «Download XLSX» did not run it once: ' + JSON.stringify(st.log));
    assert.equal(await dlOpen(), false, 'the «Download» list stayed open after the command');
    await clear();
    await page.focus(DL);
    await press('ArrowUp');
    assert.equal(await dlOpen(), true, 'ArrowUp on «Download» did not open its list');
    assert.equal(await dlKey(), 'print', 'ArrowUp on «Download» — the last row');
    await press('Enter');
    st = await state();
    assert.equal(count(st.notes, 'print'), 1, 'Enter on «Print» did not print once: ' + JSON.stringify(st.notes));
    assert.equal(await dlOpen(), false, 'the «Download» list stayed open after printing');
    await page.focus(DL);
    await press('ArrowDown');
    assert.equal(await dlKey(), 'downloadXlsx', 'ArrowDown on «Download» — the first row');
    await press('Escape');
    assert.equal(await dlOpen(), false, 'Escape left the «Download» list open');
    assert.ok(await page.evaluate(sel => document.activeElement === document.querySelector(sel), DL), 'Escape: focus did not return to «Download»');
    await press(' ');
    assert.equal(await dlOpen(), true, 'Space on «Download» did not open its list');
    await press('Tab');
    assert.equal(await dlOpen(), false, 'Tab left the «Download» list open');
    f = await page.evaluate(() => ({inDl: !!document.activeElement.closest('.vo-download'), tag: document.activeElement.tagName}));
    assert.ok(!f.inDl, 'Tab from the «Download» list stayed in «Download»: ' + JSON.stringify(f));
    assert.deepEqual(await page.evaluate(() => stockMenuKeys.slice()), [], 'keys handled by «Download» reached the stock dropdown delegate');
});

test('focus_ring_on_every_palette_node', async () => {
    await fresh({}, 1440, true);
    for (const k of ['fillColor', 'textColor']) {
        await page.focus(`#vo-tb [data-ctrl="${k}"] > button`);
        await press('ArrowDown');
        const nodes = await page.evaluate(sel => [...document.querySelectorAll(sel + ' .vo-cb-pop button, ' + sel + ' .vo-cb-pop input')]
            .filter(el => el.getClientRects().length > 0).length, `#vo-tb [data-ctrl="${k}"]`);
        assert.ok(nodes > 10, k + ': precondition — the palette is open: ' + nodes);
        /* Home - reset, → over the grid swatches one at a time, End - "Custom color". */
        await press('Home');
        let f = await FOCUS();
        assert.ok(/vo-cb-reset/.test(f.cls), k + ': Home is the reset row: ' + JSON.stringify(f));
        assert.ok(f.ring && f.visible, k + ': no visible focus ring on the reset row («' + f.text + '»): ' + JSON.stringify(f));
        await press('ArrowDown');
        const swatches = await page.evaluate(sel => document.querySelectorAll(sel + ' .vo-pal-item').length, `#vo-tb [data-ctrl="${k}"]`);
        const bare = [];
        for (let i = 0; i < swatches; i++) {
            f = await FOCUS();
            if (!/vo-pal-item/.test(f.cls)) { bare.push('not a swatch at ' + i + ': ' + f.cls); break; }
            if (!f.ring) bare.push(f.label);
            await press('ArrowRight');
        }
        assert.deepEqual(bare, [], k + ': swatches without a focus ring');
        await press('End');
        f = await FOCUS();
        assert.ok(/vo-pal-toggle/.test(f.cls) && f.ring, k + ': no focus ring on «Custom color»: ' + JSON.stringify(f));
        await press('Enter');
        f = await FOCUS();
        assert.ok(f.tag === 'INPUT' && f.ring, k + ': no focus ring on the color code field: ' + JSON.stringify(f));
        await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
    }
});

/* "Custom color" opens the color code field and hides itself (CompactToolbar gives it vo-hidden), but
   the single-class .vo-hidden was overridden by display: block of the .vo-pal-toggle rule of the same specificity (compact-shell.less):
   the button stayed above the field, and ↑ from the field led to it. Now - from the keyboard (End, Enter) and with the mouse: the button is not visible and
   is not in the palette walk, the field is visible; ↑ from the field - the last palette swatch, ↓ - in a circle to the reset row. */
test('custom_color_hides_its_button', async () => {
    await fresh({}, 1440, true);
    const look = sel => page.evaluate(sel => {
        const t = document.querySelector(sel + ' .vo-pal-toggle'), fld = document.querySelector(sel + ' .vo-pal-custom');
        const items = [...document.querySelectorAll(sel + ' .vo-pal-item')];
        return {toggle: t.getClientRects().length > 0, display: getComputedStyle(t).display, field: fld.getClientRects().length > 0,
            last: items[items.length - 1].getAttribute('data-color')};
    }, sel);
    for (const k of ['fillColor', 'textColor']) {
        const sel = `#vo-tb [data-ctrl="${k}"]`;
        await page.focus(sel + ' > button');
        await press('ArrowDown');
        await press('End');
        let f = await FOCUS();
        assert.ok(/vo-pal-toggle/.test(f.cls), k + ': precondition — End is «Custom color»: ' + JSON.stringify(f));
        let v = await look(sel);
        assert.ok(v.toggle && !v.field, k + ': precondition — the button is shown, the field is not: ' + JSON.stringify(v));
        await press('Enter');
        f = await FOCUS();
        v = await look(sel);
        assert.ok(f.tag === 'INPUT', k + ': precondition — Enter on «Custom color» opens the code field: ' + JSON.stringify(f));
        assert.ok(!v.toggle && v.display === 'none' && v.field, k + ': «Custom color» stays shown above the open code field: ' + JSON.stringify(v));
        await press('ArrowUp');
        f = await FOCUS();
        assert.ok(/vo-pal-item/.test(f.cls) && f.label === '#' + v.last.toUpperCase(),
            k + ': ArrowUp from the code field is not the last palette swatch (#' + v.last.toUpperCase() + '): ' + JSON.stringify(f));
        await page.focus(sel + ' .vo-pal-input');
        await press('ArrowDown');
        f = await FOCUS();
        assert.ok(/vo-cb-reset/.test(f.cls), k + ': ArrowDown from the code field does not wrap to the reset row: ' + JSON.stringify(f));
        await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
    }
    /* With the mouse: a click on "Custom color" - the same (the field, once open, stays open until the panel is rebuilt - a fresh page). */
    await fresh({}, 1440, true);
    const sel = '#vo-tb [data-ctrl="fillColor"]';
    await page.click(sel + ' > button');
    await page.click(sel + ' .vo-pal-toggle');
    const v = await look(sel);
    assert.ok(!v.toggle && v.field, 'a click on «Custom color» left the button shown above the code field: ' + JSON.stringify(v));
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
});

/* The command of a menu item chosen from the keyboard (F10) puts
   focus in the same place as after a mouse click: "Edit → Find and replace" - into the search field, "Review
   → Chat" - into the message field, typed text - into the field; a command without its own place ("Data → Sort") -
   focus stays with the sheet; the engine keyboard is with it in both cases. The stock and the engine here are models by measurement
   in the editor (the focusin and asc_enableKeyEvents chronology) and by code:
   - the engine: asc_enableKeyEvents(true) itself puts focus into its #area_id field (sdkjs text_input2.js,
     setInterfaceEnableKeyEvents);
   - Main.onEditComplete: edit:complete → DocumentHolder.focus (_.defer) → focus to the sheet;
   - the search panel: the button shows it and defers the field focus (SearchPanel.focus - setTimeout 10),
     and itself spends about 20 ms counting the layout (layout:changed, measured: the field focus is assigned at the 18th ms,
     the command ended at the 27th) - the busy model is 15 ms; the chat panel is _.defer (Chat.focus).
   The former return to the sheet after a command (edit:complete) overtook the deferred field focus - in the editor
   the field is in focus at the 41st ms, the sheet takes it away at the 44th: a letter went into the cell. */
test('menu_command_focus_like_mouse', async () => {
    await fresh({options: {canChat: true, canViewComments: true}}, 1440, true, () => {
        const area = document.createElement('textarea');
        area.id = 'area_id';
        document.body.appendChild(area);
        const panel = (id, tag) => {
            const p = document.createElement('div');
            p.id = id;
            p.style.display = 'none';
            const field = document.createElement(tag);
            p.appendChild(field);
            document.body.appendChild(p);
            return {p, field};
        };
        const search = panel('left-panel-search', 'input'), chat = panel('left-panel-chat', 'textarea');
        const busy = ms => { const t = performance.now(); while (performance.now() - t < ms) { /* layout */ } };
        leftMenu.btnSearchBar = twin('LeftMenu:btnSearchBar', {toggle: true});
        leftMenu.btnSearchBar.on('click', b => {
            search.p.style.display = b.pressed ? '' : 'none';
            if (!b.pressed) return;
            setTimeout(() => { search.field.focus(); search.field.select(); }, 10);
            busy(15);
        });
        leftMenu.btnChat = twin('LeftMenu:btnChat', {toggle: true});
        leftMenu.btnChat.on('click', b => {
            chat.p.style.display = b.pressed ? '' : 'none';
            if (b.pressed) _.defer(() => chat.field.focus());
        });
        const keys = api.asc_enableKeyEvents;
        api.asc_enableKeyEvents = function (v) {
            keys.call(this, v);
            if (v === true && document.activeElement !== area) area.focus();
        };
        Common.NotificationCenter.on('edit:complete', () => _.defer(() => area.focus()));
    });
    const wait = ms => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
    const where = () => page.evaluate(() => {
        const a = document.activeElement;
        return {id: a && a.id, tag: a && a.tagName, zone: !a || a === document.body ? 'body' : a.closest('#left-panel-search') ? 'search' :
            a.closest('#left-panel-chat') ? 'chat' : a.id === 'area_id' ? 'sheet' : a.closest('#toolbar') ? 'toolbar' : 'other'};
    });
    /* F10 → a section by caption → ↓ to item k. */
    const reach = async (sectionKey, k) => {
        await page.evaluate(() => document.getElementById('area_id').focus());
        await press('F10');
        await press('Home');
        const title = await page.evaluate(key => SSE.Views.SheetActions[key], sectionKey);
        for (let i = 0; i < 8 && (await FOCUS()).text !== title; i++) await press('ArrowRight');
        await press('ArrowDown');
        for (let i = 0; i < 40 && (await FOCUS()).k !== k; i++) await press('ArrowDown');
        return (await FOCUS()).k;
    };
    /* The chat field is no longer from the menu: there is no "Chat" in the compact -
       even with the chat right the menu row does not offer it. */
    assert.equal(await page.evaluate(() => SSE.Views.SheetActions.offered('chat')), null, '«Collaboration → Chat» is offered');
    const fields = [['textEdit', 'findReplace', 'Enter', 'search', 'input']];
    for (const [section, k, key, zone, tag] of fields) {
        assert.equal(await reach(section, k), k, 'precondition: ' + k + ' is reached by arrows');
        await clear();
        await press(key);
        await wait(80);
        const f = await where();
        assert.equal(f.zone, zone, k + ' run from the keyboard: focus is on ' + JSON.stringify(f) + ', not in the ' + zone + ' field (as after a mouse click)');
        await page.keyboard.type('q');
        const typed = await page.evaluate(sel => ({field: document.querySelector(sel).value, sheet: document.getElementById('area_id').value}),
            '#left-panel-' + zone + ' ' + tag);
        assert.deepEqual(typed, {field: 'q', sheet: ''}, k + ': the typed letter must go into the ' + zone + ' field, not into the sheet');
        const st = await state();
        assert.deepEqual(st.calls.filter(c => /^keys /.test(c)).slice(-1), ['keys true'], k + ': the engine keyboard was not given back');
        await page.evaluate(sel => { document.querySelector(sel).value = ''; }, '#left-panel-' + zone + ' ' + tag);
    }
    /* A command without its own place - focus is with the sheet, the keyboard is with the engine. */
    assert.equal(await reach('textData', 'sortAZ'), 'sortAZ', 'precondition: Data → Sort A to Z is reached by arrows');
    await clear();
    await press('Enter');
    await wait(80);
    const st = await state();
    assert.equal(st.log.filter(x => x === 'click DataTab:btnsSortDown.0').length, 1, 'Enter did not run Sort A to Z once');
    assert.equal((await where()).zone, 'sheet', 'a command without a place of its own leaves the focus at the sheet');
    assert.deepEqual(st.calls.filter(c => /^keys /.test(c)).slice(-1), ['keys true'], 'the engine keyboard was not given back after the command');
});

/* The engine and stock model for the focus checks - by code and by measurement in the editor.
   - asc_enableKeyEvents(v) sets the workbook handler and the interface flag (without isFromInput), true - focus to
     its own field if it is not there (sdkjs cell/api.js, text_input2.js setInterfaceEnableKeyEvents);
   - the focus capture on document (text_input2.js InitBrowserInputContext): with the flag on, a foreign
     non-editable node gives focus to the engine field (a click on a panel button leaves focus with the sheet even
     before the command), an input field turns off only the workbook handler (isFromInput);
   - Main.js: modal:show - the keyboard is off, modal:close - on, if there are no windows; focus leaving
     an input field (not into another field and not to a parent's sibling, like the font size chevron; without a window) - on;
   - "Comment" - a card with a field (focus after 25 ms), "Link" and "Data validation" - modal windows with
     a field (focus after 70 ms), search - the search bar (focus after 10 ms). */
const stockFocusModel = () => {
    const area = document.createElement('textarea');
    area.id = 'area_id';
    document.body.appendChild(area);
    window.engine = {iface: true, book: true};
    api.asc_enableKeyEvents = function (v, fromInput) {
        this.calls.push('keys ' + v + (fromInput === true ? ' input' : ''));
        engine.book = !!v;
        if (fromInput === true) return;
        engine.iface = !!v;
        if (v && document.activeElement !== area) area.focus();
    };
    document.addEventListener('focus', e => {
        const t = e.target;
        if (!engine.iface || !t || t.nodeType !== 1 || t === area) return;
        if (/^(INPUT|TEXTAREA)$/.test(t.tagName)) { api.asc_enableKeyEvents(false, true); return; }
        area.focus();
    }, true);
    const MW = Common.Utils.ModalWindow = {n: 0, isVisible() { return this.n > 0; }};
    Common.NotificationCenter.on('modal:show', () => { MW.n++; api.asc_enableKeyEvents(false); });
    Common.NotificationCenter.on('modal:close', () => { MW.n = Math.max(0, MW.n - 1); if (!MW.isVisible()) api.asc_enableKeyEvents(true); });
    const field = el => !!el && el !== area && /^(INPUT|TEXTAREA)$/.test(el.tagName);
    const blurDelegate = e => {
        const t = e.target, r = e.relatedTarget;
        if (!field(t) || MW.isVisible() || field(r) || (r && t.parentNode && t.parentNode.contains(r))) return;
        api.asc_enableKeyEvents(true);
    };
    /* Where the delegate hangs. By default - the blur capture on document (before everyone). window.STOCK_BLUR_FOCUSOUT -
       as in the stock in practice: $(document.body).on('blur', 'input, textarea', …) jQuery 4 attaches as a delegate to
       focusout on body (vendor/jquery: special.blur.delegateType), that is, on bubbling, after blur. */
    if (window.STOCK_BLUR_FOCUSOUT) document.body.addEventListener('focusout', blurDelegate);
    else document.addEventListener('blur', blurDelegate, true);
    const pane = (id, tag) => {
        const p = document.createElement('div');
        p.id = id;
        p.style.display = 'none';
        const f = document.createElement(tag);
        p.appendChild(f);
        document.body.appendChild(p);
        return {p, f};
    };
    const ui = window.stockUi = {comment: pane('stock-comment', 'textarea'), link: pane('stock-link', 'input'),
        validate: pane('stock-validate', 'input'), search: pane('stock-search', 'input')};
    const open = (k, ms, modal) => {
        if (modal) Common.NotificationCenter.trigger('modal:show');
        ui[k].p.style.display = '';
        ui[k].modal = modal;
        setTimeout(() => ui[k].f.focus(), ms);
    };
    twins.comment.on('click', () => open('comment', 25, false));
    twins.btnInsertHyperlink.on('click', () => open('link', 70, true));
    twins.validation.on('click', () => open('validate', 70, true));
    Common.NotificationCenter.on('search:show', () => open('search', 10, false));
    /* Cleanup: cards and windows are closed, as in the stock (a window - modal:close), fields are empty, focus is with the sheet. */
    ui.reset = () => {
        ['comment', 'link', 'validate', 'search'].forEach(k => {
            const x = ui[k];
            x.f.value = '';
            if (x.p.style.display === 'none') return;
            if (document.activeElement === x.f) x.f.blur();
            x.p.style.display = 'none';
            if (x.modal) { x.modal = false; Common.NotificationCenter.trigger('modal:close'); }
        });
        const s = SSE.Views.CompactShell;
        s.closeSurfaces();
        if (s.keysHeld) s.leaveToSheet();
        area.value = '';
        area.focus();
    };
};

/* A panel control started from the keyboard (F10 → Tab → arrows → Enter or space) puts
   focus in the same place as a mouse click. Before, the command went while the shell held the engine keyboard; the stock
   put focus into its field or window, and focus leaving #toolbar (onOut) turned the keyboard on - the engine
   took focus for itself (#area_id), a letter started a cell edit behind the window. The verdict is a comparison with the mouse: where
   focus is, where the letter went, the engine flags. The same for a control in "⋯" and a command without its own place (focus with the sheet,
   as with the mouse); a stock window that opened by itself while the shell holds the keyboard does not lose focus. */
test('toolbar_command_focus_like_mouse', async () => {
    const before = stockFocusModel;
    const wait = ms => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
    const snap = () => page.evaluate(() => {
        const a = document.activeElement, own = a && a.closest ? a.closest('[id^="stock-"]') : null;
        return {zone: !a || a === document.body ? 'body' : own ? own.id.slice(6) : a.id === 'area_id' ? 'sheet' : a.closest('#toolbar') ? 'toolbar' : 'other',
            iface: engine.iface, book: engine.book, held: SSE.Views.CompactShell.keysHeld};
    });
    const typed = () => page.evaluate(() => {
        const out = {sheet: document.getElementById('area_id').value};
        ['comment', 'link', 'validate', 'search'].forEach(k => { if (stockUi[k].f.value) out[k] = stockUi[k].f.value; });
        return out;
    });
    const run = async (k, how, viaMore) => {
        const sel = '#vo-tb button[data-ctrl="' + k + '"]';
        await page.evaluate(() => stockUi.reset());
        await wait(30);
        if (how === 'mouse') {
            if (viaMore) await page.click('#vo-tb .vo-more');
            await page.click(sel);
        } else {
            await press('F10');
            await press('Tab');
            if (viaMore) {
                for (let i = 0; i < 60 && !/vo-more/.test((await FOCUS()).cls); i++) await press('ArrowRight');
                await press('Enter');
            }
            for (let i = 0; i < 60 && (await FOCUS()).ctrl !== k; i++) await press('ArrowRight');
            const f = await FOCUS();
            assert.equal(f.ctrl, k, 'precondition: ' + k + (viaMore ? ' in «⋯»' : '') + ' is reached by arrows: ' + JSON.stringify(f));
            await press(how);
        }
        await wait(150);
        const at = await snap();
        await page.keyboard.type('q');
        await wait(20);
        return Object.assign(at, {typed: await typed()});
    };
    const compare = async (k, place, viaMore, keys = ['Enter', ' ']) => {
        const label = k + (viaMore ? ' in «⋯»' : '');
        const m = await run(k, 'mouse', viaMore);
        assert.equal(m.zone, place, 'precondition (model): ' + label + ' by mouse puts the focus into ' + place + ': ' + JSON.stringify(m));
        for (const key of keys) {
            const r = await run(k, key, viaMore);
            const name = label + ' run from the keyboard (' + (key === ' ' ? 'Space' : key) + ')';
            assert.equal(r.zone, m.zone, name + ': focus is on ' + r.zone + ', not where a mouse click puts it (' + m.zone + '): ' + JSON.stringify(r));
            assert.deepEqual(r.typed, m.typed, name + ': the typed letter went elsewhere than after a mouse click');
            assert.deepEqual({iface: r.iface, book: r.book, held: r.held}, {iface: m.iface, book: m.book, held: m.held},
                name + ': the engine keyboard is not as after a mouse click');
        }
        return m;
    };
    await fresh({options: {canComments: true}}, 2000, true, before);
    for (const [k, place] of [['comment', 'comment'], ['link', 'link'], ['validate', 'validate'], ['search', 'search']]) {
        const m = await compare(k, place, false);
        assert.deepEqual(m.typed, {sheet: '', [place]: 'q'}, 'precondition (model): ' + k + ' by mouse — the letter goes into the field');
    }
    /* A command without its own place - focus is with the sheet, as with the mouse; the letter goes into the sheet. */
    const b = await compare('bold', 'sheet', false, ['Enter']);
    assert.deepEqual(b.typed, {sheet: 'q'}, 'precondition (model): Bold by mouse — the letter goes to the sheet');
    /* The stock window closed - the keyboard and focus are with the sheet again, the letter goes into the cell. */
    await run('link', 'Enter', false);
    await page.evaluate(() => stockUi.reset());
    await wait(30);
    await page.keyboard.type('q');
    const back = Object.assign(await snap(), {typed: await typed()});
    assert.deepEqual(back, {zone: 'sheet', iface: true, book: true, held: false, typed: {sheet: 'q'}},
        'after the stock dialog is closed the keyboard is not back at the sheet');
    /* A stock window opened by itself while the shell holds the keyboard (a standard gallery that cannot be shown -
       its window, StockBridge.dialog): focus leaving #toolbar into the window removes the hold, but does not
       turn the engine keyboard on - the window will return it on modal:close, as with the mouse. */
    await page.evaluate(() => stockUi.reset());
    await wait(30);
    await press('F10');
    assert.equal((await snap()).held, true, 'precondition: F10 holds the keyboard');
    await page.evaluate(() => { Common.NotificationCenter.trigger('modal:show'); stockUi.validate.p.style.display = ''; stockUi.validate.modal = true;
        setTimeout(() => stockUi.validate.f.focus(), 70); });
    await wait(150);
    await page.keyboard.type('q');
    const own = Object.assign(await snap(), {typed: await typed()});
    assert.deepEqual(own, {zone: 'validate', iface: false, book: false, held: false, typed: {sheet: '', validate: 'q'}},
        'a stock window opened while the shell holds the keyboard lost its focus to the sheet');
    /* "⋯": a narrow row, "Link" went into the list. */
    await fresh({options: {canComments: true}}, 1100, true, before);
    const gone = await page.evaluate(() => {
        const n = document.querySelector('#vo-tb [data-ctrl="link"]');
        return !!n && n.classList.contains('vo-collapsed');
    });
    assert.ok(gone, 'precondition: at 1100 px «Link» is in «⋯»');
    await compare('link', 'link', true, ['Enter']);
});

/* Measured in the editor: a standard menu left "open" in the stock (a choice in the standard
   gallery at our row opened a stock window - "Insert → Sparkline ▸") hides the opening of a menu row
   section (Menu.Manager.hideAll). The stock then gives the keyboard to the sheet (Main.js: menu:hide →
   asc_enableKeyEvents(true)), the engine takes focus. From the keyboard (F10) a section must open with focus
   on its item, the hold is with the shell; the same when moving to a neighboring section while one is open. */
test('stale_stock_menu_keeps_keyboard_in_menu', async () => {
    await fresh({}, 1440, true, stockFocusModel);
    await page.evaluate(() => {
        Common.NotificationCenter.on('menu:hide', () => { if (!Common.Utils.ModalWindow.isVisible()) api.asc_enableKeyEvents(true); });
        Common.UI.Menu.Manager.hideAll = () => { if (!window.staleMenu) return; window.staleMenu = false; Common.NotificationCenter.trigger('menu:hide'); };
        stockUi.reset();
    });
    const held = () => page.evaluate(() => ({held: SSE.Views.CompactShell.keysHeld, iface: engine.iface, stale: window.staleMenu}));
    await press('F10');
    await press('Home');
    await press('ArrowRight', 3);
    await page.evaluate(() => { window.staleMenu = true; });
    await press('ArrowDown');
    let f = await FOCUS();
    assert.ok(f.inMenu && f.level === '0' && !!f.k, 'opening a section after a stale stock menu lost the focus: ' + JSON.stringify(f));
    assert.deepEqual(await held(), {held: true, iface: false, stale: false}, 'the shell lost its hold of the keyboard to the stale stock menu');
    await page.evaluate(() => { window.staleMenu = true; });
    await press('ArrowRight');
    f = await FOCUS();
    assert.ok(f.inMenu, 'moving to the next section with the menu open after a stale stock menu lost the focus: ' + JSON.stringify(f));
    assert.deepEqual(await held(), {held: true, iface: false, stale: false}, 'the shell lost its hold of the keyboard on the next section');
});

/* F10 in focus mode. The header and the menu row are hidden (display: none);
   before, F10 turned off the engine keyboard, while focus did not land on the hidden "File" and stayed with the sheet:
   letters and arrows went nowhere, Escape took you out of focus mode but did not remove the hold, a click on a cell
   did not either. The entry is the first visible row: in focus mode - the panel stop (the exit chevron is in it too); if the
   panel is not visible either (focus mode in "Viewing") - F10 is not ours, the keyboard is with the sheet. The hold without focus in the shell
   does not remain even when focus was returned to a node that disappeared (focusHeld). */
test('f10_in_focus_mode_keeps_keyboard_alive', async () => {
    await fresh({}, 1440, true, stockFocusModel);
    const wait = ms => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
    const snap = () => page.evaluate(() => {
        const a = document.activeElement;
        return {zone: !a || a === document.body ? 'body' : a.id === 'area_id' ? 'sheet' : a.closest('#vo-tb') ? 'toolbar' :
            a.closest('#vo-shell > .vo-mn') ? 'menu' : a.closest('#toolbar') ? 'shell' : 'other',
            iface: engine.iface, held: SSE.Views.CompactShell.keysHeld, sheet: document.getElementById('area_id').value};
    });
    await page.evaluate(() => SSE.Views.CompactShell.setChrome({focus: true, tbHidden: false}));
    await wait(50);
    const hidden = await page.evaluate(() => { const m = document.querySelector('#vo-shell > .vo-mn'); return !!m && m.getClientRects().length === 0; });
    assert.ok(hidden, 'precondition: in focus mode the menubar is not displayed');
    await page.evaluate(() => stockUi.reset());
    await press('F10');
    let s = await snap();
    assert.deepEqual({zone: s.zone, held: s.held, iface: s.iface}, {zone: 'toolbar', held: true, iface: false},
        'F10 in focus mode: the focus must land on the visible toolbar stop with the keyboard held: ' + JSON.stringify(s));
    const f = await FOCUS();
    assert.ok(f.ring && f.tab === '0', 'F10 in focus mode: not the toolbar Tab stop with a focus ring: ' + JSON.stringify(f));
    await press('ArrowRight');
    assert.equal((await snap()).zone, 'toolbar', 'arrows after F10 in focus mode do not move along the toolbar');
    await press('Escape');
    await wait(30);
    await page.keyboard.type('q');
    s = await snap();
    assert.deepEqual(s, {zone: 'sheet', iface: true, held: false, sheet: 'q'}, 'Escape after F10 in focus mode: the keyboard is not back at the sheet');
    assert.ok(await page.evaluate(() => document.body.classList.contains('vo-focus')), 'Escape with the focus in the shell is one action: focus mode stays');
    /* Neither the menu row nor the panel is visible (focus mode in "Viewing": vo-view hides the panel) - F10 is not ours. */
    await page.evaluate(() => { stockUi.reset(); document.body.classList.add('vo-view'); });
    await clear();
    await press('F10');
    await page.keyboard.type('w');
    s = await snap();
    const calls = (await state()).calls.filter(c => /^keys /.test(c));
    await page.evaluate(() => { document.body.classList.remove('vo-view'); SSE.Views.CompactShell.setChrome({focus: false, tbHidden: false}); });
    assert.deepEqual(s, {zone: 'sheet', iface: true, held: false, sheet: 'w'}, 'F10 with no visible shell row took the keyboard: ' + JSON.stringify(s));
    assert.deepEqual(calls, [], 'F10 with no visible shell row switched the engine keyboard');
    /* Focus is returned to a node that disappeared, and the stock took it to the sheet: the hold is removed. */
    await page.evaluate(() => stockUi.reset());
    await press('F10');
    assert.equal((await snap()).held, true, 'precondition: F10 holds the keyboard');
    await page.evaluate(() => {
        const sh = SSE.Views.CompactShell, b = document.querySelectorAll('#vo-shell .vo-mn-item[data-k]')[1];
        b.style.display = 'none';
        sh.focusHeld(b);
        document.getElementById('area_id').focus();
    });
    await wait(150);
    s = await snap();
    await page.evaluate(() => { document.querySelectorAll('#vo-shell .vo-mn-item[data-k]')[1].style.display = ''; });
    assert.deepEqual({zone: s.zone, iface: s.iface, held: s.held}, {zone: 'sheet', iface: true, held: false},
        'the hold stays with the focus outside the shell after its node vanished: ' + JSON.stringify(s));
});

/* F10 in a text field. Before, focus left the field for the menu stop,
   the standard blur delegate on input and textarea (controller/Main.js) saw a leave not into a field and turned the engine keyboard on
   - it knows nothing about the shell hold - and the engine at once took focus to the sheet; enterMenu saw focus not on the stop
   and removed the hold: F10 opened nothing, the next letter started a cell edit. So from the stock fields (the search
   bar, a comment, chat, the cell name) and from our own - font size and color code, even when they were entered from the keyboard
   (F10 → Tab → →). A leave from #area_id is skipped by the delegate, so from the sheet the entry worked. The same class - any move
   of focus from a field into the shell under the hold: Shift+Tab from the font size to the menu row, ↑ and ↓ from the color code field
   - focus went to the sheet. Now F10 from a field enters as from the sheet (the menu row stop, the ring,
   the hold, the engine keyboard off, a letter goes neither to the sheet nor to the field), Escape - to the sheet; moves from a field into the shell
   stay in the shell. An entry that failed (the stop did not take focus) - all as without F10: focus is in the field again, the letter goes into the
   field. The sheet focus deferred by the stock (a typed font size is applied on blur, the stock sends edit:complete) is replayed by the entry;
   a human move is not: F10 and at once Tab out of the shell lead to the sheet. The delegate is in both places: the blur capture on document and, as in the
   stock in practice, focusout on body. */
test('f10_from_a_field_enters_the_menu', async () => {
    const wait = ms => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
    const snap = () => page.evaluate(() => {
        const a = document.activeElement, own = a && a.closest ? a.closest('[id^="stock-"]') : null;
        return {zone: !a || a === document.body ? 'body' : a.id === 'area_id' ? 'sheet' : a.closest('#vo-shell > .vo-mn') ? 'menu' :
            a.closest('#vo-tb') ? 'toolbar' : own ? own.id.slice(6) : 'other',
            tag: a && a.tagName, iface: engine.iface, book: engine.book, held: SSE.Views.CompactShell.keysHeld,
            sheet: document.getElementById('area_id').value};
    });
    const fieldValue = sel => page.evaluate(sel => document.querySelector(sel).value, sel);
    /* After F10 - the menu row stop; a letter goes neither to the sheet nor to the field; Escape - to the sheet, the letter goes into the cell. */
    const entered = async (label, sel, value) => {
        await press('F10');
        await wait(120);
        const s = await snap();
        assert.deepEqual({zone: s.zone, held: s.held, iface: s.iface}, {zone: 'menu', held: true, iface: false},
            label + ': F10 in the field did not move the keyboard to the menubar stop: ' + JSON.stringify(s));
        const f = await FOCUS();
        assert.ok(f.ring && f.tab === '0' && f.inMenu, label + ': F10 in the field: not the menubar Tab stop with a focus ring: ' + JSON.stringify(f));
        await page.keyboard.type('q');
        await wait(20);
        assert.deepEqual({sheet: (await snap()).sheet, field: await fieldValue(sel)}, {sheet: '', field: value},
            label + ': after F10 in the field the typed letter went into the sheet or the field');
        await press('Escape');
        await wait(30);
        await page.keyboard.type('w');
        const b = await snap();
        assert.deepEqual({zone: b.zone, iface: b.iface, held: b.held, sheet: b.sheet}, {zone: 'sheet', iface: true, held: false, sheet: 'w'},
            label + ': Escape after F10 from the field: the keyboard is not back at the sheet');
    };
    /* Into the font size and the color code field - only from the keyboard: F10 → Tab → → (for the color ↓ into the palette, End - "Custom color", Enter). */
    const toSize = async () => {
        await page.evaluate(() => stockUi.reset());
        await wait(30);
        await press('F10');
        await press('Tab');
        for (let i = 0; i < 60; i++) { const f = await FOCUS(); if (f.ctrl === 'size' && f.tag === 'INPUT') break; await press('ArrowRight'); }
        const f = await FOCUS(), s = await snap();
        assert.ok(f.ctrl === 'size' && f.tag === 'INPUT' && s.held && !s.iface, 'precondition: the font size field is reached from the keyboard: ' + JSON.stringify([f, s]));
        return page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="size"] input').value);
    };
    const toCode = async () => {
        await page.evaluate(() => stockUi.reset());
        await wait(30);
        await press('F10');
        await press('Tab');
        for (let i = 0; i < 60 && (await FOCUS()).ctrl !== 'textColor'; i++) await press('ArrowRight');
        await press('ArrowDown');
        await press('End');
        await press('Enter');
        const f = await FOCUS(), s = await snap();
        assert.ok(f.ctrl === 'textColor' && f.tag === 'INPUT' && s.held && !s.iface, 'precondition: the color code field is reached from the keyboard: ' + JSON.stringify([f, s]));
        return page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="textColor"] .vo-pal-input').value);
    };
    for (const where of ['blur', 'focusout']) {
        const model = where === 'focusout' ? 'window.STOCK_BLUR_FOCUSOUT = true; (' + stockFocusModel + ')();' : stockFocusModel;
        await fresh({options: {canComments: true}}, 2000, true, model);
        /* F10 from the sheet and at once Tab out of the shell (faster than KEEP_FOCUS_MS): to the sheet, and the sheet holds the keyboard (returning focus
           to "File" is only against the stock deferred sheet focus, not against a human move). Tab - exactly as many times as the shell
           has stops after the entry (measured the same way, without haste): an extra Tab would be pressed on the bare textarea of
           the model, and where it leads would depend on the tick (focus sometimes in the shell, sometimes on body). */
        await page.evaluate(() => stockUi.reset());
        await wait(30);
        await press('F10');
        let tabs = 0;
        for (; tabs < 6; ) {
            await press('Tab');
            tabs++;
            await wait(100);
            if (!(await page.evaluate(() => { const a = document.activeElement; return !!a && !!a.closest('#toolbar'); }))) break;
        }
        assert.ok(tabs >= 2 && tabs < 6, 'precondition: Tab leaves the shell after its stops: ' + tabs);
        await page.evaluate(() => stockUi.reset());
        await wait(30);
        await press('F10');
        await press('Tab', tabs);
        await wait(150);
        let s = await snap();
        assert.deepEqual({zone: s.zone, held: s.held, iface: s.iface}, {zone: 'sheet', held: false, iface: true},
            'F10 and a quick Tab out of the shell (' + tabs + ' stops, delegate on ' + where + '): the sheet did not get the keyboard back: ' + JSON.stringify(s));
        await page.keyboard.type('q');
        assert.equal((await snap()).sheet, 'q', 'F10 and a quick Tab out of the shell (delegate on ' + where + '): the typed letter did not go to the sheet');
        await page.evaluate(() => {
            const p = document.createElement('div');
            p.id = 'stock-namebox';
            p.appendChild(document.createElement('input'));
            document.body.appendChild(p);
        });
        /* The stock fields - focus into the field with the mouse, as a human does. */
        for (const [k, sel] of [['search', '#stock-search input'], ['comment', '#stock-comment textarea'], ['namebox', '#stock-namebox input']]) {
            const label = k + ' (delegate on ' + where + ')';
            await page.evaluate(() => stockUi.reset());
            await wait(30);
        await wait(30);
            await page.evaluate(k => { if (stockUi[k]) stockUi[k].p.style.display = ''; }, k);
            await page.click(sel);
            const s0 = await snap();
            assert.deepEqual({zone: s0.zone, held: s0.held, iface: s0.iface}, {zone: k, held: false, iface: true}, 'precondition: ' + label + ' — the focus is in the field');
            await entered(label, sel, '');
        }
        /* Our own fields entered from the keyboard. */
        let v = await toSize();
        await entered('font size (delegate on ' + where + ')', '#vo-tb [data-ctrl="size"] input', v);
        v = await toCode();
        await entered('color code (delegate on ' + where + ')', '#vo-tb [data-ctrl="textColor"] .vo-pal-input', v);
        /* A typed font size without Enter: leaving the field applies it (blur), after applying the stock sends edit:complete -
           Main.onEditComplete → DocumentHolder.focus (_.defer) gives focus to the sheet after the entry. The entry holds. */
        await page.evaluate(() => {
            if (window.__docHolder) return;
            window.__docHolder = true;
            Common.NotificationCenter.on('edit:complete', () => _.defer(() => document.getElementById('area_id').focus(), 50));
        });
        await toSize();
        await page.fill('#vo-tb [data-ctrl="size"] input', '12');
        await clear();
        await entered('typed font size (delegate on ' + where + ')', '#vo-tb [data-ctrl="size"] input', '12');
        assert.ok((await state()).calls.indexOf('asc_setCellFontSize 12') >= 0, 'precondition: leaving the font size field applied the typed size');
        /* The same class: a move from a field into the shell under the hold. */
        await toSize();
        await press('Shift+Tab');
        await wait(120);
        s = await snap();
        assert.deepEqual({zone: s.zone, held: s.held, iface: s.iface}, {zone: 'menu', held: true, iface: false},
            'Shift+Tab from the font size field (delegate on ' + where + ') lost the focus: ' + JSON.stringify(s));
        for (const key of ['ArrowUp', 'ArrowDown']) {
            await toCode();
            await press(key);
            await wait(120);
            s = await snap();
            const f = await FOCUS();
            assert.deepEqual({zone: s.zone, held: s.held, iface: s.iface, ctrl: f.ctrl}, {zone: 'toolbar', held: true, iface: false, ctrl: 'textColor'},
                key + ' from the color code field (delegate on ' + where + ') did not move to the next palette node: ' + JSON.stringify([s, f]));
            assert.ok(f.tag === 'BUTTON', key + ' from the color code field: not a palette node: ' + JSON.stringify(f));
        }
        /* The entry failed - the key is not ours: focus is in the field again, the letter goes into the field, no hold. */
        await page.evaluate(() => stockUi.reset());
        await wait(30);
        await page.evaluate(() => { stockUi.search.p.style.display = ''; });
        await page.click('#stock-search input');
        /* The entry stop is the menu row; it puts focus on its own Tab stop (a section button). */
        await page.evaluate(() => { const b = SSE.Views.CompactShell.entryStop().querySelector('.vo-mn-item[tabindex="0"]'); window.__stop = b; b.focus = function () {}; });
        await press('F10');
        await wait(120);
        await page.keyboard.type('q');
        s = await snap();
        const typed = await fieldValue('#stock-search input');
        await page.evaluate(() => { delete window.__stop.focus; });
        assert.deepEqual({zone: s.zone, held: s.held, iface: s.iface, sheet: s.sheet, field: typed}, {zone: 'search', held: false, iface: true, sheet: '', field: 'q'},
            'a failed F10 entry from a field (delegate on ' + where + ') is not as without F10: ' + JSON.stringify(s));
    }
});

/* A value typed in a field and applied on leaving the field does not take focus to the sheet
   when the move goes into the shell. The font size was entered from the keyboard (F10 → Tab → →), a size was typed without Enter and a key was used to leave: Shift+Tab
   (to the menu row), → at the right edge (to "Bold"), ← at the left edge (to the font list). The font size is applied on blur, after applying the stock sends
   edit:complete - a deferred focus to the sheet (Main.onEditComplete → DocumentHolder.focus, _.defer). Before, only the F10 entry replayed it,
   while a key move ended at the sheet: the hold was removed, the next letter started a cell edit. Now - as without typing:
   focus is where the move was going, the hold is with the shell, the engine keyboard is off, a letter goes neither to the sheet nor to the field; the size is applied.
   Controls: the same keys without typing (the hold, focus in the same place); Tab from the font size (the last row - to the sheet) and Enter in the font size (a command
   without its own place - to the sheet, like the mouse) with typing - the sheet: the return is not against a human move. The color code field applies the code
   only on Enter - leaving with ↑ with a typed code does not set the color and does not lose the hold. The blur delegate is in both places. */
test('field_commit_move_stays_in_shell', async () => {
    const wait = ms => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
    const SIZE = '#vo-tb [data-ctrl="size"] input';
    const snap = () => page.evaluate(sel => {
        const a = document.activeElement;
        return {zone: !a || a === document.body ? 'body' : a.id === 'area_id' ? 'sheet' : a.closest('#vo-shell > .vo-mn') ? 'menu' :
            a.closest('#vo-tb') ? 'toolbar' : a.closest('#toolbar') ? 'shell' : 'other',
            node: !a ? null : a.tagName + (a.getAttribute('aria-label') ? ':' + a.getAttribute('aria-label') : ''),
            iface: engine.iface, book: engine.book, held: SSE.Views.CompactShell.keysHeld,
            sheet: document.getElementById('area_id').value, field: document.querySelector(sel).value};
    }, SIZE);
    const label = sel => page.evaluate(sel => document.querySelector(sel).getAttribute('aria-label'), sel);
    const toSize = async () => {
        await page.evaluate(() => stockUi.reset());
        await wait(30);
        await press('F10');
        await press('Tab');
        for (let i = 0; i < 60; i++) { const f = await FOCUS(); if (f.ctrl === 'size' && f.tag === 'INPUT') break; await press('ArrowRight'); }
        const f = await FOCUS(), s = await snap();
        assert.ok(f.ctrl === 'size' && f.tag === 'INPUT' && s.held && !s.iface, 'precondition: the font size field is reached from the keyboard: ' + JSON.stringify([f, s]));
    };
    /* Type a size different from the current one (otherwise there is nothing to apply): 14, and if it is already 14 - 12. */
    const typeSize = async () => {
        const v = (await page.evaluate(sel => document.querySelector(sel).value, SIZE)) === '14' ? '12' : '14';
        await press('End');
        await press('Backspace', 4);
        await page.keyboard.type(v);
        return v;
    };
    for (const where of ['blur', 'focusout']) {
        const model = (where === 'focusout' ? 'window.STOCK_BLUR_FOCUSOUT = true; ' : '') + '(' + stockFocusModel + ')(); ' +
            /* The stock DocumentHolder.focus: after edit:complete - focus to the sheet deferred (_.defer). */
            'Common.NotificationCenter.on("edit:complete", () => _.defer(() => document.getElementById("area_id").focus(), 50));';
        await fresh({options: {canComments: true}}, 2000, true, model);
        /* The font size field neighbors: on the left - the font list, on the right - "Bold" (the font size has no "−" and "+"). */
        const left = '#vo-tb [data-ctrl="font"] > button', right = btnOf('bold');
        const moves = [
            ['Shift+Tab', async () => { await press('Shift+Tab'); }, {zone: 'menu', node: 'BUTTON'}],
            ['ArrowRight at the right edge', async () => { await press('End'); await press('ArrowRight'); }, {zone: 'toolbar', node: 'BUTTON:' + await label(right)}],
            ['ArrowLeft at the left edge', async () => { await press('Home'); await press('ArrowLeft'); }, {zone: 'toolbar', node: 'BUTTON:' + await label(left)}]];
        for (const [name, go, to] of moves) {
            for (const typed of [false, true]) {
                const what = name + (typed ? ' after a typed size' : ' without typing') + ' (delegate on ' + where + ')';
                await toSize();
                const v = typed ? await typeSize() : null;
                await clear();
                await go();
                await wait(150);
                const s = await snap();
                assert.deepEqual({zone: s.zone, node: to.zone === 'menu' ? s.node.split(':')[0] : s.node, held: s.held, iface: s.iface, book: s.book},
                    {zone: to.zone, node: to.node, held: true, iface: false, book: false},
                    what + ': the focus left the shell or the shell lost the keyboard: ' + JSON.stringify(s));
                const calls = (await state()).calls, applied = calls.filter(c => /^asc_setCellFontSize /.test(c));
                assert.deepEqual(applied, typed ? ['asc_setCellFontSize ' + v] : [],
                    what + ': ' + (typed ? 'leaving the field did not apply the typed size' : 'a size was applied without typing') + ': ' + JSON.stringify(calls));
                const before = await snap();
                await page.keyboard.type('q');
                await wait(20);
                const q = await snap();
                assert.deepEqual({sheet: q.sheet, field: q.field, zone: q.zone, held: q.held}, {sheet: '', field: before.field, zone: to.zone, held: true},
                    what + ': the typed letter went into the sheet or the field: ' + JSON.stringify(q));
                await press('Escape');
                await wait(30);
                await page.keyboard.type('w');
                const b = await snap();
                assert.deepEqual({zone: b.zone, held: b.held, iface: b.iface, sheet: b.sheet}, {zone: 'sheet', held: false, iface: true, sheet: 'w'},
                    what + ': Escape after the move: the keyboard is not back at the sheet');
            }
        }
        /* A move without typing and at once Tab out of the shell (faster than KEEP_FOCUS_MS) - to the sheet: returning focus is only against the
           stock deferred sheet focus, not against a human move. Tab - by the number of stops from the menu row (measured). */
        await page.evaluate(() => stockUi.reset());
        await wait(30);
        await press('F10');
        let tabs = 0;
        for (; tabs < 6; ) {
            await press('Tab');
            tabs++;
            await wait(100);
            if (!(await page.evaluate(() => { const a = document.activeElement; return !!a && !!a.closest('#toolbar'); }))) break;
        }
        assert.ok(tabs >= 2 && tabs < 6, 'precondition: Tab leaves the shell after its stops: ' + tabs);
        await toSize();
        await press('Shift+Tab');
        await press('Tab', tabs);
        await wait(150);
        const qt = await snap();
        assert.deepEqual({zone: qt.zone, held: qt.held, iface: qt.iface}, {zone: 'sheet', held: false, iface: true},
            'Shift+Tab from the font size field and a quick Tab out of the shell (delegate on ' + where + '): the sheet did not get the keyboard back: ' + JSON.stringify(qt));
        /* Moves from the font size to the sheet - the sheet, as before: Tab (the last row) and Enter (a command without its own place, like the mouse). */
        for (const [name, key] of [['Tab', 'Tab'], ['Enter', 'Enter']]) {
            await toSize();
            const v = await typeSize();
            await clear();
            await press(key);
            await wait(150);
            const s = await snap();
            assert.deepEqual({zone: s.zone, held: s.held, iface: s.iface}, {zone: 'sheet', held: false, iface: true},
                name + ' from the font size field after a typed size (delegate on ' + where + '): the sheet did not get the keyboard: ' + JSON.stringify(s));
            assert.ok((await state()).calls.indexOf('asc_setCellFontSize ' + v) >= 0, 'precondition: ' + name + ' applied the typed size');
        }
        /* The color code field: the code is applied only on Enter - ↑ with a typed code does not set the color, the hold is with the shell. */
        await page.evaluate(() => stockUi.reset());
        await wait(30);
        await press('F10');
        await press('Tab');
        for (let i = 0; i < 60 && (await FOCUS()).ctrl !== 'textColor'; i++) await press('ArrowRight');
        await press('ArrowDown');
        await press('End');
        await press('Enter');
        let f = await FOCUS();
        assert.ok(f.ctrl === 'textColor' && f.tag === 'INPUT', 'precondition: the color code field is reached from the keyboard: ' + JSON.stringify(f));
        await page.keyboard.type('#ff0000');
        await clear();
        await press('ArrowUp');
        await wait(150);
        const s = await snap();
        f = await FOCUS();
        assert.deepEqual({zone: s.zone, held: s.held, iface: s.iface, ctrl: f.ctrl, tag: f.tag}, {zone: 'toolbar', held: true, iface: false, ctrl: 'textColor', tag: 'BUTTON'},
            'ArrowUp from the color code field with a typed code (delegate on ' + where + ') lost the focus: ' + JSON.stringify([s, f]));
        assert.ok((await state()).notes.indexOf('edit:complete') < 0, 'leaving the color code field without Enter applied the color (edit:complete)');
        /* A stock field that applies a value on change (the stock ComboBox): Chrome sends change to the leaving modified field
           before blur, and focus has already been taken off the field by then. F10 from such a field with a typed value - the entry holds,
           although the stock deferred the focus to the sheet after applying. */
        await page.evaluate(() => {
            stockUi.reset();
            stockUi.search.p.style.display = '';
            stockUi.search.f.addEventListener('change', () => Common.NotificationCenter.trigger('edit:complete'));
        });
        await page.click('#stock-search input');
        await page.keyboard.type('abc');
        await clear();
        await press('F10');
        await wait(150);
        const c = await snap();
        assert.ok((await state()).notes.indexOf('edit:complete') >= 0, 'precondition: leaving the stock field applied it on change');
        assert.deepEqual({zone: c.zone, held: c.held, iface: c.iface}, {zone: 'menu', held: true, iface: false},
            'F10 from a stock field that applies its value on change (delegate on ' + where + '): the entry lost the focus: ' + JSON.stringify(c));
    }
});

/* A standard gallery at our row opened from the keyboard (→, Enter or
   space) receives focus - where the stock itself puts it when entering its own submenu (Bootstrap.js,
   patchDropDownKeyDown): a DataView - to itself, a gallery list - the first available item. Before, focus stayed
   on our row, and → / ↓ walked over our list under the open gallery: the border style and color, SmartArt,
   an equation could not be chosen from the keyboard. ← on a gallery list item - back to our row (the stock for a nested
   gallery would remove over and put focus on the holder item in the hidden ribbon - the menu was lost entirely). With the mouse
   we do not touch focus. The stock is modeled on Common.UI.Menu and the Bootstrap delegate: a gallery menu in the hidden
   ribbon (ul[role=menu], the btn-group or li.dropdown-submenu holder), the show is the real StockBridge.popup
   (the stock jQuery), arrows over the list items - a delegate on document, as in the stock; a DataView walks itself. */
const galleryFakes = () => {
    const ribbon = document.querySelector('#toolbar > section.toolbar');
    /* The stock DataView with arrows in both directions (common/main/lib/component/DataView.js, onKeyDown,
       keyMoveDirection 'both'; DataViewSimple is the same): a 3 × 2 grid, the selected swatch is class selected, focus is
       on the swatch. ← without a selected swatch or at the left column inside .dropdown-submenu.over - remove over and
       focus to the submenu '> a' (the holder item); outside such a submenu - in a circle; → and ↑/↓ - in a circle. The layout is
       real (three swatches per row): the shell judges the left column by it, like the stock (fillIndexesArray). */
    const GRID_HTML = '<div class="dataview inner canfocused" tabindex="0" style="width: 100px; font-size: 0;">' +
        '<div class="item" tabindex="-1" style="display: inline-block; width: 30px; height: 30px; margin: 0 2px 2px 0;"></div>'.repeat(6) + '</div>';
    const gridView = dv => dv.addEventListener('keydown', e => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
        e.preventDefault();
        e.stopPropagation();
        const cols = 3, items = [...dv.querySelectorAll('.item')], rows = Math.ceil(items.length / cols);
        const sel = items.findIndex(n => n.classList.contains('selected'));
        const toHolder = () => {
            const sub = e.target.closest('.dropdown-submenu.over');
            if (!sub) return false;
            sub.classList.remove('over');
            sub.querySelector(':scope > a').focus();
            return true;
        };
        let idx;
        if (sel < 0) {
            if (e.key === 'ArrowLeft' && toHolder()) return;
            idx = 0;
        } else {
            let r = Math.floor(sel / cols), c = sel % cols;
            if (e.key === 'ArrowLeft') { if (--c < 0) { if (toHolder()) return; c = cols - 1; } }
            else if (e.key === 'ArrowRight') c = (c + 1) % cols;
            else if (e.key === 'ArrowUp') r = (r - 1 + rows) % rows;
            else r = (r + 1) % rows;
            idx = r * cols + c;
        }
        items.forEach((n, i) => n.classList.toggle('selected', i === idx));
        items[idx].focus();
    });
    const block = (kind, o = {}) => {
        const host = document.createElement(o.nested ? 'li' : 'div');
        host.className = o.nested ? 'dropdown-submenu' : 'btn-group';
        if (o.nested) { const a = document.createElement('a'); a.setAttribute('tabindex', '-1'); a.textContent = o.caption; host.appendChild(a); }
        const ul = document.createElement('ul');
        ul.className = 'dropdown-menu';
        ul.setAttribute('role', 'menu');
        ul.style.cssText = 'position: fixed; display: none; width: 180px; background: #fff;';
        const li = (html, cls) => { const n = document.createElement('li'); if (cls) n.className = cls; n.innerHTML = html; ul.appendChild(n); return n; };
        if (kind === 'list') {
            li('<a tabindex="-1">Off</a>', 'disabled');
            ['One', 'Two', 'Three'].forEach(t => li('<a tabindex="-1">' + t + '</a>'));
            li('', 'divider');
            li('<a tabindex="-1">Four</a>');
        } else if (kind === 'palette') {
            li('<a tabindex="-1">Auto</a>');
            li('', 'divider');
            li('<div class="theme-colorpalette canfocused" tabindex="0">' + '<a class="color"></a>'.repeat(6) + '</div>');
            li('', 'divider');
            li('<a tabindex="-1">More colors</a>');
        } else if (kind === 'grid') {
            gridView(li(GRID_HTML).querySelector('.dataview'));
        } else if (kind === 'sections') {
            /* Like SmartArt: section items, a section has its own stock submenu with a DataView inside the gallery itself; the section
               "Process" is a submenu list (like the "Equations" groups): ← in it closes the submenu by the stock delegate. */
            li('<a tabindex="-1">Basic</a>');
            const sec = li('<a tabindex="-1">Cycle</a><ul class="dropdown-menu" role="menu" style="position: static; width: 120px;">' +
                '<li>' + GRID_HTML + '</li></ul>', 'dropdown-submenu vo-test-sub');
            gridView(sec.querySelector('.dataview'));
            li('<a tabindex="-1">Process</a><ul class="dropdown-menu" role="menu" style="position: static; width: 120px;">' +
                '<li><a tabindex="-1">P1</a></li><li><a tabindex="-1">P2</a></li></ul>', 'dropdown-submenu vo-test-sub');
        } else {
            const n = li('<div><div class="dataview inner canfocused" tabindex="0">' + '<div class="item" tabindex="-1">x</div>'.repeat(4) + '</div></div>');
            const dv = n.querySelector('.dataview');
            /* The stock DataView walks the swatches itself (attachKeyEvents - keydown on its own node). */
            dv.addEventListener('keydown', e => {
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowRight') return;
                const items = [...dv.querySelectorAll('.item')], i = items.indexOf(document.activeElement);
                items[(i + 1) % items.length].focus();
                e.preventDefault();
                e.stopPropagation();
            });
        }
        host.appendChild(ul);
        (o.parent || ribbon).appendChild(host);
        const m = events({items: [{caption: '', options: {}, hidden: false, visible: true, rendered: true}], rendered: true,
            menuRoot: jQuery(ul), parentEl: jQuery(host), options: {}, offset: [0, 0],
            alignPosition() {
                const a = this.menuAlignEl && this.menuAlignEl[0];
                if (!a) return;
                const r = a.getBoundingClientRect(), off = this.offset || [0, 0];
                ul.style.left = Math.round(r.right + off[0]) + 'px';
                ul.style.top = Math.round(r.top + off[1]) + 'px';
            },
            show() { host.classList.add('open'); this.trigger('show:after', this); },
            hide() { host.classList.remove('open', 'over'); }});
        /* A DataView with parentMenu puts focus on itself on show:after (_.delay 10) - for "Chart". */
        if (o.selfFocus) m.on('show:after', () => setTimeout(() => ul.querySelector('.dataview').focus(), 10));
        return {m, ul, host};
    };
    /* The stock Bootstrap delegate: ↑/↓ - over the available list items; ← in a nested menu - remove over and
       focus to the holder item (in the hidden ribbon). */
    document.addEventListener('keydown', e => {
        const t = e.target, ul = t && t.closest ? t.closest('#toolbar > section.toolbar ul[role=menu]') : null;
        if (!ul || t.tagName !== 'A' || t.parentNode.parentNode !== ul) return;
        const items = [...ul.children].filter(li => !li.classList.contains('divider') && !li.classList.contains('disabled'))
            .map(li => li.firstElementChild).filter(a => a && a.tagName === 'A');
        const i = items.indexOf(t);
        if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
        else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
        else if (e.key === 'ArrowLeft' && ul.parentNode.classList.contains('dropdown-submenu') && ul.parentNode.classList.contains('over')) {
            ul.parentNode.classList.remove('over');
            ul.parentNode.firstElementChild.focus();
        }
        /* → on an item with a submenu (the SmartArt section): the submenu is expanded, focus - its DataView or the first list item. */
        else if (e.key === 'ArrowRight' && t.parentNode.classList.contains('dropdown-submenu')) {
            t.parentNode.classList.add('over');
            (t.parentNode.querySelector('.dataview') || t.parentNode.querySelector(':scope > ul a')).focus();
        }
    });
    const subCss = document.createElement('style');
    subCss.textContent = '.vo-test-sub > ul { display: none; } .vo-test-sub.over > ul { display: block; }';
    document.head.appendChild(subCss);
    const equation = twin('Toolbar:btnInsertEquation'), table = twin('Toolbar:btnTableTemplate'), chart = twin('Toolbar:btnInsertChart'),
        smartArt = twin('Toolbar:btnInsertSmartArt');
    equation.menu = block('list').m;
    table.menu = block('dataview').m;
    chart.menu = block('grid', {selfFocus: true}).m;
    smartArt.menu = block('sections').m;
    const extra = {btnInsertEquation: equation, btnTableTemplate: table, btnInsertChart: chart, btnInsertSmartArt: smartArt};
    const get = SSE.getController;
    SSE.getController = function (name) {
        const c = get.call(this, name);
        if (name === 'Toolbar' && c && c.toolbar) Object.assign(c.toolbar, extra);
        return c;
    };
    /* "Borders": the double menu has the gallery submenus "Border style" (a list) and "Border color" (the "Auto" item, a palette
       without focusOnShow, "More colors"), as in the stock; the holders are li.dropdown-submenu in its menu. */
    const bordersHost = document.createElement('div');
    bordersHost.className = 'btn-group';
    const bordersUl = document.createElement('ul');
    bordersUl.className = 'dropdown-menu';
    bordersUl.setAttribute('role', 'menu');
    bordersHost.appendChild(bordersUl);
    ribbon.appendChild(bordersHost);
    const style = block('list', {nested: true, caption: 'Border style', parent: bordersUl});
    const color = block('palette', {nested: true, caption: 'Border color', parent: bordersUl});
    const bm = twins.btnBorders.menu;
    [item('Border style', {menu: style.m}), item('Border color', {menu: color.m})].forEach(it => {
        it.on('click', (x, e) => bm.trigger('item:click', bm, x, e));
        bm.items.push(it);
    });
    /* "Conditional formatting": the gallery submenu "Data bars" is a DataView in the li.dropdown-submenu of the double menu, as in
       the stock (data bars, color scales, icon sets). */
    const condHost = document.createElement('div');
    condHost.className = 'btn-group';
    const condUl = document.createElement('ul');
    condUl.className = 'dropdown-menu';
    condUl.setAttribute('role', 'menu');
    condHost.appendChild(condUl);
    ribbon.appendChild(condHost);
    const bars = block('grid', {nested: true, caption: 'Data bars', parent: condUl});
    const cm = twins.btnCondFormat.menu, barsItem = item('Data bars', {menu: bars.m});
    barsItem.on('click', (x, e) => cm.trigger('item:click', cm, x, e));
    cm.items.push(barsItem);
    return true;
};

/* A quick key right after leaving the font size with a key with a value typed without Enter. The field on leaving
   applies the font size, the stock sends edit:complete, and Main.onEditComplete calls DocumentHolder.focus - focus to #editor_sdk
   via _.defer (view/DocumentHolder.js). In the editor it arrived after focus had already landed on the move target, and until
   the keepFocus return (KEEP_FOCUS_MS) it stood on #editor_sdk with the engine keyboard off: the next key
   was lost (→ did not move), Tab out of the shell was cancelled by the return (measured: a window of ~45-75 ms). Here the stock is the same model
   (stockFocusModel) and the stock DocumentHolder view with its focus; the second key is 25 ms after the first, inside the window.
   The verdict - the path ends in the same place as without typing: Shift+Tab → "File", → - "Edit"; Shift+Tab, Tab - the font
   size field again (the panel stop); → at the edge to "Bold" (the font size has no "−" and "+"), → - "Italic"; → at the edge, Tab - out of the shell to the sheet, the keyboard is with
   it. The font size is applied in each path. */
const DEFERRED_FOCUS_STOCK = '(' + stockFocusModel + ')(); (' + (() => {
    const sdk = document.createElement('div');
    sdk.id = 'editor_sdk';
    sdk.tabIndex = -1;
    sdk.style.cssText = 'position:fixed;left:0;bottom:0;width:20px;height:20px';
    document.body.appendChild(sdk);
    const view = {focus() { _.defer(() => sdk.focus(), 50); }};
    const getController = SSE.getController;
    SSE.getController = function (name) { return name === 'DocumentHolder' ? {getView: v => (v === 'DocumentHolder' ? view : null)} : getController.call(this, name); };
    /* The stock Main.onEditComplete is subscribed before the shell. */
    Common.NotificationCenter.on('edit:complete', () => SSE.getController('DocumentHolder').getView('DocumentHolder').focus());
}) + ')();';
test('field_move_survives_stock_sheet_focus', async () => {
    await fresh({options: {canComments: true}}, 2000, true, DEFERRED_FOCUS_STOCK);
    const wait = ms => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
    const SIZE = '#vo-tb [data-ctrl="size"] input';
    const snap = () => page.evaluate(() => {
        const a = document.activeElement, c = a && a.closest && a.closest('#vo-tb [data-ctrl]');
        return {zone: !a || a === document.body ? 'body' : a.id === 'area_id' ? 'sheet' : a.id === 'editor_sdk' ? 'sdk' : a.closest('#vo-shell > .vo-mn') ? 'menu' :
            a.closest('#vo-tb') ? 'toolbar' : a.closest('#toolbar') ? 'shell' : 'other',
            text: a && a.closest && a.closest('#vo-shell > .vo-mn') ? a.textContent : null, ctrl: c ? c.getAttribute('data-ctrl') : null,
            node: a ? a.tagName + (a.getAttribute('aria-label') ? ':' + a.getAttribute('aria-label') : '') : null,
            held: SSE.Views.CompactShell.keysHeld, iface: engine.iface};
    });
    const sections = (await SECTIONS()).map(x => x.t);
    const boldLabel = await page.evaluate(sel => document.querySelector(sel).getAttribute('aria-label'), btnOf('bold'));
    const toSize = async () => {
        await page.evaluate(() => stockUi.reset());
        await wait(30);
        await press('F10');
        await press('Home');
        await press('Tab');
        for (let i = 0; i < 60; i++) { const f = await FOCUS(); if (f.ctrl === 'size' && f.tag === 'INPUT') break; await press('ArrowRight'); }
        const f = await FOCUS();
        assert.ok(f.ctrl === 'size' && f.tag === 'INPUT', 'precondition: the font size field is reached from the keyboard: ' + JSON.stringify(f));
    };
    const typeSize = async () => {
        const v = (await page.evaluate(sel => document.querySelector(sel).value, SIZE)) === '14' ? '12' : '14';
        await press('End');
        await press('Backspace', 4);
        await page.keyboard.type(v);
        return v;
    };
    const paths = [
        ['Shift+Tab, then ArrowRight', async () => { await press('Shift+Tab'); }, 'ArrowRight', {zone: 'menu', text: sections[1], ctrl: null, held: true, iface: false}],
        ['Shift+Tab, then Tab', async () => { await press('Shift+Tab'); }, 'Tab', {zone: 'toolbar', text: null, ctrl: 'size', held: true, iface: false}],
        ['ArrowRight at the right edge, then ArrowRight', async () => { await press('End'); await press('ArrowRight'); }, 'ArrowRight',
            {zone: 'toolbar', text: null, ctrl: 'italic', held: true, iface: false}],
        ['ArrowRight at the right edge, then Tab', async () => { await press('End'); await press('ArrowRight'); }, 'Tab',
            {zone: 'sheet', text: null, ctrl: null, held: false, iface: true}]];
    for (const [name, leave, second, want] of paths) {
        for (const typed of [false, true]) {
            const what = name + (typed ? ' after a typed size' : ' without typing');
            await toSize();
            const v = typed ? await typeSize() : null;
            await clear();
            await leave();
            if (name.startsWith('ArrowRight')) {
                const f = await FOCUS();
                assert.equal(f.label, boldLabel, 'precondition: ' + what + ': ArrowRight at the edge moved to «Bold»: ' + JSON.stringify(f));
            }
            await wait(25);
            await press(second);
            await wait(150);
            const s = await snap();
            assert.deepEqual({zone: s.zone, text: s.text, ctrl: s.ctrl, held: s.held, iface: s.iface}, want,
                what + ': the second key did not make its move from the target of the first: ' + JSON.stringify(s));
            const applied = (await state()).calls.filter(c => /^asc_setCellFontSize /.test(c));
            assert.deepEqual(applied, typed ? ['asc_setCellFontSize ' + v] : [], what + ': size applied ' + JSON.stringify(applied));
        }
    }
    /* Outside a move from a field (the hold is with the shell, focus on the menu row) the stock request for sheet focus is executed, as before. */
    await page.evaluate(() => stockUi.reset());
    await wait(30);
    await press('F10');
    await page.evaluate(() => SSE.getController('DocumentHolder').getView('DocumentHolder').focus());
    await wait(30);
    const out = await snap();
    assert.ok(out.zone === 'sdk' || out.zone === 'sheet', 'the stock sheet focus outside a field move was swallowed: ' + JSON.stringify(out));
});


/* A walk over the shell to the standard gallery from the keyboard and what is in focus (shared by the gallery tests). idx is the number
   of the DataView swatch in focus. */
const galleryNav = () => {
    const wait = ms => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
    const where = () => page.evaluate(() => {
        const ul = document.querySelector('.vo-gallery-target'), a = document.activeElement;
        const dv = a && a.closest ? a.closest('.dataview') : null;
        return {open: !!ul && SSE.Views.StockBridge.popupOpen(), inside: !!(ul && a && ul.contains(a)),
            node: !a || a === document.body ? 'body' : a.classList.contains('dataview') ? 'dataview' : a.classList.contains('item') ? 'item' :
                a.classList.contains('theme-colorpalette') ? 'palette' : (a.textContent || '').trim().slice(0, 14),
            idx: dv && a.classList.contains('item') ? [...dv.querySelectorAll('.item')].indexOf(a) : null,
            held: SSE.Views.CompactShell.keysHeld};
    });
    const home = () => page.evaluate(() => { const s = SSE.Views.CompactShell; s.closeSurfaces(); if (s.keysHeld) s.leaveToSheet(); });
    /* F10 → a section by caption → ↓ to item k. */
    const menuTo = async (sectionKey, k) => {
        await home();
        await press('F10');
        await press('Home');
        const title = await page.evaluate(key => SSE.Views.SheetActions[key], sectionKey);
        for (let i = 0; i < 8 && (await FOCUS()).text !== title; i++) await press('ArrowRight');
        await press('ArrowDown');
        for (let i = 0; i < 40 && (await FOCUS()).k !== k; i++) await press('ArrowDown');
        return FOCUS();
    };
    const rowTo = async text => {
        for (let i = 0; i < 12 && (await FOCUS()).text.indexOf(text) !== 0; i++) await press('ArrowDown');
        return FOCUS();
    };
    const enter = async (what, key, node) => {
        await press(key);
        await wait(60);
        const g = await where();
        assert.ok(g.open, what + ': precondition — the stock gallery is shown: ' + JSON.stringify(g));
        assert.ok(g.inside && g.node === node, what + ' (' + key + '): the focus did not move into the stock gallery (' + node + '): ' + JSON.stringify(g));
        assert.equal(g.held, true, what + ': the shell lost its hold of the keyboard');
        return g;
    };
    return {wait, where, home, menuTo, rowTo, enter};
};
/* A gallery list and a gallery with section submenus inside - the mechanics of standard galleries at our row. The "Equation" and SmartArt items
   in "Insert" do not exist, but
   the stock galleries are the same: the mechanics are held by the case items at the end of "Insert" with the same standard buttons. The "Table" of Insert
   was removed as a duplicate - the same gallery (a DataView that the stock does not focus) is at "Format → Format as table". */
const GALLERY_CASE_ITEMS = () => {
    const A = SSE.Views.SheetActions, orig = A.catalog;
    A.catalog = function () {
        const c = orig.call(this);
        c[3].items.push({sep: true}, {k: 'tstEquation', t: 'Equation', twin: 'Toolbar:btnInsertEquation', gallery: true},
            {k: 'tstSmartArt', t: 'SmartArt', twin: 'Toolbar:btnInsertSmartArt', gallery: true});
        return c;
    };
};

test('stock_gallery_entered_from_keyboard', async () => {
    await fresh({}, 2000, true, GALLERY_CASE_ITEMS);
    await page.addScriptTag({path: path.join(ROOT, 'vendor/jquery/jquery.js')});
    assert.equal(await page.evaluate(galleryFakes), true, 'precondition: stock gallery models are built');
    const {wait, where, home, menuTo, rowTo, enter} = galleryNav();
    /* The menu row: the gallery list of the standard "Equation" (a case item); ↓ over its items; ← and Escape - to the row. */
    for (const key of ['ArrowRight', 'Enter', ' ']) {
        let f = await menuTo('textInsert', 'tstEquation');
        assert.equal(f.k, 'tstEquation', 'precondition: Insert → the list gallery row is reached by arrows');
        await enter('Insert → Equation', key, 'One');
        await press('ArrowDown');
        assert.equal((await where()).node, 'Two', 'Insert → Equation: ArrowDown does not move inside the stock gallery');
        await press('ArrowLeft');
        f = await FOCUS();
        const g = await where();
        assert.ok(f.k === 'tstEquation' && !g.open && g.held, 'ArrowLeft in the stock list gallery did not return to our row: ' + JSON.stringify([f.k, g]));
    }
    await menuTo('textInsert', 'tstEquation');
    await enter('Insert → Equation', 'ArrowRight', 'One');
    await press('Escape');
    assert.equal((await FOCUS()).k, 'tstEquation', 'Escape in the stock gallery did not return to our row');
    /* A DataView that the stock does not focus (the table style gallery on first opening - "Format → Format as table"),
       and one that focuses itself. */
    await menuTo('textFormat', 'formatAsTable');
    await enter('Format → Format as table', 'ArrowRight', 'dataview');
    await press('ArrowDown');
    assert.equal((await where()).node, 'item', 'Format → Format as table: arrows do not move inside the DataView');
    await menuTo('textInsert', 'chart');
    await enter('Insert → Chart', 'ArrowRight', 'dataview');
    await wait(40);
    assert.equal((await where()).node, 'dataview', 'Insert → Chart: the focus did not stay in the self-focused DataView');
    /* A menu row submenu: "Format → Borders ▸ → Border style ▸" (a nested gallery). */
    let f = await menuTo('textFormat', 'borders');
    assert.equal(f.k, 'borders', 'precondition: Format → Borders is reached by arrows');
    await press('ArrowRight');
    f = await rowTo('Border style');
    assert.ok(f.level === '1' && f.text.indexOf('Border style') === 0, 'precondition: Format → Borders ▸ Border style is reached: ' + JSON.stringify(f));
    await enter('Format → Borders ▸ Border style', 'ArrowRight', 'One');
    await press('ArrowLeft');
    f = await FOCUS();
    assert.ok(f.level === '1' && f.text.indexOf('Border style') === 0 && !(await where()).open,
        'ArrowLeft in the nested stock gallery did not return to our submenu row: ' + JSON.stringify(f));
    /* A panel list: "Borders ▾ → Border style ▸ / Border color ▸" (the palette - the first item "Auto", as in the stock). */
    for (const [row, node] of [['Border style', 'One'], ['Border color', 'Auto']]) {
        await home();
        await press('F10');
        await press('Tab');
        for (let i = 0; i < 60 && (await FOCUS()).ctrl !== 'borders'; i++) await press('ArrowRight');
        assert.equal((await FOCUS()).ctrl, 'borders', 'precondition: Borders is reached by arrows');
        await press('ArrowDown');
        f = await rowTo(row);
        assert.ok(f.text.indexOf(row) === 0 && /vo-pop-item/.test(f.cls), 'precondition: the list row ' + row + ' is reached: ' + JSON.stringify(f));
        await enter('toolbar Borders ▸ ' + row, 'ArrowRight', node);
        await press('ArrowLeft');
        f = await FOCUS();
        const open = await page.evaluate(() => !!document.querySelector('#vo-tb [data-ctrl="borders"].open'));
        assert.ok(f.text.indexOf(row) === 0 && open && !(await where()).open,
            'ArrowLeft in the toolbar stock gallery did not return to our list row: ' + JSON.stringify([f.text, open]));
    }
    /* With the mouse - as before: the gallery is open, we do not move focus. */
    await home();
    await page.click(btnOf('borders'));
    await wait(30);
    await clickRow('borders', 'Border style');
    await wait(60);
    const m = await where();
    assert.ok(m.open && !m.inside && !m.held, 'a mouse click on the gallery row moved the focus into the stock gallery: ' + JSON.stringify(m));
});

/* The DataView of a nested standard gallery - "Data bars", "Color scales",
   "Icon sets" (the submenus of the standard "Conditional formatting" menu) - on ← without a selected swatch or at the left
   column removes over of its submenu and puts focus on its holder item in the hidden ribbon: focus was lost, the stock
   took the removed over for a choice, everything closed - the gallery, our menu or list, - the hold was removed, and the next
   letter started a cell edit. Expected - like Escape and ← in a gallery list: the gallery is closed, focus is on our
   row, our layer is open, the hold is with the shell. Inside the grid ← is a move of the DataView itself; a submenu with a holder inside
   a gallery (the SmartArt section) is closed on ← by the stock itself; a DataView without a nested submenu ("Chart") at the edge goes in a
   circle - the shell does not touch them. */
test('stock_dataview_gallery_left_edge_returns_to_row', async () => {
    await fresh({}, 2000, true, GALLERY_CASE_ITEMS);
    await page.addScriptTag({path: path.join(ROOT, 'vendor/jquery/jquery.js')});
    assert.equal(await page.evaluate(galleryFakes), true, 'precondition: stock gallery models are built');
    const {wait, where, home, menuTo, rowTo, enter} = galleryNav();
    const stay = async (what, idx) => {
        await wait(60);
        const g = await where();
        assert.ok(g.open && g.inside && g.node === 'item' && g.idx === idx && g.held,
            what + ': ArrowLeft inside the DataView is its own move (sample ' + idx + '): ' + JSON.stringify(g));
    };
    /* ← at the edge: the gallery is closed, focus is on the row row of our layer (layerOpen), the hold is with the shell, the engine keyboard
       was not turned on. */
    const back = async (what, row, layerOpen) => {
        await page.evaluate(() => { api.calls.length = 0; });
        await press('ArrowLeft');
        await wait(120);
        const f = await FOCUS(), g = await where(), open = await page.evaluate(layerOpen);
        const calls = await page.evaluate(() => api.calls.filter(c => /^keys /.test(c)));
        assert.ok(f.inShell && f.text.indexOf(row) === 0 && !g.open && g.held && open && calls.indexOf('keys true') < 0,
            what + ': ArrowLeft at the edge of the stock DataView did not return to our row: ' +
            JSON.stringify({focus: [f.text, f.inShell], gallery: g.open, held: g.held, layerOpen: open, calls}));
    };
    /* A menu row: "Format → Conditional formatting ▸ Data bars ▸". */
    const flyOpen = () => !!document.querySelector('#vo-shell .vo-mn-fly.open');
    const toBars = async () => {
        let f = await menuTo('textFormat', 'conditional');
        assert.equal(f.k, 'conditional', 'precondition: Format → Conditional formatting is reached by arrows');
        await press('ArrowRight');
        f = await rowTo('Data bars');
        assert.ok(f.level === '1' && f.text.indexOf('Data bars') === 0, 'precondition: Conditional formatting ▸ Data bars is reached: ' + JSON.stringify(f));
    };
    await toBars();
    await enter('Format → Conditional formatting ▸ Data bars', 'ArrowRight', 'dataview');
    await back('menu Data bars, ← right after opening (no sample selected)', 'Data bars', flyOpen);
    await enter('menu Data bars, again', 'ArrowRight', 'dataview');
    await press('ArrowDown');
    await stay('menu Data bars ↓', 0);
    await press('ArrowRight');
    await stay('menu Data bars →', 1);
    await press('ArrowLeft');
    await stay('menu Data bars ← from the second column', 0);
    await back('menu Data bars, ← in the left column', 'Data bars', flyOpen);
    /* After the return the row is alive: → leads into the gallery again, Escape - to the row. */
    await enter('menu Data bars, after the return', 'ArrowRight', 'dataview');
    await press('Escape');
    await wait(60);
    assert.ok((await FOCUS()).text.indexOf('Data bars') === 0 && !(await where()).open, 'Escape after the return did not go back to our row');
    /* A panel list: "Conditional formatting ▾ → Data bars ▸"; the second grid row, the left column. The gallery is the same as the
       menu one, and the swatch selected there is remembered by the stock - reset, to start again without a selection. */
    await home();
    await page.evaluate(() => document.querySelectorAll('.dataview .item.selected').forEach(n => n.classList.remove('selected')));
    await press('F10');
    await press('Tab');
    for (let i = 0; i < 60 && (await FOCUS()).ctrl !== 'condfmt'; i++) await press('ArrowRight');
    assert.equal((await FOCUS()).ctrl, 'condfmt', 'precondition: Conditional formatting is reached by arrows on the toolbar');
    await press('ArrowDown');
    let f = await rowTo('Data bars');
    assert.ok(f.text.indexOf('Data bars') === 0 && /vo-pop-item/.test(f.cls), 'precondition: the list row Data bars is reached: ' + JSON.stringify(f));
    const listOpen = () => !!document.querySelector('#vo-tb [data-ctrl="condfmt"].open');
    await enter('toolbar Conditional formatting ▸ Data bars', 'ArrowRight', 'dataview');
    await back('toolbar Data bars, ← right after opening', 'Data bars', listOpen);
    await enter('toolbar Data bars, again', 'ArrowRight', 'dataview');
    await press('ArrowDown');
    await press('ArrowDown');
    await stay('toolbar Data bars ↓ ↓', 3);
    await back('toolbar Data bars, ← in the left column of the second row', 'Data bars', listOpen);
    assert.equal((await FOCUS()).ctrl, 'condfmt', 'toolbar Data bars: the focus is not in the Conditional formatting list');
    /* A holder inside the gallery itself - the SmartArt section (a case item): ← at the edge of its DataView closes the section by the stock itself, focus is
       on the section, the gallery is open; one more ← (a gallery list item) - to our row. */
    f = await menuTo('textInsert', 'tstSmartArt');
    assert.equal(f.k, 'tstSmartArt', 'precondition: Insert → the SmartArt gallery row is reached by arrows');
    await enter('Insert → SmartArt', 'ArrowRight', 'Basic');
    await press('ArrowDown');
    assert.equal((await where()).node, 'Cycle', 'precondition: ArrowDown reaches the SmartArt section');
    await press('ArrowRight');
    await wait(40);
    assert.equal((await where()).node, 'dataview', 'precondition: ArrowRight opens the SmartArt section DataView');
    await press('ArrowLeft');
    await wait(60);
    let g = await where();
    assert.ok(g.open && g.inside && g.node === 'Cycle' && g.held,
        'ArrowLeft at the edge of a section DataView inside the gallery must stay the stock move (back to the section): ' + JSON.stringify(g));
    await press('ArrowLeft');
    await wait(60);
    f = await FOCUS();
    assert.ok(f.k === 'tstSmartArt' && !(await where()).open, 'ArrowLeft on the SmartArt section did not return to our row: ' + JSON.stringify(f));
    /* A DataView without a nested submenu - "Chart": ← at the left column goes in a circle, as in the stock. */
    await menuTo('textInsert', 'chart');
    await enter('Insert → Chart', 'ArrowRight', 'dataview');
    await wait(40);
    await press('ArrowDown');
    await stay('Insert → Chart ↓', 0);
    await press('ArrowLeft');
    await stay('Insert → Chart ← in the left column wraps', 2);
});

/* ← with a modifier at the edge of a standard gallery: the shell handler (galleryKey)
   would exit on any modifier, while the stock does not distinguish modifiers for ← (DataView.onKeyDown - by keyCode, the Bootstrap
   delegate - by keyCode 37: the stock models here also look only at the key) and took focus to the holder item in the
   hidden ribbon. Now Shift+←, Ctrl+←, Alt+← and ⌘+← are the same return to our row as ←: on a gallery
   list item ("Equation", the nested "Border style") and at the edge of the nested gallery DataView ("Data bars"); inside
   the grid ← with a modifier is a move of the DataView itself. */
test('stock_gallery_modified_left_returns_to_row', async () => {
    await fresh({}, 2000, true, GALLERY_CASE_ITEMS);
    await page.addScriptTag({path: path.join(ROOT, 'vendor/jquery/jquery.js')});
    assert.equal(await page.evaluate(galleryFakes), true, 'precondition: stock gallery models are built');
    const {wait, where, menuTo, rowTo, enter} = galleryNav();
    /* A gallery list at a menu row: the standard "Equation" (a case item). */
    for (const mod of ['Shift', 'Control', 'Alt', 'Meta']) {
        const f0 = await menuTo('textInsert', 'tstEquation');
        assert.equal(f0.k, 'tstEquation', 'precondition: Insert → the list gallery row is reached by arrows');
        await enter('Insert → Equation', 'ArrowRight', 'One');
        await press(mod + '+ArrowLeft');
        await wait(60);
        const f = await FOCUS(), g = await where();
        assert.ok(f.k === 'tstEquation' && !g.open && g.held,
            mod + '+ArrowLeft in the stock list gallery did not return to our row: ' + JSON.stringify([f.k, f.text, g]));
    }
    /* A nested gallery list: "Format → Borders ▸ Border style ▸" (the stock took focus to the holder). */
    for (const mod of ['Shift', 'Control']) {
        await menuTo('textFormat', 'borders');
        await press('ArrowRight');
        let f = await rowTo('Border style');
        assert.ok(f.level === '1' && f.text.indexOf('Border style') === 0, 'precondition: Format → Borders ▸ Border style is reached: ' + JSON.stringify(f));
        await enter('Format → Borders ▸ Border style', 'ArrowRight', 'One');
        await press(mod + '+ArrowLeft');
        await wait(60);
        f = await FOCUS();
        const g = await where();
        assert.ok(f.level === '1' && f.text.indexOf('Border style') === 0 && !g.open && g.held,
            mod + '+ArrowLeft in the nested stock list gallery did not return to our submenu row: ' + JSON.stringify([f.text, f.level, g]));
    }
    /* The DataView of a nested gallery: "Format → Conditional formatting ▸ Data bars ▸". */
    const flyOpen = () => !!document.querySelector('#vo-shell .vo-mn-fly.open');
    const back = async (what, keys) => {
        await press(keys);
        await wait(120);
        const f = await FOCUS(), g = await where(), open = await page.evaluate(flyOpen);
        assert.ok(f.inShell && f.text.indexOf('Data bars') === 0 && !g.open && g.held && open,
            what + ': ' + keys + ' at the edge of the stock DataView did not return to our row: ' + JSON.stringify({focus: [f.text, f.inShell], g, open}));
    };
    await page.evaluate(() => document.querySelectorAll('.dataview .item.selected').forEach(n => n.classList.remove('selected')));
    await menuTo('textFormat', 'conditional');
    await press('ArrowRight');
    const f1 = await rowTo('Data bars');
    assert.ok(f1.level === '1' && f1.text.indexOf('Data bars') === 0, 'precondition: Conditional formatting ▸ Data bars is reached: ' + JSON.stringify(f1));
    await enter('Data bars', 'ArrowRight', 'dataview');
    await back('Data bars, no sample selected', 'Control+ArrowLeft');
    await enter('Data bars, again', 'ArrowRight', 'dataview');
    await press('ArrowDown');
    await press('ArrowRight');
    await press('Shift+ArrowLeft');
    await wait(60);
    const g = await where();
    assert.ok(g.open && g.inside && g.node === 'item' && g.idx === 0 && g.held,
        'Shift+ArrowLeft inside the DataView is its own move (sample 0): ' + JSON.stringify(g));
    await back('Data bars, left column', 'Shift+ArrowLeft');
});

/* ← leads to our row only from an item of the gallery list itself and at the edge of the nested gallery DataView
   (dataViewLeavesToHolder: the node is in the DataView of the shown gallery itself, the holder of its submenu is outside it). A node outside
   a DataView is a stock move, even when the submenu holder is in the hidden ribbon: the palette of the nested gallery "Border color"
   (ThemeColorPalette.onKeyDown: ← and → go in a circle in a row, focus on the palette) - with a modifier too; a submenu item inside
   the gallery itself (the SmartArt section with a list: ← closes the section by the stock delegate, focus is on the section). There are no shell
   handler failures. The negative control is copies of CompactShell.js: "a node inside a DataView" replaced with "a node inside
   a gallery"; the node-in-DataView check removed (a failure in the handler); any item of the gallery is counted as an item of the gallery list. */
test('stock_gallery_left_outside_dataview_is_stock_move', async () => {
    await fresh({}, 2000, true, GALLERY_CASE_ITEMS);
    const warns = [];
    /* A shell handler failure (guarded → warnOnce): 'Compact shell: "<label>" failed'. */
    page.on('console', m => { if (/Compact shell: ".*" failed/.test(m.text())) warns.push(m.text()); });
    await page.addScriptTag({path: path.join(ROOT, 'vendor/jquery/jquery.js')});
    assert.equal(await page.evaluate(galleryFakes), true, 'precondition: stock gallery models are built');
    /* The stock palette: ← and → go in a circle in a row (selected), the event goes no further; ↓ from "Auto" - into the palette (the stock inner
       menu: Menu.onBeforeKeyDown → focusInner). */
    await page.evaluate(() => {
        const pal = document.querySelector('.theme-colorpalette'), colors = [...pal.querySelectorAll('a.color')];
        pal.addEventListener('keydown', e => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            e.stopPropagation();
            const i = colors.findIndex(c => c.classList.contains('selected'));
            const n = e.key === 'ArrowLeft' ? (i <= 0 ? colors.length - 1 : i - 1) : (i + 1) % colors.length;
            colors.forEach((c, k) => c.classList.toggle('selected', k === n));
        });
        pal.closest('ul').addEventListener('keydown', e => {
            if (e.key !== 'ArrowDown' || e.target.textContent !== 'Auto') return;
            e.preventDefault();
            e.stopPropagation();
            pal.focus();
        }, true);
    });
    const {wait, where, home, menuTo, rowTo, enter} = galleryNav();
    const color = () => page.evaluate(() => [...document.querySelectorAll('.theme-colorpalette a.color')].findIndex(c => c.classList.contains('selected')));
    /* A panel list: "Borders ▾ → Border color ▸" - a nested gallery with a palette. */
    await home();
    await press('F10');
    await press('Tab');
    for (let i = 0; i < 60 && (await FOCUS()).ctrl !== 'borders'; i++) await press('ArrowRight');
    assert.equal((await FOCUS()).ctrl, 'borders', 'precondition: Borders is reached by arrows');
    await press('ArrowDown');
    let f = await rowTo('Border color');
    assert.ok(f.text.indexOf('Border color') === 0, 'precondition: the list row Border color is reached: ' + JSON.stringify(f));
    await enter('toolbar Borders ▸ Border color', 'ArrowRight', 'Auto');
    await press('ArrowDown');
    let g = await where();
    assert.ok(g.open && g.inside && g.node === 'palette', 'precondition: ArrowDown from Auto enters the stock palette: ' + JSON.stringify(g));
    for (const [keys, idx] of [['ArrowLeft', 5], ['ArrowLeft', 4], ['Shift+ArrowLeft', 3], ['Control+ArrowLeft', 2]]) {
        await press(keys);
        await wait(60);
        g = await where();
        const at = await color();
        assert.ok(g.open && g.inside && g.node === 'palette' && g.held && at === idx,
            keys + ' in the palette of a nested stock gallery must be the palette move (color ' + idx + '), not a return to our row: ' + JSON.stringify([g, at]));
    }
    await press('Escape');
    await wait(60);
    /* The SmartArt gallery (a case item): the "Process" section with a list - a submenu inside the gallery itself. */
    f = await menuTo('textInsert', 'tstSmartArt');
    assert.equal(f.k, 'tstSmartArt', 'precondition: Insert → the SmartArt gallery row is reached by arrows');
    await enter('Insert → SmartArt', 'ArrowRight', 'Basic');
    await press('ArrowDown');
    await press('ArrowDown');
    assert.equal((await where()).node, 'Process', 'precondition: ArrowDown reaches the SmartArt list section');
    for (const keys of ['ArrowLeft', 'Shift+ArrowLeft']) {
        await press('ArrowRight');
        await wait(40);
        assert.equal((await where()).node, 'P1', 'precondition: ArrowRight opens the section list');
        await press(keys);
        await wait(60);
        g = await where();
        assert.ok(g.open && g.inside && g.node === 'Process' && g.held,
            keys + ' on an item of a submenu inside the gallery must stay the stock move (back to the section): ' + JSON.stringify(g));
    }
    await press('ArrowLeft');
    await wait(60);
    f = await FOCUS();
    assert.ok(f.k === 'tstSmartArt' && !(await where()).open, 'ArrowLeft on the SmartArt section did not return to our row: ' + JSON.stringify(f));
    assert.deepEqual(warns, [], 'shell handler failures: ' + warns.join(' | '));
});

/* A composite submenu (catalog items with such submenus
   are checked at their sections - here is a case item at the end of "View"): from the keyboard - like a
   mirror submenu. → on a holder opens the layer and puts focus on the first item, not on the group
   header; ↓/↑, Home walk the items in a circle past the headers (a header is not a button); ← - back to
   the holder; Enter on an item - its command, the menu is closed. For the screen reader: a switch is menuitemcheckbox,
   a choice from a group is menuitemradio with aria-checked, a group is role=group with the header name,
   the header is removed from the accessibility tree. The header look: the menu item
   height, 11 px text in the muted hint color, without hover (the real spreadsheet editor styles layer). */
const OWN_SUBMENU = () => {
    const A = SSE.Views.SheetActions, orig = A.catalog;
    A.catalog = function () {
        const c = orig.call(this);
        c[2].items.push({sep: true}, {k: 'tstHolder', t: 'Holder', items: [
            {head: 'Marks'},
            {k: 'kidBold', t: 'Kid bold', twin: 'Toolbar:btnBold', check: true},
            {k: 'kidLeft', t: 'Kid left', twin: 'Toolbar:btnAlignLeft', check: 'radio'},
            {k: 'kidCenter', t: 'Kid center', twin: 'Toolbar:btnAlignCenter', check: 'radio'},
            {sep: true},
            {head: 'Stock rows'},
            {mirror: 'Toolbar:btnBorders'},
            {k: 'kidUndo', t: 'Kid undo', twin: 'Toolbar:btnUndo'}
        ]});
        return c;
    };
};
test('own_submenu_keyboard_skips_headers', async () => {
    await fresh({}, 1440, true, OWN_SUBMENU);
    await clear();
    await press('F10');
    await press('Home');
    await press('ArrowRight', 2);                                   // "View"
    await press('ArrowDown');
    await press('End');
    let f = await FOCUS();
    assert.equal(f.k, 'tstHolder', 'precondition: the composite item is the last of View: ' + JSON.stringify(f));
    await press('ArrowRight');
    f = await FOCUS();
    assert.ok(f.level === '1' && f.k === 'kidBold', 'ArrowRight did not move to the first item of the own submenu (past its header): ' + JSON.stringify(f));
    assert.ok(f.ring, 'no focus ring on an item of the own submenu');
    const layer = await page.evaluate(() => {
        const fly = document.querySelector('#vo-shell .vo-mn-fly[data-level="1"]');
        const row = k => { const r = fly.querySelector('[data-k="' + k + '"]'); return [r.getAttribute('role'), r.getAttribute('aria-checked')]; };
        return {role: fly.getAttribute('role'), label: fly.getAttribute('aria-label'),
            groups: [...fly.querySelectorAll('[role=group]')].map(g => g.getAttribute('aria-label')),
            heads: [...fly.querySelectorAll('.vo-mn-grp-t')].map(h => [h.tagName, h.getAttribute('aria-hidden'), h.getAttribute('role'), h.tabIndex]),
            bold: row('kidBold'), left: row('kidLeft'), center: row('kidCenter'), undo: row('kidUndo')};
    });
    assert.deepEqual([layer.role, layer.label], ['menu', 'Holder'], 'the own submenu is not a named menu');
    assert.deepEqual(layer.groups, ['Marks', 'Stock rows'], 'groups are not named by their headers');
    /* The visible group name of the shared menu row (vo-mn-grp-t): not a button and not an item, hidden from the screen reader. */
    assert.deepEqual(layer.heads, [['SPAN', 'true', null, -1], ['SPAN', 'true', null, -1]], 'a header is an item or is read twice');
    assert.deepEqual(layer.bold, ['menuitemcheckbox', 'false'], 'a toggle child is not a menuitemcheckbox with its state');
    assert.deepEqual([layer.left, layer.center], [['menuitemradio', 'true'], ['menuitemradio', 'false']], 'one-choice children are not menuitemradio with the state');
    assert.deepEqual(layer.undo, ['menuitem', null]);
    /* ↓ in a circle - only items: its own and the stock menu rows in place. */
    const want = ['Kid bold', 'Kid left', 'Kid center', 'Bottom border', 'Top border', 'No borders', 'Kid undo'];
    const seen = [(await FOCUS()).text];
    for (let i = 1; i < want.length; i++) { await press('ArrowDown'); seen.push((await FOCUS()).text); }
    assert.deepEqual(seen, want, 'ArrowDown visits the items of the own submenu in order, past the headers');
    await press('ArrowDown');
    assert.equal((await FOCUS()).text, want[0], 'ArrowDown wraps to the first item');
    await press('ArrowUp');
    assert.equal((await FOCUS()).text, want[want.length - 1], 'ArrowUp wraps to the last item');
    await press('Home');
    assert.equal((await FOCUS()).text, want[0], 'Home');
    /* ← - back to the holder, the layer is closed. */
    await press('ArrowLeft');
    f = await FOCUS();
    assert.ok(f.k === 'tstHolder' && f.level === '0', 'ArrowLeft did not return to the holder: ' + JSON.stringify(f));
    assert.equal(await page.evaluate(() => !!document.querySelector('#vo-shell .vo-mn-fly')), false, 'the own submenu stayed open');
    /* Enter on an item - its command by the standard path, the menu is closed. */
    await press('ArrowRight');
    await press('Enter');
    const st = await state();
    assert.deepEqual(st.log.filter(l => /btnBold/.test(l)), ['click Toolbar:btnBold'], 'Enter on a child did not run its twin once: ' + JSON.stringify(st.log));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-mn-item')].some(b => b.getAttribute('aria-expanded') === 'true')),
        false, 'the menu stayed open after the command');
    /* The header look: the menu row height, 11 px in the muted item
       hint color, on the caption line, without a hover fill and without a hand cursor. */
    await page.evaluate(() => {
        const sh = SSE.Views.CompactShell;
        sh.closeSurfaces();
        sh.menu.open('view');
        document.querySelector('#vo-shell .vo-mn-drop.open [data-k="tstHolder"]').click();
    });
    await page.hover('#vo-shell .vo-mn-fly .vo-mn-grp-t');
    await page.waitForTimeout(250);
    const look = await page.evaluate(() => {
        const h = document.querySelector('#vo-shell .vo-mn-fly .vo-mn-grp-t'), row = document.querySelector('#vo-shell .vo-mn-fly .vo-mn-sub');
        const hint = document.createElement('span');
        hint.className = 'vo-mn-h';
        row.appendChild(hint);
        const s = getComputedStyle(h), r = getComputedStyle(row), hs = getComputedStyle(hint);
        const out = {h: h.getBoundingClientRect().height, rowH: row.getBoundingClientRect().height, fs: s.fontSize, color: s.color,
            hintColor: hs.color, hintFs: hs.fontSize, bg: s.backgroundColor, cursor: s.cursor, padL: s.paddingLeft, rowPadL: r.paddingLeft,
            font: s.fontFamily === r.fontFamily, hovered: h.matches(':hover')};
        hint.remove();
        return out;
    });
    assert.ok(look.hovered, 'precondition: the pointer is over the header');
    assert.equal(look.h, look.rowH, 'the header is not as high as a menu row: ' + JSON.stringify(look));
    assert.deepEqual([look.fs, look.color], [look.hintFs, look.hintColor], 'the header is not the muted text of an item hint: ' + JSON.stringify(look));
    assert.equal(look.fs, '11px');
    assert.equal(look.bg, 'rgba(0, 0, 0, 0)', 'the header got a hover fill');
    assert.equal(look.cursor, 'default');
    assert.ok(look.padL === look.rowPadL && look.font, 'the header is not on the line of the item labels: ' + JSON.stringify(look));
});

(async () => {
    /* The styles layer is as in app.less: the shared menu row rules (menu.less) and the spreadsheet editor values. */
    const less = require(path.join(ROOT, 'build/node_modules/less'));
    css = (await less.render(layer.source(LESS),
        {filename: layer.APP_LESS, globalVars: {'app-image-const-path': '"resources/img"'}})).css;
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    try {
        for (const [name, fn] of tests) {
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
