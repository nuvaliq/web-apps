import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const base = 'common/main/lib/component/BaseView';
const edge = "'common/main/lib/component/BaseView'";
const read = path => readFileSync(new URL(path, root), 'utf8');

// Candidate-subset scheduling regression: real RequireJS and module source.
// Minimal non-DOM seams: Backbone inheritance, underscore extend/template, the text plugin,
// editor namespaces and the SDK file type enumeration read by the file menu panels.
// No constructor, rendering, editor startup or historical error attribution.
function run(target, adverse, removeEdge) {
    const tasks = [], pending = [], errors = [], releases = [];
    const sandbox = {
        Common: { UI: {} },
        DE: { Views: {} }, PE: { Views: {} }, SSE: { Views: {} }, PDFE: { Views: {} }, VE: { Views: {} },
        Asc: { c_oAscFileType: {} },
        setTimeout(fn) { tasks.push(fn); }, clearTimeout() {},
        _: { extend: Object.assign, template: () => function () {} }
    };
    const realm = vm.createContext(sandbox);
    vm.runInContext(read('vendor/requirejs/require.js'), realm);
    const req = sandbox.requirejs;
    function extend() { function View() {} View.extend = extend; return View; }
    sandbox.define('backbone', [], () => ({ View: { extend } }));
    sandbox.define('text', [], () => ({ load(name, require, onload) { onload(''); } }));
    req.load = (context, id) => pending.push({ context, id });
    let ready = false;
    const id = target.id;
    const lookup = () => target.path.reduce((owner, key) => owner && owner[key], sandbox);
    req([base, id], () => { ready = true; }, error => errors.push(error));
    function drain() {
        for (let n = 0; tasks.length; n++) {
            assert.ok(n < 100, 'bounded loader task queue');
            tasks.shift()();
        }
    }
    drain();
    function deliver(moduleId) {
        const index = pending.findIndex(item => item.id === moduleId);
        assert.notEqual(index, -1, 'loader must request each delivered module');
        const item = pending.splice(index, 1)[0];
        let source = read('apps/' + moduleId + '.js');
        if (removeEdge && moduleId === id) {
            // Controlled pre-fix negative: remove precisely the new AMD edge.
            assert.equal(source.split(edge).length, 2, 'one prerequisite edge');
            source = source.replace(edge, '');
        }
        releases.push(moduleId);
        vm.runInContext(source, realm, { filename: 'apps/' + moduleId + '.js' });
        item.context.completeLoad(moduleId);
        drain();
    }
    deliver(adverse ? id : base);
    if (adverse && !removeEdge) {
        assert.equal(ready, false, 'target waits for BaseView delivery');
        assert.equal(lookup(), undefined);
        assert.equal(errors.length, 0);
    }
    deliver(adverse ? base : id);
    return { ready, errors, releases, component: lookup() };
}

const targets = [
    ...['AceEditor', 'ColorPaletteExt', 'ComboBoxDataView', 'HSBColorPicker', 'MaskedField', 'MonacoEditor',
        'TableStyler', 'TextareaField'].map(name =>
        ({ id: 'common/main/lib/component/' + name, path: ['Common', 'UI', name], name })),
    { id: 'common/main/lib/view/PluginPanel', path: ['Common', 'Views', 'PluginPanel'] },
    ...[['documenteditor', 'DE'], ['presentationeditor', 'PE'], ['spreadsheeteditor', 'SSE'], ['pdfeditor', 'PDFE'],
        ['visioeditor', 'VE']].map(([editor, app]) =>
        ({ id: editor + '/main/app/view/FileMenuPanels', path: [app, 'Views', 'FileMenuPanels', 'ViewSaveAs'] })),
    { id: 'spreadsheeteditor/main/app/view/Spellcheck', path: ['SSE', 'Views', 'Spellcheck'] },
    { id: 'pdfeditor/main/app/view/FormsTab', path: ['PDFE', 'Views', 'FormsTab'] },
    { id: 'pdfeditor/main/app/view/FormSettings', path: ['PDFE', 'Views', 'FormSettings'] }
];

for (const target of targets) {
    const name = target.name ?? target.id;
    for (const removeEdge of [true, false]) {
        const mode = removeEdge ? 'removed-edge baseline' : 'actual source';
        for (const adverse of [false, true]) {
            test(`${name}: ${mode} / ${adverse ? 'target first' : 'BaseView first'}`, () => {
                const result = run(target, adverse, removeEdge);
                const red = removeEdge && adverse;
                assert.equal(result.ready, !red);
                assert.equal(result.errors.length, red ? 1 : 0);
                assert.equal(typeof result.component, red ? 'undefined' : 'function');
                assert.equal(result.releases.length, 2);
                if (red) {
                    assert.equal(result.errors[0].requireType, 'define');
                    assert.ok(result.errors[0].requireModules.includes(target.id));
                    assert.equal(result.errors[0].name, 'TypeError');
                    assert.match(result.errors[0].message, /Cannot read properties of undefined.*extend/);
                }
            });
        }
    }
}
