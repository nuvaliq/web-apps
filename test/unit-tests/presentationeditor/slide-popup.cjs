/* Run: node test/unit-tests/presentationeditor/slide-popup.cjs [path to SlideSections.js]
 * The presentation right panel is an AIR popup panel over the canvas: there is no right column or section
 * strip, the canvas is full width; the card is the body of the stock panel (#view-right-menu) with
 * rounding and a shadow, without a header: padding 18 on all sides, width 272 (tab body 236), the name
 * for a screen reader is aria-label with the section title, there is no cross. Place: a panel opened by a toolbar
 * button goes under that button, from the menu bar and a right click at the right edge of the canvas
 * under the toolbar; in a window as a whole, the height goes down to the status bar. It is closed by Esc,
 * a press aside (on the canvas too), a repeated button or item; presses in stock menus,
 * palettes, bridge galleries, windows, the menu bar and on section buttons are not aside. Focus goes to
 * the card, Tab cycles inside it, on closing it goes to the calling button, otherwise to the canvas.
 *
 * The environment is the workspace fixture (acceptance/area-harness.cjs): stock PE stubs,
 * the real shell modules, node geometry is getBoundingClientRect stubs. The optional
 * argument is a corrupted copy of the module for a negative control: a copy in which place() does not
 * look at the calling button must fail card_under_its_button_or_at_canvas_edge;
 * a copy in which outside() closes nothing, card_closes_on_escape_press_aside_and_repeat;
 * a copy in which the card does not take focus, card_takes_focus_tab_cycles_and_gives_it_back;
 * a copy without the list fitting, stock_list_fits_into_card.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const h = require('./acceptance/area-harness.cjs');

const FILE = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : null;

function started(opts) {
    const env = h.createEnv(opts);
    if (FILE) {
        vm.runInContext(fs.readFileSync(FILE, 'utf8'), env.context, {filename: FILE});
        env.loaded.SlideSections = true;
    }
    env.start();
    env.SS = env.module('SlideSections');
    env.run = (name, ...a) => { const r = env.shell.command(name)(...a); env.drain(); return r; };
    env.el = sel => env.document.querySelector(sel);
    env.open = () => env.document.body.classList.contains('vo-right-open');
    return env;
}

/* Node rectangle: {left, top, width, height}. */
function rect(el, r) {
    const full = {left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height,
        x: r.left, y: r.top};
    el.getBoundingClientRect = () => full;
    el.getClientRects = () => (r.width || r.height ? [full] : []);
}

/* Window W×H: the toolbar is a card with margins 20, top 80 and height 44, the canvas starts at 132,
   the status bar is 30 from the bottom, the panel card is 260. */
function layout(env, W, H, opts) {
    opts = opts || {};
    env.context.innerWidth = W;
    env.context.innerHeight = H;
    rect(env.el('#vo-toolbar'), opts.noToolbar ? {left: 0, top: 0, width: 0, height: 0} : {left: 20, top: 80, width: W - 40, height: 44});
    rect(env.el('#editor_sdk'), {left: 0, top: 132, width: W, height: H - 162});
    rect(env.el('#vo-status'), {left: 0, top: H - 30, width: W, height: 30});
    rect(env.el('#view-right-menu'), {left: 0, top: 0, width: 260, height: 400});
}

const prop = (env, name) => env.el('#view-right-menu').style.getPropertyValue(name);
const place = env => ({top: prop(env, '--vo-rp-top'), left: prop(env, '--vo-rp-left'), max: prop(env, '--vo-rp-max-h')});

function press(env, el, type) {
    el.dispatchEvent(new (env.context.Event)(type || 'pointerdown', {bubbles: true, button: 0}));
    env.drain();
}

function key(env, el, k, shift) {
    const ev = new (env.context.Event)('keydown', {bubbles: true, key: k, keyCode: k === 'Escape' ? 27 : 9, shiftKey: !!shift});
    el.dispatchEvent(ev);
    env.drain();
    return ev;
}

const keysCalls = env => env.apiCalls.filter(c => c.name === 'asc_enableKeyEvents').map(c => c.args[0]);

h.run([
    {
        /* Styles: a column without width (the canvas is full width), closed it is hidden; the card is fixed on
           the place variables, 260, the shell rounding and shadow, a layer under the menus; there is no strip. */
        name: 'card_over_canvas_without_column_or_strip',
        run() {
            const text = h.lessFile('compact-panel.less');
            const list = h.lessRules(text, 'compact-panel.less');
            const rule = re => list.filter(r => re.test(r.selector));
            const decl = (rs, p) => { for (const r of rs) for (const d of r.decls) if (d.prop === p) return d; return {value: null, important: false}; };
            const col = rule(/^body\.vo-compact\.vo-right-open #right-menu$/);
            assert.ok(decl(col, 'display').value === 'block' && decl(col, 'display').important, 'открытая колонка не показана');
            assert.ok(decl(col, 'width').value === '0' && decl(col, 'width').important, 'колонка берёт место в раскладке');
            const shut = rule(/^body\.vo-compact #right-menu$/);
            assert.ok(decl(shut, 'display').value === 'none' && decl(shut, 'display').important, 'закрытая панель не скрыта');

            const card = rule(/^body\.vo-compact\.vo-right-open #view-right-menu$/);
            const want = {position: 'fixed', top: 'var(--vo-rp-top, 132px)', left: 'var(--vo-rp-left, auto)',
                'max-height': 'var(--vo-rp-max-h, 480px)', width: '@vo-rp-card-w', 'border-radius': '@vo-r-pop',
                'box-shadow': '@vo-shadow', 'z-index': '@vo-rp-z', overflow: 'hidden'};
            for (const [p, v] of Object.entries(want)) assert.equal(decl(card, p).value, v, 'карточка: ' + p);
            const vars = {'@vo-rp-pad': '18px', '@vo-rp-body-w': '236px', '@vo-rp-card-w': '(@vo-rp-body-w + @vo-rp-pad * 2)',
                '@vo-rp-z': '(@vo-z-drop - 2)'};
            for (const [n, v] of Object.entries(vars)) {
                const m = new RegExp('^' + n + ':\\s*([^;]+);', 'm').exec(text);
                assert.equal(m && m[1].trim(), v, n);
            }
            /* There is no header or cross, neither in the rules nor in the nodes. */
            assert.deepEqual(list.filter(r => /vo-rp-head|vo-rp-close|vo-rp-title/.test(r.selector)).map(r => r.selector), [],
                'остались правила шапки карточки');
            /* Padding 18 on all sides: the stock tabs via a stock variable in any theme and right
               to left, the bottom via a rule; its own sections are 18 at the sides, above the first and below the last. */
            const pads = rule(/^body\.vo-compact #right-menu$/);
            assert.equal(decl(pads, '--layout-padding-right-panel-content').value, '@vo-rp-pad @vo-rp-pad 0', 'поле штатной вкладки не 18');
            assert.equal(decl(pads, '--layout-padding-right-panel-content-rtl').value, '@vo-rp-pad @vo-rp-pad 0', 'поле штатной вкладки справа налево не 18');
            assert.equal(decl(rule(/#view-right-menu \.content-box > \.settings-panel:not\(\.vo-rp-pane\):not\(#id-slide-settings\)$/), 'padding-bottom').value,
                '@vo-rp-pad', 'низ штатной вкладки не 18');
            assert.equal(decl(rule(/#right-menu \.vo-rp-pane \.vo-rp-sec$/), 'padding').value, '@vo-rp-sec-y @vo-rp-pad', 'поля секции своего раздела');
            assert.equal(decl(rule(/#right-menu \.vo-rp-pane \.vo-rp-sec:last-child$/), 'padding-bottom').value, '@vo-rp-pad', 'под последней секцией не 18');
            assert.equal(decl(rule(/#right-menu \.vo-rp-pane:not\(\.vo-rp-more\) > \.vo-rp-sec:first-child$/), 'padding-top').value, '@vo-rp-pad',
                'над первой секцией не 18');
            /* The tail row of the tab table (.finish-cell, 15) does not add padding to 18; the theme
               tiles window is from padding 18, not 3 higher. */
            assert.equal(decl(rule(/#view-right-menu \.settings-panel \.finish-cell$/), 'height').value, '0', 'под вкладкой поле стока 15 сверх 18');
            assert.equal(decl(rule(/#view-right-menu #id-slide-settings$/), 'padding-bottom').value, '@vo-rp-sec-y', 'под вкладкой «Слайд» не 12 до раздела макета');
            assert.equal(decl(rule(/\.vo-rp-sec > \.vo-rp-themes:first-child$/), 'margin-top').value, '0', 'окошко тем выше поля 18');
            assert.ok(decl(rule(/#right-menu \.tool-menu-btns$/), 'display').important, 'штатная колонка вкладок видна');
            /* The section strip and the column bottom above the status bar (bottom of #right-menu) are in the past. */
            assert.deepEqual(list.filter(r => /vo-rp-strip|vo-rp-tab\b/.test(r.selector) ||
                (/#right-menu(\s*\+|$)/.test(r.selector) && r.decls.some(d => d.prop === 'bottom'))).map(r => r.selector), [],
                'остались правила колонки или полосы');

            /* An open panel: no strip, header or cross; the card name is the section title. */
            const env = started();
            env.run('slideSection', 'theme');
            assert.equal(env.el('#vo-rp-strip'), null, 'есть полоса разделов');
            assert.equal(env.el('#vo-rp-head'), null, 'у карточки есть шапка');
            assert.equal(env.el('#view-right-menu .vo-rp-close, #view-right-menu [data-vo="close"]'), null, 'у карточки есть крестик');
            assert.equal(env.el('#view-right-menu').getAttribute('aria-label'), 'Тема', 'имя карточки — не название раздела');
            assert.equal(env.el('#view-right-menu').hasAttribute('aria-labelledby'), false, 'карточку называет шапка');
            env.run('slideSection', 'transition');
            assert.equal(env.el('#view-right-menu').getAttribute('aria-label'), 'Переход', 'имя карточки не сменилось с разделом');
            env.SS.close();
            assert.equal(env.el('#view-right-menu').hasAttribute('aria-label'), false, 'у закрытой карточки осталось имя');
        }
    },
    {
        name: 'card_under_its_button_or_at_canvas_edge',
        run() {
            const env = started();
            layout(env, 1440, 900);
            const bg = env.el('#vo-tb [data-vo="bg"]');
            rect(bg, {left: 569, top: 88, width: 64, height: 28});
            /* A toolbar button: under it, left edges flush. */
            bg.click();
            env.drain();
            assert.equal(env.SS.current(), 'slide');
            assert.deepEqual(place(env), {top: '120px', left: '569px', max: '738px'}, 'карточка «Фона» не под кнопкой');
            /* A menu bar item: at the right edge of the canvas (flush with the toolbar) under it. */
            env.runItem(env.findItem('Слайд', 'Переход'));
            assert.equal(env.SS.current(), 'transition');
            assert.deepEqual(place(env), {top: '132px', left: '1160px', max: '726px'}, 'карточка из меню не у правого края');
            /* The right-click item "Slide settings" is at the right edge too. */
            env.SS.close();
            env.dh.menuSlideSettings.options.value = env.selection[0];
            env.dh.menuSlideSettings.click();
            env.drain();
            assert.equal(env.SS.current(), 'slide');
            assert.deepEqual(place(env), {top: '132px', left: '1160px', max: '726px'}, 'карточка правого щелчка не у правого края');
            env.SS.close();
            /* A button at the right edge of the window: the card does not go beyond the window. */
            rect(bg, {left: 1330, top: 88, width: 64, height: 28});
            bg.click();
            env.drain();
            assert.equal(place(env).left, '1172px', 'карточка вышла за правый край окна');
            env.SS.close();
            /* Without a toolbar, at the right edge of the canvas from its top. */
            layout(env, 1440, 900, {noToolbar: true});
            env.runItem(env.findItem('Слайд', 'Переход'));
            assert.deepEqual(place(env), {top: '140px', left: '1160px', max: '718px'}, 'без панели инструментов карточка не у края холста');
            env.SS.close();
            /* A 1280×720 window and a window resize with the card open. */
            layout(env, 1440, 900);
            env.runItem(env.findItem('Слайд', 'Переход'));
            layout(env, 1280, 720);
            env.context.dispatchEvent(new (env.context.Event)('resize'));
            env.drain();
            assert.deepEqual(place(env), {top: '132px', left: '1000px', max: '546px'}, 'карточка не встала на место в 1280×720');
            /* Right to left: at the left edge, and under the button by the right edges. */
            env.SS.close();
            env.context.Common.UI.isRTL = () => true;
            env.runItem(env.findItem('Слайд', 'Переход'));
            assert.equal(place(env).left, '20px', 'справа налево карточка из меню не у левого края');
            env.SS.close();
            rect(bg, {left: 569, top: 88, width: 64, height: 28});
            bg.click();
            env.drain();
            assert.equal(place(env).left, String(569 + 64 - 260) + 'px', 'справа налево карточка не под кнопкой');
        }
    },
    {
        name: 'card_closes_on_escape_press_aside_and_repeat',
        run() {
            const env = started();
            layout(env, 1440, 900);
            const reopen = () => { env.run('slideSection', 'theme'); assert.equal(env.SS.current(), 'theme'); };
            /* Esc is the scaffold's Esc queue, the last layer. */
            reopen();
            key(env, env.document.activeElement || env.document.body, 'Escape');
            assert.equal(env.SS.current(), null, 'Esc не закрыл карточку');
            /* A press on the canvas closes. */
            reopen();
            press(env, env.el('#id_main_view'));
            assert.equal(env.SS.current(), null, 'нажатие по холсту не закрыло карточку');
            /* Not aside: the card itself, a stock menu outside the card, a window, the menu bar, a section button,
               a bridge gallery, a press while a modal window is open. */
            reopen();
            const menu = env.document.createElement('ul');
            menu.className = 'dropdown-menu';
            env.document.body.appendChild(menu);
            const win = env.document.createElement('div');
            win.className = 'asc-window';
            env.document.body.appendChild(win);
            for (const [what, el] of [['карточка', env.el('#vo-rp-theme')], ['штатное меню', menu], ['окно', win],
                ['строка меню', env.el('#vo-menubar')], ['кнопка раздела', env.el('#vo-tb [data-vo-panel]')]]) {
                press(env, el);
                assert.equal(env.SS.current(), 'theme', 'нажатие (' + what + ') закрыло карточку');
            }
            const B = env.module('StockBridge');
            const owns = B.galleryOwns;
            B.galleryOwns = n => n === env.el('#vo-tb');
            press(env, env.el('#vo-tb'));
            assert.equal(env.SS.current(), 'theme', 'нажатие в галерее моста закрыло карточку');
            B.galleryOwns = owns;
            env.context.Common.Utils.ModalWindow = {isVisible: () => true};
            press(env, env.el('#id_main_view'));
            assert.equal(env.SS.current(), 'theme', 'нажатие при модальном окне закрыло карточку');
            env.context.Common.Utils.ModalWindow = {isVisible: () => false};
            /* Repeating a section closes it, another one switches. */
            env.run('slideSection', 'transition');
            assert.equal(env.SS.current(), 'transition', 'другой раздел не переключил карточку');
            env.run('slideSection', 'transition');
            assert.equal(env.SS.current(), null, 'повтор раздела не закрыл карточку');
            /* A closed card has no press listener: a press on the canvas does nothing. */
            const left = (env.document._listeners.pointerdown || []).filter(l => l.capture).length;
            reopen();
            assert.equal((env.document._listeners.pointerdown || []).filter(l => l.capture).length, left + 1, 'у открытой карточки нет слушателя нажатий');
            env.SS.close();
            assert.equal((env.document._listeners.pointerdown || []).filter(l => l.capture).length, left, 'у закрытой карточки остался слушатель нажатий');
        }
    },
    {
        name: 'card_takes_focus_tab_cycles_and_gives_it_back',
        run() {
            const env = started();
            layout(env, 1440, 900);
            const card = env.el('#view-right-menu');
            const theme = env.el('#vo-tb [data-vo="theme"]');
            rect(theme, {left: 700, top: 88, width: 60, height: 28});
            env.apiCalls.length = 0;
            theme.click();
            env.drain();
            assert.equal(env.SS.current(), 'theme');
            assert.ok(env.document.activeElement === card, 'фокус не в карточке');
            assert.equal(keysCalls(env).pop(), false, 'у открытой карточки клавиатура у движка');
            assert.equal(card.getAttribute('role'), 'dialog');
            assert.equal(card.getAttribute('aria-label'), 'Тема');
            assert.equal(card.getAttribute('tabindex'), '-1');

            /* Tab cycles: the visible card controls are the section tiles and fields. */
            const list = Array.from(env.document.querySelectorAll('#vo-rp-theme button, #vo-rp-theme select'));
            list.forEach(el => rect(el, {left: 1000, top: 200, width: 40, height: 20}));
            const last = list[list.length - 1];
            last.focus();
            let ev = key(env, last, 'Tab');
            assert.ok(ev.defaultPrevented && env.document.activeElement === list[0], 'Tab с последнего контрола ушёл из карточки');
            ev = key(env, list[0], 'Tab', true);
            assert.ok(ev.defaultPrevented && env.document.activeElement === last, 'Shift+Tab с первого контрола ушёл из карточки');
            list[0].focus();
            ev = key(env, list[0], 'Tab');
            assert.equal(ev.defaultPrevented, false, 'Tab внутри карточки перехвачен');

            /* Esc: focus goes to the calling button, the keyboard is not given to the engine (the engine would take the focus). */
            env.apiCalls.length = 0;
            last.focus();
            key(env, last, 'Escape');
            assert.equal(env.SS.current(), null);
            assert.ok(env.document.activeElement === theme, 'фокус не вернулся на «Тему»');
            assert.notEqual(keysCalls(env).pop(), true, 'клавиатура отдана движку при фокусе на кнопке');
            assert.ok(!card.hasAttribute('role') && !card.hasAttribute('tabindex'), 'тело панели осталось диалогом');

            /* A menu bar item: Esc gives focus to the canvas via the stock edit:complete. */
            const done = [];
            env.nc.on('edit:complete', () => done.push(1));
            env.runItem(env.findItem('Слайд', 'Переход'));
            assert.ok(env.document.activeElement === card, 'из меню фокус не в карточке');
            env.apiCalls.length = 0;
            key(env, card, 'Escape');
            assert.equal(env.SS.current(), null, 'Esc не закрыл карточку из меню');
            assert.equal(done.length, 1, 'фокус не вернулся холсту');
            assert.equal(keysCalls(env).pop(), true, 'клавиатура не вернулась движку');

            /* A press aside: focus goes where the press was; the keyboard goes to the engine, no edit:complete. */
            env.runItem(env.findItem('Слайд', 'Переход'));
            env.apiCalls.length = 0;
            press(env, env.el('#id_main_view'));
            assert.equal(env.SS.current(), null);
            assert.equal(done.length, 1, 'нажатие мимо увело фокус холсту штатным edit:complete');
            assert.equal(keysCalls(env).pop(), true, 'после нажатия мимо клавиатура не у движка');
        }
    },
    {
        /* "Change layout ▾" in "Slide settings": a click shows the stock layout gallery and
           does not reach the document (there a stock click outside the menu would close it with the same click);
           a repeat closes the gallery, the card stays. */
        name: 'slide_layout_gallery_survives_its_own_click',
        run() {
            const env = started();
            layout(env, 1440, 900);
            env.run('slideSection', 'slide');
            const B = env.module('StockBridge');
            const calls = [];
            let shown = null;
            B.gallery = (ref, anchor, opts) => { calls.push(['gallery', ref]); shown = opts; return true; };
            B.galleryOpen = () => !!shown;
            B.closeGallery = how => { calls.push(['close', how]); const o = shown; shown = null; o && o.onClose && o.onClose(how); return true; };
            const reached = [];
            env.document.addEventListener('click', () => reached.push(1));
            const btn = () => env.el('#vo-rp-slide [data-vo="Toolbar:btnChangeSlide"]');
            btn().click();
            env.drain();
            assert.deepEqual(calls, [['gallery', 'Toolbar:btnChangeSlide']], 'галерея макетов не показана');
            assert.deepEqual(reached, [], 'щелчок дошёл до документа — штатный щелчок мимо меню закроет галерею');
            assert.equal(btn().getAttribute('aria-expanded'), 'true');
            btn().click();
            env.drain();
            assert.deepEqual(calls[1], ['close', 'toggle'], 'повтор не закрыл галерею');
            assert.equal(btn().getAttribute('aria-expanded'), 'false');
            assert.equal(env.SS.current(), 'slide', 'галерея закрыла карточку');
        }
    },
    {
        /* The stock tab drop-down list (ComboBox) is not clipped by the card bottom: the body
           is scrolled to it; without scrolling it opens upward if it fits above the field,
           otherwise it gets a height ceiling; a closed list removes the fitting. */
        name: 'stock_list_fits_into_card',
        run() {
            const env = started();
            layout(env, 1440, 900);
            env.select('shape');
            env.run('objectProperties');
            const pane = env.el('#id-shape-settings');
            const body = env.el('#view-right-menu .right-panel > .content-box');
            rect(body, {left: 1160, top: 173, width: 260, height: 648});
            const holder = env.document.createElement('div');
            holder.className = 'input-group combobox';
            const menu = env.document.createElement('ul');
            menu.className = 'dropdown-menu';
            holder.appendChild(menu);
            pane.appendChild(holder);
            const scroll = (sh, top) => {
                Object.defineProperty(body, 'scrollHeight', {value: sh, configurable: true});
                Object.defineProperty(body, 'clientHeight', {value: 648, configurable: true});
                body.scrollTop = top;
            };
            const $ = env.context.jQuery;
            const show = () => { $(holder).trigger('shown.bs.dropdown'); env.drain(); };
            const hide = () => { $(holder).trigger('hide.bs.dropdown'); env.drain(); };

            /* Scrolling is enough: the body is scrolled past the limit (bottom 932 at a limit of 817). */
            rect(holder, {left: 1172, top: 600, width: 160, height: 32});
            rect(menu, {left: 1172, top: 632, width: 160, height: 300});
            scroll(804, 0);
            show();
            assert.equal(body.scrollTop, 115, 'тело не прокручено к списку');
            assert.ok(!menu.classList.contains('show-top') && !menu.style.maxHeight, 'список подогнан сверх прокрутки');
            hide();

            /* No scrolling, there is enough room above the field: upward. */
            scroll(648, 0);
            show();
            assert.ok(menu.classList.contains('show-top'), 'список не открылся вверх');
            hide();
            assert.ok(!menu.classList.contains('show-top') && !menu.hasAttribute('data-vo-fit'), 'закрытый список остался открытым вверх');

            /* Little room above the field: a height ceiling by the free space. */
            rect(holder, {left: 1172, top: 250, width: 160, height: 32});
            show();
            assert.equal(menu.style.maxHeight, '185px', 'у списка нет потолка высоты');
            assert.equal(menu.style.overflowY, 'auto');
            hide();
            assert.equal(menu.style.maxHeight, '', 'закрытый список сохранил потолок высоты');

            /* It fits: nothing changes; a closed card has no fitting. */
            rect(menu, {left: 1172, top: 282, width: 160, height: 200});
            show();
            assert.ok(!menu.hasAttribute('data-vo-fit') && body.scrollTop === 0, 'поместившийся список подогнан');
            env.SS.close();
            rect(menu, {left: 1172, top: 632, width: 160, height: 300});
            show();
            assert.ok(!menu.hasAttribute('data-vo-fit'), 'закрытая карточка подгоняет списки');
        }
    },
    {
        /* "Animation" on the toolbar is in the object group after "Object properties": visible
           only with an object selected, opens the "Animation" section under itself, a repeat closes. */
        name: 'animation_button_with_object_opens_section_under_it',
        run() {
            const env = started();
            layout(env, 1440, 900);
            const btn = () => env.el('#vo-tb [data-vo="animation"]');
            const shown = () => !!btn() && !btn().closest('[hidden]');
            assert.ok(btn(), 'на панели нет кнопки «Анимация»');
            const group = btn().closest('.vo-g');
            assert.equal(group && group.getAttribute('data-group'), 'props', '«Анимация» не в группе объекта');
            const keys = Array.from(group.querySelectorAll('[data-vo]')).map(b => b.getAttribute('data-vo'));
            assert.deepEqual(keys, ['objProps', 'animation'], 'порядок группы объекта: ' + keys.join(','));
            assert.equal(btn().getAttribute('data-vo-panel'), 'slideSection', 'кнопка не помечена командой раздела');
            env.select('none');
            assert.equal(shown(), false, 'без выделения «Анимация» на панели');
            env.typing = true;
            env.select('text');
            assert.equal(shown(), false, 'курсор в тексте — «Анимация» на панели');
            env.typing = false;
            for (const kind of ['shape', 'image', 'table', 'chart', 'text']) {
                env.select(kind);
                assert.equal(shown(), true, kind + ': нет «Анимации» на панели');
            }
            env.select('shape');
            rect(btn(), {left: 900, top: 88, width: 32, height: 28});
            btn().click();
            env.drain();
            assert.equal(env.SS.current(), 'animation', '«Анимация» не открыла раздел');
            assert.deepEqual(place(env), {top: '120px', left: '900px', max: '738px'}, 'карточка не под «Анимацией»');
            assert.equal(env.el('#view-right-menu').getAttribute('aria-label'), 'Анимация');
            btn().click();
            env.drain();
            assert.equal(env.SS.current(), null, 'повтор «Анимации» не закрыл карточку');
        }
    },
    {
        /* Without the edit right there is no card: commands do not open it, there is no name or listeners. */
        name: 'no_card_without_edit_right',
        run() {
            const env = started({options: {isEdit: false}});
            const before = (env.document._listeners.pointerdown || []).length;
            for (const name of ['slide', 'theme', 'transition', 'animation']) env.run('slideSection', name);
            env.run('objectProperties');
            assert.equal(env.SS.current(), null);
            assert.equal(env.open(), false, 'без права правки карточка видна');
            assert.equal(env.el('#view-right-menu').hasAttribute('aria-label'), false, 'без права правки у панели есть имя карточки');
            assert.equal((env.document._listeners.pointerdown || []).length, before, 'без права правки стоит слушатель нажатий');
        }
    }
]);
