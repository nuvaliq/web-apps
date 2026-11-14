/*
 * ColumnHeaderMenu — the column header menu of the "Compact" shell of the spreadsheet editor
 * (the layout is in CompactShell).
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The row and column headers are drawn by the engine on the canvas, and so is their highlighting (hover,
 * selection), in the Compact colors (--vo-cell-title-* in compact-shell.less, put into the engine
 * skin by CompactShell.applyCanvasSkin). Here are three things on top:
 *
 *   the chevron layer #vo-colh — a thin DOM in #ws-canvas-outer above the column
 *   header row (stock puts its own buttons there too — paste and chart elements):
 *   a chevron at the column under the cursor and always at the column of the current cell. The layer is transparent to
 *   the mouse: a click on the header, including on the chevron, goes to the engine, and the engine selects the column
 *   itself, as stock does (with drag, Shift and Ctrl). The shell has no selection of its own — the engine
 *   has no public "select column", and a click intercepted by the layer would not have reached the engine.
 *   So the chevron is a sign, not a button, and it has no tooltip; the menu name for the screen reader is
 *   textColumnMenu_ARIA;
 *
 *   click handling: pointerdown and pointerup on window in the capture phase, swallowing nothing. A left
 *   click on a header without drag, after which a column is selected, opens the menu under the
 *   header; a repeated click on the same header closes it. Selecting a column from the
 *   keyboard does not open the menu. A right click is a wrapper over showObjectMenu of the DocumentHolder
 *   controller instance (the stock file is not edited): with a column selected in Compact
 *   — our menu from the click point, otherwise — the stock display. A keyboard invocation (Shift+F10,
 *   the context menu key — an event without coordinates) — the stock display: the stock menu itself
 *   takes focus and works with arrows, while the shell's column menu opens only
 *   with the mouse (our menu has no keyboard of its own);
 *
 *   the menu #vo-colh-menu — the look of the document Compact menu (the .vo-mn .vo-mn-* rules, the rows
 *   are built by CompactShell), the items, their order and availability — a snapshot of the stock context
 *   menu at the moment of opening (StockBridge.contextMenu: for editing — ssMenu, without edit rights —
 *   viewModeMenu), the choice — the stock click on the item (StockBridge.pick). Galleries inside items
 *   are skipped by the bridge (StockBridge.gaps).
 *
 * The column under a point is the shell's only adapter to the engine internals:
 * getCursorTypeFromXY and getCellCoord of the sheet view, the header row (headersTop,
 * headersHeight, cellsLeft). If the adapter fails — one warning, after that only the chevron
 * of the current column (its place is the public asc_getActiveCellCoord) and the menu on right
 * click (it relies on the selection, not on the adapter).
 *
 * attach(shell) — from CompactShell.create() and on return from Stock; detach() — on the switch
 * to Stock and on rollback. The menu is closed by the shell's common points: closeSurfaces() (a click elsewhere,
 * a stock window and menu, other surfaces) and Escape (closeTopSurface — as the first layer).
 */
define([
    'common/main/lib/view/compact/Icons',
    'spreadsheeteditor/main/app/view/StockBridge',
    'spreadsheeteditor/main/app/view/SheetActions'
], function (Icons, Bridge, SheetActions) {
    'use strict';

    if (window.SSE === undefined) window.SSE = {};
    if (SSE.Views === undefined) SSE.Views = {};

    var LAYER_ID = 'vo-colh';
    var MENU_ID = 'vo-colh-menu';

    /* Chevron — a 14 glyph at the right edge of the header cell, vertically centered: right 6
       inside a border of 1, that is 7 from the cell edge (the engine's border is
       the last pixel of the column). Narrower than 23, the column does not hold the chevron. */
    var CHEV = 14, CHEV_PAD = 7;
    /* Menu — under the header at 4, within the window with a margin of 4, 8 at the bottom. */
    var MENU_GAP = 4, EDGE = 4, BOTTOM_GAP = 8;
    /* A drag further than 4 px is a column range selection, not a click. */
    var SLOP = 4;
    /* Submenu — as in the menu bar: opens on hover with a delay, the first row
       level with the item (the list's top padding @vo-pop-pad-y). */
    var HOVER_DELAY = 150, POP_PAD_Y = 10;
    /* Header row height at 100 % zoom when the adapter has failed. */
    var FALLBACK_BAND = 20;

    /* Glyphs — for the same items as the stock icons (the btn-* class of its iconCls). */
    var GLYPHS = {'btn-cut': 'cut', 'btn-copy': 'copy', 'btn-paste': 'paste', 'btn-clearstyle': 'clear', 'btn-undo': 'undo'};

    var warned = {};
    function warnOnce(label, e) {
        if (warned[label]) return;
        warned[label] = true;
        if (window.console && console.warn)
            console.warn('Compact shell: "' + label + '" failed, the editor keeps working without it.', e);
    }

    function ctl(name) {
        try { return SSE.getController(name) || null; } catch (e) { return null; }
    }

    function later(fn) {
        return window.requestAnimationFrame ? window.requestAnimationFrame(fn) : setTimeout(fn, 16);
    }

    /* Column name for the screen reader — in letters, as in the header (A, B, …, AA). */
    function colName(col) {
        var s = '';
        for (var n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
        return s;
    }

    SSE.Views.ColumnHeaderMenu = _.extend({

        shell: null,
        api: null,
        layer: null,      // #vo-colh
        hov: null,        // chevron of the column under the cursor
        cur: null,        // chevron of the current cell's column
        host: null,       // #vo-colh-menu
        open: null,       // the open menu: {col, ref, drop, flies, timer}
        point: null,      // cursor over the canvas (CSS px from its corner) or null
        down: null,       // left button press on a header: {x, y, col, wasOpen}
        justClosed: -1,   // column of the menu closed in this same tick (a repeated press on the header)
        broken: false,    // the adapter has failed
        pending: false,   // a chevron redraw has been requested
        stockShow: null,  // the stock showObjectMenu (not intercepted)
        offs: null,       // unsubscribers of attach()

        attach: function (shell) {
            if (this.offs || !shell) return this;
            var me = this;
            this.shell = shell;
            this.api = shell.api;
            this.offs = [];
            this.broken = false;
            this.open = null;
            this.point = null;
            this.down = null;
            var ok = shell.guarded('column menu: attach', function () {
                me.wrapShow();
                me.buildLayer();
                me.bindPointer();
                me.bindEngine();
                me.refresh();
                return true;
            })();
            /* A fault in its own menu does not take the shell down: it works without it. */
            if (!ok) this.detach();
            return this;
        },

        detach: function () {
            this.close();
            (this.offs || []).splice(0).forEach(function (off) {
                try { off(); } catch (e) { warnOnce('column menu: detach', e); }
            });
            this.offs = null;
            [this.layer, this.host].forEach(function (el) { el && el.parentNode && el.parentNode.removeChild(el); });
            this.layer = this.hov = this.cur = this.host = null;
            this.stockShow = null;
            this.point = this.down = null;
            this.pending = false;
            return this;
        },

        guarded: function (label, fn) {
            var shell = this.shell;
            return shell ? shell.guarded(label, fn) : fn;
        },

        listen: function (target, type, fn, opts) {
            if (!target || typeof target.addEventListener !== 'function') return;
            target.addEventListener(type, fn, opts);
            this.offs.push(function () { target.removeEventListener(type, fn, opts); });
        },

        /* --- Right click: a wrapper over the stock showObjectMenu ------------------- */
        /* Stock shows the context menu from showObjectMenu of the controller instance: it is
           called by a right click (asc_onContextMenu → onApiContextMenu, after 10 ms), the context
           menu key (engine: keyCode 93 → onContextMenu with a keyboard event) and
           Shift+F10 (DocumentHolder.onKeyDown). The wrapper is placed on the instance, the prototype method
           is not touched; with a column selected in Compact and a mouse click the menu is ours, otherwise —
           the stock display. A failure of our part is also the stock display: guarded returns undefined. */
        wrapShow: function () {
            var me = this, c = ctl('DocumentHolder');
            if (!c || typeof c.showObjectMenu !== 'function') return;
            var own = Object.prototype.hasOwnProperty.call(c, 'showObjectMenu'), orig = c.showObjectMenu;
            var take = this.guarded('column menu: context menu', function (event, type) { return me.fromContext(event, type); });
            var wrapped = function (event, type) {
                if (take(event, type) === true) return;
                return orig.apply(this, arguments);
            };
            c.showObjectMenu = wrapped;
            this.stockShow = function () { return orig.call(c); };
            this.offs.push(function () {
                if (c.showObjectMenu !== wrapped) return;
                if (own) c.showObjectMenu = orig;
                else delete c.showObjectMenu;
            });
        },

        fromContext: function (event, type) {
            var shell = this.shell;
            if (!shell || shell.advanced || shell.startupFailed) return false;
            var M = window.Asc && Asc.c_oAscContextMenuTypes;
            if (M && type === M.changeSeries) return false;
            /* A menu from the keyboard is the stock one: the stock one has
               focus and arrow navigation, Enter, submenus, Escape to the sheet (DocumentHolder.showPopupMenu
               focuses the menu, the Bootstrap delegate handles keys); our menu is a mouse surface,
               opened by a click on the header. The sign is an event without
               coordinates: Shift+F10 is a keydown, the menu key is an engine keyboard event, a click
               on the grouping is null (stock then shows nothing). */
            if (!this.byPointer(event)) return false;
            if (!this.isColumn()) return false;
            var at = this.pointFor(event);
            var snap = this.snapshot();
            /* Stock would have chosen another menu (headers/footers) or there is no controller — let stock show it. */
            if (!snap || snap.other) return false;
            if (snap.ref) this.show(snap, at);
            return true;
        },

        isColumn: function () {
            var T = window.Asc && Asc.c_oAscSelectionType, api = this.api;
            var info = T && api && typeof api.asc_getCellInfo === 'function' ? api.asc_getCellInfo() : null;
            return !!info && typeof info.asc_getSelectionType === 'function' && info.asc_getSelectionType() === T.RangeCol;
        },

        /* A mouse invocation: the event has a point (the engine's right click is a pointer event). */
        byPointer: function (event) {
            return !!event && typeof event.clientX === 'number' && typeof event.clientY === 'number';
        },

        /* The right-click menu point: horizontally from the point; vertically — under the header
           if the click was on the header, otherwise from the point itself. */
        pointFor: function (event) {
            var o = this.outerRect(), band = this.band();
            var under = o && band ? o.top + band.top + band.height + MENU_GAP : null;
            var inHeader = o && band && event.clientY - o.top < band.top + band.height;
            var col = this.colAtClient(event.clientX, event.clientY);
            return {x: event.clientX, y: inHeader ? under : event.clientY, col: col >= 0 ? col : this.currentCol()};
        },

        /* The current column number — for the menu name: the adapter in the middle of its header. */
        currentCol: function () {
            var cur = this.current(), band = this.band();
            var hit = cur ? this.colAt(cur.left + cur.width / 2, band.top + band.height / 2) : null;
            return hit ? hit.col : -1;
        },

        /* --- Chevron layer -------------------------------------------------------- */

        outer: function () {
            return document.getElementById('ws-canvas-outer');
        },

        outerRect: function () {
            var o = this.outer();
            return o && typeof o.getBoundingClientRect === 'function' ? o.getBoundingClientRect() : null;
        },

        buildLayer: function () {
            var outer = this.outer();
            if (!outer) return;
            var layer = document.createElement('div');
            layer.id = LAYER_ID;
            layer.setAttribute('aria-hidden', 'true');
            this.cur = this.chevron(layer);
            this.hov = this.chevron(layer);
            outer.appendChild(layer);
            this.layer = layer;
        },

        chevron: function (layer) {
            var el = document.createElement('span');
            el.className = 'vo-colh-chev';
            el.innerHTML = Icons.svg('chevron', CHEV);
            layer.appendChild(el);
            return el;
        },

        /* Cursor and presses. Movement — over the canvas (#ws-canvas-outer, bubbling from
           the engine canvases), leaving — pointerleave; with the button held (drag, scrollbar)
           the chevrons are repositioned outside the canvas too. Press and release — on window in
           the capture phase: before the engine handlers, swallowing nothing. The wheel scrolls the sheet —
           the current column's chevron follows it. */
        bindPointer: function () {
            var me = this, outer = this.outer();
            var hasPointer = 'onpointerdown' in window;
            var DOWN = hasPointer ? 'pointerdown' : 'mousedown';
            var UP = hasPointer ? 'pointerup' : 'mouseup';
            var MOVE = hasPointer ? 'pointermove' : 'mousemove';
            var LEAVE = hasPointer ? 'pointerleave' : 'mouseleave';
            if (outer) {
                this.listen(outer, MOVE, this.guarded('column menu: pointer move', function (e) {
                    var o = me.outerRect();
                    me.point = o ? {x: e.clientX - o.left, y: e.clientY - o.top} : null;
                    me.schedule();
                }), {passive: true});
                this.listen(outer, LEAVE, this.guarded('column menu: pointer leave', function () {
                    me.point = null;
                    me.schedule();
                }), {passive: true});
                this.listen(outer, 'wheel', this.guarded('column menu: wheel', function () {
                    later(function () { me.schedule(); });
                }), {passive: true});
            }
            this.listen(window, MOVE, this.guarded('column menu: drag', function (e) {
                if (e && e.buttons) me.schedule();
            }), {capture: true, passive: true});
            this.listen(window, DOWN, this.guarded('column menu: pointer down', function (e) { me.onDown(e); }), true);
            this.listen(window, UP, this.guarded('column menu: pointer up', function (e) { me.onUp(e); }), true);
            this.listen(window, 'resize', this.guarded('column menu: resize', function () { me.schedule(); }));
        },

        bindEngine: function () {
            var me = this, api = this.api;
            var on = function (name, fn) {
                if (!api || typeof api.asc_registerCallback !== 'function') return;
                var cb = me.guarded('column menu: ' + name, fn);
                api.asc_registerCallback(name, cb);
                me.offs.push(function () {
                    if (typeof api.asc_unregisterCallback === 'function') api.asc_unregisterCallback(name, cb);
                });
            };
            on('asc_onSelectionChanged', function () {
                /* The selection left the column (arrow, click in a cell) — the menu closes. */
                if (me.open && !me.isColumn()) me.shell.closeSurfaces();
                me.schedule();
            });
            on('asc_onZoomChanged', function () { me.schedule(); });
            on('asc_onSheetsChanged', function () { me.schedule(); });
            on('asc_onUpdateSheetViewSettings', function () { me.schedule(); });
            var NC = window.Common && Common.NotificationCenter;
            if (NC) {
                var cb = this.guarded('column menu: layout:changed', function () { me.schedule(); });
                NC.on('layout:changed', cb);
                this.offs.push(function () { NC.off('layout:changed', cb); });
            }
        },

        /* Chevron repositioning — no more often than once per frame. */
        schedule: function () {
            if (this.pending || !this.layer) return;
            var me = this;
            this.pending = true;
            later(this.guarded('column menu: chevrons', function () {
                me.pending = false;
                me.refresh();
            }));
        },

        refresh: function () {
            if (!this.layer) return;
            var band = this.band(), cur = this.current();
            var hov = this.point ? this.colAt(this.point.x, this.point.y) : null;
            if (hov && cur && Math.abs(hov.left - cur.left) < 0.5 && Math.abs(hov.width - cur.width) < 0.5) hov = null;
            this.place(this.cur, cur, band);
            this.place(this.hov, hov, band);
        },

        place: function (el, box, band) {
            if (!el) return;
            var outer = this.outer();
            var w = outer ? outer.clientWidth : 0;
            var x = 0, y = 0;
            var ok = !!box && !!band && band.height >= CHEV && box.width >= CHEV + CHEV_PAD + 2;
            if (ok) {
                x = band.rtl ? box.left + CHEV_PAD : box.left + box.width - CHEV_PAD - CHEV;
                y = band.top + Math.round((band.height - CHEV) / 2);
                ok = band.rtl ? x + CHEV <= w - band.start : x >= band.start && (!w || x + CHEV <= w);
            }
            el.classList.toggle('on', ok);
            if (!ok) return;
            el.style.left = Math.round(x) + 'px';
            el.style.top = Math.round(y) + 'px';
        },

        /* The current column — by the public asc_getActiveCellCoord (CSS pixels from the canvas
           corner); a selected object has no current column. */
        current: function () {
            var T = window.Asc && Asc.c_oAscSelectionType, api = this.api;
            if (!T || !api || typeof api.asc_getActiveCellCoord !== 'function') return null;
            var info = api.asc_getCellInfo();
            var t = info && typeof info.asc_getSelectionType === 'function' ? info.asc_getSelectionType() : null;
            if (t !== T.RangeCells && t !== T.RangeCol && t !== T.RangeRow && t !== T.RangeMax) return null;
            var c = api.asc_getActiveCellCoord();
            return c ? this.box(-1, c.asc_getX(), c.asc_getWidth()) : null;
        },

        box: function (col, left, width) {
            if (width < 0) { left += width; width = -width; }
            return {col: col, left: left, width: width};
        },

        /* --- Engine adapter ---------------------------------------------------- */
        /* The only place in the shell where the engine internals are read: the column
           under a point — by the same getCursorTypeFromXY the engine uses to decide what is under the mouse
           (a column header or the header of an already selected column, ColumnRowHeaderMove),
           its rectangle — getCellCoord (the same calculation as the public
           asc_getActiveCellCoord, with frozen areas and right to left), the header
           row — headersTop/headersHeight, the start of the cells — cellsLeft. The engine counts in
           buffer pixels (CSS × retinaPixelRatio), and we return CSS pixels from the canvas corner.
           The first failure is a warning, after that the adapter is not queried: the chevron only at
           the current column, the header row — by zoom. */
        sheet: function () {
            var api = this.api;
            var ws = api && api.wb && typeof api.wb.getWorksheet === 'function' ? api.wb.getWorksheet() : null;
            if (!ws || typeof ws.getCursorTypeFromXY !== 'function' || typeof ws.getCellCoord !== 'function')
                throw new Error('worksheet view internals are not available');
            return ws;
        },

        ratio: function () {
            var B = window.AscCommon && AscCommon.AscBrowser;
            var r = B && B.retinaPixelRatio;
            return r > 0 ? r : 1;
        },

        adapter: function (fn) {
            if (this.broken) return undefined;
            try {
                return fn.call(this, this.sheet(), this.ratio());
            } catch (e) {
                this.broken = true;
                warnOnce('column menu: engine adapter', e);
                return undefined;
            }
        },

        colAt: function (x, y) {
            var me = this;
            return this.adapter(function (ws, r) {
                var T = window.AscCommonExcel && AscCommonExcel.c_oTargetType;
                if (!T || T.ColumnHeader === undefined) throw new Error('target types are not available');
                var ct = ws.getCursorTypeFromXY(x * r, y * r);
                if (!ct || !(ct.col >= 0) || (ct.target !== T.ColumnHeader && ct.target !== T.ColumnRowHeaderMove)) return null;
                var c = ws.getCellCoord(ct.col, 0);
                return me.box(ct.col, c.asc_getX(), c.asc_getWidth());
            }) || null;
        },

        colAtClient: function (cx, cy) {
            var o = this.outerRect();
            var hit = o ? this.colAt(cx - o.left, cy - o.top) : null;
            return hit ? hit.col : -1;
        },

        band: function () {
            var b = this.adapter(function (ws, r) {
                return {
                    top: (ws.headersTop || 0) / r,
                    height: (ws.headersHeight || 0) / r,
                    start: (ws.cellsLeft || 0) / r,
                    rtl: typeof ws.getRightToLeft === 'function' && !!ws.getRightToLeft()
                };
            });
            if (b) return b;
            var api = this.api, z = api && typeof api.asc_getZoom === 'function' ? api.asc_getZoom() : 1;
            return {top: 0, height: Math.round(FALLBACK_BAND * (z > 0 ? z : 1)), start: 0, rtl: false};
        },

        /* --- Left click on a header ------------------------------------------- */
        /* A press is remembered only if it is a left one and on a column header; the menu
           opens on release without drag and after the engine has handled
           the click (setTimeout: selection, stock mouse flags) — if a column is selected.
           A menu that was open on this column at the moment of the press does not open again: a repeated
           click closes it (a click elsewhere outside the shell closed it — with the same press). */
        onDown: function (e) {
            this.down = null;
            if (!e || e.button !== 0 || this.broken) return;
            var outer = this.outer(), t = e.target;
            if (!outer || !t || t.nodeType !== 1 || !outer.contains(t)) return;
            var col = this.colAtClient(e.clientX, e.clientY);
            if (col < 0) return;
            var wasOpen = (this.open ? this.open.col : this.justClosed) === col;
            this.down = {x: e.clientX, y: e.clientY, col: col, wasOpen: wasOpen};
        },

        onUp: function (e) {
            var d = this.down, me = this;
            this.down = null;
            if (!d || !e || e.button !== 0 || d.wasOpen) return;
            if (Math.abs(e.clientX - d.x) > SLOP || Math.abs(e.clientY - d.y) > SLOP) return;
            setTimeout(this.guarded('column menu: open', function () { me.openUnder(d.col); }), 0);
        },

        openUnder: function (col) {
            if (!this.offs || !this.shell || this.shell.advanced || !this.isColumn()) return;
            var o = this.outerRect(), band = this.band(), cur = this.current();
            if (!o || !cur) return;
            var snap = this.snapshot();
            if (!snap || !snap.ref) return;
            this.show(snap, {x: o.left + (band.rtl ? cur.left + cur.width : cur.left), y: o.top + band.top + band.height + MENU_GAP,
                             col: col, alignEnd: band.rtl});
        },

        snapshot: function () {
            return Bridge.contextMenu(this.stockShow || undefined);
        },

        /* --- Menu -------------------------------------------------------------------- */

        isOpen: function () {
            return !!this.open;
        },

        ownsTarget: function (t) {
            return !!(this.host && t && t.nodeType === 1 && this.host.contains(t));
        },

        ensureHost: function () {
            if (this.host && this.host.parentNode) return this.host;
            var host = document.createElement('div');
            host.id = MENU_ID;
            /* .vo-mn — for the rules of the document Compact menu (.vo-mn .vo-mn-*): the node itself is
               an anchor point of zero size. */
            host.className = 'vo-mn';
            document.body.appendChild(host);
            this.host = host;
            return host;
        },

        show: function (snap, at) {
            var shell = this.shell, me = this;
            /* Shell surfaces — one at a time: the menu bar, the panel, the previous column menu; open
               stock dropdown menus (the sheet tabs row, the context one) are closed, as when opening
               any stock menu and a menu bar section. */
            shell.closeSurfaces();
            var mm = window.Common && Common.UI && Common.UI.Menu && Common.UI.Menu.Manager;
            mm && typeof mm.hideAll === 'function' && mm.hideAll();
            var list = snap.items || [];
            if (!list.length) return;
            var host = this.ensureHost();
            var drop = document.createElement('div');
            drop.className = 'vo-mn-drop open';
            drop.setAttribute('role', 'menu');
            drop.setAttribute('data-level', '0');
            drop.setAttribute('aria-label', this.label(at.col));
            shell.bindListScroll(drop);
            var icons = list.some(function (e) { return !e.sep && GLYPHS[e.icon]; });
            list.forEach(function (entry) {
                drop.appendChild(entry.sep ? shell.menuSep() : me.row(entry, icons, 0));
            });
            host.appendChild(drop);
            this.open = {col: at.col, ref: snap.ref, drop: drop, flies: [], timer: null};
            this.placeMenu(host, drop, at);
        },

        label: function (col) {
            var t = String(this.textColumnMenu_ARIA || '');
            return col >= 0 ? t.replace('{0}', colName(col)) : t.replace('{0}', '').replace(/\s+/g, ' ').trim();
        },

        /* Placement: the left edge — at the point (under the header — at the left edge of the column), within
           the window; if it does not fit downward — the list is limited by the window and scrolls, and if there is less room
           than the list and 240 together, it goes higher. */
        placeMenu: function (host, drop, at) {
            var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
            var w = drop.offsetWidth || 0, h = drop.offsetHeight || 0;
            var x = at.alignEnd ? at.x - w : at.x, y = at.y;
            if (vw && x + w > vw - EDGE) x = vw - EDGE - w;
            x = Math.max(EDGE, x);
            if (vh && vh - y - BOTTOM_GAP < Math.min(h, 240)) y = Math.max(EDGE, vh - BOTTOM_GAP - h);
            host.style.left = Math.round(x) + 'px';
            host.style.top = Math.round(y) + 'px';
            if (vh) drop.style.maxHeight = Math.max(0, Math.round(vh - y - BOTTOM_GAP)) + 'px';
        },

        /* A row — in the markup of the shell's menu rows (vo-mn-sub): a glyph (the space is kept if at least
           one item has it), a caption, a sample value on the right, ▸ (rowNode). An inactive item —
           by class and aria-disabled, the reason — in the tooltip: on a protected sheet it is named by
           reason. The choice is the stock click on the item, the menu closes before it. */
        row: function (entry, icons, level) {
            var me = this, shell = this.shell;
            var glyph = icons ? (GLYPHS[entry.icon] ? Icons.svg(GLYPHS[entry.icon], 16) : '') : null;
            var row = this.rowNode(entry.caption, glyph, !!entry.sub, entry.checked, entry.hint || '', entry.desc);
            row.setAttribute('data-id', entry.id);
            row.setAttribute('data-level', String(level));
            shell.rowState(row, {disabled: entry.disabled, reason: entry.disabled ? this.reason() : null});
            var act = this.guarded('column menu: item', function (e) {
                e && e.stopPropagation && e.stopPropagation();
                var m = me.open;
                if (!m || entry.disabled) return;
                if (entry.sub) { me.openFly(row, entry.sub, level + 1); return; }
                var ref = m.ref;
                me.shell.closeSurfaces();
                Bridge.pick(ref, entry.id);
            });
            row.addEventListener('click', act);
            row.addEventListener('mouseenter', this.guarded('column menu: hover', function () {
                me.hoverRow(row, level, entry.sub && !entry.disabled ? act : null);
            }));
            return row;
        },

        /* A list row: a glyph (null — without space for a glyph), a caption, a tooltip on the right (a sample
           value), a mark, ▸. The description (desc) — a second line under the caption, as stock
           draws it. */
        rowNode: function (text, glyph, hasSub, checked, hint, desc) {
            var row = document.createElement('button');
            row.setAttribute('type', 'button');
            row.className = 'vo-mn-sub' + (hasSub ? ' vo-has-sub' : '') + (desc ? ' vo-has-desc' : '');
            row.setAttribute('role', checked ? 'menuitemcheckbox' : 'menuitem');
            /* Items are not Tab stops: arrows move between them. */
            row.setAttribute('tabindex', '-1');
            if (checked) row.setAttribute('aria-checked', 'true');
            if (hasSub) {
                row.setAttribute('aria-haspopup', 'menu');
                row.setAttribute('aria-expanded', 'false');
            }
            var part = function (cls, parent) {
                var n = document.createElement('span');
                n.className = cls;
                parent.appendChild(n);
                return n;
            };
            if (glyph !== null) part('vo-mn-i', row).innerHTML = glyph || '';
            if (desc) {
                var tc = part('vo-mn-tc', row);
                part('vo-mn-t', tc).textContent = text;
                part('vo-mn-d', tc).textContent = desc;
            } else {
                part('vo-mn-t', row).textContent = text;
            }
            if (hint) part('vo-mn-h', row).textContent = hint;
            if (checked) part('vo-mn-chk', row).innerHTML = Icons.svg('checkMenu', 16);
            if (hasSub) part('vo-mn-arrow', row).innerHTML = Icons.svg('chevronL', 14);
            return row;
        },

        reason: function () {
            var api = this.api;
            try {
                if (api && typeof api.asc_isProtectedSheet === 'function' && api.asc_isProtectedSheet()) return SheetActions.textProtected;
            } catch (e) { /* no reason */ }
            return null;
        },

        hoverRow: function (row, level, open) {
            var m = this.open, me = this;
            if (!m) return;
            clearTimeout(m.timer);
            m.timer = setTimeout(this.guarded('column menu: hover', function () {
                if (me.open !== m) return;
                if (open) {
                    if (!row.classList.contains('vo-sub-open')) open();
                } else {
                    me.closeFlies(level + 1);
                }
            }), HOVER_DELAY);
        },

        openFly: function (row, list, level) {
            var m = this.open, me = this, shell = this.shell;
            if (!m) return;
            this.closeFlies(level);
            if (!list || !list.length) return;
            var fly = document.createElement('div');
            fly.className = 'vo-mn-drop vo-mn-fly open';
            fly.setAttribute('role', 'menu');
            fly.setAttribute('data-level', String(level));
            shell.bindListScroll(fly);
            list.forEach(function (entry) {
                fly.appendChild(entry.sep ? shell.menuSep() : me.row(entry, false, level));
            });
            this.host.appendChild(fly);
            m.flies.push({level: level, el: fly, row: row});
            row.classList.add('vo-sub-open');
            row.setAttribute('aria-expanded', 'true');
            this.placeFly(fly, row);
        },

        /* A submenu to the right of the item (if it does not fit at the window edge — to the left), the first row
           level with it, vertically — within the window. Measured from the menu node. */
        placeFly: function (fly, row) {
            var hr = this.host.getBoundingClientRect(), rr = row.getBoundingClientRect();
            var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
            var w = fly.offsetWidth || 0, h = fly.offsetHeight || 0;
            var left = rr.right - hr.left - 2;
            if (vw && hr.left + left + w > vw - EDGE) left = rr.left - hr.left - w + 2;
            var top = rr.top - hr.top - POP_PAD_Y;
            if (vh && hr.top + top + h > vh - EDGE) top = vh - EDGE - h - hr.top;
            if (hr.top + top < EDGE) top = EDGE - hr.top;
            fly.style.left = Math.round(left) + 'px';
            fly.style.top = Math.round(top) + 'px';
        },

        closeFlies: function (fromLevel) {
            var m = this.open;
            if (!m) return;
            m.flies = m.flies.filter(function (f) {
                if (f.level < fromLevel) return true;
                f.el.parentNode && f.el.parentNode.removeChild(f.el);
                f.row.classList.remove('vo-sub-open');
                f.row.setAttribute('aria-expanded', 'false');
                return false;
            });
        },

        /* Close the whole menu. The column of the closed menu is remembered until the end of the tick: a press on
           the same header that closed the menu with a click elsewhere does not open it again. */
        close: function () {
            var m = this.open, me = this;
            if (!m) return;
            clearTimeout(m.timer);
            this.closeFlies(1);
            m.drop.parentNode && m.drop.parentNode.removeChild(m.drop);
            this.open = null;
            this.justClosed = m.col;
            setTimeout(function () { if (me.justClosed === m.col) me.justClosed = -1; }, 0);
        },

        /* Escape: one layer — the deepest submenu, then the menu. */
        closeTop: function () {
            var m = this.open;
            if (!m) return false;
            if (m.flies.length) {
                clearTimeout(m.timer);
                this.closeFlies(m.flies[m.flies.length - 1].level);
                return true;
            }
            this.close();
            return true;
        },

        /* --- Texts ------------------------------------------------------------------ */
        /* The defaults are English: the locale overrides them with SSE.Views.ColumnHeaderMenu.* keys.
           {0} is the column letter; the item captions are stock. */

        textColumnMenu_ARIA: 'Column {0}'

    }, SSE.Views.ColumnHeaderMenu || {});

    return SSE.Views.ColumnHeaderMenu;
});
