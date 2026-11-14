'use strict';
/* Run: node test/unit-tests/presentationeditor/acceptance/bar-popups.cjs [--only <name>]
 * Drop-down panels, "Object properties", "New slide" and the button state of the
 * presentation shell toolbar. PE.Views.CompactToolbar is executed in vm;
 * stock ribbon buttons, the engine api and the comments panel are stubs with spies.
 */
const assert = require('node:assert/strict');
const H = require('./bar-harness.cjs');

const WIDE = 6000;
const opened = async (env, el) => {
    const before = new Set(env.controls());
    await env.click(el);
    return env.controls().filter(c => !before.has(c));
};
const ids = (env, list) => list.map(env.idOf).filter((id, i, a) => id !== a[i - 1]);
const acts = (log, who) => log.filter(e => !who || who.includes(e.who));
const fmt = log => log.map(e => `${e.who}:${e.ref}.${e.method}`).join(', ') || 'нет вызовов';

H.test('text_popup_holds_styles_and_stays_open_on_toggle', async () => {
    const env = await H.mount({kind: 'text', width: WIDE});
    /* B · I · U are separate buttons on the toolbar, right after the font size. */
    const row = env.rowIds();
    const size = row.indexOf('size');
    assert.deepEqual(row.slice(size + 1, size + 4), ['bold', 'italic', 'underline'], `после кегля не стоят Ж · К · Ч: ${row.join(', ')}`);
    for (const id of ['bold', 'italic', 'underline']) {
        const log = await env.capture(() => env.click(env.find(id, env.card)));
        assert.ok(acts(log, ['stock', 'bridge']).some(e => /Toolbar:btn(Bold|Italic|Underline)/.test(e.ref)), `щелчок по «${id}» на панели не дошёл до штатной кнопки: ${fmt(log)}`);
    }
    const btn = env.find('textPop', env.card);
    assert.ok(btn, `при выделенном тексте нет «Стили текста ▾»: ${env.rowIds().join(', ')}`);
    const items = await opened(env, btn);
    const got = ids(env, items);
    const want = ['strike', 'sup', 'sub', 'textColor', 'highlight', 'case', 'clearFmt'];
    assert.deepEqual(got, want, `в «Стилях текста ▾» не ${want.join(', ')}: ${got.join(', ') || 'панель не открылась'}`);
    for (const id of ['strike', 'sup', 'sub']) {
        const el = items.find(c => env.idOf(c) === id);
        const log = await env.capture(() => env.click(el));
        assert.ok(acts(log, ['stock', 'bridge', 'api']).length > 0, `щелчок по «${id}» в «Стилях текста ▾» ничего не сделал`);
        const still = items.filter(c => env.shown(c));
        assert.equal(still.length, items.length, `после «${id}» панель «Стили текста» закрылась: видно ${still.length} из ${items.length}`);
    }
});

H.test('object_properties_button_opens_object_section_via_shell_command', async () => {
    const panelCalls = {};
    for (const kind of ['text', 'shape', 'image', 'table', 'chart', 'line']) {
        const env = await H.mount({kind, width: WIDE});
        const sections = env.load('SlideSections');
        if (typeof sections.install === 'function') sections.install(env.shell);
        await env.flush();
        assert.notEqual(env.registry.objectProperties, env.defaultOwners.objectProperties,
            'SlideSections не регистрирует в каркасе владельца команды objectProperties');
        await env.setKind(kind);
        const btn = env.find('objProps', env.card);
        assert.ok(btn, `${kind}: нет «Свойства объекта»: ${env.rowIds().join(', ')}`);
        const log = await env.capture(() => env.click(btn));
        assert.ok(log.some(e => e.who === 'command' && e.ref === 'objectProperties'), `${kind}: «Свойства объекта» не вызывает команду objectProperties: ${fmt(log)}`);
        assert.deepEqual(acts(log, ['api']), [], `${kind}: «Свойства объекта» правит движок напрямую: ${fmt(acts(log, ['api']))}`);
        const panel = log.filter(e => (e.who === 'stock' || e.who === 'bridge') && /^RightMenu\b/.test(e.ref));
        assert.ok(panel.length > 0, `${kind}: команда не открыла штатную правую панель (RightMenu): ${fmt(log)}`);
        panelCalls[kind] = JSON.stringify(panel.map(e => [e.ref, e.method, e.args]));
    }
    assert.notEqual(panelCalls.image, panelCalls.table, 'для изображения и таблицы правая панель открывается одинаково, а не на разделе объекта');
    assert.notEqual(panelCalls.shape, panelCalls.image, 'для фигуры и изображения правая панель открывается одинаково, а не на разделе объекта');
});

H.test('toolbar_state_mirrors_engine_and_stock_comments_panel', async () => {
    const env = await H.mount({kind: 'text', width: WIDE});
    const font = {get_Name: () => 'Georgia', asc_getName: () => 'Georgia', getName: () => 'Georgia', name: 'Georgia'};
    await env.fire('asc_onFontFamily', font);
    env.nc.trigger('fonts:change', font);
    await env.setTwin('Toolbar:cmbFontName', {value: 'Georgia'});
    await env.fire('asc_onFontSize', 28);
    await env.setTwin('Toolbar:cmbFontSize', {value: 28});
    await env.fire('asc_onZoomChange', 90, 0);
    await env.setTwin('ViewTab:cmbZoom', {value: 90});
    env.zoom = 90;
    await env.fire('asc_onBold', true);
    await env.setTwin('Toolbar:btnBold', {pressed: true});
    await env.fire('asc_onItalic', false);
    await env.setTwin('Toolbar:btnItalic', {pressed: false});
    const text = id => { const el = env.find(id, env.card); return el ? env.text(el) : ''; };
    assert.match(text('font'), /Georgia/, `поле шрифта показывает «${text('font')}», а не шрифт движка`);
    assert.match(text('size'), /\b28\b/, `поле кегля показывает «${text('size')}», а не кегль движка`);
    assert.match(text('zoom'), /\b90\b/, `поле масштаба показывает «${text('zoom')}», а не масштаб движка`);

    const item = id => env.find(id, env.card);
    assert.ok(item('bold') && env.pressed(item('bold')), '«Полужирный» не подсвечен, хотя движок сообщил полужирное начертание');
    assert.ok(item('italic') && !env.pressed(item('italic')), '«Курсив» подсвечен, хотя движок сообщил обычное начертание');
    await env.fire('asc_onBold', false);
    await env.setTwin('Toolbar:btnBold', {pressed: false});
    assert.ok(!env.pressed(item('bold')), '«Полужирный» остался подсвечен после смены начертания в движке');

    const align = env.find('align', env.card);
    const icons = {};
    for (const [name, v] of [['left', 1], ['center', 2], ['right', 0], ['justify', 3]]) {
        await env.fire('asc_onPrAlign', v);
        icons[name] = env.iconNames(align).join(' ');
    }
    assert.equal(new Set(Object.values(icons)).size, 4, `значок «Выравнивание и интервал» не следует выравниванию движка: ${JSON.stringify(icons)}`);
    assert.match(icons.center, /c(enter)?\b|center/i, `значок по центру: «${icons.center}»`);
    assert.match(icons.right, /r(ight)?\b|right/i, `значок по правому краю: «${icons.right}»`);

    await env.setKind('none');
    const layout = env.find('layout', env.card);
    assert.ok(layout, `при пустом выделении нет «Макет ▾»: ${env.rowIds().join(', ')}`);
    const lay = await env.capture(() => env.click(layout));
    assert.ok(lay.some(e => /btnChangeSlide/.test(e.ref)), `«Макет ▾» открывает не штатную галерею макетов btnChangeSlide (текущий макет отмечает она): ${fmt(lay)}`);
    await env.clickOutside();

    const comment = env.find('comment', env.card);
    assert.ok(comment, 'нет «Комментарий»');
    assert.ok(!env.pressed(comment), '«Комментарий» нажат при закрытой панели комментариев');
    await env.setTwin('LeftMenu:btnComments', {pressed: true});
    assert.ok(env.pressed(comment), '«Комментарий» не нажат при открытой штатной панели комментариев');
    await env.setTwin('LeftMenu:btnComments', {pressed: false});
    assert.ok(!env.pressed(comment), '«Комментарий» остался нажат после закрытия штатной панели');
    const log = await env.capture(() => env.click(comment));
    assert.ok(log.some(e => /LeftMenu:btnComments/.test(e.ref)), `«Комментарий» не переключает штатную панель комментариев: ${fmt(log)}`);
    const stock = env.stubs.twin('LeftMenu:btnComments').pressed;
    assert.equal(env.pressed(comment), stock, 'нажатость «Комментария» разошлась со штатной кнопкой панели комментариев');
});

H.test('new_slide_click_adds_slide_layout_stays_next_to_it', async () => {
    const env = await H.mount({kind: 'none', width: WIDE});
    const btn = env.find('newSlide', env.card);
    assert.ok(btn, `нет «Новый слайд»: ${env.rowIds().join(', ')}`);
    assert.match(env.text(btn), /^Новый слайд$/, `видимая подпись кнопки — «${env.text(btn)}», а не «Новый слайд»`);
    assert.equal(btn.getAttribute('title'), 'Новый слайд (Ctrl+M)', `подсказка кнопки — «${btn.getAttribute('title')}»`);
    const log = await env.capture(() => env.click(btn));
    const created = log.filter(e => e.ref === 'Toolbar:btnAddSlide' && e.method === 'click');
    assert.equal(created.length, 1, `щелчок по «Новый слайд» не нажал штатную кнопку добавления слайда один раз: ${fmt(log)}`);
    const gallery = log.filter(e => /btnAddSlide/.test(e.ref) && e.method === 'gallery');
    assert.deepEqual(gallery, [], `щелчок по «Новый слайд» открыл галерею макетов: ${fmt(gallery)}`);
    assert.deepEqual(acts(log, ['api']), [], `«Новый слайд» правит движок напрямую: ${fmt(acts(log, ['api']))}`);
    /* The new slide is selected as a slide: "Layout ▾" stands in the row next to it. */
    const row = env.rowIds();
    assert.ok(row.indexOf('layout') > row.indexOf('newSlide'), `при выделенном слайде нет «Макет ▾» после «Нового слайда»: ${row.join(', ')}`);
    assert.ok(!row.includes('duplicate'), `«Дублировать слайд» остался на панели: ${row.join(', ')}`);
});

H.run();
