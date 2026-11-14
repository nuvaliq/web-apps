/* Run: node test/unit-tests/documenteditor/compact-status-scrollbars.cjs
 * Headless Chrome with the compiled documenteditor styles. The compact status
 * bar lies over the bottom of the document area; the editor scrollbars are
 * laid out by the SDK to the very bottom of the same area. Both bars must stay
 * reachable by the mouse above the status bar, and the thin thumb drawn over
 * a raised bar must stay visible over the page canvases. The markup, inline
 * geometry and z-indexes follow the SDK (sdkjs/word/api.js:1297–1321,
 * Controls.js Resize, scroll.js:480); the thumbs are placed as
 * OutlineRail.bindScrollbars places them. The SDK itself is not loaded.
 * Set PLAYWRIGHT_MODULE to the installed Playwright package when not in NODE_PATH.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const less = require(path.join(root, 'build/node_modules/less'));

const W = 1200, H = 700, BAR = 14;

(async () => {
    const lessFile = path.join(root, 'apps/documenteditor/main/resources/less/app.less');
    const css = await less.render(fs.readFileSync(lessFile, 'utf8'), {filename: lessFile,
        modifyVars: JSON.parse(fs.readFileSync(path.join(root, 'build/documenteditor.json'), 'utf8')).main.less.vars});
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
    let passed = 0, failed = 0;
    try {
        const page = await browser.newPage({viewport: {width: W, height: H + 40}});
        page.on('pageerror', error => console.error('Browser error:', error.message));

        /* SDK layout with the horizontal bar shown (wide page): the main view
           and the right panel end BAR above the bottom, the horizontal panel
           takes the last BAR pixels. */
        async function layout(horizontal) {
            const contentH = horizontal ? H - BAR : H;
            await page.setContent(`<style>${css.css}</style>
                <div id="area" style="position:relative;width:${W}px;height:${H}px">
                  <div id="editor_sdk" style="position:absolute;inset:0">
                    <div id="id_main" class="block_elem" style="position:absolute;left:0;top:0;width:${W - BAR}px;height:${contentH}px">
                      <div id="id_main_view" class="block_elem" style="position:absolute;inset:0;overflow:hidden">
                        <canvas id="id_viewer" class="block_elem" style="position:absolute;left:0;top:0;width:100%;height:100%;background-color:#fff;z-index:1"></canvas>
                        <canvas id="id_viewer_overlay" class="block_elem" style="position:absolute;left:0;top:0;width:100%;height:100%;z-index:2"></canvas>
                      </div>
                    </div>
                    <div id="id_panel_right" class="block_elem" style="position:absolute;left:${W - BAR}px;top:0;width:${BAR}px;height:${contentH}px;margin-right:1px;background-color:#f3f3f3">
                      <div id="id_vertical_scroll" style="left:0;top:0px;width:${BAR}px;overflow:hidden;position:absolute;height:${contentH}px"><canvas style="position:absolute;width:100%;height:100%;z-index:100"></canvas><div class="vo-sb-thumb vo-sb-v" style="display:block;top:200px;height:40px"></div></div>
                    </div>
                    <div id="id_horscrollpanel" class="block_elem" style="touch-action:none;margin-bottom:1px;background-color:#f3f3f3;position:absolute;left:0;top:${H - BAR}px;width:${W - BAR}px;height:${BAR}px;display:${horizontal ? 'block' : 'none'}">
                      <div id="id_horizontal_scroll" style="left:0px;top:0;height:${BAR}px;overflow:hidden;position:absolute;width:100%;"><canvas style="position:absolute;width:100%;height:100%;z-index:100"></canvas><div class="vo-sb-thumb vo-sb-h" style="display:block;left:300px;width:400px"></div></div>
                    </div>
                  </div>
                </div>
                <div id="statusbar"><div id="vo-status"><span class="vo-st-item">Page 1 of 1</span></div></div>`);
            await page.evaluate(() => document.body.classList.add('vo-compact'));
        }

        /* Where the bars are and what the mouse hits. The SDK maps the mouse
           into its scrollbar canvas through the offsetTop chain
           (sdkjs/common/scroll.js:553–566) and sizes the canvas by the holder's
           clientHeight (scroll.js:674–683). */
        const probe = () => page.evaluate(() => {
            const box = el => { const r = el.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right}; };
            const sdkY = (el, clientY) => { let top = 0; for (let o = el; o && o.tagName !== 'BODY'; o = o.offsetParent) top += o.offsetTop; return clientY - top; };
            const status = box(document.getElementById('vo-status'));
            const hc = document.querySelector('#id_horizontal_scroll canvas');
            const vc = document.querySelector('#id_vertical_scroll canvas');
            const vHolder = document.getElementById('id_vertical_scroll');
            const res = {status, v: box(vc), vHolderH: vHolder.clientHeight};
            const vx = (res.v.left + res.v.right) / 2, vy = res.v.bottom - 2;
            res.vHit = document.elementFromPoint(vx, vy) === vc;
            if (getComputedStyle(document.getElementById('id_horscrollpanel')).display !== 'none') {
                res.h = box(hc);
                const hx = (res.h.left + res.h.right) / 2, hy = (res.h.top + res.h.bottom) / 2;
                res.hHit = document.elementFromPoint(hx, hy) === hc;
                res.hSdkY = sdkY(hc, hy);
                res.hBg = getComputedStyle(document.getElementById('id_horscrollpanel')).backgroundColor;
                res.hThumbOnTop = paintedOnTop(document.querySelector('.vo-sb-h'));
            }
            return res;

            /* The thumb ignores the mouse and the SDK canvas over it is
               transparent: what is painted at its centre is the topmost
               element once both are made hit-testable / taken away. */
            function paintedOnTop(thumb) {
                const canvases = thumb.parentNode.querySelectorAll('canvas');
                canvases.forEach(c => { c.style.visibility = 'hidden'; });
                thumb.style.pointerEvents = 'auto';
                const r = thumb.getBoundingClientRect();
                const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
                thumb.style.pointerEvents = '';
                canvases.forEach(c => { c.style.visibility = ''; });
                return top === thumb || (top && top.id);
            }
        });

        async function check(name, run) {
            try {
                await run();
                console.log('PASS', name);
                passed++;
            } catch (error) {
                console.error('FAIL', name, error.message);
                failed++;
            }
        }

        await layout(true);
        const wide = await probe();
        assert.equal(Math.round(wide.status.bottom), H, 'status bar lies over the bottom of the area');
        assert(wide.status.top < H - BAR, 'status bar covers the bottom pixels of the area');

        await check('horizontal scrollbar lies above the status bar and takes the mouse', async () => {
            assert(wide.h.bottom <= wide.status.top, `bar bottom ${wide.h.bottom} > status top ${wide.status.top}`);
            assert.equal(wide.hHit, true, 'mouse over the bar reaches its canvas');
            assert(wide.hSdkY >= 0 && wide.hSdkY < BAR, `SDK sees the mouse at y ${wide.hSdkY} of its canvas`);
        });
        await check('raised horizontal scrollbar paints no band over the page', async () => {
            assert.equal(wide.hBg, 'rgba(0, 0, 0, 0)');
        });
        await check('thumb of the raised horizontal scrollbar is drawn over the page', async () => {
            assert.equal(wide.hThumbOnTop, true, `painted on top: ${wide.hThumbOnTop}`);
        });
        await check('vertical scrollbar ends above the raised horizontal one', async () => {
            assert(wide.v.bottom <= wide.h.top, `vertical bottom ${wide.v.bottom} > horizontal top ${wide.h.top}`);
            assert.equal(wide.vHit, true, 'mouse at the bottom of the vertical bar reaches its canvas');
            assert.equal(wide.vHolderH, Math.round(wide.v.bottom - wide.v.top), 'SDK sizes the canvas by the visible holder');
        });

        await layout(false);
        const narrow = await probe();
        await check('without the horizontal bar the vertical one ends above the status bar', async () => {
            assert(narrow.v.bottom <= narrow.status.top, `vertical bottom ${narrow.v.bottom} > status top ${narrow.status.top}`);
            assert.equal(narrow.vHit, true, 'mouse at the bottom of the vertical bar reaches its canvas');
            assert.equal(narrow.vHolderH, Math.round(narrow.v.bottom - narrow.v.top));
        });
        console.log(`${passed} passed, ${failed} failed; Chrome ${browser.version()}`);
    } finally {
        await browser.close();
    }
    process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
