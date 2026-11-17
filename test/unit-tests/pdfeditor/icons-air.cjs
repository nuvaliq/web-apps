/* Run: node test/unit-tests/pdfeditor/icons-air.cjs [copies of shell modules…]
 * Icons of the compact shell of the PDF viewer are the shared AIR set of the editors: the module
 * common/main/lib/view/compact/Icons.js and the files apps/common/main/resources/img/air/<name>.svg.
 * Every name the viewer shell asks for is in the shared list (Icons.has) and is drawn by its own
 * file; otherwise Icons.svg() silently gives an empty string and the mask an empty place.
 * apps/pdfeditor has no icon module, no AIR folder and no AIR files of its own.
 *
 * Names are taken three ways: the catalog read as it is (PdfActions in vm: every item of the ⋮ menu
 * and its submenus), literal names in the code of the shell, the bar and the navigation panel
 * (icon('…'), svg('…'), keys i: and icon:, the icon argument of the bar buttons), and every name the
 * live shell asks for while it is built and every list of it is opened (headless Chrome through
 * Playwright, see lib/shell-page.cjs).
 *
 * The PDF icon at the title is not an AIR glyph but a coloured picture of the viewer
 * (apps/pdfeditor/main/resources/img/compact/pdf.svg), drawn as it is.
 * Optional arguments: copies of modules (by file name, e.g. PdfActions.js) for a negative control.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const H = require('./lib/shell-page.cjs');

const ROOT = H.ROOT;
const APP = path.join(ROOT, 'apps/pdfeditor');
const ICONS = H.moduleFile('Icons');
const AIR_DIR = path.join(ROOT, 'apps/common/main/resources/img/air');
const SHARED_URL = 'http://stand.test/web-apps/apps/common/main/resources/img/air/';
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

const read = file => fs.readFileSync(file, 'utf8');
const exists = file => { try { fs.accessSync(file); return true; } catch (e) { return false; } };

/* The shared list, as the literal `var AIR = {...}` of Icons.js: it is not seen outside the module. */
function airNames() {
    const m = /var\s+AIR\s*=\s*\{([^}]*)\}/.exec(read(ICONS));
    assert.ok(m, 'Icons.js: the AIR list literal is found');
    return new Set(Array.from(m[1].replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*1\b/g), x => x[1]));
}

/* Files of the set by the exact listing of the folder: macOS does not tell letter case apart, the Linux build does. */
const airFiles = () => new Set(fs.readdirSync(AIR_DIR).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4)));

function loadIcons() {
    let factory = null;
    const sandbox = {define: (deps, f) => { factory = f; }, document: {baseURI: H.BASE}, URL};
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read(ICONS), sandbox, {filename: ICONS});
    assert.equal(typeof factory, 'function', 'Icons.js defines an AMD module');
    return factory();
}

/* The catalog as it is: PdfActions in vm over a Main with every right and a PDF with comments. Item
   icons of every section and submenu. */
function catalogNames() {
    const found = new Map();
    const main = {appOptions: {canDownload: true, canPrint: true, canRename: true, canUseHistory: true, canViewComments: true}};
    const comments = {length: 1, some: fn => fn({get: () => false})};
    const sandbox = {_, PDFE: {Views: {}, getController: name => (name === 'Main' ? main : null),
        getCollection: name => (name === 'Common.Collections.Comments' ? comments : null)}, Common: {UI: {Compact: {}}}};
    sandbox.window = sandbox;
    sandbox.define = (deps, factory) => factory();
    vm.createContext(sandbox);
    for (const name of ['StockBridge', 'PdfActions']) {
        const file = H.moduleFile(name);
        vm.runInContext(read(file), sandbox, {filename: file});
    }
    const actions = sandbox.PDFE.Views.PdfActions;
    const walk = items => (items || []).forEach(it => {
        if (!it) return;
        if (it.i) found.set(it.i, found.get(it.i) || 'PdfActions ' + it.k);
        walk(typeof it.items === 'function' ? it.items() : it.items);
    });
    actions.sections().forEach(s => walk(s.items));
    return found;
}

/* Literal names in the code of the shell, the bar and the navigation panel: the first argument of
   icon() and svg(), keys i: and icon:, and the icon argument of the bar buttons (button(key, name, …)). */
function literalNames() {
    const found = new Map();
    for (const view of ['CompactShell', 'CompactToolbar', 'NavigationPanel', 'PdfActions']) {
        read(H.moduleFile(view)).split('\n').forEach((line, n) => {
            const where = view + '.js:' + (n + 1);
            const add = name => { if (!found.has(name)) found.set(name, where); };
            for (const m of line.matchAll(/(?:^|[^A-Za-z0-9_$])(?:i|icon)\s*:\s*['"]([A-Za-z][A-Za-z0-9]*)['"]/g)) add(m[1]);
            for (const m of line.matchAll(/(?:Icons\.(?:svg|has)|(?:^|[^A-Za-z0-9_$.])(?:svg|icon))\(\s*([^,()]*)/g))
                for (const x of m[1].matchAll(/['"]([A-Za-z][A-Za-z0-9]*)['"]/g)) add(x[1]);
            for (const m of line.matchAll(/\bthis\.button\(\s*'[A-Za-z]+'\s*,\s*'([A-Za-z][A-Za-z0-9]*)'/g)) add(m[1]);
        });
    }
    return found;
}

/* Names the live shell asks for: built with every right, bookmarks and comments, the ⋮ menu, every
   submenu and the zoom list opened. Also the icon files its markup points to. */
async function liveNames(browser) {
    const page = await H.open(browser, {bookmarks: [{description: 'Intro', level: 1, page: 0}], comments: [{text: 'Note'}], before: () => {
        const I = Common.UI.Compact.Icons, svg = I.svg;
        window.asked = {};
        I.svg = function (name) { window.asked[name] = (window.asked[name] || 0) + 1; return svg.apply(this, arguments); };
    }});
    try {
        await page.click('#vo-tb [data-vo="more"]');
        const subs = await page.evaluate(() => Array.from(document.querySelectorAll('#vo-tb .vo-mn-drop.open > .vo-has-sub')).map(r => r.getAttribute('data-k')));
        assert.ok(subs.length >= 1, 'submenus of ⋮: ' + subs);
        for (const s of subs) await page.click(`#vo-tb .vo-mn-drop.open > [data-k="${s}"]`);
        await page.evaluate(() => shell.menu.close());
        await page.click('#vo-tb [data-vo="zoomList"]');
        return await page.evaluate(() => ({
            asked: Object.keys(window.asked),
            files: Array.from(document.querySelectorAll('.vo-air')).map(s => (/--vo-air-src:url\(([^)]*)\)/.exec(s.getAttribute('style') || '') || [])[1] || null)
        }));
    } finally {
        await page.close();
    }
}

/* Every file under a folder, recursively. */
function filesUnder(dir) {
    if (!exists(dir)) return [];
    return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? filesUnder(p) : [p];
    });
}
const objectId = buf => crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');

(async () => {
    const {check, done} = H.checker();
    const names = airNames(), files = airFiles();

    const inSet = (found, what) => {
        const missing = [], noFile = [];
        found.forEach((where, name) => {
            if (!names.has(name)) missing.push(name + ' (' + where + ')');
            else if (!files.has(name)) noFile.push(name + ' (' + where + ')');
        });
        assert.deepEqual(missing, [], what + ': names outside the shared AIR list');
        assert.deepEqual(noFile, [], what + ': names without a shared file');
    };

    await check('every catalog and Download icon is in the shared set and has its file', async () => {
        const found = catalogNames();
        /* The probe is not empty: names of plain items, of items built by helpers and of the Download list. */
        ['download', 'rename', 'info', 'comment', 'settings', 'keyboard']
            .forEach(name => assert.ok(found.has(name), 'the catalog probe sees ' + name));
        inSet(found, 'catalog');
    });

    await check('every icon named in the shell and toolbar code is in the shared set and has its file', async () => {
        const found = literalNames();
        ['share', 'download', 'print', 'chevron', 'search', 'fitLandscape', 'fitPage', 'chevronL', 'chevronR', 'outline',
            'demonstration', 'moreV'].forEach(name => assert.ok(found.has(name), 'the code probe sees ' + name));
        inSet(found, 'code');
    });

    const browser = await H.launch();
    try {
        await check('every icon the live shell asks for is in the shared set and drawn from a shared file', async () => {
            const live = await liveNames(browser);
            const found = new Map(live.asked.map(n => [n, 'live shell']));
            ['share', 'download', 'print', 'search', 'chevron', 'fitLandscape', 'chevronL', 'chevronR', 'outline', 'demonstration',
                'moreV', 'rename', 'info', 'comment', 'settings', 'keyboard']
                .forEach(name => assert.ok(found.has(name), 'the live probe sees ' + name));
            inSet(found, 'live shell');
            const statics = new Set([...catalogNames().keys(), ...literalNames().keys()]);
            const own = live.asked.filter(n => !statics.has(n));
            /* What only the live probe sees comes from the shared menu bar (arrows, marks), not from the viewer. */
            assert.deepEqual(own.filter(n => !['chevronL', 'checkMenu', 'close'].includes(n)), [], 'names the static probes miss');
            const bad = live.files.filter(u => !u || u.indexOf(SHARED_URL) !== 0 || !files.has(u.slice(SHARED_URL.length).replace(/\.svg$/, '')));
            assert.deepEqual(bad, [], 'icon masks that are not shared files');
            assert.ok(live.files.length > 15, 'drawn icons: ' + live.files.length);
        });

        await check('the PDF icon at the title is the picture of the viewer, drawn as it is', async () => {
            const page = await H.open(browser);
            try {
                const img = await page.evaluate(() => {
                    const i = document.querySelector('#vo-tb [data-zone="start"] img.vo-file-icon');
                    const t = document.querySelector('#vo-tb [data-zone="start"] .vo-title');
                    return i && {src: i.src, loaded: i.complete && i.naturalWidth > 0, w: i.getBoundingClientRect().width,
                        before: !!t && !!(i.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING),
                        mask: getComputedStyle(i).maskImage || getComputedStyle(i).webkitMaskImage, alt: i.alt, hidden: i.getAttribute('aria-hidden')};
                });
                assert.ok(img, 'no PDF icon at the title');
                assert.equal(img.src, 'http://stand.test/web-apps/apps/pdfeditor/main/resources/img/compact/pdf.svg');
                assert.equal(img.loaded, true, 'the PDF icon file is not there');
                assert.equal(img.before, true, 'the PDF icon is not before the title');
                assert.equal(img.w, 18);
                assert.ok(!img.mask || img.mask === 'none', 'the PDF icon is a mask: ' + img.mask);
                assert.deepEqual([img.alt, img.hidden], ['', 'true'], 'the PDF icon is not decorative');
                const file = read(path.join(APP, 'main/resources/img/compact/pdf.svg'));
                assert.match(file, /^<svg[^>]*viewBox="0 0 19 18"/, 'pdf.svg is not the 19 × 18 picture');
                assert.doesNotMatch(file, /<script|href=|foreignObject/i, 'pdf.svg runs or loads something');
                assert.deepEqual(page.errors, []);
            } finally {
                await page.close();
            }
        });
    } finally {
        await browser.close();
    }

    await check('every requested name is drawn by the shared module as an AIR mask', async () => {
        const Icons = loadIcons();
        const all = new Map([...catalogNames(), ...literalNames()]);
        all.forEach((where, name) => {
            assert.equal(Icons.has(name), true, name + ': has() (' + where + ')');
            const html = Icons.svg(name, 24);
            assert.ok(html.indexOf('class="vo-air"') > 0, name + ' is not an AIR mask: ' + html);
            assert.ok(html.indexOf('--vo-air-size:24px;') > 0, name + ' keeps the size: ' + html);
            assert.ok(html.indexOf(SHARED_URL + name + '.svg)') > 0, name + ' is not a shared file: ' + html);
            assert.ok(!/(?:https?:)?\/\/[a-z]/i.test(html.split(SHARED_URL).join('')), name + ': an address outside the editor');
        });
        ['nope', 'toString', 'constructor', '__proto__'].forEach(name => {
            assert.equal(Icons.has(name), false, 'has(' + name + ')');
            assert.equal(Icons.svg(name), '', 'svg(' + name + ')');
        });
    });

    /* Full screen of the viewer is the presentation glyph of AIR (demonstration-on); fit width of the viewer is the
       landscape sheet of the shared set with a two-way arrow from edge to edge. */
    await check('full screen is the AIR presentation glyph, fit width the landscape sheet with a two-way arrow', async () => {
        const body = file => read(path.join(AIR_DIR, file + '.svg')).trim().split('\n').slice(1, -1);
        const full = body('demonstration');
        assert.equal(full.length, 3, 'demonstration is not the three paths of demonstration-on');
        assert.match(full[0], /^<path d="M8\.22734 8\.49609/, 'demonstration is not the demonstration-on glyph of AIR');
        assert.match(full[2], /d="M7\.11895 5\.03418/, 'demonstration has no board on a stand');
        const fit = body('fitLandscape');
        assert.deepEqual(fit.slice(0, -1), body('landscape'), 'fit width is not the landscape sheet');
        assert.match(fit[fit.length - 1], /^<path d="M8\.3 12H15\.7M9\.9 10\.4L8\.3 12L9\.9 13\.6M14\.1 10\.4L15\.7 12L14\.1 13\.6" stroke="#333333"/,
            'fit width has no two-way arrow');
    });

    await check('apps/pdfeditor has no AIR icons of its own', async () => {
        const all = filesUnder(APP);
        const airDirs = all.filter(f => /[\\/]img[\\/]air[\\/]/.test(path.relative(ROOT, f)));
        assert.deepEqual(airDirs.map(f => path.relative(ROOT, f)), [], 'an own AIR folder in apps/pdfeditor');
        assert.ok(!exists(path.join(APP, 'main/app/view/Icons.js')), 'an own Icons.js in apps/pdfeditor');
        /* No copy of a shared AIR file under any name. */
        const shared = new Map(fs.readdirSync(AIR_DIR).filter(f => f.endsWith('.svg')).map(f => [objectId(fs.readFileSync(path.join(AIR_DIR, f))), f]));
        const copies = all.filter(f => f.endsWith('.svg')).filter(f => shared.has(objectId(fs.readFileSync(f))))
            .map(f => path.relative(ROOT, f) + ' = ' + shared.get(objectId(fs.readFileSync(f))));
        assert.deepEqual(copies, [], 'copies of shared AIR files in apps/pdfeditor');
        /* Nobody points at an own set: views, controllers and styles take the shared one. */
        const hits = [];
        for (const dir of ['main/app/view', 'main/app/controller', 'main/resources/less']) {
            filesUnder(path.join(APP, dir)).filter(f => /\.(js|less)$/.test(f)).forEach(f => read(f).split('\n').forEach((line, i) => {
                if (/pdfeditor\/main\/app\/view\/Icons|PDFE\.Views\.Icons|['"(](\.\/)?resources\/img\/air\//.test(line))
                    hits.push(path.relative(ROOT, f) + ':' + (i + 1) + ': ' + line.trim().slice(0, 90));
            }));
        }
        assert.deepEqual(hits, [], 'the viewer points at an own icon set');
        assert.match(read(H.moduleFile('CompactShell')), /'common\/main\/lib\/view\/compact\/Icons'/, 'CompactShell does not require the shared icons');
        for (const view of ['CompactShell', 'CompactToolbar'])
            assert.match(read(H.moduleFile(view)), /Common\.UI\.Compact[^;\n]*\bIcons\b/, view + ' does not draw with the shared icons');
    });

    done();
})().catch(e => { console.log('FAIL run —', e && e.stack || e); process.exitCode = 1; });
