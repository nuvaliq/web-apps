/* Run after the document editor LESS build: node test/unit-tests/documenteditor/compact-top-motion.cjs
 * COMPACT_CSS_DOCUMENTEDITOR (or COMPACT_CSS) names the compiled app.css.
 * Motion and reach of the header and the menu bar of the compact shell when they collapse and come back:
 * they slide by a transform for the state duration of the styles; leaving, the slide comes first and the
 * layout after it, returning, the layout first and the slide after it; one layout pass and one engine resize
 * per switch; with reduced motion they switch at once. Hidden rows are out of the tab order and of the
 * accessibility tree, and the focus inside them goes back to the document.
 * The shell, the menu bar and the catalog are the real modules in headless Chrome with the transitions of the
 * compiled styles on (fixtures/compact-shell-page.cjs, motion: true).
 */
const assert = require('node:assert/strict');
const shellPage = require('./fixtures/compact-shell-page.cjs');

(async () => {
    const browser = await shellPage.launch();
    const {check, done} = shellPage.checker();
    const frames = (page, n = 4) => page.evaluate(n => new Promise(ok => {
        const step = () => (n-- > 0 ? requestAnimationFrame(step) : ok());
        step();
    }), n);
    const wait = (page, ms) => page.evaluate(ms => new Promise(ok => setTimeout(ok, ms)), ms);
    const fresh = async (options = {}) => {
        const page = await shellPage.open(browser, Object.assign({motion: true}, options));
        await page.evaluate(() => {
            window.layouts = 0;
            const apply = shell.applyLayout;
            shell.applyLayout = function () { layouts++; return apply.apply(this, arguments); };
            focusText();
        });
        await frames(page);
        return page;
    };
    /* State of the rows: the body classes, the vertical shift of each row, the laid out toolbar area, the
       counters of layout passes and of engine resizes. */
    const rows = page => page.evaluate(() => {
        const shift = sel => {
            const t = getComputedStyle(document.querySelector('#vo-shell > ' + sel)).transform;
            const m = /matrix\(([^)]+)\)/.exec(t);
            return m ? Math.round(+m[1].split(',')[5]) : 0;
        };
        const body = document.body.classList;
        return {away: body.contains('vo-top-away'), out: body.contains('vo-top-hidden'),
            header: shift('.vo-hd'), menu: shift('.vo-mn'), area: document.getElementById('toolbar').style.height,
            layouts, resizes: ctx.log.filter(e => e.api === 'Resize').length};
    });
    const duration = page => page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('#vo-shell > .vo-hd'));
        const names = s.transitionProperty.split(',').map(x => x.trim());
        if (names.join() === 'none') return '0s';
        const i = names.indexOf('transform') >= 0 ? names.indexOf('transform') : names.indexOf('all');
        return i < 0 ? null : s.transitionDuration.split(',')[i].trim();
    });

    try {
        await check('hidden rows are out of the tab order and the accessibility tree', async () => {
            const page = await fresh({motion: false});
            await page.evaluate(() => {
                const b = document.createElement('button');
                b.id = 'hd-btn'; b.textContent = 'Share';
                document.querySelector('.vo-hd').appendChild(b);
            });
            const tree = () => page.locator('#vo-shell').ariaSnapshot();
            const before = await tree();
            assert.match(before, /menubar/);
            assert.match(before, /Share/);
            for (const hide of ['manual', 'scroll']) {
                await page.evaluate(hide => (hide === 'manual' ? shell.toggleFocus() : shell.hideTop('scroll')), hide);
                await frames(page);
                const inert = await page.evaluate(() => ['.vo-hd', '.vo-mn']
                    .map(s => document.querySelector('#vo-shell > ' + s).inert));
                assert.deepEqual(inert, [true, true], hide);
                const snapshot = await tree();
                assert.doesNotMatch(snapshot, /menubar|Share|Title/, hide + ': ' + snapshot);
                /* Tab goes round the page and never stops in the hidden rows. */
                await page.evaluate(() => document.body.focus());
                const stops = [];
                for (let i = 0; i < 20; i++) {
                    await page.keyboard.press('Tab');
                    stops.push(await page.evaluate(() => {
                        const a = document.activeElement;
                        return !!(a && a.closest('#vo-shell > .vo-hd, #vo-shell > .vo-mn'));
                    }));
                }
                assert.deepEqual(stops.filter(Boolean), [], hide);
                await page.evaluate(() => shell.showTop());
                await frames(page);
                assert.deepEqual(await page.evaluate(() => ['.vo-hd', '.vo-mn']
                    .map(s => document.querySelector('#vo-shell > ' + s).inert)), [false, false]);
                assert.equal(await tree(), before, 'back in the tree');
            }
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('focus inside rows that leave goes back to the document', async () => {
            const page = await fresh({motion: false});
            await page.evaluate(() => {
                const b = document.createElement('button');
                b.id = 'hd-btn'; b.textContent = 'Share';
                document.querySelector('.vo-hd').appendChild(b);
            });
            for (const where of ['#hd-btn', '.vo-mn-item[data-k="view"]']) {
                await page.focus(where);
                await page.evaluate(() => shell.toggleFocus());
                await frames(page);
                assert.equal(await page.evaluate(() => document.activeElement.id), 'area_id', where);
                assert.equal(await page.evaluate(() => ctx.log.filter(e => e.event === 'edit:complete').length > 0), true);
                await page.evaluate(() => shell.showTop());
                await frames(page);
            }
            /* Focus elsewhere stays where it is. */
            await page.focus('#tb-bold');
            await page.evaluate(() => shell.toggleFocus());
            await frames(page);
            assert.equal(await page.evaluate(() => document.activeElement.id), 'tb-bold');
            await page.close();
        });

        await check('rows slide for the state duration', async () => {
            const page = await fresh();
            assert.equal(await duration(page), '0.15s');
            const start = await rows(page);
            assert.deepEqual([start.away, start.out, start.header, start.menu, start.area], [false, false, 0, 0, '80px']);

            /* Leaving: the slide first, the layout after it. */
            await page.evaluate(() => shell.toggleFocus());
            await wait(page, 60);
            let r = await rows(page);
            assert.deepEqual([r.away, r.out, r.area], [true, false, '80px'], 'sliding, the room is still there');
            assert.ok(r.header < 0 && r.header > -76, 'the header is on its way: ' + r.header);
            assert.equal(r.menu, r.header, 'both rows move together');
            assert.equal(await page.evaluate(() => shell.topHidden()), true, 'the state switched at once');
            await wait(page, 200);
            r = await rows(page);
            assert.deepEqual([r.away, r.out, r.area], [true, true, '4px'], 'then the layout gives the room away');

            /* Returning: the layout first, the slide after it. */
            await page.evaluate(() => shell.toggleFocus());
            r = await rows(page);
            assert.deepEqual([r.away, r.out, r.area], [false, false, '80px'], 'the room comes back at once');
            assert.ok(r.header < -70, 'the rows start above: ' + r.header);
            await wait(page, 60);
            r = await rows(page);
            assert.ok(r.header < 0 && r.header > -76, 'and slide down: ' + r.header);
            await wait(page, 200);
            r = await rows(page);
            assert.deepEqual([r.header, r.menu], [0, 0]);
            const visible = await page.evaluate(() => getComputedStyle(document.querySelector('.vo-hd')).visibility);
            assert.equal(visible, 'visible');

            /* Coming back while still leaving: the rows return from where they are, without a layout. */
            const before = (await rows(page)).layouts;
            await page.evaluate(() => shell.toggleFocus());
            await wait(page, 50);
            await page.evaluate(() => shell.toggleFocus());
            await wait(page, 250);
            r = await rows(page);
            assert.deepEqual([r.away, r.out, r.area, r.header], [false, false, '80px', 0]);
            assert.equal(r.layouts - before, 1, 'only the return lays out, the leave never did');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('rows slide in on the return even if the layout pass reads no geometry', async () => {
            /* The rows come back from display: none; a transition starts only from styles the page has read. */
            const page = await fresh();
            await page.evaluate(() => { shell.applyLayout = function () { layouts++; }; });
            await page.evaluate(() => shell.toggleFocus());
            await wait(page, 250);
            assert.equal((await rows(page)).out, true);
            const back = await page.evaluate(() => {
                shell.toggleFocus();
                const row = document.querySelector('#vo-shell > .vo-hd');
                return {transform: getComputedStyle(row).transform, sliding: row.getAnimations().length};
            });
            assert.equal(back.transform, 'matrix(1, 0, 0, 1, 0, -76)', 'the rows start above');
            assert.equal(back.sliding, 1, 'and slide down');
            await wait(page, 250);
            const r = await rows(page);
            assert.deepEqual([r.away, r.out, r.header, r.menu], [false, false, 0, 0]);
            await page.close();
        });

        await check('reduced motion switches without a transition', async () => {
            const page = await fresh({reducedMotion: 'reduce'});
            assert.equal(await duration(page), '0s');
            await page.evaluate(() => shell.toggleFocus());
            let r = await rows(page);
            assert.deepEqual([r.away, r.out, r.area], [true, true, '4px'], 'gone at once');
            await page.evaluate(() => shell.toggleFocus());
            r = await rows(page);
            assert.deepEqual([r.away, r.out, r.area, r.header, r.menu], [false, false, '80px', 0, 0], 'back at once');
            assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.vo-mn')).visibility), 'visible');
            await page.close();
        });

        await check('one layout pass per switch', async () => {
            for (const motion of [true, false]) {
                const page = await fresh({motion});
                const count = async () => { const r = await rows(page); return [r.layouts, r.resizes]; };
                const [l0, z0] = await count();
                const step = async fn => {
                    const [l, z] = await count();
                    await page.evaluate(fn);
                    await wait(page, 250);
                    const [l2, z2] = await count();
                    return [l2 - l, z2 - z];
                };
                assert.deepEqual(await step(() => shell.toggleFocus()), [1, 1], 'manual collapse, motion ' + motion);
                assert.deepEqual(await step(() => shell.toggleFocus()), [1, 1], 'expand, motion ' + motion);
                /* Scrolling down: the rows leave once, however long the scroll goes on. */
                assert.deepEqual(await step(async () => {
                    for (const y of [100, 200, 300, 400, 500, 600]) {
                        docScroll.to(y);
                        await new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));
                    }
                }), [1, 1], 'scroll down, motion ' + motion);
                assert.equal(await page.evaluate(() => shell.top.cause), 'scroll');
                assert.deepEqual(await step(() => docScroll.to(450)), [1, 1], 'scroll up, motion ' + motion);
                assert.equal(await page.evaluate(() => shell.topHidden()), false);
                const [l1, z1] = await count();
                assert.deepEqual([l1 - l0, z1 - z0], [4, 4]);
                await page.close();
            }
        });
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
