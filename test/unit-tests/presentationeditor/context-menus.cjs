/* Run: node test/unit-tests/presentationeditor/context-menus.cjs [path to compact-menu.less [path to compact-galleries.less]]
 * Stock context menus of the presentation editor (DocumentHolder: slideMenu, textMenu,
 * pictureMenu, tableMenu, viewModeMenuSlide, viewModeMenu) in the shell: their look only:
 * the rules sit under body.vo-compact, in the menu containers #editor_sdk > #menu-container-<id>,
 * set the shell menu look and do not hide or rearrange items or turn the tiles of the
 * layout and theme galleries into a list. The "Change layout ▸" and "Change theme ▸" galleries are tiles
 * on the shell gallery scale (compact-galleries.less): layouts in three columns of 120, a picture
 * with rounding 6.
 *
 * The resulting CSS is checked: compact-menu.less and compact-galleries.less are compiled by the
 * less package from build/node_modules (of the tree or the main web-apps copy) with the
 * compact-shell.less variables attached by reference, so the output has only the rules of these files.
 * The bridge gallery rules (body.vo-compact.vo-gallery …) are checked by galleries.cjs; here they are
 * affected only by the ban on turning tiles into a list. The optional arguments are corrupted
 * copies of the files for a negative control.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const LESS_DIR = path.join(ROOT, 'apps/presentationeditor/main/resources/less');
const SUBST = {
    'compact-menu.less': process.argv[2] ? path.resolve(process.argv[2]) : null,
    'compact-galleries.less': process.argv[3] ? path.resolve(process.argv[3]) : null
};

/* Stock menu nodes: the menus themselves, items, dividers, submenus, layout and theme galleries. */
const STOCK = /\.dropdown-menu\b|\.dropdown-submenu\b|\.menu-item\b|\.menu-item-icon\b|\.divider\b|menu-container-|#id-docholder-menu-|\.menu-layouts\b/;
const SCOPE = /^body\.vo-compact(\.[-\w]+)* #editor_sdk > \[id\^="menu-container-"\] /;
const ITEM = /(\bli\b|\.menu-item\b|\ba\b)[^ ]*$/;
const TILE = /\.item\b|\.layout\b|\.style\b/;
/* Bridge galleries at buttons and the menu bar are not context menus. */
const BRIDGE = /^body\.vo-compact(\.[-\w]+)*\.vo-gallery\b/;

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

/* The styles directory: its own or a temporary copy with replaced files. */
function lessDir() {
    if (!SUBST['compact-menu.less'] && !SUBST['compact-galleries.less']) return LESS_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-menus-'));
    for (const name of fs.readdirSync(LESS_DIR).filter(n => /^compact-.*\.less$/.test(n))) {
        fs.copyFileSync(SUBST[name] || path.join(LESS_DIR, name), path.join(dir, name));
    }
    return dir;
}

/* Only the rules of compact-menu.less and compact-galleries.less: shell variables and mixins
   by reference. */
async function compileMenu() {
    const dir = lessDir();
    const entry = path.join(dir, '__context-menus.less');
    const src = '@import (reference) "compact-shell.less";\n@import (multiple) "compact-menu.less";\n' +
        '@import (multiple) "compact-galleries.less";\n';
    const out = await lessCompiler().render(src, {filename: entry, javascriptEnabled: true});
    return out.css;
}

/* Flat rules with declarations: [{sel, decls: [{prop, value}]}], one element per selector
   (commas inside :has()/:not() parentheses do not split a selector); @media goes inside, @keyframes
   frames are skipped. */
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

const has = (r, prop, re) => r.decls.some(d => d.prop === prop && re.test(d.value));

function hides(r) {
    return has(r, 'display', /^none\b/) || has(r, 'visibility', /^(hidden|collapse)\b/) ||
        has(r, 'pointer-events', /^none\b/) || has(r, 'opacity', /^0(\.0*)?$/) ||
        has(r, 'height', /^0(px)?$/) || has(r, 'max-height', /^0(px)?$/) || has(r, 'font-size', /^0(px)?$/);
}

function reorders(r) {
    return r.decls.some(d => d.prop === 'order') || has(r, 'flex-direction', /reverse/) ||
        has(r, 'position', /^(absolute|fixed)\b/) || has(r, 'content', /./) && !/::?(before|after)$/.test(r.sel);
}

async function main() {
    const css = await compileMenu();
    const all = rules(css);
    const stock = all.filter(r => STOCK.test(r.sel) && !BRIDGE.test(r.sel));
    const tests = [
        {
            name: 'rules_scoped_to_vo_compact',
            run() {
                assert.ok(stock.length, 'compact-menu.less has no rules for the stock context menus');
                assert.deepEqual(stock.filter(r => !SCOPE.test(r.sel)).map(r => r.sel), [],
                    'stock menu rules outside body.vo-compact #editor_sdk > #menu-container-<id>');

                /* The shell menu look: a 12 card without a border with a shadow, row 38, font size 13. */
                const menu = stock.filter(r => / \.dropdown-menu$/.test(r.sel));
                assert.ok(menu.some(r => has(r, 'border-radius', /^12px$/) && has(r, 'border', /^none$/) &&
                    has(r, 'box-shadow', /var\(--vo-shadow\)/)), 'the menu card is not the shell popup (radius 12, no border, shell shadow)');
                const row = stock.find(r => / \.dropdown-menu li > a$/.test(r.sel));
                assert.ok(row, 'no rule for the menu rows');
                const px = p => parseFloat((row.decls.find(d => d.prop === p) || {}).value);
                assert.equal(px('padding-block') * 2 + px('line-height'), 38, 'menu row height is not 38');
                assert.ok(has(row, 'font-size', /^13px$/), 'menu row font is not 13px');
                assert.ok(stock.some(r => / \.divider$/.test(r.sel) && has(r, 'margin', /^7px 23px 7px 14px$/)),
                    'the divider has no shell margins');

                /* Colors only in the light theme. */
                const colored = stock.filter(r => r.decls.some(d => /^(color|background|background-color)$/.test(d.prop)));
                assert.ok(colored.length, 'no colours for the light theme');
                assert.deepEqual(colored.filter(r => !/^body\.vo-compact\.theme-type-light /.test(r.sel)).map(r => r.sel), [],
                    'menu colours outside the light theme');
            }
        },
        {
            name: 'no_rule_hides_or_reorders_items',
            run() {
                assert.deepEqual(stock.filter(hides).map(r => r.sel), [], 'shell styles hide stock menu items or menus');
                assert.deepEqual(stock.filter(reorders).map(r => r.sel), [], 'shell styles reorder or move stock menu items');
                const items = stock.filter(r => ITEM.test(r.sel));
                assert.ok(items.length, 'no rules for the stock menu items');

                /* The "Change layout ▸" and "Change theme ▸" galleries are tiles of the stock DataView
                   (the bridge galleries too). */
                const tiles = all.filter(r => TILE.test(r.sel) && /\.dataview\b|#id-docholder-menu-|\.menu-layouts\b/.test(r.sel));
                assert.ok(tiles.some(r => SCOPE.test(r.sel)), 'no rules for the context gallery tiles');
                assert.deepEqual(tiles.filter(r => has(r, 'width', /^100%/) || has(r, 'float', /^none\b/) ||
                    has(r, 'display', /^(block|flex)\b/)).map(r => r.sel), [], 'shell styles turn gallery tiles into a list');
            }
        },
        {
            name: 'context_galleries_on_the_shell_tile_scale',
            run() {
                /* Layouts are a grid of three columns of 120 (with the stock padding 4, 8 apart) over
                   the stock inline width, a picture with rounding 6; themes are stock tiles with
                   rounding 6. */
                const ctx = 'body.vo-compact #editor_sdk > [id^="menu-container-"] ';
                const rule = (sel, prop) => stock.filter(r => r.sel === ctx + sel && r.decls.some(d => d.prop === prop)).pop();
                const val = (r, prop) => r && (r.decls.find(d => d.prop === prop) || {}).value;
                const grid = rule('.menu-layouts .dataview.inner', 'grid-template-columns');
                assert.equal(val(grid, 'display'), 'grid', 'context layouts are not a grid');
                assert.equal(val(grid, 'grid-template-columns'), 'repeat(3, 128px)', 'context layouts are not three columns of 120 with the stock margins');
                assert.equal(val(rule('.menu-layouts', 'width'), 'width'), '396px !important', 'context layouts box is not three columns wide');
                assert.equal(val(rule('.menu-layouts .layout > div:first-child', 'border-radius'), 'border-radius'), '6px',
                    'context layout picture radius is not 6');
                assert.equal(val(rule('#id-docholder-menu-changetheme .dataview.inner > .item', 'border-radius'), 'border-radius'), '6px',
                    'context theme tile radius is not 6');
            }
        }
    ];
    let failed = 0;
    for (const t of tests) {
        try {
            t.run();
            console.log('ok ' + t.name);
        } catch (e) {
            failed++;
            console.log('FAIL ' + t.name + ': ' + String((e && e.message) || e).replace(/\s*\n\s*/g, ' '));
        }
    }
    process.exitCode = failed ? 1 : 0;
}

main().catch(e => {
    console.log('FAIL context-menus: ' + ((e && e.message) || e));
    process.exitCode = 1;
});
