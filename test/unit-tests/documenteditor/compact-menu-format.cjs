/* Run: node test/unit-tests/documenteditor/compact-menu-format.cjs
 * Format section of the compact menu of the document editor (DocumentActions.sections): text, case,
 * paragraph styles, alignment and spacing marked by the selection; lists, the table and the selected
 * object; orientation, page size, margins and columns of the section under the cursor; text direction
 * and clearing the formatting.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs; the engine
 * reports the selection through the callbacks it sends and the calls the items ask. The page size
 * check is the stock one of the toolbar controller (controller/Toolbar.js), loaded in vm as it is.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const TOOLBAR = path.join(ROOT, 'apps/documenteditor/main/app/controller/Toolbar.js');
const AIR_DIR = path.join(ROOT, 'apps/common/main/resources/img/air');
const docs = require('../common/compact/lib/documents-editor.cjs');

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const actions = G.DE.Views.DocumentActions;
const command = k => actions.command(k);
const plain = value => JSON.parse(JSON.stringify(value));
const calls = (ctx, name) => ctx.log.filter(e => e.api === name).map(e => e.args);
const rows = (items, ctx) => plain(Model.section(items, ctx).rows.map(r => (r.kind === 'sep' ? '—' : r.k)));
const exec = (ctx, k) => docs.adapter(ctx).exec(command(k));
/* The checked rows of a submenu in the state. */
const marked = (k, ctx) => plain(Model.section(command(k).items, ctx).rows.filter(r => r.checked).map(r => r.k));

/* Engine values the items read (sdkjs common/commonDefines.js, word/apiDefines.js). */
Object.assign(G.Asc, {
    vertalign_Baseline: 0, vertalign_SubScript: 1, vertalign_SuperScript: 2,
    linerule_Auto: 1,
    c_oAscTypeSelectElement: {Paragraph: 0, Table: 1, Image: 2, Header: 3},
    c_oAscPageOrientation: {PagePortrait: 0, PageLandscape: 1},
    c_oAscNumberingFormat: {Bullet: 5, Decimal: 13, None: 48},
    c_oAscWrapStyle2: {Inline: 0, Square: 1, Tight: 2, Through: 3, TopAndBottom: 4, Behind: 5, InFront: 6},
    c_oAscChangeLevel: {BringToFront: 0, BringForward: 1, SendToBack: 2, BringBackward: 3},
    c_oAscRelativeFromH: {Column: 1}, c_oAscRelativeFromV: {Paragraph: 2}
});
/* Property objects of the engine: what is put is kept by name. */
function Props() {
    return new Proxy({}, {get(t, name) {
        if (typeof name !== 'string') return undefined;
        if (/^put_/.test(name)) return v => { t[name.slice(4)] = v; };
        if (/^get_/.test(name)) return () => t[name.slice(4)];
        return t[name];
    }});
}
G.Asc.CDocumentSectionProps = Props;
G.Asc.CDocumentColumnsProps = Props;
G.Asc.asc_CImgProperty = Props;
G.Asc.CImagePositionH = Props;
G.Asc.CImagePositionV = Props;

/* Section under the cursor as asc_GetSectionProps gives it: A4 portrait with the normal margins. */
function section(over) {
    const s = Object.assign({W: 210, H: 297, Orient: 0, Left: 30, Top: 20, Right: 15, Bottom: 20, Gutter: 0,
        GutterAtTop: false}, over || {});
    return {
        get_W: () => s.W, get_H: () => s.H, get_Orientation: () => s.Orient,
        get_LeftMargin: () => s.Left, get_TopMargin: () => s.Top, get_RightMargin: () => s.Right,
        get_BottomMargin: () => s.Bottom, get_Gutter: () => s.Gutter, get_GutterAtTop: () => s.GutterAtTop
    };
}
/* An element of getSelectedElements. */
const element = (type, value) => ({get_ObjectType: () => G.Asc.c_oAscTypeSelectElement[type], get_ObjectValue: () => value});

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* Runs fn with a stock controller of the editor given by name. */
function withController(name, ctl, fn) {
    const getController = G.DE.getController;
    G.DE.getController = n => (n === name ? ctl : getController(n));
    try { return fn(); } finally { G.DE.getController = getController; }
}

/* A window class of the editor stood in: each window records its options and its settings. */
function withWindow(name, fn) {
    const windows = [];
    G.DE.Views[name] = function (options) {
        const win = {options, settings: undefined};
        windows.push(win);
        this.show = () => {};
        this.setSettings = value => { win.settings = value; };
    };
    try { return fn(windows); } finally { delete G.DE.Views[name]; }
}

/* Texts of the stock toolbar controller as the English locale gives them: the warning of the page
   size check has no default in the code. */
const TOOLBAR_TEXTS = (() => {
    const locale = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/documenteditor/main/locale/en.json'), 'utf8'));
    const prefix = 'DE.Controllers.Toolbar.', out = {};
    for (const [key, value] of Object.entries(locale)) if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
    return out;
})();

/* The stock toolbar controller with its page size check, the warning it shows recorded. */
function stockToolbar(api) {
    const warnings = [];
    const context = {
        _: {extend: Object.assign},
        Backbone: {Controller: {extend: proto => proto}},
        Common: {UI: {warning: options => warnings.push(options)}, NotificationCenter: {trigger() {}}},
        define: (deps, factory) => factory()
    };
    context.DE = {Controllers: {Toolbar: Object.assign({}, TOOLBAR_TEXTS)}};
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(TOOLBAR, 'utf8'), context, {filename: TOOLBAR});
    const ctl = Object.create(context.DE.Controllers.Toolbar);
    ctl.api = api;
    return {ctl, warnings};
}

/* --- Text, paragraph, page and section ---------------------------------------------------------- */

check('format section has its items, shortcuts and icons', () => {
    const ctx = docs.context();
    const format = docs.sections().find(s => s.k === 'format');
    assert.deepEqual(rows(format.items, ctx), ['format.text', 'format.case', 'format.style', 'format.align',
        'format.spacing', 'format.lists', '—', 'format.table', 'format.image', '—', 'format.orientation',
        'format.pageSize', 'format.margins', 'format.columns', 'format.watermark', 'format.hyphenation',
        'format.direction', '—', 'format.clear']);
    assert.deepEqual(rows(command('format.text').items, ctx), ['format.text.bold', 'format.text.italic',
        'format.text.underline', 'format.text.strikeout', 'format.text.superscript', 'format.text.subscript']);
    assert.deepEqual(rows(command('format.case').items, ctx), ['format.case.sentence', 'format.case.lower',
        'format.case.upper', 'format.case.words', 'format.case.toggle']);
    assert.deepEqual(rows(command('format.spacing').items, ctx), ['format.spacing.100', 'format.spacing.115',
        'format.spacing.150', 'format.spacing.200', 'format.spacing.250', 'format.spacing.300', '—',
        'format.spacing.before', 'format.spacing.after', '—', 'format.spacing.more']);
    assert.deepEqual(rows(command('format.pageSize').items, ctx), ['format.pageSize.a4', 'format.pageSize.a5',
        'format.pageSize.letter', 'format.pageSize.legal', '—', 'format.pageSize.custom']);
    assert.deepEqual(rows(command('format.margins').items, ctx), ['format.margins.normal', 'format.margins.narrow',
        'format.margins.moderate', 'format.margins.wide', '—', 'format.margins.custom']);
    assert.deepEqual(rows(command('format.columns').items, ctx), ['format.columns.1', 'format.columns.2',
        'format.columns.3', '—', 'format.columns.custom']);
    /* Shortcuts the editor already has: bold, italic, underline and the four alignments. */
    assert.deepEqual(['format.text.bold', 'format.text.italic', 'format.text.underline', 'format.align.left',
        'format.align.center', 'format.align.right', 'format.align.justify'].map(k => command(k).sc),
        ['Bold', 'Italic', 'Underline', 'LeftPara', 'CenterPara', 'RightPara', 'JustifyPara']);
    /* Every item of the section is greyed with the common reason of editing. */
    const view = docs.context({reasons: ['view']});
    for (const r of Model.section(format.items, view).rows)
        if (r.kind !== 'sep') assert.equal(r.reason, 'view', r.k + ' in view');
    /* The icons of the section come through helpers, out of sight of the icon probe of the shell
       (icons-air.cjs reads `i: '<name>'`): each one asked is a file of the shared AIR set. */
    const air = new Set(fs.readdirSync(AIR_DIR).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4)));
    const icons = [];
    (function walk(items) {
        for (const it of items) {
            if (!it || it.sep) continue;
            if (it.i !== undefined) icons.push([it.k, it.i]);
            if (it.items) walk(it.items);
        }
    })(format.items);
    assert.ok(icons.length > 40, 'icons asked: ' + icons.length);
    assert.deepEqual(icons.filter(([, i]) => !air.has(i)).map(([k, i]) => k + ': ' + i), [], 'icons without an AIR file');
});

check('text toggles follow the selection', () => {
    const ctx = docs.context();
    assert.deepEqual(marked('format.text', ctx), [], 'nothing is marked before the engine reports');
    ctx.fire('asc_onBold', true);
    ctx.fire('asc_onUnderline', true);
    ctx.fire('asc_onVerticalAlign', G.Asc.vertalign_SuperScript);
    assert.deepEqual(marked('format.text', ctx), ['format.text.bold', 'format.text.underline', 'format.text.superscript']);
    /* A toggle sends the opposite of what the selection has. */
    assert.equal(exec(ctx, 'format.text.bold'), true);
    assert.equal(exec(ctx, 'format.text.italic'), true);
    assert.equal(exec(ctx, 'format.text.superscript'), true);
    assert.equal(exec(ctx, 'format.text.subscript'), true);
    assert.deepEqual(plain(calls(ctx, 'put_TextPrBold')), [[false]]);
    assert.deepEqual(plain(calls(ctx, 'put_TextPrItalic')), [[true]]);
    assert.deepEqual(plain(calls(ctx, 'put_TextPrBaseline')),
        [[G.Asc.vertalign_Baseline], [G.Asc.vertalign_SubScript]]);
    /* The next selection. */
    ctx.fire('asc_onBold', false);
    ctx.fire('asc_onStrikeout', true);
    ctx.fire('asc_onVerticalAlign', G.Asc.vertalign_SubScript);
    assert.deepEqual(marked('format.text', ctx), ['format.text.underline', 'format.text.strikeout', 'format.text.subscript']);
    /* Case items keep their engine command in the new submenu. */
    assert.equal(exec(ctx, 'format.case.upper'), true);
    assert.deepEqual(plain(calls(ctx, 'asc_ChangeTextCase')), [[G.Asc.c_oAscChangeTextCaseType.UpperCase]]);
});

check('paragraph style marks the current style', () => {
    const ctx = docs.context();
    ctx.fire('asc_onParaStyleName', 'Heading 2');
    assert.deepEqual(marked('format.style', ctx), ['format.style.heading2']);
    ctx.fire('asc_onParaStyleName', 'Quote');
    assert.deepEqual(marked('format.style', ctx), [], 'a style out of the list marks nothing');
    assert.equal(exec(ctx, 'format.style.heading1'), true);
    assert.equal(exec(ctx, 'format.style.normal'), true);
    assert.deepEqual(plain(calls(ctx, 'put_Style')), [['Heading 1'], ['Normal']]);
});

check('alignment marks the current value', () => {
    const ctx = docs.context({engine: {asc_isRtlTextDirection: () => false}});
    ctx.fire('asc_onPrAlign', 2);
    assert.deepEqual(marked('format.align', ctx), ['format.align.center']);
    ctx.fire('asc_onPrAlign', 1);
    assert.deepEqual(marked('format.align', ctx), ['format.align.left']);
    ctx.fire('asc_onPrAlign', null);
    assert.deepEqual(marked('format.align', ctx), [], 'mixed alignment marks nothing');
    assert.equal(exec(ctx, 'format.align.justify'), true);
    assert.equal(exec(ctx, 'format.align.right'), true);
    assert.deepEqual(plain(calls(ctx, 'put_PrAlign')), [[3], [0]]);
    /* A right-to-left paragraph shows its left alignment at the right, as the toolbar marks it. */
    const rtl = docs.context({engine: {asc_isRtlTextDirection: () => true}});
    rtl.fire('asc_onPrAlign', 1);
    assert.deepEqual(marked('format.align', rtl), ['format.align.right']);
});

check('spacing marks the current value', () => {
    const ctx = docs.context();
    const spacing = (line, rule) => ({get_Line: () => line, get_LineRule: () => rule});
    ctx.fire('asc_onParaSpacingLine', spacing(1.1500000000000001, 1));
    assert.deepEqual(marked('format.spacing', ctx), ['format.spacing.115']);
    ctx.fire('asc_onParaSpacingLine', spacing(2, 1));
    assert.deepEqual(marked('format.spacing', ctx), ['format.spacing.200']);
    ctx.fire('asc_onParaSpacingLine', spacing(18, 2));
    assert.deepEqual(marked('format.spacing', ctx), [], 'an exact line height is none of the multiples');
    assert.equal(exec(ctx, 'format.spacing.150'), true);
    assert.deepEqual(plain(calls(ctx, 'put_PrLineSpacing')), [[1, 1.5]]);
    assert.deepEqual(['format.spacing.100', 'format.spacing.115', 'format.spacing.300'].map(k => command(k).t),
        ['1.0', '1.15', '3.0']);
    /* Other spacing and indents: the stock paragraph window over the paragraph under the cursor. */
    const para = {kind: 'paragraph'};
    const sel = docs.context({engine: {getSelectedElements: () => [element('Paragraph', para)]}});
    withWindow('ParagraphSettingsAdvanced', windows => {
        assert.equal(exec(sel, 'format.spacing.more'), true);
        assert.equal(windows.length, 1);
        assert.equal(windows[0].options.paragraphProps, para);
        windows[0].options.handler('cancel');
        assert.deepEqual(calls(sel, 'paraApply'), []);
        windows[0].options.handler('ok', {paragraphProps: 'changed'});
        assert.deepEqual(plain(calls(sel, 'paraApply')), [['changed']]);
    });
});

check('spacing before toggles its label', () => {
    let before = false, after = true;
    const ctx = docs.context({engine: {
        asc_haveSpaceBeforeParagraph: () => before, asc_haveSpaceAfterParagraph: () => after
    }});
    const label = k => Model.state(command(k), ctx).label;
    assert.equal(label('format.spacing.before'), 'Add space before paragraph');
    assert.equal(label('format.spacing.after'), 'Remove space after paragraph');
    assert.equal(exec(ctx, 'format.spacing.before'), true);
    assert.equal(exec(ctx, 'format.spacing.after'), true);
    assert.deepEqual(plain(calls(ctx, 'asc_addSpaceBeforeParagraph')), [[]]);
    assert.deepEqual(plain(calls(ctx, 'asc_removeSpaceAfterParagraph')), [[]]);
    before = true;
    after = false;
    assert.equal(label('format.spacing.before'), 'Remove space before paragraph');
    assert.equal(label('format.spacing.after'), 'Add space after paragraph');
    assert.equal(exec(ctx, 'format.spacing.before'), true);
    assert.deepEqual(plain(calls(ctx, 'asc_removeSpaceBeforeParagraph')), [[]]);
});

check('clear formatting is greyed with the no-text-selected reason', () => {
    const none = docs.context({engine: {asc_GetSelectedText: () => ''}});
    const st = Model.state(command('format.clear'), none);
    assert.equal(st.disabled, true);
    assert.equal(st.reason, 'noSelection');
    assert.equal(docs.reasonText(st.reason), 'No text selected');
    assert.equal(exec(none, 'format.clear'), false, 'a greyed item does not run');
    assert.deepEqual(calls(none, 'ClearFormating'), []);
    const some = docs.context({engine: {asc_GetSelectedText: () => 'bold words'}});
    assert.equal(Model.state(command('format.clear'), some).disabled, false);
    assert.equal(exec(some, 'format.clear'), true);
    assert.deepEqual(plain(calls(some, 'ClearFormating')), [[]]);
    const view = docs.context({reasons: ['view'], engine: {asc_GetSelectedText: () => ''}});
    assert.equal(Model.state(command('format.clear'), view).reason, 'view', 'a common reason outranks the own one');
});

check('orientation and columns mark the current value', () => {
    let props = section();
    let columns = {get_EqualWidth: () => true, get_Num: () => 2, get_Space: () => 12.5};
    const ctx = docs.context({engine: {asc_GetSectionProps: () => props, asc_GetColumnsProps: () => columns}});
    assert.deepEqual(marked('format.orientation', ctx), ['format.orientation.portrait']);
    assert.deepEqual(marked('format.columns', ctx), ['format.columns.2']);
    props = section({W: 297, H: 210, Orient: 1});
    columns = {get_EqualWidth: () => false, get_Num: () => 2, get_Space: () => 12.5};
    assert.deepEqual(marked('format.orientation', ctx), ['format.orientation.landscape']);
    assert.deepEqual(marked('format.columns', ctx), [], 'unequal columns are none of the presets');
    columns = {get_EqualWidth: () => true, get_Num: () => 3, get_Space: () => 20};
    assert.deepEqual(marked('format.columns', ctx), [], 'another gap is none of the presets');
    assert.equal(exec(ctx, 'format.orientation.portrait'), true);
    assert.deepEqual(plain(calls(ctx, 'change_PageOrient')), [[true]]);
    assert.equal(exec(ctx, 'format.columns.3'), true);
    const set = calls(ctx, 'asc_SetColumnsProps');
    assert.equal(set.length, 1);
    assert.deepEqual([set[0][0].EqualWidth, set[0][0].Num, set[0][0].Space], [true, 3, 12.5]);
});

check('page size marks the matching preset', () => {
    let props = section();
    const ctx = docs.context({engine: {asc_GetSectionProps: () => props}});
    assert.deepEqual(marked('format.pageSize', ctx), ['format.pageSize.a4']);
    props = section({W: 355.6, H: 215.9, Orient: 1});
    assert.deepEqual(marked('format.pageSize', ctx), ['format.pageSize.legal'], 'a landscape page matches too');
    props = section({W: 200, H: 200});
    assert.deepEqual(marked('format.pageSize', ctx), [], 'another size marks nothing');
    props = section();
    withController('Toolbar', stockToolbar(ctx.api).ctl, () => {
        assert.equal(exec(ctx, 'format.pageSize.letter'), true);
    });
    assert.deepEqual(plain(calls(ctx, 'change_DocSize')), [[215.9, 279.4]], 'a size that fits is applied at once');
    /* Another size: the stock window, with the same check of what is entered. */
    const tb = stockToolbar(ctx.api);
    withController('Toolbar', tb.ctl, () => withWindow('PageSizeDialog', windows => {
        assert.equal(exec(ctx, 'format.pageSize.custom'), true);
        assert.equal(windows.length, 1);
        assert.equal(typeof windows[0].options.checkPageSize, 'function');
        assert.equal(windows[0].settings.get_W(), 210, 'the window gets the current section');
    }));
});

check('margins preset applies at once', () => {
    const props = section();
    const ctx = docs.context({engine: {asc_GetSectionProps: () => props}});
    assert.deepEqual(marked('format.margins', ctx), ['format.margins.normal']);
    withController('Toolbar', stockToolbar(ctx.api).ctl, () => {
        assert.equal(exec(ctx, 'format.margins.narrow'), true);
    });
    const set = calls(ctx, 'asc_SetSectionProps');
    assert.equal(set.length, 1);
    const m = set[0][0];
    assert.deepEqual([m.TopMargin, m.LeftMargin, m.BottomMargin, m.RightMargin], [12.7, 12.7, 12.7, 12.7]);
    assert.ok(ctx.log.some(e => e.event === 'edit:complete'));
    /* Normal margins follow the region of the editor, as the toolbar presets do. */
    const settings = G.Common.Utils.InternalSettings;
    const get = settings.get;
    settings.get = name => (name === 'de-config-region' ? 'US' : get(name));
    try {
        const us = docs.context({engine: {asc_GetSectionProps: () => section({Left: 25.4, Top: 25.4, Right: 25.4, Bottom: 25.4})}});
        assert.deepEqual(marked('format.margins', us), ['format.margins.normal']);
    } finally {
        settings.get = get;
    }
});

check('oversized preset keeps the section and warns', () => {
    /* A narrow page: the wide margins leave no room for the text. */
    const ctx = docs.context({engine: {asc_GetSectionProps: () => section({W: 110, H: 297})}});
    const tb = stockToolbar(ctx.api);
    withController('Toolbar', tb.ctl, () => {
        assert.equal(exec(ctx, 'format.margins.wide'), true);
    });
    assert.deepEqual(calls(ctx, 'asc_SetSectionProps'), [], 'the section keeps its margins');
    assert.equal(tb.warnings.length, 1, 'the stock warning is shown');
    assert.equal(tb.warnings[0].msg, TOOLBAR_TEXTS.txtMarginsW);
    /* Wide margins on a smaller page. */
    const wide = docs.context({engine: {asc_GetSectionProps: () => section({Left: 70, Right: 70})}});
    const tb2 = stockToolbar(wide.api);
    withController('Toolbar', tb2.ctl, () => {
        assert.equal(exec(wide, 'format.pageSize.a5'), true);
    });
    assert.deepEqual(calls(wide, 'change_DocSize'), [], 'the page keeps its size');
    assert.equal(tb2.warnings.length, 1);
});

check('custom margins opens the dialog with current values', () => {
    const props = section({Left: 22});
    const ctx = docs.context({engine: {asc_GetSectionProps: () => props}});
    withWindow('PageMarginsDialog', windows => {
        assert.equal(exec(ctx, 'format.margins.custom'), true);
        assert.equal(windows.length, 1);
        assert.equal(windows[0].settings, props, 'the window gets the section under the cursor');
        const chosen = {chosen: true};
        windows[0].options.handler({getSettings: () => chosen}, 'ok');
        assert.deepEqual(calls(ctx, 'asc_SetSectionProps').map(a => a[0]), [chosen]);
        assert.ok(ctx.log.some(e => e.event === 'margins:update'));
    });
});

check('text direction marks the current paragraph', () => {
    let rtl = false;
    const ctx = docs.context({engine: {asc_isRtlTextDirection: () => rtl}});
    assert.deepEqual(marked('format.direction', ctx), ['format.direction.ltr']);
    rtl = true;
    assert.deepEqual(marked('format.direction', ctx), ['format.direction.rtl']);
    assert.equal(exec(ctx, 'format.direction.ltr'), true);
    assert.deepEqual(plain(calls(ctx, 'asc_setRtlTextDirection')), [[false]]);
    const unknown = docs.context({missing: ['asc_isRtlTextDirection']});
    assert.deepEqual(marked('format.direction', unknown), [], 'without the engine answer nothing is marked');
});

/* --- Lists, table, image ---------------------------------------------------------------------- */

/* The engine with a list under the cursor: format of the level and the matching preset. */
function listEngine(state) {
    return {
        asc_GetCurrentNumberingId: () => (state.format === undefined ? null : 7),
        asc_GetCurrentNumberingLvl: () => 0,
        asc_GetNumberingPr: () => ({get_Lvl: () => ({get_Format: () => state.format})}),
        asc_IsCurrentNumberingPreset: (json, single) =>
            !!state.preset && json === actions.NUMBERING[state.preset].json && single === actions.NUMBERING[state.preset].single
    };
}

check('choosing the marked list type removes the list', () => {
    const F = G.Asc.c_oAscNumberingFormat;
    const state = {format: F.Bullet};
    const ctx = docs.context({engine: listEngine(state)});
    assert.deepEqual(rows(command('format.lists').items, ctx), ['format.lists.bullet', 'format.lists.numbered',
        'format.lists.multilevel', '—', 'format.numbering', 'format.numbering.decimal', 'format.numbering.decimalParen',
        'format.numbering.letterParen', 'format.numbering.roman', 'format.numbering.outline',
        'format.numbering.outlineParen', '—', 'format.lists.indentIn', 'format.lists.indentOut', '—',
        'format.lists.settings']);
    assert.equal(Model.kindOf(command('format.numbering')), 'group');
    assert.deepEqual(marked('format.lists', ctx), ['format.lists.bullet']);
    assert.equal(exec(ctx, 'format.lists.bullet'), true);
    assert.equal(exec(ctx, 'format.lists.numbered'), true);
    assert.deepEqual(plain(calls(ctx, 'put_ListType')), [[0, -1], [1, 0]], 'the marked type removes the list');
    state.format = F.Decimal;
    state.preset = 'outlineParen';
    assert.deepEqual(marked('format.lists', ctx), ['format.lists.multilevel', 'format.numbering.outlineParen']);
    assert.equal(exec(ctx, 'format.lists.multilevel'), true);
    state.format = undefined;
    state.preset = null;
    assert.deepEqual(marked('format.lists', ctx), []);
    assert.equal(exec(ctx, 'format.lists.multilevel'), true);
    assert.deepEqual(plain(calls(ctx, 'put_ListType')).slice(2), [[2, -1], [2, 1]]);
});

check('numbering format marks the current list', () => {
    const F = G.Asc.c_oAscNumberingFormat;
    const state = {format: F.Decimal, preset: 'decimalParen'};
    const ctx = docs.context({engine: listEngine(state)});
    assert.deepEqual(marked('format.lists', ctx), ['format.lists.numbered', 'format.numbering.decimalParen']);
    state.preset = 'roman';
    assert.deepEqual(marked('format.lists', ctx), ['format.lists.numbered', 'format.numbering.roman']);
    /* A format is applied with the same preset it is matched by. */
    assert.equal(exec(ctx, 'format.numbering.letterParen'), true);
    assert.equal(exec(ctx, 'format.numbering.outline'), true);
    const sent = calls(ctx, 'put_ListTypeCustom').map(a => JSON.parse(a[0]));
    assert.deepEqual(sent[0], {Type: 'number', Lvl: [{lvlJc: 'left', suff: 'tab', numFmt: {val: 'lowerLetter'}, lvlText: '%1)'}]});
    assert.equal(sent[1].Lvl.length, 9);
    assert.deepEqual(sent[1].Lvl.map(l => l.lvlText).slice(0, 3), ['%1.', '%1.%2.', '%1.%2.%3.']);
    assert.equal(actions.NUMBERING.outline.single, false, 'a multilevel format is matched whole');
    assert.equal(actions.NUMBERING.decimal.single, true, 'a one-level format is matched at the level of the cursor');
    /* List settings: the stock window of the toolbar for the type of the current list. */
    const opened = [];
    withController('Toolbar', {onMarkerSettingsClick: type => opened.push(type)}, () => {
        assert.equal(exec(ctx, 'format.lists.settings'), true);
        state.format = F.Bullet;
        state.preset = null;
        assert.equal(exec(ctx, 'format.lists.settings'), true);
        state.format = undefined;
        assert.equal(exec(ctx, 'format.lists.settings'), true);
    });
    assert.deepEqual(opened, [1, 0, 1], 'numbered, bulleted, and numbered outside a list');
});

check('list indent is greyed with its reason outside a list', () => {
    const state = {};
    const ctx = docs.context({engine: listEngine(state)});
    for (const k of ['format.lists.indentIn', 'format.lists.indentOut']) {
        const st = Model.state(command(k), ctx);
        assert.equal(st.disabled, true, k);
        assert.equal(st.reason, 'notInList', k);
    }
    assert.equal(docs.reasonText('notInList'), 'The cursor is not in a list');
    assert.equal(exec(ctx, 'format.lists.indentIn'), false);
    state.format = G.Asc.c_oAscNumberingFormat.Decimal;
    assert.equal(Model.state(command('format.lists.indentIn'), ctx).disabled, false);
    assert.equal(exec(ctx, 'format.lists.indentIn'), true);
    assert.equal(exec(ctx, 'format.lists.indentOut'), true);
    assert.deepEqual(plain(calls(ctx, 'IncreaseIndent')), [[]]);
    assert.deepEqual(plain(calls(ctx, 'DecreaseIndent')), [[]]);
    /* The list type and its format stay available outside a list: they make one. */
    state.format = undefined;
    assert.equal(Model.state(command('format.lists.numbered'), ctx).disabled, false);
    assert.equal(Model.state(command('format.numbering.roman'), ctx).disabled, false);
});

check('table submenu is greyed with a reason outside a table and enabled inside one without rebuilding the menu', () => {
    let inTable = false;
    const opened = [];
    const ctx = docs.context({engine: {asc_IsTable: () => inTable, CheckBeforeMergeCells: () => false}});
    ctx.shell.openTableProperties = () => opened.push('table');
    /* The items the menu bar holds: the adapter reads the catalog once. */
    const format = ctx.real.groups('format');
    const table = format.find(it => it && it.k === 'format.table');
    const adapter = docs.adapter(ctx);
    let st = adapter.itemState(table);
    assert.equal(st.visible, true, 'the table submenu is always shown');
    assert.equal(st.disabled, true);
    assert.equal(st.reason, 'notInTable');
    assert.equal(docs.reasonText(st.reason), 'The cursor is not in a table');
    const rowAbove = table.items.find(it => it && it.k === 'format.table.rowAbove');
    assert.equal(adapter.exec(rowAbove), false, 'an item of the greyed submenu does not run');
    inTable = true;
    st = adapter.itemState(table);
    assert.equal(st.disabled, false, 'the same item comes alive with the cursor in a table');
    assert.deepEqual(rows(table.items, ctx), ['format.table.rowAbove', 'format.table.rowBelow', 'format.table.colLeft',
        'format.table.colRight', '—', 'format.table.merge', '—', 'format.table.rowDel', 'format.table.colDel',
        'format.table.tableDel', '—', 'format.table.props']);
    for (const [k, method] of [['rowAbove', 'addRowAbove'], ['rowBelow', 'addRowBelow'], ['colLeft', 'addColumnLeft'],
        ['colRight', 'addColumnRight'], ['rowDel', 'remRow'], ['colDel', 'remColumn'], ['tableDel', 'remTable']]) {
        assert.equal(adapter.exec(table.items.find(it => it && it.k === 'format.table.' + k)), true, k);
        assert.deepEqual(plain(calls(ctx, method)), [[]], method);
    }
    assert.equal(adapter.exec(table.items.find(it => it && it.k === 'format.table.props')), true);
    assert.deepEqual(opened, ['table'], 'table properties open the properties panel of the table');
    const view = docs.context({reasons: ['view'], engine: {asc_IsTable: () => false}});
    assert.equal(Model.state(command('format.table'), view).reason, 'view');
});

check('image submenu is greyed without a selected object', () => {
    let selected = [element('Paragraph', {})];
    const opened = [];
    const ctx = docs.context({engine: {getSelectedElements: () => selected}});
    ctx.shell.openRightPanel = () => opened.push('panel');
    const image = ctx.real.groups('format').find(it => it && it.k === 'format.image');
    let st = docs.adapter(ctx).itemState(image);
    assert.equal(st.visible, true, 'the image submenu is always shown');
    assert.equal(st.reason, 'noObject');
    assert.equal(docs.reasonText(st.reason), 'No object selected');
    assert.equal(exec(ctx, 'format.image.toFront'), false);
    selected = [element('Paragraph', {}), element('Image', {get_WrappingStyle: () => 1})];
    st = docs.adapter(ctx).itemState(image);
    assert.equal(st.disabled, false);
    assert.deepEqual(rows(image.items, ctx), ['format.image.wrap', 'format.image.wrapInline', 'format.image.wrapSquare',
        'format.image.wrapTopBottom', '—', 'format.image.toFront', 'format.image.toBack', '—', 'format.image.props']);
    assert.equal(Model.kindOf(command('format.image.wrap')), 'group');
    assert.equal(exec(ctx, 'format.image.toFront'), true);
    assert.equal(exec(ctx, 'format.image.toBack'), true);
    assert.deepEqual(calls(ctx, 'ImgApply').map(a => a[0].ChangeLevel),
        [G.Asc.c_oAscChangeLevel.BringToFront, G.Asc.c_oAscChangeLevel.SendToBack]);
    assert.equal(exec(ctx, 'format.image.props'), true);
    assert.deepEqual(opened, ['panel']);
});

check('merge needs two cells and has no item reason', () => {
    let merge = false;
    const ctx = docs.context({engine: {asc_IsTable: () => true, CheckBeforeMergeCells: () => merge}});
    let st = Model.state(command('format.table.merge'), ctx);
    assert.equal(st.disabled, true, 'one cell cannot be merged');
    assert.equal(st.reason, null, 'and the item says no reason');
    assert.equal(exec(ctx, 'format.table.merge'), false);
    merge = true;
    st = Model.state(command('format.table.merge'), ctx);
    assert.equal(st.disabled, false);
    assert.equal(exec(ctx, 'format.table.merge'), true);
    assert.deepEqual(plain(calls(ctx, 'MergeCells')), [[]]);
    const outside = docs.context({engine: {asc_IsTable: () => false, CheckBeforeMergeCells: () => false}});
    assert.equal(Model.state(command('format.table.merge'), outside).reason, 'notInTable');
});

check('wrapping marks the current style', () => {
    const W = G.Asc.c_oAscWrapStyle2;
    let wrapping = W.Square;
    const img = {get_WrappingStyle: () => wrapping, get_Value_X: () => 40, get_Value_Y: () => 12};
    const ctx = docs.context({engine: {getSelectedElements: () => [element('Image', img)]}});
    assert.deepEqual(marked('format.image', ctx), ['format.image.wrapSquare']);
    wrapping = W.TopAndBottom;
    assert.deepEqual(marked('format.image', ctx), ['format.image.wrapTopBottom']);
    wrapping = W.Behind;
    assert.deepEqual(marked('format.image', ctx), [], 'a style out of the list marks nothing');
    /* From in line to square the object keeps its place: the current position goes with the style. */
    wrapping = W.Inline;
    assert.deepEqual(marked('format.image', ctx), ['format.image.wrapInline']);
    assert.equal(exec(ctx, 'format.image.wrapSquare'), true);
    const sent = calls(ctx, 'ImgApply')[0][0];
    assert.equal(sent.WrappingStyle, W.Square);
    assert.equal(sent.PositionH.Value, 40);
    assert.equal(sent.PositionV.Value, 12);
    wrapping = W.Square;
    assert.equal(exec(ctx, 'format.image.wrapInline'), true);
    const back = calls(ctx, 'ImgApply')[1][0];
    assert.equal(back.WrappingStyle, W.Inline);
    assert.equal(back.PositionH, undefined, 'back in line the position is not carried');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
