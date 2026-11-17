/*
 * StockBridge — the bridge to the stock controls of the PDF viewer.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The only shell module that knows how the stock ribbon and the left menu are built.
 * Shell commands are stock actions: a shell button presses the stock button with its
 * own click(), availability and pressed state are read from it too. Ribbon nodes are not
 * moved: the ribbon stays in the DOM under the shell, hidden by style.
 *
 * A stock control address is '<root>:<path>': the root is a row of the ROOTS table,
 * the path is properties separated by dots ('Toolbar:btnPrint', 'LeftMenu:btnComments').
 * The names are internals of the stock code, not an API: a missing control gives null, not
 * an exception, and the shell shows the item as inactive.
 */
define([], function () {
    'use strict';

    if (window.PDFE === undefined) window.PDFE = {};
    if (PDFE.Views === undefined) PDFE.Views = {};

    function ctl(name) {
        try { return (PDFE.getController && PDFE.getController(name)) || null; } catch (e) { return null; }
    }

    function field(c, name) {
        return c ? c[name] : undefined;
    }

    function noop() {}

    /* Shell guard (CompactShell.guarded) for the listeners that the bridge puts
       itself on stock nodes. The bridge loads before the shell — the guard is taken
       when a listener is set; without the shell — the function as is. */
    function guard(label, fn) {
        var shell = PDFE.Views.CompactShell;
        return shell && typeof shell.guarded === 'function' ? shell.guarded(label, fn) : fn;
    }

    /* The File panels (info, "Download as"…) are created by the stock code in
       FileMenu.render(), and it is called only by the first show of the screen (FileMenu.show:
       with a mode set and scripts loaded). Until then there are no panels. The bridge
       makes the same step under the same conditions without showing the screen: the markup
       goes into its hidden node, as on the first opening. */
    function renderFileMenu(menu) {
        if (!menu || menu.rendered !== false || !menu.mode || typeof menu.render !== 'function') return;
        var lc = window.Common && Common.Controllers && Common.Controllers.LaunchController;
        if (!lc || typeof lc.isScriptLoaded !== 'function' || !lc.isScriptLoaded()) return;
        try { menu.render(); } catch (e) { /* no File panels — as before the first show */ }
    }

    /* Address roots: the stock ribbon view (the toolbar field of the Toolbar controller), the
       left menu view (the leftMenu field of the LeftMenu controller) and the File screen — the
       left panel menu (LeftMenu.getMenu('file')). */
    var ROOTS = {
        Toolbar:  function () { return field(ctl('Toolbar'), 'toolbar'); },
        LeftMenu: function () { return field(ctl('LeftMenu'), 'leftMenu'); },
        FileMenu: function () {
            var left = field(ctl('LeftMenu'), 'leftMenu');
            if (!left) return null;
            var menu = (typeof left.getMenu === 'function' && left.getMenu('file')) || left.menuFile || null;
            renderFileMenu(menu);
            return menu;
        }
    };

    function nodeOf(o) {
        if (!o) return null;
        return (o.cmpEl && o.cmpEl[0]) || (o.$el && o.$el[0]) || (o.el && o.el.nodeType ? o.el : null);
    }

    function disabled(o) {
        return typeof o.isDisabled === 'function' ? !!o.isDisabled() : !!o.disabled;
    }

    /* The visibility flag of the stock code (Button.setVisible). Visibility in the DOM does not
       fit here: the ribbon in Compact is hidden entirely. Buttons that the stock code
       hides by a right (hide()) are shown by the shell by the same right, not by
       this flag. */
    function shown(o) {
        return !!o && o.hidden !== true && o.visible !== false;
    }

    PDFE.Views.StockBridge = _.extend({

        ROOTS: ROOTS,

        install: function () {},

        twin: function (ref) {
            if (typeof ref !== 'string') return null;
            var at = ref.indexOf(':');
            if (at < 1) return null;
            var root = ROOTS[ref.slice(0, at)];
            var path = ref.slice(at + 1);
            if (!root || !path) return null;
            var o;
            try {
                o = root();
                var parts = path.split('.');
                for (var i = 0; i < parts.length; i++) {
                    if (!o || typeof o !== 'object') return null;
                    o = o[parts[i]];
                }
            } catch (e) {
                return null;
            }
            return o && typeof o === 'object' ? o : null;
        },

        /* State — from the control itself, on every access: availability
           (isDisabled), pressed state (pressed), visibility (flags of the stock code). */
        state: function (ref) {
            var o = this.twin(ref);
            if (!o) return {exists: false, disabled: true, pressed: false, visible: false};
            return {exists: true, disabled: disabled(o), pressed: o.pressed === true, visible: shown(o)};
        },

        /* Press — the button's own click() (Button.click: toggling and
           'click' for stock subscribers). Refusal — no button or it is disabled:
           between the menu opening and the choice the stock code could have disabled the control. */
        run: function (ref) {
            var o = this.twin(ref);
            if (!o || disabled(o) || typeof o.click !== 'function') return false;
            o.click();
            return true;
        },

        /* Watching a control: the stock lockControls disables a button with a class and
           the disabled attribute, the pressed state is reflected by aria-pressed and a class. cb
           receives the fresh state — only when it changes. Returns the unsubscribe. */
        watch: function (ref, cb) {
            var me = this, o = this.twin(ref);
            if (!o || typeof cb !== 'function') return noop;
            var last = JSON.stringify(this.state(ref));
            var check = guard('bridge: watch ' + ref, function () {
                var st = me.state(ref), now = JSON.stringify(st);
                if (now === last) return;
                last = now;
                cb(st);
            });
            var off = [];
            var el = nodeOf(o);
            if (el && typeof MutationObserver === 'function') {
                var obs = new MutationObserver(check);
                obs.observe(el, {attributes: true, attributeFilter: ['class', 'aria-pressed', 'disabled', 'style']});
                off.push(function () { obs.disconnect(); });
            }
            if (typeof o.on === 'function') {
                var onEvent = function () { check(); };
                o.on('disabled toggle', onEvent);
                off.push(function () { typeof o.off === 'function' && o.off('disabled toggle', onEvent); });
            }
            return function () { off.forEach(function (f) { f(); }); off = []; };
        },

        /* The File screen with built panels — or null while it cannot be built
           (the scripts are not loaded yet). */
        fileMenu: function () {
            var menu = null;
            try { menu = ROOTS.FileMenu(); } catch (e) { menu = null; }
            return menu && menu.panels ? menu : null;
        },

        /* A stock File panel by name ('info', 'saveas'…). */
        filePanel: function (name) {
            var menu = this.fileMenu(), panel = menu && menu.panels && menu.panels[name];
            return panel && panel.$el && panel.$el[0] ? panel : null;
        }

    }, PDFE.Views.StockBridge || {});

    return PDFE.Views.StockBridge;
});
