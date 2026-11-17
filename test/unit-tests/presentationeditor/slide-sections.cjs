/* Run: node test/unit-tests/presentationeditor/slide-sections.cjs [path to SlideSections.js]
 * The presentation shell right panel (a popup panel over the canvas): commands and
 * section behavior: "Object properties" opens the object section (without an object, "Slide
 * settings"), a repeat closes; without the edit right there is no panel; on vo:mode the sections reread
 * the unavailability reason (CompactModes.reason), on editing:disable the stock editing ban:
 * an unavailable section does not open, an open panel closes; the "Transitions" fields write
 * the value to the stock control, and its 'change' reaches the tab handler; "Apply to
 * all" and "Preview" are stock buttons; the stock panel switches the tab itself on selection,
 * while an open own section stays; the "Stock interface" closes the panel.
 *
 * The environment is the workspace fixture (acceptance/area-harness.cjs): stock PE stubs with
 * spies on handlers, the real shell modules, starting the scaffold the stock way.
 * The optional argument is a corrupted copy of the module for a negative control: a copy without
 * the RightMenu.onFocusObject override must fail own_section_survives_stock_focus, a copy
 * in which objectProperties does not close the panel, object_properties_opens_object_or_slide_and_toggles.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const h = require('./acceptance/area-harness.cjs');

const FILE = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : null;

/* An environment with its own copy of the module: it is loaded before the scaffold and replaces the tree file. */
function makeEnv(opts) {
    const env = h.createEnv(opts);
    if (FILE) {
        vm.runInContext(fs.readFileSync(FILE, 'utf8'), env.context, {filename: FILE});
        env.loaded.SlideSections = true;
    }
    return env;
}

function started(opts) {
    const env = makeEnv(opts);
    env.start();
    env.SS = env.module('SlideSections');
    env.cmd = name => env.shell.command(name);
    env.run = (name, ...a) => { const r = env.cmd(name)(...a); env.drain(); return r; };
    env.el = sel => env.document.querySelector(sel);
    env.all = sel => env.document.querySelectorAll(sel);
    return env;
}

function fire(el, type) {
    el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(type, {bubbles: true}));
}

/* The last stock tab that the panel showed. */
const lastPane = env => env.lastPane();

/* Engine calls bypassing the stock code, except the engine keyboard switch
   (asc_enableKeyEvents): focus into the card and back is not a presentation edit. */
const ownEdits = env => env.ownApi(/^(?!asc_enableKeyEvents$)./).map(c => c.name);

/* The open card name (there is no header): the section title for a screen reader. */
const head = env => {
    const el = env.el('#view-right-menu');
    return el && el.hasAttribute('aria-label') ? el.getAttribute('aria-label') : null;
};

h.run([
    {
        name: 'object_properties_opens_object_or_slide_and_toggles',
        run() {
            const env = started();
            assert.equal(env.shell.hasCommand('objectProperties'), true, 'objectProperties без владельца');
            env.select('none');
            env.run('objectProperties');
            assert.equal(env.SS.current(), 'slide', 'без объекта открыт не раздел «Параметры слайда»');
            assert.equal(lastPane(env), 'Slide', 'без объекта показана не штатная вкладка «Слайд»');
            assert.ok(env.document.body.classList.contains('vo-right-open'), 'панель не показана (vo-right-open)');
            assert.equal(env.SS.isOpen(), true);
            env.run('objectProperties');
            assert.equal(env.SS.current(), null, 'повтор не закрыл панель');
            assert.ok(!env.document.body.classList.contains('vo-right-open'), 'закрытая панель видна');

            const want = {shape: 'Shape', image: 'Image', table: 'Table', text: 'Shape', line: 'Shape'};
            for (const [kind, pane] of Object.entries(want)) {
                env.select(kind);
                env.panes.length = 0;
                env.stockCalls.length = 0;
                env.run('objectProperties');
                assert.equal(env.SS.current(), 'object', kind + ': открыт не раздел объекта');
                assert.equal(lastPane(env), pane, kind + ': показана вкладка ' + lastPane(env) + ', а не ' + pane);
                assert.equal(env.count('RightMenu.' + pane.toLowerCase() + 'Settings.ChangeSettings'), 1,
                    kind + ': вкладка ' + pane + ' не получила свойства объекта');
                env.run('objectProperties');
                assert.equal(env.SS.current(), null, kind + ': повтор не закрыл панель');
            }

            /* Another section is open: "Object properties" switches to the object rather than closing. */
            env.select('image');
            env.run('slideSection', 'theme');
            assert.equal(env.SS.current(), 'theme');
            env.run('objectProperties');
            assert.equal(env.SS.current(), 'object', 'из «Темы» «Свойства объекта» не перешли на раздел объекта');
            assert.deepEqual(ownEdits(env), [], 'оболочка сама зовёт движок');
        }
    },
    {
        name: 'no_panel_without_edit_right',
        run() {
            const env = started({options: {isEdit: false}});
            env.select('shape');
            env.stockCalls.length = 0;
            env.panes.length = 0;
            for (const name of ['slide', 'theme', 'transition', 'animation', 'object']) env.run('slideSection', name);
            env.run('objectProperties');
            assert.equal(env.SS.current(), null, 'без права правки раздел открылся');
            assert.deepEqual(Array.from(env.SS.sections()), [], 'без права правки у панели есть разделы');
            assert.equal(env.el('#vo-rp-strip'), null, 'без права правки есть полоса разделов');
            assert.equal(head(env), null, 'без права правки у панели есть имя карточки');
            assert.ok(!env.document.body.classList.contains('vo-right-open'), 'без права правки панель видна');
            assert.deepEqual(env.panes, [], 'без права правки штатная панель развёрнута');
            assert.equal(env.count('RightMenu.SetActivePane'), 0);

            /* The right is revoked on the fly: an open panel closes, there is no strip. */
            const rw = started();
            rw.run('slideSection', 'theme');
            assert.equal(rw.SS.current(), 'theme');
            rw.nc.trigger('collaboration:sharingdeny');
            rw.drain();
            assert.equal(rw.SS.current(), null, 'после отзыва права панель открыта');
            assert.ok(!rw.document.body.classList.contains('vo-right-open'), 'после отзыва права панель видна');
            assert.equal(head(rw), null, 'после отзыва права осталось имя карточки');
        }
    },
    {
        name: 'sections_reread_reason_on_vo_mode',
        run() {
            const env = started();
            const modes = env.module('CompactModes');
            const asked = [];
            modes.reason = it => { asked.push(it); return it && it.section ? 'Недоступно в режиме просмотра' : null; };
            env.run('slideSection', 'transition');
            assert.equal(env.SS.current(), 'transition', 'причина применена до vo:mode');
            env.nc.trigger('vo:mode', {mode: 'view'});
            env.drain();
            /* The menu bar also recomputes itself on vo:mode: here — only the section queries. */
            const bySections = asked.filter(it => it && it.section);
            assert.ok(bySections.some(it => it.section === 'theme') && bySections.every(it => it.edit === true),
                'на vo:mode разделы не спросили CompactModes.reason');
            assert.equal(env.SS.reasons.theme, 'Недоступно в режиме просмотра', 'раздел не запомнил причину');
            assert.equal(env.SS.current(), null, 'в «Просмотре» всплывающая панель осталась открытой');
            assert.ok(!env.document.body.classList.contains('vo-right-open'), 'в «Просмотре» панель видна');
            for (const name of ['slide', 'theme', 'transition', 'animation']) {
                env.run('slideSection', name);
                assert.equal(env.SS.current(), null, 'в «Просмотре» открылся раздел ' + name);
            }
            env.select('shape');
            env.run('objectProperties');
            assert.equal(env.SS.current(), null, 'в «Просмотре» открылся раздел объекта');

            modes.reason = () => null;
            env.nc.trigger('vo:mode', {mode: 'edit'});
            env.drain();
            env.run('slideSection', 'transition');
            assert.equal(env.SS.current(), 'transition', 'после снятия причины раздел не открылся');
            assert.ok(!env.el('#vo-rp-transition [data-vo="Transitions:btnApplyToAll"]').disabled, 'после снятия причины поля погашены');
        }
    },
    {
        /* Version history and connection loss: stock grays its right panel (rightMenu.disable); the sections
           are locked together with it, without a reason: an open panel closes, a section does not open;
           they are unlocked together with the ban (editing:disable). */
        name: 'sections_locked_under_stock_lock',
        run() {
            const env = started();
            let lock = {on: false, options: {}};
            env.shell.lockState = () => lock;
            const stockLock = (on, options) => {
                lock = on ? {on: true, options} : {on: false, options: {}};
                env.nc.trigger('editing:disable', on, options, 'disconnect');
                env.drain();
            };
            env.run('slideSection', 'transition');
            assert.equal(env.SS.current(), 'transition', 'раздел заперт без запрета');

            stockLock(true, {viewMode: true, toolbar: true, rightMenu: {clear: true, disable: true}});
            assert.equal(env.SS.current(), null, 'под штатным запретом панель осталась открытой');
            assert.ok(env.SS.sectionOff('theme') && !env.SS.reasons.theme, 'раздел не заперт или заперт с причиной');
            env.run('slideSection', 'theme');
            assert.equal(env.SS.current(), null, 'под штатным запретом открылся раздел');

            stockLock(false, {viewMode: false, toolbar: true, rightMenu: {clear: true, disable: true}});
            env.run('slideSection', 'transition');
            assert.equal(env.SS.current(), 'transition', 'после снятия запрета раздел не открылся');
            assert.ok(!env.el('#vo-rp-transition [data-vo="Transitions:btnApplyToAll"]').disabled, 'после снятия запрета поля погашены');

            /* A ban without rightMenu.disable in it does not lock the sections. */
            stockLock(true, {viewMode: true, toolbar: true});
            assert.equal(env.SS.current(), 'transition', 'запрет без правой панели закрыл раздел');
            assert.equal(env.SS.sectionOff('theme'), false, 'разделы заперты запретом без правой панели');
        }
    },
    {
        name: 'transition_change_reaches_controller',
        run() {
            const env = started();
            const t = env.transitions, got = [];
            /* Subscriptions of the stock "Transitions" view (view/Transitions.js): 'change' of the controls → a tab event. */
            t.numDuration.on('change', () => got.push(['transit:duration', t.numDuration.getValue()]));
            t.numDelay.on('change', () => got.push(['transit:delay', t.numDelay.getValue()]));
            t.chStartOnClick.on('change', () => got.push(['transit:startonclick', t.chStartOnClick.getValue()]));
            t.chDelay.on('change', () => got.push(['transit:checkdelay', t.chDelay.getValue()]));
            env.run('slideSection', 'transition');
            assert.equal(env.SS.current(), 'transition');

            const dur = env.el('#vo-rp-transition [data-vo="Transitions:numDuration"]');
            assert.ok(dur, 'нет поля длительности');
            assert.equal(dur.value, '2', 'поле длительности не показывает значение штатного контрола');
            dur.value = '3.5';
            fire(dur, 'change');
            env.drain();
            assert.deepEqual(got.shift(), ['transit:duration', 3.5], 'длительность не дошла до обработчика вкладки');

            const click = env.el('#vo-rp-transition [data-vo="Transitions:chStartOnClick"]');
            assert.equal(click.checked, true, 'флажок не показывает штатное значение');
            click.checked = false;
            fire(click, 'change');
            env.drain();
            assert.deepEqual(got.shift(), ['transit:startonclick', false], '«Запускать щелчком» не дошёл до обработчика вкладки');

            const delayOn = env.el('#vo-rp-transition [data-vo="Transitions:chDelay"]');
            delayOn.checked = true;
            fire(delayOn, 'change');
            env.drain();
            assert.deepEqual(got.shift(), ['transit:checkdelay', true], '«Задержка» не дошла до обработчика вкладки');
            const delay = env.el('#vo-rp-transition [data-vo="Transitions:numDelay"]');
            delay.value = '1';
            fire(delay, 'change');
            env.drain();
            assert.deepEqual(got.shift(), ['transit:delay', 1], 'задержка не дошла до обработчика вкладки');

            /* A disabled stock control: the value is not written. */
            t.numDuration.setDisabled(true);
            const before = got.length;
            const dur2 = env.el('#vo-rp-transition [data-vo="Transitions:numDuration"]');
            dur2.value = '9';
            fire(dur2, 'change');
            env.drain();
            assert.equal(got.length, before, 'значение ушло в погашенный штатный контрол');

            /* An effect is a tile of the stock gallery: choosing it is its stock 'click' with a write. */
            const picked = [];
            t.listEffects.on('click', (c, r) => picked.push(r.get('value')));
            const tiles = env.all('#vo-rp-transition .vo-rp-tile');
            assert.equal(tiles.length, 3, 'плиток не столько, сколько записей штатной галереи');
            tiles[1].click();
            env.drain();
            assert.deepEqual(picked, [1], 'плитка эффекта не прошла штатным щелчком галереи');
            assert.deepEqual(ownEdits(env), [], 'оболочка сама зовёт движок');
        }
    },
    {
        name: 'transition_apply_all_and_preview_stock',
        run() {
            const env = started();
            const t = env.transitions, got = [];
            t.btnApplyToAll.on('click', () => got.push('transit:applytoall'));
            t.btnPreview.on('click', () => got.push('transit:preview'));
            env.run('slideSection', 'transition');
            env.el('#vo-rp-transition [data-vo="Transitions:btnApplyToAll"]').click();
            env.drain();
            env.el('#vo-rp-transition [data-vo="Transitions:btnPreview"]').click();
            env.drain();
            assert.deepEqual(got, ['transit:applytoall', 'transit:preview'], 'кнопки раздела не прошли штатными кнопками вкладки');

            /* "Options" is a snapshot of the stock menu; choosing is a stock menu item. */
            ['Слева', 'Справа'].forEach((caption, i) => t.btnParameters.menu.addItem({
                caption, options: {caption, value: i}, value: i, checked: i === 0, checkable: true, visible: true,
                isDisabled: () => false, isChecked() { return this.checked; },
                onItemClick() { got.push('transit:parameters ' + i); }
            }));
            env.SS.refresh();
            const params = env.el('#vo-rp-transition select[data-vo="Transitions:btnParameters"]');
            assert.ok(params, 'нет списка параметров эффекта');
            const opts = params.querySelectorAll('option').map(o => o.textContent);
            assert.deepEqual(opts, ['Слева', 'Справа'], 'список параметров — не пункты штатного меню');
            params.value = '1';
            fire(params, 'change');
            env.drain();
            assert.equal(got[got.length - 1], 'transit:parameters 1', 'параметр не выбран штатным пунктом меню');

            t.btnPreview.setDisabled(true);
            env.SS.refresh();
            const prev = env.el('#vo-rp-transition [data-vo="Transitions:btnPreview"]');
            assert.ok(prev.disabled, 'погашенная штатная кнопка доступна в разделе');
            const was = got.length;
            prev.click();
            env.drain();
            assert.equal(got.length, was, 'погашенная кнопка сработала');
        }
    },
    {
        name: 'own_section_survives_stock_focus',
        run() {
            const env = makeEnv();
            /* The stock panel picks the tab itself on selection (controller/RightMenu.js
               onFocusObject → SetActivePane, the tab in the DOM is the active class). */
            const stock = env.rightCtl.onFocusObject;
            env.rightCtl.onFocusObject = function (sel) {
                const r = stock.apply(this, arguments);
                const T = env.SELECT;
                const type = (sel || []).some(e => e.get_ObjectType() === T.Image) ? env.PANE.Image
                    : (sel || []).some(e => e.get_ObjectType() === T.Shape) ? env.PANE.Shape : env.PANE.Slide;
                env.rm.SetActivePane(type);
                const id = {[env.PANE.Image]: 'id-image-settings', [env.PANE.Shape]: 'id-shape-settings', [env.PANE.Slide]: 'id-slide-settings'}[type];
                env.document.querySelectorAll('#right-menu .settings-panel').forEach(p => p.classList.toggle('active', p.id === id));
                return r;
            };
            env.start();
            env.SS = env.module('SlideSections');
            const run = (name, ...a) => { env.shell.command(name)(...a); env.drain(); };
            const active = () => env.document.querySelectorAll('#right-menu .settings-panel.active').map(p => p.id);

            run('slideSection', 'theme');
            assert.deepEqual(active(), ['vo-rp-theme']);
            env.select('shape');
            assert.equal(env.SS.current(), 'theme', 'выделение закрыло раздел «Тема»');
            assert.deepEqual(active(), ['vo-rp-theme'], 'после выделения видна не «Тема»: ' + active().join(','));
            /* A stock recalculation without an engine event (Main._onChangeObjectLock, SetDisabled):
               there is no vo:selection, the onFocusObject override returns the section. */
            env.rightCtl.onFocusObject(env.selection);
            env.drain();
            assert.deepEqual(active(), ['vo-rp-theme'], 'штатный пересчёт панели увёл с «Темы»: ' + active().join(','));

            /* Object section: stock picked "Shape", while for an image it is the image tab. */
            run('objectProperties');
            env.panes.length = 0;
            env.select('image');
            assert.equal(env.SS.current(), 'object');
            assert.equal(env.lastPane(), 'Image', 'раздел объекта не на вкладке изображения');

            /* A closed panel does not interfere with the stock choice. */
            run('objectProperties');
            env.select('shape');
            assert.deepEqual(active(), ['id-shape-settings'], 'закрытая панель вмешалась в штатный выбор вкладки');
        }
    },
    {
        name: 'open_section_rebuilt_once_per_selection',
        run() {
            const env = started();
            const counts = {pane: 0, head: 0, apply: 0};
            for (const [key, name] of [['pane', 'renderPane'], ['head', 'renderLabel'], ['apply', 'apply']]) {
                const orig = env.SS[name];
                env.SS[name] = function () { counts[key]++; return orig.apply(this, arguments); };
            }
            const reset = () => { counts.pane = 0; counts.head = 0; counts.apply = 0; };
            env.run('slideSection', 'theme');
            for (const kind of ['shape', 'image', 'none']) {
                reset();
                env.select(kind);
                assert.equal(env.SS.current(), 'theme', kind + ': выделение закрыло «Тему»');
                assert.equal(counts.apply, 1, kind + ': раздел показан ' + counts.apply + ' раз на одно выделение');
                assert.equal(counts.pane, 1, kind + ': «Тема» перестроена ' + counts.pane + ' раз на одно выделение');
                assert.equal(counts.head, 1, kind + ': имя карточки перестроено ' + counts.head + ' раз на одно выделение');
            }
            /* The object section is visible by the new selection, not by the previous one. */
            env.select('shape');
            env.run('objectProperties');
            env.panes.length = 0;
            env.select('image');
            assert.equal(env.SS.current(), 'object');
            assert.deepEqual(env.panes.filter(p => p.type !== env.PANE.Image), [], 'раздел объекта прошёл через вкладку прошлого выделения: ' + JSON.stringify(env.panes));
            assert.equal(env.lastPane(), 'Image', 'раздел объекта не на вкладке изображения');
            /* A stock recalculation without an engine event is also one step. */
            reset();
            env.rightCtl.onFocusObject(env.selection);
            env.drain();
            assert.equal(counts.apply, 1, 'штатный пересчёт панели показал раздел ' + counts.apply + ' раз');
        }
    },
    {
        /* The Text Art tab is available for any shape with text; the stock panel opens it by
           its priority, after inserting Text Art from the gallery (onInsertTextArt). The object
           section does the same: a cursor in a new Text Art gives Text Art, not "Paragraph". */
        name: 'text_art_pane_by_stock_priority',
        run() {
            const env = started();
            const open = () => {
                if (env.SS.current() !== null) env.run('objectProperties');
                env.panes.length = 0;
                env.stockCalls.length = 0;
                env.run('objectProperties');
                assert.equal(env.SS.current(), 'object', 'открыт не раздел объекта');
                return lastPane(env);
            };

            /* Without a priority, its own order by selection kind. */
            env.typing = true;
            env.select('textart');
            assert.equal(env.SS.kind(), 'typing', 'курсор в тексте — не typing');
            assert.equal(open(), 'Paragraph', 'курсор в тексте фигуры без приоритета Text Art: не «Абзац»');

            /* Inserting Text Art: the stock priority belongs to the Text Art tab. */
            env.rightCtl.onInsertTextArt();
            env.select('textart');
            assert.equal(open(), 'TextArt', 'курсор в новом Text Art: показана вкладка ' + lastPane(env) + ', а не Text Art');
            assert.equal(env.count('RightMenu.textartSettings.ChangeSettings'), 1, 'вкладка Text Art не получила свойства фигуры');
            assert.equal(head(env), env.PE.Views.RightMenu.prototype.txtTextArtSettings,
                'имя карточки раздела объекта — не подсказка вкладки Text Art');

            /* The whole shape is selected: Text Art too. */
            env.typing = false;
            env.select('textart');
            assert.equal(open(), 'TextArt', 'выделенный Text Art: показана вкладка ' + lastPane(env));

            /* An open section moves to Text Art on selection, like the stock panel. */
            env.select('text');
            assert.equal(lastPane(env), 'Shape', 'надпись без свойств Text Art: не «Фигура»');
            env.panes.length = 0;
            env.select('textart');
            assert.equal(env.SS.current(), 'object');
            assert.equal(lastPane(env), 'TextArt', 'открытый раздел объекта не перешёл на Text Art');

            /* Inserting a shape after Text Art: "Shape" is first in the priority, Text Art is no longer
               chosen, a cursor in text is "Paragraph" again by its own order. */
            env.rightCtl.onInsertShape();
            env.typing = true;
            env.select('textart');
            assert.equal(open(), 'Paragraph', 'приоритет «Фигуры» после Text Art: курсор в тексте не на «Абзаце»');
            env.typing = false;
            env.select('textart');
            assert.equal(open(), 'Shape', 'приоритет «Фигуры» после Text Art: выделенная фигура не на «Фигуре»');

            /* A chart and a picture do not get the Text Art tab even with its priority. */
            env.rightCtl.onInsertTextArt();
            for (const [kind, pane] of [['image', 'Image'], ['chart', 'Shape'], ['table', 'Table']]) {
                env.select(kind);
                assert.equal(open(), pane, kind + ': показана вкладка ' + lastPane(env));
            }
        }
    },
    {
        /* The "Stock interface" closes the popup panel: the stock panel stays
           expanded (it is a stock column), there is no card name or flags on its body,
           the selection does not build a card there. Returning: the panel is closed and opens again. */
        name: 'card_closes_in_standard_interface',
        run() {
            const env = started();
            env.run('slideSection', 'theme');
            assert.equal(head(env), 'Тема');
            env.stockCalls.length = 0;
            const cleared = [];
            env.rm.clearSelection = () => cleared.push(1);
            env.run('stockInterface');
            assert.equal(env.shell.advanced, true, '«Штатный интерфейс» не включился');
            assert.equal(env.SS.current(), null, 'в «Штатном интерфейсе» всплывающая панель открыта');
            assert.ok(!env.document.body.classList.contains('vo-right-open'), 'в «Штатном интерфейсе» осталась vo-right-open');
            assert.deepEqual(cleared, [], 'уход в «Штатный интерфейс» свернул штатную панель');
            assert.equal(head(env), null, 'в «Штатном интерфейсе» у тела панели имя карточки');
            const card = env.el('#view-right-menu');
            assert.ok(!card.hasAttribute('role') && !card.hasAttribute('tabindex'), 'тело штатной панели осталось диалогом карточки');
            for (const kind of ['shape', 'none', 'image']) env.select(kind);
            assert.equal(env.SS.current(), null, 'выделение в «Штатном интерфейсе» открыло панель');
            assert.equal(env.el('#vo-rp-strip'), null, 'в «Штатном интерфейсе» появилась полоса разделов');

            env.run('stockInterface');
            assert.equal(env.shell.advanced, false);
            assert.equal(env.SS.current(), null, 'после возврата всплывающая панель открыта');
            env.run('slideSection', 'transition');
            assert.equal(env.SS.current(), 'transition', 'после возврата раздел не открылся');
            assert.equal(head(env), 'Переход');
        }
    }
]);
