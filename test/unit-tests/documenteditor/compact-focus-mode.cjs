/* Run after the document editor LESS build: node test/unit-tests/documenteditor/compact-focus-mode.cjs
 * COMPACT_CSS_DOCUMENTEDITOR (or COMPACT_CSS) names the compiled app.css.
 * Focus mode of the compact shell: the header and the menu bar collapse, the toolbar, the outline rail, the
 * status bar and the side panels stay, and the document takes the freed room. Escape takes one layer per press
 * and returns the header and menu last, leaving the engine and text fields their own Escape.
 * The shell, the menu bar, the catalog and the outline rail are the real modules in headless Chrome
 * (fixtures/compact-shell-page.cjs); the stock parts and the engine are stand-ins.
 */
const assert = require('node:assert/strict');
const shellPage = require('./fixtures/compact-shell-page.cjs');

(async () => {
    const browser = await shellPage.launch();
    const {check, done} = shellPage.checker();
    const screen = shellPage.screen;
    const press = async (page, key) => { await page.keyboard.press(key); await shellPage.settle(page); };
    const fresh = async (context) => {
        const page = await shellPage.open(browser, {context});
        await page.evaluate(() => focusText());
        await shellPage.settle(page);
        return page;
    };
    const collapse = async page => { await page.evaluate(() => shell.toggleFocus()); await shellPage.settle(page); };
    /* Chooses "View → Focus mode" in the menu bar, as a user does. */
    const chooseInMenu = async page => {
        await page.click('.vo-mn-item[data-k="view"]');
        await page.click('[data-k="view.focus"]');
        await shellPage.settle(page);
    };
    try {
        await check('collapse hides the header and menu and keeps the toolbar, rail, status bar and side panels', async () => {
            const page = await fresh();
            await page.evaluate(() => { shell.ensureLeftPanel('comments'); shell.openRightPanel(); });
            await shellPage.settle(page);
            const before = await screen(page);
            assert.deepEqual([before.header, before.menu, before.toolbar, before.status, before.rail, before.left,
                before.right], [true, true, true, true, true, true, true]);
            await collapse(page);
            const s = await screen(page);
            assert.deepEqual({topHidden: s.topHidden, cause: s.cause, focus: s.focus},
                {topHidden: true, cause: 'manual', focus: true});
            assert.deepEqual({header: s.header, menu: s.menu, toolbar: s.toolbar, status: s.status, rail: s.rail,
                left: s.left, right: s.right}, {header: false, menu: false, toolbar: true, status: true, rail: true,
                left: true, right: true});
            assert.deepEqual(s.panels, ['btnComments'], 'the comments panel stays open');
            assert.equal(s.rightOpen, true, 'the properties panel stays open');
            assert.equal(await page.evaluate(() => document.body.classList.contains('vo-top-hidden')), true);
            assert.equal(s.active, 'area_id', 'the caret stays in the text');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('document area grows by the header and menu height', async () => {
            const page = await fresh();
            const area = () => page.evaluate(() => {
                const r = document.getElementById('editor-container').getBoundingClientRect();
                return {top: r.top, height: r.height, gap: ctx.api.WordControl ? ctx.api.WordControl._voBottomGap : null};
            });
            const before = await area();
            const rows = await page.evaluate(() => document.querySelector('.vo-hd').getBoundingClientRect().height +
                document.querySelector('.vo-mn').getBoundingClientRect().height);
            assert.equal(rows, 76, 'header and menu bar together');
            await collapse(page);
            const after = await area();
            assert.equal(before.top - after.top, rows, 'the document moves up by the header and menu');
            assert.equal(after.height - before.height, rows, 'and grows by them');
            /* The toolbar card still lies over the document: the room of the card and the bottom margin stay. */
            assert.equal((await screen(page)).toolbarArea, 4);
            await collapse(page);
            assert.deepEqual(await area(), before, 'expanding gives the room back');
            await page.close();
        });

        await check('collapse from the menu shows a folded toolbar', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.toggleToolbar());
            assert.deepEqual([(await screen(page)).tbHidden, (await screen(page)).toolbar], [true, false]);
            await chooseInMenu(page);
            const s = await screen(page);
            assert.equal(s.topHidden, true);
            assert.equal(s.tbHidden, false, 'the toolbar with the chevron comes back');
            assert.equal(s.toolbar, true);
            assert.equal(s.toolbarArea, 4, 'only the gap above the toolbar card is laid out');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('toolbar toggle returns the header and menu first', async () => {
            const page = await fresh();
            await collapse(page);
            await page.evaluate(() => shell.toggleToolbar());
            await shellPage.settle(page);
            const s = await screen(page);
            assert.deepEqual({topHidden: s.topHidden, header: s.header, menu: s.menu, tbHidden: s.tbHidden, toolbar: s.toolbar},
                {topHidden: false, header: true, menu: true, tbHidden: true, toolbar: false});
            /* Gone by scrolling: the same. */
            await page.evaluate(() => { shell.toggleToolbar(); shell.hideTop('scroll'); shell.toggleToolbar(); });
            assert.deepEqual([(await screen(page)).topHidden, (await screen(page)).tbHidden], [false, true]);
            await page.close();
        });

        await check('menu check follows only the manual collapse', async () => {
            const page = await fresh();
            const checked = () => page.evaluate(() => shell.menuAdapter.itemState(actions.command('view.focus')).checked);
            assert.equal(await checked(), false);
            await chooseInMenu(page);
            assert.equal(await checked(), true, 'collapsed by hand');
            await collapse(page);
            assert.equal(await checked(), false);
            /* Gone by scrolling: hidden, but not the focus mode; the command brings it back. */
            await page.evaluate(() => shell.hideTop('scroll'));
            await shellPage.settle(page);
            let s = await screen(page);
            assert.deepEqual([s.topHidden, s.cause, s.focus, await checked()], [true, 'scroll', false, false]);
            assert.equal(await page.evaluate(() => document.body.classList.contains('vo-top-scroll')), true);
            await page.evaluate(() => actions.command('view.focus').run());
            s = await screen(page);
            assert.deepEqual([s.topHidden, s.header, s.menu], [false, true, true]);
            /* A manual collapse is not overwritten by scrolling, and it takes over a scrolled one. */
            await page.evaluate(() => { shell.toggleFocus(); shell.hideTop('scroll'); });
            assert.equal((await screen(page)).cause, 'manual');
            await page.evaluate(() => { shell.showTop(); shell.hideTop('scroll'); shell.hideTop('manual'); });
            assert.deepEqual([(await screen(page)).cause, await checked()], ['manual', true]);
            assert.equal(await page.evaluate(() => document.body.classList.contains('vo-top-scroll')), false);
            await page.close();
        });

        await check('first escape closes an open menu and second returns the header and menu', async () => {
            const page = await fresh();
            await collapse(page);
            /* A popover of the shell (the value list of the selection toolbar lives in the same family). */
            await page.evaluate(() => document.getElementById('tb-pop').classList.add('open'));
            await press(page, 'Escape');
            assert.equal(await page.evaluate(() => document.getElementById('tb-pop').classList.contains('open')), false);
            assert.equal((await screen(page)).topHidden, true, 'the first Escape only closes the menu');
            await press(page, 'Escape');
            let s = await screen(page);
            assert.deepEqual([s.topHidden, s.header, s.menu], [false, true, true], 'the second Escape returns them');

            /* A stock menu (context menu of the document) closes on its own Escape. */
            await collapse(page);
            await page.evaluate(() => {
                const group = document.createElement('div');
                group.id = 'context'; group.className = 'btn-group open';
                group.innerHTML = '<ul class="dropdown-menu" role="menu" style="display:block"><li><a id="ctx-item" href="#">Copy</a></li></ul>';
                document.body.appendChild(group);
                group.addEventListener('keydown', e => { if (e.key === 'Escape') group.classList.remove('open'); });
                document.getElementById('ctx-item').focus();
            });
            await press(page, 'Escape');
            assert.equal(await page.evaluate(() => document.getElementById('context').classList.contains('open')), false);
            assert.equal((await screen(page)).topHidden, true, 'the stock menu took the first Escape');
            await page.evaluate(() => focusText());
            await press(page, 'Escape');
            assert.equal((await screen(page)).topHidden, false);

            /* The selection toolbar is a layer of its own. */
            await collapse(page);
            await page.evaluate(() => { bubble.shown = true; });
            await press(page, 'Escape');
            assert.deepEqual(await page.evaluate(() => log.filter(l => /bubble/.test(l))), ['bubble: dismiss']);
            assert.equal((await screen(page)).topHidden, true);
            await press(page, 'Escape');
            assert.equal((await screen(page)).topHidden, false);

            /* Gone by scrolling: Escape brings it back as well. */
            await page.evaluate(() => shell.hideTop('scroll'));
            await press(page, 'Escape');
            assert.equal((await screen(page)).topHidden, false);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('escape in a text field goes to the field and keeps its value', async () => {
            const page = await fresh();
            /* A field with its own Escape, as the document title and the font size: Escape puts back the value
               it had, leaving the field applies what is in it. */
            await page.evaluate(() => {
                const field = document.createElement('input');
                field.id = 'own-field';
                field.value = 'Report';
                document.body.appendChild(field);
                let was = field.value;
                field.addEventListener('focus', () => { was = field.value; });
                field.addEventListener('keydown', e => {
                    e.stopPropagation();
                    if (e.key === 'Escape') { e.preventDefault(); field.value = was; field.blur(); }
                });
                field.addEventListener('blur', () => log.push('field: apply ' + field.value));
            });
            const typeAndEscape = async () => {
                await page.focus('#own-field');
                await page.keyboard.press('End');
                await page.keyboard.type(' draft');
                await press(page, 'Escape');
                return page.evaluate(() => ({value: document.getElementById('own-field').value,
                    applied: log.filter(l => /^field/.test(l)).pop()}));
            };
            const own = {value: 'Report', applied: 'field: apply Report'};

            /* The selection toolbar stays open. */
            await page.evaluate(() => { bubble.shown = true; });
            assert.deepEqual(await typeAndEscape(), own, 'with the selection toolbar');
            assert.equal(await page.evaluate(() => bubble.shown), true, 'the selection toolbar stays');
            assert.deepEqual(await page.evaluate(() => log.filter(l => /bubble/.test(l))), []);
            await page.evaluate(() => { bubble.shown = false; });

            /* The search panel stays open. */
            await page.evaluate(() => shell.ensureLeftPanel('search'));
            await shellPage.settle(page);
            assert.deepEqual(await typeAndEscape(), own, 'with the search panel');
            assert.deepEqual((await screen(page)).panels, ['btnSearchBar'], 'the search panel stays');
            /* Escape in the search field itself still closes the panel. */
            await page.focus('#search-field');
            await press(page, 'Escape');
            assert.deepEqual((await screen(page)).panels, [], 'the search field closes its panel');

            /* The collapse stays. */
            await collapse(page);
            assert.deepEqual(await typeAndEscape(), own, 'with the header and menu collapsed');
            assert.equal((await screen(page)).topHidden, true, 'the collapse stays');

            /* In the text of the document the same Escape takes the shell layers, as before. */
            await page.evaluate(() => { bubble.shown = true; focusText(); });
            await press(page, 'Escape');
            assert.deepEqual(await page.evaluate(() => log.filter(l => /bubble/.test(l))), ['bubble: dismiss']);
            await press(page, 'Escape');
            assert.equal((await screen(page)).topHidden, false);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('escape with a selected shape first leaves the shape', async () => {
            const page = await fresh();
            await collapse(page);
            await page.evaluate(() => select('shape'));
            await press(page, 'Escape');
            assert.deepEqual(await page.evaluate(() => log.filter(l => /^engine/.test(l))), ['engine: leave object']);
            assert.equal((await screen(page)).topHidden, true);
            await press(page, 'Escape');
            assert.equal((await screen(page)).topHidden, false);
            await page.close();
        });

        await check('escape in a header first leaves the header through the engine and keeps the collapse', async () => {
            const page = await fresh();
            await collapse(page);
            await page.evaluate(() => select('header'));
            await press(page, 'Escape');
            assert.deepEqual(await page.evaluate(() => log.filter(l => /^engine/.test(l))), ['engine: leave header']);
            assert.equal((await screen(page)).topHidden, true);
            await press(page, 'Escape');
            assert.equal((await screen(page)).topHidden, false);
            await page.close();
        });

        await check('shell never cancels header editing on escape', async () => {
            const page = await fresh();
            for (const collapsed of [false, true]) {
                if (collapsed) await collapse(page);
                await page.evaluate(() => select('header'));
                await press(page, 'Escape');
                await page.evaluate(() => select('footer'));
                await press(page, 'Escape');
            }
            assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.api === 'asc_CancelHdrFtrEditing')), []);
            await page.close();
        });

        await check('escape keeps a folded toolbar folded', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.toggleToolbar());
            assert.equal((await screen(page)).tbHidden, true);
            await press(page, 'Escape');
            await press(page, 'Escape');
            let s = await screen(page);
            assert.equal(s.tbHidden, true);
            assert.equal(s.toolbar, false);
            /* Gone by scrolling with a folded toolbar: Escape returns the header and menu only. */
            await page.evaluate(() => shell.hideTop('scroll'));
            await press(page, 'Escape');
            s = await screen(page);
            assert.deepEqual([s.topHidden, s.tbHidden, s.toolbar], [false, true, false]);
            await page.close();
        });

        await check('f10 with a manual collapse is not taken by the shell', async () => {
            const page = await fresh();
            /* The engine keyboard as the shell leaves it: the last asc_enableKeyEvents call, null without one. */
            const engineKeys = () => page.evaluate(() => {
                const calls = ctx.log.filter(e => e.api === 'asc_enableKeyEvents');
                return calls.length ? calls[calls.length - 1].args[0] : null;
            });
            /* Without the collapse F10 enters the menu bar, and the menu holds the keyboard of the engine. */
            await press(page, 'F10');
            assert.equal(await page.evaluate(() => shell.menu.el.contains(document.activeElement)), true);
            assert.equal(await engineKeys(), false, 'control: entering the menu bar holds the engine keyboard');
            await page.evaluate(() => focusText());
            await press(page, 'Escape');
            await page.evaluate(() => { ctx.log.length = 0; });
            await collapse(page);
            await page.evaluate(() => focusText());
            const taken = await page.evaluate(() => {
                const e = new KeyboardEvent('keydown', {key: 'F10', bubbles: true, cancelable: true});
                document.getElementById('area_id').dispatchEvent(e);
                return e.defaultPrevented;
            });
            assert.equal(taken, false, 'the key goes on to the editor');
            const s = await screen(page);
            assert.equal(s.active, 'area_id');
            assert.equal(s.menu, false);
            assert.equal(s.topHidden, true, 'F10 does not bring back a manual collapse');
            assert.equal(await engineKeys(), null, 'the engine keeps its keyboard');
            await page.close();
        });

        await check('selecting a shape while collapsed opens the properties panel as usual', async () => {
            const page = await fresh();
            await collapse(page);
            await page.evaluate(() => select('shape'));
            await shellPage.settle(page);
            const s = await screen(page);
            assert.equal(s.rightOpen, true);
            assert.equal(s.right, true);
            assert.equal(s.topHidden, true);
            await page.close();
        });

        await check('collapse is ignored in the advanced interface', async () => {
            const page = await fresh();
            /* Gone by scrolling: going to Advanced brings the header and menu back. */
            await page.evaluate(() => shell.hideTop('scroll'));
            await page.evaluate(() => shell.toggleMode());
            await shellPage.settle(page);
            assert.deepEqual([(await screen(page)).topHidden, await page.evaluate(() => shell.advanced)], [false, true]);
            await page.evaluate(() => { shell.toggleFocus(); shell.hideTop('manual'); shell.hideTop('scroll'); });
            assert.equal((await screen(page)).topHidden, false, 'nothing collapses in Advanced');
            assert.equal(await page.evaluate(() => document.body.classList.contains('vo-top-hidden')), false);
            assert.equal(await page.evaluate(() => shell.menuAdapter.itemState(actions.command('view.focus')).checked), false);
            /* Collapsed by hand before going there: the choice is still there on the way back. */
            await page.evaluate(() => shell.toggleMode());
            await collapse(page);
            await page.evaluate(() => { shell.toggleMode(); shell.toggleMode(); });
            await shellPage.settle(page);
            const s = await screen(page);
            assert.deepEqual([s.topHidden, s.cause, s.header, s.menu], [true, 'manual', false, false]);
            /* After a failed start the shell does not collapse anything. */
            await page.evaluate(() => { shell.showTop(); shell.startupFailed = true; shell.toggleFocus(); shell.hideTop('scroll'); });
            assert.equal(await page.evaluate(() => shell.topHidden()), false);
            await page.close();
        });

        await check('view mode collapses the header and menu without a toolbar', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.applyDocModeLook('view'));
            await shellPage.settle(page);
            let s = await screen(page);
            assert.deepEqual([s.header, s.menu, s.toolbar, s.toolbarArea], [true, true, false, 76]);
            await chooseInMenu(page);
            s = await screen(page);
            assert.deepEqual({topHidden: s.topHidden, header: s.header, menu: s.menu, toolbar: s.toolbar,
                status: s.status, area: s.toolbarArea}, {topHidden: true, header: false, menu: false, toolbar: false,
                status: true, area: 0});
            await press(page, 'Escape');
            s = await screen(page);
            assert.deepEqual([s.topHidden, s.header, s.menu, s.toolbar], [false, true, true, false]);
            assert.deepEqual(page.errors, []);
            await page.close();
        });
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
