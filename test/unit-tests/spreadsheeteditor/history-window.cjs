/* Run: node test/unit-tests/spreadsheeteditor/history-window.cjs [path to CompactShell.js] [path to compact-shell.less]
 * The version history window of the spreadsheet editor "Compact" shell: the stock history column (Common.Views.History
 * in #left-panel-history) in the compact is a non-modal window following the Documents compact window template:
 * a .vo-material-popup() box, a header with a 19/26 caption and a close (X) button (the AIR close 24 icon), the body is the stock
 * version list, no footer and no dimming; the window is on the right under the shell rows, the column takes no space in the
 * layout, the sheet does not shift. The window role, the screen-reader label, the AIR glyphs on the stock
 * buttons, focus and Escape belong to CompactShell; in the Standard the column is standard.
 *
 * Real headless Chrome (playwright, as compact-toolbar.cjs): NODE_PATH or
 * PLAYWRIGHT_MODULE for the package, CHROMIUM_PATH for the browser. The styles are the real spreadsheet editor styles:
 * app.less, built by the less from build/node_modules (the stock layout.less, treeview.less,
 * history.less and the shell compact-shell.less in the same order as in the build; the argument is substituted
 * for compact-shell.less). The layout is the real Common.UI.HBoxLayout /
 * VBoxLayout (common/main/lib/component/Layout.js) with the same items as view/Viewport.js;
 * the stock layout handler is the real text of controller/Viewport.js (onLayoutChanged).
 * The column markup is the template and the row template of Common.Views.History (apps/common/main/lib/view/
 * History.js), the buttons are Common.UI.Button markup. Showing the column is like LeftMenu.showHistory
 * (show, inline width, layout:changed 'history'); without canHistoryClose - like setMode of
 * controller/History.js (the header hidden inline, the list has padding-top: 0). Instead of
 * Gateway.requestHistoryClose there is a counter of clicks on the close (X) button. The shell is real
 * (CompactShell and its modules), the rest of the stock is fake doubles, as in compact-toolbar.cjs.
 * The arguments are copies of modules for the negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/spreadsheeteditor/main/app/view');
const SHELL = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactShell.js');
const LESS = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/compact-shell.less');
const APP_LESS = path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/app.less');
const STOCK_VIEWPORT_CTL = path.join(ROOT, 'apps/spreadsheeteditor/main/app/controller/Viewport.js');
const STOCK_TOOLBAR_CTL = path.join(ROOT, 'apps/spreadsheeteditor/main/app/controller/Toolbar.js');
const STOCK_HISTORY_VIEW = path.join(ROOT, 'apps/common/main/lib/view/History.js');
const STOCK_LAYOUT = path.join(ROOT, 'apps/common/main/lib/component/Layout.js');
const BASE = 'file://' + path.join(ROOT, 'apps/spreadsheeteditor/main/index.html');

/* The text of a stock controller method - from "name: function(" to the closing brace. */
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

/* The Common.Views.History templates: the box and the list row - arrays of strings from History.js,
   joined the same way as in render (this is the view: textVer, textRestore). */
function stockHistoryTemplates() {
    const src = fs.readFileSync(STOCK_HISTORY_VIEW, 'utf8');
    const box = /template:\s*_\.template\(\[([\s\S]*?)\]\.join\(''\)\)/.exec(src);
    const item = /itemTemplate:\s*_\.template\(\[([\s\S]*?)\]\.join\(''\)\)/.exec(src);
    assert.ok(box && item, 'History.js: template or itemTemplate not found');
    const scope = {textVer: 'ver. ', textRestore: 'Restore'};
    const arr = s => new Function('Common', 'return [' + s + '].join(\'\');').call(scope, {UI: {isRTL: () => false}});
    return {box: arr(box[1]), item: arr(item[1])};
}

/* A fake stock in the page (as compact-toolbar.cjs): ribbon doubles, engine, controllers. */
const HARNESS = (opt, stockFontSize) => `
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
    return m;
}
function withMenu(ref, list, o = {}) { return twin(ref, Object.assign({menu: menu(ref, list)}, o)); }

const O = ${JSON.stringify(opt)};
const nfEl = document.createElement('div');
nfEl.innerHTML = '<ul><li id="nf-0"><a>General</a></li><li class="divider"></li><li id="nf-more"><a>More formats</a></li></ul>';
stock.appendChild(nfEl);
const nfModels = [{id: 'nf-0', displayValue: 'General', exampleval: '1234'}];
const numFormat = events({disabled: false, raw: 'General', displayField: 'displayValue', cmpEl: [nfEl],
    store: {length: nfModels.length, at: i => ({get: k => nfModels[i][k], id: nfModels[i].id})},
    getValue() { return this.raw; }, getRawValue() { return this.raw; }, isDisabled() { return this.disabled; }, itemClicked() {}});
numFormat.setDisabled = function (v) { this.disabled = !!v; };
const fontNames = ['Arial', 'Calibri'];
const fontName = events({disabled: false, raw: 'Calibri', store: {models: fontNames.map(n => ({get: k => k === 'name' ? n : undefined, toJSON: () => ({name: n, type: 1})}))},
    getRawValue() { return this.raw; }, isDisabled() { return this.disabled; }, itemClicked() {}});
const fontSize = events({disabled: false, raw: '11', cmpEl: [document.createElement('div')],
    store: {findWhere: q => ['8', '9', '10', '11', '12', '14'].indexOf(q.displayValue) >= 0 ? {} : null},
    getRawValue() { return this.raw; }, setRawValue(v) { this.raw = String(v); }, isDisabled() { return this.disabled; }});
window.api = {calls: [], zoom: 1, handlers: {}, isCellEdited: false, fontColor: null, fillColor: null,
    asc_registerCallback(n, f) { (this.handlers[n] = this.handlers[n] || []).push(f); },
    asc_unregisterCallback(n, f) { const a = this.handlers[n] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    send(n, ...a) { (this.handlers[n] || []).slice().forEach(f => f.apply(this, a)); },
    asc_getZoom() { return this.zoom; }, asc_setZoom(z) { this.calls.push('asc_setZoom ' + z); },
    asc_enableKeyEvents(v) { this.calls.push('keys ' + v); }, asc_setCellFontSize(v) { this.calls.push('asc_setCellFontSize ' + v); },
    asc_isDocumentModified() { return false; }, asc_Resize() {}, asc_isProtectedSheet() { return false; },
    asc_getCellInfo() { const me = this; return {asc_getXfs: () => ({asc_getFontColor: () => me.fontColor, asc_getFillColor: () => me.fillColor,
        asc_getFontName: () => me.fontName})}; }};
window.Common = {NotificationCenter: events({}), Gateway: {on() {}},
    Utils: {String: {parseFloat: s => { (typeof s === 'string') && (s = s.replace(',', '.')); return parseFloat(s); }, htmlEncode: s => String(s)}, zoom: () => 1},
    UI: {warning: o => log.push('warning'), Menu: {Manager: {hideAll() {}}}, LayoutManager: {isElementVisible: () => true}, isRTL: () => false}};
window.AscCommon = {UserInfoParser: {getParsedName: n => n}};
const ntr = Common.NotificationCenter.trigger;
Common.NotificationCenter.trigger = function (n, ...a) { notes.push(n + (a.length ? ' ' + a[0] : '')); return ntr.apply(this, [n, ...a]); };
const fsCtl = {api, _state: {}, toolbar: {}, textFontSizeErr: 'bad size', _getApiTextSize: () => 11};
fsCtl.onFontSizeChanged = (${stockFontSize});
fontSize.on('changed:before', fsCtl.onFontSizeChanged.bind(fsCtl, true));
fontSize.on('changed:after', fsCtl.onFontSizeChanged.bind(fsCtl, false));

const toolbarView = {
    btnUndo: twin('Toolbar:btnUndo'), btnRedo: twin('Toolbar:btnRedo'),
    cmbNumberFormat: numFormat, cmbFontName: fontName, cmbFontSize: fontSize,
    btnCurrencyStyle: twin('Toolbar:btnCurrencyStyle'), btnPercentStyle: twin('Toolbar:btnPercentStyle'),
    btnDecDecimal: twin('Toolbar:btnDecDecimal'), btnIncDecimal: twin('Toolbar:btnIncDecimal'),
    btnDecFontSize: twin('Toolbar:btnDecFontSize'), btnIncFontSize: twin('Toolbar:btnIncFontSize'),
    btnBold: twin('Toolbar:btnBold', {toggle: true}), btnItalic: twin('Toolbar:btnItalic', {toggle: true}),
    btnUnderline: twin('Toolbar:btnUnderline', {toggle: true}), btnStrikeout: twin('Toolbar:btnStrikeout', {toggle: true}),
    btnTextColor: twin('Toolbar:btnTextColor'), btnBackColor: twin('Toolbar:btnBackColor'),
    btnBorders: withMenu('Toolbar:btnBorders', ['Bottom border']), btnMerge: withMenu('Toolbar:btnMerge', ['Merge & center']),
    btnAlignLeft: twin('Toolbar:btnAlignLeft', {toggle: true, allowDepress: false, pressed: true}),
    btnAlignCenter: twin('Toolbar:btnAlignCenter', {toggle: true, allowDepress: false}),
    btnAlignRight: twin('Toolbar:btnAlignRight', {toggle: true, allowDepress: false}),
    btnAlignJust: twin('Toolbar:btnAlignJust', {toggle: true, allowDepress: false}),
    btnAlignTop: twin('Toolbar:btnAlignTop', {toggle: true, allowDepress: false}),
    btnAlignMiddle: twin('Toolbar:btnAlignMiddle', {toggle: true, allowDepress: false}),
    btnAlignBottom: twin('Toolbar:btnAlignBottom', {toggle: true, allowDepress: false, pressed: true}),
    btnWrap: twin('Toolbar:btnWrap', {toggle: true}), btnInsertHyperlink: twin('Toolbar:btnInsertHyperlink'),
    btnInsertFormula: withMenu('Toolbar:btnInsertFormula', ['SUM']), btnInsertImage: withMenu('Toolbar:btnInsertImage', ['From file']),
    btnInsertChartRecommend: twin('Toolbar:btnInsertChartRecommend'), btnTextOrient: withMenu('Toolbar:btnTextOrient', ['Horizontal']),
    btnCondFormat: withMenu('Toolbar:btnCondFormat', ['Clear rules']), btnClearStyle: withMenu('Toolbar:btnClearStyle', ['All']),
    btnCopyStyle: twin('Toolbar:btnCopyStyle', {toggle: true})
};
const dataView = {btnsSetAutofilter: [twin('DataTab:btnsSetAutofilter.0', {toggle: true})], btnsSortDown: [twin('DataTab:btnsSortDown.0')],
    btnsSortUp: [twin('DataTab:btnsSortUp.0')], btnCustomSort: twin('DataTab:btnCustomSort'), btnDataValidation: twin('DataTab:btnDataValidation')};
const viewView = {btnFreezePanes: withMenu('ViewTab:btnFreezePanes', ['Freeze panes'])};
const comment = twin('ToolbarCtl:btnsComment.0');
const review = {btnHistory: twin('Review:btnHistory'), btnSharing: twin('Review:btnSharing')};
const appOptions = Object.assign({isEdit: true, canCoAuthoring: true, canComments: true, canDownload: true, canPrint: true,
    canUseHistory: true, canHistoryClose: true, canHistoryRestore: true}, O.options || {});
const shortcuts = {EditUndo: ['Ctrl', 'Z']};
window.registry = {map: shortcuts, events: [],
    getShortcutsByActionType(n) { return this.map[n] ? [{keys: this.map[n]}] : null; },
    updateShortcutHints(hints) { Object.keys(hints).forEach(n => { const it = hints[n]; const cb = () => it.applyCallback(it, it.label);
        cb(); this.events.push(cb); }); },
    setApi() { this.events.forEach(cb => cb()); }};
window.leftMenu = {btnSearchBar: {pressed: false}, btnComments: {pressed: false}, btnChat: {pressed: false}, btnSpellcheck: {pressed: false}, buttons: []};
/* The layout is real (Layout.js), it is built by BUILD below and put into the Viewport controller. */
window.vpCtl = {getApi: () => api, viewport: null};
window.SSE = {Views: {}, getController(name) {
    switch (name) {
        case 'Main': return {appOptions, editorConfig: {ui: {shell: 'modern'}}};
        case 'Toolbar': return {toolbar: Object.assign(events({}), toolbarView), btnsComment: [comment]};
        case 'DataTab': return {view: dataView};
        case 'ViewTab': return {view: viewView};
        case 'Common.Controllers.ReviewChanges': return {view: review};
        case 'Viewport': return vpCtl;
        case 'LeftMenu': return {leftMenu};
        case 'Common.Controllers.Shortcuts': return registry;
        default: return null;
    }
}};
window.__mods = {};
window.define = (deps, factory) => { window.__mods[window.__mod] = factory(...deps.map(d => window.__mods[d])); };
true;`;

/* The markup is a piece of Viewport.template: the vertical layout, the sheet area, the history column. */
const BODY = cls => `<body class="${cls}"><div id="stock" style="display:none"></div>
<div id="viewport"><div class="layout-region"><div id="viewport-vbox-layout" class="layout-ct vbox">
<section id="app-title" class="layout-item"></section>
<div id="toolbar" class="layout-item" role="toolbar"><section class="toolbar"><div id="box-right-btn-group"></div></section></div>
<div class="layout-item middle"><div id="viewport-hbox-layout" class="layout-ct hbox">
  <div id="left-menu" class="layout-item" style="width: 40px;"></div>
  <div class="layout-item"><div class="layout-ct vbox">
    <div id="cell-editing-box" class="layout-item" style="height:18px;"></div>
    <div id="editor_sdk" class="layout-item" tabindex="0"></div>
  </div></div>
  <div id="right-menu" class="layout-item"></div>
  <div id="left-panel-history" class="layout-item"></div>
</div></div>
<div id="statusbar" class="layout-item"></div>
</div></div></div></body>`;

/* The layout and the column are as in view/Viewport.js render and Common.Views.History.render; the stock
   layout handler (onLayoutChanged) is subscribed before the shell, as in the stock onLaunch. */
const BUILD = (tpl, onLayoutChanged) => `(() => {
    const vb = $('#viewport-vbox-layout'), vi = vb.find(' > .layout-item');
    const vlayout = new Common.UI.VBoxLayout({box: vb, items: [
        {el: vb.find('> .layout-item#app-title').hide(), alias: 'title', height: 28},
        {el: vi[1], alias: 'toolbar', height: 92},
        {el: vi[2], stretch: true},
        {el: vi[3], alias: 'statusbar', height: 25}]});
    const hb = $('#viewport-hbox-layout'), hi = hb.find(' > .layout-item');
    const hlayout = new Common.UI.HBoxLayout({box: hb, items: [
        {el: hi[0], rely: true, alias: 'left', resize: {hidden: true, autohide: false, min: 300, max: 600, offset: 4}},
        {el: hi[3], rely: true, alias: 'history', resize: {hidden: true, autohide: false, min: 300, max: 600}},
        {el: hi[1], stretch: true},
        {el: $(hi[2]).hide(), rely: true, alias: 'right', resize: {hidden: true, autohide: false, min: -600, max: -260}}]});
    const cb = hb.find('.layout-ct.vbox'), ci = cb.find(' > .layout-item');
    const celayout = new Common.UI.VBoxLayout({box: cb, items: [{el: ci[0], rely: true, alias: 'celleditor'}, {el: ci[1], stretch: true}]});
    vpCtl.viewport = {vlayout, hlayout, celayout};
    vpCtl.api = api;
    vpCtl.boxSdk = $('#editor_sdk');
    vpCtl.boxFormula = $('#cell-editing-box');
    vpCtl.boxSdk.css('border-left', 'none');
    vpCtl.boxFormula.css('border-left', 'none');
    vpCtl.onLayoutChanged = (${onLayoutChanged});
    Common.NotificationCenter.on('layout:changed', vpCtl.onLayoutChanged.bind(vpCtl));
    /* The stock onWindowResize: onLayoutChanged('window') - a recalculation of all three layouts. */
    $(window).on('resize', () => vpCtl.onLayoutChanged('window'));
    vlayout.doLayout(); celayout.doLayout(); hlayout.doLayout();

    const tpl = ${JSON.stringify(tpl)};
    $('#left-panel-history').html(_.template(tpl.box)({scope: {textVersionHistory: 'Version History'}})).hide();
    /* The buttons are Common.UI.Button markup (btn-toolbar, the hint is aria-label). */
    $('#history-btn-back').html('<button type="button" class="btn btn-toolbar canfocused" aria-label="Close history">' +
        '<i class="icon toolbar__icon btn-close">&nbsp;</i><span class="caption"></span></button>');
    $('#history-btn-menu').html('<div class="btn-group hidden"><button type="button" class="btn dropdown-toggle btn-toolbar no-caret" ' +
        'data-toggle="dropdown" aria-haspopup="menu" aria-expanded="false" aria-label="More"><i class="icon toolbar__icon btn-more">&nbsp;</i>' +
        '<span class="caption"></span><span class="inner-box-caret"><i class="caret"></i></span></button><ul class="dropdown-menu" role="menu"></ul></div>');
    window.closes = 0;
    document.querySelector('#history-btn-back button').addEventListener('click', () => { window.closes++; });

    /* The rows are DataView/TreeView: .treeview.inner > .item.canfocused > the row template. */
    /* A row choice redraws it with the standard template (selected → "Restore" on a
       non-latest version with canRestore), like DataView on a record change. */
    window.renderRows = (n, sel, restore) => {
        const rows = [];
        for (let v = n; v >= 1; v--) rows.push(Object.assign({id: 'rev-' + v, isVisible: true, hasParent: false, hasSubItems: false, isExpanded: true,
            avatar: '', usercolor: '#a273e5', initials: 'D', created: '2026-10-' + String(v % 28 + 1).padStart(2, '0') + ' 10:00:00',
            markedAsVersion: true, version: v, username: 'Designer', canRestore: !!restore && v !== n, selected: v === sel}));
        const it = _.template(tpl.item);
        $('#history-list').html('<div class="treeview inner ps-container oo" style="border: none" role="tree">' +
            rows.map(r => '<div class="item canfocused' + (r.selected ? ' selected' : '') + '" tabindex="0" role="treeitem" aria-level="1">' + it(r) + '</div>').join('') + '</div>');
        document.querySelectorAll('#history-list .treeview > .item').forEach(el => el.addEventListener('click', () => {
            const v = Number(el.firstElementChild.id.replace('rev-', ''));
            log.push('select ' + el.firstElementChild.id);
            if (v !== sel) renderRows(n, v, restore);
        }));
    };
    /* Without canHistoryClose - like controller/History.js setMode. */
    window.noClose = () => { $('#history-box #history-header').hide(); $('#history-box #history-list').css('padding-top', 0); };
    /* The show is like LeftMenu.showHistory: the column, the inline width, layout:changed 'history';
       the list follows (Main.onRefreshHistory: store.reset). */
    window.openHistory = (n = 2, sel = n, restore = true) => {
        const p = $('#left-panel-history');
        p.show();
        p.width(300 - 40);
        Common.NotificationCenter.trigger('layout:changed', 'history');
        renderRows(n, sel, restore);
    };
    return true;
})()`;

const SHELL_MODULES = [
    ['common/main/lib/view/compact/Icons', path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js')],
    ['spreadsheeteditor/main/app/view/StockBridge', path.join(VIEW, 'StockBridge.js')],
    ['spreadsheeteditor/main/app/view/SheetActions', path.join(VIEW, 'SheetActions.js')],
    ['spreadsheeteditor/main/app/view/CompactToolbar', path.join(VIEW, 'CompactToolbar.js')],
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
const STOCK_LAYOUT_CHANGED = readStock(STOCK_VIEWPORT_CTL, 'onLayoutChanged');
const TPL = stockHistoryTemplates();

/* withShell - the real shell, create() as on app:ready; without it - the standard editor. */
async function fresh(opt = {}, width = 1440, withShell = true) {
    if (page) await page.close();
    page = await browser.newPage({viewport: {width, height: 900}});
    page.on('pageerror', e => console.error('  page error:', e.message));
    await page.setContent(`<!doctype html><html><head><base href="${BASE}"><style>${css}</style></head>${BODY('theme-type-light')}</html>`);
    for (const f of ['vendor/underscore/underscore.js', 'vendor/jquery/jquery.js', 'vendor/backbone/backbone.js'])
        await page.addScriptTag({path: path.join(ROOT, f)});
    await page.evaluate(HARNESS(opt, STOCK_FS));
    await page.evaluate(() => { window.__mod = 'common/main/lib/component/Layout'; });
    await page.addScriptTag({content: fs.readFileSync(STOCK_LAYOUT, 'utf8') + '\n//# sourceURL=Layout.js'});
    await page.evaluate(BUILD(TPL, STOCK_LAYOUT_CHANGED));
    if (withShell) {
        for (const [name, file] of SHELL_MODULES) {
            await page.evaluate(n => { window.__mod = n; }, name);
            await page.addScriptTag({content: fs.readFileSync(file, 'utf8') + '\n//# sourceURL=' + path.basename(file)});
        }
        await page.evaluate(() => { SSE.Views.CompactShell.create(); });
    }
    await flush();
    return page;
}

const flush = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
/* The value of a runtime token in the computed form: a temporary node with it in the needed property. */
const token = (name, prop = 'color') => page.evaluate(([n, p]) => {
    const el = document.createElement('div');
    el.style.setProperty(p === 'shadow' ? 'box-shadow' : p === 'bg' ? 'background-color' : 'color', 'var(' + n + ')');
    document.body.appendChild(el);
    const s = getComputedStyle(el), v = p === 'shadow' ? s.boxShadow : p === 'bg' ? s.backgroundColor : s.color;
    el.remove();
    return v;
}, [name, prop]);
const box = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect();
    return {l: r.left, t: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom}; }, sel);
const cs = (sel, props) => page.evaluate(([s, p]) => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e);
    const o = {}; p.forEach(k => { o[k] = c[k]; }); return o; }, [sel, props]);
const shown = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) if (getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden') return false;
    return e.getClientRects().length > 0; }, sel);
const mouseTo = async sel => { const b = await box(sel); await page.mouse.move(b.l + b.w / 2, b.t + b.h / 2, {steps: 2}); return b; };
const active = () => page.evaluate(() => { const a = document.activeElement; return {id: a && a.id, tag: a && a.tagName,
    inBox: !!(a && a.closest && a.closest('#history-box')), inBack: !!(a && a.closest && a.closest('#history-btn-back')), label: a && a.getAttribute && a.getAttribute('aria-label')}; });

const BOX = 'body #history-box', HEADER = '#history-header', LABEL = '#history-header > label';
const CROSS = '#history-btn-back button', GLYPH = '#history-btn-back button .vo-air', SPRITE = '#history-btn-back button > i.btn-close';
const ITEM = n => '#history-list .treeview > .item:nth-child(' + n + ')';
/* The window rounding and shadow are as in the Documents compact windows (their computed: @vo-r-pop 12 and
   the --vo-shadow of popups from the Documents compact-shell.less); the spreadsheet editor menus and popups have
   their own @vo-r-pop 18 and --vo-shadow, the history window does not change them. */
const DOCS_WIN = {radius: '12px', shadow: 'rgba(0, 0, 0, 0.2) 0px 6px 12px 0px'};

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('history_window_air_box', async () => {
    for (const width of [1440, 1280]) {
        await fresh({}, width);
        await page.evaluate(() => openHistory(2, 2, true));
        await flush();
        const c = await cs(BOX, ['backgroundColor', 'borderTopLeftRadius', 'borderBottomRightRadius', 'boxShadow', 'position']);
        assert.equal(c.backgroundColor, await token('--vo-surface', 'bg'), width + ': box background is --vo-surface');
        assert.equal(c.borderTopLeftRadius, DOCS_WIN.radius, width + ': radius as in document windows');
        assert.equal(c.borderBottomRightRadius, DOCS_WIN.radius, width + ': radius as in document windows');
        assert.equal(c.boxShadow, DOCS_WIN.shadow, width + ': shadow as in document windows');
        const l = await cs(LABEL, ['fontSize', 'lineHeight', 'fontWeight', 'letterSpacing', 'color']);
        assert.deepEqual([l.fontSize, l.lineHeight, l.fontWeight, l.letterSpacing], ['19px', '26px', '500', '-0.2px'], width + ': title type');
        assert.equal(l.color, await token('--vo-text'), width + ': title colour');
        const h = await cs(HEADER, ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderBottomWidth']);
        assert.deepEqual([h.paddingTop, h.paddingRight, h.paddingBottom, h.paddingLeft], ['14px', '24px', '0px', '24px'], width + ': header padding');
        assert.equal(h.borderBottomWidth, '0px', width + ': no line under the header');
        /* The close (X) button: 24 × 24 with the AIR close mask, the sprite is not visible, color base-4, base-2 under the mouse. */
        const g = await box(GLYPH);
        assert.ok(g && g.w === 24 && g.h === 24, width + ': cross glyph 24 × 24: ' + JSON.stringify(g));
        const mask = await page.evaluate(s => { const e = document.querySelector(s); const c = getComputedStyle(e); return (c.webkitMaskImage || c.maskImage) + ' ' + c.getPropertyValue('--vo-air-src'); }, GLYPH);
        assert.ok(/air\/close\.svg/.test(mask), width + ': cross is the AIR close mask: ' + mask);
        assert.equal(await shown(SPRITE), false, width + ': stock btn-close sprite is hidden');
        /* "More" (the stock shows it when the versions have changes) - the AIR more glyph instead of the sprite. */
        const more = await page.evaluate(() => { const b = document.querySelector('#history-btn-menu button'), g = b.querySelector('.vo-air');
            return {glyphs: b.querySelectorAll('.vo-air').length, src: g ? g.style.getPropertyValue('--vo-air-src') : '', sprite: getComputedStyle(b.querySelector('i.btn-more')).display}; });
        assert.ok(more.glyphs === 1 && /air\/more\.svg/.test(more.src) && more.sprite === 'none', width + ': «More» is the AIR more glyph: ' + JSON.stringify(more));
        assert.equal((await cs(CROSS, ['color'])).color, await token('--vo-text-off'), width + ': cross colour at rest');
        await mouseTo(CROSS);
        await flush();
        const hov = await cs(CROSS, ['color', 'backgroundColor']);
        assert.equal(hov.color, await token('--vo-text-2'), width + ': cross colour under the mouse');
        assert.equal(hov.backgroundColor, 'rgba(0, 0, 0, 0)', width + ': no plate under the cross');
        await page.mouse.move(5, 600);
        /* Position: 420 on the right flush with the panel card, the top is the column + 8, the bottom is no lower than the column - 8. */
        const b = await box(BOX), col = await box('#left-panel-history'), tb = await box('#vo-tb');
        assert.equal(b.w, 420, width + ': width');
        assert.equal(b.r, tb.r, width + ': right edge = toolbar card edge');
        assert.equal(b.r, width - 20, width + ': right edge = @vo-pad-x from the window');
        assert.equal(b.t, col.t + 8, width + ': top = column top + 8');
        assert.ok(b.b <= col.b - 8, width + ': bottom within column − 8');
        /* There is no dimming, the point of the sheet outside the window is the sheet. */
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('.modals-mask')].filter(m => m.getClientRects().length).length), 0, width + ': no mask');
        const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.id; }, [200, b.t + 100]);
        assert.equal(hit, 'editor_sdk', width + ': a sheet point outside the window is the sheet');
    }
});

test('history_column_takes_no_place', async () => {
    await fresh({}, 1440);
    const before = {sdk: await box('#editor_sdk'), ce: await box('#cell-editing-box'),
        bl: await cs('#editor_sdk', ['borderLeftWidth']), cbl: await cs('#cell-editing-box', ['borderLeftWidth'])};
    await page.evaluate(() => openHistory(2));
    await flush();
    const col = await page.evaluate(() => { const p = document.getElementById('left-panel-history');
        return {w: getComputedStyle(p).width, offsetH: p.offsetHeight, visible: $('#left-panel-history').is(':visible'), inline: p.style.width}; });
    assert.equal(col.w, '0px', 'computed column width');
    assert.ok(col.offsetH > 0, 'column stays shown: offsetHeight ' + col.offsetH);
    assert.equal(col.visible, true, 'stock isVisible() check holds');
    assert.equal(col.inline, '260px', 'precondition: stock wrote its width inline');
    assert.equal(await shown('#left-panel-history + .layout-resizer'), false, 'no resizer by the column');
    assert.ok(await page.evaluate(() => vpCtl.viewport.hlayout.getItem('history').resize.el[0].style.display !== 'none'),
        'precondition: stock showed the resizer inline');
    assert.equal((await box('#editor_sdk')).l, before.sdk.l, 'sheet does not move');
    assert.equal((await box('#cell-editing-box')).l, before.ce.l, 'formula bar does not move');
    assert.equal(before.sdk.l, 0, 'precondition: sheet at 0');
    assert.equal((await cs('#editor_sdk', ['borderLeftWidth'])).borderLeftWidth, before.bl.borderLeftWidth, 'no new line at the sheet edge');
    assert.equal((await cs('#cell-editing-box', ['borderLeftWidth'])).borderLeftWidth, before.cbl.borderLeftWidth, 'formula bar edge');
    assert.equal(await page.evaluate(() => document.getElementById('editor_sdk').style.borderLeftStyle), '',
        'precondition: stock removed the inline border-left of the sheet');
});

test('history_rows_air_states', async () => {
    await fresh({}, 1440);
    await page.evaluate(() => openHistory(3, 3, true));
    await flush();
    const sel = await cs(ITEM(1), ['backgroundColor']);
    assert.equal(sel.backgroundColor, await token('--vo-selected', 'bg'), 'selected version is --vo-selected');
    await mouseTo(ITEM(2));
    await flush();
    assert.equal((await cs(ITEM(2), ['backgroundColor'])).backgroundColor, await token('--vo-hover', 'bg'), 'hovered row is --vo-hover');
    await page.mouse.down();
    await flush();
    assert.equal((await cs(ITEM(2), ['backgroundColor'])).backgroundColor, await token('--vo-active', 'bg'), 'pressed row is --vo-active');
    await page.mouse.up();
    await flush();
    assert.deepEqual(await page.evaluate(() => log.filter(x => /^select/.test(x))), ['select rev-2'], 'one click selects version 2');
    await page.mouse.move(5, 600);
    await flush();
    assert.equal((await cs(ITEM(2), ['backgroundColor'])).backgroundColor, await token('--vo-selected', 'bg'), 'clicked version is selected');
    /* The full window width, the row padding is the window padding: the avatar under the caption. */
    const b = await box(BOX), row = await box(ITEM(2)), av = await box(ITEM(2) + ' .color'), lb = await box(LABEL);
    assert.equal(row.l, b.l, 'row starts at the window edge');
    assert.equal(row.w, b.w, 'row spans the window');
    assert.equal(av.l, lb.l, 'avatar stands under the title');
    assert.equal(av.l - b.l, 24, 'row field = window field');
    /* "Restore" on a selected non-latest version is the plain window button. */
    assert.ok(await shown(ITEM(2) + ' .revision-restore'), 'restore on the selected older version');
    const r = await cs(ITEM(2) + ' .revision-restore', ['height', 'borderTopLeftRadius', 'backgroundColor', 'color', 'fontSize', 'fontWeight', 'borderBottomWidth', 'paddingLeft']);
    assert.deepEqual([r.height, r.borderTopLeftRadius, r.fontSize, r.fontWeight, r.borderBottomWidth, r.paddingLeft], ['34px', '10px', '14px', '500', '0px', '13px'], 'restore metrics');
    assert.equal(r.backgroundColor, await token('--vo-surface', 'bg'), 'restore is plain');
    assert.equal(r.color, await token('--vo-text-2'), 'restore colour');
});

test('history_long_list_fits_column', async () => {
    await fresh({}, 1440);
    await page.evaluate(() => openHistory(30));
    await flush();
    const b = await box(BOX), col = await box('#left-panel-history');
    assert.ok(b.h <= col.h - 16, 'window not taller than the column − 16: ' + b.h + ' / ' + col.h);
    assert.ok(b.b <= col.b - 8, 'bottom within the column − 8');
    const sc = await page.evaluate(() => { const t = document.querySelector('#history-list .treeview.inner'); return {ch: t.clientHeight, sh: t.scrollHeight}; });
    assert.ok(sc.ch > 0 && sc.sh > sc.ch, 'the list has a bounded height to scroll in: ' + JSON.stringify(sc));
});

test('history_close_by_cross_and_escape', async () => {
    await fresh({}, 1440);
    await page.evaluate(() => openHistory(2));
    await flush();
    await mouseTo(CROSS);
    await page.mouse.down();
    await page.mouse.up();
    await flush();
    assert.equal(await page.evaluate(() => closes), 1, 'one close per click on the cross');
    await page.evaluate(() => document.getElementById('history-box').focus());
    await page.keyboard.press('Escape');
    await flush();
    assert.equal(await page.evaluate(() => closes), 2, 'Escape in the window closes once');
    await page.evaluate(() => document.querySelector('#history-list .treeview > .item').focus());
    await page.keyboard.press('Escape');
    await flush();
    assert.equal(await page.evaluate(() => closes), 3, 'Escape on a row of the window closes once');
    await page.mouse.click(300, 600);
    await flush();
    assert.equal((await active()).id, 'editor_sdk', 'precondition: focus in the sheet');
    await page.keyboard.press('Escape');
    await flush();
    assert.equal(await page.evaluate(() => closes), 3, 'Escape in the sheet does not close');
});

test('history_without_close_keeps_title', async () => {
    await fresh({options: {canHistoryClose: false}}, 1440);
    await page.evaluate(() => { noClose(); openHistory(2); });
    await flush();
    assert.equal(await page.evaluate(() => document.getElementById('history-header').style.display), 'none', 'precondition: stock hid the header inline');
    assert.ok(await shown(LABEL), 'title stays');
    assert.equal(await page.evaluate(s => document.querySelector(s).textContent, LABEL), 'Version History');
    assert.equal(await shown(CROSS), false, 'no cross without canHistoryClose');
    assert.equal((await cs('#history-list', ['paddingTop'])).paddingTop, '12px', 'body padding despite the inline padding-top: 0');
    await page.evaluate(() => document.getElementById('history-box').focus());
    await page.keyboard.press('Escape');
    await flush();
    assert.equal(await page.evaluate(() => closes), 0, 'Escape sends nothing');
});

test('history_aria_and_focus', async () => {
    await fresh({}, 1440);
    await page.evaluate(() => openHistory(2));
    await flush();
    const a = await active();
    assert.ok(a.inBox && a.id === 'history-box', 'focus on the window right after opening: ' + JSON.stringify(a));
    const attrs = await page.evaluate(() => { const b = document.getElementById('history-box'), id = b.getAttribute('aria-labelledby');
        return {role: b.getAttribute('role'), modal: b.getAttribute('aria-modal'), tab: b.getAttribute('tabindex'),
            label: id && document.getElementById(id) ? document.getElementById(id).textContent : null,
            isTitle: !!id && document.getElementById(id) === document.querySelector('#history-header > label')}; });
    assert.deepEqual(attrs, {role: 'dialog', modal: 'false', tab: '-1', label: 'Version History', isTitle: true}, 'window semantics');
    assert.equal(await page.evaluate(s => document.querySelector(s).getAttribute('aria-label'), CROSS), 'Close history', 'cross accessible name');
    await page.keyboard.press('Tab');
    const t = await active();
    assert.ok(t.inBack && t.label === 'Close history', 'Tab reaches the cross: ' + JSON.stringify(t));
    /* A repeated 'history' (handle, resize) does not duplicate the glyph and does not move focus. */
    await page.evaluate(() => { Common.NotificationCenter.trigger('layout:changed', 'history'); Common.NotificationCenter.trigger('layout:changed', 'history'); });
    await flush();
    assert.equal(await page.evaluate(() => document.querySelectorAll('#history-btn-back .vo-air').length), 1, 'one glyph on the cross');
    assert.ok((await active()).inBack, 'repeated layout:changed keeps focus where it was');
    /* Focus that went to the sheet without a human keypress (the stock after loading a version) returns to the window. */
    await page.evaluate(() => document.getElementById('editor_sdk').focus());
    await flush();
    assert.equal((await active()).id, 'editor_sdk', 'after Tab the focus belongs to the person');
    await mouseTo(ITEM(2));
    await page.mouse.down();
    await page.mouse.up();
    await page.evaluate(() => document.getElementById('editor_sdk').focus());
    await flush();
    assert.equal((await active()).id, 'history-box', 'a stock focus grab after a click in the window comes back to the window');
    await page.mouse.click(300, 600);
    await page.evaluate(() => document.getElementById('editor_sdk').focus());
    await flush();
    assert.equal((await active()).id, 'editor_sdk', 'after a click outside the focus stays in the sheet');
});

test('history_stock_in_advanced', async () => {
    /* Without the shell - the standard column: space in the layout, the panel background, no rounding. */
    await fresh({}, 1440, false);
    await page.evaluate(() => openHistory(2));
    await flush();
    const plain = {col: await box('#left-panel-history'), sdk: await box('#editor_sdk'),
        c: await cs(BOX, ['backgroundColor', 'borderTopLeftRadius', 'boxShadow', 'position'])};
    const stockW = await page.evaluate(() => { const p = document.getElementById('left-panel-history'); return [getComputedStyle(p).width, p.style.width]; });
    assert.ok(parseFloat(stockW[0]) >= 260 && stockW[0] === stockW[1], 'stock column width — the one stock wrote: ' + stockW);
    assert.ok(plain.sdk.l >= plain.col.r, 'sheet stands after the column: ' + plain.sdk.l + ' / ' + plain.col.r);
    assert.equal(plain.c.backgroundColor, 'rgb(247, 247, 247)', 'stock panel background');
    assert.equal(plain.c.borderTopLeftRadius, '0px', 'no radius');
    /* The shell standard mode is the same, without the window attributes and glyphs. */
    await fresh({}, 1440);
    await page.evaluate(() => openHistory(2));
    await flush();
    await page.evaluate(() => SSE.Views.CompactShell.toggleMode());
    await flush();
    assert.ok(await page.evaluate(() => document.body.classList.contains('vo-advanced') && !document.body.classList.contains('vo-compact')), 'precondition: Advanced');
    const adv = {col: await box('#left-panel-history'), sdk: await box('#editor_sdk'), c: await cs(BOX, ['backgroundColor', 'borderTopLeftRadius', 'position']),
        attrs: await page.evaluate(() => { const b = document.getElementById('history-box'); return ['role', 'aria-modal', 'aria-labelledby', 'tabindex', 'oo_editor_input'].filter(a => b.hasAttribute(a)); }),
        glyphs: await page.evaluate(() => document.querySelectorAll('#history-box .vo-air').length),
        sprite: await shown(SPRITE), history: await page.evaluate(() => document.body.classList.contains('vo-history'))};
    /* The stock writes the width once, on show (jQuery width with border-box accounts for the column
       border at that moment): in the Standard the column is exactly the width that was written, and the sheet is behind it. */
    const advW = await page.evaluate(() => { const p = document.getElementById('left-panel-history'); return [getComputedStyle(p).width, p.style.width]; });
    assert.ok(parseFloat(advW[0]) >= 259 && advW[0] === advW[1], 'Advanced: column width — the one stock wrote: ' + advW);
    assert.equal(adv.sdk.l, adv.col.r, 'Advanced: the sheet stands right after the column');
    assert.equal(plain.sdk.l, plain.col.r, 'stock: the sheet stands right after the column');
    assert.equal(adv.c.backgroundColor, plain.c.backgroundColor, 'Advanced: stock background');
    assert.equal(adv.c.borderTopLeftRadius, '0px', 'Advanced: no radius');
    assert.deepEqual(adv.attrs, [], 'Advanced: no window attributes');
    assert.equal(adv.glyphs, 0, 'Advanced: no AIR glyphs');
    assert.equal(adv.sprite, true, 'Advanced: stock sprite');
    assert.equal(adv.history, false, 'Advanced: no vo-history');
    /* Back to the compact - the window again. */
    await page.evaluate(() => SSE.Views.CompactShell.toggleMode());
    await flush();
    assert.equal((await box(BOX)).w, 420, 'back in compact: the window again');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#history-btn-back .vo-air').length), 1, 'back in compact: one glyph');
});

test('history_window_under_shell_menus', async () => {
    const viewportWidth = 620;
    await fresh({}, viewportWidth);
    await page.evaluate(() => openHistory(2));
    await flush();
    await page.click('#vo-shell .vo-mn-item');
    await flush();
    const drop = await page.evaluate(() => { const d = [...document.querySelectorAll('#vo-shell .vo-mn-drop')].find(n => n.getClientRects().length && getComputedStyle(n).display !== 'none');
        if (!d) return null; const r = d.getBoundingClientRect(); return {l: r.left, t: r.top, r: r.right, b: r.bottom}; });
    const b = await box(BOX);
    assert.ok(b.w === 420 && b.r === viewportWidth - 20, 'precondition: the history window at the right: ' + JSON.stringify(b));
    assert.ok(drop, 'precondition: the File list is open');
    const x = Math.max(drop.l, b.l) + 4, y = Math.max(drop.t, b.t) + 10;
    assert.ok(x < Math.min(drop.r, b.r) && y < Math.min(drop.b, b.b), 'precondition: the list crosses the window');
    const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return {inMenu: !!e.closest('.vo-mn-drop'), inBox: !!e.closest('#history-box')}; }, [x, y]);
    assert.deepEqual(hit, {inMenu: true, inBox: false}, 'the File list is above the window');
    /* The spreadsheet editor menus keep their own rounding and shadow: the history window does not change them. */
    const m = await cs('#vo-shell .vo-mn-drop.open', ['borderTopLeftRadius', 'boxShadow']);
    assert.equal(m.borderTopLeftRadius, '18px', 'shell menu radius stays @vo-r-pop');
    assert.equal(m.boxShadow, await token('--vo-shadow', 'shadow'), 'shell menu shadow stays --vo-shadow');
    assert.notEqual(m.boxShadow, DOCS_WIN.shadow, 'precondition: the menu and the window differ in shadow');
});

(async () => {
    const less = require(path.join(ROOT, 'build/node_modules/less'));
    /* The whole spreadsheet editor styles (app.less), compact-shell.less from the argument, in its own place in the build. */
    const app = fs.readFileSync(APP_LESS, 'utf8');
    assert.ok(/@import "compact-shell\.less";/.test(app), 'app.less: compact-shell.less import not found');
    css = (await less.render(app.replace('@import "compact-shell.less";', '@import ' + JSON.stringify(LESS) + ';'),
        {filename: APP_LESS, globalVars: {'app-image-const-path': '"resources/img"'}})).css;
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
