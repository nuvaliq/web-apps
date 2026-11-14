/* Run: node test/unit-tests/spreadsheeteditor/compact-toolbar.cjs [path to CompactToolbar.js] [path to CompactShell.js] [path to compact-shell.less]
 * The formatting panel of the spreadsheet editor "Compact" shell: 35 controls on
 * the standard ribbon doubles, their state from the doubles and the engine, font size, color, zoom
 *; the row measurement with the core, "⋯", the focus chevron, the restriction mask, focus mode and
 * Escape together with the real CompactShell shell.
 * Real headless Chrome (playwright, as documenteditor/compact-toolbar-scroll.cjs):
 * NODE_PATH or PLAYWRIGHT_MODULE for the package, CHROMIUM_PATH for the browser; the styles are the real
 * spreadsheet editor compact-shell.less, built by the less from build/node_modules. The shell modules (Icons,
 * StockBridge, SheetActions, CompactToolbar) are real, the stock is fake doubles with
 * nodes in the DOM (watched by the bridge MutationObserver); the font size field handler is
 * the real text of the spreadsheet editor controller/Toolbar.js (onFontSizeChanged), the "Find" field of the standard
 * search panel is the real onKeyDown, setValue and _doChange of Common.UI.InputField.
 * The arguments are broken copies of modules for the negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/spreadsheeteditor/main/app/view');
const TOOLBAR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactToolbar.js');
const SHELL = process.argv[3] ? path.resolve(process.argv[3]) : path.join(VIEW, 'CompactShell.js');
const LESS = process.argv[4] ? path.resolve(process.argv[4]) : path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/compact-shell.less');
const STOCK_TOOLBAR_CTL = path.join(ROOT, 'apps/spreadsheeteditor/main/app/controller/Toolbar.js');
const STOCK_INPUT_FIELD = path.join(ROOT, 'apps/common/main/lib/component/InputField.js');
const DE_TOOLBAR = path.join(ROOT, 'apps/documenteditor/main/app/view/CompactToolbar.js');
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
    /* iconCls - the class of the standard item icon (Common.UI.MenuItem: options.iconCls); present only on items where it was given. */
    const it = events({caption, options: o.iconCls !== undefined ? {caption, iconCls: o.iconCls} : {caption}, value: o.value, disabled: !!o.disabled, hidden: false, visible: true, rendered: true,
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
/* sdkjs cell/apiDefines.js: the number format types (the value of a standard format list record). */
window.Asc = {c_oAscCleanOptions: {All: 0, Text: 1, Format: 2, Comments: 5, Hyperlinks: 6},
    c_oAscNumFormatType: {None: -1, General: 0, Number: 1, Scientific: 2, Accounting: 3, Currency: 4, Date: 5, LongDate: 6, Time: 7,
        Percent: 8, Fraction: 9, Text: 10, Custom: 11},
    /* sdkjs common/commonDefines.js: the border line styles (CompactToolbar.engineBorders reads None at call time). */
    c_oAscBorderStyles: {None: 0, Double: 1, Hair: 2, DashDotDot: 3, DashDot: 4, Dotted: 5, Dashed: 6, Thin: 7, MediumDashDotDot: 8,
        SlantDashDot: 9, MediumDashDot: 10, MediumDashed: 11, Medium: 12, Thick: 13}};
/* The number format is a combo: the store of the standard ribbon list (view/Toolbar.js numFormatData: eleven formats in its order, the type is
   value, dates have one), the stock example is the active cell value (here - only for currency), "More formats" is in the markup
   (as in ComboBoxCustom). */
const nfEl = document.createElement('div');
const nfModels = [['General', 0, 'General'], ['Number', 1, '0.00'], ['Scientific', 2, '0.00E+00'], ['Accounting', 3, 'ACC'],
    ['Currency', 4, 'CUR'], ['Short date', 5, 'dd/mm/yyyy'], ['Long date', 5, 'd mmmm yyyy'], ['Time', 7, 'h:mm:ss'],
    ['Percentage', 8, '0.00%'], ['Fraction', 9, '# ?/?'], ['Text', 10, '@']]
    .map(([cap, value, format], i) => ({id: 'nf-' + i, displayValue: cap, value, format, exampleval: cap === 'Currency' ? '1 234,00 ₽' : ''}));
nfEl.innerHTML = '<ul>' + nfModels.map(m => '<li id="' + m.id + '"><a>' + m.displayValue + '</a></li>').join('') +
    '<li class="divider"></li><li id="nf-more"><a>More formats</a></li></ul>';
stock.appendChild(nfEl);
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
/* borders - the answer of the selection asc_getBorders(): null, as in the standard engine, or {left, top, right, bottom, diagDown, diagUp} with
   the side style (a number of Asc.c_oAscBorderStyles) or null; throwBorders - reading borders throws; oneCell - the answer of asc_getOneCell():
   one cell (or one merged area) is selected, undefined - the engine answer has no such method. */
window.api = {calls: [], zoom: 1, handlers: {}, isCellEdited: false, fontColor: null, fillColor: null, numType: null, angle: 0, frozen: false,
    borders: null, throwBorders: false, oneCell: true,
    asc_registerCallback(n, f) { (this.handlers[n] = this.handlers[n] || []).push(f); },
    asc_unregisterCallback(n, f) { const a = this.handlers[n] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    send(n, ...a) { (this.handlers[n] || []).slice().forEach(f => f.apply(this, a)); },
    asc_getZoom() { return this.zoom; }, asc_setZoom(z) { this.calls.push('asc_setZoom ' + z); },
    asc_enableKeyEvents(v) { this.calls.push('keys ' + v); }, asc_setCellFontSize(v) { this.calls.push('asc_setCellFontSize ' + v); },
    asc_isDocumentModified() { return false; }, asc_Resize() {}, asc_isProtectedSheet() { return false; },
    /* The document locale and the format example on a sample (sdkjs cell/api.js asc_getLocaleExample(format, value, culture)): the stub
       records what it was given - it shows on which sample and in which locale the example was read. */
    asc_getLocale() { return 1049; }, asc_getLocaleExample(f, v, c) { return ' ' + f + ' @ ' + v + ' / ' + c + ' '; },
    /* The selection number format is the type Asc.c_oAscNumFormatType (numType; null - the engine does not know the format), rotation is the text angle
       (asc_getAngle: 0, ±45, ±90, 255 - vertical), freezing sheet panes - asc_getSheetViewSettings. */
    asc_getCellInfo() { const me = this; const info = {asc_getXfs: () => ({asc_getFontColor: () => me.fontColor, asc_getFillColor: () => me.fillColor,
        asc_getFontName: () => me.fontName, asc_getNumFormatInfo: () => me.numType == null ? null : {asc_getType: () => me.numType},
        asc_getAngle: () => me.angle}), asc_getBorders: () => me.cellBorders()};
        if (me.oneCell !== undefined) info.asc_getOneCell = () => me.oneCell;
        return info; },
    asc_getSheetViewSettings() { const me = this; return {asc_getIsFreezePane: () => me.frozen}; },
    /* The engine asc_CBorders: the sides are asc_CBorder (asc_getStyle, asc_getColor) or null. */
    cellBorders() {
        if (this.throwBorders) throw new Error('borders are not readable');
        const b = this.borders;
        if (!b) return null;
        const side = n => b[n] == null ? null : {asc_getStyle: () => b[n], asc_getColor: () => null};
        return {asc_getLeft: () => side('left'), asc_getTop: () => side('top'), asc_getRight: () => side('right'),
            asc_getBottom: () => side('bottom'), asc_getDiagDown: () => side('diagDown'), asc_getDiagUp: () => side('diagUp')};
    }};
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
/* O.borderIcons - the "Borders" button menu in the stock shape (view/Toolbar.js): items with standard icon classes, "Border style" and
   "Border color" with submenus, "More borders" without an icon. There are no diagonals: the mirror removes them. */
const BORDER_ITEMS = () => [
    item('Bottom borders', {iconCls: 'menu__icon btn-border-bottom'}), item('Top borders', {iconCls: 'menu__icon btn-border-top'}),
    item('Left borders', {iconCls: 'menu__icon btn-border-left'}), item('Right borders', {iconCls: 'menu__icon btn-border-right'}),
    item('--'),
    item('No borders', {iconCls: 'menu__icon btn-border-no'}), item('All borders', {iconCls: 'menu__icon btn-border-all'}),
    item('Outside borders', {iconCls: 'menu__icon btn-border-out'}), item('Inside borders', {iconCls: 'menu__icon btn-border-inside'}),
    item('--'),
    item('Inside horizontal borders', {iconCls: 'menu__icon btn-border-insidehor'}),
    item('Inside vertical borders', {iconCls: 'menu__icon btn-border-insidevert'}),
    item('--'),
    item('Border style', {iconCls: 'menu__icon btn-border-style', menu: menu('Toolbar:btnBorders', ['Thin', 'Thick'])}),
    item('Border color', {iconCls: 'mnu-icon-item mnu-border-color', menu: menu('Toolbar:btnBorders', ['Automatic', 'Red'])}),
    item('More borders')
];
const toolbarView = {
    btnUndo: twin('Toolbar:btnUndo'), btnRedo: twin('Toolbar:btnRedo'),
    /* The ribbon "Print" button: for the panel it is only the availability source; its click in the journal means the panel went the wrong
       way (the stock quick print would print without a window). */
    btnPrint: twin('Toolbar:btnPrint'),
    cmbNumberFormat: numFormat, cmbFontName: fontName, cmbFontSize: fontSize,
    btnCurrencyStyle: twin('Toolbar:btnCurrencyStyle'), btnPercentStyle: twin('Toolbar:btnPercentStyle'),
    btnDecDecimal: twin('Toolbar:btnDecDecimal'), btnIncDecimal: twin('Toolbar:btnIncDecimal'),
    btnDecFontSize: twin('Toolbar:btnDecFontSize'), btnIncFontSize: twin('Toolbar:btnIncFontSize'),
    btnBold: twin('Toolbar:btnBold', {toggle: true}), btnItalic: twin('Toolbar:btnItalic', {toggle: true}),
    btnUnderline: twin('Toolbar:btnUnderline', {toggle: true}), btnStrikeout: twin('Toolbar:btnStrikeout', {toggle: true}),
    btnTextColor: twin('Toolbar:btnTextColor'), btnBackColor: twin('Toolbar:btnBackColor'),
    btnBorders: O.borderIcons ? withMenu('Toolbar:btnBorders', BORDER_ITEMS()) : withMenu('Toolbar:btnBorders', ['Bottom border', 'Top border', 'No borders']),
    /* O.borderIcons: the "Merge" items have their own btn-* class not from the glyph table (the negative control). */
    btnMerge: withMenu('Toolbar:btnMerge', O.borderIcons
        ? ['Merge & center', 'Merge across', 'Unmerge'].map(c => item(c, {iconCls: 'menu__icon btn-merge-cells'}))
        : ['Merge & center', 'Merge across', 'Unmerge']),
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
const shortcuts = {EditUndo: ['Ctrl', 'Z'], Bold: ['Ctrl', 'B'], ToggleAutoFilter: ['Ctrl', 'Shift', 'L'], PrintPreviewAndPrint: ['Ctrl', 'P']};
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

let browser, page, css = '', stockTipCss = '';
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
        ? '<body><div id="stock" style="display:none"></div><div id="toolbar"><section class="toolbar"><div id="box-right-btn-group"></div></section></div></body>'
        : '<body class="vo-compact"><div id="stock" style="display:none"></div><div id="toolbar"><div id="vo-shell"><div id="vo-plate"></div></div></div></body>';
    /* The document base is the editor directory: Icons builds the AIR set address from document.baseURI. */
    await page.setContent(`<!doctype html><html><head><base href="${BASE}"><style>${css}</style></head>${body}</html>`);
    await page.addScriptTag({path: path.join(ROOT, 'vendor/underscore/underscore.js')});
    await page.evaluate(HARNESS(opt, STOCK_FS, STOCK_FS_SELECT));
    for (const [name, file] of MODULES.concat(withShell ? SHELL_MODULES : [])) {
        await page.evaluate(n => { window.__mod = n; }, name);
        await page.addScriptTag({content: fs.readFileSync(file, 'utf8') + '\n//# sourceURL=' + path.basename(file)});
    }
    if (withShell) {
        if (before) await page.evaluate(before);
        await page.evaluate(() => { SSE.Views.CompactShell.create(); });
        await flush();
    }
    return page;
}

/* Build the panel and caption it as the shell will: the panel is the first card row (#vo-plate). */
const BUILD = `(() => { const T = SSE.Views.CompactToolbar; const bar = T.build(null);
    if (bar) { document.getElementById('vo-plate').appendChild(bar); T.bind(null); } return !!bar; })()`;
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

/* The row order: Undo · Redo · Search · Comment · Zoom ▾ | ₽ · % · Decimal places − · Decimal places + · 123 (the number
   format; the numbers block as in Google Sheets - before the font) | then as the Excel "Home", except sort and filter before editing:
   Font ▾ · Font size · Bold · Italic · Underline · Strikethrough · Format painter | Text color · Fill · Borders ▾ | Horizontal ▾ ·
   Wrap ▾ · Merge ▾ | Sort ▾ · Filter | Function ▾ · Clear format | Vertical ▾ · Print | Link · Chart · Image | Conditional formatting ▾ · Rotation ▾ ·
   Data validation · Freeze panes ▾. The row start is as in Documents. The core: Undo, Redo, Search, Comment,
   Zoom, Number format, Font size, Bold, Italic, Underline, Strikethrough. */
const ROW_ORDER = ['undo', 'redo', 'search', 'comment', 'zoom', 'currency', 'percent', 'decDown', 'decUp', 'numfmt',
    'font', 'size', 'bold', 'italic', 'underline', 'strike', 'paint', 'textColor', 'fillColor', 'borders', 'halign', 'wrap', 'merge',
    'sort', 'filter', 'func', 'clear', 'valign', 'print', 'link', 'chart', 'image', 'condfmt', 'rotate', 'validate', 'freeze'];
const CORE = ['undo', 'redo', 'search', 'comment', 'zoom', 'numfmt', 'size', 'bold', 'italic', 'underline', 'strike'];

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* The numbers are as in Google Sheets: ₽ · % · Decimal places − · Decimal places + · "123" as one group, without separators inside, right
   after the row start, before the font. The percent sign is plain (percentSign, not the shared set "discount" one), the decimal places are ".0 ←" and ".00 →",
   the number format is the "123" glyph (outline/digits123 AIR) without ▾ and without a caption, still core and with the former hint. There
   are no icons of their own in the shared set - they come from the spreadsheet editor layer (resources/img/air). The alignment is as in Excel. The negative control is
   the former row ("General ▾" first, the decimal places as their own group, the rtl/ltr and percent icons of the shared set). */
test('number_group_as_google', async () => {
    await fresh();
    assert.equal(await page.evaluate(BUILD), true);
    const groups = await page.evaluate(() => [...document.querySelectorAll('#vo-tb > .vo-g')].map(g => g.getAttribute('data-group')));
    const ctrlsOf = g => page.evaluate(g => [...document.querySelectorAll('#vo-tb > .vo-g[data-group="' + g + '"] > [data-ctrl]')].map(n => n.getAttribute('data-ctrl')), g);
    assert.deepEqual(await ctrlsOf('number'), ['currency', 'percent', 'decDown', 'decUp', 'numfmt'],
        'the number group is not «₽ · % · .0← · .00→ · 123» as in Google Sheets');
    assert.equal(groups.indexOf('decimal'), -1, 'the decimal buttons are still a group of their own');
    assert.deepEqual([groups.indexOf('number') - groups.indexOf('service'), groups.indexOf('typo') - groups.indexOf('number')], [1, 1],
        'the number group must stand right after the start of the row and right before the font: ' + groups);
    assert.deepEqual(await ctrlsOf('align'), ['halign', 'wrap', 'merge'], 'the align group is not «Horizontal · Wrap · Merge» as in Excel');
    const look = await page.evaluate(() => ['currency', 'percent', 'decDown', 'decUp', 'numfmt'].map(k => {
        const n = document.querySelector('#vo-tb [data-ctrl="' + k + '"]'), a = n.querySelector('.vo-air');
        const b = n.matches('button') ? n : n.querySelector(':scope > button');
        const src = /--vo-air-src:url\(([^)]*)\)/.exec(a.getAttribute('style'))[1];
        return [k, src.replace(/^.*\/apps\/(?=(common|spreadsheeteditor)\/)/, ''), !!n.querySelector('.vo-drop-c, .vo-value-caret'), !!n.querySelector('.vo-value-label'),
            b.getAttribute('aria-haspopup'), n.getAttribute('data-core')];
    }));
    assert.deepEqual(look, [
        ['currency', 'common/main/resources/img/air/currency.svg', false, false, null, null],
        ['percent', 'spreadsheeteditor/main/resources/img/air/percentSign.svg', false, false, null, null],
        ['decDown', 'spreadsheeteditor/main/resources/img/air/decimalDecrease.svg', false, false, null, null],
        ['decUp', 'spreadsheeteditor/main/resources/img/air/decimalIncrease.svg', false, false, null, null],
        ['numfmt', 'spreadsheeteditor/main/resources/img/air/digits123.svg', false, false, 'menu', 'true']],
        'the number block glyphs: ' + JSON.stringify(look));
    assert.equal(await page.getAttribute(btnOf('numfmt'), 'aria-label'), 'Number format', 'the number format hint changed');
});

test('thirty_six_controls_in_order', async () => {
    await fresh();
    await page.evaluate(BUILD);
    assert.deepEqual(await keysOf(), ROW_ORDER, 'controls and their order');
    const groups = await page.evaluate(() => [...document.querySelectorAll('#vo-tb > .vo-g')].map(g => [g.getAttribute('data-group'),
        [...g.children].map(n => n.getAttribute('data-ctrl'))]));
    /* Ten groups - actions · numbers (with decimal places) · font style · color · alignment · sort and filter · editing ·
       "Vertical" and print · insert · other; there is no "Search" group at the end of the row. */
    assert.deepEqual(groups.map(g => g[0]), ['service', 'number', 'typo', 'color', 'align', 'data', 'edit', 'extra', 'insert', 'misc']);
    assert.deepEqual(groups.map(g => g[1].length), [5, 5, 7, 3, 3, 2, 2, 2, 3, 4]);
    const core = await page.evaluate(() => [...document.querySelectorAll('#vo-tb [data-core="true"]')].map(n => n.getAttribute('data-ctrl')));
    assert.deepEqual(core, CORE, 'the core');
    const bar = await page.evaluate(() => { const b = document.getElementById('vo-tb'); return [b.getAttribute('role'), !!b.getAttribute('aria-label')]; });
    assert.deepEqual(bar, ['toolbar', true]);
});

/* The row start is as in Documents (the Documents service group): Undo · Redo · Search · Comment · Zoom, all five are
   core; there is no "Print" in the first group. There is no "Comment" in the insert group and no "Search" at the end of the row. The negative control is the former
   row (print after zoom, search last, comment in insert). */
test('service_group_as_documents', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const ctrlsOf = g => page.evaluate(g => [...document.querySelectorAll('#vo-tb > .vo-g[data-group="' + g + '"] > [data-ctrl]')].map(n => n.getAttribute('data-ctrl')), g);
    assert.deepEqual(await ctrlsOf('service'), ['undo', 'redo', 'search', 'comment', 'zoom'],
        'the first group: undo, redo, search, comment, zoom as in documents');
    assert.deepEqual(await ctrlsOf('insert'), ['link', 'chart', 'image'], 'the insert group is not «Link · Chart · Image»');
    assert.notEqual((await keysOf()).pop(), 'search', 'search is still the last control of the row');
    const deService = /var service = \[([^\]]+)\]/.exec(fs.readFileSync(DE_TOOLBAR, 'utf8'));
    assert.ok(deService && /^\s*c\.undo,\s*c\.redo,\s*c\.search\s*$/.test(deService[1]),
        'precondition: the documents row starts with undo, redo, search — recheck the test: ' + (deService && deService[1]));
    /* The zooms are the Documents list. */
    const de = /var ZOOMS = \[([^\]]+)\]/.exec(fs.readFileSync(DE_TOOLBAR, 'utf8'))[1].split(',').map(Number);
    assert.deepEqual(await page.evaluate(() => SSE.Views.CompactToolbar.ZOOMS), de, 'zoom list differs from documents');
    /* Search is the standard search:show notification, exactly one. */
    await clear();
    await page.click(btnOf('search'));
    assert.deepEqual((await state()).notes.filter(n => n === 'search:show'), ['search:show']);
    /* Undo/redo - the standard double click(); the hint - with the shortcut from the registry. */
    await clear();
    await page.click(btnOf('undo'));
    assert.deepEqual((await state()).log, ['click Toolbar:btnUndo']);
    /* The hint text is in aria-description (it used to be title), the hover hint shows it. */
    assert.equal(await page.getAttribute(btnOf('undo'), 'aria-description'), 'Undo (Ctrl+Z)', 'stock shortcut in the hint');
});

/* The panel zoom is the Documents list, "View → Zoom ▸" is the same list (SheetActions.zooms); a choice is one asc_setZoom (setZoom),
   the keyboard goes to the sheet, the list is closed. The caption is the engine zoom rounded like the sheet row caption (zoomPercent: 125 at 1.25), a value
   outside the list - as is, without a checkmark; the caption follows asc_onZoomChanged. */
test('zoom_list_documents_via_asc_setZoom', async () => {
    await fresh();
    await page.evaluate(BUILD);
    assert.equal(/\.vo-w-zoom\s*\{\s*width:\s*80px/.test(css), true, 'the stylesheet does not size the toolbar zoom as documents (80)');
    await page.click(btnOf('zoom'));
    assert.deepEqual((await listRows('zoom')).map(r => r.t), ['50%', '75%', '100%', '125%', '150%', '200%']);
    assert.deepEqual((await listRows('zoom')).filter(r => r.on).map(r => r.t), ['100%'], 'current zoom checked');
    const de = /var ZOOMS = \[([^\]]+)\]/.exec(fs.readFileSync(DE_TOOLBAR, 'utf8'))[1].split(',').map(Number);
    assert.deepEqual(await page.evaluate(() => SSE.Views.SheetActions.zooms()), de, '«View → Zoom ▸» lost the list of the toolbar');
    await clear();
    await clickRow('zoom', '75%');
    const s = await state();
    assert.deepEqual(s.calls.filter(c => /asc_setZoom/.test(c)), ['asc_setZoom 0.75'], 'one asc_setZoom(0.75)');
    assert.ok(s.notes.includes('edit:complete'), 'focus back to the sheet after the pick');
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel('zoom')), false, 'list closed');
});

test('zoom_value_from_engine', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const label = () => page.textContent(ctrlSel('zoom') + ' .vo-value-label');
    assert.equal(await label(), '100%');
    await page.evaluate(() => { api.zoom = 1.25; api.send('asc_onZoomChanged', 1.25); });
    assert.equal(await label(), '125%', 'label follows the engine');
    await page.evaluate(() => { api.zoom = 0.6; api.send('asc_onZoomChanged'); });
    assert.equal(await label(), '60%', 'a value outside the list is shown as is');
    await page.click(btnOf('zoom'));
    assert.deepEqual((await listRows('zoom')).filter(r => r.on), [], 'nothing checked for 60%');
    /* The helpers are the same for "View → Zoom ▸": zoomPercent rounds like the sheet row caption. */
    const r = await page.evaluate(() => { const T = SSE.Views.CompactToolbar; api.zoom = 1.25; const a = T.zoomPercent();
        api.zoom = 0.6; const b = T.zoomPercent(); api.zoom = 1; return [a, b]; });
    assert.deepEqual(r, [125, 60], 'zoomPercent does not read the engine');
});

/* Zoom availability comes from the sheet row zoom button, as for "View → Zoom ▸": disabled by the stock (a cell edit) - the panel
   zoom is disabled too, and a list row sends no command; no button - zoom is available. The negative control is zoom without lock. */
test('zoom_locked_like_the_sheet_tabs_zoom', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const off = () => page.evaluate(sel => document.querySelector(sel).disabled, btnOf('zoom'));
    assert.equal(await off(), false, 'zoom is dimmed without the sheet tabs row');
    await page.evaluate(() => {
        const el = document.createElement('button');
        document.getElementById('stock').appendChild(el);
        window.zoomUp = {disabled: false, cmpEl: [el], isDisabled() { return this.disabled; },
            setDisabled(v) { this.disabled = !!v; if (v) el.setAttribute('disabled', ''); else el.removeAttribute('disabled'); }};
        const get = SSE.getController;
        SSE.getController = n => n === 'Statusbar' ? {statusbar: {btnZoomUp: zoomUp}} : get(n);
    });
    await page.evaluate(BUILD.replace("document.getElementById('vo-plate').appendChild(bar)",
        "document.getElementById('vo-plate').textContent = ''; document.getElementById('vo-plate').appendChild(bar)"));
    assert.equal(await off(), false, 'zoom is dimmed while the sheet tabs zoom is live');
    await page.click(btnOf('zoom'));
    await page.evaluate(() => { zoomUp.setDisabled(true); });
    await flush();
    await clear();
    await clickRow('zoom', '125%');
    assert.deepEqual((await state()).calls.filter(c => /asc_setZoom/.test(c)), [], 'a zoom row ran with the sheet tabs zoom locked');
    assert.equal(await off(), true, 'zoom is live while the sheet tabs zoom is locked (cell editing)');
    await page.evaluate(() => { zoomUp.setDisabled(false); });
    await flush();
    assert.equal(await off(), false, 'zoom stays dimmed after the lock');
});

test('comment_needs_comment_right', async () => {
    await fresh({options: {canComments: false}});
    await page.evaluate(BUILD);
    let keys = await keysOf();
    assert.ok(!keys.includes('comment'), 'comment drawn without canComments');
    assert.equal(keys.length, ROW_ORDER.length - 1);
    await fresh({options: {canCoAuthoring: false}});
    await page.evaluate(BUILD);
    assert.ok(!(await keysOf()).includes('comment'), 'comment drawn without canCoAuthoring');
    await fresh();
    await page.evaluate(BUILD);
    assert.ok((await keysOf()).includes('comment'));
    await clear();
    await page.click(btnOf('comment'));
    assert.deepEqual((await state()).log, ['click ToolbarCtl:btnsComment.0'], 'stock comment button, once');
});

/* "Print" goes after "Vertical", in one group with it: the button
   opens the same window as "File → Print" - one stock 'print' notification (SheetActions.print), not a click of the ribbon "Print" button
   (with the stock quick print it would print without a window); the caption is the menu item's, the shortcut is standard; without the print right there is no button (the row
   is shorter, the order of the others is the same); the ribbon "Print" button disabled by the stock (a cell edit, cantPrint) disables the panel button, and the command does not
   go even bypassing its state (exec). The negative control is a panel without the button, a panel with a double click, a panel without the gate. */
test('print_button_opens_print_dialog', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const keys = await keysOf();
    assert.equal(keys[keys.indexOf('valign') + 1], 'print', 'Print does not stand right after «Vertical align»: ' + keys.join(' '));
    /* The hint is aria-description (it used to be title). */
    assert.equal(await page.getAttribute(btnOf('print'), 'aria-description'), 'Print (Ctrl+P)', 'Print hint: the File → Print label and the stock shortcut');
    assert.equal(await page.getAttribute(btnOf('print'), 'aria-label'), 'Print');
    assert.equal(await page.getAttribute(btnOf('print'), 'aria-haspopup'), null, 'Print is a plain button');
    await clear();
    await page.click(btnOf('print'));
    let s = await state();
    assert.deepEqual(s.notes.filter(n => n === 'print'), ['print'], 'Print: one stock print notification');
    assert.deepEqual(s.log.filter(l => /btnPrint/.test(l)), [], 'Print clicked the stock print button (quick print would print without the dialog)');
    /* A ribbon button disabled by the stock (a cell edit) disables the panel button; the command does not go bypassing the button either. */
    await page.evaluate(() => { twins.btnPrint.keepState = ['cell-editing']; twins.btnPrint.setDisabled(true); api.send('asc_onEditCell'); });
    await flush();
    assert.equal(await page.evaluate(sel => document.querySelector(sel).disabled, btnOf('print')), true, 'Print is live while the stock print button is locked');
    await clear();
    const ran = await page.evaluate(() => SSE.Views.CompactToolbar.exec(SSE.Views.CompactToolbar.ctrl.print.it));
    s = await state();
    assert.equal(ran, false, 'Print ran with the stock print button locked');
    assert.deepEqual(s.notes.filter(n => n === 'print'), [], 'a print notification with the stock print button locked');
    await page.evaluate(() => { twins.btnPrint.keepState = []; twins.btnPrint.setDisabled(false); api.send('asc_onEditCell'); });
    await flush();
    assert.equal(await page.evaluate(sel => document.querySelector(sel).disabled, btnOf('print')), false, 'Print stays dimmed after the lock');
    /* Printing is prohibited - there is no button, the order of the others is the same. */
    await fresh({options: {canPrint: false}});
    await page.evaluate(BUILD);
    assert.deepEqual(await keysOf(), ROW_ORDER.filter(k => k !== 'print'), 'without the print right: no Print, the rest in the same order');
});

/* "Clear format" is a button without a list
   after "Function", like "Clear" in Excel "Editing" - without ▾, without a list and without aria-haspopup; a click is one standard choice of the "Formatting" item of the "Clear" button
   by value (the same command as "Format → Clear format": values, formulas, comments and links stay), not "All" and not the others;
   the button is disabled both by a disabled item (the item has its own locks: a cell edit, a chart, a shape, an image) and by a disabled
   ribbon button, and the command does not go bypassing the state either (exec). The negative control is the former list, a button without the item, disabling only
   by the button. */
test('clear_format_button_is_format_only', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const keys = await keysOf();
    assert.equal(keys[keys.indexOf('func') + 1], 'clear', '«Clear format» does not stand right after «Function»: ' + keys.join(' '));
    /* The hint text is aria-description (it used to be the title attribute). */
    const look = () => page.evaluate(sel => { const n = document.querySelector(sel), b = n.tagName === 'BUTTON' ? n : n.querySelector('button');
        return {pop: b.getAttribute('aria-haspopup'), list: !!n.querySelector('.vo-pop'), caret: !!n.querySelector('.vo-drop-c'), off: b.disabled,
                aria: b.getAttribute('aria-disabled'), title: b.getAttribute('aria-description')}; }, ctrlSel('clear'));
    let l = await look();
    assert.deepEqual([l.pop, l.list, l.caret, l.off], [null, false, false, false], '«Clear format» is still a list button: ' + JSON.stringify(l));
    await clear();
    await page.click(btnOf('clear'));
    let s = await state();
    assert.deepEqual(s.log.filter(x => /^pick /.test(x)), ['pick Toolbar:btnClearStyle Format'], '«Clear format» is not one pick of the stock «Format» item');
    assert.equal((await look()).list, false, 'a list opened under «Clear format»');
    /* The item is disabled (a cell edit - the stock disables the "Clear" items, not the button): the panel button is disabled with a reason, no command. */
    await page.evaluate(() => { const it = twins.btnClearStyle.menu.items[2]; it.disabled = true; it.keepState = ['cell-editing']; api.send('asc_onEditCell'); });
    await flush();
    l = await look();
    assert.ok(l.off && l.aria === 'true', 'the stock «Format» item is locked, «Clear format» is live: ' + JSON.stringify(l));
    assert.ok(/ — /.test(l.title), 'no lock reason in the hint: ' + l.title);
    await clear();
    assert.equal(await page.evaluate(() => SSE.Views.CompactToolbar.exec(SSE.Views.CompactToolbar.ctrl.clear.it)), false, '«Clear format» ran with its item locked');
    assert.deepEqual((await state()).log.filter(x => /^pick /.test(x)), [], 'a pick with the item locked');
    await page.evaluate(() => { const it = twins.btnClearStyle.menu.items[2]; it.disabled = false; it.keepState = []; api.send('asc_onEditCell'); });
    await flush();
    assert.equal((await look()).off, false, '«Clear format» stays dimmed after the item came back');
    /* The ribbon button is disabled (a co-author, a restriction), the item is alive: the panel button is disabled. */
    await page.evaluate(() => { twins.btnClearStyle.setDisabled(true); });
    await flush();
    assert.equal((await look()).off, true, 'the stock «Clear» button is locked, «Clear format» is live');
    await clear();
    assert.equal(await page.evaluate(() => SSE.Views.CompactToolbar.exec(SSE.Views.CompactToolbar.ctrl.clear.it)), false, '«Clear format» ran with the stock button locked');
    assert.deepEqual((await state()).log.filter(x => /^pick /.test(x)), [], 'a pick with the stock button locked (the item itself is live)');
    await page.evaluate(() => { twins.btnClearStyle.setDisabled(false); });
    await flush();
    assert.equal((await look()).off, false, '«Clear format» stays dimmed after the button came back');
});

/* Font style as one group, like "Font" in Excel: Font ▾ · Font size · Bold · Italic · Underline · Strikethrough · Format painter. "Format painter" is
   right after "Strikethrough", "Clear format" is in editing, they are not in the first group. Between the font size and "Bold" is an empty separator, as in
   Documents: without a bar, the gap is the group gap (13), and between the group neighbors - 6; the font size box is still 72. The negative
   control is the former row ("Clear format" after "Format painter"). */
test('typeface_group_as_documents', async () => {
    await fresh({}, 2000);
    await page.evaluate(BUILD);
    const ctrlsOf = g => page.evaluate(g => [...document.querySelectorAll('#vo-tb > .vo-g[data-group="' + g + '"] > [data-ctrl]')].map(n => n.getAttribute('data-ctrl')), g);
    assert.deepEqual(await ctrlsOf('typo'), ['font', 'size', 'bold', 'italic', 'underline', 'strike', 'paint'],
        'the typeface group is not «Font · Size · B · I · U · S · Format painter»');
    assert.deepEqual((await ctrlsOf('service')).filter(k => k === 'paint' || k === 'clear'), [], 'format painter or clear format stays in the first group');
    const gap = await page.evaluate(() => {
        const box = n => n.getBoundingClientRect(), q = s => document.querySelector('#vo-tb [data-ctrl="' + s + '"]');
        const size = q('size').querySelector('.vo-size-box'), bold = q('bold'), italic = q('italic'), font = q('font');
        const g = q('size').closest('.vo-g'), line = getComputedStyle(g, '::before');
        return {sizeToBold: box(bold).left - box(size).right, boldToItalic: box(italic).left - box(bold).right,
            fontToSize: box(size).left - box(font).right, box: box(size).width, sameGroup: g === bold.closest('.vo-g')};
    });
    assert.deepEqual(gap, {sizeToBold: 13, boldToItalic: 6, fontToSize: 6, box: 72, sameGroup: true},
        'the empty separator «size → B» is not the group gap without a line: ' + JSON.stringify(gap));
    /* Format painter is the former behavior: a click is the standard click(), a double click is the double standard dblclick. */
    await clear();
    await page.dblclick(btnOf('paint'));
    assert.deepEqual((await state()).log.filter(l => /btnCopyStyle/.test(l)),
        ['click Toolbar:btnCopyStyle', 'click Toolbar:btnCopyStyle', 'dblclick Toolbar:btnCopyStyle'], 'format painter is not the stock one');
});

/* Text color · Fill as their own group, a pair, like "Text color · Highlight" in Documents: both are a 24 glyph and under it a strip of
   the current color 16 × 3 with a rounding of 2, 4 to the right and 23 below the glyph corner; the color box is exactly the button, the glyphs are on the row glyph
   line. After the pair in the same group are borders, as in the "Font" group in Excel; merge is in alignment. Fill sets the fill by the same standard command ('color:select' of the fill double).
   The negative control is the former row (text color in the font style, fill at borders, a 15 strip under the button). */
test('color_pair_as_documents', async () => {
    await fresh({}, 2000);
    await page.evaluate(BUILD);
    const ctrlsOf = g => page.evaluate(g => [...document.querySelectorAll('#vo-tb > .vo-g[data-group="' + g + '"] > [data-ctrl]')].map(n => n.getAttribute('data-ctrl')), g);
    assert.deepEqual(await ctrlsOf('color'), ['textColor', 'fillColor', 'borders'], 'text color and fill are not a pair followed by borders');
    assert.deepEqual(await ctrlsOf('cell'), [], 'the former cell group of borders and merge is still there');
    const geo = await page.evaluate(() => {
        const r = n => { const q = n.getBoundingClientRect(); return {l: q.left, t: q.top, w: q.width, h: q.height}; };
        const bold = r(document.querySelector('#vo-tb [data-ctrl="bold"] .vo-air'));
        return ['textColor', 'fillColor'].map(k => {
            const w = document.querySelector('#vo-tb [data-ctrl="' + k + '"]'), b = w.querySelector(':scope > .vo-ib');
            const g = r(b.querySelector('.vo-air')), l = r(w.querySelector('.vo-cb-line')), box = r(w), btn = r(b);
            return {k, glyph: [g.w, g.h], line: [l.w, l.h, l.l - g.l, l.t - g.t], radius: getComputedStyle(w.querySelector('.vo-cb-line')).borderRadius,
                box: [box.h === btn.h, box.w === btn.w], onLine: g.t === bold.t};
        });
    });
    geo.forEach(x => assert.deepEqual(x, {k: x.k, glyph: [24, 24], line: [16, 3, 4, 23], radius: '2px', box: [true, true], onLine: true},
        x.k + ': not the colour button of documents: ' + JSON.stringify(x)));
    /* Fill is the standard command of the fill double, the strip is the color that the engine set. */
    await page.evaluate(() => { twins.btnBackColor.on('color:select', (b, c) => log.push('fill ' + c)); });
    await page.click(btnOf('fillColor'));
    await clear();
    await page.click(ctrlSel('fillColor') + ' .vo-pal-item[data-color="fbbf24"]');
    assert.deepEqual((await state()).log, ['fill FBBF24'], 'fill is not the color:select of the stock fill twin');
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel('fillColor')), false, 'the fill palette stays open');
    await page.evaluate(() => { api.fillColor = {get_auto: () => false, get_r: () => 0xfb, get_g: () => 0xbf, get_b: () => 0x24};
        api.send('asc_onSelectionChanged', api.asc_getCellInfo()); });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#vo-tb [data-ctrl="fillColor"] .vo-cb-line')).backgroundColor),
        'rgb(251, 191, 36)', 'the fill line does not show the fill of the selection');
});

/* "Function ▾" · "Clear format" as the editing group after sort with filter, like "Editing" in Excel (autosum and
   "Clear"); "Sort ▾" · "Filter" are their own group before editing (in Excel - at the end of "Home"). The "Function" command is the former - the list of the standard
   menu of the ribbon "Function" button. Not core: when narrowing it goes into "⋯" only after everything non-core to the right of it. The negative
   control is the former row (function after "Print", first in the numbers group; the filter alone in its group). */
test('function_in_the_editing_group_as_excel', async () => {
    await fresh({}, 2000);
    await page.evaluate(BUILD);
    const keys = await keysOf();
    assert.deepEqual(keys.slice(keys.indexOf('filter'), keys.indexOf('filter') + 3), ['filter', 'func', 'clear'],
        '«Function» and «Clear format» do not stand right after sort and filter: ' + keys.join(' '));
    const groupOf = k => page.evaluate(k => { const n = document.querySelector('#vo-tb [data-ctrl="' + k + '"]').closest('.vo-g');
        return [n.getAttribute('data-group'), [...n.children].map(x => x.getAttribute('data-ctrl'))]; }, k);
    assert.deepEqual(await groupOf('func'), ['edit', ['func', 'clear']], 'Function and Clear format are not the editing group');
    assert.deepEqual(await groupOf('filter'), ['data', ['sort', 'filter']], 'Sort and Filter are not a group of their own');
    assert.deepEqual(await groupOf('print'), ['extra', ['valign', 'print']], 'Vertical align and Print are not a group of their own');
    assert.notEqual(await page.getAttribute(ctrlSel('func'), 'data-core'), 'true', 'Function became core');
    await page.click(btnOf('func'));
    assert.deepEqual((await listRows('func')).map(r => r.t), ['SUM', 'AVERAGE', 'MIN'], 'the Function list is not the stock menu of the Function button');
    await clear();
    await clickRow('func', 'AVERAGE');
    assert.deepEqual((await state()).log.filter(l => /^pick /.test(l)), ['pick Toolbar:btnInsertFormula AVERAGE'], 'not one stock pick of the Function menu');
});

/* Fill is pressed while the selection has a fill (any, except "No fill") - with the same class on and aria-pressed as "Bold" for a
   bold cell, and the same pressed look on the card; without a fill (the engine: automatic, no color) - unpressed. The state follows
   the engine by selection and by format (like the strip). A click on a pressed one removes the fill, like a second click on "Bold":
   "No fill" by the same standard path as the top palette row, the palette does not open. The negative control is a fill without
   the pressed state; a click on a pressed one that opens the palette. */
test('fill_pressed_while_the_selection_has_a_fill', async () => {
    await fresh({}, 2000, true);
    const look = k => page.evaluate(sel => { const b = document.querySelector(sel); b.getAnimations().forEach(a => a.finish());
        const c = getComputedStyle(b); return {on: b.classList.contains('on'), aria: b.getAttribute('aria-pressed'), bg: c.backgroundColor, color: c.color,
            radius: c.borderRadius}; }, btnOf(k));
    const sel = (fill, font) => page.evaluate(([fill, font]) => {
        const rgb = h => h ? {get_auto: () => false, get_r: () => parseInt(h.slice(0, 2), 16), get_g: () => parseInt(h.slice(2, 4), 16), get_b: () => parseInt(h.slice(4), 16)}
            : {get_auto: () => true};
        api.fillColor = fill === null ? null : rgb(fill);
        api.fontColor = font ? rgb(font) : null;
        api.send('asc_onSelectionChanged', api.asc_getCellInfo());
    }, [fill, font]);
    let f = await look('fillColor');
    assert.deepEqual([f.on, f.aria], [false, 'false'], 'fill is pressed without a fill');
    /* A cell with a fill is pressed, with the look of a pressed "Bold". */
    await page.evaluate(() => { twins.btnBold.toggle(true); });
    await sel('d0e6f6', 'e11d48');
    await flush();
    const bold = await look('bold');
    f = await look('fillColor');
    assert.deepEqual([bold.on, bold.aria], [true, 'true'], 'precondition: pressed «B»');
    assert.deepEqual(f, bold, 'fill with a fill is not pressed as «B»');
    /* No fill - unpressed; with a fill again (white too) - pressed. */
    await sel('', null);
    assert.deepEqual([(await look('fillColor')).on, (await look('fillColor')).aria], [false, 'false'], 'fill stays pressed on a cell without fill');
    await sel('ffffff', null);
    assert.equal((await look('fillColor')).on, true, 'a white fill is a fill too');
    await sel(null, null);
    assert.equal((await look('fillColor')).on, false, 'fill stays pressed when the engine knows no fill');
    /* A click on a pressed one - "No fill" by the standard command, without a palette; the engine answers "no fill" - unpressed. A click on an unpressed one -
       the palette, without a command. */
    await sel('d0e6f6', null);
    await page.evaluate(() => { twins.btnBackColor.on('color:select', (b, c) => log.push('fill ' + c)); });
    await clear();
    await page.click(btnOf('fillColor'));
    assert.equal(await page.evaluate(s => document.querySelector(s).classList.contains('open'), ctrlSel('fillColor')), false, 'a click on the pressed fill opened the palette');
    assert.deepEqual((await state()).log, ['fill transparent'], 'a click on the pressed fill is not the stock «No fill»');
    assert.ok((await state()).notes.includes('edit:complete'), 'no fill by a click does not give the keyboard back to the sheet');
    await sel('', null);
    assert.deepEqual([(await look('fillColor')).on, (await look('fillColor')).aria], [false, 'false'], 'fill stays pressed after «No fill»');
    await clear();
    await page.click(btnOf('fillColor'));
    assert.equal(await page.evaluate(s => document.querySelector(s).classList.contains('open'), ctrlSel('fillColor')), true, 'a click on the unpressed fill did not open the palette');
    assert.deepEqual((await state()).log, [], 'a click on the unpressed fill ran a command');
    await page.keyboard.press('Escape');
    /* The format changed without a selection change (a command, undo) - the state follows the engine after the panel update. */
    await page.evaluate(() => { api.fillColor = {get_auto: () => false, get_r: () => 1, get_g: () => 2, get_b: () => 3}; SSE.Views.CompactToolbar.refresh(); });
    assert.equal((await look('fillColor')).on, true, 'fill does not follow a format change of the same selection');
});

/* Shared for the row button pressed state: the pressed look (class on, aria-pressed, the underlay and glyph color - like a pressed "Bold") and the engine
   selection (text color, number format, angle, sheet freeze). */
const pressLook = k => page.evaluate(sel => { const b = document.querySelector(sel); b.getAnimations().forEach(a => a.finish());
    const c = getComputedStyle(b); return {on: b.classList.contains('on'), aria: b.getAttribute('aria-pressed'), bg: c.backgroundColor, color: c.color,
        radius: c.borderRadius}; }, btnOf(k));
const pressedOf = keys => page.evaluate(ks => Object.fromEntries(ks.map(k => {
    const b = document.querySelector('#vo-tb [data-ctrl="' + k + '"] > button, #vo-tb button[data-ctrl="' + k + '"]');
    /* With state - a toggle (aria-pressed) or a list button that the catalog presses (on, press, pressOnColor,
       "Borders" by the engine): its pressed state is only by look. */
    const c = SSE.Views.CompactToolbar.ctrl[k], it = (c && c.it) || {};
    const stateful = b.hasAttribute('aria-pressed') || !!(it.on || it.press || it.pressOnColor || it.engine === 'borders');
    return [k, b.classList.contains('on') ? 'on' : (stateful ? 'off' : 'none')];
})), keys);
/* A pressed list button - the look of a pressed "Bold", without aria-pressed. */
const listLook = bold => Object.assign({}, bold, {aria: null});
const engineSel = o => page.evaluate(o => {
    const rgb = h => h ? {get_auto: () => false, get_r: () => parseInt(h.slice(0, 2), 16), get_g: () => parseInt(h.slice(2, 4), 16), get_b: () => parseInt(h.slice(4), 16)}
        : {get_auto: () => true};
    if ('font' in o) api.fontColor = o.font === null ? null : rgb(o.font);
    if ('fill' in o) api.fillColor = o.fill === null ? null : rgb(o.fill);
    if ('num' in o) api.numType = o.num === null ? null : Asc.c_oAscNumFormatType[o.num];
    if ('angle' in o) api.angle = o.angle;
    api.send('asc_onSelectionChanged', api.asc_getCellInfo());
}, o);
const boldLook = async () => {
    await page.evaluate(() => { twins.btnBold.toggle(true, true); SSE.Views.CompactToolbar.refresh(); });
    const b = await pressLook('bold');
    await page.evaluate(() => { twins.btnBold.toggle(false, true); SSE.Views.CompactToolbar.refresh(); });
    assert.deepEqual([b.on, b.aria], [true, 'true'], 'precondition: pressed «B»');
    return b;
};

/* Text color is pressed while the selection text has a color: not "Auto" and not black (000000 is the default workbook text color: Excel
   workbooks record it as an explicit black, otherwise the button would be pressed almost everywhere), - with the same look and aria-pressed as "Bold". A click on
   a pressed one removes the color - "Auto" by the standard command (auto:select), like a second click on "Bold"; the palette does not open. A click on
   an unpressed one - the palette. Arrow down from the keyboard on a pressed one - the palette (the change color path in one move), Enter - remove. The negative
   control is the code before the edit: text color is not pressed, a click on a colored one - the palette. */
test('text_color_pressed_while_the_text_has_a_color', async () => {
    await fresh({}, 2000, true);
    await page.evaluate(() => {
        twins.btnTextColor.on('color:select', (b, c) => log.push('text color ' + c));
        twins.btnTextColor.on('auto:select', () => log.push('text auto'));
    });
    const bold = await boldLook();
    await engineSel({font: null});
    assert.deepEqual(await pressedOf(['textColor']), {textColor: 'off'}, 'text color is pressed when the engine knows no color');
    await engineSel({font: ''});
    assert.deepEqual(await pressedOf(['textColor']), {textColor: 'off'}, 'text color is pressed on «Auto»');
    await engineSel({font: '000000'});
    assert.deepEqual(await pressedOf(['textColor']), {textColor: 'off'}, 'black text counts as colored');
    await engineSel({font: 'e11d48'});
    assert.deepEqual(await pressLook('textColor'), bold, 'colored text is not pressed as «B»');
    /* The format changed without a selection change - it follows the engine. */
    await page.evaluate(() => { api.fontColor = {get_auto: () => true}; SSE.Views.CompactToolbar.refresh(); });
    assert.deepEqual(await pressedOf(['textColor']), {textColor: 'off'}, 'text color does not follow a format change of the same selection');
    await engineSel({font: '2563eb'});
    await clear();
    await page.click(btnOf('textColor'));
    let s = await state();
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel('textColor')), false, 'a click on the pressed text color opened the palette');
    assert.deepEqual(s.log, ['text auto'], 'a click on the pressed text color is not the stock «Auto»');
    assert.ok(s.notes.includes('edit:complete'), '«Auto» by a click does not give the keyboard back to the sheet');
    await engineSel({font: ''});
    assert.deepEqual(await pressedOf(['textColor']), {textColor: 'off'}, 'text color stays pressed after «Auto»');
    await clear();
    await page.click(btnOf('textColor'));
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel('textColor')), true, 'a click on the unpressed text color did not open the palette');
    assert.deepEqual((await state()).log, [], 'a click on the unpressed text color ran a command');
    await page.click(ctrlSel('textColor') + ' .vo-pal-item[data-color="e11d48"]');
    assert.deepEqual((await state()).log, ['text color E11D48'], 'a swatch is not the stock color command');
    /* Keyboard: on a pressed one arrow down is the palette without a command, Enter is "Auto". */
    await engineSel({font: 'e11d48'});
    await clear();
    await page.focus(btnOf('textColor'));
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel('textColor')), true, 'ArrowDown on the pressed text color did not open the palette');
    assert.deepEqual((await state()).log, [], 'ArrowDown on the pressed text color ran a command');
    await page.keyboard.press('Escape');
    await flush();
    await page.focus(btnOf('textColor'));
    await clear();
    await page.keyboard.press('Enter');
    assert.deepEqual((await state()).log, ['text auto'], 'Enter on the pressed text color is not «Auto»');
});

/* ₽ is pressed while the selection format is currency or accounting (₽ sets accounting - the stock "Currency" style), % - while it is percent;
   "123" - while the format is not "General": the list button is pressed when something other than the default is selected in it. The look is as for "Bold"; aria-pressed is on ₽ and %, "123" does not have it: it is a
   list button. A click on a
   pressed ₽ or % removes the format - "General" by the same standard format list row as "General" in "123" (the item by value General),
   not the standard ₽ / % click; on an unpressed one - the standard click. A click on a pressed "123" - the list, as it was. The negative control is
   the code before the edit: none is pressed, a repeated ₽ sets accounting again. */
test('currency_percent_and_number_format_pressed_and_toggle_off', async () => {
    await fresh({}, 2000, true);
    const bold = await boldLook();
    const keys = ['currency', 'percent', 'numfmt'];
    await engineSel({num: 'General'});
    assert.deepEqual(await pressedOf(keys), {currency: 'off', percent: 'off', numfmt: 'off'}, 'a number button is pressed on «General»');
    await engineSel({num: null});
    assert.deepEqual(await pressedOf(keys), {currency: 'off', percent: 'off', numfmt: 'off'}, 'a number button is pressed when the engine knows no format');
    await engineSel({num: 'Accounting'});
    assert.deepEqual(await pressedOf(keys), {currency: 'on', percent: 'off', numfmt: 'on'}, 'accounting: ₽ and 123');
    assert.deepEqual(await pressLook('currency'), bold, 'pressed ₽ is not pressed as «B»');
    assert.deepEqual(await pressLook('numfmt'), listLook(bold), 'pressed 123 is not pressed as «B» without aria-pressed');
    await engineSel({num: 'Currency'});
    assert.deepEqual(await pressedOf(keys), {currency: 'on', percent: 'off', numfmt: 'on'}, 'currency: ₽ and 123');
    await engineSel({num: 'Percent'});
    assert.deepEqual(await pressedOf(keys), {currency: 'off', percent: 'on', numfmt: 'on'}, 'percent: % and 123');
    for (const t of ['Number', 'Date', 'Text', 'Custom']) {
        await engineSel({num: t});
        assert.deepEqual(await pressedOf(keys), {currency: 'off', percent: 'off', numfmt: 'on'}, t + ': only 123');
    }
    /* A repeated click: a pressed one - "General" by the standard row; an unpressed one - the standard click. */
    for (const [k, type, ref] of [['currency', 'Accounting', 'Toolbar:btnCurrencyStyle'], ['currency', 'Currency', 'Toolbar:btnCurrencyStyle'],
        ['percent', 'Percent', 'Toolbar:btnPercentStyle']]) {
        await engineSel({num: type});
        await clear();
        await page.click(btnOf(k));
        const s = await state();
        assert.deepEqual(s.log.filter(l => !/^prepare /.test(l)), ['pick numFormat General'], k + ' on ' + type + ': a click on the pressed button is not «General»');
        await engineSel({num: 'General'});
        await clear();
        await page.click(btnOf(k));
        assert.deepEqual((await state()).log, ['click ' + ref], k + ': a click on the unpressed button is not the stock click');
    }
    /* % on currency - not pressed: a click sets percent the standard way, not "General". */
    await engineSel({num: 'Currency'});
    await clear();
    await page.click(btnOf('percent'));
    assert.deepEqual((await state()).log, ['click Toolbar:btnPercentStyle'], '% on a currency cell is not the stock percent');
    /* "123" pressed - a click opens the list, no command. */
    await engineSel({num: 'Number'});
    await clear();
    await page.click(btnOf('numfmt'));
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel('numfmt')), true, 'a click on the pressed 123 did not open its list');
    assert.deepEqual((await state()).log.filter(l => !/^prepare /.test(l)), [], 'a click on the pressed 123 ran a command');
    await page.keyboard.press('Escape');
    /* A disabled double: ₽ is disabled - a click goes neither the standard way nor as "General". */
    await engineSel({num: 'Accounting'});
    await page.evaluate(() => { twins.btnCurrencyStyle.setDisabled(true); SSE.Views.CompactToolbar.refresh(); });
    await clear();
    await page.evaluate(sel => document.querySelector(sel).click(), btnOf('currency'));
    assert.deepEqual((await state()).log.filter(l => !/^prepare /.test(l)), [], 'a disabled ₽ ran a command');
});

/* Alignment twins: h - the pressed "horizontal" button (null - the stock "normal": none), v - "vertical". */
const alignTwins = (h, v) => page.evaluate(([h, v]) => {
    ['btnAlignLeft', 'btnAlignCenter', 'btnAlignRight', 'btnAlignJust'].forEach(n => twins[n].toggle(n === h, true));
    ['btnAlignTop', 'btnAlignMiddle', 'btnAlignBottom'].forEach(n => twins[n].toggle(n === v, true));
}, [h, v]);

/* "Horizontal" is pressed for center, right and justify (the pressed button of the stock group); for left and "normal" (none
   is pressed) - not pressed. "Vertical" - for top or middle (for bottom - the sheet default). The look is as for "Bold",
   without aria-pressed: these are list buttons. A click on a pressed one - the list, as it was: they are turned off by a list row - "Align left" and
   "Align bottom". The negative control is the code before the edit: alignment is not pressed; "left" and "bottom" are pressed. */
test('align_pressed_while_set', async () => {
    await fresh({}, 2000, true);
    const bold = await boldLook();
    const keys = ['halign', 'valign'];
    await alignTwins(null, 'btnAlignBottom');
    await engineSel({});
    assert.deepEqual(await pressedOf(keys), {halign: 'off', valign: 'off'}, 'alignment is pressed on «general» and bottom');
    await alignTwins('btnAlignLeft', 'btnAlignTop');
    await engineSel({});
    assert.deepEqual(await pressedOf(keys), {halign: 'off', valign: 'on'}, 'left is pressed or top is not');
    assert.deepEqual(await pressLook('valign'), listLook(bold), 'valign is not pressed as «B» without aria-pressed');
    for (const [h, v] of [['btnAlignCenter', 'btnAlignMiddle'], ['btnAlignRight', 'btnAlignBottom'], ['btnAlignJust', 'btnAlignBottom']]) {
        await alignTwins(h, v);
        await engineSel({});
        assert.deepEqual(await pressedOf(keys), {halign: 'on', valign: v === 'btnAlignBottom' ? 'off' : 'on'}, h + ' / ' + v);
    }
    await alignTwins(null, 'btnAlignBottom');
    await engineSel({});
    assert.deepEqual(await pressedOf(keys), {halign: 'off', valign: 'off'}, 'alignment stays pressed after it is gone');
    await alignTwins('btnAlignCenter', 'btnAlignTop');
    await engineSel({});
    await clear();
    await page.click(btnOf('valign'));
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel('valign')), true, 'a click on the pressed vertical align did not open its list');
    assert.deepEqual((await state()).log, [], 'a click on the pressed vertical align ran a command');
    await page.keyboard.press('Escape');
    assert.deepEqual(await pressLook('halign'), listLook(bold), 'halign is not pressed as «B» without aria-pressed');
    /* It is turned off by the "Align left" row: a standard left button click; the engine answers "left" - unpressed. */
    await clear();
    await page.click(btnOf('halign'));
    await clickRow('halign', await page.evaluate(() => SSE.Views.CompactToolbar.textAlignLeft));
    assert.deepEqual((await state()).log, ['click Toolbar:btnAlignLeft'], '«Align left» is not the stock click of the left button');
    await alignTwins('btnAlignLeft', 'btnAlignTop');
    await engineSel({});
    assert.deepEqual(await pressedOf(['halign']), {halign: 'off'}, 'halign stays pressed after «Align left»');
});

/* "Wrap" is pressed while the text wraps, "Merge" while the cells are merged: the pressed state of the standard buttons (the stock presses them by
   selection). The look is as for "Bold", without aria-pressed: these are list buttons. A click on a pressed one - the list, as it was: they are turned off by the rows
   "Do not wrap" and "Unmerge
   cells". The negative control is the code before the edit: wrap and merge are not pressed. */
test('wrap_and_merge_pressed_while_on', async () => {
    await fresh({}, 2000, true);
    const bold = await boldLook();
    const keys = ['wrap', 'merge'];
    await engineSel({});
    assert.deepEqual(await pressedOf(keys), {wrap: 'off', merge: 'off'}, 'wrap or merge is pressed while off');
    await page.evaluate(() => { twins.btnWrap.toggle(true, true); twins.btnMerge.toggle(true, true); });
    await engineSel({});
    assert.deepEqual(await pressedOf(keys), {wrap: 'on', merge: 'on'}, 'wrap and merge are not pressed while on');
    for (const k of keys) assert.deepEqual(await pressLook(k), listLook(bold), k + ' is not pressed as «B» without aria-pressed');
    await clear();
    await page.click(btnOf('wrap'));
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel('wrap')), true, 'a click on the pressed wrap did not open its list');
    assert.deepEqual((await state()).log, [], 'a click on the pressed wrap ran a command');
    assert.deepEqual((await listRows('wrap')).map(r => r.on), [true, false], 'the wrap list does not mark «Wrap»');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { twins.btnWrap.toggle(false, true); twins.btnMerge.toggle(false, true); });
    await engineSel({});
    assert.deepEqual(await pressedOf(keys), {wrap: 'off', merge: 'off'}, 'wrap or merge stays pressed after it is off');
});

/* "Rotation" is pressed while the text is rotated - the engine angle is not 0 (±45, ±90, 255 - vertical); horizontal - unpressed. It follows
   the engine without a selection change too. The negative control is the code before the edit: rotation is not pressed. */
test('rotation_pressed_while_rotated', async () => {
    await fresh({}, 2000, true);
    const bold = await boldLook();
    await engineSel({angle: 0});
    assert.deepEqual(await pressedOf(['rotate']), {rotate: 'off'}, 'rotation is pressed on horizontal text');
    for (const a of [45, -45, 90, -90, 255]) {
        await engineSel({angle: a});
        assert.deepEqual(await pressedOf(['rotate']), {rotate: 'on'}, 'angle ' + a);
    }
    assert.deepEqual(await pressLook('rotate'), listLook(bold), 'rotation is not pressed as «B» without aria-pressed');
    await page.evaluate(() => { api.angle = 0; SSE.Views.CompactToolbar.refresh(); });
    assert.deepEqual(await pressedOf(['rotate']), {rotate: 'off'}, 'rotation does not follow a format change of the same selection');
});

/* "Freeze panes" is pressed while the sheet has frozen panes (the sheet view settings): by the callback of their change and by a sheet change, without a
   selection change. "Borders" is pressed by the engine when the cell has a border; conditional formatting shows no pressed state -
   the engine does not give the rules by selection.
   The negative control is the code before the edit: freeze is not pressed; without a subscription to the sheet view - it does not follow it. */
test('freeze_pressed_while_the_sheet_has_frozen_panes', async () => {
    await fresh({}, 2000, true);
    const bold = await boldLook();
    await engineSel({});
    assert.deepEqual(await pressedOf(['freeze', 'borders', 'condfmt']), {freeze: 'off', borders: 'off', condfmt: 'none'}, 'freeze is pressed without frozen panes');
    await page.evaluate(() => { api.frozen = true; api.send('asc_onUpdateSheetViewSettings'); });
    assert.deepEqual(await pressedOf(['freeze']), {freeze: 'on'}, 'freeze does not follow the sheet view settings');
    assert.deepEqual(await pressLook('freeze'), listLook(bold), 'freeze is not pressed as «B» without aria-pressed');
    await page.evaluate(() => { api.frozen = false; api.send('asc_onSheetsChanged'); });
    assert.deepEqual(await pressedOf(['freeze']), {freeze: 'off'}, 'freeze does not follow another sheet');
    await page.evaluate(() => { api.frozen = true; });
    await engineSel({});
    assert.deepEqual(await pressedOf(['freeze', 'borders', 'condfmt']), {freeze: 'on', borders: 'off', condfmt: 'none'}, 'conditional formatting got a pressed state, or borders lost theirs');
});

/* The pressed state is visible on a button in "⋯" too: the same node, the same pressed look as "Bold" in the row; it follows the selection even with "⋯" open. */
test('pressed_in_overflow', async () => {
    await fresh({}, 1000, true);
    await relayout();
    const bold = await boldLook();
    await page.click('#vo-tb .vo-more');
    const gone = await page.evaluate(() => ['textColor', 'fillColor', 'halign', 'wrap', 'merge', 'rotate', 'freeze']
        .filter(k => !!document.querySelector('#vo-tb .vo-of-pop [data-ctrl="' + k + '"]')));
    assert.ok(gone.length >= 4, 'precondition: lists are in «⋯» at 1000: ' + JSON.stringify(gone));
    await page.evaluate(() => { twins.btnAlignCenter.toggle(true, true); twins.btnWrap.toggle(true, true); twins.btnMerge.toggle(true, true); api.frozen = true; });
    await engineSel({angle: 90, font: 'e11d48', fill: 'd0e6f6'});
    assert.equal(await page.evaluate(() => document.getElementById('vo-tb').classList.contains('vo-of-open')), true, 'precondition: «⋯» is open');
    for (const k of gone) {
        const l = await pressLook(k);
        assert.deepEqual([l.on, l.aria], [true, k === 'textColor' || k === 'fillColor' ? 'true' : null], k + ' in «⋯» is not pressed');
        assert.deepEqual([l.bg, l.color], [bold.bg, bold.color], k + ' in «⋯» is not pressed as «B»');
    }
});

/* A panel update without an engine answer (double observers, undo, zoom) asks the engine for the selection once: font,
   colors and the pressed state read one answer. The negative control is the code before the edit: a call per reader (font, text
   color, fill, pressed state). */
test('refresh_asks_the_engine_for_the_selection_once', async () => {
    await fresh({}, 2000, true);
    await engineSel({font: 'e11d48', fill: 'd0e6f6', num: 'Currency', angle: 45});
    const n = await page.evaluate(() => {
        const get = api.asc_getCellInfo; let calls = 0;
        api.asc_getCellInfo = function () { calls++; return get.apply(this, arguments); };
        try { SSE.Views.CompactToolbar.refresh(); } finally { api.asc_getCellInfo = get; }
        return calls;
    });
    assert.equal(n, 1, 'one toolbar refresh asked the engine for the selection ' + n + ' times');
    const on = k => page.evaluate(sel => document.querySelector(sel).classList.contains('on'), btnOf(k));
    for (const k of ['textColor', 'fillColor', 'currency', 'numfmt', 'rotate']) assert.equal(await on(k), true, k + ' is not pressed after the refresh');
});

/* The "123" list is as in Google Sheets: the rows of the standard format list (captions, a checkmark on the current one, a choice is the standard item; the list
   is prepared the standard way, show:before), arranged into Google groups through a separator: general and text · number, percent, scientific,
   fraction · accounting, currency · date and time · "More formats". The example on the right comes from the engine (asc_getLocaleExample) in the
   document locale on one sample: the number 1000,12, the percent 0,1012, the date and time - 26.09.2008 15:59:00 (39717,665972…); general,
   text and "More formats" have no example; the stock example (the active cell value) is not shown. The example is the second line
   under the name, smaller (the menu row item description font size, 11), without a column of its own: a row with an example is taller than a one-line row (in the
   editor 52 and 36; the test page has another text line height), the selected checkmark is at the right edge, in the same
   place for all rows, and at the row center. The negative control is the former
   value list "General ▾" (the stock order and examples) and the example as a column on the right. */
test('number_format_list_as_google', async () => {
    await fresh();
    await page.evaluate(BUILD);
    assert.equal(await page.evaluate(sel => !!document.querySelector(sel + ' .vo-value-label'), ctrlSel('numfmt')), false,
        'the number format still shows a label');
    await page.evaluate(() => { twins.cmbNumberFormat.raw = 'Currency'; api.send('asc_onSelectionChanged', api.asc_getCellInfo()); });
    await clear();
    await page.click(btnOf('numfmt'));
    const seq = await page.evaluate(sel => [...document.querySelectorAll(sel + ' > .vo-pop > *')].map(n => n.classList.contains('vo-pop-sep') ? '—' :
        n.querySelector('.vo-pop-t').textContent), ctrlSel('numfmt'));
    assert.deepEqual(seq, ['General', 'Text', '—', 'Number', 'Percentage', 'Scientific', 'Fraction', '—', 'Accounting', 'Currency', '—',
        'Short date', 'Long date', 'Time', '—', 'More formats'], 'the format groups are not those of Google Sheets');
    const D = String(39717 + (15 * 60 + 59) / 1440);
    const ex = (f, v) => f + ' @ ' + v + ' / 1049';
    const rows = await listRows('numfmt');
    assert.deepEqual(rows.map(r => [r.t, r.ex, r.on]), [['General', '', false], ['Text', '', false],
        ['Number', ex('0.00', 1000.12), false], ['Percentage', ex('0.00%', 0.1012), false], ['Scientific', ex('0.00E+00', 1000.12), false],
        ['Fraction', ex('# ?/?', 1000.12), false], ['Accounting', ex('ACC', 1000.12), false], ['Currency', ex('CUR', 1000.12), true],
        ['Short date', ex('dd/mm/yyyy', D), false], ['Long date', ex('d mmmm yyyy', D), false], ['Time', ex('h:mm:ss', D), false],
        ['More formats', '', false]], 'examples on one sample in the document locale, the current format checked');
    assert.ok((await state()).log.includes('prepare numFormat'), 'the stock list was prepared (show:before)');
    assert.equal(await page.evaluate(sel => document.querySelector(sel + ' > .vo-pop').getAttribute('role'), ctrlSel('numfmt')), 'menu');
    const geo = await page.evaluate(sel => {
        const pop = document.querySelector(sel + ' > .vo-pop');
        return {stack: pop.classList.contains('vo-pop-stack'), wide: pop.classList.contains('vo-pop-wide'),
            rows: [...pop.querySelectorAll(':scope > .vo-pop-item')].map(r => {
                const t = r.querySelector('.vo-pop-t').getBoundingClientRect(), e = r.querySelector('.vo-pop-ex'), b = r.getBoundingClientRect();
                const c = r.querySelector('.vo-pop-check').getBoundingClientRect(), x = e && e.getBoundingClientRect();
                return {two: !!e, under: !!x && x.top >= t.bottom - 0.5 && Math.abs(x.left - t.left) < 0.5 && x.right <= c.left,
                    inCol: !!e && e.parentNode.classList.contains('vo-pop-tc'), fs: e ? getComputedStyle(e).fontSize : null,
                    right: Math.round(b.right - c.right), mid: Math.round((c.top + c.height / 2) - (b.top + b.height / 2)), h: Math.round(b.height)};
            })};
    }, ctrlSel('numfmt'));
    assert.deepEqual([geo.stack, geo.wide], [true, false], 'the number format list is not the stacked list: ' + JSON.stringify(geo));
    const two = geo.rows.filter(r => r.two), one = geo.rows.filter(r => !r.two);
    assert.deepEqual([two.length, one.length], [9, 3], 'rows with and without an example');
    assert.deepEqual([...new Set(two.map(r => [r.under, r.inCol, r.fs].join(' ')))], ['true true 11px'],
        'the example is not a second line under the name: ' + JSON.stringify(two));
    /* A row without an example has the same height as the rows of the other lists (the row min-height), with an example - taller by a text line. */
    const oneH = [...new Set(one.map(r => r.h))], twoH = [...new Set(two.map(r => r.h))];
    assert.ok(oneH.length === 1 && oneH[0] >= 35 && oneH[0] <= 38, 'a row without an example is not one line: ' + oneH);
    assert.ok(twoH.length === 1 && twoH[0] >= oneH[0] + 8, 'a row with an example is not two lines tall: ' + twoH + ' vs ' + oneH);
    const at = [...new Set(geo.rows.map(r => r.right + ',' + r.mid))];
    assert.ok(at.length === 1 && /^1[78],0$/.test(at[0]), 'the check is not at the right edge in the middle of the row: ' + at);
    await clear();
    await clickRow('numfmt', 'Percentage');
    assert.deepEqual((await state()).log, ['pick numFormat Percentage'], 'the stock item click');
    await page.click(btnOf('numfmt'));
    await clear();
    await clickRow('numfmt', 'More formats');
    assert.deepEqual((await state()).log, ['pick numFormat More formats'], '«More formats» is the stock item');
    /* Font is a name in the engine: the standard list sets its own caption with a delay of 100 ms. */
    const font = () => page.textContent(ctrlSel('font') + ' .vo-value-label');
    assert.equal(await font(), 'Calibri', 'without an engine name — the stock combo text');
    await page.evaluate(() => { api.fontName = 'Cambria'; api.send('asc_onSelectionChanged', api.asc_getCellInfo()); });
    assert.equal(await font(), 'Cambria', 'font label from the engine at once');
});

test('size_field_decimal_through_stock', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const input = ctrlSel('size') + ' input';
    assert.equal(await page.inputValue(input), '11');
    await clear();
    await page.click(input);
    await page.fill(input, '10,5');
    await page.press(input, 'Enter');
    let s = await state();
    assert.deepEqual(s.calls.filter(c => /asc_setCellFontSize/.test(c)), ['asc_setCellFontSize 10.5'], 'decimal comma parsed by the stock');
    assert.ok(s.calls.includes('keys false') && s.calls[s.calls.length - 1] === 'keys true', 'keyboard back to the sheet: ' + s.calls);
    assert.equal(await page.inputValue(input), '10.5', 'field shows the stock value');
    await clear();
    await page.click(input);
    await page.fill(input, 'abc');
    await page.press(input, 'Enter');
    await flush();
    s = await state();
    assert.deepEqual(s.calls.filter(c => /asc_setCellFontSize/.test(c)), [], 'invalid size reached the engine');
    assert.ok(s.log.includes('warning'), 'the stock warning was not shown');
    assert.equal(await page.inputValue(input), '11', 'field restored after the stock refused');
});

/* Font size is as in Documents (sizeBox): the field and the chevron in one value list box of width 72 (@vo-w-size of Documents), without
   "−" and "+"; the field is a combobox with the size list of the standard font size list. The chevron opens the list, the current size is checked and under
   the keyboard cursor (aria-activedescendant); a row is the standard 'selected' (the stock onFontSizeSelect: asc_setCellFontSize), focus goes to
   the sheet, the list is closed, the field shows the selected value, and what was typed before the choice is not applied. ↓ in the field opens the list, ↓ - the next
   row, Enter - its size; Escape removes the list, focus stays in the field. The field value follows the selected cell; a font size
   disabled by the stock disables the field and the chevron. The negative control is the former font size `− 11 +`. */
test('size_box_list_as_documents', async () => {
    await fresh({}, 2000, true);
    const sel = ctrlSel('size'), input = sel + ' input', caret = sel + ' .vo-size-caret';
    const look = await page.evaluate(s => {
        const w = document.querySelector(s), i = w.querySelector('input'), c = w.querySelector('.vo-size-caret');
        return {cls: w.className, w: w.querySelector('.vo-size-box').getBoundingClientRect().width, buttons: w.querySelectorAll('button:not(.vo-pop-item)').length,
            role: i.getAttribute('role'), controls: i.getAttribute('aria-controls'), list: (w.querySelector('.vo-pop') || {}).id,
            caretTab: c && c.getAttribute('tabindex'), caretLabel: c && c.getAttribute('aria-label')};
    }, sel);
    assert.ok(/\bvo-value\b/.test(look.cls) && /\bvo-size\b/.test(look.cls), 'the font size is not a value box: ' + look.cls);
    assert.equal(look.w, 72, 'the font size box is not 72 wide as in documents');
    assert.equal(look.buttons, 1, 'the font size has buttons besides its chevron (− or +)');
    assert.deepEqual([look.role, look.controls === look.list, look.caretTab, look.caretLabel], ['combobox', true, '-1', 'Font size'],
        'the field is not a combobox of its list or the chevron is a Tab stop: ' + JSON.stringify(look));
    const rows = () => page.evaluate(s => [...document.querySelectorAll(s + ' > .vo-pop > .vo-pop-item')].map(r => ({t: r.textContent.trim(),
        on: r.classList.contains('on'), hi: r.classList.contains('hi'), id: r.id, role: r.getAttribute('role')})), sel);
    const open = () => page.evaluate(s => document.querySelector(s).classList.contains('open'), sel);
    /* The chevron: the list of standard sizes, the current one is checked and under the cursor. */
    await page.click(caret);
    let r = await rows();
    assert.equal(await open(), true, 'the chevron did not open the list');
    assert.deepEqual(r.map(x => x.t), ['8', '9', '10', '11', '12', '14', '16', '18', '20', '22', '24', '26', '28', '36', '48', '72', '96'],
        'the list is not the stock font size list');
    assert.deepEqual(r.filter(x => x.on).map(x => x.t), ['11'], 'the current size is not checked');
    assert.ok(r.every(x => x.role === 'option'), 'list rows are not options');
    assert.equal(await page.getAttribute(input, 'aria-activedescendant'), r.find(x => x.t === '11').id, 'the keyboard cursor is not on the current size');
    assert.equal(await page.evaluate(s => document.activeElement === document.querySelector(s), input), true, 'the chevron did not focus the field');
    /* What was typed before choosing a row is not applied: the chosen one is applied. */
    await page.keyboard.type('1');
    await clear();
    await clickRow('size', '14');
    let s = await state();
    assert.deepEqual(s.calls.filter(c => /asc_setCellFontSize/.test(c)), ['asc_setCellFontSize 14'], 'a list row is not one stock font size select');
    assert.ok(s.notes.includes('edit:complete'), 'focus back to the sheet after the pick');
    assert.equal(await open(), false, 'the list stays open after the pick');
    assert.equal(await page.inputValue(input), '14', 'the field does not show the picked size');
    /* The value follows the selected cell. */
    await page.evaluate(() => { twins.cmbFontSize.raw = '18'; api.send('asc_onSelectionChanged', api.asc_getCellInfo()); });
    await flush();
    assert.equal(await page.inputValue(input), '18', 'the field does not follow the selected cell');
    /* Keyboard: ↓ opens the list on the current one, ↓ - the next, Enter - its size. */
    await page.focus(input);
    await page.keyboard.press('ArrowDown');
    r = await rows();
    assert.equal(await open(), true, 'ArrowDown in the field did not open the list');
    assert.deepEqual(r.filter(x => x.hi).map(x => x.t), ['18'], 'ArrowDown did not put the cursor on the current size');
    await page.keyboard.press('ArrowDown');
    assert.deepEqual((await rows()).filter(x => x.hi).map(x => x.t), ['20'], 'ArrowDown in the list did not move to the next size');
    await clear();
    await page.keyboard.press('Enter');
    assert.deepEqual((await state()).calls.filter(c => /asc_setCellFontSize/.test(c)), ['asc_setCellFontSize 20'], 'Enter did not pick the size under the cursor');
    assert.equal(await open(), false);
    /* Escape: the list is closed, focus in the field; typing 14 + Enter - font size 14. */
    await page.focus(input);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    assert.equal(await open(), false, 'Escape left the list open');
    assert.equal(await page.evaluate(s => document.activeElement === document.querySelector(s), input), true, 'Escape took the focus from the field');
    await clear();
    await page.fill(input, '14');
    await page.keyboard.press('Enter');
    assert.deepEqual((await state()).calls.filter(c => /asc_setCellFontSize/.test(c)), ['asc_setCellFontSize 14'], 'typed 14 + Enter');
    /* A font size disabled by the stock: the field and the chevron are disabled, the list does not open. */
    await page.evaluate(() => { twins.cmbFontSize.disabled = true; api.send('asc_onSelectionChanged', api.asc_getCellInfo()); });
    await flush();
    assert.deepEqual(await page.evaluate(([i, c]) => [document.querySelector(i).disabled, document.querySelector(c).disabled], [input, caret]), [true, true],
        'the font size field or its chevron is live while the stock font size is locked');
    await page.evaluate(c => document.querySelector(c).click(), caret);
    assert.equal(await open(), false, 'the list opened while the stock font size is locked');
});

test('wrap_drop_sets_toggle_twin', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const T = (await page.evaluate(() => [SSE.Views.CompactToolbar.textWrap, SSE.Views.CompactToolbar.textNoWrap]));
    await page.click(btnOf('wrap'));
    assert.deepEqual((await listRows('wrap')).map(r => [r.t, r.on]), [[T[0], false], [T[1], true]]);
    await clear();
    await clickRow('wrap', T[1]);
    assert.deepEqual((await state()).log, [], '"no wrap" on an unwrapped cell pressed the stock toggle');
    await page.click(btnOf('wrap'));
    await clickRow('wrap', T[0]);
    assert.deepEqual((await state()).log, ['click Toolbar:btnWrap'], 'wrap: one stock toggle');
    assert.equal(await page.evaluate(() => twins.btnWrap.pressed), true);
    await clear();
    await page.click(btnOf('wrap'));
    assert.deepEqual((await listRows('wrap')).map(r => r.on), [true, false], 'checked from the stock toggle');
    await clickRow('wrap', T[0]);
    assert.deepEqual((await state()).log, [], 'wrap on a wrapped cell toggled it off');
    await page.click(btnOf('wrap'));
    await clickRow('wrap', T[1]);
    assert.deepEqual((await state()).log, ['click Toolbar:btnWrap']);
    assert.equal(await page.evaluate(() => twins.btnWrap.pressed), false);
});

/* "Horizontal": "Align left · Center · Align right" - three variants ("Justify" is in "Format → Alignment ▸").
   A justified cell (the standard "Justify" is pressed): the button glyph is "justify", the list has no checkmark; choosing a row is
   the standard button. "Justify" has no address on the panel (only in the menu, coverage.cjs). */
test('halign_three_choices_justified_glyph', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const T = await page.evaluate(() => ['textAlignLeft', 'textAlignCenter', 'textAlignRight', 'textAlignJust'].map(k => SSE.Views.CompactToolbar[k]));
    await page.click(btnOf('halign'));
    assert.deepEqual((await listRows('halign')).map(r => [r.t, r.on]), [[T[0], true], [T[1], false], [T[2], false]], 'the horizontal list is not the three choices');
    assert.ok(!(await listRows('halign')).some(r => r.t === T[3]), '«Justified» is still in the toolbar list');
    await page.evaluate(() => SSE.Views.CompactToolbar.closeSurfaces());
    await page.evaluate(() => { twins.btnAlignLeft.toggle(false, true); twins.btnAlignJust.toggle(true, true); });
    await flush();
    await page.evaluate(() => api.send('asc_onSelectionChanged', api.asc_getCellInfo()));
    await flush();
    const glyph = await page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="halign"] .vo-drop-i').innerHTML);
    assert.equal(glyph, await page.evaluate(() => Common.UI.Compact.Icons.svg('alignJ', 18)), 'a justified cell does not show the justified glyph');
    await page.click(btnOf('halign'));
    assert.deepEqual((await listRows('halign')).map(r => r.on), [false, false, false], 'a choice is checked for a justified cell');
    await clear();
    await clickRow('halign', T[1]);
    assert.deepEqual((await state()).log, ['click Toolbar:btnAlignCenter'], 'a row is not one stock click');
    const refs = await page.evaluate(() => SSE.Views.CompactToolbar.refs(SSE.Views.CompactToolbar.catalog().map(g => g.items).flat().find(i => i.k === 'halign')));
    assert.deepEqual(refs, ['Toolbar:btnAlignLeft', 'Toolbar:btnAlignCenter', 'Toolbar:btnAlignRight'], 'the justified twin gives the list its lock');
});

test('state_not_cached_by_shell', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const on = k => page.evaluate(sel => document.querySelector(sel).classList.contains('on'), btnOf(k));
    /* The pressed state comes from the double on each update, not from its own flag. */
    await page.evaluate(() => { twins.btnBold.pressed = true; api.send('asc_onSelectionChanged', api.asc_getCellInfo()); });
    assert.equal(await on('bold'), true, 'Bold from the stock twin');
    /* Our own "pressed" class decides nothing: a click is the standard double click(), and the pressed state
       is set by the stock itself. */
    await page.evaluate(sel => document.querySelector(sel).classList.remove('on'), btnOf('bold'));
    await clear();
    await page.click(btnOf('bold'));
    assert.deepEqual((await state()).log, ['click Toolbar:btnBold'], 'one stock click');
    assert.equal(await page.evaluate(() => twins.btnBold.pressed), false, 'the twin decided the state');
    await flush();
    assert.equal(await on('bold'), false, 'our button follows the twin');
    /* A double disabled by the stock disables the control without our event - the bridge observer. */
    await page.evaluate(() => { twins.btnBorders.setDisabled(true); twins.btnMerge.setDisabled(true); twins.cmbNumberFormat.setDisabled(true); });
    await flush();
    await page.evaluate(() => api.send('asc_onSelectionChanged', api.asc_getCellInfo()));
    const dis = await page.evaluate(() => ['borders', 'merge', 'numfmt'].map(k => document.querySelector('#vo-tb [data-ctrl="' + k + '"] > button').disabled));
    assert.deepEqual(dis, [true, true, true], 'stock-locked controls are dimmed, not hidden');
    assert.deepEqual(await keysOf(), ROW_ORDER, 'nothing disappears from the row');
    await clear();
    await page.evaluate(() => { const b = document.querySelector('#vo-tb [data-ctrl="borders"] > button'); b.disabled = false; b.click(); });
    assert.deepEqual((await state()).log.filter(l => /btnBorders/.test(l) && !/prepare/.test(l)), [], 'a dimmed twin runs nothing');
    /* The observer: the pressed state set by the stock on a node - without an engine callback. */
    await page.evaluate(() => twins.btnItalic.toggle(true, true));
    await flush();
    assert.equal(await on('italic'), true, 'pressed state from the twin node (MutationObserver)');
    /* The horizontal alignment glyph is the current value of the doubles. */
    await page.evaluate(() => { twins.btnAlignLeft.toggle(false, true); twins.btnAlignRight.toggle(true, true); });
    await flush();
    const glyph = await page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="halign"] .vo-drop-i').innerHTML);
    assert.equal(glyph, await page.evaluate(() => Common.UI.Compact.Icons.svg('alignR', 18)), 'align glyph shows the current alignment');
    /* Format painter: two clicks - the standard double click(), a double click - the standard
       dblclick handler on the double node ("sticky" mode). */
    await clear();
    await page.dblclick(btnOf('paint'));
    assert.deepEqual((await state()).log, ['click Toolbar:btnCopyStyle', 'click Toolbar:btnCopyStyle', 'dblclick Toolbar:btnCopyStyle'],
        'double click on the format painter goes to the stock dblclick');
});

/* The palette "Custom color" row is a block with the height of the line-height normal of its font (font size 13,
   the shell font), not the standard body line height (scaffolding.less: 11px Arial, 1.428571429 -
   18.57). The normal height depends on the machine font (the system stack: 16 at the former measurement, 15 with
   DejaVu Sans), so the reference is measured right here: a separate block with the same font and line-height
   normal outside the palette. The whole palette is paddings 10 + "Automatic" 36 + a separator 8 + 1 + 8 +
   padding 6 + a grid 6 × 18 + 5 × 4 + paddings 10 = 207 plus the row (223 with a row of 16). The stock body
   and its button font reset (scaffolding.less: line-height: inherit - through it the button would
   get the body line height) are put into the page. */
test('palette_custom_row_16', async () => {
    const POP_WITHOUT_ROW = 10 + 36 + 8 + 1 + 8 + 6 + (6 * 18 + 5 * 4) + 10;
    await fresh();
    await page.addStyleTag({content: 'body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.428571429; }\n' +
        'input, button, select, textarea { font-family: inherit; font-size: inherit; line-height: inherit; }'});
    await page.evaluate(BUILD);
    for (const k of ['textColor', 'fillColor']) {
        await page.click(btnOf(k));
        const r = await page.evaluate(async sel => {
            const p = document.querySelector(sel + ' .vo-cb-pop');
            await Promise.all(p.getAnimations().map(a => a.finished));
            const t = document.querySelector(sel + ' .vo-pal-toggle'), s = getComputedStyle(t);
            const ref = document.createElement('div');
            ref.textContent = t.textContent;
            ref.style.cssText = 'position:absolute;left:0;top:0;display:block;margin:0;padding:0;border:0;white-space:nowrap;line-height:normal';
            ref.style.fontFamily = s.fontFamily;
            ref.style.fontSize = s.fontSize;
            ref.style.fontWeight = s.fontWeight;
            document.body.appendChild(ref);
            const normal = ref.getBoundingClientRect().height;
            ref.remove();
            return {row: t.getBoundingClientRect().height, pop: p.getBoundingClientRect().height, lh: s.lineHeight, normal,
                fs: s.fontSize, own: s.fontFamily === getComputedStyle(p.querySelector('.vo-cb-reset')).fontFamily};
        }, ctrlSel(k));
        await page.click(btnOf(k));
        assert.deepEqual([r.fs, r.own], ['13px', true], k + ': «Свой цвет» is not in the shell font of 13px: ' + r.fs);
        assert.equal(r.row, r.normal, k + ': «Свой цвет» row is ' + r.row + ' (line-height ' + r.lh + '), expected the normal line ' + r.normal);
        assert.equal(r.pop, POP_WITHOUT_ROW + r.normal, k + ': palette is ' + r.pop + ' high, expected ' + (POP_WITHOUT_ROW + r.normal));
    }
});

test('color_select_forwarded', async () => {
    await fresh();
    await page.evaluate(BUILD);
    await page.evaluate(() => {
        twins.btnTextColor.on('color:select', (b, c) => log.push('text color ' + c));
        twins.btnTextColor.on('auto:select', () => log.push('text auto'));
        twins.btnBackColor.on('color:select', (b, c) => log.push('fill ' + c));
    });
    await page.click(btnOf('textColor'));
    assert.equal(await page.evaluate(() => document.querySelectorAll('#vo-tb [data-ctrl="textColor"] .vo-pal-item').length), 84, 'documents palette 6 × 14');
    await clear();
    await page.click(ctrlSel('textColor') + ' .vo-pal-item[data-color="e11d48"]');
    let s = await state();
    assert.deepEqual(s.log, ['text color E11D48'], 'color:select of the stock twin');
    assert.ok(s.notes.includes('edit:complete'));
    await page.click(btnOf('textColor'));
    await clear();
    await page.click(ctrlSel('textColor') + ' .vo-cb-reset');
    assert.deepEqual((await state()).log, ['text auto'], 'automatic — auto:select of the stock twin');
    await page.click(btnOf('fillColor'));
    await clear();
    await page.click(ctrlSel('fillColor') + ' .vo-cb-reset');
    assert.deepEqual((await state()).log, ['fill transparent'], 'no fill — color:select transparent');
    /* A custom color by code. */
    await page.click(btnOf('fillColor'));
    await page.click(ctrlSel('fillColor') + ' .vo-pal-toggle');
    await page.fill(ctrlSel('fillColor') + ' .vo-pal-input', '#1E40AF');
    await clear();
    await page.press(ctrlSel('fillColor') + ' .vo-pal-input', 'Enter');
    assert.deepEqual((await state()).log, ['fill 1E40AF']);
    /* The strip is the selection color from the engine. */
    await page.evaluate(() => {
        api.fontColor = {get_auto: () => false, get_r: () => 0x25, get_g: () => 0x63, get_b: () => 0xeb};
        api.fillColor = {get_auto: () => true};
        api.send('asc_onSelectionChanged', api.asc_getCellInfo());
    });
    const lines = await page.evaluate(() => ['textColor', 'fillColor'].map(k => document.querySelector('#vo-tb [data-ctrl="' + k + '"] .vo-cb-line').style.background));
    assert.equal(lines[0], 'rgb(37, 99, 235)', 'text line from the engine');
    /* No fill - a fallback color (`#fde68a`), not emptiness;
       both after "No fill" and for a cell where the engine does not know the fill. */
    assert.equal(lines[1], 'rgb(253, 230, 138)', 'fill line without fill');
    await page.evaluate(() => {
        api.fillColor = {get_auto: () => false, get_r: () => 0x1e, get_g: () => 0x40, get_b: () => 0xaf};
        api.send('asc_onSelectionChanged', api.asc_getCellInfo());
    });
    assert.equal(await page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="fillColor"] .vo-cb-line').style.background),
        'rgb(30, 64, 175)', 'fill line from the engine');
    await page.evaluate(() => {
        api.fillColor = null;
        api.send('asc_onSelectionChanged', api.asc_getCellInfo());
    });
    assert.equal(await page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="fillColor"] .vo-cb-line').style.background),
        'rgb(253, 230, 138)', 'fill line when the engine knows no fill');
});

/* "Borders" is pressed by the engine, like "Bold" by the double: the cell has a border - at least one of the six sides of asc_getBorders() is not null
   and its style is not None (the standard button has no pressed state). There is no flag of its own - every update reads the engine anew; without an engine
   answer, on null and on a read failure - not pressed, and a failure does not interrupt the update of the other controls. This is a list button: there is no aria-pressed,
   a click only opens the list. */
const BORDER_LOOK = () => page.evaluate(sel => {
    const b = document.querySelector(sel);
    return {on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed'), popup: b.getAttribute('aria-haspopup')};
}, btnOf('borders'));
const selectBorders = borders => page.evaluate(b => { api.borders = b; api.send('asc_onSelectionChanged', api.asc_getCellInfo()); }, borders);
const THIN = 7, NONE = 0;
const SIDES = (o = {}) => Object.assign({left: null, top: null, right: null, bottom: null, diagDown: null, diagUp: null}, o);

test('borders_pressed_when_the_cell_has_a_border', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const cases = [
        ['the engine reports no borders (null)', null, false],
        ['six sides are null', SIDES(), false],
        ['one side is thin', SIDES({bottom: THIN}), true],
        ['sides of style None', SIDES({left: NONE, top: NONE, right: NONE, bottom: NONE, diagDown: NONE, diagUp: NONE}), false],
        ['only the diagonal up', SIDES({diagUp: THIN}), true],
        ['only the diagonal down', SIDES({diagDown: THIN}), true],
        /* The next selection without borders: the pressed state is not held by its own flag. */
        ['the next selection reports null', null, false]
    ];
    for (const [what, borders, want] of cases) {
        await selectBorders(borders);
        const l = await BORDER_LOOK();
        assert.equal(l.on, want, what + ': «Borders» pressed is ' + l.on);
        assert.equal(l.pressed, null, what + ': a list button got aria-pressed ' + l.pressed);
        assert.equal(l.popup, 'menu', what + ': aria-haspopup is ' + l.popup);
    }
    /* The negative control of the probe: the same pressed state of "Bold" is visible by the class. */
    await page.evaluate(() => { twins.btnBold.pressed = true; api.send('asc_onSelectionChanged', api.asc_getCellInfo()); });
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('on'), btnOf('bold')), true, 'precondition: «Ж» is pressed');
});

test('borders_pressed_without_info_reads_the_engine_once', async () => {
    await fresh();
    await page.evaluate(BUILD);
    await page.evaluate(() => {
        window.cellInfoReads = 0;
        const own = api.asc_getCellInfo;
        api.asc_getCellInfo = function () { cellInfoReads++; return own.call(this); };
    });
    /* An update by a double observer - without an engine answer: borders from asc_getCellInfo(). */
    await page.evaluate(() => { api.borders = {left: 7, top: null, right: null, bottom: null, diagDown: null, diagUp: null}; window.cellInfoReads = 0; });
    await page.evaluate(() => twins.btnItalic.toggle(true, true));
    await flush();
    const r = await page.evaluate(() => ({reads: cellInfoReads, italic: document.querySelector('#vo-tb [data-ctrl="italic"]').classList.contains('on')}));
    assert.equal(r.italic, true, 'precondition: the twin observer refreshed the row');
    assert.ok(r.reads > 0, 'the refresh without info did not ask the engine');
    assert.equal((await BORDER_LOOK()).on, true, 'a refresh without info: borders not read from asc_getCellInfo()');
    /* The "Borders" control itself reads the engine once per update, with an engine answer - never. */
    const per = await page.evaluate(() => {
        const T = SSE.Views.CompactToolbar;
        cellInfoReads = 0; T.syncCtrl(T.ctrl.borders);
        const without = cellInfoReads;
        const info = api.asc_getCellInfo();
        cellInfoReads = 0; T.syncCtrl(T.ctrl.borders, info);
        return {without, withInfo: cellInfoReads};
    });
    assert.deepEqual(per, {without: 1, withInfo: 0}, 'asc_getCellInfo() calls of the borders control in one refresh');
});

test('borders_read_failure_does_not_stop_the_refresh', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const on = k => page.evaluate(sel => document.querySelector(sel).classList.contains('on'), btnOf(k));
    await selectBorders(SIDES({top: THIN}));
    assert.equal((await BORDER_LOOK()).on, true, 'precondition: pressed with a border');
    /* asc_getBorders throws: "Borders" is not pressed, "Bold" (before them in the row) and "Filter" (after) follow the doubles in the same update. */
    await page.evaluate(() => {
        api.throwBorders = true;
        twins.btnBold.pressed = true;
        twins.filter.pressed = true;
        api.send('asc_onSelectionChanged', api.asc_getCellInfo());
    });
    assert.equal((await BORDER_LOOK()).on, false, 'a failed read left «Borders» pressed');
    assert.deepEqual([await on('bold'), await on('filter')], [true, true], 'controls around «Borders» stopped following their twins');
    /* The engine gives no selection at all: without info asc_getCellInfo() throws - also not pressed, the row is updated. */
    await page.evaluate(() => { api.throwBorders = false; api.borders = {left: 7}; api.asc_getCellInfo = () => { throw new Error('no cell info'); }; });
    await page.evaluate(() => { twins.btnBold.pressed = false; SSE.Views.CompactToolbar.refresh(); });
    assert.equal((await BORDER_LOOK()).on, false, 'pressed without an answer of the engine');
    assert.equal(await on('bold'), false, '«Ж» stopped following its twin');
    /* An engine answer without asc_getBorders (a standard answer of the old kind) - not pressed. */
    await page.evaluate(() => api.send('asc_onSelectionChanged', {asc_getXfs: () => null}));
    assert.equal((await BORDER_LOOK()).on, false, 'pressed on an answer without borders');
});

test('pressed_borders_click_only_opens_the_list', async () => {
    await fresh();
    await page.evaluate(BUILD);
    await selectBorders(SIDES({bottom: THIN}));
    assert.equal((await BORDER_LOOK()).on, true, 'precondition: pressed');
    await clear();
    await page.click(btnOf('borders'));
    const r = await page.evaluate(sel => ({open: document.querySelector(sel).classList.contains('open'),
        expanded: document.querySelector(sel + ' > button').getAttribute('aria-expanded'),
        rows: document.querySelectorAll(sel + ' > .vo-pop > .vo-pop-item').length}), ctrlSel('borders'));
    assert.deepEqual(r, {open: true, expanded: 'true', rows: 3}, 'the list of the pressed «Borders» did not open');
    const s = await state();
    assert.deepEqual(s.log.filter(l => /btnBorders/.test(l) && !/^prepare /.test(l)), [], 'a click on the pressed button ran a stock command');
    assert.deepEqual(s.calls.filter(c => !/^keys /.test(c)), [], 'a click on the pressed button reached the engine');
    assert.equal((await BORDER_LOOK()).on, true, 'the click changed the pressed state');
    await page.click(btnOf('borders'));
});

/* The pressed look of "Borders" is the shared .vo-ib.on rule: the underlay and glyph color are the same as for a pressed "Bold"; ▾ is of the former muted
   color. An unpressed one is like the neighboring unpressed button. */
test('pressed_borders_look_like_pressed_bold', async () => {
    await fresh({}, 1280);
    await page.evaluate(BUILD);
    await relayout();
    await page.mouse.move(AWAY.x, AWAY.y);
    const look = () => page.evaluate(([b, d, wrap]) => new Promise(r => setTimeout(() => {
        const of = (sel, glyph) => {
            const btn = document.querySelector(sel), c = getComputedStyle(btn), g = btn.querySelector(glyph);
            return {bg: c.backgroundColor, color: c.color, glyph: g ? getComputedStyle(g).backgroundColor : null, radius: c.borderTopLeftRadius};
        };
        const caret = document.querySelector(wrap + ' > button > .vo-drop-c');
        r({bold: of(b, ':scope > .vo-air'), borders: of(d, ':scope > .vo-drop-i > .vo-air'), caret: caret ? getComputedStyle(caret).color : null,
           shown: document.querySelector(d).getClientRects().length > 0});
    }, 250)), [btnOf('bold'), btnOf('borders'), ctrlSel('borders')]);
    await selectBorders(null);
    const off = await look();
    assert.equal(off.shown, true, 'precondition: «Borders» is in the row at 1280');
    assert.ok(off.caret && off.caret !== off.borders.color, 'precondition: the ▾ has its own muted colour: ' + off.caret);
    assert.deepEqual([off.borders.bg, off.borders.color, off.borders.glyph], [off.bold.bg, off.bold.color, off.bold.glyph],
        'unpressed «Borders» differs from the unpressed «Ж»');
    await page.evaluate(() => { twins.btnBold.pressed = true; });
    await selectBorders(SIDES({left: THIN}));
    const on = await look();
    assert.notEqual(on.bold.bg, off.bold.bg, 'precondition: the pressed «Ж» has its own background');
    assert.deepEqual(on.borders, on.bold, 'pressed «Borders» differs from the pressed «Ж»');
    assert.equal(on.caret, off.caret, 'the ▾ of the pressed «Borders» changed its colour');
});

/* The rows of the "Borders" list have the standard item icons: the glyph is by the standard icon class (SheetActions.stockGlyph), rows without a
   glyph on the same level get an empty place of the same size, the captions are on one vertical. A level without glyphs (the "Border style" submenu)
   and the other panel mirrors have no icons and no place for them. */
test('borders_list_rows_have_the_stock_glyphs', async () => {
    await fresh({borderIcons: true});
    await page.evaluate(BUILD);
    /* The list opens with a scale animation: the sizes are after it. */
    const rowsOf = sel => page.evaluate(async s => {
        await Promise.all(document.getAnimations().map(a => a.finished));
        return [...document.querySelectorAll(s)].map(r => {
        const i = r.querySelector(':scope > .vo-pop-i'), a = i && i.querySelector('.vo-air');
        const m = a ? /\/img\/air\/([A-Za-z0-9]+)\.svg/.exec(String(getComputedStyle(a).webkitMaskImage || getComputedStyle(a).maskImage || '')) : null;
        const ib = i ? i.getBoundingClientRect() : null;
        return {t: r.querySelector('.vo-pop-t').textContent, glyph: i ? (m ? m[1] : (i.firstChild ? '?' : '')) : null,
                w: ib ? ib.width : 0, h: ib ? ib.height : 0, left: r.querySelector('.vo-pop-t').getBoundingClientRect().left};
        });
    }, sel);
    await page.click(btnOf('borders'));
    const rows = await rowsOf(ctrlSel('borders') + ' > .vo-pop > .vo-pop-item');
    assert.deepEqual(rows.map(r => [r.t, r.glyph]), [
        ['Bottom borders', 'borderBottom'], ['Top borders', 'borderTop'], ['Left borders', 'borderLeft'], ['Right borders', 'borderRight'],
        ['No borders', 'borderNone'], ['All borders', 'borderAll'], ['Outside borders', 'borderOuter'], ['Inside borders', 'borderInner'],
        ['Inside horizontal borders', 'borderInnerH'], ['Inside vertical borders', 'borderInnerV'],
        ['Border style', 'borderStyle'], ['Border color', ''], ['More borders', '']], 'glyphs of the borders list rows');
    assert.deepEqual(rows.filter(r => r.w !== 18 || r.h !== 18).map(r => r.t + ' ' + r.w + '×' + r.h), [], 'glyph place is not 18 × 18');
    assert.deepEqual([...new Set(rows.map(r => r.left))].length, 1, 'captions do not start on one vertical: ' + rows.map(r => r.t + ' ' + r.left).join(', '));
    /* The "Border style" submenu: its level has no glyphs - and no place for them. */
    await clickRow('borders', 'Border style');
    const fly = await rowsOf(ctrlSel('borders') + ' .vo-pop-fly > .vo-pop-item');
    assert.deepEqual(fly.map(r => [r.t, r.glyph]), [['Thin', null], ['Thick', null]], 'the submenu level without glyphs got glyphs');
    await page.click(btnOf('borders'));
    /* The negative control: a mirror with a btn-* class not from the table ("Merge") - without icons. */
    await page.click(btnOf('merge'));
    const merge = await rowsOf(ctrlSel('merge') + ' > .vo-pop > .vo-pop-item');
    assert.ok(merge.length >= 3, 'precondition: the merge list opened: ' + merge.length);
    assert.deepEqual(merge.filter(r => r.glyph !== null).map(r => r.t), [], 'a list without border classes got glyph places');
    assert.equal(await page.evaluate(() => twins.btnMerge.menu.items[0].options.iconCls), 'menu__icon btn-merge-cells',
        'precondition: the merge rows carry a stock class of their own');
    await page.click(btnOf('merge'));
});

/* Without classes on the items (the former fake) the "Borders" list is as before: neither icons nor a place for them. */
test('borders_list_without_stock_classes_stays_as_before', async () => {
    await fresh();
    await page.evaluate(BUILD);
    await page.click(btnOf('borders'));
    const n = await page.evaluate(sel => ({rows: document.querySelectorAll(sel + ' > .vo-pop > .vo-pop-item').length,
        glyphs: document.querySelectorAll(sel + ' .vo-pop-i').length}), ctrlSel('borders'));
    assert.deepEqual(n, {rows: 3, glyphs: 0}, 'rows without stock classes got glyph places');
    await page.click(btnOf('borders'));
});

/* The checkmarks of the "Borders" list rows are by the active cell sides from the engine, the same data that press the button: a side checks its own
   row, all four - also "All" and "Outer" (for one cell they coincide), none of the six - "No borders"; "Inner", "Style",
   "Color" and "More" are never checked; no data - no checkmarks at all, "No borders" too. The checkmark is the list checkmark on the right
   (.vo-pop-check) and aria-checked on the row. */
const BORDER_LIST = () => page.evaluate(async sel => {
    await Promise.all(document.getAnimations().map(a => a.finished));
    return [...document.querySelectorAll(sel + ' > .vo-pop > .vo-pop-item')].map(r => {
        const chk = r.querySelector(':scope > .vo-pop-check'), t = r.querySelector(':scope > .vo-pop-t');
        const rb = r.getBoundingClientRect(), tb = t.getBoundingClientRect(), cb = chk ? chk.getBoundingClientRect() : null;
        return {t: t.textContent, on: r.classList.contains('on'), aria: r.getAttribute('aria-checked'), sub: r.classList.contains('vo-has-sub'),
                mark: !!chk && getComputedStyle(chk).visibility === 'visible' && !!chk.querySelector('.vo-air, svg'),
                held: !!cb && cb.width > 0, w: rb.width, left: tb.left, tRight: tb.right, chkLeft: cb ? cb.left : null};
    });
}, ctrlSel('borders'));
const BORDER_ROWS = ['Bottom borders', 'Top borders', 'Left borders', 'Right borders', 'No borders', 'All borders', 'Outside borders',
    'Inside borders', 'Inside horizontal borders', 'Inside vertical borders', 'Border style', 'Border color', 'More borders'];
const FOUR = {left: THIN, top: THIN, right: THIN, bottom: THIN};
const FOUR_MARKS = ['Bottom borders', 'Top borders', 'Left borders', 'Right borders', 'All borders', 'Outside borders'];
const BORDER_MARK_CASES = [
    ['no sides (six null)', SIDES(), ['No borders']],
    ['sides of style None', SIDES({left: NONE, top: NONE, right: NONE, bottom: NONE, diagDown: NONE, diagUp: NONE}), ['No borders']],
    ['four sides', SIDES(FOUR), FOUR_MARKS],
    ['four sides and both diagonals', SIDES(Object.assign({diagDown: THIN, diagUp: THIN}, FOUR)), FOUR_MARKS],
    ['only the bottom', SIDES({bottom: THIN}), ['Bottom borders']],
    ['the top and the left', SIDES({top: THIN, left: THIN}), ['Top borders', 'Left borders']],
    ['three sides without the right', SIDES({left: THIN, top: THIN, bottom: THIN}), ['Bottom borders', 'Top borders', 'Left borders']],
    ['four sides, the right of style None', SIDES(Object.assign({}, FOUR, {right: NONE})), ['Bottom borders', 'Top borders', 'Left borders']],
    ['only the diagonal down', SIDES({diagDown: THIN}), []],
    ['only the diagonal up', SIDES({diagUp: THIN}), []],
    ['the engine reports no borders (null)', null, []]
];

test('borders_list_marks_follow_the_cell_borders', async () => {
    await fresh({borderIcons: true});
    await page.evaluate(BUILD);
    for (const [what, borders, want] of BORDER_MARK_CASES) {
        await selectBorders(borders);
        await page.click(btnOf('borders'));
        const rows = await BORDER_LIST();
        assert.deepEqual(rows.map(r => r.t), BORDER_ROWS, what + ': precondition — the stock rows');
        assert.deepEqual(rows.filter(r => r.on).map(r => r.t), want, what + ': marked rows');
        assert.deepEqual(rows.filter(r => r.mark).map(r => r.t), want, what + ': rows with a visible check mark');
        assert.deepEqual(rows.filter(r => r.aria === 'true').map(r => r.t), want, what + ': rows with aria-checked="true"');
        /* The button and the checkmarks are one data: the button is pressed exactly when "No borders" is not checked. */
        if (borders) assert.equal((await BORDER_LOOK()).on, !want.includes('No borders'), what + ': «Borders» pressed and «No borders» marked agree');
        await page.click(btnOf('borders'));
    }
});

/* The checkmark is in its place in the list: to the right of the caption, the place for it is held by every row, so the captions and the list width with checkmarks
   are the same as without them; for rows without a submenu the checkmarks are on one vertical. */
test('borders_list_marks_keep_the_captions_in_place', async () => {
    await fresh({borderIcons: true});
    await page.evaluate(BUILD);
    await selectBorders(null);
    await page.click(btnOf('borders'));
    const before = await BORDER_LIST();
    await page.click(btnOf('borders'));
    await selectBorders(SIDES(FOUR));
    await page.click(btnOf('borders'));
    const after = await BORDER_LIST();
    await page.click(btnOf('borders'));
    assert.deepEqual(after.filter(r => r.mark).map(r => r.t), FOUR_MARKS, 'precondition: six marks');
    assert.deepEqual(before.filter(r => r.mark).map(r => r.t), [], 'precondition: no marks without data');
    assert.deepEqual(after.filter(r => !r.held).map(r => r.t), [], 'rows without a place for the mark');
    assert.equal(new Set(after.map(r => r.left)).size, 1, 'captions do not start on one vertical: ' + after.map(r => r.t + ' ' + r.left).join(', '));
    assert.deepEqual(after.map(r => r.left), before.map(r => r.left), 'the marks moved the captions');
    assert.deepEqual(after.map(r => r.w), before.map(r => r.w), 'the marks changed the list width');
    assert.deepEqual(after.filter(r => r.mark && !(r.chkLeft >= r.tRight)).map(r => r.t), [], 'a mark is not to the right of its caption');
    assert.equal(new Set(after.filter(r => !r.sub).map(r => r.chkLeft)).size, 1, 'marks of the rows without a submenu are not on one vertical');
});

/* A checkmark is only a look: choosing a checked row is the same standard item click. The checkmarks are read from the engine on every opening of the list,
   there is no flag of its own: another cell - other checkmarks even without a selection event. The engine - once per opening and only for the borders list;
   a read failure - no checkmarks, the list is open. */
test('borders_list_marks_are_read_on_each_opening', async () => {
    await fresh({borderIcons: true});
    await page.evaluate(BUILD);
    await selectBorders(SIDES(FOUR));
    await page.click(btnOf('borders'));
    assert.equal((await BORDER_LIST()).find(r => r.t === 'Bottom borders').on, true, 'precondition: «Bottom borders» is marked');
    await clear();
    await clickRow('borders', 'Bottom borders');
    assert.deepEqual((await state()).log.filter(l => /^pick /.test(l)), ['pick Toolbar:btnBorders Bottom borders'],
        'the marked row is not the stock pick of its item');
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel('borders')), false,
        'the list stays open after the pick');
    await page.evaluate(() => { api.borders = {left: null, top: 7, right: null, bottom: null, diagDown: null, diagUp: null}; });
    await page.click(btnOf('borders'));
    assert.deepEqual((await BORDER_LIST()).filter(r => r.on).map(r => r.t), ['Top borders'], 'the marks of the previous opening stayed');
    await page.click(btnOf('borders'));
    const reads = await page.evaluate(() => {
        const T = SSE.Views.CompactToolbar, own = api.cellBorders;
        let n = 0;
        api.cellBorders = function () { n++; return own.call(this); };
        const count = k => { n = 0; T.openList(T.ctrl[k]); const got = n; T.closeList(T.ctrl[k]); return got; };
        const out = {borders: count('borders'), merge: count('merge'), condfmt: count('condfmt')};
        api.cellBorders = own;
        return out;
    });
    assert.deepEqual(reads, {borders: 1, merge: 0, condfmt: 0}, 'engine border reads per list opening');
    await page.evaluate(() => { api.throwBorders = true; });
    await page.click(btnOf('borders'));
    let rows = await BORDER_LIST();
    assert.deepEqual(rows.map(r => r.t), BORDER_ROWS, 'the list did not open on a failed read');
    assert.deepEqual(rows.filter(r => r.on || r.mark).map(r => r.t), [], 'marks after a failed read');
    await page.click(btnOf('borders'));
    await page.evaluate(() => { api.throwBorders = false; api.asc_getCellInfo = () => { throw new Error('no cell info'); }; });
    await page.click(btnOf('borders'));
    rows = await BORDER_LIST();
    assert.deepEqual(rows.map(r => r.t), BORDER_ROWS, 'the list did not open without an answer of the engine');
    assert.deepEqual(rows.filter(r => r.on || r.mark).map(r => r.t), [], 'marks without an answer of the engine');
    await page.click(btnOf('borders'));
});

/* "Format → Borders ▸" of the menu row - the same checkmarks by the same data: a checked row is a menu row checkbox (menuitemcheckbox,
   aria-checked, the checkmark to the right of the caption), the captions are on one vertical. */
test('format_borders_menu_marks_follow_the_cell_borders', async () => {
    await fresh({borderIcons: true}, 1440, true);
    const open = async () => {
        await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
        await page.click('#vo-shell .vo-mn-item[data-k="format"]');
        await page.click('#vo-shell .vo-mn-drop.open .vo-mn-sub[data-k="borders"]');
        return page.evaluate(() => {
            const fly = document.querySelector('#vo-shell .vo-mn-fly[data-level="1"]');
            if (!fly) return null;
            return [...fly.querySelectorAll('.vo-mn-sub')].map(r => {
                const t = r.querySelector('.vo-mn-t'), chk = r.querySelector('.vo-mn-chk');
                return {t: t.textContent, role: r.getAttribute('role'), aria: r.getAttribute('aria-checked'),
                        mark: !!chk && !!chk.querySelector('.vo-air, svg'), left: t.getBoundingClientRect().left,
                        tRight: t.getBoundingClientRect().right, chkLeft: chk ? chk.getBoundingClientRect().left : null};
            });
        });
    };
    for (const [what, borders, want] of BORDER_MARK_CASES) {
        await selectBorders(borders);
        const rows = await open();
        assert.ok(rows, what + ': «Format → Borders ▸» did not open');
        assert.deepEqual(rows.map(r => r.t), BORDER_ROWS, what + ': precondition — the stock rows');
        assert.deepEqual(rows.filter(r => r.mark).map(r => r.t), want, what + ': rows with a check mark');
        assert.deepEqual(rows.filter(r => r.aria === 'true').map(r => r.t + ' ' + r.role), want.map(t => t + ' menuitemcheckbox'),
            what + ': checked rows for the screen reader');
        assert.equal(new Set(rows.map(r => r.left)).size, 1, what + ': captions do not start on one vertical');
        assert.deepEqual(rows.filter(r => r.mark && !(r.chkLeft >= r.tRight)).map(r => r.t), [], what + ': a mark is not to the right of its caption');
    }
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
});

/* Checkmarks are only for one cell (or one merged area: the engine asc_getOneCell). For a range the active cell sides do not
   say anything about the selection borders, and "Outer" means a frame around the whole range, so there are no checkmarks either in the button list or in
   "Format → Borders ▸"; an engine that does not report this - also without checkmarks. The "Borders" button for a range is pressed by the active
   cell, like "Bold". */
test('borders_marks_only_for_one_cell', async () => {
    await fresh({borderIcons: true}, 1440, true);
    const formatMarks = async () => {
        await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
        await page.click('#vo-shell .vo-mn-item[data-k="format"]');
        await page.click('#vo-shell .vo-mn-drop.open .vo-mn-sub[data-k="borders"]');
        const got = await page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-mn-fly[data-level="1"] .vo-mn-sub')]
            .filter(r => r.getAttribute('aria-checked') === 'true').map(r => r.querySelector('.vo-mn-t').textContent));
        await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
        return got;
    };
    const listMarks = async () => {
        await page.click(btnOf('borders'));
        const rows = await BORDER_LIST();
        await page.click(btnOf('borders'));
        return {on: rows.filter(r => r.on).map(r => r.t), mark: rows.filter(r => r.mark).map(r => r.t),
                aria: rows.filter(r => r.aria === 'true').map(r => r.t)};
    };
    const cases = [
        ['one cell', true, FOUR_MARKS],
        ['a range', false, []],
        ['an engine without asc_getOneCell', undefined, []]
    ];
    for (const [what, one, want] of cases) {
        await page.evaluate(o => { api.oneCell = o; }, one);
        await selectBorders(SIDES(FOUR));
        assert.deepEqual(await listMarks(), {on: want, mark: want, aria: want}, what + ': marks of the «Borders» list');
        assert.deepEqual(await formatMarks(), want, what + ': marks of «Format → Borders ▸»');
        assert.equal((await BORDER_LOOK()).on, true, what + ': «Borders» pressed by the active cell');
    }
    await page.evaluate(() => { api.oneCell = false; });
    await selectBorders(SIDES());
    assert.equal((await BORDER_LOOK()).on, false, 'a range whose active cell has no border: «Borders» not pressed');
    assert.deepEqual((await listMarks()).on, [], 'a range: «No borders» is not marked either');
    await page.evaluate(() => { api.oneCell = true; });
});

/* The roles of the "Borders" list rows: there may be several checkmarks, so the border item rows are checkboxes (menuitemcheckbox with aria-checked),
   the other rows without a submenu are plain items (menuitem without aria-checked), rows with a submenu - menuitem, as they were. Other mirror lists
   ("Merge") stay variants (menuitemradio). */
test('borders_list_rows_are_checkboxes', async () => {
    await fresh({borderIcons: true});
    await page.evaluate(BUILD);
    await selectBorders(SIDES(FOUR));
    const roles = async k => {
        await page.click(btnOf(k));
        const got = await page.evaluate(sel => [...document.querySelectorAll(sel + ' > .vo-pop > .vo-pop-item')].map(r =>
            r.querySelector('.vo-pop-t').textContent + ' ' + r.getAttribute('role') + ' ' + r.getAttribute('aria-checked')), ctrlSel(k));
        await page.click(btnOf(k));
        return got;
    };
    const box = (t, on) => t + ' menuitemcheckbox ' + on;
    assert.deepEqual(await roles('borders'), [
        box('Bottom borders', true), box('Top borders', true), box('Left borders', true), box('Right borders', true),
        box('No borders', false), box('All borders', true), box('Outside borders', true),
        'Inside borders menuitem null', 'Inside horizontal borders menuitem null', 'Inside vertical borders menuitem null',
        'Border style menuitem false', 'Border color menuitem false', 'More borders menuitem null'
    ], 'roles of the «Borders» rows');
    assert.deepEqual(await roles('merge'), ['Merge & center menuitemradio false', 'Merge across menuitemradio false',
        'Unmerge menuitemradio false'], 'roles of another mirror list');
});

test('pick_returns_focus_to_document', async () => {
    await fresh();
    await page.evaluate(BUILD);
    for (const [k, row] of [['borders', 'Bottom border'], ['freeze', 'Freeze top row'], ['sort', null], ['font', 'Verdana']]) {
        await page.click(btnOf(k));
        const rows = await listRows(k);
        await clear();
        await clickRow(k, row || rows[0].t);
        const s = await state();
        assert.ok(s.notes.includes('edit:complete'), k + ': no edit:complete after the pick');
        assert.equal(s.calls[s.calls.length - 1], 'keys true', k + ': keyboard not returned to the sheet');
        assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel(k)), false, k + ': list stays open');
    }
    const s = await state();
    assert.deepEqual(s.log.filter(l => /^font /.test(l)), ['font Verdana'], 'font pick — the stock selected event with the font record');
    /* The mirror submenu: conditional formatting is the second level of the standard menu. */
    await page.click(btnOf('condfmt'));
    const rows = await listRows('condfmt');
    assert.deepEqual(rows.map(r => [r.t, r.sub]), [['Highlight cells rules', true], ['Clear rules', false]]);
    await clickRow('condfmt', 'Highlight cells rules');
    await clear();
    await page.evaluate(() => [...document.querySelectorAll('#vo-tb [data-ctrl="condfmt"] .vo-pop-fly .vo-pop-item')][1].click());
    assert.deepEqual((await state()).log, ['pick Toolbar:btnCondFormat Less than'], 'second-level pick through the stock item');
});

test('menu_and_panel_share_glyphs', async () => {
    await fresh();
    await page.evaluate(BUILD);
    const r = await page.evaluate(() => {
        const T = SSE.Views.CompactToolbar, A = SSE.Views.SheetActions, I = Common.UI.Compact.Icons;
        /* And the children of composite items ("Format → Text ▸": the commands of the panel font style buttons). */
        const items = [].concat(...A.catalog().map(g => g.items)).flatMap(i => i && i.items ? [i].concat(i.items) : [i]).filter(i => i && !i.sep && i.head == null && !i.mirror);
        const out = {pairs: [], diff: [], missing: []};
        [].concat(...T.catalog().map(g => g.items)).forEach(c => {
            const names = [c.i].concat((c.choices || []).map(x => x.i), (c.entries || []).filter(e => !e.sep).map(e => e.i)).filter(Boolean);
            /* The drawing is in the shared set or in the spreadsheet editor's own set (CompactToolbar.hasGlyph: "123", the percent sign, decimal places). */
            names.forEach(n => { if (!T.hasGlyph(n)) out.missing.push(c.k + ':' + n); });
            /* And the choice variants (choices, glyphs: "Horizontal", "Vertical") - their rows and "Format → Alignment ▸". */
            const parts = (c.entries || []).filter(e => !e.sep).concat(c.choices || [], c.glyphs || []);
            const refs = [c.twin].concat(parts.map(e => e.twin)).filter(Boolean);
            /* And an item without a double with the same command (sameCommand: "File → Print" - the ribbon "Print" button). */
            refs.forEach(ref => items.filter(i => (i.twin === ref || (i.sameCommand && i.lockLike === ref)) && i.i).forEach(i => {
                const glyph = parts.find(e => e.twin === ref && e.i) ? parts.find(e => e.twin === ref).i : c.i;
                out.pairs.push(c.k + '=' + i.k);
                if (glyph !== i.i) out.diff.push(c.k + ' ' + glyph + ' vs menu ' + i.k + ' ' + i.i);
            }));
        });
        items.forEach(i => { if (i.i && !I.has(i.i)) out.missing.push('menu ' + i.k + ':' + i.i); });
        return out;
    });
    assert.deepEqual(r.missing, [], 'glyphs without a drawing');
    assert.deepEqual(r.diff, [], 'menu item and panel control of one command differ in glyph');
    /* "Format → ✓ Wrap text" is the same command as the panel wrap button. */
    ['borders=borders', 'merge=merge', 'func=function', 'rotate=textRotation', 'condfmt=conditional', 'freeze=freeze', 'filter=filter',
     'sort=sortAZ', 'validate=validation', 'clear=clearFormat', 'link=link', 'image=image', 'undo=undo', 'comment=comment', 'wrap=wrap',
     /* "Print" is the same command as "File → Print". */
     'print=print',
     /* "Format → Text ▸ (✓ Bold · ✓ Italic · ✓ Underline · ✓ Strikethrough …)". */
     'bold=bold', 'italic=italic', 'underline=underline', 'strike=strikeout',
     /* "Format → Alignment ▸": the variants of the panel alignment lists. */
     'halign=alignLeft', 'halign=alignCenter', 'halign=alignRight', 'halign=alignJust', 'valign=alignTop', 'valign=alignMiddle', 'valign=alignBottom']
        .forEach(p => assert.ok(r.pairs.includes(p), 'pair ' + p + ' not compared: ' + r.pairs.join(' ')));
});

test('reader_gets_no_toolbar', async () => {
    await fresh({options: {isEdit: false}});
    assert.equal(await page.evaluate(BUILD), false, 'build() returned a toolbar for a reader');
    assert.equal(await page.evaluate(() => !!document.getElementById('vo-tb')), false);
    assert.equal(await page.evaluate(() => SSE.Views.CompactToolbar.wanted()), false);
});

/* The panel is built earlier than the stock fills the shortcut
   registry (Shortcuts.setApi after app:ready) - the hints must wait for the registry,
   like the standard buttons, and not freeze without keys. */
test('tips_follow_shortcut_registry', async () => {
    await fresh({lateShortcuts: true});
    await page.evaluate(BUILD);
    /* The hint text is aria-description (it used to be title). */
    const tips = () => page.evaluate(() => ['undo', 'bold', 'filter'].map(k => document.querySelector(`#vo-tb [data-ctrl="${k}"]`).getAttribute('aria-description')));
    assert.deepEqual(await tips(), ['Undo', 'Bold', 'Filter'], 'empty registry: bare labels');
    await page.evaluate(() => registry.setApi());
    assert.deepEqual(await tips(), ['Undo (Ctrl+Z)', 'Bold (Ctrl+B)', 'Filter (Ctrl+Shift+L)'],
        'hints did not take the shortcuts once the stock filled its registry');
    /* A user reassignment is the same registry path; the restriction reason stays with the hint. */
    await page.evaluate(() => { twins.btnBold.keepState = ['cell-editing']; twins.btnBold.setDisabled(true); api.send('asc_onSelectionChanged'); });
    await page.evaluate(() => { registry.map = Object.assign({}, registry.map, {Bold: ['Alt', 'B']}); registry.events.forEach(cb => cb()); });
    assert.equal((await tips())[1], 'Bold (Alt+B) — ' + await page.evaluate(() => SSE.Views.SheetActions.textEditing),
        'reassigned shortcut and the lock reason together');
    assert.equal(await page.getAttribute(btnOf('bold'), 'aria-label'), 'Bold', 'the screen reader name has no keys');
});

/* --- Hover hints ------------------------------------------------------------------------------------
   0.5 s after hovering a button - a hint
   "name (shortcut)", after the cursor leaves - none; it does not cover the neighboring buttons (under the panel row, in "⋯" - under the popup
   row), it is readable in the light and dark theme (the look is the standard ONLYOFFICE hint). Hovering is with a
   real mouse (playwright page.mouse - CDP mouseMoved); the delay is by the page clock: the first mouseover on a control and
   the insertion of #vo-tip into body (MutationObserver), so that machine load does not confuse the measurement. */
const TIP = () => page.evaluate(() => {
    const n = document.getElementById('vo-tip');
    if (!n || !n.isConnected) return null;
    const r = n.getBoundingClientRect(), inner = n.querySelector('.tooltip-inner');
    return {text: inner ? inner.textContent : n.textContent, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height,
            body: n.parentNode === document.body, cls: n.className, hidden: n.getAttribute('aria-hidden')};
});
const boxOf = sel => page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {l: r.left, t: r.top, r: r.right, b: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height};
}, sel);
const hits = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
const AWAY = {x: 6, y: 780};
/* The hint clock: from the next mouseover on node sel until #vo-tip is inserted. */
const armClock = sel => page.evaluate(s => {
    const el = document.querySelector(s), T = window.__tipT = {over: null, shown: null};
    el.addEventListener('mouseover', () => { if (T.over === null) T.over = performance.now(); }, true);
    if (window.__tipMo) window.__tipMo.disconnect();
    window.__tipMo = new MutationObserver(() => { if (T.shown === null && document.getElementById('vo-tip')) T.shown = performance.now(); });
    window.__tipMo.observe(document.body, {childList: true});
}, sel);
async function hoverTip(sel, wait = 1600) {
    await page.mouse.move(AWAY.x, AWAY.y);
    await flush();
    await armClock(sel);
    const p = await boxOf(sel);
    assert.ok(p, 'no node to hover: ' + sel);
    await page.mouse.move(p.x, p.y);
    await page.waitForFunction(() => window.__tipT.shown !== null, null, {timeout: wait}).catch(() => {});
    const clock = await page.evaluate(() => window.__tipT);
    return {tip: await TIP(), clock, ms: clock.shown !== null && clock.over !== null ? clock.shown - clock.over : null, p};
}
/* The visible row and "⋯" controls (without an expanded list): buttons, the font size field. */
const ROW_CTRLS = scope => page.evaluate(s => [...document.querySelectorAll(s + ' .vo-ib, ' + s + ' .vo-size-input')]
    .filter(n => n.getClientRects().length && n.getBoundingClientRect().width > 0).map(n => {
        const r = n.getBoundingClientRect();
        return {k: (n.closest('[data-ctrl]') || n).getAttribute('data-ctrl') || n.className, l: r.left, t: r.top, r: r.right, b: r.bottom};
    }), scope);

test('tip_bold_after_half_second_under_the_row', async () => {
    await fresh({}, 1440, true);
    const r = await hoverTip(btnOf('bold'));
    assert.ok(r.tip, 'no hover tip on «Bold» after the 0.5 s delay');
    assert.equal(r.tip.text, 'Bold (Ctrl+B)', 'the name and the shortcut of the system');
    assert.ok(r.ms >= 480 && r.ms <= 1500, 'the tip came ' + Math.round(r.ms) + ' ms after the hover, not 0.5 s');
    assert.ok(r.tip.body && r.tip.hidden === 'true', 'the tip is one node on body, hidden from the screen reader: ' + JSON.stringify(r.tip));
    const bar = await boxOf('#vo-tb');
    assert.ok(Math.abs(r.tip.t - (bar.b + 4)) <= 1, 'the tip stands under the row (#vo-tb bottom + 4 = ' + (bar.b + 4) + '), not at ' + r.tip.t);
    assert.ok(Math.abs((r.tip.l + r.tip.r) / 2 - r.p.x) <= 1, 'the tip is not centred on the button: ' + JSON.stringify([r.tip.l, r.tip.r, r.p.x]));
    const vw = await page.evaluate(() => innerWidth);
    assert.ok(r.tip.l >= 8 && r.tip.r <= vw - 8, 'the tip is closer than 8 px to the window edge: ' + JSON.stringify(r.tip));
    const touched = (await ROW_CTRLS('#vo-tb')).filter(c => hits(c, r.tip)).map(c => c.k);
    assert.deepEqual(touched, [], 'the tip covers row buttons');
    /* The cursor left - no hint; onto a neighboring button - its own, after its own delay. */
    await page.mouse.move(AWAY.x, AWAY.y);
    await flush();
    assert.equal(await TIP(), null, 'the tip stayed after the cursor left');
    const it = await hoverTip(btnOf('italic'));
    assert.equal(it.tip && it.tip.text, 'Italic', 'the neighbour has its own tip');
    assert.ok(it.ms >= 480, 'the neighbour tip came without the delay: ' + it.ms);
    const ib = await boxOf(btnOf('italic')), bb = await boxOf(btnOf('bold'));
    await page.mouse.move(bb.x, bb.y);
    await flush();
    assert.equal(await TIP(), null, 'moving to «Bold» left the «Italic» tip on screen');
    await page.mouse.move(AWAY.x, AWAY.y);
    assert.ok(ib && bb, 'precondition');
});

/* "⋯" - the hint is under the popup row, not under the button: under the first row "⋯" button it would cover the second row. While "⋯"
   is expanded, the panel row gives no hints (a hint would stand on top of the open list), and a control in "⋯" with its own list open - also none. */
test('tip_in_more_row_under_the_popup', async () => {
    await fresh({}, 980, true);
    await page.click('#vo-tb .vo-more');
    /* "⋯" expands with motion (@vo-dur-pop): measure after it. */
    await page.waitForTimeout(400);
    const inPop = await page.evaluate(() => [...document.querySelectorAll('#vo-tb .vo-of-pop [data-ctrl]')].map(n => n.getAttribute('data-ctrl')));
    assert.ok(inPop.length >= 8, 'precondition: «⋯» holds a few controls at 980: ' + inPop.join(' '));
    const pop = await boxOf('#vo-tb .vo-of-pop');
    const rows = await ROW_CTRLS('#vo-tb .vo-of-pop');
    const tops = [...new Set(rows.map(c => Math.round(c.t)))];
    assert.ok(tops.length >= 2, 'precondition: two rows in «⋯»: ' + JSON.stringify(tops));
    const first = rows.find(c => Math.round(c.t) === tops[0] && /^(link|chart|validate|filter)$/.test(c.k)) || rows[0];
    const sel = '#vo-tb .vo-of-pop [data-ctrl="' + first.k + '"]';
    const r = await hoverTip(sel);
    assert.ok(r.tip, 'no tip in «⋯» on ' + first.k);
    assert.equal(r.tip.text, await page.evaluate(s => { const n = document.querySelector(s); return (n.tagName === 'BUTTON' ? n : n.querySelector('button')).getAttribute('aria-description'); }, sel));
    const popNow = await boxOf('#vo-tb .vo-of-pop');
    assert.ok(Math.abs(popNow.b - pop.b) < 0.5, 'precondition: «⋯» still moves: ' + pop.b + ' → ' + popNow.b);
    assert.ok(Math.abs(r.tip.t - (pop.b + 4)) <= 1, 'in «⋯» the tip stands under the popup row (' + (pop.b + 4) + '), not at ' + r.tip.t);
    const touched = rows.filter(c => hits(c, r.tip)).map(c => c.k);
    assert.deepEqual(touched, [], 'the tip covers the second row of «⋯»');
    /* The row with "⋯" expanded - without hints. */
    const bold = await hoverTip(btnOf('bold'), 900);
    assert.equal(bold.tip, null, 'a row tip over the open «⋯»');
    /* A "⋯" control with its own list open - without hints. */
    const drop = await page.evaluate(() => { const b = document.querySelector('#vo-tb .vo-of-pop .vo-pop-wrap > .vo-drop'); return b && b.closest('[data-ctrl]').getAttribute('data-ctrl'); });
    assert.ok(drop, 'precondition: a list button in «⋯»');
    await page.click('#vo-tb .vo-of-pop [data-ctrl="' + drop + '"] > button');
    await flush();
    assert.equal(await page.evaluate(k => document.querySelector('#vo-tb [data-ctrl="' + k + '"]').classList.contains('open'), drop), true, 'precondition: the list in «⋯» opened');
    const other = rows.find(c => c.k !== drop && c.k !== first.k);
    const o = await hoverTip('#vo-tb .vo-of-pop [data-ctrl="' + other.k + '"]', 900);
    assert.equal(o.tip, null, 'a tip over the open list in «⋯»');
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
    await page.mouse.move(AWAY.x, AWAY.y);
});

/* A disabled button has a hint too - with the reason (Chrome sends hover to a disabled button too); the text of the shown
   hint changes in place when the state changes; the hint itself does not fade by a timer (the standard one - 5 s). */
test('tip_disabled_reason_follows_state_and_stays', async () => {
    await fresh({}, 1440, true);
    const why = await page.evaluate(() => SSE.Views.SheetActions.textEditing);
    await page.evaluate(() => { twins.btnBold.keepState = ['cell-editing']; twins.btnBold.setDisabled(true); api.send('asc_onSelectionChanged', api.asc_getCellInfo()); });
    await flush();
    assert.equal(await page.evaluate(sel => document.querySelector(sel).disabled, btnOf('bold')), true, 'precondition: «Bold» is dimmed');
    let r = await hoverTip(btnOf('bold'));
    assert.equal(r.tip && r.tip.text, 'Bold (Ctrl+B) — ' + why, 'the dimmed button has no tip with its reason');
    const node = await page.evaluateHandle(() => document.getElementById('vo-tip'));
    await page.evaluate(() => { twins.btnBold.keepState = []; twins.btnBold.setDisabled(false); api.send('asc_onSelectionChanged', api.asc_getCellInfo()); });
    await flush();
    r = {tip: await TIP()};
    assert.equal(r.tip && r.tip.text, 'Bold (Ctrl+B)', 'the shown tip did not follow the state');
    assert.equal(await page.evaluate(n => n === document.getElementById('vo-tip') && n.isConnected, node), true, 'the tip was rebuilt instead of updated in place');
    await page.waitForTimeout(5600);
    assert.ok(await TIP(), 'the tip went away by itself (the stock one does after 5 s)');
    await page.mouse.move(AWAY.x, AWAY.y);
});

/* The hint goes away on a press, a key, the wheel, on closing shell surfaces and on a chrome change; in focus mode the row stays - and so
   does the chevron hint ("Exit focus mode (Esc)"). The cursor stands still after that - a new hint only after a new
   hover. */
test('tip_hides_on_press_key_wheel_and_chrome', async () => {
    await fresh({}, 1440, true);
    const again = async what => {
        const r = await hoverTip(btnOf('bold'));
        assert.ok(r.tip, 'no tip before ' + what);
        return r;
    };
    let r = await again('the press');
    await page.mouse.down();
    await flush();
    assert.equal(await TIP(), null, 'the tip stayed under the press');
    await page.mouse.up();
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
    r = await again('the key');
    await page.keyboard.press('Shift');
    await flush();
    assert.equal(await TIP(), null, 'the tip stayed after a key');
    r = await again('the wheel');
    await page.mouse.wheel(0, 40);
    await flush();
    assert.equal(await TIP(), null, 'the tip stayed after the wheel');
    r = await again('closeSurfaces');
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
    assert.equal(await TIP(), null, 'the tip stayed after closeSurfaces');
    r = await again('the focus mode');
    await page.evaluate(() => SSE.Views.CompactShell.toggleFocus());
    await flush();
    assert.equal(await TIP(), null, 'the tip stayed when the chrome changed (focus mode)');
    const exit = await hoverTip('#vo-tb .vo-focus-btn');
    assert.equal(exit.tip && exit.tip.text, 'Exit focus mode (Esc)', 'no tip on the focus chevron in the focus mode');
    const vw = await page.evaluate(() => innerWidth);
    assert.ok(exit.tip.r <= vw - 8, 'the chevron tip runs past the window edge: ' + JSON.stringify(exit.tip));
    await page.evaluate(() => SSE.Views.CompactShell.toggleFocus());
    await page.mouse.move(AWAY.x, AWAY.y);
    assert.ok(r, 'precondition');
});

/* Not on top of an open list: while a panel button list (or a menu row section) is open, there are no hints; the list is closed - there are. */
test('no_tip_over_an_open_list', async () => {
    await fresh({}, 1440, true);
    await page.click(btnOf('borders'));
    await flush();
    assert.equal(await page.evaluate(sel => document.querySelector(sel).classList.contains('open'), ctrlSel('borders')), true, 'precondition: the list opened');
    let r = await hoverTip(btnOf('italic'), 900);
    assert.equal(r.tip, null, 'a tip over the open list «Borders»');
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
    await page.evaluate(() => document.querySelector('#vo-shell .vo-mn-item').click());
    await flush();
    r = await hoverTip(btnOf('italic'), 900);
    assert.equal(r.tip, null, 'a tip over the open menu section');
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
    r = await hoverTip(btnOf('italic'));
    assert.equal(r.tip && r.tip.text, 'Italic', 'no tip once the lists are closed');
    await page.mouse.move(AWAY.x, AWAY.y);
});

/* The negative control of a double hint: the panel controls have no title - the browser would draw its hint beside ours;
   the hint text of every button and field is in aria-description (the description for the screen reader), the name is in aria-label. */
test('no_title_on_toolbar_controls', async () => {
    await fresh({}, 1440, true);
    const r = await page.evaluate(() => ({
        titled: [...document.querySelectorAll('#vo-tb [title]')].map(n => (n.closest('[data-ctrl]') || n).getAttribute('data-ctrl') || n.className),
        bare: [...document.querySelectorAll('#vo-tb .vo-ib, #vo-tb .vo-size-input')].filter(n => !n.getAttribute('aria-description'))
            .map(n => (n.closest('[data-ctrl]') || n).getAttribute('data-ctrl') || n.className),
        n: document.querySelectorAll('#vo-tb .vo-ib, #vo-tb .vo-size-input').length}));
    assert.deepEqual(r.titled, [], 'toolbar nodes with title — the browser would show its own tip too');
    assert.deepEqual(r.bare, [], 'toolbar controls without the tip text');
    assert.ok(r.n >= 38, 'precondition: all controls counted (' + r.n + ')');
});

/* Readable in the light and dark theme: the look is standard (the stock tooltip.less, built right here), text to background
   no less than 4.5:1 (WCAG 1.4.3) in both themes; the node is fixed, off the cursor, at the floor of the standard hint: above the shell surfaces
   (@vo-z-float 1002), under the modal window dimming (1040). */
const srgb = c => { const m = /rgba?\(([^)]+)\)/.exec(c); const v = m ? m[1].split(',').map(Number) : [0, 0, 0, 0]; return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
const over = (fg, bg) => ({r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1});
const relLum = c => [c.r, c.g, c.b].map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
test('tip_readable_in_light_and_dark_theme', async () => {
    await fresh({}, 1440, true);
    await page.addStyleTag({content: stockTipCss});
    const look = () => page.evaluate(() => {
        const n = document.getElementById('vo-tip'), i = n && n.querySelector('.tooltip-inner');
        if (!i) return null;
        const a = getComputedStyle(n), b = getComputedStyle(i);
        return {pos: a.position, events: a.pointerEvents, z: a.zIndex, op: a.opacity, bg: b.backgroundColor, color: b.color, font: b.fontSize, pad: b.padding,
                border: b.borderTopWidth + ' ' + b.borderTopStyle + ' ' + b.borderTopColor};
    });
    const res = {};
    for (const theme of ['light', 'dark']) {
        await page.evaluate(t => { document.body.classList.toggle('theme-type-dark', t === 'dark'); document.body.classList.toggle('theme-type-light', t === 'light'); }, theme);
        const r = await hoverTip(btnOf('bold'));
        assert.ok(r.tip, theme + ': no tip');
        const l = res[theme] = await look();
        assert.ok(l, theme + ': the tip is not the stock template (.tooltip-inner)');
        assert.deepEqual([l.pos, l.events, l.op], ['fixed', 'none', '1'], theme + ': the tip is not fixed, takes the pointer or is not shown: ' + JSON.stringify(l));
        assert.ok(+l.z > 1002 && +l.z < 1040, theme + ': the tip floor ' + l.z + ' is not above the shell surfaces (1002) and below the modal (1040)');
        const bg = srgb(l.bg);
        assert.equal(bg.a, 1, theme + ': the tip background is not solid: ' + l.bg);
        const k = contrast(over(srgb(l.color), bg), bg);
        assert.ok(k >= 4.5, theme + ': the tip text ' + l.color + ' on ' + l.bg + ' — ' + k.toFixed(2) + ':1 < 4.5:1');
        await page.mouse.move(AWAY.x, AWAY.y);
    }
    assert.notEqual(res.light.bg, res.dark.bg, 'precondition: the dark theme did not change the stock tip colours: ' + JSON.stringify(res));
    assert.equal(res.light.bg, 'rgb(255, 255, 255)', 'light: not the stock tip background');
    assert.equal(res.dark.bg, 'rgb(51, 51, 51)', 'dark: not the stock tip background (#333)');
});

/* A hint no closer than 8 px to the window edges (with fractional width rounding it stood 7.7 px from the right edge):
   at the right window edge the chevron hint with texts of different length - the right edge no further than vw − 8, the left one -
   no closer than 8; the text changes in place (setTip), the place is recalculated. */
test('tip_never_closer_than_8px_to_the_window_edge', async () => {
    await fresh({}, 1440, true);
    const r = await hoverTip('#vo-tb .vo-focus-btn');
    assert.ok(r.tip, 'no tip on the focus chevron');
    const vw = await page.evaluate(() => innerWidth);
    const texts = ['F', 'Focus', 'Focus mode', 'Exit focus mode (Esc)', 'Режим фокуса', 'Режим фокуса — выйти (Esc)', 'Fokusmodus', 'Fokusmodus beenden (Esc)',
        'iiiiiiii', 'WWWWWWW', 'Focus mode, W', 'Ferme le mode focus (Échap)', 'mmmm mmmm', 'lllll lll', 'Zz', 'ÄÖÜ äöü ß'];
    const bad = [];
    for (const t of texts) {
        await page.evaluate(t => SSE.Views.CompactToolbar.setTip(document.querySelector('#vo-tb .vo-focus-btn'), t), t);
        const tip = await TIP();
        if (!tip || tip.text !== t) { bad.push(t + ': not shown in place'); continue; }
        if (tip.r > vw - 8 || tip.l < 8) bad.push(t + ': ' + [tip.l, tip.r, tip.w].join(' / '));
    }
    assert.equal(bad.join(' | '), '', 'the tip is closer than 8 px to the window edge (vw ' + vw + ')');
    await page.mouse.move(AWAY.x, AWAY.y);
});

/* --- Header hints ------------------------------------------------------------------------------------------------
   The same layer as for the panel: the header buttons and the save icon show their hint ("Saved") after 0.5 s, the cursor
   left - none. For the save icon - at the side, after the icon: under it the hint would cover the menu row items; for the buttons on the right - under the
   button. The icon text follows the save state in place. On top of an open list (the mode switch) there are no hints, in
   focus mode there is no header - and no header hints. */
const HD_MENU_ROW = () => page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-mn-item, #vo-shell .vo-hd-title')]
    .filter(n => n.getClientRects().length).map(n => { const r = n.getBoundingClientRect(); return {k: n.textContent || n.className, l: r.left, t: r.top, r: r.right, b: r.bottom}; }));

test('header_save_icon_tip_to_the_right', async () => {
    await fresh({}, 1440, true);
    const sel = '#vo-shell .vo-hd .vo-hd-state';
    const r = await hoverTip(sel);
    assert.ok(r.tip, 'no tip on the save icon');
    assert.equal(r.tip.text, 'Saved', 'the save icon tip');
    assert.ok(r.ms >= 480 && r.ms <= 1500, 'the save icon tip came ' + Math.round(r.ms) + ' ms after the hover');
    const icon = await boxOf(sel);
    assert.ok(Math.abs(r.tip.l - (icon.r + 4)) <= 1, 'the tip is not right of the icon (icon right + 4 = ' + (icon.r + 4) + ', tip ' + r.tip.l + ')');
    assert.ok(Math.abs((r.tip.t + r.tip.b) / 2 - icon.y) <= 1, 'the tip is not centred on the icon height: ' + JSON.stringify([r.tip.t, r.tip.b, icon.y]));
    const hit = (await HD_MENU_ROW()).filter(c => hits(c, r.tip)).map(c => c.k);
    assert.deepEqual(hit, [], 'the save icon tip covers the menu row or the name');
    /* The state changed under the hint - the text and place follow in place (the "Unsaved" badge is wider than the checkmark). */
    await page.evaluate(() => { api.asc_isDocumentModified = () => true; api.send('asc_onDocumentModifiedChanged', true); });
    await flush();
    const t2 = await TIP(), icon2 = await boxOf(sel);
    assert.equal(t2 && t2.text, 'Unsaved', 'the shown tip did not follow the save state');
    assert.ok(icon2.r > icon.r + 4, 'precondition: the badge is wider than the check');
    assert.ok(Math.abs(t2.l - (icon2.r + 4)) <= 1, 'the tip did not move with the wider badge: ' + JSON.stringify([t2.l, icon2.r]));
    await page.mouse.move(AWAY.x, AWAY.y);
    await flush();
    assert.equal(await TIP(), null, 'the tip stayed after the cursor left');
});

/* The header buttons are those that are in it: history and access (given by the portal), "Download", the mode switch. There is no comments button in the
   header - and certainly no hint for it (the panel is "Collaboration → Comments" and Ctrl+Shift+H). */
test('header_buttons_tips_under_the_button', async () => {
    await fresh({options: {canViewComments: true, canUseHistory: true, canRequestSharingSettings: true}}, 1440, true);
    const vw = await page.evaluate(() => innerWidth);
    const hd = await page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-hd .vo-ib, #vo-shell .vo-hd .vo-mode, #vo-shell .vo-hd .vo-hd-state')]
        .filter(n => n.getClientRects().length).map(n => { const r = n.getBoundingClientRect(); return {k: n.className, l: r.left, t: r.top, r: r.right, b: r.bottom}; }));
    assert.equal(await page.evaluate(() => !!document.querySelector('#vo-shell .vo-hd .vo-hd-comments')), false, '«Comments» in the header');
    const right = await page.evaluate(() => [...document.querySelectorAll('#vo-shell .vo-hd .vo-hd-right > *')].map(n => n.className));
    assert.equal(right.length, 4, 'precondition: history, «Download», sharing and the mode switch in the header: ' + JSON.stringify(right));
    for (const [sel, want] of [['#vo-shell .vo-hd .vo-hd-history', 'Version history'], ['#vo-shell .vo-hd .vo-hd-download', 'Download as'],
        ['#vo-shell .vo-hd .vo-hd-sharing', 'Sharing settings'], ['#vo-shell .vo-hd .vo-docmode .vo-mode', 'Mode']]) {
        const r = await hoverTip(sel);
        assert.ok(r.tip, 'no tip on ' + want);
        assert.equal(r.tip.text, want, 'header button tip');
        assert.ok(r.ms >= 480, want + ': the tip came without the delay (' + r.ms + ')');
        const b = await boxOf(sel);
        assert.ok(Math.abs(r.tip.t - (b.b + 4)) <= 1, want + ': the tip is not under the button (' + (b.b + 4) + ' vs ' + r.tip.t + ')');
        assert.ok(r.tip.l >= 8 && r.tip.r <= vw - 8, want + ': the tip is closer than 8 px to the window edge: ' + JSON.stringify(r.tip));
        assert.deepEqual(hd.filter(c => hits(c, r.tip)).map(c => c.k), [], want + ': the tip covers header controls');
        await page.mouse.move(AWAY.x, AWAY.y);
        await flush();
        assert.equal(await TIP(), null, want + ': the tip stayed after the cursor left');
    }
});

/* The negative control of a double hint in the header: the buttons, the switch and the save icon have no title, the text is in
   aria-description. The workbook name does not count: its own title is the full name. */
test('no_title_on_header_controls', async () => {
    await fresh({options: {canViewComments: true}}, 1440, true);
    const r = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('#vo-shell .vo-hd .vo-ib, #vo-shell .vo-hd .vo-mode, #vo-shell .vo-hd .vo-hd-state')];
        return {n: nodes.length, titled: [...document.querySelectorAll('#vo-shell .vo-hd [title]:not(.vo-hd-title)')].map(n => n.className),
                bare: nodes.filter(n => !n.getAttribute('aria-description')).map(n => n.className)};
    });
    assert.ok(r.n >= 3, 'precondition: header controls ' + r.n);
    assert.deepEqual(r.titled, [], 'header nodes with title — the browser would show its own tip too');
    assert.deepEqual(r.bare, [], 'header controls without the tip text');
});

test('no_header_tip_over_the_mode_list_and_in_focus_mode', async () => {
    await fresh({}, 1440, true);
    await page.click('#vo-shell .vo-hd .vo-docmode .vo-mode');
    await flush();
    assert.ok(await page.evaluate(() => SSE.Views.CompactShell.modeOpen()), 'precondition: the mode list opened');
    let r = await hoverTip('#vo-shell .vo-hd .vo-hd-state', 900);
    assert.equal(r.tip, null, 'a header tip over the open mode list');
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
    const icon = await boxOf('#vo-shell .vo-hd .vo-hd-state');
    await page.evaluate(() => SSE.Views.CompactShell.toggleFocus());
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.querySelector('#vo-shell .vo-hd').getClientRects().length), 0, 'precondition: no header in the focus mode');
    await page.mouse.move(AWAY.x, AWAY.y);
    await page.mouse.move(icon.x, icon.y);
    await page.waitForTimeout(900);
    const t = await TIP();
    assert.ok(!t || ['Saved', 'Mode'].indexOf(t.text) < 0, 'a header tip in the focus mode: ' + (t && t.text));
    await page.evaluate(() => SSE.Views.CompactShell.toggleFocus());
    await page.mouse.move(AWAY.x, AWAY.y);
});

/* --- "⋯", the row measurement with the core, focus mode ------------------------------------- */

const NON_CORE = ROW_ORDER.filter(k => !CORE.includes(k));
/* What is visible in the row: controls without vo-collapsed with a nonzero width, "⋯" and the right edge. */
const ROW = () => page.evaluate(() => {
    const bar = document.getElementById('vo-tb');
    const vis = el => !!el && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
    const items = [...bar.querySelectorAll(':scope > .vo-g > [data-ctrl]')];
    const more = bar.querySelector('.vo-more-wrap'), end = bar.querySelector('.vo-tb-end');
    const br = bar.getBoundingClientRect(), cs = getComputedStyle(bar);
    return {visible: items.filter(vis).map(n => n.getAttribute('data-ctrl')),
            gone: [...bar.querySelectorAll('[data-ctrl].vo-collapsed')].map(n => n.getAttribute('data-ctrl')),
            more: vis(more), moreRight: vis(more) ? more.getBoundingClientRect().right : null,
            lastRight: Math.max(...items.filter(vis).map(n => n.getBoundingClientRect().right)),
            endLeft: end.getBoundingClientRect().left, endRight: end.getBoundingClientRect().right,
            focusIn: !!end.querySelector('.vo-focus-btn'), endLast: [...bar.children].filter(c => !c.classList.contains('vo-tb-mask')).pop() === end,
            barRight: br.right - parseFloat(cs.paddingRight), barW: bar.clientWidth,
            scroll: bar.scrollWidth > bar.clientWidth + 1};
});
const relayout = () => page.evaluate(() => { SSE.Views.CompactToolbar.relayout(); return SSE.Views.CompactToolbar.fit; });

/* The core never goes away (it used to be "a core of 11", core_eleven_never_collapse). */
test('core_never_collapses', async () => {
    /* Narrower than the core: exactly the core stays, everything else is in "⋯". At 700 the row start fits next to the core ("₽" is the first
       non-core, it goes last), but the tail still goes first - from the end of the row. */
    for (const width of [600, 700]) {
        await fresh({}, width);
        await withStockBody();
        await page.evaluate(BUILD);
        await relayout();
        const r = await ROW();
        assert.deepEqual(r.visible.filter(k => CORE.includes(k)), CORE, width + ': the core is complete');
        assert.deepEqual(r.gone, NON_CORE.slice(NON_CORE.length - r.gone.length), width + ': gone is not the end of the non-core order');
        if (width === 600) {
            assert.deepEqual(r.visible, CORE, width + ': the row at its narrowest is the core');
            assert.deepEqual(r.gone.slice().sort(), NON_CORE.slice().sort(), width + ': every non-core control is in «⋯»');
        }
        assert.equal(r.more, true, width + ': «⋯» is the only way to the collapsed controls');
    }
    /* Wider: the whole core, and between the core (the number format "123", the font size) the non-core ones go from
       the end - the font list before the currency, although it stands to the right of it and to the left of the font size. */
    for (const width of [900, 1000]) {
        await fresh({}, width);
        await page.evaluate(BUILD);
        await relayout();
        const r = await ROW();
        assert.deepEqual(r.visible.filter(k => CORE.includes(k)), CORE, width + ': the core is complete');
        assert.deepEqual(r.gone, NON_CORE.slice(NON_CORE.length - r.gone.length), width + ': gone is not the end of the non-core order');
        if (width === 900) assert.ok(r.gone.includes('font') && r.visible.includes('currency') && r.visible.includes('numfmt'),
            width + ': font must go before currency: ' + r.visible.join(' '));
    }
});

/* How many are visible in the row by window width (the row = the window − the shell padding): 1280 - 23 (up to "Merge"), 1366 - 25 (plus sort and
   filter), 1440 - 26 (plus Σ), 1536 - 28 (plus "Clear format" and "Vertical"), 1680 - 32 (counted on measured widths),
   without a tolerance. */
const VISIBLE = {1280: 23, 1366: 25, 1440: 26, 1536: 28, 1680: 32};
test('overflow_takes_non_core_from_end', async () => {
    assert.ok(/body\s*\{\s*margin:\s*0;/.test(fs.readFileSync(path.join(ROOT, 'apps/common/main/resources/mods/less/normalize.less'), 'utf8')),
        'the stock no longer resets the body margin — recheck STOCK_BODY');
    const seen = {};
    for (const width of Object.keys(VISIBLE).map(Number)) {
        await fresh({}, width);
        await withStockBody();
        await page.evaluate(BUILD);
        await relayout();
        const r = await ROW();
        seen[width] = r.visible.length;
        assert.deepEqual(r.gone, NON_CORE.slice(NON_CORE.length - r.gone.length), width + ': gone controls are not the end of the non-core order');
        assert.deepEqual(r.visible.filter(k => CORE.includes(k)), CORE, width + ': the core is complete');
        assert.ok(r.more, width + ': «⋯» hidden while controls are gone');
        assert.ok(r.lastRight <= r.moreRight, width + ': «⋯» stands right after the last visible group');
        assert.equal(r.scroll, false, width + ': the row overflows its card');
    }
    assert.deepEqual(seen, VISIBLE, 'visible controls by window width');
});

/* A window where the whole row fits: 1920 - all. */
const ALL_FIT = 1920;
test('overflow_hidden_when_all_fit', async () => {
    await fresh({}, ALL_FIT);
    await page.evaluate(BUILD);
    await relayout();
    const r = await ROW();
    assert.deepEqual(r.visible, ROW_ORDER, ALL_FIT + ': the whole row');
    assert.equal(r.more, false, '«⋯» shown although everything fits');
});

test('no_permanent_tail', async () => {
    await fresh({}, ALL_FIT);
    await page.evaluate(BUILD);
    await relayout();
    await page.evaluate(() => SSE.Views.CompactToolbar.toggleOverflow());
    assert.equal(await page.evaluate(() => document.getElementById('vo-tb').classList.contains('vo-of-open')), false,
        '«⋯» opens a tail although everything fits');
    await fresh({}, 1440);
    await page.evaluate(BUILD);
    await relayout();
    const before = await ROW();
    await page.click('#vo-tb .vo-more');
    const inPop = await page.evaluate(() => [...document.querySelectorAll('#vo-tb .vo-of-pop [data-ctrl]')].map(n => n.getAttribute('data-ctrl')));
    assert.deepEqual(inPop, before.gone, '«⋯» holds exactly the controls that did not fit, in row order');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#vo-tb .vo-of-pop')).display), 'flex');
    /* A control from "⋯" works in place: its own list expands inside, "⋯" is not closed. */
    await page.click('#vo-tb .vo-of-pop [data-ctrl="valign"] > button');
    assert.equal(await page.evaluate(() => document.getElementById('vo-tb').classList.contains('vo-of-open')), true, 'opening a list in «⋯» closed «⋯»');
    assert.equal(await page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="valign"]').classList.contains('open')), true);
    await page.click('#vo-tb .vo-more');
    assert.deepEqual(await keysOf(), ROW_ORDER, 'controls came back home in the row order');
    assert.deepEqual((await ROW()).gone, before.gone, 'the row is measured again after «⋯» closes');
});

/* The stock global border-box (common/main/resources/mods/less/scaffolding.less, it is
   included by the spreadsheet editor app.less): in the editor it is on every node. */
const STOCK_BOX = '*, *:before, *:after { box-sizing: border-box; }';
const withStockBox = () => page.addStyleTag({content: STOCK_BOX});
/* The stock page margins: the standard normalize.less (common/main/resources/mods/less, included by the spreadsheet editor app.less) removes the body margin -
   in the editor the row = the window − 40 (the shell padding 20 + 20), while the bare test page body margin 8 + 8 would narrow the row
   by another 16. The row count by window width (at 1280 the reserve is 0 px) is checked in the editor layout. */
const STOCK_BODY = 'body { margin: 0; }';
const withStockBody = () => page.addStyleTag({content: STOCK_BODY});

/* "⋯" is 440 (420 + padding 10 + 10, content-box), not 420 under
   the stock border-box. The layout in it at 1440 - the groups of the ones that went away in row order, by lines of width 440: editing, "Vertical" with
   "Print" and insert - the first line, the end of the row - the second. The page margins are the stock's (STOCK_BODY): what went away is decided by the editor row. */
test('overflow_pop_width_440', async () => {
    await fresh({}, 1440);
    assert.ok(fs.readFileSync(path.join(ROOT, 'apps/common/main/resources/mods/less/scaffolding.less'), 'utf8').includes('.box-sizing(border-box)'),
        'the stock no longer resets box-sizing — recheck STOCK_BOX');
    await withStockBox();
    await withStockBody();
    await page.evaluate(BUILD);
    await relayout();
    await page.click('#vo-tb .vo-more');
    const r = await page.evaluate(async () => {
        const pop = document.querySelector('#vo-tb .vo-of-pop');
        /* The measurement is after the appearing animation (scale distorts the frame). */
        await Promise.all(pop.getAnimations().map(a => a.finished));
        const tops = {};
        [...pop.querySelectorAll('[data-ctrl]')].forEach(n => {
            const t = Math.round(n.getBoundingClientRect().top);
            (tops[t] = tops[t] || []).push(n.getAttribute('data-ctrl'));
        });
        return {w: pop.getBoundingClientRect().width, rows: Object.keys(tops).sort((a, b) => a - b).map(t => tops[t])};
    });
    assert.ok(Math.abs(r.w - 440) <= 1, '«⋯» is ' + r.w + ' wide, expected 440');
    assert.deepEqual(r.rows, [['clear', 'valign', 'print', 'link', 'chart', 'image'], ['condfmt', 'rotate', 'validate', 'freeze']],
        'controls in «⋯» are laid out unlike the row order in a 440 list: ' + JSON.stringify(r.rows));
});

/* Value lists have a ceiling of 320 with a scroll (the Documents recipe
   .vo-pop-value), 340 outside; the current value of a long list is visible at once.
   Menu lists keep the window height limit. */
test('value_lists_capped', async () => {
    const fonts = Array.from({length: 150}, (_, i) => 'Font ' + String(i).padStart(3, '0'));
    fonts.splice(120, 0, 'Calibri');
    await fresh({fonts}, 1440);
    await withStockBox();
    await page.evaluate(BUILD);
    await relayout();
    const open = async k => {
        await page.evaluate(() => SSE.Views.CompactToolbar.closeSurfaces());
        await page.click(btnOf(k));
        return page.evaluate(async sel => {
            const pop = document.querySelector(sel + ' > .vo-pop');
            await Promise.all(pop.getAnimations().map(a => a.finished));
            const pr = pop.getBoundingClientRect();
            const on = pop.querySelector('.vo-pop-item.on'), or = on && on.getBoundingClientRect();
            return {h: pr.height, max: getComputedStyle(pop).maxHeight, scrolls: pop.scrollHeight > pop.clientHeight,
                    onText: on && on.querySelector('.vo-pop-t').textContent, onSeen: !!or && or.top >= pr.top && or.bottom <= pr.bottom};
        }, ctrlSel(k));
    };
    const font = await open('font');
    assert.equal(font.max, '320px', 'font list cap');
    assert.ok(Math.abs(font.h - 340) <= 1, 'font list is ' + font.h + ' tall, expected 340');
    assert.equal(font.scrolls, true, 'font list does not scroll');
    assert.deepEqual([font.onText, font.onSeen], ['Calibri', true], 'the current font is out of sight when the list opens');
    /* A short value list is not cut - zoom (six rows). The number format is the "123" button with a menu list: the limit is the window
       height, all sixteen rows are visible without scrolling. */
    const zm = await open('zoom');
    assert.equal(zm.max, '320px', 'zoom list cap');
    assert.ok(!zm.scrolls && zm.h < 320, 'a short value list (zoom) is cut: ' + JSON.stringify(zm));
    const nf = await open('numfmt');
    assert.notEqual(nf.max, '320px', 'the number format list is capped as a value list');
    assert.ok(!nf.scrolls, 'the number format list scrolls: ' + JSON.stringify(nf));
    const borders = await open('borders');
    assert.notEqual(borders.max, '320px', 'menu lists keep the window-height limit');
});

/* The wheel over lists opened by the standard shell path - a menu row section,
   its submenu and a panel list. The SDK wheel handler on an ancestor (sdkjs apiBase: #viewport and
   body.onmousewheel on macOS) suppresses a plain wheel on bubbling, so every list has its own
   handler (CompactShell.bindListScroll, for the panel - CompactToolbar.bindPopScroll): the list
   scrolls, the event does not reach the SDK. The helper itself is held by
   sheet-actions.cjs (long_menu_scrolls_with_wheel); here - that it is bound where the lists
   are born. Real wheel events over real markup and styles. */
test('shell_lists_scroll_with_wheel', async () => {
    await fresh({fonts: Array.from({length: 150}, (_, i) => 'Font ' + String(i).padStart(3, '0'))}, 1440, true);
    await page.setViewportSize({width: 1440, height: 360});
    await page.evaluate(() => {
        /* The long submenu "View → Freeze panes ▸" is a mirror of the double standard menu. */
        for (let i = 0; i < 40; i++) {
            const it = window.item('Row ' + i);
            it.on('click', (x, e) => twins.freeze.menu.trigger('item:click', twins.freeze.menu, x, e));
            twins.freeze.menu.items.push(it);
        }
        window.sdkWheel = [];
        ['wheel', 'mousewheel', 'DOMMouseScroll'].forEach(type => document.body.addEventListener(type, ev => {
            sdkWheel.push(type);
            if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.altKey) ev.preventDefault();
        }, {passive: false}));
    });
    const spin = async (sel, what) => {
        const box = await page.evaluate(s => {
            const el = document.querySelector(s);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {x: r.left + r.width / 2, y: r.top + Math.min(40, r.height / 2), long: el.scrollHeight > el.clientHeight + 20, top: el.scrollTop};
        }, sel);
        assert.ok(box, what + ': the list is not open (' + sel + ')');
        assert.ok(box.long, what + ': precondition — the list is longer than its box');
        await page.evaluate(() => { sdkWheel.length = 0; });
        await page.mouse.move(box.x, box.y);
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(250);
        const after = await page.evaluate(s => ({top: document.querySelector(s).scrollTop, sdk: sdkWheel.slice()}), sel);
        assert.ok(after.top > box.top, what + ' did not scroll with the wheel: ' + JSON.stringify([box.top, after.top]));
        assert.deepEqual(after.sdk, [], what + ': the SDK wheel handler saw the event');
    };
    /* A menu row section - by the section button. */
    await page.click('#vo-shell .vo-mn-item');
    await spin('#vo-shell .vo-mn-drop.open[data-level="0"]', 'menu section');
    /* A section submenu - by a row with ▸. */
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
    await page.click('#vo-shell .vo-mn-item[data-k="view"]');
    await page.click('#vo-shell .vo-mn-drop.open .vo-mn-sub[data-k="freeze"]');
    await spin('#vo-shell .vo-mn-fly[data-level="1"]', 'submenu');
    /* A panel list - by the control button. */
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());
    await page.click(btnOf('font'));
    await page.evaluate(sel => Promise.all(document.querySelector(sel).getAnimations().map(a => a.finished)), ctrlSel('font') + ' > .vo-pop');
    await spin(ctrlSel('font') + ' > .vo-pop', 'toolbar list');
});

test('focus_chevron_in_right_edge', async () => {
    for (const width of [900, 1280, 1920]) {
        await fresh({}, width);
        await page.evaluate(BUILD);
        await relayout();
        const r = await ROW();
        assert.ok(r.focusIn && r.endLast, width + ': the focus chevron is not the right edge of the row');
        assert.ok(Math.abs(r.endRight - r.barRight) <= 1, width + ': chevron ' + r.endRight + ' is not at the right edge ' + r.barRight);
        if (r.more) assert.ok(r.moreRight <= r.endLeft, width + ': «⋯» overlaps the chevron');
        else assert.ok(r.lastRight <= r.endLeft, width + ': the row overlaps the chevron');
        assert.equal(r.scroll, false, width + ': the chevron is pushed out of the card');
    }
    const glyph = await page.evaluate(() => document.querySelector('#vo-tb .vo-focus-btn').innerHTML);
    assert.equal(glyph, await page.evaluate(() => Common.UI.Compact.Icons.svg('chevron', 18)), 'focus control is the chevron, as in documents');
});

/* The focus mode chevron glyph rotation is 0.15 s of the compact common curve
   (the chevron is 0.15 s, the curve is common), like the formula bar chevron
   (formula-bar.cjs chevron_rotates_150ms). The real compact-shell.less in real Chrome: the computed
   glyph transition and the transition itself on the .on change (CSSTransition transform, 150 ms, @vo-ease);
   expanded - flipped by 180°, in focus - without rotation. "Reduce motion" - without a transition. */
test('focus_chevron_turns_150ms', async () => {
    await fresh({}, 1440);
    await page.evaluate(BUILD);
    const ease = /^@vo-ease:\s*cubic-bezier\(([^)]+)\);/m.exec(LESS_SRC);
    assert.ok(ease, '@vo-ease is not in compact-shell.less');
    const EASE = 'cubic-bezier(' + ease[1].split(',').map(v => String(parseFloat(v))).join(', ') + ')';
    assert.equal(/^@vo-dur-state:\s*([^;]+);/m.exec(LESS_SRC)[1], '.15s', '@vo-dur-state');
    const turn = () => page.evaluate(() => new Promise(r => {
        const btn = document.querySelector('#vo-tb .vo-focus-btn'), g = btn.querySelector('.vo-air, svg');
        const c = getComputedStyle(g), still = {prop: c.transitionProperty, dur: c.transitionDuration, ease: c.transitionTimingFunction, transform: c.transform};
        btn.classList.toggle('on');
        const anim = g.getAnimations().filter(a => a.transitionProperty === 'transform').map(a => {
            const t = a.effect.getTiming();
            return {duration: t.duration, easing: t.easing};
        });
        g.getAnimations().forEach(a => a.finish());
        const end = getComputedStyle(g).transform;
        btn.classList.toggle('on');
        g.getAnimations().forEach(a => a.finish());
        r({glyph: g.tagName + '.' + (g.getAttribute('class') || ''), still, anim, end});
    }));
    const r = await turn();
    assert.equal(r.glyph, 'SPAN.vo-air', 'the focus chevron glyph is not the AIR mask');
    assert.deepEqual([r.still.prop, r.still.dur, r.still.ease], ['transform', '0.15s', EASE], 'chevron transition: ' + JSON.stringify(r.still));
    assert.ok(/^matrix\(-1, [^,]+, [^,]+, -1, 0, 0\)$/.test(r.still.transform), 'unfolded chevron is not turned by 180°: ' + r.still.transform);
    assert.equal(r.end, 'none', 'chevron in focus mode is turned: ' + r.end);
    assert.deepEqual(r.anim, [{duration: 150, easing: EASE}], 'the turn is not one 150 ms transition on the compact curve: ' + JSON.stringify(r.anim));
    await page.emulateMedia({reducedMotion: 'reduce'});
    try {
        const m = await turn();
        assert.equal(m.still.dur, '0s', 'reduced motion: chevron still has a transition ' + JSON.stringify(m.still));
        assert.deepEqual(m.anim, [], 'reduced motion: the chevron turn is animated');
        assert.equal(m.end, 'none', 'reduced motion: chevron in focus mode is turned');
    } finally {
        await page.emulateMedia({reducedMotion: 'no-preference'});
    }
});

/* Hover and press of the buttons on the card are Documents-style (the @vo-hover / @vo-active blend); a pressed
   button is as on the white Documents panel card (the design-tinted-bg underlay, a blue glyph), and
   on hover too. All row controls: the button, the font size box (the field has no pressed look), "⋯", the focus chevron. */
test('plate_hover_and_press_like_documents', async () => {
    await fresh({}, 1280);
    await page.evaluate(BUILD);
    await relayout();
    const HOVER = 'rgba(0, 0, 0, 0.03)', PRESS = 'rgba(0, 0, 0, 0.06)', TINTED = 'rgb(230, 244, 255)', BLUE = 'rgb(0, 117, 255)';
    const look = sel => page.evaluate(s => new Promise(r => setTimeout(() => {
        const b = document.querySelector(s), c = getComputedStyle(b);
        r({bg: c.backgroundColor, color: c.color, hover: b.matches(':hover'), active: b.matches(':active')});
    }, 250)), sel);
    const plate = await page.evaluate(() => {
        /* The card is the wrapper of the panel row and the formula bar (#vo-plate). */
        const tb = document.getElementById('vo-plate'), c = getComputedStyle(tb), o = getComputedStyle(tb, '::after');
        return {bg: c.backgroundColor, shadow: c.boxShadow, stroke: o.borderTopStyle + ' ' + o.borderTopColor, w: parseFloat(o.borderTopWidth)};
    });
    assert.deepEqual([plate.bg, plate.shadow, plate.stroke], ['rgb(255, 255, 255)', 'none', 'solid rgb(237, 238, 240)'],
        'precondition: the toolbar is the outline plate: ' + JSON.stringify(plate));
    assert.ok(plate.w >= 1, 'precondition: the outline of the plate has no width: ' + JSON.stringify(plate));
    const sels = {button: btnOf('italic'), size: '#vo-tb .vo-size .vo-size-box', more: '#vo-tb .vo-more', focus: '#vo-tb .vo-focus-btn'};
    for (const [what, sel] of Object.entries(sels)) {
        assert.ok(await page.evaluate(s => { const b = document.querySelector(s); return !!b && b.getClientRects().length > 0; }, sel), what + ' is not shown at 1280');
        await page.hover(sel);
        const h = await look(sel);
        assert.ok(h.hover, 'precondition: the pointer is over ' + what);
        assert.equal(h.bg, HOVER, what + ': hover on the plate is not the document hover');
        if (what === 'size') { await page.mouse.move(5, 790); continue; }
        await page.mouse.down();
        const a = await look(sel);
        await page.mouse.up();
        await page.mouse.move(5, 790);
        if (a.active) assert.equal(a.bg, PRESS, what + ': press on the plate is not the document press');
    }
    /* :active without a mouse - the stylesheet rule for a pressed row button. */
    const pressRules = await page.evaluate(() => [...document.styleSheets[0].cssRules]
        .filter(r => r.selectorText && /#vo-tb/.test(r.selectorText) && /:active/.test(r.selectorText) && !/\.on|vo-of-pop/.test(r.selectorText) && r.style.backgroundColor)
        .map(r => r.selectorText + ' ' + r.style.backgroundColor));
    assert.deepEqual(pressRules, [], 'the plate has its own press colour');
    await page.evaluate(s => document.querySelector(s).classList.add('on'), btnOf('bold'));
    const pr = await look(btnOf('bold'));
    assert.deepEqual([pr.bg, pr.color], [TINTED, BLUE], 'pressed «Ж» on the plate is not the document pressed look');
    await page.hover(btnOf('bold'));
    const ph = await look(btnOf('bold'));
    assert.ok(ph.hover, 'precondition: the pointer is over the pressed «Ж»');
    assert.deepEqual([ph.bg, ph.color], [TINTED, BLUE], 'hovered pressed «Ж» changed its look');
});

/* A mouse press on a panel button looks pressed even when the browser removes
   :active. In the editor the engine on the same press moves focus into its own field (#area_id - after
   mousedown, focusHtmlElement), and Chrome resets :active on the button: it stayed in the hover
   look. Here is the same move - focus that went to the button is returned by the "engine" to its field. While the
   mouse button is held - the press background (--vo-active, for a pressed "Bold" on the card - its underlay, as for :active),
   released - hover again; a disabled button has no pressed look; the window losing focus and
   pointercancel remove the press. */
test('press_look_survives_engine_focus', async () => {
    await fresh({}, 1280);
    await page.evaluate(BUILD);
    await relayout();
    await page.evaluate(() => {
        const area = document.createElement('textarea');
        area.id = 'area_id';
        area.style.cssText = 'position:fixed;left:0;bottom:0;width:10px;height:10px';
        document.body.appendChild(area);
        /* Like the engine: focus that went from its field to a button (the mousedown default action) it
           returns to itself right away. */
        area.focus();
        window.addEventListener('focusin', e => { if (e.target !== area) area.focus(); }, true);
    });
    const HOVER = 'rgba(0, 0, 0, 0.03)', PRESS = 'rgba(0, 0, 0, 0.06)', TINTED = 'rgb(230, 244, 255)';
    const look = sel => page.evaluate(s => new Promise(r => setTimeout(() => {
        const b = document.querySelector(s);
        b.getAnimations().forEach(a => a.finish());
        r({bg: getComputedStyle(b).backgroundColor, active: b.matches(':active'), pressing: b.classList.contains('vo-pressing'),
           engine: document.activeElement && document.activeElement.id});
    }, 50)), sel);
    /* The font size chevron is part of the font size field: it has no pressed look of its own, like the value list chevron. */
    const sels = {button: btnOf('undo'), more: '#vo-tb .vo-more', focus: '#vo-tb .vo-focus-btn'};
    for (const [what, sel] of Object.entries(sels)) {
        await page.hover(sel);
        await page.mouse.down();
        const a = await look(sel);
        assert.equal(a.engine, 'area_id', 'precondition: the "engine" took the focus on the press of ' + what);
        assert.equal(a.active, false, 'precondition: Chrome dropped :active of ' + what + ' on the engine focus');
        assert.equal(a.bg, PRESS, what + ': held mouse button does not look pressed (' + a.bg + ')');
        await page.mouse.up();
        const u = await look(sel);
        assert.equal(u.pressing, false, what + ': the press look stays after the release');
        assert.equal(u.bg, HOVER, what + ': released button is not back to hover (' + u.bg + ')');
        await page.mouse.move(5, 790);
    }
    /* A pressed "Bold" on the card keeps its underlay in a press too, as for :active. */
    await page.evaluate(s => document.querySelector(s).classList.add('on'), btnOf('bold'));
    await page.hover(btnOf('bold'));
    await page.mouse.down();
    assert.equal((await look(btnOf('bold'))).bg, TINTED, 'pressed «Ж» on the plate lost its look while held');
    await page.mouse.up();
    /* A disabled button does not look pressed. It is disabled by its double - so the panel will not turn it back on
       with its check against the stock (soon) while the press goes on. */
    await page.evaluate(() => { twins.btnUnderline.setDisabled(true); SSE.Views.CompactToolbar.refresh(); });
    await flush();
    assert.equal(await page.evaluate(s => document.querySelector(s).disabled, btnOf('underline')), true, 'precondition: «Ч» is disabled');
    const off = await page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; }, btnOf('underline'));
    await page.mouse.move(off.x, off.y);
    await page.mouse.down();
    assert.equal((await look(btnOf('underline'))).pressing, false, 'a disabled button got the press look');
    await page.mouse.up();
    /* A release outside the window: the window losing focus and pointercancel remove the press. */
    for (const how of ['blur', 'pointercancel']) {
        await page.hover(btnOf('italic'));
        await page.mouse.down();
        assert.equal((await look(btnOf('italic'))).pressing, true, how + ': precondition: pressed');
        await page.evaluate(h => window.dispatchEvent(new Event(h)), how);
        assert.equal((await look(btnOf('italic'))).pressing, false, how + ' did not drop the press look');
        await page.mouse.up();
    }
});

/* A mouse press on the header buttons and on the return-from-Standard button - the same reason as for the panel:
   the engine on a press takes focus to its field, and Chrome removes :active. While the mouse button is held,
   the button looks as on :active: "History" - the press blend, "Access" (tinted) - tinted-act,
   the return button (.vo-mode outline) - outline-act; the filled mode switch has no pressed look of its own -
   held, it is in the hover look (accent-hover); "Download", as in Documents, has no
   underlay either on hover or on press. Released (outside the button - without a click) - no sign. */
test('header_press_look_survives_engine_focus', async () => {
    await fresh({options: {canViewComments: true, canUseHistory: true, canRequestSharingSettings: true}}, 1440, true);
    await page.evaluate(() => {
        const area = document.createElement('textarea');
        area.id = 'area_id';
        area.style.cssText = 'position:fixed;left:0;bottom:0;width:10px;height:10px';
        document.body.appendChild(area);
        area.focus();
        window.addEventListener('focusin', e => { if (e.target !== area) area.focus(); }, true);
    });
    const EXPECTED = {history: 'rgba(0, 0, 0, 0.06)', download: 'rgba(0, 0, 0, 0)', sharing: 'rgb(216, 229, 240)', mode: 'rgb(0, 114, 248)',
        back: 'rgb(240, 240, 240)'};
    const HOVER = {history: 'rgba(0, 0, 0, 0.03)', download: 'rgba(0, 0, 0, 0)', sharing: 'rgb(223, 237, 247)', mode: 'rgb(0, 114, 248)',
        back: 'rgb(247, 247, 247)'};
    const SEL = {history: '#vo-shell .vo-hd .vo-hd-history', mode: '#vo-shell .vo-hd .vo-docmode > .vo-mode',
        download: '#vo-shell .vo-hd .vo-download > .vo-ib', sharing: '#vo-shell .vo-hd .vo-hd-sharing', back: '#vo-back'};
    const look = sel => page.evaluate(s => new Promise(r => setTimeout(() => {
        const b = document.querySelector(s);
        if (!b) { r(null); return; }
        b.getAnimations().forEach(a => a.finish());
        r({bg: getComputedStyle(b).backgroundColor, active: b.matches(':active'), pressing: b.classList.contains('vo-pressing'),
           engine: document.activeElement && document.activeElement.id});
    }, 50)), sel);
    const press = async what => {
        const sel = SEL[what];
        await page.hover(sel);
        const h = await look(sel);
        assert.equal(h.bg, HOVER[what], 'precondition: hover on ' + what + ' (' + h.bg + ')');
        await page.mouse.down();
        const a = await look(sel);
        await page.mouse.move(5, 790);
        await page.mouse.up();
        const u = await look(sel);
        return {a, u};
    };
    for (const what of ['history', 'mode', 'download', 'sharing']) {
        assert.ok(await look(SEL[what]), 'precondition: ' + what + ' is in the header');
        const {a, u} = await press(what);
        assert.equal(a.engine, 'area_id', 'precondition: the "engine" took the focus on the press of ' + what);
        assert.equal(a.active, false, 'precondition: Chrome dropped :active of ' + what + ' on the engine focus');
        assert.equal(a.bg, EXPECTED[what], what + ': held mouse button does not look as :active (' + a.bg + ' != ' + EXPECTED[what] + ')');
        assert.equal(u.pressing, false, what + ': the press look stays after the release');
    }
    /* The Standard: the return button in the standard header. */
    await page.evaluate(() => SSE.Views.CompactShell.toggleMode());
    await flush();
    assert.ok(await look(SEL.back), 'precondition: the back button is in the stock header');
    const back = await press('back');
    assert.equal(back.a.engine, 'area_id', 'precondition: the "engine" took the focus on the press of the back button');
    assert.equal(back.a.bg, EXPECTED.back, 'back button: held mouse button does not look pressed (' + back.a.bg + ')');
    assert.equal(back.u.pressing, false, 'back button: the press look stays after the release');
    assert.equal(await page.evaluate(() => document.body.classList.contains('vo-advanced')), true, 'a press released outside the back button left the advanced view');
});

test('mask_excluded_from_measure', async () => {
    await fresh({}, 1440);
    await page.evaluate(BUILD);
    const free = await relayout();
    await page.evaluate(() => SSE.Views.CompactToolbar.setLocked(true));
    const masked = await relayout();
    assert.deepEqual(masked, free, 'the lock mask changed the measure');
    const mask = await page.evaluate(() => { const m = document.querySelector('#vo-tb .vo-tb-mask'), b = document.getElementById('vo-tb');
        return m ? [Math.round(m.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().width)] : null; });
    assert.ok(mask && mask[0] === mask[1], 'mask covers the whole card: ' + mask);
});

test('lock_removes_tab_order', async () => {
    await fresh({}, 1440);
    await page.evaluate(BUILD);
    await page.focus('#vo-tb [data-ctrl="bold"]');
    await page.evaluate(() => SSE.Views.CompactToolbar.setLocked(true));
    const locked = await page.evaluate(() => {
        const live = [...document.querySelectorAll('#vo-tb button, #vo-tb input')];
        return {n: live.length, free: live.filter(el => el.getAttribute('tabindex') !== '-1').length,
                focused: document.getElementById('vo-tb').contains(document.activeElement),
                masked: document.getElementById('vo-tb').classList.contains('vo-masked')};
    });
    assert.ok(locked.n >= 35, 'controls found: ' + locked.n);
    assert.equal(locked.free, 0, 'controls left in the tab order under the lock');
    assert.equal(locked.focused, false, 'focus stayed inside the locked toolbar');
    assert.equal(locked.masked, true);
    await page.evaluate(() => SSE.Views.CompactToolbar.setLocked(false));
    /* The row has roving tabindex (WAI-ARIA "Toolbar"): a removed restriction returns the row one
       Tab stop - a visible available control, not the standard order without tabindex. */
    const free = await page.evaluate(() => [...document.querySelectorAll('#vo-tb button, #vo-tb input')]
        .filter(el => el.getAttribute('tabindex') !== '-1').map(el => (el.closest('[data-ctrl]') || el).getAttribute('data-ctrl')));
    assert.equal(free.length, 1, 'the toolbar did not get its one Tab stop back after the lock was lifted: ' + JSON.stringify(free));
    assert.equal(await page.evaluate(() => { const b = [...document.querySelectorAll('#vo-tb button, #vo-tb input')].find(el => el.getAttribute('tabindex') === '0');
        return !!b && !b.disabled && b.getClientRects().length > 0; }), true, 'the Tab stop after the lock is not a visible active control');
    assert.equal(await page.evaluate(() => !!document.querySelector('#vo-tb .vo-tb-mask')), false);
});

const CHROME = () => page.evaluate(() => {
    const sh = SSE.Views.CompactShell, d = el => el ? getComputedStyle(el).display : null;
    return {focus: document.body.classList.contains('vo-focus'), tbHidden: document.body.classList.contains('vo-tb-hidden'),
            hd: d(document.querySelector('#vo-shell > .vo-hd')), mn: d(document.querySelector('#vo-shell > .vo-mn')),
            tb: d(document.getElementById('vo-tb')), height: sh.shellHeight(), model: vlayout.getItem('toolbar').height,
            chevron: document.querySelector('#vo-tb .vo-focus-btn').classList.contains('on')};
});

test('focus_hides_header_and_menu', async () => {
    await fresh({}, 1440, true);
    let c = await CHROME();
    assert.deepEqual([c.focus, c.hd, c.mn, c.tb, c.height, c.model], [false, 'flex', 'flex', 'flex', 132, 132], 'compact start: ' + JSON.stringify(c));
    await page.click('#vo-tb .vo-focus-btn');
    c = await CHROME();
    assert.deepEqual([c.focus, c.hd, c.mn, c.tb, c.height, c.model, c.chevron], [true, 'none', 'none', 'flex', 56, 56, true],
        'focus by the chevron: ' + JSON.stringify(c));
    await page.click('#vo-tb .vo-focus-btn');
    c = await CHROME();
    assert.deepEqual([c.focus, c.hd, c.height, c.chevron], [false, 'flex', 132, false], 'second chevron click returns the chrome');
    /* "View → Focus mode" is the same switch (a catalog item). */
    const run = () => page.evaluate(() => { const A = SSE.Views.SheetActions;
        const it = A.groups().find(g => g.label === A.textView).items.find(i => i.k === 'focus');
        return [A.itemState(it).disabled, A.exec(it)]; });
    assert.deepEqual(await run(), [false, true], 'View → Focus mode is alive');
    assert.equal((await CHROME()).height, 56);
    await run();
    assert.equal((await CHROME()).height, 132);
});

test('escape_closes_surface_before_chrome', async () => {
    await fresh({}, 2000, true);
    await page.click('#vo-tb .vo-focus-btn');
    await page.click('#vo-tb [data-ctrl="zoom"] > button');
    assert.equal(await page.evaluate(() => SSE.Views.CompactShell.hasOpenSurfaces()), true, 'precondition: the zoom list is open');
    await page.keyboard.press('Escape');
    let c = await CHROME();
    assert.equal(await page.evaluate(() => SSE.Views.CompactShell.hasOpenSurfaces()), false, 'the first Escape left the list open');
    assert.equal(c.focus, true, 'the first Escape left focus mode');
    /* A list submenu is a layer of its own: Escape removes it, the list stays. */
    await page.click('#vo-tb [data-ctrl="condfmt"] > button');
    await clickRow('condfmt', 'Highlight cells rules');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => [!!document.querySelector('#vo-tb .vo-pop-fly'), document.querySelector('#vo-tb [data-ctrl="condfmt"]').classList.contains('open')]),
        [false, true], 'one layer per Escape: submenu first');
    await page.keyboard.press('Escape');
    assert.equal((await CHROME()).focus, true, 'still in focus mode after closing the list');
    /* Escape in our font size field - to the field, not to the chrome. */
    await page.click('#vo-tb [data-ctrl="size"] input');
    await page.keyboard.press('Escape');
    assert.equal((await CHROME()).focus, true, 'Escape in the size field left focus mode');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    /* A cell edit - Escape goes to the engine. */
    await page.evaluate(() => { api.isCellEdited = true; });
    await page.keyboard.press('Escape');
    assert.equal((await CHROME()).focus, true, 'Escape during a cell edit left focus mode');
    await page.evaluate(() => { api.isCellEdited = false; });
    await page.keyboard.press('Escape');
    c = await CHROME();
    assert.deepEqual([c.focus, c.hd, c.mn, c.height], [false, 'flex', 'flex', 132], 'the next Escape returns the chrome');
});

/* An engine mode that is removed by Escape itself (sdkjs EventsController, Esc:
   stopFormatPainter, stopAddShape) takes the key entirely - one press, one action.
   "Format painter" is turned on from the panel (the Toolbar:btnCopyStyle double is pressed): the first Escape goes to
   the engine, the chrome stays; the engine removed the mode (the stock unpresses the double by asc_onStopFormatPainter) -
   the next Escape returns the chrome. The same for inserting a shape (asc_isAddAutoshape) and
   "Hide panel". */
test('escape_goes_to_engine_mode_first', async () => {
    await fresh({}, 2000, true);
    await page.click('#vo-tb .vo-focus-btn');
    await page.click(btnOf('paint'));
    await flush();
    assert.equal(await page.evaluate(() => twins.btnCopyStyle.pressed), true, 'precondition: format painter is on');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Escape');
    let c = await CHROME();
    assert.equal(c.focus, true, 'Escape with the format painter on also left focus mode (two actions on one key)');
    /* The engine removed the mode with the same key: the stock unpresses the double (Toolbar.onApiStyleChange). */
    await page.evaluate(() => twins.btnCopyStyle.toggle(false, true));
    await page.keyboard.press('Escape');
    c = await CHROME();
    assert.deepEqual([c.focus, c.hd, c.height], [false, 'flex', 132], 'the next Escape did not return the chrome');
    /* Inserting a shape. */
    await page.click('#vo-tb .vo-focus-btn');
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); api.asc_isAddAutoshape = () => true; });
    await page.keyboard.press('Escape');
    assert.equal((await CHROME()).focus, true, 'Escape while a shape is being added also left focus mode');
    await page.evaluate(() => { api.asc_isAddAutoshape = () => false; });
    await page.keyboard.press('Escape');
    assert.equal((await CHROME()).focus, false, 'Escape after the shape mode ended did not return the chrome');
    /* "Hide panel" - the same handler. */
    await page.evaluate(() => { SSE.Views.CompactShell.toggleToolbar(); twins.btnCopyStyle.toggle(true, true); });
    await page.keyboard.press('Escape');
    assert.equal((await CHROME()).tbHidden, true, 'Escape with the format painter on returned the hidden toolbar');
    await page.evaluate(() => twins.btnCopyStyle.toggle(false, true));
    await page.keyboard.press('Escape');
    assert.equal((await CHROME()).tbHidden, false, 'the next Escape did not return the hidden toolbar');
});

/* In focus mode Escape in a field of the standard left area panel - first to the field, the chrome
   is returned by the next Escape (one press - one action). The "Find" field of the stock search panel is
   a real input type=search node in #left-menu with the real onKeyDown, setValue and _doChange of
   Common.UI.InputField (as text from the file): Escape rolls the typed text back to the accepted one, the browser
   clears the search field. Typed text - the first Escape goes to the field (the text is removed, focus mode stays),
   the second - to the chrome. Text accepted with Enter - the same (it is removed by the search field default). A field with which
   Escape does nothing (the comment field: the stock has no Escape of its own there) - one action: the chrome,
   as before. An open list at the field (the class open on the wrapper) is closed by Escape itself - the chrome stays. */
const LEFT_FIELD = (onKeyDown, setValue, doChange) => `(() => {
    const lm = document.createElement('div');
    lm.id = 'left-menu';
    lm.innerHTML = '<div id="left-panel-search"><div class="vo-fx-wrap"><input type="search" id="vo-t-find"></div></div>' +
        '<div id="left-panel-comments"><textarea id="vo-t-comment"></textarea></div>';
    document.body.appendChild(lm);
    /* The search panel is open: the standard button is pressed, the area is shown (in the compact #left-menu is visible
       only under vo-left-open). */
    window.leftMenu.btnSearchBar.pressed = true;
    document.body.classList.add('vo-left-open');
    const el = document.getElementById('vo-t-find');
    const C = {UI: {Keys: {RETURN: 13, ESC: 27}}};
    const $ = node => ({val: () => node.value});
    const field = {value: '', rendered: true, validateOnBlur: false, trigger() {},
        _input: {val(v) { if (v === undefined) return el.value; el.value = v == null ? '' : v; }}};
    const make = src => new Function('$', 'Common', 'return ' + src)($, C);
    field.onKeyDown = make(${JSON.stringify(onKeyDown)});
    field.setValue = make(${JSON.stringify(setValue)});
    field._doChange = make(${JSON.stringify(doChange)});
    /* A jQuery event for standard methods: keyCode, target and the cancel flag. */
    el.addEventListener('keydown', e => field.onKeyDown({keyCode: e.keyCode, target: el, isDefaultPrevented: () => e.defaultPrevented}));
    window.findField = field;
    return true;
})()`;
test('escape_in_left_panel_field_goes_to_field_first', async () => {
    await fresh({}, 1440, true);
    await page.evaluate(LEFT_FIELD(readStock(STOCK_INPUT_FIELD, 'onKeyDown'), readStock(STOCK_INPUT_FIELD, 'setValue'), readStock(STOCK_INPUT_FIELD, '_doChange')));
    const value = sel => page.evaluate(s => document.querySelector(s).value, sel);
    const focusMode = async () => {
        await page.click('#vo-tb .vo-focus-btn');
        assert.equal((await CHROME()).focus, true, 'precondition: focus mode');
    };
    const into = async sel => {
        await page.focus(sel);
        assert.equal(await page.evaluate(s => document.activeElement === document.querySelector(s), sel), true, 'precondition: focus in ' + sel);
    };
    const esc = async () => { await page.keyboard.press('Escape'); await flush(); return CHROME(); };
    /* Typed text: the first Escape goes to the field. */
    await focusMode();
    await into('#vo-t-find');
    await page.keyboard.type('Q1');
    let c = await esc();
    assert.equal(await value('#vo-t-find'), '', 'precondition: the stock field took back the typed text');
    assert.equal(c.focus, true, 'Escape in the find field also left focus mode (two actions on one key)');
    c = await esc();
    assert.deepEqual([c.focus, c.hd, c.mn, c.height], [false, 'flex', 'flex', 132], 'the next Escape in the find field did not return the chrome');
    /* Text accepted with Enter: Escape clears the search field (the browser default) - also to the field. */
    await focusMode();
    await into('#vo-t-find');
    await page.keyboard.type('Q2');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => findField.value), 'Q2', 'precondition: Enter accepted the text (InputField._doChange)');
    c = await esc();
    assert.deepEqual([await value('#vo-t-find'), c.focus], ['', true], 'Escape after Enter: the field and the chrome in one press');
    c = await esc();
    assert.equal(c.focus, false, 'Escape in the cleared find field did not return the chrome');
    /* A field without its own Escape (the comment field) - one action: the chrome; the text stays. */
    await focusMode();
    await into('#vo-t-comment');
    await page.keyboard.type('abc');
    c = await esc();
    assert.deepEqual([await value('#vo-t-comment'), c.focus], ['abc', false], 'Escape in the comment field: the chrome did not come back at once or the text changed');
    /* An open list at the field is closed by its Escape - the chrome stays. */
    await focusMode();
    await page.evaluate(() => document.querySelector('#left-panel-search .vo-fx-wrap').classList.add('open'));
    await into('#vo-t-find');
    c = await esc();
    assert.equal(c.focus, true, 'Escape with the field list open left focus mode');
    await page.evaluate(() => document.querySelector('#left-panel-search .vo-fx-wrap').classList.remove('open'));
    c = await esc();
    assert.equal(c.focus, false, 'Escape after the field list closed did not return the chrome');
    /* "Hide panel" - the same handler. */
    await page.evaluate(() => SSE.Views.CompactShell.toggleToolbar());
    await into('#vo-t-find');
    await page.keyboard.type('Q3');
    c = await esc();
    assert.deepEqual([await value('#vo-t-find'), c.tbHidden], ['', true], 'hidden toolbar: Escape in the find field also returned the toolbar');
    c = await esc();
    assert.equal(c.tbHidden, false, 'hidden toolbar: the next Escape did not return the toolbar');
});

test('escape_silent_in_advanced', async () => {
    await fresh({}, 1440, true);
    await page.click('#vo-tb .vo-focus-btn');
    await page.evaluate(() => SSE.Views.CompactShell.toggleMode());
    assert.equal(await page.evaluate(() => document.body.classList.contains('vo-advanced')), true);
    const stockH = await page.evaluate(() => vlayout.getItem('toolbar').height);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => SSE.Views.CompactShell.focus), true, 'Escape changed the shell state in advanced');
    assert.equal(await page.evaluate(() => vlayout.getItem('toolbar').height), stockH, 'Escape touched stock heights in advanced');
    await page.evaluate(() => SSE.Views.CompactShell.toggleMode());
    const c = await CHROME();
    assert.deepEqual([c.focus, c.height, c.hd], [true, 56, 'none'], 'focus mode survives the round trip');
});

test('hide_toolbar_separate_from_focus', async () => {
    await fresh({}, 1440, true);
    await page.evaluate(() => SSE.Views.CompactShell.toggleToolbar());
    let c = await CHROME();
    assert.deepEqual([c.tbHidden, c.focus, c.tb, c.hd, c.height], [true, false, 'none', 'flex', 76], 'hide toolbar: ' + JSON.stringify(c));
    await page.evaluate(() => SSE.Views.CompactShell.toggleFocus());
    c = await CHROME();
    assert.deepEqual([c.tbHidden, c.focus, c.tb, c.hd, c.height], [false, true, 'flex', 'none', 56], 'focus brings the toolbar back');
    await page.evaluate(() => SSE.Views.CompactShell.toggleToolbar());
    c = await CHROME();
    assert.deepEqual([c.tbHidden, c.focus, c.height], [true, false, 76], 'hide toolbar leaves focus');
    await page.keyboard.press('Escape');
    c = await CHROME();
    assert.deepEqual([c.tbHidden, c.focus, c.height, c.tb], [false, false, 132, 'flex'], 'Escape returns the hidden toolbar');
    /* "View → Hide toolbar" - the same switch. */
    await page.evaluate(() => { const A = SSE.Views.SheetActions;
        A.exec(A.groups().find(g => g.label === A.textView).items.find(i => i.k === 'hideToolbar')); });
    assert.equal((await CHROME()).height, 76);
});

/* Search from the panel survives a chrome change and the round
   Compact ↔ Standard. The search bar follows the contract of the standard one (common/main/lib/view/
   SearchBar.js): it places itself under #toolbar on layout:changed and window resize, reading the height
   from the DOM; #toolbar in the compact has a 0.3 s height transition. After the transition the bar must
   stand under the new row height, not under the one at the start of the transition. */
test('search_bar_follows_rows_after_transition', async () => {
    await fresh({domLayout: true}, 1440, true);
    await page.evaluate(() => {
        const tb = document.getElementById('toolbar');
        window.searchBar = {visible: true, tops: [], isVisible() { return this.visible; },
            onLayoutChanged() { this.tops.push(Math.round(tb.getBoundingClientRect().height) + 2); }};
        Common.NotificationCenter.on('layout:changed', area => searchBar.onLayoutChanged(area));
        window.addEventListener('resize', e => searchBar.onLayoutChanged(e));
    });
    const step = async fn => {
        await page.evaluate(() => { searchBar.tops.length = 0; });
        await page.evaluate(fn);
        await page.evaluate(() => new Promise(r => setTimeout(r, 600)));
        return page.evaluate(() => ({h: Math.round(document.getElementById('toolbar').getBoundingClientRect().height), tops: searchBar.tops.slice()}));
    };
    const expect = (name, r, h) => {
        assert.equal(r.h, h, name + ': #toolbar ' + r.h + ' != ' + h);
        assert.equal(r.tops[r.tops.length - 1], h + 2, name + ': the search bar stays at ' + r.tops.join(' → ') + ' under a ' + h + ' row');
    };
    expect('focus on', await step(() => SSE.Views.CompactShell.toggleFocus()), 56);
    expect('focus off', await step(() => SSE.Views.CompactShell.toggleFocus()), 132);
    expect('toolbar hidden', await step(() => SSE.Views.CompactShell.toggleToolbar()), 76);
    expect('toolbar back', await step(() => SSE.Views.CompactShell.toggleToolbar()), 132);
    const stockH = await page.evaluate(() => SSE.Views.CompactShell.base.toolbar);
    expect('advanced', await step(() => SSE.Views.CompactShell.toggleMode()), stockH);
    expect('compact again', await step(() => SSE.Views.CompactShell.toggleMode()), 132);
    /* A closed search bar is not needed by the shell: at the end of the transition we do not touch it. The standard
       subscriptions call the method with an argument (the area, the resize event), the shell - without. */
    await page.evaluate(() => { searchBar.visible = false; searchBar.onLayoutChanged = function () { this.tops.push(arguments.length); }; });
    const hidden = await step(() => SSE.Views.CompactShell.toggleFocus());
    assert.equal(hidden.h, 56);
    assert.ok(hidden.tops.length && !hidden.tops.includes(0), 'the shell moved a hidden search bar: ' + hidden.tops.join(' '));
});

/* The search bar (the standard Common.UI.SearchBar window, the stock markup: .asc-window.search-bar with the stock inline place at the right
   edge) - as a card, as in Documents: under the panel magnifier, its left edge at the panel left edge (--vo-search-left with search:show and resize),
   the top is 8 below the panel card, and without the panel - 8 below the menu row: 132 (all rows), 56 (focus mode), 84 (panel hidden,
   "Viewing" - no magnifier, the card at the left margin 20), 8 ("Viewing" in focus mode - no rows). The look is Documents': 52 high,
   rounding 12, white 90 % with a blur of 12, the popup shadow; the field 220 × 32, radius 8, border #e2e2e2; buttons 32 × 32, radius 6,
   AIR icons 24 (chevron, "⋮" - more.svg at 90°, the close (X) button); the second "⋮" (PDF) is hidden. Only with the shell: in the Standard - the stock place and look.
   The negative control is the shell and styles without the card. */
test('search_card_under_the_magnifier_as_documents', async () => {
    await fresh({domLayout: true}, 1440, true);
    await withStockBody();
    await page.evaluate(() => {
        const w = document.createElement('div');
        w.className = 'asc-window search-bar';
        w.style.cssText = 'position: absolute; left: 1000px; top: 134px; width: 400px; height: 54px;';
        const btn = (id, icon) => '<div id="' + id + '"><button type="button" class="btn small btn-toolbar"><i class="icon toolbar__icon ' + icon + '">&nbsp;</i></button></div>';
        w.innerHTML = '<div class="body"><div class="box" role="search" style="display: flex;"><div class="search-input-group" style="position: relative;">' +
            '<input type="search" id="search-bar-text" class="input-field form-control" placeholder="Find"><div id="search-bar-results" style="position: absolute; right: 0; top: 0;">0/0</div></div>' +
            '<div class="tools" style="display: flex;">' + btn('search-bar-back', 'btn-arrow-up') + btn('search-bar-next', 'btn-arrow-down') +
            btn('search-bar-open-panel', 'btn-more-vertical') + btn('search-bar-open-panel-redact', 'btn-more-vertical') + btn('search-bar-close', 'btn-close') +
            '</div></div></div>';
        document.body.appendChild(w);
    });
    const look = () => page.evaluate(() => {
        const r = n => { const q = n.getBoundingClientRect(); return {l: Math.round(q.left), t: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height), b: Math.round(q.bottom)}; };
        const w = document.querySelector('.asc-window.search-bar'), c = getComputedStyle(w), mag = document.querySelector('#vo-tb [data-ctrl="search"]');
        const input = w.querySelector('#search-bar-text'), ic = getComputedStyle(input), b = w.querySelector('#search-bar-close .btn-toolbar'), bc = getComputedStyle(b);
        const icon = sel => { const i = w.querySelector(sel + ' .icon'), s = getComputedStyle(i), q = i.getBoundingClientRect();
            return [Math.round(q.width), Math.round(q.height), (/air\/([a-zA-Z]+)\.svg/.exec(s.webkitMaskImage || s.maskImage) || [])[1] || null, s.transform]; };
        const plate = document.getElementById('vo-tb');
        return {card: r(w), toolbar: r(document.getElementById('toolbar')), mag: mag && mag.getClientRects().length ? r(mag) : null,
            plate: plate && plate.getClientRects().length ? r(plate) : null,
            radius: c.borderRadius, bg: c.backgroundColor, blur: c.backdropFilter || c.webkitBackdropFilter, shadow: c.boxShadow,
            input: [r(input).w, r(input).h, ic.borderRadius, ic.borderTopColor], button: [r(b).w, r(b).h, bc.borderRadius, bc.backgroundColor],
            icons: [icon('#search-bar-back'), icon('#search-bar-next'), icon('#search-bar-open-panel'), icon('#search-bar-close')],
            redact: getComputedStyle(w.querySelector('#search-bar-open-panel-redact')).display, panel: getComputedStyle(w.querySelector('#search-bar-open-panel')).display,
            left: document.body.style.getPropertyValue('--vo-search-left')};
    });
    const show = async () => { await page.evaluate(() => Common.NotificationCenter.trigger('search:show')); await page.evaluate(() => new Promise(r => setTimeout(r, 450))); return look(); };
    let r = await show();
    assert.ok(r.mag, 'precondition: the magnifier is in the row');
    assert.deepEqual({top: r.card.t, under: r.card.t - r.plate.b, left: r.card.l, mag: r.mag.l, h: r.card.h},
        {top: 132, under: 8, left: r.mag.l, mag: r.mag.l, h: 52}, 'the search card is not 8 under the toolbar plate, at the left edge of the magnifier: ' + JSON.stringify(r));
    assert.deepEqual([r.radius, r.bg, /blur\(12px\)/.test(r.blur), r.shadow], ['12px', 'rgba(255, 255, 255, 0.9)', true, 'rgba(0, 0, 0, 0.21) 0px 8px 17px 0px'],
        'the search card is not the floating card of documents: ' + JSON.stringify(r));
    assert.deepEqual(r.input, [220, 32, '8px', 'rgb(226, 226, 226)'], 'the search field is not the AIR field of documents');
    assert.deepEqual(r.button, [32, 32, '6px', 'rgba(0, 0, 0, 0)'], 'the search bar buttons are not the toolbar buttons of documents');
    assert.deepEqual(r.icons.map(i => i.slice(0, 3)), [[24, 24, 'chevron'], [24, 24, 'chevron'], [24, 24, 'more'], [24, 24, 'close']], 'search bar icons: ' + JSON.stringify(r.icons));
    assert.ok(r.icons[0][3] !== 'none' && r.icons[1][3] === 'none' && r.icons[2][3] !== 'none', 'up chevron and «⋮» are not turned: ' + JSON.stringify(r.icons));
    assert.deepEqual([r.panel, r.redact], ['block', 'none'], '«⋮» of the PDF redaction is shown or «⋮» of the panel is hidden');
    /* Row states: the card lies neither on the panel nor on the menu row. */
    const states = {};
    const at = async (name, fn, arg) => { await page.evaluate(fn, arg); await page.evaluate(() => new Promise(r => setTimeout(r, 450))); const x = await show();
        /* What the card is under: the panel card, and without it - the bottom of the visible rows (#toolbar: the menu row or nothing). */
        states[name] = {top: x.card.t, under: x.card.t - (x.plate ? x.plate.b : x.toolbar.b), left: x.card.l, mag: x.mag && x.mag.l}; };
    await at('focus', () => SSE.Views.CompactShell.toggleFocus());
    await at('toolbar hidden', () => SSE.Views.CompactShell.toggleToolbar());
    await at('all rows', () => SSE.Views.CompactShell.toggleToolbar());
    /* "Viewing" is the shell workbook state (sheetMode) and its class; we do not set the engine lock here - it is checked by view-mode. */
    const view = on => { const S = SSE.Views.CompactShell; S.sheetMode = on ? 'view' : 'edit'; document.body.classList.toggle('vo-view', on); S.applyLayout(true); };
    await at('view', view, true);
    await at('view, focus', () => SSE.Views.CompactShell.toggleFocus());
    await page.evaluate(() => SSE.Views.CompactShell.toggleFocus());
    await page.evaluate(view, false);
    const mag = states['all rows'].mag;
    assert.ok(states.focus.mag > 0, 'precondition: the magnifier in focus mode');
    assert.deepEqual(states, {
        'focus': {top: 56, under: 8, left: states.focus.mag, mag: states.focus.mag},
        'toolbar hidden': {top: 84, under: 8, left: 20, mag: null},
        'all rows': {top: 132, under: 8, left: mag, mag},
        'view': {top: 84, under: 8, left: 20, mag: null},
        'view, focus': {top: 8, under: 8, left: 20, mag: null}}, 'the search card in the row states: ' + JSON.stringify(states));
    /* A window resize - the place is at the magnifier again (the magnifier is shifted by the shell padding). */
    await page.addStyleTag({content: '#vo-shell { margin-left: 40px; }'});
    await page.setViewportSize({width: 1280, height: 800});
    await page.evaluate(() => new Promise(r => setTimeout(r, 450)));
    r = await look();
    assert.equal(r.card.l, r.mag.l, 'the search card did not follow the magnifier on resize: ' + JSON.stringify([r.card.l, r.mag.l]));
    /* The Standard: the place and look are the stock's (inline), the shell does not hold the variable after a rollback. */
    await page.evaluate(() => SSE.Views.CompactShell.toggleMode());
    r = await look();
    assert.deepEqual([r.card.t, r.card.l, r.radius], [134, 1000, '0px'], 'advanced: the search bar is not the stock one');
});

/* Galleries inside panel lists (conditional formatting: data bars, color
   scales, icon sets; borders: style and color). A gallery row has an arrow ▸;
   a press and hover open the standard gallery at the row (StockBridge.popup by the item
   address; here - a substitution per the bridge contract, the show mechanics are checked by stock-bridge.cjs),
   the list stays open; a press inside the gallery is not "outside"; Escape removes the gallery
   first; hovering a neighboring row closes it; a choice in the gallery closes everything. */
test('panel_gallery_rows_open_stock_popup', async () => {
    await fresh({}, 2000, true);
    await page.evaluate(() => {
        const m = twins.btnCondFormat.menu;
        const bars = item('Data bars', {menu: events({items: [item(undefined)], rendered: true, parentEl: [document.createElement('div')]})});
        m.items.splice(1, 0, bars);
        const B = SSE.Views.StockBridge;
        window.gcalls = [];
        const gallery = document.createElement('ul');
        gallery.id = 'stock-gallery';
        document.body.appendChild(gallery);
        let shown = null;
        B.popup = (ref, anchor, o) => {
            gcalls.push(['popup', ref, anchor && anchor.querySelector('.vo-pop-t').textContent, o && o.align, o && o.padY]);
            shown = {ref, o: o || {}};
            Common.NotificationCenter.trigger('menu:show');
            return true;
        };
        B.closePopup = how => { if (!shown) return false; const s = shown; shown = null; gcalls.push(['close', how || 'close']); s.o.onClose && s.o.onClose(how || 'close'); return true; };
        B.popupOpen = () => !!shown;
        B.popupOwns = n => !!shown && gallery.contains(n);
        B.dialog = ref => { gcalls.push(['dialog', ref]); return false; };
    });
    const open = () => page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="condfmt"]').classList.contains('open'));
    const calls = () => page.evaluate(() => gcalls.slice());
    await page.click(btnOf('condfmt'));
    assert.deepEqual((await listRows('condfmt')).map(r => [r.t, r.sub]), [['Highlight cells rules', true], ['Data bars', true], ['Clear rules', false]],
        'a gallery holder is a row with ▸');
    await clickRow('condfmt', 'Data bars');
    assert.deepEqual(await calls(), [['popup', 'Toolbar:btnCondFormat.menu.items.1', 'Data bars', 'tl-tr', 10]], 'stock gallery of the item at our row');
    assert.equal(await open(), true, 'the list stays open next to the gallery');
    assert.equal(await page.evaluate(() => document.querySelector('#vo-tb [data-ctrl="condfmt"] .vo-pop-item.vo-sub-open .vo-pop-t').textContent), 'Data bars');
    await page.evaluate(() => document.getElementById('stock-gallery').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})));
    assert.deepEqual([await open(), await page.evaluate(() => SSE.Views.StockBridge.popupOpen())], [true, true], 'a press inside the gallery is not outside');
    await page.keyboard.press('Escape');
    assert.deepEqual([await open(), await page.evaluate(() => SSE.Views.StockBridge.popupOpen())], [true, false], 'Escape closes the gallery first');
    /* Hovering a gallery row opens it with a delay, a neighboring one - closes it. */
    await page.hover('#vo-tb [data-ctrl="condfmt"] .vo-pop > .vo-pop-item:nth-child(2)');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => SSE.Views.StockBridge.popupOpen()), true, 'hover opens the gallery');
    await page.hover('#vo-tb [data-ctrl="condfmt"] .vo-pop > .vo-pop-item:nth-child(3)');
    await page.waitForTimeout(400);
    assert.deepEqual([await open(), await page.evaluate(() => SSE.Views.StockBridge.popupOpen())], [true, false], 'hover on a plain row closes it');
    /* A choice in the gallery is standard, and it closes everything. */
    await clickRow('condfmt', 'Data bars');
    await page.evaluate(() => SSE.Views.StockBridge.closePopup('pick'));
    assert.equal(await open(), false, 'a pick in the gallery closes the list');
    const st = await state();
    assert.ok(!st.log.some(l => /^pick /.test(l)), 'opening a gallery ran no stock command: ' + st.log.join(', '));
});

/* --- Narrow windows - list density by a media query, as in Documents ---------------- */
/* List density by a media query on the window width, as in
   Documents (the Documents compact-shell.less: "@media (max-width: 1280px) - font 88"), at
   a window ≤ 1280 - font 88. The number format is the "123" glyph button (32), its width does not change. This is about the list widths, not about
   going into "⋯": going is decided by the row measurement.
   The widths are a reference literal (#vo-tb .vo-w-font 112, in a narrow window - 88; the "123" button - 32), not the variables of the LESS
   under test: otherwise editing @vo-w-font would shift both the expectation, and the test would stay green. */
const LESS_SRC = fs.readFileSync(LESS, 'utf8');
const FONT_FULL = 112, FONT_DENSE = 88;
const NUMFMT_W = 32;
/* Thresholds on both sides: 1281 / 1280 (font), 1040 / 1039 (the former number format threshold - it no longer exists). */
const SWEEP = [2000, 1680, 1440, 1281, 1280, 1100, 1040, 1039, 1020, 1000, 960, 900, 865, 800, 760, 700, 640, 600, 520];
const NUMFMT = () => page.evaluate(() => {
    const n = document.querySelector('#vo-tb [data-ctrl="numfmt"]');
    return {w: Math.round(n.getBoundingClientRect().width * 10) / 10, collapsed: n.classList.contains('vo-collapsed'),
            shown: n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none'};
});
/* The row control widths by the nodes themselves (0 for those that went away). */
const WIDTHS = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#vo-tb > .vo-g > [data-ctrl]')]
    .map(n => [n.getAttribute('data-ctrl'), Math.round(n.getBoundingClientRect().width * 10) / 10])));
/* The font list width: in the row - by the node; went into "⋯" (display: none) - the computed width of its rule. */
const FONT = () => page.evaluate(() => {
    const n = document.querySelector('#vo-tb [data-ctrl="font"]');
    return {w: n.getClientRects().length ? Math.round(n.getBoundingClientRect().width * 10) / 10 : parseFloat(getComputedStyle(n).width),
            inRow: n.getClientRects().length > 0};
});
const rowAt = async (width, reserve) => {
    await fresh({}, width);
    await withStockBody();
    /* reserve - the side panel place next to the chrome: the row is narrower than the window by the same amount. */
    if (reserve) await page.addStyleTag({content: `#vo-shell { margin-right: ${reserve}px; }`});
    await page.evaluate(BUILD);
    await relayout();
    return {row: await ROW(), numfmt: await NUMFMT(), font: await FONT()};
};

/* The "123" number format does not disappear at any width (core) and does not change width: a glyph button 32. */
test('number_format_never_leaves_the_row', async () => {
    for (const width of SWEEP) {
        const {row: r, numfmt: n} = await rowAt(width);
        assert.ok(n.shown && !n.collapsed && r.visible.includes('numfmt'), width + ': the number format left the row');
        assert.equal(n.w, NUMFMT_W, width + ': number format ' + n.w + ' != ' + NUMFMT_W);
    }
});

/* Density is as in Documents: font 88 at ≤ 1280; the other controls do not change their width, and neither does the "123" button. */
test('density_as_documents', async () => {
    await rowAt(2000);
    const natural = await WIDTHS();
    assert.deepEqual([natural.font, natural.numfmt], [FONT_FULL, NUMFMT_W], 'precondition: full font and number format at 2000');
    /* The row count by measured widths in the editor layout: 1440 - 26, 1280 - 23, 1040 - 19, 1000 - 18, 865 - 15,
       800 - 14, without a tolerance. */
    const EXPECTED = {1440: 26, 1280: 23, 1040: 19, 1000: 18, 865: 15, 800: 14};
    const seen = {};
    for (const width of SWEEP) {
        const {row: r, font} = await rowAt(width);
        const w = await WIDTHS();
        const wantFont = width <= 1280 ? FONT_DENSE : FONT_FULL;
        assert.equal(font.w, wantFont, width + ': font list ' + font.w + ' != ' + wantFont + ' (as in documents: 88 at ≤ 1280)');
        assert.equal(w.numfmt, NUMFMT_W, width + ': number format ' + w.numfmt);
        Object.keys(natural).forEach(k => {
            if (k === 'font' || !(w[k] > 0)) return;
            assert.equal(w[k], natural[k], width + ': ' + k + ' changed its width ' + natural[k] + ' → ' + w[k] + ' (only the lists are denser)');
        });
        if (EXPECTED[width] !== undefined) seen[width] = r.visible.length;
    }
    assert.deepEqual(seen, EXPECTED, 'visible controls by window width (counted on the measured widths)');
    /* Density is by the window (a media query, as in Documents), going into "⋯" is by the row measurement, there is no
       window width threshold for going. A window of 1280 and a side panel place of 240 next to the chrome: a row of the width
       of a 1040 window and of the same density (font 88) - lays out as a 1040 window row. */
    const plain = await rowAt(1040), beside = await rowAt(1280, 240), wide = await rowAt(1280);
    assert.deepEqual([beside.row.barW, beside.font.w, beside.numfmt.w], [plain.row.barW, plain.font.w, plain.numfmt.w],
        'precondition: the 240 reserve at 1280 gives the 1040 row of the same density');
    assert.deepEqual(beside.row.visible, plain.row.visible,
        'a row narrowed by a side panel is laid out not as a row of the same width — a window-width threshold?');
    assert.notDeepEqual(beside.row.visible, wide.row.visible, 'precondition: the reserve changes the row');
    /* A window of 1440 and a panel place of 440: density stays by the window (font 112 - there is no second,
       measured squeeze), and the row lays out by its own width: nothing behind "⋯", the chevron in the card,
       no scrolling. */
    const far = await rowAt(1440, 440);
    assert.deepEqual([far.font.w, far.numfmt.w], [FONT_FULL, NUMFMT_W],
        '1440 beside a 440 panel: the lists follow the window, not the row (no measured squeeze): ' + JSON.stringify([far.font.w, far.numfmt.w]));
    assert.ok(far.row.more && far.row.lastRight <= far.row.moreRight && far.row.endRight <= far.row.barRight + 0.5 && !far.row.scroll,
        '1440 beside a 440 panel: the row does not fit its card: ' + JSON.stringify(far.row));
    assert.ok(far.row.visible.length < (await rowAt(1440)).row.visible.length, 'precondition: the 440 reserve takes controls into «⋯»');
});

/* Below the floor the core does not fit - there is no horizontal scrolling of the chrome, "⋯" and the focus
   chevron are inside the card, the core stays in the row (it does not go into "⋯"). */
test('below_floor_no_horizontal_scroll', async () => {
    for (const width of [760, 700, 640, 600, 520]) {
        const {row: r} = await rowAt(width);
        /* The whole core, the tail of the non-core order went away (the non-core "Format painter" and
           "Clear format" are at the row start: at 760 "Format painter" still fits), below 760 - exactly the core. */
        assert.ok(CORE.every(k => r.visible.includes(k)), width + ': the core is broken: ' + r.visible.join(' '));
        assert.deepEqual(r.gone, NON_CORE.slice(NON_CORE.length - r.gone.length), width + ': gone is not the end of the non-core order: ' + r.gone.join(' '));
        assert.deepEqual(r.visible, ROW_ORDER.filter(k => !r.gone.includes(k)), width + ': visible is not the row without the gone');
        if (width <= 640) assert.deepEqual(r.visible, CORE, width + ': the row is the core');
        assert.equal(r.scroll, false, width + ': the toolbar scrolls horizontally');
        /* "Search" as the last button and visible at any width: its group is not cut by the tail,
           the button is wholly in the row, before "⋯" (the groups before it are cut). */
        const sr = await page.evaluate(() => {
            const b = document.querySelector('#vo-tb [data-ctrl="search"]'), g = b.closest('.vo-g'), more = document.querySelector('#vo-tb .vo-more');
            const br = b.getBoundingClientRect(), gr = g.getBoundingClientRect();
            return {clip: g.classList.contains('vo-g-clip'), w: Math.round(br.width), inGroup: br.right <= gr.right + 0.5, moreLeft: more.getBoundingClientRect().left,
                    right: br.right, clipped: [...document.querySelectorAll('#vo-tb .vo-g.vo-g-clip')].map(x => x.getAttribute('data-group'))};
        });
        assert.ok(!sr.clip && sr.w > 0 && sr.inGroup && sr.right <= sr.moreLeft, width + ': search is clipped or hidden below the floor: ' + JSON.stringify(sr));
        if (width <= 600) assert.ok(sr.clipped.length > 0, width + ': precondition — the row is below the floor (some group is clipped): ' + JSON.stringify(sr));
        const g = await page.evaluate(() => {
            const bar = document.getElementById('vo-tb'), shell = document.getElementById('vo-shell'), area = document.getElementById('toolbar');
            const br = bar.getBoundingClientRect(), cs = getComputedStyle(bar);
            const more = bar.querySelector('.vo-more'), chev = bar.querySelector('.vo-focus-btn');
            return {right: br.right - parseFloat(cs.paddingRight), moreShown: more.getClientRects().length > 0,
                    moreRight: more.getBoundingClientRect().right, chev: chev.getBoundingClientRect().right,
                    chevLeft: chev.getBoundingClientRect().left, vw: innerWidth,
                    shell: shell.scrollWidth - shell.clientWidth, area: area.scrollWidth - area.clientWidth};
        });
        assert.ok(g.moreShown && g.moreRight <= g.chevLeft, width + ': «⋯» is hidden or overlaps the chevron');
        assert.ok(g.chev <= g.right + 1 && g.chev <= g.vw, width + ': the focus chevron is pushed out (' + g.chev + ' > ' + g.right + ')');
        assert.ok(g.shell <= 1 && g.area <= 1, width + ': the chrome scrolls horizontally ' + JSON.stringify([g.shell, g.area]));
    }
});

/* --- The menu row in a narrow window, the header yields the title --------------------------- */
/* The menu row is shared: in a narrow window the sections that did not fit go one by one from the end into "…",
   "Help" is pinned on the right and does not go into "…", "…" is before it; there is no ☰ either in the menu row or in the header;
   there is no horizontal scrolling of the chrome. A section that went into "…" opens from its list. The section
   captions are Russian from the locale: the row is wider than the English one. */
const RU = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/spreadsheeteditor/main/locale/ru.json'), 'utf8'));
const RU_LABELS = Object.fromEntries(Object.entries(RU).filter(([k]) => /^SSE\.Views\.SheetActions\.text/.test(k))
    .map(([k, v]) => [k.split('.').pop(), v]));
const RU_SECTIONS = `Object.assign(SSE.Views.SheetActions, ${JSON.stringify(RU_LABELS)})`;
/* Two render frames: the size observer delivers the measurement in a frame. */
const resizeTo = async width => {
    await page.setViewportSize({width, height: 800});
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
};
const MENU_ROW = () => page.evaluate(() => {
    const bar = document.querySelector('#vo-shell > .vo-mn'), shell = document.getElementById('vo-shell');
    const area = document.getElementById('toolbar'), root = document.documentElement;
    const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const items = [...bar.querySelectorAll('.vo-mn-item')].filter(shown);
    const br = bar.getBoundingClientRect();
    return {labels: items.map(b => b.textContent), tops: [...new Set(items.map(b => Math.round(b.getBoundingClientRect().top)))],
            inside: items.every(b => b.getBoundingClientRect().right <= br.right + 0.5),
            burger: document.querySelectorAll('.vo-mn-burger, .vo-hd-burger, .vo-burger, [class*="burger"]').length,
            menuButtonsInHeader: [...document.querySelectorAll('#vo-shell > .vo-hd button')]
                .filter(b => /menu|меню|☰/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.title || '') + ' ' + b.textContent)).length,
            scroll: [shell.scrollWidth - shell.clientWidth, area.scrollWidth - area.clientWidth, root.scrollWidth - root.clientWidth]};
});

test('overflow_and_pinned_help_on_a_narrow_window', async () => {
    await fresh({}, 1920, true, RU_SECTIONS);
    const sections = await page.evaluate(() => SSE.Views.SheetActions.sections());
    assert.deepEqual(sections, ['Файл', 'Правка', 'Вид', 'Вставка', 'Формат', 'Данные', 'Совместная работа', 'Справка'], 'precondition: ru sections');
    const wide = await MENU_ROW();
    assert.deepEqual(wide.labels, sections, '1920: all sections in the row, no «…»');
    let movedAt = null;
    for (const width of [1920, 1440, 1280, 1040, 865, 700, 520, 400]) {
        await resizeTo(width);
        const m = await MENU_ROW();
        const more = m.labels.indexOf('…');
        const inRow = m.labels.filter(t => t !== '…');
        /* In the row - the first sections in order and "Help" last; the ones that went away - from the end, into "…" before "Help". */
        assert.equal(inRow[inRow.length - 1], 'Справка', width + ': «Help» is not pinned at the right: ' + m.labels.join(' '));
        assert.deepEqual(inRow.slice(0, -1), sections.slice(0, inRow.length - 1), width + ': sections left the row not from the end: ' + m.labels.join(' '));
        if (inRow.length < sections.length) {
            assert.equal(more, m.labels.length - 2, width + ': «…» is not right before «Help»: ' + m.labels.join(' '));
            if (movedAt === null) movedAt = width;
        } else {
            assert.equal(more, -1, width + ': «…» with every section in the row');
        }
        assert.equal(m.tops.length, 1, width + ': the sections wrapped to another line');
        assert.ok(m.inside, width + ': a section is clipped at the right edge');
        assert.equal(m.burger, 0, width + ': a burger is in the shell');
        assert.equal(m.menuButtonsInHeader, 0, width + ': a menu button is in the header');
        assert.ok(m.scroll.every(x => x <= 1), width + ': the chrome scrolls horizontally ' + JSON.stringify(m.scroll));
    }
    assert.ok(movedAt !== null, 'precondition: on a narrow window sections go to «…»');
    /* A section from "…": the "…" list is the sections that went away, a click opens the section list. */
    await resizeTo(520);
    await page.click('#vo-shell > .vo-mn .vo-mn-more > .vo-mn-item');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#vo-shell > .vo-mn .vo-mn-more .vo-mn-drop.open .vo-mn-more-row')].map(r => r.textContent));
    assert.ok(rows.length > 0 && rows.every(t => sections.indexOf(t) >= 0), '«…» lists the sections that left the row: ' + rows.join(' | '));
    assert.equal(rows.indexOf('Справка'), -1, '«Help» is in «…»');
    await page.click('#vo-shell > .vo-mn .vo-mn-more .vo-mn-more-row');
    const open = await page.evaluate(() => {
        const d = document.querySelector('#vo-shell > .vo-mn .vo-mn-drop.open');
        return d ? d.getAttribute('aria-label') : null;
    });
    assert.equal(open, rows[0], 'a section from «…» did not open its list');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => SSE.Views.CompactShell.hasOpenSurfaces()), false, 'Escape closes the section list');
});

/* The header right cluster (history · "Download" · access · mode) is not squeezed out -
   the title field yields (the width by text is set by fitTitle with a margin of 2, at the top - max-width 40 %, in a
   narrow window the field also shrinks);
   there is no horizontal scrolling of the header. */
test('header_keeps_right_cluster_title_yields', async () => {
    const options = {canUseHistory: true, canRequestSharingSettings: true, canRename: true, canViewComments: true,
        spreadsheet: {title: 'Отчёт о продажах за третий квартал по всем филиалам компании.xlsx'}};
    const HD = () => page.evaluate(() => {
        const hd = document.querySelector('#vo-shell > .vo-hd'), r = el => el.getBoundingClientRect();
        const right = hd.querySelector('.vo-hd-right'), title = hd.querySelector('.vo-hd-title'), state = hd.querySelector('.vo-hd-state');
        const sizer = hd.querySelector('.vo-hd-sizer');
        sizer.textContent = title.value || title.textContent;
        return {kids: [...right.children].map(k => [k.className, Math.round(r(k).width)]),
                rightR: r(right).right, rightL: r(right).left, titleW: r(title).width, titleR: r(title).right, text: sizer.offsetWidth,
                stateL: r(state).left, stateR: r(state).right, vw: innerWidth, padR: parseFloat(getComputedStyle(hd).paddingRight),
                scroll: hd.scrollWidth - hd.clientWidth};
    });
    await fresh({options}, 1440, true);
    const wide = await HD();
    assert.equal(wide.kids.length, 4, 'precondition: history, mode, download, sharing: ' + JSON.stringify(wide.kids));
    for (const width of [1040, 865, 800, 640]) {
        await resizeTo(width);
        const h = await HD();
        assert.deepEqual(h.kids, wide.kids, width + ': the right cluster changed: ' + JSON.stringify(h.kids));
        assert.ok(h.rightR <= h.vw - h.padR + 0.5, width + ': the right cluster is pushed out (' + h.rightR + ')');
        assert.ok(h.titleW < h.text, width + ': the title field did not yield (' + h.titleW + ' for ' + h.text + ')');
        assert.ok(h.titleR <= h.stateL + 0.5 && h.stateR <= h.rightL, width + ': title, state and cluster overlap');
        assert.ok(h.scroll <= 1, width + ': the header scrolls');
    }
});

/* The header right corner at 1440: the order history · "Download" · access · mode (the mode is rightmost,
   with its right edge at the header padding - innerWidth − 20), a gap of 19 between neighbors; the button sizes are by
   measuring the Documents header with the same markup on their styles (without the Inter font - the system one, as in
   the spreadsheet editor): history and access 32, "Download" 24, the mode - border 1 + padding 12 + caption + gap 3 +
   chevron 20 + padding 6 + border 1, hence x. The width of the caption "Editing" depends on the machine
   font (the system stack: the button 163.77 at the former measurement, 173.2 with DejaVu Sans), so it is measured right here:
   a separate node with the same font, size, weight and tracking outside the button. The look of each button at rest,
   on hover and with the mouse button held - a real mouse; the focus ring - from the keyboard (Tab over the
   cluster in its order). Vertically the cluster is at the center of the header row: mode 9..41, "Download"
   13..37. Without portal possibilities - "Download" and the mode. */
test('header_right_cluster_as_documents', async () => {
    const W = {history: 32, download: 24, sharing: 32}, GAP = 19, MODE_FRAME = 1 + 12 + 3 + 20 + 6 + 1;
    const SEL = {history: '#vo-shell .vo-hd .vo-hd-history', mode: '#vo-shell .vo-hd .vo-docmode > .vo-mode',
        download: '#vo-shell .vo-hd .vo-download > .vo-ib', sharing: '#vo-shell .vo-hd .vo-hd-sharing'};
    const LOOK = {
        history: {rest: ['rgba(0, 0, 0, 0)', 'rgb(82, 92, 105)'], hover: ['rgba(0, 0, 0, 0.03)', 'rgb(51, 51, 51)'],
            down: ['rgba(0, 0, 0, 0.06)', 'rgb(51, 51, 51)']},
        mode: {rest: ['rgb(0, 117, 255)', 'rgb(255, 255, 255)'], hover: ['rgb(0, 114, 248)', 'rgb(255, 255, 255)'],
            down: ['rgb(0, 114, 248)', 'rgb(255, 255, 255)']},
        download: {rest: ['rgba(0, 0, 0, 0)', 'rgb(82, 92, 105)'], hover: ['rgba(0, 0, 0, 0)', 'rgb(82, 92, 105)'],
            down: ['rgba(0, 0, 0, 0)', 'rgb(82, 92, 105)']},
        sharing: {rest: ['rgb(230, 244, 255)', 'rgb(1, 84, 200)'], hover: ['rgb(223, 237, 247)', 'rgb(1, 84, 200)'],
            down: ['rgb(216, 229, 240)', 'rgb(1, 84, 200)']}
    };
    const RING = 'rgb(74, 157, 255) 0px 0px 0px 2px';
    const near = (a, b) => Math.abs(a - b) <= 0.5;
    const CLUSTER = () => page.evaluate(() => {
        const hd = document.querySelector('#vo-shell > .vo-hd'), right = hd.querySelector('.vo-hd-right');
        const r = el => { const q = el.getBoundingClientRect(); return {x: q.x, y: q.y, w: q.width, h: q.height, r: q.right}; };
        return {vw: innerWidth, gap: getComputedStyle(right).columnGap, right: r(right), hdTop: hd.getBoundingClientRect().top,
            kids: [...right.children].map(k => ({cls: k.className, box: r(k)})), comments: !!hd.querySelector('.vo-hd-comments')};
    });
    const kind = cls => ['vo-hd-history', 'vo-docmode', 'vo-download', 'vo-hd-sharing'].find(c => cls.split(/\s+/).includes(c)) || cls;
    const look = sel => page.evaluate(s => new Promise(r => setTimeout(() => {
        const b = document.querySelector(s);
        b.getAnimations().forEach(a => a.finish());
        const st = getComputedStyle(b), g = b.querySelector(':scope > .vo-air');
        const gr = g && g.getBoundingClientRect(), br = b.getBoundingClientRect();
        r({bg: st.backgroundColor, color: st.color, shadow: st.boxShadow, h: st.height, pad: st.padding, radius: st.borderRadius,
           fs: st.fontSize, fw: st.fontWeight, ls: st.letterSpacing, bw: st.borderTopWidth, border: st.borderTopColor,
           box: [br.x, br.y, br.width, br.height], glyph: gr ? [gr.x, gr.y, gr.width, gr.height] : null});
    }, 30)), sel);

    /* The editor page - without the default body margin: the shell is the full window width.
       The mode caption is Russian, as in the Documents measurement (the button width depends on it). */
    const edge = () => page.evaluate(() => new Promise(r => { document.body.style.margin = '0'; requestAnimationFrame(() => r()); }));
    const RU = () => { SSE.Views.CompactShell.textModeEdit = 'Редактирование'; };
    /* The mode caption width outside the button - with its font, without shrinking and wrapping. */
    const caption = () => page.evaluate(() => {
        const cap = document.querySelector('#vo-shell .vo-hd .vo-docmode > .vo-mode > span:not(.vo-heading-caret)'), s = getComputedStyle(cap);
        const ref = document.createElement('span');
        ref.textContent = cap.textContent;
        ref.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;border:0;white-space:nowrap';
        ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing'].forEach(p => { ref.style[p] = s[p]; });
        document.body.appendChild(ref);
        const w = ref.getBoundingClientRect().width;
        ref.remove();
        return w;
    });
    await fresh({options: {canUseHistory: true, canRequestSharingSettings: true}}, 1440, true, RU);
    await edge();
    const c = await CLUSTER();
    const modeW = (await caption()) + MODE_FRAME;
    const X = {mode: c.vw - 20 - modeW};
    X.sharing = X.mode - GAP - W.sharing;
    X.download = X.sharing - GAP - W.download;
    X.history = X.download - GAP - W.history;
    assert.deepEqual(c.kids.map(k => kind(k.cls)), ['vo-hd-history', 'vo-download', 'vo-hd-sharing', 'vo-docmode'], 'right cluster order');
    assert.equal(c.comments, false, '«Comments» in the header');
    assert.equal(c.gap, '19px', 'cluster gap');
    for (let i = 1; i < c.kids.length; i++) {
        const gap = c.kids[i].box.x - c.kids[i - 1].box.r;
        assert.ok(near(gap, 19), 'gap between ' + kind(c.kids[i - 1].cls) + ' and ' + kind(c.kids[i].cls) + ': ' + gap);
    }
    assert.ok(near(c.right.r, c.vw - 20), 'cluster right edge ' + c.right.r + ' != ' + (c.vw - 20));
    assert.ok(near(c.right.y - c.hdTop, 9) && near(c.right.h, 32), 'cluster is not centred in the header row: ' + JSON.stringify(c.right));
    const xs = {history: c.kids[0].box.x, download: c.kids[1].box.x, sharing: c.kids[2].box.x, mode: c.kids[3].box.x};
    Object.keys(X).forEach(k => assert.ok(near(xs[k], X[k]), k + ': x ' + xs[k] + ' != ' + X[k]));
    assert.ok(near(c.kids[3].box.r, c.vw - 20), 'the mode switch is not at the right edge: ' + c.kids[3].box.r);

    /* The rest metrics. */
    await page.mouse.move(5, 790);
    const mode = await look(SEL.mode);
    assert.deepEqual([mode.h, mode.pad, mode.radius, mode.fs, mode.fw, mode.ls], ['32px', '0px 6px 0px 12px', '8px', '15px', '500', '-0.05px'],
        'mode button metrics: ' + JSON.stringify(mode));
    assert.ok(near(mode.box[2], modeW) && near(mode.box[3], 32), 'mode button box ' + JSON.stringify(mode.box) + ', width ' + modeW + ' expected');
    assert.equal(mode.border, 'rgb(0, 117, 255)', 'mode button border');
    const caret = await page.evaluate(() => {
        const g = document.querySelector('#vo-shell .vo-hd .vo-docmode .vo-heading-caret .vo-air'), q = g.getBoundingClientRect();
        return {w: q.width, h: q.height, color: getComputedStyle(g).backgroundColor};
    });
    assert.deepEqual(caret, {w: 20, h: 20, color: 'rgba(255, 255, 255, 0.7)'}, 'mode chevron');
    const dl = await look(SEL.download);
    assert.deepEqual([dl.box[2], dl.box[3], dl.pad, dl.bw], [24, 24, '0px', '0px'], '«Download» metrics: ' + JSON.stringify(dl));
    assert.deepEqual(dl.glyph, dl.box, '«Download» glyph does not fill its button');
    assert.ok(near(dl.box[1] - c.hdTop, 13), '«Download» y ' + dl.box[1]);
    for (const k of ['history', 'sharing']) {
        const b = await look(SEL[k]);
        assert.deepEqual([b.box[2], b.box[3], b.glyph && b.glyph[2], b.glyph && b.glyph[3]], [32, 32, 24, 24], k + ': box and glyph ' + JSON.stringify(b));
    }

    /* Rest, hover, the mouse button held - a real mouse. */
    for (const k of Object.keys(SEL)) {
        await page.mouse.move(5, 790);
        const rest = await look(SEL[k]);
        await page.hover(SEL[k]);
        const hover = await look(SEL[k]);
        await page.mouse.down();
        const down = await look(SEL[k]);
        await page.mouse.move(5, 790);
        await page.mouse.up();
        assert.deepEqual({rest: [rest.bg, rest.color], hover: [hover.bg, hover.color], down: [down.bg, down.color]}, LOOK[k],
            k + ': look at rest, hover and press');
    }
    await page.evaluate(() => SSE.Views.CompactShell.closeSurfaces());

    /* The focus ring from the keyboard: Tab over the cluster left to right, in its order. */
    await page.keyboard.press('Shift');
    await page.focus(SEL.history);
    for (const k of ['history', 'download', 'sharing', 'mode']) {
        if (k !== 'history') await page.keyboard.press('Tab');
        const at = await page.evaluate(s => document.activeElement === document.querySelector(s), SEL[k]);
        assert.ok(at, 'Tab did not reach ' + k);
        assert.equal((await look(SEL[k])).shadow, RING, k + ': no keyboard focus ring');
    }

    /* Without portal possibilities - "Download" and the mode. */
    await fresh({}, 1440, true, RU);
    await edge();
    const bare = await CLUSTER();
    assert.deepEqual(bare.kids.map(k => kind(k.cls)), ['vo-download', 'vo-docmode'], 'bare cluster order');
    const bareX = {download: X.mode - GAP - W.download, mode: X.mode};
    assert.ok(near(bare.kids[0].box.x, bareX.download) && near(bare.kids[1].box.x, bareX.mode) && near(bare.kids[1].box.r, bare.vw - 20),
        'bare cluster x: ' + JSON.stringify(bare.kids.map(k => [k.box.x, k.box.r])));
    assert.ok(near(bare.right.x, bareX.download) && near(bare.right.w, W.download + GAP + modeW), 'bare cluster box ' + JSON.stringify(bare.right));
});

/* The title field is with a margin of Math.ceil(measureText + 2)
   by a canvas with the field font, that is, without tracking, at the top it is
   held only by max-width 40 %, a name that did not fit is cut by the field edge without an ellipsis
   (overflow hidden without text-overflow). The reference is measured right here the same way - by a canvas.
   The gap "end of the visible name → the save icon": (field − text) + 8 for a whole name, 8 for
   a cut one (field padding 6 − state margin 6 + header gap 8). */
test('title_field_fits_text_plus_2', async () => {
    const names = ['Продажи 2026', 'Отчёт о продажах за третий квартал', 'Отчёт о продажах за третий квартал по всем филиалам компании'];
    const options = {canUseHistory: true, canRequestSharingSettings: true, canRename: true, canViewComments: true,
        spreadsheet: {title: names[0] + '.xlsx'}};
    const M = () => page.evaluate(() => {
        const hd = document.querySelector('#vo-shell > .vo-hd'), t = hd.querySelector('.vo-hd-title'), st = hd.querySelector('.vo-hd-state');
        const sizer = hd.querySelector('.vo-hd-sizer'), s = getComputedStyle(t), hs = getComputedStyle(hd);
        const c = document.createElement('canvas').getContext('2d');
        c.font = s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily;
        const span = document.createElement('span');
        span.style.cssText = 'position:absolute;left:-9999px;top:-9999px;white-space:pre;font:' + s.font + ';letter-spacing:' + s.letterSpacing;
        span.textContent = t.value;
        document.body.appendChild(span);
        const text = span.getBoundingClientRect().width;
        span.remove();
        const pl = parseFloat(s.paddingLeft), pr = parseFloat(s.paddingRight), r = t.getBoundingClientRect();
        const inner = t.clientWidth - pl - pr;
        return {tag: t.tagName, value: t.value, styleW: parseFloat(t.style.width), fitW: Math.ceil(c.measureText(t.value).width + 2),
            inner, text, cap: (hd.clientWidth - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight)) * 0.4,
            overflow: s.textOverflow, sizerTrack: getComputedStyle(sizer).letterSpacing,
            gap: st.getBoundingClientRect().left - (r.left + pl + Math.min(text, inner))};
    });
    await fresh({options}, 1440, true);
    const first = await M();
    assert.equal(first.tag, 'INPUT', 'precondition: the name is a field with canRename');
    assert.equal(first.overflow, 'clip', 'the name is cut with «' + first.overflow + '», expected a cut at the field edge');
    assert.equal(first.sizerTrack, 'normal', 'the measuring twin keeps tracking ' + first.sizerTrack + ' — the field is measured without it (measureText)');
    for (const width of [1440, 1280, 1040]) {
        await resizeTo(width);
        for (const name of names) {
            await page.evaluate(n => SSE.Views.CompactShell.syncTitle(n + '.xlsx'), name);
            await flush();
            const m = await M();
            const at = width + ' «' + name + '»: ';
            assert.equal(m.value, name, at + 'precondition: the name did not reach the field');
            assert.ok(Math.abs(m.styleW - m.fitW) <= 1, at + 'field ' + m.styleW + ' px, expected ceil(measureText + 2) = ' + m.fitW);
            const clipped = m.fitW > m.cap;
            assert.ok(Math.abs(m.inner - (clipped ? m.cap : m.fitW)) <= 1, at + 'field content ' + m.inner + ' px, expected ' +
                (clipped ? 'the 40 % cap ' + m.cap : m.fitW));
            const want = clipped ? 8 : m.inner - m.text + 8;
            assert.ok(Math.abs(m.gap - want) <= 0.5 && (clipped || m.gap > 8 + 2), at + 'gap to the save state ' + m.gap.toFixed(2) + ', expected ' + want.toFixed(2));
        }
    }
});

/* The "Comments" caption in the comments panel header - without tracking
   (computed letter-spacing normal). The standard rule is real: for
   #comments-header label there is the standard .font-weight-bold() from asc-mixins.less (letter-spacing 0.01em -
   0.14 px at 14); it is laid down before the shell styles, as in the editor. Without the compact class the same
   rule must give the standard tracking - otherwise the case proves nothing. */
test('comments_panel_title_tracking_normal', async () => {
    const mixin = /\.font-weight-bold\s*\{([^}]*)\}/.exec(fs.readFileSync(path.join(ROOT, 'apps/common/main/resources/less/asc-mixins.less'), 'utf8'));
    assert.ok(mixin && /letter-spacing/.test(mixin[1]), 'precondition: the stock bold mixin has no letter-spacing — the case would prove nothing');
    await fresh({}, 1440, true);
    const r = await page.evaluate(rule => {
        const st = document.createElement('style');
        st.textContent = '#comments-box #comments-header label { font-size: 14px; ' + rule + ' }';
        document.head.insertBefore(st, document.head.firstChild);
        const box = document.createElement('div');
        box.id = 'comments-box';
        box.innerHTML = '<div id="comments-header"><label>Комментарии</label></div>';
        document.body.appendChild(box);
        const l = box.querySelector('label'), read = () => getComputedStyle(l).letterSpacing;
        const out = {compact: document.body.classList.contains('vo-compact'), ls: read(), size: getComputedStyle(l).fontSize, weight: getComputedStyle(l).fontWeight};
        document.body.classList.remove('vo-compact');
        out.stock = read();
        document.body.classList.add('vo-compact');
        box.remove();
        st.remove();
        return out;
    }, mixin[1]);
    assert.ok(r.compact, 'precondition: the shell put vo-compact on body');
    assert.equal(r.stock, '0.14px', 'precondition: the stock rule does not give its tracking without the shell (' + r.stock + ')');
    assert.equal(r.size + '/' + r.weight, '14px/600', 'comments panel title font');
    assert.equal(r.ls, 'normal', 'the comments panel title keeps the stock tracking ' + r.ls + ' — expected none');
});

/* --- Row separators: no dangling bars -------------------------------------- */
/* The row as tokens by boxes and computed ::before: "|" is a visible bar (for a cut group -
   if it is not cut off by the clip), a control - if visible at least partly (full - entirely, the clip did not
   touch it), "⋯", "^" - the chevron. The rule: a group bar has a fully visible control both in its
   group (up to the next bar, "⋯" or the chevron), and to the left (after the previous bar or from
   the row start); the "⋯" bar - to the left. The number of bars: (groups with a fully visible control − 1)
   + 1 for a visible "⋯". */
const SEPS = () => page.evaluate(() => {
    const bar = document.getElementById('vo-tb');
    const shown = el => !!el && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
    const drawn = el => { const b = getComputedStyle(el, '::before'); return b.content !== 'none' && b.display !== 'none'; };
    const tokens = [];
    let live = 0, withFull = 0;
    [...bar.querySelectorAll(':scope > .vo-g')].forEach(g => {
        if (!shown(g)) return;
        live++;
        const gr = g.getBoundingClientRect(), clip = g.classList.contains('vo-g-clip');
        if (drawn(g)) {
            const x = gr.left + parseFloat(getComputedStyle(g).borderLeftWidth) + parseFloat(getComputedStyle(g, '::before').left);
            if (!clip || (x >= gr.left - 0.5 && x <= gr.right + 0.5)) tokens.push({x, t: '|', g: g.getAttribute('data-group')});
        }
        let full = false;
        [...g.children].filter(n => n.hasAttribute('data-ctrl') && shown(n)).forEach(n => {
            const r = n.getBoundingClientRect(), vis = (clip ? Math.min(r.right, gr.right) : r.right) - r.left;
            const whole = vis >= r.width - 0.5;
            if (vis > 0.5) tokens.push({x: r.left, t: n.getAttribute('data-ctrl') + (whole ? '' : '~'), full: whole});
            if (whole) full = true;
        });
        if (full) withFull++;
    });
    const mw = bar.querySelector('.vo-more-wrap'), more = shown(mw);
    if (more) {
        const mr = mw.getBoundingClientRect();
        if (drawn(mw)) tokens.push({x: mr.left + parseFloat(getComputedStyle(mw, '::before').left), t: '|', g: 'more'});
        tokens.push({x: mr.left, t: '⋯'});
    }
    const fb = bar.querySelector('.vo-focus-btn');
    if (shown(fb)) tokens.push({x: fb.getBoundingClientRect().left, t: '^'});
    tokens.sort((a, b) => a.x - b.x);
    const bad = [];
    tokens.forEach((t, i) => {
        if (t.t !== '|') return;
        let left = false, right = t.g === 'more';
        for (let j = i - 1; j >= 0 && tokens[j].t !== '|'; j--) if (tokens[j].full) left = true;
        for (let j = i + 1; !right && j < tokens.length && !['|', '⋯', '^'].includes(tokens[j].t); j++) if (tokens[j].full) right = true;
        if (!left || !right) bad.push(t.g + (left ? ': no whole control in its group' : ': no whole control on the left'));
    });
    return {seq: tokens.map(t => t.t).join(' '), bad, live, withFull, more,
            count: tokens.filter(t => t.t === '|').length,
            want: Math.max(0, withFull - 1) + (more && withFull > 0 ? 1 : 0),
            seps: tokens.filter(t => t.t === '|').map(t => t.g + '@' + Math.round(t.x * 10) / 10),
            clipped: SSE.Views.CompactToolbar.fit ? SSE.Views.CompactToolbar.fit.clipped : null,
            marked: [...bar.querySelectorAll('.vo-sep-off')].length};
});
const sepsOk = (s, where) => {
    assert.deepEqual(s.bad, [], where + ': hanging separators: ' + s.seq);
    assert.equal(s.count, s.want, where + ': separators ' + s.count + ' != ' + s.want + ': ' + s.seq);
};
/* Two render frames: the row size observer delivers the measurement in a frame. */
const sizeTo = async width => {
    await page.setViewportSize({width, height: 800});
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
};
/* Narrow windows where the toolbar row (the group order and the core - as ROW_ORDER and CORE) has groups without a fully visible control:
   the core "Bold Italic Underline Strikethrough" is cut from 480, the font size - from 460, the number format - from 360. */
const NARROW = [480, 460, 440, 420, 380, 360];

test('separators_only_between_visible_controls', async () => {
    let hung = 0;
    for (const width of SWEEP.concat(NARROW)) {
        await rowAt(width);
        const s = await SEPS();
        sepsOk(s, String(width));
        /* Without clipping no bar disappeared: between all live groups and before "⋯". */
        if (!s.clipped) assert.equal(s.count, s.live - 1 + (s.more ? 1 : 0), width + ': a separator is lost without clipping: ' + s.seq);
        if (s.withFull < s.live) hung++;
    }
    assert.ok(hung >= NARROW.length, 'precondition: the narrow widths have groups without a whole control (' + hung + ')');
});

test('separators_come_back', async () => {
    await rowAt(1440);
    const wide = await SEPS();
    assert.equal(wide.marked, 0, 'precondition: no separator is switched off at 1440');
    await sizeTo(420);
    const narrow = await SEPS();
    sepsOk(narrow, '1440 → 420');
    assert.ok(narrow.withFull < narrow.live && narrow.marked > 0, 'precondition: 420 leaves groups without a whole control: ' + narrow.seq);
    await sizeTo(1440);
    const back = await SEPS();
    assert.deepEqual(back.seps, wide.seps, '420 → 1440: separators did not come back: ' + back.seq);
    assert.equal(back.marked, 0, '420 → 1440: a separator is still switched off');
    await sizeTo(1280);
    const before = await SEPS();
    sepsOk(before, '1280');
    await page.click('#vo-tb .vo-more');
    assert.equal(await page.evaluate(() => document.getElementById('vo-tb').classList.contains('vo-of-open')), true, 'precondition: «⋯» is open');
    await page.click('#vo-tb .vo-more');
    const after = await SEPS();
    assert.deepEqual(after.seps, before.seps, '1280: «⋯» open and closed moved the separators: ' + after.seq);
    assert.equal(after.marked, 0, '1280: a separator is switched off after «⋯» closed');
});

test('separators_rule_ignores_composition', async () => {
    await rowAt(2000);
    const r = await page.evaluate(() => {
        const T = SSE.Views.CompactToolbar, gs = T.groups;
        const drawn = el => { const b = getComputedStyle(el, '::before'); return b.content !== 'none' && b.display !== 'none'; };
        /* How the clipping leaves it: the first group is empty, a group in the middle is cut down to the field. */
        [...gs[0].children].forEach(n => n.classList.add('vo-collapsed'));
        const mid = gs[3];
        mid.classList.add('vo-g-clip');
        mid.style.maxWidth = getComputedStyle(mid).paddingLeft;
        T.moreWrap.classList.remove('vo-collapsed');
        T.syncSeparators();
        const one = {first: drawn(gs[1]), mid: drawn(mid), next: drawn(gs[4]), more: drawn(T.moreWrap), midW: mid.getBoundingClientRect().width};
        /* To the left of "⋯" nothing is fully visible. */
        gs.forEach(g => { g.classList.add('vo-g-clip'); g.style.maxWidth = getComputedStyle(g).paddingLeft; });
        T.syncSeparators();
        const two = {more: drawn(T.moreWrap), groups: gs.filter(drawn).length};
        return {one, two, n: gs.length};
    });
    assert.ok(r.n >= 6 && r.one.midW > 0, 'precondition: the row has groups and the middle one keeps its field: ' + JSON.stringify(r));
    assert.equal(r.one.first, false, 'the first visible group draws a separator at the start of the row');
    assert.equal(r.one.mid, false, 'the middle group clipped to its field keeps its separator');
    assert.equal(r.one.next, true, 'the group after the clipped one lost its separator');
    assert.equal(r.one.more, true, '«⋯» lost its separator although whole controls stand on its left');
    assert.deepEqual([r.two.more, r.two.groups], [false, 0], 'nothing whole on the left: separators stay ' + JSON.stringify(r.two));
});

test('overflow_list_has_no_group_separators', async () => {
    for (const width of [1280, 520]) {
        await rowAt(width);
        await page.click('#vo-tb .vo-more');
        const r = await page.evaluate(() => [...document.querySelectorAll('#vo-tb .vo-of-pop > .vo-g')].map(g => {
            const b = getComputedStyle(g, '::before');
            return b.content !== 'none' && b.display !== 'none';
        }));
        assert.ok(r.length > 1, width + ': precondition: «⋯» holds groups');
        assert.deepEqual(r.filter(Boolean), [], width + ': a group in «⋯» draws a separator');
    }
});

test('separators_same_in_focus_mode', async () => {
    await fresh({}, 1440, true);
    await page.click('#vo-tb .vo-focus-btn');
    assert.equal(await page.evaluate(() => document.body.classList.contains('vo-focus')), true, 'precondition: focus mode');
    for (const width of [1440, 460]) {
        await sizeTo(width);
        const s = await SEPS();
        sepsOk(s, 'focus ' + width);
        if (width === 460) assert.ok(s.withFull < s.live, 'precondition: focus 460 leaves groups without a whole control: ' + s.seq);
        else assert.equal(s.marked, 0, 'focus 1440: a separator is switched off');
    }
});

/* The toolbar row in its group order (ROW_ORDER) - on AIR icons:
   every glyph button of the row has an AIR mask (.vo-air) 24 × 24 from the img/air set: the shared one (Icons.has) or the spreadsheet editor's own
   (OWN_AIR: "123", the percent sign, decimal places - the files apps/spreadsheeteditor/main/resources/img/air), for "Print" - print; groups and "⋯"
   are separated by bars without dangling ones (syncSeparators by these groups); the "Print" hint is under the row, below the white card with a border. */
test('row_on_air_glyphs_24', async () => {
    await fresh({}, 2000, true);
    const r = await page.evaluate(() => {
        const bar = document.getElementById('vo-tb'), Icons = Common.UI.Compact.Icons;
        const keys = [...bar.querySelectorAll(':scope > .vo-g [data-ctrl]')].map(n => n.getAttribute('data-ctrl'));
        const TEXT = ['zoom', 'font', 'size'];
        const glyphs = [...bar.querySelectorAll(':scope > .vo-g [data-ctrl]')].filter(n => TEXT.indexOf(n.getAttribute('data-ctrl')) < 0).map(n => {
            const btn = n.matches('.vo-ib') ? n : n.querySelector('.vo-ib');
            const g = btn && (btn.querySelector(':scope > .vo-air') || btn.querySelector(':scope > .vo-drop-i > .vo-air'));
            const src = g ? /\/img\/air\/([A-Za-z0-9]+)\.svg/.exec(g.getAttribute('style') || '') : null;
            const own = ['digits123', 'percentSign', 'decimalDecrease', 'decimalIncrease'];
            const at = src && (own.includes(src[1]) ? '/spreadsheeteditor/main/resources/img/air/' : '/common/main/resources/img/air/');
            const c = g && getComputedStyle(g), q = g && g.getBoundingClientRect();
            return {k: n.getAttribute('data-ctrl'), name: src ? src[1] : null,
                    has: !!(src && (own.includes(src[1]) ? !Icons.has(src[1]) : Icons.has(src[1])) && (g.getAttribute('style') || '').includes(at)),
                    mask: c ? String(c.webkitMaskImage || c.maskImage || '') : '', w: q ? q.width : 0, h: q ? q.height : 0};
        });
        return {keys, glyphs, clearPopup: document.querySelector('#vo-tb [data-ctrl="clear"]').querySelector('[aria-haspopup]') !== null ||
            document.querySelector('#vo-tb [data-ctrl="clear"]').hasAttribute('aria-haspopup')};
    });
    assert.deepEqual(r.keys, ROW_ORDER, 'precondition: the row is not in the expected order');
    assert.equal(r.clearPopup, false, '«Clear format» has a list');
    const bad = r.glyphs.filter(g => !g.name || !g.has || !/\/img\/air\//.test(g.mask) || Math.abs(g.w - 24) > 0.5 || Math.abs(g.h - 24) > 0.5);
    assert.deepEqual(bad, [], 'row controls without an AIR mask 24 × 24');
    assert.equal(r.glyphs.find(g => g.k === 'print').name, 'print', '«Print» is not drawn by the print glyph');
    assert.ok(r.glyphs.length >= 32, 'precondition: glyph controls ' + r.glyphs.length);
    for (const width of [2000, 1440, 1280]) {
        await sizeTo(width);
        sepsOk(await SEPS(), 'toolbar groups at ' + width);
    }
    /* "Print" in the row - from 1680 (at 1440 it is in "⋯"). */
    await sizeTo(1680);
    const t = await hoverTip(btnOf('print'));
    assert.equal(t.tip && t.tip.text, 'Print (Ctrl+P)', 'no tip on «Print»');
    const bar = await boxOf('#vo-tb');
    const plate = await page.evaluate(() => { const tb = document.getElementById('vo-plate'), o = getComputedStyle(tb, '::after');
        return {bg: getComputedStyle(tb).backgroundColor, stroke: o.borderTopStyle + ' ' + o.borderTopColor}; });
    assert.deepEqual([plate.bg, plate.stroke], ['rgb(255, 255, 255)', 'solid rgb(237, 238, 240)'], 'precondition: the white outline plate');
    assert.ok(Math.abs(t.tip.t - (bar.b + 4)) <= 1 && t.tip.t >= bar.b, 'the «Print» tip is not under the plate: ' + JSON.stringify([bar.b, t.tip.t]));
    await page.mouse.move(AWAY.x, AWAY.y);
});

/* The value list caption (zoom, font) keeps the descenders: the caption line is no lower than the font, otherwise overflow: hidden
   cuts the tails of g, y, p and the Cyrillic letter shcha - "Allgemein" in German. The negative control is a line equal to the font size (line-height 1 of the .vo-ib button)
   at the caption. */
test('value_label_keeps_descenders', async () => {
    await fresh({}, 2000);
    await page.evaluate(BUILD);
    const r = await page.evaluate(() => ['font', 'zoom'].map(k => {
        const l = document.querySelector('#vo-tb [data-ctrl="' + k + '"] .vo-value-label');
        if (!l) return {k, none: true};
        l.textContent = 'Allgemein gypq';
        const cs = getComputedStyle(l), box = l.getBoundingClientRect(), btn = l.closest('button').getBoundingClientRect();
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        const m = ctx.measureText('Allgemein gypq');
        return {k, h: box.height, need: m.fontBoundingBoxAscent + m.fontBoundingBoxDescent, ov: cs.overflow,
            inBtn: box.top >= btn.top - 0.5 && box.bottom <= btn.bottom + 0.5};
    }));
    for (const x of r) {
        assert.ok(!x.none, 'precondition: no value label at ' + x.k);
        assert.equal(x.ov, 'hidden', 'precondition: the ' + x.k + ' label does not clip (no ellipsis)');
        assert.ok(x.h + 0.5 >= x.need, 'the ' + x.k + ' label line is lower than the font, descenders are clipped: ' + JSON.stringify(x));
        assert.ok(x.inBtn, 'the ' + x.k + ' label leaves its button: ' + JSON.stringify(x));
    }
});

(async () => {
    const less = require(path.join(ROOT, 'build/node_modules/less'));
    /* The shell layer is built without the rest of app.less - the shared files (tokens.less, menu.less,
       about.less) and compact-shell.less in app.less order (lib/compact-less.cjs): the menu row
       rules are shared. The application image path (the glyphs of standard nodes as a mask) is the value of
       common/main/resources/less/variables.less, which app.less includes earlier (in the build it is
       replaced by build/*.json). */
    const layer = require('./lib/compact-less.cjs');
    css = (await less.render(layer.source(LESS),
        {filename: layer.APP_LESS, globalVars: {'app-image-const-path': '"resources/img"'}})).css;
    /* The standard hint: the bootstrap base
       (common/main/resources/mods/less/tooltip.less) and the ONLYOFFICE look (common/main/resources/less/tooltip.less) with the theme colors - in the same
       order as the spreadsheet editor app.less; the font size mixins are from app.less. It is needed by the case tip_readable_in_light_and_dark_theme. */
    const C = path.join(ROOT, 'apps/common/main/resources'), SL = path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less');
    stockTipCss = (await less.render([`@import "${SL}/variables.less";`, `@import "${C}/less/asc-mixins.less";`, `@import "${C}/less/variables.less";`,
        `@import "${C}/less/colors-table.less";`, `@import "${C}/less/colors-table-dark.less";`, `@import "${C}/mods/less/mixins";`,
        ...fs.readFileSync(path.join(SL, 'app.less'), 'utf8').match(/\.font-size-(small|normal)\s*\{[^}]*\}/g),
        `@import "${C}/mods/less/tooltip";`, `@import "${C}/less/tooltip.less";`].join('\n'),
        {filename: path.join(SL, 'stock-tooltip.less'), globalVars: {'app-image-const-path': '"resources/img"'}})).css;
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
