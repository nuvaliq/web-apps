/* Run: node test/unit-tests/documenteditor/compact-download-modal-keys.cjs
 * Headless Chrome, real focus events. The compact Download menu turns the
 * editor keyboard off while the focus is in it and back on when the focus
 * leaves. A stock modal alert (Main.onError → Common.UI.alert) can appear
 * while the menu has the focus: it closes the menu and takes the focus, at
 * once or later through the deferred FocusManager. Until the alert is
 * closed the keyboard must stay with it — turning the editor keyboard on
 * makes the SDK focus its input (sdkjs/word/api.js asc_enableKeyEvents).
 * Production buildDownload and closeSurfaces are used; the modal handlers of
 * the Main controller (controller/Main.js:347–360), the modal counter
 * (Common.Utils.ModalWindow) and the SDK keyboard switch are fixtures.
 * Set PLAYWRIGHT_MODULE to the installed Playwright package when not in NODE_PATH.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const file = process.argv[2] || path.join(root, 'apps/documenteditor/main/app/view/CompactShell.js');

(async () => {
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    let passed = 0, failed = 0;
    try {
        const page = await browser.newPage({viewport: {width: 900, height: 600}});
        page.on('pageerror', error => console.error('Browser error:', error.message));

        async function setup() {
            /* Popover visibility as in compact-shell.less (.vo-pop-wrap). */
            await page.setContent(`<style>
                .vo-pop-wrap .vo-pop { display: none; } .vo-pop-wrap.open .vo-pop { display: block; }
                </style><div id="header"></div><button id="other">Other</button><textarea id="sdk-input"></textarea>`);
            for (const lib of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js', 'vendor/backbone/backbone.js'])
                await page.addScriptTag({path: path.join(root, lib)});
            await page.evaluate(() => {
                window.Common = {
                    NotificationCenter: _.extend({}, Backbone.Events),
                    Utils: {ModalWindow: (function () {
                        let count = 0;
                        return {show: () => { count++; }, close: () => { count--; }, isVisible: () => count > 0};
                    })()},
                    Views: {Header: {prototype: {tipDownload: 'Download'}}}
                };
                const item = (t) => ({t, i: 'file', run() {}});
                window.DE = {
                    Views: {DocumentActions: {
                        exportItems: () => ({docx: item('DOCX'), pdf: item('PDF'), odt: item('ODT'), print: item('Print')}),
                        itemLocked: () => false,
                        done() {}
                    }},
                    getController: () => ({})
                };
                window.define = (deps, factory) => factory({svg: () => ''});
            });
            await page.addScriptTag({content: fs.readFileSync(file, 'utf8')});
            await page.evaluate(() => {
                const shell = DE.Views.CompactShell;
                /* SDK keyboard switch: turning it on focuses the SDK input. */
                window.keyLog = [];
                shell.api = {
                    IsFocus: true,
                    asc_enableKeyEvents(value) {
                        keyLog.push(value);
                        if (this.IsFocus === value) return;
                        this.IsFocus = value;
                        if (value) document.getElementById('sdk-input').focus();
                    }
                };
                /* Main controller: the modal counter and the editor keyboard. */
                Common.NotificationCenter.on({
                    'modal:show': () => { Common.Utils.ModalWindow.show(); shell.api.asc_enableKeyEvents(false); },
                    'modal:close': dlg => {
                        dlg && dlg.isVisible() && Common.Utils.ModalWindow.close();
                        if (!Common.Utils.ModalWindow.isVisible()) shell.api.asc_enableKeyEvents(true);
                    }
                });
                /* Toolbar popovers close as CompactToolbar.closePopovers does. */
                shell.tb = {closeOverflow() {}, closePopovers() { $('.vo-cb, .vo-pop-wrap').removeClass('open'); }};
                shell.bindModalGuard();
                $('#header').append(shell.buildDownload());

                /* Common.UI.alert: modal:show before rendering (Window.js:822),
                   then the window and its focus — at once or deferred. */
                window.showAlert = deferred => {
                    const dlg = {visible: true, isVisible() { return this.visible; }};
                    Common.NotificationCenter.trigger('modal:show', dlg);
                    const $w = $('<div class="asc-window modal alert"><button id="alert-ok">OK</button></div>').appendTo(document.body);
                    const focus = () => $('#alert-ok').focus();
                    deferred ? setTimeout(focus, 50) : focus();
                    window.closeAlert = () => {
                        Common.NotificationCenter.trigger('modal:close', dlg);
                        dlg.visible = false;
                        $w.remove();
                    };
                };
            });
        }

        /* Focus on the first menu item, opened from the keyboard. */
        async function openMenu() {
            await page.focus('.vo-download > button');
            await page.keyboard.press('ArrowDown');
            const state = await page.evaluate(() => ({
                open: $('.vo-download').hasClass('open'),
                inItem: document.activeElement && document.activeElement.classList.contains('vo-pop-item'),
                keys: DE.Views.CompactShell.api.IsFocus
            }));
            assert.deepEqual(state, {open: true, inItem: true, keys: false}, 'menu open, focus in it, editor keyboard off');
            await page.evaluate(() => { keyLog.length = 0; });
        }

        const state = () => page.evaluate(() => ({
            open: $('.vo-download').hasClass('open'),
            active: document.activeElement && document.activeElement.id,
            keys: DE.Views.CompactShell.api.IsFocus,
            log: keyLog.slice()
        }));

        async function check(name, run) {
            try {
                await setup();
                await run();
                console.log('PASS', name);
                passed++;
            } catch (error) {
                console.error('FAIL', name, error.message);
                failed++;
            }
        }

        await check('alert focused at once keeps the keyboard while the menu closes', async () => {
            await openMenu();
            await page.evaluate(() => showAlert(false));
            await page.waitForTimeout(150);
            const s = await state();
            assert.equal(s.open, false, 'menu closed');
            assert.equal(s.active, 'alert-ok', 'focus stays in the alert');
            assert.equal(s.keys, false, 'editor keyboard stays off');
            assert(!s.log.includes(true), `keyboard turned on: ${JSON.stringify(s.log)}`);
        });

        await check('alert focused later by the focus manager keeps the keyboard', async () => {
            await openMenu();
            await page.evaluate(() => showAlert(true));
            await page.waitForTimeout(250);
            const s = await state();
            assert.equal(s.open, false, 'menu closed');
            assert.equal(s.active, 'alert-ok', 'focus stays in the alert');
            assert.equal(s.keys, false, 'editor keyboard stays off');
            assert(!s.log.includes(true), `keyboard turned on: ${JSON.stringify(s.log)}`);
        });

        await check('closing the alert gives the keyboard back to the editor', async () => {
            await openMenu();
            await page.evaluate(() => showAlert(true));
            await page.waitForTimeout(250);
            await page.evaluate(() => closeAlert());
            await page.waitForTimeout(100);
            const s = await state();
            assert.equal(s.keys, true, 'editor keyboard on after the alert');
        });

        await check('focus leaving the menu without a modal gives the keyboard back', async () => {
            await openMenu();
            await page.evaluate(() => document.getElementById('other').focus());
            await page.waitForTimeout(100);
            const s = await state();
            assert.equal(s.open, false, 'menu closed');
            assert.equal(s.keys, true, 'editor keyboard on');
        });

        await check('menu closed by another surface without a modal gives the keyboard back', async () => {
            await openMenu();
            await page.evaluate(() => { DE.Views.CompactShell.closeSurfaces(); document.activeElement.blur(); });
            await page.waitForTimeout(100);
            const s = await state();
            assert.equal(s.open, false, 'menu closed');
            assert.equal(s.keys, true, 'editor keyboard on');
        });
        console.log(`${passed} passed, ${failed} failed; Chrome ${browser.version()}`);
    } finally {
        await browser.close();
    }
    process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
