/* Run: node test/unit-tests/presentationeditor/slide-sections-design.cjs [path to SlideSections.js]
 * The presentation shell right panel (a popup panel over the canvas): composition: five
 * sections, "Object settings" only with an object, the card name is the section title;
 * "Slide settings" is the stock "Slide" tab with the layout and slide size, "Theme" is the tiles of the
 * stock theme gallery and the color scheme from the stock menu, "Animation" is the effects of the stock
 * gallery by its groups and a hint without an object, for a chart it is the stock "Shape" tab;
 * styles are under body.vo-compact. The paragraph card (openParagraph) holds the paragraph tab
 * and its label while the tab is available; refusing to open it leaves an open section unchanged.
 *
 * The environment is the workspace fixture (acceptance/area-harness.cjs). The optional argument is
 * a corrupted copy of the module for a negative control: a copy in which the object section is available
 * without a selection must fail five_sections_object_only_with_object.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const h = require('./acceptance/area-harness.cjs');

const FILE = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : null;

function started(opts) {
    const env = h.createEnv(opts);
    if (FILE) {
        vm.runInContext(fs.readFileSync(FILE, 'utf8'), env.context, {filename: FILE});
        env.loaded.SlideSections = true;
    }
    env.start();
    env.SS = env.module('SlideSections');
    env.run = (name, ...a) => { const r = env.shell.command(name)(...a); env.drain(); return r; };
    env.el = sel => env.document.querySelector(sel);
    env.all = sel => env.document.querySelectorAll(sel);
    return env;
}

function fire(el, type) {
    el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(type, {bubbles: true}));
}

/* Stock menu items as the bridge sees them: an item has no click(), a click is its
   onItemClick (MenuItem: the mark, the item's 'click', the menu's 'item:click'). */
function stockItems(menu) {
    menu.items.forEach(it => {
        it.click = undefined;
        it.onItemClick = function () {
            if (this.checkable) this.setChecked(true);
            this.trigger('click', this);
            menu.trigger('item:click', menu, this);
        };
    });
}

const rules = () => h.lessRules(h.lessFile('compact-panel.less'), 'compact-panel.less');

/* The less compiler is from build/ of this copy or the main one (the shared git directory). */
function lessCompiler() {
    const root = path.resolve(__dirname, '../../..');
    const roots = [path.join(root, 'build')];
    try {
        const common = cp.execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
            {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
        roots.push(path.join(path.dirname(common), 'build'));
    } catch (e) { /* without git, only the tree */ }
    for (const r of roots) {
        try { return require(require.resolve('less', {paths: [r]})); } catch (e) { /* next */ }
    }
    throw new Error('the less compiler is not found (npm install in build/ of the web-apps copy)');
}

/* The panel rules after the build: shell tokens (its blocks before "Shell"), window building blocks
   only by reference (their rules are not output), compact-panel.less. [{sels, decls: {prop: value}}]. */
let panelCssCache = null;
function panelCss() {
    if (panelCssCache) return panelCssCache;
    const dir = path.resolve(__dirname, '../../../apps/presentationeditor/main/resources/less');
    const file = path.join(dir, 'compact-shell.less');
    const shellSrc = fs.readFileSync(file, 'utf8');
    const cut = shellSrc.indexOf('/* --- Shell');
    assert.ok(cut > 0, 'compact-shell.less: нет раздела «Shell»');
    const src = shellSrc.slice(0, cut) + '\n@import (reference) "compact-windows.less";\n@import "compact-panel.less";\n';
    let css = null, err = null;
    lessCompiler().render(src, {filename: file, javascriptEnabled: true, syncImport: true}, (e, out) => { err = e; css = out && out.css; });
    if (err) throw err;
    assert.ok(css !== null, 'less собрал стили не синхронно');
    const list = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    while ((m = re.exec(css))) {
        const prelude = m[1].trim();
        if (prelude.startsWith('@')) continue;
        const decls = {};
        m[2].split(';').forEach(d => {
            const i = d.indexOf(':');
            if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
        });
        list.push({sels: prelude.split(/,(?![^(]*\))/).map(s => s.trim().replace(/\s+/g, ' ')), decls});
    }
    panelCssCache = list;
    return list;
}
const cssFor = re => panelCss().filter(r => r.sels.some(s => re.test(s)));
const cssDecl = (re, prop) => {
    for (const r of cssFor(re)) if (r.decls[prop] !== undefined) return r.decls[prop];
    return null;
};
const ruleFor = (list, re) => list.filter(r => re.test(r.selector));
const decl = (list, prop) => {
    for (const r of list) for (const d of r.decls) if (d.prop === prop) return d;
    return {value: null, important: false};
};
const hidden = d => d.value === 'none' && d.important;

/* Supply a custom selection: the fixture does not expose element, props or SELECTIONS.
   Paragraphs differ by get_Spacing().get_Line(); env.select accepts only predefined names. */
function element(type, value) {
    return {get_ObjectType: () => type, get_ObjectValue: () => value};
}
function shapeValue() {
    return {
        get_Locked: () => false, asc_getTextArtProperties: () => null, get_FromChart: () => false,
        get_FromImage: () => false, get_Type: () => null, asc_getType: () => null
    };
}
function paragraphValue(line) {
    return {get_Spacing: () => ({get_Line: () => line})};
}
function textSelection(env, props) {
    return [element(env.SELECT.Slide, {}), element(env.SELECT.Shape, shapeValue()), element(env.SELECT.Paragraph, props)];
}
function tableSelection(env, props) {
    return [element(env.SELECT.Slide, {}), element(env.SELECT.Table, {get_Locked: () => false}), element(env.SELECT.Paragraph, props)];
}
function imageSelection(env) {
    return [element(env.SELECT.Slide, {}), element(env.SELECT.Image, {get_Locked: () => false})];
}
function noneSelection(env) {
    return [element(env.SELECT.Slide, {})];
}
function focusSelection(env, selection) {
    env.selection = selection;
    env.fire('asc_onFocusObject', selection);
    env.drain();
}
function cardLabel(env) {
    const el = env.el('#view-right-menu');
    return el && el.hasAttribute('aria-label') ? el.getAttribute('aria-label') : null;
}
function rightOpen(env) {
    return env.document.body.classList.contains('vo-right-open');
}
function paraEntry(env) {
    return env.rightCtl._settings[env.PANE.Paragraph];
}
function paragraphChanges(env) {
    return env.stockCalls.filter(c => c.name === 'RightMenu.paragraphSettings.ChangeSettings');
}
function lastParagraphProps(env) {
    const calls = paragraphChanges(env);
    return calls.length ? calls[calls.length - 1].args[0] : null;
}
function logTail(env) {
    return env.logs.length ? ' | ' + env.logs[env.logs.length - 1] : '';
}
const paraLabel = () => h.ru()['PE.Views.RightMenu.txtParagraphSettings'];
const shapeLabel = () => h.ru()['PE.Views.RightMenu.txtShapeSettings'];
const tableLabel = () => h.ru()['PE.Views.RightMenu.txtTableSettings'];
const imageLabel = () => h.ru()['PE.Views.RightMenu.txtImageSettings'];
const themeLabel = () => h.ru()['PE.Views.SlideSections.textTheme'];
const slideLabel = () => h.ru()['PE.Views.SlideSections.textSlideSettings'];

function assertHeld(env, why) {
    const tail = why ? why + ': ' : '';
    assert.equal(env.lastPane(), 'Paragraph', tail + 'показана не вкладка абзаца');
    assert.equal(cardLabel(env), paraLabel(), tail + 'подпись не параметры абзаца');
    assert.notEqual(cardLabel(env), shapeLabel(), tail + 'подпись осталась параметрами фигуры');
    assert.equal(rightOpen(env), true, tail + 'нет vo-right-open');
    assert.equal(env.el('#vo-rp-head'), null, tail + 'у карточки есть шапка');
    assert.equal(env.apiCalls.some(c => c.name === 'put_PrLineSpacing'), false, tail + 'вызван put_PrLineSpacing');
}
function domCard(env) {
    const theme = env.el('#vo-rp-theme');
    return {
        openClass: rightOpen(env), opened: !!env.SS.opened, label: cardLabel(env), current: env.SS.current(),
        themeOn: !!(theme && theme.classList.contains('active')), themeText: theme ? theme.textContent : null
    };
}
function themeStays(env, why) {
    assert.equal(env.SS.current(), 'theme', why + ': карточка ушла с темы');
    assert.equal(cardLabel(env), themeLabel(), why + ': подпись темы сменилась');
    assert.equal(rightOpen(env), true, why + ': тема закрылась');
    const theme = env.el('#vo-rp-theme');
    assert.ok(theme && theme.classList.contains('active'), why + ': содержимое темы скрыто');
}
/* Refuse while the theme is open: capture its state after setup, then select a paragraph
   (without a hold, the theme remains open) and open the current object's section. */
function refusalKeepsTheme(prepare, restore) {
    const env = started();
    env.select('text');
    env.run('slideSection', 'theme');
    prepare(env);
    const before = domCard(env);
    assert.equal(env.SS.openParagraph(), false);
    assert.deepEqual(domCard(env), before, 'отказ изменил открытую тему');
    if (restore) restore(env);
    env.select('table');
    themeStays(env, 'после отказа');
    env.run('objectProperties');
    assert.equal(env.SS.current(), 'object', 'раздел объекта не открылся');
    assert.equal(env.lastPane(), 'Table', 'раздел объекта выбрал не вкладку таблицы');
    assert.equal(cardLabel(env), tableLabel(), 'раздел объекта подписан не таблицей');
}
function watchScroll(env) {
    const proto = Object.getPrototypeOf(env.document.body);
    const orig = proto.scrollIntoView;
    const box = {n: 0};
    proto.scrollIntoView = function () { box.n++; return orig.apply(this, arguments); };
    box.restore = () => { proto.scrollIntoView = orig; };
    return box;
}

h.run([
    {
        name: 'five_sections_object_only_with_object',
        run() {
            const env = started();
            const base = ['slide', 'theme', 'transition', 'animation'];
            env.select('none');
            assert.deepEqual(Array.from(env.SS.sections()), base, 'без объекта разделы не те');
            for (const kind of ['text', 'shape', 'image', 'table', 'chart', 'line']) {
                env.select(kind);
                assert.deepEqual(Array.from(env.SS.sections()), base.concat('object'), kind + ': разделы не те');
            }
            env.select('none');
            assert.deepEqual(Array.from(env.SS.sections()), base, 'снятое выделение оставило раздел объекта');

            /* The card name is the open section title; there is no section strip or header. */
            const title = () => env.el('#view-right-menu').getAttribute('aria-label');
            const want = {slide: 'Параметры слайда', theme: 'Тема', transition: 'Переход', animation: 'Анимация'};
            for (const [name, text] of Object.entries(want)) {
                env.run('slideSection', name);
                assert.equal(env.SS.current(), name);
                assert.equal(title(), text, 'имя карточки раздела ' + name + ' — не его название');
                assert.equal(env.el('#vo-rp-strip'), null, 'есть полоса разделов');
            }
            env.select('shape');
            env.run('objectProperties');
            assert.equal(title(), h.ru()['PE.Views.RightMenu.txtShapeSettings'], 'имя карточки раздела объекта — не штатная подсказка вкладки');
            assert.equal(env.el('#vo-rp-head'), null, 'у карточки есть шапка');

            /* Styles: the stock tab column is hidden, on an early start the column does not flash. */
            const list = rules();
            assert.ok(hidden(decl(ruleFor(list, /^body\.vo-compact #right-menu$/), 'display')), 'закрытая панель не скрыта');
            assert.ok(hidden(decl(ruleFor(list, /#right-menu \.tool-menu-btns$/), 'display')), 'штатная колонка вкладок видна');
            assert.ok(hidden(decl(ruleFor(list, /vo-boot #right-menu$/), 'display')), 'на раннем старте штатная колонка видна');
            assert.deepEqual(list.filter(r => /vo-rp-strip|vo-rp-tab\b/.test(r.selector)).map(r => r.selector), [], 'остались стили полосы разделов');
        }
    },
    {
        name: 'slide_section_stock_fields_layout_size',
        run() {
            const env = started();
            env.select('none');
            env.run('slideSection', 'slide');
            assert.equal(env.lastPane(), 'Slide', 'показана не штатная вкладка «Слайд»');
            assert.ok(env.count('RightMenu.slideSettings.ChangeSettings') >= 1, 'вкладка «Слайд» не получила свойства слайда');
            const more = env.el('#vo-rp-slide');
            assert.ok(more && !more.hidden, 'нет макета и размера слайда под вкладкой «Слайд»');
            assert.equal(more.previousElementSibling && more.previousElementSibling.id, 'id-slide-settings', 'макет и размер не под вкладкой «Слайд»');

            /* Layout is the stock gallery of the layouts button. */
            env.opened.length = 0;
            more.querySelector('[data-vo="Toolbar:btnChangeSlide"]').click();
            env.drain();
            assert.ok(env.opened.some(t => /btnChangeSlide/.test(t)), '«Изменить макет» не открыл штатную галерею макетов');

            /* Size is stock menu items, choosing is a stock item. */
            stockItems(env.tb.btnSlideSize.menu);
            env.SS.refresh();
            const size = env.el('#vo-rp-slide select[data-vo="Toolbar:btnSlideSize"]');
            const caps = size.querySelectorAll('option').map(o => o.textContent).filter(Boolean);
            assert.deepEqual(caps, env.tb.btnSlideSize.menu.items.filter(i => i.caption !== '--').map(i => i.caption), 'размер — не пункты штатного меню');
            env.stockCalls.length = 0;
            size.value = '1';
            fire(size, 'change');
            env.drain();
            assert.equal(env.count('Toolbar.onSlideSize'), 1, 'размер не выбран штатным пунктом');

            /* In other sections the layout and size are not visible. */
            env.run('slideSection', 'theme');
            assert.ok(env.el('#vo-rp-slide').hidden, 'макет и размер видны в разделе «Тема»');
        }
    },
    {
        name: 'chart_gets_trimmed_shape_tab',
        run() {
            const env = started();
            env.select('chart');
            env.panes.length = 0;
            env.stockCalls.length = 0;
            env.run('objectProperties');
            assert.equal(env.SS.current(), 'object');
            const shown = env.panes.map(p => Object.keys(env.PANE).find(k => env.PANE[k] === p.type));
            assert.ok(shown.indexOf('Shape') >= 0, 'у диаграммы не вкладка «Фигура»: ' + shown.join(','));
            assert.ok(shown.indexOf('Chart') < 0, 'у диаграммы открыта отключённая вкладка диаграммы');
            assert.equal(env.count('RightMenu.shapeSettings.ChangeSettings'), 1, 'вкладка «Фигура» не получила свойства рамки диаграммы');
            assert.equal(env.el('#view-right-menu').getAttribute('aria-label'), h.ru()['PE.Views.RightMenu.txtShapeSettings'], 'раздел объекта назван не штатной вкладкой');
        }
    },
    {
        name: 'theme_tiles_fire_store_click',
        run() {
            const env = started();
            env.run('slideSection', 'theme');
            const tiles = env.all('#vo-rp-theme .vo-rp-themes button');
            assert.equal(tiles.length, env.tb.listTheme.store.length, 'плиток не столько, сколько тем в штатной галерее');
            assert.deepEqual(tiles.map(t => t.title), ['Blank', 'Basic', 'Classic']);
            env.stockCalls.length = 0;
            tiles[2].click();
            env.drain();
            assert.equal(env.count('Toolbar.onListThemeSelect'), 1, 'плитка не прошла штатным щелчком галереи тем');
            const call = env.stockCalls.find(c => c.name === 'Toolbar.onListThemeSelect');
            assert.equal(call.args[1].get('themeId'), 2, 'штатный обработчик получил не ту тему');
            /* The engine keyboard switch (focus in the card) is not a theme change. */
            assert.deepEqual(env.apiCalls.filter(c => !c.stock && c.name !== 'asc_enableKeyEvents').map(c => c.name), [], 'тему меняет не штатный обработчик');

            /* The mark is set by stock code: the section rereads it on the store event. */
            env.tb.listTheme.store.models[1].set('selected', true);
            env.tb.listTheme.store.trigger('change:selected');
            env.drain();
            const on = env.all('#vo-rp-theme .vo-rp-themes button').map(t => t.getAttribute('aria-pressed'));
            assert.deepEqual(on, ['false', 'true', 'false'], 'отметка плитки не та, что в штатной галерее');
            assert.ok(env.pageText().indexOf(env.SS.textThemeHint) >= 0, 'нет пояснения раздела «Тема»');
        }
    },
    {
        /* Theme tiles are their own scroll window in the card: scrolling survives a rebuild
           of the section, for a just shown one the selected tile is in the middle of the window; there is no
           "Theme" caption over the tiles: the section is named by the "Theme" button, the card has no header. */
        name: 'theme_gallery_scrolls_inside_card',
        run() {
            const env = started();
            env.run('slideSection', 'theme');
            const list = () => env.el('#vo-rp-theme [data-vo-list="Toolbar:listTheme"]');
            assert.ok(list() && list().classList.contains('vo-rp-themes'), 'у галереи тем нет своего окошка');
            const labels = env.all('#vo-rp-theme .vo-rp-label').map(l => l.textContent);
            assert.ok(labels.indexOf(env.SS.textTheme) < 0 && labels.indexOf('Тема') < 0, 'над плитками повтор названия раздела: ' + labels.join(', '));
            list().scrollTop = 120;
            env.SS.refresh();
            assert.equal(list().scrollTop, 120, 'перестройка раздела сбросила прокрутку галереи');

            /* A just shown section scrolls to the selected tile. */
            const pane = env.document.createElement('div');
            const box = env.document.createElement('div');
            box.setAttribute('data-vo-list', 'x');
            const tile = env.document.createElement('button');
            tile.className = 'vo-rp-tile vo-on';
            box.appendChild(tile);
            pane.appendChild(box);
            Object.defineProperty(box, 'clientHeight', {value: 236});
            Object.defineProperty(tile, 'offsetTop', {value: 600});
            Object.defineProperty(tile, 'offsetHeight', {value: 59});
            env.SS.keepScroll(pane, {x: 10}, true);
            assert.equal(box.scrollTop, 512, 'выбранная плитка не по середине окошка');
            env.SS.keepScroll(pane, {x: 10}, false);
            assert.equal(box.scrollTop, 10, 'прокрутка не вернулась на место');

            const list2 = rules();
            const r = ruleFor(list2, /#view-right-menu \.vo-rp-pane \.vo-rp-themes$/);
            assert.equal(decl(r, 'max-height').value, '@vo-rp-list-h', 'у галереи тем нет потолка высоты');
            assert.equal(decl(r, 'overflow-y').value, 'auto', 'галерея тем не прокручивается');
            assert.ok(/^@vo-rp-list-h:\s*236px;/m.test(h.lessFile('compact-panel.less')), 'окошко галереи не 236');
        }
    },
    {
        name: 'color_schemes_mirror_stock',
        run() {
            const env = started();
            stockItems(env.tb.btnColorSchemas.menu);
            env.run('slideSection', 'theme');
            const sel = env.el('#vo-rp-theme select[data-vo="Toolbar:btnColorSchemas"]');
            assert.ok(sel, 'нет цветовой схемы');
            assert.deepEqual(sel.querySelectorAll('option').map(o => o.textContent).filter(Boolean), ['Office', 'Grayscale'],
                'цветовые схемы — не пункты штатного меню');
            env.stockCalls.length = 0;
            sel.value = '1';
            fire(sel, 'change');
            env.drain();
            assert.equal(env.count('Toolbar.onColorSchemaClick'), 1, 'схема не выбрана штатным пунктом меню');
            assert.ok(env.apiCalls.some(c => c.name === 'asc_ChangeColorSchemeByIdx' && c.stock), 'схему меняет не штатный обработчик');
            /* A marked stock item is the selected list row. */
            env.SS.refresh();
            const again = env.el('#vo-rp-theme select[data-vo="Toolbar:btnColorSchemas"]');
            assert.equal(again.querySelectorAll('option').find(o => o.selected).textContent, 'Grayscale', 'выбранная схема не отмечена');
        }
    },
    {
        name: 'animation_hint_without_object',
        run() {
            const env = started();
            env.select('none');
            env.run('slideSection', 'animation');
            const pane = env.el('#vo-rp-animation');
            assert.ok(pane && pane.classList.contains('active'), 'раздел «Анимация» не показан');
            assert.ok(pane.textContent.indexOf(env.SS.textAnimationHint) >= 0, 'без объекта нет подсказки');
            assert.equal(pane.querySelectorAll('.vo-rp-tile').length, 0, 'без объекта показаны эффекты');
            const paneBtn = pane.querySelector('[data-vo="Animation:btnAnimationPane"]');
            assert.ok(paneBtn, 'нет кнопки области анимации');
            env.stockCalls.length = 0;
            let toggled = 0;
            env.animation.btnAnimationPane.on('click', () => toggled++);
            paneBtn.click();
            env.drain();
            assert.equal(toggled, 1, 'область анимации — не штатная кнопка');
            env.select('shape');
            assert.ok(env.el('#vo-rp-animation').textContent.indexOf(env.SS.textAnimationHint) < 0, 'с объектом осталась подсказка');
            assert.ok(env.all('#vo-rp-animation .vo-rp-tile').length > 0, 'с объектом нет эффектов');
        }
    },
    {
        name: 'animation_effects_by_stock_groups',
        run() {
            const env = started();
            /* Stock effect gallery groups (view/Animation.js: DataViewGroupStore). */
            const groups = [['menu-effect-group-entrance', 'Вход'], ['menu-effect-group-emphasis', 'Выделение'],
                ['menu-effect-group-exit', 'Выход'], ['menu-effect-group-path', 'Пути перемещения']]
                .map(([id, caption]) => ({get: k => ({id, caption})[k]}));
            env.animation.listEffects.menuPicker.groups = {models: groups};
            env.select('shape');
            env.run('slideSection', 'animation');
            const pane = env.el('#vo-rp-animation');
            const heads = pane.querySelectorAll('.vo-rp-group').map(g => g.textContent);
            assert.deepEqual(heads, ['Вход', 'Выделение', 'Выход', 'Пути перемещения'], 'группы эффектов — не штатные');
            const grids = pane.querySelectorAll('.vo-rp-grid').map(g => g.querySelectorAll('.vo-rp-tile').length);
            assert.deepEqual(grids, [1, 1, 1, 1], 'эффекты не разложены по своим группам');
            const picked = [];
            env.animation.listEffects.on('click', (c, r) => picked.push(r.get('value')));
            pane.querySelectorAll('.vo-rp-tile')[2].click();
            env.drain();
            assert.deepEqual(picked, [3], 'эффект не прошёл штатным щелчком галереи');
        }
    },
    {
        name: 'effect_tiles_one_per_row',
        run() {
            /* Effect names are long: effect tiles go one per row,
               theme tiles stay two per row. */
            const list = rules();
            const cols = re => decl(ruleFor(list, re), 'grid-template-columns').value;
            assert.equal(cols(/\.vo-rp-effects \.vo-rp-grid$/), 'minmax(0, 1fr)', 'эффекты не по одному в ряд');
            assert.equal(cols(/(^|\s)\.vo-rp-grid$/), 'repeat(2, minmax(0, 1fr))', 'темы не по две в ряд');
            const env = started();
            env.select('shape');
            env.run('slideSection', 'animation');
            assert.ok(env.el('#vo-rp-animation .vo-rp-effects .vo-rp-grid'), 'эффекты анимации не под меткой vo-rp-effects');
        }
    },
    {
        /* Transition effects are their own scroll window in the card: the options, duration,
           delay and the buttons under them are visible without scrolling the whole card. */
        name: 'transition_effects_scroll_inside_card',
        run() {
            const env = started();
            env.run('slideSection', 'transition');
            const list = env.el('#vo-rp-transition [data-vo-list="Transitions:listEffects"]');
            assert.ok(list && list.classList.contains('vo-rp-effects'), 'у эффектов перехода нет своего окошка');
            assert.ok(list.parentNode.nextSibling, 'поля перехода не под эффектами');
            const r = ruleFor(rules(), /#view-right-menu #vo-rp-transition \.vo-rp-effects$/);
            assert.equal(decl(r, 'max-height').value, '@vo-rp-list-h', 'у эффектов перехода нет потолка высоты');
            assert.equal(decl(r, 'overflow-y').value, 'auto', 'эффекты перехода не прокручиваются');
        }
    },
    {
        /* Object animation effects are their own scroll window: the animation area button under them
           is visible without scrolling the whole card. */
        name: 'animation_effects_scroll_inside_card',
        run() {
            const env = started();
            env.select('shape');
            env.run('slideSection', 'animation');
            const list = env.el('#vo-rp-animation [data-vo-list="Animation:listEffects"]');
            assert.ok(list && list.classList.contains('vo-rp-effects'), 'у эффектов анимации нет своего окошка');
            assert.ok(env.el('#vo-rp-animation [data-vo="Animation:btnAnimationPane"]'), 'нет кнопки области анимации');
            const r = ruleFor(rules(), /#view-right-menu #vo-rp-animation \.vo-rp-effects$/);
            assert.equal(decl(r, 'max-height').value, '@vo-rp-list-h', 'у эффектов анимации нет потолка высоты');
            assert.equal(decl(r, 'overflow-y').value, 'auto', 'эффекты анимации не прокручиваются');
        }
    },
    {
        /* Stock tabs use the kit scale: the stock theme on #right-menu (its controls are drawn by
           theme variables) sets field 32, radius 8, font size 12, checkbox 16, border base-7 and focus
           accent; the list chevron and the counter arrows are an AIR icon mask. */
        name: 'stock_tabs_themed_on_panel_scale',
        run() {
            const THEME = /^body\.vo-compact\.theme-type-light #right-menu$/;
            const want = {
                '--form-control-size': '32px', '--input-height-base': '32px', '--font-size-base-app-custom': '12px',
                '--border-radius-form-control': '8px', '--border-radius-button-normal': '8px', '--chb-size': '16px',
                '--slider-thumb-size': '16px', '--border-fill-input': 'var(--vo-win-stroke)',
                '--border-fill-input-focused': 'var(--vo-accent)', '--chb-background-checked': 'var(--vo-accent)',
                'font-size': '12px'
            };
            for (const [prop, value] of Object.entries(want)) {
                assert.equal(cssDecl(THEME, prop), value, 'тема правой панели: ' + prop);
            }
            assert.ok(/^system-ui\b/.test(cssDecl(THEME, 'font-family') || ''), 'правая панель не шрифтом оболочки');
            assert.ok(/--vo-win-ico-chevron/.test(cssDecl(/#right-menu \.settings-panel \.combobox > \.btn \.caret$/, 'mask-image') || ''),
                'у списка вкладок не шеврон AIR');
            assert.ok(/--vo-win-ico-chevron/.test(cssDecl(/#right-menu \.settings-panel \.spinner > \.spinner-buttons button i$/, 'mask-image') || ''),
                'у счётчика вкладок не стрелки AIR');
            assert.equal(cssDecl(/#right-menu \.settings-panel label\.header$/, 'font-weight'), '600', 'заголовок группы не полужирный');
            /* Its own sections use the same scale. */
            assert.equal(cssDecl(/#right-menu \.vo-rp-pane \.vo-rp-select,?/, 'height'), '32px', 'список своих разделов не 32');
            assert.equal(cssDecl(/#right-menu \.vo-rp-pane \.vo-rp-btn$/, 'min-height'), '32px', 'кнопка своих разделов не 32');
            assert.equal(cssDecl(/#right-menu \.vo-rp-pane \.vo-rp-check \.vo-rp-box$/, 'width'), '16px', 'флажок своих разделов не 16');
        }
    },
    {
        /* The recoloring does not go beyond the compact right panel: every rule with a stock control is
           under body.vo-compact.theme-type-light #right-menu; it does not touch windows (.asc-window). */
        name: 'stock_tabs_restyle_only_in_compact_right_panel',
        run() {
            const STOCK = /\.(combobox|spinner|btn-color|btn-text-default|btn-text-menu-default|btn-text-split-default|btn-toolbar|checkbox-indeterminate|radiobox|dropdown-menu|form-control|combo-dataview|slider)\b|\blabel\b/;
            const SCOPE = /^body\.vo-compact\.theme-type-light(\.rtl)? #right-menu\b/;
            const leaks = [];
            panelCss().forEach(r => r.sels.forEach(s => {
                if (/\.asc-window|\.modals-mask/.test(s)) leaks.push('window: ' + s);
                else if (STOCK.test(s) && !SCOPE.test(s) && !/\.vo-rp-/.test(s)) leaks.push(s);
            }));
            assert.deepEqual(leaks, [], 'правила штатных контролов вне правой панели компакта: ' + leaks.slice(0, 5).join(' | '));
        }
    },
    {
        /* Detect missing openParagraph, a hold lost on selection changes, an object label,
           a repeat or active tab closing the card, or close/another section retaining the hold. */
        name: 'paragraph_card_holds_paragraph_tab_and_names_it',
        run() {
            const env = started();
            const scroll = watchScroll(env);
            try {
                env.select('text');
                assert.equal(env.SS.openParagraph(), true);
                assertHeld(env, 'надпись');

                env.typing = true;
                env.select('text');
                assert.equal(env.module('SlideSelection').kind(), 'typing', 'курсор в тексте не typing');
                assertHeld(env, 'курсор');

                env.typing = false;
                env.select('table');
                assert.equal(env.module('SlideSelection').kind(), 'table');
                assertHeld(env, 'таблица');
                assert.notEqual(cardLabel(env), tableLabel(), 'у таблицы подпись таблицы, не абзаца');

                env.run('slideSection', 'theme');
                assert.equal(env.SS.current(), 'theme');
                assert.equal(cardLabel(env), themeLabel(), 'тема подписана не темой');
                assert.ok(env.el('#vo-rp-theme').classList.contains('active'), 'содержимое темы не показано');
                assert.equal(env.SS.openParagraph(), true);
                assertHeld(env, 'из темы');

                env.run('slideSection', 'theme');
                assert.equal(env.SS.current(), 'theme', 'выбор темы не снял удержание');
                assert.equal(cardLabel(env), themeLabel(), 'после темы осталась подпись абзаца');
                assert.notEqual(cardLabel(env), paraLabel(), 'после темы подпись абзаца');
                assert.ok(env.el('#vo-rp-theme').classList.contains('active'), 'после темы показан не её раздел');

                env.select('shape');
                env.run('objectProperties');
                assert.equal(env.SS.current(), 'object');
                assert.equal(env.lastPane(), 'Shape', 'раздел объекта на фигуре показал не фигуру');
                assert.equal(cardLabel(env), shapeLabel(), 'раздел объекта на фигуре подписан не фигурой');

                const again = started();
                again.select('text');
                assert.equal(again.SS.openParagraph(), true);
                assert.equal(again.SS.openParagraph(), true, 'повтор закрыл карточку');
                assert.equal(again.SS.isOpen(), true, 'повтор закрыл карточку');
                assertHeld(again, 'повтор');

                /* The stock paragraph tab is already active while the shell card is closed. */
                const stock = started();
                stock.select('text');
                stock.rm.SetActivePane(stock.PANE.Paragraph, true);
                stock.drain();
                assert.equal(stock.rm.minimizedMode, false, 'штатная панель осталась свёрнутой');
                assert.equal(stock.rm.GetActivePane(), paraEntry(stock).panelId, 'активна не вкладка абзаца');
                assert.equal(rightOpen(stock), false, 'карточка была открыта до вызова');
                assert.equal(stock.SS.isOpen(), false);
                assert.equal(stock.SS.openParagraph(), true, 'уже активная вкладка не открыла карточку');
                assertHeld(stock, 'уже активная вкладка');

                const closed = started();
                closed.select('text');
                assert.equal(closed.SS.openParagraph(), true);
                closed.SS.close();
                assert.equal(closed.SS.isOpen(), false, 'close не закрыл карточку');
                assert.equal(rightOpen(closed), false);
                closed.select('shape');
                closed.run('objectProperties');
                assert.equal(closed.SS.current(), 'object');
                assert.equal(closed.lastPane(), 'Shape', 'после close раздел объекта не фигура');
                assert.equal(cardLabel(closed), shapeLabel(), 'после close подпись не фигуры');

                const shape = started();
                shape.select('shape');
                assert.equal(shape.SS.openParagraph(), false, 'без абзаца карточка открылась');
                assert.equal(rightOpen(shape), false, 'без абзаца появился vo-right-open');
                assert.equal(shape.SS.isOpen(), false);
                assert.equal(cardLabel(shape), null, 'без абзаца у карточки есть подпись');

                assert.equal(scroll.n, 0, 'вызван scrollIntoView');
            } finally {
                scroll.restore();
            }
        }
    },
    {
        /* Detect selection changes that do not pass current paragraph properties to ChangeSettings. */
        name: 'paragraph_card_updates_current_properties',
        run() {
            const env = started();
            const propsA = paragraphValue(1.0);
            const propsB = paragraphValue(2.0);
            const propsT = paragraphValue(2.0);
            focusSelection(env, textSelection(env, propsA));
            assert.equal(env.module('SlideSelection').kind(), 'text');
            assert.equal(env.SS.openParagraph(), true);
            assertHeld(env, 'исходный текст');
            assert.equal(lastParagraphProps(env), propsA, 'открытие не передало свойства абзаца с интервалом 1.0');
            assert.equal(propsA.get_Spacing().get_Line(), 1.0);

            /* Opening has already completed. A new paragraph on the same tab must not reset
               scrolling, even when stock _priorityArr contains Shape (onInsertShape). */
            env.rightCtl.onInsertShape();
            const baseFocus = env.rightCtl.onFocusObject;
            env.SS.unbind();
            const rawFocus = env.rightCtl.onFocusObject;
            env.rightCtl.onFocusObject = function (sel) {
                const prev = env.rm.GetActivePane();
                const r = rawFocus.apply(this, arguments);
                const prio = (this._priorityArr || []).find(t => this._settings[t] && !this._settings[t].hidden);
                if (prio !== undefined) {
                    const next = this._settings[prio].panelId;
                    env.rm.SetActivePane(prio, true);
                    if (next !== prev) env.rm.updateScroller();
                }
                return r;
            };
            env.SS.bind();
            const view = env.rm;
            const origScroller = view.updateScroller;
            let scrolls = 0;
            view.updateScroller = function () {
                scrolls++;
                return origScroller.apply(this, arguments);
            };
            try {
                focusSelection(env, textSelection(env, propsB));
                assert.equal(env.module('SlideSelection').kind(), 'text');
                assertHeld(env, 'новый текст');
                assert.equal(lastParagraphProps(env), propsB, 'поля получили не абзац с интервалом 2.0');
                assert.equal(propsB.get_Spacing().get_Line(), 2.0);
                assert.notEqual(propsB, propsA);
                assert.equal(scrolls, 0, 'обновление той же вкладки вызвало updateScroller');
                assert.deepEqual(Array.from(env.rightCtl._priorityArr), [env.PANE.Shape], 'после обновления _priorityArr изменился');
            } finally {
                view.updateScroller = origScroller;
                env.SS.unbind();
                env.rightCtl.onFocusObject = rawFocus;
                env.SS.bind();
                void baseFocus;
            }

            focusSelection(env, tableSelection(env, propsT));
            assert.equal(env.module('SlideSelection').kind(), 'table');
            assertHeld(env, 'таблица');
            assert.notEqual(cardLabel(env), tableLabel(), 'у таблицы подпись таблицы');
            assert.equal(lastParagraphProps(env), propsT, 'поля получили не абзац таблицы');
            assert.equal(propsT.get_Spacing().get_Line(), 2.0);
            assert.notEqual(propsT, propsB);
            assert.equal(env.apiCalls.some(c => c.name === 'put_PrLineSpacing'), false, 'вызван put_PrLineSpacing');
        }
    },
    {
        /* Detect a lost tab leaving the card open or passing stale props to ChangeSettings. */
        name: 'paragraph_card_closes_without_paragraph',
        run() {
            for (const kind of ['image', 'none']) {
                const env = started();
                const props = paragraphValue(1.0);
                focusSelection(env, textSelection(env, props));
                assert.equal(env.SS.openParagraph(), true);
                assertHeld(env, kind);
                const tab = paraEntry(env);
                const stale = tab.props;
                assert.equal(stale, props, kind + ': у вкладки не свойства открытого абзаца');
                /* Do not use env.select here: it clears props itself and immediately calls drain. */
                const selection = kind === 'image' ? imageSelection(env) : noneSelection(env);
                env.selection = selection;
                env.fire('asc_onFocusObject', selection);
                tab.props = stale;
                tab.hidden = 1;
                tab.btn.setDisabled(true);
                const before = paragraphChanges(env).length;
                env.drain();
                assert.deepEqual(paragraphChanges(env).slice(before).map(c => c.args[0]), [],
                    kind + ': старые свойства абзаца переданы в ChangeSettings' + logTail(env));
                assert.equal(env.SS.isOpen(), false, kind + ': карточка не закрылась' + logTail(env));
                assert.equal(rightOpen(env), false, kind + ': vo-right-open остался');
                assert.equal(cardLabel(env), null, kind + ': подпись осталась');

                env.run('objectProperties');
                assert.equal(rightOpen(env), true, kind + ': раздел объекта не открылся');
                if (kind === 'image') {
                    assert.equal(env.SS.current(), 'object');
                    assert.equal(env.lastPane(), 'Image', 'после изображения не вкладка изображения');
                    assert.equal(cardLabel(env), imageLabel(), 'после изображения подпись не изображения');
                } else {
                    assert.equal(env.SS.current(), 'slide', 'без объекта открыт не слайд');
                    assert.equal(env.lastPane(), 'Slide', 'без объекта не вкладка слайда');
                    assert.equal(cardLabel(env), slideLabel(), 'без объекта подпись не слайда');
                }
            }
        }
    },
    {
        /* Detect refusal changing the theme, retaining a hold, or ignoring visibility, button state, rights, locks or compact mode. */
        name: 'paragraph_card_unavailable_keeps_existing_section',
        run() {
            refusalKeepsTheme(env => {
                const tab = paraEntry(env);
                tab.hidden = 1;
                assert.equal(tab.btn.isDisabled(), false, 'кнопка абзаца погашена: это не проверка hidden');
            });
            refusalKeepsTheme(env => {
                const tab = paraEntry(env);
                tab.hidden = 0;
                tab.btn.setDisabled(true);
                assert.equal(tab.hidden === 1 || tab.hidden === true, false, 'вкладка скрыта: это не проверка кнопки');
            });
            /* Set the rights snapshot without the revocation event, which closes the card itself. The paragraph tab is available. */
            refusalKeepsTheme(env => {
                assert.equal(paraEntry(env).btn.isDisabled(), false);
                env.shell.rightSnapshot = false;
                assert.equal(env.SS.allowed(), false, 'без права правки панель ещё разрешена');
            }, env => { env.shell.rightSnapshot = true; });
            refusalKeepsTheme(env => {
                const modes = env.module('CompactModes');
                modes.reason = it => (it && it.section === 'object' ? 'Недоступно в режиме просмотра' : null);
                env.nc.trigger('vo:mode', {mode: 'view'});
                env.drain();
                assert.equal(env.SS.current(), 'theme', 'причина объекта закрыла тему');
                assert.equal(env.SS.sectionOff('object'), true, 'раздел объекта не запрещён');
            }, env => {
                env.module('CompactModes').reason = () => null;
                env.nc.trigger('vo:mode', {mode: 'edit'});
                env.drain();
                assert.equal(env.SS.sectionOff('object'), false, 'запрет раздела не снялся');
            });
            {
                const env = started();
                let lock = {on: false, options: {}};
                env.shell.lockState = () => lock;
                env.select('text');
                env.run('slideSection', 'theme');
                const tab = paraEntry(env);
                assert.equal(tab.hidden === 1 || tab.hidden === true, false, 'у текста нет вкладки абзаца');
                assert.equal(tab.btn.isDisabled(), false, 'кнопка абзаца погашена до запрета');
                lock = {on: true, options: {viewMode: true, toolbar: true, rightMenu: {clear: true, disable: true}}};
                env.nc.trigger('editing:disable', true, lock.options, 'disconnect');
                env.drain();
                assert.equal(env.SS.sectionOff('object'), true, 'штатный запрет не запер раздел');
                assert.equal(env.SS.isOpen(), false, 'штатный запрет не закрыл карточку');
                assert.equal(tab.btn.isDisabled(), false, 'штатный запрет погасил кнопку абзаца');
                const before = domCard(env);
                assert.equal(env.SS.openParagraph(), false, 'под штатным запретом карточка открылась');
                assert.deepEqual(domCard(env), before, 'отказ под штатным запретом изменил карточку');
            }
            refusalKeepsTheme(env => {
                env.shell.advanced = true;
                env.document.body.classList.remove('vo-compact');
                assert.equal(env.SS.active(), false, 'некомпактная оболочка ещё активна');
            }, env => {
                env.shell.advanced = false;
                env.document.body.classList.add('vo-compact');
                assert.equal(env.SS.active(), true, 'компакт не вернулся');
            });
        }
    }
]);
