/* Run: node test/unit-tests/common/compact/shells.cjs [path to Shells.js]
 * The stock review controller (lib/controller/ReviewChanges.js) is common to the editors, so it
 * does not ask an editor whether its compact shell is on: the shell of the editor registers itself
 * in the shared layer (Common.UI.Compact.Shells) and the controller asks the registry.
 * A registered shell tells whether it is picked in the editor config (wanted), whether the personal
 * track changes mode off follows the document-wide flag (personalReviewFollowsShared: the local flag
 * of the engine is null, not false) and the text of the lock of the personal off variant while
 * track changes for everyone is on (forAllText). Without a picked shell the controller keeps the
 * stock false.
 * The registry and the controller run in vm without jQuery and editor namespaces; the controller
 * base and the view are stand-ins. The optional argument points to a broken copy of the registry
 * for a negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../../..');
const SHELLS = process.argv[2] ? path.resolve(process.argv[2]) :
    path.join(ROOT, 'apps/common/main/lib/view/compact/Shells.js');
const RC = path.join(ROOT, 'apps/common/main/lib/controller/ReviewChanges.js');

/* A fresh page: the registry, then the stock review controller. decoy — editor namespaces with a
   compact shell of their own, which the controller must not read. */
function page(decoy) {
    const G = {define: (dependencies, factory) => factory(), console};
    G.window = G;
    G.Backbone = {Controller: {extend: proto => proto}};
    G._ = {extend: Object.assign, bind: (fn, self, ...args) => fn.bind(self, ...args)};
    G.Common = {Controllers: {}, Views: {}, UI: {}, Utils: {InternalSettings: {set() {}, get() {}}}};
    if (decoy) Object.assign(G, decoy);
    vm.createContext(G);
    vm.runInContext(fs.readFileSync(SHELLS, 'utf8'), G, {filename: SHELLS});
    for (const name of ['$', 'jQuery'])
        assert.equal(G[name], undefined, name + ' appeared while loading the shell registry');
    const Shells = G.Common.UI.Compact && G.Common.UI.Compact.Shells;
    assert.ok(Shells && typeof Shells.register === 'function' && typeof Shells.current === 'function',
        'Common.UI.Compact.Shells is defined');
    vm.runInContext(fs.readFileSync(RC, 'utf8'), G, {filename: RC});
    return {G, Shells};
}

/* The stock controller of a user who can review, with an engine that records the local flag. */
function controller(G) {
    const calls = [];
    const rc = Object.create(G.Common.Controllers.ReviewChanges);
    Object.assign(rc, {
        api: {asc_SetLocalTrackRevisions: v => calls.push(v), asc_SetGlobalTrackRevisions() {}},
        appConfig: {canReview: true, isReviewOnly: false}
    });
    rc.localFlags = calls;
    return rc;
}

/* The personal "off" the controller writes when the user turns the personal mode off. */
function personalOff(rc) {
    rc.onTurnPreview(false);
    return rc.localFlags[rc.localFlags.length - 1];
}

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

const FOR_ALL = 'Turned on for everyone';

check('review changes asks the registered shell, not an editor namespace', () => {
    const shellOfEditor = {wanted: () => true};
    const decoy = {DE: {Views: {CompactShell: shellOfEditor}}, SSE: {Views: {CompactShell: shellOfEditor}}};
    const lone = page(decoy);
    assert.equal(lone.Shells.current(), null, 'no shell registered');
    assert.equal(controller(lone.G).trackRevisionsOff(), false, 'an editor namespace is not asked');

    const {G, Shells} = page(decoy);
    let picked = false;
    const seen = [];
    const record = Shells.register({
        wanted: config => { seen.push(config); return picked; },
        personalReviewFollowsShared: true,
        forAllText: () => FOR_ALL
    });
    const rc = controller(G);
    assert.equal(Shells.current(), null, 'a shell not picked in the config is not current');
    assert.equal(rc.trackRevisionsOff(), false);
    picked = true;
    assert.equal(Shells.current(), record, 'the picked shell is current');
    assert.equal(rc.trackRevisionsOff(), null);
    assert.ok(seen.every(config => config === undefined), 'the shell reads the config of its editor itself');
});

check('without a registered shell the personal off value stays false', () => {
    const {G, Shells} = page();
    const rc = controller(G);
    assert.equal(rc.trackRevisionsOff(), false);
    assert.equal(personalOff(rc), false, 'turning the personal mode off writes false');
    assert.equal(rc.turnOffMineLock(true), null, 'the personal off variant is not locked');

    Shells.register({wanted: () => true, personalReviewFollowsShared: false, forAllText: () => FOR_ALL});
    assert.equal(rc.trackRevisionsOff(), false, 'a shell that does not follow the shared flag keeps false');
    assert.equal(rc.turnOffMineLock(true), null);

    const broken = page();
    broken.Shells.register({wanted: () => { throw new Error('config'); }, personalReviewFollowsShared: true});
    assert.equal(broken.Shells.current(), null, 'a failing shell is not current');
    assert.equal(controller(broken.G).trackRevisionsOff(), false);
});

check('the shell that follows the shared flag gets null and the for-all lock text', () => {
    const {G, Shells} = page();
    Shells.register({wanted: () => false, personalReviewFollowsShared: false, forAllText: () => 'other'});
    Shells.register({wanted: () => true, personalReviewFollowsShared: true, forAllText: () => FOR_ALL});
    const rc = controller(G);
    assert.equal(rc.trackRevisionsOff(), null);
    assert.equal(personalOff(rc), null, 'turning the personal mode off follows the document-wide flag');
    rc.onTurnPreview(true);
    assert.equal(rc.localFlags[rc.localFlags.length - 1], true, 'on stays true');
    assert.equal(rc.turnOffMineLock(true), FOR_ALL, 'locked with the text of the shell while track changes for everyone is on');
    assert.equal(rc.turnOffMineLock(false), null, 'not locked while it is off');

    const silent = page();
    silent.Shells.register({wanted: () => true, personalReviewFollowsShared: true});
    assert.equal(controller(silent.G).turnOffMineLock(true), '', 'a shell without a text locks without a hint');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
