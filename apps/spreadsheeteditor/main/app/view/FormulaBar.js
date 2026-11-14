/*
 * FormulaBar — the formula bar in the Compact shell of the spreadsheet editor.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The formula bar is entirely stock: the address "A1 ▾", fx, the field and the expand button are
 * CellEditor nodes (app/template/CellEditor.template), and we do not build them. In Compact
 * the #cell-editing-box node itself lives in the shell's plate, under the toolbar row (adopt):
 * in the stock layout it sits in the middle column, between the left and right side panels,
 * and with an open side column it would be narrower than the plate. Its place in the column
 * layout (celayout) is held by a hidden stub — the grid takes the whole column, and the stock
 * edge hides along with it; the plate height is driven by the shell
 * (CompactShell.formulaRowChanged), and the drag edge is our own, at the bottom of the plate
 * (grip). Switching to Stock and rolling back a failed launch return the node to its place (giveBack). Without a plate
 * (it was not built) the bar stays in its stock place and behaves as before.
 * What is ours here is the behavior of the bar in Compact:
 *  - at Compact start the bar is collapsed, whatever the previous session saved;
 *  - the expanded state does not survive the session: a snapshot of the stock keys
 *    sse-celleditor-expand / sse-celleditor-height is restored on pagehide,
 *    so the choice made in Compact does not change the stock sessions;
 *  - the height snaps to whole field lines: the snapping parameters
 *    of the stock edge are recalculated for our styles (row 36, field line 20 —
 *    resources/less/compact-shell.less) the same way as in the stock
 *    controller/Viewport.js onThemeChanged.
 * Expanding and collapsing are stock: CellEditor.expandEditorField (button
 * #ce-btn-expand) and CellEditor.changeCellEditorHeight. There are no commands of our own.
 *
 * Smoothness. The stock button handler changes the row height at once and
 * immediately sends layout:changed 'celleditor' — the layout (celayout.doLayout reads
 * the computed row height) and asc_Resize. During a height transition the layout would catch
 * the start of the transition, and a per-frame recalculation of the grid on a heavy sheet would jerk. So
 * a click on the button goes like this: an interceptor on window holds back the stock notification
 * (only it and only for the duration of the stock handler), and bubbling up to window
 * starts the transition — the row changes height with a 0.3 s @vo-ease transition, the grid area and
 * the edge move by a shift (transform) with the same transition. The canvas layout is one per
 * transition: for expanding at its end (the grid keeps the previous, larger height until the end
 * and slides down), for collapsing at the start (the grid immediately gets the larger height and
 * slides from the bottom up) — so there is no empty strip at the bottom edge of the grid. Dragging
 * the edge, programmatic height changes, Stock and "reduce motion" are stock and
 * instant: the transition class is on the row only for the duration of the click.
 * In the plate the row has no layout neighbors: only it changes height by transition, and the
 * grid area is moved by the shell with the same motion as the focus mode (moveRows), with
 * one canvas layout. The held-back stock click notification is then not
 * released: the bar no longer changes the column layout, the shell lays out the rows.
 *
 * The expand chevron is shown only when needed: while the cell is being edited (in the formula bar or in the
 * cell itself) and while the text of the selected cell does not fit in one field line; for an expanded
 * bar the styles always show the chevron — otherwise there is nothing to collapse it with. Here is the class of
 * the row (syncExpand); the display and transition are in resources/less/compact-shell.less.
 *
 * Auto-expand. While a cell is being edited, a collapsed bar whose text has stopped fitting (the field
 * would get a scrollbar) is expanded — by the stock button handler, to the same height and with the same
 * transition as with the chevron (toggle); at the end of editing a bar expanded this way is collapsed. What the person
 * did themselves during editing — with the chevron or the edge — is theirs: until the end of editing we neither expand the bar ourselves
 * nor collapse it at the end (byHand). Outside editing (selection, paste into a cell) — only the chevron.
 *
 * Wheel over the field. A plain wheel (without modifiers) over the row is swallowed on bubbling by the stock
 * handlers of its ancestors: the SDK on #viewport (sdkjs apiBase — mousewheel and DOMMouseScroll), in the plate also
 * the ribbon on #toolbar (controller/Viewport.js), in Safari — body (view/Viewport.js). The field's scrollbar
 * worked, the wheel and trackpad did not; in the stock place of the bar it is the same (SDK). A field that has something to
 * scroll does not let the event through to them (onWheel), and the browser scrolls it; scrolling does not
 * pass on beyond the field (overscroll-behavior — resources/less/compact-shell.less). Where there is nothing to
 * scroll, and for the wheel with modifiers (Ctrl — sheet zoom), the stock path applies. The same for the lists
 * of the shell (CompactShell.bindListScroll). Scrolling does not carry over to another text: the text of another
 * cell, a paste or an undo is shown in the field from the beginning (onSelection).
 */
define([], function () {
    'use strict';

    if (window.SSE === undefined) window.SSE = {};
    if (SSE.Views === undefined) SSE.Views = {};

    var KEY_EXPAND = 'sse-celleditor-expand',
        KEY_HEIGHT = 'sse-celleditor-height';

    /* Transition classes — a pair of rules in resources/less/compact-shell.less ("Formula bar"):
       the row changes height, the layout neighbors (the edge and the grid area) shift. */
    var ANIM_CLASS = 'vo-ce-anim',
        FOLLOW_CLASS = 'vo-ce-follow';
    /* Margin of the fallback timer on top of the transition duration: transitionend will not arrive in
       a hidden tab or when a transition is interrupted. */
    var END_SLACK = 120;
    /* The stub for the bar's place in the column layout and our own edge at the bottom of the plate — styles in
       resources/less/compact-shell.less ("Plate"); the body class is for the duration of dragging. */
    var HOME_CLASS = 'vo-ce-home',
        GRIP_CLASS = 'vo-ce-grip',
        DRAG_CLASS = 'vo-ce-dragging';
    /* Minimum height of the grid area while dragging the edge — the same as for the stock
       edge (view/Viewport.js: resize.max = -100 from the column height). */
    var GRID_MIN = 100;
    /* The expand chevron is needed (cell editing or text longer than the field line) — a row class; styles —
       resources/less/compact-shell.less ("Formula bar", .ce-group-expand). */
    var EXPAND_ON_CLASS = 'vo-ce-expand-on';
    /* Wheel event types — the same ones the SDK swallows and the shell lists catch (CompactShell.bindListScroll). */
    var WHEEL_EVENTS = ['wheel', 'mousewheel', 'DOMMouseScroll'];

    function jq(el) {
        var $ = window.jQuery || window.$;
        return typeof $ === 'function' ? $(el) : null;
    }

    /* The module is a dependency of the shell and cannot import it (that would make a
       loop), but by the first apply() its object has long been built: we take the guard from it. */
    function guard(label, fn) {
        var shell = SSE.Views.CompactShell;
        return shell && shell.guarded ? shell.guarded(label, fn) : fn;
    }

    SSE.Views.FormulaBar = {

        ANIM_CLASS: ANIM_CLASS,
        FOLLOW_CLASS: FOLLOW_CLASS,

        started: false,      // the first apply() has already collapsed the bar
        stored: null,        // snapshot of the stock keys at Compact start
        stockKeep: null,     // stock keep_height before our adjustment
        subs: null,
        holding: null,       // interception of the stock layout:changed for the duration of a click
        pending: null,       // click on the expand button between interception and bubbling
        anim: null,          // transition in progress
        releasing: false,    // our own layout: we do not treat it as foreign
        home: null,          // the bar in the plate: {stub, el, row} — the stub in the column and the stock el of the layout cell
        grip: null,          // our own edge at the bottom of the plate
        drag: null,          // edge drag in progress
        editing: false,      // the cell is being edited: from the engine's editStart to editEnd
        editEndTimer: null,  // chevron recalculation after the end of editing
        fieldText: null,     // field text at the previous selection: the new one is shown from the start (onSelection)
        auto: null,          // an edit is in progress: {mine — we expanded the bar ourselves, off — the person expanded, collapsed or dragged the edge themselves}
        autoTimer: null,     // the expand decision — after the engine step (queueAuto)

        /* Everything stock that we work with. If any link is missing, the module stays silent:
           an embedded editor (charts, mail merge) has no formula bar. */
        stock: function () {
            var ctl = SSE.getController('CellEditor');
            var editor = ctl && ctl.editor;
            var vp = SSE.getController('Viewport');
            var view = vp && vp.viewport;
            var ce = view && view.celayout;
            var item = ce && ce.getItem && ce.getItem('celleditor');
            if (!editor || !editor.$el || !item || !item.resize || !view.getCelleditorResizeOptions) return null;
            return {ctl: ctl, editor: editor, view: view, celayout: ce, item: item};
        },

        /* Compact is on: the shell's create() and the return from Stock. plate is the shell's
           plate that the bar goes into (after the toolbar row). */
        apply: function (plate) {
            var s = this.stock();
            if (!s) return;
            if (!this.started) {
                this.started = true;
                this.snapshotStored();
                this.bind(s);
                /* Collapsed regardless of the previous session. We collapse with the stock
                   button handler: it also removes the expand classes and
                   remembers the height for the next expand. The key it
                   writes at that point is restored by pagehide. */
                if (this.expanded(s)) s.ctl.expandEditorField();
            }
            this.adopt(s, plate);
            this.fit(s);
            this.syncExpand();
        },

        /* Switch to Stock: the bar goes back to the stock place, and the snapping and height are again per
           the stock styles. */
        release: function () {
            this.finish();
            this.endDrag();
            this.giveBack();
            var s = this.stock();
            if (!s || !this.started) return;
            this.fit(s);
        },

        /* --- The bar in the plate ------------------------------------------------ */

        /* The bar goes into the plate, and its place in the column layout is taken by a hidden stub
           (doLayout skips an invisible cell and hides its edge — autohide). The stub
           stands where the bar stood: the return puts the bar back in front of it. */
        adopt: function (s, plate) {
            if (this.home || !plate || typeof plate.appendChild !== 'function') return;
            var row = s.editor.$el[0];
            var parent = row && row.parentNode;
            var stub = document.createElement('div');
            var $stub = jq(stub);
            if (!parent || !$stub) return;
            stub.className = HOME_CLASS;
            stub.style.display = 'none';
            parent.insertBefore(stub, row);
            this.home = {stub: stub, el: s.item.el, row: row, item: s.item};
            s.item.el = $stub;
            plate.appendChild(row);
            plate.appendChild(this.makeGrip());
        },

        giveBack: function () {
            var h = this.home;
            if (!h) return;
            this.home = null;
            if (this.grip && this.grip.parentNode) this.grip.parentNode.removeChild(this.grip);
            if (h.stub.parentNode) {
                h.stub.parentNode.insertBefore(h.row, h.stub);
                h.stub.parentNode.removeChild(h.stub);
            }
            if (h.item.el && h.item.el[0] === h.stub) h.item.el = h.el;
        },

        /* The bar in the plate (rather than in the stock place). */
        inPlate: function () {
            return !!this.home;
        },

        /* A node inside the bar in the plate: for the shell this is not its control (engine keyboard,
           Escape, key hold), but the stock field. */
        owns: function (el) {
            var h = this.home;
            return !!h && !!el && el.nodeType === 1 && (el === h.row || (typeof h.row.contains === 'function' && h.row.contains(el)));
        },

        /* Bar height in the plate for the shell's rows: 0 — the bar is not in the plate or it is
           hidden (stock "View → Formula Bar" — display: none on the node itself). In the middle of
           a transition — the final height: the shell lays out the rows for it. Without a transition —
           the height by style (the inline one is written by stock, not less than min-height), not a measurement:
           in a hidden plate a measurement would give 0. */
        plateRowHeight: function () {
            var h = this.home;
            if (!h) return 0;
            var row = h.row;
            if (window.getComputedStyle && window.getComputedStyle(row).display === 'none') return 0;
            if (this.anim && this.anim.row === row) return this.anim.h1;
            var cs = window.getComputedStyle ? window.getComputedStyle(row) : null;
            var min = cs ? parseFloat(cs.minHeight) || 0 : 0;
            return Math.max(parseFloat(row.style.height) || 0, min);
        },

        /* Tell the shell that the bar height in the plate changed; moving — by motion. As the row
           height changes, so does the number of field lines visible — the chevron is recalculated. */
        toShell: function (moving) {
            this.syncExpand();
            var shell = SSE.Views.CompactShell;
            if (shell && typeof shell.formulaRowChanged === 'function') shell.formulaRowChanged(!!moving);
        },

        /* --- Own edge ---------------------------------------------------- */
        /* The stock edge stayed in the column layout (the stub hides it there): its calculation
           is tied to positions inside the column. Ours is a strip at the bottom of the plate: as you drag, the bar
           height snaps to the same grid as the stock one (offset + k·koeff, resize.multiply),
           from one line to the height at which GRID_MIN is left for the grid. Each grid step is
           a layout of the shell's rows (without a transition); on release — stock accounting, as with the stock
           edge (CellEditor.onLayoutResize: expand classes and keys) and afterDrag. */
        makeGrip: function () {
            if (this.grip) return this.grip;
            var me = this, grip = document.createElement('div');
            grip.className = GRIP_CLASS;
            grip.setAttribute('aria-hidden', 'true');
            var onDown = guard('formula bar: grip', function (e) { me.dragStart(e); });
            grip.addEventListener('pointerdown', onDown);
            this.grip = grip;
            return grip;
        },

        dragStart: function (e) {
            if (!e || (e.button !== undefined && e.button !== 0)) return;
            var s = this.stock();
            if (!s || !this.home || this.drag) return;
            this.finish();
            var me = this, total = this.total(s);
            var d = this.drag = {y: e.clientY, from: total, last: total, max: this.maxTotal(s, total), handlers: null};
            var onMove = guard('formula bar: grip move', function (ev) { me.dragMove(ev); });
            var onUp = guard('formula bar: grip end', function () { me.endDrag(true); });
            d.handlers = {move: onMove, up: onUp};
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
            document.body.classList.add(DRAG_CLASS);
            e.preventDefault && e.preventDefault();
        },

        dragMove: function (e) {
            var d = this.drag, s = this.stock();
            if (!d || !s || !e) return;
            var t = this.snapDrag(d.from + (e.clientY - d.y), s, d.max);
            if (t === d.last) return;
            d.last = t;
            s.editor.$el.height(t - this.border(s));
            this.toShell(false);
        },

        /* commit — the person released the edge: stock accounting. Without it — an abort (switch to Stock). */
        endDrag: function (commit) {
            var d = this.drag;
            if (!d) return;
            this.drag = null;
            window.removeEventListener('pointermove', d.handlers.move);
            window.removeEventListener('pointerup', d.handlers.up);
            window.removeEventListener('pointercancel', d.handlers.up);
            document.body.classList.remove(DRAG_CLASS);
            var s = this.stock();
            if (!commit || !s || d.last === d.from) return;
            this.byHand();
            if (typeof s.ctl.onLayoutResize === 'function') s.ctl.onLayoutResize(s.celayout, 'cell:edit');
            this.afterDrag();
            this.syncExpand();
        },

        /* The nearest edge grid height, from one line to max — like the stock resizeMove. */
        snapDrag: function (want, s, max) {
            var m = s.item.resize && s.item.resize.multiply, row = this.rowHeight(s);
            var t = want;
            if (m && m.koeff) t = (m.offset || 0) + Math.round((want - (m.offset || 0)) / m.koeff) * m.koeff;
            return Math.max(row, Math.min(t, max));
        },

        /* The maximum height: the bar and the grid area share the height, and the grid gets at least GRID_MIN;
           down along the edge's grid. */
        maxTotal: function (s, total) {
            var sdk = document.getElementById('editor_sdk');
            var grid = sdk && typeof sdk.getBoundingClientRect === 'function' ? sdk.getBoundingClientRect().height : 0;
            var room = total + grid - GRID_MIN;
            var m = s.item.resize && s.item.resize.multiply;
            if (m && m.koeff) room = (m.offset || 0) + Math.floor((room - (m.offset || 0)) / m.koeff) * m.koeff;
            return Math.max(this.rowHeight(s), room);
        },

        /* Rollback of a failed launch: stock parameters, the stock key at once and without
           subscriptions. A bar that was expanded on entry is expanded back — by the same
           stock handler that collapsed it. */
        dispose: function () {
            this.finish();
            this.endDrag();
            /* The bar goes to the stock place before any layout: below it, stock does the layout. */
            this.giveBack();
            this.dropPending();
            if (this.unhold()) this.relayout();
            var s = this.stock();
            (this.subs || []).splice(0).forEach(function (off) { off(); });
            clearTimeout(this.editEndTimer);
            this.editEndTimer = null;
            clearTimeout(this.autoTimer);
            this.autoTimer = null;
            this.auto = null;
            this.editing = false;
            this.fieldText = null;
            if (s) s.editor.$el.removeClass(EXPAND_ON_CLASS);
            if (!this.started) return;
            var wasExpanded = this.stored && this.stored[KEY_EXPAND] !== null && parseInt(this.stored[KEY_EXPAND], 10) !== 0;
            if (s) {
                if (this.stockKeep !== null) s.editor.keep_height = this.stockKeep;
                this.fit(s);
                if (wasExpanded && !this.expanded(s)) s.ctl.expandEditorField();
            }
            this.restoreStored();
            this.started = false;
        },

        expanded: function (s) {
            return s.editor.$el.hasClass('expanded');
        },

        snapshotStored: function () {
            var ls = Common.localStorage;
            this.stored = {};
            this.stored[KEY_EXPAND] = ls.getItem(KEY_EXPAND);
            this.stored[KEY_HEIGHT] = ls.getItem(KEY_HEIGHT);
        },

        restoreStored: function () {
            var ls = Common.localStorage, stored = this.stored;
            if (!stored) return;
            Object.keys(stored).forEach(function (key) {
                if (stored[key] === null) ls.removeItem(key);
                else ls.setItem(key, stored[key]);
            });
        },

        bind: function (s) {
            var me = this;
            this.subs = [];

            var onHide = guard('formula bar: pagehide', function () { me.restoreStored(); });
            window.addEventListener('pagehide', onHide);
            this.subs.push(function () { window.removeEventListener('pagehide', onHide); });

            /* After the stock edge handler (it is subscribed in Viewport.onLaunch,
               earlier than us). Stock considers the bar expanded at a height above
               19 — numbers for row 20. Ours is row 36, and a single line that the edge
               was dragged to ended up "expanded": the button showed
               collapse, and its next click remembered 36 as the expand
               height — the bar no longer expanded. We return such a
               bar to the collapsed state with the same stock classes and key. */
            var onDrag = guard('formula bar: resize', function () {
                if (SSE.Views.CompactShell && SSE.Views.CompactShell.advanced) return;
                me.afterDrag();
            });
            s.celayout.on('layout:resizedrag', onDrag);
            this.subs.push(function () { s.celayout.off && s.celayout.off('layout:resizedrag', onDrag); });

            /* Smooth expand: a click on the expand button — interception on window
               (before the stock button handler), bubbling to window (after it). */
            var onCapture = guard('formula bar: expand click', function (e) { me.onClickCapture(e); });
            var onBubble = guard('formula bar: expand click end', function () { me.onClickBubble(false); });
            window.addEventListener('click', onCapture, true);
            window.addEventListener('click', onBubble);
            this.subs.push(function () {
                window.removeEventListener('click', onCapture, true);
                window.removeEventListener('click', onBubble);
            });

            /* A press in the middle of a transition (edge, grid, field) ends the transition at once:
               the stock drag and the engine read the layout, but for an expand it does not exist
               until the end of the transition. pointerdown in capture — the engine swallows mousedown over the grid.
               The expand button is not here: its click ends the
               previous transition itself and starts the reverse one from the current height. */
            var onPress = guard('formula bar: press during transition', function (e) {
                if (!me.anim || (e && me.isExpandButton(e.target))) return;
                me.finish();
            });
            window.addEventListener('pointerdown', onPress, true);
            this.subs.push(function () { window.removeEventListener('pointerdown', onPress, true); });

            /* A foreign layout in the middle of a transition (window resize, panels) caught the row
               halfway — at the end of the transition the layout is repeated once. */
            var onLayout = function () { if (me.anim && !me.releasing) me.anim.others++; };
            Common.NotificationCenter.on('layout:changed', onLayout);
            this.subs.push(function () { Common.NotificationCenter.off('layout:changed', onLayout); });

            /* The expand chevron only when needed. Cell editing — the engine's asc_onEditCell. The text of the selected
               cell is put into the field by the engine before asc_onSelectionChanged — both on selection and after
               paste or undo (they have no editing). How many field lines the text takes is also changed by the
               window width and the row height: stock collapse and expand without a transition (layout:changed),
               the end of a transition (finish), the edge (toShell, endDrag). By the same asc_onSelectionChanged
               the new text in the field is shown from the start (onSelection). The text in the edit field is changed by typing — in the cell and
               in the field, paste, Alt+Enter: asc_onEditorSelectionChanged, the engine updated the field before it (on
               it stock also checks the field scroll, CellEditor.onCellEditorTextChange) — auto-expand. */
            var api = s.ctl.api;
            if (api && typeof api.asc_registerCallback === 'function') {
                var onEdit = guard('formula bar: edit cell', function (state) { me.onEditCell(state); });
                var onSelect = guard('formula bar: selection', function () { me.onSelection(); });
                var onText = guard('formula bar: editor text', function () { me.queueAuto(); });
                api.asc_registerCallback('asc_onEditCell', onEdit);
                api.asc_registerCallback('asc_onSelectionChanged', onSelect);
                api.asc_registerCallback('asc_onEditorSelectionChanged', onText);
                this.subs.push(function () {
                    if (typeof api.asc_unregisterCallback !== 'function') return;
                    api.asc_unregisterCallback('asc_onEditCell', onEdit);
                    api.asc_unregisterCallback('asc_onSelectionChanged', onSelect);
                    api.asc_unregisterCallback('asc_onEditorSelectionChanged', onText);
                });
                /* Editing could have started before Compact (the launch retry loop) — a stock flag. */
                this.editing = !!api.isCellEdited;
                this.auto = this.editing ? {mine: false, off: false} : null;
            }
            /* The window got narrower — the text in the edit field may stop fitting: both the chevron and auto-expand. */
            var onFit = guard('formula bar: chevron', function () { me.syncExpand(); me.queueAuto(); });
            window.addEventListener('resize', onFit);
            Common.NotificationCenter.on('layout:changed', onFit);
            this.subs.push(function () {
                window.removeEventListener('resize', onFit);
                Common.NotificationCenter.off('layout:changed', onFit);
            });

            /* Wheel over the field — on the row itself: below the stock handlers that swallow it. */
            var row = s.editor.$el[0];
            if (row && typeof row.addEventListener === 'function') {
                var onWheel = guard('formula bar: wheel', function (e) { me.onWheel(e); });
                WHEEL_EVENTS.forEach(function (type) { row.addEventListener(type, onWheel); });
                this.subs.push(function () {
                    WHEEL_EVENTS.forEach(function (type) { row.removeEventListener(type, onWheel); });
                });
            }
        },

        /* The selection changed. When the value changes, the stock textarea keeps the previous scrollTop: scrolled
           the field (with the wheel or the bar) and selected another cell — its text would not be shown in the field from the start.
           New text outside editing (selection, paste, undo) — from the start, the same text — where it was. In the middle of
           editing (selecting formula references) and in Stock we do not touch the field. Then — the chevron by the text. */
        onSelection: function () {
            var shell = SSE.Views.CompactShell;
            var s = !this.editing && !(shell && shell.advanced) ? this.stock() : null;
            var ta = s && s.editor.$cellcontent && s.editor.$cellcontent[0];
            if (ta) {
                if (this.fieldText !== null && ta.value !== this.fieldText) ta.scrollTop = 0;
                this.fieldText = ta.value;
            }
            this.syncExpand();
        },

        /* A plain wheel over a field that has something to scroll does not go beyond the row: the browser
           scrolls it, and the stock handlers of the ancestors do not swallow it. Everything else is stock. In Stock
           the bar is stock. */
        onWheel: function (e) {
            var shell = SSE.Views.CompactShell;
            if (!e || (shell && shell.advanced) || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
            var s = this.stock();
            var ta = s && s.editor.$cellcontent && s.editor.$cellcontent[0];
            if (!ta || !(e.target === ta || (typeof ta.contains === 'function' && ta.contains(e.target)))) return;
            if (ta.scrollHeight <= ta.clientHeight + 1 && ta.scrollWidth <= ta.clientWidth + 1) return;
            e.stopPropagation();
        },

        /* --- The expand chevron when needed ----------------------------------------- */

        /* Cell editing — from editStart to editEnd (intermediate states are the same edit), as the
           stock CellEditor.onApiEditCell sets api.isCellEdited. At the end of editing — recalculation
           at once and once more after all subscribers: Escape returns the previous cell text to the field,
           and the engine may not have updated the field by that moment. The start of editing — auto-expand if the cell
           text no longer fits (F2, double click, click in the field); the end — collapsing of what was expanded automatically. */
        onEditCell: function (state) {
            var st = window.Asc && Asc.c_oAscCellEditorState;
            if (!st || (state !== st.editStart && state !== st.editEnd)) return;
            this.editing = state === st.editStart;
            this.syncExpand();
            clearTimeout(this.editEndTimer);
            this.editEndTimer = null;
            if (this.editing) {
                this.auto = {mine: false, off: false};
                this.queueAuto();
                return;
            }
            this.endAuto();
            var me = this;
            this.editEndTimer = setTimeout(guard('formula bar: chevron after edit', function () {
                me.editEndTimer = null;
                me.syncExpand();
            }), 0);
        },

        /* The row class: the chevron is needed — the cell is being edited or the text does not fit in the field line.
           An expanded bar is shown by the styles with the chevron even without the class (stock .expanded). In
           Stock — nothing: there the bar is stock, and the recalculation is done by the return to Compact (apply). */
        syncExpand: function () {
            var shell = SSE.Views.CompactShell;
            if (!this.started || (shell && shell.advanced)) return;
            var s = this.stock();
            if (!s) return;
            s.editor.$el[this.editing || this.longText(s) ? 'addClass' : 'removeClass'](EXPAND_ON_CLASS);
        },

        /* The text in the field does not fit on one line. The field is a stock textarea with wrapping (white-space:
           pre-wrap of stock): both long text and a line break give a second line, and the field's scrollHeight is
           greater than one line by the paddings and line spacing. Stock compares scrollHeight with the field height
           (CellEditor.cellEditorTextChange) — here with one line: in an expanded bar and in the middle of
           a transition the field is taller, short text would "fit" in it, and the chevron would disappear halfway through collapsing.
           scrollHeight not less than the field height — the answer there is "does not fit": the chevron in an expanded bar
           is needed anyway, and at the end of collapsing — a recalculation. Wider than the field — in case of a field without wrapping.
           A hidden field (the bar is hidden) — 0, there is nothing to overflow. */
        longText: function (s) {
            var ta = s.editor.$cellcontent && s.editor.$cellcontent[0];
            if (!ta || !window.getComputedStyle) return false;
            var cs = window.getComputedStyle(ta);
            var line = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.lineHeight) || 0) + (parseFloat(cs.paddingBottom) || 0);
            return ta.scrollHeight > line + 1 || ta.scrollWidth > ta.clientWidth + 1;
        },

        /* --- Auto-expand ------------------------------------------------------ */

        /* The bar is in Compact and the module is running: in Stock the bar is stock. */
        canAuto: function () {
            var shell = SSE.Views.CompactShell;
            return this.started && !(shell && shell.advanced);
        },

        /* The decision — after the engine step: typing over a long cell in one step puts into the field first its
           previous text, then the new one (a live measurement), and an expand by the previous one would be in vain. Steps of one edit
           that arrived before the timer are decided in one go. */
        queueAuto: function () {
            var a = this.auto;
            if (!a || a.off || this.autoTimer !== null) return;
            var me = this;
            this.autoTimer = setTimeout(guard('formula bar: auto expand', function () {
                me.autoTimer = null;
                me.autoExpand();
            }), 0);
        },

        /* An edit is in progress, the bar is collapsed, the text in the field does not fit on one line — we expand. An expanded one,
           a hidden one (the field has no box — longText 0) and one the person touched themselves in this edit — we do not. */
        autoExpand: function () {
            var a = this.auto;
            if (!a || a.off || !this.canAuto() || this.drag || this.pending) return;
            var s = this.stock();
            if (!s || this.expanded(s) || !this.longText(s)) return;
            a.mine = true;
            this.toggle(s);
        },

        /* End of editing (Enter, Escape, Tab, a click elsewhere): a bar expanded automatically is collapsed the same way. */
        endAuto: function () {
            clearTimeout(this.autoTimer);
            this.autoTimer = null;
            var a = this.auto;
            this.auto = null;
            var s = a && a.mine && this.canAuto() && !this.drag ? this.stock() : null;
            if (s && this.expanded(s)) this.toggle(s);
        },

        /* During editing the person expanded, collapsed or dragged the edge themselves — the bar is theirs until the end of editing. */
        byHand: function () {
            if (!this.auto) return;
            this.auto.off = true;
            this.auto.mine = false;
        },

        /* Our own expand or collapse — the same way as a button click: interception (beginToggle), the stock
           button handler, bubbling (onClickBubble). The stock handler sends edit:complete — a request to
           return focus after a button press. There was no press: Main.onEditComplete would give focus to the sheet
           in the middle of typing in the field (isCEditorFocused is false there — a live measurement). We do not let it through (quietly). */
        toggle: function (s) {
            var me = this;
            this.beginToggle();
            try {
                this.quietly(function () { s.ctl.expandEditorField(); });
            } finally {
                me.onClickBubble(false);
            }
        },

        /* fn without edit:complete; everything else on the bus goes as is. The trigger substitution is the bus's own, as in hold. */
        quietly: function (fn) {
            var NC = Common.NotificationCenter;
            var own = Object.prototype.hasOwnProperty.call(NC, 'trigger'), orig = NC.trigger;
            NC.trigger = function (name) {
                return name === 'edit:complete' ? this : orig.apply(this, arguments);
            };
            try {
                fn();
            } finally {
                if (own) NC.trigger = orig;
                else delete NC.trigger;
            }
        },

        /* --- Smooth expand ------------------------------------ */

        reducedMotion: function () {
            try {
                return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            } catch (e) {
                return false;
            }
        },

        canAnimate: function (s) {
            var shell = SSE.Views.CompactShell;
            if (!s || (shell && shell.advanced) || !document.body.classList.contains('vo-compact')) return false;
            if (this.reducedMotion()) return false;
            var row = s.editor.$el[0];
            return !!(row && row.parentNode && row.style && row.classList);
        },

        isExpandButton: function (target) {
            var btn = target && typeof target.closest === 'function' ? target.closest('#ce-btn-expand') : null;
            return !!btn && !btn.disabled;
        },

        /* Interception: the row height before the stock handler and the held-back layout:changed.
           h0 — where the row is on screen now (in the middle of a transition — intermediate), taken before
           the abort: the reverse transition will start from this place. The previous transition — straight to
           the end (finish aborts it and releases its layout): the stock handler decides
           "expand or collapse" and remembers the expand height by the final height,
           not by the height halfway. base — the row height that the grid is now laid out for
           (after an abort — the final height of the previous transition). A click on the button during editing is
           the person's choice (byHand). */
        onClickCapture: function (e) {
            if (!e || !this.isExpandButton(e.target)) return;
            this.byHand();
            if (!this.beginToggle()) return;
            var me = this;
            /* Bubbling could have been aborted — then the notification is released without a transition. */
            this.pending.safety = setTimeout(guard('formula bar: expand click lost', function () {
                me.onClickBubble(true);
            }), 0);
        },

        /* Before the stock button handler — common to a click and our own expand (toggle). false — without a transition. */
        beginToggle: function () {
            var s = this.stock();
            var row = s && s.editor.$el[0];
            var h0 = this.shownHeight(row);
            this.finish();
            this.dropPending();
            if (!this.canAnimate(s)) return false;
            this.hold();
            this.pending = {h0: h0, base: this.shownHeight(row), safety: null};
            return true;
        },

        /* The row height on screen (in the middle of a transition — intermediate). */
        shownHeight: function (row) {
            return row && row.getBoundingClientRect ? row.getBoundingClientRect().height : 0;
        },

        /* Bubbling: the stock handler has run, the row height is already the stock final one. */
        onClickBubble: function (lost) {
            var p = this.pending;
            if (!p) return;
            this.pending = null;
            clearTimeout(p.safety);
            var held = this.unhold();
            var s = this.stock();
            var row = s && s.editor.$el[0];
            var h1 = row ? this.shownHeight(row) : p.h0;
            if (lost || !held || !row || Math.abs(h1 - p.h0) < 0.5) {
                if (held) this.relayout();
                return;
            }
            var expand = h1 > p.h0;
            /* In the plate: only the row goes by transition, the shell's rows (and with them the grid area)
               are moved by the shell — with the same transition, with one canvas layout. The held-back
               notification is not released: the bar does not change the column layout. */
            if (this.home) {
                this.animate(row, p.h0, h1, false, h1, true);
                this.toShell(true);
                return;
            }
            /* Collapse: the layout is now — the row is still without a transition, the layout sees its
               final height, and the grid immediately gets the larger height. */
            if (!expand) this.relayout();
            this.animate(row, p.h0, h1, expand, expand ? p.base : h1);
        },

        dropPending: function () {
            if (!this.pending) return;
            clearTimeout(this.pending.safety);
            this.pending = null;
            if (this.unhold()) this.relayout();
        },

        /* The stock layout:changed 'celleditor' is held back only for the duration of a click:
           the trigger substitution is the bus's own, everything else passes as is. */
        hold: function () {
            if (this.holding) return;
            var NC = Common.NotificationCenter, me = this;
            var h = this.holding = {own: Object.prototype.hasOwnProperty.call(NC, 'trigger'), orig: NC.trigger, held: false};
            NC.trigger = function (name, area) {
                if (me.holding === h && name === 'layout:changed' && area === 'celleditor' && arguments.length === 2) {
                    h.held = true;
                    return this;
                }
                return h.orig.apply(this, arguments);
            };
        },

        /* Remove the interception; true — the notification was held back and is waiting to be released. */
        unhold: function () {
            var h = this.holding;
            if (!h) return false;
            this.holding = null;
            var NC = Common.NotificationCenter;
            if (h.own) NC.trigger = h.orig;
            else delete NC.trigger;
            return h.held;
        },

        /* Release the layout by the stock path: Viewport.onLayoutChanged — celayout.doLayout
           and asc_Resize, their subscribers (the shell, the search bar) — as usual. */
        relayout: function () {
            this.releasing = true;
            try {
                Common.NotificationCenter.trigger('layout:changed', 'celleditor');
            } finally {
                this.releasing = false;
            }
        },

        /* FLIP: the initial state without a transition, a forced read, the final one — under
           the transition classes. The row — from h0 (where it is on screen) to the stock height; the layout
           neighbors (the edge and the grid area) — by a shift that keeps them at the bottom of the row in
           every frame. The grid is laid out for the row height base, so the shift is from h0 − base
           to h1 − base: for an expand base is the previous height (the layout is deferred until the end;
           after an interrupted collapse it is already the collapsed one, and the row does not start from it), for
           a collapse base = h1 (the layout is already final, the shift ends at zero).
           alone — the row is in the plate: there are no neighbors, the layout is driven by the shell (a.plate). */
        animate: function (row, h0, h1, expand, base, alone) {
            var me = this;
            var followers = alone ? [] : Array.prototype.filter.call(row.parentNode.children, function (el) { return el !== row; });
            var shift = function (px) { return Math.abs(px) >= 0.01 ? 'translateY(' + px + 'px)' : ''; };
            var target = row.style.height;
            var a = {row: row, followers: followers, deferred: expand, others: 0, timer: null, onEnd: null, h1: h1, plate: !!alone,
                     transforms: followers.map(function (el) { return el.style.transform || ''; })};

            row.style.height = h0 + 'px';
            followers.forEach(function (el) { el.style.transform = shift(h0 - base); });
            void row.offsetHeight;

            row.classList.add(ANIM_CLASS);
            followers.forEach(function (el) { el.classList.add(FOLLOW_CLASS); });
            row.style.height = target;
            followers.forEach(function (el) { el.style.transform = shift(h1 - base); });

            this.anim = a;
            a.onEnd = guard('formula bar: transition end', function (e) {
                if (e && (e.target !== row || e.propertyName !== 'height')) return;
                /* The abort of the previous transition (finish before the second click) is dispatched by the browser as an
                   event later, in a frame — already to this transition. While the row is moving, it is not it. */
                if (e && e.type === 'transitioncancel' && me.heightRunning(row)) return;
                if (me.anim === a) me.finish();
            });
            row.addEventListener('transitionend', a.onEnd);
            row.addEventListener('transitioncancel', a.onEnd);
            var dur = (parseFloat(window.getComputedStyle(row).transitionDuration) || 0) * 1000;
            a.timer = setTimeout(a.onEnd, dur + END_SLACK);
        },

        /* The end of a transition (or its abort): the classes and shifts are removed with the same motion
           in which the layout is released — there is no frame between them. In the middle of a transition (a press,
           a second click, a switch to Stock) removing the class does not abort the transition: at rest the row
           and neighbors have transition — `all 0s`, the height is in the property list, and a running
           transition, per the CSS Transitions specification, goes on with the previous duration, since the
           end is the same. Then the layout and the stock handler would read the row halfway.
           Only transition-property: none aborts it — inline for a single style read: the row and
           neighbors at once take the final state, then the inline is returned. */
        finish: function () {
            var a = this.anim;
            if (!a) return;
            this.anim = null;
            clearTimeout(a.timer);
            a.row.removeEventListener('transitionend', a.onEnd);
            a.row.removeEventListener('transitioncancel', a.onEnd);
            var nodes = [a.row].concat(a.followers);
            var inline = nodes.map(function (el) { return el.style.transition || ''; });
            nodes.forEach(function (el) { el.style.transition = 'none'; });
            a.row.classList.remove(ANIM_CLASS);
            a.followers.forEach(function (el, i) {
                el.classList.remove(FOLLOW_CLASS);
                el.style.transform = a.transforms[i];
            });
            void a.row.offsetHeight;
            nodes.forEach(function (el, i) { el.style.transition = inline[i]; });
            /* In the plate the layout of the rows and grid is driven by the shell (its transition and its end). */
            if (!a.plate && (a.deferred || a.others)) this.relayout();
            /* The row at the final height: collapsed to one line — the chevron by the text. */
            this.syncExpand();
        },

        /* Whether the row has a height transition in progress — by the browser itself (Web Animations). */
        heightRunning: function (row) {
            if (!row || typeof row.getAnimations !== 'function') return false;
            try {
                return row.getAnimations().some(function (x) { return x.transitionProperty === 'height'; });
            } catch (e) {
                return false;
            }
        },

        afterDrag: function () {
            var s = this.stock();
            if (!s || !this.expanded(s)) return;
            if (this.total(s) > this.rowHeight(s)) return;
            s.editor.$el.removeClass('expanded');
            s.editor.$btnexpand && s.editor.$btnexpand.removeClass('btn-collapse');
            Common.localStorage.setBool(KEY_EXPAND, false);
        },

        /* --- Geometry ------------------------------------------------------ */
        /* Heights: total — the box of #cell-editing-box (the edge writes it and the layout
           counts it), content — what jQuery height() returns and accepts,
           without the bottom border. Stock keep_height is content. */

        border: function (s) {
            return parseFloat(s.editor.$el.css('border-bottom-width')) || 0;
        },

        total: function (s) {
            return s.editor.$el.height() + this.border(s);
        },

        rowHeight: function (s) {
            return parseFloat(s.editor.$el.css('min-height')) || 0;
        },

        /* The nearest edge grid height: offset + k·koeff, not less than two lines
           — an expand to one line would not have been an expand. */
        snapTotal: function (total, m) {
            if (!m || !m.koeff) return total;
            var k = Math.max(2, Math.round((total - (m.offset || 0)) / m.koeff));
            return (m.offset || 0) + k * m.koeff;
        },

        /* Recalculation for the current styles — the same way as in the stock onThemeChanged
           (resize.min and the shared multiply object). On top of stock — the minpos
           of the divider: Layout.changeLayout copies min into the divider by value,
           and without this the edge would keep the stock lower limit. Then —
           the expand height and the current height onto the grid of these same parameters. */
        fit: function (s) {
            var opts = s.view.getCelleditorResizeOptions();
            var r = s.item.resize;
            r.min = opts.min;
            r.multiply.koeff = opts.multiply.koeff;
            r.multiply.offset = opts.multiply.offset;
            (s.celayout.splitters || []).forEach(function (sp) {
                if (sp && sp.resizer && sp.resizer.multiply === r.multiply) sp.resizer.minpos = opts.min;
            });

            var border = this.border(s);
            if (this.stockKeep === null) this.stockKeep = s.editor.keep_height;
            if (s.editor.keep_height > 0)
                s.editor.keep_height = this.snapTotal(s.editor.keep_height + border, r.multiply) - border;

            if (this.expanded(s)) {
                var total = this.snapTotal(this.total(s), r.multiply);
                if (total !== this.total(s)) s.editor.$el.height(total - border);
                Common.NotificationCenter.trigger('layout:changed', 'celleditor');
            } else {
                /* Collapsed — to the minimum height of the current styles (row 36 for us,
                   stock in Stock); the stock method also sends layout:changed. */
                s.ctl.changeCellEditorHeight();
            }
            s.ctl.onCellEditorTextChange && s.ctl.onCellEditorTextChange();
        }
    };

    return SSE.Views.FormulaBar;
});
