/*
 * CompactToolbar — the toolbar driven by the selection.
 * Part of the web-apps fork, AGPL-3.0.
 *
 *     panel control  →  stock ribbon counterpart (StockBridge)  →  stock handler
 *
 * The white card #vo-tb in the #vo-toolbar row. The groups stand in priority
 * order, as in Google Slides: the common ones (service, "New Slide",
 * insert) — always, the contextual ones — only for their selection kind
 * (SlideSelection.kind(), the vo:selection event). Text controls — only
 * when the selection has text: a shape or group without text, an image,
 * a chart and a line do not get them. "Format Painter" is in the text group
 * next to B · I · U and appears together with them, and also for a shape without text
 * and a line: there the stock command transfers the fill and the outline. The button
 * tooltip matches the caption of the same command in the menu row (SlideActions).
 *
 * A button is a counterpart of the stock control: the command goes the stock way through
 * the bridge, availability and pressed state are read from the counterpart (watch), the values —
 * font, size, zoom, font styles, the alignment icon — come from
 * the engine through stock callbacks. The panel keeps no copies of the state of its own:
 * a value that arrives is put into the markup at once. Shell commands (search,
 * right-panel sections, "Object Properties", focus mode) — through
 * shell.command(); while a command has no owner, the control is inactive.
 *
 * Dropdown panels are either own ("Text Styles ▾", "Alignment and Spacing ▾",
 * "Lists and Indents ▾", value lists, color palettes) or the stock galleries
 * of counterparts, shown by the bridge at their button ("Layout ▾", "Shape ▾",
 * "Line ▾", "Image ▾", "Crop to Shape ▾"). An own
 * panel hands the choice to the counterpart: a stock menu item, an event of the stock
 * combo or palette.
 *
 * The right edge #vo-tb-end is the place of "Slide Show ▾" and the focus mode chevron
 * last; #vo-tb-more — "⋯", where the measurement moves what did not fit.
 *
 * For the time of the stock editing lock (version history, connection loss) the card
 * is locked entirely — the meaning of the stock ribbon mask (setLocked).
 *
 * The frame (CompactShell) installs the zone by calling install(shell) in the order of
 * CompactShell.ZONES.
 */
define([], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    var BAR_ID = 'vo-tb', END_ID = 'vo-tb-end', MORE_ID = 'vo-tb-more';
    /* Narrow window: the core and the right edge do not fit with the show caption. */
    var TIGHT_CLS = 'vo-tb-tight';
    /* Locked card: the layer over it, dimming and the former tabindex
       of the control (empty — it had none). */
    var MASK_CLS = 'vo-tb-mask', LOCK_CLS = 'vo-masked', TAB_ATTR = 'data-vo-tabindex';
    /* Commands of the right-panel sections (SlideSections): their buttons are the place
       of the popup panel. */
    var PANEL_CMDS = ['slideSection', 'objectProperties'];

    /* Panel zoom levels and font sizes — the sets of Compact documents and the prototype. */
    var ZOOMS = [50, 75, 90, 100, 125, 150, 175, 200];
    var FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 96];

    /* Palette of Compact documents: six rows by weights 100/200/300/400/600/800,
       fourteen columns. The highlight color — sixteen colors of the stock
       highlight set: the format stores the highlight by name, it has no color of its own. */
    var PALETTE = [
        'ffe4e6', 'ffe2d6', 'ffedd5', 'fef3c7', 'ecf8c8', 'dcfce7', 'd1fae5', 'ccfbf1', 'cffafe', 'dbeafe', 'e0e7ff', 'ede9fe', 'fce7f3', 'f1f5f9',
        'fecdd3', 'ffc6ad', 'fed7aa', 'fde68a', 'd8ee8e', 'bbf7d0', 'a7f3d0', '99f6e4', 'a5f3fc', 'bfdbfe', 'c7d2fe', 'ddd6fe', 'fbcfe8', 'e2e8f0',
        'fd9fac', 'ffa385', 'fdb573', 'fcd357', 'beda69', '83eba8', '6ee3b5', '63e5d2', '64e3f5', '90c0fc', 'a4affb', 'c2b1fc', 'f8a1cf', 'bbc6d4',
        'fb7185', 'ff805d', 'fb923c', 'fbbf24', 'a3c644', '4ade80', '34d399', '2dd4bf', '22d3ee', '60a5fa', '818cf8', 'a78bfa', 'f472b6', '94a3b8',
        'e11d48', 'd9471f', 'ea580c', 'b7791f', '5f7f1f', '16a34a', '059669', '0d9488', '0891b2', '2563eb', '4f46e5', '7c3aed', 'db2777', '64748b',
        '9f1239', '8f2d13', '9a3412', '78350f', '365314', '166534', '065f46', '115e59', '155e75', '1e40af', '3730a3', '5b21b6', '9d174d', '334155'
    ];
    var HIGHLIGHT = ['FFFF00', '00FF00', '00FFFF', 'FF00FF', '0000FF', 'FF0000', '00008B', '008B8B',
                     '006400', '800080', '8B0000', '808000', 'FFFFFF', 'D3D3D3', 'A9A9A9', '000000'];

    /* Palettes: the set, the number of columns, the custom color field and the reset caption.
       Where the choice goes — applyColor/resetColor. */
    var PALETTES = {
        text:        {colors: PALETTE, cols: 14, custom: true, reset: 'auto'},
        highlight:   {colors: HIGHLIGHT, cols: 8, custom: false, reset: 'noFill'},
        fill:        {colors: PALETTE, cols: 14, custom: true, reset: 'noFill'},
        line:        {colors: PALETTE, cols: 14, custom: true, reset: 'noLine'},
        tableFill:   {colors: PALETTE, cols: 14, custom: true, reset: 'noFill'},
        tableBorder: {colors: PALETTE, cols: 14, custom: true, reset: 'noBorders'}
    };

    /* Selection kinds with text: an object with text — a text box, placeholder,
       shape or group with text; a table; text typing. A shape or group
       without text — the kind 'shape'. */
    var TEXT = ['text', 'table', 'typing'];
    /* "Format Painter": the stock btnCopyStyle lives with a table and any
       shape except a picture and a chart (Toolbar.onFocusObject,
       noParagraphSelected), and for a shape the engine also transfers the fill and outline
       (getFormatPainterData), — with text, a shape without text and a line. */
    var PAINT = TEXT.concat(['shape', 'line']);
    var FILL = ['text', 'shape'];
    var OBJECT = ['text', 'shape', 'image', 'table', 'chart', 'line'];

    /* Row groups from left to right — priority order: they go into "⋯" from the end.
       "Format Painter" is in the text group right after B · I · U: without a
       selection it is always disabled and not needed in the row. The group is visible also for a shape
       without text and a line, but then it has only "Format Painter" (when on
       the buttons). when — the selection kinds for which the group or button is visible; without
       when — always. */
    var GROUPS = [
        {name: 'core',       items: ['undo', 'redo', 'search', 'comment', 'zoom']},
        {name: 'text',       items: ['font', 'size', 'bold', 'italic', 'underline', 'painter', 'textPop'], when: PAINT},
        {name: 'paragraph',  items: ['align', 'lists'], when: TEXT},
        {name: 'slide',      items: ['newSlide']},
        {name: 'insert',     items: ['image', 'shape', 'textbox', 'link']},
        {name: 'slideProps', items: ['bg', 'layout', 'theme', 'transition'], when: ['none']},
        {name: 'fillLine',   items: ['fill', 'lineColor', 'lineWidth', 'lineType'], when: FILL},
        {name: 'image',      items: ['crop', 'cropShape', 'replace', 'actual'], when: ['image']},
        {name: 'line',       items: ['lineColor', 'lineWidth', 'lineType'], when: ['line']},
        {name: 'table',      items: ['tableFill', 'tableBorder', 'rowsCols'], when: ['table']},
        {name: 'chart',      items: ['editData', 'chartType'], when: ['chart']},
        {name: 'props',      items: ['objProps', 'animation'], when: OBJECT}
    ];

    /* Caption of the stock code — a locale string on the view prototype (or on the
       object itself, while the view is not yet declared). */
    function stock(path) {
        var parts = path.split('.'), key = parts.pop(), o = window;
        for (var i = 0; i < parts.length && o; i++) o = o[parts[i]];
        if (!o) return '';
        var v = o.prototype && typeof o.prototype[key] === 'string' ? o.prototype[key] : o[key];
        return typeof v === 'string' ? v : '';
    }

    function st(path) { return function () { return stock(path); }; }

    /* Own caption (default below, translation — from the locale). */
    function own(key) { return function () { return PE.Views.CompactToolbar[key]; }; }

    /* Controls. type: btn — a button; value — a value list with the current
       value in the field; drop — an expand button (gallery — the stock gallery of the
       counterpart, list — an own list, palette — an own color palette); pop — an own
       popup panel with rows. name — the caption of an icon button (the name for the
       screen reader) when the tooltip is longer than the caption. twin — the bridge address of the
       counterpart (availability comes from it), cmd/args — a shell command; pressed —
       the pressed state from the counterpart; toggle — a notification to the command owner about its
       state (true — pressed): the magnifier is pressed while the search bar is visible. */
    var ITEMS = {
        undo:        {icon: 'undo', tip: own('tipUndo'), twin: 'Toolbar:btnUndo', idle: 'textNothingToUndo'},
        redo:        {icon: 'redo', tip: own('tipRedo'), twin: 'Toolbar:btnRedo', idle: 'textNothingToRedo'},
        search:      {icon: 'search', tip: st('PE.Views.LeftMenu.tipSearch'), cmd: 'searchBar', toggle: 'vo:search-bar'},
        /* Comments panel: without the right to it (CompactLeft.can) there is no button —
           the stock code in that case hides its button instead of disabling it. */
        comment:     {icon: 'comment', tip: st('PE.Views.LeftMenu.tipComments'), twin: 'LeftMenu:btnComments', pressed: true, panel: 'comments'},
        zoom:        {type: 'value', cls: 'vo-w-zoom', tip: st('PE.Views.ViewTab.textZoom'), twin: 'ViewTab:cmbZoom', list: 'zoomList'},
        font:        {type: 'value', cls: 'vo-w-font', tip: st('PE.Views.Toolbar.tipFontName'), twin: 'Toolbar:cmbFontName', list: 'fontList', when: TEXT},
        size:        {type: 'value', cls: 'vo-w-size', tip: st('PE.Views.Toolbar.tipFontSize'), twin: 'Toolbar:cmbFontSize', list: 'sizeList', when: TEXT},
        /* B · I · U — as separate buttons; the highlight of an enabled font style —
           from the engine (style), as in "Text Styles ▾". */
        bold:        {icon: 'bold', tip: st('PE.Views.Toolbar.textBold'), twin: 'Toolbar:btnBold', style: 'bold', when: TEXT},
        italic:      {icon: 'italic', tip: st('PE.Views.Toolbar.textItalic'), twin: 'Toolbar:btnItalic', style: 'italic', when: TEXT},
        underline:   {icon: 'underline', tip: own('tipUnderline'), twin: 'Toolbar:btnUnderline', style: 'underline', when: TEXT},
        textPop:     {type: 'pop', icon: 'text', tip: own('tipTextStyles'), twin: 'Toolbar:btnStrikeout', rows: 'TEXT_ROWS', when: TEXT},
        align:       {type: 'pop', icon: 'alignL', tip: own('tipAlign'), twin: 'Toolbar:btnHorizontalAlign', rows: 'ALIGN_ROWS'},
        lists:       {type: 'pop', icon: 'bullet', tip: own('tipLists'), twin: 'Toolbar:btnMarkers', rows: 'LIST_ROWS'},
        /* "New Slide" — a click adds a slide at once (the stock button, Ctrl+M);
           the layout — by the "Layout ▾" button: the new slide is selected as a slide. */
        newSlide:    {icon: 'newSlide', label: own('textNewSlide'), tip: own('tipNewSlide'), twin: 'Toolbar:btnAddSlide'},
        /* "Text Box ▾" — items of the stock button menu: horizontal and vertical
           text box; the choice is a stock item, the button is pressed while drawing is on. */
        textbox:     {type: 'drop', icon: 'textAdd', tip: st('PE.Views.Toolbar.tipInsertText'), twin: 'Toolbar:btnsInsertText.0', list: 'menuList', pressed: true},
        image:       {type: 'drop', icon: 'image', tip: st('PE.Views.Toolbar.tipInsertImage'), twin: 'Toolbar:btnsInsertImage.0', gallery: true},
        /* Lines — the "Lines" group of the same stock gallery: they have no separate button. */
        shape:       {type: 'drop', icon: 'shape', tip: st('PE.Views.Toolbar.tipInsertShape'), twin: 'Toolbar:cmbsInsertShape.0', gallery: true},
        link:        {icon: 'link', tip: own('tipLink'), twin: 'Toolbar:btnInsertHyperlink', when: TEXT},
        bg:          {icon: 'background', label: own('textBackground'), tip: own('tipBackground'), cmd: 'slideSection', args: ['slide']},
        layout:      {type: 'drop', icon: 'layout', label: own('textLayout'), tip: st('PE.Views.Toolbar.tipChangeSlide'), twin: 'Toolbar:btnChangeSlide', gallery: true},
        theme:       {icon: 'theme', label: own('textTheme'), tip: st('PE.Views.DocumentHolder.txtChangeTheme'), cmd: 'slideSection', args: ['theme']},
        transition:  {icon: 'transition', label: own('textTransition'), tip: own('textTransition'), cmd: 'slideSection', args: ['transition']},
        fill:        {type: 'drop', icon: 'fill', tip: own('tipFillColor'), twin: 'RightMenu:shapeSettings.btnBackColor', palette: 'fill'},
        lineColor:   {type: 'drop', icon: 'pencil', tip: own('tipLineColor'), twin: 'RightMenu:shapeSettings.btnBorderColor', palette: 'line'},
        lineWidth:   {type: 'drop', icon: 'borderWeight', tip: own('tipLineWidth'), twin: 'RightMenu:shapeSettings.cmbBorderSize', list: 'storeList'},
        lineType:    {type: 'drop', icon: 'borderDash', tip: own('tipLineType'), twin: 'RightMenu:shapeSettings.cmbBorderType', list: 'storeList'},
        crop:        {icon: 'cut', tip: st('PE.Views.ImageSettings.textCrop'), twin: 'RightMenu:imageSettings.btnCrop', pressed: true},
        cropShape:   {type: 'drop', icon: 'shape', tip: st('PE.Views.ImageSettings.textCropToShape'), twin: 'RightMenu:imageSettings.btnCrop.menu.items.1', gallery: true},
        replace:     {type: 'drop', icon: 'replaceImg', tip: st('PE.Views.ImageSettings.textInsert'), twin: 'RightMenu:imageSettings.btnSelectImage', gallery: true},
        actual:      {icon: 'resetImg', tip: st('PE.Views.ImageSettings.textOriginalSize'), twin: 'RightMenu:imageSettings.btnOriginalSize'},
        tableFill:   {type: 'drop', icon: 'fill', tip: own('tipFillColor'), twin: 'RightMenu:tableSettings.btnBackColor', palette: 'tableFill'},
        tableBorder: {type: 'drop', icon: 'pencil', tip: own('tipBorderColor'), twin: 'RightMenu:tableSettings.btnBorderColor', palette: 'tableBorder'},
        rowsCols:    {type: 'drop', icon: 'table', tip: st('PE.Views.TableSettings.textEdit'), twin: 'RightMenu:tableSettings.btnEdit', gallery: true},
        editData:    {icon: 'table', tip: st('Common.Views.ChartTab.tipEditData'), twin: 'ChartTab:btnEditData'},
        chartType:   {type: 'drop', icon: 'chart', tip: st('Common.Views.ChartTab.tipChartType'), twin: 'ChartTab:btnChartType', gallery: true},
        objProps:    {icon: 'settings', tip: own('tipObjectProps'), cmd: 'objectProperties'},
        /* "Animation" of the selected object — the "Animation" section of the popup panel under
           the button, like "Insert → Animation"; after "Object Properties" — it goes into "⋯"
           earlier than that. */
        animation:   {icon: 'autoCorrect', tip: st('PE.Views.Toolbar.textTabAnimation'), cmd: 'slideSection', args: ['animation']},
        painter:     {icon: 'paint', name: own('textPaintFormat'), tip: own('tipPaintFormat'), twin: 'Toolbar:btnCopyStyle', pressed: true, dblclick: true, when: PAINT},
        focus:       {icon: 'chevron', tip: own('tipFocus'), cmd: 'focus', cls: 'vo-focus-btn'},
        more:        {icon: 'more', tip: own('tipMore'), cls: 'vo-more'}
    };

    /* "Text Styles ▾": strikethrough and indices in the first row, color, case and
       clear — in the second; B · I · U are on the panel itself. The pressed state
       of the font styles — from the engine (style). The text and highlight color are nested
       palettes, the case is a nested list of stock menu items. */
    var TEXT_ROWS = [
        [{key: 'strike', icon: 'strike', tip: st('PE.Views.Toolbar.textStrikeout'), twin: 'Toolbar:btnStrikeout', style: 'strike'},
         {key: 'sup', icon: 'sup', tip: own('tipSuperscript'), twin: 'Toolbar:btnSuperscript', style: 'sup'},
         {key: 'sub', icon: 'sub', tip: own('tipSubscript'), twin: 'Toolbar:btnSubscript', style: 'sub'}],
        [{key: 'textColor', icon: 'color', tip: own('tipTextColor'), twin: 'Toolbar:btnFontColor', palette: 'text'},
         {key: 'highlight', icon: 'highlight', tip: st('PE.Views.Toolbar.tipHighlightColor'), twin: 'Toolbar:btnHighlightColor', palette: 'highlight'},
         {key: 'case', icon: 'case', tip: own('tipCase'), twin: 'Toolbar:btnChangeCase', list: 'menuList'},
         {key: 'clearFmt', icon: 'clear', tip: own('tipClearFormat'), twin: 'Toolbar:btnClearStyle'}]
    ];

    /* "Alignment and Spacing ▾": horizontal, vertical, line
       spacing — items of the stock menus; the mark — theirs too (check). */
    var ALIGN_ROWS = [
        [{key: 'alignLeft', icon: 'alignL', tip: st('PE.Views.Toolbar.textAlignLeft'), twin: 'Toolbar:btnHorizontalAlign.menu.items.0', check: true},
         {key: 'alignCenter', icon: 'alignC', tip: st('PE.Views.Toolbar.textAlignCenter'), twin: 'Toolbar:btnHorizontalAlign.menu.items.1', check: true},
         {key: 'alignRight', icon: 'alignR', tip: st('PE.Views.Toolbar.textAlignRight'), twin: 'Toolbar:btnHorizontalAlign.menu.items.2', check: true},
         {key: 'alignJustify', icon: 'alignJ', tip: st('PE.Views.Toolbar.textAlignJust'), twin: 'Toolbar:btnHorizontalAlign.menu.items.3', check: true}],
        [{key: 'valignTop', icon: 'valignT', tip: st('PE.Views.Toolbar.textAlignTop'), twin: 'Toolbar:btnVerticalAlign.menu.items.0', check: true},
         {key: 'valignMiddle', icon: 'alignC', tip: st('PE.Views.Toolbar.textAlignMiddle'), twin: 'Toolbar:btnVerticalAlign.menu.items.1', check: true},
         {key: 'valignBottom', icon: 'caption', tip: st('PE.Views.Toolbar.textAlignBottom'), twin: 'Toolbar:btnVerticalAlign.menu.items.2', check: true}],
        [{key: 'spacing10', number: 1, tip: st('PE.Views.Toolbar.tipLineSpace'), twin: 'Toolbar:btnLineSpace.menu.items.0', check: true},
         {key: 'spacing115', number: 1.15, tip: st('PE.Views.Toolbar.tipLineSpace'), twin: 'Toolbar:btnLineSpace.menu.items.1', check: true},
         {key: 'spacing15', number: 1.5, tip: st('PE.Views.Toolbar.tipLineSpace'), twin: 'Toolbar:btnLineSpace.menu.items.2', check: true},
         {key: 'spacing20', number: 2, tip: st('PE.Views.Toolbar.tipLineSpace'), twin: 'Toolbar:btnLineSpace.menu.items.3', check: true}]
    ];

    /* "Lists and Indents ▾". */
    var LIST_ROWS = [
        [{key: 'bullets', icon: 'bullet', tip: st('PE.Views.Toolbar.tipMarkers'), twin: 'Toolbar:btnMarkers'},
         {key: 'numbering', icon: 'numbered', tip: st('PE.Views.Toolbar.tipNumbers'), twin: 'Toolbar:btnNumbers'},
         {sep: true},
         {key: 'indentOut', icon: 'indentOut', tip: st('PE.Views.Toolbar.tipDecPrLeft'), twin: 'Toolbar:btnDecLeftOffset'},
         {key: 'indentIn', icon: 'indentIn', tip: st('PE.Views.Toolbar.tipIncPrLeft'), twin: 'Toolbar:btnIncLeftOffset'}]
    ];

    var ROWS = {TEXT_ROWS: TEXT_ROWS, ALIGN_ROWS: ALIGN_ROWS, LIST_ROWS: LIST_ROWS};

    /* Engine font-style callbacks → B · I · U on the panel and "Text Styles ▾". */
    var STYLE_EVENTS = {asc_onBold: 'bold', asc_onItalic: 'italic', asc_onUnderline: 'underline', asc_onStrikeout: 'strike'};

    /* An icon from the shell set; if it fails — a control without an icon, not a row failure. */
    function icon(name, size) {
        var C = window.Common && Common.UI && Common.UI.Compact, I = C && C.Icons;
        try { return I && typeof I.svg === 'function' ? I.svg(name, size) || '' : ''; } catch (e) { return ''; }
    }

    function bridge() { return PE.Views.StockBridge; }

    function el(tag, cls, attrs) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        Object.keys(attrs || {}).forEach(function (k) {
            if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
        });
        return n;
    }

    function text(fn) {
        var v = typeof fn === 'function' ? fn() : fn;
        return v == null ? '' : String(v);
    }

    function show(n, on) {
        if (on) n.removeAttribute('hidden'); else n.setAttribute('hidden', '');
    }

    function visibleFor(when, kind) {
        return !when || when.indexOf(kind) >= 0;
    }

    /* Right to the left area panel (the control's panel): the CompactLeft.can condition. */
    function panelAllowed(item) {
        if (!item.panel) return true;
        var left = PE.Views.CompactLeft;
        return !!left && typeof left.can === 'function' && left.can(item.panel);
    }

    /* The control is visible: the selection kind fits and there is a right to its panel. */
    function itemShown(item, kind) {
        return visibleFor(item.when, kind) && panelAllowed(item);
    }

    function each(list, fn) {
        Array.prototype.forEach.call(list || [], fn);
    }

    /* Alignment icons by the engine value (asc_onPrAlign): the engine has 0 —
       right-aligned, 1 — left-aligned, 2 — centered, 3 — justified
       (AscCommon.align_*). */
    function alignIcon(v) {
        var A = window.AscCommon || {};
        var map = {};
        map[A.align_Right !== undefined ? A.align_Right : 0] = 'alignR';
        map[A.align_Left !== undefined ? A.align_Left : 1] = 'alignL';
        map[A.align_Center !== undefined ? A.align_Center : 2] = 'alignC';
        map[A.align_Justify !== undefined ? A.align_Justify : 3] = 'alignJ';
        return map[v] || 'alignL';
    }

    /* A color in six lowercase digits without a hash; anything else — null. */
    function normHex(v) {
        var m = String(v == null ? '' : v).trim().replace(/^#/, '');
        return /^[0-9a-fA-F]{6}$/.test(m) ? m.toLowerCase() : null;
    }

    /* Tick color on a swatch — by the relative luminance of sRGB (WCAG 2.1):
       dark on a light swatch, light on a dark one. */
    function paletteInk(hex) {
        var n = parseInt(hex, 16);
        var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] > 0.5 ? '#1a1a1a' : '#ffffff';
    }

    /* Spacing number with the decimal separator of the interface language: "1,15". */
    function spacing(v) {
        var lang = 'en';
        try { lang = (Common.Locale && Common.Locale.getCurrentLanguage && Common.Locale.getCurrentLanguage()) || 'en'; } catch (e) { lang = 'en'; }
        var s;
        try { s = Number(v).toLocaleString(lang, {minimumFractionDigits: 1, maximumFractionDigits: 2}); } catch (e) { s = ''; }
        return s || Number(v).toFixed(v * 10 % 1 ? 2 : 1);
    }

    PE.Views.CompactToolbar = _.extend({

        GROUPS: GROUPS,
        ITEMS: ITEMS,
        PALETTES: PALETTES,

        shell: null,
        el: null,
        controls: null,   // [{el, item}] — all controls with a counterpart or a command
        watched: null,    // counterpart address → {twin, off}
        pops: null,       // wrappers of the own popup panels (and nested ones)
        shown: null,      // visibility of groups and controls by selection kind, from which the row was built
        frame: null,      // row measurement deferred to a frame

        install: function (shell) {
            var me = this, nc = Common.NotificationCenter;
            this.shell = shell;
            var g = function (label, fn) { return me.guard(label, fn); };
            nc.on('vo:selection', g('vo:selection', function (e) { me.refresh(e && e.kind); }));
            nc.on('shell:toolbar', g('shell:toolbar', function () { me.refresh(null, true); }));
            nc.on('uitheme:changed', g('uitheme:changed', function () { me.relayout(); }));
            nc.on('editing:disable', g('editing:disable', function () { me.applyLock(); }));
            _.each(ITEMS, function (item, key) {
                if (item.toggle) nc.on(item.toggle, g(item.toggle, function (on) { me.setStyle(key, !!on); }));
            });
            if (typeof shell.onApi === 'function') {
                shell.onApi('asc_onFontFamily', function (font) { me.setFont(font); });
                shell.onApi('asc_onFontSize', function (size) { me.setValue('size', size); });
                shell.onApi('asc_onZoomChange', function (percent) { me.setValue('zoom', percent, '%'); });
                shell.onApi('asc_onPrAlign', function (v) { me.setAlign(v); });
                shell.onApi('asc_onVerticalAlign', function (v) { me.setBaseline(v); });
                Object.keys(STYLE_EVENTS).forEach(function (ev) {
                    shell.onApi(ev, function (on) { me.setStyle(STYLE_EVENTS[ev], !!on); });
                });
            }
            var host = typeof shell.rowEl === 'function' ? shell.rowEl('toolbar') : null;
            if (host && host.nodeType === 1) this.render(host);
        },

        guard: function (label, fn) {
            var shell = this.shell;
            return shell && typeof shell.guarded === 'function' ? shell.guarded('toolbar: ' + label, fn) : fn;
        },

        /* --- Markup ------------------------------------------------------------- */

        render: function (host) {
            var root = host && host.nodeType === 1 ? host : (host && host[0]);
            if (!root || root.nodeType !== 1) return null;
            if (this.el && this.el.parentNode === root) return this.el;
            var me = this;
            this.controls = [];
            this.watched = {};
            this.pops = [];

            var bar = el('div', null, {id: BAR_ID, role: 'toolbar'});
            var seq = 0;
            GROUPS.forEach(function (grp) {
                var g = el('div', 'vo-g', {'data-group': grp.name});
                grp.items.forEach(function (key) {
                    var n = me.control(key);
                    n.voIndex = seq++;
                    g.appendChild(n);
                });
                bar.appendChild(g);
            });

            /* "⋯": the button and its panel in one wrapper — the wrapper is the row
               element, it is hidden and measured by the measurement. */
            var more = el('span', 'vo-more-wrap', {id: MORE_ID, hidden: ''});
            var moreBtn = this.button('more', ITEMS.more);
            moreBtn.setAttribute('aria-haspopup', 'true');
            moreBtn.setAttribute('aria-expanded', 'false');
            moreBtn.addEventListener('click', this.guard('more', function (e) {
                e.stopPropagation();
                me.toggleMore();
            }));
            this.morePop = el('div', 'vo-pop vo-of-pop', {hidden: ''});
            this.morePop.addEventListener('click', function (e) { e.stopPropagation(); });
            more.appendChild(moreBtn);
            more.appendChild(this.morePop);
            bar.appendChild(more);
            this.moreWrap = more;
            this.moreBtn = moreBtn;

            var end = el('div', 'vo-tb-end', {id: END_ID});
            end.appendChild(this.control('focus'));
            bar.appendChild(end);

            /* A click that reached the locked card past its layer (Enter on a
               focused button, a programmatic click) goes no further. */
            var stopLocked = function (e) {
                if (!me.locked || !e) return;
                if (typeof e.preventDefault === 'function') e.preventDefault();
                if (typeof e.stopPropagation === 'function') e.stopPropagation();
            };
            bar.addEventListener('click', stopLocked, true);
            bar.addEventListener('dblclick', stopLocked, true);

            root.appendChild(bar);
            this.el = bar;

            if (!this.onDocClick) {
                this.onDocClick = this.guard('outside click', function (e) { me.outside(e); });
                document.addEventListener('click', this.onDocClick);
            }
            this.observe(bar, end);
            this.readInitial();
            this.shown = null;
            this.refresh(null, true);
            this.locked = false;
            this.applyLock();
            /* Command owners are the zones installed after the panel: their
               availability is visible from the next tick. */
            setTimeout(this.guard('first refresh', function () { me.refresh(null, true); }), 0);
            return bar;
        },

        control: function (key) {
            var item = ITEMS[key];
            if (item.type === 'value') return this.valueControl(key, item);
            if (item.type === 'drop' || item.type === 'pop') return this.dropControl(key, item);
            return this.button(key, item);
        },

        /* Button: an icon or a caption. The caption is visible text, the tooltip is
           title and the name for the screen reader; for an icon button with its own caption
           (name) the name is the caption, the tooltip is only title. */
        button: function (key, item, cls) {
            var me = this, tip = text(item.tip), label = text(item.label), name = text(item.name);
            var b = el('button', 'vo-ib' + (label ? ' vo-tx' : '') + (item.cls ? ' ' + item.cls : '') + (cls ? ' ' + cls : ''),
                {type: 'button', 'data-vo': key, title: tip || name || label, 'aria-label': name || tip || label});
            if (item.icon) b.insertAdjacentHTML('beforeend', icon(item.icon));
            if (label) b.appendChild(el('span', 'vo-tx-label')).textContent = label;
            if (item.pressed || item.style || item.toggle) b.setAttribute('aria-pressed', 'false');
            /* Right-panel section button: a press on it is not "outside" an open
               popup panel, but a repeat or a switch of the section. */
            if (PANEL_CMDS.indexOf(item.cmd) >= 0) b.setAttribute('data-vo-panel', item.cmd);
            if (item.twin || item.cmd) this.controls.push({el: b, item: item});
            if (item.type !== 'drop' && item.type !== 'pop' && (item.twin || item.cmd)) {
                b.addEventListener('click', this.guard('click ' + key, function (e) { me.act(item, b, e); }));
                if (item.dblclick) {
                    b.addEventListener('dblclick', this.guard('dblclick ' + key, function () { me.twinDblClick(item.twin); }));
                }
            }
            return b;
        },

        /* Expand button: a glyph (or a caption) and a chevron. */
        dropControl: function (key, item) {
            var me = this, tip = text(item.tip), label = text(item.label);
            var wrap = el('span', 'vo-pop-wrap', {'data-vo-wrap': key});
            var b = el('button', 'vo-ib vo-drop' + (label ? ' vo-tx' : ''),
                {type: 'button', 'data-vo': key, title: tip || label, 'aria-label': tip || label, 'aria-haspopup': 'true', 'aria-expanded': 'false'});
            var glyph = el('span', 'vo-drop-i');
            if (item.icon) glyph.innerHTML = icon(item.icon);
            b.appendChild(glyph);
            if (label) b.appendChild(el('span', 'vo-tx-label')).textContent = label;
            b.appendChild(el('span', 'vo-drop-c')).innerHTML = icon('chevron', 16);
            wrap.appendChild(b);
            if (item.twin || item.cmd) this.controls.push({el: b, item: item});

            if (item.gallery) {
                b.addEventListener('click', this.guard('gallery ' + key, function (e) {
                    e.stopPropagation();
                    me.openGallery(item, b);
                }));
                return wrap;
            }
            this.attachPop(wrap, b, key, item);
            return wrap;
        },

        /* Own popup panel at a button: rows of icons, a list or a palette.
           Filled on opening — the list and marks are read from the counterpart and
           the engine at the moment of showing. */
        attachPop: function (wrap, b, key, item) {
            var me = this;
            var kind = item.rows ? ' vo-pop-rows' : item.palette ? ' vo-pop-palette' : ' vo-pop-list';
            var pop = el('div', 'vo-pop' + kind, {hidden: '', 'data-vo-pop': key});
            if (item.rows) this.buildRows(pop, ROWS[item.rows]);
            else if (item.list) { pop.setAttribute('role', 'menu'); this.ownWheel(pop); }
            wrap.appendChild(pop);
            this.pops.push(wrap);
            b.addEventListener('click', this.guard('open ' + key, function () {
                var open = pop.hasAttribute('hidden');
                if (open) me.fillPop(pop, item);
                me.setOpen(wrap, open);
            }));
            pop.addEventListener('click', function (e) { e.stopPropagation(); });
            return pop;
        },

        fillPop: function (pop, item) {
            if (item.list) this.fillList(pop, item);
            else if (item.palette) this.fillPalette(pop, item);
            else if (item.rows) this.syncChecks(pop);
        },

        /* A field with a value list: zoom, font, font size. */
        valueControl: function (key, item) {
            var me = this, tip = text(item.tip);
            var wrap = el('span', 'vo-pop-wrap vo-value ' + item.cls, {'data-vo-wrap': key});
            var b = el('button', 'vo-ib vo-value-btn',
                {type: 'button', 'data-vo': key, title: tip, 'aria-label': tip, 'aria-haspopup': 'menu', 'aria-expanded': 'false'});
            b.appendChild(el('span', 'vo-value-label'));
            b.appendChild(el('span', 'vo-value-caret')).innerHTML = icon('chevron', 16);
            var pop = el('div', 'vo-pop vo-pop-list', {role: 'menu', 'aria-label': tip, hidden: ''});
            this.ownWheel(pop);
            wrap.appendChild(b);
            wrap.appendChild(pop);
            this.pops.push(wrap);
            this.controls.push({el: b, item: item});
            b.addEventListener('click', this.guard('open ' + key, function () {
                var open = pop.hasAttribute('hidden');
                if (open) me.fillList(pop, item);
                me.setOpen(wrap, open);
            }));
            pop.addEventListener('click', function (e) { e.stopPropagation(); });
            return wrap;
        },

        /* Icon rows of an own popup panel. The panel does not close on
           a click inside: styles toggle without closing it; only
           a nested palette or list closes. */
        buildRows: function (pop, rows) {
            var me = this;
            rows.forEach(function (row) {
                var r = el('div', 'vo-pop-row');
                row.forEach(function (it) {
                    if (it.sep) { r.appendChild(el('span', 'vo-pop-sep')); return; }
                    if (it.palette || it.list) { r.appendChild(me.nested(it)); return; }
                    var tip = text(it.tip);
                    var b = el('button', 'vo-ib' + (it.number ? ' vo-num' : ''), {type: 'button', 'data-vo': it.key, title: tip, 'aria-label': it.number ? spacing(it.number) : tip});
                    if (it.number) b.textContent = spacing(it.number);
                    else b.innerHTML = icon(it.icon);
                    if (it.style || it.check) b.setAttribute('aria-pressed', 'false');
                    me.controls.push({el: b, item: it});
                    b.addEventListener('click', me.guard('click ' + it.key, function () {
                        me.closeNested(pop);
                        me.run(it.twin);
                        if (it.check) me.syncChecks(pop);
                    }));
                    r.appendChild(b);
                });
                pop.appendChild(r);
            });
        },

        /* A button with a nested panel inside a row panel: a color palette or
           a list of stock menu items. */
        nested: function (it) {
            var tip = text(it.tip);
            var wrap = el('span', 'vo-pop-wrap vo-nested', {'data-vo-wrap': it.key});
            var b = el('button', 'vo-ib', {type: 'button', 'data-vo': it.key, title: tip, 'aria-label': tip, 'aria-haspopup': 'true', 'aria-expanded': 'false'});
            b.innerHTML = icon(it.icon);
            wrap.appendChild(b);
            this.controls.push({el: b, item: it});
            this.attachPop(wrap, b, it.key, it);
            return wrap;
        },

        /* Marks of stock menu items (alignment, spacing) — from the counterpart. */
        syncChecks: function (pop) {
            var b = bridge();
            if (!b || !pop) return;
            (this.controls || []).forEach(function (c) {
                if (!c.item.check || !pop.contains(c.el)) return;
                var on = !!(b.state(c.item.twin) || {}).pressed;
                c.el.classList.toggle('on', on);
                c.el.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        },

        /* The wheel over a list scrolls the list: the event does not go further, to #viewport, where
           the engine suppresses it. */
        ownWheel: function (pop) {
            ['wheel', 'mousewheel', 'DOMMouseScroll'].forEach(function (name) {
                pop.addEventListener(name, function (e) { e.stopPropagation(); }, {passive: true});
            });
        },

        /* --- Value lists ------------------------------------------------------ */

        /* "Fit to Slide" — the stock button of the "View" tab; zoom levels — the field
           of the stock combo: the 'changed:after' event, like typing a value into the field,
           so even 90 %, which is not in the combo list, gets through. */
        zoomList: function () {
            var fit = {label: text(st('PE.Views.ViewTab.textFitToSlide')), ref: 'ViewTab:btnFitToSlide', fit: true};
            var b = bridge();
            fit.on = !!(b && (b.state(fit.ref) || {}).pressed);
            return [fit, {sep: true}].concat(ZOOMS.map(function (z) {
                return {label: z + '%', rec: {value: z + '%', displayValue: z + '%'}, event: 'changed:after'};
            }));
        },

        sizeList: function () {
            return FONT_SIZES.map(function (n) {
                return {label: String(n), rec: {value: n, displayValue: String(n)}};
            });
        },

        /* Fonts and the field lists of "Shapes" — records of the stock combo store:
           the same composition as in its dropdown list. */
        storeList: function (item) {
            var b = bridge(), o = b && b.twin(item.twin);
            var store = o && o.store;
            if (!store || typeof store.map !== 'function') return [];
            return store.map(function (m) {
                var rec = typeof m.toJSON === 'function' ? m.toJSON() : (m.attributes || m);
                var label = rec.displayValue || rec.name || rec.caption || '';
                return {label: String(label), rec: rec, img: rec.imgId};
            });
        },

        fontList: function (item) {
            return this.storeList(item);
        },

        /* Items of the counterpart's stock menu (case): the bridge snapshot, the choice — pick. */
        menuList: function (item) {
            var b = bridge();
            var rows = b && typeof b.mirror === 'function' ? b.mirror(item.twin) || [] : [];
            return rows.filter(function (r) { return r && !r.sub && !r.gallery; }).map(function (r) {
                return r.sep ? {sep: true} : {label: String(r.caption || ''), pick: r.id, on: !!r.checked, disabled: !!r.disabled};
            });
        },

        fillList: function (pop, item) {
            var me = this;
            while (pop.firstChild) pop.removeChild(pop.firstChild);
            var list = this[item.list](item) || [];
            var current = item.type === 'value' ? this.valueText(item) : '';
            list.forEach(function (opt) {
                if (opt.sep) { pop.appendChild(el('div', 'vo-pop-hr', {role: 'separator'})); return; }
                var on = opt.on !== undefined ? opt.on : (!!current && opt.label === current);
                var b = el('button', 'vo-pop-item' + (on ? ' on' : ''),
                    {type: 'button', role: 'menuitemradio', 'aria-checked': on ? 'true' : 'false', 'aria-label': opt.label || null});
                if (opt.disabled) b.disabled = true;
                if (opt.img) b.innerHTML = '<svg class="vo-pop-img"><use xlink:href="#' + String(opt.img).replace(/[^\w-]/g, '') + '"></use></svg>';
                else b.textContent = opt.label;
                b.addEventListener('click', me.guard('pick ' + item.twin, function () {
                    me.setOpen(pop.parentNode, false);
                    me.pickOption(item, opt);
                    me.done(pop);
                }));
                pop.appendChild(b);
            });
        },

        pickOption: function (item, opt) {
            var b = bridge();
            if (opt.fit) {
                if (b && !(b.state(opt.ref) || {}).pressed) this.run(opt.ref);
                return;
            }
            if (opt.pick !== undefined) {
                if (b && typeof b.pick === 'function') b.pick(item.twin, opt.pick);
                return;
            }
            this.run(item.twin, {event: opt.event || 'selected', args: [opt.rec]});
        },

        valueText: function (item) {
            var key = _.findKey(ITEMS, function (x) { return x === item; });
            var n = key && this.el && this.el.querySelector('[data-vo="' + key + '"] .vo-value-label');
            return n ? n.textContent : '';
        },

        /* --- Palettes ---------------------------------------------------------------- */
        /* Palette of Compact documents: the reset row, the swatch grid and the field
           of the custom color. The choice goes to the stock color field (applyColor), the mark —
           the color that the stock field shows. */

        fillPalette: function (pop, item) {
            var me = this, cfg = PALETTES[item.palette];
            if (!cfg) return;
            while (pop.firstChild) pop.removeChild(pop.firstChild);
            var current = this.twinColor(item);

            var reset = el('button', 'vo-pal-reset', {type: 'button', 'data-vo-reset': cfg.reset});
            reset.textContent = this.resetLabel(cfg.reset);
            reset.addEventListener('click', this.guard('reset ' + item.palette, function () {
                me.setOpen(pop.parentNode, false);
                me.resetColor(item);
                me.done(pop);
            }));
            pop.appendChild(reset);
            pop.appendChild(el('div', 'vo-pal-sep'));

            var grid = el('div', 'vo-pal-grid', {role: 'group', 'aria-label': text(item.tip)});
            grid.style.setProperty('--vo-pal-cols', String(cfg.cols));
            cfg.colors.forEach(function (raw) {
                var hex = String(raw).toLowerCase();
                var on = hex === current;
                var s = el('button', 'vo-pal-item' + (on ? ' on' : ''),
                    {type: 'button', 'data-color': hex, 'aria-label': '#' + hex.toUpperCase(), 'aria-pressed': on ? 'true' : 'false'});
                s.style.background = '#' + hex;
                var check = el('span', 'vo-pal-check');
                check.style.color = paletteInk(hex);
                check.innerHTML = icon('checkMenu', 14);
                s.appendChild(check);
                s.addEventListener('click', me.guard('color ' + item.palette, function () {
                    me.setOpen(pop.parentNode, false);
                    me.applyColor(item, cfg.colors === HIGHLIGHT ? String(raw) : hex);
                    me.done(pop);
                }));
                grid.appendChild(s);
            });
            pop.appendChild(grid);
            if (cfg.custom) this.customField(pop, item, current);
        },

        /* "Custom Color": a color code field with a swatch. While the field has focus, the engine does not
           take the keys for itself (asc_enableKeyEvents), otherwise typing would go to
           the slide; when focus leaves — the return. Turning off — only together with
           the field focus: pressing a button without a click (released outside) leaves the keyboard
           to the engine. */
        customField: function (pop, item, current) {
            var me = this;
            var toggle = el('button', 'vo-pal-toggle', {type: 'button', 'data-vo-custom': '1'});
            toggle.textContent = this.textCustomColor;
            var field = el('div', 'vo-pal-custom', {hidden: ''});
            var input = el('input', 'vo-pal-input', {type: 'text', maxlength: '7', spellcheck: 'false', placeholder: '#', 'aria-label': this.textColorCode_ARIA});
            var preview = el('span', 'vo-pal-preview', {'aria-hidden': 'true'});
            input.value = current ? '#' + current.toUpperCase() : '';
            preview.style.background = current ? '#' + current : 'transparent';
            field.appendChild(input);
            field.appendChild(preview);
            var commit = function () {
                var hex = normHex(input.value);
                if (!hex) { input.value = current ? '#' + current.toUpperCase() : ''; return; }
                me.setOpen(pop.parentNode, false);
                me.applyColor(item, hex);
                me.done(pop);
            };
            input.addEventListener('input', function () {
                var hex = normHex(input.value);
                if (hex) preview.style.background = '#' + hex;
            });
            input.addEventListener('keydown', this.guard('custom color key', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { e.stopPropagation(); me.setOpen(pop.parentNode, false); }
            }));
            input.addEventListener('mousedown', function () { me.keys(false); });
            input.addEventListener('focus', function () { me.keys(false); });
            input.addEventListener('blur', function () { me.keys(true); });
            toggle.addEventListener('click', this.guard('custom color', function () {
                show(toggle, false);
                show(field, true);
                /* Before focus: otherwise the engine will synchronously return focus to its field. */
                me.keys(false);
                if (typeof input.focus === 'function') input.focus();
                if (typeof input.select === 'function') input.select();
                if (document.activeElement !== input) me.keys(true);
            }));
            pop.appendChild(toggle);
            pop.appendChild(field);
        },

        keys: function (on) {
            var shell = this.shell, api = shell && (typeof shell.engineApi === 'function' ? shell.engineApi() : shell.api);
            if (api && typeof api.asc_enableKeyEvents === 'function') api.asc_enableKeyEvents(on);
        },

        /* Reset captions are stock where a stock one exists: "Automatic",
           "No Fill", "No Borders"; "No Line" — our own. */
        resetLabel: function (kind) {
            if (kind === 'auto') return stock('Common.UI.ButtonColored.textAutoColor');
            if (kind === 'noFill') return stock('PE.Views.ShapeSettings.textNoFill');
            if (kind === 'noBorders') return stock('PE.Views.TableSettings.txtNoBorders');
            return this.textNoLine;
        },

        /* The color that the stock field shows: ColorButton keeps it in color
           (a hex string or {color, effectId} of a theme color). */
        twinColor: function (item) {
            var b = bridge(), o = b && b.twin(item.twin);
            var c = o && o.color;
            return normHex(c && typeof c === 'object' ? c.color : c);
        },

        /* Color choice — by the stock color field event, like a click on its palette. */
        applyColor: function (item, hex) {
            var t = item.palette;
            if (t === 'text') return this.run('Toolbar:btnFontColor', {event: 'color:select', args: [hex]});
            if (t === 'highlight') return this.run('Toolbar:mnuHighlightColorPicker', {event: 'select', args: [hex]});
            if (t === 'fill') return this.run('RightMenu:shapeSettings.btnBackColor', {event: 'color:select', args: [hex]});
            if (t === 'tableFill') return this.run('RightMenu:tableSettings.btnBackColor', {event: 'color:select', args: [hex]});
            if (t === 'line') {
                /* The stock field paints only a visible line: for a shape without a line
                   the color is remembered, and the line is drawn by choosing a thickness — 1 pt. */
                var ok = this.run('RightMenu:shapeSettings.btnBorderColor', {event: 'color:select', args: [hex]});
                if (ok && this.storeValue('RightMenu:shapeSettings.cmbBorderSize') === 0) this.pickStore('RightMenu:shapeSettings.cmbBorderSize', 1);
                return ok;
            }
            if (t === 'tableBorder') {
                /* The border color of the stock "Table" tab — the color for the next
                   border; the tab applies it with the "All Borders" button. */
                return this.run('RightMenu:tableSettings.borderColor', {event: 'select', args: [hex]}) &&
                       this.run('RightMenu:tableSettings._btnsBorderPosition.8');
            }
            return false;
        },

        resetColor: function (item) {
            var t = item.palette;
            if (t === 'text') return this.run('Toolbar:btnFontColor', {event: 'color:select', args: [this.autoTextColor()]});
            if (t === 'highlight') return this.run('Toolbar:mnuHighlightTransparent');
            if (t === 'fill') return this.run('RightMenu:shapeSettings.btnBackColor', {event: 'color:select', args: ['transparent']});
            if (t === 'tableFill') return this.run('RightMenu:tableSettings.btnBackColor', {event: 'color:select', args: ['transparent']});
            if (t === 'line') return this.pickStore('RightMenu:shapeSettings.cmbBorderSize', 0);
            if (t === 'tableBorder') return this.run('RightMenu:tableSettings._btnsBorderPosition.9');
            return false;
        },

        /* The "Automatic" presentation text color — "Text 1" of the theme: the first
           column of the theme colors of the stock palette (ThemeValues 15). */
        autoTextColor: function () {
            var T = window.Common && Common.Utils && Common.Utils.ThemeColor, list;
            try { list = T && typeof T.getEffectColors === 'function' ? T.getEffectColors() : null; } catch (e) { list = null; }
            var tx1 = _.find(list || [], function (c) { return c && c.effectValue === 15; });
            return tx1 ? {color: tx1.color, effectId: tx1.effectId, effectValue: tx1.effectValue} : '000000';
        },

        /* Value of a stock combo with a list (line thickness). */
        storeValue: function (ref) {
            var b = bridge(), o = b && b.twin(ref), v;
            try { v = o && typeof o.getValue === 'function' ? o.getValue() : undefined; } catch (e) { v = undefined; }
            return v === undefined || v === null || v === '' ? v : Number(v);
        },

        /* Choosing a stock combo store record by value — by its 'selected' event. */
        pickStore: function (ref, value) {
            var b = bridge(), o = b && b.twin(ref), store = o && o.store, rec = null;
            if (store && typeof store.find === 'function') {
                var m = store.find(function (x) { return Number(x.get ? x.get('value') : x.value) === value; });
                if (m) rec = typeof m.toJSON === 'function' ? m.toJSON() : m;
            }
            return this.run(ref, {event: 'selected', args: [rec || {value: value}]});
        },

        /* --- Popup panels ----------------------------------------------------- */

        setOpen: function (wrap, open) {
            if (!wrap) return;
            if (open) this.closePopovers(wrap);
            var pop = wrap.querySelector('.vo-pop'), btn = wrap.querySelector('button');
            if (pop) show(pop, open);
            if (pop && open) this.keepInWindow(pop);
            wrap.classList.toggle('open', !!open);
            if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (!open) this.closeNested(pop);
        },

        /* Close the open panels except except and those that contain it
           (a nested palette opens inside "Text ▾"). */
        closePopovers: function (except) {
            var me = this;
            var keep = except && except.nodeType === 1 ? except : null;
            (this.pops || []).forEach(function (w) {
                if (w === keep || (keep && w.contains(keep))) return;
                if (w.classList.contains('open')) me.setOpen(w, false);
            });
            if (!(keep && this.moreWrap && this.moreWrap.contains(keep))) this.closeMore();
        },

        closeNested: function (pop) {
            var me = this;
            if (!pop) return;
            (this.pops || []).forEach(function (w) {
                if (w.parentNode && pop.contains(w) && w.classList.contains('open')) me.setOpen(w, false);
            });
        },

        /* A click outside a panel closes it; a click inside a shown stock
           gallery is its own business. */
        outside: function (e) {
            var me = this, t = e && e.target, b = bridge();
            if (b && typeof b.galleryOwns === 'function' && b.galleryOwns(t)) return;
            (this.pops || []).forEach(function (w) {
                if (w.classList.contains('open') && !w.contains(t)) me.setOpen(w, false);
            });
            if (this.moreWrap && !this.moreWrap.contains(t)) this.closeMore();
        },

        /* The counterpart's stock gallery at its button; a repeated click on the button
           of an open gallery closes it. */
        openGallery: function (item, btn) {
            var b = bridge();
            if (!b) return;
            if (this.galleryBtn === btn && typeof b.galleryOpen === 'function' && b.galleryOpen()) {
                b.closeGallery('toggle');
                return;
            }
            var me = this;
            var opts = {align: 'tl-bl', onClose: function () {
                btn.classList.remove('on');
                btn.setAttribute('aria-expanded', 'false');
                if (me.galleryBtn === btn) me.galleryBtn = null;
            }};
            var ok = b.gallery(item.twin, btn, opts);
            if (ok) ok = this.settleCombo(item, btn, opts);
            this.closePopovers();
            if (!ok) return;
            this.galleryBtn = btn;
            btn.classList.add('on');
            btn.setAttribute('aria-expanded', 'true');
        },

        /* The stock gallery combo (ComboDataView — shapes) every half second
           checks its size and, on a mismatch, closes its menu
           (checkSize → onResize → menu.hide). While the ribbon is hidden, the combo never
           measured itself, and the very first check after the show closed the gallery
           in less than half a second. We do the check at once, in the same task:
           if it closed — we open again, there is no frame between them; later checks
           of the size no longer change anything. */
        settleCombo: function (item, btn, opts) {
            var b = bridge(), o = b.twin(item.twin);
            var menu = o && o.openButton && typeof o.openButton === 'object' ? o.openButton.menu : null;
            if (!menu || typeof o.checkSize !== 'function') return true;
            o.checkSize();
            var host = menu.parentEl;
            if (host && typeof host.hasClass === 'function' && host.hasClass('open')) return true;
            return b.gallery(item.twin, btn, opts);
        },

        /* --- Measurement and "⋯" ------------------------------------------------------------ */
        /* Like relayout() of Compact documents: show everything, take the honest
           widths, compute by arithmetic, apply once. The unit is a row control
           (a button or a wrapper of a button with a panel); they go one by one from the end,
           the core does not go. The room for the row — the card without margins, the core and the right
           edge #vo-tb-end (it holds "Slide Show ▾" and the chevron); "⋯" stands with its own
           width and the intergroup gap, only when something went away.
           If even the core with "⋯" and the right edge does not fit, the caption of the
           show button collapses to an icon (TIGHT_CLS on the card): the core and the
           right edge never go away, and a long caption would otherwise push
           the edge out of the card on a narrow window. */

        observe: function (bar, end) {
            var me = this, again = this.guard('relayout', function () { me.relayout(); });
            if (window.ResizeObserver) {
                this.ro = new ResizeObserver(again);
                this.ro.observe(bar);
                /* The right edge width is not included in the card width — its
                   change (the show button) is visible only to a separate observation. */
                this.ro.observe(end);
            }
            window.addEventListener('resize', again);
            if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
                document.fonts.ready.then(again);
            }
        },

        /* Tail controls in row order: direct children of visible groups after
           the core, except those hidden by the selection kind. */
        tailItems: function () {
            var out = [];
            each(this.el.querySelectorAll('.vo-g'), function (g, i) {
                if (!i || g.hasAttribute('hidden')) return;
                each(g.children, function (n) { if (!n.hasAttribute('hidden')) out.push(n); });
            });
            return out;
        },

        relayout: function () {
            if (this.busy || !this.el || this.moreOpen()) return;
            var bar = this.el;
            if (!bar.clientWidth) return;
            this.busy = true;
            try {
                var items = this.tailItems(), i;
                var core = bar.querySelector('.vo-g'), end = bar.querySelector('#' + END_ID), more = this.moreWrap;

                /* 1. Show everything and take the widths. */
                each(bar.querySelectorAll('.vo-collapsed'), function (n) { n.classList.remove('vo-collapsed'); });
                bar.classList.remove(TIGHT_CLS);
                show(more, true);
                var width = function (n) { return n ? n.getBoundingClientRect().width : 0; };
                var w = items.map(width);
                var moreW = width(more);
                show(more, false);

                var cs = window.getComputedStyle(bar);
                var gapGroup = parseFloat(cs.columnGap || cs.gap) || 0;
                var gs = core ? window.getComputedStyle(core) : null;
                var gapItem = gs ? parseFloat(gs.columnGap || gs.gap) || 0 : 0;
                var room = bar.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
                         - width(core);
                var avail = room - width(end);

                /* 2. How much is needed if the first n controls are shown: their own
                   widths, gaps inside groups, one gap before each
                   group and before the right edge, "⋯" — width and gap. */
                var need = function (n, withMore) {
                    var total = gapGroup, groups = 0, prev = null;
                    for (var k = 0; k < n; k++) {
                        var g = items[k].parentNode;
                        if (g !== prev) { groups++; prev = g; total += gapGroup; } else total += gapItem;
                        total += w[k];
                    }
                    return withMore ? total + moreW + gapGroup : total;
                };

                /* The core and the right edge do not fit even without the tail — collapse
                   the show caption and take the edge width again. */
                var tight = need(0, items.length > 0) > avail;
                if (tight) {
                    bar.classList.add(TIGHT_CLS);
                    avail = room - width(end);
                }

                /* 3. Everything fits — "⋯" is not needed; otherwise — from the end one by one. */
                var n = items.length, withMore = false;
                if (need(n, false) > avail) {
                    withMore = true;
                    while (n > 0 && need(n, true) > avail) n--;
                }

                /* 4. Apply. */
                for (i = n; i < items.length; i++) items[i].classList.add('vo-collapsed');
                show(more, withMore);
                this.syncGroups();
                var me = this;
                (this.pops || []).forEach(function (wr) {
                    if (wr.classList.contains('open') && !me.shownInBar(wr)) me.setOpen(wr, false);
                });
            } finally {
                this.busy = false;
            }
        },

        /* A group without visible controls is hidden entirely: its separator would otherwise
           hang in the air. */
        syncGroups: function () {
            each(this.el.querySelectorAll('.vo-g'), function (g, i) {
                if (!i) return;
                var live = Array.prototype.some.call(g.children, function (n) {
                    return !n.hasAttribute('hidden') && !n.classList.contains('vo-collapsed');
                });
                g.classList.toggle('vo-collapsed', !live);
            });
        },

        moreOpen: function () {
            return !!(this.moreWrap && this.moreWrap.classList.contains('open'));
        },

        toggleMore: function () {
            if (this.moreOpen()) { this.closeMore(); return; }
            this.closePopovers();
            this.openMore();
        },

        /* Controls that went away move into "⋯" and come back: this is our DOM,
           handlers are kept on the move, there are no copies — a command has one
           control and one state. In "⋯" — the same groups with their own rows. */
        openMore: function () {
            var me = this, moved = 0;
            each(this.el.querySelectorAll('.vo-g'), function (home, i) {
                if (!i) return;
                var gone = Array.prototype.filter.call(home.children, function (n) {
                    return n.classList.contains('vo-collapsed') && !n.hasAttribute('hidden');
                });
                if (!gone.length) return;
                var g = el('div', 'vo-g', {'data-group': home.getAttribute('data-group')});
                g.voHome = home;
                gone.forEach(function (n) {
                    n.classList.remove('vo-collapsed');
                    g.appendChild(n);
                });
                me.morePop.appendChild(g);
                moved += gone.length;
            });
            if (!moved) return;
            show(this.morePop, true);
            this.placeMore();
            this.moreWrap.classList.add('open');
            this.moreBtn.classList.add('on');
            this.moreBtn.setAttribute('aria-expanded', 'true');
        },

        /* An own popup panel does not go past the right window edge: for a button at the end
           of the row, in "⋯" or in a nested panel it shifts left, like
           "⋯" itself (placeMore). */
        keepInWindow: function (pop) {
            if (!pop || !pop.style) return;
            pop.style.left = '';
            if (typeof pop.getBoundingClientRect !== 'function') return;
            var r = pop.getBoundingClientRect();
            var vw = document.documentElement.clientWidth || window.innerWidth || 0;
            var over = r.right - (vw - 8);
            if (vw && over > 0) pop.style.left = -Math.min(over, Math.max(0, r.left - 8)) + 'px';
        },

        /* The "⋯" panel opens under the button left-right of it, but not past
           the window edge: in a narrow window it shifts left. */
        placeMore: function () {
            var pop = this.morePop;
            pop.style.left = '';
            var r = pop.getBoundingClientRect();
            var vw = document.documentElement.clientWidth || window.innerWidth || 0;
            var over = r.right - (vw - 8);
            if (over > 0) pop.style.left = -Math.min(over, Math.max(0, r.left - 8)) + 'px';
        },

        /* later — measure in a frame (relayoutSoon), not right away. */
        closeMore: function (later) {
            if (!this.moreOpen()) return;
            var me = this;
            (this.pops || []).forEach(function (w) {
                if (me.morePop.contains(w) && w.classList.contains('open')) me.setOpen(w, false);
            });
            Array.prototype.slice.call(this.morePop.children).forEach(function (g) {
                var home = g.voHome;
                Array.prototype.slice.call(g.children).forEach(function (n) { if (home) home.appendChild(n); });
                if (home) {
                    Array.prototype.slice.call(home.children).sort(function (a, b) { return (a.voIndex || 0) - (b.voIndex || 0); })
                        .forEach(function (n) { home.appendChild(n); });
                }
                me.morePop.removeChild(g);
            });
            show(this.morePop, false);
            this.moreWrap.classList.remove('open');
            this.moreBtn.classList.remove('on');
            this.moreBtn.setAttribute('aria-expanded', 'false');
            if (later) this.relayoutSoon(); else this.relayout();
        },

        /* --- Actions --------------------------------------------------------------- */

        /* A right-panel section command gets the button under which the
           popup panel stands; a button from "⋯" gets "⋯" itself: "⋯" closes. */
        act: function (item, b) {
            if (item.cmd) {
                var run = this.shell && this.shell.command(item.cmd);
                var args = (item.args || []).slice();
                if (PANEL_CMDS.indexOf(item.cmd) >= 0) args.push({anchor: this.moreWrap && b && this.moreWrap.contains(b) ? this.moreBtn : b});
                if (typeof run === 'function') run.apply(null, args);
            } else if (item.twin) {
                this.run(item.twin);
            }
            this.done(b);
        },

        /* A command from "⋯" is done — "⋯" closes, like a menu. */
        done: function (node) {
            if (node && this.moreWrap && this.moreWrap.contains(node)) this.closeMore();
        },

        run: function (ref, opts) {
            var b = bridge();
            return b ? b.run(ref, opts) : false;
        },

        /* Double click on "Format Painter" — the stock handler of the
           ribbon button double click (the format stays on). */
        twinDblClick: function (ref) {
            var b = bridge(), o = b && b.twin(ref);
            var $el = o && o.cmpEl;
            if ($el && typeof $el.trigger === 'function' && !(b.state(ref) || {}).disabled) $el.trigger('dblclick');
        },

        /* --- Stock editing lock ------------------------------------------------- */
        /* Who forbids and why — the stock reason stack (CompactShell.lockState),
           here only the application. For the time of the lock the stock puts over its
           ribbon a transparent .toolbar-mask layer that eats clicks, and dims
           it with the masked class (Toolbar.DisableToolbar), while the buttons are not disabled.
           We repeat the meaning, not the markup, as the Compact documents panel
           (its setLocked): an own layer over the card and dimming
           (compact-toolbar.less).
           We do not touch the control states: they are driven by counterparts and the engine, and
           lifting the lock is one move that diverges from nothing.
           The layer eats mouse clicks, but the buttons would remain reachable from
           the keyboard, so the second lock is the tab order: the controls
           leave it, the control's own tabindex is remembered and
           returned, focus is removed from the card. Open panels, "⋯" and
           the shown gallery are closed: they pop up over the layer. */
        locked: false,

        applyLock: function () {
            var s = this.shell, st = s && typeof s.lockState === 'function' ? s.lockState() : null;
            this.setLocked(!!(st && st.on && st.options && st.options.toolbar));
        },

        setLocked: function (lock) {
            lock = !!lock;
            var bar = this.el;
            if (!bar || lock === this.locked) { this.locked = lock; return; }
            this.locked = lock;
            if (lock) {
                this.closePopovers();
                var b = bridge();
                if (this.galleryBtn && b && typeof b.galleryOpen === 'function' && b.galleryOpen()) b.closeGallery('lock');
            }
            var mask = null;
            each(bar.children, function (n) { if (n.classList && n.classList.contains(MASK_CLS)) mask = n; });
            if (lock && !mask) bar.appendChild(el('div', MASK_CLS, {'aria-hidden': 'true'}));
            if (!lock && mask) bar.removeChild(mask);
            bar.classList.toggle(LOCK_CLS, lock);
            this.lockTabs(lock);
        },

        /* The removal searches the whole document: "Slide Show ▾" could have
           moved to the header during the lock. */
        lockTabs: function (lock) {
            var bar = this.el;
            if (lock) {
                each(bar.querySelectorAll('button, a[href], input, select, textarea'), function (n) {
                    var was = n.getAttribute('tabindex');
                    if (n.hasAttribute(TAB_ATTR) || was === '-1') return;
                    n.setAttribute(TAB_ATTR, was === null ? '' : was);
                    n.setAttribute('tabindex', '-1');
                });
                var f = document.activeElement;
                if (f && f !== document.body && bar.contains(f) && typeof f.blur === 'function') f.blur();
                return;
            }
            each(document.querySelectorAll('[' + TAB_ATTR + ']'), function (n) {
                var was = n.getAttribute(TAB_ATTR);
                n.removeAttribute(TAB_ATTR);
                if (was) n.setAttribute('tabindex', was); else n.removeAttribute('tabindex');
            });
        },

        /* --- State ---------------------------------------------------------------- */

        /* Visibility of groups by selection kind, then availability and pressed state
           from counterparts. The row changes only if the composition of visible groups
           and controls changed: then "⋯" closes, a panel that vanished from the row too, and
           the measurement goes to a frame. force — recompute without comparison (build, the shell
           row). */
        refresh: function (kind, force) {
            if (!this.el) return;
            var me = this;
            if (!kind) {
                var sel = PE.Views.SlideSelection;
                kind = sel && typeof sel.kind === 'function' ? sel.kind() : 'none';
            }
            var seen = GROUPS.map(function (grp) { return visibleFor(grp.when, kind) ? 1 : 0; }).join('') + '|' +
                Object.keys(ITEMS).map(function (key) {
                    var item = ITEMS[key];
                    return !item.when && !item.panel ? '' : itemShown(item, kind) ? 1 : 0;
                }).join('');
            if (force || seen !== this.shown) {
                this.shown = seen;
                this.closeMore(true);
                GROUPS.forEach(function (grp) {
                    var g = me.el.querySelector('.vo-g[data-group="' + grp.name + '"]');
                    if (g) show(g, visibleFor(grp.when, kind));
                });
                Object.keys(ITEMS).forEach(function (key) {
                    var item = ITEMS[key];
                    if (!item.when && !item.panel) return;
                    each(me.el.querySelectorAll('[data-vo="' + key + '"]'), function (b) {
                        show(b.parentNode && b.parentNode.getAttribute('data-vo-wrap') === key ? b.parentNode : b, itemShown(item, kind));
                    });
                });
                (this.pops || []).forEach(function (w) {
                    if (w.classList.contains('open') && !me.shownInBar(w)) me.setOpen(w, false);
                });
                this.relayoutSoon();
            }
            this.sync();
        },

        /* Measurement in the nearest frame: consecutive changes give one measurement, and reading
           geometry does not happen in the middle of click handling. */
        relayoutSoon: function () {
            if (this.frame) return;
            var me = this;
            var run = this.guard('relayout', function () {
                me.frame = null;
                me.relayout();
            });
            this.frame = typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame(run) : setTimeout(run, 16);
        },

        shownInBar: function (n) {
            for (; n && n !== this.el; n = n.parentNode) if (n.hasAttribute && n.hasAttribute('hidden')) return false;
            return !!n;
        },

        sync: function () {
            var me = this, b = bridge();
            (this.controls || []).forEach(function (c) {
                var item = c.item;
                if (item.cmd) {
                    var has = me.shell && typeof me.shell.hasCommand === 'function' ? me.shell.hasCommand(item.cmd) : undefined;
                    c.el.disabled = has === false;
                    return;
                }
                if (!b || !item.twin || item.check) return;
                me.watch(item.twin);
                me.apply(c, b.state(item.twin));
            });
        },

        /* Watching a counterpart: the stock code disables and presses it itself. The right
           panel fields appear lazily, so the watch is set when the
           counterpart exists, and reset if the stock object changed. */
        watch: function (ref) {
            var b = bridge(), me = this, o = b.twin(ref), w = this.watched[ref];
            if (!o || (w && w.twin === o)) return;
            if (w && typeof w.off === 'function') w.off();
            var off = b.watch(ref, this.guard('watch ' + ref, function (state) {
                (me.controls || []).forEach(function (c) { if (c.item.twin === ref && !c.item.check) me.apply(c, state); });
            }));
            this.watched[ref] = {twin: o, off: off};
        },

        apply: function (c, state) {
            state = state || {};
            c.el.disabled = !state.exists || !!state.disabled;
            /* A counterpart disabled by the stock code with a known reason ("Nothing
               to undo") names it before the press — the same reason as for the
               catalog item. */
            if (c.item.idle) {
                var acts = PE.Views.SlideActions, tip = text(c.item.tip);
                var why = state.exists && state.disabled && acts ? acts[c.item.idle] : null;
                if (typeof why !== 'string' || !why) why = null;
                c.el.setAttribute('title', why ? tip + ' (' + why + ')' : tip);
                if (why) c.el.setAttribute('aria-description', why); else c.el.removeAttribute('aria-description');
            }
            if (c.item.pressed) {
                c.el.classList.toggle('on', !!state.pressed);
                c.el.setAttribute('aria-pressed', state.pressed ? 'true' : 'false');
            }
        },

        /* Values from the engine. The initial one is what the engine already gave to the stock
           field, then its callbacks. */
        readInitial: function () {
            var b = bridge();
            if (!b) return;
            var me = this;
            [['font', 'Toolbar:cmbFontName', ''], ['size', 'Toolbar:cmbFontSize', ''], ['zoom', 'ViewTab:cmbZoom', '%']].forEach(function (x) {
                var o = b.twin(x[1]), v;
                try { v = o && typeof o.getValue === 'function' ? o.getValue() : undefined; } catch (e) { v = undefined; }
                if (v !== undefined && v !== null && v !== '' && typeof v !== 'object' && typeof v !== 'function') me.setValue(x[0], v, x[2]);
            });
        },

        setValue: function (key, v, unit) {
            if (!this.el) return;
            var n = this.el.querySelector('[data-vo="' + key + '"] .vo-value-label');
            if (!n) return;
            var s = v === undefined || v === null ? '' : String(v);
            if (unit && s && s.slice(-unit.length) !== unit) s += unit;
            n.textContent = s;
        },

        setFont: function (font) {
            var name = font;
            if (font && typeof font === 'object') {
                name = typeof font.get_Name === 'function' ? font.get_Name()
                     : typeof font.asc_getName === 'function' ? font.asc_getName() : font.name;
            }
            this.setValue('font', name);
        },

        setAlign: function (v) {
            if (!this.el) return;
            var n = this.el.querySelector('[data-vo="align"] .vo-drop-i');
            if (n) n.innerHTML = icon(alignIcon(v));
        },

        setStyle: function (key, on) {
            if (!this.el) return;
            each(this.el.querySelectorAll('[data-vo="' + key + '"]'), function (b) {
                b.classList.toggle('on', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        },

        /* Superscript and subscript: the engine baseline (Asc.vertalign_*). */
        setBaseline: function (v) {
            var A = window.Asc || {};
            this.setStyle('sup', v === (A.vertalign_SuperScript !== undefined ? A.vertalign_SuperScript : 2));
            this.setStyle('sub', v === (A.vertalign_SubScript !== undefined ? A.vertalign_SubScript : 1));
        },

        /* --- Texts ------------------------------------------------------------------- */
        /* Shell captions (not from the stock locale); the defaults are English,
           the translation overlays them from locale/<language>.json. Stock captions are taken
           from stock code objects. */

        textBackground: 'Background',
        textColorCode_ARIA: 'Color code',
        textCustomColor: 'Custom color',
        textLayout: 'Layout',
        textNewSlide: 'New slide',
        textNoLine: 'No line',
        textPaintFormat: 'Format painter',
        textTheme: 'Theme',
        textTransition: 'Transition',
        tipAlign: 'Alignment and spacing',
        tipBackground: 'Slide background',
        tipBorderColor: 'Border color',
        tipCase: 'Case',
        tipClearFormat: 'Clear formatting',
        tipFillColor: 'Fill color',
        tipFocus: 'Focus mode',
        tipLineColor: 'Line color',
        tipLineType: 'Line type',
        tipLineWidth: 'Line width',
        tipLink: 'Add or edit link',
        tipLists: 'Lists and indents',
        tipMore: 'More',
        tipNewSlide: 'New slide (Ctrl+M)',
        tipObjectProps: 'Object properties',
        tipPaintFormat: 'Format painter — double-click keeps it on',
        tipRedo: 'Redo',
        tipSubscript: 'Subscript',
        tipSuperscript: 'Superscript',
        tipTextColor: 'Text color',
        tipTextStyles: 'Text styles',
        tipUnderline: 'Underline',
        tipUndo: 'Undo'

    }, PE.Views.CompactToolbar || {});

    return PE.Views.CompactToolbar;
});
