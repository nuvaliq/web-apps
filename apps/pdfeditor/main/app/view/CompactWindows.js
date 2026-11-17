/*
 * CompactWindows — PDF viewer windows in the Compact shell on the Air template.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The mechanics and the template are shared by the editors
 * (common/main/lib/view/compact/Windows.js, less/compact/windows.less): the recipe
 * is put on an INSTANCE of the stock window — the template and window label (vo-win
 * vo-win--<id> on .asc-window), the size and the behavior. A window not in the registry
 * stays stock. Here is the PDF viewer registry:
 *  - shared windows of the stock code the viewer opens — messages, the copy warning and
 *    the keyboard shortcuts — are recipes of the shared layer (Windows.stock), their look
 *    is in less/compact/windows-stock.less;
 *  - "Document Info" is the shared window Common.UI.Compact.DocInfoWindow with its own
 *    recipe (DocInfoWindow.recipe) and styles (less/compact/docinfo.less);
 *  - print, advanced settings and "Download as" are the File screen panels in windows
 *    (FileWindows.RECIPES), their look is in compact-windows.less.
 *
 * The window texts do not change: button captions, titles and field captions are
 * stock.
 *
 * The frame (CompactShell) installs the windows by calling install(shell) when the shell is
 * built; on startup rollback it calls unbind().
 */
define([
    'common/main/lib/view/compact/Windows',
    'common/main/lib/view/compact/DocInfoWindow',
    'pdfeditor/main/app/view/FileWindows'
], function () {
    'use strict';

    if (window.PDFE === undefined) window.PDFE = {};
    if (PDFE.Views === undefined) PDFE.Views = {};

    var Windows = Common.UI.Compact.Windows;

    PDFE.Views.CompactWindows = Windows.create(_.extend({

        /* The registry in order: the first recipe with a true match is taken. */
        RECIPES: Windows.stock(['msg', 'copywarn', 'shortcuts'])
            .concat([Common.UI.Compact.DocInfoWindow.recipe], PDFE.Views.FileWindows.RECIPES),

        /* The windows are installed by the shared layer mechanics (bind). The shell has no
           other mode, so the layer is always on; a repeated install after a rollback only
           turns it on again. */
        install: function (shell) {
            this.bind(shell);
            this.setActive(true);
            return this;
        }

    }, PDFE.Views.CompactWindows || {}));

    return PDFE.Views.CompactWindows;
});
