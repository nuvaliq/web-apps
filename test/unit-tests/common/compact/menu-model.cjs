/* Run: node test/unit-tests/common/compact/menu-model.cjs [path to MenuModel.js]
 * Shared model of a compact menu item: visibility, lock and its reason, checks and
 * labels read at snapshot time, separators of a section, nesting rules.
 * The module runs in vm without jQuery, underscore and editor namespaces: the shared layer
 * must not need any of them. The optional argument points to a broken copy of the module
 * for a negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../../..');
const MODEL = process.argv[2] ? path.resolve(process.argv[2]) :
    path.join(ROOT, 'apps/common/main/lib/view/compact/MenuModel.js');
const editors = require('./lib/editors.cjs');

function load(file) {
    const context = {define: (dependencies, factory) => factory()};
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
    for (const name of ['DE', 'SSE', '$', 'jQuery', '_'])
        assert.equal(context[name], undefined, name + ' appeared while loading the shared model');
    return context.Common && context.Common.UI && context.Common.UI.Compact && context.Common.UI.Compact.MenuModel;
}

let Model = null;
try { Model = load(MODEL); }
catch (error) { console.error('FAIL loading', MODEL, error.message); }

let passed = 0, failed = 0;
function check(name, fn) {
    try {
        assert.ok(Model, 'Common.UI.Compact.MenuModel is defined');
        fn();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
        failed++;
    }
}

const has = (...names) => ({has: name => names.includes(name)});
/* Arrays made in the vm realm have another prototype; compare plain copies. */
const plain = list => Array.from(list);
const keys = rows => Array.from(rows, row => (row.kind === 'sep' ? '-' : row.k));
const action = (k, extra) => Object.assign({k, t: k, kind: 'action'}, extra);

check('hides items whose when is false', () => {
    const ctx = {rights: 'view'};
    const hidden = action('rename', {when: c => c.rights === 'edit'});
    assert.equal(Model.state(hidden, ctx).visible, false);
    const shown = Model.section([action('download'), hidden, action('print')], ctx);
    assert.deepEqual(keys(shown.rows), ['download', 'print']);
    assert.equal(Model.state(hidden, {rights: 'edit'}).visible, true);
});

check('needs without a command keeps the item greyed in place', () => {
    const items = [action('header'), action('pageNumber', {needs: 'insertPageNumber'}), action('footer')];
    const without = Model.section(items, has());
    assert.deepEqual(keys(without.rows), ['header', 'pageNumber', 'footer']);
    const row = without.rows[1];
    assert.equal(row.disabled, true);
    assert.equal(row.reason, null);
    assert.equal(Model.actionable(items[1], Model.state(items[1], has())), false);
    const st = Model.state(items[1], has('insertPageNumber'));
    assert.equal(st.disabled, false);
    assert.equal(Model.actionable(items[1], st), true);
});

check('trims leading, trailing and doubled separators', () => {
    const gone = action('gone', {when: () => false});
    const items = [{sep: true}, action('a'), {sep: true}, gone, {sep: true}, {kind: 'sep'},
        action('b'), {sep: true}, gone, {sep: true}];
    assert.deepEqual(keys(Model.section(items, {}).rows), ['a', '-', 'b']);
    assert.deepEqual(keys(Model.section([{sep: true}, {sep: true}], {}).rows), []);
});

check('hides a submenu without visible items', () => {
    const sub = {k: 'history', t: 'History', kind: 'submenu', items: [
        action('versions', {when: c => c.history}), {sep: true}, action('compare', {when: c => c.compare})]};
    assert.equal(Model.state(sub, {}).visible, false);
    assert.deepEqual(keys(Model.section([action('open'), sub], {}).rows), ['open']);
    const shown = Model.section([sub], {history: true});
    assert.deepEqual(keys(shown.rows), ['history']);
    assert.deepEqual(keys(shown.rows[0].rows), ['versions']);
});

check('hides a section without visible items', () => {
    const edit = c => c.rights === 'edit';
    const items = [{sep: true}, action('image', {when: edit}), {kind: 'group', t: 'Wrap'},
        {k: 'inline', t: 'Inline', kind: 'radio', when: edit}, {sep: true}];
    const viewer = Model.section(items, {rights: 'view'});
    assert.equal(viewer.visible, false);
    assert.deepEqual(plain(viewer.rows), []);
    assert.equal(Model.section(items, {rights: 'edit'}).visible, true);
    assert.equal(Model.section([], {}).visible, false);
});

check('reports a submenu nested in a submenu', () => {
    const problems = Model.validate([{k: 'view', t: 'View', items: [
        {k: 'zoom', t: 'Zoom', kind: 'submenu', items: [
            {k: 'zoom.more', t: 'More', kind: 'submenu', items: [action('zoom.200')]}]}]}]);
    assert.equal(problems.length, 1, problems.join('; '));
    assert.match(problems[0], /submenu deeper than 1 at /);
    assert.match(problems[0], /zoom\.more/);
    const flat = Model.validate([{k: 'view', t: 'View', items: [
        {k: 'zoom', t: 'Zoom', kind: 'submenu', items: [action('zoom.100'), action('zoom.200')]}]}]);
    assert.deepEqual(plain(flat), []);
    const other = Model.validate([
        {k: 'file', t: 'File', items: [action('save'), {k: 'x', t: 'X', kind: 'button'}]},
        {k: 'edit', t: 'Edit', items: [action('save')]}]);
    assert.ok(other.some(p => /duplicate item key "save"/.test(p)), other.join('; '));
    assert.ok(other.some(p => /unknown kind "button"/.test(p)), other.join('; '));
});

/* Three levels of submenus under one section item: zoom ▸ more ▸ exact ▸. */
const nested = () => [{k: 'view', t: 'View', items: [
    {k: 'zoom', t: 'Zoom', kind: 'submenu', items: [action('zoom.100'),
        {k: 'zoom.more', t: 'More', kind: 'submenu', items: [action('zoom.200'),
            {k: 'zoom.exact', t: 'Exact', kind: 'submenu', items: [action('zoom.333')]}]}]}]}];

check('validate allows nesting up to the declared depth', () => {
    const two = [{k: 'view', t: 'View', items: [
        {k: 'zoom', t: 'Zoom', kind: 'submenu', items: [
            {k: 'zoom.more', t: 'More', kind: 'submenu', items: [action('zoom.200')]}]}]}];
    assert.deepEqual(plain(Model.validate(two, {depth: 2})), []);
    assert.deepEqual(plain(Model.validate(nested(), {depth: 3})), []);
    assert.equal(Model.validate(two).length, 1, 'one level by default');
    assert.equal(Model.validate(two, {}).length, 1, 'one level without a declared depth');
});

check('validate reports a submenu deeper than the declared depth', () => {
    const problems = Model.validate(nested(), {depth: 2});
    assert.equal(problems.length, 1, problems.join('; '));
    assert.match(problems[0], /^submenu deeper than 2 at /);
    assert.match(problems[0], / at view > zoom > zoom\.more > zoom\.exact$/);
    const one = Model.validate(nested(), {depth: 1});
    assert.equal(one.length, 2, one.join('; '));
    assert.ok(one.every(p => /^submenu deeper than 1 at /.test(p)), one.join('; '));
    /* A computed submenu is checked against the depth when the context is given. */
    const computed = [{k: 'view', t: 'View', items: [
        {k: 'zoom', t: 'Zoom', kind: 'submenu', items: c => [
            {k: 'zoom.more', t: 'More', kind: 'submenu', items: [action('zoom.' + c.zoom)]}]}]}];
    assert.match(Model.validate(computed, {depth: 1, ctx: {zoom: 200}})[0], /submenu deeper than 1 at view > zoom > zoom\.more/);
    assert.deepEqual(plain(Model.validate(computed, {depth: 2, ctx: {zoom: 200}})), []);
});

check('reads submenu items from a function at snapshot time', () => {
    const ctx = {sheets: ['Q1', 'Q2']};
    let reads = 0;
    const move = {k: 'move', t: 'Move to', kind: 'submenu', items: c => {
        reads++;
        return c.sheets.map(name => action('move.' + name, {t: name}));
    }};
    assert.equal(Model.kindOf(move), 'submenu');
    assert.equal(reads, 0, 'nothing is read before a snapshot');
    const before = Model.section([action('copy'), move], ctx);
    assert.deepEqual(keys(before.rows), ['copy', 'move']);
    assert.deepEqual(keys(before.rows[1].rows), ['move.Q1', 'move.Q2']);
    assert.equal(before.rows[1].rows[1].label, 'Q2');
    ctx.sheets = ['Q1', 'Q2', 'Q3'];
    const after = Model.section([move], ctx);
    assert.deepEqual(keys(after.rows[0].rows), ['move.Q1', 'move.Q2', 'move.Q3']);
    assert.deepEqual(keys(before.rows[1].rows), ['move.Q1', 'move.Q2'], 'an earlier snapshot does not change');
    assert.deepEqual(keys(Model.itemsOf(move, ctx)), ['move.Q1', 'move.Q2', 'move.Q3']);
    assert.deepEqual(plain(Model.itemsOf(action('copy'), ctx)), []);
    assert.equal(Model.state(move, ctx).visible, true);
    assert.ok(reads >= 3, 'the function is read at every snapshot');
});

check('hides a submenu whose computed items are empty', () => {
    const move = {k: 'move', t: 'Move to', kind: 'submenu', items: c => c.sheets.map(name => action('move.' + name))};
    const none = {sheets: []};
    assert.equal(Model.state(move, none).visible, false);
    assert.deepEqual(keys(Model.section([action('copy'), {sep: true}, move], none).rows), ['copy']);
    const nothing = {k: 'nothing', t: 'Nothing', kind: 'submenu', items: () => null};
    assert.equal(Model.state(nothing, {}).visible, false);
    const hidden = {k: 'hidden', t: 'Hidden', items: () => [action('h', {when: () => false})]};
    assert.equal(Model.state(hidden, {}).visible, false);
    assert.equal(Model.section([move], {sheets: ['Q1']}).visible, true);
});

check('snapshot carries the hint and the description', () => {
    const ctx = {count: 3};
    const sum = action('sum', {hint: 'Alt+=', desc: 'Adds up the selected cells'});
    const count = action('count', {hint: c => c.count + ' cells', desc: c => 'Counts ' + c.count + ' values'});
    const bare = action('bare');
    const st = Model.state(sum, ctx);
    assert.equal(st.hint, 'Alt+=');
    assert.equal(st.desc, 'Adds up the selected cells');
    const rows = Model.section([sum, count, bare,
        {k: 'more', t: 'More', items: [action('avg', {hint: 'avg', desc: 'Average'})]}], ctx).rows;
    assert.equal(rows[0].hint, 'Alt+=');
    assert.equal(rows[0].desc, 'Adds up the selected cells');
    assert.equal(rows[1].hint, '3 cells');
    assert.equal(rows[1].desc, 'Counts 3 values');
    assert.equal(rows[2].hint, null);
    assert.equal(rows[2].desc, null);
    assert.equal(rows[3].rows[0].hint, 'avg');
    assert.equal(rows[3].rows[0].desc, 'Average');
    ctx.count = 5;
    assert.equal(Model.state(count, ctx).hint, '5 cells', 'read at snapshot time');
    assert.equal(rows[1].hint, '3 cells', 'an earlier snapshot does not change');
    const locked = Model.state(action('x', {hint: 'h', desc: 'd', needs: 'x'}), has());
    assert.equal(locked.hint, 'h');
    assert.equal(locked.desc, 'd');
    assert.equal(Model.state(action('gone', {hint: 'h', when: () => false}), ctx).hint, null);
});

check('limit outranks offline', () => {
    assert.equal(Model.pickReason(['offline', 'limit']), 'limit');
    const it = action('cut', {disabled: () => ['noSelection', 'offline', 'limit']});
    const st = Model.state(it, {});
    assert.equal(st.disabled, true);
    assert.equal(st.reason, 'limit');
});

check('offline outranks view', () => {
    assert.equal(Model.pickReason(['view', 'offline']), 'offline');
    assert.equal(Model.pickReason(['protected', 'view', 'offline']), 'offline');
    assert.equal(Model.pickReason(['protected', 'view']), 'view');
});

/* An editor order with its own codes among the common ones, as the document editor gives it. */
const REVIEW_ORDER = ['limit', 'offline', 'view', 'final', 'original', 'form', 'protected', 'forAll'];

check('final and original outrank form and protected', () => {
    assert.equal(Model.pickReason(['protected', 'form', 'final'], REVIEW_ORDER), 'final');
    assert.equal(Model.pickReason(['form', 'original', 'protected'], REVIEW_ORDER), 'original');
    assert.equal(Model.pickReason(['protected', 'form'], REVIEW_ORDER), 'form');
    assert.equal(Model.pickReason(['forAll', 'protected'], REVIEW_ORDER), 'protected');
    assert.equal(Model.pickReason(['view', 'final'], REVIEW_ORDER), 'view');
});

check('the shared layer knows only four reason codes', () => {
    assert.deepEqual(plain(Model.COMMON_REASONS), ['limit', 'offline', 'view', 'protected']);
    assert.equal('REASONS' in Model, false, 'no shared list with the codes of an editor');
    assert.deepEqual(plain(Model.reasonOrder()), ['limit', 'offline', 'view', 'protected'],
        'without an editor order only the common codes rank');
    /* Codes of an editor are not common: without its order they rank after every common code. */
    assert.equal(Model.pickReason(['final', 'protected']), 'protected');
    assert.equal(Model.pickReason(['form', 'final']), 'form', 'among codes of the item the first one');
});

check('common reasons keep their order inside the adapter order', () => {
    /* The adapter lists the common codes out of their order: they take its places in their own order. */
    const order = ['protected', 'mine', 'view', 'offline', 'limit'];
    assert.deepEqual(plain(Model.reasonOrder(order)), ['limit', 'mine', 'offline', 'view', 'protected']);
    assert.equal(Model.pickReason(['offline', 'limit'], order), 'limit');
    assert.equal(Model.pickReason(['protected', 'view'], order), 'view');
    assert.equal(Model.pickReason(['offline', 'mine'], order), 'mine', 'the own code keeps its place');
    /* A common code the adapter left out stands right after the common code before it, or first. */
    assert.deepEqual(plain(Model.reasonOrder(['offline', 'mine', 'protected'])),
        ['limit', 'offline', 'view', 'mine', 'protected']);
    assert.deepEqual(plain(Model.reasonOrder(['mine', 'other'])), ['limit', 'offline', 'view', 'protected', 'mine', 'other']);
    assert.deepEqual(plain(Model.reasonOrder(['mine', 'mine', '', null, 'view'])), ['limit', 'offline', 'mine', 'view', 'protected'],
        'repeats and non codes are dropped');
});

check('an adapter code ranks where the adapter puts it', () => {
    const order = ['limit', 'offline', 'noLayers', 'view', 'protected', 'noShape'];
    assert.equal(Model.pickReason(['view', 'noLayers'], order), 'noLayers');
    assert.equal(Model.pickReason(['noLayers', 'offline'], order), 'offline');
    assert.equal(Model.pickReason(['noShape', 'protected'], order), 'protected');
    assert.equal(Model.pickReason(['unlisted', 'noShape'], order), 'noShape', 'a listed code outranks an unlisted one');
    assert.equal(Model.pickReason(['unlisted', 'other'], order), 'unlisted', 'among unlisted codes the first one');
    /* The snapshot of an item, a section and a submenu ranks by the same order. */
    const layers = action('layers', {disabled: c => [].concat(c.common, c.layers ? [] : ['noLayers'])});
    assert.equal(Model.state(layers, {common: ['view']}, order).reason, 'noLayers');
    assert.equal(Model.state(layers, {common: ['view']}).reason, 'view', 'without the order the common code ranks first');
    const rows = Model.section([layers, {k: 'sub', t: 'Sub', kind: 'submenu', items: [action('inner', {disabled: layers.disabled})]}],
        {common: ['offline']}, order).rows;
    assert.deepEqual([rows[0].reason, rows[1].rows[0].reason], ['offline', 'offline']);
    const view = Model.section([layers, {k: 'sub', t: 'Sub', kind: 'submenu', items: [action('inner', {disabled: layers.disabled})]}],
        {common: ['view']}, order).rows;
    assert.deepEqual([view[0].reason, view[1].rows[0].reason], ['noLayers', 'noLayers']);
});

check('item reason applies only without a common reason', () => {
    const it = action('copy', {disabled: c => [].concat(c.common || [], c.selection ? [] : ['noSelection'])});
    assert.equal(Model.state(it, {}).reason, 'noSelection');
    assert.equal(Model.state(it, {common: ['protected']}).reason, 'protected');
    assert.equal(Model.state(it, {common: ['offline'], selection: true}).reason, 'offline');
    assert.equal(Model.pickReason(['noSelection', 'notInTable']), 'noSelection');
    assert.equal(Model.pickReason([null, true]), null);
    assert.equal(Model.pickReason([]), null);
    const plain = Model.state(action('undo', {disabled: () => true}), {});
    assert.equal(plain.disabled, true);
    assert.equal(plain.reason, null);
    const free = Model.state(action('undo', {disabled: () => null}), {});
    assert.equal(free.disabled, false);
    assert.equal(free.reason, null);
});

check('reads checked and computed label at snapshot time', () => {
    const ctx = {zoom: 100, rulers: false};
    const zoom = {k: 'zoom', kind: 'widget', t: c => 'Zoom ' + c.zoom + '%'};
    const rulers = {k: 'rulers', t: 'Rulers', kind: 'check', checked: c => c.rulers};
    const before = Model.section([zoom, rulers], ctx);
    ctx.zoom = 150;
    ctx.rulers = true;
    const after = Model.section([zoom, rulers], ctx);
    assert.equal(before.rows[0].label, 'Zoom 100%');
    assert.equal(before.rows[1].checked, false);
    assert.equal(after.rows[0].label, 'Zoom 150%');
    assert.equal(after.rows[1].checked, true);
    assert.equal(Model.state(rulers, ctx).label, 'Rulers');
});

check('radio group marks only the current option', () => {
    const radio = (k, value) => ({k, t: k, kind: 'radio', checked: c => c.wrap === value || c.all});
    const items = [{kind: 'group', t: 'Wrapping'}, radio('inline', 'inline'), radio('square', 'square'),
        radio('tight', 'tight'), {sep: true}, {k: 'ruler', t: 'Ruler', kind: 'check', checked: () => true}];
    const rows = Model.section(items, {wrap: 'square'}).rows;
    assert.deepEqual(plain(rows.filter(r => r.kind === 'radio').map(r => r.checked)), [false, true, false]);
    const broken = Model.section(items, {all: true}).rows;
    assert.deepEqual(plain(broken.filter(r => r.kind === 'radio').map(r => r.checked)), [true, false, false]);
    assert.equal(broken[broken.length - 1].checked, true);
    const other = Model.section([radio('a', 'a'), {sep: true}, radio('b', 'b')], {all: true}).rows;
    assert.deepEqual(plain(other.filter(r => r.kind === 'radio').map(r => r.checked)), [true, true]);
});

check('group header is never actionable', () => {
    let runs = 0;
    const head = {k: 'wrapHead', t: 'Wrapping', kind: 'group', run: () => runs++};
    const st = Model.state(head, {});
    assert.equal(st.visible, true);
    assert.equal(st.disabled, true);
    assert.equal(st.reason, null);
    assert.equal(st.label, 'Wrapping');
    assert.equal(Model.actionable(head, st), false);
    const rows = Model.section([head, {k: 'inline', t: 'Inline', kind: 'radio'}], {}).rows;
    assert.equal(rows[0].kind, 'group');
    assert.equal(rows[0].disabled, true);
    const alone = Model.section([action('a'), {sep: true}, head, {k: 'x', t: 'x', kind: 'radio', when: () => false}], {});
    assert.deepEqual(keys(alone.rows), ['a']);
    assert.equal(Model.section([head], {}).visible, false);
    assert.equal(runs, 0);
});

check('widget keeps its place and lock', () => {
    const widget = {k: 'fontSize', t: 'Size', kind: 'widget', needs: 'fontSize',
        disabled: c => (c.common ? c.common : null)};
    const items = [action('bold'), widget, action('italic')];
    const missing = Model.section(items, has());
    assert.deepEqual(keys(missing.rows), ['bold', 'fontSize', 'italic']);
    assert.equal(missing.rows[1].disabled, true);
    const ctx = Object.assign(has('fontSize'), {common: ['offline']});
    const locked = Model.section(items, ctx);
    assert.deepEqual(keys(locked.rows), ['bold', 'fontSize', 'italic']);
    assert.equal(locked.rows[1].disabled, true);
    assert.equal(locked.rows[1].reason, 'offline');
    assert.equal(Model.actionable(widget, Model.state(widget, has('fontSize'))), false);
    assert.equal(Model.section([widget], has('fontSize')).visible, true);
});

check('fixture editor sections pass validation', () => {
    const withAdapter = editors.filter(e => e.adapter);
    assert.ok(withAdapter.some(e => e.name === 'fixture'), 'the test editor is listed in lib/editors.cjs');
    for (const editor of withAdapter) {
        const catalog = require(editor.adapter);
        const ctx = catalog.context();
        const sections = catalog.sections(ctx);
        assert.deepEqual(plain(Model.validate(sections, {depth: catalog.depth, ctx})), [], editor.name);
        const kinds = new Set();
        let deepest = 0, computed = 0, hints = 0, descs = 0;
        (function walk(items, level) {
            for (const it of items) {
                kinds.add(Model.kindOf(it));
                if (it.hint !== undefined) hints++;
                if (it.desc !== undefined) descs++;
                if (!it.items) continue;
                if (typeof it.items === 'function') computed++;
                deepest = Math.max(deepest, level + 1);
                walk(Model.itemsOf(it, ctx), level + 1);
            }
        })(sections.flatMap(s => s.items), 0);
        assert.ok(deepest <= (catalog.depth || 1), editor.name + ' nests no deeper than it declares');
        /* The test editor is the full second consumer: it uses every kind of row, nests
           submenus to its declared depth, computes a submenu and gives hints and descriptions. */
        if (editor.name === 'fixture') {
            assert.deepEqual([...kinds].sort(), [...Model.KINDS].sort(), editor.name + ' uses every kind of row');
            assert.equal(catalog.depth, 2, editor.name + ' declares two levels of submenus');
            assert.equal(deepest, 2, editor.name + ' nests a submenu in a submenu');
            assert.ok(computed > 0, editor.name + ' computes a submenu from its context');
            assert.ok(hints > 0 && descs > 0, editor.name + ' gives hints and descriptions');
            assert.ok(Model.validate(sections, {ctx}).length > 0, editor.name + ' needs its declared depth');
        }
        for (const kind of kinds) assert.ok(Model.KINDS.includes(kind), editor.name + ' kind ' + kind);
        for (const s of sections) assert.equal(Model.section(s.items, ctx).visible, true, editor.name + ' ' + s.k);
    }
});

check('fixture editor locks and reasons follow its own context', () => {
    const fixture = require('./lib/fixture-editor.cjs');
    const ctx = fixture.context({reasons: ['protected', 'offline']});
    const [drawing, shape, layout] = fixture.sections(ctx);
    const shapeRows = Model.section(shape.items, ctx).rows;
    assert.equal(shapeRows[0].reason, 'offline');
    assert.equal(fixture.reasonText(shapeRows[0].reason), null);
    const calm = fixture.context();
    const calmRows = Model.section(fixture.sections(calm)[1].items, calm).rows;
    assert.equal(calmRows[0].reason, 'noShape');
    assert.equal(fixture.reasonText('noShape'), 'No shape selected');
    assert.equal(Model.section(drawing.items, ctx).rows.find(r => r.k === 'drawing.print').reason, 'offline');
    const layers = Model.section(layout.items, calm).rows.find(r => r.k === 'layout.layers');
    assert.equal(layers.reason, 'noLayers');
    /* Its own order ranks «no layers» above «open for viewing». */
    const viewing = fixture.context({reasons: ['view']});
    const layout2 = fixture.sections(viewing)[2];
    assert.equal(Model.section(layout2.items, viewing, fixture.reasons).rows.find(r => r.k === 'layout.layers').reason, 'noLayers');
    assert.equal(Model.section(layout2.items, viewing, fixture.reasons).rows.find(r => r.k === 'layout.grid').reason, null);
    const viewer = fixture.context({rights: 'view'});
    assert.equal(Model.section(fixture.sections(viewer)[1].items, viewer).visible, false);
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
