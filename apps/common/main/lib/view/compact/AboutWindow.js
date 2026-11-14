/*
 * AboutWindow — the "About" window of the "Compact" shell, shared by the editors.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The content is not its own: it is built by Common.Views.About.prototype.contentHtml()
 * from the editor's locale strings, and the same thing is shown by the "About" panel
 * of the extended interface. The legal text lives in one place, the window is only
 * a container. contentHtml() works without an instance as well, so there is no need
 * to create the panel for it.
 *
 * The mechanics are those of the stock window (Common.UI.Window): modality and dimming,
 * focus, Esc and the close (X) button. There is no footer: the window has no buttons, it is closed
 * by the X button and Esc. What to do after closing is decided by the calling catalog
 * of the editor: the window is the stock one, it has a close event.
 *
 * Look — width 520, the header and body on the ui.system.dialog values. Styles are
 * in the shared less/compact/about.less under the window class and the compact class on
 * body, so the other editor windows do not change. Color, font, surface,
 * shadow and radius there are editor variables.
 */
define([
    'common/main/lib/component/Window',
    'common/main/lib/view/About',
    'common/main/lib/view/compact/Icons'
], function () {
    'use strict';

    if (window.Common === undefined) window.Common = {};
    if (Common.UI === undefined) Common.UI = {};
    if (Common.UI.Compact === undefined) Common.UI.Compact = {};

    Common.UI.Compact.AboutWindow = Common.UI.Window.extend(_.extend({

        /* Only the title is taken from the options: the rest is the window's look, and it is
           the only one. There are intentionally no buttons — without them the stock template does not draw
           the footer. */
        initialize: function (options) {
            Common.UI.Window.prototype.initialize.call(this, {
                title: (options || {}).title,
                width: 520,
                header: true,
                closable: true,
                modal: true,
                cls: 'vo-about-dlg',
                tpl: Common.Views.About.prototype.contentHtml()
            });
        },

        /* The close (X) button is the stock one: the .tool.close node with a click handler is set
           by the stock render. The stock code draws the X with two pseudo-elements; inside
           we put the AIR 24 icon, and about.less turns the pseudo-elements off. */
        render: function () {
            Common.UI.Window.prototype.render.call(this);
            this.$window.find('.tool.close').html(Common.UI.Compact.Icons.svg('close', 24));
            return this;
        }

    }, Common.UI.Compact.AboutWindow || {}));

    return Common.UI.Compact.AboutWindow;
});
