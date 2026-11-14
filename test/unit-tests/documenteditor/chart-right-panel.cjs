/* Run: node test/unit-tests/documenteditor/chart-right-panel.cjs [CompactShell.js]
 * Selection changes preserve sidebar visibility; ordinary drawings may open it.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = process.argv[2] || path.resolve(__dirname,
    '../../../apps/documenteditor/main/app/view/CompactShell.js');
const T = {Image: 1, Shape: 2, Chart: 3, Table: 4, Paragraph: 5};
const classes = new Set();
let layouts = 0, resizes = 0, focus;
const DE = {Views: {}, getController: () => ({appOptions: {isEdit: true}, viewport: {hlayout: {
    doLayout: () => { layouts++; }
}}})};
const context = {
    window: {DE, Asc: {c_oAscTypeSelectElement: T}},
    DE, Asc: {c_oAscTypeSelectElement: T},
    document: {body: {classList: {
        contains: name => classes.has(name),
        remove: name => classes.delete(name),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
    }}},
    _: {extend: Object.assign},
    setTimeout: () => 1,
    clearTimeout: () => {},
    define: (dependencies, factory) => factory({})
};
vm.runInNewContext(fs.readFileSync(source, 'utf8'), context, {filename: source});
const shell = DE.Views.CompactShell;
shell.api = {asc_registerCallback: (name, callback) => {
    assert.equal(name, 'asc_onFocusObject');
    focus = callback;
}};
shell.watchSelection();
shell.resync = () => { resizes++; };
for (const name of ['applyLayout', 'restoreStockLook', 'ensureBackButton', 'syncLeftState'])
    shell[name] = () => {};

const element = (type, chart = null) => ({
    get_ObjectType: () => type,
    get_ObjectValue: () => ({get_ChartProperties: () => chart})
});
const chart = () => element(T.Image, {series: [1, 2]});
const paragraph = () => element(T.Paragraph);
const chartShape = () => ({
    get_ObjectType: () => T.Image,
    get_ObjectValue: () => ({get_ChartProperties: () => null,
        get_ShapeProperties: () => ({get_FromChart: () => true, get_Type: () => null})})
});
function reset(open) {
    classes.clear();
    classes.add('vo-compact');
    if (open) classes.add('vo-right-open');
    shell.rightOpen = open;
    shell.advanced = false;
    shell.startupFailed = false;
    shell.wordsStale = false;
    delete shell.api.getGraphicController;
    layouts = resizes = 0;
}
function visible(expected) {
    assert.equal(classes.has('vo-right-open'), expected, 'visible icon strip');
    assert.equal(shell.rightOpen, expected, 'stored compact visibility');
}
let passed = 0, failed = 0;
function check(name, run) {
    try { run(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

for (const open of [false, true]) {
    for (const [name, selected] of [['chart-as-Image', chart], ['explicit Chart', () => element(T.Chart)]]) {
        check(`${name} preserves ${open ? 'open' : 'closed'} sidebar`, () => {
            reset(open);
            focus([paragraph(), selected()]);
            focus([selected()]);
            visible(open);
            assert.equal(layouts, 0);
            assert.equal(resizes, 0);
        });
    }
    check(`chart in table preserves ${open ? 'open' : 'closed'} sidebar`, () => {
        reset(open);
        focus([paragraph(), element(T.Table), chart()]);
        visible(open);
    });
    check(`table preserves ${open ? 'open' : 'closed'} sidebar`, () => {
        reset(open);
        focus([paragraph(), element(T.Table)]);
        visible(open);
    });
    check(`mode round trip preserves ${open ? 'open' : 'closed'} chart sidebar`, () => {
        reset(open);
        shell.toggleMode();
        assert.equal(shell.advanced, true);
        assert.equal(classes.has('vo-right-open'), false);
        focus([chart()]);
        assert.equal(shell.rightOpen, open);
        shell.toggleMode();
        assert.equal(shell.advanced, false);
        visible(open);
    });
}
for (const open of [false, true]) {
    for (const reverse of [false, true]) {
        check(`chart plus internal chart shape preserves ${open} (${reverse})`, () => {
            reset(open);
            const selected = [chartShape(), chart()];
            focus(reverse ? selected.reverse() : selected);
            visible(open);
            assert.equal(layouts, 0);
        });
    }
    check(`internal chart shape alone preserves ${open}`, () => {
        reset(open);
        focus([chartShape()]);
        visible(open);
    });
}
check('ordinary shape properties still open the sidebar', () => {
    reset(false);
    focus([{get_ObjectType: () => T.Image, get_ObjectValue: () => ({
        get_ChartProperties: () => null,
        get_ShapeProperties: () => ({get_FromChart: () => false})
    })}]);
    visible(true);
});
check('explicit open is idempotent and chart focus does not close it', () => {
    reset(false);
    focus([chart()]);
    shell.openRightPanel();
    shell.openRightPanel();
    focus([chart()]);
    visible(true);
    assert.equal(layouts, 1);
});
check('manual close survives focus on same and another chart', () => {
    reset(false);
    shell.openRightPanel();
    shell.toggleRightPanel();
    focus([chart()]);
    focus([element(T.Chart)]);
    visible(false);
    assert.equal(layouts, 2);
});
for (const selected of [[], [paragraph()]]) {
    for (const open of [false, true]) {
        check(`text/empty selection preserves ${open} (${selected.length})`, () => {
            reset(open);
            focus(selected);
            visible(open);
            focus([chart()]);
            visible(open);
            assert.equal(layouts, 0);
        });
    }
}
check('explicitly opened properties survive leaving an object and clearing selection', () => {
    reset(false);
    shell.openRightPanel();
    for (const selected of [[paragraph()], [], [element(T.Table)], [chart()]]) {
        focus(selected);
        visible(true);
    }
    assert.equal(layouts, 1);
    shell.toggleRightPanel();
    focus([paragraph()]);
    focus([]);
    visible(false);
    assert.equal(layouts, 2);
});
check('automatically opened properties stay open when focus returns to text', () => {
    reset(false);
    focus([element(T.Image)]);
    focus([paragraph()]);
    focus([]);
    visible(true);
    assert.equal(layouts, 1);
});
check('mode round trip preserves an open sidebar after text focus', () => {
    reset(true);
    shell.toggleMode();
    focus([paragraph()]);
    shell.toggleMode();
    visible(true);
});
for (const type of [T.Image, T.Shape]) {
    check(`non-chart drawing ${type} retains automatic opening`, () => {
        reset(false);
        focus([element(type)]);
        visible(true);
    });
}
check('drawing without chart-properties accessor retains automatic opening', () => {
    reset(false);
    focus([{get_ObjectType: () => T.Image, get_ObjectValue: () => ({})}]);
    visible(true);
});
for (const reverse of [false, true]) {
    check(`mixed drawing selection is independent of order (${reverse})`, () => {
        reset(false);
        const selected = [chart(), element(T.Image)];
        focus(reverse ? selected.reverse() : selected);
        visible(true);
    });
}
// Word's Get_Props emits one merged ShapeProperties record followed by the
// chart record, regardless of the Ctrl/Shift drawing-selection order.
// CompareShapeProperties ORs bFromChart, so the mixed record is indistinguishable
// from a single chart's record. Refine it using the SDK drawing controller.
for (const open of [false, true]) {
    for (const reverse of [false, true]) {
        check(`aggregated chart/shape selection opens sidebar (${open}, ${reverse})`, () => {
            reset(open);
            const drawings = [{isChart: () => true}, {isChart: () => false}];
            shell.api.getGraphicController = () => ({
                getSelectedArray: () => reverse ? drawings.slice().reverse() : drawings
            });
            focus([chartShape(), chart()]);
            visible(true);
        });
    }
    for (const count of [1, 2]) {
        check(`SDK selection of ${count} pure charts preserves ${open}`, () => {
            reset(open);
            shell.api.getGraphicController = () => ({
                getSelectedArray: () => Array.from({length: count}, () => ({isChart: () => true}))
            });
            // Word omits ChartProperties when severalCharts is true.
            focus(count === 1 ? [chartShape(), chart()] : [chartShape()]);
            visible(open);
            assert.equal(layouts, 0);
        });
    }
}
check('explicit Chart properties cannot hide a selected ordinary drawing', () => {
    reset(false);
    shell.api.getGraphicController = () => ({getSelectedArray: () => [
        {isChart: () => false}, {isChart: () => true}
    ]});
    focus([element(T.Chart)]);
    visible(true);
});
for (const controller of [null, {}, {getSelectedArray: () => []}]) {
    check(`unavailable drawing selection preserves chart fallback (${JSON.stringify(controller)})`, () => {
        reset(false);
        shell.api.getGraphicController = () => controller;
        focus([chartShape(), chart()]);
        visible(false);
    });
}
check('mixed SDK selection updates stored visibility in Advanced', () => {
    reset(false);
    shell.toggleMode();
    shell.api.getGraphicController = () => ({getSelectedArray: () => [
        {isChart: () => true}, {isChart: () => false}
    ]});
    focus([chartShape(), chart()]);
    assert.equal(shell.rightOpen, true);
    assert.equal(classes.has('vo-right-open'), false);
    shell.toggleMode();
    visible(true);
});
check('startup failure prevents selection-driven changes', () => {
    reset(false);
    shell.startupFailed = true;
    focus([element(T.Image)]);
    visible(false);
});
// Chart insertion opens the data editor right away; the inserted chart in focus
// keeps the sidebar as it was.
check('chart insertion keeps a closed sidebar closed', () => {
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../../../apps/documenteditor/main/app/view/DocumentActions.js'), 'utf8'), context);
    const actions = DE.Views.DocumentActions;
    reset(false);
    let insertion;
    shell.api.asc_addChartDrawingObject = (...args) => {
        insertion = args;
        // The engine selects the new chart and opens its data editor (sdkjs word/api.js).
        focus([paragraph(), chart()]);
        focus([chartShape(), chart()]);
    };
    context.Asc.c_oAscChartTypeSettings = {barNormal: 10};
    actions.api = shell.api;
    actions.shell = shell;
    const menus = actions.sections();
    const insert = menus.find(menu => menu.k === 'insert');
    assert.equal(insert.t, actions.textInsert);
    const action = insert.items.find(item => item && item.i === 'chart');
    assert.ok(action, 'chart insert menu action exists');
    action.run();
    assert.deepEqual(insertion, [10, undefined, true], 'the data editor opens after the insertion');
    visible(false);
    assert.equal(layouts, 0);
});
check('existing Edit data action opens editor and preserves closed sidebar', () => {
    reset(false);
    let edits = 0;
    shell.api.asc_editChartInFrameEditor = () => { edits++; focus([chartShape(), chart()]); };
    context.Common = {Controllers: {LaunchController: {isScriptLoaded: () => true}}};
    const underscore = {extend: Object.assign, template: () => () => ''};
    context.define = (dependencies, factory) => factory('', {}, underscore,
        {View: {extend: definition => definition}});
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
        '../../../apps/documenteditor/main/app/view/ChartSettings.js'), 'utf8'), context);
    DE.Views.ChartSettings.setEditData.call({api: shell.api});
    assert.equal(edits, 1);
    visible(false);
});
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
