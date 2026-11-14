'use strict';
/* Run: node test/unit-tests/presentationeditor/acceptance/bar-row.cjs [--only <name>]
 * The composition and order of the presentation shell toolbar row by selection kind.
 * PE.Views.CompactToolbar is executed in vm; the selection kind is set via
 * SlideSelection.kind() and the vo:selection event, the row is read from the DOM at a width
 * at which nothing goes into "⋯". Controls are recognized by caption or hint.
 */
const assert = require('node:assert/strict');
const H = require('./bar-harness.cjs');

const KINDS = ['none', 'text', 'shape', 'image', 'table', 'chart', 'line', 'typing'];
const CORE = ['undo', 'redo', 'search', 'comment', 'zoom'];
const WIDE = 6000;

async function rows(kinds) {
    const env = await H.mount({kind: kinds[0], width: WIDE});
    const out = {};
    for (const kind of kinds) {
        await env.setKind(kind);
        out[kind] = env.rowIds();
    }
    return {env, out};
}
const show = ids => ids.join(', ');

H.test('toolbar_white_card_core_first_painter_by_text_chevron_right', async () => {
    const {env, out} = await rows(KINDS);
    for (const kind of KINDS) {
        const ids = out[kind];
        assert.deepEqual(ids.slice(0, 5), CORE, `${kind}: ряд начинается не с «Отменить · Повторить · Поиск · Комментарий · Масштаб»: ${show(ids)}`);
    }
    /* "Copy style" is next to B · I · U and appears together with them;
       for a shape without text and a line the stock button is alive too: there it is alone in the
       place of the text group. Without a selection, on a picture and on a chart the stock button is always
       disabled: it is absent. */
    for (const kind of ['text', 'table', 'typing']) {
        const ids = out[kind], u = ids.indexOf('underline');
        assert.deepEqual(ids.slice(u - 2, u + 2), ['bold', 'italic', 'underline', 'painter'], `${kind}: «Формат по образцу» не рядом с Ж · К · Ч: ${show(ids)}`);
    }
    for (const kind of ['shape', 'line']) {
        assert.equal(out[kind][5], 'painter', `${kind}: «Формат по образцу» не на месте текстовой группы: ${show(out[kind])}`);
    }
    for (const kind of ['none', 'image', 'chart']) {
        assert.ok(!out[kind].includes('painter'), `${kind}: «Формат по образцу» на панели, хотя штатная кнопка погашена: ${show(out[kind])}`);
    }
    const end = env.end();
    assert.ok(end && env.card.contains(end), 'в карточке панели нет правого края #vo-tb-end');
    const endCtl = env.controls(end);
    const last = endCtl[endCtl.length - 1];
    assert.ok(last && env.idOf(last) === 'focus', `последний контрол у правого края не шеврон режима фокуса: ${endCtl.map(e => env.names(e).join('/')).join(', ') || 'пусто'}`);
    const rowEls = env.rowEls();
    assert.ok(rowEls.every(el => el.compareDocumentPosition(end) & 4), 'правый край стоит в разметке не после кнопок ряда');
    assert.ok(env.atRightEdge(end), '#vo-tb-end не прижат к правому краю карточки');
    const card = env.background(env.card);
    assert.ok(H.isWhite(card), `фон карточки панели не белый: «${card || 'не задан'}»`);
    const field = env.fieldBackground(env.card);
    assert.ok(H.isLightGrey(field), `под карточкой панели нет серого поля: «${field || 'не задано'}»`);
});

H.test('no_selection_shows_slide_buttons_after_insert_without_text_fill', async () => {
    const {env, out} = await rows(['none']);
    const ids = out.none;
    const at = ids.indexOf('textbox');
    assert.ok(at > 0, `при пустом выделении нет группы вставки (нет «Надпись ▾»): ${show(ids)}`);
    assert.deepEqual(ids.slice(at + 1, at + 5), ['bg', 'layout', 'theme', 'transition'],
        `после группы вставки не стоят «Фон · Макет ▾ · Тема · Переход»: ${show(ids)}`);
    const want = {bg: 'Фон', layout: 'Макет', theme: 'Тема', transition: 'Переход'};
    for (const [id, text] of Object.entries(want)) {
        const el = env.find(id, env.card);
        const visible = el ? env.text(el) : '';
        assert.ok(new RegExp('^' + text + '(\\s*▾)?$').test(visible), `«${text}» — кнопка без видимой подписи: «${visible}»`);
    }
    for (const id of ['font', 'size', 'bold', 'italic', 'underline', 'textPop', 'align', 'lists', 'fill', 'lineColor', 'lineWidth', 'lineType']) {
        assert.ok(!ids.includes(id), `при пустом выделении на панели есть «${id}»: ${show(ids)}`);
    }
});

/* Text means the selection has text: a text box, a placeholder, a shape or group with text
   (kind text), a table, text input. A shape or group without text (kind shape) gets no text
   buttons. */
H.test('text_controls_follow_core_only_for_text_and_table', async () => {
    const {env, out} = await rows(KINDS);
    const TEXT = ['font', 'size', 'bold', 'italic', 'underline', 'painter', 'textPop', 'align', 'lists'];
    for (const kind of ['text', 'table', 'typing']) {
        const ids = out[kind];
        assert.deepEqual(ids.slice(5, 5 + TEXT.length), TEXT,
            `${kind}: сразу после первой группы не стоят шрифт, кегль, Ж · К · Ч, «Формат по образцу», «Стили текста ▾», «Выравнивание и интервал ▾», «Списки и отступы ▾»: ${show(ids)}`);
    }
    for (const kind of ['none', 'shape', 'image', 'chart', 'line']) {
        const extra = TEXT.filter(id => id !== 'painter' && out[kind].includes(id));
        assert.deepEqual(extra, [], `${kind}: на панели есть текстовые кнопки: ${show(out[kind])}`);
    }
    await env.setKind('text');
    const size = env.find('size', env.card);
    const before = new Set(env.controls());
    await env.click(size);
    const values = env.controls().filter(el => !before.has(el)).map(env.text).filter(t => /^\d+$/.test(t)).map(Number);
    for (const v of [8, 28, 32, 36, 40, 44, 48, 54, 60, 72, 96]) {
        assert.ok(values.includes(v), `кегль не открывается списком 8 … 96: нет ${v} среди [${values.join(', ')}]`);
    }
    assert.equal(Math.min(...values), 8, `список кегля начинается не с 8: [${values.join(', ')}]`);
    assert.equal(Math.max(...values), 96, `список кегля кончается не на 96: [${values.join(', ')}]`);
});

H.test('fill_and_line_controls_for_text_or_shape_hidden_while_typing', async () => {
    const {out} = await rows(['text', 'shape', 'typing']);
    const FILL = ['fill', 'lineColor', 'lineWidth', 'lineType'];
    for (const kind of ['text', 'shape']) {
        const ids = out[kind];
        const at = ids.indexOf('fill');
        assert.ok(at >= 0, `${kind}: нет «Цвет заливки»: ${show(ids)}`);
        assert.deepEqual(ids.slice(at, at + 4), FILL, `${kind}: нет подряд цвета заливки, цвета, толщины и типа линии: ${show(ids)}`);
        assert.ok(ids.includes('objProps'), `${kind}: нет «Свойства объекта»: ${show(ids)}`);
    }
    const typing = FILL.concat('objProps').filter(id => out.typing.includes(id));
    assert.deepEqual(typing, [], `во время ввода текста на панели есть заливка, контур или свойства: ${show(out.typing)}`);
});

H.test('image_selection_shows_crop_replace_actual_size_properties', async () => {
    const {out} = await rows(['image']);
    const ids = out.image;
    const at = ids.indexOf('crop');
    assert.ok(at >= 0, `при выделенном изображении нет «Обрезать»: ${show(ids)}`);
    assert.deepEqual(ids.slice(at, at + 4), ['crop', 'cropShape', 'replace', 'actual'],
        `нет подряд «Обрезать», «Обрезать по фигуре ▾», «Заменить изображение ▾», «Реальный размер»: ${show(ids)}`);
    assert.ok(ids.includes('objProps'), `при выделенном изображении нет «Свойства объекта»: ${show(ids)}`);
});

H.test('table_chart_line_selections_show_their_controls_and_properties', async () => {
    const {out} = await rows(['table', 'chart', 'line']);
    const groups = {table: ['fill', 'borderColor', 'rowsCols'], chart: ['editData', 'chartType'], line: ['lineColor', 'lineWidth', 'lineType']};
    for (const [kind, group] of Object.entries(groups)) {
        const ids = out[kind];
        const at = ids.indexOf(group[0]);
        assert.ok(at >= 0, `${kind}: нет «${group[0]}»: ${show(ids)}`);
        assert.deepEqual(ids.slice(at, at + group.length), group, `${kind}: группа не стоит подряд: ${show(ids)}`);
        assert.ok(ids.includes('objProps'), `${kind}: нет «Свойства объекта»: ${show(ids)}`);
    }
});

H.test('insert_group_fixed_link_only_for_text_and_table', async () => {
    const {out} = await rows(KINDS);
    for (const kind of KINDS) {
        const ids = out[kind];
        /* There is no separate "Line ▾" (lines are in the "Shape ▾" gallery), "Text box" comes after "Shape". */
        const at = ids.indexOf('image');
        assert.ok(at >= 0, `${kind}: нет «Изображение ▾»: ${show(ids)}`);
        assert.deepEqual(ids.slice(at, at + 3), ['image', 'shape', 'textbox'],
            `${kind}: в группе вставки нет подряд «Изображение ▾», «Фигура ▾», «Надпись»: ${show(ids)}`);
        assert.ok(!ids.includes('line'), `${kind}: отдельная «Линия ▾» в ряду: ${show(ids)}`);
        const withLink = ['text', 'table', 'typing'].includes(kind);
        if (withLink) assert.equal(ids[at + 3], 'link', `${kind}: «Ссылка» не стоит в группе вставки: ${show(ids)}`);
        else assert.ok(!ids.includes('link'), `${kind}: «Ссылка» есть без текста или таблицы: ${show(ids)}`);
    }
});

/* Slide buttons with a caption are AIR buttons of size S in the plain style (ui.air-buttons
   ui-btn-sm --style-plain): height 28, radius 8, padding 9 on the left minus the icon
   compensation 4, icon 20 with a gap of 4, font 13/400, letter spacing −0.15px, no border and
   background; "Layout ▾" has 9 minus 3 on the right and a 16 chevron. */
H.test('slide_buttons_are_small_plain_air_buttons', async () => {
    const env = await H.mount({kind: 'none', width: WIDE});
    const css = (el, p) => String(env.cssValue(el, p) || '').trim();
    for (const id of ['newSlide', 'bg', 'layout', 'theme', 'transition']) {
        const el = env.find(id, env.card);
        assert.ok(el, `нет кнопки ${id}`);
        const drop = id === 'layout';
        assert.equal(css(el, 'height'), '28px', `${id}: рост не btn-size-sm`);
        assert.equal(css(el, 'border-radius'), '8px', `${id}: радиус не border-radius-sm`);
        assert.equal(css(el, 'padding'), drop ? '0 6px 0 5px' : '0 9px 0 5px', `${id}: поля не AIR S`);
        assert.equal(css(el, 'gap'), '4px', `${id}: зазор значка не btn-icon-space sm`);
        assert.equal(css(el, 'border'), 'none', `${id}: у plain есть рамка`);
        assert.equal(css(el, 'background'), 'transparent', `${id}: у plain есть фон`);
        assert.equal(css(el, 'font-size'), '13px', `${id}: шрифт не font-size-sm`);
        assert.equal(css(el, 'font-weight'), '400', `${id}: начертание не normal`);
        assert.equal(css(el, 'letter-spacing'), '-.15px', `${id}: межбуквенный не btn-letter-spacing sm`);
        /* The icon is a .vo-air mask (icons are stubbed in the fixture): the size comes from the button rule. */
        const mask = host => { const m = host.ownerDocument.createElement('span'); m.className = 'vo-air'; host.appendChild(m); return m; };
        assert.equal(css(mask(drop ? el.querySelector('.vo-drop-i') : el), 'width'), '20px', `${id}: значок не btn-icon-size sm`);
        if (drop) {
            const caret = el.querySelector('.vo-drop-c');
            assert.ok(caret, 'у «Макета ▾» нет шеврона');
            assert.equal(css(mask(caret), 'width'), '16px', '«Макет ▾»: шеврон не dropdown-icon-size sm');
        }
    }
});

H.run();
