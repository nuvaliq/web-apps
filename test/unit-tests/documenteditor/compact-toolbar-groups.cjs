/* Run: node test/unit-tests/documenteditor/compact-toolbar-groups.cjs
 * Groups and controls of the compact toolbar of the document editor (CompactToolbar.js): the zoom values
 * of the menu, the format painter and clearing in the typeface group, the line spacing button after the
 * alignment with the items of the spacing submenu, the chevron on the right that collapses the header and menu
 * (focus mode), and the font size typed from the keyboard.
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH; CHROMIUM_PATH optional) over
 * fixtures/compact-quick-page.cjs: the real toolbar and catalog over the stock stand-ins. The chevron is also
 * checked over the real shell (fixtures/compact-shell-page.cjs), which needs the compiled styles:
 * COMPACT_CSS_DOCUMENTEDITOR (or COMPACT_CSS) names app.css of the document editor LESS build.
 */
const assert = require('node:assert/strict');
const quick = require('./fixtures/compact-quick-page.cjs');
const shellPage = require('./fixtures/compact-shell-page.cjs');

const apiCalls = (page, name) => page.evaluate(name => ctx.log.filter(e => e.api === name)
    .map(e => JSON.parse(JSON.stringify(e.args))), name);
const titled = (page, title) => page.locator(`#vo-tb button.vo-ib[title="${title}"]`);

(async () => {
    const browser = await quick.launch();
    const {check, done} = quick.checker();
    try {
        await check('zoom list matches the menu values', async () => {
            const page = await quick.open(browser);
            const menu = await page.evaluate(() => actions.command('view.zoom').items
                .filter(it => it && /^view\.zoom\.\d+$/.test(it.k)).map(it => Number(it.k.split('.').pop())));
            assert.deepEqual(menu, [50, 75, 100, 125, 150, 200]);
            const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.vo-w-zoom .vo-pop-item'))
                .map(el => el.textContent));
            assert.deepEqual(rows, menu.map(z => z + '%'));
            /* A value runs the menu item: the same command, the same call of the engine. */
            await page.click('.vo-w-zoom .vo-value-btn');
            await page.locator('.vo-w-zoom .vo-pop-item', {hasText: '125%'}).click();
            assert.deepEqual(await page.evaluate(() => commands), ['view.zoom.125']);
            assert.deepEqual(await apiCalls(page, 'zoom'), [[125]]);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('format painter follows strikeout and leaves with its group into the more button', async () => {
            const page = await quick.open(browser);
            const groups = await page.evaluate(() => Array.from(document.querySelectorAll('#vo-tb .vo-of > .vo-g'))
                .map(g => Array.from(g.children).map(el => el.getAttribute('title') ||
                    (el.querySelector('[title]') || {}).title || el.className)));
            const typeface = groups.find(g => g.includes('Strikethrough'));
            const at = typeface.indexOf('Strikethrough');
            assert.deepEqual(typeface.slice(at), ['Strikethrough', 'Copy formatting', 'Clear formatting'],
                'painter and clearing right after strikeout');
            assert.deepEqual(groups[groups.length - 1], ['Superscript', 'Subscript'], 'the last group');
            assert.equal(groups.filter(g => g.includes('Copy formatting') || g.includes('Clear formatting')).length, 1);
            /* Narrowing the window: they are no longer first to leave; they leave with the typeface group. */
            const state = width => page.evaluate(width => {
                document.getElementById('toolbar').style.width = width + 'px';
                tb.relayout();
                const gone = el => el.classList.contains('vo-collapsed');
                return {sup: gone(tb.ctrl.sup[0]), strike: gone(tb.ctrl.strike[0]), paint: gone(tb.ctrl.paint[0]),
                    clear: gone(tb.ctrl.clear[0]), link: gone(tb.ctrl.link[0])};
            }, width);
            let width = 1600, s = await state(width);
            assert.equal(s.sup, false, 'everything fits at full width');
            while (!s.sup && width > 200) s = await state(width -= 10);
            assert.equal(s.sup, true);
            assert.deepEqual([s.paint, s.clear, s.strike], [false, false, false], 'superscript leaves first, painter stays');
            while (!s.strike && width > 200) s = await state(width -= 10);
            assert.equal(s.strike, true);
            assert.deepEqual([s.paint, s.clear], [true, true], 'painter and clearing leave with the group');
            /* In the more button they stand in the typeface group right after strikeout. */
            await page.evaluate(() => tb.openOverflow());
            const moved = await page.evaluate(() => {
                const g = tb.ctrl.strike[0].parentNode;
                return {inPop: !!g.closest('.vo-of-pop'), order: Array.from(g.children).map(el => el.getAttribute('title'))};
            });
            assert.equal(moved.inPop, true);
            const i = moved.order.indexOf('Strikethrough');
            assert.deepEqual(moved.order.slice(i, i + 3), ['Strikethrough', 'Copy formatting', 'Clear formatting']);
            await page.close();
        });

        await check('spacing button marks the current value', async () => {
            const page = await quick.open(browser);
            const button = titled(page, 'Line spacing');
            assert.equal(await button.count(), 1);
            /* Right after the alignment. */
            assert.equal(await page.evaluate(() => {
                const wrap = tb.ctrl.spacingBtn[0].parentNode;
                return wrap.previousElementSibling === tb.ctrl.alignBtn[0].parentNode;
            }), true);
            /* The rows are the spacing submenu of the menu, in its order. */
            const menu = await page.evaluate(() => actions.command('format.spacing').items.filter(it => it && it.k)
                .map(it => it.k));
            const rows = () => page.evaluate(() => Array.from(tb.ctrl.spacingBtn[0].parentNode.querySelectorAll('.vo-pop-item'))
                .map(el => ({k: el.getAttribute('data-k'), t: el.textContent, on: el.classList.contains('on')})));
            assert.deepEqual((await rows()).map(r => r.k), menu);
            assert.deepEqual((await rows()).map(r => r.t), ['1.0', '1.15', '1.5', '2.0', '2.5', '3.0',
                'Add space before paragraph', 'Add space after paragraph', 'More spacing and indents']);
            /* The current value from the engine is marked; another value is not. */
            await page.evaluate(() => ctx.fire('asc_onParaSpacingLine', {get_Line: () => 1.5, get_LineRule: () => 1}));
            await button.click();
            assert.deepEqual((await rows()).filter(r => r.on).map(r => r.k), ['format.spacing.150']);
            await page.evaluate(() => ctx.fire('asc_onParaSpacingLine', {get_Line: () => 18, get_LineRule: () => 2}));
            assert.deepEqual((await rows()).filter(r => r.on).map(r => r.k), []);
            /* Space before a paragraph that has it: the row says it removes it, as the menu item does. */
            await button.click();
            await page.evaluate(() => { ctx.engine.asc_haveSpaceBeforeParagraph = () => true; });
            await button.click();
            assert.equal((await rows()).find(r => r.k === 'format.spacing.before').t, 'Remove space before paragraph');
            /* A row runs the item of the menu. */
            await page.locator('[data-k="format.spacing.200"]').click();
            assert.deepEqual(await page.evaluate(() => commands), ['format.spacing.200']);
            assert.deepEqual(await apiCalls(page, 'put_PrLineSpacing'), [[1, 2]]);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('alignment popover has no spacing', async () => {
            const page = await quick.open(browser);
            const pop = await page.evaluate(() => {
                const wrap = tb.ctrl.alignBtn[0].parentNode;
                return {title: tb.ctrl.alignBtn.attr('title'),
                    rows: Array.from(wrap.querySelectorAll('.vo-pop-item')).map(el => el.textContent),
                    seps: wrap.querySelectorAll('.vo-pop-sep').length,
                    lineh: wrap.querySelectorAll('.vo-pop-item [data-i="lineh"]').length};
            });
            assert.deepEqual(pop, {title: 'Alignment', rows: ['Align left', 'Align center', 'Align right', 'Justified'],
                seps: 0, lineh: 0});
            await titled(page, 'Alignment').click();
            await page.locator('.vo-align .vo-pop-item', {hasText: 'Justified'}).click();
            assert.deepEqual(await page.evaluate(() => commands), ['format.align.justify']);
            assert.deepEqual(await apiCalls(page, 'put_PrAlign'), [[3]]);
            await page.close();
        });

        await check('right button shows a chevron with the focus mode tip', async () => {
            const page = await quick.open(browser);
            const right = page.locator('#vo-tb .vo-tb-end button');
            assert.equal(await right.count(), 1);
            assert.equal(await right.getAttribute('title'), 'Focus mode');
            assert.equal(await right.locator('[data-i]').getAttribute('data-i'), 'chevron', 'the chevron glyph');
            assert.equal(await right.evaluate(b => b.classList.contains('vo-focus-btn')), true);
            assert.equal(await right.getAttribute('aria-pressed'), 'false');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('right button collapses and expands the header and menu through the menu command', async () => {
            const page = await quick.open(browser);
            const right = page.locator('#vo-tb .vo-tb-end button');
            await right.click();
            assert.deepEqual(await page.evaluate(() => commands), ['view.focus']);
            assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.shell).map(e => e.shell)), ['toggleFocus']);
            const markup = await right.evaluate(b => b.outerHTML);
            await page.close();

            /* The same button over the real shell: the menu command collapses the header and menu and the
               second press brings them back. */
            const shellView = await shellPage.open(browser);
            await shellView.evaluate(markup => {
                const old = document.getElementById('tb-focus');
                old.insertAdjacentHTML('afterend', markup);
                const button = old.nextElementSibling;
                old.remove();
                shell.tb.ctrl.focus = $(button).on('click', () => actions.runCommand('view.focus'));
            }, markup);
            const state = () => shellView.evaluate(() => ({hidden: shell.topHidden(), cause: shell.top.cause,
                header: !!document.querySelector('.vo-hd').getClientRects().length,
                menu: !!document.querySelector('.vo-mn').getClientRects().length,
                toolbar: !!document.getElementById('vo-tb').getClientRects().length,
                checked: shell.menuAdapter.itemState(actions.command('view.focus')).checked}));
            await shellView.click('#vo-tb .vo-focus-btn');
            await shellPage.settle(shellView);
            assert.deepEqual(await state(), {hidden: true, cause: 'manual', header: false, menu: false, toolbar: true,
                checked: true});
            await shellView.click('#vo-tb .vo-focus-btn');
            await shellPage.settle(shellView);
            assert.deepEqual(await state(), {hidden: false, cause: null, header: true, menu: true, toolbar: true,
                checked: false});
            assert.deepEqual(shellView.errors, []);
            await shellView.close();
        });

        await check('chevron turns while the top is hidden and reports pressed', async () => {
            const page = await shellPage.open(browser);
            const chevron = () => page.evaluate(() => {
                const b = document.getElementById('tb-focus');
                return {on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed'),
                    turn: (t => t === 'none' ? 'none' : new DOMMatrix(t).a === -1 ? 'half turn' : t)(
                        getComputedStyle(b.querySelector('.vo-air')).transform)};
            });
            const shown = await chevron();
            assert.equal(shown.on, false);
            assert.equal(shown.pressed, 'false');
            assert.equal(shown.turn, 'half turn', 'turned up while the header and menu are shown');
            await page.evaluate(() => shell.toggleFocus());
            await shellPage.settle(page);
            assert.deepEqual(await chevron(), {on: true, pressed: 'true', turn: 'none'}, 'collapsed by hand');
            await page.evaluate(() => shell.toggleFocus());
            await shellPage.settle(page);
            assert.deepEqual(await chevron(), shown, 'expanded');
            /* Gone by scrolling: the chevron shows the hidden top as well. */
            await page.evaluate(() => shell.hideTop('scroll'));
            await shellPage.settle(page);
            assert.deepEqual(await chevron(), {on: true, pressed: 'true', turn: 'none'}, 'gone by scrolling');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('typed size applies on enter and blur', async () => {
            const page = await quick.open(browser);
            const field = page.locator('#vo-tb .vo-w-size input');
            assert.equal(await field.getAttribute('aria-label'), 'Font size');
            await page.evaluate(() => ctx.fire('asc_onFontSize', 11));
            assert.equal(await field.inputValue(), '11');
            await field.click();
            await field.fill('10,5');
            await field.press('Enter');
            assert.deepEqual(await apiCalls(page, 'put_TextPrFontSize'), [[10.5]]);
            assert.equal(await field.inputValue(), '10.5');
            await field.click();
            await field.fill('13');
            await page.click('#outside');
            assert.deepEqual(await apiCalls(page, 'put_TextPrFontSize'), [[10.5], [13]]);
            /* Leaving the field without a change applies nothing. */
            await field.click();
            await page.click('#outside');
            assert.equal((await apiCalls(page, 'put_TextPrFontSize')).length, 2);
            /* The list of sizes is still there. */
            await page.click('#vo-tb .vo-w-size .vo-size-caret');
            await page.locator('.vo-w-size .vo-pop-item', {hasText: /^14$/}).click();
            assert.deepEqual((await apiCalls(page, 'put_TextPrFontSize')).pop(), [14]);
            /* The keyboard of the engine is held while typing and given back after. */
            const keys = await apiCalls(page, 'asc_enableKeyEvents');
            assert.ok(keys.some(a => a[0] === false) && keys[keys.length - 1][0] === true);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('invalid size restores the current value', async () => {
            const page = await quick.open(browser);
            const field = page.locator('#vo-tb .vo-w-size input');
            await page.evaluate(() => ctx.fire('asc_onFontSize', 12));
            for (const typed of ['abc', '0', '301', '-4', '1,2,3', '']) {
                await field.click();
                await field.fill(typed);
                await field.press('Enter');
                assert.equal(await field.inputValue(), '12', JSON.stringify(typed) + ' on enter');
                await field.click();
                await field.fill(typed);
                await page.click('#outside');
                assert.equal(await field.inputValue(), '12', JSON.stringify(typed) + ' on blur');
            }
            assert.deepEqual(await apiCalls(page, 'put_TextPrFontSize'), []);
            await page.close();
        });
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
