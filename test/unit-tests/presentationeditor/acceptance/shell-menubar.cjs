/* Run: node test/unit-tests/presentationeditor/acceptance/shell-menubar.cjs --base v9.4.0.129 [--only <name>]
 * Menu bar of the presentation shell: nine sections and their items bound to the
 * stock commands, no audio or video, and the stock interface shell command.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const H = require('./shell-harness.cjs');

const NINE = ['Файл', 'Правка', 'Вид', 'Вставка', 'Формат', 'Слайд', 'Упорядочить', 'Совместная работа', 'Справка'];

/* An item matches when its caption equals the expected one, or when its binding
   (stock control, shell command or engine call) matches every pattern. */
const I = (name, ...refs) => ({name, refs});
const SEP = {sep: true};

const SECTIONS = {
    'Файл': [
        I('Сохранить', /\bmiSave\b/), I('Скачать', /miDownload/), I('Печать', /\bmiPrint\b/), SEP,
        I('Переименовать', /miRename/), I('Сведения о документе', /miInfo/), I('Расширенные настройки', /miSettings/)
    ],
    'Правка': [
        I('Отменить', /btnUndo/), I('Повторить', /btnRedo/), SEP,
        I('Вырезать', /btnCut/), I('Копировать', /btnCopy/), I('Вставить', /btnPaste/), SEP,
        I('Выделить всё', /btnSelectAll/), I('Найти и заменить', /btnReplace|search/i), I('Удалить', /delete|remove/i), SEP,
        I('Орфография', /btnSpelling|btnsSpelling|spell/i), I('Язык документа', /btnDocLang|btnsDocLang/)
    ],
    'Вид': [
        I('Начать показ слайдов', /btnPreview/), SEP,
        I('Обычный', /btnNormal/), I('Образец слайдов', /btnSlideMaster/), SEP,
        I('Масштаб', /cmbZoom|zoom/i), I('Линейки', /chRulers/), I('Направляющие', /btnGuides/), I('Линии сетки', /btnGridlines/),
        I('Заметки', /chNotes/), I('Слайды', /btnThumbs|Thumbnails|Tumbnails/), SEP,
        I('Скрыть панель инструментов', /hide.*toolbar|toolbar.*hid/i), I('Режим фокуса', /focus/i), SEP,
        I('Макросы')
    ],
    'Вставка': [
        I('Изображение', /btnsInsertImage/), I('Надпись', /btnsInsertText/), I('Фигура', /cmbsInsertShape/),
        I('Таблица', /btnInsertTable/), I('Диаграмма', /btnInsertChart/), I('SmartArt', /btnInsertSmartArt/),
        I('Text Art', /btnInsertTextArt/), I('Уравнение', /btnInsertEquation/), I('Символ', /btnInsertSymbol/), SEP,
        I('Анимация', /animation/i), I('Ссылка', /btnInsertHyperlink/), I('Комментарий', /btnsComment|addComment/), SEP,
        I('Новый слайд', /btnAddSlide|NewSlide/), I('Номер слайда', /btnInsSlideNum/), I('Дата и время', /btnInsDateTime/),
        I('Колонтитулы', /btnEditHeader/)
    ],
    'Формат': [
        I('Текст'), I('Регистр', /btnChangeCase/), I('Выравнивание', /btnHorizontalAlign|btnVerticalAlign/),
        I('Междустрочный интервал', /btnLineSpace/), I('Маркеры и нумерация', /btnMarkers|btnNumbers/),
        I('Колонки', /btnColumns/), I('Направление текста', /directionText|btnTextDir/), SEP,
        I('Таблица', /tableMenu/), I('Изображение', /textCrop|originalSize/), SEP,
        I('Очистить форматирование', /btnClearStyle/), I('Свойства объекта', /objectProperties/i)
    ],
    'Слайд': [
        I('Новый слайд', /btnAddSlide|txtNewSlide/), I('Дублировать слайд', /Duplicate/i), I('Удалить слайд', /DeleteSlide/i),
        I('Скрыть слайд', /SlideHide|HideSlide/i), I('Переместить слайд', /MoveSlides/i), SEP,
        I('Фон'), I('Изменить макет', /btnChangeSlide|ChangeLayout/), I('Сбросить макет слайда', /ResetLayout/i),
        I('Изменить тему'), I('Цветовая схема', /btnColorSchemas/), I('Размер слайда', /btnSlideSize/), SEP,
        I('Переход')
    ],
    'Упорядочить': [
        I('Порядок', /btnShapeArrange|txtArrange/), I('Выравнивание фигур', /btnShapeAlign/), I('Поворот', /textRotate|rotate/i), SEP,
        I('Сгруппировать', /mnuGroupShapes|txtGroup\b/), I('Разгруппировать', /mnuUnGroupShapes|txtUngroup/), I('Объединить фигуры', /btnShapesMerge/)
    ],
    'Совместная работа': [
        I('Доступ к документу', /sharing/i), I('Режим совместного редактирования', /btnCoAuthMode/), I('История версий', /history/i), SEP,
        I('Комментарии', /btnComments/), I('Решить комментарии', /btnCommentResolve/), I('Удалить комментарии', /btnCommentRemove/)
    ],
    'Справка': [I('Справка', /miHelp/), I('О программе', /btnAbout/)]
};

/* Submenus of the rows collected into one menu bar row. */
const SUBS = {
    'Файл → Скачать': [I('PPTX', /miDownload/, /format=PPTX/), I('PDF', /miDownload/, /format=PDF/), I('ODP', /miDownload/, /format=ODP/),
        I('PNG', /miDownload/, /format=PNG/)],
    'Правка → Орфография': [I('Проверка орфографии', /btnsSpelling/), I('Пропустить всё', /IgnoreAll/)],
    'Вид → Макросы': [I('Макросы', /btnMacros/), I('Записать макрос', /btnRecMacro/), I('Приостановить запись', /btnPauseMacro/)]
};

function binding(it) {
    const parts = [];
    for (const k of ['twin', 'cmd', 'engine', 'id', 'value', 'args', 'format', 'action', 'ref']) {
        const v = it[k];
        if (v === undefined || v === null || typeof v === 'function') continue;
        parts.push(k + '=' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    }
    return parts.join(' ');
}

const caption = it => H.norm(it.t !== undefined ? it.t : it.caption !== undefined ? it.caption : it.label);

function matches(it, spec) {
    if (spec.sep) return !!(it && it.sep);
    if (!it || it.sep) return false;
    if (H.normCaption(caption(it)) === H.normCaption(spec.name)) return true;
    const b = binding(it);
    return spec.refs.length > 0 && spec.refs.every(re => re.test(b));
}

const show = list => list.map(it => (it && it.sep ? '—' : caption(it) + (binding(it) ? ' {' + binding(it) + '}' : ''))).join(' · ');

async function bootWithCatalog(opts) {
    const w = await H.makeWorld(opts);
    w.bootOrExplain();
    w.requireCss();
    const actions = w.load('SlideActions');
    assert.equal(typeof (actions && actions.groups), 'function', 'PE.Views.SlideActions.groups() is missing');
    return {w, groups: actions.groups()};
}

async function menuBarNineSectionsWithStockItemsInOrder() {
    const {w, groups} = await bootWithCatalog();
    assert.deepEqual(Array.from(groups, g => H.norm(g.label)), NINE, 'catalog sections');
    const rendered = H.sectionLabels(w).map(c => H.norm(c.textContent));
    assert.deepEqual(rendered, NINE, 'menu bar sections');
    const problems = [];
    for (const g of groups) {
        const items = (g.items || []).filter(Boolean);
        const spec = SECTIONS[H.norm(g.label)];
        const ok = items.length === spec.length && spec.every((s, i) => matches(items[i], s));
        if (!ok) {
            const firstBad = spec.findIndex((s, i) => !matches(items[i], s));
            problems.push(H.norm(g.label) + ': expected ' + spec.length + ' entries, got ' + items.length +
                (firstBad >= 0 ? '; entry ' + (firstBad + 1) + ' should be ' + (spec[firstBad].sep ? '—' : '"' + spec[firstBad].name + '"') : '') +
                ' [' + show(items) + ']');
        }
        for (const [where, spec] of Object.entries(SUBS)) {
            const [section, name] = where.split(' → ');
            if (H.norm(g.label) !== section) continue;
            const parent = items.find(it => !it.sep && H.normCaption(caption(it)) === H.normCaption(name));
            const sub = parent && Array.isArray(parent.sub) ? parent.sub.filter(Boolean) : [];
            const good = sub.length === spec.length && spec.every((x, i) => matches(sub[i], x) && H.normCaption(caption(sub[i])) === H.normCaption(x.name));
            if (!good) problems.push(where + ': [' + show(sub) + ']');
        }
        const fmt = H.norm(g.label) === 'Формат' && items.find(it => H.normCaption(caption(it)) === 'текст');
        if (fmt && Array.isArray(fmt.sub)) {
            const sub = fmt.sub.filter(Boolean);
            const want = [/btnBold/, /btnItalic/, /btnUnderline/, /btnStrikeout/, null, /btnSuperscript/, /btnSubscript/];
            const good = sub.length === want.length && want.every((re, i) => (re ? !sub[i].sep && re.test(binding(sub[i])) : !!sub[i].sep));
            if (!good) problems.push('Формат → Текст: [' + show(sub) + ']');
        }
    }
    assert.deepEqual(problems, [], 'sections differ from the list of the stock commands');

    const file = H.openSection(w, 'Файл');
    assert.deepEqual(file.items.map(({el}) => el.getAttribute('data-k')),
        ['save', 'download', 'print', 'rename', 'info', 'settings'], 'rendered File menu commands');
}

const AV = /аудио|видео|\baudio\b|\bvideo\b/i;
const AV_CODE = /\b(?:btnInsAudio|btnInsVideo)\b|asc_?[Aa]dd(?:Audio|Video)|\bAdd(?:Audio|Video)\b|insert(?:Audio|Video)/;

function walkItems(list, fn) {
    for (const it of (list || []).filter(Boolean)) {
        fn(it);
        if (Array.isArray(it.sub)) walkItems(it.sub, fn);
        if (Array.isArray(it.items)) walkItems(it.items, fn);
    }
}

async function noAudioOrVideoInsertOnToolbarOrInMenus() {
    const files = H.shellViewNames().filter(n => fs.existsSync(path.join(H.PE_VIEW, n + '.js')));
    assert.ok(files.includes('CompactShell') && files.includes('SlideActions') && files.includes('CompactToolbar'),
        'shell modules are missing (found: ' + (files.join(', ') || 'none') + ')');
    const inCode = files.filter(n => AV_CODE.test(H.scanJs(fs.readFileSync(path.join(H.PE_VIEW, n + '.js'), 'utf8')).code));
    assert.deepEqual(inCode, [], 'shell modules wire audio or video');

    const {w, groups} = await bootWithCatalog();
    const found = [];
    groups.forEach(g => walkItems(g.items, it => { if (AV.test(caption(it)) || /Audio|Video/.test(binding(it))) found.push(H.norm(g.label) + ': ' + caption(it)); }));
    assert.deepEqual(found, [], 'catalog has audio or video');
    const menus = H.menuTexts(w, NINE);
    const inMenus = [].concat(...Object.entries(menus).map(([k, v]) => v.filter(t => AV.test(t)).map(t => k + ': ' + t)));
    assert.deepEqual(inMenus, [], 'menu bar shows audio or video');
    const tb = w.must('vo-toolbar');
    const onToolbar = [tb].concat(tb.querySelectorAll('*')).filter(e => [e.getAttribute('title'), e.getAttribute('aria-label'),
        e.children.length ? '' : e.textContent].some(t => t && AV.test(t)));
    assert.deepEqual(onToolbar.map(H.describe), [], 'toolbar shows audio or video');
    for (const c of H.controlsIn(w, tb)) {
        if (!c.isConnected || w.hidden(c)) continue;
        w.click(c);
        w.doc.dispatchEvent(new H.DomEvent('keydown', {bubbles: true, key: 'Escape', keyCode: 27, which: 27}));
        w.drain(200);
    }
    assert.deepEqual(w.used(/btnInsAudio|btnInsVideo/).map(c => c.who), [], 'toolbar reaches the stock audio or video buttons');
}

function stockShown(w) {
    return {
        ribbon: !w.hidden(w.doc.querySelector('#toolbar > section.toolbar')),
        leftColumn: !w.hidden(w.doc.querySelector('#left-menu .tool-menu-btns')),
        statusBar: !w.hidden(w.doc.querySelector('#statusbar > .statusbar'))
    };
}

async function stockInterfaceCommandSwitchesToStockAndBack() {
    const w = await H.makeWorld();
    const shell = w.bootOrExplain();
    w.requireCss();
    const vl = w.stock.viewportView.vlayout;
    const shellHeights = {toolbar: vl.getItem('toolbar').height, statusbar: vl.getItem('statusbar').height};
    assert.notDeepEqual(shellHeights, {toolbar: w.stockHeights.toolbar, statusbar: w.stockHeights.statusbar}, 'the shell keeps the stock row heights');
    assert.deepEqual(stockShown(w), {ribbon: false, leftColumn: false, statusBar: false}, 'stock chrome is shown in the shell');

    assert.equal(shell.hasCommand('stockInterface'), true);
    shell.command('stockInterface')();
    w.drain(1000);
    const body = w.doc.body.classList;
    assert.ok(body.contains('vo-advanced') && !body.contains('vo-compact'), 'stock interface is not switched on (body: ' + w.doc.body.className + ')');
    assert.deepEqual(stockShown(w), {ribbon: true, leftColumn: true, statusBar: true}, 'stock chrome is not back');
    assert.ok(w.hidden(w.must('vo-shell')), 'shell rows are still shown in the stock interface');
    const status = w.byId('vo-status');
    assert.ok(!status || w.hidden(status), 'shell status bar is still shown in the stock interface');
    assert.equal(vl.getItem('toolbar').height, w.stockHeights.toolbar, 'stock toolbar height is not restored');
    assert.equal(vl.getItem('statusbar').height, w.stockHeights.statusbar, 'stock status bar height is not restored');

    assert.equal(typeof shell.toggleMode, 'function', 'PE.Views.CompactShell.toggleMode() is missing');
    shell.toggleMode();
    w.drain(1000);
    assert.ok(body.contains('vo-compact') && !body.contains('vo-advanced'), 'the shell does not come back (body: ' + w.doc.body.className + ')');
    for (const id of ['vo-header', 'vo-menubar', 'vo-toolbar']) assert.ok(!w.hidden(w.must(id)), '#' + id + ' is hidden after coming back');
    assert.deepEqual(stockShown(w), {ribbon: false, leftColumn: false, statusBar: false}, 'stock chrome stays after coming back');
    assert.deepEqual({toolbar: vl.getItem('toolbar').height, statusbar: vl.getItem('statusbar').height}, shellHeights, 'shell row heights are not restored');
}

H.run([
    {name: 'menu_bar_nine_sections_with_stock_items_in_order', fn: menuBarNineSectionsWithStockItemsInOrder},
    {name: 'no_audio_or_video_insert_on_toolbar_or_in_menus', fn: noAudioOrVideoInsertOnToolbarOrInMenus},
    {name: 'stock_interface_command_switches_to_stock_and_back', fn: stockInterfaceCommandSwitchesToStockAndBack}
]);
