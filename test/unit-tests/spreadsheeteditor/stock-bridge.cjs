/* Run: node test/unit-tests/spreadsheeteditor/stock-bridge.cjs [path to StockBridge.js]
 * The bridge of the spreadsheet editor "Compact" shell to the standard ribbon: double addresses, a command
 * by the standard path, a refusal on a disabled one, stock event arguments, the menu mirror after
 * the 'show:before' preparation, depth and galleries, a choice by the standard item click, watching
 * a double node. The module is loaded in node via vm on top of a fake stock; where
 * the stock mechanics itself matters, the methods are taken from the real component sources
 * (MenuItem.onItemClick/setChecked/toggle, Menu.onItemClick, Button.click/doToggle/
 * toggle) - by the same technique as documenteditor/compact-shell-gate.cjs.
 * The optional argument is a broken copy of the bridge for the negative control:
 * a copy that reads the menu without 'show:before' must fail
 * mirror_reads_items_after_show_before.
 *
 * Galleries: the standard gallery menu of a double is shown at our control -
 * by the standard show path (Menu.show for the button menu, 'show.bs.dropdown' and over for the item
 * submenu), by an invisible anchor in place of the control (menuAlignEl), with the hidden ribbon path expanded
 * by classes and without moving its nodes; the choice is a standard click in the gallery itself;
 * where it cannot be shown - the standard command dialog. Galleries inside the mirror are a gallery item,
 * the stock inner menu (setInnerMenu) and the UpDownPicker counter - without an entry in gaps. A bridge
 * without galleries fails the gallery cases.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const FILE = process.argv[2] ? path.resolve(process.argv[2])
    : path.join(ROOT, 'apps/spreadsheeteditor/main/app/view/StockBridge.js');
const COMPONENTS = path.join(ROOT, 'apps/common/main/lib/component');

/* --- Real stock methods ------------------------------------------------------ */

/* The text of the method `name: function(...) {...}` from the component source (the first occurrence
   after `after`): braces are counted over the code without strings and comments. */
function stockMethod(file, name, after, globals) {
    const src = fs.readFileSync(path.join(COMPONENTS, file), 'utf8');
    const from = after ? src.indexOf(after) : 0;
    assert.ok(from >= 0, file + ': anchor ' + after + ' not found');
    const head = new RegExp('\\b' + name + '\\s*:\\s*function\\s*\\(').exec(src.slice(from));
    assert.ok(head, file + ': ' + name + ' not found');
    const start = from + head.index + head[0].lastIndexOf('function');      // the stock "function (" also comes with a space (CheckBox.js)
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
        if (c === '"' || c === "'") { const q = c; i++; while (src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
    }
    const text = src.slice(start, i + 1);
    const sandbox = Object.assign({_: {delay: (fn) => fn(), isEmpty: v => !v}, Common: {}}, globals || {});
    vm.createContext(sandbox);
    return vm.runInContext('(' + text + ')', sandbox, {filename: file + ':' + name});
}

const STOCK = {
    itemClick: stockMethod('MenuItem.js', 'onItemClick'),
    itemSetChecked: stockMethod('MenuItem.js', 'setChecked'),
    itemIsChecked: stockMethod('MenuItem.js', 'isChecked'),
    itemToggle: stockMethod('MenuItem.js', 'toggle'),
    itemIsDisabled: stockMethod('MenuItem.js', 'isDisabled'),
    menuItemClick: stockMethod('Menu.js', 'onItemClick', 'Common.UI.Menu = (function'),
    btnClick: stockMethod('Button.js', 'click'),
    btnDoToggle: stockMethod('Button.js', 'doToggle'),
    btnToggle: stockMethod('Button.js', 'toggle'),
    btnIsDisabled: stockMethod('Button.js', 'isDisabled'),
    /* The ribbon checkbox: Common.UI.CheckBox - a click on the field, the value, pressed state. $ is the wrapper of the caption
       node (setRawValue: $(this.$label.find('label')).attr(…)). */
    cbItemCheck: stockMethod('CheckBox.js', 'onItemCheck'),
    cbSetValue: stockMethod('CheckBox.js', 'setValue'),
    cbSetRawValue: stockMethod('CheckBox.js', 'setRawValue', null, {$: x => x}),
    cbIsChecked: stockMethod('CheckBox.js', 'isChecked'),
    cbIsDisabled: stockMethod('CheckBox.js', 'isDisabled'),
    cbGetValue: stockMethod('CheckBox.js', 'getValue')
};

/* --- Fake stock --------------------------------------------------------------- */

function events(target) {
    const handlers = {};
    target.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return target; };
    target.off = (name, fn) => { const a = handlers[name] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); return target; };
    target.trigger = function (name, ...args) { (handlers[name] || []).slice().forEach(fn => fn.apply(target, args)); return target; };
    target.count = name => (handlers[name] || []).length;
    return target;
}

function node(tag) {
    return {tagName: tag, nodeType: 1, attrs: {}, children: [], className: '', id: '', textContent: '',
            clicks: 0, click() { this.clicks++; if (this.onclick) this.onclick(); },
            querySelectorAll(sel) {
                const all = [];
                const walk = n => n.children.forEach(c => { all.push(c); walk(c); });
                walk(this);
                return all.filter(n => sel[0] === '.' ? String(n.className).split(/\s+/).includes(sel.slice(1)) : n.tagName === sel);
            },
            querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }};
}

/* A node wrapper with what the real methods call (attr, trigger). */
function cmp(el) {
    const $ = [el];
    $.attr = (k, v) => { el.attrs[k] = String(v); return $; };
    $.trigger = () => $;
    return $;
}

/* A ribbon button: the real stock click/doToggle/toggle/isDisabled. */
function button(opt = {}) {
    const b = events({
        disabled: !!opt.disabled, pressed: !!opt.pressed, enableToggle: !!opt.toggle, allowDepress: true,
        visible: opt.visible !== false, hidden: !!opt.hidden, options: {lock: opt.lock || []},
        keepState: opt.keepState, menu: opt.menu || null
    });
    b.cmpEl = cmp(node('div'));
    b.click = STOCK.btnClick; b.doToggle = STOCK.btnDoToggle; b.toggle = STOCK.btnToggle; b.isDisabled = STOCK.btnIsDisabled;
    b.setDisabled = function (v) { this.disabled = !!v; };
    return b;
}

/* A menu item: the real onItemClick/setChecked/toggle/isChecked/isDisabled. Not
   drawn (rendered: false) - toggle then does not touch the DOM, as in the stock. */
function item(caption, opt = {}) {
    const options = {caption};
    ['subtitle', 'description', 'value'].forEach(k => { if (opt[k] !== undefined) options[k] = opt[k]; });
    const it = events({
        caption, value: opt.value, disabled: !!opt.disabled, checkable: !!opt.checkable, checked: !!opt.checked,
        toggleGroup: opt.group || null, allowDepress: false, visible: opt.visible !== false, hidden: !!opt.hidden,
        rendered: opt.rendered === true, menu: opt.menu || null, options, id: 'mi-' + Math.random().toString(36).slice(2)
    });
    it.onItemClick = STOCK.itemClick; it.setChecked = STOCK.itemSetChecked; it.isChecked = STOCK.itemIsChecked;
    it.toggle = STOCK.itemToggle; it.isDisabled = STOCK.itemIsDisabled;
    it.setDisabled = function (v) { this.disabled = !!v; };
    it.setVisible = function (v) { this.hidden = !v; };
    it.cmpEl = cmp(node('li'));
    /* An item drawn by a template: <a><div><b>caption</b></div><div>value</div>…</a>
       (view/Toolbar.js pageSizeTemplate, pageMarginsTemplate). */
    if (opt.drawn) {
        const a = node('a');
        [caption].concat(opt.drawn).forEach(t => { const d = node('div'); d.textContent = t; a.children.push(d); });
        it.cmpEl[0].children.push(a);
    }
    return it;
}

/* A ribbon checkbox (Common.UI.CheckBox): the real stock onItemCheck/setValue/setRawValue/isChecked/isDisabled/getValue;
   drawn (rendered) - with a field and a caption, as after CheckBox.render. */
function checkbox(opt = {}) {
    const cb = events({rendered: opt.rendered !== false, disabled: !!opt.disabled, checked: !!opt.checked, indeterminate: !!opt.indeterminate,
        value: opt.checked ? 'checked' : 'unchecked', options: {}});
    cb.$chk = {prop() { return cb.$chk; }};
    cb.$label = {find: () => ({attr() {}})};
    cb.$el = cmp(node('div'));
    cb.onItemCheck = STOCK.cbItemCheck; cb.setValue = STOCK.cbSetValue; cb.setRawValue = STOCK.cbSetRawValue;
    cb.isChecked = STOCK.cbIsChecked; cb.isDisabled = STOCK.cbIsDisabled; cb.getValue = STOCK.cbGetValue;
    cb.setDisabled = function (v) { this.disabled = !!v; };
    return cb;
}

/* A menu: the items are bound to the menu the way Menu.render does it (item 'click' →
   Menu.onItemClick → 'item:click'). */
function menu(items) {
    const m = events({items, rendered: true, options: {}});
    m.onItemClick = STOCK.menuItemClick;
    m.parentEl = cmp(node('div'));
    items.forEach(i => {
        i.on('click', (it, e) => m.onItemClick(it, e));
        i.on('toggle', (it, state) => m.trigger('item:toggle', m, it, state));      // Menu.onItemToggle
    });
    return m;
}

/* The number format combo: a store, the value in the field, the list in the markup. */
function combo(records, current) {
    const el = node('div');
    const ul = node('ul');
    el.children.push(ul);
    const store = {models: records.map(r => ({attrs: r, get(k) { return this.attrs[k]; }}))};
    store.length = store.models.length;
    store.at = i => store.models[i];
    store.models.forEach(m => {
        const li = node('li'); li.id = m.get('id');
        const a = node('a'); a.textContent = m.get('displayValue');
        li.children.push(a); ul.children.push(li);
    });
    const div = node('li'); div.className = 'divider'; ul.children.push(div);
    const more = node('li'); more.id = 'id-toolbar-mnu-item-more-formats';
    const ma = node('a'); ma.textContent = 'More formats'; more.children.push(ma); ul.children.push(more);
    const c = events({store, displayField: 'displayValue', disabled: false, value: current,
                      getValue() { return this.value; }, isDisabled() { return this.disabled; }, itemClicked() {}});
    c.cmpEl = cmp(el);
    c.ul = ul;
    return c;
}

function makeEnv(file = FILE) {
    const log = [];
    const fill = [item('Down'), item('Right'), item('Up'), item('Left'), item('--'), item('Series')];
    const fillMenu = menu(fill);
    /* Like onShowBeforeFillNumMenu: item availability is by the engine answer on opening. */
    const allowed = {Down: true, Right: false, Up: true, Left: false, Series: true};
    fillMenu.on('show:before', (m, e) => {
        log.push('fill show:before ' + (e && e.target === e.currentTarget));
        m.items.forEach(i => i.caption !== '--' && i.setDisabled(!allowed[i.caption]));
    });

    /* Conditional formatting: two levels, galleries without a caption, a lazily attached
       selection handler (onShowBeforeCondFormat sets up 'item:click' on the first show). */
    const greater = item('Greater', {value: 5});
    const level3 = item('Third level', {menu: menu([item('Deep')])});
    const valueMenu = menu([greater, item('Less', {value: 7}), level3]);
    const bars = item('Data bars', {menu: menu([item(undefined)])});
    const cond = menu([item('Value is', {menu: valueMenu}), item('--'), bars, item('--'), item('--'),
                       item('New rule', {value: 'new'}), item('Hidden rule', {hidden: true}), item('Manage', {value: 'manage'}), item('--')]);
    let condWired = false;
    cond.on('show:before', () => {
        if (condWired) return;
        condWired = true;
        cond.on('item:click', (m, it) => log.push('cond ' + it.value));
        valueMenu.on('item:click', (m, it) => log.push('cond ' + it.value));
    });

    const borders = menu([item('Bottom'), item('Top'), item('--'), item('None', {disabled: true}),
                          item(undefined), item('Style', {menu: menu([item(undefined), item(undefined)])}), item('All')]);
    borders.on('item:click', (m, it) => log.push('borders ' + it.caption));

    const orient = menu([item('Portrait', {checkable: true, checked: true, group: 'orient'}),
                         item('Landscape', {checkable: true, group: 'orient'})]);
    orient.on('item:click', (m, it) => log.push('orient ' + it.caption + ' ' + it.checked));

    const printArea = menu([item('Set'), item('Clear'), item('Add')]);
    printArea.on('show:after', m => { log.push('printArea show:after'); m.items[2].setVisible(false); });
    /* The sheet views (view/ViewTab.js setButtonMenu): the first item is the holder of the
       inner menu (setInnerMenu: "Default" and the workbook views), then a separator
       and "View manager". */
    const viewInner = menu([item('Default', {checkable: true, checked: true}), item('View 1', {checkable: true})]);
    viewInner.on('item:toggle', (m, it, state) => { if (state) log.push('open view ' + it.caption); });
    const view = menu([item(undefined), item('--'), item('Manager')]);
    view.options.innerMenus = [{menu: viewInner, index: 0}];
    view.on('show:after', () => log.push('sheetView show:after (focus theft)'));

    /* The print scale (view/Toolbar.js mnuCustomScale): an item without a caption with the standard
       UpDownPicker counter - caption, up and down buttons, value. */
    const scaleEl = node('div');
    scaleEl.className = 'custom-scale';
    const sTitle = node('label'), sUp = node('button'), sVal = node('label'), sDown = node('button');
    sTitle.className = 'title float-left'; sTitle.textContent = 'Scale';
    sUp.className = 'btn small updown-picker-button-up';
    sVal.className = 'updown-picker-value'; sVal.textContent = '100%';
    sDown.className = 'btn small updown-picker-button-down';
    scaleEl.children.push(sTitle, sUp, sVal, sDown);
    sUp.onclick = () => { log.push('scale up'); sVal.textContent = '105%'; };
    sDown.onclick = () => { log.push('scale down'); sVal.textContent = '95%'; };
    const scaleItem = item(undefined);
    scaleItem.cmpEl = cmp(scaleEl);
    const scale = menu([item('Width', {menu: menu([item('Auto'), item('1 page')])}), scaleItem, item('--'), item('Custom')]);

    /* Item notes: page sizes (subtitle; a drawn item - in the current
       units), margins (values only in the template, no subtitle), co-editing
       modes (description). */
    const pageSize = menu([
        item('A4', {subtitle: '21cm x 29,7cm', drawn: ['21 см x 29.7 см'], checkable: true, checked: true, group: 'size'}),
        item('A3', {subtitle: '29,7cm x 42cm', checkable: true, group: 'size'}),
        item('--'), item('Custom')]);
    const margins = menu([item('Normal', {value: [19.1, 17.8, 19.1, 17.8], drawn: ['Top: 1.91 cm', 'Bottom: 1.91 cm']})]);
    const coauth = menu([item('Fast', {description: 'Real-time co-editing.', checkable: true, checked: true, group: 'co'}),
                         item('Strict', {description: 'Use Save to sync.', checkable: true, group: 'co'})]);

    /* The "Format" button of the "Home" tab (view/Toolbar.js btnFormatCell): rows, separators, "Locked cell" and, after a separator, "Format
       cells" (value 'formatCells'). The mirror of "Rows, columns and sheet ▸" is without it. */
    const formatCell = menu([item('Row height', {menu: menu([item('Auto'), item('Custom')])}), item('--'), item('Rename sheet', {value: 'renameSheet'}),
        item('--'), item('Locked cell', {value: 'lockedCell', checkable: true, checked: true}), item('--'), item('Format cells', {value: 'formatCells'})]);
    formatCell.on('item:click', (m, it) => log.push('format ' + it.value));

    const symbol = menu([item(undefined), item('--'), item('More symbols')]);
    symbol.items[2].on('click', () => log.push('symbol dialog'));

    const nf = combo([{id: 'nf-0', displayValue: 'General', exampleval: ''}, {id: 'nf-1', displayValue: 'Number', exampleval: ''}], 'Number');
    nf.on('show:before', () => {
        log.push('nf show:before');
        nf.store.models[0].attrs.exampleval = '42';
        nf.store.models[1].attrs.exampleval = '42.00';
    });
    nf.on('selected', (c, rec) => log.push('nf selected ' + (rec && rec.displayValue)));
    nf.ul.children[0].children[0].onclick = () => log.push('nf click General');
    nf.ul.children[3].children[0].onclick = () => log.push('nf more formats');

    const bold = button({toggle: true, lock: ['cell-editing'], keepState: []});
    bold.on('click', b => log.push('bold ' + b.pressed));
    const undo = button({disabled: true});
    undo.on('click', () => log.push('undo'));
    const textColor = button();
    textColor.on('color:select', (b, color) => log.push('color ' + color));

    const sortDown = [button(), button()];
    const sortArray = {0: sortDown[0], 1: sortDown[1], length: 2};      // the stock ButtonsArray is not an Array
    sortDown[0].on('click', () => log.push('sort down'));

    const toolbar = {
        btnBold: bold, btnUndo: undo, btnTextColor: textColor, cmbNumberFormat: nf, btnsSortDown: sortArray,
        btnFillNumbers: button({menu: fillMenu}), btnCondFormat: button({menu: cond}), btnBorders: button({menu: borders}),
        btnPageOrient: button({menu: orient}), btnPrintArea: button({menu: printArea}),
        btnInsertSymbol: button({menu: symbol}), btnHidden: button({visible: false}), btnFormatCell: button({menu: formatCell}),
        btnPageSize: button({menu: pageSize}), btnPageMargins: button({menu: margins}), btnScale: button({menu: scale})
    };
    const comment = button();
    comment.on('click', () => log.push('comment'));
    /* "Gridlines" of the "View" tab: the tab handler is as in the stock (view/ViewTab.js: 'change' →
       viewtab:gridlines with value == 'checked'). The bottom row: the sheet "+" and zoom. */
    const gridlines = checkbox({checked: true});
    gridlines.on('change', (field, value) => log.push('gridlines ' + (value == 'checked')));
    const statusbar = {btnAddWorksheet: button(), btnZoomUp: button()};
    statusbar.btnAddWorksheet.on('click', () => log.push('add sheet'));
    statusbar.btnZoomUp.on('click', () => log.push('zoom up'));
    const controllers = {
        Toolbar: {toolbar, btnsComment: [comment]},
        DataTab: {view: {btnGroup: button()}},
        FormulaDialog: {formulaTab: {btnWatch: button({toggle: true})}},
        ViewTab: {view: {btnFreezePanes: button(), btnSheetView: button({menu: view}), chGridlines: gridlines}},
        WBProtection: {view: {btnProtectSheet: button({toggle: true})}},
        PivotTable: {view: {btnsAddPivot: [button()]}},
        'Common.Controllers.ReviewChanges': {view: {btnCoAuthMode: button({menu: coauth})}},
        LeftMenu: {leftMenu: {btnComments: button({toggle: true, hidden: true})}},
        CellEditor: {editor: {btnNamedRanges: button()}},
        Statusbar: {statusbar}
    };
    const state = {throws: false};
    const observers = [];
    class FakeObserver {
        constructor(cb) { this.cb = cb; this.connected = false; observers.push(this); }
        observe(el, opts) { this.el = el; this.opts = opts; this.connected = true; }
        disconnect() { this.connected = false; }
        fire() { if (this.connected) this.cb([{type: 'attributes'}], this); }
    }
    const context = {
        SSE: {Views: {}, getController(name) { if (state.throws) throw new Error('not ready'); return controllers[name]; }},
        MutationObserver: FakeObserver,
        console: {warn() {}, log() {}, error() {}}
    };
    context.window = context;
    context.define = (deps, factory) => factory();
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
    return {B: context.SSE.Views.StockBridge, log, toolbar, controllers, state, observers, comment, sortDown, gridlines, context,
            fill, cond, valueMenu, borders, orient, symbol, nf, view, viewInner, scale, scaleBtns: {up: sUp, down: sDown}, formatCell};
}

/* --- Run --------------------------------------------------------------------- */

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

/* Arrays from the vm context are from another "realm" (their own Array.prototype): deepEqual compares
   them through plain copies. */
const plain = list => JSON.parse(JSON.stringify(list));

test('roots_resolve_toolbar_tabs_and_controller', () => {
    const env = makeEnv(), B = env.B, c = env.controllers;
    assert.equal(B.twin('Toolbar:btnBold'), env.toolbar.btnBold, 'Toolbar → view of the ribbon');
    assert.equal(B.twin('ToolbarCtl:btnsComment.0'), env.comment, 'ToolbarCtl → the ribbon controller');
    assert.equal(B.twin('DataTab:btnGroup'), c.DataTab.view.btnGroup);
    assert.equal(B.twin('Formula:btnWatch'), c.FormulaDialog.formulaTab.btnWatch, 'Formula → FormulaTab of FormulaDialog');
    assert.equal(B.twin('ViewTab:btnFreezePanes'), c.ViewTab.view.btnFreezePanes);
    assert.equal(B.twin('WBProtection:btnProtectSheet'), c.WBProtection.view.btnProtectSheet);
    assert.equal(B.twin('PivotTable:btnsAddPivot.0'), c.PivotTable.view.btnsAddPivot[0]);
    assert.equal(B.twin('Review:btnCoAuthMode'), c['Common.Controllers.ReviewChanges'].view.btnCoAuthMode);
    assert.equal(B.twin('LeftMenu:btnComments'), c.LeftMenu.leftMenu.btnComments);
    assert.equal(B.twin('CellEditor:btnNamedRanges'), c.CellEditor.editor.btnNamedRanges);
    assert.equal(B.twin('Toolbar:btnsSortDown.1'), env.sortDown[1], 'index into a ButtonsArray (not an Array)');
    assert.equal(B.twin('Toolbar:btnInsertSymbol.menu.items.2'), env.symbol.items[2], 'path into a menu item');
    ['Toolbar:btnNope', 'Toolbar:', ':btnBold', 'Nope:btnBold', 'Toolbar', '', null, undefined, 42, 'Toolbar:btnBold.menu.items.0']
        .forEach(ref => assert.equal(B.twin(ref), null, 'twin(' + JSON.stringify(ref) + ')'));
    env.state.throws = true;
    assert.equal(B.twin('Toolbar:btnBold'), null, 'getController throws → null, not an exception');
    assert.deepEqual(plain(B.state('Toolbar:btnBold')), {exists: false, disabled: true, pressed: false, visible: false, causes: []});
    env.state.throws = false;
    const st = B.state('Toolbar:btnBold');
    assert.equal(st.exists, true);
    assert.equal(st.disabled, false);
    assert.equal(B.state('Toolbar:btnHidden').visible, false, 'Button.setVisible(false) → not visible');
    assert.equal(B.state('LeftMenu:btnComments').visible, false, 'View.hide() → not visible');
});

test('run_clicks_button_once', () => {
    const env = makeEnv(), B = env.B;
    assert.equal(B.run('Toolbar:btnBold'), true);
    assert.deepEqual(env.log, ['bold true'], 'one stock click, toggle switched by Button.doToggle');
    assert.equal(B.state('Toolbar:btnBold').pressed, true, 'pressed is read from the twin');
    assert.equal(env.toolbar.btnBold.cmpEl[0].attrs['aria-pressed'], 'true', 'stock Button.toggle marked the node');
    env.log.length = 0;
    assert.equal(B.run('Toolbar:btnsSortDown.0'), true);
    assert.equal(B.run('ToolbarCtl:btnsComment.0'), true);
    assert.deepEqual(env.log, ['sort down', 'comment']);
    /* A menu item as a double: the standard onItemClick is the item 'click', and through the menu also 'item:click'. */
    env.log.length = 0;
    assert.equal(B.run('Toolbar:btnInsertSymbol.menu.items.2'), true);
    assert.deepEqual(env.log, ['symbol dialog'], 'menu item twin → its stock click handler, once');
});

test('run_refuses_disabled_or_missing', () => {
    const env = makeEnv(), B = env.B;
    assert.equal(B.run('Toolbar:btnUndo'), false, 'disabled twin');
    assert.equal(B.run('Toolbar:btnNope'), false, 'missing twin');
    assert.equal(B.run('Toolbar:btnCondFormat.menu.items.0'), false, 'menu item that holds a submenu');
    env.toolbar.btnBold.setDisabled(true);
    assert.equal(B.run('Toolbar:btnBold'), false, 'twin disabled after the menu was opened');
    env.toolbar.btnTextColor.setDisabled(true);
    assert.equal(B.run('Toolbar:btnTextColor', {event: 'color:select', args: ['ff0000']}), false, 'disabled twin refuses events too');
    assert.deepEqual(env.log, [], 'no stock handler ran');
    assert.equal(env.toolbar.btnBold.pressed, false, 'refused click must not toggle');
});

test('run_passes_stock_event_args', () => {
    const env = makeEnv(), B = env.B;
    assert.equal(B.run('Toolbar:btnTextColor', {event: 'color:select', args: ['ff0000']}), true);
    const rec = {displayValue: 'General', format: 'General'};
    assert.equal(B.run('Toolbar:cmbNumberFormat', {event: 'selected', args: [rec]}), true);
    assert.deepEqual(env.log, ['color ff0000', 'nf selected General'], 'twin first, then the stock arguments');
    let seen = null;
    env.toolbar.btnBold.on('changed:after', (b, a, c) => { seen = [b, a, c]; });
    B.run('Toolbar:btnBold', {event: 'changed:after', args: [1, 2]});
    assert.equal(seen[0], env.toolbar.btnBold, 'the twin goes first, as the stock does');
    assert.deepEqual(seen.slice(1), [1, 2]);
});

test('mirror_reads_items_after_show_before', () => {
    const env = makeEnv(), B = env.B;
    const list = B.mirror('Toolbar:btnFillNumbers');
    assert.deepEqual(env.log, ['fill show:before true'], "menu prepared by 'show:before' as its own show (target === currentTarget)");
    assert.deepEqual(plain(list), [
        {id: '0', caption: 'Down', disabled: false, checked: false},
        {id: '1', caption: 'Right', disabled: true, checked: false},
        {id: '2', caption: 'Up', disabled: false, checked: false},
        {id: '3', caption: 'Left', disabled: true, checked: false},
        {sep: true},
        {id: '5', caption: 'Series', disabled: false, checked: false}
    ], 'state after the stock preparation');
    /* A lazy stock subscription: a choice works only if the menu was prepared. */
    B.mirror('Toolbar:btnCondFormat');
    assert.equal(B.pick('Toolbar:btnCondFormat', '5'), true);
    assert.deepEqual(env.log.slice(-1), ['cond new'], 'stock handler wired on show:before receives the pick');
    /* The number format combo: the stock puts the examples on opening, the field value is checked. */
    env.log.length = 0;
    const nf = B.mirror('Toolbar:cmbNumberFormat');
    assert.deepEqual(env.log, ['nf show:before']);
    assert.deepEqual(plain(nf), [
        {id: 'nf-0', caption: 'General', example: '42', disabled: false, checked: false},
        {id: 'nf-1', caption: 'Number', example: '42.00', disabled: false, checked: true},
        {sep: true},
        {id: 'dom:id-toolbar-mnu-item-more-formats', caption: 'More formats', example: '', disabled: false, checked: false}
    ]);
    /* 'show:after' only for a menu from a closed list: for the others it takes focus away. */
    env.log.length = 0;
    const pa = B.mirror('Toolbar:btnPrintArea');
    assert.deepEqual(env.log, ['printArea show:after'], 'listed menu gets show:after');
    assert.deepEqual(plain(pa.map(e => e.caption)), ['Set', 'Clear'], 'visibility updated by show:after');
    env.log.length = 0;
    B.mirror('ViewTab:btnSheetView');
    assert.deepEqual(env.log, [], 'unlisted menu must not get show:after');
});

/* A gallery holder (an item with a submenu of items without a caption) is a mirror
   gallery row, not a skip: it will be shown by the standard popup (popup). The third level and a bare gallery without a caption directly in the menu (not an inner menu and not a
   counter) are still skipped - with an entry in gaps. */
test('mirror_depth_two_skips_galleries', () => {
    const env = makeEnv(), B = env.B;
    B.gaps.length = 0;
    const list = B.mirror('Toolbar:btnCondFormat');
    /* value - the stock item value in the mirror record (the button lists and
       "Clear format": the item is recognized and chosen by value). */
    assert.deepEqual(plain(list), [
        {id: '0', caption: 'Value is', disabled: false, checked: false, sub: [
            {id: '0.0', caption: 'Greater', disabled: false, checked: false, value: 5},
            {id: '0.1', caption: 'Less', disabled: false, checked: false, value: 7}
        ]},
        {sep: true},
        {id: '2', caption: 'Data bars', disabled: false, checked: false, gallery: true},
        {sep: true},
        {id: '5', caption: 'New rule', disabled: false, checked: false, value: 'new'},
        {id: '7', caption: 'Manage', disabled: false, checked: false, value: 'manage'}
    ], 'third level, hidden item and stray separators are skipped; the gallery holder is a gallery row');
    const kinds = plain(B.gaps.filter(g => g.ref === 'Toolbar:btnCondFormat').map(g => g.kind + ':' + g.what)).sort();
    assert.deepEqual(kinds, ['depth:Third level'], 'gaps record only what was skipped');
    const bd = B.mirror('Toolbar:btnBorders');
    assert.deepEqual(plain(bd.map(e => e.sep ? '--' : e.caption + (e.disabled ? ' (off)' : '') + (e.gallery ? ' [gallery]' : ''))),
        ['Bottom', 'Top', '--', 'None (off)', 'Style [gallery]', 'All'],
        'a bare palette item is skipped, a submenu of palette items is a gallery row');
    assert.deepEqual(plain(B.gaps.filter(g => g.ref === 'Toolbar:btnBorders').map(g => g.kind + ':' + g.what)), ['gallery:4'],
        'the bare palette item is a gap');
    const orient = B.mirror('Toolbar:btnPageOrient');
    assert.deepEqual(plain(orient.map(e => e.checked)), [true, false], 'checked mark of a toggle group');
    assert.deepEqual(plain(B.mirror('Toolbar:btnBold')), [], 'a twin without a menu mirrors nothing');
    assert.deepEqual(plain(B.mirror('Toolbar:btnNope')), [], 'a missing twin mirrors nothing');
    assert.ok(B.gaps.some(g => g.kind === 'missing' && g.ref === 'Toolbar:btnNope'), 'missing twin is marked');
});

/* Notes of the standard items: the stock draws them under the caption, the shell -
   on the right, muted. The mirror carries them in separate fields: hint is the value (subtitle,
   as the stock shows it now), desc is the description (description). */
test('mirror_reads_stock_notes', () => {
    const env = makeEnv(), B = env.B;
    assert.deepEqual(plain(B.mirror('Toolbar:btnPageSize')), [
        {id: '0', caption: 'A4', disabled: false, checked: true, hint: '21 см x 29.7 см'},
        {id: '1', caption: 'A3', disabled: false, checked: false, hint: '29,7cm x 42cm'},
        {sep: true},
        {id: '3', caption: 'Custom', disabled: false, checked: false}
    ], 'page size: the value the stock draws now; before drawing — its subtitle; no subtitle — no hint');
    assert.deepEqual(plain(B.mirror('Review:btnCoAuthMode')), [
        {id: '0', caption: 'Fast', disabled: false, checked: true, desc: 'Real-time co-editing.'},
        {id: '1', caption: 'Strict', disabled: false, checked: false, desc: 'Use Save to sync.'}
    ], 'co-editing modes: the stock description');
    assert.deepEqual(plain(B.mirror('Toolbar:btnPageMargins')), [
        {id: '0', caption: 'Normal', disabled: false, checked: false}
    ], 'margins: values only in the template — not shown');
});

test('pick_goes_through_stock_item_click', () => {
    const env = makeEnv(), B = env.B;
    B.mirror('Toolbar:btnBorders');
    assert.equal(B.pick('Toolbar:btnBorders', '6'), true);
    assert.deepEqual(env.log, ['borders All'], 'MenuItem.onItemClick → Menu.onItemClick → item:click, once');
    assert.equal(B.pick('Toolbar:btnBorders', '3'), false, 'disabled item');
    assert.equal(B.pick('Toolbar:btnBorders', '5'), false, 'item holding a submenu');
    assert.equal(B.pick('Toolbar:btnBorders', '2'), false, 'separator');
    assert.equal(B.pick('Toolbar:btnBorders', '99'), false, 'no such item');
    assert.equal(B.pick('Toolbar:btnBorders', 'x'), false, 'garbage id');
    env.log.length = 0;
    B.mirror('Toolbar:btnCondFormat');
    assert.equal(B.pick('Toolbar:btnCondFormat', '0.0'), true, 'second level by path');
    assert.equal(B.pick('Toolbar:btnCondFormat', ['0', '1']), true, 'second level by array');
    assert.deepEqual(env.log, ['cond 5', 'cond 7'], 'submenu item:click');
    env.log.length = 0;
    assert.equal(B.pick('Toolbar:btnPageOrient', '1'), true);
    assert.deepEqual(env.log, ['orient Landscape true'], 'stock onItemClick checked the item of the group');
    env.log.length = 0;
    assert.equal(B.pick('Toolbar:cmbNumberFormat', 'nf-0'), true);
    assert.equal(B.pick('Toolbar:cmbNumberFormat', 'dom:id-toolbar-mnu-item-more-formats'), true);
    assert.equal(B.pick('Toolbar:cmbNumberFormat', 'nf-9'), false);
    assert.deepEqual(env.log, ['nf click General', 'nf more formats'], 'combo entries go through a click on their own list');
    env.nf.disabled = true;
    assert.equal(B.pick('Toolbar:cmbNumberFormat', 'nf-0'), false, 'disabled combo refuses');
    assert.equal(B.pick('Toolbar:btnNope', '0'), false);
});

test('watch_reports_disabled_change', () => {
    const env = makeEnv(), B = env.B;
    const seen = [];
    const off = B.watch('Toolbar:btnBold', st => seen.push(st.disabled + '/' + st.pressed));
    assert.equal(env.observers.length, 1, 'one observer');
    const obs = env.observers[0];
    assert.equal(obs.el, env.toolbar.btnBold.cmpEl[0], 'observes the node of the twin');
    assert.equal(obs.opts.attributes, true);
    assert.deepEqual(plain(obs.opts.attributeFilter).sort(), ['aria-pressed', 'class', 'disabled']);
    env.toolbar.btnBold.setDisabled(true);
    obs.fire();
    env.toolbar.btnBold.setDisabled(false);
    env.toolbar.btnBold.toggle(true);
    obs.fire();
    assert.deepEqual(seen, ['true/false', 'false/true'], 'fresh state on every change');
    off();
    obs.fire();
    assert.equal(seen.length, 2, 'unwatched');
    assert.equal(typeof B.watch('Toolbar:btnNope', () => {}), 'function', 'missing twin → no-op unwatch');
});

/* --- Galleries inside the mirror ----------------------------------------------------- */

/* The stock inner menu (setInnerMenu: sheet views) - mirror rows with the address
   '<item>/<row>', a choice is a standard click of the inner menu row; the
   UpDownPicker counter (print scale) is a counter row: the caption and the stock value, a step is a click of the
   standard counter button. Neither goes into gaps. */
test('mirror_inner_menus_and_pickers_without_gaps', () => {
    const env = makeEnv(), B = env.B;
    B.gaps.length = 0;
    assert.deepEqual(plain(B.mirror('ViewTab:btnSheetView')), [
        {id: '0/0', caption: 'Default', disabled: false, checked: true},
        {id: '0/1', caption: 'View 1', disabled: false, checked: false},
        {sep: true},
        {id: '2', caption: 'Manager', disabled: false, checked: false}
    ], 'inner menu rows in place of their holder');
    assert.equal(B.pick('ViewTab:btnSheetView', '0/1'), true);
    assert.deepEqual(env.log, ['open view View 1'], 'inner menu row through its stock click, once');
    assert.equal(B.pick('ViewTab:btnSheetView', '0/9'), false, 'no such inner row');
    assert.equal(B.pick('ViewTab:btnSheetView', '2/0'), false, 'not an inner menu holder');
    env.log.length = 0;
    assert.deepEqual(plain(B.mirror('Toolbar:btnScale')), [
        {id: '0', caption: 'Width', disabled: false, checked: false, sub: [
            {id: '0.0', caption: 'Auto', disabled: false, checked: false},
            {id: '0.1', caption: '1 page', disabled: false, checked: false}
        ]},
        {id: '1', caption: 'Scale', disabled: false, checked: false, stepper: true, value: '100%'},
        {sep: true},
        {id: '3', caption: 'Custom', disabled: false, checked: false}
    ], 'UpDownPicker is a stepper row with the stock caption and value');
    assert.equal(B.pick('Toolbar:btnScale', '1'), false, 'a stepper row is not picked as an item');
    assert.equal(B.step('Toolbar:btnScale', '1', 'up'), true);
    assert.deepEqual(plain(B.stepper('Toolbar:btnScale', '1')), {caption: 'Scale', value: '105%', disabled: false}, 'value read back from the stock');
    assert.equal(B.step('Toolbar:btnScale', '1', 'down'), true);
    assert.deepEqual(env.log, ['scale up', 'scale down'], 'one stock button click per step');
    env.scaleBtns.up.className += ' disabled';
    env.scaleBtns.down.className += ' disabled';
    assert.equal(B.step('Toolbar:btnScale', '1', 'up'), false, 'disabled stock stepper refuses');
    assert.equal(B.stepper('Toolbar:btnScale', '1').disabled, true);
    assert.equal(B.step('Toolbar:btnScale', '0', 'up'), false, 'not a stepper');
    assert.deepEqual(plain(B.gaps), [], 'nothing skipped');
    /* The gallery row address for showing: the path of the double menu items. */
    assert.equal(B.itemRef('Toolbar:btnBorders', '5'), 'Toolbar:btnBorders.menu.items.5');
    assert.equal(B.twin(B.itemRef('Toolbar:btnCondFormat', '0.1')), env.valueMenu.items[1], 'second level');
    assert.equal(B.itemRef('ViewTab:btnSheetView', '0/1'), null, 'inner menu rows have no twin address');
});

/* --- Showing the standard gallery --------------------------------------------------- */

/* The fake ribbon DOM: nodes with a parent, classes, geometry and events. Drawn
   (getClientRects) is only a node with rendered = true - as in a ribbon hidden by style. */
const INNER_W = 1440;
class GEl {
    constructor(doc, tag) {
        this.ownerDocument = doc; this.tagName = String(tag).toUpperCase(); this.nodeType = 1;
        this.children = []; this.parentNode = null; this.cls = new Set(); this.style = {}; this.listeners = {};
        this.rendered = false; this.rect = null; this.id = '';
    }
    get className() { return [...this.cls].join(' '); }
    set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() {
        const s = this.cls;
        return {add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), contains: c => s.has(c),
                toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; on ? s.add(c) : s.delete(c); return on; }};
    }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    closest(sel) {
        const list = sel.split(',').map(s => s.trim().replace(/^\./, ''));
        for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (list.some(c => n.cls.has(c))) return n;
        return null;
    }
    getClientRects() { return this.rendered ? [this.getBoundingClientRect()] : []; }
    getBoundingClientRect() {
        let r = this.rect;
        if (!r && this.style.position === 'fixed') {
            r = {left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: parseFloat(this.style.width), height: parseFloat(this.style.height)};
        }
        r = r || {left: 0, top: 0, width: 0, height: 0};
        return {left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height};
    }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { const a = this.listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    /* A click bubbling from the node to the root; stopPropagation breaks the path. */
    dispatch(type) {
        const ev = {type, target: this, which: 1, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {}};
        for (let n = this; n && !ev.stopped; n = n.parentNode) (n.listeners[type] || []).slice().forEach(fn => fn.call(n, ev));
        return ev;
    }
    all() { return this.children.flatMap(c => [c, ...c.all()]); }
    /* Only '.class' - that is how the bridge looks for the DataView list. */
    querySelector(sel) { const c = String(sel).replace(/^\./, ''); return this.all().find(n => n.cls.has(c)) || null; }
}

/* The stock jQuery on a node: on/trigger, classes, the position css (left/top are numbers, as Menu.alignPosition
   writes them; reading is a string with px). */
function jq(el) {
    if (!el) return null;
    if (el.__jq) return el.__jq;
    const handlers = {}, $ = {0: el, length: 1, log: []};
    $.on = (n, fn) => { (handlers[n] = handlers[n] || []).push(fn); return $; };
    $.trigger = n => { $.log.push(n + (el.cls.has('over') ? ' (over)' : '')); (handlers[n] || []).slice().forEach(fn => fn({type: n, target: el, currentTarget: el})); return $; };
    $.addClass = c => { el.classList.add(c); return $; };
    $.removeClass = c => { el.classList.remove(c); return $; };
    $.hasClass = c => el.classList.contains(c);
    $.css = (k, v) => {
        el.pos = el.pos || {};
        if (typeof k === 'object') { Object.assign(el.pos, k); return $; }
        if (v === undefined) return el.pos[k] === undefined ? 'auto' : el.pos[k] + 'px';
        el.pos[k] = v;
        return $;
    };
    el.__jq = $;
    return $;
}

/* The fake stock window: height 900, the stock docH is the window - 10 (Menu.alignPosition,
   DataView.alignPosition: Common.Utils.innerHeight() - 10). */
const INNER_H = 900, DOC_H = INNER_H - 10;

/* The standard gallery menu: ul.dropdown-menu (position: fixed) in a holder - the btn-group of the button
   or the li.dropdown-submenu of the item. The show is as in the stock: 'show.bs.dropdown' on the holder →
   show:before and alignPosition, the open class, 'shown.bs.dropdown' → show:after. hide() is
   Menu.hide: open is removed (hide:after), for a submenu - over. alignPosition is like
   Menu.alignPosition: the place by menuAlignEl, menuAlign and offset (css top - without the menu margin-top
   field, the drawn top - with it); at the right window edge - clamping; vertically for a menu
   without restoreHeight - the bottom is clamped to docH and the top is not above 0, for a menu with restoreHeight (set
   by the gallery DataView) - without clamping; then options.additionalAlign(menuRoot, left, top)
   or css. The height is h, for a menu with a DataView - its fields and the visible part of the list (dataView below).
   The menu is drawn while expanded: the gallery target class (compact-shell.less: display: block) or
   the holder open / over. */
function galleryMenu(doc, host, opt = {}) {
    const ul = host.appendChild(new GEl(doc, 'ul'));
    ul.className = 'dropdown-menu';
    const $host = jq(host), $ul = jq(ul);
    const m = events({rendered: opt.rendered !== false, menuRoot: [ul], parentEl: $host, menuAlign: opt.align || 'tl-bl',
                      menuAlignEl: opt.alignEl || null, offset: (opt.offset || [0, 0]).slice(), calls: [], atShow: null,
                      items: opt.items || [], options: {restoreHeight: opt.restoreHeight}, w: opt.w || 300, h: opt.h || 200});
    m.ul = ul;
    m.height = () => (m.dv ? m.dv.pads + m.dv.inner.clientHeight : m.h);
    ul.getClientRects = () => (ul.cls.has('vo-gallery-target') || host.cls.has('open') || host.cls.has('over')) ? [ul.getBoundingClientRect()] : [];
    ul.getBoundingClientRect = () => {
        const p = ul.pos || {}, left = p.left || 0, top = (p.top || 0) + (opt.margin || 0), h = m.height();
        return {left, top, width: m.w, height: h, right: left + m.w, bottom: top + h};
    };
    m.alignPosition = function () {
        const a = this.menuAlignEl && this.menuAlignEl[0];
        this.calls.push('align');
        if (!a) return;
        const h = this.height();
        const r = a.getBoundingClientRect(), mm = /^([a-z]+)-([a-z]+)/.exec(this.menuAlign);
        const pm = {tl: [0, 0], bl: [0, h], tr: [this.w, 0], br: [this.w, h]}[mm[1]];
        const pp = {tl: [0, 0], tr: [r.width, 0], bl: [0, r.height], br: [r.width, r.height]}[mm[2]];
        let left = r.left - pm[0] + pp[0] + this.offset[0];
        let top = r.top - pm[1] + pp[1] + this.offset[1];
        if (left + this.w > INNER_W - 10) left = INNER_W - 10 - this.w;
        if (left < 0) left = 0;
        if (!this.options.restoreHeight) {
            if (top + h > DOC_H) top = DOC_H - h;
            if (top < 0) top = 0;
        }
        if (this.options.additionalAlign) this.options.additionalAlign.call(this, $ul, left, top);
        else $ul.css({left, top});
    };
    $host.on('show.bs.dropdown', () => { m.calls.push('show:before'); m.trigger('show:before', m); m.alignPosition(); });
    $host.on('shown.bs.dropdown', () => { m.calls.push('show:after'); m.trigger('show:after', m); });
    m.show = function () {
        this.calls.push('show');
        this.atShow = this.menuAlignEl && this.menuAlignEl[0];
        $host.trigger('show.bs.dropdown');
        host.classList.add('open');
        $host.trigger('shown.bs.dropdown');
    };
    m.hide = function () {
        this.calls.push('hide');
        if (host.classList.contains('open')) { host.classList.remove('open'); this.trigger('hide:after', this); }
        else if (host.classList.contains('over')) host.classList.remove('over');
    };
    m.items.forEach(i => i.on('click', (it, e) => m.onItemClick(it, e)));
    m.onItemClick = STOCK.menuItemClick;
    return m;
}

/* The gallery DataView (as in the stock): the .inner list in the el wrapper, the menu is switched to
   restoreHeight: true. On show:after - DataView.alignPosition: from the menu css top, a list whose bottom is
   below docH is squeezed (max-height = docH − top − fields), and with room it is returned up to the cap
   restoreHeight (a DataView without a cap, restoreHeight 0, never returns, and the menu
   stays without restoreHeight and is clamped by the stock). cmpEl is the former node outside the document (as in a redrawn DataView of the cell
   styles combo in the editor): the list node is taken by el, as the DataView itself does ($(this.el).find('.inner')). */
function dataView(doc, m, {content, cap, pads = 20}) {
    const wrap = m.ul.appendChild(new GEl(doc, 'div'));
    wrap.className = 'menu-picker-container';
    const inner = wrap.appendChild(new GEl(doc, 'div'));
    inner.className = 'dataview inner';
    Object.defineProperty(inner, 'scrollHeight', {get: () => content});
    Object.defineProperty(inner, 'clientHeight', {get: () => {
        const max = parseFloat(inner.style.maxHeight);
        return Math.min(content, max > 0 ? max : Infinity);
    }});
    const stale = new GEl(doc, 'div');
    stale.className = 'dataview inner';
    const dv = {parentMenu: m, options: {restoreHeight: cap}, el: wrap, $el: [wrap], cmpEl: [stale], inner, pads, updates: 0};
    dv.scroller = {update() { dv.updates++; }};
    dv.alignPosition = function () {
        const top = parseInt(jq(m.ul).css('top'), 10), menuH = m.height(), innerH = inner.clientHeight;
        if (top + menuH > DOC_H) inner.style.maxHeight = (DOC_H - top - pads) + 'px';
        else if (top + menuH < DOC_H && innerH < cap) inner.style.maxHeight = Math.min(DOC_H - top - pads, cap) + 'px';
    };
    m.options.restoreHeight = cap > 0;
    m.dv = dv;
    m.on('show:after', () => dv.alignPosition());
    return dv;
}

/* The ribbon: #toolbar (drawn) → [#vo-shell, section.toolbar (hidden by style) → panels →
   groups → the btn-group of the buttons "Chart", "Conditional formatting" (the submenu
   "Data bars" in li.dropdown-submenu), "Shape" (the menu is not drawn), the styles combo]. */
function makeGalleryEnv(opt = {}) {
    const log = [];
    const doc = {};
    doc.createElement = tag => new GEl(doc, tag);
    doc.body = new GEl(doc, 'body');
    doc.body.rendered = true;
    const el = (parent, tag, cls) => { const n = parent.appendChild(new GEl(doc, tag)); if (cls) n.className = cls; return n; };
    const toolbarEl = el(doc.body, 'div');
    toolbarEl.id = 'toolbar'; toolbarEl.rendered = true;
    const shellEl = el(toolbarEl, 'div', 'vo-mn');
    shellEl.id = 'vo-shell'; shellEl.rendered = true;
    const ribbon = el(toolbarEl, 'section', 'toolbar');
    const panels = el(ribbon, 'section', 'box-panels');
    const home = el(panels, 'section', 'panel active');
    const ins = el(panels, 'section', 'panel');
    const slot = (panel, id) => { const g = el(panel, 'div', 'group'); const s = el(g, 'span', 'btn-slot'); const h = el(s, 'div', 'btn-group'); h.id = id; return h; };

    /* "Chart": a gallery (DataView) - a click on an element goes to the standard handler. */
    const chartHost = slot(ins, 'tlbtn-insertchart');
    const chart = galleryMenu(doc, chartHost, {rendered: opt.chartRendered !== false, margin: 2, w: opt.chartW || 364, h: 560});
    const chartItem = el(chart.ul, 'div', 'item');
    chartItem.addEventListener('click', () => log.push('stock: chart bar'));
    const rail = el(chart.ul, 'div', 'ps-scrollbar-y-rail');

    /* "Conditional formatting": a menu with items; "Data bars" is a gallery submenu. */
    const cfHost = slot(home, 'id-toolbar-btn-condformat');
    const cfMenu = galleryMenu(doc, cfHost, {w: 220, h: 400});
    const barsItem = item('Data bars');
    const barsLi = el(cfMenu.ul, 'li', 'dropdown-submenu');
    barsItem.cmpEl = [barsLi];
    const bars = galleryMenu(doc, barsLi, {align: 'tl-tr', margin: -6, w: 210, h: 78});
    barsItem.menu = bars;
    const bar = el(bars.ul, 'div', 'item');
    bar.addEventListener('click', () => log.push('stock: data bar'));
    const palette = el(bars.ul, 'div', 'palette-color');
    palette.addEventListener('click', e => { log.push('stock: palette'); e.stopPropagation(); });
    const manage = item('Manage rules', {value: 'manage'});
    /* "Icon sets": a gallery submenu on a DataView without a cap (restoreHeight 0) - the stock keeps
       it in a local variable: it is neither in the inner menus nor in the fields. */
    const iconsItem = item('Icon sets');
    const iconsLi = el(cfMenu.ul, 'li', 'dropdown-submenu');
    iconsItem.cmpEl = [iconsLi];
    const icons = galleryMenu(doc, iconsLi, {align: 'tl-tr', margin: -6, w: 242});
    dataView(doc, icons, {content: 395, cap: 0, pads: 15});
    iconsItem.menu = icons;
    cfMenu.items.push(item('Value is'), barsItem, manage, iconsItem);
    cfMenu.items.forEach(i => i.on('click', (it, e) => cfMenu.onItemClick(it, e)));
    cfMenu.on('item:click', (m, it) => log.push('cond ' + it.value));

    /* "Shape": the menu exists but is not drawn - nothing to show. With opt.shape - drawn:
       a gallery on a DataView with a cap ({content, cap, pads}) in the inner menu (setInnerMenu),
       as in the stock. */
    const shapeHost = slot(ins, 'tlbtn-insertshape');
    const shape = galleryMenu(doc, shapeHost, {rendered: !!opt.shape, w: 362});
    if (opt.shape) shape.options.innerMenus = [{menu: dataView(doc, shape, opt.shape), index: 0}];
    /* "Format as table": the templates DataView (cap 300) is not in the inner menus but
       in a ribbon field (toolbar.mnuTableTemplatePicker), as in the stock. */
    const tableHost = slot(home, 'tlbtn-tabletemplate');
    const table = galleryMenu(doc, tableHost, {w: 495});
    const tablePicker = dataView(doc, table, opt.table || {content: 530, cap: 300, pads: 10});

    /* The cell styles combo (ComboDataView): the gallery is the expand button menu; the standard
       beforeOpenHandler on show:before sets its own alignment (menuAlignEl is the combo field). */
    const stylesHost = slot(home, 'asc-gen371');
    const styles = galleryMenu(doc, stylesHost, {w: 645, h: 306});
    const comboEl = el(home, 'div', 'combo-dataview');
    styles.on('show:before', m => { m.menuAlignEl = jq(comboEl); m.menuAlign = 'tl-tl'; m.offset = [-5, 0]; });
    const listStyles = {openButton: {menu: styles}, disabled: false, isDisabled() { return this.disabled; }};

    const recommend = button();
    recommend.on('click', () => log.push('chart dialog'));
    const toolbar = {
        btnInsertChart: button({menu: chart}), btnInsertChartRecommend: recommend, btnCondFormat: button({menu: cfMenu}),
        btnInsertShape: button({menu: shape}), listStyles, btnTableTemplate: button({menu: table}), mnuTableTemplatePicker: tablePicker
    };
    const observers = [];
    class Obs {
        constructor(cb) { this.cb = cb; observers.push(this); }
        observe(n, o) { this.el = n; this.opts = o; this.on = true; }
        disconnect() { this.on = false; }
        fire() { if (this.on) this.cb([]); }
    }
    const context = {
        SSE: {Views: {}, getController(name) { return name === 'Toolbar' ? {toolbar} : undefined; }},
        MutationObserver: Obs, document: doc, innerWidth: INNER_W, innerHeight: INNER_H,
        console: {warn() {}, log() {}, error() {}}, setTimeout: () => 0, clearTimeout() {}
    };
    context.window = context;
    context.$ = context.jQuery = jq;
    context.define = (deps, factory) => factory();
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(opt.file || FILE, 'utf8'), context, {filename: FILE});
    /* Our control is a menu row at the left edge: the gallery anchor. */
    const anchorEl = el(shellEl, 'button', 'vo-mn-sub');
    anchorEl.rendered = true;
    anchorEl.rect = opt.anchorRect || {left: 100, top: 200, width: 180, height: 32};
    const ribbonNodes = () => ribbon.all().map(n => [n, n.parentNode, n.parentNode.children.indexOf(n)]);
    return {B: context.SSE.Views.StockBridge, log, doc, toolbar, toolbarEl, shellEl, ribbon, chart, chartHost, chartItem, rail,
            cfMenu, cfHost, bars, barsLi, bar, palette, icons, shape, table, styles, comboEl, anchorEl, observers, recommend, manage, ribbonNodes,
            ctx: context};
}

const revealed = env => [env.ribbon, ...env.ribbon.all()].filter(n => n.cls.has('vo-gallery-path')).map(n => n.className.split(' ')[0] || n.tagName);
const anchors = env => env.doc.body.children.filter(n => n.cls.has('vo-gallery-anchor'));

test('gallery_opens_stock_popup_without_moving_ribbon', () => {
    const env = makeGalleryEnv(), B = env.B;
    const before = env.ribbonNodes();
    const stockAlign = jq(env.comboEl);
    env.chart.menuAlignEl = stockAlign;
    const closed = [];
    assert.equal(B.popupOpen(), false);
    assert.equal(B.popup('Toolbar:btnInsertChart', env.anchorEl, {align: 'tl-tr', padY: 10, onClose: how => closed.push(how)}), true);
    /* The show is standard: Menu.show() once; the alignment is already by our anchor. */
    assert.deepEqual(env.chart.calls.filter(c => c === 'show'), ['show'], 'the stock show path, once');
    const a = anchors(env);
    assert.equal(a.length, 1, 'one invisible anchor in the document');
    assert.equal(env.chart.atShow, a[0], 'menuAlignEl at show time is our anchor');
    assert.deepEqual([a[0].style.position, a[0].style.left, a[0].style.top, a[0].style.width, a[0].style.height],
        ['fixed', '100px', '200px', '180px', '32px'], 'anchor sits on our control');
    assert.equal(env.chart.menuAlignEl[0], a[0]);
    assert.equal(env.chart.menuAlign, 'tl-tr');
    /* The place: to the right of the row, the top is padY above the row (the stock fields are aligned). */
    const r = env.chart.ul.getBoundingClientRect();
    assert.deepEqual([r.left, r.top], [278, 190], 'gallery to the right of our row (2 px over it, as our submenus), top at row top - padY');
    /* The ribbon: the path from the menu to the drawn ancestor is expanded by classes, the nodes are not touched. */
    assert.deepEqual(revealed(env), ['toolbar', 'box-panels', 'panel', 'group', 'btn-slot', 'btn-group'], 'hidden path is revealed up to #toolbar');
    assert.ok(env.ribbon.cls.has('vo-gallery-root'), 'outermost hidden node is the root');
    assert.ok(!env.toolbarEl.cls.has('vo-gallery-path') && !env.doc.body.cls.has('vo-gallery-path'), 'rendered ancestors are not marked');
    assert.ok(env.chart.ul.cls.has('vo-gallery-target'));
    assert.ok(env.doc.body.cls.has('vo-gallery'));
    const now = env.ribbonNodes();
    assert.ok(before.every(([n, p, i], k) => now[k][0] === n && now[k][1] === p && now[k][2] === i), 'ribbon nodes keep their parents and order');
    assert.equal(B.popupOpen(), true);
    assert.equal(B.popupOwns(env.chartItem), true, 'gallery content is ours while shown');
    assert.equal(B.popupOwns(env.anchorEl), false);
    /* Hovering inside the gallery does not reach the hidden ribbon button (its standard hint). */
    let hostHover = 0;
    env.chartHost.addEventListener('mouseover', () => hostHover++);
    env.chartItem.dispatch('mouseover');
    assert.equal(hostHover, 0, 'hover inside the gallery reached the hidden ribbon button');
    /* Closing: Menu.hide, the stock alignment returned, no traces. */
    assert.equal(B.closePopup(), true);
    assert.deepEqual(env.chart.calls.filter(c => c === 'hide'), ['hide']);
    assert.equal(env.chart.menuAlignEl, stockAlign, 'stock menuAlignEl restored');
    assert.equal(env.chart.menuAlign, 'tl-bl', 'stock menuAlign restored');
    assert.deepEqual(plain(env.chart.offset), [0, 0], 'stock offset restored');
    assert.deepEqual(revealed(env), [], 'no reveal classes left');
    assert.ok(!env.ribbon.cls.has('vo-gallery-root') && !env.chart.ul.cls.has('vo-gallery-target') && !env.doc.body.cls.has('vo-gallery'));
    assert.equal(anchors(env).length, 0, 'anchor removed');
    assert.deepEqual(closed, ['close']);
    assert.equal(B.popupOpen(), false);
    assert.equal(B.closePopup(), false, 'nothing to close');
    env.chartItem.dispatch('mouseover');
    assert.equal(hostHover, 1, 'hover listener removed on close');
    const after = env.ribbonNodes();
    assert.ok(before.every(([n, p, i], k) => after[k][0] === n && after[k][1] === p && after[k][2] === i), 'ribbon nodes unmoved after close');

    /* An item submenu: the stock show path on hover (MenuItem._doHover) - 'show.bs.dropdown',
       the over class, 'shown.bs.dropdown' on li. */
    assert.equal(B.popup('Toolbar:btnCondFormat.menu.items.1', env.anchorEl, {align: 'tl-tr', padY: 10}), true);
    assert.deepEqual(plain(jq(env.barsLi).log), ['show.bs.dropdown', 'shown.bs.dropdown (over)'], 'stock submenu show sequence');
    assert.deepEqual(env.bars.calls.filter(c => c === 'show'), [], 'a submenu is not shown as a button menu');
    assert.deepEqual(revealed(env), ['toolbar', 'box-panels', 'panel', 'group', 'btn-slot', 'btn-group', 'dropdown-menu', 'dropdown-submenu'],
        'the parent menu and the li are on the revealed path');
    assert.deepEqual([env.bars.ul.getBoundingClientRect().left, env.bars.ul.getBoundingClientRect().top], [278, 190], 'stock margins absorbed');
    /* The stock removed the submenu itself (the mouse left, a choice with closing) - the bridge cleans up after itself. */
    env.barsLi.classList.remove('over');
    env.observers.forEach(o => o.fire());
    assert.equal(B.popupOpen(), false, 'stock-side hide closes the popup');
    assert.deepEqual(revealed(env), []);

    /* A new show replaces the previous one; at the window edge the gallery goes to the left of the row. */
    const right = makeGalleryEnv({anchorRect: {left: 1300, top: 200, width: 120, height: 32}});
    const why = [];
    right.B.popup('Toolbar:btnCondFormat.menu.items.1', right.anchorEl, {padY: 10, onClose: h => why.push(h)});
    assert.equal(right.B.popup('Toolbar:btnInsertChart', right.anchorEl, {padY: 10}), true);
    assert.deepEqual(why, ['replace'], 'previous popup closed');
    assert.equal(right.chart.menuAlign, 'tr-tl', 'flipped to the left of the anchor');
    assert.equal(right.chart.ul.getBoundingClientRect().left, 1300 - 364 + 2, 'gallery ends at the row (2 px over it)');
    right.B.closePopup();

    /* Low at the window edge the gallery rises into the window bounds (like our submenus). */
    const low = makeGalleryEnv({anchorRect: {left: 100, top: 800, width: 180, height: 32}});
    low.B.popup('Toolbar:btnInsertChart', low.anchorEl, {padY: 10});
    assert.equal(low.chart.ul.getBoundingClientRect().bottom, 900 - 4, 'gallery bottom within the window');
    low.B.closePopup();
    /* The styles combo: the gallery is the expand button menu; the stock own alignment on show:before
       is overridden by our anchor. */
    assert.equal(B.popup('Toolbar:listStyles', env.anchorEl, {padY: 10}), true);
    assert.equal(env.styles.menuAlignEl[0], anchors(env)[0], 're-aimed after the stock show:before handler');
    assert.equal(env.styles.ul.getBoundingClientRect().top, 190);
    B.closePopup();
    assert.equal(env.styles.menuAlignEl, null, 'restored');

    /* A disabled double - nothing is shown. */
    env.toolbar.btnInsertChart.setDisabled(true);
    assert.equal(B.popup('Toolbar:btnInsertChart', env.anchorEl), false);
    assert.equal(anchors(env).length, 0);
    assert.deepEqual(revealed(env), []);
});

test('gallery_pick_through_stock', () => {
    const env = makeGalleryEnv(), B = env.B;
    const closed = [];
    B.popup('Toolbar:btnCondFormat.menu.items.1', env.anchorEl, {padY: 10, onClose: h => closed.push(h)});
    env.bar.dispatch('click');
    assert.deepEqual(env.log, ['stock: data bar'], 'the stock gallery handler, once');
    assert.deepEqual(closed, ['pick'], 'a pick that reached the gallery closes it');
    assert.equal(env.barsLi.cls.has('over'), false, 'stock submenu hidden');
    assert.equal(B.popupOpen(), false);
    /* An item with stopPropagation (the stock border color palette) does not close the menu - and neither do we. */
    env.log.length = 0;
    B.popup('Toolbar:btnCondFormat.menu.items.1', env.anchorEl, {padY: 10, onClose: h => closed.push(h)});
    env.palette.dispatch('click');
    assert.deepEqual(env.log, ['stock: palette']);
    assert.equal(B.popupOpen(), true, 'stays open as the stock menu does');
    B.closePopup();
    /* The button menu: the choice is the standard handler, the gallery is closed by the standard hide. */
    env.log.length = 0;
    closed.length = 0;
    B.popup('Toolbar:btnInsertChart', env.anchorEl, {padY: 10, onClose: h => closed.push(h)});
    env.rail.dispatch('click');
    assert.equal(B.popupOpen(), true, 'a click on the scroll rail is not a pick');
    env.chartItem.dispatch('click');
    assert.deepEqual(env.log, ['stock: chart bar']);
    assert.deepEqual(closed, ['pick']);
    assert.equal(env.chartHost.cls.has('open'), false, 'stock menu hidden');
    assert.deepEqual(env.chart.calls.filter(c => c === 'hide'), ['hide']);
    /* The stock selection handler hides the menu itself (as with equations): the click no longer
       reaches the menu, but the press was inside the gallery - this is a choice. */
    env.log.length = 0;
    closed.length = 0;
    const hider = env.chart.ul.appendChild(new GEl(env.doc, 'div'));
    hider.className = 'item';
    hider.addEventListener('click', e => {
        env.log.push('stock: equation');
        env.chartHost.classList.remove('open');
        env.observers.forEach(o => o.fire());
    });
    B.popup('Toolbar:btnInsertChart', env.anchorEl, {padY: 10, onClose: h => closed.push(h)});
    hider.dispatch('mousedown');
    hider.dispatch('click');
    assert.deepEqual(env.log, ['stock: equation']);
    assert.deepEqual(closed, ['pick'], 'stock hid its gallery after a press inside — a pick');
    /* The stock hid the gallery without a press in it - it is just hidden. */
    closed.length = 0;
    B.popup('Toolbar:btnInsertChart', env.anchorEl, {padY: 10, onClose: h => closed.push(h)});
    env.chartHost.classList.remove('open');
    env.observers.forEach(o => o.fire());
    assert.deepEqual(closed, ['hide']);
});

/* Closing the gallery on a choice in it (a click that reached the menu) and
   on being hidden by the stock (MutationObserver) calls the shell onClose - closeSurfaces - from a stock node
   listener. The bridge listeners are under the shell protection (CompactShell.guarded, as in FormulaBar.guard):
   a throw in onClose does not go outside (in the browser - an uncaught error without a shell
   warning), but is reduced to one warning; after a start failure - silence. The protection is by the
   shell contract: guarded(label, fn), startupFailed. */
test('gallery_close_is_guarded', () => {
    const env = makeGalleryEnv(), B = env.B;
    const warned = [];
    const shell = {startupFailed: false, guarded(label, fn) {
        return function () {
            if (shell.startupFailed) return undefined;
            try { return fn.apply(this, arguments); } catch (e) { warned.push(label + ': ' + e.message); return undefined; }
        };
    }};
    env.ctx.SSE.Views.CompactShell = shell;
    let calls = 0;
    const boom = how => { calls++; throw new Error('closeSurfaces failed on ' + how); };
    /* A choice in a submenu gallery is a click that reached the menu. */
    B.popup('Toolbar:btnCondFormat.menu.items.1', env.anchorEl, {padY: 10, onClose: boom});
    assert.doesNotThrow(() => env.bar.dispatch('click'), 'a failure in onClose escaped the click listener of the stock gallery');
    assert.deepEqual([calls, B.popupOpen()], [1, false], 'the pick closed the gallery and called onClose once');
    assert.equal(warned.length, 1, 'the failure was not reported once: ' + JSON.stringify(warned));
    /* The stock hid the button gallery itself - the bridge observer. */
    B.popup('Toolbar:btnInsertChart', env.anchorEl, {padY: 10, onClose: boom});
    env.chartHost.classList.remove('open');
    assert.doesNotThrow(() => env.observers.forEach(o => o.fire()), 'a failure in onClose escaped the mutation observer');
    assert.deepEqual([calls, B.popupOpen()], [2, false], 'the stock hide closed the gallery and called onClose once');
    assert.equal(warned.length, 2, 'the observer failure was not reported: ' + JSON.stringify(warned));
    /* After a start failure the shell is silent: the listener does nothing, onClose is not called. */
    const quiet = [];
    B.popup('Toolbar:btnCondFormat.menu.items.1', env.anchorEl, {padY: 10, onClose: h => quiet.push(h)});
    shell.startupFailed = true;
    assert.doesNotThrow(() => env.bar.dispatch('click'));
    assert.deepEqual([quiet, warned.length], [[], 2], 'the shell spoke after its start failure');
    shell.startupFailed = false;
    B.closePopup();
    assert.deepEqual(quiet, ['close']);
    /* Without the shell (the bridge on its own) the path is as before: a choice closes the gallery. */
    delete env.ctx.SSE.Views.CompactShell;
    const closed = [];
    B.popup('Toolbar:btnCondFormat.menu.items.1', env.anchorEl, {padY: 10, onClose: h => closed.push(h)});
    env.bar.dispatch('click');
    assert.deepEqual(closed, ['pick'], 'without the shell a pick still closes the gallery');
});

/* The cell styles combo (ComboDataView) measures itself with the standard checkSize
   for another 5 s by a timer after window:resize / uitheme:changed / tab:active and on a size change
   hides the menu (onResize → openButton.menu.hide()). In the hidden ribbon the combo is not measured: the first
   measurement in the expanded path closed the shown gallery (in the editor: "Cell styles ▸" did not open after a theme
   change). The bridge measures the combo with its own checkSize before showing - the stock timer
   no longer closes the gallery. */
test('combo_gallery_survives_stock_size_check', () => {
    const env = makeGalleryEnv(), B = env.B;
    const host = env.styles.parentEl[0], order = [];
    const ls = env.toolbar.listStyles;
    /* Like ComboDataView.checkSize: an invisible combo is not measured; the size changed - onResize. */
    Object.assign(ls, {
        rootWidth: 0,
        checkSize() {
            order.push('checkSize');
            if (!host.cls.has('vo-gallery-path')) return;
            const width = 660;
            if (this.rootWidth !== width) { this.rootWidth = width; this.onResize(); }
        },
        onResize() { order.push('onResize'); this.openButton.menu.hide(); }
    });
    const show0 = env.styles.show;
    env.styles.show = function () { order.push('show'); return show0.apply(this, arguments); };
    const closed = [];
    assert.equal(B.popup('Toolbar:listStyles', env.anchorEl, {padY: 10, onClose: h => closed.push(h)}), true);
    assert.ok(order.indexOf('checkSize') >= 0 && order.indexOf('checkSize') < order.indexOf('show'),
        'the combo measures itself before the gallery is shown: ' + order.join(','));
    /* A stock timer tick while the gallery is shown. */
    ls.checkSize();
    env.observers.forEach(o => o.fire());
    assert.equal(host.cls.has('open'), true, 'the stock size check closed the shown gallery');
    assert.equal(B.popupOpen(), true);
    assert.deepEqual(closed, []);
    B.closePopup();
    /* A double without checkSize (a button menu) - the show is as before. */
    assert.equal(B.popup('Toolbar:btnInsertChart', env.anchorEl, {padY: 10}), true);
    B.closePopup();
});

/* A gallery pressed to the window bottom - the bottom is exactly at window − 4, like our submenus (placeFly),
   and not where the stock presses it: Menu.alignPosition for a menu
   without a height cap puts the bottom at docH = window − 10, for a submenu also with its own field (−6) -
   in the editor the bottom of "Equations" and "Border style" was at 8 and 16 px from the edge. The offset of this
   pressing is not removed: the stock presses the already shifted menu. The place holds even on a repeated
   alignment by the stock (hovering a submenu: MenuItem mouseenter → alignPosition), after
   closing - standard again. */
test('gallery_presses_to_window_edge_like_our_submenus', () => {
    /* A button menu (field 2), a row at the window bottom: the stock would press the bottom to 892. */
    const low = makeGalleryEnv({anchorRect: {left: 100, top: 800, width: 180, height: 32}});
    assert.equal(low.B.popup('Toolbar:btnInsertChart', low.anchorEl, {padY: 10}), true);
    let r = low.chart.ul.getBoundingClientRect();
    assert.deepEqual([r.bottom, r.height], [INNER_H - 4, 560], 'button gallery pressed to the window edge - 4, height kept');
    assert.equal(r.left, 278, 'beside the row as before');
    low.B.closePopup();
    assert.equal(low.chart.options.additionalAlign, undefined, 'stock alignment hook restored');
    low.chart.menuAlignEl = jq(low.anchorEl);
    low.chart.alignPosition();
    assert.equal(low.chart.ul.getBoundingClientRect().bottom, DOC_H + 2, 'after close the stock places the menu itself again');

    /* A gallery submenu (field −6), a row at the window bottom: the stock would press the bottom to 884. */
    const sub = makeGalleryEnv({anchorRect: {left: 100, top: 850, width: 180, height: 32}});
    const closed = [];
    assert.equal(sub.B.popup('Toolbar:btnCondFormat.menu.items.1', sub.anchorEl, {padY: 10, onClose: h => closed.push(h)}), true);
    r = sub.bars.ul.getBoundingClientRect();
    assert.equal(r.bottom, INNER_H - 4, 'submenu gallery pressed to the window edge - 4, not to the stock margin');
    /* Hovering a submenu: the stock aligns it again (MenuItem: mouseenter → alignPosition). */
    sub.bars.alignPosition();
    assert.equal(sub.bars.ul.getBoundingClientRect().bottom, INNER_H - 4, 'stock re-alignment on hover keeps our place');
    /* A high row - the gallery is padY above the row, as before. */
    const high = makeGalleryEnv({anchorRect: {left: 100, top: 300, width: 180, height: 32}});
    high.B.popup('Toolbar:btnCondFormat.menu.items.1', high.anchorEl, {padY: 10});
    assert.equal(high.bars.ul.getBoundingClientRect().top, 290, 'room below — the top stays at row top - padY');
    high.B.closePopup();
    sub.B.closePopup();
    assert.deepEqual(closed, ['close']);
    assert.equal(sub.bars.options.additionalAlign, undefined);
});

/* A gallery with a height cap (a DataView with restoreHeight, "Insert → Shape ▸") at the window
   bottom. The stock squeezes it in place (DataView.alignPosition: the list up to docH from the top at the row) and does not
   raise it - "Shape ▸" at 1280×800 scrolled inside with free space above. Like our
   submenus (placeFly): first raise (the top - up to 4 from the window edge) and return the height -
   up to the content, but not above the stock cap; squeeze - only if it does not fit anyway (the bottom is window − 4).
   The list scrollbar is the standard update. The DataView cap is found by the bridge where the
   stock holds it: the inner menu (shape) and the ribbon field (table templates); the list node - by el. */
test('gallery_with_height_ceiling_lifts_before_shrinking', () => {
    /* "Shape": 651 of content under the cap 652, fields 20; the row at 439. */
    const env = makeGalleryEnv({shape: {content: 651, cap: 652, pads: 20}, anchorRect: {left: 100, top: 439, width: 180, height: 32}});
    const dv = env.shape.dv;
    assert.equal(env.B.popup('Toolbar:btnInsertShape', env.anchorEl, {padY: 10}), true);
    let r = env.shape.ul.getBoundingClientRect();
    assert.equal(dv.inner.clientHeight, 651, 'the whole list is shown (no inner scroll): max-height ' + dv.inner.style.maxHeight);
    assert.deepEqual([r.top, r.bottom, r.height], [INNER_H - 4 - 671, INNER_H - 4, 671], 'lifted to fit whole, bottom at the window edge - 4');
    assert.ok(dv.updates >= 1, 'the stock scroller was not updated after the height came back');
    env.B.closePopup();

    /* Table templates: 530 of content under the cap 300 - the height returns up to the cap, not up to
       the content; the DataView is only in the ribbon field. */
    const t = makeGalleryEnv({anchorRect: {left: 100, top: 600, width: 180, height: 32}});
    const tv = t.table.dv;
    assert.equal(t.B.popup('Toolbar:btnTableTemplate', t.anchorEl, {padY: 10}), true);
    r = t.table.ul.getBoundingClientRect();
    assert.equal(tv.inner.clientHeight, 300, 'table templates back to the stock ceiling 300 (max-height ' + tv.inner.style.maxHeight + ')');
    assert.equal(tv.inner.style.maxHeight, '300px', 'not past the stock ceiling');
    assert.deepEqual([r.bottom, r.height], [INNER_H - 4, 310], 'lifted, bottom at the window edge - 4');
    t.B.closePopup();

    /* There is no room above either: the top is 4, the bottom is window − 4, the list is squeezed exactly that much. */
    const tall = makeGalleryEnv({shape: {content: 951, cap: 2000, pads: 20}, anchorRect: {left: 100, top: 439, width: 180, height: 32}});
    assert.equal(tall.B.popup('Toolbar:btnInsertShape', tall.anchorEl, {padY: 10}), true);
    r = tall.shape.ul.getBoundingClientRect();
    assert.deepEqual([r.top, r.bottom], [4, INNER_H - 4], 'too tall even when lifted: from 4 to the window edge - 4');
    assert.equal(tall.shape.dv.inner.style.maxHeight, (INNER_H - 8 - 20) + 'px', 'shrunk only by what does not fit');
    tall.B.closePopup();

    /* "Icon sets": a DataView without a cap cannot be found by the bridge (a stock local variable), and
       it never returns the height itself. While the show lasts, the place is the stock's (the bottom is docH): its DataView
       on show:after measures the list from this place and does not squeeze it; the gallery goes to the window edge − 4
       only afterwards - whole. */
    const ic = makeGalleryEnv({anchorRect: {left: 100, top: 700, width: 180, height: 32}});
    assert.equal(ic.B.popup('Toolbar:btnCondFormat.menu.items.3', ic.anchorEl, {padY: 10}), true);
    r = ic.icons.ul.getBoundingClientRect();
    assert.equal(ic.icons.dv.inner.clientHeight, 395, 'icon sets shrunk by the stock under our early place: max-height ' + ic.icons.dv.inner.style.maxHeight);
    assert.deepEqual([r.bottom, r.height], [INNER_H - 4, 410], 'whole and pressed to the window edge - 4');
    ic.B.closePopup();

    /* It fits at the row - neither a raise nor a height correction. */
    const fits = makeGalleryEnv({shape: {content: 200, cap: 652, pads: 20}, anchorRect: {left: 100, top: 300, width: 180, height: 32}});
    fits.B.popup('Toolbar:btnInsertShape', fits.anchorEl, {padY: 10});
    r = fits.shape.ul.getBoundingClientRect();
    assert.deepEqual([r.top, r.height, fits.shape.dv.updates], [290, 220, 0], 'fits at the row: unchanged');
    fits.B.closePopup();
});

test('dialog_fallback_for_unshowable', () => {
    const env = makeGalleryEnv({chartRendered: false}), B = env.B;
    assert.equal(B.popup('Toolbar:btnInsertChart', env.anchorEl), false, 'menu not rendered — nothing to show');
    assert.equal(B.popup('Toolbar:btnInsertShape', env.anchorEl), false);
    assert.deepEqual(env.chart.calls, [], 'no stock show attempted');
    assert.equal(anchors(env).length, 0);
    assert.deepEqual(revealed(env), []);
    assert.equal(B.dialog('Toolbar:btnInsertChart'), true);
    assert.deepEqual(env.log, ['chart dialog'], 'the chart wizard through its stock button, once');
    env.log.length = 0;
    assert.equal(B.dialog('Toolbar:btnCondFormat.menu.items.1'), true);
    assert.deepEqual(env.log, ['cond manage'], 'conditional formatting galleries → the stock rules manager, once');
    env.log.length = 0;
    assert.equal(B.dialog('Toolbar:btnInsertShape'), false, 'no stock dialog for shapes');
    env.recommend.setDisabled(true);
    assert.equal(B.dialog('Toolbar:btnInsertChart'), false, 'disabled stock dialog command refuses');
    assert.equal(B.dialog(null), false);
    assert.deepEqual(env.log, []);
});

/* --- The bridge to the stock for the menu row and the toolbar ----------------------
   The bottom row (the Statusbar root: the sheet "+", zoom - "Insert → Sheet", "View → Zoom ▸"), the standard
   ribbon checkbox (Common.UI.CheckBox: "Gridlines", "Headings", "Zeros" - "View → Show ▸"; the real
   CheckBox.js methods), a standard menu item by value (pick by value and the item state - "Clear
   format") and the mirror exceptions (OMIT: the button list and the submenu of the same name show one and
   the same thing). A bridge without these capabilities fails these cases. */

test('statusbar_root', () => {
    const env = makeEnv(), B = env.B, sb = env.controllers.Statusbar.statusbar;
    assert.equal(B.twin('Statusbar:btnAddWorksheet'), sb.btnAddWorksheet, 'Statusbar → the view of the sheet tabs row');
    assert.equal(B.twin('Statusbar:btnZoomUp'), sb.btnZoomUp);
    assert.deepEqual(plain(B.state('Statusbar:btnZoomUp')), {exists: true, disabled: false, pressed: false, visible: true, causes: []});
    /* The stock disables the sheet "+" and zoom during a cell edit (controller/Statusbar.js onApiEditCell) - the state is read. */
    sb.btnAddWorksheet.setDisabled(true);
    assert.equal(B.state('Statusbar:btnAddWorksheet').disabled, true, 'the lock of the stock button is not read');
    assert.equal(B.run('Statusbar:btnAddWorksheet'), false, 'a locked button ran');
    assert.equal(B.run('Statusbar:btnZoomUp'), true);
    assert.deepEqual(env.log, ['zoom up'], 'one stock click');
    assert.equal(B.twin('Statusbar:btnNope'), null);
    env.state.throws = true;
    assert.equal(B.twin('Statusbar:btnZoomUp'), null, 'getController throws → null');
});

test('checkbox_pressed_and_command', () => {
    const env = makeEnv(), B = env.B, cb = env.gridlines;
    /* Pressed state is the checkbox isChecked(), not the button pressed: with a grid - yes. */
    assert.deepEqual(plain(B.state('ViewTab:chGridlines')), {exists: true, disabled: false, pressed: true, visible: true, causes: []},
        'the checkbox state is not read');
    /* The stock itself cleared the checkbox following the sheet (onApiSheetChanged: setValue(…, true) - without an event). */
    cb.setValue(false, true);
    assert.equal(B.state('ViewTab:chGridlines').pressed, false, 'the state does not follow the stock checkbox');
    assert.deepEqual(env.log, [], 'precondition: the stock sync has no change event');
    /* The bridge command is the checkbox click path: setValue(!checked) → 'change' → the tab handler. */
    assert.equal(B.run('ViewTab:chGridlines'), true, 'the bridge refuses a checkbox');
    assert.deepEqual(env.log, ['gridlines true'], 'one stock change with the new value');
    assert.equal(B.state('ViewTab:chGridlines').pressed, true);
    assert.equal(B.run('ViewTab:chGridlines'), true);
    assert.deepEqual(env.log, ['gridlines true', 'gridlines false']);
    assert.equal(cb.getValue(), 'unchecked', 'the stock value is not switched by the stock path');
    /* Undefined - as with a stock click: cleared (setValue(false)). */
    cb.setValue('indeterminate', true);
    assert.equal(B.state('ViewTab:chGridlines').pressed, false, 'an indeterminate checkbox is not pressed');
    env.log.length = 0;
    B.run('ViewTab:chGridlines');
    assert.deepEqual([cb.getValue(), plain(env.log)], ['unchecked', ['gridlines false']], 'indeterminate → unchecked with a change, as a stock click');
    env.log.length = 0;
    /* Disabled - a refusal without an event; not drawn - also (it would only remember the value). */
    cb.setDisabled(true);
    assert.equal(B.state('ViewTab:chGridlines').disabled, true);
    assert.equal(B.run('ViewTab:chGridlines'), false, 'a locked checkbox ran');
    cb.setDisabled(false);
    cb.rendered = false;
    assert.equal(B.run('ViewTab:chGridlines'), false, 'a checkbox that is not drawn ran');
    assert.deepEqual(env.log, [], 'no stock change on refusals');
});

/* "View → Show ▸": the names are standard: the command caption without its own caption in the
   shell is taken from the standard ribbon view phrase in the interface language: the standard localization puts it into SSE.Views.<view>, and it lies
   in the class prototype; for a reader, for whom the stock does not build controls, the phrase exists. No view or phrase - a fallback caption. */
test('phrase_from_stock_view', () => {
    const env = makeEnv(), B = env.B, V = env.context.SSE.Views;
    assert.equal(typeof B.phrase, 'function', 'StockBridge.phrase is missing');
    assert.equal(B.phrase('ViewTab', 'textZeros', 'Show zeros'), 'Show zeros', 'no stock view: the fallback');
    V.ViewTab = function () {};
    V.ViewTab.prototype.textZeros = 'Отображать нули';
    assert.equal(B.phrase('ViewTab', 'textZeros', 'Show zeros'), 'Отображать нули', 'the localized phrase of the stock view class');
    assert.equal(B.phrase('ViewTab', 'textNope', 'Fallback'), 'Fallback', 'no such phrase: the fallback');
    /* The class is not declared yet: the standard localization put the phrase into the namespace object itself. */
    V.Statusbar = {itemHidden: 'Скрытые'};
    assert.equal(B.phrase('Statusbar', 'itemHidden'), 'Скрытые');
    V.ViewTab.prototype.textEmpty = '';
    assert.equal(B.phrase('ViewTab', 'textEmpty'), '', 'an empty phrase without a fallback');
});

test('pick_by_value', () => {
    const env = makeEnv(), B = env.B;
    /* The value is a number, a string or a function: the Asc constants are read at call time. */
    assert.equal(B.locate('Toolbar:btnCondFormat', {value: 'manage'}), env.cond.items[7], 'by a value');
    let want = 'new';
    const sel = {value: () => want};
    assert.equal(B.locate('Toolbar:btnCondFormat', sel), env.cond.items[5], 'by a value read at the call');
    want = 'manage';
    assert.equal(B.locate('Toolbar:btnCondFormat', sel), env.cond.items[7], 'the value is cached');
    assert.equal(B.itemCaption('Toolbar:btnCondFormat', sel), 'Manage', 'the stock caption of the item');
    /* A hidden item, a submenu item, no value, no double - no item. */
    env.cond.items[6].value = 'hidden';
    assert.equal(B.locate('Toolbar:btnCondFormat', {value: 'hidden'}), null, 'a hidden stock item');
    assert.equal(B.locate('Toolbar:btnCondFormat', {value: 5}), null, 'only the menu of the twin, not its submenus');
    assert.equal(B.locate('Toolbar:btnCondFormat', {value: 'nope'}), null);
    assert.equal(B.locate('Toolbar:btnCondFormat', {value: () => { throw new Error('not yet'); }}), null, 'a failing value');
    assert.equal(B.locate('Toolbar:btnNope', {value: 'manage'}), null);
    assert.equal(B.itemCaption('Toolbar:btnNope', {value: 'manage'}), '');
    /* The choice is the same standard item click, after the menu preparation (the stock lazy subscription). */
    B.prime('Toolbar:btnCondFormat');
    assert.equal(B.pick('Toolbar:btnCondFormat', {value: 'new'}), true);
    assert.deepEqual(env.log.slice(-1), ['cond new'], 'the stock item click by value');
    env.cond.items[7].setDisabled(true);
    assert.equal(B.pick('Toolbar:btnCondFormat', {value: 'manage'}), false, 'a locked stock item picked');
    assert.equal(B.pick('Toolbar:cmbNumberFormat', {value: 'nf-0'}), false, 'a combo has no items by value');
    /* The index path is as before. */
    assert.equal(B.pick('Toolbar:btnCondFormat', '5'), true);
});

test('pick_state_button_and_item', () => {
    const env = makeEnv(), B = env.B, item = env.cond.items[7];
    assert.deepEqual(plain(B.itemState('Toolbar:btnCondFormat', {value: 'manage'})),
        {exists: true, disabled: false, pressed: false, visible: true, causes: []});
    /* The item is disabled by its own lock (lockControls puts keepState on items too) - the button is alive. */
    item.setDisabled(true);
    item.keepState = ['cell-editing'];
    assert.deepEqual(plain(B.itemState('Toolbar:btnCondFormat', {value: 'manage'})),
        {exists: true, disabled: true, pressed: false, visible: true, causes: ['cell-editing']}, 'the lock of the item is not read');
    assert.equal(B.state('Toolbar:btnCondFormat').disabled, false, 'precondition: the button is live');
    /* The checkmark comes from the item. */
    const landscape = env.orient.items[1];
    landscape.value = 'landscape';
    landscape.setChecked(true);
    assert.equal(B.itemState('Toolbar:btnPageOrient', {value: 'landscape'}).pressed, true, 'the check of the item is not read');
    assert.deepEqual(plain(B.itemState('Toolbar:btnCondFormat', {value: 'nope'})), {exists: false, disabled: true, pressed: false, visible: false, causes: []});
    /* The index path is the same item. */
    assert.equal(B.itemState('Toolbar:btnCondFormat', '7').disabled, true);
});

/* The double menu rows without show preparation (rows): whether at least one shown top-level row is alive, and for disabled ones -
   their standard reasons (for the stock "Clear" during a cell edit the menu items are disabled, not the button). There is no preparation - the journal is empty:
   the state is read every time the menu row holder counts its availability. The negative control is a bridge without rows. */
test('rows_live_without_prepare', () => {
    const env = makeEnv(), B = env.B;
    assert.equal(typeof B.rows, 'function', 'no StockBridge.rows');
    env.log.length = 0;
    assert.deepEqual(plain(B.rows('Toolbar:btnFillNumbers')), {exists: true, live: true, causes: []}, 'a menu with live rows');
    assert.deepEqual(env.log, [], 'rows prepared the stock menu');
    const items = env.cond.items.filter(i => i && i.caption !== '--');
    items.forEach((i, n) => { i.setDisabled(true); i.keepState = n % 2 ? ['cell-editing'] : ['cantModifyFilter']; });
    const r = plain(B.rows('Toolbar:btnCondFormat'));
    assert.equal(r.exists, true);
    assert.equal(r.live, false, 'all rows are off, but rows says live');
    assert.deepEqual(r.causes.slice().sort(), ['cantModifyFilter', 'cell-editing'], 'the causes of the locked rows (no repeats)');
    const last = items[items.length - 1];
    last.setDisabled(false);
    assert.deepEqual(plain(B.rows('Toolbar:btnCondFormat')), {exists: true, live: true, causes: []}, 'one live row is enough');
    /* A row hidden by the stock does not count. */
    last.hidden = true;
    assert.equal(B.rows('Toolbar:btnCondFormat').live, false, 'a hidden live row counted');
    assert.deepEqual(plain(B.rows('Toolbar:btnNope')), {exists: false, live: false, causes: []}, 'no twin');
    assert.deepEqual(plain(B.rows('Toolbar:btnSave')), {exists: false, live: false, causes: []}, 'a button without a menu');
});

test('mirror_omit_by_predicate', () => {
    const env = makeEnv(), B = env.B;
    B.gaps.length = 0;
    const omit = [];
    let target = 'new';
    /* The predicate is from the standard item (options, item); the value is taken at call time. */
    B.OMIT['Toolbar:btnCondFormat'] = (o, it) => { omit.push(o.caption); return o.value === target || it.caption === 'Less'; };
    const rows = list => plain(list).map(e => e.sep ? '--' : e.id + ' ' + e.caption + (e.sub ? ' [' + e.sub.map(x => x.id + ' ' + x.caption).join(', ') + ']' : ''));
    assert.deepEqual(rows(B.mirror('Toolbar:btnCondFormat')), ['0 Value is [0.0 Greater]', '--', '2 Data bars', '--', '7 Manage'],
        'an omitted item is not in the mirror at any depth; ids stay; separators collapse');
    assert.ok(omit.includes('Less'), 'the predicate did not see the submenu items');
    assert.deepEqual(plain(B.gaps.filter(g => g.ref === 'Toolbar:btnCondFormat').map(g => g.kind + ':' + g.what)), ['depth:Third level'],
        'an omitted item went to gaps');
    target = 'manage';
    assert.deepEqual(rows(B.mirror('Toolbar:btnCondFormat')), ['0 Value is [0.0 Greater]', '--', '2 Data bars', '--', '5 New rule'],
        'the predicate is not asked at every open');
    assert.equal(B.pick('Toolbar:btnCondFormat', '5'), true, 'ids of the stock menu stay: the pick still goes to the same item');
    /* Another double is not affected; a predicate failure keeps the row; without a record - as before. */
    assert.deepEqual(plain(B.mirror('Toolbar:btnFillNumbers')).filter(e => !e.sep).length, 5, 'another twin is touched');
    B.OMIT['Toolbar:btnCondFormat'] = () => { throw new Error('Asc is not ready'); };
    assert.ok(rows(B.mirror('Toolbar:btnCondFormat')).includes('5 New rule'), 'a failing predicate removed the row');
    delete B.OMIT['Toolbar:btnCondFormat'];
    assert.deepEqual(rows(B.mirror('Toolbar:btnCondFormat')), ['0 Value is [0.0 Greater, 0.1 Less]', '--', '2 Data bars', '--', '5 New rule', '7 Manage']);
    /* The item value is in the mirror record (a number, a string), the item is recognized by it. */
    const cond = plain(B.mirror('Toolbar:btnCondFormat'));
    assert.deepEqual([cond[0].sub[0].value, cond[4].value, cond[5].value], [5, 'new', 'manage'], 'the value of a stock item is not in the mirror row');
    assert.ok(!('value' in plain(B.mirror('Toolbar:btnPageMargins'))[0]), 'an object value (margins) is not a mirror value');
});

/* "Format → Rows, columns and sheet ▸" - the menu items of the ribbon "Format" button, except the last:
   "Format cells" became a separate item. The mirror exception is by the standard item value ('formatCells'): there is no row, no dangling separator
   before it, the ids of the other rows are as before; the bridge finds the item by value and chooses it with a standard click (the "Format" item); other doubles
   lose nothing. */
test('format_cells_omitted_from_format_mirror', () => {
    const env = makeEnv(), B = env.B;
    assert.equal(typeof B.OMIT['Toolbar:btnFormatCell'], 'function', 'no mirror exception for the stock «Format»');
    const rows = plain(B.mirror('Toolbar:btnFormatCell')).map(e => e.sep ? '--' : e.id + ' ' + e.caption + (e.checked ? ' ✓' : ''));
    assert.deepEqual(rows, ['0 Row height', '--', '2 Rename sheet', '--', '4 Locked cell ✓'], '«Format cells» or its separator is in the mirror');
    assert.equal(B.locate('Toolbar:btnFormatCell', {value: 'formatCells'}), env.formatCell.items[6], 'the omitted stock item is not found by value');
    assert.equal(B.itemCaption('Toolbar:btnFormatCell', {value: 'formatCells'}), 'Format cells');
    assert.equal(B.pick('Toolbar:btnFormatCell', {value: 'formatCells'}), true);
    assert.deepEqual(env.log.slice(-1), ['format formatCells'], 'the stock item click by value');
    assert.equal(B.pick('Toolbar:btnFormatCell', '4'), true, 'ids of the other rows changed');
    assert.deepEqual(env.log.slice(-1), ['format lockedCell']);
    /* Another double with the same item value is not affected. */
    env.cond.items[5].value = 'formatCells';
    assert.ok(plain(B.mirror('Toolbar:btnCondFormat')).some(e => e.caption === 'New rule'), 'the exception of «Format» removed a row of another twin');
});

/* The engine constants (sdkjs cell/model/Serialize.js ECfType - Asc.c_oAscCFType; cell/apiDefines.js c_oAscBorderOptions,
   c_oAscSelectionForCFType). The bridge reads them at the predicate call time. */
const CF = {aboveAverage: 0, beginsWith: 1, cellIs: 2, colorScale: 3, containsBlanks: 4, containsErrors: 5, containsText: 6, dataBar: 7,
    duplicateValues: 8, expression: 9, iconSet: 10, notContainsBlanks: 11, notContainsErrors: 12, notContainsText: 13, timePeriod: 14, top10: 15,
    uniqueValues: 16, endsWith: 17};
const BORDER = {Top: 0, Right: 1, Bottom: 2, Left: 3, DiagD: 4, DiagU: 5, InnerV: 6, InnerH: 7};
const CF_SCOPE = {selection: 1, worksheet: 2, table: 3, pivot: 4};
/* An item in the stock shape: the configuration properties are in options (Common.UI.MenuItem: type, value, borderId of rules and borders). */
function stockItem(caption, options = {}, opt = {}) {
    const it = item(caption, Object.assign({value: options.value}, opt));
    Object.assign(it.options, options);
    return it;
}
/* The ribbon "Conditional formatting" button menu in the stock shape (view/Toolbar.js btnCondFormat.setMenu): rule groups with submenus (cell
   value - cellIs, top/bottom - top10, average - aboveAverage 0…9, text …), galleries, "Formula" (expression) between separators,
   "New rule", "Clear rules ▸" (the type is the c_oAscSelectionForCFType area, value 'clear'), "Manage rules". The choice is the menu 'item:click'
   (journal "cond <caption>"). */
function condStockMenu(log) {
    const sub = (items) => { const m = menu(items); m.on('item:click', (mm, it) => log.push('cond ' + it.caption)); return m; };
    const avg = ['Above', 'Below', 'Equal or above', 'Equal or below', '1 std dev above', '1 std dev below', '2 std dev above', '2 std dev below',
        '3 std dev above', '3 std dev below'].map((c, v) => stockItem(c, {type: CF.aboveAverage, value: v}));
    const m = menu([
        stockItem('Cell value', {}, {menu: sub([stockItem('Greater than', {type: CF.cellIs, value: 5}), stockItem('Between', {type: CF.cellIs, value: 1})])}),
        stockItem('Top/Bottom', {type: CF.top10}, {menu: sub([stockItem('Top 10 items', {type: CF.top10, value: 0, percent: false}),
            stockItem('Top 10%', {type: CF.top10, value: 0, percent: true}), stockItem('Bottom 10 items', {type: CF.top10, value: 1, percent: false})])}),
        stockItem('Average', {}, {menu: sub(avg)}),
        stockItem('Date', {}, {menu: sub([stockItem('Yesterday', {type: CF.timePeriod, value: 'yesterday'}), stockItem('Last 7 days', {type: CF.timePeriod, value: 'last7Days'})])}),
        item('--'), stockItem('Color scales', {type: CF.colorScale}, {menu: sub([stockItem('Scale 1', {type: CF.colorScale, value: 4})])}),
        item('--'), stockItem('Formula', {type: CF.expression}),
        item('--'), stockItem('New rule', {value: 'new'}),
        stockItem('Clear rules', {}, {menu: sub([stockItem('From selection', {type: CF_SCOPE.selection, value: 'clear'}),
            stockItem('From this sheet', {type: CF_SCOPE.worksheet, value: 'clear'}), stockItem('From this pivot', {type: CF_SCOPE.pivot, value: 'clear'})])}),
        stockItem('Manage rules', {value: 'manage'})]);
    m.on('item:click', (mm, it) => log.push('cond ' + it.caption));
    return {m, avg};
}
const mirrorRows = list => plain(list).map(e => e.sep ? '--' : e.id + ' ' + e.caption + (e.sub ? ' [' + e.sub.map(x => x.sep ? '--' : x.id + ' ' + x.caption).join(', ') + ']' : ''));

/* "Conditional formatting": without "Formula" and the six standard deviation items; in
   "Average ▸" only Above · Below · Equal or above · Equal or below remain - in the panel button list and in the "Format" submenu of the same name (both are a
   mirror of Toolbar:btnCondFormat). The mirror exception is by the type and value of the standard item: expression and aboveAverage 4…9; there is no dangling separator in
   place of "Formula"; the ids of the other rows are as before - a choice by them lands on the same standard item; the standard ribbon menu is untouched (the Standard and the
   "New rule" window); items with the same values but of another type ("Clear rules ▸": the area type 1…4, "Color scales" with
   value 4), and other doubles are not affected; without the engine constants the rows stay (a predicate failure). */
test('condformat_mirror_without_formula_and_std_dev', () => {
    const env = makeEnv(), B = env.B;
    assert.equal(typeof B.OMIT['Toolbar:btnCondFormat'], 'function', 'no mirror exception for the stock conditional formatting');
    const {m, avg} = condStockMenu(env.log);
    env.toolbar.btnCondFormat = button({menu: m});
    env.context.Asc = {c_oAscCFType: CF, c_oAscBorderOptions: BORDER};
    B.gaps.length = 0;
    assert.deepEqual(mirrorRows(B.mirror('Toolbar:btnCondFormat')), [
        '0 Cell value [0.0 Greater than, 0.1 Between]',
        '1 Top/Bottom [1.0 Top 10 items, 1.1 Top 10%, 1.2 Bottom 10 items]',
        '2 Average [2.0 Above, 2.1 Below, 2.2 Equal or above, 2.3 Equal or below]',
        '3 Date [3.0 Yesterday, 3.1 Last 7 days]',
        '--', '5 Color scales [5.0 Scale 1]',
        '--', '9 New rule', '10 Clear rules [10.0 From selection, 10.1 From this sheet, 10.2 From this pivot]', '11 Manage rules'],
        '«Formula», standard deviations or a dangling separator are in the mirror');
    assert.deepEqual(plain(B.gaps), [], 'an omitted row went to gaps');
    /* A choice by the mirror id is the same standard item. */
    assert.equal(B.pick('Toolbar:btnCondFormat', '2.1'), true);
    assert.equal(B.pick('Toolbar:btnCondFormat', '2.3'), true);
    assert.equal(B.pick('Toolbar:btnCondFormat', '9'), true);
    assert.deepEqual(env.log.slice(-3), ['cond Below', 'cond Equal or below', 'cond New rule'], 'ids of the mirror do not pick the same stock items');
    /* The standard ribbon menu is untouched. */
    assert.equal(m.items.length, 12, 'the stock menu lost items');
    assert.ok(m.items.some(i => i.caption === 'Formula' && !i.hidden), 'the stock «Formula» is hidden or gone');
    assert.equal(m.items[2].menu.items.length, 10, 'the stock «Average» lost items');
    assert.ok(avg.every(i => !i.hidden && i.visible !== false), 'stock standard deviation items are hidden');
    /* Another double with an item of the same type is not affected. */
    env.fill[0].options.type = CF.expression;
    env.fill[1].options.type = CF.aboveAverage;
    env.fill[1].options.value = 5;
    assert.equal(plain(B.mirror('Toolbar:btnFillNumbers')).filter(e => !e.sep).length, 5, 'the exception removed rows of another twin');
    /* The engine constants are not ready yet - the rows stay. */
    delete env.context.Asc;
    assert.ok(mirrorRows(B.mirror('Toolbar:btnCondFormat')).includes('7 Formula'), 'without Asc the predicate removed a row');
});

/* The ribbon "Borders" button menu in the stock shape (view/Toolbar.js btnBorders.setMenu): sides, a separator, "None · All · Outer · Inner", a separator,
   inner horizontal and vertical, two diagonals (borderId DiagD, DiagU), a separator, "Border style ▸", "Border color ▸", "More borders"
   (value 'options'). The choice is the menu 'item:click' (journal "borders <caption>"). */
function bordersStockMenu(log) {
    const b = (caption, borderId) => stockItem(caption, {borderId});
    const m = menu([b('Bottom', BORDER.Bottom), b('Top', BORDER.Top), b('Left', BORDER.Left), b('Right', BORDER.Right), item('--'),
        b('None', 'none'), b('All', 'all'), b('Outer', 'outer'), b('Inner', 'inner'), item('--'),
        b('Inside horizontal', BORDER.InnerH), b('Inside vertical', BORDER.InnerV), b('Diagonal down', BORDER.DiagD), b('Diagonal up', BORDER.DiagU), item('--'),
        stockItem('Border style', {}, {menu: menu([stockItem('Thin', {value: 1}), stockItem('Medium', {value: BORDER.DiagD})])}),
        stockItem('Border color', {}, {menu: menu([item('Automatic')])}),
        stockItem('More borders', {value: 'options'})]);
    m.on('item:click', (mm, it) => log.push('borders ' + it.caption));
    return m;
}

/* "Borders": without "Diagonal down border" and "… up border" - in the panel button
   list and "Format → Borders ▸" (both are a mirror of Toolbar:btnBorders). The mirror exception is by the borderId of the standard item (DiagD, DiagU); the sides,
   "None · All · Outer · Inner", inner ones, "Border style ▸", "Border color ▸" and "More borders" (the right cell panel - the
   diagonals are there) are in place, the ids are as before - a choice lands on the same standard item; no dangling separators; nothing new in gaps; the standard ribbon
   menu is untouched; the value 4 (= DiagD) on an item without borderId and on another double does not remove the row; without the engine constants the rows stay. */
test('borders_mirror_without_diagonals', () => {
    const env = makeEnv(), B = env.B;
    assert.equal(typeof B.OMIT['Toolbar:btnBorders'], 'function', 'no mirror exception for the stock borders');
    const m = bordersStockMenu(env.log);
    env.toolbar.btnBorders = button({menu: m});
    env.context.Asc = {c_oAscCFType: CF, c_oAscBorderOptions: BORDER};
    B.gaps.length = 0;
    assert.deepEqual(mirrorRows(B.mirror('Toolbar:btnBorders')), ['0 Bottom', '1 Top', '2 Left', '3 Right', '--', '5 None', '6 All', '7 Outer', '8 Inner', '--',
        '10 Inside horizontal', '11 Inside vertical', '--', '15 Border style [15.0 Thin, 15.1 Medium]', '16 Border color [16.0 Automatic]', '17 More borders'],
        'a diagonal border or a dangling separator is in the mirror');
    assert.deepEqual(plain(B.gaps), [], 'an omitted row went to gaps');
    assert.equal(B.pick('Toolbar:btnBorders', '11'), true);
    assert.equal(B.pick('Toolbar:btnBorders', '17'), true);
    assert.deepEqual(env.log.slice(-2), ['borders Inside vertical', 'borders More borders'], 'ids of the mirror do not pick the same stock items');
    assert.equal(m.items.length, 18, 'the stock menu lost items');
    assert.ok(m.items.filter(i => i.options.borderId === BORDER.DiagD || i.options.borderId === BORDER.DiagU).every(i => !i.hidden), 'the stock diagonals are hidden');
    /* The borders exception does not touch conditional formatting or other doubles with the same borderId. */
    env.fill[0].options.borderId = BORDER.DiagD;
    assert.equal(plain(B.mirror('Toolbar:btnFillNumbers')).filter(e => !e.sep).length, 5, 'the exception removed rows of another twin');
    delete env.context.Asc;
    assert.ok(mirrorRows(B.mirror('Toolbar:btnBorders')).includes('12 Diagonal down'), 'without Asc the predicate removed a row');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
