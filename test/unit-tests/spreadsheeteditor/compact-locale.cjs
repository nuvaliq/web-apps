/* Run: node test/unit-tests/spreadsheeteditor/compact-locale.cjs [locale directory] [view directory]
 * The spreadsheet editor "Compact" shell texts: every `text*`/`tip*` default of the shell modules
 * has an SSE.Views.<Module>.<name> key in ru and en (de.json is not changed: keys that do not exist
 * in German are not there - the German interface shows the English default; the shared menu row reasons carry
 * the former spreadsheet editor translation where there is one); there are no string literals in Cyrillic in the
 * modules (the visible text goes through the locale, the service journal labels are English); the locale
 * files are strict JSON without duplicates, with LF and without a trailing newline, as in the stock;
 * the `{N}` placeholders of the translations match the Russian ones.
 * The names that are not in the edit lists below are standard (
 * labels_changed_only_as_listed): a comparison with the standard ONLYOFFICE release the fork is based on
 * (STOCK, git show from the tree storage); if it is not in the tree history, the comparison is skipped (SKIP).
 * The arguments are broken copies for the negative control (a removed key fails the test; a copy
 * of the locale directory with one changed standard value fails labels_changed_only_as_listed).
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const LOCALE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'apps/spreadsheeteditor/main/locale');
const VIEW = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'apps/spreadsheeteditor/main/app/view');
const LANGS = ['ru', 'en', 'de'];
/* The texts are edited in Russian and English. The other languages, German included, are not changed:
   the new items show English text in them; the already translated
   texts of the compact interface and the standard items stay as they were. In de.json and the other spreadsheet editor locales the standard values are as in the stock. */
const EDITED_LANGS = ['ru', 'en'];

/* The shell modules. Missing modules are skipped, but the skeleton must be there. */
const MODULES = ['CompactShell', 'StockBridge', 'SheetActions', 'CompactToolbar', 'FormulaBar', 'ColumnHeaderMenu'];
const REQUIRED = ['CompactShell'];

function modules() {
    return MODULES.map(name => ({name, file: path.join(VIEW, name + '.js')}))
        .filter(m => {
            const exists = fs.existsSync(m.file);
            assert.ok(exists || !REQUIRED.includes(m.name), m.name + '.js is missing');
            return exists;
        })
        .map(m => Object.assign(m, {src: fs.readFileSync(m.file, 'utf8')}));
}

/* A lexer for exactly what is needed: strings, templates, regexes and JS comments. It returns
   the literals (with a position) and the "code" - the source where the contents of literals and comments
   are filled with spaces of the same length: braces are counted honestly on it. Comments may legitimately contain Cyrillic,
   they do not end up in the literals. */
function lex(src) {
    const out = [];
    const code = src.split('');
    const blank = (a, b) => { for (let k = a; k < b; k++) if (code[k] !== '\n') code[k] = ' '; };
    let i = 0, prev = '';
    const regexAllowed = () => /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(prev);
    while (i < src.length) {
        const c = src[i], n = src[i + 1];
        if (c === '/' && n === '/') { const a = i; while (i < src.length && src[i] !== '\n') i++; blank(a, i); continue; }
        if (c === '/' && n === '*') { const a = i; i = src.indexOf('*/', i + 2); i = i < 0 ? src.length : i + 2; blank(a, i); continue; }
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1, v = '';
            while (j < src.length && src[j] !== c) { if (src[j] === '\\') { v += src[j] + src[j + 1]; j += 2; continue; } v += src[j++]; }
            out.push({quote: c, value: v, pos: i, at: src.slice(0, i).split('\n').length});
            blank(i + 1, j);
            i = j + 1; prev = 'x';
            continue;
        }
        if (c === '/' && regexAllowed()) {
            let j = i + 1, cls = false;
            while (j < src.length && (cls || src[j] !== '/')) {
                if (src[j] === '\\') j++;
                else if (src[j] === '[') cls = true;
                else if (src[j] === ']') cls = false;
                j++;
            }
            out.push({quote: '/', value: src.slice(i + 1, j), pos: i, at: src.slice(0, i).split('\n').length});
            blank(i + 1, j);
            i = j + 1;
            while (/[a-z]/.test(src[i] || '')) i++;
            prev = 'x';
            continue;
        }
        if (!/\s/.test(c)) {
            const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 40));
            if (m) { prev = m[0]; i += m[0].length; continue; }
            prev = c;
        }
        i++;
    }
    return {literals: out, code: code.join('')};
}
const literals = src => lex(src).literals;

/* The `text*`/`tip*` defaults are top-level properties of the module exported object
   (`SSE.Views.<Module> = _.extend({…}, …)` or `SSE.Views.<Module> = {…}`). Tables
   inside a module (icon names like `textToTable`) do not count as defaults. */
function defaults(mod) {
    const {literals: lits, code} = lex(mod.src);
    const decl = new RegExp('SSE\\.Views\\.' + mod.name + '\\s*=\\s*(?:_\\.extend\\(\\s*)?\\{').exec(code);
    assert.ok(decl, mod.name + '.js: SSE.Views.' + mod.name + ' object not found');
    const out = {};
    let depth = 0;
    for (let i = decl.index + decl[0].length - 1; i < code.length; i++) {
        const ch = code[i];
        if (ch === '{' || ch === '(' || ch === '[') depth++;
        else if (ch === '}' || ch === ')' || ch === ']') { if (--depth === 0) break; }
        else if (depth === 1 && /[A-Za-z_$]/.test(ch) && !/[\w$.]/.test(code[i - 1])) {
            /* The name may carry an _ARIA segment - a phrase only for the screen reader (the key rule). */
            const m = /^((?:text|tip)[A-Z][A-Za-z0-9_]*)\s*:\s*/.exec(code.slice(i, i + 80));
            if (!m) continue;
            const lit = lits.find(l => l.pos === i + m[0].length);
            assert.ok(lit && (lit.quote === "'" || lit.quote === '"'), mod.name + '.' + m[1] + ': default must be a string literal');
            assert.ok(!(m[1] in out), mod.name + '.' + m[1] + ' declared twice');
            out[m[1]] = lit.value;
            i += m[0].length;
        }
    }
    return out;
}

function readLocale(lang) {
    const file = path.join(LOCALE, lang + '.json');
    const raw = fs.readFileSync(file, 'utf8');
    return {file, raw, json: JSON.parse(raw)};
}

let passed = 0, failed = 0, skipped = 0;
function test(name, fn) {
    try {
        fn();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        if (error && error.skip) { console.log('SKIP', name, '—', error.message); skipped++; return; }
        console.error('FAIL', name, '—', error && error.message);
        failed++;
    }
}
const skip = message => Object.assign(new Error(message), {skip: true});

const placeholders = s => (String(s).match(/\{\d+\}/g) || []).sort();

/* German is not changed - the key of a new item
   is not created in de.json, German shows the English default. A key that is in de.json is not empty. */
test('every_default_has_ru_en_key', () => {
    const locales = Object.fromEntries(LANGS.map(l => [l, readLocale(l).json]));
    let total = 0;
    modules().forEach(mod => {
        Object.keys(defaults(mod)).forEach(prop => {
            const key = 'SSE.Views.' + mod.name + '.' + prop;
            total++;
            EDITED_LANGS.forEach(l => {
                assert.equal(typeof locales[l][key], 'string', key + ' is missing in ' + l + '.json');
                assert.ok(locales[l][key].trim(), key + ' is empty in ' + l + '.json');
            });
            if (key in locales.de) assert.ok(typeof locales.de[key] === 'string' && locales.de[key].trim(), key + ' is empty in de.json');
        });
    });
    assert.ok(total >= 5, 'suspiciously few defaults found: ' + total);
});

test('no_cyrillic_literals_in_shell_modules', () => {
    const bad = [];
    modules().forEach(mod => literals(mod.src).forEach(l => {
        if (/[Ѐ-ӿ]/.test(l.value)) bad.push(mod.name + '.js:' + l.at + ' ' + l.quote + l.value.slice(0, 40));
    }));
    assert.deepEqual(bad, [], 'Cyrillic literals in shell modules');
});

test('json_strict_no_duplicates', () => {
    LANGS.forEach(l => {
        const {raw} = readLocale(l);
        const keys = [...raw.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)].map(m => m[1]);
        const seen = new Set(), dups = [];
        keys.forEach(k => { if (seen.has(k)) dups.push(k); seen.add(k); });
        assert.deepEqual(dups, [], l + '.json duplicate keys');
        assert.equal(keys.length, Object.keys(JSON.parse(raw)).length, l + '.json: key scan and JSON.parse disagree');
        /* The shell keys are alphabetical among their neighbors: the module block stands between
           the nearest SSE.Views keys, and is sorted inside. */
        modules().forEach(mod => {
            const prefix = 'SSE.Views.' + mod.name + '.';
            const idx = keys.map((k, i) => k.indexOf(prefix) === 0 ? i : -1).filter(i => i >= 0);
            if (!idx.length) return;
            assert.equal(idx[idx.length - 1] - idx[0] + 1, idx.length, l + '.json: ' + prefix + '* keys are not contiguous');
            const block = idx.map(i => keys[i]);
            assert.deepEqual(block, block.slice().sort(), l + '.json: ' + prefix + '* keys are not sorted');
            const before = keys[idx[0] - 1], after = keys[idx[idx.length - 1] + 1];
            assert.ok(!before || before < block[0], l + '.json: ' + prefix + '* goes after ' + before);
            assert.ok(!after || after > block[block.length - 1], l + '.json: ' + prefix + '* goes before ' + after);
        });
    });
});

test('placeholders_match_ru', () => {
    const ru = readLocale('ru').json;
    modules().forEach(mod => Object.keys(defaults(mod)).forEach(prop => {
        const key = 'SSE.Views.' + mod.name + '.' + prop;
        const want = placeholders(ru[key]);
        assert.deepEqual(placeholders(defaults(mod)[prop]), want, key + ': default vs ru');
        /* de: the key may be absent - then the default is shown, its placeholders were checked above. */
        ['en', 'de'].forEach(l => {
            const v = readLocale(l).json[key];
            if (l === 'de' && v === undefined) return;
            assert.deepEqual(placeholders(v), want, key + ': ' + l + ' vs ru');
        });
    }));
});

test('line_endings_preserved', () => {
    LANGS.forEach(l => {
        const {raw} = readLocale(l);
        assert.ok(raw.indexOf('\r') < 0, l + '.json: CR found, the file is LF');
        assert.ok(raw.endsWith('\n}'), l + '.json: the file must end with "}" and no trailing newline, as stock');
        assert.ok(raw.startsWith('{\n  "'), l + '.json: header changed');
    });
});

/* The names that are not in the edit lists below remain the standard ONLYOFFICE ones. The comparison is with the standard release the
   fork is based on (STOCK, git show from the tree storage): the value of an ru/en key that exists in the stock changes only by CHANGED
   (the edit table: key → new value by language), a key is removed only by
   REMOVED (the table of removed keys) - and both must be done; new keys are allowed (new items);
   in de and the other spreadsheet editor locales every stock key is in place with its standard value (only Russian and English are edited;
   the de columns of the tables below are not read - German is not changed). The tables
   are appended together with the items that need these keys. The negative control is a copy
   of the locale directory with one changed standard value (argument 1).
   STOCK is the commit of the ONLYOFFICE web-apps v9.4.0.129 release the fork history starts from: it is in the history of each of its branches
   and does not depend on how the fork branches are merged.
   When the fork moves to another release, STOCK moves with it; while the commit is not in the tree history, the comparison with the stock
   is skipped (SKIP). */
const STOCK = '1993a6d897';
const CHANGED = {
    /* The de values are not recorded in the edit tables: de.json is not changed
       (de_json_keeps_stock), German shows the standard and former translations and the English defaults of the new items.
       The cell, row and column menu and "Edit → Clear ▸": the item ru "Text" is renamed
       ru "Contents" (in Russian) - it deletes both numbers and formulas. In all places of the spreadsheet editor: the context menu (and the shell column letter
       menu - a snapshot of its items) - the DocumentHolder key, the standard ribbon "Home → Clear" (and its mirrors in the
       compact) - the Toolbar key; the keys have no other places (clear_text_key_only_in_clear_menus). */
    'SSE.Views.DocumentHolder.txtClearText': {ru: 'Содержимое', en: 'Contents'},
    'SSE.Views.Toolbar.txtClearText': {ru: 'Содержимое', en: 'Contents'},
    /* "Data → Analysis ▸ Solver": the shell ru "Solver" caption is an error, in the standard ONLYOFFICE Russian translation this command is called ru "Solution search"
       (SSE.Views.DataTab.capSolver); en and de are the standard "Solver", unchanged.
       The key has no other places: it belongs only to the "Data → Analysis ▸ Solver" menu row item. */
    'SSE.Views.SheetActions.textSolver': {ru: 'Поиск решения'},
    /* Button captions: ₽ ru "Currency format" → ru "Accounting format": the button sets the accounting format (after pressing
       the "Number format" shows "Accounting"); en and de are the standard translation of the hint of the same ribbon button (SSE.Views.Toolbar.tipDigStyleAccounting:
       Accounting style / Buchhaltungsformat). Σ ru "Functions" → ru "Function": one command has one name, in the menu - "Insert → Function ▸"
       (SSE.Views.SheetActions.textFunction: Function / Funktion). The keys have no other places: they belong only to the ₽ and Σ panel buttons. */
    'SSE.Views.CompactToolbar.tipCurrency': {ru: 'Финансовый формат', en: 'Accounting style'},
    'SSE.Views.CompactToolbar.tipFunction': {ru: 'Функция', en: 'Function'},
    /* "Conditional formatting": the submenu ru "Value is ▸" (ru "Greater", ru "Less", ru "Between" …) → ru "Cell value ▸":
       the name did not match the content; ru "Top/Bottom ▸ (Top 10 Items …)" in the singular → ru "Top/Bottom ▸ (Top 10
       items …)" in the plural: a word agreement error. Only ru: the errors are only in Russian (en Value is / Top / Bottom / Items
       and de are standard, unchanged). In all places of the spreadsheet editor: the panel button list and
       "Format → Conditional formatting ▸" (a mirror of the ribbon button), the Standard ribbon, the right cell panel, the rules window (ru "Cell value",
       ru "Top/Bottom" - ru "Top" / ru "Bottom") and the rule manager (ru "Top 10"); the keys have no other places
       (cond_keys_only_in_cond_rules). */
    'Common.define.conditionalData.textValue': {ru: 'Значение ячейки'},
    'Common.define.conditionalData.textTop': {ru: 'Наибольшие'},
    'Common.define.conditionalData.textBottom': {ru: 'Наименьшие'},
    'SSE.Views.Toolbar.textItems': {ru: 'элементов'},
    'SSE.Views.CellSettings.textItems': {ru: 'элементов'},
    /* The English name is the original ONLYOFFICE name for the same command, the case is as in
       ONLYOFFICE. "Format → ✓ Wrap text" (the caption is the hint of the panel "Wrap" button, one command - one name) is Wrap text,
       as for the ribbon "Wrap text" button (Toolbar.tipWrap), was Text wrapping; "Data → Analysis ▸ Goal Seek" is Goal Seek,
       as for the "Goal Seek" button of the "Data" tab (DataTab.capGoalSeek), was Goal seek. Only en: the Russian names are correct. */
    'SSE.Views.CompactToolbar.tipWrap': {en: 'Wrap text'},
    'SSE.Views.SheetActions.textGoalSeek': {en: 'Goal Seek'},
    /* "Conditional formatting": ru "Top/Bottom ▸" is a word agreement error, the same one is in the rules window: in
       the rule window the top10 row read as ru "Bottom | 10 | Item" - the choice ru "Item · Percent" after the number; the choice key (FormatRulesEditDlg
       .textItem) is ru "items" (plural), as in the items ru "Top 10 items" (textItems). Only ru: the errors are only in Russian
       (en Item is standard). The key has no other places (rule_dialog_item_key_only_in_top10). */
    'SSE.Views.FormatRulesEditDlg.textItem': {ru: 'элементов'}
};
const REMOVED = [
    /* ru "Review" became ru "Collaboration" (textCollaboration), "Chat" was removed
      , "Comment" in "Insert" is called "Add comment" (textAddComment). */
    'SSE.Views.SheetActions.textReview', 'SSE.Views.SheetActions.textChat', 'SSE.Views.SheetActions.textComment',
    /* ru "Download XLSX/PDF/CSV/ODS" became the "Download ▸" submenu with the format names,
       "Get data from text" is "File → Import ▸" (textImport), "Print titles", "Margins", "Orientation", "Page
       size", "Print scale" were removed from "File" - they are in the print window. */
    'SSE.Views.SheetActions.textDownloadXlsx', 'SSE.Views.SheetActions.textDownloadPdf', 'SSE.Views.SheetActions.textDownloadCsv',
    'SSE.Views.SheetActions.textDownloadOds', 'SSE.Views.SheetActions.textFromText', 'SSE.Views.SheetActions.textPrintTitles',
    'SSE.Views.SheetActions.textMargins', 'SSE.Views.SheetActions.textOrientation', 'SSE.Views.SheetActions.textPageSize',
    'SSE.Views.SheetActions.textScale',
    /* "Dark sheet", "Interface theme" and "Object properties" were removed from "View"
       (the look is set by the portal, the right panel opens by itself). */
    'SSE.Views.SheetActions.textDarkSheet', 'SSE.Views.SheetActions.textUiTheme', 'SSE.Views.SheetActions.textObjectProps',
    /* "Table" (a duplicate of "Format as table"), SmartArt, TextArt and "Equation"
       were removed from "Insert"; "Remove arrows ▸" became rows of "Data → Formulas ▸" with the captions of the standard
       items of the "Remove arrows" button. The keys have no other places. */
    'SSE.Views.SheetActions.textTable', 'SSE.Views.SheetActions.textSmartArt', 'SSE.Views.SheetActions.textTextArt',
    'SSE.Views.SheetActions.textEquation', 'SSE.Views.SheetActions.textRemoveArrows',
    /* "Superscript and subscript ▸" became "Text ▸" (textText): six
       font style switches with the captions of the panel hints and the standard "Superscript", "Subscript". The key has no other places. */
    'SSE.Views.SheetActions.textScript',
    /* The panel font size is a combo box without "−" and "+", as in Documents: there are no stepper hints. The keys have no other places (the
       standard ribbon has its own keys); de.json is not changed. */
    'SSE.Views.CompactToolbar.tipDecFont', 'SSE.Views.CompactToolbar.tipIncFont',
    /* "Format cells… ▸" is the caption of the holder that became "Rows, columns and sheet ▸" (textRowsColsSheet); the "Format →
       Format cells" item is captioned by its own key textCellFormat (NEW). The key has no other places; de.json is not changed. */
    'SSE.Views.SheetActions.textFormatCells',
    /* There is no "Comments" button in the header, and a reader has no mode switch: the captions
       CompactShell.tipComments and textModeReader are not needed by the shell. The keys have no other places; de.json is not changed. */
    'SSE.Views.CompactShell.tipComments', 'SSE.Views.CompactShell.textModeReader'
];
/* The stock locales from the tree storage. The STOCK commit is not in the tree history or its files cannot be read - skip. */
const STOCK_LOCALE = 'apps/spreadsheeteditor/main/locale/';
function git(args) {
    try {
        return execFileSync('git', ['-C', ROOT].concat(args), {encoding: 'utf8', maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore']});
    } catch (e) {
        return null;
    }
}
let stockLocales = null;
function stock() {
    if (stockLocales) return stockLocales;
    const listing = git(['merge-base', '--is-ancestor', STOCK, 'HEAD']) === null ? null
        : git(['ls-tree', '--name-only', STOCK, STOCK_LOCALE]);
    if (listing === null) throw skip('the stock release ' + STOCK + ' is not in the history of this tree');
    const files = listing.split('\n').filter(Boolean).map(f => path.basename(f)).filter(f => /\.json$/.test(f)).sort();
    const json = {};
    files.forEach(f => {
        const raw = git(['show', STOCK + ':' + STOCK_LOCALE + f]);
        if (raw === null) throw skip(STOCK_LOCALE + f + ' of the stock release ' + STOCK + ' is not readable');
        json[f.replace(/\.json$/, '')] = JSON.parse(raw);
    });
    return (stockLocales = {files, json});
}

test('labels_changed_only_as_listed', () => {
    const base = stock();
    const files = fs.readdirSync(LOCALE).filter(f => /\.json$/.test(f)).sort();
    assert.deepEqual(base.files.filter(f => !files.includes(f)), [], 'stock spreadsheet locales are missing');
    assert.ok(files.length >= 46, 'suspiciously few locales: ' + files.length);
    const bad = [];
    EDITED_LANGS.forEach(l => {
        const was = base.json[l], now = readLocale(l).json;
        Object.keys(was).forEach(k => {
            if (!(k in now)) { if (!REMOVED.includes(k)) bad.push(l + ': «' + k + '» removed, not in the list'); return; }
            if (now[k] === was[k]) return;
            const want = CHANGED[k] && CHANGED[k][l];
            if (want === undefined) bad.push(l + ': «' + k + '» changed «' + was[k] + '» → «' + now[k] + '», not in the list');
        });
        REMOVED.forEach(k => { if (k in now) bad.push(l + ': «' + k + '» is listed as removed and is still there'); });
        Object.keys(CHANGED).forEach(k => {
            const want = CHANGED[k][l];
            if (want !== undefined && now[k] !== want) bad.push(l + ': «' + k + '» is «' + now[k] + '», the list says «' + want + '»');
        });
    });
    /* de and others: the stock key is neither removed nor changed; keys beyond the stock are not standard names, they are held by their own tests. */
    base.files.forEach(f => {
        const l = f.replace(/\.json$/, '');
        if (EDITED_LANGS.includes(l)) return;
        const was = base.json[l], now = JSON.parse(fs.readFileSync(path.join(LOCALE, f), 'utf8'));
        Object.keys(was).forEach(k => {
            if (!(k in now)) bad.push(f + ': «' + k + '» removed');
            else if (now[k] !== was[k]) bad.push(f + ': «' + k + '» changed «' + was[k] + '» → «' + now[k] + '»');
        });
    });
    assert.deepEqual(bad, [], 'labels changed outside the lists, against the stock release ' + STOCK);
});

/* The new names (new items have new names; the table of new
   keys): Russian is the item name verbatim, English is the original ONLYOFFICE name (German is not changed).
   The table is appended together with CHANGED. The negative control is the locale directory of the branch base (argument 1). */
const NEW = {
    /* "Collaboration" - the same as in the document editor (DE.Views.DocumentActions.textCollaboration). */
    'SSE.Views.SheetActions.textCollaboration': {ru: 'Совместная работа', en: 'Collaboration'},
    /* "Collaboration → Protection ▸". */
    'SSE.Views.SheetActions.textProtection': {ru: 'Защита', en: 'Protection'},
    /* "Help → Keyboard shortcuts" and "Help → Function list". */
    /* en is the original ONLYOFFICE name, the case is as there: Keyboard Shortcuts, Download as. */
    'SSE.Views.SheetActions.textShortcuts': {ru: 'Быстрые клавиши', en: 'Keyboard Shortcuts'},
    'SSE.Views.SheetActions.textFunctionList': {ru: 'Список функций', en: 'Function list'},
    /* "File → Download ▸ (XLSX · PDF · CSV · ODS)" and "File → Import ▸" (formerly "Data → Get data from text ▸"). */
    'SSE.Views.SheetActions.textDownload': {ru: 'Скачать', en: 'Download as'},
    'SSE.Views.SheetActions.textImport': {ru: 'Импорт', en: 'Import'},
    /* "Edit → Cut · Copy · Paste" and "Clear ▸". The names are standard, as for the
       items of the same name of the context menu (staple_names_as_context_menu). */
    'SSE.Views.SheetActions.textCut': {ru: 'Вырезать', en: 'Cut'},
    'SSE.Views.SheetActions.textCopy': {ru: 'Копировать', en: 'Copy'},
    'SSE.Views.SheetActions.textPaste': {ru: 'Вставить', en: 'Paste'},
    'SSE.Views.SheetActions.textClear': {ru: 'Очистить', en: 'Clear'},
    /* The "View" submenus: "Zoom ▸", "Show ▸", "Views ▸" and "Hidden sheets ▸".
       "Zoom" and "Hidden sheets" are the standard names of the same command (
       staple_names_as_stock): in every language word for word as in the stock; the other two follow the meaning of the Russian. */
    'SSE.Views.SheetActions.textZoom': {ru: 'Масштаб', en: 'Zoom'},
    'SSE.Views.SheetActions.textShow': {ru: 'Показать', en: 'Show'},
    /* The English name of the item "Views ▸" is Sheet View (this is what ONLYOFFICE calls the named views button). */
    'SSE.Views.SheetActions.textViews': {ru: 'Представления', en: 'Sheet View'},
    'SSE.Views.SheetActions.textHiddenSheets': {ru: 'Скрытые листы', en: 'Hidden sheets'},
    /* "Insert → Sheet"; "Data → Formulas ▸" (the groups "Calculation options" - the former caption, - and
       "Formula auditing") and "Analysis ▸". The names are new, en and de follow the meaning of the Russian. */
    'SSE.Views.SheetActions.textSheet': {ru: 'Лист', en: 'Sheet'},
    'SSE.Views.SheetActions.textFormulas': {ru: 'Формулы', en: 'Formulas'},
    'SSE.Views.SheetActions.textFormulaAuditing': {ru: 'Проверка формул', en: 'Formula auditing'},
    'SSE.Views.SheetActions.textAnalysis': {ru: 'Анализ', en: 'Analysis'},
    /* "Format": "Rows, columns and sheet ▸" (was "Format cells… ▸": the name was invented by the shell), "Text ▸" (was
       "Superscript and subscript ▸"), "Alignment ▸" and "Indent ▸" (merged from "Increase indent · Decrease indent"). The names are
       new, en and de follow the meaning of the Russian. The captions of the children of "Text ▸" and "Alignment ▸" and "Wrap text" are
       the texts of the panel hints and lists (CompactToolbar) and the standard Toolbar.textSuperscript / textSubscript, without copies. */
    'SSE.Views.SheetActions.textRowsColsSheet': {ru: 'Строки, столбцы и лист', en: 'Rows, columns and sheet'},
    'SSE.Views.SheetActions.textText': {ru: 'Текст', en: 'Text'},
    /* The English name of the item "Alignment ▸" is Align (the original ONLYOFFICE name). */
    'SSE.Views.SheetActions.textAlign': {ru: 'Выравнивание', en: 'Align'},
    'SSE.Views.SheetActions.textIndent': {ru: 'Отступ', en: 'Indent'},
    /* "Format → Format cells" has its own item key: the former textFormatCells captioned the holder "Format cells… ▸", and its
       values in the other languages (de "Zellen formatieren…") are the caption of that holder. The name is as for the context menu item
       (SAME_AS_CONTEXT); there is no key in de - German shows the English default, as for the other new items. */
    'SSE.Views.SheetActions.textCellFormat': {ru: 'Форматировать ячейки', en: 'Format cells'}
};

test('new_names_as_listed', () => {
    const bad = [];
    EDITED_LANGS.forEach(l => {
        const now = readLocale(l).json;
        Object.keys(NEW).forEach(k => { if (now[k] !== NEW[k][l]) bad.push(l + ': «' + k + '» is «' + now[k] + '», the list says «' + NEW[k][l] + '»'); });
    });
    assert.deepEqual(bad, [], 'new names of the compact menu bar and toolbar');
});

/* The English names of the new and corrected items are the original
   ONLYOFFICE names, only Contents, Sheet, Rows, columns and sheet, Formula auditing, Analysis, Function list are our own; the case is
   as in ONLYOFFICE. A table row is what the item shows on screen: the key of its caption (for items with a stock caption - the standard key) and the
   English name. For the shell module keys the English JS default is the same name: in the other interface languages, German
   included, the new items show it. ru "Cell value ▸ · Top/Bottom ▸ - unchanged" - the en of these
   keys is standard (en_unchanged_names_as_stock). The negative control is the locale directory without the English edits (argument 1): Download, Views, Alignment, Keyboard
   shortcuts, Goal seek, Text wrapping. */
const ENGLISH_NAMES = [
    ['menu row', 'SSE.Views.SheetActions.textCollaboration', 'Collaboration'],
    ['File', 'SSE.Views.SheetActions.textDownload', 'Download as'],
    ['File', 'SSE.Views.SheetActions.textImport', 'Import'],
    ['File > Import', 'SSE.Views.DataTab.mniFromFile', 'From Local TXT/CSV'],
    ['File > Import', 'SSE.Views.DataTab.mniFromUrl', 'From TXT/CSV Web Address'],
    ['File > Import', 'SSE.Views.DataTab.mniFromXMLFile', 'From Local XML'],
    ['File', 'SSE.Views.SheetActions.textRename', 'Rename'],
    ['Edit', 'SSE.Views.SheetActions.textCut', 'Cut'],
    ['Edit', 'SSE.Views.SheetActions.textCopy', 'Copy'],
    ['Edit', 'SSE.Views.SheetActions.textPaste', 'Paste'],
    ['Edit', 'SSE.Views.SheetActions.textClear', 'Clear'],
    ['Edit > Clear', 'SSE.Views.Toolbar.txtClearAll', 'All'],
    ['Edit > Clear', 'SSE.Views.Toolbar.txtClearText', 'Contents'],
    ['Edit > Clear', 'SSE.Views.Toolbar.txtClearFormat', 'Format'],
    ['Edit > Clear', 'SSE.Views.Toolbar.txtClearComments', 'Comments'],
    ['Edit > Clear', 'SSE.Views.Toolbar.txtClearHyper', 'Links'],
    ['context menu', 'SSE.Views.DocumentHolder.txtClear', 'Clear'],
    ['context menu > Clear', 'SSE.Views.DocumentHolder.txtClearAll', 'All'],
    ['context menu > Clear', 'SSE.Views.DocumentHolder.txtClearText', 'Contents'],
    ['context menu > Clear', 'SSE.Views.DocumentHolder.txtClearFormat', 'Format'],
    ['context menu > Clear', 'SSE.Views.DocumentHolder.txtClearComments', 'Comments'],
    ['context menu > Clear', 'SSE.Views.DocumentHolder.txtClearHyper', 'Links'],
    ['View', 'SSE.Views.SheetActions.textZoom', 'Zoom'],
    ['View', 'SSE.Views.SheetActions.textShow', 'Show'],
    ['View > Show', 'SSE.Views.ViewTab.textGridlines', 'Gridlines'],
    ['View > Show', 'SSE.Views.ViewTab.textHeadings', 'Headings'],
    ['View > Show', 'SSE.Views.ViewTab.textZeros', 'Show Zeros'],
    ['View > Show', 'SSE.Views.SheetActions.textShowFormulas', 'Show formulas'],
    ['View', 'SSE.Views.SheetActions.textViewNormal', 'Normal'],
    ['View', 'SSE.Views.SheetActions.textViewPageLayout', 'Page layout'],
    ['View', 'SSE.Views.SheetActions.textViews', 'Sheet View'],
    ['View', 'SSE.Views.SheetActions.textHiddenSheets', 'Hidden sheets'],
    ['Insert', 'SSE.Views.SheetActions.textSheet', 'Sheet'],
    ['Insert, toolbar', 'SSE.Views.SheetActions.textFunction', 'Function'],
    ['Format', 'SSE.Views.SheetActions.textRowsColsSheet', 'Rows, columns and sheet'],
    ['Format', 'SSE.Views.SheetActions.textCellFormat', 'Format cells'],
    ['Format', 'SSE.Views.SheetActions.textText', 'Text'],
    ['Format > Text', 'SSE.Views.CompactToolbar.tipBold', 'Bold'],
    ['Format > Text', 'SSE.Views.CompactToolbar.tipItalic', 'Italic'],
    ['Format > Text', 'SSE.Views.CompactToolbar.tipUnderline', 'Underline'],
    ['Format > Text', 'SSE.Views.CompactToolbar.tipStrikeout', 'Strikethrough'],
    ['Format > Text', 'SSE.Views.Toolbar.textSuperscript', 'Superscript'],
    ['Format > Text', 'SSE.Views.Toolbar.textSubscript', 'Subscript'],
    ['Format', 'SSE.Views.SheetActions.textAlign', 'Align'],
    ['Format > Align', 'SSE.Views.CompactToolbar.textAlignLeft', 'Align left'],
    ['Format > Align', 'SSE.Views.CompactToolbar.textAlignCenter', 'Align center'],
    ['Format > Align', 'SSE.Views.CompactToolbar.textAlignRight', 'Align right'],
    ['Format > Align', 'SSE.Views.CompactToolbar.textAlignJust', 'Justified'],
    ['Format > Align', 'SSE.Views.CompactToolbar.textAlignTop', 'Align top'],
    ['Format > Align', 'SSE.Views.CompactToolbar.textAlignMiddle', 'Align middle'],
    ['Format > Align', 'SSE.Views.CompactToolbar.textAlignBottom', 'Align bottom'],
    ['Format', 'SSE.Views.CompactToolbar.tipWrap', 'Wrap text'],
    ['Format', 'SSE.Views.SheetActions.textIndent', 'Indent'],
    ['Format', 'SSE.Views.SheetActions.textClearFormat', 'Clear format'],
    ['Data', 'SSE.Views.SheetActions.textFormulas', 'Formulas'],
    ['Data > Formulas', 'SSE.Views.SheetActions.textCalcOptions', 'Calculation options'],
    ['Data > Formulas', 'SSE.Views.SheetActions.textFormulaAuditing', 'Formula auditing'],
    ['Data', 'SSE.Views.SheetActions.textAnalysis', 'Analysis'],
    ['Data > Analysis', 'SSE.Views.SheetActions.textGoalSeek', 'Goal Seek'],
    ['Data > Analysis', 'SSE.Views.SheetActions.textSolver', 'Solver'],
    ['Collaboration', 'SSE.Views.SheetActions.textProtection', 'Protection'],
    ['Help', 'SSE.Views.SheetActions.textShortcuts', 'Keyboard Shortcuts'],
    ['Help', 'SSE.Views.SheetActions.textFunctionList', 'Function list'],
    ['toolbar', 'SSE.Views.SheetActions.textPrint', 'Print'],
    ['toolbar tip', 'SSE.Views.CompactToolbar.tipCurrency', 'Accounting style'],
    ['toolbar tip', 'SSE.Views.CompactToolbar.tipFunction', 'Function']
];
const ENGLISH_AS_STOCK = ['Common.define.conditionalData.textValue', 'Common.define.conditionalData.textTop', 'Common.define.conditionalData.textBottom'];
test('en_names_as_onlyoffice', () => {
    const en = readLocale('en').json, bad = [];
    const shell = {};
    modules().forEach(mod => { const d = defaults(mod); Object.keys(d).forEach(p => { shell['SSE.Views.' + mod.name + '.' + p] = d[p]; }); });
    ENGLISH_NAMES.forEach(([where, key, want]) => {
        if (en[key] !== want) bad.push(where + ': «' + key + '» is «' + en[key] + '» in en.json, the table says «' + want + '»');
        if (key in shell && shell[key] !== want) bad.push(where + ': the English default of «' + key + '» is «' + shell[key] + '», the table says «' + want + '»');
    });
    assert.deepEqual(bad, [], 'English names');
});

/* ru "Cell value ▸ · Top/Bottom ▸" are edited only in Russian: the en of these keys is standard, as in the stock. */
test('en_unchanged_names_as_stock', () => {
    const en = readLocale('en').json, was = stock().json.en, bad = [];
    ENGLISH_AS_STOCK.forEach(key => { if (en[key] !== was[key]) bad.push('«' + key + '» is «' + en[key] + '» in en.json, the stock says «' + was[key] + '» (no changes)'); });
    assert.deepEqual(bad, [], 'English names kept as stock');
});

/* One command has one name in all places. The menu row items that repeat a command
   of the standard context menu ("Edit → Cut · Copy · Paste · Clear ▸" -
   the same actions as the items of the same name of the context menu) are named as its items - in every
   language, not only in the NEW table. The negative control is the locale directory of the branch base (argument 1): there are no keys. */
const SAME_AS_CONTEXT = {
    'SSE.Views.SheetActions.textCut': 'SSE.Views.DocumentHolder.txtCut',
    'SSE.Views.SheetActions.textCopy': 'SSE.Views.DocumentHolder.txtCopy',
    'SSE.Views.SheetActions.textPaste': 'SSE.Views.DocumentHolder.txtPaste',
    'SSE.Views.SheetActions.textClear': 'SSE.Views.DocumentHolder.txtClear',
    /* "Format → Format cells" - the context menu item is called the same:
       one command has one name. */
    'SSE.Views.SheetActions.textCellFormat': 'SSE.Views.DocumentHolder.txtCellFormat'
};
test('staple_names_as_context_menu', () => {
    const bad = [];
    EDITED_LANGS.forEach(l => {
        const now = readLocale(l).json;
        Object.keys(SAME_AS_CONTEXT).forEach(k => {
            const ctx = now[SAME_AS_CONTEXT[k]];
            if (typeof ctx !== 'string' || !ctx) bad.push(l + ': the context menu key ' + SAME_AS_CONTEXT[k] + ' is missing');
            else if (now[k] !== ctx) bad.push(l + ': «' + k + '» is «' + now[k] + '», the context menu says «' + ctx + '»');
        });
    });
    assert.deepEqual(bad, [], 'one command, one name');
});

/* Items whose command already has a standard name are called by it - in every language.
   "Zoom ▸" is the same command as the "Zoom" field of the "View" ribbon tab (ViewTab.textZoom: asc_setZoom);
   "Hidden sheets ▸" is the same as "Format cells → Show → Hidden sheets" of the ribbon (Toolbar.textSheets: show a sheet,
   asc_showWorksheet). The negative control is the locale directory of the branch base (argument 1): there are no keys. */
const SAME_AS_STOCK = {
    'SSE.Views.SheetActions.textZoom': 'SSE.Views.ViewTab.textZoom',
    'SSE.Views.SheetActions.textHiddenSheets': 'SSE.Views.Toolbar.textSheets',
    /* "Data → Analysis ▸ Solver" is the same command as the "Solver" button of the "Data" ribbon tab
       (DataTab.capSolver): the shell "Solver" is an error, in every language it is the standard name. */
    'SSE.Views.SheetActions.textSolver': 'SSE.Views.DataTab.capSolver',
    /* The ₽ of the panel is the same command as the ribbon "Accounting style" button (btnCurrencyStyle, its
       hint is Toolbar.tipDigStyleAccounting): in every language it is the standard name. */
    'SSE.Views.CompactToolbar.tipCurrency': 'SSE.Views.Toolbar.tipDigStyleAccounting'
};
test('staple_names_as_stock', () => {
    const bad = [];
    EDITED_LANGS.forEach(l => {
        const now = readLocale(l).json;
        Object.keys(SAME_AS_STOCK).forEach(k => {
            const stock = now[SAME_AS_STOCK[k]];
            if (typeof stock !== 'string' || !stock) bad.push(l + ': the stock key ' + SAME_AS_STOCK[k] + ' is missing');
            else if (now[k] !== stock) bad.push(l + ': «' + k + '» is «' + now[k] + '», the stock says «' + stock + '»');
        });
    });
    assert.deepEqual(bad, [], 'one command, one name');
});

/* The hint of a panel button whose command has a menu row item is the name of that item,
   in every language: the panel Σ is "Insert → Function ▸" (the same double Toolbar:btnInsertFormula; it was ru "Functions"). The negative
   control is the locale directory of the branch base (argument 1): ru "Functions" / Functions / Funktionen. */
const SAME_AS_MENU = {
    'SSE.Views.CompactToolbar.tipFunction': 'SSE.Views.SheetActions.textFunction'
};
test('toolbar_tips_as_menu', () => {
    const bad = [];
    EDITED_LANGS.forEach(l => {
        const now = readLocale(l).json;
        Object.keys(SAME_AS_MENU).forEach(k => {
            const menu = now[SAME_AS_MENU[k]];
            if (typeof menu !== 'string' || !menu) bad.push(l + ': the menu key ' + SAME_AS_MENU[k] + ' is missing');
            else if (now[k] !== menu) bad.push(l + ': «' + k + '» is «' + now[k] + '», the menu says «' + menu + '»');
        });
    });
    assert.deepEqual(bad, [], 'one command, one name');
});

/* A corrected label changes in all places of the spreadsheet editor, and the new name
   must fit in each. The keys "Clear ▸ Text" → "Contents" (CHANGED) are shown in exactly two standard "Clear"
   menus - the context one (DocumentHolderExt.pmiClear) and the ribbon one (Toolbar.btnClearStyle), at the item with the value
   Asc.c_oAscCleanOptions.Text; there is no other place where "Contents" would be wrong for them. A new use of the key in the spreadsheet editor
   code fails the case - its place must be checked against the key purpose. */
test('clear_text_key_only_in_clear_menus', () => {
    const APP = path.join(VIEW, '..');
    const uses = [];
    const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).forEach(d => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) return walk(p);
        if (!/\.js$/.test(d.name)) return;
        const src = fs.readFileSync(p, 'utf8');
        let at = src.indexOf('txtClearText');
        while (at >= 0) {
            const next = src.slice(at, at + 400);
            uses.push(path.relative(APP, p) + ' ' + (/value\s*:\s*Asc\.c_oAscCleanOptions\.Text\b/.test(next) ? 'Text' : 'other'));
            at = src.indexOf('txtClearText', at + 1);
        }
    });
    walk(APP);
    assert.deepEqual(uses.sort(), ['view/DocumentHolderExt.js Text', 'view/Toolbar.js Text'], 'places of «txtClearText» in the spreadsheet app');
});

/* The corrected ru "Cell value", ru "Top", ru "Bottom" and ru "items"
   (CHANGED) are shown only in conditional formatting rules, and the new name fits in each place:
   - conditionalData.textValue - the rule group by cell value (ru "Greater", ru "Less", ru "Between" …): the ribbon button menu (its mirror - the panel
     list and "Format → Conditional formatting ▸"), the right cell panel, the rules window - ru "Cell value";
   - textTop / textBottom - the same menu, panel, rules window (ru "Top/Bottom", the choice ru "Top" / ru "Bottom") and the rule manager
     (the rule name ru "Top 10", ru "Bottom 10%");
   - textItems (Toolbar, CellSettings) - only after "10" at top10 items without percent: ru "Top 10 items", ru "Bottom 10 items".
   A new use of the key in the spreadsheet editor code fails the case - its place must be checked against the key purpose. The negative control is a copy of the view directory with an extra
   use (argument 2). */
test('cond_keys_only_in_cond_rules', () => {
    const APP = path.join(VIEW, '..');
    const uses = [];
    const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).forEach(d => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) return walk(p);
        if (!/\.js$/.test(d.name)) return;
        const src = fs.readFileSync(p, 'utf8');
        const rel = path.relative(APP, p);
        for (const m of src.matchAll(/conditionalData\.(textValue|textTop|textBottom)\b/g)) uses.push(rel + ' ' + m[1]);
        for (const m of src.matchAll(/\bthis\.textItems\b/g)) {
            const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
            const ok = /conditionalData\.(textTop|textBottom)\s*\+\s*' 10 '\s*\+\s*this\.textItems\b/.test(line) &&
                /type:\s*Asc\.c_oAscCFType\.top10\b/.test(line) && /percent:\s*false\b/.test(line);
            uses.push(rel + ' textItems' + (ok ? '' : ' (other)'));
        }
    });
    walk(APP);
    const count = {};
    uses.forEach(u => { count[u] = (count[u] || 0) + 1; });
    assert.deepEqual(count, {
        'view/CellSettings.js textValue': 1, 'view/CellSettings.js textTop': 3, 'view/CellSettings.js textBottom': 3, 'view/CellSettings.js textItems': 2,
        'view/FormatRulesEditDlg.js textValue': 1, 'view/FormatRulesEditDlg.js textTop': 2, 'view/FormatRulesEditDlg.js textBottom': 2,
        'view/FormatRulesManagerDlg.js textBottom': 1, 'view/FormatRulesManagerDlg.js textTop': 1,
        'view/Toolbar.js textValue': 1, 'view/Toolbar.js textTop': 3, 'view/Toolbar.js textBottom': 3, 'view/Toolbar.js textItems': 2
    }, 'places of the conditional formatting keys in the spreadsheet app');
});

/* The corrected label fits in each place. ru "items" of the rule window (CHANGED: FormatRulesEditDlg.textItem) - only the
   choice of the top10 rule units after the number (ru "Top | 10 | items", the item with value 0; the second is ru "Percent"): the key in the spreadsheet editor code is
   exactly one place, cmbPercent of the rule window. A new use of the key fails the case - its place must be checked against the key purpose. The negative
   control is a copy of the view directory with an extra use (argument 2). */
test('rule_dialog_item_key_only_in_top10', () => {
    const APP = path.join(VIEW, '..');
    const uses = [];
    const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).forEach(d => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) return walk(p);
        if (!/\.js$/.test(d.name)) return;
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\bthis\.textItem\b/g)) {
            const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
            const around = src.slice(Math.max(0, m.index - 700), m.index);
            uses.push(path.relative(APP, p) + (/\{value:\s*0,\s*displayValue:\s*this\.textItem\}/.test(line) && /cmbPercent\s*=\s*new Common\.UI\.ComboBox/.test(around) ? ' top10 units' : ' (other)'));
        }
    });
    walk(APP);
    assert.deepEqual(uses, ['view/FormatRulesEditDlg.js top10 units'], 'places of «FormatRulesEditDlg.textItem» in the spreadsheet app');
});

/* The shared menu row reasons that the spreadsheet editor names are the shell own "Viewing" and the sheet protection: the text is in the menu row
   (Common.UI.Compact.MenuBar.textReason*), and the translation is the one the spreadsheet editor had. The locale is loaded as one language file, it does not add
   keys from en.json: where there is a former translation, the shared key carries it, otherwise the menu would speak with the English default of the
   menu row next to a translated panel. Where there is no former translation, there is no shared key either - we do not create new translations. */
const SHARED_REASONS = {
    'Common.UI.Compact.MenuBar.textReasonView': 'SSE.Views.CompactShell.textModeLockedView',
    'Common.UI.Compact.MenuBar.textReasonProtected': 'SSE.Views.SheetActions.textProtected'
};
test('shared_menu_reasons_keep_their_translations', () => {
    const files = fs.readdirSync(LOCALE).filter(f => /\.json$/.test(f)).sort();
    assert.ok(files.length >= 46, 'suspiciously few locales: ' + files.length);
    const bad = [];
    let carried = 0;
    files.forEach(f => {
        const json = JSON.parse(fs.readFileSync(path.join(LOCALE, f), 'utf8'));
        Object.keys(SHARED_REASONS).forEach(key => {
            const prior = json[SHARED_REASONS[key]];
            if (typeof prior === 'string' && prior.trim()) {
                carried++;
                if (json[key] !== prior) bad.push(f + ': «' + key + '» is «' + json[key] + '», the former translation is «' + prior + '»');
            } else if (key in json) {
                bad.push(f + ': «' + key + '» without a former translation');
            }
        });
    });
    assert.deepEqual(bad, [], 'shared menu reasons in the spreadsheet locales');
    EDITED_LANGS.concat('de').forEach(l => Object.keys(SHARED_REASONS).forEach(key =>
        assert.equal(typeof readLocale(l).json[key], 'string', l + ': ' + key + ' is missing')));
    assert.ok(carried >= 6, 'suspiciously few former translations: ' + carried);
});

/* The other languages, German included, are not changed: the new items show
   English text in them; the already translated texts of the compact interface and the standard items stay as they were. In the spreadsheet editor de.json every stock
   key is in place with its standard value; beyond the stock there are only the already translated texts of the shell modules (SSE.Views.<module>.*),
   there are no keys of the new items (NEW) (the loader does not read extra keys); the keys of the shared menu row reasons (SHARED_REASONS) are
   only with the former translation (shared_menu_reasons_keep_their_translations). The negative
   control is a locale directory with German keys and edits (argument 1). */
test('de_json_keeps_stock', () => {
    const was = stock().json.de, now = readLocale('de').json, diff = [];
    const shell = MODULES.map(name => 'SSE.Views.' + name + '.');
    Object.keys(was).forEach(k => { if (!(k in now)) diff.push('-' + k); else if (now[k] !== was[k]) diff.push('~' + k); });
    Object.keys(now).forEach(k => {
        if (k in was) return;
        if (k in SHARED_REASONS && now[k] === now[SHARED_REASONS[k]]) return;
        if (!shell.some(p => k.startsWith(p)) || k in NEW) diff.push('+' + k);
    });
    assert.deepEqual(diff.slice(0, 12), [], 'de.json differs from the stock release ' + STOCK + ' (' + diff.length + ')');
});

/* In the languages that are not edited (German and others) the new items show English text - the English default of the shell module.
   So the `text*`/`tip*` default of the shell modules is the same as en.json (for the new and corrected names -
   en_names_as_onlyoffice). The negative control is a view directory with the former defaults (argument 2): Download, Views, Alignment, Keyboard shortcuts,
   Goal seek, Text wrapping. */
test('defaults_are_english', () => {
    const en = readLocale('en').json, bad = [];
    modules().forEach(mod => Object.entries(defaults(mod)).forEach(([prop, v]) => {
        const key = 'SSE.Views.' + mod.name + '.' + prop;
        if (en[key] !== v) bad.push(key + ': default «' + v + '», en.json «' + en[key] + '»');
    }));
    assert.deepEqual(bad, [], 'English defaults of the shell modules');
});

/* "Format → Format cells" in German: the item caption is its own key, which is not in de.json, and German shows the English
   default Format cells, as for the other new items; the former key (de "Zellen formatieren…" - the caption of the holder "Format cells… ▸")
   does not caption the item. The negative control is a view directory with SheetActions.js from before the edit (argument 2). */
test('format_cells_item_in_german_is_the_english_default', () => {
    const sa = modules().find(m => m.name === 'SheetActions');
    assert.ok(sa, 'SheetActions.js is missing');
    const m = /\{k: 'formatCells', t: me\.((?:text|tip)[A-Za-z0-9_]*)/.exec(sa.src);
    assert.ok(m, '«Format → Format cells» is not found in the catalog');
    const key = 'SSE.Views.SheetActions.' + m[1], de = readLocale('de').json, d = defaults(sa)[m[1]];
    assert.equal(key in de, false, '«Format cells» is labelled by a key that de.json translates: ' + key + ' = «' + de[key] + '»');
    assert.equal(d, 'Format cells', 'the English default of «Format cells»: ' + d);
    assert.equal(readLocale('en').json[key], 'Format cells');
    assert.equal(readLocale('ru').json[key], 'Форматировать ячейки');
});

/* "View → Mode ▸" is expanded into "Normal · Page layout" right in "View": the menu no longer has the "Mode" caption - neither a default
   in SheetActions.js nor a key in any spreadsheet editor locale (the name "Mode" was invented by the shell, without a submenu it is not needed). The captions
   of the pair are the former keys textViewNormal and textViewPageLayout. */
test('no_mode_key_in_locales', () => {
    const key = 'SSE.Views.SheetActions.textMode';
    const sa = modules().find(m => m.name === 'SheetActions');
    assert.ok(sa, 'SheetActions.js is missing');
    assert.equal('textMode' in defaults(sa), false, 'SheetActions.textMode default is left');
    assert.equal(/\bme\.textMode\b/.test(sa.src), false, 'the catalog still labels an item by textMode');
    const files = fs.readdirSync(LOCALE).filter(f => /\.json$/.test(f));
    const left = files.filter(f => key in JSON.parse(fs.readFileSync(path.join(LOCALE, f), 'utf8')));
    assert.deepEqual(left, [], key + ' is left in locales');
    EDITED_LANGS.forEach(l => ['textViewNormal', 'textViewPageLayout'].forEach(k =>
        assert.ok(readLocale(l).json['SSE.Views.SheetActions.' + k], l + ': SSE.Views.SheetActions.' + k + ' is missing')));
});

/* Removed menu items need no captions in SheetActions.js or in the spreadsheet locales. */
test('no_labels_for_removed_file_menu_items', () => {
    const sa = modules().find(m => m.name === 'SheetActions');
    assert.ok(sa, 'SheetActions.js is missing');
    const d = defaults(sa);
    const files = fs.readdirSync(LOCALE).filter(f => /\.json$/.test(f));
    ['textAccessRights', 'textProtectPassword', 'textAdvancedUI'].forEach(name => {
        assert.equal(name in d, false, 'SheetActions.' + name + ' default is left');
        const key = 'SSE.Views.SheetActions.' + name;
        const left = files.filter(f => key in JSON.parse(fs.readFileSync(path.join(LOCALE, f), 'utf8')));
        assert.deepEqual(left, [], key + ' is left in locales');
    });
});

console.log(`${passed} passed, ${failed} failed` + (skipped ? `, ${skipped} skipped` : ''));
process.exitCode = failed ? 1 : 0;
