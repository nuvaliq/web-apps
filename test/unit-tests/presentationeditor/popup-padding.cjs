/* Run: node test/unit-tests/presentationeditor/popup-padding.cjs [path to compact-<zone>[.<anything>].less [path to CompactToolbar.js]]
 * Popup panels of the presentation shell toolbar use one scale with the bridge lists
 * at buttons ("Image ▾", compact-galleries.less): padding 18 on all sides.
 *  - A list ("Text box ▾", case, zoom, font, font size, line weight and type): padding 18 at the top and
 *    bottom, rows 38 full width without a gap, caption from 18, a 42 column on the right, font size 13
 *    in the shell font, regular weight; a list menu starts from 266, a value list is not narrower than the field;
 *    the selected row is filled with the selection fill; the divider has 7 above and below it, 18 at the sides.
 *  - Icon rows ("Text ▾", "Alignment ▾", "Lists ▾") and "⋯" have padding 18.
 *  - Palette: padding 18 at the top and bottom, the reset row is a list row, the grid and "Custom color"
 *    start from 18, under the divider 18.
 *  - A line sample is 60 × 20, not a 300 × 150 svg without a size.
 *  - Own value names do not coincide with the header menu names (@vo-pop-* in compact-shell.less):
 *    less variables are global, and a coinciding name would override the header menu padding.
 *  - An own panel at the right edge of the window (a button in "⋯", the end of the row) shifts inside the window.
 *  - Text smoothing of the bridge lists and galleries and of the section card is the same as the shell's
 *    (antialiased): they lie in the stock markup outside #vo-shell, and without it captions on macOS
 *    are thicker than in its own lists ("Image ▾" bolder than "Text box ▾").
 *
 * The styles are the resulting CSS of compact-toolbar.less compiled by the less package from build/node_modules
 * (of the tree or the main web-apps copy) with the compact-shell.less variables by reference. The place is the DOM
 * model and layouts of the toolbar acceptance fixture (acceptance/bar-harness.cjs). The optional
 * arguments are corrupted copies of the files for a negative control.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const H = require('./acceptance/bar-harness.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const LESS_DIR = path.join(ROOT, 'apps/presentationeditor/main/resources/less');
const LESS_FILE = process.argv[2] ? path.resolve(process.argv[2]) : null;
let viewDir;
if (process.argv[3]) {
    viewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'popup-padding-'));
    fs.copyFileSync(path.resolve(process.argv[3]), path.join(viewDir, 'CompactToolbar.js'));
}

const TB = '#vo-tb ';

function lessCompiler() {
    const roots = [path.join(ROOT, 'build')];
    try {
        const common = cp.execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
            {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
        roots.push(path.join(path.dirname(common), 'build'));
    } catch (e) { /* without git, only the tree */ }
    for (const r of roots) {
        try { return require(require.resolve('less', {paths: [r]})); } catch (e) { /* next */ }
    }
    throw new Error('the less compiler is not found (npm install in build/ of the web-apps copy)');
}

/* The styles directory: its own or a temporary copy with the zone file replaced, its name up to the first dot
   (compact-menu.old.less replaces compact-menu.less). */
const SUBST = LESS_FILE ? path.basename(LESS_FILE).split('.')[0] + '.less' : null;
function lessDir() {
    if (!LESS_FILE) return LESS_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popup-padding-less-'));
    for (const name of fs.readdirSync(LESS_DIR).filter(n => /^compact-.*\.less$/.test(n))) {
        fs.copyFileSync(name === SUBST ? LESS_FILE : path.join(LESS_DIR, name), path.join(dir, name));
    }
    return dir;
}

/* The whole shell cascade (variables as in the build) or the rules of one file. */
async function compile(dir, name) {
    const entry = path.join(dir, '__popup-padding.less');
    const src = name ? '@import (reference) "compact-shell.less";\n@import (multiple) "' + name + '";\n' : '@import "compact-shell.less";\n';
    const out = await lessCompiler().render(src, {filename: entry, javascriptEnabled: true});
    return out.css;
}

/* Flat rules: [{sel, decls: [{prop, value}]}], one element per selector. */
function rules(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(-\w+-)?keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
        const prelude = m[1].trim();
        if (prelude.startsWith('@')) continue;
        const decls = m[2].split(';').map(d => {
            const i = d.indexOf(':');
            return i > 0 ? {prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim()} : null;
        }).filter(Boolean);
        if (!decls.length) continue;
        let depth = 0, cur = '';
        const sels = [];
        for (const ch of prelude) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && !depth) { sels.push(cur); cur = ''; } else cur += ch;
        }
        sels.push(cur);
        for (const sel of sels) out.push({sel: sel.trim().replace(/\s+/g, ' '), decls});
    }
    return out;
}

/* The last value of a property among the rules with the exact selector, as in the cascade. */
function value(list, sel, prop) {
    let v = null;
    for (const r of list) if (r.sel === sel) for (const d of r.decls) if (d.prop === prop) v = d.value;
    assert.ok(v !== null, 'no rule ' + sel + ' { ' + prop + ' }');
    return v;
}

const px = v => parseFloat(v);

async function main() {
    const dir = lessDir();
    const tb = rules(await compile(dir, 'compact-toolbar.less'));
    const all = rules(await compile(dir));
    const src = fs.readFileSync(SUBST === 'compact-toolbar.less' ? LESS_FILE : path.join(LESS_DIR, 'compact-toolbar.less'), 'utf8');
    const v = (sel, prop) => value(tb, sel, prop);
    const tests = [
        {
            name: 'panels_and_more_padded_by_18',
            run() {
                assert.equal(v(TB + '.vo-pop', 'padding'), '18px', 'a toolbar popup is not padded by 18');
                assert.equal(v(TB + '.vo-of-pop', 'padding'), '18px', 'the «⋯» panel is not padded by 18');
            }
        },
        {
            name: 'lists_on_the_bridge_list_scale',
            run() {
                const list = TB + '.vo-pop-list';
                assert.equal(v(list, 'padding'), '18px 0', 'a toolbar list is not padded by 18 above and below');
                assert.equal(v(list, 'gap'), '0', 'toolbar list rows have a gap');
                assert.equal(v(list, 'min-width'), '266px', 'a menu list is not at least 266, like the bridge lists');
                assert.equal(v(TB + '.vo-value > .vo-pop-list', 'min-width'), '100%', 'a value list is narrower than its field');
                assert.equal(v(list, 'max-height'), 'min(480px, calc(100vh - 140px))', 'a list is capped below the window height');
                const row = list + ' .vo-pop-item';
                assert.equal(v(row, 'min-height'), '38px', 'a toolbar list row is not 38');
                assert.equal(v(row, 'padding'), '0 42px 0 18px', 'a toolbar list row label does not start at 18 (42 on the right)');
                assert.equal(v(row, 'font-size'), '13px', 'a toolbar list row font is not 13');
                assert.equal(v(row, 'font-weight'), '400', 'a toolbar list row is not regular');
                assert.equal(v(row, 'line-height'), '16px', 'a toolbar list row line is not 16, like the bridge rows');
                assert.ok(/system-ui/.test(v(row, 'font-family')), 'a toolbar list row is not in the shell font');
                assert.equal(v(row + '.on', 'background'), 'var(--vo-selected)', 'the chosen row is not filled with the selection');
                assert.equal(v(row + '.on', 'color'), 'var(--vo-text)', 'the chosen row keeps a coloured label');
                assert.equal(v(row + ':disabled', 'color'), 'var(--vo-text-off)', 'a disabled row is not greyed');
                assert.equal(v(list + ' .vo-pop-hr', 'margin'), '7px 18px', 'a list divider is not 7 above and below, 18 at the sides');
                assert.equal(v(list + ' .vo-pop-img', 'width'), '60px', 'a line sample is not 60 wide');
                assert.equal(v(list + ' .vo-pop-img', 'height'), '20px', 'a line sample is not 20 high');
            }
        },
        {
            /* Bridge lists at buttons use the same scale (compact-galleries.less): row 38, caption from 18,
               42 on the right, window padding 18 at the top and bottom. */
            name: 'own_lists_match_the_bridge_lists',
            run() {
                const bridge = 'body.vo-compact.vo-gallery .vo-gallery-target:has(> li > a)';
                assert.equal(value(all, bridge, 'padding'), '18px 0', 'the bridge list is not padded by 18');
                assert.equal(value(all, bridge + ' > li > a', 'padding-inline'), '18px 42px', 'the bridge row label does not start at 18');
                const pb = px(value(all, bridge + ' > li > a', 'padding-block'));
                assert.equal(pb * 2 + px(value(all, bridge + ' > li > a', 'line-height')), px(v(TB + '.vo-pop-list .vo-pop-item', 'min-height')),
                    'own and bridge list rows differ in height');
                assert.equal(value(all, bridge + ' > li > a', 'font-size'), v(TB + '.vo-pop-list .vo-pop-item', 'font-size'), 'own and bridge rows differ in size');
            }
        },
        {
            name: 'palette_padded_by_18',
            run() {
                const pal = TB + '.vo-pop-palette';
                assert.equal(v(pal, 'padding'), '18px 0', 'a palette is not padded by 18 above and below');
                assert.equal(v(pal + ' .vo-pal-reset', 'min-height'), '38px', 'the reset row is not a 38 list row');
                assert.equal(v(pal + ' .vo-pal-reset', 'padding'), '0 42px 0 18px', 'the reset row label does not start at 18');
                assert.equal(v(pal + ' .vo-pal-sep', 'margin'), '7px 18px 18px', 'the palette divider is not 18 above the swatches');
                assert.equal(v(pal + ' .vo-pal-grid', 'padding'), '0 18px', 'the swatches are not 18 from the sides');
                assert.equal(v(pal + ' .vo-pal-toggle', 'margin'), '12px 18px 0', '«Custom colour» is not 18 from the side');
            }
        },
        {
            /* Header menus ("Download", mode) use their own 13/17 scale and a caption from 14: the panel
               value names do not coincide with theirs. */
            name: 'header_menus_keep_their_own_scale',
            run() {
                const own = (src.match(/^@[\w-]+(?=\s*:)/gm) || []);
                assert.deepEqual(own.filter(n => /^@vo-pop-/.test(n)), [], 'the toolbar redefines the header menu sizes');
                assert.equal(value(all, 'body.vo-compact .vo-hd .vo-pop-wrap .vo-pop', 'padding'), '13px 0 17px', 'the header menu lost its 13/17 margins');
            }
        },
        {
            name: 'bridge_popups_and_card_smoothed_like_the_shell',
            run() {
                const sm = sel => value(all, sel, '-webkit-font-smoothing');
                assert.equal(sm('#vo-shell'), 'antialiased', 'the shell text is not antialiased');
                assert.equal(sm('body.vo-compact.vo-gallery .vo-gallery-target'), 'antialiased',
                    'bridge lists and galleries keep the stock smoothing — «Image ▾» looks bolder than «Text box ▾»');
                assert.equal(sm('body.vo-compact.vo-right-open #view-right-menu'), 'antialiased', 'the section card keeps the stock smoothing');
                assert.equal(value(all, 'body.vo-compact.vo-gallery .vo-gallery-target', '-moz-osx-font-smoothing'), 'grayscale', 'bridge popups: no Firefox smoothing');
            }
        },
        {
            /* A palette at a button at the end of the row is at the right edge of the window: it shifts inside the window. */
            name: 'popup_at_the_window_edge_stays_inside',
            async run() {
                const W = 1280;
                const env = H.createEnv({kind: 'table', width: W, viewDir});
                await env.mount();
                const btn = env.controls().find(el => el.getAttribute('data-vo') === 'tableBorder');
                assert.ok(btn, 'no table border button');
                const wrap = btn.parentNode;
                const pop = wrap.querySelector('.vo-pop');
                /* The button is at the right edge of the window. */
                const r0 = btn.getBoundingClientRect();
                const shift = W - 40 - r0.left;
                wrap.getBoundingClientRect = () => ({left: r0.left + shift, right: r0.left + shift + r0.width, top: r0.top, bottom: r0.bottom, width: r0.width, height: r0.height});
                const natural = pop.getBoundingClientRect.bind(pop);
                pop.getBoundingClientRect = () => {
                    const r = natural();
                    const left = r0.left + shift + (parseFloat(pop.style.left) || 0);
                    return {left, right: left + 340, top: r.top, bottom: r.bottom, width: 340, height: r.height};
                };
                await env.click(btn);
                assert.ok(!pop.hasAttribute('hidden'), 'the palette did not open');
                const r = pop.getBoundingClientRect();
                assert.ok(r.right <= W - 8 + 0.5, 'the palette goes past the right window edge: ' + r.left + '..' + r.right + ' of ' + W);
                assert.ok(r.left >= 8 - 0.5, 'the palette goes past the left window edge: ' + r.left);
            }
        }
    ];
    let failed = 0;
    for (const t of tests) {
        try { await t.run(); console.log('ok ' + t.name); }
        catch (e) { failed++; console.log('FAIL ' + t.name + ': ' + (e && e.message ? e.message.replace(/\s+/g, ' ') : e)); }
    }
    console.log((tests.length - failed) + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.log('FAIL setup: ' + (e && e.stack || e)); process.exitCode = 1; });
