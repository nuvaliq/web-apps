/* Run: node test/unit-tests/presentationeditor/icons-air.cjs [root of another tree]
 * Presentation shell icons are the shared AIR set of the editors: the module common/main/lib/view/compact/Icons.js
 * and the files apps/common/main/resources/img/air/<name>.svg. The presentations have no icon module
 * of their own and no resources/img/air folder of their own. Every name that the shell views ask for is in the shared
 * list and is drawn by its own file, otherwise Icons.svg() silently returns an empty string, and a mask without
 * a file is an empty place without an error. Stock node icons (the --vo-ar-ico-<name> and
 * --vo-win-ico-<name> variables on the document root) are also files of the shared set.
 *
 * Icons the shared set did not have were moved from the former presentation set byte for byte
 * (fixtures/former-air-set.json holds the git object ids of its files); presentation names whose
 * drawing the shared set already had under another name are replaced by that name, the files are the same byte for byte.
 * Two drawings of the former set (line, presenter) are no longer requested by the shell, they were not
 * moved to the shared set.
 *
 * Icons.js is executed in vm, the real one; the views and styles are read as text.
 * The optional argument is the root of another tree (checking the red baseline).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const HERE = path.resolve(__dirname, '../../..');
const ROOT = path.resolve(process.argv[2] || HERE);
const APP = path.join(ROOT, 'apps/presentationeditor/main');
const VIEW_DIR = path.join(APP, 'app/view');
const LESS_DIR = path.join(APP, 'resources/less');
const ICONS = path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js');
const AIR_DIR = path.join(ROOT, 'apps/common/main/resources/img/air');
const OWN_ICONS = path.join(VIEW_DIR, 'Icons.js');
const OWN_AIR_DIR = path.join(APP, 'resources/img/air');
const BASE = 'http://stand.test/web-apps/apps/presentationeditor/main/index.html';
/* The shared set base from the editor document, like AIR_BASE of the shared Icons.js. */
const SHARED_BASE = '../../common/main/resources/img/air/';

/* Shell views that ask for icons: the scaffold, its zones and its own windows. */
const SHELL_VIEWS = ['CompactShell', 'StockBridge', 'CompactWindows', 'SlideSelection', 'CompactModes', 'SlideActions',
    'CompactToolbar', 'SlideSections', 'CompactLeft', 'CompactStatus', 'DocInfoWindow'];

/* The former presentation set (apps/presentationeditor/main/resources/img/air before the move): icon name →
   git object id of the file (SHA-1 of "blob <length>\0" and the bytes). Recorded so that the comparison does not depend on the clone
   history: neither rewritten branch commits nor a shallow clone of it cancel it. */
const FORMER = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/former-air-set.json'), 'utf8')).files;
const objectId = buf => crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
/* Presentation icons the shared set did not have: the files are moved as is. */
const ADDED = ['background', 'borderDash', 'borderWeight', 'dateTime', 'duplicate', 'eyeOff', 'filmstrip', 'flipV', 'group',
    'layout', 'newSlide', 'notes', 'pause', 'pencil', 'play', 'replaceImg', 'resetImg', 'rotateCcw', 'rotateCw', 'smartart',
    'textAdd', 'textart', 'theme', 'transition', 'ungroup'];
/* Former presentation name → shared set name: the drawing is the same. */
const RENAMED = {alignObj: 'alignC', animation: 'autoCorrect', arrange: 'toFront', borderColor: 'pencil', crop: 'cut',
    fitSlide: 'fitPage', flipH: 'compare', fullscreen: 'focus', hash: 'pageNumber', omega: 'symbol', review: 'rename',
    slideSize: 'pageSize', valignB: 'caption', valignM: 'alignC', x: 'close'};
/* Drawings of the former set that the shell no longer asks for. */
const DROPPED = ['line', 'presenter'];
/* The nearest AIR glyph for six commands without a drawing of their own: shared set name → start of the ui.icon-set file path. */
const NEAREST = {
    cut: 'M8.65478 15.75L8.65478 10.5407',
    background: 'M13.916 13.2754',
    layout: 'M17.3838 12.5986',
    compare: 'M10.0368 6.47282',
    flipV: 'M18.4972 15.0187',
    ungroup: 'M6 5C5.44772 5 5 5.44772 5 6V10'
};

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
const exists = file => { try { fs.accessSync(file); return true; } catch (e) { return false; } };
const iconsSource = read(ICONS);
const viewText = view => { const file = path.join(VIEW_DIR, view + '.js'); return exists(file) ? read(file) : ''; };
/* The window mechanics on the template are shared: its icons and base are in common/main/lib/view/compact/Windows.js, the template and
   the window set are in common/main/resources/less/compact. */
const SHARED_WINDOWS = path.join(ROOT, 'apps/common/main/lib/view/compact/Windows.js');
const SHARED_LESS_DIR = path.join(ROOT, 'apps/common/main/resources/less/compact');
const sourceText = view => view === 'Windows' ? (exists(SHARED_WINDOWS) ? read(SHARED_WINDOWS) : '') : viewText(view);

/* The AIR list as text from the literal `var AIR = {...}`: it is not visible from outside the module. */
function airNames() {
    const m = /var\s+AIR\s*=\s*\{([^}]*)\}/.exec(iconsSource);
    assert.ok(m, 'Icons.js: the AIR list literal is found');
    return Array.from(m[1].replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*1\b/g), x => x[1]);
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

/* The set files as an exact directory list: on macOS existsSync does not distinguish case, while the build
   on Linux does. */
const airFiles = () => fs.readdirSync(AIR_DIR).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4));

/* A literal list of strings `var <name> = [...]` of a view. */
function listLiteral(view, name) {
    const m = new RegExp('var\\s+' + name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(sourceText(view));
    assert.ok(m, view + '.js: the ' + name + ' list literal is found');
    return Array.from(m[1].matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g), x => x[1]);
}

/* Icon names that the shell views ask for:
   - the item keys `i:`, `ic:`, `icon:`, `glyph:` in the panel, menu and list catalogs;
   - the first argument of icon helpers: Icons.svg / Icons.has, the local svg(), icon() and glyph(),
     the methods iconBtn(), dropBtn(), popItem(). All literals of the first argument, so this also catches
     `icon(open ? 'chevronL' : 'outline')`. */
function requestedNames() {
    const found = new Map();
    const add = (name, where) => { if (!found.has(name)) found.set(name, where); };
    SHELL_VIEWS.forEach(view => {
        viewText(view).split('\n').forEach((line, i) => {
            const where = view + '.js:' + (i + 1);
            for (const m of line.matchAll(/(?:^|[^A-Za-z0-9_$])(?:i|ic|icon|glyph)\s*:\s*['"]([A-Za-z][A-Za-z0-9]*)['"]/g)) add(m[1], where);
            for (const m of line.matchAll(/(?:Icons\.(?:svg|has)|(?:^|[^A-Za-z0-9_$.])(?:svg|icon|glyph)|\b(?:iconBtn|dropBtn|popItem))\(\s*([^,()]*)/g))
                for (const n of m[1].matchAll(/['"]([A-Za-z][A-Za-z0-9]*)['"]/g)) add(n[1], where);
        });
    });
    return found;
}

/* Stock node icons: variable names on the document root (CompactLeft is --vo-ar-ico-<name>,
   windows on the template are --vo-win-ico-<name>, the list of the shared window mechanics). */
const stockNodeIcons = () => ({left: listLiteral('CompactLeft', 'ICONS'), windows: listLiteral('Windows', 'ICONS')});

const EXTERNAL = /(?:https?:)?\/\/[a-z]/i;
const withoutXmlns = text => text.replace(/xmlns(?::\w+)?="[^"]*"/g, '');

/* --- The set is shared ------------------------------------------------------------------- */

test('every_presentation_icon_name_exists_in_the_shared_set', () => {
    const names = new Set(airNames()), files = new Set(airFiles());
    const requested = requestedNames();
    /* The view list covers all scaffold zones: a new zone with icons will not drop out of the probe. */
    const zones = /var\s+ZONES\s*=\s*\[([^\]]*)\]/.exec(viewText('CompactShell'));
    assert.ok(zones, 'CompactShell.js: the ZONES list literal is found');
    const zoneNames = Array.from(zones[1].matchAll(/'([A-Za-z]+)'/g), x => x[1]);
    assert.deepEqual(zoneNames.filter(z => !SHELL_VIEWS.includes(z)), [], 'zones the probe does not read');
    assert.ok(!zoneNames.includes('Icons'), 'the shell still installs an Icons zone');
    /* The probe is not empty: it has names from every way of requesting, moved and replaced ones. */
    ['newSlide', 'textAdd', 'pencil', 'play', 'pause', 'filmstrip', 'rotateCw', 'flipV', 'background', 'layout',
     'compare', 'alignC', 'caption', 'cut', 'autoCorrect', 'toFront', 'pageNumber', 'symbol', 'pageSize', 'fitPage',
     'checkMenu', 'rename', 'panel', 'chevron', 'more', 'download', 'accept', 'settings', 'trash']
        .forEach(name => assert.ok(requested.has(name), 'the probe sees ' + name));
    assert.ok(requested.size > 80, 'requested names: ' + requested.size);
    const missing = [], noFile = [];
    requested.forEach((where, name) => {
        if (!names.has(name)) missing.push(name + ' (' + where + ')');
        else if (!files.has(name)) noFile.push(name + ' (' + where + ')');
    });
    assert.deepEqual(missing, [], 'requested icons outside the shared AIR list');
    assert.deepEqual(noFile, [], 'requested icons without a shared file');
    /* Nobody asks for the former presentation names any more: the shared set does not have them. */
    const old = Object.keys(RENAMED).concat(DROPPED);
    assert.deepEqual(old.filter(n => requested.has(n)).map(n => n + ' (' + requested.get(n) + ')'), [],
        'old presentation icon names are still asked for');
    assert.deepEqual(old.filter(n => names.has(n) || files.has(n)), [], 'the shared set got an old presentation name');
});

test('every_presentation_icon_name_is_drawn_by_the_shared_module', () => {
    const Icons = loadIcons();
    requestedNames().forEach((where, name) => {
        const html = Icons.svg(name, 24);
        assert.ok(html.indexOf('class="vo-air"') > 0, name + ' is not an AIR mask (' + where + '): ' + html);
        assert.ok(html.indexOf('--vo-air-size:24px;') > 0, name + ' keeps the size: ' + html);
        assert.ok(html.indexOf('/web-apps/apps/common/main/resources/img/air/' + name + '.svg)') > 0, name + ' is not a shared file: ' + html);
    });
    /* The main size of the shared set is 24, like the former presentation set: calls without a size do not change it. */
    assert.ok(Icons.svg('undo').indexOf('--vo-air-size:24px;') > 0, 'the shared default is 24');
    ['nope', 'toString', 'constructor', 'hasOwnProperty', '__proto__'].forEach(name => {
        assert.equal(Icons.has(name), false, 'has(' + name + ') is false');
        assert.equal(Icons.svg(name), '', 'svg(' + name + ') is empty');
    });
});

/* Stock node icons (the left area, the slide show, template windows) are masks from the shared set files:
   the address is the shared set base from the editor document. */
test('stock_node_icons_are_shared_files', () => {
    const files = new Set(airFiles()), lists = stockNodeIcons();
    assert.ok(lists.left.length >= 10 && lists.windows.length >= 4, 'stock node icons are read: ' + lists.left.length + ', ' + lists.windows.length);
    const bad = lists.left.concat(lists.windows).filter(n => !files.has(n));
    assert.deepEqual(bad, [], 'stock node icons without a shared file');
    ['CompactLeft', 'Windows'].forEach(view => {
        const m = /var\s+AIR_BASE\s*=\s*'([^']*)'/.exec(sourceText(view));
        assert.ok(m, view + '.js: the AIR_BASE literal is found');
        assert.equal(m[1], SHARED_BASE, view + '.js: base of the stock node icons');
        assert.equal(new URL(m[1], BASE).href, 'http://stand.test/web-apps/apps/common/main/resources/img/air/', view + '.js: resolved base');
    });
    /* Styles take a mask by name from these lists: a name not in the list means the node has no address. */
    const used = {left: new Set(), windows: new Set()};
    const lessFiles = fs.readdirSync(LESS_DIR).filter(f => f.endsWith('.less')).map(f => path.join(LESS_DIR, f))
        .concat(['windows.less', 'windows-stock.less'].map(f => path.join(SHARED_LESS_DIR, f)).filter(exists));
    lessFiles.forEach(file => {
        const text = read(file).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
        for (const m of text.matchAll(/\.vo-ar-ico\(\s*([A-Za-z][A-Za-z0-9]*)\s*\)/g)) used.left.add(m[1]);
        for (const m of text.matchAll(/--vo-win-ico-([A-Za-z][A-Za-z0-9]*)/g)) used.windows.add(m[1]);
    });
    assert.ok(used.left.has('focus') && used.left.has('pencil') && used.windows.has('close'), 'the probe sees the styles: ' +
        [...used.left].join(',') + ' / ' + [...used.windows].join(','));
    assert.deepEqual([...used.left].filter(n => !lists.left.includes(n)), [], 'masks of the areas without a CompactLeft address');
    assert.deepEqual([...used.windows].filter(n => !lists.windows.includes(n)), [], 'masks of the windows without an address of the windows mechanics');
});

/* Moved icons are files of the former presentation set byte for byte; replaced names are the same
   drawing under the shared set name. */
test('added_icons_are_the_presentation_files_and_renamed_ones_the_same_drawing', () => {
    const former = Object.keys(FORMER);
    assert.equal(former.length, 159, 'files of the former presentation set: ' + former.length);
    const same = (file, name) => exists(file) && objectId(fs.readFileSync(file)) === FORMER[name];
    const names = new Set(airNames());
    const diff = [];
    ADDED.forEach(name => {
        const file = path.join(AIR_DIR, name + '.svg');
        if (!(name in FORMER)) diff.push(name + ': not in the former set');
        else if (!names.has(name)) diff.push(name + ': not in the list');
        else if (!same(file, name)) diff.push(name + ': differs');
    });
    Object.keys(RENAMED).forEach(old => {
        const file = path.join(AIR_DIR, RENAMED[old] + '.svg');
        if (!(old in FORMER)) diff.push(old + ': not in the former set');
        else if (!names.has(RENAMED[old])) diff.push(old + ' → ' + RENAMED[old] + ': not in the list');
        else if (!same(file, old)) diff.push(old + ' → ' + RENAMED[old] + ': differs');
    });
    DROPPED.forEach(name => { if (!(name in FORMER)) diff.push(name + ': not in the former set'); });
    assert.deepEqual(diff, [], 'shared files against the former presentation set');
    /* The other presentation icons were in the shared set under the same name and the same bytes. */
    const rest = former.filter(n => !ADDED.includes(n) && !(n in RENAMED) && !DROPPED.includes(n));
    assert.equal(rest.length, 117, 'same-name presentation icons: ' + rest.length);
    const other = rest.filter(n => !same(path.join(AIR_DIR, n + '.svg'), n));
    assert.deepEqual(other, [], 'same-name icons differ from the shared files');
    /* A negative control of the byte comparison: neighboring drawings differ. */
    assert.notEqual(FORMER.play, FORMER.pause, 'precondition: the byte check tells two drawings apart');
});

test('six_without_air_drawing_take_the_nearest_glyph', () => {
    const names = new Set(airNames());
    Object.keys(NEAREST).forEach(name => {
        assert.ok(names.has(name), name + ' is in the AIR list');
        const file = read(path.join(AIR_DIR, name + '.svg'));
        assert.ok(file.indexOf('d="' + NEAREST[name]) > 0, name + '.svg is not the chosen AIR glyph');
        assert.ok(!/stroke=/.test(file), name + '.svg is a filled glyph, not a stroke outline');
    });
    /* "Crop" and "Flip horizontal" take the same drawings under the shared set names. */
    assert.equal(RENAMED.crop, 'cut');
    assert.equal(RENAMED.flipH, 'compare');
});

/* --- There is no set of its own ---------------------------------------------------------- */

/* Neither an icon module of its own nor a folder of its own: the views take the shared module, address bases are the shared set, nobody
   points to the former folder. */
test('no_own_icon_module_or_folder', () => {
    assert.ok(!exists(OWN_ICONS), 'the presentation editor keeps its own Icons.js');
    assert.ok(!exists(OWN_AIR_DIR), 'the presentation editor keeps its own resources/img/air');
    const hits = [];
    const scan = (dir, label) => fs.readdirSync(dir).filter(f => f.endsWith('.js') || f.endsWith('.less')).forEach(f =>
        read(path.join(dir, f)).split('\n').forEach((line, i) => {
            if (/presentationeditor\/main\/app\/view\/Icons|PE\.Views\.Icons|['"(](\.\/)?resources\/img\/air\//.test(line))
                hits.push(label + f + ':' + (i + 1) + ': ' + line.trim().slice(0, 90));
        }));
    scan(VIEW_DIR, 'view/');
    scan(path.join(APP, 'app/controller'), 'controller/');
    scan(LESS_DIR, 'less/');
    assert.deepEqual(hits, [], 'the presentation editor points at its own icon set');
    assert.ok(/'common\/main\/lib\/view\/compact\/Icons'/.test(viewText('CompactShell')), 'CompactShell does not require the shared icons');
    const uses = SHELL_VIEWS.filter(view => /\bCommon\.UI\.Compact\b[^;\n]*\bIcons\b/.test(viewText(view)));
    ['CompactShell', 'SlideActions', 'SlideSections', 'CompactToolbar'].forEach(view =>
        assert.ok(uses.includes(view), view + ' does not draw with the shared icons'));
});

test('no_external_urls', () => {
    const Icons = loadIcons();
    const external = ADDED.filter(n => EXTERNAL.test(withoutXmlns(read(path.join(AIR_DIR, n + '.svg')))));
    assert.deepEqual(external, [], 'added icon files with external references');
    const bad = [];
    requestedNames().forEach((where, name) => {
        const html = Icons.svg(name).split('http://stand.test/web-apps/apps/common/main/').join('');
        if (EXTERNAL.test(withoutXmlns(html))) bad.push(name);
    });
    assert.deepEqual(bad, [], 'markup with addresses outside the editor');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
