/* Run after the document editor LESS build: node test/unit-tests/documenteditor/compact-top-layout.cjs
 * COMPACT_CSS_DOCUMENTEDITOR (or COMPACT_CSS) names the compiled app.css.
 * The place of the header and the menu bar goes to the document when they collapse by hand or leave while
 * scrolling, also when the toolbar is not on the screen (the view mode, the toolbar turned off in View): the
 * document area starts right under what stays of the top and ends at the bottom of the window, so the status
 * bar stays in the window. When the top comes back, the document gives the place back.
 * The page is laid out by the stock vertical layout (Layout.js) with the transitions of the compiled styles on:
 * the stock layout takes a zero height of a row for "not set" and measures the row instead
 * (fixtures/compact-shell-page.cjs, stockLayout: true, motion: true).
 */
const assert = require('node:assert/strict');
const shellPage = require('./fixtures/compact-shell-page.cjs');

const H_TOP = 76;      // header 46 and menu bar 30
const H_GAP = 4;       // grey gap above the toolbar card

(async () => {
    const browser = await shellPage.launch();
    const {check, done} = shellPage.checker();
    const frames = (page, n = 4) => page.evaluate(n => new Promise(ok => {
        const step = () => (n-- > 0 ? requestAnimationFrame(step) : ok());
        step();
    }), n);
    /* Longer than the slide of the rows and the change of the height of the shell area together. */
    const settle = async page => {
        await page.evaluate(() => new Promise(ok => setTimeout(ok, 800)));
        await frames(page);
    };
    const fresh = async (options = {}) => {
        const page = await shellPage.open(browser, Object.assign({stockLayout: true, motion: true}, options));
        await page.evaluate(() => focusText());
        await settle(page);
        return page;
    };
    const scroll = async (page, ...positions) => {
        for (const y of positions) {
            await page.evaluate(y => docScroll.to(y), y);
            await frames(page, 2);
        }
        await settle(page);
    };
    /* Where the document area and the status bar are, against the window. */
    const place = page => page.evaluate(() => {
        const rect = sel => document.querySelector(sel).getBoundingClientRect();
        const sdk = rect('#editor_sdk'), status = rect('#vo-status');
        return {hidden: shell.topHidden(), top: Math.round(sdk.top), bottom: Math.round(sdk.bottom),
            statusBottom: Math.round(status.bottom), window: window.innerHeight};
    });
    const expect = (s, top, what) => assert.deepEqual(s,
        {hidden: s.hidden, top, bottom: s.window, statusBottom: s.window, window: s.window}, what);

    try {
        await check('view mode: the collapsed top gives its place to the document', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.applyDocModeLook('view'));
            await settle(page);
            expect(await place(page), H_TOP, 'shown');
            await page.evaluate(() => actions.command('view.focus').run());
            await settle(page);
            const s = await place(page);
            assert.equal(s.hidden, true);
            expect(s, 0, 'collapsed by hand');
            await page.keyboard.press('Escape');
            await settle(page);
            expect(await place(page), H_TOP, 'back');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('view mode: the top gone by scrolling gives its place to the document', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.applyDocModeLook('view'));
            await settle(page);
            await scroll(page, 400, 600);
            const s = await place(page);
            assert.equal(s.hidden, true);
            expect(s, 0, 'gone by scrolling');
            await scroll(page, 500);
            expect(await place(page), H_TOP, 'back');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('toolbar turned off: the top gone by scrolling gives its place to the document', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.toggleToolbar());
            await settle(page);
            expect(await place(page), H_TOP, 'shown');
            await scroll(page, 400, 600);
            const s = await place(page);
            assert.equal(s.hidden, true);
            expect(s, 0, 'gone by scrolling');
            await scroll(page, 500);
            expect(await place(page), H_TOP, 'back');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('toolbar turned off: collapsing by hand brings the toolbar back over its gap', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.toggleToolbar());
            await settle(page);
            await page.evaluate(() => actions.command('view.focus').run());
            await settle(page);
            const s = await place(page);
            assert.equal(s.hidden, true);
            assert.equal(await page.evaluate(() => shell.tbHidden), false);
            expect(s, H_GAP, 'collapsed by hand');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('editing with the toolbar: the collapsed top leaves the gap above the toolbar card', async () => {
            const page = await fresh();
            expect(await place(page), H_TOP + H_GAP, 'shown');
            await page.evaluate(() => shell.toggleFocus());
            await settle(page);
            expect(await place(page), H_GAP, 'collapsed by hand');
            await page.evaluate(() => shell.toggleFocus());
            await settle(page);
            await scroll(page, 400, 600);
            const s = await place(page);
            assert.equal(s.hidden, true);
            expect(s, H_GAP, 'gone by scrolling');
            assert.deepEqual(page.errors, []);
            await page.close();
        });
    } finally {
        await browser.close();
        done();
    }
})();
