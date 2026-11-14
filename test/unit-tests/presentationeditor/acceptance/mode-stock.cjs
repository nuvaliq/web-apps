/* Run: node test/unit-tests/presentationeditor/acceptance/mode-stock.cjs [--only <name>] [--view-dir <dir>]
 * The presentation compact shell runs stock commands only: menu items and toolbar buttons reach
 * their stock twins, stock shortcuts stay stock in every mode, stock locks and errors stay stock.
 */
'use strict';
const assert = require('node:assert/strict');
const h = require('./mode-harness.cjs');

function started(cli, opts) {
    const w = h.createWorld(opts, cli);
    h.boot(w);
    return w;
}
function shellActs(s) { return s.act.filter(a => a.origin === 'shell'); }

const STOCK_KEYS = ['ctrl+F5', 'ctrl+m', 'ctrl+s', 'ctrl+p', 'ctrl+z', 'ctrl+y', 'ctrl+x', 'ctrl+c', 'ctrl+v', 'ctrl+a', 'ctrl+f', 'ctrl+k',
    'ctrl+b', 'ctrl+i', 'ctrl+u', 'Delete', 'F1', 'ArrowUp', 'ArrowDown'];

const tests = [
    {name: 'every_shell_position_calls_its_stock_handler_not_own_editing_code', fn(cli) {
        const w = started(cli, {edit: true});
        const bridge = h.need(w, 'StockBridge');
        const items = h.allItems(h.catalog(w));
        assert.ok(items.length >= 80, 'the menu bar catalog looks incomplete: ' + items.length + ' items');
        const unbound = [], twoWays = [], unresolved = [];
        for (const {it, section} of items) {
            const ways = ['twin', 'cmd', 'engine'].filter(k => it[k]);
            const container = Array.isArray(it.sub) && it.sub.length;
            if (!ways.length && !container) unbound.push(section + ' → ' + it.t);
            if (ways.length > 1) twoWays.push(section + ' → ' + it.t);
            if (it.twin && !bridge.twin(it.twin)) unresolved.push(section + ' → ' + it.t + ' (' + it.twin + ')');
        }
        assert.deepEqual(unbound, [], 'every item must be bound to a stock twin, a marked engine call or a shell command');
        assert.deepEqual(twoWays, [], 'one binding per item');
        assert.deepEqual(unresolved, [], 'twins must resolve in the stock tree');

        for (const [section, label] of [['Правка', 'Отменить'], ['Слайд', 'Новый слайд'], ['Слайд', 'Дублировать слайд'], ['Вставка', 'Символ'], ['Вид', 'Линейки']]) {
            const it = h.findItem(w, section, label);
            const twin = h.twinOf(w, it);
            assert.ok(twin, section + ' → ' + label + ' must be bound to a stock twin');
            twin.setDisabled(false);
            w.flush();
            const el = h.menuPath(w, [section, label]);
            const m = h.mark(w);
            h.click(w, el);
            const s = h.since(w, m);
            const acts = shellActs(s);
            assert.equal(acts.length, 1, section + ' → ' + label + ' must call the stock control once, got ' + acts.length);
            assert.equal(acts[0].label, twin.__twin, section + ' → ' + label + ' must call its own twin');
            assert.deepEqual(h.shellEdits(s.api).map(c => c.name), [], section + ' → ' + label + ' must not edit through the engine itself');
        }

        const undo = h.twinOf(w, h.findItem(w, 'Правка', 'Отменить'));
        undo.setDisabled(false);
        w.flush();
        const btn = h.walk(h.byId(w, 'vo-toolbar')).find(el => h.labelOf(el).startsWith('Отменить') && h.clickables(el).length);
        assert.ok(btn, 'the toolbar has no «Отменить» button');
        const m = h.mark(w);
        h.click(w, h.clickables(btn)[0]);
        const s = h.since(w, m);
        const acts = shellActs(s);
        assert.equal(acts.length, 1, 'toolbar «Отменить» must call the stock control once');
        assert.match(acts[0].label, /btnUndo/, 'toolbar «Отменить» must call the stock undo button');
        assert.deepEqual(h.shellEdits(s.api).map(c => c.name), [], 'toolbar «Отменить» must not undo through the engine itself');
    }},

    {name: 'stock_shortcuts_keep_stock_actions_in_every_mode_shell_adds_only_escape', fn(cli) {
        for (const mode of ['edit', 'view', 'focus']) {
            const w = started(cli, {edit: true});
            if (mode === 'view') { h.need(w, 'CompactModes').setMode('view'); w.flush(); }
            if (mode === 'focus') { h.click(w, h.byId(w, 'vo-tb-end').lastElementChild); }
            const own = w.shortcuts.delegated.filter(d => d.origin === 'shell').flatMap(d => Object.keys(d.map)).filter(k => !/^(esc|escape)$/i.test(k.trim()));
            assert.deepEqual(own, [], mode + ': the shell must register no shortcuts but Esc');
            const suspendedByShell = w.shortcuts.log.filter(l => l.origin === 'shell' && l.op === 'suspend');
            assert.deepEqual(suspendedByShell.map(l => l.keys), [], mode + ': the shell must not suspend stock shortcuts');
            for (const k of ['ctrl+f5', 'alt+h']) assert.equal(w.shortcutActive(k), true, mode + ': stock ' + k + ' must be active');
            const before = {header: h.rowShown(w, 'header'), toolbar: h.rowShown(w, 'toolbar')};
            const area = h.byId(w, 'area_id');
            area.focus();
            for (const key of STOCK_KEYS) {
                const m = h.mark(w);
                const ev = h.press(w, key, area);
                const s = h.since(w, m);
                assert.equal(ev.defaultPrevented, false, mode + ': ' + key + ' must reach the stock handler untouched');
                assert.deepEqual(shellActs(s).map(a => a.label), [], mode + ': ' + key + ' must not run shell commands');
                assert.deepEqual(h.shellEdits(s.api).map(c => c.name), [], mode + ': ' + key + ' must not edit from shell code');
                assert.deepEqual(s.notices.filter(n => n.origin === 'shell').map(n => n.name), [], mode + ': ' + key + ' must not raise shell notices');
            }
            assert.deepEqual({header: h.rowShown(w, 'header'), toolbar: h.rowShown(w, 'toolbar')}, before, mode + ': stock shortcuts must not change the shell rows');
        }
    }},

    {name: 'stock_locks_errors_and_disconnect_stay_stock_without_shell_handling', fn(cli) {
        const w = started(cli, {edit: true});
        const it = h.findItem(w, 'Слайд', 'Удалить слайд');
        const twin = h.twinOf(w, it);
        assert.ok(twin, '«Слайд → Удалить слайд» must be bound to a stock twin');
        twin.setDisabled(true);
        w.flush();
        const st = h.itemState(w, it);
        assert.equal(st.disabled, true, 'a co-author lock on the stock control greys the item');
        assert.notEqual(st.hidden, true, 'a locked item stays visible');

        twin.setDisabled(false);
        w.flush();
        const el = h.menuPath(w, ['Слайд', 'Удалить слайд']);
        twin.setDisabled(true);
        let m = h.mark(w);
        h.click(w, el);
        let s = h.since(w, m);
        assert.deepEqual(shellActs(s).map(a => a.label), [], 'a lock that came while the menu was open must stop the command');
        assert.deepEqual(h.shellEdits(s.api).map(c => c.name), [], 'no engine call around the stock lock');
        assert.deepEqual(s.alerts.filter(a => a.origin === 'shell').map(a => a.kind), [], 'the lock message is the stock one, not the shell one');

        const nodesBefore = new Set(h.walk(w.doc.documentElement));
        m = h.mark(w);
        w.fire('asc_onError', -400, 1);
        w.NC.trigger('showerror', -400, 1);
        w.fire('asc_onCoAuthoringDisconnect');
        w.NC.trigger('api:disconnect');
        w.flush();
        s = h.since(w, m);
        assert.deepEqual(s.alerts.filter(a => a.origin === 'shell').map(a => a.kind), [], 'errors and disconnect: no shell message boxes');
        assert.deepEqual(s.notices.filter(n => n.origin === 'shell' && /error|message|disconnect|alert/i.test(n.name)).map(n => n.name), [],
            'errors and disconnect: the shell must not re-raise them');
        assert.deepEqual(h.shellEdits(s.api).map(c => c.name), [], 'errors and disconnect: the shell must not act on the engine');
        const fresh = h.walk(w.doc.documentElement).filter(el => !nodesBefore.has(el) && h.isVisibleNode(el) && /ошиб|error|соединен|disconnect|warn/i.test(h.norm(el.textContent) + ' ' + el.className));
        assert.deepEqual(fresh.map(el => h.norm(el.textContent).slice(0, 40) || el.className), [], 'errors and disconnect: the shell draws no message of its own');
    }}
];

h.run(tests);
