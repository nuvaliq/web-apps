/* Run: node test/unit-tests/pdfeditor/compact-nav.cjs [copies of shell modules…]
 * The navigation panel and the left menu of the compact shell of the PDF viewer. Collapsed, the
 * panel is a pill button (#vo-nav-pill, the outline icon, the stock Navigation tip) at the top left
 * of the document field (#editor-container, on the left line of the bar). Open, it is a column
 * (#vo-nav-rail, in #editor-container too): «‹» that closes it and a row per page — a thumbnail of
 * the page (with the thumbnails right) and its name: the first bookmark of the PDF leading to the
 * page (Navigation._viewerNavigationObject, [{page, level, description}], refreshed by
 * asc_onViewerBookmarksUpdate), otherwise the page number. The current page is marked
 * (asc_onCurrentPage), a row goes to its page (goToPage), asc_onCountPages rebuilds the rows.
 * Thumbnails are drawn by the engine file (getPage) for the visible rows and a few ahead, in screen
 * density; a page not loaded yet is drawn on a later sync. The pages the engine repaints after
 * their fonts load (file.onRepaintPages, the stock handler kept and run first) are drawn again; a
 * new file of the renderer (the engine opens the document again) clears the thumbnails and draws
 * them from it; destroy() gives the file its stock handler back.
 * The column lies over the field left of the page and takes no room: opening and closing it move
 * neither the document area nor the canvas of the pages. It is as wide as that field (the renderer:
 * width of the area, documentWidth of the widest page) less the air to the page, 300 at most; a
 * field narrower than 180 folds it into the pill, a field wider than 200 opens it again; a click is
 * stronger until the field changes its band. By itself the panel is open only in a PDF with
 * bookmarks. The field under the bar, the column, the document area and the canvas the engine
 * paints are one colour: the shell gives the engine the colour of its field (asc_setSkin), the theme
 * keeps its own. The stock panels of the left menu (comments, the advanced search, and the stock
 * thumbnails and bookmarks if the stock code opens them) take the left menu as in the stock, the
 * column goes along with the document area; the chat does not open.
 *
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH), see lib/shell-page.cjs.
 * Optional arguments: copies of modules (by file name, e.g. NavigationPanel.js, compact-shell.less)
 * for a negative control.
 */
'use strict';

const assert = require('node:assert/strict');
const H = require('./lib/shell-page.cjs');

/* Bookmarks as the engine gives them; the blank one does not name its page. */
const BOOKMARKS = [
    {description: 'Part I', level: 0, page: 0},
    {description: 'Chapter 1', level: 1, page: 0},
    {description: '  ', level: 1, page: 1},
    {description: 'Chapter 2', level: 1, page: 3}
];
/* The rows of a PDF of four pages with them: the first bookmark of a page, otherwise its number. */
const NAMED = ['Part I', '2', '3', 'Chapter 2'];

/* Thumbnail width in CSS pixels (THUMB_W of NavigationPanel.js, @vo-nav-thumb-w) and its height
   for a page of the stand file (US Letter, 612 × 792 points); the paper colour asked. */
const THUMB_W = 32;
const THUMB_H = Math.round(THUMB_W * 792 / 612);
const PAPER = 0xFFFFFF;

/* The column: no wider than RAIL_W, folded below RAIL_MIN, open again above RAIL_MIN + 20, GAP air
   to the page (NavigationPanel.js). The stand window is 1280 wide, the stock left menu 300. */
const RAIL_W = 300, RAIL_MIN = 180, GAP = 24;
const WIN = 1280, LEFT_W = 300;

/* The field colour of the shell (--vo-canvas-bg) and the canvas colour of the stand theme. */
const FIELD = 'rgb(238, 242, 244)';

/* Stock rules the stand does not carry: the left menu is a positioned layout item (.layout-item,
   absolute in the stock; relative here to keep the flex row of the stand) and its left panel takes
   the whole height (.left-panel of common.less), so the list of the column has a bounded height. */
const STOCK_CSS = '#left-menu {position: relative} #left-menu .left-panel {height: 100%}';

/* A page of the viewer with the stock rules above; `before` runs after them. */
const view = (browser, opts = {}) => H.open(browser, Object.assign({}, opts, {
    before: `(() => {
        const s = document.createElement('style');
        s.textContent = ${JSON.stringify(STOCK_CSS)};
        document.head.appendChild(s);
        ${opts.before ? '(' + opts.before + ')();' : ''}
    })()`
}));

/* What a person sees of the left side, the stock buttons pressed and where the document area is. */
const state = page => page.evaluate(() => {
    const shown = el => !!el && el.getClientRects().length > 0;
    const menu = document.getElementById('left-menu');
    const pill = document.getElementById('vo-nav-pill'), rail = document.getElementById('vo-nav-rail');
    const lm = stock.leftMenu.leftMenu;
    const rows = shown(rail) ? Array.from(rail.querySelectorAll('.vo-nav-row')) : [];
    const area = document.getElementById('editor-container').getBoundingClientRect();
    return {
        open: document.body.classList.contains('vo-left-open'),
        nav: document.body.classList.contains('vo-nav-open'),
        menu: shown(menu),
        icons: shown(menu.querySelector('.tool-menu-btns')),
        rail: shown(rail),
        rows: rows.map(r => r.querySelector('.vo-nav-name').textContent),
        current: rows.filter(r => r.classList.contains('on')).map(r => Number(r.getAttribute('data-page'))),
        pill: pill ? (shown(pill) ? pill.getAttribute('aria-expanded') : 'hidden') : null,
        panels: ['left-panel-thumbnails', 'left-panel-navigation'].filter(id => shown(document.getElementById(id))),
        area: [Math.round(area.left), Math.round(area.width)],
        pressed: ['btnComments', 'btnThumbnails', 'btnNavigation', 'btnSearchBar', 'btnChat'].filter(k => lm[k].pressed)
    };
});

const CLOSED = {open: false, nav: false, menu: false, icons: false, rail: false, rows: [], current: [], pill: 'false',
    panels: [], area: [0, WIN], pressed: []};

/* The open panel of a PDF of four pages with BOOKMARKS, on page 2: the document area is the whole
   window, as with the panel closed. */
const OPEN = {open: false, nav: true, menu: false, icons: false, rail: true, rows: NAMED, current: [1], pill: 'hidden',
    panels: [], area: [0, WIN], pressed: []};

/* The stock way a panel opens or closes past the shell: its button and the layout notification. */
const stockToggle = (page, btn, on) => page.evaluate(([btn, on]) => {
    stock.leftMenu.leftMenu[btn].toggle(on);
    Common.NotificationCenter.trigger('layout:changed', 'leftmenu');
}, [btn, on]);

/* Bookmarks that the stock navigation receives later. */
const bookmarks = (page, list) => page.evaluate(list => {
    stock.navigation._viewerNavigationObject = list;
    stock.fire('asc_onViewerBookmarksUpdate', list);
}, list);

/* The widest page at another zoom: the engine gives the new width and the zoom event. */
const zoomTo = (page, documentWidth) => page.evaluate(w => {
    stock.api.getDocumentRenderer().documentWidth = w;
    stock.fire('asc_onZoomChange', 100, 0);
}, documentWidth);

/* The panel follows the layout, the window and the zoom after a pause (fitSoon). */
const fitted = async page => {
    await page.waitForTimeout(150);
    await H.settle(page);
};

/* The opening animation of the list moves the rows; geometry is measured after it. */
const still = page => page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => null))));

/* Opened by a click on the pill (a PDF without bookmarks starts with the pill). */
const openNav = async page => {
    await page.click('#vo-nav-pill');
    await H.settle(page);
};

/* Where the document is: the area, the parent and the canvas of the pages, the width the engine
   lays the pages in. */
const doc = page => page.evaluate(() => {
    const box = id => { const b = document.getElementById(id).getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round); };
    return {area: box('editor-container'), sdk: box('editor_sdk'), canvas: box('stand-viewer'),
        width: stock.api.getDocumentRenderer().width};
});
/* What the shell asked of the engine layout and of the stock left menu. */
const asked = page => page.evaluate(() => ({resize: stock.calls('api', 'Resize').length,
    clicks: stock.calls('stock', 'click').map(c => c[0])}));

/* Colours of the field under the bar, the column, the document area and the canvas of the pages. */
const colours = page => page.evaluate(() => {
    const bg = el => el ? getComputedStyle(el).backgroundColor : null;
    return {shell: bg(document.getElementById('vo-shell')), toolbar: bg(document.getElementById('toolbar')),
        rail: bg(document.getElementById('vo-nav-rail')), area: bg(document.getElementById('editor-container')),
        canvas: bg(document.getElementById('stand-viewer'))};
});
const skins = page => page.evaluate(() => stock.skins.map(c => c['canvas-background']));

/* Rows of the column: drawn (the canvas has the size of a thumbnail in device pixels), seen (inside
   the list box) and the pages the file was asked for. */
const thumbs = page => page.evaluate(w => {
    const list = document.querySelector('#vo-nav-rail .vo-nav-list'), box = list.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll('.vo-nav-row'));
    const index = r => Number(r.getAttribute('data-page'));
    return {
        count: rows.length,
        canvases: list.querySelectorAll('canvas.vo-nav-thumb').length,
        drawn: rows.filter(r => { const c = r.querySelector('canvas'); return !!c && c.width === Math.round(w * devicePixelRatio); }).map(index),
        seen: rows.filter(r => { const b = r.getBoundingClientRect(); return b.bottom > box.top + 1 && b.top < box.bottom - 1; }).map(index),
        asked: stock.calls('file', 'getPage').map(c => c[0])
    };
}, THUMB_W);

/* A page that comes in: the file gives it from now on (the stand file gives null for the pages of
   `unloaded`; the wrapper keeps its log). */
const load = (page, n) => page.evaluate(n => {
    const file = stock.api.getDocumentRenderer().file, get = file.getPage;
    file.getPage = function (i, w, h) {
        const c = get.apply(this, arguments);
        if (c || i !== n) return c;
        const x = document.createElement('canvas');
        x.width = w;
        x.height = h;
        return x;
    };
}, n);

/* The column against the area and the first page: its box and the left edge of the page. */
const railBox = page => page.evaluate(() => {
    const area = document.getElementById('editor-container').getBoundingClientRect();
    const rail = document.getElementById('vo-nav-rail').getBoundingClientRect(), r = stock.api.getDocumentRenderer();
    return {left: Math.round(rail.left - area.left), top: Math.round(rail.top - area.top), width: Math.round(rail.width),
        height: Math.round(rail.height), areaH: Math.round(area.height), pageLeft: Math.round((r.width - r.documentWidth) / 2)};
});

const clean = page => {
    assert.deepEqual(page.errors, [], 'page errors');
    assert.deepEqual(page.warnings, [], 'console warnings');
};

const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a}, expected ${b} ± 1`);

(async () => {
    const {check, done} = H.checker();
    const browser = await H.launch();
    try {
        await check('with bookmarks the panel starts open over the field left of the page: a row per page with names from bookmarks, no room taken, no pill', async () => {
            const page = await view(browser, {bookmarks: BOOKMARKS, pages: 4, page: 1,
                before: () => { PDFE.Views.LeftMenu.tipNavigation = 'Stock navigation'; }});
            await fitted(page);
            assert.deepEqual(await state(page), OPEN, 'the open panel');
            const look = await page.evaluate(() => {
                const pill = document.getElementById('vo-nav-pill'), rail = document.getElementById('vo-nav-rail');
                const hide = rail.querySelector('.vo-nav-hide');
                const src = el => { const i = el && el.querySelector('.vo-air'); return i ? i.style.getPropertyValue('--vo-air-src') : ''; };
                const cur = rail.querySelector('.vo-nav-row.on');
                return {
                    hosts: [rail.parentNode.id, pill.parentNode.id, !!document.querySelector('#left-menu #vo-nav-rail')],
                    pill: [pill.tagName, pill.classList.contains('vo-ib'), pill.getAttribute('data-vo'), pill.hasAttribute('hidden'),
                        pill.getAttribute('aria-controls')],
                    hide: [hide.tagName, hide.getAttribute('data-vo'), hide.getAttribute('aria-expanded'), hide.getAttribute('aria-controls')],
                    icons: [/\/outline\.svg\b/.test(src(pill)), /\/chevronL\.svg\b/.test(src(hide))],
                    tips: [pill.title, pill.getAttribute('aria-label'), hide.title, hide.getAttribute('aria-label'), rail.getAttribute('aria-label')],
                    rows: Array.from(rail.querySelectorAll('.vo-nav-list > button.vo-nav-row')).map(r => r.getAttribute('data-page')),
                    current: [cur.getAttribute('aria-current'), rail.querySelectorAll('[aria-current]').length],
                    old: [!!document.getElementById('vo-nav-tabs'), !!document.querySelector('#vo-tb [data-vo="navigation"]')]
                };
            });
            assert.deepEqual(look.hosts, ['editor-container', 'editor-container', false], 'the column and the pill are not over the document field');
            assert.deepEqual(look.pill, ['BUTTON', true, 'navigation', true, 'vo-nav-rail'], 'the pill');
            assert.deepEqual(look.hide, ['BUTTON', 'navigationHide', 'true', 'vo-nav-rail'], '«‹»');
            assert.deepEqual(look.icons, [true, true], 'icons of the pill and «‹»');
            assert.deepEqual(look.tips, Array(5).fill('Stock navigation'), 'the tips are not the stock Navigation');
            assert.deepEqual(look.rows, ['0', '1', '2', '3'], 'row buttons');
            assert.deepEqual(look.current, ['page', 1], 'aria-current');
            assert.deepEqual(look.old, [false, false], 'the tabs or ☰ on the bar are back');
            /* The field left of the page is (1280 − 600) / 2 = 340; less the air, 316 — the column is 300. */
            const box = await railBox(page);
            assert.deepEqual([box.left, box.top, box.width, box.height], [0, 0, RAIL_W, box.areaH], 'the column box');
            assert.ok(box.left + box.width <= box.pageLeft - GAP, 'the column reaches the page: ' + JSON.stringify(box));
            /* Thumbnails on the left line of the bar, «‹» at the height of the pill. */
            await still(page);
            const line = await page.evaluate(() => {
                const r = el => el.getBoundingClientRect();
                const area = r(document.getElementById('editor-container'));
                return {area: area.left, areaTop: area.top, bar: r(document.getElementById('vo-tb')).left,
                    thumbs: Array.from(document.querySelectorAll('#vo-nav-rail .vo-nav-thumb')).map(c => r(c).left),
                    hideTop: r(document.querySelector('#vo-nav-rail .vo-nav-hide')).top};
            });
            assert.equal(line.thumbs.length, 4, 'thumbnails');
            line.thumbs.forEach(x => {
                near(x - line.area, 20, 'a thumbnail from the left of the document field');
                near(x, line.bar, 'a thumbnail from the left line of the bar');
            });
            near(line.hideTop - line.areaTop, 6, '«‹» from the top of the document field');
            clean(page);
            await page.close();
        });

        await check('one background: the field under the bar, the column, the document area and the canvas of the pages are one colour; the theme keeps its own', async () => {
            const page = await view(browser, {bookmarks: BOOKMARKS, pages: 4});
            await fitted(page);
            assert.deepEqual(await colours(page), {shell: FIELD, toolbar: FIELD, rail: FIELD, area: FIELD, canvas: FIELD},
                'the colours of the field, the column, the area and the canvas');
            /* The engine got the field colour after the theme gave it its own. */
            const sent = await skins(page);
            assert.equal(sent[0], '#f3f3f3', 'the stock start of the stand');
            assert.equal(sent[sent.length - 1], '#eef2f4', 'the engine does not get the field colour');
            /* The theme keeps its colours on body: what it caches and gives the engine on its own. */
            assert.equal(await page.evaluate(() => Common.UI.Themes.getThemeColors()['canvas-background']), '#f3f3f3',
                'the field colour went into the colours of the theme');
            /* The panel closed: the pill on the same field. */
            await page.click('#vo-nav-rail .vo-nav-hide');
            await H.settle(page);
            let c = await colours(page);
            assert.deepEqual([c.toolbar, c.area, c.canvas], [FIELD, FIELD, FIELD], 'the colours with the panel closed');
            /* A theme change gives the engine the colours of the theme; the shell gives it the field again. */
            await page.evaluate(() => {
                stock.api.asc_setSkin(Common.UI.Themes.getThemeColors());
                Common.NotificationCenter.trigger('uitheme:changed');
            });
            await H.settle(page);
            assert.equal((await colours(page)).canvas, FIELD, 'the canvas after a theme change');
            clean(page);
            await page.close();
        });

        await check('opening and closing the panel move neither the document area nor the canvas of the pages', async () => {
            const page = await view(browser, {bookmarks: BOOKMARKS, pages: 4, page: 1});
            await fitted(page);
            await still(page);
            const before = await doc(page);
            assert.deepEqual([before.area[0], before.area[2], before.width], [0, WIN, WIN], 'the document area at the start');
            const hideTop = await page.evaluate(() => {
                stock.log.length = 0;
                return document.querySelector('#vo-nav-rail .vo-nav-hide').getBoundingClientRect().top;
            });
            await page.click('#vo-nav-rail .vo-nav-hide');
            await fitted(page);
            assert.deepEqual(await state(page), CLOSED, '«‹» does not close the panel');
            assert.deepEqual(await doc(page), before, 'closing moves the document');
            const pill = await page.evaluate(() => {
                const area = document.getElementById('editor-container').getBoundingClientRect();
                const b = document.getElementById('vo-nav-pill').getBoundingClientRect();
                return {left: b.left - area.left, top: b.top - area.top, x: b.left, y: b.top,
                    bar: document.getElementById('vo-tb').getBoundingClientRect().left};
            });
            near(pill.left, 20, 'the pill from the left of the document field');
            near(pill.top, 6, 'the pill from the top of the document field');
            near(pill.x, pill.bar, 'the pill from the left line of the bar');
            near(pill.y, hideTop, 'the pill and «‹» are not at one height');
            await page.click('#vo-nav-pill');
            await fitted(page);
            assert.deepEqual(await state(page), OPEN, 'the pill does not open the panel');
            assert.deepEqual(await doc(page), before, 'opening moves the document');
            assert.deepEqual(await asked(page), {resize: 0, clicks: []}, 'the stock left menu or the engine layout is asked');
            clean(page);
            await page.close();
        });

        await check('by itself the panel is open only with bookmarks: without them a pill; bookmarks that come open it; a click is kept', async () => {
            let page = await view(browser, {pages: 4});
            await fitted(page);
            assert.deepEqual(await state(page), CLOSED, 'a PDF without bookmarks');
            await bookmarks(page, BOOKMARKS);
            await fitted(page);
            let s = await state(page);
            assert.deepEqual([s.nav, s.rail, s.rows, s.pill], [true, true, NAMED, 'hidden'], 'bookmarks that come after the start');
            /* Closed by a click, the panel stays closed when the bookmarks come again. */
            await page.click('#vo-nav-rail .vo-nav-hide');
            await H.settle(page);
            await bookmarks(page, BOOKMARKS);
            await fitted(page);
            assert.deepEqual((await state(page)).pill, 'false', 'bookmarks again open the panel closed by a click');
            clean(page);
            await page.close();
            /* Opened by a click in a PDF without bookmarks, it stays open with numbers. */
            page = await view(browser, {pages: 3});
            await openNav(page);
            await fitted(page);
            s = await state(page);
            assert.deepEqual([s.nav, s.rows, s.pill, s.area], [true, ['1', '2', '3'], 'hidden', [0, WIN]], 'opened by a click without bookmarks');
            clean(page);
            await page.close();
        });

        await check('the column is as wide as the field left of the page; a narrow field folds it, a wide one opens it again; a click is stronger until the band changes', async () => {
            const page = await view(browser, {bookmarks: BOOKMARKS, pages: 4, page: 1});
            /* A wider page: (1280 − 800) / 2 − 24 = 216. */
            await zoomTo(page, 800);
            await fitted(page);
            let box = await railBox(page);
            assert.equal(box.width, 216, 'the column is not as wide as the field');
            assert.ok(box.width <= box.pageLeft - GAP, 'the column reaches the page');
            /* (1280 − 900) / 2 − 24 = 166 < 180: folded into the pill, the document as it was. */
            const before = await doc(page);
            await zoomTo(page, 900);
            await fitted(page);
            let s = await state(page);
            assert.deepEqual([s.nav, s.rail, s.pill], [false, false, 'false'], 'a narrow field does not fold the column');
            assert.deepEqual(await doc(page), before, 'folding moves the document');
            /* A click opens it over the edge of the page, on the field colour, at its least width. */
            await page.click('#vo-nav-pill');
            await fitted(page);
            s = await state(page);
            assert.deepEqual([s.nav, s.rail, s.area], [true, true, [0, WIN]], 'a click does not open it on a narrow field');
            box = await railBox(page);
            assert.equal(box.width, RAIL_MIN, 'the column opened on a narrow field');
            assert.equal((await colours(page)).rail, FIELD, 'the column over the page is not on the field colour');
            /* Another narrow zoom keeps the click. */
            await zoomTo(page, 950);
            await fitted(page);
            assert.equal((await state(page)).nav, true, 'a zoom in the same band undoes the click');
            /* Between the thresholds nothing changes: (1280 − 870) / 2 − 24 = 181 opens nothing by itself. */
            await page.click('#vo-nav-rail .vo-nav-hide');
            await zoomTo(page, 870);
            await fitted(page);
            assert.equal((await state(page)).nav, false, 'the column opens below the upper threshold');
            /* A wide field again: open by itself. */
            await zoomTo(page, 600);
            await fitted(page);
            s = await state(page);
            assert.deepEqual([s.nav, s.rail, s.area], [true, true, [0, WIN]], 'a wide field does not open the column again');
            assert.equal((await railBox(page)).width, RAIL_W, 'the column on a wide field');
            /* The window: narrower — folded, as wide again — open. */
            await page.setViewportSize({width: 900, height: 800});
            await fitted(page);
            assert.equal((await state(page)).nav, false, 'a narrow window does not fold the column');
            await page.setViewportSize({width: WIN, height: 800});
            await fitted(page);
            assert.equal((await state(page)).nav, true, 'a wide window does not open the column again');
            clean(page);
            await page.close();
        });

        await check('rows: the current page is marked, a row goes to its page, a new page count rebuilds the rows', async () => {
            const page = await view(browser);
            await openNav(page);
            let s = await state(page);
            assert.deepEqual([s.rows, s.current], [['1', '2', '3'], [0]], 'at the start');
            await page.evaluate(() => stock.fire('asc_onCurrentPage', 2));
            await H.settle(page);
            s = await state(page);
            assert.deepEqual(s.current, [2], 'asc_onCurrentPage');
            assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#vo-nav-rail [aria-current]'))
                .map(r => [r.getAttribute('data-page'), r.getAttribute('aria-current')])), [['2', 'page']], 'aria-current');
            await page.evaluate(() => { stock.log.length = 0; });
            await page.click('#vo-nav-rail .vo-nav-row[data-page="1"]');
            await H.settle(page);
            assert.deepEqual(await page.evaluate(() => stock.calls('api', 'goToPage')), [[1]], 'goToPage');
            assert.deepEqual((await state(page)).current, [1], 'the row clicked is not current');
            await page.evaluate(() => { stock.log.length = 0; stock.fire('asc_onCountPages', 5); });
            await H.settle(page);
            s = await state(page);
            assert.deepEqual([s.rows, s.current], [['1', '2', '3', '4', '5'], [1]], 'five pages');
            const t = await thumbs(page);
            assert.deepEqual([t.count, t.canvases, t.drawn], [5, 5, [0, 1, 2, 3, 4]], 'thumbnails of the new rows');
            await page.evaluate(() => stock.fire('asc_onCountPages', 2));
            await H.settle(page);
            assert.deepEqual((await state(page)).rows, ['1', '2'], 'two pages');
            clean(page);
            await page.close();
        });

        await check('thumbnails: the file draws a page on white paper, in screen density, at the page proportions', async () => {
            const size = page => page.evaluate(() => Array.from(document.querySelectorAll('#vo-nav-rail canvas.vo-nav-thumb')).map(c => {
                const b = c.getBoundingClientRect();
                return [c.width, c.height, Math.round(b.width), Math.round(b.height)];
            }));
            let page = await view(browser);
            assert.deepEqual(await page.evaluate(() => stock.calls('file', 'getPage')), [], 'thumbnails drawn for the pill');
            await openNav(page);
            assert.deepEqual(await page.evaluate(() => stock.calls('file', 'getPage')),
                [0, 1, 2].map(i => [i, THUMB_W, THUMB_H, true, PAPER]), 'getPage');
            assert.deepEqual(await size(page), Array(3).fill([THUMB_W, THUMB_H, THUMB_W, THUMB_H]), 'canvas and box');
            clean(page);
            await page.close();
            page = await view(browser, {before: () => Object.defineProperty(window, 'devicePixelRatio', {configurable: true, get: () => 2})});
            await openNav(page);
            assert.deepEqual(await page.evaluate(() => stock.calls('file', 'getPage').map(c => c.slice(1, 3))),
                Array(3).fill([THUMB_W * 2, THUMB_H * 2]), 'getPage at density 2');
            assert.deepEqual(await size(page), Array(3).fill([THUMB_W * 2, THUMB_H * 2, THUMB_W, THUMB_H]), 'canvas and box at density 2');
            clean(page);
            await page.close();
        });

        await check('thumbnails: only the visible rows and a few ahead are drawn, the rest as the list scrolls', async () => {
            const page = await view(browser, {pages: 40});
            await openNav(page);
            await still(page);
            /* Rows more than 6 rows away from every view of the list (4 drawn ahead, 2 of slack). */
            const far = (rows, views) => rows.filter(i => views.every(v => i < v[0] - 6 || i > v[v.length - 1] + 6));
            const all = Array.from({length: 40}, (_, i) => i);
            let t = await thumbs(page);
            assert.ok(t.seen.length >= 3 && t.seen[0] === 0, 'the list does not show its first rows: ' + t.seen);
            assert.deepEqual(t.seen.filter(i => !t.drawn.includes(i)), [], 'visible rows not drawn');
            const first = t.seen;
            assert.ok(far(all, [first]).length > 20, 'the list shows too many rows to tell: ' + first);
            assert.deepEqual(far(t.drawn, [first]), [], 'rows far below the list are drawn');
            assert.deepEqual(far(t.asked, [first]), [], 'the file is asked for rows far below the list');
            await page.evaluate(() => {
                const list = document.querySelector('#vo-nav-rail .vo-nav-list'), row = list.querySelector('[data-page="30"]');
                list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top;
            });
            await H.settle(page);
            await H.settle(page);
            t = await thumbs(page);
            assert.equal(t.seen[0], 30, 'the list is not scrolled to row 31');
            assert.deepEqual(t.seen.filter(i => !t.drawn.includes(i)), [], 'visible rows not drawn after scrolling');
            const gap = far(all, [first, t.seen]);
            assert.ok(gap.length >= 5, 'no rows between the two views: ' + gap);
            assert.deepEqual(gap.filter(i => t.drawn.includes(i) || t.asked.includes(i)), [], 'rows between the two views are drawn');
            /* The current page that goes below the list is scrolled into view and drawn. */
            await page.evaluate(() => { document.querySelector('#vo-nav-rail .vo-nav-list').scrollTop = 0; });
            await H.settle(page);
            await page.evaluate(() => stock.fire('asc_onCurrentPage', 20));
            await H.settle(page);
            await H.settle(page);
            t = await thumbs(page);
            assert.ok(t.seen.includes(20), 'the current row below the list is not scrolled into view: ' + t.seen);
            assert.ok(t.drawn.includes(20), 'the current row scrolled into view is not drawn');
            /* The current page above the list: the list goes up until its row is wholly inside. */
            await page.evaluate(() => { document.querySelector('#vo-nav-rail .vo-nav-list').scrollTop = 1e6; });
            await H.settle(page);
            await page.evaluate(() => stock.fire('asc_onCurrentPage', 0));
            await H.settle(page);
            const up = await page.evaluate(() => {
                const list = document.querySelector('#vo-nav-rail .vo-nav-list').getBoundingClientRect();
                const row = document.querySelector('#vo-nav-rail [data-page="0"]').getBoundingClientRect();
                return {top: Math.round(row.top - list.top), bottom: Math.round(list.bottom - row.bottom)};
            });
            assert.ok(up.top >= 0 && up.bottom >= 0, 'the current row above the list is not wholly inside: ' + JSON.stringify(up));
            clean(page);
            await page.close();
        });

        /* Every sync asks the file again for a page it has not given yet, and a sync may come from the
           layout too (the fit after the column opens runs on a timer), so the blank page is asked at
           least once per step; a drawn page is never asked again. */
        const asks = asked => [0, 1, 2].map(i => asked.filter(n => n === i).length);
        await check('thumbnails: a page the file does not give yet stays blank and is drawn on a later sync', async () => {
            const page = await view(browser, {unloaded: [1]});
            await openNav(page);
            let t = await thumbs(page), n = asks(t.asked);
            assert.deepEqual([t.drawn, n[0], n[2], n[1] >= 1], [[0, 2], 1, 1, true], 'a page not loaded: ' + JSON.stringify(t.asked));
            await page.evaluate(() => { stock.log.length = 0; stock.fire('asc_onDocumentContentReady'); });
            await H.settle(page);
            await H.settle(page);
            t = await thumbs(page);
            n = asks(t.asked);
            assert.deepEqual([t.drawn, n[0], n[2], n[1] >= 1], [[0, 2], 0, 0, true],
                'the next sync: only the blank page is asked again: ' + JSON.stringify(t.asked));
            await page.evaluate(() => { stock.log.length = 0; });
            await load(page, 1);
            await page.evaluate(() => stock.fire('asc_onDocumentContentReady'));
            await H.settle(page);
            await H.settle(page);
            t = await thumbs(page);
            n = asks(t.asked);
            assert.deepEqual([t.drawn, n[0], n[2], n[1] >= 1], [[0, 1, 2], 0, 0, true], 'the page loaded is not drawn: ' + JSON.stringify(t.asked));
            await page.evaluate(() => { stock.log.length = 0; stock.fire('asc_onDocumentContentReady'); });
            await H.settle(page);
            await H.settle(page);
            assert.deepEqual((await thumbs(page)).asked, [], 'a drawn page is asked again');
            clean(page);
            await page.close();
        });

        /* The engine repaints the pages whose fonts came: it calls onRepaintPages of its file with
           their numbers. */
        const repaint = (page, pages) => page.evaluate(pages => {
            stock.log.length = 0;
            stock.api.getDocumentRenderer().file.onRepaintPages(pages);
        }, pages);
        await check('thumbnails: the pages the engine repaints after their fonts load are drawn again, the others are not; the stock handler runs once', async () => {
            const page = await view(browser);
            await openNav(page);
            await repaint(page, [1]);
            await H.settle(page);
            let t = await thumbs(page);
            assert.deepEqual([t.asked, t.drawn], [[1], [0, 1, 2]], 'page 2 repainted by the engine');
            assert.deepEqual(await page.evaluate(() => stock.calls('file', 'onRepaintPages')), [[[1]]], 'the stock handler');
            /* Repainted while the panel is closed: drawn again when it opens. */
            await page.click('#vo-nav-rail .vo-nav-hide');
            await H.settle(page);
            await repaint(page, [2]);
            await H.settle(page);
            assert.deepEqual(await page.evaluate(() => stock.calls('file', 'getPage')), [], 'drawn while the panel is closed');
            await page.click('#vo-nav-pill');
            await H.settle(page);
            t = await thumbs(page);
            assert.deepEqual([t.asked, t.drawn], [[2], [0, 1, 2]], 'page 3 repainted while closed, then opened');
            clean(page);
            await page.close();
        });

        await check('thumbnails: a file the engine opens again draws all the visible rows anew, at the same page count too; the old file keeps only the stock handler', async () => {
            const page = await view(browser);
            await openNav(page);
            /* The new file does not give page 2 yet: its row is blank, not the page of the old file. */
            await page.evaluate(() => {
                stock.log.length = 0;
                const r = stock.api.getDocumentRenderer(), next = stock.newFile('file2'), get = next.getPage;
                window.oldFile = r.file;
                window.hold = true;
                next.getPage = function (i) { return hold && i === 1 ? (stock.note('file2', 'getPage', [i]), null) : get.apply(this, arguments); };
                r.file = next;
                stock.fire('asc_onDocumentContentReady');
            });
            await H.settle(page);
            await H.settle(page);
            const rows = () => page.evaluate(() => {
                const width = r => r.querySelector('canvas.vo-nav-thumb').width;
                return Array.from(document.querySelectorAll('#vo-nav-rail .vo-nav-row')).map(width);
            });
            let asked = await page.evaluate(() => [stock.calls('file', 'getPage').length,
                Array.from(new Set(stock.calls('file2', 'getPage').map(c => c[0])))]);
            assert.deepEqual(asked, [0, [0, 1, 2]], 'asc_onDocumentContentReady with a new file');
            assert.deepEqual(await rows(), [THUMB_W, 0, THUMB_W], 'the canvases of the new file');
            await page.evaluate(() => { hold = false; stock.fire('asc_onDocumentContentReady'); });
            await H.settle(page);
            await H.settle(page);
            assert.deepEqual(await rows(), [THUMB_W, THUMB_W, THUMB_W], 'page 2 of the new file loaded');
            /* The old file: the stock handler alone; the new one repaints the panel. */
            await page.evaluate(() => { stock.log.length = 0; oldFile.onRepaintPages([0]); });
            await H.settle(page);
            assert.deepEqual(await page.evaluate(() => [stock.calls('file', 'onRepaintPages'), stock.calls('file2', 'getPage')]),
                [[[[0]]], []], 'the old file repaints');
            await repaint(page, [2]);
            await H.settle(page);
            assert.deepEqual(await page.evaluate(() => [stock.calls('file2', 'onRepaintPages'), stock.calls('file2', 'getPage').map(c => c[0])]),
                [[[[2]]], [2]], 'the new file repaints');
            /* Opened again with the same page count: asc_onCountPages alone. */
            await page.evaluate(() => {
                stock.log.length = 0;
                stock.api.getDocumentRenderer().file = stock.newFile('file3');
                stock.fire('asc_onCountPages', 3);
            });
            await H.settle(page);
            asked = await page.evaluate(() => [stock.calls('file2', 'getPage').length, stock.calls('file3', 'getPage').map(c => c[0])]);
            assert.deepEqual(asked, [0, [0, 1, 2]], 'asc_onCountPages with a new file');
            assert.deepEqual(await rows(), [THUMB_W, THUMB_W, THUMB_W], 'the canvases of the third file');
            clean(page);
            await page.close();
        });

        await check('thumbnails: a repaint handler the engine sets again on the same file is wrapped again, the stock one runs once', async () => {
            const page = await view(browser);
            await openNav(page);
            /* The viewer puts its handler into the file again (onDocumentReady): the file object is the same. */
            await page.evaluate(() => {
                const file = stock.api.getDocumentRenderer().file;
                window.again = [];
                file.onRepaintPages = function (pages) { window.again.push(JSON.stringify(pages)); };
                stock.fire('asc_onCountPages', 3);
            });
            await H.settle(page);
            await H.settle(page);
            await repaint(page, [1]);
            await H.settle(page);
            const t = await thumbs(page);
            assert.deepEqual(await page.evaluate(() => window.again), ['[1]'], 'the new stock handler');
            assert.deepEqual(await page.evaluate(() => stock.calls('file', 'onRepaintPages')), [], 'the replaced handler');
            assert.deepEqual([t.asked, t.drawn], [[1], [0, 1, 2]], 'page 2 repainted by the engine');
            clean(page);
            await page.close();
        });

        await check('thumbnails: a failure of the panel on a repaint does not stop the stock handler nor reach the engine', async () => {
            const page = await view(browser);
            await openNav(page);
            const r = await page.evaluate(() => {
                PDFE.Views.NavigationPanel.invalidate = function () { throw new Error('broken'); };
                stock.log.length = 0;
                let threw = false;
                try { stock.api.getDocumentRenderer().file.onRepaintPages([1]); } catch (e) { threw = true; }
                return {threw, stock: stock.calls('file', 'onRepaintPages')};
            });
            assert.deepEqual(r, {threw: false, stock: [[[1]]]}, 'the repaint with the panel broken');
            assert.deepEqual(page.errors, [], 'page errors');
            assert.deepEqual(page.warnings.map(w => w.split(' failed')[0]), ['Compact shell: "navigation: repaint pages"'], 'the warning');
            await page.close();
        });

        await check('thumbnails: destroy() gives the file its stock handler back; a file without the handler is left as it is', async () => {
            let page = await view(browser, {before: () => { window.stockRepaint = stock.api.getDocumentRenderer().file.onRepaintPages; }});
            await openNav(page);
            assert.equal(await page.evaluate(() => stock.api.getDocumentRenderer().file.onRepaintPages === stockRepaint), false,
                'the panel does not follow the repaints');
            await page.evaluate(() => PDFE.Views.NavigationPanel.destroy());
            assert.equal(await page.evaluate(() => stock.api.getDocumentRenderer().file.onRepaintPages === stockRepaint), true,
                'the stock handler after destroy()');
            clean(page);
            await page.close();
            page = await view(browser, {before: () => { delete stock.api.getDocumentRenderer().file.onRepaintPages; }});
            await openNav(page);
            const t = await thumbs(page);
            assert.deepEqual([t.drawn, await page.evaluate(() => 'onRepaintPages' in stock.api.getDocumentRenderer().file)],
                [[0, 1, 2], false], 'a file without onRepaintPages');
            clean(page);
            await page.close();
        });

        await check('without the thumbnails right: names only; nothing to show — no pill and no opening until bookmarks come', async () => {
            let page = await view(browser, {rights: {canUseThumbnails: false}, bookmarks: BOOKMARKS, pages: 4, page: 1});
            await fitted(page);
            assert.deepEqual(await state(page), OPEN, 'names from bookmarks');
            const t = await thumbs(page);
            assert.deepEqual([t.canvases, t.asked], [0, []], 'thumbnails without the right');
            await still(page);
            const line = await page.evaluate(() => {
                const area = document.getElementById('editor-container').getBoundingClientRect().left;
                return {area, bar: document.getElementById('vo-tb').getBoundingClientRect().left,
                    names: Array.from(document.querySelectorAll('#vo-nav-rail .vo-nav-name')).map(n => n.getBoundingClientRect().left)};
            });
            assert.equal(line.names.length, 4, 'names');
            line.names.forEach(x => {
                near(x - line.area, 20, 'a name from the left of the document field');
                near(x, line.bar, 'a name from the left line of the bar');
            });
            clean(page);
            await page.close();
            page = await view(browser, {rights: {canUseThumbnails: false}});
            let s = await state(page);
            assert.deepEqual([s.pill, s.nav, s.rail], ['hidden', false, false], 'no thumbnails right, no bookmarks');
            await bookmarks(page, [{description: 'Intro', level: 0, page: 0}]);
            await fitted(page);
            s = await state(page);
            assert.deepEqual([s.rail, s.rows, s.pill, s.pressed], [true, ['Intro', '2', '3'], 'hidden', []], 'bookmarks that came later');
            clean(page);
            await page.close();
        });

        await check('bookmarks that come later rename the rows in place; without them the rows are numbers again', async () => {
            const page = await view(browser, {pages: 4});
            await openNav(page);
            assert.deepEqual((await state(page)).rows, ['1', '2', '3', '4'], 'a PDF without bookmarks');
            await page.evaluate(() => {
                stock.log.length = 0;
                document.querySelectorAll('#vo-nav-rail .vo-nav-row').forEach(r => { r.voKept = true; });
            });
            await bookmarks(page, BOOKMARKS);
            await H.settle(page);
            assert.deepEqual((await state(page)).rows, NAMED, 'bookmarks that came later');
            assert.deepEqual(await page.evaluate(() => [Array.from(document.querySelectorAll('#vo-nav-rail .vo-nav-row')).every(r => r.voKept),
                stock.calls('file', 'getPage').length]), [true, 0], 'the rows are built or drawn again');
            await bookmarks(page, null);
            await H.settle(page);
            assert.deepEqual((await state(page)).rows, ['1', '2', '3', '4'], 'bookmarks removed');
            /* Bookmarks that come while the panel is closed are there when it opens. */
            await page.click('#vo-nav-rail .vo-nav-hide');
            await H.settle(page);
            await bookmarks(page, BOOKMARKS);
            await H.settle(page);
            await page.click('#vo-nav-pill');
            await H.settle(page);
            assert.deepEqual((await state(page)).rows, NAMED, 'bookmarks that came while closed');
            clean(page);
            await page.close();
        });

        await check('stock panels of the left menu work beside the column: they take the left menu, the column goes along with the document area', async () => {
            /* A narrow page leaves a wide field also beside a stock panel (300 and its border):
               floor((979 − 400) / 2 − 24) = 265. */
            const page = await view(browser, {bookmarks: BOOKMARKS, pages: 4, page: 1, comments: [{text: 'A note'}],
                renderer: {documentWidth: 400}});
            await fitted(page);
            await page.click('#vo-tb [data-vo="more"]');
            await page.click('#vo-tb [data-k="view.comments"]');
            await fitted(page);
            let s = await state(page);
            assert.deepEqual([s.open, s.menu, s.icons, s.pressed, s.area], [true, true, false, ['btnComments'], [LEFT_W + 1, WIN - LEFT_W - 1]], 'Comments');
            assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('left-menu')).borderRightWidth), '1px',
                'the comments panel lost the border of the left menu');
            assert.deepEqual([s.nav, s.rail, s.rows], [true, true, NAMED], 'the column beside the comments');
            let box = await railBox(page);
            assert.deepEqual([box.left, box.width], [0, 265], 'the column does not go along with the document area');
            await stockToggle(page, 'btnSearchBar', true);
            await fitted(page);
            s = await state(page);
            assert.deepEqual([s.open, s.pressed, s.nav], [true, ['btnSearchBar'], true], 'the advanced search');
            /* The stock thumbnails panel opened by the stock code is shown as it is. */
            await stockToggle(page, 'btnThumbnails', true);
            await fitted(page);
            s = await state(page);
            assert.deepEqual([s.open, s.pressed, s.panels, s.nav], [true, ['btnThumbnails'], ['left-panel-thumbnails'], true],
                'the stock thumbnails panel');
            /* All closed past the shell: the room is back, the column at the left of the window. */
            await stockToggle(page, 'btnThumbnails', false);
            await fitted(page);
            s = await state(page);
            assert.deepEqual([s.open, s.menu, s.pressed, s.area, s.nav], [false, false, [], [0, WIN], true], 'the stock way of closing');
            box = await railBox(page);
            assert.deepEqual([box.left, box.width], [0, RAIL_W], 'the column after the stock panel closed');
            clean(page);
            await page.close();
        });

        await check('the chat does not open in the shell', async () => {
            const page = await view(browser);
            await page.evaluate(() => { stock.log.length = 0; });
            await stockToggle(page, 'btnChat', true);
            await fitted(page);
            assert.deepEqual(await state(page), CLOSED, 'the chat');
            assert.deepEqual(await page.evaluate(() => stock.calls('stock', 'click').map(c => c[0])), ['btnChat'], 'the chat is not closed by its button');
            clean(page);
            await page.close();
        });
    } finally {
        await browser.close();
    }
    done();
})().catch(e => { console.log('FAIL run —', e && e.stack || e); process.exitCode = 1; });
