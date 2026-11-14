/* Run after the document editor LESS build: node test/unit-tests/documenteditor/compact-top-scroll.cjs
 * COMPACT_CSS_DOCUMENTEDITOR (or COMPACT_CSS) names the compiled app.css.
 * The header and the menu bar of the compact shell leave while the document scrolls down and come back on the
 * way up; the toolbar stays. They stay while a menu, a list or a window is open, while the keyboard is in
 * them and while the menu bar shows a message (the edit request, the paste hint); the chevron, Escape and F10
 * bring back a top that left by scrolling, F10 not under a window; scrolling does not bring back a
 * top collapsed by hand, except in the view mode, which has no chevron. The shift of the document caused by
 * the switch itself does not switch the top again.
 * The shell, the menu bar, the catalog and the outline rail with its frame loop are the real modules in
 * headless Chrome (fixtures/compact-shell-page.cjs); the engine scroll is a stand-in that clamps the position
 * to the range on a resize, as the engine does.
 */
const assert = require('node:assert/strict');
const shellPage = require('./fixtures/compact-shell-page.cjs');

(async () => {
    const browser = await shellPage.launch();
    const {check, done} = shellPage.checker();
    const screen = shellPage.screen;
    const frames = (page, n = 4) => page.evaluate(n => new Promise(ok => {
        const step = () => (n-- > 0 ? requestAnimationFrame(step) : ok());
        step();
    }), n);
    const press = async (page, key) => { await page.keyboard.press(key); await frames(page); };
    const fresh = async (options = {}) => {
        const page = await shellPage.open(browser, options);
        await page.evaluate(() => {
            window.switches = [];
            const set = shell.setChrome;
            shell.setChrome = function (state) {
                switches.push(state.hidden ? 'hide:' + state.cause : 'show');
                return set.apply(this, arguments);
            };
            focusText();
        });
        await frames(page);
        return page;
    };
    /* The engine moves the document: one position per frame, as the frame loop reads it. */
    const scroll = async (page, ...positions) => {
        for (const y of positions) {
            await page.evaluate(y => docScroll.to(y), y);
            await frames(page, 2);
        }
        await frames(page, 2);
    };
    const wheel = async (page, dy) => {
        await page.mouse.move(700, 450);
        await page.mouse.wheel(0, dy);
        await frames(page);
    };
    const switches = page => page.evaluate(() => switches.slice());
    const top = async page => {
        const s = await screen(page);
        return {hidden: s.topHidden, cause: s.cause, header: s.header, menu: s.menu};
    };
    const SHOWN = {hidden: false, cause: null, header: true, menu: true};
    const GONE = {hidden: true, cause: 'scroll', header: false, menu: false};

    try {
        await check('wheel down hides the header and menu and keeps the toolbar', async () => {
            const page = await fresh();
            await wheel(page, 40);
            await wheel(page, 30);
            assert.deepEqual(await top(page), SHOWN, 'still near the start of the document');
            await wheel(page, 40);
            assert.deepEqual(await top(page), SHOWN, 'a small turn of the wheel keeps the top');
            await wheel(page, 60);
            const s = await screen(page);
            assert.deepEqual({hidden: s.topHidden, cause: s.cause, header: s.header, menu: s.menu},
                GONE, 'gone after the threshold');
            assert.deepEqual([s.toolbar, s.status, s.rail, s.toolbarArea], [true, true, true, 4]);
            assert.equal(s.focus, false, 'scrolling is not the focus mode');
            assert.equal(await page.evaluate(() => document.body.classList.contains('vo-top-scroll')), true);
            assert.deepEqual(await switches(page), ['hide:scroll']);
            assert.equal(s.active, 'area_id', 'the caret stays in the text');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('wheel up returns them', async () => {
            const page = await fresh();
            await scroll(page, 400, 600);
            assert.deepEqual(await top(page), GONE);
            await wheel(page, -40);
            assert.deepEqual(await top(page), GONE, 'less than the threshold up');
            await wheel(page, -60);
            assert.deepEqual(await top(page), SHOWN);
            assert.equal((await screen(page)).toolbarArea, 80);
            assert.deepEqual(await switches(page), ['hide:scroll', 'show']);
            await page.close();
        });

        await check('page down hides the top like the wheel', async () => {
            const page = await fresh();
            await page.evaluate(() => docScroll.to(200));
            await frames(page);
            await press(page, 'PageDown');
            assert.deepEqual(await top(page), GONE);
            await press(page, 'PageUp');
            assert.deepEqual(await top(page), SHOWN, 'and page up brings it back');
            await page.close();
        });

        await check('top stays while a menu section is open', async () => {
            const page = await fresh();
            await page.click('.vo-mn-item[data-k="view"]');
            assert.equal(await page.evaluate(() => shell.menu.isOpen()), true);
            await scroll(page, 300, 600, 900);
            assert.deepEqual(await top(page), SHOWN);
            await page.evaluate(() => shell.menu.close());
            await scroll(page, 950);
            assert.deepEqual(await top(page), SHOWN, 'the path counts from the closing');
            await scroll(page, 1000);
            assert.deepEqual(await top(page), GONE);
            await page.close();
        });

        await check('top stays while the document context menu is open', async () => {
            const page = await fresh();
            await page.evaluate(() => {
                const group = document.createElement('div');
                group.id = 'context'; group.className = 'btn-group open';
                group.innerHTML = '<ul class="dropdown-menu" style="display:block"><li><a href="#">Copy</a></li></ul>';
                document.body.appendChild(group);
            });
            await scroll(page, 300, 600);
            assert.deepEqual(await top(page), SHOWN);
            await page.evaluate(() => document.getElementById('context').classList.remove('open'));
            await scroll(page, 700);
            assert.deepEqual(await top(page), GONE);
            await page.close();
        });

        await check('top stays while a dialog is open', async () => {
            const page = await fresh();
            await page.evaluate(() => {
                const win = document.createElement('div');
                win.id = 'dialog'; win.className = 'asc-window modal';
                win.style.cssText = 'display:block;position:fixed;left:10px;top:10px;width:50px;height:50px';
                document.body.appendChild(win);
            });
            await scroll(page, 300, 600);
            assert.deepEqual(await top(page), SHOWN);
            /* A popover of the toolbar is the same. */
            await page.evaluate(() => {
                document.getElementById('dialog').remove();
                document.getElementById('tb-pop').classList.add('open');
            });
            await scroll(page, 700, 800);
            assert.deepEqual(await top(page), SHOWN);
            await page.evaluate(() => document.getElementById('tb-pop').classList.remove('open'));
            await scroll(page, 900);
            assert.deepEqual(await top(page), GONE);
            await page.close();
        });

        await check('top stays while the search bar is open', async () => {
            const page = await fresh();
            /* The stock search bar is a window without a mask: no modal class. */
            await page.evaluate(() => {
                const bar = document.createElement('div');
                bar.id = 'search-bar'; bar.className = 'asc-window search-bar';
                bar.style.cssText = 'display:block;position:fixed;right:10px;top:150px;width:300px;height:54px';
                document.body.appendChild(bar);
                focusText();
            });
            /* The next match lower in the document: the engine follows it. */
            await scroll(page, 300, 600, 900);
            assert.deepEqual(await top(page), SHOWN);
            /* Closed, it stays in the page hidden and holds nothing; a hidden dialog neither. */
            await page.evaluate(() => {
                document.getElementById('search-bar').style.display = 'none';
                const win = document.createElement('div');
                win.className = 'asc-window modal';
                win.style.cssText = 'display:none;position:fixed;left:10px;top:10px;width:50px;height:50px';
                document.body.appendChild(win);
            });
            await scroll(page, 950);
            assert.deepEqual(await top(page), SHOWN, 'the path counts from the closing');
            await scroll(page, 1000);
            assert.deepEqual(await top(page), GONE);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('top stays while the left search panel is open', async () => {
            const page = await fresh();
            await page.evaluate(() => { shell.toggleLeftPanel('search'); focusText(); });
            await frames(page);
            assert.equal(await page.evaluate(() => shell.openLeftPanel()), 'search');
            await scroll(page, 300, 600, 900);
            assert.deepEqual(await top(page), SHOWN);
            /* Another panel does not hold the top. */
            await page.evaluate(() => { shell.toggleLeftPanel('navigation'); focusText(); });
            await frames(page);
            assert.equal(await page.evaluate(() => shell.openLeftPanel()), 'navigation');
            await scroll(page, 950, 1050);
            assert.deepEqual(await top(page), GONE);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('top stays while the slash list is open', async () => {
            const page = await fresh();
            await page.evaluate(() => { slash.open = true; });
            await scroll(page, 300, 600, 900);
            assert.deepEqual(await top(page), SHOWN);
            await page.evaluate(() => slash.hide());
            await scroll(page, 950);
            assert.deepEqual(await top(page), SHOWN, 'the path counts from the closing');
            await scroll(page, 1000);
            assert.deepEqual(await top(page), GONE);
            await page.close();
        });

        await check('top stays while the keyboard is in the menu bar', async () => {
            const page = await fresh();
            await press(page, 'F10');
            assert.equal(await page.evaluate(() => shell.menu.el.contains(document.activeElement)), true);
            assert.equal(await page.evaluate(() => shell.menu.isOpen()), false, 'only the keyboard, no list');
            await scroll(page, 300, 600);
            assert.deepEqual(await top(page), SHOWN);
            /* In the title of the header — the same. */
            await page.evaluate(() => {
                const field = document.createElement('input');
                field.id = 'title';
                document.querySelector('.vo-hd').appendChild(field);
                field.focus();
            });
            await scroll(page, 800, 1000);
            assert.deepEqual(await top(page), SHOWN);
            await page.evaluate(() => focusText());
            await scroll(page, 1100);
            assert.deepEqual(await top(page), GONE);
            await page.close();
        });

        await check('manual collapse survives scrolling up to the start', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.toggleFocus());
            await frames(page);
            await scroll(page, 300, 600, 900);
            await scroll(page, 600, 300, 0);
            const s = await screen(page);
            assert.deepEqual([s.topHidden, s.cause, s.focus, s.header, s.menu], [true, 'manual', true, false, false]);
            assert.deepEqual(await switches(page), ['hide:manual']);
            await page.close();
        });

        await check('chevron returns a top hidden by scroll and reports pressed before', async () => {
            const page = await fresh();
            await scroll(page, 400, 600);
            assert.deepEqual(await top(page), GONE);
            const chevron = () => page.evaluate(() => {
                const b = document.getElementById('tb-focus');
                return {on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed')};
            });
            assert.deepEqual(await chevron(), {on: true, pressed: 'true'});
            assert.equal(await page.evaluate(() => shell.menuAdapter.itemState(actions.command('view.focus')).checked),
                false, 'the menu check stays for the manual collapse');
            /* The chevron runs the catalog command (the toolbar test checks the wiring). */
            await page.evaluate(() => actions.command('view.focus').run());
            await frames(page);
            assert.deepEqual(await top(page), SHOWN);
            assert.deepEqual(await chevron(), {on: false, pressed: 'false'});
            await page.close();
        });

        await check('escape returns a top hidden by scroll', async () => {
            const page = await fresh();
            await scroll(page, 400, 600);
            assert.deepEqual(await top(page), GONE);
            await press(page, 'Escape');
            assert.deepEqual(await top(page), SHOWN);
            /* More frames after the return add no switch. */
            await frames(page, 6);
            assert.deepEqual(await switches(page), ['hide:scroll', 'show']);
            await page.close();
        });

        await check('f10 returns a top hidden by scroll and enters the menu bar', async () => {
            const page = await fresh();
            await scroll(page, 400, 600);
            assert.deepEqual(await top(page), GONE);
            await press(page, 'F10');
            assert.deepEqual(await top(page), SHOWN);
            assert.equal(await page.evaluate(() => shell.menu.el.contains(document.activeElement)), true);
            assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.api === 'asc_enableKeyEvents')
                .map(e => e.args[0]).pop()), false, 'the menu holds the keyboard of the engine');
            /* While the keyboard is there, scrolling does not take the top away. */
            await scroll(page, 900, 1200);
            assert.deepEqual(await top(page), SHOWN);
            await page.close();
        });

        await check('f10 leaves the top hidden while a window covers the editor', async () => {
            const page = await fresh();
            await scroll(page, 400, 600);
            assert.deepEqual(await top(page), GONE);
            await page.evaluate(() => { ctx.modal = true; });
            await press(page, 'F10');
            assert.deepEqual(await top(page), GONE);
            assert.equal(await page.evaluate(() => shell.menu.el.contains(document.activeElement)), false);
            await page.evaluate(() => { ctx.modal = false; focusText(); });
            await press(page, 'F10');
            assert.deepEqual(await top(page), SHOWN, 'once the window is gone');
            await page.close();
        });

        await check('edit request hint returns a hidden top', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.bindMenuRefresh());
            await page.evaluate(() => shell.toggleFocus());
            await frames(page);
            await page.evaluate(() => ctx.trigger('editrequest:status', 'Requesting editing rights...'));
            await frames(page);
            assert.deepEqual(await top(page), SHOWN, 'a manual collapse');
            assert.equal(await page.evaluate(() => shell.menu.status().textContent), 'Requesting editing rights...');
            /* While the message is in the menu bar, the top stays. */
            await scroll(page, 400, 800);
            assert.deepEqual(await top(page), SHOWN);
            await page.evaluate(() => ctx.trigger('editrequest:status', ''));
            await scroll(page, 1000);
            assert.deepEqual(await top(page), GONE);
            await page.evaluate(() => ctx.trigger('editrequest:status', 'Editing is not possible now'));
            await frames(page);
            assert.deepEqual(await top(page), SHOWN, 'gone by scrolling');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('paste hint in the menu bar keeps the top until it goes out', async () => {
            const page = await fresh();
            /* The hint goes out by its own timer: the timer is taken to be run here at once. */
            await page.evaluate(() => {
                const set = window.setTimeout;
                window.setTimeout = (fn, ms, ...args) => {
                    if (ms === 5000) { window.hintOut = fn; return 0; }
                    return set(fn, ms, ...args);
                };
                actions.pasteHint();
                window.setTimeout = set;
            });
            const hint = () => page.evaluate(() => shell.menu.status().textContent);
            assert.notEqual(await hint(), '', 'the hint is shown');
            assert.equal(await page.evaluate(() => typeof hintOut), 'function', 'and goes out by a timer');
            /* Scrolling down while the hint is there: the wheel or the caret. */
            await scroll(page, 300, 600);
            await wheel(page, 100);
            assert.deepEqual(await top(page), SHOWN);
            await page.evaluate(() => hintOut());
            assert.equal(await hint(), '', 'the hint went out');
            await scroll(page, 750);
            assert.deepEqual(await top(page), SHOWN, 'the path counts from the hint going out');
            await scroll(page, 850);
            assert.deepEqual(await top(page), GONE);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('view mode hides the header and menu on scroll', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.applyDocModeLook('view'));
            await frames(page);
            await scroll(page, 400, 600);
            const s = await screen(page);
            assert.deepEqual({hidden: s.topHidden, cause: s.cause, header: s.header, menu: s.menu, toolbar: s.toolbar,
                area: s.toolbarArea}, {hidden: true, cause: 'scroll', header: false, menu: false, toolbar: false, area: 0});
            await scroll(page, 500);
            assert.deepEqual(await top(page), SHOWN);
            await page.close();
        });

        await check('view mode manual collapse returns on scroll up but not at the start', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.applyDocModeLook('view'));
            await page.evaluate(() => actions.command('view.focus').run());
            await frames(page);
            assert.equal((await screen(page)).cause, 'manual');
            await scroll(page, 40, 0, 60, 20);
            assert.equal((await screen(page)).cause, 'manual', 'the start of the document keeps it');
            await scroll(page, 300, 600);
            assert.equal((await screen(page)).cause, 'manual', 'scrolling down keeps it');
            await scroll(page, 560);
            assert.equal((await screen(page)).cause, 'manual', 'less than the threshold up');
            await scroll(page, 500);
            assert.deepEqual(await top(page), SHOWN, 'up by the threshold');
            assert.deepEqual(await switches(page), ['hide:manual', 'show']);
            await page.close();
        });

        await check('end of document does not flicker after the top leaves', async () => {
            const page = await fresh();
            const max = await page.evaluate(() => docScroll.max);
            /* Back up to show the top, then one jump to the very end (End, the scrollbar): the rows leave
               right at the end. */
            await scroll(page, max - 500, max - 600);
            assert.deepEqual(await top(page), SHOWN);
            await scroll(page, max);
            assert.deepEqual(await top(page), GONE);
            /* The area grew by the rows, the range shrank by them and the engine clamped the position. */
            const after = await page.evaluate(() => ({pos: docScroll.pos, max: docScroll.max}));
            assert.equal(after.max, max - 76);
            assert.equal(after.pos, after.max);
            /* More turns of the wheel at the end. */
            await wheel(page, 100);
            await wheel(page, 100);
            await frames(page, 10);
            assert.deepEqual(await top(page), GONE);
            assert.deepEqual(await switches(page), ['hide:scroll', 'show', 'hide:scroll'], 'one switch at the end, no flicker');

            /* A document longer than the area by 76 to 151 px: after the rows left, its end would fall below
               the threshold, so the top does not leave at all. */
            for (const extra of [76, 120, 151]) {
                const short = await fresh();
                await short.evaluate(extra => {
                    docScroll.height = document.getElementById('editor-container').getBoundingClientRect().height + extra;
                    docScroll.resize();
                }, extra);
                assert.equal(await short.evaluate(() => docScroll.max), extra);
                await scroll(short, extra);
                await press(short, 'PageUp');
                await press(short, 'PageDown');
                await wheel(short, 100);
                await frames(short, 10);
                assert.deepEqual(await top(short), SHOWN, 'longer by ' + extra);
                assert.deepEqual(await switches(short), [], 'longer by ' + extra);
                await short.close();
            }
            await page.close();
        });

        await check('window resize at the end keeps the top hidden', async () => {
            const page = await fresh();
            const max = await page.evaluate(() => docScroll.max);
            await scroll(page, max - 300, max - 150, max);
            assert.deepEqual(await top(page), GONE);
            for (const height of [600, 820, 720]) {
                await page.setViewportSize({width: 1280, height});
                await frames(page, 8);
                const s = await page.evaluate(() => ({pos: docScroll.pos, max: docScroll.max}));
                assert.ok(s.pos > 0 && s.pos <= s.max, 'near the end, ' + height);
                assert.deepEqual(await top(page), GONE, 'window ' + height);
            }
            /* A zoom change moves the document as well. */
            await page.evaluate(() => {
                docScroll.height -= 400;
                docScroll.resize();
                ctx.fire('asc_onZoomChange', 80);
            });
            await frames(page, 8);
            assert.deepEqual(await top(page), GONE, 'zoom');
            assert.deepEqual(await switches(page), ['hide:scroll']);
            await page.close();
        });

        await check('advanced interface ignores scrolling', async () => {
            const page = await fresh();
            await page.evaluate(() => shell.toggleMode());
            await frames(page);
            await scroll(page, 400, 800, 1200);
            assert.equal(await page.evaluate(() => shell.topHidden()), false);
            assert.equal(await page.evaluate(() => document.body.classList.contains('vo-top-hidden')), false);
            assert.deepEqual(await switches(page), []);
            /* Back in the compact interface scrolling works again. */
            await page.evaluate(() => shell.toggleMode());
            await frames(page);
            await scroll(page, 1300, 1400);
            assert.deepEqual(await top(page), GONE);
            await page.close();
        });
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
