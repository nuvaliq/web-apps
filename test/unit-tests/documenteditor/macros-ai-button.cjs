/* Run: node test/unit-tests/documenteditor/macros-ai-button.cjs
 * The optional argument is the path to MacrosDialog.js for checking the baseline.
 * The "AI" button in the macros window exists only when AI is available: without it the button
 * is not created and its placeholder is removed from the header; with it the menu items are active.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const file = process.argv[2] || path.resolve(__dirname,
    '../../../apps/common/main/lib/view/MacrosDialog.js');
const source = fs.readFileSync(file, 'utf8');

let buttons = [], menus = [], removed = [];

function Button(options) {
    this.options = options;
    this.menu = options.menu;
    buttons.push(this);
}
Button.prototype.on = function() { return this; };

function Menu(options) {
    this.options = options;
    this.handlers = {};
    menus.push(this);
}
Menu.prototype.on = function(event, handler) {
    this.handlers[event] = handler;
    return this;
};

function $(selector) {
    return {
        selector,
        remove() { removed.push(selector); return this; }
    };
}

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
            prototype: {initialize() {}}
        },
        Button,
        Menu
    }
};
const context = {
    window: {DE: {}},
    Common,
    $,
    _: {
        extend: Object.assign,
        template: () => () => '',
        bind: (fn, self, ...args) => fn.bind(self, ...args)
    },
    define: (dependencies, factory) => factory()
};
vm.runInNewContext(source, context, {filename: file});
const proto = Common.Views.MacrosDialog;

function renderWithAI(isPresentAI, onAiMenu) {
    buttons = []; menus = []; removed = [];
    let checks = 0;
    const dialog = Object.create(proto);
    if (onAiMenu)
        dialog.onAiMenu = onAiMenu;
    dialog.api = {checkAI: () => { checks++; return isPresentAI; }};
    dialog.menuAddAlign = 'tl-bl';
    dialog.renderAiButton();
    assert.equal(checks, 1, 'checkAI must be called once');
    return dialog;
}

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

test('test_ai_button_is_not_created_when_ai_is_unavailable', () => {
    assert.equal(typeof proto.renderAiButton, 'function', 'renderAiButton is not defined');
    const dialog = renderWithAI(false);
    assert.equal(dialog.btnAiMacrosAdd, undefined, 'AI button is created');
    assert.equal(buttons.length, 0, 'a button is created');
    assert.equal(menus.length, 0, 'a menu is created');
});

test('test_ai_button_placeholder_is_removed_when_ai_is_unavailable', () => {
    assert.equal(typeof proto.renderAiButton, 'function', 'renderAiButton is not defined');
    renderWithAI(false);
    assert.deepEqual(removed, ['#btn-ai-macros-add']);
});

test('test_ai_button_has_enabled_items_when_ai_is_available', () => {
    assert.equal(typeof proto.renderAiButton, 'function', 'renderAiButton is not defined');
    const dialog = renderWithAI(true);
    assert.equal(removed.length, 0, 'placeholder is removed');
    assert.equal(buttons.length, 1);
    assert.equal(dialog.btnAiMacrosAdd, buttons[0]);

    const options = buttons[0].options;
    assert.equal(options.parentEl.selector, '#btn-ai-macros-add');
    assert.equal(options.cls, 'btn-toolbar');
    assert.equal(options.iconCls, 'toolbar__icon btn-general-ai');
    assert.equal(options.hint, proto.tipAi);

    const menu = options.menu;
    assert.equal(menu, menus[0]);
    assert.equal(menu.options.additionalAlign, 'tl-bl');
    assert.deepEqual(Array.from(menu.options.items, item => [item.caption, item.value, !!item.disabled]), [
        [proto.textCreateFromDesc, 'create', false],
        [proto.textConvertFromVBA, 'convert', false]
    ]);
});

test('test_ai_menu_handler_is_bound_when_ai_is_available', () => {
    assert.equal(typeof proto.renderAiButton, 'function', 'renderAiButton is not defined');
    const calls = [];
    const dialog = renderWithAI(true, function(menu, item) { calls.push([this, menu, item]); });
    const handler = dialog.btnAiMacrosAdd.menu.handlers['item:click'];
    assert.equal(typeof handler, 'function', 'item:click is not handled');

    const item = {value: 'create'};
    handler('menu', item);
    assert.deepEqual(calls, [[dialog, 'menu', item]]);
});

test('test_render_after_ace_loaded_delegates_ai_button', () => {
    assert.ok(/renderAfterAceLoaded\s*:\s*function\(\)\s*\{[\s\S]*?this\.renderAiButton\(\);[\s\S]*?btnMacrosAdd/.test(source),
        'renderAfterAceLoaded does not call renderAiButton before the add button');
    const uses = source.match(/btnAiMacrosAdd/g) || [];
    assert.equal(uses.length, 2, 'btnAiMacrosAdd is used outside renderAiButton');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
