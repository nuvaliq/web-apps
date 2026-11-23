/* Run: node test/unit-tests/documenteditor/compact-slash-word-delete.cjs
 * Modified Backspace must cancel slash commands before the editor processes deletion.
 * The real menu runs over the quick-page fixture; native document editing is checked separately.
 */
const assert = require('node:assert/strict');
const quick = require('./fixtures/compact-quick-page.cjs');

const effects = page => page.evaluate(() => ctx.log.filter(e =>
    e.api === 'pluginMethod_InputText' || e.api === 'onKeyDown' || e.api === 'put_Style'));

async function openMenu(page, filter = '') {
    await page.focus('#area_id');
    await page.keyboard.type('/' + filter);
    assert.equal(await page.evaluate(() => slash.open), true);
    assert.equal(await page.evaluate(() => slash.filter), filter);
    assert.ok(await page.evaluate(() => slash.first() >= 0));
    await page.evaluate(() => { ctx.log.length = 0; });
}

async function keyEvent(page, key, init = {}) {
    return page.evaluate(({key, init}) => {
        const area = document.getElementById('area_id');
        let observed = null;
        area.addEventListener('keydown', e => {
            observed = {open: slash.open, filter: slash.filter, prevented: e.defaultPrevented,
                shown: document.getElementById('vo-slash').classList.contains('open'),
                focused: document.activeElement.id};
        }, {once: true});
        const e = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...init});
        area.dispatchEvent(e);
        return {prevented: e.defaultPrevented, observed};
    }, {key, init});
}

async function cancelled(page, filter, init) {
    const result = await keyEvent(page, 'Backspace', init);
    assert.deepEqual(result, {prevented: false, observed: {
        open: false, filter, prevented: false, shown: false, focused: 'area_id'
    }});
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(await page.evaluate(() => slash.open), false);
    assert.equal(await page.locator('#vo-slash.open').count(), 0);
    assert.deepEqual(await effects(page), []);
}

(async () => {
    const browser = await quick.launch();
    const {check, done} = quick.checker();
    const run = (name, fn, options) => check(name, async () => {
        const page = await quick.open(browser, options);
        try {
            await fn(page);
            assert.deepEqual(page.errors, []);
        } finally {
            await page.close();
        }
    });
    try {
        for (let mask = 1; mask < 8; mask++) {
            for (const shiftKey of [false, true]) {
                for (const filter of ['', 'Heading']) {
                    const init = {altKey: !!(mask & 1), ctrlKey: !!(mask & 2),
                        metaKey: !!(mask & 4), shiftKey};
                    await run('modified Backspace cancels before editing ' + JSON.stringify({init, filter}),
                        async page => {
                            await openMenu(page, filter);
                            await cancelled(page, filter, init);
                        });
                }
            }
        }

        for (const missing of [[], ['pluginMethod_InputText']]) {
            for (const init of [{altKey: true}, {ctrlKey: true}, {metaKey: true}]) {
                for (const action of ['Enter', 'Tab', 'apply', 'repeat']) {
                    await run('after cancellation ' + JSON.stringify({init, missing, action}), async page => {
                        await openMenu(page, 'Heading');
                        await cancelled(page, 'Heading', init);
                        if (action === 'apply') await page.evaluate(() => slash.apply(0));
                        else {
                            const key = action === 'repeat' ? 'Backspace' : action;
                            const flags = action === 'repeat' ? {...init, repeat: true} : {};
                            const result = await keyEvent(page, key, flags);
                            assert.equal(result.prevented, false);
                            assert.ok(result.observed, 'the event reaches the editor target');
                            assert.equal(result.observed.open, false);
                            if (action === 'repeat') {
                                const enter = await keyEvent(page, 'Enter');
                                assert.equal(enter.prevented, false);
                                assert.ok(enter.observed, 'Enter reaches the editor after key repetition');
                            }
                        }
                        assert.equal(await page.evaluate(() => slash.open), false);
                        assert.deepEqual(await effects(page), []);
                    }, {context: {missing}});
                }
            }
        }

        for (const shift of [false, true]) {
            await run('single-character Backspace keeps a usable query, Shift=' + shift, async page => {
                await page.focus('#area_id');
                await page.keyboard.type('KEEP ');
                await openMenu(page, 'Heading');
                await page.keyboard.press(shift ? 'Shift+Backspace' : 'Backspace');
                assert.equal(await page.evaluate(() => slash.open), true);
                assert.equal(await page.evaluate(() => slash.filter), 'Headin');
                assert.equal((await keyEvent(page, 'Enter')).prevented, true);
                assert.equal(await page.evaluate(() => slash.open), false);
                assert.deepEqual(await effects(page), [
                    {api: 'pluginMethod_InputText', args: ['', '/Headin']},
                    {api: 'put_Style', args: ['Heading 1']}
                ]);
            });
            await run('Backspace on the bare slash closes normally, Shift=' + shift, async page => {
                await openMenu(page);
                assert.equal((await keyEvent(page, 'Backspace', {shiftKey: shift})).prevented, false);
                await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
                assert.equal(await page.evaluate(() => slash.open), false);
                assert.deepEqual(await effects(page), []);
            });
        }

        await run('modifier keys and a capital letter remain normal input', async page => {
            await openMenu(page);
            for (const [key, flag] of [['Alt', 'altKey'], ['Control', 'ctrlKey'],
                ['Meta', 'metaKey'], ['Shift', 'shiftKey']]) {
                const result = await keyEvent(page, key, {[flag]: true});
                assert.equal(result.prevented, false);
                assert.equal(result.observed.open, true);
                assert.equal(result.observed.filter, '');
            }
            await page.keyboard.press('Shift+H');
            assert.equal(await page.evaluate(() => slash.open), true);
            assert.equal(await page.evaluate(() => slash.filter), 'H');
            assert.ok(await page.evaluate(() => slash.first() >= 0));
            assert.deepEqual(await effects(page), []);
        });

        await run('a pending render cannot revive a cancelled query', async page => {
            await openMenu(page);
            const immediate = await page.evaluate(() => {
                const area = document.getElementById('area_id');
                area.dispatchEvent(new KeyboardEvent('keydown', {key: 'H', bubbles: true, cancelable: true}));
                area.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Backspace', altKey: true, bubbles: true, cancelable: true
                }));
                return {open: slash.open, filter: slash.filter};
            });
            assert.deepEqual(immediate, {open: false, filter: 'H'});
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
            assert.equal(await page.locator('#vo-slash.open').count(), 0);
            assert.equal((await keyEvent(page, 'Enter')).prevented, false);
            assert.deepEqual(await effects(page), []);
        });

        await run('a new slash forgets the cancelled filter', async page => {
            await openMenu(page, 'Heading');
            await cancelled(page, 'Heading', {altKey: true});
            await page.keyboard.press('Enter');
            await openMenu(page);
            assert.equal(await page.evaluate(() => slash.visible()[slash.index].k), 'format.style.heading1');
            await keyEvent(page, 'Enter');
            assert.deepEqual(await effects(page), [
                {api: 'pluginMethod_InputText', args: ['', '/']},
                {api: 'put_Style', args: ['Heading 1']}
            ]);
        });

        await run('a disabled matching command preserves the query on click', async page => {
            await page.focus('#area_id');
            await page.keyboard.type('/Heading');
            assert.equal(await page.evaluate(() => slash.open), true);
            assert.equal(await page.evaluate(() => slash.filter), 'Heading');
            const item = page.locator('#vo-slash .vo-slash-item').first();
            assert.equal(await item.getAttribute('aria-disabled'), 'true');
            assert.ok(await item.locator('.vo-slash-h').textContent());
            await page.evaluate(() => { ctx.log.length = 0; });
            await item.locator('.vo-slash-t').click({force: true});
            assert.equal(await page.evaluate(() => slash.open), true);
            assert.equal(await page.evaluate(() => slash.filter), 'Heading');
            assert.deepEqual(await effects(page), []);
        }, {context: {protection: {isCommentsOnly: true}}});

        for (const key of ['Enter', 'Tab']) {
            await run(key + ' passes through when all matching commands are disabled', async page => {
                await page.focus('#area_id');
                await page.keyboard.type('/Heading');
                assert.equal(await page.evaluate(() => slash.open), true);
                assert.ok(await page.evaluate(() => slash.visible().length > 0));
                assert.equal(await page.evaluate(() => slash.visible().every(item => item.disabled)), true);
                assert.equal(await page.evaluate(() => slash.first()), -1);
                await page.evaluate(() => { ctx.log.length = 0; });
                assert.equal((await keyEvent(page, key)).prevented, false);
                assert.equal(await page.evaluate(() => slash.open), false);
                assert.deepEqual(await effects(page), []);
            }, {context: {protection: {isCommentsOnly: true}}});
        }

        for (const mode of ['advanced', 'locked']) {
            await run('a new ' + mode + ' restriction still dismisses an open menu', async page => {
                await openMenu(page, 'Heading');
                await page.evaluate(mode => {
                    if (mode === 'advanced') shell.advanced = true;
                    else lock(true);
                }, mode);
                assert.equal((await keyEvent(page, 'Backspace', {altKey: true})).prevented, false);
                assert.equal(await page.evaluate(() => slash.open), false);
                assert.deepEqual(await effects(page), []);
                assert.equal((await keyEvent(page, '/')).prevented, false);
                assert.equal(await page.evaluate(() => slash.open), false);
                assert.deepEqual(await effects(page), []);
            });
        }
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
