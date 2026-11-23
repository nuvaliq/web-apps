/* Run: node test/unit-tests/documenteditor/compact-slash-dismiss.cjs
 * Slash dismissal must precede the SDK mouse handler even when it stops bubbling.
 * The real menu and catalog run over the quick-page engine fixture; document text
 * and persistence are checked separately in the full editor.
 */
const assert = require('node:assert/strict');
const quick = require('./fixtures/compact-quick-page.cjs');

const effects = page => page.evaluate(() => ctx.log.filter(e =>
    e.api === 'pluginMethod_InputText' || e.api === 'onKeyDown' || e.api === 'put_Style'));

async function openMenu(page, filter = '') {
    await page.focus('#area_id');
    await page.keyboard.type('/' + filter);
    assert.equal(await page.evaluate(() => slash.open), true, 'the typed slash opened the menu');
    assert.equal(await page.evaluate(() => slash.filter), filter);
    await page.evaluate(() => { ctx.log.length = 0; });
}

async function keyEvent(page, key) {
    return page.evaluate(key => {
        const e = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true});
        document.getElementById('area_id').dispatchEvent(e);
        return e.defaultPrevented;
    }, key);
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
        await run('SDK pointer handling cannot keep stale commands when it suppresses mousedown', async page => {
            await page.evaluate(() => {
                const overlay = document.createElement('div');
                overlay.id = 'id_viewer_overlay';
                overlay.style.cssText = 'position:absolute;left:900px;top:500px;width:200px;height:100px';
                overlay.addEventListener('pointerdown', e => {
                    window.atPointer = {open: slash.open, prevented: e.defaultPrevented};
                    e.preventDefault();
                    e.stopPropagation();
                });
                overlay.addEventListener('mousedown', () => { window.compatMouse = true; });
                document.getElementById('editor_sdk').appendChild(overlay);
            });
            await openMenu(page);
            await page.locator('#id_viewer_overlay').click();
            assert.deepEqual(await page.evaluate(() => window.atPointer), {open: false, prevented: false});
            assert.equal(await page.evaluate(() => !!window.compatMouse), false);
            assert.equal(await keyEvent(page, 'Enter'), false);
            assert.deepEqual(await effects(page), []);
        });

        for (const button of [0, 2]) {
            await run('standalone mousedown closes before SDK handling, button ' + button, async page => {
                await openMenu(page);
                const observed = await page.evaluate(button => {
                    const overlay = document.createElement('div');
                    document.getElementById('editor_sdk').appendChild(overlay);
                    let observed;
                    overlay.addEventListener('mousedown', e => {
                        observed = {open: slash.open, prevented: e.defaultPrevented};
                        e.stopPropagation();
                    });
                    overlay.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, button}));
                    return observed;
                }, button);
                assert.deepEqual(observed, {open: false, prevented: false});
                assert.deepEqual(await effects(page), []);
            });
        }

        for (const button of ['left', 'right']) {
            await run(button + ' SDK press closes before the handler that stops bubbling', async page => {
                await page.evaluate(() => {
                    const overlay = document.createElement('div');
                    overlay.id = 'id_viewer_overlay';
                    overlay.style.cssText = 'position:absolute;left:900px;top:500px;width:200px;height:100px';
                    overlay.addEventListener('mousedown', e => {
                        window.atSurface = {open: slash.open, prevented: e.defaultPrevented,
                            focused: document.activeElement.id};
                        e.preventDefault();
                        e.stopPropagation();
                    });
                    document.getElementById('editor_sdk').appendChild(overlay);
                });
                await openMenu(page);
                await page.locator('#id_viewer_overlay').click({button});
                assert.deepEqual(await page.evaluate(() => window.atSurface),
                    {open: false, prevented: false, focused: 'area_id'});
                assert.equal(await page.locator('#vo-slash.open').count(), 0);
                assert.equal(await keyEvent(page, 'Enter'), false);
                assert.equal(await keyEvent(page, 'Tab'), false);
                assert.deepEqual(await effects(page), []);
            });
        }

        for (const missing of [[], ['pluginMethod_InputText']]) {
            await run('closed menu cannot erase through ' + (missing.length ? 'Backspace' : 'InputText'),
                async page => {
                    await openMenu(page, 'Heading');
                    await page.evaluate(() => { slash.hide(); slash.apply(0); });
                    assert.deepEqual(await effects(page), []);
                    assert.equal(await page.evaluate(() => slash.open), false);
                }, {context: {missing}});
        }

        await run('a command cannot be applied twice', async page => {
            await openMenu(page);
            await page.evaluate(() => { slash.apply(0); slash.apply(0); });
            assert.deepEqual(await effects(page), [
                {api: 'pluginMethod_InputText', args: ['', '/']},
                {api: 'put_Style', args: ['Heading 1']}
            ]);
        });

        for (const filter of ['', 'Heading']) {
            for (const child of ['.vo-slash-i .vo-air', '.vo-slash-t']) {
                await run('click ' + child + ' applies a command with query ' + JSON.stringify(filter), async page => {
                    await openMenu(page, filter);
                    await page.locator('#vo-slash .vo-slash-item').first().locator(child).click();
                    assert.equal(await page.evaluate(() => slash.open), false);
                    assert.equal(await page.evaluate(() => document.activeElement.id), 'area_id');
                    assert.deepEqual(await effects(page), [
                        {api: 'pluginMethod_InputText', args: ['', '/' + filter]},
                        {api: 'put_Style', args: ['Heading 1']}
                    ]);
                });
            }
        }

        for (const key of ['Enter', 'Tab']) {
            await run(key + ' applies the filtered command once', async page => {
                await openMenu(page, 'Heading');
                assert.equal(await keyEvent(page, key), true);
                assert.equal(await page.evaluate(() => slash.open), false);
                assert.deepEqual(await effects(page), [
                    {api: 'pluginMethod_InputText', args: ['', '/Heading']},
                    {api: 'put_Style', args: ['Heading 1']}
                ]);
            });
            await run(key + ' belongs to the editor when no command matches', async page => {
                await openMenu(page, 'zzzzzz');
                assert.equal(await keyEvent(page, key), false);
                assert.equal(await page.evaluate(() => slash.open), false);
                assert.deepEqual(await effects(page), []);
            });
        }

        await run('a drag on the editor surface is not cancelled by the menu', async page => {
            await page.evaluate(() => {
                const canvas = document.createElement('canvas');
                canvas.id = 'drag-surface';
                canvas.style.cssText = 'position:absolute;left:900px;top:500px;width:200px;height:100px';
                canvas.addEventListener('mousedown', e => {
                    window.dragStart = {open: slash.open, prevented: e.defaultPrevented};
                    e.preventDefault();
                    e.stopPropagation();
                });
                canvas.addEventListener('mouseup', () => { window.dragEnded = true; });
                document.getElementById('editor_sdk').appendChild(canvas);
            });
            await openMenu(page);
            await page.mouse.move(920, 520);
            await page.mouse.down();
            await page.mouse.move(1000, 540, {steps: 3});
            await page.mouse.up();
            assert.deepEqual(await page.evaluate(() => window.dragStart), {open: false, prevented: false});
            assert.equal(await page.evaluate(() => window.dragEnded), true);
            assert.deepEqual(await effects(page), []);
        });

        await run('a panel click cancels the query and the next slash starts a fresh choice', async page => {
            await openMenu(page, 'Heading');
            await page.locator('#outside').click();
            assert.equal(await page.evaluate(() => slash.open), false);
            assert.deepEqual(await effects(page), []);
            await openMenu(page);
            assert.equal(await page.evaluate(() => slash.visible()[slash.index].k), 'format.style.heading1');
            await keyEvent(page, 'Enter');
            assert.deepEqual(await effects(page), [
                {api: 'pluginMethod_InputText', args: ['', '/']},
                {api: 'put_Style', args: ['Heading 1']}
            ]);
        });

        await run('a disabled command keeps the query and does not execute', async page => {
            await openMenu(page);
            const row = page.locator('#vo-slash .vo-slash-item').first();
            assert.equal(await row.getAttribute('aria-disabled'), 'true');
            assert.ok(await row.locator('.vo-slash-h').textContent());
            await row.locator('.vo-slash-t').click({force: true});
            assert.equal(await page.evaluate(() => slash.open), true);
            assert.deepEqual(await effects(page), []);
        }, {context: {protection: {isCommentsOnly: true}}});

        for (const mode of ['view', 'advanced']) {
            await run(mode + ' mode does not open or intercept slash commands', async page => {
                if (mode === 'advanced') await page.evaluate(() => { shell.advanced = true; });
                await page.focus('#area_id');
                await page.keyboard.type('/');
                assert.equal(await page.evaluate(() => slash.open), false);
                assert.equal(await keyEvent(page, 'Enter'), false);
                assert.deepEqual(await effects(page), []);
            }, {context: mode === 'view' ? {rights: 'view'} : {}});
        }
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
