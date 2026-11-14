/* Run: node test/unit-tests/spreadsheeteditor/cell-settings-borders.cjs [path to CellSettings.js] [path to CellSettings.template]
 * The "Borders" section of the right cell panel (view/CellSettings.js, template/CellSettings.template): a sample row with the caption
 * "Now: …" from the selection asc_getBorders(), under it "Draw" - line, color, hint and side buttons.
 * - The engine gave no borders (null - the standard engine, an object is selected) - the sample rows are hidden: no guessing "no borders".
 * - The sample is a cell SVG with its real sides: the style sets the thickness and dashing, the color is the side color (no color - black),
 *   a double border is a wide line with a gap, diagonals run from corner to corner; a side with style None has no side. An empty cell is only
 *   the grid.
 * - The caption names the sides in the order "left, top, right, bottom", all four are "on all sides", a diagonal goes last,
 *   none is "no borders".
 * - A language without the new phrases (de and others, except ru and en) shows the English view defaults and does not fail on an empty phrase; ru and
 *   en have their own phrases. The template prints "undefined" in no language.
 * - The template: the sample rows are hidden until the first data, the hint "Select borders…" sits between the line with the color and the side buttons.
 * CellSettings.js runs in vm for real (Backbone.View.extend returns the view description, jQuery is a stub of three nodes),
 * the locale overrides the view strings the same way as Common.Locale. The optional arguments are broken copies for the negative
 * control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));
const VIEW = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'apps/spreadsheeteditor/main/app/view/CellSettings.js');
const TEMPLATE = process.argv[3] ? path.resolve(process.argv[3])
    : path.join(ROOT, 'apps/spreadsheeteditor/main/app/template/CellSettings.template');
const LOCALE_DIR = path.join(ROOT, 'apps/spreadsheeteditor/main/locale');

/* sdkjs common/commonDefines.js — c_oAscBorderStyles. */
const S = {None: 0, Double: 1, Hair: 2, DashDotDot: 3, DashDot: 4, Dotted: 5, Dashed: 6, Thin: 7, MediumDashDotDot: 8,
    SlantDashDot: 9, MediumDashDot: 10, MediumDashed: 11, Medium: 12, Thick: 13};

let passed = 0, failed = 0;
function test(name, body) {
    try {
        body();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error && error.message);
        failed++;
    }
}

const locale = lang => JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, lang + '.json'), 'utf8'));
const LANGS = fs.readdirSync(LOCALE_DIR).filter(f => /\.json$/.test(f)).map(f => f.replace(/\.json$/, '')).sort();

/* Like Common.Locale.apply (common/locale.js): the key "A.B.C.name" puts the string on window.A.B.C before the modules load, and the module
   overrides its English defaults with it. */
function applyLocale(context, json) {
    for (const key of Object.keys(json)) {
        const p = key.split('.');
        if (p.length <= 2) continue;
        let obj = context;
        for (let i = 0; i < p.length - 1; i++) {
            if (obj[p[i]] === undefined) obj[p[i]] = {};
            obj = obj[p[i]];
        }
        obj[p[p.length - 1]] = json[key];
    }
}

/* The CellSettings view description in language lang (without a language - only the view defaults). String.format and getHexColor - as in
   common/main/lib/util/utils.js: format fails on an empty phrase the same way the real one does. */
function load(lang) {
    let described = null;
    const context = {
        console, _, SSE: {Views: {}}, Asc: {c_oAscBorderStyles: S},
        Backbone: {View: {extend: d => { described = d; return function () {}; }}},
        Common: {Utils: {
            String: {format: (format, ...args) => format.replace(/\{(\d+)\}/g, (s, i) => args[i])},
            ThemeColor: {getHexColor: (r, g, b) => [r, g, b].map(x => (x < 16 ? '0' : '') + x.toString(16)).join('')}
        }}
    };
    if (lang) applyLocale(context, locale(lang));
    context.define = (deps, factory) => factory(fs.readFileSync(TEMPLATE, 'utf8'), null, _, context.Backbone);
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(VIEW, 'utf8'), context, {filename: VIEW});
    assert.ok(described, 'the view did not describe itself through Backbone.View.extend');
    return described;
}

/* The panel above the view description: $el.find returns the sample rows (class hidden), the sample node (html) and the caption (text). */
function panel(described) {
    const st = {hidden: true, svg: null, text: null};
    const self = Object.create(described);
    self.$el = {find: sel => {
        if (sel === '.cell-borders-current')
            return {addClass: c => { if (c === 'hidden') st.hidden = true; }, removeClass: c => { if (c === 'hidden') st.hidden = false; }};
        if (sel === '#cell-borders-sample') return {html: v => { st.svg = v; }};
        if (sel === '#cell-borders-current-text') return {text: v => { st.text = v; }};
        throw new Error('unexpected selector ' + sel);
    }};
    return {show: b => self.updateCurrentBorders(b), st};
}

/* The engine asc_CBorders: a side is [style, [r, g, b]] or [style] (no color); no key - no side (null). */
function borders(o = {}) {
    const side = n => {
        if (!o[n]) return null;
        const [style, rgb] = o[n];
        return {asc_getStyle: () => style,
                asc_getColor: () => rgb ? {get_r: () => rgb[0], get_g: () => rgb[1], get_b: () => rgb[2]} : null};
    };
    return {asc_getLeft: () => side('left'), asc_getTop: () => side('top'), asc_getRight: () => side('right'),
            asc_getBottom: () => side('bottom'), asc_getDiagDown: () => side('diagDown'), asc_getDiagUp: () => side('diagUp')};
}

/* The sample lines: the attributes of each <line>. */
function lines(svg) {
    const out = [];
    String(svg).replace(/<line ([^>]*)>/g, (m, attrs) => {
        const a = {};
        attrs.replace(/([\w-]+)="([^"]*)"/g, (s, k, v) => { a[k] = v; });
        out.push(a);
    });
    return out;
}
const at = l => [l.x1, l.y1, l.x2, l.y2].join(',');

/* A 56×32 sample cell with an offset of 2: sides and diagonals run from corner to corner. */
const LEFT = '2,2,2,30', TOP = '2,2,54,2', RIGHT = '54,2,54,30', BOTTOM = '2,30,54,30', DIAG_DOWN = '2,2,54,30', DIAG_UP = '2,30,54,2';

test('no_engine_data_hides_the_sample', () => {
    const p = panel(load('en'));
    p.show(null);
    assert.deepEqual(p.st, {hidden: true, svg: null, text: null}, 'without engine data: rows hidden, nothing drawn or named');
    p.show(borders({bottom: [S.Thin]}));
    assert.equal(p.st.hidden, false, 'precondition: data shows the rows');
    p.show(null);
    assert.equal(p.st.hidden, true, 'engine data gone (an object selected): the rows hide again');
});

test('empty_cell_is_only_the_grid', () => {
    for (const [what, b] of [['no sides', borders()],
        ['sides of style None', borders({left: [S.None], top: [S.None], right: [S.None], bottom: [S.None], diagDown: [S.None], diagUp: [S.None]})]]) {
        const p = panel(load('en'));
        p.show(b);
        assert.equal(p.st.hidden, false, what + ': rows shown');
        assert.equal(p.st.text, 'Now: no borders', what + ': caption');
        assert.deepEqual(lines(p.st.svg), [], what + ': lines drawn');
        assert.match(p.st.svg, /<rect class="grid" x="2" y="2" width="52" height="28">/, what + ': the dashed grid cell');
    }
});

test('sample_draws_the_actual_sides', () => {
    const p = panel(load('en'));
    p.show(borders({left: [S.Thin], top: [S.Thin], right: [S.Thin], bottom: [S.Thin]}));
    assert.deepEqual(lines(p.st.svg).map(l => [at(l), l.stroke, l['stroke-width'], l['stroke-dasharray'] || null]),
        [[LEFT, '#000000', '1', null], [TOP, '#000000', '1', null], [RIGHT, '#000000', '1', null], [BOTTOM, '#000000', '1', null]],
        'four thin sides without a color: black, 1px, solid');
    assert.equal(p.st.text, 'Now: on all sides', 'four sides caption');

    p.show(borders({bottom: [S.Medium, [255, 0, 0]]}));
    assert.deepEqual(lines(p.st.svg).map(l => [at(l), l.stroke, l['stroke-width']]), [[BOTTOM, '#ff0000', '2']], 'medium red bottom');
    assert.equal(p.st.text, 'Now: bottom', 'one side caption');

    p.show(borders({left: [S.Dashed, [0, 0, 255]], top: [S.Dotted], diagDown: [S.Thin, [128, 0, 128]]}));
    assert.deepEqual(lines(p.st.svg).map(l => [at(l), l.stroke, l['stroke-dasharray'] || null]),
        [[LEFT, '#0000ff', '3 1'], [TOP, '#000000', '1 2'], [DIAG_DOWN, '#800080', null]], 'dashed, dotted and a diagonal');
    assert.equal(p.st.text, 'Now: left, top, diagonal', 'sides in order, the diagonal last');

    p.show(borders({bottom: [S.Double]}));
    assert.deepEqual(lines(p.st.svg).map(l => [at(l), l['stroke-width'], l.class || null]), [[BOTTOM, '3', null], [BOTTOM, '1', 'gap']],
        'double: a wide line with a gap line over it');

    p.show(borders({left: [S.Thick], top: [S.Thick], right: [S.Thick], bottom: [S.Thick], diagUp: [S.Hair]}));
    assert.deepEqual(lines(p.st.svg).map(l => [at(l), l['stroke-width']]),
        [[LEFT, '3'], [TOP, '3'], [RIGHT, '3'], [BOTTOM, '3'], [DIAG_UP, '1']], 'thick sides and the diagonal up');
    assert.equal(p.st.text, 'Now: on all sides, diagonal', 'all sides and a diagonal');

    p.show(borders({right: [S.MediumDashDot], top: [S.None]}));
    assert.deepEqual(lines(p.st.svg).map(l => [at(l), l['stroke-width'], l['stroke-dasharray']]), [[RIGHT, '2', '6 2 2 2']],
        'a side of style None is not drawn');
    assert.equal(p.st.text, 'Now: right', 'a side of style None is not named');
});

test('captions_follow_the_language', () => {
    const cases = [
        ['ru', 'Сейчас: со всех сторон', 'Сейчас: нет границ', 'Сейчас: слева, снизу, по диагонали'],
        ['en', 'Now: on all sides', 'Now: no borders', 'Now: left, bottom, diagonal'],
        /* There are no new phrases in de - the English view defaults. */
        ['de', 'Now: on all sides', 'Now: no borders', 'Now: left, bottom, diagonal']
    ];
    for (const [lang, all, none, some] of cases) {
        const p = panel(load(lang));
        p.show(borders({left: [S.Thin], top: [S.Thin], right: [S.Thin], bottom: [S.Thin]}));
        assert.equal(p.st.text, all, lang + ': four sides');
        p.show(borders());
        assert.equal(p.st.text, none, lang + ': no sides');
        p.show(borders({left: [S.Thin], bottom: [S.Thin], diagUp: [S.Thin]}));
        assert.equal(p.st.text, some, lang + ': some sides and a diagonal');
    }
});

test('every_language_shows_the_section', () => {
    const broken = [];
    for (const lang of LANGS) {
        try {
            const described = load(lang);
            const html = described.template({scope: described});
            if (/undefined/.test(html)) broken.push(lang + ': «undefined» in the panel markup');
            const p = panel(described);
            p.show(borders({left: [S.Thin], diagDown: [S.Thin]}));
            if (!p.st.text || /undefined/.test(p.st.text)) broken.push(lang + ': caption «' + p.st.text + '»');
        } catch (e) {
            broken.push(lang + ': ' + e.message);
        }
    }
    assert.ok(LANGS.length >= 40, 'precondition: the locales are read: ' + LANGS.length);
    assert.deepEqual(broken, [], 'languages where the borders section breaks');
});

test('template_order_and_hidden_sample', () => {
    const described = load('ru');
    const html = described.template({scope: described});
    const pos = s => html.indexOf(s);
    const order = ['Границы', 'id="cell-borders-sample"', 'Нарисовать', 'id="cell-combo-border-type"', 'id="cell-border-color-btn"',
        'Выберите границы, к которым надо применить выбранный стиль', 'id="cell-button-border-all"'];
    assert.deepEqual(order.filter(s => pos(s) < 0), [], 'parts missing from the section');
    assert.deepEqual(order.slice().sort((a, b) => pos(a) - pos(b)), order, 'order of the section parts');
    assert.equal((html.match(/<tr class="cell-borders-current hidden">/g) || []).length, 2,
        'the sample row and its separator are hidden until the engine reports the borders');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
