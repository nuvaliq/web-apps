/*
 * CompactShell — the Compact shell of the PDF viewer.
 * Part of the web-apps fork, AGPL-3.0.
 *
 *     #vo-toolbar (4 + 44 + 8) — the only bar
 *
 * This is the frame: the enabling condition, early start and rollback to the stock editor,
 * the shell row, the command registry, holding the viewing mode, the name, the access
 * button, the "⋮" menu, the Esc queue, the left menu panels and the File screen. The bar is
 * drawn by CompactToolbar (the frame gives it the name, the access button and the menu), the
 * "⋮" menu — by the shared menu bar (Common.UI.Compact.MenuBar) as one section over the
 * PdfActions catalog adapter, windows — by the shared window layer (PDFE.Views.CompactWindows
 * on Common.UI.Compact.Windows), the "Navigation" panel — by NavigationPanel.
 *
 * The shell has no File screen: the stock paths to it lead to windows over the
 * document (FileWindows) or nowhere — see the "File screen" section below.
 *
 * The stock ribbon, title and status bar are not removed: the styles hide them under
 * body.vo-compact.
 *
 * The shell has no left icon column. The left menu itself is alive: inside it are the
 * stock comments and advanced search panels (and the thumbnails and bookmarks ones, if the
 * stock code opens them). It is hidden while none of them is open — opening one sets
 * the vo-left-open class. The "Navigation" panel lies over the document field and
 * takes no room in the layout.
 *
 * The background around the pages is painted by the engine with a color from a theme CSS
 * variable; the shell hands it the color of its own field (applyCanvasSkin), so that the
 * bar, the panel and the canvas are one background.
 */
define([
    'common/main/lib/view/compact/Icons',
    'common/main/lib/view/compact/Shells',
    'common/main/lib/view/compact/MenuBar',
    'pdfeditor/main/app/view/CompactWindows',
    'pdfeditor/main/app/view/StockBridge',
    'pdfeditor/main/app/view/FileWindows',
    'pdfeditor/main/app/view/PdfActions',
    'pdfeditor/main/app/view/CompactMenuAdapter',
    'pdfeditor/main/app/view/NavigationPanel',
    'pdfeditor/main/app/view/CompactToolbar'
], function () {
    'use strict';

    if (window.PDFE === undefined) window.PDFE = {};
    if (PDFE.Views === undefined) PDFE.Views = {};

    var SHELL_ID = 'vo-shell';

    /* The early-start request class and the retry loop — as in documents and
       presentations: the request is set on Gateway init and hides the stock chrome until
       the build, 20 build attempts 150 ms apart. */
    var BOOT_CLASS = 'vo-boot';

    /* The loading skeleton (index.html, #loading-mask) during the request: a different id, so
       that the stock code does not remove it. */
    var COVER_ID = 'vo-loading';
    var START_TRIES = 20, START_STEP = 150;

    /* Bar height — the panel card 44 with a gap of 4 above and 8 below, paired with
       @vo-tb-gap-top, @vo-h-toolbar and @vo-tb-gap in compact-shell.less; change
       them in pairs. The viewer engine cannot shift the page under the card,
       so the card with its gaps takes room in the layout. The shell has no
       status bar. */
    var H_TOOLBAR = 44;
    var H_TB_GAP_TOP = 4;
    var H_TB_GAP = 8;

    /* Left menu panels the shell shows: our name → the stock left menu
       button. The panels are stock — we do not move their DOM, we press the stock
       button, and its controller shows the panel and sets the area width.
       The shell does not open thumbnails and bookmarks itself (it has its own
       "Navigation" panel), but when the stock code opens them they get room, as in the
       stock editor; advanced search is opened not by our button but by stock paths
       (the search bar, keyboard shortcuts) — the shell only has to give it room. */
    var LEFT_PANELS = {
        thumbnails: 'btnThumbnails',
        navigation: 'btnNavigation',
        comments:   'btnComments',
        search:     'btnSearchBar'
    };
    /* Panels the shell does not have: chat. One opened bypassing the shell is closed. */
    var LEFT_OFF = ['btnChat'];

    /* Showing the File screen of the left menu view: 'file' or 'file:<panel>'. */
    var FILE_SCREEN = /^file(:|$)/;

    /* The engine input field (the stock controllers recognize it the same way — by id). */
    var ENGINE_INPUT = /area_id/;
    /* An open stock menu (Common.UI.Menu: the open class on the parent). */
    var STOCK_MENU_OPEN = '.open > .dropdown-menu';

    /* Characters not allowed in a file name — the set of the stock title. */
    var BAD_NAME = /[\t*+:"<>?|\\/]/;

    /* NotificationCenter is Backbone.Events: an exception from one handler
       breaks the whole trigger, including the stock subscribers after us. So
       everything the editor calls from outside goes through this wrapper; after a
       startup rollback it is silent. A repeated failure at the same place is not logged. */
    var warned = {};

    function guarded(label, fn) {
        return function () {
            if (PDFE.Views.CompactShell && PDFE.Views.CompactShell.startupFailed) return;
            try {
                return fn.apply(this, arguments);
            } catch (e) {
                if (!warned[label]) {
                    warned[label] = true;
                    if (window.console && console.warn)
                        console.warn('Compact shell: "' + label + '" failed, the editor goes on without it.',
                            e);
                }
            }
        };
    }

    function byId(id) { return document.getElementById(id); }

    function node(tag, id, cls) {
        var e = document.createElement(tag);
        id && e.setAttribute('id', id);
        cls && e.setAttribute('class', cls);
        return e;
    }

    function el(tag, cls, attrs) {
        var e = node(tag, null, cls);
        _.each(attrs || {}, function (v, k) { e.setAttribute(k, v); });
        return e;
    }

    function prepend(host, e) {
        host.insertBefore(e, host.firstChild || null);
    }

    function bodyClasses() {
        return String(document.body.className || '').split(/\s+/).filter(function (c) { return c.indexOf('vo-') === 0; });
    }

    function controller(name) {
        try { return window.PDFE && PDFE.getController ? PDFE.getController(name) : null; } catch (e) { return null; }
    }

    /* AIR icon of the shared set. An icon is not a reason to roll the shell back: without it
       the button stays with its tooltip. */
    function icon(name, size) {
        var C = window.Common && Common.UI && Common.UI.Compact, I = C && C.Icons;
        try { return I && typeof I.svg === 'function' ? I.svg(name, size) : ''; } catch (e) { return ''; }
    }

    function actions() { return PDFE.Views.PdfActions; }
    function fileWindows() { return PDFE.Views.FileWindows; }

    /* Snapshot of the theme colors (the stock getThemeColors); without a theme — null. */
    function themeColors() {
        var T = window.Common && Common.UI && Common.UI.Themes;
        try { return T && typeof T.getThemeColors === 'function' ? T.getThemeColors() || null : null; } catch (e) { return null; }
    }

    PDFE.Views.CompactShell = _.extend({

        guarded: guarded,
        H_TOOLBAR: H_TOOLBAR,
        H_TB_GAP_TOP: H_TB_GAP_TOP,
        H_TB_GAP: H_TB_GAP,

        /* The enabling condition is strictly `editorConfig.ui.shell === 'modern'`, as in
           documents and presentations: case, spaces and foreign values leave the
           stock editor, a read failure and a startup rollback do too. config — the config from
           Gateway init (Main has not laid it out yet); without an argument the
           editorConfig of the stock controller is read. */
        wanted: function (config) {
            try {
                if (this.startupFailed) return false;
                var cfg = config;
                if (cfg === undefined) {
                    var main = controller('Main');
                    cfg = main && main.editorConfig;
                }
                return !!cfg && !!cfg.ui && cfg.ui.shell === 'modern';
            } catch (e) {
                return false;
            }
        },

        /* Engine callback under the same protection. */
        onApi: function (name, fn) {
            var api = this.engineApi();
            if (api && api.asc_registerCallback) api.asc_registerCallback(name, guarded('api: ' + name, fn));
        },

        engineApi: function () {
            if (this.api) return this.api;
            var main = controller('Main');
            if (main && main.api) return main.api;
            var vp = controller('Viewport');
            return vp && (vp.api || (vp.getApi && vp.getApi())) || null;
        },

        stockOptions: function () {
            var main = controller('Main');
            return (main && main.appOptions) || {};
        },

        /* --- Early start ------------------------------------------------------- */
        /* The stock editor removes the loading mask already on app:face, while the shell
           is built on app:ready. So that the stock ribbon and title do not flash, on
           Gateway init the request class vo-boot is set, and on app:face the areas get
           the shell heights. The loading skeleton is kept until the build, see announce. */
        boot: null,
        booted: false,

        announce: function (config) {
            if (this.booted || byId(SHELL_ID) || !this.wanted(config)) return;
            var me = this;
            this.booted = true;
            this.boot = {heights: null};
            document.body.classList.add(BOOT_CLASS);
            /* The loading skeleton stays until the shell is built. The stock code removes
               it by id on app:face, before the document is loaded, and would then show
               the canvas in the colours of the interface theme and its own "Loading
               document" plate. Under a different id the skeleton stays, and endBoot
               removes it together with the request: when the shell is built this is the
               same frame, on a failure the stock interface returns, on an engine error
               see below. The stock password window lies above the skeleton by z-index,
               and loading goes on after it. */
            var mask = byId('loading-mask');
            if (mask) mask.id = COVER_ID;
            /* An engine error before the shell is built removes the skeleton and the
               request at once. The stock code removes its own mask on it (Main.onError →
               hidePreloader) and opens the error window, while app:ready never comes
               after an opening error: nothing would call endBoot, and the loading band
               would keep running under the window and after OK. Under the window the
               stock interface belongs, as in the stock editor. An error after which
               loading still reaches app:ready gets the shell from the regular start,
               as without the early start. The stock onError is registered earlier
               (Main.onLaunch) and the engine calls its callbacks in order, so the stock
               window is already open by our call. guarded, because an exception here
               would cut off the remaining error callbacks. */
            var api = this.engineApi();
            if (api && api.asc_registerCallback)
                api.asc_registerCallback('asc_onError', guarded('shell: error before the build', function () {
                    if (me.boot) me.endBoot(true);
                }));
            /* The subscription is later than the stock one: by our call the stock code has
               already laid out the areas by its flags. */
            Common.NotificationCenter.on('app:face', guarded('shell: boot frame', function () {
                me.bootLayout();
            }));
        },

        /* Frame heights. The stock ones are remembered nearby: endBoot returns them before
           the snapshot, otherwise the stock layout would get the frame heights. */
        bootLayout: function () {
            var b = this.boot;
            if (!b || b.heights) return;
            var vp = controller('Viewport');
            var view = vp && vp.viewport;
            if (!view || !view.vlayout) return;
            var v = view.vlayout;
            var shellH = this.layoutHeight();
            b.heights = [];
            [[v.getItem('toolbar'), shellH], [v.getItem('statusbar'), 0]].forEach(function (p) {
                var panel = p[0];
                if (!panel) return;
                b.heights.push({panel: panel, stock: panel.height, ours: p[1]});
                panel.height = p[1];
                panel.el && panel.el.css && panel.el.css('height', p[1] + 'px');
            });
            this.relayout(view, vp);
        },

        relayout: function (view, vp) {
            view.vlayout && view.vlayout.doLayout();
            view.hlayout && view.hlayout.doLayout();
            if (typeof $ === 'function') $(window).trigger('resize');
            var api = this.api || (vp && vp.api);
            if (api && api.Resize) api.Resize();
        },

        /* Remove the request. The height is returned only if it is still ours.
           relayout = false — the frame handover from create(). */
        endBoot: function (relayout) {
            var b = this.boot;
            if (!b) return;
            this.boot = null;
            document.body.classList.remove(BOOT_CLASS);
            var cover = byId(COVER_ID);
            if (cover && cover.parentNode) cover.parentNode.removeChild(cover);
            (b.heights || []).forEach(function (x) {
                if (x.panel.height !== x.ours) return;
                x.panel.height = x.stock;
                if (relayout && x.panel.el && x.panel.el.css) x.panel.el.css('height', x.stock + 'px');
            });
            if (relayout) this.stockRelayout();
        },

        stockRelayout: function () {
            var vp = controller('Viewport');
            var view = vp && vp.viewport;
            if (view) this.relayout(view, vp);
        },

        /* Startup on app:ready (controller/Viewport.js). The retry is for an editor that
           is not ready yet: create() then exits silently. A failure is not retried:
           an exception from create() breaks the attempts. An attempt after which there is
           neither a shell nor a next attempt returns the stock layout. */
        start: function () {
            var me = this, tries = 0;
            var attempt = guarded('shell: start', function () {
                var again = false;
                try {
                    me.create();
                    if (byId(SHELL_ID)) return;
                    if (++tries < START_TRIES) {
                        again = true;
                        setTimeout(attempt, START_STEP);
                    }
                } finally {
                    if (!again && !byId(SHELL_ID)) {
                        if (me.boot) me.endBoot(true);
                        else if (!me.startupFailed) me.stockRelayout();
                    }
                }
            });
            guarded('shell: start gate', function () {
                if (!me.wanted()) { me.endBoot(true); return; }
                attempt();
            })();
        },

        api: null,
        advanced: false,     // always false: the shared window layer and NavigationPanel read it
        startupFailed: false,
        base: null,          // stock area heights at the moment the shell took them
        ours: false,         // the area heights are ours now
        commands: null,      // command name → its executor
        menu: null,          // the "⋮" menu (the shared menu bar as one section)
        bound: false,        // the frame subscriptions are set up (once per session)

        /* ------------------------------------------------------------------ */

        create: function () {
            if (this.startupFailed || byId(SHELL_ID)) return this;

            var toolbar = byId('toolbar');
            if (!toolbar) return this;
            var api = this.engineApi();
            var main = controller('Main');
            if (!api || !main || !main.appOptions) return this;

            this.endBoot(false);
            var stock = this.snapshotStock();
            try {
                this.api = api;

                var shell = node('div', SHELL_ID);
                shell.appendChild(node('div', 'vo-toolbar', 'vo-row'));
                prepend(toolbar, shell);

                document.body.classList.add('vo-compact');
                PDFE.Views.CompactWindows.install(this);
                this.command('leftPanel', _.bind(this.toggleLeftPanel, this));
                this.command('navigation', _.bind(this.toggleNavigation, this));
                if (this.canRename()) this.command('rename', _.bind(this.focusTitle, this));

                var acts = actions();
                if (acts && typeof acts.init === 'function') acts.init(this, api);
                this.bindFileScreen();
                this.bar = {collab: {}};
                PDFE.Views.CompactToolbar.install(this);
                this.bar.root = byId('vo-tb');
                this.bindStock();
                this.bindBar();
                PDFE.Views.NavigationPanel.create(this, api);
                this.syncLeftState();
                this.applyLayout(true);
                this.applyCanvasSkin();
                this.holdView();
            } catch (e) {
                /* A failure is terminal for the session: a retry does not build the shell on top of
                   a partial one. The original error is handed to the outer guarded. */
                try { this.rollbackStartup(stock); } finally { throw e; }
            }
            return this;
        },

        /* Snapshot of the layout, nodes and classes before the build — for rollback. */
        snapshotStock: function () {
            var vp = controller('Viewport');
            var view = vp && vp.viewport;
            var v = view && view.vlayout;
            var list = document.querySelectorAll ? document.querySelectorAll('[id^="vo-"]') : [];
            return {
                view: view,
                heights: v && v.panels ? _.map(v.panels, function (p) { return {panel: p, height: p.height}; }) : [],
                nodes: Array.prototype.slice.call(list),
                classes: bodyClasses(),
                skin: themeColors()
            };
        },

        rollbackStartup: function (stock) {
            var me = this;
            this.startupFailed = true;
            this.ours = false;
            var restore = function (fn) {
                try { fn(); } catch (e) {
                    if (window.console && console.warn) console.warn('Compact shell: rollback step failed.', e);
                }
            };
            restore(function () { if (me.menu) { me.menu.destroy(); me.menu = null; } });
            restore(function () { PDFE.Views.CompactToolbar.unbind(); });
            restore(function () { PDFE.Views.NavigationPanel.destroy(); });
            restore(function () { PDFE.Views.CompactWindows.unbind(); });
            restore(function () { me.unbindFileScreen(); });
            restore(function () {
                clearTimeout(me.skinTimer);
                var api = me.engineApi();
                if (stock.skin && api && typeof api.asc_setSkin === 'function') api.asc_setSkin(stock.skin);
            });
            restore(function () {
                var list = document.querySelectorAll ? document.querySelectorAll('[id^="vo-"]') : [];
                Array.prototype.forEach.call(list, function (n) {
                    if (stock.nodes.indexOf(n) < 0 && n.parentNode) n.parentNode.removeChild(n);
                });
                bodyClasses().forEach(function (c) {
                    if (stock.classes.indexOf(c) < 0) document.body.classList.remove(c);
                });
            });
            restore(function () {
                stock.heights.forEach(function (item) {
                    item.panel.height = item.height;
                    if (item.height != null && item.panel.el && item.panel.el.css) item.panel.el.css('height', item.height + 'px');
                });
            });
            restore(function () {
                var vp = controller('Viewport');
                if (stock.view) {
                    stock.view.vlayout && stock.view.vlayout.doLayout();
                    stock.view.hlayout && stock.view.hlayout.doLayout();
                }
                if (typeof $ === 'function') $(window).trigger('resize');
                var api = (vp && vp.api) || null;
                if (api && api.Resize) api.Resize();
            });
        },

        /* Stock notifications that the frame itself listens to. */
        bindStock: function () {
            if (this.bound) return;
            this.bound = true;
            var me = this, nc = Common.NotificationCenter;
            /* The stock theme handler writes its ribbon height into the area: the snapshot
               is retaken, the shell heights are put on top. */
            nc.on('uitheme:changed', guarded('shell: uitheme:changed', function () {
                if (Common.UI.Themes && Common.UI.Themes.available && Common.UI.Themes.available()) me.ours = false;
                me.applyShellLayout();
                /* The stock handler has given the engine the canvas colors of the theme. */
                me.applyCanvasSkin();
            }));
            /* The document mode is changed by the stock code (the stock
               switcher, an edit request): in the shell it is "Viewing" again.
               Right after, not inside: the stock mode handler is still rebuilding
               the ribbon. */
            nc.on('pdf:mode-changed', guarded('shell: pdf:mode-changed', function () {
                setTimeout(guarded('shell: hold view', function () { me.holdView(); }), 0);
            }));
            /* A stock window closes the open shell surfaces. */
            nc.on('modal:show', guarded('shell: modal:show', function () { me.closeSurfaces(); }));
            /* A left menu panel is also closed bypassing the shell — by the cross inside
               it or by a keyboard shortcut; all paths end with this notification. */
            nc.on('layout:changed', guarded('shell: layout:changed', function (area) {
                if (area === 'leftmenu' && !me.advanced) me.syncLeftState();
            }));
            this.bindEscape();
        },

        /* --- Left menu panels -------------------------------------------------- */

        stockLeftBtn: function (prop) {
            var lm = controller('LeftMenu'), view = lm && lm.leftMenu;
            return (view && prop && view[prop]) || null;
        },

        /* The class is set before the press: the stock handler measures the area width
           to decide whether to expand the panel, and a hidden area has zero width.
           After that syncLeftState puts the state in order. */
        toggleLeftPanel: function (name) {
            var btn = this.stockLeftBtn(LEFT_PANELS[name]);
            if (!btn || (typeof btn.isDisabled === 'function' && btn.isDisabled()) || typeof btn.click !== 'function') return;
            document.body.classList.add('vo-left-open');
            btn.click();
            this.syncLeftState();
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* The source of truth is the pressed state of the stock buttons: a panel is closed by
           our button, by the cross inside it and by a keyboard shortcut. A panel the
           shell does not have (chat, the stock navigation) is closed by its own button. */
        syncLeftState: function () {
            var me = this;
            if (this.advanced || !byId(SHELL_ID)) return;
            LEFT_OFF.forEach(function (prop) {
                var b = me.stockLeftBtn(prop);
                if (b && b.pressed && typeof b.click === 'function') b.click();
            });
            var open = _.some(LEFT_PANELS, function (prop) {
                var b = me.stockLeftBtn(prop);
                return !!(b && b.pressed);
            });
            var nav = PDFE.Views.NavigationPanel;
            if (nav && typeof nav.sync === 'function') nav.sync();
            if (document.body.classList.contains('vo-left-open') === open) return;
            document.body.classList.toggle('vo-left-open', open);
            /* The area visibility changed after the layout was computed — recompute it
               directly, without layout:changed, so as not to enter our own handler. */
            var vp = controller('Viewport'), h = vp && vp.viewport && vp.viewport.hlayout;
            h && h.doLayout();
            this.resync();
        },

        /* --- Viewing mode ------------------------------------------------------ */
        /* The shell is a viewer: a document opened for editing or annotation
           is put into "Viewing" by the stock pdf:mode-apply when the mode can be
           switched (canSwitchMode; without it the stock code does not change the mode).
           A mode change by the stock code is put back to "Viewing" (pdf:mode-changed). */
        holdView: function () {
            if (this.advanced || this.startupFailed || !byId(SHELL_ID)) return false;
            var o = this.stockOptions();
            if (!(o.isPDFEdit || o.isPDFAnnotate) || !o.canSwitchMode) return false;
            Common.NotificationCenter.trigger('pdf:mode-apply', 'view');
            return true;
        },

        /* --- Row ---------------------------------------------------------------- */

        rowEl: function (name) {
            return byId('vo-' + name);
        },

        hasToolbar: function () {
            return !!this.rowEl('toolbar');
        },

        /* --- Commands ------------------------------------------------------------ */
        /* Shell command registry: the owner registers command(name, fn),
           the others take the executor command(name). While there is no owner,
           the executor does nothing, and an item with this command is inactive. */
        command: function (name, fn) {
            var me = this;
            this.commands = this.commands || {};
            if (typeof fn === 'function') {
                this.commands[name] = fn;
                return fn;
            }
            return function () {
                var owner = me.commands && me.commands[name];
                return owner ? owner.apply(this, arguments) : undefined;
            };
        },

        hasCommand: function (name) {
            return !!(this.commands && typeof this.commands[name] === 'function');
        },

        /* --- Layout -------------------------------------------------------------- */

        layoutHeight: function () {
            return H_TB_GAP_TOP + H_TOOLBAR + H_TB_GAP;
        },

        applyLayout: function (compact) {
            var vp = controller('Viewport');
            var view = vp && vp.viewport;
            if (!view || !view.vlayout) return;
            var v = view.vlayout;
            var tb = v.getItem('toolbar'), st = v.getItem('statusbar');

            if (!this.ours) this.base = {toolbar: tb && tb.height, status: st && st.height};
            this.ours = !!compact;
            var b = this.base;

            if (tb) { tb.height = compact ? this.layoutHeight() : b.toolbar; tb.el && tb.el.css && tb.el.css('height', tb.height + 'px'); }
            if (st) { st.height = compact ? 0 : b.status; st.el && st.el.css && st.el.css('height', st.height + 'px'); }

            v.doLayout();
            view.hlayout && view.hlayout.doLayout();
            Common.NotificationCenter.trigger('layout:changed', 'toolbar');
            this.resync();
        },

        applyShellLayout: function () {
            if (this.advanced || this.startupFailed || !byId(SHELL_ID)) return;
            this.applyLayout(true);
        },

        resync: function () {
            if (typeof $ === 'function') $(window).trigger('resize');
            if (this.api && this.api.Resize) this.api.Resize();
        },

        /* --- Engine canvas ------------------------------------------------------- */
        /* The engine takes the background around the pages from the theme CSS variable
           --canvas-background via asc_setSkin(); the stock call is at theme initialization,
           with a snapshot of the variables from body. The shell sets the variable on the
           children of body (compact-shell.less, "Engine canvas"), while body keeps the theme
           colors for its cache. So on top of the theme snapshot we read the same variables
           from #editor_sdk — what the canvas itself sees — and hand them to the engine after
           the build, a theme change and a mode change. Without the shell there is no shell
           rule, and the node inherits the theme as is. */
        canvasSkin: function () {
            var colors = themeColors(), host = byId('editor_sdk');
            if (!colors || !host) return colors;
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
            if (this.startupFailed || !api || typeof api.asc_setSkin !== 'function' || !themeColors()) return;
            var apply = guarded('shell: canvas skin', function () {
                var skin = me.canvasSkin();
                if (skin) api.asc_setSkin(skin);
            });
            apply();
            /* In the debug build the styles are compiled asynchronously: a retry when
               they are surely applied. In the built version the second call is harmless. */
            clearTimeout(this.skinTimer);
            this.skinTimer = setTimeout(apply, 600);
        },

        /* --- "⋮" menu -------------------------------------------------------- */
        /* The contents are the PdfActions catalog, the mechanics — the shared menu bar
           (Common.UI.Compact.MenuBar) as one section pinned to the right: it does not go
           into the "…" of a narrow window. The section button is the "⋮" icon with the
           section caption for the tooltip and the screen reader. A press in the menu closes
           the bar lists. The menu bar stops the bubbling of its clicks, so we listen in
           the capture phase. */
        buildMenu: function () {
            var me = this;
            if (this.menu) this.menu.destroy();
            this.menuAdapter = PDFE.Views.CompactMenuAdapter.create(this, this.api);
            var sections = this.menuAdapter.sections();
            var key = sections.length ? sections[0].k : null;
            this.menu = Common.UI.Compact.MenuBar.create(this.menuAdapter, {pinned: key, icons: Common.UI.Compact.Icons});
            var btn = key && this.menu.el.querySelector('.vo-mn-item[data-k="' + key + '"]');
            if (btn) {
                var label = sections[0].t;
                btn.textContent = '';
                btn.insertAdjacentHTML('beforeend', icon('moreV'));
                btn.setAttribute('aria-label', label);
                btn.setAttribute('title', label);
                btn.setAttribute('data-vo', 'more');
            }
            this.menu.el.addEventListener('click', guarded('shell: menu click', function () {
                PDFE.Views.CompactToolbar.closePopovers();
            }), true);
            return this.menu.el;
        },

        /* --- "Navigation" panel -------------------------------------------------- */

        toggleNavigation: function () {
            var nav = PDFE.Views.NavigationPanel;
            if (nav && typeof nav.toggle === 'function') nav.toggle();
        },

        /* --- Name and access --------------------------------------------------- */
        /* The name is on the left of the bar, the access button — in the right zone, when
           its own right is granted. The viewer has no version history. There is no saving
           state and no mode switcher: the viewer changes nothing.
           They are placed by the bar (CompactToolbar) via buildTitle and buildCollabButton. */
        bar: null,           // bar nodes: root, title, collab {kind: button}
        titleWas: '',
        titleError: false,   // the invalid-name window is open: the field is not committed

        bindBar: function () {
            var me = this, nc = Common.NotificationCenter;
            this.onApi('asc_onDocumentName', function (name) { me.syncTitle(name); });
            /* A rename by the portal comes as the meta command (asc_onMeta with title). */
            this.onApi('asc_onMeta', function (meta) { if (meta && meta.title) me.syncTitle(meta.title); });
            /* On a co-authoring break the stock code removes renaming. */
            nc.on('api:disconnect', guarded('shell: bar api:disconnect', function () {
                me.applyRenameRight();
                me.applyCollabLock();
            }));
            this.applyCollabLock();
        },

        /* Engine keyboard. While focus is in a bar field, the interception is off.
           Turning it on — only without a modal window. */
        engineKeys: function (on) {
            var api = this.api;
            if (!api || typeof api.asc_enableKeyEvents !== 'function') return;
            if (on && this.modalOpen()) return;
            api.asc_enableKeyEvents(!!on);
        },

        /* --- Name -------------------------------------------------------------- */
        /* The .pdf extension is not shown — like the stock title. If the portal gives
           renaming (canRename), the name is edited in place with a field; otherwise it is
           text, the full name is in the tooltip. */
        documentTitle: function () {
            var main = controller('Main');
            var t = main && main.document && main.document.title;
            if (!t && this.api && typeof this.api.asc_getDocumentName === 'function') t = this.api.asc_getDocumentName();
            t = t == null ? '' : String(t).trim();
            return t || this.textDocument;
        },

        buildTitle: function () {
            var t;
            this.bar = this.bar || {collab: {}};
            if (this.canRename()) {
                t = el('input', 'vo-title', {type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': this.tipRename});
                this.bar.title = t;
                this.bindTitle(t);
            } else {
                t = el('span', 'vo-title');
                this.bar.title = t;
            }
            this.syncTitle(this.documentTitle());
            this.applyRenameRight();
            return t;
        },

        titleIsField: function () {
            var t = this.bar && this.bar.title;
            return !!t && String(t.localName || t.tagName || '').toLowerCase() === 'input';
        },

        titleFocused: function () {
            var t = this.bar && this.bar.title;
            return !!t && document.activeElement === t;
        },

        /* The right to rename — at every access: on a co-authoring break
           the stock code removes canRename. The condition of the "Rename" item is also
           not desktop. */
        canRename: function () {
            var o = this.stockOptions();
            return !!o.canRename && !o.isDesktopApp;
        },

        applyRenameRight: function () {
            if (!this.titleIsField()) return;
            var t = this.bar.title, can = this.canRename();
            if (can) t.removeAttribute('readonly');
            else t.setAttribute('readonly', '');
            t.setAttribute('tabindex', can ? '0' : '-1');
            t.setAttribute('title', can ? this.tipRename : this.tipRenameDisabled);
            if (!can && this.titleFocused()) {
                this.revertTitle();
                typeof t.blur === 'function' && t.blur();
            }
        },

        /* "⋮ → Rename": focus and selection in the name field. */
        focusTitle: function () {
            if (!this.titleIsField() || !this.canRename()) return false;
            var t = this.bar.title;
            this.engineKeys(false);
            t.focus();
            typeof t.select === 'function' && t.select();
            return true;
        },

        /* Presses do not go beyond the field (otherwise the letters would go into the
           document). Enter commits, Esc rolls back; both return focus to the document with
           the stock edit:complete. Losing focus is also a commit. */
        bindTitle: function (t) {
            var me = this;
            var stop = function (e) { e && e.stopPropagation && e.stopPropagation(); };
            t.addEventListener('mousedown', guarded('shell: title press', function (e) {
                me.applyRenameRight();
                if (!me.canRename()) { e && e.preventDefault && e.preventDefault(); return; }
                me.closeSurfaces();
                me.engineKeys(false);
            }));
            t.addEventListener('focus', guarded('shell: title focus', function () {
                me.applyRenameRight();
                if (me.canRename()) me.engineKeys(false);
            }));
            t.addEventListener('keydown', guarded('shell: title key', function (e) {
                if (!e) return;
                stop(e);
                if (e.key === 'Enter' || e.keyCode === 13) {
                    e.preventDefault && e.preventDefault();
                    if (me.commitTitle() !== false) me.leaveTitle();
                } else if (e.key === 'Escape' || e.keyCode === 27) {
                    e.preventDefault && e.preventDefault();
                    me.revertTitle();
                    me.leaveTitle();
                }
            }));
            t.addEventListener('keypress', stop);
            t.addEventListener('keyup', stop);
            t.addEventListener('input', guarded('shell: title input', function (e) {
                stop(e);
                me.fitTitle();
            }));
            t.addEventListener('blur', guarded('shell: title blur', function (e) {
                me.commitTitle();
                if (!me.inBar(e && e.relatedTarget)) me.engineKeys(true);
            }));
        },

        /* The field width by text is given by field-sizing (compact-shell.less); size is
           a fallback for browsers without it. */
        fitTitle: function () {
            if (!this.titleIsField()) return;
            var t = this.bar.title;
            t.setAttribute('size', String(Math.max(1, String(t.value || '').length)));
        },

        leaveTitle: function () {
            var t = this.bar && this.bar.title;
            if (this.titleFocused() && typeof t.blur === 'function') t.blur();
            Common.NotificationCenter.trigger('edit:complete');
        },

        revertTitle: function () {
            if (!this.titleIsField()) return;
            this.bar.title.value = this.titleWas;
            this.fitTitle();
        },

        /* Commit. An empty name is rolled back silently, as in the stock title; the same name
           is not sent. A name with invalid characters is not sent and not rolled back: as in
           the stock title, the error window opens and the focus comes back to the field
           (returns false: the caller does not leave the field). While that window is open
           the field is not committed again: the focus moving to the window is a blur. */
        commitTitle: function () {
            if (!this.titleIsField() || this.titleError) return;
            var t = this.bar.title;
            if (!this.canRename()) { this.revertTitle(); return; }
            var v = String(t.value == null ? '' : t.value).trim();
            if (!v) { this.revertTitle(); return; }
            if (BAD_NAME.test(v)) { this.rejectTitle(); return false; }
            if (t.value !== v) t.value = v;
            this.fitTitle();
            if (v === this.titleWas) return;
            this.titleWas = v;
            this.requestRename(v);
        },

        /* The stock message of the title: the text and the list of characters. */
        rejectTitle: function () {
            var me = this;
            this.titleError = true;
            try {
                Common.UI.error({
                    msg: Common.Views.RenameDialog.prototype.txtInvalidName + '*+:"<>?|/',
                    callback: guarded('shell: title error', function () {
                        me.titleError = false;
                        setTimeout(guarded('shell: title error focus', function () {
                            if (me.titleIsField() && me.canRename()) me.focusTitle();
                        }), 50);
                    })
                });
            } catch (e) {
                this.titleError = false;
                throw e;
            }
        },

        /* Outward — the stock rename way: the 'rename' event of the stock header,
           to which LeftMenu is subscribed (wopi — asc_wopi_renameFile, otherwise
           Common.Gateway.requestRename), the name without extension. No header — the same
           choice as LeftMenu. */
        requestRename: function (name) {
            var vp = controller('Viewport');
            var header = vp && typeof vp.getView === 'function' ? vp.getView('Common.Views.Header') : null;
            if (header && typeof header.fireEvent === 'function') { header.fireEvent('rename', [name]); return; }
            var o = this.stockOptions(), api = this.api;
            if (o.wopi && api && typeof api.asc_wopi_renameFile === 'function') api.asc_wopi_renameFile(name);
            else if (Common.Gateway && typeof Common.Gateway.requestRename === 'function') Common.Gateway.requestRename(name);
        },

        /* The name changes bypassing us too: a rename by the portal. While the user edits
           the name, the typing is not overwritten. */
        syncTitle: function (name) {
            var t = this.bar && this.bar.title;
            if (!t) return;
            var full = (name == null ? '' : String(name)).trim() || this.documentTitle();
            var dot = full.lastIndexOf('.');
            var base = dot > 0 ? full.slice(0, dot) : full;
            this.titleWas = base;
            if (!this.titleIsField()) {
                t.textContent = base;
                t.setAttribute('title', full);
                return;
            }
            if (this.titleFocused() || this.titleError || t.value === base) return;
            t.value = base;
            this.fitTitle();
        },

        /* --- Access ------------------------------------------------------------ */
        /* The capability is the stock code condition: the onRequestSharingSettings handler
           or an access settings address. Outward — the stock notification
           collaboration:sharing. Unavailable without a connection (collabLocked). */
        canSharing: function () {
            var o = this.stockOptions();
            return !!(o.canRequestSharingSettings || (o.sharingSettingsUrl && o.sharingSettingsUrl.length));
        },

        COLLAB: {
            sharing: {note: 'collaboration:sharing', icon: 'share', tip: 'tipSharing', cls: 'vo-tinted'}
        },

        buildCollabButton: function (kind) {
            var me = this, spec = this.COLLAB[kind], tip = this[spec.tip];
            this.bar = this.bar || {collab: {}};
            var b = el('button', 'vo-ib vo-tb-' + kind + (spec.cls ? ' ' + spec.cls : ''),
                       {type: 'button', 'data-vo': kind, title: tip, 'aria-label': tip, 'aria-disabled': 'false'});
            b.innerHTML = icon(spec.icon);
            b.addEventListener('click', guarded('shell: ' + kind, function () { me.runCollab(kind); }));
            this.bar.collab[kind] = b;
            return b;
        },

        runCollab: function (kind) {
            if (!this.COLLAB[kind] || !this.canSharing() || this.collabLocked()) { this.applyCollabLock(); return; }
            this.closeSurfaces();
            Common.NotificationCenter.trigger(this.COLLAB[kind].note);
        },

        /* The session is broken — access is unavailable, as in the stock interface. */
        collabLocked: function () {
            var main = controller('Main');
            return !!(main && main._state && main._state.isDisconnected);
        },

        /* The lock look — by a class and aria-disabled, not the disabled attribute: on a
           disabled button the browser does not send click, and the second end of the check
           on the press would not work. */
        applyCollabLock: function () {
            var lock = this.collabLocked(), btns = (this.bar && this.bar.collab) || {};
            Object.keys(btns).forEach(function (kind) {
                btns[kind].classList.toggle('vo-locked', lock);
                btns[kind].setAttribute('aria-disabled', lock ? 'true' : 'false');
            });
        },

        inBar: function (n) {
            var root = this.bar && this.bar.root;
            return !!n && !!root && typeof root.contains === 'function' && root.contains(n);
        },

        /* --- File screen ---------------------------------------------------------- */
        /* The shell has no File screen. The stock paths to it — the print button and
           Ctrl+P (file:print → LeftMenu.clickToolbarPrint), F1, Alt+F, Ctrl+Shift+S,
           "Download as" after the engine warning, the buttons of the hidden ribbon —
           end in showing showMenu('file[:<panel>]') of the left menu view. An override on
           the view instance leads it into FileWindows.route: print, advanced
           settings and "Download as" — as windows, "Info" — as its own window, the rest
           — nowhere. A screen shown by the stock code bypassing showMenu is closed by the
           shell right away with its own hide (FileMenu 'menu:show'). In the "Stock
           interface" the screen is stock. */
        fileScreen: null,    // the override: the view, its showMenu, the screen and the show listener

        bindFileScreen: function () {
            if (this.fileScreen) return;
            var me = this, lm = controller('LeftMenu'), view = lm && lm.leftMenu;
            if (!view || typeof view.showMenu !== 'function') return;
            var own = Object.prototype.hasOwnProperty.call(view, 'showMenu'), orig = view.showMenu;
            var route = guarded('shell: file screen', function (menu, opts) {
                var files = fileWindows();
                if (files && typeof files.route === 'function') files.route(menu, opts);
            });
            var wrapped = function (menu, opts) {
                if (me.fileScreenOff() && FILE_SCREEN.test(String(menu))) {
                    route(menu, opts);
                    return;
                }
                return orig.apply(this, arguments);
            };
            view.showMenu = wrapped;

            var screen = (typeof view.getMenu === 'function' && view.getMenu('file')) || view.menuFile || null;
            var onShow = guarded('shell: file screen shown', function () { me.closeFileScreen(); });
            if (screen && typeof screen.on === 'function') screen.on('menu:show', onShow);
            this.fileScreen = {view: view, own: own, orig: orig, wrapped: wrapped, screen: screen, onShow: onShow};
        },

        unbindFileScreen: function () {
            var f = this.fileScreen;
            if (!f) return;
            this.fileScreen = null;
            if (f.view.showMenu === f.wrapped) {
                if (f.own) f.view.showMenu = f.orig;
                else delete f.view.showMenu;
            }
            if (f.screen && typeof f.screen.off === 'function') f.screen.off('menu:show', f.onShow);
        },

        /* An open File screen — close it with the stock hide (it is this closing that the
           stock code waits for: print preview, the engine keyboard). */
        closeFileScreen: function () {
            var screen = this.fileScreen && this.fileScreen.screen;
            if (!this.fileScreenOff() || !screen || typeof screen.hide !== 'function') return false;
            if (typeof screen.isVisible === 'function' && !screen.isVisible()) return false;
            screen.hide();
            return true;
        },

        /* There is no File screen: the shell is built and has not failed to start. */
        fileScreenOff: function () {
            return !this.advanced && !this.startupFailed && !!byId(SHELL_ID);
        },

        /* --- Esc ----------------------------------------------------------------- */
        /* One press is one action: an open "⋮" menu or a bar list, otherwise
           the stock context menu. The listener is on document in the capture phase:
           what is closed here goes no further. A press already taken by another
           handler (defaultPrevented — the menu closes itself) is not touched.
           Over a modal window Esc is stock. */
        bindEscape: function () {
            var me = this;
            if (typeof document.addEventListener === 'function')
                document.addEventListener('keydown', guarded('shell: escape', function (e) { me.onEscape(e); }), true);
        },

        onEscape: function (e) {
            if (!e || (e.key !== 'Escape' && e.keyCode !== 27) || e.ctrlKey || e.altKey || e.metaKey) return;
            if (this.advanced || !byId(SHELL_ID) || e.defaultPrevented || this.modalOpen()) return;
            var t = e.target || null;
            /* A bar list that has focus closes itself. */
            var tb = PDFE.Views.CompactToolbar;
            if (tb && tb.el && t && t.nodeType === 1 && tb.isOpen() && _.some(tb.pops || [], function (w) { return w.contains(t); })) return;
            if (this.closeLayer(t)) {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                if (typeof e.stopPropagation === 'function') e.stopPropagation();
            }
        },

        /* Close the topmost open shell layer; true — there was something to close. */
        closeLayer: function (t) {
            if (this.menu && typeof this.menu.isOpen === 'function' && this.menu.isOpen()) {
                this.menu.close();
                return true;
            }
            var tb = PDFE.Views.CompactToolbar;
            if (tb && typeof tb.isOpen === 'function' && tb.isOpen()) {
                tb.closePopovers();
                return true;
            }
            /* A stock menu (context): focus in it — Esc is its; otherwise we close it,
               as the stock DocumentHolder does. */
            if (this.stockMenuOpen() && !(t && typeof t.closest === 'function' && t.closest('.dropdown-menu'))) {
                var mm = Common.UI && Common.UI.Menu && Common.UI.Menu.Manager;
                if (mm && typeof mm.hideAll === 'function') { mm.hideAll(); return true; }
            }
            return false;
        },

        /* All shell surfaces at once: the "⋮" menu and the bar lists. */
        closeSurfaces: function () {
            if (this.menu && typeof this.menu.close === 'function') this.menu.close();
            var tb = PDFE.Views.CompactToolbar;
            if (tb && typeof tb.closePopovers === 'function') tb.closePopovers();
        },

        stockMenuOpen: function () {
            try {
                var list = document.querySelectorAll(STOCK_MENU_OPEN);
                return Array.prototype.some.call(list, function (m) { return m.getClientRects().length > 0; });
            } catch (e) {
                return false;
            }
        },

        modalOpen: function () {
            var mw = Common.Utils && Common.Utils.ModalWindow;
            return !!mw && typeof mw.isVisible === 'function' && mw.isVisible() === true;
        },

        /* --- Texts ------------------------------------------------------------- */
        /* The defaults are English, the translation overlays them from locale/<language>.json. */

        textDocument: 'Document',
        tipRename: 'Document name — can be edited',
        tipRenameDisabled: 'Document name (renaming unavailable)',
        tipSharing: 'Sharing settings'

    }, PDFE.Views.CompactShell || {});

    /* The shared controllers ask the shared layer registry about the chosen shell, not
       the viewer. Whether the shell is chosen is wanted, read at the moment of the question. */
    var shells = window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.Shells;
    if (shells && typeof shells.register === 'function') {
        shells.register({
            wanted: function (config) { return PDFE.Views.CompactShell.wanted(config); }
        });
    }

    return PDFE.Views.CompactShell;
});
