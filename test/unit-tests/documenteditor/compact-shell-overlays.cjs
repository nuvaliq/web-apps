/* Run after the document editor LESS build: node test/unit-tests/documenteditor/compact-shell-overlays.cjs
 * COMPACT_CSS_DOCUMENTEDITOR (or COMPACT_CSS) names the compiled app.css.
 * What the compact shell lays over the document: the header hint with its two buttons while the caret is in a
 * header or a footer. Focus mode only collapses the header and menu: it has no panel of its own and does not
 * show the outline rail over the text.
 * The shell, the catalog, the menu bar and the rail are the real modules in headless Chrome
 * (fixtures/compact-shell-page.cjs); the engine and the stock window classes are stand-ins.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const shellPage = require('./fixtures/compact-shell-page.cjs');

function stylesheet() {
    const file = process.env.COMPACT_CSS_DOCUMENTEDITOR || process.env.COMPACT_CSS;
    if (!file || !fs.existsSync(file))
        throw new Error('set COMPACT_CSS_DOCUMENTEDITOR to app.css of the document editor LESS build');
    return fs.readFileSync(file, 'utf8');
}

(async () => {
    const css = stylesheet();
    const browser = await shellPage.launch();
    const {check, done} = shellPage.checker();
    const visible = (page, selector) => page.evaluate(selector => {
        const el = document.querySelector(selector);
        return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    }, selector);
    const apiCalls = (page, name) => page.evaluate(name => ctx.log.filter(e => e.api === name).map(e => e.args), name);
    try {
        await check('no focus panel is built in the compact shell', async () => {
            const page = await shellPage.open(browser);
            await page.evaluate(() => shell.toggleFocus());
            await shellPage.settle(page);
            assert.equal(await page.evaluate(() => shell.topHidden()), true);
            assert.equal(await page.evaluate(() => !!document.getElementById('vo-focus-bar')), false);
            assert.deepEqual(await page.evaluate(() => ['buildFocusBar', 'syncFocusBar', 'syncFocusZoom', 'toggleFocusOutline',
                'enterFocus', 'leaveFocus'].filter(name => name in shell)), []);
            /* The toolbar stays the way out: its chevron, not a panel of its own. */
            assert.equal(await visible(page, '#vo-tb'), true);
            const source = fs.readFileSync(path.join(shellPage.ROOT, 'apps/documenteditor/main/app/view/CompactShell.js'), 'utf8');
            assert.equal(/vo-focus-bar|vo-fb-/.test(source), false, 'the shell has no focus panel markup');
            assert.equal(/#vo-focus-bar|\.vo-fb-/.test(css), false, 'the styles have no focus panel');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('outline rail has no overlay mode', async () => {
            const page = await shellPage.open(browser);
            assert.deepEqual(await page.evaluate(() => ['overlay', 'overlayOpened', 'setOverlay'].filter(name => name in rail)), []);
            /* Collapsing the header and menu leaves the rail where it was, folded or open. */
            for (const folded of [false, true]) {
                if (folded) await page.evaluate(() => rail.toggle());
                const before = await page.evaluate(() => rail.open);
                await page.evaluate(() => shell.toggleFocus());
                await shellPage.settle(page);
                assert.equal(await page.evaluate(() => rail.open), before);
                assert.equal(await visible(page, '#vo-outline .vo-outline-toggle'), true, 'the rail stays on the screen');
                assert.equal(await page.evaluate(() => document.body.classList.contains('vo-outline-overlay')), false);
                await page.evaluate(() => shell.toggleFocus());
                await shellPage.settle(page);
                assert.equal(await page.evaluate(() => rail.open), before);
            }
            assert.equal(/vo-outline-overlay/.test(css), false, 'no styles of the rail over the text');
            const source = fs.readFileSync(path.join(shellPage.ROOT, 'apps/documenteditor/main/app/view/OutlineRail.js'), 'utf8');
            assert.equal(/setOverlay|overlayOpened|vo-outline-overlay/.test(source), false, 'the rail source has no overlay mode');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('focus panel texts are absent from the ru and en locales', async () => {
            const keys = ['textFocusBar_ARIA', 'textFocusExit', 'textFocusOutline', 'tipZoomIn', 'tipZoomOut']
                .map(k => 'DE.Views.CompactShell.' + k);
            for (const lang of ['en', 'ru']) {
                const locale = JSON.parse(fs.readFileSync(path.join(shellPage.ROOT,
                    'apps/documenteditor/main/locale', lang + '.json'), 'utf8'));
                assert.deepEqual(keys.filter(k => k in locale), [], lang);
            }
            const page = await shellPage.open(browser);
            assert.deepEqual(await page.evaluate(keys => keys.map(k => k.split('.').pop()).filter(k => k in shell), keys), []);
            await page.close();
        });

        await check('header hint appears only while editing a header', async () => {
            const page = await shellPage.open(browser);
            assert.equal(await visible(page, '#vo-hf-hint'), false);
            await page.evaluate(() => select('header'));
            assert.equal(await visible(page, '#vo-hf-hint'), true);
            assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#vo-hf-hint > *'))
                .map(n => n.textContent)),
                ['Press Esc or double-click the text to return to the document', 'Settings', 'Remove header or footer']);
            await page.evaluate(() => select('text'));
            assert.equal(await visible(page, '#vo-hf-hint'), false);
            await page.evaluate(() => select('footer'));
            assert.equal(await visible(page, '#vo-hf-hint'), true, 'a footer is a header too');
            await page.evaluate(() => select('shape'));
            assert.equal(await visible(page, '#vo-hf-hint'), true, 'an object inside the footer keeps the hint');
            /* With the header and menu collapsed as well. */
            await page.evaluate(() => { select('text'); shell.toggleFocus(); select('header'); });
            assert.equal(await visible(page, '#vo-hf-hint'), true);
            /* Leaving the header by Escape is the engine's: the hint goes with it, the collapse stays. */
            await page.evaluate(() => focusText());
            await page.keyboard.press('Escape');
            assert.equal(await visible(page, '#vo-hf-hint'), false);
            assert.equal(await page.evaluate(() => shell.topHidden()), true);
            /* The buttons grey out while editing is closed. */
            await page.evaluate(() => { shell.toggleFocus(); ctx.reasons = ['view']; select('header'); shell.syncHeaderHint(); });
            assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#vo-hf-hint button'))
                .map(b => b.getAttribute('aria-disabled'))), ['true', 'true']);
            await page.$eval('#vo-hf-hint .vo-hf-remove', button => button.click());
            assert.deepEqual(await apiCalls(page, 'asc_RemoveHeader'), []);
            await page.close();
        });

        await check('remove deletes the current header', async () => {
            const page = await shellPage.open(browser);
            await page.evaluate(() => select('header'));
            await page.click('#vo-hf-hint .vo-hf-remove');
            await page.evaluate(() => select('footer'));
            await page.click('#vo-hf-hint .vo-hf-remove');
            /* getCurrentPage of the engine stand-in is 2. */
            assert.deepEqual(await apiCalls(page, 'asc_RemoveHeader'), [[2]]);
            assert.deepEqual(await apiCalls(page, 'asc_RemoveFooter'), [[2]]);
            assert.deepEqual(await apiCalls(page, 'asc_CancelHdrFtrEditing'), []);
            await page.close();
        });

        await check('remove is greyed with the reason while changes are tracked', async () => {
            /* The engine does not record removing a header as a tracked change: Reject all would not bring it back. */
            const page = await shellPage.open(browser, {context: {track: true}});
            await page.evaluate(() => { shell.bindMenuRefresh(); select('header'); });
            const buttons = () => page.evaluate(() => Array.from(document.querySelectorAll('#vo-hf-hint button'))
                .map(b => [b.textContent, b.getAttribute('aria-disabled'), b.getAttribute('title')]));
            const tracked = [['Settings', 'false', null],
                ['Remove header or footer', 'true', 'Unavailable while tracking changes']];
            assert.deepEqual(await buttons(), tracked, 'my own tracking');
            await page.$eval('#vo-hf-hint .vo-hf-remove', button => button.click());
            await page.evaluate(() => actions.removeHeaderFooter(shell.headerProps()));
            assert.deepEqual(await apiCalls(page, 'asc_RemoveHeader'), [], 'neither the button nor the command removes it');
            /* Tracking for everyone: my local flag is null and follows the document-wide one. */
            await page.evaluate(() => {
                Object.assign(ctx.engine, {asc_GetLocalTrackRevisions: () => null, asc_GetGlobalTrackRevisions: () => true});
                ctx.fire('asc_onOnTrackRevisionsChange', null, true);
            });
            assert.deepEqual(await buttons(), tracked, 'tracking for everyone');
            await page.$eval('#vo-hf-hint .vo-hf-remove', button => button.click());
            assert.deepEqual(await apiCalls(page, 'asc_RemoveHeader'), []);
            /* A co-author turns tracking off: the button is back without the reason. */
            await page.evaluate(() => {
                ctx.engine.asc_GetGlobalTrackRevisions = () => false;
                ctx.fire('asc_onOnTrackRevisionsChange', null, false);
            });
            assert.deepEqual(await buttons(), [['Settings', 'false', null], ['Remove header or footer', 'false', null]]);
            await page.click('#vo-hf-hint .vo-hf-remove');
            assert.deepEqual(await apiCalls(page, 'asc_RemoveHeader'), [[2]]);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('settings window applies the changed header options', async () => {
            const page = await shellPage.open(browser);
            await page.evaluate(() => {
                /* Stock window and controls, standing in for the template classes. */
                window.wins = [];
                const control = () => function (o) { this.o = o; this.value = false; this.disabled = false; };
                Common.UI.CheckBox = control();
                Common.UI.CheckBox.prototype = {setValue(v) { this.value = !!v; }, getValue() { return this.value ? 'checked' : 'unchecked'; },
                    setDisabled(v) { this.disabled = v; }};
                Common.UI.MetricSpinner = control();
                Common.UI.MetricSpinner.prototype = {setValue(v) { this.value = v; }, getNumberValue() { return this.value; }};
                Common.Utils.Metric = {c_MetricUnits: {cm: 0, pt: 1}, getCurrentMetric: () => 0, getCurrentMetricName: () => 'cm',
                    fnRecalcFromMM: v => v / 10, fnRecalcToMM: v => v * 10};
                Common.Views = {AdvancedSettingsWindow: function (o) {
                    this.options = o; this.$window = $('<div>' + o.contentTemplate + '</div>'); wins.push(this);
                }};
                Common.Views.AdvancedSettingsWindow.prototype = {render() { return this; }, show() { this.render(); },
                    on() { return this; }, getFooterButtons() { return []; }};
            });
            await page.evaluate(() => select('footer'));
            await page.click('#vo-hf-hint .vo-hf-settings');
            const opened = await page.evaluate(() => {
                const w = wins[0];
                return {title: w.options.title, first: w.first.value, link: w.link.disabled, distance: w.distance.value};
            });
            assert.deepEqual(opened, {title: 'Header and footer settings', first: false, link: true, distance: 1.25});
            await page.evaluate(() => {
                const w = wins[0];
                w.first.setValue(true);
                w.distance.setValue(2);
                w.options.handler('ok');
            });
            assert.deepEqual(await apiCalls(page, 'HeadersAndFooters_DifferentFirstPage'), [[true]]);
            assert.deepEqual(await apiCalls(page, 'HeadersAndFooters_DifferentOddandEvenPage'), []);
            assert.deepEqual(await apiCalls(page, 'HeadersAndFooters_LinkToPrevious'), [], 'no link for the first section');
            assert.deepEqual(await apiCalls(page, 'put_HeadersAndFootersDistance'), [[20, false]], 'footer distance in mm');
            await page.close();
        });
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
