/* Run: node test/unit-tests/presentationeditor/galleries.cjs [path to compact-galleries.less [path to compact-panel.less]]
 * Stock galleries and lists in the presentation editor shell: their look only. For the
 * toolbar buttons, the menu bar and the right panel sections the bridge shows the stock menu
 * (StockBridge.gallery, the .vo-gallery-target node). The rules sit under body.vo-compact (in the
 * "Stock interface" the look is stock), colors only in the light theme, nothing is hidden or
 * rearranged, tiles are not turned into a list.
 *  - The padding of a gallery and a list at a button and in the menu bar is 18 on all sides (up to the picture,
 *    button, tile, group header; for a list, up to the row at the top and bottom).
 *  - Layouts are tiles in three columns of 120 with 8 between: a picture with rounding 6 and a thin
 *    outline, caption 12, hover and selection by a 2 outline.
 *  - Shapes are 28 buttons with 2 between, rounding 4, ten columns.
 *  - Lists at buttons use the shell menu row: row 38, font size 13, window padding 18/18,
 *    the divider has 7 above and below it, 18 at the sides, width from 266.
 *  - Chart types are stock 40 tiles by the shape scale.
 *  - The context menus "Change layout ▸" and "Change theme ▸" use the same tile scale, the gallery
 *    padding is 8 (a right click is not within the scope of the 18 paddings).
 *  - Own right panel nodes: theme tiles are a picture with an outline and a caption under it,
 *    transition and animation effects are a list of 30 rows without a border.
 *
 * The resulting CSS is checked: compact-galleries.less and compact-panel.less are compiled
 * by the less package from build/node_modules (of the tree or the main web-apps copy) with the compact-shell.less
 * variables attached by reference, so the output has only the file's rules.
 * The optional arguments are corrupted copies of the files for a negative control.
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
    'compact-galleries.less': process.argv[2] ? path.resolve(process.argv[2]) : null,
    'compact-panel.less': process.argv[3] ? path.resolve(process.argv[3]) : null
};

const BRIDGE = 'body.vo-compact.vo-gallery ';
const BRIDGE_LIGHT = 'body.vo-compact.vo-gallery.theme-type-light ';
const CTX = 'body.vo-compact #editor_sdk > [id^="menu-container-"] ';
const CTX_LIGHT = 'body.vo-compact.theme-type-light #editor_sdk > [id^="menu-container-"] ';
const LIST = '.vo-gallery-target:has(> li > a)';

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
    if (!SUBST['compact-galleries.less'] && !SUBST['compact-panel.less']) return LESS_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galleries-'));
    for (const name of fs.readdirSync(LESS_DIR).filter(n => /^compact-.*\.less$/.test(n))) {
        fs.copyFileSync(SUBST[name] || path.join(LESS_DIR, name), path.join(dir, name));
    }
    return dir;
}

/* Only the rules of the name file: shell variables and mixins by reference. */
async function compile(dir, name) {
    const entry = path.join(dir, '__galleries.less');
    const src = '@import (reference) "compact-shell.less";\n@import (multiple) "' + name + '";\n';
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

const value = (r, prop) => { const d = r && r.decls.find(x => x.prop === prop); return d ? d.value : null; };
const has = (r, prop, re) => r.decls.some(d => d.prop === prop && re.test(d.value));
const px = v => parseFloat(v);

function hides(r) {
    return has(r, 'display', /^none\b/) || has(r, 'visibility', /^(hidden|collapse)\b/) ||
        has(r, 'pointer-events', /^none\b/) || has(r, 'opacity', /^0(\.0*)?$/) ||
        has(r, 'height', /^0(px)?$/) || has(r, 'max-height', /^0(px)?$/) || has(r, 'font-size', /^0(px)?$/);
}

function reorders(r) {
    return r.decls.some(d => d.prop === 'order') || has(r, 'flex-direction', /reverse/) ||
        has(r, 'position', /^(absolute|fixed)\b/) || has(r, 'content', /./) && !/::?(before|after)$/.test(r.sel);
}

/* A color in a declaration: color/background/fill, a shadow and a border with a color. */
function colors(r) {
    return r.decls.some(d => /^(color|background|background-color|fill)$/.test(d.prop) ||
        /^(box-shadow|border(-[a-z]+)?-color)$/.test(d.prop) && !/^(none|currentcolor)$/i.test(d.value));
}

/* The first rule with the exact selector that has the property prop. */
function find(list, sel, prop) {
    const r = list.filter(x => x.sel === sel && (!prop || x.decls.some(d => d.prop === prop)));
    assert.ok(r.length, 'no rule ' + sel + (prop ? ' { ' + prop + ' }' : ''));
    return r[r.length - 1];
}

async function main() {
    const dir = lessDir();
    const gal = rules(await compile(dir, 'compact-galleries.less'));
    const panel = rules(await compile(dir, 'compact-panel.less'));
    const tests = [
        {
            name: 'gallery_rules_scoped_to_the_shell_and_light_colours',
            run() {
                assert.ok(gal.length > 8, 'too few gallery rules: ' + gal.length);
                const scope = s => s.startsWith(BRIDGE) || s.startsWith(BRIDGE_LIGHT) || s.startsWith(CTX) || s.startsWith(CTX_LIGHT);
                assert.deepEqual(gal.filter(r => !scope(r.sel)).map(r => r.sel), [],
                    'gallery rules outside body.vo-compact (.vo-gallery-target of the bridge or the context menus)');
                assert.deepEqual(gal.filter(r => r.sel.startsWith(BRIDGE) && !/^body\.vo-compact\.vo-gallery(\.theme-type-light)? \.vo-gallery-target/.test(r.sel)).map(r => r.sel), [],
                    'bridge rules not on the shown gallery (.vo-gallery-target)');
                const colored = gal.filter(colors);
                assert.ok(colored.length, 'no colours for the light theme');
                assert.deepEqual(colored.filter(r => !r.sel.startsWith(BRIDGE_LIGHT) && !r.sel.startsWith(CTX_LIGHT)).map(r => r.sel), [],
                    'gallery colours outside the light theme');
            }
        },
        {
            name: 'no_rule_hides_reorders_or_lists_tiles',
            run() {
                assert.deepEqual(gal.filter(hides).map(r => r.sel), [], 'shell styles hide stock gallery items or menus');
                assert.deepEqual(gal.filter(reorders).map(r => r.sel), [], 'shell styles reorder or move stock gallery items');
                const tiles = gal.filter(r => /\.item\b|\.layout\b|\.style\b/.test(r.sel));
                assert.ok(tiles.length, 'no rules for the gallery tiles');
                assert.deepEqual(tiles.filter(r => has(r, 'width', /^100%/) || has(r, 'float', /^none\b/) ||
                    has(r, 'display', /^(block|flex)\b/)).map(r => r.sel), [], 'shell styles turn gallery tiles into a list');
            }
        },
        {
            name: 'layouts_three_columns_of_tiles',
            run() {
                /* The gallery padding up to the picture: at a button and in the menu bar it is 18 on all sides (the scroll
                   bar is inside the padding on the right), in a context menu it is 8 and 12 on the bar side. */
                for (const [base, light, pad, rail] of [[BRIDGE + '.vo-gallery-target ', BRIDGE_LIGHT + '.vo-gallery-target ', 18, 18], [CTX, CTX_LIGHT, 8, 12]]) {
                    const box = find(gal, base + '.menu-layouts', 'width');
                    const grid = find(gal, base + '.menu-layouts .dataview.inner', 'grid-template-columns');
                    assert.equal(value(grid, 'display'), 'grid', base + ': layouts are not a grid');
                    /* A column is a 120 tile with the stock padding 4: a gap of 8 between tiles. */
                    assert.equal(value(grid, 'grid-template-columns'), 'repeat(3, 128px)', base + ': layouts are not three columns of 120 with the stock margins');
                    assert.equal(value(grid, 'padding-block'), (pad - 4) + 'px', base + ': layout gallery margins are not ' + pad);
                    assert.equal(value(grid, 'padding-inline'), (pad - 4) + 'px ' + (rail - 4) + 'px', base + ': layout gallery side margins are not ' + pad + '/' + rail);
                    assert.ok(!gal.some(r => r.sel === base + '.menu-layouts .dataview.inner > .item' && r.decls.some(d => /^(margin|width|padding)/.test(d.prop))),
                        base + ': layout tiles are resized — the stock measures them once and keeps the width for the stock interface');
                    assert.equal(value(box, 'width'), (pad + 3 * 120 + 2 * 8 + rail) + 'px !important',
                        base + ': the layouts box does not hold three columns over the stock inline width');
                    assert.equal(value(box, 'margin'), '0 !important', base + ': the stock inline margins stay');
                    const pic = find(gal, base + '.menu-layouts .layout > div:first-child', 'border-radius');
                    assert.equal(value(pic, 'border-radius'), '6px', base + ': layout picture radius is not 6');
                    assert.equal(value(pic, 'margin-bottom'), '4px', base + ': caption is not 4 under the picture');
                    const cap = find(gal, base + '.menu-layouts .layout .title', 'font-size');
                    assert.equal(value(cap, 'font-size'), '12px', base + ': layout caption is not 12');
                    assert.equal(value(find(gal, light + '.menu-layouts .layout > div:first-child', 'box-shadow'), 'box-shadow'),
                        '0 0 0 1px var(--vo-border)', base + ': layout picture has no thin shell outline');
                    assert.equal(value(find(gal, light + '.menu-layouts .dataview.inner > .item:hover .layout > div:first-child'), 'box-shadow'),
                        '0 0 0 2px var(--vo-win-seg-stroke)', base + ': hovered layout has no 2px outline');
                    assert.equal(value(find(gal, light + '.menu-layouts .dataview.inner > .item.selected .layout > div:first-child'), 'box-shadow'),
                        '0 0 0 2px var(--vo-accent)', base + ': selected layout has no 2px accent outline');
                }
                assert.equal(value(find(gal, BRIDGE + '.vo-gallery-target:has(.menu-layouts)', 'padding'), 'padding'), '0',
                    'the layouts card keeps list margins');
                assert.equal(value(find(gal, CTX + '.dropdown-menu:has(> li > .menu-layouts)', 'padding'), 'padding'), '0',
                    'the context layouts submenu keeps list margins');
            }
        },
        {
            name: 'context_themes_on_the_tile_scale',
            run() {
                const item = CTX + '#id-docholder-menu-changetheme .dataview.inner > .item';
                assert.equal(value(find(gal, item, 'border-radius'), 'border-radius'), '6px', 'theme tile radius is not 6');
                assert.equal(value(find(gal, CTX + '#id-docholder-menu-changetheme .item-theme', 'border-radius'), 'border-radius'), '6px',
                    'theme picture radius is not 6');
                const light = CTX_LIGHT + '#id-docholder-menu-changetheme .dataview.inner > .item';
                assert.equal(value(find(gal, light, 'box-shadow'), 'box-shadow'), '0 0 0 1px var(--vo-border)', 'theme tile has no thin outline');
                assert.equal(value(find(gal, light + ':hover:not(.disabled)'), 'box-shadow'), '0 0 0 2px var(--vo-win-seg-stroke)', 'hovered theme has no 2px outline');
                assert.equal(value(find(gal, light + '.selected:not(.disabled)'), 'box-shadow'), '0 0 0 2px var(--vo-accent)', 'selected theme has no accent outline');
            }
        },
        {
            name: 'shapes_ten_columns_of_28',
            run() {
                for (const menu of ['.menu-insert-shape', '.menu-change-shape']) {
                    const base = BRIDGE + '.vo-gallery-target' + menu;
                    const card = find(gal, base, 'width');
                    const pin = value(card, 'padding-inline') || '';
                    const inner = find(gal, base + ' .dataview.inner', 'padding-inline-end');
                    const item = find(gal, base + ' .dataview .grouped-data .group-items-container .item', 'width');
                    assert.equal(value(item, 'width'), '28px', menu + ': shape button is not 28 wide');
                    assert.equal(value(item, 'height'), '28px', menu + ': shape button is not 28 high');
                    assert.equal(value(item, 'border-radius'), '4px', menu + ': shape button radius is not 4');
                    assert.equal(px(value(item, 'margin')) * 2, 2, menu + ': shape buttons are not 2 apart');
                    assert.equal(px(value(item, 'padding')) * 2 + 20, 28, menu + ': the stock 20 icon is not centred in 28');
                    /* Padding 18 up to the button and the group header: the button stands with padding 1, window padding 17,
                       18 at the top up to the header, the last group has no bottom gap between groups. */
                    /* At the top and bottom, inside the scroll window: stock writes its height inline. */
                    assert.equal(value(card, 'padding-block'), '0 !important', menu + ': shape gallery keeps margins outside its scroll box');
                    assert.equal(value(find(gal, base + ' .dataview.inner', 'padding-block'), 'padding-block'), '18px 17px',
                        menu + ': shape gallery margins are not 18 inside the scroll box');
                    assert.equal(pin, '17px 0 !important', menu + ': shape gallery side margin is not 18 over the stock !important');
                    assert.equal(value(inner, 'padding-inline-end'), '17px', menu + ': shape gallery margin on the scrollbar side is not 18');
                    const content = px(value(card, 'width')) - px(pin) - px(value(inner, 'padding-inline-end'));
                    assert.equal(content, 300, menu + ': the shape grid is not ten columns of 30 (' + content + ')');
                    assert.equal(value(find(gal, base + ' .grouped-data .group-description', 'font-size'), 'font-size'), '12px', menu + ': group caption is not 12');
                    assert.equal(value(find(gal, base + ' .grouped-data .group-description', 'padding'), 'padding'), '0 1px 2px', menu + ': group caption is not at the button edge');
                    assert.equal(value(find(gal, base + ' .grouped-data .group-items-container', 'margin-bottom'), 'margin-bottom'), '12px', menu + ': groups are not 12 apart');
                    assert.equal(value(find(gal, base + ' .grouped-data:not(:has(~ .grouped-data)) .group-items-container', 'margin-bottom'), 'margin-bottom'), '0',
                        menu + ': the last group adds its gap to the bottom margin');
                    const lb = BRIDGE_LIGHT + '.vo-gallery-target' + menu;
                    assert.equal(value(find(gal, lb + ' .grouped-data .group-description'), 'color'), 'var(--vo-text-2)', menu + ': group caption colour');
                    assert.equal(value(find(gal, lb + ' .item-shape svg.icon'), 'fill'), 'var(--vo-text-2)', menu + ': shape icon colour');
                    assert.equal(value(find(gal, lb + ' .dataview .grouped-data .group-items-container .item:hover:not(.disabled)'), 'background'),
                        'var(--vo-hover)', menu + ': shape hover is not the shell hover fill');
                }
            }
        },
        {
            name: 'chart_types_on_the_shape_scale',
            run() {
                const item = BRIDGE + '.vo-gallery-target .menu-insertchart .grouped-data .group-items-container > .item';
                assert.equal(value(find(gal, item, 'border-radius'), 'border-radius'), '4px', 'chart tile radius is not 4');
                /* Padding 18: stock inline (width 364, top 12) is overridden at the top and bottom, the tile has padding 4. */
                const card = find(gal, BRIDGE + '.vo-gallery-target:has(.menu-insertchart)', 'padding-top');
                assert.equal(value(card, 'padding-top'), '18px !important', 'chart gallery top margin is not 18 over the stock inline 12');
                assert.equal(value(card, 'padding-bottom'), '14px !important', 'chart gallery bottom margin is not 18 to the tile');
                assert.equal(value(find(gal, BRIDGE + '.vo-gallery-target .menu-insertchart', 'margin'), 'margin'), '0 14px', 'chart gallery side margin is not 18 to the tile');
                assert.equal(value(find(gal, BRIDGE + '.vo-gallery-target .menu-insertchart .grouped-data:first-child .group-description', 'padding-top'), 'padding-top'), '0',
                    'the first chart group caption is not at 18');
                assert.ok(!gal.some(r => r.sel.startsWith(item) && (has(r, 'width', /./) || has(r, 'height', /./))),
                    'chart tiles are resized (the stock 40 stays)');
                const light = BRIDGE_LIGHT + '.vo-gallery-target .menu-insertchart .grouped-data .group-items-container > .item';
                assert.equal(value(find(gal, light, 'box-shadow'), 'box-shadow'), 'none', 'chart tile keeps the stock outline');
                assert.equal(value(find(gal, light + ':hover:not(.disabled)'), 'background'), 'var(--vo-hover)', 'chart hover is not the shell hover fill');
                assert.equal(value(find(gal, light + '.selected:not(.disabled)'), 'box-shadow'), '0 0 0 2px var(--vo-accent)', 'selected chart type has no accent outline');
            }
        },
        {
            name: 'lists_on_the_shell_menu_scale',
            run() {
                const card = find(gal, BRIDGE + LIST, 'padding');
                assert.equal(value(card, 'padding'), '18px 0', 'list card margins are not 18 above and below');
                assert.equal(value(find(gal, BRIDGE + LIST + ' > .divider', 'margin'), 'margin'), '7px 18px', 'list divider is not 7 above and below, 18 at the sides');
                assert.equal(value(card, 'min-width'), '266px !important', 'list card is not at least 266');
                assert.equal(value(card, 'font-size'), '13px', 'list font is not 13');
                const row = find(gal, BRIDGE + LIST + ' > li > a', 'padding-block');
                assert.equal(px(value(row, 'padding-block')) * 2 + px(value(row, 'line-height')), 38, 'list row is not 38');
                assert.equal(value(row, 'font-size'), '13px', 'list row font is not 13');
                assert.equal(value(row, 'padding-inline'), '18px 42px', 'icon-less list row margins are not 18/42');
                const col = find(gal, BRIDGE + LIST + ':has(> li > a > .menu-item-icon, > li > a.checked) > li > a');
                assert.equal(value(col, 'padding-inline-start'), '49px', 'list with icons or checks has no 24 icon column');
                assert.ok(find(gal, BRIDGE + '.vo-gallery-target .dropdown-menu:has(> li > a) > li > a', 'padding-block'),
                    'nested lists are not on the shell scale');
                const lrow = find(gal, BRIDGE_LIGHT + LIST + ' > li > a', 'color');
                assert.equal(value(lrow, 'color'), 'var(--vo-fig-row-fg)', 'list row colour');
                assert.equal(value(find(gal, BRIDGE_LIGHT + LIST + ' > li > a:hover'), 'background'), 'var(--vo-hover)', 'list hover');
                assert.equal(value(find(gal, BRIDGE_LIGHT + LIST + ' > li.disabled > a'), 'color'), 'var(--vo-text-off)', 'disabled row keeps the active colour');
            }
        },
        {
            name: 'panel_stock_menus_leave_bridged_lists_to_the_shell_scale',
            run() {
                const rows = panel.filter(r => /\.dropdown-menu:not\(\.color-menu\)/.test(r.sel) && / li > a$/.test(r.sel) && has(r, 'padding', /./));
                assert.ok(rows.length, 'no panel list rows rule');
                assert.deepEqual(rows.filter(r => !/:not\(\.vo-gallery-target\)/.test(r.sel)).map(r => r.sel), [],
                    'panel list rows also apply to a menu shown by the bridge');
            }
        },
        {
            name: 'panel_theme_tiles_and_effect_rows',
            run() {
                const P = 'body.vo-compact #right-menu .vo-rp-pane ';
                const PL = 'body.vo-compact.theme-type-light #right-menu .vo-rp-pane ';
                const tile = find(panel, P + '.vo-rp-tile', 'border');
                assert.equal(value(tile, 'border'), 'none', 'panel tiles keep a frame');
                assert.equal(value(tile, 'padding'), '0', 'panel tiles keep the field margins');
                assert.equal(value(find(panel, P + '.vo-rp-grid', 'grid-template-columns'), 'grid-template-columns'), 'repeat(2, minmax(0, 1fr))', 'themes are not two per row');
                assert.equal(value(find(panel, P + '.vo-rp-grid', 'gap'), 'gap'), '10px', 'theme tiles are not 10 apart');
                const eg = find(panel, P + '.vo-rp-effects .vo-rp-grid', 'grid-template-columns');
                assert.equal(value(eg, 'grid-template-columns'), 'minmax(0, 1fr)', 'effects are not one per row');
                assert.equal(value(eg, 'gap'), '2px', 'effect rows are not 2 apart');
                const pic = find(panel, P + '.vo-rp-pic', 'border-radius');
                assert.equal(value(pic, 'border-radius'), '6px', 'theme picture radius is not 6');
                const cap = find(panel, P + '.vo-rp-themes .vo-rp-tile', 'font-size');
                assert.equal(value(cap, 'font-size'), '12px', 'theme caption is not 12');
                assert.equal(value(cap, 'text-align'), 'center', 'theme caption is not centred under the picture');
                const row = find(panel, P + '.vo-rp-effects .vo-rp-tile', 'height');
                assert.equal(value(row, 'height'), '30px', 'effect row is not 30');
                assert.equal(value(row, 'border-radius'), '6px', 'effect row radius is not 6');
                assert.equal(value(row, 'padding'), '0 8px', 'effect row margins are not 0 8');
                assert.ok(!panel.some(r => /\.vo-rp-tile-t$/.test(r.sel) && has(r, 'white-space', /^normal/)), 'effect names wrap');
                assert.equal(value(find(panel, PL + '.vo-rp-pic', 'box-shadow'), 'box-shadow'), '0 0 0 1px var(--vo-border)', 'theme picture outline');
                assert.equal(value(find(panel, PL + '.vo-rp-themes .vo-rp-tile:hover:not(:disabled) .vo-rp-pic'), 'box-shadow'), '0 0 0 2px var(--vo-win-seg-stroke)', 'hovered theme outline');
                assert.equal(value(find(panel, PL + '.vo-rp-themes .vo-rp-tile.vo-on .vo-rp-pic'), 'box-shadow'), '0 0 0 2px var(--vo-accent)', 'selected theme outline');
                assert.equal(value(find(panel, PL + '.vo-rp-effects .vo-rp-tile:hover:not(:disabled)'), 'background-color'), 'var(--vo-hover)', 'effect hover');
                const on = find(panel, PL + '.vo-rp-effects .vo-rp-tile.vo-on');
                assert.equal(value(on, 'background-color'), 'var(--vo-selected)', 'selected effect fill');
                assert.equal(value(on, 'color'), 'var(--vo-selected-fg)', 'selected effect text');
            }
        },
        {
            name: 'shell_imports_gallery_styles_once',
            run() {
                const src = fs.readFileSync(path.join(LESS_DIR, 'compact-shell.less'), 'utf8');
                assert.equal((src.match(/@import\s+"compact-galleries\.less";/g) || []).length, 1,
                    'compact-shell.less does not import compact-galleries.less exactly once');
                assert.ok(src.indexOf('"compact-galleries.less"') < src.indexOf('"compact-windows.less"') &&
                    src.indexOf('"compact-galleries.less"') > src.indexOf('"compact-panel.less"'),
                    'gallery styles are not between the panel and the window styles');
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
    console.log('FAIL galleries: ' + ((e && e.message) || e));
    process.exitCode = 1;
});
