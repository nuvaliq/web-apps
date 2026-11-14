/* Run: node test/unit-tests/documenteditor/compact-menu-own-view.cjs
 * The compact menu of the document editor in the own view of a user with the edit right, over the
 * stock parts that take the rights out of the editor options for it: LeftMenu takes isEdit and canEdit
 * (controller/LeftMenu.js, SetDisabled), ReviewChanges takes canReview and Comments takes canComments in
 * their preview mode (lib/controller/ReviewChanges.js and Comments.js, updatePreviewMode). Each keeps the
 * values before the lock and gives them back after it. The menu keeps the items of the session rights:
 * edit, review and comment items stay, greyed with the view reason, and do nothing; commenting stays off.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs, with these stock
 * controllers sharing one options object, as the editor gives them Main.appOptions.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const docs = require('../common/compact/lib/documents-editor.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const command = k => G.DE.Views.DocumentActions.command(k);

G.Backbone = {Controller: {extend: proto => proto}};
G._.bind = (fn, self, ...args) => fn.bind(self, ...args);
G.Common.enumLock = G.Common.enumLock || {};
for (const file of ['apps/common/main/lib/controller/ReviewChanges.js', 'apps/common/main/lib/controller/Comments.js',
    'apps/documenteditor/main/app/controller/LeftMenu.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), G, {filename: path.join(ROOT, file)});

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* The lock of the own view as Main.onDocModeApply raises it, and the entry it leaves in the lock stack. */
const OWN_VIEW_OPTIONS = {viewMode: false, reviewMode: false, fillFormMode: false, viewDocMode: true,
    leftMenu: {disable: true, previewMode: true}, comments: {disable: false, previewMode: true}, chat: false,
    navigation: {disable: false, previewMode: true}, review: true};
const OWN_VIEW = {type: 'view', options: OWN_VIEW_OPTIONS};
const NO_PROTECTION = () => ({isReadOnly: false, isReviewOnly: false, isFormsOnly: false, isCommentsOnly: false});

/* An editor whose stock LeftMenu, ReviewChanges and Comments share the options of Main. lock(disable)
   does what Main.onEditingDisable does with these parts for the own view. */
function editor(overrides) {
    const ctx = docs.context(overrides);
    const options = Object.assign({}, ctx.main.appOptions);
    Object.defineProperty(ctx.main, 'appOptions', {get: () => options});
    const button = () => ({setDisabled() {}});
    const leftMenu = Object.assign(Object.create(G.DE.Controllers.LeftMenu), {mode: options, leftMenu: {
        _state: {}, close() {}, btnComments: button(), btnChat: button(), btnNavigation: button(),
        setDisabledPluginButtons() {}
    }});
    const review = Object.assign(Object.create(G.Common.Controllers.ReviewChanges), {
        appConfig: options, _state: {disableEditing: false, docProtection: NO_PROTECTION()}, lockToolbar() {}
    });
    const comments = Object.assign(Object.create(G.Common.Controllers.Comments), {
        mode: options, _state: {disableEditing: false, docProtection: NO_PROTECTION()},
        closeEditing() {}, setMode() {}, updateComments() {}, getPopover: () => null
    });
    const stock = {LeftMenu: leftMenu, 'Common.Controllers.ReviewChanges': review, 'Common.Controllers.Comments': comments};
    const getController = G.DE.getController;
    G.DE.getController = name => (stock[name] || getController(name));
    ctx.restore = () => { G.DE.getController = getController; };
    ctx.shared = options;
    ctx.lock = disable => {
        ctx.stack = disable ? [OWN_VIEW] : [];
        review.SetDisabled(disable, false, false);
        leftMenu.SetDisabled(disable, OWN_VIEW_OPTIONS);
        comments.setPreviewMode(disable);
    };
    return ctx;
}
function using(overrides, fn) {
    const ctx = editor(overrides);
    try { return fn(ctx); } finally { ctx.restore(); }
}

/* Snapshot of items: 'hidden' or [disabled, reason, checked]. */
function look(ctx, keys) {
    const out = {};
    for (const k of keys) {
        const st = Model.state(command(k), ctx);
        out[k] = st.visible ? [st.disabled, st.reason, st.checked] : 'hidden';
    }
    return out;
}
/* Keys of the whole menu as it is shown. */
function shownKeys(ctx) {
    const out = [];
    for (const s of docs.sections()) {
        const snap = Model.section(s.items, ctx);
        if (!snap.visible) continue;
        out.push(s.k);
        (function walk(rows) {
            for (const r of rows) { if (r.k !== undefined) out.push(r.k); if (r.rows) walk(r.rows); }
        })(snap.rows);
    }
    return out;
}

const ITEMS = ['insert.comment', 'collab.track', 'collab.trackAll', 'collab.show', 'collab.markup', 'collab.final',
    'collab.original', 'collab.changes', 'collab.prev', 'collab.next', 'collab.accept', 'collab.reject',
    'collab.acceptAll', 'collab.rejectAll', 'collab.compare', 'edit.undo', 'insert.image', 'format.margins'];
const GREYED = ['insert.comment', 'collab.track', 'collab.trackAll', 'collab.markup', 'collab.final', 'collab.original',
    'collab.accept', 'collab.reject', 'collab.acceptAll', 'collab.rejectAll', 'collab.compare', 'edit.undo',
    'insert.image', 'format.margins'];

check('the stock parts take the edit, review and comment rights out of the options in the own view', () => {
    using({}, ctx => {
        ctx.lock(true);
        assert.deepEqual([ctx.shared.isEdit, ctx.shared.canEdit, ctx.shared.canReview, ctx.shared.canComments],
            [false, false, false, false]);
        ctx.lock(false);
        assert.deepEqual([ctx.shared.isEdit, ctx.shared.canEdit, ctx.shared.canReview, ctx.shared.canComments],
            [true, true, true, true]);
    });
});

check('own view keeps the whole menu with review and comment items greyed with the view reason', () => {
    using({changes: true, atChange: true}, ctx => {
        const whole = shownKeys(ctx);
        const before = look(ctx, ITEMS);
        ctx.lock(true);
        assert.deepEqual(shownKeys(ctx), whole);
        const now = look(ctx, GREYED);
        for (const k of GREYED) assert.deepEqual(now[k].slice(0, 2), [true, 'view'], k);
        /* Going through the changes does not change the document. */
        assert.deepEqual(look(ctx, ['collab.prev', 'collab.next']),
            {'collab.prev': [false, null, false], 'collab.next': [false, null, false]});
        /* State reads ask the engine too: only what the clicks do counts. */
        ctx.log.length = 0;
        for (const k of ['insert.comment', 'collab.track', 'collab.trackAll', 'collab.markup', 'collab.accept'])
            assert.equal(ctx.real.exec(command(k)), false, k + ' does not run');
        assert.deepEqual(ctx.log.filter(e => e.api || e.event || e.shell), [], 'no engine, event or shell call');
        assert.equal(ctx.shell.canAddComment(), false, 'commenting stays off in the view');
        ctx.lock(false);
        assert.deepEqual(look(ctx, ITEMS), before, 'back to editing: as before');
        assert.equal(ctx.shell.canAddComment(), true);
    });
});

check('own view of a user without the review or comment right keeps them hidden', () => {
    for (const [right, hidden] of [['review', ['collab.track', 'collab.trackAll', 'collab.show', 'collab.changes', 'collab.compare']],
        ['comments', ['insert.comment']]]) {
        using({[right]: false}, ctx => {
            const whole = shownKeys(ctx);
            for (const k of hidden) assert.equal(whole.includes(k), false, k + ' without the ' + right + ' right');
            ctx.lock(true);
            assert.deepEqual(shownKeys(ctx), whole, right);
            ctx.lock(false);
            assert.deepEqual(shownKeys(ctx), whole, right);
        });
    }
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
