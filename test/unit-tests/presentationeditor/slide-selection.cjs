/* Run: node test/unit-tests/presentationeditor/slide-selection.cjs [path to SlideSelection.js]
 * The presentation shell selection classifier: the selection kind by the composition of the stock
 * asc_onFocusObject (nothing, text, shape, image, table, chart, line, text
 * input; text only when the engine's selected objects contain text: a placeholder with a
 * text body, a text box, a shape or group with non-empty text; a read failure keeps the former
 * rule), the vo:selection {kind, props} event and preparing the right panel fields: on every
 * asc_onFocusObject the "Shape", "Table" and "Image" tabs get ChangeSettings with the
 * object properties, even when the right panel is collapsed and the stock code does not touch them.
 *
 * The module is loaded in node via vm on top of a fake stock environment: the engine api,
 * the notification center, the RightMenu controller with lazy tabs (the fields appear on the
 * first ChangeSettings, like the stock ShapeSettings and TableSettings).
 * The optional argument is a corrupted copy of the module for a negative control:
 * a copy without ChangeSettings must fail change_settings_for_hidden_shape_tab, a copy
 * without reading text from the engine objects, text_kind_only_with_text_in_selection.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const FILE = process.argv[2] ? path.resolve(process.argv[2])
    : path.join(ROOT, 'apps/presentationeditor/main/app/view/SlideSelection.js');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

/* Selection element types are the engine's Asc.c_oAscTypeSelectElement values. */
const TYPE = {Paragraph: 0, Table: 1, Image: 2, Header: 3, Hyperlink: 4, SpellCheck: 5, Shape: 6, Slide: 7, Chart: 8, Math: 9};
/* Placeholder types are the engine's AscFormat.phType_* values. */
const PH = {phType_body: 0, phType_chart: 1, phType_clipArt: 2, phType_ctrTitle: 3, phType_dgm: 4, phType_dt: 5, phType_ftr: 6,
    phType_hdr: 7, phType_media: 8, phType_obj: 9, phType_pic: 10, phType_sldImg: 11, phType_sldNum: 12, phType_subTitle: 13,
    phType_tbl: 14, phType_title: 15};

/* Engine slide objects (CShape, CGroupShape): the fields the classifier reads.
   Reads are written to reads: the engine returns an empty paragraph as "\r\n". */
const reads = [];
function drawing(o) {
    const d = {txBody: o.text === undefined ? null : {}};
    d.isPlaceholder = () => { reads.push('isPlaceholder'); return o.ph !== undefined; };
    d.getPlaceholderType = () => { reads.push('getPlaceholderType'); return o.ph === undefined || o.ph === 'obj' ? null : o.ph; };
    d.isTextBox = () => { reads.push('isTextBox'); return !!o.box; };
    d.getDocContent = () => {
        reads.push('getDocContent');
        if (o.text === undefined) return null;
        return o.content || {GetText() { reads.push('GetText'); return o.text; }};
    };
    return d;
}
const group = (...kids) => ({spTree: kids});

/* An element value: getters of the stock object properties. */
function value(fields) {
    const v = {};
    Object.keys(fields || {}).forEach(k => { v[k] = () => fields[k]; });
    return v;
}
function el(type, fields) {
    const val = value(fields);
    return {get_ObjectType: () => TYPE[type], get_ObjectValue: () => val, value: val};
}
const shape = extra => el('Shape', Object.assign({asc_getType: 'rect', get_FromChart: false, get_FromImage: false, get_Fill: 'fill-of-shape'}, extra));

/* A lazy right panel tab: the fields are built on the first ChangeSettings. */
function lazyTab(name, log) {
    return {
        _initSettings: true,
        ChangeSettings(props) {
            log.push({tab: name, props});
            if (this._initSettings) {
                this._initSettings = false;
                this.btnBackColor = {color: null};
            }
            if (props && typeof props.get_Fill === 'function') this.btnBackColor.color = props.get_Fill();
        }
    };
}

function load(opts) {
    opts = opts || {};
    const log = [];
    const handlers = {};
    const nc = {
        events: [],
        on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
        off() {},
        trigger(ev, ...a) { this.events.push({ev, args: a}); (handlers[ev] || []).forEach(f => f(...a)); }
    };
    const callbacks = {};
    const engine = {textTarget: null, picked: null, inGroup: null, broken: false};
    const api = {
        asc_registerCallback(n, f) { (callbacks[n] = callbacks[n] || []).push(f); },
        WordControl: {m_oLogicDocument: {GetCurrentController: () => {
            if (engine.broken) throw new Error('engine failed');
            const c = {getTargetDocContent: () => engine.textTarget};
            if (engine.picked) c.selectedObjects = engine.picked;
            if (engine.inGroup) c.selection = {groupSelection: {selectedObjects: engine.inGroup}};
            return c;
        }}}
    };
    const rightmenu = {
        minimizedMode: true,
        shapeSettings: lazyTab('shape', log),
        tableSettings: lazyTab('table', log),
        imageSettings: lazyTab('image', log)
    };
    if (opts.throwing) rightmenu.shapeSettings.ChangeSettings = () => { throw new Error('stock tab failed'); };
    const warnings = [];
    const ctx = {
        _, console: {log() {}, warn: (...a) => warnings.push(a.join(' '))},
        Common: {NotificationCenter: nc},
        Asc: {c_oAscTypeSelectElement: TYPE}, AscFormat: PH,
        PE: {Views: {}, getController: n => (n === 'RightMenu' ? {rightmenu} : null)}
    };
    ctx.window = ctx;
    ctx.define = (deps, factory) => factory();
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(FILE, 'utf8'), ctx, {filename: FILE});
    const sel = ctx.PE.Views.SlideSelection;
    const shell = {
        right: opts.right !== false,
        onApi(n, f) { api.asc_registerCallback(n, f); },
        engineApi: () => api,
        editRight() { return this.right; }
    };
    sel.install(shell);
    const focus = list => (callbacks.asc_onFocusObject || []).forEach(f => f(list));
    return {sel, nc, log, api, engine, rightmenu, focus, shell, warnings, ctx, asked: []};
}

const SLIDE = () => el('Slide', {get_LayoutIndex: 0});
const PARA = () => el('Paragraph', {get_Locked: false});

const tests = [];
const test = (name, fn) => tests.push({name, fn});

test('kind_for_each_selection', () => {
    const env = load();
    assert.equal(env.sel.kind(), 'none', 'before any selection the kind is none');
    const cases = [
        ['none', [SLIDE()]],
        ['text', [SLIDE(), PARA(), shape({asc_getType: 'rect'})]],
        ['shape', [SLIDE(), shape({asc_getType: 'ellipse'})]],
        ['image', [SLIDE(), el('Image', {get_Locked: false})]],
        ['image', [SLIDE(), el('Image', {}), shape({get_FromImage: true})]],
        ['table', [SLIDE(), PARA(), el('Table', {get_Locked: false})]],
        ['chart', [SLIDE(), el('Chart', {get_Locked: false})]],
        ['line', [SLIDE(), shape({asc_getType: 'line'})]],
        ['line', [SLIDE(), shape({asc_getType: 'straightConnector1'})]],
        ['line', [SLIDE(), shape({asc_getType: 'bentConnector3'})]],
        ['none', []]
    ];
    for (const [kind, list] of cases) {
        env.focus(list);
        assert.equal(env.sel.kind(), kind, 'selection ' + list.map(x => Object.keys(TYPE).find(k => TYPE[k] === x.get_ObjectType())).join('+'));
        const last = env.nc.events.filter(e => e.ev === 'vo:selection').pop();
        assert.ok(last, 'no vo:selection after asc_onFocusObject');
        assert.equal(last.args[0].kind, kind, 'vo:selection carries a different kind');
        assert.equal(typeof last.args[0].props, 'object', 'vo:selection has no props');
    }
    env.focus([SLIDE(), el('Table', {})]);
    const props = env.sel.props();
    assert.ok(props.table && props.slide, 'props keep the stock values of the selected elements');
    const n = env.nc.events.filter(e => e.ev === 'vo:selection').length;
    assert.equal(n, cases.length + 1, 'one vo:selection per asc_onFocusObject');
});

test('typing_inside_shape_is_typing', () => {
    const env = load();
    const list = () => [SLIDE(), PARA(), shape({asc_getType: 'rect'})];
    env.focus(list());
    assert.equal(env.sel.kind(), 'text', 'a selected text box without a caret is text');
    env.engine.textTarget = {content: true};
    env.focus(list());
    assert.equal(env.sel.kind(), 'typing', 'a caret inside the text box is typing');
    env.focus([SLIDE(), PARA()]);
    assert.equal(env.sel.kind(), 'typing', 'a caret in the notes is typing');
    env.focus([SLIDE(), PARA(), el('Table', {})]);
    assert.equal(env.sel.kind(), 'table', 'a caret in a table cell keeps the table kind');
    env.focus([SLIDE(), shape({asc_getType: 'line'})]);
    assert.equal(env.sel.kind(), 'line', 'a line stays a line');
    env.engine.textTarget = null;
    env.api.WordControl = null;
    env.focus(list());
    assert.equal(env.sel.kind(), 'text', 'without the engine document the caret is unknown, the kind is text');
});

/* The engine sends paragraph properties for any shape and group that can hold text, even
   an empty one: the text kind only when the selected objects have text. */
test('text_kind_only_with_text_in_selection', () => {
    const env = load();
    const focus = () => { env.focus([SLIDE(), PARA(), shape({asc_getType: 'rect'})]); return env.sel.kind(); };
    const empty = () => drawing({text: '\r\n'});
    const cases = [
        ['shape', 'an illustration: a group of empty shapes', [group(empty(), group(empty(), drawing({text: ' \r\n'})), drawing({}))]],
        ['shape', 'an empty shape', [empty()]],
        ['text', 'a shape with text', [drawing({text: 'Plan\r\n'})]],
        ['text', 'a group with a text box deep inside', [group(empty(), group(empty(), drawing({text: 'Presentation\r\n'})))]],
        ['text', 'an empty title placeholder', [drawing({ph: PH.phType_title, text: '\r\n'})]],
        ['text', 'an empty content placeholder', [drawing({ph: 'obj', text: ''})]],
        ['shape', 'an empty picture placeholder', [drawing({ph: PH.phType_pic, text: '\r\n'})]],
        ['shape', 'an empty table placeholder', [drawing({ph: PH.phType_tbl, text: '\r\n'})]],
        ['text', 'an empty text box', [drawing({box: true, text: '\r\n'})]],
        ['text', 'an empty shape and a text box', [empty(), drawing({box: true, text: 'Logo\r\n'})]]
    ];
    for (const [kind, what, picked] of cases) {
        env.engine.picked = picked;
        assert.equal(focus(), kind, what);
        const last = env.nc.events.filter(e => e.ev === 'vo:selection').pop();
        assert.equal(last.args[0].kind, kind, what + ': vo:selection carries a different kind');
    }

    /* Inside a group, its selected parts rather than the whole group. */
    env.engine.picked = [group(empty(), drawing({text: 'Title\r\n'}))];
    env.engine.inGroup = [empty()];
    assert.equal(focus(), 'shape', 'an empty shape picked inside a group with text');
    env.engine.inGroup = [drawing({text: 'Title\r\n'})];
    assert.equal(focus(), 'text', 'a text shape picked inside a group');
    env.engine.inGroup = [];
    env.engine.picked = [group(empty(), empty())];
    assert.equal(focus(), 'shape', 'an empty group with nothing picked inside');
    env.engine.inGroup = null;

    /* A shape without text: the right panel "Shape" tab is fed as before. */
    const fed = env.log.filter(c => c.tab === 'shape').length;
    focus();
    assert.equal(env.log.filter(c => c.tab === 'shape').length, fed + 1, 'the shape tab is not fed for a shape without text');

    /* Text input, line, image, table: the text is not read. */
    env.engine.picked = [empty()];
    reads.length = 0;
    env.engine.textTarget = {content: true};
    assert.equal(focus(), 'typing', 'a caret in an empty shape is typing');
    env.engine.textTarget = null;
    env.focus([SLIDE(), shape({asc_getType: 'line'})]);
    env.focus([SLIDE(), el('Image', {})]);
    env.focus([SLIDE(), PARA(), el('Table', {})]);
    assert.deepEqual(reads, [], 'the engine objects are read when the kind does not depend on text');
});

test('text_read_failure_keeps_stock_rule', () => {
    const env = load();
    const focus = () => { env.focus([SLIDE(), PARA(), shape({asc_getType: 'rect'})]); return env.sel.kind(); };
    assert.equal(focus(), 'text', 'no selected objects in the engine: a shape with a paragraph is text');
    env.engine.picked = [];
    assert.equal(focus(), 'text', 'an empty list of selected objects: a shape with a paragraph is text');
    env.engine.picked = [drawing({text: '\r\n', content: {}})];
    assert.equal(focus(), 'text', 'a document content without GetText: a shape with a paragraph is text');
    env.engine.picked = [drawing({text: '\r\n', content: {GetText() { throw new Error('read failed'); }}})];
    assert.equal(focus(), 'text', 'a failing GetText: a shape with a paragraph is text');
    env.engine.broken = true;
    assert.equal(focus(), 'text', 'a failing controller: a shape with a paragraph is text');
    env.engine.broken = false;
    env.api.WordControl = null;
    assert.equal(focus(), 'text', 'no engine document: a shape with a paragraph is text');
    env.focus([SLIDE(), shape({asc_getType: 'rect'})]);
    assert.equal(env.sel.kind(), 'shape', 'a shape without paragraph props is a shape');
});

test('text_read_has_no_side_effects', () => {
    const env = load();
    /* Engine objects are read-only: any call other than a read is a failure. */
    const READS = ['isPlaceholder', 'getPlaceholderType', 'isTextBox', 'getDocContent', 'GetText'];
    const calls = [];
    /* An array (spTree) is returned as a copy from the guarded objects. */
    const wrap = v => Array.isArray(v) ? v.map(wrap) : v && typeof v === 'object' ? guard(v) : v;
    const guard = o => new Proxy(o, {
        get(t, k) {
            const v = t[k];
            if (typeof v !== 'function') return wrap(v);
            return (...a) => { calls.push(String(k)); return wrap(v.apply(t, a)); };
        },
        set(t, k) { calls.push('set ' + String(k)); return true; },
        deleteProperty(t, k) { calls.push('delete ' + String(k)); return true; }
    });
    env.engine.picked = [guard(group(drawing({text: '\r\n'}), group(drawing({ph: PH.phType_pic, text: ''}), drawing({text: 'Plan\r\n'}))))];
    env.focus([SLIDE(), PARA(), shape({asc_getType: 'rect'})]);
    assert.equal(env.sel.kind(), 'text', 'the guarded group with text is not text');
    assert.ok(calls.includes('GetText'), 'the text is not read');
    assert.deepEqual(calls.filter(c => !READS.includes(c)), [], 'the classifier changes the engine objects');
});

test('chart_is_not_shape', () => {
    const env = load();
    env.focus([SLIDE(), el('Chart', {}), shape({get_FromChart: true, asc_getType: 'rect'})]);
    assert.equal(env.sel.kind(), 'chart', 'a chart with the shape props of its frame is a chart');
    env.focus([SLIDE(), shape({get_FromChart: true})]);
    assert.equal(env.sel.kind(), 'chart', 'the shape props of a chart frame alone are a chart');
    env.focus([SLIDE(), PARA(), shape({get_FromChart: true})]);
    assert.equal(env.sel.kind(), 'chart', 'a chart title being edited is still a chart');
});

test('change_settings_for_hidden_shape_tab', () => {
    const env = load();
    assert.ok(env.rightmenu.minimizedMode, 'the right panel is collapsed in this test');
    const seen = [];
    env.nc.on('vo:selection', () => seen.push(env.rightmenu.shapeSettings.btnBackColor ? env.rightmenu.shapeSettings.btnBackColor.color : null));
    const sh = shape({asc_getType: 'rect'});
    env.focus([SLIDE(), sh]);
    const calls = env.log.filter(c => c.tab === 'shape');
    assert.equal(calls.length, 1, 'ShapeSettings.ChangeSettings is not called once on asc_onFocusObject');
    assert.equal(calls[0].props, sh.value, 'ShapeSettings got not the props of the selected shape');
    assert.ok(env.rightmenu.shapeSettings.btnBackColor, 'the fields of the shape tab are not built with the panel collapsed');
    assert.equal(env.rightmenu.shapeSettings.btnBackColor.color, 'fill-of-shape', 'the fill field is empty with the panel collapsed');
    assert.deepEqual(seen, ['fill-of-shape'], 'vo:selection came before the shape tab got its props');
    env.focus([SLIDE()]);
    assert.equal(env.log.filter(c => c.tab === 'shape').length, 1, 'ShapeSettings is fed without a shape selected');
    const img = el('Image', {get_Fill: 'image'});
    env.focus([SLIDE(), img]);
    assert.ok(env.log.some(c => c.tab === 'image' && c.props === img.value), 'ImageSettings got not the props of the selected image');

    const reader = load({right: false});
    reader.focus([SLIDE(), shape()]);
    assert.deepEqual(reader.log, [], 'the tabs are fed without the edit right');
    assert.equal(reader.sel.kind(), 'shape', 'without the edit right the kind is still known');

    const broken = load({throwing: true});
    broken.focus([SLIDE(), shape()]);
    assert.equal(broken.nc.events.filter(e => e.ev === 'vo:selection').length, 1, 'a failing stock tab stops vo:selection');
    assert.equal(broken.sel.kind(), 'shape', 'a failing stock tab breaks the classification');
    broken.focus([SLIDE(), shape()]);
    assert.equal(broken.warnings.length, 1, 'a failing stock tab is reported more than once');
});

test('change_settings_for_hidden_table_tab', () => {
    const env = load();
    const tbl = el('Table', {get_Fill: 'fill-of-table'});
    env.focus([SLIDE(), PARA(), tbl]);
    const calls = env.log.filter(c => c.tab === 'table');
    assert.equal(calls.length, 1, 'TableSettings.ChangeSettings is not called once on asc_onFocusObject');
    assert.equal(calls[0].props, tbl.value, 'TableSettings got not the props of the selected table');
    assert.equal(env.rightmenu.tableSettings.btnBackColor.color, 'fill-of-table', 'the table fields are empty with the panel collapsed');
    assert.equal(env.log.filter(c => c.tab === 'shape').length, 0, 'a table selection fed the shape tab');
});

/* With the properties card closed, a tab is fed only if the row shows its controls for the
   selection (CompactToolbar.usesTab); with the card open — always (the card feeds the shown tab
   itself on opening, SlideSections.showStock). */
test('closed_card_feeds_only_the_tabs_the_toolbar_uses', () => {
    const env = load();
    const card = {open: false};
    const uses = {shapeSettings: false, tableSettings: true, imageSettings: false};
    const views = env.ctx.PE.Views;
    views.SlideSections = {isOpen: () => card.open};
    views.CompactToolbar = {usesTab: (tab, kind) => { env.asked.push(tab + ':' + kind); return uses[tab]; }};
    const sh = shape();
    env.focus([SLIDE(), sh]);
    assert.equal(env.log.filter(c => c.tab === 'shape').length, 0, 'the shape tab is fed with the card closed and no toolbar control');
    assert.ok(env.asked.includes('shapeSettings:shape'), 'the toolbar is not asked by the kind of the selection: ' + env.asked);
    const tbl = el('Table', {get_Fill: 'fill-of-table'});
    env.focus([SLIDE(), PARA(), tbl]);
    assert.equal(env.log.filter(c => c.tab === 'table').length, 1, 'a tab the toolbar uses is not fed');
    card.open = true;
    env.focus([SLIDE(), sh]);
    assert.equal(env.log.filter(c => c.tab === 'shape').length, 1, 'the open card does not get the shape props');
    card.open = false;
    env.log.length = 0;
    env.focus([SLIDE(), sh]);
    assert.equal(env.log.length, 0, 'fed again with the card closed');
});

test('no_tab_feeding_in_standard_interface', () => {
    /* "Stock interface": the right panel is fed by the stock RightMenu.onFocusObject itself. */
    const env = load();
    env.shell.advanced = true;
    const sh = shape({asc_getType: 'rect', get_Fill: 'fill-in-standard'});
    env.focus([SLIDE(), sh]);
    assert.deepEqual(env.log, [], 'the tabs are fed in the standard interface');
    assert.equal(env.sel.kind(), 'shape', 'in the standard interface the kind is still known');
    assert.equal(env.nc.events.filter(e => e.ev === 'vo:selection').length, 1, 'no vo:selection in the standard interface');

    /* Returning to the shell: the tabs get the properties of the current selection. */
    env.shell.advanced = false;
    env.nc.trigger('shell:advanced', false);
    const back = env.log.filter(c => c.tab === 'shape');
    assert.equal(back.length, 1, 'the shape tab is not fed on the way back from the standard interface');
    assert.equal(back[0].props, sh.value, 'the shape tab got not the props of the current selection');
    env.nc.trigger('shell:advanced', true);
    assert.equal(env.log.length, 1, 'the tabs are fed on the way into the standard interface');

    /* The shell was not built: a stock editor, nothing to feed. */
    const failed = load();
    failed.shell.startupFailed = true;
    failed.focus([SLIDE(), shape()]);
    assert.deepEqual(failed.log, [], 'the tabs are fed after a failed shell start');
});

let failed = 0;
for (const t of tests) {
    try {
        t.fn();
        console.log('ok ' + t.name);
    } catch (e) {
        failed++;
        console.log('FAIL ' + t.name + ': ' + (e && e.message ? e.message.split('\n')[0] : e));
    }
}
process.exitCode = failed ? 1 : 0;
