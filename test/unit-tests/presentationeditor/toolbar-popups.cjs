/* Run: node test/unit-tests/presentationeditor/toolbar-popups.cjs [path to CompactToolbar.js]
 * Drop-down panels of the presentation shell toolbar: "Text styles ▾" does not close
 * on styles, the nested palette and list close themselves; "Alignment and spacing ▾"
 * with the item marks of the stock menus and the icon of the current alignment; "New slide" adds a
 * slide with one click, "Layout ▾" is the stock layout gallery; zoom is the stock combo, 90 % by the event
 * 'changed:after'; font size 8…96; palettes with reset and "Custom color" give the choice to the stock
 * color field; shape and line galleries are not closed by the stock combo size check.
 *
 * The module is executed in vm over the DOM model and the shell LESS cascade of the toolbar
 * acceptance fixture (acceptance/bar-harness.cjs): the bridge, classifier and scaffold there are
 * stubs of the declared interface. Controls are recognized by data-vo, not by caption.
 * The optional argument is a corrupted copy of the module for a negative control.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const H = require('./acceptance/bar-harness.cjs');

let viewDir;
if (process.argv[2]) {
    viewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbar-popups-'));
    fs.copyFileSync(path.resolve(process.argv[2]), path.join(viewDir, 'CompactToolbar.js'));
}

const WIDE = 6000;

async function mount(kind) {
    const env = H.createEnv({kind: kind || 'none', width: WIDE, viewDir});
    await env.mount();
    return env;
}
const vo = el => el.getAttribute('data-vo') || '?' + el.localName;
const find = (env, id) => env.controls(env.card).find(el => vo(el) === id) || null;
const calls = (log, who, ref) => log.filter(e => e.who === who && (!ref || e.ref === ref));
const fmt = log => log.map(e => `${e.who}:${e.ref}.${e.method}(${JSON.stringify(e.args)})`).join(', ') || 'no calls';
async function opened(env, el) {
    const before = new Set(env.controls());
    await env.click(el);
    return env.controls().filter(c => !before.has(c));
}

/* Bridge calls with arguments as is (the fixture log reduces objects to '[obj]'). */
function recordRuns(env) {
    const runs = [];
    const run = env.bridge.run;
    env.bridge.run = function (ref, o) { runs.push({ref, event: o && o.event, args: o && o.args}); return run.call(this, ref, o); };
    return runs;
}

/* A bridge gallery: a record of calls with the real arguments. */
function recordGalleries(env, impl) {
    const list = [];
    env.bridge.gallery = function (ref, anchor, opts) {
        list.push({ref, anchor, opts});
        env.stubs.log('bridge', ref, 'gallery', []);
        return impl ? impl(ref, anchor, opts) : true;
    };
    return list;
}

const tests = [];
const test = (name, fn) => tests.push({name, fn});

test('text_popup_style_toggle_keeps_open', async () => {
    const env = await mount('text');
    const pop = await opened(env, find(env, 'textPop'));
    assert.deepEqual(pop.map(vo), ['strike', 'sup', 'sub', 'textColor', 'highlight', 'case', 'clearFmt'],
        'the text popup in two rows, without Ж · К · Ч');
    const item = id => pop.find(el => vo(el) === id);
    for (const [id, ref] of [['strike', 'Toolbar:btnStrikeout'], ['sup', 'Toolbar:btnSuperscript'], ['sub', 'Toolbar:btnSubscript']]) {
        const log = await env.capture(() => env.click(item(id)));
        assert.equal(calls(log, 'bridge', ref).length, 1, id + ' is not the stock button: ' + fmt(log));
        assert.ok(pop.every(el => env.shown(el)), id + ' closed the text popup');
    }

    const swatches = await opened(env, item('textColor'));
    assert.ok(swatches.length >= 84, 'the text color palette did not open inside the text popup: ' + swatches.length);
    assert.ok(pop.every(el => env.shown(el)), 'the nested palette closed the text popup');
    await env.click(item('strike'));
    assert.ok(swatches.every(el => !env.shown(el)), 'a style toggle left the nested palette open');
    assert.ok(pop.every(el => env.shown(el)), 'a style toggle closed the text popup');

    const runs = recordRuns(env);
    await env.click(item('textColor'));
    const sw = env.document.querySelector('[data-vo-wrap="textColor"] .vo-pal-item[data-color="2563eb"]');
    assert.ok(sw && env.shown(sw), 'no swatch 2563eb in the text color palette');
    await env.click(sw);
    assert.deepEqual(runs.map(r => [r.ref, r.event, r.args && r.args[0]]), [['Toolbar:btnFontColor', 'color:select', '2563eb']],
        'the text color is not picked through the stock font color button');
    assert.ok(!env.shown(sw), 'the palette stays open after a pick');
    assert.ok(pop.every(el => env.shown(el)), 'a color pick closed the text popup');

    const cases = env.stubs.twin('Toolbar:btnChangeCase');
    cases.menu.items.push({caption: 'UPPERCASE', value: 2, options: {}}, {caption: 'lowercase', value: 1, options: {}});
    const rows = await opened(env, item('case'));
    assert.deepEqual(rows.map(env.text), ['UPPERCASE', 'lowercase'], 'the case list is not the stock change case menu');
    const pick = await env.capture(() => env.click(rows[0]));
    assert.ok(calls(pick, 'bridge', 'Toolbar:btnChangeCase').some(e => e.method === 'pick'), 'the case is not picked through the stock menu: ' + fmt(pick));
    assert.ok(rows.every(el => !env.shown(el)), 'the case list stays open after a pick');
    assert.ok(pop.every(el => env.shown(el)), 'a case pick closed the text popup');
    await env.clickOutside();
    assert.ok(pop.every(el => !env.shown(el)), 'a click outside does not close the text popup');
});

test('align_icon_shows_current', async () => {
    const env = await mount('text');
    const align = find(env, 'align');
    const icons = {};
    for (const [name, v] of [['left', 1], ['center', 2], ['right', 0], ['justify', 3]]) {
        await env.fire('asc_onPrAlign', v);
        icons[name] = env.iconNames(align)[0];
    }
    assert.deepEqual(icons, {left: 'alignL', center: 'alignC', right: 'alignR', justify: 'alignJ'}, 'the button icon follows the engine alignment');

    await env.setTwin('Toolbar:btnHorizontalAlign.menu.items.1', {pressed: true});
    await env.setTwin('Toolbar:btnLineSpace.menu.items.2', {pressed: true});
    const pop = await opened(env, align);
    assert.deepEqual(pop.map(vo), ['alignLeft', 'alignCenter', 'alignRight', 'alignJustify', 'valignTop', 'valignMiddle', 'valignBottom',
        'spacing10', 'spacing115', 'spacing15', 'spacing20'], 'the alignment and spacing popup');
    assert.deepEqual(pop.filter(el => vo(el).startsWith('spacing')).map(env.text), ['1,0', '1,15', '1,5', '2,0'], 'the line spacing values');
    assert.deepEqual(pop.filter(el => env.pressed(el)).map(vo), ['alignCenter', 'spacing15'], 'the checks are not the stock menu checks');
    const log = await env.capture(() => env.click(pop.find(el => vo(el) === 'alignRight')));
    assert.equal(calls(log, 'bridge', 'Toolbar:btnHorizontalAlign.menu.items.2').length, 1, 'right alignment is not the stock menu item: ' + fmt(log));
    const v = await env.capture(() => env.click(pop.find(el => vo(el) === 'valignBottom')));
    assert.equal(calls(v, 'bridge', 'Toolbar:btnVerticalAlign.menu.items.2').length, 1, 'bottom alignment is not the stock menu item: ' + fmt(v));
    assert.deepEqual(calls(log.concat(v), 'api'), [], 'the alignment calls the engine directly');
    assert.ok(pop.every(el => env.shown(el)), 'a pick closed the alignment popup');
});

test('new_slide_adds_a_slide_in_one_click', async () => {
    const env = await mount('none');
    const btn = find(env, 'newSlide');
    assert.equal(env.text(btn), 'Новый слайд', 'the caption is not «Новый слайд»');
    assert.equal(btn.getAttribute('title'), 'Новый слайд (Ctrl+M)', 'the tooltip');
    assert.equal(btn.getAttribute('aria-haspopup'), null, 'the button opens a list');
    const galleries = recordGalleries(env);
    const log = await env.capture(() => env.click(btn));
    assert.deepEqual(galleries, [], 'a gallery opened: ' + fmt(log));
    assert.equal(calls(log, 'stock', 'Toolbar:btnAddSlide').filter(e => e.method === 'click').length, 1,
        'a click is not one click of the stock add slide button: ' + fmt(log));
    assert.deepEqual(calls(log, 'api'), [], 'the button calls the engine directly');
});

test('layout_button_opens_stock_layout_gallery', async () => {
    const env = await mount('none');
    const galleries = recordGalleries(env);
    const btn = find(env, 'layout');
    await env.click(btn);
    assert.equal(galleries.length, 1, 'no gallery');
    assert.equal(galleries[0].ref, 'Toolbar:btnChangeSlide', 'not the stock change layout gallery');
    assert.equal(galleries[0].anchor, btn, 'the gallery is not anchored at the button');
    /* Choosing a layout is a click on a stock gallery tile: the stock button handler.
       The panel does nothing in between. */
    const log = await env.capture(async () => {
        galleries[0].opts.onClose('pick');
        await env.flush();
    });
    assert.deepEqual(log.filter(e => ['api', 'bridge', 'stock', 'command'].includes(e.who)), [],
        'the toolbar acted on the layout pick itself: ' + fmt(log));
    assert.equal(btn.getAttribute('aria-expanded'), 'false', 'the button stays open after a pick');
    const again = await env.capture(() => env.click(btn));
    assert.ok(calls(again, 'bridge', 'Toolbar:btnChangeSlide').some(e => e.method === 'gallery'), 'the gallery does not reopen');
});

test('zoom_set_and_90_through_changedafter', async () => {
    const env = await mount('none');
    await env.fire('asc_onZoomChange', 90, 0);
    const list = await opened(env, find(env, 'zoom'));
    assert.deepEqual(list.map(env.text), ['Fit to Slide', '50%', '75%', '90%', '100%', '125%', '150%', '175%', '200%'].map(
        s => (s === 'Fit to Slide' ? env.text(list[0]) : s)), 'the zoom list');
    assert.ok(env.text(list[0]).length > 0 && !/%/.test(env.text(list[0])), 'no «fit to slide» first');
    assert.ok(list.find(el => env.text(el) === '90%').classList.contains('on'), 'the engine zoom is not marked');
    const runs = recordRuns(env);
    await env.click(list.find(el => env.text(el) === '90%'));
    assert.equal(runs.length, 1, 'not one stock call');
    assert.equal(runs[0].ref, 'ViewTab:cmbZoom', 'not the stock zoom combo');
    assert.equal(runs[0].event, 'changed:after', '90% is not sent as the changed value of the combo');
    assert.equal(runs[0].args[0].value, '90%', 'the record value');
    assert.ok(list.every(el => !env.shown(el)), 'the list stays open after a pick');

    const fit = (await opened(env, find(env, 'zoom')))[0];
    await env.click(fit);
    assert.equal(runs[1] && runs[1].ref, 'ViewTab:btnFitToSlide', 'fit to slide is not the stock button: ' + JSON.stringify(runs));
    await env.setTwin('ViewTab:btnFitToSlide', {pressed: true});
    const again = await opened(env, find(env, 'zoom'));
    assert.ok(again[0].classList.contains('on'), 'fit to slide is not marked while the stock button is pressed');
    await env.click(again[0]);
    assert.equal(runs.length, 2, 'fit to slide toggled the stock button off');
});

test('font_size_list_8_to_96', async () => {
    const env = await mount('text');
    await env.fire('asc_onFontSize', 54);
    const list = await opened(env, find(env, 'size'));
    assert.deepEqual(list.map(el => Number(env.text(el))), [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 96],
        'the font size list');
    assert.deepEqual(list.filter(el => el.classList.contains('on')).map(env.text), ['54'], 'the engine size is not marked');
    const runs = recordRuns(env);
    await env.click(list[list.length - 1]);
    assert.deepEqual(runs.map(r => [r.ref, r.event, r.args[0].value]), [['Toolbar:cmbFontSize', 'selected', 96]], 'the size pick');
});

test('palette_reset_and_custom_color', async () => {
    const PAL = {
        fill: {kind: 'shape', reset: [['RightMenu:shapeSettings.btnBackColor', 'color:select', 'transparent']],
            pick: [['RightMenu:shapeSettings.btnBackColor', 'color:select', 'fb7185']]},
        lineColor: {kind: 'line', reset: [['RightMenu:shapeSettings.cmbBorderSize', 'selected', 0]],
            pick: [['RightMenu:shapeSettings.btnBorderColor', 'color:select', 'fb7185']]},
        tableFill: {kind: 'table', reset: [['RightMenu:tableSettings.btnBackColor', 'color:select', 'transparent']],
            pick: [['RightMenu:tableSettings.btnBackColor', 'color:select', 'fb7185']]},
        tableBorder: {kind: 'table', reset: [['RightMenu:tableSettings._btnsBorderPosition.9', undefined, undefined]],
            pick: [['RightMenu:tableSettings.borderColor', 'select', 'fb7185'], ['RightMenu:tableSettings._btnsBorderPosition.8', undefined, undefined]]}
    };
    const flat = runs => runs.map(r => [r.ref, r.event, r.args && (r.args[0] && typeof r.args[0] === 'object' ? r.args[0].value : r.args[0])]);
    for (const [id, want] of Object.entries(PAL)) {
        const env = await mount(want.kind);
        const btn = find(env, id);
        assert.ok(btn, id + ': no control');
        const items = await opened(env, btn);
        const wrap = btn.parentNode;
        const reset = wrap.querySelector('.vo-pal-reset');
        assert.ok(reset && env.shown(reset) && env.text(reset).length > 0, id + ': no reset row');
        assert.equal(wrap.querySelectorAll('.vo-pal-item').length, 84, id + ': not the 84 colors of the documents palette');
        const custom = wrap.querySelector('.vo-pal-toggle');
        assert.ok(custom && env.shown(custom), id + ': no custom color');
        assert.ok(items.includes(reset) && items.includes(custom), id + ': reset and custom color are not in the popup');

        let runs = recordRuns(env);
        await env.click(reset);
        assert.deepEqual(flat(runs), want.reset, id + ': the reset');
        assert.ok(!env.shown(reset), id + ': the palette stays open after the reset');

        await env.click(btn);
        runs = recordRuns(env);
        await env.click(wrap.querySelector('.vo-pal-item[data-color="fb7185"]'));
        assert.deepEqual(flat(runs), want.pick, id + ': the swatch pick');

        await env.click(btn);
        await env.click(wrap.querySelector('.vo-pal-toggle'));
        const input = wrap.querySelector('.vo-pal-input');
        assert.ok(input && env.shown(input), id + ': the custom color field did not open');
        runs = recordRuns(env);
        input.value = 'zz';
        input.dispatchEvent(new env.ctx.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
        assert.deepEqual(runs, [], id + ': a wrong color code was applied');
        input.value = '#12AB34';
        input.dispatchEvent(new env.ctx.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
        assert.equal(flat(runs)[0][2], want.pick[0][2] === 'fb7185' ? '12ab34' : want.pick[0][2], id + ': the custom color is not applied');
        assert.equal(flat(runs)[0][0], want.pick[0][0], id + ': the custom color goes to another field');
        assert.deepEqual(calls(env.log, 'api').filter(e => !/^asc_enableKeyEvents$/.test(e.ref)), [], id + ': the palette calls the engine directly');
    }

    const env = await mount('line');
    await env.setTwin('RightMenu:shapeSettings.cmbBorderSize', {value: 0});
    await env.click(find(env, 'lineColor'));
    const runs = recordRuns(env);
    await env.click(find(env, 'lineColor').parentNode.querySelector('.vo-pal-item[data-color="2563eb"]'));
    assert.deepEqual(flat(runs), [['RightMenu:shapeSettings.btnBorderColor', 'color:select', '2563eb'], ['RightMenu:shapeSettings.cmbBorderSize', 'selected', 1]],
        'a line color on a shape without a line does not draw a 1 pt line');

    const text = await mount('text');
    text.ctx.Common.Utils.ThemeColor = {getEffectColors: () => [{color: 'ffffff', effectId: 0, effectValue: 6}, {color: '1f1f1f', effectId: 6, effectValue: 15}]};
    await text.click(find(text, 'textPop'));
    await text.click(find(text, 'textColor'));
    const textRuns = recordRuns(text);
    await text.click(text.document.querySelector('[data-vo-wrap="textColor"] .vo-pal-reset'));
    assert.deepEqual(textRuns.map(r => [r.ref, r.event, r.args[0].effectValue]), [['Toolbar:btnFontColor', 'color:select', 15]],
        'automatic text color is not the theme text color');
    await text.click(find(text, 'highlight'));
    const hl = text.document.querySelector('[data-vo-wrap="highlight"]');
    assert.equal(hl.querySelectorAll('.vo-pal-item').length, 16, 'the highlight palette is not the 16 stock highlight colors');
    assert.ok(!hl.querySelector('.vo-pal-toggle'), 'the highlight palette offers a custom color');
    const hlRuns = recordRuns(text);
    await text.click(hl.querySelector('.vo-pal-item[data-color="ffff00"]'));
    await text.click(find(text, 'highlight'));
    await text.click(hl.querySelector('.vo-pal-reset'));
    assert.deepEqual(hlRuns.map(r => [r.ref, r.event, r.args && r.args[0]]),
        [['Toolbar:mnuHighlightColorPicker', 'select', 'FFFF00'], ['Toolbar:mnuHighlightTransparent', undefined, undefined]], 'the highlight picks');
});

test('custom_color_press_without_click_keeps_engine_keys', async () => {
    const env = await mount('shape');
    /* The engine keyboard goes via the scaffold api (engineApi). */
    env.toolbar().shell.engineApi = () => env.api;
    const keys = () => calls(env.log, 'api', 'asc_enableKeyEvents').map(e => e.args[0]);
    const enabled = () => { const k = keys(); return !k.length || k[k.length - 1] === true; };
    await env.click(find(env, 'fill'));
    const wrap = find(env, 'fill').parentNode;
    const toggle = wrap.querySelector('.vo-pal-toggle');
    const input = wrap.querySelector('.vo-pal-input');

    /* The button was pressed and released outside: no click, the engine keyboard stays with the engine. */
    for (const t of ['pointerdown', 'mousedown']) toggle.dispatchEvent(new env.ctx.MouseEvent(t, {bubbles: true}));
    for (const t of ['pointerup', 'mouseup']) env.document.body.dispatchEvent(new env.ctx.MouseEvent(t, {bubbles: true}));
    await env.flush();
    assert.ok(enabled(), 'a press on Custom color without a click left the engine keys off: ' + JSON.stringify(keys()));
    assert.ok(!env.shown(input), 'the custom color field opened without a click');

    /* A click: the field is in focus, keys go to the field; focus leaving gives the keyboard back to the engine. */
    await env.click(toggle);
    assert.ok(env.shown(input), 'the custom color field did not open');
    assert.equal(env.document.activeElement, input, 'the custom color field has no focus');
    assert.equal(keys().at(-1), false, 'the engine keeps the keys while the custom color field has focus: ' + JSON.stringify(keys()));
    input.blur();
    await env.flush();
    assert.ok(enabled(), 'the engine keys are off after the custom color field lost focus');
});

test('current_layout_from_engine', async () => {
    const env = await mount('none');
    const btn = find(env, 'layout');
    const galleries = recordGalleries(env);
    const before = new Set(env.controls());
    await env.click(btn);
    assert.deepEqual(galleries.map(g => [g.ref, g.anchor === btn]), [['Toolbar:btnChangeSlide', true]],
        'Layout does not open the stock layout gallery (the stock picker marks the layout of the current slide)');
    assert.deepEqual(env.controls().filter(el => !before.has(el)), [], 'Layout opened its own list instead of the stock gallery');
    assert.equal(btn.parentNode.querySelector('.vo-pop'), null, 'Layout keeps its own copy of the layouts');
});

test('shape_gallery_survives_the_combo_size_check', async () => {
    const env = await mount('none');
    const combo = env.stubs.twin('Toolbar:cmbsInsertShape.0');
    let open = false, checks = 0;
    combo.openButton = {menu: {parentEl: {hasClass: c => c === 'open' && open}}};
    combo.checkSize = () => { checks++; if (checks === 1) open = false; };
    const galleries = recordGalleries(env, () => { open = true; return true; });
    const btn = find(env, 'shape');
    await env.click(btn);
    assert.equal(checks, 1, 'the combo size is not settled right after the show');
    assert.equal(galleries.length, 2, 'the gallery closed by the size check is not shown again');
    assert.ok(open && btn.classList.contains('on'), 'the shape gallery is not open');
    galleries[1].opts.onClose('pick');
    await env.click(btn);
    assert.equal(galleries.length, 3, 'a settled combo reopened twice');
});

test('text_box_lists_horizontal_and_vertical', async () => {
    const env = await mount('none');
    const btn = find(env, 'textbox');
    assert.ok(btn, 'no text box button');
    assert.ok(btn.querySelector('[data-icon="textAdd"]'), 'the text box button has no T-plus icon: ' + btn.innerHTML.slice(0, 200));
    const box = env.stubs.twin('Toolbar:btnsInsertText.0');
    box.menu.items.push({caption: 'Insert horizontal text box', value: 'textRect', options: {}},
        {caption: 'Insert vertical text box', value: 'textRectVertical', options: {}});
    const rows = await opened(env, btn);
    assert.deepEqual(rows.map(env.text), ['Insert horizontal text box', 'Insert vertical text box'], 'the list is not the stock text box menu');
    const pick = await env.capture(() => env.click(rows[1]));
    assert.ok(calls(pick, 'bridge', 'Toolbar:btnsInsertText.0').some(e => e.method === 'pick'), 'the vertical text box is not picked through the stock menu: ' + fmt(pick));
    assert.ok(rows.every(el => !env.shown(el)), 'the list stays open after a pick');
});

test('lines_are_in_the_shape_gallery', async () => {
    const env = await mount('none');
    assert.ok(!find(env, 'line'), 'a separate line button is on the toolbar');
    const ul = env.document.createElement('ul');
    ul.className = 'dropdown-menu vo-gallery-target';
    ul.innerHTML = ['recent', 'basic', 'lines'].map(g => '<div class="grouped-data" data-g="' + g + '"><div class="item"><svg><use xlink:href="#svg-icon-'
        + (g === 'basic' ? 'rect' : 'line') + '"></use></svg></div></div>').join('');
    env.document.body.appendChild(ul);
    const galleries = recordGalleries(env);
    await env.click(find(env, 'shape'));
    assert.equal(galleries[0].ref, 'Toolbar:cmbsInsertShape.0', 'Shape is not the stock shape gallery');
    const hidden = [...ul.querySelectorAll('.grouped-data')].filter(g => g.classList.length > 1 || g.style.display === 'none');
    assert.deepEqual(hidden.map(g => g.getAttribute('data-g')), [], 'the shape gallery hides some of its groups, the lines among them');
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
