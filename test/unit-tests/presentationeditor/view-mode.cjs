/* Run: node test/unit-tests/presentationeditor/view-mode.cjs [path to CompactModes.js]
 * "View" of the presentation shell: the stock editing ban with its own reason type and
 * composition, a copy of Main.disableEditing in which the context menu, comments and
 * chat are alive; the OnlyComments engine restriction with the commenting right, otherwise View;
 * returning removes only its own reason and its own bit, during an engine action from the
 * restrictions it saved; the show and comment combinations are alive, an open
 * left area panel is open again; the toolbar row is hidden on behalf of "View";
 * "View" does not reset the edit right snapshot.
 *
 * The world is a fake stock editor from the shared shell check fixtures
 * (acceptance/mode-harness.cjs): the reason stack, Main.onEditingDisable,
 * LeftMenu.SetDisabled and Toolbar.DisableToolbar are real methods of the stock
 * controllers. The ban composition is compared with the real Main.disableEditing.
 * The optional argument is a corrupted copy of the module for a negative control:
 * a copy with the whole Main.disableEditing composition must fail
 * view_options_copy_with_overrides.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const h = require('./acceptance/mode-harness.cjs');

const VIEW = path.join(h.PE_APP, 'view');
const FILE = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactModes.js');

function viewDir() {
    if (FILE === path.join(VIEW, 'CompactModes.js')) return VIEW;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'view-mode-'));
    for (const name of h.SHELL_MODULES) if (!h.SHARED_MODULES[name]) fs.copyFileSync(path.join(VIEW, name + '.js'), path.join(dir, name + '.js'));
    fs.copyFileSync(FILE, path.join(dir, 'CompactModes.js'));
    return dir;
}
const DIR = viewDir();

const R = {OnlyComments: 0x02, View: 0x80};
const VIEW_TYPE = 'vo-view';

function world(opts) {
    const w = h.createWorld(Object.assign({edit: true, comment: true}, opts || {}), {viewDir: DIR});
    h.boot(w);
    w.M = w.modules.CompactModes;
    return w;
}

function setMode(w, mode) {
    const r = w.M.setMode(mode);
    w.flush();
    return r;
}

/* vo:mode notifications are objects from the fixture world, compared by composition. */
function modeEvents(w) {
    return w.notices.filter(x => x.name === 'vo:mode').map(x => JSON.stringify(x.args[0]));
}

function restrictions(w) {
    return w.apiCalls.filter(c => /Restriction$/.test(c.name) && c.name !== 'isActionWithRestriction').map(c => c.name + '(' + c.args.join(',') + ')');
}

/* The stock ban composition: the real Main.disableEditing with a reason type. */
function stockOptions(disable, type) {
    const src = fs.readFileSync(path.join(h.PE_APP, 'controller/Main.js'), 'utf8');
    const head = 'disableEditing: function(';
    const start = src.indexOf(head);
    assert.ok(start >= 0, 'Main.disableEditing not found');
    let depth = 0, end = src.indexOf('{', start);
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    const sent = [];
    const ctx = {Common: {NotificationCenter: {trigger: (...a) => sent.push(a)}}};
    vm.createContext(ctx);
    const fn = vm.runInContext('(function(' + src.slice(start + head.length, end + 1) + ')', ctx);
    fn.call({}, disable, type);
    assert.equal(sent.length, 1);
    return sent[0][2];
}

/* Leaf paths where the values differ. */
function diff(a, b, pre) {
    const out = [];
    const keys = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
    for (const k of keys) {
        const p = (pre ? pre + '.' : '') + k;
        const x = a ? a[k] : undefined, y = b ? b[k] : undefined;
        if (x && typeof x === 'object' && y && typeof y === 'object') out.push(...diff(x, y, p));
        else if (x !== y) out.push(p);
    }
    return out.sort();
}

/* The stock left menu close on a ban (view/LeftMenu.js close): pressed
   panel buttons are released. */
function stockClose(w) {
    const lv = w.views.LeftMenu;
    lv.close = function () {
        ['btnComments', 'btnChat', 'btnSearchBar'].forEach(n => { if (lv[n] && lv[n].pressed) lv[n].toggle(false, true); });
    };
}

const tests = [
    {name: 'view_options_copy_with_overrides', fn() {
        const w = world();
        for (const disable of [true, false]) {
            const ours = w.M.viewOptions(disable);
            const stock = stockOptions(disable, VIEW_TYPE);
            assert.deepEqual(Object.keys(ours).sort(), Object.keys(stock).sort(), 'the same keys as Main.disableEditing');
            assert.ok('leftMenu' in ours, 'the key leftMenu is there');
            assert.equal(ours.viewMode, disable, 'viewMode follows disable');
            assert.deepEqual(diff(ours, stock), ['chat', 'comments.disable', 'comments.previewMode', 'documentHolder.disable'],
                'own values: the context menu, the comments and the chat stay live');
            assert.deepEqual([ours.documentHolder.disable, ours.comments.disable, ours.comments.previewMode, ours.chat], [false, false, false, false]);
        }
        const m = h.mark(w);
        assert.equal(setMode(w, 'view'), true);
        assert.equal(w.M.mode(), 'view');
        assert.ok(h.since(w, m).calls.some(c => c.target === 'DocumentHolder' && c.name === 'createDelayedElementsViewer'),
            'the stock view menus are built: the thumbnail menu needs them before the first right click on an object');
        const n = w.notices.filter(x => x.name === 'editing:disable');
        assert.equal(n.length, 1);
        assert.deepEqual([n[0].args[0], n[0].args[2]], [true, VIEW_TYPE], 'own reason type');
        assert.equal(JSON.stringify(n[0].args[1]), JSON.stringify(w.M.viewOptions(true)));
        assert.equal(w.controllers.DocumentHolder._isDisabled, false, 'the stock context menu stays live');
        assert.deepEqual(modeEvents(w), ['{"mode":"view"}']);
        assert.equal(setMode(w, 'edit'), true);
        assert.equal(w.M.mode(), 'edit');
        assert.deepEqual(modeEvents(w), ['{"mode":"view"}', '{"mode":"edit"}']);
        assert.equal(setMode(w, 'edit'), false, 'the same mode again changes nothing');
        assert.equal(w.notices.filter(x => x.name === 'vo:mode').length, 2);
    }},

    {name: 'own_type_keeps_stock_reasons', fn() {
        const w = world();
        const main = w.controllers.Main;
        w.NC.trigger('editing:disable', true, stockOptions(true, 'disconnect'), 'disconnect');
        setMode(w, 'view');
        assert.equal(main.stackDisableActions.length(), 2);
        setMode(w, 'edit');
        assert.equal(main.stackDisableActions.length(), 1, 'only own reason leaves the stack');
        assert.equal(main.stackDisableActions.get(0).type, 'disconnect');
        assert.equal(w.controllers.DocumentHolder._isDisabled, true, 'the stock reason is applied again');
        assert.equal(w.appOptions.isEdit, false, 'the stock reason keeps editing off');
        /* An own reason on top of a stock one and removing the stock one under its own. */
        const v = world();
        setMode(v, 'view');
        v.NC.trigger('editing:disable', true, stockOptions(true, 'reconnect'), 'reconnect');
        v.NC.trigger('editing:disable', false, stockOptions(false, 'reconnect'), 'reconnect');
        assert.equal(v.controllers.Main.stackDisableActions.length(), 1);
        assert.equal(v.controllers.Main.stackDisableActions.get(0).type, VIEW_TYPE, 'own reason stays');
        assert.equal(v.controllers.DocumentHolder._isDisabled, false, 'own composition applied again');
        setMode(v, 'edit');
        assert.equal(v.controllers.Main.stackDisableActions.length(), 0);
        assert.equal(v.appOptions.isEdit, true, 'editing is back');
    }},

    {name: 'only_comments_with_comment_right_else_view', fn() {
        const w = world({comment: true});
        setMode(w, 'view');
        assert.deepEqual(restrictions(w), ['asc_addRestriction(' + R.OnlyComments + ')']);
        const v = world({comment: false});
        setMode(v, 'view');
        assert.deepEqual(restrictions(v), ['asc_addRestriction(' + R.View + ')']);
    }},

    {name: 'return_removes_only_own_bit', fn() {
        for (const [comment, bit] of [[true, R.OnlyComments], [false, R.View]]) {
            const w = world({comment});
            setMode(w, 'view');
            setMode(w, 'edit');
            assert.deepEqual(restrictions(w), ['asc_addRestriction(' + bit + ')', 'asc_removeRestriction(' + bit + ')'],
                'own bit only, without replacing the whole set');
        }
    }},

    {name: 'return_during_engine_action_uses_prev', fn() {
        /* Entry before an engine action, exit during it: the bit is removed from the saved ones. */
        const w = world({comment: true});
        setMode(w, 'view');
        w.api.isActionWithRestriction = () => true;
        w.api.IsActionRestrictionPrev = 0x01 | R.OnlyComments;
        setMode(w, 'edit');
        assert.deepEqual(restrictions(w), ['asc_addRestriction(' + R.OnlyComments + ')'], 'the current engine restrictions are left alone');
        assert.equal(w.api.IsActionRestrictionPrev, 0x01, 'own bit leaves the saved restrictions, the rest stays');
        /* Entry during an action: the bit is put into the saved ones. */
        const v = world({comment: false});
        v.api.isActionWithRestriction = () => true;
        v.api.IsActionRestrictionPrev = 0;
        setMode(v, 'view');
        assert.deepEqual(restrictions(v), []);
        assert.equal(v.api.IsActionRestrictionPrev, R.View);
        v.api.isActionWithRestriction = () => false;
        setMode(v, 'edit');
        assert.deepEqual(restrictions(v), ['asc_removeRestriction(' + R.View + ')']);
    }},

    {name: 'resumes_preview_and_comment_shortcuts', fn() {
        const w = world({comment: true});
        setMode(w, 'view');
        assert.equal(w.shortcutActive('ctrl+k'), false, 'the stock toolbar mask suspends its shortcuts');
        assert.equal(w.shortcutActive('ctrl+f5'), true, 'the show shortcut is live');
        assert.equal(w.shortcutActive('alt+h'), true, 'the comment shortcut is live');
        setMode(w, 'edit');
        assert.equal(w.shortcutActive('ctrl+k'), true);
        /* Without the commenting right the comment combination is not resumed. */
        const v = world({comment: false});
        v.shortcuts.suspended.add('alt+h');
        setMode(v, 'view');
        assert.equal(v.shortcutActive('ctrl+f5'), true);
        assert.equal(v.shortcutActive('alt+h'), false);
        /* Mac: the stock DocumentHolder combinations. */
        const m = world({comment: true});
        m.ctx.Common.Utils.isMac = true;
        m.shortcuts.suspended.add('command+shift+enter');
        m.shortcuts.suspended.add('command+alt+a');
        setMode(m, 'view');
        assert.equal(m.shortcutActive('command+shift+enter'), true);
        assert.equal(m.shortcutActive('command+alt+a'), true);
    }},

    {name: 'reopens_left_panel', fn() {
        const w = world({comment: true});
        stockClose(w);
        const L = w.modules.CompactLeft;
        assert.equal(L.openPanel('comments'), true);
        const m = h.mark(w);
        setMode(w, 'view');
        assert.equal(L.isOpen('comments'), true, 'the comments panel is open again');
        assert.ok(h.since(w, m).calls.some(c => /LeftMenu/.test(c.target) && c.name === 'onBtnMenuClick'), 'opened by the stock handler');
        /* A closed panel stays closed. */
        const v = world({comment: true});
        stockClose(v);
        setMode(v, 'view');
        assert.equal(v.modules.CompactLeft.isOpen('comments'), false);
        /* Search likewise. */
        const s = world({comment: true});
        stockClose(s);
        assert.equal(s.modules.CompactLeft.openPanel('advancedsearch'), true);
        setMode(s, 'view');
        assert.equal(s.modules.CompactLeft.isOpen('advancedsearch'), true);
    }},

    {name: 'toolbar_row_released_only_for_view_owner', fn() {
        const w = world();
        const toolbar = [];
        w.NC.on('shell:toolbar', v => toolbar.push(v));
        setMode(w, 'view');
        assert.equal(w.shell.hasToolbar(), false);
        assert.deepEqual(toolbar, [false]);
        w.shell.setRow('toolbar', false, 'hidden');
        setMode(w, 'edit');
        assert.equal(w.shell.hasToolbar(), false, 'another owner still hides the row');
        assert.deepEqual(Object.keys(w.shell.rows.toolbar), ['hidden']);
        w.shell.setRow('toolbar', true, 'hidden');
        assert.equal(w.shell.hasToolbar(), true);
        /* A reader has nothing to switch: the 'right' reason stays. */
        const r = world({edit: false});
        assert.equal(setMode(r, 'view'), false);
        assert.equal(r.M.mode(), 'edit');
        assert.deepEqual(Object.keys(r.shell.rows.toolbar), ['right']);
        assert.deepEqual(r.notices.filter(x => x.name === 'editing:disable' || x.name === 'vo:mode'), []);
    }},

    {name: 'edit_right_not_reset_by_view', fn() {
        const w = world();
        setMode(w, 'view');
        assert.equal(w.appOptions.isEdit, false, 'the stock lock turns isEdit off');
        assert.equal(w.shell.editRight(), true, 'the edit right snapshot stays');
        assert.equal(setMode(w, 'edit'), true, 'and the switch back works');
        assert.equal(w.appOptions.isEdit, true);
        /* The "Stock interface" from "View" returns "Editing". */
        const v = world();
        setMode(v, 'view');
        v.shell.toggleMode();
        v.flush();
        assert.equal(v.M.mode(), 'edit');
        assert.equal(v.controllers.Main.stackDisableActions.length(), 0);
        assert.equal(setMode(v, 'view'), false, 'no switching in the stock interface');
    }}
];

h.run(tests);
