/* Run: node test/unit-tests/common/compact/menu-bar.cjs [path to MenuBar.js]
 * Shared compact menu bar over an editor adapter: roles and states of rows, submenus on hover,
 * disabled rows and their reasons, the lock read again before a command, shortcuts, closing,
 * own rows of the editor. Runs for every editor of lib/editors.cjs with an adapter over the rows its
 * module names (roles), in headless
 * Chrome through Playwright (NODE_PATH or PLAYWRIGHT_MODULE). The optional argument points to
 * a broken copy of the module for a negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {MODEL, BAR, launch, openMenu, settle, readBar, rowInfo, editorsWithAdapter, checker, patch} = require('./lib/menu-bar-page.cjs');

const FILE = process.argv[2] ? path.resolve(process.argv[2]) : BAR;
const HOVER = 150;

(async () => {
    const {check, skip, done} = checker();

    await check('module loads without editor namespaces', () => {
        const context = {navigator: {platform: 'Linux'}};
        context.window = context;
        context.define = (deps, factory) => factory.apply(null, deps.map(d => {
            const shared = context.Common && context.Common.UI && context.Common.UI.Compact;
            return shared && shared[d.split('/').pop()];
        }));
        vm.createContext(context);
        vm.runInContext(fs.readFileSync(MODEL, 'utf8'), context, {filename: MODEL});
        /* A locale applied before the module keeps its strings. */
        context.Common.UI.Compact.MenuBar = {textReasonOffline: 'Offline (locale)'};
        vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, {filename: FILE});
        for (const name of ['DE', 'SSE', '$', 'jQuery', '_'])
            assert.equal(context[name], undefined, name + ' appeared while loading the shared menu bar');
        const bar = context.Common.UI.Compact.MenuBar;
        assert.equal(typeof bar.create, 'function');
        assert.equal(bar.textReasonOffline, 'Offline (locale)');
        assert.equal(bar.textReasonProtected, 'The document is protected');
        assert.equal(bar.txtMenuBar_ARIA, 'Main menu');
    });

    await check('the shared layer knows only four reason codes', () => {
        const context = {navigator: {platform: 'Linux'}};
        context.window = context;
        context.define = (deps, factory) => factory.apply(null, deps.map(d => {
            const shared = context.Common && context.Common.UI && context.Common.UI.Compact;
            return shared && shared[d.split('/').pop()];
        }));
        vm.createContext(context);
        vm.runInContext(fs.readFileSync(MODEL, 'utf8'), context, {filename: MODEL});
        vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, {filename: FILE});
        const {MenuModel, MenuBar} = context.Common.UI.Compact;
        assert.deepEqual(Array.from(MenuModel.COMMON_REASONS), ['limit', 'offline', 'view', 'protected']);
        assert.deepEqual(Object.keys(MenuBar).filter(key => /^textReason/.test(key)).sort(),
            ['textReasonLimit', 'textReasonOffline', 'textReasonProtected', 'textReasonView']);
        /* Texts of the common codes come from the menu bar, any other code is the adapter's. */
        const adapter = {reasonText: code => (code === 'mine' ? 'Mine' : 'Adapter ' + code)};
        assert.equal(MenuBar.reasonText(adapter, 'view'), 'The document is open for viewing');
        assert.equal(MenuBar.reasonText(adapter, 'mine'), 'Mine');
        assert.equal(MenuBar.reasonText(adapter, 'final'), 'Adapter final');
        assert.equal(MenuBar.reasonText({}, 'final'), null);
        assert.equal(MenuBar.reasonText(adapter, null), null);
    });

    const browser = await launch();
    try {
        for (const editor of editorsWithAdapter()) {
            const name = text => `${text} (${editor.name})`;
            const open = (options = {}) => openMenu(browser, editor, Object.assign({bar: FILE}, options));
            const R = require(editor.adapter).roles;
            const runs = page => page.evaluate(() => ctx.log.filter(e => e.k).map(e => e.k));

            await check(name('menu bar has the menubar role and label'), async () => {
                const page = await open();
                const bar = await page.evaluate(() => ({
                    role: menu.el.getAttribute('role'),
                    label: menu.el.getAttribute('aria-label'),
                    tops: Array.from(menu.el.querySelectorAll('.vo-mn-item')).filter(b => b.getClientRects().length)
                        .map(b => [b.getAttribute('role'), b.getAttribute('aria-haspopup'), b.getAttribute('aria-expanded'),
                            b.getAttribute('tabindex')]),
                    lists: Array.from(menu.el.querySelectorAll('.vo-mn-drop')).map(d => d.getAttribute('role'))
                }));
                assert.equal(bar.role, 'menubar');
                assert.equal(bar.label, 'Main menu');
                assert.ok(bar.tops.length >= 2);
                bar.tops.forEach(([role, popup, expanded]) => {
                    assert.equal(role, 'menuitem');
                    assert.equal(popup, 'menu');
                    assert.equal(expanded, 'false');
                });
                assert.deepEqual(bar.tops.map(t => t[3]).filter(t => t === '0'), ['0'], 'one Tab stop');
                assert.ok(bar.lists.every(r => r === 'menu'));
                await page.evaluate(() => { Common.UI.Compact.MenuBar.txtMenuBar_ARIA = 'Главное меню'; });
                const other = await page.evaluate(() => Common.UI.Compact.MenuBar.create(adapter, {}).el.getAttribute('aria-label'));
                assert.equal(other, 'Главное меню');
                assert.deepEqual(page.errors, []);
                await page.close();
            });

            await check(name('submenu opens on hover after the delay'), async () => {
                const page = await open();
                const sub = R.submenu;
                await page.click(`[data-k="${sub.section}"]`);
                await page.hover(`[data-k="${sub.row}"]`);
                const early = await page.evaluate(() => menu.el.querySelectorAll('.vo-mn-fly').length);
                assert.equal(early, 0, 'no submenu before the delay');
                await page.waitForTimeout(HOVER + 100);
                const state = await readBar(page);
                const fly = state.open.find(d => d.level === '1');
                assert.ok(fly, 'submenu is open');
                assert.deepEqual(fly.rows, sub.rows);
                assert.equal((await rowInfo(page, sub.row)).attrs['aria-expanded'], 'true');
                await page.hover(`[data-k="${sub.plain}"]`);
                await page.waitForTimeout(HOVER + 100);
                assert.equal(await page.evaluate(() => menu.el.querySelectorAll('.vo-mn-fly').length), 0,
                    'hovering a plain row closes the submenu');
                await page.close();
            });

            await check(name('check and radio rows expose their state'), async () => {
                const c = R.check;
                const page = await open({context: Object.assign({}, c.on, R.radio ? R.radio.context : {})});
                await page.click(`[data-k="${c.section}"]`);
                const on = await rowInfo(page, c.row);
                assert.equal(on.attrs.role, 'menuitemcheckbox');
                assert.equal(on.attrs['aria-checked'], 'true');
                assert.equal(on.check, true);
                await page.evaluate(() => menu.close());
                await patch(page, c.off);
                await page.evaluate(k => menu.open(k), c.section);
                const off = await rowInfo(page, c.row);
                assert.equal(off.attrs['aria-checked'], 'false');
                assert.equal(off.check, false);
                if (!R.radio) {
                    skip(name('radio rows and group header'), 'the editor has no choice rows yet');
                    await page.close();
                    return;
                }
                await page.evaluate(k => menu.open(k), R.radio.section);
                /* Choice rows of a submenu are drawn when the submenu opens. */
                if (R.radio.submenu)
                    await page.evaluate(k => menu.el.querySelector(`[data-k="${k}"]`).click(), R.radio.submenu);
                const [a, b] = [await rowInfo(page, R.radio.rows[0]), await rowInfo(page, R.radio.rows[1])];
                assert.equal(a.attrs.role, 'menuitemradio');
                assert.equal(b.attrs.role, 'menuitemradio');
                assert.equal(a.attrs['aria-checked'], R.radio.checked === R.radio.rows[0] ? 'true' : 'false');
                assert.equal(b.attrs['aria-checked'], R.radio.checked === R.radio.rows[1] ? 'true' : 'false');
                assert.equal((await rowInfo(page, R.radio.checked)).check, true);
                if (!R.radio.header) {
                    skip(name('group header'), 'the choice rows of the editor have no header');
                    await page.close();
                    return;
                }
                const header = await page.evaluate(k => {
                    const h = menu.el.querySelector(`[data-k="${k}"]`);
                    const t = h && h.querySelector('.vo-mn-grp-t');
                    return h && {tag: h.tagName, role: h.getAttribute('role'), label: h.getAttribute('aria-label'),
                        title: t && t.textContent};
                }, R.radio.header.k);
                assert.deepEqual(header, {tag: 'DIV', role: 'group', label: R.radio.header.text, title: R.radio.header.text});
                await page.close();
            });

            await check(name('disabled row shows its reason and ignores click and enter'), async () => {
                const L = R.locked;
                const page = await open({context: L.context});
                await page.click(`[data-k="${L.section}"]`);
                const row = await rowInfo(page, L.row);
                assert.equal(row.locked, true);
                assert.equal(row.attrs['aria-disabled'], 'true');
                assert.equal(row.attrs.title, L.title);
                assert.equal(row.attrs['aria-description'], L.title);
                assert.equal(row.attrs.disabled, undefined, 'a class, not the disabled attribute');
                await page.click(`[data-k="${L.row}"]`, {force: true});
                await page.focus(`[data-k="${L.row}"]`);
                await page.keyboard.press('Enter');
                const state = await readBar(page);
                assert.equal(state.isOpen, true, 'menu stays open');
                assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.k)), []);
                await page.close();
            });

            await check(name('item greyed after the menu opened is not run'), async () => {
                const G = R.greyLater, S = R.subLock;
                const page = await open({context: G.context || {}});
                await page.click(`[data-k="${G.section}"]`);
                assert.equal((await rowInfo(page, G.row)).locked, false);
                await patch(page, G.lock);
                await page.click(`[data-k="${G.row}"]`);
                assert.deepEqual(await runs(page), []);
                const row = await rowInfo(page, G.row);
                assert.equal(row.locked, true, 'the row shows the lock it met');
                assert.equal(row.attrs.title, G.title);
                assert.equal((await readBar(page)).isOpen, true);
                /* An item of a submenu whose parent went grey meanwhile is not run either. */
                await page.evaluate(() => menu.close());
                await page.evaluate(() => { ctx.reasons = []; });
                await patch(page, S.before);
                await page.evaluate(k => menu.open(k), S.section);
                await page.hover(`[data-k="${S.row}"]`);
                await page.waitForTimeout(HOVER + 100);
                await patch(page, S.after);
                await page.click(`[data-k="${S.item}"]`);
                assert.deepEqual(await runs(page), []);
                const parent = await rowInfo(page, S.row);
                assert.equal(parent.locked, true);
                assert.equal(parent.attrs['aria-expanded'], 'false');
                await page.close();
            });

            await check(name('common reason uses the shared text and item reason the adapter text'), async () => {
                const {net, edit, own} = R.reasons;
                /* The common reason the editor names on these rows: a lost connection unless the
                   editor says another one. */
                const common = R.reasons.common || {reasons: ['offline'], key: 'textReasonOffline', title: 'No connection'};
                const page = await open({context: Object.assign({}, R.reasons.context, {reasons: common.reasons})});
                await page.click(`[data-k="${net.section}"]`);
                assert.equal((await rowInfo(page, net.row)).attrs.title, common.title);
                await page.evaluate(({k, key}) => { Common.UI.Compact.MenuBar[key] = 'Текст локали'; menu.close(); menu.open(k); },
                    {k: net.section, key: common.key});
                assert.equal((await rowInfo(page, net.row)).attrs.title, 'Текст локали');
                await page.evaluate(k => { menu.open(k); }, edit.section);
                assert.equal((await rowInfo(page, edit.row)).attrs.title, 'Текст локали', 'common reason outranks the item one');
                await page.evaluate(k => { ctx.reasons = ['protected']; menu.open(k); }, edit.section);
                assert.equal((await rowInfo(page, edit.row)).attrs.title, 'The document is protected');
                await page.evaluate(k => { ctx.reasons = []; menu.open(k); }, edit.section);
                if (own) assert.equal((await rowInfo(page, edit.row)).attrs.title, own);
                else assert.equal((await rowInfo(page, edit.row)).locked, false, 'no common reason, no item reason: enabled');
                const texts = await page.evaluate(() => Common.UI.Compact.MenuModel.COMMON_REASONS.map(code => {
                    const key = 'textReason' + code[0].toUpperCase() + code.slice(1);
                    return [code, typeof Common.UI.Compact.MenuBar[key], adapter.reasonText(code)];
                }));
                texts.forEach(([code, type, own]) => {
                    assert.equal(type, 'string', 'shared text for ' + code);
                    assert.equal(own, null, 'the editor has no own text for ' + code);
                });
                await page.close();
            });

            if (!R.ownReason) {
                skip(name('text of an adapter code comes from the adapter'), 'the editor declares no code of its own yet');
            } else {
                await check(name('text of an adapter code comes from the adapter'), async () => {
                    const O = R.ownReason;
                    const page = await open({context: O.context});
                    await page.evaluate(k => menu.open(k), O.section);
                    const row = await rowInfo(page, O.row);
                    assert.equal(row.locked, true);
                    assert.equal(row.attrs.title, O.title, 'the code the adapter ranks first, in its text');
                    assert.equal(row.attrs['aria-description'], O.title);
                    const own = await page.evaluate(O => {
                        const key = 'textReason' + O.code[0].toUpperCase() + O.code.slice(1);
                        const order = typeof adapter.reasons === 'function' ? adapter.reasons() : adapter.reasons;
                        return {shared: typeof Common.UI.Compact.MenuBar[key], declared: Array.from(order || []).includes(O.code),
                            text: adapter.reasonText(O.code)};
                    }, O);
                    assert.deepEqual(own, {shared: 'undefined', declared: true, text: O.title});
                    /* The adapter text is read when the row is drawn. */
                    await page.evaluate(O => {
                        const before = adapter.reasonText;
                        adapter.reasonText = code => (code === O.code ? 'Changed' : before(code));
                        menu.close();
                        menu.open(O.section);
                    }, O);
                    assert.equal((await rowInfo(page, O.row)).attrs.title, 'Changed');
                    assert.deepEqual(page.errors, []);
                    await page.close();
                });
            }

            await check(name('shortcut is shown at the right with the command key on Mac'), async () => {
                const sc = R.shortcut;
                const hint = async mac => {
                    const page = await open({options: {mac}});
                    await page.click(`[data-k="${sc.section}"]`);
                    const out = await page.evaluate(sc => {
                        const row = menu.el.querySelector(`[data-k="${sc.row}"]`);
                        const h = row.querySelector('.vo-mn-h'), t = row.querySelector('.vo-mn-t');
                        const plain = menu.el.querySelector(`[data-k="${sc.plain}"]`);
                        return {text: h && h.textContent, after: !!h && h.getBoundingClientRect().left >= t.getBoundingClientRect().right,
                            last: !!h && !h.nextElementSibling, none: !plain.querySelector('.vo-mn-h')};
                    }, sc);
                    await page.close();
                    return out;
                };
                const mac = await hint(true), other = await hint(false);
                assert.equal(mac.text, sc.mac);
                assert.equal(other.text, sc.text);
                for (const h of [mac, other]) {
                    assert.ok(h.after && h.last, 'the shortcut stands at the right of the label');
                    assert.ok(h.none, 'no shortcut, no hint');
                }
            });

            await check(name('choosing an action closes the menu'), async () => {
                const page = await open();
                const first = R.first, sub = R.submenu;
                await page.click(`[data-k="${first.k}"]`);
                await page.click(`[data-k="${first.firstItem}"]`);
                const state = await readBar(page);
                assert.equal(state.isOpen, false);
                assert.deepEqual(state.open, []);
                const log = await page.evaluate(() => ctx.log);
                assert.deepEqual(log.filter(e => e.k).map(e => e.k), [first.firstItem]);
                assert.ok(log.some(e => e.keys === 'beforeCommand'), 'keys go back to the document before the command');
                await page.click(`[data-k="${sub.section}"]`);
                await page.hover(`[data-k="${sub.row}"]`);
                await page.waitForTimeout(HOVER + 100);
                await page.click(`[data-k="${sub.rows[0]}"]`);
                assert.equal((await readBar(page)).isOpen, false);
                assert.deepEqual(await runs(page), [first.firstItem, sub.rows[0]]);
                await page.close();
            });

            await check(name('click outside closes the menu'), async () => {
                const page = await open();
                const sub = R.submenu;
                await page.click(`[data-k="${sub.section}"]`);
                await page.hover(`[data-k="${sub.row}"]`);
                await page.waitForTimeout(HOVER + 100);
                assert.equal((await readBar(page)).open.length, 2);
                await page.click(`[data-k="${sub.row}"]`);
                assert.equal((await readBar(page)).isOpen, true, 'a click inside keeps it open');
                await page.mouse.click(600, 500);
                const state = await readBar(page);
                assert.equal(state.isOpen, false);
                assert.deepEqual(state.open, []);
                await page.close();
            });

            await check(name('own row is handed to the adapter'), async () => {
                const W = R.widget, sub = R.submenu;
                const page = await open({context: W ? W.context : {}});
                if (W) {
                    await page.click(`[data-k="${W.section}"]`);
                    const own = await page.evaluate(k => {
                        const row = menu.el.querySelector(`[data-k="${k}"]`);
                        return {role: row.getAttribute('role'), label: row.getAttribute('aria-label'),
                            value: row.querySelector('.fixture-value') && row.querySelector('.fixture-value').textContent,
                            calls: ctx.log.filter(e => e.openRow)};
                    }, W.row);
                    assert.equal(own.role, 'group');
                    assert.equal(own.label, W.label);
                    assert.equal(own.value, W.value);
                    assert.deepEqual(own.calls, [{openRow: W.row, level: 0, row: W.row}]);
                } else {
                    skip(name('own widget row drawn by the adapter'), 'the editor has no widget rows yet');
                }
                /* A submenu the editor shows on its own surface: no list of the menu bar. */
                const claimed = await page.evaluate(sub => {
                    const seen = [];
                    adapter.openRow = (row, it, level) => { seen.push(['open', it.k, level]); return it.k === sub.row; };
                    adapter.closeRow = (row, it) => { seen.push(['close', it.k]); };
                    menu.open(sub.section);
                    menu.el.querySelector(`[data-k="${sub.row}"]`).click();
                    const expanded = menu.el.querySelector(`[data-k="${sub.row}"]`).getAttribute('aria-expanded');
                    const lists = menu.el.querySelectorAll('.vo-mn-fly').length;
                    menu.close();
                    return {seen, expanded, lists};
                }, sub);
                assert.deepEqual(claimed, {seen: [['open', sub.row, 0], ['close', sub.row]], expanded: 'true', lists: 0});
                await page.close();
            });

            /* Groups, hints and descriptions. */
            const G = R.group, H = R.hint, D = R.desc;
            /* Opens a section and its submenus down the path by clicks. */
            const openPath = async (page, path) => {
                await page.evaluate(k => menu.open(k), path[0]);
                for (const k of path.slice(1)) await page.click(`[data-k="${k}"]`);
            };
            const groupChecks = ['a group is announced with its title and holds its options',
                'the visible group title is hidden from the screen reader', 'arrows walk through options across groups',
                'refresh keeps the focused option inside a group'];
            if (!G) {
                groupChecks.forEach(text => skip(name(text), 'the editor names no titled group yet'));
            } else {
                const group = page => page.evaluate(G => {
                    const box = menu.el.querySelector(`.vo-mn-drop.open [data-k="${G.k}"]`);
                    if (!box) return null;
                    const title = box.querySelector(':scope > .vo-mn-grp-t');
                    return {tag: box.tagName, role: box.getAttribute('role'), label: box.getAttribute('aria-label'),
                        options: Array.from(box.querySelectorAll('.vo-mn-sub')).map(r => r.getAttribute('data-k')),
                        title: title && {text: title.textContent, hidden: title.getAttribute('aria-hidden'),
                            shown: title.getClientRects().length > 0, first: box.firstElementChild === title}};
                }, G);

                await check(name(groupChecks[0]), async () => {
                    const page = await open({context: G.context});
                    await page.evaluate(k => menu.open(k), G.section);
                    const got = await group(page);
                    assert.deepEqual([got.tag, got.role, got.label], ['DIV', 'group', G.title]);
                    assert.deepEqual(got.options, G.options, 'the options of the group are inside it');
                    assert.deepEqual((await readBar(page)).open[0].rows, G.walk, 'rows in and out of the group keep their order');
                    await page.close();
                });

                await check(name(groupChecks[1]), async () => {
                    const page = await open({context: G.context});
                    await page.evaluate(k => menu.open(k), G.section);
                    const {title} = await group(page);
                    assert.deepEqual(title, {text: G.title, hidden: 'true', shown: true, first: true});
                    const name = await page.evaluate(k => menu.el.querySelector(`[data-k="${k}"]`).getAttribute('aria-label'), G.k);
                    assert.equal(name, G.title, 'the group itself carries the title for the screen reader');
                    await page.close();
                });

                await check(name(groupChecks[2]), async () => {
                    const page = await open({context: G.context});
                    await page.evaluate(k => menu.open(k), G.section);
                    await page.focus(`[data-k="${G.walk[0]}"]`);
                    const seen = [];
                    for (let i = 0; i < G.walk.length; i++) {
                        await page.keyboard.press('ArrowDown');
                        seen.push((await readBar(page)).active);
                    }
                    assert.deepEqual(seen, G.walk.slice(1).concat(G.walk[0]), 'down goes into the group and out of it');
                    for (let i = 0; i < G.walk.length; i++) {
                        await page.keyboard.press('ArrowUp');
                        seen.push((await readBar(page)).active);
                    }
                    assert.deepEqual(seen.slice(G.walk.length), G.walk.slice().reverse(), 'up as well');
                    await page.close();
                });

                await check(name(groupChecks[3]), async () => {
                    const page = await open({context: G.context});
                    await page.evaluate(k => menu.open(k), G.section);
                    await page.focus(`[data-k="${G.focus}"]`);
                    await page.evaluate(k => { window.kept = menu.el.querySelector(`[data-k="${k}"]`); }, G.focus);
                    await patch(page, G.change);
                    await page.evaluate(() => menu.refresh());
                    await settle(page);
                    const got = await page.evaluate(G => {
                        const active = document.activeElement;
                        return {same: active === window.kept, k: active.getAttribute('data-k'),
                            inGroup: !!active.closest(`[data-k="${G.k}"]`)};
                    }, G);
                    assert.deepEqual(got, {same: true, k: G.focus, inGroup: true});
                    assert.equal((await rowInfo(page, G.checked)).attrs['aria-checked'], 'true', 'the change is drawn');
                    assert.deepEqual((await group(page)).options, G.options);
                    await page.close();
                });
            }

            if (!H) {
                skip(name('a hint replaces the shortcut on the right'), 'the editor gives no hints yet');
            } else {
                await check(name('a hint replaces the shortcut on the right'), async () => {
                    const page = await open();
                    const right = k => page.evaluate(k => {
                        const row = menu.el.querySelector(`[data-k="${k}"]`);
                        const h = row.querySelectorAll('.vo-mn-h'), t = row.querySelector('.vo-mn-t');
                        return {texts: Array.from(h).map(x => x.textContent),
                            after: h.length === 1 && h[0].getBoundingClientRect().left >= t.getBoundingClientRect().right};
                    }, k);
                    await openPath(page, H.open);
                    assert.deepEqual(await right(H.row), {texts: [H.text], after: true});
                    assert.deepEqual((await right(H.none)).texts, [], 'no hint, no shortcut: nothing on the right');
                    /* The hint stands in place of a shortcut the command has. */
                    await page.evaluate(() => menu.close());
                    await page.evaluate(S => {
                        adapter.groups(S.section).filter(it => it.k === S.row)[0].hint = 'Soon';
                        menu.open(S.section);
                    }, H.shortcut);
                    assert.deepEqual(await right(H.shortcut.row), {texts: ['Soon'], after: true});
                    await page.close();
                });
            }

            if (!D) {
                skip(name('a description is a second line and describes the item'), 'the editor gives no descriptions yet');
            } else {
                await check(name('a description is a second line and describes the item'), async () => {
                    const page = await open();
                    await openPath(page, D.open);
                    const got = await page.evaluate(D => {
                        const row = menu.el.querySelector(`[data-k="${D.row}"]`);
                        const d = row.querySelector('.vo-mn-d'), t = row.querySelector('.vo-mn-t');
                        const ids = (row.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
                        const plain = menu.el.querySelector(`[data-k="${D.none}"]`);
                        return {label: t.textContent, text: d && d.textContent, hidden: d && d.getAttribute('aria-hidden'),
                            describedBy: ids.map(id => document.getElementById(id) === d),
                            below: !!d && d.getBoundingClientRect().top >= t.getBoundingClientRect().bottom - 0.5,
                            under: !!d && Math.abs(d.getBoundingClientRect().left - t.getBoundingClientRect().left) <= 0.5,
                            plain: {d: !!plain.querySelector('.vo-mn-d'), describedBy: plain.getAttribute('aria-describedby')}};
                    }, D);
                    assert.deepEqual(got, {label: D.label, text: D.text, hidden: 'true', describedBy: [true], below: true,
                        under: true, plain: {d: false, describedBy: null}});
                    await page.close();
                });
            }

            const DL = R.descLocked;
            if (!DL) {
                skip(name('a disabled item with a description is described by its reason and the description'),
                    'the editor has no disabled row with a description yet');
            } else {
                await check(name('a disabled item with a description is described by its reason and the description'), async () => {
                    const page = await open({context: DL.context});
                    await openPath(page, DL.open);
                    /* The description the screen reader gets, as the browser computes it. */
                    const cdp = await page.context().newCDPSession(page);
                    const described = async k => {
                        const {root} = await cdp.send('DOM.getDocument', {depth: 0});
                        const {nodeId} = await cdp.send('DOM.querySelector', {nodeId: root.nodeId,
                            selector: `[data-k="${k}"]:not(.vo-mn-more-row)`});
                        const {nodes} = await cdp.send('Accessibility.getPartialAXTree', {nodeId, fetchRelatives: false});
                        const node = nodes.find(n => !n.ignored) || nodes[0];
                        return {name: node.name && node.name.value, description: node.description ? node.description.value : ''};
                    };
                    const row = await rowInfo(page, DL.row);
                    assert.equal(row.locked, true);
                    assert.equal(row.attrs.title, DL.reason);
                    const locked = await described(DL.row);
                    assert.equal(locked.description, DL.reason + ' ' + DL.desc, 'the reason first, then the description');
                    assert.ok(!locked.name.includes(DL.reason), 'the reason is not part of the name: ' + locked.name);
                    const seen = await page.evaluate(k => {
                        const r = menu.el.querySelector(`[data-k="${k}"]`);
                        return {d: r.querySelector('.vo-mn-d').textContent,
                            shown: Array.from(r.querySelectorAll('span')).filter(x => x.getClientRects().length)
                                .map(x => x.textContent).filter(t => t === 'No connection').length};
                    }, DL.row);
                    assert.deepEqual(seen, {d: DL.desc, shown: 0}, 'the reason is not drawn in the row');
                    /* Enabled again: only the description is left. */
                    await patch(page, {reasons: []});
                    await page.evaluate(() => menu.refresh());
                    await settle(page);
                    assert.equal((await rowInfo(page, DL.row)).locked, false);
                    assert.equal((await described(DL.row)).description, DL.desc);
                    /* Locked again after the refresh: both again, the reason once. */
                    await patch(page, DL.context);
                    await page.evaluate(() => menu.refresh());
                    await settle(page);
                    assert.equal((await described(DL.row)).description, DL.reason + ' ' + DL.desc);
                    assert.deepEqual(page.errors, []);
                    await page.close();
                });
            }

            const C = R.computed;
            if (!C) {
                skip(name('submenu built by a function is drawn and follows refresh'), 'the editor computes no submenu yet');
            } else {
                await check(name('submenu built by a function is drawn and follows refresh'), async () => {
                    const page = await open();
                    await page.evaluate(k => menu.open(k), C.section);
                    await page.click(`[data-k="${C.row}"]`);
                    const fly = async () => ((await readBar(page)).open.find(d => d.level === '1') || {}).rows;
                    assert.deepEqual(await fly(), C.rows);
                    await patch(page, C.change);
                    await page.evaluate(() => menu.refresh());
                    await settle(page);
                    assert.deepEqual(await fly(), C.changed, 'refresh reads the function again');
                    assert.equal((await rowInfo(page, C.row)).attrs['aria-expanded'], 'true', 'the submenu stays open');
                    /* The next opening reads it again as well. */
                    await page.evaluate(() => menu.close());
                    await patch(page, C.back);
                    await page.evaluate(k => menu.open(k), C.section);
                    await page.click(`[data-k="${C.row}"]`);
                    assert.deepEqual(await fly(), C.rows);
                    assert.deepEqual(page.errors, []);
                    await page.close();
                });
            }

        }
    } finally {
        await browser.close();
    }
    done();
})().catch(error => { console.error('FAIL', error); process.exitCode = 1; });
