/*
 * DocInfoWindow — the "Document Info" window of the "Compact" shell, shared by the
 * editors.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The window is on the Compact window template without a footer, and inside it is the stock
 * info panel of the editor's File screen. The panel is not copied and no second instance
 * is created: its node is moved into the window for the time it is shown and returned to
 * its own place before closing. The reason is that the panel is stock in full: the property
 * fields write to the engine, it redraws its list of custom properties from the document, and
 * it receives the property lock by subscribing to the engine — a second instance would draw
 * the properties into both panels and accumulate subscriptions.
 *
 * The node is returned before the window removes its markup (Window.close →
 * $window.remove()): jQuery would strip the field handlers from the node.
 *
 * The editor passes the panel on opening: open({panel, title}) — the stock view of the
 * panel (it has $el) and, if there is one, the title. Without a title the window title is
 * the panel's own heading row (td.header), so in the window that row is hidden by
 * styles. The module does not know the editor namespace; building the panel if the
 * File screen has not been opened yet is the editor's job.
 *
 * The mechanics are those of the stock window (Common.UI.Window): modality, Esc and the cross,
 * no footer. The look comes from the Compact window template (Common.UI.Compact.Windows) by the
 * recipe of this module (recipe: docinfo, by the window class CLS) and from the styles
 * less/compact/docinfo.less. An editor that shows the window on the template puts recipe into
 * the registry of its windows and imports docinfo.less after windows.less and
 * windows-stock.less; without them the window is stock.
 */
define([], function () {
    'use strict';

    if (window.Common === undefined) window.Common = {};
    if (Common.UI === undefined) Common.UI = {};
    if (Common.UI.Compact === undefined) Common.UI.Compact = {};

    var CLS = 'vo-docinfo-dlg';

    function panelNode(panel) {
        return panel && panel.$el && panel.$el[0] && panel.$el[0].nodeType === 1 ? panel.$el[0] : null;
    }

    /* The panel title — its heading row in the markup. */
    function headerText(el) {
        var cell = el && typeof el.querySelector === 'function' ? el.querySelector('.header') : null;
        var text = cell ? String(cell.textContent || '').trim() : '';
        return text;
    }

    /* The window has the class in its markup config — as Windows.hasCls, without depending on
       the window layer module. */
    function hasCls(win, cls) {
        var cfg = win && win.initConfig;
        return !!cfg && (' ' + (cfg.cls || '') + ' ').indexOf(' ' + cls + ' ') >= 0;
    }

    var DocInfoWindow = Common.UI.Compact.DocInfoWindow || {};

    var own = {

        CLS: CLS,
        WIDTH: 560,

        /* The window template recipe: the window is recognized by its class, there is no footer,
           the look is by styles under the label vo-win--docinfo. */
        recipe: {
            id: 'docinfo',
            match: function (win) { return hasCls(win, CLS); }
        },

        /* The opened window is returned; without a panel or without the stock code window —
           null. */
        open: function (opts) {
            var C = window.Common;
            if (!C || !C.UI || typeof C.UI.Window !== 'function') return null;
            var panel = opts && opts.panel, el = panelNode(panel);
            if (!el) return null;

            /* Place and visibility of the panel on the File screen — restore as they were. */
            var home = {parent: el.parentNode, next: el.nextSibling, display: el.style.display, hidden: panel.hidden};
            var title = opts.title != null && String(opts.title) !== '' ? String(opts.title) : headerText(el);

            var win = new C.UI.Window({
                title: title,
                width: this.WIDTH,
                header: true,
                closable: true,
                modal: true,
                cls: this.CLS,
                tpl: '<div class="box"></div>'
            });

            /* The panel goes into the window right after it is rendered: the stock code
               computes the window height and position already with it (Window.show: render,
               _autoSize, _centre). */
            var render = win.render;
            win.render = function () {
                var res = render.apply(this, arguments);
                var box = this.$window.find('> .body > .box')[0];
                if (box) box.appendChild(el);
                if (typeof panel.show === 'function') panel.show();
                return res;
            };

            var restore = function () {
                if (!home) return;
                if (home.parent) home.parent.insertBefore(el, home.next && home.next.parentNode === home.parent ? home.next : null);
                el.style.display = home.display;
                panel.hidden = home.hidden;
                home = null;
            };
            var close = win.close;
            win.close = function () {
                restore();
                return close.apply(this, arguments);
            };

            win.show();
            return win;
        }
    };

    Object.keys(own).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(DocInfoWindow, k)) DocInfoWindow[k] = own[k];
    });

    Common.UI.Compact.DocInfoWindow = DocInfoWindow;
    return DocInfoWindow;
});
