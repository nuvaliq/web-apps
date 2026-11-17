/*
 * NavigationPanel — the "Navigation" panel of the PDF viewer in the "Compact" shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * One column on the left: a row for each page — the page thumbnail and its
 * name. The name is the first PDF bookmark leading to this page (the stock
 * asc_onViewerBookmarksUpdate handler puts the bookmarks into
 * Navigation._viewerNavigationObject: page, level, description); for a page without
 * a bookmark and in a PDF without bookmarks — the page number. The current page is marked,
 * a click on a row goes to the page with the stock goToPage.
 *
 * The collapsed panel is the pill button #vo-nav-pill with a list icon: it hangs on the left
 * under the bar over the document field. The expanded one is the column #vo-nav-rail: at the top
 * the "‹" arrow, below it the list. The pill and the arrow open and close the panel
 * (the shell command navigation).
 *
 * Both lie in #editor-container over the margin to the left of the page and take no room in the
 * layout: opening and closing change neither the document area nor the
 * page position. The stock layout moves #editor-container when it opens the
 * left panel (comments, search) — the column and the pill move together with it.
 * The column width is the margin to the left of the page (the engine renderer: width — the area,
 * documentWidth — the widest page) without the gap before the page, not wider than
 * RAIL_W. When the margin is narrower than RAIL_MIN (large zoom, narrow window), the column collapses
 * into the pill by itself, when it is wider again — it expands; a press on the pill or the arrow
 * overrides this rule until the margin moves to another band. A column expanded by a press on a narrow
 * margin lies over the page edge on a backing in the margin color.
 *
 * By itself the panel is expanded only if the PDF has bookmarks; without them it is
 * collapsed into the pill and opens on a press.
 *
 * The thumbnails are drawn by the engine: renderer.file.getPage(number, width, height) returns
 * a canvas of the page at the needed size. Only the visible rows are drawn — on
 * opening, on list scrolling and on a document change, at the screen density. Without the
 * thumbnails right (canUseThumbnails) the rows have names only.
 *
 * A drawn thumbnail is drawn again in two cases. The engine opens the document again (the
 * reopen after a reconnect closes the file and creates a new renderer.file): on a new file every
 * row is cleared and the visible ones are drawn from it. The engine repaints the pages whose fonts
 * came: the viewer puts its handler into the onRepaintPages property of the file when the
 * document is ready, and the engine calls it with the page numbers. The api has no event for
 * this, so the panel relies on this internal contract of the engine: it wraps the handler of the
 * current file — the stock handler runs first and as before, then the rows of those pages are
 * drawn again — and gives the handler back on destroy(). Without a file or without onRepaintPages
 * the panel works as it did, the thumbnails are drawn once.
 *
 * The frame (CompactShell) installs the panel by calling create(shell, api) and removes it on
 * rollback by calling destroy().
 */
define([], function () {
    'use strict';

    if (window.PDFE === undefined) window.PDFE = {};
    if (PDFE.Views === undefined) PDFE.Views = {};

    var PILL_ID = 'vo-nav-pill', RAIL_ID = 'vo-nav-rail';
    var OPEN_CLASS = 'vo-nav-open';

    /* The column is as wide as the margin to the left of the page: not narrower than RAIL_MIN and
       not wider than RAIL_W, with a GAP_TO_PAGE gap before the page. Collapse — below RAIL_MIN, expand —
       above RAIL_MIN + RAIL_HYST: with a single threshold the state would flicker while the window
       is dragged across the boundary. RAIL_W is paired with @vo-nav-rail-w in compact-shell.less.
       RAIL_MIN — the thumbnail and the row padding plus room for a short name. */
    var RAIL_W = 300, RAIL_MIN = 180, RAIL_HYST = 20, GAP_TO_PAGE = 24;

    /* The thumbnail width in CSS pixels — paired with @vo-nav-thumb-w in
       compact-shell.less; the height follows the page sides. While the page size is
       unknown — the sides of an A4 sheet. */
    var THUMB_W = 32;
    var PAGE_RATIO = 297 / 210;
    var PAPER = 0xFFFFFF;

    /* How many rows beyond the list edge to draw in advance, so that scrolling does not
       show blank sheets. */
    var AHEAD = 4;

    function ctl(name) {
        try { return (PDFE.getController && PDFE.getController(name)) || null; } catch (e) { return null; }
    }

    function icon(name, size) {
        var C = window.Common && Common.UI && Common.UI.Compact, I = C && C.Icons;
        try { return I && typeof I.svg === 'function' ? I.svg(name, size) || '' : ''; } catch (e) { return ''; }
    }

    function el(tag, cls, attrs) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        Object.keys(attrs || {}).forEach(function (k) {
            if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
        });
        return n;
    }

    PDFE.Views.NavigationPanel = _.extend({

        shell: null,
        api: null,
        pill: null,          // the collapsed panel: the button over the document field
        rail: null,          // the expanded panel: the column over the margin to the left of the page
        list: null,          // the page rows
        rows: null,          // a row per page
        page: 0,             // the current page, zero-based
        pages: 0,            // the page count
        syncing: false,
        opened: false,       // whether the column is expanded
        manual: null,        // null | 'open' | 'closed' — a press, while the margin stays in the same band
        regime: 'wide',      // 'wide' | 'narrow' — the band of the margin to the left of the page
        frame: 0,            // the requested frame for drawing the visible thumbnails
        file: null,          // the engine file the thumbnails are drawn from
        fitTimer: 0,         // the deferred recalculation of the space
        onLayout: null,
        onResize: null,

        create: function (shell, api) {
            var me = this;
            this.shell = shell;
            this.api = api || null;
            this.opened = false;
            this.manual = null;
            this.regime = 'wide';
            this.render();
            if (api && typeof api.asc_registerCallback === 'function') {
                /* After the stock handler: by the time of our call the bookmarks already
                   lie in the navigation controller. The bookmarks decide whether the
                   panel is expanded by itself. */
                api.asc_registerCallback('asc_onViewerBookmarksUpdate', this.guard('bookmarks', function () {
                    setTimeout(me.guard('bookmarks names', function () { me.fillNames(); me.fit(); }), 0);
                }));
                /* The stock code sets the bookmarks and the page count around
                   the document readiness; on it — one more sync. */
                api.asc_registerCallback('asc_onDocumentContentReady', this.guard('document ready', function () {
                    setTimeout(me.guard('document ready sync', function () {
                        if (me.checkFile()) me.drawSoon();
                        me.readPages();
                        me.fit();
                    }), 0);
                }));
                /* The margin to the left of the page depends on the zoom; the engine does not move
                   the page at once, so the recalculation is delayed. */
                api.asc_registerCallback('asc_onZoomChange', this.guard('zoom', function () { me.fitSoon(); }));
                /* A reopened file comes with its page count, which may be the same. */
                api.asc_registerCallback('asc_onCountPages', this.guard('page count', function (count) {
                    if (me.checkFile()) me.drawSoon();
                    me.setPages(count);
                }));
                api.asc_registerCallback('asc_onCurrentPage', this.guard('current page', function (page) {
                    me.setCurrent(page);
                }));
            }
            /* The left panel of the stock menu and the window size change the document area,
               and with it the margin to the left of the page. */
            this.onLayout = this.guard('layout:changed', function () { me.fitSoon(); });
            Common.NotificationCenter.on('layout:changed', this.onLayout);
            /* Through jQuery: the frame sends resize with it too after a layout change. */
            this.onResize = this.guard('resize', function () { me.fitSoon(); });
            $(window).on('resize', this.onResize);
            this.readPages();
            this.fit();
            return this;
        },

        destroy: function () {
            if (this.onLayout) Common.NotificationCenter.off('layout:changed', this.onLayout);
            if (this.onResize) $(window).off('resize', this.onResize);
            this.onLayout = this.onResize = null;
            clearTimeout(this.fitTimer);
            this.fitTimer = 0;
            this.opened = false;
            this.manual = null;
            if (this.frame && window.cancelAnimationFrame) window.cancelAnimationFrame(this.frame);
            this.frame = 0;
            this.unhook();
            this.file = null;
            [this.pill, this.rail].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
            this.pill = this.rail = this.list = null;
            this.rows = null;
            document.body.classList.remove(OPEN_CLASS);
        },

        guard: function (label, fn) {
            var shell = this.shell;
            return shell && typeof shell.guarded === 'function' ? shell.guarded('navigation: ' + label, fn) : fn;
        },

        engine: function () {
            var shell = this.shell;
            return this.api || (shell && typeof shell.engineApi === 'function' ? shell.engineApi() : null);
        },

        /* --- Markup ----------------------------------------------------------------- */

        render: function () {
            var me = this, tip = this.tipNavigation();
            var area = document.getElementById('editor-container');
            if (area && !(this.pill && this.pill.parentNode === area)) {
                var pill = el('button', 'vo-ib', {id: PILL_ID, type: 'button', 'data-vo': 'navigation', title: tip,
                    'aria-label': tip, 'aria-expanded': 'false', 'aria-controls': RAIL_ID});
                pill.insertAdjacentHTML('beforeend', icon('outline'));
                pill.addEventListener('click', this.guard('pill', function () { me.toggle(); }));
                area.appendChild(pill);
                this.pill = pill;
            }
            if (area && !(this.rail && this.rail.parentNode === area)) {
                var rail = el('div', null, {id: RAIL_ID, role: 'navigation', 'aria-label': tip});
                var hide = el('button', 'vo-ib vo-nav-hide', {type: 'button', 'data-vo': 'navigationHide', title: tip,
                    'aria-label': tip, 'aria-expanded': 'true', 'aria-controls': RAIL_ID});
                hide.insertAdjacentHTML('beforeend', icon('chevronL', 18));
                hide.addEventListener('click', this.guard('hide', function () { me.toggle(); }));
                var list = el('div', 'vo-nav-list');
                list.addEventListener('scroll', this.guard('list scroll', function () { me.drawSoon(); }), {passive: true});
                /* The wheel over the list scrolls the list, not the document under it. */
                ['wheel', 'mousewheel', 'DOMMouseScroll'].forEach(function (name) {
                    list.addEventListener(name, function (e) { e.stopPropagation(); }, {passive: true});
                });
                rail.appendChild(hide);
                rail.appendChild(list);
                area.insertBefore(rail, this.pill || null);
                this.rail = rail;
                this.list = list;
                this.rows = null;
            }
            return this.rail;
        },

        /* Rows — by the page count; in existing ones only the names change (and the thumbnails,
           if the file is new). */
        build: function () {
            var me = this, list = this.list;
            if (!list) return;
            this.checkFile();
            if (this.rows && this.rows.length === this.pages) { this.fillNames(); return; }
            while (list.firstChild) list.removeChild(list.firstChild);
            this.rows = [];
            var thumbs = this.canThumbs();
            for (var i = 0; i < this.pages; i++) {
                var row = el('button', 'vo-nav-row', {type: 'button', 'data-page': String(i)});
                if (thumbs) {
                    var c = el('canvas', 'vo-nav-thumb', {'aria-hidden': 'true'});
                    c.style.height = this.thumbHeight(i) + 'px';
                    row.appendChild(c);
                }
                row.appendChild(el('span', 'vo-nav-name'));
                row.addEventListener('click', this.guard('row', (function (n) {
                    return function () { me.go(n); };
                })(i)));
                list.appendChild(row);
                this.rows.push({el: row, drawn: false});
            }
            this.fillNames();
            this.markCurrent(false);
        },

        /* The row name is the first bookmark leading to the page; otherwise the number. */
        names: function () {
            var nav = ctl('Navigation'), marks = nav && nav._viewerNavigationObject, out = {};
            (marks && marks.length ? marks : []).forEach(function (m) {
                var text = m && typeof m.description === 'string' ? m.description.trim() : '';
                var p = m ? Number(m.page) : NaN;
                if (text && p >= 0 && out[p] === undefined) out[p] = text;
            });
            return out;
        },

        fillNames: function () {
            var map = this.names();
            (this.rows || []).forEach(function (r, i) {
                var name = map[i] !== undefined ? map[i] : String(i + 1);
                var span = r.el.querySelector('.vo-nav-name');
                if (span && span.textContent !== name) span.textContent = name;
            });
        },

        /* --- Thumbnails ------------------------------------------------------------- */

        renderer: function () {
            var api = this.engine();
            try { return api && typeof api.getDocumentRenderer === 'function' ? api.getDocumentRenderer() : null; } catch (e) { return null; }
        },

        thumbHeight: function (i) {
            var f = this.renderer(), file = f && f.file, ratio = PAGE_RATIO;
            try {
                var w = file && file.getPageWidth && file.getPageWidth(i), h = file && file.getPageHeight && file.getPageHeight(i);
                if (w > 0 && h > 0) ratio = h / w;
            } catch (e) { /* the sheet sides remain */ }
            return Math.round(THUMB_W * ratio);
        },

        drawSoon: function () {
            var me = this;
            if (this.frame || !window.requestAnimationFrame) { if (!this.frame) this.drawVisible(); return; }
            this.frame = window.requestAnimationFrame(this.guard('draw thumbs', function () {
                me.frame = 0;
                me.drawVisible();
            }));
        },

        /* The visible rows of the list and AHEAD rows beyond each of its edges. */
        drawVisible: function () {
            this.checkFile();
            var list = this.list, rows = this.rows || [];
            if (!list || !rows.length || !this.isOpen() || !this.canThumbs()) return;
            var top = list.scrollTop, bottom = top + list.clientHeight, first = -1, last = -1;
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i].el, y = r.offsetTop, h = r.offsetHeight;
                if (y + h >= top && y <= bottom) { if (first < 0) first = i; last = i; }
                else if (first >= 0) break;
            }
            if (first < 0) return;
            for (var j = Math.max(0, first - AHEAD); j <= Math.min(rows.length - 1, last + AHEAD); j++) this.drawThumb(j);
        },

        drawThumb: function (i) {
            var row = this.rows && this.rows[i];
            if (!row || row.drawn) return false;
            var c = row.el.querySelector('canvas.vo-nav-thumb');
            var f = this.renderer(), file = f && f.file;
            if (!c || !file || typeof file.getPage !== 'function') return false;
            var dpr = window.devicePixelRatio || 1;
            var w = Math.round(THUMB_W * dpr), h = Math.round(this.thumbHeight(i) * dpr);
            var img = file.getPage(i, w, h, true, PAPER);
            if (!img) return false;   // the page is not loaded yet — it will be drawn on the next sync
            c.width = w;
            c.height = h;
            c.style.height = Math.round(h / dpr) + 'px';
            var ctx = c.getContext('2d');
            if (ctx) ctx.drawImage(img, 0, 0, w, h);
            row.drawn = true;
            return true;
        },

        canThumbs: function () {
            var a = PDFE.Views.PdfActions;
            return !(a && typeof a.canThumbnails === 'function' && !a.canThumbnails());
        },

        /* The file of the renderer against the one the thumbnails came from. A new one: the
           handler goes back to the old file, every row is cleared (the canvas keeps its box and
           shows no page of the old file) and waits for drawing. Returns whether the file is new.
           Each time the repaints of the current file are followed — the viewer may put its
           handler in again. */
        checkFile: function () {
            var f = this.renderer(), file = (f && f.file) || null, changed = file !== this.file;
            if (changed) {
                this.unhook();
                this.file = file;
                (this.rows || []).forEach(function (r) {
                    var c = r.el.querySelector('canvas.vo-nav-thumb');
                    if (c) c.width = 0;
                    r.drawn = false;
                });
            }
            this.hook();
            return changed;
        },

        /* The stock handler first and outside our guard: a failure of the panel neither stops it
           nor reaches the engine. The wrapper keeps the stock handler in _voNav: it is not wrapped
           twice and is given back by unhook(). */
        hook: function () {
            var me = this, file = this.file, stock = file && file.onRepaintPages;
            if (typeof stock !== 'function' || stock._voNav) return;
            var ours = this.guard('repaint pages', function (pages) { if (me.file === file) me.invalidate(pages); });
            var wrapper = function () {
                var out = stock.apply(this, arguments);
                ours.apply(this, arguments);
                return out;
            };
            wrapper._voNav = stock;
            file.onRepaintPages = wrapper;
        },

        unhook: function () {
            var file = this.file, h = file && file.onRepaintPages;
            if (h && h._voNav) file.onRepaintPages = h._voNav;
        },

        /* Pages the engine repainted: their rows are drawn again. */
        invalidate: function (pages) {
            var rows = this.rows;
            if (!rows || !pages || !pages.length) return;
            for (var i = 0; i < pages.length; i++) if (rows[pages[i]]) rows[pages[i]].drawn = false;
            this.drawSoon();
        },

        /* --- Pages ------------------------------------------------------------------ */

        readPages: function () {
            var api = this.engine(), count = this.pages, page = this.page;
            try {
                if (api && typeof api.getCountPages === 'function') count = api.getCountPages();
                if (api && typeof api.getCurrentPage === 'function') page = api.getCurrentPage();
            } catch (e) { /* the previous ones remain */ }
            this.page = Math.max(0, Number(page) || 0);
            this.setPages(count);
        },

        setPages: function (count) {
            var n = Math.max(0, Number(count) || 0);
            if (n === this.pages && this.rows && this.rows.length === n) return;
            this.pages = n;
            if (this.isOpen()) { this.build(); this.drawSoon(); }
            else this.rows = this.rows && this.rows.length === n ? this.rows : null;
        },

        setCurrent: function (page) {
            this.page = Math.max(0, Number(page) || 0);
            this.markCurrent(true);
        },

        /* The current row is marked; the open list scrolls to it if it has gone
           beyond the edge. */
        markCurrent: function (follow) {
            var me = this, rows = this.rows || [];
            rows.forEach(function (r, i) {
                var on = i === me.page;
                r.el.classList.toggle('on', on);
                if (on) r.el.setAttribute('aria-current', 'page'); else r.el.removeAttribute('aria-current');
            });
            var row = rows[this.page], list = this.list;
            if (!follow || !row || !list || !this.isOpen()) return;
            var y = row.el.offsetTop, h = row.el.offsetHeight;
            if (y < list.scrollTop) list.scrollTop = y;
            else if (y + h > list.scrollTop + list.clientHeight) list.scrollTop = y + h - list.clientHeight;
        },

        go: function (i) {
            var api = this.engine();
            if (api && typeof api.goToPage === 'function') api.goToPage(i);
            this.setCurrent(i);
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* --- State ------------------------------------------------------------------ */

        hasOutline: function () {
            var nav = ctl('Navigation'), list = nav && nav._viewerNavigationObject;
            return !!(list && list.length);
        },

        isOpen: function () {
            return !!this.opened && !!this.rail;
        },

        /* Whether there is anything to show: page thumbnails or their names from the bookmarks. */
        usable: function () {
            return !!this.rail && (this.canThumbs() || this.hasOutline());
        },

        /* After a startup failure there is no panel (advanced is the shell flag the shared
           layer reads; it is always false). */
        active: function () {
            var shell = this.shell;
            return !(shell && (shell.advanced || shell.startupFailed));
        },

        /* --- Space ------------------------------------------------------------------ */

        /* The margin to the left of the widest page, in CSS pixels from the left edge of the
           column, without the gap before the page. The engine centers the pages in its
           area: width — its width, documentWidth — that of the widest page at the
           current zoom; the area starts at the engine canvas. No data — null. */
        railSpace: function () {
            var vw = this.renderer(), host = this.rail && this.rail.parentNode;
            try {
                if (!vw || !(vw.width > 0)) return null;
                var shift = 0;
                if (vw.canvas && host && typeof vw.canvas.getBoundingClientRect === 'function')
                    shift = vw.canvas.getBoundingClientRect().left - host.getBoundingClientRect().left;
                return Math.floor(shift + (vw.width - (vw.documentWidth || 0)) / 2 - GAP_TO_PAGE);
            } catch (e) { return null; }
        },

        /* The whole rule: the margin band, whether the column is expanded, and its width. By
           itself the column is expanded when the PDF has bookmarks and the margin is wide; a press
           overrides this until the margin moves to another band — otherwise a single click would
           turn the rule off forever. */
        fit: function () {
            if (!this.rail || !this.active()) return null;
            var space = this.railSpace(), was = this.regime;
            if (space !== null) {
                if (space < RAIL_MIN) this.regime = 'narrow';
                else if (space > RAIL_MIN + RAIL_HYST) this.regime = 'wide';
            }
            if (this.regime !== was) this.manual = null;
            var want = this.manual ? this.manual === 'open' : (this.hasOutline() && this.regime === 'wide');
            this.opened = want && this.usable();
            var w = Math.max(RAIL_MIN, Math.min(RAIL_W, space === null ? RAIL_W : space));
            this.rail.style.setProperty('--vo-nav-rail-w', w + 'px');
            this.sync();
            return this.opened ? 'column' : 'pill';
        },

        fitSoon: function () {
            var me = this;
            clearTimeout(this.fitTimer);
            this.fitTimer = setTimeout(this.guard('fit', function () { me.fitTimer = 0; me.fit(); }), 60);
        },

        /* --- Commands --------------------------------------------------------------- */

        setOpen: function (open) {
            if (open && !this.usable()) return false;
            this.manual = open ? 'open' : 'closed';
            this.fit();
            Common.NotificationCenter.trigger('edit:complete');
            return this.isOpen() === !!open;
        },

        open: function () {
            return this.isOpen() || this.setOpen(true);
        },

        close: function () {
            return this.isOpen() ? this.setOpen(false) : false;
        },

        /* The pill and the arrow: open or close. */
        toggle: function () {
            return this.isOpen() ? this.close() : this.open();
        },

        /* The view follows the state: the open panel class, the pill, the rows. */
        sync: function () {
            if (this.syncing) return;
            this.syncing = true;
            try {
                this.checkFile();
                var open = this.isOpen() && this.active(), usable = this.usable();
                document.body.classList.toggle(OPEN_CLASS, open);
                if (this.pill) {
                    if (!open && usable) this.pill.removeAttribute('hidden'); else this.pill.setAttribute('hidden', '');
                    this.pill.setAttribute('aria-expanded', open ? 'true' : 'false');
                }
                if (open) {
                    if (!this.rows || this.rows.length !== this.pages) this.build();
                    else this.fillNames();
                    this.markCurrent(true);
                    this.drawSoon();
                }
            } finally {
                this.syncing = false;
            }
        },

        /* The caption is the phrase of the stock "Navigation" button of the left menu. */
        tipNavigation: function () {
            var o = PDFE.Views.LeftMenu, v = o && (o.prototype && typeof o.prototype.tipNavigation === 'string' ?
                o.prototype.tipNavigation : o.tipNavigation);
            return typeof v === 'string' && v ? v : this.textNavigation;
        },

        /* --- Texts -------------------------------------------------------------- */
        /* The defaults are English, the translation overlays them from locale/<language>.json. */

        textNavigation: 'Navigation'

    }, PDFE.Views.NavigationPanel || {});

    return PDFE.Views.NavigationPanel;
});
