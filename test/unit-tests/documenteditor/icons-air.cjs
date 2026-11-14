/* Run: node test/unit-tests/documenteditor/icons-air.cjs
 * Document shell icons are the AIR set only: there are no lucide outlines in Icons.js, every name from the
 * AIR list is drawn by its own file of the shared set apps/common/main/resources/img/air/<name>.svg, and
 * every name that the shell and its menus ask for is in that list. Otherwise Icons.svg() silently
 * returns an empty string, and a mask without a file is an empty place without an error.
 *
 * The set is shared by the editors: the list and markup are common/main/lib/view/compact/Icons.js, the documents
 * module DE.Views.Icons is the same object. Both are executed in vm, the real ones; the other modules
 * are read as text.
 * The optional argument is the root of another tree (checking the red baseline).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '../../..'));
const VIEW_DIR = path.join(ROOT, 'apps/documenteditor/main/app/view');
const DE_ICONS = path.join(VIEW_DIR, 'Icons.js');
const ICONS = path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js');
const AIR_DIR = path.join(ROOT, 'apps/common/main/resources/img/air');
const DE_AIR_DIR = path.join(ROOT, 'apps/documenteditor/main/resources/img/air');
const LESS_DIR = path.join(ROOT, 'apps/documenteditor/main/resources/less');
const LESS = path.join(LESS_DIR, 'compact-shell.less');
const BASE = 'http://stand.test/web-apps/apps/documenteditor/main/index.html';

let passed = 0, failed = 0;
function test(name, body) {
    try {
        body();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
        failed++;
    }
}

const read = file => fs.readFileSync(file, 'utf8');
const iconsSource = read(ICONS);
const deIconsSource = read(DE_ICONS);

/* The AIR list as text from the literal `var AIR = {...}`: it is not visible from outside the module. */
function airNames() {
    const m = /var\s+AIR\s*=\s*\{([^}]*)\}/.exec(iconsSource);
    assert.ok(m, 'Icons.js: the AIR list literal is found');
    return Array.from(m[1].matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*1\b/g), x => x[1]);
}

/* The shared module, then the documents module, as require loads them: the dependency comes
   as the factory argument. */
function loadModules() {
    const defines = [];
    const sandbox = {
        define: (deps, f) => { defines.push({deps, factory: f}); },
        document: {baseURI: BASE},
        URL
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(iconsSource, sandbox, {filename: ICONS});
    assert.equal(defines.length, 1, 'common Icons.js defines an AMD module');
    const shared = defines[0].factory();
    vm.runInContext(deIconsSource, sandbox, {filename: DE_ICONS});
    assert.equal(defines.length, 2, 'documents Icons.js defines an AMD module');
    const de = defines[1].factory.apply(null, defines[1].deps.map(d => (d === 'common/main/lib/view/compact/Icons' ? shared : undefined)));
    return {shared, de, sandbox, deDeps: Array.from(defines[1].deps)};
}

const loadIcons = () => loadModules().shared;

/* The set files as an exact directory list: on macOS existsSync does not distinguish case, while the build
   on Linux does. */
const airFiles = () => fs.readdirSync(AIR_DIR).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4));

const viewFiles = () => fs.readdirSync(VIEW_DIR).filter(f => f.endsWith('.js') && f !== 'Icons.js')
    .map(f => ({file: 'view/' + f, text: read(path.join(VIEW_DIR, f))}));

const NAME = /'([A-Za-z][A-Za-z0-9]*)'/g;

/* Icon names that the shell views ask for:
   - the item keys `i:`, `ic:`, `icon:` in the tables of menus, plates and lists;
   - the first argument of icon helpers: Icons.svg / Icons.has, the local svg() and icon(), the methods
     iconBtn(), dropBtn(), popItem(). All literals of the first argument, so this also catches
     `Icons.svg(open ? 'chevronL' : 'outline')`. */
function requestedNames() {
    const found = new Map();
    const add = (name, where) => { if (!found.has(name)) found.set(name, where); };
    viewFiles().forEach(({file, text}) => {
        text.split('\n').forEach((line, i) => {
            const where = file + ':' + (i + 1);
            for (const m of line.matchAll(/(?:^|[^A-Za-z0-9_$])(?:i|ic|icon)\s*:\s*'([A-Za-z][A-Za-z0-9]*)'/g))
                add(m[1], where);
            for (const m of line.matchAll(/(?:Icons\.(?:svg|has)|(?:^|[^A-Za-z0-9_$.])(?:svg|icon)|\b(?:iconBtn|dropBtn|popItem))\(\s*([^,()]*)/g))
                for (const n of m[1].matchAll(NAME)) add(n[1], where);
        });
    });
    return found;
}

/* --- There are no lucide outlines ----------------------------------------------- */

test('test_icons_has_no_lucide_path_table', () => {
    const hits = [];
    [[ICONS, iconsSource], [DE_ICONS, deIconsSource]].forEach(([file, source]) => source.split('\n').forEach((line, i) => {
        if (/\bPATH\b|<path\b|<rect\b|<circle\b|<line\b|<polyline\b|stroke-width|lucide/i.test(line))
            hits.push(path.relative(ROOT, file) + ':' + (i + 1) + ': ' + line.trim().slice(0, 80));
    }));
    assert.equal(hits.length, 0, hits.length + ' lines, first: ' + hits.slice(0, 5).join(' | '));
});

test('test_compact_sources_do_not_name_lucide', () => {
    const hits = [];
    viewFiles().concat([{file: 'less/compact-shell.less', text: read(LESS)}]).forEach(({file, text}) => {
        text.split('\n').forEach((line, i) => {
            if (/lucide/i.test(line)) hits.push(file + ':' + (i + 1) + ': ' + line.trim());
        });
    });
    assert.deepEqual(hits, []);
});

test('test_icons_svg_draws_only_air_masks', () => {
    const Icons = loadIcons();
    const names = airNames();
    assert.ok(names.length > 60, 'the AIR list is read: ' + names.length);
    names.forEach(name => {
        assert.equal(Icons.has(name), true, 'has(' + name + ')');
        const html = Icons.svg(name, 16);
        assert.ok(html.indexOf('class="vo-air"') > 0, name + ' is an AIR mask: ' + html);
        assert.ok(html.indexOf('--vo-air-size:16px;') > 0, name + ' keeps the size');
        assert.ok(html.indexOf('/web-apps/apps/common/main/resources/img/air/' + name + '.svg)') > 0, name + ' has its own file: ' + html);
        assert.ok(!/<svg\b/.test(html), name + ' is not an inline outline');
    });
    /* A name that is not in the set is not in the output either: neither an outline nor a stub. */
    ['nope', 'check', 'hash', 'toString', 'constructor'].forEach(name => {
        assert.equal(Icons.has(name), false, 'has(' + name + ') is false');
        assert.equal(Icons.svg(name), '', 'svg(' + name + ') is empty');
    });
    assert.equal(Icons.path, undefined, 'path() is gone together with the outline table');
});

/* --- The AIR list and files -------------------------------------------------------- */

test('every icon name has a file in the shared folder', () => {
    const files = new Set(airFiles());
    const missing = airNames().filter(name => !files.has(name));
    assert.deepEqual(missing, [], 'apps/common/main/resources/img/air/<name>.svg is missing');
    /* We do not compare the size: the mask fits the file into a square (mask-size: contain), and AIR
       icons also come as 20x20. It is enough that it is an svg document, not a dummy. */
    airNames().forEach(name => {
        const svg = read(path.join(AIR_DIR, name + '.svg'));
        assert.ok(/^<svg\b[^>]*\bviewBox="/.test(svg) && /<\/svg>\s*$/.test(svg), name + '.svg is an svg document');
    });
});

/* A file without a name in the list is either a forgotten replacement or an icon taken by file name
   directly: a window via a CSS variable (the compact window template), in which case the name stands in its view
   as a literal, or a shell style via url("@{vo-air-url}<name>.svg"). */
test('every shared file has a name', () => {
    const names = new Set(airNames());
    const views = viewFiles();
    const less = read(LESS);
    const orphans = airFiles().filter(name =>
        !names.has(name) && !views.some(({text}) => text.indexOf("'" + name + "'") >= 0) &&
        less.indexOf('@{vo-air-url}' + name + '.svg') < 0);
    assert.deepEqual(orphans, [], 'a file in apps/common/main/resources/img/air nobody asks for');
});

/* --- The set is shared ------------------------------------------------------------------ */

test('documents icons module is the shared one', () => {
    const {shared, de, sandbox, deDeps} = loadModules();
    assert.deepEqual(deDeps, ['common/main/lib/view/compact/Icons'], 'documents Icons.js asks for the shared module');
    assert.equal(de, shared, 'the documents module returns the shared object');
    assert.equal(sandbox.DE.Views.Icons, sandbox.Common.UI.Compact.Icons, 'DE.Views.Icons is Common.UI.Compact.Icons');
    assert.ok(!/var\s+AIR\s*=/.test(deIconsSource), 'documents Icons.js keeps no list of its own');
    assert.ok(!fs.existsSync(DE_AIR_DIR) || !fs.readdirSync(DE_AIR_DIR).some(f => f.endsWith('.svg')),
        'the documents icon folder is gone');
    /* Without a factory argument (loading in vm without require) it is the same shared object. */
    const lone = {document: {baseURI: BASE}, URL};
    lone.window = lone;
    let factory = null;
    lone.define = (deps, f) => { factory = f; return f(); };
    vm.createContext(lone);
    vm.runInContext(iconsSource, lone, {filename: ICONS});
    vm.runInContext(deIconsSource, lone, {filename: DE_ICONS});
    assert.equal(factory(), lone.Common.UI.Compact.Icons);
});

test('no shell style points at the documents icon folder', () => {
    const hits = [];
    fs.readdirSync(LESS_DIR).filter(f => f.endsWith('.less')).forEach(f => {
        read(path.join(LESS_DIR, f)).split('\n').forEach((line, i) => {
            if (/url\(\s*["']?(?!@\{vo-air-url\})[^"')]*img\/air\//.test(line)) hits.push(f + ':' + (i + 1) + ': ' + line.trim());
            for (const m of line.matchAll(/@\{vo-air-url\}([A-Za-z0-9]+)\.svg/g))
                if (!fs.existsSync(path.join(AIR_DIR, m[1] + '.svg'))) hits.push(f + ':' + (i + 1) + ': no file ' + m[1] + '.svg');
        });
    });
    /* Icons that JS sets via a CSS variable are also from the shared set. */
    viewFiles().forEach(({file, text}) => text.split('\n').forEach((line, i) => {
        if (/['"](\.\/)?resources\/img\/air\//.test(line)) hits.push(file + ':' + (i + 1) + ': ' + line.trim());
    }));
    assert.deepEqual(hits, []);
    assert.ok(/url\("@\{vo-air-url\}drop\.svg"\)/.test(read(LESS)), 'the probe sees the shell styles');
});

/* --- Everything asked for is in the set -------------------------------------------- */

test('test_every_requested_icon_is_in_air', () => {
    const names = new Set(airNames());
    const requested = requestedNames();
    /* The probe is not empty: it has names from every way of requesting. */
    ['undo', 'rename', 'numbered', 'outline', 'chevronL', 'panel', 'wrapInline', 'toFront', 'h1', 'lineh', 'indentIn']
        .forEach(name => assert.ok(requested.has(name), 'the probe sees ' + name));
    assert.ok(requested.size > 70, 'requested names: ' + requested.size);
    const missing = [];
    requested.forEach((where, name) => { if (!names.has(name)) missing.push(name + ' (' + where + ')'); });
    assert.deepEqual(missing, [], 'requested icons without an AIR file');
});

test('test_menu_check_is_its_own_air_name', () => {
    /* The checkmark of a selected item has its own name: the name `check` is left for the window
       checkbox checkmark (a different AIR glyph, check-m), one cannot be replaced by the other. */
    const requested = requestedNames();
    assert.ok(requested.has('checkMenu'), 'menus ask for checkMenu');
    assert.ok(!requested.has('check'), 'nobody asks Icons for check: ' + requested.get('check'));
    assert.ok(airNames().includes('checkMenu'), 'checkMenu is in the AIR list');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
