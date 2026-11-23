/* Run: node test/unit-tests/common/compact/menu-bar-viewport.cjs [path to MenuBar.js]
 * Root menu geometry in Chrome with the real compact styles of every editor.
 * PLAYWRIGHT_MODULE or NODE_PATH supplies Playwright; LESS_MODULE can supply less.
 * An optional module copy is a negative control. The adapter supplies mutable labels,
 * long scrollable lists and a submenu; editor commands are counted, not replaced in the module.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./lib/menu-bar-page.cjs');
const less = require(process.env.LESS_MODULE || path.join(H.ROOT, 'build/node_modules/less'));
const BAR = process.argv[2] ? path.resolve(process.argv[2]) : H.BAR;
const EDITORS = ['documenteditor', 'spreadsheeteditor', 'presentationeditor', 'pdfeditor'];

async function styles(editor) {
    const dir = path.join(H.ROOT, 'apps', editor, 'main/resources/less');
    const shared = path.join(H.ROOT, 'apps/common/main/resources/less/compact');
    const imports = ['tokens', 'menu'].map(name => `@import "${shared}/${name}.less";`);
    imports.push(`@import "${dir}/compact-shell.less";`);
    return (await less.render('@common-image-const-path: "/img/";\n' + imports.join('\n'),
        {filename: path.join(dir, 'app.less'), javascriptEnabled: true})).css;
}

async function settle(page) {
    await H.settle(page);
    await page.evaluate(() => Promise.all(menu.el.getAnimations({subtree: true})
        .map(a => a.finished.catch(() => {}))));
    await H.settle(page);
}

async function applicationScale(page, scale) {
    const source = fs.readFileSync(path.join(H.ROOT, 'apps/common/main/lib/util/utils.js'), 'utf8');
    const end = 'Common.Utils = _extend_object(Common.Utils, utils);';
    assert.ok(source.includes(end), 'the shared geometry utilities are present');
    await page.evaluate(scale => {
        Object.defineProperty(navigator, 'userAgent', {
            value: navigator.userAgent.replace('HeadlessChrome/', 'Chrome/'), configurable: true
        });
        window.$ = node => ({
            on(type, callback) { node.addEventListener(type, callback); },
            addClass() {}
        });
        // The SDK supplies the scale; the real shared utilities handle its geometry.
        window.AscCommon = {
            checkDeviceScale: () => ({correct: true, zoom: 1 / scale, devicePixelRatio: 1}),
            correctApplicationScale: () => { document.documentElement.style.zoom = scale; }
        };
    }, scale);
    await page.addScriptTag({content: fs.readFileSync(path.join(H.ROOT, 'vendor/underscore/underscore.js'), 'utf8')});
    await page.addScriptTag({content: source.slice(0, source.indexOf(end) + end.length) + '\n});'});
    await settle(page);
}

async function scaledInside(page, scale) {
    const result = await page.evaluate(scale => {
        const clip = document.getElementById('clip') || document.getElementById('host');
        const c = clip.getBoundingClientRect();
        return {left: Math.max(0, c.left + clip.clientLeft * scale),
            right: Math.min(window.innerWidth, c.left + (clip.clientLeft + clip.clientWidth) * scale),
            menus: Array.from(menu.el.querySelectorAll('.vo-mn-drop.open')).map(drop => {
                const r = drop.getBoundingClientRect();
                return {left: r.left, right: r.right, width: r.width};
            })};
    }, scale);
    assert.ok(result.menus.length, 'an open menu is measured');
    for (const drop of result.menus) {
        assert.ok(drop.left >= result.left - 1 && drop.right <= result.right + 1, JSON.stringify(result));
    }
}

async function open(browser, css, {width = 800, rtl = false, right = false, noObserver = false,
    reducedMotion = 'reduce', locale = 'ru', clipLeft = 0, clipWidth = width, barWidth,
    longSections = false} = {}) {
    const page = await browser.newPage({viewport: {width, height: 940}, reducedMotion});
    page.setDefaultTimeout(3000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(`<style>${css}</style><style>
        body {margin:0} #clip {position:absolute;top:100px;height:800px;overflow:hidden;box-sizing:border-box}
        #host {position:relative;top:30px} #host > .vo-mn {width:100%}
        #host .vo-mn-status:empty {display:none}
        .fixture-right .vo-mn-drop:not(.vo-mn-fly) {left:auto;right:0;transform-origin:100% 0}
        </style><body class="vo-compact${rtl ? ' rtl' : ''}">
        <input id="field" value="draft"><div id="clip"><div id="host" class="${right ? 'fixture-right' : ''}"></div></div>`);
    await page.evaluate(({clipLeft, clipWidth, barWidth, rtl, noObserver}) => {
        const clip = document.getElementById('clip'), host = document.getElementById('host');
        clip.style.left = clipLeft + 'px';
        clip.style.width = clipWidth + 'px';
        host.style.width = barWidth ? barWidth + 'px' : '100%';
        if (rtl) host.style.direction = 'rtl';
        if (noObserver) window.ResizeObserver = undefined;
        window.define = (deps, factory) => factory.apply(null, deps.map(d =>
            window.Common && Common.UI.Compact[d.split('/').pop()]));
    }, {clipLeft, clipWidth, barWidth, rtl, noObserver});
    await page.addScriptTag({content: fs.readFileSync(H.MODEL, 'utf8')});
    await page.addScriptTag({content: fs.readFileSync(BAR, 'utf8')});
    await page.evaluate(({locale, right, longSections}) => {
        const Model = Common.UI.Compact.MenuModel;
        const labels = locale === 'ru' ?
            ['Файл', 'Правка', 'Вид', 'Вставка', 'Формат', 'Совместная работа', 'Справка'] :
            ['File', 'Edit', 'View', 'Insert', 'Format', 'Collaboration', 'Help'];
        window.state = {caption: locale === 'ru' ? 'О редакторе' : 'About this editor', calls: [],
            sections: labels.map((t, i) => ({k: i === 6 ? 'help' : 's' + i, t})), list: []};
        state.sections.forEach(s => {
            if (longSections && s.k !== 'help') s.t = 'Long section title ' + s.k;
            s.items = Array.from({length: 28}, (_, i) => ({k: s.k + '.' + i,
                t: i === 0 ? () => state.caption : 'Command ' + i, kind: 'action',
                hint: i === 0 ? 'Ctrl+Shift+P' : null,
                run: () => state.calls.push(s.k + '.' + i)}));
            s.items.splice(1, 0, {k: s.k + '.sub', t: 'Submenu', kind: 'submenu', items: [
                {k: s.k + '.child', t: 'Nested command', kind: 'action', run: () => state.calls.push('child')}
            ]});
        });
        if (right) state.sections = [state.sections[6]];
        const adapter = {
            sections: () => state.sections,
            groups: key => state.sections.find(s => s.k === key).items,
            context: () => state,
            itemState: it => Model.state(it, state, []),
            exec: it => it.run && it.run(),
            keys: {hold() {}, release() {}, beforeCommand() {}}
        };
        window.menu = Common.UI.Compact.MenuBar.create(adapter, {pinned: 'help'});
        document.getElementById('host').appendChild(menu.el);
    }, {locale, right, longSections});
    await settle(page);
    page.errors = errors;
    return page;
}

async function bounds(page) {
    return page.evaluate(() => {
        const el = menu.el.querySelector('.vo-mn-drop.open:not(.vo-mn-fly)');
        if (!el) return null;
        const r = el.getBoundingClientRect(), c = document.getElementById('clip');
        const cr = c.getBoundingClientRect();
        return {left: r.left, right: r.right, width: r.width,
            L: Math.max(0, cr.left + c.clientLeft),
            R: Math.min(document.documentElement.clientWidth, cr.left + c.clientLeft + c.clientWidth)};
    });
}

async function inside(page) {
    await settle(page);
    const r = await bounds(page);
    assert.ok(r, 'root menu is open');
    assert.ok(r.left >= r.L + 3 && r.right <= r.R - 3, JSON.stringify(r));
    assert.deepEqual(page.errors, []);
    return r;
}

async function show(page, key = 'help') {
    await page.evaluate(key => menu.open(key), key);
    return inside(page);
}

(async () => {
    const suite = H.checker(), done = suite.done;
    const check = (name, fn) => !process.env.COMPACT_MENU_TEST || name.includes(process.env.COMPACT_MENU_TEST) ?
        suite.check(name, fn) : Promise.resolve();
    const browser = await H.launch();
    try {
        for (const editor of EDITORS) {
            const css = await styles(editor);
            for (const scale of [1.25, 0.8]) {
                for (const rtl of [false, true]) {
                    await check(`${editor}: application scale ${scale}, ${rtl ? 'RTL' : 'LTR'}`, async () => {
                        const page = await open(browser, css, {width: Math.round(640 * scale), clipWidth: 640, rtl});
                        try {
                            await applicationScale(page, scale);
                            await page.evaluate(() => {
                                document.getElementById('clip').style.border = '7px solid black';
                                state.caption = 'The command with a moderately long translated title 1234567890123456789012345';
                                menu.refresh(); menu.open('help');
                            });
                            await settle(page);
                            await scaledInside(page, scale);
                            await page.evaluate(() => { state.caption = 'Unbroken'.repeat(70); menu.refresh(); });
                            await settle(page);
                            await scaledInside(page, scale);
                            await page.evaluate(() => { state.caption = 'About'; menu.refresh(); });
                            await settle(page);
                            await scaledInside(page, scale);
                            await page.locator('[data-k="help.sub"]').focus();
                            await page.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight');
                            await settle(page);
                            await scaledInside(page, scale);
                            const target = await page.locator('[data-k="help.child"]').evaluate(row => {
                                const r = row.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
                                return {x, y, hit: row.contains(document.elementFromPoint(x, y))};
                            });
                            assert.ok(target.hit, JSON.stringify(target));
                            await page.mouse.click(target.x, target.y);
                            assert.deepEqual(await page.evaluate(() => state.calls), ['child']);
                            assert.deepEqual(page.errors, []);
                        } finally { await page.close(); }
                    });
                }
            }
            for (const locale of ['ru', 'en']) {
                await check(`${editor}/${locale}: right edge and command hit`, async () => {
                    const page = await open(browser, css, {locale, width: 800});
                    try {
                        await show(page);
                        await page.locator('[data-k="help.0"]').click();
                        assert.deepEqual(await page.evaluate(() => state.calls), ['help.0']);
                        assert.equal(await page.evaluate(() => menu.isOpen()), false);
                    } finally { await page.close(); }
                });
            }
            for (const rtl of [false, true]) {
                await check(`${editor}: ${rtl ? 'RTL' : 'LTR'} roots on both edges`, async () => {
                    const page = await open(browser, css, {width: 640, rtl});
                    try { await show(page, 's0'); await show(page); }
                    finally { await page.close(); }
                });
            }
            await check(`${editor}: clipping parent with border and scrollbar`, async () => {
                const page = await open(browser, css, {width: 1280, clipLeft: 145, clipWidth: 640});
                try {
                    await page.evaluate(() => {
                        const clip = document.getElementById('clip');
                        clip.style.border = '7px solid black';
                        clip.style.overflowY = 'scroll';
                    });
                    await show(page);
                } finally { await page.close(); }
            });
            await check(`${editor}: oversized word wraps and natural size returns`, async () => {
                const page = await open(browser, css, {width: 640});
                try {
                    await show(page);
                    await page.evaluate(() => { state.caption = 'Unbroken'.repeat(70); menu.refresh(); });
                    await inside(page);
                    const text = await page.locator('[data-k="help.0"] .vo-mn-t').evaluate(el =>
                        ({height: el.clientHeight, width: el.clientWidth, scroll: el.scrollWidth,
                            line: parseFloat(getComputedStyle(el).lineHeight) ||
                                parseFloat(getComputedStyle(el).fontSize) * 1.2}));
                    assert.ok(text.scroll <= text.width + 1, JSON.stringify(text));
                    assert.ok(text.height > text.line * 2, JSON.stringify(text));
                    await page.evaluate(() => { state.caption = 'About'; menu.refresh(); });
                    const narrow = await inside(page);
                    assert.ok(narrow.width < 500, JSON.stringify(narrow));
                    await page.locator('[data-k="help.27"]').click();
                    assert.deepEqual(await page.evaluate(() => state.calls), ['help.27']);
                } finally { await page.close(); }
            });
            for (const trigger of ['refresh', 'resize']) {
                await check(`${editor}: focused row stays visible after wrapping on ${trigger}`, async () => {
                    const page = await open(browser, css, {width: trigger === 'resize' ? 1280 : 640});
                    try {
                        await page.evaluate(trigger => {
                            const clip = document.getElementById('clip');
                            clip.style.top = '0'; clip.style.height = '940px';
                            document.getElementById('host').style.top = '0';
                            if (trigger === 'resize') state.caption = 'Unbroken'.repeat(200);
                        }, trigger);
                        await show(page);
                        await page.locator('[data-k="help.27"]').focus();
                        const read = () => page.evaluate(() => {
                            const row = document.activeElement, drop = row.closest('.vo-mn-drop');
                            const r = row.getBoundingClientRect(), d = drop.getBoundingClientRect();
                            return {key: row.getAttribute('data-k'), top: r.top, bottom: r.bottom,
                                start: d.top + drop.clientTop, end: d.top + drop.clientTop + drop.clientHeight,
                                ancestorX: document.getElementById('clip').scrollLeft,
                                ancestorY: document.getElementById('clip').scrollTop};
                        });
                        const before = await read();
                        assert.ok(before.top >= before.start - 1 && before.bottom <= before.end + 1,
                            'the focused row is initially visible: ' + JSON.stringify(before));
                        if (trigger === 'refresh') {
                            await page.evaluate(() => { state.caption = 'Unbroken'.repeat(200); menu.refresh(); });
                        } else await page.setViewportSize({width: 640, height: 940});
                        await inside(page);
                        const after = await read();
                        assert.equal(after.key, 'help.27');
                        assert.ok(after.top >= after.start - 1 && after.bottom <= after.end + 1,
                            'wrapping keeps the focused row visible: ' + JSON.stringify(after));
                        assert.equal(after.ancestorX, before.ancestorX, 'only the menu scrolls horizontally');
                        assert.equal(after.ancestorY, before.ancestorY, 'only the menu scrolls vertically');
                    } finally { await page.close(); }
                });
            }
            for (const change of ['disabled', 'checked']) {
                await check(`${editor}: state-only ${change} refresh preserves manual scrolling`, async () => {
                    const page = await open(browser, css, {width: 640});
                    try {
                        await page.evaluate(change => {
                            const clip = document.getElementById('clip');
                            clip.style.top = '0'; clip.style.height = '940px';
                            document.getElementById('host').style.top = '0';
                            const item = state.sections.find(s => s.k === 'help').items.find(it => it.k === 'help.1');
                            state.locked = false;
                            if (change === 'checked') { item.kind = 'check'; item.checked = () => state.locked; }
                            else item.disabled = () => state.locked;
                        }, change);
                        await show(page);
                        await page.locator('[data-k="help.0"]').focus();
                        const box = await page.locator('.vo-mn-drop.open').boundingBox();
                        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                        await page.mouse.wheel(0, 180);
                        await page.waitForFunction(() => menu.el.querySelector('.vo-mn-drop.open').scrollTop > 100);
                        const read = () => page.evaluate(() => {
                            const drop = menu.el.querySelector('.vo-mn-drop.open');
                            return {scroll: drop.scrollTop, width: drop.offsetWidth, height: drop.clientHeight,
                                total: drop.scrollHeight, key: document.activeElement.getAttribute('data-k')};
                        });
                        const before = await read();
                        await page.evaluate(() => { state.locked = true; menu.refresh(); });
                        await settle(page);
                        assert.deepEqual(await read(), before, 'a state-only refresh keeps the viewport chosen by wheel');
                        const attribute = change === 'checked' ? 'aria-checked' : 'aria-disabled';
                        assert.equal(await page.locator('[data-k="help.1"]').getAttribute(attribute), 'true');
                    } finally { await page.close(); }
                });
            }
            await check(`${editor}: consumer right alignment survives resize`, async () => {
                const page = await open(browser, css, {width: 800, right: true});
                try {
                    await page.evaluate(() => {
                        const host = document.getElementById('host');
                        host.style.width = '90px'; host.style.marginLeft = '500px';
                    });
                    const r = await show(page);
                    const preferred = await page.locator('.vo-mn-wrap:not(.vo-mn-more)').evaluate(el =>
                        el.getBoundingClientRect().right);
                    assert.ok(Math.abs(r.right - preferred) <= 1, JSON.stringify({r, preferred}));
                } finally { await page.close(); }
            });
            for (const noObserver of [false, true]) {
                await check(`${editor}: window resize with fixed menu bar, observer=${!noObserver}`, async () => {
                    const page = await open(browser, css, {width: 800, barWidth: 800, noObserver});
                    try {
                        await show(page);
                        const before = await page.locator('.vo-mn').evaluate(el => el.offsetWidth);
                        await page.setViewportSize({width: 640, height: 940});
                        await inside(page);
                        assert.equal(await page.locator('.vo-mn').evaluate(el => el.offsetWidth), before);
                    } finally { await page.close(); }
                });
            }
            await check(`${editor}: clipping ancestor resizes without changing the menu bar`, async () => {
                const page = await open(browser, css, {width: 1280, clipWidth: 1000, barWidth: 800});
                try {
                    await show(page);
                    await page.evaluate(() => { document.getElementById('clip').style.width = '640px'; });
                    await inside(page);
                    assert.equal(await page.locator('.vo-mn').evaluate(el => el.offsetWidth), 800);
                    await page.evaluate(() => { document.getElementById('clip').style.display = 'none'; });
                    await settle(page);
                    await page.evaluate(() => { document.getElementById('clip').style.display = ''; });
                    await inside(page);
                } finally { await page.close(); }
            });
            await check(`${editor}: review: submenu follows a relocated root without scrolling ancestors`, async () => {
                const page = await open(browser, css, {width: 1280, clipWidth: 1000, barWidth: 800});
                try {
                    await show(page);
                    await page.locator('[data-k="help.sub"]').click();
                    await settle(page);
                    const old = await page.locator('.vo-mn-fly').evaluate(el => el.getBoundingClientRect().left);
                    await page.evaluate(() => { document.getElementById('clip').style.width = '640px'; });
                    await inside(page);
                    const current = await page.locator('.vo-mn-fly').evaluate(el => el.getBoundingClientRect().left);
                    assert.ok(Math.abs(old - current) > 20, JSON.stringify({old, current}));
                    const target = await page.locator('[data-k="help.child"]').evaluate(el => {
                        const r = el.getBoundingClientRect(), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
                        return {x, y, hit: el.contains(document.elementFromPoint(x, y))};
                    });
                    assert.ok(target.hit, 'nested item receives a physical click: ' + JSON.stringify(target));
                    const scroll = await page.locator('#clip').evaluate(el => el.scrollLeft);
                    await page.mouse.click(target.x, target.y);
                    assert.equal(await page.locator('#clip').evaluate(el => el.scrollLeft), scroll);
                    assert.deepEqual(await page.evaluate(() => state.calls), ['child']);
                } finally { await page.close(); }
            });
            await check(`${editor}: open section keeps focus and scroll through overflow`, async () => {
                const page = await open(browser, css, {width: 1280, clipWidth: 1280, longSections: true});
                try {
                    await show(page, 's5');
                    await page.locator('[data-k="s5.10"]').focus();
                    const scroll = await page.locator('.vo-mn-drop.open').evaluate(el => el.scrollTop);
                    await page.evaluate(() => { document.getElementById('clip').style.width = '640px'; });
                    await inside(page);
                    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-k')), 's5.10');
                    assert.equal(await page.locator('.vo-mn-drop.open').evaluate(el => el.scrollTop), scroll);
                    assert.equal(await page.locator('.vo-mn-drop.open').evaluate(el =>
                        !!el.closest('.vo-mn-more')), true);
                    await page.evaluate(() => { document.getElementById('clip').style.width = '1280px'; });
                    await inside(page);
                    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-k')), 's5.10');
                } finally { await page.close(); }
            });
            await check(`${editor}: more list retains focus by section key and returns it to the bar`, async () => {
                const page = await open(browser, css, {width: 1280, clipWidth: 640, longSections: true});
                try {
                    await page.locator('#field').focus();
                    await page.keyboard.press('F10');
                    await page.locator('.vo-mn-more > .vo-mn-item').focus();
                    await page.keyboard.press('ArrowDown');
                    await inside(page);
                    await page.locator('.vo-mn-more-row[data-k="s5"]').focus();
                    await page.evaluate(() => { document.getElementById('clip').style.width = '650px'; });
                    await inside(page);
                    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-k')), 's5');
                    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('vo-mn-more-row')), true);
                    const firstHidden = await page.locator('.vo-mn-more-row').first().getAttribute('data-k');
                    await page.locator('.vo-mn-more-row[data-k="' + firstHidden + '"]').focus();
                    let returned = false;
                    for (let width = 700; width <= 1200; width += 32) {
                        await page.evaluate(width => { document.getElementById('clip').style.width = width + 'px'; }, width);
                        await settle(page);
                        returned = await page.evaluate(key => {
                            const button = menu.el.querySelector('.vo-mn-item[data-k="' + key + '"]');
                            return !!button.getClientRects().length && menu.el.querySelectorAll('.vo-mn-more-row').length > 0;
                        }, firstHidden);
                        if (returned) break;
                    }
                    assert.ok(returned, 'a focused section returns while other sections remain in more');
                    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-k')), firstHidden);
                    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('vo-mn-item')), true);
                    await page.locator('.vo-mn-more-row[data-k="s5"]').focus();
                    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-k')), 's5');
                    await page.evaluate(() => { document.getElementById('clip').style.width = '1280px'; });
                    await settle(page);
                    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-k')), 's5');
                    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('vo-mn-item')), true);
                    assert.equal(await page.evaluate(() => menu.isOpen()), false);
                    await page.locator('#field').focus();
                    await page.evaluate(() => { document.getElementById('clip').style.width = '640px'; });
                    await settle(page);
                    assert.equal(await page.evaluate(() => document.activeElement.id), 'field');
                } finally { await page.close(); }
            });
            for (const more of [false, true]) {
            await check(`${editor}: appearing ${more ? 'more list' : 'section'} stays inside on every animation frame`, async () => {
                const page = await open(browser, css, {width: 640, reducedMotion: 'no-preference', longSections: more});
                try {
                    const frames = await page.evaluate(async more => {
                        const samples = [];
                        if (more) menu.el.querySelector('.vo-mn-more > .vo-mn-item').click();
                        else menu.open('help');
                        const drop = menu.el.querySelector('.vo-mn-drop.open');
                        let finished = false;
                        const animations = drop.getAnimations();
                        Promise.all(animations.map(a => a.finished.catch(() => {}))).then(() => { finished = true; });
                        do {
                            await new Promise(requestAnimationFrame);
                            const r = drop.getBoundingClientRect();
                            samples.push({left: r.left, right: r.right});
                        } while (!finished);
                        return samples;
                    }, more);
                    assert.ok(frames.length > 0);
                    for (const r of frames) assert.ok(r.left >= 3 && r.right <= 637, JSON.stringify(r));
                } finally { await page.close(); }
            });
            }
            await check(`${editor}: repeated layouts and destroy leave no pending mutations`, async () => {
                const page = await open(browser, css, {width: 1280, clipWidth: 800});
                try {
                    for (let i = 0; i < 10; i++) {
                        await show(page);
                        await page.evaluate(() => { document.getElementById('clip').style.width = '640px'; });
                        await inside(page);
                        await page.evaluate(() => {
                            menu.close(); document.getElementById('clip').style.width = '800px';
                        });
                        await settle(page);
                    }
                    await page.evaluate(() => {
                        menu.open('help'); menu.refresh();
                        window.dispatchEvent(new Event('resize'));
                        menu.destroy();
                        window.writes = 0;
                        window.audit = new MutationObserver(records => { writes += records.length; });
                        audit.observe(menu.el, {attributes: true, childList: true, subtree: true});
                        document.getElementById('clip').style.width = '700px';
                        window.dispatchEvent(new Event('resize'));
                    });
                    await settle(page);
                    assert.equal(await page.evaluate(() => writes), 0);
                    assert.deepEqual(await page.evaluate(() => state.calls), []);
                    assert.deepEqual(page.errors, []);
                } finally { await page.close(); }
            });
            await check(`${editor}: review: initially empty clipping area becomes visible`, async () => {
                const page = await open(browser, css, {width: 1280, clipWidth: 0, barWidth: 800});
                try {
                    await page.evaluate(() => menu.open('help'));
                    await settle(page);
                    await page.evaluate(() => { document.getElementById('clip').style.width = '640px'; });
                    await inside(page);
                } finally { await page.close(); }
            });
            await check(`${editor}: review: padding changes the clipping area without a content resize`, async () => {
                const page = await open(browser, css, {width: 1280, clipWidth: 640, barWidth: 800});
                try {
                    await page.evaluate(() => {
                        const el = document.getElementById('clip');
                        el.style.boxSizing = 'content-box'; el.style.paddingRight = '200px';
                    });
                    await show(page);
                    await page.evaluate(() => { document.getElementById('clip').style.paddingRight = '0'; });
                    await inside(page);
                } finally { await page.close(); }
            });
            await check(`${editor}: review: unchanged refresh does not rewrite root placement`, async () => {
                const page = await open(browser, css, {width: 640});
                try {
                    await show(page);
                    await page.evaluate(() => {
                        const drop = menu.el.querySelector('.vo-mn-drop.open');
                        window.changes = [];
                        window.audit = new MutationObserver(records => {
                            changes.push(...records.filter(r => r.attributeName === 'style' || r.attributeName === 'class'));
                        });
                        audit.observe(drop, {attributes: true});
                        menu.refresh();
                    });
                    await settle(page);
                    assert.equal(await page.evaluate(() => changes.length), 0);
                } finally { await page.close(); }
            });
            await check(`${editor}: review: removed more row selects its neighbor and empty menu returns to opener`, async () => {
                const page = await open(browser, css, {width: 1280, clipWidth: 640, longSections: true});
                try {
                    await page.locator('#field').focus();
                    await page.keyboard.press('F10');
                    await page.locator('.vo-mn-more > .vo-mn-item').focus();
                    await page.keyboard.press('ArrowDown');
                    const keys = await page.locator('.vo-mn-more-row').evaluateAll(rows =>
                        rows.map(row => row.getAttribute('data-k')));
                    assert.ok(keys.length >= 2);
                    const gone = keys[keys.length - 1], expected = keys[keys.length - 2];
                    await page.locator('.vo-mn-more-row[data-k="' + gone + '"]').focus();
                    await page.evaluate(gone => {
                        state.sections.find(s => s.k === gone).items = []; menu.refresh();
                    }, gone);
                    await settle(page);
                    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-k')), expected);
                    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('vo-mn-more-row')), true);
                    await page.evaluate(() => { state.sections.forEach(s => { s.items = []; }); menu.refresh(); });
                    await settle(page);
                    assert.equal(await page.evaluate(() => document.activeElement.id), 'field');
                    assert.equal(await page.evaluate(() => menu.isOpen()), false);
                } finally { await page.close(); }
            });
        }
        await check('document adapter: application scale preserves ordinary captions beside a long label', async () => {
            const editor = require('./lib/editors.cjs').find(e => e.name === 'documenteditor');
            const page = await H.openMenu(browser, editor, {width: 640, bar: BAR});
            try {
                await page.setViewportSize({width: 800, height: 940});
                await page.addStyleTag({content: await styles('documenteditor')});
                await applicationScale(page, 1.25);
                await page.evaluate(() => {
                    document.body.classList.add('vo-compact');
                    document.getElementById('host').style.cssText =
                        'position:absolute;top:50px;left:0;margin:0;width:640px;height:700px;overflow:hidden';
                    const itemState = adapter.itemState;
                    adapter.itemState = it => {
                        const state = itemState(it);
                        if (it.k === 'help.help') {
                            state.label = 'The command with a moderately long translated title 1234567890123456789012345';
                        }
                        return state;
                    };
                    menu.refresh(); menu.open('help');
                });
                await settle(page);
                await scaledInside(page, 1.25);
                const text = await page.locator('[data-k="help.about"] .vo-mn-t').evaluate(el => {
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    const r = range.getBoundingClientRect();
                    return {left: r.left, right: r.right};
                });
                assert.ok(text.left >= 0 && text.right <= 800, JSON.stringify(text));
                await page.locator('[data-k="help.about"]').click();
                assert.equal(await page.evaluate(() => menu.isOpen()), false);
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });
        await check('document adapter: availability update preserves manual scrolling', async () => {
            const editor = require('./lib/editors.cjs').find(e => e.name === 'documenteditor');
            const page = await H.openMenu(browser, editor, {width: 800, bar: BAR});
            try {
                await page.setViewportSize({width: 800, height: 400});
                await page.addStyleTag({content: await styles('documenteditor')});
                await page.evaluate(() => {
                    document.body.classList.add('vo-compact'); menu.open('edit');
                    menu.el.querySelector('[data-k="edit.undo"]').focus();
                });
                await settle(page);
                const box = await page.locator('.vo-mn-drop.open').boundingBox();
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.wheel(0, 180);
                await page.waitForFunction(() => menu.el.querySelector('.vo-mn-drop.open').scrollTop > 0);
                const read = () => page.evaluate(() => {
                    const drop = menu.el.querySelector('.vo-mn-drop.open');
                    return {scroll: drop.scrollTop, width: drop.offsetWidth, height: drop.clientHeight,
                        total: drop.scrollHeight, key: document.activeElement.getAttribute('data-k')};
                });
                const before = await read();
                assert.equal(await page.locator('[data-k="edit.redo"]').getAttribute('aria-disabled'), 'false');
                await page.evaluate(() => { ctx.redo = false; menu.refresh(); });
                await settle(page);
                assert.equal(await page.locator('[data-k="edit.redo"]').getAttribute('aria-disabled'), 'true');
                assert.deepEqual(await read(), before);
            } finally { await page.close(); }
        });
    } finally { await browser.close(); }
    done();
})().catch(error => { console.error(error); process.exitCode = 1; });
