/*
 * CompactToolbar — the formatting toolbar of the "Compact" spreadsheet shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 *     our control  →  twin in the stock ribbon (StockBridge)  →  stock handler  →  engine
 *
 * 36 controls in group order: actions · numbers · font style · color and borders · alignment ·
 * sort and filter · editing · "vertical" and print · insert · other. The start of the row is as in documents
 * (the documents CompactToolbar): undo · redo · search · comment · zoom; after it, as in Google
 * Sheets, the number block: ₽ · % · decimals − and + · "123" (number format); then as Excel "Home", except
 * sort with filter before editing.
 *
 * The toolbar has no state of its own: a command goes by the stock path
 * of the twin (Button.click, a click on a stock menu item, a twin event with
 * stock arguments), availability and pressed state are read from the twin on every
 * update, the values (number format, font, size) are the captions that stock
 * has just put into its controls on asc_onSelectionChanged, zoom and
 * colors come from the engine. An exception for the pressed state — "Borders": the stock button has none, they are
 * pressed according to the engine when the cell has a border (engineBorders); the marks of the rows of
 * its list use the same data (SheetActions.borderMarker). A command without a twin
 * is on a short list: search (the stock search:show notification), zoom (api.asc_setZoom — the same
 * call as in the stock zoom menu of the sheet row) and print (the 'print' notification,
 * SheetActions.print). The list, command and current zoom value are the same for
 * the toolbar and for "View → Zoom ▸" of the menu bar (ZOOMS, setZoom, zoomPercent).
 *
 * Our own copy, not a module shared with documents; the numbers shared with
 * documents — the zoom list and the color palette — are kept consistent by
 * the compact-parity.cjs test.
 */
define([
    'common/main/lib/view/compact/Icons',
    'spreadsheeteditor/main/app/view/StockBridge',
    'spreadsheeteditor/main/app/view/SheetActions'
], function (Icons, Bridge, SheetActions) {
    'use strict';

    if (window.SSE === undefined) window.SSE = {};
    if (SSE.Views === undefined) SSE.Views = {};

    var BAR_ID = 'vo-tb';

    /* Zoom levels — the same list as in documents; it is also the "View → Zoom ▸" list of the menu bar (SheetActions.zooms). */
    var ZOOMS = [50, 75, 100, 125, 150, 200];

    /* Zoom availability — from the zoom button of the sheet row, as for "View → Zoom ▸" (stock disables it while a cell is edited);
       no button — zoom is available. */
    var ZOOM_LOCK = 'Statusbar:btnZoomUp';

    /* The font size list — one per toolbar: the field references it (aria-controls), and its rows — aria-activedescendant. */
    var SIZE_LIST_ID = 'vo-size-list';

    /* Our own spreadsheet icons — only what the shared AIR set (common/main/lib/view/compact/Icons.js) lacks: "123" is the file
       outline/digits123 of the ui.icon-set AIR set as is; the plain percent sign and the decimals ".0 ←" and ".00 →" are drawn on the
       AIR 24 grid (line 1.4, rounded ends, glyph in a 5–19 field). The files are in the spreadsheets' resources/img/air, under our names,
       and are drawn the same way as the shared set — by a mask (.vo-air, --vo-air-src) from the editor document
       (apps/spreadsheeteditor/main/index.html, as for Icons). Other names — the shared set; the shared set is not changed. */
    var OWN_AIR = {digits123: 1, percentSign: 1, decimalDecrease: 1, decimalIncrease: 1};
    var OWN_AIR_BASE = 'resources/img/air/';
    var ownAirUrl = '';

    function airGlyph(name, size) {
        if (OWN_AIR[name] !== 1) return Icons.svg(name, size);
        if (!ownAirUrl) ownAirUrl = new URL(OWN_AIR_BASE, document.baseURI).href;
        return '<span class="vo-air" aria-hidden="true" style="' + '--vo-air-size:' + (size || 24) + 'px;' +
               '--vo-air-src:url(' + ownAirUrl + name + '.svg)"></span>';
    }

    /* The number format list — as in Google Sheets: groups separated by a line, the name on the left, a sample on the right. A group is by the type
       of the stock format (Asc.c_oAscNumFormatType, the value of the stock list entry), the order within a group is as in Google; what
       Google lacks (fraction) — by meaning, with the numbers. The sample is by the engine (asc_getLocaleExample) in the document locale on one
       specimen, as in Google: the number 1000.12, percent 0.1012 (10.12 %), date and time — 26.09.2008 15:59:00. For General and
       Text — no sample, as in Google. Items without a type ("More formats") — the last group. */
    var NUMFMT_GROUPS = [['General', 'Text'], ['Number', 'Percent', 'Scientific', 'Fraction'], ['Accounting', 'Currency'],
        ['Date', 'LongDate', 'Time']];
    var NUMFMT_DATE = 39717 + (15 * 60 + 59) / 1440;
    var NUMFMT_SAMPLE = {Number: 1000.12, Scientific: 1000.12, Fraction: 1000.12, Accounting: 1000.12, Currency: 1000.12,
        Percent: 0.1012, Date: NUMFMT_DATE, LongDate: NUMFMT_DATE, Time: NUMFMT_DATE};

    /* The palette — the grid of the document Compact (the documents CompactToolbar,
       PALETTE_STAGE: six rows by the weights 100/200/300/400/600/800, fourteen
       columns). The values are the same — they are checked by compact-parity.cjs. */
    var PALETTE_STAGE = [
        ['ffe4e6', 'ffe2d6', 'ffedd5', 'fef3c7', 'ecf8c8', 'dcfce7', 'd1fae5',
         'ccfbf1', 'cffafe', 'dbeafe', 'e0e7ff', 'ede9fe', 'fce7f3', 'f1f5f9'],
        ['fecdd3', 'ffc6ad', 'fed7aa', 'fde68a', 'd8ee8e', 'bbf7d0', 'a7f3d0',
         '99f6e4', 'a5f3fc', 'bfdbfe', 'c7d2fe', 'ddd6fe', 'fbcfe8', 'e2e8f0'],
        ['fd9fac', 'ffa385', 'fdb573', 'fcd357', 'beda69', '83eba8', '6ee3b5',
         '63e5d2', '64e3f5', '90c0fc', 'a4affb', 'c2b1fc', 'f8a1cf', 'bbc6d4'],
        ['fb7185', 'ff805d', 'fb923c', 'fbbf24', 'a3c644', '4ade80', '34d399',
         '2dd4bf', '22d3ee', '60a5fa', '818cf8', 'a78bfa', 'f472b6', '94a3b8'],
        ['e11d48', 'd9471f', 'ea580c', 'b7791f', '5f7f1f', '16a34a', '059669',
         '0d9488', '0891b2', '2563eb', '4f46e5', '7c3aed', 'db2777', '64748b'],
        ['9f1239', '8f2d13', '9a3412', '78350f', '365314', '166534', '065f46',
         '115e59', '155e75', '1e40af', '3730a3', '5b21b6', '9d174d', '334155']
    ];

    /* The list submenu opens on hover with the same delay as in
       the menu bar row; the first row of the submenu stands level with the item — a shift by
       the list's top padding (@vo-pop-pad-y). */
    var HOVER_DELAY = 150;
    var POP_PAD_Y = 10;

    /* The mouse-press flag on toolbar buttons (bindPress) — the look is the same as for :active. */
    var PRESS_CLASS = 'vo-pressing';
    /* A group or "⋯" without a separator: there is no fully visible control next to it (syncSeparators). */
    var SEP_OFF = 'vo-sep-off';

    /* The hover tooltip — one node on body (trackTips).
       The delay is stock (common/main/lib/util/Tip.js: delay.show 500); the place is under the toolbar row (under the popup
       row "⋯") or under a header button, for the save icon — at the side, with the TIP_GAP gap and not closer than TIP_EDGE to
       the window edges. */
    var TIP_ID = 'vo-tip';
    var TIP_DELAY = 500;
    var TIP_GAP = 4;
    var TIP_EDGE = 8;

    /* The tooltip state: the control under the cursor (el), its place (anchor), the show timer, the node. */
    var tipState = {el: null, anchor: null, timer: null, node: null};

    /* The color of the checkmark on a swatch — by the swatch brightness (WCAG 2.1, 1.4.3), as in
       documents: dark on a light one, light on a dark one. */
    function paletteInk(hex) {
        var n = parseInt(hex, 16);
        var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        var L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
        return L > 0.5 ? '#1a1a1a' : '#ffffff';
    }

    function normHex(v) {
        var m = String(v || '').trim().replace(/^#/, '');
        return /^[0-9a-fA-F]{6}$/.test(m) ? m.toLowerCase() : null;
    }

    function hexOf(r, g, b) {
        return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    function ctl(name) {
        try { return SSE.getController(name) || null; } catch (e) { return null; }
    }

    function options() {
        var main = ctl('Main');
        return (main && main.appOptions) || {};
    }

    function within(root, node) {
        while (node) {
            if (node === root) return true;
            node = node.parentNode;
        }
        return false;
    }

    /* DOM event handlers — under the shell's guard (CompactShell.guarded):
       a control failure must not bring the editor down. The module loads before
       the shell (it depends on it), so the guard is taken at call time. */
    function guard(label, fn) {
        return function () {
            var shell = SSE.Views.CompactShell;
            if (shell && typeof shell.guarded === 'function') return shell.guarded('toolbar: ' + label, fn).apply(this, arguments);
            return fn.apply(this, arguments);
        };
    }

    function node(tag, cls, attrs) {
        var el = document.createElement(tag);
        if (cls) el.className = cls;
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
        });
        if (tag === 'button' && !(attrs && attrs.type)) el.setAttribute('type', 'button');
        return el;
    }

    /* --- Hover tooltip -------------------------------------------- */
    /* The tooltip text — in one place: aria-description, a description for the screen reader after the name from aria-label (formerly —
       title; the reason for being disabled stays in the tooltip as before). title is removed: the browser would draw its own
       tooltip from it — there would be two, and on screen, in headless and in screenshots the system one is not visible at all. A shown
       tooltip of this control changes its text in place (the save state, the reason for being disabled). */
    function tipText(el) {
        var t = el && typeof el.getAttribute === 'function' ? el.getAttribute('aria-description') : null;
        return t ? String(t) : '';
    }

    function setTip(el, text) {
        if (!el || typeof el.setAttribute !== 'function') return;
        text = text === null || text === undefined ? '' : String(text);
        if (text) {
            if (el.getAttribute('aria-description') !== text) el.setAttribute('aria-description', text);
        } else if (el.getAttribute('aria-description') !== null) {
            el.removeAttribute('aria-description');
        }
        if (el.getAttribute('title') !== null) el.removeAttribute('title');
        if (tipState.el === el && tipState.node && tipState.node.parentNode) {
            if (!text) hideTip();
            else if (tipState.node.firstChild.textContent !== text) {
                tipState.node.firstChild.textContent = text;
                placeTip(el, tipState.node, tipState.anchor);
            }
        }
    }

    /* The node is the stock tooltip template (mods/tooltip.js: .tooltip > .tooltip-inner, without an arrow — arrow-free, as in
       Tip.js), the light and dark theme colors are stock (tooltip.less); fixed and off the cursor — compact-shell.less (#vo-tip).
       The screen reader does not need the node: the text is already in the control's description. */
    function tipNode() {
        if (!tipState.node) {
            tipState.node = node('div', 'tooltip arrow-free in', {id: TIP_ID, 'aria-hidden': 'true'});
            tipState.node.appendChild(node('div', 'tooltip-inner'));
        }
        return tipState.node;
    }

    function hideTip() {
        clearTimeout(tipState.timer);
        tipState.timer = null;
        tipState.el = null;
        tipState.anchor = null;
        if (tipState.node && tipState.node.parentNode) tipState.node.parentNode.removeChild(tipState.node);
    }

    function tipShown(el) {
        if (!el || el.isConnected === false || typeof el.getClientRects !== 'function') return false;
        if (!el.getClientRects().length) return false;
        return !window.getComputedStyle || window.getComputedStyle(el).visibility !== 'hidden';
    }

    /* Not over an open list (a tooltip does not cover neighboring buttons): while a shell surface
       is open — the menu bar, a list, a palette, the mode switch, the column menu — there is no tooltip; the exception is
       controls in the expanded "⋯", while they do not have their own list open. */
    function tipAllowed(el) {
        var T = SSE.Views.CompactToolbar, shell = SSE.Views.CompactShell;
        if (T && T.ofPop && T.el && T.el.classList.contains('vo-of-open') && within(T.ofPop, el)) {
            return !T.listOpen() && !Bridge.popupOpen();
        }
        /* The shell is built (the reader has no toolbar): its surfaces; without it — our own. */
        if (shell && typeof shell.hasOpenSurfaces === 'function' && shell.subs) return !shell.hasOpenSurfaces();
        return !(T && typeof T.hasOpenPopover === 'function' && T.hasOpenPopover());
    }

    /* The place: under the edge (anchor.edge — the node under whose bottom edge the tooltip goes; without it — the control itself), centered
       on the control; anchor.side 'end' — at the side, after the control in the line direction (in RTL — on the left), centered in height. Not
       closer than TIP_EDGE to the window edges. */
    function placeTip(el, n, anchor) {
        /* Measure at the top left corner of the window: at the window edge the tooltip width would shrink to the remaining space (the text
           wraps), and the new place would be computed from a foreign width. */
        n.style.left = '0px';
        n.style.top = '0px';
        var r = el.getBoundingClientRect(), nr = n.getBoundingClientRect();
        var w = nr.width, h = nr.height;
        var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
        var left, top;
        if (anchor && anchor.side === 'end') {
            var rtl = document.body.classList.contains('rtl');
            left = rtl ? r.left - TIP_GAP - w : r.right + TIP_GAP;
            top = r.top + (r.height - h) / 2;
        } else {
            var edge = anchor && anchor.edge ? anchor.edge.getBoundingClientRect().bottom : r.bottom;
            top = edge + TIP_GAP;
            left = r.left + (r.width - w) / 2;
        }
        n.style.left = fit(left, w, vw) + 'px';
        n.style.top = fit(top, h, vh) + 'px';
    }

    /* The coordinate in whole px not closer than TIP_EDGE to the window edges: at the far edge — down, otherwise rounding (the width is fractional)
       would move the tooltip toward the edge by a fraction of a px. */
    function fit(v, size, room) {
        var x = Math.round(v);
        if (!room) return x;
        var far = Math.floor(room - TIP_EDGE - size);
        return Math.max(TIP_EDGE, Math.min(x, far));
    }

    function showTip(el, anchor) {
        if (tipState.el !== el) return;
        var text = tipText(el);
        if (!text || !tipShown(el) || !tipAllowed(el)) return;
        var n = tipNode();
        n.firstChild.textContent = text;
        document.body.appendChild(n);
        placeTip(el, n, anchor);
    }

    function armTip(el, anchor) {
        hideTip();
        tipState.el = el;
        tipState.anchor = anchor || null;
        tipState.timer = setTimeout(guard('tip show', function () {
            tipState.timer = null;
            showTip(el, tipState.anchor);
        }), TIP_DELAY);
    }

    SSE.Views.CompactToolbar = _.extend({

        el: null,
        ctrl: null,       // controls by key: {it, el, btn, …}
        order: null,      // keys in row order
        groups: null,     // group nodes
        shell: null,

        api: function () {
            var vp = ctl('Viewport');
            return (vp && vp.getApi && vp.getApi()) || null;
        },

        /* The reader has no toolbar: there is nothing for them to format, the toolbar row
           does not enter the layout (the reader's skeleton is 76). The right is the same snapshot as for the
           mode switch (SheetActions.editRight → CompactShell.editRight): a shell
           built under the stock disable reason (a background open turns off isEdit) would otherwise
           leave the editor without a toolbar. */
        wanted: function (shell) {
            return SheetActions.editRight(shell) === true;
        },

        /* The comment right is the stock condition (`canCoAuthoring && canComments`) read the same way
           as for the "Insert → Comment" item (SheetActions.commentRight): under
           stock comment "preview" the right is the one stock saved. */
        canComment: function () {
            var o = options();
            return !!o.canCoAuthoring && SheetActions.commentRight(o);
        },

        /* Whether the icon name has a drawing: the shared AIR set or the spreadsheets' own (OWN_AIR). */
        hasGlyph: function (name) {
            return OWN_AIR[name] === 1 || Icons.has(name);
        },

        /* --- Catalog ------------------------------------------------------- */
        /* A control is {k, type, tip, i?, twin?, core?, sc?, …}:
            - btn    — a glyph button, the command is the twin's stock click() (or run); pick —
                       the button chooses an item of the twin's stock menu (a path or a value, as for an
                       item of the menu bar row — SheetActions): available when both the button and the item are available;
            - value  — a list of values with a caption: zoom, number format, font;
            - size   — font size: a field with a list of sizes (sizeCtrl);
            - color  — text color and fill: the documents palette;
            - drop   — a glyph and ▾: a list from the twin's stock menu (source
                       'mirror') or from a choice between stock buttons ('choice',
                       'wrap', 'list'); caret: false — a list without ▾ (image,
                       list button);
           glyphs — for a choice ('choice'): stock buttons of the same group without a row in the list, whose pressed state also
           sets the control's glyph (they give neither addresses nor availability);
           on — the pressed state from the twin; engine — the state from the engine: for a color — whose color ('font', 'fill'), for the
           'borders' list — the pressed state by the selection borders (engineBorders);
           lock — the control from which only the availability of a control without a twin is taken (no control — available);
           the pressed state (class on, the look of a pressed "Bold"; aria-pressed — only for buttons without a list): on — by the twin's pressed state; press — by the engine selection
           (selState) or, for a choice, 'choice' — a non-default is chosen (plain in the choice row); pressOnColor — for a color, while a color
           is present (except plainColor). off — the command of a repeated click on a pressed button (turn off);
           core — the core, never goes into "⋯"; sc — the name of the
           stock shortcut action for the tooltip. The order of groups and controls is as in Excel "Home", except
           sort with filter before editing; the number block is as in Google Sheets, before the font. The row is cut off from the end, so what must be
           visible in a narrow window comes earlier in the row; the core is Undo, Redo, Search, Comment, Zoom, Number format, Font size, Bold, Italic, Underline, Strikethrough. */
        catalog: function () {
            var me = this, A = SheetActions;
            /* Numbers — as in Google Sheets: ₽ · % · Decimals − · Decimals + · "123", as one group, without separators
               inside. "123" is the number format: an icon button without ▾ (core), a click opens a list of formats with samples
               (numFormatEntries). The group's place in the row is the single "numbers," line in the group list below: now — as in Google,
               right after the start of the row, before the font. */
            /* An enabled format is shown by a pressed button, like "Bold" for a bold cell: ₽ for currency and financial (₽ is set by financial:
               the stock "Currency" style), % for percent, "123" for any except "General". A repeated click on a pressed ₽ or % is
               "General" (off), like a second click on "Bold"; on "123" — the list, as it was. Decimals hold no state. */
            var off = function () { return me.generalFormat(); };
            var numbers = {g: 'number', items: [
                {k: 'currency', type: 'btn', i: 'currency', tip: me.tipCurrency, twin: 'Toolbar:btnCurrencyStyle',
                    press: function (s) { return s.nf === 'Currency' || s.nf === 'Accounting'; }, off: off},
                {k: 'percent', type: 'btn', i: 'percentSign', tip: me.tipPercent, twin: 'Toolbar:btnPercentStyle',
                    press: function (s) { return s.nf === 'Percent'; }, off: off},
                {k: 'decDown', type: 'btn', i: 'decimalDecrease', tip: me.tipDecDecimal, twin: 'Toolbar:btnDecDecimal'},
                {k: 'decUp', type: 'btn', i: 'decimalIncrease', tip: me.tipIncDecimal, twin: 'Toolbar:btnIncDecimal'},
                {k: 'numfmt', type: 'drop', caret: false, i: 'digits123', tip: me.tipNumberFormat, twin: 'Toolbar:cmbNumberFormat',
                    core: true, source: 'numfmt', press: function (s) { return !!s.nf && s.nf !== 'General' && s.nf !== 'None'; }}
            ]};
            return [
                /* The start of the row — as in documents: Undo · Redo · Search · Comment · Zoom, all in the core;
                   the comment — by the right to comment. "Print" is not here — it is behind "Vertical". */
                {g: 'service', items: [
                    {k: 'undo', type: 'btn', i: 'undo', tip: me.tipUndo, twin: 'Toolbar:btnUndo', core: true, sc: 'EditUndo'},
                    {k: 'redo', type: 'btn', i: 'redo', tip: me.tipRedo, twin: 'Toolbar:btnRedo', core: true, sc: 'EditRedo'},
                    {k: 'search', type: 'btn', i: 'search', tip: me.tipSearch, core: true, sc: 'OpenFindDialog',
                        run: function () { me.search(); }},
                    {k: 'comment', type: 'btn', i: 'comment', tip: me.tipComment, twin: 'ToolbarCtl:btnsComment.0', core: true,
                        when: function () { return me.canComment(); }},
                    /* Zoom — the documents list (ZOOMS) and the same command as "View → Zoom ▸" (setZoom); the caption is the current
                       engine zoom rounded like the sheet row caption (zoomPercent): one value with the "− 100 % +" at the bottom right. */
                    {k: 'zoom', type: 'value', w: 'vo-w-zoom', tip: me.tipZoom, core: true, source: 'zoom', lock: ZOOM_LOCK}
                ]},
                numbers,
                /* Font style — like the Excel "Font" group: Font ▾ · Size · Bold · Italic · Underline · Strikethrough, followed by "Format Painter".
                   Between the size and "Bold" — an empty separator (LESS), as in documents. */
                {g: 'typo', items: [
                    {k: 'font', type: 'value', w: 'vo-w-font', tip: me.tipFontName, twin: 'Toolbar:cmbFontName', source: 'fonts'},
                    /* Font size — as in documents: a field with a list, without "−" and "+". */
                    {k: 'size', type: 'size', tip: me.tipFontSize, twin: 'Toolbar:cmbFontSize', core: true, source: 'sizes'},
                    {k: 'bold', type: 'btn', i: 'bold', tip: me.tipBold, twin: 'Toolbar:btnBold', core: true, sc: 'Bold', on: true},
                    {k: 'italic', type: 'btn', i: 'italic', tip: me.tipItalic, twin: 'Toolbar:btnItalic', core: true, sc: 'Italic', on: true},
                    {k: 'underline', type: 'btn', i: 'underline', tip: me.tipUnderline, twin: 'Toolbar:btnUnderline', core: true,
                        sc: 'Underline', on: true},
                    {k: 'strike', type: 'btn', i: 'strike', tip: me.tipStrikeout, twin: 'Toolbar:btnStrikeout', core: true,
                        sc: 'Strikeout', on: true},
                    /* Format Painter — after "Strikethrough", the last in the font style. The behavior is as before: a double click is stock
                       (sticks until Esc or a new click). */
                    {k: 'paint', type: 'btn', i: 'paint', tip: me.tipPaintFormat, twin: 'Toolbar:btnCopyStyle', dbl: true, on: true}
                ]},
                /* Text color · Fill · Borders ▾ — as in the Excel "Font" group: borders go after the color pair. */
                /* The color is pressed while the selection has one, like "Bold" for a bold cell: fill — any except "No fill" (white too);
                   text color — not "Automatic" and not black (plainColor: in Excel workbooks black text is stored as an explicit color, otherwise the button would be
                   pressed almost everywhere). A click on a pressed one removes the color — "Automatic" / "No fill", like a second click on "Bold";
                   on an unpressed one — the palette. */
                {g: 'color', items: [
                    {k: 'textColor', type: 'color', i: 'color', tip: me.tipTextColor, twin: 'Toolbar:btnTextColor', engine: 'font',
                        resetLabel: me.textAutoColor, resetEvent: 'auto:select', resetArgs: [], resetSwatch: '#333333',
                        pressOnColor: true, plainColor: '000000'},
                    {k: 'fillColor', type: 'color', i: 'fill', tip: me.tipFillColor, twin: 'Toolbar:btnBackColor', engine: 'fill',
                        resetLabel: me.textNoFill, resetEvent: 'color:select', resetArgs: ['transparent'], resetSwatch: '#fde68a',
                        pressOnColor: true},
                    /* "Borders" is pressed when the cell has a border (engine: 'borders' — by the engine, engineBorders): the stock
                       button has no pressed state. A click still only opens the list. */
                    {k: 'borders', type: 'drop', i: 'borders', tip: me.tipBorders, twin: 'Toolbar:btnBorders', source: 'mirror',
                        engine: 'borders'}
                ]},
                /* Alignment — as in Excel: Horizontal ▾ · Wrap ▾ · Merge ▾. "Vertical" is behind editing. */
                /* The list buttons are pressed while a non-default is chosen in them, like "Bold" for a bold cell: alignment is set, text
                   is wrapped, cells are merged. A click on a pressed one — the list, as it was: it is turned off by its row. */
                {g: 'align', items: [
                    /* "Horizontal" — three variants; "Justify" — in "Format → Alignment ▸". A justified cell:
                       the button glyph is "justify" (glyphs: a pressed stock button without a list row), there is no mark in the list. Pressed for
                       center, right and justify; for left (plain) and the stock "general" — not pressed. */
                    {k: 'halign', type: 'drop', i: 'alignL', tip: me.tipHAlign, source: 'choice', press: 'choice', choices: [
                        {twin: 'Toolbar:btnAlignLeft', i: 'alignL', t: me.textAlignLeft, plain: true},
                        {twin: 'Toolbar:btnAlignCenter', i: 'alignC', t: me.textAlignCenter},
                        {twin: 'Toolbar:btnAlignRight', i: 'alignR', t: me.textAlignRight}
                    ], glyphs: [{twin: 'Toolbar:btnAlignJust', i: 'alignJ'}]},
                    {k: 'wrap', type: 'drop', i: 'hyphen', tip: me.tipWrap, twin: 'Toolbar:btnWrap', source: 'wrap', on: true},
                    {k: 'merge', type: 'drop', i: 'merge', tip: me.tipMerge, twin: 'Toolbar:btnMerge', source: 'mirror', on: true}
                ]},
                /* Sort ▾ · Filter — before editing. In Excel they are at the end of "Home", but the row is cut off from the end, and in a narrow
                   window they would go into "⋯" first. */
                {g: 'data', items: [
                    /* The sort row captions are the same as for the "Data" items of the menu bar: one command — one name. */
                    {k: 'sort', type: 'drop', i: 'sort', tip: me.tipSort, source: 'list', entries: [
                        {twin: 'DataTab:btnsSortDown.0', i: 'sort', t: A.textSortAZ},
                        {twin: 'DataTab:btnsSortUp.0', t: A.textSortZA},
                        {sep: true},
                        {twin: 'DataTab:btnCustomSort', t: A.textCustomSort}
                    ]},
                    {k: 'filter', type: 'btn', i: 'filter', tip: me.tipFilter, twin: 'DataTab:btnsSetAutofilter.0', sc: 'ToggleAutoFilter', on: true}
                ]},
                /* Editing — like "Editing" in Excel: Function ▾ (autosum) · Clear format. */
                {g: 'edit', items: [
                    {k: 'func', type: 'drop', i: 'sum', tip: me.tipFunction, twin: 'Toolbar:btnInsertFormula', source: 'mirror'},
                    /* "Clear format" — a button without a list, after "Function". The command is the same as "Format →
                       Clear format": the stock "Formatting" item of the ribbon "Clear" button by value
                       (SheetActions.CLEAR_FORMAT) — resets formatting; values, formulas, comments and links
                       stay. Other clearing variants — "Edit → Clear ▸" and the context menu. Available when both the
                       button and the item are available (pick): the item has its own locks — cell editing, chart, shape, image. */
                    {k: 'clear', type: 'btn', i: 'clear', tip: me.tipClearFormat, twin: 'Toolbar:btnClearStyle', pick: A.CLEAR_FORMAT}
                ]},
                /* Vertical ▾ · Print — after editing. */
                {g: 'extra', items: [
                    /* Pressed for top and middle; for bottom it is the sheet default (plain). */
                    {k: 'valign', type: 'drop', i: 'caption', tip: me.tipVAlign, source: 'choice', press: 'choice', choices: [
                        {twin: 'Toolbar:btnAlignTop', i: 'valignT', t: me.textAlignTop},
                        {twin: 'Toolbar:btnAlignMiddle', i: 'alignC', t: me.textAlignMiddle},
                        {twin: 'Toolbar:btnAlignBottom', i: 'caption', t: me.textAlignBottom, plain: true}
                    ]},
                    /* "Print" — after "Vertical", opens the same window as "File → Print": the command is the same as for the menu item
                       (SheetActions.print: the 'print' notification with the left menu view), and not a click on the ribbon "Print" button — with
                       quick print chosen in stock it would print without a window (controller/Toolbar.js onPrint, printType).
                       The twin is only a source of availability (cell editing, print ban, start). The button is by the print right, with the same
                       condition as for the item (SheetActions.CAN.print): no right — no button, the row is shorter, the order of the others is the
                       same. The caption is the caption of the "File → Print" item, the shortcut is stock. */
                    {k: 'print', type: 'btn', i: 'print', tip: A.textPrint, twin: 'Toolbar:btnPrint', sc: 'PrintPreviewAndPrint',
                        run: function () { A.print(); }, when: function () { return A.CAN.print(options()); }}
                ]},
                /* Insert: Link · Chart · Image (the comment is at the start of the row). */
                {g: 'insert', items: [
                    {k: 'link', type: 'btn', i: 'link', tip: me.tipLink, twin: 'Toolbar:btnInsertHyperlink', sc: 'InsertHyperlink'},
                    {k: 'chart', type: 'btn', i: 'chart', tip: me.tipChart, twin: 'Toolbar:btnInsertChartRecommend'},
                    {k: 'image', type: 'drop', caret: false, i: 'image', tip: me.tipImage, twin: 'Toolbar:btnInsertImage', source: 'mirror'}
                ]},
                /* The end of the row: Conditional formatting ▾ · Rotation ▾ · Data validation · Freeze panes ▾. Rotation is pressed while
                   the text is rotated (the angle is not 0), "Freeze panes" — while the sheet has frozen areas. */
                {g: 'misc', items: [
                    {k: 'condfmt', type: 'drop', i: 'condfmt', tip: me.tipCondFormat, twin: 'Toolbar:btnCondFormat', source: 'mirror'},
                    {k: 'rotate', type: 'drop', i: 'rotate', tip: me.tipRotate, twin: 'Toolbar:btnTextOrient', source: 'mirror',
                        press: function (s) { return !!s.angle; }},
                    {k: 'validate', type: 'btn', i: 'validate', tip: me.tipValidation, twin: 'DataTab:btnDataValidation'},
                    {k: 'freeze', type: 'drop', i: 'freeze', tip: me.tipFreeze, twin: 'ViewTab:btnFreezePanes', source: 'mirror',
                        press: function (s) { return s.frozen; }}
                ]}
            ];
        },

        /* --- Build ------------------------------------------------------ */

        build: function (shell) {
            if (!this.wanted(shell)) return null;
            var me = this;
            this.shell = shell || null;
            this.ctrl = {};
            this.order = [];
            this.groups = [];
            this.openWrap = null;
            var bar = node('div', null, {id: BAR_ID, role: 'toolbar', 'aria-label': this.textToolbar_ARIA});
            this.catalog().forEach(function (g) {
                var items = g.items.filter(function (it) { return !it.when || it.when(); });
                if (!items.length) return;
                var grp = node('div', 'vo-g', {'data-group': g.g});
                items.forEach(function (it) {
                    var c = me.make(it);
                    c.el.setAttribute('data-ctrl', it.k);
                    if (it.core) c.el.setAttribute('data-core', 'true');
                    grp.appendChild(c.el);
                    c.home = grp;
                    me.ctrl[it.k] = c;
                    me.order.push(it.k);
                });
                bar.appendChild(grp);
                me.groups.push(grp);
            });
            this.buildEnd(bar);
            this.el = bar;
            this.locked = false;
            this.refresh();
            return bar;
        },

        /* "⋯" and the right edge. "⋯" stands right after the last visible group and is visible
           only when something did not fit: the button and its list are in one
           wrapper, which is the row element. At the right edge — the focus mode chevron
          , as in documents: the class vo-focus-btn, the state is .on
           (set by CompactShell.setChrome). */
        buildEnd: function (bar) {
            var me = this;
            var more = node('button', 'vo-ib vo-more', {'aria-label': this.tipMore, 'aria-haspopup': 'true', 'aria-expanded': 'false'});
            setTip(more, this.tipMore);
            more.innerHTML = Icons.svg('more', 18);
            var pop = node('div', 'vo-of-pop', {role: 'group', 'aria-label': this.tipMore});
            var wrap = node('span', 'vo-more-wrap vo-collapsed');
            wrap.appendChild(more);
            wrap.appendChild(pop);
            more.addEventListener('click', guard('more', function (e) {
                e && e.preventDefault && e.preventDefault();
                e && e.stopPropagation && e.stopPropagation();
                me.toggleOverflow();
            }));
            var focus = node('button', 'vo-ib vo-focus-btn', {'aria-label': this.tipFocus, 'aria-pressed': 'false'});
            setTip(focus, this.tipFocus);
            focus.innerHTML = Icons.svg('chevron', 18);
            focus.addEventListener('click', guard('focus', function (e) {
                e && e.preventDefault && e.preventDefault();
                var shell = SSE.Views.CompactShell;
                shell && typeof shell.toggleFocus === 'function' && shell.toggleFocus();
            }));
            var end = node('div', 'vo-tb-end');
            end.appendChild(focus);
            bar.appendChild(wrap);
            bar.appendChild(end);
            this.more = more;
            this.moreWrap = wrap;
            this.ofPop = pop;
            this.end = end;
            this.focusBtn = focus;
        },

        /* The chevron state comes from the shell: in focus the glyph points down
           ("expand"), the tooltip is exit by Esc. */
        setFocusState: function (on) {
            if (!this.focusBtn) return;
            var tip = on ? this.tipFocusExit : this.tipFocus;
            this.focusBtn.classList.toggle('on', !!on);
            this.focusBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
            setTip(this.focusBtn, tip);
        },

        make: function (it) {
            switch (it.type) {
                case 'value': return this.valueCtrl(it);
                case 'size': return this.sizeCtrl(it);
                case 'color': return this.colorCtrl(it);
                case 'drop': return this.dropCtrl(it);
                default: return this.iconCtrl(it);
            }
        },

        /* The tooltip is as in stock updateShortcutHints: the caption and the first visible
           shortcut of the action from the stock registry (a reassigned one
           too). */
        hintOf: function (tip, sc) {
            var keys = sc ? SheetActions.shortcut({sc: sc}) : '';
            return keys ? tip + ' (' + keys + ')' : tip;
        },

        /* Tooltips with a shortcut live after the registry. The toolbar is built earlier
           than stock fills the registry (Main.onDocumentContentReady → Shortcuts.setApi
           after app:ready), and a tooltip computed at build time stayed without
           keys forever. The subscription is stock, the same as for
           ribbon buttons (Shortcuts.updateShortcutHints): the callback is called at once, on
           setApi and on every reassignment of shortcuts. The registry has no unsubscribe —
           the callback is under the shell's guard and stays silent after its rollback. */
        followShortcuts: function () {
            var me = this;
            var reg = ctl('Common.Controllers.Shortcuts');
            if (!reg || typeof reg.updateShortcutHints !== 'function') return;
            var byAction = {};
            this.order.forEach(function (k) {
                var c = me.ctrl[k];
                if (c && c.sc) (byAction[c.sc] = byAction[c.sc] || []).push(c);
            });
            var hints = {};
            Object.keys(byAction).forEach(function (sc) {
                hints[sc] = {label: '', applyCallback: guard('shortcut hint', function () {
                    byAction[sc].forEach(function (x) {
                        x.tip = me.hintOf(x.base, x.sc);
                        me.applyTitle(x);
                    });
                })};
            });
            reg.updateShortcutHints(hints);
        },

        iconCtrl: function (it) {
            var me = this;
            var tip = this.hintOf(it.tip, it.sc);
            var btn = node('button', 'vo-ib', {'aria-label': it.tip});
            setTip(btn, tip);
            btn.innerHTML = airGlyph(it.i, 18);
            if (it.on || it.press) btn.setAttribute('aria-pressed', 'false');
            btn.addEventListener('click', guard(it.k, function (e) {
                e && e.preventDefault && e.preventDefault();
                me.closeSurfaces();
                me.exec(it);
            }));
            /* Format Painter: a double click — the stock handler on the twin's node
               (controller/Toolbar.js onSetupCopyStyleButton: mode
               kMultiple, sticks until canceled). The two clicks before it went through
               the twin's click(), as for a stock button. */
            if (it.dbl) btn.addEventListener('dblclick', guard(it.k + ' dblclick', function () { me.stockDblClick(it.twin); }));
            return {it: it, el: btn, btn: btn, tip: tip, base: it.tip, sc: it.sc};
        },

        /* --- Commands --------------------------------------------------------- */

        /* A stock command from the toolbar (a control, a list row, a palette, a typed font size; in "⋯" — the same
           nodes): if the engine keyboard is held by the shell (F10 entry), it gives it up BEFORE the command —
           as on a mouse click, where the engine takes focus from the button before it (CompactShell.
           beforeCommand). Otherwise stock put focus into its field or window ("Comment",
           "Link", "Data validation") while the keyboard was still with the shell, and the focus leaving
           #toolbar turned it on — and the engine took focus back to the sheet. From the mouse — nothing. */
        beforeCommand: function () {
            var shell = SSE.Views.CompactShell;
            if (shell && typeof shell.beforeCommand === 'function') shell.beforeCommand();
        },

        /* The twin's stock path; the second end of the gate is in the bridge itself (a refusal on a
           disabled twin). Without a twin — the catalog command (run); for a catalog command
           with an availability twin ("Print") the second end of the gate is here: the twin could
           have gone disabled while the click was in progress. */
        exec: function (it) {
            if ((it.run || it.pick != null || it.off) && it.twin && this.twinState(it).disabled) return false;
            var done;
            /* A repeated click on a pressed one (₽, % — the format is already set): turn off, like a second click on "Bold". The pressed state is by the engine at
               the moment of the click, not by the button's look. */
            if (it.off && typeof it.press === 'function' && it.press(this.selState())) {
                this.beforeCommand();
                done = it.off();
                this.soon();
                return done;
            }
            this.beforeCommand();
            if (it.run) { it.run(); return true; }
            if (it.pick != null) {
                /* A stock menu item — as for a menu bar row item (SheetActions.exec): the menu is prepared as on
                   a stock opening, then — the stock click on the item. */
                Bridge.prime(it.twin);
                done = Bridge.pick(it.twin, it.pick);
            } else {
                done = Bridge.run(it.twin);
            }
            this.soon();
            return done;
        },

        /* The twin's control state; for a button with an item choice (pick) — the button and the item together, as for a menu
           bar row item (SheetActions.itemState): disabled if the button or the item itself is disabled; no item —
           no command, disabled. */
        twinState: function (it) {
            var st = Bridge.state(it.twin);
            if (it.pick == null) return st;
            var pk = Bridge.itemState(it.twin, it.pick);
            return {exists: st.exists, visible: st.visible, pressed: !!pk.pressed, disabled: st.disabled || !pk.exists || pk.disabled,
                    causes: (st.disabled ? st.causes : []).concat(pk.exists && pk.disabled ? pk.causes : [])};
        },

        /* The "General" number format — by the same row of the stock format list as "General" in "123" (numFormatEntries): the list is prepared
           as on a stock opening (mirror: show:before), then — the stock item with the value General. No item — no command. */
        generalFormat: function () {
            var ref = 'Toolbar:cmbNumberFormat', combo = Bridge.twin(ref), store = combo && combo.store;
            var T = (window.Asc && Asc.c_oAscNumFormatType) || {};
            if (!store || T.General == null) return false;
            var rows = Bridge.mirror(ref), ids = {}, id = null;
            rows.forEach(function (r) { if (!r.sep && !r.disabled) ids[r.id] = true; });
            for (var i = 0; i < store.length && id === null; i++) {
                var m = store.at(i), key = String(m.get('id') != null ? m.get('id') : m.id);
                if (m.get('value') === T.General && ids[key]) id = key;
            }
            /* The keyboard goes back to the sheet by the stock choice handler itself (onNumberFormatSelect: edit:complete). */
            return id === null ? false : Bridge.pick(ref, id);
        },

        /* The availability of a control without a twin — from the availability control (lock), as for a menu bar row item with lockLike and soft:
           no control (no sheet row) — available. */
        lockState: function (it) {
            var st = Bridge.state(it.lock);
            return st.exists ? st : {exists: false, disabled: false, pressed: false, visible: false, causes: []};
        },

        /* Search — a stock notification: the stock search bar under the toolbar
           (controller/Viewport.js onSearchShow → the header search button). */
        search: function () {
            Common.NotificationCenter.trigger('search:show');
        },

        stockDblClick: function (ref) {
            var o = Bridge.twin(ref);
            if (!o || (typeof o.isDisabled === 'function' && o.isDisabled())) return false;
            var $el = o.cmpEl;
            if ($el && typeof $el.trigger === 'function') { $el.trigger('dblclick'); return true; }
            return false;
        },

        /* Sheet zoom — the toolbar zoom list and "View → Zoom ▸" of the menu bar row (SheetActions.zoomTo). */
        setZoom: function (percent) {
            var api = this.api();
            if (!api || typeof api.asc_setZoom !== 'function') return;
            api.asc_setZoom(percent / 100);
        },

        /* A choice in a list ends editing: focus and keyboard go to the document
           by the stock path (edit:complete), as in documents. */
        done: function () {
            this.keys(true);
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* The engine's keyboard capture: turned off while typing in our field
           (otherwise letters go into the sheet), and necessarily turned on at the exit. */
        keys: function (on) {
            /* Focus moves around the shell from the keyboard (F10): the engine keyboard is held by
               the shell, leaving our field for a neighboring control does not give it up. */
            var shell = SSE.Views.CompactShell;
            if (on && shell && shell.keysHeld) return;
            var api = this.api();
            if (api && typeof api.asc_enableKeyEvents === 'function') api.asc_enableKeyEvents(on);
        },

        /* --- Lists ---------------------------------------------------------- */
        /* The .vo-pop-wrap wrapper — a button and a popup list under it. The list
           contents are taken on every opening (rights, selection and availability
           — of that moment), the choice goes by the stock path. */

        dropCtrl: function (it) {
            var tip = this.hintOf(it.tip, it.sc);
            var wrap = node('span', 'vo-pop-wrap');
            var btn = node('button', 'vo-ib vo-drop' + (it.caret === false ? ' vo-drop-bare' : ''),
                {'aria-label': it.tip, 'aria-haspopup': 'menu', 'aria-expanded': 'false'});
            setTip(btn, tip);
            var glyph = node('span', 'vo-drop-i');
            glyph.innerHTML = airGlyph(it.i, 18);
            btn.appendChild(glyph);
            if (it.caret !== false) {
                var caret = node('span', 'vo-drop-c');
                caret.innerHTML = Icons.svg('chevron', 16);
                btn.appendChild(caret);
            }
            var c = {it: it, el: wrap, btn: btn, glyph: glyph, glyphName: it.i, tip: tip, base: it.tip, sc: it.sc};
            this.popover(c, 'menu');
            return c;
        },

        valueCtrl: function (it) {
            var tip = this.hintOf(it.tip, it.sc);
            var wrap = node('span', 'vo-pop-wrap vo-value ' + (it.w || ''));
            var btn = node('button', 'vo-ib vo-value-btn',
                {'aria-label': it.tip, 'aria-haspopup': 'listbox', 'aria-expanded': 'false'});
            setTip(btn, tip);
            var label = node('span', 'vo-value-label');
            var caret = node('span', 'vo-value-caret');
            caret.innerHTML = Icons.svg('chevron', 16);
            btn.appendChild(label);
            btn.appendChild(caret);
            var c = {it: it, el: wrap, btn: btn, label: label, tip: tip, base: it.tip, sc: it.sc};
            this.popover(c, 'listbox');
            return c;
        },

        popover: function (c, role) {
            var me = this;
            var pop = node('div', 'vo-pop vo-pop-list' + (c.it.type === 'value' ? ' vo-pop-value' : '') +
                (c.it.source === 'numfmt' ? ' vo-pop-stack' : ''), {role: role, 'aria-label': c.it.tip});
            c.pop = pop;
            c.el.appendChild(c.btn);
            c.el.appendChild(pop);
            this.bindPopScroll(pop);
            c.btn.addEventListener('click', guard(c.it.k, function (e) {
                e && e.preventDefault && e.preventDefault();
                e && e.stopPropagation && e.stopPropagation();
                var open = !c.el.classList.contains('open');
                me.closeSurfaces(c.el);
                if (open) me.openList(c);
            }));
            /* A press inside the list does not take focus from the button: otherwise the engine,
               having taken it, would close the list before the click on a row (the same trick
               as for the documents value lists). The input field is an exception. */
            pop.addEventListener('mousedown', function (e) {
                var t = e && e.target;
                if (t && t.tagName !== 'INPUT') e.preventDefault && e.preventDefault();
            });
        },

        openList: function (c) {
            var me = this;
            if (c.btn.disabled) return;
            var list = this.entries(c.it);
            c.pop.textContent = '';
            this.closeFly(c);
            list.forEach(function (entry) {
                c.pop.appendChild(entry.sep ? node('div', 'vo-pop-sep', {role: 'separator'}) : me.listRow(c, entry, c.pop));
            });
            c.el.classList.add('open');
            c.btn.setAttribute('aria-expanded', 'true');
            this.openWrap = c;
            this.placePop(c.el, c.pop);
            this.revealChecked(c.pop);
        },

        /* A value list with a ceiling of 320 (fonts — one and a half hundred rows) opens
           with the current value in view: scrolled to the nearest edge, as for the
           row under the documents cursor (scrollIntoView 'nearest'). We compute it ourselves:
           scrollIntoView would also scroll ancestors with hidden overflow (#toolbar). */
        revealChecked: function (pop) {
            var on = pop && pop.querySelector ? pop.querySelector(':scope > .vo-pop-item.on') : null;
            if (!on || !(pop.scrollHeight > pop.clientHeight)) return;
            var top = on.offsetTop, bottom = top + on.offsetHeight;
            if (top < pop.scrollTop) pop.scrollTop = Math.max(0, top - POP_PAD_Y);
            else if (bottom > pop.scrollTop + pop.clientHeight) pop.scrollTop = bottom - pop.clientHeight + POP_PAD_Y;
        },

        closeList: function (c) {
            if (!c || !c.el) return;
            this.closeFly(c);
            c.el.classList.remove('open');
            c.btn && c.btn.setAttribute('aria-expanded', 'false');
            if (c.it.type === 'size') this.sizeHi(c, -1);
            if (this.openWrap === c) this.openWrap = null;
        },

        /* The control's list rows at this moment: {id?, caption, disabled,
           checked, hint?, glyph?, sub?, gallery?, act} or {sep: true}. gallery —
           a stock gallery submenu: a row with ▸ opens it at itself (openGallery). */
        entries: function (it) {
            var me = this;
            switch (it.source) {
                case 'zoom': {
                    var cur = this.zoomPercent();
                    return ZOOMS.map(function (z) {
                        return {caption: z + '%', checked: z === cur, act: function () { me.setZoom(z); }};
                    });
                }
                case 'fonts': return this.fontEntries(it);
                case 'sizes': return this.sizeEntries(it);
                case 'numfmt': return this.numFormatEntries(it);
                case 'choice':
                    return it.choices.map(function (ch) {
                        var st = Bridge.state(ch.twin);
                        return {caption: ch.t, glyph: ch.i, checked: st.pressed, disabled: st.disabled,
                                /* Already chosen — the stock group button is not released by
                                   a repeated press, there is nothing to change. */
                                act: function () { if (!Bridge.state(ch.twin).pressed) Bridge.run(ch.twin); }};
                    });
                case 'wrap': {
                    var st = Bridge.state(it.twin);
                    /* In stock wrap is a toggle button: the item sets the needed
                       pressed state with one stock press, if it is not there yet. */
                    var want = function (on) {
                        return function () { if (Bridge.state(it.twin).pressed !== on) Bridge.run(it.twin); };
                    };
                    return [
                        {caption: me.textWrap, glyph: 'hyphen', checked: st.pressed, disabled: st.disabled, act: want(true)},
                        {caption: me.textNoWrap, checked: !st.pressed, disabled: st.disabled, act: want(false)}
                    ];
                }
                case 'list':
                    return it.entries.map(function (en) {
                        if (en.sep) return {sep: true};
                        var s = Bridge.state(en.twin);
                        return {caption: en.t, glyph: en.i || null, disabled: s.disabled, checked: false,
                                act: function () { Bridge.run(en.twin); }};
                    });
                default: {
                    /* A mirror of the twin's stock menu (StockBridge.mirror): captions,
                       availability, marks, stock sample values. The glyph is by the class of the
                       stock icon of the item (SheetActions.stockGlyph); if at least one row
                       of the level has one, the rest get an empty glyph: the space for an icon is kept,
                       the captions line up on one vertical. Without glyphs the level is as before.
                       The mark of a border item is by the sides of the active cell in the engine, from the same
                       data that press the button (SheetActions.borderMarker): read on
                       every opening of the list; no data or more than one cell selected —
                       no marks. The mark is only a look: choosing a row applies its border,
                       as without a mark. A level may have several marks, so
                       the border item rows are checkboxes (menuitemcheckbox), and its other rows
                       without a submenu are plain items (menuitem, without aria-checked). */
                    var marked = SheetActions.borderMarker(function () {
                        var api = me.api();
                        return api && typeof api.asc_getCellInfo === 'function' ? api.asc_getCellInfo() : null;
                    });
                    var mirror = function (rows) {
                        var out = rows.map(function (r) {
                            if (r.sep) return {sep: true};
                            var on = !!r.checked || (!r.sub && !r.gallery && marked(r.icon));
                            var e = {id: r.id, caption: r.caption, disabled: r.disabled, checked: on,
                                     hint: r.example || r.hint || '', sub: r.sub ? mirror(r.sub) : null, gallery: !!r.gallery,
                                     act: r.sub || r.gallery ? null : function () { Bridge.pick(it.twin, r.id); }};
                            var g = SheetActions.stockGlyph(r.icon);
                            if (g) e.glyph = g;
                            if (!r.sub && !r.gallery && SheetActions.borderMarkable(r.icon)) e.role = 'menuitemcheckbox';
                            return e;
                        });
                        if (out.some(function (e) { return !!e.glyph; })) {
                            out.forEach(function (e) { if (!e.sep && !e.glyph) e.glyph = ''; });
                        }
                        if (out.some(function (e) { return e.role === 'menuitemcheckbox'; })) {
                            out.forEach(function (e) { if (!e.sep && !e.role && !e.sub && !e.gallery && !e.checked) e.role = 'menuitem'; });
                        }
                        return out;
                    };
                    return mirror(Bridge.mirror(it.twin));
                }
            }
        },

        /* Fonts — the store of the stock list (ComboBoxFonts): the whole set that
           stock sees; the choice is the stock 'selected' event with the font record, as for a
           click on an item of its list. */
        fontEntries: function (it) {
            var combo = Bridge.twin(it.twin);
            var store = combo && combo.store;
            if (!store) return [];
            var cur = this.twinText(it.twin);
            var seen = {}, out = [];
            var models = store.models || (function () {
                var a = [];
                for (var i = 0; i < (store.length || 0); i++) a.push(store.at(i));
                return a;
            })();
            models.forEach(function (m) {
                var name = m && typeof m.get === 'function' ? m.get('name') : null;
                if (!name || seen[name]) return;
                seen[name] = true;
                out.push({caption: name, font: name, checked: name === cur, act: function () {
                    var rec = typeof m.toJSON === 'function' ? m.toJSON() : {name: name};
                    Bridge.run(it.twin, {event: 'selected', args: [_.extend({}, rec)]});
                }});
            });
            return out;
        },

        /* Number format — the rows of the stock list (a combo mirror: captions, the current mark, the choice is a stock item; 'show:before'
           puts in the formats of the document locale), laid out in Google groups (NUMFMT_GROUPS). The sample is our own, on a specimen (NUMFMT_SAMPLE):
           in stock it is the value of the active cell in each format, for an empty or text cell — empty. */
        numFormatEntries: function (it) {
            var api = this.api();
            var rows = Bridge.mirror(it.twin);
            var combo = Bridge.twin(it.twin), store = combo && combo.store;
            var T = (window.Asc && Asc.c_oAscNumFormatType) || {}, nameOf = {}, rec = {};
            Object.keys(T).forEach(function (n) { nameOf[T[n]] = n; });
            for (var i = 0; store && i < store.length; i++) {
                var m = store.at(i);
                rec[String(m.get('id') != null ? m.get('id') : m.id)] = m;
            }
            var culture = api && typeof api.asc_getLocale === 'function' ? api.asc_getLocale() : undefined;
            var example = function (m, type) {
                var v = NUMFMT_SAMPLE[type];
                if (v == null || !api || typeof api.asc_getLocaleExample !== 'function') return '';
                var x = api.asc_getLocaleExample(m.get('format'), v, culture);
                return x == null ? '' : String(x).trim();
            };
            var groups = NUMFMT_GROUPS.map(function () { return []; }), rest = [];
            rows.forEach(function (r, order) {
                if (r.sep) return;
                var m = rec[r.id], type = m ? nameOf[m.get('value')] : null;
                var e = {id: r.id, caption: r.caption, disabled: r.disabled, checked: r.checked, hint: m ? example(m, type) : '',
                         act: function () { Bridge.pick(it.twin, r.id); }};
                for (var g = 0; g < NUMFMT_GROUPS.length; g++) {
                    var rank = type ? NUMFMT_GROUPS[g].indexOf(type) : -1;
                    if (rank >= 0) { groups[g].push({e: e, rank: rank, order: order}); return; }
                }
                rest.push(e);
            });
            var out = [];
            groups.concat([rest.map(function (e, n) { return {e: e, rank: 0, order: n}; })]).forEach(function (g) {
                if (!g.length) return;
                if (out.length) out.push({sep: true});
                g.sort(function (a, b) { return a.rank - b.rank || a.order - b.order; })
                    .forEach(function (x) { out.push(x.e); });
            });
            return out;
        },

        listRow: function (c, entry, box) {
            var me = this;
            var holds = !!(entry.sub || entry.gallery);
            /* Rows are not Tab stops: arrows move between them (popKey). The role of a row without a submenu is its
               own (entry.role: a checkbox or a plain item), otherwise a list variant (menuitemradio). */
            var option = c.it.type === 'value' || c.it.type === 'size';
            var role = option ? 'option' : (holds ? 'menuitem' : (entry.role || 'menuitemradio'));
            var row = node('button', 'vo-pop-item' + (entry.checked ? ' on' : '') + (holds ? ' vo-has-sub' : ''),
                {role: role, tabindex: '-1'});
            if (holds || entry.role !== 'menuitem')
                row.setAttribute(option ? 'aria-selected' : 'aria-checked', entry.checked ? 'true' : 'false');
            if (entry.glyph !== undefined && entry.glyph !== null) {
                var i = node('span', 'vo-pop-i');
                i.innerHTML = airGlyph(entry.glyph, 18);
                row.appendChild(i);
            }
            var t = node('span', 'vo-pop-t');
            t.textContent = entry.caption;
            if (entry.font) t.setAttribute('style', 'font-family: "' + String(entry.font).replace(/["\\]/g, '') + '"');
            var h = null;
            if (entry.hint) {
                h = node('span', 'vo-pop-ex');
                h.textContent = entry.hint;
            }
            /* The number format "123" — the sample goes on a second line under the name: the sample has no column of its own,
               the checkmark is at the right edge. Other lists — the sample to the right of the caption. */
            if (h && c.it.source === 'numfmt') {
                var tc = node('span', 'vo-pop-tc');
                tc.appendChild(t);
                tc.appendChild(h);
                row.appendChild(tc);
                row.classList.add('vo-has-ex');
            } else {
                row.appendChild(t);
                if (h) row.appendChild(h);
            }
            var chk = node('span', 'vo-pop-check');
            chk.innerHTML = Icons.svg('checkMenu', 18);
            row.appendChild(chk);
            if (holds) {
                var a = node('span', 'vo-pop-arrow');
                a.innerHTML = Icons.svg('chevronL', 14);
                row.appendChild(a);
                row.setAttribute('aria-haspopup', 'menu');
                row.setAttribute('aria-expanded', 'false');
            }
            if (entry.disabled) {
                row.classList.add('vo-locked');
                row.setAttribute('aria-disabled', 'true');
            }
            var act = guard(c.it.k + ' item', function (e) {
                e && e.stopPropagation && e.stopPropagation();
                if (entry.disabled) return;
                /* The second end of the gate: the twin could have gone disabled while the list was open. */
                if (c.it.twin && Bridge.state(c.it.twin).disabled && c.it.source !== 'list' && c.it.source !== 'choice') return;
                if (c.it.lock && me.lockState(c.it).disabled) return;
                if (entry.sub) { me.openFly(c, row, entry.sub); return; }
                if (entry.gallery) { me.openGallery(c, row, entry, box); return; }
                me.closeSurfaces();
                me.beforeCommand();
                entry.act && entry.act();
                me.done();
                me.soon();
            });
            row.addEventListener('click', act);
            row.addEventListener('mouseenter', guard(c.it.k + ' hover', function () {
                clearTimeout(me.hoverTimer);
                me.hoverTimer = setTimeout(guard(c.it.k + ' hover', function () {
                    if (entry.sub && !entry.disabled) { if (c.flyRow !== row) me.openFly(c, row, entry.sub); }
                    else if (entry.gallery && !entry.disabled) { if (c.galleryRow !== row) me.openGallery(c, row, entry, box); }
                    else if (box === c.pop) me.closeFly(c);
                    else me.closeGallery(c);
                }), HOVER_DELAY);
            }));
            return row;
        },

        /* A stock gallery submenu (histograms, color scales, icon sets,
           border style and color) at a list row — StockBridge.popup by the address of the
           twin's menu item; to the right of the row, like our submenu; the list stays alive. A choice in
           the gallery closes everything; if it cannot be shown — the stock command dialog. */
        openGallery: function (c, row, entry, box) {
            var me = this;
            if (box === c.pop) this.closeFly(c);
            else this.closeGallery(c);
            var ref = Bridge.itemRef(c.it.twin, entry.id);
            var ok = !!ref && Bridge.popup(ref, row, {align: 'tl-tr', padY: POP_PAD_Y, onClose: function (how) {
                row.classList.remove('vo-sub-open');
                row.setAttribute('aria-expanded', 'false');
                if (c.galleryRow === row) c.galleryRow = null;
                if (how === 'pick') { me.closeSurfaces(); me.soon(); }
            }});
            if (!ok) {
                if (ref && Bridge.dialog(ref)) me.closeSurfaces();
                return;
            }
            c.galleryRow = row;
            row.classList.add('vo-sub-open');
            row.setAttribute('aria-expanded', 'true');
        },

        closeGallery: function (c) {
            if (c && c.galleryRow) Bridge.closePopup('close');
        },

        /* A list submenu (conditional formatting, borders): a nested list
           to the right of the item, at the window edge — on the left. One level: the stock
           mirror is not read deeper (StockBridge, MAX_DEPTH). */
        openFly: function (c, row, list) {
            var me = this;
            this.closeFly(c);
            if (!list || !list.length) return;
            var fly = node('div', 'vo-pop vo-pop-list vo-pop-fly', {role: 'menu'});
            this.bindPopScroll(fly);
            fly.addEventListener('mousedown', function (e) { e.preventDefault && e.preventDefault(); });
            list.forEach(function (entry) {
                fly.appendChild(entry.sep ? node('div', 'vo-pop-sep', {role: 'separator'}) : me.listRow(c, entry, fly));
            });
            c.el.appendChild(fly);
            c.fly = fly;
            c.flyRow = row;
            row.classList.add('vo-sub-open');
            row.setAttribute('aria-expanded', 'true');
            var pr = c.pop.getBoundingClientRect ? c.pop.getBoundingClientRect() : null;
            var rr = row.getBoundingClientRect ? row.getBoundingClientRect() : null;
            var wr = c.el.getBoundingClientRect ? c.el.getBoundingClientRect() : null;
            if (!pr || !rr || !wr) return;
            var w = fly.offsetWidth || 0, h = fly.offsetHeight || 0;
            var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
            var left = pr.right - wr.left - 2;
            if (vw && wr.left + left + w > vw - 4) left = pr.left - wr.left - w + 2;
            var top = rr.top - wr.top - POP_PAD_Y;
            if (vh && wr.top + top + h > vh - 4) top = vh - 4 - h - wr.top;
            fly.style.left = Math.round(left) + 'px';
            fly.style.top = Math.round(top) + 'px';
        },

        closeFly: function (c) {
            this.closeGallery(c);
            if (!c || !c.fly) return;
            c.fly.parentNode && c.fly.parentNode.removeChild(c.fly);
            if (c.flyRow) {
                c.flyRow.classList.remove('vo-sub-open');
                c.flyRow.setAttribute('aria-expanded', 'false');
            }
            c.fly = null;
            c.flyRow = null;
        },

        /* A list at the right edge of the window opens inward, not beyond the edge. */
        placePop: function (wrap, pop) {
            wrap.classList.remove('vo-pop-right');
            if (!pop.getBoundingClientRect) return;
            var r = pop.getBoundingClientRect();
            var vw = window.innerWidth || 0;
            if (vw && r.right > vw - 4) wrap.classList.add('vo-pop-right');
        },

        /* The wheel over a list: the SDK handler swallows a plain wheel, a long list
           would not scroll — the menu bar row's common helper. */
        bindPopScroll: function (pop) {
            var shell = SSE.Views.CompactShell;
            if (shell && typeof shell.bindListScroll === 'function') shell.bindListScroll(pop);
        },

        /* --- Font size: a field with a list ------------------------------------------- */
        /* Like the documents font size (sizeBox): the input field and the chevron in one value list box, under it — the size list;
           there are no "−" and "+" buttons. The list is the stock font size list (the font size combo store), the choice is the stock 'selected' event with
           the size record, as for a click on a row of the stock list (controller/Toolbar.js onFontSizeSelect). What is typed
           goes by the combo's stock path — changed:before (stock parses the number, fractions with a comma, shows an error with a stock
           window and cancels) and changed:after (stock rounds to 0.5 and sets the size) — on Enter and when leaving the field.
           Focus stays in the field (role combobox), the row under the keyboard cursor is aria-activedescendant: ↓ and ↑ open the
           list and move through the rows, Enter chooses the row under the cursor or applies what is typed, Escape closes the list
           (CompactShell.bindChromeEscape), without a list — reverts what is typed. The chevron is a list button but not a Tab
           stop: the list is opened also by ↓ in the field. */
        sizeCtrl: function (it) {
            var me = this;
            var wrap = node('span', 'vo-pop-wrap vo-value vo-w-size vo-size');
            var box = node('span', 'vo-size-box');
            var input = node('input', 'vo-size-input', {type: 'text', inputmode: 'decimal', role: 'combobox', 'aria-label': it.tip,
                'aria-autocomplete': 'none', 'aria-expanded': 'false', 'aria-controls': SIZE_LIST_ID, autocomplete: 'off',
                spellcheck: 'false'});
            setTip(input, it.tip);
            var caret = node('button', 'vo-ib vo-size-caret', {'aria-label': it.tip, tabindex: '-1'});
            setTip(caret, it.tip);
            var mark = node('span', 'vo-value-caret');
            mark.innerHTML = Icons.svg('chevron', 16);
            caret.appendChild(mark);
            box.appendChild(input);
            box.appendChild(caret);
            var pop = node('div', 'vo-pop vo-pop-list vo-pop-value', {role: 'listbox', id: SIZE_LIST_ID, 'aria-label': it.tip});
            wrap.appendChild(box);
            wrap.appendChild(pop);
            this.bindPopScroll(pop);
            var c = {it: it, el: wrap, btn: input, input: input, caret: caret, pop: pop, hi: -1, tip: it.tip, base: it.tip,
                     caretCtl: {btn: caret, tip: it.tip, base: it.tip}};
            /* A click on a row does not take focus from the field: otherwise leaving the field would apply what was typed before the chosen value. */
            pop.addEventListener('mousedown', function (e) { e.preventDefault && e.preventDefault(); });
            caret.addEventListener('mousedown', guard('size caret', function (e) {
                e && e.preventDefault && e.preventDefault();
                me.keys(false);
            }));
            caret.addEventListener('click', guard('size caret', function (e) {
                e && e.preventDefault && e.preventDefault();
                e && e.stopPropagation && e.stopPropagation();
                var open = !wrap.classList.contains('open');
                me.closeSurfaces(wrap);
                if (!open) { me.closeList(c); return; }
                if (input.disabled) return;
                me.openSize(c);
                if (document.activeElement !== input) input.focus();
            }));
            /* A click in the field sets focus and selects the whole font size (like the stock size field): what is typed replaces it. A click
               on an already selected field places the cursor, as usual. */
            input.addEventListener('mousedown', guard('size field', function () {
                me.closeSurfaces(wrap);
                me.keys(false);
                c.selectOnUp = document.activeElement !== input;
            }));
            input.addEventListener('mouseup', function (e) {
                if (c.selectOnUp) { c.selectOnUp = false; e && e.preventDefault && e.preventDefault(); }
            });
            input.addEventListener('focus', guard('size field', function () {
                me.keys(false);
                c.editing = true;
                input.select && input.select();
            }));
            input.addEventListener('keydown', guard('size field', function (e) {
                var k = e.key, open = wrap.classList.contains('open');
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                if (k === 'ArrowDown' || k === 'ArrowUp') {
                    e.preventDefault && e.preventDefault();
                    if (!open) { me.closeSurfaces(wrap); me.openSize(c); return; }
                    var rows = me.sizeRows(c);
                    var at = c.hi < 0 ? (k === 'ArrowDown' ? 0 : rows.length - 1)
                        : Math.max(0, Math.min(rows.length - 1, c.hi + (k === 'ArrowDown' ? 1 : -1)));
                    me.sizeHi(c, at);
                } else if (k === 'Enter') {
                    e.preventDefault && e.preventDefault();
                    if (open && c.hi >= 0 && me.sizeRows(c)[c.hi]) { me.sizeRows(c)[c.hi].click(); return; }
                    me.closeList(c);
                    me.commitSize(c);
                    me.done();
                } else if (k === 'Escape') {
                    e.preventDefault && e.preventDefault();
                    e.stopPropagation && e.stopPropagation();
                    if (open) { me.closeList(c); return; }
                    c.editing = false;
                    me.syncSize(c);
                    input.blur && input.blur();
                    me.done();
                } else if (k === 'Tab') {
                    me.closeList(c);
                }
            }));
            input.addEventListener('blur', guard('size field', function () {
                me.closeList(c);
                if (c.editing) me.commitSize(c);
                c.editing = false;
                me.keys(true);
            }));
            return c;
        },

        /* Open the font size list: the rows are from this moment (openList), the row under the keyboard cursor is the current size,
           otherwise the first. */
        openSize: function (c) {
            this.openList(c);
            if (!c.el.classList.contains('open')) return;
            var rows = this.sizeRows(c), on = -1;
            rows.forEach(function (r, i) {
                r.id = SIZE_LIST_ID + '-' + i;
                if (on < 0 && r.classList.contains('on')) on = i;
            });
            this.sizeHi(c, on >= 0 ? on : 0);
        },

        sizeRows: function (c) {
            return c && c.pop ? Array.prototype.slice.call(c.pop.querySelectorAll(':scope > .vo-pop-item')) : [];
        },

        /* The row under the font size list keyboard cursor: the hi class and aria-activedescendant on the field; -1 — none. The row
           is scrolled into view of the list (to the nearest edge, like revealChecked). */
        sizeHi: function (c, i) {
            var rows = this.sizeRows(c);
            rows.forEach(function (r, j) { r.classList.toggle('hi', j === i); });
            c.hi = rows[i] ? i : -1;
            if (c.hi < 0) { c.input.removeAttribute('aria-activedescendant'); return; }
            c.input.setAttribute('aria-activedescendant', rows[i].id);
            var pop = c.pop, r = rows[i];
            if (!(pop.scrollHeight > pop.clientHeight)) return;
            var top = r.offsetTop, bottom = top + r.offsetHeight;
            if (top < pop.scrollTop) pop.scrollTop = Math.max(0, top - POP_PAD_Y);
            else if (bottom > pop.scrollTop + pop.clientHeight) pop.scrollTop = bottom - pop.clientHeight + POP_PAD_Y;
        },

        /* The sizes of the stock font size list (the combo store) — the whole set that stock sees; the mark is the current size. The choice is like a click
           on a row of the stock list (ComboBox.itemClicked): the combo caption is the chosen size, then the stock 'selected' event
           with the size record. The field shows the chosen value at once — what was typed before the choice is not applied. */
        sizeEntries: function (it) {
            var me = this, combo = Bridge.twin(it.twin), store = combo && combo.store;
            if (!store) return [];
            var cur = this.twinText(it.twin), out = [];
            var models = store.models || (function () {
                var a = [];
                for (var i = 0; i < (store.length || 0); i++) a.push(store.at(i));
                return a;
            })();
            models.forEach(function (m) {
                var shown = m && typeof m.get === 'function' ? m.get('displayValue') : null;
                if (shown === null || shown === undefined) return;
                shown = String(shown);
                out.push({caption: shown, checked: shown === cur, act: function () {
                    var c = me.ctrl && me.ctrl[it.k];
                    if (c) { c.editing = false; c.input.value = shown; }
                    if (typeof combo.setRawValue === 'function') combo.setRawValue(shown);
                    var rec = typeof m.toJSON === 'function' ? m.toJSON() : {value: m.get('value'), displayValue: shown};
                    Bridge.run(it.twin, {event: 'selected', args: [_.extend({}, rec)]});
                }});
            });
            return out;
        },

        commitSize: function (c) {
            var it = c.it;
            var text = String(c.input.value || '').trim();
            c.editing = false;
            if (!text || text === this.twinText(it.twin)) { this.syncSize(c); return false; }
            var prevented = false;
            var e = {type: 'change', target: c.input,
                     preventDefault: function () { prevented = true; },
                     stopPropagation: function () {},
                     isDefaultPrevented: function () { return prevented; }};
            var record = {value: text};
            if (!Bridge.run(it.twin, {event: 'changed:before', args: [record, e]})) { this.syncSize(c); return false; }
            if (!prevented) Bridge.run(it.twin, {event: 'changed:after', args: [record, e]});
            this.syncSize(c);
            return !prevented;
        },

        syncSize: function (c) {
            if (!c || c.editing || !c.input) return;
            var v = this.twinText(c.it.twin);
            if (c.input.value !== v) c.input.value = v;
        },

        /* --- Color ------------------------------------------------------------- */
        /* The documents palette (a grid of 6 × 14 stages and a color code field); the choice is
           the twin's stock event: 'color:select' with the color code (stock itself
           converts it into the engine color, Common.Utils.ThemeColor.getRgbColor),
           the reset — 'auto:select' for the text color and 'color:select' 'transparent' for
           the fill, as for the items of the stock palettes. The strip under the glyph is the selection
           color in the engine (xfs), not the last chosen one; without a color — the fallback
           resetSwatch (for the fill `#fde68a`, for the text
           `#333333`): for a cell without a fill the bucket still has a yellow strip. */
        colorCtrl: function (it) {
            var me = this;
            var tip = this.hintOf(it.tip, it.sc);
            var wrap = node('span', 'vo-cb');
            var btn = node('button', 'vo-ib', {'aria-label': it.tip, 'aria-haspopup': 'dialog', 'aria-expanded': 'false'});
            setTip(btn, tip);
            btn.innerHTML = airGlyph(it.i, 18);
            var line = node('span', 'vo-cb-line');
            var pop = node('div', 'vo-cb-pop');
            var reset = node('button', 'vo-cb-reset', {tabindex: '-1'});
            reset.textContent = it.resetLabel;
            var host = node('div', 'vo-cb-palette');
            pop.appendChild(reset);
            pop.appendChild(node('div', 'vo-cb-sep'));
            pop.appendChild(host);
            wrap.appendChild(btn);
            wrap.appendChild(line);
            wrap.appendChild(pop);
            var c = {it: it, el: wrap, btn: btn, line: line, pop: pop, host: host, value: undefined, tip: tip, base: it.tip, sc: it.sc};
            /* A click on a pressed one (the selection has a color — by the engine at the moment of the click) removes the color, like a second click on "Bold": the same
               stock reset as the top row of the palette. On an unpressed one — the palette. From the keyboard the palette of a pressed one — by the down arrow
               (openFrom). */
            btn.addEventListener('click', guard(it.k, function (e) {
                e && e.preventDefault && e.preventDefault();
                e && e.stopPropagation && e.stopPropagation();
                var open = !wrap.classList.contains('open');
                me.closeSurfaces(wrap);
                if (!open || btn.disabled) return;
                if (me.colorOn(c)) { me.resetColor(c); return; }
                me.openPalette(c);
            }));
            reset.addEventListener('click', guard(it.k + ' reset', function (e) {
                e && e.stopPropagation && e.stopPropagation();
                me.closeSurfaces();
                me.resetColor(c);
            }));
            pop.addEventListener('mousedown', function (e) {
                var t = e && e.target;
                if (t && t.tagName !== 'INPUT') e.preventDefault && e.preventDefault();
            });
            this.setSwatch(c, null);
            return c;
        },

        openPalette: function (c) {
            if (c.btn.disabled) return;
            this.closeSurfaces(c.el);
            this.buildPalette(c);
            c.el.classList.add('open');
            c.btn.setAttribute('aria-expanded', 'true');
            this.openWrap = c;
            this.placePop(c.el, c.pop);
        },

        /* "Automatic" / "No fill" — the twin's stock reset (resetEvent), like the top row of the palette. */
        resetColor: function (c) {
            var it = c.it;
            this.beforeCommand();
            Bridge.run(it.twin, {event: it.resetEvent, args: it.resetArgs.slice()});
            this.done();
            this.soon();
        },

        /* Whether the color button is pressed: the selection has a color (pressOnColor), except plainColor. */
        pressOfColor: function (c, hex) {
            return !!c.it.pressOnColor && !!hex && hex !== c.it.plainColor;
        },

        colorOn: function (c) {
            return this.pressOfColor(c, this.colorHex(c));
        },

        pickColor: function (c, hex) {
            this.closeSurfaces();
            this.beforeCommand();
            Bridge.run(c.it.twin, {event: 'color:select', args: [hex.toUpperCase()]});
            this.done();
            this.soon();
        },

        buildPalette: function (c) {
            var me = this;
            if (c.grid) { this.markPalette(c); return; }
            var grid = node('div', 'vo-pal-grid', {role: 'group', 'aria-label': c.it.tip, style: '--vo-pal-cols:14'});
            c.swatches = [];
            [].concat.apply([], PALETTE_STAGE).forEach(function (hex) {
                var s = node('button', 'vo-pal-item', {'data-color': hex, 'aria-label': '#' + hex.toUpperCase(), 'aria-pressed': 'false',
                    style: 'background:#' + hex, tabindex: '-1'});
                var chk = node('span', 'vo-pal-check', {style: 'color:' + paletteInk(hex)});
                chk.innerHTML = Icons.svg('checkMenu', 14);
                s.appendChild(chk);
                s.addEventListener('click', guard(c.it.k + ' swatch', function (e) {
                    e && e.stopPropagation && e.stopPropagation();
                    me.pickColor(c, hex);
                }));
                c.swatches.push(s);
                grid.appendChild(s);
            });
            c.host.appendChild(grid);
            c.grid = grid;

            /* The color code field: the stock 'color:select' accepts any color. */
            var toggle = node('button', 'vo-pal-toggle', {tabindex: '-1'});
            toggle.textContent = this.textCustomColor;
            var field = node('div', 'vo-pal-custom vo-hidden');
            var wrapField = node('span', 'vo-pal-field');
            var input = node('input', 'vo-pal-input', {type: 'text', maxlength: '7', spellcheck: 'false', placeholder: '#',
                'aria-label': this.textColorCode_ARIA, tabindex: '-1'});
            var preview = node('span', 'vo-pal-preview', {'aria-hidden': 'true'});
            wrapField.appendChild(input);
            wrapField.appendChild(preview);
            field.appendChild(wrapField);
            c.host.appendChild(toggle);
            c.host.appendChild(field);
            c.input = input;
            c.preview = preview;
            toggle.addEventListener('click', guard(c.it.k + ' custom', function (e) {
                e && e.stopPropagation && e.stopPropagation();
                toggle.classList.add('vo-hidden');
                field.classList.remove('vo-hidden');
                me.keys(false);
                input.focus && input.focus();
                input.select && input.select();
            }));
            var commit = function () {
                var hex = normHex(input.value);
                if (!hex) { me.markPalette(c); return; }
                me.pickColor(c, hex);
            };
            input.addEventListener('mousedown', function () { me.keys(false); });
            input.addEventListener('keydown', guard(c.it.k + ' code', function (e) {
                if (e.key === 'Enter') { e.preventDefault && e.preventDefault(); commit(); }
            }));
            input.addEventListener('blur', function () { me.keys(true); });
            this.markPalette(c);
        },

        markPalette: function (c) {
            var cur = c.value || null;
            (c.swatches || []).forEach(function (s) {
                var on = s.getAttribute('data-color') === cur;
                s.classList.toggle('on', on);
                s.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            if (c.preview) c.preview.style.background = cur ? '#' + cur : 'transparent';
            if (c.input) c.input.value = cur ? '#' + cur.toUpperCase() : '';
        },

        /* The toolbar button's pressed state: the on class (the pressed look — the LESS rules of the row buttons) — one for all buttons with a state:
           font style, format painter, colors, ₽ %, "123", alignment, wrap, merge, filter, rotation, freeze.
           aria-pressed for the screen reader — only for toggles (font style, format painter, filter, colors, ₽ %); buttons with a
           list do not have it, like "Borders". */
        setPressed: function (c, on) {
            c.btn.classList.toggle('on', !!on);
            /* A button with a list (aria-haspopup) is pressed by look only, like "Borders": a click opens the list rather than toggling. */
            if (c.it && c.it.type === 'drop') c.btn.removeAttribute('aria-pressed');
            else c.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        },

        /* hex — six lowercase digits or null (automatic / no fill). A button with pressOnColor is pressed while there is a color. */
        setSwatch: function (c, hex) {
            if (c.it.pressOnColor) this.setPressed(c, this.pressOfColor(c, hex));
            if (c.value === hex) return;
            c.value = hex;
            c.line.style.background = hex ? '#' + hex : c.it.resetSwatch;
            if (c.grid) this.markPalette(c);
        },

        /* --- State ------------------------------------------------------- */

        twinText: function (ref) {
            var o = Bridge.twin(ref);
            if (!o) return '';
            var v = typeof o.getRawValue === 'function' ? o.getRawValue() : (typeof o.getValue === 'function' ? o.getValue() : null);
            return v == null ? '' : String(v);
        },

        /* The font name — from the engine (the selection's xfs): the stock font list sets
           its caption with a 100 ms delay (ComboBoxFonts.onApiChangeFont), and
           the toolbar caption would lag one selection behind. */
        engineFont: function (info) {
            var api = this.api();
            if (!info && api && typeof api.asc_getCellInfo === 'function') {
                try { info = api.asc_getCellInfo(); } catch (e) { info = null; }
            }
            var xfs = info && typeof info.asc_getXfs === 'function' ? info.asc_getXfs() : null;
            var name = xfs && typeof xfs.asc_getFontName === 'function' ? xfs.asc_getFontName() : null;
            return name ? String(name) : '';
        },

        /* The current zoom in percent — the caption and mark of the toolbar zoom list, the mark of "View → Zoom ▸" (SheetActions.zoomNow). */
        zoomPercent: function () {
            var api = this.api();
            var z = api && typeof api.asc_getZoom === 'function' ? api.asc_getZoom() : null;
            /* Rounding — as for the sheet row zoom caption (view/Statusbar.js:
               Math.floor((asc_getZoom() + .005) * 100)): one value in two places. */
            return typeof z === 'number' && isFinite(z) ? Math.floor((z + 0.005) * 100) : null;
        },

        /* The twins by which a control is disabled: a button — its own; a control without a twin — the availability control (lock);
           a choice list — disabled when all its stock buttons are disabled. */
        refs: function (it) {
            if (it.twin) return [it.twin];
            if (it.lock) return [it.lock];
            if (it.choices) return it.choices.map(function (ch) { return ch.twin; });
            if (it.entries) return it.entries.filter(function (e) { return !e.sep; }).map(function (e) { return e.twin; });
            return [];
        },

        /* An update of the whole toolbar from the twins and the engine. By this moment stock has already
           distributed the selection over its controls: its callbacks are subscribed earlier than
           ours. info — the engine's answer from asc_onSelectionChanged; without it the selection
           is asked from the engine once per whole update (font, colors, pressed state). */
        refresh: function (info) {
            var me = this, api;
            if (!this.ctrl) return;
            if (!info && (api = this.api()) && typeof api.asc_getCellInfo === 'function') {
                try { info = api.asc_getCellInfo(); } catch (e) { info = null; }
            }
            /* The engine selection for the pressed state — one per update and only on demand (selState). */
            var sel = null, selOf = function () { return sel || (sel = me.selState(info)); };
            this.order.forEach(function (k) { me.syncCtrl(me.ctrl[k], info, selOf); });
            /* A disabled control does not hold a Tab stop. */
            this.roveSoon();
        },

        syncCtrl: function (c, info, selOf) {
            if (!c) return;
            var it = c.it;
            var me = this, refs = this.refs(it);
            var states = refs.map(function (r) {
                return r === it.twin ? me.twinState(it) : (r === it.lock ? me.lockState(it) : Bridge.state(r));
            });
            var off = refs.length ? states.every(function (s) { return s.disabled; }) : false;
            this.setDisabled(c, off, off ? SheetActions.lockReason([].concat.apply([], states.map(function (s) { return s.causes || []; }))) : null);
            if (it.on) this.setPressed(c, !!(states[0] && states[0].pressed));
            else if (typeof it.press === 'function') this.setPressed(c, !!it.press(selOf ? selOf() : this.selState(info)));
            /* The pressed state by the engine — a look only (the common .vo-ib.on rule). No aria-pressed: this is a list button
               (aria-haspopup), a click opens the list rather than toggling. A disabled button shows the data too. */
            if (it.engine === 'borders') c.btn.classList.toggle('on', this.engineBorders(info));
            if (it.type === 'value') {
                var text = it.source === 'zoom' ? (this.zoomPercent() != null ? this.zoomPercent() + '%' : '')
                    : (it.source === 'fonts' ? (this.engineFont(info) || this.twinText(it.twin)) : this.twinText(it.twin));
                if (c.label.textContent !== text) c.label.textContent = text;
            }
            if (it.type === 'size') {
                /* The chevron is disabled together with the field; a disabled box without hover. */
                this.setDisabled(c.caretCtl, off, c.reason);
                c.el.classList.toggle('vo-size-off', off);
                this.syncSize(c);
            }
            if (it.source === 'choice') {
                /* The glyph is the current alignment; also a variant without a row in the list (glyphs: "justify"). Pressed — a non-default is chosen
                   (a row without plain or a variant from glyphs). */
                var hit = null, chosen = false;
                it.choices.forEach(function (ch, i) { if (states[i] && states[i].pressed) { hit = ch.i; chosen = !ch.plain; } });
                (it.glyphs || []).forEach(function (g) { if (Bridge.state(g.twin).pressed) { hit = g.i; chosen = true; } });
                var name = hit || it.i;
                if (c.glyphName !== name) { c.glyphName = name; c.glyph.innerHTML = airGlyph(name, 18); }
                if (it.press === 'choice') this.setPressed(c, chosen);
            }
            if (it.type === 'color') this.syncColor(c, info);
        },

        /* A disabled control is visible as inactive, not hidden:
           neighbors under the cursor do not shift. The reason is in the tooltip, where stock
           names it. */
        /* For the screen reader — explicitly: aria-disabled and the reason in the tooltip
           (aria-description — the button description with the name from aria-label; instead of title, the same is shown by the hover
           tooltip). The disabled attribute stays: the
           disabled look and the click refusal rest on it. */
        setDisabled: function (c, off, reason) {
            var btn = c && c.btn;
            if (!btn) return;
            off = !!off;
            btn.disabled = off;
            if (off) btn.setAttribute('disabled', 'disabled');
            else btn.removeAttribute('disabled');
            if (off) btn.setAttribute('aria-disabled', 'true');
            else btn.removeAttribute('aria-disabled');
            c.reason = off && reason ? reason : null;
            this.applyTitle(c);
        },

        /* The tooltip = the caption with a shortcut (followShortcuts) and the reason for being disabled (a disabled button does have a tooltip, with
           the reason — the stock fixTitle would have turned it off). */
        applyTitle: function (c) {
            var btn = c && c.btn;
            if (!btn) return;
            setTip(btn, c.reason ? c.tip + ' — ' + c.reason : c.tip);
        },

        syncColor: function (c, info) {
            var hex = this.colorHex(c, info);
            if (hex !== undefined) this.setSwatch(c, hex);
        },

        /* The selection color in the engine: six lowercase digits, null — automatic / no fill, undefined — the engine gave no selection. */
        colorHex: function (c, info) {
            var xfs = this.xfsOf(info);
            if (!xfs) return undefined;
            var clr = c.it.engine === 'font'
                ? (typeof xfs.asc_getFontColor === 'function' ? xfs.asc_getFontColor() : null)
                : (typeof xfs.asc_getFillColor === 'function' ? xfs.asc_getFillColor() : null);
            if (!clr || (typeof clr.get_auto === 'function' && clr.get_auto()) || typeof clr.get_r !== 'function') return null;
            return hexOf(clr.get_r(), clr.get_g(), clr.get_b());
        },

        /* The selection format in the engine (xfs from asc_onSelectionChanged; without it — asc_getCellInfo). */
        xfsOf: function (info) {
            var api = this.api();
            if (!info && api && typeof api.asc_getCellInfo === 'function') {
                try { info = api.asc_getCellInfo(); } catch (e) { info = null; }
            }
            try { return info && typeof info.asc_getXfs === 'function' ? info.asc_getXfs() : null; } catch (e) { return null; }
        },

        /* The selection for the pressed state (the catalog's press): nf — the name of the number format type (Asc.c_oAscNumFormatType; null — the engine did not
           give a format), angle — the text angle (0 — horizontal), frozen — the sheet has frozen areas. The same values by which stock sets
           its format list, rotation menu and the "Unfreeze panes" caption (controller/Toolbar.js onApiSelectionChanged,
           controller/ViewTab.js onApiSheetChanged). */
        selState: function (info) {
            var out = {nf: null, angle: 0, frozen: false};
            var xfs = this.xfsOf(info), api = this.api();
            if (xfs) {
                try {
                    var nf = typeof xfs.asc_getNumFormatInfo === 'function' ? xfs.asc_getNumFormatInfo() : null;
                    var type = nf && typeof nf.asc_getType === 'function' ? nf.asc_getType() : null;
                    var T = (window.Asc && Asc.c_oAscNumFormatType) || {};
                    Object.keys(T).forEach(function (n) { if (type != null && T[n] === type) out.nf = n; });
                    out.angle = typeof xfs.asc_getAngle === 'function' ? (xfs.asc_getAngle() || 0) : 0;
                } catch (e) { /* a selection without a cell format — not pressed */ }
            }
            try {
                var sv = api && typeof api.asc_getSheetViewSettings === 'function' ? api.asc_getSheetViewSettings() : null;
                out.frozen = !!(sv && typeof sv.asc_getIsFreezePane === 'function' && sv.asc_getIsFreezePane());
            } catch (e) { out.frozen = false; }
            return out;
        },

        /* Whether the selection has a border — from the engine, like the colors: info from asc_onSelectionChanged, without it —
           asc_getCellInfo(). asc_getBorders() — the sides of the active cell (or its merged area), an empty
           side — from the neighbor, plus the diagonals; for a selected object and for an engine that gives no borders — null.
           A side is set if it exists and its style is not None — the same rule as for the border sample of the right cell
           panel and for the marks of the "Borders" list rows (SheetActions.borderSides). There is no flag of our own; if it cannot be read —
           not pressed, and a read failure does not interrupt updating the other controls. */
        engineBorders: function (info) {
            try {
                var api = this.api();
                if (!info && api && typeof api.asc_getCellInfo === 'function') info = api.asc_getCellInfo();
                return SheetActions.hasBorder(SheetActions.borderSides(info));
            } catch (e) {
                return false;
            }
        },

        /* A deferred update: the twin observers arrive in a batch. */
        soon: function () {
            var me = this;
            if (this._soon) return;
            this._soon = true;
            setTimeout(guard('refresh', function () { me._soon = false; me.refresh(); }), 0);
        },

        /* Subscriptions: engine callbacks and notifications — through the shell (under its guard,
           the rollback removes them), watching the twin nodes — StockBridge.watch. */
        bind: function (shell) {
            var me = this;
            if (!this.el) return;
            var subs = shell && shell.subs;
            var onApi = function (name, fn) {
                if (shell && typeof shell.onApi === 'function') return shell.onApi(name, fn);
                var api = me.api();
                api && api.asc_registerCallback && api.asc_registerCallback(name, fn);
            };
            var onNote = function (name, fn) {
                if (shell && typeof shell.onNote === 'function') return shell.onNote(name, fn);
                Common.NotificationCenter.on(name, fn);
            };
            onApi('asc_onSelectionChanged', function (info) { me.refresh(info); });
            /* Sheet view settings and a sheet change — freezing areas ("Freeze panes" is pressed). */
            ['asc_onZoomChanged', 'asc_onCanUndoChanged', 'asc_onCanRedoChanged', 'asc_onEditCell',
             'asc_onStopFormatPainter', 'asc_onCoAuthoringDisconnect', 'asc_onUpdateSheetViewSettings', 'asc_onSheetsChanged'].forEach(function (name) {
                onApi(name, function () { me.refresh(); });
            });
            onNote('fonts:change', function () { me.soon(); });
            /* The width is given by an observer, not a media query (as in documents): the row and
               the right edge. Without ResizeObserver — a recalculation on window resize. */
            var relayout = guard('relayout', function () { me.relayout(); });
            if (window.ResizeObserver) {
                var ro = new ResizeObserver(relayout);
                ro.observe(this.el);
                ro.observe(this.end);
                subs && subs.push(function () { ro.disconnect(); });
            } else if (window.addEventListener) {
                window.addEventListener('resize', relayout);
                subs && subs.push(function () { window.removeEventListener && window.removeEventListener('resize', relayout); });
            }
            /* The caption metrics depend on the loaded font. */
            if (document.fonts && document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(relayout);
            this.followShortcuts();
            this.bindKeys(shell);
            this.bindPress(shell);
            this.bindTips(shell);
            var seen = {};
            this.order.forEach(function (k) {
                var it = me.ctrl[k].it;
                var refs = me.refs(it);
                if (it.glyphs) refs = refs.concat(it.glyphs.map(function (g) { return g.twin; }));
                refs.forEach(function (ref) {
                    if (seen[ref]) return;
                    seen[ref] = true;
                    var off = Bridge.watch(ref, function () { me.soon(); });
                    subs && subs.push(off);
                });
            });
            this.refresh();
            this.relayout();
            this.rove();
        },

        /* --- Surfaces ------------------------------------------------------ */

        /* Close everything else at once — through the shell: the menu bar row and the toolbar lists
           do not live at the same time, as in documents. Without a shell — our own. */
        closeSurfaces: function (keep) {
            var shell = SSE.Views.CompactShell;
            if (shell && typeof shell.closeSurfaces === 'function' && shell.tb === this) { shell.closeSurfaces(keep); return; }
            hideTip();
            Bridge.closePopup('close');
            if (!(keep && this.inOverflow(keep))) this.closeOverflow();
            this.closePopovers();
        },

        closePopovers: function () {
            var me = this;
            clearTimeout(this.hoverTimer);
            (this.order || []).forEach(function (k) {
                var c = me.ctrl[k];
                if (!c || !c.el.classList.contains('open')) return;
                me.closeList(c);
                c.btn && c.btn.setAttribute('aria-expanded', 'false');
            });
            this.openWrap = null;
        },

        hasOpenPopover: function () {
            if (this.el && this.el.classList.contains('vo-of-open')) return true;
            return this.listOpen();
        },

        /* A control's list or palette is open (in the row or in "⋯"). */
        listOpen: function () {
            var me = this;
            return (this.order || []).some(function (k) { return me.ctrl[k].el.classList.contains('open'); });
        },

        /* One layer at a time (Escape): first the submenu, then the list itself, then "⋯". */
        closeTopPopover: function () {
            var me = this, hit = false;
            (this.order || []).some(function (k) {
                var c = me.ctrl[k];
                if (!c.el.classList.contains('open')) return false;
                if (c.fly) me.closeFly(c);
                else me.closeList(c);
                hit = true;
                return true;
            });
            if (!hit && this.el && this.el.classList.contains('vo-of-open')) {
                this.closeOverflow();
                hit = true;
            }
            return hit;
        },

        /* A press inside an open toolbar surface (its button or list, "⋯"
           and its list): a click elsewhere does not close it — the button will toggle its own
           list itself, and a control from "⋯" will decide itself whether to close it. */
        ownsTarget: function (t) {
            var me = this;
            /* The stock gallery at a list row is part of the open surface. */
            if (Bridge.popupOwns(t)) return true;
            if (this.el && this.el.classList.contains('vo-of-open') && within(this.moreWrap, t)) return true;
            return (this.order || []).some(function (k) {
                var c = me.ctrl[k];
                return c.el.classList.contains('open') && within(c.el, t);
            });
        },

        /* The node lies in the "⋯" list: opening its list does not close "⋯" — the control
           went there as a live node, and closing would take it home in the middle of a click. */
        inOverflow: function (el) {
            return !!(this.ofPop && el && within(this.ofPop, el));
        },

        /* --- "⋯" ---------------------------------------------------------------- */
        /* Collapsed controls move into the "⋯" list as live nodes and
           come back (as in documents): a command has one control, not
           two copies with diverging state. The unit of transfer is a control;
           the split into groups is preserved by empty group wrappers. */

        toggleOverflow: function () {
            var open = !this.el.classList.contains('vo-of-open');
            this.closeSurfaces();
            if (open) this.openOverflow();
        },

        openOverflow: function () {
            var me = this, moved = 0;
            if (!this.el || this.locked) return;
            this.groups.forEach(function (grp) {
                var hidden = Array.prototype.slice.call(grp.children).filter(function (el) {
                    return el.classList.contains('vo-collapsed');
                });
                if (!hidden.length) return;
                var g = node('div', 'vo-g', {'data-group': grp.getAttribute('data-group')});
                me.ofPop.appendChild(g);
                hidden.forEach(function (el) {
                    g.appendChild(el);
                    el.classList.remove('vo-collapsed');
                });
                moved += hidden.length;
            });
            if (!moved) { this.ofPop.textContent = ''; return; }
            this.el.classList.add('vo-of-open');
            this.more.setAttribute('aria-expanded', 'true');
        },

        closeOverflow: function () {
            var me = this;
            if (!this.el || !this.el.classList.contains('vo-of-open')) return;
            this.closePopovers();
            /* Home — in the original row order: within a group the core stands also after
               the departed ones (the font size after the font list), a plain appendChild would swap
               them. */
            this.order.forEach(function (k) { var c = me.ctrl[k]; c.home.appendChild(c.el); });
            this.ofPop.textContent = '';
            this.el.classList.remove('vo-of-open');
            this.more.setAttribute('aria-expanded', 'false');
            this.relayout();
        },

        /* --- Row measurement ---------------------------------------------------------- */
        /* The documents algorithm (CompactToolbar.relayout): show everything, remove widths,
           count by arithmetic, apply once. The difference in spreadsheets — the core is not
           solid: only non-core controls leave, one at a time from the end of the row,
           the order of leaving is the reverse of priority; the core never leaves. There is no permanent
           tail: if everything fits — "⋯" is hidden. The focus chevron at the right edge is
           a term. The disable mask is a layer over the row, not part of the measurement.
           Narrow windows: leaving into "⋯" is decided only by the measurement, it has no thresholds on the window
           width — the row follows its own width (the size observer), not the window.
           The list density (font 88 at ≤ 1280, number format 84 at < 1040) is in LESS by
           a media query, as in documents: the measurement takes the widths there
           are. Below the floor, where even the core with "⋯" and the chevron does not fit, the row is not
           scrolled: the core stays in the row, the tail of the row is clipped by
           groups from the end (clipTail), "⋯" and the chevron are inside the card. */
        relayout: function () {
            if (this._busy || !this.el) return;
            var bar = this.el;
            /* The "⋯" list is open — the controls are physically in it; recalculation on closing. */
            if (bar.classList.contains('vo-of-open')) return;
            /* The toolbar is hidden (focus does not hide it, but "Hide toolbar", Stock and
               the reader do): widths are zero, the measurement would be false. */
            if (!bar.clientWidth || !window.getComputedStyle) return;
            this._busy = true;
            try {
                var me = this;
                var cs = window.getComputedStyle(bar);
                var gapGroup = parseFloat(cs.columnGap || cs.gap) || 0;
                var items = this.order.map(function (k) { return me.ctrl[k].el; });
                var core = this.order.map(function (k) { return !!me.ctrl[k].it.core; });

                /* 1. Show everything (and remove the clipping below the floor) and remove widths. */
                items.forEach(function (n) { n.classList.remove('vo-collapsed'); });
                this.groups.forEach(function (g) { g.classList.remove('vo-collapsed'); me.unclip(g); });
                this.moreWrap.classList.remove('vo-collapsed');
                var w = items.map(function (n) { return n.getBoundingClientRect().width; });
                var moreW = this.moreWrap.getBoundingClientRect().width;
                var gs = this.groups[0] ? window.getComputedStyle(this.groups[0]) : null;
                var gapItem = gs ? (parseFloat(gs.columnGap || gs.gap) || 0) : 0;

                /* 2. Room for the groups: the row without padding, without the right edge and its
                   gap. "⋯" is hidden here — its width and gap are added by need. */
                this.moreWrap.classList.add('vo-collapsed');
                var endW = this.end.getBoundingClientRect().width;
                var avail = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - endW - gapGroup;

                /* 3. How much is needed for the given set of departed ones. */
                var homes = items.map(function (n) { return n.parentNode; });
                var need = function (gone, withMore) {
                    var total = 0, groups = 0, prev = null, inGroup = 0;
                    for (var i = 0; i < items.length; i++) {
                        if (gone[i]) continue;
                        if (homes[i] !== prev) { groups++; prev = homes[i]; inGroup = 0; }
                        total += w[i] + (inGroup ? gapItem : 0);
                        inGroup++;
                    }
                    total += Math.max(0, groups - 1) * gapGroup;
                    if (withMore) total += moreW + gapGroup;
                    return total;
                };

                /* 4. If everything fits — "⋯" is not needed; otherwise leave one at a time from the end,
                   the core is skipped. */
                var gone = items.map(function () { return false; });
                var withMore = need(gone, false) > avail + 0.5;
                if (withMore) {
                    for (var i = items.length - 1; i >= 0 && need(gone, true) > avail + 0.5; i--) {
                        if (!core[i]) gone[i] = true;
                    }
                }

                /* 5. Apply. */
                items.forEach(function (n, k) { n.classList.toggle('vo-collapsed', gone[k]); });
                this.moreWrap.classList.toggle('vo-collapsed', !withMore);
                this.syncGroups();

                /* 6. Below the floor: there is nothing more to give up — clip the tail of the row. */
                var over = need(gone, withMore) - avail;
                if (over > 0.5) this.clipTail(over);
                this.fit = {visible: gone.filter(function (g) { return !g; }).length, total: items.length,
                            gone: this.order.filter(function (k, j) { return gone[j]; }),
                            clipped: over > 0.5 ? Math.round(over) : 0};
                this.syncSeparators();
            } finally {
                this._busy = false;
            }
            /* The visibility of controls changed: the Tab stop — on a visible and unclipped one. */
            this.rove();
        },

        /* Below the floor the core with "⋯" and the chevron does not fit: the core does not leave, and the
           row is not scrolled and does not push "⋯" and the chevron beyond the edge. Groups
           from the end of the row are clipped by width (vo-g-clip: overflow-x clip, its own
           max-width) until the shortfall is covered; the controls stay in the row. The separator
           of a clipped group is moved by LESS inside its field — otherwise the clip would cut it off. */
        clipTail: function (over) {
            var live = this.groups.filter(function (g) { return !g.classList.contains('vo-collapsed'); });
            for (var i = live.length - 1; i >= 0 && over > 0.5; i--) {
                var g = live[i];
                g.classList.add('vo-g-clip');
                var gw = g.getBoundingClientRect().width;
                var pad = parseFloat(window.getComputedStyle(g).paddingLeft) || 0;
                var cut = Math.min(over, Math.max(0, gw - pad));
                g.style.maxWidth = (gw - cut) + 'px';
                over -= cut;
            }
        },

        unclip: function (g) {
            g.classList.remove('vo-g-clip');
            g.style.maxWidth = '';
        },

        /* An emptied group is hidden entirely: its separator would hang in the air. */
        syncGroups: function () {
            this.groups.forEach(function (g) {
                var live = Array.prototype.some.call(g.children, function (n) { return !n.classList.contains('vo-collapsed'); });
                g.classList.toggle('vo-collapsed', !live);
            });
        },

        /* A group separator is drawn only when the group has a fully visible control
           and there is one further left in the row too; the "⋯" separator — when there is a fully visible control further left.
           Otherwise (the group is cut below the floor down to the padding or is empty) the bar would hang without buttons.
           The decision is by the current row DOM, without group names and the core; the row is not remeasured.
           The first group and hidden nodes do not get the class: they have no bar anyway. */
        syncSeparators: function () {
            var me = this, seen = false;
            this.groups.forEach(function (g, i) {
                var off = g.classList.contains('vo-collapsed');
                var has = !off && Array.prototype.some.call(g.children, function (n) { return me.whole(n); });
                g.classList.toggle(SEP_OFF, i > 0 && !off && !(has && seen));
                if (has) seen = true;
            });
            if (this.moreWrap) this.moreWrap.classList.toggle(SEP_OFF, !this.moreWrap.classList.contains('vo-collapsed') && !seen);
        },

        /* Whether a row control is fully visible: not departed, has a box and is not cut by the clipping below the floor. */
        whole: function (el) {
            return !el.classList.contains('vo-collapsed') && this.shown(el) && !this.clipped(el);
        },

        /* --- Editing ban --------------------------------------------------- */
        /* The meaning of the stock ribbon mask (controller/Toolbar.js DisableToolbar), as
           in documents: a transparent layer over the row eats clicks, the content is
           dimmed, and the controls are removed from tab order — a mask alone is not enough, Tab and Enter
           would run a command. We do not touch the states of the controls
           themselves: the twins drive them. The mask is outside the row arithmetic (relayout). */
        locked: false,

        setLocked: function (lock) {
            lock = !!lock;
            this.locked = lock;
            var bar = this.el;
            if (!bar) return;
            if (lock) { this.closeOverflow(); this.closePopovers(); }
            var mask = this.mask;
            if (lock && !mask) {
                mask = this.mask = node('div', 'vo-tb-mask', {'aria-hidden': 'true'});
                bar.appendChild(mask);
            }
            if (!lock && mask) {
                mask.parentNode && mask.parentNode.removeChild(mask);
                this.mask = null;
            }
            bar.classList.toggle('vo-masked', lock);
            /* Under a ban there are no stops at all; lifted — there is again one stop of the row
               (the row has a roving tabindex, the list rows are outside Tab order). */
            var live = bar.querySelectorAll ? bar.querySelectorAll('button, input') : [];
            Array.prototype.forEach.call(live, function (el) { el.setAttribute('tabindex', '-1'); });
            if (lock) {
                var focused = document.activeElement;
                if (focused && within(bar, focused) && focused.blur) focused.blur();
            } else {
                this.rove();
            }
        },

        /* --- Keyboard ---------------------------------------------- */
        /* WAI-ARIA APG "Toolbar" (WCAG 2.1 AA): the row is one Tab
           stop (roving tabindex: 0 on the current control, -1 on the others, Tab leaves the row
           onward), ←/→ (reversed in RTL), Home/End — over the visible available controls of the row, "⋯"
           and the chevron; what went into "⋯" is in the order when the "⋯" list is expanded (the controls there are live).
           Controls disabled by stock are not in the order (disabled — the screen reader hears them in the overview with
           aria-disabled and the reason) and neither are those clipped below the floor (Tab would land on an
           invisible button). In the font size field the arrows move the cursor, at the field edge — to the neighbor.
           ↓ — and for a list button also Enter and Space — opens the list and puts focus on
           the marked (or first) row; in a list ↑/↓, Home/End, → opens the row's submenu,
           ← closes it, Tab closes the list and leaves the row; Escape removes
           the layer (CompactShell.bindChromeEscape) and returns focus to whoever opened the layer
           (openerChain). The focus is visible as an AIR ring (compact-shell.less, :focus-visible). */

        roveCur: null,

        /* Stop candidates — the main nodes of the controls (for the font size — the field, the chevron is not a stop), "⋯" and
           the chevron, in document order: an expanded "⋯" stands after the row, its controls — after it. */
        stopNodes: function () {
            var me = this, out = [];
            if (!this.el) return out;
            (this.order || []).forEach(function (k) {
                var c = me.ctrl[k];
                if (!c) return;
                if (c.btn) out.push(c.btn);
            });
            if (this.more) out.push(this.more);
            if (this.focusBtn) out.push(this.focusBtn);
            return out.filter(Boolean).sort(function (a, b) {
                var p = typeof a.compareDocumentPosition === 'function' ? a.compareDocumentPosition(b) : 0;
                return p & 4 ? -1 : (p & 2 ? 1 : 0);
            });
        },

        /* Whether the node is clipped below the floor (clipTail): its edge is beyond the edge of the clipped group. */
        clipped: function (el) {
            var g = typeof el.closest === 'function' ? el.closest('.vo-g') : null;
            if (!g || !g.classList.contains('vo-g-clip') || typeof el.getBoundingClientRect !== 'function') return false;
            return el.getBoundingClientRect().right > g.getBoundingClientRect().right + 0.5;
        },

        /* Whether the node is visible. Without layout (no getClientRects) — we count it visible. */
        shown: function (el) {
            if (typeof el.getClientRects !== 'function') return true;
            if (el.getClientRects().length === 0) return false;
            return !window.getComputedStyle || window.getComputedStyle(el).visibility !== 'hidden';
        },

        stops: function () {
            var me = this;
            return this.stopNodes().filter(function (el) {
                return !el.disabled && me.shown(el) && !me.clipped(el);
            });
        },

        /* One Tab stop — the current control (the last one that had focus), otherwise
           the first available. The row is not visible (hidden, Stock) — we do not touch it: Tab skips
           the invisible anyway. */
        rove: function (focusEl) {
            if (!this.el || this.locked) return;
            var list = this.stops();
            if (!list.length) return;
            var cur = focusEl && list.indexOf(focusEl) >= 0 ? focusEl
                : (list.indexOf(this.roveCur) >= 0 ? this.roveCur : list[0]);
            this.roveCur = cur;
            this.stopNodes().forEach(function (el) { el.setAttribute('tabindex', el === cur ? '0' : '-1'); });
        },

        /* The row's stop for F10 entry when the menu bar row is hidden (focus mode,
           CompactShell.entryStop): the same single Tab stop — the current control, otherwise
           the first available. The row is not visible or under a ban — null: there is no entry into it. */
        entryStop: function () {
            if (!this.el || this.locked) return null;
            var list = this.stops();
            if (!list.length) return null;
            this.rove();
            return list.indexOf(this.roveCur) >= 0 ? this.roveCur : list[0];
        },

        roveSoon: function () {
            var me = this;
            if (this._roveSoon) return;
            this._roveSoon = true;
            setTimeout(guard('rove', function () { me._roveSoon = false; me.rove(); }), 0);
        },

        moveTo: function (el) {
            if (!el) return;
            this.rove(el);
            el.focus && el.focus();
        },

        /* The control that owns the node. */
        ctrlOf: function (el) {
            var me = this, hit = null;
            (this.order || []).some(function (k) {
                var c = me.ctrl[k];
                if (c && within(c.el, el)) { hit = c; return true; }
                return false;
            });
            return hit;
        },

        /* The open list layer that contains the node: a control's list, its submenu or a palette.
           The "⋯" list is not counted as a layer — it holds the row's controls themselves. */
        popOf: function (el) {
            var p = el && typeof el.closest === 'function' ? el.closest('.vo-pop, .vo-cb-pop') : null;
            return p && within(this.el, p) ? p : null;
        },

        /* The layer rows for the arrows: visible buttons and fields in document order. */
        popItems: function (pop) {
            var me = this;
            return Array.prototype.filter.call(pop.querySelectorAll('button, input'), function (el) {
                return me.shown(el);
            }).filter(function (el) {
                /* A list submenu is a layer of its own (it lies in the control's wrapper, not in the list). */
                var own = el.closest('.vo-pop, .vo-cb-pop');
                return own === pop;
            });
        },

        /* The first row of an expanded layer: the marked one, otherwise the first. */
        focusPop: function (pop) {
            var items = pop ? this.popItems(pop) : [];
            if (!items.length) return false;
            var on = items.filter(function (el) { return el.classList.contains('on'); })[0];
            (on || items[0]).focus();
            return true;
        },

        onKey: function (e) {
            if (!e || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || this.locked) return;
            var t = e.target, key = e.key;
            var pop = this.popOf(t);
            if (pop) { this.popKey(e, pop); return; }
            var list = this.stops(), i = list.indexOf(t);
            if (i < 0) return;
            var rtl = document.body.classList.contains('rtl');
            var next = rtl ? 'ArrowLeft' : 'ArrowRight', prev = rtl ? 'ArrowRight' : 'ArrowLeft';
            if (t.tagName === 'INPUT') {
                if (key !== next && key !== prev) return;
                var len = String(t.value || '').length, s = t.selectionStart, end = t.selectionEnd;
                if (s !== end) return;
                if (key === next && s < len) return;
                if (key === prev && s > 0) return;
            }
            var n = list.length, c = this.ctrlOf(t);
            if (key === next) this.moveTo(list[(i + 1) % n]);
            else if (key === prev) this.moveTo(list[(i - 1 + n) % n]);
            else if (key === 'Home') this.moveTo(list[0]);
            else if (key === 'End') this.moveTo(list[n - 1]);
            else if (t.getAttribute('aria-haspopup') && (key === 'ArrowDown' || key === 'Enter' || key === ' ')) {
                this.openFrom(t, c, key);
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        },

        /* Expand a button's layer by its own stock-for-us path — click (the same handler as for the
           mouse), then focus into the layer. "⋯" — onto the first departed control. */
        openFrom: function (t, c, key) {
            if (t === this.more) {
                if (!this.el.classList.contains('vo-of-open')) t.click();
                var first = this.stops().filter(function (el) { return within(this.ofPop, el); }, this)[0];
                if (first) this.moveTo(first);
                return;
            }
            if (!c) return;
            var pop = c.pop;
            /* Color: the down arrow — the palette also for a pressed one (Enter and Space — a click: for a pressed one they remove the color). */
            if (!c.el.classList.contains('open')) {
                if (c.it.type === 'color' && key === 'ArrowDown') this.openPalette(c);
                else t.click();
            }
            if (pop && c.el.classList.contains('open')) this.focusPop(pop);
        },

        popKey: function (e, pop) {
            var t = e.target, key = e.key;
            var c = this.ctrlOf(pop);
            var items = this.popItems(pop), i = items.indexOf(t), n = items.length;
            if (i < 0 || !n || !c) return;
            var rtl = document.body.classList.contains('rtl');
            var inward = rtl ? 'ArrowLeft' : 'ArrowRight', outward = rtl ? 'ArrowRight' : 'ArrowLeft';
            var grid = t.closest('.vo-pal-grid');
            var cols = grid ? (parseInt(grid.style.getPropertyValue('--vo-pal-cols'), 10) || 1) : 1;
            var fly = pop.classList.contains('vo-pop-fly');
            if (t.tagName === 'INPUT' && key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Tab') return;
            if (key === 'Tab') {
                /* The list is closed, focus goes to the button; Tab moves on out of the row as usual (without
                   preventDefault), but not up to the Bootstrap delegate on document: for role=menu lists
                   it swallows any key (CompactShell, STOCK_MENU_KEYS). */
                var btn = c.btn;
                this.closeSurfaces();
                btn && btn.focus && btn.focus();
                e.stopPropagation();
                return;
            }
            var step = function (d) { return items[(i + d + n) % n]; };
            if (key === 'ArrowDown' || key === 'ArrowUp') {
                /* In a palette ↑/↓ move along the grid column, at its edge — to the grid's neighbor. */
                var d = key === 'ArrowDown' ? 1 : -1, to = null;
                if (grid) {
                    var cells = items.filter(function (el) { return within(grid, el); }), j = cells.indexOf(t);
                    to = cells[j + d * cols] || null;
                    if (!to) {
                        var edge = d > 0 ? items.indexOf(cells[cells.length - 1]) : items.indexOf(cells[0]);
                        to = items[(edge + d + n) % n];
                    }
                } else {
                    to = step(d);
                }
                to.focus();
            } else if (key === 'Home') {
                items[0].focus();
            } else if (key === 'End') {
                items[n - 1].focus();
            } else if (grid && (key === inward || key === outward)) {
                step(key === inward ? 1 : -1).focus();
            } else if (key === inward && t.classList.contains('vo-has-sub')) {
                t.click();
                this.focusSub(c, t);
            } else if (key === outward && fly) {
                var row = c.flyRow;
                this.closeFly(c);
                row && row.focus && row.focus();
            } else if (key === 'Enter' || key === ' ') {
                /* A row — its own click, as with the mouse: for ▸ a submenu opens, focus goes into it; for
                   a final row, a color swatch, "Custom color" and the palette reset — a choice. A stock
                   button press in a role=menu list does not reach click (the Bootstrap delegate,
                   STOCK_MENU_KEYS), and Space without preventDefault would click a second time on keyup. */
                t.click();
                if (t.classList.contains('vo-has-sub')) this.focusSub(c, t);
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        },

        /* A row with ▸ opened from the keyboard: focus goes into its layer. Our submenu — its first row;
           a stock gallery at the row ("Border style", "Border color", histograms…) — into the gallery itself
           (CompactShell.focusGallery: otherwise focus would stay on the row, and the arrows
           would move through our list under the open gallery). */
        focusSub: function (c, t) {
            if (c.fly && c.flyRow === t) { this.focusPop(c.fly); return; }
            var shell = SSE.Views.CompactShell;
            if (c.galleryRow === t && shell && typeof shell.focusGallery === 'function') shell.focusGallery();
        },

        /* Whom to return focus to when the layer with the node closed (Escape): the submenu's
           parent row, the control's button, "⋯" — in turn, the first visible one. */
        openerChain: function (el) {
            var out = [], me = this;
            if (!this.el || !el) return out;
            /* A stock gallery at a list row: focus could have gone into it — to the row, to the button. */
            if (Bridge.popupOwns(el)) {
                (this.order || []).forEach(function (k) {
                    var c = me.ctrl[k];
                    if (c && c.galleryRow) out.push(c.galleryRow, c.btn);
                });
                return out;
            }
            if (!within(this.el, el)) return out;
            var c = this.ctrlOf(el);
            if (c && el !== c.btn) {
                if (c.fly && within(c.fly, el) && c.flyRow) out.push(c.flyRow);
                if (c.btn) out.push(c.btn);
            }
            if (this.ofPop && within(this.ofPop, el)) out.push(this.more);
            return out;
        },

        bindKeys: function (shell) {
            var me = this, bar = this.el;
            if (!bar || typeof bar.addEventListener !== 'function') return;
            var onKey = guard('keyboard', function (e) { me.onKey(e); });
            var onFocus = guard('focus', function (e) {
                var t = e && e.target;
                if (t && me.stopNodes().indexOf(t) >= 0 && !me.locked) me.rove(t);
            });
            bar.addEventListener('keydown', onKey);
            bar.addEventListener('focusin', onFocus);
            var subs = shell && shell.subs;
            subs && subs.push(function () {
                bar.removeEventListener('keydown', onKey);
                bar.removeEventListener('focusin', onFocus);
            });
        },

        /* A mouse press. The pressed look of the toolbar buttons rested only on :active,
           and the browser removes it at once: the press reaches the button and is not canceled, but
           the engine on the same press moves focus into its field (#area_id, focusHtmlElement after
           mousedown), and on this focus Chrome resets :active on the button — it stays in the
           hover look (measured: a real mousePressed without mouseReleased — on pointerdown and mousedown
           :active is true, after the field focus it is false, the background is a hover tint). Our own press flag:
           the class vo-pressing on an available row button (including in "⋯", the font size chevron, the focus chevron) on
           pointerdown with the primary button, removed on pointerup and pointercancel anywhere in the window
           (capture — the engine does not swallow them) and when the window loses focus; the LESS rules give it the
           :active color (--vo-active, the white plate of a pressed button on blue). The mouse still
           does not touch focus and the command. */
        bindPress: function (shell) {
            this.trackPress(this.el, '.vo-ib', shell);
        },

        /* The press flag itself: for an available button under root, found by selector (closest
           from the press target), — on pointerdown with the primary button; removed on pointerup and
           pointercancel anywhere in the window (capture — the engine does not swallow them) and when the window
           loses focus. capture — listen to the press in the capture phase (the root is the document). The toolbar buttons
           (bindPress) and the header ones with the return-from-Stock button (CompactShell.
           bindHeaderPress). */
        trackPress: function (root, selector, shell, capture) {
            var pressed = null;
            if (!root || typeof root.addEventListener !== 'function') return;
            var release = guard('press end', function () {
                if (!pressed) return;
                pressed.classList.remove(PRESS_CLASS);
                pressed = null;
            });
            var onDown = guard('press', function (e) {
                release();
                if (!e || e.button !== 0) return;
                var t = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
                var b = t && typeof t.closest === 'function' ? t.closest(selector) : null;
                if (!b || !root.contains(b) || b.disabled) return;
                pressed = b;
                b.classList.add(PRESS_CLASS);
            });
            root.addEventListener('pointerdown', onDown, !!capture);
            window.addEventListener('pointerup', release, true);
            window.addEventListener('pointercancel', release, true);
            window.addEventListener('blur', release);
            var subs = shell && shell.subs;
            subs && subs.push(function () {
                release();
                root.removeEventListener('pointerdown', onDown, !!capture);
                window.removeEventListener('pointerup', release, true);
                window.removeEventListener('pointercancel', release, true);
                window.removeEventListener('blur', release);
            });
        },

        /* --- Hover tooltips ------------------------------------------------------------------- */
        /* 0.5 s after hovering a button — a tooltip with the command name and the shortcut, if there is one
           (hintOf: the system notation — Ctrl+B, on macOS ⌘+B); for a disabled one — also the reason. The texts are the same ones that used to be in
           title. The look is the stock ONLYOFFICE tooltip, as for the bottom row buttons. The place is under the toolbar row, and for
           controls in the expanded "⋯" — under the popup row:
           directly under the button the tooltip would cover the second row of "⋯"; centered on the button, not closer than 8 px to the window edges. */
        bindTips: function (shell) {
            var me = this;
            this.trackTips(this.el, '.vo-ib, .vo-size-input', shell, function (el) {
                return {edge: me.ofPop && me.el.classList.contains('vo-of-open') && within(me.ofPop, el) ? me.ofPop : me.el};
            });
        },

        /* The tooltip layer over root (the toolbar row; the header — CompactShell.bindHeaderTips): the control is the node of selector nearest to the
           hover target inside root, the text is its aria-description (setTip), the place is anchor(el) (see
           placeTip). mouseover and mouseout — in the capture phase, like the press in trackPress: before the handlers of the
           controls themselves; Chrome sends them for a disabled button (disabled) — it has a tooltip with the reason. Shown after
           TIP_DELAY after hovering; the tooltip
           goes away when the cursor leaves the control, and on a press, a key, the wheel, the window losing focus and a window
           resize, and also on closing the shell surfaces (closeSurfaces — it is called by a chrome change and by the focus
           mode alike). It does not go out by timer on its own (stock's goes out after 5 s). One node on body for both the toolbar and the header:
           hovering another control replaces the previous one. Unsubscribes — through shell.subs, as in trackPress. */
        trackTips: function (root, selector, shell, anchor) {
            if (!root || typeof root.addEventListener !== 'function') return;
            var ctrlOf = function (t) {
                t = t && t.nodeType === 1 ? t : (t && t.parentElement);
                var c = t && typeof t.closest === 'function' ? t.closest(selector) : null;
                return c && within(root, c) ? c : null;
            };
            var onOver = guard('tip over', function (e) {
                var t = e && e.target, c = ctrlOf(t);
                if (c && c === tipState.el) return;
                /* The control under the cursor disappeared (rebuild) — mouseout will not arrive from it. */
                if (tipState.el && within(root, tipState.el) && !(t && within(tipState.el, t))) hideTip();
                if (c) armTip(c, typeof anchor === 'function' ? anchor(c) : anchor);
            });
            var onOut = guard('tip out', function (e) {
                if (!tipState.el || !within(root, tipState.el)) return;
                var to = e && e.relatedTarget;
                if (to && within(tipState.el, to)) return;
                hideTip();
            });
            /* A press and the wheel arrive where the cursor is — while the tooltip is visible only while the cursor is over a control of root:
               root listens for them; the window listens for a key, the window losing focus and a resize. */
            var off = guard('tip hide', function () { if (tipState.el) hideTip(); });
            var WHEEL = {capture: true, passive: true};
            root.addEventListener('mouseover', onOver, true);
            root.addEventListener('mouseout', onOut, true);
            root.addEventListener('pointerdown', off, true);
            root.addEventListener('wheel', off, WHEEL);
            window.addEventListener('keydown', off, true);
            window.addEventListener('blur', off);
            window.addEventListener('resize', off);
            var subs = shell && shell.subs;
            subs && subs.push(function () {
                hideTip();
                root.removeEventListener('mouseover', onOver, true);
                root.removeEventListener('mouseout', onOut, true);
                root.removeEventListener('pointerdown', off, true);
                root.removeEventListener('wheel', off, WHEEL);
                window.removeEventListener('keydown', off, true);
                window.removeEventListener('blur', off);
                window.removeEventListener('resize', off);
            });
        },

        /* The control's (and header's) tooltip text: aria-description, title removed. */
        setTip: function (el, text) {
            setTip(el, text);
        },

        hideTip: function () {
            hideTip();
        },

        /* --- Texts ------------------------------------------------------------ */
        /* The defaults are English: the locale overrides them from locale/<language>.json (the keys
           SSE.Views.CompactToolbar.*). Phrases
           that only a screen reader hears (aria-label without a visible caption) have
           the _ARIA segment in the name. */

        textAlignBottom: 'Align bottom',
        textAlignCenter: 'Align center',
        textAlignJust: 'Justified',
        textAlignLeft: 'Align left',
        textAlignMiddle: 'Align middle',
        textAlignRight: 'Align right',
        textAlignTop: 'Align top',
        textAutoColor: 'Automatic',
        textColorCode_ARIA: 'Color code',
        textCustomColor: 'Custom color',
        textNoFill: 'No fill',
        textNoWrap: 'Do not wrap',
        textToolbar_ARIA: 'Formatting',
        textWrap: 'Wrap text',
        tipBold: 'Bold',
        tipBorders: 'Borders',
        tipChart: 'Chart',
        tipClearFormat: 'Clear format',
        tipComment: 'Add comment',
        tipCondFormat: 'Conditional formatting',
        tipCurrency: 'Accounting style',
        tipDecDecimal: 'Decrease decimal',
        tipFillColor: 'Fill color',
        tipFocus: 'Focus mode',
        tipFocusExit: 'Exit focus mode (Esc)',
        tipFilter: 'Filter',
        tipFontName: 'Font',
        tipFontSize: 'Font size',
        tipFreeze: 'Freeze panes',
        tipFunction: 'Function',
        tipHAlign: 'Horizontal align',
        tipImage: 'Image',
        tipIncDecimal: 'Increase decimal',
        tipItalic: 'Italic',
        tipLink: 'Link',
        tipMore: 'More',
        tipMerge: 'Merge cells',
        tipNumberFormat: 'Number format',
        tipPaintFormat: 'Copy style (double-click keeps it on)',
        tipPercent: 'Percent format',
        tipRedo: 'Redo',
        tipRotate: 'Text rotation',
        tipSearch: 'Search',
        tipSort: 'Sort',
        tipStrikeout: 'Strikethrough',
        tipTextColor: 'Text color',
        tipUnderline: 'Underline',
        tipUndo: 'Undo',
        tipVAlign: 'Vertical align',
        tipValidation: 'Data validation',
        tipWrap: 'Wrap text',
        tipZoom: 'Zoom'

    }, SSE.Views.CompactToolbar || {});

    /* Exposed: the zoom list ("View → Zoom ▸", the parity test) and the palette. */
    SSE.Views.CompactToolbar.ZOOMS = ZOOMS;
    SSE.Views.CompactToolbar.PALETTE = PALETTE_STAGE;

    return SSE.Views.CompactToolbar;
});
