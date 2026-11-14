/* Run: node test/unit-tests/documenteditor/compact-shell-doc-mode.cjs
 * The optional argument is the path to an AMD file for checking the baseline.
 * After the selected view LeftMenu.SetDisabled resets isEdit/canEdit,
 * but keeps the canSwitchMode right for returning to editing.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const file = process.argv[2] || path.resolve(__dirname,
    '../../../apps/documenteditor/main/app/view/CompactShell.js');
let options, disabled, events, looks, disconnected;
const deferred = [];
const DE = {
    Views: {},
    getController(name) {
        if (name === 'Main') return {appOptions: options, _state: {isDisconnected: disconnected}};
        return {header: {getButton: () => ({isDisabled: () => disabled})}};
    }
};
const context = {
    window: {DE},
    DE,
    setTimeout: callback => deferred.push(callback),
    _: {extend: Object.assign},
    Common: {NotificationCenter: {trigger: (...args) => events.push(args)}},
    define: (dependencies, factory) => factory({})
};
vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
const shell = DE.Views.CompactShell;
shell.applyDocModeLook = mode => looks.push(mode);

let passed = 0, failed = 0;
function check(name, appOptions, locked, expected, isDisconnected = false) {
    options = appOptions;
    disabled = locked;
    disconnected = isDisconnected;
    events = [];
    looks = [];
    try {
        shell.setDocMode('edit');
        assert.equal(events.length, expected ? 1 : 0);
        assert.equal(looks.length, expected ? 1 : 0);
        if (expected) {
            assert.deepEqual(events[0], ['doc:mode-apply', 'edit', true]);
            assert.deepEqual(looks, ['edit']);
        }
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
        failed++;
    }
}

check('return from own view with stable permission',
    {isEdit: false, canEdit: false, canReview: false, canSwitchMode: true}, false, true);
check('editing with permission', {isEdit: true, canSwitchMode: true}, false, true);
check('explicitly denied switching', {isEdit: true, canSwitchMode: false}, false, false);
check('view without switching permission', {isEdit: false, canSwitchMode: false}, false, false);
check('absent permissions', {}, false, false);
check('absent appOptions', undefined, false, false);
check('stock disabled in own view (lostConnect)', {isEdit: false, canSwitchMode: true}, true, false);
check('stock disabled in editing', {isEdit: true, canSwitchMode: true}, true, false);
check('rights revoked in own view without stock lock',
    {isEdit: false, canSwitchMode: true}, false, false, true);
check('disconnect without appOptions', undefined, false, false, true);
try {
    let lockedClass, ariaDisabled, closed, sdkDisconnect;
    disabled = false;
    disconnected = false;
    options = {isEdit: false, canSwitchMode: true};
    shell.$docMode = {
        toggleClass(name, value) { lockedClass = value; return this; },
        attr(name, value) { ariaDisabled = value; return this; }
    };
    shell.api = {asc_registerCallback(name, callback) {
        assert.equal(name, 'asc_onCoAuthoringDisconnect');
        sdkDisconnect = callback;
    }};
    shell.bindDocModeLock({removeClass() { closed = true; }});
    assert.equal(lockedClass, false);
    sdkDisconnect();
    disconnected = true;
    deferred.splice(0).forEach(callback => callback());
    assert.equal(lockedClass, true);
    assert.equal(ariaDisabled, 'true');
    assert.equal(closed, true);
    console.log('PASS terminal disconnect locks UI and closes popup');
    passed++;
} catch (error) {
    console.error('FAIL terminal disconnect locks UI and closes popup', error.message);
    failed++;
}
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
