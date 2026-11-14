/* Run: node test/unit-tests/common/compact/menu-bar-keys.cjs [path to MenuBar.js]
 * Keyboard of the shared compact menu bar (WAI-ARIA menubar pattern): entering with F10,
 * moving between sections, opening lists and submenus, Escape layer by layer with the engine
 * keys given back to the document and focus back to the field it came from, Tab out; the keys
 * go back to the document whenever focus leaves the bar, and F10 is left to a window or a
 * loading mask that covers the editor.
 * Runs for every editor of lib/editors.cjs with an adapter over the rows its module names (roles),
 * in headless Chrome through
 * Playwright (NODE_PATH or PLAYWRIGHT_MODULE). The optional argument points to a broken copy
 * of the module for a negative control.
 */
const path = require('node:path');
const assert = require('node:assert/strict');
const {BAR, launch, openMenu, settle, readBar, editorsWithAdapter, checker, patch} = require('./lib/menu-bar-page.cjs');

const FILE = process.argv[2] ? path.resolve(process.argv[2]) : BAR;

(async () => {
    const {check, skip, done} = checker();
    const browser = await launch();
    try {
        for (const editor of editorsWithAdapter()) {
            const name = text => `${text} (${editor.name})`;
            const R = require(editor.adapter).roles;
            const first = R.first, sub = R.submenu, order = R.order;
            /* A page with the menu bar entered by F10 from the text field. */
            const entered = async (options = {}) => {
                const page = await openMenu(browser, editor, Object.assign({bar: FILE}, options));
                await page.focus('#field');
                await page.keyboard.press('F10');
                return page;
            };
            const active = async page => (await readBar(page)).active;
            const keys = page => page.evaluate(() => ctx.log.filter(e => e.keys).map(e => e.keys));

            await check(name('f10 enters the menu bar'), async () => {
                const page = await openMenu(browser, editor, {bar: FILE});
                await page.focus('#field');
                await page.keyboard.press('Shift+F10');
                assert.equal(await active(page), 'field', 'F10 with a modifier is not the menu key');
                assert.deepEqual(await keys(page), []);
                await page.keyboard.press('F10');
                assert.equal(await active(page), first.k);
                assert.deepEqual(await keys(page), ['hold']);
                const stop = await page.evaluate(() => Array.from(menu.el.querySelectorAll('.vo-mn-item'))
                    .filter(b => b.getAttribute('tabindex') === '0').map(b => b.getAttribute('data-k')));
                assert.deepEqual(stop, [first.k]);
                assert.equal((await readBar(page)).isOpen, false, 'entering opens no list');
                await page.close();
            });

            await check(name('arrows move between sections and wrap'), async () => {
                const page = await entered();
                const tops = (await readBar(page)).tops;
                assert.deepEqual(tops, order);
                const last = order[order.length - 1];
                const seen = [];
                for (let i = 0; i < order.length; i++) {
                    await page.keyboard.press('ArrowRight');
                    seen.push(await active(page));
                }
                assert.deepEqual(seen, order.slice(1).concat(order[0]));
                await page.keyboard.press('ArrowLeft');
                assert.equal(await active(page), last);
                const stops = await page.evaluate(() => Array.from(menu.el.querySelectorAll('.vo-mn-item'))
                    .filter(b => b.getAttribute('tabindex') === '0').map(b => b.getAttribute('data-k')));
                assert.deepEqual(stops, [last], 'the Tab stop follows focus');
                /* An open list moves along with the arrows. */
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('ArrowRight');
                const state = await readBar(page);
                assert.equal(state.active, first.firstItem);
                assert.deepEqual(state.open.map(d => d.label), [first.label]);
                await page.close();
            });

            await check(name('home and end jump to the first and last section'), async () => {
                const page = await entered();
                await page.keyboard.press('End');
                assert.equal(await active(page), order[order.length - 1]);
                await page.keyboard.press('Home');
                assert.equal(await active(page), first.k);
                await page.close();
            });

            await check(name('down, enter and space open a section on its first item'), async () => {
                const page = await entered();
                for (const key of ['ArrowDown', 'Enter', ' ']) {
                    await page.keyboard.press(key);
                    const state = await readBar(page);
                    assert.deepEqual(state.open.map(d => d.label), [first.label], key);
                    assert.equal(state.active, first.firstItem, key);
                    await page.keyboard.press('Escape');
                    assert.equal(await active(page), first.k);
                    assert.equal((await readBar(page)).isOpen, false);
                }
                assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.k)), [], 'opening runs nothing');
                await page.close();
            });

            await check(name('up opens a section on its last item'), async () => {
                const page = await entered();
                await page.keyboard.press('ArrowUp');
                assert.equal(await active(page), first.lastItem);
                await page.keyboard.press('ArrowDown');
                assert.equal(await active(page), first.firstItem, 'rows wrap');
                await page.keyboard.press('End');
                assert.equal(await active(page), first.lastItem);
                await page.keyboard.press('Home');
                assert.equal(await active(page), first.firstItem);
                await page.close();
            });

            await check(name('arrow right opens a submenu and arrow left closes it'), async () => {
                /* The first item of the second section is greyed in this state: Enter on it runs nothing. */
                const page = await entered({context: R.second.firstLocked});
                for (let i = 0; i < sub.index; i++) await page.keyboard.press('ArrowDown');
                assert.equal(await active(page), sub.row);
                await page.keyboard.press('ArrowRight');
                let state = await readBar(page);
                assert.equal(state.active, sub.rows[0]);
                assert.deepEqual(state.open.map(d => d.level), ['0', '1']);
                await page.keyboard.press('ArrowDown');
                assert.equal(await active(page), sub.rows[1]);
                await page.keyboard.press('ArrowLeft');
                state = await readBar(page);
                assert.equal(state.active, sub.row);
                assert.deepEqual(state.open.map(d => d.level), ['0']);
                /* Enter on the submenu row opens it as well; arrows at a plain row go to the next section. */
                await page.keyboard.press('Enter');
                assert.equal(await active(page), sub.rows[0]);
                await page.keyboard.press('ArrowLeft');
                for (let i = 1; i < sub.index; i++) await page.keyboard.press('ArrowUp');
                assert.equal(await active(page), first.firstItem);
                await page.keyboard.press('ArrowRight');
                state = await readBar(page);
                assert.deepEqual(state.open.map(d => d.label), [R.second.label]);
                await page.keyboard.press('Enter');
                assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.k)), [], 'a greyed row does not run');
                await page.close();
            });

            await check(name('escape closes the submenu, then the section, and releases keys'), async () => {
                const page = await entered();
                await page.keyboard.press('ArrowDown');
                await page.evaluate(k => menu.el.querySelector(`[data-k="${k}"]`).focus(), sub.row);
                await page.keyboard.press('ArrowRight');
                assert.deepEqual((await readBar(page)).open.map(d => d.level), ['0', '1']);
                await page.keyboard.press('Escape');
                let state = await readBar(page);
                assert.deepEqual(state.open.map(d => d.level), ['0']);
                assert.equal(state.active, sub.row);
                await page.keyboard.press('Escape');
                state = await readBar(page);
                assert.equal(state.isOpen, false);
                assert.equal(state.active, first.k);
                assert.ok(!(await keys(page)).includes('release'), 'keys are held while focus is in the menu bar');
                await page.keyboard.press('Escape');
                assert.deepEqual((await keys(page)).filter(k => k === 'release'), ['release']);
                assert.equal(await active(page), 'field');
                await page.close();
            });

            await check(name('escape returns focus to the opener field and keeps its value'), async () => {
                const page = await openMenu(browser, editor, {bar: FILE});
                await page.click('#field');
                await page.keyboard.press('End');
                await page.keyboard.type(' typed');
                await page.keyboard.press('F10');
                await page.keyboard.press('ArrowRight');
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('Escape');
                await page.keyboard.press('Escape');
                const field = await page.evaluate(() => ({focused: document.activeElement.id,
                    value: document.getElementById('field').value}));
                assert.deepEqual(field, {focused: 'field', value: 'draft text typed'});
                await page.close();
            });

            await check(name('tab closes the menu'), async () => {
                const page = await entered();
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('Tab');
                let state = await readBar(page);
                assert.equal(state.isOpen, false);
                assert.equal(state.active, 'next', 'Tab leaves the menu bar for the next stop');
                await page.keyboard.press('Shift+Tab');
                assert.equal(await active(page), first.k, 'the menu bar is one Tab stop');
                await page.keyboard.press('Enter');
                await page.keyboard.press('Shift+Tab');
                state = await readBar(page);
                assert.equal(state.isOpen, false);
                assert.equal(state.active, 'field');
                await page.close();
            });

            /* The document stand-in: the engine cancels pointerdown over its canvas, so a click on it
               moves no focus. */
            const addDocument = page => page.evaluate(() => {
                const doc = document.createElement('div');
                doc.id = 'doc';
                doc.style.cssText = 'position:absolute;left:400px;top:200px;width:300px;height:100px';
                for (const type of ['pointerdown', 'mousedown']) doc.addEventListener(type, e => e.preventDefault());
                document.body.appendChild(doc);
            });
            const released = async page => {
                const list = await keys(page);
                return {count: list.filter(k => k === 'release').length, last: list[list.length - 1]};
            };

            await check(name('leaving the menu bar by tab or a click gives the keys back'), async () => {
                /* Tab from a section button and from an open list. */
                for (const open of [false, true]) {
                    const page = await entered();
                    if (open) await page.keyboard.press('ArrowDown');
                    await page.keyboard.press('Tab');
                    await settle(page);
                    assert.equal(await active(page), 'next', 'open: ' + open);
                    assert.deepEqual(await released(page), {count: 1, last: 'release'}, 'Tab, open: ' + open);
                    await page.close();
                }
                /* A click on the document with the menu closed and with a section open. */
                for (const open of [false, true]) {
                    const page = await entered();
                    await addDocument(page);
                    if (open) await page.keyboard.press('Enter');
                    assert.equal((await readBar(page)).isOpen, open);
                    await page.click('#doc');
                    await settle(page);
                    assert.equal((await readBar(page)).isOpen, false, 'the click closes the menu, open: ' + open);
                    assert.deepEqual(await released(page), {count: 1, last: 'release'}, 'document click, open: ' + open);
                    /* Moving about the bar later with the mouse takes nothing. */
                    await page.click(`[data-k="${first.k}"]`);
                    await page.click('#doc');
                    assert.equal((await keys(page)).filter(k => k === 'hold').length, open ? 2 : 1, 'no hold after release');
                    await page.close();
                }
                /* A click on an empty place of the page takes the focus out of the bar. */
                const page = await entered();
                await page.mouse.click(600, 650);
                await settle(page);
                assert.equal(await page.evaluate(() => menu.el.contains(document.activeElement)), false);
                assert.deepEqual(await released(page), {count: 1, last: 'release'}, 'page click');
                await page.close();
            });

            await check(name('f10 is not taken while a window or a loading mask covers the editor'), async () => {
                const page = await openMenu(browser, editor, {bar: FILE, context: R.modal.on});
                const press = () => page.evaluate(() => {
                    const e = new KeyboardEvent('keydown', {key: 'F10', bubbles: true, cancelable: true});
                    document.getElementById('field').dispatchEvent(e);
                    return e.defaultPrevented;
                });
                await page.focus('#field');
                assert.equal(await press(), false, 'the window gets the key');
                assert.equal(await active(page), 'field');
                assert.deepEqual(await keys(page), [], 'the keys stay as they are');
                await patch(page, R.modal.off);
                if (R.modal.mask) {
                    await page.evaluate(() => {
                        const mask = document.createElement('div');
                        mask.className = 'asc-loadmask';
                        mask.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px';
                        document.body.appendChild(mask);
                    });
                    assert.equal(await press(), false, 'the loading mask gets the key');
                    assert.deepEqual(await keys(page), []);
                    await page.evaluate(() => document.querySelector('.asc-loadmask').remove());
                }
                assert.equal(await press(), true, 'without the layer F10 enters');
                assert.equal(await active(page), first.k);
                assert.deepEqual(await keys(page), ['hold']);
                await page.close();
            });

            /* A row the editor draws itself (a size grid, a value) runs its command through the menu
               bar: the menu closes and the engine keys taken by F10 are given back for good, so a
               list opened later with the mouse does not take them again. */
            const W = R.widget;
            if (!W) {
                skip(name('own row command gives the keys back for good'), 'the editor has no widget rows yet');
            } else {
                await check(name('own row command gives the keys back for good'), async () => {
                    const page = await entered({context: W.context});
                    await page.keyboard.press('ArrowDown');
                    await page.evaluate(W => menu.open(W.section), W);
                    const ran = await page.evaluate(W => {
                        const own = adapter.groups(W.section).filter(it => it.k === W.row)[0];
                        return menu.exec(own, {value: 7});
                    }, W);
                    assert.equal(ran, true, 'the own row command ran');
                    assert.deepEqual(await page.evaluate(k => ctx.log.filter(e => e.k === k).map(e => e.args), W.row),
                        [{value: 7}]);
                    assert.equal((await readBar(page)).isOpen, false, 'the command closes the menu');
                    const before = await keys(page);
                    assert.equal(before[before.length - 1], 'beforeCommand', 'the keys go back before the command');
                    /* A list opened later with the mouse and closed by a click aside keeps the keys
                       with the document. */
                    await page.click(`[data-k="${first.k}"]`);
                    await page.click('#next');
                    assert.equal((await readBar(page)).isOpen, false);
                    assert.deepEqual((await keys(page)).slice(before.length).filter(k => k === 'hold'), [],
                        'no hold after the command');
                    /* A greyed own row does not run and keeps the menu as it is. */
                    await page.focus('#field');
                    await page.keyboard.press('F10');
                    await page.evaluate(W => menu.open(W.section), W);
                    const refused = await page.evaluate(W => {
                        const own = adapter.groups(W.section).filter(it => it.k === W.row)[0];
                        const saved = adapter.itemState;
                        adapter.itemState = it => (it === own ? {visible: true, disabled: true} : saved(it));
                        const result = menu.exec(own, {value: 8});
                        adapter.itemState = saved;
                        return result;
                    }, W);
                    assert.equal(refused, false, 'a greyed own row is refused');
                    assert.equal((await readBar(page)).isOpen, true, 'the menu stays open');
                    assert.deepEqual(await page.evaluate(k => ctx.log.filter(e => e.k === k).length, W.row), 1);
                    await page.close();
                });
            }

            /* Where focus is: data-k of a row or the class of a control the editor drew in its row. */
            const where = page => page.evaluate(() => {
                const el = document.activeElement;
                if (!el || !menu.el.contains(el)) return el && el.id || null;
                return el.getAttribute('data-k') || '.' + el.className.split(' ')[0];
            });
            /* F10 and the section open on its first row. */
            const inSection = async (k, options = {}) => {
                const page = await entered(options);
                for (let i = 0; i < order.indexOf(k); i++) await page.keyboard.press('ArrowRight');
                await page.keyboard.press('ArrowDown');
                return page;
            };
            const downTo = async (page, k) => {
                for (let i = 0; i < 20 && await where(page) !== k; i++) await page.keyboard.press('ArrowDown');
                assert.equal(await where(page), k);
            };
            const levels = async page => (await readBar(page)).open.map(d => d.level);

            /* Submenus two levels deep from the keyboard. */
            const D = R.deep;
            if (!D) {
                skip(name('a second level submenu opens from the keyboard and closes level by level'), 'the editor nests no submenus');
                skip(name('escape closes only the deepest submenu'), 'the editor nests no submenus');
            } else {
                /* The second level open with focus on its first row. */
                const deepest = async () => {
                    const page = await inSection(D.section);
                    for (let i = 0; i < D.rows.length; i++) {
                        await downTo(page, D.rows[i]);
                        await page.keyboard.press('ArrowRight');
                        assert.equal(await where(page), D.firsts[i], 'level ' + (i + 1));
                    }
                    assert.deepEqual(await levels(page), ['0', '1', '2']);
                    return page;
                };

                await check(name('a second level submenu opens from the keyboard and closes level by level'), async () => {
                    const page = await deepest();
                    /* Placed like the first level: at the side of its row, first rows level with it. */
                    const place = await page.evaluate(k => {
                        const row = menu.el.querySelector(`[data-k="${k}"]`).getBoundingClientRect();
                        const fly = Array.from(menu.el.querySelectorAll('.vo-mn-fly')).find(f => f.getAttribute('data-level') === '2');
                        const first = fly.querySelector('.vo-mn-sub').getBoundingClientRect(), box = fly.getBoundingClientRect();
                        return {side: Math.abs(box.left - row.right) <= 4 || Math.abs(box.right - row.left) <= 4,
                            level: Math.abs(first.top - row.top) <= 0.5};
                    }, D.rows[1]);
                    assert.deepEqual(place, {side: true, level: true});
                    /* A refresh keeps both levels open and redraws the second one. */
                    await patch(page, D.change);
                    await page.evaluate(() => menu.refresh());
                    await settle(page);
                    assert.deepEqual(await levels(page), ['0', '1', '2'], 'refresh keeps the second level');
                    assert.equal(await where(page), D.firsts[1], 'and the focus in it');
                    assert.equal(await page.evaluate(C => {
                        const h = menu.el.querySelector(`[data-k="${C.row}"] .vo-mn-h`);
                        return h && h.textContent;
                    }, D.changed), D.changed.hint);
                    /* Arrow left closes one level at a time. */
                    await page.keyboard.press('ArrowLeft');
                    assert.deepEqual(await levels(page), ['0', '1']);
                    assert.equal(await where(page), D.rows[1]);
                    await page.keyboard.press('ArrowLeft');
                    assert.deepEqual(await levels(page), ['0']);
                    assert.equal(await where(page), D.rows[0]);
                    /* Enter opens a level as well. */
                    await page.keyboard.press('Enter');
                    await downTo(page, D.rows[1]);
                    await page.keyboard.press('Enter');
                    assert.equal(await where(page), D.firsts[1]);
                    assert.deepEqual(await levels(page), ['0', '1', '2']);
                    await page.close();
                });

                await check(name('escape closes only the deepest submenu'), async () => {
                    const page = await deepest();
                    await page.keyboard.press('Escape');
                    assert.deepEqual(await levels(page), ['0', '1']);
                    assert.equal(await where(page), D.rows[1]);
                    await page.keyboard.press('Escape');
                    assert.deepEqual(await levels(page), ['0']);
                    assert.equal(await where(page), D.rows[0]);
                    await page.keyboard.press('Escape');
                    assert.equal((await readBar(page)).isOpen, false);
                    assert.equal(await where(page), D.section);
                    assert.ok(!(await keys(page)).includes('release'), 'the keys stay with the menu bar');
                    await page.close();
                });
            }

            /* Controls of an own row (buttons, a field) in the walk of the list. */
            if (!W || !W.walk) {
                skip(name('arrows reach the controls of a widget row'), 'the editor has no own row with controls');
                skip(name('a widget row control runs through exec'), 'the editor has no own row with controls');
            } else {
                await check(name('arrows reach the controls of a widget row'), async () => {
                    const page = await inSection(W.section, {context: W.context});
                    /* The stock editor stops any key inside a [role=menu] list (Bootstrap): a field
                       of the row has to get its keys anyway. */
                    await page.evaluate(() => document.addEventListener('keydown', e => {
                        if (e.target.closest && e.target.closest('[role=menu]')) e.preventDefault();
                    }));
                    assert.equal(await where(page), W.walk[0]);
                    const seen = [];
                    for (let i = 1; i < W.walk.length; i++) {
                        await page.keyboard.press('ArrowDown');
                        seen.push(await where(page));
                    }
                    assert.deepEqual(seen, W.walk.slice(1), 'down');
                    for (let i = W.walk.length - 2; i >= 0; i--) {
                        await page.keyboard.press('ArrowUp');
                        assert.equal(await where(page), W.walk[i], 'up');
                    }
                    /* In the field the keys edit the text; up and down leave it. */
                    await downTo(page, W.field);
                    for (const key of ['End', 'Home', 'ArrowRight', 'ArrowLeft']) {
                        await page.keyboard.press(key);
                        assert.equal(await where(page), W.field, key + ' stays in the field');
                    }
                    await page.keyboard.press('ControlOrMeta+A');
                    await page.keyboard.type('7 5');
                    assert.equal(await page.evaluate(sel => menu.el.querySelector(sel).value, W.field), '7 5');
                    assert.equal((await readBar(page)).isOpen, true);
                    /* Tab from a control leaves the list like from a row. */
                    await page.keyboard.press('Tab');
                    const state = await readBar(page);
                    assert.equal(state.isOpen, false);
                    assert.equal(state.active, 'next');
                    assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.k)), [], 'walking runs nothing');
                    await page.close();
                });

                await check(name('a widget row control runs through exec'), async () => {
                    const page = await inSection(W.section, {context: W.context});
                    await page.evaluate(() => { ctx.bar = menu; });
                    await downTo(page, W.control);
                    await page.keyboard.press('Enter');
                    assert.deepEqual(await page.evaluate(k => ctx.log.filter(e => e.k === k).map(e => e.args), W.row), [W.runs]);
                    assert.equal((await readBar(page)).isOpen, false, 'the command closes the menu');
                    const list = await keys(page);
                    assert.equal(list[list.length - 1], 'beforeCommand', 'the keys go back to the document');
                    await page.close();
                });
            }

            /* A submenu the editor shows on its own surface outside the menu bar (a gallery): the
               surface belongs to the open menu, its choice closes the menu like a command, and its
               own closing returns focus to the row that opened it. */
            const O = R.owned;
            const ownedChecks = ['click inside an owned surface keeps the menu open',
                'focus moving into an owned surface keeps the engine keyboard held',
                'right arrow puts focus into an owned surface',
                'a choice in the owned surface closes the menu and gives the keyboard back',
                'a dismissed owned surface returns focus to its row'];
            if (!O) {
                ownedChecks.forEach(text => skip(name(text), 'the editor shows no submenu on its own surface yet'));
            } else {
                const bind = page => page.evaluate(() => { ctx.bar = menu; });
                const surface = page => page.evaluate(O => {
                    const el = document.querySelector(O.surface), active = document.activeElement;
                    return {open: !!el, focus: el && el.contains(active) ? active.getAttribute('data-choice') ||
                        active.className : null};
                }, O);
                const expanded = page => page.evaluate(k => menu.el.querySelector(`[data-k="${k}"]`)
                    .getAttribute('aria-expanded'), O.row);
                /* F10, the section and the row of the surface in focus. */
                const atRow = async () => {
                    const page = await entered({context: O.context});
                    await bind(page);
                    for (let i = 0; i < O.index; i++) await page.keyboard.press('ArrowDown');
                    assert.equal(await active(page), O.row);
                    return page;
                };

                await check(name(ownedChecks[0]), async () => {
                    const page = await openMenu(browser, editor, {bar: FILE, context: O.context});
                    await bind(page);
                    await page.click(`[data-k="${O.section}"]`);
                    await page.click(`[data-k="${O.row}"]`);
                    assert.equal((await surface(page)).open, true, 'the row opens the surface');
                    assert.equal(await expanded(page), 'true');
                    await page.click(O.surface, {position: {x: 2, y: 2}});
                    assert.equal((await readBar(page)).isOpen, true, 'a click inside the surface keeps the menu');
                    assert.equal((await surface(page)).open, true);
                    assert.equal(await expanded(page), 'true');
                    await page.mouse.click(300, 600);
                    assert.equal((await readBar(page)).isOpen, false, 'a click aside still closes the menu');
                    assert.equal((await surface(page)).open, false, 'and the surface with it');
                    await page.close();
                });

                await check(name(ownedChecks[1]), async () => {
                    const page = await atRow();
                    await page.click(`[data-k="${O.row}"]`);
                    await page.focus(`${O.surface} ${O.choice}`);
                    await settle(page);
                    assert.ok((await surface(page)).focus, 'focus is in the surface');
                    assert.ok(!(await keys(page)).includes('release'), 'the keys stay with the menu');
                    assert.equal((await readBar(page)).isOpen, true);
                    /* Focus leaving the surface for the page gives them back. */
                    await page.focus('#next');
                    await settle(page);
                    const list = await keys(page);
                    assert.deepEqual([list.filter(k => k === 'release').length, list[list.length - 1]], [1, 'release']);
                    await page.close();
                });

                await check(name(ownedChecks[2]), async () => {
                    const page = await atRow();
                    await page.keyboard.press('ArrowRight');
                    let state = await surface(page);
                    assert.equal(state.open, true);
                    assert.equal(state.focus, O.chosen, 'focus on the first choice of the surface');
                    assert.equal(await expanded(page), 'true');
                    assert.ok(!(await keys(page)).includes('release'), 'the keys stay with the menu');
                    /* Escape closes the surface alone and returns focus to its row. */
                    await page.keyboard.press('Escape');
                    state = await surface(page);
                    assert.equal(state.open, false);
                    assert.equal(await active(page), O.row);
                    assert.deepEqual((await readBar(page)).open.map(d => d.level), ['0']);
                    assert.equal(await expanded(page), 'false');
                    /* Enter opens it the same way. */
                    await page.keyboard.press('Enter');
                    assert.equal((await surface(page)).focus, O.chosen);
                    assert.ok(!(await keys(page)).includes('release'));
                    await page.close();
                });

                await check(name(ownedChecks[3]), async () => {
                    const page = await atRow();
                    await page.keyboard.press('ArrowRight');
                    await page.keyboard.press('Enter');
                    assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.k).map(e => e.k)), [O.chosen]);
                    assert.equal((await surface(page)).open, false);
                    const state = await readBar(page);
                    assert.equal(state.isOpen, false, 'the choice closes the menu');
                    assert.deepEqual(state.open, []);
                    const before = await keys(page);
                    assert.equal(before[before.length - 1], 'beforeCommand', 'the keys go back to the document');
                    /* Opened later with the mouse and closed by a click aside, the menu takes no keys. */
                    await page.click(`[data-k="${first.k}"]`);
                    await page.click('#next');
                    assert.deepEqual((await keys(page)).slice(before.length), [], 'no hold after the choice');
                    await page.close();
                });

                await check(name(ownedChecks[4]), async () => {
                    const page = await atRow();
                    await page.keyboard.press('ArrowRight');
                    await page.click(`${O.surface} ${O.dismiss}`);
                    assert.equal((await surface(page)).open, false);
                    assert.equal(await active(page), O.row, 'focus back on the row');
                    assert.equal(await expanded(page), 'false');
                    const state = await readBar(page);
                    assert.equal(state.isOpen, true, 'the section stays open');
                    assert.deepEqual(state.open.map(d => d.level), ['0']);
                    assert.ok(!(await keys(page)).includes('release'), 'the keys stay with the menu');
                    assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.k)), [], 'nothing ran');
                    /* The surface opens again from its row. */
                    await page.keyboard.press('ArrowRight');
                    assert.equal((await surface(page)).focus, O.chosen);
                    await page.close();
                });
            }
        }
    } finally {
        await browser.close();
    }
    done();
})().catch(error => { console.error('FAIL', error); process.exitCode = 1; });
