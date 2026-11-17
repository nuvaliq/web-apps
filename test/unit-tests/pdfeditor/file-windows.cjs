/* Run: node test/unit-tests/pdfeditor/file-windows.cjs [copies of shell modules or styles…]
 * The compact shell of the PDF viewer has no "File" screen. Print, Advanced settings and Download as
 * open as windows of the shared window template over the document, with the stock panel of the
 * screen inside (FileWindows): the print button of the bar and Ctrl+P open the print window; the print
 * window shows Print range, Pages and Content only (no page size, orientation or margins, no preview)
 * with Print and Print to PDF in its footer, which press the stock buttons — the stock print closes
 * the window, then prints; a wrong range keeps it open. Advanced settings shows what the viewer uses
 * (theme, comments, screen reader, default zoom, font hinting, keyboard shortcuts), Apply runs the
 * stock apply, Cancel closes. Download as shows the stock formats, a format downloads and closes it.
 * No stock way shows the "File" screen — F1, Alt+F, Ctrl+Shift+S, showMenu('file…') of any panel, the
 * screen shown past showMenu. A closed window
 * gives the panel back to the screen as it was. A panel the integrator turned off (the layout switches
 * toolbar-file-info and toolbar-file-settings, no print or download right) opens no window. When the stock
 * code hides the screen — the stock FileMenu.applyMode puts the screen into the print panel's menu field
 * again — the open window closes, once. The print window keeps the stock preview with a zero-size canvas.
 *
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH), see lib/shell-page.cjs: the
 * panels are the stock templates of FileMenuPanels.js. Texts are read from the page (English locale).
 * Optional arguments: copies of modules or styles (by file name: CompactShell.js, FileWindows.js,
 * compact-windows.less…) for a negative control.
 */
'use strict';

const assert = require('node:assert/strict');
const H = require('./lib/shell-page.cjs');

/* Windows open now: their classes, titles, footer buttons (text and kind) and what the box holds. */
const windows = page => page.evaluate(() => stock.windows.filter(w => w.$window).map(w => {
    const el = w.$window[0], box = el.querySelector('.body > .box');
    return {cls: el.className, title: el.querySelector('.title').textContent,
        footer: Array.from(el.querySelectorAll('.body > .footer .dlg-btn')).map(b => [b.textContent.trim(),
            b.classList.contains('primary') ? 'primary' : b.classList.contains('vo-btn-outline') ? 'outline' : 'plain']),
        panel: box && box.firstElementChild ? box.firstElementChild.id : null};
}));

/* The "File" screen: shown now, ever shown since the log was cleared. */
const screen = page => page.evaluate(() => ({shown: stock.fileMenu.visible, ever: stock.calls('fileMenu', 'show').length}));

/* The panel is back on the screen as it was: in its box, hidden, the screen as its menu. */
const home = (page, id, key) => page.evaluate(({id, key}) => {
    const p = stock[key];
    return {parent: p.el.parentNode && p.el.parentNode.id, menu: p.menu === stock.fileMenu};
}, {id, key});

const closeAll = page => page.evaluate(() => stock.windows.forEach(w => w.$window && w.close()));

/* Ids of the fields of a window shown to a person (they have a box on the screen). */
const shownIds = (page, selector) => page.evaluate(sel => {
    const w = document.querySelector('.asc-window');
    return w ? Array.from(w.querySelectorAll(sel)).filter(e => e.getClientRects().length > 0).map(e => e.id) : null;
}, selector);

const press = async (page, keys) => {
    await page.focus('#area_id');
    await page.keyboard.press(keys);
    await H.settle(page);
};

(async () => {
    const {check, done} = H.checker();
    const browser = await H.launch();
    try {
        await check('the print button of the bar and Ctrl+P open the print window over the document, not the "File" screen', async () => {
            const page = await H.open(browser);
            const ways = [
                ['the print button', () => page.click('#vo-tb [data-vo="print"]')],
                ['Ctrl+P', () => press(page, 'Control+p')]
            ];
            for (const [way, run] of ways) {
                await page.evaluate(() => { stock.log.length = 0; });
                await run();
                await H.settle(page);
                const open = await windows(page);
                assert.equal(open.length, 1, way + ': windows ' + JSON.stringify(open));
                assert.match(open[0].cls, /(^|\s)vo-print-dlg(\s|$)/, way + ': not the print window');
                assert.match(open[0].cls, /(^|\s)vo-win--print(\s|$)/, way + ': the window template is not put on');
                assert.equal(open[0].title, await page.evaluate(() => PDFE.Views.PrintWithPreview.txtPrint), way + ': the title');
                assert.equal(open[0].panel, 'panel-print', way + ': the stock print panel is not in the window');
                assert.deepEqual(await screen(page), {shown: false, ever: 0}, way + ': the "File" screen');
                assert.deepEqual(await page.evaluate(() => [stock.printPanel.hidden, stock.print.preview, stock.printPanel.menu === stock.fileMenu]),
                    [false, true, false], way + ': the panel is not shown or keeps the screen as its menu');
                /* Escape closes it: the panel goes home, the preview is closed the stock way. */
                await page.keyboard.press('Escape');
                assert.deepEqual(await windows(page), [], way + ': Escape does not close the window');
                assert.deepEqual(await home(page, 'panel-print', 'printPanel'), {parent: 'file-panels', menu: true}, way + ': the panel is not back');
                assert.deepEqual(await page.evaluate(() => stock.calls('print', 'closePrintPreview').length), 1, way + ': the preview is not closed');
            }
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('the print window: Print range, Pages and Content, then Print and Print to PDF in the footer', async () => {
            const page = await H.open(browser);
            await page.click('#vo-tb [data-vo="print"]');
            await H.settle(page);
            assert.deepEqual(await shownIds(page, '[id^="print-combo-"], #print-txt-pages'),
                ['print-combo-range', 'print-txt-pages', 'print-combo-content'], 'fields of the print window');
            const out = await page.evaluate(() => {
                const w = document.querySelector('.asc-window'), shown = e => !!e && e.getClientRects().length > 0;
                const body = w.querySelector('.body').getBoundingClientRect(), pad = parseFloat(getComputedStyle(w.querySelector('.body')).paddingLeft);
                const width = id => Math.round(w.querySelector('#' + id + ' > .combobox').getBoundingClientRect().width);
                return {
                    labels: Array.from(w.querySelectorAll('label.font-weight-bold')).filter(shown).map(l => l.textContent.trim()),
                    preview: shown(w.querySelector('#print-preview-box')), header: shown(w.querySelector('.main-header')),
                    stockButtons: shown(w.querySelector('#print-btn-print')) || shown(w.querySelector('#print-btn-print-pdf')),
                    width: Math.round(w.getBoundingClientRect().width), inner: Math.round(body.width - pad * 2),
                    range: width('print-combo-range'), content: width('print-combo-content'),
                    stock: [PDFE.Views.PrintWithPreview.txtPrintRange, PDFE.Views.PrintWithPreview.txtContent,
                        PDFE.Views.PrintWithPreview.txtPrint, PDFE.Views.PrintWithPreview.txtPrintPdf]
                };
            });
            assert.deepEqual(out.labels, out.stock.slice(0, 2), 'labels of the print window');
            assert.deepEqual([out.preview, out.header, out.stockButtons], [false, false, false], 'the preview, the panel title or the stock buttons are shown');
            assert.equal(out.width, 400, 'the width of the print window');
            assert.deepEqual([out.range, out.content], [out.inner, out.inner], 'the lists are not as wide as the window body');
            assert.deepEqual((await windows(page))[0].footer, [[out.stock[2], 'primary'], [out.stock[3], 'outline']], 'the footer');
            /* The footer buttons are the buttons of the template: Print filled, Print to PDF outline. */
            const look = await page.evaluate(() => Array.from(document.querySelectorAll('.asc-window .body > .footer .dlg-btn')).map(b => {
                const s = getComputedStyle(b);
                return [s.backgroundColor, s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth) > 0, Math.round(b.getBoundingClientRect().height)];
            }));
            assert.notEqual(look[0][0], look[1][0], 'Print and Print to PDF look the same');
            assert.equal(look[1][1], true, 'Print to PDF has no outline');
            assert.deepEqual(look.map(l => l[2]), [34, 34], 'the footer buttons are not md');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('the print and settings window rules keep :has() selectors apart from the simple ones', async () => {
            /* A browser without :has() drops a whole selector list that contains it: the simple selectors
               (the preview, the panel header, the duplicate buttons) must not share a rule with it. */
            const page = await H.open(browser);
            const rules = await page.evaluate(() => {
                const out = [];
                const walk = list => Array.from(list).forEach(r => {
                    if (r.cssRules && !r.selectorText) return walk(r.cssRules);
                    if (r.selectorText && /vo-win--(print|settings)/.test(r.selectorText)) out.push(r.selectorText);
                });
                Array.from(document.styleSheets).forEach(sh => walk(sh.cssRules));
                return out;
            });
            const mixed = rules.filter(t => {
                const parts = t.split(/,(?![^(]*\))/);
                return parts.some(x => x.includes(':has(')) && parts.some(x => !x.includes(':has('));
            });
            assert.deepEqual(mixed, [], 'a selector list mixes :has() with simple selectors');
            const plain = sel => rules.some(t => t.includes(sel) && !t.includes(':has('));
            assert.equal(plain('#print-preview-box'), true, 'the preview is not hidden by a rule without :has()');
            assert.equal(plain('tr.tab-style'), true, 'the tab style row is not hidden by a rule without :has()');
            assert.equal(rules.some(t => t.includes(':has(')), true, 'no :has() rule left in the print and settings windows');
            await page.close();
        });

        await check('Print presses the stock print: the window closes, then the engine prints; a wrong range keeps it open', async () => {
            const page = await H.open(browser);
            const printLog = () => page.evaluate(() => stock.log.filter(e => e.who === 'print' || (e.who === 'api' && /asc_Print|asc_DownloadAs/.test(e.what)) ||
                (e.who === 'window' && e.what === 'close')).map(e => e.who + ':' + e.what + (e.args.length && e.who === 'api' ? '(' + e.args[0] + ')' : '')));
            const footer = async n => page.click(`.asc-window .body > .footer .dlg-btn:nth-child(${n})`);

            await page.click('#vo-tb [data-vo="print"]');
            await page.evaluate(() => { stock.log.length = 0; });
            await footer(1);
            assert.deepEqual(await printLog(page), ['print:closePrintPreview', 'window:close', 'api:asc_Print(all)'], 'Print');
            assert.deepEqual(await windows(page), [], 'the window stays open after Print');
            assert.deepEqual(await home(page, 'panel-print', 'printPanel'), {parent: 'file-panels', menu: true}, 'the panel is not back after Print');
            assert.deepEqual(await screen(page), {shown: false, ever: 0}, 'the "File" screen');

            /* A wrong range: the stock check keeps the window, the focus goes into Pages. Enter is Print. */
            await page.click('#vo-tb [data-vo="print"]');
            await page.evaluate(() => {
                stock.log.length = 0;
                document.querySelector('.asc-window #print-combo-range input').setAttribute('data-value', 'custom');
            });
            await footer(1);
            assert.deepEqual(await printLog(page), ['print:invalid range'], 'a wrong range');
            assert.equal((await windows(page)).length, 1, 'a wrong range closes the window');
            assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.closest('#print-txt-pages') !== null), true,
                'the focus is not in Pages');
            await page.keyboard.type('2-3');
            await page.keyboard.press('Enter');
            assert.deepEqual(await printLog(page), ['print:invalid range', 'print:closePrintPreview', 'window:close', 'api:asc_Print(2-3)'], 'Enter');

            /* Print to PDF: the stock download of the print. */
            await page.click('#vo-tb [data-vo="print"]');
            await page.evaluate(() => {
                stock.log.length = 0;
                document.querySelector('.asc-window #print-combo-range input').setAttribute('data-value', 'all');
            });
            await footer(2);
            assert.deepEqual(await printLog(page), ['print:closePrintPreview', 'window:close', 'api:asc_DownloadAs(all)'], 'Print to PDF');
            assert.deepEqual(await screen(page), {shown: false, ever: 0}, 'the "File" screen');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('no stock way shows the "File" screen; the panels open as their windows', async () => {
            const page = await H.open(browser, {comments: [{text: 'Note'}]});
            const ways = [
                ['F1', () => press(page, 'F1'), null],
                ['Alt+F', () => press(page, 'Alt+f'), null],
                ['Ctrl+Shift+S', () => press(page, 'Control+Shift+s'), 'vo-saveas-dlg'],
                ['showMenu file', () => page.evaluate(() => stock.leftMenu.leftMenu.showMenu('file')), null],
                ['showMenu file:help', () => page.evaluate(() => stock.leftMenu.leftMenu.showMenu('file:help')), null],
                ['showMenu file:rights', () => page.evaluate(() => stock.leftMenu.leftMenu.showMenu('file:rights')), null],
                ['showMenu file:printpreview', () => page.evaluate(() => stock.leftMenu.leftMenu.showMenu('file:printpreview')), 'vo-print-dlg'],
                ['showMenu file:opts', () => page.evaluate(() => stock.leftMenu.leftMenu.showMenu('file:opts')), 'vo-settings-dlg'],
                ['showMenu file:saveas', () => page.evaluate(() => stock.leftMenu.leftMenu.showMenu('file:saveas')), 'vo-saveas-dlg'],
                ['showMenu file:info', () => page.evaluate(() => stock.leftMenu.leftMenu.showMenu('file:info')), 'vo-docinfo-dlg']
            ];
            for (const [way, run, want] of ways) {
                await page.evaluate(() => { stock.log.length = 0; });
                await run();
                await H.settle(page);
                assert.deepEqual(await screen(page), {shown: false, ever: 0}, way + ': the "File" screen is shown');
                const open = await windows(page);
                assert.deepEqual(open.map(w => (w.cls.match(/vo-\w+-dlg/) || [w.cls])[0]), want ? [want] : [], way + ': windows');
                await closeAll(page);
            }
            /* The stock code shows the screen past showMenu: the shell closes it at once, the stock way. */
            await page.evaluate(() => { stock.log.length = 0; stock.fileMenu.show('saveas'); });
            await H.settle(page);
            assert.equal((await screen(page)).shown, false, 'the screen shown past showMenu stays');
            assert.equal(await page.evaluate(() => stock.calls('fileMenu', 'hide').length), 1, 'the screen is not closed by its hide');
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('Advanced settings: what the viewer uses; Apply runs the stock apply, Cancel closes', async () => {
            const page = await H.open(browser);
            await page.click('#vo-tb [data-vo="more"]');
            await page.click('#vo-tb .vo-mn-drop.open [data-k="app.settings"]');
            await H.settle(page);
            const open = await windows(page);
            assert.equal(open.length, 1);
            assert.match(open[0].cls, /(^|\s)vo-settings-dlg(\s|$)/);
            assert.match(open[0].cls, /(^|\s)vo-win--settings(\s|$)/);
            assert.equal(open[0].panel, 'panel-settings', 'the stock settings panel is not in the window');
            const stockText = await page.evaluate(() => {
                const S = PDFE.Views.FileMenuPanels.Settings;
                return {title: S.txtAdvancedSettings, apply: S.okButtonText, cancel: Common.UI.Window && Common.UI.Window.cancelButtonText || 'Cancel',
                    groups: [S.txtCollaboration, S.txtAppearance, S.txtWorkspace]};
            });
            assert.equal(open[0].title, stockText.title, 'the title');
            assert.deepEqual(open[0].footer, [[stockText.apply, 'primary'], ['Cancel', 'plain']], 'the footer');
            assert.deepEqual(await shownIds(page, '[id^="fms-cmb-"], [id^="fms-chb-"], [id^="fms-btn-"]'), [
                'fms-chb-live-comment', 'fms-chb-resolved-comment', 'fms-cmb-theme', 'fms-chb-dark-mode',
                'fms-chb-scrn-reader', 'fms-cmb-zoom', 'fms-cmb-font-render', 'fms-btn-keyboard-shortcuts'], 'fields of the settings window');
            const look = await page.evaluate(() => {
                const w = document.querySelector('.asc-window'), shown = e => e.getClientRects().length > 0;
                return {groups: Array.from(w.querySelectorAll('td.group-name label')).filter(shown).map(l => l.textContent.trim()),
                    header: shown(w.querySelector('.flex-settings > .header')),
                    apply: Array.from(w.querySelectorAll('#panel-settings .btn.primary')).some(shown)};
            });
            assert.deepEqual(look.groups, stockText.groups, 'the groups');
            assert.deepEqual([look.header, look.apply], [false, false], 'the panel title or its Apply is shown');
            await page.evaluate(() => { stock.log.length = 0; });
            await page.click('.asc-window .body > .footer .dlg-btn.primary');
            assert.deepEqual(await page.evaluate(() => stock.log.filter(e => /settings apply|applySettings|close/.test(e.what)).map(e => e.who + ':' + e.what)),
                ['stock:settings apply', 'leftMenu:applySettings', 'window:close'], 'Apply');
            assert.deepEqual(await windows(page), []);
            assert.deepEqual(await home(page, 'panel-settings', 'settingsPanel'), {parent: 'file-panels', menu: true}, 'the panel is not back');
            /* Cancel: closed, nothing applied. */
            await page.click('#vo-tb [data-vo="more"]');
            await page.click('#vo-tb .vo-mn-drop.open [data-k="app.settings"]');
            await page.evaluate(() => { stock.log.length = 0; });
            await page.click('.asc-window .body > .footer .dlg-btn:not(.primary)');
            assert.deepEqual(await windows(page), [], 'Cancel does not close');
            assert.equal(await page.evaluate(() => stock.calls('leftMenu', 'applySettings').length), 0, 'Cancel applies');
            assert.deepEqual(await screen(page), {shown: false, ever: 0}, 'the "File" screen');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('Download as: the stock formats in a window; a format downloads and closes it', async () => {
            const page = await H.open(browser);
            await press(page, 'Control+Shift+s');
            const open = await windows(page);
            assert.equal(open.length, 1);
            assert.match(open[0].cls, /(^|\s)vo-win--saveas(\s|$)/);
            assert.equal(open[0].title, await page.evaluate(() => PDFE.Views.FileMenu.btnDownloadCaption), 'the title');
            assert.deepEqual(open[0].footer, [], 'a footer');
            const tiles = await page.evaluate(() => {
                const w = document.querySelector('.asc-window'), shown = e => e.getClientRects().length > 0;
                const t = Array.from(w.querySelectorAll('.btn-doc-format')).filter(shown);
                const rows = new Set(t.map(e => Math.round(e.getBoundingClientRect().top)));
                return {count: t.length, rows: rows.size, size: t.map(e => [e.offsetWidth, e.offsetHeight])[0],
                    header: shown(w.querySelector('.content-container > .header'))};
            });
            assert.deepEqual(tiles, {count: 7, rows: 3, size: [70, 90], header: false}, 'the formats');
            await page.evaluate(() => { stock.log.length = 0; });
            await page.click('.asc-window .btn-doc-format[format="65"]');
            assert.deepEqual(await page.evaluate(() => stock.calls('leftMenu', 'clickSaveAsFormat')), [[65]], 'the format');
            assert.deepEqual(await windows(page), [], 'the window stays open');
            assert.deepEqual(await home(page, 'panel-saveas', 'saveasPanel'), {parent: 'file-panels', menu: true}, 'the panel is not back');
            assert.deepEqual(await screen(page), {shown: false, ever: 0}, 'the "File" screen');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('a panel the integrator turned off opens no window: info, settings, print, Download as', async () => {
            const cases = [
                ['toolbar-file-info is off', 'file:info', {}, 'toolbar-file-info'],
                ['toolbar-file-settings is off', 'file:opts', {}, 'toolbar-file-settings'],
                ['no print right', 'file:printpreview', {canPrint: false}, null],
                ['no download right', 'file:saveas', {canDownload: false}, null]
            ];
            for (const [what, menu, rights, off] of cases) {
                const page = await H.open(browser, {rights});
                await page.evaluate(off => {
                    Common.UI.LayoutManager = {isElementVisible: name => name !== off};
                    stock.log.length = 0;
                }, off);
                await page.evaluate(menu => stock.leftMenu.leftMenu.showMenu(menu), menu);
                await H.settle(page);
                assert.deepEqual(await windows(page), [], what + ': a window is open');
                assert.deepEqual(await screen(page), {shown: false, ever: 0}, what + ': the "File" screen');
                assert.equal(await page.evaluate(menu => PDFE.Views.FileWindows.route(menu), menu), null, what + ': route');
                assert.deepEqual(page.errors, [], what);
                /* The same page with the switch on: the window opens. */
                await page.evaluate(() => { Common.UI.LayoutManager = {isElementVisible: () => true}; stock.main.appOptions.canPrint = true; stock.main.appOptions.canDownload = true; });
                await page.evaluate(menu => stock.leftMenu.leftMenu.showMenu(menu), menu);
                await H.settle(page);
                assert.equal((await windows(page)).length, 1, what + ': the window does not open when it is on');
                await page.close();
            }
        });

        await check('the stock menu.hide of the File screen closes the open panel window, once', async () => {
            const page = await H.open(browser);
            /* FileMenu.applyMode: on setMode the screen goes into the panel's menu field again, over the twin. */
            await page.click('#vo-tb [data-vo="print"]');
            await H.settle(page);
            await page.evaluate(() => { stock.log.length = 0; stock.printPanel.menu = stock.fileMenu; });
            await page.click('.asc-window .body > .footer .dlg-btn:nth-child(1)');
            assert.deepEqual(await windows(page), [], 'Print leaves the window open');
            assert.deepEqual(await home(page, 'panel-print', 'printPanel'), {parent: 'file-panels', menu: true}, 'the panel is not back');
            assert.equal(await page.evaluate(() => stock.calls('print', 'closePrintPreview').length), 1, 'the preview is closed not once');
            assert.equal(await page.evaluate(() => stock.calls('fileMenu', 'hide').length), 1, 'the screen is hidden not once');
            assert.equal(await page.evaluate(() => Object.keys(PDFE.Views.FileWindows.opened).length), 0, 'the window is still registered');
            /* Another hide of the screen with no window: nothing happens. */
            await page.evaluate(() => stock.fileMenu.hide());
            assert.equal(await page.evaluate(() => stock.calls('print', 'closePrintPreview').length), 1, 'a hide without a window closes the preview again');

            /* Advanced settings: Apply ends with the same hide. A second opening does not subscribe again. */
            await page.click('#vo-tb [data-vo="more"]');
            await page.click('#vo-tb .vo-mn-drop.open [data-k="app.settings"]');
            await page.evaluate(() => { stock.log.length = 0; stock.settingsPanel.menu = stock.fileMenu; });
            await page.click('.asc-window .body > .footer .dlg-btn.primary');
            assert.deepEqual(await windows(page), [], 'Apply leaves the window open');
            assert.deepEqual(await home(page, 'panel-settings', 'settingsPanel'), {parent: 'file-panels', menu: true}, 'the settings panel is not back');
            assert.equal(await page.evaluate(() => (stock.fileMenu._events['menu:hide'] || []).filter(e => e.callback === PDFE.Views.FileWindows.watched.close).length), 1,
                'the windows listen to the screen not once');
            /* A window closed by hand after the swap: no error, the panel is back. */
            await page.click('#vo-tb [data-vo="print"]');
            await page.evaluate(() => { stock.printPanel.menu = stock.fileMenu; });
            await page.keyboard.press('Escape');
            assert.deepEqual(await windows(page), []);
            assert.deepEqual(await home(page, 'panel-print', 'printPanel'), {parent: 'file-panels', menu: true});
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('a window that fails to close does not keep the other windows or the stock subscribers of menu:hide', async () => {
            const page = await H.open(browser);
            const out = await page.evaluate(() => {
                const F = PDFE.Views.FileWindows;
                const print = F.open('printpreview'), settings = F.open('opts');
                const close = print.close;
                print.close = function () { close.apply(this, arguments); throw new Error('close failed'); };
                let later = 0;
                stock.fileMenu.on('menu:hide', () => { later++; });
                let thrown = null;
                try { stock.fileMenu.hide(); } catch (e) { thrown = String(e); }
                return {thrown, later, left: Object.keys(F.opened), open: stock.windows.filter(w => w.$window).length};
            });
            assert.equal(out.thrown, null, 'the exception reached the stock trigger');
            assert.equal(out.later, 1, 'the stock subscriber after ours is not called');
            assert.deepEqual(out.left, [], 'a window is still registered');
            assert.equal(out.open, 0, 'a window is still open');
            assert.equal(page.warnings.length, 1, 'warnings: ' + JSON.stringify(page.warnings));
            assert.match(page.warnings[0], /files: menu:hide/, 'the warning names the subscription');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('the print window keeps the stock preview, with no size: the engine gets an empty canvas', async () => {
            const page = await H.open(browser);
            await page.click('#vo-tb [data-vo="print"]');
            await H.settle(page);
            const preview = await page.evaluate(() => {
                const el = document.querySelector('.asc-window #print-preview');
                return {there: !!el, size: el ? [el.offsetWidth, el.offsetHeight] : null, shown: stock.print.preview};
            });
            assert.deepEqual(preview, {there: true, size: [0, 0], shown: true}, 'the preview node of the print window');
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('one window per panel: a second call gives the open window', async () => {
            const page = await H.open(browser);
            const same = await page.evaluate(() => {
                const F = PDFE.Views.FileWindows, a = F.open('printpreview'), b = F.open('printpreview');
                return a === b && stock.windows.filter(w => w.$window).length === 1;
            });
            assert.equal(same, true, 'a second print window');
            await page.close();
        });
    } finally {
        await browser.close();
    }
    done();
})().catch(e => { console.log('FAIL run —', e && e.stack || e); process.exitCode = 1; });
