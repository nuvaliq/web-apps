/* Run: node test/unit-tests/spreadsheeteditor/icons-air.cjs [root of another tree]
 * The spreadsheet editor shell icons are the shared AIR set of the editors: the module common/main/lib/view/compact/Icons.js
 * and the files apps/common/main/resources/img/air/<name>.svg. The spreadsheet editor has no icon module of their own; their own
 * resources/img/air folder holds only what the shared set lacks (OWN_AIR in CompactToolbar.js:
 * "123" - outline/digits123 AIR as is, a plain percent sign, the decimal places ".0 ←" and ".00 →"), and
 * the panel helper airGlyph draws them with the same mask. Every other name requested by the shell views and
 * its menu is in the shared list and drawn from its own file, otherwise Icons.svg() silently returns an empty string,
 * and a mask without a file is an empty spot without an error. The default size of the shared set is 24, for the spreadsheet editor it was 18:
 * the spreadsheet editor calls pass the size explicitly.
 *
 * The icons the shared set did not have were moved from the former spreadsheet editor set byte for byte
 * (fixtures/former-air-set.json - the git object identifiers of its files); the spreadsheet editor names whose drawing
 * the shared set already had under another name were replaced by that name - the files are the same byte for byte.
 *
 * Icons.js runs in vm for real; the views are read as text, compact-shell.less - as text and
 * as a styles layer build, as in app.less (lib/compact-less.cjs, less from build/node_modules).
 * The optional argument is the root of another tree (a check of the red baseline).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const HERE = path.resolve(__dirname, '../../..');
const ROOT = path.resolve(process.argv[2] || HERE);
const APP = path.join(ROOT, 'apps/spreadsheeteditor/main');
const VIEW_DIR = path.join(APP, 'app/view');
const ICONS = path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js');
const AIR_DIR = path.join(ROOT, 'apps/common/main/resources/img/air');
const OWN_ICONS = path.join(VIEW_DIR, 'Icons.js');
const OWN_AIR_DIR = path.join(APP, 'resources/img/air');
const LESS = path.join(APP, 'resources/less/compact-shell.less');
const TOOLBAR = path.join(VIEW_DIR, 'CompactToolbar.js');
const DIGITS123_AIR = '2f65128f6722e430b79d51fae8377f5afbd29337';
const BASE = 'http://stand.test/web-apps/apps/spreadsheeteditor/main/index.html';

/* The former spreadsheet editor set (apps/spreadsheeteditor/main/resources/img/air before the move): icon name →
   the git object identifier of the file (SHA-1 of "blob <length>\0" and the bytes). Recorded so that the check does not depend on the
   clone history: neither rewritten branch commits nor a shallow clone invalidate it. */
const FORMER = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/former-air-set.json'), 'utf8')).files;
const objectId = buf => crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
/* The spreadsheet editor icons the shared set did not have: the files were moved as is. */
const ADDED = ['borders', 'chevronR', 'condfmt', 'copy', 'currency', 'cut', 'fill', 'filter', 'freeze', 'minus', 'paste',
    'percent', 'plus', 'rotate', 'sort', 'sum', 'validate', 'valignT'];
/* The former spreadsheet editor name → the shared set name: the drawing is the same. */
const RENAMED = {decDown: 'rtl', decUp: 'ltr', mergeCells: 'merge', review: 'rename', valignB: 'caption', valignM: 'alignC',
    wrap: 'hyphen', check: 'checkMenu'};

let passed = 0, failed = 0, skipped = 0;
function report(name, error) {
    if (!error) { console.log('PASS', name); passed++; return; }
    if (error.skip) { console.log('SKIP', name, '—', error.message); skipped++; return; }
    console.error('FAIL', name, '—', error.message);
    failed++;
}
const tests = [];
const test = (name, body) => tests.push([name, body]);
const skip = message => Object.assign(new Error(message), {skip: true});

const read = file => fs.readFileSync(file, 'utf8');
const exists = file => { try { fs.accessSync(file); return true; } catch (e) { return false; } };
const iconsSource = read(ICONS);
const lessSource = exists(LESS) ? read(LESS) : '';

/* The AIR list - as text from the literal `var AIR = {...}`: it is not visible from outside the module. */
function airNames() {
    const m = /var\s+AIR\s*=\s*\{([^}]*)\}/.exec(iconsSource);
    assert.ok(m, 'Icons.js: the AIR list literal is found');
    return Array.from(m[1].replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*1\b/g), x => x[1]);
}

/* The spreadsheet editor's own set - as text from the literal `var OWN_AIR = {...}` of CompactToolbar.js. */
function ownNames() {
    const m = /var\s+OWN_AIR\s*=\s*\{([^}]*)\}/.exec(read(TOOLBAR));
    assert.ok(m, 'CompactToolbar.js: the OWN_AIR list literal is found');
    return Array.from(m[1].matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*1\b/g), x => x[1]);
}

function loadIcons() {
    let factory = null;
    const sandbox = {define: (deps, f) => { factory = f; }, document: {baseURI: BASE}, URL};
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(iconsSource, sandbox, {filename: ICONS});
    assert.equal(typeof factory, 'function', 'Icons.js defines an AMD module');
    return factory();
}

/* The set files - by an exact directory listing: on macOS existsSync does not distinguish case, while the Linux
   build does. */
const airFiles = () => fs.readdirSync(AIR_DIR).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4));

const viewFiles = () => fs.readdirSync(VIEW_DIR).filter(f => f.endsWith('.js'))
    .map(f => ({file: f, text: read(path.join(VIEW_DIR, f))}));

/* The @vo-* variables as text, without comments. */
function lessVars(src) {
    const out = {};
    const text = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of text.matchAll(/^@(vo-[\w-]+)\s*:\s*([^;]+);/gm)) out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
    return out;
}

const NAME = /'([A-Za-z][A-Za-z0-9]*)'/g;

/* The icon names requested by the shell views:
   - the item keys `i:`, `ic:`, `icon:`, `glyph:` in the panel, menu and list catalogs;
   - the first argument of the icon helpers: Icons.svg / Icons.has, the local svg() and icon(), the methods
     iconBtn(), dropBtn(), popItem(). All literals of the first argument - this also catches
     `Icons.svg(open ? 'chevronL' : 'outline')`;
   - the values of the GLYPHS table of the column header menu (ColumnHeaderMenu.js);
   - the second argument of button('up'|'down', …) of the submenu steps. */
function requestedNames() {
    const found = new Map();
    const add = (name, where) => { if (!found.has(name)) found.set(name, where); };
    viewFiles().forEach(({file, text}) => {
        text.split('\n').forEach((line, i) => {
            const where = file + ':' + (i + 1);
            for (const m of line.matchAll(/(?:^|[^A-Za-z0-9_$])(?:i|ic|icon|glyph)\s*:\s*'([A-Za-z][A-Za-z0-9]*)'/g))
                add(m[1], where);
            for (const m of line.matchAll(/(?:Icons\.(?:svg|has)|(?:^|[^A-Za-z0-9_$.])(?:svg|icon)|\b(?:iconBtn|dropBtn|popItem))\(\s*([^,()]*)/g))
                for (const n of m[1].matchAll(NAME)) add(n[1], where);
            for (const m of line.matchAll(/\bbutton\(\s*'(?:up|down)'\s*,\s*'([A-Za-z][A-Za-z0-9]*)'/g))
                add(m[1], where);
        });
        if (file === 'ColumnHeaderMenu.js') {
            const g = /var\s+GLYPHS\s*=\s*\{([^}]*)\}/.exec(text);
            assert.ok(g, 'ColumnHeaderMenu.js: the GLYPHS table is found');
            for (const n of g[1].matchAll(/:\s*'([A-Za-z][A-Za-z0-9]*)'/g)) add(n[1], file + ' GLYPHS');
        }
    });
    return found;
}

/* The Icons.svg( … ) calls of the views: the argument text up to the matching parenthesis. */
function svgCalls() {
    const out = [];
    viewFiles().forEach(({file, text}) => {
        for (const m of text.matchAll(/\b(?:Icons\.svg|airGlyph)\(/g)) {
            let depth = 1, j = m.index + m[0].length;
            while (j < text.length && depth) { if (text[j] === '(') depth++; else if (text[j] === ')') depth--; j++; }
            const args = text.slice(m.index + m[0].length, j - 1);
            let d = 0, top = 0;
            for (const ch of args) { if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--; else if (ch === ',' && !d) top++; }
            out.push({where: file + ':' + text.slice(0, m.index).split('\n').length, args: args.replace(/\s+/g, ' '), sized: top >= 1});
        }
    });
    return out;
}

/* --- The set is shared ------------------------------------------------------------------- */

test('every_spreadsheet_icon_name_exists_in_the_shared_set', () => {
    const names = new Set(airNames()), files = new Set(airFiles()), own = new Set(ownNames());
    const requested = requestedNames();
    /* The probe is not empty: it has names from every way of requesting, moved and replaced, and the spreadsheet editor's own names. */
    ['currency', 'fill', 'borders', 'merge', 'alignC', 'caption', 'hyphen', 'condfmt', 'freeze',
     'digits123', 'percentSign', 'decimalDecrease', 'decimalIncrease',
     'checkMenu', 'rename', 'panel', 'cut', 'copy', 'paste', 'minus', 'plus', 'settings', 'save', 'spell', 'symbol', 'shape',
     'textbox', 'toolbar', 'case', 'indentIn']
        .forEach(name => assert.ok(requested.has(name), 'the probe sees ' + name));
    assert.ok(requested.size > 60, 'requested names: ' + requested.size);
    const missing = [], noFile = [];
    requested.forEach((where, name) => {
        if (own.has(name)) return;
        if (!names.has(name)) missing.push(name + ' (' + where + ')');
        else if (!files.has(name)) noFile.push(name + ' (' + where + ')');
    });
    assert.deepEqual(missing, [], 'requested icons outside the shared AIR list');
    assert.deepEqual(noFile, [], 'requested icons without a shared file');
    /* The former spreadsheet editor names are no longer requested by anyone: the shared set does not have them. */
    assert.deepEqual(Object.keys(RENAMED).filter(n => requested.has(n)).map(n => n + ' (' + requested.get(n) + ')'), [],
        'old spreadsheet icon names are still asked for');
    /* The checkmark of the selected one is checkMenu; the name check was left by the shared set for the checkbox checkmark of windows. */
    assert.ok(!names.has('check'), 'the shared list got a check of its own');
});

test('every_spreadsheet_icon_name_is_drawn_by_the_shared_module', () => {
    const Icons = loadIcons(), own = new Set(ownNames());
    requestedNames().forEach((where, name) => {
        if (own.has(name)) return;
        const html = Icons.svg(name, 18);
        assert.ok(html.indexOf('class="vo-air"') > 0, name + ' is not an AIR mask (' + where + '): ' + html);
        assert.ok(html.indexOf('/web-apps/apps/common/main/resources/img/air/' + name + '.svg)') > 0, name + ' is not a shared file: ' + html);
    });
});

/* The moved icons are files of the former spreadsheet editor set byte for byte; the replaced names are the same
   drawing under the shared set name. */
test('added_icons_are_the_spreadsheet_files_and_renamed_ones_the_same_drawing', () => {
    const former = Object.keys(FORMER);
    assert.equal(former.length, 133, 'files of the former spreadsheet set: ' + former.length);
    const same = (file, name) => exists(file) && objectId(fs.readFileSync(file)) === FORMER[name];
    const names = new Set(airNames());
    const diff = [];
    ADDED.forEach(name => {
        const own = path.join(AIR_DIR, name + '.svg');
        if (!(name in FORMER)) diff.push(name + ': not in the former set');
        else if (!names.has(name)) diff.push(name + ': not in the list');
        else if (!same(own, name)) diff.push(name + ': differs');
    });
    Object.keys(RENAMED).forEach(old => {
        const own = path.join(AIR_DIR, RENAMED[old] + '.svg');
        if (!(old in FORMER)) diff.push(old + ': not in the former set');
        else if (!same(own, old)) diff.push(old + ' → ' + RENAMED[old] + ': differs');
    });
    assert.deepEqual(diff, [], 'shared files against the former spreadsheet set');
    /* The other spreadsheet editor icons were in the shared set under the same name and with the same bytes. */
    const rest = former.filter(n => !ADDED.includes(n) && !(n in RENAMED));
    assert.equal(rest.length, 107, 'same-name spreadsheet icons: ' + rest.length);
    const other = rest.filter(n => !same(path.join(AIR_DIR, n + '.svg'), n));
    assert.deepEqual(other, [], 'same-name icons differ from the shared files');
});

/* The icons of the borders menu items: AIR has no drawings, nor the closest in meaning - the shared set files are the standard icons of the same
   items (img/toolbar/2.5x: the build does not put them into img, they go into the ribbon sprite) byte for byte. Name → the suffix of the standard
   file btn-border-<suffix>.svg. The SheetActions glyph table gives each standard icon class a copy of its own file. */
const BORDER_GLYPHS = {borderBottom: 'bottom', borderTop: 'top', borderLeft: 'left', borderRight: 'right', borderNone: 'no',
    borderAll: 'all', borderOuter: 'out', borderInner: 'inside', borderInnerH: 'insidehor', borderInnerV: 'insidevert',
    borderStyle: 'style'};
const STOCK_ICON_DIR = path.join(ROOT, 'apps/common/main/resources/img/toolbar/2.5x');

test('border_glyphs_are_the_stock_icons_byte_for_byte', () => {
    const names = new Set(airNames()), files = new Set(airFiles()), requested = requestedNames();
    const want = Object.keys(BORDER_GLYPHS);
    assert.equal(want.length, 11, 'border glyphs: ' + want.length);
    const bad = [];
    want.forEach(name => {
        const stock = path.join(STOCK_ICON_DIR, 'btn-border-' + BORDER_GLYPHS[name] + '.svg');
        if (!names.has(name)) bad.push(name + ': not in the AIR list');
        if (!requested.has(name)) bad.push(name + ': the probe does not see it asked for');
        if (!files.has(name)) bad.push(name + ': no file ' + name + '.svg');
        else if (!exists(stock)) bad.push(name + ': no stock file ' + path.relative(ROOT, stock));
        else if (!fs.readFileSync(path.join(AIR_DIR, name + '.svg')).equals(fs.readFileSync(stock)))
            bad.push(name + ': differs from ' + path.relative(ROOT, stock));
    });
    assert.deepEqual(bad, [], 'border glyphs against the stock icons');
    /* The names are requested by the SheetActions glyph table: the standard icon class → a copy of the same standard file. */
    const table = read(path.join(VIEW_DIR, 'SheetActions.js'));
    const pairs = Array.from(table.matchAll(/\{\s*stock:\s*'btn-border-([a-z]+)',\s*glyph:\s*'([A-Za-z0-9]+)'\s*\}/g), m => m[2] + '=' + m[1]);
    assert.deepEqual(pairs.sort(), want.map(n => n + '=' + BORDER_GLYPHS[n]).sort(), 'SheetActions glyph table: class → its own stock drawing');
    /* Negative control of the byte comparison: neighboring standard drawings differ. */
    assert.ok(!fs.readFileSync(path.join(AIR_DIR, 'borderBottom.svg')).equals(fs.readFileSync(path.join(STOCK_ICON_DIR, 'btn-border-top.svg'))),
        'precondition: the byte check tells two drawings apart');
});

/* --- The own set is only what the shared one lacks ----------------------------------------- */

/* There is no own icon module; the spreadsheet editor resources/img/air folder is exactly the OWN_AIR names, none from the shared list and files
   (the shared set is neither duplicated nor replaced), each is a 24 × 24 SVG; "123" is the AIR file byte for byte. The folder is pointed to by
   one line - the OWN_AIR_BASE base in CompactToolbar.js; the spreadsheet editor styles do not point to it. */
test('own_air_folder_holds_only_what_the_shared_set_lacks', () => {
    assert.ok(!exists(OWN_ICONS), 'the spreadsheet editor keeps its own Icons.js');
    const own = ownNames(), shared = new Set(airNames()), sharedFiles = new Set(airFiles());
    assert.deepEqual(own.slice().sort(), ['decimalDecrease', 'decimalIncrease', 'digits123', 'percentSign'], 'the own set: ' + own);
    const files = fs.readdirSync(OWN_AIR_DIR).sort();
    assert.deepEqual(files, own.map(n => n + '.svg').sort(), 'files of the own folder are not the own set');
    assert.deepEqual(own.filter(n => shared.has(n) || sharedFiles.has(n)), [], 'the own set repeats the shared set');
    own.forEach(n => assert.ok(/^<svg width="24" height="24" viewBox="0 0 24 24"/.test(read(path.join(OWN_AIR_DIR, n + '.svg'))),
        n + ': not a 24 × 24 AIR glyph'));
    assert.equal(objectId(fs.readFileSync(path.join(OWN_AIR_DIR, 'digits123.svg'))), DIGITS123_AIR, 'digits123 is not the AIR file');
    const hits = [];
    viewFiles().concat(fs.readdirSync(path.join(APP, 'app/controller')).filter(f => f.endsWith('.js'))
        .map(f => ({file: 'controller/' + f, text: read(path.join(APP, 'app/controller', f))}))).forEach(({file, text}) =>
        text.split('\n').forEach((line, i) => {
            if (/spreadsheeteditor\/main\/app\/view\/Icons|SSE\.Views\.Icons|['"](\.\/)?resources\/img\/air\//.test(line) &&
                !(file === 'CompactToolbar.js' && /^\s*var OWN_AIR_BASE = 'resources\/img\/air\/';$/.test(line)))
                hits.push(file + ':' + (i + 1) + ': ' + line.trim().slice(0, 90));
        }));
    lessSource.split('\n').forEach((line, i) => {
        if (/\/air\//.test(line.replace(/@\{vo-air-url\}/g, ''))) hits.push('compact-shell.less:' + (i + 1) + ': ' + line.trim().slice(0, 90));
    });
    assert.deepEqual(hits, [], 'the spreadsheet editor points at its own icon set beyond OWN_AIR_BASE');
    const uses = viewFiles().filter(({text}) => /\bIcons\.svg\(/.test(text));
    assert.ok(uses.length >= 3, 'the probe sees the views drawing icons: ' + uses.length);
    uses.forEach(({file, text}) => assert.ok(/'common\/main\/lib\/view\/compact\/Icons'/.test(text), file + ' does not ask for the shared icons'));
});

/* The shared set draws 24 by default, the former spreadsheet editor set - 18: every spreadsheet editor call passes the
   size, and where the size was the default - 18. */
test('icon_calls_without_size_keep_18', () => {
    const calls = svgCalls();
    assert.ok(calls.length > 20, 'Icons.svg calls: ' + calls.length);
    assert.deepEqual(calls.filter(c => !c.sized).map(c => c.where + ' svg(' + c.args + ')'), [], 'icon calls without a size');
    assert.ok(loadIcons().svg('bold').indexOf('--vo-air-size:24px;') > 0, 'precondition: the shared default is 24');
    const at = (file, re) => calls.filter(c => c.where.startsWith(file + ':') && re.test(c.args)).map(c => c.args);
    /* Former default calls: the "⋯" and the panel focus chevron, the glyphs of the panel and its lists, the header,
       the modes and the history. The 24 glyph in the panel row is still set by compact-shell.less. */
    [['CompactToolbar.js', /^'more', 18$/], ['CompactToolbar.js', /^'chevron', 18$/], ['CompactToolbar.js', /^it\.i, 18$/],
     ['CompactToolbar.js', /^entry\.glyph, 18$/], ['CompactToolbar.js', /^name, 18$/], ['CompactShell.js', /^spec\.icon, 18$/],
     ['CompactShell.js', /^'download', 18$/], ['CompactShell.js', /^glyph, 18$/], ['CompactShell.js', /^'accept', 18$/],
     ['CompactShell.js', /^m\.i, 18$/]].forEach(([file, re]) =>
        assert.ok(at(file, re).length > 0, file + ': no call ' + re));
});

/* --- compact-shell.less ------------------------------------------------------------------------ */

/* The glyphs of standard nodes (the bottom row, the right panel tabs, the formula bar chevron) are a mask from
   the shared set file (@vo-air-url): neither a data-URI nor a third-party outline. */
test('test_less_glyphs_are_air_files', () => {
    const vars = lessVars(lessSource);
    const glyphs = Object.keys(vars).filter(k => /^vo-glyph-/.test(k) && /url\(/.test(vars[k]));
    assert.ok(glyphs.length >= 14, 'glyph variables are read: ' + glyphs.length);
    const files = new Set(airFiles());
    const bad = glyphs.filter(k => {
        const m = /^~"url\('@\{vo-air-url\}([A-Za-z][A-Za-z0-9]*)\.svg'\)"$/.exec(vars[k]);
        return !m || !files.has(m[1]);
    });
    assert.deepEqual(bad.map(k => '@' + k + ': ' + vars[k].slice(0, 60)), [], 'glyph variables that are not a shared air file');
    const hits = [];
    lessSource.split('\n').forEach((line, i) => {
        if (/data:image|lucide/i.test(line)) hits.push('compact-shell.less:' + (i + 1) + ': ' + line.trim().slice(0, 70));
    });
    assert.deepEqual(hits, [], 'data-URI or a third-party outline left in compact-shell.less');
});

test('test_less_native_nodes_map_to_air_files', () => {
    const vars = lessVars(lessSource);
    const fileOf = v => { const m = /@\{vo-air-url\}([A-Za-z][A-Za-z0-9]*)\.svg/.exec(vars[v] || ''); return m ? m[1] : null; };
    const want = {
        'status-btn-tabback': 'chevronL', 'status-btn-tabnext': 'chevronR', 'status-btn-addtab': 'plus',
        'status-btn-zoomup': 'plus', 'status-btn-tabslist': 'menu', 'status-btn-zoomdown': 'minus',
        'id-right-menu-cell': 'table', 'id-right-menu-shape': 'shape', 'id-right-menu-image': 'image',
        'id-right-menu-text': 'textbox', 'id-right-menu-textart': 'text', 'id-right-menu-slicer': 'filter',
        'id-right-menu-signature': 'rename', 'id-right-menu-pivot': 'layers'
    };
    const got = {};
    const text = lessSource.replace(/\/\*[\s\S]*?\*\//g, ' ');
    Object.keys(want).forEach(id => {
        const m = new RegExp('#' + id + '\\b[^{;]*\\{[^}]*\\.vo-glyph-src\\(@([\\w-]+)\\)').exec(text);
        got[id] = m ? fileOf(m[1]) : null;
    });
    assert.deepEqual(got, want, 'native node → air file');
});

/* The panel row: a 24 glyph (the main Documents size) for a glyph button, colors, the list button glyph,
   the "⋯" and the focus chevron; the control widths are the former ones: a list button 44 (it was 5 + 18 + 2 + 16 + 3),
   a list without ▾ 32. The list chevron 16, the − + 16 font size and the value carets are not affected by this rule.
   The glyphs of standard nodes in the built spreadsheet editor go from it to the shared set. The layer is built twice: as in the browser (the dev-mode less.js,
   the stock image paths - from the editor page, variables.less) and as in the build (paths -
   from the built spreadsheet editor, build/spreadsheeteditor.json, main.less.vars). */
let compiledCss = null, builtCss = null;
async function compileLess() {
    let less;
    try { less = require(path.join(HERE, 'build/node_modules/less')); }
    catch (e) { less = require('less'); }
    const layer = require('./lib/compact-less.cjs');
    compiledCss = (await less.render(layer.source(LESS),
        {filename: layer.APP_LESS, globalVars: {'app-image-const-path': '"resources/img"'}})).css;
    const vars = JSON.parse(read(path.join(ROOT, 'build/spreadsheeteditor.json'))).main.less.vars;
    builtCss = (await less.render(layer.source(LESS), {filename: layer.APP_LESS, modifyVars: vars})).css;
}

/* The AIR mask addresses in the styles: the url() value of each shared set mask. */
const airUrls = css => [...new Set([...css.matchAll(/url\(['"]?([^'")]*\/air\/[A-Za-z0-9]+\.svg)['"]?\)/g)].map(m => m[1]))];

function cssRules(css) {
    const out = [];
    const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sels = m[1].split(',').map(s => s.replace(/\s+/g, ' ').trim());
        const decl = {};
        m[2].split(';').forEach(d => {
            const i = d.indexOf(':');
            if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim();
        });
        out.push({sels, decl});
    }
    return out;
}

const px = v => { const m = /^(-?[\d.]+)px$/.exec(String(v).trim()); return m ? Number(m[1]) : (String(v).trim() === '0' ? 0 : NaN); };
function padX(decl) {
    const p = (decl.padding || '').split(/\s+/).filter(Boolean).map(px);
    if (!p.length) return null;
    const right = p.length > 1 ? p[1] : p[0], left = p.length > 3 ? p[3] : right;
    return {left, right};
}

test('test_toolbar_row_glyph_is_24_and_widths_hold', () => {
    const vars = lessVars(lessSource);
    assert.equal(vars['vo-glyph-tb'], '24px', '@vo-glyph-tb');
    assert.ok(compiledCss, 'the stylesheet layer is compiled');
    const rules = cssRules(compiledCss);
    const ruleFor = sel => rules.filter(r => r.sels.includes(sel));
    ['#vo-tb .vo-g > .vo-ib > .vo-air', '#vo-tb .vo-cb > .vo-ib > .vo-air', '#vo-tb .vo-drop-i > .vo-air',
     '#vo-tb .vo-more > .vo-air', '#vo-tb .vo-focus-btn > .vo-air'].forEach(sel => {
        const r = ruleFor(sel).find(x => x.decl.width && x.decl.height);
        assert.ok(r, 'no size rule for ' + sel);
        assert.equal(r.decl.width, '24px', sel + ' width');
        assert.equal(r.decl.height, '24px', sel + ' height');
    });
    const drop = ruleFor('.vo-ib.vo-drop').find(x => x.decl.padding);
    assert.ok(drop, '.vo-ib.vo-drop padding rule');
    const dp = padX(drop.decl), gap = px(drop.decl.gap || '0');
    assert.equal(dp.left + 24 + gap + 16 + dp.right, 44,
        'drop button: ' + dp.left + ' + 24 + ' + gap + ' + 16 + ' + dp.right + ' must stay 44');
    const bare = ruleFor('.vo-ib.vo-drop.vo-drop-bare').find(x => x.decl.padding);
    assert.ok(bare, '.vo-ib.vo-drop.vo-drop-bare padding rule');
    const bp = padX(bare.decl);
    assert.equal(bp.left + 24 + bp.right, 32, 'bare drop button: ' + bp.left + ' + 24 + ' + bp.right + ' must stay 32');
    /* The standard node masks: the path from the built spreadsheet editor (apps/spreadsheeteditor/main/resources/css) to
       the shared set. */
    assert.ok(builtCss, 'the stylesheet layer is compiled as in the build');
    const urls = [...new Set(airUrls(builtCss).map(u => u.replace(/[A-Za-z0-9]+\.svg$/, '')))];
    assert.deepEqual(urls, ['../../../../common/main/resources/img/air/'], 'air masks in the built styles');
});

/* The AIR mask finds its shared set file in both modes: in the browser the less.js styles go into the page, and url() is
   from the editor page (apps/spreadsheeteditor/main/index.html); in the build - from the built spreadsheet editor
   (deploy/web-apps/apps/spreadsheeteditor/main/resources/css/app.css), and deploy/web-apps repeats the apps layout
   of the tree. The path from the spreadsheet editor in the browser would miss the tree - a 404 without an error, an empty spot instead of an icon. */
test('air_masks_find_the_shared_files_in_the_browser_and_in_the_build', () => {
    assert.ok(compiledCss && builtCss, 'the stylesheet layer is compiled');
    const dev = airUrls(compiledCss), built = airUrls(builtCss);
    assert.ok(dev.length >= 10, 'suspiciously few air masks: ' + dev.length);
    assert.equal(built.length, dev.length, 'the same masks in both modes');
    const shared = path.join(ROOT, 'apps/common/main/resources/img/air') + path.sep;
    const deploy = path.join(ROOT, 'deploy/web-apps');
    const sheet = path.join(deploy, 'apps/spreadsheeteditor/main/resources/css');
    const bad = [];
    dev.forEach(u => {
        const file = path.resolve(APP, u);
        if (!file.startsWith(shared) || !exists(file)) bad.push('browser: ' + u + ' → ' + path.relative(ROOT, file));
    });
    built.forEach(u => {
        const file = path.join(ROOT, path.relative(deploy, path.resolve(sheet, u)));
        if (!file.startsWith(shared) || !exists(file)) bad.push('build: ' + u + ' → ' + path.relative(ROOT, file));
    });
    assert.deepEqual(bad, [], 'air masks that miss the shared files');
});

(async () => {
    try { await compileLess(); }
    catch (e) { console.error('note: the stylesheet layer is not compiled —', e.message); }
    for (const [name, body] of tests) {
        try { body(); report(name); }
        catch (error) { report(name, error); }
    }
    console.log(`${passed} passed, ${failed} failed` + (skipped ? `, ${skipped} skipped` : ''));
    process.exitCode = failed ? 1 : 0;
})();
