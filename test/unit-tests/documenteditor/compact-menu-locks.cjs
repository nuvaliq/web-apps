/* Run: node test/unit-tests/documenteditor/compact-menu-locks.cjs
 * Why a compact menu item of the document editor is greyed: the adapter (CompactMenuAdapter)
 * reads the stock editor — the lock stack of Main, the limit of simultaneous editing, the final
 * disconnect, the rights, the display mode of the review and the document protection — and gives
 * each item the senior common reason; items that need only the connection get only "no connection".
 * A locked item is not run. The shell (CompactShell) refreshes the open menu on the stock events.
 * The catalog, the adapter and the shell run in vm over the stand-ins of lib/documents-editor.cjs.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const SHELL = path.join(ROOT, 'apps/documenteditor/main/app/view/CompactShell.js');
const docs = require('../common/compact/lib/documents-editor.cjs');

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const command = k => G.DE.Views.DocumentActions.command(k);

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* Snapshot of items in the state: [disabled, reason] by key. */
function states(ctx, keys) {
    const out = {};
    for (const k of keys) {
        const st = Model.state(command(k), ctx);
        assert.equal(st.visible, true, k + ' is shown');
        out[k] = st.disabled ? st.reason || 'greyed' : 'on';
    }
    return out;
}
const EDIT = ['edit.undo', 'insert.image', 'format.margins'];
const NET = ['file.rename', 'collab.share', 'collab.history'];
const FILE_OUT = ['file.download', 'file.print'];
const all = (keys, value) => Object.fromEntries(keys.map(k => [k, value]));

check('limit reason outranks offline after the limit drops the connection', () => {
    const ctx = docs.context({license: 'Connections', disconnected: true, stack: [{type: 'disconnect'}]});
    assert.deepEqual(states(ctx, EDIT), all(EDIT, 'limit'));
    assert.deepEqual(states(ctx, NET.concat(FILE_OUT)), all(NET.concat(FILE_OUT), 'offline'));
    for (const name of ['UsersCount', 'ConnectionsOS', 'UsersCountOS'])
        assert.equal(Model.state(command('edit.undo'), docs.context({license: name, disconnected: true})).reason, 'limit', name);
    assert.equal(Model.state(command('edit.undo'), docs.context({license: 'Success'})).disabled, false,
        'another licence result is no limit');
});

check('temporary disconnect greys edit items with the offline reason', () => {
    const ctx = docs.context({stack: [{type: 'reconnect', options: {viewMode: true}}]});
    assert.deepEqual(states(ctx, EDIT.concat(NET, FILE_OUT)), all(EDIT.concat(NET, FILE_OUT), 'offline'));
    for (const type of ['refresh-file', 'disconnect', 'not-loaded'])
        assert.equal(Model.state(command('edit.undo'), docs.context({stack: [{type}]})).reason, 'offline', type);
    /* The stack is read whole: a reason under another one counts as well. */
    const under = docs.context({stack: [{type: 'reconnect'}, {type: 'signature', options: {viewMode: true}}]});
    assert.equal(Model.state(command('edit.undo'), under).reason, 'offline');
});

check('reconnect restores items without reload and refreshes an open menu', () => {
    const ctx = docs.context({stack: [{type: 'reconnect'}]});
    const shell = loadShell(ctx);
    assert.equal(Model.state(command('edit.undo'), ctx).reason, 'offline');
    const before = shell.refreshes;
    ctx.stack = [];
    ctx.trigger('editing:disable', false, {viewMode: false}, 'reconnect');
    assert.deepEqual(states(ctx, EDIT.concat(NET, FILE_OUT)), all(EDIT.concat(NET, FILE_OUT), 'on'));
    assert.ok(shell.refreshes > before, 'the open menu is refreshed');
});

check('disconnect over own view returns to the view reason after reconnect', () => {
    const ctx = docs.context({stack: [{type: 'view'}, {type: 'reconnect'}]});
    assert.deepEqual(states(ctx, EDIT), all(EDIT, 'offline'));
    ctx.stack = [{type: 'view'}];
    assert.deepEqual(states(ctx, EDIT), all(EDIT, 'view'));
    assert.deepEqual(states(ctx, NET), all(NET, 'on'));
});

check('final disconnect keeps the offline reason', () => {
    const ctx = docs.context({disconnected: true, stack: [{type: 'disconnect'}]});
    assert.deepEqual(states(ctx, EDIT.concat(NET, FILE_OUT)), all(EDIT.concat(NET, FILE_OUT), 'offline'));
    /* The stock takes the edit mode away on a closed session: the reason stays "no connection". */
    ctx.stack = [];
    ctx.editMode = false;
    assert.deepEqual(states(ctx, EDIT.concat(NET)), all(EDIT.concat(NET), 'offline'));
});

check('editing error keeps download and print', () => {
    const ctx = docs.context({stack: [{type: 'disconnect'}]});
    assert.deepEqual(states(ctx, FILE_OUT), all(FILE_OUT, 'offline'), 'before the stock allows the download');
    ctx.trigger('api:disconnect', true);
    assert.deepEqual(states(ctx, FILE_OUT), all(FILE_OUT, 'on'));
    assert.deepEqual(states(ctx, EDIT.concat(NET)), all(EDIT.concat(NET), 'offline'));
    /* A later loss of the connection greys them again. */
    ctx.stack = [{type: 'disconnect'}, {type: 'reconnect'}];
    assert.deepEqual(states(ctx, FILE_OUT), all(FILE_OUT, 'offline'));
    /* A plain disconnect without the download allowance keeps them grey. */
    const other = docs.context({stack: [{type: 'disconnect'}]});
    other.trigger('api:disconnect');
    assert.deepEqual(states(other, FILE_OUT), all(FILE_OUT, 'offline'));
});

check('own view greys edit items with the view reason', () => {
    const ctx = docs.context({stack: [{type: 'view', options: {viewDocMode: true}}]});
    assert.deepEqual(states(ctx, EDIT), all(EDIT, 'view'));
    assert.deepEqual(states(ctx, NET.concat(FILE_OUT)), all(NET.concat(FILE_OUT), 'on'));
    /* The viewMode flag of a disconnect is no view reason. */
    const lost = docs.context({stack: [{type: 'reconnect', options: {viewMode: true}}]});
    assert.ok(!lost.edit().includes('view'));
});

check('final and original display modes give their own reasons', () => {
    for (const mode of ['final', 'original']) {
        const ctx = docs.context({display: mode, stack: [{type: 'review', options: {reviewMode: true}}]});
        assert.deepEqual(states(ctx, EDIT), all(EDIT, mode), mode);
        /* The display items stay: they are the way back from the preview. */
        assert.deepEqual(states(ctx, ['collab.markup', 'collab.final', 'collab.original']),
            all(['collab.markup', 'collab.final', 'collab.original'], 'on'), mode);
    }
});

check('form filling gives the form reason', () => {
    const ctx = docs.context({stack: [{type: 'forms', options: {fillFormMode: true}}]});
    assert.deepEqual(states(ctx, EDIT.concat(['edit.selectAll', 'collab.markup'])),
        all(EDIT.concat(['edit.selectAll', 'collab.markup']), 'form'));
    assert.deepEqual(states(ctx, NET), all(NET, 'on'));
});

check('read-only protection gives the protected reason', () => {
    const ctx = docs.context({protection: {isReadOnly: true}});
    assert.deepEqual(states(ctx, EDIT.concat(['insert.comment', 'collab.track', 'collab.accept'])),
        all(EDIT.concat(['insert.comment', 'collab.track', 'collab.accept']), 'protected'));
    assert.deepEqual(states(ctx, NET.concat(FILE_OUT, ['edit.find', 'view.zoom'])),
        all(NET.concat(FILE_OUT, ['edit.find', 'view.zoom']), 'on'));
});

check('comment stays available under comments-only protection', () => {
    const ctx = docs.context({protection: {isCommentsOnly: true}});
    assert.equal(states(ctx, ['insert.comment'])['insert.comment'], 'on');
    assert.deepEqual(states(ctx, EDIT), all(EDIT, 'protected'));
});

check('review-only protection keeps editing and greys the personal review item checked', () => {
    const ctx = docs.context({protection: {isReviewOnly: true}, track: true});
    assert.deepEqual(states(ctx, EDIT.concat(['insert.comment'])), all(EDIT.concat(['insert.comment']), 'on'));
    const track = Model.state(command('collab.track'), ctx);
    assert.deepEqual([track.disabled, track.reason, track.checked], [true, 'protected', true]);
    assert.deepEqual(states(ctx, ['collab.accept', 'collab.rejectAll']), all(['collab.accept', 'collab.rejectAll'], 'protected'));
});

check('forms-only protection greys editing and comment with the protected reason', () => {
    const ctx = docs.context({protection: {isFormsOnly: true}});
    assert.deepEqual(states(ctx, EDIT.concat(['insert.comment'])), all(EDIT.concat(['insert.comment']), 'protected'));
    assert.deepEqual(states(ctx, FILE_OUT), all(FILE_OUT, 'on'));
});

check('connection-only item gets only the offline reason', () => {
    const busy = docs.context({reasons: ['view', 'final', 'form', 'protected']});
    assert.deepEqual(states(busy, NET.concat(FILE_OUT)), all(NET.concat(FILE_OUT), 'on'));
    assert.deepEqual(states(busy, EDIT), all(EDIT, 'view'));
    const limit = docs.context({reasons: ['limit', 'view', 'protected']});
    assert.deepEqual(states(limit, NET), all(NET, 'offline'));
    assert.deepEqual(states(limit, EDIT), all(EDIT, 'limit'));
});

check('host view without a limit signal shows the view reason', () => {
    const ctx = docs.context({editMode: false, editRight: true, requestEdit: true});
    assert.deepEqual(states(ctx, EDIT), all(EDIT, 'view'));
    assert.deepEqual(states(ctx, ['file.edit']), {'file.edit': 'on'});
    /* Opened for viewing because of the limit, the editor has no limit signal: still "view". */
    assert.ok(!ctx.edit().includes('limit'));
});

/* Keys of the whole menu as it is shown: the sections, their rows and the rows of their submenus. */
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

/* The stock lock of its own view (Main.onDocModeApply with force) and of a lost connection
   (Main.disableEditing): both take the left menu away, and the stock LeftMenu then takes isEdit and
   canEdit out of the editor options until the lock is lifted. */
const OWN_VIEW = {type: 'view', options: {viewDocMode: true, leftMenu: {disable: true, previewMode: true}}};
const RECONNECT = {type: 'reconnect', options: {viewMode: true, leftMenu: {disable: true, previewMode: true}}};

check('own view of a user with the edit right keeps the whole menu with edit items greyed', () => {
    const whole = shownKeys(docs.context());
    const view = docs.context({stack: [OWN_VIEW]});
    assert.deepEqual(shownKeys(view), whole);
    const items = EDIT.concat(['format.text.bold', 'edit.paste', 'collab.track']);
    assert.deepEqual(states(view, items), all(items, 'view'));
    assert.equal(Model.state(command('file.edit'), docs.context({stack: [OWN_VIEW], requestEdit: true})).visible, false,
        'the way back is the mode switch, not a request to the host');
    /* Back to editing: everything is on again. */
    const back = docs.context({stack: [OWN_VIEW]});
    back.stack = [];
    assert.deepEqual(states(back, items), all(items, 'on'));
    /* A lost connection over it, and alone, does not rebuild the menu either. */
    for (const stack of [[OWN_VIEW, RECONNECT], [RECONNECT]]) {
        const lost = docs.context({stack});
        assert.deepEqual(shownKeys(lost), whole, stack.map(e => e.type).join(' + '));
        assert.deepEqual(states(lost, EDIT), all(EDIT, 'offline'));
    }
});

check('a user with only the view right keeps the menu of a reader', () => {
    const reader = docs.context({rights: 'view'});
    const keys = shownKeys(reader);
    assert.deepEqual(Array.from(docs.sections(), s => s.k).filter(k => keys.includes(k)), ['file', 'edit', 'view', 'collab', 'help']);
    const edit = docs.sections().find(s => s.k === 'edit');
    assert.deepEqual(Array.from(Model.section(edit.items, reader).rows, r => r.k).filter(k => k !== undefined),
        ['edit.copy', 'edit.selectAll', 'edit.find']);
    /* A lost connection does not give the reader more. */
    assert.deepEqual(shownKeys(docs.context({rights: 'view', stack: [RECONNECT]})), keys);
});

/* Review and comment items of an editor. In its own view the stock ReviewChanges and Comments take
   canReview and canComments out of the options as well; the menu reads the rights of the session. */
const REVIEW_TOPS = ['insert.comment', 'collab.track', 'collab.trackAll', 'collab.show', 'collab.changes'];
const REVIEW_ROWS = REVIEW_TOPS.concat(['collab.markup', 'collab.final', 'collab.original', 'collab.prev', 'collab.next',
    'collab.accept', 'collab.reject', 'collab.acceptAll', 'collab.rejectAll']);
function rows(ctx, keys) {
    const out = {};
    for (const k of keys) {
        const st = Model.state(command(k), ctx);
        out[k] = st.visible ? [st.disabled, st.reason, st.checked] : 'hidden';
    }
    return out;
}

check('own view keeps review and comment items of an editor greyed with the view reason', () => {
    const editing = docs.context({changes: true, atChange: true});
    const before = rows(editing, REVIEW_ROWS);
    const view = docs.context({stack: [OWN_VIEW], changes: true, atChange: true});
    for (const k of REVIEW_TOPS) assert.equal(Model.state(command(k), view).visible, true, k + ' is shown');
    const actions = ['insert.comment', 'collab.track', 'collab.trackAll', 'collab.markup', 'collab.final', 'collab.original',
        'collab.accept', 'collab.reject', 'collab.acceptAll', 'collab.rejectAll'];
    assert.deepEqual(states(view, actions), all(actions, 'view'));
    /* Greyed items do nothing, and commenting stays off in the view. */
    for (const k of ['insert.comment', 'collab.track', 'collab.trackAll', 'collab.accept'])
        assert.equal(view.real.exec(command(k)), false, k);
    assert.deepEqual(view.log.filter(e => e.api || e.event || e.shell), [], 'no engine, event or shell call');
    assert.equal(view.shell.canAddComment(), false, 'no comment right in the view');
    /* Back to editing: as before the switch. */
    view.stack = [];
    assert.deepEqual(rows(view, REVIEW_ROWS), before);
});

check('own view does not show review or comment items without their right', () => {
    /* The stand-ins read the last context made: each one is read before the next is made. */
    const review = ['collab.track', 'collab.trackAll', 'collab.show', 'collab.changes', 'collab.compare'];
    const editNoReview = shownKeys(docs.context({review: false}));
    const noReview = docs.context({stack: [OWN_VIEW], review: false});
    assert.deepEqual(rows(noReview, review), all(review, 'hidden'));
    assert.equal(Model.state(command('insert.comment'), noReview).visible, true, 'the comment right stays');
    assert.deepEqual(shownKeys(noReview), editNoReview, 'as in editing without the review right');
    const editNoComments = shownKeys(docs.context({comments: false}));
    const noComments = docs.context({stack: [OWN_VIEW], comments: false});
    assert.equal(Model.state(command('insert.comment'), noComments).visible, false);
    assert.equal(Model.state(command('collab.track'), noComments).visible, true, 'the review right stays');
    assert.deepEqual(shownKeys(noComments), editNoComments, 'as in editing without the comment right');
});

check('locked click does not run the command', () => {
    const ctx = docs.context({reasons: ['offline']});
    const adapter = ctx.real;
    assert.equal(adapter.exec(command('edit.undo')), false);
    assert.equal(adapter.exec(command('file.print')), false);
    assert.deepEqual(ctx.log.filter(e => e.api), [], 'no engine call');
    ctx.reasons = [];
    assert.equal(adapter.exec(command('edit.undo')), true);
    assert.deepEqual(ctx.log.filter(e => e.api).map(e => e.api), ['Undo']);
    /* A submenu row and a group header are not commands. */
    assert.equal(adapter.exec(command('file.download')), false);
});

check('open menu refreshes after an editing lock event', () => {
    const ctx = docs.context();
    const shell = loadShell(ctx);
    for (const [name, args] of [['editing:disable', [true, {viewDocMode: true}, 'view']], ['protect:doclock', [{}]],
        ['doc:mode-changed', ['view', true]], ['api:disconnect', [true]]]) {
        const before = shell.refreshes;
        ctx.trigger(name, ...args);
        assert.ok(shell.refreshes > before, name + ' refreshes the open menu');
    }
});

check('open menu refreshes after a co-author change', () => {
    const ctx = docs.context();
    const shell = loadShell(ctx);
    const events = Object.keys(shell.callbacks).sort();
    assert.deepEqual(events.filter(name => name !== 'asc_onCoAuthoringDisconnect' && name !== 'asc_onDocumentContentReady'),
        ['asc_onCanCopyCut', 'asc_onCanRedo', 'asc_onCanUndo', 'asc_onCollaborativeChanges', 'asc_onDocumentModifiedChanged',
            'asc_onFocusObject', 'asc_onOnTrackRevisionsChange', 'asc_onShowRevisionsChange', 'asc_onZoomChange'].sort());
    for (const name of ['asc_onCollaborativeChanges', 'asc_onOnTrackRevisionsChange', 'asc_onShowRevisionsChange']) {
        const before = shell.refreshes;
        shell.callbacks[name].forEach(fn => fn());
        assert.equal(shell.refreshes, before + 1, name);
    }
});

/* The shell in the same vm, with the menu of the shared layer replaced by a counter. */
function loadShell(ctx) {
    if (!G.DE.Views.CompactShell) {
        G.document = {body: {classList: {add() {}, remove() {}, contains: () => false, toggle() {}}}, getElementById: () => null};
        G.$ = () => new Proxy({length: 0}, {get: (t, k) => (k in t ? t[k] : () => t)});
        vm.runInContext(fs.readFileSync(SHELL, 'utf8'), G, {filename: SHELL});
    }
    const shell = Object.create(G.DE.Views.CompactShell);
    const out = {refreshes: 0, callbacks: {}};
    shell.menu = {refresh: () => { out.refreshes++; }};
    shell.syncRulers = () => {};
    shell.api = {asc_registerCallback: (name, fn) => { (out.callbacks[name] = out.callbacks[name] || []).push(fn); }};
    shell.lockOn = false;
    shell.lockOpts = null;
    shell.bindEditingLock();
    shell.bindMenuRefresh();
    out.shell = shell;
    return out;
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
