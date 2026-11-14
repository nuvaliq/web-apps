/* Run: node test/unit-tests/presentationeditor/acceptance/shell-texts.cjs [--only <name>]
 * Captions of the presentation shell come from the locale: stock captions from
 * the stock presentation locale, the shell's own captions through its own keys,
 * no caption literals in the code.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const H = require('./shell-harness.cjs');

/* captions the shell takes from elsewhere than the stock locale */
const OWN = [
    'Новый слайд', 'Показ слайдов', 'Сведения о документе', 'Расширенные настройки', 'Скачать',
    'Скачать PPTX', 'Скачать PDF', 'Скачать ODP', 'Найти и заменить', 'Пропустить всё',
    'Формат по образцу', 'Цвет текста', 'Подчёркнутый', 'Надстрочный', 'Подстрочный', 'Очистить форматирование',
    'Скрыть панель инструментов', 'Режим фокуса', 'Свойства объекта',
    'Выравнивание и интервал', 'Списки и отступы', 'Стили текста', 'Скачать файл', 'Редактирование', 'Просмотр',
    'Правки применяются сразу', 'Презентация доступна для чтения', 'Фон', 'Макет', 'Тема', 'Переход', 'Слайд',
    'Упорядочить', 'Правка', 'Параметры объекта', 'Регистр', 'Цветовая схема',
    'Выделите объект на слайде', 'Выделите текст', 'Выделите таблицу', 'Выделите изображение',
    'Выделите два объекта и больше', 'Выделите две фигуры и больше', 'Выделенное — не группа', 'Нечего отменять',
    'Нечего повторить', 'Запись макроса не идёт', 'Недоступно в режиме просмотра', 'Нет права на редактирование',
    'Выделите объект или текст', 'Поставьте курсор в текст', 'Нет несохранённых изменений',
    'Отменить изменение', 'Повторить изменение', 'Добавить или изменить ссылку', 'Фон слайда',
    'Новый слайд (Ctrl+M)', 'Формат по образцу — двойной щелчок залипает',
    'Цвет заливки', 'Цвет линии', 'Толщина линии', 'Тип линии', 'Цвет границ', 'Линия',
    'Без заливки', 'Без линии', 'Без границ', 'Автоматический', 'Свой цвет',
    'Орфография', 'Язык документа', 'Доступ к документу', 'Переместить слайд', 'Маркеры и нумерация',
    'Сохранено', 'Сохранение…',
    'Тема меняет фон, шрифты и цвета всех слайдов. Свою тему делают в «Вид → Образец слайдов».',
    'Выделите объект на слайде, чтобы добавить анимацию.'
];

const TEXT_PROP = /^(?:text|tip|txt|cap|caption|title|hint|label|desc|reason|err|msg|str|aria)[A-Z0-9_]|Text$/;
const CYR = /[А-Яа-яЁё]/;
const CSS_PROP = /^text(?:Align|Decoration|Transform|Overflow|Indent|Shadow|Rendering)$/;
/* a bare zoom value such as "75%": the stock zoom lists show these numbers without a locale key */
const PERCENT_VALUE = /^\d+ ?%$/;
/* a bare file format name: the stock «Download as» panel shows these names without a locale key */
const FORMAT_VALUE = /^(PPTX|PDF|ODP|PNG)$/;

function walk(list, fn) {
    for (const it of (list || []).filter(Boolean)) {
        if (it.sep) continue;
        fn(it);
        if (Array.isArray(it.sub)) walk(it.sub, fn);
    }
}

async function captionsComeFromStockLocaleOrListedOwnTexts() {
    const names = H.shellViewNames().filter(n => fs.existsSync(path.join(H.PE_VIEW, n + '.js')));
    assert.ok(names.includes('CompactShell') && names.includes('SlideActions'), 'shell modules are missing (found: ' + (names.join(', ') || 'none') + ')');

    const literals = [];
    for (const n of names) {
        const {strings} = H.scanJs(fs.readFileSync(path.join(H.PE_VIEW, n + '.js'), 'utf8'));
        strings.filter(s => CYR.test(s)).forEach(s => literals.push(n + ': "' + s.slice(0, 40) + '"'));
    }
    assert.deepEqual(literals, [], 'captions written in the code instead of the locale');

    const ru = H.ruLocale();
    const shellSet = new Set(H.shellViewNames());
    const missingKeys = [];
    for (const n of names) {
        const {code} = H.scanJs(fs.readFileSync(path.join(H.PE_VIEW, n + '.js'), 'utf8'));
        for (const m of code.matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:\s*(['"])((?:\\.|(?!\2).)*)\2/g)) {
            const k = m[1];
            if (!TEXT_PROP.test(k) || CSS_PROP.test(k) || !/[A-Za-z]/.test(m[3])) continue;
            if (!(('PE.Views.' + n + '.' + k) in ru)) missingKeys.push('PE.Views.' + n + '.' + k);
        }
    }
    assert.deepEqual(Array.from(new Set(missingKeys)), [], 'shell texts without a key in ru.json');

    const values = new Set(Object.values(ru).map(H.norm));
    const absent = OWN.filter(t => !values.has(H.norm(t)));
    assert.deepEqual(absent, [], 'own captions of the shell are not in ru.json');

    const stockValues = new Set(Object.keys(ru).filter(k => {
        const p = k.split('.');
        return !(p[0] === 'PE' && p[1] === 'Views' && shellSet.has(p[2]));
    }).map(k => H.norm(ru[k])));
    const own = new Set(OWN.map(H.norm));
    const strip = s => H.norm(s).replace(/(\s*…|\.\.\.)$/, '');
    const w = await H.makeWorld();
    w.bootOrExplain();
    const groups = w.load('SlideActions').groups();
    const foreign = [];
    for (const g of groups) {
        const label = H.norm(g.label);
        if (!stockValues.has(label) && !own.has(label)) foreign.push('section "' + label + '"');
        walk(g.items, it => {
            const t = H.norm(it.t !== undefined ? it.t : it.caption);
            if (!t) { foreign.push(label + ': an item without caption'); return; }
            if (PERCENT_VALUE.test(t) || FORMAT_VALUE.test(t)) return;
            if (!stockValues.has(t) && !stockValues.has(strip(t)) && !own.has(t)) foreign.push(label + ': "' + t + '"');
        });
    }
    assert.deepEqual(foreign, [], 'captions neither from the stock locale nor from the listed own texts');
}

H.run([
    {name: 'captions_come_from_stock_locale_or_listed_own_texts', fn: captionsComeFromStockLocaleOrListedOwnTexts}
]);
