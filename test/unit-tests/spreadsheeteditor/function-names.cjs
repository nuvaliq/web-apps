/* Run: node test/unit-tests/spreadsheeteditor/function-names.cjs [path to controller/Toolbar.js] [path to view/FormulaTab.js]
 * The function names in the "Function Σ" list and in "Insert → Function ▸" are in the formula language:
 * "SUM · AVERAGE · MIN · MAX · COUNT - Insert function" with the Russian names when the formula language is Russian, and with
 * another language - all five names in that language. The stock did not translate the fifth function: the label translation loop ran up to Math.min(4, …), so
 * the list showed the localized names of the first four functions, while the fifth (COUNT) stayed English. The panel list and the menu row submenu mirror the stock menu of the ribbon
 * "Function" button (controller/Toolbar.js applyFormulaSettings - on load and on a formula language change, the
 * formula:settings notification), while the "Formula" tab of the Standard interface has its own "AutoSum" menu (view/FormulaTab.js fillFunctions).
 * The real text of both stock methods is checked on top of a fake menu and engine (asc_getFormulaLocaleName - the language dictionary).
 * The arguments are broken copies for the negative control: a copy with the old Math.min(4, …) must fail the case of its place.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const APP = path.join(ROOT, 'apps/spreadsheeteditor/main/app');
const TOOLBAR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(APP, 'controller/Toolbar.js');
const FORMULA_TAB = process.argv[3] ? path.resolve(process.argv[3]) : path.join(APP, 'view/FormulaTab.js');

/* A stock object method by name: "name: function (…) {…}" - the function text up to the matching brace. */
function readMethod(file, name) {
    const src = fs.readFileSync(file, 'utf8');
    const m = new RegExp('\\b' + name + '\\s*:\\s*function\\s*\\(').exec(src);
    assert.ok(m, name + ' not found in ' + path.relative(ROOT, file));
    const start = src.indexOf('function', m.index);
    let depth = 0, end = src.indexOf('{', start);
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    return src.slice(start, end + 1);
}

/* Function names by formula language (the stock resources/formula-lang/<language>.json). */
const LANG = {
    ru: {SUM: 'СУММ', AVERAGE: 'СРЗНАЧ', MIN: 'МИН', MAX: 'МАКС', COUNT: 'СЧЁТ'},
    de: {SUM: 'SUMME', AVERAGE: 'MITTELWERT', MIN: 'MIN', MAX: 'MAX', COUNT: 'ANZAHL'},
    en: {SUM: 'SUM', AVERAGE: 'AVERAGE', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT'}
};
const MORE = 'Insert function';

/* The button menu as the stock builds it (view/Toolbar.js btnInsertFormula, view/FormulaTab.js btnAutosum): five functions labeled
   in English, a separator, "Insert function" (value 'more'). getItems(true) - items without the "custom" ones (isCustomItem). */
function stockMenu() {
    const items = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].map(v => ({caption: v, value: v}))
        .concat([{caption: '--'}, {caption: MORE, value: 'more'}]);
    items.forEach(it => { it.setCaption = function (c) { this.caption = c; }; });
    return {items, getItems(exceptCustom) { return exceptCustom ? items.filter(i => !i.isCustomItem) : items; }};
}

function engine(lang) {
    const calls = [];
    return {calls, asc_getFormulaLocaleName(name) { calls.push(name); return LANG[lang][name] || name; }};
}

/* The end of the stock fillFunctions - the "More functions" lock without a submenu (Common.Utils.lockControls): here it is a journal entry. */
const locks = [];
const context = vm.createContext({Math, Common: {enumLock: {noSubitems: 'no-subitems'},
    Utils: {lockControls(cause, on, o) { locks.push([cause, on, o && o.array && o.array.length]); }}}});
const applyFormulaSettings = vm.runInContext('(' + readMethod(TOOLBAR, 'applyFormulaSettings') + ')', context);
const fillFunctions = vm.runInContext('(' + readMethod(FORMULA_TAB, 'fillFunctions') + ')', context);

const captions = menu => menu.items.map(i => i.caption);
const want = lang => ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].map(v => LANG[lang][v]).concat(['--', MORE]);

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, '—', error && error.message);
        failed++;
    }
}

/* The ribbon "Function" button is the source of the panel Σ list and of "Insert → Function ▸" (the mirrors): in every formula language all five
   names are translated, "Insert function" and the separator are left alone (the engine is asked about exactly five functions). */
test('toolbar_function_menu_all_five_in_formula_language', () => {
    for (const lang of ['ru', 'de', 'en']) {
        const menu = stockMenu(), api = engine(lang);
        applyFormulaSettings.call({toolbar: {btnInsertFormula: {rendered: true, menu}}, api});
        assert.deepEqual(captions(menu), want(lang), lang + ': the function list of the toolbar «Function» button');
        assert.deepEqual(api.calls, ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'], lang + ': the engine is asked about the five functions only');
    }
    /* A formula language change (formula:settings) - the labels are recalculated entirely. */
    const menu = stockMenu();
    applyFormulaSettings.call({toolbar: {btnInsertFormula: {rendered: true, menu}}, api: engine('de')});
    applyFormulaSettings.call({toolbar: {btnInsertFormula: {rendered: true, menu}}, api: engine('ru')});
    assert.deepEqual(captions(menu), want('ru'), 'after the formula language change from de to ru');
    /* The button is not on screen yet - nothing is touched (as in the stock). */
    const idle = stockMenu();
    applyFormulaSettings.call({toolbar: {btnInsertFormula: {rendered: false, menu: idle}}, api: engine('ru')});
    assert.deepEqual(captions(idle), ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', '--', MORE], 'an unrendered button got captions');
});

/* The "AutoSum" of the Standard interface "Formula" tab is the same menu of five functions: one command, one set of names. */
test('formula_tab_autosum_all_five_in_formula_language', () => {
    for (const lang of ['ru', 'de', 'en']) {
        const menu = stockMenu(), api = engine(lang);
        fillFunctions.call({formulasGroups: {}, api, btnAutosum: {menu}, btnMore: {menu: null}, setButtonMenu() {}, setMenuItemMenu() { return null; }});
        assert.deepEqual(captions(menu), want(lang), lang + ': the AutoSum list of the Formula tab');
        assert.deepEqual(api.calls, ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'], lang + ': the engine is asked about the five functions only');
    }
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
