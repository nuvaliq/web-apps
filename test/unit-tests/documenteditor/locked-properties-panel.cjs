/* Run: node test/unit-tests/documenteditor/locked-properties-panel.cjs
 * Locked properties never open from selection; an open panel remains dismissible.
 * The manual toggle is checked through the right-panel rule of the catalog (DocumentActions.itemLocked
 * with the rightMenu lock that opening needs and closing does not); the open compact menu is refreshed
 * on every lock change.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const _ = require(path.join(root, 'vendor/underscore/underscore-node.cjs'));
const classes = new Set(['vo-compact']);
const stack = [];
let protection = null;
const main = {appOptions: {isEdit: true}, stackDisableActions: {
    length: () => stack.length, get: index => stack[index]
}};
const DE = {Views: {}, getController: name => {
    if (name === 'Main') return main;
    if (name === 'DocProtection') return {getDocProps: () => protection};
    if (name === 'Viewport') return {viewport: {hlayout: {doLayout() {}}}};
}};
const context = {
    DE, window: {DE, Asc: {c_oAscTypeSelectElement: {Image: 1, Shape: 2, Paragraph: 5}}}, _,
    document: {body: {classList: {
        contains: name => classes.has(name),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
    }}},
    define: (dependencies, factory) => factory({})
};
context.Asc = context.window.Asc;
for (const file of ['CompactShell.js', 'DocumentActions.js']) {
    const filename = path.join(root, 'apps/documenteditor/main/app/view', file);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, {filename});
}
const shell = DE.Views.CompactShell;
shell.resync = () => {};
let focus;
/* The selection callback of the shell; the other modules register their own callbacks on the same api. */
shell.api = {asc_registerCallback: (name, callback) => { if (name === 'asc_onFocusObject') focus = callback; }};
shell.watchSelection();
const actions = DE.Views.DocumentActions.init(shell.api, shell);
/* The manual toggle of the properties panel: opening needs the right panel unlocked, closing does not. */
const properties = {lock: () => (shell.rightOpen ? [] : ['rightMenu']), run: () => shell.toggleRightPanel()};
/* The open compact menu: every lock change refreshes it; locked and disabled mirror the toggle as drawn. */
const menu = {
    locked: false, disabled: 'false', refreshes: 0,
    refresh() {
        this.refreshes++;
        this.locked = actions.itemLocked(properties);
        this.disabled = this.locked ? 'true' : 'false';
    }
};
shell.menu = menu;
const image = {get_ObjectType: () => 1};
const shape = {get_ObjectType: () => 2};
const text = {get_ObjectType: () => 5};
let passed = 0, failed = 0;
function check(name, run) {
    try { run(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}
function reset() {
    shell.rightOpen = false;
    shell.advanced = false;
    shell.lockOn = false;
    shell.lockOpts = null;
    classes.delete('vo-right-open');
    stack.length = 0;
    protection = null;
    main.appOptions.isEdit = true;
}
const locks = [
    ['view mode', () => stack.push({disable: true, options: {viewDocMode: true, rightMenu: {disable: true}}})],
    ['comments-only protection', () => { protection = {isCommentsOnly: true}; }],
    ['lost connection', () => stack.push({disable: true, options: {viewMode: true, rightMenu: {disable: true}}})],
    ['read-only document', () => { main.appOptions.isEdit = false; }]
];
for (const [name, lock] of locks) {
    check(`${name}: selection cannot open locked properties`, () => {
        reset(); lock(); shell.applyEditingLock();
        assert.equal(actions.itemLocked(properties), true, 'opening stays prohibited');
        for (const selected of [[image], [text], [], [shape], [image, shape], [text], [image]]) {
            focus(selected);
            assert.equal(shell.rightOpen, false, 'selection cannot reserve sidebar width');
            assert.equal(classes.has('vo-right-open'), false);
        }
        assert.equal(menu.locked, true);
        assert.equal(menu.disabled, 'true');
        assert.equal(actions.itemLocked({lock: ['rightMenu']}), true, 'other right-menu actions stay locked');
    });
    check(`${name}: properties already open before the lock can close`, () => {
        reset(); focus([image]); lock(); shell.applyEditingLock();
        assert.equal(menu.disabled, 'false');
        assert.equal(actions.itemLocked(properties), false);
        properties.run();
        assert.equal(shell.rightOpen, false);
        assert.equal(menu.disabled, 'true');
        focus([image]); focus([text]); focus([shape]);
        assert.equal(shell.rightOpen, false, 'selection cannot reopen a dismissed locked panel');
    });
    check(`${name}: selection uses current locks and opening resumes after unlocking`, () => {
        reset(); lock();
        shell.advanced = true;
        focus([image]);
        assert.equal(shell.rightOpen, false, 'no stored opening while in Advanced or before lock repaint');
        stack.length = 0;
        protection = null;
        main.appOptions.isEdit = true;
        shell.applyEditingLock();
        shell.advanced = false;
        focus([image]); focus([text]);
        assert.equal(shell.rightOpen, true, 'editable drawings still open persistent properties');
        assert.equal(classes.has('vo-right-open'), true);
    });
}
check('a toolbar-only lock does not prohibit selection-driven properties', () => {
    reset();
    stack.push({disable: true, options: {toolbar: true}});
    shell.applyEditingLock(); focus([image]);
    assert.equal(shell.rightOpen, true);
});
check('without the stock stack, the editing event prevents automatic opening', () => {
    reset();
    const stockStack = main.stackDisableActions;
    try {
        delete main.stackDisableActions;
        shell.applyEditingLock({disable: true, options: {rightMenu: {disable: true}}});
        focus([image]);
        assert.equal(shell.rightOpen, false);
        shell.applyEditingLock({disable: false});
        focus([image]);
        assert.equal(shell.rightOpen, true);
    } finally {
        main.stackDisableActions = stockStack;
    }
});
check('restoring connection does not override comments-only protection', () => {
    reset(); locks[1][1](); locks[2][1]();
    shell.applyEditingLock(); focus([image]);
    assert.equal(shell.rightOpen, false);
    stack.length = 0;
    shell.applyEditingLock(); focus([image]);
    assert.equal(shell.rightOpen, false);
    protection = null;
    shell.applyEditingLock(); focus([image]);
    assert.equal(shell.rightOpen, true);
});
check('editing retains explicit opening, persistent visibility and closing', () => {
    reset(); shell.applyEditingLock();
    assert.equal(actions.itemLocked(properties), false);
    properties.run(); focus([text]); focus([]);
    assert.equal(shell.rightOpen, true);
    properties.run();
    assert.equal(shell.rightOpen, false);
    assert.equal(actions.itemLocked(properties), false);
});
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
