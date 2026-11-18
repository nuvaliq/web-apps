/* Run: node test/unit-tests/documenteditor/compact-header-edit.cjs
 * Real header DOM, native keyboard activation and compiled header styles.
 * Request lifecycle and Main responses are covered by compact-edit-refusal.cjs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./fixtures/compact-shell-page.cjs');
const checks = fixture.checker();
const reader = {isEdit: false, canEdit: true, canRequestEditRights: true, canSwitchMode: false};
(async () => {
    const browser = await fixture.launch();
    async function open(extra = {}) {
        return fixture.open(browser, Object.assign({realHeader: true, sdkFocusCapture: true,
            context: {editMode: false, editRight: true, requestEdit: true, reasons: ['view']}, appOptions: reader}, extra));
    }
    try {
        await checks.check('reader_header_offers_edit_request_and_refreshes_initial_lock', async () => {
            const page = await open();
            try {
                assert.equal(await page.locator('.vo-hd-right > .vo-mode').count(), 1);
                assert.equal(await page.locator('.vo-docmode').count(), 0);
                assert.equal(await page.evaluate(() => initialHeaderDisabled), 'true');
                assert.equal(await page.getByRole('button', {name: 'Редактировать', exact: true}).getAttribute('aria-disabled'), 'false');
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });
        await checks.check('editor_and_forms_keep_existing_header', async () => {
            for (const options of [{canEdit: false}, {canRequestEditRights: false}, {isEdit: true},
                {canSwitchMode: true}, {isPDFForm: true}, {isOForm: true}]) {
                const page = await open({appOptions: Object.assign({}, reader, options)});
                try { assert.equal(await page.locator('.vo-hd-right > .vo-mode').count(), 0, JSON.stringify(options)); }
                finally { await page.close(); }
            }
        });
        for (const key of ['Enter', 'Space']) await checks.check('native_' + key + '_requests_once_and_keeps_keyboard', async () => {
            const page = await open();
            try {
                const button = page.getByRole('button', {name: 'Редактировать', exact: true});
                await button.focus();
                assert.equal(await button.evaluate(el => el === document.activeElement), true);
                await button.press(key);
                assert.equal(await page.evaluate(() => headerSent), 1);
                assert.equal(await button.getAttribute('aria-disabled'), 'true');
                await button.press(key);
                assert.equal(await page.evaluate(() => headerSent), 1);
                assert.equal(await button.evaluate(el => el === document.activeElement), true);
                await page.evaluate(() => focusText());
                assert.equal(await page.evaluate(() => document.activeElement.id), 'area_id');
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });
        await checks.check('sdk_capture_requires_canfocused_and_tab_reaches_button', async () => {
            const page = await open();
            try {
                const button = page.getByRole('button', {name: 'Редактировать', exact: true});
                await button.evaluate(el => {
                    const before = document.createElement('button');
                    before.id = 'focus-before'; before.className = 'canfocused';
                    el.before(before); el.classList.remove('canfocused'); before.focus();
                });
                await page.keyboard.press('Tab');
                assert.equal(await page.evaluate(() => document.activeElement.id), 'area_id');
                await button.evaluate(el => { el.classList.add('canfocused'); document.getElementById('focus-before').focus(); });
                await page.keyboard.press('Tab');
                assert.equal(await button.evaluate(el => el === document.activeElement), true);
            } finally { await page.close(); }
        });
        await checks.check('native_f10_and_reverse_tab_reach_header_edit', async () => {
            const page = await open();
            try {
                await page.evaluate(() => focusText());
                await page.keyboard.press('F10');
                assert.equal(await page.evaluate(() => document.activeElement.closest('.vo-mn') !== null), true);
                await page.keyboard.press('Shift+Tab');
                await fixture.settle(page);
                const button = page.getByRole('button', {name: 'Редактировать', exact: true});
                assert.equal(await button.evaluate(el => el === document.activeElement), true);
                await page.keyboard.press('Enter');
                assert.equal(await page.evaluate(() => headerSent), 1);
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });
        await checks.check('header_button_uses_header_metrics_at_both_widths', async () => {
            for (const width of [1280, 768]) {
                const page = await open({width});
                try {
                    const metrics = await page.locator('.vo-hd-right > .vo-mode').evaluate(el => {
                        const s = getComputedStyle(el), r = el.getBoundingClientRect();
                        return [s.height, s.fontSize, s.paddingLeft, s.paddingRight, r.right <= innerWidth];
                    });
                    assert.deepEqual(metrics, ['32px', '15px', '12px', '12px', true]);
                    const button = page.getByRole('button', {name: 'Редактировать', exact: true});
                    await button.focus();
                    assert.equal(await button.evaluate(el => el.matches(':focus-visible')), true);
                    assert.deepEqual(page.errors, []);
                } finally { await page.close(); }
            }
        });
        await checks.check('advanced_roundtrip_keeps_lock_and_releases_keyboard', async () => {
            const page = await open();
            try {
                const button = page.getByRole('button', {name: 'Редактировать', exact: true});
                await button.focus();
                await page.evaluate(() => shell.toggleMode());
                assert.equal(await page.evaluate(() => shell.runEditRequest()), false);
                assert.equal(await page.evaluate(() => ctx.log.filter(x => x.api === 'asc_enableKeyEvents').at(-1).args[0]), true);
                await page.evaluate(() => {
                    ctx.disconnected = true;
                    Common.NotificationCenter.trigger('api:disconnect');
                    shell.toggleMode();
                });
                assert.equal(await button.getAttribute('aria-disabled'), 'true');
                assert.equal(await page.evaluate(() => shell.runEditRequest()), false);
                assert.equal(await page.evaluate(() => headerSent), 0);
                await page.evaluate(() => {
                    ctx.disconnected = false;
                    Common.NotificationCenter.trigger('api:disconnect');
                });
                assert.equal(await button.getAttribute('aria-disabled'), 'false');
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });
        await checks.check('locales_provide_own_edit_button_label', () => {
            for (const [lang, text] of [['ru', 'Редактировать'], ['en', 'Edit'], ['de', 'Bearbeiten']]) {
                const file = path.join(fixture.ROOT, 'apps/documenteditor/main/locale', lang + '.json');
                assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))['DE.Views.CompactShell.textEdit'], text);
            }
        });
    } finally { await browser.close(); }
    checks.done();
})().catch(error => { console.error(error); process.exitCode = 1; });
