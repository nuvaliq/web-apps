'use strict';
/* Run: node test/unit-tests/presentationeditor/acceptance/bar-measure.cjs [--only <name>]
 * Measuring the presentation shell toolbar row and "⋯". PE.Views.CompactToolbar
 * is executed in vm; control widths are set by the fixture DOM model (an icon button 32px,
 * a button with a caption by the caption length, no gaps), the card width by the test.
 * A node of a given width is put into the right edge #vo-tb-end in place of the show button:
 * the scaffold sets it, and the measurement must account for it. Live layout pixels are checked in the live editor.
 */
const assert = require('node:assert/strict');
const H = require('./bar-harness.cjs');

const CORE = ['undo', 'redo', 'search', 'comment', 'zoom'];
const WIDE = 6000;
const SHOW_WIDTH = 120;

async function setup(kind) {
    const env = await H.mount({kind, width: WIDE});
    const end = env.end();
    assert.ok(end, 'в карточке панели нет правого края #vo-tb-end');
    const show = env.document.createElement('span');
    show.setAttribute('data-test-width', String(SHOW_WIDTH));
    show.setAttribute('data-test-fixture', 'show');
    end.insertBefore(show, end.firstChild);
    await env.relayout();
    const full = env.rowEls();
    const widths = new Map(full.map(el => [el, env.width(el)]));
    const sum = list => list.reduce((s, el) => s + widths.get(el), 0);
    const coreW = sum(full.filter(el => CORE.includes(env.idOf(el))));
    return {env, end, show, full, widths, sum, coreW, endW: env.width(end)};
}
const sameStart = (shown, full) => shown.length <= full.length && shown.every((el, i) => el === full[i]);
const show = (env, list) => list.map(env.idOf).join(', ');

H.test('overflow_moves_tail_into_more_core_stays', async () => {
    for (const kind of ['none', 'text']) {
        const {env, full, widths, sum, coreW, endW} = await setup(kind);
        const ids = full.map(env.idOf);
        assert.ok(!env.moreShown(), `${kind}: всё помещается, а «⋯» видна`);
        for (const c of CORE) assert.ok(ids.includes(c), `${kind}: в ряду нет «${c}»: ${ids.join(', ')}`);
        let prev = 0, moreW = null;
        for (let W = sum(full) + endW + 60; W >= 60; W -= 5) {
            await env.setWidth(W);
            const tag = `${kind}, ширина ${W}`;
            const shown = env.rowEls();
            assert.ok(sameStart(shown, full), `${tag}: ушли не кнопки с конца ряда, видны: ${show(env, shown)}`);
            const hidden = full.length - shown.length;
            const shownIds = shown.map(env.idOf);
            for (const c of CORE) assert.ok(shownIds.includes(c), `${tag}: «${c}» ушла из ряда`);
            assert.equal(env.moreShown(), hidden > 0, hidden ? `${tag}: ${hidden} кнопок не помещаются, а «⋯» нет` : `${tag}: всё помещается, а «⋯» видна`);
            assert.ok(hidden >= prev, `${tag}: при сужении вернулись ушедшие кнопки (${prev} → ${hidden})`);
            prev = hidden;
            if (hidden && moreW === null) moreW = env.width(env.more());
            if (moreW === null || W < coreW + moreW + endW) continue;
            const used = env.contentWidth();
            assert.ok(used <= W, `${tag}: ряд занимает ${used}px — шире панели`);
            if (!hidden) continue;
            let k = shown.length, unit = 0;
            const next = env.idOf(full[k]);
            while (k < full.length && env.idOf(full[k]) === next) { unit += widths.get(full[k]); k++; }
            const would = used + unit - (k === full.length ? moreW : 0);
            assert.ok(would > W, `${tag}: «${next}» помещается (${would}px), но ушла в «⋯»`);
        }
        assert.ok(prev > 0, `${kind}: даже на самой узкой ширине ничего не ушло в «⋯»`);
    }
});

/* Calls of stock, the bridge, the engine and scaffold commands per click, without the toolbar's
   own layout service events. */
const signature = log => log
    .filter(e => ['stock', 'bridge', 'api', 'command', 'owner'].includes(e.who)
        || (e.who === 'nc' && !/^(vo|shell|toolbar|layout):/.test(e.ref)))
    .map(e => `${e.who}|${e.ref}|${e.method}|${JSON.stringify(e.args)}`);

H.test('overflowed_buttons_act_alike_and_right_edge_kept', async () => {
    const {env, end, full, coreW, endW} = await setup('none');
    const onPanel = {};
    for (const el of full) {
        const id = env.idOf(el);
        if (CORE.includes(id) || id in onPanel) continue;
        onPanel[id] = signature(await env.capture(() => env.click(el)));
        await env.clickOutside();
    }
    const narrow = coreW + endW + 32 + 40;
    await env.setWidth(narrow);
    const row = new Set(env.rowEls());
    const gone = [...new Set(full.filter(el => !row.has(el)).map(env.idOf))];
    assert.ok(gone.length >= 3, `на ширине ${narrow} в «⋯» ушло меньше трёх кнопок: ${gone.join(', ')}`);
    const extras = () => {
        const inRow = new Set(env.rowEls()), toggle = env.moreToggle();
        return env.controls().filter(c => !inRow.has(c) && !end.contains(c) && c !== toggle);
    };
    let nonEmpty = 0;
    for (const id of gone) {
        let items = extras();
        if (!items.length) { await env.click(env.moreToggle()); items = extras(); }
        const el = items.find(c => env.idOf(c) === id);
        assert.ok(el, `«${id}» нет в открытой «⋯»: ${show(env, items) || '«⋯» пуста'}`);
        const got = signature(await env.capture(() => env.click(el)));
        assert.deepEqual(got, onPanel[id], `«${id}» в «⋯» работает не так, как на панели: [${got.join('; ')}] вместо [${onPanel[id].join('; ')}]`);
        if (got.length) nonEmpty++;
        await env.clickOutside();
    }
    assert.ok(nonEmpty > 0, 'ни одна ушедшая в «⋯» кнопка не вызвала штатную команду ни на панели, ни в «⋯»');

    for (const W of [WIDE, 1440, 1280, 900, coreW + endW + 80, coreW + endW + 33, 200, 120, 60]) {
        await env.setWidth(W);
        const tag = `ширина ${W}`;
        assert.ok(env.shown(end), `${tag}: правый край панели скрыт`);
        const endIds = env.controls(end).map(env.idOf);
        assert.equal(endIds[endIds.length - 1], 'focus', `${tag}: у правого края нет шеврона фокуса: ${endIds.join(', ') || 'пусто'}`);
        assert.ok(env.shown(end.querySelector('[data-test-fixture="show"]')), `${tag}: место «Показ слайдов ▾» у правого края скрыто`);
        const overflow = env.rowEls().length < full.length;
        if (overflow) assert.ok(env.moreShown(), `${tag}: кнопки ушли, а «⋯» скрыта`);
        const moreW = env.moreShown() ? env.width(env.more()) : 0;
        if (W < coreW + endW + moreW) continue;
        const e = env.rect(end);
        assert.ok(e.right <= W, `${tag}: правый край выдавлен за панель (${e.right} > ${W})`);
        if (env.moreShown()) {
            const m = env.rect(env.more());
            assert.ok(m.right <= e.left, `${tag}: «⋯» заходит на правый край (${m.right} > ${e.left})`);
        }
    }
});

H.test('no_selection_row_thirteen_buttons_slide_buttons_leave_first', async () => {
    const {env, full, widths, endW} = await setup('none');
    /* Without a selection there is no "Copy style": it sits in the text group and without a
       selection is always disabled. */
    /* There is no separate "Line ▾": lines are in the "Shape ▾" gallery; "Text box" comes after "Shape". */
    const THIRTEEN = ['undo', 'redo', 'search', 'comment', 'zoom', 'newSlide', 'image', 'shape', 'textbox',
        'bg', 'layout', 'theme', 'transition'];
    assert.deepEqual(env.rowIds(), THIRTEEN, 'при пустом выделении ряд — не 13 кнопок в порядке требований');
    const byId = id => full.filter(el => env.idOf(el) === id).reduce((s, el) => s + widths.get(el), 0);
    const all = THIRTEEN.reduce((s, id) => s + byId(id), 0);
    await env.setWidth(all + endW);
    assert.deepEqual(env.rowIds(), THIRTEEN, `на ширине ${all + endW}, где помещаются все 13, видны не все`);
    assert.ok(!env.moreShown(), 'все 13 помещаются, а «⋯» видна');
    await env.setWidth(all + endW - 1);
    assert.ok(env.moreShown(), 'ряд не помещается, а «⋯» нет');
    const moreW = env.width(env.more());
    const W11 = THIRTEEN.slice(0, 11).reduce((s, id) => s + byId(id), 0) + moreW + endW + 1;
    await env.setWidth(W11);
    assert.deepEqual(env.rowIds(), THIRTEEN.slice(0, 11), `на ширине ${W11} видны не 11 первых кнопок`);
    const inMore = (await env.openMore()).map(env.idOf);
    /* They go into "⋯" from the end: "Theme" and "Transition" first. */
    assert.deepEqual(inMore.filter((id, i) => id !== inMore[i - 1]), ['theme', 'transition'],
        `в «⋯» не «Тема» и «Переход»: ${inMore.join(', ') || 'пусто'}`);
});

H.run();
