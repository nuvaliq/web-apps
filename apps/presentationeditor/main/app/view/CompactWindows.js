/*
 * CompactWindows — presentation editor windows in the Compact shell on the
 * Air template.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The mechanics are as in the Compact windows of documents
 * (documenteditor/main/app/view/CompactWindows.js): the module puts the recipe
 * on an INSTANCE of the stock window — the template and window label (vo-win vo-win--<id> on
 * .asc-window), the width and the behavior. The look is drawn by the styles of compact-windows.less under
 * body.vo-compact and the label. A window not in the registry and any window in the "Stock
 * interface" stay stock.
 *
 * The window texts do not change: button captions, titles and field captions are
 * stock. This differs from documents, where the main button gets the
 * caption "Apply".
 *
 * The stock is not changed. The class prototypes, buttonsParsed and options are shared — by
 * all instances and by the "Stock interface", and a write there would leak past
 * the mode check. Only initConfig is the instance's own (Window.js:684),
 * so before the first render the recipe writes only into it, and the rest is done by
 * the render wrapper on the instance itself: right after rendering and before
 * centering (show(), Window.js:826).
 *
 * The shell's own window "Document Info" (DocInfoWindow) is on the same
 * template: the recipe recognizes it by the window class. "About" is the shared
 * Compact window of the editors (Common.UI.Compact.AboutWindow) with its own styles
 * (common/main/resources/less/compact/about.less): the template does not dress it.
 * Both windows are opened by the shell commands that the zone registers in
 * install (CompactShell.command).
 *
 * The frame (CompactShell) installs the zone by calling install(shell) in the order of
 * CompactShell.ZONES; on startup rollback it calls unbind().
 */
define([
    'common/main/lib/view/compact/AboutWindow',
    'presentationeditor/main/app/view/DocInfoWindow'
], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    var LABEL = 'vo-win';

    /* Template icons: the checkbox tick, the header cross, the list chevron, the tick
       in a circle at the selected menu item and the message window icon.
       The names are files of the shared set of editors (apps/common/main/resources/img/air),
       the variables are --vo-win-ico-<name>. */
    var ICONS = ['check', 'close', 'chevron', 'accept', 'info'];
    var AIR_BASE = '../../common/main/resources/img/air/';

    /* A recipe failure of one window will repeat on every opening with the same
       reason — we report it once per window, like the shell's guarded. */
    var warned = {};

    /* vo-win-sized — a window whose size is driven by the stock (stretched with the mouse,
       the inner parts are computed from the window height): the template does not make its height
       "by content". */
    function labels(recipe) {
        return LABEL + ' ' + LABEL + '--' + recipe.id + (recipe.sized ? ' ' + LABEL + '-sized' : '');
    }

    /* Five advanced-settings windows on Common.Views.AdvancedSettingsWindow
       — one recipe, one width. */
    var ADVANCED = ['ParagraphSettingsAdvanced', 'ShapeSettingsAdvanced', 'ImageSettingsAdvanced',
        'TableSettingsAdvanced', 'ChartSettingsAdvanced'];

    function recipeOf(win) {
        var list = PE.Views.CompactWindows.RECIPES || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].id === win._voWin) return list[i];
        }
        return null;
    }

    function rectOf(id) {
        var el = document.getElementById(id);
        if (!el || typeof el.getBoundingClientRect !== 'function') return null;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r : null;
    }

    function pick(win) {
        var list = PE.Views.CompactWindows.RECIPES || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].match(win)) return list[i];
        }
        return null;
    }

    /* The disabled state is read from the node, not isDisabled(): a window may disable
       the main button through another Button instance on the same node, and the flag of our
       object does not know about it. */
    function isOff(btn) {
        return !!btn && (btn.cmpEl.hasClass('disabled') || btn.cmpEl.is(':disabled'));
    }

    /* Lower size bound: the window is not smaller than the template fields need, nor
       smaller than its own — a size stretched by the user does not shrink.
       The mouse-stretch bound (the stock minwidth, minheight) is raised
       to the same value. */
    function atLeast(cfg, keys, min) {
        if (!min) return;
        for (var i = 0; i < keys.length; i++) {
            if (typeof cfg[keys[i]] === 'number' && cfg[keys[i]] < min) cfg[keys[i]] = min;
        }
    }

    /* Sizes that the recipe may raise: its own, the stretch bound and
       the "initial" one — the stock returns the chart editor window to it before
       every show (DocumentHolderExt.js:1612, initwidth, initheight). */
    var WIDTHS = ['width', 'minwidth', 'initwidth'],
        HEIGHTS = ['height', 'minheight', 'initheight'];

    function dress(win, recipe) {
        var cfg = win.initConfig;
        var saved = {cls: cfg.cls, keydown: cfg.keydowncallback};
        _.each(WIDTHS.concat(HEIGHTS), function (k) { if (k in cfg) saved[k] = cfg[k]; });

        cfg.cls = (cfg.cls ? cfg.cls + ' ' : '') + labels(recipe);
        if (recipe.width) cfg.width = recipe.width;
        atLeast(cfg, WIDTHS, recipe.minWidth);
        atLeast(cfg, HEIGHTS, recipe.minHeight);
        win._voWin = recipe.id;
        win._voWidth = cfg.width !== saved.width ? cfg.width : null;
        win._voHeight = cfg.height !== saved.height ? cfg.height : null;

        var render = win.render;
        win.render = function () {
            /* An exception of the render itself is not ours — we do not swallow it: without it
               the window would be broken in the stock too. */
            var res = render.apply(this, arguments);
            try {
                finish(this, recipe);
            } catch (e) {
                /* Rollback is best effort: the original reason goes outward,
                   not the failure of the rollback itself. */
                try { undress(this, recipe, saved); } catch (ignore) {}
                if (!warned[recipe.id]) {
                    warned[recipe.id] = true;
                    if (window.console && console.warn)
                        console.warn('Compact shell: "windows: ' + recipe.id + '" failed, the window stays stock.', e);
                }
            }
            return res;
        };
    }

    function finish(win, recipe) {
        PE.Views.CompactWindows.guardEnter(win);
        if (typeof recipe.apply === 'function') recipe.apply(win);
    }

    /* "The window stays stock" — means to return everything the recipe managed to
       put on: labels, size, stretch bounds and the key handler. */
    function undress(win, recipe, saved) {
        var cfg = win.initConfig, $w = win.$window;
        cfg.cls = saved.cls;
        _.each(WIDTHS.concat(HEIGHTS), function (k) {
            if (k in saved) cfg[k] = saved[k];
            else delete cfg[k];
        });
        cfg.keydowncallback = saved.keydown;
        if ($w) {
            $w.removeClass(labels(recipe));
            /* The size in the markup is returned only if it is still ours, from the
               template: the window could have set its own by content
               (AdvancedSettingsWindow.js:105, autoSize of a message window), and
               wiping it with the value from the config would break the stock one. */
            if (win._voWidth && $w[0].style.width === win._voWidth + 'px')
                $w.css('width', typeof saved.width === 'number' ? saved.width + 'px' : '');
            if (win._voHeight && $w[0].style.height === win._voHeight + 'px')
                $w.css('height', typeof saved.height === 'number' ? saved.height + 'px' : '');
        }
    }

    function paintError(field, errors) {
        var $el = field.cmpEl;
        var node = $el && $el.find('.input-error').first();
        if (!node || !node.length) return;

        var id = node.attr('id');
        if (!id) {
            id = 'vo-err-' + field.cid;
            node.attr('id', id);
        }
        var input = field._input && field._input.length ? field._input : $el.find('input').first();
        var by = _.compact((input.attr('aria-describedby') || '').split(/\s+/));
        if (_.indexOf(by, id) < 0) input.attr('aria-describedby', by.concat(id).join(' '));

        node.text(errors.join(' '));
    }

    function has(name) {
        return !!(PE.Views[name]) && typeof PE.Views[name] === 'function';
    }

    function common(name) {
        return !!(window.Common && Common.Views && typeof Common.Views[name] === 'function');
    }

    function ui(name) {
        return !!(window.Common && Common.UI && typeof Common.UI[name] === 'function');
    }

    PE.Views.CompactWindows = _.extend({

        shell: null,
        bound: false,         // we listen to modal:show; unbind removes it
        ICONS: ICONS,

        /* Registry of windows on the template: {id, match(win) → bool, width?, apply(win)?,
           sized?, minWidth?, minHeight?, shown(win)?}. sized — the window size
           is driven by the stock, minWidth and minHeight — the lower bound of its size,
           shown — a correction after every show (window:show).
           The first recipe with a true match is taken. The window class in match
           is checked for existence: some stock windows are loaded later than this
           module. The look rules are in compact-windows.less under the label
           vo-win--<id>, in the section "Windows on the template". */
        RECIPES: [
            /* Message windows: Common.UI.alert and its kinds warning, error,
               confirm, info (Window.js:509–676). They have no class of their own —
               it is Common.UI.Window, to which alert itself sets cls 'alert' and
               the role alertdialog (Window.js:527–533). The alert window width
               is computed by alert itself from the text in render:after (autoSize) — already by
               the template styles, so the recipe has no width of its own; the width
               limit and the margins are by styles (.vo-win--msg). */
            {
                id: 'msg',
                match: function (win) {
                    var cfg = win && win.initConfig;
                    return !!cfg && cfg.role === 'alertdialog' && /(^|\s)alert(\s|$)/.test(cfg.cls || '');
                }
            },
            /* "Link Settings". The tabs, fields and the slide list are stock,
               the look is by markup and styles (.vo-win--link). The recipe moves the address
               error to the field edge. The window is opened by "Insert → Link",
               Ctrl+K, the panel button and the context menu (Toolbar.js:1879,
               DocumentHolderExt.js:687, :713, :1536, :1565) — the same
               class everywhere. */
            {
                id: 'link',
                match: function (win) { return PE.Views.CompactWindows.isView(win, 'HyperlinkSettingsDialog'); },
                width: 420,
                apply: function (win) {
                    if (!win.inputUrl || typeof win.inputUrl.checkValidate !== 'function') throw new Error('no address field');
                    PE.Views.CompactWindows.edgeError(win.inputUrl);
                }
            },
            /* "Image from URL" — a window without a header (TextInputDialog.js:163),
               and it stays so: a header can only be given by editing the stock. The same
               class is opened by "Insert → Image", the right panel of
               a picture, shape, slide and Text Art (Toolbar.js:1941,
               ImageSettings.js:464, ShapeSettings.js:774, SlideSettings.js:722,
               TextArtSettings.js:741). The recipe moves the address error to the
               field edge. */
            {
                id: 'imgurl',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'ImageFromUrlDialog'); },
                width: 420,
                apply: function (win) {
                    if (!win.inputLabel || typeof win.inputLabel.checkValidate !== 'function') throw new Error('no address field');
                    PE.Views.CompactWindows.edgeError(win.inputLabel);
                }
            },
            /* "Table Size" and "Split Cell" — one class, the title
               is set by the stock on entry (InsertTableDialog.js:58). Entries:
               "Insert → Table ▸ Custom Table" (Toolbar.js:1907)
               and "Split Cell" of the context menu and the menu row
               (DocumentHolderExt.js:2098), the right table panel
               (TableSettings.js:201). The behavior is stock, the look — by styles
               (.vo-win--table). */
            {
                id: 'table',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'InsertTableDialog'); },
                width: 420
            },
            /* "Copy, Cut and Paste Actions" — a warning about the tab
               clipboard, opened by "Edit → Copy, Cut,
               Paste", the panel buttons and the context menu (Toolbar.js:1288,
               DocumentHolderExt.js:1657). The behavior is stock, the look — by styles
               (.vo-win--copywarn). The width is larger than usual: at 420 the window
               title does not fit on a line, and three shortcuts do not fit in a row. */
            {
                id: 'copywarn',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'CopyWarningDialog'); },
                width: 480
            },
            /* "Date and Time" — "Insert → Date and Time" with the cursor in text
               (Toolbar.js:2084). The stock puts "Set as default"
               to the right of the checkbox, and when the width is short it removes float and
               shortens the list to 139 (DateTimeDialog.js:152–155), without
               changing the window height — the button overlaps "OK". Here the layout
               is one at any width (.vo-win--datetime): the button under the checkbox,
               the window grows by content. */
            {
                id: 'datetime',
                match: function (win) { return PE.Views.CompactWindows.isView(win, 'DateTimeDialog'); },
                width: 420
            },
            /* "Symbol" — "Insert → Symbol" (Toolbar.js:2473), the tabs
               "Symbols · Special Characters". The window is stretched with the mouse, and
               the symbol grid, the recent ones and the list of special characters are
               computed by the stock itself from the height of the window, header and footer
               (SymbolTableDialog.js:782–791, :1480–1493): the recipe does not touch
               the markup, the height is driven by the stock (vo-win-sized), the look — by styles
               (.vo-win--symbol). The grid cell stays 31 × 33 (CELL_WIDTH,
               CELL_HEIGHT of the stock): the stock computes columns and rows from it. The window is
               not smaller than the one into which, with the template margins, the same 13
               columns and 4 grid rows fit as in the stock; a size stretched by
               the user (the stock remembers it) is not reduced by the recipe. */
            {
                id: 'symbol',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'SymbolTableDialog'); },
                sized: true,
                minWidth: 480,
                minHeight: 543
            },
            /* "Header and Footer Settings" — "Insert →
               Header & Footer" and "Slide Number", "Date and Time" without the cursor in
               text (Toolbar.js:2099), printing (Print.js:398). The window is on
               AdvancedSettingsWindow, but the column on the right is not tabs but a
               preview: the stock draws it in its own node. The look — by styles
               (.vo-win--hf). */
            {
                id: 'hf',
                match: function (win) { return PE.Views.CompactWindows.isView(win, 'HeaderFooterDialog'); }
            },
            /* Advanced settings of a paragraph, shape, image, table
               and chart — the context menu and the right panel
               (DocumentHolderExt.js:2172–2371, ParagraphSettings.js:364 and
               neighbors, Toolbar.js:1683). The "tabs on the left" template, one width
               for all five: the window width is computed by the stock from the column and
               sections (AdvancedSettingsWindow.js:105), so it is set
               by the section width in the styles (.vo-win--adv). */
            {
                id: 'adv',
                match: function (win) {
                    var M = PE.Views.CompactWindows;
                    return _.some(ADVANCED, function (name) { return M.isView(win, name); });
                }
            },
            /* "Chart Editor" — the chart data: right click on the
               chart → "Edit Data", the panel button
               (DocumentHolderExt.js:1603). Inside is the stock spreadsheet editor in
               its own frame, its template does not touch: only the window frame. The size
               is driven by the stock (the window is stretched, the frame reports its size,
               ExternalEditor.js:157–181). The stock places the window at the chart and in
               Compact lands on the shell header (DocumentHolderExt.js:
               1608–1630) — after every show the window is centered in
               the work area, below the header. */
            {
                id: 'chartdata',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'ExternalDiagramEditor'); },
                sized: true,
                minHeight: 300,
                shown: function (win) { PE.Views.CompactWindows.centreOverWork(win); }
            },
            /* "More Colors" — the item "Add new custom color"
               of any palette: font, fill and outline of a shape, slide background,
               table, chart (ThemeColorPalette, ColorButton →
               Common.UI.ExtendedColorDialog). A window without a header (the stock
               header: false) stays so. The shade field and the color strip are drawn by
               the stock in percent of its own sizes (HSBColorPicker.js:138,
               :158), so the field stretches to fit the column on the right. The look —
               by styles (.vo-win--color). */
            {
                id: 'color',
                match: function (win) { return PE.Views.CompactWindows.isUI(win, 'ExtendedColorDialog'); },
                width: 444
            },
            /* "List Settings" — "Format → Bullets and Numbering" and the galleries
               of bullets and numbering on the panel (Toolbar.js, mnuListSettings).
               The window height is set by the stock as a number (261) — the template drives it by
               content: the rows "Start at", "Import" and "Color" are hidden and
               shown by the stock according to the list type. The look — by styles (.vo-win--listsettings). */
            {
                id: 'listsettings',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'ListSettingsDialog'); },
                width: 420
            },
            /* "Slide Size Settings" — "Slide → Slide Size ▸
               Custom Slide Size" (Toolbar.js, onSlideSize). The behavior is
               stock, the look — by styles (.vo-win--slidesize). */
            {
                id: 'slidesize',
                match: function (win) { return PE.Views.CompactWindows.isView(win, 'SlideSizeSettings'); },
                width: 420
            },
            /* "Document Language" — "Edit → Document Language" (the review
               button, ReviewChanges.js:1052). A window without a header (the stock header:
               false) stays so. The look — by styles (.vo-win--lang). */
            {
                id: 'lang',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'LanguageDialog'); },
                width: 420
            },
            /* "Document Info" — the shell's own window (DocInfoWindow) with
               the stock info panel inside: the docInfo command, "File →
               Document Info". No footer, the look — by styles
               (.vo-win--docinfo). */
            {
                id: 'docinfo',
                match: function (win) { return PE.Views.CompactWindows.hasCls(win, 'vo-docinfo-dlg'); }
            },
            /* "Slide Show Settings" — the arrow at "Slide Show"
               (Toolbar.js, onPreviewItemClick): one checkbox. The look — by styles
               (.vo-win--showsettings). */
            {
                id: 'showsettings',
                match: function (win) { return PE.Views.CompactWindows.isView(win, 'SlideshowSettings'); },
                width: 420
            },
            /* "Grid Settings" — "View → Gridlines ▸ Custom"
               (ViewTab.js, onGridlinesCustom): the spacing is a list and
               a counter. The look — by styles (.vo-win--grid). */
            {
                id: 'grid',
                match: function (win) { return PE.Views.CompactWindows.isView(win, 'GridSettings'); },
                width: 420
            },
            /* "Adjust Shadow" — the right shape panel: "Shadow ▸ Adjust
               Shadow" (ShapeSettings.js:1939). The window width is computed by the stock from
               the section — it is set by its width in the styles (.vo-win--shadow). */
            {
                id: 'shadow',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'ShapeShadowDialog'); }
            },
            /* "New Document Property" and editing an own property — "Add
               Property" and the property field in "Document Info"
               (FileMenuPanels.js, DocumentInfo). The recipe moves the name and
               value errors to the field edge. The look — by styles
               (.vo-win--docprop). */
            {
                id: 'docprop',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'DocumentPropertyDialog'); },
                width: 420,
                apply: function (win) {
                    if (!win.inputTitle || typeof win.inputTitle.checkValidate !== 'function') throw new Error('no name field');
                    PE.Views.CompactWindows.edgeError(win.inputTitle);
                    if (win.inputTextOrNumber && typeof win.inputTextOrNumber.checkValidate === 'function')
                        PE.Views.CompactWindows.edgeError(win.inputTextOrNumber);
                }
            },
            /* "Number Format" — the "Label Format" button on the axis tabs
               of the "Chart — Advanced Settings" window
               (ChartSettingsAdvanced.js → Common.Views.FormatSettingsDialog).
               A window on AdvancedSettingsWindow without a section column: the window
               width is computed by the stock from the section, the section height is kept by its own
               (contentHeight) — both are set in the styles (.vo-win--axisformat). */
            {
                id: 'axisformat',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'FormatSettingsDialog'); }
            },
            /* "AutoCorrect" — "File → Advanced Settings → AutoCorrect
               Options" (FileMenuPanels.js, Settings). The "tabs
               on the left" template; the window width is computed by the stock from the sections, the height is kept by
               its own (contentHeight) — both are set in the styles
               (.vo-win--autocorrect). */
            {
                id: 'autocorrect',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'AutoCorrectDialog'); }
            },
            /* "Keyboard Shortcuts" — "File → Advanced Settings → Keyboard
               Shortcuts: Customize" (FileMenuPanels.js, Settings). A window on
               AdvancedSettingsWindow without a section column and without a footer:
               the width is computed by the stock from the section — it is set in the styles
               (.vo-win--shortcuts). */
            {
                id: 'shortcuts',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'ShortcutsDialog'); }
            },
            /* "Macros" — "View → Macros ▸ Macros" (ViewTab.js →
               Common.Views.MacrosDialog). The window is stretched with the mouse, and
               the editor inside is laid out by the stock from the window height: the size is driven by
               the stock (vo-win-sized). The template is only a frame: header, cross,
               footer; the macro list, the button panel and the code editor are
               stock. The look — by styles (.vo-win--macros). */
            {
                id: 'macros',
                match: function (win) { return PE.Views.CompactWindows.isCommon(win, 'MacrosDialog'); },
                sized: true
            }
        ],

        install: function (shell) {
            var me = this, nc = Common.NotificationCenter;
            if (this.shell) {
                this.bound = true;
                this.setActive(!shell.advanced);
                return this;
            }
            this.shell = shell;
            this.bound = true;

            nc.on('modal:show', shell.guarded('windows: modal:show', function (win) {
                if (!me.bound || !win || !win.initConfig) return;
                if (shell.advanced || !document.body.classList.contains('vo-compact')) return;
                /* The recipe is written only before the first render. A window already
                   rendered earlier (for example, first opened in the "Stock
                   interface") stays as it was: repainting ready
                   markup is another mechanism, and it is not here. */
                if (win._voWin || win.$window) return;

                var recipe = pick(win);
                if (recipe) dress(win, recipe);
            }));
            /* The stock finishes the show of a window with window:show — after it has
               put the window in place (Window.js:805–897). For a recipe with shown
               this is the last point to correct the place; a repeated show of the same
               window (the chart editor is hidden, not closed) goes
               here too. */
            nc.on('window:show', shell.guarded('windows: window:show', function (win) {
                if (!me.bound || !win || !win._voWin || !win.$window) return;
                if (shell.advanced || !document.body.classList.contains('vo-compact')) return;
                var recipe = recipeOf(win);
                /* A window rolled back to the stock after a recipe failure, without the label. */
                if (!recipe || !win.$window.hasClass(LABEL + '--' + recipe.id)) return;
                if (typeof recipe.shown === 'function') recipe.shown(win);
            }));
            if (typeof shell.command === 'function') {
                shell.command('about', shell.guarded('windows: about', function () { return me.about(); }));
                shell.command('docInfo', shell.guarded('windows: document info', function () { return me.docInfo(); }));
            }
            nc.on('shell:advanced', shell.guarded('windows: stock interface', function (advanced) {
                if (me.bound) me.setActive(!advanced);
            }));

            this.setActive(!shell.advanced);
            return this;
        },

        /* Startup rollback: windows are no longer dressed, the document root gives
           the dimming back to the stock. */
        unbind: function () {
            this.bound = false;
            this.setActive(false);
        },

        /* Dimming and template icons — variables on the document root.
           The mask opacity is read by the stock from :root BEFORE modal:show (Window.js:811,
           :822), so it cannot be set from a handler — only beforehand,
           together with vo-compact. The icon addresses are absolute from the document, as
           in Common.UI.Compact.Icons: a relative url() inside var() would be resolved
           from the consumer's stylesheet. Turning off removes everything
           that was set, and the stock again reads its own values from :root. */
        setActive: function (on) {
            var root = document.documentElement, style = root && root.style;
            if (!style || typeof style.setProperty !== 'function') return;
            var i;
            if (on) {
                var base = document.baseURI ? new URL(AIR_BASE, document.baseURI).href : '';
                style.setProperty('--modal-window-mask-opacity', '0.5');
                for (i = 0; base && i < ICONS.length; i++)
                    style.setProperty('--vo-win-ico-' + ICONS[i], 'url(' + base + ICONS[i] + '.svg)');
            } else {
                style.removeProperty('--modal-window-mask-opacity');
                for (i = 0; i < ICONS.length; i++)
                    style.removeProperty('--vo-win-ico-' + ICONS[i]);
            }
        },

        primary: function (win) {
            if (!win || !win.$window || typeof win.getFooterButtons !== 'function') return null;
            var btns = win.getFooterButtons() || [];
            for (var i = 0; i < btns.length; i++) {
                if (btns[i] && btns[i].cmpEl && btns[i].cmpEl.hasClass('primary')) return btns[i];
            }
            return null;
        },

        /* The stock calls onPrimary on Enter, without looking at whether the main button is disabled
           (Window.js:230). The stock turns true from keydowncallback into
           return false (:209) — the press is swallowed entirely. So Enter on
           the second footer button is let through, as the stock does (:228): otherwise with
           a disabled main button "Cancel" would not work either. */
        guardEnter: function (win) {
            var me = this, cfg = win.initConfig, prev = cfg.keydowncallback;
            if (prev && prev._voEnter) return;

            var guard = function (e) {
                if (prev && prev.apply(this, arguments)) return true;
                if (!e || e.keyCode !== Common.UI.Keys.RETURN) return false;
                var target = $(e.target);
                if (target.hasClass('dlg-btn') && !target.hasClass('primary')) return false;
                return isOff(me.primary(win));
            };
            guard._voEnter = true;
            cfg.keydowncallback = guard;
        },

        /* The template shows a field error as text on the bottom edge, while the stock
           keeps it only in the icon tooltip (InputField.js:328–418).
           We do not touch the tooltip — on hover it gives the full text — and
           put the text of the same check into .input-error itself and link it to
           the field through aria-describedby. InputField is not changed: the
           instance methods are wrapped. */
        edgeError: function (field) {
            if (!field || field._voEdge) return field;
            field._voEdge = true;

            var paint = this.shell ? this.shell.guarded('windows: field error', paintError) : paintError;
            var check = field.checkValidate, show = field.showError;

            field.checkValidate = function () {
                var res = check.apply(this, arguments);
                paint(this, _.isArray(res) ? res : []);
                return res;
            };
            /* showWarning and the reset on input (hideErrorOnInput) go through
               this.showError — the wrapper catches them too. */
            field.showError = function (errors) {
                var res = show.apply(this, arguments);
                paint(this, _.isEmpty(errors) ? [] : errors);
                return res;
            };
            return field;
        },

        /* The window — in the center of the work area: the slide margins (#id_main_parent), and
           without it the editor area (#editor_sdk). The window top is not above
           the area top, that is, not on the shell header; a window taller than the area
           is placed from its top. A window that the stock keeps off the screen edge
           (a silent chart update shows it at -10000,
           ExternalDiagramEditor.js:302) is not touched. */
        centreOverWork: function (win) {
            var $w = win && win.$window;
            if (!$w || !$w.length) return;
            var area = rectOf('id_main_parent') || rectOf('editor_sdk');
            if (!area) return;
            var left = parseFloat($w.css('left')) || 0;
            var w = $w.outerWidth(), h = $w.outerHeight();
            if (left + w <= 0) return;

            var vw = window.innerWidth || document.documentElement.clientWidth;
            var x = Math.round(area.left + (area.width - w) / 2);
            var y = Math.round(area.top + Math.max(0, (area.height - h) / 2));
            x = Math.max(0, Math.min(x, vw - w));
            $w.css({left: x, top: y});
        },

        /* "About" — a window with legal information: the shared Compact window of
           the editors (Common.UI.Compact.AboutWindow), as in documents and
           spreadsheets. The title is the caption of the stock "About" button
           (LeftMenu.tipAbout). */
        about: function () {
            var C = window.Common && Common.UI && Common.UI.Compact, Ctor = C && C.AboutWindow;
            if (!this.bound || typeof Ctor !== 'function') return null;
            var left = PE.Views.LeftMenu && PE.Views.LeftMenu.prototype;
            var win = new Ctor({title: left && left.tipAbout});
            win.show();
            return win;
        },

        /* "Document Info" — a window with the stock info panel
           (DocInfoWindow). */
        docInfo: function () {
            var W = PE.Views.DocInfoWindow;
            return this.bound && W && typeof W.open === 'function' ? W.open() : null;
        },

        /* For recipes: the window class is loaded and the window is its instance; the window
           has a markup class. */
        hasCls: function (win, cls) {
            var cfg = win && win.initConfig;
            return !!cfg && (' ' + (cfg.cls || '') + ' ').indexOf(' ' + cls + ' ') >= 0;
        },
        isView: function (win, name) { return has(name) && win instanceof PE.Views[name]; },
        isCommon: function (win, name) { return common(name) && win instanceof Common.Views[name]; },
        isUI: function (win, name) { return ui(name) && win instanceof Common.UI[name]; }

    }, PE.Views.CompactWindows || {});

    return PE.Views.CompactWindows;
});
