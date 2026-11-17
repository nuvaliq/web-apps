/* Run: node test/unit-tests/pdfeditor/menu-bar.cjs [copies of shell modules…]
 * The ⋮ menu of the compact shell of the PDF viewer at the end of the bar: the shared menu bar with
 * one section, pinned, its button the ⋮ glyph. The catalog (PdfActions) is a valid description for
 * the shared model (MenuModel.validate); its items are exactly what is not on the bar — Download as ▸
 * (Word, PNG, JPG, other formats), Rename, Document Info | Go to page, first and last page | Comments |
 * Advanced settings, Keyboard shortcuts, About; there is no Version history and no Help (neither the
 * item nor a Help ▸ submenu, whatever the rights say), no Edit, no zoom, no thumbnails or headings, no
 * select or hand, no toolbar or focus mode, no full screen, no standard interface. Items are there by
 * the rights of appOptions, read when the menu opens; Comments only while the PDF has comments; Go to
 * page puts the focus into the page field; every item takes a stock path — Other formats… and Advanced
 * settings show their stock panel of the "File" screen in a window over the document, not the screen;
 * Document Info, Advanced settings and About are there as in the stock File screen: the integrator's
 * layout switches toolbar-file-info and toolbar-file-settings and customization.about (false or
 * {visible: false}) take them away;
 * Document Info opens Common.UI.Compact.DocInfoWindow with the stock info panel, About opens
 * Common.UI.Compact.AboutWindow; the adapter reads the item state again right before it runs the item;
 * the menu subscribes to api:disconnect once per session (not per rebuild), under the shell guard.
 *
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH), see lib/shell-page.cjs.
 * Rows are known by their keys (data-k), not by their texts. Optional arguments: copies of
 * modules (by file name: PdfActions.js, CompactMenuAdapter.js…) for a negative control.
 */
'use strict';

const assert = require('node:assert/strict');
const H = require('./lib/shell-page.cjs');

/* The ⋮ list: item keys, a submenu as [key, [its keys without the key prefix]]. */
const CATALOG = [
    ['file.downloadAs', ['docx', 'png', 'jpg', 'sep', 'more']], 'file.rename', 'file.info', 'sep',
    'view.goToPage', 'view.firstPage', 'view.lastPage', 'sep',
    'view.comments', 'sep',
    'app.settings', 'app.shortcuts', 'app.about'
];
const flat = list => list.map(x => (Array.isArray(x) ? x[0] : x));
const without = (list, keys) => {
    const out = flat(list).filter(k => !keys.includes(k));
    /* The shared model drops a separator next to another one and at the ends. */
    return out.filter((k, i) => k !== 'sep' || (i > 0 && i < out.length - 1 && out[i - 1] !== 'sep'));
};
const COMMENTS = [{text: 'A note'}];

/* The catalog of the page as the CATALOG shape. */
const catalogShape = page => page.evaluate(() => {
    const Model = Common.UI.Compact.MenuModel, ctx = shell.menuAdapter.context();
    const walk = (items, prefix) => items.map(it => {
        if (Model.kindOf(it) === 'sep') return 'sep';
        const k = prefix ? it.k.slice(prefix.length + 1) : it.k;
        return Model.kindOf(it) === 'submenu' ? [k, walk(Model.itemsOf(it, ctx), it.k)] : k;
    });
    return PDFE.Views.PdfActions.sections().map(s => [s.k, walk(s.items, '')]);
});

/* Rows of an open list, keys without the parent prefix, 'sep' for a separator. */
const listRows = (page, selector, prefix) => page.evaluate(({selector, prefix}) => {
    const drop = document.querySelector(selector);
    if (!drop) return null;
    const out = [];
    const take = el => {
        if (el.classList.contains('vo-mn-sep')) out.push('sep');
        else if (el.classList.contains('vo-mn-grp')) Array.from(el.children).forEach(take);
        else if (el.hasAttribute('data-k')) {
            const k = el.getAttribute('data-k');
            out.push(!prefix ? k : k.indexOf(prefix + '.') === 0 ? k.slice(prefix.length + 1) : '!' + k);
        }
    };
    Array.from(drop.children).forEach(take);
    return out;
}, {selector, prefix});

async function openMore(page) {
    if (await page.evaluate(() => shell.menu.isOpen())) await page.evaluate(() => shell.menu.close());
    await page.click('#vo-tb [data-vo="more"]');
    return listRows(page, '#vo-tb .vo-mn-item[data-k="more"] + .vo-mn-drop.open', '');
}

async function openSub(page, k) {
    await page.click(`#vo-tb .vo-mn-drop.open [data-k="${k}"]`);
    return listRows(page, '#vo-tb .vo-mn-fly', k);
}

/* The drawn menu as the CATALOG shape: the list and every submenu opened in turn. */
async function drawn(page) {
    const rows = await openMore(page), out = [];
    for (const r of rows) {
        const isSub = await page.evaluate(key => {
            const el = document.querySelector(`#vo-tb .vo-mn-drop.open [data-k="${key}"]`);
            return !!el && el.classList.contains('vo-has-sub');
        }, r);
        out.push(isSub ? [r, await openSub(page, r)] : r);
    }
    await page.evaluate(() => shell.menu.close());
    return out;
}

/* Calls of the stock stand-ins, without the layout, the engine keyboard and the closing of open
   stock menus that every opened menu does (Common.UI.Menu.Manager.hideAll). */
const stockCalls = page => page.evaluate(() => stock.log.filter(e => e.who !== 'layout' && e.what !== 'menu hideAll' &&
        !(e.who === 'api' && /Resize|asc_enableKeyEvents/.test(e.what)))
    .map(e => e.who + ':' + e.what + (e.args.length ? '(' + e.args.map(a => JSON.stringify(a === undefined ? null : a)).join(',') + ')' : '')));

(async () => {
    const {check, done} = H.checker();
    const browser = await H.launch();
    try {
        await check('the catalog passes MenuModel.validate', async () => {
            const page = await H.open(browser, {comments: COMMENTS});
            const out = await page.evaluate(() => {
                const Model = Common.UI.Compact.MenuModel, list = PDFE.Views.PdfActions.sections();
                return {plain: Model.validate(list, {depth: 2}), ctx: Model.validate(list, {depth: 2, ctx: shell.menuAdapter.context()})};
            });
            assert.deepEqual(out.plain, [], 'problems of the catalog');
            assert.deepEqual(out.ctx, [], 'problems of the catalog with the editor state');
            await page.close();
        });

        await check('one section, the ⋮ button at the end of the bar; its items are exactly the viewer list', async () => {
            const page = await H.open(browser, {comments: COMMENTS});
            const shape = await catalogShape(page);
            assert.deepEqual(shape.map(s => s[0]), ['more'], 'sections of the catalog');
            assert.deepEqual(shape[0][1], CATALOG, 'the catalog');
            const bar = await page.evaluate(() => {
                const end = document.getElementById('vo-tb-end');
                const tops = Array.from(document.querySelectorAll('#vo-tb .vo-mn > .vo-mn-wrap > .vo-mn-item')).filter(b => b.getClientRects().length);
                const b = tops[0];
                const iconOf = e => { const s = e && e.querySelector('.vo-air'); const m = s && /img\/air\/(\w+)\.svg/.exec(s.getAttribute('style') || ''); return m ? m[1] : null; };
                return {tops: tops.map(t => t.getAttribute('data-k')), last: end.lastElementChild.contains(b), icon: iconOf(b),
                    text: b.textContent.trim(), label: b.getAttribute('aria-label'), title: b.getAttribute('title'),
                    menuRow: !!document.getElementById('vo-menubar'), header: !!document.getElementById('vo-header')};
            });
            assert.deepEqual(bar.tops, ['more'], 'buttons of the menu');
            assert.equal(bar.last, true, 'the ⋮ is not the last control of the bar');
            assert.equal(bar.icon, 'moreV', 'the glyph of ⋮');
            assert.equal(bar.text, '', 'the ⋮ button shows text');
            const label = await page.evaluate(() => Common.Translation && Common.Translation.textMoreButton || PDFE.Views.PdfActions.textMore);
            assert.deepEqual([bar.label, bar.title], [label, label], 'the tip and the label of ⋮');
            assert.deepEqual([bar.menuRow, bar.header], [false, false], 'a menu row or a header is still there');
            /* With every right and comments the menu draws the whole list. */
            assert.deepEqual(await drawn(page), CATALOG, 'the drawn menu');
            /* The list opens inside the window: its right edge at the right edge of the button. */
            await openMore(page);
            const edges = await page.evaluate(() => {
                const b = document.querySelector('#vo-tb [data-vo="more"]').getBoundingClientRect();
                const d = document.querySelector('#vo-tb .vo-mn-drop.open').getBoundingClientRect();
                return {right: Math.round(d.right - b.right), inside: d.right <= innerWidth && d.left >= 0, below: d.top >= b.bottom};
            });
            assert.deepEqual(edges, {right: 0, inside: true, below: true}, 'where the list opens');
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('items are there by the rights of appOptions, read when the menu opens', async () => {
            const cases = [
                [{canDownload: false}, ['file.downloadAs']],
                [{canRename: false}, ['file.rename']],
                [{isDesktopApp: true}, ['file.rename']],
                [{canViewComments: false}, ['view.comments']],
                [{isLightVersion: true}, ['view.comments']],
                [{canUseHistory: false}, []],
                [{canHelp: false}, []],
                [{canDownload: false, canRename: false, canViewComments: false}, ['file.downloadAs', 'file.rename', 'view.comments']]
            ];
            for (const [rights, gone] of cases) {
                const page = await H.open(browser, {rights, comments: COMMENTS});
                assert.deepEqual(await openMore(page), without(CATALOG, gone), JSON.stringify(rights));
                await page.close();
            }
            const page = await H.open(browser, {comments: COMMENTS});
            await openMore(page);
            await page.evaluate(() => { shell.menu.close(); stock.main.appOptions.canDownload = false; stock.main.appOptions.canRename = false; });
            assert.deepEqual(await openMore(page), without(CATALOG, ['file.downloadAs', 'file.rename']), 'rights taken later');
            await page.close();
        });

        await check('items the integrator turned off are not there: Document info, Advanced settings, About', async () => {
            const cases = [
                ['toolbar-file-info is off', {}, 'toolbar-file-info', ['file.info']],
                ['toolbar-file-settings is off', {}, 'toolbar-file-settings', ['app.settings']],
                ['about: false', {customization: {about: false}}, null, ['app.about']],
                ['about: {visible: false}', {customization: {about: {visible: false}}}, null, ['app.about']],
                ['about: true', {customization: {about: true}}, null, []],
                ['about: a text', {customization: {about: {text: 'Company'}}}, null, []],
                ['another element is off', {customization: {}}, 'toolbar-file-save', []]
            ];
            for (const [what, rights, off, gone] of cases) {
                const page = await H.open(browser, {rights, comments: COMMENTS});
                await page.evaluate(off => { Common.UI.LayoutManager = {isElementVisible: name => name !== off}; }, off);
                assert.deepEqual(await openMore(page), without(CATALOG, gone), what);
                await page.close();
            }
        });

        await check('Comments is there only while the PDF has comments', async () => {
            const none = await H.open(browser);
            assert.deepEqual(await openMore(none), without(CATALOG, ['view.comments']), 'a PDF without comments');
            /* Comments that come later show the item on the next opening; hidden ones do not count. */
            await none.evaluate(() => { shell.menu.close(); stock.comments.add({uid: 'h', hide: true}); });
            assert.deepEqual(await openMore(none), without(CATALOG, ['view.comments']), 'a hidden comment counts');
            await none.evaluate(() => { shell.menu.close(); stock.comments.add({uid: 'n', text: 'New'}); });
            assert.deepEqual(await openMore(none), flat(CATALOG), 'a comment that came later');
            await none.close();
        });

        await check('Go to page puts the focus into the page field', async () => {
            const page = await H.open(browser);
            await openMore(page);
            await page.click('#vo-tb .vo-mn-drop.open [data-k="view.goToPage"]');
            await H.settle(page);
            assert.deepEqual(await page.evaluate(() => {
                const a = document.activeElement;
                return [a && a.getAttribute('data-vo'), !!a && !!a.closest('#vo-tb'), a && a.selectionStart === 0 && a.selectionEnd === a.value.length];
            }), ['page', true, true], 'the page field has no focus');
            await page.close();
        });

        await check('no Version history and no Help: the list ends with Advanced settings, Keyboard shortcuts, About', async () => {
            const page = await H.open(browser, {comments: COMMENTS, rights: {canUseHistory: true, canHelp: true}});
            const rows = await openMore(page);
            assert.deepEqual(rows.filter(k => /history|help/i.test(k)), [], 'Version history or Help in ⋮');
            assert.deepEqual(rows.slice(-4), ['sep', 'app.settings', 'app.shortcuts', 'app.about'], 'the end of ⋮');
            const out = await page.evaluate(() => {
                const subs = Array.from(document.querySelectorAll('#vo-tb .vo-mn-drop.open > .vo-has-sub')).map(r => r.getAttribute('data-k'));
                const text = k => (document.querySelector(`#vo-tb .vo-mn-drop.open [data-k="${k}"]`) || {}).textContent || '';
                return {subs, settings: text('app.settings').trim(), shortcuts: text('app.shortcuts').trim(), about: text('app.about').trim(),
                    stock: [PDFE.Views.FileMenu.btnSettingsCaption, Common.Views.ShortcutsDialog && Common.Views.ShortcutsDialog.txtTitle, PDFE.Views.LeftMenu.tipAbout]};
            });
            assert.deepEqual(out.subs, ['file.downloadAs'], 'submenus of ⋮');
            assert.deepEqual([out.settings, out.shortcuts, out.about], out.stock, 'the captions are not the stock ones');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('the keyboard: F10 and Enter open ⋮ on its first row, → opens a submenu, Escape steps back', async () => {
            const page = await H.open(browser, {comments: COMMENTS});
            const at = () => page.evaluate(() => {
                const a = document.activeElement;
                return a && (a.getAttribute('data-k') || a.getAttribute('data-vo') || a.id || a.localName);
            });
            await page.focus('#area_id');
            await page.keyboard.press('F10');
            assert.equal(await at(), 'more', 'F10 does not put the focus on ⋮');
            await page.keyboard.press('Enter');
            assert.equal(await page.evaluate(() => shell.menu.isOpen()), true, 'Enter does not open ⋮');
            assert.equal(await at(), 'file.downloadAs', 'the first row has no focus');
            await page.keyboard.press('ArrowRight');
            assert.equal(await at(), 'file.downloadAs.docx', '→ does not open the submenu on its first row');
            await page.keyboard.press('Escape');
            assert.deepEqual([await at(), await page.evaluate(() => !!document.querySelector('#vo-tb .vo-mn-fly.open, #vo-tb .vo-mn-fly:not([hidden])') &&
                getComputedStyle(document.querySelector('#vo-tb .vo-mn-fly')).display !== 'none')], ['file.downloadAs', false], 'Escape in the submenu');
            await page.keyboard.press('ArrowDown');
            assert.equal(await at(), 'file.rename', '↓');
            await page.keyboard.press('Escape');
            assert.equal(await page.evaluate(() => shell.menu.isOpen()), false, 'Escape does not close ⋮');
            await page.keyboard.press('Escape');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('every item takes its stock path', async () => {
            const page = await H.open(browser, {comments: COMMENTS, rights: {canSwitchMode: false}});
            const run = async (path, sub) => {
                await page.evaluate(() => { stock.log.length = 0; stock.events.length = 0; });
                await openMore(page);
                if (sub) await openSub(page, sub);
                await page.click(`#vo-tb .vo-mn-drop.open [data-k="${path}"]`);
                await H.settle(page);
                const calls = await stockCalls(page);
                /* A window the item opened is closed before the next item. */
                await page.evaluate(() => stock.windows.forEach(w => w.$window && w.close()));
                return calls;
            };
            const cases = [
                ['file.downloadAs.docx', 'file.downloadAs', ['leftMenu:clickSaveAsFormat(65)']],
                ['file.downloadAs.png', 'file.downloadAs', ['leftMenu:clickSaveAsFormat(1029)']],
                ['file.downloadAs.jpg', 'file.downloadAs', ['leftMenu:clickSaveAsFormat(1025)']],
                /* Other formats… and Advanced settings: the stock panel of the "File" screen in its window;
                   the screen itself is not shown (no fileMenu:show). */
                ['file.downloadAs.more', 'file.downloadAs', ['stock:saveas panel shown', 'window:show("vo-saveas-dlg vo-win vo-win--saveas","Download As")']],
                ['app.settings', null, ['stock:settings panel shown', 'window:show("vo-settings-dlg vo-win vo-win--settings","Advanced Settings")']],
                ['view.firstPage', null, ['stock:click("btnFirstPage")']],
                ['view.lastPage', null, ['stock:click("btnLastPage")']],
                ['view.comments', null, ['stock:click("btnComments")']]
            ];
            for (const [path, sub, want] of cases) assert.deepEqual(await run(path, sub), want, path);
            /* Comments is a check: marked while the stock comments panel is open. */
            const mark = () => page.evaluate(() => {
                const a = shell.menuAdapter;
                return a.itemState(a.groups('more').find(it => it.k === 'view.comments')).checked;
            });
            assert.equal(await mark(), true, 'Comments is not marked while the panel is open');
            await run('view.comments', null);
            assert.equal(await mark(), false);
            /* Rename is a shell command: the title field takes the focus. */
            await run('file.rename', null);
            assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('vo-title')), true,
                'Rename does not put the focus into the title');
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('Other formats…, Document Info and Advanced settings are disabled until the stock File panels exist', async () => {
            const page = await H.open(browser, {comments: COMMENTS});
            const off = path => page.evaluate(k => document.querySelector(`#vo-tb .vo-mn-drop.open [data-k="${k}"], #vo-tb .vo-mn-fly [data-k="${k}"]`).getAttribute('aria-disabled'), path);
            const states = async () => {
                await openMore(page);
                const out = {info: await off('file.info'), settings: await off('app.settings')};
                await openSub(page, 'file.downloadAs');
                out.more = await off('file.downloadAs.more');
                return out;
            };
            /* The screen is not built yet: the stock code has no panels. */
            await page.evaluate(() => { window.panelsHeld = stock.fileMenu.panels; stock.fileMenu.panels = {}; stock.windows.length = 0; });
            assert.deepEqual(await states(), {info: 'true', settings: 'true', more: 'true'}, 'the items are enabled without the panels');
            const before = await page.evaluate(() => stock.windows.length);
            for (const [path, sub] of [['file.downloadAs.more', 'file.downloadAs'], ['app.settings', null], ['file.info', null]]) {
                await openMore(page);
                if (sub) await openSub(page, sub);
                await page.click(`#vo-tb [data-k="${path}"]`, {force: true});
                await H.settle(page);
            }
            assert.equal(await page.evaluate(() => stock.windows.length), before, 'a disabled item opened a window');
            /* The panels appear: the same menu opened again has the items enabled, and they open their windows. */
            await page.evaluate(() => { stock.fileMenu.panels = window.panelsHeld; });
            assert.deepEqual(await states(), {info: 'false', settings: 'false', more: 'false'}, 'the items stay disabled with the panels');
            for (const [path, sub, cls] of [['file.downloadAs.more', 'file.downloadAs', 'vo-saveas-dlg'], ['app.settings', null, 'vo-settings-dlg'], ['file.info', null, 'vo-docinfo-dlg']]) {
                await openMore(page);
                if (sub) await openSub(page, sub);
                await page.click(`#vo-tb [data-k="${path}"]`);
                await H.settle(page);
                const open = await page.evaluate(() => stock.windows.filter(w => w.$window).map(w => w.$window[0].className));
                assert.equal(open.length, 1, path + ': windows ' + JSON.stringify(open));
                assert.ok(open[0].split(/\s+/).includes(cls), path + ': ' + open[0]);
                await page.evaluate(() => stock.windows.forEach(w => w.$window && w.close()));
            }
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('⋮ > Document Info opens the shared window with the stock info panel', async () => {
            const page = await H.open(browser, {before: () => {
                const open = Common.UI.Compact.DocInfoWindow.open;
                window.opened = [];
                Common.UI.Compact.DocInfoWindow.open = function (o) { window.opened.push(o); return open.apply(this, arguments); };
            }});
            await openMore(page);
            await page.click('#vo-tb [data-k="file.info"]');
            const out = await page.evaluate(() => {
                const w = stock.windows[stock.windows.length - 1];
                const panel = document.getElementById('panel-info');
                return {calls: window.opened.length, stockPanel: window.opened[0] && window.opened[0].panel === stock.infoPanel,
                    windows: stock.windows.length, cls: w && w.$window[0].className, title: w && w.$window.find('.title').text(),
                    inWindow: !!(w && w.$window[0].querySelector('.body > .box') && w.$window[0].querySelector('.body > .box').contains(panel)),
                    shown: !stock.infoPanel.hidden, menu: shell.menu.isOpen(), stockText: PDFE.Views.FileMenuPanels.DocumentInfo.txtDocumentInfo};
            });
            assert.equal(out.calls, 1, 'DocInfoWindow.open is not called once');
            assert.equal(out.stockPanel, true, 'the window does not get the stock info panel');
            assert.equal(out.windows, 1);
            assert.match(out.cls, /(^|\s)vo-docinfo-dlg(\s|$)/, 'not the shared document info window: ' + out.cls);
            assert.match(out.cls, /(^|\s)vo-win--docinfo(\s|$)/, 'the window template is not put on: ' + out.cls);
            assert.equal(out.title, out.stockText, 'the window title');
            assert.equal(out.inWindow, true, 'the stock panel is not in the window');
            assert.equal(out.shown, true, 'the stock panel is not shown');
            assert.equal(out.menu, false, 'the menu stays open');
            await page.evaluate(() => stock.windows[0].close());
            assert.equal(await page.evaluate(() => document.getElementById('panel-info').parentNode.id), 'file-panels',
                'the stock panel does not go back to the File screen');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('⋮ > About opens the shared About window', async () => {
            const page = await H.open(browser);
            await openMore(page);
            await page.click('#vo-tb .vo-mn-drop.open [data-k="app.about"]');
            const out = await page.evaluate(() => {
                const w = stock.windows[stock.windows.length - 1];
                return {windows: stock.windows.length, own: w instanceof Common.UI.Compact.AboutWindow, cls: w && w.initConfig.cls,
                    title: w && w.initConfig.title, stockTitle: PDFE.Views.LeftMenu.tipAbout,
                    content: w && w.$window.find('.body .stock-about').length, close: w && w.$window.find('.tool.close .vo-air').length};
            });
            assert.equal(out.windows, 1);
            assert.equal(out.own, true, 'not the shared About window');
            assert.match(out.cls, /(^|\s)vo-about-dlg(\s|$)/);
            assert.equal(out.title, out.stockTitle, 'the window title is not the stock About caption');
            assert.equal(out.content, 1, 'the stock About content is not in the window');
            assert.equal(out.close, 1, 'the close button has no AIR glyph');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('the adapter reads the item state again right before it runs the item', async () => {
            const page = await H.open(browser);
            const out = await page.evaluate(() => {
                const a = shell.menuAdapter, Model = Common.UI.Compact.MenuModel;
                const all = [];
                const walk = items => items.forEach(it => { if (it.k) all.push(it); if (it.items) walk(Model.itemsOf(it, a.context())); });
                walk(a.groups('more'));
                const item = k => all.find(it => it.k === k);
                const first = item('view.firstPage'), rename = item('file.rename'), info = item('file.info');
                const clicks = () => stock.calls('stock', 'click').filter(c => c[0] === 'btnFirstPage').length;
                const res = {live: a.itemState(first).disabled, before: clicks()};
                /* Locked between the snapshot and the choice: the stock code turned the twin off. */
                stock.toolbar.btnFirstPage.setDisabled(true);
                res.locked = a.exec(first);
                res.lockedClicks = clicks();
                stock.toolbar.btnFirstPage.setDisabled(false);
                res.unlocked = a.exec(first);
                res.unlockedClicks = clicks();
                /* The right went away between the snapshot and the choice. */
                stock.main.appOptions.canRename = false;
                res.noRight = a.exec(rename);
                res.renames = document.activeElement && document.activeElement.classList.contains('vo-title');
                /* No connection: the network items are off. */
                stock.main._state.isDisconnected = true;
                res.offline = a.itemState(item('file.downloadAs.docx'));
                res.offlineRun = a.exec(item('file.downloadAs.docx'));
                res.saves = stock.calls('leftMenu', 'clickSaveAsFormat').length;
                res.infoStill = a.itemState(info).disabled;
                return res;
            });
            assert.equal(out.live, false, 'First page is off before the check');
            assert.equal(out.locked, false, 'a locked item reports a run');
            assert.equal(out.lockedClicks, out.before, 'a locked item is run');
            assert.equal(out.unlocked, true);
            assert.equal(out.unlockedClicks, out.before + 1, 'a live item is not run once');
            assert.equal(out.noRight, false, 'an item without its right is run');
            assert.equal(out.renames, false, 'rename without the right');
            assert.equal(out.offline.disabled, true);
            assert.equal(out.offline.reason, 'offline');
            assert.equal(out.offlineRun, false);
            assert.equal(out.saves, 0, 'a download while offline');
            assert.equal(out.infoStill, false, 'Document Info is off while offline');
            /* The same through the bar: the row turns grey on the click and runs nothing. */
            await page.evaluate(() => { stock.main._state.isDisconnected = false; stock.log.length = 0; });
            await openMore(page);
            await page.evaluate(() => stock.toolbar.btnFirstPage.setDisabled(true));
            await page.click('#vo-tb [data-k="view.firstPage"]', {force: true});
            assert.deepEqual(await page.evaluate(() => stock.calls('stock', 'click').filter(c => c[0] === 'btnFirstPage')), [], 'the menu runs a locked item');
            assert.equal(await page.evaluate(() => document.querySelector('#vo-tb [data-k="view.firstPage"]').getAttribute('aria-disabled')), 'true');
            await page.close();
        });

        await check('the menu subscribes to api:disconnect once, under the shell guard, however often it is rebuilt', async () => {
            const page = await H.open(browser, {before: () => {
                const guarded = shell.guarded;
                window.guardLabels = [];
                shell.guarded = (label, fn) => { window.guardLabels.push(label); return guarded(label, fn); };
            }});
            const handlers = () => page.evaluate(() => (Common.NotificationCenter._events['api:disconnect'] || []).length);
            const labels = () => page.evaluate(() => window.guardLabels.filter(l => l === 'menu: api:disconnect').length);
            assert.equal(await labels(), 1, 'the subscription of the first build is not under the guard');
            const before = await handlers();
            await page.evaluate(() => { shell.buildMenu(); shell.buildMenu(); });
            assert.equal(await handlers(), before, 'a rebuilt menu subscribes again');
            assert.equal(await labels(), 1, 'a rebuilt menu asks for a second guard');

            /* After the edit error the download stays, also in a menu built later. */
            const download = () => page.evaluate(() => {
                const a = shell.menuAdapter, Model = Common.UI.Compact.MenuModel;
                const find = items => items.reduce((r, it) => r || (it.k === 'file.downloadAs.docx' ? it : it.items ? find(Model.itemsOf(it, a.context())) : null), null);
                return a.itemState(find(a.groups('more'))).disabled;
            });
            await page.evaluate(() => { stock.main.stackDisableActions = {length: () => 1, get: () => ({type: 'disconnect', disable: true})}; });
            assert.equal(await download(), true, 'a broken session leaves Download as on');
            await page.evaluate(() => Common.NotificationCenter.trigger('api:disconnect', true));
            assert.equal(await download(), false, 'Download as is off after an edit error');
            await page.evaluate(() => shell.buildMenu());
            assert.equal(await download(), false, 'a rebuilt menu forgot the edit error');
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('an exception in the menu handler of api:disconnect does not cut off the next subscriber', async () => {
            const page = await H.open(browser, {before: () => {
                const guarded = shell.guarded;
                shell.guarded = (label, fn) => guarded(label, label === 'menu: api:disconnect' ? () => { throw new Error('boom'); } : fn);
                window.later = 0;
            }});
            await page.evaluate(() => {
                Common.NotificationCenter.on('api:disconnect', () => { window.later++; });
                Common.NotificationCenter.trigger('api:disconnect', true);
                Common.NotificationCenter.trigger('api:disconnect', true);
            });
            assert.equal(await page.evaluate(() => window.later), 2, 'the subscriber after the menu did not run');
            assert.equal(page.warnings.length, 1, 'one warning for a repeated failure: ' + JSON.stringify(page.warnings));
            assert.match(page.warnings[0], /^Compact shell: "menu: api:disconnect" failed/);
            assert.deepEqual(page.errors, []);
            await page.close();
        });
    } finally {
        await browser.close();
    }
    done();
})().catch(e => { console.log('FAIL run —', e && e.stack || e); process.exitCode = 1; });
