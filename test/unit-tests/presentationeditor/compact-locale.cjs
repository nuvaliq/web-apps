/* Run: node test/unit-tests/presentationeditor/compact-locale.cjs [locales directory] [views directory]
 * Presentation shell texts in the ru, en, de locales: the keys of the explicit list
 * SCOPE are in all three files, every text…/tip… default of the shell modules
 * has a key in all three files, en matches the module default, the shell's own
 * captions in ru are verbatim, placeholders are as in ru, JSON is strict and
 * without duplicates, line endings are as before (en.json is CRLF, ru.json and de.json are
 * LF), there are no Cyrillic literals in the shell modules, the shared menu bar strings
 * that the shell shows are in all three files.
 * The optional arguments are copies of the locale/ directory and the app/view/ directory
 * for checking on corrupted copies.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const MAIN = path.join(ROOT, 'apps/presentationeditor/main');
const LOCALE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(MAIN, 'locale');
const VIEW = process.argv[3] ? path.resolve(process.argv[3]) : path.join(MAIN, 'app/view');
const LANGS = ['ru', 'en', 'de'];
const SHELL_MODULES = ['CompactShell', 'StockBridge', 'CompactWindows', 'SlideSelection', 'CompactModes',
    'SlideActions', 'CompactToolbar', 'SlideSections', 'CompactLeft', 'CompactStatus', 'DocInfoWindow'];

/* Keys PE.Views.<module>.<key> translated into three languages. The list
   grows together with the keys: drop-down panels, the right panel and the show,
   then modes and focus. */
const SCOPE = {
    CompactShell: [
        'textCompact', 'textDownloadOdp', 'textDownloadPdf', 'textDownloadPptx', 'textModeEdit',
        'textModeEditHint', 'textModeView', 'textModeViewHint', 'textPresentation', 'textPrint',
        'textSaved', 'textSaving', 'textShowMenu_ARIA', 'textShowSettings', 'textSlideShow', 'textUnsaved',
        'tipBackToCompact', 'tipDownload', 'tipHistory', 'tipRename', 'tipRenameDisabled', 'tipSharing',
        'tipSlideShow'
    ],
    SlideActions: [
        'textAdvancedSettings', 'textArrange', 'textBackground', 'textBulletsNumbering', 'textCase',
        'textClearFormatting', 'textColorScheme', 'textDocInfo', 'textDocLanguage', 'textDownload',
        'textEdit', 'textFindReplace', 'textFocusMode', 'textFormat', 'textHideToolbar', 'textIgnoreAll',
        'textMenuBar_ARIA', 'textMoveSlide', 'textNoEditRight', 'textNoEditRightRequest', 'textNoMacroRecording', 'textNotGroup',
        'textNothingToRedo', 'textNothingToUndo', 'textNoUnsavedChanges', 'textObjectProperties',
        'textPlaceCursor', 'textSelectImage', 'textSelectObject', 'textSelectObjectOrText', 'textSelectTable',
        'textSelectText', 'textSelectTwoObjects', 'textSelectTwoShapes', 'textSharing', 'textSlide',
        'textSpelling', 'textSubscript', 'textSuperscript', 'textText', 'textTransition',
        'textUnderline'
    ],
    CompactToolbar: [
        'textBackground', 'textColorCode_ARIA', 'textCustomColor', 'textLayout', 'textNewSlide', 'textNoLine',
        'textPaintFormat', 'textTheme', 'textTransition', 'tipAlign',
        'tipBackground', 'tipBorderColor', 'tipCase', 'tipClearFormat', 'tipFillColor', 'tipFocus',
        'tipLineColor', 'tipLineType', 'tipLineWidth', 'tipLink', 'tipLists', 'tipMore', 'tipNewSlide',
        'tipObjectProps', 'tipPaintFormat', 'tipRedo', 'tipSubscript', 'tipSuperscript', 'tipTextColor',
        'tipTextStyles', 'tipUnderline', 'tipUndo'
    ],
    SlideSections: [
        'textAnimation', 'textAnimationEffects', 'textAnimationHint', 'textAnimationPane', 'textApplyToAll',
        'textChangeLayout', 'textColorScheme', 'textDelay', 'textDuration', 'textEffect', 'textLayout',
        'textObjectSettings', 'textParameters', 'textPreview', 'textSeconds',
        'textSlideSettings', 'textSlideSize', 'textStartOnClick', 'textTheme', 'textThemeHint', 'textTransition'
    ],
    CompactModes: ['textModeLockedView'],
    CompactLeft: [],
    CompactStatus: []
};

/* The shell's own captions (not from the stock locale): the Russian text verbatim. */
const OWN_RU = {
    'CompactShell.textDownloadOdp': 'Скачать ODP',
    'CompactShell.textDownloadPdf': 'Скачать PDF',
    'CompactShell.textDownloadPptx': 'Скачать PPTX',
    'CompactShell.textModeEdit': 'Редактирование',
    'CompactShell.textModeEditHint': 'Правки применяются сразу',
    'CompactShell.textModeView': 'Просмотр',
    'CompactShell.textModeViewHint': 'Презентация доступна для чтения',
    'CompactShell.textSaved': 'Сохранено',
    'CompactShell.textSaving': 'Сохранение…',
    'CompactShell.textShowMenu_ARIA': 'Способ показа',
    'CompactShell.textSlideShow': 'Показ слайдов',
    'CompactShell.tipDownload': 'Скачать файл',
    'CompactShell.tipSharing': 'Доступ к документу',
    'SlideActions.textAdvancedSettings': 'Расширенные настройки',
    'SlideActions.textArrange': 'Упорядочить',
    'SlideActions.textBackground': 'Фон',
    'SlideActions.textBulletsNumbering': 'Маркеры и нумерация',
    'SlideActions.textCase': 'Регистр',
    'SlideActions.textClearFormatting': 'Очистить форматирование',
    'SlideActions.textColorScheme': 'Цветовая схема',
    'SlideActions.textDocInfo': 'Сведения о документе',
    'SlideActions.textDocLanguage': 'Язык документа',
    'SlideActions.textDownload': 'Скачать',
    'SlideActions.textEdit': 'Правка',
    'SlideActions.textFindReplace': 'Найти и заменить',
    'SlideActions.textFocusMode': 'Режим фокуса',
    'SlideActions.textHideToolbar': 'Скрыть панель инструментов',
    'SlideActions.textIgnoreAll': 'Пропустить всё',
    'SlideActions.textMoveSlide': 'Переместить слайд',
    'SlideActions.textNoEditRight': 'Нет права на редактирование',
    'SlideActions.textNoEditRightRequest': 'Только просмотр — чтобы править, выберите «Файл → Редактировать»',
    'SlideActions.textNoMacroRecording': 'Запись макроса не идёт',
    'SlideActions.textNotGroup': 'Выделенное — не группа',
    'SlideActions.textNothingToRedo': 'Нечего повторить',
    'SlideActions.textNothingToUndo': 'Нечего отменять',
    'SlideActions.textNoUnsavedChanges': 'Нет несохранённых изменений',
    'SlideActions.textObjectProperties': 'Свойства объекта',
    'SlideActions.textPlaceCursor': 'Поставьте курсор в текст',
    'SlideActions.textSelectImage': 'Выделите изображение',
    'SlideActions.textSelectObject': 'Выделите объект на слайде',
    'SlideActions.textSelectObjectOrText': 'Выделите объект или текст',
    'SlideActions.textSelectTable': 'Выделите таблицу',
    'SlideActions.textSelectText': 'Выделите текст',
    'SlideActions.textSelectTwoObjects': 'Выделите два объекта и больше',
    'SlideActions.textSelectTwoShapes': 'Выделите две фигуры и больше',
    'SlideActions.textSharing': 'Доступ к документу',
    'SlideActions.textSlide': 'Слайд',
    'SlideActions.textSpelling': 'Орфография',
    'SlideActions.textSubscript': 'Подстрочный',
    'SlideActions.textSuperscript': 'Надстрочный',
    'SlideActions.textTransition': 'Переход',
    'SlideActions.textUnderline': 'Подчёркнутый',
    'CompactToolbar.textBackground': 'Фон',
    'CompactToolbar.textCustomColor': 'Свой цвет',
    'CompactToolbar.textLayout': 'Макет',
    'CompactToolbar.textNewSlide': 'Новый слайд',
    'CompactToolbar.textNoLine': 'Без линии',
    'CompactToolbar.textPaintFormat': 'Формат по образцу',
    'CompactToolbar.textTheme': 'Тема',
    'CompactToolbar.textTransition': 'Переход',
    'CompactToolbar.tipAlign': 'Выравнивание и интервал',
    'CompactToolbar.tipBackground': 'Фон слайда',
    'CompactToolbar.tipBorderColor': 'Цвет границ',
    'CompactToolbar.tipCase': 'Регистр',
    'CompactToolbar.tipClearFormat': 'Очистить форматирование',
    'CompactToolbar.tipFillColor': 'Цвет заливки',
    'CompactToolbar.tipFocus': 'Режим фокуса',
    'CompactToolbar.tipLineColor': 'Цвет линии',
    'CompactToolbar.tipLineType': 'Тип линии',
    'CompactToolbar.tipLineWidth': 'Толщина линии',
    'CompactToolbar.tipLink': 'Добавить или изменить ссылку',
    'CompactToolbar.tipLists': 'Списки и отступы',
    'CompactToolbar.tipNewSlide': 'Новый слайд (Ctrl+M)',
    'CompactToolbar.tipObjectProps': 'Свойства объекта',
    'CompactToolbar.tipPaintFormat': 'Формат по образцу — двойной щелчок залипает',
    'CompactToolbar.tipRedo': 'Повторить изменение',
    'CompactToolbar.tipSubscript': 'Подстрочный',
    'CompactToolbar.tipSuperscript': 'Надстрочный',
    'CompactToolbar.tipTextColor': 'Цвет текста',
    'CompactToolbar.tipTextStyles': 'Стили текста',
    'CompactToolbar.tipUnderline': 'Подчёркнутый',
    'CompactToolbar.tipUndo': 'Отменить изменение',
    'CompactModes.textModeLockedView': 'Недоступно в режиме просмотра',
    'SlideSections.textAnimationHint': 'Выделите объект на слайде, чтобы добавить анимацию.',
    'SlideSections.textObjectSettings': 'Параметры объекта',
    'SlideSections.textTheme': 'Тема',
    'SlideSections.textThemeHint': 'Тема меняет фон, шрифты и цвета всех слайдов. Свою тему делают в «Вид → Образец слайдов».',
    'SlideSections.textTransition': 'Переход'
};

/* --- parsing ----------------------------------------------------------------- */

/* The source without comments and a list of string literals. */
function scanJs(src) {
    let code = '', i = 0, prev = '';
    const strings = [], n = src.length;
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; code += ' '; continue; }
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1, s = '';
            while (j < n && src[j] !== c) {
                if (src[j] === '\\') { s += src[j] + (src[j + 1] || ''); j += 2; continue; }
                s += src[j]; j++;
            }
            strings.push(s);
            code += c + s + c;
            i = j + 1; prev = c; continue;
        }
        if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]$|^$|return$|typeof$/.test(prev)) {
            let j = i + 1, inClass = false;
            while (j < n) {
                if (src[j] === '\\') { j += 2; continue; }
                if (src[j] === '[') inClass = true;
                else if (src[j] === ']') inClass = false;
                else if ((src[j] === '/' && !inClass) || src[j] === '\n') break;
                j++;
            }
            code += src.slice(i, j + 1); i = j + 1; prev = '/'; continue;
        }
        code += c;
        if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? (/[\w$]$/.test(prev) ? prev + c : c) : c;
        i++;
    }
    return {code, strings};
}

/* The module's text…/tip… defaults: {key: value}. */
function defaults(name) {
    const file = path.join(VIEW, name + '.js');
    if (!fs.existsSync(file)) return null;
    const {code} = scanJs(fs.readFileSync(file, 'utf8'));
    const out = {};
    for (const m of code.matchAll(/(?:^|[,{\s])((?:text|tip)[A-Z][\w$]*)\s*:\s*'((?:\\.|[^'\\])*)'/g)) {
        out[m[1]] = m[2].replace(/\\(.)/g, '$1');
    }
    return out;
}

function raw(lang) { return fs.readFileSync(path.join(LOCALE, lang + '.json'), 'utf8'); }

const cache = {};
function locale(lang) { return cache[lang] || (cache[lang] = JSON.parse(raw(lang))); }

function keyLines(text) {
    return Array.from(text.matchAll(/^\s*"((?:\\.|[^"\\])*)"\s*:/gm), m => JSON.parse('"' + m[1] + '"'));
}

function scopeKeys() {
    const out = [];
    for (const mod of Object.keys(SCOPE)) for (const k of SCOPE[mod]) out.push({mod, k, full: 'PE.Views.' + mod + '.' + k});
    return out;
}

function placeholders(s) { return (String(s).match(/\{\d+\}|%\d+|%s|<br\s*\/?>/g) || []).sort(); }

const lc = s => s.toLowerCase();

/* --- checks ------------------------------------------------------------------ */

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('ok ' + name); passed++; }
    catch (e) { console.log('FAIL ' + name + ': ' + e.message); failed++; }
}

check('scope_keys_have_ru_en_de', () => {
    const problems = [];
    const defs = {};
    for (const mod of Object.keys(SCOPE)) {
        defs[mod] = defaults(mod);
        if (!defs[mod]) problems.push('no module ' + mod + '.js');
    }
    for (const {mod, k, full} of scopeKeys()) {
        if (!defs[mod]) continue;
        if (!(k in defs[mod])) { problems.push(full + ': no default in the module'); continue; }
        for (const lang of LANGS) {
            const v = locale(lang)[full];
            if (typeof v !== 'string' || !v.trim()) problems.push(full + ': no text in ' + lang + '.json');
        }
        if (locale('en')[full] !== undefined && locale('en')[full] !== defs[mod][k]) {
            problems.push(full + ': en differs from the module default "' + defs[mod][k] + '"');
        }
        const ru = locale('ru')[full], de = locale('de')[full];
        if (typeof ru === 'string' && !/[А-Яа-яЁё]/.test(ru) && !/^[A-Z0-9 ]+$/.test(ru)) problems.push(full + ': ru is not Russian');
        if (typeof de === 'string' && /[А-Яа-яЁё]/.test(de)) problems.push(full + ': de holds Cyrillic');
    }
    /* a new key stands alphabetically among its neighbors */
    for (const lang of LANGS) {
        const keys = keyLines(raw(lang));
        for (const {full} of scopeKeys()) {
            const i = keys.indexOf(full);
            if (i < 0) continue;
            if ((i > 0 && lc(keys[i - 1]) > lc(full)) || (i < keys.length - 1 && lc(full) > lc(keys[i + 1]))) {
                problems.push(full + ': out of alphabetical order in ' + lang + '.json');
            }
        }
    }
    assert.deepEqual(problems, []);
});

/* Completeness: every default of every shell module is translated into three languages,
   and en matches the default: a new default without a key fails the check. */
check('every_default_has_ru_en_de_key', () => {
    const problems = [];
    for (const mod of SHELL_MODULES) {
        const defs = defaults(mod);
        if (!defs) { problems.push('no module ' + mod + '.js'); continue; }
        for (const k of Object.keys(defs)) {
            const full = 'PE.Views.' + mod + '.' + k;
            for (const lang of LANGS) {
                const v = locale(lang)[full];
                if (typeof v !== 'string' || !v.trim()) problems.push(full + ': no text in ' + lang + '.json');
            }
            if (typeof locale('en')[full] === 'string' && locale('en')[full] !== defs[k]) {
                problems.push(full + ': en differs from the module default "' + defs[k] + '"');
            }
            if (!(SCOPE[mod] || []).includes(k)) problems.push(full + ': not in SCOPE');
        }
    }
    assert.deepEqual(problems, []);
});

/* Strings of the shared menu bar (Common.UI.Compact.MenuBar) that the shell shows:
   disable reasons ("File → Edit" for a reader shows the offline reason) and the "More" label.
   The shell has its own label for the menu bar itself (SlideActions.textMenuBar_ARIA). Without a key
   in the locale the string stays the English default of the module. */
const MENU_BAR = path.join(ROOT, 'apps/common/main/lib/view/compact/MenuBar.js');
const MENU_BAR_KEYS = ['textReasonLimit', 'textReasonOffline', 'textReasonProtected', 'textReasonView', 'txtMore_ARIA'];

check('shared_menu_bar_texts_have_ru_en_de', () => {
    const {code} = scanJs(fs.readFileSync(MENU_BAR, 'utf8'));
    const defs = {};
    for (const m of code.matchAll(/(?:^|[,{\s])((?:text|txt)[A-Z][\w$]*)\s*:\s*'((?:\\.|[^'\\])*)'/g)) defs[m[1]] = m[2].replace(/\\(.)/g, '$1');
    const problems = [];
    for (const k of MENU_BAR_KEYS) {
        const full = 'Common.UI.Compact.MenuBar.' + k;
        if (!(k in defs)) { problems.push(full + ': no default in MenuBar.js'); continue; }
        for (const lang of LANGS) {
            const v = locale(lang)[full];
            if (typeof v !== 'string' || !v.trim()) problems.push(full + ': no text in ' + lang + '.json');
        }
        if (typeof locale('en')[full] === 'string' && locale('en')[full] !== defs[k]) {
            problems.push(full + ': en differs from the module default "' + defs[k] + '"');
        }
        const ru = locale('ru')[full], de = locale('de')[full];
        if (typeof ru === 'string' && !/[А-Яа-яЁё]/.test(ru)) problems.push(full + ': ru is not Russian');
        if (typeof de === 'string' && (/[А-Яа-яЁё]/.test(de) || de === defs[k])) problems.push(full + ': de is not German');
        for (const lang of LANGS) {
            const keys = keyLines(raw(lang)), i = keys.indexOf(full);
            if (i < 0) continue;
            if ((i > 0 && lc(keys[i - 1]) > lc(full)) || (i < keys.length - 1 && lc(full) > lc(keys[i + 1]))) {
                problems.push(full + ': out of alphabetical order in ' + lang + '.json');
            }
        }
    }
    assert.deepEqual(problems, []);
});

check('no_cyrillic_literals_in_shell_modules', () => {
    const found = [];
    for (const n of SHELL_MODULES) {
        const file = path.join(VIEW, n + '.js');
        if (!fs.existsSync(file)) continue;
        scanJs(fs.readFileSync(file, 'utf8')).strings
            .filter(s => /[А-Яа-яЁё]/.test(s))
            .forEach(s => found.push(n + ': "' + s.slice(0, 40) + '"'));
    }
    assert.deepEqual(found, [], 'captions written in the code instead of the locale');
});

check('json_strict_no_duplicates', () => {
    const problems = [];
    for (const lang of LANGS) {
        const text = raw(lang);
        if (text.charCodeAt(0) === 0xFEFF) problems.push(lang + '.json starts with a BOM');
        let obj;
        try { obj = JSON.parse(text); } catch (e) { problems.push(lang + '.json: ' + e.message); continue; }
        const keys = keyLines(text), seen = new Set();
        keys.forEach(k => { if (seen.has(k)) problems.push(lang + '.json: duplicate ' + k); seen.add(k); });
        if (keys.length !== Object.keys(obj).length) problems.push(lang + '.json: not one key per line');
        for (const k of Object.keys(obj)) if (typeof obj[k] !== 'string') problems.push(lang + '.json: ' + k + ' is not a string');
    }
    assert.deepEqual(problems, []);
});

check('placeholders_match_ru', () => {
    const problems = [];
    for (const {full} of scopeKeys()) {
        const ru = locale('ru')[full];
        if (typeof ru !== 'string') continue;
        for (const lang of ['en', 'de']) {
            const v = locale(lang)[full];
            if (typeof v === 'string' && placeholders(v).join(' ') !== placeholders(ru).join(' ')) {
                problems.push(full + ': ' + lang + ' [' + placeholders(v) + '] vs ru [' + placeholders(ru) + ']');
            }
        }
    }
    assert.deepEqual(problems, []);
});

check('line_endings_preserved', () => {
    const problems = [];
    const en = raw('en');
    if (/(^|[^\r])\n/.test(en)) problems.push('en.json has lines without CRLF');
    for (const lang of ['ru', 'de']) if (/\r/.test(raw(lang))) problems.push(lang + '.json has CR characters');
    for (const lang of LANGS) if (!/\}$/.test(raw(lang))) problems.push(lang + '.json does not end with the closing brace');
    assert.deepEqual(problems, []);
});

/* Removed menu items leave no captions in SlideActions.js or the presentation locales. */
check('no_labels_for_removed_file_menu_items', () => {
    const d = defaults('SlideActions');
    assert.ok(d, 'SlideActions.js is missing');
    const files = fs.readdirSync(LOCALE).filter(f => /\.json$/.test(f));
    const problems = [];
    ['textStockInterface'].forEach(name => {
        if (name in d) problems.push('SlideActions.' + name + ' default is left');
        const key = 'PE.Views.SlideActions.' + name;
        const left = files.filter(f => key in JSON.parse(fs.readFileSync(path.join(LOCALE, f), 'utf8')));
        if (left.length) problems.push(key + ' is left in ' + left.join(', '));
    });
    assert.deepEqual(problems, []);
});

check('own_captions_exact_in_scope', () => {
    const inScope = new Set(scopeKeys().map(x => x.mod + '.' + x.k));
    const problems = [];
    for (const key of Object.keys(OWN_RU)) {
        if (!inScope.has(key)) { problems.push(key + ': not in SCOPE'); continue; }
        const v = locale('ru')['PE.Views.' + key];
        if (v !== OWN_RU[key]) problems.push(key + ': "' + v + '" instead of "' + OWN_RU[key] + '"');
    }
    assert.deepEqual(problems, []);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
