/* Run: node test/unit-tests/presentationeditor/toolbar-measure.cjs [path to CompactToolbar.js]
 * Measuring the presentation shell toolbar row and "⋯": without overflow there is no "⋯";
 * on narrowing, controls go into "⋯" one by one from the end of the row; the core of five does not leave;
 * those moved into "⋯" are the same nodes and the same twin; the right edge #vo-tb-end (the show place and
 * the chevron) is included in the measurement and is not squeezed out; recalculation is on resize, vo:selection,
 * uitheme:changed and shell:toolbar.
 *
 * The module is executed in vm over the DOM model of the toolbar acceptance fixture
 * (acceptance/bar-harness.cjs): an icon button width is 32px, buttons with a caption by its
 * length, no gaps, the card width is set by the test. Controls are recognized by data-vo.
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
    viewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbar-measure-'));
    fs.copyFileSync(path.resolve(process.argv[2]), path.join(viewDir, 'CompactToolbar.js'));
}

const WIDE = 6000;
const CORE = ['undo', 'redo', 'search', 'comment', 'zoom'];

async function mount(kind, show) {
    const env = H.createEnv({kind: kind || 'none', width: WIDE, viewDir});
    await env.mount();
    if (show) {
        const f = env.document.createElement('span');
        f.setAttribute('data-test-width', String(show));
        f.setAttribute('data-test-fixture', 'show');
        env.end().insertBefore(f, env.end().firstChild);
    }
    await env.relayout();
    return env;
}
const vo = el => el.getAttribute('data-vo') || '?' + el.localName;
const ids = env => env.rowEls().map(vo);
const sum = (env, list) => list.reduce((s, el) => s + env.width(el), 0);

/* Width without recalculating the toolbar itself: only changing the model width. */
function resizeQuietly(env, W) {
    env.W = W;
    env.document.version++;
}

const tests = [];
const test = (name, fn) => tests.push({name, fn});

test('no_overflow_no_more_button', async () => {
    for (const kind of ['none', 'text', 'image', 'table']) {
        const env = await mount(kind, 120);
        const full = env.rowEls();
        assert.ok(!env.moreShown(), kind + ': «⋯» without overflow');
        const fit = sum(env, full) + env.width(env.end());
        await env.setWidth(fit);
        assert.deepEqual(env.rowEls(), full, kind + ': at the exact width something left the row');
        assert.ok(!env.moreShown(), kind + ': «⋯» at the exact width');
        await env.setWidth(fit - 1);
        assert.ok(env.moreShown(), kind + ': one pixel short, but no «⋯»');
    }
    /* Recalculation comes by itself: window resize, theme change, a scaffold row, selection. */
    const env = await mount('none');
    const full = env.rowEls().length;
    const narrow = sum(env, env.rowEls().slice(0, 8)) + env.width(env.end()) + 40;
    resizeQuietly(env, narrow);
    env.winTarget.dispatchEvent(env.ctx.Event('resize'));
    await env.flush();
    assert.ok(env.moreShown() && env.rowEls().length < full, 'no relayout on a window resize');
    resizeQuietly(env, WIDE);
    env.nc.trigger('uitheme:changed');
    await env.flush();
    assert.ok(!env.moreShown(), 'no relayout on a theme change');
    resizeQuietly(env, narrow);
    env.nc.trigger('shell:toolbar');
    await env.flush();
    assert.ok(env.moreShown(), 'no relayout on a shell row change');
    resizeQuietly(env, WIDE);
    env.kind = 'image';
    env.nc.trigger('vo:selection', {kind: 'image'});
    await env.flush();
    assert.ok(!env.moreShown(), 'no relayout on a selection change');
});

test('overflow_from_end_one_by_one', async () => {
    for (const kind of ['none', 'text']) {
        const env = await mount(kind, 120);
        const full = env.rowEls(), endW = env.width(env.end());
        const widths = new Map(full.map(el => [el, env.width(el)]));
        let prev = 0, moreW = 0;
        for (let W = sum(env, full) + endW; W >= 300; W -= 3) {
            await env.setWidth(W);
            const shown = env.rowEls();
            assert.ok(shown.every((el, i) => el === full[i]), kind + ' ' + W + ': not a prefix of the row: ' + shown.map(vo).join(' '));
            const gone = full.length - shown.length;
            assert.ok(gone >= prev, kind + ' ' + W + ': a control came back while narrowing');
            prev = gone;
            assert.equal(env.moreShown(), gone > 0, kind + ' ' + W + ': «⋯» does not follow the overflow');
            if (!gone) continue;
            moreW = moreW || env.width(env.more());
            const used = sum(env, shown);
            const next = full[shown.length];
            if (shown.length > CORE.length) {
                const last = full.length - shown.length === 1;
                assert.ok(used + widths.get(next) + endW + (last ? 0 : moreW) > W, kind + ' ' + W + ': «' + vo(next) + '» fits but left the row');
                assert.ok(used + endW + moreW <= W, kind + ' ' + W + ': the row is wider than the card');
            }
        }
        assert.ok(prev > 0, kind + ': nothing left the row');
    }
});

test('core_five_never_leave', async () => {
    for (const kind of ['none', 'text', 'typing', 'chart']) {
        const env = await mount(kind, 120);
        const need = sum(env, env.rowEls()) + env.width(env.end());
        for (const W of [900, 500, 300, 200, 60]) {
            await env.setWidth(W);
            const row = ids(env);
            assert.deepEqual(row.slice(0, 5), CORE, kind + ' ' + W + ': the core left: ' + row.join(' '));
            assert.equal(env.moreShown(), need > W, kind + ' ' + W + ': «⋯» does not follow the overflow');
        }
        assert.deepEqual(ids(env), CORE, kind + ': at 60 more than the core stays');
    }
});

test('more_items_call_same_twin', async () => {
    const env = await mount('text', 120);
    const full = env.rowEls();
    const onPanel = {};
    for (const el of full) {
        const id = vo(el);
        if (CORE.includes(id)) continue;
        const log = await env.capture(() => env.click(el));
        onPanel[id] = log.filter(e => ['bridge', 'command', 'owner', 'api'].includes(e.who)).map(e => [e.who, e.ref, e.method].join('|'));
        await env.clickOutside();
    }
    const W = sum(env, full.slice(0, 5)) + env.width(env.end()) + 32;
    await env.setWidth(W);
    const gone = full.filter(el => !env.rowEls().includes(el));
    assert.ok(gone.length >= 10, 'too few controls left: ' + gone.length);
    await env.click(env.moreToggle());
    const inMore = env.controls(env.more()).filter(el => el !== env.moreToggle());
    assert.deepEqual(inMore.map(vo), gone.map(vo), '«⋯» does not hold the gone controls in row order');
    assert.ok(gone.every(el => inMore.includes(el)), '«⋯» holds copies instead of the row controls');
    assert.ok(env.document.querySelectorAll('[data-vo="painter"]').length === 1, 'two Format painter controls');

    for (const el of gone) {
        const id = vo(el);
        if (!env.more().classList.contains('open')) await env.click(env.moreToggle());
        const log = await env.capture(() => env.click(el));
        const got = log.filter(e => ['bridge', 'command', 'owner', 'api'].includes(e.who)).map(e => [e.who, e.ref, e.method].join('|'));
        assert.deepEqual(got, onPanel[id], id + ': works differently in «⋯»');
        await env.clickOutside();
    }

    /* A command from "⋯" closes "⋯"; nodes return to their groups in the former order. */
    await env.click(env.moreToggle());
    await env.click(env.more().querySelector('[data-vo="painter"]'));
    assert.ok(!env.more().classList.contains('open'), '«⋯» stays open after a command');
    await env.setWidth(WIDE);
    assert.deepEqual(env.rowEls(), full, 'the row order changed after «⋯»');
    const insert = env.card.querySelector('.vo-g[data-group="insert"]');
    assert.deepEqual([...insert.children].map(n => n.getAttribute('data-vo-wrap') || vo(n)), ['image', 'shape', 'textbox', 'link'],
        'the insert group order changed after «⋯»');
});

test('right_edge_never_pushed', async () => {
    for (const show of [0, 120, 260]) {
        const env = await mount('none', show);
        const end = env.end(), endW = env.width(end);
        const coreW = sum(env, env.rowEls().slice(0, 5));
        let moreW = 0;
        for (let W = 2000; W >= 60; W -= 7) {
            await env.setWidth(W);
            const tag = 'show ' + show + ', width ' + W;
            assert.ok(env.shown(end) && vo(end.lastElementChild) === 'focus', tag + ': no focus chevron at the right edge');
            if (show) assert.ok(env.shown(end.querySelector('[data-test-fixture="show"]')), tag + ': the show button place is hidden');
            if (env.moreShown()) moreW = env.width(env.more());
            if (W < coreW + endW + moreW) continue;
            const e = env.rect(end);
            assert.ok(e.right <= W, tag + ': the right edge is pushed out (' + e.right + ')');
            if (env.moreShown()) assert.ok(env.rect(env.more()).right <= e.left, tag + ': «⋯» overlaps the right edge');
        }
    }
    /* The right edge width is included in the measurement: the wider the edge, the earlier buttons go. */
    const narrow = await mount('none', 0), wide = await mount('none', 260);
    for (const W of [1400, 1100, 900]) {
        await narrow.setWidth(W);
        await wide.setWidth(W);
        assert.ok(wide.rowEls().length <= narrow.rowEls().length, 'width ' + W + ': the right edge width is not in the measure');
    }
    /* Where an empty edge still holds the whole row, but a 260 edge no longer does. */
    const seen = [];
    let pushed = false;
    for (let W = 1100; W >= 700 && !pushed; W -= 25) {
        await narrow.setWidth(W);
        await wide.setWidth(W);
        seen.push(W + ':' + narrow.rowEls().length + '/' + wide.rowEls().length);
        pushed = wide.rowEls().length < narrow.rowEls().length;
    }
    assert.ok(pushed, 'a 260 px right edge keeps the same row as an empty one: ' + seen.join(' '));
});

/* "Slide show ▾" in the show button markup: an icon and a caption, an arrow. */
function realShow(env, caption) {
    const d = env.document, mk = (tag, cls) => { const n = d.createElement(tag); n.className = cls; return n; };
    const wrap = mk('span', 'vo-show'), main = mk('button', 'vo-show-main'), play = mk('span', 'vo-show-i');
    const label = mk('span', 'vo-show-label'), arrow = mk('button', 'vo-show-arrow');
    play.appendChild(mk('span', 'vo-test-ico'));
    label.textContent = caption;
    arrow.appendChild(mk('span', 'vo-test-ico'));
    main.appendChild(play);
    main.appendChild(label);
    wrap.appendChild(main);
    wrap.appendChild(arrow);
    env.end().insertBefore(wrap, env.end().firstChild);
    return {wrap, label};
}

test('show_caption_folds_when_core_and_edge_do_not_fit', async () => {
    const env = await mount('none');
    const {wrap, label} = realShow(env, 'Показ слайдов');
    await env.relayout();
    const end = env.end(), endWide = env.width(end), coreW = sum(env, env.rowEls().slice(0, 5));
    assert.ok(env.shown(label), 'the show caption is folded in a wide window');
    await env.setWidth(coreW + endWide + 300);
    const moreW = env.width(env.more());
    assert.ok(env.moreShown() && moreW > 0, 'no «⋯» while the tail does not fit');
    const edge = coreW + endWide + moreW;
    await env.setWidth(edge);
    assert.ok(env.shown(label), edge + ': the caption folded while the core and the edge fit');
    await env.setWidth(edge - 1);
    const tightW = coreW + env.width(end) + moreW;
    assert.ok(tightW < edge - 1, 'the folded caption does not narrow the right edge');
    for (const W of [edge - 1, edge - 40, tightW]) {
        await env.setWidth(W);
        assert.ok(!env.shown(label), W + ': the core and the edge do not fit, but the caption stays');
        assert.ok(env.shown(wrap) && env.width(wrap) > 0 && env.width(wrap) < endWide, W + ': the show button is not an icon');
        /* The whole core; in the place of the collapsed caption the first tail control can stand: "Copy style". */
        assert.deepEqual(ids(env).slice(0, CORE.length), CORE, W + ': the core is not whole');
        assert.ok(ids(env).slice(CORE.length).every(id => id === 'painter'), W + ': more than the format painter after the core: ' + ids(env));
        assert.ok(env.moreShown(), W + ': no «⋯»');
        assert.ok(env.rect(end).right <= W, W + ': the right edge is pushed out (' + env.rect(end).right + ')');
        assert.equal(vo(end.lastElementChild), 'focus', W + ': no focus chevron last');
    }
    await env.setWidth(WIDE);
    assert.ok(env.shown(label) && !env.moreShown(), 'the caption does not come back in a wide window');
    /* In the header (no toolbar) the caption does not collapse. */
    await env.setWidth(coreW + 40);
    env.document.body.appendChild(wrap);
    env.document.version++;
    assert.ok(env.shown(label), 'the caption is folded outside the toolbar');
});

test('selection_relayouts_only_when_groups_change', async () => {
    const env = await mount('shape');
    const W = sum(env, env.rowEls().slice(0, 8)) + env.width(env.end()) + 40;
    await env.setWidth(W);
    assert.ok(env.moreShown(), 'no «⋯» in a narrow card');
    const tb = env.toolbar(), relayout = tb.relayout;
    let measured = 0;
    tb.relayout = function () { measured++; return relayout.apply(this, arguments); };
    const open = () => env.more().classList.contains('open');
    await env.click(env.moreToggle());
    assert.ok(open(), '«⋯» did not open');

    /* Another object of the same kind: the same groups, "⋯" is open, no measurement. */
    measured = 0;
    env.nc.trigger('vo:selection', {kind: 'shape'});
    await env.flush();
    assert.ok(open(), 'a selection of the same kind closed «⋯»');
    assert.equal(measured, 0, 'the row is measured on a selection of the same kind');

    /* Another kind: "⋯" closes, the measurement is in a frame, not immediately. */
    measured = 0;
    env.kind = 'image';
    env.nc.trigger('vo:selection', {kind: 'image'});
    assert.ok(!open(), 'the groups changed, but «⋯» stays open');
    assert.equal(measured, 0, 'the row is measured synchronously on a selection');
    await env.flush();
    assert.ok(measured >= 1, 'no relayout after the groups changed');
    assert.ok(env.moreShown() && env.rowEls().length > 0, 'the row is not measured for the new groups');

    measured = 0;
    env.nc.trigger('vo:selection', {kind: 'image'});
    await env.flush();
    assert.equal(measured, 0, 'the row is measured on a selection that changes nothing');
    /* A scaffold row: always recalculate. */
    env.nc.trigger('shell:toolbar');
    await env.flush();
    assert.ok(measured >= 1, 'no relayout on a shell row change');
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
