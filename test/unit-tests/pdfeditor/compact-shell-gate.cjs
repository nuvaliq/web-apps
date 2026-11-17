/* Run: node test/unit-tests/pdfeditor/compact-shell-gate.cjs [copies of shell modules…]
 * Frame of the compact shell of the PDF viewer: on strictly for editorConfig.ui.shell === 'modern'
 * (a failed read or a failed start is off), the shell record in Common.UI.Compact.Shells, the early
 * start class vo-boot on Gateway init and the shell heights on app:face, the loading skeleton kept
 * until the shell is built or the PDF fails to open, the start on app:ready with
 * tries until the editor is ready (20 tries, then the stock layout is back), a throwing build rolled
 * back to a working stock layout, the view mode held after the build and after every
 * pdf:mode-changed (deferred, only with canSwitchMode), no switch to the stock interface.
 *
 * The page goes through the shell wiring of controller/Viewport.js as it stands in its source.
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH), see lib/shell-page.cjs.
 * Optional arguments: copies of modules (by file name, e.g. a broken CompactShell.js) for a
 * negative control.
 */
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const H = require('./lib/shell-page.cjs');

const SHELL_H = 4 + 44 + 8;
/* Body classes of the built shell: a PDF without bookmarks starts with the navigation panel folded
   into its pill, and no panel of the left menu is open. */
const BUILT = ['vo-compact'];
const STOCK = {toolbar: 88, statusbar: 25};
/* The canvas of the pages as the engine paints it, and its colour in the theme of the stand. */
const THEME_CANVAS = 'rgb(243, 243, 243)';
const canvas = page => page.evaluate(() => getComputedStyle(document.getElementById('stand-viewer')).backgroundColor);

/* What the body and the tree show of the shell. */
const look = page => page.evaluate(() => ({
    classes: document.body.className.split(/\s+/).filter(c => c.indexOf('vo-') === 0).sort(),
    nodes: Array.from(document.querySelectorAll('[id^="vo-"]')).map(n => n.id),
    shell: !!document.getElementById('vo-shell'),
    cover: !!document.getElementById('vo-loading'),
    ribbon: document.getElementById('stock-ribbon').getClientRects().length > 0,
    status: document.getElementById('stock-status').getClientRects().length > 0,
    title: document.getElementById('app-title').getClientRects().length > 0,
    heights: stock.heights()
}));

/* The page has the stock layout and nothing of the shell. */
function assertStock(state, what) {
    assert.deepEqual(state.classes, [], what + ': shell classes on the body');
    assert.deepEqual(state.nodes, [], what + ': shell nodes in the tree');
    assert.equal(state.cover, false, what + ': the loading skeleton stays');
    assert.ok(state.ribbon && state.status && state.title, what + ': the stock ribbon, title or status bar is not shown');
    assert.deepEqual(state.heights.model, [STOCK.toolbar, STOCK.statusbar], what + ': stock heights of the layout items');
    assert.equal(state.heights.toolbar, STOCK.toolbar, what + ': stock toolbar height on the page');
    assert.equal(state.heights.statusbar, STOCK.statusbar, what + ': stock status bar height on the page');
}

/* Counts the build attempts of the shell. */
function countCreates() {
    const create = shell.create;
    window.creates = 0;
    shell.create = function () { window.creates++; return create.apply(this, arguments); };
}

const modeApplies = page => page.evaluate(() => stock.calls('stock', 'pdf:mode-apply').map(a => a[0]));
const flags = page => page.evaluate(() => [stock.main.appOptions.isPDFEdit, stock.main.appOptions.isPDFAnnotate]);

(async () => {
    const {check, done} = H.checker();
    const browser = await H.launch();
    try {
        await check('on only for ui.shell === "modern"', async () => {
            const page = await H.open(browser, {boot: 'none'});
            const out = await page.evaluate(() => {
                const rows = [];
                const value = v => ({ui: {shell: v}});
                const cases = [['modern', value('modern')], ['modern with other ui keys', {ui: {shell: 'modern', mode: 'compact'}}],
                    ['Modern', value('Modern')], ['MODERN', value('MODERN')], ['" modern"', value(' modern')],
                    ['"modern "', value('modern ')], ['legacy', value('legacy')], ['compact', value('compact')],
                    ['empty', value('')], ['null', value(null)], ['true', value(true)], ['object', value({})],
                    ['no shell key', {ui: {mode: 'compact'}}], ['no ui', {}], ['no config', undefined],
                    ['throwing read', {get ui() { throw new Error('config read failed'); }}]];
                cases.forEach(([name, cfg]) => {
                    stock.main.editorConfig = cfg;
                    let asMain, asInit;
                    try { asMain = shell.wanted(); } catch (e) { asMain = 'threw ' + e.message; }
                    try { asInit = shell.wanted(cfg); } catch (e) { asInit = 'threw ' + e.message; }
                    rows.push([name, asMain, asInit]);
                });
                return rows;
            });
            for (const [name, asMain, asInit] of out) {
                const want = name.startsWith('modern');
                assert.equal(asMain, want, name + ': wanted() over the Main config');
                assert.equal(asInit, want, name + ': wanted(config) over the init config');
            }
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('without "modern" the editor starts stock', async () => {
            for (const config of [{ui: {shell: 'classic'}}, {ui: {shell: 'Modern'}}, {}]) {
                const page = await H.open(browser, {config, boot: 'none'});
                await page.evaluate(() => stock.init());
                assert.deepEqual((await look(page)).classes, [], JSON.stringify(config) + ': a class on Gateway init');
                await page.evaluate(() => { stock.face(); stock.ready(); });
                await H.settle(page);
                assertStock(await look(page), JSON.stringify(config));
                assert.equal(await page.evaluate(() => Common.UI.Compact.Shells.current()), null, 'the registry picks a shell');
                assert.deepEqual(page.errors, []);
                assert.deepEqual(page.warnings, []);
                await page.close();
            }
        });

        await check('the shell is recorded in Common.UI.Compact.Shells', async () => {
            const page = await H.open(browser, {boot: 'none'});
            const out = await page.evaluate(() => {
                const picked = Common.UI.Compact.Shells.current();
                const res = {picked: !!picked, wanted: picked && picked.wanted(), byConfig: picked && picked.wanted({ui: {shell: 'modern'}})};
                stock.main.editorConfig = {ui: {shell: 'classic'}};
                res.after = Common.UI.Compact.Shells.current();
                res.registered = picked ? picked.wanted({ui: {shell: 'modern'}}) : null;
                return res;
            });
            assert.equal(out.picked, true, 'the viewer shell is not in the registry');
            assert.equal(out.wanted, true);
            assert.equal(out.byConfig, true);
            assert.equal(out.after, null, 'the registry keeps the shell when the config is no longer "modern"');
            assert.equal(out.registered, true, 'the record reads the config at the moment of the question');
            await page.close();
        });

        await check('early start: vo-boot on Gateway init, shell heights on app:face, shell on app:ready', async () => {
            const page = await H.open(browser, {boot: 'none'});
            assert.deepEqual((await look(page)).classes, [], 'a class before Gateway init');
            /* Main takes the config later than the shell hears Gateway init. */
            await page.evaluate(() => { const cfg = stock.main.editorConfig; stock.main.editorConfig = undefined; stock.init(); stock.init(); stock.main.editorConfig = cfg; });
            let state = await look(page);
            assert.deepEqual(state.classes, ['vo-boot'], 'the early start class from the init config');
            assert.equal(state.ribbon || state.title || state.status, false, 'the stock chrome is shown under vo-boot');
            await page.evaluate(() => stock.face());
            state = await look(page);
            assert.deepEqual(state.heights.model, [SHELL_H, 0], 'shell heights on app:face');
            assert.equal(state.heights.toolbar, SHELL_H);
            assert.equal(state.shell, false, 'the shell is built before app:ready');
            await page.evaluate(() => stock.ready());
            await page.waitForFunction(() => !!document.getElementById('vo-shell'));
            await H.settle(page);
            state = await look(page);
            assert.deepEqual(state.classes, BUILT, 'vo-boot stays after the build');
            assert.deepEqual(state.heights.model, [SHELL_H, 0]);
            assert.equal(state.heights.toolbar, SHELL_H);
            assert.equal(state.ribbon || state.title || state.status, false, 'the stock chrome is shown under the shell');
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('loading skeleton: kept from the stock under another id until the shell is built', async () => {
            const covers = page => page.evaluate(() => [document.getElementById('loading-mask') ? 'stock' : '', document.getElementById('vo-loading') ? 'held' : ''].join(''));
            const plain = await H.open(browser, {config: {ui: {shell: 'classic'}}, boot: 'none'});
            await plain.evaluate(() => stock.init());
            assert.equal(await covers(plain), 'stock', 'without the shell the skeleton keeps its id');
            await plain.evaluate(() => stock.face());
            assert.equal(await covers(plain), '', 'without the shell the stock removes it as before');
            await plain.close();

            const page = await H.open(browser, {boot: 'none'});
            assert.equal(await covers(page), 'stock');
            await page.evaluate(() => { stock.init(); stock.init(); });
            assert.equal(await covers(page), 'held', 'the shell takes the skeleton from the stock lookup');
            await page.evaluate(() => stock.face());
            assert.equal(await covers(page), 'held', 'app:face does not take it');
            assert.equal((await look(page)).classes.includes('vo-boot'), true);
            await page.evaluate(() => stock.ready());
            await page.waitForFunction(() => !!document.getElementById('vo-shell'));
            await H.settle(page);
            assert.equal(await covers(page), '', 'the frame the shell appears in takes it');
            assert.deepEqual((await look(page)).classes, BUILT);
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();

            const bare = await H.open(browser, {boot: 'none'});
            await bare.evaluate(() => $('#loading-mask').remove());
            await bare.evaluate(() => { stock.init(); stock.face(); shell.endBoot(true); });
            assertStock(await look(bare), 'with no skeleton on the page');
            assert.deepEqual(bare.errors, []);
            await bare.close();
        });

        await check('loading skeleton: the stock loading plate is hidden while the request stands', async () => {
            const page = await H.open(browser, {boot: 'none'});
            const plate = () => page.evaluate(() => {
                const n = document.querySelector('.asc-loadmask');
                return [n.getClientRects().length > 0, n.firstChild.getClientRects().length > 0];
            });
            await page.evaluate(() => {
                const mask = document.createElement('div');
                mask.className = 'asc-loadmask';
                mask.style.cssText = 'width: 40px; height: 20px';
                mask.innerHTML = '<div class="asc-loadmask-body" style="width: 20px; height: 10px"></div>';
                document.body.appendChild(mask);
            });
            assert.deepEqual(await plate(), [true, true], 'the plate shows without the request');
            await page.evaluate(() => { stock.init(); stock.face(); });
            assert.deepEqual(await plate(), [false, false], 'the plate is hidden while the request stands');
            await page.evaluate(() => stock.ready());
            await page.waitForFunction(() => !!document.getElementById('vo-shell'));
            await H.settle(page);
            assert.deepEqual(await plate(), [true, true], 'the plate is the stock business after the build');
            await page.close();
        });

        /* An opening error comes before app:ready, and no app:ready follows it: the error itself has to
           take the skeleton and the request, otherwise the stock window hangs over the skeleton and
           the stock interface under it stays hidden. */
        const subscribe = () => {
            window.errorSubscriptions = 0;
            const register = stock.api.asc_registerCallback;
            stock.api.asc_registerCallback = function (name) {
                if (name === 'asc_onError') window.errorSubscriptions++;
                return register.apply(this, arguments);
            };
        };

        await check('loading skeleton: an opening error after app:face takes it and the request', async () => {
            const page = await H.open(browser, {boot: 'none', before: subscribe});
            await page.evaluate(() => { stock.init(); stock.init(); stock.face(); });
            let state = await look(page);
            assert.equal(await page.evaluate(() => window.errorSubscriptions), 1, 'one error subscription per session');
            assert.equal(state.cover, true, 'the skeleton stands before the error');
            assert.deepEqual(state.classes, ['vo-boot']);
            assert.deepEqual(state.heights.model, [SHELL_H, 0], 'the skeleton heights are on');
            await page.evaluate(() => stock.fire('asc_onError', -4, 2));
            await H.settle(page);
            assertStock(await look(page), 'after the opening error');
            await page.evaluate(() => stock.fire('asc_onError', -4, 2));
            assertStock(await look(page), 'after a second error');
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('loading skeleton: an opening error before app:face; a load that reaches app:ready gets the shell', async () => {
            const page = await H.open(browser, {boot: 'none'});
            await page.evaluate(() => { stock.init(); stock.fire('asc_onError', -4, 2); });
            assertStock(await look(page), 'after the error before app:face');
            await page.evaluate(() => stock.face());
            assertStock(await look(page), 'after a late app:face');
            await page.evaluate(() => stock.ready());
            await page.waitForFunction(() => !!document.getElementById('vo-shell'));
            await H.settle(page);
            const state = await look(page);
            assert.deepEqual(state.classes, BUILT, 'a load that reaches app:ready gets the shell');
            assert.equal(state.cover, false);
            assert.deepEqual(state.heights.model, [SHELL_H, 0]);
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('loading skeleton: an error after the shell is built is the stock business', async () => {
            const page = await H.open(browser);
            const before = await look(page);
            assert.deepEqual(before.classes, BUILT);
            await page.evaluate(() => stock.fire('asc_onError', -4, 2));
            await H.settle(page);
            const state = await look(page);
            assert.deepEqual(state.classes, BUILT, 'the shell classes stay');
            assert.deepEqual(state.nodes, before.nodes, 'the shell nodes stay');
            assert.deepEqual(state.heights.model, [SHELL_H, 0], 'the layout stays');
            assert.equal(state.heights.toolbar, SHELL_H);
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('loading skeleton: a failing error handler does not cut off the other error callbacks', async () => {
            const page = await H.open(browser, {boot: 'none'});
            await page.evaluate(() => {
                window.later = 0;
                stock.init();
                stock.api.asc_registerCallback('asc_onError', () => { window.later++; });
                shell.endBoot = () => { throw new Error('end failed'); };
                stock.fire('asc_onError', -4, 2);
            });
            assert.equal(await page.evaluate(() => window.later), 1, 'the callback after ours did not run');
            assert.equal(page.warnings.length, 1, 'warnings: ' + JSON.stringify(page.warnings));
            assert.match(page.warnings[0], /^Compact shell: "shell: error before the build" failed/);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('loading skeleton: an engine without callbacks starts the request without an exception', async () => {
            const page = await H.open(browser, {boot: 'none', before: () => { stock.api.asc_registerCallback = undefined; }});
            await page.evaluate(() => stock.init());
            const state = await look(page);
            assert.deepEqual(state.classes, ['vo-boot']);
            assert.equal(state.cover, true);
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('app:ready without "modern" in the Main config ends the early start', async () => {
            const page = await H.open(browser, {boot: 'none'});
            await page.evaluate(() => { stock.init(); stock.face(); stock.main.editorConfig = {ui: {}}; stock.ready(); });
            await H.settle(page);
            assertStock(await look(page), 'after app:ready');
            await page.close();
        });

        await check('start tries again until the editor is ready', async () => {
            const page = await H.open(browser, {boot: 'none', before: countCreates});
            /* Not ready: Main has no appOptions yet. */
            await page.evaluate(() => { window.options = stock.main.appOptions; stock.main.appOptions = null; stock.boot(); });
            await page.waitForFunction(() => window.creates >= 3, null, {timeout: 2000});
            let state = await look(page);
            assert.equal(state.shell, false, 'a shell over an editor that is not ready');
            assert.deepEqual(state.classes, ['vo-boot'], 'the early start class is dropped while tries go on');
            assert.equal(state.cover, true, 'the loading skeleton goes while tries go on');
            await page.evaluate(() => { stock.main.appOptions = window.options; });
            await page.waitForFunction(() => !!document.getElementById('vo-shell'), null, {timeout: 2000});
            const tries = await page.evaluate(() => window.creates);
            await page.waitForTimeout(500);
            assert.equal(await page.evaluate(() => window.creates), tries, 'tries go on after the shell is built');
            assert.ok(tries >= 4 && tries < 20, 'tries: ' + tries);
            state = await look(page);
            assert.deepEqual(state.classes, BUILT);
            assert.equal(state.cover, false, 'the loading skeleton stays after the build');
            assert.deepEqual(state.heights.model, [SHELL_H, 0]);
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('twenty tries, then the stock layout is back', async () => {
            const page = await H.open(browser, {boot: 'none', before: countCreates});
            await page.evaluate(() => { stock.main.appOptions = null; stock.boot(); });
            /* 20 tries 150 ms apart, and a margin to see that no try comes after the last one. */
            await page.waitForTimeout(20 * 150 + 900);
            assert.equal(await page.evaluate(() => window.creates), 20, 'the number of tries');
            assertStock(await look(page), 'after the last try');
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        const failures = [
            ['the menu bar fails', () => { Common.UI.Compact.MenuBar.create = () => { throw new Error('menu bar failed'); }; }],
            ['the last step fails after the layout is taken', () => {
                window.holdView = shell.holdView;
                shell.holdView = function () { throw new Error('view hold failed'); };
            }]
        ];
        for (const [what, breakIt] of failures) {
            await check('throwing build rolls back to a working stock layout: ' + what, async () => {
                const page = await H.open(browser, {boot: 'none', rights: {canSwitchMode: true}, before: [
                    'window.later = 0;',
                    'Common.NotificationCenter.on("app:ready", function () { window.later++; });',
                    '(' + countCreates + ')();',
                    '(' + breakIt + ')();'].join('\n')});
                await page.evaluate(() => stock.boot());
                await page.waitForTimeout(500);
                await H.settle(page);
                const state = await look(page);
                assertStock(state, 'after the rollback');
                /* The engine paints the canvas in the colours of the theme again. */
                assert.equal(await canvas(page), THEME_CANVAS, 'the engine keeps the field colour after the rollback');
                const out = await page.evaluate(() => ({creates: window.creates, failed: shell.startupFailed, wanted: shell.wanted(),
                    current: Common.UI.Compact.Shells.current(), later: window.later}));
                assert.equal(out.creates, 1, 'the build is tried again after a throw');
                assert.equal(out.failed, true);
                assert.equal(out.wanted, false, 'the shell is still wanted after a failed start');
                assert.equal(out.current, null, 'the registry still picks the failed shell');
                assert.equal(out.later, 1, 'a later app:ready subscriber did not run');
                assert.equal(page.warnings.length, 1, 'warnings: ' + JSON.stringify(page.warnings));
                assert.match(page.warnings[0], /^Compact shell: "shell: start" failed/);
                assert.deepEqual(page.errors, []);
                /* The shell is silent after the rollback: a stock mode change and a theme change go by. */
                await page.evaluate(() => {
                    if (window.holdView) shell.holdView = window.holdView;
                    Common.NotificationCenter.trigger('pdf:mode-apply', 'edit');
                    Common.NotificationCenter.trigger('uitheme:changed');
                    Common.NotificationCenter.trigger('app:ready');
                });
                await page.waitForTimeout(400);
                assert.deepEqual(await modeApplies(page), ['edit'], 'the rolled back shell holds the view mode');
                assert.deepEqual(await flags(page), [true, false]);
                assertStock(await look(page), 'after later notifications');
                assert.equal(await canvas(page), THEME_CANVAS, 'the canvas after later notifications');
                assert.equal(await page.evaluate(() => window.creates), 1, 'a second app:ready builds the shell again');
                assert.equal(page.warnings.length, 1, 'warnings after the rollback: ' + JSON.stringify(page.warnings));
                await page.close();
            });
        }

        await check('view mode is held after the build', async () => {
            for (const rights of [{isPDFEdit: true, canSwitchMode: true}, {isPDFAnnotate: true, canSwitchMode: true}]) {
                const page = await H.open(browser, {rights});
                assert.deepEqual(await modeApplies(page), ['view'], JSON.stringify(rights) + ': the shell does not put View');
                assert.deepEqual(await flags(page), [false, false], JSON.stringify(rights) + ': the document is not in View');
                await page.close();
            }
            for (const rights of [{isPDFEdit: true, canSwitchMode: false}, {isPDFAnnotate: true}, {canSwitchMode: true}]) {
                const page = await H.open(browser, {rights});
                assert.deepEqual(await modeApplies(page), [], JSON.stringify(rights) + ': a mode request without reason');
                await page.close();
            }
        });

        await check('view mode is held after every pdf:mode-changed, deferred', async () => {
            const page = await H.open(browser, {rights: {canSwitchMode: true}});
            const now = await page.evaluate(() => {
                Common.NotificationCenter.trigger('pdf:mode-apply', 'edit');
                return [stock.calls('stock', 'pdf:mode-apply').map(a => a[0]), stock.main.appOptions.isPDFEdit];
            });
            assert.deepEqual(now, [['edit'], true], 'View is put within the stock mode change, not after it');
            await H.settle(page);
            assert.deepEqual(await modeApplies(page), ['edit', 'view']);
            assert.deepEqual(await flags(page), [false, false]);
            await page.evaluate(() => Common.NotificationCenter.trigger('pdf:mode-apply', 'comment'));
            await H.settle(page);
            assert.deepEqual(await modeApplies(page), ['edit', 'view', 'comment', 'view']);
            assert.deepEqual(await flags(page), [false, false]);
            await page.close();

            /* Without canSwitchMode the stock code does not switch: the shell does not ask. */
            const fixed = await H.open(browser, {rights: {isPDFEdit: true, canSwitchMode: false}});
            await fixed.evaluate(() => Common.NotificationCenter.trigger('pdf:mode-changed', stock.main.appOptions));
            await H.settle(fixed);
            assert.deepEqual(await modeApplies(fixed), []);
            assert.deepEqual(fixed.errors, []);
            await fixed.close();
        });

        await check('the shell has no stock interface switch: no command, no way back, no class', async () => {
            const page = await H.open(browser, {rights: {canSwitchMode: true}});
            const state = await page.evaluate(() => ({
                command: shell.hasCommand('stockInterface'),
                back: !!document.getElementById('vo-back'),
                classes: Array.from(document.body.classList).filter(c => /^vo-/.test(c)),
                toggle: typeof shell.toggleMode,
                advanced: shell.advanced
            }));
            assert.deepEqual(state, {command: false, back: false, classes: BUILT, toggle: 'undefined', advanced: false});
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('the viewport controller loads the shell', async () => {
            const src = fs.readFileSync(H.VIEWPORT, 'utf8');
            const deps = /define\(\[([\s\S]*?)\]/.exec(src);
            assert.ok(deps && /'pdfeditor\/main\/app\/view\/CompactShell'/.test(deps[1]), 'CompactShell is not a dependency of the viewport controller');
            const wiring = H.viewportWiring();
            assert.match(wiring, /Common\.Gateway\.on\('init', shell\.guarded\(/, 'Gateway init is not guarded');
            assert.match(wiring, /Common\.NotificationCenter\.on\('app:ready', shell\.guarded\(/, 'app:ready is not guarded');
        });
    } finally {
        await browser.close();
    }
    done();
})().catch(e => { console.log('FAIL run —', e && e.stack || e); process.exitCode = 1; });
