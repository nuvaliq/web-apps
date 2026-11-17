/* Run: node test/unit-tests/presentationeditor/acceptance/shell-layout.cjs [--only <name>]
 * Presentation editor in the compact shell: rows replace the stock chrome, the
 * workspace palette, the icon set and the dark interface theme.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const H = require('./shell-harness.cjs');

const read = f => fs.readFileSync(f, 'utf8');

/* Row heights of the documents and spreadsheets compact header: name 46, menu 30, the panel card 44 with
   a gap of 4 above and 8 below. */
const SHELL_HEIGHTS = {H_HEADER: 46, H_MENU: 30, H_TB_GAP_TOP: 4, H_TOOLBAR: 44, H_TB_GAP: 8, H_STATUS: 0};

function heights(src, file) {
    const out = {};
    for (const k of Object.keys(SHELL_HEIGHTS)) {
        const m = new RegExp('\\b' + k + '\\b\\s*[:=]\\s*(\\d+)').exec(src);
        assert.ok(m, file + ': ' + k + ' is not declared');
        out[k] = +m[1];
    }
    return out;
}

/* custom properties the documents shell declares for body.vo-compact, last wins */
function documentTokens(css) {
    const tokens = {};
    for (const r of H.parseCss(css)) {
        if (!r.sels.some(s => s.text.replace(/\s+/g, '') === 'body.vo-compact')) continue;
        for (const d of r.decls) if (d.prop.startsWith('--vo-')) tokens[d.prop] = d.value;
    }
    return tokens;
}

const normValue = v => String(v).toLowerCase().replace(/\s+/g, '').replace(/\u0000/g, '');

function order(a, b) { return a.compareDocumentPosition(b) & 4; }

function rowsInPlace(w, where) {
    const shellNode = w.must('vo-shell');
    const rows = ['vo-header', 'vo-menubar', 'vo-toolbar'].map(id => w.must(id));
    rows.forEach(r => assert.ok(shellNode.contains(r), where + ': #' + r.id + ' is outside #vo-shell'));
    assert.ok(order(rows[0], rows[1]) && order(rows[1], rows[2]), where + ': rows are not in the order header, menu bar, toolbar');
    const status = w.must('vo-status');
    const sdk = w.must('editor_sdk');
    assert.ok(order(rows[2], sdk) && order(sdk, status), where + ': workspace is not between the toolbar and the status bar');
    rows.concat([status, sdk]).forEach(e => assert.ok(!w.hidden(e), where + ': ' + H.describe(e) + ' is hidden'));
    assert.ok(w.doc.body.classList.contains('vo-compact'), where + ': body has no vo-compact class');
    const stock = {
        'stock ribbon': w.doc.querySelector('#toolbar > section.toolbar'),
        'stock header': w.byId('app-title'),
        'left column of buttons': w.doc.querySelector('#left-menu .tool-menu-btns'),
        'stock status bar': w.doc.querySelector('#statusbar > .statusbar')
    };
    for (const [name, el] of Object.entries(stock)) assert.ok(el && w.hidden(el), where + ': ' + name + ' is still shown');
}

async function shellRowsReplaceStockChromeTopToBottom() {
    const shellFile = path.join(H.PE_VIEW, 'CompactShell.js');
    assert.ok(fs.existsSync(shellFile), 'apps/presentationeditor/main/app/view/CompactShell.js is missing');

    const viewport = read(path.join(H.PE_MAIN, 'app/controller/Viewport.js'));
    assert.match(viewport, /presentationeditor\/main\/app\/view\/CompactShell/, 'controller/Viewport.js does not load the shell');
    assert.match(viewport, /\.announce\(/, 'controller/Viewport.js does not announce the shell on init');
    assert.match(viewport, /\.wanted\(/, 'controller/Viewport.js does not check the shell gate');
    assert.match(viewport, /\.start\(/, 'controller/Viewport.js does not start the shell');
    const appLess = read(path.join(H.PE_LESS, 'app.less')).split('\n').map(l => l.trim()).filter(Boolean);
    assert.equal(appLess[appLess.length - 1], '@import "compact-shell.less";', 'app.less does not import compact-shell.less last');

    assert.deepEqual(heights(read(shellFile), 'presentation shell'), SHELL_HEIGHTS, 'row heights differ from the documents and sheets header');

    const w = await H.makeWorld();
    const shell = w.load('CompactShell');
    assert.equal(shell.wanted({ui: {shell: 'modern'}}), true, 'gate is off for ui.shell = modern');
    assert.equal(shell.wanted({ui: {shell: 'Modern'}}), false, 'gate is on for a foreign value');
    assert.equal(shell.wanted({}), false, 'gate is on without the field');
    w.bootOrExplain();
    w.requireCss();
    rowsInPlace(w, 'after start');

    const deTokens = documentTokens(await H.compileDocumentsLess());
    /* Menu bar tokens of the shared layer (--vo-menu-*) are var() references to the palette: the world
       cascade resolves them to colors, while for documents they are raw text. compact-parity checks them
       against the built layers of both editors. */
    const sharedMenu = H.sharedMenuTokens();
    const names = Object.keys(deTokens).filter(n => !sharedMenu.has(n));
    assert.ok(names.length > 10, 'documents tokens are not found');
    const body = w.doc.body;
    const differ = names.filter(n => normValue(w.cascade.value(body, n)) !== normValue(deTokens[n]));
    assert.deepEqual(differ, [], 'shell tokens differ from the documents shell');
}

async function workspaceGreyFieldWhiteCards() {
    const w = await H.makeWorld();
    w.bootOrExplain();
    w.requireCss();
    const painted = w.used('api').filter(c => c.what === 'asc_setSkin');
    assert.ok(painted.length > 0, 'the shell never passes its palette to the engine (no asc_setSkin call)');

    const sdk = w.must('editor_sdk');
    const fieldToken = H.parseColor(w.cascade.value(sdk, '--vo-canvas-bg'));
    assert.ok(fieldToken, 'no --vo-canvas-bg on #editor_sdk');
    assert.ok(!H.isWhite(fieldToken) && H.luminance(fieldToken) > 0.75, 'field token is not a light grey: ' + H.colorHex(fieldToken));

    const skin = w.skinState.skin;
    const field = H.parseColor(skin.BackgroundColor);
    assert.ok(field, 'engine field colour is not a colour: ' + skin.BackgroundColor);
    assert.equal(H.colorHex(field), H.colorHex(fieldToken), 'engine paints the field not in the shell grey');
    const thumbsSkin = H.parseColor(skin.BackgroundColorThumbnails);
    assert.ok(H.isWhite(thumbsSkin), 'engine paints the thumbnails ribbon ' + skin.BackgroundColorThumbnails + ', not white');

    const look = id => {
        const b = w.background(w.must(id));
        assert.ok(b.color, '#' + id + ' has no resolved background: ' + JSON.stringify(b));
        return b.color;
    };
    assert.ok(H.isWhite(look('id_panel_thumbnails')), 'thumbnails ribbon is not a white card');
    assert.ok(H.isWhite(look('id_panel_notes')), 'notes panel is not a white card');
    assert.ok(H.isWhite(look('id_notes')), 'notes canvas is not white');
    const around = look('id_viewer');
    assert.equal(H.colorHex(around), H.colorHex(fieldToken), 'slide field is not the shell grey');
    assert.equal(H.colorHex(look('editor_sdk')), H.colorHex(fieldToken), 'workspace host is not the shell grey');
}

function requestedIconNames() {
    const found = new Map();
    for (const name of H.shellViewNames()) {
        const file = path.join(H.PE_VIEW, name + '.js');
        if (!fs.existsSync(file)) continue;
        const code = H.scanJs(read(file)).code;
        const add = (n, where) => { if (!found.has(n)) found.set(n, where); };
        for (const m of code.matchAll(/(?:^|[^A-Za-z0-9_$])(?:i|ic|icon)\s*:\s*['"]([A-Za-z][A-Za-z0-9]*)['"]/g)) add(m[1], name);
        for (const m of code.matchAll(/(?:Icons\.(?:svg|has)|(?:^|[^A-Za-z0-9_$.])(?:svg|icon)|\b(?:iconBtn|dropBtn|popItem))\(\s*([^,()]*)/g)) {
            for (const lit of m[1].matchAll(/['"]([A-Za-z][A-Za-z0-9]*)['"]/g)) add(lit[1], name);
        }
    }
    return found;
}

const AIR_URL = /\/common\/main\/resources\/img\/air\/([A-Za-z0-9_-]+)\.svg/;

async function iconsFromDocumentSetAndAir() {
    /* The shell draws from the shared set of all editors, as the documents do: no set of its own. */
    assert.ok(!fs.existsSync(path.join(H.PE_MAIN, 'resources/img/air')), 'apps/presentationeditor/main/resources/img/air is back');
    assert.ok(!fs.existsSync(path.join(H.PE_VIEW, 'Icons.js')), 'apps/presentationeditor/main/app/view/Icons.js is back');
    const peFiles = new Set(fs.readdirSync(H.SHARED_AIR).filter(f => f.endsWith('.svg')));
    const external = Array.from(peFiles).filter(f => /(?:https?:)?\/\/[a-z]/i.test(read(path.join(H.SHARED_AIR, f)).replace(/xmlns(?::\w+)?="[^"]*"/g, '')));
    assert.deepEqual(external, [], 'icons with external references');

    const w = await H.makeWorld();
    const icons = w.load('Icons');
    assert.equal(typeof (icons && icons.svg), 'function', 'Common.UI.Compact.Icons.svg() is missing');
    const requested = requestedIconNames();
    assert.ok(requested.size > 0, 'shell views request no icons');
    const empty = [], outline = [], badAir = [];
    for (const [name, where] of requested) {
        const s = String(icons.svg(name) || '');
        if (!s) { empty.push(name + ' (' + where + ')'); continue; }
        const air = AIR_URL.exec(s);
        if (air) { if (!peFiles.has(air[1] + '.svg')) badAir.push(name + ' -> ' + air[1]); continue; }
        if (/<svg[\s\S]*<(?:path|line|polyline|polygon|rect|circle)\b/i.test(s)) outline.push(name);
        else empty.push(name + ' (no glyph)');
    }
    assert.deepEqual(empty, [], 'icons that render nothing');
    assert.deepEqual(badAir, [], 'icons pointing to a missing file');
    assert.deepEqual(outline, [], 'icons drawn by an own outline instead of an AIR glyph: ' + outline.join(', '));

    w.bootOrExplain();
    w.requireCss();
    const toolbar = w.must('vo-toolbar');
    const glyphs = {Фон: 'background', Макет: 'layout'};
    for (const caption of Object.keys(glyphs)) {
        const ctl = H.controlsIn(w, toolbar).find(c => H.normCaption(c.textContent) === H.normCaption(caption));
        assert.ok(ctl, 'toolbar has no "' + caption + '" button with nothing selected');
        const mask = ctl.querySelector('.vo-air');
        const src = mask && AIR_URL.exec(mask.getAttribute('style') || '');
        assert.ok(src && src[1] === glyphs[caption] && peFiles.has(src[1] + '.svg'), '"' + caption + '" does not draw its AIR glyph: ' + (mask ? mask.getAttribute('style') : 'no mask'));
        assert.ok(!ctl.querySelector('svg'), '"' + caption + '" still carries an outline svg');
    }
}

function snapshotLook(w, where) {
    const ids = ['vo-header', 'vo-menubar', 'vo-toolbar', 'vo-status', 'editor_sdk', 'id_panel_thumbnails', 'id_panel_notes'];
    const out = {};
    for (const id of ids) {
        const b = w.background(w.must(id));
        assert.ok(b.color, where + ': #' + id + ' has no resolved background: ' + JSON.stringify(b));
        out[id] = H.colorHex(b.color);
    }
    for (const id of ['vo-header', 'vo-menubar']) out[id + ' text'] = normValue(w.cascade.value(w.must(id), 'color'));
    const s = w.skinState.skin;
    out.engineField = String(s.BackgroundColor).toLowerCase();
    out.engineThumbnails = String(s.BackgroundColorThumbnails).toLowerCase();
    return out;
}

async function darkThemeKeepsShellLightAndLayout() {
    const light = await H.makeWorld();
    light.bootOrExplain();
    light.requireCss();
    const base = snapshotLook(light, 'light theme');
    for (const id of ['vo-header', 'vo-menubar', 'vo-toolbar', 'vo-status']) {
        assert.ok(H.luminance(H.parseColor(base[id].split('/')[0])) > 0.85, 'light theme: #' + id + ' is not light: ' + base[id]);
    }

    const dark = await H.makeWorld({theme: 'dark'});
    dark.bootOrExplain();
    rowsInPlace(dark, 'opened in the dark theme');
    assert.deepEqual(snapshotLook(dark, 'opened in the dark theme'), base, 'opened in the dark theme: the shell is not the light one');

    const sw = await H.makeWorld();
    sw.bootOrExplain();
    sw.theme = 'dark';
    sw.doc.body.classList.remove('theme-light');
    sw.doc.body.classList.add('theme-dark', 'theme-type-dark');
    sw.updateGlobalSkin(sw.win.Common.UI.Themes.getThemeColors());
    sw.win.Common.NotificationCenter.trigger('uitheme:changed', 'theme-dark');
    sw.drain(3000);
    rowsInPlace(sw, 'after switching to the dark theme');
    assert.deepEqual(snapshotLook(sw, 'after switching to the dark theme'), base, 'after switching to the dark theme: the shell is not the light one');
}

/* The File screen sits under the visible header rows: stock sets it inline at 56 (two own
   rows of 28), and it cut off the shell menu bar. */
async function fileScreenBelowShellRows() {
    const css = await H.compileLess(path.join(H.PE_LESS, 'compact-shell.less'));
    const tops = {};
    for (const r of H.parseCss(css)) {
        const top = r.decls.find(d => d.prop === 'top');
        if (!top) continue;
        for (const s of r.sels) {
            const t = s.text.replace(/\s+/g, ' ').trim();
            if (/\.toolbar-fullview-panel$/.test(t)) tops[t] = top.value.trim() + (top.important ? ' !important' : '');
        }
    }
    const P = ' .toolbar-fullview-panel';
    const {H_HEADER: hh, H_MENU: hm} = SHELL_HEIGHTS;
    assert.deepEqual(tops, {
        ['body.vo-compact' + P]: (hh + hm) + 'px !important',
        ['body.vo-compact:has(#vo-header[hidden])' + P]: hm + 'px !important',
        ['body.vo-compact:has(#vo-menubar[hidden])' + P]: hh + 'px !important',
        ['body.vo-compact:has(#vo-header[hidden]):has(#vo-menubar[hidden])' + P]: '0 !important'
    }, 'the File screen top does not follow the visible shell rows');
    const viewport = read(path.join(H.PE_MAIN, 'app/controller/Viewport.js'));
    assert.match(viewport, /\$filemenu\.css\('top'/, 'the stock no longer sets the File screen top inline: the !important may be unneeded');
}

H.run([
    {name: 'shell_rows_replace_stock_chrome_top_to_bottom', fn: shellRowsReplaceStockChromeTopToBottom},
    {name: 'file_screen_below_shell_rows', fn: fileScreenBelowShellRows},
    {name: 'workspace_grey_field_white_cards', fn: workspaceGreyFieldWhiteCards},
    {name: 'icons_from_document_set_and_air', fn: iconsFromDocumentSetAndAir},
    {name: 'dark_theme_keeps_shell_light_and_layout', fn: darkThemeKeepsShellLightAndLayout}
]);
