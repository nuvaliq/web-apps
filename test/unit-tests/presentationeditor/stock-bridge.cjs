/* Run: node test/unit-tests/presentationeditor/stock-bridge.cjs [path to StockBridge.js]
 * The bridge from the presentation shell to the stock ribbon: address roots (tabs and controllers),
 * a command the stock way, refusal on a disabled and a vanished target, stock event arguments,
 * the menu snapshot after the 'show:before' preparation, choosing an item with a stock click, showing the stock
 * gallery at a shell control, store tiles and their 'click' event, observing a
 * twin, an engine call only by the catalog mark.
 *
 * The module is loaded in node via vm on top of a fake stock code; where the mechanics themselves matter,
 * the methods are taken from the real component sources (MenuItem.onItemClick,
 * setChecked, toggle; Menu.onItemClick; Button.click, doToggle, toggle;
 * ComboDataView.onMenuPickerClick).
 * The optional argument is a corrupted copy of the bridge for a negative control:
 * a copy that reads the menu without 'show:before' must fail mirror_reads_items_after_show_before.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const FILE = process.argv[2] ? path.resolve(process.argv[2])
    : path.join(ROOT, 'apps/presentationeditor/main/app/view/StockBridge.js');
const COMPONENTS = path.join(ROOT, 'apps/common/main/lib/component');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

/* --- Real methods of the stock components ----------------------------------- */

/* The text of the method `name: function(...) {...}` from the component source (first occurrence
   after `after`): brackets are counted over the code without strings and comments. */
function stockMethod(file, name, after) {
    const src = fs.readFileSync(path.join(COMPONENTS, file), 'utf8');
    const from = after ? src.indexOf(after) : 0;
    assert.ok(from >= 0, file + ': anchor ' + after + ' not found');
    const head = new RegExp('\\b' + name + '\\s*:\\s*function\\s*\\(').exec(src.slice(from));
    assert.ok(head, file + ': ' + name + ' not found');
    const start = from + head.index + head[0].length - 'function('.length;
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
        if (c === '"' || c === "'") { const q = c; i++; while (src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
    }
    const sandbox = {_: {delay: fn => fn(), isEmpty: v => !v}, Common: {}};
    vm.createContext(sandbox);
    return vm.runInContext('(' + src.slice(start, i + 1) + ')', sandbox, {filename: file + ':' + name});
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
    comboPickerClick: stockMethod('ComboDataView.js', 'onMenuPickerClick')
};

/* --- A small DOM -------------------------------------------------------------- */

const observers = [];
class FakeObserver {
    constructor(cb) { this.cb = cb; this.target = null; observers.push(this); }
    observe(target, opts) { this.target = target; this.opts = opts; }
    disconnect() { this.target = null; }
}
/* A node attribute change reaches its observers, like with MutationObserver. */
function mutated(el) { observers.filter(o => o.target === el).forEach(o => o.cb([{target: el}], o)); }

class Node {
    constructor(tag, doc) {
        this.tagName = tag; this.nodeType = 1; this.ownerDocument = doc || null;
        this.children = []; this.parentNode = null; this.attrs = {}; this.style = {}; this.listeners = {};
        this.boxes = 0; this.rect = {left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0};
        const self = this, set = new Set();
        this.classList = {
            add(...c) { c.forEach(x => set.add(x)); mutated(self); },
            remove(...c) { c.forEach(x => set.delete(x)); mutated(self); },
            contains: c => set.has(c),
            toggle(c, on) { const v = on === undefined ? !set.has(c) : !!on; v ? set.add(c) : set.delete(c); mutated(self); return v; },
            list: () => [...set]
        };
    }
    get className() { return this.classList.list().join(' '); }
    set className(v) { this.classList.list().forEach(c => this.classList.remove(c)); String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); this.children.push(c); c.parentNode = this; c.ownerDocument = this.ownerDocument; return c; }
    removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
    contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
    getClientRects() { return {length: this.boxes}; }
    getBoundingClientRect() { return this.rect; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
    dispatch(t, e) { (this.listeners[t] || []).slice().forEach(f => f(Object.assign({type: t, target: this}, e))); }
    setAttribute(k, v) { this.attrs[k] = String(v); mutated(this); }
}

function makeDoc() {
    const doc = {createElement: tag => new Node(tag, doc)};
    doc.body = new Node('body', doc);
    doc.body.boxes = 1;
    return doc;
}

/* A jQuery wrapper of a node with what the stock methods and the bridge call. */
function $(el) {
    const w = [el];
    w.attr = (k, v) => { el.setAttribute(k, v); return w; };
    w.trigger = name => { (el.listeners['$' + name] || []).forEach(f => f()); return w; };
    w.addClass = c => { el.classList.add(c); return w; };
    w.removeClass = c => { el.classList.remove(c); return w; };
    w.hasClass = c => el.classList.contains(c);
    return w;
}

/* --- Fake stock code ------------------------------------------------------------ */

function events(target) {
    const handlers = {};
    target.on = (names, fn) => { String(names).split(/\s+/).forEach(n => (handlers[n] = handlers[n] || []).push(fn)); return target; };
    target.off = (names, fn) => { String(names).split(/\s+/).forEach(n => { handlers[n] = (handlers[n] || []).filter(f => f !== fn); }); return target; };
    target.trigger = function (name, ...args) { (handlers[name] || []).slice().forEach(fn => fn.apply(target, args)); return target; };
    target.count = name => (handlers[name] || []).length;
    return target;
}

let doc;

/* A ribbon button: the real click/doToggle/toggle/isDisabled; setDisabled works like
   Button: the disabled class and attribute on the node (observation watches them). */
function button(opt = {}) {
    const b = events({disabled: !!opt.disabled, pressed: !!opt.pressed, enableToggle: !!opt.toggle, allowDepress: true,
        visible: opt.visible !== false, options: {}, menu: opt.menu || null});
    const el = new Node('div', doc);
    b.cmpEl = $(el);
    b.click = STOCK.btnClick; b.doToggle = STOCK.btnDoToggle; b.toggle = STOCK.btnToggle; b.isDisabled = STOCK.btnIsDisabled;
    b.setDisabled = function (v) { this.disabled = !!v; el.classList.toggle('disabled', this.disabled); };
    return b;
}

/* A menu item: the real onItemClick/setChecked/toggle/isChecked/isDisabled, not rendered. */
function item(caption, opt = {}) {
    const it = events({caption, value: opt.value, disabled: !!opt.disabled, checkable: !!opt.checkable, checked: !!opt.checked,
        toggleGroup: opt.group || null, allowDepress: false, visible: opt.visible !== false, hidden: !!opt.hidden,
        rendered: false, menu: opt.menu || null, options: {caption, value: opt.value}, id: 'mi-' + caption});
    it.onItemClick = STOCK.itemClick; it.setChecked = STOCK.itemSetChecked; it.isChecked = STOCK.itemIsChecked;
    it.toggle = STOCK.itemToggle; it.isDisabled = STOCK.itemIsDisabled;
    it.setDisabled = function (v) { this.disabled = !!v; };
    it.setVisible = function (v) { this.hidden = !v; };
    it.cmpEl = $(new Node('li', doc));
    return it;
}

/* A menu: items are linked to the menu the way Menu.render does it (item 'click' → Menu.onItemClick
   → 'item:click'). */
function menu(items) {
    const m = events({items, rendered: true, options: {}});
    m.onItemClick = STOCK.menuItemClick;
    m.parentEl = $(new Node('div', doc));
    items.forEach(i => i.on('click', (it, e) => m.onItemClick(it, e)));
    return m;
}

/* A gallery menu rendered in a hidden ribbon: a ul inside a holder (.btn-group) inside
   a tab inside #toolbar (rendered). Menu.show is the stock path: show:before, the open class
   on the holder, show:after; alignPosition places the menu by menuAlignEl. */
function galleryMenu() {
    const toolbar = new Node('div', doc); toolbar.boxes = 1; doc.body.appendChild(toolbar);
    const tab = new Node('section', doc); toolbar.appendChild(tab);
    const host = new Node('div', doc); host.classList.add('btn-group'); tab.appendChild(host);
    const ul = new Node('ul', doc); host.appendChild(ul);
    const m = events({items: [item('')], rendered: true, options: {}, menuRoot: $(ul), parentEl: $(host), log: []});
    m.alignPosition = function () { m.log.push(['align', m.menuAlignEl && m.menuAlignEl[0], m.menuAlign]); };
    m.show = function () { m.log.push(['show']); m.trigger('show:before', m); host.classList.add('open'); m.trigger('show:after', m); };
    m.hide = function () { m.log.push(['hide']); host.classList.remove('open'); };
    return {m, ul, host, tab, toolbar};
}

/* A gallery store (Backbone.Collection in the stock code). */
function store(rows) {
    const models = rows.map(r => ({attrs: Object.assign({}, r), get(k) { return this.attrs[k]; }, set(k, v) { this.attrs[k] = v; }}));
    return {models, length: models.length, at: i => models[i]};
}

/* --- World -------------------------------------------------------------------- */

let ctrls, apiCalls, catalog;
const contexts = new Map();
const vmContextOf = bridge => contexts.get(bridge);

function world() {
    observers.length = 0;
    doc = makeDoc();
    apiCalls = [];
    catalog = [];
    const toolbar = {
        btnUndo: button({disabled: true}),
        btnBold: button({toggle: true}),
        btnAddSlide: button(),
        btnHidden: button({visible: false}),
        btnColorSchemas: button({menu: menu([item('Office', {checkable: true, value: 0}), item('Grayscale', {checkable: true, value: 1})])}),
        btnPreview: button({menu: menu([item('From beginning', {value: 0}), item('From current slide', {value: 1}),
            item('Presenter view', {value: 2}), item('--'), item('Slide show settings', {value: 3})])})
    };
    const left = {btnThumbs: button({toggle: true, pressed: true}), btnComments: button({toggle: true}),
        menuFile: {miDownload: item('Download as'), miPrint: item('Print')},
        getMenu(n) { return n === 'file' ? this.menuFile : null; }};
    ctrls = {
        Toolbar: {toolbar, btnsComment: [button()]},
        ViewTab: {view: {chNotes: {$chk: {}, checked: true, isChecked() { return this.checked; }}, btnGuides: button({menu: menu([item('Show guides', {checkable: true})])})}},
        Transitions: {view: {btnPreview: button(), listEffects: null}},
        Animation: {view: {btnAnimationPane: button({toggle: true})}},
        LeftMenu: {leftMenu: left, onShowTumbnails(v) { apiCalls.push(['LeftMenu.onShowTumbnails', v]); }},
        Statusbar: {statusbar: {btnPreview: button()}},
        RightMenu: {rightmenu: {btnSlide: button()}},
        'Common.Controllers.ReviewChanges': {view: {btnSharing: button()}},
        'Common.Controllers.ChartTab': {view: {btnEditData: button()}},
        DocumentHolder: {documentHolder: {menuSlide: {}}},
        Main: {api: {asc_AddSlide(...a) { apiCalls.push(['asc_AddSlide'].concat(a)); return 'added'; },
            asc_Remove() { apiCalls.push(['asc_Remove']); }}}
    };
    const PE = {Views: {SlideActions: {groups: () => catalog}}, getController: n => ctrls[n] || null};
    const sandbox = {PE, _, window: null, jQuery: $, MutationObserver: FakeObserver, console};
    sandbox.window = sandbox;
    Object.defineProperty(sandbox, 'document', {get: () => doc});
    sandbox.define = (deps, factory) => factory();
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, {filename: FILE});
    const bridge = PE.Views.StockBridge;
    assert.ok(bridge && typeof bridge.twin === 'function', 'StockBridge.twin() is missing');
    contexts.set(bridge, sandbox);
    bridge.gaps.length = 0;
    return {bridge, toolbar, left, PE};
}

let passed = 0, failed = 0;
function test(name, body) {
    try {
        body();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
        failed++;
    }
}
const plain = v => JSON.parse(JSON.stringify(v));

/* --- Cases ---------------------------------------------------------------------- */

test('roots_resolve_tabs_and_controllers', () => {
    const {bridge, toolbar, left} = world();
    const expect = {
        'Toolbar:btnUndo': toolbar.btnUndo,
        'ToolbarCtl:btnsComment.0': ctrls.Toolbar.btnsComment[0],
        'ViewTab:btnGuides': ctrls.ViewTab.view.btnGuides,
        'Transitions:btnPreview': ctrls.Transitions.view.btnPreview,
        'Animation:btnAnimationPane': ctrls.Animation.view.btnAnimationPane,
        'LeftMenu:btnThumbs': left.btnThumbs,
        'Statusbar:btnPreview': ctrls.Statusbar.statusbar.btnPreview,
        'RightMenu:btnSlide': ctrls.RightMenu.rightmenu.btnSlide,
        'FileMenu:miDownload': left.menuFile.miDownload,
        'Review:btnSharing': ctrls['Common.Controllers.ReviewChanges'].view.btnSharing,
        'ChartTab:btnEditData': ctrls['Common.Controllers.ChartTab'].view.btnEditData,
        'DocumentHolder:menuSlide': ctrls.DocumentHolder.documentHolder.menuSlide,
        'Toolbar:btnPreview.menu.items.4': toolbar.btnPreview.menu.items[4]
    };
    Object.keys(expect).forEach(ref => assert.equal(bridge.twin(ref), expect[ref], ref));
    ['Toolbar:btnNope', 'Nope:btnUndo', 'Toolbar:', 'btnUndo', 'Transitions:listEffects', 'Toolbar:btnUndo.menu.items.9', null, 7]
        .forEach(ref => assert.equal(bridge.twin(ref), null, String(ref) + ' resolves to null'));
    ctrls.Transitions = null;
    assert.equal(bridge.twin('Transitions:btnPreview'), null, 'a missing controller gives null, not an exception');
    assert.deepEqual(plain(bridge.state('Toolbar:btnUndo')), {exists: true, disabled: true, pressed: false, visible: true});
    assert.deepEqual(plain(bridge.state('LeftMenu:btnThumbs')), {exists: true, disabled: false, pressed: true, visible: true});
    assert.deepEqual(plain(bridge.state('ViewTab:chNotes')), {exists: true, disabled: false, pressed: true, visible: true});
    assert.equal(bridge.state('Toolbar:btnHidden').visible, false, 'a hidden stock button is not visible');
    assert.deepEqual(plain(bridge.state('Toolbar:btnNope')), {exists: false, disabled: true, pressed: false, visible: false});
});

test('roots_resolve_file_menu_items_before_its_first_show', () => {
    const {bridge, left, PE} = world();
    /* The stock FileMenu: items appear in render(), which the first show calls. */
    let renders = 0;
    const fm = {rendered: false, mode: null, render() { renders++; this.miDownload = item('Download as'); this.rendered = true; return this; }};
    left.getMenu = n => (n === 'file' ? fm : null);
    const loaded = {v: false};
    const common = {Controllers: {LaunchController: {isScriptLoaded: () => loaded.v}}};
    vmContextOf(bridge).Common = common;
    assert.equal(bridge.twin('FileMenu:miDownload'), null, 'no mode yet — no items, no render');
    fm.mode = {canDownload: true};
    assert.equal(bridge.twin('FileMenu:miDownload'), null, 'scripts not loaded — no render');
    assert.equal(renders, 0);
    loaded.v = true;
    assert.equal(bridge.twin('FileMenu:miDownload'), fm.miDownload, 'rendered on the same conditions as the first show');
    bridge.twin('FileMenu:miDownload');
    assert.equal(renders, 1, 'rendered once');
});

test('run_clicks_twin_once', () => {
    const {bridge, toolbar} = world();
    let clicks = 0, toggles = [];
    toolbar.btnAddSlide.on('click', () => clicks++);
    assert.equal(bridge.run('Toolbar:btnAddSlide'), true);
    assert.equal(clicks, 1, 'one stock click');
    toolbar.btnBold.on('toggle', (b, s) => toggles.push(s));
    assert.equal(bridge.run('Toolbar:btnBold'), true);
    assert.deepEqual(toggles, [true], 'a toggle button switches through its own click');
    assert.equal(toolbar.btnBold.pressed, true);
    const it = toolbar.btnPreview.menu.items[1];
    const got = [];
    toolbar.btnPreview.menu.on('item:click', (m, i) => got.push(i.value));
    assert.equal(bridge.run('Toolbar:btnPreview.menu.items.1'), true);
    assert.deepEqual(got, [1], 'a menu item goes through MenuItem.onItemClick to item:click of its menu');
    assert.equal(it.checked, false, 'a plain item is not checked');
});

test('run_refuses_disabled_or_missing', () => {
    const {bridge, toolbar} = world();
    let clicks = 0;
    toolbar.btnUndo.on('click', () => clicks++);
    assert.equal(bridge.run('Toolbar:btnUndo'), false, 'disabled twin');
    assert.equal(bridge.run('Toolbar:btnNope'), false, 'missing twin');
    assert.equal(bridge.run('Toolbar:btnUndo', {event: 'click'}), false, 'disabled twin with an event');
    assert.equal(clicks, 0);
    toolbar.btnUndo.setDisabled(false);
    assert.equal(bridge.run('Toolbar:btnUndo'), true);
    assert.equal(clicks, 1);
    const mi = toolbar.btnPreview.menu.items[2];
    mi.setDisabled(true);
    assert.equal(bridge.run('Toolbar:btnPreview.menu.items.2'), false, 'disabled menu item');
    mi.setDisabled(false); mi.setVisible(false);
    assert.equal(bridge.run('Toolbar:btnPreview.menu.items.2'), false, 'hidden menu item');
    assert.equal(bridge.run('Toolbar:btnPreview.menu'), false, 'a menu is not a command');
});

test('run_passes_stock_event_args', () => {
    const {bridge, toolbar} = world();
    const seen = [];
    toolbar.btnAddSlide.on('changed:after', (...a) => seen.push(a));
    assert.equal(bridge.run('Toolbar:btnAddSlide', {event: 'changed:after', args: [3, {x: 1}]}), true);
    assert.equal(seen.length, 1, 'one event');
    assert.equal(seen[0][0], toolbar.btnAddSlide, 'the twin goes first, as the stock code sends it');
    assert.deepEqual(plain(seen[0].slice(1)), [3, {x: 1}]);
    let clicks = 0;
    toolbar.btnAddSlide.on('click', () => clicks++);
    bridge.run('Toolbar:btnAddSlide', {event: 'changed:after'});
    assert.equal(clicks, 0, 'with an event there is no click');
});

test('mirror_reads_items_after_show_before', () => {
    const {bridge, toolbar} = world();
    const m = toolbar.btnPreview.menu;
    /* Stock preparation: on 'show:before' items go gray and are shown per the engine. */
    m.items[2].setVisible(false);
    let prepared = 0;
    m.on('show:before', () => {
        prepared++;
        m.items[0].setDisabled(true);
        m.items[2].setVisible(true);
        m.items[4].setVisible(false);
    });
    const list = plain(bridge.mirror('Toolbar:btnPreview'));
    assert.equal(prepared, 1, 'the menu is prepared once');
    assert.deepEqual(list, [
        {id: '0', caption: 'From beginning', disabled: true, checked: false},
        {id: '1', caption: 'From current slide', disabled: false, checked: false},
        {id: '2', caption: 'Presenter view', disabled: false, checked: false}
    ], 'the snapshot shows what the stock code prepared; trailing separator dropped');
    /* The menu from AFTER is also prepared on 'show:after': it sets the color scheme mark. */
    const cs = toolbar.btnColorSchemas.menu;
    cs.on('show:after', () => cs.items[1].setChecked(true, true));
    const schemes = plain(bridge.mirror('Toolbar:btnColorSchemas'));
    assert.deepEqual(schemes.map(x => x.checked), [false, true], 'checked by the show:after handler');
    /* A submenu is the second level, the id is the index path. */
    m.items[1].menu = menu([item('Sub A'), item('Sub B', {disabled: true})]);
    const nested = plain(bridge.mirror('Toolbar:btnPreview'));
    assert.deepEqual(nested[1].sub, [{id: '1.0', caption: 'Sub A', disabled: false, checked: false},
        {id: '1.1', caption: 'Sub B', disabled: true, checked: false}]);
    assert.deepEqual(plain(bridge.mirror('Toolbar:btnNope')), []);
    assert.ok(bridge.gaps.some(g => g.ref === 'Toolbar:btnNope' && g.kind === 'missing'), 'a missing twin is noted');
});

test('pick_goes_through_stock_item_click', () => {
    const {bridge, toolbar} = world();
    const cs = toolbar.btnColorSchemas.menu;
    const clicks = [], toggles = [];
    cs.on('item:click', (m, it) => clicks.push(it.value));
    cs.items.forEach(it => it.on('toggle', (i, s) => toggles.push([i.value, s])));
    assert.equal(bridge.pick('Toolbar:btnColorSchemas', '1'), true);
    assert.deepEqual(clicks, [1], 'one item:click of the stock menu with the stock item');
    assert.deepEqual(toggles, [[1, true]], 'the stock item checks itself (MenuItem.onItemClick)');
    cs.items[0].setDisabled(true);
    assert.equal(bridge.pick('Toolbar:btnColorSchemas', '0'), false, 'disabled item');
    assert.equal(bridge.pick('Toolbar:btnColorSchemas', '7'), false, 'no such item');
    assert.equal(bridge.pick('Toolbar:btnPreview', '3'), false, 'a separator');
    toolbar.btnPreview.menu.items[1].menu = menu([item('Sub A')]);
    const sub = [];
    toolbar.btnPreview.menu.items[1].menu.on('item:click', (m, it) => sub.push(it.caption));
    assert.equal(bridge.pick('Toolbar:btnPreview', '1'), false, 'a holder of a submenu is not a command');
    assert.equal(bridge.pick('Toolbar:btnPreview', '1.0'), true);
    assert.deepEqual(sub, ['Sub A'], 'a submenu item by its path');
    assert.deepEqual(clicks, [1], 'nothing else was clicked');
    assert.equal(bridge.itemRef('Toolbar:btnPreview', '1.0'), 'Toolbar:btnPreview.menu.items.1.menu.items.0');
});

test('gallery_opens_stock_picker', () => {
    const {bridge, toolbar} = world();
    const g = galleryMenu();
    toolbar.btnChangeSlide = button({menu: g.m});
    const anchorEl = new Node('button', doc);
    anchorEl.rect = {left: 100, top: 40, width: 30, height: 28, right: 130, bottom: 68};
    const closed = [];
    let before = 0;
    g.m.on('show:before', () => before++);
    assert.equal(bridge.gallery('Toolbar:btnChangeSlide', anchorEl, {onClose: how => closed.push(how)}), true);
    assert.deepEqual(g.m.log.filter(x => x[0] === 'show'), [['show']], 'the stock Menu.show, once');
    assert.equal(before, 1, 'the stock show:before ran');
    assert.ok(g.host.classList.contains('open'), 'the stock shows the gallery');
    assert.equal(g.ul.parentNode, g.host, 'the stock list is not moved');
    const anchor = g.m.menuAlignEl && g.m.menuAlignEl[0];
    assert.ok(anchor && anchor.classList.contains('vo-gallery-anchor'), 'aligned by an anchor on the shell control');
    assert.equal(anchor.parentNode, doc.body);
    assert.deepEqual([anchor.style.left, anchor.style.top, anchor.style.width, anchor.style.height], ['100px', '40px', '30px', '28px']);
    assert.ok(g.m.log.some(x => x[0] === 'align' && x[1] === anchor), 'the stock alignPosition places the list');
    assert.ok(g.host.classList.contains('vo-gallery-path') && g.tab.classList.contains('vo-gallery-root'), 'the hidden path is revealed');
    assert.ok(!g.toolbar.classList.contains('vo-gallery-path'), 'a drawn ancestor is left alone');
    assert.ok(g.ul.classList.contains('vo-gallery-target') && doc.body.classList.contains('vo-gallery'));
    assert.equal(bridge.galleryOpen(), true);
    /* Choosing is a click that reached the gallery menu. */
    g.ul.dispatch('click', {});
    assert.deepEqual(closed, ['pick']);
    assert.equal(bridge.galleryOpen(), false);
    assert.ok(!g.host.classList.contains('open'), 'closed by the stock Menu.hide');
    assert.ok(!g.host.classList.contains('vo-gallery-path') && !doc.body.classList.contains('vo-gallery'), 'path classes removed');
    assert.equal(anchor.parentNode, null, 'the anchor is gone');
    assert.equal(g.m.menuAlignEl, undefined, 'the stock alignment is restored');
    /* The stock code removed the menu itself: the shell finds that out. */
    assert.equal(bridge.gallery('Toolbar:btnChangeSlide', anchorEl, {onClose: how => closed.push(how)}), true);
    g.host.classList.remove('open');
    assert.deepEqual(closed, ['pick', 'hide']);
    toolbar.btnChangeSlide.setDisabled(true);
    assert.equal(bridge.gallery('Toolbar:btnChangeSlide', anchorEl), false, 'a disabled twin shows nothing');
    assert.equal(bridge.gallery('Toolbar:btnNope', anchorEl), false, 'a missing twin shows nothing');
    assert.equal(g.m.log.filter(x => x[0] === 'show').length, 2, 'no show on refusal');
});

test('tiles_fire_store_click', () => {
    const {bridge} = world();
    const rows = [{tip: 'Blank', imageUrl: 'data:image/png;base64,AA', value: 'a', selected: true},
        {tip: 'Basic', imageUrl: 'data:image/png;base64,BB', value: 'b'}, {tip: 'Locked', value: 'c', disabled: true}];
    const s = store(rows);
    const picker = events({store: s, selected: null, selectRecord(r) { this.selected = r; }});
    const combo = events({disabled: false, store: s, menuPicker: picker, isSuspendEvents: false, options: {}});
    combo.onMenuPickerClick = STOCK.comboPickerClick;
    ctrls.Toolbar.toolbar.listTheme = combo;
    const tiles = plain(bridge.tiles('Toolbar:listTheme'));
    assert.deepEqual(tiles.map(t => [t.id, t.caption, t.value, t.selected, t.disabled]),
        [['0', 'Blank', 'a', true, false], ['1', 'Basic', 'b', false, false], ['2', 'Locked', 'c', false, true]]);
    assert.equal(tiles[1].image, 'data:image/png;base64,BB');
    const got = [];
    combo.on('click', (c, r) => got.push([c, r]));
    assert.equal(bridge.pickTile('Toolbar:listTheme', '1'), true);
    assert.equal(got.length, 1, 'one click event of the gallery');
    assert.equal(got[0][0], combo, 'the gallery sends itself first');
    assert.equal(got[0][1], s.at(1), 'with the store record');
    assert.equal(picker.selected, s.at(1), 'the record is selected in the stock list');
    assert.equal(bridge.pickTile('Toolbar:listTheme', '2'), false, 'a disabled record');
    assert.equal(bridge.pickTile('Toolbar:listTheme', '9'), false, 'no such record');
    combo.disabled = true;
    assert.equal(bridge.pickTile('Toolbar:listTheme', '0'), false, 'a disabled gallery');
    assert.equal(got.length, 1);
    assert.deepEqual(plain(bridge.tiles('Toolbar:btnNope')), []);
});

test('watch_reports_disabled_change', () => {
    const {bridge, toolbar} = world();
    const seen = [];
    const off = bridge.watch('Toolbar:btnUndo', st => seen.push(plain(st)));
    assert.equal(typeof off, 'function', 'watch gives an unsubscribe');
    toolbar.btnUndo.setDisabled(false);
    assert.deepEqual(seen, [{exists: true, disabled: false, pressed: false, visible: true}], 'the stock lock change is reported');
    toolbar.btnUndo.cmpEl[0].setAttribute('title', 'x');
    assert.equal(seen.length, 1, 'no report without a state change');
    toolbar.btnUndo.setDisabled(true);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].disabled, true);
    off();
    toolbar.btnUndo.setDisabled(false);
    assert.equal(seen.length, 2, 'nothing after unsubscribe');
    const pressed = [];
    bridge.watch('Toolbar:btnBold', st => pressed.push(st.pressed));
    toolbar.btnBold.toggle(true);
    assert.deepEqual(pressed, [true], 'pressed state of a toggle button is reported');
    assert.equal(typeof bridge.watch('Toolbar:btnNope', () => {}), 'function', 'a missing twin gives a no-op');
});

test('engine_only_for_catalog_marked_items', () => {
    const {bridge} = world();
    assert.equal(bridge.engine('asc_AddSlide', 1), undefined, 'not marked — refused');
    assert.equal(bridge.engine('LeftMenu.onShowTumbnails', true), undefined, 'not marked — refused');
    assert.deepEqual(apiCalls, [], 'nothing reached the engine');
    assert.ok(bridge.gaps.some(g => g.ref === 'asc_AddSlide' && g.kind === 'engine'), 'the refusal is noted');
    catalog = [{label: 'Вид', items: [{t: 'Слайды', twin: 'LeftMenu:btnThumbs'}, {sep: true},
        {t: 'Ещё', sub: [{t: 'Слайды (просмотр)', engine: 'LeftMenu.onShowTumbnails'}]}]},
        {label: 'Слайд', items: [{t: 'Новый', engine: {name: 'asc_AddSlide'}}]}];
    assert.equal(bridge.engine('asc_AddSlide', 1), 'added', 'a marked api call returns its result');
    bridge.engine('LeftMenu.onShowTumbnails', true);
    assert.equal(bridge.engine('asc_Remove'), undefined, 'still refused');
    assert.deepEqual(plain(apiCalls), [['asc_AddSlide', 1], ['LeftMenu.onShowTumbnails', true]]);
});

test('mirror_skips_only_flagged_plugin_items', () => {
    const {bridge, toolbar} = world();
    const m = toolbar.btnPreview.menu;
    /* A plugin item is Common.UI.MenuItemCustom: isCustomItem === true. */
    m.items[0].isCustomItem = true;
    /* A foreign field value and a menu that is not an object are neither a plugin mark nor a submenu. */
    m.items[1].isCustomItem = function () {};
    m.items[2].isCustomItem = 'yes';
    m.items[2].menu = function () {};
    const list = plain(bridge.mirror('Toolbar:btnPreview'));
    assert.deepEqual(list.map(x => x.sep ? '--' : x.caption), ['From current slide', 'Presenter view', '--', 'Slide show settings'],
        'only the flagged plugin item is left out');
    assert.ok(bridge.gaps.some(g => g.kind === 'plugin' && g.what === 'From beginning'), 'the plugin item is noted');
    assert.ok(!bridge.gaps.some(g => g.kind === 'plugin' && g.what !== 'From beginning'), 'nothing else is taken for a plugin');
});

test('pick_without_item_click_follows_stock_steps', () => {
    const {bridge, toolbar} = world();
    /* The menu is linked to the items like the stock Menu: an item's 'click' → its 'item:click'. */
    const cs = toolbar.btnColorSchemas.menu;
    cs.items.forEach(it => { delete it.onItemClick; });
    const clicks = [], toggles = [], own = [];
    cs.on('item:click', (m, it) => clicks.push([m === cs, it.value]));
    cs.items.forEach(it => it.on('toggle', (i, s) => toggles.push([i.value, s])));
    cs.items[1].on('click', (i, e) => own.push([i.value, e && e.which]));
    assert.equal(bridge.pick('Toolbar:btnColorSchemas', '1'), true);
    assert.deepEqual(toggles, [[1, true]], 'the checkable item checks itself, as MenuItem.onItemClick does');
    assert.deepEqual(own, [[1, 1]], 'one click event of the item, a left click');
    assert.deepEqual(clicks, [[true, 1]], 'one item:click of the stock menu, not repeated by the bridge');
    cs.items[0].setDisabled(true);
    assert.equal(bridge.pick('Toolbar:btnColorSchemas', '0'), false, 'a disabled item');
    assert.equal(clicks.length, 1);

    /* A menu that does not respond to an item click gets the event from the bridge. */
    const bare = events({items: [item('Standard', {checkable: true, value: 0}), item('Wide', {checkable: true, value: 1})],
        rendered: true, options: {}});
    bare.items.forEach(it => { delete it.onItemClick; });
    toolbar.btnSlideSize = button({menu: bare});
    const sizes = [];
    bare.on('item:click', (m, it) => sizes.push([m === bare, it.value]));
    assert.equal(bridge.pick('Toolbar:btnSlideSize', '1'), true);
    assert.deepEqual(sizes, [[true, 1]], 'one item:click from the bridge');
    assert.equal(bare.items[1].checked, true);
    assert.equal(bridge.pick('Toolbar:btnSlideSize', '1'), true);
    assert.deepEqual(sizes, [[true, 1], [true, 1]], 'one item:click per pick');

    /* A plugin item is 'item:custom-click', like the stock Menu. */
    const custom = [], plainClicks = [];
    bare.items[0].isCustomItem = true;
    bare.on('item:custom-click', (m, it) => custom.push(it.value));
    bare.on('item:click', (m, it) => plainClicks.push(it.value));
    assert.equal(bridge.pick('Toolbar:btnSlideSize', '0'), true);
    assert.deepEqual(custom, [0]);
    assert.deepEqual(plainClicks, [], 'no item:click for a plugin item');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
