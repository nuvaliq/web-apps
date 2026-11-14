/* Run: node test/unit-tests/presentationeditor/acceptance/mode-rights.cjs [--only <name>] [--view-dir <dir>]
 * Rights and modes of the presentation compact shell: the "Editing / View" switch,
 * greyed commands with their reasons, the stock view-mode context menus, stock visibility of
 * twins, and the reader's status bar and right panel entries.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const h = require('./mode-harness.cjs');

const VIEW_REASON = 'Недоступно в режиме просмотра';
const RIGHT_REASON = 'Нет права на редактирование';

function started(cli, opts) {
    const w = h.createWorld(opts, cli);
    h.boot(w);
    return w;
}
function editItems(w) {
    const list = h.allItems(h.catalog(w)).filter(x => x.it.edit === true);
    assert.ok(list.length >= 30, 'the catalog must mark the items that change the presentation (edit: true), found ' + list.length);
    return list;
}
function expectGrey(w, list, reason, why) {
    const wrong = [];
    for (const {it, section} of list) {
        const st = h.itemState(w, it);
        if (st.disabled !== true || st.reason !== reason) wrong.push(section + ' → ' + it.t + ' (' + (st.disabled ? 'grey' : 'live') + ', «' + (st.reason || '') + '»)');
    }
    assert.deepEqual(wrong, [], why + ': items must be grey with «' + reason + '»');
}
function setMode(w, mode) {
    const modes = h.need(w, 'CompactModes');
    modes.setMode(mode);
    w.flush();
    assert.equal(modes.mode(), mode, 'CompactModes.mode() after setMode(' + mode + ')');
}
function setTwinDisabled(w, section, label, disabled) {
    const it = h.findItem(w, section, label);
    const twin = h.twinOf(w, it);
    if (twin) twin.setDisabled(disabled);
    return it;
}

/* Stock view-mode menus of the stock DocumentHolderExt, built for the given state of the stock controller. */
function stockViewMenus(mode, isDisabled, api, slidesCount) {
    const file = path.join(h.PE_APP, 'view/DocumentHolderExt.js');
    class MenuItem {
        constructor(o) { Object.assign(this, o || {}); this.visible = true; this.disabled = false; }
        setVisible(v) { this.visible = !!v; }
        setDisabled(v) { this.disabled = !!v; }
        isVisible() { return this.visible; }
        on() { return this; }
    }
    class Menu {
        constructor(o) { this.options = o; this.items = o.items.map(i => (i instanceof MenuItem ? i : new MenuItem(i))); }
        on() { return this; }
    }
    const locale = {};
    const ru = JSON.parse(fs.readFileSync(path.join(h.ROOT, 'apps/presentationeditor/main/locale/ru.json'), 'utf8'));
    Object.keys(ru).forEach(k => { if (k.startsWith('PE.Views.DocumentHolder.')) locale[k.slice(24)] = ru[k]; });
    const ctx = {PE: {Views: {DocumentHolder: {prototype: {}}}}, Common: {UI: {MenuItem, Menu}}};
    ctx.window = ctx;
    ctx.define = (deps, f) => f();
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: 'stock:view/DocumentHolderExt.js'});
    const dh = Object.assign(Object.create(ctx.PE.Views.DocumentHolder.prototype), locale,
        {mode, api, _isDisabled: isDisabled, slidesCount, fireEvent() {}, clearCustomItems() {}});
    dh.createDelayedElementsViewer();
    const shown = (menu, value) => {
        menu.options.initMenu(value);
        return Array.from(menu.items).filter(i => i.visible).map(i => (i.caption === '--' ? '—' : String(i.caption)));
    };
    return {
        slide: value => shown(dh.viewModeMenuSlide, value),
        object: value => shown(dh.viewModeMenu, value)
    };
}

const tests = [
    {name: 'edit_right_has_mode_switch_rightmost_and_view_mode_greys_editing_items', fn(cli) {
        const w = started(cli, {edit: true});
        const header = h.byId(w, 'vo-header');
        const slot = h.byId(w, 'vo-hdr-show');
        assert.ok(header && slot, 'the header with its right cluster (#vo-hdr-show) is missing');
        const cluster = slot.parentNode;
        const label = h.findByLabel(cluster, 'Редактирование', {visible: false})[0];
        assert.ok(label, 'the right cluster of the header has no mode switch showing «Редактирование»');
        let root = label;
        while (root.parentNode && root.parentNode !== cluster) root = root.parentNode;
        const after = [];
        for (let s = root.nextElementSibling; s; s = s.nextElementSibling) {
            if (!h.isVisibleNode(s) || /pop|drop|menu|tip/i.test(s.className)) continue;
            if (h.clickables(s).length || h.labelOf(s)) after.push(s.id || s.className || s.localName);
        }
        assert.deepEqual(after, [], 'the mode switch must be the rightmost control of the header');
        const beforeIt = [];
        for (let s = root.previousElementSibling; s; s = s.previousElementSibling) beforeIt.push(s);
        assert.ok(beforeIt.some(s => h.walk(s).some(el => h.textStartsWith(el, 'Скачать'))), '«Скачать ▾» must stand left of the mode switch');

        setMode(w, 'view');
        assert.equal(w.shell.hasToolbar(), false, 'in «Просмотр» there is no toolbar');
        assert.ok(h.findByLabel(header, 'Просмотр', {visible: false}).length, 'the header switch must show «Просмотр»');
        expectGrey(w, editItems(w), VIEW_REASON, '«Просмотр»');
        const copy = h.itemState(w, h.findItem(w, 'Правка', 'Копировать'));
        assert.notEqual(copy.reason, VIEW_REASON, '«Копировать» does not change the presentation and is not greyed by «Просмотр»');
        const el = h.menuPath(w, ['Правка', 'Вставить']);
        assert.ok(h.itemReasonShown(el, VIEW_REASON), '«Правка → Вставить» must show «' + VIEW_REASON + '» before it is pressed');
    }},

    {name: 'without_edit_right_no_switch_no_toolbar_and_editing_items_grey_with_no_right_reason', fn(cli) {
        const w = started(cli, {edit: false, comment: true});
        const header = h.byId(w, 'vo-header');
        assert.ok(header, 'no #vo-header');
        const sw = h.findByLabel(header, 'Редактирование', {visible: false}).concat(h.findByLabel(header, 'Просмотр', {visible: false}));
        assert.equal(sw.length, 0, 'without edit right the header has no mode switch');
        assert.equal(w.shell.hasToolbar(), false, 'without edit right there is no toolbar');
        assert.equal(w.shell.editRight(), false, 'editRight() is false for a reader');
        const list = editItems(w);
        expectGrey(w, list, RIGHT_REASON, 'no edit right');
        const hidden = list.filter(x => { const st = h.itemState(w, x.it); return st.hidden === true || st.visible === false; });
        assert.deepEqual(hidden.map(x => x.section + ' → ' + x.it.t), [], 'editing items stay visible, grey');
        for (const [section, label] of [['Вставка', 'Комментарий']]) {
            const st = h.itemState(w, h.findItem(w, section, label));
            assert.notEqual(st.disabled, true, section + ' → ' + label + ' must be live with the comment right and without edit right');
        }
        const nc = started(cli, {edit: false, comment: false});
        for (const [section, label] of [['Вставка', 'Комментарий']]) {
            const it = h.allItems(h.catalog(nc)).find(x => x.section === section && h.strip(x.it.t) === label);
            if (!it) continue;
            const st = h.itemState(nc, it.it);
            assert.ok(st.disabled === true || st.hidden === true || st.visible === false, section + ' → ' + label + ' must not be live without the comment right');
        }
    }},

    {name: 'unavailable_commands_grey_with_exact_reason_shown_before_press', fn(cli) {
        const w = started(cli, {edit: true});
        setTwinDisabled(w, 'Правка', 'Отменить', true);
        setTwinDisabled(w, 'Правка', 'Повторить', true);
        setTwinDisabled(w, 'Вид', 'Приостановить запись', true);
        w.fire('asc_onCanUndo', false);
        w.fire('asc_onCanRedo', false);
        h.select(w, 'slide');
        const nothing = [
            ['Правка', 'Отменить', 'Нечего отменять'],
            ['Правка', 'Повторить', 'Нечего повторить'],
            ['Правка', 'Вырезать', 'Выделите объект на слайде'],
            ['Правка', 'Удалить', 'Выделите объект на слайде'],
            ['Упорядочить', 'Порядок', 'Выделите объект на слайде'],
            ['Формат', 'Текст', 'Выделите текст'],
            ['Формат', 'Таблица', 'Выделите таблицу'],
            ['Формат', 'Изображение', 'Выделите изображение'],
            ['Вид', 'Приостановить запись', 'Запись макроса не идёт']
        ];
        const wrong = [];
        for (const [section, label, reason] of nothing) {
            const st = h.itemState(w, h.findItem(w, section, label));
            if (st.disabled !== true || st.reason !== reason) wrong.push(section + ' → ' + label + ': want «' + reason + '», got ' + (st.disabled ? '«' + (st.reason || '') + '»' : 'live'));
        }
        h.select(w, 'slide', 'shape');
        setTwinDisabled(w, 'Упорядочить', 'Сгруппировать', true);
        setTwinDisabled(w, 'Упорядочить', 'Разгруппировать', true);
        setTwinDisabled(w, 'Упорядочить', 'Объединить фигуры', true);
        const one = [
            ['Упорядочить', 'Сгруппировать', 'Выделите два объекта и больше'],
            ['Упорядочить', 'Разгруппировать', 'Выделенное — не группа'],
            ['Упорядочить', 'Объединить фигуры', 'Выделите две фигуры и больше']
        ];
        for (const [section, label, reason] of one) {
            const st = h.itemState(w, h.findItem(w, section, label));
            if (st.disabled !== true || st.reason !== reason) wrong.push(section + ' → ' + label + ' (one shape): want «' + reason + '», got ' + (st.disabled ? '«' + (st.reason || '') + '»' : 'live'));
        }
        assert.deepEqual(wrong, [], 'reasons of unavailable commands');

        h.select(w, 'slide');
        const undo = h.menuPath(w, ['Правка', 'Отменить']);
        assert.ok(h.itemReasonShown(undo, 'Нечего отменять'), 'the menu item must show its reason before it is pressed');
        const tb = h.byId(w, 'vo-toolbar');
        const inToolbar = el => h.walk(el).some(x => h.norm(x.textContent).indexOf('Нечего отменять') >= 0 || h.labelOf(x).indexOf('Нечего отменять') >= 0 ||
            (x.getAttribute('aria-description') || '').indexOf('Нечего отменять') >= 0);
        let shown = inToolbar(tb);
        if (!shown) {
            const btn = h.walk(tb).find(x => h.labelOf(x).startsWith('Отменить'));
            assert.ok(btn, 'the toolbar has no «Отменить» button');
            const before = new Set(h.walk(w.doc.documentElement));
            h.hover(w, btn);
            shown = h.walk(w.doc.documentElement).some(x => !before.has(x) && h.norm(x.textContent).indexOf('Нечего отменять') >= 0) || inToolbar(tb);
        }
        assert.ok(shown, 'the toolbar «Отменить» must tell «Нечего отменять» before it is pressed');
    }},

    {name: 'view_mode_and_reader_right_click_get_stock_view_menus_without_editing_commands', fn(cli) {
        const src = h.stockSource('controller/DocumentHolder.js');
        assert.match(src, /\(me\.mode\.isEdit && !me\._isDisabled\) \? me\.documentHolder\.slideMenu : me\.documentHolder\.viewModeMenuSlide/,
            'stock choice of the thumbnail menu');
        const api = {asc_getCanUndo: () => true, can_AddQuotedComment: () => true, can_CopyCut: () => true};
        const SELECT_ALL = h.ruText('PE.Views.DocumentHolder.txtSelectAll');
        const PRINT_SEL = h.ruText('PE.Views.DocumentHolder.txtPrintSelection');
        const START = h.ruText('PE.Views.DocumentHolder.txtPreview');
        const COPY = h.ruText('PE.Views.DocumentHolder.textCopy');
        const UNDO = h.ruText('PE.Views.DocumentHolder.textUndo');
        const ADD = h.ruText('PE.Views.DocumentHolder.addCommentText');
        const shellContextMenus = w => {
            const out = [];
            for (const el of h.walk(w.doc.documentElement).concat([w.doc, w.winTarget])) {
                for (const [type, list] of Object.entries(el.__jqev || {})) if (type === 'contextmenu' && list.some(x => x.origin === 'shell')) out.push(el.id || el.localName || 'document');
                for (const l of el._ls || []) if (l.type === 'contextmenu' && l.origin === 'shell') out.push(el.id || el.localName || 'document');
            }
            return out;
        };

        const w = started(cli, {edit: true, comment: true, print: true});
        setMode(w, 'view');
        const dh = w.controllers.DocumentHolder;
        assert.equal(w.appOptions.isEdit, false, '«Просмотр» must make the stock editor treat the document as not editable (stock left menu lock)');
        assert.equal(dh._isDisabled, false, '«Просмотр» must keep the stock document holder enabled (live «Отменить» and «Добавить комментарий»)');
        let menus = stockViewMenus(w.appOptions, dh._isDisabled, api, 5);
        assert.deepEqual(menus.slide({fromThumbs: true}), [SELECT_ALL, PRINT_SEL, '—', START], '«Просмотр», thumbnail: stock viewModeMenuSlide');
        assert.deepEqual(menus.object({isChart: false}), [COPY, UNDO, '—', ADD], '«Просмотр», object: stock viewModeMenu');
        assert.deepEqual(menus.object({isChart: true}), [COPY, UNDO], '«Просмотр», chart: no «Добавить комментарий»');
        assert.deepEqual(shellContextMenus(w), [], 'the shell must not handle right clicks itself');

        const r = started(cli, {edit: false, comment: false, print: false});
        assert.equal(r.appOptions.isEdit, false, 'reader stays not editable');
        assert.equal(r.controllers.DocumentHolder._isDisabled, false, 'the shell must not lock the stock document holder for a reader');
        menus = stockViewMenus(r.appOptions, r.controllers.DocumentHolder._isDisabled, api, 5);
        assert.deepEqual(menus.slide({fromThumbs: true}), [SELECT_ALL, '—', START], 'reader without print right, thumbnail');
        assert.deepEqual(menus.object({isChart: false}), [COPY], 'reader without comment right, object');
        assert.deepEqual(shellContextMenus(r), [], 'the shell must not handle right clicks itself');
    }},

    {name: 'stock_visibility_and_availability_carried_over_except_reader_and_view_greys', fn(cli) {
        const w = started(cli, {edit: true});
        const it = h.findItem(w, 'Слайд', 'Новый слайд');
        const twin = h.twinOf(w, it);
        assert.ok(twin, '«Слайд → Новый слайд» must be bound to a stock control');
        twin.setDisabled(true);
        w.flush();
        assert.equal(h.itemState(w, it).disabled, true, 'a stock control locked (co-author, slide master) greys the item');
        twin.setDisabled(false);
        w.flush();
        assert.notEqual(h.itemState(w, it).disabled, true, 'an unlocked stock control makes the item live again');

        const prot = h.findItem(w, 'Файл', 'Сведения о документе');
        const pt = h.twinOf(w, prot);
        assert.ok(pt, '«Файл → Сведения о документе» must be bound to a stock control');
        pt.setVisible(false);
        w.flush();
        assert.equal(h.isHiddenItem(w, 'Файл', prot), true, 'a command the stock editor hides must not be shown');
        pt.setVisible(true);
        w.flush();
        assert.equal(h.isHiddenItem(w, 'Файл', prot), false, 'a command the stock editor shows is shown');

        setMode(w, 'view');
        const st = h.itemState(w, it);
        assert.equal(st.disabled, true, 'in «Просмотр» the editing item is grey even though the stock mask leaves the twin as is');
        assert.equal(st.reason, VIEW_REASON, 'in «Просмотр» the reason is the mode');

        const r = started(cli, {edit: false});
        const rit = h.allItems(h.catalog(r)).find(x => x.section === 'Слайд' && h.strip(x.it.t) === 'Новый слайд');
        assert.ok(rit, 'without edit right «Слайд → Новый слайд» stays in the menu (grey)');
        const rst = h.itemState(r, rit.it);
        assert.equal(rst.hidden === true || rst.visible === false, false, 'not created by the stock editor for a reader, still shown grey');
        assert.equal(rst.disabled, true, 'reader: grey');
        assert.equal(rst.reason, RIGHT_REASON, 'reader: reason');
    }},

    {name: 'reader_status_bar_lacks_language_and_spelling_and_right_panel_items_grey', fn(cli) {
        const w = started(cli, {edit: false});
        w.fire('asc_onCountPages', 5);
        w.fire('asc_onCurrentPage', 2);
        w.flush();
        const status = h.byId(w, 'vo-status');
        assert.ok(status, 'no status bar #vo-status');
        const texts = h.walk(status).map(el => h.norm(el.textContent) + ' ' + h.labelOf(el)).join(' | ');
        assert.ok(texts.indexOf('Слайд 3 из 5') >= 0, 'status bar must show «Слайд 3 из 5»');
        assert.ok(h.findByLabel(status, 'По ширине', {visible: false}).length, 'status bar must show «По ширине»');
        assert.ok(h.findByLabel(status, 'По размеру слайда', {visible: false}).length, 'status bar must show «По размеру слайда»');
        assert.equal(h.findByLabel(status, 'Проверка орфографии', {visible: false}).length, 0, 'no «Проверка орфографии» without edit right');
        assert.ok(!/Русский|Язык/i.test(texts), 'no document language without edit right');

        const items = [['Формат', 'Свойства объекта'], ['Слайд', 'Фон'], ['Вставка', 'Анимация'],
            ['Вид', 'Обычный'], ['Вид', 'Образец слайдов'], ['Вид', 'Линейки'], ['Вид', 'Направляющие'],
            ['Вид', 'Линии сетки'], ['Вид', 'Макросы'], ['Правка', 'Орфография'], ['Правка', 'Язык документа']];
        const wrong = [];
        for (const [section, label] of items) {
            const st = h.itemState(w, h.findItem(w, section, label));
            if (st.disabled !== true || st.reason !== RIGHT_REASON || st.hidden === true) wrong.push(section + ' → ' + label + ' (' + (st.disabled ? '«' + (st.reason || '') + '»' : 'live') + ')');
        }
        assert.deepEqual(wrong, [], 'reader: items must be grey with «' + RIGHT_REASON + '»');

        const bodyBefore = w.doc.body.className;
        const m = h.mark(w);
        try { h.runCommand(w, 'objectProperties'); } catch (e) { /* refusing the command is fine */ }
        const opened = h.since(w, m).calls.filter(c => /^RightMenu/.test(c.target) && /^(show|open|expand|setactivepane|onrightmenuopen|toggle)/i.test(c.name));
        assert.deepEqual(opened.map(c => c.target + '.' + c.name), [], 'reader: the right panel must not open');
        assert.equal(w.doc.body.className, bodyBefore, 'reader: the shell layout must not switch to an open right panel');
    }}
];

h.run(tests);
