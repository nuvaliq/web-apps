/*
 * CompactShell — the Compact shell of the presentation editor.
 * Part of the web-apps fork, AGPL-3.0.
 *
 *     #vo-header (46) → #vo-menubar (30) → #vo-toolbar (4 + 44 + 8)  |  #vo-status (30, on top)
 *
 * This is the frame: the enabling condition, early start and rollback to the stock
 * editor, the shell rows and the owners of hiding them, the edit right and the stock
 * editing lock, the command registry, the header, the "Slide Show ▾" button, the focus
 * mode, "Hide Toolbar" and the Esc queue, the engine canvas palette,
 * the "Stock interface" and the return from it.
 * The row and area contents are installed by the zones (ZONES): each has its own file and
 * its own install(shell).
 *
 * The stock ribbon, title, left icon column and status bar are not
 * removed: the styles hide them under body.vo-compact, and the "Stock interface"
 * (vo-advanced) brings them back together with the stock area heights.
 */
define([
    'presentationeditor/main/app/view/StockBridge',
    'common/main/lib/view/compact/Icons',
    'presentationeditor/main/app/view/CompactWindows',
    'presentationeditor/main/app/view/SlideSelection',
    'presentationeditor/main/app/view/CompactModes',
    'presentationeditor/main/app/view/SlideActions',
    'presentationeditor/main/app/view/CompactMenuAdapter',
    'presentationeditor/main/app/view/CompactToolbar',
    'presentationeditor/main/app/view/SlideSections',
    'presentationeditor/main/app/view/CompactLeft',
    'presentationeditor/main/app/view/CompactStatus'
], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    var SHELL_ID  = 'vo-shell';
    var STATUS_ID = 'vo-status';
    var BACK_ID   = 'vo-back';

    /* The early-start request class and the retry loop — as in documents:
       the request is set on Gateway init and hides the stock chrome until the build,
       20 build attempts 150 ms apart. */
    var BOOT_CLASS = 'vo-boot';

    /* The AI plugin of the stock editor: the compact shell does not show its "AI"
       context menu item (hideAiItem). */
    var AI_PLUGIN = 'asc.{9DC93CDB-B576-4F0C-B55E-FCC9C48DD007}';
    var START_TRIES = 20, START_STEP = 150;

    /* Row heights — the numbers of the documents and spreadsheets header (name 46, menu 30,
       panel card 44 with a gap of 4 above and 8 below: the card top at
       76 + 4 = 80, as in them), paired with @vo-h-header, @vo-h-menu,
       @vo-tb-gap-top, @vo-h-toolbar and @vo-tb-gap in compact-shell.less; change
       them in pairs. In documents the panel card lies over the page, the engine
       shifts the page under it. Presentations have no such shift (the thumbnail
       strip, the slide and the notes are SDK nodes), so the card with gaps
       above and below takes room in the layout. */
    var H_HEADER = 46, H_MENU = 30, H_TOOLBAR = 44;
    var H_TB_GAP_TOP = 4;   // above the card: 76 + 4 = 80
    var H_TB_GAP = 8;       // below the card: the whole chrome 80 + 44 + 8 = 132
    var H_STATUS = 0;    // the status bar lies over the work area (CSS, @vo-h-status 30)

    /* Rows and hiding owners. A row is visible while no owner hides it:
       no edit right (right), "Viewing" (view), "Hide
       Toolbar" (hidden), focus mode (focus). Each owner removes
       only its own reason. */
    var ROWS = ['header', 'menubar', 'toolbar', 'status'];
    var OWNERS = ['right', 'view', 'hidden', 'focus'];

    /* Shell zones in installation order: the bridge to the stock controls first —
       the others depend on it; windows on the template (they depend on
       nobody, but are enabled before the first command that opens a window);
       selection and mode — before those who subscribe to them; the menu row,
       the panel, the right panel, the left area and the status bar. The name is a
       PE.Views module with an install(shell) method. */
    var ZONES = ['StockBridge', 'CompactWindows', 'SlideSelection', 'CompactModes', 'SlideActions',
                 'CompactToolbar', 'SlideSections', 'CompactLeft', 'CompactStatus'];

    /* Canvas palette: the skin key value is looked up on #editor_sdk first under
       this prefix (compact-shell.less, "Canvas"), then under the theme name.
       SKIN_LIGHT — the light engine skin under a dark interface theme;
       SKIN_RETRY — a retry after the asynchronous LESS build in development. */
    var SKIN_PREFIX = '--vo-skin-';
    var SKIN_LIGHT = 'theme-light';
    var SKIN_RETRY = 600;

    /* --- Header ------------------------------------------------------------ */
    /* Place of the slide show button in the header — first in the right cluster; empty
       while the button stands on the panel. */
    var HDR_SHOW_ID = 'vo-hdr-show';

    /* --- Slide Show ---------------------------------------------------- */
    /* The button is at the right edge of the panel (#vo-tb-end, before the focus chevron —
       as its last node), and without a panel — in the header. The counterpart is the stock show
       button: in "Editing" — the ribbon one, in "Viewing" and without edit rights —
       the status bar one (its menu has no "Show Settings": there this row is disabled
       with a reason). The show shortcut is stock (Ctrl+F5), we have none of our own. */
    var TB_END_ID = 'vo-tb-end';
    var SHOW_EDIT = 'Toolbar:btnPreview',
        SHOW_VIEW = 'Statusbar:btnPreview',
        SHOW_SETTINGS = 'Toolbar:mnuShowSettings';

    /* --- Focus mode and Esc ---------------------------------------------- */
    /* The engine input field (the stock controllers recognize it the same way — by id);
       Esc in it is the engine's business: leaving the text, clearing the selection. */
    var ENGINE_INPUT = /area_id/;
    /* An open stock menu (Common.UI.Menu: the bootstrap class open on the parent). */
    var STOCK_MENU_OPEN = '.open > .dropdown-menu';

    /* "Version History" and "Document Access": outward — the same notification
       that the buttons of the "Collaboration" tab send (lib/view/ReviewChanges.js:
       btnHistory → collaboration:history, btnSharing → collaboration:sharing);
       lock — from these buttons (connection loss, loss of access rights). */
    var COLLAB = {
        history: {twin: 'Review:btnHistory', note: 'collaboration:history', icon: 'history', tip: 'tipHistory', cls: ''},
        sharing: {twin: 'Review:btnSharing', note: 'collaboration:sharing', icon: 'share', tip: 'tipSharing', cls: 'vo-tinted'}
    };

    /* "Download ▾": the formats of the "Download as" panel of the stock "File"
       (FileMenuPanels.ViewSaveAs) and print. The item is drawn by the right and by the
       stock visibility of the counterpart in "File" (FileMenu.applyMode: miDownload —
       canDownload, miPrint / miPrintWithPreview — canPrint). */
    var DOWNLOADS = [
        {type: 'PPTX', t: 'textDownloadPptx'},
        {type: 'PDF',  t: 'textDownloadPdf'},
        {type: 'ODP',  t: 'textDownloadOdp'}
    ];
    var TWIN_DOWNLOAD = 'FileMenu:miDownload',
        TWIN_PRINT = 'FileMenu:miPrint',
        TWIN_PRINT_PREVIEW = 'FileMenu:miPrintWithPreview';

    /* The stock clickSaveAsFormat calls menu.hide() after downloading: the "File"
       menu is not open here, the header closes its own menu itself. */
    var SAVE_AS_MENU = {hide: function () {}};

    /* Switcher modes: captions and explanations are the module texts below. */
    var MODES = [
        {v: 'edit', t: 'textModeEdit', d: 'textModeEditHint', i: 'rename'},
        {v: 'view', t: 'textModeView', d: 'textModeViewHint', i: 'panel'}
    ];

    /* "Saving…" is held this long from the start of saving: locally it
       lasts milliseconds and would flash for a single frame. */
    var SAVE_HOLD_MS = 3000;

    /* Characters not allowed in a file name — the set of the stock title
       (lib/view/Header.js) and of the rename window. */
    var BAD_NAME = /[\t*+:"<>?|\\/]/;

    /* --- Protection from our own failures ------------------------------------- */
    /* NotificationCenter is Backbone.Events: an exception from one handler
       breaks the whole trigger, including the stock subscribers after us (on
       app:ready that is removing the loading mask). So everything the editor calls
       from outside goes through this wrapper; after a startup rollback it is silent.
       A repeated failure at the same place is not logged. */
    var warned = {};

    function guarded(label, fn) {
        return function () {
            if (PE.Views.CompactShell && PE.Views.CompactShell.startupFailed) return;
            try {
                return fn.apply(this, arguments);
            } catch (e) {
                if (!warned[label]) {
                    warned[label] = true;
                    if (window.console && console.warn)
                        console.warn('Compact shell: "' + label + '" failed, the editor goes on without it.', e);
                }
            }
        };
    }

    function byId(id) { return document.getElementById(id); }

    function node(tag, id, cls) {
        var el = document.createElement(tag);
        id && el.setAttribute('id', id);
        cls && el.setAttribute('class', cls);
        return el;
    }

    function prepend(host, el) {
        host.insertBefore(el, host.firstChild || null);
    }

    function bodyClasses() {
        return String(document.body.className || '').split(/\s+/).filter(function (c) { return c.indexOf('vo-') === 0; });
    }

    function controller(name) {
        return window.PE && PE.getController ? PE.getController(name) : null;
    }

    function el(tag, cls, attrs) {
        var e = node(tag, null, cls);
        _.each(attrs || {}, function (v, k) { e.setAttribute(k, v); });
        return e;
    }

    /* AIR icon of the shared editors set (Common.UI.Compact.Icons). An icon is
       not a reason to roll the shell back: without it the button stays with a caption and
       a tooltip. */
    function icon(name, size) {
        var C = window.Common && Common.UI && Common.UI.Compact, I = C && C.Icons;
        try { return I && typeof I.svg === 'function' ? I.svg(name, size) : ''; } catch (e) { return ''; }
    }

    function bridge() { return PE.Views.StockBridge; }

    function modes() { return PE.Views.CompactModes; }

    function onDocument(type, fn) {
        if (typeof document.addEventListener === 'function') document.addEventListener(type, fn);
    }

    PE.Views.CompactShell = _.extend({

        guarded: guarded,
        ZONES: ZONES,
        H_HEADER: H_HEADER,
        H_MENU: H_MENU,
        H_TOOLBAR: H_TOOLBAR,
        H_TB_GAP_TOP: H_TB_GAP_TOP,
        H_TB_GAP: H_TB_GAP,
        H_STATUS: H_STATUS,

        /* The enabling condition is strictly `editorConfig.ui.shell === 'modern'`,
           as in documents: case, spaces and foreign values leave
           the stock editor, a read failure and a startup rollback do too.
           config — the config from Gateway init (Main has not laid it out there yet);
           without an argument the editorConfig of the stock controller is read. */
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

        /* Engine callback under the same protection. Before the build the api is taken from
           the stock Main. */
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

        /* --- Early start ---------------------------------------------------- */
        /* The stock editor removes the loading mask already on app:face, while the shell
           is built on app:ready. So that the stock ribbon and title do not flash,
           on Gateway init the request class vo-boot is set, and on app:face the areas
           get the shell heights. boot — what was done to the layout for the
           frame; booted — the request was already there, a second subscription is not needed. */
        boot: null,
        booted: false,

        announce: function (config) {
            if (this.booted || byId(SHELL_ID) || !this.wanted(config)) return;
            var me = this;
            this.booted = true;
            this.boot = {heights: null};
            this.tuneConfig(config);
            document.body.classList.add(BOOT_CLASS);
            /* The subscription is later than the stock one (which was set up at controller startup):
               by our call the stock has already laid out the areas by its flags. */
            Common.NotificationCenter.on('app:face', guarded('shell: boot frame', function (opts) {
                me.bootLayout(opts);
            }));
        },

        /* Stock settings that the shell sets itself, like an integrator:
           the "What's New" tips about stock editor novelties
           (customization.features.featuresTips) and "Suggest a Feature" on the
           "File" screen (suggestFeature). They are written into the Gateway init config before
           Main lays it out (see wanted). The integrator's nested objects are not
           changed — copies are put in. The settings act for the whole session, and in
           the "Stock interface" too. Plugins and "Protect" stay
           stock: the compact shell hides only their items (hideAiItem,
           #fm-btn-protect in compact-shell.less), while the "Stock interface" shows
           them. */
        tuneConfig: function (config) {
            if (!config || typeof config !== 'object') return;
            var c = config.customization && typeof config.customization === 'object' ? config.customization : {};
            var f = c.features && typeof c.features === 'object' ? c.features : {};
            config.customization = _.extend({}, c, {
                suggestFeature: false,
                features: _.extend({}, f, {featuresTips: false})
            });
        },


        /* The "AI" context menu item comes from the AI plugin: the engine sends
           plugin items on every menu show (onPluginContextMenu), and the stock
           puts them in with the stock updateCustomItems and removes them when the menu closes. In
           the compact shell the AI plugin items do not reach the menu; in the "Stock
           interface" and after a startup failure they are stock. Other plugin items and the
           plugins themselves are not touched. The wrapper is on the view instance, and the stock method
           is taken at call time: the view prototype gets the real updateCustomItems
           later, with the deferred loading of DocumentHolderExt, and until then
           there is a stub. */
        hideAiItem: function () {
            var me = this, dh = controller('DocumentHolder'), view = dh && dh.documentHolder;
            if (!view || typeof view.updateCustomItems !== 'function' || view.updateCustomItems._voAi) return;
            var own = Object.prototype.hasOwnProperty.call(view, 'updateCustomItems') ? view.updateCustomItems : null;
            var wrapped = function (menu, data) {
                if (_.isArray(data) && !me.advanced && !me.startupFailed && document.body.classList.contains('vo-compact'))
                    data = _.reject(data, function (d) { return !!d && d.guid === AI_PLUGIN; });
                var update = own || Object.getPrototypeOf(this).updateCustomItems;
                return typeof update === 'function' ? update.call(this, menu, data) : undefined;
            };
            wrapped._voAi = true;
            view.updateCustomItems = wrapped;
        },

        /* Frame heights. The stock ones are remembered nearby: endBoot returns them before
           the stock snapshot, otherwise the "Stock interface" would get the frame heights. */
        bootLayout: function (opts) {
            var b = this.boot;
            if (!b || b.heights) return;
            var vp = controller('Viewport');
            var view = vp && vp.viewport;
            if (!view || !view.vlayout) return;
            var v = view.vlayout;
            var main = controller('Main');
            var o = opts || (main && main.appOptions) || {};
            var shellH = H_HEADER + H_MENU + (o.isEdit ? H_TB_GAP_TOP + H_TOOLBAR + H_TB_GAP : 0);
            b.heights = [];
            [[v.getItem('toolbar'), shellH], [v.getItem('statusbar'), H_STATUS]].forEach(function (p) {
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

        /* Remove the request. The height is returned only if it is still ours:
           otherwise the stock has already re-laid the area, and its value is fresher.
           relayout = false — the frame handover from create(): the stock height
           returns into the area model, while the frame height stays in the DOM,
           which applyLayout(true) will write right away. */
        endBoot: function (relayout) {
            var b = this.boot;
            if (!b) return;
            this.boot = null;
            document.body.classList.remove(BOOT_CLASS);
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

        /* Startup on app:ready (controller/Viewport.js). The retry is for an editor
           that is not ready yet: create() then exits silently. A failure is not
           retried: the loop is entirely under guarded, and an exception from create()
           breaks the attempts. An attempt after which there is neither a shell nor
           a next attempt returns the stock layout. */
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
        advanced: false,
        startupFailed: false,
        base: null,          // stock area heights at the moment the shell took them
        ours: false,         // the area heights are ours now
        rows: null,          // row name → {owner: true}
        commands: null,      // command name → its owner
        rightSnapshot: null, // edit right at startup; null — no snapshot yet
        editRequestRevoked: false,
        skinTimer: null,     // canvas palette retry

        /* ------------------------------------------------------------------ */

        create: function () {
            if (this.startupFailed || byId(SHELL_ID)) return this;

            var toolbar = byId('toolbar'), statusbar = byId('statusbar');
            if (!toolbar || !statusbar) return this;
            var api = this.engineApi();
            if (!api) return this;

            this.endBoot(false);
            var stock = this.snapshotStock();
            try {
                this.api = api;
                this.rightSnapshot = this.stockEditRight();
                this.rows = this.rows || {};

                var shell = node('div', SHELL_ID);
                shell.appendChild(node('div', 'vo-header', 'vo-row'));
                shell.appendChild(node('div', 'vo-menubar', 'vo-row'));
                shell.appendChild(node('div', 'vo-toolbar', 'vo-row'));
                prepend(toolbar, shell);
                prepend(statusbar, node('div', STATUS_ID, 'vo-row'));

                document.body.classList.add('vo-compact');
                this.command('stockInterface', _.bind(this.toggleMode, this));
                this.command('focus', _.bind(this.toggleFocus, this));
                this.command('hideToolbar', _.bind(this.toggleToolbar, this));
                if (!this.editRight()) this.setRow('toolbar', false, 'right');
                this.bindStock();
                this.installZones();
                /* The header comes after the zones: the mode switcher reads CompactModes. */
                this.rowEl('header').appendChild(this.buildHeader());
                this.bindHeader();
                /* The show button comes after the header and the panel: its place is one of them. */
                this.buildShow();
                this.bindShow();
                this.bindEscape();
                this.applyRows();
                this.applyLayout(true);
                this.applyCanvasSkin();
            } catch (e) {
                /* A failure is terminal for the session: a retry does not build the shell on top of
                   a partial one. The original error is handed to the outer guarded. */
                try { this.rollbackStartup(stock); } finally { throw e; }
            }
            return this;
        },

        installZones: function () {
            var me = this;
            ZONES.forEach(function (name) {
                var zone = PE.Views[name];
                if (zone && typeof zone.install === 'function') zone.install(me);
            });
        },

        /* Stock notifications that the frame itself listens to. */
        bindStock: function () {
            var me = this, nc = Common.NotificationCenter;
            this.hideAiItem();
            /* Edit right revoked — the only thing that resets the snapshot: other
               stock locks (connection loss, "Viewing") do not take the right away. */
            nc.on('collaboration:sharingdeny', guarded('shell: sharingdeny', function () {
                me.rightSnapshot = false;
                me.editRequestRevoked = true;
                me.setRow('toolbar', false, 'right');
                me.dropEditRightControls();
                me.applyEditButtonLock();
            }));
            /* The stock theme handler (controller/Viewport.js onThemeChanged)
               writes its ribbon height into the areas. It is subscribed earlier than us, so
               at this moment the stock heights of the new theme lie in the layout:
               the snapshot is retaken, the shell heights are put on top. */
            nc.on('uitheme:changed', guarded('shell: uitheme:changed', function () {
                if (Common.UI.Themes && Common.UI.Themes.available && Common.UI.Themes.available()) me.ours = false;
                me.applyShellLayout();
                /* The stock handler has already given the engine the colors of the new theme from body. */
                me.applyCanvasSkin();
            }));
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
                classes: bodyClasses()
            };
        },

        rollbackStartup: function (stock) {
            this.startupFailed = true;
            this.ours = false;
            var restore = function (fn) {
                try { fn(); } catch (e) {
                    if (window.console && console.warn) console.warn('Compact shell: rollback step failed.', e);
                }
            };
            /* Overrides of stock methods that the zones managed to set —
               are removed in the reverse order of installation. */
            ZONES.slice().reverse().forEach(function (name) {
                var zone = PE.Views[name];
                if (zone && typeof zone.unbind === 'function') restore(function () { zone.unbind(); });
            });
            restore(function () {
                var list = document.querySelectorAll ? document.querySelectorAll('[id^="vo-"]') : [];
                Array.prototype.forEach.call(list, function (el) {
                    if (stock.nodes.indexOf(el) < 0 && el.parentNode) el.parentNode.removeChild(el);
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

        /* --- Edit right ---------------------------------------------------- */
        /* The shared appOptions is changed by the stock locks (LeftMenu.SetDisabled writes
           isEdit = false), so the right is a snapshot at startup. If at startup
           editing was already removed by a stock reason, the original value is kept in
           LeftMenu.previsEdit. */
        stockEditRight: function () {
            var main = controller('Main');
            var o = main && main.appOptions;
            if (!o) return false;
            var lm = controller('LeftMenu');
            var view = lm && lm.leftMenu;
            if (view && view._state && view._state.disabled && lm.previsEdit !== undefined) return !!lm.previsEdit;
            return !!o.isEdit;
        },

        editRight: function () {
            return this.rightSnapshot === null ? this.stockEditRight() : !!this.rightSnapshot;
        },

        /* --- Stock editing lock ------------------------------------------- */
        /* The stock forbids editing with the notification editing:disable(disable, options,
           type) and keeps the reason stack itself (Main.stackDisableActions): version
           history and connection loss (Main.disableEditing), signature
           (SignatureSettings). For that time it covers the ribbon with a transparent
           mask (Toolbar.DisableToolbar), while the buttons are not disabled, so the counterparts
           stay available — the zones lock their own controls themselves, as the documents
           Compact does (its CompactShell.lockState). The reason is not remembered —
           the stack is asked: the top stock reason and its options set. The own
           reason of "Viewing" (CompactModes.VIEW_TYPE) is not stock: it is driven by
           the mode zone, and the switcher must bring "Editing" back from it.
           The subscribers of the notification are set up later than Main: by their
           call the stack is already updated. */
        lockState: function () {
            var main = controller('Main'), stack = main && main.stackDisableActions;
            var m = modes(), own = (m && m.VIEW_TYPE) || 'vo-view';
            if (stack && typeof stack.length === 'function' && typeof stack.get === 'function') {
                for (var i = stack.length() - 1; i >= 0; i--) {
                    var a = stack.get(i);
                    if (a && a.disable && a.type !== own) return {on: true, options: a.options || {}, type: a.type};
                }
            }
            return {on: false, options: {}};
        },

        /* --- Rows ------------------------------------------------------------ */

        rowEl: function (name) {
            return byId(name === 'status' ? STATUS_ID : 'vo-' + name);
        },

        rowVisible: function (name) {
            var owners = this.rows && this.rows[name];
            return !owners || _.isEmpty(owners);
        },

        hasToolbar: function () {
            return !!this.rowEl('toolbar') && this.rowVisible('toolbar');
        },

        /* Hide or return a row on behalf of an owner. A visibility change of any
           row is the shell:toolbar notification (whether the panel row is visible, the row name):
           the show button place and the panel measurement depend on it. */
        setRow: function (name, visible, owner) {
            if (ROWS.indexOf(name) < 0) return;
            owner = OWNERS.indexOf(owner) < 0 ? 'hidden' : owner;
            this.rows = this.rows || {};
            var was = this.rowVisible(name);
            var owners = this.rows[name] = this.rows[name] || {};
            if (visible) delete owners[owner]; else owners[owner] = true;
            if (was === this.rowVisible(name)) return;
            this.applyRows();
            this.applyShellLayout();
            Common.NotificationCenter.trigger('shell:toolbar', this.hasToolbar(), name);
        },

        applyRows: function () {
            var me = this;
            ROWS.forEach(function (name) {
                var el = me.rowEl(name);
                if (!el) return;
                if (me.rowVisible(name)) el.removeAttribute('hidden');
                else el.setAttribute('hidden', '');
            });
        },

        /* --- Commands --------------------------------------------------------- */
        /* Shell command registry: the owner zone registers a command
           command(name, fn), the others take the executor command(name).
           While there is no owner, the executor does nothing, and an item with this
           command is inactive (hasCommand). */
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

        /* --- Layout ------------------------------------------------------- */
        /* The stock areas are not removed: a height is set for the vertical ones, the rest
           is hidden by styles. The snapshot of the stock heights is taken every time when the heights
           are not ours yet: in the "Stock interface" the stock code drives them. */
        layoutHeight: function () {
            var h = 0;
            if (this.rowVisible('header')) h += H_HEADER;
            if (this.rowVisible('menubar')) h += H_MENU;
            if (this.hasToolbar()) h += H_TB_GAP_TOP + H_TOOLBAR + H_TB_GAP;
            return h;
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
            if (st) { st.height = compact ? H_STATUS : b.status; st.el && st.el.css && st.el.css('height', st.height + 'px'); }

            v.doLayout();
            view.hlayout && view.hlayout.doLayout();
            Common.NotificationCenter.trigger('layout:changed', 'toolbar');
            this.resync();
        },

        /* In the "Stock interface" and before the build the layout is not touched: the heights
           there are stock. applyLayout directly is called only by create() and toggleMode(). */
        applyShellLayout: function () {
            if (this.advanced || this.startupFailed || !byId(SHELL_ID)) return;
            this.applyLayout(true);
        },

        resync: function () {
            if (typeof $ === 'function') $(window).trigger('resize');
            if (this.api && this.api.Resize) this.api.Resize();
        },

        /* --- Header ------------------------------------------------------------ */
        /* As in documents: on the left the name and the saving state, on the right —
           the show button place, version history, "Download ▾", document access
           and the "Editing / Viewing" switcher as the rightmost. There is no comments
           button: the panel is opened by "Comment" on the toolbar
           and "Review → Comments". The portal controls
           (history, access, rename) — only when the portal provides them:
           without the capability there is no control at all, no stubs. */
        hdr: null,           // header nodes: root, right, title, state, collab {kind: button}, download, mode, edit
        pops: null,          // lists at the header buttons (popover)
        saveFlags: null,
        saveKey: null,
        saveHeld: false,
        saveHoldTimer: null,
        titleWas: '',

        buildHeader: function () {
            this.hdr = {collab: {}, mode: null, edit: null, download: null};
            this.pops = [];
            var hd = el('div', 'vo-hd');
            hd.appendChild(this.buildTitle());
            hd.appendChild(this.buildSaveState());

            var right = el('div', 'vo-hd-right');
            right.appendChild(node('span', HDR_SHOW_ID, 'vo-hdr-show'));
            if (this.canHistory()) right.appendChild(this.buildCollabButton('history'));
            var download = this.buildDownload();
            if (download) right.appendChild(download);
            if (this.canSharing()) right.appendChild(this.buildCollabButton('sharing'));
            var mode = this.buildModeSwitch() || this.buildEditButton();
            if (mode) right.appendChild(mode);
            hd.appendChild(right);

            this.hdr.root = hd;
            this.hdr.right = right;
            return hd;
        },

        /* Header subscriptions: the name and the saving state — from the engine, the switcher
           kind — from the mode zone, locks — from the stock. */
        bindHeader: function () {
            var me = this, nc = Common.NotificationCenter;
            this.onApi('asc_onDocumentName', function (name) { me.syncTitle(name); });
            /* A rename by the portal comes as the meta command (asc_onMeta with
               title); by it the stock updates its title (Main.onMeta). */
            this.onApi('asc_onMeta', function (meta) { if (meta && meta.title) me.syncTitle(meta.title); });
            this.onApi('asc_onDocumentModifiedChanged', function () { me.syncSaveState(); });
            this.onApi('asc_onStartAction', function (type, id) {
                if (me.isSaveAction(id)) me.setSaveState({saving: true});
            });
            /* The "modified" flag may come before the end of an action: any end
               rereads the engine, but only Save clears "saving in progress". */
            this.onApi('asc_onEndAction', function (type, id) {
                var flags = {modified: me.engineModified()};
                if (me.isSaveAction(id)) flags.saving = false;
                me.setSaveState(flags);
            });
            var m = modes();
            nc.on((m && m.MODE_EVENT) || 'vo:mode', guarded('shell: header vo:mode', function (e) {
                me.applyModeLook(e && e.mode);
            }));
            /* On a co-authoring break the stock removes renaming and disables the buttons
               of "Collaboration"; the mode switcher is locked. */
            nc.on('api:disconnect', guarded('shell: header api:disconnect', function () {
                me.applyRenameRight();
                me.applyCollabLock();
                me.applyModeLock();
                me.applyEditButtonLock();
            }));
            /* The stock editing lock (version history, connection loss) locks
               the mode switcher and is lifted together with the reason. */
            nc.on('editing:disable', guarded('shell: header editing:disable', function () {
                me.applyModeLock();
                me.applyEditButtonLock();
            }));
            nc.on('editrequest:status', guarded('shell: header edit request status', function () {
                me.applyEditButtonLock();
            }));
            this.onApi('asc_onCoAuthoringDisconnect', function () {
                // Main updates the connection state during the same callback delivery.
                setTimeout(guarded('shell: header SDK disconnect', function () { me.applyEditButtonLock(); }), 0);
            });
            onDocument('click', guarded('shell: header outside click', function (e) {
                me.closeHeaderPops(e && e.target);
            }));
            this.applyCollabLock();
            this.bindEditButtonFocus();
            this.applyEditButtonLock();
            this.syncSaveState();
        },

        stockOptions: function () {
            var main = controller('Main');
            return (main && main.appOptions) || {};
        },

        /* Engine keyboard. While focus is in the name field or in a header list,
           the interception is off: the engine synchronously returns focus to its field, and
           without this neither typing nor arrows reach us. Turning on — only
           without a modal window: its keyboard will be returned by the stock when the window closes. */
        engineKeys: function (on) {
            var api = this.api;
            if (!api || typeof api.asc_enableKeyEvents !== 'function') return;
            var mw = Common.Utils && Common.Utils.ModalWindow;
            if (on && mw && typeof mw.isVisible === 'function' && mw.isVisible()) return;
            api.asc_enableKeyEvents(!!on);
        },

        /* --- Name ------------------------------------------------------- */
        /* The extension is not shown — like the stock title (withoutExt). If the portal
           gives renaming (the stock canRename — the onRequestRename handler) and
           there is the edit right — the name is edited in place with a field; otherwise it is
           text, the full name is in the tooltip. A field, not contenteditable:
           the keyboard is held by the engine, and the stock title for the same reason has
           a field. */
        documentTitle: function () {
            var main = controller('Main');
            var t = main && main.document && main.document.title;
            if (!t && this.api && typeof this.api.asc_getDocumentName === 'function') t = this.api.asc_getDocumentName();
            t = t == null ? '' : String(t).trim();
            return t || this.textPresentation;
        },

        buildTitle: function () {
            var t;
            if (this.canRename()) {
                t = el('input', 'vo-hd-title', {type: 'text', spellcheck: 'false', autocomplete: 'off'});
                this.hdr.title = t;
                this.bindTitle(t);
            } else {
                t = el('span', 'vo-hd-title');
                this.hdr.title = t;
            }
            this.syncTitle(this.documentTitle());
            this.applyRenameRight();
            return t;
        },

        titleIsField: function () {
            var t = this.hdr && this.hdr.title;
            return !!t && String(t.localName || t.tagName || '').toLowerCase() === 'input';
        },

        titleFocused: function () {
            var t = this.hdr && this.hdr.title;
            return !!t && document.activeElement === t;
        },

        /* The right to rename — at every access, not as a snapshot: on a co-authoring
           break the stock removes canRename (Main.onCoAuthoringDisconnect),
           the edit right goes away by collaboration:sharingdeny. The condition of the item
           "File → Rename" — also not desktop (FileMenu.applyMode). */
        canRename: function () {
            var o = this.stockOptions();
            return !!o.canRename && !o.isDesktopApp && this.editRight();
        },

        /* The field is open or closed by the right of this moment. The right went away in the middle of
           editing — the typing is rolled back, the field loses focus: the commit will not
           find the right and will send nothing. */
        applyRenameRight: function () {
            if (!this.titleIsField()) return;
            var t = this.hdr.title, can = this.canRename();
            if (can) t.removeAttribute('readonly');
            else t.setAttribute('readonly', '');
            t.setAttribute('tabindex', can ? '0' : '-1');
            t.setAttribute('title', can ? this.tipRename : this.tipRenameDisabled);
            if (!can && this.titleFocused()) {
                this.revertTitle();
                typeof t.blur === 'function' && t.blur();
            }
        },

        /* Presses do not go beyond the field (otherwise the letters would go into the slide). Enter
           commits, Esc rolls back; both return focus to the presentation with the stock
           edit:complete. Losing focus is also a commit: the engine itself calls it too,
           taking focus off interface fields on a press into the slide. */
        bindTitle: function (t) {
            var me = this;
            var stop = function (e) { e && e.stopPropagation && e.stopPropagation(); };
            t.addEventListener('mousedown', guarded('shell: title press', function (e) {
                me.applyRenameRight();
                if (!me.canRename()) { e && e.preventDefault && e.preventDefault(); return; }
                me.closeHeaderPops();
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
                    me.commitTitle();
                    me.leaveTitle();
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
                if (!me.inHeader(e && e.relatedTarget)) me.engineKeys(true);
            }));
        },

        /* The field width by text is given by field-sizing (compact-shell.less); size is
           a fallback for browsers without it. */
        fitTitle: function () {
            if (!this.titleIsField()) return;
            var t = this.hdr.title;
            t.setAttribute('size', String(Math.max(1, String(t.value || '').length)));
        },

        leaveTitle: function () {
            var t = this.hdr && this.hdr.title;
            if (this.titleFocused() && typeof t.blur === 'function') t.blur();
            Common.NotificationCenter.trigger('edit:complete');
        },

        revertTitle: function () {
            if (!this.titleIsField()) return;
            this.hdr.title.value = this.titleWas;
            this.fitTitle();
        },

        /* Commit. The right — here too: it could have gone while the field was in focus.
           An empty name and invalid characters are rolled back silently. The same name is not
           sent (nor one that came from outside: titleWas is already new). */
        commitTitle: function () {
            if (!this.titleIsField()) return;
            var t = this.hdr.title;
            if (!this.canRename()) { this.revertTitle(); return; }
            var v = String(t.value == null ? '' : t.value).trim();
            if (!v || BAD_NAME.test(v)) { this.revertTitle(); return; }
            if (t.value !== v) t.value = v;
            this.fitTitle();
            if (v === this.titleWas) return;
            this.titleWas = v;
            this.requestRename(v);
        },

        /* Outward — the stock rename way: the 'rename' event of the stock
           header, to which LeftMenu is subscribed (wopi — asc_wopi_renameFile,
           otherwise Common.Gateway.requestRename), the name without extension, as in the
           stock title. No header — the same choice as LeftMenu. */
        requestRename: function (name) {
            var vp = controller('Viewport');
            var header = vp && typeof vp.getView === 'function' ? vp.getView('Common.Views.Header') : null;
            if (header && typeof header.fireEvent === 'function') { header.fireEvent('rename', [name]); return; }
            var o = this.stockOptions(), api = this.api;
            if (o.wopi && api && typeof api.asc_wopi_renameFile === 'function') api.asc_wopi_renameFile(name);
            else if (Common.Gateway && typeof Common.Gateway.requestRename === 'function') Common.Gateway.requestRename(name);
        },

        /* The name changes bypassing us too: a rename by the portal, a version
           restore. Without this subscription the field would send the old name back on the very first
           focus loss. While the user edits the name, the typing is not overwritten. */
        syncTitle: function (name) {
            var t = this.hdr && this.hdr.title;
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
            if (this.titleFocused() || t.value === base) return;
            t.value = base;
            this.fitTitle();
        },

        /* --- Saving state ------------------------------------------- */
        /* As in documents: "Saved" — a tick without a caption, "Saving…" and
           "Not saved" — a badge with a caption; the caption is also in the tooltip and
           in the name for the screen reader. The states are the engine truth: "modified" —
           asc_isDocumentModified by asc_onDocumentModifiedChanged, "saving
           in progress" — the long action Save / ForceSaveButton between
           asc_onStartAction and asc_onEndAction (by them the stock also writes its own
           "Saving…", Main.onLongActionBegin). The timer only keeps
           "Saving…" on screen and rereads the engine when it expires. */
        buildSaveState: function () {
            var s = el('span', 'vo-hd-state', {role: 'status'});
            this.hdr.state = s;
            this.saveFlags = {modified: false, saving: false};
            this.saveKey = null;
            this.saveHeld = false;
            this.setSaveState({});
            return s;
        },

        isSaveAction: function (id) {
            var A = window.Asc && Asc.c_oAscAsyncAction;
            return !!A && id != null && (id === A['Save'] || id === A['ForceSaveButton']);
        },

        engineModified: function () {
            var api = this.api;
            if (!api) return false;
            try {
                if (typeof api.asc_isDocumentModified === 'function') return !!api.asc_isDocumentModified();
                if (typeof api.isDocumentModified === 'function') return !!api.isDocumentModified();
            } catch (e) { /* the engine is not ready yet — consider there is nothing unsaved */ }
            return false;
        },

        syncSaveState: function () {
            this.setSaveState({modified: this.engineModified()});
        },

        setSaveState: function (flags) {
            var me = this, s = this.hdr && this.hdr.state;
            if (!s || !this.saveFlags) return;
            _.extend(this.saveFlags, flags || {});
            if (flags && flags.saving) {
                this.saveHeld = true;
                clearTimeout(this.saveHoldTimer);
                this.saveHoldTimer = setTimeout(guarded('shell: save state hold', function () {
                    me.saveHeld = false;
                    me.syncSaveState();
                }), SAVE_HOLD_MS);
            }
            var key = (this.saveFlags.saving || this.saveHeld) ? 'saving' : (this.saveFlags.modified ? 'dirty' : 'saved');
            if (key === this.saveKey) return;
            this.saveKey = key;
            var t = key === 'saving' ? this.textSaving : key === 'dirty' ? this.textUnsaved : this.textSaved;
            s.classList.remove('saved', 'saving', 'dirty');
            s.classList.add(key);
            if (key === 'saved') s.innerHTML = icon('accept', 18);
            else s.textContent = t;
            s.setAttribute('title', t);
            s.setAttribute('aria-label', t);
        },

        /* --- Version history and access --------------------------------------- */
        /* The capability — the stock condition for the "Collaboration" buttons
           (lib/view/ReviewChanges.js): history — canUseHistory, access —
           the onRequestSharingSettings handler or an access settings address.
           Read at build and once more at the moment of the press. */
        canHistory: function () {
            return !!this.stockOptions().canUseHistory;
        },

        canSharing: function () {
            var o = this.stockOptions();
            return !!(o.canRequestSharingSettings || (o.sharingSettingsUrl && o.sharingSettingsUrl.length));
        },

        buildCollabButton: function (kind) {
            var me = this, spec = COLLAB[kind], tip = this[spec.tip];
            var b = el('button', 'vo-ib vo-hd-' + kind + (spec.cls ? ' ' + spec.cls : ''),
                       {type: 'button', title: tip, 'aria-label': tip, 'aria-disabled': 'false'});
            b.innerHTML = icon(spec.icon);
            b.addEventListener('click', guarded('shell: header ' + kind, function () { me.runCollab(kind); }));
            this.hdr.collab[kind] = b;
            return b;
        },

        runCollab: function (kind) {
            var can = kind === 'history' ? this.canHistory() : this.canSharing();
            if (!can || this.collabLocked(kind)) { this.applyCollabLock(); return; }
            this.closeHeaderPops();
            Common.NotificationCenter.trigger(COLLAB[kind].note);
        },

        /* The lock — from the "Collaboration" button; the tab is not built —
           by the stock sign of connection loss. */
        collabLocked: function (kind) {
            var b = bridge();
            var st = b && typeof b.state === 'function' ? b.state(COLLAB[kind].twin) : {exists: false};
            if (st.exists) return !!st.disabled;
            var main = controller('Main');
            return !!(main && main._state && main._state.isDisconnected);
        },

        /* The lock look — by a class and aria-disabled, not the disabled attribute: on a
           disabled button the browser does not send click, and the second end of the gate on
           the press would not be checked. */
        applyCollabLock: function () {
            var me = this, btns = (this.hdr && this.hdr.collab) || {};
            Object.keys(btns).forEach(function (kind) {
                var lock = me.collabLocked(kind);
                btns[kind].classList.toggle('vo-locked', lock);
                btns[kind].setAttribute('aria-disabled', lock ? 'true' : 'false');
            });
        },

        /* --- "Download ▾" ---------------------------------------------------- */

        /* Stock visibility of the "File" counterpart. There is no counterpart yet ("File" is not
           rendered) — the right decides. */
        twinShown: function (ref) {
            var b = bridge();
            var st = b && typeof b.state === 'function' ? b.state(ref) : {exists: false};
            return !st.exists || !!st.visible;
        },

        /* Menu groups: formats and print. Without the right the item is not drawn, an empty
           group too; a separator stands only between two groups. */
        downloadGroups: function () {
            var me = this, o = this.stockOptions(), b = bridge();
            var preview = b && typeof b.state === 'function' ? b.state(TWIN_PRINT_PREVIEW) : {};
            var groups = [];
            if (o.canDownload && this.twinShown(TWIN_DOWNLOAD)) {
                groups.push(DOWNLOADS.map(function (d) {
                    return {t: me[d.t], i: 'download', run: function () { me.download(d.type); }};
                }));
            }
            if (o.canPrint && (this.twinShown(TWIN_PRINT) || (preview.exists && preview.visible))) {
                groups.push([{t: me.textPrint, i: 'print', run: function () { me.print(); }}]);
            }
            return groups;
        },

        /* Download — the stock handler of the "Download as" panel of the "File"
           (controller/LeftMenu.js clickSaveAsFormat: asc_DownloadAs with the format).
           The miDownload item itself only opens this panel, and clicks on the
           "File" items are caught by its markup, not by the item object. */
        download: function (type) {
            var lm = controller('LeftMenu'), types = window.Asc && Asc.c_oAscFileType;
            if (!lm || typeof lm.clickSaveAsFormat !== 'function' || !types || types[type] === undefined) return;
            lm.clickSaveAsFormat(SAVE_AS_MENU, types[type]);
        },

        /* Print — the way of the ribbon print button and Ctrl+P (controller/LeftMenu.js
           clickToolbarPrint: print preview where there is one, otherwise the "Print"
           item of the "File" — clickMenuFileItem(null, 'print')). */
        print: function () {
            var lm = controller('LeftMenu');
            if (!lm) return;
            if (typeof lm.clickToolbarPrint === 'function') lm.clickToolbarPrint();
            else if (typeof lm.clickMenuFileItem === 'function') lm.clickMenuFileItem(null, 'print');
        },

        /* The button is an AIR icon in the outline style; the tooltip — the phrase of the download
           button of the stock header (lib/view/Header.js, tipDownload): its
           translation already exists in all editor languages. */
        buildDownload: function () {
            var me = this, groups = this.downloadGroups();
            if (!groups.length) return null;
            var stock = Common.Views && Common.Views.Header && Common.Views.Header.prototype;
            var tip = (stock && stock.tipDownload) || this.tipDownload;
            var wrap = el('span', 'vo-pop-wrap vo-download');
            var btn = el('button', 'vo-ib vo-outlined',
                         {type: 'button', title: tip, 'aria-label': tip, 'aria-haspopup': 'menu', 'aria-expanded': 'false'});
            btn.innerHTML = icon('download');
            var pop = el('div', 'vo-pop vo-pop-list', {role: 'menu', 'aria-label': tip});
            var items = [], ctl = null;
            groups.forEach(function (g, n) {
                if (n) pop.appendChild(el('div', 'vo-pop-sep', {role: 'separator'}));
                g.forEach(function (it) {
                    var row = el('button', 'vo-pop-item', {type: 'button', role: 'menuitem', tabindex: '-1'});
                    var i = el('span', 'vo-pop-i');
                    i.innerHTML = icon(it.i);
                    var t = el('span', 'vo-pop-t');
                    t.textContent = it.t;
                    row.appendChild(i);
                    row.appendChild(t);
                    row.addEventListener('click', guarded('shell: download item', function () {
                        ctl.close();
                        it.run();
                        Common.NotificationCenter.trigger('edit:complete');
                    }));
                    items.push(row);
                    pop.appendChild(row);
                });
            });
            wrap.appendChild(btn);
            wrap.appendChild(pop);
            ctl = this.popover(wrap, btn, pop, items);
            this.hdr.download = wrap;
            return wrap;
        },

        /* --- Mode switcher ------------------------------------------- */
        /* Only with the edit right, as in documents: a reader has nowhere
           to switch. It is switched by the mode zone (CompactModes.setMode) — it
           changes the mode and announces it with the vo:mode notification; the switcher
           look follows the notification, not the click. */
        buildModeSwitch: function () {
            if (!this.editRight()) return null;
            var me = this, ui = {items: {}};
            var wrap = el('span', 'vo-pop-wrap vo-docmode');
            var btn = el('button', 'vo-mode accent', {type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false'});
            var label = el('span', 'vo-mode-label');
            var caret = el('span', 'vo-heading-caret');
            caret.innerHTML = icon('chevron', 16);
            btn.appendChild(label);
            btn.appendChild(caret);
            var pop = el('div', 'vo-pop vo-pop-list vo-pop-rich', {role: 'menu'});
            var items = [];
            MODES.forEach(function (m) {
                var row = el('button', 'vo-pop-item',
                             {type: 'button', role: 'menuitemradio', tabindex: '-1', 'data-mode': m.v, 'aria-checked': 'false'});
                var i = el('span', 'vo-pop-i');
                i.innerHTML = icon(m.i);
                var text = el('span', 'vo-pop-text');
                var t = el('span', 'vo-pop-t');
                t.textContent = me[m.t];
                var d = el('span', 'vo-pop-d');
                d.textContent = me[m.d];
                text.appendChild(t);
                text.appendChild(d);
                var chk = el('span', 'vo-pop-check');
                chk.innerHTML = icon('checkMenu', 18);
                row.appendChild(i);
                row.appendChild(text);
                row.appendChild(chk);
                row.addEventListener('click', guarded('shell: mode item', function () {
                    ui.ctl.close();
                    me.switchMode(m.v);
                    Common.NotificationCenter.trigger('edit:complete');
                }));
                ui.items[m.v] = row;
                items.push(row);
                pop.appendChild(row);
            });
            wrap.appendChild(btn);
            wrap.appendChild(pop);
            ui.wrap = wrap;
            ui.btn = btn;
            ui.label = label;
            ui.ctl = this.popover(wrap, btn, pop, items);
            /* A locked switcher does not open the list — neither by click nor from the
               keyboard (popover calls ctl.open()). */
            var open = ui.ctl.open;
            ui.ctl.open = function () {
                if (me.modeLocked()) { me.applyModeLock(); return; }
                open.apply(this, arguments);
            };
            this.hdr.mode = ui;
            this.applyModeLook(this.currentMode());
            this.applyModeLock();
            return wrap;
        },

        canRequestEdit: function () {
            if (this.editRequestRevoked || this.editRight() || !this.wanted()) return false;
            var main = controller('Main'), o = this.stockOptions();
            return !!main && typeof main.markEditRequest === 'function' && typeof main.isEditRequestWaiting === 'function' &&
                !o.isEdit && !!o.canEdit && !!o.canRequestEditRights;
        },

        editRequestItem: function () {
            var actions = PE.Views.SlideActions;
            var groups = actions && typeof actions.groups === 'function' && actions.groups();
            return (groups && groups[0] && _.find(groups[0].items, function (it) {
                return it && it.k === 'requestEdit';
            })) || null;
        },

        buildEditButton: function () {
            if (!this.canRequestEdit()) return null;
            var me = this, actions = PE.Views.SlideActions, item = this.editRequestItem();
            var button = el('button', 'vo-mode accent canfocused', {type: 'button'});
            button.textContent = this.textEdit;
            if (item && typeof actions.label === 'function') button.setAttribute('title', actions.label(item));
            button.addEventListener('mousedown', function () { me.engineKeys(false); });
            button.addEventListener('focus', function () { me.engineKeys(false); });
            button.addEventListener('focusout', function (e) {
                if (!me.inHeader(e.relatedTarget)) me.engineKeys(true);
            });
            button.addEventListener('click', guarded('shell: header edit request', function (e) {
                e.stopPropagation();
                me.runEditRequest();
            }));
            this.hdr.edit = button;
            this.applyEditButtonLock();
            return button;
        },

        bindEditButtonFocus: function () {
            var me = this, menu = PE.Views.SlideActions && PE.Views.SlideActions.menu;
            if (!menu || !menu.el || this.editFocusMenu === menu.el) return;
            this.editFocusMenu = menu.el;
            menu.el.addEventListener('focusout', function (e) {
                var button = me.hdr && me.hdr.edit;
                if (!button || e.relatedTarget !== button) return;
                // The menu releases SDK input before the native Tab transfer completes.
                setTimeout(guarded('shell: edit focus handoff', function () {
                    var active = document.activeElement;
                    if (me.advanced || !me.wanted() || me.showRunning() || me.modalOpen() ||
                        !document.body.contains(button) || !active || active.id !== 'area_id') return;
                    button.focus();
                }), 0);
            }, true);
        },

        editButtonLocked: function (item) {
            var actions = PE.Views.SlideActions;
            if (!this.canRequestEdit() || this.modeLocked() || !actions || typeof actions.itemState !== 'function' ||
                typeof actions.exec !== 'function' || typeof actions.closeMenu !== 'function') return true;
            if (item === undefined) item = this.editRequestItem();
            return !item || actions.itemState(item, this).disabled;
        },

        applyEditButtonLock: function () {
            var button = this.hdr && this.hdr.edit;
            if (!button) return;
            var lock = this.showRunning() || this.editButtonLocked();
            button.classList.toggle('vo-locked', lock);
            button.setAttribute('aria-disabled', lock ? 'true' : 'false');
        },

        runEditRequest: function () {
            var button = this.hdr && this.hdr.edit;
            if (!button) return false;
            var active = !this.advanced && !this.startupFailed && document.body.classList.contains('vo-compact');
            try {
                if (!active || this.showRunning() || this.modalOpen()) return false;
                var actions = PE.Views.SlideActions, item = this.editRequestItem();
                if (this.editButtonLocked(item)) return false;
                actions.closeMenu();
                this.closeHeaderPops();
                this.closeToolbarLayer();
                if (document.activeElement === button) this.engineKeys(false);
                return actions.exec(item, this, button);
            } finally {
                this.applyEditButtonLock();
                if (!this.advanced && !this.startupFailed && document.body.classList.contains('vo-compact') &&
                    document.activeElement === button) this.engineKeys(false);
            }
        },

        currentMode: function () {
            var m = modes();
            return m && typeof m.mode === 'function' && m.mode() === 'view' ? 'view' : 'edit';
        },

        switchMode: function (mode) {
            var m = modes();
            if (!this.editRight() || this.modeLocked() || !m || typeof m.setMode !== 'function') return;
            m.setMode(mode);
        },

        /* The switcher is locked by the stock editing lock and a co-authoring break —
           as in documents, where for the same reasons the stock mode button
           is disabled (their docModeLocked). In version history the engine shows
           the version read-only: there is nothing for "Viewing" to switch, and
           "Editing" would offer editing a version. */
        modeLocked: function () {
            if (this.lockState().on) return true;
            var main = controller('Main');
            return !!(main && main._state && main._state.isDisconnected);
        },

        /* The lock look — by a class and aria-disabled, not the disabled attribute: on a
           disabled button the browser does not send click, and the second end of the gate
           (switchMode) would not be checked. The caption is the previous mode, shown as disabled. */
        applyModeLock: function () {
            var ui = this.hdr && this.hdr.mode;
            if (!ui) return;
            var lock = this.modeLocked();
            ui.btn.classList.toggle('vo-locked', lock);
            ui.btn.setAttribute('aria-disabled', lock ? 'true' : 'false');
            if (lock && ui.ctl.isOpen()) ui.ctl.close();
        },

        applyModeLook: function (mode) {
            var ui = this.hdr && this.hdr.mode;
            if (!ui) return;
            if (mode !== 'edit' && mode !== 'view') mode = this.currentMode();
            var cur = _.find(MODES, function (m) { return m.v === mode; });
            ui.label.textContent = this[cur.t];
            ui.btn.setAttribute('title', this[cur.d]);
            _.each(ui.items, function (row, v) {
                var on = v === mode;
                row.classList.toggle('on', on);
                row.setAttribute('aria-checked', on ? 'true' : 'false');
            });
        },

        /* The edit right is revoked (collaboration:sharingdeny): there is no mode
           switcher any more, the name is closed. */
        dropEditRightControls: function () {
            var ui = this.hdr && this.hdr.mode;
            if (ui) {
                ui.ctl.close();
                ui.wrap.parentNode && ui.wrap.parentNode.removeChild(ui.wrap);
                this.pops = _.without(this.pops || [], ui.ctl);
                this.hdr.mode = null;
            }
            this.applyRenameRight();
        },

        /* --- Slide Show ---------------------------------------------------- */
        /* A two-part button: the main part — show from the current slide (the stock
           click of the counterpart: Toolbar/Statusbar onPreviewBtnClick), ▾ — a snapshot
           of the stock menu of the counterpart at the moment of opening; choosing a row — the stock
           click of its item (onPreviewItemClick). The show, the presenter window and
           the settings dialog are stock: the button has no surface of its own and no
           engine calls of its own. */
        show: null,          // {wrap, main, arrow, pop, items, ctl, ref, unwatch}

        buildShow: function () {
            var me = this, stock = this.stockPreviewTexts();
            var ui = {items: [], ref: null, unwatch: null};
            var wrap = el('span', 'vo-show', {'data-vo': 'show'});
            var main = el('button', 'vo-show-main', {type: 'button', title: stock.tipPreview || this.tipSlideShow});
            var play = el('span', 'vo-show-i');
            play.innerHTML = icon('play', 16);
            var label = el('span', 'vo-show-label');
            label.textContent = this.textSlideShow;
            main.appendChild(play);
            main.appendChild(label);
            var arrow = el('button', 'vo-show-arrow',
                           {type: 'button', title: this.textShowMenu_ARIA, 'aria-label': this.textShowMenu_ARIA,
                            'aria-haspopup': 'menu', 'aria-expanded': 'false'});
            arrow.innerHTML = icon('chevron', 16);
            var pop = el('div', 'vo-show-pop', {role: 'menu', 'aria-label': this.textShowMenu_ARIA});
            wrap.appendChild(main);
            wrap.appendChild(arrow);
            wrap.appendChild(pop);

            main.addEventListener('click', guarded('shell: show', function () {
                ui.ctl.close(null);
                me.startShow();
            }));
            ui.wrap = wrap;
            ui.main = main;
            ui.arrow = arrow;
            ui.pop = pop;
            this.show = ui;
            /* The list is a snapshot of the stock menu at the moment of opening: by click, Enter,
               space and arrows (popover calls ctl.open()). A disabled
               counterpart does not open the list. */
            ui.ctl = this.popover(wrap, arrow, pop, ui.items);
            var open = ui.ctl.open;
            ui.ctl.open = function () {
                if (me.showLocked()) return;
                me.fillShow();
                open.apply(this, arguments);
            };
            this.placeShow();
            this.applyShowState();
            return wrap;
        },

        /* The place and the counterpart are recomputed when the visibility of rows changes
           (the panel is hidden or returned, the right revoked) and the mode. */
        bindShow: function () {
            var me = this, nc = Common.NotificationCenter, m = modes();
            var sync = function () {
                me.placeShow();
                me.applyShowState();
            };
            nc.on('shell:toolbar', guarded('shell: show shell:toolbar', sync));
            nc.on((m && m.MODE_EVENT) || 'vo:mode', guarded('shell: show vo:mode', sync));
        },

        /* Captions of the stock show menu: the translation already exists in all languages. */
        stockPreviewTexts: function () {
            var v = PE.Views.Toolbar;
            return (v && v.prototype) || {};
        },

        /* Counterpart by mode and right: in "Editing" with the edit right —
           the ribbon button, otherwise — the status bar button. */
        showTwin: function () {
            var b = bridge();
            if (this.editRight() && this.currentMode() !== 'view' && b && typeof b.twin === 'function' && b.twin(SHOW_EDIT))
                return SHOW_EDIT;
            return SHOW_VIEW;
        },

        showLocked: function () {
            var b = bridge(), ui = this.show;
            var st = b && typeof b.state === 'function' && ui && ui.ref ? b.state(ui.ref) : {exists: false};
            return !st.exists || !!st.disabled;
        },

        /* With the panel — into #vo-tb-end before its last node (the focus chevron),
           without the panel — first in #vo-hdr-show. There is one node: it moves, not
           copied. An open list closes on the move. If there is no suitable
           place (the panel is not built) — the button stays where it was. */
        placeShow: function () {
            var ui = this.show;
            if (!ui) return;
            var wrap = ui.wrap, end = this.hasToolbar();
            var host = byId(end ? TB_END_ID : HDR_SHOW_ID);
            if (!host) return;
            var list = Array.prototype.slice.call(host.children || []);
            var others = _.without(list, wrap);
            var want = end ? Math.max(others.length - 1, 0) : 0;
            if (list.indexOf(wrap) === want) return;
            ui.ctl.close();
            host.insertBefore(wrap, end ? (others[others.length - 1] || null) : (others[0] || null));
        },

        /* Availability — from the counterpart. A counterpart change resets the watch. */
        applyShowState: function () {
            var me = this, ui = this.show, b = bridge();
            if (!ui) return;
            var ref = this.showTwin();
            if (ref !== ui.ref) {
                ui.unwatch && ui.unwatch();
                ui.ref = ref;
                ui.unwatch = b && typeof b.watch === 'function'
                    ? b.watch(ref, guarded('shell: show twin', function () { me.applyShowState(); }))
                    : null;
                ui.ctl.close();
            }
            var off = this.showLocked();
            [ui.main, ui.arrow].forEach(function (n) {
                n.classList.toggle('vo-locked', off);
                n.setAttribute('aria-disabled', off ? 'true' : 'false');
            });
            if (off) ui.ctl.close();
        },

        startShow: function () {
            var b = bridge(), ui = this.show;
            if (!b || !ui || this.showLocked()) return false;
            return b.run(ui.ref);
        },

        /* The list rows are a snapshot of the stock menu of the counterpart. The status bar
           button has no "Show Settings": the row stands in the same place, disabled with
           the reason of the mode (CompactModes.reason) or of the right (SlideActions). */
        fillShow: function () {
            var me = this, ui = this.show, b = bridge(), ref = ui.ref;
            var pop = ui.pop;
            while (pop.firstChild) pop.removeChild(pop.firstChild);
            ui.items.length = 0;
            var rows = b && typeof b.mirror === 'function' ? b.mirror(ref) : [];
            rows.forEach(function (r) {
                if (r.sep) { pop.appendChild(el('div', 'vo-show-sep', {role: 'separator'})); return; }
                if (r.sub || r.gallery) return;
                me.showRow(r.caption, r.disabled ? {} : null, function () { b.pick(ref, r.id); });
            });
            if (ref !== SHOW_EDIT) {
                if (ui.items.length) pop.appendChild(el('div', 'vo-show-sep', {role: 'separator'}));
                me.showRow(this.showSettingsCaption(), {reason: this.showSettingsReason()}, null);
            }
        },

        showRow: function (caption, off, run) {
            var ui = this.show;
            var row = el('button', 'vo-show-item', {type: 'button', role: 'menuitem', tabindex: '-1'});
            var t = el('span', 'vo-show-t');
            t.textContent = caption;
            row.appendChild(t);
            row.setAttribute('aria-disabled', off ? 'true' : 'false');
            if (off) {
                row.classList.add('vo-locked');
                if (off.reason) {
                    row.setAttribute('title', off.reason);
                    row.setAttribute('aria-description', off.reason);
                }
            }
            row.addEventListener('click', guarded('shell: show item', function () {
                if (off || !run) return;
                /* Keyboard to the engine before launch: the show and the dialog wait for it. */
                ui.ctl.close(null);
                run();
            }));
            ui.items.push(row);
            ui.pop.appendChild(row);
            return row;
        },

        showSettingsCaption: function () {
            var b = bridge(), item = b && typeof b.twin === 'function' ? b.twin(SHOW_SETTINGS) : null;
            var c = item && (item.caption || (item.options && item.options.caption));
            return c || this.stockPreviewTexts().textShowSettings || this.textShowSettings;
        },

        showSettingsReason: function () {
            var acts = PE.Views.SlideActions, st = null;
            try { st = acts && typeof acts.itemState === 'function' ? acts.itemState({edit: true}, this) : null; } catch (e) { st = null; }
            return (st && st.reason) || null;
        },

        /* --- Focus mode and "Hide Toolbar" -------------------- */
        /* Focus collapses the header and the menu row, the panel stays; without a panel
           (no edit right, "Viewing") everything is collapsed — with the header goes
           "Slide Show ▾" too. "Hide Toolbar" hides only
           the panel, the show button moves to the header (placeShow on
           shell:toolbar). Both are row owners (focus, hidden): each
           removes only its own reason, the right and "Viewing" do not touch them.
           Mutually exclusive: together they would remove both the header and the panel with
           the chevron — there would be no way back except Esc. */
        showing: false,      // the stock slide show is running (preview:show … preview:hide)

        focusOn: function () {
            return !!(this.rows && this.rows.header && this.rows.header.focus);
        },

        toolbarHidden: function () {
            return !!(this.rows && this.rows.toolbar && this.rows.toolbar.hidden);
        },

        /* Commands of the chevron and of the "View" menu items. After them the keyboard is again with
           the engine (the stock edit:complete): otherwise focus would stay on the chevron,
           and Esc would not reach the engine — neither leaving the text nor clearing
           the selection. */
        toggleFocus: function () {
            this.setChrome(!this.focusOn(), false);
            Common.NotificationCenter.trigger('edit:complete');
        },

        toggleToolbar: function () {
            this.setChrome(false, !this.toolbarHidden());
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* First what is being turned off is removed: the panel returns before
           the header collapses — the show button does not land in a collapsed header
           halfway. Header lists are closed before collapsing. */
        setChrome: function (focus, hidden) {
            if (focus) this.closeHeaderPops();
            if (!hidden) this.setRow('toolbar', true, 'hidden');
            this.setRow('header', !focus, 'focus');
            this.setRow('menubar', !focus, 'focus');
            if (hidden) this.setRow('toolbar', false, 'hidden');
            this.applyFocusLook();
        },

        /* The chevron is the last node of #vo-tb-end (put there by the panel): pressed while
           focus is on; the icon turn — the panel styles (.vo-focus-btn.on). */
        applyFocusLook: function () {
            var end = byId(TB_END_ID), on = this.focusOn();
            var btn = end && _.find(end.children || [], function (n) { return n.getAttribute('data-vo') === 'focus'; });
            if (!btn) return;
            btn.classList.toggle('on', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        },

        /* --- Esc ------------------------------------------------------------- */
        /* Outside the show one press is one action, top to bottom: an open menu
           or popup panel → text input → object selection → leaving
           focus. The text and the selection are cleared by the engine itself, so the listener
           stands on document in the capture phase: the state is read before
           the engine changes it, — otherwise one press would both clear the selection and
           turn focus off. What is closed here goes no further (preventDefault and
           stopPropagation): the engine will not leave the text under a closed menu.
           A press already taken by another handler (defaultPrevented —
           the menu row closes itself), is not touched. During the show,
           over a modal window and in the "Stock interface" Esc is stock. */
        bindEscape: function () {
            var me = this, nc = Common.NotificationCenter;
            nc.on('preview:show', guarded('shell: preview:show', function () {
                me.showing = true;
                me.applyEditButtonLock();
            }));
            nc.on('preview:hide', guarded('shell: preview:hide', function () {
                me.showing = false;
                me.applyEditButtonLock();
            }));
            if (typeof document.addEventListener === 'function')
                document.addEventListener('keydown', guarded('shell: escape', function (e) { me.onEscape(e); }), true);
        },

        onEscape: function (e) {
            if (!e || (e.key !== 'Escape' && e.keyCode !== 27) || e.ctrlKey || e.altKey || e.metaKey) return;
            if (this.advanced || e.defaultPrevented || this.showRunning() || this.modalOpen()) return;
            var t = e.target || null;
            /* A header list that has focus closes itself (popover). */
            if (_.some(this.pops || [], function (p) { return p.isOpen() && t && p.wrap.contains(t); })) return;
            if (this.closeLayer(t)) {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                if (typeof e.stopPropagation === 'function') e.stopPropagation();
                return;
            }
            if (this.ownField(t)) return;
            var sel = PE.Views.SlideSelection;
            if (sel && typeof sel.kind === 'function' && sel.kind() !== 'none') return;
            if (this.focusOn()) this.setChrome(false, this.toolbarHidden());
        },

        /* Close the topmost open shell layer; true — there was something to close. */
        closeLayer: function (t) {
            var acts = PE.Views.SlideActions;
            if (acts && typeof acts.isMenuOpen === 'function' && acts.isMenuOpen()) {
                acts.closeMenu();
                return true;
            }
            if (_.some(this.pops || [], function (p) { return p.isOpen(); })) {
                this.closeHeaderPops();
                return true;
            }
            if (this.closeToolbarLayer()) return true;
            var status = PE.Views.CompactStatus;
            if (status && status.pop && typeof status.closeLanguages === 'function') {
                status.closeLanguages();
                return true;
            }
            /* A stock menu (context, gallery): focus in it — Esc is its;
               otherwise we close it, as the stock DocumentHolder does. */
            if (this.stockMenuOpen() && !(t && typeof t.closest === 'function' && t.closest('.dropdown-menu'))) {
                var mm = Common.UI && Common.UI.Menu && Common.UI.Menu.Manager;
                if (mm && typeof mm.hideAll === 'function') { mm.hideAll(); return true; }
            }
            /* The section popup panel (SlideSections) — last: its menus,
               palettes and galleries close before it (a stock menu with focus
               inside closes itself — the panel stays). An input field outside
               the panel (search, comment) takes Esc for itself: the panel stays. */
            var sections = PE.Views.SlideSections;
            if (sections && typeof sections.isOpen === 'function' && sections.isOpen() && !this.stockMenuOpen()) {
                var card = typeof sections.card === 'function' ? sections.card() : null;
                if (this.ownField(t) && !(card && typeof card.contains === 'function' && card.contains(t))) return false;
                sections.close('escape');
                return true;
            }
            return false;
        },

        /* Panel layers: the shown stock gallery, then the most nested
           open panel (a palette inside "Text ▾" — before "Text ▾" itself),
           then "⋯". */
        closeToolbarLayer: function () {
            var b = bridge(), tb = PE.Views.CompactToolbar;
            if (b && typeof b.galleryOpen === 'function' && b.galleryOpen()) {
                b.closeGallery('escape');
                return true;
            }
            if (!tb) return false;
            var open = _.filter(tb.pops || [], function (w) {
                return !!w && !!w.parentNode && w.classList.contains('open');
            });
            var top = _.find(open, function (w) {
                return !_.some(open, function (x) { return x !== w && w.contains(x); });
            });
            if (top && typeof tb.setOpen === 'function') {
                tb.setOpen(top, false);
                return true;
            }
            if (typeof tb.moreOpen === 'function' && tb.moreOpen()) {
                tb.closeMore();
                return true;
            }
            return false;
        },

        stockMenuOpen: function () {
            try {
                var list = document.querySelectorAll(STOCK_MENU_OPEN);
                return Array.prototype.some.call(list, function (m) { return m.getClientRects().length > 0; });
            } catch (e) {
                return false;
            }
        },

        /* An input field outside the engine (name, search, comment): Esc is its. */
        ownField: function (t) {
            if (!t || t.nodeType !== 1 || ENGINE_INPUT.test(t.id || '')) return false;
            var tag = String(t.localName || t.tagName || '').toLowerCase();
            return tag === 'input' || tag === 'textarea' || tag === 'select' || !!t.isContentEditable;
        },

        /* The show: by the DocumentPreview notifications and by the stock show
           panel itself (set up by Viewport.onPreviewStart). */
        showRunning: function () {
            if (this.showing) return true;
            try {
                var vp = controller('Viewport'), panel = vp && vp.previewPanel;
                return !!panel && typeof panel.isVisible === 'function' && panel.isVisible() === true;
            } catch (e) {
                return false;
            }
        },

        modalOpen: function () {
            var mw = Common.Utils && Common.Utils.ModalWindow;
            return !!mw && typeof mw.isVisible === 'function' && mw.isVisible() === true;
        },

        /* --- Lists at the header buttons ------------------------------------------ */
        /* Open — the class open on the wrapper. Mouse: a click on the button opens and
           closes, a click outside closes, opening one list closes
           another. Keyboard: Enter, space and ↓ open with focus on the
           marked (or first) row, ↑ — on the last; in the list ↑/↓ in a
           circle, Home and End, Esc closes and returns focus to the button, Tab
           closes. Handled keys go no further: one Esc press —
           one clearing. While focus is at the button or in the list, the engine keyboard
           interception is off (engineKeys). */
        popover: function (wrap, btn, pop, items) {
            var me = this;
            var isOpen = function () { return wrap.classList.contains('open'); };
            var inside = function (n) { return !!n && typeof wrap.contains === 'function' && wrap.contains(n); };
            var focusItem = function (i) {
                var n = items.length;
                if (n) items[((i % n) + n) % n].focus();
            };
            var ctl = {
                wrap: wrap,
                isOpen: isOpen,
                open: function () {
                    me.closeHeaderPops(wrap);
                    wrap.classList.add('open');
                    btn.setAttribute('aria-expanded', 'true');
                    me.engineKeys(false);
                },
                /* to — where focus went (by default — where it is now):
                   the keyboard returns to the engine only when focus is outside the header. */
                close: function (to) {
                    if (isOpen()) {
                        wrap.classList.remove('open');
                        btn.setAttribute('aria-expanded', 'false');
                    }
                    if (!me.inHeader(to === undefined ? document.activeElement : to)) me.engineKeys(true);
                }
            };
            btn.addEventListener('mousedown', function () { me.engineKeys(false); });
            btn.addEventListener('click', guarded('shell: header list', function () {
                if (isOpen()) ctl.close(); else ctl.open();
            }));
            btn.addEventListener('keydown', guarded('shell: header list key', function (e) {
                if (!e || e.ctrlKey || e.metaKey || e.altKey) return;
                var k = e.key;
                if (k === 'Escape') {
                    if (!isOpen()) return;
                    e.preventDefault();
                    e.stopPropagation();
                    ctl.close();
                    return;
                }
                if (k !== 'Enter' && k !== ' ' && k !== 'ArrowDown' && k !== 'ArrowUp') return;
                e.preventDefault();
                e.stopPropagation();
                if (!isOpen()) ctl.open();
                var on = _.find(items, function (x) { return x.classList.contains('on'); });
                if (k === 'ArrowUp') focusItem(-1);
                else if (on) on.focus();
                else focusItem(0);
            }));
            pop.addEventListener('keydown', guarded('shell: header list keys', function (e) {
                if (!e) return;
                var k = e.key, i = items.indexOf(document.activeElement);
                if (k === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    ctl.close();
                    btn.focus();
                    return;
                }
                if (k === 'Tab') { ctl.close(); return; }
                if (i < 0) return;
                if (k === 'ArrowDown') focusItem(i + 1);
                else if (k === 'ArrowUp') focusItem(i - 1);
                else if (k === 'Home') focusItem(0);
                else if (k === 'End') focusItem(-1);
                else return;
                e.preventDefault();
                e.stopPropagation();
            }));
            /* A click on a row does not take focus away from the button or the row. */
            pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
            wrap.addEventListener('focusout', guarded('shell: header list focus', function (e) {
                var to = (e && e.relatedTarget) || null;
                if (!inside(to)) ctl.close(to);
            }));
            this.pops.push(ctl);
            return ctl;
        },

        /* A node in the header or in the show button (it may stand on the panel). */
        inHeader: function (n) {
            var roots = [this.hdr && this.hdr.root, this.show && this.show.wrap];
            return !!n && roots.some(function (root) {
                return !!root && typeof root.contains === 'function' && root.contains(n);
            });
        },

        /* Close the header lists except the one in which the keep node is. */
        closeHeaderPops: function (keep) {
            _.each(this.pops || [], function (p) {
                if (keep && typeof p.wrap.contains === 'function' && p.wrap.contains(keep)) return;
                if (p.isOpen()) p.close();
            });
        },

        /* --- Engine canvas ---------------------------------------------------- */
        /* The thumbnail strip, the margin around the slide, the notes and the presenter window are
           painted by the engine with the skin colors: asc_setSkin(colors). The stock takes them from body with
           Themes.getThemeColors(). The shell palette lies on #editor_sdk under
           body.vo-compact, so on top of the theme snapshot we read #editor_sdk:
           first --vo-skin-<key>, then --<key> — what the canvas itself sees.
           Own prefix — because inside #editor_sdk live the stock
           context menus and tooltips: variables named like the theme's
           would repaint them too. Under a dark interface theme the shell is
           light, and so is the skin: with the dark type the engine draws notes and
           thumbnails in dark mode. In the "Stock interface" — the theme colors. */
        canvasSkin: function () {
            var colors = Common.UI.Themes.getThemeColors(),
                host = byId('editor_sdk');
            if (!host || !document.body.classList.contains('vo-compact')) return colors;
            var style = window.getComputedStyle(host);
            Object.keys(colors).forEach(function (key) {
                if (key === 'type' || key === 'name') return;
                var value = String(style.getPropertyValue(SKIN_PREFIX + key) || '').trim() ||
                            String(style.getPropertyValue('--' + key) || '').trim();
                if (value) colors[key] = value;
            });
            if (colors.type === 'dark') {
                colors.type = 'light';
                colors.name = SKIN_LIGHT;
            }
            return colors;
        },

        applyCanvasSkin: function () {
            var me = this, api = this.api;
            var themes = Common.UI && Common.UI.Themes;
            if (this.startupFailed || !api || !api.asc_setSkin || !themes || !themes.getThemeColors) return;
            var apply = guarded('shell: canvas skin', function () {
                api.asc_setSkin(me.canvasSkin());
            });
            apply();
            /* In development LESS is built in the browser asynchronously: a retry when
               the styles are surely in place. In the build the second call is harmless. */
            clearTimeout(this.skinTimer);
            this.skinTimer = setTimeout(apply, SKIN_RETRY);
        },

        /* --- "Stock interface" --------------------------------------------- */
        /* The modes are mutually exclusive: vo-compact — the shell, vo-advanced —
           the stock ribbon, title, icon column and status bar with
           stock heights. The zones learn about the change from shell:advanced. */
        toggleMode: function () {
            this.advanced = !this.advanced;
            if (this.advanced && this.hdr && this.hdr.edit && document.activeElement === this.hdr.edit) this.engineKeys(true);
            document.body.classList.toggle('vo-compact', !this.advanced);
            document.body.classList.toggle('vo-advanced', this.advanced);
            this.applyLayout(!this.advanced);
            this.applyCanvasSkin();
            this.ensureBackButton();
            Common.NotificationCenter.trigger('shell:advanced', this.advanced);
            if (!this.advanced) this.applyEditButtonLock();
        },

        /* Return from the "Stock interface" — a button in the right group of the stock
           header; no group — a floating button at the window edge. */
        ensureBackButton: function () {
            var me = this, btn = byId(BACK_ID);
            if (!this.advanced) {
                btn && btn.parentNode && btn.parentNode.removeChild(btn);
                return;
            }
            if (btn) return;
            btn = node('button', BACK_ID, 'vo-mode');
            btn.setAttribute('type', 'button');
            btn.setAttribute('title', this.tipBackToCompact);
            btn.textContent = this.textCompact;
            btn.addEventListener('click', guarded('shell: back from the stock interface', function () {
                me.toggleMode();
            }));
            var host = byId('box-right-btn-group');
            if (host) { host.appendChild(btn); return; }
            btn.setAttribute('class', 'vo-mode vo-back-float');
            document.body.appendChild(btn);
        },

        /* --- Texts ------------------------------------------------------------ */
        /* The defaults are English, the translation overlays them from locale/<language>.json. */

        textCompact: 'Compact view',
        textDownloadOdp: 'Download ODP',
        textDownloadPdf: 'Download PDF',
        textDownloadPptx: 'Download PPTX',
        textEdit: 'Edit',
        textModeEdit: 'Editing',
        textModeEditHint: 'Changes are applied immediately',
        textModeView: 'Viewing',
        textModeViewHint: 'The presentation is open for reading',
        textPresentation: 'Presentation',
        textPrint: 'Print',
        textSaved: 'Saved',
        textSaving: 'Saving…',
        textShowMenu_ARIA: 'Slide show options',
        textShowSettings: 'Slide show settings',
        textSlideShow: 'Slide show',
        textUnsaved: 'Unsaved',
        tipBackToCompact: 'Back to the new interface',
        tipDownload: 'Download file',
        tipHistory: 'Version history',
        tipRename: 'Presentation name — can be edited',
        tipRenameDisabled: 'Presentation name (renaming unavailable)',
        tipSharing: 'Sharing settings',
        tipSlideShow: 'Start slideshow'

    }, PE.Views.CompactShell || {});

    return PE.Views.CompactShell;
});
