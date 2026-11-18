/*
 * CompactShell — the compact shell of the new Document Editor interface.
 * Part of the web-apps fork, AGPL-3.0.
 *
 *     HEADER (46) → MENU (30) → TOOLBAR (4 + 44 + 8)  |  STATUS (30, over the document)
 *
 * The shell is our own: markup, menu, status. The document engine stays
 * stock, commands and state are taken from the stock api.
 *
 * The stock panels (left, right, status bar, ribbon) are not removed from the code —
 * in Compact mode their layout space is zeroed and their content is hidden.
 * Advanced mode brings everything back as it was: the modes are mutually exclusive.
 *
 * There are no stub items in the menu. If an action has no cheap stock API,
 * the item is simply not shown.
 */
define([
    'documenteditor/main/app/view/Icons',
    'documenteditor/main/app/view/CompactToolbar',
    'documenteditor/main/app/view/DocumentActions',
    'documenteditor/main/app/view/OutlineRail',
    'documenteditor/main/app/view/CompactTopScroll',
    'documenteditor/main/app/view/SelectionBubble',
    'documenteditor/main/app/view/SlashMenu',
    'documenteditor/main/app/view/CompactWindows',
    'documenteditor/main/app/view/CompactMenuAdapter',
    'common/main/lib/view/compact/MenuBar',
    'common/main/lib/view/compact/Shells'
], function (Icons) {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    var SHELL_ID  = 'vo-shell';
    var STATUS_ID = 'vo-status';

    /* The early-start claim class: set as soon as the config makes clear that
       the shell will exist, and hides the stock chrome until it is built (compact-shell.less,
       body.vo-boot). The number of build attempts is the same as the start loop
       had before the early start: 20 of 150 ms. */
    var BOOT_CLASS = 'vo-boot';

    /* The loading skeleton (index.html, class sk-shell) during the claim: a different
       id, so that the stock code does not remove it. */
    var COVER_ID = 'vo-loading';
    var START_TRIES = 20, START_STEP = 150;

    /* The five numbers are duplicated in compact-shell.less and must change
       in pairs: H_HEADER/@vo-h-header, H_MENU/@vo-h-menu,
       H_TB_GAP_TOP/@vo-tb-gap-top, H_TOOLBAR/@vo-h-toolbar,
       H_TB_GAP/@vo-tb-gap. Here the shell
       reserves space in the engine layout, there it draws itself. If they diverge —
       the panel and the canvas will stop matching, and the width measurement will NOT
       show it: it measures widths, not the vertical.
       The sum no longer needs duplicating: @vo-h-shell in LESS is computed by
       adding the same terms. The former H_SHELL is removed from here — it was used
       nowhere and kept the outdated 104 against the actual 114. */
    var H_HEADER = 46, H_MENU = 30, H_TOOLBAR = 44;   // the header with the menu: 76 = 46 + 30
    /* The gaps of the panel card above and below it, as with tables: the panel is not
       a chrome strip but a card on a strip of the canvas color, and its margins also have to be
       reserved. */
    var H_TB_GAP_TOP = 4;   // the top of the panel card: 76 + 4 = 80
    var H_TB_GAP = 8;       // below the card: the whole chrome 80 + 44 + 8 = 132
    var H_STATUS = 0;    // the bottom row sits over the document (CSS, @vo-h-status 30), takes no space in the layout

    var ICON = {
        menu:     'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
        search:   'M7.2 11.4a4.2 4.2 0 100-8.4 4.2 4.2 0 000 8.4zM10.4 10.4L13.5 13.5',
        comment:  'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
        panel:    'M2.5 3.5h11v9h-11zM6.2 3.5v9',
        outline:  'M2.5 3.5h11M4.5 6.5h9M6.5 9.5h7M4.5 12.5h9'
    };

    /* Side panels that we know how to open. The key is our name, the value is
       the name of the stock button in the left menu. The panels are not ours: we do not move the DOM,
       we press the stock button and let its controller work. */
    /* The extended search and replace is the same stock panel inside #left-menu
       (app/template/LeftMenu.template, #left-panel-search), and in compact it
       opened INVISIBLE: the rule hides #left-menu entirely, and the class
       vo-left-open is set only by syncLeftState, iterating over this list. While
       search was not in it, Ctrl+H and the "advanced options" button of the floating
       search bar opened the panel, moved focus into it and changed
       nothing on the screen — replace, regular expressions and the list of occurrences were
       unreachable. The same kind of problem as the hidden version
       history. We do not open it ourselves: opening stays with the stock paths,
       we only need to learn about it and give the area room. */
    var LEFT_PANELS = {
        comments:   'btnComments',
        navigation: 'btnNavigation',
        search:     'btnSearchBar'
    };

    /* Open windows and stock dropdown menus during which the top does not go away.
       The search bar is a window without a mask, it has no modal class. */
    var TOP_BUSY_SELECTOR = '.asc-window.modal, .asc-window.search-bar, .open > .dropdown-menu';

    /* Whether there is a visible one among the elements by the selector — the same check as
       jQuery :visible. :visible itself in a selector will not do: querySelectorAll does not
       understand it, and jQuery walks the whole document, while this is called on
       every scroll frame. */
    function anyVisible(selector) {
        var list = document.querySelectorAll(selector);
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) return true;
        }
        return false;
    }

    /* The line thickness is chosen to match the panel icons: there
       viewBox is 24 and stroke is 1.75, here viewBox is 16 — the same optical
       density gives 1.2. The size 17px against the former 16: the glyph is lighter, but
       the font size is slightly larger, and the panel reads calmer. */
    function svg(p) {
        return '<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">' +
               '<path d="' + p + '" fill="none" stroke="currentColor" stroke-width="1.2" ' +
               'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    /* --- Protection against its own failures ------------------------------------- */
    /* The shell is an add-on to someone else's application, and its breakage has no right to
       take the editor with it. It did, by two paths, and both are the same
       mechanism: NotificationCenter is Backbone.Events, handlers are called
       in a row in one stack, and an exception from any of them interrupts the whole trigger.

       STARTUP. create() is called from the app:ready subscriber (controller/
       Viewport.js). The notification leaves from the middle of Main.onDocumentContentReady
       (controller/Main.js:1309), and AFTER it the loading mask is removed there
       (hidePreloader → `$('#loading-mask').hide().remove()`, :2674) and
       input is unblocked (onLongActionEnd with BlockInteraction). An exception from
       create() canceled both, and all the app:ready subscribers that
       are registered after us — including the stock Toolbar and Statusbar, from which
       part of the disabled left-menu items comes. From outside this looked like an
       editor hung dead on loading with a fully open document.

       SUBSCRIPTIONS. The same in the reverse direction: our handlers of stock
       notifications are registered from create(), that is, LATER than the stock ones, and an exception
       from ours does not let those who subscribed after the shell run.
       Measured on uitheme:changed: with applyShellLayout replaced the control
       subscriber was not called at all, and the height of the toolbar area stayed
       stock — an extra ruler popped out.

       Therefore all code that the engine calls from outside goes through this wrapper.
       The second and following failures of the same place stay silent: layout:changed and
       uitheme:changed arrive in batches, and a persistent breakage would flood the log,
       and it has nothing more to say — the place and the cause are the same.

       Engine callbacks (api.asc_registerCallback) are not routed here yet: their
       path is different (not Backbone but the engine's list) and the cost of a failure there is different. This is
       a known limitation. */

    var warned = {};

    function guarded(label, fn) {
        return function () {
            if (DE.Views.CompactShell && DE.Views.CompactShell.startupFailed) return;
            try {
                return fn.apply(this, arguments);
            } catch (e) {
                if (!warned[label]) {
                    warned[label] = true;
                    if (window.console && console.warn)
                        console.warn('Компактная оболочка: сбой в «' + label + '», ' +
                                     'редактор продолжает работу без него.', e);
                }
            }
        };
    }

    DE.Views.CompactShell = _.extend({

        /* The outward wrapper: it is called by the startup (controller/Viewport.js) and the structure
           rail (view/OutlineRail.js). The rail cannot import the shell —
           it is its dependency, that would make a loop; but its subscriptions
           are registered from our create(), so by the time of the call this
           object has long been assembled. */
        guarded: guarded,

        /* The enabling gate. The shell starts ONLY when the platform itself
           has named the session ours: `editorConfig.ui.shell === 'modern'`. The field
           is put by the platform into the signed config on EVERY opening in the new
           shell — a regular one, by link, a version, from a call. The former gate by
           `ui.mode === 'compact'` enabled the shell
           only in a call, while a regular opening got the stock editor;
           `ui.mode` now means only "a call" and enables nothing by itself.

           Why not by the `customization` flags. From a call the platform also sends
           four stock flags — `compactToolbar`, `compactHeader`,
           `hideRightMenu`, `hideRulers`. These are options of the stock editor, they are
           also sent by an ordinary integrator, so "our session" is not distinguished by them from
           "the stock compact view"; only `ui.shell`
           distinguishes. The flags set the defaults and the look of Advanced, not the enabling.

           The comparison is strict and case matters: the platform puts a
           normalized name here, so `Modern`, `modern` with a space,
           `compact` or an empty string is no longer its value. The fail-safe
           direction is the same as the platform's: no field, a foreign value,
           an unfinished controller or a read error — the stock
           editor stays. Silence is safer: an extra full interface the person
           will notice, and a substituted one where it was not ordered — will not.

           config is the config from Gateway `init` (announce): on this event Main
           may not yet have put it into editorConfig. Without an argument
           we read the stock controller's editorConfig. */
        wanted: function (config) {
            try {
                if (this.startupFailed) return false;
                var cfg = config;
                if (cfg === undefined) {
                    var main = DE.getController('Main');
                    cfg = main && main.editorConfig;
                }
                return !!cfg && !!cfg.ui && cfg.ui.shell === 'modern';
            } catch (e) {
                return false;
            }
        },

        /* --- Early start ---------------------------------------------------- */
        /* The shell is built on app:ready, while the stock interface is visible earlier:
           the stock code removes the loading mask already on app:face (Main.onEditorPermissions
           and onApplyEditRights → hidePreloader), and the whole time the
           document was loading the person saw the stock title, ribbon and status bar, and
           then their replacement. So the decision to enable is made on
           Gateway `init`, as soon as the config arrives: a claim class
           is set on body, and styles hide the stock chrome until the panel is built. On
           app:face, when the layout is already assembled, the areas get the shell
           heights — in their place sits a skeleton of its height and color.

           boot — what we did to the layout for the skeleton: {heights: [...]}.
           While it is not null, the claim class stays set. booted — the claim already happened:
           a repeated init must not register a second subscription. */
        boot: null,
        booted: false,

        announce: function (config) {
            if (this.booted || document.getElementById(SHELL_ID) || !this.wanted(config)) return;
            var me = this;
            this.booted = true;
            this.boot = {heights: null};
            document.body.classList.add(BOOT_CLASS);
            /* The loading skeleton stays until the shell is built. The stock code removes
               it by id on app:face, before the document is loaded, and would then show
               the canvas in the colours of the interface theme (dark on a dark system)
               and its own "Loading document" plate. Under a different id the skeleton
               stays, and endBoot removes it together with the claim: when the shell is
               built this is the same frame, on a failure the stock interface returns,
               on an engine error see below. The stock password window lies above the
               skeleton by z-index, and loading goes on after it. */
            var mask = document.getElementById('loading-mask');
            if (mask) mask.id = COVER_ID;
            /* An engine error before the shell is built removes the skeleton and the
               claim at once. The stock code removes its own mask on it (Main.onError →
               hidePreloader) and opens the error window, while app:ready never comes
               after an opening error: nothing would call endBoot, and the loading band
               would keep running under the window and after OK. Under the window the
               stock interface belongs, as in the stock editor. An error after which
               loading still reaches app:ready gets the shell from the regular start,
               as without the early start. The stock onError is registered earlier
               (Main.onLaunch) and the engine calls its callbacks in order, so the stock
               window is already open by our call. guarded, because an exception here
               would cut off the remaining error callbacks. */
            var vp = DE.getController('Viewport');
            var api = vp && vp.api;
            if (api && api.asc_registerCallback)
                api.asc_registerCallback('asc_onError', guarded('оболочка: ошибка до постройки', function () {
                    if (me.boot) me.endBoot(true);
                }));
            /* The subscription is registered here, that is, later than the stock handlers of
               app:face (they are registered at controller startup): by our call the
               stock code has already laid out the areas by its flags. */
            Common.NotificationCenter.on('app:face', guarded('оболочка: каркас', function (opts) {
                me.bootLayout(opts);
            }));
        },

        /* The skeleton heights. We remember the stock values together with our own:
           create() returns them before the stock snapshot (endBoot), otherwise the snapshot and
           the base of applyLayout would take the skeleton for the stock layout, and the move to
           Advanced would get the wrong heights. */
        bootLayout: function (opts) {
            var b = this.boot;
            if (!b || b.heights) return;
            var vp = DE.getController('Viewport');
            var view = vp && vp.viewport;
            if (!view || !view.vlayout) return;
            var v = view.vlayout;
            var o = opts || ((DE.getController('Main') || {}).appOptions) || {};
            /* Like shellHeight(): there is no formatting row reading. The focus
               mode and the collapsed panel are the state of an already built shell,
               at start they do not exist. */
            /* The panel card sits over the document, the layout holds only
               the header, the menu and the gray gap above the card (see layoutHeight). */
            var shellH = H_HEADER + H_MENU + (o.isEdit ? H_TB_GAP_TOP : 0);
            b.heights = [];
            [[v.getItem('toolbar'), shellH], [v.getItem('statusbar'), H_STATUS]].forEach(function (p) {
                var panel = p[0];
                if (!panel) return;
                b.heights.push({panel: panel, stock: panel.height, ours: p[1]});
                panel.height = p[1];
                panel.el.css('height', p[1] + 'px');
            });
            this.bootRelayout(view, vp);
        },

        bootRelayout: function (view, vp) {
            view.vlayout && view.vlayout.doLayout();
            view.hlayout && view.hlayout.doLayout();
            $(window).trigger('resize');
            var api = this.api || (vp && vp.api);
            if (api && api.Resize) api.Resize();
        },

        /* Remove the claim: the class and the skeleton heights. We return a height only if
           it is still ours: if the stock code managed to rearrange the area (theme change,
           ribbon collapse), its value is fresher than our snapshot.

           relayout = false — from create(), handing the skeleton over to the shell. There
           the stock height returns only into the area model (seen by the
           stock snapshot and the base of applyLayout), while the DOM keeps the skeleton height:
           applyLayout(true) will immediately write the shell height, equal to it, and
           the height transition (.vo-compact #toolbar, transition) has nothing to
           start from. Had we written the stock height into the DOM — the very first reading of
           geometry inside create() (fitTitle) would have fixed it, and after
           vo-compact the panel would "slide out" from the stock height to its own. On
           a failure the DOM is brought to the model by a rollback or doLayout in start(). */
        endBoot: function (relayout) {
            var b = this.boot;
            if (!b) return;
            this.boot = null;
            document.body.classList.remove(BOOT_CLASS);
            var cover = document.getElementById(COVER_ID);
            if (cover && cover.parentNode) cover.parentNode.removeChild(cover);
            (b.heights || []).forEach(function (x) {
                if (x.panel.height !== x.ours) return;
                x.panel.height = x.stock;
                if (relayout) x.panel.el.css('height', x.stock + 'px');
            });
            if (relayout) this.stockRelayout();
        },

        stockRelayout: function () {
            var vp = DE.getController('Viewport');
            var view = vp && vp.viewport;
            if (view) this.bootRelayout(view, vp);
        },

        /* The startup on app:ready (controller/Viewport.js). The gate is here, not inside
           create(): create() is called again from the attempt loop and from toggleMode
           on return from Advanced, while the decision is made once per session.

           The retry is for a stock panel that is not ready yet: create() then silently
           exits and waits for the next attempt. A failure must not be retried, and the loop
           is therefore entirely inside guarded: an exception from create() does not reach
           setTimeout, the attempts stop, and a failed create() does not get
           a second go on top of a half-built shell.

           The early-start fail-safe: an attempt after which there is neither a panel nor
           a next attempt (a failure or exhaustion) removes the claim — the stock
           interface returns with its heights. finally runs even on
           an exception, which guarded then silences. */
        start: function () {
            var me = this, tries = 0;
            var attempt = guarded('запуск оболочки', function () {
                var again = false;
                try {
                    me.create();
                    if (document.getElementById(SHELL_ID)) return;
                    if (++tries < START_TRIES) {
                        again = true;
                        setTimeout(attempt, START_STEP);
                    }
                } finally {
                    if (!again && !document.getElementById(SHELL_ID)) {
                        /* The claim is still in place — remove it entirely. Already removed,
                           and no panel — create() failed after handing over
                           the skeleton: the rollback inside create() returned the layout,
                           while a failure before its try would have left the DOM with the skeleton
                           heights and a stock model. doLayout writes the heights
                           from the model, a repeat after a rollback is harmless. */
                        if (me.boot) me.endBoot(true);
                        else if (!me.startupFailed) me.stockRelayout();
                    }
                }
            });
            /* The gate is also under guarded: an exception here would break app:ready, and
               with it the removal of the loading mask and the unblocking of input. */
            guarded('запуск оболочки: гейт', function () {
                if (!me.wanted()) { me.endBoot(true); return; }
                attempt();
            })();
        },

        api: null,
        tb: null,
        advanced: false,
        rulersVisible: false,
        base: null,          // the stock heights of the areas at the moment we took them
        ours: false,         // the area heights are ours now, not stock
        rightOpen: false,    // the decision about the right panel; the class on body is its application

        /* ------------------------------------------------------------------ */

        create: function () {
            if (this.startupFailed || document.getElementById(SHELL_ID)) return this;

            var $toolbar = $('#toolbar');
            if (!$toolbar.length) return this;

            var tb = DE.Views.CompactToolbar;
            if (!tb.isReady()) return this;

            /* We release the early-start skeleton BEFORE the snapshot: the snapshot and the base of
               applyLayout must see the stock heights, not ours. The claim
               class is replaced by vo-compact below, the frame between them is not drawn. */
            this.endBoot(false);
            var stock = this.snapshotStock(tb.api);
            try {
                this.tb = tb;
                this.api = tb.api;
                DE.Views.DocumentActions.init(this.api, this);

                var $shell = $('<div id="' + SHELL_ID + '"></div>')
                    .append(this.buildHeader())
                    .append(this.buildMenu())
                    .append(tb.build());

                $toolbar.prepend($shell);
                $('#statusbar').prepend(this.buildStatus());

                document.body.classList.add('vo-compact');
                DE.Views.CompactWindows.setActive(true);
                tb.bindApi();
                this.bindStatus();
                this.bindWheelZoom();
                this.bindSearchBar();
                this.watchSelection();
                this.watchRename();
                this.bindLeftPanels();
                this.bindMenuRefresh();
                this.bindChromeEscape();
                this.bindModalGuard();
                DE.Views.CompactWindows.bind(this);
                this.applyLayout(true);
                this.bindPropertiesInsets();
                this.applyCanvasSkin();
                DE.Views.SelectionBubble.create(this.api, tb);
                DE.Views.SlashMenu.create(this.api, tb);
                this.bindTopScroll();
                DE.Views.OutlineRail.create(this.api);
                this.buildHeaderHint();
                // Each document opens with rulers hidden; only an explicit UI action shows them.
                DE.Views.DocumentActions.setRulers(false, false);
                /* Last: the handler immediately applies the current state to all
                   surfaces, and the document could have opened already under a prohibition — read-only,
                   in a form preview or with a broken connection. */
                this.bindEditingLock();
            } catch (e) {
                /* A failure is terminal for this session: a retry must not build the
                   shell on top of a partial UI. The original error is passed
                   to the outer guarded after the independent rollback steps. */
                try { this.rollbackStartup(stock); } finally { throw e; }
            }

            return this;
        },

        /* A snapshot of the actual layout, including the collapsed stock ribbon
           and open side panels. We do not change user settings. */
        snapshotStock: function (api) {
            var vp = DE.getController('Viewport');
            var view = vp && vp.viewport;
            var v = view && view.vlayout, h = view && view.hlayout;
            var outline = api && api.asc_GetDocumentOutlineManager && api.asc_GetDocumentOutlineManager();
            return {
                view: view,
                outlineUse: outline && outline.IsUse ? outline.IsUse() : null,
                rulers: api && typeof api.asc_GetViewRulers === 'function' ? !!api.asc_GetViewRulers() : null,
                heights: v ? v.panels.map(function (p) { return {panel: p, height: p.height}; }) : [],
                horizontal: h ? h.panels.filter(function (p) { return !p.isresizer; }).map(function (p) {
                    return _.extend({}, p, {resize: p.resize ? _.extend({}, p.resize) : p.resize});
                }) : [],
                nodes: $('[id^="vo-"]').toArray(),
                classes: Array.prototype.filter.call(document.body.classList, function (c) { return c.indexOf('vo-') === 0; }),
                skin: window.AscCommon && AscCommon.GlobalSkin ? _.extend({}, AscCommon.GlobalSkin) : null
            };
        },

        rollbackStartup: function (stock) {
            var me = this;
            this.startupFailed = true;
            /* Surface guards already use Advanced as a prohibition of input interception
               and showing. The Advanced class is not needed here: we return the stock code. */
            this.advanced = true;
            this.ours = false;
            clearTimeout(this.wordsTimer);
            clearTimeout(this.skinTimer);
            clearTimeout(this._modeTimer);
            clearTimeout(DE.Views.SelectionBubble.refreshTimer);
            var restore = function (fn) {
                try { fn(); } catch (e) {
                    if (window.console && console.warn) console.warn('Компактная оболочка: сбой отката оболочки.', e);
                }
            };
            restore(function () {
                var bubble = DE.Views.SelectionBubble;
                if (bubble && bubble.dispose) bubble.dispose();
            });
            restore(function () { me.unbindPropertiesInsets(); });
            restore(function () {
                if (me.menu) me.menu.destroy();
                me.menu = null;
            });
            restore(function () {
                $('[id^="vo-"]').each(function () {
                    if (stock.nodes.indexOf(this) < 0) $(this).remove();
                });
                Array.prototype.slice.call(document.body.classList).forEach(function (c) {
                    if (c.indexOf('vo-') === 0 && stock.classes.indexOf(c) < 0) document.body.classList.remove(c);
                });
            });
            restore(function () {
                stock.heights.forEach(function (item) {
                    item.panel.height = item.height;
                    if (item.height != null) item.panel.el.css('height', item.height + 'px');
                });
                var h = stock.view && stock.view.hlayout;
                if (h && h.panels.some(function (p) { return p.el && p.el.attr('id') === 'vo-rail-slot'; }))
                    h.changeLayout(stock.horizontal);
                stock.view && stock.view.vlayout && stock.view.vlayout.doLayout();
                h && h.doLayout();
            });
            restore(function () { if (stock.skin && me.api && me.api.asc_setSkin) me.api.asc_setSkin(stock.skin); });
            restore(function () { if (stock.rulers !== null) DE.Views.DocumentActions.setRulers(stock.rulers, false); });
            restore(function () {
                if (stock.outlineUse === false && me.api && me.api.asc_HideDocumentOutline) me.api.asc_HideDocumentOutline();
                else if (stock.outlineUse === true && me.api && me.api.asc_ShowDocumentOutline) me.api.asc_ShowDocumentOutline();
            });
            restore(function () { DE.Views.CompactWindows.setActive(false); });
            restore(function () { me.resync(); });
        },

        /* A side panel can also be closed bypassing us — by the X button inside it or
           a hotkey. Both paths end with this notification. */
        bindLeftPanels: function () {
            var me = this;
            Common.NotificationCenter.on('layout:changed', guarded('оболочка: layout:changed', function (area) {
                if (area === 'leftmenu' && !me.advanced) me.syncLeftState();
            }));

            /* The host theme change. The shell has no dark palette of its own — it
               stays light intentionally (see compact-shell.less). But a reaction
               is needed anyway: the stock handler breaks our layout, and
               the background around the page is drawn by the engine from CSS variables, which it
               reads once through asc_setSkin. */
            Common.NotificationCenter.on('uitheme:changed', guarded('оболочка: uitheme:changed', function () {
                /* The stock theme handler overwrites the height of the toolbar
                   and status areas with its own values (controller/Viewport.js:
                   376-380) — it is designed for the ribbon, not for our shell.
                   After it the area becomes the height of the stock ribbon, and
                   the menu row and the toolbar end up clipped.
                   We return our own sizes.

                   The order of handlers decides everything here. The stock one is subscribed in
                   onLaunch (Viewport.js:187), ours — from create() on app:ready,
                   that is, later, and in compact the stock one runs FIRST.
                   So exactly at this moment the layout holds the stock heights
                   of the NEW theme — the only moment when they are visible. The numbers differ
                   between themes: 66/25 in colors-table.less:263-264 versus 84/32 in
                   colors-table-white.less:207-208 and -night.less:205-206.
                   The snapshot will not pick them up by itself: applyLayout takes it
                   only when !ours, and ours after compact is still true — base
                   would remain from the PREVIOUS theme, and the move to Advanced would give
                   the ribbon and status bar its numbers back. So we clear the flag BEFORE
                   applyShellLayout: let applyLayout(true) re-take the fresh
                   stock heights before putting our own on top.

                   The condition is the same as in the stock handler: without
                   Themes.available() it exits on the first line and does not touch
                   the heights, and clearing the flag then is not allowed — the snapshot would take our
                   compact heights for stock ones. This is the mirror of the very
                   defect for which the snapshot became repeated.

                   In Advanced ours is false anyway (it was cleared by applyLayout(false) from
                   toggleMode), and applyShellLayout is silent there: the heights are stock,
                   and the new ones after a theme change are also stock — let them stay
                   (see applyShellLayout). The canvas skin is needed in both modes:
                   the background around the page is drawn by the engine. */
                if (Common.UI.Themes && Common.UI.Themes.available()) me.ours = false;
                me.applyShellLayout();
                me.applyCanvasSkin();
            }));
        },

        /* --- The stock edit prohibition ------------------------------------------ */
        /* The stock code distributes the prohibition by a single notification: `editing:disable(disable,
           options, type)`. The senders are controller/Main.js (disableEditing:
           loss of connection and recovery; onDocModeApply with force: a change of
           document mode), lib/controller/ReviewChanges.js, app/controller/
           FormsTab.js, app/view/MailMergeSettings.js, app/view/
           SignatureSettings.js. The stock subscriber is Main.onEditingDisable.

           We have no classification of reasons of our own and must not have: `options` is
           the decision ALREADY made by the stock code about which surfaces to disable (toolbar,
           navigation, comments, statusBar, rightMenu, leftMenu, fileMenu plus
           the mode flags viewMode / reviewMode / fillFormMode / viewDocMode).
           Our job is to map it to our surfaces, and which item is disabled by which
           reason is known to the catalog (DocumentActions, the `lock:` arrays).
           The idiom is the same: we ask, we do not remember our own — cf. visualAlign,
           toggleRulers, docModeLocked.

           WE DO NOT KEEP THE STACK OF REASONS EITHER. It is kept by Main.stackDisableActions
           (Common.IrregularStack, push/pop by `type`), and the decision about
           what to restore when one reason out of several is removed is also located there
           (prev_options in Main.onEditingDisable). The top element of the stack gives
           both "the prohibition is active" and its options — including after the removal of
           the top reason, when another remained under it.

           THE SUBSCRIPTION ORDER, checked in the code. Main subscribes in onLaunch,
           the shell is built on app:ready, so our handler is added
           later and is called after the stock one: NotificationCenter is
           Backbone.Events, handlers go in the order of subscription. The restoration of
           prev_options inside Main is a DIRECT call of onEditingDisable, not
           a repeated event, so the event reaches us exactly once and
           with the final stack. There is no need to recompute from the event arguments;
           they remain a fallback for the case when there is no stack
           at all — before onLaunch it does not exist yet. */

        lockOn: false,
        lockOpts: null,

        bindEditingLock: function () {
            var me = this;
            // The SDK hides rulers after delivering disconnect and restriction callbacks.
            // Read its final state after the current delivery, without changing that state.
            var syncRulers = function () {
                setTimeout(guarded('оболочка: состояние линеек', function () {
                    if (me.api && typeof me.api.asc_GetViewRulers === 'function')
                        me.syncRulers(me.api.asc_GetViewRulers());
                }), 0);
            };
            Common.NotificationCenter.on('editing:disable', guarded('оболочка: editing:disable', function (disable, options, type) {
                me.applyEditingLock({disable: disable, options: options, type: type});
                syncRulers();
            }));
            Common.NotificationCenter.on('api:disconnect', syncRulers);
            if (this.api && this.api.asc_registerCallback) {
                this.api.asc_registerCallback('asc_onCoAuthoringDisconnect', syncRulers);
                this.api.asc_registerCallback('asc_onDocumentContentReady', syncRulers);
            }
            /* Document protection is its own notification and its own sender
               (controller/DocProtection.js:249). We do not parse the argument: it
               is the very snapshot that protectProps will give, and the decision
               is assembled by lockState. We need only a reason to recompute the view —
               exactly like the stock subscribers (controller/Toolbar.js,
               controller/LeftMenu.js, view/FileMenuPanels.js:1955). */
            Common.NotificationCenter.on('protect:doclock', guarded('оболочка: protect:doclock', function () {
                me.applyEditingLock();
                syncRulers();
            }));
            this.applyEditingLock();
        },

        /* The top of the stock stack. null means "there is no stack", not "there is no prohibition": these
           two answers must not be confused, otherwise the fallback path below cannot be told from
           a lifted prohibition. */
        lockTop: function () {
            var main = DE.getController('Main');
            var stack = main && main.stackDisableActions;
            if (!stack || typeof stack.length !== 'function') return null;
            var n = stack.length();
            var top = (n > 0) ? stack.get(n - 1) : null;
            return (top && top.disable)
                ? {on: true, options: top.options || {}, type: top.type}
                : {on: false, options: {}};
        },

        /* --- The fourth state: a prohibition BY RIGHT ---------------------------- */
        /* A document opened read-only (appOptions.isEdit === false) does not produce the
           editing:disable event AT ALL. All five senders distribute
           a TRANSITION — loss of connection, a document mode change, previews of
           review, forms and merge — while here the prohibition is not a transition but the
           starting state of the rights: the stock code simply does not build editing controls in such
           a document, and has nothing to disable. The shell, however,
           is built for read-only too (neither create() nor
           CompactToolbar.isReady() asks about rights), so it disables its commands itself.
           Measured on the built statics on 18.09: without this the menu bar is alive
           entirely, "Insert → Image" is clickable and silently does nothing.

           WHY THE RIGHT AND THE EVENT ADD UP RATHER THAN REPLACE EACH OTHER.
           The right is a permanent prohibition: a read-only document is open for the whole session, and
           there is nothing to lift this prohibition with. The event is temporary: a reason comes and
           goes, the stock stack puts it in and removes it. So the event sits
           ON TOP of the right: while a reason is in the stack, the surfaces are led by its options —
           the stock code has already decided what to disable — and when the stack is empty, we return not
           to "editing is allowed" but to the right. Otherwise restoring the connection in a
           read-only document would open editing that did not exist even before the break.
           This is the same distinguishing case as with two superimposed reasons, only
           the lower one of them is not in the stack, and cannot be removed.

           The source is the same by which the shell shows the mode:
           defaultDocMode() gives 'view' exactly when !isEdit. We ask it, and
           not appOptions directly, so that the user does not have two different "Viewing" modes —
           what is shown by the word in the header and the class
           .vo-view is what is disabled. The docMode field is not suitable for this: into it
           applyDocModeLook also collapses unfamiliar restrictions (view-form), and
           form filling has its own reason and its own sender (FormsTab). */

        /* The surfaces are the same as the stock code distributes for its own "Viewing", and
           with the same keys: there is no list of reasons of our own here, as everywhere in this
           block. This is a FULL copy of the payload from controller/Main.js,
           onDocModeApply at mode === 'view' (disable === true,
           disableModeButton is not passed — hence header.docmode false).
           The copy must not be cut down to the keys that our gates read today:
           which keys are read is decided by the `lock:` array in the catalog
           (DocumentActions), and it grows.
           Hence the behavior too: the table of contents and zoom are alive (navigation.disable
           false), comments are alive by rights (comments.disable false),
           editing commands are disabled by the viewDocMode flag. */

        RIGHTS_OPTIONS: {
            viewMode: false,
            reviewMode: false,
            fillFormMode: false,
            viewDocMode: true,
            allowMerge: false,
            allowSignature: false,
            allowProtect: false,
            rightMenu: {clear: true, disable: true},
            statusBar: true,
            leftMenu: {disable: true, previewMode: true},
            fileMenu: {protect: true, history: false},
            navigation: {disable: false, previewMode: true},
            comments: {disable: false, previewMode: true},
            chat: false,
            review: true,
            viewport: false,
            documentHolder: {clear: true, disable: true},
            toolbar: true,
            plugins: true,
            protect: true,
            header: {docmode: false, search: false, startfill: false},
            shortcuts: false
        },

        lockByRights: function () {
            return (this.defaultDocMode() === 'view')
                ? {on: true, options: this.RIGHTS_OPTIONS}
                : null;
        },

        /* --- The fifth state: DOCUMENT PROTECTION ------------------------------ */
        /* The third axis, not reducible to the previous two. The right (isEdit) is permanent for
           the whole session, a reason from the stack comes and goes, while document protection
           is turned on by ANY co-author at any moment — and it is distributed by a separate
           notification `protect:doclock` (controller/DocProtection.js:249),
           which is absent from every sender of `editing:disable`. So neither
           lockTop nor lockByRights knows about it.

           The truth is held by the stock controller: getDocProps() gives its own
           `_state.docProtection` with four protection-type flags. We ask
           it, not api.asc_getDocumentProtection(): the controller has already updated the
           snapshot by the time of the notification, and a second source would diverge from
           the first — the same idiom as in docModeLocked and toggleRulers.

           The keys are ours — the same by which the stock code disables its controls: docLockView,
           docLockComments, docLockForms, docLockReview (controller/Toolbar.js,
           onChangeProtectDocument). The catalog reads them with `lock:` arrays, like
           the mode flags.

           WHY TrackedChanges DOES NOT RAISE `on`. Under this protection editing is
           ALLOWED — the engine stays in restriction None (DocProtection.js:
           299-304), it is just that all edits go as tracked changes. Raising `on`
           would mean disabling the "/" menu, the bubble and the whole panel where the stock code
           disables exactly three review controls. So this protection gives
           one flag docLockReview, and does not declare the fact of an editing prohibition.
           The other three — ReadOnly, Comments, Forms — really
           take editing away, and they raise `on`. */

        protectProps: function () {
            var ctl = DE.getController('DocProtection');
            var props = (ctl && ctl.getDocProps) ? ctl.getDocProps() : null;
            return props || null;
        },

        lockByProtection: function () {
            var p = this.protectProps();
            if (!p) return null;
            var hard = !!(p.isReadOnly || p.isCommentsOnly || p.isFormsOnly);
            if (!hard && !p.isReviewOnly) return null;

            var o = {
                docLockView: !!p.isReadOnly,
                docLockComments: !!p.isCommentsOnly,
                docLockForms: !!p.isFormsOnly,
                docLockReview: !!p.isReviewOnly
            };
            /* We add surfaces only when there is something to disable: a key with
               the value "do not disable" in the final payload would mean that we have an opinion
               about the surface, — while under the "tracked changes only" protection
               there is none at all. */
            if (hard) {
                _.extend(o, {
                    /* We disable the surfaces under any of the three "hard" protections:
                       there is no free editing, and a panel that looks alive silently
                       does nothing — exactly the defect for which this work
                       was done. We have one mask for the whole panel, there are no named
                       locks for its buttons, so under the
                       "comments" protection the comment button is disabled together with everything —
                       the stock code leaves it. The loss is closed not
                       here but in the catalog: the item "Insert → Comment"
                       is disabled by edit('comment'), where the "comments
                       only" protection is absent, that is, the command stays reachable
                       from the menu bar. */
                    toolbar: true,
                    statusBar: true,
                    rightMenu: {disable: true}
                });
            }
            return {on: hard, options: o};
        },

        /* Prohibitions only ACCUMULATE: a key raised by one source must not
           be able to be disabled by another. So we merge not with _.extend (where the
           last would win, including with its `false`), but by truthiness. */
        mergeLockOptions: function (base, extra) {
            var out = _.extend({}, base || {});
            _.each(extra || {}, function (v, k) {
                if (!v) return;
                var cur = out[k];
                /* The stock code describes surfaces with an object ({disable, previewMode}).
                   We overlay the fields, not replace the whole object. */
                if (_.isObject(v) && _.isObject(cur)) {
                    var o = _.extend({}, cur);
                    _.each(v, function (vv, kk) { if (vv) o[kk] = vv; });
                    out[k] = o;
                } else {
                    out[k] = v;
                }
            });
            return out;
        },

        /* The answer for all consumers: the catalog asks about its items,
           the "/" menu and the bubble — about the fact of a prohibition. We compute anew on every
           question, because the truth lives in the stack, in the rights and in the document
           protection, not in us. */
        lockState: function () {
            var st = this.lockTop() || {on: !!this.lockOn, options: this.lockOpts || {}};
            /* The event on top of the right: while a reason is in the stack, the surfaces are led
               by it, and only on an empty stack do we ask the right. */
            var base = st.on ? st : (this.lockByRights() || st);

            var prot = this.lockByProtection();
            if (!prot) return base;
            return {
                on: base.on || prot.on,
                options: this.mergeLockOptions(base.options, prot.options),
                type: base.type
            };
        },

        editingLocked: function () {
            return !!this.lockState().on;
        },

        /* There is NO advanced gate here, and this is deliberate — unlike
           applyShellLayout and applyRightPanel. Those touch the STOCK layout,
           which in Advanced is managed not by the shell; this method touches
           only our nodes, hidden in Advanced by a single CSS rule
           (compact-shell.less, the .vo-advanced block). It must not stay silent: the prohibition
           arrives in Advanced too, and the return to the compact view (toggleMode)
           produces no events — with the gate we would have returned to the view cleared
           before the prohibition. */

        applyEditingLock: function (ev) {
            if (ev) this.editRequestLockType = ev.disable ? ev.type : null;
            /* We remember EXACTLY the event, not the outcome: the fallback path (arguments
               instead of the stack) is needed only while there is no stack at all, and lockState
               adds the right to the event — once and in one place. */
            var fallback = ev ? {on: !!ev.disable, options: ev.disable ? ev.options || {} : {}} :
                                {on: !!this.lockOn, options: this.lockOpts || {}};
            var evt = this.lockTop() || fallback;
            this.lockOn = evt.on;
            this.lockOpts = evt.options;

            var st = this.lockState();
            var o = st.options;

            /* The toolbar. In its own "Viewing" it does not exist at all
               (compact-shell.less: .vo-view #vo-tb { display: none }), but on
               loss of connection, in a review preview and in form filling
               it is visible and alive. The stock code puts a mask over its ribbon here —
               .toolbar-mask or .toolbar-group-mask
               (controller/Toolbar.js, DisableToolbar): a transparent layer that
               eats clicks, plus dimming of the groups with the masked class.
               We repeat the meaning, not the markup; the panel puts its own mask itself. */
            this.tb && this.tb.setLocked && this.tb.setLocked(st.on && !!o.toolbar);

            /* The menu bar is built once (build() from create()), so
               we update the LOOK of the items, not rebuild the composition. We do not
               hide the items: the stock code disables, it does not remove. */
            this.refreshMenuLocks();

            /* The status bar — by the options.statusBar key, and with the same composition as
               the stock code disables its own: Statusbar.SetDisabled touches the language and
               the review toggle, while zoom, counters and information
               it leaves alive. Of this set we have only spelling,
               and it has an honest twin — the spelling button
               (lib/view/ReviewChanges.js, `lock:` with viewMode, viewFormMode,
               previewReviewMode and docLock*). The language and counters are captions for us,
               not controls: there is nothing to disable in them. */
            var stLock = st.on && !!o.statusBar;
            if (this.$spell) {
                this.$spell.toggleClass('vo-locked', stLock)
                           .attr('aria-disabled', stLock ? 'true' : 'false');
            }

            /* The table of contents — strictly by the options.navigation.disable key. The stock code in
               its "Viewing" does NOT disable navigation (navigation: {disable:
               false, previewMode: true}), and on loss of connection it
               disables (disable: !temp). We repeat exactly that, adding no logic
               of our own. We have no separate surface for previewMode: in the
               stock code it locks the items of the structure context menu
               (controller/Navigation.js, _isDisabled), while the rail can only
               jump to a heading. */
            var rail = DE.Views.OutlineRail;
            rail && rail.setLocked && rail.setLocked(st.on && !!(o.navigation && o.navigation.disable));

            /* The popup surfaces keep no state of their own — we just
               remove them from the screen. They will not let themselves show again: the gates
               are in SlashMenu.show/apply and SelectionBubble.refresh. */
            if (st.on) {
                var slash = DE.Views.SlashMenu, bubble = DE.Views.SelectionBubble;
                slash && slash.hide && slash.hide();
                bubble && bubble.hide && bubble.hide();
            }
            this.syncHeaderHint();
        },

        /* The open menu re-reads the state of the items in place, without closing:
           the menu bar gathers the triggers of one frame into one read. We do not
           hide or rebuild the items: the composition and availability are decided by the snapshot. */
        refreshMenuLocks: function () {
            if (this.menu && this.menu.refresh) this.menu.refresh();
            this.applyEditButtonLock();
        },

        /* Triggers to re-read the menu, except the editing prohibition and protection (these are led by
           applyEditingLock): a document mode change, review and showing of
           tracked changes, co-author edits, document modified state, selection,
           zoom, undo and redo, the clipboard, a connection break. */
        bindMenuRefresh: function () {
            var me = this, api = this.api;
            this.bindHeaderDisconnect();
            var refresh = guarded('оболочка: обновление меню', function () { me.refreshMenuLocks(); });
            Common.NotificationCenter.on('doc:mode-changed', refresh);
            Common.NotificationCenter.on('api:disconnect', refresh);
            /* A request to move to editing (Main.markEditRequest): the indicator and the host's answer
               go to the message place of the menu bar, and "Edit
               document" is disabled and lit together with the indicator. */
            Common.NotificationCenter.on('editrequest:status', guarded('оболочка: запрос правки', function (text) {
                /* The message is shown by the menu bar: a hidden top — for any
                   reason — is returned, otherwise it is not visible. */
                if (text && typeof me.showTop === 'function') me.showTop();
                DE.Views.DocumentActions.showRequestStatus(text);
                me.refreshMenuLocks();
            }));
            if (!api || !api.asc_registerCallback) return;
            ['asc_onOnTrackRevisionsChange', 'asc_onShowRevisionsChange', 'asc_onCollaborativeChanges',
             'asc_onDocumentModifiedChanged', 'asc_onFocusObject', 'asc_onZoomChange', 'asc_onCanUndo',
             'asc_onCanRedo', 'asc_onCanCopyCut', 'asc_onCoAuthoringDisconnect'].forEach(function (name) {
                api.asc_registerCallback(name, refresh);
            });
            /* "Track changes for everyone" is turned on and off by a co-author too: together with
               the menu, "Editing" in the header switcher and the
               delete button in the footer hint are re-read. */
            api.asc_registerCallback('asc_onOnTrackRevisionsChange',
                guarded('оболочка: исправления для всех', function () {
                    me.applyForAllLock();
                    me.syncHeaderHint();
                }));
        },

        canRequestEdit: function () {
            var main = DE.getController('Main'), o = main && main.appOptions;
            if (!this.wanted() || !o || typeof main.markEditRequest !== 'function' ||
                typeof main.isEditRequestWaiting !== 'function') return false;
            var type = String((main.document || {}).fileType || '').toLowerCase();
            return !o.isEdit && !!o.canEdit && !!o.canRequestEditRights && !o.canSwitchMode &&
                !o.isPDFForm && !o.isOForm && ['pdf', 'djvu', 'xps', 'oxps', 'docxf', 'oform'].indexOf(type) < 0;
        },

        editRequestItem: function () {
            var adapter = this.menuAdapter;
            if (!adapter || typeof adapter.groups !== 'function') return null;
            var items = adapter.groups('file') || [];
            for (var i = 0; i < items.length; i++) if (items[i].k === 'file.edit') return items[i];
            return null;
        },

        buildEditButton: function () {
            this.$editRequest = null;
            if (!this.canRequestEdit()) return null;
            var me = this, keys = function (action) {
                var k = me.menuAdapter && me.menuAdapter.keys;
                if (k && typeof k[action] === 'function') k[action]();
            };
            this.$editRequest = $('<button type="button" class="vo-mode accent canfocused"></button>')
                .text(this.textEdit).attr('title', DE.Views.DocumentActions.textEditDoc)
                .on('mousedown focus', function () { keys('hold'); })
                .on('focusout', function () { keys('release'); })
                .on('click', function (e) { e.stopPropagation(); me.runEditRequest(); });
            this.applyEditButtonLock();
            return this.$editRequest;
        },

        editButtonLocked: function () {
            var adapter = this.menuAdapter, item = this.editRequestItem();
            if (!this.canRequestEdit() || !item || typeof adapter.itemState !== 'function') return true;
            var state = adapter.itemState(item);
            if (!state || !state.visible || state.disabled) return true;
            var main = DE.getController('Main'), stack = main && main.stackDisableActions;
            if (stack && typeof stack.length === 'function' && typeof stack.get === 'function') {
                for (var i = 0, n = stack.length(); i < n; i++) {
                    var entry = stack.get(i);
                    if (entry && entry.disable === true && entry.type !== 'view') return true;
                }
                return false;
            }
            return !!this.lockOn && this.editRequestLockType !== 'view';
        },

        applyEditButtonLock: function () {
            if (!this.$editRequest) return;
            var locked = this.editButtonLocked();
            this.$editRequest.toggleClass('vo-locked', locked).attr('aria-disabled', locked ? 'true' : 'false');
        },

        runEditRequest: function () {
            var adapter = this.menuAdapter, ran = false;
            if (!this.advanced && !this.startupFailed && document.body.classList.contains('vo-compact') &&
                adapter && !adapter.blocked() && !this.editButtonLocked()) {
                this.closeSurfaces();
                DE.Views.DocumentActions.requestEditRights();
                ran = true;
            }
            this.applyEditButtonLock();
            if (this.$editRequest && document.activeElement === this.$editRequest[0] && adapter && adapter.keys)
                adapter.keys.hold();
            return ran;
        },

        bindHeaderDisconnect: function () {
            var me = this, api = this.api;
            if (!api || !api.asc_registerCallback || this.headerDisconnectApi === api) return;
            this.headerDisconnectApi = api;
            api.asc_registerCallback('asc_onCoAuthoringDisconnect', function () {
                setTimeout(guarded('shell: header disconnect', function () {
                    me.applyDocModeLock();
                    me.applyEditButtonLock();
                }), 0);
            });
        },

        /* --- Header --------------------------------------------------------- */

        buildHeader: function () {
            this.$editRequest = null;
            var $h = $('<div class="vo-hd"></div>');

            /* There is no burger here anymore. It had no menu of its own: the handler
               poked the first item of the menu bar, and the first item is "File". A pure
               duplicate, removed on 08.09.

               The structure is absent here deliberately. It already has its own compact
               toggle to the left of the page: the table of contents lives at the left edge of
               the document, not in the header.
               Two buttons for one entity, also opening different panels
               (our rail and the stock one), were our mistake.
               The stock navigation panel stayed in the "View" menu.

               Search, comments, the right panel and the mode switcher
               left the header on 08.09 — each its own way, none of them
               settled in the menu bar. The header is responsible for the document and the session,
               not for tools. Where they are now:
               search — in the service group of the toolbar
               (CompactToolbar.js:112) and in "Edit → Find and replace"
               (DocumentActions.js:109); comments — "Collaboration →
               Comments" (:210); the right properties panel has no button
               at all, it opens on the selection of an object, the manual entry is
               "View → Object properties" (:241); "Advanced" — in "File" and in
               "View" (:102 and :257). */

            var $title = this.buildTitle();
            var $state = this.buildSaveState();

            var $right = $('<div class="vo-hd-right"></div>');

            /* Collaboration is in the header, not only in the menu: it is about "who and
               when", not about "what to do with the text". We show each control
               only if the portal integration supports it —
               access is given out by it, and so is the history.

               The buttons have different weight: history is flat, "share" is
               accent (AIR tinted), because it is addressed to the people around the
               document, not to its content. "Download" is placed between them, the
               mode — last, the rightmost: both are about the whole document, not
               about the text in it. */
            var o = (DE.getController('Main') || {}).appOptions || {};

            if (o.canUseHistory) {
                $right.append($('<button type="button" class="vo-ib"></button>')
                    .attr('title', this.tipHistory)
                    .html(Icons.svg('history'))
                    .on('click', function () {
                        Common.NotificationCenter.trigger('collaboration:history');
                    }));
            }

            /* "Download" — formats and print in one menu. The same items as in
               "File", from the same set (DocumentActions.exportItems): the texts,
               rights gates and actions are shared by the two entries. The outline look: a fill
               in the right cluster is needed only by the mode, tinted — only by access
               to the document.

               There is no comments button in the header — it would duplicate commands
               that have their own places. The comments panel is opened by the
               item "Collaboration → Comments" (DocumentActions, the same gate
               canUse('comments') that the button had), to add a
               comment — the "Comment" button in the service group of the toolbar
               (CompactToolbar, c.comment; it opens the panel
               itself) and the item "Insert → Comment". */
            var $download = this.buildDownload();
            if ($download) $right.append($download);

            if (o.canRequestSharingSettings || o.sharingSettingsUrl) {
                $right.append($('<button type="button" class="vo-ib vo-tinted"></button>')
                    .attr('title', this.tipSharing)
                    .html(Icons.svg('share'))
                    .on('click', function () {
                        Common.NotificationCenter.trigger('collaboration:sharing');
                    }));
            }

            /* The document mode is here, not on the left by the name: its place is in the right
               cluster, the rightmost, at the window edge, as in the spreadsheet header. Like
               "Download", it is a command about how the document is handled, not
               about what is written in it.

               The mode popover is pressed to the right edge of the button and opens
               to the left, toward the window center. The rule `.vo-docmode .vo-pop
               {left:auto;right:0}` is located in LESS above `.vo-pop-wrap .vo-pop
               {left:0}`, and the specificity of both is (0,2,0): without raising it
               (`&.vo-pop-wrap` in compact-shell.less) the lower one would win, and
               the popover would go to the right, past the window edge. */
            /* The switcher may be absent: without the edit right buildDocMode
               sets only the mode look and returns nothing. */
            var $mode = this.buildDocMode();
            if ($mode) $right.append($mode);
            else $right.append(this.buildEditButton());

            /* There is no avatar here deliberately: on the portal it is drawn by the host wrapper
               OUTSIDE the editor, and a second
               copy in our header would duplicate it.

               The userName() method and the .vo-hd-user styles are after this called
               from nowhere. They are left deliberately: the avatar was the only thing that
               used them, and if the shell is ever shown outside the portal,
               bringing it back will be one line. If it is decided not to bring it back —
               both places must be deleted at once. */

            /* The save state is right after the name: both labels are about the
               document, not the text, and are read as one group. The mode is
               at the other end of the row, last in the right cluster.

               The stock editor mark is no longer here: it was removed, our own logo
               will come separately. So the name field is again the first element of the row, and
               the left edges of the name and the menu bar again match at @vo-pad-x —
               the price that went away together with the mark. The negative
               margin of .vo-hd-title cancels its own padding, so it is exactly the name TEXT
               that sits on the grid; without the mark this is the look that was before it.

               When the logo returns, it must be placed here too, first in the row, and
               together with its own rule in compact-shell.less: the mark height enters
               the content box of .vo-hd (30px), and above 30 it will push the row apart,
               whose heights are duplicated in @vo-h-header / H_HEADER. */
            return $h.append($title).append($state).append($right);
        },

        /* --- Download ------------------------------------------------------ */
        /* The "Download" button with a menu: three formats, a separator, print. The popover
           has the same structure as the mode one (buildDocMode): the wrapper
           .vo-pop-wrap, the list .vo-pop-list, the rows .vo-pop-item with the glyph
           .vo-pop-i. So without separate code it is closed by closeSurfaces
           (opening a neighboring surface, modal:show), a click elsewhere and the shell's
           Escape — hasOpenSurfaces sees .vo-pop-wrap.open.

           Empty by rights — no button: a menu without items would be a stub.
           If there is only download or only print — we show one group,
           the separator is placed only between two. */
        buildDownload: function () {
            var me = this;
            var da = DE.Views.DocumentActions;
            var out = da.exportItems();
            var groups = [[out.docx, out.pdf, out.odt], [out.print]]
                .map(function (g) { return g.filter(Boolean); })
                .filter(function (g) { return g.length; });
            if (!groups.length) return null;

            /* The hint is the phrase of the stock header's download button
               (lib/view/Header.js, tipDownload): it already has a translation in all
               editor languages, and the shell's own phrase would not have it. The locale
               is laid out before the controllers are loaded (the same analysis as for
               the MODES tables at the bottom of the file), so Header.prototype by the time of assembling
               the header is already translated. */
            var stock = Common.Views && Common.Views.Header && Common.Views.Header.prototype;
            var tip = (stock && stock.tipDownload) || 'Download file';

            var uid   = 'vo-download-menu';
            var $wrap = $('<span class="vo-pop-wrap vo-download"></span>');
            var $btn  = $('<button type="button" class="vo-ib vo-outlined"></button>')
                .attr({title: tip, 'aria-label': tip, 'aria-haspopup': 'menu',
                       'aria-expanded': 'false', 'aria-controls': uid})
                .html(Icons.svg('download'));
            var $pop  = $('<div class="vo-pop vo-pop-list" role="menu"></div>')
                .attr({id: uid, 'aria-label': tip});
            var items = [];

            /* We silence the engine's keyboard interception while focus is on the button or in
               the menu: the engine synchronously returns focus to its textarea (see
               CompactToolbar.valueBtn, keys), and without silencing neither arrows nor
               Esc reach the menu. We turn it back on as soon as focus has left
               the wrapper or the menu closed without focus in it: a disabled
               interception would leave the document unable to receive typed input. */
            function keys(on) {
                var api = me.api;
                if (api && typeof api.asc_enableKeyEvents === 'function') {
                    api.asc_enableKeyEvents(on);
                }
            }
            /* The return after focus leaves — only without a modal window. A window
               (for example, the Main.onError warning) closes the menu
               (modal:show → closeSurfaces) and takes focus — at once or later,
               through FocusManager; the engine would give the enabled interception to
               the document, and focus would go from under the window. The keyboard is then
               returned by the stock code when the window closes (controller/Main.js,
               modal:close), — by the same counter as in menu:hide. */
            function keysBack() {
                var mw = Common.Utils && Common.Utils.ModalWindow;
                if (!(mw && mw.isVisible())) keys(true);
            }
            function inside(el) { return !!el && $wrap[0].contains(el); }
            function isOpen() { return $wrap.hasClass('open'); }

            /* We read the openness BEFORE closeSurfaces at the caller: it closes
               our menu too (the same caveat as for the mode button). */
            function setOpen(v) {
                if (v) me.closeSurfaces($btn);
                $wrap.toggleClass('open', v);
                $btn.attr('aria-expanded', v ? 'true' : 'false');
            }
            function focusItem(i) {
                var n = items.length;
                items[((i % n) + n) % n].focus();
            }
            function focusedItem() {
                var el = document.activeElement;
                for (var i = 0; i < items.length; i++) if (items[i][0] === el) return i;
                return -1;
            }

            groups.forEach(function (g, n) {
                if (n) $pop.append($('<div class="vo-pop-sep" role="separator"></div>'));
                g.forEach(function (it) {
                    /* A row like the panel lists (CompactToolbar.popItem): a glyph
                       and a caption, without a checkmark — there is nothing to choose here, the item
                       executes a command. The glyph is the same as for the item in "File":
                       one command in two places looks the same.
                       tabindex -1: items are traversed with arrows, and Tab closes
                       the menu and moves focus on. */
                    var $it = $('<button type="button" class="vo-pop-item" role="menuitem" tabindex="-1"></button>')
                        .append($('<span class="vo-pop-i"></span>').html(Icons.svg(it.i)))
                        .append($('<span></span>').text(it.t))
                        .on('click', function (e) {
                            e.stopPropagation();
                            /* The second end of the gate, as for the menu bar items
                               (buildMenu). These items have an empty `lock:`, and
                               the check holds a place for a reason, if one
                               appears in exportItems. */
                            if (da.itemLocked(it)) return;
                            setOpen(false);
                            keys(true);
                            it.run();
                            /* Focus goes back to the document, as after printing from
                               the ribbon (controller/Toolbar.js, onPrint): otherwise it
                               stays on the hidden row. */
                            da.done();
                        });
                    items.push($it);
                    $pop.append($it);
                });
            });

            $btn.on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(!isOpen());
            });

            /* The keyboard of a button with a menu: Enter, Space and ↓ open the menu and
               put focus on the first item, ↑ — on the last, Esc closes.
               Enter and Space are intercepted before click: a native click would only
               toggle the menu, without putting focus into it. A press with
               a modifier is not ours — engine commands are behind it (see
               CompactToolbar.valueBtn). Esc with a closed menu is passed through: it is
               awaited by the shell handler (bindChromeEscape). */
            $btn.on('keydown', function (e) {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                var k = e.key;
                if (k === 'Escape') {
                    if (!isOpen()) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    return;
                }
                if (k === 'Enter' || k === ' ' || k === 'Spacebar' ||
                    k === 'ArrowDown' || k === 'ArrowUp') {
                    e.preventDefault();
                    keys(false);
                    setOpen(true);
                    focusItem(k === 'ArrowUp' ? -1 : 0);
                }
            });

            /* Inside the menu: arrows in a circle, Home and End, Esc closes and
               returns focus to the button. stopPropagation on Esc is mandatory:
               otherwise the shell handler on document would, with the same press, remove the
               next layer — one press, one removal. */
            $pop.on('keydown', function (e) {
                var k = e.key, i = focusedItem();
                if (k === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    $btn.focus();
                    return;
                }
                if (k === 'Tab') { setOpen(false); return; }
                if (i < 0) return;
                if (k === 'ArrowDown')    { e.preventDefault(); focusItem(i + 1); }
                else if (k === 'ArrowUp') { e.preventDefault(); focusItem(i - 1); }
                else if (k === 'Home')    { e.preventDefault(); focusItem(0); }
                else if (k === 'End')     { e.preventDefault(); focusItem(-1); }
            });

            /* mousedown, not focus: the engine takes focus before the focus event
               reaches us. In the popover we suppress mousedown so that a click
               on a row does not take focus from the button (the same technique as in the panel's value
               lists). */
            $btn.on('mousedown', function () { keys(false); });
            $pop.on('mousedown', function (e) { e.preventDefault(); });
            $wrap.on('focusout', function (e) {
                if (inside(e.relatedTarget)) return;
                keysBack();
                setOpen(false);
            });

            /* Openness lives in the wrapper class, and it is removed not only by our
               handlers: closeSurfaces, a click elsewhere, modal:show. aria-expanded
               and the interception are driven also from the class itself — by an observer, by the same
               technique as in the mode lock (bindDocModeLock). */
            if (typeof MutationObserver === 'function') {
                (new MutationObserver(function () {
                    var open = isOpen();
                    $btn.attr('aria-expanded', open ? 'true' : 'false');
                    if (!open && !inside(document.activeElement)) keysBack();
                })).observe($wrap[0], {attributes: true, attributeFilter: ['class']});
            }

            $pop.on('click', function (e) { e.stopPropagation(); });
            $(document).on('click', function () { $wrap.removeClass('open'); });

            return $wrap.append($btn).append($pop);
        },

        /* --- The document name --------------------------------------------------- */
        /* Edited in place. We do not show the extension and do not let it be erased: it
           defines the file format, not the title. The stock
           header is arranged the same way — it has a withoutExt mode, it cuts the extension via
           cutDocName and gives out the name WITHOUT it (Header.js:751).
           We repeat the same semantics and the same set of forbidden characters, otherwise
           the two rename entries would diverge in behavior.

           It goes outward by the stock path (LeftMenu.js:72): in WOPI —
           asc_wopi_renameFile, otherwise Common.Gateway.requestRename. A host
           that does not listen to this request will change the name only in
           the interface, without saving — this is expected, not a defect. */

        BAD_NAME: /[\t*+:"<>?|\\/]/,

        buildTitle: function () {
            var me = this;
            var full = this.documentTitle();
            var dot = full.lastIndexOf('.');

            this.docExt = dot > 0 ? full.slice(dot) : '';
            this.titleWas = dot > 0 ? full.slice(0, dot) : full;

            /* Exactly an input, not contenteditable. With contenteditable the field
               was drawn but did not accept input: the engine holds the keyboard
               for itself and the presses did not reach our div. The stock header
               is made a field for the same reason — Header.js reads it through
               $labelDocName.val(). */
            var $t = $('<input type="text" class="vo-hd-title">')
                .attr({spellcheck: 'false'})
                .val(this.titleWas);

            this.$title = $t;
            this.applyRenameRight();
            this.fitTitle();

            $t.on('keydown', function (e) {
                /* We do not let presses go beyond the field: otherwise they are picked up by the
                   document and the name edit goes into the text. */
                e.stopPropagation();
                if (e.keyCode === 13) { e.preventDefault(); $t.blur(); }
                if (e.keyCode === 27) { e.preventDefault(); $t.val(me.titleWas); $t.blur(); }
            })
            .on('keypress keyup input', function (e) { e.stopPropagation(); me.fitTitle(); })
            .on('blur', function () { me.commitTitle(); });

            return $t;
        },

        /* The field by the width of the content: an input does not shrink by itself, and a fixed
           width would leave an empty strip to the right of a short name.
           We measure with a hidden twin, not the size attribute: size is computed from the
           width of zero, and on a proportional font it misses by
           a few pixels — exactly this miss was read as a gap
           before the save icon. */
        fitTitle: function () {
            if (!this.$sizer) this.$sizer = $('<span class="vo-hd-sizer"></span>').appendTo(document.body);
            this.$sizer.text(this.$title.val() || '');
            var w = this.$sizer[0].offsetWidth + 1;   /* +1 — room for the caret */
            this.$title.css('width', Math.max(40, Math.min(w, 520)) + 'px');
        },

        commitTitle: function () {
            /* Native trim, not $.trim: the fork vendors jQuery 4, where
               $.trim is removed (deprecated in 3.5), and the call threw TypeError. It failed
               inside the engine's mouse handling — it calls our blur itself through
               checkInterfaceElementBlur, — so the user saw not
               "the name was not saved" but a document error dialog. Do not revert to
               $.trim. */
            /* We ask the right here too, although without it the field is already readonly:
               the commit is the second end of the gate, and it is not superfluous. The right could have gone
               while the field was focused (a co-editing break removes it —
               controller/Main.js:2503), and the commit is also called by the engine itself
               through checkInterfaceElementBlur, bypassing our handler. */
            if (!this.canRename()) { this.$title.val(this.titleWas); this.fitTitle(); return; }

            var raw = this.$title.val();
            var v = (raw == null ? '' : String(raw)).trim();

            /* An empty name and invalid characters are rolled back silently: an error dialog
               here would be heavier than the edit itself. */
            if (!v || this.BAD_NAME.test(v)) { this.$title.val(this.titleWas); this.fitTitle(); return; }

            this.$title.val(v);
            this.fitTitle();
            if (v === this.titleWas) return;
            this.titleWas = v;

            var main = DE.getController('Main') || {};
            var o = main.appOptions || {};
            var api = this.api || main.api;

            if (o.wopi && api && api.asc_wopi_renameFile) api.asc_wopi_renameFile(v);
            else if (Common.Gateway && Common.Gateway.requestRename) Common.Gateway.requestRename(v);
        },

        /* The right to rename is given by the host — by the presence of the
           onRequestRename handler (api.js:413); by it the stock code also enables editing of
           the stock header (controller/Main.js:1829). We read it on every
           access, and do not remember it at assembly: on a co-editing break the stock code
           removes the right (controller/Main.js:2503), and the field must close
           together with the stock one. */
        canRename: function () {
            var main = DE.getController('Main') || {};
            return !!(main.appOptions && main.appOptions.canRename);
        },

        applyRenameRight: function () {
            if (!this.$title) return;
            var can = this.canRename();
            this.$title.prop('readonly', !can)
                .attr('title', can ? this.tipRename : this.tipRenameDisabled);
        },

        /* The name changes bypassing us too: a rename from the host, a version
           restore, the document meta. The engine reports it via asc_onDocumentName,
           and the stock code updates the stock header from there (controller/Main.js:3106).
           Without the same subscription the field would not just show the old name — it
           would SEND it back with the first blur: titleWas would stay old,
           and the commit counts any difference as a human edit. */
        syncTitle: function (name) {
            if (!this.$title) return;
            var full = (name == null ? '' : String(name)).trim() || this.documentTitle();
            var dot = full.lastIndexOf('.');
            this.docExt = dot > 0 ? full.slice(dot) : '';
            var base = dot > 0 ? full.slice(0, dot) : full;
            if (base === this.titleWas) return;
            this.titleWas = base;

            /* The field is focused — the person is editing the name right now. We do not
               overwrite their typing: titleWas is already new, so its commit will go outward
               as an edit on top of the arrived name, not as an echo of the old one. */
            if (this.$title[0].ownerDocument.activeElement === this.$title[0]) return;
            this.$title.val(base);
            this.fitTitle();
        },

        watchRename: function () {
            var me = this, api = this.api;

            /* The right is removed by the stock code, not by us: we subscribe to the same notification
               by which it calls setCanRename(false). */
            Common.NotificationCenter.on('api:disconnect', guarded('оболочка: api:disconnect', function () {
                me.applyRenameRight();
            }));

            if (!api || !api.asc_registerCallback) return;
            try {
                /* The engine callback is under protection deliberately: the other callbacks of the
                   shell do not have it yet (a known limitation), but adding it to
                   a new one is cheaper than later figuring out why the document name
                   brought down typing. */
                api.asc_registerCallback('asc_onDocumentName',
                    guarded('оболочка: asc_onDocumentName', function (name) {
                        me.syncTitle(name);
                    }));
                /* A rename through the host (the "Rename" menu item,
                   the host header) reaches the engine as a meta command from DS, and the engine
                   reports it via asc_onMeta, not asc_onDocumentName. The stock code
                   updates its title and tab from it (controller/Main.js:3126);
                   without this subscription the shell header stayed with the old name.
                   meta without title is not about the name, we skip it. */
                api.asc_registerCallback('asc_onMeta',
                    guarded('оболочка: asc_onMeta', function (meta) {
                        if (meta && meta.title) me.syncTitle(meta.title);
                    }));
            } catch (e) { /* no callback — the field stays on the initial name */ }
        },

        /* --- The save state -------------------------------------------- */
        /* The indicator by the document name: "Not
           saved" and "Saving…" are a badge with a caption, "Saved" is a
           checkmark icon. The states are the engine's truth, not a guess:
           "modified / not modified" — asc_onDocumentModifiedChanged, "saving
           in progress" — the long action Save / ForceSaveButton between
           asc_onStartAction and asc_onEndAction. By the same events the stock code
           writes in the status bar "Saving document…" and "All changes
           saved" (controller/Main.js, onLongActionBegin / End). */

        /* The captions come from the locale and so are set not here but by the block
           below: inside an object literal there is no way to refer to its own texts. */
        SAVE_STATE: null,

        /* We hold "Saving…" for three seconds from the start of saving: locally
           it lasts milliseconds, and the caption flashed for one frame. A new
           save inside the window extends it, so with continuous
           typing the badge stays on "Saving…" and does not blink. */
        SAVE_HOLD_MS: 3000,

        buildSaveState: function () {
            this.$state = $('<span class="vo-hd-state"></span>').attr('role', 'status');
            this.saveFlags = {modified: false, saving: false};
            this.saveHoldUntil = 0;
            this.setSaveState({});
            return this.$state;
        },

        /* The flags arrive separately and in any order: the end of Save may arrive
           before "modified" is cleared, and vice versa. So we keep both and
           derive the state from their pair, not from the last event. */
        setSaveState: function (flags) {
            if (!this.$state) return;
            var me = this, now = Date.now();
            _.extend(this.saveFlags, flags);
            if (flags.saving) this.saveHoldUntil = now + this.SAVE_HOLD_MS;

            var held = now < this.saveHoldUntil;
            clearTimeout(this.saveHoldTimer);
            if (held) {
                this.saveHoldTimer = setTimeout(guarded('оболочка: бейдж сохранения', function () {
                    me.setSaveState({});
                }), this.saveHoldUntil - now);
            }

            var key = (this.saveFlags.saving || held) ? 'saving' : (this.saveFlags.modified ? 'dirty' : 'saved');
            if (key === this.saveKey) return;
            this.saveKey = key;
            var t = this.SAVE_STATE[key].t;
            this.$state.removeClass('saved saving dirty').addClass(key);

            /* "Saved" is an icon without a caption: the AIR checkmark (accept), the same one
               that was here before the badge. The caption goes into the hint and into the element
               name — the status is read by both hover and the screen reader. */
            if (key === 'saved') {
                this.$state.html(Icons.svg('accept')).attr({title: t, 'aria-label': t});
            } else {
                this.$state.text(t).removeAttr('title aria-label');
            }
        },

        /* --- The document working mode --------------------------------------- */
        /* Editing, review, view. From Compact this was not available
           at all: the stock switcher lives in the header of the stock editor,
           which we hide, and we had none of our own.

           We switch with the stock doc:mode-apply notification — the same one sent by
           the mode menu in the stock header (lib/view/Header.js, btnDocMode).
           Behind it is a handler that rebuilds the whole editor —
           blocks editing, turns off the right panel, changes the rights of the context
           menu (controller/Main.js, onDocModeApply). By hand this cannot
           be repeated. We listen to a different notification though — see the subscription
           in buildDocMode. */

        /* The captions are from the locale, see the block under the object. */
        MODES: null,

        buildDocMode: function () {
            var me = this;
            var o = (DE.getController('Main') || {}).appOptions || {};

            /* The initial mode is the same as for a notification without a name. */
            var initial = this.defaultDocMode();

            /* The mode can also be changed bypassing us — by the stock button in Advanced,
               a forms preview or the editor itself. The subscription is needed even without
               our switcher: it drives the mode look too.

               We listen to doc:mode-changed, not doc:mode-apply, — exactly like
               the stock header (lib/view/Header.js, the subscription next to the creation of
               btnDocMode). The difference is fundamental: mode-apply is a REQUEST, and
               Main.onDocModeApply rejects it at two points: by
               `!canSwitchMode && !force` at the entry and by `!inViewMode || force`
               in the tail. A sender without force is real in the product:
               ReviewChanges.turnChanges sends doc:mode-apply('review'|'edit',
               false) from onApiTrackRevisionsChange, that is, the engine on someone else's
               toggling of change tracking. On mode-apply we repainted the
               header and removed .vo-view even when the stock code rejected the request:
               the document stayed under the Viewing restriction, while the formatting row
               came back and raised the shell height.
               doc:mode-changed arrives AFTER THE FACT and exactly in the cases
               that worked anyway: requests with force (our setDocMode, the mode menu
               of the stock header, FormsTab, Main.onDisconnectEveryone) are always
               let through by the stock code, and a request without force — only outside the view
               mode, where the view change is really needed.

               The second argument at the stock code is lockEditing: by it Toolbar, by document
               protection, disables ONE menu item without changing the mode (changeDocMode
               exits on the first line). We have no locks of our own, so
               we skip such a notification: otherwise mode === undefined would take the
               header to "Editing" out of the blue. */
            Common.NotificationCenter.on('doc:mode-changed', guarded('оболочка: doc:mode-changed', function (mode, lockEditing) {
                if (lockEditing !== undefined) return;
                me.applyDocModeLook(mode);
            }));
            Common.NotificationCenter.on('api:disconnect', guarded('оболочка: блокировка режима', function () {
                me.applyDocModeLock();
            }));

            /* The rights gate is the same as in the stock code: it creates the mode button only
               at isEdit && canSwitchMode (lib/view/Header.js, the
               isDocEditor branch), where canSwitchMode === isEdit (controller/Main.js,
               onEditorPermissions), and isEdit === canLicense && canEdit &&
               mode !== 'view' (same place).
               The shell is drawn in a read-only document too — neither create() nor CompactToolbar.isReady()
               asks about rights — and without this check the
               header would offer the reader "Editing", and setDocMode would send
               doc:mode-apply with force. Force passes through the stock protection
               `if (!canSwitchMode && !force) return` (Main.onDocModeApply) and
               reaches asc_setRestriction(… None …), that is, it grants editing
               to someone who was not given it.

               After the chosen view isEdit temporarily becomes false
               (LeftMenu.SetDisabled), while the canSwitchMode right is kept.
               We check it to allow returning to editing.
               The gate closes the RIGHTS, the state is closed by bindDocModeLock below.
               The stock code holds its button by eight enumLock reasons (previewReviewMode,
               lostConnect, disableOnStart, docLockView, docLockComments,
               docLockForms, fileMenuOpened, changeModeLock), and we need this:
               our switcher sends force, and force removes the stock protection
               of the mode, that is, on connection loss and under document protection it
               would push the change through.

               We do not repeat the eight reasons — we ask the stock button itself.
               The reason: there are three delivery paths and one recipient. Six reasons
               arrive in the toolbar array (controller/Toolbar.js puts the header
               button into toolbar.lockControls), changeModeLock — via
               editing:disable (Main puts header.docmode, unrolls it into
               Toolbar.fireEvent('docmode:disabled'), caught by Viewport),
               fileMenuOpened — from Viewport.onFileMenu. All three converge on
               Common.Utils.lockControls, which stores the reasons in the keepState
               of ONE object — btnDocMode. Our own proxy in the toolbar array
               would cover six of the eight; repeated subscriptions would go stale at
               the ninth reason. Asking for a ready answer is both cheaper and honest:
               the idiom is the same as in visualAlign and toggleRulers — we ask, we
               do not remember our own.

               We do NOT mirror visibility, and this is deliberate. At the stock code
               `visible: isReviewOnly || !canReview`, that is, in an ordinary
               editable document the button is first absent, and it is shown by the
               first doc:mode-changed with a named mode. This is protection against
               blinking: the stock changeDocMode at start is called without a mode
               name. We have nothing to blink — defaultDocMode() gives a definite
               mode synchronously, and in the compact header the mode caption is
               its only indicator, and hiding it would mean leaving
               a hole in the header.

               The gate does not cancel the mode look: applyDocModeLook below will set
               .vo-view and the shell height, there will just be nothing to switch with —
               no button, no popover. */
            if (!this.canSwitchDocMode()) {
                this.applyDocModeLook(initial);
                return null;
            }

            var $wrap = $('<span class="vo-pop-wrap vo-docmode"></span>');
            var $btn  = $('<button type="button" class="vo-mode"></button>');
            var $pop  = $('<div class="vo-pop vo-pop-list vo-pop-rich"></div>');

            this.MODES.forEach(function (m) {
                /* We show review only where it is allowed. */
                if (m.v === 'review' && !o.canReview) return;

                /* We do not offer editing to someone who is given only review.
                   The condition is stock: the btnDocMode menu puts the 'edit' item under
                   `!appConfig.isReviewOnly` (lib/view/Header.js, the assembly of the mode
                   menu). The gate above does not replace it: isReviewOnly leaves
                   canEdit, and so isEdit and canSwitchMode, true
                   (controller/Main.js:1712-1717, :1777) — the switcher in such a
                   document must exist, but without editing. The cost of a miss here is not
                   cosmetic: our setDocMode sends doc:mode-apply with force, and
                   force passes through the stock protection and brings things to
                   asc_setRestriction(None), that is, grants editing to someone who
                   was not given it. */
                if (m.v === 'edit' && o.isReviewOnly) return;

                var $item = $('<button type="button" class="vo-pop-item"></button>')
                    /* A bare glyph, not a box — deliberately.
                       The class is the same as for alignment and lists
                       (CompactToolbar.popItem), so that the mode row reads
                       the same as them, not as a separate kind of row. */
                    .append($('<span class="vo-pop-i"></span>').html(Icons.svg(m.i)))
                    .append($('<span class="vo-pop-text"></span>')
                        .append($('<span class="vo-pop-t"></span>').text(m.t))
                        .append($('<span class="vo-pop-d"></span>').text(m.d)))
                    /* The checkmark of the current mode. The rows here are our own, not from
                       CompactToolbar.popItem, so the node has to be put
                       separately — otherwise .on below (applyDocModeLook) shows
                       nothing: the fill of the selected one was removed together with the move to
                       a checkmark. The glyph is `checkMenu`, not `accept`: the latter is taken by
                       the icon of review itself in the neighboring row. */
                    .append($('<span class="vo-pop-check"></span>').html(Icons.svg('checkMenu', 18)))
                    .on('click', function (e) {
                        e.stopPropagation();
                        /* A disabled row does not close the list, as in the menu. */
                        if (m.v === 'edit' && me.forAllLocked()) return;
                        $wrap.removeClass('open');
                        me.setDocMode(m.v);
                    });
                me.modeItems[m.v] = $item;
                $pop.append($item);
            });

            $btn.on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                /* We re-read the state on the click itself, and do not rely on the
                   class: the observer below drives the LOOK, while the decision is made by
                   the stock truth at that moment. */
                if (me.docModeLocked()) { me.applyDocModeLock(); return; }
                var open = !$wrap.hasClass('open');
                /* Before, only the .vo-pop-wrap family was closed here — the open
                   menu of the menu bar and the "•••" row survived the opening of the mode. */
                me.closeSurfaces($btn);
                $wrap.toggleClass('open', open);
            });
            $pop.on('click', function (e) { e.stopPropagation(); });
            $(document).on('click', function () { $wrap.removeClass('open'); });

            this.$docMode = $btn;
            this.bindDocModeLock($wrap);
            this.applyForAllLock();

            this.applyDocModeLook(initial);

            return $wrap.append($btn).append($pop);
        },

        modeItems: {},

        /* "Track changes for everyone" is on. Then "Editing" is disabled with
           the same reason as the "Review mode" menu item: this is a second
           entry to the same personal mode, and it cannot turn off the recording of changes —
           the shared mode records with tracked changes also the edits of those who chose
           editing. The truth is one — the engine flag (DocumentActions.isTrackAll). */
        forAllLocked: function () {
            var da = DE.Views.DocumentActions;
            return !!(da && typeof da.isTrackAll === 'function' && da.isTrackAll());
        },

        /* Why it is disabled while review is on for everyone: the text of the Documents forAll
           reason (DocumentActions). The same text is used by the "turn off for myself" option of the stock
           review buttons — it is taken by ReviewChanges through the shells registry. */
        forAllText: function () {
            var da = DE.Views.DocumentActions;
            return (da && typeof da.textReasonForAll === 'string') ? da.textReasonForAll : '';
        },

        /* The lock look is the same technique as for the mode button (applyDocModeLock):
           the class and aria-disabled, not the disabled attribute. The reason is in the hint
           (forAllText). */
        applyForAllLock: function () {
            var $item = this.modeItems && this.modeItems.edit;
            if (!$item) return;
            var lock = this.forAllLocked();
            var text = lock ? this.forAllText() : '';
            $item.toggleClass('vo-locked', lock).attr('aria-disabled', lock ? 'true' : 'false');
            if (text) $item.attr('title', text);
            else $item.removeAttr('title');
        },

        /* The stock mode button is the very object in whose keepState the stock code
           stores all eight reasons (see the comment in buildDocMode).
           The stock code creates it at isEdit && canSwitchMode and keeps it with
           the chosen view. Compact hides the stock header with the class
           body.vo-compact, and does not tear it down. */
        stockModeBtn: function () {
            var vp = DE.getController('Viewport');
            var hd = vp && vp.header;
            return (hd && hd.getButton) ? hd.getButton('mode') : null;
        },

        docModeLocked: function () {
            /* In view mode Toolbar skips lostConnect. Main keeps
               the disconnect regardless of the mode, including when rights are revoked. */
            var main = DE.getController('Main');
            if (main && main._state && main._state.isDisconnected) return true;
            var btn = this.stockModeBtn();
            if (!btn || typeof btn.isDisabled !== 'function') return false;
            try { return !!btn.isDisabled(); } catch (e) { return false; }
        },

        /* The lock look. A class, not the disabled attribute: on a disabled button
           the browser does not send click, and the second end of the gate in setDocMode would stop
           being checked at all — and it is needed for any future call. */
        applyDocModeLock: function () {
            var lock = this.docModeLocked();
            if (this.$docMode) this.$docMode.toggleClass('vo-locked', lock).attr('aria-disabled', lock ? 'true' : 'false');
            if (lock && this.$docModeWrap) this.$docModeWrap.removeClass('open');
        },

        /* The stock code sends no event on locking: Common.UI.Button.setDisabled
           only switches a class on its own node. So we watch the node —
           exactly by the technique and with the same filter by which the stock code watches
           the state of the button for itself (lib/component/Button.js, an observer of the
           cmpButtonFirst class; the same technique in Menu.js and Scaling.js).
           One subscription covers all three delivery paths of reasons and will not go stale
           when the stock code adds a ninth. */
        bindDocModeLock: function ($wrap) {
            var me = this;
            this.$docModeWrap = $wrap;
            this.bindHeaderDisconnect();

            var btn = this.stockModeBtn();
            var el  = btn && btn.cmpEl && btn.cmpEl[0];
            if (!el || typeof MutationObserver !== 'function') { this.applyDocModeLock(); return; }

            (new MutationObserver(function () { me.applyDocModeLock(); }))
                .observe(el, {attributes: true, attributeFilter: ['class']});

            this.applyDocModeLock();
        },

        /* The second end of the rights gate from buildDocMode. The first closes the path —
           there is no switcher in the header; this one closes the action itself, for any
           future call. The rule is the same as for bindChromeEscape and SlashMenu:
           we hold both ends. The cost of an error here is high — force removes the stock
           protection of the mode (controller/Main.js, onDocModeApply). */
        canSwitchDocMode: function () {
            var o = (DE.getController('Main') || {}).appOptions || {};
            return !!o.canSwitchMode;
        },

        setDocMode: function (mode) {
            if (!this.canSwitchDocMode()) return;
            /* Rights and state are different questions, and both are asked here, at the
               end of the path: the rights are held by canSwitchDocMode, the state —
               docModeLocked. The second is needed at both ends for the same reason
               as the first: our truth about locks is led by an observer of
               someone else's node, and an event can pass between its firing
               and the click. */
            if (this.docModeLocked()) return;
            /* The second end of disabling "Editing" under "Track changes for everyone". */
            if (mode === 'edit' && this.forAllLocked()) return;
            Common.NotificationCenter.trigger('doc:mode-apply', mode, true);
            this.applyDocModeLook(mode);
        },

        /* The mode when it is not named. The stock code in changeDocMode takes it from
           isReviewOnly and the saved track-changes setting; we ask
           the engine directly (DocumentActions.isReviewOn), and this is the same truth:
           both isReviewOnly and the "tracked changes only" protection set
           asc_SetLocalTrackRevisions(true) (lib/controller/ReviewChanges.js).
           The stock code has no 'view' branch — its button without isEdit does not exist
           at all, while we need the mode look for the reader too: the .vo-view class and the shell
           height are always set. */
        defaultDocMode: function () {
            var o = (DE.getController('Main') || {}).appOptions || {};
            if (!o.isEdit) return 'view';

            /* Review only is the mode, there is no other there. The stock code
               decides the same way and in the same place where it derives the mode without a name:
               changeDocMode at type === undefined sets 'review' by
               isReviewOnly, without asking the change recording setting
               (lib/view/Header.js). Asking it here is not allowed either: the setting
               answers for whether edits are recorded, not for what rights
               the person has, and on a fresh document it is not yet set — hence
               the "Editing" in the header for someone who cannot make edits. */
            if (o.isReviewOnly) return 'review';

            var da = DE.Views.DocumentActions;
            return (this.tb && da && da.isReviewOn && da.isReviewOn()) ? 'review' : 'edit';
        },

        applyDocModeLook: function (mode) {
            var me = this;
            var find = function (v) {
                return me.MODES.filter(function (m) { return m.v === v; })[0];
            };

            /* A mode without a name is the stock "returned to ordinary editing":
               FormsTab.onModeClick sends doc:mode-changed(undefined) on exit
               from the forms preview, and the stock code in changeDocMode on undefined does not
               paint the button with the first mode that comes up, but derives the current one.
               We do the same. */
            if (mode === undefined) mode = this.defaultDocMode();

            var cur = find(mode);
            if (!cur) {
                /* In practice there is one unfamiliar mode — 'view-form': it is sent by
                   FormsTab, and Main brings it to asc_setRestriction(OnlyForms).
                   MODES has no such value, and the former `|| this.MODES[0]`
                   gave "Editing", removing .vo-view as well: in a
                   document where one can only fill in fields a full
                   formatting row hung. Any restriction that we do not
                   know is closer to view than to editing — the stock code paints everything
                   except edit and review with the same view icon
                   (lib/view/Header.js, changeDocMode). We substitute the mode itself too,
                   not only the row: .vo-view and
                   shellHeight.

                   WHAT WE LOSE IN THIS: the stock code does give a shared icon,
                   but the CAPTION of view-form is its own — setCaption in the same line
                   chooses textViewForm, not textView. We will show "Viewing".
                   We did not create a fourth entry in MODES for it: an item
                   in the popover would mean that this mode can be entered
                   by a click, and that is not so — it is set only by the forms preview.
                   Reachable only on OFORM. */
                mode = 'view';
                cur = find(mode);
            }

            this.docMode = mode;

            /* The mode name is captioned with a word. An icon was tried for this on
               08.09 and returned back: three mode glyphs without a caption were distinguished worse
               than one word, and room in the header was freed.
               The button may be absent entirely — without the edit right the switcher is not
               built (the gate in buildDocMode), but the .vo-view class and the shell
               height below must be set anyway. */
            if (this.$docMode) {
                this.$docMode
                    .empty()
                    .append($('<span></span>').text(cur.t))
                    .append($('<span class="vo-heading-caret"></span>').html(Icons.svg('chevron')))
                    .attr('title', cur.d)
                    /* The mode button is filled with the accent in all modes — AIR
                       filled primary, the same look that earlier was only in
                       view. The class is the same as before:
                       one look for all modes, and the lock is turned off by the shared
                       rule .vo-mode.vo-locked.accent. */
                    .addClass('accent');
            }

            Object.keys(this.modeItems).forEach(function (k) {
                me.modeItems[k].toggleClass('on', k === mode);
            });

            /* In view the formatting row is not needed: there is nothing
               to format. The shell becomes lower, the document gets more of
               the screen — this is the point of the default mode.
               We set the class in both modes: in Advanced it is inert (the rule
               with it is nested in .vo-compact), but by the return it must be
               correct — the document mode itself is changed bypassing us. And the heights —
               only in compact: doc:mode-changed also arrives here from the stock
               mode button, that is, someone else's notification. */
            document.body.classList.toggle('vo-view', mode === 'view');
            this.applyShellLayout();
        },

        documentTitle: function () {
            var main = DE.getController('Main');
            var list = [
                main && main.document && main.document.title,
                $('#rib-doc-name').text(),
                $('#id-box-doc-name').text()
            ];
            for (var i = 0; i < list.length; i++) {
                var t = (list[i] || '').trim();
                if (t) return t;
            }
            return this.textDocument;
        },

        userName: function () {
            var main = DE.getController('Main');
            var u = main && main.appOptions && main.appOptions.user;
            return (u && u.fullname) || (u && u.name) || '';
        },

        /* --- Popup surfaces --------------------------------------- */

        /* The single point "close all other popup surfaces".
           It is called by EVERY toggle before it opens its own.

           Why handlers on document were not enough. Each family —
           menu bar dropdowns, the "•••" row, the panel and mode popovers —
           had its own "close all of its own" on document, and the opening click
           of each toggle was suppressed with e.stopPropagation(), so as not to close
           what it opens. As a side effect this click did not reach OTHERS'
           handlers either: the menu and the mode popover stayed open
           simultaneously, with an equal z-index 1200, and the mode captions were clipped
           by the menu edge. Only the popovers looked mutually exclusive — exactly
           because they already had a cross-call closePopovers().
           z-index is a consequence here, not the cause, and is not touched.

           The argument is the node of the toggle that is being opened now. We do not close the
           "•••" row: controls move into it as live nodes,
           and closing the row would take the toggle home right in the middle of
           the click on it (the same case as analyzed for the value popover —
           a click that bubbled to document returned the control in the middle of a choice).
           The other families do not move nodes, they do not need such a caveat.

           We close our own surface together with the others: the caller reads the
           openness BEFORE the call and opens itself after — the same as
           closePopovers() did for the panel. */
        closeSurfaces: function (el) {
            var $el = el ? $(el) : null;

            if (this.menu) this.menu.close();
            else $('.vo-mn-drop').removeClass('open');

            var tb = this.tb;
            if (!tb) return;
            if (!($el && $el.closest('.vo-of-pop').length)) tb.closeOverflow();
            tb.closePopovers();
        },

        /* --- Menu ---------------------------------------------------------- */

        buildMenu: function () {
            /* The menu composition lives in the DocumentActions catalog, the bar mechanics —
               in the shared layer (Common.UI.Compact.MenuBar); between them is the Documents
               adapter: disable reasons, commands, the engine keyboard.
               "Help" is pinned on the right and does not go into the narrow-window "…". */
            var me = this;
            if (this.menu) this.menu.destroy();
            this.menuAdapter = DE.Views.CompactMenuAdapter.create(this, this.api);
            this.menu = Common.UI.Compact.MenuBar.create(this.menuAdapter, {pinned: 'help', icons: Icons});
            /* The surfaces are mutually exclusive (see closeSurfaces): a press in
               the menu bar closes "•••" and the panel popovers. The bar stops the bubbling
               of its clicks, so we listen in the capture phase. */
            this.menu.el.addEventListener('click', guarded('оболочка: меню и панель', function () {
                var tb = me.tb;
                if (!tb) return;
                tb.closeOverflow && tb.closeOverflow();
                tb.closePopovers && tb.closePopovers();
            }), true);
            this.menu.el.addEventListener('focusout', function (e) {
                var button = me.$editRequest && me.$editRequest[0];
                if (!button || e.relatedTarget !== button) return;
                // The menu releases SDK input before the native Tab transfer completes.
                setTimeout(guarded('shell: edit focus handoff', function () {
                    var active = document.activeElement;
                    if (me.advanced || !me.wanted() || me.menuAdapter.blocked() ||
                        !document.body.contains(button) || !active || active.id !== 'area_id') return;
                    button.focus();
                }), 0);
            }, true);
            this.applyEditButtonLock();
            return this.menu.el;
        },

        /* --- Status -------------------------------------------------------- */

        /* The status bar is about the document: page, size and zoom fit.
           There is no zoom itself here: there is exactly one controlling control, and it is in
           the toolbar. Two controls for one
           indicator had already diverged from each other. */

        buildStatus: function () {
            var me = this, api = this.api;
            var $s = $('<div id="' + STATUS_ID + '"></div>');

            this.$page  = $('<span class="vo-st-item"></span>');
            /* The word counter is recalculated on demand — by hover or
               click (see scheduleWordCount). This is not a button: there is no command behind
               it, it shows the same thing, only fresher. */
            this.$words = $('<span class="vo-st-item"></span>')
                .on('mouseenter click', function () { me.scheduleWordCount(true); });

            /* The text language and the spelling check were stock in the status bar and
               were lost in the redesign. The language is the language of the check under the caret,
               and it is changed in place, so this is its place. */
            this.$lang = $('<span class="vo-st-item"></span>');

            this.$spell = $('<button type="button" class="vo-st-btn"></button>')
                .text(this.textSpelling)
                .on('click', function () { me.toggleSpell(); });
            this.spellOn = Common.localStorage.getBool('de-settings-spellcheck', true);
            this.$spell.toggleClass('on', this.spellOn);

            $s.append($('<span class="vo-st-left"></span>'))
              .append(this.$page).append(this.$words).append(this.$lang);

            if (typeof api.asc_setSpellCheck === 'function') $s.append(this.$spell);

            if (typeof api.zoomFitToWidth === 'function') {
                $s.append($('<button type="button" class="vo-st-btn"></button>')
                    .text(this.textFitWidth)
                    .on('click', function () { api.zoomFitToWidth(); }));
            }
            if (typeof api.zoomFitToPage === 'function') {
                $s.append($('<button type="button" class="vo-st-btn"></button>')
                    .text(this.textFitPage)
                    .on('click', function () { api.zoomFitToPage(); }));
            }

            /* Icons on the right: cursor, pencil, line, cross. So far only
               drawn, without actions. */
            var GL = {
                view:  '<svg width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M4.78516 6.09049C4.50307 5.00396 5.53686 4.03648 6.60238 4.38965L14.4442 6.99056C15.6179 7.38006 15.7641 8.9813 14.6802 9.57682L13.1787 10.4012L15.5387 12.7604C16.0806 13.3025 16.0927 14.1774 15.5664 14.7347L14.6672 15.6877C14.0987 16.2894 13.1374 16.2771 12.5838 15.6616L10.223 13.0355L9.36523 14.3278C8.68751 15.3478 7.12208 15.0857 6.81397 13.9006L4.78516 6.09049ZM6.23535 5.49723C6.04729 5.43486 5.86491 5.60576 5.91471 5.79753L7.94271 13.6068C7.99709 13.8159 8.27396 13.8625 8.39355 13.6825L9.66797 11.7635C9.76776 11.6133 9.93167 11.5179 10.1115 11.5047C10.2913 11.4916 10.467 11.5627 10.5876 11.6968L13.4513 14.882C13.5491 14.9903 13.719 14.9922 13.8192 14.8861L14.7184 13.9339C14.8112 13.8356 14.8089 13.6813 14.7135 13.5856L11.8042 10.6771C11.6745 10.5474 11.614 10.3639 11.6398 10.1823C11.6657 10.0007 11.7753 9.84181 11.936 9.75342L14.1187 8.55387C14.3096 8.4487 14.284 8.16618 14.0771 8.09733L6.23535 5.49723Z"/></svg>',
                edit:  '<svg width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M12.8884 4.03497C13.5721 3.35281 14.6791 3.35344 15.362 4.03638L16.3247 4.99922C17.007 5.68156 17.0082 6.78742 16.3275 7.47126L8.30436 15.5305C8.11791 15.7178 7.88279 15.8492 7.62557 15.9099L4.33122 16.6868C3.83251 16.8044 3.39306 16.3389 3.53922 15.8478L4.48832 12.6589C4.55564 12.4327 4.67842 12.2269 4.84549 12.0602L12.8884 4.03497ZM14.537 4.8613C14.3094 4.63366 13.9403 4.63345 13.7125 4.86083L12.7221 5.84899L14.5132 7.64006L15.5007 6.64816C15.7276 6.42021 15.7272 6.05159 15.4997 5.82414L14.537 4.8613ZM13.6901 8.46687L11.8963 6.67304L6.03835 12.5181L7.85177 14.3315L13.6901 8.46687ZM4.90369 15.3531L5.43577 13.5654L6.78078 14.9104L4.90369 15.3531Z"/></svg>',
                close: '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M9.42378 8.57515C9.18947 8.34084 8.80957 8.34084 8.57525 8.57515C8.34094 8.80946 8.34094 9.18936 8.57525 9.42368L11.151 11.9994L8.57515 14.5753C8.34084 14.8096 8.34084 15.1895 8.57515 15.4238C8.80946 15.6581 9.18936 15.6581 9.42368 15.4238L11.9995 12.8479L14.575 15.4234C14.8093 15.6577 15.1892 15.6577 15.4235 15.4234C15.6578 15.1891 15.6578 14.8092 15.4235 14.5749L12.848 11.9994L15.4234 9.42403C15.6577 9.18971 15.6577 8.80981 15.4234 8.5755C15.1891 8.34118 14.8092 8.34119 14.5749 8.5755L11.9995 11.1509L9.42378 8.57515Z"/></svg>'
            };
            var $tools = $('<span class="vo-st-tools"></span>');
            ['view', 'edit', 'sep', 'close'].forEach(function (v) {
                $tools.append(v === 'sep' ? $('<span class="vo-st-sep"></span>')
                    : $('<span class="vo-st-ico vo-st-' + v + '"></span>').html(GL[v]));
            });
            $s.append($tools);
            return $s;
        },

        /* The search bar (the stock window Common.UI.SearchBar):
           — while it is open, the magnifier in the panel is pressed (.on);
           — a click anywhere outside the window closes it — with the stock close
             button, so that the stock code removes the highlight of found items. We listen to
             pointerdown on window in the capture phase: the engine canvas suppresses
             mousedown (preventDefault on pointerdown) and bubbling. A click on
             the magnifier itself is skipped here — it is handled by the button handler
             (CompactToolbar, c.search);
           — the window is placed under the magnifier (compact-shell.less, --vo-search-left).
             We take the place from the magnifier on every search:show — it is sent by both the magnifier and
             Ctrl+F — and on window resize. The magnifier is not visible (the panel
             is collapsed, view mode) — we clear the variable, the window is at the left margin.
           The window is created lazily at the first show, so visibility
           is checked by the DOM, not by a reference to the view. */
        bindSearchBar: function () {
            var me = this;
            var bar = function () { return $('.asc-window.search-bar:visible'); };
            var sync = function () {
                var b = me.tb && me.tb.ctrl && me.tb.ctrl.search;
                b && b.toggleClass('on', bar().length > 0);
            };
            var place = function () {
                var s = me.tb && me.tb.ctrl && me.tb.ctrl.search;
                var r = s && s.is(':visible') ? s[0].getBoundingClientRect() : null;
                if (r && r.width) document.body.style.setProperty('--vo-search-left', Math.round(r.left) + 'px');
                else document.body.style.removeProperty('--vo-search-left');
            };
            Common.NotificationCenter.on('search:show', place);
            $(window).on('resize', place);
            setInterval(sync, 250);
            window.addEventListener('pointerdown', function (e) {
                var $b = bar();
                if (!$b.length) return;
                var $t = $(e.target);
                if ($t.closest('.asc-window.search-bar').length) return;
                var s = me.tb && me.tb.ctrl && me.tb.ctrl.search;
                if (s && $t.closest(s).length) return;
                $b.find('#search-bar-close button').trigger('click');
                setTimeout(sync, 0);
            }, true);
        },

        /* Cmd (Mac) or Ctrl (Windows) + the wheel over the document — zoom
           in steps of 5%. The stock code changes the zoom by its own list of steps,
           so we intercept earlier than it: a listener on window in the capture
           phase, preventDefault also suppresses the browser page zoom.
           We accumulate scrolling: a mouse wheel gives one event per click (~100),
           a touchpad and a pinch — many small ones; the step is every 40 px. A zoom that is not a multiple of
           five (after fits) first lands on the nearest step. */
        bindWheelZoom: function () {
            var api = this.api, zoom = 100, acc = 0, MIN = 10, MAX = 500;
            if (typeof api.zoom !== 'function') return;
            try {
                api.asc_registerCallback('asc_onZoomChange', function (p) { zoom = p; });
            } catch (e) { /* no callback */ }
            window.addEventListener('wheel', function (e) {
                if (!(e.ctrlKey || e.metaKey)) return;
                if (!$(e.target).closest('#editor_sdk').length) return;
                e.preventDefault();
                e.stopPropagation();
                acc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
                if (Math.abs(acc) < 40) return;
                var next = acc < 0 ? Math.floor(zoom / 5 + 1e-6) * 5 + 5
                                   : Math.ceil(zoom / 5 - 1e-6) * 5 - 5;
                acc = 0;
                next = Math.max(MIN, Math.min(MAX, next));
                if (next === zoom) return;
                zoom = next;
                api.zoom(next);
            }, {capture: true, passive: false});
        },

        bindStatus: function () {
            var me = this, api = this.api;
            var on = function (n, f) {
                try { api.asc_registerCallback(n, function () {
                    if (!me.startupFailed) return f.apply(this, arguments);
                }); } catch (e) { /* no callback */ }
            };
            /* The language under the caret. The human-readable name is given by the stock
               LanguageInfo — it converts codes like 1049 into "Russian". */
            on('asc_onTextLanguage', function (langId) {
                var L = Common.util && Common.util.LanguageInfo;
                if (!L || !L.getLocalLanguageName) return;
                var info = L.getLocalLanguageName(langId);
                me.$lang.text((info && (info[1] || info[0])) || '');
            });
            on('asc_onCurrentPage', function (p) { me.pageCur = p + 1; me.renderPage(); });
            on('asc_onCountPages',  function (n) { me.pageAll = n; me.renderPage(); });
            var syncSaveState = function (flags) {
                flags = flags || {};
                if (typeof api.isDocumentModified === 'function') {
                    flags.modified = !!api.isDocumentModified();
                }
                me.setSaveState(flags);
            };
            on('asc_onDocumentModifiedChanged', function () { syncSaveState(); });
            on('asc_onDocumentCanSaveChanged', function () { syncSaveState(); });
            /* Saving in progress — the same two ids by which the stock code writes
               "Saving document…" (controller/Main.js, setLongActionView). */
            var isSave = function (id) {
                var A = window.Asc && Asc.c_oAscAsyncAction;
                return !!A && (id === A['Save'] || id === A['ForceSaveButton']);
            };
            on('asc_onStartAction', function (type, id) {
                if (isSave(id)) me.setSaveState({saving: true});
            });
            on('asc_onEndAction', function (type, id) {
                /* Modified may arrive before the SDK lock is released. Any end of an
                   action re-reads the flag, but only Save clears saving. */
                syncSaveState(isSave(id) ? {saving: false} : {});
            });
            /* The engine does not keep the word count ready: it is computed by
               startGetDocInfo, sends intermediate asc_onDocInfo and finishes with
               asc_onGetDocInfoEnd. The stock interface starts the count only
               when the statistics menu is opened.

               We must NOT stop the count ourselves. stopGetDocInfo calls
               Statistics.Stop(), and that through Check_Stop sends again
               asc_onGetDocInfoEnd (sdkjs/word/Editor/Document.js:232,272):
               Reset() does not zero the timers, so a repeated Stop reaches
               the end and the event gives birth to itself. A handler that on End
               called stopGetDocInfo hung the editor.
               End means that the engine has already stopped — it is enough for us to
               clear our flag. */
            on('asc_onDocInfo', function (info) {
                if (info && info.get_WordsCount && info.get_WordsCount() > -1) {
                    me.$words.text(Common.Utils.String.format(me.textWordsCount, info.get_WordsCount()));
                }
            });
            on('asc_onGetDocInfoEnd',  function () { me.wordsRunning = false; });
            on('asc_onGetDocInfoStop', function () { me.wordsRunning = false; });
            on('asc_onDocumentModifiedChanged', function () { me.scheduleWordCount(); });
            this.scheduleWordCount();
        },

        /* The recalculation walks the WHOLE document: startGetDocInfo goes over all
           paragraphs in portions of 21 with an event after each portion, plus all
           pages and objects (sdkjs/word/Editor/Document.js:226-255,
           17760-17799). The stock code never starts such a pass itself — its
           only calls are opening the statistics menu (view/Statusbar.js)
           and the file menu information panel (FileMenuPanels.js), and both after
           closing call stopGetDocInfo.

           What it was: the subscription is on asc_onDocumentModifiedChanged, and this
           event arrives on EVERY key, not twice per session —
           SetDocumentModified sends it unconditionally, without comparing with the previous
           value (sdkjs/word/api.js:1077-1084), and is called from
           private_UpdateInterface. That is, the event means "the interface
           was updated", not "the document changed", and the former code reset a timer
           on it, starting a full walk after every pause in typing —
           the whole session.

           What it is now. The event is now only a MARK "the data is stale".
           The recalculation happens in two cases: on demand — hover or click on
           the counter, that is, exactly when the user is looking at it, — and no
           more than once a minute by itself, so that the caption does not mislead during long editing.
           The timer is no longer re-armed on every character: while it is armed,
           a second one is not needed, otherwise with continuous typing the recalculation would
           never happen at all.

           We must NOT stop the count ourselves — see the analysis at the subscription to
           asc_onGetDocInfoEnd above. */

        WORDS_PAUSE:   5000,     // a pause in typing after which the count does not interfere
        WORDS_MIN_GAP: 60000,    // our own recalculation — no more than once a minute
        wordsStale: false,
        wordsAt: 0,

        scheduleWordCount: function (force) {
            if (this.startupFailed) return;
            var me = this;
            if (typeof this.api.startGetDocInfo !== 'function') return;

            if (force) {
                clearTimeout(this.wordsTimer);
                this.wordsTimer = null;
                /* The data is fresh — there is nothing to count: moving the mouse back and forth
                   would otherwise start a full walk on every entry. */
                if (this.wordsAt && !this.wordsStale) return;
                this.runWordCount();
                return;
            }

            this.wordsStale = true;
            /* In Advanced and in focus mode the caption is not visible at all: walking
               the document for an invisible number is a waste. The mark stays, and
               the return to the compact view will arm the recalculation itself (toggleMode). */
            if (this.advanced) return;
            if (this.wordsTimer) return;

            var since = this.wordsAt ? (Date.now() - this.wordsAt) : this.WORDS_MIN_GAP;
            var wait = Math.max(this.WORDS_PAUSE, this.WORDS_MIN_GAP - since);
            this.wordsTimer = setTimeout(function () {
                me.wordsTimer = null;
                me.runWordCount();
            }, wait);
        },

        runWordCount: function () {
            if (this.startupFailed || this.wordsRunning) return;
            if (typeof this.api.startGetDocInfo !== 'function') return;
            this.wordsStale = false;
            this.wordsAt = Date.now();
            this.wordsRunning = true;
            try { this.api.startGetDocInfo(); } catch (e) { this.wordsRunning = false; }
        },

        /* The spelling check is a session setting, not a document one: we tell
           the engine right away, and keep the state in the same place as the stock interface,
           otherwise after exiting to Advanced the values would diverge. */
        toggleSpell: function () {
            this.spellOn = !this.spellOn;
            this.api.asc_setSpellCheck(this.spellOn);
            Common.localStorage.setItem('de-settings-spellcheck', this.spellOn ? 1 : 0);
            Common.Utils.InternalSettings.set('de-settings-spellcheck', this.spellOn);
            this.$spell.toggleClass('on', this.spellOn);
        },

        renderPage: function () {
            if (this.pageAll) {
                this.$page.text(Common.Utils.String.format(this.textPageIndex, this.pageCur || 1, this.pageAll));
            }
        },

        /* --- The engine canvas --------------------------------------------------- */
        /* The background around the page and the page frame are drawn by the engine, but it takes them
           from CSS variables via asc_setSkin(). The stock call happens at
           initialization — earlier than in dev mode our LESS manages to compile,
           so the colors arrive old. We re-apply the skin after
           the shell is built. The sdkjs fork is not needed for this.

           The stock getThemeColors takes colors from body, while our canvas palette
           hangs on the children of body (compact-shell.less, "The engine canvas"): body
           keeps the theme colors for its cache. So on top of the theme snapshot we read
           the same variables from #editor_sdk — what the canvas itself sees. In
           Advanced there is no shell rule, and the node inherits the theme as is. */

        canvasSkin: function () {
            var colors = Common.UI.Themes.getThemeColors(),
                host = document.getElementById('editor_sdk');
            if (!host) return colors;
            var style = getComputedStyle(host);
            Object.keys(colors).forEach(function (key) {
                if (key === 'type' || key === 'name') return;
                var value = style.getPropertyValue('--' + key).trim();
                if (value) colors[key] = value;
            });
            return colors;
        },

        applyCanvasSkin: function () {
            var me = this, api = this.api;
            if (this.startupFailed || !api || !api.asc_setSkin || !Common.UI.Themes || !Common.UI.Themes.getThemeColors) return;
            var apply = function () {
                if (me.startupFailed) return;
                try { api.asc_setSkin(me.canvasSkin()); } catch (e) { /* skip */ }
            };
            apply();
            /* less.js in dev mode is asynchronous: we repeat when the styles have certainly
               applied. In the built version the second call is harmless. */
            clearTimeout(this.skinTimer);
            this.skinTimer = setTimeout(apply, 600);
        },

        /* --- Layout ------------------------------------------------------ */
        /* The stock areas are not removed: vertical ones get a height set, for side ones
           the space is removed by styles.
           Important about the side ones: in hlayout the left and right elements are declared
           rely:true (Viewport.js), and Layout with rely takes the width from the DOM and
           ignores its own width field (Layout.js:528,551). Assigning them
           width is pointless — it used to be done here, and it looked
           working only because the space was removed by display:none. */

        applyLayout: function (compact) {
            var vp = DE.getController('Viewport');
            var view = vp && vp.viewport;
            if (!view || !view.vlayout) return;

            var v = view.vlayout, h = view.hlayout;
            var tb = v.getItem('toolbar'), st = v.getItem('statusbar');

            /* We take the snapshot of the stock heights not once at start, but every time
               the heights are not yet ours — this is the only moment when they are
               stock. While we are in Advanced, they are led by the stock code: the ribbon
               collapse (controller/Viewport.js:91-94) and the theme change (:376-379).
               A snapshot taken at start goes stale by this time, and the return to
               Advanced would clip the ribbon to the start height instead of the current.
               The worst case is the saved de-compact-toolbar setting: the snapshot
               is taken from an already collapsed ribbon, and the ribbon expanded in Advanced would be clipped
               to the tab height.
               This also makes applyLayout(false) harmless when the heights are
               stock anyway: it will rewrite them with the same numbers.
               The other side of the same — a theme change IN COMPACT: there the stock
               handler manages to put the fresh stock heights while ours is
               still true, and the snapshot would have missed them. The flag for this is cleared
               by the theme handler itself, see bindLeftPanels. */
            if (!this.ours) {
                this.base = { toolbar: tb && tb.height, status: st && st.height };
            }
            this.ours = !!compact;
            var b = this.base;

            document.body.classList.toggle('vo-rulers', !!compact && this.rulersVisible);

            /* The stock layout understands a zero height as "not set" and measures
               the area itself (Layout.js, VBoxLayout.doLayout: style.height ||
               getElementHeight). While the area has a height transition
               (compact-shell.less, .vo-compact #toolbar), the measurement returns
               the previous height: the document stays under an empty strip in place of
               the header and the menu, and its bottom with the bottom row goes beyond the window. Zero
               happens when the top is hidden and the toolbar row is not on the screen
               (view, a turned-off toolbar row). So we set zero
               without a transition — the measurement sees zero at once; any other height
               lifts the ban, and the transition works again. */
            if (tb) {
                tb.height = compact ? this.layoutHeight() : b.toolbar;
                tb.el.css({height: tb.height + 'px', transition: tb.height ? '' : 'none'});
            }
            if (st) { st.height = compact ? H_STATUS : b.status;  st.el.css('height', st.height + 'px'); }

            v.doLayout();
            h && h.doLayout();
            this.syncDocGaps(!!compact);

            Common.NotificationCenter.trigger('layout:changed', 'toolbar');
            /* The controls of the stock ribbon compute width at rendering: while it is
               hidden, the widths are zero, so a recalculation is needed after showing. */
            this.resync();
        },

        /* The layout for the shell is also requested by other notifications: a theme change
           (bindLeftPanels), a document mode change (applyDocModeLook),
           chrome collapsing (setChrome). In Advanced it must not serve them.
           The area heights there are not ours, and applyLayout(false) will not "leave as
           is", but will rewrite the stock layout with our snapshot — plus give
           doLayout, layout:changed, resize and api.Resize out of the blue.
           So in Advanced we stay silent, like applyRightPanel.
           The gate is located here, not inside applyLayout, and this is fundamental:
           besides the gate itself there are exactly two direct calls of applyLayout, and both are ours.
           The first is toggleMode: on leaving for Advanced it calls applyLayout(false),
           and this call is legitimate, it is what returns the stock layout its
           heights. A gate inside applyLayout would have killed it and left the stock
           interface with the compact geometry — the same defect, only mirrored.
           The second is create(), there is a hard applyLayout(true); it is allowed to
           because at start advanced is still false.
           The modes are mutually exclusive. */
        applyShellLayout: function () {
            if (this.advanced) return;
            this.skipTopScroll();
            this.applyLayout(true);
        },

        /* The recalculation of the areas after a layout change. The document shift from
           it is not the person's scrolling (onDocScroll). */
        resync: function () {
            this.skipTopScroll();
            $(window).trigger('resize');
            if (this.api && this.api.Resize) this.api.Resize();
        },

        /* --- Side panels -------------------------------------------------- */
        /* Comments and the document structure live in the stock left menu, and
           we must not replace them with our own: these are stock components with their own
           callbacks. So we do not build a panel but press the stock button
           — its handler itself shows the panel, sets the area width and
           sends layout:changed. Our job is to remove display:none from the area, because of
           which it did not take space, and to reflect the state in the header. */

        stockLeftBtn: function (name) {
            var lm = DE.getController('LeftMenu');
            var view = lm && lm.leftMenu;
            var prop = LEFT_PANELS[name];
            return (view && prop && view[prop]) || null;
        },

        /* The panel is available if the document config allows it. The structure
           is always available, comments — only with the right to see them. */
        canUse: function (name) {
            if (!this.stockLeftBtn(name)) return false;
            var main = DE.getController('Main');
            var o = (main && main.appOptions) || {};
            if (name === 'comments') return !!(o.canCoAuthoring && o.canViewComments);
            return true;
        },

        /* ADDING a comment is a different right than showing the panel. The stock code
           separates them everywhere: the panel lives under canViewComments, and each entry
           point "Comment" — under `canCoAuthoring && canComments`
           (controller/Toolbar.js:4084, view/DocumentHolderExt.js:1866,2509,
           2729, controller/DocumentHolder.js:213, lib/view/Comments.js:750).
           The configuration "editing allowed, commenting forbidden"
           is reachable by two paths — permissions.comment === false and
           customization.comments === false (controller/Main.js:1725-1726), —
           and the engine does not enforce this right: at isEdit restriction stays
           None. It is asked by all four of our entry points: the panel button,
           the item "Insert → Comment", the "/" menu and the bubble. */
        canAddComment: function () {
            var main = DE.getController('Main');
            var o = (main && main.appOptions) || {};
            return !!(o.canCoAuthoring && o.canComments);
        },

        /* Open the panel if it is not yet open. Needed before actions
           whose result appears in it — for example adding
           a comment. */
        ensureLeftPanel: function (name) {
            var btn = this.stockLeftBtn(name);
            if (btn && !btn.pressed) this.toggleLeftPanel(name);
        },

        toggleLeftPanel: function (name) {
            var btn = this.stockLeftBtn(name);
            if (!btn || btn.isDisabled()) return;

            /* We set the class before the press: the stock handler measures the width
               of the area to decide whether to expand the panel, and for a
               hidden area the width is zero. Then the state is put in
               order by syncLeftState — it is also called by layout:changed, when
               the panel is closed with the stock X button. */
            document.body.classList.add('vo-left-open');
            btn.click();
            this.syncLeftState();
        },

        /* The only source of truth is the pressed state of the stock buttons. The panel
           is closed in three ways: by our button, by the X button inside the
           panel itself (Comments.js:963 → leftmenu:change → onMenuChange) and by a hot
           key. Before, only the first was accounted for, and after the X button an empty
           strip remained of the area, while the header button stayed lit. */
        syncLeftState: function () {
            var me = this;
            var open = false;

            Object.keys(LEFT_PANELS).forEach(function (name) {
                var stock = me.stockLeftBtn(name);
                var pressed = !!(stock && stock.pressed);
                if (pressed) open = true;
            });

            /* The "Comment" button on the panel is pressed while comments are open.
               Before the early exit below: switching one left panel to another
               does not change the class on body, but it does change the button's pressed state. */
            var comments = me.stockLeftBtn('comments');
            me.tb && me.tb.setCommentsOpen && me.tb.setCommentsOpen(!!(comments && comments.pressed));

            if (document.body.classList.contains('vo-left-open') === open) return;
            document.body.classList.toggle('vo-left-open', open);

            /* The area visibility changed after the layout
               was already computed — we recompute. We call doLayout directly, so as not to
               send layout:changed and not to enter our own handler. */
            var vp = DE.getController('Viewport');
            var h = vp && vp.viewport && vp.viewport.hlayout;
            h && h.doLayout();
            this.resync();
        },

        /* --- Room for the rail -------------------------------------------------- */
        /* The rail takes space not "on top" but as an honest layout column: its own
           item in hlayout with rely:true — it takes the width from the DOM, exactly like
           the right panel. It cannot be done through #left-menu: that one is managed by
           syncLeftState by the pressed state of the stock buttons, and the comments panel
           would collide with our width. */

        railSlot: function () {
            var el = document.getElementById('vo-rail-slot');
            var vp = DE.getController('Viewport');
            var h = vp && vp.viewport && vp.viewport.hlayout;
            if (!h) return null;

            /* The stock code rebuilds the layout itself (comments, history,
               Advanced) and may throw out our item. We check not the presence of the node
               in the DOM, but participation in the layout. */
            var inLayout = h.panels && h.panels.some(function (p) {
                return p.el && p.el.attr && p.el.attr('id') === 'vo-rail-slot';
            });
            if (el && inLayout) return el;

            if (!el) {
                var host = document.getElementById('viewport-hbox-layout');
                var container = document.getElementById('editor-container');
                if (!host || !container) return null;
                el = document.createElement('div');
                el.id = 'vo-rail-slot';
                el.style.width = '0px';
                host.insertBefore(el, container);
            }

            /* We rebuild the layout only when the item does not participate in it:
               changeLayout resets the panels and recreates the separators, so
               calling it on every width change is not allowed — afterwards
               doLayout is enough. */
            var items = h.panels.filter(function (p) { return !p.isresizer; })
                .map(function (p) {
                    return {el: p.el, rely: p.rely, stretch: p.stretch, resize: p.resize, alias: p.alias};
                });
            h.changeLayout([{el: $(el), rely: true}].concat(items));
            return el;
        },

        /* Width 0 means "we take no space": the node stays in the layout
           so as not to rebuild it on every switch. */
        reserveLeft: function (px) {
            if (this.startupFailed) return false;
            var el = this.railSlot();
            if (!el) return false;
            if (parseInt(el.style.width, 10) === px) return true;

            el.style.width = px + 'px';
            var vp = DE.getController('Viewport');
            var h = vp && vp.viewport && vp.viewport.hlayout;
            h && h.doLayout();
            if (this.api && this.api.Resize) this.api.Resize();
            return true;
        },

        /* The right properties panel is needed only for objects — we open it on
           request, and do not keep it permanently. The space for it is given by a class on body:
           an element rely:true, it takes the width from the DOM.

           The decision and its application are separated. The decision is stored by rightOpen, and
           it is always updated; it is applied only in the compact view. In
           Advanced the right panel is managed by the stock interface with its own
           icon column — our class means nothing there, and doLayout and
           api.Resize on every object selection the engine would compute for nothing.
           On return to the compact view the decision is applied anew
           (toggleMode): a mode change does not produce a new asc_onFocusObject,
           so otherwise the panel would stay closed with an object selected —
           and there would be nothing to open it with, the panel has no button of its own. */
        bindPropertiesInsets: function () {
            if (this._propertiesInsets) return;
            var node = document.getElementById(SHELL_ID);
            if (!node) return;
            var me = this;
            var vp = DE.getController('Viewport');
            var layout = vp && vp.viewport && vp.viewport.hlayout;
            var state = this._propertiesInsets = {
                node: node,
                layout: layout,
                properties: ['--vo-properties-inset-left', '--vo-properties-inset-right'],
                original: [],
                frame: null,
                left: null,
                right: null
            };
            state.properties.forEach(function (name) {
                state.original.push([node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]);
            });
            state.update = guarded('properties layout', function () { me.schedulePropertiesInsets(); });
            Common.NotificationCenter.on('layout:changed layout:resizestop', state.update);
            $(window).on('resize', state.update);
            if (layout) layout.on('layout:resizedrag', state.update);
            if (window.ResizeObserver) {
                state.observer = new ResizeObserver(state.update);
                state.observer.observe(node);
                var panel = document.getElementById('right-menu');
                if (panel) state.observer.observe(panel);
            }
            this.schedulePropertiesInsets();
        },

        schedulePropertiesInsets: function () {
            var state = this._propertiesInsets;
            if (!state || state.frame !== null) return;
            var me = this;
            state.frame = window.requestAnimationFrame(guarded('properties layout', function () {
                state.frame = null;
                if (me._propertiesInsets === state) me.syncPropertiesInsets();
            }));
        },

        restorePropertiesInsets: function () {
            var state = this._propertiesInsets;
            if (!state) return;
            if (state.frame !== null) window.cancelAnimationFrame(state.frame);
            state.frame = null;
            state.properties.forEach(function (name, index) {
                var original = state.original[index];
                if (original[0]) state.node.style.setProperty(name, original[0], original[1]);
                else state.node.style.removeProperty(name);
            });
            state.left = state.right = null;
        },

        unbindPropertiesInsets: function () {
            var state = this._propertiesInsets;
            if (!state) return;
            this.restorePropertiesInsets();
            Common.NotificationCenter.off('layout:changed layout:resizestop', state.update);
            $(window).off('resize', state.update);
            if (state.layout) state.layout.off('layout:resizedrag', state.update);
            if (state.observer) state.observer.disconnect();
            this._propertiesInsets = null;
        },

        syncPropertiesInsets: function () {
            var state = this._propertiesInsets;
            if (!state) return;
            if (this.advanced || this.startupFailed || !document.body.classList.contains('vo-compact')) {
                this.restorePropertiesInsets();
                return;
            }
            var left = 0, right = 0;
            var panel = document.getElementById('right-menu');
            if (panel && panel.getClientRects().length) {
                var bounds = state.node.getBoundingClientRect();
                var rect = panel.getBoundingClientRect();
                if (rect.width > 0 && bounds.width > 0) {
                    if (Common.UI.isRTL()) left = Math.min(bounds.width, Math.max(0, rect.right - bounds.left));
                    else right = Math.min(bounds.width, Math.max(0, bounds.right - rect.left));
                }
            }
            if (left === state.left && right === state.right) return;
            state.node.style.setProperty(state.properties[0], left + 'px');
            state.node.style.setProperty(state.properties[1], right + 'px');
            state.left = left;
            state.right = right;
            if (this.tb && this.tb.relayout) this.tb.relayout();
        },

        applyRightPanel: function () {
            this.refreshMenuLocks();
            if (this.advanced) return;
            if (document.body.classList.contains('vo-right-open') === this.rightOpen) return;
            document.body.classList.toggle('vo-right-open', this.rightOpen);

            var vp = DE.getController('Viewport');
            var h = vp && vp.viewport && vp.viewport.hlayout;
            h && h.doLayout();
            this.schedulePropertiesInsets();
            this.resync();
        },

        /* The manual entry is "View → Object properties" (DocumentActions.js:241,
           the "View" menu). It needs both directions: it is the only place
           from which the panel can be removed if it was opened not by selection.

           AN INVISIBLE INVARIANT. The write to rightOpen below is unconditional: in Advanced
           applyRightPanel exits on the first line, but the field is still
           flipped — and will be applied on return to the compact view,
           on top of what the selection decided. This is safe exactly because
           in Advanced both manual entry points are physically unavailable: the menu item
           lives in .vo-mn inside #vo-shell, the bubble button — in #vo-bubble, and
           both nodes are hidden by ONE rule in another file:
           resources/less/compact-shell.less, the .vo-advanced block
           ("#vo-shell, #vo-status, #vo-outline, #vo-bubble
           { display: none !important; }", the block starts at :319, the line
           itself — :330; there is a back reference here too). There is no guard in code — it is
           entirely in this CSS line.
           If #vo-shell (or #vo-bubble) is removed from there — the item will start silently
           flipping the decision, and it will break not here and not at once, but at the
           next mode switch. When touching that rule, come back here. */
        toggleRightPanel: function () {
            this.rightOpen = !this.rightOpen;
            this.applyRightPanel();
        },

        /* The bubble explicitly opens the sidebar, including when chart focus
           left it closed. Repeated requests must not toggle it off. */
        openRightPanel: function () {
            this.rightOpen = true;
            this.applyRightPanel();
        },

        openTableProperties: function () {
            if (this.advanced || this.startupFailed || this.editingLocked()) return;

            var bubble = DE.Views.SelectionBubble;
            var actions = DE.Views.DocumentActions;
            var right = DE.getController('RightMenu');
            var types = Common.Utils && Common.Utils.documentSettingsType;
            var type = types && types.Table;
            var menu = right && right.rightmenu;
            var settings = right && right._settings && right._settings[type];
            var api = this.api;
            if (!api || typeof api.getSelectedElements !== 'function' ||
                !bubble || typeof bubble.classifyContext !== 'function' ||
                !actions || typeof actions.itemLocked !== 'function' ||
                !right || !right.editMode || typeof right.onFocusObject !== 'function' ||
                typeof right.tryToShowRightMenu !== 'function' || typeof right.onRightMenuOpen !== 'function' ||
                !menu || !menu.mode || !settings || !settings.panel || !settings.btn ||
                !menu._settings || !menu._settings[type]) return;

            if (actions.itemLocked({lock: ['rightMenu']}) ||
                (menu.mode.canBrandingExt && menu.mode.customization &&
                    menu.mode.customization.rightMenu === false)) return;

            var elements;
            try { elements = api.getSelectedElements(); } catch (e) { return; }
            var context = bubble.classifyContext(elements);
            if (context.state !== 'known' || context.kind !== 'table') return;

            right.onFocusObject(elements);
            if (settings.hidden || settings.btn.isDisabled()) return;

            this.openRightPanel();
            // An already active category must still restore a hidden native sidebar.
            right.tryToShowRightMenu();
            right.onRightMenuOpen(type);
        },

        /* Selection may open editable properties for ordinary drawings. Text, empty selection,
           tables and pure charts preserve the explicit visibility state. */
        watchSelection: function () {
            var me = this, api = this.api;
            if (!api || !api.asc_registerCallback) return;

            try {
                api.asc_registerCallback('asc_onFocusObject', function (elements) {
                    if (me.startupFailed) return;
                    /* The last set is needed by Escape (the engine layer) and the footer
                       hint; a copy — the engine reuses its stack. */
                    me.lastFocusObjects = elements ? Array.prototype.slice.call(elements) : [];
                    me.syncRightPanel(elements);
                    me.syncHeaderHint();
                });
            } catch (e) { /* no callback — the panel stays manual */ }
        },

        syncRightPanel: function (elements) {
            var T = window.Asc && Asc.c_oAscTypeSelectElement;
            if (!T || !elements) return;

            // The SDK also represents charts as Image drawing objects.
            var kind = 'text';
            for (var i = 0; i < elements.length; i++) {
                var element = elements[i];
                var type = element.get_ObjectType && element.get_ObjectType();
                if (type === T.Image || type === T.Shape || type === T.Chart) {
                    var props = element.get_ObjectValue && element.get_ObjectValue();
                    var shapeProps = props && typeof props.get_ShapeProperties === 'function' && props.get_ShapeProperties();
                    var isChart = type === T.Chart || (props &&
                        typeof props.get_ChartProperties === 'function' && props.get_ChartProperties()) || (shapeProps &&
                        typeof shapeProps.get_FromChart === 'function' && shapeProps.get_FromChart());
                    if (!isChart) kind = 'object';
                    else if (kind !== 'object') kind = 'chart';
                } else if (type === T.Table && kind === 'text') kind = 'table';
            }

            /* Word merges ordinary shapes and charts into one ShapeProperties
               record and ORs FromChart. The focus stack loses their individual
               types; use the SDK selection to keep ordinary drawings' priority. */
            if (kind === 'chart' && this.api && typeof this.api.getGraphicController === 'function') {
                var controller = this.api.getGraphicController();
                var drawings = controller && typeof controller.getSelectedArray === 'function' && controller.getSelectedArray();
                if (drawings) {
                    for (var j = 0; j < drawings.length; j++) {
                        if (typeof drawings[j].isChart === 'function' && !drawings[j].isChart()) {
                            kind = 'object';
                            break;
                        }
                    }
                }
            }

            /* A table is the third state, not "close". It does not count
               as a reason to open: it has its own surface — a bubble with rows,
               columns and properties, two sets of controls for one selection are
               worse than one. But the panel must not be turned off on it either: one opened
               by hand would be wiped out by the very first asc_onFocusObject — moving the
               caret to a neighboring cell or a selection resync after
               applying a property from the panel itself. */
            // Only ordinary drawings change visibility; leaving them does not dismiss properties.
            if (kind !== 'object') return;

            var lock = this.lockState();
            if (lock.on && lock.options.rightMenu && lock.options.rightMenu.disable) return;

            this.rightOpen = true;
            this.applyRightPanel();
        },

        /* --- Modes -------------------------------------------------------- */

        toggleMode: function () {
            /* While the mode is switching, the canvas geometry is intermediate:
               measured on 10.09 — right after returning to the compact view the left
               edge of the page read as 117 instead of 108, and the rail rule
               took this for "does not fit" and collapsed it. The flag tells the
               rail to stay silent until the layout settles. */
            var me = this;
            this.modeSwitching = true;
            clearTimeout(this._modeTimer);
            this._modeTimer = setTimeout(function () {
                me.modeSwitching = false;
                var rail = DE.Views.OutlineRail;
                rail && rail.applyFit && rail.applyFit();
            }, 300);
            /* The mode change matters to the rail even before the geometry settles:
               in Advanced it releases the engine structure flag, on return
               takes it back and re-reads the content (onModeChange).
               The call below goes after this.advanced is switched. */

            /* The stock opening in Advanced could have left the saved width
               of the collapsed column. Before handing the panel back to the stock
               chrome we restore it through the existing compact path, while
               its width check is still in effect. We do not send the request:
               search:aftershow belongs only to the opening action. */
            var left = DE.getController('LeftMenu');
            var menu = left && left.leftMenu;
            if (!this.advanced && menu && menu.btnSearchBar && menu.btnSearchBar.pressed) {
                menu.showMenu('advancedsearch', undefined, true);
            }
            this.advanced = !this.advanced;
            document.body.classList.toggle('vo-compact', !this.advanced);
            document.body.classList.toggle('vo-advanced', this.advanced);
            /* The top that went away on scroll is not carried into Advanced: on return
               the user sees the header and the menu. One collapsed manually stays
               collapsed — that is their choice. We do not touch the layout here:
               applyShellLayout is silent in Advanced, the heights are set by applyLayout below. */
            if (this.advanced && this.top && this.top.cause === 'scroll')
                this.setChrome({hidden: false, cause: null, tbHidden: this.tbHidden});
            this.syncPropertiesInsets();
            if (DE.Views.CompactWindows) DE.Views.CompactWindows.setActive(!this.advanced);
            /* The side panels are the shell state. In Advanced they are managed by
               the stock interface with its own icon column, so we remove our classes:
               otherwise the area would stay expanded without a button to close
               it. The stock buttons keep their state meanwhile. */
            document.body.classList.remove('vo-right-open');
            document.body.classList.remove('vo-left-open');
            this.applyLayout(!this.advanced);
            this.restoreStockLook();
            this.ensureBackButton();
            /* The class was removed, the decision stayed — on return to the compact view
               it is applied anew. Otherwise the object would stay selected on
               the canvas, and the panel of its properties — closed. */
            this.applyRightPanel();
            /* The same for the LEFT panel, and it was missing here. The room for it
               is held entirely by the vo-left-open class, while the truth about the panel
               is held by the pressed state of the stock buttons — it is brought into line
               only by syncLeftState, and it is called from two places: toggleLeftPanel and
               the subscription to layout:changed with area === 'leftmenu'. On the path of
               toggleMode neither fires: applyLayout sends
               layout:changed 'toolbar', and resync() gives window.resize, that is
               'window'. Consequence: open comments after the circle
               Compact → Advanced → Compact vanished, while btnComments.pressed
               stayed true — the next click on the header button closed the
               stock panel, outwardly doing nothing, and the panel opened
               only on the second press.

               Only on the return to compact: in Advanced the side panels are
               managed by the stock interface with its own icon column, and
               our class means nothing there. */
            if (!this.advanced) this.syncLeftState();
            /* The word counter was not recalculated in Advanced — there is no caption there
               (see scheduleWordCount). We returned to compact, and the "stale"
               mark remained — we arm the recalculation in the usual way. */
            if (!this.advanced && this.wordsStale) this.scheduleWordCount();
            var rail = DE.Views.OutlineRail;
            rail && rail.onModeChange && rail.onModeChange();
        },

        /* Preserve the current document's ruler choice across UI modes.
           Previous documents and browser preferences must not enable rulers automatically. */
        restoreStockLook: function () {
            var da = DE.Views.DocumentActions;
            try {
                da.setRulers(da.rulersWanted(this.advanced), false);
            } catch (e) { /* not critical */ }
            this.applyCanvasSkin();
        },

        /* Return from Advanced. Before, the button was inserted at the start of the stock
           header and pushed the logo out to the controls row — now it
           goes to the right group of the header, where there is room for it. */
        ensureBackButton: function () {
            var me = this;
            if (!this.advanced) { $('#vo-back').remove(); return; }
            if (document.getElementById('vo-back')) return;

            var $btn = $('<button type="button" id="vo-back" class="vo-mode"></button>')
                .text(this.textCompact)
                .attr('title', this.tipBackToCompact)
                .on('click', function () { me.toggleMode(); });

            var $host = $('#box-right-btn-group').first();
            if (!$host.length) $host = $('#toolbar .extra').first();
            $host.length ? $host.append($btn) : $('body').append($btn.addClass('vo-back-float'));
        },

        /* --- Focus mode and panel collapsing ------------------------------ */
        /* Both states change only the shell height and do not depend on each
           other.
           The top — the header and the menu row — is hidden or visible (top) and remembers why it is
           hidden: manual — the chevron on the right of the toolbar row or "View →
           Focus mode", scroll — it went away on document scrolling. The layout,
           styles and chevron look only at "hidden"; what the top returns on
           depends on the reason. The toolbar row, the structure rail, the bottom
           row and the side panels stay as they were.
           Collapsing the toolbar row (tbHidden) removes only it;
           to return it — "View → Toolbar", and this item first
           opens the top: otherwise the menu from which it was chosen would vanish.
           Manual collapsing of the top, on the contrary, expands the toolbar
           row: it has the chevron by which the top is returned. Without both
           rows there would be nothing to return the chrome with except Escape. */

        top: {hidden: false, cause: null},
        /* Read-only: the top is collapsed manually (the "View → Focus
           mode" mark). It is written by setChrome together with top. */
        focus: false,
        tbHidden: false,
        topTimer: null,

        topHidden: function () {
            return !!(this.top && this.top.hidden);
        },

        /* The top rows are removed from the layout (the vo-top-hidden class on body).
           It lags behind topHidden() for the duration of the departure: the rows first slide away, then the
           layout gives their place to the document (moveTop). The shell heights
           are computed by it. */
        topOut: function () {
            return document.body.classList.contains('vo-top-hidden');
        },

        shellHeight: function () {
            /* In view there is no formatting row at all — not "hidden", but
               nonexistent as a need. We do not reserve room for it.
               The card gaps are part of tb: without the toolbar row there are none either. */
            var tb = (this.tbHidden || this.docMode === 'view')
                   ? 0
                   : H_TB_GAP_TOP + H_TOOLBAR + H_TB_GAP;
            return this.topOut() ? tb : tb + H_HEADER + H_MENU;
        },

        /* The document margins under the panel card and above the bottom row — 20 each.
           Both sit over the document area, so
           we shift the engine content itself:
           — at the top: the stock setOffsetTop (sdkjs WordControl, made for the
             mobile header) — the first page starts at offsetTop + 20
             (viewBetweenPagesVer). H_TOOLBAR is the card height above the area, so
             the page is 20 below the card. Without a card (view, a collapsed
             panel) — 0, as in the stock code;
           — at the bottom: at the end of the document the engine has its own 20 to the edge of the area, and
             the bottom row (30) sits over it — we add its height to the document
             height in CalculateDocumentSize, and on scrolling to the end
             the page sits 20 above the row.
             The engine publishes the scroll range inside the same recalculation
             (UpdateScrolls, HtmlPage.js:3209), earlier than the addition, — so
             after it it is published anew. Fitting the zoom by width or
             page recalculates the document from inside a recalculation
             (zoom_FitToWidth → zoom_Fire → CalculateDocumentSize), and the height
             is computed from zero by every recalculation: the reserve is added only by
             an outer call, once.
           The engine internals — all in try: if it fails, the stock margins remain. */
        syncDocGaps: function (compact) {
            try {
                var wc = this.api && this.api.WordControl;
                if (!wc || typeof wc.setOffsetTop !== 'function') return;
                if (!wc._voGapPatched && typeof wc.CalculateDocumentSize === 'function') {
                    var calc = wc.CalculateDocumentSize;
                    wc.CalculateDocumentSize = function () {
                        var r;
                        this._voCalcDepth = (this._voCalcDepth || 0) + 1;
                        try {
                            r = calc.apply(this, arguments);
                        } finally {
                            this._voCalcDepth--;
                        }
                        if (this._voBottomGap && !this._voCalcDepth) {
                            this.m_dDocumentHeight += this._voBottomGap;
                            this.UpdateScrolls && this.UpdateScrolls();
                        }
                        return r;
                    };
                    wc._voGapPatched = true;
                }
                // Visible rulers move the toolbar outside the SDK, so no overlay offset is needed.
                var card = compact && !this.rulersVisible && !this.tbHidden && this.docMode !== 'view';
                wc._voBottomGap = compact ? 30 : 0;
                wc.setOffsetTop(card ? H_TOOLBAR : 0);
                wc.CalculateDocumentSize();
                wc.UpdateScrolls && wc.UpdateScrolls();
                wc.OnScroll && wc.OnScroll();
            } catch (e) { /* the stock margins remain */ }
        },

        /* The document goes under the panel card and is clipped at its top
           edge — the gray gap between the menu and the card stays solid.
           So the layout holds the header, the menu and the top gap, while the card itself
           (#vo-tb) extends past the bottom of the area over the document (CSS at the end of
           compact-shell.less). shellHeight is still the full chrome height. */
        layoutHeight: function () {
            // Reserve the entire toolbar when it would otherwise cover the SDK ruler strip.
            var tb = (this.tbHidden || this.docMode === 'view') ? 0
                : this.rulersVisible ? H_TB_GAP_TOP + H_TOOLBAR + H_TB_GAP : H_TB_GAP_TOP;
            return this.topOut() ? tb : tb + H_HEADER + H_MENU;
        },

        syncRulers: function (show) {
            show = !!show;
            if (this.rulersVisible === show) return;
            this.rulersVisible = show;
            if (!this.startupFailed) this.applyShellLayout();
        },

        /* Hide the top. Manual collapsing is stronger than scrolling: it pins a top
           that went away by scrolling, while scrolling does not overwrite one collapsed manually.
           In Advanced and after a start rollback — nothing: there the
           header and the menu row are not ours. */
        hideTop: function (cause) {
            if (this.advanced || this.startupFailed) return;
            cause = cause === 'scroll' ? 'scroll' : 'manual';
            var top = this.top || {};
            if (top.hidden && (top.cause === cause || top.cause === 'manual')) return;
            this.setChrome({hidden: true, cause: cause, tbHidden: this.tbHidden});
        },

        /* Return the top, whatever the reason it was hidden. */
        showTop: function () {
            if (!this.topHidden()) return;
            this.setChrome({hidden: false, cause: null, tbHidden: this.tbHidden});
        },

        /* The chevron and "View → Focus mode": a hidden top — show, otherwise
           collapse manually. A collapsed toolbar row is expanded by manual collapsing
           (it has the return chevron); in view there is no row, we do not touch its
           state. */
        toggleFocus: function () {
            if (this.topHidden()) {
                this.showTop();
                return;
            }
            if (this.advanced || this.startupFailed) return;
            this.setChrome({hidden: true, cause: 'manual',
                tbHidden: this.docMode === 'view' ? this.tbHidden : false});
        },

        toggleToolbar: function () {
            this.setChrome({hidden: false, cause: null, tbHidden: !this.tbHidden});
        },

        /* The document structure in compact is the OutlineRail rail, and only it:
           the stock navigation panel is not opened from here, otherwise the structure
           would be shown twice. Whether the rail is open or collapsed, it remembers itself. */
        outlineRail: function () {
            var rail = DE.Views.OutlineRail;
            return rail && rail.$el ? rail : null;
        },

        outlineOpen: function () {
            var rail = this.outlineRail();
            return !!(rail && rail.open);
        },

        toggleOutline: function () {
            var rail = this.outlineRail();
            if (!rail || rail.locked) return;
            rail.toggle();
        },

        /* The currently open left panel — by the pressed state of the stock button, as in
           syncLeftState. The panels exclude each other, no more than one is open. */
        openLeftPanel: function () {
            var names = Object.keys(LEFT_PANELS);
            for (var i = 0; i < names.length; i++) {
                var btn = this.stockLeftBtn(names[i]);
                if (btn && btn.pressed) return names[i];
            }
            return null;
        },

        /* --- The header/footer hint ------------------------------------------ */
        /* While the caret is in a header/footer (asc_onFocusObject carries Header — this is how the stock code
           recognizes it too, controller/HeaderFooterTab.js), above the bottom row
           hangs a hint on how to return to the document, and two buttons: the header/footer
           options window and the deletion of this header/footer. The engine itself exits the
           header/footer — on Escape or a double click on the text. */
        buildHeaderHint: function () {
            var me = this;
            if (this.$hfHint) return this.$hfHint;
            var actions = function () { return DE.Views.DocumentActions; };
            var button = function (cls, text, fn) {
                return $('<button type="button" class="vo-hf-btn"></button>').addClass(cls).text(text)
                    .on('mousedown', function (e) { e.preventDefault(); })
                    .on('click', guarded('подсказка колонтитула', function (e) {
                        e.preventDefault();
                        var props = me.headerProps();
                        if (props && !$(this).hasClass('vo-locked')) fn(props);
                    }));
            };
            this.$hfHint = $('<div id="vo-hf-hint"></div>')
                .append($('<span class="vo-hf-text"></span>').text(this.textHeaderHint))
                .append(button('vo-hf-settings', this.textHeaderSettings,
                    function (props) { actions().headerFooterSettings(props); }))
                .append(button('vo-hf-remove', this.textHeaderRemove,
                    function (props) { actions().removeHeaderFooter(props); }));
            $('body').append(this.$hfHint);
            this.syncHeaderHint();
            return this.$hfHint;
        },

        /* The header/footer properties from the last asc_onFocusObject or null. */
        headerProps: function () {
            var T = window.Asc && Asc.c_oAscTypeSelectElement;
            var list = this.lastFocusObjects || [];
            if (!T) return null;
            for (var i = 0; i < list.length; i++) {
                var el = list[i];
                if (el && el.get_ObjectType && el.get_ObjectType() === T.Header)
                    return (el.get_ObjectValue && el.get_ObjectValue()) || null;
            }
            return null;
        },

        syncHeaderHint: function () {
            if (!this.$hfHint) return;
            var props = this.headerProps();
            this.$hfHint.toggleClass('open', !!props);
            /* For a footer the hint is placed at the top: it does not cover its text. */
            var da = DE.Views.DocumentActions;
            this.$hfHint.toggleClass('vo-hf-footer', !!props && !!(da && da.isFooter && da.isFooter(props)));
            if (!props) return;
            /* The header/footer is edited by a co-author or editing is closed — the buttons are disabled,
               the exit hint stays. */
            var locked = this.editingLocked() || !!(props.get_Locked && props.get_Locked());
            this.$hfHint.find('.vo-hf-btn').toggleClass('vo-locked', locked)
                .attr('aria-disabled', locked ? 'true' : 'false');
            /* While change tracking is on, deletion is disabled by itself, with
               the reason in the hint: the engine does not record it as a tracked change
               (DocumentActions.removeHeaderFooterLocked). */
            var tracking = !locked && !!(da && da.removeHeaderFooterLocked && da.removeHeaderFooterLocked());
            var $remove = this.$hfHint.find('.vo-hf-remove');
            if (tracking) $remove.addClass('vo-locked').attr('aria-disabled', 'true');
            if (tracking && typeof da.textReasonTracking === 'string') $remove.attr('title', da.textReasonTracking);
            else $remove.removeAttr('title');
        },

        /* state: {hidden, cause, tbHidden}. Body classes: vo-top-scroll — the top
           went away on scroll, vo-top-away — the top rows are shifted up,
           vo-top-hidden — they are out of the layout (moveTop). The chevron (ctrl.focus)
           is rotated and pressed while the top is hidden. */
        setChrome: function (state) {
            var hidden = !!state.hidden;
            this.top = {hidden: hidden, cause: hidden ? (state.cause === 'scroll' ? 'scroll' : 'manual') : null};
            this.focus = this.top.cause === 'manual';
            this.tbHidden = !!state.tbHidden;
            var body = document.body.classList;
            body.toggle('vo-top-scroll', this.top.cause === 'scroll');
            body.toggle('vo-tb-hidden', this.tbHidden);
            var ctrl = (this.tb && this.tb.ctrl) || {};
            ctrl.focus && ctrl.focus.toggleClass('on', hidden).attr('aria-pressed', hidden ? 'true' : 'false');
            ctrl.collapse && ctrl.collapse.toggleClass('on', this.tbHidden);
            this.skipTopScroll();
            /* We take the height by the current mode, and not by the fact that the call came
               from the compact chrome. There used to be a hard applyLayout(true) here, and the
               only path that reached here in Advanced gave the stock
               ribbon shellHeight() instead of the saved base, and the status bar —
               H_STATUS: the interface was squeezed to the compact geometry and was fixed
               only by returning to the compact view. Now in Advanced we
               do not touch the layout at all — the modes are mutually exclusive; the full
               analysis of who may call applyLayout is at applyShellLayout.
               This is the second end of the rule; the first is the gate in bindChromeEscape.
               Both must be held, as in SlashMenu (bind and show): the gate closes
               the path, this one — the action itself, for any future call.
               The layout is called by moveTop: when the top goes away — after the rows shift. */
            this.moveTop(hidden);
        },

        /* --- Going away and returning of the top rows -------------------------------------- */
        /* The header and the menu row go away and return by a shift over @vo-dur-state
           (compact-shell.less, vo-top-away). The layout and the engine recalculation are
           once per switch, not per frame: going away — first the shift, then the
           layout gives the rows' room to the document; returning — first the layout
           returns the room, then the rows slide into it. Without a transition (the system
           asks for less motion, Advanced) — the same at once.
           Hidden rows are inaccessible to the keyboard and the screen reader
           (inert, then display: none); focus that was in them goes to
           the document by the stock path, as from the toolbar row. */
        moveTop: function (hidden) {
            var me = this, body = document.body.classList;
            var rows = this.topRows();
            clearTimeout(this.topTimer);
            this.topTimer = null;
            if (hidden) {
                var focused = document.activeElement;
                var inside = rows.some(function (row) { return row.contains(focused); });
                rows.forEach(function (row) { row.setAttribute('inert', ''); });
                if (inside) this.focusDocument();
            } else {
                rows.forEach(function (row) { row.removeAttribute('inert'); });
            }

            var out = this.topOut();
            if (hidden && !out) {
                body.add('vo-top-away');
                var settle = guarded('оболочка: уход верха', function () {
                    me.topTimer = null;
                    document.body.classList.add('vo-top-hidden');
                    me.applyShellLayout();
                });
                var wait = this.topDuration(rows);
                if (wait > 0) this.topTimer = setTimeout(settle, wait);
                else settle();
                return;
            }
            if (!hidden && out) {
                body.remove('vo-top-hidden');
                this.applyShellLayout();
                /* The rows are in the layout again, still shifted up: read
                   the geometry so that removing the shift becomes a transition. */
                if (rows[0]) void rows[0].offsetHeight;
            }
            else this.applyShellLayout();
            if (!hidden) body.remove('vo-top-away');
        },

        /* The header and the menu row of the shell. */
        topRows: function () {
            return $('#' + SHELL_ID).children('.vo-hd, .vo-mn').toArray();
        },

        /* The duration of the rows shift, ms, by their styles: 0 — no transition
           (prefers-reduced-motion, Advanced, a page without styles). */
        topDuration: function (rows) {
            var row = rows && rows[0];
            if (!row || this.advanced || !window.getComputedStyle) return 0;
            var style = getComputedStyle(row);
            var names = String(style.transitionProperty || '').split(',');
            var times = String(style.transitionDuration || '').split(',');
            var delays = String(style.transitionDelay || '').split(',');
            for (var i = 0; i < names.length; i++) {
                var name = names[i].trim();
                if (name !== 'transform' && name !== 'all') continue;
                var sec = function (list) {
                    var v = (list[i % list.length] || '').trim();
                    var n = parseFloat(v) || 0;
                    return /ms$/.test(v) ? n : n * 1000;
                };
                return Math.max(0, sec(times) + sec(delays));
            }
            return 0;
        },

        /* The keyboard goes to the document: edit:complete calls DocumentHolder.focus(). */
        focusDocument: function () {
            var focused = document.activeElement;
            if (focused && focused !== document.body && typeof focused.blur === 'function') focused.blur();
            if (window.Common && Common.NotificationCenter) Common.NotificationCenter.trigger('edit:complete');
        },

        /* --- The top going away on scroll ---------------------------------------- */
        /* The rule is CompactTopScroll, the position on every frame is given by the poll of the
           engine that drives the scrollbar (OutlineRail.bindScrollbars):
           there is no second loop. The signal is a change of position, not a gesture: the wheel,
           the keyboard and following the caret all count equally as scrolling.
           The rule skips the document's own shift: after a change of rows,
           zoom, mode, rulers and window size the first position is only a
           reference point. Otherwise the engine, clamping the position near the end of the document to
           the grown area, would bring back the top that went away, and it would flicker. */
        bindTopScroll: function () {
            var me = this, api = this.api;
            if (this.topRule || !DE.Views.CompactTopScroll) return;
            this.topRule = DE.Views.CompactTopScroll.create({threshold: H_HEADER + H_MENU});
            var skip = function () { me.skipTopScroll(); };
            $(window).on('resize', skip);
            Common.NotificationCenter.on('doc:mode-changed', skip);
            if (api && api.asc_registerCallback) {
                try { api.asc_registerCallback('asc_onZoomChange', skip); } catch (e) { /* without zoom */ }
            }
        },

        skipTopScroll: function () {
            if (this.topRule) this.topRule.skip();
        },

        /* The position and limit of the engine's vertical scroll, px, on every
           frame. If unchanged — the rule has nothing to compute. The answer "hide"
           takes away an open top; "show" returns one that went away by scrolling, while
           one collapsed manually — only in "Viewing" and only by scrolling up
           by the threshold: there is no chevron there, and the start of the document does not
           cancel a manual choice. */
        onDocScroll: function (pos, max) {
            var rule = this.topRule;
            if (!rule || this.advanced || this.startupFailed) return;
            var seen = this.topScrollAt;
            if (seen && seen.pos === pos && seen.max === max && !rule.state().skipping) return;
            this.topScrollAt = {pos: pos, max: max};
            var answer = rule.feed(pos, max, this.topBusy());
            if (!answer) return;
            var top = this.top || {};
            if (answer.act === 'hide') {
                if (!top.hidden) this.hideTop('scroll');
                return;
            }
            if (!top.hidden) return;
            if (top.cause === 'scroll' || (this.docMode === 'view' && answer.why === 'path')) this.showTop();
        },

        /* We do not touch the top now: a list or submenu of the menu bar is open, "…",
           "/", a popover or a panel list, the document context menu (the stock
           menu, as with Escape), a window, the search bar (a window without a mask) or the left
           search panel; the keyboard is in the header or menu bar; in the menu bar
           an answer to an edit request is awaited or shown, or the paste
           hint (it disappears by itself after 5 seconds). A jump to the
           match below moves the document like scrolling: without this the top
           would go away, and the search bar would rise from under the cursor. */
        topBusy: function () {
            if (this.menu && this.menu.isOpen && this.menu.isOpen()) return true;
            if (this.hasOpenSurfaces()) return true;
            var slash = DE.Views.SlashMenu;
            if (slash && slash.open) return true;
            if (anyVisible(TOP_BUSY_SELECTOR)) return true;
            if (this.openLeftPanel() === 'search') return true;
            if (this.keyboardInTop()) return true;
            var da = DE.Views.DocumentActions;
            return !!(da && (da.requestStatus || da.pasteHintText));
        },

        /* The keyboard in the header or menu bar: focus is there and visible (Tab, F10,
           the name field). A section button that stayed focused after a mouse
           click is not the keyboard: otherwise after closing the menu with a click the top
           would not go away until you click in the document. */
        keyboardInTop: function () {
            var focused = document.activeElement;
            if (!focused || focused === document.body) return false;
            if (!$(focused).closest('#' + SHELL_ID + ' > .vo-hd, #' + SHELL_ID + ' > .vo-mn').length) return false;
            try { return focused.matches(':focus-visible'); } catch (e) { return true; }
        },

        /* F10 with a top that went away by scrolling: return it and enter the menu
           bar. A top collapsed manually is not touched by F10: the bar is hidden, and
           the key stays with the editor (its own handler in MenuBar
           skips a hidden bar). */
        onTopKey: function (e) {
            if (!e || e.key !== 'F10' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
            if (this.advanced || this.startupFailed || e.defaultPrevented) return;
            if (!this.top || this.top.cause !== 'scroll' || !this.menu || !this.menu.enter) return;
            var adapter = this.menuAdapter;
            if (adapter && typeof adapter.blocked === 'function' && adapter.blocked()) return;
            this.showTop();
            if (!this.menu.enter()) return;
            e.preventDefault();
            e.stopPropagation();
        },

        /* Whether at least one popup surface of the shell is open. The set is exactly
           the one closed by closeSurfaces(): menu bar dropdowns, the
           "•••" row, panel and mode popovers, the link window. It is necessary to ask
           exactly about this set — otherwise Escape would either go to return the chrome
           from under an open menu, or eat the key without closing anything. */
        hasOpenSurfaces: function () {
            if ($('.vo-mn-drop.open').length) return true;
            var tb = this.tb;
            if (tb && tb.el && tb.el.hasClass('vo-of-open')) return true;
            /* The link window is attached to body and does not get into the panel wrappers —
               we count it separately, as closePopovers() does. */
            return !!$('.vo-pop-wrap.open, .vo-cb.open, #vo-link.open').length;
        },

        /* --- The stock modal window ---------------------------------------- */
        /* An open window and the loading mask must cover our
           surfaces. The levels are aligned with the stock scale (compact-shell.less,
           @vo-z-drop/@vo-z-float), but geometry alone is not enough: the menu bar,
           "•••" and the panel popovers stay OPEN under the dimming, and
           the dimming does not close them — the stock code has exactly for this the notification
           modal:show (common/main/lib/component/Window.js:822), and it is listened to
           by those who have something to close (controller/DocumentHolder.js:176).
           The bubble is closed by its own subscription — it lives in SelectionBubble
           together with the other reasons for hiding it. */

        bindModalGuard: function () {
            var me = this;
            Common.NotificationCenter.on('modal:show', guarded('оболочка: modal:show', function () {
                me.closeSurfaces();
                var slash = DE.Views.SlashMenu;
                if (slash && slash.open && slash.hide) slash.hide();
            }));
        },

        /* --- Escape ------------------------------------------------------------ */
        /* One handler for the whole shell, on window in the capture phase: so it
           sees the key before the engine, whose handler does not stop bubbling
           (sdkjs word/Drawing/HtmlPage.js), and manages to read whether the
           engine has a layer of its own. One press — one action, from top to bottom:
           window → "/" → submenu → section → panel surfaces → bubble →
           left search panel → engine layer → return of the hidden top.
           We do not close the window, "/" and the menu bar ourselves: each has its own exit.
           The menu bar listens to window earlier than us and, having removed a layer, suppresses the default
           action — hence the defaultPrevented check; "/" listens later,
           so with "/" open we simply yield.
           An engine layer — format painter, shape insertion, a selected object,
           a form field, a header/footer: it is removed by the engine itself with the same key
           (word/Editor/Document.js, the Esc branch), so we do not touch the key and
           do not call asc_CancelHdrFtrEditing. The top will return already by the next
           Escape.
           Escape returns the top for any reason — whether it is collapsed manually
           or went away on scroll. Escape does not expand the toolbar
           row: it is shown only by "View → Toolbar".
           An input field with its own Escape (the document title, font size, comment)
           receives the key itself: the bubble, the search bar and the hidden top we
           do not touch in it. Otherwise the field would not return its previous value, and
           losing focus would apply what was typed. */
        bindChromeEscape: function () {
            var me = this;
            window.addEventListener('keydown', guarded('оболочка: Escape', function (e) {
                me.onEscape(e);
                me.onTopKey(e);
            }), true);
        },

        onEscape: function (e) {
            if (!e || (e.key !== 'Escape' && e.keyCode !== 27)) return;
            /* The compact keyboard in Advanced is silent, like "/" in SlashMenu.bind():
               the modes are mutually exclusive, and the collapsed chrome survives the move there. */
            if (this.advanced || this.startupFailed || e.defaultPrevented) return;
            var me = this;
            var stop = function () {
                e.preventDefault();
                e.stopPropagation();
            };

            /* Esc over an open window is the window's business: it listens on its own node. The same
               goes for the stock menu (the document context menu, Common.UI.Menu):
               it is closed by its own Bootstrap key handler. */
            if ($('.asc-window.modal:visible, .open > .dropdown-menu:visible').length) return;
            var slash = DE.Views.SlashMenu;
            if (slash && slash.open) return;

            if (this.menu && this.menu.isOpen && this.menu.isOpen()) {
                this.menu.close();
                stop();
                return;
            }

            if (this.hasOpenSurfaces()) {
                /* Focus is inside our chrome or popover: lists, buttons with
                   a menu and the link window have their own Escape, it closes the layer and
                   returns focus to the button. We let it work and close ourselves
                   only if the layer stayed open, on bubbling. */
                var t = e.target;
                if (t && t.nodeType === 1 && $(t).closest('#' + SHELL_ID + ', .vo-pop-wrap, .vo-cb, #vo-link').length) {
                    var after = function () {
                        window.removeEventListener('keydown', after, false);
                        if (me.hasOpenSurfaces()) me.closeSurfaces();
                    };
                    window.addEventListener('keydown', after, false);
                    setTimeout(function () { window.removeEventListener('keydown', after, false); }, 0);
                    return;
                }
                this.closeSurfaces();
                stop();
                return;
            }

            if (this.ownEscapeField(e.target)) return;

            /* The bubble at the selection: closing is not enough, it must not pop up
               again on the same selection — this is known by SelectionBubble.dismiss. */
            var bubble = DE.Views.SelectionBubble;
            if (bubble && bubble.isOpen && bubble.isOpen()) {
                bubble.dismiss();
                stop();
                return;
            }

            if (this.openLeftPanel() === 'search') {
                this.toggleLeftPanel('search');
                stop();
                return;
            }

            if (this.engineLayer()) return;

            this.showTop();
        },

        /* A text input field with its own Escape. Not counted: the engine input field
           (typing in the document goes through it) and the search panel fields — Escape
           in them closes the panel itself. */
        ownEscapeField: function (t) {
            if (!t || t.nodeType !== 1) return false;
            if (t.id === 'area_id' || $(t).closest('#left-panel-search').length) return false;
            if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
            return t.tagName === 'INPUT' &&
                !/^(button|checkbox|radio|submit|reset|image|file|range|color|hidden)$/i.test(t.type || '');
        },

        /* Whether the engine has a layer that it removes itself on Escape. The signs
           are read from the engine: the api flags and the last asc_onFocusObject. */
        engineLayer: function () {
            var api = this.api;
            if (!api) return false;
            var on = function (name) {
                try { return typeof api[name] === 'function' && !!api[name](); } catch (err) { return false; }
            };
            /* The engine flags are api fields (isStartAddShape and others), the tool
               states are methods. */
            if (on('isFormatPainterOn') || api.isStartAddShape === true || api.isMarkerFormat === true ||
                api.isDrawTablePen === true || api.isDrawTableErase === true || on('isInkDrawerOn') ||
                on('isEyedropperStarted'))
                return true;

            var T = window.Asc && Asc.c_oAscTypeSelectElement;
            var list = this.lastFocusObjects || [];
            if (!T) return false;
            for (var i = 0; i < list.length; i++) {
                var type = list[i] && list[i].get_ObjectType && list[i].get_ObjectType();
                if (type === T.Header || type === T.Image || type === T.Shape || type === T.Chart) return true;
                /* The engine releases a form field on Escape only in filling mode. */
                if (type === T.ContentControl) {
                    var lock = this.lockState();
                    if (lock.on && lock.options && lock.options.fillFormMode) return true;
                }
            }
            return false;
        },

        /* --- Texts ------------------------------------------------------------ */
        /* Defaults are English: the locale overrides them with a translation from
           `locale/<language>.json`, and the editor has 44 languages without
           a translation — this is what is shown there. The wording is checked against the stock one, where
           such a phrase already exists in the editor. */

        textCompact: 'Compact view',
        textDocument: 'Document',
        textEdit: 'Edit',
        textFitPage: 'Fit page',
        textFitWidth: 'Fit width',
        textHeaderHint: 'Press Esc or double-click the text to return to the document',
        textHeaderRemove: 'Remove header or footer',
        textHeaderSettings: 'Settings',
        textModeEdit: 'Editing',
        textModeEditHint: 'Changes are applied immediately',
        textModeReview: 'Reviewing',
        textModeReviewHint: 'Changes are suggestions',
        textModeView: 'Viewing',
        textModeViewHint: 'The document is open for reading',
        textPageIndex: 'Page {0} of {1}',
        textSaved: 'Saved',
        textSaving: 'Saving…',
        textSpelling: 'Spelling',
        textUnsaved: 'Unsaved',
        textWordsCount: 'Words: {0}',
        tipBackToCompact: 'Back to the new interface',
        tipComments: 'Comments',
        tipHistory: 'Version history',
        tipRename: 'Document name — can be edited',
        tipRenameDisabled: 'Document name (renaming unavailable)',
        tipSharing: 'Sharing settings'

    }, DE.Views.CompactShell || {});

    /* The tables with captions are assembled here, not in an object literal: inside
       it there is no way to refer to its own texts, and by this line the locale is
       already laid out (Common.Locale.apply is called before the controllers are loaded,
       documenteditor/main/app.js:174) and _.extend above has already let it in. */
    DE.Views.CompactShell.SAVE_STATE = {
        saved:  {t: DE.Views.CompactShell.textSaved},
        saving: {t: DE.Views.CompactShell.textSaving},
        dirty:  {t: DE.Views.CompactShell.textUnsaved}
    };

    DE.Views.CompactShell.MODES = [
        {v: 'edit',   t: DE.Views.CompactShell.textModeEdit,
                      d: DE.Views.CompactShell.textModeEditHint,   i: 'rename'},
        {v: 'review', t: DE.Views.CompactShell.textModeReview,
                      d: DE.Views.CompactShell.textModeReviewHint, i: 'accept'},
        {v: 'view',   t: DE.Views.CompactShell.textModeView,
                      d: DE.Views.CompactShell.textModeViewHint,   i: 'panel'}
    ];

    /* Shared controllers (ReviewChanges) ask the shared-layer registry about the selected shell,
       not Documents. Whether the shell is selected — wanted; the personal review mode
       in it follows the shared document flag; the reason for the disabled "turn off for myself" —
       forAllText. The shell is read at the moment of the question. */
    var shells = window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.Shells;
    if (shells && typeof shells.register === 'function') {
        shells.register({
            wanted: function (config) { return DE.Views.CompactShell.wanted(config); },
            personalReviewFollowsShared: true,
            forAllText: function () { return DE.Views.CompactShell.forAllText(); }
        });
    }

    return DE.Views.CompactShell;
});
