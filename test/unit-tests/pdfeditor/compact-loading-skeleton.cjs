/* Run: node test/unit-tests/pdfeditor/compact-loading-skeleton.cjs
 * The shell loading skeleton is written twice: in index.html (development) and in
 * index.html.deploy (the build). The build takes deploy, a development checkout
 * takes index.html, so a difference between them shows up in only one of them.
 * The check: both draw the same skeleton — styles and frame markup, and neither
 * hands any session the stock skeleton (the viewer has no exceptions: the page
 * does not know about the shell yet, and the bar is the same in every mode).
 * Then the skeleton is put on the stand of the shell (lib/shell-page.cjs, 1440 x 900): it
 * covers the page until the shell is built, takes its places from the bar the shell builds
 * (the card, the icon, the buttons, the pages and the page of the document) and is gone
 * after the build.
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH), see lib/shell-page.cjs.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const H = require('./lib/shell-page.cjs');

const DIR = path.join(H.ROOT, 'apps/pdfeditor/main');
const read = name => fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\r\n/g, '\n');
const pages = {dev: read('index.html'), deploy: read('index.html.deploy')};

/* The skeleton styles: from their opening comment to the end of <style>. */
function styles(html) {
    const start = html.indexOf('/* Compact shell skeleton.');
    assert.notEqual(start, -1, 'no skeleton styles');
    const end = html.indexOf('</style>', start);
    assert.notEqual(end, -1, 'skeleton styles are not closed');
    return html.slice(start, end);
}

/* The shell frame: the .skc subtree inside #loading-mask, by div balance. */
function frame(html) {
    const mask = html.indexOf('<div id="loading-mask"');
    assert.notEqual(mask, -1, 'no loading mask');
    const start = html.indexOf('<div class="skc">', mask);
    assert.notEqual(start, -1, 'no skeleton frame');
    const tags = /<(\/?)div\b[^>]*>/g;
    tags.lastIndex = start;
    let depth = 0, m;
    while ((m = tags.exec(html))) {
        depth += m[1] ? -1 : 1;
        if (!depth) return html.slice(start, tags.lastIndex);
    }
    throw new Error('skeleton frame is not closed');
}

/* The rectangles of the skeleton (inside #vo-loading) and of the bar (inside #vo-tb), the
   nodes that stand for each other, as [left, top, width, height]. */
const probe = () => {
    const box = n => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
    const all = (root, selector) => Array.from(document.querySelectorAll(root + ' ' + selector)).map(box);
    return {
        card: box(document.querySelector('.skc-card')),
        file: box(document.querySelector('.skc-file')),
        end: all('.skc-end', 'i'),
        mid: all('.skc-mid', 'i'),
        sheet: box(document.querySelector('.skc-page')),
        covered: !!document.elementFromPoint(720, 26).closest('#vo-loading')
    };
};
const built = () => {
    const box = n => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
    const tb = document.getElementById('vo-tb');
    const buttons = Array.from(tb.querySelectorAll('.vo-tb-end > .vo-ib, .vo-tb-end > .vo-more')).map(box);
    const nav = Array.from(tb.querySelectorAll('.vo-nav .vo-ib')).map(box);
    return {
        card: box(tb), file: box(tb.querySelector('.vo-file-icon')), end: buttons, nav: nav,
        zoom: box(tb.querySelector('.vo-w-zoom')), page: box(tb.querySelector('.vo-page-box')),
        canvas: box(document.getElementById('editor_sdk'))
    };
};
const centre = r => [r[0] + r[2] / 2, r[1] + r[3] / 2];
const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1, what + ': ' + a + ' against ' + b);

(async () => {
    const {check, done} = H.checker();

    await check('loading skeleton: the same styles in index.html and index.html.deploy', async () => {
        assert.equal(styles(pages.deploy), styles(pages.dev));
    });

    await check('loading skeleton: the same frame markup in both pages', async () => {
        assert.equal(frame(pages.deploy), frame(pages.dev));
    });

    await check('loading skeleton: both pages start with the shell skeleton on the mask', async () => {
        for (const [name, html] of Object.entries(pages))
            assert.match(html, /<div id="loading-mask" class="loadmask sk-shell">/, name);
    });

    await check('loading skeleton: no page hands a session the stock skeleton', async () => {
        for (const [name, html] of Object.entries(pages)) {
            assert.equal(/classList\.(remove|add|toggle)\('sk-/.test(html), false, name + ': class switch of the skeleton');
            assert.equal(/sk-shell/.test(html.replace(/<div id="loading-mask" class="loadmask sk-shell">/, '').replace(styles(html), '')), false,
                name + ': sk-shell outside the markup and the styles');
        }
    });

    await check('loading skeleton: the comparison sees a difference', async () => {
        const changed = pages.deploy.replace('class="skc-name"', 'class="skc-name skc-x"');
        assert.notEqual(frame(changed), frame(pages.dev));
        const restyled = pages.deploy.replace('@keyframes skc-flow', '@keyframes skc-flow2');
        assert.notEqual(styles(restyled), styles(pages.dev));
    });

    const browser = await H.launch();
    try {
        await check('loading skeleton: covers the stand until the shell is built, stands where the shell puts its bar, then goes', async () => {
            const page = await H.open(browser, {boot: 'none', width: 1440, height: 900});
            await page.addStyleTag({content: '.loadmask {position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: hidden}\n' + styles(pages.dev)});
            await page.evaluate(markup => {
                const mask = document.getElementById('loading-mask');
                mask.className = 'loadmask sk-shell';
                mask.innerHTML = markup;
            }, frame(pages.dev));

            await page.evaluate(() => { stock.init(); stock.face(); });
            const skeleton = await page.evaluate(probe);
            assert.equal(await page.evaluate(() => !!document.getElementById('vo-loading')), true, 'the shell keeps the skeleton after app:face');
            assert.equal(skeleton.covered, true, 'the skeleton is not on top of the stand');
            assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('vo-loading')).backgroundColor), 'rgb(238, 242, 244)');

            await page.evaluate(() => stock.ready());
            await page.waitForFunction(() => !!document.getElementById('vo-shell'));
            await H.settle(page);
            assert.equal(await page.evaluate(() => !!document.getElementById('vo-loading') || !!document.getElementById('loading-mask')), false, 'the skeleton is gone after the build');
            const bar = await page.evaluate(built);

            assert.deepEqual(skeleton.card.map(Math.round), bar.card.map(Math.round), 'the card is the bar card');
            assert.deepEqual(skeleton.file.map(Math.round), bar.file.map(Math.round), 'the icon of the file');
            assert.equal(skeleton.end.length, bar.end.length, 'the buttons of the bar');
            skeleton.end.forEach((r, i) => {
                near(centre(r)[0], centre(bar.end[i])[0], 'button ' + i + ' across');
                near(centre(r)[1], centre(bar.end[i])[1], 'button ' + i + ' down');
            });
            /* mid: [previous, number, next, zoom, fit to width] against the bar. */
            const mid = skeleton.mid.map(centre);
            near(mid[0][0], centre(bar.nav[0])[0], 'previous page');
            near(mid[1][0], centre(bar.page)[0], 'page number');
            near(mid[2][0], centre(bar.nav[1])[0], 'next page');
            near(mid[3][0], centre(bar.zoom)[0], 'zoom');
            near(mid[4][0], centre(bar.nav[2])[0], 'fit to width');
            mid.forEach((c, i) => near(c[1], centre(bar.card)[1], 'mid ' + i + ' down'));

            /* The sheet: 794px wide, centred over the area less the 14px scrollbar, 20px below the area. */
            near(skeleton.sheet[2], 794, 'sheet width');
            near(centre(skeleton.sheet)[0], (1440 - 14) / 2, 'sheet centre');
            near(skeleton.sheet[1], bar.canvas[1] + 20, 'sheet top');
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
        });
    } finally {
        await browser.close();
    }

    done();
})();
