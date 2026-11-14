/* Run: node test/unit-tests/common/compact/menu-bar-overflow.cjs [path to MenuBar.js]
 * The shared compact menu bar on a narrow window and under live changes: sections leave for
 * the more button from the end, the pinned section stays at the right, empty sections are not
 * drawn, refresh() rereads an open list without closing it and keeps focus on a live row, the
 * status container stays in the bar. Runs for every editor of lib/editors.cjs with an adapter
 * over the rows its module names (roles), in headless Chrome through Playwright (NODE_PATH or PLAYWRIGHT_MODULE). The optional argument
 * points to a broken copy of the module for a negative control.
 */
const path = require('node:path');
const assert = require('node:assert/strict');
const {BAR, launch, openMenu, settle, readBar, rowInfo, editorsWithAdapter, checker, patch, focusRow} = require('./lib/menu-bar-page.cjs');

const FILE = process.argv[2] ? path.resolve(process.argv[2]) : BAR;

(async () => {
    const {check, skip, done} = checker();
    const browser = await launch();
    try {
        for (const editor of editorsWithAdapter()) {
            const name = text => `${text} (${editor.name})`;
            const pinned = require(editor.adapter).pinned;
            const R = require(editor.adapter).roles;
            const runs = page => page.evaluate(() => ctx.log.filter(e => e.k).map(e => e.k));
            /* F10 from the text field, then the section by its place in the bar. */
            const toSection = async (page, index) => {
                await page.focus('#field');
                await page.keyboard.press('F10');
                for (let i = 0; i < index; i++) await page.keyboard.press('ArrowRight');
            };
            const open = (options = {}) => openMenu(browser, editor, Object.assign({bar: FILE}, options));
            const active = async page => (await readBar(page)).active;
            const setWidth = async (page, width) => {
                await page.evaluate(w => { document.getElementById('host').style.width = w + 'px'; }, width);
                await settle(page);
            };
            const refresh = async page => { await page.evaluate(() => menu.refresh()); await settle(page); };
            const moreRows = page => page.evaluate(() => Array.from(menu.el.querySelectorAll('.vo-mn-more > .vo-mn-drop > .vo-mn-more-row'))
                .map(r => r.getAttribute('data-k')));

            /* Widths at which 1, 2 … sections have left the bar, from a scan of the test page. */
            const scan = async (page, from = R.scanFrom) => {
                const steps = [];
                for (let w = from; w >= 40; w -= 4) {
                    await setWidth(page, w);
                    const state = await readBar(page);
                    const out = state.tops.includes('more') ? await page.evaluate(() => {
                        const order = Array.from(menu.el.querySelectorAll('.vo-mn-item[data-k]')).map(b => b.getAttribute('data-k'));
                        const tops = Array.from(menu.el.querySelectorAll(':scope > .vo-mn-wrap')).filter(w => w.style.display !== 'none')
                            .map(w => w.firstChild.getAttribute('data-k'));
                        return order.filter(k => !tops.includes(k));
                    }) : [];
                    steps.push({width: w, tops: state.tops, out});
                }
                return steps;
            };
            const widthWith = (steps, n) => (steps.find(s => s.out.length === n) || {}).width;
            /* The scan of a fresh page, made once for the tests that only need the widths. */
            let scanned = null;
            const widths = async () => {
                if (scanned) return scanned;
                const page = await open();
                scanned = await scan(page);
                await page.close();
                return scanned;
            };

            await check(name('overflowing sections move to the more button from the end in order'), async () => {
                const page = await open();
                const order = (await readBar(page)).tops.filter(k => k !== pinned);
                const steps = scanned = await scan(page);
                const counts = [...new Set(steps.map(s => s.out.length))];
                assert.deepEqual(counts, order.map((_, i) => i).concat(order.length), 'one section at a time');
                for (const step of steps) {
                    assert.deepEqual(step.out, order.slice(order.length - step.out.length), `width ${step.width}`);
                    assert.equal(step.tops.includes('more'), step.out.length > 0, `more button only when needed, width ${step.width}`);
                }
                await setWidth(page, widthWith(steps, 2));
                await page.click('.vo-mn-more > .vo-mn-item');
                assert.deepEqual(await moreRows(page), order.slice(-2));
                const labels = await page.evaluate(() => Array.from(menu.el.querySelectorAll('.vo-mn-more-row')).map(r => r.textContent));
                assert.deepEqual(labels, await page.evaluate(keys => keys.map(k => adapter.sections().find(s => s.k === k).t), order.slice(-2)));
                const more = await page.evaluate(() => {
                    const b = menu.el.querySelector('.vo-mn-more > .vo-mn-item');
                    return [b.textContent, b.getAttribute('aria-label'), b.getAttribute('role'), b.getAttribute('aria-expanded')];
                });
                assert.deepEqual(more, ['…', 'More sections', 'menuitem', 'true']);
                assert.deepEqual(page.errors, []);
                await page.close();
            });

            await check(name('pinned help stays at the right and never hides'), async () => {
                const page = await open();
                for (const step of await scan(page)) {
                    assert.equal(step.tops[step.tops.length - 1], pinned, `width ${step.width}`);
                    if (step.out.length) assert.equal(step.tops[step.tops.length - 2], 'more', `width ${step.width}`);
                    assert.ok(!step.out.includes(pinned));
                }
                await page.close();
            });

            await check(name('arrows reach the more button and walk its list'), async () => {
                const page = await open();
                const steps = await widths();
                await setWidth(page, widthWith(steps, 2));
                await page.focus('#field');
                await page.keyboard.press('F10');
                const tops = (await readBar(page)).tops;
                assert.deepEqual(tops.slice(-2), ['more', pinned]);
                await page.keyboard.press('End');
                await page.keyboard.press('ArrowLeft');
                assert.equal(await active(page), 'more');
                await page.keyboard.press('ArrowRight');
                assert.equal(await active(page), pinned);
                await page.keyboard.press('ArrowLeft');
                await page.keyboard.press('ArrowDown');
                const rows = await moreRows(page);
                assert.equal(rows.length, 2);
                assert.equal(await active(page), rows[0]);
                await page.keyboard.press('ArrowDown');
                assert.equal(await active(page), rows[1]);
                await page.keyboard.press('ArrowDown');
                assert.equal(await active(page), rows[0], 'the list wraps');
                await page.keyboard.press('Enter');
                const state = await readBar(page);
                assert.deepEqual(state.open.map(d => [d.label, d.level, d.inMore]),
                    [[await page.evaluate(k => adapter.sections().find(s => s.k === k).t, rows[0]), '0', true]]);
                assert.equal(state.active, state.open[0].rows[0], 'focus on the first item of the section');
                await page.keyboard.press('Escape');
                assert.equal(await active(page), 'more');
                await page.close();
            });

            await check(name('choosing a hidden section opens its own list at the more button'), async () => {
                const page = await open();
                const steps = await widths();
                await setWidth(page, widthWith(steps, 2));
                const T = R.tail;
                await page.click('.vo-mn-more > .vo-mn-item');
                await page.click(`.vo-mn-more-row[data-k="${T.k}"]`);
                const state = await readBar(page);
                assert.equal(state.open.length, 1, 'the list of names is closed');
                assert.deepEqual([state.open[0].label, state.open[0].level, state.open[0].inMore], [T.label, '0', true]);
                assert.deepEqual(state.open[0].rows, T.rows);
                assert.equal((await rowInfo(page, T.k)).attrs['aria-expanded'], 'true');
                const box = await page.evaluate(() => {
                    const r = menu.el.querySelector('.vo-mn-more > .vo-mn-item').getBoundingClientRect();
                    const d = menu.el.querySelector('.vo-mn-more > .vo-mn-drop.open').getBoundingClientRect();
                    return {gap: d.top - r.bottom, dx: Math.abs(d.left - r.left)};
                });
                assert.ok(box.gap >= 0 && box.gap < 20 && box.dx < 10, 'the list stands at the more button: ' + JSON.stringify(box));
                await page.click(`[data-k="${T.click}"]`);
                assert.deepEqual(await runs(page), [T.click]);
                assert.equal((await readBar(page)).isOpen, false);
                await page.close();
            });

            await check(name('open section moving into the more button stays open there'), async () => {
                const page = await open();
                const steps = await widths();
                const T = R.tail;
                await setWidth(page, Math.max(700, R.scanFrom));
                await toSection(page, T.index);
                await page.keyboard.press('ArrowDown');
                assert.equal(await active(page), T.rows[0]);
                await setWidth(page, widthWith(steps, 2));
                let state = await readBar(page);
                assert.deepEqual(state.open.map(d => [d.label, d.inMore]), [[T.label, true]]);
                assert.equal(state.active, T.rows[0], 'focus stays on the row');
                assert.equal(await page.evaluate(() => menu.el.querySelector('.vo-mn-more > .vo-mn-item').getAttribute('aria-expanded')), 'true');
                await setWidth(page, Math.max(700, R.scanFrom));
                state = await readBar(page);
                assert.deepEqual(state.open.map(d => [d.label, d.inMore]), [[T.label, false]]);
                assert.equal(state.active, T.rows[0]);
                await page.close();
            });

            await check(name('about stays reachable through help on a narrow window'), async () => {
                const page = await open({width: 60});
                assert.ok((await readBar(page)).tops.includes(pinned));
                await page.click(`[data-k="${pinned}"]`);
                await page.click(`[data-k="${R.about}"]`);
                assert.deepEqual(await runs(page), [R.about]);
                await page.close();
            });

            if (!R.viewer) skip(name('empty section is drawn neither in the bar nor in the more list'),
                'every section of the editor keeps items for a viewer');
            else await check(name('empty section is drawn neither in the bar nor in the more list'), async () => {
                const V = R.viewer;
                const page = await open({context: {rights: 'view'}});
                assert.deepEqual((await readBar(page)).tops, V.tops.concat(pinned));
                await setWidth(page, 60);
                await page.click('.vo-mn-more > .vo-mn-item');
                assert.deepEqual(await moreRows(page), V.tops);
                await page.evaluate(() => menu.close());
                await page.evaluate(() => { ctx.rights = 'edit'; });
                await refresh(page);
                await page.click('.vo-mn-more > .vo-mn-item');
                assert.deepEqual(await moreRows(page), V.editTops, 'a section with items comes back');
                assert.equal(await page.evaluate(k => menu.open(k), V.editOnly), true);
                await page.evaluate(() => { menu.close(); ctx.rights = 'view'; });
                assert.equal(await page.evaluate(k => menu.open(k), V.editOnly), false, 'an empty section does not open');
                await page.close();
            });

            await check(name('refresh in an open section updates checks and locks without closing it'), async () => {
                const F = R.refresh, C = R.check, W = R.widget;
                const page = await open({context: Object.assign({}, C.on, W ? W.context : {})});
                await toSection(page, F.index);
                /* The toggle is the first row of the section or as many rows down as the editor says. */
                for (let i = 0; i < (F.downs || 1); i++) await page.keyboard.press('ArrowDown');
                assert.equal(await active(page), C.row, 'arrows reach the toggle of the section');
                assert.equal((await rowInfo(page, C.row)).attrs['aria-checked'], 'true');
                await patch(page, Object.assign({}, C.off, W ? W.change : {}));
                await refresh(page);
                let state = await readBar(page);
                assert.deepEqual(state.open.map(d => d.label), [F.label]);
                assert.equal(state.active, C.row);
                const toggle = await rowInfo(page, C.row);
                assert.equal(toggle.attrs['aria-checked'], 'false');
                assert.equal(toggle.check, false);
                if (W) assert.equal((await rowInfo(page, W.row)).attrs['aria-label'], W.changed);
                else skip(name('refresh updates the label of an own widget row'), 'the editor has no widget rows yet');
                await page.keyboard.press('ArrowRight');
                assert.equal(await active(page), F.nextFirst);
                await page.keyboard.press('ArrowLeft');
                await page.keyboard.press('ArrowLeft');
                assert.deepEqual((await readBar(page)).open.map(d => d.label), [F.lockLabel]);
                await patch(page, F.lock);
                await refresh(page);
                assert.equal((await rowInfo(page, F.lockRow)).locked, true);
                await patch(page, F.unlock);
                await refresh(page);
                state = await readBar(page);
                assert.deepEqual(state.open.map(d => d.label), [F.lockLabel]);
                const row = await rowInfo(page, F.lockRow);
                assert.equal(row.locked, false);
                assert.equal(row.attrs.title, undefined);
                assert.equal(row.attrs['aria-description'], undefined);
                await page.evaluate(() => { ctx.reasons = ['view']; });
                await refresh(page);
                assert.equal((await rowInfo(page, F.lockRow)).attrs.title, 'The document is open for viewing');
                await page.close();
            });

            await check(name('refresh removes a hidden row and moves focus to the next row or the previous one'), async () => {
                const H = R.hide;
                const without = (rows, gone) => rows.filter(k => !gone.includes(k));
                const page = await open();
                await toSection(page, H.index);
                await page.keyboard.press('ArrowDown');
                await focusRow(page, H.middle);
                assert.equal(await active(page), H.middle);
                await patch(page, H.middleOff);
                await refresh(page);
                let state = await readBar(page);
                const afterMiddle = state.open[0].rows;
                assert.ok(!afterMiddle.includes(H.middle));
                assert.deepEqual(afterMiddle, without(H.rows, [H.middle]));
                assert.equal(state.active, H.next, 'the next row');
                if (!H.last) {
                    skip(name('refresh removes the hidden last row and moves focus to the previous one'),
                        'the last row of every section of the editor stays');
                    await patch(page, H.restore);
                    await refresh(page);
                    state = await readBar(page);
                    assert.deepEqual(state.open[0].rows, H.rows, 'rows come back in their places');
                    assert.equal(state.active, H.next);
                    await page.close();
                    return;
                }
                await page.keyboard.press('End');
                assert.equal(await active(page), H.last);
                await patch(page, H.lastOff);
                await refresh(page);
                state = await readBar(page);
                assert.deepEqual(state.open[0].rows, without(afterMiddle, H.lastGone));
                assert.equal(state.open[0].rows[state.open[0].rows.length - 1], H.prev, 'the previous row ends the list');
                assert.equal(await page.evaluate(() => {
                    const list = menu.el.querySelector('.vo-mn-drop.open');
                    return !!list.lastElementChild && list.lastElementChild.classList.contains('vo-mn-sep');
                }), false, 'no separator is left at the end');
                assert.equal(state.active, H.prev, 'the previous row');
                await patch(page, H.restore);
                await refresh(page);
                state = await readBar(page);
                assert.deepEqual(state.open[0].rows, H.rows, 'rows come back in their places');
                assert.equal(state.active, H.prev);
                await page.close();
            });

            await check(name('refresh closes the submenu of an item that became greyed'), async () => {
                const S = R.subLock;
                const page = await open({context: S.before});
                await page.evaluate(S => { menu.open(S.section); menu.el.querySelector(`[data-k="${S.row}"]`).focus(); }, S);
                await page.keyboard.press('ArrowRight');
                let state = await readBar(page);
                assert.equal(state.active, S.item);
                assert.equal(state.open.length, 2);
                await patch(page, S.after);
                await refresh(page);
                state = await readBar(page);
                assert.deepEqual(state.open.map(d => d.level), ['0']);
                assert.equal(state.active, S.row);
                const row = await rowInfo(page, S.row);
                assert.equal(row.locked, true);
                assert.equal(row.attrs['aria-expanded'], 'false');
                assert.equal(row.attrs.title, S.title);
                await page.close();
            });

            if (!R.ownedLock) skip(name('refresh closes the own surface of an item that became greyed or is gone'),
                'the editor shows no submenu on its own surface yet');
            else await check(name('refresh closes the own surface of an item that became greyed or is gone'), async () => {
                const O = R.ownedLock;
                const page = await open({context: O.context});
                await page.evaluate(() => { ctx.bar = menu; });
                const surface = () => page.evaluate(sel => !!document.querySelector(sel), O.surface);
                const openIt = async () => {
                    await page.evaluate(k => menu.open(k), O.section);
                    await page.click(`[data-k="${O.row}"]`);
                    assert.equal(await surface(), true, 'precondition: the row opens its surface');
                };
                await openIt();
                await page.focus(`${O.surface} ${O.choice}`);
                await patch(page, O.after);
                await refresh(page);
                assert.equal(await surface(), false, 'the surface of a greyed item stayed open');
                let state = await readBar(page);
                assert.deepEqual(state.open.map(d => d.level), ['0'], 'the section stays open');
                assert.equal(state.active, O.row, 'focus from the surface goes to its item');
                const row = await rowInfo(page, O.row);
                assert.deepEqual([row.locked, row.attrs['aria-expanded'], row.attrs.title], [true, 'false', O.title]);
                assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.gallery)), [], 'the menu closed it: no report back');
                /* A live item keeps its surface open through a refresh. */
                await patch(page, O.back);
                await refresh(page);
                await openIt();
                await refresh(page);
                assert.equal(await surface(), true, 'a refresh closed the surface of a live item');
                /* The item is gone. */
                await patch(page, O.gone);
                await refresh(page);
                assert.equal(await rowInfo(page, O.row), null, 'precondition: the item is gone');
                assert.equal(await surface(), false, 'the surface of a gone item stayed open');
                state = await readBar(page);
                assert.deepEqual(state.open.map(d => d.level), ['0'], 'the section stays open');
                assert.deepEqual(page.errors, []);
                await page.close();
            });

            if (!R.emptied) skip(name('emptied section closes and focus goes to the nearest visible section'),
                'no section of the editor empties for a viewer');
            else await check(name('emptied section closes and focus goes to the nearest visible section'), async () => {
                const E = R.emptied;
                const page = await open();
                await toSection(page, E.index);
                await page.keyboard.press('ArrowDown');
                assert.deepEqual((await readBar(page)).open.map(d => d.label), [E.label]);
                await page.evaluate(() => { ctx.rights = 'view'; });
                await refresh(page);
                const state = await readBar(page);
                assert.equal(state.isOpen, false);
                assert.deepEqual(state.tops, R.viewer.tops.concat(pinned));
                assert.equal(state.active, E.focus);
                assert.equal(await page.evaluate(() => document.activeElement.isConnected), true);
                assert.ok(!(await page.evaluate(() => ctx.log.filter(e => e.keys).map(e => e.keys))).includes('release'));
                await page.close();
            });

            if (!R.emptied) skip(name('emptied section with the rest in the more button focuses the more button'),
                'no section of the editor empties for a viewer');
            else await check(name('emptied section with the rest in the more button focuses the more button'), async () => {
                const page = await open();
                const steps = await widths();
                const E = R.emptied;
                const all = steps.find(s => s.out.length === R.order.length - 1);
                await setWidth(page, all.width);
                await page.focus('#field');
                await page.keyboard.press('F10');
                assert.equal(await active(page), 'more');
                await page.keyboard.press('ArrowDown');
                for (let i = 0; i < E.index; i++) await page.keyboard.press('ArrowDown');
                await page.keyboard.press('Enter');
                let state = await readBar(page);
                assert.deepEqual(state.open.map(d => [d.label, d.inMore]), [[E.label, true]]);
                await page.evaluate(() => { ctx.rights = 'view'; });
                await refresh(page);
                state = await readBar(page);
                assert.equal(state.isOpen, false);
                assert.equal(state.active, 'more');
                await page.keyboard.press('ArrowDown');
                assert.deepEqual(await moreRows(page), R.viewer.tops);
                await page.close();
            });

            await check(name('status container stays visible while sections overflow'), async () => {
                const page = await open();
                const steps = await widths();
                await setWidth(page, 700);
                const first = await page.evaluate(() => {
                    const s = menu.status();
                    s.textContent = 'Wait…';
                    return {same: s === menu.status(), live: s.getAttribute('aria-live'), role: s.getAttribute('role'),
                        inBar: s.parentNode === menu.el};
                });
                assert.deepEqual(first, {same: true, live: 'polite', role: null, inBar: true});
                for (const width of [700, widthWith(steps, 1), widthWith(steps, 3)]) {
                    await setWidth(page, width);
                    await page.click(`[data-k="${pinned}"]`);
                    const st = await page.evaluate(() => {
                        const s = menu.status(), bar = menu.el.getBoundingClientRect(), r = s.getBoundingClientRect();
                        return {shown: s.getClientRects().length > 0, inList: !!s.closest('.vo-mn-drop, .vo-mn-more'),
                            inside: r.left >= bar.left && r.right <= bar.right + 0.5, text: s.textContent};
                    });
                    assert.deepEqual(st, {shown: true, inList: false, inside: true, text: 'Wait…'}, `width ${width}`);
                    await page.evaluate(() => menu.close());
                }
                await page.close();
            });

            await check(name('several refresh calls in one frame read the state once'), async () => {
                const page = await open();
                await page.evaluate(k => menu.open(k), R.anySection);
                const one = await page.evaluate(() => new Promise(done => {
                    const before = ctx.reads;
                    menu.refresh();
                    requestAnimationFrame(() => requestAnimationFrame(() => done(ctx.reads - before)));
                }));
                const many = await page.evaluate(() => new Promise(done => {
                    const before = ctx.reads;
                    menu.refresh(); menu.refresh(); menu.refresh();
                    const same = ctx.reads === before;
                    requestAnimationFrame(() => requestAnimationFrame(() => done({reads: ctx.reads - before, same})));
                }));
                assert.ok(one > 0, 'refresh reads the state');
                assert.deepEqual(many, {reads: one, same: true}, 'reads happen in the frame, once');
                await page.close();
            });
        }
    } finally {
        await browser.close();
    }
    done();
})().catch(error => { console.error('FAIL', error); process.exitCode = 1; });
