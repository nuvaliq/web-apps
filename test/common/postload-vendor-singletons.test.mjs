import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = process.env.WEB_APPS_SOURCE_ROOT || root;
const require = createRequire(import.meta.url);
const optimizer = require(path.join(sourceRoot, 'build/node_modules/requirejs'));

// Modules of each postload bundle that bring BaseView, and with it Backbone, into the bundle graph.
const component = name => 'common/main/lib/component/' + name;
const postloadModules = {
    documenteditor: [component('MonacoEditor')],
    spreadsheeteditor: [component('ColorPaletteExt'), component('MonacoEditor')],
    presentationeditor: [component('MonacoEditor'), component('TextareaField')],
    pdfeditor: [component('MonacoEditor'), component('TextareaField')],
    visioeditor: ['common/main/lib/view/PluginPanel', 'visioeditor/main/app/view/FileMenuPanels'],
    appforms: [component('TextareaField')]
};

for (const [editor, modules] of Object.entries(postloadModules)) {
    test(`${editor}: postload preserves the main bundle vendor singletons`, async () => {
        const config = JSON.parse(readFileSync(path.join(root, 'build', editor + '.json'), 'utf8'));
        const options = structuredClone((config.main || config.forms).js.postload.options);
        options.baseUrl = path.join(sourceRoot, 'apps');
        options.name = path.resolve(sourceRoot, 'build', options.name);
        const included = [];
        options.onBuildRead = (name, file, contents) => {
            included.push(name);
            return contents;
        };
        let output;
        options.out = text => { output = text; };
        await new Promise((resolve, reject) => optimizer.optimize(options, resolve, reject));
        if (editor === 'presentationeditor') {
            const calls = [];
            const jquery = () => Object.assign(Object.create(jquery.fn), { attr() {} });
            jquery.fn = { tooltip(options) { calls.push(options.title); } };
            const window = { jQuery: jquery, $: jquery };
            // Exercise the vendor's actual global publication boundary with a fresh
            // instance seam; constructing jQuery itself would require a browser DOM.
            const publication = output.match(/if \( typeof noGlobal === "undefined" \) \{\s*window\.jQuery = window\.\$ = jQuery;\s*\}/);
            if (publication) {
                const fresh = () => ({ attr() {} });
                vm.runInNewContext(publication[0], { window, jQuery: fresh });
            }
            const holder = readFileSync(path.join(sourceRoot, 'apps/presentationeditor/main/app/view/DocumentHolderExt.js'), 'utf8');
            const start = holder.indexOf('const shortcutHints = {}');
            const end = holder.indexOf("this.fireEvent('createdelayedelements'", start);
            assert.ok(start > 0 && end > start);
            vm.runInNewContext(holder.slice(start, end), {
                $: window.$,
                me: { textNextPage: 'Next', textPrevPage: 'Previous' },
                PE: { getController() { return { updateShortcutHints(hints) {
                    for (const hint of Object.values(hints)) hint.applyCallback(null, hint.label);
                } }; } }
            });
            assert.deepEqual(calls, ['Next', 'Previous']);
        }
        for (const module of modules) {
            assert.ok(included.includes(module));
        }
        assert.ok(included.includes(component('BaseView')));
        for (const name of ['jquery', 'underscore', 'backbone']) {
            assert.doesNotMatch(output, new RegExp('define\\(\\s*[\'\"]' + name + '[\'\"]'), `${name} must reuse the main bundle instance`);
        }
        // jQuery publishes a new global even when its AMD definition is already cached.
        // Loading it twice drops plugins such as the tooltip used by DocumentHolderExt.
        assert.doesNotMatch(output, /window\.jQuery\s*=\s*window\.\$\s*=\s*jQuery/);
        for (const module of modules) {
            assert.ok(output.includes(module));
        }
    });
}
