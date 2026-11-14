/* Run: node test/unit-tests/presentationeditor/slide-sections-design.cjs [path to SlideSections.js]
 * The presentation shell right panel (a popup panel over the canvas): composition: five
 * sections, "Object settings" only with an object, the card name is the section title;
 * "Slide settings" is the stock "Slide" tab with the layout and slide size, "Theme" is the tiles of the
 * stock theme gallery and the color scheme from the stock menu, "Animation" is the effects of the stock
 * gallery by its groups and a hint without an object, for a chart it is the stock "Shape" tab;
 * styles are under body.vo-compact.
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
    }
]);
