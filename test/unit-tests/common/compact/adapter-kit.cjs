/* Run: node test/unit-tests/common/compact/adapter-kit.cjs [path to AdapterKit.js]
 * Stock parts every editor adapter of the compact menu reads the same way: the limit of
 * simultaneous editing from the licence result of Main, the lost connection from the lock
 * stack of Main, the shortcut of a command from the stock shortcut registry, the engine
 * keyboard held by the menu with asc_enableKeyEvents, and the editor covered by a stock
 * window or a loading mask. The editor gives its controllers and its api; the rest of the
 * stock editor is stand-ins here.
 * The module runs in vm without jQuery, underscore and editor namespaces: the shared layer
 * must not need any of them. The optional argument points to a broken copy of the module
 * for a negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../../..');
const KIT = process.argv[2] ? path.resolve(process.argv[2]) :
    path.join(ROOT, 'apps/common/main/lib/view/compact/AdapterKit.js');

const LICENSE = {Connections: 1, UsersCount: 2, ConnectionsOS: 3, UsersCountOS: 4, Success: 5};

/* A stock editor around the kit. state:
 *  - license  — name of Asc.c_oLicenseResult set as Main._state.licenseType;
 *  - disconnected — Main._state.isDisconnected;
 *  - stack    — entries of Main.stackDisableActions, from the bottom to the top;
 *  - shortcuts — {action: [keys…] | [[keys…], …]} the registry gives, hidden ones already left out;
 *  - modal    — a stock window is open (Common.Utils.ModalWindow);
 *  - masks    — loading masks on the page: true shown, false hidden. */
function editor(state) {
    const s = Object.assign({license: null, disconnected: false, stack: [], shortcuts: {}, modal: false, masks: []}, state);
    const log = [];
    const G = {define: (dependencies, factory) => factory()};
    G.window = G;
    G.Asc = {c_oLicenseResult: LICENSE};
    G.Common = {Utils: {ModalWindow: {isVisible: () => !!s.modal}}};
    G.document = {
        querySelectorAll: selector => (selector === '.asc-loadmask' ?
            s.masks.map(shown => ({getClientRects: () => (shown ? [{}] : [])})) : [])
    };
    vm.createContext(G);
    vm.runInContext(fs.readFileSync(KIT, 'utf8'), G, {filename: KIT});
    for (const name of ['DE', 'SSE', '$', 'jQuery', '_'])
        assert.equal(G[name], undefined, name + ' appeared while loading the adapter kit');
    const Kit = G.Common.UI && G.Common.UI.Compact && G.Common.UI.Compact.AdapterKit;
    assert.ok(Kit && typeof Kit.create === 'function', 'Common.UI.Compact.AdapterKit.create is defined');
    const main = {
        stackDisableActions: {length: () => s.stack.length, get: i => s.stack[i]},
        _state: {
            get licenseType() { return s.license ? LICENSE[s.license] : undefined; },
            get isDisconnected() { return !!s.disconnected; }
        }
    };
    const controllers = {
        Main: main,
        'Common.Controllers.Shortcuts': {
            getShortcutsByActionType(action, withHidden) {
                log.push({registry: action, withHidden});
                const list = s.shortcuts[action];
                if (list === 'throws') throw new Error('no action');
                if (!list) return null;
                return (Array.isArray(list[0]) ? list : [list]).map(keys => ({keys}));
            }
        }
    };
    const api = {asc_enableKeyEvents: on => log.push({keys: on})};
    const kit = Kit.create({controller: name => controllers[name] || null, api});
    return {G, Kit, kit, s, log, api, controllers};
}

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

const keyCalls = log => log.filter(e => 'keys' in e).map(e => e.keys);

check('limit is read from the stock license result', () => {
    for (const name of ['Connections', 'UsersCount', 'ConnectionsOS', 'UsersCountOS'])
        assert.equal(editor({license: name}).kit.limitReached(), true, name);
    assert.equal(editor({license: 'Success'}).kit.limitReached(), false, 'another licence result is no limit');
    assert.equal(editor({}).kit.limitReached(), false, 'no licence result yet');
    const e = editor({license: 'Connections'});
    delete e.G.Asc.c_oLicenseResult;
    assert.equal(e.kit.limitReached(), false, 'without the licence codes of the engine nothing is assumed');
    const noMain = editor({license: 'Connections'});
    delete noMain.controllers.Main;
    assert.equal(noMain.kit.limitReached(), false, 'without Main');
});

check('offline comes from every lock type of the stack, not only the top', () => {
    for (const type of ['reconnect', 'refresh-file', 'disconnect', 'not-loaded'])
        assert.equal(editor({stack: [{type, disable: true}]}).kit.offline(), true, type);
    const under = editor({stack: [{type: 'reconnect', disable: true}, {type: 'signature', disable: true}]});
    assert.equal(under.kit.offline(), true, 'a lost connection under another lock counts');
    assert.equal(editor({stack: [{type: 'view', disable: true}, {type: 'review', disable: true}]}).kit.offline(), false,
        'other locks are no lost connection');
    assert.equal(editor({stack: [{type: 'reconnect', disable: false}]}).kit.offline(), false, 'a lifted lock does not count');
    assert.equal(editor({disconnected: true}).kit.offline(), true, 'a session closed for good is offline');
    const entries = under.kit.stackEntries();
    assert.deepEqual(Array.from(entries, e => e.type), ['reconnect', 'signature'], 'entries in force, from the bottom');
    assert.deepEqual(Array.from(editor({stack: [{type: 'view', disable: false}, {type: 'review', disable: true}]})
        .kit.stackEntries(), e => e.type), ['review'], 'lifted entries are left out');
    const noMain = editor({stack: [{type: 'reconnect', disable: true}]});
    delete noMain.controllers.Main;
    assert.deepEqual(Array.from(noMain.kit.stackEntries()), [], 'without Main the stack is empty');
    assert.equal(noMain.kit.offline(), false);
});

check('download stays alive after an editing error', () => {
    /* Main keeps downloading and printing after an editing error (api:disconnect with true); the
       adapter of the editor keeps that flag and gives it to the kit. */
    const e = editor({stack: [{type: 'disconnect', disable: true}]});
    let kept = false;
    const kit = e.Kit.create({controller: name => e.controllers[name] || null, api: e.api, downloadKept: () => kept});
    assert.equal(kit.offline('download'), true, 'before the error download is offline as well');
    kept = true;
    assert.equal(kit.offline('download'), false, 'download and print stay');
    assert.equal(kit.offline(), true, 'other items are still offline');
    e.s.stack = [{type: 'reconnect', disable: true}];
    assert.equal(kit.offline('download'), true, 'a reconnect is still offline for download');
    e.s.stack = [];
    e.s.disconnected = true;
    assert.equal(kit.offline('download'), true, 'a session closed for good is offline for download');
    assert.equal(e.kit.offline('download'), true, 'without the flag of the editor nothing is kept');
});

check('shortcut is the first visible key of the stock registry', () => {
    const e = editor({shortcuts: {Save: [['Ctrl', 'S'], ['Shift', 'F12']], Empty: [], Broken: 'throws'}});
    assert.equal(e.kit.shortcut({k: 'file.save', sc: 'Save'}), 'Ctrl+S');
    assert.deepEqual(e.log.filter(x => x.registry).map(x => [x.registry, !!x.withHidden]), [['Save', false]],
        'hidden shortcuts are left to the registry');
    assert.equal(e.kit.shortcut({k: 'file.rename'}), null, 'an item without a command shortcut');
    assert.equal(e.kit.shortcut(null), null);
    assert.equal(e.kit.shortcut({sc: 'Unknown'}), null, 'a command the registry does not know');
    assert.equal(e.kit.shortcut({sc: 'Empty'}), null, 'a command whose keys are all hidden');
    assert.equal(e.kit.shortcut({sc: 'Broken'}), null, 'a failing registry');
    delete e.controllers['Common.Controllers.Shortcuts'];
    assert.equal(e.kit.shortcut({sc: 'Save'}), null, 'without the registry');
});

check('release does not return the keyboard while a modal window is open', () => {
    const e = editor({});
    e.kit.keys.release();
    assert.deepEqual(keyCalls(e.log), [], 'nothing held, nothing returned');
    e.kit.keys.hold();
    assert.deepEqual(keyCalls(e.log), [false], 'hold takes the engine keyboard');
    e.s.modal = true;
    e.kit.keys.release();
    assert.deepEqual(keyCalls(e.log), [false], 'the window gives the keyboard back itself');
    e.s.modal = false;
    e.kit.keys.release();
    assert.deepEqual(keyCalls(e.log), [false], 'the hold is over already');
    e.kit.keys.hold();
    e.kit.keys.release();
    assert.deepEqual(keyCalls(e.log), [false, false, true], 'without a window release gives the keyboard back');
    e.kit.keys.hold();
    e.kit.keys.beforeCommand();
    e.kit.keys.beforeCommand();
    assert.deepEqual(keyCalls(e.log), [false, false, true, false, true], 'before a command the keyboard goes back once');
    const bare = editor({});
    const kit = bare.Kit.create({controller: () => null, api: null});
    kit.keys.hold();
    kit.keys.release();
    assert.deepEqual(keyCalls(bare.log), [], 'without an api nothing is called');
});

check('blocked while a load mask is visible', () => {
    assert.equal(editor({}).kit.blocked(), false, 'nothing covers the editor');
    assert.equal(editor({modal: true}).kit.blocked(), true, 'a stock window');
    assert.equal(editor({masks: [false, true]}).kit.blocked(), true, 'a shown loading mask');
    assert.equal(editor({masks: [false]}).kit.blocked(), false, 'a hidden loading mask');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
