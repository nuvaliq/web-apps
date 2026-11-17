/* Run: node test/unit-tests/pdfeditor/compact-title.cjs [copies of shell modules…]
 * The title and the sharing of the compact shell of the PDF viewer on its one bar (there is no
 * header): at the start of the bar the PDF icon · the title; sharing in the end zone before ⋮, only
 * with its right (canRequestSharingSettings or sharingSettingsUrl), sent to the stock notification
 * and locked while disconnected; there is no version history — neither on the bar nor in ⋮ nor as a
 * command of the shell, even with its right (canUseHistory); the title — a
 * field only with the rename right (canRename and not the desktop app), a text otherwise, read-only
 * once the right is lost, the name shown without its extension and renamed the stock way; ⋮ >
 * Rename puts the focus into it.
 *
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH), see lib/shell-page.cjs.
 * Texts are read from the page (English locale or own defaults), not written here. Optional
 * arguments: copies of modules (by file name) for a negative control.
 */
'use strict';

const assert = require('node:assert/strict');
const H = require('./lib/shell-page.cjs');

/* The bar as a person reads it: the start zone and which of history and sharing the end zone holds. */
const bar = page => page.evaluate(() => {
    const tb = document.getElementById('vo-tb');
    if (!tb) return null;
    const start = tb.querySelector('[data-zone="start"]'), end = tb.querySelector('[data-zone="end"]');
    const kind = e => e.getAttribute('data-vo') || e.getAttribute('data-vo-wrap') || (e.classList.contains('vo-title') ? 'title' : e.classList.contains('vo-file-icon') ? 'icon' : e.localName);
    return {
        start: Array.from(start.children).map(kind),
        collab: Array.from(end.children).map(kind).filter(k => k === 'history' || k === 'sharing'),
        order: Array.from(end.children).map(kind),
        shown: Array.from(end.querySelectorAll('[data-vo="history"], [data-vo="sharing"]')).every(e => e.getClientRects().length > 0),
        header: !!document.getElementById('vo-header')
    };
});

const title = page => page.evaluate(() => {
    const t = document.querySelector('#vo-tb .vo-title');
    return t && {tag: t.localName, value: t.localName === 'input' ? t.value : t.textContent, readonly: t.hasAttribute('readonly'),
        tip: t.getAttribute('title'), tabindex: t.getAttribute('tabindex'), focused: document.activeElement === t};
});

(async () => {
    const {check, done} = H.checker();
    const browser = await H.launch();
    try {
        /* Keys of the open ⋮ list. */
        const menuKeys = async page => {
            await page.click('#vo-tb [data-vo="more"]');
            const keys = await page.evaluate(() => Array.from(document.querySelectorAll('#vo-tb .vo-mn-drop.open [data-k]')).map(e => e.getAttribute('data-k')));
            await page.evaluate(() => shell.menu.close());
            return keys;
        };

        await check('no header: PDF icon · title start the bar; sharing sits before ⋮; no version history', async () => {
            const page = await H.open(browser);
            const b = await bar(page);
            assert.ok(b, 'no #vo-tb');
            assert.equal(b.header, false, 'a header is still there');
            assert.deepEqual(b.start, ['icon', 'title'], 'the start of the bar');
            assert.deepEqual(b.order.slice(-2), ['sharing', 'more'], 'sharing · ⋮ at the end');
            assert.deepEqual(b.collab, ['sharing'], 'history is still on the bar');
            assert.ok(b.shown, 'sharing is not shown');
            const look = await page.evaluate(() => {
                const e = document.querySelector('#vo-tb [data-vo="sharing"]');
                return [!!e.querySelector(':scope > .vo-air'), e.classList.contains('vo-tinted')];
            });
            assert.deepEqual(look, [true, true], 'AIR glyph; sharing tinted');
            const keys = await menuKeys(page);
            assert.equal(keys.includes('file.history'), false, 'Version history is in ⋮');
            assert.equal(await page.evaluate(() => shell.hasCommand('history')), false, 'the shell has a history command');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('sharing only with its right; no history with or without its right', async () => {
            const cases = [
                [{canUseHistory: false}, ['sharing']],
                [{canRequestSharingSettings: false}, []],
                [{canRequestSharingSettings: false, sharingSettingsUrl: 'https://portal.test/share'}, ['sharing']],
                [{canUseHistory: false, canRequestSharingSettings: false}, []]
            ];
            for (const [rights, want] of cases) {
                const page = await H.open(browser, {rights});
                assert.deepEqual((await bar(page)).collab, want, JSON.stringify(rights));
                assert.equal((await menuKeys(page)).includes('file.history'), false, 'history in ⋮: ' + JSON.stringify(rights));
                await page.close();
            }
        });

        await check('sharing goes to the stock notification, not while disconnected', async () => {
            const page = await H.open(browser);
            await page.click('#vo-tb [data-vo="sharing"]');
            const sent = () => page.evaluate(() => stock.events.map(e => e.name).filter(n => /^collaboration:/.test(n)));
            assert.deepEqual(await sent(), ['collaboration:sharing']);
            await page.evaluate(() => { stock.main._state.isDisconnected = true; Common.NotificationCenter.trigger('api:disconnect'); });
            const locked = await page.evaluate(() => {
                const b = document.querySelector('#vo-tb [data-vo="sharing"]');
                return [b.getAttribute('aria-disabled'), b.classList.contains('vo-locked')];
            });
            assert.deepEqual(locked, ['true', true], 'sharing is not locked after the disconnect');
            /* A person can still press a locked control (aria-disabled, not disabled). */
            await page.click('#vo-tb [data-vo="sharing"]', {force: true});
            assert.deepEqual(await sent(), ['collaboration:sharing'], 'a locked control sends');
            await page.close();
        });

        await check('title: a field only with the rename right, the name without .pdf', async () => {
            let page = await H.open(browser);
            let t = await title(page);
            assert.equal(t.tag, 'input', 'with the rename right the title is not a field');
            assert.equal(t.value, 'Report', 'the name is shown with its extension');
            assert.equal(t.readonly, false);
            await page.close();

            for (const rights of [{canRename: false}, {canRename: true, isDesktopApp: true}]) {
                page = await H.open(browser, {rights});
                t = await title(page);
                assert.equal(t.tag, 'span', JSON.stringify(rights) + ': the title is a field');
                assert.equal(t.value, 'Report');
                assert.equal(t.tip, 'Report.pdf', 'the full name is not in the tip');
                await page.close();
            }

            page = await H.open(browser, {title: 'Quarter v2.final.pdf'});
            assert.equal((await title(page)).value, 'Quarter v2.final', 'only the last extension is dropped');
            await page.evaluate(() => stock.fire('asc_onDocumentName', 'Annual.pdf'));
            assert.equal((await title(page)).value, 'Annual', 'a name from the engine');
            await page.evaluate(() => stock.fire('asc_onMeta', {title: 'Board.pdf'}));
            assert.equal((await title(page)).value, 'Board', 'a name from the portal');
            await page.close();
        });

        await check('title: rename the stock way, read-only once the right is lost', async () => {
            let page = await H.open(browser);
            const renames = () => page.evaluate(() => stock.calls('gateway', 'requestRename').map(a => a[0]));
            await page.fill('#vo-tb .vo-title', 'Annual');
            await page.press('#vo-tb .vo-title', 'Enter');
            assert.deepEqual(await renames(), ['Annual'], 'Enter does not rename');
            assert.equal((await title(page)).focused, false, 'the field keeps the focus after Enter');
            await page.fill('#vo-tb .vo-title', 'Draft');
            await page.press('#vo-tb .vo-title', 'Escape');
            assert.deepEqual(await renames(), ['Annual'], 'Escape renames');
            assert.equal((await title(page)).value, 'Annual', 'Escape does not revert');

            /* The stock code takes canRename away on a co-authoring disconnect. */
            await page.evaluate(() => { stock.main.appOptions.canRename = false; Common.NotificationCenter.trigger('api:disconnect'); });
            const t = await title(page);
            assert.equal(t.readonly, true, 'the field stays open after the right is gone');
            assert.equal(t.tabindex, '-1');
            assert.equal(t.tip, await page.evaluate(() => shell.tipRenameDisabled));
            await page.evaluate(() => { const f = document.querySelector('#vo-tb .vo-title'); f.value = 'Other'; f.dispatchEvent(new Event('blur')); });
            assert.deepEqual(await renames(), ['Annual'], 'a name is sent without the right');
            assert.equal((await title(page)).value, 'Annual', 'the typed name is not reverted');
            await page.close();

            /* With the stock header the name goes by its rename event, as LeftMenu listens. */
            page = await H.open(browser, {before: () => { stock.header = {fireEvent: (n, a) => stock.note('header', n, a)}; }});
            await page.fill('#vo-tb .vo-title', 'Annual');
            await page.press('#vo-tb .vo-title', 'Enter');
            assert.deepEqual(await page.evaluate(() => stock.calls('header', 'rename')), [['Annual']]);
            assert.deepEqual(await page.evaluate(() => stock.calls('gateway', 'requestRename')), []);
            await page.close();
        });

        await check('title: invalid characters give the stock error, the value stays, one window, focus comes back', async () => {
            const page = await H.open(browser);
            const renames = () => page.evaluate(() => stock.calls('gateway', 'requestRename').map(a => a[0]));
            const errors = () => page.evaluate(() => stock.calls('error', 'open').map(a => a[0]));
            const phrase = await page.evaluate(() => Common.Views.RenameDialog.prototype.txtInvalidName);
            assert.match(phrase, /cannot contain any of the following characters/, 'the phrase is not the one of the locale');
            const want = phrase + '*+:"<>?|/';

            /* Enter: one stock window with the list, nothing sent, the typed value stays. */
            await page.fill('#vo-tb .vo-title', 'a:b');
            await page.press('#vo-tb .vo-title', 'Enter');
            assert.deepEqual(await errors(), [want], 'Enter with a bad name: the windows');
            assert.deepEqual(await renames(), [], 'a name with a bad character is sent');
            assert.equal((await title(page)).value, 'a:b', 'a bad name is reverted');
            /* The focus goes to the window: the blur of the field is not a second commit. */
            await page.evaluate(() => document.querySelector('#vo-tb .vo-title').blur());
            await H.settle(page);
            assert.deepEqual(await errors(), [want], 'the blur opened a second window');
            assert.equal((await title(page)).value, 'a:b', 'the blur reverted the name');
            assert.equal(await page.evaluate(() => stock.closeError()), true);
            await page.waitForFunction(() => document.activeElement === document.querySelector('#vo-tb .vo-title'), null, {timeout: 3000});
            const sel = await page.evaluate(() => {
                const f = document.querySelector('#vo-tb .vo-title');
                return [f.selectionStart, f.selectionEnd, f.value.length];
            });
            assert.deepEqual(sel, [0, 3, 3], 'the text is not selected after the window');
            assert.deepEqual(await errors(), [want], 'the callback opened a window');

            /* After the window the field commits again: a valid name goes out. */
            await page.fill('#vo-tb .vo-title', 'Annual');
            await page.press('#vo-tb .vo-title', 'Enter');
            assert.deepEqual(await renames(), ['Annual'], 'a valid name after the window');
            assert.deepEqual(await errors(), [want]);

            /* Blur alone with a bad name: one window, as the stock title. */
            await page.fill('#vo-tb .vo-title', 'x?y');
            await page.evaluate(() => document.querySelector('#vo-tb .vo-title').blur());
            await H.settle(page);
            assert.equal((await errors()).length, 2, 'the blur gives one more window');
            assert.equal(await page.evaluate(() => stock.closeError()), true);
            await page.waitForFunction(() => document.activeElement === document.querySelector('#vo-tb .vo-title'), null, {timeout: 3000});

            /* Esc rolls back to the previous name; an empty name rolls back silently. */
            await page.press('#vo-tb .vo-title', 'Escape');
            assert.equal((await title(page)).value, 'Annual', 'Escape does not revert');
            await page.fill('#vo-tb .vo-title', '  ');
            await page.press('#vo-tb .vo-title', 'Enter');
            assert.equal((await title(page)).value, 'Annual', 'an empty name is not reverted');
            assert.equal((await errors()).length, 2, 'an empty name gave a window');
            assert.deepEqual(await renames(), ['Annual']);
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });

        await check('⋮ > Rename puts the focus into the title', async () => {
            const page = await H.open(browser);
            await page.click('#vo-tb [data-vo="more"]');
            await page.click('#vo-tb [data-k="file.rename"]');
            const t = await page.evaluate(() => {
                const f = document.querySelector('#vo-tb .vo-title');
                return {focused: document.activeElement === f, selected: [f.selectionStart, f.selectionEnd], length: f.value.length};
            });
            assert.equal(t.focused, true, 'the title is not focused');
            assert.deepEqual(t.selected, [0, t.length], 'the name is not selected');
            await page.close();
            const none = await H.open(browser, {rights: {canRename: false}});
            await none.click('#vo-tb [data-vo="more"]');
            assert.equal(await none.locator('#vo-tb [data-k="file.rename"]').count(), 0, '⋮ > Rename without the right');
            await none.close();
        });
    } finally {
        await browser.close();
    }
    done();
})().catch(e => { console.log('FAIL run —', e && e.stack || e); process.exitCode = 1; });
