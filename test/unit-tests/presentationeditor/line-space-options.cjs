/* Run: node test/unit-tests/presentationeditor/line-space-options.cjs
 * The compact line spacing options item opens the paragraph card.
 * Clicks and numeric presets use the real onLineSpaceClick and onLineSpaceToggle
 * (controller/Toolbar.js), evaluated in the fixture context without reimplementing
 * their logic. The fixture does not provide RightMenu.onRightMenuOpen, and replace
 * in SlideSections.bind skips missing methods. Install the observed original
 * method on env.rightCtl before env.start().
 *
 * The original method reproduces the stock early return (controller/RightMenu.js,
 * onRightMenuOpen): a missing entry, hidden, disabled or already active tab does
 * not call SetActivePane. This return belongs to the original method; the wrapper
 * does not copy it.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const h = require('./acceptance/area-harness.cjs');

const TOOLBAR = path.join(h.APP, 'app/controller/Toolbar.js');
const HOLDER = path.join(h.APP, 'app/controller/DocumentHolder.js');
const PRESETS = [1.0, 1.15, 1.5, 2.0, 2.5, 3.0];

/* Extract the fragment from start through its matching brace, including start. */
function balanced(src, start) {
    const open = src.indexOf('{', start);
    if (open < 0) throw new Error('нет скобки после ' + start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('незакрытая скобка');
}

function readMethod(src, name) {
    const m = new RegExp('\\b' + name + '\\s*:\\s*function\\s*\\(').exec(src);
    if (!m) throw new Error(name + ' не найден в Toolbar.js');
    return balanced(src, src.indexOf('function', m.index));
}

function lineSpaceWiring(src) {
    const lines = src.split('\n').filter(line => /btnLineSpace\.menu\.on\(/.test(line));
    if (lines.length !== 2) throw new Error('привязок btnLineSpace.menu ' + lines.length + ', нужны две');
    return lines.join('\n');
}

function lineruleDecl(src) {
    const at = src.indexOf('var c_paragraphLinerule =');
    if (at < 0) throw new Error('c_paragraphLinerule не найден в DocumentHolder.js');
    return balanced(src, at) + ';';
}

function emitter() {
    const ev = {};
    return {
        on(name, fn) { (ev[name] = ev[name] || []).push(fn); return this; },
        trigger(name, ...args) {
            (ev[name] || []).slice().forEach(fn => fn.apply(this, args));
            return this;
        }
    };
}

/* The stock early return belongs to onRightMenuOpen, not the wrapper. */
function stockEarly(ctl, type) {
    const entry = ctl._settings ? ctl._settings[type] : undefined;
    if (entry === undefined) return true;
    const view = ctl.rightmenu;
    const activePane = view && typeof view.GetActivePane === 'function' ? view.GetActivePane() : undefined;
    return !!entry.hidden || entry.btn.isDisabled() || entry.panelId === activePane;
}

function started() {
    const env = h.createEnv();
    const menuOpens = [];
    function onRightMenuOpen(type) {
        const early = stockEarly(this, type);
        const result = {early, type};
        menuOpens.push({self: this, args: Array.from(arguments), result});
        if (!early && this.rightmenu && typeof this.rightmenu.SetActivePane === 'function') {
            this.rightmenu.SetActivePane(type, true);
        }
        return result;
    }
    env.rightCtl.onRightMenuOpen = onRightMenuOpen;
    env.originalOpen = onRightMenuOpen;
    env.menuOpens = menuOpens;

    const SS = env.module('SlideSections');
    const realOpen = SS.openParagraph;
    const paragraphOpens = [];
    SS.openParagraph = function () {
        const result = realOpen.apply(this, arguments);
        paragraphOpens.push(result);
        return result;
    };
    env.paragraphOpens = paragraphOpens;

    const toolbarSrc = fs.readFileSync(TOOLBAR, 'utf8');
    const holderSrc = fs.readFileSync(HOLDER, 'utf8');
    vm.runInContext(lineruleDecl(holderSrc), env.context, {filename: HOLDER});
    vm.runInContext(
        'this.__onLineSpaceClick = ' + readMethod(toolbarSrc, 'onLineSpaceClick') + ';\n' +
        'this.__onLineSpaceToggle = ' + readMethod(toolbarSrc, 'onLineSpaceToggle') + ';',
        env.context,
        {filename: TOOLBAR}
    );
    env.toolbarCtl.onLineSpaceClick = env.context.__onLineSpaceClick;
    env.toolbarCtl.onLineSpaceToggle = env.context.__onLineSpaceToggle;
    env.toolbarCtl._state = {linespace: undefined};
    env.toolbarCtl.application = env.PE.getApplication();
    env.toolbarCtl.getApplication = function () { return this.application; };
    env.lineMenu = emitter();
    env.context.__lineMenu = env.lineMenu;
    env.context.__lineToolbar = env.toolbarCtl;
    vm.runInContext(
        '(function () {\n var toolbar = {btnLineSpace: {menu: __lineMenu}};\n' +
        lineSpaceWiring(toolbarSrc) +
        '\n}).call(__lineToolbar);',
        env.context,
        {filename: TOOLBAR}
    );
    env.lineRule = env.context.c_paragraphLinerule && env.context.c_paragraphLinerule.LINERULE_AUTO;
    if (env.lineRule !== 1) throw new Error('LINERULE_AUTO стока не загрузился: ' + env.lineRule);
    if (env.context.Common.Utils.documentSettingsType.Paragraph !== 0) {
        throw new Error('documentSettingsType.Paragraph в оснастке не 0');
    }

    env.start();
    env.SS = env.module('SlideSections');
    env.run = (name, ...a) => { const r = env.shell.command(name)(...a); env.drain(); return r; };
    env.el = sel => env.document.querySelector(sel);
    return env;
}

function clickLine(env, item) {
    env.lineMenu.trigger('item:click', env.lineMenu, item, null);
}

function toggleLine(env, item, state) {
    env.lineMenu.trigger('item:toggle', env.lineMenu, item, state, null);
}

function paragraphType(env) {
    return env.context.Common.Utils.documentSettingsType.Paragraph;
}

/* Return the method installed after bind. The outer wrapper only records the result;
   it calls the actual interception unchanged. Do not use this in tests comparing method
   references or calling unbind: restoration identifies the wrapper by reference. */
function watchReturn(env) {
    const wrapped = env.rightCtl.onRightMenuOpen;
    const returns = [];
    env.rightCtl.onRightMenuOpen = function () {
        const result = wrapped.apply(this, arguments);
        returns.push(result);
        return result;
    };
    return returns;
}

function rightOpen(env) {
    return env.document.body.classList.contains('vo-right-open');
}

function cardLabel(env) {
    const el = env.el('#view-right-menu');
    return el && el.hasAttribute('aria-label') ? el.getAttribute('aria-label') : null;
}

const paraLabel = () => h.ru()['PE.Views.RightMenu.txtParagraphSettings'];
const themeLabel = () => h.ru()['PE.Views.SlideSections.textTheme'];

function cardSnap(env) {
    const theme = env.el('#vo-rp-theme');
    return {
        open: rightOpen(env),
        opened: env.SS.isOpen(),
        current: env.SS.current(),
        label: cardLabel(env),
        themeOn: !!(theme && theme.classList.contains('active')),
        themeText: theme ? theme.textContent : null,
        minimized: env.rm.minimizedMode,
        stockActive: env.rm.active,
        lastPane: env.lastPane()
    };
}

function spacingCalls(env) {
    return env.apiCalls.filter(c => c.name === 'put_PrLineSpacing');
}

function paneShows(env) {
    return env.stockCalls.filter(c => c.name === 'RightMenu.SetActivePane').length;
}

h.run([
    {
        /* In compact mode, clicking options opens the paragraph card without the stock method. */
        name: 'line_space_options_open_paragraph_card',
        run() {
            const env = started();
            assert.equal(env.SS.active(), true, 'компакт не активен');
            const returned = watchReturn(env);
            env.select('text');
            const notes = env.notes.length;
            clickLine(env, {value: 'options'});
            assert.equal(env.menuOpens.length, 0, 'штатный onRightMenuOpen выполнился');
            assert.deepEqual(env.paragraphOpens, [true], 'openParagraph не открыл карточку');
            assert.deepEqual(returned, [true], 'обёртка не вернула результат openParagraph');
            assert.equal(env.SS.isOpen(), true, 'карточка закрыта');
            assert.equal(rightOpen(env), true, 'нет vo-right-open');
            assert.equal(cardLabel(env), paraLabel(), 'подпись не параметры абзаца');
            assert.equal(env.lastPane(), 'Paragraph', 'показана не вкладка абзаца');
            assert.equal(env.SS.current(), 'object', 'раздел карточки не объект');
            assert.equal(spacingCalls(env).length, 0, 'вызван put_PrLineSpacing');
            const edits = env.notes.slice(notes).filter(n => n.name === 'edit:complete');
            assert.equal(edits.length, 1, 'edit:complete не сохранён');
            assert.equal(edits[0].args[0], env.tb, 'edit:complete без панели инструментов');
            assert.equal(paragraphType(env), 0, 'тип абзаца щелчка не 0');
        }
    },
    {
        /* In the stock interface, the original method receives the paragraph type. Its
           early return for an already active tab remains intact; no compact card opens. */
        name: 'line_space_options_keep_stock_column',
        run() {
            const env = started();
            env.run('stockInterface');
            assert.equal(env.shell.advanced, true, 'штатный интерфейс не включился');
            assert.equal(env.SS.active(), false, 'компакт ещё активен');
            assert.equal(env.rightCtl.onRightMenuOpen, env.originalOpen, 'в штатном интерфейсе метод обёрнут');
            env.select('text');
            clickLine(env, {value: 'options'});
            assert.equal(env.paragraphOpens.length, 0, 'в штатном интерфейсе вызван openParagraph');
            assert.equal(env.menuOpens.length, 1, 'исходный onRightMenuOpen не получил запрос');
            assert.equal(env.menuOpens[0].self, env.rightCtl, 'исходный метод вызван с другим this');
            assert.deepEqual(env.menuOpens[0].args, [paragraphType(env)], 'исходный метод получил не тип абзаца');
            assert.equal(env.menuOpens[0].args[0], 0, 'тип абзаца не 0');
            assert.equal(env.menuOpens[0].result.early, false, 'первый запрос не открыл штатную вкладку');
            assert.equal(env.SS.isOpen(), false, 'в штатном интерфейсе открыта карточка');
            assert.equal(rightOpen(env), false, 'в штатном интерфейсе есть vo-right-open');
            assert.equal(cardLabel(env), null, 'в штатном интерфейсе у панели подпись карточки');
            const shown = paneShows(env);
            clickLine(env, {value: 'options'});
            assert.equal(env.menuOpens.length, 2, 'повтор не дошёл до исходного метода');
            assert.equal(env.menuOpens[1].result.early, true, 'ранний выход сработал не в исходном методе');
            assert.equal(paneShows(env), shown, 'ранний выход снова показал вкладку');
            assert.equal(env.paragraphOpens.length, 0, 'повтор в штатном интерфейсе вызвал openParagraph');
            assert.equal(env.SS.isOpen(), false, 'повтор открыл карточку');
        }
    },
    {
        /* A click with a value other than options neither opens a card nor changes spacing. */
        name: 'line_space_options_ignore_other_values',
        run() {
            const env = started();
            env.select('text');
            const notes = env.notes.length;
            const api = env.apiCalls.length;
            clickLine(env, {value: 'advanced'});
            assert.equal(env.menuOpens.length, 0, 'чужое значение открыло меню');
            assert.equal(env.paragraphOpens.length, 0, 'чужое значение вызвало openParagraph');
            assert.equal(env.SS.isOpen(), false, 'чужое значение открыло карточку');
            assert.equal(rightOpen(env), false, 'чужое значение поставило vo-right-open');
            assert.equal(cardLabel(env), null, 'чужое значение подписало карточку');
            assert.equal(spacingCalls(env).length, 0, 'чужое значение вызвало put_PrLineSpacing');
            assert.equal(env.apiCalls.length, api, 'чужое значение вызвало движок');
            assert.equal(env.notes.slice(notes).some(n => n.name === 'edit:complete'), false, 'чужое значение дало edit:complete');
        }
    },
    {
        /* A refusal from openParagraph neither calls the original method nor opens the column. */
        name: 'line_space_options_unavailable_do_not_fall_back',
        run() {
            const env = started();
            const returned = watchReturn(env);
            env.select('text');
            env.run('slideSection', 'theme');
            assert.equal(env.SS.current(), 'theme', 'тема не открыта');
            const tab = env.rightCtl._settings[env.PANE.Paragraph];
            assert.equal(tab.hidden === 1 || tab.hidden === true, false, 'вкладка абзаца скрыта: это не отказ раздела');
            assert.equal(tab.btn.isDisabled(), false, 'кнопка абзаца погашена: это не отказ раздела');
            env.module('CompactModes').reason = item => (item && item.section === 'object' ? 'Недоступно в режиме просмотра' : null);
            env.nc.trigger('vo:mode', {mode: 'view'});
            env.drain();
            assert.equal(env.SS.sectionOff('object'), true, 'раздел объекта не запрещён');
            assert.equal(env.SS.paragraphTab(), true, 'вкладка абзаца недоступна сама по себе');
            assert.equal(env.SS.current(), 'theme', 'причина объекта закрыла тему');
            const before = cardSnap(env);
            assert.equal(before.label, themeLabel(), 'тема подписана не темой');
            assert.equal(before.open, true, 'тема закрыта до щелчка');
            const menus = env.menuOpens.length;
            const opens = env.paragraphOpens.length;
            clickLine(env, {value: 'options'});
            assert.equal(env.menuOpens.length, menus, 'отказ вызвал штатный onRightMenuOpen');
            assert.deepEqual(env.paragraphOpens.slice(opens), [false], 'openParagraph не вернул false');
            assert.deepEqual(returned, [false], 'обёртка не вернула false');
            assert.deepEqual(cardSnap(env), before, 'отказ изменил тему или открыл штатную колонку');
        }
    },
    {
        /* Other types in compact mode reach the original method with all arguments and the same this. */
        name: 'right_menu_open_keeps_other_types',
        run() {
            const env = started();
            assert.equal(env.SS.active(), true, 'компакт не активен');
            env.select('text');
            const token = {mark: 'other'};
            const result = env.rightCtl.onRightMenuOpen.call(env.rightCtl, env.PANE.Table, token, 0);
            assert.equal(env.paragraphOpens.length, 0, 'чужой тип вызвал openParagraph');
            assert.equal(env.menuOpens.length, 1, 'исходный метод не вызван');
            assert.equal(env.menuOpens[0].self, env.rightCtl, 'исходный метод вызван с другим this');
            assert.deepEqual(env.menuOpens[0].args, [env.PANE.Table, token, 0], 'исходный метод получил не те аргументы');
            assert.equal(result, env.menuOpens[0].result, 'обёртка не вернула результат исходного метода');
            assert.notEqual(env.PANE.Table, 0, 'таблица совпала с типом абзаца');
            assert.equal(env.SS.isOpen(), false, 'чужой тип открыл карточку');
            assert.equal(rightOpen(env), false, 'чужой тип поставил vo-right-open');
            assert.equal(cardLabel(env), null, 'чужой тип подписало карточку');
        }
    },
    {
        /* Switching to the stock interface removes the wrapper; returning installs it again.
           A repeated bind does not nest it. unbind restores the original method. */
        name: 'paragraph_menu_hook_survives_interface_switch',
        run() {
            const env = started();
            assert.notEqual(env.rightCtl.onRightMenuOpen, env.originalOpen, 'в компакте запрос не обёрнут');
            env.SS.bind();
            env.SS.bind();
            assert.notEqual(env.rightCtl.onRightMenuOpen, env.originalOpen, 'повторный bind снял обёртку');

            env.run('stockInterface');
            assert.equal(env.SS.active(), false, 'после ухода компакт активен');
            assert.equal(env.rightCtl.onRightMenuOpen, env.originalOpen, 'уход в штатный интерфейс не вернул исходный метод');

            env.run('stockInterface');
            assert.equal(env.SS.active(), true, 'после возврата компакт не активен');
            assert.notEqual(env.rightCtl.onRightMenuOpen, env.originalOpen, 'возврат в компакт не подключил обёртку');

            env.run('stockInterface');
            env.run('stockInterface');
            const wrapped = env.rightCtl.onRightMenuOpen;
            assert.notEqual(wrapped, env.originalOpen, 'после переходов запрос не обёрнут');
            env.SS.bind();
            env.SS.bind();
            env.SS.bind();
            assert.equal(env.rightCtl.onRightMenuOpen, wrapped, 'повторный bind вложил обёртку');

            env.select('text');
            const opens = env.paragraphOpens.length;
            const menus = env.menuOpens.length;
            clickLine(env, {value: 'options'});
            assert.equal(env.paragraphOpens.length, opens + 1, 'один запрос вызвал openParagraph не один раз');
            assert.equal(env.paragraphOpens[env.paragraphOpens.length - 1], true, 'запрос не открыл карточку');
            assert.equal(env.menuOpens.length, menus, 'обёртка вызвала исходный метод');

            env.SS.unbind();
            assert.equal(env.rightCtl.onRightMenuOpen, env.originalOpen, 'unbind не вернул исходный метод');
            const after = env.paragraphOpens.length;
            const again = env.rightCtl.onRightMenuOpen(paragraphType(env));
            assert.equal(env.paragraphOpens.length, after, 'после unbind запрос снова открыл абзац');
            assert.equal(env.menuOpens.length, menus + 1, 'после unbind исходный метод не вызван');
            assert.equal(env.menuOpens[env.menuOpens.length - 1].self, env.rightCtl, 'после unbind другой this');
            assert.deepEqual(env.menuOpens[env.menuOpens.length - 1].args, [0], 'после unbind исходный метод получил не тип абзаца');
            assert.equal(again, env.menuOpens[env.menuOpens.length - 1].result, 'после unbind вернулся не результат исходного метода');
        }
    },
    {
        /* Numeric presets use item:toggle and apply spacing immediately without opening a card. */
        name: 'line_space_presets_keep_stock_behavior',
        run() {
            const env = started();
            assert.equal(env.SS.active(), true, 'компакт не активен');
            env.select('text');
            assert.equal(env.SS.isOpen(), false, 'карточка была открыта до пунктов');
            PRESETS.forEach(value => {
                const before = spacingCalls(env).length;
                toggleLine(env, {value}, true);
                const calls = spacingCalls(env);
                assert.equal(calls.length, before + 1, value + ': put_PrLineSpacing не один раз');
                assert.deepEqual(calls[calls.length - 1].args, [env.lineRule, value], value + ': не LINERULE_AUTO и выбранное число');
                assert.equal(env.menuOpens.length, 0, value + ': был запрос открытия');
                assert.equal(env.paragraphOpens.length, 0, value + ': вызван openParagraph');
                assert.equal(env.SS.isOpen(), false, value + ': карточка открылась');
                assert.equal(rightOpen(env), false, value + ': появился vo-right-open');
                assert.equal(cardLabel(env), null, value + ': у карточки есть подпись');
            });
            assert.deepEqual(spacingCalls(env).map(c => c.args[1]), PRESETS, 'набор интервалов не 1.0, 1.15, 1.5, 2.0, 2.5, 3.0');
            assert.equal(spacingCalls(env).every(c => c.args[0] === 1), true, 'правило интервала не LINERULE_AUTO');
        }
    }
]);
