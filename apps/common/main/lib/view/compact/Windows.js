/*
 * Windows — editor windows in the Compact shell on the Air template, shared mechanics.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The mechanics put the recipe on an INSTANCE of the stock window: the template and window label
 * (vo-win vo-win--<id> on .asc-window), the size and the behavior. The look is drawn by the styles
 * under body.vo-compact and the label: the template is less/compact/windows.less, the set for
 * the stock windows of the shared layer and their rules are less/compact/windows-stock.less.
 * A window not in the editor registry and any window in the stock interface stay
 * stock.
 *
 * The stock is not changed. The class prototypes, okButtonText, buttonsParsed and options
 * are shared — by all instances and by the stock interface, and a write there would leak
 * past the mode check. Only initConfig is the instance's own (Window.js:684),
 * so before the first render the recipe writes only into it, and the rest is done by
 * the render wrapper on the instance itself: right after rendering and before
 * centering (show(), Window.js:826).
 *
 * create(own) -> own. The editor passes its own windows object, the mechanics add to
 * it what it lacks and return the same object. The editor's own parts:
 *  - RECIPES — the registry of windows on the template. A recipe: {id, match(win, M) → bool,
 *    width?, apply(win, M)?, sized?, minWidth?, minHeight?, shown(win, M)?}.
 *    sized — the window size is driven by the stock (stretched with the mouse, the inner parts
 *    are computed from the window height): the template does not make its height "by content";
 *    minWidth and minHeight — the lower bound of its size; shown — a correction after
 *    every show (window:show). The first recipe with a true match is taken;
 *  - primaryCaption(win) → string or null — the caption of the main button of a window on
 *    the template; without it the captions are stock;
 *  - workAreas — ids of the editor work area nodes in order of preference: centreOverWork
 *    places the window by the first visible one.
 *
 * Shared windows (symbol, table, language, autocorrect and other windows of the shared layer)
 * are put on Air by each editor itself: it takes their recipes from stock(ids) into its
 * registry and includes windows-stock.less. An editor that does not take them
 * shows them stock.
 *
 * The mechanics do not import the shell: it comes as the bind(shell) argument and provides
 * guarded and the advanced flag.
 */
define([], function () {
    'use strict';

    if (window.Common === undefined) window.Common = {};
    if (Common.UI === undefined) Common.UI = {};
    if (Common.UI.Compact === undefined) Common.UI.Compact = {};

    if (Common.UI.Compact.Windows) return Common.UI.Compact.Windows;

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

    /* vo-win-sized — a window whose size is driven by the stock: the template does not make its
       height "by content". */
    function labels(recipe) {
        return LABEL + ' ' + LABEL + '--' + recipe.id + (recipe.sized ? ' ' + LABEL + '-sized' : '');
    }

    function recipeOf(M, win) {
        var list = M.RECIPES || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].id === win._voWin) return list[i];
        }
        return null;
    }

    function pick(M, win) {
        var list = M.RECIPES || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].match(win, M)) return list[i];
        }
        return null;
    }

    function rectOf(id) {
        var el = document.getElementById(id);
        if (!el || typeof el.getBoundingClientRect !== 'function') return null;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r : null;
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
       the "initial" one — the stock may return the window to it before every show
       (initwidth, initheight). */
    var WIDTHS = ['width', 'minwidth', 'initwidth'],
        HEIGHTS = ['height', 'minheight', 'initheight'];

    function dress(M, win, recipe) {
        var cfg = win.initConfig;
        var saved = {cls: cfg.cls, keydown: cfg.keydowncallback, btn: null, caption: null};
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
                finish(M, this, recipe, saved);
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

    function finish(M, win, recipe, saved) {
        if (typeof M.primaryCaption === 'function') {
            var caption = M.primaryCaption(win), btn = caption ? M.primary(win) : null;
            if (btn) {
                saved.btn = btn;
                saved.caption = btn.cmpEl.html();
                btn.setCaption(caption);
            }
        }
        M.guardEnter(win);
        if (typeof recipe.apply === 'function') recipe.apply(win, M);
    }

    /* "The window stays stock" — means to return everything the recipe managed to
       put on: labels, size, stretch bounds, the main button caption and
       the key handler. */
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
        if (saved.btn) saved.btn.setCaption(saved.caption);
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

    function common(name) {
        return !!(window.Common && Common.Views && typeof Common.Views[name] === 'function');
    }

    function ui(name) {
        return !!(window.Common && Common.UI && typeof Common.UI[name] === 'function');
    }

    /* The mechanics: methods and state of the editor windows object. this is that
       object. */
    var ENGINE = {

        shell: null,
        bound: false,         // we listen to modal:show and window:show; unbind removes it
        ICONS: ICONS,
        RECIPES: [],
        workAreas: ['editor_sdk'],
        primaryCaption: null,

        /* Windows start being dressed. A repeated call only turns it on again:
           the subscriptions stay from the first one. */
        bind: function (shell) {
            var me = this, nc = Common.NotificationCenter;
            this.bound = true;
            if (this.shell) return this;
            this.shell = shell;

            nc.on('modal:show', shell.guarded('windows: modal:show', function (win) {
                if (!me.bound || !win || !win.initConfig) return;
                if (shell.advanced || !document.body.classList.contains('vo-compact')) return;
                /* The recipe is written only before the first render. A window already
                   rendered earlier (for example, first opened in the stock
                   interface) stays as it was: repainting ready
                   markup is another mechanism, and it is not here. */
                if (win._voWin || win.$window) return;

                var recipe = pick(me, win);
                if (recipe) dress(me, win, recipe);
            }));
            /* The stock finishes the show of a window with window:show — after it has
               put the window in place (Window.js:805–897). For a recipe with shown
               this is the last point to correct the place; a repeated show of the same
               window (the window is hidden, not closed) goes here too. */
            nc.on('window:show', shell.guarded('windows: window:show', function (win) {
                if (!me.bound || !win || !win._voWin || !win.$window) return;
                if (shell.advanced || !document.body.classList.contains('vo-compact')) return;
                var recipe = recipeOf(me, win);
                /* A window rolled back to the stock after a recipe failure, without the label. */
                if (!recipe || !win.$window.hasClass(LABEL + '--' + recipe.id)) return;
                if (typeof recipe.shown === 'function') recipe.shown(win, me);
            }));
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
            var icons = this.ICONS || ICONS, i;
            if (on) {
                var base = document.baseURI ? new URL(AIR_BASE, document.baseURI).href : '';
                style.setProperty('--modal-window-mask-opacity', '0.5');
                for (i = 0; base && i < icons.length; i++)
                    style.setProperty('--vo-win-ico-' + icons[i], 'url(' + base + icons[i] + '.svg)');
            } else {
                style.removeProperty('--modal-window-mask-opacity');
                for (i = 0; i < icons.length; i++)
                    style.removeProperty('--vo-win-ico-' + icons[i]);
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

        /* The window — in the center of the editor work area (the first visible node of
           workAreas). The window top is not above the area top, that is, not on the shell
           header; a window taller than the area is placed from its top. A window that the stock
           keeps off the screen edge (a silent chart update shows it
           at -10000, ExternalDiagramEditor.js:302) is not touched. */
        centreOverWork: function (win) {
            var $w = win && win.$window;
            if (!$w || !$w.length) return;
            var ids = this.workAreas || [], area = null;
            for (var i = 0; !area && i < ids.length; i++) area = rectOf(ids[i]);
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

        /* For recipes: the window has a markup class; the window class is loaded and
           the window is its instance. The class is checked for existence: some stock
           windows are loaded later than the windows module. */
        hasCls: function (win, cls) {
            var cfg = win && win.initConfig;
            return !!cfg && (' ' + (cfg.cls || '') + ' ').indexOf(' ' + cls + ' ') >= 0;
        },
        isCommon: function (win, name) { return common(name) && win instanceof Common.Views[name]; },
        isUI: function (win, name) { return ui(name) && win instanceof Common.UI[name]; }
    };

    /* --- Shared window recipes ------------------------------------------------ */
    /* Windows of the shared layer (Common.Views, Common.UI). Each editor has its own
       entries, the window class is one. The look rules are in windows-stock.less under the label
       vo-win--<id>. */
    var STOCK_RECIPES = [
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
        /* "Image from URL" — a window without a header (TextInputDialog.js:163),
           and it stays so: a header can only be given by editing the stock. The recipe
           moves the address error to the field edge. */
        {
            id: 'imgurl',
            match: function (win, M) { return M.isCommon(win, 'ImageFromUrlDialog'); },
            width: 420,
            apply: function (win, M) {
                if (!win.inputLabel || typeof win.inputLabel.checkValidate !== 'function') throw new Error('no address field');
                M.edgeError(win.inputLabel);
            }
        },
        /* "Table Size" and "Split Cell" — one class, the title
           is set by the stock on entry (InsertTableDialog.js:58). The behavior is
           stock, the look — by styles (.vo-win--table). */
        {
            id: 'table',
            match: function (win, M) { return M.isCommon(win, 'InsertTableDialog'); },
            width: 420
        },
        /* "Copy, Cut and Paste Actions" — a warning about the tab
           clipboard. The behavior is stock, the look — by styles
           (.vo-win--copywarn). The width is larger than usual: at 420 the window
           title does not fit on a line, and three shortcuts do not fit in a row. */
        {
            id: 'copywarn',
            match: function (win, M) { return M.isCommon(win, 'CopyWarningDialog'); },
            width: 480
        },
        /* "Symbol", the tabs "Symbols · Special Characters". The window
           is stretched with the mouse, and the symbol grid, the recent ones and the list
           of special characters are computed by the stock itself from the height of the window, header and
           footer (SymbolTableDialog.js:782–791, :1480–1493): the recipe does not
           touch the markup, the height is driven by the stock (vo-win-sized), the look — by styles
           (.vo-win--symbol). The grid cell stays 31 × 33 (CELL_WIDTH,
           CELL_HEIGHT of the stock): the stock computes columns and rows from it. The window is
           not smaller than the one into which, with the template margins, the same 13
           columns and 4 grid rows fit as in the stock; a size stretched by
           the user (the stock remembers it) is not reduced by the recipe. */
        {
            id: 'symbol',
            match: function (win, M) { return M.isCommon(win, 'SymbolTableDialog'); },
            sized: true,
            minWidth: 480,
            minHeight: 543
        },
        /* "Chart Editor" — the chart data. Inside is the stock spreadsheet editor in
           its own frame; the template does not touch it, only the window frame.
           The size is driven by the stock (the window is stretched, the frame reports its size,
           ExternalEditor.js:157–181). The stock places the window at the chart, and in
           Compact it lands on the shell header — after every show the window
           is centered in the work area, below the header. */
        {
            id: 'chartdata',
            match: function (win, M) { return M.isCommon(win, 'ExternalDiagramEditor'); },
            sized: true,
            minHeight: 300,
            shown: function (win, M) { M.centreOverWork(win); }
        },
        /* "More Colors" — the item "Add new custom color"
           of any palette (ThemeColorPalette, ColorButton →
           Common.UI.ExtendedColorDialog). A window without a header (the stock
           header: false) stays so. The shade field and the color strip are drawn by
           the stock in percent of its own sizes (HSBColorPicker.js:138,
           :158), so the field stretches to fit the column on the right. The look —
           by styles (.vo-win--color). */
        {
            id: 'color',
            match: function (win, M) { return M.isUI(win, 'ExtendedColorDialog'); },
            width: 444
        },
        /* "List Settings" — bullets and numbering. The window height is set by the stock
           as a number (261) — the template drives it by content: the rows
           "Start at", "Import" and "Color" are hidden and shown by the stock according to the list
           type. The look — by styles (.vo-win--listsettings). */
        {
            id: 'listsettings',
            match: function (win, M) { return M.isCommon(win, 'ListSettingsDialog'); },
            width: 420
        },
        /* "Document Language". A window without a header (the stock header: false)
           stays so. The look — by styles (.vo-win--lang). */
        {
            id: 'lang',
            match: function (win, M) { return M.isCommon(win, 'LanguageDialog'); },
            width: 420
        },
        /* "Adjust Shadow" of a shape. The window width is computed by the stock from the section —
           it is set by its width in the styles (.vo-win--shadow). */
        {
            id: 'shadow',
            match: function (win, M) { return M.isCommon(win, 'ShapeShadowDialog'); }
        },
        /* "New Document Property" and editing an own property in "Document
           Info". The recipe moves the name and value errors to the field
           edge. The look — by styles (.vo-win--docprop). */
        {
            id: 'docprop',
            match: function (win, M) { return M.isCommon(win, 'DocumentPropertyDialog'); },
            width: 420,
            apply: function (win, M) {
                if (!win.inputTitle || typeof win.inputTitle.checkValidate !== 'function') throw new Error('no name field');
                M.edgeError(win.inputTitle);
                if (win.inputTextOrNumber && typeof win.inputTextOrNumber.checkValidate === 'function')
                    M.edgeError(win.inputTextOrNumber);
            }
        },
        /* "Number Format" — the "Label Format" button of the chart axes
           (Common.Views.FormatSettingsDialog). A window on
           AdvancedSettingsWindow without a section column: the window width is computed
           by the stock from the section, and the stock keeps the section height its own (contentHeight) —
           both are set in the styles (.vo-win--axisformat). */
        {
            id: 'axisformat',
            match: function (win, M) { return M.isCommon(win, 'FormatSettingsDialog'); }
        },
        /* "AutoCorrect" — "AutoCorrect Options" of the advanced settings.
           The "tabs on the left" template; the window width is computed by the stock from the sections,
           the stock keeps the height its own (contentHeight) — both are set in the styles
           (.vo-win--autocorrect). */
        {
            id: 'autocorrect',
            match: function (win, M) { return M.isCommon(win, 'AutoCorrectDialog'); }
        },
        /* "Keyboard Shortcuts" of the advanced settings. A window on
           AdvancedSettingsWindow without a section column and without a footer:
           the width is computed by the stock from the section — it is set in the styles
           (.vo-win--shortcuts). */
        {
            id: 'shortcuts',
            match: function (win, M) { return M.isCommon(win, 'ShortcutsDialog'); }
        },
        /* "Macros" (Common.Views.MacrosDialog). The window is stretched with the mouse, and
           the editor inside is laid out by the stock from the window height: the size is driven by
           the stock (vo-win-sized). The template is only a frame: header, cross,
           footer; the macro list, the button panel and the code editor are
           stock. The look — by styles (.vo-win--macros). */
        {
            id: 'macros',
            match: function (win, M) { return M.isCommon(win, 'MacrosDialog'); },
            sized: true
        }
    ];

    /* No underscore at load time: the shared layer module is also loaded by contexts without it. */
    var STOCK = {}, STOCK_IDS = [];
    for (var r = 0; r < STOCK_RECIPES.length; r++) {
        STOCK[STOCK_RECIPES[r].id] = STOCK_RECIPES[r];
        STOCK_IDS.push(STOCK_RECIPES[r].id);
    }

    var Windows = {
        LABEL: LABEL,
        ICONS: ICONS,
        AIR_BASE: AIR_BASE,

        /* Adds the mechanics to the editor windows object: only what it
           lacks — the editor's own parts (registry, main button caption, work area,
           own methods) stay. */
        create: function (own) {
            own = own || {};
            for (var key in ENGINE) {
                if (Object.prototype.hasOwnProperty.call(ENGINE, key) && own[key] === undefined) own[key] = ENGINE[key];
            }
            return own;
        },

        /* Shared window recipes by id in the given order. An unknown id is
           an error at editor load, not a silently stock window. */
        stock: function (ids) {
            var out = [];
            for (var i = 0; i < (ids || []).length; i++) {
                if (!Object.prototype.hasOwnProperty.call(STOCK, ids[i])) throw new Error('no stock window recipe: ' + ids[i]);
                out.push(STOCK[ids[i]]);
            }
            return out;
        },

        STOCK_IDS: STOCK_IDS
    };

    Common.UI.Compact.Windows = Windows;
    return Windows;
});
