/* Run after the document editor LESS build: node test/unit-tests/documenteditor/compact-outline-toggle.cjs
 * COMPACT_CSS_DOCUMENTEDITOR (or COMPACT_CSS) names the compiled app.css.
 * "View → Document outline" of the compact menu shows and hides the outline rail beside the page; the stock
 * navigation panel does not open from the menu, and the check of the item is the state the rail keeps.
 * The shell, the menu bar, the catalog, the adapter and the rail are the real modules in headless Chrome
 * (fixtures/compact-shell-page.cjs); the stock left menu is a stand-in that records every button press.
 */
const assert = require('node:assert/strict');
const shellPage = require('./fixtures/compact-shell-page.cjs');

(async () => {
    const browser = await shellPage.launch();
    const {check, done} = shellPage.checker();
    /* The rail list on the screen and the state the rail keeps. */
    const railState = page => page.evaluate(() => {
        const list = document.querySelector('#vo-outline .vo-outline-list');
        return {open: rail.open, list: !!list && list.getClientRects().length > 0 && getComputedStyle(list).visibility !== 'hidden',
            toggle: document.querySelector('#vo-outline .vo-outline-toggle').getClientRects().length > 0};
    });
    /* Chooses the item in the open View section of the menu bar, as a user does. */
    const choose = async page => {
        await page.click('.vo-mn-item[data-k="view"]');
        await page.click('[data-k="view.outline"]');
        await shellPage.settle(page);
    };
    const checkedInMenu = async page => {
        await page.click('.vo-mn-item[data-k="view"]');
        const value = await page.getAttribute('[data-k="view.outline"]', 'aria-checked');
        await page.keyboard.press('Escape');
        return value;
    };
    try {
        await check('outline toggle shows and hides the rail', async () => {
            const page = await shellPage.open(browser);
            assert.deepEqual(await railState(page), {open: true, list: true, toggle: true}, 'the rail starts open');
            await choose(page);
            assert.deepEqual(await railState(page), {open: false, list: false, toggle: true}, 'hidden to the pill');
            await choose(page);
            assert.deepEqual(await railState(page), {open: true, list: true, toggle: true}, 'shown again');
            /* The choice is the user's: the rail remembers it as its own toggle does. */
            assert.equal(await page.evaluate(() => rail.manual), 'open');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('stock navigation panel never opens', async () => {
            const page = await shellPage.open(browser);
            for (let i = 0; i < 3; i++) await choose(page);
            await page.evaluate(() => shell.menuAdapter.exec(actions.command('view.outline')));
            const s = await page.evaluate(() => ({
                pressed: stock.btnNavigation.pressed,
                presses: log.filter(l => l === 'stock: btnNavigation').length,
                panel: document.getElementById('panel-navigation').classList.contains('shown'),
                left: document.body.classList.contains('vo-left-open')
            }));
            assert.deepEqual(s, {pressed: false, presses: 0, panel: false, left: false});
            await page.close();
        });

        await check('check follows the rail state', async () => {
            const page = await shellPage.open(browser);
            assert.equal(await checkedInMenu(page), 'true');
            /* Folded by the rail's own button, not by the menu. */
            await page.click('#vo-outline .vo-outline-toggle');
            await shellPage.settle(page);
            assert.equal(await page.evaluate(() => rail.open), false);
            assert.equal(await checkedInMenu(page), 'false');
            assert.equal(await page.evaluate(() => shell.menuAdapter.itemState(actions.command('view.outline')).checked), false);
            await choose(page);
            assert.equal(await checkedInMenu(page), 'true');
            /* Without a connection the rail does not answer, and the item is greyed. */
            await page.evaluate(() => { ctx.reasons = ['offline']; rail.setLocked(true); });
            const state = await page.evaluate(() => shell.menuAdapter.itemState(actions.command('view.outline')));
            assert.equal(state.disabled, true);
            await page.evaluate(() => shell.toggleOutline());
            assert.equal(await page.evaluate(() => rail.open), true, 'a locked rail keeps its state');
            await page.close();
        });
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
