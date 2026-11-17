/* Run: node test/unit-tests/presentationeditor/acceptance/mode-show.cjs [--only <name>] [--view-dir <dir>]
 * The "Slide show ▾" control of the presentation compact shell: its place by rights and
 * toolbar, its two parts, and that every way to start a show reaches the stock show.
 */
'use strict';
const assert = require('node:assert/strict');
const h = require('./mode-harness.cjs');

const BEGIN = h.ruText('PE.Views.Toolbar.textShowBegin');
const CURRENT = h.ruText('PE.Views.Toolbar.textShowCurrent');
const PRESENTER = h.ruText('PE.Views.Toolbar.textShowPresenterView');
const SETTINGS = h.ruText('PE.Views.Toolbar.textShowSettings');

function started(cli, opts) {
    const w = h.createWorld(opts, cli);
    h.boot(w);
    return w;
}
function starts(w, m) { return h.since(w, m).notices.filter(n => n.name === 'preview:start'); }
function order(w, el) { return h.walk(w.doc.documentElement).indexOf(el); }
function rowOf(el) { return el.closest('li, button, [role="menuitem"], [role="menuitemradio"], a') || el.parentNode || el; }

function expectInToolbarEnd(w, why) {
    const sc = h.showControl(w);
    assert.ok(sc, why + ': no «Показ слайдов» control in the shell');
    assert.equal(sc.container, 'vo-tb-end', why + ': «Показ слайдов ▾» must sit in the right edge of the toolbar (#vo-tb-end)');
    return sc;
}
function expectFirstInHeader(w, why) {
    assert.equal(w.shell.hasToolbar(), false, why + ': the toolbar row must be absent');
    const sc = h.showControl(w);
    assert.ok(sc, why + ': no «Показ слайдов» control in the shell');
    assert.equal(sc.container, 'vo-hdr-show', why + ': «Показ слайдов ▾» must move to the header (#vo-hdr-show)');
    const slot = h.byId(w, 'vo-hdr-show');
    assert.ok(h.byId(w, 'vo-header').contains(slot), why + ': #vo-hdr-show is not inside the header');
    const cluster = slot.parentNode;
    assert.equal(cluster.firstElementChild, slot, why + ': the show control must be first in the right cluster of the header');
    const download = h.walk(cluster).find(el => !el.contains(slot) && !slot.contains(el) && h.textStartsWith(el, 'Скачать'));
    assert.ok(download, why + ': the cluster holding the show control is not the right cluster (no «Скачать ▾» after it)');
    assert.ok(order(w, sc.root) < order(w, download), why + ': the show control must precede «Скачать ▾»');
    assert.equal(h.rowShown(w, 'header'), true, why + ': with the focus mode off the header stays shown');
    const end = h.byId(w, 'vo-tb-end');
    if (end) assert.equal(h.findByLabel(end, h.SHOW, {visible: false}).length, 0, why + ': the toolbar edge must not keep a second show control');
}

const tests = [
    {name: 'show_button_sits_at_toolbar_right_edge_before_focus_chevron_with_edit_right', fn(cli) {
        const w = started(cli, {edit: true});
        assert.equal(w.shell.hasToolbar(), true, 'with edit right in «Редактирование» the toolbar row is present');
        const sc = expectInToolbarEnd(w, 'edit right, editing, toolbar shown');
        const end = h.byId(w, 'vo-tb-end');
        assert.ok(h.byId(w, 'vo-toolbar') && h.byId(w, 'vo-toolbar').contains(end), '#vo-tb-end must be part of the toolbar row');
        const kids = end.children;
        const i = kids.indexOf(sc.root);
        assert.ok(i >= 0 && i < kids.length - 1, 'the show control must stand before the focus chevron, nothing follows it');
        assert.equal(h.findByLabel(h.byId(w, 'vo-header'), h.SHOW, {visible: false}).length, 0, 'the header must not hold «Показ слайдов» while the toolbar is shown');
        const chevron = kids[kids.length - 1];
        h.click(w, chevron);
        assert.equal(h.rowShown(w, 'header'), false, 'the item after the show control must be the focus chevron (it collapses the header)');
        h.click(w, chevron);
        assert.equal(h.rowShown(w, 'header'), true, 'second press on the chevron returns the header');
    }},

    {name: 'show_button_goes_first_into_header_right_cluster_when_toolbar_absent', fn(cli) {
        const reader = started(cli, {edit: false});
        expectFirstInHeader(reader, 'no edit right');

        const view = started(cli, {edit: true});
        const modes = h.need(view, 'CompactModes');
        modes.setMode('view');
        view.flush();
        expectFirstInHeader(view, 'edit right, «Просмотр»');
        modes.setMode('edit');
        view.flush();
        expectInToolbarEnd(view, 'back to «Редактирование»');

        const hidden = started(cli, {edit: true});
        h.runCommand(hidden, 'hideToolbar');
        expectFirstInHeader(hidden, '«Вид → Скрыть панель инструментов»');
        h.runCommand(hidden, 'hideToolbar');
        expectInToolbarEnd(hidden, 'toolbar returned');
    }},

    {name: 'show_main_part_starts_from_current_slide_and_arrow_lists_stock_show_menu', fn(cli) {
        const src = h.stockSource('controller/DocumentHolder.js');
        assert.match(src, /hkPreview\s*=\s*Common\.Utils\.isMac\s*\?\s*'command\+shift\+enter'\s*:\s*'ctrl\+f5'/, 'stock shortcut of the show from the beginning is Ctrl+F5');

        const w = started(cli, {edit: true});
        const parts = h.showParts(w);
        let m = h.mark(w);
        h.click(w, parts.main);
        let st = starts(w, m);
        assert.equal(st.length, 1, 'main part must start exactly one show');
        assert.deepEqual(st[0].args, [2, false, false, true], 'main part starts the show from the current slide');
        assert.equal(st[0].origin, 'stock', 'the show must be started by the stock preview handler');

        assert.ok(parts.arrow, 'the control has no ▾ part');
        const before = new Set(h.walk(w.doc.documentElement));
        h.click(w, parts.arrow);
        const scope = parts.sc.root;
        const els = [BEGIN, CURRENT, PRESENTER, SETTINGS].map(t => {
            const el = h.pickItem(w, t, scope, before);
            assert.ok(el, '▾ must list «' + t + '»');
            return el;
        });
        const pos = els.map(el => order(w, el));
        assert.deepEqual(pos.slice().sort((a, b) => a - b), pos, '▾ items must keep the stock order: ' + [BEGIN, CURRENT, PRESENTER, SETTINGS].join(' · '));
        const between = h.walk(w.doc.documentElement).slice(pos[2] + 1, pos[3]);
        assert.ok(between.some(el => /sep|divider/i.test(el.className) || el.getAttribute('role') === 'separator' || el.localName === 'hr'),
            'a separator must stand before «' + SETTINGS + '»');
        const beginRow = norm(rowOf(els[0]).textContent), currentRow = norm(rowOf(els[1]).textContent);
        if (/F5/.test(beginRow)) assert.match(beginRow, /Ctrl\+F5/, '«' + BEGIN + '» may show only the stock Ctrl+F5');
        assert.doesNotMatch(currentRow, /F5/, '«' + CURRENT + '» has no shortcut');

        const expect = [[BEGIN, [0, false, false, false]], [CURRENT, [2, false, false, true]], [PRESENTER, [0, true, false, false]]];
        for (const [label, args] of expect) {
            const p = h.showParts(w);
            const snap = new Set(h.walk(w.doc.documentElement));
            h.click(w, p.arrow);
            const el = h.pickItem(w, label, p.sc.root, snap);
            assert.ok(el, '▾ reopened must list «' + label + '»');
            m = h.mark(w);
            h.click(w, el);
            st = starts(w, m);
            assert.equal(st.length, 1, '«' + label + '» must start exactly one show');
            assert.deepEqual(st[0].args, args, '«' + label + '» must start the stock show with the stock arguments');
            assert.equal(st[0].origin, 'stock', '«' + label + '» must go through the stock handler');
            w.endShow();
        }
        const p = h.showParts(w);
        const snap = new Set(h.walk(w.doc.documentElement));
        h.click(w, p.arrow);
        m = h.mark(w);
        h.click(w, h.pickItem(w, SETTINGS, p.sc.root, snap));
        const dlg = h.since(w, m).dialogs;
        assert.equal(dlg.length, 1, '«' + SETTINGS + '» must open the stock dialog once');
        assert.equal(dlg[0].origin, 'stock', 'the dialog must be created by the stock handler');
        assert.equal(dlg[0].shown, true, 'the stock dialog must be shown');
    }},

    {name: 'slide_show_runs_in_stock_preview_presenter_window_and_settings_dialog', fn(cli) {
        const w = started(cli, {edit: true});
        const chevron = h.byId(w, 'vo-tb-end') && h.byId(w, 'vo-tb-end').lastElementChild;
        assert.ok(chevron, 'no right edge of the toolbar');
        h.click(w, chevron);
        assert.equal(h.rowShown(w, 'header'), false, 'focus mode is on before the show');

        const parts = h.showParts(w);
        let m = h.mark(w);
        h.click(w, parts.main);
        let s = h.since(w, m);
        const st = s.notices.filter(n => n.name === 'preview:start');
        assert.equal(st.length, 1, 'one stock show must start');
        assert.equal(st[0].origin, 'stock', 'the show is the stock DocumentPreview started by the stock handler');
        const own = s.api.filter(c => c.origin === 'shell' && /demonstration|preview|slideshow|reporter|presenter/i.test(c.name));
        assert.deepEqual(own.map(c => c.name), [], 'the shell must not drive the show engine itself');
        const ownShow = h.walk(w.doc.documentElement).filter(el => (el.closest('#vo-shell') || /^vo-/.test(el.id)) && !parts.sc.root.contains(el) &&
            /(^|[\s_-])(preview|slideshow|presenter|reporter)([\s_-]|$)/i.test(el.id + ' ' + el.className) && h.isVisibleNode(el) &&
            !el.closest('#pe-preview'));
        assert.deepEqual(ownShow.map(el => el.id || el.className), [], 'the shell must not draw a show surface of its own');

        m = h.mark(w);
        const esc = h.press(w, 'Escape', h.byId(w, 'pe-preview'));
        s = h.since(w, m);
        assert.equal(esc.defaultPrevented, false, 'Esc during the show belongs to the stock show and must not be taken by the shell');
        assert.equal(h.rowShown(w, 'header'), false, 'Esc during the show must not leave the focus mode');
        assert.deepEqual(s.act.filter(a => a.origin === 'shell').map(a => a.label), [], 'Esc during the show must not run shell commands');
        w.endShow();
        h.press(w, 'Escape');
        assert.equal(h.rowShown(w, 'header'), true, 'after the show Esc returns the header again');

        let p = h.showParts(w);
        const before = new Set(h.walk(w.doc.documentElement));
        h.click(w, p.arrow);
        m = h.mark(w);
        h.click(w, h.pickItem(w, PRESENTER, p.sc.root, before));
        const pr = starts(w, m);
        assert.equal(pr.length, 1, 'presenter view must start one show');
        assert.equal(pr[0].args[1], true, 'presenter view is the stock presenter flag of the stock show');
        assert.equal(pr[0].origin, 'stock', 'presenter view goes through the stock handler');
        w.endShow();

        p = h.showParts(w);
        const snap = new Set(h.walk(w.doc.documentElement));
        h.click(w, p.arrow);
        m = h.mark(w);
        h.click(w, h.pickItem(w, SETTINGS, p.sc.root, snap));
        const dlg = h.since(w, m);
        assert.equal(dlg.dialogs.length, 1, 'show settings must be the stock dialog');
        assert.equal(dlg.alerts.filter(a => a.origin === 'shell').length, 0, 'the shell must not open a dialog of its own');
    }},

    {name: 'view_menu_thumbnail_menu_and_ctrl_f5_start_the_same_stock_show', fn(cli) {
        const w = started(cli, {edit: true});
        h.findItem(w, 'Вид', 'Начать показ слайдов');
        const expect = [[BEGIN, [0, false, false, false]], [CURRENT, [2, false, false, true]], [PRESENTER, [0, true, false, false]]];
        for (const [label, args] of expect) {
            const el = h.menuPath(w, ['Вид', 'Начать показ слайдов', label]);
            const m = h.mark(w);
            h.click(w, el);
            const st = starts(w, m);
            assert.equal(st.length, 1, '«Вид → Начать показ слайдов → ' + label + '» must start one show');
            assert.deepEqual(st[0].args, args, '«Вид → Начать показ слайдов → ' + label + '» must be the stock show');
            assert.equal(st[0].origin, 'stock', 'the view menu must go through the stock handler');
            w.endShow();
        }

        const ext = h.stockSource('controller/DocumentHolderExt.js');
        assert.match(ext, /mnuPreview\.on\('click',\s*_\.bind\(me\.onPreview, me\)\)/, 'stock thumbnail menu starts the show with its own handler');
        const dh = w.views.DocumentHolder;
        assert.equal(dh.mnuPreview.listeners('click'), 0, 'the shell must not hook the stock «Начать показ слайдов» of the thumbnail menu');
        const ctxMenus = [];
        for (const el of h.walk(w.doc.documentElement).concat([w.doc])) {
            for (const [type, list] of Object.entries(el.__jqev || {})) if (type === 'contextmenu') list.filter(x => x.origin === 'shell').forEach(() => ctxMenus.push(el.id || el.localName));
            for (const l of el._ls || []) if (l.type === 'contextmenu' && l.origin === 'shell') ctxMenus.push(el.id || el.localName);
        }
        assert.deepEqual(ctxMenus, [], 'right click must stay with the stock menus');

        const own = w.shortcuts.delegated.filter(d => d.origin === 'shell').flatMap(d => Object.keys(d.map)).filter(k => /f5/i.test(k));
        assert.deepEqual(own, [], 'the shell must not register its own show shortcuts');
        assert.equal(w.shortcutActive('ctrl+f5'), true, 'stock Ctrl+F5 must stay active');
        for (const key of ['ctrl+F5', 'F5', 'shift+F5']) {
            const m = h.mark(w);
            const ev = h.press(w, key, h.byId(w, 'id_main_view'));
            const s = h.since(w, m);
            assert.equal(s.notices.filter(n => n.name === 'preview:start').length, 0, key + ' must not start a show from shell code');
            assert.equal(ev.defaultPrevented, false, key + ' must not be taken by the shell');
        }
        const m = h.mark(w);
        assert.equal(w.pressStockShortcut('ctrl+f5'), true, 'stock Ctrl+F5 handler must run');
        const st = starts(w, m);
        assert.equal(st.length, 1, 'Ctrl+F5 starts one show');
        assert.deepEqual(st[0].args, [0], 'Ctrl+F5 is the stock show from the beginning');
    }},

    /* Reconnect in "View": the stock drops its reason and returns "View" by a direct
       call, the ribbon mask suspends the shortcuts again — show and comment stay alive. */
    {name: 'view_mode_keeps_show_and_comment_keys_after_reconnect', fn() {
        const w = h.createWorld({edit: true, comment: true});
        h.boot(w);
        assert.equal(w.modules.CompactModes.setMode('view'), true, 'no view mode');
        assert.equal(w.shortcutActive('ctrl+f5') && w.shortcutActive('alt+h'), true, 'the keys are asleep in view mode');
        const opts = disable => ({viewMode: disable, allowSignature: false, rightMenu: {clear: false, disable: true},
            statusBar: true, leftMenu: {disable: true, previewMode: true}, fileMenu: {protect: true, history: true},
            comments: {disable: false, previewMode: true}, chat: true, review: true, viewport: true,
            documentHolder: {clear: false, disable: true}, toolbar: true, header: {search: false}, shortcuts: false,
            documentPreview: {draw: false}});
        const nc = w.ctx.Common.NotificationCenter;
        nc.trigger('editing:disable', true, opts(true), 'reconnect');
        nc.trigger('editing:disable', false, opts(false), 'reconnect');
        assert.equal(w.modules.CompactModes.mode(), 'view', 'view mode is lost');
        assert.equal(w.shortcutActive('ctrl+f5'), true, 'Ctrl+F5 sleeps after the reconnect');
        assert.equal(w.shortcutActive('alt+h'), true, 'Alt+H sleeps after the reconnect');
    }}
];

function norm(s) { return h.norm(s); }

h.run(tests);
