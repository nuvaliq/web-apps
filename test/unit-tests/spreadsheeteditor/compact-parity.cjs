/* Run: node test/unit-tests/spreadsheeteditor/compact-parity.cjs [spreadsheet editor CompactShell.js] [spreadsheet editor compact-shell.less] [spreadsheet editor CompactToolbar.js]
 * The own values of the spreadsheet editor shell ("Rows"): the row heights H_* in JS and their @vo-h-* pairs in LESS, the sum of the
 * rows 168 (header, menu row and card: the panel and the formula bar) and the own colors (the panel card, the row and column headers, the cell selection). The shared
 * tokens and menu row rules of the spreadsheet editor come from the shared layer (apps/common/main/resources/less/compact:
 * tokens.less, menu.less; app.less includes them before compact-shell.less), the spreadsheet editor declares the values in
 * their own file. So the LESS is not compared with Documents: Documents have their own values of the same
 * variables. What is the spreadsheet editor's own is listed by name in INTENDED with a reason; the list is exact. The spreadsheet editor menu row
 * metrics are the former numbers (from before the shared layer) on the built layer in headless Chrome (playwright: NODE_PATH
 * or PLAYWRIGHT_MODULE, CHROMIUM_PATH); the same place checks that the shared rules draw the group variant dot,
 * the "…" of a narrow window and the status slot. Only the color palette and the panel zoom list
 * (JS) are compared with Documents: one and the same surface in two editors.
 * The arguments are broken copies of the spreadsheet editor for the negative control: a copy with H_TB_GAP_TOP 8,
 * a copy with a card of the wrong tone, a copy with the header colors not under body.vo-compact (or of the wrong
 * tone), a copy without them, a copy of compact-shell.less with its own menu row rules or with other
 * row metrics.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const layer = require('./lib/compact-less.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const SSE_JS = process.argv[2] ? path.resolve(process.argv[2])
    : path.join(ROOT, 'apps/spreadsheeteditor/main/app/view/CompactShell.js');
const SSE_LESS = process.argv[3] ? path.resolve(process.argv[3])
    : path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/compact-shell.less');
const SSE_TB = process.argv[4] ? path.resolve(process.argv[4])
    : path.join(ROOT, 'apps/spreadsheeteditor/main/app/view/CompactToolbar.js');
const DE_TB = path.join(ROOT, 'apps/documenteditor/main/app/view/CompactToolbar.js');

/* What the checks read: parity_checks_own_values_only asserts that no Documents
   stylesheet is read. */
const READS = [];
const read = f => { READS.push(path.resolve(f)); return fs.readFileSync(f, 'utf8'); };

/* The spreadsheet editor's own values that Documents do not have: the key is the runtime token "--vo-name", the value is
   why. The top view, the header and cell selection colors; the spreadsheet editor has no other own tokens. */
const INTENDED = {
    /* The spreadsheet editor top view: the spreadsheet editor's own variables, the shared tokens are not touched.
       The header has no variables of its own - it is white, as in Documents. */
    '--vo-tb-plate': 'панель таблиц — плашка без заливки: фон шапки (= --vo-shell-bg) и обводка ' +
        'design-outline-stroke, без тени; у документов — белая карточка с тенью на сером поле',
    /* The row and column header colors: the spreadsheet editor's own variables
       that CompactShell.applyCanvasSkin substitutes into the engine skin instead of the theme colors
       canvas-cell-title-*; Documents have no headers. */
    '--vo-cell-title-hover': 'наведение на заголовок — ступень голубой палитры blue-25 (#deedff) ' +
        'вместо серого штатного; рисует движок (drawHighlightedHeaders), оболочка его не перерисовывает',
    '--vo-cell-title-selected': 'заголовки текущей ячейки и выделенного столбца — tinted ' +
        'accent-soft-blue-2 (#e6f4ff), без серого; «меню открыто» своего цвета нет',
    '--vo-cell-title-border-hover': 'рамка наведённого заголовка — в тон: штатная рамка заголовков ' +
        '(у заголовка одна рамка во всех состояниях), а не серая штатная рамка наведения',
    '--vo-cell-title-border-selected': 'рамка выделенного заголовка — в тон, как у наведённого: серая ' +
        'штатная рамка выделения на голубом выглядела бы серым пятном',
    '--vo-cell-title-chevron': 'шеврон меню столбца на подсветке заголовка — роль design-tinted-content-chevron: ' +
        'в светлой теме tinted подписи, в тёмной — тёмного контекста AIR (accent-main-link #468bec)',
    /* The cell selection color: the spreadsheet editor's own variable that CompactShell.pushSkin puts into the engine
       sheet settings (activeCellBorderColor); Documents have no cell selection. */
    '--vo-cell-selection': 'рамка активной ячейки и диапазона, заливка 15 % и черты подсвеченных заголовков — ' +
        'design-selection-content вместо тёмно-зелёного цвета движка; у документов выделения ячеек нет'
};


/* The header colors: own variable → value. Declared only under
   body.vo-compact: the Standard and the early start skeleton (vo-boot) are standard. The theme variables
   (--canvas-*) are not overridden at all: the standard Themes caches the computed theme colors in
   localStorage ('ui-theme') and lays them out with the theme class on the next load - so
   an override would leak into the Standard and into sessions without the shell. The header letter,
   the normal background and the normal border are standard: the engine has one letter color for all states. */
const TITLE = {
    '--vo-cell-title-hover': '#deedff',
    '--vo-cell-title-selected': '#e6f4ff',
    '--vo-cell-title-border-hover': 'var(--canvas-cell-title-border)',
    '--vo-cell-title-border-selected': 'var(--canvas-cell-title-border)',
    '--vo-cell-title-chevron': 'var(--vo-tinted-fg)'
};
const TITLE_SELECTOR = 'body.vo-compact';
const isTitle = name => /^--vo-cell-title-/.test(name);
/* The cell selection color: own variable → value. Only under body.vo-compact: in the Standard and on the
   skeleton the engine has the standard color. The value is a palette token, not an own literal. */
const SELECTION = {
    '--vo-cell-selection': 'var(--vo-selected-fg)'
};
const SELECTION_SELECTOR = 'body.vo-compact';
const isSelection = name => name in SELECTION;
/* The dark theme: the engine draws the headers dark and the letters light
   (one color for all states), and the blue steps of the light palette gave the letters 1.2:1. The same
   dark context roles of AIR: hover - accent-soft-blue-1, current/selected -
   accent-soft-blue-2 (design-tinted-bg). The borders are the same "tone on tone" ones from the light block. */
const TITLE_DARK_SELECTOR = 'body.vo-compact.theme-type-dark';
const TITLE_DARK = {
    '--vo-cell-title-hover': '#0e294b',
    '--vo-cell-title-selected': '#062040',
    '--vo-cell-title-chevron': '#468bec'
};
/* The header letters in the standard themes (common/main/resources/less/colors-table-*.less):
   light themes - to the light compact colors, dark ones - to the dark ones. */
const THEMES = path.join(ROOT, 'apps/common/main/resources/less');
const LIGHT_THEMES = ['colors-table-white.less', 'colors-table-classic.less', 'colors-table-gray.less'];
const DARK_THEMES = ['colors-table-dark.less', 'colors-table-dark-contrast.less'];
const themeVar = (file, name) => {
    const m = new RegExp(name + ':\\s*(#[0-9a-f]{3,6})\\s*;', 'i').exec(read(path.join(THEMES, file)));
    assert.ok(m, file + ': ' + name + ' not found');
    return m[1];
};
const luminance = hex => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/* The top view: variable → value. The panel card background is the shared header background token --vo-shell-bg
   (bg-content-primary), not an own literal; the outline comes from the shell outline-button recipe.
   There are no header variables - it is white. */
const TOP_LOOK = {
    '--vo-tb-plate': 'var(--vo-shell-bg)'
};
/* The early start skeleton is drawn with the same colors - the variables are declared on it too. */
const TOP_LOOK_SELECTORS = ['body.vo-compact', 'body.vo-boot'];

/* A token block is `body.vo-<state>` or its dark variant. */
const tokenBlock = sel => /^body\.vo-[\w-]+(\.theme-type-dark)?$/.test(sel);

/* The rows above the grid from top to bottom: the JS name, the LESS pair and the spreadsheet editor's own value -
   46 + 30 + 4 + 44 + 36 + 8 = 168: header, menu row and card (gap, panel, formula bar,
   gap). */
const ROWS = [
    {js: 'H_HEADER', less: 'vo-h-header', px: 46},
    {js: 'H_MENU', less: 'vo-h-menu', px: 30},
    {js: 'H_TB_GAP_TOP', less: 'vo-tb-gap-top', px: 4},
    {js: 'H_TOOLBAR', less: 'vo-h-toolbar', px: 44},
    {js: 'H_FORMULA', less: 'vo-h-formula', px: 36},
    {js: 'H_TB_GAP', less: 'vo-tb-gap', px: 8}
];

/* The H_* numbers from JS: `var H_HEADER = 46, H_MENU = 30, ...`, `var H_TB_GAP = 8;`. */
function jsHeights(src) {
    const out = {};
    for (const m of src.matchAll(/\b(H_[A-Z][A-Z_]*)\s*=\s*(\d+)/g)) {
        assert.ok(!(m[1] in out), m[1] + ' declared twice');
        out[m[1]] = Number(m[2]);
    }
    return out;
}

/* The row arithmetic: only names, numbers, + and * with parentheses. */
function evaluate(expr, lookup) {
    const flat = expr.replace(/@?[A-Za-z_][\w-]*/g, name => {
        const v = lookup(name);
        assert.ok(typeof v === 'number' && isFinite(v), 'unknown term ' + name + ' in "' + expr + '"');
        return String(v);
    });
    assert.ok(/^[\d\s+*().]+$/.test(flat), 'unexpected expression "' + expr + '"');
    return Function('return (' + flat + ');')();
}

/* The shell rows in JS: `var ROWS = [{name: 'header', height: H_HEADER}, …];`. */
function jsRows(src, H) {
    const m = /var\s+ROWS\s*=\s*\[([\s\S]*?)\];/.exec(src);
    assert.ok(m, 'CompactShell.js: ROWS not found');
    return [...m[1].matchAll(/\{\s*name:\s*'(\w+)',\s*height:\s*([^}]+?)\s*\}/g)]
        .map(r => ({name: r[1], expr: r[2].trim(), height: evaluate(r[2], n => H[n])}));
}

/* LESS without comments. `//` is cut only as a comment, not inside `url(http://…)`. */
function stripLess(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n').map(l => l.replace(/(^|[^:"'])\/\/.*$/, '$1')).join('\n');
}

/* The top-level `@vo-*` variables (a value may span several lines),
   the top-level `selector { … }` blocks with their `--vo-*` declarations and the bodies of all
   rules by selector (for targeted checks like the card margin). */
function parseLess(src) {
    const text = stripLess(src);
    const vars = {}, blocks = [];
    let depth = 0, buf = '', selector = null, body = '';
    for (const ch of text) {
        if (ch === '{') {
            if (depth === 0) { selector = buf.trim(); body = ''; buf = ''; }
            else body += ch;
            depth++;
            continue;
        }
        if (ch === '}') {
            depth--;
            if (depth === 0) { blocks.push({selector, body}); buf = ''; }
            else body += ch;
            continue;
        }
        if (depth === 0) {
            if (ch === ';') {
                const m = /^@(vo-[\w-]+)\s*:\s*([\s\S]+)$/.exec(buf.trim());
                if (m) {
                    assert.ok(!(m[1] in vars), '@' + m[1] + ' declared twice');
                    vars[m[1]] = m[2].replace(/\s+/g, ' ').trim();
                }
                buf = '';
            } else buf += ch;
        } else body += ch;
    }
    const props = {};
    blocks.forEach(b => {
        const decls = {};
        for (const m of b.body.matchAll(/(?:^|[;{\s])(--vo-[\w-]+)\s*:\s*([^;{}]+);/g)) decls[m[1]] = m[2].replace(/\s+/g, ' ').trim();
        if (!Object.keys(decls).length) return;
        b.selector.split(',').map(s => s.replace(/\s+/g, ' ').trim()).forEach(sel => {
            props[sel] = Object.assign(props[sel] || {}, decls);
        });
    });
    return {vars, props, blocks};
}

function sides() {
    return {sseH: jsHeights(read(SSE_JS)), sse: parseLess(read(SSE_LESS))};
}

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

/* The rows are the spreadsheet editor's own values, and in each editor JS ↔ LESS go as a pair: the shell reserves
   space by JS and draws itself by LESS - if they diverge, the panel and the canvas stop fitting together. */
test('parity_rows_are_own_values_paired_with_less', () => {
    const s = sides();
    ROWS.forEach(row => {
        assert.equal(s.sseH[row.js], row.px, 'spreadsheets ' + row.js);
        assert.equal(s.sse.vars[row.less], row.px + 'px', 'spreadsheets: ' + row.js + ' and @' + row.less + ' are not a pair');
    });
});

test('parity_top_gap_4_bottom_8_total_168', () => {
    const s = sides();
    const H = s.sseH;
    assert.equal(H.H_TB_GAP_TOP, 4, 'gap above the toolbar');
    assert.equal(H.H_TB_GAP, 8, 'gap below the toolbar');
    assert.equal(s.sse.vars['vo-tb-gap-top'], '4px');
    assert.equal(s.sse.vars['vo-tb-gap'], '8px');
    assert.equal(ROWS.reduce((sum, r) => sum + H[r.js], 0), 168, 'rows above the grid');

    /* The rows the shell reserves in the layout (ROWS in CompactShell.js): the card is
       4 + 44 + 36 + 8 = 92 (the panel and the collapsed formula bar under it), 168 together. */
    const rows = jsRows(read(SSE_JS), H);
    assert.deepEqual(rows.map(r => r.name), ['header', 'menu', 'plate'], 'shell rows');
    assert.deepEqual(rows.map(r => r.height), [46, 30, 92], 'shell row heights: ' + rows.map(r => r.expr).join(' | '));
    assert.equal(rows.reduce((sum, r) => sum + r.height, 0), 168);

    /* @vo-h-shell is a sum of terms, not a literal: it follows them by itself. */
    const shell = s.sse.vars['vo-h-shell'];
    assert.ok(shell, '@vo-h-shell not found');
    const terms = (shell.match(/@[\w-]+/g) || []).sort();
    assert.deepEqual(terms, ROWS.map(r => '@' + r.less).sort(), '@vo-h-shell is not the sum of the rows: ' + shell);
    assert.ok(!/\d/.test(shell.replace(/@[\w-]+/g, '')), '@vo-h-shell has literals: ' + shell);
    assert.equal(evaluate(shell, n => parseFloat(s.sse.vars[n.slice(1)])), 168, '@vo-h-shell');

    /* The card: its own gap on top, the one shared with Documents at the bottom; the panel row has no padding of its own. */
    const margins = sel => s.sse.blocks.filter(b => b.selector === sel)
        .map(b => (/(?:^|[;{\s])margin\s*:\s*([^;]+);/.exec(b.body) || [])[1]).filter(Boolean)
        .map(v => v.replace(/\s+/g, ' ').trim());
    assert.deepEqual(margins('#vo-plate'), ['@vo-tb-gap-top @vo-pad-x @vo-tb-gap'], '#vo-plate margin');
    assert.deepEqual(margins('#vo-tb'), [], '#vo-tb has its own margin inside the plate');
});

/* The spreadsheet editor top view is its own variables, each in INTENDED with a reason, with its own value,
   on vo-compact and on the vo-boot skeleton; each works in a rule outside the token blocks
   (declared and unused is not a view but garbage). */
test('parity_top_look_listed_as_intended', () => {
    const s = sides();
    const rules = s.sse.blocks.filter(b => !b.selector.split(',').every(x => tokenBlock(x.replace(/\s+/g, ' ').trim())))
        .map(b => b.body).join('\n');
    Object.keys(TOP_LOOK).forEach(name => {
        assert.ok(name in INTENDED && INTENDED[name].trim().length > 10, name + ' is not listed in INTENDED with a reason');
        TOP_LOOK_SELECTORS.forEach(sel => assert.equal((s.sse.props[sel] || {})[name], TOP_LOOK[name], sel + ' ' + name));
        Object.keys(s.sse.props).filter(sel => !TOP_LOOK_SELECTORS.includes(sel)).forEach(sel =>
            assert.ok(!(name in s.sse.props[sel]), name + ' is also declared under ' + sel));
        const alias = Object.keys(s.sse.vars).find(v => s.sse.vars[v] === 'var(' + name + ')');
        const used = rules.includes('var(' + name + ')') || (!!alias && new RegExp('@' + alias + '(?![\\w-])').test(rules));
        assert.ok(used, name + ' is declared but no rule uses it' + (alias ? ' (alias @' + alias + ')' : ''));
    });
    assert.deepEqual(Object.keys(INTENDED).filter(k => /^--vo-/.test(k) && !isTitle(k) && !isSelection(k)).sort(), Object.keys(TOP_LOOK).sort(),
        'top look entries of INTENDED');
});

/* The row and column header colors - only under body.vo-compact, with their own values
   (hover blue-25, the current
   column tinted, one header border in all states), exactly these four. The Standard (vo-advanced) and the skeleton (vo-boot) are
   standard: there are no variables at all. No theme variable (--canvas-*) is
   overridden by the spreadsheet editor - the stock theme cache would carry it out of the compact. */
test('title_colors_only_under_vo_compact', () => {
    const s = sides();
    const theme = [...stripLess(read(SSE_LESS)).matchAll(/(?:^|[;{\s])(--canvas-[\w-]+)\s*:/g)].map(m => m[1]);
    assert.deepEqual(theme, [], 'theme variables overridden by the spreadsheet shell (they leak through the ui-theme cache)');
    const where = Object.keys(s.sse.props).filter(sel => Object.keys(s.sse.props[sel]).some(isTitle));
    assert.deepEqual(where, [TITLE_SELECTOR, TITLE_DARK_SELECTOR], 'header colours are declared under ' + JSON.stringify(where));
    const mine = {}, dark = {};
    Object.keys(s.sse.props[TITLE_SELECTOR]).filter(isTitle).forEach(n => { mine[n] = s.sse.props[TITLE_SELECTOR][n]; });
    Object.keys(s.sse.props[TITLE_DARK_SELECTOR]).filter(isTitle).forEach(n => { dark[n] = s.sse.props[TITLE_DARK_SELECTOR][n]; });
    assert.deepEqual(mine, TITLE, 'header colours');
    assert.deepEqual(dark, TITLE_DARK, 'header colours in the dark theme');
    /* Letters on a highlighted header - no less than 4.5:1 (WCAG AA) in each standard theme. */
    [[LIGHT_THEMES, TITLE], [DARK_THEMES, TITLE_DARK]].forEach(([files, colours]) => files.forEach(file => {
        const text = themeVar(file, '--canvas-cell-title-text');
        ['--vo-cell-title-hover', '--vo-cell-title-selected'].forEach(n => {
            const k = contrast(text, colours[n]);
            assert.ok(k >= 4.5, file + ': letters ' + text + ' on ' + n + ' ' + colours[n] + ' — ' + k.toFixed(2) + ':1 < 4.5:1');
        });
    }));
    /* The column menu chevron sits on the same highlight: a glyph is not text, it needs no less than 3:1
       (WCAG 1.4.11) in the light and dark theme (the light tinted #0154c8 on the dark
       highlight gave 2.2-2.4:1). The chevron rule color is this variable. */
    const resolve = (v, sel) => { const m = /^var\((--[\w-]+)\)$/.exec(v); return m ? s.sse.props[sel][m[1]] : v; };
    [[TITLE_SELECTOR, TITLE], [TITLE_DARK_SELECTOR, TITLE_DARK]].forEach(([sel, colours]) => {
        const chev = resolve(colours['--vo-cell-title-chevron'], sel);
        assert.ok(/^#[0-9a-f]{6}$/i.test(chev), sel + ': chevron colour ' + chev + ' is not a palette value');
        ['--vo-cell-title-hover', '--vo-cell-title-selected'].forEach(n => {
            const k = contrast(chev, colours[n]);
            assert.ok(k >= 3, sel + ': column chevron ' + chev + ' on ' + n + ' ' + colours[n] + ' — ' + k.toFixed(2) + ':1 < 3:1');
        });
    });
    const chevRule = /\.vo-colh-chev\s*\{([^}]*)\}/.exec(stripLess(read(SSE_LESS)));
    assert.ok(chevRule && /(?:^|;)\s*color:\s*@vo-cell-title-chevron\s*;/.test(chevRule[1]),
        'the column chevron is not painted with --vo-cell-title-chevron: ' + (chevRule && chevRule[1].replace(/\s+/g, ' ')));
    assert.ok(/@vo-cell-title-chevron:\s*var\(--vo-cell-title-chevron\)\s*;/.test(stripLess(read(SSE_LESS))), '@vo-cell-title-chevron alias');
    /* The block shares its selector with nothing but the compact: in the Standard and on the skeleton - the stock. */
    s.sse.blocks.filter(b => b.body.match(/--canvas-cell-title-/)).forEach(b => {
        const sels = b.selector.split(',').map(x => x.replace(/\s+/g, ' ').trim());
        assert.deepEqual(sels, [TITLE_SELECTOR], 'header colours share the block with ' + JSON.stringify(sels));
    });
});

test('parity_cell_title_colors_listed', () => {
    const s = sides();
    const listed = Object.keys(INTENDED).filter(isTitle).sort();
    assert.deepEqual(listed, Object.keys(TITLE).sort(), 'header colour entries of INTENDED');
    listed.forEach(k => {
        assert.ok(INTENDED[k].trim().length > 10, k + ': no reason given');
        assert.ok(k in (s.sse.props[TITLE_SELECTOR] || {}), k + ' is listed in INTENDED but the stylesheet does not declare it');
    });
});

/* The cell selection color: only under body.vo-compact. The value is a palette token
   that resolves to hex. The border and the line sit on the white sheet and on the highlight of the selected
   header - no less than 3:1 against both (a state indicator, WCAG 1.4.11). The declared variable
   is read by the shell: its name is in CompactShell.js. */
test('cell_selection_colour_only_under_vo_compact', () => {
    const s = sides();
    const where = Object.keys(s.sse.props).filter(sel => Object.keys(s.sse.props[sel]).some(isSelection));
    assert.deepEqual(where, [SELECTION_SELECTOR], 'selection colour is declared under ' + JSON.stringify(where));
    Object.keys(SELECTION).forEach(name => {
        const value = s.sse.props[SELECTION_SELECTOR][name];
        const ref = /^var\((--[\w-]+)\)$/.exec(value || '');
        const hex = ref ? s.sse.props[SELECTION_SELECTOR][ref[1]] : value;
        assert.ok(/^#[0-9a-f]{6}$/i.test(hex || ''), name + ': ' + value + ' does not resolve to a palette value (' + hex + ')');
        [['white sheet', '#ffffff'], ['selected header', TITLE['--vo-cell-title-selected']]].forEach(([what, bg]) => {
            const k = contrast(hex, bg);
            assert.ok(k >= 3, name + ' ' + hex + ' on the ' + what + ' ' + bg + ' — ' + k.toFixed(2) + ':1 < 3:1');
        });
        assert.equal(value, SELECTION[name], name);
        assert.ok(read(SSE_JS).includes("'" + name + "'"), name + ' is declared but CompactShell.js does not read it');
    });
    assert.deepEqual(Object.keys(INTENDED).filter(isSelection), Object.keys(SELECTION), 'selection entries of INTENDED');
});

/* The color palette and the panel zoom list are the numbers of the Documents compact: one
   and the same surface in two editors. Values are compared, not text. */
function paletteOf(src, file) {
    const m = /var\s+PALETTE_STAGE\s*=\s*(\[[\s\S]*?\]);/.exec(src);
    assert.ok(m, path.basename(file) + ': PALETTE_STAGE not found');
    return JSON.parse(m[1].replace(/'/g, '"'));
}
function zoomsOf(src, file) {
    const m = /var\s+ZOOMS\s*=\s*(\[[^\]]*\]);/.exec(src);
    assert.ok(m, path.basename(file) + ': ZOOMS not found');
    return JSON.parse(m[1]);
}

test('parity_palette_matches_documents', () => {
    const sse = read(SSE_TB), de = read(DE_TB);
    const a = paletteOf(sse, SSE_TB), b = paletteOf(de, DE_TB);
    assert.equal(b.length, 6, 'documents palette rows');
    b.forEach(row => assert.equal(row.length, 14, 'documents palette columns'));
    assert.deepEqual(a, b, 'palette of spreadsheets differs from documents');
    assert.deepEqual(zoomsOf(sse, SSE_TB), zoomsOf(de, DE_TB), 'zoom list of spreadsheets differs from documents');
});

/* The spreadsheet editor menu row is the shared rules (menu.less) on the spreadsheet editor values: app.less includes
   tokens.less and menu.less before compact-shell.less, and compact-shell.less has no menu row rules
   of its own. The spreadsheet editor owns only the column header menu (#vo-colh-menu), the counter in the menu row
   (vo-mn-step, CompactMenuAdapter.drawStepper) and the former item description look (OWN_MENU_RULES): the shared
   layer does not have them, nor a variable for the description. */
const OWN_MENU_RULES = ['body.vo-compact .vo-mn .vo-mn-d'];
const SHARED_MENU = path.join(ROOT, 'apps/common/main/resources/less/compact/menu.less');
test('spreadsheet_menu_rules_come_from_the_shared_layer', () => {
    const names = layer.imports().map(l => (/\/([\w-]+\.less)";$/.exec(l) || /"([\w-]+\.less)";$/.exec(l) || [])[1]);
    const at = n => names.indexOf(n);
    assert.ok(at('tokens.less') >= 0 && at('menu.less') > at('tokens.less') && at('compact-shell.less') > at('menu.less'),
        'app.less does not import tokens.less and menu.less before compact-shell.less: ' + JSON.stringify(names));
    const top = src => parseLess(src).blocks.map(b => b.selector.replace(/\s+/g, ' ').trim());
    const shared = new Set(top(read(SHARED_MENU)).filter(sel => !/^@media/.test(sel)));
    const own = top(read(SSE_LESS));
    assert.deepEqual(own.filter(sel => shared.has(sel)), [], 'spreadsheets keep a copy of the shared menu rules');
    assert.deepEqual(own.filter(sel => /\.vo-mn(?![\w-])|\.vo-mn-/.test(sel) && !/#vo-colh-menu|\.vo-mn-step/.test(sel) && !OWN_MENU_RULES.includes(sel)), [],
        'spreadsheets keep own menu bar rules');
});

/* The checks of this file compare the spreadsheet editor's own values, not Documents values: no Documents
   stylesheet is read; from Documents only the panel (palette and zoom). The own INTENDED
   tokens are exactly the top view, the header and cell selection colors. */
test('parity_checks_own_values_only', () => {
    const docs = [...new Set(READS.filter(f => f.startsWith(path.join(ROOT, 'apps/documenteditor') + path.sep)))];
    assert.deepEqual(docs, [DE_TB], 'documents files read by the parity checks');
    assert.deepEqual(Object.keys(INTENDED).sort(), Object.keys(Object.assign({}, TOP_LOOK, TITLE, SELECTION)).sort(),
        'own tokens of INTENDED');
});

/* --- The spreadsheet editor menu row on the built layer, headless Chrome ---------------------------------- */
/* The layer is as in app.less (lib/compact-less.cjs), compact-shell.less is from the argument. The global
   bootstrap rule (* { box-sizing: border-box }) is as on the application page. The markup is of the shared
   menu row (Common.UI.Compact.MenuBar): a section with an open list, a submenu in the row, the "…" of a narrow
   window and the status slot; in the list - an item with a glyph and a shortcut, a checkbox with a mark, an item with ▸,
   a separator, a group with a title and a ● variant, an item with a description. */
const chromeTests = [];
const chromeTest = (name, fn) => chromeTests.push([name, fn]);
let page = null, CSS = '';

const MENU_PAGE = () => `<style>* { box-sizing: border-box; } ${CSS}</style>
<body class="theme-light theme-type-light vo-compact" style="margin:0">
<div id="vo-shell" style="width:1200px">
  <div class="vo-mn" role="menubar">
    <div class="vo-mn-wrap" id="w-file"><button class="vo-mn-item" type="button">File</button>
      <div class="vo-mn-drop open" role="menu" data-level="0">
        <button class="vo-mn-sub" id="r-plain" type="button"><span class="vo-mn-i"></span><span class="vo-mn-t">Save</span><span class="vo-mn-h">Ctrl+S</span></button>
        <button class="vo-mn-sub" id="r-check" type="button"><span class="vo-mn-i"></span><span class="vo-mn-t">Gridlines</span><span class="vo-mn-h">X</span><span class="vo-mn-chk"></span></button>
        <button class="vo-mn-sub vo-has-sub" id="r-sub" type="button"><span class="vo-mn-i"></span><span class="vo-mn-t">Freeze</span><span class="vo-mn-arrow"></span></button>
        <div class="vo-mn-sep" id="r-sep"></div>
        <div class="vo-mn-grp" role="group"><span class="vo-mn-grp-t" id="r-grp" aria-hidden="true">Mode</span>
          <button class="vo-mn-sub" id="r-radio" type="button" role="menuitemradio" aria-checked="true"><span class="vo-mn-i"></span><span class="vo-mn-t">Normal</span><span class="vo-mn-chk vo-mn-dot" id="r-dot"></span></button>
        </div>
        <button class="vo-mn-sub vo-has-desc" id="r-desc" type="button"><span class="vo-mn-tc"><span class="vo-mn-t">Strict</span><span class="vo-mn-d" id="r-d">Changes of the other users are shown only after you save your own changes</span></span></button>
      </div>
    </div>
    <div class="vo-mn-wrap"><button class="vo-mn-item" type="button">Edit</button><div class="vo-mn-drop" role="menu"></div></div>
    <div class="vo-mn-wrap vo-mn-more" id="w-more"><button class="vo-mn-item" type="button">…</button></div>
    <span class="vo-mn-status" id="st-text">Saving the changes of the workbook to the portal storage</span>
    <span class="vo-mn-status" id="st-empty"></span>
    <div class="vo-mn-drop vo-mn-fly open" id="fly" role="menu" data-level="1" style="top:40px;left:300px">
      <button class="vo-mn-sub" type="button"><span class="vo-mn-t">Top row</span></button>
    </div>
  </div>
</div>
<span id="p-accent" style="color: var(--vo-accent)"></span><span id="p-off" style="color: var(--vo-text-off)"></span>
</body>`;

/* The former spreadsheet editor menu row metrics (their rules from before the shared layer): row height 30 with a 10 padding
   at the bottom and captions on a 20 line, the section button 20 with a padding of 8, the list - an offset of 5 from the button and
   a shift of 4, width from 214, padding 10, rounding 18, the ceiling - the window without the header, the row and 8; the list
   row 36 with padding 18 and a gap of 9, font size 14; glyph 16; shortcut 11 at 12 from the caption, the mark at 6
   from the shortcut, ▸ at 12; separator 1 with 8 of air; the group title - the row height, on the caption
   line, in the shortcut font size; an item with a description - padding 8 top and bottom, the description (as in the stock,
   lib/view/ReviewChanges.js) - no wider than 220, 2 lines under the caption, line height 1.3: the list width is set by the
   item rows, a long description wraps; a submenu - the ceiling is the window without 8. */
const BEFORE = {
    bar: {h: 30, padL: '12px', padR: '12px', padB: '10px', gap: '6px'},
    item: {h: 20, padL: '8px', padR: '8px', radius: '6px', fs: '13px'},
    drop: {dy: 25, dx: -4, minW: '214px', padT: '10px', padB: '10px', radius: '18px', z: '1000', ceiling: 84},
    row: {h: 36, padL: '18px', padR: '18px', gap: '9px', fs: '14px'},
    glyph: {w: 16, h: 16},
    hint: {ml: '12px', fs: '11px'},
    mark: {ml: '6px'},
    arrow: {ml: '12px'},
    sep: {h: 1, mt: '8px', mb: '8px'},
    grp: {h: 36, padL: '18px', fs: '11px'},
    desc: {padT: '8px', padB: '8px', maxW: '220px', mt: '2px', lh: '14.3px', w: 178, dropW: 214},
    fly: {ceiling: 8}
};

/* The menu page; the lists' appearance (vo-pop: scale from .96) has finished playing - the final look is measured. */
async function stage() {
    await page.setContent(MENU_PAGE());
    await page.evaluate(() => document.getAnimations().forEach(a => a.finish()));
}

async function menuLook() {
    await stage();
    return page.evaluate(() => {
        const $ = s => document.querySelector(s), cs = s => getComputedStyle($(s)), box = s => $(s).getBoundingClientRect();
        const bar = cs('.vo-mn'), item = cs('#w-file > .vo-mn-item'), drop = cs('#w-file > .vo-mn-drop'), row = cs('#r-plain');
        const d = box('#w-file > .vo-mn-drop'), w = box('#w-file');
        return {
            bar: {h: box('.vo-mn').height, padL: bar.paddingLeft, padR: bar.paddingRight, padB: bar.paddingBottom, gap: bar.columnGap},
            item: {h: box('#w-file > .vo-mn-item').height, padL: item.paddingLeft, padR: item.paddingRight, radius: item.borderTopLeftRadius, fs: item.fontSize},
            drop: {dy: Math.round(d.top - w.top), dx: Math.round(d.left - w.left), minW: drop.minWidth, padT: drop.paddingTop,
                padB: drop.paddingBottom, radius: drop.borderTopLeftRadius, z: drop.zIndex, ceiling: innerHeight - parseFloat(drop.maxHeight)},
            row: {h: box('#r-plain').height, padL: row.paddingLeft, padR: row.paddingRight, gap: row.columnGap, fs: row.fontSize},
            glyph: {w: box('#r-plain .vo-mn-i').width, h: box('#r-plain .vo-mn-i').height},
            hint: {ml: cs('#r-plain .vo-mn-h').marginLeft, fs: cs('#r-plain .vo-mn-h').fontSize},
            mark: {ml: cs('#r-check .vo-mn-chk').marginLeft},
            arrow: {ml: cs('#r-sub .vo-mn-arrow').marginLeft},
            sep: {h: box('#r-sep').height, mt: cs('#r-sep').marginTop, mb: cs('#r-sep').marginBottom},
            grp: {h: box('#r-grp').height, padL: cs('#r-grp').paddingLeft, fs: cs('#r-grp').fontSize},
            desc: {padT: cs('#r-desc').paddingTop, padB: cs('#r-desc').paddingBottom, maxW: cs('#r-d').maxWidth, mt: cs('#r-d').marginTop,
                lh: cs('#r-d').lineHeight, w: Math.round(box('#r-d').width), dropW: Math.round(d.width)},
            fly: {ceiling: innerHeight - parseFloat(cs('#fly').maxHeight)}
        };
    });
}

chromeTest('spreadsheet_menu_metrics_stay_as_before', async () => {
    const look = await menuLook();
    Object.keys(BEFORE).forEach(part => assert.deepEqual(look[part], BEFORE[part], 'menu ' + part + ': ' + JSON.stringify(look[part])));
});

/* What the spreadsheet editor gets from the shared rules beyond the former (the shared row behavior that the spreadsheet editor accepts along with it): the ● dot on the selected
   group variant - a circle 6 in the mark color in the place of 16; the status slot - muted text 11 on one
   line with an ellipsis, no narrower than 160 with text, an empty one takes no space; the sections and "…" do not shrink -
   when width is short, a section goes into "…". */
chromeTest('spreadsheet_menu_draws_the_shared_dot_overflow_and_status', async () => {
    await stage();
    const got = await page.evaluate(() => {
        const $ = s => document.querySelector(s), cs = (s, p) => getComputedStyle($(s), p);
        const dot = cs('#r-dot'), before = cs('#r-dot', '::before'), st = cs('#st-text'), more = $('#w-more > .vo-mn-item');
        return {
            dot: {display: dot.display, w: $('#r-dot').getBoundingClientRect().width, h: $('#r-dot').getBoundingClientRect().height,
                content: before.content, bw: before.width, bh: before.height, radius: before.borderTopLeftRadius, bg: before.backgroundColor,
                accent: cs('#p-accent').color},
            status: {fs: st.fontSize, color: st.color, off: cs('#p-off').color, minW: st.minWidth, overflow: st.overflowX,
                ellipsis: st.textOverflow, nowrap: st.whiteSpace, emptyMinW: cs('#st-empty').minWidth, emptyW: $('#st-empty').getBoundingClientRect().width},
            wraps: [...document.querySelectorAll('.vo-mn > .vo-mn-wrap')].map(w => getComputedStyle(w).flexShrink),
            more: {h: more.getBoundingClientRect().height, fs: getComputedStyle(more).fontSize}
        };
    });
    assert.deepEqual([got.dot.display, got.dot.w, got.dot.h], ['flex', 16, 16], 'radio mark place: ' + JSON.stringify(got.dot));
    assert.deepEqual([got.dot.content, got.dot.bw, got.dot.bh, got.dot.radius], ['""', '6px', '6px', '50%'], 'radio dot: ' + JSON.stringify(got.dot));
    assert.equal(got.dot.bg, got.dot.accent, 'the radio dot is not the mark colour');
    assert.deepEqual([got.status.fs, got.status.minW, got.status.overflow, got.status.ellipsis, got.status.nowrap],
        ['11px', '160px', 'hidden', 'ellipsis', 'nowrap'], 'status place: ' + JSON.stringify(got.status));
    assert.equal(got.status.color, got.status.off, 'the status text is not muted');
    assert.deepEqual([got.status.emptyMinW, got.status.emptyW], ['0px', 0], 'an empty status takes room');
    assert.deepEqual(got.wraps, ['0', '0', '0'], 'sections or «…» shrink instead of moving to «…»');
    assert.deepEqual([got.more.h, got.more.fs], [20, '13px'], '«…» is not a section button');
});

(async () => {
    let chromium;
    try { ({chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
    catch (e) { throw new Error('playwright is not available (set NODE_PATH or PLAYWRIGHT_MODULE): ' + e.message); }
    const less = require(path.join(ROOT, 'build/node_modules/less'));
    CSS = (await less.render(layer.source(SSE_LESS), {filename: layer.APP_LESS, globalVars: {'app-image-const-path': '"resources/img"'}})).css;
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    try {
        page = await (await browser.newContext({viewport: {width: 1280, height: 600}})).newPage();
        for (const [name, fn] of chromeTests) {
            try {
                await fn();
                console.log('PASS', name);
                passed++;
            } catch (error) {
                console.error('FAIL', name, '—', error && error.message);
                failed++;
            }
        }
    } finally {
        await browser.close();
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
