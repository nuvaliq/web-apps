/*
 * PdfActions — the command catalog of the PDF viewer in the "Compact" shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The "⋮" menu items are in the form of the shared menu bar model
 * (Common.UI.Compact.MenuModel), one section. Each item is a stock action:
 * a press of a stock button through the bridge (StockBridge), a call of a stock
 * controller, a stock notification or an engine call that the stock status bar
 * uses. Visibility is by the appOptions rights (download, rename, comments) and
 * by the document ("Comments" — only if the PDF has comments). Captions are
 * stock phrases where they exist; our own are the texts at the end of the module,
 * the translation is from locale/<language>.json.
 *
 * The same commands are called by the bar buttons (CompactToolbar): download of the
 * original, print, search, zoom, "Full screen".
 *
 * The File screen panels (print, advanced settings, "Download as") open by the
 * stock screen display — showMenu('file:<panel>'), — which the shell routes into
 * windows over the document (FileWindows): the shell has no File screen.
 * The viewer has no help and no version history.
 *
 * Shell commands — rename, the left menu panels, the page number field — go
 * through shell.command(): while a command has no owner, the item is
 * inactive.
 */
define([
    'common/main/lib/view/compact/AboutWindow',
    'common/main/lib/view/compact/DocInfoWindow',
    'pdfeditor/main/app/view/StockBridge'
], function () {
    'use strict';

    if (window.PDFE === undefined) window.PDFE = {};
    if (PDFE.Views === undefined) PDFE.Views = {};

    function ctl(name) {
        try { return (PDFE.getController && PDFE.getController(name)) || null; } catch (e) { return null; }
    }

    function bridge() { return PDFE.Views.StockBridge; }

    /* Caption of the stock code — a locale string on the view prototype or on the
       object itself ('PDFE.Views.FileMenu.btnPrintCaption'). Read on every
       snapshot: the locale is laid out before the controllers load. */
    function stock(path) {
        var parts = path.split('.'), key = parts.pop(), o = window;
        for (var i = 0; i < parts.length && o; i++) o = o[parts[i]];
        if (!o) return '';
        var v = o.prototype && typeof o.prototype[key] === 'string' ? o.prototype[key] : o[key];
        return typeof v === 'string' ? v : '';
    }

    function st(path) { return function () { return stock(path); }; }

    /* An element hidden by the integrator via customization (Common.UI.LayoutManager) — the same
       check as the stock File screen makes (FileMenu.applyMode). */
    function layout(name) {
        var lm = window.Common && Common.UI && Common.UI.LayoutManager;
        return !lm || typeof lm.isElementVisible !== 'function' || lm.isElementVisible(name) !== false;
    }

    /* Our own caption (the default is below, the translation is from the locale). */
    function own(key) { return function () { return PDFE.Views.PdfActions[key]; }; }

    /* The stock clickSaveAsFormat calls menu.hide() after the download: the File
       screen is not open here, the shell closes its own menu by itself. */
    var SAVE_AS_MENU = {hide: function () {}};

    /* Zoom levels — the documents set. A custom zoom from the field is within ZOOM_MIN…ZOOM_MAX
       (the top is the last value of the stock zoom list of the status bar). */
    var ZOOMS = [50, 75, 100, 125, 150, 200];
    var ZOOM_MIN = 10, ZOOM_MAX = 500;

    PDFE.Views.PdfActions = _.extend({

        ZOOMS: ZOOMS,
        ZOOM_MIN: ZOOM_MIN,
        ZOOM_MAX: ZOOM_MAX,

        shell: null,
        api: null,
        zoomNow: null,       // the last asc_onZoomChange: {percent, type}

        init: function (shell, api) {
            var me = this;
            if (api && api !== this.api && typeof api.asc_registerCallback === 'function') {
                api.asc_registerCallback('asc_onZoomChange', function (percent, type) {
                    me.zoomNow = {percent: percent, type: type};
                });
            }
            this.api = api || this.api;
            this.shell = shell || this.shell;
            return this;
        },

        /* --- State ------------------------------------------------------------ */

        options: function () {
            var main = ctl('Main');
            return (main && main.appOptions) || {};
        },

        has: function (method) {
            return !!this.api && typeof this.api[method] === 'function';
        },

        /* The engine zoom: the percent and the type — 0 custom, 1 fit to width, 2 fit to
           page. Before the first event — what the engine returns now. */
        zoomState: function () {
            if (this.zoomNow) return this.zoomNow;
            var api = this.api, percent = 100, type = 0;
            try {
                if (api && typeof api.asc_getZoom === 'function') percent = Math.round(api.asc_getZoom() * 100);
            } catch (e) { percent = 100; }
            return {percent: percent, type: type};
        },

        /* The PDF has bookmarks: the stock asc_onViewerBookmarksUpdate handler
           puts them into Navigation._viewerNavigationObject (null without bookmarks). */
        hasOutline: function () {
            var nav = ctl('Navigation'), list = nav && nav._viewerNavigationObject;
            return !!(list && list.length);
        },

        canDownload: function () { return !!this.options().canDownload; },
        canPrint: function () { return !!this.options().canPrint; },
        canRename: function () { var o = this.options(); return !!o.canRename && !o.isDesktopApp; },
        canComments: function () { var o = this.options(); return !!o.canViewComments && !o.isLightVersion; },

        /* The PDF has comments: the stock comments collection is not empty (those hidden
           by the stock filter do not count). */
        hasComments: function () {
            var list = null;
            try { list = window.PDFE && typeof PDFE.getCollection === 'function' ? PDFE.getCollection('Common.Collections.Comments') : null; } catch (e) { list = null; }
            if (!list || !list.length) return false;
            if (typeof list.some !== 'function') return true;
            return list.some(function (m) { return !(m && typeof m.get === 'function' && m.get('hide')); });
        },
        canThumbnails: function () { return this.options().canUseThumbnails !== false; },

        /* "Document info" and "Advanced settings": the stock File screen items follow
           toolbar-file-info and toolbar-file-settings of the customization. */
        canInfo: function () { return layout('toolbar-file-info'); },
        canSettings: function () { return layout('toolbar-file-settings'); },

        /* "About": the stock button is hidden by customization.about — false or {visible: false}
           (Common.Utils.applyCustomization). The stock code settles the value on start (the
           branding right, the desktop app), the options hold the settled one. */
        canAbout: function () {
            var c = this.options().customization, about = c && c.about;
            return !(about === false || (!!about && about.visible === false));
        },

        twin: function (ref) {
            var b = bridge();
            return b && typeof b.state === 'function' ? b.state(ref) : {exists: false, disabled: true, pressed: false};
        },

        /* The "disabled without a text" reason: there is no stock button or it is disabled. */
        twinOff: function (ref) {
            var s = this.twin(ref);
            return !s.exists || s.disabled ? true : null;
        },

        press: function (ref) {
            var b = bridge();
            return !!b && typeof b.run === 'function' && b.run(ref);
        },

        command: function (name) {
            var shell = this.shell;
            return shell && typeof shell.command === 'function' ? shell.command(name) : function () {};
        },

        hasCommand: function (name) {
            var shell = this.shell;
            return !!shell && typeof shell.hasCommand === 'function' && shell.hasCommand(name);
        },

        /* The keyboard is back with the engine: the stock edit:complete after a command. */
        done: function () {
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* --- Commands --------------------------------------------------------- */

        /* The original PDF — the stock path of downloading the source (clickSaveAsFormat
           without a format: asc_DownloadOrigin); a format — the same handler with a format,
           as for the "Download as" panel of the File screen. */
        download: function (type) {
            var lm = ctl('LeftMenu');
            if (!lm || typeof lm.clickSaveAsFormat !== 'function') return;
            if (type === undefined) { lm.clickSaveAsFormat(undefined, undefined); return; }
            var types = window.Asc && Asc.c_oAscFileType;
            if (!types || types[type] === undefined) return;
            lm.clickSaveAsFormat(SAVE_AS_MENU, types[type]);
        },

        /* A File screen panel ("Other formats…" — 'saveas', "Advanced
           settings" — 'opts') — by the stock screen display; in the shell it opens
           the panel window (FileWindows). */
        showFile: function (panel) {
            var lm = ctl('LeftMenu'), view = lm && lm.leftMenu;
            if (view && typeof view.showMenu === 'function') view.showMenu('file:' + panel);
        },

        /* Print — the path of the ribbon print button and Ctrl+P: the stock file:print
           (LeftMenu.clickToolbarPrint — the print panel of the File screen; in the shell —
           the print window). */
        print: function () {
            Common.NotificationCenter.trigger('file:print');
        },

        sharing: function () {
            Common.NotificationCenter.trigger('collaboration:sharing');
        },

        /* The search bar (Ctrl+F): visible — close it with the stock hide, otherwise — the stock
           search:show. */
        searchBarShown: function () {
            var vp = ctl('Viewport');
            return !!vp && typeof vp.isSearchBarVisible === 'function' && !!vp.isSearchBarVisible();
        },

        toggleSearchBar: function () {
            var vp = ctl('Viewport');
            if (this.searchBarShown()) vp.searchBar.hide();
            else Common.NotificationCenter.trigger('search:show');
        },

        zoomTo: function (percent) {
            if (this.has('zoom')) this.api.zoom(percent);
        },

        /* A custom zoom from the field: a number with "%" or without, a comma or a dot; out of
           bounds — the nearest bound. Not a number — null. */
        parseZoom: function (text) {
            var m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(String(text == null ? '' : text));
            if (!m) return null;
            var v = Math.round(parseFloat(m[1].replace(',', '.')));
            if (!isFinite(v)) return null;
            return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
        },

        /* Fit to width or the whole page — the calls of the stock status bar. */
        zoomFit: function (kind) {
            var method = kind === 'page' ? 'zoomFitToPage' : 'zoomFitToWidth';
            if (this.has(method)) this.api[method]();
        },

        /* The left menu panels (comments, page thumbnails, bookmarks) are opened by the frame:
           the shell has no icon column, the frame shows the area. Without the frame —
           the stock button. */
        leftPanel: function (name, ref) {
            if (this.hasCommand('leftPanel')) this.command('leftPanel')(name);
            else this.press(ref);
        },

        /* "Full screen" — the full screen mode of the editor window. The browser does not allow it
           everywhere (a window in a frame without permission): then there is no item and no button.
           Outside the browser (the catalog is read without a page too) there is no document — and no
           mode either. */
        fullscreenAvailable: function () {
            var d = typeof document !== 'undefined' ? document : null;
            return !!d && !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
        },

        fullscreenOn: function () {
            var d = typeof document !== 'undefined' ? document : null;
            return !!d && !!(d.fullscreenElement || d.webkitFullscreenElement);
        },

        toggleFullscreen: function () {
            var d = document, root = d.documentElement;
            try {
                if (this.fullscreenOn()) {
                    (d.exitFullscreen || d.webkitExitFullscreen).call(d);
                } else if (root.requestFullscreen) {
                    var p = root.requestFullscreen();
                    if (p && typeof p.catch === 'function') p.catch(function () { /* the browser refused */ });
                } else if (root.webkitRequestFullscreen) {
                    root.webkitRequestFullscreen();
                }
            } catch (e) { /* the browser refused — the mode stays as it was */ }
        },

        /* "About" — the shared compact window of the editors (Common.UI.Compact.AboutWindow),
           as in documents and spreadsheets. The title is the caption of the stock
           "About" button (LeftMenu.tipAbout). */
        about: function () {
            var C = window.Common && Common.UI && Common.UI.Compact, Ctor = C && C.AboutWindow;
            if (typeof Ctor !== 'function') return null;
            var win = new Ctor({title: stock('PDFE.Views.LeftMenu.tipAbout')});
            win.show();
            return win;
        },

        /* A stock File panel ('info', 'saveas', 'opts') is there: the panels are built by the
           stock code once the deferred editor scripts are loaded. Until then the items that show
           a panel are disabled, as the shortcuts item is. */
        filePanelReady: function (name) {
            var b = bridge();
            return !!(b && typeof b.filePanel === 'function' && b.filePanel(name));
        },

        /* "Document info" — the shared window with the stock info panel of the File
           screen; the bridge builds the panel if "File" has not been opened yet. */
        docInfo: function () {
            var C = window.Common && Common.UI && Common.UI.Compact, W = C && C.DocInfoWindow;
            var b = bridge(), panel = b && typeof b.filePanel === 'function' ? b.filePanel('info') : null;
            if (!W || typeof W.open !== 'function' || !panel) return null;
            return W.open({panel: panel, title: stock('PDFE.Views.FileMenuPanels.DocumentInfo.txtDocumentInfo')});
        },

        /* "Keyboard shortcuts" — the stock shortcuts window (the same one is opened by the
           "Customize" button of the advanced settings). The window loads with the deferred
           editor scripts: until then the item is disabled. */
        shortcutsReady: function () {
            return !!(window.Common && Common.Views && typeof Common.Views.ShortcutsDialog === 'function');
        },

        shortcuts: function () {
            if (!this.shortcutsReady()) return null;
            var win = new Common.Views.ShortcutsDialog({api: this.api});
            win.show();
            return win;
        },

        /* --- The "⋮" menu ------------------------------------------------------- */
        /* One section of the shared menu bar: everything that is not on the bar. Download PDF,
           print, zoom, pages, search, sharing and "Full screen" — by the bar
           buttons, navigation — by its own button over the document; copy and
           select all — by keys. At the bottom — settings and the program info,
           without a submenu. */
        sections: function () {
            var me = this;
            var net = function (c) { return c && typeof c.net === 'function' ? c.net('download') : null; };

            function downloadAs(k, type, t) {
                return {k: 'file.downloadAs.' + k, t: t, disabled: net,
                    run: function () { me.download(type); me.done(); }};
            }
            function twinItem(k, t, ref) {
                return {k: k, t: t,
                    disabled: function () { return me.twinOff(ref); },
                    run: function () { me.press(ref); me.done(); }};
            }

            return [
                {k: 'more', t: function () { return stock('Common.Translation.textMoreButton') || me.textMore; }, items: [
                    {k: 'file.downloadAs', t: st('PDFE.Views.FileMenu.btnDownloadCaption'), i: 'download', kind: 'submenu',
                        when: function () { return me.canDownload(); }, disabled: net, items: [
                            downloadAs('docx', 'DOCX', own('textWordDocx')),
                            downloadAs('png', 'PNG', own('textPagesPng')),
                            downloadAs('jpg', 'JPG', own('textPagesJpg')),
                            {sep: true},
                            {k: 'file.downloadAs.more', t: own('textMoreFormats'),
                                disabled: function (c) { return me.filePanelReady('saveas') ? net(c) : true; },
                                run: function () { me.showFile('saveas'); }}
                        ]},
                    {k: 'file.rename', t: st('PDFE.Views.FileMenu.btnRenameCaption'), i: 'rename',
                        when: function () { return me.canRename(); },
                        disabled: function (c) { return me.hasCommand('rename') ? (c && c.net ? c.net() : null) : true; },
                        run: function () { me.command('rename')(); }},
                    {k: 'file.info', t: st('PDFE.Views.FileMenuPanels.DocumentInfo.txtDocumentInfo'), i: 'info',
                        when: function () { return me.canInfo(); },
                        disabled: function () { return me.filePanelReady('info') ? null : true; },
                        run: function () { me.docInfo(); }},
                    {sep: true},
                    {k: 'view.goToPage', t: st('PDFE.Views.Statusbar.goToPageText'),
                        disabled: function () { return me.hasCommand('goToPage') ? null : true; },
                        run: function () { me.command('goToPage')(); }},
                    twinItem('view.firstPage', st('PDFE.Views.HyperlinkSettingsDialog.txtFirst'), 'Toolbar:btnFirstPage'),
                    twinItem('view.lastPage', st('PDFE.Views.HyperlinkSettingsDialog.txtLast'), 'Toolbar:btnLastPage'),
                    {sep: true},
                    /* The comments panel — read only, and only if the PDF has something to read. */
                    {k: 'view.comments', t: st('PDFE.Views.LeftMenu.tipComments'), i: 'comment', kind: 'check', sc: 'OpenCommentsPanel',
                        when: function () { return me.canComments() && me.hasComments(); },
                        checked: function () { return !!me.twin('LeftMenu:btnComments').pressed; },
                        disabled: function () { return me.twinOff('LeftMenu:btnComments'); },
                        run: function () { me.leftPanel('comments', 'LeftMenu:btnComments'); }},
                    {sep: true},
                    /* Advanced settings — the stock File screen panel as a window. */
                    {k: 'app.settings', t: st('PDFE.Views.FileMenu.btnSettingsCaption'), i: 'settings',
                        when: function () { return me.canSettings(); },
                        disabled: function () { return me.filePanelReady('opts') ? null : true; },
                        run: function () { me.showFile('opts'); }},
                    {k: 'app.shortcuts', t: st('Common.Views.ShortcutsDialog.txtTitle'), i: 'keyboard',
                        disabled: function () { return me.shortcutsReady() ? null : true; },
                        run: function () { me.shortcuts(); }},
                    {k: 'app.about', t: st('PDFE.Views.LeftMenu.tipAbout'), i: 'info',
                        when: function () { return me.canAbout(); },
                        run: function () { me.about(); }}
                ]}
            ];
        },

        /* --- Texts ------------------------------------------------------------- */
        /* The defaults are English, the translation overrides them from locale/<language>.json. */

        textFullscreen: 'Full screen',
        textMore: 'More',
        textMoreFormats: 'Other formats…',
        textPagesJpg: 'Page images (JPG)',
        textPagesPng: 'Page images (PNG)',
        textWordDocx: 'Word document (DOCX)'

    }, PDFE.Views.PdfActions || {});

    return PDFE.Views.PdfActions;
});
