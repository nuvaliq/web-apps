/*
 * OutlineRail — the document structure beside the page in the compact shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Layout: the expanded
 * rail is a column with a chevron on top and a list of headings indented by
 * level; the current section is marked with a fill. The column has no surface of its own,
 * and no section heading either — the rows sit right on the margin around the page.
 * The collapsed rail is a single pill with the number of headings. The previous look (a narrow
 * list card and a separate button above it, two objects with shadows) is removed.
 *
 * The column sits OVER the margin around the page and does not push it — this is by
 * design. Hence a limitation worth knowing: at a large
 * zoom the page comes right up to the edge and goes under the column. The widths of
 * the steps are chosen so that this does not happen at 100% (the calculation is in
 * `compact-shell.less`).
 *
 * The data and navigation are stock, we keep no document model of our own:
 *
 *     api.asc_GetDocumentOutlineManager()  → structure manager
 *     manager.get_ElementsCount/get_Level/get_Text/isEmptyItem
 *     manager.goto(i)                      → go to a heading
 *     asc_onDocumentOutlineUpdate*         → the composition changed
 *     asc_onDocumentOutlineCurrentPosition → the current section on scroll
 *
 * The current section is highlighted not only on click but also on scroll:
 * it is provided by the engine.
 *
 * The rail is the only structure of compact: the "View → Document structure" item
 * shows and hides it, the stock navigation panel is not opened from the menu.
 * The rail is a permanent pointer "where am I in the document", so the toggle is visible
 * always, even in an empty document.
 */
define([
    'documenteditor/main/app/view/Icons'
], function (Icons) {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    var ID = 'vo-outline';

    /* The toggle is always visible, and that matters more than saving
       one button. Hiding the panel with fewer than two headings is fine
       when the table of contents is not the only entrance to the structure.
       For us it is the only one: by hiding the toggle
       we make the structure unreachable and, worse, invisible as
       a possibility. An empty list honestly says what is missing. */

    DE.Views.OutlineRail = _.extend({

        api: null,
        $el: null,
        items: [],
        current: -1,
        open: false,

        create: function (api) {
            if (!api || !api.asc_GetDocumentOutlineManager) return this;
            if (document.getElementById(ID)) return this;

            this.api = api;

            var me = this;
            this.$el = $('<div id="' + ID + '"></div>');

            /* The toggle and the list are in one column, not as two floating
               objects: the column is the rail. It has no surface of its own —
               see `compact-shell.less`. */
            this.$panel = $('<div class="vo-outline-panel"></div>');

            this.$toggle = $('<button type="button" class="vo-ib vo-outline-toggle"></button>')
                .on('click', function (e) {
                    e.stopPropagation();
                    if (me.locked) return;
                    me.toggle();
                });

            this.$list = $('<div class="vo-outline-list"></div>');

            this.$panel.append(this.$toggle).append(this.$list);
            this.$el.append(this.$panel);

            /* The rail sits in the layout container, NOT in #editor-container:
               the latter moves when the rail takes up space, and would have gone away
               together with the canvas — measured on 10.09, the overlap reached
               −161px. `#viewport-hbox-layout` is positioned (relative), so
               the rail's absolute geometry is computed from it. */
            var $host = $('#viewport-hbox-layout');
            if (!$host.length) $host = $('#editor-container');
            if (!$host.length) $host = $('#editor_sdk').parent();
            if (!$host.length) return this;
            $host.append(this.$el);
            this.$el.addClass('has-items');   // the toggle is always there

            /* The saved choice is also the user's choice, and the rule must not
               overwrite it on the first frame. We distinguish "chose and
               collapsed" from "did not choose": getItem returns null when there is no
               key, while getBool would return the default and pass it off as the
               user's decision. */
            var saved = Common.localStorage.getItem('vo-outline-open');
            var openAtStart = (saved === null) ? true : (parseInt(saved, 10) !== 0);
            this.setOpen(openAtStart);
            /* On opening only the free space to the left of the page decides.
               The saved previous state does not count as a press by the
               user — otherwise the column would expand over the page
               in a narrow window. In a narrow window it can be expanded only by a press
               (toggle → manual). */
            this.manual = null;
            this.updateRegime();
            this.bind();
            return this;
        },

        bind: function () {
            var me = this, api = this.api;
            var on = function (n, f) {
                try { api.asc_registerCallback(n, function () {
                    if (DE.Views.CompactShell.startupFailed) return;
                    return f.apply(this, arguments);
                }); } catch (e) { /* no callback */ }
            };

            /* The engine builds the structure only when someone is looking at it.
               The flag is shared, and turning it on here is not enough: it is turned off by
               the stock navigation panel on its close — see ensureOutline. */
            try { api.asc_ShowDocumentOutline(); } catch (e) { /* not critical */ }

            /* Three events change the COMPOSITION of the structure, the fourth — the text of one
               element, and before, all four led to one full rebuild. For
               Change that was a mistake in cost: the event is sent from
               CDocumentOutline.Update(), which hangs in CDocument.Recalculate
               (sdkjs/word/Editor/DocumentOutline.js:142,
               Document.js:2869), that is, typing inside a heading
               rebuilt the rail on practically every character — on a document
               with 300 headings more than 1200 DOM operations per key. The stock code
               on the same event edits a single row
               (controller/Navigation.js, updateChangeNavigation). We do the same,
               and reduce full rebuilds to one per frame: several of them
               come in a row, and each would cost a full traversal. */
            var refresh = function () { me.scheduleRefresh(); };
            on('asc_onDocumentOutlineUpdate', refresh);
            on('asc_onDocumentOutlineUpdateAdd', refresh);
            on('asc_onDocumentOutlineUpdateChange', function (index) { me.refreshItem(index); });
            on('asc_onDocumentOutlineUpdateRemove', refresh);
            on('asc_onDocumentOutlineCurrentPosition', function (index) {
                me.current = index;
                me.markCurrent();
            });

            /* The rule looks at one width, so it needs two subscriptions:
               the size and the readiness of the document. Zoom is removed intentionally —
               it no longer affects the rule. */
            var fit = function () { me.applyFit(); };
            on('asc_onDocumentContentReady', fit);
            /* The column width depends on the margin to the left of the page, and the margin — on
               the zoom. The engine moves the page not at once, so the recalculation is
               with a pause. */
            on('asc_onZoomChange', function () { setTimeout(fit, 60); });

            /* But the POSITION does depend on the layout: the stock code moves the left
               edge of #editor-container when opening the comments panel, and
               the collapsed pill must move together with it. The rule cannot be called
               from here — it itself calls doLayout via reserveLeft, and
               a recursion would result, for the sake of which the flag
               _fitting.

               This is also the only place from which it is visible that the stock navigation
               panel turned off the shared structure flag. The order of the stock
               handler is this: the left menu button hides the panel via
               onCoauthOptions (view/LeftMenu.js:222), the panel on its hide
               turns the flag off, and only then layout:changed goes (:224) — that
               is, we arrive here with the flag already lowered. While it is lowered,
               the engine sends no updates at all, so refresh() cannot
               be called by itself — it has to be woken from outside. */
            /* The protection is shared with the shell (its `guarded`, analysis there too): a failure
               in our handler must not cancel trigger and the subscribers
               registered after the rail. We access it through the object, not by import:
               the rail is a dependency of the shell, an import would close a loop, and we
               arrive here from its create(), when it is already assembled. */
            Common.NotificationCenter.on('layout:changed',
                DE.Views.CompactShell.guarded('рельс структуры: layout:changed', function () {
                    me.place();
                    me.ensureOutline();
                    /* The left panel opened/closed — the page shifted,
                       the margin to the left of it is different. reserve(0) does not change the strut,
                       so doLayout and a new layout:changed will not happen. */
                    setTimeout(fit, 60);
                }));

            /* Resize comes in a batch — we calculate on the last frame. */
            var timer = null;
            $(window).on('resize', function () {
                clearTimeout(timer);
                timer = setTimeout(function () { fit(); setTimeout(fit, 120); }, 80);
            });

            this.refresh();
            this.applyFit();
            this.bindScrollbars();
        },

        /* The scrollbar is a 6px strip with rounded ends, without arrows and
           a track. The engine draws the bar itself on canvas, and its shape cannot be set;
           so its canvas is made transparent (it still catches the mouse —
           dragging and clicking work), and over it sits our strip, repeating
           the engine's thumb (scroller: x/y/w/h in canvas pixels). We compare on
           every frame, writing to the DOM only on change. A temporary place:
           this does not belong to the rail, it is here because the view already has
           access to the api. */
        bindScrollbars: function () {
            var wc = this.api && this.api.WordControl;
            if (!wc) return;
            var bars = [
                {id: 'id_vertical_scroll',   key: 'm_oScrollVerApi', vert: true},
                {id: 'id_horizontal_scroll', key: 'm_oScrollHorApi', vert: false}
            ];
            bars.forEach(function (b) {
                b.el = document.createElement('div');
                b.el.className = 'vo-sb-thumb ' + (b.vert ? 'vo-sb-v' : 'vo-sb-h');
                b.last = '';
            });
            var scrolled = null;
            var tick = function () {
                /* The document is scrolled — the panel presses against the header (the
                   vo-scrolled class on body, the look is in compact-shell.less). */
                var sv = wc.m_oScrollVerApi;
                var now = !!(sv && sv.scrollVCurrentY > 0);
                if (now !== scrolled) { scrolled = now; document.body.classList.toggle('vo-scrolled', now); }
                /* The same frame drives the going away of the header and menu row on scroll:
                   we hand the position and the limit to the shell. A failure there does not break the loop. */
                if (sv) {
                    try {
                        var shell = DE.Views.CompactShell;
                        shell && shell.onDocScroll && shell.onDocScroll(sv.scrollVCurrentY, sv.maxScrollY);
                    } catch (e) { /* the scrollbar is more important */ }
                }
                for (var i = 0; i < bars.length; i++) {
                    var b = bars[i], s = wc[b.key], host = document.getElementById(b.id);
                    var cv = host && host.querySelector('canvas');
                    var r = cv && cv.getBoundingClientRect();
                    var max = s && (b.vert ? s.maxScrollY : s.maxScrollX);
                    var key = '';
                    if (s && s.scroller && r && r.width && r.height && max > 0) {
                        var k = b.vert ? cv.height / r.height : cv.width / r.width;
                        key = b.vert
                            ? 'top:' + (s.scroller.y / k).toFixed(1) + 'px;height:' + (s.scroller.h / k).toFixed(1) + 'px'
                            : 'left:' + (s.scroller.x / k).toFixed(1) + 'px;width:' + (s.scroller.w / k).toFixed(1) + 'px';
                        key += s.scrollerMouseDown ? ';--vo-sb-on:1' : '';
                    }
                    if (key === b.last) continue;
                    b.last = key;
                    if (!key) { b.el.style.display = 'none'; continue; }
                    if (b.el.parentNode !== host) host.appendChild(b.el);
                    b.el.style.cssText = 'display:block;' + key;
                    b.el.classList.toggle('vo-sb-drag', !!s.scrollerMouseDown);
                }
                window.requestAnimationFrame(tick);
            };
            window.requestAnimationFrame(tick);
        },

        manager: function () {
            if (!this._manager) this._manager = this.api.asc_GetDocumentOutlineManager();
            return this._manager;
        },

        /* --- Data ---------------------------------------------------------- */

        /* The "someone is looking at the structure" flag of the engine is shared, and it is held not
           only by the rail. The stock navigation panel raises it on opening
           (controller/Navigation.js:61) and TURNS IT OFF on closing (:71) — and it is
           reachable from our own menu, "View → Document structure"
           (DocumentActions.js:240). The engine has no refcount:
           asc_HideDocumentOutline puts SetUse(false) directly
           (sdkjs/word/api.js:11864), and when Use === false the update goes into an
           early exit (sdkjs/word/Editor/DocumentOutline.js:63) — the engine sends
           no more events, and the rail freezes on the previous headings until
           the page is reloaded. So we raise the flag again.

           But only when it is actually lowered, and the check here is not
           decoration: SetUse(true) inside calls UpdateAll() — a full traversal of the
           document plus a SYNCHRONOUS asc_onDocumentOutlineUpdate (sendEvent,
           sdkjs/word/api.js:960), to which our own refresh() is subscribed. Without
           the check there would be a traversal of the whole document on every heading edit
           and infinite recursion refresh → SetUse → event → refresh.

           IsUse is not in the export list of CDocumentOutline
           (sdkjs/word/Editor/DocumentOutline.js:501), but the manager is the structure
           object itself, and the sdk of this build is assembled by concatenation, without
           renaming of names (sdkjs/build/build.py), so the method is in place.
           If it ever disappears, we stay with the previous behavior and
           do not fall into recursion. */
        ensureOutline: function () {
            if (DE.Views.CompactShell.startupFailed) return;
            var m = this.manager();
            if (!m || !m.IsUse || m.IsUse()) return;
            try { this.api.asc_ShowDocumentOutline(); } catch (e) { /* not critical */ }
        },

        /* A full rebuild — no more than once per frame. The engine callbacks come in a
           batch (Update + Add + Remove for one edit), and their result is
           one: the content is re-read entirely. */
        scheduleRefresh: function () {
            var me = this;
            if (this._refreshQueued) return;
            this._refreshQueued = true;
            var run = function () {
                me._refreshQueued = false;
                me.refresh();
            };
            if (window.requestAnimationFrame) window.requestAnimationFrame(run);
            else setTimeout(run, 0);
        },

        /* A point update of one row. The composition could have shifted too — then
           a full rebuild is more honest; we decide by the same set of features as the stock code
           (the element level and its presence in the list). */
        refreshItem: function (index) {
            var m = this.manager();
            if (!m || typeof index !== 'number') return this.scheduleRefresh();
            /* In Advanced the rail is not on the screen — we do not touch the DOM, we keep the mark,
               the return will handle it (onModeChange). */
            if (this.advanced()) { this.stale = true; return; }

            var cur = null, items = this.items || [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].index === index) { cur = items[i]; break; }
            }

            var empty = !!(m.isEmptyItem && m.isEmptyItem(index));
            var text = (m.get_Text(index) || '').trim();
            /* The item was not in the list, became empty or changed level — this is
               a change of composition, not of text. */
            if (!cur || empty || !text || cur.level !== m.get_Level(index)) {
                return this.scheduleRefresh();
            }
            if (cur.text === text) return;

            cur.text = text;
            this.$list.find('.vo-outline-item[data-index="' + index + '"]')
                      .attr('title', text).text(text);
        },

        refresh: function () {
            var m = this.manager();
            if (!m) return;
            /* In Advanced the rail is not on the screen at all — there is no need to read the structure and
               touch the DOM. The mark stays, the return handles it
               (onModeChange). */
            if (this.advanced()) { this.stale = true; return; }
            this.stale = false;

            /* Before reading we make sure the engine builds the structure: the flag
               could have been turned off by someone else (see ensureOutline). It costs one
               field read, while the flag is up. */
            this.ensureOutline();

            var count = m.get_ElementsCount();
            var items = [];
            for (var i = 0; i < count; i++) {
                /* Empty headings are returned by the engine as is; showing a row
                   without text is pointless, but we keep the index for goto. */
                if (m.isEmptyItem && m.isEmptyItem(i)) continue;
                var text = (m.get_Text(i) || '').trim();
                if (!text) continue;
                items.push({index: i, level: m.get_Level(i), text: text});
            }

            this.items = items;
            this.render();
        },

        /* The shell mode is asked at the moment of the call, not remembered: it is
           switched by a button at any moment. A similar helper is in
           SelectionBubble.advanced() and SlashMenu.advanced(). */
        advanced: function () {
            var shell = DE.Views.CompactShell;
            return !!(shell && shell.advanced);
        },

        /* The mode change is called by the shell (CompactShell.toggleMode).

           Keeping the engine's structure flag in Advanced is pointless: there is no rail there, and
           a raised flag makes the engine do a linear pass over the structure elements
           on every character (sdkjs/word/Editor/Run.js:1965,
           Paragraph.js:16105-16109) — with it lowered it exits on the first
           line. The stock code itself also turns it on when the navigation panel opens and
           turns it off on close (controller/Navigation.js:55-75).

           In compact the flag stays raised: the number of headings is shown also by the
           collapsed rail, without the flag it would freeze.

           We turn it off only if the stock navigation panel does not hold it: the flag is
           one for everyone, and turning it off under an open panel we would break
           someone else's. We ask the pressed state of its button — the same idiom as in
           docModeLocked and syncLeftState. */
        onModeChange: function () {
            if (this.advanced()) {
                var shell = DE.Views.CompactShell;
                var btn = shell && shell.stockLeftBtn && shell.stockLeftBtn('navigation');
                if (btn && btn.pressed) return;
                try { this.api.asc_HideDocumentOutline(); } catch (e) { /* not critical */ }
                return;
            }
            this.ensureOutline();
            if (this.stale) this.refresh();
        },

        render: function () {
            var me = this;

            this.$list.empty();
            /* We update the counter before exiting on an empty list: otherwise a document
               that lost all headings would leave the previous number on the collapsed
               rail. */
            this.updateCount();

            if (!this.items.length) {
                this.$list.append($('<div class="vo-outline-empty"></div>')
                    .text(this.textEmpty));
                return;
            }

            /* The minimum level is taken as zero indent: a document may
               start with "Heading 2", and pressing it to the right edge of the
               rail would be strange. */
            var base = this.items.reduce(function (min, it) {
                return Math.min(min, it.level);
            }, 99);

            this.items.forEach(function (it) {
                $('<button type="button" class="vo-outline-item"></button>')
                    .attr('title', it.text)
                    .css('padding-left', (10 + (it.level - base) * 12) + 'px')
                    .attr('data-index', it.index)
                    .text(it.text)
                    .on('click', function (e) {
                        e.stopPropagation();
                        if (me.locked) return;
                        var m = me.manager();
                        if (m && m.goto) {
                            m.goto(it.index);
                            me.scrollToTop(m, it.index);
                        }
                    })
                    .appendTo(me.$list);
            });

            this.markCurrent();
        },

        /* The heading after a click is at the top edge of the window, with the TOP_GAP margin.
           The stock goto puts the caret and scrolls
           just enough for it to become visible — a heading below the screen
           ended up at the bottom edge. We take the position from the caret itself (it is already
           at the start of the heading) and scroll the vertical bar the way the
           engine does in ScrollToAbsolutePosition (sdkjs: word/Drawing), only
           with a stop at the end of the document. After a timer — so that the stock
           scroll to the caret has already worked. These are engine internals, so
           everything is in try: if it fails — the stock jump remains. */
        scrollToTop: function (m, index) {
            var api = this.api, TOP_GAP = 20;
            setTimeout(function () {
                try {
                    var wc = api.WordControl,
                        el = m.Elements && m.Elements[index],
                        para = el && el.Paragraph;
                    if (!wc || !para) return;
                    var info = para.RecalculateCurPos(false, false, false, true);
                    var pos = wc.m_oDrawingDocument.ConvertCoordsToCursor(0, info.Y, info.PageNum);
                    if (!pos || pos.Error) return;
                    var sv = wc.m_oScrollVerApi,
                        // Follow the actual SDK overlay offset, including layouts with rulers.
                        over = wc.offsetTop || 0,
                        y = pos.Y - TOP_GAP - over + wc.m_dScrollY;
                    y = Math.max(0, Math.min(y, sv.getMaxScrolledY()));
                    sv.scrollToY(y);
                } catch (e) { /* the stock scroll remains */ }
            }, 0);
        },

        /* The number of headings is visible only on the collapsed rail: the expanded one
           shows the list itself, and a counter next to it would be a retelling
           of what is already on the screen. */
        updateCount: function () {
            this.$toggle.find('.vo-outline-count').text(this.items.length || '');
        },

        markCurrent: function () {
            var cur = this.current;
            this.$list.find('.vo-outline-item').each(function () {
                var idx = parseInt($(this).attr('data-index'), 10);
                $(this).toggleClass('on', idx === cur);
            });
        },

        /* --- Prohibition ----------------------------------------------------------- */
        /* Set by the shell, strictly by the options.navigation.disable key from the
           stock payload (CompactShell.applyEditingLock). The rail makes no decision of
           its own: in "Viewing" the stock code does not disable navigation, on loss of
           connection it does, and we repeat exactly that.

           What the stock code does on the same key: LeftMenu.SetDisabled disables the button
           btnNavigation and closes the left menu entirely. The rail is our double
           of this panel, so under the prohibition neither the toggle nor the rows respond.
           We chose not to close the rail forcibly: it has a memory of the choice
           (manual) and a width rule (applyFit), and lifting the prohibition would return
           to the user not the state they were in.

           We keep the state in a field, not only in a class: the handlers live under
           a disabled node, and the class does not stop them — the same rule as
           in SlashMenu. */

        locked: false,

        setLocked: function (lock) {
            this.locked = !!lock;
            if (!this.$el) return;
            this.$el.toggleClass('vo-locked', this.locked);
            this.$toggle && this.$toggle.attr('aria-disabled', this.locked ? 'true' : 'false');
        },

        /* --- State ------------------------------------------------------- */

        setOpen: function (open) {
            this.open = !!open;
            this.$el.toggleClass('open', this.open);
            document.body.classList.toggle('vo-outline-open', this.open);
            this.$toggle
                .attr('title', this.open ? this.tipHide : this.tipShow)
                .html(Icons.svg(this.open ? 'chevronL' : 'outline') +
                      '<span class="vo-outline-count"></span>');
            this.updateCount();
        },

        /* --- Place and state ------------------------------------------------ */

        /* The width is single and fixed. The rule looks neither at the page,
           nor at the gap to it, nor at the zoom: the rail always takes up space and
           gives up none of its width. The duplicate of the number in compact-shell.less (@vo-rail-w)
           — keep them in a pair, otherwise the strut will diverge from the column.

           160, not 180: at 1024 a width of 180 left the document 3px of scroll
           and a bar at the bottom of the canvas (measured 11.09). The truncation of headings, which
           the narrowing used to be paid for with, was removed by wrapping lines. */
        RAIL_W: 240,   // the ceiling of the column width; a pair to the fallback value @vo-rail-w
        /* Fluid width: 14.5% of the viewport width, not narrower than 160 and not wider than
           240 — 240 at a 1657 window, 160 toward a ~1100 window. Not called now:
           the column width is set by fitWidth by the margin to the left of the page. */
        railW: function () {
            return Math.round(Math.min(this.RAIL_W, Math.max(160, this.viewportWidth() * 0.145)));
        },
        /* The page sits at the center of the whole window, we take no space for the rail
           at all, and the column sits on the margin to the left of the page. Here — how much
           of this margin there is: from the left edge of the column to the left edge of the page minus
           24 px of spacing. The page edge is taken from the engine (drawingPage of the first
           page, CSS pixels from #id_main_view). No data — null, and
           the rule lives the old way. */
        RAIL_MIN: 140,
        GAP_TO_PAGE: 24,
        railSpace: function () {
            try {
                var dd = this.api.WordControl && this.api.WordControl.m_oDrawingDocument;
                var pg = dd && dd.m_arrPages && dd.m_arrPages[0];
                var mv = document.getElementById('id_main_view');
                if (!pg || !pg.drawingPage || !mv) return null;
                var pageLeft = mv.getBoundingClientRect().left + pg.drawingPage.left;
                return Math.floor(pageLeft - this.railOffset() - this.GAP_TO_PAGE);
            } catch (e) { return null; }
        },
        /* The column width = the margin, but not wider than RAIL_W. CSS takes it from
           --vo-rail-w (@vo-rail-w in compact-shell.less). */
        fitWidth: function (space) {
            var w = Math.max(this.RAIL_MIN, Math.min(this.RAIL_W, space == null ? this.RAIL_W : space));
            document.body.style.setProperty('--vo-rail-w', w + 'px');
        },

        /* The thresholds are separated: down at 900, up at 940. With a single number
           the state jitters when the window is dragged with the mouse across the boundary — this
           defect was caught by a measurement on 10.09 on the previous rule. */
        W_HIDE: 900,
        W_SHOW: 940,

        regime: 'wide',    // 'wide' | 'narrow' — changes with hysteresis
        manual: null,      // null | 'open' | 'closed' — the user's choice
        reserved: 0,

        /* The left edge of the rail. While the rail takes up space, it is first
           in the layout, that is, at zero. The collapsed one gives up the space — and then the pill
           must be shifted to the start of the canvas area, otherwise it will overlap
           the stock left panel (measured 10.09: the rail rows covered
           the comments panel). */
        railOffset: function () {
            if (this.reserved) return 0;
            var c = document.getElementById('editor-container');
            return c ? Math.round(c.getBoundingClientRect().left) : 0;
        },

        /* Positioning only, without recalculating the state. The stock code
           moves the left edge of #editor-container when opening the comments panel,
           and the rail width does not change from that at all — so
           THIS is subscribed to layout:changed, not the rule. place() does not
           touch the layout and creates no recursion. */
        place: function () {
            this.$el.css('left', this.railOffset() + 'px');
        },

        /* Width 0 means "we take no space": the node stays in the layout
           so as not to rebuild it on every switch. The column width
           is set by CSS — we no longer set an inline one of our own. */
        reserve: function (px) {
            this.reserved = px;
            DE.Views.CompactShell.reserveLeft(px);
            this.place();
        },

        /* The editor viewport width is the only thing the rule looks at.
           Not the browser window: the editor lives in an iframe or in a slider
           of the host page, and it must follow them. */
        viewportWidth: function () {
            return window.innerWidth || document.documentElement.clientWidth || 0;
        },

        /* In the band between the thresholds the band does not change — this is the hysteresis. */
        updateRegime: function () {
            /* The margin to the left of the page decides, not the window width. The hysteresis
               is the same in meaning: collapse below 140, expand above 160. */
            var space = this.railSpace();
            if (space != null) {
                if (space < this.RAIL_MIN) this.regime = 'narrow';
                else if (space > this.RAIL_MIN + 20) this.regime = 'wide';
                return this.regime;
            }
            var w = this.viewportWidth();
            if (w < this.W_HIDE) this.regime = 'narrow';
            else if (w > this.W_SHOW) this.regime = 'wide';
            return this.regime;
        },

        /* The whole rule. The previous measure was the engine's, which picked a step from
           the ladder; this one looks at a single number — the viewport width.

           Two defects of the 10.09 check also vanished from here ("a return from
           Advanced came with a collapsed rail"): measuring a hidden column
           is no longer needed, and the engine's intermediate geometry is
           irrelevant to the rule.

           And a third, found by the 11.09 measurement on the previous rule: having collapsed
           the rail once, it never expanded it AGAIN — the first line
           respected open === false and returned. It was enough to narrow once
           to a pill for the rail not to come back even at 1920. Here
           the expansion is symmetrical to collapsing. */
        applyFit: function () {
            var shell = DE.Views.CompactShell;
            if (!shell || shell.startupFailed || !shell.reserveLeft) return null;

            /* In Advanced the columns are managed by the stock interface, and the rail is
               hidden entirely — the space must be given up. */
            if (shell.advanced) { this.reserve(0); return 'advanced'; }

            /* The mode change is still going on — the layout has not settled. The recalculation will come
               itself when CompactShell clears the flag. */
            if (shell.modeSwitching) return null;

            var was = this.regime;
            var now = this.updateRegime();

            /* A band change cancels the manual choice: otherwise one click on the chevron
               would turn the automation off forever and the rail would never expand
               by itself. */
            if (now !== was) this.manual = null;

            var want = this.manual ? (this.manual === 'open') : (now === 'wide');
            if (want !== this.open) this.setOpen(want);

            /* We take no space for the rail in any form: the column sits
               on the margin to the left of the page (railSpace) and is fitted to its width
               (fitWidth). Expanding does not narrow the canvas, and the page
               does not jump to a new center. */
            this.reserve(0);
            this.fitWidth(this.railSpace());
            return this.open ? 'колонка' : 'пилюля';
        },

        toggle: function () {
            this.setOpen(!this.open);
            Common.localStorage.setItem('vo-outline-open', this.open ? 1 : 0);

            /* The manual choice is stronger than the automation — but only until the width band
               changes (see applyFit). Otherwise the automation would be turned off
               forever by the very first click. */
            this.manual = this.open ? 'open' : 'closed';

            /* Expanded — we need to take space, collapsed — to give it up.
               Recalculate after the animation. */
            var me = this;
            setTimeout(function () { me.applyFit(); }, 220);
        },

        /* --- Texts ------------------------------------------------------------ */
        /* Defaults are English: the locale overrides them with a translation from
           `locale/<language>.json`, and the editor has 44 languages without
           a translation — this is what is shown there. */

        textEmpty: 'Document headings will appear here',
        tipHide: 'Hide outline',
        tipShow: 'Show outline'

    }, DE.Views.OutlineRail || {});

    return DE.Views.OutlineRail;
});
