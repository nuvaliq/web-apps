/* Run: node test/unit-tests/presentationeditor/acceptance/area-right-panel.cjs [--only <name>] [--app <directory>]
 * The "Slide" section of the menu bar and the presentation shell right panel (a popup panel over the
 * canvas): slide commands go via stock handlers, the panel sections ("Slide settings",
 * "Theme", "Transition", "Animation", "Object settings") open by their own items and carry
 * the fields of the stock tabs.
 *
 * The open section is read by SlideSections.current() (the section name or null when the panel is
 * closed), the available sections by SlideSections.sections() (section names in order).
 */
'use strict';

const assert = require('node:assert/strict');
const h = require('./area-harness.cjs');

const SLIDE_COMMANDS = /slide|asc_hideslides|asc_moveselectedslides|changelayout|changetheme|colorscheme/i;
const PANE_BY_VIEW = {slideSettings: 'Slide', shapeSettings: 'Shape', imageSettings: 'Image', tableSettings: 'Table',
    paragraphSettings: 'Paragraph', textartSettings: 'TextArt'};

function refOf(it) {
    if (!it) return null;
    if (typeof it.twin === 'string') return it.twin;
    if (typeof it.gallery === 'string') return it.gallery;
    if (typeof it.sub === 'string') return it.sub;
    return null;
}

/* Close the right panel with the same item (choosing again closes). */
function closePanel(env, it) {
    for (let i = 0; i < 3 && env.current() !== null; i++) env.runItem(it);
    assert.equal(env.current(), null, 'правая панель не закрывается повторным «' + (it.t || '') + '»');
}

/* Which stock right panel tabs are shown after the action. */
function shownPanes(env) {
    const out = new Set(env.panes.map(p => Object.keys(env.PANE).find(k => env.PANE[k] === p.type)));
    env.stockCalls.forEach(c => {
        const m = /^RightMenu\.(\w+)\.ChangeSettings$/.exec(c.name);
        if (m && PANE_BY_VIEW[m[1]]) out.add(PANE_BY_VIEW[m[1]]);
    });
    return Array.from(out).filter(Boolean);
}

h.run([
    {
        name: 'slide_items_run_stock_commands_and_open_their_sections',
        run() {
            const env = h.createEnv();
            env.start();
            const Bridge = env.module('StockBridge');

            const stock = [
                [['Новый слайд'], ['Toolbar.onAddSlide', 'DocumentHolder.onNewSlide']],
                [['Дублировать слайд'], ['DocumentHolder.onDuplicateSlide', 'Toolbar.onDuplicateSlide']],
                [['Удалить слайд'], ['DocumentHolder.onDeleteSlide']],
                [['Скрыть слайд'], ['DocumentHolder.onSlideHide']],
                [['Сбросить макет слайда', 'Сбросить макет'], ['DocumentHolder.onResetSlide']],
                [['Переместить слайд в начало', 'В начало'], ['DocumentHolder.onMoveSlideToStart']],
                [['Переместить слайд в конец', 'В конец'], ['DocumentHolder.onMoveSlideToEnd']]
            ];
            for (const [captions, handlers] of stock) {
                const it = env.findItem('Слайд', captions);
                env.stockCalls.length = 0;
                env.apiCalls.length = 0;
                env.runItem(it);
                const hits = env.stockCalls.filter(c => handlers.indexOf(c.name) >= 0).length;
                assert.equal(hits, 1, '«Слайд → ' + captions[0] + '»: штатный обработчик вызван ' + hits + ' раз');
                assert.deepEqual(env.ownApi(SLIDE_COMMANDS).map(c => c.name), [],
                    '«Слайд → ' + captions[0] + '»: оболочка сама правит презентацию через api');
            }

            /* "Change layout ▸" is the stock layout gallery. */
            const layout = env.findItem('Слайд', 'Изменить макет');
            const layoutTwin = Bridge.twin(refOf(layout));
            assert.ok(layoutTwin === env.tb.btnChangeSlide || layoutTwin === env.dh.mnuChangeSlide,
                '«Слайд → Изменить макет» не привязан к штатной галерее макетов');
            env.opened.length = 0;
            env.runItem(layout);
            assert.ok(env.opened.some(t => /btnChangeSlide|mnuChangeSlide/.test(t)), '«Слайд → Изменить макет» не открыл штатную галерею макетов');

            /* "Color scheme ▸" and "Slide size ▸" are stock menus and their items. */
            const subs = [
                ['Цветовая схема', env.tb.btnColorSchemas, /grayscale/i, 'Toolbar.onColorSchemaClick'],
                ['Размер слайда', env.tb.btnSlideSize, /16:9/, 'Toolbar.onSlideSize']
            ];
            for (const [caption, twin, row, handler] of subs) {
                const it = env.findItem('Слайд', caption);
                const ref = refOf(it);
                assert.equal(Bridge.twin(ref), twin, '«Слайд → ' + caption + '» не привязан к штатному меню');
                const rows = Bridge.mirror(ref) || [];
                const pick = rows.find(r => row.test(h.norm(r.caption)) || row.test(String(r.caption)));
                assert.ok(pick, '«Слайд → ' + caption + ' ▸»: в подменю нет штатных пунктов');
                env.stockCalls.length = 0;
                Bridge.pick(ref, pick.id);
                env.drain();
                assert.equal(env.count(handler), 1, '«Слайд → ' + caption + ' ▸»: пункт не прошёл через штатный обработчик');
            }

            /* "Background", "Change theme", "Transition" are own right panel sections; there is no "Slide settings" in the menu:
               the same section is opened by "Background". */
            env.select('none');
            assert.equal(env.findItem('Слайд', 'Параметры слайда', {optional: true}), null, '«Слайд → Параметры слайда» дублирует «Фон»');
            const sections = [['Фон', 'slide'], ['Изменить тему', 'theme'], ['Переход', 'transition']];
            for (const [caption, section] of sections) {
                env.runItem(env.findItem('Слайд', caption));
                assert.equal(env.current(), section, '«Слайд → ' + caption + '» не открыл раздел ' + section);
            }

            /* "Slide settings" of the thumbnail menu is the same section, not a stock tab. */
            env.runItem(env.findItem('Слайд', 'Изменить тему'));
            env.stockCalls.length = 0;
            env.dh.menuSlideSettings.options.value = env.selection[0];
            env.dh.menuSlideSettings.click();
            env.drain();
            assert.equal(env.count('DocumentHolder.onSlideSettings'), 1, '«Параметры слайда» меню миниатюры не дошёл до штатного обработчика');
            assert.equal(env.current(), 'slide', '«Параметры слайда» меню миниатюры не открыл раздел «Параметры слайда»');
        }
    },
    {
        name: 'right_panel_has_five_sections_and_object_section_only_with_object',
        run() {
            const panel = h.lessRules(h.lessFile('compact-panel.less'), 'compact-panel.less');
            assert.ok(panel.some(r => /\.vo-compact\b/.test(r.selector) && r.decls.length), 'нет стилей правой панели под body.vo-compact');

            const env = h.createEnv();
            env.start();
            const base = ['slide', 'theme', 'transition', 'animation'];
            env.select('none');
            assert.deepEqual(env.sections(), base, 'без выделенного объекта разделы не те');
            for (const kind of ['shape', 'image', 'table', 'chart', 'text']) {
                env.select(kind);
                assert.deepEqual(env.sections(), base.concat('object'), 'выделение ' + kind + ': разделы не те');
            }
            env.select('none');
            assert.deepEqual(env.sections(), base, 'снятое выделение оставило раздел «Параметры объекта»');
            /* Sections are in the popup panel: there is no icon strip. */
            env.runItem(env.findItem('Слайд', 'Фон'));
            assert.equal(env.current(), 'slide');
            assert.equal(env.document.getElementById('vo-rp-strip'), null, 'у панели есть полоса значков');
        }
    },
    {
        name: 'slide_theme_transition_sections_carry_stock_tab_fields',
        run() {
            const src = h.shellSource('SlideSections');
            const fields = {
                'Параметры слайда': ['btnChangeSlide', 'btnSlideSize'],
                'Тема': ['listTheme', 'btnColorSchemas'],
                'Переход': ['listEffects', 'btnParameters', 'numDuration', 'chStartOnClick', 'numDelay', 'btnApplyToAll', 'btnPreview']
            };
            for (const [section, names] of Object.entries(fields))
                for (const name of names)
                    assert.ok(new RegExp('\\b' + name + '\\b').test(src), 'раздел «' + section + '» не берёт штатный ' + name);
            assert.ok(/\bTransitions\b/.test(src), 'раздел «Переход» не берёт поля штатной вкладки «Переходы»');

            const env = h.createEnv();
            env.start();
            env.select('none');

            env.runItem(env.findItem('Слайд', 'Фон'));
            assert.equal(env.current(), 'slide', '«Фон» не открыл «Параметры слайда»');
            assert.ok(shownPanes(env).indexOf('Slide') >= 0, '«Параметры слайда» не показывает штатную вкладку «Слайд» (SlideSettings)');

            const reads = env.tb.listTheme.store.reads;
            env.runItem(env.findItem('Слайд', 'Изменить тему'));
            assert.equal(env.current(), 'theme', '«Изменить тему» не открыл раздел «Тема»');
            assert.ok(env.tb.listTheme.store.reads > 0 || reads > 0, 'раздел «Тема» не читает галерею встроенных тем (listTheme)');

            env.runItem(env.findItem('Слайд', 'Переход'));
            assert.equal(env.current(), 'transition', '«Переход» не открыл раздел «Переход»');

        }
    },
    {
        name: 'animation_section_shows_object_effects_or_hint_without_object',
        run() {
            const hint = 'Выделите объект на слайде, чтобы добавить анимацию.';
            const keys = Object.entries(h.ru()).filter(([k, v]) => v === hint && /^PE\.Views\.(SlideSections|CompactShell|SlideActions)\./.test(k));
            assert.ok(keys.length, 'подсказки «' + hint + '» нет в ru.json среди строк оболочки');
            const src = h.shellSource('SlideSections');
            assert.ok(/\bAnimation\b/.test(src) && /\blistEffects\b/.test(src), 'раздел «Анимация» не берёт штатную галерею эффектов');

            const env = h.createEnv();
            env.start();
            env.select('none');
            assert.equal(env.findItem('Вид', 'Панель анимации', {optional: true}), null, '«Вид → Панель анимации» дублирует «Вставка → Анимация»');
            env.runItem(env.findItem('Вставка', 'Анимация'));
            assert.equal(env.current(), 'animation', '«Вставка → Анимация» не открыл раздел «Анимация»');
            assert.ok(env.pageText().indexOf(hint) >= 0, 'без объекта в разделе «Анимация» нет подсказки «' + hint + '»');

            env.runItem(env.findItem('Слайд', 'Изменить тему'));
            env.runItem(env.findItem('Вставка', 'Анимация'));
            assert.equal(env.current(), 'animation', '«Вставка → Анимация» не открыл раздел «Анимация»');

            const reads = env.animation.listEffects.store.reads;
            env.select('shape');
            assert.equal(env.current(), 'animation', 'выделение объекта закрыло раздел «Анимация»');
            assert.ok(env.animation.listEffects.store.reads > reads || reads > 0,
                'с объектом раздел «Анимация» не показывает эффекты штатной галереи');
        }
    },
    {
        name: 'object_section_shows_stock_tab_of_selected_kind_chart_gets_shape_tab',
        run() {
            const env = h.createEnv();
            env.start();
            const item = env.findItem('Формат', 'Свойства объекта');
            const cases = [['shape', ['Shape']], ['image', ['Image']], ['table', ['Table']], ['chart', ['Shape']],
                ['text', ['Paragraph', 'Shape']]];
            for (const [kind, expected] of cases) {
                env.select(kind);
                closePanel(env, item);
                env.stockCalls.length = 0;
                env.panes.length = 0;
                env.runItem(item);
                assert.equal(env.current(), 'object', 'выделение ' + kind + ': «Свойства объекта» не открыл «Параметры объекта»');
                const shown = shownPanes(env);
                assert.ok(shown.some(p => expected.indexOf(p) >= 0),
                    'выделение ' + kind + ': показана не штатная вкладка ' + expected.join(' или ') + ' (' + (shown.join(', ') || 'ничего') + ')');
                if (kind === 'chart') assert.ok(shown.indexOf('Chart') < 0, 'диаграмма открыла отключённую вкладку диаграммы вместо «Фигуры»');
            }
        }
    },
    {
        name: 'format_object_properties_opens_object_or_slide_checked_and_second_choice_closes',
        run() {
            const env = h.createEnv();
            env.start();
            assert.equal(env.findItem('Вид', 'Свойства объекта', {optional: true}), null, '«Вид → Свойства объекта» дублирует «Формат → Свойства объекта»');
            const item = env.findItem('Формат', 'Свойства объекта');
            env.select('none');
            closePanel(env, item);
            assert.equal(!!env.itemState(item).checked, false, '«Формат → Свойства объекта» отмечен при закрытой панели');
            env.runItem(item);
            assert.equal(env.current(), 'slide', 'без объекта «Формат → Свойства объекта» открыл не «Параметры слайда»');
            assert.equal(env.itemState(item).checked, true, '«Формат → Свойства объекта» без галочки при открытой панели');
            env.runItem(item);
            assert.equal(env.current(), null, 'повторный «Формат → Свойства объекта» не закрыл панель');
            assert.equal(!!env.itemState(item).checked, false, 'галочка осталась после закрытия панели');
            for (const kind of ['shape', 'image', 'table']) {
                env.select(kind);
                env.runItem(item);
                assert.equal(env.current(), 'object', 'с объектом ' + kind + ' «Формат → Свойства объекта» открыл не «Параметры объекта»');
                env.runItem(item);
                assert.equal(env.current(), null, 'повторный «Формат → Свойства объекта» (' + kind + ') не закрыл панель');
            }
        }
    }
]);
