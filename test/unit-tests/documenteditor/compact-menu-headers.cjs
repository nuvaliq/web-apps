/* Run: node test/unit-tests/documenteditor/compact-menu-headers.cjs
 * Headers, references and fields of the compact Insert menu of the document editor
 * (DocumentActions.sections): headers and page numbers, the table of contents, footnotes, the field
 * code window and content controls.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs. The windows
 * of page number format and field code are those of the stock header and footer controller
 * (controller/HeaderFooterTab.js), loaded in vm as it is, with the windows themselves stood in.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const HEADER_FOOTER_TAB = path.join(ROOT, 'apps/documenteditor/main/app/controller/HeaderFooterTab.js');
const docs = require('../common/compact/lib/documents-editor.cjs');

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const actions = G.DE.Views.DocumentActions;
const command = k => actions.command(k);
const plain = value => JSON.parse(JSON.stringify(value));
const calls = (ctx, name) => ctx.log.filter(e => e.api === name).map(e => e.args);
const rows = (items, ctx) => plain(Model.section(items, ctx).rows.map(r => (r.kind === 'sep' ? '—' : r.k)));
const exec = (ctx, k) => docs.adapter(ctx).exec(command(k));

/* Content control levels of the engine (sdkjs word/apiDefines.js). */
G.Asc.c_oAscSdtLevelType = {Block: 1, Inline: 2, Row: 3, Cell: 4};

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* The stock header and footer controller with the windows it opens stood in: each window records
   its options; the test answers it through the handler. */
function headerFooterTab(api) {
    const windows = [];
    const Window = kind => function (options) {
        windows.push({kind, options});
        this.on = () => this;
        this.show = () => {};
    };
    const context = {
        _: {extend: Object.assign},
        Backbone: {Controller: {extend: proto => proto}},
        Common: {
            NotificationCenter: {trigger: () => {}},
            Views: {TextInputDialog: Window('field')}
        },
        Asc: {SectionPageNumProps: function () {
            this.put_Start = v => { this.start = v; };
            this.put_Format = v => { this.format = v; };
        }},
        define: (deps, factory) => factory()
    };
    context.DE = {Controllers: {}, Views: {PageNumberingDlg: Window('numbering')}};
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(HEADER_FOOTER_TAB, 'utf8'), context, {filename: HEADER_FOOTER_TAB});
    const ctl = Object.create(context.DE.Controllers.HeaderFooterTab);
    ctl.api = api;
    ctl._state = {Numbering: undefined};
    ctl.fireEvent = () => {};
    return {ctl, windows, Props: context.Asc.SectionPageNumProps};
}

/* Runs fn with the stock header and footer controller over the editor api. */
function withHeaderFooterTab(ctx, fn) {
    const tab = headerFooterTab(ctx.api);
    const getController = G.DE.getController;
    G.DE.getController = name => (name === 'HeaderFooterTab' ? tab.ctl : getController(name));
    try {
        fn(tab);
    } finally {
        G.DE.getController = getController;
    }
}

check('header and footer items move the cursor to the current page', () => {
    const ctx = docs.context({engine: {getCurrentPage: () => 4}});
    const sub = command('insert.headerFooter');
    assert.equal(Model.kindOf(sub), 'submenu');
    assert.equal(sub.t, 'Headers and page numbers');
    assert.deepEqual(rows(sub.items, ctx), ['insert.header', 'insert.footer', '—', 'insert.pageNumber',
        'insert.pageNumber.bottomCenter', 'insert.pageNumber.bottomRight', 'insert.pageNumber.topRight',
        'insert.pageNumber.format', '—', 'insert.pageCount']);
    assert.equal(Model.kindOf(command('insert.pageNumber')), 'group', 'page number is the heading of its group');
    assert.equal(exec(ctx, 'insert.header'), true);
    assert.equal(exec(ctx, 'insert.footer'), true);
    assert.deepEqual(plain(calls(ctx, 'GoToHeader')), [[4]]);
    assert.deepEqual(plain(calls(ctx, 'GoToFooter')), [[4]]);
    const view = docs.context({reasons: ['view']});
    assert.equal(Model.state(sub, view).reason, 'view');
    assert.equal(Model.state(command('insert.footer'), view).reason, 'view');
});

check('number format opens the numbering dialog', () => {
    const ctx = docs.context();
    withHeaderFooterTab(ctx, tab => {
        /* What the stock controller knows of the section numbering: start at 5, format 3. */
        tab.ctl._state.Numbering = 5;
        tab.ctl._state.NumFormat = 3;
        assert.equal(exec(ctx, 'insert.pageNumber.format'), true);
        assert.equal(tab.windows.length, 1);
        const win = tab.windows[0];
        assert.equal(win.kind, 'numbering');
        assert.equal(win.options.numbering, 5);
        assert.equal(win.options.numFormat, 3);
        win.options.handler('cancel');
        assert.deepEqual(calls(ctx, 'asc_SetSectionPageNumProps'), [], 'cancel changes nothing');
        win.options.handler('ok', 2, 4);
        const set = calls(ctx, 'asc_SetSectionPageNumProps');
        assert.equal(set.length, 1);
        assert.ok(set[0][0] instanceof tab.Props);
        assert.equal(set[0][0].start, 2);
        assert.equal(set[0][0].format, 4);
    });
    assert.equal(Model.state(command('insert.pageNumber.format'), docs.context({reasons: ['offline']})).reason, 'offline');
});

check('page count inserts at the cursor', () => {
    const ctx = docs.context();
    assert.equal(command('insert.pageCount').t, 'Page count');
    assert.equal(exec(ctx, 'insert.pageCount'), true);
    assert.deepEqual(plain(calls(ctx, 'asc_AddPageCount')), [[]]);
    assert.ok(ctx.log.some(e => e.event === 'edit:complete'));
});

check('page number positions run their command', () => {
    const keys = ['insert.pageNumber.bottomCenter', 'insert.pageNumber.bottomRight', 'insert.pageNumber.topRight'];
    assert.deepEqual(keys.map(k => command(k).t), ['Bottom center', 'Bottom right', 'Top right']);
    /* Available while editing, greyed with the editing reasons and without the script call
       (compact-page-number.cjs runs the command in the engine). */
    for (const [state, reason] of [[{}, null], [{reasons: ['offline']}, 'offline'], [{reasons: ['view']}, 'view']]) {
        const ctx = docs.context(state);
        for (const k of keys) {
            const st = Model.state(command(k), ctx);
            assert.equal(st.visible, true, k + ' stays in its place');
            assert.equal(st.disabled, reason !== null, k + (reason ? ' is greyed' : ' is available'));
            assert.equal(st.reason, reason, k + ' reason');
        }
    }
    for (const k of keys) assert.equal(Model.state(command(k), docs.context({missing: ['callCommand']})).disabled, true, k);
    const ctx = docs.context();
    for (const k of keys) assert.equal(exec(ctx, k), true, k + ' runs');
    /* The old call puts one number into one header and clears what was there. */
    assert.deepEqual(calls(ctx, 'put_PageNum'), []);
});

check('field opens the stock field code window', () => {
    const ctx = docs.context();
    assert.equal(command('insert.field').t, 'Field');
    withHeaderFooterTab(ctx, tab => {
        assert.equal(exec(ctx, 'insert.field'), true);
        assert.equal(tab.windows.length, 1);
        const win = tab.windows[0];
        assert.equal(win.kind, 'field');
        assert.equal(win.options.value, '', 'a new field starts empty');
        win.options.handler('ok', 'PAGE \\* Arabic');
        assert.deepEqual(plain(calls(ctx, 'asc_AddComplexFieldWithInstruction')), [['PAGE \\* Arabic']]);
    });
    assert.equal(Model.state(command('insert.field'), docs.context({reasons: ['form']})).reason, 'form');
});

check('toc update is greyed with its reason without a table of contents', () => {
    const sub = command('insert.toc');
    assert.equal(Model.kindOf(sub), 'submenu');
    assert.equal(sub.t, 'Table of contents');
    const none = docs.context({engine: {asc_GetTableOfContentsPr: () => null}});
    assert.deepEqual(rows(sub.items, none), ['insert.toc.add', 'insert.toc.refresh', 'insert.toc.settings']);
    for (const k of ['insert.toc.refresh', 'insert.toc.settings']) {
        const st = Model.state(command(k), none);
        assert.equal(st.disabled, true, k);
        assert.equal(st.reason, 'noToc', k);
    }
    assert.equal(docs.reasonText('noToc'), 'The document has no table of contents');
    assert.equal(Model.state(command('insert.toc.add'), none).disabled, false, 'a table of contents can be added');
    const toc = {get_InternalClass: () => 'toc-1', put_Hyperlink() {}, put_ShowPageNumbers() {}, put_RightAlignTab() {},
        put_TabLeader() {}};
    const some = docs.context({engine: {asc_GetTableOfContentsPr: () => toc}});
    for (const k of ['insert.toc.refresh', 'insert.toc.settings'])
        assert.equal(Model.state(command(k), some).disabled, false, k + ' with a table of contents');
    assert.equal(exec(some, 'insert.toc.refresh'), true);
    assert.deepEqual(plain(calls(some, 'asc_UpdateTableOfContents')), [[false, 'toc-1']]);
    /* A common reason outranks the reason of the item. */
    const view = docs.context({reasons: ['view'], engine: {asc_GetTableOfContentsPr: () => null}});
    assert.equal(Model.state(command('insert.toc.refresh'), view).reason, 'view');
});

check('footnote submenu has two kinds', () => {
    const ctx = docs.context();
    const sub = command('insert.footnote');
    assert.equal(Model.kindOf(sub), 'submenu');
    assert.equal(sub.t, 'Footnote');
    assert.deepEqual(rows(sub.items, ctx), ['insert.footnote.regular', 'insert.footnote.end']);
    assert.equal(exec(ctx, 'insert.footnote.regular'), true);
    assert.equal(exec(ctx, 'insert.footnote.end'), true);
    assert.deepEqual(plain(calls(ctx, 'asc_AddFootnote')), [[]]);
    assert.deepEqual(plain(calls(ctx, 'asc_AddEndnote')), [[]]);
    assert.equal(command('insert.endnote'), null, 'the endnote is no longer a row of Insert itself');
});

check('content control settings and remove are greyed with their reason outside a control', () => {
    const sub = command('insert.control');
    assert.equal(Model.kindOf(sub), 'submenu');
    const outside = docs.context({engine: {asc_IsContentControl: () => false}});
    assert.deepEqual(rows(sub.items, outside), ['insert.control.plain', 'insert.control.rich', 'insert.control.picture',
        'insert.control.comboBox', 'insert.control.dropDown', 'insert.control.date', 'insert.control.checkBox', '—',
        'insert.control.settings', 'insert.control.remove']);
    for (const k of ['insert.control.settings', 'insert.control.remove']) {
        const st = Model.state(command(k), outside);
        assert.equal(st.disabled, true, k);
        assert.equal(st.reason, 'notInField', k);
        assert.equal(exec(outside, k), false, k + ' does not run');
    }
    assert.equal(docs.reasonText('notInField'), 'The cursor is not in a content control');
    /* The seven kinds are inserted wherever the cursor is. */
    const kinds = ['plain', 'rich', 'picture', 'comboBox', 'dropDown', 'date', 'checkBox'];
    for (const k of kinds) assert.equal(exec(outside, 'insert.control.' + k), true, k);
    assert.deepEqual(plain(calls(outside, 'asc_AddContentControl')), [[2], [1]], 'inline plain text, block rich text');
    assert.deepEqual(plain(calls(outside, 'asc_AddContentControlPicture')), [[]]);
    assert.deepEqual(plain(calls(outside, 'asc_AddContentControlList')), [[true], [false]], 'combo box, then drop-down list');
    assert.deepEqual(plain(calls(outside, 'asc_AddContentControlDatePicker')), [[]]);
    assert.deepEqual(plain(calls(outside, 'asc_AddContentControlCheckBox')), [[]]);

    /* Inside a control: settings open the stock window for it, remove takes it away. */
    let form = null;
    const props = {get_InternalId: () => 7, get_FormPr: () => form};
    const inside = docs.context({engine: {asc_IsContentControl: () => true, asc_GetContentControlProperties: () => props}});
    for (const k of ['insert.control.settings', 'insert.control.remove'])
        assert.equal(Model.state(command(k), inside).disabled, false, k + ' inside a control');
    const windows = [];
    G.DE.Views.ControlSettingsDialog = function (options) {
        windows.push(options);
        this.show = () => {};
    };
    try {
        assert.equal(exec(inside, 'insert.control.settings'), true);
        assert.equal(windows.length, 1);
        assert.equal(windows[0].props, props);
        windows[0].handler('ok', 'new props');
        assert.deepEqual(plain(calls(inside, 'asc_SetContentControlProperties')), [['new props', 7]]);
    } finally {
        delete G.DE.Views.ControlSettingsDialog;
    }
    /* A plain control goes and leaves its content in the text, as the stock menus do; a form
       field goes whole (controller/DocumentHolderExt.js). */
    assert.equal(exec(inside, 'insert.control.remove'), true);
    assert.deepEqual(plain(calls(inside, 'asc_RemoveContentControlWrapper')), [[7]]);
    form = {};
    assert.equal(exec(inside, 'insert.control.remove'), true);
    assert.deepEqual(plain(calls(inside, 'asc_RemoveContentControl')), [[7]]);
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
