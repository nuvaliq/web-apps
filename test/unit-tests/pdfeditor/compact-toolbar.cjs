/* Run: node test/unit-tests/pdfeditor/compact-toolbar.cjs [copies of shell modules…]
 * The one bar of the compact shell of the PDF viewer: #vo-tb in #vo-toolbar, 4 + 44 + 8 over the
 * document, no header and no menu row. Three zones: the start — the PDF icon · the title; the
 * middle — pages ‹ [N] / M › and zoom [N% ▾] · fit, centred on the bar while both sides have room;
 * the end full screen · search · print · download · sharing · ⋮. No navigation button (the panel
 * has its own button over the document), no version history (an item of ⋮), no text selection,
 * hand, comments, thumbnails button or chevron, and one layout only: neither the config nor the
 * integration moves the pages and zoom off the bar. ⋮ is lighter than its neighbours and grey on
 * hover and while open, never the blue of a pressed toggle. Zoom: the field shows the engine
 * percent, the list sets a value, a typed number with Enter sets it (clamped), something else is
 * refused, Escape gives the current back. Fit sets the other fit; the page field goes to a typed
 * page; the page group reads as one (‹ as far from the number as › from the count, the slash in the
 * middle) and does not move from page to page; download is one click to the original PDF, print the
 * stock print, both locked without a connection; full screen asks the editor window for it; the
 * lists lie over the document and over the bar; Escape closes the open ⋮ or list.
 *
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH), see lib/shell-page.cjs.
 * Controls are known by data-vo, not by their texts. Optional arguments: copies of modules or of
 * style files (by file name, e.g. CompactToolbar.js, compact-shell.less) for a negative control.
 */
'use strict';

const assert = require('node:assert/strict');
const H = require('./lib/shell-page.cjs');

const SHELL_H = 4 + 44 + 8;

/* The bar as a person sees it: its zones and the controls in each, by data-vo, and their icons. */
const bar = page => page.evaluate(() => {
    const tb = document.getElementById('vo-tb');
    if (!tb) return null;
    const id = e => e.getAttribute('data-vo') || e.getAttribute('data-vo-wrap') || e.getAttribute('data-group') ||
        (e.classList.contains('vo-title') ? 'title' : e.classList.contains('vo-file-icon') ? 'icon' : e.localName);
    const iconOf = e => { const s = e.querySelector('.vo-air'); const m = s && /img\/air\/(\w+)\.svg/.exec(s.getAttribute('style') || ''); return m ? m[1] : null; };
    const zone = z => Array.from(tb.querySelector(`[data-zone="${z}"]`).children).map(id);
    const nav = document.querySelector('[data-group="nav"]');
    return {
        host: tb.parentNode.id,
        zones: Array.from(tb.children).map(e => e.getAttribute('data-zone')),
        start: zone('start'), mid: zone('mid'), end: zone('end'),
        nav: nav ? Array.from(nav.querySelectorAll('[data-vo]')).map(id) : null,
        icons: Array.from(document.querySelectorAll('#vo-tb button[data-vo]')).map(b => [b.getAttribute('data-vo'), iconOf(b)]),
        rows: ['vo-header', 'vo-menubar'].filter(i => document.getElementById(i)),
        height: stock.layout.toolbar.height,
        shown: Array.from(tb.querySelectorAll('button[data-vo]')).filter(b => !b.closest('.vo-mn-drop')).every(b => b.getClientRects().length > 0)
    };
});

const NAV = ['pagePrev', 'page', 'pageTotal', 'pageNext', 'zoom', 'zoomList', 'fit'];
const END = ['fullscreen', 'search', 'print', 'download', 'sharing', 'more'];

const zoomList = page => page.evaluate(() => {
    const pop = document.querySelector('[data-vo-wrap="zoom"] .vo-pop');
    return {open: pop.getClientRects().length > 0,
        rows: Array.from(pop.querySelectorAll('.vo-pop-item')).map(r => [r.textContent, r.getAttribute('aria-checked')])};
});
const zoomLabel = page => page.evaluate(() => document.querySelector('[data-vo="zoom"]').value);

(async () => {
    const {check, done} = H.checker();
    const browser = await H.launch();
    try {
        const look = (page, key) => page.evaluate(key => {
            const b = document.querySelector(`#vo-tb [data-vo="${key}"]`), s = b && b.querySelector('.vo-air');
            const m = s && /img\/air\/(\w+)\.svg/.exec(s.getAttribute('style') || '');
            return b && {icon: m ? m[1] : null, tip: b.title, label: b.getAttribute('aria-label'), disabled: b.disabled,
                pressed: [b.classList.contains('on'), b.getAttribute('aria-pressed')]};
        }, key);
        const en = (page, path) => page.evaluate(path => path.split('.').reduce((o, k) => o && o[k], window), path);
        const calls = (page, who, what) => page.evaluate(([who, what]) => stock.calls(who, what), [who, what]);
        const clearLog = page => page.evaluate(() => { stock.log.length = 0; });

        await check('one bar: icon · title | pages and zoom | full screen · search · print · download · sharing · ⋮', async () => {
            const page = await H.open(browser);
            const b = await bar(page);
            assert.ok(b, 'no #vo-tb');
            assert.equal(b.host, 'vo-toolbar');
            assert.deepEqual(b.rows, [], 'a header or a menu row is still there');
            assert.equal(b.height, SHELL_H, 'the height over the document');
            assert.deepEqual(b.zones, ['start', 'mid', 'end']);
            assert.deepEqual(b.start, ['icon', 'title']);
            assert.deepEqual(b.mid, ['nav'], 'the pages and zoom are not in the middle');
            assert.deepEqual(b.nav, NAV);
            assert.deepEqual(b.end, END);
            assert.ok(b.shown, 'a control of the bar is not shown');
            const icons = Object.fromEntries(b.icons);
            assert.deepEqual([icons.pagePrev, icons.pageNext, icons.fit, icons.fullscreen, icons.search, icons.print, icons.download,
                icons.sharing, icons.more],
                ['chevronL', 'chevronR', 'fitLandscape', 'demonstration', 'search', 'print', 'download', 'share', 'moreV'], 'icons');
            const gone = await page.evaluate(() => ['select', 'hand', 'comment', 'thumbnails', 'focus', 'history'].filter(k => document.querySelector(`[data-vo="${k}"]`))
                .concat(document.querySelector('#vo-tb [data-vo="navigation"]') ? ['navigation'] : []));
            assert.deepEqual(gone, [], 'controls that went away');
            assert.deepEqual([(await look(page, 'download')).tip, (await look(page, 'print')).tip],
                [await en(page, 'Common.Views.Header.tipDownload'), await en(page, 'Common.Views.Header.tipPrint')], 'stock tips of download and print');
            assert.deepEqual(page.errors, []);
            assert.deepEqual(page.warnings, []);
            await page.close();
            /* Without the rights there is no download or print button. */
            const off = await H.open(browser, {rights: {canDownload: false, canPrint: false}});
            assert.deepEqual((await bar(off)).end, ['fullscreen', 'search', 'sharing', 'more']);
            await off.close();
        });

        await check('the pages and zoom are centred on the bar while the sides have room; a long title gives way', async () => {
            const page = await H.open(browser, {title: 'A very long name of a document that goes on and on and does not fit the bar at all.pdf'});
            const geo = width => page.evaluate(() => {
                const tb = document.getElementById('vo-tb').getBoundingClientRect(), nav = document.querySelector('#vo-tb [data-group="nav"]').getBoundingClientRect();
                const end = document.getElementById('vo-tb-end').getBoundingClientRect(), title = document.querySelector('#vo-tb .vo-title');
                const t = title.getBoundingClientRect();
                return {centre: Math.round((nav.left + nav.right) / 2 - (tb.left + tb.right) / 2), endIn: end.right <= tb.right + 0.5,
                    clipped: title.scrollWidth > title.clientWidth, overlap: t.right > nav.left + 0.5, endOverlap: nav.right > end.left + 0.5};
            });
            const wide = await geo();
            assert.deepEqual([wide.endIn, wide.overlap, wide.endOverlap], [true, false, false], 'the wide window: ' + JSON.stringify(wide));
            assert.ok(Math.abs(wide.centre) <= 1, 'the middle is off the centre by ' + wide.centre);
            assert.equal(wide.clipped, true, 'the long title is not cut, the check proves nothing');
            await page.setViewportSize({width: 900, height: 800});
            await H.settle(page);
            const narrow = await geo();
            assert.deepEqual([narrow.endIn, narrow.overlap, narrow.endOverlap], [true, false, false], 'the narrow window: ' + JSON.stringify(narrow));
            await page.close();
        });

        /* One layout: the pages and zoom stay in the middle of the bar whatever the config or the
           integration asks; no pill over the document. */
        await check('one layout: the pages and zoom stay on the bar, no pill over the document', async () => {
            const where = p => p.evaluate(() => {
                const n = document.querySelector('[data-group="nav"]');
                return {host: n.parentNode.getAttribute('data-zone'), pill: !!document.getElementById('vo-pill'),
                    cls: document.body.classList.contains('vo-layout-pill')};
            });
            const page = await H.open(browser, {config: {ui: {shell: 'modern', layout: 'pill'}}});
            assert.deepEqual(await where(page), {host: 'mid', pill: false, cls: false}, 'ui.layout pill');
            await page.evaluate(() => Common.Gateway.fire('internalcommand', {command: 'shell:layout', data: 'pill'}));
            await H.settle(page);
            assert.deepEqual(await where(page), {host: 'mid', pill: false, cls: false}, 'the command shell:layout');
            assert.equal(await page.evaluate(() => typeof shell.setLayout), 'undefined', 'a layout switch is left in the shell');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('zoom shows the engine percent; the list sets a value; the field takes a typed one', async () => {
            const page = await H.open(browser, {zoom: 90});
            assert.equal(await zoomLabel(page), '90%', 'the engine zoom before the first event');
            await page.evaluate(() => stock.fire('asc_onZoomChange', 150, 0));
            assert.equal(await zoomLabel(page), '150%', 'the field does not follow asc_onZoomChange');
            assert.equal((await zoomList(page)).open, false);
            /* A click into the field selects the number and opens the list. */
            await page.click('#vo-tb [data-vo="zoom"]');
            const sel = await page.evaluate(() => { const i = document.activeElement; return [i.getAttribute('data-vo'), i.selectionStart, i.selectionEnd, i.value.length]; });
            assert.deepEqual(sel, ['zoom', 0, 4, 4], 'the click does not select the number');
            let list = await zoomList(page);
            assert.equal(list.open, true, 'the zoom list does not open');
            assert.deepEqual(list.rows, [['50%', 'false'], ['75%', 'false'], ['100%', 'false'], ['125%', 'false'], ['150%', 'true'], ['200%', 'false']]);
            await page.evaluate(() => { stock.log.length = 0; stock.events.length = 0; });
            await page.locator('[data-vo-wrap="zoom"] .vo-pop-item', {hasText: '75%'}).click();
            assert.deepEqual(await calls(page, 'api', 'zoom'), [[75]], 'the pick does not call api.zoom');
            assert.equal((await zoomList(page)).open, false, 'the list stays open after the pick');
            assert.ok(await page.evaluate(() => stock.sent('edit:complete').length) >= 1, 'the keyboard does not go back to the document');
            /* Typed values. */
            const typed = async text => {
                await page.evaluate(() => { stock.log.length = 0; });
                await page.click('#vo-tb [data-vo="zoom"]');
                await page.keyboard.type(text);
                await page.keyboard.press('Enter');
                await H.settle(page);
                return calls(page, 'api', 'zoom');
            };
            assert.deepEqual(await typed('130'), [[130]], '130');
            assert.deepEqual(await typed('85 %'), [[85]], '85 %');
            assert.deepEqual(await typed('112,6'), [[113]], '112,6');
            assert.deepEqual(await typed('9000'), [[500]], 'above the top');
            assert.deepEqual(await typed('1'), [[10]], 'below the bottom');
            assert.deepEqual(await typed('big'), [], 'a word is taken');
            assert.deepEqual(await page.evaluate(() => { const i = document.activeElement; return [i.getAttribute('data-vo'), i.value, i.selectionEnd - i.selectionStart]; }),
                ['zoom', '150%', 4], 'a refused value: the current one back and selected');
            /* Escape gives the current value back and the keyboard to the document. */
            await page.keyboard.type('333');
            await page.evaluate(() => { stock.log.length = 0; });
            await page.keyboard.press('Escape');
            assert.deepEqual([await zoomLabel(page), await calls(page, 'api', 'zoom'), (await zoomList(page)).open,
                await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-vo'))], ['150%', [], false, null], 'Escape');
            assert.deepEqual((await calls(page, 'api', 'asc_enableKeyEvents')).slice(-1), [[true]], 'the keyboard is not given back');
            /* Fit to width: no value of the list is the current one; ▾ opens and closes the list. */
            await page.evaluate(() => stock.fire('asc_onZoomChange', 113.4, 1));
            assert.equal(await zoomLabel(page), '113%');
            await page.click('#vo-tb [data-vo="zoomList"]');
            list = await zoomList(page);
            assert.deepEqual([list.open, list.rows.filter(r => r[1] === 'true')], [true, []], 'a value is checked while the zoom fits the width');
            await page.click('#vo-tb [data-vo="zoomList"]');
            assert.equal((await zoomList(page)).open, false, '▾ does not close its list');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('fit sets the other fit than the current one and says which by its icon and tip', async () => {
            const page = await H.open(browser);
            const toWidth = await en(page, 'PDFE.Views.ViewTab.tipFitToWidth'), toPage = await en(page, 'PDFE.Views.ViewTab.tipFitToPage');
            assert.ok(toWidth && toPage && toWidth !== toPage, 'stock tips: ' + toWidth + ' / ' + toPage);
            let b = await look(page, 'fit');
            assert.deepEqual([b.icon, b.tip, b.label], ['fitLandscape', toWidth, toWidth], 'own zoom');
            await clearLog(page);
            await page.click('#vo-tb [data-vo="fit"]');
            assert.deepEqual(await calls(page, 'api', 'zoomFitToWidth'), [[]], 'own zoom: not fitted to width');
            /* The engine says the zoom is by width now. */
            await page.evaluate(() => stock.fire('asc_onZoomChange', 80, 1));
            b = await look(page, 'fit');
            assert.deepEqual([b.icon, b.tip, b.label], ['fitPage', toPage, toPage], 'by width');
            await clearLog(page);
            await page.click('#vo-tb [data-vo="fit"]');
            assert.deepEqual(await calls(page, 'api', 'zoomFitToPage'), [[]], 'by width: not fitted to the page');
            await page.evaluate(() => stock.fire('asc_onZoomChange', 60, 2));
            assert.equal((await look(page, 'fit')).icon, 'fitLandscape', 'by page');
            assert.equal(await zoomLabel(page), '60%');
            await page.close();
        });

        await check('pages: the field shows the engine page of the count; Enter goes to a typed page, refuses one outside', async () => {
            const page = await H.open(browser, {page: 1, pages: 12});
            const field = () => page.evaluate(() => {
                const i = document.querySelector('#vo-tb [data-vo="page"]'), t = document.querySelector('#vo-tb [data-vo="pageTotal"]');
                return {value: i.value, total: t.textContent, invalid: i.parentNode.classList.contains('vo-invalid'), aria: i.getAttribute('aria-invalid'),
                    focused: document.activeElement === i};
            });
            assert.deepEqual(await field(), {value: '2', total: '/ 12', invalid: false, aria: null, focused: false}, 'the start');
            await page.evaluate(() => { stock.fire('asc_onCurrentPage', 4); stock.fire('asc_onCountPages', 20); });
            assert.deepEqual(await field(), {value: '5', total: '/ 20', invalid: false, aria: null, focused: false}, 'engine events');
            await clearLog(page);
            await page.click('#vo-tb [data-vo="page"]');
            assert.deepEqual(await calls(page, 'api', 'asc_enableKeyEvents'), [[false]], 'the engine keeps the keyboard in the field');
            await page.keyboard.type('17');
            await page.keyboard.press('Enter');
            assert.deepEqual(await calls(page, 'api', 'goToPage'), [[16]], 'Enter does not go to page 17');
            assert.equal((await field()).focused, false, 'the field keeps the focus after the jump');
            assert.deepEqual((await calls(page, 'api', 'asc_enableKeyEvents')).slice(-1), [[true]], 'the keyboard is not given back');
            for (const typed of ['21', '0', 'x']) {
                await clearLog(page);
                /* A click selects the number: typing replaces it. */
                await page.click('#vo-tb [data-vo="page"]');
                assert.equal(await page.evaluate(() => { const i = document.activeElement; return i.selectionEnd - i.selectionStart; }), 1,
                    'the click does not select the number');
                await page.keyboard.type(typed);
                await page.keyboard.press('Enter');
                assert.deepEqual(await calls(page, 'api', 'goToPage'), [], typed + ' is taken');
                const f = await field();
                assert.deepEqual([f.invalid, f.aria, f.focused], [true, 'true', true], typed + ': not marked');
                await page.keyboard.press('Escape');
                assert.deepEqual(await field(), {value: '5', total: '/ 20', invalid: false, aria: null, focused: false}, typed + ': Escape');
            }
            /* Back to a field left untouched: it keeps the selection of the last visit, and the click
               still selects the number, so typing replaces it. */
            await page.click('#vo-tb [data-vo="page"]');
            await page.evaluate(() => document.activeElement.blur());
            await clearLog(page);
            await page.click('#vo-tb [data-vo="page"]');
            assert.equal(await page.evaluate(() => { const i = document.activeElement; return i.selectionEnd - i.selectionStart; }), 1,
                'the click back into the field does not select the number');
            await page.keyboard.type('7');
            await page.keyboard.press('Enter');
            assert.deepEqual(await calls(page, 'api', 'goToPage'), [[6]], 'typing back in the field does not replace the number');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        /* The page group reads as one, ‹ 1 / 6 ›. Gaps are taken from the ink of a 2× shot, as the
           eye sees them: ‹ stands as far from the number as › from the count, and the slash as far
           from the number as from the count. The field is as wide as the number; a page with fewer
           digits than the count leaves the room left of ‹, so the slash, the count and › stay where
           they are from page to page and while a number is typed; the number is not cut. The plate
           of the field (hover, the focus ring, the ring of a wrong number) keeps off the arrows. */
        await check('pages: ‹ 1 / 6 › — ‹ as far from the number as › from the count, the slash in the middle', async () => {
            const FOCUS_W = 2;
            const geometry = page => page.evaluate(() => {
                const q = k => document.querySelector(`#vo-tb [data-vo="${k}"]`);
                const r = e => { const b = e.getBoundingClientRect(); return {left: b.left, right: b.right, top: b.top, bottom: b.bottom}; };
                const input = q('page'), total = q('pageTotal'), text = total.firstChild, slash = document.createRange();
                const at = text.data.indexOf('/');
                slash.setStart(text, at);
                slash.setEnd(text, at + 1);
                return {prev: r(q('pagePrev')), next: r(q('pageNext')), input: r(input), total: r(total), slash: r(slash),
                    plate: r(input.parentNode), group: r(q('pagePrev').parentNode), value: input.value, text: text.data,
                    cut: input.scrollWidth > input.clientWidth};
            });
            const ink = async page => {
                await page.mouse.move(5, 300);
                await page.evaluate(() => { stock.toolbar.btnPrevPage.setDisabled(false); stock.toolbar.btnNextPage.setDisabled(false); });
                await H.settle(page);
                const g = await geometry(page);
                const clip = {x: g.group.left, y: g.group.top, width: g.group.right - g.group.left, height: g.group.bottom - g.group.top};
                const shot = await page.screenshot({clip});
                /* Columns that differ from the plate under the group (its top left corner). */
                const cols = await page.evaluate(async b64 => {
                    const img = new Image();
                    img.src = 'data:image/png;base64,' + b64;
                    await img.decode();
                    const c = document.createElement('canvas');
                    c.width = img.width;
                    c.height = img.height;
                    const x = c.getContext('2d');
                    x.drawImage(img, 0, 0);
                    const d = x.getImageData(0, 0, c.width, c.height).data, out = [];
                    for (let i = 0; i < c.width; i++) {
                        let on = false;
                        for (let j = 0; j < c.height && !on; j++) {
                            const k = (j * c.width + i) * 4;
                            on = Math.max(Math.abs(d[k] - d[0]), Math.abs(d[k + 1] - d[1]), Math.abs(d[k + 2] - d[2])) > 40;
                        }
                        out.push(on);
                    }
                    return out;
                }, shot.toString('base64'));
                const px = clip.width / cols.length, runs = [];
                cols.forEach((on, i) => {
                    if (on && (!i || !cols[i - 1])) runs.push({left: clip.x + i * px, right: clip.x + (i + 1) * px});
                    else if (on) runs[runs.length - 1].right = clip.x + (i + 1) * px;
                });
                const part = (name, test) => {
                    const own = runs.filter(r => test((r.left + r.right) / 2));
                    if (!own.length) throw new Error(`no ink of ${name} in ${g.value} ${g.text}`);
                    return {left: Math.min(...own.map(r => r.left)), right: Math.max(...own.map(r => r.right))};
                };
                const p = {
                    prev: part('‹', c => c < g.prev.right),
                    number: part('the number', c => c > g.input.left && c < g.input.right),
                    slash: part('/', c => c > g.slash.left && c < g.slash.right),
                    count: part('the count', c => c > g.slash.right && c < g.total.right),
                    next: part('›', c => c > g.next.left)
                };
                return {g, p, toNumber: p.number.left - p.prev.right, toNext: p.next.left - p.count.right,
                    beforeSlash: p.slash.left - p.number.right, afterSlash: p.count.left - p.slash.right};
            };
            /* Two pixels and one step of the 2× shot. */
            const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 2.5, `${what}: ${a.toFixed(1)} against ${b.toFixed(1)}`);
            const read = m => `${m.g.value} ${m.g.text}`;
            const one = m => {
                near(m.beforeSlash, m.afterSlash, read(m) + ': number → / against / → count');
                assert.ok(m.beforeSlash < m.toNext / 2, `${read(m)}: the slash is not with the numbers (${m.beforeSlash.toFixed(1)}, arrows ${m.toNext.toFixed(1)})`);
                near(m.toNumber, m.toNext, read(m) + ': ‹ → number against count → ›');
                assert.equal(m.g.cut, false, read(m) + ': the number is cut');
                assert.ok(m.p.number.left >= m.g.input.left && m.p.number.right <= m.g.input.right, read(m) + ': the number is out of its field');
                assert.ok(m.g.plate.left >= m.g.prev.right - 0.5 && m.g.plate.right <= m.g.next.left + 0.5, read(m) + ': the plate of the field covers an arrow');
                assert.ok(m.g.plate.left - FOCUS_W > m.p.prev.right && m.g.plate.right + FOCUS_W < m.p.next.left,
                    read(m) + ': the focus ring of the field touches an arrow');
            };
            for (const [at, pages] of [[0, 6], [5, 6], [0, 1]]) {
                const page = await H.open(browser, {page: at, pages, scale: 2});
                one(await ink(page));
                assert.deepEqual(page.errors, []);
                await page.close();
            }
            /* 120 pages: pages 1 and 12 keep the slash, the count and › where page 120 has them. */
            const page = await H.open(browser, {page: 119, pages: 120, scale: 2});
            const wide = await ink(page);
            one(wide);
            /* The coordinates are fractional (scale 2) and Chromium rounds the layout to 1/64 px: a
               shift by that much is not visible, so the positions are compared with a tolerance. */
            const still = m => [m.g.input.right, m.g.slash.left, m.g.next.left, m.g.group.left, m.g.group.right];
            const closeAll = (a, b, message, eps = 0.05) => assert.ok(
                a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps),
                message + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
            for (const at of [0, 11]) {
                await page.evaluate(at => stock.fire('asc_onCurrentPage', at), at);
                const m = await ink(page);
                one(m);
                closeAll(still(m), still(wide), read(m) + ': the slash, › or the group moved from page 120');
            }
            /* Typing a longer number widens the field to the left, up to the longest one; a number
               longer than that is not typed, nothing is cut. */
            await page.click('#vo-tb [data-vo="page"]');
            await page.keyboard.type('1200');
            const typed = await geometry(page);
            closeAll(still({g: typed}), still(wide), 'typing moved the slash, › or the group');
            closeAll([typed.input.left], [wide.g.input.left], 'typing does not widen the field to the longest number');
            assert.deepEqual([typed.value, typed.cut], ['120', false], 'a number longer than the longest one is typed or cut');
            await page.keyboard.press('Escape');
            /* 6 pages: 99 is not typed past its first digit, the 9 is refused and shown whole. */
            const six = await H.open(browser, {page: 0, pages: 6});
            await six.click('#vo-tb [data-vo="page"]');
            await six.keyboard.type('99');
            await six.keyboard.press('Enter');
            const nine = await geometry(six);
            assert.deepEqual([nine.value, nine.cut, await six.evaluate(() => document.querySelector('#vo-tb .vo-page-box').classList.contains('vo-invalid'))],
                ['9', false, true], '6 pages: 99 is not refused as 9, whole');
            await six.close();
            /* A click on the count is a click in the field: the number is selected. */
            await page.click('#vo-tb [data-vo="pageTotal"]');
            assert.deepEqual(await page.evaluate(() => {
                const i = document.activeElement;
                return i.getAttribute('data-vo') === 'page' ? ['page', i.selectionEnd - i.selectionStart, i.value.length] : [i.localName];
            }), ['page', 2, 2], 'a click on the count does not select the number');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('the page arrows press their stock buttons and follow them', async () => {
            const page = await H.open(browser);
            assert.deepEqual([(await look(page, 'pagePrev')).disabled, (await look(page, 'pageNext')).disabled], [true, false], 'the start: first page');
            await page.evaluate(() => stock.toolbar.btnPrevPage.setDisabled(false));
            await H.settle(page);
            assert.equal((await look(page, 'pagePrev')).disabled, false, 'the stock unlock is not followed');
            await clearLog(page);
            await page.click('#vo-tb [data-vo="pageNext"]');
            await page.click('#vo-tb [data-vo="pagePrev"]');
            assert.deepEqual((await calls(page, 'stock', 'click')).map(c => c[0]), ['btnNextPage', 'btnPrevPage']);
            await page.close();
        });

        await check('search opens and closes the stock search bar and is pressed while it is shown', async () => {
            const page = await H.open(browser);
            await page.click('#vo-tb [data-vo="search"]');
            assert.deepEqual([await page.evaluate(() => stock.searchBar.visible), (await look(page, 'search')).pressed], [true, [true, 'true']]);
            await page.evaluate(() => stock.searchBar.hide());
            assert.deepEqual((await look(page, 'search')).pressed, [false, 'false'], 'the cross of the search bar');
            await page.click('#vo-tb [data-vo="search"]');
            await page.click('#vo-tb [data-vo="search"]');
            assert.equal(await page.evaluate(() => stock.searchBar.visible), false, 'the second click does not close the search bar');
            await page.close();
        });

        await check('download is one click to the original PDF, print the stock print; both locked without a connection', async () => {
            const page = await H.open(browser);
            await clearLog(page);
            await page.evaluate(() => { stock.events.length = 0; });
            await page.click('#vo-tb [data-vo="download"]');
            await page.click('#vo-tb [data-vo="print"]');
            assert.deepEqual((await calls(page, 'leftMenu', 'clickSaveAsFormat')).map(c => c[0] === undefined ? 'original' : c[0]), ['original'],
                'download does not take the original');
            assert.deepEqual(await page.evaluate(() => stock.sent('file:print').length), 1, 'print does not send file:print');
            assert.equal(await page.evaluate(() => !!document.querySelector('#vo-tb [data-vo-wrap="download"], #vo-tb .vo-download')), false, 'a download menu');
            await page.evaluate(() => { stock.main._state.isDisconnected = true; Common.NotificationCenter.trigger('api:disconnect'); });
            const locked = await page.evaluate(() => ['download', 'print'].map(k => {
                const b = document.querySelector(`#vo-tb [data-vo="${k}"]`);
                return [b.classList.contains('vo-locked'), b.getAttribute('aria-disabled')];
            }));
            assert.deepEqual(locked, [[true, 'true'], [true, 'true']], 'not locked without a connection');
            await clearLog(page);
            await page.click('#vo-tb [data-vo="download"]', {force: true});
            await page.click('#vo-tb [data-vo="print"]', {force: true});
            assert.deepEqual([await calls(page, 'leftMenu', 'clickSaveAsFormat'), await page.evaluate(() => stock.sent('file:print').length)], [[], 1],
                'a locked button runs');
            /* The stock print button switched off locks print as well. */
            await page.evaluate(() => { stock.main._state.isDisconnected = false; Common.NotificationCenter.trigger('api:disconnect'); });
            await page.evaluate(() => stock.toolbar.btnPrint.setDisabled(true));
            await H.settle(page);
            assert.deepEqual(await page.evaluate(() => ['download', 'print'].map(k => document.querySelector(`#vo-tb [data-vo="${k}"]`).classList.contains('vo-locked'))),
                [false, true], 'the stock print button');
            await page.close();
        });

        await check('full screen asks the editor window for full screen and is there only where the browser gives it', async () => {
            const page = await H.open(browser, {before: () => {
                document.documentElement.requestFullscreen = function () { stock.note('window', 'requestFullscreen'); return Promise.resolve(); };
            }});
            const b = await look(page, 'fullscreen');
            assert.deepEqual([b.icon, b.tip, b.pressed], ['demonstration', await en(page, 'PDFE.Views.PdfActions.textFullscreen'), [false, 'false']]);
            await page.click('#vo-tb [data-vo="fullscreen"]');
            assert.equal((await calls(page, 'window', 'requestFullscreen')).length, 1, 'no request');
            /* Its place: the first of the end zone, before search. */
            assert.deepEqual((await bar(page)).end.slice(0, 2), ['fullscreen', 'search']);
            await page.close();
            const off = await H.open(browser, {before: () => {
                Object.defineProperty(document, 'fullscreenEnabled', {value: false});
                Object.defineProperty(document, 'webkitFullscreenEnabled', {value: false});
            }});
            assert.equal(await look(off, 'fullscreen'), null, 'a button without full screen in the browser');
            assert.deepEqual((await bar(off)).end, END.filter(k => k !== 'fullscreen'));
            await off.close();
        });

        /* The bar is a layer of its own (backdrop-filter): without a level of its own it lies under the
           document, and so does its zoom list. The stand row does not clip what drops out of it here. */
        await check('the zoom list lies over the document, the ⋮ list over the bar', async () => {
            const page = await H.open(browser);
            await page.addStyleTag({content: '#toolbar {overflow: visible}'});
            await page.click('#vo-tb [data-vo="zoomList"]');
            const zoom = await page.evaluate(() => {
                const pop = document.querySelector('#vo-tb [data-vo-wrap="zoom"] .vo-pop');
                const doc = document.getElementById('editor_sdk').getBoundingClientRect();
                return {
                    overDoc: pop.getBoundingClientRect().bottom > doc.top + 100,
                    rows: Array.from(pop.querySelectorAll('.vo-pop-item')).map(r => {
                        const b = r.getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
                        return [r.textContent, r.contains(e) ? 'list' : e && (e.id || e.className)];
                    })
                };
            });
            assert.ok(zoom.overDoc, 'the zoom list does not reach into the document, the check proves nothing');
            assert.deepEqual(zoom.rows, ['50%', '75%', '100%', '125%', '150%', '200%'].map(v => [v, 'list']), 'the zoom list is under the document');
            await page.click('#vo-tb [data-vo="zoomList"]');
            await page.click('#vo-tb [data-vo="more"]');
            const menu = await page.evaluate(() => {
                const drop = document.querySelector('#vo-tb .vo-mn-drop.open');
                if (!drop) return null;
                const rows = Array.from(drop.querySelectorAll('[data-k]'));
                return {rows: rows.length, hits: rows.filter(r => {
                    const b = r.getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
                    return !r.contains(e);
                }).map(r => r.getAttribute('data-k'))};
            });
            assert.ok(menu && menu.rows > 5, 'the ⋮ list is not open');
            assert.deepEqual(menu.hits, [], 'rows of the ⋮ list under something');
            await page.close();
        });

        await check('menu uses the PDF right anchor again after a constrained position', async () => {
            const page = await H.open(browser, {width: 640, height: 940});
            try {
                await page.evaluate(() => {
                    const more = document.querySelector('#vo-tb .vo-more');
                    more.style.position = 'relative';
                    more.style.left = '-500px';
                });
                await page.click('#vo-tb [data-vo="more"]');
                for (const width of [640, 800, 1280]) {
                    await page.setViewportSize({width, height: 940});
                    await page.waitForFunction(() => {
                        const drop = document.querySelector('#vo-tb .vo-mn-drop.open');
                        const r = drop.getBoundingClientRect();
                        const anchor = drop.parentElement.getBoundingClientRect();
                        return r.left >= 3 && r.right <= document.documentElement.clientWidth - 3 &&
                            Math.abs(r.right - Math.max(anchor.right, 4 + r.width)) <= 1;
                    });
                }
                const result = await page.evaluate(() => {
                    const drop = document.querySelector('#vo-tb .vo-mn-drop.open');
                    return {right: drop.getBoundingClientRect().right,
                        anchor: drop.parentElement.getBoundingClientRect().right,
                        inlineLeft: drop.style.left, extra: !!document.querySelector('.vo-mn-more-row')};
                });
                assert.ok(Math.abs(result.right - result.anchor) <= 1, JSON.stringify(result));
                assert.equal(result.inlineLeft, '', 'the native PDF right anchor is restored');
                assert.equal(result.extra, false, 'the single PDF menu does not acquire more sections');
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });

        /* ⋮ is lighter than the icons next to it (base-3); hover is the grey of the other buttons of the
           bar, and the open menu a grey pressed plate, not the blue of a pressed toggle. */
        await check('⋮ is base-3 at rest, grey on hover and while open, never blue', async () => {
            const page = await H.open(browser);
            const paint = sel => page.evaluate(sel => {
                const b = document.querySelector(sel), cs = getComputedStyle(b), ic = b.querySelector('.vo-air');
                return {bg: cs.backgroundColor, color: ic ? getComputedStyle(ic).backgroundColor : cs.color};
            }, sel);
            const still = () => page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => null))));
            await page.addStyleTag({content: '#vo-tb * {transition: none !important}'});
            const more = await paint('#vo-tb [data-vo="more"]'), search = await paint('#vo-tb [data-vo="search"]');
            assert.equal(more.color, 'rgb(130, 139, 149)', '⋮ at rest is not base-3');
            assert.notEqual(more.color, search.color, '⋮ is not lighter than search');
            assert.equal(more.bg, 'rgba(0, 0, 0, 0)', '⋮ has a plate at rest');
            await page.hover('#vo-tb [data-vo="search"]');
            await still();
            const searchHover = await paint('#vo-tb [data-vo="search"]');
            await page.hover('#vo-tb [data-vo="more"]');
            await still();
            const moreHover = await paint('#vo-tb [data-vo="more"]');
            assert.deepEqual(moreHover, searchHover, 'the hover of ⋮ is not the hover of search');
            await page.click('#vo-tb [data-vo="more"]');
            await page.mouse.move(5, 300);
            await still();
            const open = await paint('#vo-tb [data-vo="more"]');
            const blue = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--vo-fig-on-bg').trim());
            assert.equal(await page.evaluate(() => shell.menu.isOpen()), true, 'the menu is not open');
            assert.equal(open.bg, 'rgba(0, 0, 0, 0.06)', 'the open ⋮ is not the grey pressed plate');
            assert.notEqual(open.color, 'rgb(0, 117, 255)', 'the open ⋮ is blue');
            assert.ok(blue, 'no blue token to compare with');
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('Escape closes the open ⋮ or zoom list, one per press', async () => {
            const page = await H.open(browser);
            await page.click('#vo-tb [data-vo="more"]');
            await page.keyboard.press('Escape');
            assert.equal(await page.evaluate(() => shell.menu.isOpen()), false, 'Escape does not close ⋮');
            await page.click('#vo-tb [data-vo="zoomList"]');
            assert.equal((await zoomList(page)).open, true);
            await page.evaluate(() => document.getElementById('area_id').focus());
            await page.keyboard.press('Escape');
            assert.equal((await zoomList(page)).open, false, 'Escape does not close the zoom list');
            assert.deepEqual(page.errors, []);
            await page.close();
        });
    } finally {
        await browser.close();
    }
    done();
})().catch(e => { console.log('FAIL run —', e && e.stack || e); process.exitCode = 1; });
