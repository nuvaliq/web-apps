/* Run: node test/unit-tests/documenteditor/compact-slash-catalog.cjs
 * Slash commands of the compact shell of the document editor (SlashMenu.js) come from the menu catalog
 * (DocumentActions.SLASH): the agreed set in its order, the item of the menu runs, a user without the right
 * to edit gets no slash commands, and a command greyed in the menu is greyed in the list with its reason and
 * does not run.
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH; CHROMIUM_PATH optional) over
 * fixtures/compact-quick-page.cjs: the real catalog, adapter and slash menu over the stock stand-ins.
 */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const quick = require('./fixtures/compact-quick-page.cjs');

/* The look of a greyed command comes from the compiled styles of the editor. */
function stylesheet() {
    const file = process.env.COMPACT_CSS_DOCUMENTEDITOR || process.env.COMPACT_CSS;
    if (!file || !fs.existsSync(file))
        throw new Error('set COMPACT_CSS_DOCUMENTEDITOR to app.css of the document editor LESS build');
    return fs.readFileSync(file, 'utf8');
}

/* The slash commands in order: the menu item each one runs. */
const AGREED = [
    'format.style.heading1', 'format.style.heading2', 'format.style.heading3', 'format.style.normal',
    'format.lists.bullet', 'format.lists.numbered',
    'insert.table', 'insert.image', 'insert.break.page', 'insert.comment', 'insert.link',
    'insert.toc.add', 'insert.footnote.regular', 'insert.equation', 'insert.break.section', 'insert.break.blank',
    'insert.horizontalLine'
];

/* What a command did to the editor: calls of the api, the shell and notifications, without the erasing
   of the typed slash, the keyboard of the menu and the questions the state of an item asks the engine. */
const effects = page => page.evaluate(() => ctx.log
    .filter(e => !e.keys && e.api !== 'pluginMethod_InputText' && e.api !== 'asc_enableKeyEvents' &&
        !/^(asc_Is|asc_is|asc_Can|asc_can|pluginMethod_Get|Check)/.test(e.api || ''))
    .map(e => JSON.parse(JSON.stringify(e))));

(async () => {
    const browser = await quick.launch();
    const {check, done} = quick.checker();
    try {
        await check('slash list equals the agreed set', async () => {
            const page = await quick.open(browser);
            const list = await page.evaluate(() => slash.buildItems().map(i => ({k: i.k, t: i.t, disabled: i.disabled})));
            assert.deepEqual(list.map(i => i.k), AGREED);
            assert.deepEqual(await page.evaluate(() => actions.SLASH.map(c => c.k)), AGREED);
            assert.ok(list.every(i => !i.disabled), 'all commands are live while editing');
            /* Every command is an item of the menu, and none is a view setting or a switch of the window. */
            const kinds = await page.evaluate(keys => keys.map(k => {
                const it = actions.command(k);
                return it && Common.UI.Compact.MenuModel.kindOf(it);
            }), AGREED);
            assert.ok(kinds.every(Boolean), 'each command is in the catalog');
            assert.ok(AGREED.every(k => /^(insert|format)\./.test(k)), 'only insert and format commands');
            assert.ok(kinds.every(kind => kind !== 'check'), 'no switches');
            /* Labels: the slash names of the commands. */
            assert.deepEqual(list.map(i => i.t), ['Heading 1', 'Heading 2', 'Heading 3', 'Normal text',
                'Apply bulleted list', 'Apply numbered list', 'Insert 3×3 table', 'Insert image', 'Insert page break',
                'Add comment', 'Add or edit link', 'Insert table of contents', 'Insert footnote', 'Insert equation',
                'Insert section break', 'Insert blank page', 'Insert horizontal line']);
            /* The list on the screen. */
            await page.evaluate(() => slash.show());
            assert.equal(await page.locator('#vo-slash.open .vo-slash-item').count(), AGREED.length);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('slash command runs the menu command', async () => {
            const page = await quick.open(browser);
            const keys = AGREED.filter(k => k !== 'insert.table');
            for (const k of keys) {
                /* The menu: the item run through the adapter of the menu bar. */
                const menu = await page.evaluate(k => {
                    ctx.log.length = 0;
                    const ran = shell.menuAdapter.exec(actions.command(k));
                    return ran;
                }, k);
                assert.equal(menu, true, k + ' runs from the menu');
                const fromMenu = await effects(page);
                assert.ok(fromMenu.length, k + ' does something');
                /* The link window opened by the menu closes before the slash opens it again. */
                await page.evaluate(() => tb.closePopovers());
                /* The slash: typed «/», chosen with the keyboard. */
                const index = await page.evaluate(k => {
                    ctx.log.length = 0;
                    slash.show();
                    const i = slash.visible().findIndex(item => item.k === k);
                    slash.index = i;
                    return i;
                }, k);
                assert.ok(index >= 0, k + ' is in the list');
                await page.focus('#area_id');
                await page.keyboard.press('Enter');
                assert.equal(await page.evaluate(() => slash.open), false, 'the list closes');
                assert.deepEqual(await effects(page), fromMenu, k + ' does what the menu item does');
                assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.api === 'pluginMethod_InputText')
                    .map(e => e.args)), [['', '/']], k + ': the typed slash is erased');
                await page.evaluate(() => tb.closePopovers());
            }
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('slash table passes three by three', async () => {
            const page = await quick.open(browser);
            assert.deepEqual(await page.evaluate(() => actions.SLASH.find(c => c.k === 'insert.table').args),
                {cols: 3, rows: 3});
            await page.evaluate(() => {
                ctx.log.length = 0;
                slash.show();
                slash.apply(slash.visible().findIndex(item => item.k === 'insert.table'));
            });
            assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.api === 'put_Table').map(e => e.args)), [[3, 3]]);
            /* The same item of the menu with the same size from its size grid. */
            await page.evaluate(() => {
                ctx.log.length = 0;
                actions.command('insert.table.grid').run({columns: 3, rows: 3});
            });
            assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.api === 'put_Table').map(e => e.args)), [[3, 3]]);
            await page.close();
        });

        await check('viewer sees no slash commands', async () => {
            const page = await quick.open(browser, {context: {rights: 'view'}});
            assert.deepEqual(await page.evaluate(() => slash.buildItems()), []);
            await page.evaluate(() => slash.show());
            assert.equal(await page.evaluate(() => slash.open), false, 'no list at all');
            assert.equal(await page.locator('#vo-slash.open').count(), 0);
            /* Comment and link follow their own rights in the menu: without the right to comment the slash has
               no comment either. */
            const noComments = await quick.open(browser, {context: {comments: false}});
            const keys = await noComments.evaluate(() => slash.buildItems().map(i => i.k));
            assert.equal(keys.includes('insert.comment'), false);
            assert.equal(keys.length, AGREED.length - 1);
            await noComments.close();
            await page.close();
        });

        await check('locked command is shown greyed with its reason and not applied', async () => {
            /* Protection «comments only»: commenting is allowed, everything else is greyed with the reason. */
            const page = await quick.open(browser, {context: {protection: {isCommentsOnly: true}}});
            await page.addStyleTag({content: stylesheet()});
            await page.evaluate(() => slash.show());
            const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#vo-slash .vo-slash-item'))
                .map(b => ({t: b.querySelector('.vo-slash-t').textContent, hint: b.querySelector('.vo-slash-h').textContent,
                    locked: b.classList.contains('vo-locked'), aria: b.getAttribute('aria-disabled'),
                    on: b.classList.contains('on'), color: getComputedStyle(b.querySelector('.vo-slash-t')).color,
                    cursor: getComputedStyle(b).cursor})));
            assert.equal(rows.length, AGREED.length, 'greyed commands stay in the list');
            const comment = rows.find(r => r.t === 'Add comment');
            assert.deepEqual([comment.locked, comment.aria, comment.on], [false, null, true],
                'the live command is chosen first');
            for (const r of rows.filter(r => r.t !== 'Add comment')) {
                assert.equal(r.locked, true, r.t + ' greyed');
                assert.equal(r.aria, 'true', r.t);
                assert.equal(r.hint, 'The document is protected', r.t + ' shows the reason');
                assert.notEqual(r.color, comment.color, r.t + ' looks greyed');
                assert.equal(r.cursor, 'default', r.t + ' does not invite a click');
            }
            /* A click on a greyed command does nothing: no call, the typed text stays, the list stays. */
            await page.evaluate(() => { ctx.log.length = 0; });
            await page.locator('#vo-slash .vo-slash-item').first().click({force: true});
            assert.deepEqual(await effects(page), []);
            assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.api === 'pluginMethod_InputText')), []);
            assert.equal(await page.evaluate(() => slash.open), true);
            /* Arrows pass the greyed ones by. */
            await page.focus('#area_id');
            await page.keyboard.press('ArrowDown');
            assert.equal(await page.evaluate(() => slash.visible()[slash.index].k), 'insert.comment');
            await page.close();

            /* A lock that comes while the list is shown: the chosen command does not run and turns grey. */
            const late = await quick.open(browser);
            await late.evaluate(() => { slash.show(); ctx.log.length = 0; ctx.reasons = ['offline']; });
            await late.evaluate(() => slash.apply(0));
            assert.deepEqual(await effects(late), []);
            assert.deepEqual(await late.evaluate(() => ctx.log.filter(e => e.api === 'pluginMethod_InputText')), []);
            assert.equal(await late.evaluate(() => slash.open), true);
            const first = await late.evaluate(() => {
                const b = document.querySelector('#vo-slash .vo-slash-item');
                return {locked: b.classList.contains('vo-locked'), hint: b.querySelector('.vo-slash-h').textContent};
            });
            assert.deepEqual(first, {locked: true, hint: 'No connection'});
            /* With every command greyed Enter is the document's again: the list closes, the key is not taken. */
            const taken = await late.evaluate(() => {
                const e = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
                document.getElementById('area_id').dispatchEvent(e);
                return e.defaultPrevented;
            });
            assert.equal(taken, false);
            assert.equal(await late.evaluate(() => slash.open), false);
            assert.deepEqual(late.errors, []);
            await late.close();
        });
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
