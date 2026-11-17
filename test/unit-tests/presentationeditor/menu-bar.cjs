/* Run: node test/unit-tests/presentationeditor/menu-bar.cjs [path to SlideActions.js]
 * The presentation shell menu bar in #vo-menubar is the shared compact layer menu bar
 * (Common.UI.Compact.MenuBar) with the presentation adapter: a submenu is a snapshot of the stock menu at the
 * moment of opening, a click is a lock recheck and one stock call, galleries are the twin's stock
 * popup list, the reason of a disabled item is visible before pressing, the wheel over
 * a long list scrolls the list and does not reach the page, F10 and the arrows reach every
 * section, item shortcuts come from the stock registry.
 *
 * The world is a fake stock editor from the shared shell check fixtures
 * (acceptance/mode-harness.cjs). The optional argument is a corrupted copy of the module for
 * a negative control: a copy that takes the submenu once from the start must fail
 * submenu_from_live_stock_menu; SlideActions with its own menu bar must fail
 * keyboard_reaches_every_section_from_f10 and shortcuts_come_from_the_stock_registry.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./acceptance/mode-harness.cjs');

const VIEW = path.join(h.PE_APP, 'view');
const FILE = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.join(VIEW, 'SlideActions.js');

function viewDir() {
    if (FILE === path.join(VIEW, 'SlideActions.js')) return VIEW;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-bar-'));
    for (const name of h.SHELL_MODULES) if (!h.SHARED_MODULES[name]) fs.copyFileSync(path.join(VIEW, name + '.js'), path.join(dir, name + '.js'));
    fs.copyFileSync(FILE, path.join(dir, 'SlideActions.js'));
    return dir;
}
const DIR = viewDir();

const RU = {textEdit: 'Правка', textSlide: 'Слайд', textArrange: 'Упорядочить', textReview: 'Рецензирование', textFormat: 'Формат',
    textSelectObject: 'Выделите объект на слайде'};

function world(opts, {pointerEvents = true} = {}) {
    const w = h.createWorld(opts || {edit: true}, {viewDir: DIR});
    if (pointerEvents) w.ctx.onpointerdown = null;
    Object.assign(w.modules.SlideActions, RU);
    h.boot(w);
    w.SA = w.modules.SlideActions;
    w.B = w.modules.StockBridge;
    return w;
}

const bar = w => h.byId(w, 'vo-menubar').querySelector('.vo-mn');
const sectionBtn = (w, label) => Array.from(bar(w).querySelectorAll('.vo-mn-item')).find(b => h.norm(b.textContent) === label);
function open(w, label) {
    const btn = sectionBtn(w, label);
    assert.ok(btn, 'menu bar has no section ' + label);
    h.click(w, btn);
    return btn.parentNode.querySelector('.vo-mn-drop');
}
const row = (root, k) => root.querySelector('[data-k="' + k + '"]');
const flies = w => Array.from(bar(w).querySelectorAll('.vo-mn-fly'));
const rowTexts = el => Array.from(el.querySelectorAll('.vo-mn-sub'), r => h.norm(r.querySelector('.vo-mn-t').textContent));

/* A twin's stock menu item: an ordinary stock item, not a plugin item. */
function stockItem(w, label, caption) {
    const it = h.makeTwin(w, label, {caption});
    it.isCustomItem = false;
    it.menu = null;
    /* The stock MenuItem.onItemClick: the item's 'click' that stock code subscribes to. */
    it.onItemClick = e => { if (!it.disabled) it.trigger('click', it, e); };
    return it;
}

const tests = [
    {name: 'canvas_press_without_mousedown_closes_menu', fn() {
        const w = world();
        const canvas = h.byId(w, 'id_viewer');
        canvas.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
        });
        open(w, 'Формат');
        assert.equal(w.SA.isMenuOpen(), true);
        const press = h.makeEvent(w.doc, 'pointerdown');
        h.dispatch(canvas, press);
        assert.equal(press.defaultPrevented, true, 'the canvas still handles the press');
        assert.equal(w.SA.isMenuOpen(), false, 'the menu closes without a compatibility mousedown');
        assert.equal(sectionBtn(w, 'Формат').getAttribute('aria-expanded'), 'false');
    }},

    {name: 'press_inside_menu_or_gallery_keeps_menu_open', fn() {
        const w = world();
        const gallery = w.doc.createElement('div');
        w.doc.body.appendChild(gallery);
        const closed = [];
        w.B.gallery = () => true;
        w.B.galleryOwns = node => gallery.contains(node);
        w.B.closeGallery = how => { closed.push(how); };
        const drop = open(w, 'Слайд');
        h.click(w, row(drop, 'changeLayout'));
        for (const target of [drop, gallery]) {
            const where = target === drop ? 'menu' : 'gallery';
            const press = h.makeEvent(w.doc, 'pointerdown');
            assert.equal(h.dispatch(target, press), true);
            assert.equal(w.SA.isMenuOpen(), true, 'a press in the ' + where + ' keeps the menu open');
            assert.deepEqual(closed, [], 'a press in the ' + where + ' keeps the gallery open');
        }
        h.dispatch(h.byId(w, 'id_viewer'), h.makeEvent(w.doc, 'pointerdown'));
        assert.equal(w.SA.isMenuOpen(), false, 'a press on the slide closes the menu');
        assert.deepEqual(closed, ['close'], 'a press on the slide closes the gallery once');
    }},

    {name: 'same_section_button_closes_menu', fn() {
        const w = world();
        open(w, 'Формат');
        assert.equal(w.SA.isMenuOpen(), true);
        h.click(w, sectionBtn(w, 'Формат'));
        assert.equal(w.SA.isMenuOpen(), false, 'the same section button closes the menu');
        assert.equal(sectionBtn(w, 'Формат').getAttribute('aria-expanded'), 'false');
    }},

    {name: 'outside_mousedown_closes_menu_without_pointer_events', fn() {
        const w = world(undefined, {pointerEvents: false});
        open(w, 'Формат');
        h.dispatch(h.byId(w, 'id_viewer'), h.makeEvent(w.doc, 'mousedown'));
        assert.equal(w.SA.isMenuOpen(), false);
    }},

    {name: 'submenu_from_live_stock_menu', fn() {
        const w = world();
        const twin = w.B.twin('ViewTab:btnGridlines');
        twin.menu.items = [stockItem(w, 'g0', 'Показать линии сетки'), stockItem(w, 'g1', 'Привязать объект к сетке')];
        /* Stock code prepares the menu on show: the item mark is by the engine at that moment. */
        let snap = false;
        twin.menu.on('show:before', () => { twin.menu.items[1].checked = snap; twin.menu.items[1].checkable = true; });
        let drop = open(w, 'Вид');
        h.click(w, row(drop, 'gridlines'));
        assert.equal(flies(w).length, 1, 'the submenu is open');
        assert.deepEqual(rowTexts(flies(w)[0]), ['Показать линии сетки', 'Привязать объект к сетке']);
        assert.equal(flies(w)[0].querySelectorAll('[aria-checked="true"]').length, 0, 'no check at first');
        h.click(w, sectionBtn(w, 'Вид'));
        assert.equal(flies(w).length, 0, 'closing the section closes the submenu');

        /* The stock menu changed after the selection changed: the submenu shows the new one. */
        snap = true;
        twin.menu.items.push(stockItem(w, 'g2', 'Сетка 2 см'));
        twin.menu.items[0].setDisabled(true);
        drop = open(w, 'Вид');
        h.click(w, row(drop, 'gridlines'));
        const fly = flies(w)[0];
        assert.deepEqual(rowTexts(fly), ['Показать линии сетки', 'Привязать объект к сетке', 'Сетка 2 см'], 'the submenu follows the stock menu');
        assert.equal(fly.querySelectorAll('[aria-checked="true"]').length, 1, 'the check follows the stock menu');
        assert.ok(fly.querySelector('.vo-mn-sub').classList.contains('vo-locked'), 'a stock-disabled item is grey');

        /* Choosing is the stock item click, one. */
        const m = h.mark(w);
        h.click(w, fly.querySelectorAll('.vo-mn-sub')[2]);
        const acts = h.since(w, m).act.filter(a => a.event === 'click');
        assert.deepEqual(acts.map(a => a.label), ['g2'], 'the stock item is clicked once');
        assert.equal(w.SA.isMenuOpen(), false, 'a choice closes the menu');
    }},

    {name: 'click_rechecks_lock', fn() {
        const w = world();
        const drop = open(w, 'Правка');
        const r = row(drop, 'paste');
        assert.ok(!r.classList.contains('vo-locked'), '«Вставить» is live when the section opens');
        const twin = w.B.twin('Toolbar:btnPaste');
        twin.setDisabled(true);
        const m = h.mark(w);
        h.click(w, r);
        assert.equal(h.since(w, m).act.filter(a => a.label === 'Toolbar:btnPaste').length, 0, 'a locked twin is not called');
        assert.ok(r.classList.contains('vo-locked'), 'the row turns grey on the click');
        assert.equal(w.SA.isMenuOpen(), true, 'the menu stays open, as the stock one does');
    }},

    {name: 'one_stock_call_per_item', fn() {
        const w = world();
        /* "Insert → Symbol" is "More symbols" of the stock button menu (the "Symbol" window), alive by the button itself. */
        for (const [label, k, twin, live] of [['Вставка', 'symbol', 'Toolbar:btnInsertSymbol.menu[2]', 'Toolbar:btnInsertSymbol'],
            ['Правка', 'undo', 'Toolbar:btnUndo'], ['Слайд', 'duplicateSlide', 'DocumentHolder:mnuDuplicateSlide'], ['Вид', 'rulers', 'ViewTab:chRulers']]) {
            w.B.twin(live || twin).setDisabled(false);
            const drop = open(w, label);
            const m = h.mark(w);
            h.click(w, row(drop, k));
            const s = h.since(w, m);
            const acts = s.act.filter(a => a.origin === 'shell');
            assert.deepEqual(acts.map(a => a.label), [twin], label + ' → ' + k + ': one stock call');
            assert.deepEqual(h.shellEdits(s.api).map(c => c.name), [], label + ' → ' + k + ': no own engine edits');
            assert.equal(w.SA.isMenuOpen(), false, 'the menu closes after the command');
        }
        /* An own shell command: its executor, once. */
        let runs = 0;
        w.shell.command('focus', () => { runs++; });
        h.click(w, row(open(w, 'Вид'), 'focus'));
        assert.equal(runs, 1, '«Вид → Режим фокуса» runs the shell command once');
    }},

    {name: 'gallery_items_open_stock_picker', fn() {
        const w = world();
        const calls = [];
        w.B.gallery = (ref, anchor, opts) => { calls.push({ref, anchor, opts}); return true; };
        const cases = [['Слайд', 'changeLayout', 'Toolbar:btnChangeSlide'], ['Вставка', 'shape', 'Toolbar:cmbsInsertShape.0'],
            ['Слайд', 'colorSchemas', 'Toolbar:btnColorSchemas'], ['Слайд', 'slideSize', 'Toolbar:btnSlideSize']];
        for (const [label, k, ref] of cases) {
            const drop = open(w, label);
            const r = row(drop, k);
            const m = h.mark(w);
            calls.length = 0;
            h.click(w, r);
            assert.equal(calls.length, 1, label + ' → ' + k + ': the stock gallery is shown');
            assert.equal(calls[0].ref, ref);
            assert.equal(calls[0].anchor, r, 'the gallery stands at the menu row');
            assert.equal(h.since(w, m).act.filter(a => a.origin === 'shell').length, 0, 'opening the gallery does not run the command');
            assert.ok(r.classList.contains('vo-sub-open'), 'the row stays open while the gallery is shown');
            /* Choosing in a gallery closes the menu. */
            calls[0].opts.onClose('pick');
            assert.equal(w.SA.isMenuOpen(), false, 'a pick in the gallery closes the menu');
        }
    }},

    {name: 'thumbs_row_mark_follows_choice', fn() {
        /* An engine that hides the strip does not send asc_onThumbnailsShow: the row mark is by the choice. */
        const w = world();
        w.fire('asc_onThumbnailsShow', true);
        const marks = [];
        for (let i = 0; i < 3; i++) {
            const r = row(open(w, 'Вид'), 'thumbs');
            marks.push(r.getAttribute('aria-checked'));
            h.click(w, r);
            assert.equal(w.SA.isMenuOpen(), false, 'the menu closes after «Слайды»');
        }
        marks.push(row(open(w, 'Вид'), 'thumbs').getAttribute('aria-checked'));
        assert.deepEqual(marks, ['true', 'false', 'true', 'false'], 'the «Слайды» mark after each choice');
    }},

    {name: 'disabled_item_shows_reason', fn() {
        const w = world();
        w.modules.SlideSelection.kind = () => 'none';
        const drop = open(w, 'Правка');
        const r = row(drop, 'cut');
        assert.ok(r.classList.contains('vo-locked'), '«Вырезать» is grey without an object');
        assert.equal(r.getAttribute('aria-disabled'), 'true');
        assert.equal(r.getAttribute('title'), RU.textSelectObject, 'the reason is shown before the press');
        assert.ok(h.itemReasonShown(r, RU.textSelectObject));
        assert.equal(r.hasAttribute('disabled'), false, 'not the disabled attribute: the click must still reach the recheck');
        assert.equal(row(drop, 'copy').getAttribute('title'), null, 'a live item has no reason');
    }},

    {name: 'mirror_rows_take_catalog_icons', fn() {
        const w = world();
        w.modules.SlideSelection.kind = () => 'shape';
        const twin = w.B.twin('DocumentHolder:menuImgShapeRotate');
        assert.ok(twin, 'no stock rotate menu');
        /* The stock "Rotate" menu: the item icon is a btn-* class in iconCls. */
        const items = [['r90', 'Повернуть на 90° по часовой стрелке', 'menu__icon btn-rotate-90'],
            ['r270', 'Повернуть на 90° против часовой стрелки', 'menu__icon btn-rotate-270'],
            ['fh', 'Отразить слева направо', 'menu__icon btn-flip-hor'],
            ['fv', 'Отразить сверху вниз', 'menu__icon btn-flip-vert'],
            ['other', 'Другой пункт', 'menu__icon btn-other']];
        twin.menu.items = items.map(([label, caption, cls]) => {
            const it = stockItem(w, label, caption);
            it.iconCls = cls;
            return it;
        });
        h.click(w, row(open(w, 'Упорядочить'), 'rotate'));
        const fly = flies(w)[0];
        assert.ok(fly, 'the rotate submenu is open');
        const icons = Array.from(fly.querySelectorAll('.vo-mn-sub'), r => r.querySelector('.vo-mn-i'));
        assert.equal(icons.length, 5);
        const air = el => { const s = el.querySelector('.vo-air'); return s ? /img\/air\/(\w+)\.svg/.exec(s.getAttribute('style') || '')[1] : null; };
        assert.equal(air(icons[0]), 'rotateCw', 'clockwise rotation: the AIR glyph');
        assert.equal(air(icons[1]), 'rotateCcw', 'counterclockwise rotation: the AIR glyph');
        assert.equal(air(icons[2]), 'compare', '«Отразить слева направо»: the AIR glyph');
        assert.equal(air(icons[3]), 'flipV', '«Отразить сверху вниз»: the AIR glyph');
        assert.ok(!icons[4].firstChild, 'an item not in the table has no icon (the empty glyph place is hidden by the styles)');
        /* Without an icon table for a catalog item: snapshot rows without icons. */
        const grid = w.B.twin('ViewTab:btnGridlines');
        grid.menu.items = [stockItem(w, 'g0', 'Показать линии сетки')];
        grid.menu.items[0].iconCls = 'menu__icon btn-flip-hor';
        h.click(w, row(open(w, 'Вид'), 'gridlines'));
        assert.ok(!flies(w)[0].querySelector('.vo-mn-i .vo-air'), 'icons come from the catalog item only');
    }},

    /* The wheel over a long list scrolls the list itself (the browser does the scrolling) and does not
       reach the page: the SDK wheel handler would cancel it on bubbling. A list with nothing
       to scroll swallows the wheel. */
    {name: 'long_menu_scrolls_with_wheel', fn() {
        const w = world();
        const drop = open(w, 'Вид');
        let prevented = false, stopped = false;
        const wheel = () => {
            prevented = stopped = false;
            const e = h.makeEvent(w.doc, 'wheel', {deltaY: 120, deltaMode: 0});
            e.preventDefault = () => { prevented = true; };
            e.stopPropagation = () => { stopped = true; };
            h.dispatch(drop, e);
        };
        drop.style.overflowY = 'auto';
        Object.defineProperty(drop, 'scrollHeight', {value: 900, configurable: true});
        Object.defineProperty(drop, 'clientHeight', {value: 400, configurable: true});
        wheel();
        assert.ok(stopped, 'the wheel over the list does not reach the page');
        assert.ok(!prevented, 'a long list scrolls by the wheel itself');
        Object.defineProperty(drop, 'scrollHeight', {value: 400, configurable: true});
        wheel();
        assert.ok(stopped && prevented, 'a list with nothing to scroll swallows the wheel');
    }},

    /* The menu bar is the shared compact layer bar: F10 puts the focus on the first section, the arrows
       go through all nine sections in a circle, the arrow down opens a section, Esc closes
       it and leaves the focus on the section. */
    {name: 'keyboard_reaches_every_section_from_f10', fn() {
        const w = world();
        const labels = Array.from(bar(w).querySelectorAll('.vo-mn-wrap > .vo-mn-item'))
            .filter(b => !b.parentNode.classList.contains('vo-mn-more')).map(b => h.norm(b.textContent));
        assert.equal(labels.length, 9, 'nine sections: ' + labels.join(', '));
        /* The bar is visible: the fake node has no rects, and F10 does not enter an invisible bar. */
        bar(w).getClientRects = () => [{width: 1, height: 1}];
        /* No stock window is open: under one, F10 stays with the window. */
        w.ctx.Common.Utils.ModalWindow = {isVisible: () => false};
        h.press(w, 'F10', w.doc.body);
        const at = () => h.norm(w.doc.activeElement && w.doc.activeElement.textContent || '');
        assert.equal(at(), labels[0], 'F10 puts the focus on the first section');
        const seen = [at()];
        for (let i = 1; i < labels.length; i++) {
            h.press(w, 'ArrowRight');
            seen.push(at());
        }
        assert.deepEqual(seen, labels, 'the arrows reach every section in order');
        h.press(w, 'ArrowRight');
        assert.equal(at(), labels[0], 'the arrows go round');
        h.press(w, 'ArrowDown');
        assert.ok(w.SA.isMenuOpen(), 'the arrow down opens the section');
        h.press(w, 'Escape');
        assert.ok(!w.SA.isMenuOpen(), 'Esc closes the section');
        assert.equal(at(), labels[0], 'the focus stays on the section');
    }},

    /* An item shortcut comes from the stock shortcut registry (Common.Controllers.Shortcuts):
       a reassigned shortcut is visible in the menu, the shell has no shortcut text of its own. */
    {name: 'shortcuts_come_from_the_stock_registry', fn() {
        const w = h.createWorld({edit: true}, {viewDir: DIR});
        Object.assign(w.modules.SlideActions, RU);
        const asked = [];
        w.controllers['Common.Controllers.Shortcuts'] = {getShortcutsByActionType(type) {
            asked.push(type);
            return type === 'Save' ? [{keys: ['Ctrl', 'Shift', 'Q']}] : type === 'EditUndo' ? [{keys: ['Alt', 'Z']}] : null;
        }};
        h.boot(w);
        w.SA = w.modules.SlideActions;
        const hint = (drop, k) => { const r = row(drop, k); const el = r && r.querySelector('.vo-mn-h'); return el ? h.norm(el.textContent) : ''; };
        assert.equal(hint(open(w, 'Файл'), 'save'), 'Ctrl+Shift+Q', '«Сохранить» shows the registry shortcut');
        assert.equal(hint(open(w, 'Правка'), 'undo'), 'Alt+Z', '«Отменить» shows the registry shortcut');
        assert.equal(hint(open(w, 'Правка'), 'redo'), '', 'no registry shortcut — no shortcut at the item');
        assert.ok(asked.includes('Save') && asked.includes('EditUndo') && asked.includes('EditRedo'), 'the registry is asked by action names');
    }}
];

h.run(tests);
