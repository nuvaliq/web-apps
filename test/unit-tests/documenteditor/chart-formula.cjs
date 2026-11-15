/* Run: node test/unit-tests/documenteditor/chart-formula.cjs
 * Chart insertion is unavailable in a formula and resumes after leaving it.
 */
const assert = require('node:assert/strict');
const docs = require('../common/compact/lib/documents-editor.cjs');
const G = docs.host();
const T = {Paragraph: 0, Math: 9};
G.Asc.c_oAscTypeSelectElement = T;
const chart = () => G.DE.Views.DocumentActions.command('insert.chart');
const elements = types => types.map(type => ({get_ObjectType: () => type, get_ObjectValue: () => ({})}));
const chartCalls = ctx => ctx.log.filter(entry => entry.api === 'asc_addChartDrawingObject');
let passed = 0, failed = 0;
function check(name, run) {
    try { run(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

for (const types of [[T.Math], [T.Paragraph, T.Math], [T.Math, T.Paragraph]]) {
    check(`formula selection locks chart insertion (${types.join(', ')})`, () => {
        const ctx = docs.context({engine: {getSelectedElements: () => elements(types)}});
        const adapter = docs.adapter(ctx);
        assert.equal(adapter.itemState(chart()).disabled, true);
        assert.equal(adapter.exec(chart()), false);
        assert.equal(chartCalls(ctx).length, 0, 'no chart insertion reaches the SDK');
    });
}

check('leaving a formula restores chart insertion without opening the data editor', () => {
    let selected = elements([T.Paragraph, T.Math]);
    const ctx = docs.context({engine: {getSelectedElements: () => selected}});
    const adapter = docs.adapter(ctx);
    assert.equal(adapter.itemState(chart()).disabled, true);
    selected = elements([T.Paragraph]);
    assert.equal(adapter.itemState(chart()).disabled, false);
    assert.equal(adapter.exec(chart()), true);
    assert.deepEqual(JSON.parse(JSON.stringify(chartCalls(ctx).map(entry => entry.args))), [[10, null, false]]);
});

check('insertion rechecks the selection after reading an enabled menu item', () => {
    let selected = elements([T.Paragraph]);
    const ctx = docs.context({engine: {getSelectedElements: () => selected}});
    const adapter = docs.adapter(ctx);
    assert.equal(adapter.itemState(chart()).disabled, false);
    selected = elements([T.Paragraph, T.Math]);
    assert.equal(adapter.exec(chart()), false);
    assert.equal(chartCalls(ctx).length, 0);
});

check('formula context does not disable the formula command', () => {
    const ctx = docs.context({engine: {getSelectedElements: () => elements([T.Math])}});
    const adapter = docs.adapter(ctx);
    assert.equal(adapter.itemState(chart()).disabled, true);
    assert.equal(adapter.itemState(G.DE.Views.DocumentActions.command('insert.equation')).disabled, false);
});

check('leaving a formula does not override a document editing lock', () => {
    let selected = elements([T.Math]);
    const ctx = docs.context({reasons: ['view'], engine: {getSelectedElements: () => selected}});
    const adapter = docs.adapter(ctx);
    assert.equal(adapter.itemState(chart()).reason, 'view');
    selected = elements([T.Paragraph]);
    assert.equal(adapter.itemState(chart()).reason, 'view');
    assert.equal(adapter.exec(chart()), false);
    assert.equal(chartCalls(ctx).length, 0);
});

check('selection changes restore availability without rebuilding the menu adapter', () => {
    let selected = elements([T.Math]);
    const ctx = docs.context({engine: {getSelectedElements: () => selected}});
    const adapter = docs.adapter(ctx);
    const command = chart();
    assert.equal(adapter.itemState(command).disabled, true);
    selected = elements([T.Paragraph]);
    assert.equal(adapter.itemState(command).disabled, false);
    selected = elements([T.Math]);
    assert.equal(adapter.itemState(command).disabled, true);
});

check('an unavailable selection query does not prevent chart insertion', () => {
    const ctx = docs.context({engine: {getSelectedElements() { throw new Error('selection unavailable'); }}});
    const adapter = docs.adapter(ctx);
    assert.equal(adapter.itemState(chart()).disabled, false);
    assert.equal(adapter.exec(chart()), true);
    assert.equal(chartCalls(ctx).length, 1);
});

check('unrecognized selection entries do not hide a formula', () => {
    const ctx = docs.context({engine: {getSelectedElements: () => [null, {}, ...elements([T.Math]), {}]}});
    const adapter = docs.adapter(ctx);
    assert.equal(adapter.itemState(chart()).disabled, true);
    assert.equal(adapter.exec(chart()), false);
    assert.equal(chartCalls(ctx).length, 0);
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
