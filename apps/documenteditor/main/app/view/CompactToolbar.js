/*
 * CompactToolbar — the formatting row of the new shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 *     our UI  →  stock editor commands  →  document engine
 *
 * The markup and controls are our own. Formatting is not reimplemented and
 * we keep no state of our own: commands go to the api, the state
 * comes back via stock callbacks. The source of truth is the engine.
 *
 * A button that has a counterpart in the menu bar calls a catalog item
 * (DocumentActions.runCommand by key): one command — one behavior in the menu,
 * "/", the row and the bubble. The catalog does not call the row.
 *
 * Controls for which 9.4 has no cheap stock API are not drawn at all:
 * there must be no fake buttons in the interface.
 */
define([
    'documenteditor/main/app/view/Icons',
    'documenteditor/main/app/view/ToolbarHints'
], function (Icons, ToolbarHints) {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    var BAR_ID = 'vo-tb';

    var FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72];
    var FONTS      = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia',
                      'Tahoma', 'Times New Roman', 'Verdana'];

    /* Icons — the AIR set from Icons.js: 24x24 glyphs as files, a mask in the
       text color. The home-made outlines are removed. */

    /* The same values as in "View → Zoom ▸" (DocumentActions, view.zoom.*):
       fit to width and to page exist in the menu and in the status bar. */
    var ZOOMS = [50, 75, 100, 125, 150, 200];

    /* Headings — exactly four
       items, each with an icon, a name and a description caption. There are no lists,
       quotes or code in this list — it is only about the heading level.

       Here ALL styles from get_MergedStyles() used to get in, including the character
       ones ("Subtle Emphasis" and the like, styletype_Character = 0x04). Choosing a
       character style in a heading level list is meaningless, hence
       the feeling of a dump.

       The style names are internal, English: put_Style expects exactly them
       (controller/Toolbar.js:2707 passes title, and title is get_Name()).
       We show the translation from the translationTable of the Main controller. */
    /* A function, not a constant: the captions are located in the locale, that is on the object
       DE.Views.CompactToolbar, and it is assembled below in this same file. A function
       declaration is hoisted, so the order of lines does not matter. The same
       goes for ALIGN and LISTS. */
    function HEADINGS() {
        var S = DE.Views.CompactToolbar;
        return [
            {style: 'Normal',    k: 'normal',   icon: 'text',  t: S.textNormal,   d: S.textNormalHint},
            {style: 'Heading 1', k: 'heading1', icon: 'h1',    t: S.textHeading1, d: S.textHeading1Hint},
            {style: 'Heading 2', k: 'heading2', icon: 'h2',    t: S.textHeading2, d: S.textHeading2Hint},
            {style: 'Heading 3', k: 'heading3', icon: 'h3',    t: S.textHeading3, d: S.textHeading3Hint}
        ];
    }

    /* The paragraph style type in the engine: styletype_Paragraph = 0x01,
       styletype_Character = 0x04 (sdkjs/word/Editor/Styles.js:93-96). */
    var STYLE_PARAGRAPH = 1;

    /* The engine alignment values: the asc_onPrAlign callback gives these numbers
       (the row mark), the command is led by the catalog item `format.align.<k>`;
       the order in the list is visual.

       The numbers go NOT in the order of the rows, and this is not a typo: in the engine 0 is
       ALIGNED RIGHT, and 1 is left. Checked against the stock code both ways: the command
       btnAlignLeft sends as onHorizontalAlign(…, 1), btnAlignRight — as 0
       (controller/Toolbar.js:365,367), and the callback is read the same way — the left
       button is highlighted at v===1, the right at v===0 (:675-676). */
    function ALIGN() {
        var S = DE.Views.CompactToolbar;
        return [
            {v: 1, k: 'left',    icon: 'alignL', t: S.textAlignLeft},
            {v: 2, k: 'center',  icon: 'alignC', t: S.textAlignCenter},
            {v: 0, k: 'right',   icon: 'alignR', t: S.textAlignRight},
            {v: 3, k: 'justify', icon: 'alignJ', t: S.textAlignJust}
        ];
    }

    /* `v` is the engine list type (the row mark), `k` is an item of the catalog "Format → Lists ▸":
       the command, the put_ListType subtype and removing the list by choosing it again
       are led by it (DocumentActions, listType). */
    function LISTS() {
        var S = DE.Views.CompactToolbar;
        return [
            {v: 0, k: 'bullet',     icon: 'bullet',     t: S.textBullets},
            {v: 1, k: 'numbered',   icon: 'numbered',   t: S.textNumbering},
            {v: 2, k: 'multilevel', icon: 'multilevel', t: S.textMultilevel}
        ];
    }

    /* Icons — from the shared catalog Icons.js. Before, there was its own
       outline table here: 38 glyphs of 39 duplicated the catalog byte for byte,
       and such copies start to diverge silently. */
    function svg(name, size) {
        return Icons.svg(name, size);
    }

    /* The checkmark of the selected value. We always put the node, CSS shows it by the
       .on class — so the glyph stays single in Icons.js, and is not duplicated by
       a second data-URI, which then cannot be found with grep (we already got burned on this with the
       .vo-sel chevron). */
    /* The row identifiers are needed for aria-activedescendant — it refers to the
       row by id, not by node. */
    var VALUE_UID = 0;

    function checkNode() {
        return $('<span class="vo-pop-check"></span>').html(svg('checkMenu', 18));
    }

    /* The text color palette — a grid from the stage color palette of the host portal's stage editor. Six rows by
       the weights 100/200/300/400/600/800, fourteen columns, hex values without
       the hash — copied by values, like all the rest of the shell palette:
       the editor has no source palette modules, and ts cannot be
       built here. The sample code was not carried over, only the numbers and the layout. */
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

    /* The checkmark color on the sample. In the source palette this is done by its own
       function — it is not here, so we compute it ourselves by
       the relative luminance of sRGB (WCAG 2.1, 1.4.3): on a light sample a dark
       checkmark, on a dark one a light one. The threshold is 0.5 by L, not by the sum of channels:
       yellow FFFF00 and blue 0000FF give the same sum and different luminance. */
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

    DE.Views.CompactToolbar = _.extend({

        api: null,
        el: null,
        ctrl: {},

        isReady: function () {
            var vp = DE.getController('Viewport');
            this.api = vp && vp.api;
            return !!(this.api && this.api.asc_registerCallback);
        },

        /* --- Markup ------------------------------------------------------ */
        /* The order is by meaning: controls are grouped in families (service, text, paragraph,
           insert), the composition of each and their sequence are set deliberately.
           The former layout ranked the controls
           by a priority score — that was a queue for ejection on window narrowing, and
           related commands scattered across the whole panel.

           The priority did not disappear from the layout, it just stopped being the first
           axis: we hide the same way from the end, and the widths are measured by relayout(),
           so the controls have no threshold numbers.

           Only the service group does not collapse. The font, style and font size
           stopped being the core: they are assembled with the style marks into one
           block, and the group fits entirely only into the tail.
           As a side effect this fixes the worst class of hiding — a hidden font select
           is now reachable from "…" together with its neighbors, and does not vanish completely.
           We deliberately did not keep them outside the collapsible array here. */

        build: function () {
            var me = this, c = this.ctrl;
            if (this.hints) this.hints.destroy();
            /* The row is rebuilt on a mode change, and the "Link" button — the popup
               anchor — is replaced by a new node. An open popup would stay
               hanging at the discarded one. */
            if (this._linkUI) this._linkUI.close(false);
            /* The registry of value lists. We reset it on every build: the panel
               is rebuilt on a mode change, and the old wrappers would stay
               hanging in the list already removed from the DOM. */
            this._values = [];
            var $bar = $('<div id="' + BAR_ID + '"></div>');

            /* --- The core: does not collapse ------------------------------------ */
            /* Service — what is not about text: edit history, search in the
               document, discussion, window zoom. Search and the comments button
               lived in the menu bar, so the "discuss" command was in two
               places at once. */

            c.undo = this.iconBtn('undo', this.tipUndo, function () { me.api.Undo(); });
            c.redo = this.iconBtn('redo', this.tipRedo, function () { me.api.Redo(); });
            /* The magnifier opens the floating search bar (the stock window
               Common.UI.SearchBar), the same as Ctrl+F, — as in spreadsheets.
               The left panel with replace opens only on request: the "⋮"
               of the bar, Ctrl+H and the menu item "Find and replace"
               (controller/LeftMenu.js, onCompactFindReplace). A pressed magnifier
               closes the bar — with the stock hide, like its close button. */
            c.search = this.iconBtn('search', this.tipSearch, function () {
                var viewport = DE.getController('Viewport');
                if (viewport && viewport.isSearchBarVisible()) viewport.searchBar.hide();
                else Common.NotificationCenter.trigger('search:show');
            });
            var service = [c.undo, c.redo, c.search];
            /* The right to comment, not only the presence of the method: the stock code
               gates each of its "Comment" entry points with the condition
               `canCoAuthoring && canComments` — see CompactShell.canAddComment. */
            if (typeof this.api.asc_addComment === 'function' &&
                DE.Views.CompactShell.canAddComment()) {
                c.comment = this.iconBtn('comment', this.tipComment, function () { me.toggleComments(); });
                /* The row is rebuilt on a mode change — we take the pressed state of the new
                   button from the panel that is open now. */
                var stockComments = DE.Views.CompactShell.stockLeftBtn('comments');
                this.setCommentsOpen(!!(stockComments && stockComments.pressed));
                service.push(c.comment);
            }
            c.zoom = this.valueBtn('vo-w-zoom', this.tipZoom, ZOOMS.map(function (z) {
                return {v: z, t: z + '%'};
            }), function (v) { me.run('view.zoom.' + parseInt(v, 10)); });
            service.push(c.zoom);
            $bar.append(this.group(service));

            /* Text: font → style → font size. The order is set deliberately. */
            c.font = this.valueBtn('vo-w-font', this.tipFontName,
                                 FONTS.map(function (f) { return {v: f, t: f}; }),
                                 function (v) { me.api.put_TextPrFontName(v); });
            /* The font size — a list and keyboard input (sizeBox). */
            c.size = this.sizeBox();
            /* The font, style and font size are only CREATED here: they take their place in the row
               as the first group of the tail, together with the style marks — they are assembled
               into one block. They stopped being the core:
               the group can be located entirely only in the tail, otherwise between the font size
               and "B" a separator remains, which cuts this group. */

            /* --- The tail: collapses from the end ------------------------------- */
            /* One container, because it collapses as a whole: when
               "…" opens, the hidden controls move into the popover and back.
               This is our DOM, not the stock one — it may be moved.

               The order of groups is by meaning, not by priority score: a family of
               commands stays together, even if half of it goes into "…" earlier than
               its neighbors. The former layout was a queue for ejection, and because of this
               formatting sat on three steps, lists on two, insertion
               on two. The widths are computed by relayout(), there are no threshold numbers,
               so the meaning now costs nothing. */

            var $of = $('<div class="vo-of"></div>');
            var tail = function (items) { $of.append(me.group(items)); };

            /* The style marks — items of "Format → Text ▸": the mark and the command
               (turn on or off) are led by the catalog by engine events. Superscript and
               subscript are one engine property (put_TextPrBaseline) by the
               constant name, not by a number: the former digits mixed them up. */
            c.bold      = this.iconBtn('bold', this.tipBold, function () { me.run('format.text.bold'); });
            c.italic    = this.iconBtn('italic', this.tipItalic, function () { me.run('format.text.italic'); });
            c.underline = this.iconBtn('underline', this.tipUnderline, function () { me.run('format.text.underline'); });
            c.strike    = this.iconBtn('strike', this.tipStrikeout, function () { me.run('format.text.strikeout'); });
            c.sup = this.iconBtn('sup', this.tipSuperscript, function () { me.run('format.text.superscript'); });
            c.sub = this.iconBtn('sub', this.tipSubscript, function () { me.run('format.text.subscript'); });

            /* Format painter and clear — right after "Strikethrough", in the style
               marks group: on window narrowing they go into "…" together with it, and not
               first, like the rare buttons of the tail.
               The format painter is a mode, not a one-time action, and it has no counterpart in the menu.
               The engine does not report turning it on: asc_onPaintFormatChanged
               comes only with kOff (the format applied or reset), so
               the highlight on turning on is set by the button itself — like btnCopyStyle
               of the stock ribbon. */
            var typeface = [c.font, this.headingBtn(), c.size, c.bold, c.italic, c.underline, c.strike];
            if (typeof this.api.SetPaintFormat === 'function') {
                c.paint = this.iconBtn('paint', this.tipPaintFormat, function () {
                    var on = !c.paint.hasClass('on');
                    c.paint.toggleClass('on', on);
                    me.api.SetPaintFormat(on ? 1 : 0);
                });
                typeface.push(c.paint);
            }
            if (typeof this.api.ClearFormating === 'function') {
                c.clear = this.iconBtn('clear', this.tipClearStyle, function () { me.run('format.clear'); });
                typeface.push(c.clear);
            }
            tail(typeface);

            /* The "Automatic" sample shows not the document color (in the engine
               automatic is black), but our text one: it was so before too.
               The value moved along with the palette, #1d1d1f -> base-1. It is located in
               JS, so the palette translation in compact-shell.less did not touch it. */
            c.color = this.colorBtn({
                icon: 'color', title: this.tipFontColor, initial: '#333333',
                resetLabel: this.textAutoColor, resetSwatch: '#333333',
                reset: function () {
                    var auto = new Asc.asc_CColor();
                    auto.put_auto(true);
                    me.api.put_TextColor(auto);
                },
                /* The whole stage grid, 6x14. The color code field is enabled:
                   put_TextColor accepts an arbitrary color, there is no format
                   restriction here.
                   concat instead of flat(): in the shell all code is ES5, and introducing
                   a newer language level for one call is pointless. */
                colors: [].concat.apply([], PALETTE_STAGE),
                cols: 14,
                custom: true,
                value: '333333',
                apply: function (hex) {
                    me.api.put_TextColor(me.ascColor('#' + hex));
                }
            });
            c.highlight = this.colorBtn({
                icon: 'highlight', title: this.tipHighlight, initial: '#ffe066',
                resetLabel: this.textNoFill, resetSwatch: 'transparent',
                /* Choosing a color (and "No fill" — it is an eraser, not turning off:
                   the stock code sends it by the same SetMarkerFormat(true, false),
                   controller/Toolbar.js:3272,3740) TURNS ON the marker mode.
                   Only off turns it off. We set the mark right here, as the stock code
                   in _setMarkerColor (:3734): SetMarkerFormat itself sends no event,
                   the engine callback comes later and only corrects us. */
                /* A pressed button with a highlighted selection removes the highlight from it —
                   the way a repeated click on "B" removes bold:
                   the same SetMarkerFormat(true, false) as for "No fill",
                   and an immediate exit from the mode so that the eraser does not stay in the hand. */
                off: function () {
                    if (me.highlightedSelection()) me.api.SetMarkerFormat(true, false);
                    me.api.SetMarkerFormat(false);
                    me.syncHighlight();
                },
                offTitle: this.textMarkerOff,
                reset: function () { me.api.SetMarkerFormat(true, false); me.setMarker(true); },
                /* A set NOT from the stages and it must not change: it is the OOXML highlight
                   enumeration. The highlight is stored in w:highlight BY NAME
                   ("yellow", "cyan", …), not as RGB, and this can be verified
                   not by the specification but right in the stock code: next to the same sixteen
                   sits colorHints with the color names
                   (app/view/Toolbar.js, mnuHighlightColorPicker). So
                   there is no arbitrary color here and no color code field either —
                   it would offer what the format does not store.
                   Eight columns instead of the former four: sixteen colors
                   lay out in two even rows, and the sample comes out the same
                   size as in the text color grid. */
                colors: ['FFFF00', '00FF00', '00FFFF', 'FF00FF', '0000FF', 'FF0000',
                         '00008B', '008B8B', '006400', '800080', '8B0000', '808000',
                         'FFFFFF', 'D3D3D3', 'A9A9A9', '000000'],
                cols: 8,
                custom: false,
                value: 'FFFF00',
                apply: function (hex) {
                    var v = me.rgb('#' + hex);
                    me.api.SetMarkerFormat(true, true, v.r, v.g, v.b);
                    me.setMarker(true);
                }
            });
            tail([c.color, c.highlight]);

            /* Paragraph: alignment and right after it the line spacing —
               a separate button with the list "Format → Spacing ▸". */
            var para = [this.alignBtn()];
            var spacing = this.spacingBtn();
            if (spacing) para.push(spacing);
            tail(para);

            /* Lists in one button, indents inside it. */
            if (typeof this.api.put_ListType === 'function') tail([this.listsBtn()]);

            /* Insert: table, image, link. The link was placed separately
               from them. */
            var insert = [];
            /* A size picker grid instead of a rigid 3×3: the grid itself is stock
               (DimensionPicker), it has the same 8×10 as in the ribbon. */
            if (typeof this.api.put_Table === 'function' && Common.UI.DimensionPicker) {
                insert.push(this.popBtn({
                    icon: 'table', title: this.tipTable,
                    build: function ($pop, $wrap) {
                        var $host = $('<div class="dimension-picker vo-dim"></div>').appendTo($pop);
                        var picker = new Common.UI.DimensionPicker({
                            el: $host,
                            minRows: 8, minColumns: 10, maxRows: 8, maxColumns: 10
                        });
                        picker.on('select', function (p, columns, rows) {
                            $wrap.removeClass('open');
                            /* The grid gives 0×0 if the click landed outside the cells
                               (DimensionPicker.js:131 sends the current value as
                               is), and put_Table(0,0) brings the engine down from the inside —
                               such a size is cut off by the catalog item. */
                            me.run('insert.table', {cols: columns, rows: rows});
                        });
                    }
                }));
            }
            if (typeof this.api.asc_addImage === 'function') {
                insert.push(this.iconBtn('image', this.tipImage, function () { me.run('insert.image'); }));
            }
            if (window.Asc && Asc.CHyperlinkProperty) {
                c.link = this.iconBtn('link', this.tipLink, function () { me.run('insert.link'); });
                insert.push(c.link);
            }
            if (insert.length) tail(insert);

            /* The last group of the row = first to eject: superscript and subscript. */
            tail([c.sup, c.sub]);

            /* Paragraph marks and text direction are no longer drawn here:
               rare view toggles moved to the "View" menu
               (DocumentActions.js, the "View" group). */

            $bar.append($of);

            /* --- The right cluster -------------------------------------------- */

            c.more = this.iconBtn('more', this.tipMore, function (e) {
                e.stopPropagation();
                me.toggleOverflow();
            }).addClass('vo-more');
            /* The chevron on the right collapses and expands the header and the menu row —
               the same command as "View → Focus mode"; the toolbar row
               stays (to collapse it — "View → Toolbar").
               The direction shows the state: rotated while the top is hidden.
               We do not introduce a separate "up" glyph — the AIR chevron
               rotates (compact-shell.less, .vo-focus-btn); the on class and
               aria-pressed are set by CompactShell.setChrome. */
            c.focus = this.iconBtn('chevron', this.tipFocus, function () {
                me.run('view.focus');
            }).addClass('vo-focus-btn').attr('aria-pressed', 'false');

            this.$of = $of;
            this.$pop = $('<div class="vo-of-pop"></div>');
            /* "…" is part of the row, right after the groups. It is no longer pressed to
               the right edge — only the focus mode remains there, it is about the window, not
               about the text. As a price for this "…" became an ordinary row element with
               its own inter-group gap, and relayout accounts for this
               as a separate term (see need).

               The button and the popover are in one wrapper, and the row element is it.
               The popover is positioned from it (position:relative), that is
               it opens exactly under its button. While it hung on
               .vo-tb-end, its right edge was at the right edge of the panel — at
               97 px to the right of "…" at 900 and at 148 px at 1200 (measured), and
               the opening surface pointed into an empty corner.

               The wrapper is also the unit of collapsing: display:none removes from the
               layout both the button and its inter-group gap. The row has
               the same number of children as before, so the fixedWidth/need arithmetic has not
               changed — but now it is the wrapper that must be hidden and measured
               (see moreEl in relayout). */
            this.$moreWrap = $('<span class="vo-more-wrap"></span>')
                .append(c.more).append(this.$pop);
            $bar.append(this.$moreWrap);
            $bar.append($('<div class="vo-tb-end"></div>').append(c.focus));

            $(document).on('click', function () { me.closeOverflow(); });

            /* The width is given by an observer, not a media query. A fallback to window resize:
               without ResizeObserver the panel is simply recalculated less often. */
            if (window.ResizeObserver) {
                this._ro = new ResizeObserver(function () { me.relayout(); });
                this._ro.observe($bar[0]);
                /* The second target is the right cluster. Its width enters avail
                   via fixedWidth — that one goes over all the row children except the
                   tail, — while the width of the panel itself does not depend on its content:
                   the row is stretched by the window. So a change inside the
                   cluster is not seen by the observer on $bar at all, and the recalculation
                   would have to be called by hand.
                   Today the observation sleeps: in the cluster there is one focus mode
                   button of constant width (32 px in all 110 measurements of the
                   run), and no callbacks come from there. It is kept not out of
                   inertia — it is the only thing that holds the promise
                   "adding a control breaks nothing else" for the right
                   corner; the cost is zero, one ResizeObserver with two targets
                   gives one callback per frame.
                   (The former rationale named a specific occasion — the "Object
                   properties" button, which CompactShell put here. The button
                   is gone, the panel opens on selection; grep
                   vo-tb-end over CompactShell.js is empty.) */
                this._ro.observe($bar.find('.vo-tb-end')[0]);
            } else {
                $(window).on('resize', function () { me.relayout(); });
            }
            /* The dropdown metrics depend on the loaded font. */
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(function () { me.relayout(); });
            }

            this.el = $bar;
            this.hints = new ToolbarHints($bar[0]);
            return $bar;
        },

        /* --- The editing prohibition ---------------------------------------------------- */
        /* Who prohibits and why is the shell's business (CompactShell.applyEditingLock),
           here is only the application. The stock code does it on its ribbon with a mask:
           .toolbar-mask (or .toolbar-group-mask) — a separate layer over the row
           that eats clicks, plus the masked class dimming the groups
           (controller/Toolbar.js, DisableToolbar; the look — common/main/resources/
           less/toolbar.less). We repeat the meaning, not the markup.

           We do NOT touch THE STATES OF THE BUTTONS THEMSELVES: the mask is removed in one move,
           while a per-name restoration would diverge from the engine — the controls get their own states
           from stock callbacks, and for undo/redo this is precisely
           the disabled attribute (asc_onCanUndo/asc_onCanRedo below). Having removed it
           wholesale, we would revive a button that the engine disabled.

           But a mask alone is not enough, and this was a hole: the mask eats CLICKS, while
           the buttons are ordinary <button> and stayed in the tab order. Having reached
           "B" with Tab and pressed Enter, the user executed the command with
           the prohibition in force: the iconBtn handler fired, put_TextPrBold
           went to the engine. The same for Undo/Redo, "Comment", "Link",
           the colors and lists. The stock code makes two layers here, not one:
           next to .toolbar-mask it calls toolbar.lockToolbar(...), switching
           the components to disabled, and silences the hotkeys
           (controller/Toolbar.js:3786-3826).

           Our second layer is the tab order, not disabled: nobody uses tabindex in the
           row, the engine does not manage it, and removing the attribute
           returns to the native buttons their default — that is, restoration
           stays one move and diverges from nothing. Focus inside the
           row is removed: tabindex -1 does not prevent Enter on an already focused
           button. Clicks are closed by the mask and pointer-events on .vo-masked
           (compact-shell.less).

           A separate node, not pointer-events on the whole panel: this way a click does not
           fall through to what is under the card — and the stock code
           does the same. */

        locked: false,

        setLocked: function (lock) {
            lock = !!lock;
            this.locked = lock;
            if (!this.el) return;

            /* The popup pops up OVER the row, that is, over the mask too: left open
               it would stay alive. The stock code does the same on its ribbon —
               hideMoreBtns() and synchTooltip.hide() in DisableToolbar. */
            if (lock) { this.closeOverflow(); this.closePopovers(); }

            var $mask = this.el.children('.vo-tb-mask');
            if (lock && !$mask.length) $('<div class="vo-tb-mask"></div>').appendTo(this.el);
            if (!lock && $mask.length) $mask.remove();
            this.el.toggleClass('vo-masked', lock);

            /* The tab order. The link popover (#vo-link) does not get here:
               it is attached to body, it is closed by closePopovers above, and the
               tabindex of its list rows is led by separate code. */
            var $live = this.el.find('button, a[href], input, select, textarea');
            if (lock) {
                $live.attr('tabindex', '-1');
                var focused = document.activeElement;
                if (focused && this.el[0].contains(focused) && focused.blur) focused.blur();
            } else {
                $live.removeAttr('tabindex');
            }
        },

        /* --- Overflow ---------------------------------------------------- */
        /* The collapsed controls move into the popover and come back.
           Moving nodes is allowed: this is our DOM, not the stock ribbon, and handlers
           are preserved on appendTo. We make no copies — otherwise one command
           would have two controls with diverging state. */

        toggleOverflow: function () {
            /* We read the openness BEFORE closing: closeSurfaces also closes the
               "•••" row, and a repeated click on "•••" must remain
               a closing, not a blinking.
               Until 19.09 "•••" closed nothing at all: an open menu bar
               menu stayed over it and covered its right part. */
            var open = !this.el.hasClass('vo-of-open');
            this.closeSurfaces();
            if (open) this.openOverflow();
        },

        openOverflow: function () {
            var me = this, moved = 0;

            /* The unit of transfer is a control, not a group. We hide one by one from the
               end, so a group very often stays half
               visible: if only entirely collapsed groups were moved, its
               hidden half would not get into "…" and would become unreachable
               altogether. We build our own group in the popover,
               to keep the split: it is an empty wrapper, it is no loss. */
            this.$of.children('.vo-g').each(function () {
                var home = this;
                var hidden = [].slice.call(home.children).filter(function (el) {
                    return el.classList.contains('vo-collapsed');
                });
                if (!hidden.length) return;

                var $g = $('<div class="vo-g"></div>').data('home', home).appendTo(me.$pop);
                hidden.forEach(function (el) {
                    $g[0].appendChild(el);
                    /* We remove the class already in the popover: it means "does not fit
                       in the row", and here the control must be visible. relayout
                       will put it back on closing. The move and the removal go in
                       one task, there is no intermediate frame. */
                    el.classList.remove('vo-collapsed');
                });
                moved += hidden.length;
            });

            if (!moved) { this.$pop.empty(); return; }
            this.el.addClass('vo-of-open');
            this.placeOverflow();
        },

        placeOverflow: function () {
            if (!this.el || !this.el.hasClass('vo-of-open')) return;
            var width = document.documentElement.clientWidth;
            // Keep the popup anchored to More while fitting it inside the viewport.
            this.$pop.css({right: 0, maxWidth: Math.min(420, Math.max(0, width - 16)) + 'px'});
            // offsetWidth excludes the popup's opening scale animation.
            var right = this.$moreWrap[0].getBoundingClientRect().right;
            var left = right - this.$pop[0].offsetWidth;
            var shift = Math.max(8 - left, Math.min(0, width - 8 - right));
            if (shift) this.$pop.css('right', -shift + 'px');
        },

        closeOverflow: function () {
            if (this.hints) this.hints.hide();
            if (!this.el || !this.el.hasClass('vo-of-open')) return;
            /* We return each control to its group. We hid by a suffix from the
               end, so the order is restored by a simple appendChild —
               there is nothing to sort, and the threshold classes by which we sorted
               before no longer exist. */
            this.$pop.children('.vo-g').each(function () {
                var home = $(this).data('home');
                while (this.firstChild) home.appendChild(this.firstChild);
            });
            this.$pop.empty();
            this.el.removeClass('vo-of-open');
            this.relayout();
        },

        /* --- Collapsing by measurement ---------------------------------------- */
        /* We show everything, take honest widths, compute by arithmetic, then
           apply the result once. So a recalculation costs a couple of
           forced layouts, not one per every hidden control. */

        relayout: function () {
            if (this.hints) this.hints.hide();
            /* The flag is a safeguard against synchronous re-entry: relayout is called
               directly too, not only by the observer (closeOverflow, font
               readiness). What saves from an observer loop is not it: the
               ResizeObserver callbacks are delivered in the rendering update phase, not
               reentrantly, so _busy at the entry from there is never
               true. There is no loop because the recalculation result does not affect its
               input: avail does not depend on the visibility of "…" — for the time of measuring it is
               always hidden, while its width and gap are added by need(), —
               and the second pass gives the same n. Do not make avail dependent on the
               result. (Before, "…" was located in .vo-tb-end, which we
               also observe, and its toggling normally gave a second pass;
               now it is in the row, and does not change the cluster width.) */
            if (this._busy || !this.el) return;
            /* With an open popover the controls are physically located in it, measuring the
               row is pointless. We recalculate on closing. */
            if (this.el.hasClass('vo-of-open')) {
                this.placeOverflow();
                return;
            }

            this._busy = true;
            try {
                var bar = this.el[0];
                /* The panel is hidden (focus mode, view mode): clientWidth
                   is zero, avail would go negative and we would record a knowingly
                   false state — everything collapsed with "…" visible. It heals itself
                   on showing, but making an extra forced layout for
                   garbage is pointless. */
                if (!bar.clientWidth) return;
                var cs = window.getComputedStyle(bar);
                var gapGroup = parseFloat(cs.columnGap || cs.gap) || 0;
                /* A flat list of the tail controls in visual order — what
                   the whole calculation below operates on. The core (up to .vo-of) does not
                   collapse. We take direct descendants of groups, not a list of
                   types: a control may be wrapped (a button with a popover —
                   .vo-pop-wrap), and a list would miss the wrapper,
                   hiding the inside instead of it.
                   We rebuild on every recalculation, not once in build:
                   a snapshot would not see a control added to the tail later —
                   and nobody would measure and hide it, that is, the row would silently
                   overflow. The promise "adding a control
                   breaks nothing else" otherwise holds only until the end of
                   build. (The former edition gave a live example here —
                   "the right corner is completed exactly this way" with references to two
                   lines of CompactShell.js. The example went stale together with the button
                   "Object properties", and both references moreover moved into
                   other methods. The conclusion of the paragraph did not change from this, but
                   there are no line numbers of the neighboring file here anymore: they go stale
                   the fastest.)
                   Here the nodes are guaranteed to be home: above is the exit at an
                   open popover, and the move into it and the clearing of the
                   vo-of-open flag go in one synchronous task — an observer
                   callback will not wedge in between. */
                var items = this.items = this.$of.find('.vo-g > *').get();
                var i;

                /* 1. Show everything and take the widths. */
                for (i = 0; i < items.length; i++) items[i].classList.remove('vo-collapsed');
                this.$of.removeClass('vo-collapsed').children('.vo-g').removeClass('vo-collapsed');
                /* We hide and measure the "…" wrapper, not the button itself: the row
                   element is the wrapper, and only its display:none throws "…" out of
                   the layout together with the gap. Having hidden the button inside, we
                   would leave a rendered wrapper of zero width in the row, and
                   fixedWidth would count an extra inter-group gap for it —
                   the row would undercount 13 px. They have a shared width: the wrapper
                   wraps the button, the popover in it is absolute. */
                var moreEl = this.$moreWrap[0];
                moreEl.classList.remove('vo-collapsed');

                var w = [];
                for (i = 0; i < items.length; i++) {
                    w[i] = items[i].getBoundingClientRect().width;
                }
                var moreW = moreEl.getBoundingClientRect().width;
                var gapItem = this.gapItem();

                /* 2. How much room there is for the tail. "…" is hidden for the time of measuring:
                   both its width and its gap are added by need(). We hide rather than
                   subtract: display:none throws the element out of the layout
                   together with the gap, and fixedWidth does not have to know where
                   "…" is located now. Before, it was inside the right
                   cluster and subtracting it from there was impossible altogether. */
                moreEl.classList.add('vo-collapsed');
                var avail = bar.clientWidth
                          - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
                          - this.fixedWidth(gapGroup);
                moreEl.classList.remove('vo-collapsed');

                /* 3. How much is needed if the first n controls are shown. */
                var need = function (n, withMore) {
                    var total = 0, groups = 0, prevGroup = null, inGroup = 0;
                    for (var k = 0; k < n; k++) {
                        var g = items[k].closest('.vo-g');
                        if (g !== prevGroup) { groups++; prevGroup = g; inGroup = 0; }
                        total += w[k] + (inGroup ? gapItem : 0);
                        inGroup++;
                    }
                    total += Math.max(0, groups - 1) * gapGroup;
                    /* "…" is a separate row element (it was taken out of
                       the right cluster), so it costs both its own width and
                       one more inter-group gap. fixedWidth has neither
                       of them: there it is hidden and does not take part in the layout.
                       While "…" lived inside the cluster, the gap
                       belonged to the cluster and adding it was not allowed — if it is returned
                       there, this term must be removed back. */
                    if (withMore) total += moreW + gapGroup;
                    return total;
                };

                /* 4. Everything fits — "…" is not needed. */
                var n = items.length;
                var withMore = false;
                if (need(n, false) > avail) {
                    withMore = true;
                    while (n > 0 && need(n, true) > avail) n--;
                }

                /* 5. Apply. */
                for (i = n; i < items.length; i++) items[i].classList.add('vo-collapsed');
                moreEl.classList.toggle('vo-collapsed', !withMore);
                this.syncGroups();
            } finally {
                this._busy = false;
            }
        },

        /* A group that has no visible controls left is hidden entirely:
           its separator is drawn via ::before and would otherwise hang in the air.
           The tail itself has the same separator (.vo-g + .vo-of::before),
           so an emptied tail is hidden the same way — otherwise at narrow widths
           a stick hangs in the row next to an empty place. */
        syncGroups: function () {
            var live = 0;
            this.$of.children('.vo-g').each(function () {
                var vis = false, kids = this.children;
                for (var i = 0; i < kids.length; i++) {
                    if (!kids[i].classList.contains('vo-collapsed')) { vis = true; break; }
                }
                this.classList.toggle('vo-collapsed', !vis);
                if (vis) live++;
            });
            this.$of.toggleClass('vo-collapsed', live === 0);
        },

        /* The gap between controls inside a group — from the live style, not
           a constant: the value is located in LESS and may change. */
        gapItem: function () {
            var g = this.$of.children('.vo-g')[0];
            if (!g) return 0;
            var cs = window.getComputedStyle(g);
            return parseFloat(cs.columnGap || cs.gap) || 0;
        },

        /* The width of everything that does not collapse: the core, the right corner and the gaps
           between them. It is called with "…" hidden, so it does not get here
           either by width or by gap — both are added by
           need(). */
        fixedWidth: function (gapGroup) {
            var total = 0, n = 0;
            var kids = this.el.children();
            for (var i = 0; i < kids.length; i++) {
                var el = kids[i];
                /* The tail is counted separately. */
                if (el === this.$of[0]) continue;
                /* The prohibition mask is not a row element but a layer OVER it. It is
                   a direct child of #vo-tb and stretched left:0/right:0, that is
                   its getBoundingClientRect().width equals the width of the whole panel.
                   Having got into this sum, it took avail negative: n fell to
                   zero, and the whole tail — font, font size, B/I/U, colors,
                   alignment, lists, insert — was marked vo-collapsed.
                   Of the panel there remained the service group and "…", and it held
                   until the next recalculation. It fired on the very first
                   width change under an editing prohibition (window resize, opening
                   the comments panel) and even without the user's participation —
                   build() is subscribed to document.fonts.ready. */
                if (el.classList.contains('vo-tb-mask')) continue;
                /* We skip by renderedness, not by width. display:none
                   falls out of the layout together with its gap, while
                   a rendered group of zero width (all its controls hidden)
                   still takes the gap. Having skipped it by width, the row
                   would undercount 13 px and overflow by exactly that. */
                if (!el.getClientRects().length) continue;
                total += el.getBoundingClientRect().width; n++;
            }
            /* Gaps: between all non-collapsible ones plus one before the tail. */
            return total + n * gapGroup;
        },

        /* --- Primitives ----------------------------------------------------- */

        /* A catalog command by the menu bar item key. The button is disabled by its own prohibition
           mask (setLocked), like the stock code does — the catalog only executes. */
        run: function (k, args) {
            var da = DE.Views.DocumentActions;
            if (da && typeof da.runCommand === 'function') da.runCommand(k, args);
        },

        group: function (items, cls) {
            var $g = $('<div class="vo-g"></div>').addClass(cls || '');
            items.forEach(function (i) { $g.append(i); });
            return $g;
        },

        iconBtn: function (name, title, handler) {
            return $('<button type="button" class="vo-ib"></button>')
                .attr('title', title).html(svg(name))
                .on('click', function (e) { e.preventDefault(); handler(e); });
        },

        /* A dropdown button: the glyph and the chevron as DIFFERENT nodes.
           The glyph reflects the state and so is redrawn by a callback
           (setAlign, setListType). Were the chevron inside the same html — the first
           callback would erase it, and the button would silently stop reading as
           a dropdown. Hence setDropIcon, which touches only .vo-drop-i. */
        dropBtn: function (icon, title) {
            return $('<button type="button" class="vo-ib vo-drop"></button>')
                .attr('title', title)
                .append($('<span class="vo-drop-i"></span>').html(svg(icon)))
                .append($('<span class="vo-drop-c"></span>').html(svg('chevron', 16)));
        },

        setDropIcon: function ($btn, icon) {
            $btn && $btn.children('.vo-drop-i').html(svg(icon));
        },

        /* A popover list row: an icon on the left, a caption on the right. */
        popItem: function (icon, text, handler) {
            var $it = $('<button type="button" class="vo-pop-item"></button>');
            /* There may be no icon: value lists (zoom, font, font size) are
               captions without glyphs, and an empty cell for an icon would leave
               an extra indent on the left in them. */
            if (icon) $it.append($('<span class="vo-pop-i"></span>').html(svg(icon)));
            return $it
                .append($('<span></span>').text(text))
                .append(checkNode())
                .on('click', function (e) { e.stopPropagation(); handler(e); });
        },

        /* The button wiring with a popover: opening, closing neighbors, closing on
           a click elsewhere. The same for alignment and lists, so it is here. */
        wrapPop: function ($wrap, $btn, $pop) {
            var me = this;
            $btn.on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var open = !$wrap.hasClass('open');
                me.closeSurfaces($wrap);
                $wrap.toggleClass('open', open);
            });
            $pop.on('click', function (e) { e.stopPropagation(); });
            $(document).on('click', function () { $wrap.removeClass('open'); });
            return $wrap.append($btn).append($pop);
        },

        textBtn: function (label, title, cls, handler) {
            return $('<button type="button" class="vo-ib vo-tx"></button>')
                .addClass(cls).attr('title', title).text(label)
                .on('click', function (e) { e.preventDefault(); handler(e); });
        },

        /* A value list: zoom, font, font size. Before, these were native
           <select>. Their dropdown is drawn by the OS, and CSS does not reach it with a single
           property — to bring it to AIR was possible only by replacing the control.

           The keyboard is carried over entirely, otherwise the replacement would be an exchange of look for
           workability: <select> itself knew arrows, Home/End, typing by
           letters and announcing a role with a value, and none of our popovers
           can do this so far.

           The pattern is activedescendant: focus stays on the button, while the "active"
           row is marked with a class and aria-activedescendant. This way there is no need to
           manage focus inside a popover that moves into "…" together
           with the control: moving a node between parents would drop focus.

           The accessible name of the control is set in aria-label. The hint text
           is passed via title: ToolbarHints moves it into data-vo-hint,
           so that the browser does not show a second hint. */
        /* The SDK on #viewport cancels the legacy wheel. We stop it locally,
           leaving scrolling to the browser; modifiers pass by the former route. */
        bindPopoverScroll: function ($pop) {
            var contained = null, previous = [];
            var axes = ['overscroll-behavior-x', 'overscroll-behavior-y'];
            function onWheel(e) {
                if (contained) {
                    axes.forEach(function (axis, i) {
                        if (previous[i].value) contained.style.setProperty(axis, previous[i].value, previous[i].priority);
                        else contained.style.removeProperty(axis);
                    });
                    contained = null;
                }
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                e.stopPropagation();

                var node = e.target.nodeType === 1 ? e.target : e.target.parentElement;
                while (node && $pop[0].contains(node)) {
                    var style = window.getComputedStyle(node);
                    if ((/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight) ||
                        (/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth)) {
                        contained = node;
                        previous = axes.map(function (axis) {
                            return {value: node.style.getPropertyValue(axis), priority: node.style.getPropertyPriority(axis)};
                        });
                        /* We enable it only for an ordinary wheel: at the edge native scroll
                           does not pass to the parent, even with a large touchpad delta. */
                        axes.forEach(function (axis) { node.style.setProperty(axis, 'contain', 'important'); });
                        return;
                    }
                    if (node === $pop[0]) break;
                    node = node.parentElement;
                }
                /* A short list has no native scroll target; the wheel over it
                   still must not scroll the document/outer page. */
                e.preventDefault();
            }
            ['wheel', 'mousewheel', 'DOMMouseScroll'].forEach(function (name) {
                $pop[0].addEventListener(name, onWheel, {passive: false});
            });
        },

        valueBtn: function (cls, title, options, handler) {
            var me = this;
            var uid = 'vo-val-' + (++VALUE_UID);

            /* The width class is put on the wrapper, not on the button: the wrapper is
               what is located in the row and what relayout counts, and what goes
               entirely into "…". The button inside stretches to its full width. */
            var $wrap = $('<span class="vo-pop-wrap vo-value"></span>').addClass(cls);
            var $btn = $('<button type="button" class="vo-ib vo-value-btn"></button>')
                .attr({title: title, 'aria-label': title,
                       'aria-haspopup': 'listbox', 'aria-expanded': 'false'});
            var $label = $('<span class="vo-value-label"></span>').appendTo($btn);
            $btn.append($('<span class="vo-value-caret"></span>').html(svg('chevron', 16)));

            var $pop = $('<div class="vo-pop vo-pop-list vo-pop-value"></div>')
                .attr({role: 'listbox', id: uid, 'aria-label': title});
            this.bindPopoverScroll($pop);

            var cur = null, open = false, hi = -1, buf = '', bufAt = 0;

            /* Without this the keyboard does not work at all, and it is not about handlers.
               The engine holds a hidden <textarea> and synchronously returns focus
               to it: measured on 09.09 — `btn.focus()` does not leave focus on
               the button even for a frame, and this is true not only for new controls but
               also for "Bold", that is, for the whole panel. The stock editor
               for the time of its surfaces silences the interception through
               asc_enableKeyEvents (18 stock files, for example
               app/view/FileMenu.js:396) — the shell never called it.

               We keep the silencing tied to the button FOCUS, not to the openness
               of the list: then Esc leaves focus on the button, as the native
               <select> did, and does not give it to the document. We turn it back on at
               blur — and also as a safeguard on closing, because leaving the
               interception off means making the document unable to receive typed input. */
            function keys(on) {
                var api = me.api;
                if (api && typeof api.asc_enableKeyEvents === 'function') {
                    api.asc_enableKeyEvents(on);
                }
            }
            function focused() {
                return $btn[0].ownerDocument.activeElement === $btn[0];
            }

            var items = options.map(function (o, i) {
                var $it = me.popItem(null, o.t, function () { pick(i); })
                    .attr({role: 'option', id: uid + '-' + i, 'aria-selected': 'false'});
                $pop.append($it);
                return {v: String(o.v), t: String(o.t), $el: $it};
            });

            function curIndex() {
                for (var i = 0; i < items.length; i++) if (items[i].v === cur) return i;
                return -1;
            }

            function setHi(i) {
                if (hi >= 0 && items[hi]) items[hi].$el.removeClass('hi');
                hi = i;
                if (i < 0 || !items[i]) { $btn.removeAttr('aria-activedescendant'); return; }
                items[i].$el.addClass('hi');
                $btn.attr('aria-activedescendant', uid + '-' + i);
                var el = items[i].$el[0];
                if (el.scrollIntoView) el.scrollIntoView({block: 'nearest'});
            }

            function setOpen(v) {
                if (open === v) { $wrap.toggleClass('open', v); return; }
                open = v;
                $wrap.toggleClass('open', v);
                $btn.attr('aria-expanded', v ? 'true' : 'false');
                if (v) { keys(false); $btn.focus(); return; }
                setHi(-1);
                /* Focus could have gone away together with closing (a click elsewhere). Then blur
                   will no longer come, and the interception must come back. */
                if (!focused()) keys(true);
            }

            /* We show the caption even when the value is not in the list:
               the engine also sends a fractional zoom (fit to width or to
               page), and a font that is not in our eight. The former
               setOption appended an <option> for this; here a caption
               without a selected row is enough. */
            function setCur(v, label) {
                cur = (v === null || v === undefined) ? null : String(v);
                var hit = -1;
                items.forEach(function (it, i) {
                    var on = it.v === cur;
                    it.$el.toggleClass('on', on).attr('aria-selected', on ? 'true' : 'false');
                    if (on) hit = i;
                });
                $label.text(hit >= 0 ? items[hit].t
                                     : (label != null ? String(label) : (cur == null ? '' : cur)));
            }

            /* Choosing a value is the completion of editing, and focus must return to
               the document. Otherwise the keyboard interception stays off (it is
               turned off by mousedown on the button, and blur does not come on choosing):
               the document is unable to receive typed input, and presses go to the button, where
               a printable character OPENS the list again — instead of text the person
               gets a cycling of values. Measured: 2 of 6 attempts
               succeeded before the fix.

               We hand it over by the stock path: edit:complete calls DocumentHolder.focus()
               (controller/Main.js:1065). The same technique in this shell already
               closes the hyperlink dialog. We do not return focus to the button —
               the document takes it right back, and an extra focus() would only give
               the button a frame with keypresses.

               Escape does not go here deliberately: there focus stays on the button, as
               in a native <select>, — the reason is at keys() above. */
            function pick(i) {
                if (!items[i]) return;
                setCur(items[i].v);
                setOpen(false);
                handler(items[i].v);
                keys(true);
                if (window.Common && Common.NotificationCenter) {
                    Common.NotificationCenter.trigger('edit:complete');
                }
            }

            /* Typing by letters, as in <select>: while letters come in a row, we search by
               the accumulated string; a repeat of one letter steps through the matches. */
            function typeAhead(ch) {
                var now = Date.now();
                buf = (now - bufAt < 800) ? buf + ch : ch;
                bufAt = now;
                var low = buf.toLowerCase();
                var step = buf.length > 1 ? 0 : 1;
                var from = hi >= 0 ? hi : (curIndex() >= 0 ? curIndex() : 0);
                for (var n = 0; n < items.length; n++) {
                    var i = (from + step + n) % items.length;
                    if (items[i].t.toLowerCase().indexOf(low) === 0) { setHi(i); return; }
                }
            }

            $btn.on('keydown', function (e) {
                var k = e.key;
                /* A press with a modifier does not belong to the list: after a choice with
                   the mouse focus stays on the button (pick), and Ctrl+Z / Ctrl+B
                   would otherwise open the list with preventDefault instead of their own
                   command.

                   We check modifiers ONCE and at the entry, not with a prefix
                   on a separate branch. The prefix was the defect: it
                   cut off a printable character, while Enter and
                   Space standing with it in the same if did not, although the engine has its own commands recorded for them
                   (sdkjs/word/Editor/Shortcuts.js, c_oAscDefaultShortcuts:
                   InsertPageBreak — Ctrl+Enter, InsertColumnBreak —
                   Ctrl+Shift+Enter, NonBreakingSpace — Ctrl+Shift+Space,
                   ResetChar — Ctrl+Space, LittleMoveObject — Ctrl+arrow).
                   The same form already exists in the fork — in SlashMenu, the printable
                   character branch in onKeyOpen.

                   WHERE WE ARE WIDER THAN THE STOCK CODE, so that nobody compares line by line and "fixes"
                   it back. The stock gate is `!this.isMenuOpen() && !e.ctrlKey`
                   (lib/component/ComboBoxFonts.js, onInputKeyDown): it suppresses
                   ONLY opening the menu, with an open menu it does not look at the modifier
                   at all, and it checks one ctrlKey. Ours is placed at the entry
                   and closes both states, plus metaKey and altKey. This is
                   deliberate: in the stock code with an open menu Ctrl+Enter
                   is eaten by the list, and this is the very defect for which the
                   edit was made — there is no need to repeat it. The stock code simply did not think about cmd on macOS
                   and Alt: it has an input field, and we have a
                   button on which focus stays after a choice with the mouse.

                   We do not check Shift: it gives the capital letter, and the stock code
                   does not have it in the gate either. */
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                var typed = !!(k && k.length === 1);
                if (!open) {
                    /* A printable character also opens the list — but only
                       highlights the match, and does not apply it. A native
                       <select> would apply at once; on fonts this would mean
                       cycling through the document's typefaces letter by letter. */
                    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' ||
                        k === ' ' || k === 'Spacebar' || typed) {
                        e.preventDefault();
                        me.closeSurfaces($wrap);
                        setOpen(true);
                        setHi(curIndex() >= 0 ? curIndex() : 0);
                        if (typed && k !== ' ') typeAhead(k);
                    }
                    return;
                }
                if (k === 'Escape')    { e.preventDefault(); setOpen(false); $btn.focus(); return; }
                if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
                    e.preventDefault(); pick(hi >= 0 ? hi : curIndex()); return;
                }
                if (k === 'ArrowDown') { e.preventDefault(); setHi(Math.min(items.length - 1, hi + 1)); return; }
                if (k === 'ArrowUp')   { e.preventDefault(); setHi(Math.max(0, hi - 1)); return; }
                if (k === 'Home')      { e.preventDefault(); setHi(0); return; }
                if (k === 'End')       { e.preventDefault(); setHi(items.length - 1); return; }
                if (k === 'Tab')       { setOpen(false); return; }
                if (typed) { e.preventDefault(); typeAhead(k); }
            });

            /* mousedown, not focus: the engine returns focus to itself earlier than the
               focus event reaches us, — the interception must be silenced before
               focus has moved at all. */
            $btn.on('mousedown', function () { keys(false); });
            $btn.on('blur', function () { keys(true); setOpen(false); });

            $btn.on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var want = !open;
                me.closeSurfaces($wrap);
                setOpen(want);
                if (want) setHi(curIndex() >= 0 ? curIndex() : 0);
            });

            /* A click inside the popover must not bubble to document: there hang
               both our closing and closeOverflow — while the control is in "…",
               a bubbled click would take it home right in the middle of a choice.
               And mousedown is suppressed so that a click on a row does not take focus from the button:
               otherwise blur would close the list before the click reaches the row.
               The same technique as for the "/" menu (SlashMenu, mousedown on an item). */
            $pop.on('mousedown', function (e) { e.preventDefault(); });
            $pop.on('click', function (e) { e.stopPropagation(); });
            $(document).on('click', function () { setOpen(false); });

            $wrap.append($btn).append($pop);
            /* A handle for setOption and closePopovers: from outside the control is seen
               as a node, while its state lives in a closure. */
            $wrap.data('voValue', {set: setCur, close: function () { setOpen(false); }});
            this._values.push($wrap);
            return $wrap;
        },

        /* The font size: an input field with a list. The value is typed from the keyboard — "10,5" or
           "13" — and it is applied on Enter and on leaving the field; the list is opened
           by the chevron or the down arrow. An invalid value is not applied: the current
           font size returns to the field. Valid is the same as for the stock font size field
           (controller/Toolbar.js, onFontSizeChanged): a number with a dot or comma
           from 1 to 300, in steps of 0.5. Out of range is invalid, not clamped
           to the boundary: a clamped value would not be what was entered.

           The engine keyboard is held by the field while it has focus (like the value list),
           and given back on leaving — except leaving into the menu bar by F10: there it is held by the
           menu bar, and Escape will return focus here with the entered value. */
        sizeBox: function () {
            var me = this;
            var uid = 'vo-val-' + (++VALUE_UID);
            var title = this.tipFontSize;

            /* The field and the chevron are neighbors in one box: a field inside <button> would be
               invalid markup. The chevron is a row button (the "Font size" hint),
               but not a Tab stop: the list is opened by the down arrow in the field too.
               The look of the box, field and chevron — by the vo-size-* classes (compact-shell.less). */
            var $wrap = $('<span class="vo-pop-wrap vo-value vo-w-size vo-size"></span>');
            var $box = $('<span class="vo-value-btn vo-size-box"></span>');
            var $input = $('<input type="text" class="vo-value-label vo-size-input" autocomplete="off" spellcheck="false">')
                .attr({role: 'combobox', 'aria-label': title, inputmode: 'decimal',
                       'aria-autocomplete': 'none', 'aria-expanded': 'false', 'aria-controls': uid});
            var $caret = $('<button type="button" class="vo-ib vo-size-caret" tabindex="-1"></button>')
                .attr('title', title)
                .append($('<span class="vo-value-caret"></span>').html(svg('chevron', 16)));
            $box.append($input).append($caret);

            var $pop = $('<div class="vo-pop vo-pop-list vo-pop-value"></div>')
                .attr({role: 'listbox', id: uid, 'aria-label': title});
            this.bindPopoverScroll($pop);

            var cur = null, open = false, hi = -1;

            function keys(on) {
                var api = me.api;
                if (api && typeof api.asc_enableKeyEvents === 'function') api.asc_enableKeyEvents(on);
            }

            var items = FONT_SIZES.map(function (n, i) {
                var $it = me.popItem(null, String(n), function () { pick(i); })
                    .attr({role: 'option', id: uid + '-' + i, 'aria-selected': 'false'});
                $pop.append($it);
                return {v: n, $el: $it};
            });

            function setHi(i) {
                if (hi >= 0 && items[hi]) items[hi].$el.removeClass('hi');
                hi = i;
                if (i < 0 || !items[i]) { $input.removeAttr('aria-activedescendant'); return; }
                items[i].$el.addClass('hi');
                $input.attr('aria-activedescendant', uid + '-' + i);
                var el = items[i].$el[0];
                if (el.scrollIntoView) el.scrollIntoView({block: 'nearest'});
            }

            function curIndex() {
                for (var i = 0; i < items.length; i++) if (items[i].v === cur) return i;
                return -1;
            }

            function setOpen(v) {
                open = v;
                $wrap.toggleClass('open', v);
                $input.attr('aria-expanded', v ? 'true' : 'false');
                if (!v) setHi(-1);
            }

            /* keep — do not touch what is typed: a value from the engine, while the field is being typed in. */
            function setCur(v, keep) {
                var n = parseFloat(v);
                cur = isNaN(n) ? null : n;
                items.forEach(function (it) {
                    var on = it.v === cur;
                    it.$el.toggleClass('on', on).attr('aria-selected', on ? 'true' : 'false');
                });
                if (!keep) $input.val(cur === null ? '' : String(cur));
            }

            /* The entered → the font size or null if the value is invalid. */
            function parse(text) {
                var m = /^\s*\+?(\d*[.,]?\d+|\d+[.,]?)\s*$/.exec(String(text || ''));
                if (!m) return null;
                var n = parseFloat(m[1].replace(',', '.'));
                if (isNaN(n) || n < 1 || n > 300) return null;
                return Math.floor((n + 0.4) * 2) / 2;
            }

            function apply(n) {
                setCur(n);
                me.api.put_TextPrFontSize(n);
            }

            /* Apply the entered: the same value — nothing, an invalid one — return
               the current. */
            function commit() {
                var text = $input.val();
                if (cur !== null && text === String(cur)) return false;
                var n = parse(text);
                if (n === null) { setCur(cur); return false; }
                apply(n);
                return true;
            }

            function done() {
                keys(true);
                if (window.Common && Common.NotificationCenter) Common.NotificationCenter.trigger('edit:complete');
            }

            function pick(i) {
                if (!items[i]) return;
                setOpen(false);
                apply(items[i].v);
                done();
            }

            $input.on('mousedown focus', function () { keys(false); });
            $input.on('focus', function () { this.select && this.select(); });
            $input.on('keydown', function (e) {
                var k = e.key;
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                if (k === 'ArrowDown' || k === 'ArrowUp') {
                    e.preventDefault();
                    if (!open) {
                        me.closeSurfaces($wrap);
                        setOpen(true);
                        setHi(curIndex() >= 0 ? curIndex() : 0);
                        return;
                    }
                    setHi(k === 'ArrowDown' ? Math.min(items.length - 1, hi + 1) : Math.max(0, hi - 1));
                    return;
                }
                if (k === 'Enter') {
                    e.preventDefault();
                    if (open && hi >= 0) { pick(hi); return; }
                    setOpen(false);
                    commit();
                    done();
                    return;
                }
                if (k === 'Escape' && open) { e.preventDefault(); setOpen(false); return; }
                if (k === 'Escape') { e.preventDefault(); setCur(cur); done(); return; }
                if (k === 'Tab') setOpen(false);
            });
            $input.on('blur', function (e) {
                setOpen(false);
                commit();
                var to = e.relatedTarget;
                if (!to || !$(to).closest('.vo-mn').length) keys(true);
            });

            $caret.on('mousedown', function (e) { e.preventDefault(); keys(false); });
            $caret.on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var want = !open;
                me.closeSurfaces($wrap);
                setOpen(want);
                if (want) { setHi(curIndex() >= 0 ? curIndex() : 0); $input.focus(); }
            });

            $pop.on('mousedown', function (e) { e.preventDefault(); });
            $pop.on('click', function (e) { e.stopPropagation(); });
            $(document).on('click', function () { setOpen(false); });

            $wrap.append($box).append($pop);
            $wrap.data('voValue', {
                set: function (v) { setCur(v, document.activeElement === $input[0]); },
                close: function () { setOpen(false); }
            });
            this._values.push($wrap);
            return $wrap;
        },

        /* --- Headings ------------------------------------------------------ */
        /* The button shows the current paragraph style, the list — four levels.
           The other paragraph styles of the document are located below, behind a thin
           line: throwing them out is not allowed — the table of contents and the
           markup of other people's DOCX rely on them — but they must not interfere with choosing a heading either. */

        headingBtn: function () {
            var me = this;
            var $wrap = $('<span class="vo-pop-wrap vo-heading"></span>');
            var $btn  = $('<button type="button" class="vo-ib vo-heading-btn"></button>')
                .attr('title', this.tipParagraphStyle);
            var $pop  = $('<div class="vo-pop vo-pop-list vo-pop-rich"></div>');
            this.bindPopoverScroll($pop);

            this.ctrl.headingBtn = $btn;
            this.ctrl.headingPop = $pop;
            this.ctrl.headingItems = {};

            HEADINGS().forEach(function (h) {
                $pop.append(me.headingItem(h.style, h.t, h.d, h.icon, $wrap, h.k));
            });

            /* The place where the other paragraph styles of the document will arrive, when
               the engine sends them (asc_onInitEditorStyles). */
            this.ctrl.headingRest = $('<div class="vo-pop-rest"></div>').appendTo($pop);

            $btn.on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var open = !$wrap.hasClass('open');
                me.closeSurfaces($wrap);
                $wrap.toggleClass('open', open);
            });
            $pop.on('click', function (e) { e.stopPropagation(); });
            $(document).on('click', function () { $wrap.removeClass('open'); });

            this.setHeading('Normal');
            $wrap.append($btn).append($pop);
            return $wrap;
        },

        /* The four levels are items of "Format → Paragraph styles ▸" (k), the other styles
           of the document are not in the menu and are set by the stock put_Style. */
        headingItem: function (style, title, desc, icon, $wrap, k) {
            var me = this;
            var $item = $('<button type="button" class="vo-pop-item"></button>')
                .on('click', function (e) {
                    e.stopPropagation();
                    $wrap.removeClass('open');
                    if (k) me.run('format.style.' + k);
                    else me.api.put_Style(style);
                });

            if (icon) {
                $item.append($('<span class="vo-pop-box"></span>').html(svg(icon)));
            }
            var $text = $('<span class="vo-pop-text"></span>')
                .append($('<span class="vo-pop-t"></span>').text(title));
            if (desc) $text.append($('<span class="vo-pop-d"></span>').text(desc));

            $item.append($text).append(checkNode());
            this.ctrl.headingItems[style] = $item;
            return $item;
        },

        /* We take the translation of the internal style name where the stock ribbon does:
           the table is built in controller/Main.js:112-171. */
        styleLabel: function (name) {
            var main = DE.getController('Main');
            var table = main && main.translationTable;
            return (table && table[name]) || name;
        },

        setHeading: function (name) {
            var known = this.ctrl.headingItems || {};
            Object.keys(known).forEach(function (k) {
                known[k].toggleClass('on', k === name);
            });
            if (!this.ctrl.headingBtn) return;
            this.ctrl.headingBtn
                .empty()
                .append($('<span class="vo-heading-label"></span>').text(this.styleLabel(name)))
                .append($('<span class="vo-heading-caret"></span>').html(svg('chevron')));
        },

        /* Alignment in one button. The glyph shows the current value —
           so the button is also an indicator, which four separate buttons
           did not give: one of the four was highlighted there, and the eye each time
           searched which. */
        alignBtn: function () {
            var me = this;
            var $wrap = $('<span class="vo-pop-wrap vo-align"></span>');
            var $btn  = this.dropBtn('alignL', this.tipAlignment);
            var $pop  = $('<div class="vo-pop vo-pop-list"></div>');
            this.bindPopoverScroll($pop);

            this.ctrl.align = {};
            ALIGN().forEach(function (a) {
                var $item = me.popItem(a.icon, a.t, function () {
                    $wrap.removeClass('open');
                    me.run('format.align.' + a.k);
                });
                me.ctrl.align[a.v] = $item;
                $pop.append($item);
            });

            this.ctrl.alignBtn = $btn;
            return this.wrapPop($wrap, $btn, $pop);
        },

        /* Line spacing is a button of its own right after the alignment. The list holds
           exactly the submenu "Format → Spacing ▸" of the catalog in its order: values,
           spacing before and after the paragraph, "Other spacing and indents…". The rows
           and their captions are taken from the items on every opening: the "before" and
           "after" caption says whether the item will add or remove the spacing. The current
           value is marked (setLineSpacing). An item without a stock call in this build
           is not drawn: the button does not promise what it will not do. */
        spacingBtn: function () {
            var me = this, da = DE.Views.DocumentActions;
            var menu = da && typeof da.command === 'function' ? da.command('format.spacing') : null;
            /* The row is rebuilt on a mode change: we do not keep the marks of the previous build. */
            this.ctrl.lineItems = {};
            this.ctrl.spacingBtn = null;
            if (!menu || !menu.items || typeof this.api.put_PrLineSpacing !== 'function') return null;

            var $wrap = $('<span class="vo-pop-wrap vo-spacing"></span>');
            var $btn  = this.dropBtn('lineh', this.tipLineSpacing);
            var $pop  = $('<div class="vo-pop vo-pop-list"></div>');
            this.bindPopoverScroll($pop);

            var rows = [];
            menu.items.forEach(function (it) {
                if (!it || it.sep) {
                    if ($pop.children().length) $pop.append($('<div class="vo-pop-sep"></div>'));
                    return;
                }
                if (it.needs && typeof me.api[it.needs] !== 'function') return;
                var $item = me.popItem(null, '', function () {
                    $wrap.removeClass('open');
                    me.run(it.k);
                });
                $item.attr('data-k', it.k);
                rows.push({it: it, $el: $item});
                var value = /^format\.spacing\.(\d+)$/.exec(it.k);
                if (value) me.ctrl.lineItems[String(parseInt(value[1], 10) / 100)] = $item;
                $pop.append($item);
            });

            function labels() {
                rows.forEach(function (r) {
                    var t = typeof r.it.t === 'function' ? r.it.t() : r.it.t;
                    r.$el.children('span').not('.vo-pop-check').first().text(t || '');
                });
            }
            labels();
            /* The "before" and "after" captions — by the paragraph under the cursor at the moment of
               opening: in the capture phase of the click, before the popover opens. */
            $btn[0].addEventListener('click', labels, true);

            this.ctrl.spacingBtn = $btn;
            return this.wrapPop($wrap, $btn, $pop);
        },

        /* Lists and indents in one button. The indents are here because the list level
           is changed by them: the command is about the same thing as the list itself. */
        listsBtn: function () {
            var me = this;
            var $wrap = $('<span class="vo-pop-wrap vo-lists"></span>');
            var $btn  = this.dropBtn('bullet', this.tipLists);
            var $pop  = $('<div class="vo-pop vo-pop-list"></div>');
            this.bindPopoverScroll($pop);

            this.ctrl.listItems = {};
            LISTS().forEach(function (l) {
                var $item = me.popItem(l.icon, l.t, function () {
                    $wrap.removeClass('open');
                    /* A repeated choice of the same type removes the list — this is how
                       the menu item behaves. */
                    me.run('format.lists.' + l.k);
                });
                me.ctrl.listItems[l.v] = $item;
                $pop.append($item);
            });

            /* An indent is a repeatable command: in one go it is moved by
               several levels. So these two rows do NOT close the popover,
               unlike all the others. */
            if (typeof this.api.DecreaseIndent === 'function') {
                $pop.append($('<div class="vo-pop-sep"></div>'));
                $pop.append(this.popItem('indentOut', this.textDecreaseIndent, function () {
                    me.run('format.lists.indentOut');
                }));
                $pop.append(this.popItem('indentIn', this.textIncreaseIndent, function () {
                    me.run('format.lists.indentIn');
                }));
            }

            this.ctrl.listsBtn = $btn;
            return this.wrapPop($wrap, $btn, $pop);
        },

        /* The button glyph repeats the current paragraph alignment. Only the glyph
           is redrawn: the chevron is a neighboring node and survives the callback. */
        setAlign: function (value) {
            /* null/undefined is sent by the engine when there is no alignment: the cursor is not in a
               paragraph or the selection has paragraphs with different ones. The stock code on this value
               releases all four buttons and exits (controller/Toolbar.js:667-672);
               we have one button and nothing to release — we clear the marks in the list and
               leave the previous glyph. Before, there was no branch, and the glyph silently fell
               to ALIGN()[0], that is, the button claimed an alignment that does not exist. */
            var none = (value === null || value === undefined);
            /* Further we work with the VISIBLE alignment, not the stored one: in
               an RTL paragraph these are different things, see visualAlign. */
            var shown = none ? value : this.visualAlign(value);
            Object.keys(this.ctrl.align).forEach(function (k) {
                this.ctrl.align[k].toggleClass('on', !none && parseInt(k, 10) === shown);
            }, this);
            if (none) return;

            var found = ALIGN().filter(function (a) { return a.v === shown; })[0];
            if (found) this.setDropIcon(this.ctrl.alignBtn, found.icon);
        },

        /* The stored alignment -> the visible one. In an RTL paragraph the pair "left/right"
           reads reversed: the engine stores Jc as is, but draws mirrored.
           This is visible in the engine itself — for right panels it swaps Jc
           under Bidi right in UpdateParagraphProp (sdkjs/word/api.js:2236-2243),
           while into the asc_onPrAlign callback it gives the value UNSUBSTITUTED (:2226).
           So the substitution in the reverse reading is made by every consumer itself, and
           the stock code too: with right direction btnAlignRight is highlighted at
           v===1, not at 0 (controller/Toolbar.js:675-676).

           HOW THE STOCK CODE LEARNS THE DIRECTION: not by a subscription but by a poll —
           asc_isRtlTextDirection() right in the asc_onPrAlign handler
           (:659,661). The moment is right: both events go out in one pass of
           UpdateParagraphProp, asc_onPrAlign first, when the paragraph is already
           recalculated (api.js:2226,2244), and the poll reads the Bidi of the current paragraph
           (api.js:3596-3604). A direction change itself sends asc_onPrAlign
           again (SetParagraphBidi -> UpdateInterface, word/Editor/Document.js),
           so the mirror is re-set without a subscription to asc_onTextDirection:
           in the stock code this subscription is about something else — list and indent glyphs (:1851).
           The direction cache, as in the stock code (_state.rtlDir), is not needed here: it
           exists there only to break the comparison with the previous v, while we
           redraw on every callback.

           THIS DOES NOT TOUCH THE COMMAND, AND THAT IS DELIBERATE, not
           unfinished work: parity with the stock code, not "caption honesty". The analysis, so that
           it is not reopened.

           What the stock code does. Sending is almost direction-independent: put_PrAlign
           gets the same number that is labeled on the button (btnAlignLeft — 1,
           btnAlignRight — 0, controller/Toolbar.js). The direction there is read
           EXACTLY ONCE — in the "pressed released" branch (onHorizontalAlign,
           `if (!btn.pressed)`): the fallback goes to Left(1) in LTR and to Right(0)
           in RTL. We have no analog of this branch BY THE DESIGN OF THE UI: alignment
           here is a radio list, there is nothing to release. That is, parity is held
           by structure, not by coincidence.

           What the engine does. put_PrAlign writes the value raw
           (SetParagraphAlign, sdkjs/word/api.js), it mirrors only READING
           and only for right panels — see above.

           What the user pays for this. In an RTL paragraph a click on "Align
           right" sends 0, the paragraph sits visually on the left, and "Align
           left" is highlighted. Unpleasant — but the stock code behaves exactly the same, down
           to the same number.

           Why we do not fix it. Mirroring the sending is cheap — it would be enough to
           put_PrAlign(visualAlign(a.v)), the function is an involution on 0/1. But then
           the same paragraph in Compact and in Advanced answers an identically
           labeled control differently, and the divergence would have to be carried through
           every fork update. RTL is not declared for the shell.
           The condition for revision: a declared RTL market — then it is
           the stock code that has to be fixed, not the shell. */
        visualAlign: function (value) {
            var api = this.api, rtl = false;
            if (!api || typeof api.asc_isRtlTextDirection !== 'function') return value;
            try { rtl = !!api.asc_isRtlTextDirection(); } catch (e) { return value; }
            if (!rtl) return value;
            /* Only 0 and 1 are swapped: the center and justify do not depend
               on the direction. */
            return (value === 0) ? 1 : (value === 1) ? 0 : value;
        },

        /* The highlight of the current spacing. We compare WITH A TOLERANCE, like the stock code
           (controller/Toolbar.js:687-702): the value comes as a fraction and wobbles by
           the binary fraction error — the engine sends
           "1.0800000000000001" too (see the caveat at setOption). A strict comparison
           of strings would miss on 1.15 and 2.5, and the row would not be highlighted
           where the stock code would highlight. */
        setLineSpacing: function (value) {
            if (!this.ctrl.lineItems) return;
            Object.keys(this.ctrl.lineItems).forEach(function (k) {
                this.ctrl.lineItems[k].toggleClass('on', Math.abs(parseFloat(k) - value) < 0.0001);
            }, this);
        },

        /* The current list type by a poll, as the stock ribbon does.
           Multilevel is not distinguished: it can be told from numbered
           only by comparing presets (asc_IsCurrentNumberingPreset), and
           the stock ribbon itself does not highlight btnMultilevels by state —
           a multilevel numbered list reads as numbered in production too. */
        currentListType: function () {
            var api = this.api, F = window.Asc && Asc.c_oAscNumberingFormat;
            if (!api || !F || typeof api.asc_GetCurrentNumberingId !== 'function') return -1;
            var id = api.asc_GetCurrentNumberingId();
            if (id === null || id === undefined) return -1;
            var fmt;
            try {
                fmt = api.asc_GetNumberingPr(id).get_Lvl(api.asc_GetCurrentNumberingLvl()).get_Format();
            } catch (e) { return -1; }
            /* The split is verbatim as in the ribbon: a marker is Bullet and None with
               a live listId, everything else is numbering. */
            return (fmt === F.Bullet || fmt === F.None) ? 0 : 1;
        },

        /* The list type: the row highlight and the button glyph. No list (-1) —
           the button shows bulleted, as the initial state. */
        setListType: function (type) {
            if (!this.ctrl.listItems) return;
            var all = LISTS();
            var found = all.filter(function (l) { return l.v === type; })[0];
            this.setDropIcon(this.ctrl.listsBtn, (found || all[0]).icon);
            Object.keys(this.ctrl.listItems).forEach(function (k) {
                this.ctrl.listItems[k].toggleClass('on', parseInt(k, 10) === type);
            }, this);
        },

        /* A button with a popover: our glyph, the content is built by the passed function
           on the first opening — before that the node is not in the document, while the stock
           components require a real element. */
        popBtn: function (cfg) {
            var me = this;
            var $wrap = $('<span class="vo-pop-wrap"></span>');
            var $btn  = $('<button type="button" class="vo-ib"></button>')
                .attr('title', cfg.title).html(svg(cfg.icon));
            var $pop  = $('<div class="vo-pop"></div>');
            this.bindPopoverScroll($pop);

            $wrap.append($btn).append($pop);

            $btn.on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var open = !$wrap.hasClass('open');
                me.closeSurfaces($wrap);
                $wrap.toggleClass('open', open);
                if (open && !$wrap.data('built')) {
                    cfg.build($pop, $wrap);
                    $wrap.data('built', true);
                }
            });

            $pop.on('click', function (e) { e.stopPropagation(); });
            $(document).on('click', function () { $wrap.removeClass('open'); });

            return $wrap;
        },

        /* Close all other popup surfaces of the shell at once — not
           only the panel popovers, but also the menu bar dropdowns and the "•••" row.
           The single point lives in CompactShell: .vo-mn-drop does not belong to the
           panel, but it has to be closed when a popover opens (otherwise
           the layers live simultaneously and overlap each other).
           The argument is the toggle node: by it the shell understands that it
           is located in the "•••" row itself, and does not close it.
           Without the shell the panel keeps its former behavior. */
        closeSurfaces: function ($el) {
            var shell = DE.Views.CompactShell;
            if (shell && shell.closeSurfaces) shell.closeSurfaces($el);
            else this.closePopovers();
        },

        closePopovers: function () {
            if (this.hints) this.hints.hide();
            $('.vo-cb, .vo-pop-wrap').removeClass('open');
            /* The link popup is attached to body and does not fall under the selector above. */
            if (this._linkUI) this._linkUI.close(false);
            /* The class is not the end of it: in value lists the openness lives
               also in the closure and in aria-expanded, and removing the class bypassing them
               would desynchronize the markup from what is declared. */
            (this._values || []).forEach(function ($w) {
                var api = $w.data('voValue');
                if (api) api.close();
            });
        },

        /* The color button: our glyph, our strip and our palette.

           Before, the stock Common.UI.ThemeColorPalette was inside. It was removed
           deliberately: the popup frontend is taken from the stage editor.
           WHAT WAS LOST IN THIS, so that it is not reopened as a defect:
           the document theme colors, the standard set, recent colors and the stock
           arbitrary color window. The last one is replaced by a color code field from
           the same sample, the other three are not.

           The former <input type="color"> before the stock palette opened the dialog of the
           operating system; returning to it is not needed even more so. */

        colorBtn: function (cfg) {
            var me = this;
            var $wrap  = $('<span class="vo-cb"></span>');
            var $btn   = $('<button type="button" class="vo-ib"></button>')
                .attr('title', cfg.title).html(svg(cfg.icon));
            var $line  = $('<span class="vo-cb-line"></span>').css('background', cfg.initial);
            var $pop   = $('<div class="vo-cb-pop"></div>');
            var $reset = $('<button type="button" class="vo-cb-reset"></button>').text(cfg.resetLabel);
            /* The container no longer gets the width from JS: it is set by the grid —
               the number of columns comes in --vo-pal-cols, the sample size is set in
               LESS. The former 164/145 were the contract of the stock palette, which
               is no longer here. */
            var $host  = $('<div class="vo-cb-palette"></div>');

            /* A separator between the reset command and the values: in AIR the popover
               sections are separated by a line, and the other shell popovers are already
               built this way. Without it the "Automatic" row, having become
               full-width, would abut the grid with no gap. */
            $pop.append($reset)
                .append($('<div class="vo-cb-sep"></div>'))
                .append($host);
            $wrap.append($btn).append($line).append($pop);

            /* Showing the current color outward: both the strip and the mark in the grid live
               in a closure, and they must be driven by whoever hears the engine
               (see setTextColor). hex null — there is no color: the strip goes to
               the reset sample, the mark in the grid is removed.

               We store THE SHOWN value in cfg.value, and not for the cache: the color callback
               comes on every caret movement and every letter, while
               redrawing runs through all 84 grid samples. The stock code protects itself from the same
               by comparing with _state.clrtext (controller/Toolbar.js:3311-3327).
               The value is written both by a click on a sample and by reset — otherwise the one
               skipped would be exactly the correction after the engine refused to execute
               the command. From there the grid also takes the mark on the first opening:
               it is built lazily, and the document color is already
               known by that time. */
            $wrap.data('voSwatch', function (hex) {
                var next = hex || '';
                if (next === cfg.value) return;
                cfg.value = next;
                $line.css('background', hex ? '#' + hex : cfg.resetSwatch);
                var mark = $wrap.data('voMark');
                if (mark) mark(hex || null);
            });

            /* A MODE button. Needed by the marker: SetMarkerFormat does not fill the selection
               once, but turns on a mode and holds it until it is turned off
               (sdkjs/word/api.js:8878-8887). In the stock code the mode is turned off by un-pressing the button
               btnHighlightColor (controller/Toolbar.js, onBtnHighlightColor),
               while here the button is single and there was nothing to un-press — there was no exit from the mode
               at all. So with cfg.off the button is two-position: a turned-on
               mode is turned off by a click, a turned-off one — opens the palette.
               Without cfg.off (the text color is a one-time command) the behavior is the former.

               HOW THIS DIFFERS FROM THE STOCK CODE, so that it is not reopened as a
               defect: in the stock code the button is composite — the press and the menu are separate
               (onBtnHighlightColor on the press, onSelectHighlightColor on a choice
               in the menu), and the palette is always available, including with the mode
               turned on. Here the button is single, so with the mode turned on the first
               click goes to cfg.off and does not open the palette: changing the marker
               color on the fly became two-click — turn the mode off, then
               open the palette. The decision is a product one, the behavior is left
               deliberately.

               The button is pressed also when the selected text is entirely
               highlighted (voFilled, driven by syncHighlight), — the same way
               "B" is pressed on bold. A click on it is the same cfg.off: it removes the highlight
               from the selection. The "turn off" hint is only for the
               mode: for a highlighted selection there is nothing to turn off. */
            var modeOn = false, filled = false;
            var paint = function () {
                $btn.toggleClass('on', modeOn || filled)
                    .attr('title', (modeOn && cfg.offTitle) ? cfg.offTitle : cfg.title);
            };
            var setMode = function (on) { modeOn = !!on; paint(); };
            if (cfg.off) {
                $wrap.data('voMode', setMode);
                $wrap.data('voFilled', function (on) { filled = !!on; paint(); });
            }

            $btn.on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (cfg.off && $btn.hasClass('on')) {
                    me.closeSurfaces($wrap);
                    setMode(false);
                    cfg.off();
                    return;
                }
                var open = !$wrap.hasClass('open');
                me.closeSurfaces($wrap);
                $wrap.toggleClass('open', open);
                if (open) me.buildPalette(cfg, $wrap, $host, $line);
            });

            $reset.on('click', function () {
                $wrap.removeClass('open');
                $line.css('background', cfg.resetSwatch);
                /* The shown value is corrected by the reset ENTIRELY, as pick does for
                   a selected sample: both the strip and the mark in the grid with the preview and
                   the color code field. Through voSwatch the mark would not get here —
                   the shown value is already set to '', and the asc_onTextColor
                   that follows with get_auto() will run into the comparison with it and
                   exit, touching neither the checkmark, nor the preview, nor the field. For the marker
                   there is nothing to wait for at all: SetMarkerFormat sends no event.
                   The stock code corrects both surfaces in the same place as the command: the choice of
                   "Automatic" goes through onSelectFontColor
                   (controller/Toolbar.js), and that one rearranges both the button and
                   the palette's currentColor.
                   The palette is built lazily: while it does not exist, there is nothing to clear —
                   buildPalette will take the mark from cfg.value. */
                cfg.value = '';                      /* the shown value — see voSwatch */
                var mark = $wrap.data('voMark');
                if (mark) mark(null);
                cfg.reset();
            });

            /* A click inside the popover must not close it. */
            $pop.on('click', function (e) { e.stopPropagation(); });
            $(document).on('click', function () { $wrap.removeClass('open'); });

            return $wrap;
        },

        /* The marker mode mark on the highlight button. The shell has no flag of its own
           deliberately: the mode is turned off also by the engine itself — on Esc, on undoing the action,
           on a view change (sdkjs/word/api.js:4659,8844, Editor/Document.js:8955,
           Editor/History.js:1172), — and it reports all these cases
           with the asc_onMarkerFormatChanged callback, which calls this same method
           (see bindApi). A local flag would diverge from them. */
        setMarker: function (on) {
            var mode = this.ctrl.highlight && this.ctrl.highlight.data('voMode');
            if (mode) mode(on);
        },

        /* The selected text is entirely highlighted: the selection is non-empty and the highlight
           color is one for all the text. We read get_HighLight as the stock code does
           (controller/Toolbar.js, onApiHighlightColor): -1 — no highlight,
           null — it is mixed, otherwise the color. We ask whether the selection is non-empty with
           can_CopyCut(), like SelectionBubble.hasSelection: at the caret there is nothing
           to clear, and we do not call get_TextProps on every movement of it. */
        highlightedSelection: function () {
            var api = this.api;
            try {
                if (typeof api.can_CopyCut === 'function' ? !api.can_CopyCut()
                        : !(api.asc_GetSelectedText && api.asc_GetSelectedText())) return false;
                var props = api.get_TextProps(), pr = props && props.get_TextPr();
                var hl = pr && pr.get_HighLight();
                return !!hl && hl !== -1 && typeof hl.get_hex === 'function';
            } catch (e) { return false; }
        },

        /* The second half of the pressed state of the highlight button — whether the
           selection is highlighted (see colorBtn, voFilled). */
        syncHighlight: function () {
            var fill = this.ctrl.highlight && this.ctrl.highlight.data('voFilled');
            if (fill) fill(this.highlightedSelection());
        },

        /* The strip under "A" shows the TEXT COLOR IN THE DOCUMENT, not the last one
           chosen in the palette. The shell has no flag of its own deliberately, exactly
           for the same reason as with the marker: the color under the caret changes without
           our participation — the engine sends it on every caret movement, on
           undoing an action, on the format painter. The stock code listens to the same event
           (asc_onTextColor, controller/Toolbar.js:496,3302).

           A click on a sample still paints the strip at once (pick in
           buildPalette) — this is not a second source of truth, but an optimistic
           rendering, and it is also stock: onSelectFontColor paints the button
           itself and drops the cache so that the callback definitely rearranges it (:2895-2899).
           We have no cache, so we rearrange on every callback.

           We take the scheme color as resolved r/g/b: the stock code does the same for the button itself,
           and effectValue is needed by it only to find the sample among the
           theme colors — our grid does not show them at all (see bindApi). */
        setTextColor: function (color) {
            var swatch = this.ctrl.color && this.ctrl.color.data('voSwatch');
            if (!swatch || !color) return;
            /* Automatic means "no color": in the engine it is black, while the strip
               shows the reset sample, as when choosing "Automatic". */
            if (typeof color.get_auto === 'function' && color.get_auto()) { swatch(null); return; }
            if (typeof color.get_r !== 'function') return;
            swatch(this.hexOf(color.get_r(), color.get_g(), color.get_b()));
        },

        /* We build the palette on the first opening: before that its node is not in the document.
           The layout and behavior are from the stage editor (see PALETTE_STAGE above):
           a grid of square samples, the selected one is marked with a checkmark IN THE CENTER, and not
           with a frame — a frame is not readable on a dark sample, while a checkmark with
           drop-shadow is readable on any.

           THE SET OF COLORS, though, is each control's own: the colors are those
           that are needed, while the popup frontend is the one from the stages.
           The text color takes the stage grid and a color code
           field, the marker — its own enumeration and without a field, see colorBtn. */
        /* Silencing the engine's keyboard interception. The same technique as for value
           lists, but it is needed here too: without it the color code field cannot be
           typed into — the engine holds a hidden <textarea> and SYNCHRONOUSLY returns
           focus there, and the letters go into the document. Leaving the interception off
           is not allowed: the document would become unable to receive typed input, hence the return on blur. */
        enableKeys: function (on) {
            var api = this.api;
            if (api && typeof api.asc_enableKeyEvents === 'function') api.asc_enableKeyEvents(on);
        },

        buildPalette: function (cfg, $wrap, $host, $line) {
            if ($wrap.data('built')) return;
            $wrap.data('built', true);

            var me = this;

            var cols = cfg.cols || 14;
            var current = normHex(cfg.value) || null;

            var $grid = $('<div class="vo-pal-grid"></div>')
                .attr({role: 'group', 'aria-label': cfg.title})
                .css('--vo-pal-cols', cols);

            var $items = [];
            var $preview = null, $input = null;

            /* The mark of the selected one lives in one place: both the grid and the color code
               field call it, otherwise they diverge from each other. */
            var mark = function (hex) {
                current = hex;
                $items.forEach(function ($s) {
                    var on = $s.attr('data-color') === hex;
                    $s.toggleClass('on', on).attr('aria-pressed', on ? 'true' : 'false');
                });
                if ($preview) $preview.css('background', hex ? '#' + hex : 'transparent');
                if ($input) $input.val(hex ? '#' + hex.toUpperCase() : '');
            };
            /* By the same key the mark is moved by voSwatch, when the color came from the
               engine and not from a click on a sample. */
            $wrap.data('voMark', mark);

            var pick = function (hex) {
                mark(hex);
                $wrap.removeClass('open');
                $line.css('background', '#' + hex);
                cfg.value = hex;                     /* the shown value — see voSwatch */
                cfg.apply(hex);
            };

            (cfg.colors || []).forEach(function (raw) {
                /* We normalize the case here: the marker enumeration is written in
                   UPPERCASE (that is how it is stored in the stock code too), the stage grid —
                   in lowercase, and normHex below gives lowercase. Without a common
                   case mark() would not find the selected sample. */
                var hex = String(raw).replace(/^#/, '').toLowerCase();
                var $s = $('<button type="button" class="vo-pal-item"></button>')
                    .attr({'data-color': hex, 'aria-label': '#' + hex.toUpperCase(), 'aria-pressed': 'false'})
                    .css('background', '#' + hex)
                    /* The checkmark color is computed by the sample brightness, and is not set
                       by a single value: on the light top rows a white
                       checkmark would disappear. */
                    .append($('<span class="vo-pal-check"></span>')
                        .css('color', paletteInk(hex))
                        .html(svg('checkMenu', 14)))
                    .on('click', function (e) { e.stopPropagation(); pick(hex); });
                $items.push($s);
                $grid.append($s);
            });

            $host.append($grid);

            /* The color code field — only where the engine accepts an arbitrary color.
               The marker has none deliberately: the highlight in OOXML
               is stored BY NAME from a fixed enumeration, not as RGB, and the field
               would offer colors that the format does not have. This is visible right in
               the stock code: next to the sixteen colors sits colorHints with their
               names (app/view/Toolbar.js, mnuHighlightColorPicker). */
            if (cfg.custom) {
                var $field = $('<div class="vo-pal-custom"></div>');
                $input = $('<input type="text" class="vo-pal-input" maxlength="7" spellcheck="false">')
                    .attr({placeholder: '#', 'aria-label': me.textColorCode});
                $preview = $('<span class="vo-pal-preview" aria-hidden="true"></span>');

                var commit = function () {
                    var hex = normHex($input.val());
                    if (!hex) { mark(current); return; }   /* garbage — a rollback to the current */
                    pick(hex);
                };
                $input.on('keydown', function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); commit(); }
                    /* Esc returns focus to the color button, as in value lists,
                       and does not give it to the document. */
                    if (e.key === 'Escape') { e.stopPropagation(); $wrap.removeClass('open'); }
                });
                $input.on('change', commit);

                /* mousedown, not focus: the focus event comes already AFTER
                   the engine took focus back, and it is too late to silence in it. */
                $input.on('mousedown', function () { me.enableKeys(false); });
                $input.on('blur', function () { me.enableKeys(true); });

                /* The toggle is textual: there is no plus glyph in the shell set, and
                   an invented svg() name would render as emptiness, silently. */
                var $toggle = $('<button type="button" class="vo-pal-toggle"></button>')
                    .text(me.textCustomColor)
                    .on('mousedown', function () { me.enableKeys(false); })
                    .on('click', function (e) {
                        e.stopPropagation();
                        $toggle.addClass('vo-hidden');
                        $field.removeClass('vo-hidden');
                        $input.trigger('focus');
                        /* We select the content, not just put the caret.
                           The field opens already filled with the current color, and
                           that is exactly maxlength=7 characters: without selection typing
                           does not fit and the field looks unresponsive. Caught
                           by live typing on 10.09 — focus was held, and the letters went
                           nowhere. */
                        $input.trigger('select');
                    });

                $field.addClass('vo-hidden')
                    .append($('<span class="vo-pal-field"></span>').append($input).append($preview));
                $host.append($toggle).append($field);
            }

            mark(current);
        },

        rgb: function (hex) {
            var n = parseInt(hex.slice(1), 16);
            return {r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255};
        },

        ascColor: function (hex) {
            var v = this.rgb(hex);
            var color = new Asc.asc_CColor();
            color.put_type(Asc.c_oAscColor.COLOR_TYPE_SRGB);
            color.put_r(v.r); color.put_g(v.g); color.put_b(v.b); color.put_a(255);
            return color;
        },

        /* The inverse of rgb(): channels -> six lowercase digits without a hash. It is exactly
           in this form that the color is stored in the data-color of the samples, otherwise the mark in the
           grid cannot be found. */
        hexOf: function (r, g, b) {
            return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        },

        /* --- Actions with stock dialogs --------------------------------- */
        /* The comment is still opened by the stock controller (DocumentActions.addComment):
           it knows mentions and formatting, we have no analog of our own.

           But the link is our own. The former approach "we do not build windows of our own"
           is cancelled for it: the link options popup is built from
           AIR components and opens as a popover under the "Link" button.

           SO THAT THE REPLACEMENT IS NOT AN EXCHANGE OF LOOK FOR WORKABILITY, from
           the stock DE.Views.HyperlinkSettingsDialog everything it
           did is carried over, not only what is visible in the mockup:
           — editing an existing link: can_AddHyperlink returned false —
             the properties are taken from the selection and go to change_Hyperlink;
           — address validation by the engine (asc_getUrlType): appending http:// and
             mailto:, refusal on an invalid one, the limit of 2083 characters;
           — autofilling "Display" from the address until the user has entered their
             own text (isAutoUpdate/isTextChanged of the stock dialog);
           — "Selected text" grayed out and unavailable when the engine did not give
             the selection text (get_Text() === null);
           — the "Place in document" tab: the start of the document, the heading tree
             and bookmarks (asc_GetHyperlinkAnchors);
           — the hint text with the limit c_oAscMaxTooltipLength;
           — the memory of the last selected tab (de-settings-link-type).

           ONE THING IS NOT carried over, and this is deliberate: the file choice button at the address
           field. It exists only in the desktop application (isDesktopApp), and
           the shell lives in the browser — it was not in the stock window here either. */

        insertLink: function () {
            var ui = this.linkUI();
            if (!ui) return;
            /* The button toggles: a second click on it closes. A click elsewhere
               closes the popover with a separate listener, but does not
               touch the button itself — otherwise it would manage to close and immediately reopen. */
            if (ui.isOpen()) { ui.close(); return; }
            ui.open();
        },

        /* The popup is built once and lives ON BODY — in the same place as #vo-slash and
           #vo-bubble, and not inside the button wrapper, like the other panel
           popovers.

           The reason is not convenience: the "Link" button is located in the second-to-last group
           of the row, at narrow widths relayout marks it .vo-collapsed
           (display:none !important), and openOverflow moves it into the "…" popover.
           A nested popover would end up inside a hidden ancestor and would not show
           at all — while the link window can be opened from three more places
           where there is no button at all: the selection bubble, the "/" menu and the
           "Insert" menu. So the node is on body, and the coordinates are by measuring from the button,
           as for #vo-slash. When the button is not visible, the measuring goes from "…", and if
           the row is hidden too — from the panel itself. */
        linkUI: function () {
            if (this._linkUI) return this._linkUI;

            var me = this;
            var api = this.api;
            if (!api || !window.Asc || !Asc.CHyperlinkProperty) return null;

            var URL_MAX = 2083;                                  /* txtSizeLimit of the stock one */
            var TIP_MAX = Asc.c_oAscMaxTooltipLength || 250;
            var TEXT_DEFAULT = me.textSelectedText;               /* textDefault of the stock one */

            /* The state of one opening. Reset in open(). */
            var props = null, isNew = false, tab = 'ext';
            var isAutoUpdate = false, isTextChanged = false, listBuilt = false;
            var sel = null;
            /* A return of focus to the button is in progress — see close(). */
            var restoring = false;

            /* --- Markup -------------------------------------------------- */

            var $pop = $('<div id="vo-link" role="dialog"></div>')
                .attr('aria-label', me.textLinkSettings)
                .appendTo('body');

            var $x = $('<button type="button" class="vo-link-x"></button>')
                .attr('aria-label', me.textClose).html(svg('close', 20));

            $pop.append($('<div class="vo-link-hd"></div>')
                .append($('<div class="vo-link-title"></div>').text(me.textLinkSettings))
                .append($x));

            var $body = $('<div class="vo-link-body"></div>').appendTo($pop);

            var mkTab = function (text) {
                return $('<button type="button" class="vo-link-tab" role="tab"></button>')
                    .attr('aria-selected', 'false').text(text);
            };
            var $tabExt = mkTab(me.textExternalLink);
            var $tabInt = mkTab(me.textPlaceInDocument);
            $body.append($('<div class="vo-link-tabs" role="tablist"></div>')
                .append($tabExt).append($tabInt));

            /* A field by the ui.system.input sample: a caption on top, a box with a
               border, the border is highlighted on focus. The wrapper is <label>,
               so a click on the caption puts the caret into the field. */
            var mkField = function (label, ph, opts) {
                opts = opts || {};
                var $box = $('<span class="vo-fld-box"></span>');
                var $in = $('<input type="text" class="vo-fld-input" spellcheck="false">')
                    .attr('placeholder', ph || '');
                if (opts.max) $in.attr('maxlength', opts.max);
                $box.append($in);
                if (opts.icon) {
                    $box.append($('<span class="vo-fld-icon" aria-hidden="true"></span>')
                        .html(svg(opts.icon, 20)));
                }
                var $el = $('<label class="vo-fld"></label>')
                    .append($('<span class="vo-fld-label"></span>').text(label))
                    .append($box);
                $in.on('focus', function () { $box.addClass('on'); });
                $in.on('blur',  function () { $box.removeClass('on'); });
                return {$el: $el, $box: $box, $input: $in};
            };

            var url  = mkField(me.textLinkTo, me.textEnterUrl, {icon: 'link', max: URL_MAX});
            var disp = mkField(me.textDisplay, me.textDisplayHint);
            var tip  = mkField(me.textTooltip, me.textTooltipHint, {max: TIP_MAX});

            var $paneExt = $('<div class="vo-link-pane"></div>').append(url.$el);

            var $list = $('<div class="vo-link-list" role="tree"></div>')
                .attr('aria-label', me.textPlaceInDocument);
            var $paneInt = $('<div class="vo-link-pane vo-link-off"></div>')
                .append($('<div class="vo-fld"></div>')
                    .append($('<span class="vo-fld-label"></span>').text(me.textLinkTo))
                    .append($list));

            $body.append($paneExt).append($paneInt).append(disp.$el).append(tip.$el);

            var $ok = $('<button type="button" class="vo-link-btn vo-link-ok"></button>').text(me.textOk);
            var $cancel = $('<button type="button" class="vo-link-btn vo-link-cancel"></button>').text(me.textCancel);
            $pop.append($('<div class="vo-link-ft"></div>').append($ok).append($cancel));

            /* The error caption sits on the bottom edge of the field and does not move the
               layout — the same as in ui.system.input. */
            var $msg = $('<span class="vo-fld-msg"></span>');
            var showErr = function (text) {
                url.$el.addClass('vo-fld-err').append($msg.text(text));
                url.$input.trigger('focus');
            };
            var clearErr = function () { url.$el.removeClass('vo-fld-err'); $msg.detach(); };

            /* --- The "Places in the document" list -------------------------------- */

            /* The model is built on every opening: between calls headings and bookmarks
               could have appeared in the document. The stock dialog does the same —
               it is created anew on every call. */
            var anchorModel = function () {
                var out = [{kind: 'top', name: me.textTopOfDocument}];
                var heads = [], books = [];
                var list = [];
                try { list = api.asc_GetHyperlinkAnchors() || []; } catch (e) { list = []; }
                var A = Asc.c_oAscHyperlinkAnchor || {};

                for (var i = 0; i < list.length; i++) {
                    var a = list[i];
                    var type = a.asc_GetType();
                    if (type === A.Heading) {
                        heads.push({kind: 'head', name: a.asc_GetHeadingText(),
                                    level: a.asc_GetHeadingLevel() + 1,
                                    para: a.asc_GetHeadingParagraph()});
                    } else if (type === A.Bookmark) {
                        books.push({kind: 'book', name: a.asc_GetBookmarkName()});
                    }
                }

                out.push({kind: 'grp', name: me.textHeadings, empty: me.textNoHeadings, children: heads});
                out.push({kind: 'grp', name: me.textBookmarks, empty: me.textNoBookmarks, children: books});
                return out;
            };

            /* There is a single Tab entry point into the list: the rows are marked tabindex -1,
               and the current one with zero. Otherwise Tab would count a stop for each
               heading of the document, and there can be a hundred. */
            var setTabStop = function ($r) {
                $list.find('.vo-link-row').attr('tabindex', '-1');
                if ($r && $r.length) $r.attr('tabindex', '0');
            };

            /* pos/size — the place of a row in ITS OWN set: for the root ones it is the start of the
               document and two sections, for a value — the rows of its section. Without
               them the screen reader on a tree does not say "2 of 7", and the list of
               document headings can be long — without a count in it one cannot
               tell how far one has got. We count by the model, not by the DOM: the markup
               is flat (values are neighbors of the section), and by nodes the set
               would come out one for the whole tree. */
            var mkRow = function (node, level, isGroup, pos, size) {
                var $r = $('<button type="button" class="vo-link-row"></button>')
                    .attr({role: 'treeitem', tabindex: '-1', 'aria-level': String(level + 1),
                           'aria-posinset': String(pos), 'aria-setsize': String(size)});
                if (level) $r.addClass('vo-link-l' + Math.min(level, 3));
                if (isGroup) {
                    $r.addClass('vo-link-grp').attr('aria-expanded', 'false');
                } else {
                    $r.attr('aria-selected', 'false');
                }
                /* We keep room for the chevron on all rows: without it the captions
                   of sections and values would sit on different verticals. */
                $r.append($('<span class="vo-link-chev" aria-hidden="true"></span>')
                    .html(isGroup && node.children.length ? svg('chevron', 16) : ''));
                $r.append($('<span class="vo-link-name"></span>').text(node.name));
                $r.append($('<span class="vo-link-check" aria-hidden="true"></span>').html(svg('checkMenu', 18)));
                $r.data('node', node);
                return $r;
            };

            var toggleGroup = function ($g) {
                var open = !$g.hasClass('vo-link-open');
                $g.toggleClass('vo-link-open', open).attr('aria-expanded', open ? 'true' : 'false');
                ($g.data('kids') || []).forEach(function ($k) { $k.toggleClass('vo-link-off', !open); });
            };

            var pick = function ($r, quiet) {
                $list.find('.vo-link-row.on').removeClass('on').attr('aria-selected', 'false');
                $r.addClass('on').attr('aria-selected', 'true');
                setTabStop($r);
                sel = $r.data('node');
                if (!quiet) autoDisplay();
                syncOk();
            };

            var fillList = function () {
                if (listBuilt) return;
                listBuilt = true;
                $list.empty();

                var model = anchorModel();
                model.forEach(function (node, idx) {
                    if (node.kind !== 'grp') {
                        var $r = mkRow(node, 0, false, idx + 1, model.length);
                        $r.on('click', function (e) { e.preventDefault(); pick($r); });
                        $list.append($r);
                        return;
                    }

                    var $g = mkRow(node, 0, true, idx + 1, model.length);
                    var kids = [];
                    $list.append($g);

                    node.children.forEach(function (kid, ki) {
                        var $k = mkRow(kid, Math.min(kid.level || 1, 3), false,
                                       ki + 1, node.children.length).addClass('vo-link-off');
                        $k.on('click', function (e) { e.preventDefault(); pick($k); });
                        $list.append($k);
                        kids.push($k);
                    });

                    if (!node.children.length) {
                        /* The caption "no values" is a direct child of the tree,
                           and the tree owns only treeitem and group. It has
                           no role — we remove the one implied by <div>, otherwise the
                           set of rows at the screen reader does not match the aria-setsize
                           of the neighbors. The text is read as it was. */
                        var $e = $('<div class="vo-link-empty vo-link-off" role="none"></div>').text(node.empty);
                        $list.append($e);
                        kids.push($e);
                    }

                    $g.data('kids', kids);
                    $g.on('click', function (e) { e.preventDefault(); toggleGroup($g); });
                });

                setTabStop($list.find('.vo-link-row').first());
            };

            /* Restoring the choice of an existing link. The section with the found
               row is expanded — otherwise the selected value would stay
               hidden inside a collapsed section. */
            var selectFromProps = function (p) {
                fillList();

                var $rows = $list.find('.vo-link-row');
                var match = function (fn) {
                    return $rows.filter(function () { return fn($(this).data('node')); }).first();
                };

                var $t;
                if (p.is_TopOfDocument && p.is_TopOfDocument()) {
                    $t = match(function (n) { return n.kind === 'top'; });
                } else if (p.is_Heading && p.is_Heading()) {
                    var para = p.get_Heading();
                    $t = match(function (n) { return n.kind === 'head' && n.para === para; });
                } else {
                    var bm = p.get_Bookmark();
                    $t = match(function (n) { return n.kind === 'book' && n.name === bm; });
                }

                if (!$t || !$t.length) return;
                var $g = $t.prevAll('.vo-link-grp').first();
                if ($g.length && !$g.hasClass('vo-link-open')) toggleGroup($g);
                pick($t, true);
                if ($t[0].scrollIntoView) $t[0].scrollIntoView({block: 'nearest'});
            };

            /* --- Tabs and state --------------------------------------- */

            var autoDisplay = function () {
                if (!isAutoUpdate) return;
                disp.$input.val(tab === 'ext' ? url.$input.val() : (sel ? sel.name : ''));
                isTextChanged = true;
            };

            var syncOk = function () {
                var can = (tab === 'ext') ? (url.$input.val().trim() !== '') : !!sel;
                $ok.prop('disabled', !can);
            };

            var setTab = function (t) {
                tab = t;
                $tabExt.toggleClass('on', t === 'ext').attr('aria-selected', t === 'ext' ? 'true' : 'false');
                $tabInt.toggleClass('on', t === 'int').attr('aria-selected', t === 'int' ? 'true' : 'false');
                $paneExt.toggleClass('vo-link-off', t !== 'ext');
                $paneInt.toggleClass('vo-link-off', t !== 'int');
                if (t === 'int') fillList();
                syncOk();
            };

            $tabExt.on('click', function () { if (tab !== 'ext') { clearErr(); setTab('ext'); autoDisplay(); } });
            $tabInt.on('click', function () { if (tab !== 'int') { clearErr(); setTab('int'); autoDisplay(); } });

            url.$input.on('input', function () {
                clearErr();
                if (isAutoUpdate) { disp.$input.val(url.$input.val()); isTextChanged = true; }
                syncOk();
            });

            disp.$input.on('input', function () {
                isAutoUpdate = (disp.$input.val() === '');
                isTextChanged = true;
            });

            /* --- Placement ------------------------------------------------ */

            var anchor = function () {
                var $b = me.ctrl && me.ctrl.link;
                if ($b && $b.length && $b[0].offsetParent) return $b;
                var $m = me.$moreWrap;
                if ($m && $m.length && $m[0].offsetParent) return $m;
                var $bar = me.el;
                if ($bar && $bar.length && $bar[0].offsetParent) return $bar;
                return null;
            };

            var place = function () {
                var $a = anchor();
                var off = ($a && $a.length) ? $a.offset() : null;
                var w = $pop.outerWidth(), h = $pop.outerHeight();
                var winW = $(window).width(), winH = $(window).height();
                var x = off ? off.left : 8;
                var y = off ? off.top + $a.outerHeight() + 4 : 8;
                var right = false;

                var maxX = winW - w - 8;
                if (x > maxX) { x = maxX; right = true; }
                if (x < 8) x = 8;
                if (y + h > winH - 8) y = Math.max(8, winH - h - 8);

                $pop.toggleClass('vo-link-right', right)
                    .css({left: Math.round(x) + 'px', top: Math.round(y) + 'px'});
            };

            /* --- Opening and closing --------------------------------------- */

            var open = function () {
                var text;
                try { text = api.can_AddHyperlink(); } catch (e) { return; }

                /* can_AddHyperlink gives the selected text if a link can be
                   created, and false if the cursor is already inside an existing one. In the
                   second case we take the properties from the selection and edit it. */
                var p = null, fresh = false;
                if (text !== false) {
                    p = new Asc.CHyperlinkProperty();
                    p.put_Text(text);
                    fresh = true;
                } else {
                    (api.getSelectedElements() || []).forEach(function (el) {
                        if (el.get_ObjectType() === Asc.c_oAscTypeSelectElement.Hyperlink) {
                            p = el.get_ObjectValue();
                        }
                    });
                    if (!p) return;
                }

                /* The same shared point as for the other toggles: until 19.09
                   the link window closed only popovers, and an open menu bar
                   menu stayed over it.
                   We pass the node: at narrow widths the "Link" button goes
                   into "•••", and the popup coordinates are taken from it — closing
                   the row while the button is inside is not allowed. */
                me.closeSurfaces(me.ctrl && me.ctrl.link);

                props = p; isNew = fresh;
                listBuilt = false; sel = null; isTextChanged = false;
                clearErr();

                /* We show BEFORE filling: scrolling the list to the selected
                   row does not work on a hidden node, and there will be no redraw between
                   these steps — they are in one tick. */
                $pop.addClass('open');

                var bm = p.get_Bookmark();
                var lastInt = false;
                try { lastInt = !!Common.Utils.InternalSettings.get('de-settings-link-type'); } catch (e) { /* no settings */ }
                var t = (bm === null || bm === '')
                    ? ((p.get_Value() || !lastInt) ? 'ext' : 'int')
                    : 'int';

                url.$input.val(p.get_Value() ? String(p.get_Value()).replace(/ /g, '%20') : '');
                tip.$input.val(p.get_ToolTip() || '');

                if (p.get_Text() !== null) {
                    disp.$input.val(p.get_Text()).prop('disabled', false);
                    disp.$el.removeClass('vo-fld-dis');
                    isAutoUpdate = (disp.$input.val() === '' ||
                                    (t === 'ext' && url.$input.val() === disp.$input.val()));
                } else {
                    /* The engine did not give the selection text — there is nothing to change. */
                    disp.$input.val(TEXT_DEFAULT).prop('disabled', true);
                    disp.$el.addClass('vo-fld-dis');
                    isAutoUpdate = false;
                }

                setTab(t);
                if (t === 'int') selectFromProps(p);
                syncOk();
                place();

                var $btn = me.ctrl && me.ctrl.link;
                if ($btn && $btn.length) $btn.attr('aria-expanded', 'true');

                /* We silence the engine's keyboard interception BEFORE setting focus:
                   the focus event comes already after the engine took focus
                   back, — the same gotcha as with the color code field. */
                me.enableKeys(false);
                (t === 'ext' ? url.$input : disp.$input).trigger('focus');
            };

            /* toButton === false — closing not by the user's will (a click elsewhere,
               applying): then focus goes not to the button but to the document. */
            var close = function (toButton) {
                if (!$pop.hasClass('open')) return;
                var inside = $pop[0].contains(document.activeElement);
                var $btn = me.ctrl && me.ctrl.link;

                /* Focus was outside — we do not touch it at all. But leaving it
                   inside a hidden node is not allowed: the browser would give focus to body, and
                   the document would stop accepting typing. */
                var toBtn = (toButton !== false) && inside &&
                            $btn && $btn.length && !!$btn[0].offsetParent;

                if (toBtn) {
                    /* THE RETURN OF FOCUS TO THE BUTTON GOES IN THE NEXT TICK, and this is not
                       overcaution. It was worked out by a trace on 10.09, not deduced
                       from the code:

                       in the stock code there is a delegate on body `$(document.body).on('blur',
                       'input, textarea')` (app/controller/Main.js:296). As soon as
                       our field loses focus, it calls asc_enableKeyEvents(true) —
                       and the engine immediately, synchronously drags focus into its hidden
                       <textarea> (sdk-all.js, focusHtmlElement). So any
                       SYNCHRONOUS focus transfer to the button loses: in the
                       trace focusin never appeared on the button, TEXTAREA went right away.
                       It was checked separately that it is not about jQuery: a native
                       focus() behaved the same.

                       The workaround — wait for the end of the blur chain, silence the
                       interception again and only then focus the button. Measurement: with an
                       explicitly turned off interception the button holds focus (checked
                       also on "Bold", that is, this is a property of the whole panel).

                       The interception stays off while focus is on the button, and
                       returns on its blur — the same technique and the same rationale
                       as for value lists. */
                    restoring = true;
                    $btn.off('blur.voLink').one('blur.voLink', function () {
                        restoring = false;
                        me.enableKeys(true);
                    });

                    /* Tick 1: we remove focus from the field ourselves. The stock delegate
                       will work here — on the blur of exactly the field —, turn on
                       the interception and give focus to the engine. Interfering with it is useless:
                       it hangs on body and does not reach us. */
                    var was = document.activeElement;
                    if (was && was.blur) was.blur();

                    /* Tick 2: we take focus from the engine already. Its <textarea> is passed by the same
                       delegate — it has an id with area_id, and its condition
                       does not fire on such a target (Main.js:303). */
                    setTimeout(function () {
                        restoring = false;
                        if (!$btn[0].offsetParent) { me.enableKeys(true); return; }
                        me.enableKeys(false);
                        $btn[0].focus();
                    }, 0);
                }

                $pop.removeClass('open');
                clearErr();
                if ($btn && $btn.length) $btn.attr('aria-expanded', 'false');

                if (toBtn) return;

                me.enableKeys(true);
                if (inside && window.Common && Common.NotificationCenter) {
                    Common.NotificationCenter.trigger('edit:complete');
                }
            };

            var apply = function () {
                if ($ok.prop('disabled')) return;

                var p = new Asc.CHyperlinkProperty();
                var display = '';

                if (tab === 'ext') {
                    var v = url.$input.val().trim();
                    if (v.length > URL_MAX) {
                        showErr(Common.Utils.String.format(me.textUrlTooLong, URL_MAX));
                        return;
                    }

                    var T = (window.AscCommon && AscCommon.c_oAscUrlType) || null;
                    var type = null;
                    try { type = api.asc_getUrlType(v); } catch (e) { type = null; }

                    if (T && type === T.Invalid) {
                        showErr(me.textUrlInvalid);
                        return;
                    }

                    /* The protocol is appended by the stock dialog, and this is not cosmetic:
                       without it the engine would save a link that cannot be followed. */
                    if (!(T && type === T.Unsafe) && !/(((^https?)|(^ftp)):\/\/)|(^mailto:)/i.test(v)) {
                        v = ((T && type === T.Email) ? 'mailto:' : 'http://') + v;
                    }
                    v = v.replace(new RegExp('%20', 'g'), ' ');

                    p.put_Value(v);
                    p.put_Bookmark(null);
                    display = v;
                } else {
                    if (!sel) return;
                    p.put_Bookmark(sel.name);
                    if (sel.kind === 'top') p.put_TopOfDocument();
                    if (sel.para) p.put_Heading(sel.para);
                    display = sel.name;
                }

                if (!disp.$input.prop('disabled') && (isTextChanged || !disp.$input.val())) {
                    if (!disp.$input.val() || (tab === 'ext' && isAutoUpdate)) disp.$input.val(display);
                    p.put_Text(disp.$input.val());
                } else {
                    p.put_Text(null);
                }

                p.put_ToolTip(tip.$input.val());
                if (props && typeof props.get_InternalHyperlink === 'function') {
                    p.put_InternalHyperlink(props.get_InternalHyperlink());
                }

                /* We remember the tab only when the link is created anew —
                   the same as in the stock dialog. */
                try {
                    if (props && !props.get_Bookmark() && !props.get_Value()) {
                        Common.Utils.InternalSettings.set('de-settings-link-type', tab === 'int');
                    }
                } catch (e) { /* no settings */ }

                isNew ? api.add_Hyperlink(p) : api.change_Hyperlink(p);

                /* close(false) will itself return focus to the document with the
                   edit:complete signal — there is no need to send it a second time. */
                close(false);
            };

            /* --- Events --------------------------------------------------- */

            $ok.on('click', function (e) { e.preventDefault(); apply(); });
            $cancel.on('click', function (e) { e.preventDefault(); close(); });
            $x.on('click', function (e) { e.preventDefault(); close(); });

            $pop.on('keydown', function (e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                    return;
                }
                if (e.key === 'Enter' && $(e.target).is('input')) {
                    e.preventDefault();
                    apply();
                }
            });

            /* The list keyboard: moving through visible rows, Enter expands
               a section or chooses a value. None of the old shell popovers
               has a keyboard — we create the new surface with it
               at once, so as not to add to this debt.

               Sideways arrows are the stock WAI-ARIA pattern for tree, and they are not
               a luxury here: without them expanding a section and choosing a value is done by
               ONE Enter, that is, two different commands on one key.
               Right on a collapsed section expands it, on an expanded one leads to the
               first value; left on an expanded one collapses it, on a value
               leads to its section. On root rows there is nowhere to go —
               a sideways arrow does nothing there, as it should. */
            $list.on('keydown', function (e) {
                var $vis = $list.find('.vo-link-row').not('.vo-link-off');
                var i = $vis.index(document.activeElement);
                var go = function (n) {
                    if (n < 0 || n >= $vis.length) return;
                    setTabStop($vis.eq(n));
                    $vis.eq(n).trigger('focus');
                };

                if (e.key === 'ArrowDown')      { e.preventDefault(); go(i < 0 ? 0 : i + 1); }
                else if (e.key === 'ArrowUp')   { e.preventDefault(); go(i <= 0 ? 0 : i - 1); }
                else if (e.key === 'Home')      { e.preventDefault(); go(0); }
                else if (e.key === 'End')       { e.preventDefault(); go($vis.length - 1); }
                else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    /* Focus is not on a row — there is nothing to move through. As a separate check,
                       because eq(-1) in jQuery is the LAST row. */
                    if (i < 0) return;
                    e.preventDefault();
                    var $cur = $vis.eq(i);
                    var grp  = $cur.hasClass('vo-link-grp');
                    var open = $cur.hasClass('vo-link-open');

                    if (e.key === 'ArrowRight') {
                        if (!grp) return;
                        if (!open) { toggleGroup($cur); return; }
                        /* We take the first value from kids, not as the neighboring
                           row: for an empty section the neighbor is the caption
                           "no values", and the step would go into the next section. */
                        var $kid = ($cur.data('kids') || []).filter(function ($k) {
                            return $k.hasClass('vo-link-row');
                        })[0];
                        if ($kid) go($vis.index($kid[0]));
                    } else {
                        if (grp) { if (open) toggleGroup($cur); return; }
                        var $g = $cur.prevAll('.vo-link-grp').first();
                        if ($g.length) go($vis.index($g[0]));
                    }
                }
                else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    $(document.activeElement).trigger('click');
                }
            });

            /* The press: pointerdown, not mousedown. Over the editor canvas
               mousedown DOES NOT COME AT ALL — the engine handles pointerdown and
               suppresses the compatibility event. Measured on 10.09: a click on the document
               page gave not a single mousedown, neither on document, nor even on
               window in the capture phase, while pointerdown came from
               CANVAS#id_viewer_overlay. On ordinary nodes (buttons, fields) both
               come, so we listen to the same name everywhere — otherwise closing
               by a click elsewhere would not work exactly where it is needed most.

               This concerns not only us: any shell popover that closes
               on a click on document will not close over the canvas. */
            var DOWN = ('onpointerdown' in window) ? 'pointerdown' : 'mousedown';

            /* Silencing the engine's keyboard interception. The press — because
               focus comes late; focusin — because on Tab between fields
               there is no press at all. */
            $pop.on(DOWN, function () { me.enableKeys(false); });
            $pop.on('focusin',   function () { me.enableKeys(false); });
            $pop.on('focusout',  function () {
                setTimeout(function () {
                    if ($pop.hasClass('open') && $pop[0].contains(document.activeElement)) return;
                    /* A return of focus to the button is in progress — the interception is managed by
                       close(), turning it on here would mean giving focus to
                       the engine exactly at the moment when it is being taken back. */
                    if (restoring) return;
                    var $btn = me.ctrl && me.ctrl.link;
                    if ($btn && $btn.length && $btn[0] === document.activeElement) return;
                    me.enableKeys(true);
                }, 0);
            });

            /* We close by a click elsewhere. We listen to the press, not click: the popup
               is opened from other handlers' clicks (the "/" menu, the
               "Insert" menu, the bubble), and a click listener would close it with the same
               event by which it opened. */
            $(document).on(DOWN, function (e) {
                if (!$pop.hasClass('open')) return;
                if ($pop[0].contains(e.target)) return;
                var $btn = me.ctrl && me.ctrl.link;
                if ($btn && $btn.length && $btn[0].contains(e.target)) return;
                close(false);
            });

            $(window).on('resize', function () { if ($pop.hasClass('open')) place(); });

            this._linkUI = {
                open: open,
                close: close,
                isOpen: function () { return $pop.hasClass('open'); },
                el: $pop
            };
            return this._linkUI;
        },

        /* The "Comment" button on the panel is a toggle: with the panel closed it
           adds a comment (and thereby opens the panel), with it open —
           closes it, like a repeated click on the magnifier closes the search bar.
           We close with the same stock left-menu button that we opened with:
           its handler removes the panel and sends layout:changed. */
        toggleComments: function () {
            var shell = DE.Views.CompactShell;
            var stock = shell.stockLeftBtn('comments');
            if (stock && stock.pressed) { shell.toggleLeftPanel('comments'); return; }
            this.run('insert.comment');
        },

        /* The pressed state of the "Comment" button = the comments panel is open. It is set
           by CompactShell.syncLeftState, through which all paths of
           opening and closing the panel go, including the X button inside it. */
        setCommentsOpen: function (open) {
            var b = this.ctrl.comment;
            b && b.toggleClass('on', !!open).attr('aria-pressed', open ? 'true' : 'false');
        },

        /* --- State from stock callbacks -------------------------------- */

        bindApi: function () {
            var me = this, c = this.ctrl, api = this.api;

            /* The link window is requested by the catalog ("Insert → Link", "/", the bubble,
               the row button) — by a notification, so that the catalog does not call the row.
               The subscription is one per module: bindApi is called on every shell build. */
            var NC = window.Common && Common.NotificationCenter;
            if (!this._linkBound && NC && typeof NC.on === 'function') {
                this._linkBound = true;
                NC.on('compact:link', function () { DE.Views.CompactToolbar.insertLink(); });
            }

            var on = function (name, fn) {
                try { api.asc_registerCallback(name, fn); } catch (e) { /* no callback */ }
            };
            var toggle = function (btn, v) { btn && btn.toggleClass('on', !!v); };

            on('asc_onCanUndo',   function (v) { c.undo.prop('disabled', !v); });
            on('asc_onCanRedo',   function (v) { c.redo.prop('disabled', !v); });
            on('asc_onBold',      function (v) { toggle(c.bold, v); });
            on('asc_onItalic',    function (v) { toggle(c.italic, v); });
            on('asc_onUnderline', function (v) { toggle(c.underline, v); });
            on('asc_onStrikeout', function (v) { toggle(c.strike, v); });
            on('asc_onVerticalAlign', function (v) {
                /* Reverse reading by the same names: the indicator was mixed up
                   mirror-wise — text made superscript by a hotkey
                   or in the extended interface highlighted "subscript". */
                toggle(c.sup, v === Asc.vertalign_SuperScript);
                toggle(c.sub, v === Asc.vertalign_SubScript);
            });
            on('asc_onFontSize', function (v) { me.setOption(c.size, v); });
            /* Zoom was not listened to at all before, and the caption diverged from
               the engine on Ctrl+wheel and on fitting to width or page.
               The callback signature is (percent, type), where type 1 and 2 are
               fits (controller/Statusbar.js:218, controller/ViewTab.js:72);
               we need only the percent. A fractional fit percent does not get into the list —
               then a caption without a selected row is shown. */
            on('asc_onZoomChange', function (percent) {
                me.setOption(c.zoom, Math.round(percent));
            });
            on('asc_onFontFamily', function (f) {
                me.setOption(c.font, f && (f.get_Name ? f.get_Name() : f));
            });
            on('asc_onParaStyleName', function (n) { me._style = n; me.setHeading(n); });
            /* The format painter is a mode: the engine itself turns it off after
               applying, so we read the state from it and do not store it. */
            on('asc_onPaintFormatChanged', function (v) { toggle(c.paint, v); });
            /* The marker is a mode too, and for the same reason the state is the engine's:
               it turns it off without our participation (Esc, undo, view change). SetMarkerFormat
               itself sends no event, so TURNING ON is marked by whoever
               gave the command (colorBtn of the marker), and this callback comes
               next and corrects — exactly as in the stock onApiStartHighlight
               (controller/Toolbar.js:509,1114). */
            on('asc_onMarkerFormatChanged', function (v) { me.setMarker(v); });
            /* The selection highlight is the engine's too. It does not report a mixed one
               at all (sdkjs word/api.js, sync_TextHighLight is silent on
               undefined), and the mark would remain from the previous selection,
               so the recalculation is also on asc_onBold: it comes with each
               update of text properties (UpdateTextPr). */
            on('asc_onTextHighLight', function () { me.syncHighlight(); });
            on('asc_onBold', function () { me.syncHighlight(); });
            /* The text color is not a mode but an ordinary property, but the source of truth
               is the same: the engine. There is no local flag, the strip under "A" is driven by the
               callback, as in the stock code (controller/Toolbar.js:496). See
               setTextColor. */
            on('asc_onTextColor', function (clr) { me.setTextColor(clr); });
            on('asc_onInitEditorStyles', function (s) { me.fillStyles(s); });
            on('asc_onPrAlign', function (a) { me.setAlign(a); });
            /* The subscription to asc_onTextDirection is no longer here: there are no direction
               buttons left in the panel, they moved to the "View" menu,
               and there is nothing to highlight in it — the menu item does not show
               state. The reverse reading of alignment does not need it either:
               the direction there is POLLED from the engine at the moment of the callback, exactly
               as in the stock code, — see visualAlign. */
            /* And the second bug in the same place: sp.get_Value() was read, which
               asc_CParagraphSpacing does not have — get_Line/get_LineRule/
               get_Before/get_After are exported (apiCommon.js:8669). Because of the check for
               the presence of the method the handler silently exited, and the control never showed
               the current value. The logic is taken from the stock ribbon
               (controller/Toolbar.js:682): the value is meaningful only with the
               "multiple" rule. */
            on('asc_onParaSpacingLine', function (sp) {
                if (!sp || typeof sp.get_Line !== 'function') return;
                var auto = (window.Asc && Asc.linerule_Auto !== undefined) ? Asc.linerule_Auto : 1;
                var line = (sp.get_Line() === null || sp.get_LineRule() !== auto) ? -1 : sp.get_Line();
                /* We clear the mark ALWAYS, including when the current spacing
                   is not in the list (-1): the stock code in this same branch first calls
                   mnuLineSpace.clearAll(true), and exits after
                   (controller/Toolbar.js:682-686). The former early exit
                   left the mark of the previous paragraph, and the popover showed
                   "1.5" as the spacing of a paragraph where there is none — for example on
                   moving to a paragraph with "Exactly 18 pt" or on selecting paragraphs
                   with different spacings. setLineSpacing(-1) does not match any
                   value of the list and removes all marks. */
                me.setLineSpacing(line);
            });
            /* The engine does NOT broadcast the list type: there is no asc_onListType callback
               in the SDK at all — the name occurred only in this file, and the three list
               buttons that were here before the regrouping were never
               highlighted. The defect predates the reform, it was found when moving the state
               to the dropdown button: there the glyph is DECLARED an indicator, and a silently
               dead source would have made it a lie.

               The stock ribbon polls the state — three api calls in the
               asc_onFocusObject handler (controller/Toolbar.js,
               onApiFocusObject). We go the same way: the event comes on
               every caret movement, and it also feeds the selection bubble. */
            on('asc_onFocusObject', function () {
                if (!me.ctrl.listsBtn) return;
                me.setListType(me.currentListType());
            });

            /* The subscription to asc_onSendThemeColors is no longer here. It kept
               the document THEME COLORS up to date inside the stock
               ThemeColorPalette; our own grid does not show theme colors at all —
               this is a deliberate loss on moving to the stage palette.
               Bringing the theme back means bringing back
               the stock palette: there is nothing to recompute, the set is fixed. */

            if (window.styles) this.fillStyles(window.styles);
        },

        /* Built-in styles are addressed by the internal English name and
           shown translated: the stock ribbon takes the translation from
           translationTable of the Main controller (controller/Toolbar.js:3699,
           the table is built in controller/Main.js:112). We did not do this, and
           in the Russian interface the dropdown read "Heading 1", "No Spacing".
           The option value stays internal — put_Style expects exactly it. */
        /* The other paragraph styles of the document — under the four heading levels,
           behind a thin line.

           We filter by type: get_MergedStyles() gives character styles
           too (styletype_Character), and choosing them in a heading level list
           is meaningless — they were what created the feeling of a dump. The four
           levels already shown above are not repeated a second time. */
        fillStyles: function (styles) {
            if (!styles || !styles.get_MergedStyles) return;
            var me = this, $rest = this.ctrl.headingRest;
            if (!$rest) return;

            var $wrap = this.ctrl.headingPop.closest('.vo-pop-wrap');
            var shown = {};
            HEADINGS().forEach(function (h) { shown[h.style] = true; });

            $rest.empty();
            var added = 0;

            styles.get_MergedStyles().forEach(function (st) {
                var name = st.get_Name();
                if (shown[name]) return;
                if (typeof st.get_Type === 'function' && st.get_Type() !== STYLE_PARAGRAPH) return;
                $rest.append(me.headingItem(name, me.styleLabel(name), '', null, $wrap));
                added++;
            });

            $rest.toggleClass('vo-pop-rest-on', added > 0);
            /* The current style could have arrived before the list was filled. */
            if (this._style) this.setHeading(this._style);
        },

        /* We set the value on the <select> itself, not on what came: the control
           may come as a wrapper, and jQuery.val() on a <span> silently writes
           a property to the node — there would be no error, and the value would not be set.
           (The line spacing was the wrapped one; it moved to the alignment
           popover, but the caveat protects the next such one too.)

           An appended option no longer widens the row: all lists have a width
           (.vo-w-*), and a value not from the set — the engine
           also sends "1.0800000000000001" — runs into ellipsis and does not
           stretch the control. The line spacing was the only list without a
           set width and stretched to the longest option, and silently:
           the size of #vo-tb does not change from this, the observer does not fire, and
           the row overflowed until the nearest resize. Calling relayout() from here
           would be worse — the callback comes also with "…" open, where recalculation
           is forbidden and would exit at once, that is, exactly in the interesting case
           there would be no cure. */
        setOption: function ($ctrl, value, label) {
            if (!$ctrl || value === undefined || value === null || value === '') return;
            var api = $ctrl.data('voValue');
            if (api) api.set(value, label);
        },

        /* --- Texts ------------------------------------------------------------ */
        /* Defaults are English: the locale overrides them with a translation from
           `locale/<language>.json`, and the editor has 44 languages without
           a translation — this is what is shown there. The wording is checked against the stock one, where
           such a phrase already exists in the editor. */

        textAlignCenter: 'Align center',
        textAlignJust: 'Justified',
        textAlignLeft: 'Align left',
        textAlignRight: 'Align right',
        textAutoColor: 'Automatic',
        textBookmarks: 'Bookmarks',
        textBullets: 'Bulleted',
        textCancel: 'Cancel',
        textClose: 'Close',
        textColorCode: 'Color code',
        textCustomColor: 'Custom color',
        textDecreaseIndent: 'Decrease indent',
        textDisplay: 'Display',
        textDisplayHint: 'For example, the site name',
        textEnterUrl: 'Enter a URL',
        textExternalLink: 'External link',
        textHeading1: 'Heading 1',
        textHeading1Hint: 'Large',
        textHeading2: 'Heading 2',
        textHeading2Hint: 'Medium',
        textHeading3: 'Heading 3',
        textHeading3Hint: 'Small',
        textHeadings: 'Headings',
        textIncreaseIndent: 'Increase indent',
        textLinkSettings: 'Link settings',
        textLinkTo: 'Link to',
        textMarkerOff: 'Turn off marker',
        textMultilevel: 'Multilevel',
        textNoBookmarks: 'No bookmarks',
        textNoFill: 'No fill',
        textNoHeadings: 'No headings',
        textNormal: 'Normal text',
        textNormalHint: 'Body',
        textNumbering: 'Numbered',
        textOk: 'OK',
        textPlaceInDocument: 'Place in document',
        textSelectedText: 'Selected text',
        textTooltip: 'Tooltip text',
        textTooltipHint: 'For example, opens in a new tab',
        textTopOfDocument: 'Beginning of document',
        textUrlInvalid: 'The address must look like http://www.example.com',
        textUrlTooLong: 'The address is longer than {0} characters',
        tipAlignment: 'Alignment',
        tipBold: 'Bold',
        tipClearStyle: 'Clear formatting',
        tipComment: 'Comment',
        tipFocus: 'Focus mode',
        tipFontColor: 'Font color',
        tipFontName: 'Font',
        tipFontSize: 'Font size',
        tipHighlight: 'Highlight color',
        tipImage: 'Image',
        tipItalic: 'Italic',
        tipLineSpacing: 'Line spacing',
        tipLink: 'Link',
        tipLists: 'Lists and indents',
        tipMore: 'More',
        tipPaintFormat: 'Copy formatting',
        tipParagraphStyle: 'Paragraph style',
        tipRedo: 'Redo',
        tipSearch: 'Find',
        tipStrikeout: 'Strikethrough',
        tipSubscript: 'Subscript',
        tipSuperscript: 'Superscript',
        tipTable: 'Table',
        tipUndo: 'Undo',
        tipUnderline: 'Underline',
        tipZoom: 'Zoom'

    }, DE.Views.CompactToolbar || {});

    return DE.Views.CompactToolbar;
});
