/*
 * FileWindows — the File screen panels as windows of the "Compact" shell of the PDF viewer.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The shell has no File screen. Its panels that the viewer needs —
 * print, advanced settings and "Download as" — open as windows on the
 * shared compact window template (Common.UI.Compact.Windows; the RECIPES recipes are in
 * the registry PDFE.Views.CompactWindows) over the document. Inside is the whole stock panel, as in "Document
 * info" (Common.UI.Compact.DocInfoWindow): the panel node is moved into the window
 * for the time of the display and returned to its place before closing; the fields,
 * the checks and the action itself are stock (the Print and LeftMenu controllers). What
 * of the panel is absent in the window is decided by the styles (compact-windows.less,
 * "Windows with File panels").
 *
 * A panel action ends with closing the File screen — menu.hide() (print —
 * Print.onBtnPrint, settings — LeftMenu.applySettings, format —
 * LeftMenu.clickSaveAsFormat). For the time of the window the panel's menu field is a
 * twin of the screen with its own hide, which closes the window. The twin sends events
 * on behalf of the screen (fireEvent goes to the bus by the view name), so the stock
 * subscribers receive them as before.
 *
 * The action buttons are in the window footer, as in the template windows; a press is a click
 * of the panel's stock button (its handler is at the controller), the stock buttons
 * themselves are hidden in the window by the styles.
 *
 * The stock FileMenu.applyMode assigns itself to the print panel's menu field again on every
 * setMode (rights change, connection loss) and so replaces the twin of an open window. Then the
 * stock print hides the real, never shown, screen, and the window would stay. So the windows
 * listen to menu:hide of the screen (watch) and close with it.
 *
 * route(menu) answers the stock display of the File screen — showMenu('file' or
 * 'file:<panel>') of the left menu view: for a panel with a window — the window, "Info" — its
 * window, the rest — nothing. A panel the integrator turned off (allowed) opens nothing, as there
 * is no screen to fall back to.
 */
define([
    'common/main/lib/view/compact/DocInfoWindow',
    'pdfeditor/main/app/view/StockBridge'
], function () {
    'use strict';

    if (window.PDFE === undefined) window.PDFE = {};
    if (PDFE.Views === undefined) PDFE.Views = {};

    function ctl(name) {
        try { return (PDFE.getController && PDFE.getController(name)) || null; } catch (e) { return null; }
    }

    /* Caption of the stock code — a locale string on the view prototype or on the
       object itself, read on every opening. */
    function stock(path) {
        var parts = path.split('.'), key = parts.pop(), o = window;
        for (var i = 0; i < parts.length && o; i++) o = o[parts[i]];
        if (!o) return '';
        var v = o.prototype && typeof o.prototype[key] === 'string' ? o.prototype[key] : o[key];
        return typeof v === 'string' ? v : '';
    }

    /* The viewer's rights and customization checks (PdfActions) that the stock File screen
       applies to its items (FileMenu.applyMode); no catalog — nothing is allowed. */
    function acts() { return PDFE.Views.PdfActions || null; }
    function ask(method) {
        var a = acts();
        return !!a && typeof a[method] === 'function' && !!a[method]();
    }

    function panelNode(panel) {
        return panel && panel.$el && panel.$el[0] && panel.$el[0].nodeType === 1 ? panel.$el[0] : null;
    }

    /* Windows: the File screen panel name → the window.
     *  - id — the template recipe and the window mark (vo-win--<id>), cls — the window class;
     *  - title — the title: the stock panel caption;
     *  - buttons — the footer: value → the panel's stock button (a selector), the first is
     *    the primary one; 'cancel' — the window's stock "Cancel", closes it;
     *  - allowed — the stock File screen shows the panel item only under this condition
     *    (FileMenu.applyMode): the rights and the integrator's customization;
     *  - closed — after the panel is returned to its place. */
    var KINDS = {
        /* Print: "Print" and "Print to PDF" are the stock buttons of the print panel. On
           closing — the stock closing of the print preview (Print.onHidePrintMenu:
           by stock it is called by closing the File screen).
           The stock preview is kept on purpose. The stock print cannot do without showing the
           panel: Print.onShowMainSettingsPrint sets the current page for "Current page", the
           content of the document for "Content" and the disabled state, and in the same function
           starts the preview. There is no extra drawing: the styles hide #print-preview-box with
           display: none, so the engine gets a 0×0 canvas and the preview update returns before
           drawing; the printing itself (asc_Print) does not depend on the preview. */
        printpreview: {
            id: 'print', cls: 'vo-print-dlg', width: 400,
            allowed: function () { return ask('canPrint'); },
            title: function () { return stock('PDFE.Views.PrintWithPreview.txtPrint'); },
            buttons: function () {
                return [
                    {value: 'print', caption: stock('PDFE.Views.PrintWithPreview.txtPrint'), press: '#print-btn-print'},
                    {value: 'pdf', caption: stock('PDFE.Views.PrintWithPreview.txtPrintPdf'), press: '#print-btn-print-pdf', cls: 'vo-btn-outline'}
                ];
            },
            closed: function () {
                var print = ctl('Print');
                if (print && typeof print.onHidePrintMenu === 'function') print.onHidePrintMenu();
            }
        },
        /* Advanced settings: "Apply" is the stock panel button, "Cancel"
           closes the window without saving (the panel rereads the fields on the next
           display — Settings.show → updateSettings). */
        opts: {
            id: 'settings', cls: 'vo-settings-dlg', width: 560,
            allowed: function () { return ask('canSettings'); },
            title: function () { return stock('PDFE.Views.FileMenuPanels.Settings.txtAdvancedSettings'); },
            buttons: function () {
                return [
                    {value: 'apply', caption: stock('PDFE.Views.FileMenuPanels.Settings.okButtonText'), press: '.fms-btn-apply .btn.primary'},
                    'cancel'
                ];
            }
        },
        /* Download as: a format is a click on its tile, there is no footer. */
        saveas: {
            id: 'saveas', cls: 'vo-saveas-dlg', width: 560,
            allowed: function () { return ask('canDownload'); },
            title: function () { return stock('PDFE.Views.FileMenu.btnDownloadCaption'); }
        }
    };

    /* The window template recipes, in the registry PDFE.Views.CompactWindows: by the window
       class (the mechanics pass themselves as the second argument of match), the look — by the
       styles under the mark. */
    var RECIPES = Object.keys(KINDS).map(function (name) {
        var kind = KINDS[name];
        return {id: kind.id, match: function (win, M) { return M.hasCls(win, kind.cls); }};
    });

    var FileWindows = PDFE.Views.FileWindows || {};

    var own = {

        KINDS: KINDS,
        RECIPES: RECIPES,

        opened: {},          // panel name → its open window
        watched: null,       // the screen listened to: {screen, close}

        /* The stock File screen panel by name — the bridge builds the screen if it has not
           been opened yet (StockBridge.filePanel). */
        panel: function (name) {
            var b = PDFE.Views.StockBridge;
            return b && typeof b.filePanel === 'function' ? b.filePanel(name) : null;
        },

        has: function (name) {
            return Object.prototype.hasOwnProperty.call(KINDS, name);
        },

        isOpen: function (name) {
            return !!this.opened[name];
        },

        /* The window of the panel is allowed by the stock conditions of its File screen item;
           "Info" — by the integrator's switch of the same item. */
        allowed: function (name) {
            if (name === 'info') return ask('canInfo');
            var kind = KINDS[name];
            return !!kind && (typeof kind.allowed !== 'function' || !!kind.allowed());
        },

        /* The windows close with menu:hide of the stock screen: the stock code ends a panel
           action with it, whatever the panel's menu field points to now. One subscription per
           screen object; the windows close by their own close, a window already closed is not
           closed twice. */
        watch: function () {
            var b = PDFE.Views.StockBridge, screen = b && typeof b.fileMenu === 'function' ? b.fileMenu() : null;
            if (!screen || typeof screen.on !== 'function') return;
            var w = this.watched;
            if (w && w.screen === screen) return;
            if (w && typeof w.screen.off === 'function') w.screen.off('menu:hide', w.close);
            var me = this, shell = PDFE.Views.CompactShell;
            /* The handler runs inside the stock trigger of the screen, before the stock subscribers
               after it: an exception must not reach them. */
            var close = function () { me.closeAll(); };
            this.watched = {screen: screen, close: shell && typeof shell.guarded === 'function' ? shell.guarded('files: menu:hide', close) : close};
            screen.on('menu:hide', this.watched.close);
        },

        /* Every open window is closed in its own try: a failing close does not keep the rest open;
           the first failure is thrown after the loop (to the guard of the subscription). */
        closeAll: function () {
            var me = this, failed = false, error;
            Object.keys(this.opened).forEach(function (name) {
                var win = me.opened[name];
                if (!win) return;
                try { win.close(); } catch (e) {
                    if (!failed) { failed = true; error = e; }
                }
            });
            if (failed) throw error;
        },

        /* A display of the File screen by the stock code: 'file' or 'file:<panel>'. A panel with
           a window — the window, "Info" — its shared window (PdfActions.docInfo); the rest
           (help, rights, the screen itself) does not open in the shell. */
        route: function (menu, opts) {
            var m = /^file(?::(\w*))?$/.exec(String(menu || ''));
            if (!m) return null;
            var name = m[1] || '';
            if (!this.allowed(name)) return null;
            if (this.has(name)) return this.open(name, opts);
            if (name === 'info') {
                var acts = PDFE.Views.PdfActions;
                return acts && typeof acts.docInfo === 'function' ? acts.docInfo() : null;
            }
            return null;
        },

        /* The panel window — an already open one or a new one; null — there is no panel or no
           window of the stock code. */
        open: function (name, opts) {
            if (this.opened[name]) return this.opened[name];
            var kind = KINDS[name], C = window.Common;
            if (!kind || !C || !C.UI || typeof C.UI.Window !== 'function' || !this.allowed(name)) return null;
            var panel = this.panel(name), el = panelNode(panel);
            if (!el) return null;

            var me = this;
            var buttons = typeof kind.buttons === 'function' ? kind.buttons() : null;
            var press = {};
            var cfg = {
                title: kind.title(),
                width: kind.width,
                header: true,
                closable: true,
                modal: true,
                cls: kind.cls,
                tpl: '<div class="box"></div>'
            };
            if (buttons) {
                cfg.buttons = buttons.map(function (b, i) {
                    if (typeof b !== 'object') return b;
                    press[b.value] = b.press;
                    return {value: b.value, caption: b.caption, primary: i === 0, cls: b.cls};
                });
                cfg.primary = buttons[0].value;
                /* Enter — the primary button, as in the template windows. */
                cfg.onprimary = function () { me.press(panel, press[buttons[0].value]); return false; };
            }

            /* The place, the visibility and the screen of the panel — to be restored as they were. */
            var home = {parent: el.parentNode, next: el.nextSibling, display: el.style.display, hidden: panel.hidden, menu: panel.menu};
            var win = new C.UI.Window(cfg);

            /* The screen twin: events — on its behalf, hide closes the window. */
            var twin = home.menu ? Object.create(home.menu) : {fireEvent: function () {}};
            twin.hide = function () { if (me.opened[name] === win) win.close(); };
            twin.isVisible = function () { return true; };

            /* The panel goes into the window right after it is rendered: the stock code computes
               the height and the place of the window already with it (Window.show: render, _autoSize,
               _centre). */
            var render = win.render;
            win.render = function () {
                var res = render.apply(this, arguments);
                var box = this.$window.find('> .body > .box')[0];
                if (box) box.appendChild(el);
                panel.menu = twin;
                this.$window.find('> .body > .footer .dlg-btn').on('click', function (e) {
                    var value = e && e.currentTarget && e.currentTarget.getAttribute('result');
                    if (value === 'cancel') win.close();
                    else me.press(panel, press[value]);
                });
                if (typeof panel.show === 'function') panel.show(opts);
                return res;
            };

            var restore = function () {
                if (!home) return;
                if (home.parent) home.parent.insertBefore(el, home.next && home.next.parentNode === home.parent ? home.next : null);
                el.style.display = home.display;
                panel.hidden = home.hidden;
                if (panel.menu === twin) panel.menu = home.menu;
                home = null;
                if (me.opened[name] === win) delete me.opened[name];
                if (typeof kind.closed === 'function') kind.closed(panel);
            };
            var close = win.close;
            win.close = function () {
                restore();
                return close.apply(this, arguments);
            };

            this.opened[name] = win;
            this.watch();
            win.show();
            return win;
        },

        /* A click of the panel's stock button: its handler decides by itself — it checks the fields,
           prints, saves the settings. A disabled one is not executed by the stock
           handler. */
        press: function (panel, selector) {
            var el = panelNode(panel), btn = el && selector ? el.querySelector(selector) : null;
            if (btn && typeof btn.click === 'function') btn.click();
            return !!btn;
        }
    };

    Object.keys(own).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(FileWindows, k)) FileWindows[k] = own[k];
    });

    PDFE.Views.FileWindows = FileWindows;
    return FileWindows;
});
