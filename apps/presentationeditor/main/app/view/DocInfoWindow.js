/*
 * DocInfoWindow — the "Document Info" window of the Compact shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The window is built on the Compact window template without a footer, and
 * inside it sits the stock info panel of the "File" screen
 * (PE.Views.FileMenuPanels.DocumentInfo, FileMenu.panels.info). The panel is
 * not copied and no second instance is created: its node is moved into the
 * window for the time it is shown and returned to its own place before the
 * window closes. The reason is that the panel is stock in full: the property
 * fields write to the engine (asc_setCoreProps), it redraws its list of custom
 * properties from the whole document ($('tbody.properties-tab'),
 * FileMenuPanels.js), and it receives the property lock by subscribing to the
 * engine (asc_onLockCore) — a second instance would draw the properties into
 * both panels and accumulate subscriptions. "Add property" opens the stock
 * property window on top of this one.
 *
 * The node is returned before the window removes its markup
 * (Window.close → $window.remove()): jQuery would otherwise strip the field
 * handlers from the node. The stock panel is not built yet if "File" has never
 * been opened — the bridge builds it (StockBridge.ROOTS.FileMenu), as it does
 * for the "File" items.
 *
 * The mechanics are those of the stock window (Common.UI.Window): modality,
 * Esc and the close cross, no footer. The title is the title of the panel
 * itself (txtPresentationInfo), so the panel's own heading row is hidden in
 * the window. The look comes from the Compact window template (CompactWindows,
 * recipe by the window class vo-docinfo-dlg).
 */
define([], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    function infoPanel() {
        var B = PE.Views.StockBridge;
        var menu = B && B.ROOTS && typeof B.ROOTS.FileMenu === 'function' ? B.ROOTS.FileMenu() : null;
        var panel = menu && menu.panels && menu.panels.info;
        return panel && panel.$el && panel.$el[0] ? panel : null;
    }

    PE.Views.DocInfoWindow = _.extend({

        CLS: 'vo-docinfo-dlg',
        WIDTH: 560,

        /* The window is open — return it; null without the stock panel or the
           stock window. */
        open: function () {
            var C = window.Common;
            if (!C || !C.UI || typeof C.UI.Window !== 'function') return null;
            var panel = infoPanel();
            if (!panel) return null;

            var el = panel.$el[0];
            /* Place and visibility of the panel on the "File" screen — restore as they were. */
            var home = {parent: el.parentNode, next: el.nextSibling, display: el.style.display, hidden: panel.hidden};
            var Info = PE.Views.FileMenuPanels && PE.Views.FileMenuPanels.DocumentInfo;

            var win = new C.UI.Window({
                title: Info && Info.prototype ? Info.prototype.txtPresentationInfo : '',
                width: this.WIDTH,
                header: true,
                closable: true,
                modal: true,
                cls: this.CLS,
                tpl: '<div class="box"></div>'
            });

            /* The panel goes into the window right after it is rendered: the stock
               window computes its height and position already with it
               (Window.show: render, _autoSize,
               _centre). */
            var render = win.render;
            win.render = function () {
                var res = render.apply(this, arguments);
                this.$window.find('> .body > .box').append(el);
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

    }, PE.Views.DocInfoWindow || {});

    return PE.Views.DocInfoWindow;
});
