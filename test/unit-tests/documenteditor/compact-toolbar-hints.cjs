const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../../..');
const view = path.join(root, 'apps/documenteditor/main/app/view');
const locale = lang => JSON.parse(fs.readFileSync(path.join(root,
    'apps/documenteditor/main/locale', lang + '.json'), 'utf8'));

(async () => {
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1728, height: 700},
            // The desktop user agent enables the product's Chrome geometry correction in headless runs.
            userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
                `Chrome/${browser.version()} Safari/537.36`});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<iframe style="border:0;width:100%;height:650px" srcdoc=""></iframe>');
        const frame = page.frames()[1];
        await frame.setContent(`<style>
            body {margin:0;height:1600px} #vo-tb {display:flex;gap:12px;padding:12px}
            .vo-g,.vo-of,.vo-tb-end {display:flex;gap:4px;align-items:center}
            .vo-ib {height:32px;min-width:32px;padding:4px}
            .vo-air {display:inline-block;width:18px;height:18px}
            .vo-pop-wrap,.vo-cb,.vo-more-wrap {position:relative}
            .vo-pop,.vo-cb-pop,.vo-of-pop {display:none}
            .open>.vo-pop,.open>.vo-cb-pop {display:block;position:absolute;background:white}
            .vo-of-open .vo-of-pop {display:flex;position:absolute;right:0;top:100%;background:white}
            .vo-collapsed {display:none!important}
            .vo-advanced #vo-tb,.vo-tb-hidden #vo-tb {display:none}
            .tooltip {position:absolute;opacity:0}.tooltip.in {opacity:1}
            .tooltip-inner {background:white;border:1px solid gray;padding:5px 12px;max-width:300px}
            </style><button id="header" title="Header reference">Header</button>
            <div id="toolbar"></div>`);
        await frame.addScriptTag({content: fs.readFileSync(path.join(root, 'vendor/jquery/jquery.js'), 'utf8')});
        await frame.addScriptTag({content: fs.readFileSync(path.join(root, 'vendor/underscore/underscore.js'), 'utf8')});
        await frame.evaluate(() => {
            document.body.className = 'vo-compact';
            window.hintListeners = new Map();
            const add = EventTarget.prototype.addEventListener;
            const remove = EventTarget.prototype.removeEventListener;
            const tracked = (target, name) => (target === document || target === window) &&
                ['pointerdown', 'keydown', 'scroll', 'blur'].includes(name);
            const keyFor = (target, name, capture) => `${target === document ? 'document' : 'window'}:${name}:${!!capture}`;
            EventTarget.prototype.addEventListener = function (name, handler, capture) {
                if (tracked(this, name)) {
                    const key = keyFor(this, name, capture);
                    if (!hintListeners.has(key)) hintListeners.set(key, new Set());
                    hintListeners.get(key).add(handler);
                }
                return add.call(this, name, handler, capture);
            };
            EventTarget.prototype.removeEventListener = function (name, handler, capture) {
                if (tracked(this, name)) hintListeners.get(keyFor(this, name, capture))?.delete(handler);
                return remove.call(this, name, handler, capture);
            };
            window.calls = [];
            window.callbacks = {};
            window.Asc = {CHyperlinkProperty: function () {}};
            window.testScale = 1;
            window.AscCommon = {
                checkDeviceScale: () => ({devicePixelRatio, applicationPixelRatio: 1,
                    correct: testScale !== 1, zoom: testScale}),
                correctApplicationScale: scale => {
                    document.documentElement.style.zoom = scale.correct ? 1 / scale.zoom : '';
                }
            };
            const handlers = {};
            window.Common = {UI: {DimensionPicker: function () {this.on = () => {};}},
                NotificationCenter: {
                    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
                    trigger(name, ...args) { (handlers[name] || []).forEach(fn => fn(...args)); }
                }};
            window.DE = {Views: {}, getController: () => null};
            DE.Views.CompactShell = {
                canAddComment: () => true,
                stockLeftBtn: () => null,
                toggleFocus() {
                    document.body.classList.toggle('vo-top-hidden');
                    document.body.classList.remove('vo-tb-hidden');
                },
                closeSurfaces() {
                    DE.Views.CompactToolbar.closeOverflow();
                    DE.Views.CompactToolbar.closePopovers();
                }
            };
            window.Icons = {svg: () => '<span class="vo-air" aria-hidden="true"></span>'};
            window.define = (deps, factory) => {
                if (deps.includes('documenteditor/main/app/view/Icons')) {
                    factory(Icons, window.ToolbarHints);
                } else {
                    window.ToolbarHints = factory();
                }
            };
        });
        await frame.addScriptTag({content: fs.readFileSync(path.join(root,
            'apps/common/main/lib/util/utils.js'), 'utf8')});
        const hintsFile = path.join(view, 'ToolbarHints.js');
        if (fs.existsSync(hintsFile)) await frame.addScriptTag({content: fs.readFileSync(hintsFile, 'utf8')});
        await frame.addScriptTag({content: fs.readFileSync(path.join(view, 'CompactToolbar.js'), 'utf8')});
        // Buttons paired with a menu item run the item of the menu catalog.
        await frame.evaluate(() => { window.define = (deps, factory) => factory(); });
        await frame.addScriptTag({content: fs.readFileSync(path.join(view, 'DocumentActions.js'), 'utf8')});

        async function build(lang = 'en') {
            await frame.evaluate(translations => {
                const tb = DE.Views.CompactToolbar;
                const prefix = 'DE.Views.CompactToolbar.';
                for (const [key, value] of Object.entries(translations)) {
                    if (key.startsWith(prefix)) tb[key.slice(prefix.length)] = value;
                }
                tb.api = new Proxy({}, {get: (target, key) => (...args) => {
                    if (key === 'asc_registerCallback') callbacks[args[0]] = args[1];
                    else calls.push([key, ...args]);
                }});
                DE.Views.DocumentActions.init(tb.api, DE.Views.CompactShell);
                const old = tb.el;
                const next = tb.build();
                if (old) old.remove();
                next.appendTo('#toolbar');
                tb.bindApi();
                callbacks.asc_onCanUndo(false);
                callbacks.asc_onCanRedo(false);
            }, locale(lang));
            await page.mouse.move(10, 600);
        }
        const tooltip = frame.getByRole('tooltip');
        const button = name => frame.locator('#vo-tb button.vo-ib')
            .and(frame.getByRole('button', {name, exact: true}));
        async function hover(target, edge = false) {
            const box = await target.boundingBox();
            assert(box, 'visible target');
            await page.mouse.move(box.x + (edge ? 2 : box.width / 2), box.y + box.height / 2);
        }
        async function expectHint(target, text, edge = false) {
            await page.mouse.move(10, 600);
            await hover(target, edge);
            await tooltip.waitFor({state: 'visible', timeout: 1500});
            assert.equal(await tooltip.innerText(), text);
            assert.equal(await tooltip.count(), 1);
        }
        async function check(name, action) {
            await action();
            console.log('PASS', name);
        }

        await build();
        await check('every toolbar control shows its localized text on glyph and padding', async () => {
            const entries = await frame.locator('#vo-tb button.vo-ib').evaluateAll(bs => bs
                .filter(b => b.getBoundingClientRect().width)
                .map(b => b.title || b.getAttribute('aria-label') || DE.Views.CompactToolbar.tipParagraphStyle));
            assert.equal(entries.length, 25);
            for (const name of entries) {
                const target = frame.locator('#vo-tb button.vo-ib:visible');
                const index = entries.indexOf(name);
                await expectHint(target.nth(index), name);
                await page.mouse.move(10, 600);
                await expectHint(target.nth(index), name, true);
                await page.mouse.move(10, 600);
                await tooltip.waitFor({state: 'detached', timeout: 500});
            }
        });
        await check('disabled controls retain their state and do not execute commands', async () => {
            const undo = frame.locator('#vo-tb button.vo-ib').first();
            await expectHint(undo, await undo.getAttribute('aria-label'));
            await undo.click({force: true});
            assert.equal(await undo.isDisabled(), true);
            assert.deepEqual(await frame.evaluate(() => calls.filter(c => c[0] === 'Undo')), []);
        });
        await check('rapid hover, leaving before delay, click and Escape cancel hints', async () => {
            const bold = button('Bold');
            const italic = button('Italic');
            await hover(bold);
            await hover(italic);
            await expectHint(italic, 'Italic');
            await page.keyboard.press('Escape');
            await tooltip.waitFor({state: 'detached', timeout: 500});
            await hover(bold);
            await page.mouse.move(10, 600);
            await page.waitForTimeout(600);
            assert.equal(await tooltip.count(), 0);
            await expectHint(bold, 'Bold');
            await bold.click();
            await tooltip.waitFor({state: 'detached', timeout: 500});
            assert.equal(await frame.evaluate(() => calls.filter(c => c[0] === 'put_TextPrBold').length), 1);
        });
        await check('clicked controls suppress hints until pointer leaves the whole button', async () => {
            const italic = button('Italic');
            await expectHint(italic, 'Italic');
            await italic.click();
            await hover(italic, true);
            await page.waitForTimeout(600);
            assert.equal(await tooltip.count(), 0, 'moving from glyph to padding after click stays suppressed');
            await italic.locator('.vo-air').dispatchEvent('pointerover', {pointerType: 'mouse'});
            await page.waitForTimeout(600);
            assert.equal(await tooltip.count(), 0, 'child pointerover after click stays suppressed');
            await expectHint(italic, 'Italic');
        });
        await check('keyboard activation away from the pointer keeps the next hover available', async () => {
            const italic = button('Italic');
            for (const key of ['Space', 'Enter']) {
                await page.mouse.move(10, 600);
                const before = await frame.evaluate(() => calls.filter(c => c[0] === 'put_TextPrItalic').length);
                await italic.focus();
                await page.keyboard.press(key);
                assert.equal(await frame.evaluate(() => calls.filter(c => c[0] === 'put_TextPrItalic').length),
                    before + 1, `${key} executes the command`);
                await hover(italic);
                await tooltip.waitFor({state: 'visible', timeout: 1500});
                assert.equal(await tooltip.innerText(), 'Italic');
            }
        });
        await check('open menus cancel pending hints and suppress their trigger only', async () => {
            const font = button('Font');
            await page.mouse.move(10, 600);
            await hover(font);
            await font.focus();
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(600);
            assert.equal(await tooltip.count(), 0, 'keyboard opening cancels the pending hint');
            await page.mouse.move(10, 600);
            await hover(font);
            await page.waitForTimeout(600);
            assert.equal(await tooltip.count(), 0, 'open trigger stays suppressed after re-entry');
            await expectHint(button('Italic'), 'Italic');
            await frame.evaluate(() => DE.Views.CompactToolbar.closePopovers());
            await expectHint(font, 'Font');
            await font.focus();
            await page.keyboard.press('ArrowDown');
            await tooltip.waitFor({state: 'detached', timeout: 500});
            await frame.evaluate(() => DE.Views.CompactToolbar.closePopovers());
        });
        await check('current title updates are escaped and preserve accessible names', async () => {
            const bold = button('Bold');
            await expectHint(bold, 'Bold');
            await frame.evaluate(() => DE.Views.CompactToolbar.ctrl.bold.attr('title', '<b>Updated</b>'));
            await page.waitForFunction(() => document.querySelector('iframe').contentDocument
                .querySelector('[role="tooltip"]').textContent === '<b>Updated</b>');
            assert.equal(await button('<b>Updated</b>').count(), 1);
            assert.equal(await tooltip.locator('b').count(), 0);
            assert.equal(await bold.count(), 0);
        });
        await check('text controls keep their accessible description without pointer hover', async () => {
            const client = await page.context().newCDPSession(page);
            const {frameTree} = await client.send('Page.getFrameTree');
            async function headingDescription() {
                const {nodes} = await client.send('Accessibility.getFullAXTree', {
                    frameId: frameTree.childFrames[0].frame.id
                });
                const heading = nodes.find(node => node.role?.value === 'button' && node.name?.value === 'Normal');
                assert(heading, 'heading control remains named by its current style');
                return heading.description?.value;
            }
            await page.mouse.move(10, 600);
            await frame.locator('.vo-heading-btn').focus();
            assert.equal(await headingDescription(), 'Paragraph style');
            await expectHint(frame.locator('.vo-heading-btn'), 'Paragraph style');
            assert.equal(await headingDescription(), 'Paragraph style', 'no duplicate description during hover');
            await page.mouse.move(10, 600);
            await tooltip.waitFor({state: 'detached', timeout: 500});
            assert.equal(await headingDescription(), 'Paragraph style', 'description survives pointer leave');
            await client.detach();
        });
        await check('mode changes, scrolling, resize and rebuild remove pending or visible hints', async () => {
            const descriptionCount = await frame.locator('.vo-toolbar-hint-description').count();
            assert(descriptionCount > 0);
            for (let i = 0; i < 5; i++) {
                await build();
                assert.equal(await frame.locator('.vo-toolbar-hint-description').count(), descriptionCount);
                await expectHint(button('Italic'), 'Italic');
                await frame.evaluate(() => document.body.classList.replace('vo-compact', 'vo-advanced'));
                await tooltip.waitFor({state: 'detached', timeout: 500});
                await frame.evaluate(() => document.body.classList.replace('vo-advanced', 'vo-compact'));
                await hover(button('Italic'));
                await build();
                await page.waitForTimeout(600);
                assert.equal(await tooltip.count(), 0);
            }
            await expectHint(button('Italic'), 'Italic');
            await frame.evaluate(() => window.dispatchEvent(new Event('scroll')));
            await tooltip.waitFor({state: 'detached', timeout: 500});
            await expectHint(button('Italic'), 'Italic');
            await page.setViewportSize({width: 800, height: 700});
            await tooltip.waitFor({state: 'detached', timeout: 500});
            const listenerCounts = await frame.evaluate(() => Array.from(hintListeners.values()).map(s => s.size));
            assert(listenerCounts.length >= 5);
            assert(listenerCounts.every(n => n === 1), 'one set of listeners after five rebuilds');
            await frame.evaluate(() => DE.Views.CompactToolbar.hints.destroy());
            assert((await frame.evaluate(() => Array.from(hintListeners.values()).map(s => s.size))).every(n => n === 0));
            assert.equal(await frame.locator('.vo-toolbar-hint-description').count(), 0);
            await build();
            await page.setViewportSize({width: 800, height: 700});
        });
        await check('overflow targets keep one hint within iframe bounds and menus close it', async () => {
            await expectHint(button('More'), 'More');
            await frame.evaluate(() => {
                DE.Views.CompactToolbar.relayout();
                DE.Views.CompactToolbar.openOverflow();
            });
            await page.waitForTimeout(600);
            assert.equal(await tooltip.count(), 0, 'opening overflow removes its visible trigger hint');
            await page.mouse.move(10, 600);
            await hover(button('More'));
            await page.waitForTimeout(600);
            assert.equal(await tooltip.count(), 0, 'overflow trigger stays suppressed while open');
            const targets = frame.locator('.vo-of-pop .vo-ib');
            assert(await targets.count(), 'actual overflow contains controls');
            for (const moved of await targets.all()) {
                await expectHint(moved, await moved.getAttribute('aria-label'));
            }
            const box = await tooltip.boundingBox();
            const bounds = await frame.evaluate(() => ({width: innerWidth, height: innerHeight}));
            assert(box.x >= 0 && box.x + box.width <= bounds.width + 8);
            assert(box.y >= 0 && box.y + box.height <= bounds.height + 8);
            await targets.first().click();
            await tooltip.waitFor({state: 'detached', timeout: 500});
        });
        await check('Russian labels and header title are preserved', async () => {
            await page.setViewportSize({width: 1728, height: 700});
            await build('ru');
            await expectHint(button('Полужирный'), 'Полужирный');
            assert.equal(await frame.locator('#header').getAttribute('title'), 'Header reference');
            assert.equal(await frame.locator('#vo-tb [title]').count(), 0);
        });
        await check('application scaling keeps hints anchored inside the iframe', async () => {
            await build();
            for (const scale of [1.1, 1.4]) {
                await frame.evaluate(value => {
                    testScale = value;
                    Common.Utils.checkSize();
                }, scale);
                const target = button('Italic');
                await expectHint(target, 'Italic');
                const anchor = await target.boundingBox();
                const hint = await tooltip.boundingBox();
                assert(Math.abs(hint.x + hint.width / 2 - anchor.x - anchor.width / 2) < 2,
                    `hint is centered over its control at scale ${scale}`);
                assert(hint.y >= anchor.y + anchor.height, 'hint does not overlap the toolbar');
                assert(hint.x >= 0 && hint.x + hint.width <= 1728, 'hint remains in the iframe');
            }
            await frame.evaluate(() => { testScale = 1; Common.Utils.checkSize(); });
        });
        await check('hints stay available on the toolbar while the top is collapsed', async () => {
            await expectHint(button('Focus mode'), 'Focus mode');
            await button('Focus mode').click();
            assert.equal(await frame.locator('body').evaluate(body => body.classList.contains('vo-top-hidden')), true);
            await expectHint(button('Focus mode'), 'Focus mode');
            await expectHint(button('Italic'), 'Italic');
            await button('Focus mode').click();
            await expectHint(button('Italic'), 'Italic');
        });
        await check('link dialog suppresses hints after leaving and returning to its button', async () => {
            await build();
            await frame.evaluate(() => {
                Asc.CHyperlinkProperty = function () {
                    this.put_Text = text => { this.text = text; };
                    this.get_Text = () => this.text;
                    this.get_Value = () => '';
                    this.get_Bookmark = () => null;
                    this.get_ToolTip = () => '';
                };
            });
            const link = button('Add or edit link');
            await link.click();
            const dialog = frame.locator('#vo-link');
            assert.equal(await dialog.evaluate(node => node.parentNode === document.body), true);
            assert.equal(await link.getAttribute('aria-expanded'), 'true');
            await dialog.locator('input').first().hover();
            await hover(link);
            await page.waitForTimeout(600);
            assert.equal(await tooltip.count(), 0, 'returning to the link button keeps its dialog unobscured');
            await page.keyboard.press('Escape');
            assert.equal(await link.getAttribute('aria-expanded'), 'false');
            await expectHint(link, 'Add or edit link');
        });
        await check('expanded state changes cancel pending and visible hints without class changes', async () => {
            const link = button('Add or edit link');
            for (const visible of [false, true]) {
                if (visible) await expectHint(link, 'Add or edit link');
                else {
                    await page.mouse.move(10, 600);
                    await hover(link);
                }
                await link.evaluate(node => node.setAttribute('aria-expanded', 'true'));
                if (visible) await tooltip.waitFor({state: 'detached', timeout: 500});
                await page.waitForTimeout(600);
                assert.equal(await tooltip.count(), 0, 'expanding the control cancels its hint');
                await expectHint(button('Italic'), 'Italic');
                await link.evaluate(node => node.setAttribute('aria-expanded', 'false'));
                await expectHint(link, 'Add or edit link');
            }
        });
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
