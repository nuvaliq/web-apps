/* Run: node test/unit-tests/documenteditor/logos-links-macros.cjs
 * The optional argument is the path to MacrosDialog.js for checking the baseline.
 * The macros window has no "?" button with a link to the api.onlyoffice.com documentation;
 * the AI hint, where OnlyOffice is the API name, stays.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const file = process.argv[2] || path.resolve(__dirname,
    '../../../apps/common/main/lib/view/MacrosDialog.js');
const source = fs.readFileSync(file, 'utf8');

let windowOptions = null;
const Common = {
    Views: {},
    Utils: {
        innerHeight: () => 900,
        innerWidth: () => 1200,
        InternalSettings: {get: () => 0}
    },
    UI: {
        Window: {
            extend: proto => proto,
            prototype: {initialize(options) { windowOptions = options; }}
        }
    }
};
const context = {
    window: {DE: {}},
    Common,
    _: {extend: Object.assign, template: () => () => ''},
    define: (dependencies, factory) => factory()
};

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
        failed++;
    }
}

test('test_macros_dialog_has_no_docs_link', () => {
    assert.ok(!source.includes('api.onlyoffice.com'), 'MacrosDialog.js still links api.onlyoffice.com');

    vm.runInNewContext(source, context, {filename: file});
    const proto = Common.Views.MacrosDialog;
    assert.equal(typeof proto.onHelp, 'undefined', 'onHelp is still defined');

    const subscriptions = [];
    const dialog = Object.create(proto);
    dialog.on = events => subscriptions.push(events);
    dialog.initialize({api: {}});

    assert.ok(windowOptions, 'Common.UI.Window initialize was not called');
    assert.equal(windowOptions.help, false, 'help button is still enabled');
    assert.equal(windowOptions.id, 'macros-dialog');
    assert.ok(subscriptions.length > 0);
    for (const events of subscriptions)
        assert.ok(!Object.prototype.hasOwnProperty.call(events, 'help'), 'help event is still handled');

    // The AI hint is not touched: OnlyOffice in it is the macros API name.
    assert.ok(source.includes("'Create a macro for OnlyOffice. '"), 'AI prompt was changed');
    assert.ok(source.includes("'Convert macro for OnlyOffice from VBA. '"), 'AI prompt was changed');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
