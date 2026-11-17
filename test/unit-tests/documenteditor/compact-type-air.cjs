/* Run after the document editor LESS build: node test/unit-tests/documenteditor/compact-type-air.cjs
 * COMPACT_CSS_DOCUMENTEDITOR (or COMPACT_CSS) names the compiled app.css.
 * Type of the compact shell of the document editor on the AIR design system: the system font stack of AIR
 * (--ui-font-family-system) and no Inter over it, letter spacing only from the AIR scale
 * (--ui-text-letter-spacing-*: -0.03em, -0.02em, -0.01em, 0.025em, auto) and font sizes from the AIR scale.
 * The LESS sources of the shell (the shared tokens.less, menu.less and about.less, then compact-shell.less and the window
 * files it imports with the shared window template, in the import order of app.less) are read as text; two px letter spacings of the window
 * files are known exceptions, named one by one; the compiled styles are checked in headless Chrome through
 * Playwright over fixtures/compact-shell-page.cjs (the real menu bar, outline rail and title fitting of the
 * shell), with the header title, the mode button, the toolbar value, the status button, the slash item and
 * the titles of the link and About windows added to the page.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const shellPage = require('./fixtures/compact-shell-page.cjs');

const ROOT = shellPage.ROOT;
const SOURCES = [
    'apps/common/main/resources/less/compact/tokens.less',
    'apps/common/main/resources/less/compact/menu.less',
    'apps/common/main/resources/less/compact/about.less',
    'apps/documenteditor/main/resources/less/compact-shell.less',
    /* Imported at the end of compact-shell.less, in this order; compact-windows.less starts with the
       shared window template. */
    'apps/common/main/resources/less/compact/windows.less',
    'apps/documenteditor/main/resources/less/compact-windows.less',
    'apps/documenteditor/main/resources/less/compact-bookmarks.less',
    'apps/documenteditor/main/resources/less/compact-watermark.less'
];
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* --ui-font-family-system of the AIR design tokens. */
const AIR_FONT = ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Ubuntu',
    'Helvetica Neue', 'Arial', 'sans-serif', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'];
/* --ui-text-letter-spacing-neg-1..3 and -1 in em; auto is no spacing. */
const AIR_TRACK = [-0.03, -0.02, -0.01, 0.025];
/* --ui-font-size-* and the text and headline sizes of the AIR typography, px. */
const AIR_SIZES = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 25, 28];

/* Letter spacings off the AIR scale that stay as they are, each by its file, variable and value: the title of
   the compact windows and the small buttons of the watermark window. Any other value, or one of these changed,
   fails the check. */
const TRACK_EXCEPTIONS = [
    {file: 'windows.less', raw: '@vo-win-title-ls', value: '-.2px'},
    {file: 'compact-watermark.less', raw: '@vo-wm-sm-ls', value: '-.15px'}
];
const isTrackException = d => TRACK_EXCEPTIONS.some(e => e.file === d.file && e.raw === d.raw && e.value === d.value);

const family = value => String(value).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));

/* --- LESS sources ---------------------------------------------------------------------------- */

/* Comments out, lines kept: the line of a declaration is its line in the file. */
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').map(l => l.replace(/(^|[^:"'])\/\/.*$/, '$1')).join('\n');

/* LESS variables of the sources in import order: the last declaration wins, as in LESS. */
function lessVars() {
    const vars = {};
    for (const rel of SOURCES)
        for (const m of stripComments(read(rel)).matchAll(/^\s*@(vo-[\w-]+)\s*:\s*([^;]+);/gm))
            vars[m[1]] = m[2].replace(/\s+/g, ' ').trim();
    return vars;
}

/* Every declaration of a property in the sources, variables resolved: [{file, line, raw, value}]. */
function declarations(prop) {
    const vars = lessVars();
    const resolve = (value, seen = 0) => {
        const m = /^@(vo-[\w-]+)$/.exec(value);
        if (!m) return value;
        assert.ok(m[1] in vars && seen < 10, 'variable @' + m[1] + ' is declared');
        return resolve(vars[m[1]], seen + 1);
    };
    const out = [];
    for (const rel of SOURCES) {
        const text = stripComments(read(rel));
        const re = new RegExp('(^|[\\s;{])' + prop + '\\s*:\\s*([^;}]+)', 'g');
        for (const m of text.matchAll(re)) {
            const raw = m[2].replace(/!important/, '').trim();
            out.push({file: path.basename(rel), line: text.slice(0, m.index).split('\n').length, raw, value: resolve(raw)});
        }
    }
    return out;
}

/* A letter spacing of the AIR scale: one of its em values, or none. */
function onTrackScale(value) {
    if (value === 'normal' || value === '0') return true;
    const m = /^(-?)(\d*\.?\d+)em$/.exec(value);
    return !!m && AIR_TRACK.some(v => Math.abs(v - Number(m[1] + m[2])) < 1e-9);
}

function builtCss() {
    const file = process.env.COMPACT_CSS_DOCUMENTEDITOR || process.env.COMPACT_CSS;
    if (!file || !fs.existsSync(file))
        throw new Error('set COMPACT_CSS_DOCUMENTEDITOR to app.css of the document editor LESS build');
    return fs.readFileSync(file, 'utf8');
}

/* --- The page ------------------------------------------------------------------------------- */

/* Text parts of the shell the fixture page does not draw: classes and nesting as the shell builds them. */
const EXTRA = {
    '.vo-hd': '<input type="text" class="vo-hd-title" value="Quarterly report 2026">' +
        '<div class="vo-hd-right"><span class="vo-docmode"><button type="button" class="vo-mode">Editing</button></span></div>',
    '#vo-tb .vo-of': '<span class="vo-value"><button type="button" class="vo-value-btn"><span class="vo-value-label">Arial</span></button></span>',
    '#vo-status': '<button type="button" class="vo-st-btn">English</button>',
    'body': '<div id="vo-slash"><div class="vo-slash-item"><span class="vo-slash-t">Table</span></div></div>' +
        '<div id="vo-link" class="open"><div class="vo-link-hd"><div class="vo-link-title">Link</div></div></div>' +
        '<div class="asc-window vo-about-dlg"><div class="header"><div class="title">About</div></div></div>'
};

/* Text of the shell checked on the page: name → selector. */
const PARTS = {
    title: '.vo-hd .vo-hd-title',
    sizer: '.vo-hd-sizer',
    mode: '.vo-hd .vo-mode',
    menu: '.vo-mn-wrap:not(.vo-mn-more) > .vo-mn-item',
    more: '.vo-mn-more > .vo-mn-item',
    menuRow: '.vo-mn-drop.open .vo-mn-sub',
    value: '#vo-tb .vo-value-label',
    status: '#vo-status .vo-st-btn',
    outline: '#vo-outline .vo-outline-item',
    count: '#vo-outline .vo-outline-count',
    slash: '#vo-slash .vo-slash-t',
    link: '#vo-link .vo-link-title',
    about: '.asc-window.vo-about-dlg > .header .title'
};

/* Font sizes of the parts, px: the sizes the shell already had, not changed by the type. */
const SIZES = {title: 18, sizer: 18, mode: 15, menu: 13, more: 13, menuRow: 13, value: 13, status: 11, outline: 12,
    count: 13, slash: 13, link: 19, about: 19};

/* Letter spacing of the parts on the AIR scale, em: the name and its twin in the header and the titles of the
   link and About windows −0.01em, the rest none — the mode button in the header among them. */
const TRACKS = {title: -0.01, sizer: -0.01, mode: 0, menu: 0, more: 0, menuRow: 0, value: 0, status: 0, outline: 0,
    count: 0, slash: 0, link: -0.01, about: -0.01};

/* The fixture page with the text parts added. Wide, the outline list is opened and the View section of the
   menu shows its rows; closed, the rail is a pill with the count. A narrow page puts menu sections into "…". */
async function shellPageWithText(browser, {width = 1280, open = true} = {}) {
    const page = await shellPage.open(browser, {width});
    await page.evaluate(extra => {
        for (const [where, html] of Object.entries(extra)) document.querySelector(where).insertAdjacentHTML('beforeend', html);
        /* The width of the name field as the shell gives it: fitTitle over the hidden twin. */
        shell.fitTitle.call({$title: $('.vo-hd .vo-hd-title')});
    }, EXTRA);
    /* The rail opens by itself on a wide page only: its toggle sets the state asked for. */
    if (await page.evaluate(() => rail.open) !== open) await page.click('#vo-outline .vo-outline-toggle');
    if (open) await page.click('.vo-mn-item[data-k="view"]');
    await shellPage.settle(page);
    assert.equal(await page.evaluate(() => rail.open), open, 'the outline rail is ' + (open ? 'open' : 'closed'));
    return page;
}

/* Computed type of every part: font family, size and spacing in px (spacing 0 for normal). */
function type(page) {
    return page.evaluate(parts => {
        const out = {};
        for (const [name, sel] of Object.entries(parts)) {
            const el = document.querySelector(sel);
            if (!el) { out[name] = null; continue; }
            const cs = getComputedStyle(el);
            out[name] = {family: cs.fontFamily, size: parseFloat(cs.fontSize), weight: cs.fontWeight,
                spacing: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing)};
        }
        return out;
    }, PARTS);
}

(async () => {
    const {check, done} = shellPage.checker();

    await check('shell font stack has no Inter and starts with the AIR system stack', async () => {
        const vars = lessVars();
        assert.deepEqual(family(vars['vo-font']), AIR_FONT, '@vo-font of the shell is --ui-font-family-system');
        for (const rel of SOURCES) {
            const named = Array.from(stripComments(read(rel)).matchAll(/@vo-font\s*:\s*([^;]+);/g), m => m[1])
                .filter(v => /\binter\b/i.test(v));
            assert.deepEqual(named, [], rel + ' declares no font stack with Inter');
        }
        assert.deepEqual(declarations('font-family').filter(d => !/^(inherit|@vo-font-mono|ui-monospace\b)/.test(d.raw) &&
            family(d.value)[0] !== AIR_FONT[0]).map(d => d.file + ':' + d.line + ' ' + d.raw), [],
            'every font family of the shell rules is the AIR stack');

        const built = builtCss();
        const inter = Array.from(built.matchAll(/font-family\s*:\s*([^;}]*)/g), m => m[1]).filter(v => /\binter\b/i.test(v));
        assert.deepEqual(inter, [], 'the built styles name no Inter');

        const browser = await shellPage.launch();
        try {
            const page = await shellPageWithText(browser);
            const got = await type(page);
            for (const name of Object.keys(PARTS)) {
                assert.ok(got[name], name + ' is on the page: ' + PARTS[name]);
                // Chromium on macOS serializes BlinkMacSystemFont as its system-ui alias.
                const canonical = names => names.map(name => name === 'BlinkMacSystemFont' ? 'system-ui' : name);
                assert.deepEqual(canonical(family(got[name].family)), canonical(AIR_FONT),
                    name + ' is set in the AIR system stack');
            }
            assert.deepEqual(page.errors, []);
            await page.close();
        } finally { await browser.close(); }
    });

    await check('every letter spacing in the shell rules belongs to the AIR scale', async () => {
        const all = declarations('letter-spacing');
        assert.ok(all.length > 0, 'the shell rules set letter spacing');
        assert.deepEqual(all.filter(d => !onTrackScale(d.value) && !isTrackException(d))
            .map(d => d.file + ':' + d.line + ' ' + d.raw + ' = ' + d.value), [], 'letter spacing off the AIR scale');
        /* Each exception is still there: a value brought onto the scale leaves the list. */
        for (const e of TRACK_EXCEPTIONS)
            assert.ok(all.some(d => d.file === e.file && d.raw === e.raw && d.value === e.value && !onTrackScale(d.value)),
                'exception in use: ' + e.file + ' ' + e.raw + ' = ' + e.value);

        const browser = await shellPage.launch();
        try {
            const page = await shellPageWithText(browser);
            const got = await type(page);
            for (const [name, em] of Object.entries(TRACKS)) {
                assert.ok(got[name], name + ' is on the page: ' + PARTS[name]);
                const ratio = got[name].spacing / got[name].size;
                assert.ok(ratio === 0 || AIR_TRACK.some(v => Math.abs(v - ratio) < 1e-3),
                    name + ': ' + got[name].spacing + 'px at ' + got[name].size + 'px is off the AIR scale');
                assert.ok(Math.abs(ratio - em) < 1e-3, name + ': ' + got[name].spacing + 'px at ' + got[name].size +
                    'px, expected ' + em + 'em');
            }
            assert.deepEqual(page.errors, []);
            await page.close();
        } finally { await browser.close(); }
    });

    await check('font sizes stay on the AIR scale', async () => {
        /* inherit gives a caption the size of its control: no size of its own. */
        const off = declarations('font-size').filter(d => {
            if (d.value === 'inherit') return false;
            const m = /^(\d*\.?\d+)px$/.exec(d.value);
            return !m || !AIR_SIZES.includes(Number(m[1]));
        });
        assert.deepEqual(off.map(d => d.file + ':' + d.line + ' ' + d.raw + ' = ' + d.value), [], 'font sizes off the AIR scale');

        const browser = await shellPage.launch();
        try {
            const page = await shellPageWithText(browser);
            const got = await type(page);
            for (const [name, size] of Object.entries(SIZES)) {
                assert.ok(got[name], name + ' is on the page: ' + PARTS[name]);
                assert.equal(got[name].size, size, name + ' keeps its font size');
            }
            await page.close();
        } finally { await browser.close(); }
    });

    await check('name, overflow and outline count are not cut', async () => {
        const browser = await shellPage.launch();
        try {
            const cut = (page, names) => page.evaluate(([parts, names]) => names.map(name => {
                const el = document.querySelector(parts[name]);
                if (!el || !el.getClientRects().length) return name + ': not shown';
                return el.scrollWidth > el.clientWidth ? name + ': ' + el.scrollWidth + ' > ' + el.clientWidth : null;
            }).filter(Boolean), [PARTS, names]);
            for (const width of [1280, 380]) {
                const page = await shellPageWithText(browser, {width, open: false});
                const got = await type(page);
                /* The twin measures the field: it must be set as the name is. */
                for (const key of ['family', 'size', 'weight', 'spacing'])
                    assert.equal(got.sizer[key], got.title[key], 'the twin of the name has its ' + key);
                /* Wide, the name has its room; narrow, the menu bar shows "…". */
                assert.deepEqual(await cut(page, width > 1000 ? ['title', 'count'] : ['more', 'count']), [],
                    width + 'px: text is not cut');
                assert.equal(await page.evaluate(sel => document.querySelector(sel).textContent.trim(), PARTS.count), '2',
                    'the outline count shows the headings');
                assert.deepEqual(page.errors, []);
                await page.close();
            }
        } finally { await browser.close(); }
    });

    done();
})().catch(error => { console.error(error); process.exitCode = 1; });
