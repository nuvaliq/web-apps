/* Run: NODE_PATH=<playwright package> node test/unit-tests/documenteditor/compact-toolbar-scroll.cjs
 * Headless Chrome, a real DOM/native wheel and a local AMD CompactToolbar.
 * The optional argument: the path to the source AMD for checking the red baseline.
 * This checks the scroll isolation mechanism, not QA of applying formatting in the SDK.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../../..');
const file = process.argv[2] || path.join(root, 'apps/documenteditor/main/app/view/CompactToolbar.js');
(async () => {
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 900, height: 600}});
        await page.setContent(`<style>
            body {height:3000px;margin:0} #viewport {position:fixed;top:20px;left:20px}
            .vo-pop {width:200px;height:140px;overflow:auto;background:white}
            .row, .vo-pop-item {height:40px;display:block;width:100%} .vo-pop-rest {height:80px;overflow:auto}
            </style><div id="viewport"><div id="menu" class="vo-pop"></div></div>`);
        await page.addScriptTag({content: fs.readFileSync(path.join(root, 'vendor/jquery/jquery.js'), 'utf8')});
        await page.evaluate(() => {
            window.DE = {Views: {}};
            window._ = {extend: Object.assign};
            window.define = (deps, factory) => factory({svg: () => ""});
            window.received = [];
            ['wheel', 'mousewheel', 'DOMMouseScroll'].forEach(type => {
                document.getElementById('viewport').addEventListener(type, event => {
                    received.push({type, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey, alt: event.altKey});
                    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) event.preventDefault();
                }, {passive: false});
            });
        });
        await page.addScriptTag({content: fs.readFileSync(file, 'utf8')});
        await page.evaluate(() => {
            document.getElementById('menu').remove();
            DE.Views.CompactToolbar._values = [];
            const control = DE.Views.CompactToolbar.valueBtn('fixture', 'Size',
                Array.from({length:20}, (_, i) => ({v:i + 1, t:String(i + 1)})),
                value => { window.picked = value; });
            control.find('.vo-pop').attr('id', 'menu');
            control.appendTo('#viewport');
        });
        let passed = 0;
        async function check(name, run) { await run(); console.log('PASS', name); passed++; }
        async function rows(n = 20, nested = false) {
            await page.evaluate(({n, nested}) => {
                const menu = document.getElementById('menu');
                menu.innerHTML = (nested ? '<div class="vo-pop-rest">' : '') +
                    Array.from({length:n}, (_,i) => `<div class="row">${i}</div>`).join('') + (nested ? '</div><div style="height:400px"></div>' : '');
                menu.scrollTop = 0; window.scrollTo(0, 300); received.length = 0;
            }, {n, nested});
        }
        async function wheel(delta, selector = '#menu') {
            const box = await page.locator(selector).boundingBox();
            await page.mouse.move(box.x + 40, box.y + 20);
            await page.mouse.wheel(0, delta);
            await page.waitForTimeout(150);
        }
        const positions = () => page.evaluate(() => ({menu: menu.scrollTop,
            inner: document.querySelector('.vo-pop-rest')?.scrollTop || 0, doc: scrollY, received: received.length}));
        await check('real valueBtn list scrolls, last option selects and menu closes', async () => {
            await page.locator('.vo-value-btn').click();
            await page.evaluate(() => window.scrollTo(0, 300));
            await wheel(5000);
            const pos = await positions(); assert(pos.menu > 0); assert.equal(pos.doc, 300);
            await page.locator('#menu .vo-pop-item').last().click();
            assert.equal(await page.evaluate(() => picked), '20');
            assert.equal(await page.locator('.vo-value-btn').getAttribute('aria-expanded'), 'false');
        });
        await check('native wheel in both directions; SDK and document isolated', async () => {
            await rows(); await wheel(240);
            let pos = await positions(); assert(pos.menu > 0); assert.equal(pos.doc, 300); assert.equal(pos.received, 0);
            await wheel(-240); pos = await positions(); assert.equal(pos.menu, 0); assert.equal(pos.doc, 300);
        });
        await check('large delta and repeated top/bottom edge wheel do not chain', async () => {
            await rows(); await wheel(5000); await wheel(5000);
            let pos = await positions(); assert.equal(pos.menu, 660); assert.equal(pos.doc, 300);
            await wheel(-5000); await wheel(-5000); pos = await positions(); assert.equal(pos.menu, 0); assert.equal(pos.doc, 300);
        });
        await check('nested native container, both edges, does not chain into outer menu', async () => {
            await rows(20, true); await wheel(200, '.vo-pop-rest');
            let pos = await positions(); assert(pos.inner > 0); assert.equal(pos.menu, 0); assert.equal(pos.doc, 300);
            await wheel(5000, '.vo-pop-rest'); await wheel(5000, '.vo-pop-rest'); pos = await positions();
            assert.equal(pos.inner, 720); assert.equal(pos.menu, 0); assert.equal(pos.doc, 300);
            await wheel(-5000, '.vo-pop-rest'); await wheel(-5000, '.vo-pop-rest'); pos = await positions();
            assert.equal(pos.inner, 0); assert.equal(pos.menu, 0); assert.equal(pos.doc, 300);
        });
        await check('no overflow creates no artificial scroll and shields the document', async () => {
            await rows(2); await wheel(240); await wheel(-240);
            const pos = await positions(); assert.equal(pos.menu, 0); assert.equal(pos.doc, 300); assert.equal(pos.received, 0);
        });
        await check('wheel and legacy modifiers preserve bubbling/default and original inline styles', async () => {
            await rows();
            await page.evaluate(() => {
                menu.style.setProperty('overscroll-behavior-x', 'none', 'important');
                menu.style.setProperty('overscroll-behavior-y', 'auto');
            });
            for (const type of ['wheel', 'mousewheel', 'DOMMouseScroll']) {
                for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
                    await wheel(80);
                    const result = await page.evaluate(({type, modifier}) => {
                        const event = new WheelEvent(type, {bubbles: true, cancelable: true, deltaY: 80, [modifier]: true});
                        received.length = 0; const accepted = menu.dispatchEvent(event);
                        return {accepted, received: received.length,
                            x: menu.style.getPropertyValue('overscroll-behavior-x'),
                            xp: menu.style.getPropertyPriority('overscroll-behavior-x'),
                            y: menu.style.getPropertyValue('overscroll-behavior-y'),
                            yp: menu.style.getPropertyPriority('overscroll-behavior-y')};
                    }, {type, modifier});
                    assert.deepEqual(result, {accepted:true, received:1, x:'none', xp:'important', y:'auto', yp:''});
                }
            }
        });
        await check('legacy normal events stop SDK cancellation without canceling native default', async () => {
            await rows();
            for (const type of ['mousewheel', 'DOMMouseScroll']) {
                const result = await page.evaluate(type => {
                    received.length = 0;
                    const event = new WheelEvent(type, {bubbles:true, cancelable:true, deltaY:120});
                    const accepted = menu.dispatchEvent(event);
                    return {accepted, received:received.length};
                }, type);
                assert.deepEqual(result, {accepted:true, received:0});
            }
        });
        await check('sibling scroll containers retain separate styles and restore on modifiers', async () => {
            await page.evaluate(() => {
                menu.innerHTML = '<div class="vo-pop-rest first" style="overscroll-behavior-y:none!important">' +
                    '<div style="height:800px"></div></div><div class="vo-pop-rest second"><div style="height:800px"></div></div>';
                for (const selector of ['.first', '.second']) {
                    const target = menu.querySelector(selector);
                    target.dispatchEvent(new WheelEvent('wheel', {bubbles:true, cancelable:true, deltaY:80}));
                }
            });
            const result = await page.evaluate(() => {
                const first = menu.querySelector('.first'), second = menu.querySelector('.second');
                const preserved = first.style.getPropertyValue('overscroll-behavior-y');
                second.dispatchEvent(new WheelEvent('wheel', {bubbles:true, cancelable:true, deltaY:80, shiftKey:true}));
                return {preserved, firstPriority:first.style.getPropertyPriority('overscroll-behavior-y'),
                    second:second.style.getPropertyValue('overscroll-behavior-y')};
            });
            assert.deepEqual(result, {preserved:'none', firstPriority:'important', second:''});
        });
        await check('moving controls to overflow menu and reopening retains scroll listener', async () => {
            await rows(); await page.evaluate(() => {
                const more = document.createElement('div'); more.id = 'more';
                document.getElementById('viewport').appendChild(more); more.appendChild(menu);
                more.style.display = 'none'; more.style.display = 'block';
            });
            await wheel(180); const pos = await positions(); assert(pos.menu > 0); assert.equal(pos.doc, 300); assert.equal(pos.received,0);
        });
        console.log(`${passed} passed; Chrome ${browser.version()}; ${file}`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });