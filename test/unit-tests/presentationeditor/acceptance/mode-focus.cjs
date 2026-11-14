/* Run: node test/unit-tests/presentationeditor/acceptance/mode-focus.cjs [--only <name>] [--view-dir <dir>]
 * Focus mode, "View → Hide toolbar" and the Escape order of the presentation compact shell.
 */
'use strict';
const assert = require('node:assert/strict');
const h = require('./mode-harness.cjs');

const BEGIN = h.ruText('PE.Views.Toolbar.textShowBegin');

function started(cli, opts) {
    const w = h.createWorld(opts, cli);
    h.boot(w);
    return w;
}
function rows(w) { return {header: h.rowShown(w, 'header'), menubar: h.rowShown(w, 'menubar'), toolbar: h.rowShown(w, 'toolbar')}; }
function chevron(w) {
    const end = h.byId(w, 'vo-tb-end');
    assert.ok(end && end.lastElementChild, 'no focus chevron at the right edge of the toolbar (#vo-tb-end)');
    return end.lastElementChild;
}
function viewMenu(w, label) {
    const el = h.menuPath(w, ['Вид', label]);
    h.click(w, el);
}

const tests = [
    {name: 'focus_chevron_and_view_menu_collapse_header_and_menu_bar_keep_toolbar', fn(cli) {
        const w = started(cli, {edit: true});
        assert.deepEqual(rows(w), {header: true, menubar: true, toolbar: true}, 'start: all rows shown');
        const ch = chevron(w);
        h.click(w, ch);
        assert.deepEqual(rows(w), {header: false, menubar: false, toolbar: true}, 'chevron: header and menu bar collapse, toolbar stays');
        h.click(w, ch);
        assert.deepEqual(rows(w), {header: true, menubar: true, toolbar: true}, 'second press on the chevron returns them');
        viewMenu(w, 'Режим фокуса');
        assert.deepEqual(rows(w), {header: false, menubar: false, toolbar: true}, '«Вид → Режим фокуса»: header and menu bar collapse, toolbar stays');
        h.press(w, 'Escape', w.doc.body);
        assert.deepEqual(rows(w), {header: true, menubar: true, toolbar: true}, 'Esc with nothing open or selected returns them');
    }},

    {name: 'hide_toolbar_toggles_and_is_exclusive_with_focus_mode', fn(cli) {
        const w = started(cli, {edit: true});
        viewMenu(w, 'Скрыть панель инструментов');
        assert.deepEqual(rows(w), {header: true, menubar: true, toolbar: false}, '«Вид → Скрыть панель инструментов» hides the toolbar only');
        viewMenu(w, 'Скрыть панель инструментов');
        assert.deepEqual(rows(w), {header: true, menubar: true, toolbar: true}, 'second choice returns the toolbar');

        h.click(w, chevron(w));
        assert.deepEqual(rows(w), {header: false, menubar: false, toolbar: true}, 'focus mode on');
        h.runCommand(w, 'hideToolbar');
        assert.deepEqual(rows(w), {header: true, menubar: true, toolbar: false}, 'hiding the toolbar switches the focus mode off');
        viewMenu(w, 'Режим фокуса');
        assert.deepEqual(rows(w), {header: false, menubar: false, toolbar: true}, 'focus mode switches the toolbar hiding off');
    }},

    {name: 'escape_closes_menu_then_leaves_text_and_selection_to_stock_then_exits_focus', fn(cli) {
        const w = started(cli, {edit: true});
        h.click(w, chevron(w));
        assert.equal(h.rowShown(w, 'header'), false, 'focus mode on');

        const parts = h.showParts(w);
        assert.ok(parts.arrow, 'no ▾ of «Показ слайдов» to open a menu in the focus mode');
        const before = new Set(h.walk(w.doc.documentElement));
        h.click(w, parts.arrow);
        const item = h.pickItem(w, BEGIN, parts.sc.root, before);
        assert.ok(item, 'the show menu did not open');
        const open = h.openState(item);
        let m = h.mark(w);
        h.press(w, 'Escape', item);
        assert.ok(h.closedSince(open), 'Esc #1 must close the open menu');
        assert.equal(h.rowShown(w, 'header'), false, 'Esc #1 closes the menu only, the focus mode stays');

        const area = h.byId(w, 'area_id');
        area.focus();
        h.select(w, 'slide', 'paragraph', 'shape');
        m = h.mark(w);
        h.press(w, 'Escape', area);
        assert.equal(h.rowShown(w, 'header'), false, 'Esc while typing is the stock exit from text, the focus mode stays');
        assert.deepEqual(h.shellEdits(h.since(w, m).api).map(c => c.name), [], 'leaving the text is stock, not shell code');

        h.select(w, 'slide', 'shape');
        m = h.mark(w);
        h.press(w, 'Escape', area);
        assert.equal(h.rowShown(w, 'header'), false, 'Esc with a selected object is the stock deselection, the focus mode stays');
        assert.deepEqual(h.shellEdits(h.since(w, m).api).map(c => c.name), [], 'deselection is stock, not shell code');

        h.select(w, 'slide');
        h.press(w, 'Escape', area);
        assert.deepEqual(rows(w), {header: true, menubar: true, toolbar: true}, 'Esc with nothing open or selected exits the focus mode');
        h.press(w, 'Escape', area);
        assert.deepEqual(rows(w), {header: true, menubar: true, toolbar: true}, 'Esc with nothing to undo changes nothing');
    }},

    {name: 'without_toolbar_focus_collapses_all_with_show_ctrl_f5_starts_show_and_esc_returns', fn(cli) {
        const reader = started(cli, {edit: false});
        const view = started(cli, {edit: true});
        h.need(view, 'CompactModes').setMode('view');
        view.flush();
        for (const [why, w] of [['no edit right', reader], ['«Просмотр»', view]]) {
            assert.equal(w.shell.hasToolbar(), false, why + ': no toolbar');
            const sc = h.showControl(w);
            assert.ok(sc && sc.container === 'vo-hdr-show', why + ': «Показ слайдов ▾» is in the header');
            viewMenu(w, 'Режим фокуса');
            assert.deepEqual({header: h.rowShown(w, 'header'), menubar: h.rowShown(w, 'menubar')}, {header: false, menubar: false},
                why + ': «Вид → Режим фокуса» collapses the header and the menu bar');
            const now = h.showControl(w);
            assert.ok(now && h.byId(w, 'vo-header').contains(now.root), why + ': «Показ слайдов ▾» collapses together with the header');
            const tb = h.byId(w, 'vo-toolbar');
            assert.ok(!tb || !h.findByLabel(tb, h.SHOW).length, why + ': the show control must not reappear elsewhere');

            assert.equal(w.shortcutActive('ctrl+f5'), true, why + ': stock Ctrl+F5 must be active (resumed after the stock lock)');
            const m = h.mark(w);
            const ev = h.press(w, 'ctrl+F5', h.byId(w, 'id_main_view'));
            assert.equal(ev.defaultPrevented, false, why + ': Ctrl+F5 must not be taken by the shell');
            assert.equal(w.pressStockShortcut('ctrl+f5'), true, why + ': stock Ctrl+F5 runs');
            const st = h.since(w, m).notices.filter(n => n.name === 'preview:start');
            assert.equal(st.length, 1, why + ': Ctrl+F5 starts one show');
            assert.deepEqual(st[0].args, [0], why + ': Ctrl+F5 is the stock show from the beginning');
            w.endShow();

            h.press(w, 'Escape', w.doc.body);
            assert.deepEqual({header: h.rowShown(w, 'header'), menubar: h.rowShown(w, 'menubar')}, {header: true, menubar: true},
                why + ': Esc returns the header and the menu bar');
            const back = h.showControl(w);
            assert.ok(back && back.container === 'vo-hdr-show' && h.isVisibleNode(back.root), why + ': «Показ слайдов ▾» is back in the header');
        }
    }}
];

h.run(tests);
