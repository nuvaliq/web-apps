/* Run: node test/unit-tests/common/compact/docinfo-window.cjs [path to DocInfoWindow.js]
 * The document info window of the shared compact layer (lib/view/compact/DocInfoWindow.js):
 * open({panel, title}) shows a stock modal window without a footer and moves the node of the stock
 * info panel of the File screen into it, right after the render; closing the window puts the node
 * back at its place (same parent, same next sibling), with its display and hidden flag, before the
 * stock close removes the window markup, so the jQuery handlers and data of the panel survive. The
 * title is the passed one, or the text of the header cell of the panel. Without a panel there is
 * no window. The window template recipe of the module (recipe: docinfo) recognizes the window by
 * its class. The module names no editor namespace.
 * Headless Chrome through Playwright (NODE_PATH or PLAYWRIGHT_MODULE; CHROMIUM_PATH optional).
 * The page runs the stock underscore, jQuery and Backbone of vendor/, the stock
 * NotificationCenter.js, BaseView.js and Window.js, then DocInfoWindow.js as it is; stand-ins are
 * only what the stock window reads of the editor around it (geometry, locale, the view extension of
 * the application) and the info panel: a Backbone view on #panel-info with the header cell of the
 * stock panel, a view event, direct and delegated jQuery handlers and jQuery data. Every check
 * gets a fresh page.
 * The optional argument points to a broken copy of the module for a negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../../..');
const file = rel => path.join(ROOT, rel);
const DOCINFO = process.argv[2] ? path.resolve(process.argv[2]) : file('apps/common/main/lib/view/compact/DocInfoWindow.js');
const ORIGIN = 'http://stand.test';
const PAGE = ORIGIN + '/web-apps/apps/editor/main/index.html';
const NAMESPACES = ['DE', 'PE', 'SSE', 'PDFE', 'VE'];
const HOME = ['panel-saveas', 'panel-info', 'panel-settings'];

/* --- The page ------------------------------------------------------------------------------ */

/* What the stock window reads of the editor around it. */
function standIns() {
    /* The editor loader hands the named libraries to a module; the rest is global. */
    window.define = function (deps, factory) {
        var named = {backbone: window.Backbone, underscore: window._, jquery: window.jQuery};
        return factory.apply(window, (deps || []).map(function (d) { return named[d]; }));
    };
    /* The editor application extends every view (core/application.js): fireEvent goes to the
       events of the view, show and hide toggle the node and the hidden flag. No event bus. */
    _.extend(Backbone.View.prototype, {
        hidden: false,
        fireEvent: function () { this.trigger.apply(this, arguments); },
        hide: function () { this.$el.hide(); this.hidden = true; },
        show: function () { this.$el.show(); this.hidden = false; }
    });
    window.Probe = {clicks: {direct: 0, delegated: 0, control: 0}, events: []};
    window.Common = {
        UI: {isRTL: function () { return false; }, Menu: {Manager: {hideAll: function () {}}}},
        Views: {},
        Utils: {
            innerWidth: function () { return window.innerWidth; },
            innerHeight: function () { return window.innerHeight; },
            InternalSettings: {get: function () { return 0; }, set: function () {}},
            zoom: function () { return 1; }
        },
        Locale: {getCurrentLanguage: function () { return 'en'; }},
        Gateway: {on: function () {}, off: function () {}}
    };
}

/* The info panel and readings for the checks, after the stock window. */
function probes() {
    /* The stock info panel of the File screen: a view on #panel-info whose first row is the header
       cell, with fields bound by jQuery. */
    Probe.Panel = Common.UI.BaseView.extend({
        el: '#panel-info',
        events: {'click .probe': 'onProbe'},
        initialize: function (options) {
            Common.UI.BaseView.prototype.initialize.call(this, options);
            this.shows = 0;
            this.viewClicks = 0;
            this.$el.html('<div class="flex-settings"><table class="main">' +
                '<tbody><td class="header">\n   Document Info  \n</td></tbody>' +
                '<tbody><tr><td class="left"><label>Title</label></td>' +
                '<td class="right"><input class="probe-field" value="Draft"><button class="probe">Edit</button></td></tr></tbody>' +
                '</table></div>');
        },
        onProbe: function () { this.viewClicks++; },
        show: function () {
            Common.UI.BaseView.prototype.show.call(this, arguments);
            this.shows++;
        }
    });
    /* As the File screen leaves the panel: built, hidden, its fields bound. */
    Probe.panel = function () {
        var p = new Probe.Panel();
        p.hide();
        p.$el.find('.probe').on('click', function () { Probe.clicks.direct++; });
        p.$el.on('click', '.probe', function () { Probe.clicks.delegated++; });
        p.$el.find('.probe-field').data('probe', 'kept');
        return p;
    };
    Probe.click = function (p) {
        p.$el.find('.probe')[0].click();
        return {direct: Probe.clicks.direct, delegated: Probe.clicks.delegated, view: p.viewClicks,
            data: $(p.$el.find('.probe-field')[0]).data('probe')};
    };
    Probe.order = function () {
        return Array.prototype.map.call(document.getElementById('file-menu').children, function (n) { return n.id; });
    };
    Probe.box = function (win) { return win.$window.find('> .body > .box')[0]; };
    Probe.windows = function () { return document.querySelectorAll('.asc-window').length; };
    Common.NotificationCenter.on('modal:show', function () { Probe.events.push('modal:show'); });
    Common.NotificationCenter.on('window:show', function (win) {
        var p = Probe.current;
        Probe.events.push('window:show');
        if (p) Probe.atShow = {inBox: p.$el[0].parentNode === Probe.box(win), shows: p.shows, hidden: p.hidden};
    });
}

const read = f => fs.readFileSync(f, 'utf8');
const SCRIPTS = [
    ['vendor/underscore/underscore.js'],
    ['vendor/jquery/jquery.js'],
    ['vendor/backbone/backbone.js'],
    ['stand-ins', '(' + standIns + ')();'],
    ['apps/common/main/lib/core/NotificationCenter.js'],
    ['apps/common/main/lib/component/BaseView.js'],
    ['apps/common/main/lib/component/Window.js'],
    ['probes', '(' + probes + ')();'],
    [DOCINFO, read(DOCINFO)]
].map(([name, text]) => ({name, text: text === undefined ? read(file(name)) : text}));

/* The File screen: the info panel between two other panels. */
const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body class="vo-compact">
<div id="file-menu"><div id="panel-saveas"></div><div id="panel-info" style="display: none;"></div><div id="panel-settings"></div></div>
<div id="elsewhere"></div>
</body></html>`;

function playwright() {
    return require(process.env.PLAYWRIGHT_MODULE || 'playwright');
}

async function openPage(browser) {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(ORIGIN + '/**', route => route.fulfill({status: 200, contentType: 'text/html', body: HTML}));
    await page.goto(PAGE);
    for (const s of SCRIPTS) await page.addScriptTag({content: s.text + '\n//# sourceURL=' + path.basename(s.name)});
    page.errors = errors;
    return page;
}

/* --- Checks -------------------------------------------------------------------------------- */

let passed = 0, failed = 0;
async function check(name, fn) {
    try { await fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

/* A check on a fresh page: no page errors, the page closes whatever happens. */
async function onPage(browser, body) {
    const page = await openPage(browser);
    try {
        await body(page);
        assert.deepEqual(page.errors, [], 'page errors');
    } finally {
        await page.close();
    }
}

(async () => {
    const browser = await playwright().chromium.launch(process.env.CHROMIUM_PATH ?
        {headless: true, executablePath: process.env.CHROMIUM_PATH} : {headless: true, channel: 'chrome'});
    try {

        await check('the panel moves into the window while it is shown, not a copy of it', () => onPage(browser, async page => {
            const r = await page.evaluate(() => {
                const p = Probe.current = Probe.panel();
                const before = Probe.order();
                const win = Common.UI.Compact.DocInfoWindow.open({panel: p});
                return {
                    before, during: Probe.order(),
                    isWindow: win instanceof Common.UI.Window,
                    visible: win.$window.is(':visible'),
                    classes: win.$window[0].className.split(/\s+/),
                    inBox: p.$el[0].parentNode === Probe.box(win),
                    panels: document.querySelectorAll('#panel-info').length,
                    atShow: Probe.atShow, events: Probe.events,
                    shows: p.shows, hidden: p.hidden, display: p.$el[0].style.display
                };
            });
            assert.deepEqual(r.before, HOME, 'the File screen before');
            assert.equal(r.isWindow, true, 'open gives the stock window');
            assert.equal(r.visible, true, 'the window is shown');
            for (const c of ['asc-window', 'modal', 'vo-docinfo-dlg']) assert.ok(r.classes.includes(c), 'class ' + c + ': ' + r.classes.join(' '));
            assert.equal(r.inBox, true, 'the panel node is in the body box of the window');
            assert.deepEqual(r.during, ['panel-saveas', 'panel-settings'], 'the panel left the File screen');
            assert.equal(r.panels, 1, 'one panel node, not a copy');
            assert.deepEqual(r.events, ['modal:show', 'window:show'], 'shown as a modal window');
            assert.deepEqual(r.atShow, {inBox: true, shows: 1, hidden: false}, 'the panel is in the window and shown when the window is shown');
            assert.deepEqual([r.shows, r.hidden, r.display], [1, false, ''], 'the panel is shown once');
        }));

        await check('closing puts the panel back at its place with its handlers', () => onPage(browser, async page => {
            const r = await page.evaluate(() => {
                const p = Probe.current = Probe.panel();
                const D = Common.UI.Compact.DocInfoWindow;
                const out = {};
                const win = D.open({panel: p});
                out.inWindow = Probe.click(p);
                /* A node bound the same way that stays in the window markup. */
                const control = $('<i class="control"></i>').appendTo(win.$window.find('> .body'));
                control.on('click', () => { Probe.clicks.control++; }).data('probe', 'kept');
                /* The cross of the window header closes it as a person does. */
                win.$window.find('.tool.close')[0].click();
                out.afterCross = {order: Probe.order(), windows: Probe.windows(), click: Probe.click(p)};
                document.body.appendChild(control[0]);
                control[0].click();
                out.control = {clicks: Probe.clicks.control, data: $(control[0]).data('probe')};
                /* Esc closes it the same way. */
                const again = D.open({panel: p});
                out.againInBox = p.$el[0].parentNode === Probe.box(again);
                $(document).trigger($.Event('keydown', {keyCode: 27, which: 27}));
                out.afterEsc = {order: Probe.order(), windows: Probe.windows(), click: Probe.click(p)};
                /* And a close from code. */
                const third = D.open({panel: p});
                third.close();
                out.afterClose = {order: Probe.order(), windows: Probe.windows(), click: Probe.click(p)};
                return out;
            });
            assert.deepEqual(r.inWindow, {direct: 1, delegated: 1, view: 1, data: 'kept'}, 'handlers work in the window');
            for (const [k, n] of [['afterCross', 2], ['afterEsc', 3], ['afterClose', 4]]) {
                assert.deepEqual(r[k].order, HOME, k + ': the panel is back between its neighbours');
                assert.equal(r[k].windows, 0, k + ': the window markup is gone');
                assert.deepEqual(r[k].click, {direct: n, delegated: n, view: n, data: 'kept'}, k + ': handlers and data of the panel survive');
            }
            /* What the stock close removes loses its handlers: the panel survives only because it left first. */
            assert.deepEqual(r.control, {clicks: 0, data: undefined}, 'a node left in the window markup loses its handlers');
            assert.equal(r.againInBox, true, 'the panel moves into the next window again');
        }));

        await check('the panel goes to the end of its parent when its neighbour is gone', () => onPage(browser, async page => {
            const r = await page.evaluate(() => {
                const p = Probe.current = Probe.panel();
                const win = Common.UI.Compact.DocInfoWindow.open({panel: p});
                document.getElementById('panel-settings').remove();
                win.close();
                const gone = Probe.order();
                /* A neighbour moved to another parent counts as gone as well. */
                document.getElementById('file-menu').appendChild(Object.assign(document.createElement('div'), {id: 'panel-help'}));
                const win2 = Common.UI.Compact.DocInfoWindow.open({panel: p});
                const before = Probe.order();
                document.getElementById('elsewhere').appendChild(document.getElementById('panel-help'));
                win2.close();
                return {gone, before, moved: Probe.order(), click: Probe.click(p)};
            });
            assert.deepEqual(r.gone, ['panel-saveas', 'panel-info'], 'the panel is the last child of its parent');
            assert.deepEqual(r.before, ['panel-saveas', 'panel-help'], 'the next window took it out again');
            assert.deepEqual(r.moved, ['panel-saveas', 'panel-info'], 'its moved neighbour is not followed');
            assert.deepEqual(r.click, {direct: 1, delegated: 1, view: 1, data: 'kept'});
        }));

        await check('the display and the hidden flag of the panel come back', () => onPage(browser, async page => {
            const r = await page.evaluate(() => {
                const D = Common.UI.Compact.DocInfoWindow;
                const p = Probe.current = Probe.panel();
                const out = {home: {display: p.$el[0].style.display, hidden: p.hidden}};
                const win = D.open({panel: p});
                out.shown = {display: p.$el[0].style.display, hidden: p.hidden};
                win.close();
                out.closed = {display: p.$el[0].style.display, hidden: p.hidden};
                /* The panel on screen at its place stays on screen. */
                p.show();
                p.$el[0].style.display = 'block';
                const win2 = D.open({panel: p});
                win2.close();
                out.visible = {display: p.$el[0].style.display, hidden: p.hidden};
                return out;
            });
            assert.deepEqual(r.home, {display: 'none', hidden: true}, 'the File screen keeps the panel hidden');
            assert.deepEqual(r.shown, {display: '', hidden: false}, 'the panel is shown in the window');
            assert.deepEqual(r.closed, {display: 'none', hidden: true}, 'hidden again at its place');
            assert.deepEqual(r.visible, {display: 'block', hidden: false}, 'a panel on screen stays on screen');
        }));

        await check('the window has no footer', () => onPage(browser, async page => {
            const r = await page.evaluate(() => {
                const D = Common.UI.Compact.DocInfoWindow;
                const win = D.open({panel: Probe.current = Probe.panel()});
                const $w = win.$window, cfg = win.initConfig;
                return {
                    CLS: D.CLS, WIDTH: D.WIDTH,
                    footer: $w.find('.footer').length, buttons: $w.find('.dlg-btn, button.btn').length,
                    cfgButtons: cfg.buttons === undefined && cfg.buttonsParsed === undefined,
                    body: Array.prototype.map.call($w.find('> .body')[0].children, n => n.className),
                    box: Array.prototype.map.call(Probe.box(win).children, n => n.id),
                    tools: Array.prototype.map.call($w.find('> .header .tool'), n => n.className),
                    width: $w[0].style.width, role: $w.attr('role'), modal: $w.attr('aria-modal'),
                    cfg: {width: cfg.width, header: cfg.header, closable: cfg.closable, modal: cfg.modal, cls: cfg.cls}
                };
            });
            assert.deepEqual([r.CLS, r.WIDTH], ['vo-docinfo-dlg', 560], 'class and width of the window');
            assert.equal(r.footer, 0, 'no footer');
            assert.equal(r.buttons, 0, 'no footer buttons');
            assert.equal(r.cfgButtons, true, 'no buttons in the config');
            assert.deepEqual(r.body, ['box'], 'the body holds the box only');
            assert.deepEqual(r.box, ['panel-info'], 'the box holds the panel only');
            assert.deepEqual(r.tools, ['tool close'], 'the header has the cross only');
            assert.deepEqual(r.cfg, {width: 560, header: true, closable: true, modal: true, cls: 'vo-docinfo-dlg'}, 'window options');
            assert.deepEqual([r.width, r.role, r.modal], ['560px', 'dialog', 'true'], 'markup of the window');
        }));

        await check('the title is the header of the panel and a passed title wins', () => onPage(browser, async page => {
            const r = await page.evaluate(() => {
                const D = Common.UI.Compact.DocInfoWindow;
                const p = Probe.current = Probe.panel();
                const title = opts => {
                    const win = D.open(Object.assign({panel: p}, opts));
                    const out = {markup: win.$window.find('> .header > .title').text(), config: win.initConfig.title};
                    win.close();
                    return out;
                };
                return {
                    header: title({}), passed: title({title: 'PDF Info'}),
                    empty: title({title: ''}), none: title({title: null}), number: title({title: 0})
                };
            });
            assert.deepEqual(r.header, {markup: 'Document Info', config: 'Document Info'}, 'the trimmed header text of the panel');
            assert.deepEqual(r.passed, {markup: 'PDF Info', config: 'PDF Info'}, 'the passed title');
            assert.deepEqual(r.empty, r.header, 'an empty title falls back to the header');
            assert.deepEqual(r.none, r.header, 'a null title falls back to the header');
            assert.deepEqual(r.number, {markup: '0', config: '0'}, 'a title 0 is a title');
        }));

        await check('without a panel open gives null and shows nothing', () => onPage(browser, async page => {
            const r = await page.evaluate(() => {
                const D = Common.UI.Compact.DocInfoWindow;
                const p = Probe.current = Probe.panel();
                const results = {
                    noOptions: D.open(),
                    empty: D.open({}),
                    nullPanel: D.open({panel: null}),
                    noNode: D.open({panel: {}}),
                    emptySelection: D.open({panel: {$el: $('#no-such-panel'), show() {}}}),
                    textNode: D.open({panel: {$el: [document.createTextNode('info')], show() {}}})
                };
                /* Without the stock window there is no window either. */
                const W = Common.UI.Window;
                Common.UI.Window = undefined;
                try { results.noWindowClass = D.open({panel: p}); } finally { Common.UI.Window = W; }
                return {
                    results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v === null ? 'null' : typeof v])),
                    windows: Probe.windows(), masks: document.querySelectorAll('.modals-mask').length,
                    events: Probe.events, order: Probe.order(), shows: p.shows
                };
            });
            for (const [k, v] of Object.entries(r.results)) assert.equal(v, 'null', k);
            assert.equal(r.windows, 0, 'no window markup');
            assert.equal(r.masks, 0, 'no mask');
            assert.deepEqual(r.events, [], 'no window shown');
            assert.deepEqual(r.order, HOME, 'the panel stays at its place');
            assert.equal(r.shows, 0, 'the panel is not shown');
        }));

        await check('a second close leaves the panel where it is', () => onPage(browser, async page => {
            const r = await page.evaluate(() => {
                const p = Probe.current = Probe.panel();
                const win = Common.UI.Compact.DocInfoWindow.open({panel: p});
                win.close();
                /* The File screen moves its panel later on; a late second close does not take it back. */
                document.getElementById('elsewhere').appendChild(p.$el[0]);
                win.close();
                return {parent: p.$el[0].parentNode.id, order: Probe.order()};
            });
            assert.equal(r.parent, 'elsewhere');
            assert.deepEqual(r.order, ['panel-saveas', 'panel-settings']);
        }));

        await check('the window template recipe recognizes the window by its class', () => onPage(browser, async page => {
            const r = await page.evaluate(() => {
                const D = Common.UI.Compact.DocInfoWindow, recipe = D.recipe;
                if (!recipe || typeof recipe.match !== 'function') return {recipe: false};
                const win = D.open({panel: Probe.current = Probe.panel()});
                const match = cls => recipe.match({initConfig: {cls: cls}}) === true;
                const out = {
                    recipe: true, id: recipe.id, keys: Object.keys(recipe).sort().join(' '),
                    opened: recipe.match(win) === true,
                    own: match('vo-docinfo-dlg'), among: match('modal-dlg vo-docinfo-dlg vo-win'),
                    none: match(''), other: match('vo-print-dlg'), prefix: match('vo-docinfo-dlg-x'),
                    noConfig: recipe.match({}) === false && recipe.match(null) === false
                };
                win.close();
                return out;
            });
            assert.equal(r.recipe, true, 'no recipe with match');
            assert.equal(r.id, 'docinfo', 'recipe id');
            assert.equal(r.keys, 'id match', 'the recipe has no size or apply of its own');
            assert.equal(r.opened, true, 'the opened window matches');
            assert.deepEqual([r.own, r.among], [true, true], 'a window with the class matches');
            assert.deepEqual([r.none, r.other, r.prefix], [false, false, false], 'a window without the class matches');
            assert.equal(r.noConfig, true, 'a window without a config matches');
        }));

        await check('the module mentions no editor namespace', () => {
            const forbidden = [
                {what: 'editor namespace', re: new RegExp('(^|[^\\w.$])(' + NAMESPACES.join('|') + ')\\s*\\.')},
                {what: 'editor namespace on window', re: new RegExp('\\bwindow\\s*(\\.\\s*(' + NAMESPACES.join('|') + ')\\b|\\[\\s*[\'"](' + NAMESPACES.join('|') + ')[\'"])')},
                {what: 'editor application folder', re: /\b(document|spreadsheet|presentation|pdf|visio)editor\b/}
            ];
            const scan = text => text.split('\n').flatMap((line, i) =>
                forbidden.filter(f => f.re.test(line)).map(f => (i + 1) + ': ' + f.what));
            /* The scan sees what it looks for. */
            const probe = ['var a = PDFE.Views.FileMenuPanels;', "if (window.DE) x();", "var b = window['VE'];",
                "define(['pdfeditor/main/app/view/X'], f);", 'var ok = Common.UI.Compact.DocInfoWindow; obj.PE.x; var VERSION = 1;'].join('\n');
            assert.deepEqual(scan(probe), ['1: editor namespace', '2: editor namespace on window', '3: editor namespace on window', '4: editor application folder'], 'probe scan');
            const found = scan(read(DOCINFO));
            assert.deepEqual(found, [], path.basename(DOCINFO) + ':\n' + found.join('\n'));
        });

    } finally {
        await browser.close();
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error('FAIL', error); process.exitCode = 1; });
