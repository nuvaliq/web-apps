/*
 * CompactWindows — presentation editor windows in the Compact shell on the
 * Air template.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The mechanics and the template are shared by the editors
 * (common/main/lib/view/compact/Windows.js, less/compact/windows.less): the recipe
 * is put on an INSTANCE of the stock window — the template and window label (vo-win
 * vo-win--<id> on .asc-window), the size and the behavior. A window not in the registry and
 * any window in the "Stock interface" stay stock. Here is the presentation
 * registry: shared windows (messages, symbol, table, language, autocorrect and
 * others) are recipes of the shared layer, the presentation's own windows are below.
 *
 * The window texts do not change: button captions, titles and field captions are
 * stock. This differs from documents, where the main button gets the
 * caption "Apply".
 *
 * The shell's own window "Document Info" (DocInfoWindow) is on the same
 * template: the recipe recognizes it by the window class. "About" is the shared
 * Compact window of the editors (Common.UI.Compact.AboutWindow) with its own styles
 * (common/main/resources/less/compact/about.less): the template does not dress it.
 * Both windows are opened by the shell commands that the zone registers in
 * install (CompactShell.command).
 *
 * The frame (CompactShell) installs the zone by calling install(shell) in the order of
 * CompactShell.ZONES; on startup rollback it calls unbind().
 */
define([
    'common/main/lib/view/compact/Windows',
    'common/main/lib/view/compact/AboutWindow',
    'presentationeditor/main/app/view/DocInfoWindow'
], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    var Windows = Common.UI.Compact.Windows;

    /* Five advanced-settings windows on Common.Views.AdvancedSettingsWindow
       — one recipe, one width. */
    var ADVANCED = ['ParagraphSettingsAdvanced', 'ShapeSettingsAdvanced', 'ImageSettingsAdvanced',
        'TableSettingsAdvanced', 'ChartSettingsAdvanced'];

    function has(name) {
        return !!(PE.Views[name]) && typeof PE.Views[name] === 'function';
    }

    /* The presentation's own windows. The look rules are in compact-windows.less under the label
       vo-win--<id>. */
    var OWN = [
        /* "Link Settings". The tabs, fields and the slide list are stock,
           the look comes from the template set and the styles (.vo-win--link). The recipe moves the address
           error to the field edge. The window is opened by "Insert → Link",
           Ctrl+K, the panel button and the context menu (Toolbar.js:1879,
           DocumentHolderExt.js:687, :713, :1536, :1565) — the same
           class everywhere. */
        {
            id: 'link',
            match: function (win) { return PE.Views.CompactWindows.isView(win, 'HyperlinkSettingsDialog'); },
            width: 420,
            apply: function (win) {
                if (!win.inputUrl || typeof win.inputUrl.checkValidate !== 'function') throw new Error('no address field');
                PE.Views.CompactWindows.edgeError(win.inputUrl);
            }
        },
        /* "Date and Time" — "Insert → Date and Time" with the cursor in text
           (Toolbar.js:2084). The stock puts "Set as default"
           to the right of the checkbox, and when the width is short it removes float and
           shortens the list to 139 (DateTimeDialog.js:152–155), without
           changing the window height — the button overlaps "OK". Here the layout
           is one at any width (.vo-win--datetime): the button under the checkbox,
           the window grows by content. */
        {
            id: 'datetime',
            match: function (win) { return PE.Views.CompactWindows.isView(win, 'DateTimeDialog'); },
            width: 420
        },
        /* "Header and Footer Settings" — "Insert →
           Header & Footer" and "Slide Number", "Date and Time" without the cursor in
           text (Toolbar.js:2099), printing (Print.js:398). The window is on
           AdvancedSettingsWindow, but the column on the right is not tabs but a
           preview: the stock draws it in its own node. The look — by styles
           (.vo-win--hf). */
        {
            id: 'hf',
            match: function (win) { return PE.Views.CompactWindows.isView(win, 'HeaderFooterDialog'); }
        },
        /* Advanced settings of a paragraph, shape, image, table
           and chart — the context menu and the right panel
           (DocumentHolderExt.js:2172–2371, ParagraphSettings.js:364 and
           neighbors, Toolbar.js:1683). The "tabs on the left" template, one width
           for all five: the window width is computed by the stock from the column and
           sections (AdvancedSettingsWindow.js:105), so it is set
           by the section width in the styles (.vo-win--adv). */
        {
            id: 'adv',
            match: function (win) {
                var M = PE.Views.CompactWindows;
                return _.some(ADVANCED, function (name) { return M.isView(win, name); });
            }
        },
        /* "Slide Size Settings" — "Slide → Slide Size ▸
           Custom Slide Size" (Toolbar.js, onSlideSize). The behavior is
           stock, the look — by styles (.vo-win--slidesize). */
        {
            id: 'slidesize',
            match: function (win) { return PE.Views.CompactWindows.isView(win, 'SlideSizeSettings'); },
            width: 420
        },
        /* "Document Info" — the shell's own window (DocInfoWindow) with
           the stock info panel inside: the docInfo command, "File →
           Document Info". No footer, the look — by styles
           (.vo-win--docinfo). */
        {
            id: 'docinfo',
            match: function (win) { return PE.Views.CompactWindows.hasCls(win, 'vo-docinfo-dlg'); }
        },
        /* "Slide Show Settings" — the arrow at "Slide Show"
           (Toolbar.js, onPreviewItemClick): one checkbox. The look — by styles
           (.vo-win--showsettings). */
        {
            id: 'showsettings',
            match: function (win) { return PE.Views.CompactWindows.isView(win, 'SlideshowSettings'); },
            width: 420
        },
        /* "Grid Settings" — "View → Gridlines ▸ Custom"
           (ViewTab.js, onGridlinesCustom): the spacing is a list and
           a counter. The look — by styles (.vo-win--grid). */
        {
            id: 'grid',
            match: function (win) { return PE.Views.CompactWindows.isView(win, 'GridSettings'); },
            width: 420
        }
    ];

    /* The registry in order: the first recipe with a true match is taken. Shared windows
       are recipes of the shared layer (Windows.stock), their look rules are in
       common/main/resources/less/compact/windows-stock.less. */
    var ORDER = ['msg', 'link', 'imgurl', 'table', 'copywarn', 'datetime', 'symbol', 'hf', 'adv', 'chartdata',
        'color', 'listsettings', 'slidesize', 'lang', 'docinfo', 'showsettings', 'grid', 'shadow', 'docprop',
        'axisformat', 'autocorrect', 'shortcuts', 'macros'];

    var byId = _.indexBy(OWN, 'id');

    PE.Views.CompactWindows = Windows.create(_.extend({

        RECIPES: _.map(ORDER, function (id) { return byId[id] || Windows.stock([id])[0]; }),

        /* The work area is the slide margins, and without it the editor area. */
        workAreas: ['id_main_parent', 'editor_sdk'],

        /* The zone is installed by the shared layer mechanics (bind) and registers the commands
           of its own windows; the "Stock interface" removes the dimming and the icons, going back
           puts them on. A repeated install after a rollback only turns it on again. */
        install: function (shell) {
            var me = this, first = !this.shell;
            this.bind(shell);
            if (first) {
                if (typeof shell.command === 'function') {
                    shell.command('about', shell.guarded('windows: about', function () { return me.about(); }));
                    shell.command('docInfo', shell.guarded('windows: document info', function () { return me.docInfo(); }));
                }
                Common.NotificationCenter.on('shell:advanced', shell.guarded('windows: stock interface', function (advanced) {
                    if (me.bound) me.setActive(!advanced);
                }));
            }
            this.setActive(!shell.advanced);
            return this;
        },

        /* "About" — a window with legal information: the shared Compact window of
           the editors (Common.UI.Compact.AboutWindow), as in documents and
           spreadsheets. The title is the caption of the stock "About" button
           (LeftMenu.tipAbout). */
        about: function () {
            var C = window.Common && Common.UI && Common.UI.Compact, Ctor = C && C.AboutWindow;
            if (!this.bound || typeof Ctor !== 'function') return null;
            var left = PE.Views.LeftMenu && PE.Views.LeftMenu.prototype;
            var win = new Ctor({title: left && left.tipAbout});
            win.show();
            return win;
        },

        /* "Document Info" — a window with the stock info panel
           (DocInfoWindow). */
        docInfo: function () {
            var W = PE.Views.DocInfoWindow;
            return this.bound && W && typeof W.open === 'function' ? W.open() : null;
        },

        /* For recipes: the presentation window class is loaded and the window is its
           instance. */
        isView: function (win, name) { return has(name) && win instanceof PE.Views[name]; }

    }, PE.Views.CompactWindows || {}));

    return PE.Views.CompactWindows;
});
