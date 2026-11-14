/* Run: node test/unit-tests/presentationeditor/compact-toolbar.cjs [path to CompactToolbar.js]
 * The presentation shell toolbar by selection: a white card, the core first,
 * "Copy style" in the text group after B · I · U (and alone for a shape without text and
 * a line), the focus chevron at the right edge; the composition and order of groups
 * for each selection kind, text controls only with text in the selection; commands go to the stock twins through the bridge and to the shell
 * commands; values (font, font size, zoom, styles, alignment icon) come from the
 * engine, availability and pressed state from the twin, "Comment" from the stock comments
 * panel button, the magnifier by the search bar notification; under the stock editing ban (version history, connection loss)
 * the card is locked by a layer, dimming and tab order, and after it is alive again.
 *
 * The module is executed in vm over the DOM model and the shell LESS cascade of the toolbar
 * acceptance fixture (acceptance/bar-harness.cjs): the bridge, classifier and scaffold there are
 * stubs of the declared interface. Controls are recognized by data-vo, not by caption:
 * the shell captions are translated separately.
 * The optional argument is a corrupted copy of the module for a negative control:
 * a copy with a shape without text in TEXT must fail shape_without_text_keeps_object_buttons_in_row.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const H = require('./acceptance/bar-harness.cjs');

let viewDir;
if (process.argv[2]) {
    viewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-toolbar-'));
    fs.copyFileSync(path.resolve(process.argv[2]), path.join(viewDir, 'CompactToolbar.js'));
}

const KINDS = ['none', 'text', 'shape', 'image', 'table', 'chart', 'line', 'typing'];
const CORE = ['undo', 'redo', 'search', 'comment', 'zoom'];
const WIDE = 6000;

async function mount(kind) {
    const env = H.createEnv({kind: kind || 'none', width: WIDE, viewDir});
    await env.mount();
    return env;
}
const vo = el => el.getAttribute('data-vo') || '?' + el.localName;
const row = env => env.rowEls().map(vo).filter((id, i, a) => id !== a[i - 1]);
const find = (env, id) => env.controls(env.card).find(el => vo(el) === id) || null;
const any = (env, id) => env.document.querySelectorAll('[data-vo="' + id + '"]');
const calls = (log, who, ref) => log.filter(e => e.who === who && (!ref || e.ref === ref));
const fmt = log => log.map(e => `${e.who}:${e.ref}.${e.method}(${JSON.stringify(e.args)})`).join(', ') || 'no calls';

async function rows() {
    const env = await mount('none');
    const out = {};
    for (const kind of KINDS) {
        await env.setKind(kind);
        out[kind] = row(env);
    }
    return {env, out};
}

const tests = [];
const test = (name, fn) => tests.push({name, fn});

test('core_first_format_painter_next_to_bold_italic_underline', async () => {
    const {env, out} = await rows();
    for (const kind of KINDS) {
        assert.deepEqual(out[kind].slice(0, 5), CORE, kind + ': the row does not start with the core: ' + out[kind]);
    }
    /* "Copy style" goes after B · I · U and before "Text styles ▾", only together with them;
       for a shape without text and a line the stock button is alive too: there it is alone right after the core. */
    for (const kind of ['text', 'table', 'typing']) {
        const ids = out[kind], b = ids.indexOf('underline');
        assert.deepEqual(ids.slice(b - 2, b + 3), ['bold', 'italic', 'underline', 'painter', 'textPop'], kind + ': the format painter is not next to B · I · U: ' + ids);
    }
    for (const kind of ['shape', 'line']) {
        assert.deepEqual(out[kind].slice(5, 7), ['painter', 'newSlide'], kind + ': the format painter is not alone after the core: ' + out[kind]);
    }
    for (const kind of ['none', 'image', 'chart']) {
        assert.ok(!out[kind].includes('painter'), kind + ': the format painter is shown while the stock one is always off: ' + out[kind]);
    }
    assert.equal(env.card.id, 'vo-tb', 'the card is not #vo-tb');
    assert.ok(H.isWhite(env.background(env.card)), 'the card is not white: ' + env.background(env.card));
    assert.ok(H.isLightGrey(env.fieldBackground(env.card)), 'no grey field under the card: ' + env.fieldBackground(env.card));
    const end = env.end();
    assert.ok(end && env.card.contains(end), 'no #vo-tb-end in the card');
    assert.equal(vo(end.lastElementChild), 'focus', 'the focus chevron is not the last child of #vo-tb-end');
    assert.ok(env.atRightEdge(end), '#vo-tb-end is not pushed to the right edge');
    assert.ok(env.rowEls().every(el => el.compareDocumentPosition(end) & 4), '#vo-tb-end is not after the row');
    const more = env.more();
    assert.ok(more && env.card.contains(more) && !env.moreShown(), '#vo-tb-more must be in the card and hidden without overflow');
    const log = await env.capture(() => env.click(end.lastElementChild));
    assert.ok(calls(log, 'command', 'focus').length, 'the chevron does not run the focus command: ' + fmt(log));
});

test('nothing_selected_slide_props_no_text_fill', async () => {
    const env = await mount('none');
    assert.deepEqual(row(env), ['undo', 'redo', 'search', 'comment', 'zoom', 'newSlide', 'image', 'shape', 'textbox',
        'bg', 'layout', 'theme', 'transition'], 'the row without a selection');
    for (const id of ['newSlide', 'bg', 'layout', 'theme', 'transition']) {
        const el = find(env, id);
        const label = el.querySelector('.vo-tx-label');
        assert.ok(label && env.text(el) === label.textContent && label.textContent.length > 0, id + ': no visible caption');
    }
    const icons = env.iconNames(find(env, 'bg')).concat(env.iconNames(find(env, 'layout')));
    assert.ok(icons.includes('background') && icons.includes('layout'), 'Background and Layout lost their icons: ' + icons);
    const cmds = {};
    for (const [id, section] of [['bg', 'slide'], ['theme', 'theme'], ['transition', 'transition']]) {
        const log = await env.capture(() => env.click(find(env, id)));
        const run = calls(log, 'command', 'slideSection').find(e => e.method === 'run');
        cmds[id] = run && run.args[0];
        assert.equal(cmds[id], section, id + ' does not open the ' + section + ' section: ' + fmt(log));
        assert.deepEqual(calls(log, 'api'), [], id + ' calls the engine directly');
    }
    const lay = await env.capture(() => env.click(find(env, 'layout')));
    assert.ok(calls(lay, 'bridge', 'Toolbar:btnChangeSlide').some(e => e.method === 'gallery'), 'Layout does not open the stock layout gallery: ' + fmt(lay));
    /* "New slide" is one click: the stock add button, without a layout gallery. */
    const add = await env.capture(() => env.click(find(env, 'newSlide')));
    assert.equal(calls(add, 'stock', 'Toolbar:btnAddSlide').filter(e => e.method === 'click').length, 1, 'New slide is not one stock click: ' + fmt(add));
    assert.ok(!calls(add, 'bridge', 'Toolbar:btnAddSlide').some(e => e.method === 'gallery'), 'New slide opens the layout gallery: ' + fmt(add));
    assert.equal(find(env, 'newSlide').getAttribute('aria-haspopup'), null, 'New slide is a drop-down');
});

test('text_group_follows_core', async () => {
    const {env, out} = await rows();
    const TEXT = ['font', 'size', 'bold', 'italic', 'underline', 'painter', 'textPop', 'align', 'lists'];
    for (const kind of ['text', 'table', 'typing']) {
        assert.deepEqual(out[kind].slice(5, 5 + TEXT.length), TEXT, kind + ': the text group does not follow the core: ' + out[kind]);
    }
    for (const kind of ['none', 'shape', 'image', 'chart', 'line']) {
        assert.deepEqual(TEXT.filter(id => id !== 'painter' && out[kind].includes(id)), [], kind + ': text controls without text: ' + out[kind]);
    }
    await env.setKind('text');
    const before = new Set(env.controls());
    await env.click(find(env, 'size'));
    const items = env.controls().filter(el => !before.has(el));
    assert.deepEqual(items.map(env.text).map(Number), [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 96],
        'the font size list');
    const log = await env.capture(() => env.click(items.find(el => env.text(el) === '28')));
    const pick = calls(log, 'bridge', 'Toolbar:cmbFontSize').find(e => e.method === 'run');
    assert.ok(pick && pick.args[0] === 'selected', 'the font size is not picked through the stock combo: ' + fmt(log));
    assert.ok(items.every(el => !env.shown(el)), 'the list stays open after a pick');
});

/* A shape or group without text (kind shape): there is no font, styles, paragraph or link,
   their place is taken by fill, outline, "Object properties" and "Animation". At a width where with
   text the object buttons go into "⋯", without text the row fits entirely. */
test('shape_without_text_keeps_object_buttons_in_row', async () => {
    const env = await mount('shape');
    const ids = row(env);
    const TEXT = ['font', 'size', 'bold', 'italic', 'underline', 'textPop', 'align', 'lists', 'link'];
    assert.deepEqual(TEXT.filter(id => ids.includes(id)), [], 'text controls without text in the selection: ' + ids);
    for (const id of ['fill', 'lineColor', 'lineWidth', 'lineType', 'objProps', 'animation']) {
        assert.ok(ids.includes(id), 'no ' + id + ' for a shape without text: ' + ids);
    }
    await env.setWidth(env.contentWidth() + 8);
    assert.ok(!env.moreShown(), 'the row of a shape without text does not fit its own width');
    await env.setKind('text');
    assert.ok(env.moreShown(), 'with text the row fits the width of a shape without text');
    assert.ok(!row(env).includes('animation'), 'with text Animation stays in the row at this width: ' + row(env));
    await env.setKind('shape');
    assert.ok(!env.moreShown(), '«⋯» stays after the text is gone');
    for (const id of ['objProps', 'animation']) assert.ok(row(env).includes(id), id + ' is not back in the row: ' + row(env));
});

test('fill_line_only_without_typing', async () => {
    const {out} = await rows();
    const FILL = ['fill', 'lineColor', 'lineWidth', 'lineType'];
    for (const kind of ['text', 'shape']) {
        const at = out[kind].indexOf('fill');
        assert.deepEqual(out[kind].slice(at, at + 4), FILL, kind + ': no fill and line controls: ' + out[kind]);
        assert.ok(out[kind].indexOf('objProps') > at, kind + ': no object properties after fill and line: ' + out[kind]);
    }
    assert.deepEqual(FILL.concat('objProps').filter(id => out.typing.includes(id)), [], 'fill, line or properties while typing: ' + out.typing);
    for (const kind of ['none', 'image', 'table', 'chart']) {
        assert.ok(!out[kind].includes('lineWidth'), kind + ': line controls without a shape or line: ' + out[kind]);
    }
});

test('image_group', async () => {
    const env = await mount('image');
    const ids = row(env), at = ids.indexOf('crop');
    assert.deepEqual(ids.slice(at, at + 4), ['crop', 'cropShape', 'replace', 'actual'], 'the image group: ' + ids);
    assert.ok(ids.indexOf('objProps') > at + 3, 'no object properties after the image group: ' + ids);
    const crop = await env.capture(() => env.click(find(env, 'crop')));
    assert.equal(calls(crop, 'bridge', 'RightMenu:imageSettings.btnCrop').length, 1, 'Crop is not the stock crop button: ' + fmt(crop));
    const actual = await env.capture(() => env.click(find(env, 'actual')));
    assert.equal(calls(actual, 'bridge', 'RightMenu:imageSettings.btnOriginalSize').length, 1, 'Actual size is not the stock button: ' + fmt(actual));
    const shape = await env.capture(() => env.click(find(env, 'cropShape')));
    assert.ok(calls(shape, 'bridge', 'RightMenu:imageSettings.btnCrop.menu.items.1').some(e => e.method === 'gallery'),
        'Crop to shape does not open the stock shape gallery: ' + fmt(shape));
    const props = await env.capture(() => env.click(find(env, 'objProps')));
    assert.ok(calls(props, 'command', 'objectProperties').some(e => e.method === 'run'), 'Object properties is not the shell command: ' + fmt(props));
    assert.deepEqual(calls(props, 'api'), [], 'Object properties calls the engine directly');
});

test('table_chart_line_groups', async () => {
    const {env, out} = await rows();
    const groups = {table: ['tableFill', 'tableBorder', 'rowsCols'], chart: ['editData', 'chartType'], line: ['lineColor', 'lineWidth', 'lineType']};
    for (const [kind, group] of Object.entries(groups)) {
        const at = out[kind].indexOf(group[0]);
        assert.ok(at > 0, kind + ': no ' + group[0] + ': ' + out[kind]);
        assert.deepEqual(out[kind].slice(at, at + group.length), group, kind + ': the group is not in a row: ' + out[kind]);
        assert.ok(out[kind].includes('objProps'), kind + ': no object properties: ' + out[kind]);
        assert.ok(!out[kind].includes('fill'), kind + ': the shape fill on a ' + kind);
    }
    await env.setKind('chart');
    const data = await env.capture(() => env.click(find(env, 'editData')));
    assert.equal(calls(data, 'bridge', 'ChartTab:btnEditData').length, 1, 'Edit data is not the stock chart tab button: ' + fmt(data));
    await env.setKind('table');
    const fill = await env.capture(async () => {
        await env.click(find(env, 'tableFill'));
        await env.click(find(env, 'tableFill').parentNode.querySelector('.vo-pal-item'));
    });
    assert.ok(calls(fill, 'bridge', 'RightMenu:tableSettings.btnBackColor').some(e => e.method === 'run' && e.args[0] === 'color:select'),
        'the table fill is not the stock table field: ' + fmt(fill));
    await env.setKind('line');
    const width = find(env, 'lineWidth');
    const opened = await env.capture(() => env.click(width));
    assert.ok(!calls(opened, 'api').length, 'the line width list calls the engine');
});

test('insert_group_link_only_for_text_and_table', async () => {
    const {env, out} = await rows();
    for (const kind of KINDS) {
        const at = out[kind].indexOf('image');
        assert.deepEqual(out[kind].slice(at, at + 3), ['image', 'shape', 'textbox'], kind + ': the insert group: ' + out[kind]);
        assert.ok(!out[kind].includes('line'), kind + ': a separate line button: ' + out[kind]);
        const link = ['text', 'table', 'typing'].includes(kind);
        if (link) assert.equal(out[kind][at + 3], 'link', kind + ': no link in the insert group: ' + out[kind]);
        else assert.ok(!out[kind].includes('link'), kind + ': link without text or table: ' + out[kind]);
    }
    await env.setKind('none');
    const shape = await env.capture(() => env.click(find(env, 'shape')));
    assert.ok(calls(shape, 'bridge', 'Toolbar:cmbsInsertShape.0').some(e => e.method === 'gallery'), 'Shape does not open the stock shape gallery: ' + fmt(shape));
});

test('values_from_engine', async () => {
    const env = await mount('text');
    const label = id => env.text(find(env, id));
    await env.fire('asc_onFontFamily', {get_Name: () => 'Georgia'});
    await env.fire('asc_onFontSize', 28);
    await env.fire('asc_onZoomChange', 90, 0);
    assert.equal(label('font'), 'Georgia', 'the font field');
    assert.equal(label('size'), '28', 'the font size field');
    assert.equal(label('zoom'), '90%', 'the zoom field');
    await env.setTwin('Toolbar:cmbFontSize', {value: 11});
    assert.equal(label('size'), '28', 'the font size field took the value of the stock combo instead of the engine');

    const icons = {};
    for (const [name, v] of [['left', 1], ['center', 2], ['right', 0], ['justify', 3]]) {
        await env.fire('asc_onPrAlign', v);
        icons[name] = env.iconNames(find(env, 'align'))[0];
    }
    assert.deepEqual(icons, {left: 'alignL', center: 'alignC', right: 'alignR', justify: 'alignJ'}, 'the alignment icon');

    const before = new Set(env.controls());
    await env.click(find(env, 'textPop'));
    const pop = env.controls().filter(el => !before.has(el));
    const item = id => pop.find(el => vo(el) === id);
    assert.deepEqual(pop.map(vo), ['strike', 'sup', 'sub', 'textColor', 'highlight', 'case', 'clearFmt'], 'the text popup');
    /* B · I · U are on the panel itself, highlighted by the style from the engine. */
    await env.fire('asc_onBold', true);
    await env.fire('asc_onUnderline', true);
    await env.fire('asc_onVerticalAlign', 2);
    assert.ok(env.pressed(find(env, 'bold')) && !env.pressed(find(env, 'italic')) && env.pressed(find(env, 'underline')), 'bold and underline from the engine');
    assert.ok(env.pressed(item('sup')) && !env.pressed(item('sub')), 'superscript from the engine');
    await env.setTwin('Toolbar:btnBold', {pressed: false});
    assert.ok(env.pressed(find(env, 'bold')), 'the bold state followed the stock button instead of the engine');
    await env.fire('asc_onBold', false);
    assert.ok(!env.pressed(find(env, 'bold')), 'bold stays lit after the engine reported a regular face');
    const it = await env.capture(() => env.click(find(env, 'italic')));
    assert.equal(calls(it, 'bridge', 'Toolbar:btnItalic').length, 1, 'Italic is not the stock button: ' + fmt(it));
    await env.click(find(env, 'textPop'));
    const log = await env.capture(() => env.click(item('strike')));
    assert.equal(calls(log, 'bridge', 'Toolbar:btnStrikeout').length, 1, 'Strikethrough is not the stock button: ' + fmt(log));
    assert.ok(pop.every(el => env.shown(el)), 'a style toggle closed the text popup');
    await env.clickOutside();
    assert.ok(pop.every(el => !env.shown(el)), 'a click outside does not close the text popup');

    await env.click(find(env, 'zoom'));
    const zoom = env.controls().filter(el => /%$/.test(env.text(el)) && vo(el) !== 'zoom');
    assert.deepEqual(zoom.map(env.text), ['50%', '75%', '90%', '100%', '125%', '150%', '175%', '200%'], 'the zoom list');
    assert.ok(zoom.find(el => env.text(el) === '90%').classList.contains('on'), 'the current zoom is not marked');
    const z = await env.capture(() => env.click(zoom[0]));
    const run = calls(z, 'bridge', 'ViewTab:cmbZoom').find(e => e.method === 'run');
    assert.ok(run && run.args[0] === 'changed:after', 'the zoom is not set through the stock zoom combo: ' + fmt(z));
});

test('pressed_from_twin', async () => {
    const env = await mount('text');
    const painter = find(env, 'painter'), undo = find(env, 'undo');
    assert.ok(!env.pressed(painter) && !undo.disabled, 'initial state');
    await env.setTwin('Toolbar:btnCopyStyle', {pressed: true});
    assert.ok(env.pressed(painter), 'the format painter is not pressed with the stock button');
    await env.setTwin('Toolbar:btnCopyStyle', {pressed: false});
    assert.ok(!env.pressed(painter), 'the format painter stays pressed');
    await env.setTwin('Toolbar:btnUndo', {disabled: true});
    assert.ok(undo.disabled, 'undo is not grey with the stock undo greyed');
    const log = await env.capture(() => env.click(undo));
    assert.deepEqual(calls(log, 'bridge'), [], 'a grey undo still runs');
    await env.setTwin('Toolbar:btnUndo', {disabled: false});
    assert.ok(!undo.disabled, 'undo stays grey');
    const one = await env.capture(() => env.click(undo));
    assert.equal(calls(one, 'stock', 'Toolbar:btnUndo').filter(e => e.method === 'click').length, 1, 'undo is not one stock click: ' + fmt(one));

    const state = env.bridge.state;
    env.bridge.state = ref => (ref === 'Toolbar:btnRedo' ? {exists: false, disabled: true, pressed: false, visible: false} : state(ref));
    env.shell.hasCommand = name => name !== 'searchBar';
    await env.setKind('text');
    assert.ok(find(env, 'redo').disabled, 'a control without its stock twin is not grey');
    assert.ok(find(env, 'search').disabled, 'a command without an owner is not grey');
    assert.ok(!find(env, 'objProps').disabled, 'a command with an owner is grey');
});

test('comment_pressed_from_left_menu_twin', async () => {
    const env = await mount('none');
    const comment = find(env, 'comment');
    assert.ok(!env.pressed(comment), 'pressed with the comments panel closed');
    await env.setTwin('LeftMenu:btnComments', {pressed: true});
    assert.ok(env.pressed(comment), 'not pressed with the stock comments panel open');
    await env.setTwin('LeftMenu:btnComments', {pressed: false});
    assert.ok(!env.pressed(comment), 'stays pressed after the stock panel closed');
    const log = await env.capture(() => env.click(comment));
    assert.equal(calls(log, 'stock', 'LeftMenu:btnComments').filter(e => e.method === 'click').length, 1,
        'Comment does not toggle the stock comments button: ' + fmt(log));
    assert.equal(any(env, 'comment').length, 1, 'more than one Comment control');
});

/* Without the right to the comments panel stock hides its button; the toolbar
   button is absent then too, otherwise it would open an empty panel. */
test('comment_hidden_without_the_comments_right', async () => {
    for (const lack of [{canViewComments: false}, {canCoAuthoring: false}, {isLightVersion: true}]) {
        const env = H.createEnv({kind: 'none', width: WIDE, viewDir});
        Object.assign(env.appOptions, lack);
        await env.mount();
        assert.ok(!row(env).includes('comment'), JSON.stringify(lack) + ': Comments is in the row: ' + row(env));
        assert.deepEqual(row(env).slice(0, 4), ['undo', 'redo', 'search', 'zoom'], JSON.stringify(lack) + ': the core lost its order: ' + row(env));
    }
    const env = await mount('none');
    assert.ok(row(env).includes('comment'), 'Comments is not in the row with the right: ' + row(env));
});

test('search_button_toggles_the_search_bar', async () => {
    const env = await mount('none');
    const search = find(env, 'search');
    assert.equal(search.getAttribute('aria-pressed'), 'false', 'the search button is not a toggle');
    const log = await env.capture(() => env.click(search));
    assert.equal(calls(log, 'command', 'searchBar').filter(e => e.method === 'run').length, 1,
        'the search button does not run the search bar command: ' + fmt(log));
    assert.equal(calls(log, 'command', 'search').length, 0, 'the search button opens the search panel: ' + fmt(log));
    env.nc.trigger('vo:search-bar', true);
    await env.flush();
    assert.ok(env.pressed(search), 'the search button is not pressed while the search bar is shown');
    env.nc.trigger('vo:search-bar', false);
    await env.flush();
    assert.ok(!env.pressed(search), 'the search button stays pressed after the search bar closed');
});

test('format_painter_caption_and_tip', async () => {
    const env = await mount('text');
    const painter = find(env, 'painter'), own = env.ctx.PE.Views.CompactToolbar;
    assert.ok(own.textPaintFormat && own.tipPaintFormat && own.textPaintFormat !== own.tipPaintFormat,
        'no own caption next to the Format painter tip');
    assert.equal(painter.getAttribute('aria-label'), own.textPaintFormat, 'the Format painter is not named by its caption');
    assert.equal(painter.getAttribute('title'), own.tipPaintFormat, 'the Format painter lost its tip');
    const undo = find(env, 'undo');
    assert.equal(undo.getAttribute('aria-label'), undo.getAttribute('title'), 'a button without a caption is not named by its tip');
});

test('undo_redo_name_idle_reason', async () => {
    const env = await mount('none');
    const acts = env.ctx.PE.Views.SlideActions, own = env.ctx.PE.Views.CompactToolbar;
    acts.textNothingToUndo = 'Nothing to undo';
    acts.textNothingToRedo = 'Nothing to redo';
    for (const [id, ref, tip, why] of [['undo', 'Toolbar:btnUndo', own.tipUndo, acts.textNothingToUndo],
                                       ['redo', 'Toolbar:btnRedo', own.tipRedo, acts.textNothingToRedo]]) {
        const b = find(env, id);
        await env.setTwin(ref, {disabled: true});
        assert.ok(b.disabled, id + ' is not grey with the stock button greyed');
        assert.ok((b.getAttribute('title') || '').indexOf(why) >= 0, id + ': the tip does not tell the reason: ' + b.getAttribute('title'));
        assert.ok((b.getAttribute('title') || '').indexOf(tip) === 0, id + ': the tip lost the command name: ' + b.getAttribute('title'));
        assert.equal(b.getAttribute('aria-description'), why, id + ': no reason for the screen reader');
        await env.setTwin(ref, {disabled: false});
        assert.equal(b.getAttribute('title'), tip, id + ': the reason stays after the stock button is back');
        assert.ok(!b.hasAttribute('aria-description'), id + ': the screen reader reason stays');
    }
    await env.setKind('text');
    const painter = find(env, 'painter');
    await env.setTwin('Toolbar:btnCopyStyle', {disabled: true});
    assert.ok(!painter.hasAttribute('aria-description'), 'a control without an idle reason got one');
});

test('stock_lock_masks_the_card', async () => {
    const env = await mount('none');
    const card = env.card;
    let lock = {on: false, options: {}};
    env.shell.lockState = () => lock;
    const own = find(env, 'search');
    own.setAttribute('tabindex', '0');
    find(env, 'textbox').focus();
    await env.click(find(env, 'zoom'));
    const zoomPop = find(env, 'zoom').parentNode.querySelector('.vo-pop');
    assert.ok(zoomPop && env.shown(zoomPop), 'the zoom list did not open');
    const stockLock = async on => {
        lock = on ? {on: true, options: {viewMode: true, toolbar: true, rightMenu: {clear: true, disable: true}}} : {on: false, options: {}};
        env.nc.trigger('editing:disable', on, lock.options, 'disconnect');
        await env.flush();
    };
    const mask = () => [...card.children].find(n => n.classList.contains('vo-tb-mask')) || null;

    /* Stock banned editing (version history, connection loss): a layer over the card, the content is dimmed. */
    await stockLock(true);
    const m = mask();
    assert.ok(m, 'no mask over the card under the stock lock');
    assert.equal(env.cssValue(m, 'position'), 'absolute', 'the mask does not cover the card');
    assert.ok(Number(env.cssValue(m, 'z-index')) > 0, 'the mask is not above the controls');
    const dim = [...card.children].filter(n => n !== m && (Number(env.cssValue(n, 'opacity')) !== 0.4 || env.cssValue(n, 'pointer-events') !== 'none'));
    assert.deepEqual(dim.map(n => n.className || n.id), [], 'the card content is not dimmed under the mask');
    assert.ok(!env.shown(zoomPop), 'the open zoom list stays open over the mask');
    const tabbable = [...card.querySelectorAll('button, a[href], input, select, textarea')].filter(n => n.getAttribute('tabindex') !== '-1');
    assert.deepEqual(tabbable.map(vo), [], 'controls stay in the tab order');
    assert.notEqual(env.document.activeElement, find(env, 'textbox'), 'the focus stays on a locked control');

    /* A click that reached the card past the layer does nothing. */
    const log = await env.capture(async () => {
        for (const id of ['textbox', 'bg', 'shape', 'undo']) await env.click(find(env, id));
    });
    assert.deepEqual(log.filter(e => e.who === 'bridge' || e.who === 'stock' || (e.who === 'command' && e.method === 'run')).map(e => e.ref + '.' + e.method), [],
        'a click on the locked card reached the stock code or a command');

    /* The ban is lifted: no layer, the tab order is as before, a click reaches again. */
    await stockLock(false);
    assert.equal(mask(), null, 'the mask stays after the stock lock is gone');
    assert.ok(!card.classList.contains('vo-masked'), 'the card stays dimmed');
    assert.equal(own.getAttribute('tabindex'), '0', 'the own tab index of a control is lost');
    assert.ok(!find(env, 'textbox').hasAttribute('tabindex'), 'a control keeps the tab index of the lock');
    const back = await env.capture(() => env.click(find(env, 'bg')));
    assert.ok(calls(back, 'command', 'slideSection').some(e => e.method === 'run'), 'Background does not work after the lock: ' + fmt(back));

    /* A ban without toolbar in it does not lock the card. */
    lock = {on: true, options: {viewMode: true}};
    env.nc.trigger('editing:disable', true, lock.options, 'signature');
    await env.flush();
    assert.equal(mask(), null, 'the card is locked by a stock lock without the toolbar key');
});

(async () => {
    let failed = 0;
    for (const t of tests) {
        try {
            await t.fn();
            console.log('ok ' + t.name);
        } catch (e) {
            failed++;
            console.log('FAIL ' + t.name + ': ' + (e && e.message ? e.message.split('\n')[0] : e));
        }
    }
    if (viewDir) fs.rmSync(viewDir, {recursive: true, force: true});
    process.exitCode = failed ? 1 : 0;
})();
