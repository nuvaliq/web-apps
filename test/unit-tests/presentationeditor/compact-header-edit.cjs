/* Run: node test/unit-tests/presentationeditor/compact-header-edit.cjs [--only <name>] */
'use strict';

const assert = require('node:assert/strict');
const h = require('./acceptance/mode-harness.cjs');
const fixture = require('./fixtures/compact-header-page.cjs');

async function withBrowser(check) {
    const browser = await fixture.launch();
    try {
        await check(async (options, run) => {
            const page = await fixture.open(browser, {cssPath: process.env.COMPACT_CSS_PRESENTATIONEDITOR, ...options});
            try {
                await run(page);
                assert.deepEqual(page.errors, [], 'errors from the shell on the browser page');
            } finally {
                await page.close();
            }
        });
    } finally {
        await browser.close();
    }
}

function headerEdit(page) {
    return page.locator('#vo-header').getByRole('button', {name: 'Редактировать', exact: true});
}

async function tabFromSharing(page) {
    // Place focus before Edit, then let SDK capture handle the native Tab.
    await page.evaluate(() => {
        keyOwner.enabled = false;
        document.querySelector('.vo-hd-sharing').focus();
        keyOwner.enabled = true;
    });
    await page.keyboard.press('Tab');
}

function reader(cli, setup) {
    const w = h.createWorld({edit: false, requestEdit: true}, cli);
    if (setup) setup(w);
    h.boot(w);
    return w;
}

const edit = w => w.doc.querySelector('.vo-hd-right > button.vo-mode');
const requestCount = w => w.calls.filter(c => c.target === 'Gateway' && c.name === 'requestEditRights').length;
const status = w => w.modules.SlideActions.menu.status().textContent;

function lock(w, locked) {
    const button = edit(w);
    assert.ok(button, 'no Edit button in the compact header');
    assert.equal(button.getAttribute('aria-disabled'), String(locked));
    assert.equal(button.classList.contains('vo-locked'), locked);
    return button;
}

function click(w) {
    assert.ok(edit(w), 'no Edit button in the compact header');
    edit(w).click();
}
function file(w) {
    const actions = w.modules.SlideActions;
    return actions.exec(actions.item('requestEdit'), w.shell);
}

h.run([
    {name: 'header_and_file_share_open_request', fn(cli) {
        for (const [first, second] of [[click, file], [file, click]]) {
            const w = reader(cli);
            lock(w, false);
            const before = h.mark(w);
            first(w);
            assert.equal(h.since(w, before).api.some(call => /Restriction/.test(call.name)), false);
            assert.equal(h.since(w, before).notices.some(notice => notice.name === 'vo:mode'), false);
            lock(w, true);
            const actions = w.modules.SlideActions;
            assert.equal(actions.itemState(actions.item('requestEdit')).disabled, true);
            assert.equal(status(w), h.ruText('PE.Controllers.LeftMenu.requestEditRightsText'));
            second(w);
            assert.equal(requestCount(w), 1);
            w.flush();
            lock(w, false);
            assert.equal(status(w), h.ruText('PE.Controllers.Main.textEditRequestFailed'));
            second(w);
            lock(w, true);
            assert.equal(requestCount(w), 1);
            assert.equal(status(w), h.ruText('PE.Controllers.LeftMenu.requestEditRightsText'));
            w.controllers.Main.onProcessRightsChange({enabled: false, message: 'Try again'});
            lock(w, false);
            assert.equal(status(w), 'Try again');
            click(w);
            assert.equal(requestCount(w), 2);
            assert.equal(w.shell.editRight(), false);
            assert.equal(w.appOptions.isEdit, false);
        }
    }},

    {name: 'header_rechecks_current_rights', fn(cli) {
        for (const key of ['canEdit', 'canRequestEditRights']) {
            const w = reader(cli);
            lock(w, false);
            w.appOptions[key] = false;
            click(w);
            assert.equal(requestCount(w), 0);
            lock(w, true);
        }
        const w = reader(cli);
        w.NC.trigger('collaboration:sharingdeny');
        lock(w, true);
        assert.equal(w.shell.runEditRequest(), false);
        assert.equal(requestCount(w), 0);
    }},

    {name: 'missing_request_owner_has_no_header_entry', fn(cli) {
        for (const name of ['markEditRequest', 'isEditRequestWaiting']) {
            let w = reader(cli, world => { world.controllers.Main[name] = undefined; });
            assert.equal(edit(w), null);
            assert.equal(typeof w.shell.runEditRequest, 'function');
            assert.equal(w.shell.runEditRequest(), false);
            assert.equal(requestCount(w), 0);

            w = reader(cli);
            lock(w, false);
            w.controllers.Main[name] = undefined;
            click(w);
            lock(w, true);
            assert.equal(requestCount(w), 0);
        }
    }},

    {name: 'header_request_tracks_external_locks_and_disconnect', fn(cli) {
        const w = reader(cli);
        lock(w, false);
        w.NC.trigger('editing:disable', true, {}, 'vo-view');
        lock(w, false);
        w.NC.trigger('editing:disable', true, {}, 'history');
        lock(w, true);
        assert.equal(w.shell.runEditRequest(), false);
        w.NC.trigger('editing:disable', false, {}, 'history');
        lock(w, false);

        w.controllers.Main._state.isDisconnected = true;
        w.NC.trigger('api:disconnect');
        lock(w, true);
        assert.equal(w.shell.runEditRequest(), false);
        w.controllers.Main._state.isDisconnected = false;
        w.NC.trigger('editing:disable', false, {}, 'vo-view');
        lock(w, false);

        w.fire('asc_onCoAuthoringDisconnect');
        w.controllers.Main._state.isDisconnected = true;
        w.flush();
        lock(w, true);
        assert.equal(w.shell.runEditRequest(), false);
        assert.equal(requestCount(w), 0);
    }},

    {name: 'show_and_advanced_roundtrip', fn(cli) {
        const w = reader(cli);
        const slot = h.byId(w, 'vo-hdr-show');
        assert.equal(slot.firstElementChild, h.showControl(w).root);
        w.NC.trigger('preview:start', 0);
        lock(w, true);
        assert.equal(w.shell.runEditRequest(), false);
        w.endShow();
        lock(w, false);

        w.shell.toggleMode();
        assert.equal(w.shell.runEditRequest(), false);
        w.NC.trigger('editing:disable', true, {}, 'history');
        lock(w, true);
        w.shell.toggleMode();
        lock(w, true);
        w.NC.trigger('editing:disable', false, {}, 'history');
        lock(w, false);
        assert.equal(slot.firstElementChild, h.showControl(w).root);

        w.ctx.Common.Utils.ModalWindow = {isVisible: () => true};
        assert.equal(w.shell.runEditRequest(), false);
        assert.equal(requestCount(w), 0);
    }}
,

    {name: 'native_keys_request_once', async fn() {
        await withBrowser(async open => {
            for (const key of ['Enter', 'Space']) {
                await open({}, async page => {
                    const button = headerEdit(page);
                    await button.focus({timeout: 2000});
                    await page.keyboard.press(key);
                    assert.equal(await page.evaluate(() => requestCount), 1, key);
                    assert.equal(await button.getAttribute('aria-disabled'), 'true');
                    assert.equal(await button.evaluate(el => document.activeElement === el), true);
                    assert.equal(await page.evaluate(() => keyOwner.engine), false);
                    await page.keyboard.press(key);
                    assert.equal(await page.evaluate(() => requestCount), 1, 'repeat while waiting');

                    await page.evaluate(() => main.onProcessRightsChange({enabled: false, message: 'Try again'}));
                    assert.equal(await button.getAttribute('aria-disabled'), 'false');
                    await page.keyboard.press('Tab');
                    assert.equal(await page.evaluate(() => document.activeElement.id), 'area_id');
                    assert.equal(await page.evaluate(() => keyOwner.engine), true);
                    await page.keyboard.type('Text');
                    assert.equal(await page.locator('#area_id').inputValue(), 'Text');
                });
            }
            await open({}, async page => {
                const button = headerEdit(page);
                await page.evaluate(() => Common.NotificationCenter.trigger('editing:disable', true, {}, 'history'));
                assert.equal(await button.getAttribute('aria-disabled'), 'true');
                await button.focus();
                await page.keyboard.press('Enter');
                await page.keyboard.press('Space');
                assert.equal(await page.evaluate(() => requestCount), 0);
                assert.equal(await button.evaluate(el => document.activeElement === el), true);
                assert.equal(await page.evaluate(() => keyOwner.engine), false);
            });
        });
    }},

    {name: 'native_f10_and_reverse_tab_reach_header_edit', async fn() {
        await withBrowser(async open => {
            await open({}, async page => {
                await page.keyboard.press('F10');
                assert.equal(await page.evaluate(() => !!document.activeElement.closest('.vo-mn')), true);
                await page.keyboard.press('Shift+Tab');
                await page.waitForFunction(() => document.activeElement === document.querySelector('.vo-hd-right > .vo-mode'));
                assert.equal(await headerEdit(page).evaluate(el => document.activeElement === el), true);
                await page.keyboard.press('Enter');
                assert.equal(await page.evaluate(() => requestCount), 1);
            });
        });
    }},

    {name: 'header_metrics_and_focus', async fn() {
        await withBrowser(async open => {
            for (const width of [1280, 768]) {
                await open({width}, async page => {
                    const button = headerEdit(page);
                    assert.equal(await button.count(), 1);
                    assert.equal(await button.getAttribute('aria-haspopup'), null);
                    const metrics = await button.evaluate(el => {
                        const title = document.querySelector('.vo-hd-title');
                        const style = getComputedStyle(el);
                        const cluster = el.parentElement;
                        return {
                            height: el.getBoundingClientRect().height, font: style.fontSize,
                            padding: [style.paddingLeft, style.paddingRight],
                            order: Array.from(cluster.children, child => child.id ||
                                Array.from(child.classList).find(name => ['vo-hd-history', 'vo-download', 'vo-hd-sharing', 'vo-mode'].includes(name))),
                            overlap: title.getBoundingClientRect().right > cluster.getBoundingClientRect().left,
                            clipped: title.scrollWidth > title.clientWidth,
                            insideViewport: el.getBoundingClientRect().right <= innerWidth
                        };
                    });
                    assert.deepEqual(metrics, {
                        height: 32, font: '15px', padding: ['12px', '12px'],
                        order: ['vo-hdr-show', 'vo-hd-history', 'vo-download', 'vo-hd-sharing', 'vo-mode'],
                        overlap: false, clipped: true, insideViewport: true
                    });
                    assert.equal(await page.locator('#vo-hdr-show .vo-show').count(), 1);
                    assert.equal(await page.locator('.vo-docmode').count(), 0);
                });
            }

            await open({}, async page => {
                const button = headerEdit(page);
                await button.evaluate(el => el.classList.remove('canfocused'));
                await tabFromSharing(page);
                assert.equal(await page.evaluate(() => document.activeElement.id), 'area_id', 'SDK capture control');
                await button.evaluate(el => el.classList.add('canfocused'));
                await tabFromSharing(page);
                assert.equal(await button.evaluate(el => document.activeElement === el), true);
                assert.equal(await button.evaluate(el => el.matches(':focus-visible')), true);
                assert.notEqual(await button.evaluate(el => getComputedStyle(el).boxShadow), 'none');
                assert.equal(await page.evaluate(() => keyOwner.engine), false);

                await page.evaluate(() => { keyOwner.modal = true; document.getElementById('area_id').focus(); });
                assert.equal(await page.evaluate(() => keyOwner.engine), false, 'modal owns the keyboard');
                await page.evaluate(() => { keyOwner.modal = false; });
                await button.focus();
                await page.evaluate(() => shell.toggleMode());
                const back = page.locator('#vo-back');
                assert.equal(await back.isVisible(), true);
                assert.equal(await back.evaluate(el => el.classList.contains('vo-back-float')), true);
                assert.deepEqual(await back.evaluate(el => {
                    const style = getComputedStyle(el);
                    return [style.height, style.paddingLeft, style.paddingRight];
                }), ['28px', '12px', '12px']);
                assert.equal(await page.evaluate(() => keyOwner.engine), true);
                assert.equal(await page.evaluate(() => document.activeElement.id), 'area_id');
                await back.click();
                assert.equal(await button.isVisible(), true);
                assert.equal(await button.evaluate(el => document.activeElement === el), false);
            });

            await open({appOptions: {isEdit: true}}, async page => {
                const mode = page.locator('.vo-docmode > .vo-mode');
                assert.equal(await mode.count(), 1);
                assert.deepEqual(await mode.evaluate(el => {
                    const style = getComputedStyle(el);
                    return [style.height, style.fontSize, style.paddingLeft, style.paddingRight];
                }), ['32px', '15px', '12px', '6px']);
                assert.equal(await headerEdit(page).count(), 0);
            });
        });
    }}
]);
