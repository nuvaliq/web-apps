/*
 * SelectionBubble — a floating panel at the selection in the compact shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The panel is contextual: its composition depends on what is selected. Before, it
 * showed text buttons on anything — on a table and a picture it offered
 * bold and color, which do not apply to them. That is worse than having no
 * panel: the interface promised an action that would not happen.
 *
 * The stock engine API for the context is complete:
 *
 *     asc_onFocusObject      → array of selected elements
 *     el.get_ObjectType()    → Asc.c_oAscTypeSelectElement
 *
 * Actions are items of the menu bar catalog (DocumentActions.runCommand): the
 * button behaves the same as the menu item and the toolbar button.
 * The formatting state comes from engine callbacks.
 *
 * For text and tables the position is taken from asc_GetSelectionBounds(),
 * for graphics — from the frame of the selected SDK objects.
 */
define([
    'documenteditor/main/app/view/Icons'
], function (Icons) {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    var ID = 'vo-bubble';

    DE.Views.SelectionBubble = _.extend({

        api: null,
        $el: null,
        btn: {},
        format: {},
        kind: 'text',
        dismissed: null,   // signature of the selection on which the panel was dismissed with Escape

        create: function (api) {
            if (!api || !api.asc_GetSelectionBounds) return this;
            if (this.active && this.api === api && this.$el && this.$el[0] === document.getElementById(ID)) {
                return this;
            }
            if (this.api) this.dispose();

            this.api = api;
            this.$el = $('#' + ID);
            if (!this.$el.length) this.$el = $('<div id="' + ID + '"></div>').appendTo('body');
            this.$el.empty();
            this.pending = this.imgProps = this.dismissed = null;
            this.kind = 'text';
            this.format = {};
            this.btn = {};

            this.bind();
            this.bindMenuLayer();
            return this;
        },

        bindMenuLayer: function () {
            var root = document.getElementById('vo-shell');
            if (!root || typeof MutationObserver !== 'function') return;
            if (this.menuLayerObserver) this.menuLayerObserver.disconnect();

            var me = this;
            function sync() {
                // Body-level dialogs keep their own stacking and visibility rules.
                var open = root.querySelector('.vo-mn-drop.open, .vo-pop-wrap.open, .vo-cb.open, #vo-tb.vo-of-open');
                me.$el.toggleClass('vo-under-menu', !!open);
            }
            this.menuLayerObserver = new MutationObserver(sync);
            this.menuLayerObserver.observe(root, {
                attributes: true, attributeFilter: ['class'], childList: true, subtree: true
            });
            sync();
        },

        /* --- Sets by context --------------------------------------------- */
        /* Each set is rebuilt when the context changes: keeping all the buttons
           in the DOM and hiding the extra ones means accumulating states that nobody
           synchronizes. */

        sets: function () {
            var me = this;
            /* A button with a counterpart in the menu bar calls the catalog item by key (k):
               one command — one behavior in the menu, "/", the bar and the bubble. */
            var run = function (k) {
                return function () {
                    var da = DE.Views.DocumentActions;
                    da && typeof da.runCommand === 'function' && da.runCommand(k);
                };
            };

            return {
                /* Text: the same as in the permanent part of the toolbar,
                   plus a link and a comment — they always apply to the selection. */
                text: [
                    {i: 'bold',      t: me.textBold,      state: 'bold',      run: run('format.text.bold')},
                    {i: 'italic',    t: me.textItalic,    state: 'italic',    run: run('format.text.italic')},
                    {i: 'underline', t: me.textUnderline, state: 'underline', run: run('format.text.underline')},
                    {i: 'strike',    t: me.textStrikeout, state: 'strike',    run: run('format.text.strikeout')},
                    {sep: true},
                    {i: 'clear', t: me.textClearStyle, when: 'ClearFormating', run: run('format.clear')},
                    {i: 'link',  t: me.textLink, run: run('insert.link')},
                    {i: 'comment', t: me.textComment, when: 'asc_addComment',
                     allow: function () { return DE.Views.CompactShell.canAddComment(); },
                     run: run('insert.comment')}
                ],

                /* Table: rows and columns. Before, they were nowhere except
                   the context menu on the canvas. */
                table: [
                    {i: 'rowAbove', t: me.textRowAbove,    when: 'addRowAbove',    run: run('format.table.rowAbove')},
                    {i: 'rowBelow', t: me.textRowBelow,    when: 'addRowBelow',    run: run('format.table.rowBelow')},
                    {i: 'colLeft',  t: me.textColumnLeft,  when: 'addColumnLeft',  run: run('format.table.colLeft')},
                    {i: 'colRight', t: me.textColumnRight, when: 'addColumnRight', run: run('format.table.colRight')},
                    {sep: true},
                    {i: 'merge',  t: me.textMergeCells,   when: 'MergeCells', run: run('format.table.merge')},
                    {i: 'rowDel', t: me.textRemoveRow,    when: 'remRow',     run: run('format.table.rowDel')},
                    {i: 'colDel', t: me.textRemoveColumn, when: 'remColumn',  run: run('format.table.colDel')},
                    {sep: true},
                    {i: 'panel', t: me.textTableProps, run: run('format.table.props')}
                ],

                /* Picture and shape: wrapping and order — items of "Format →
                   Image ▸" (DocumentActions.wrap, arrange: constants by
                   name and the transfer of the position from "in line with text"). */
                image: [
                    {i: 'wrapInline', t: me.textWrapInline,    run: run('format.image.wrapInline')},
                    {i: 'wrapSquare', t: me.textWrapSquare,    run: run('format.image.wrapSquare')},
                    {i: 'wrapTop',    t: me.textWrapTopBottom, run: run('format.image.wrapTopBottom')},
                    {sep: true},
                    {i: 'toFront', t: me.textToFront, run: run('format.image.toFront')},
                    {i: 'toBack',  t: me.textToBack,  run: run('format.image.toBack')},
                    {sep: true},
                    {i: 'panel', t: me.textObjectProps, run: run('format.image.props')}
                ]
            };
        },

        /* --- Assembly ----------------------------------------------------------- */

        renderSet: function (kind) {
            var me = this, api = this.api;
            if (this.kind === kind && this.$el.children().length) return;

            this.kind = kind;
            this.btn = {};
            this.$el.empty();

            var items = this.sets()[kind] || [];
            items.forEach(function (it) {
                if (it.sep) return me.$el.append($('<span class="vo-bubble-sep"></span>'));
                /* Actions that are not in this engine build are not drawn. */
                if (it.when && typeof api[it.when] !== 'function') return;
                /* Nor those that the document configuration does not allow:
                   `when` asks the engine, `allow` — the rights. The set is built
                   anew on every context change, so the predicate
                   is evaluated fresh. */
                if (it.allow && !it.allow()) return;

                var $b = $('<button type="button" class="vo-ib"></button>')
                    .attr('title', it.t)
                    .html(Icons.svg(it.i))
                    .on('mousedown', function (e) { e.preventDefault(); })
                    .on('click', function (e) { e.preventDefault(); it.run($b); });

                if (it.state) {
                    me.btn[it.state] = $b;
                    $b.toggleClass('on', !!me.format[it.state]);
                }
                me.$el.append($b);
            });
        },

        bind: function () {
            if (this.boundApi === this.api && this.active) return;
            if (this.boundApi) this.dispose();
            var me = this, api = this.api;
            this.active = true;
            this.boundApi = api;
            this.lifecycleGeneration = (this.lifecycleGeneration || 0) + 1;
            var generation = this.lifecycleGeneration;
            this.sdkCallbacks = [];
            this.notifications = [];
            this.modalNodes = $('.asc-window.modal:visible').toArray();
            var on = function (n, f) {
                var wrapped = me.guarded(f, generation, api);
                try {
                    api.asc_registerCallback(n, wrapped);
                    me.sdkCallbacks.push([n, wrapped]);
                } catch (e) { /* no callback */ }
            };
            var toggle = function (key, v) {
                /* The SDK reports the format before FocusObject and the deferred assembly of the
                   buttons; we save it also for the time other sets are shown. */
                me.format[key] = !!v;
                me.btn[key] && me.btn[key].toggleClass('on', !!v);
            };

            /* Button state — from the same callbacks as for the panel. */
            on('asc_onBold',      function (v) { toggle('bold', v); });
            on('asc_onItalic',    function (v) { toggle('italic', v); });
            on('asc_onUnderline', function (v) { toggle('underline', v); });
            on('asc_onStrikeout', function (v) { toggle('strike', v); });

            /* Context. asc_onFocusObject gives the stack of selected elements:
               a picture inside a table gives both, and the innermost must be taken —
               that is what the user selected. */
            on('asc_onFocusObject', function (elements) {
                if (me.detect(elements).state === 'known') me.scheduleRefresh();
            });

            var scrollbar = '#id_vertical_scroll, #id_horizontal_scroll';
            $(document).on('mouseup.voBubble keyup.voBubble', '#editor_sdk, #editor_sdk *', function (e) {
                if (!$(e.target).closest(scrollbar).length) me.scheduleRefresh();
            });
            /* A mouse press on the canvas is the start of a new selection, so it
               also clears the dismissal left by Escape (see dismiss). Without
               this a repeated click on the same picture would not bring the panel back:
               the selection bounds would match those on which it was dismissed. */
            $(document).on('mousedown.voBubble', '#editor_sdk', function (e) {
                if ($(e.target).closest(scrollbar).length) return;
                me.dismissed = null;
                me.suspend();
            });
            on('asc_onZoomChange', function () { me.suspend(); });
            $('#editor_sdk').on('scroll.voBubble wheel.voBubble', function () { me.onScroll(); });
            /* The stock modal window. The panel sits on body in a separate
               stacking context, and without this subscription it stayed
               hanging over the dimming — clickable, that is,
               formatting was applied with a dialog open. The stock code for
               the same case listens to exactly this notification
               (common/main/lib/component/Window.js:822 →
               controller/DocumentHolder.js:176). We hide, not dismiss:
               opening a dialog is not the user's choice against the panel, and
               the dismissed mark (kept by Escape) must not be touched. */
            this.notify('modal:show', function (dialog) {
                // The first show notification precedes rendering the dialog's DOM node.
                if (dialog && me.modalNodes.indexOf(dialog) === -1) me.modalNodes.push(dialog);
                me.suspend(true);
            });
            this.notify('modal:close modal:hide', function (dialog) {
                var count = me.modalNodes.length;
                var node = dialog && dialog.$window && dialog.$window[0];
                me.modalNodes = me.modalNodes.filter(function (item) { return item !== dialog && item !== node; });
                if (count && !me.modalNodes.length) me.restoreImage();
            });
            /* The left area opened or closed ("Search and replace",
               comments, navigation) — the document shifted sideways, and the panel
               would have stayed at the old coordinates over someone else's place. We place it
               anew by the same selection; a closed one is not touched. */
            this.notify('layout:changed', function (area) {
                if (area === 'leftmenu' && me.isOpen()) me.scheduleRefresh();
            });
            var layout = this.guarded(function () {
                me.bindScrollbars();
                if (me.isOpen() && me.kind === 'image') me.scheduleRefresh();
            }, generation, api);
            this.notify('layout:changed layout:resizestop', layout);
            $(window).on('resize.voBubble', layout);
            var viewport = DE.getController && DE.getController('Viewport');
            this.layout = viewport && viewport.viewport && viewport.viewport.hlayout;
            this.layoutChanged = layout;
            if (this.layout) this.layout.on('layout:resizedrag', layout);
            if (window.ResizeObserver) {
                this.positionObserver = new window.ResizeObserver(layout);
                ['editor_sdk', 'id_main_view'].forEach(function (id) {
                    var node = document.getElementById(id);
                    if (node) me.positionObserver.observe(node);
                });
            }
            on('asc_onDocumentContentReady', function () { me.bindScrollbars(); });
            on('asc_onUpdateScrolls', function () { me.bindScrollbars(); });
            this.bindScrollbars();
        },

        guarded: function (fn, generation, api) {
            var me = this;
            return function () {
                if (me.active && me.lifecycleGeneration === generation && me.api === api) {
                    return fn.apply(me, arguments);
                }
            };
        },

        notify: function (names, fn) {
            var wrapped = this.guarded(fn, this.lifecycleGeneration, this.api);
            Common.NotificationCenter.on(names, wrapped);
            this.notifications.push([names, wrapped]);
        },

        bindScrollbars: function () {
            var me = this, wc = this.api && this.api.WordControl;
            this.scrollbars = this.scrollbars || {};
            ['Ver', 'Hor'].forEach(function (axis) {
                var next = wc && wc['m_oScroll' + axis + 'Api'];
                var old = me.scrollbars[axis];
                if (old === next) return;
                var event = (axis === 'Ver' ? 'scrollvertical' : 'scrollhorizontal') + '.voBubble';
                if (old) old.unbind(event);
                delete me.scrollbars[axis];
                if (!next || typeof next.bind !== 'function' || typeof next.unbind !== 'function') return;
                next.bind(event, me.guarded(me.onScroll, me.lifecycleGeneration, me.api));
                me.scrollbars[axis] = next;
            });
        },

        onScroll: function () {
            this.suspend(true);
            // Wheel and SDK scrollbar events arrive in bursts.
            this.restoreImage(120);
        },

        restoreImage: function (delay) {
            if (this.imageIdentity && !this.modalNodes.length) this.scheduleRefresh(this.imageIdentity, delay);
        },

        suspend: function (keepImage) {
            this.invalidateRefresh();
            this.hide(keepImage);
        },

        dispose: function () {
            this.active = false;
            this.lifecycleGeneration = (this.lifecycleGeneration || 0) + 1;
            this.suspend();
            if (this.positionObserver) this.positionObserver.disconnect();
            if (this.menuLayerObserver) this.menuLayerObserver.disconnect();
            $(document).off('.voBubble');
            $(window).off('.voBubble');
            $('#editor_sdk').off('.voBubble');
            (this.notifications || []).forEach(function (entry) {
                Common.NotificationCenter.off(entry[0], entry[1]);
            });
            if (this.layout) this.layout.off('layout:resizedrag', this.layoutChanged);
            var api = this.boundApi;
            (this.sdkCallbacks || []).forEach(function (entry) {
                if (api && typeof api.asc_unregisterCallback === 'function') {
                    api.asc_unregisterCallback(entry[0], entry[1]);
                }
            });
            var bars = this.scrollbars || {};
            if (bars.Ver) bars.Ver.unbind('scrollvertical.voBubble');
            if (bars.Hor) bars.Hor.unbind('scrollhorizontal.voBubble');
            this.scrollbars = {};
            this.notifications = this.sdkCallbacks = [];
            this.positionObserver = this.menuLayerObserver = this.layout = this.boundApi = null;
            this.modalNodes = [];
        },

        classifyContext: function (elements) {
            var unknown = {state: 'unknown', kind: null, imgProps: null};
            var T = window.Asc && Asc.c_oAscTypeSelectElement;
            if (!T || !Array.isArray(elements) || !elements.length) return unknown;
            var names = ['Math', 'Image', 'Shape', 'Chart', 'Table'];
            for (var n = 0; n < names.length; n++) {
                if (typeof T[names[n]] !== 'number') return unknown;
            }

            var kind = 'text';
            var imageElements = [], unreadable = false, math = false;
            for (var i = 0; i < elements.length; i++) {
                var el = elements[i];
                var type;
                try {
                    if (!el || typeof el.get_ObjectType !== 'function') {
                        unreadable = true;
                        continue;
                    }
                    type = el.get_ObjectType();
                    if (typeof type !== 'number') unreadable = true;
                } catch (e) {
                    unreadable = true;
                    continue;
                }
                if (type === T.Math) math = true;
                if (type === T.Image || type === T.Shape || type === T.Chart) kind = 'image';
                else if (type === T.Table && kind === 'text') kind = 'table';
                if (type === T.Image) imageElements.push(el);
            }
            /* Math beats damaged neighbors and does not require properties. */
            if (math) return {state: 'math', kind: null, imgProps: null};
            if (unreadable) return unknown;
            var img = null;
            try {
                for (var j = 0; j < imageElements.length; j++) {
                    if (typeof imageElements[j].get_ObjectValue !== 'function') return unknown;
                    img = imageElements[j].get_ObjectValue();
                    if (!img || typeof img !== 'object') return unknown;
                }
            } catch (e) { return unknown; }
            return {state: 'known', kind: kind, imgProps: img};
        },

        detect: function (elements) {
            var context = this.classifyContext(elements);
            this.pending = context.kind;
            this.imgProps = context.imgProps;
            if (context.kind !== 'image') this.imageIdentity = null;
            if (context.state !== 'known') {
                this.invalidateRefresh();
                this.hide();
            }
            return context;
        },

        /* --- Escape ----------------------------------------------------------- */
        /* The panel closes on Escape. We do not create a listener of our own
           for that — the order of layers (surfaces → panel → chrome)
           is decided in one place, CompactShell.bindChromeEscape; the analysis of why
           a second listener on document is a bad idea is there too.

           Closing is not enough. After Escape the selection does not go anywhere, and refresh()
           is called on every mouseup and keyup on the canvas — the first one would have returned
           the panel, and Escape would look like a blink. So
           we remember the SIGNATURE of the selection on which the panel was dismissed, and stay silent
           until it changes.

           The signature is the set kind plus the selection bounds. They are moved by both
           Shift+arrow and a new selection with the mouse, that is, the panel returns
           exactly onto a new choice; scrolling and redrawing of the bounds do not change it.
           A simple "closed" flag would not be enough: there is nowhere to clear it —
           the engine has no separate "selection changed" event (see
           scheduleRefresh), — and hanging one more poll on it would mean
           introducing that very extra trip to the engine that
           hasSelection. */

        isOpen: function () {
            return !!(this.$el && this.$el.hasClass('open'));
        },

        bounds: function () {
            try {
                var points = this.api.asc_GetSelectionBounds(), nonzero = false;
                if (!Array.isArray(points) || !points.length) return null;
                for (var i = 0; i < points.length; i++) {
                    var p = points[i];
                    if (!p || p.length < 2 || !this.finite(p[0]) || !this.finite(p[1])) return null;
                    nonzero = nonzero || p[0] !== 0 || p[1] !== 0;
                }
                return nonzero ? points : null;
            } catch (e) { return null; }
        },

        finite: function (value) {
            return typeof value === 'number' && isFinite(value);
        },

        documentRect: function (id) {
            var el = document.getElementById(id);
            if (!el) return null;
            var r = el.getBoundingClientRect(), x = window.pageXOffset || 0, y = window.pageYOffset || 0;
            return {left: r.left + x, top: r.top + y, right: r.right + x, bottom: r.bottom + y};
        },

        readAnchor: function (context) {
            if (context.kind !== 'image') return null;
            try {
                var wc = this.api.WordControl, doc = wc && wc.m_oLogicDocument;
                var controller = doc && doc.DrawingObjects, dd = wc && wc.m_oDrawingDocument;
                if (!controller || !dd || typeof controller.getSelectedArray !== 'function' ||
                    typeof controller.getSelectedObjectsBounds !== 'function' ||
                    typeof dd.ConvertCoordsToCursor !== 'function') return null;
                var objects = controller.getSelectedArray(), ids = [], page;
                if (!objects || !objects.length) return null;
                var group = controller.selection && controller.selection.groupSelection;
                for (var i = 0; i < objects.length; i++) {
                    var object = objects[i];
                    if (!object || typeof object.Get_Id !== 'function') return null;
                    var id = object.Get_Id();
                    if (id === null || id === undefined || String(id) === '') return null;
                    id = String(id);
                    if (ids.indexOf(id) !== -1) return null;
                    ids.push(id);
                    var objectPage = group ? group.selectStartPage : object.selectStartPage;
                    if (i && objectPage !== page) return null;
                    page = objectPage;
                }
                var b = controller.getSelectedObjectsBounds(true), origin = this.documentRect('id_main_view');
                if (!b || !origin || !this.finite(page) || Math.floor(page) !== page || page < 0 ||
                    !dd.m_arrPages || page >= dd.m_arrPages.length || b.pageIndex !== page) return null;
                if (![b.minX, b.minY, b.maxX, b.maxY].every(this.finite) ||
                    b.maxX < b.minX || b.maxY < b.minY || b.maxX === b.minX && b.maxY === b.minY) return null;
                // The conversion already includes page position and document zoom, but no DOM offset.
                var a = dd.ConvertCoordsToCursor(b.minX, b.minY, page);
                var z = dd.ConvertCoordsToCursor(b.maxX, b.maxY, page);
                if (!a || !z || a.Error || z.Error || ![a.X, a.Y, z.X, z.Y].every(this.finite)) return null;
                return {kind: 'image', identity: 'image ' + JSON.stringify(ids.sort()), rect: {
                    left: a.X + origin.left, top: a.Y + origin.top,
                    right: z.X + origin.left, bottom: z.Y + origin.top
                }};
            } catch (e) { return null; }
        },

        availableRect: function () {
            var view = this.documentRect('id_main_view'), editor = this.documentRect('editor_sdk');
            if (!view || !editor) return null;
            var x = window.pageXOffset || 0, y = window.pageYOffset || 0;
            var area = {left: Math.max(view.left, editor.left, x), top: Math.max(view.top, editor.top, y),
                right: Math.min(view.right, editor.right, x + window.innerWidth),
                bottom: Math.min(view.bottom, editor.bottom, y + window.innerHeight)};
            // The toolbar card and compact status row can overlap the canvas without resizing it.
            var overlaps = function (rect) {
                return rect && rect.right > rect.left && rect.bottom > rect.top &&
                    rect.left < area.right && rect.right > area.left &&
                    rect.top < area.bottom && rect.bottom > area.top;
            };
            var toolbarCard = this.documentRect('vo-tb'), statusRow = this.documentRect('vo-status');
            if (overlaps(toolbarCard)) area.top = toolbarCard.bottom;
            if (overlaps(statusRow)) area.bottom = statusRow.top;
            return area;
        },

        placement: function (rect, area, size) {
            if (!area || !rect || !size || ![area.left, area.top, area.right, area.bottom,
                rect.left, rect.top, rect.right, rect.bottom, size.width, size.height].every(this.finite)) return null;
            var l = Math.max(rect.left, area.left), r = Math.min(rect.right, area.right);
            var t = Math.max(rect.top, area.top), b = Math.min(rect.bottom, area.bottom);
            if (r < l || b < t || r === l && b === t || size.width <= 0 || size.height <= 0 ||
                size.width > area.right - area.left - 16) return null;
            var left = Math.max(area.left + 8, Math.min((l + r - size.width) / 2, area.right - size.width - 8));
            // The SDK rotation handle can be above or below the frame, depending on its rotation.
            var clearance = 32;
            var top = t - size.height - clearance - 8;
            if (top < area.top + 8) top = b + clearance + 10;
            if (top + size.height > area.bottom - 8) {
                if (size.width > r - l - 16 || size.height > b - t - 16) return null;
                top = (t + b - size.height) / 2;
            }
            return {left: Math.round(left), top: Math.round(top)};
        },

        signature: function (p) {
            if (!p || !p.length) return null;
            var s = this.pending || 'text';
            for (var i = 0; i < p.length; i++) {
                if (p[i] && p[i].length >= 2) s += ' ' + p[i][0] + ':' + p[i][1];
            }
            return s;
        },

        /* The signature may fail to be produced — then a fallback value, just so the dismissal is
           non-empty: any real selection will give a different signature and the panel
           will return, and without a selection refresh() hides the panel itself. */
        dismiss: function () {
            var anchor = this.pending === 'image' && this.readAnchor({kind: 'image'});
            this.dismissed = anchor ? anchor.identity : this.signature(this.bounds()) || 'без границ';
            this.hide();
        },

        /* --- Showing ------------------------------------------------------------ */

        /* The shell mode. We read it at the moment of the call, not remember it at creation:
           the mode is switched by a button at any moment. A similar helper is in
           SlashMenu.advanced(). */
        advanced: function () {
            var shell = DE.Views.CompactShell;
            return !!(shell && shell.advanced);
        },

        /* The stock edit prohibition. The truth is kept by the stack of stock reasons, read
           by the shell (CompactShell.lockState) — we ask it, as with the mode. */
        locked: function () {
            var shell = DE.Views.CompactShell;
            return !!(shell && shell.editingLocked && shell.editingLocked());
        },

        /* A deferred recalculation — one for all sources. The delay is needed because
           the engine gives the selection bounds only after its event. One
           timer instead of a timer per event — because events come in bursts:
           the subscription selector is listed with commas, and jQuery queues
           a delegated handler at EACH matching level of
           bubbling (jquery.js:4924) — both on the descendant and on #editor_sdk itself;
           typing adds keyup for every key. Before, each such
           call started its own setTimeout and was wrapped in its own pass of
           refresh() — with an engine poll and a node measurement. */
        invalidateRefresh: function () {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
            this.refreshGeneration = (this.refreshGeneration || 0) + 1;
        },

        scheduleRefresh: function (expectedImage, delay) {
            if (this.active === false) return;
            this.invalidateRefresh();
            var me = this, generation = this.refreshGeneration;
            this.refreshTimer = setTimeout(function () {
                if (generation !== me.refreshGeneration) return;
                me.refreshTimer = null;
                me.refresh(expectedImage);
            }, delay || 10);
        },

        /* Whether there is a non-empty selection. We ask the same way the stock code
           decides whether "Copy" is available (DocumentHolderExt.js:1053):
           can_CopyCut() reduces to IsSelectionUse() && !IsSelectionEmpty()
           (sdkjs/word/Editor/Document.js:12928) and collects nothing.
           asc_GetSelectedText() for the same answer glues the whole selected
           text into a string — that is, it walks the whole selection on every
           mouse and keyboard event.

           It would be cheaper not to ask at all but to listen to the engine, but it has no separate
           "selection changed" event: asc_onSelectionEnd is sent
           only from private_MoveCursorUp/Down (Document.js:15149). The sources
           therefore stay the same — DOM events.

           try: can_CopyCut(), unlike asc_GetSelectedText(), goes into
           m_oLogicDocument directly (sdkjs/word/api.js:3128) and throws before the document
           is loaded. No method in the build — we ask the old way. */
        hasSelection: function () {
            var api = this.api;
            if (typeof api.can_CopyCut !== 'function')
                return !!(api.asc_GetSelectedText && api.asc_GetSelectedText());

            try { return !!api.can_CopyCut(); } catch (e) { return false; }
        },

        refresh: function (expectedImage) {
            var shell = DE.Views.CompactShell;
            if (this.active === false || shell && shell.startupFailed) return this.hide();
            if (this.modalNodes && this.modalNodes.length) return this.hide(true);
            /* In Advanced the panel is disabled by styles (compact-shell.less, the
               .vo-advanced block), but the handlers are alive. Without this line refresh()
               would keep polling the engine and put .open on an invisible node,
               and the class would survive until the return to the compact view — and the panel would pop up
               along with it, in the place of a long-removed selection. The other end of
               the same rule is in SlashMenu.bind()/show(). */
            if (this.advanced()) return this.hide();

            /* The edit prohibition is an early exit next to the advanced gate, and for the same
               reason: the panel is entirely about formatting, there are no safe buttons
               in it. We disable it rather than just not show it: the prohibition could have arrived
               while the panel was hanging at the selection. */
            if (this.locked()) return this.hide();
            if (expectedImage && expectedImage !== this.imageIdentity) return;

            this.bindScrollbars();

            var api = this.api;
            var elements;
            try {
                if (api && typeof api.getSelectedElements === 'function') elements = api.getSelectedElements();
            } catch (e) { /* The context is not available yet. */ }
            var context = this.detect(elements);
            if (context.state !== 'known') return;
            var kind = context.kind;

            var anchor = kind === 'image' && this.readAnchor(context);
            if (expectedImage && (!anchor || anchor.identity !== expectedImage)) return this.hide();

            /* The text panel is needed only for a non-empty selection: at the caret there is
               nothing to format. For objects it is the opposite — selecting an object
               is itself a reason to show the panel. */
            if (kind === 'text' && !this.hasSelection()) return this.hide();

            var p = kind === 'image' ? null : this.bounds();
            if (kind === 'image' ? !anchor : !p) return this.hide();

            /* The panel was dismissed with Escape and the selection is the same since — we stay silent.
               If it changed — we clear the dismissal right here: there is no separate place where
               a change of selection is known to us. */
            if (this.dismissed) {
                if (this.dismissed === (anchor ? anchor.identity : this.signature(p))) return this.hide();
                this.dismissed = null;
            }

            if (anchor) {
                this.imageIdentity = anchor.identity;
                this.renderSet(kind);
                if (!this.$el.children().length) return this.hide();
                this.$el.addClass('open');
                var position = this.placement(anchor.rect, this.availableRect(),
                    {width: this.$el.outerWidth(), height: this.$el.outerHeight()});
                if (!position) return this.hide(true);
                this.$el.css({left: position.left + 'px', top: position.top + 'px'});
                return;
            }

            var xs = [], ys = [];
            p.forEach(function (pt) {
                if (pt && pt.length >= 2) { xs.push(pt[0]); ys.push(pt[1]); }
            });
            if (!xs.length) return this.hide();

            this.renderSet(kind);
            if (!this.$el.children().length) return this.hide();

            /* Coordinates are counted from the canvas area, not from the page,
               so we add its offset. */
            var off = $('#editor_sdk').offset() || {left: 0, top: 0};
            var left = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 + off.left;
            var top  = Math.min.apply(null, ys) + off.top;

            this.$el.addClass('open');
            var w = this.$el.outerWidth(), h = this.$el.outerHeight();
            var x = Math.max(8, Math.min(left - w / 2, $(window).width() - w - 8));
            var y = top - h - 8;
            if (y < 8) y = Math.max.apply(null, ys) + off.top + 10;   // does not fit on top — put it below

            this.$el.css({left: Math.round(x) + 'px', top: Math.round(y) + 'px'});
        },

        hide: function (keepImage) {
            if (!keepImage) this.imageIdentity = null;
            this.$el && this.$el.removeClass('open');
        },

        /* --- Texts ------------------------------------------------------------ */
        /* Defaults are English: the locale overrides them with a translation from
           `locale/<language>.json`, and the editor has 44 languages without
           a translation — this is what is shown there. */

        textBold: 'Bold',
        textClearStyle: 'Clear formatting',
        textColumnLeft: 'Column left',
        textColumnRight: 'Column right',
        textComment: 'Comment',
        textItalic: 'Italic',
        textLink: 'Link',
        textMergeCells: 'Merge cells',
        textObjectProps: 'Object settings',
        textRemoveColumn: 'Delete column',
        textRemoveRow: 'Delete row',
        textRowAbove: 'Row above',
        textRowBelow: 'Row below',
        textStrikeout: 'Strikethrough',
        textTableProps: 'Table settings',
        textToBack: 'Send to back',
        textToFront: 'Bring to front',
        textUnderline: 'Underline',
        textWrapInline: 'In line with text',
        textWrapSquare: 'Square',
        textWrapTopBottom: 'Top and bottom'

    }, DE.Views.SelectionBubble || {});

    return DE.Views.SelectionBubble;
});
