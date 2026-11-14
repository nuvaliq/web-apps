/* Run: node test/unit-tests/documenteditor/compact-review-modes.cjs
 * Personal and document-wide change tracking in the compact shell of the document editor.
 * The personal mode is the local flag of the engine: on is true, off is null, and null follows the
 * document-wide flag (sdkjs word/Editor/Document.js, IsTrackRevisions). The stock interface turns the
 * personal mode off with false, which hides the document-wide flag from that user; it keeps doing so
 * outside the compact shell and after its start is rolled back.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs, together with
 * the stock review controller and view (lib/controller/ReviewChanges.js, lib/view/ReviewChanges.js), the shared
 * menu bar for the texts of the common reasons, the shared registry the shell registers in and the controller asks
 * (lib/view/compact/Shells.js) and the compact shell (app/view/CompactShell.js). Each user has
 * an engine that keeps its own local flag; the document keeps the document-wide one and tells every co-author
 * about its change.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const docs = require('../common/compact/lib/documents-editor.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const actions = G.DE.Views.DocumentActions;
const command = k => actions.command(k);
const state = (k, ctx) => Model.state(command(k), ctx);
const exec = (ctx, k) => docs.adapter(ctx).exec(command(k));
/* [checked, disabled, reason] of an item. */
const look = (k, ctx) => { const st = state(k, ctx); return [st.checked, st.disabled, st.reason]; };

/* The stock controller and view and the shell in the same vm as the catalog. The stock button and menu
   controls are stand-ins: a menu item keeps its checked and disabled state and its hint, as
   common/main/lib/component/MenuItem.js does. */
G.Backbone = {Controller: {extend: proto => proto}};
G._.bind = (fn, self, ...args) => fn.bind(self, ...args);
G.Common.enumLock = G.Common.enumLock || {};
G.navigator = G.navigator || {platform: 'Linux'};
function MenuItem(o) {
    this.options = Object.assign({hint: false}, o);
    this.value = o.value;
    this.checked = !!o.checked;
    this.disabled = !!o.disabled;
}
MenuItem.prototype = {
    setChecked(v) { this.checked = !!v; }, setDisabled(v) { this.disabled = !!v; },
    isDisabled() { return this.disabled; }, updateHint(hint) { this.options.hint = hint; }
};
G.Common.UI = Object.assign(G.Common.UI || {}, {
    BaseView: {extend: proto => proto},
    Window: {extend: proto => proto},
    Menu: function (o) { this.items = o.items.map(i => new MenuItem(i)); },
    Button: function (o) { Object.assign(this, o); this.pressed = false; },
    LayoutManager: {addControls() {}}
});
G.Common.UI.Button.prototype = {toggle(v) { this.pressed = !!v; }};
for (const file of ['apps/common/main/lib/view/compact/MenuBar.js', 'apps/common/main/lib/view/compact/Shells.js',
    'apps/common/main/lib/controller/ReviewChanges.js', 'apps/common/main/lib/view/ReviewChanges.js',
    'apps/documenteditor/main/app/view/CompactShell.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), G, {filename: path.join(ROOT, file)});
const shell = G.DE.Views.CompactShell;
const FOR_ALL = 'Turned on for everyone';

let passed = 0, failed = 0;
async function check(name, fn) {
    try { await fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* The stock controller finishes its start in a promise. */
const settle = () => new Promise(resolve => setImmediate(resolve));

/* Only the handler of this test answers a notification. */
function listen(name, fn) {
    G.__handlers[name] = [fn];
}

/* The document and its co-authors. join() gives a user an engine with the local flag; changing the
   document-wide flag reports it to every user, to the co-authors with the id of the one who changed it
   (sdkjs CChangesDocumentSettingsTrackRevisions.Load). */
function documentFile() {
    return {global: false, users: []};
}
function join(file, name) {
    const user = {name, local: null, callbacks: {}, notify: () => {}};
    user.engine = {
        asc_SetLocalTrackRevisions(v) { user.local = v; user.notify(); },
        asc_GetLocalTrackRevisions: () => user.local,
        asc_SetGlobalTrackRevisions(v) {
            file.global = v;
            file.users.forEach(u => u.notify(u === user ? undefined : name));
        },
        asc_GetGlobalTrackRevisions: () => file.global,
        asc_IsTrackRevisions: () => (user.local === null ? file.global === true : user.local),
        asc_HaveRevisionsChanges: () => false
    };
    user.tracked = () => user.engine.asc_IsTrackRevisions();
    file.users.push(user);
    return user;
}

/* The stock review controller of a user, set up as onLaunch and setApi do, with the stock view that records
   the mode the controller shows. */
function controller(api, config) {
    const rc = Object.create(G.Common.Controllers.ReviewChanges);
    Object.assign(rc, {
        api, appConfig: config, appPrefix: 'de-', viewmode: false, turns: [],
        _state: {docProtection: {isReadOnly: false, isReviewOnly: false, isFormsOnly: false, isCommentsOnly: false},
            wsProps: [], sdkchange: null},
        lockToolbar() {}, onApiShowChange() {}, turnDisplayMode() {}, onChangeProtectSheet() {}
    });
    rc.view = Object.assign(Object.create(G.Common.Views.ReviewChanges), {
        appConfig: config, btnsTurnReview: [], lockedControls: [],
        turnChanges: (s, g) => rc.turns.push([!!s, !!g]), markChanges() {}, turnDisplayMode() {}, onAppReady() {}
    });
    return rc;
}

/* Me in the editor with the compact menu, and a co-author with the stock controller only. shellOn is
   the shell picked in the editor config (ui.shell); failed — its start was rolled back. */
function session(opts) {
    const o = Object.assign({shellOn: true, failed: false, reviewOnly: false, customization: {}}, opts);
    const file = documentFile();
    const me = join(file, 'me'), other = join(file, 'other');
    const ctx = docs.context();
    ctx.engine = me.engine;
    me.notify = id => ctx.fire('asc_onOnTrackRevisionsChange', me.local, file.global, id);
    const base = ctx.main.appOptions;
    Object.defineProperty(ctx.main, 'appOptions', {
        get: () => Object.assign({}, base, {isReviewOnly: o.reviewOnly, canSwitchMode: true})
    });
    ctx.main.editorConfig = o.shellOn ? {ui: {shell: 'modern'}} : {};
    shell.startupFailed = o.failed;
    const config = {canReview: true, isReviewOnly: o.reviewOnly, customization: o.customization};
    const rc = controller(ctx.api, config);
    ctx.api.asc_registerCallback('asc_onOnTrackRevisionsChange', (...args) => rc.onApiTrackRevisionsChange(...args));
    listen('reviewchanges:turn', (...args) => rc.onTurnPreview(...args));

    const otherApi = Object.assign({}, other.engine, {
        asc_registerCallback(name, fn) { (other.callbacks[name] = other.callbacks[name] || []).push(fn); }
    });
    other.notify = id => (other.callbacks.asc_onOnTrackRevisionsChange || []).forEach(fn => fn(other.local, file.global, id));
    const otherRc = controller(otherApi, {canReview: true, isReviewOnly: false, customization: {}});
    otherApi.asc_registerCallback('asc_onOnTrackRevisionsChange', (...args) => otherRc.onApiTrackRevisionsChange(...args));
    return {file, me, other, ctx, rc, otherRc, config};
}

/* An item of the header mode switch, as jQuery keeps it: classes and attributes. */
function modeItem() {
    const item = {classes: new Set(), attrs: {}};
    item.toggleClass = (name, on) => { item.classes[on ? 'add' : 'delete'](name); return item; };
    item.attr = (name, value) => { item.attrs[name] = value; return item; };
    item.removeAttr = name => { delete item.attrs[name]; return item; };
    return item;
}
function header() {
    shell.modeItems = {edit: modeItem(), review: modeItem(), view: modeItem()};
    shell.applyDocModeLook = () => {};
    return shell.modeItems;
}
const greyed = item => [item.classes.has('vo-locked'), item.attrs['aria-disabled'], item.attrs.title];
/* [disabled, hint] of the "off for me" variant of a stock track changes button. */
const offMine = button => [button.menu.items[1].disabled, button.menu.items[1].options.hint || null];

(async () => {
    await check('personal mode tracks only my edits', () => {
        const s = session();
        assert.equal(exec(s.ctx, 'collab.track'), true);
        assert.equal(s.me.local, true);
        assert.equal(s.file.global, false, 'the document-wide flag stays off');
        assert.equal(s.me.tracked(), true);
        assert.equal(s.other.tracked(), false);
        assert.deepEqual(look('collab.track', s.ctx), [true, false, null]);
        assert.deepEqual(look('collab.trackAll', s.ctx), [false, false, null]);
    });

    await check('global mode tracks a user who chose editing', () => {
        const s = session();
        s.otherRc.onTurnPreview(true);
        s.otherRc.onTurnPreview(false);
        assert.equal(s.other.local, null, 'editing is the personal mode off');
        assert.equal(exec(s.ctx, 'collab.trackAll'), true);
        assert.equal(s.file.global, true);
        assert.equal(s.me.tracked(), true);
        assert.equal(s.other.tracked(), true);
        assert.deepEqual(s.otherRc.turns.pop(), [true, true], 'the co-author sees the document-wide mode');
    });

    await check('turning global off keeps personal mode on', () => {
        const s = session();
        exec(s.ctx, 'collab.track');
        exec(s.ctx, 'collab.trackAll');
        assert.deepEqual([s.me.local, s.file.global], [true, true]);
        assert.equal(exec(s.ctx, 'collab.trackAll'), true);
        assert.deepEqual([s.me.local, s.file.global], [true, false]);
        assert.equal(s.me.tracked(), true);
        assert.deepEqual(look('collab.track', s.ctx), [true, false, null]);
    });

    await check('personal item is checked and greyed with the for-all reason while global is on', () => {
        const s = session();
        s.other.engine.asc_SetGlobalTrackRevisions(true);
        assert.deepEqual(look('collab.track', s.ctx), [true, true, 'forAll']);
        assert.deepEqual(look('collab.trackAll', s.ctx), [true, false, null]);
        assert.equal(exec(s.ctx, 'collab.track'), false, 'a greyed item does not run');
        assert.equal(s.me.local, null);
        const viewer = docs.context({rights: 'view'});
        assert.equal(state('collab.trackAll', viewer).visible, false, 'only users with the edit right see it');
        const protectedDoc = docs.context({protection: {isReviewOnly: true}, track: true});
        assert.deepEqual(look('collab.trackAll', protectedDoc).slice(1), [true, 'protected']);
    });

    await check('header editing is greyed with the for-all reason while global is on', () => {
        const s = session();
        const items = header();
        shell.applyForAllLock();
        assert.deepEqual(greyed(items.edit), [false, 'false', undefined]);
        exec(s.ctx, 'collab.trackAll');
        shell.applyForAllLock();
        assert.deepEqual(greyed(items.edit), [true, 'true', FOR_ALL]);
        assert.deepEqual(greyed(items.review), [false, undefined, undefined]);
        const events = [];
        listen('doc:mode-apply', (...args) => events.push(args));
        shell.setDocMode('edit');
        assert.deepEqual(events, [], 'editing is not applied');
        shell.setDocMode('review');
        assert.deepEqual(events, [['review', true]]);
        exec(s.ctx, 'collab.trackAll');
        shell.applyForAllLock();
        assert.deepEqual(greyed(items.edit), [false, 'false', undefined]);
    });

    await check('co-author change refreshes an open menu', () => {
        const s = session();
        const items = header();
        let refreshed = 0;
        shell.api = s.ctx.api;
        shell.menu = {refresh: () => { refreshed++; }};
        shell.bindMenuRefresh();
        assert.deepEqual(look('collab.track', s.ctx), [false, false, null]);
        s.other.engine.asc_SetGlobalTrackRevisions(true);
        assert.ok(refreshed > 0, 'the open menu reads its items again');
        assert.deepEqual(look('collab.track', s.ctx), [true, true, 'forAll']);
        assert.deepEqual(look('collab.trackAll', s.ctx), [true, false, null]);
        assert.deepEqual(greyed(items.edit), [true, 'true', FOR_ALL]);
        assert.deepEqual(s.rc.turns.pop(), [true, true], 'the stock controller shows the document-wide mode');
        shell.menu = null;
        shell.api = null;
    });

    await check('ribbon off-for-me is greyed with the for-all reason while global is on', () => {
        const s = session();
        const button = s.rc.view.getButton('turn', 'statusbar');
        assert.deepEqual(offMine(button), [false, null]);
        s.other.engine.asc_SetGlobalTrackRevisions(true);
        assert.deepEqual(offMine(button), [true, FOR_ALL], 'it would give null, which follows the document-wide flag');
        assert.deepEqual([...button.menu.items].map(item => item.disabled), [false, true, false, false]);
        const later = s.rc.view.getButton('turn', 'statusbar');
        assert.deepEqual(offMine(later), [true, FOR_ALL], 'a button made after the change');
        /* My own mode on top of the global one: turning it off still keeps tracking. */
        s.rc.onTurnPreview(true);
        assert.deepEqual(offMine(button), [true, FOR_ALL]);
        s.rc.onTurnPreview(false);
        assert.equal(s.me.tracked(), true, 'tracking is not turned off');
        s.other.engine.asc_SetGlobalTrackRevisions(false);
        assert.deepEqual(offMine(button), [false, null]);
        assert.deepEqual(offMine(later), [false, null]);
    });

    await check('ribbon off-for-me stays available outside the compact shell', () => {
        const s = session({shellOn: false});
        const button = s.rc.view.getButton('turn', 'statusbar');
        s.other.engine.asc_SetGlobalTrackRevisions(true);
        assert.deepEqual(offMine(button), [false, null]);
        s.rc.onTurnPreview(false);
        assert.equal(s.me.local, false);
        assert.equal(s.me.tracked(), false, 'the stock variant turns my tracking off');
        const rolledBack = session({failed: true});
        const stock = rolledBack.rc.view.getButton('turn', 'statusbar');
        rolledBack.other.engine.asc_SetGlobalTrackRevisions(true);
        assert.deepEqual(offMine(stock), [false, null]);
        shell.startupFailed = false;
    });

    await check('review-only user stays in review', async () => {
        const s = session({reviewOnly: true});
        s.rc.onAppReady(s.config);
        await settle();
        assert.equal(s.me.local, true);
        s.other.engine.asc_SetGlobalTrackRevisions(true);
        s.other.engine.asc_SetGlobalTrackRevisions(false);
        assert.equal(s.me.tracked(), true);
        assert.deepEqual(s.rc.turns.slice(-2), [[true, false], [true, false]]);
        G.Common.NotificationCenter.trigger('reviewchanges:turn', false);
        assert.equal(s.me.local, true, 'the switch cannot turn review off');
        assert.deepEqual(look('collab.track', s.ctx).slice(0, 2), [true, true]);
        assert.equal(state('collab.trackAll', s.ctx).visible, false);
    });

    await check('review-only protection removal keeps the global mode in compact', () => {
        const s = session();
        s.other.engine.asc_SetGlobalTrackRevisions(true);
        s.rc.onChangeProtectDocument({isReviewOnly: true});
        assert.equal(s.me.local, true);
        s.rc.onChangeProtectDocument({isReviewOnly: false});
        assert.equal(s.me.local, null);
        assert.equal(s.me.tracked(), true);
    });

    await check('delayed shell start with track changes false keeps the global mode', async () => {
        const s = session({customization: {review: {trackChanges: false}}});
        assert.equal(shell.booted, false, 'the shell is not built yet');
        s.other.engine.asc_SetGlobalTrackRevisions(true);
        s.rc.onAppReady(s.config);
        await settle();
        assert.equal(s.me.local, null);
        assert.equal(s.me.tracked(), true);
        const on = session({customization: {trackChanges: true}});
        on.rc.onAppReady(on.config);
        await settle();
        assert.equal(on.me.local, true, 'a host that turns tracking on still turns it on');
    });

    await check('stock interface keeps the stock false semantics', async () => {
        const s = session({shellOn: false, customization: {review: {trackChanges: false}}});
        s.rc.onAppReady(s.config);
        await settle();
        assert.equal(s.me.local, false);
        s.rc.onTurnPreview(true);
        s.rc.onTurnPreview(false);
        assert.equal(s.me.local, false);
        s.other.engine.asc_SetGlobalTrackRevisions(true);
        assert.equal(s.me.tracked(), false);
        s.rc.onChangeProtectDocument({isReviewOnly: true});
        s.rc.onChangeProtectDocument({isReviewOnly: false});
        assert.equal(s.me.local, false);
        assert.equal(shell.wanted(), false);
    });

    await check('startup rollback returns the stock semantics', () => {
        const s = session({failed: true});
        s.rc.onTurnPreview(true);
        s.rc.onTurnPreview(false);
        assert.equal(s.me.local, false);
        s.rc.onChangeProtectDocument({isReviewOnly: true});
        s.rc.onChangeProtectDocument({isReviewOnly: false});
        assert.equal(s.me.local, false);
        shell.startupFailed = false;
    });

    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})();
