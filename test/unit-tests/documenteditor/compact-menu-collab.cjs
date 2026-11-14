/* Run: node test/unit-tests/documenteditor/compact-menu-collab.cjs
 * Collaboration and Help sections of the compact menu of the document editor
 * (DocumentActions.sections): how the changes are shown, going through the changes and deciding on
 * them, the comments panel and how comments show in the text, version history, comparing, removing
 * the protection set in the document, the co-editing mode, and the About window that every user
 * reaches.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs; the engine
 * answers the protection calls through the stand-in api, the password window runs over stand-ins of
 * the stock window and password field that record what the catalog asks of them.
 */
const assert = require('node:assert/strict');

const docs = require('../common/compact/lib/documents-editor.cjs');

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const actions = G.DE.Views.DocumentActions;
const command = k => actions.command(k);
const plain = value => JSON.parse(JSON.stringify(value));
const calls = (ctx, name) => ctx.log.filter(e => e.api === name).map(e => e.args);
const rows = (items, ctx) => plain(Model.section(items, ctx).rows.map(r => (r.kind === 'sep' ? '—' : r.k)));
const exec = (ctx, k) => docs.adapter(ctx).exec(command(k));
const state = (k, ctx) => Model.state(command(k), ctx);
const shown = (k, ctx) => state(k, ctx).visible;
/* The checked rows of a submenu in the state. */
const marked = (k, ctx) => plain(Model.section(command(k).items, ctx).rows.filter(r => r.checked).map(r => r.k));
/* [disabled, reason] of each item by key. */
const states = (ctx, keys) => Object.fromEntries(keys.map(k => {
    const st = state(k, ctx);
    assert.equal(st.visible, true, k + ' is shown');
    return [k, st.disabled ? st.reason || 'greyed' : 'on'];
}));
const all = (keys, value) => Object.fromEntries(keys.map(k => [k, value]));

/* Engine values the items read (sdkjs common/errorCodes.js). */
G.Asc.c_oAscError = {ID: {PasswordIsNotCorrect: 1031}, Level: {NoCritical: 1}};

const CHANGES = ['collab.prev', 'collab.next', 'collab.accept', 'collab.reject', 'collab.acceptAll', 'collab.rejectAll'];

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* Runs fn with a stock controller of the editor given by name. */
function withController(name, ctl, fn) {
    const getController = G.DE.getController;
    G.DE.getController = n => (n === name ? ctl : getController(n));
    try { return fn(); } finally { G.DE.getController = getController; }
}

/* Common.Utils.InternalSettings and Common.localStorage that keep what is written to them. */
function storage(initial) {
    const settings = new Map(Object.entries(initial || {})), local = new Map();
    const saved = {settings: G.Common.Utils.InternalSettings, local: G.Common.localStorage};
    G.Common.Utils.InternalSettings = {set: (k, v) => settings.set(k, v), get: k => settings.get(k)};
    G.Common.localStorage = Object.assign({}, saved.local, {
        setItem: (k, v) => local.set(k, String(v)),
        getItem: k => (local.has(k) ? local.get(k) : null),
        setBool: (k, v) => local.set(k, v ? '1' : '0'),
        getBool: (k, d) => (local.has(k) ? local.get(k) === '1' || local.get(k) === 'true' : !!d)
    });
    return {settings, local, restore() {
        G.Common.Utils.InternalSettings = saved.settings;
        G.Common.localStorage = saved.local;
    }};
}

/* The stock window and password field stood in: each window records its options, whether it is
   open, and the field it got; Apply and Cancel go through the handler, as the footer buttons and
   Enter do in the stock window (AdvancedSettingsWindow.onDlgBtnClick, onPrimary). */
function withPasswordWindow(fn) {
    const windows = [];
    const views = G.Common.Views, field = G.Common.UI.InputFieldBtnPassword;
    function Field(options) {
        this.options = options;
        this.value = '';
        this.focused = 0;
        const me = this;
        this._input = {val: v => (v === undefined ? me.value : (me.value = v, me._input))};
    }
    Field.prototype.setValue = function (v) { this.value = v; };
    Field.prototype.getValue = function () { return this.value; };
    Field.prototype.focus = function () { this.focused++; };
    function Win(options) {
        const handlers = {};
        this.options = options;
        this.isOpen = false;
        this.$window = null;
        this.on = (name, f) => { (handlers[name] = handlers[name] || []).push(f); return this; };
        this.fire = name => (handlers[name] || []).forEach(f => f(this));
        windows.push(this);
    }
    Win.prototype.render = function () {
        const slots = {};
        this.$window = {find: sel => (slots[sel] = slots[sel] || {selector: sel})};
        this.slots = slots;
    };
    Win.prototype.show = function () { if (!this.$window) this.render(); this.isOpen = true; };
    Win.prototype.close = function () { if (!this.isOpen) return; this.isOpen = false; this.fire('close'); };
    Win.prototype.getFooterButtons = function () { return []; };
    /* A press of a footer button: the window stays open when the handler says so. */
    Win.prototype.press = function (result) {
        if (this.options.handler && this.options.handler.call(this, result)) return;
        this.close();
    };
    G.Common.Views = Object.assign({}, views, {AdvancedSettingsWindow: Win});
    G.Common.UI.InputFieldBtnPassword = Field;
    try { return fn(windows); } finally {
        G.Common.Views = views;
        if (field) G.Common.UI.InputFieldBtnPassword = field; else delete G.Common.UI.InputFieldBtnPassword;
    }
}

/* The engine behind the protection (sdkjs word/api.js asc_setDocumentProtection): the right
   password or none at all removes the protection, the protection changes for the editor and the
   stock controller sends protect:doclock; a wrong one sends the error first and then the same
   protection again (asc_OnProtectionUpdate after the error). */
function protectionEngine(ctx, password) {
    ctx.engine = {
        asc_setDocumentProtection(props) {
            const right = !password || props.password === password;
            if (!right) ctx.fire('asc_onError', G.Asc.c_oAscError.ID.PasswordIsNotCorrect, 1);
            else ctx.protection = null;
            ctx.trigger('protect:doclock', ctx.protectionProps());
        }
    };
}

/* --- Collaboration ------------------------------------------------------------------------------ */

check('collaboration section has its items, kinds and labels', () => {
    const ctx = docs.context({protection: {isReadOnly: true}});
    const collab = docs.sections().find(s => s.k === 'collab');
    assert.deepEqual(rows(collab.items, ctx), ['collab.track', 'collab.trackAll', 'collab.show', 'collab.changes', '—',
        'collab.comments', '—', 'collab.share', 'collab.history', 'collab.compare', '—', 'collab.unprotect',
        'collab.coedit']);
    assert.deepEqual(rows(command('collab.show').items, ctx), ['collab.markup', 'collab.final', 'collab.original']);
    assert.deepEqual(rows(command('collab.changes').items, ctx), ['collab.prev', 'collab.next', '—',
        'collab.accept', 'collab.reject', '—', 'collab.acceptAll', 'collab.rejectAll']);
    assert.deepEqual(rows(command('collab.comments').items, ctx), ['collab.comments.panel',
        'collab.comments.highlight', 'collab.comments.resolved']);
    assert.deepEqual(rows(command('collab.coedit').items, ctx), ['collab.coeditFast', 'collab.coeditStrict']);
    for (const k of ['collab.markup', 'collab.final', 'collab.original', 'collab.coeditFast', 'collab.coeditStrict'])
        assert.equal(Model.kindOf(command(k)), 'radio', k);
    for (const k of ['collab.comments.panel', 'collab.comments.highlight', 'collab.comments.resolved'])
        assert.equal(Model.kindOf(command(k)), 'check', k);
    /* Labels of the items. */
    const label = k => command(k).t;
    assert.deepEqual(['collab.show', 'collab.changes', 'collab.unprotect', 'collab.coedit'].map(label),
        ['Show', 'Changes', 'Unprotect document', 'Co-editing']);
    /* The viewer gets the comments and the version history, nothing that changes the document. */
    const viewer = docs.context({rights: 'view', protection: {isReadOnly: true}});
    assert.deepEqual(rows(collab.items, viewer), ['collab.comments', '—', 'collab.share', 'collab.history']);
});

check('show submenu marks the display mode', () => {
    for (const [display, k] of [[null, 'collab.markup'], ['final', 'collab.final'], ['original', 'collab.original']])
        assert.deepEqual(marked('collab.show', docs.context({display})), [k], String(display));
    /* The simple markup of the stock is none of the three. */
    const simple = docs.context({engine: {asc_GetDisplayModeInReview: () => G.Asc.c_oAscDisplayModeInReview.Simple}});
    assert.deepEqual(marked('collab.show', simple), []);
    /* Choosing goes through the stock handler that also locks editing in the preview. */
    const turned = [];
    withController('Common.Controllers.ReviewChanges', {turnDisplayMode: mode => turned.push(mode)}, () => {
        const ctx = docs.context();
        for (const k of ['collab.final', 'collab.original', 'collab.markup']) assert.equal(exec(ctx, k), true, k);
    });
    assert.deepEqual(turned, ['final', 'original', 'markup']);
    /* The way back from the preview stays open in it. */
    const preview = docs.context({display: 'final', stack: [{type: 'review', options: {reviewMode: true}}]});
    assert.deepEqual(states(preview, ['collab.markup', 'collab.original']), all(['collab.markup', 'collab.original'], 'on'));
    assert.equal(state('collab.show', docs.context({rights: 'view'})).visible, false, 'not for a viewer');
});

check('without changes all six change items show the no-changes reason', () => {
    const ctx = docs.context();
    assert.deepEqual(states(ctx, CHANGES), all(CHANGES, 'noChanges'));
    assert.equal(state('collab.changes', ctx).disabled, false, 'the submenu itself opens');
    assert.equal(docs.reasonText('noChanges'), 'No tracked changes');
    /* A greyed item does not run. */
    const went = [];
    ctx.engine = {asc_GetPrevRevisionsChange: () => went.push('prev'), asc_GetNextRevisionsChange: () => went.push('next')};
    for (const k of CHANGES) assert.equal(exec(ctx, k), false, k);
    assert.deepEqual(ctx.log.filter(e => e.api), []);
    assert.deepEqual(went, []);
    /* A common reason outranks it on the items it greys. */
    const view = docs.context({reasons: ['view']});
    assert.deepEqual(states(view, CHANGES.slice(2)), all(CHANGES.slice(2), 'view'));
    assert.deepEqual(states(view, CHANGES.slice(0, 2)), all(CHANGES.slice(0, 2), 'noChanges'),
        'going through the changes needs no editing');
});

check('off a change accept and reject have no item reason', () => {
    const ctx = docs.context({changes: true});
    const off = states(ctx, CHANGES);
    assert.deepEqual(off, {'collab.prev': 'on', 'collab.next': 'on', 'collab.accept': 'greyed', 'collab.reject': 'greyed',
        'collab.acceptAll': 'on', 'collab.rejectAll': 'on'});
    assert.equal(state('collab.accept', ctx).reason, null);
    assert.equal(exec(ctx, 'collab.accept'), false);
    ctx.atChange = true;
    assert.deepEqual(states(ctx, CHANGES), all(CHANGES, 'on'));
    /* Going through the changes is a getter by name, the stand-in api does not log it: the engine does. */
    const went = [];
    ctx.engine = {asc_GetPrevRevisionsChange: () => went.push('prev'), asc_GetNextRevisionsChange: () => went.push('next')};
    for (const k of CHANGES) assert.equal(exec(ctx, k), true, k);
    assert.deepEqual(went, ['prev', 'next']);
    assert.deepEqual(ctx.log.filter(e => e.api && /Changes$/.test(e.api)).map(e => e.api),
        ['asc_AcceptChanges', 'asc_RejectChanges', 'asc_AcceptAllChanges', 'asc_RejectAllChanges']);
    /* Review-only protection greys deciding with its reason, going through stays. */
    const review = docs.context({changes: true, atChange: true, protection: {isReviewOnly: true}});
    assert.deepEqual(states(review, CHANGES), Object.assign(all(CHANGES.slice(2), 'protected'),
        all(CHANGES.slice(0, 2), 'on')));
});

check('comments submenu has three remembered toggles', () => {
    const store = storage({'de-settings-livecomment': true, 'de-settings-resolvedcomment': false});
    try {
        const ctx = docs.context();
        assert.deepEqual(marked('collab.comments', ctx), ['collab.comments.highlight']);
        /* Resolved comments shown: the engine shows all with the resolved ones, the choice is kept. */
        assert.equal(exec(ctx, 'collab.comments.resolved'), true);
        assert.deepEqual(plain(calls(ctx, 'asc_showComments')), [[true]]);
        assert.equal(store.local.get('de-settings-resolvedcomment'), '1');
        assert.equal(store.settings.get('de-settings-resolvedcomment'), true);
        /* Highlight off: comments leave the text. */
        assert.equal(exec(ctx, 'collab.comments.highlight'), true);
        assert.deepEqual(plain(calls(ctx, 'asc_hideComments')), [[]]);
        assert.equal(store.local.get('de-settings-livecomment'), '0');
        assert.equal(store.settings.get('de-settings-livecomment'), false);
        assert.deepEqual(marked('collab.comments', ctx), ['collab.comments.resolved']);
        /* While the panel is open the stock shows every comment; the choice waits for the panel to close. */
        const open = docs.context({commentsOpen: true});
        assert.deepEqual(marked('collab.comments', open), ['collab.comments.panel', 'collab.comments.resolved']);
        assert.equal(exec(open, 'collab.comments.highlight'), true);
        assert.deepEqual(open.log.filter(e => /Comments$/.test(e.api || '')), []);
        assert.equal(store.local.get('de-settings-livecomment'), '1');
        /* The panel toggle opens the stock panel. */
        assert.equal(exec(open, 'collab.comments.panel'), true);
        assert.deepEqual(plain(open.log.filter(e => e.shell === 'toggleLeftPanel').map(e => e.args)), [['comments']]);
    } finally { store.restore(); }
    /* A new session reads the choice from the browser storage when the editor has not set it yet. */
    const next = storage();
    try {
        G.Common.localStorage.setItem('de-settings-livecomment', 0);
        G.Common.localStorage.setItem('de-settings-resolvedcomment', 1);
        assert.deepEqual(marked('collab.comments', docs.context()), ['collab.comments.resolved']);
    } finally { next.restore(); }
    /* A viewer reads the comments too; without the right to see them there is no submenu. */
    assert.equal(shown('collab.comments', docs.context({rights: 'view'})), true);
    assert.equal(shown('collab.comments', docs.context({comments: false})), false);
    assert.deepEqual(states(docs.context({reasons: ['offline']}), ['collab.comments.panel', 'collab.comments.highlight',
        'collab.comments.resolved']), all(['collab.comments.panel', 'collab.comments.highlight',
        'collab.comments.resolved'], 'offline'));
});

check('history and compare are absent without their function', () => {
    assert.equal(shown('collab.history', docs.context()), true);
    assert.equal(shown('collab.history', docs.context({history: false})), false);
    assert.equal(shown('collab.compare', docs.context()), true);
    assert.equal(shown('collab.compare', docs.context({compare: false})), false, 'no way to pick the second document');
    assert.equal(shown('collab.compare', docs.context({review: false})), false);
    assert.equal(shown('collab.compare', docs.context({rights: 'view'})), false);
    /* The second document comes from the portal picker, as the stock "From storage". */
    const asked = [];
    withController('Common.Controllers.ReviewChanges', {onCompareClick: item => asked.push(item)}, () => {
        assert.equal(exec(docs.context(), 'collab.compare'), true);
    });
    assert.deepEqual(asked, ['storage']);
    assert.equal(state('collab.compare', docs.context({reasons: ['view']})).reason, 'view');
});

check('unprotect appears only for a protected document', () => {
    assert.equal(shown('collab.unprotect', docs.context()), false);
    for (const kind of ['isReadOnly', 'isCommentsOnly', 'isFormsOnly', 'isReviewOnly']) {
        const ctx = docs.context({protection: {[kind]: true}});
        assert.equal(shown('collab.unprotect', ctx), true, kind);
        assert.deepEqual(states(ctx, ['collab.unprotect']), {'collab.unprotect': 'on'}, kind + ': not greyed by its own protection');
    }
    assert.equal(shown('collab.unprotect', docs.context({protection: {isReadOnly: true}, missing: ['asc_getDocumentProtection']})), false);
    assert.equal(state('collab.unprotect', docs.context({protection: {isReadOnly: true}, missing: ['asc_setDocumentProtection']})).disabled,
        true, 'without the engine call the item stands greyed');
});

check('unprotect without a password removes protection at once and the item disappears', () => {
    const ctx = docs.context({protection: {isReadOnly: true}});
    protectionEngine(ctx);
    withPasswordWindow(windows => {
        assert.equal(exec(ctx, 'collab.unprotect'), true);
        assert.equal(windows.length, 0, 'no window');
    });
    const set = calls(ctx, 'asc_setDocumentProtection');
    assert.equal(set.length, 1);
    assert.equal(set[0][0].edit, G.Asc.c_oAscEDocProtect.None);
    assert.equal(set[0][0].password, null, 'no password is sent');
    assert.equal(shown('collab.unprotect', ctx), false);
});

check('unprotect is greyed with the view reason in view', () => {
    const view = docs.context({protection: {isReadOnly: true}, stack: [{type: 'view', options: {viewDocMode: true}}]});
    assert.equal(state('collab.unprotect', view).reason, 'view');
    const host = docs.context({protection: {isReadOnly: true}, editMode: false, editRight: true});
    assert.equal(state('collab.unprotect', host).reason, 'view', 'a view session of the editor');
    for (const reason of ['offline', 'limit', 'final', 'form'])
        assert.equal(state('collab.unprotect', docs.context({protection: {isReadOnly: true}, reasons: [reason]})).reason,
            reason === 'limit' ? 'limit' : reason, reason);
    /* Another user changing the protection holds it, as the stock button. */
    const held = docs.context({protection: {isReadOnly: true}});
    held.fire('asc_onLockDocumentProtection', true);
    assert.deepEqual([state('collab.unprotect', held).disabled, state('collab.unprotect', held).reason], [true, null]);
    held.fire('asc_onLockDocumentProtection', false);
    assert.equal(state('collab.unprotect', held).disabled, false);
    /* A greyed item does not run (the stand-in editor is the one of the last context). */
    const again = docs.context({protection: {isReadOnly: true}, stack: [{type: 'view', options: {viewDocMode: true}}]});
    assert.equal(exec(again, 'collab.unprotect'), false);
    assert.deepEqual(calls(again, 'asc_setDocumentProtection'), []);
});

check('viewer sees no unprotect', () => {
    assert.equal(shown('collab.unprotect', docs.context({rights: 'view', protection: {isReadOnly: true}})), false);
    assert.equal(shown('collab.unprotect', docs.context({rights: 'view', protection: {isReadOnly: true, password: 'x'}})), false);
});

check('unprotect clears the protected reason without reload', () => {
    const ctx = docs.context({protection: {isReadOnly: true}});
    protectionEngine(ctx);
    const editing = ['edit.undo', 'insert.image', 'format.margins', 'insert.comment', 'collab.track'];
    assert.deepEqual(states(ctx, editing), all(editing, 'protected'));
    const doclock = [];
    ctx.trigger = (orig => (name, ...args) => { if (name === 'protect:doclock') doclock.push(args[0]); orig(name, ...args); })(ctx.trigger);
    assert.equal(exec(ctx, 'collab.unprotect'), true);
    assert.deepEqual(doclock, [null], 'the stock controller reports the protection gone');
    assert.deepEqual(states(ctx, editing), all(editing, 'on'));
});

check('wrong password keeps the window open with an error', () => {
    const ctx = docs.context({protection: {isCommentsOnly: true, password: 'secret'}});
    protectionEngine(ctx, 'secret');
    withPasswordWindow(windows => {
        assert.equal(exec(ctx, 'collab.unprotect'), true);
        assert.equal(windows.length, 1, 'the password window opens');
        const win = windows[0];
        assert.equal(win.isOpen, true);
        assert.match(win.options.cls, /(^|\s)vo-win(\s|$)/, 'the window is on the compact window template');
        assert.equal(win.options.title, 'Unprotect document');
        const field = win.field;
        assert.ok(field, 'the window has its password field');
        assert.equal(field.options.type, 'password');
        assert.deepEqual(calls(ctx, 'asc_setDocumentProtection'), [], 'nothing is sent before Apply');
        /* A second click on the item brings no second window. */
        exec(ctx, 'collab.unprotect');
        assert.equal(windows.filter(w => w.isOpen).length, 1);

        field._input.val('wrong');
        win.press('ok');
        let sent = calls(ctx, 'asc_setDocumentProtection');
        assert.equal(sent.length, 1);
        assert.deepEqual([sent[0][0].edit, sent[0][0].password], [G.Asc.c_oAscEDocProtect.None, 'wrong']);
        assert.equal(win.isOpen, true, 'the window stays open after the wrong password');
        assert.equal(field.getValue(), '', 'the field is cleared');
        assert.ok(field.focused > 0, 'the field gets the focus back');
        assert.equal(shown('collab.unprotect', ctx), true, 'the protection stays');

        /* An empty password is a password too: never the call that removes it without one. */
        win.press('ok');
        sent = calls(ctx, 'asc_setDocumentProtection');
        assert.equal(sent[1][0].password, '');
        assert.equal(win.isOpen, true);

        field._input.val('secret');
        win.press('ok');
        assert.equal(win.isOpen, false, 'the window closes once the protection is gone');
        assert.equal(shown('collab.unprotect', ctx), false);

        /* Cancel closes without a call. */
        const other = docs.context({protection: {isReadOnly: true, password: 'p'}});
        protectionEngine(other, 'p');
        exec(other, 'collab.unprotect');
        windows[windows.length - 1].press('cancel');
        assert.equal(windows[windows.length - 1].isOpen, false);
        assert.deepEqual(calls(other, 'asc_setDocumentProtection'), []);
        /* After the window is gone an error of the engine reaches nothing. */
        other.fire('asc_onError', G.Asc.c_oAscError.ID.PasswordIsNotCorrect, 1);
    });
});

check('co-editing marks the current mode', () => {
    for (const [fast, k] of [[true, 'collab.coeditFast'], [false, 'collab.coeditStrict']]) {
        const store = storage({'de-settings-coauthmode': fast});
        try { assert.deepEqual(marked('collab.coedit', docs.context()), [k], String(fast)); }
        finally { store.restore(); }
    }
    const store = storage({'de-settings-coauthmode': true});
    try {
        const ctx = docs.context();
        assert.equal(exec(ctx, 'collab.coeditStrict'), true);
        assert.deepEqual(plain(calls(ctx, 'asc_SetFastCollaborative')), [[false]]);
        assert.deepEqual(marked('collab.coedit', ctx), ['collab.coeditStrict']);
        assert.equal(store.local.get('de-settings-coauthmode'), '0');
    } finally { store.restore(); }
    /* Only the connection greys it; the viewer and the editor without the right to change it lack it. */
    assert.equal(state('collab.coeditFast', docs.context({reasons: ['offline']})).reason, 'offline');
    assert.equal(state('collab.coeditFast', docs.context({protection: {isReadOnly: true}})).disabled, false);
    assert.equal(shown('collab.coedit', docs.context({coauth: false})), false);
    assert.equal(shown('collab.coedit', docs.context({rights: 'view'})), false);
});

/* --- Help --------------------------------------------------------------------------------------- */

check('about stays available to viewers', () => {
    const help = docs.sections().find(s => s.k === 'help');
    for (const over of [{rights: 'view'}, {rights: 'view', reasons: ['offline']}, {reasons: ['limit', 'protected']}]) {
        const ctx = docs.context(over);
        assert.deepEqual(rows(help.items, ctx), ['help.help', 'help.shortcuts', 'help.about'], JSON.stringify(over));
        assert.deepEqual(states(ctx, ['help.help', 'help.shortcuts', 'help.about']),
            all(['help.help', 'help.shortcuts', 'help.about'], 'on'), JSON.stringify(over));
        assert.equal(exec(ctx, 'help.about'), true);
        assert.deepEqual(ctx.log.filter(e => e.shell === 'about').length, 1);
    }
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
