/*
 * CompactShell — the "Compact" shell of the spreadsheet editor.
 * Part of the web-apps fork, AGPL-3.0.
 *
 *     HEADER (46) → MENU (30) → PLATE (4 + TOOLBAR 44 + FORMULA 36 + 8) = 168
 *
 * Our own copy of the document shell (apps/documenteditor/main/app/view/
 * CompactShell.js), reconciled with the spreadsheet stock; extracting the shared part into apps/common is
 * a separate task. The skeleton: the ui.shell gate, early start,
 * launch and rollback, layout, modes, the left area, the header, the menu bar row (the shared menu bar row
 * Common.UI.Compact.MenuBar, its adapter — view/CompactMenuAdapter.js over the catalog
 * view/SheetActions.js and the ribbon twins view/StockBridge.js); the formula bar —
 * view/FormulaBar.js; the right panel — when it is visible.
 *
 * The formatting toolbar — view/CompactToolbar.js (its row and the focus mode are here).
 * The column header menu — view/ColumnHeaderMenu.js (a layer over the grid canvas and its own
 * menu; it is closed by the shell's common points — closeSurfaces and Escape).
 *
 * The stock ribbon, header and left menu icon column stay in the DOM: in Compact
 * they are hidden by styles (resources/less/compact-shell.less), and the "Stock" mode
 * (Advanced) returns everything as it was — the modes are mutually exclusive. The nodes of the formula
 * bar and the sheet row are stock, ours are only styles; Compact keeps the formula bar
 * in its plate under the toolbar row, Stock returns it to its place (FormulaBar). The right
 * panel is stock, ours is only when it is visible and on which tab it is open.
 */
define([
    'common/main/lib/view/compact/Icons',
    'spreadsheeteditor/main/app/view/FormulaBar',
    'spreadsheeteditor/main/app/view/StockBridge',
    'spreadsheeteditor/main/app/view/SheetActions',
    'spreadsheeteditor/main/app/view/CompactToolbar',
    'spreadsheeteditor/main/app/view/ColumnHeaderMenu',
    'spreadsheeteditor/main/app/view/CompactMenuAdapter',
    'common/main/lib/view/compact/MenuBar',
    'common/main/lib/view/compact/Shells'
], function (Icons, FormulaBar, Bridge, SheetActions, CompactToolbar, ColumnHeaderMenu, MenuAdapter, MenuBar) {
    'use strict';

    if (window.SSE === undefined) window.SSE = {};
    if (SSE.Views === undefined) SSE.Views = {};

    var SHELL_ID = 'vo-shell';
    var BACK_ID  = 'vo-back';


    /* The early start request class: set as soon as the config shows that
       the shell will exist, and it hides the stock chrome until it is built (compact-shell.less,
       body.vo-boot). The build attempts are as many as there were in the launch
       loop before the early start: 20 at 150 ms. */
    var BOOT_CLASS = 'vo-boot';
    var START_TRIES = 20, START_STEP = 150;

    /* The canvas skin retry: LESS in the browser (app_dev.js) compiles asynchronously,
       and the first asc_setSkin might catch the theme variables without ours. As in documents. */
    var SKIN_RETRY = 600;

    /* The Compact header colors in the engine skin: a theme variable that the engine takes
       (common/skin.js), ← our own compact-shell.less variable under body.vo-compact. */
    var TITLE_SKIN = [
        ['canvas-cell-title-background-hover', '--vo-cell-title-hover'],
        ['canvas-cell-title-background-selected', '--vo-cell-title-selected'],
        ['canvas-cell-title-border-hover', '--vo-cell-title-border-hover'],
        ['canvas-cell-title-border-selected', '--vo-cell-title-border-selected']
    ];

    /* The Compact cell selection color — our own compact-shell.less variable under body.vo-compact.
       The border of the active cell and range, the range fill (the same color with alpha 0.15) and
       the strokes of the highlighted headers are drawn by the engine in one color of the sheet settings
       (wb.defaults.worksheetView.activeCellBorderColor): it is not set by the theme or the skin. */
    var SELECTION_VAR = '--vo-cell-selection';

    /* Six numbers are duplicated in compact-shell.less and change in pairs:
       H_HEADER/@vo-h-header, H_MENU/@vo-h-menu, H_TB_GAP_TOP/@vo-tb-gap-top,
       H_TOOLBAR/@vo-h-toolbar, H_FORMULA/@vo-h-formula, H_TB_GAP/@vo-tb-gap. Here
       the shell reserves room in the layout, there it draws itself. The row heights and the gap under
       the toolbar are of the former look of documents, which have since moved on to the new one; the gap above
       the toolbar is the spreadsheets' own — 4 (space-stack-2xs), documents have the same H_TB_GAP on top.
       H_FORMULA — the collapsed formula bar in the plate (the shell reads the expanded one from
       the bar itself, FormulaBar.plateRowHeight). The row values of its own
       (46 + 30 + 4 + 44 + 36 + 8 = 168) and the pairs with LESS are kept by the compact-parity.cjs test. */
    var H_HEADER = 46, H_MENU = 30, H_TOOLBAR = 44;
    var H_TB_GAP_TOP = 4;
    var H_FORMULA = 36;
    var H_TB_GAP = 8;

    /* The shell rows from top to bottom and their contribution to the height of the #toolbar area: 46 + 30 +
       (4 + 44 + 36 + 8) = 168 — the header, the menu bar row and the plate, in which the toolbar row and under
       it the formula bar. The header and the menu bar row count only if built and not hidden;
       the plate height — by its visible rows and the formula bar height (plateHeight). Here —
       the full plate with a collapsed bar; the early start skeleton — the rows that the shell
       will build — see bootLayout. */
    var ROWS = [
        {name: 'header',  height: H_HEADER},
        {name: 'menu',    height: H_MENU},
        {name: 'plate',   height: H_TB_GAP_TOP + H_TOOLBAR + H_FORMULA + H_TB_GAP}
    ];

    /* The plate: the toolbar row and the formula bar are one surface (compact-shell.less, "Plate").
       The empty plate class — both rows are hidden: it does not exist at all, and neither do the margins around it. The variable
       on body — the bottom of the plate from the window top (the search card goes under it). */
    var PLATE_ID = 'vo-plate';
    var PLATE_OFF = 'vo-plate-off', PLATE_SPLIT = 'vo-plate-split', PLATE_FX = 'vo-plate-fx';
    var PLATE_BOTTOM_VAR = '--vo-plate-bottom';
    var CONTEXT_RIBBON = 'vo-context-ribbon';
    /* The early start skeleton: which plate rows it draws (the reader has no toolbar row,
       the formula bar hidden in Stock does not go into the plate). */
    var BOOT_NO_TB = 'vo-boot-no-tb', BOOT_NO_FX = 'vo-boot-no-fx';

    /* The left menu buttons behind which stand the panels of the LEFT AREA (app/template/
       LeftMenu.template, .left-panel). "About" is not included: its panel is
       a separate #about-menu-panel over the whole editor, not the left area.
       Plugins are added to this list on the fly — see leftButtons. */
    var LEFT_PANELS = ['btnSearchBar', 'btnComments', 'btnChat', 'btnSpellcheck'];

    /* The left area panels that stock opens with its showMenu(<name>) (view/LeftMenu.js):
       the left menu button and the menu bar row item, by whose path the panel is opened in Compact
       (bindStockPanels). keepOpen — the stock showMenu does not touch an open panel. */
    var STOCK_PANELS = {
        advancedsearch: {btn: 'btnSearchBar', item: 'findReplace'},
        comments: {btn: 'btnComments', item: 'comments', keepOpen: true}
    };

    /* The header buttons and the return-from-Stock button — with the mouse press flag (bindHeaderPress). */
    var HEADER_PRESS = '#' + SHELL_ID + ' .vo-hd .vo-ib, #' + SHELL_ID + ' .vo-hd .vo-mode, #' + BACK_ID;

    /* The header controls with a hover tooltip (bindHeaderTips): the right buttons, the mode switch and the save
       icon. The book name — no: the field has its own title — the full name and the right to rename. */
    var HEADER_TIP = '.vo-ib, .vo-mode, .vo-hd-state';

    /* The width of the stock left menu icon column (view/LeftMenu.js, SCALE_MIN): the menu is not
       wider than it — stock has no room for a panel (see leftRoom). */
    var LEFT_ICONS_W = 40;

    /* The divider of the shown left area (compact-shell.less: border-right 1px on #left-menu
       under vo-left-open; a hidden one has no border). The menu is border-box, and the stock $el.width(v)
       writes v together with the border at the moment of writing (see leftRoom). */
    var LEFT_DIVIDER_W = 1;

    /* The stock comments panel button — the twin of the "Collaboration → Comments" item of the
       SheetActions catalog; by its pressed state "Viewing" keeps the open panel
       (setSheetMode, reopenComments). */
    var COMMENTS_TWIN = 'LeftMenu:btnComments';

    /* "Download" in the header: the SheetActions catalog items — the same as in "File", in two groups
       (formats, print); the row glyph is download for a format, print for print. */
    var DOWNLOAD_GROUPS = [
        [{k: 'downloadXlsx', i: 'download'}, {k: 'downloadPdf', i: 'download'},
         {k: 'downloadCsv', i: 'download'}, {k: 'downloadOds', i: 'download'}],
        [{k: 'print', i: 'print'}]
    ];
    var DOWNLOAD_MENU_ID = 'vo-download-menu';

    /* The version history window (syncHistory): the id of the stock "Version history" caption for
       aria-labelledby, the size of the AIR glyphs on the stock window buttons — @vo-win-x-w in
       compact-shell.less, and the box attributes that the window sets and removes. */
    var HISTORY_TITLE_ID = 'vo-history-title';
    var HISTORY_GLYPH = 24;
    var HISTORY_ATTRS = ['role', 'aria-modal', 'aria-labelledby', 'tabindex', 'oo_editor_input'];

    /* The header's "History" and "Access" — shortcuts of the "Collaboration" items: outward —
       the same stock notification that the buttons of the "Collaboration" tab send (lib/view/
       ReviewChanges.js: btnHistory → collaboration:history, btnSharing →
       collaboration:sharing); the stock lock of these buttons (lost connection, lost
       access rights) is the shortcut's lock. */
    var COLLAB = {
        history: {twin: 'Review:btnHistory', note: 'collaboration:history', icon: 'history', tip: 'tipHistory', cls: ''},
        sharing: {twin: 'Review:btnSharing', note: 'collaboration:sharing', icon: 'share', tip: 'tipSharing', cls: 'vo-tinted'}
    };

    /* The save state: "Saving…" is held this long from the start of saving — locally
       it takes milliseconds, and the caption would flash for a single frame (as in documents). */
    var SAVE_HOLD_MS = 3000;

    /* Characters not allowed in a file name — the stock header set (lib/view/Header.js,
       onDocNameChanged) and of the rename window. */
    var BAD_NAME = /[\t*+:"<>?|\\/]/;

    /* The stock remembering of the right panel collapse (view/RightMenu.js onBtnMenuClick):
       our own expansion does not touch it — see expandRight. */
    var RIGHT_COLLAPSED_KEY = 'sse-hide-right-settings';

    /* The stock right panel tab buttons by the Common.Utils.documentSettingsType types
       (view/RightMenu.js): a tab's availability — whether its button is disabled. */
    var RIGHT_TABS = {Paragraph: 'btnText', Image: 'btnImage', Shape: 'btnShape', TextArt: 'btnTextArt',
                      Pivot: 'btnPivot', Cell: 'btnCell', Slicer: 'btnSlicer'};

    /* The book mode: "Editing" and "Viewing". Its own type of the stock
       editing:disable reason — the stock stack (Main.stackDisableActions) puts and removes reasons
       by type, and removing ours does not touch others'. The glyphs are as in documents. */
    var VIEW_TYPE = 'vo-view';
    var MODES = [
        {v: 'edit', t: 'textModeEdit', d: 'textModeEditHint', i: 'rename'},
        {v: 'view', t: 'textModeView', d: 'textModeViewHint', i: 'panel'}
    ];

    /* Row motion: the grid area class for the duration of a transition — its shift with the same
       transition as the #toolbar height (compact-shell.less, "Smoothness"). The margin of the fallback
       timer over the transition duration: transitionend will not arrive in a hidden tab and
       on an interrupted transition. The ceiling of the held-back grid recalculation — in case
       nobody released it: a grid without asc_Resize would stay at its previous size. */
    var ROWS_FOLLOW = 'vo-rows-follow';
    var MOTION_SLACK = 120;
    var HOLD_CAP = 1500;

    /* Keyboard: how long to keep focus on our node after a layer closes against
       the stock's deferred focus (DocumentHolder.focus — _.defer). */
    var KEEP_FOCUS_MS = 80;

    /* A text input of the interface (input, textarea) — not the engine's input field #area_id. */
    function isField(el) {
        return !!el && el.nodeType === 1 && /^(INPUT|TEXTAREA)$/.test(el.tagName) && el.id !== 'area_id';
    }

    /* ← in the DataView of a stock gallery ul, after which stock moves focus to the holder item
      . The stock DataView (common/main/lib/component/DataView.js,
       onKeyDown — the same for DataView and DataViewSimple) on ← without a selected swatch or at the left
       column, if the node is inside .dropdown-submenu.over, removes over from this submenu and puts focus
       on its '> a'. For a nested gallery — "Histograms", "Color scales", "Icon sets",
       the submenu of the stock "Conditional formatting" menu — this is the holder in the hidden ribbon: focus
       was lost, the removed over was taken by the bridge for a choice (StockBridge.follow), and everything closed, the keyboard
       went to the sheet. A submenu with a holder inside the gallery itself (SmartArt sections) is stock's move:
       the holder is visible. The left column — as in stock with arrows in both directions (keyMoveDirection
       'both', for all DataView galleries): in the row of the selected swatch (the same top) there is no available swatch
       further left. A DataView without such a submenu (chart, shape) goes around in a circle at the edge. */
    function dataViewLeavesToHolder(ul, t) {
        var dv = typeof t.closest === 'function' ? t.closest('.dataview.inner.canfocused') : null;
        if (!dv || !ul.contains(dv)) return false;
        var sub = t.closest('.dropdown-submenu.over');
        if (!sub || ul.contains(sub)) return false;
        var items = Array.prototype.filter.call(dv.querySelectorAll('.item'), function (n) {
            return n.closest('.dataview') === dv && n.getClientRects().length > 0;
        });
        var sel = null;
        for (var i = 0; i < items.length && !sel; i++) if (items[i].classList.contains('selected')) sel = items[i];
        if (!sel) return true;
        var r = sel.getBoundingClientRect();
        return !items.some(function (n) {
            if (n === sel || n.classList.contains('disabled')) return false;
            var q = n.getBoundingClientRect();
            return Math.abs(q.top - r.top) < 0.5 && q.left < r.left - 0.5;
        });
    }

    /* --- Protection against our own failures ------------------------------------- */
    /* The shell is an add-on to someone else's application, and its breakage has no right to
       take the editor down with it.
       NotificationCenter is Backbone.Events: handlers run one after another in one
       stack, and an exception from ours interrupts the stock subscribers after us too.
       The app:ready notification is sent from the middle of Main.onDocumentContentReady —
       after it the loading mask is removed there, so a launch failure would hang the
       editor on loading with a fully open book. The engine callback list
       (cell/api.js, handlers.trigger) is built the same way: an exception from
       our callback does not reach the stock ones subscribed later.

       So everything called from outside goes through guarded (notifications) and onApi
       (engine callbacks). After a launch failure the wrappers stay completely silent: there is no
       shell, and its subscriptions must not touch the stock look. A repeated failure of one
       place is not written: layout:changed comes in batches, there is nothing to say to the log
       a second time. The labels are service ones, in English: this is not interface. */

    var warned = {};

    function warnOnce(label, e) {
        if (warned[label]) return;
        warned[label] = true;
        if (window.console && console.warn)
            console.warn('Compact shell: "' + label + '" failed, the editor keeps working without it.', e);
    }

    function guarded(label, fn) {
        return function () {
            var shell = SSE.Views.CompactShell;
            if (shell && shell.startupFailed) return;
            try {
                return fn.apply(this, arguments);
            } catch (e) {
                warnOnce(label, e);
            }
        };
    }

    SSE.Views.CompactShell = _.extend({

        /* Exposed: it is called by the glue in controller/Viewport.js. */
        guarded: guarded,

        /* The enable gate. The shell starts ONLY when the platform itself
           named the session ours: `editorConfig.ui.shell === 'modern'`, as for
           documents. The field is put by the platform into the signed
           config on every opening in the new shell — a regular one, by link, from a
           call; `ui.mode` now means only "call" and enables nothing
           by itself. The stock customization flags (compactToolbar, compactHeader
           and others) do not serve as a gate: they are sent by an ordinary integrator too.
           The comparison is strict, case matters: the platform puts a
           normalized name here, so `Modern`, `modern` with a space, `compact` or an empty
           string are no longer its value. No field, a foreign value, an unfinished
           controller or a read error — the stock editor stays.

           config — the config from Gateway `init` (announce): at this event Main
           has not yet moved it into editorConfig. Without an argument we read
           the stock controller's editorConfig. */
        wanted: function (config) {
            try {
                if (this.startupFailed) return false;
                var cfg = config;
                if (cfg === undefined) {
                    var main = SSE.getController('Main');
                    cfg = main && main.editorConfig;
                }
                return !!cfg && !!cfg.ui && cfg.ui.shell === 'modern';
            } catch (e) {
                return false;
            }
        },

        /* --- Early start ---------------------------------------------------- */
        /* The shell is built on app:ready, while stock removes the loading mask earlier —
           on app:face (Main.onEditorPermissions and onApplyEditRights →
           hidePreloader): the whole time the book is loading, a person would see
           the stock title and ribbon, and then their replacement. So the decision
           is made on Gateway `init`, as soon as the config arrives: a request class
           is put on body, and the styles hide the stock chrome until the shell
           is built. On app:face, when the layout is already assembled, the toolbar area
           gets the skeleton height — of the rows that the shell will build; the formula
           bar and the sheet row stay stock.

           boot — what was done to the layout for the skeleton: {heights: [...]}. While
           it is not null, the request class stands. booted — the request has already been made: a repeated
           init does not create a second subscription. */
        boot: null,
        booted: false,

        announce: function (config) {
            if (this.booted || document.getElementById(SHELL_ID) || !this.wanted(config)) return;
            var me = this;
            this.booted = true;
            this.boot = {heights: null};
            document.body.classList.add(BOOT_CLASS);
            /* The subscription is made here, that is, later than the stock handlers of
               app:face (they are made at controller start): by our call
               stock has already laid out the areas under its flags and rendered the ribbon. */
            Common.NotificationCenter.on('app:face', guarded('shell: boot skeleton', function (opts) {
                me.bootLayout(opts);
            }));
        },

        /* The skeleton height — the rows that the shell will build: the header, the menu bar row and the plate
           (the toolbar row and the collapsed formula bar). The reader has no toolbar row
           (there is nothing for them to format, the toolbar is not built); there is no formula bar if it
           was hidden in Stock (the stock key sse-hidden-formula — stock reads it at start
           only for the editing user, Main.applyModeEditorElements). The stock formula bar is hidden in the skeleton
           (compact-shell.less): the skeleton draws it in the plate, and the grid from the first frame stands
           where it will stand after the build. We remember the stock height together with ours:
           create() returns it before the stock snapshot (endBoot), otherwise the snapshot and the base of
           applyLayout would take the skeleton for the stock layout, and the switch to Stock would get
           the wrong height. */
        bootLayout: function (opts) {
            var b = this.boot;
            if (!b || b.heights) return;
            var L = this.layout();
            if (!L || !L.toolbar) return;
            var o = opts || ((SSE.getController('Main') || {}).appOptions) || {};
            var fx = !(o.isEdit && this.formulaHiddenByStock());
            var inner = (o.isEdit ? H_TOOLBAR : 0) + (fx ? H_FORMULA : 0);
            var ours = ROWS.reduce(function (sum, r) {
                if (r.name !== 'plate') return sum + r.height;
                return inner ? sum + H_TB_GAP_TOP + inner + H_TB_GAP : sum;
            }, 0);
            var cl = document.body.classList;
            cl.toggle(BOOT_NO_TB, !o.isEdit);
            cl.toggle(BOOT_NO_FX, !fx);
            b.heights = [{panel: L.toolbar, stock: L.toolbar.height, ours: ours}];
            L.toolbar.height = ours;
            this.relayout();
        },

        /* The formula bar is hidden by the stock "View → Formula bar" (there is no such item in Compact —
           SheetActions: ViewTab:chFormula; it can be hidden only in Stock). */
        formulaHiddenByStock: function () {
            var ls = window.Common && Common.localStorage;
            return !!ls && typeof ls.getBool === 'function' && ls.getBool('sse-hidden-formula');
        },

        /* Remove the request: the class and the skeleton height. The height is returned only if
           it is still ours: if stock managed to rearrange the area (theme change,
           ribbon collapse), its value is fresher than our snapshot.

           relayout = false — from create(), handing the skeleton over to the shell: the stock
           height is returned only into the area model (the stock snapshot and the
           base of applyLayout see it), while the DOM keeps the skeleton until applyLayout(true)
           lays out the shell right away, in the same tick. If we laid out the stock height
           here — the area would become stock for a moment, and the height transition
           (.vo-compact #toolbar, transition) would have something to start from. On
           failure the DOM is brought to the model by the rollback or relayout in start(). */
        endBoot: function (relayout) {
            var b = this.boot;
            if (!b) return;
            this.boot = null;
            document.body.classList.remove(BOOT_CLASS);
            document.body.classList.remove(BOOT_NO_TB);
            document.body.classList.remove(BOOT_NO_FX);
            (b.heights || []).forEach(function (x) {
                if (x.panel.height === x.ours) x.panel.height = x.stock;
            });
            if (relayout) this.relayout();
        },

        /* Launch on app:ready (controller/Viewport.js). The gate is here, not inside
           create(): create() is called repeatedly from the retry loop, while the decision
           is made once per session.

           The retry is for a ribbon that is not rendered yet: create() then exits silently
           and waits for the next attempt. A failure must not be retried, so the loop is
           entirely inside guarded: an exception from create() does not reach
           setTimeout, the attempts stop, and a fallen create() does not get
           a second go on top of a half-built shell.

           The early start fail-safe: an attempt after which there is neither a shell nor
           a next attempt (a failure or exhaustion) removes the request — the stock
           interface returns with its heights. finally runs on an
           exception too, which guarded then swallows.

           The first attempt goes inside app:ready, while the stock subscribers of the same
           notification, made later than us, are still finishing the ribbon ("Add comment" buttons —
           controller/Toolbar.js onAppReady). Until they have run,
           stockBuilding: a twin that does not exist yet is not
           a loss (SheetActions). A tick later stock has finished — the menu bar row is taken
           anew, with its twins. The repeated attempts go after app:ready. */
        start: function () {
            var me = this, tries = 0;
            var built = guarded('shell startup: stock built', function () {
                me.stockBuilding = false;
                if (me.menu) me.menu.refresh();
            });
            var attempt = guarded('shell startup', function () {
                var again = false;
                me.stockBuilding = tries === 0;
                try {
                    me.create();
                    if (document.getElementById(SHELL_ID)) {
                        if (me.stockBuilding) setTimeout(built, 0);
                        return;
                    }
                    if (++tries < START_TRIES) {
                        again = true;
                        setTimeout(attempt, START_STEP);
                    }
                } finally {
                    if (!document.getElementById(SHELL_ID)) me.stockBuilding = false;
                    if (!again && !document.getElementById(SHELL_ID)) {
                        /* The request is still standing — remove it entirely. Already removed, and
                           there is no shell — create() fell after handing over the skeleton:
                           the rollback inside create() returned the layout, while a failure before
                           its try would have left the skeleton in the DOM with a stock model.
                           relayout writes the heights from the model, a repeat is harmless. */
                        if (me.boot) me.endBoot(true);
                        else if (!me.startupFailed) me.relayout();
                    }
                }
            });
            /* The gate is under guarded too: an exception here would break app:ready, and
               with it the removal of the loading mask and the unlocking of input. The gate is closed
               or fell — the request is removed, the stock interface returns. */
            if (guarded('shell startup: gate', function () { return me.wanted(); })()) attempt();
            else guarded('shell startup: stock back', function () { me.endBoot(true); })();
        },

        api: null,
        advanced: false,
        startupFailed: false,
        stockBuilding: false, // stock is still finishing the ribbon on app:ready (start)
        ours: false,         // the area heights are ours now, not stock
        base: null,          // the stock area heights at the moment we took them
        applied: null,       // the heights we put: a divergence from them is a stock edit
        rows: null,          // the built shell rows by the ROWS names
        menu: null,          // the menu bar row: sections, the open section, submenus
        tb: null,            // the formatting toolbar (CompactToolbar), the reader has none
        focus: false,        // focus mode: the header and the menu bar row are hidden
        tbHidden: false,     // "View → Hide toolbar"
        rightOpen: false,    // the decision about the right panel; the vo-right-open class is its application
        rightLast: null,     // the kind of the last selection: the panel is opened by a transition, not a repeat
        rightPending: false, // applying the decision is deferred behind the selection subscribers
        rightExpand: false,  // …and with expansion on the object's tab
        collabBtns: null,    // "History" and "Access" in the header: {history, sharing} — only with a portal capability
        titleEl: null,       // the title: a field with the portal rename right, otherwise text
        titleWas: '',        // the title without extension — the last known (own or incoming)
        sizerEl: null,       // the hidden twin of the title — the field width is measured from it
        stateEl: null,       // the save state
        saveFlags: null,     // {modified, saving} — the engine's truth; the state is derived from the pair
        saveKey: null,       // 'saved' | 'saving' | 'dirty' — what is drawn
        saveHoldUntil: 0,    // until which moment to hold "Saving…"
        editRight: null,     // the edit right — a snapshot at start (null — there is no shell yet)
        sheetMode: 'edit',   // the book mode: 'edit' | 'view'; for the reader — always 'view'
        modeUi: null,        // the mode switch in the header: {wrap, btn, label, pop, items}; without the edit right — null
        downloadUi: null,    // "Download" in the header: {wrap, btn, pop, rows}; without download and print — null
        motion: null,        // the row transition in progress
        resizeHold: null,    // the grid recalculation held back for the duration of a transition
        subs: null,          // unsubscribers: the rollback removes everything the shell subscribed

        /* A subscription to a stock notification under protection; the rollback removes it. */
        onNote: function (name, fn) {
            var cb = guarded('shell: ' + name, fn);
            Common.NotificationCenter.on(name, cb);
            this.subs.push(function () { Common.NotificationCenter.off(name, cb); });
            return cb;
        },

        /* The same for engine callbacks. A direct asc_registerCallback is not used in the shell:
           everything the engine calls on us goes through this wrapper. */
        onApi: function (name, fn) {
            var api = this.api;
            if (!api || typeof api.asc_registerCallback !== 'function') return null;
            var cb = guarded('api: ' + name, fn);
            api.asc_registerCallback(name, cb);
            (this.subs || (this.subs = [])).push(function () {
                if (typeof api.asc_unregisterCallback === 'function') api.asc_unregisterCallback(name, cb);
            });
            return cb;
        },

        /* ------------------------------------------------------------------ */

        stockApi: function () {
            var vp = SSE.getController('Viewport');
            var api = vp && vp.getApi && vp.getApi();
            return api && typeof api.asc_registerCallback === 'function' ? api : null;
        },

        /* The ribbon is rendered: the stock Toolbar.render (on app:face) filled
           #toolbar. Before that there is nothing to hide, and our row would stand earlier than the ribbon. */
        stockReady: function () {
            var ctl = SSE.getController('Toolbar');
            var el = document.getElementById('toolbar');
            return !!(ctl && ctl.toolbar && el && el.childElementCount > 0 && this.stockApi());
        },

        /* Idempotent by #vo-shell: it is called by the launch retry loop and the return from
           Stock. If the ribbon is not ready — exits silently until the next attempt. A failure
           is terminal for the session: a rollback and rethrow outward, to the launch guarded,
           which records it; there are no more retries (startupFailed). */
        create: function () {
            if (this.startupFailed || document.getElementById(SHELL_ID)) return this;
            if (!this.stockReady()) return this;

            /* We release the early start skeleton BEFORE the snapshot: the snapshot and the base of
               applyLayout must see the stock heights, not ours. The request
               class is replaced by vo-compact below, there is no frame between them. */
            this.endBoot(false);
            var stock = this.snapshotStock();
            try {
                this.api = this.stockApi();
                this.subs = [];
                this.rows = {};
                /* The edit right — a snapshot before the header: the mode switch is built from it,
                   and the reader gets the book in "Viewing" at once (without the toolbar, as in the skeleton 76). */
                this.editRight = this.readEditRight();
                this.sheetMode = this.editRight ? 'edit' : 'view';

                var toolbarEl = document.getElementById('toolbar');
                var shell = document.createElement('div');
                shell.id = SHELL_ID;
                shell.appendChild(this.buildHeader());
                shell.appendChild(this.buildMenu());
                /* The third row is the plate: in it the toolbar and under it the formula bar (its node
                   is moved by FormulaBar.apply below). The reader has no toolbar (build returns null) —
                   in the plate they have a single formula bar row. */
                var plate = document.createElement('div');
                plate.id = PLATE_ID;
                var bar = CompactToolbar.build(this);
                if (bar) {
                    plate.appendChild(bar);
                    this.rows.toolbar = bar;
                    this.tb = CompactToolbar;
                }
                shell.appendChild(plate);
                this.rows.plate = plate;
                toolbarEl.insertBefore(shell, toolbarEl.firstChild);
                this.areaRole = stock.areaRole;
                this.applyAreaRole();

                document.body.classList.add('vo-compact');
                document.body.classList.toggle('vo-view', this.sheetMode === 'view');
                /* After the class and before the layout: the bar goes into the plate, its snapping
                   is computed by the Compact styles, and the plate height — already with it. */
                FormulaBar.apply(plate);
                this.applyLayout(true);
                /* After the class: the Compact header colors are visible to the engine only under it. */
                this.applyCanvasSkin();
                /* The header is already in the document: the title field width is measured by the real styles. */
                this.refitTitle();
                this.bindStock();
                this.bindMotion();
                this.bindMenu();
                this.bindHeaderPress();
                this.bindHeaderTips();
                /* After the class and the layout: the row measurement sees the Compact styles. */
                if (this.tb) this.tb.bind(this);
                /* After the toolbar: the book could have opened under a stock ban reason. */
                this.bindEditingLock();
                this.bindRight();
                /* After the menu bar row: a click elsewhere and the shell's Escape are already listened for by the window. */
                ColumnHeaderMenu.attach(this);
                /* Last — the state reads: the book could have opened with an already
                   open stock panel and already modified, and the stock right
                   panel expanded by the remembered state (ours is closed at start). */
                this.syncLeftState();
                this.syncSaveState();
                this.applyRightPanel('keep');
            } catch (e) {
                try { this.rollbackStartup(stock); } finally { throw e; }
            }
            return this;
        },

        snapshotStock: function () {
            var L = this.layout();
            var area = document.getElementById('toolbar');
            return {
                heights: L ? [L.title, L.toolbar].filter(Boolean).map(function (p) {
                    return {panel: p, height: p.height};
                }) : [],
                /* The stock role of the #toolbar area (Viewport.template: role=toolbar) — for the rollback. */
                areaRole: area ? area.getAttribute('role') : null,
                nodes: Array.prototype.slice.call(document.querySelectorAll('[id^="vo-"]')),
                classes: Array.prototype.filter.call(document.body.classList, function (c) {
                    return c.indexOf('vo-') === 0;
                })
            };
        },

        /* The role of the #toolbar area for the screen reader. The stock Viewport.template gives
           it role=toolbar: in Stock it holds the ribbon, and the role is correct. In Compact it holds the whole shell —
           the header, the menu bar row (menubar) and our toolbar (toolbar), — and the screen reader announced "toolbar"
           already at the header, while our toolbar turned out nested inside another. In Compact the
           area has no role (role=none, a container without meaning), in Stock — the stock role, removed
           at launch (areaRole), on a launch rollback — the same one from the snapshot. */
        areaRole: 'toolbar',

        applyAreaRole: function () {
            if (this.advanced) this.restoreAreaRole(this.areaRole);
            else {
                var el = document.getElementById('toolbar');
                if (el) el.setAttribute('role', 'none');
            }
        },

        restoreAreaRole: function (role) {
            var el = document.getElementById('toolbar');
            if (!el) return;
            if (role === null || role === undefined) el.removeAttribute('role');
            else el.setAttribute('role', role);
        },

        /* Returning the stock look after a launch failure. The steps are independent: a failed
           step does not cancel the following ones. startupFailed — first: with it all the
           wrappers are silent, the gate is closed and create() no longer builds. */
        rollbackStartup: function (stock) {
            var me = this;
            this.startupFailed = true;
            this.ours = false;
            this.applied = null;
            this.tb = null;
            var step = function (fn) {
                try { fn(); } catch (e) {
                    if (window.console && console.warn) console.warn('Compact shell: shell rollback step failed.', e);
                }
            };
            step(function () {
                (me.subs || []).splice(0).forEach(function (off) { off(); });
            });
            /* The row transition and the held-back grid recalculation — before the heights are returned: the grid
               must get its asc_Resize. */
            step(function () { me.finishMotion(); me.releaseResize(true); });
            step(function () { ColumnHeaderMenu.detach(); });
            /* The formula bar — from the plate to the stock place before the shell nodes leave
               the document (its snapping and keys are returned by dispose below, by the stock styles). */
            step(function () { FormulaBar.giveBack(); });
            step(function () {
                document.body.style && document.body.style.removeProperty && document.body.style.removeProperty(PLATE_BOTTOM_VAR);
            });
            step(function () {
                Array.prototype.slice.call(document.querySelectorAll('[id^="vo-"]')).forEach(function (el) {
                    if (stock.nodes.indexOf(el) < 0 && el.parentNode) el.parentNode.removeChild(el);
                });
                Array.prototype.slice.call(document.body.classList).forEach(function (c) {
                    if (c.indexOf('vo-') === 0 && stock.classes.indexOf(c) < 0) document.body.classList.remove(c);
                });
            });
            step(function () {
                stock.heights.forEach(function (item) { item.panel.height = item.height; });
                me.relayout();
            });
            step(function () { me.restoreAreaRole(stock.areaRole); });
            step(function () { FormulaBar.dispose(); });
            /* The classes are already removed: the engine gets the stock header colors. */
            step(function () {
                clearTimeout(me.skinTimer);
                me.pushSkin();
            });
        },

        /* Stock rewrites the row heights on its own events: a theme change
           (controller/Viewport.js, onThemeChanged) and the ribbon collapse
           (view:compact → Viewport writes toolbar-height-compact/normal). Both
           paths end with the stock layout:changed, and the stock subscriber is registered
           in onLaunch — earlier than us, so by our handler the fresh stock
           heights are already in the layout. reassertLayout takes them as the new
           stock ones and puts ours on top.
           The view:compact listener on the ribbon view itself is called BEFORE
           the Viewport controller (fireEvent: first the view's trigger, then the controller
           bus), so there the reassertion is deferred to the next
           tick — a fallback path in case stock stops sending
           layout:changed after the collapse. */
        bindStock: function () {
            var me = this;
            this.onNote('layout:changed', function (area) {
                if (me.advanced) return;
                if (area === 'leftmenu') me.syncLeftState();
                /* The formula bar in the plate changed height or visibility by the stock path (collapse
                   by styles, the Stock "View → Formula bar", snapping) — the plate height. */
                else if (area === 'celleditor') me.formulaRowChanged(false);
                else me.reassertLayout();
            });
            /* The stock onThemeChanged recalculates the formula bar snapping but
               not the expand height nor the lower limit of the divider — FormulaBar
               completes them with the same calculation. */
            this.onNote('uitheme:changed', function () {
                me.reassertLayout();
                if (!me.advanced) FormulaBar.apply(me.rows && me.rows.plate);
                /* The skin — in both modes: the stock theme handler gave the engine the colors before
                   the styles of the new theme and ours landed on body. */
                me.applyCanvasSkin();
            });

            var view = SSE.getController('Toolbar').toolbar;
            this.onNote('tab:active', function (tab) {
                if (me.contextRibbon && (me.contextRibbon !== tab || !me.contextTab(tab))) me.closeContextTab(false);
            });
            this.onApi('asc_onSelectionChanged', function (info) {
                if (me.contextRibbon && !me.contextTab(me.contextRibbon, info)) me.closeContextTab(true);
            });
            if (view && typeof view.on === 'function') {
                this.onView(view, 'tab:collapse', function () { me.closeContextTab(false); });
                var later = guarded('shell: view:compact', function () { me.reassertLayout(); });
                var cb = guarded('shell: view:compact', function () { setTimeout(later, 0); });
                view.on('view:compact', cb);
                this.subs.push(function () { view.off && view.off('view:compact', cb); });
            }

            this.bindSaveState();
            this.onApi('asc_onDocumentName', function (name) { me.syncTitle(name); });
            /* A rename by the portal: a meta command from DS, the engine reports it by asc_onMeta (stock
               updates its title from it — Main.onMeta). meta without title is not about the name. */
            this.onApi('asc_onMeta', function (meta) { if (meta && meta.title) me.syncTitle(meta.title); });
            this.bindSearchBarFollow();
            this.bindSearchCard();
            this.bindStockPanels();
            this.subs.push(function () { me.unbindStockPanels(); });
            this.bindHistoryWindow();
        },

        /* The floating search bar (Common.UI.SearchBar: the toolbar search button, Ctrl+F)
           stands under #toolbar on layout:changed and window resize, reading the height from the DOM.
           #toolbar in Compact has a 0.3 s height transition (compact-shell.less), and
           the layout:changed from relayout is synchronous and catches the previous height: after
           focus mode, "Hide toolbar" and the Compact → Stock → Compact round trip the bar
           stood under the old height — above the sheet or over the menu bar row and toolbar.
           At the end of the height transition the bar is repositioned
           by its own stock method. We do not repeat layout:changed: the layout and asc_Resize
           have already gone by the height model, a second grid recalculation is pointless.
           Without a transition (Stock, the height did not change) a synchronous read suffices. */
        bindSearchBarFollow: function () {
            var me = this;
            var el = document.getElementById('toolbar');
            if (!el || typeof el.addEventListener !== 'function') return;
            var onEnd = guarded('shell: search bar follows rows', function (e) {
                if (!e || e.target !== el || e.propertyName !== 'height') return;
                me.placeSearchBar();
            });
            el.addEventListener('transitionend', onEnd);
            this.subs.push(function () { el.removeEventListener('transitionend', onEnd); });
        },

        placeSearchBar: function () {
            var vp = SSE.getController('Viewport');
            var bar = vp && vp.searchBar;
            if (!bar || typeof bar.onLayoutChanged !== 'function') return;
            if (typeof bar.isVisible === 'function' && !bar.isVisible()) return;
            bar.onLayoutChanged();
        },

        /* The search bar card — under the toolbar magnifier, its left edge at the magnifier's left edge, as in documents
           (compact-shell.less, --vo-search-left; the top — by the shell rows there too). We take the place from the magnifier on every
           search:show — it is sent by both the magnifier and Ctrl+F — and on a window resize. The magnifier is not visible (the toolbar is hidden,
           "Viewing", the reader) — we remove the variable, the card is at the left margin; the shell rollback removes it too. */
        bindSearchCard: function () {
            var me = this;
            var place = guarded('shell: search card', function () { me.placeSearchCard(); });
            this.onNote('search:show', place);
            if (typeof window.addEventListener === 'function') {
                window.addEventListener('resize', place);
                this.subs.push(function () { window.removeEventListener('resize', place); });
            }
            this.subs.push(function () { me.searchLeft(null); });
        },

        placeSearchCard: function () {
            var tb = this.tb, c = tb && tb.ctrl && tb.ctrl.search, el = c && c.btn;
            var r = el && typeof tb.whole === 'function' && tb.whole(el) ? el.getBoundingClientRect() : null;
            this.searchLeft(r && r.width ? Math.round(r.left) : null);
        },

        /* The left edge of the search card on body (--vo-search-left); null — remove. */
        searchLeft: function (px) {
            var st = document.body && document.body.style;
            if (!st || typeof st.setProperty !== 'function') return;
            if (px === null) st.removeProperty('--vo-search-left');
            else st.setProperty('--vo-search-left', px + 'px');
        },

        /* --- Menu bar row ---------------------------------------------------- */
        /* The menu bar row is shared (Common.UI.Compact.MenuBar): sections, lists, submenus ▸,
           keyboard, the "…" of a narrow window and the "Help" pinned on the right. Its contents, state and
           commands are given by the spreadsheet adapter (CompactMenuAdapter) over the SheetActions catalog and
           the StockBridge twins. F10 entry is our own (bindKeyboard): the entry stop is the menu bar row,
           and in focus mode — the toolbar (entryStop); the row holds the engine keyboard through
           the shell (keysForMenu), so a Tab move from the row to the toolbar does not give it up. */

        buildMenu: function () {
            var me = this;
            if (this.menu && typeof this.menu.destroy === 'function') this.menu.destroy();
            this.menuAdapter = MenuAdapter.create(this, this.api);
            this.menu = MenuBar.create(this.menuAdapter, {pinned: 'help', icons: Icons, f10: false});
            var bar = this.menu.el;
            bar.setAttribute('aria-label', this.textMenuBar_ARIA);
            /* Surfaces are mutually exclusive (closeSurfaces): a press in the menu bar row closes
               the others. The row stops the bubbling of its clicks, so we listen in the capture phase. */
            bar.addEventListener('click', guarded('shell: menu and other surfaces', function () { me.closeOthers(); }), true);
            this.subs.push(function () { if (me.menu && typeof me.menu.destroy === 'function') me.menu.destroy(); });
            this.rows.menu = bar;
            return bar;
        },

        /* The engine keyboard at the menu bar row — the same shell hold as for the toolbar and the header: take it
           (holdKeys), give it up before a command (beforeCommand). The row releases it when focus
           leaves it; if it stayed in the shell (Tab to the toolbar, the header), the hold stays —
           the next tick decides, as when focus leaves the area (bindKeyboard). */
        keysForMenu: function () {
            var me = this;
            return {
                hold: guarded('shell: menu keys', function () { me.holdKeys(); }),
                release: guarded('shell: menu keys', function () {
                    setTimeout(guarded('shell: menu keys', function () {
                        if (me.keysHeld && !me.pendingFocus && !me.focusInShell()) me.releaseKeys();
                    }), 0);
                }),
                beforeCommand: guarded('shell: menu keys', function () { me.beforeCommand(); })
            };
        },

        /* The separator and the availability look of a shell list row — for the header "Download" and for the column
           header menu (ColumnHeaderMenu): an inactive row — by the vo-locked class and
           aria-disabled, not the disabled attribute (a disabled button gets no click from the browser, and
           rechecking availability on choice would stop working), the reason is in the tooltip. */
        menuSep: function () {
            var sep = document.createElement('div');
            sep.className = 'vo-mn-sep';
            sep.setAttribute('role', 'separator');
            return sep;
        },

        rowState: function (row, st) {
            var off = !!(st && st.disabled);
            row.classList.toggle('vo-locked', off);
            row.setAttribute('aria-disabled', off ? 'true' : 'false');
            if (st && st.reason) row.setAttribute('title', st.reason);
            else row.removeAttribute('title');
        },

        /* The only "close all our popup surfaces" point: the menu bar row (its
           sections, submenus and the gallery at a row), the toolbar lists, palettes and "⋯" — they
           do not live at the same time, as in documents. It is called by a click elsewhere, Escape, a stock
           modal window and menu, the switch to Stock, focus mode and the choice of an item.
           The stock gallery at a toolbar row closes with them. The menu bar row — first: its
           gallery is closed by itself, without a close report to stock.
           keep — the toggle node that is being opened right now: if it lies in "⋯" —
           we do not close "⋯" (the control went there as a live node). The hover tooltip goes away with them:
           the surface will open in its place, and a chrome change (focus mode, hidden toolbar) moves the rows. */
        closeSurfaces: function (keep) {
            if (this.menu) this.menu.close();
            this.closeOthers(keep);
        },

        /* All surfaces except the menu bar row. If the menu bar row is open — its stock gallery. */
        closeOthers: function (keep) {
            CompactToolbar.hideTip();
            if (!(this.menu && this.menu.isOpen())) Bridge.closePopup('close');
            var tb = this.tb;
            if (tb) {
                if (!(keep && tb.inOverflow(keep))) tb.closeOverflow();
                tb.closePopovers();
            }
            ColumnHeaderMenu.close();
            this.closeModePopover();
            this.closeDownload();
        },

        hasOpenSurfaces: function () {
            if (Bridge.popupOpen()) return true;
            if (this.tb && this.tb.hasOpenPopover()) return true;
            if (ColumnHeaderMenu.isOpen()) return true;
            if (this.modeOpen()) return true;
            if (this.downloadOpen()) return true;
            return !!this.menu && this.menu.isOpen();
        },

        /* Escape removes one top layer: the stock gallery at a toolbar row, the submenu
           and the toolbar list, "⋯", the column header menu (its submenu, then the menu itself),
           the mode list or the header "Download". The menu bar row layers are removed by it itself (its Escape is
           earlier than ours); here — only closing it entirely. Surfaces
           do not live at the same time — the order matters only within one. */
        closeTopSurface: function () {
            if (this.menu && this.menu.isOpen()) { this.menu.close(); return true; }
            if (Bridge.closePopup('escape')) return true;
            if (this.tb && this.tb.closeTopPopover()) return true;
            if (ColumnHeaderMenu.closeTop()) return true;
            if (this.modeOpen()) { this.closeModePopover(); return true; }
            if (this.downloadOpen()) { this.closeDownload(); return true; }
            return false;
        },

        /* Whom to return focus to when a layer is closed (Escape): the mode switch button or
           "Download", the toolbar control — the first visible one. The menu bar row layers return focus themselves. */
        openerChain: function (el) {
            var out = [];
            if (!el || el.nodeType !== 1) return out;
            if (this.tb && typeof this.tb.openerChain === 'function') out = out.concat(this.tb.openerChain(el));
            var ui = this.modeUi;
            if (ui && ui.pop && ui.pop.contains(el)) out.push(ui.btn);
            var dl = this.downloadUi;
            if (dl && dl.pop.contains(el)) out.push(dl.btn);
            return out;
        },

        refocus: function (prev, chain) {
            if (!prev || prev.nodeType !== 1 || !document.getElementById(SHELL_ID)) return;
            var shown = function (el) { return !!el && el.isConnected !== false && el.getClientRects().length > 0; };
            if (shown(prev) && document.activeElement === prev) return;
            /* The node is alive, but focus was taken away by stock (hiding its gallery gave the keyboard
               to the sheet) — return it to the node itself, earlier than to the parents. */
            var list = [prev].concat(chain || []);
            for (var i = 0; i < list.length; i++) {
                if (shown(list[i])) { this.focusHeld(list[i]); return; }
            }
        },

        /* Focus on our node while the engine keyboard is held by the shell. Stock on hiding its
           menu and on focus leaving its gallery itself gives the keyboard to the sheet ('menu:hide',
           'dataview:blur' → asc_enableKeyEvents(true), controller/Main.js), and the engine immediately
           takes focus to itself: after the stock gallery at our row closed, focus went
           to the sheet. The keyboard is turned off again, and focus returns on the next tick, if
           stock took it after us; leaving the area is not counted as leaving for this time. */
        pendingFocus: null,

        focusHeld: function (el) {
            if (!this.keysHeld) { el.focus(); return; }
            this.pendingFocus = el;
            this.holdKeys();
            el.focus();
            this.keepFocus(el);
        },

        /* Returning focus to our node if stock takes it away on the next tick (focusHeld; a move from the field into
           the shell and F10 entry from the field, when the field applied the value on leaving and stock deferred focus
           to the sheet — keepFieldMove). */
        keepFocus: function (el) {
            var me = this;
            this.pendingFocus = el;
            /* We return only if focus was taken out of the shell (to the sheet, to body): the person's
               input goes before the timers, and their next step around the shell we do not touch. Two
               checks: at once and after stock's deferred focus (DocumentHolder.focus —
               _.defer on edit:complete, sent, for example, by hiding the shapes gallery). If the node disappeared during this
               time and focus is not in the shell — the hold is removed by the last check: leaving the
               area while the checks were going is skipped by onOut, and without it the engine keyboard
               would have stayed off with focus outside the shell. */
            var check = function (last) {
                return guarded('shell: keep focus', function () {
                    if (me.pendingFocus !== el) return;
                    if (last) me.pendingFocus = null;
                    if (!me.keysHeld || me.focusInShell()) return;
                    if (el.isConnected && el.getClientRects().length) {
                        me.holdKeys();
                        el.focus();
                    }
                    if (last && !me.focusInShell()) me.releaseKeys();
                });
            };
            setTimeout(check(false), 0);
            setTimeout(check(true), KEEP_FOCUS_MS);
        },

        /* --- Keyboard entry --------------------------------------- */
        /* The engine keeps focus at its input field (#area_id) while its keyboard is on:
           focus outside the field it takes right back (focus() on a menu bar row
           button — and activeElement is area_id again), and Tab on the sheet moves the cell, — from the sheet one cannot get into the
           shell by keyboard. The entry is F10, as into the menu bar of desktop programs
           (in stock F10 without modifiers is free, ⇧F10 is the context menu): the engine keyboard
           is turned off — with the same asc_enableKeyEvents(false) as the stock Alt hints
           (HintManager), — and focus goes to the menu bar row stop. While focus is in the
           #toolbar area (the shell and the stock gallery at our row), the engine keyboard is off;
           if focus went further (Tab from the toolbar, a stock command returned it to the sheet by edit:complete) —
           it is turned on. Escape with no open layers — back to the sheet. The mouse changes nothing:
           focus from a click is taken by the engine, as before. */

        keysHeld: false,

        holdKeys: function () {
            var api = this.api;
            if (api && typeof api.asc_enableKeyEvents === 'function') api.asc_enableKeyEvents(false);
            this.keysHeld = true;
        },

        /* While a stock window is open, the shell does not turn the engine keyboard on — it only removes
           its own hold: the window will return it itself when it closes (modal:close / modal:hide —
           controller/Main.js), the same way the stock Alt hints release it
           (HintManager._lockedKeyEvents). Turned on over a window, it would take focus out of its field
           to the sheet (asc_enableKeyEvents(true) puts focus into the engine field — sdkjs text_input2.js,
           setInterfaceEnableKeyEvents), and a letter would start cell editing behind the window
           (so focus leaving #toolbar into a stock window would give the keyboard to the sheet). */
        releaseKeys: function () {
            if (!this.keysHeld) return;
            this.keysHeld = false;
            var MW = window.Common && Common.Utils && Common.Utils.ModalWindow;
            if (MW && typeof MW.isVisible === 'function' && MW.isVisible()) return;
            var api = this.api;
            if (api && typeof api.asc_enableKeyEvents === 'function') api.asc_enableKeyEvents(true);
        },

        /* The formula bar in the plate is a stock field, not a shell control: focus in it does not hold
           the engine keyboard (cell editing in the field goes through the engine), as in the stock place. */
        focusInShell: function () {
            var a = document.activeElement, area = document.getElementById('toolbar');
            return !!a && a !== document.body && !!area && area.contains(a) && !FormulaBar.owns(a) &&
                   (typeof a.getClientRects !== 'function' || a.getClientRects().length > 0);
        },

        /* The F10 entry stop — the first visible shell row: the menu bar row (the entry is its enter(): its
           current section); in focus mode the header and the menu bar row are hidden (display: none) — the stop is the
           toolbar (its current control, CompactToolbar.entryStop: in focus mode only it is visible, and in
           it the exit chevron too); and the toolbar is not visible either (focus mode in "Viewing") — there is no entry. */
        entryStop: function () {
            var bar = this.menu && this.menu.el;
            if (bar && bar.isConnected !== false && bar.getClientRects().length > 0) return bar;
            var tb = this.tb;
            return tb && typeof tb.entryStop === 'function' ? tb.entryStop() : null;
        },

        /* The engine keyboard is turned off only if focus landed on a stop: a hold without focus
           in the shell is a dead keyboard (F10 in focus mode would hold the keyboard,
           while focus would not land on the hidden "File" and would stay at #area_id — letters and arrows would go
           nowhere, Escape would leave focus mode but not release the hold, nor would a click on a cell).
           No stop or focus did not land — the key is not ours: no hold, the sheet is alive, as without F10, and
           focus stays where it was before F10 (from a field the released hold would have turned on the engine keyboard, and it
           would have taken focus to the sheet). F10 from a field — of chat, search bar, comment, cell name,
           our own font size and color code — enters, as from the sheet: focus leaving the field into the shell is held by
           keepFieldMove, which also replays the sheet's deferred focus if the field applied
           the value on leaving (a typed font size — fieldAsk). The menu bar row enters by itself
           (MenuBar.enter: the hold via keysForMenu, focus on its stop). */
        enterMenu: function () {
            if (!this.menu || this.advanced || this.startupFailed) return false;
            var stop = this.entryStop();
            if (!stop) return false;
            var prev = document.activeElement, held = this.keysHeld, ok;
            this.closeSurfaces();
            if (stop === this.menu.el) {
                ok = this.menu.enter() === true;
            } else {
                this.holdKeys();
                stop.focus();
                ok = document.activeElement === stop;
            }
            if (ok) return true;
            if (!held) this.releaseKeys();
            if (prev && prev !== document.body && prev !== document.activeElement && prev.isConnected !== false &&
                typeof prev.focus === 'function' && prev.getClientRects().length > 0) prev.focus();
            return false;
        },

        /* A focus move from a field into the shell while the keyboard is held by the shell. The stock delegate
           blur on input and textarea (controller/Main.js: $(document.body).on('blur', 'input, textarea') —
           in jQuery 4 this is focusout on body) turns on the engine keyboard if focus left the field not into another
           field and not to a sibling by parent. It does not know about the shell hold, and the engine immediately takes focus to
           the sheet (asc_enableKeyEvents(true) → text_input2.js setInterfaceEnableKeyEvents → #area_id). A leave
           from #area_id the delegate skips — that is why F10 entry worked from the sheet but not from a field (chat, search bar,
           comment, cell name, our own font size and color code); by the same path Shift+Tab from the font size to the menu bar
           row and ↑/↓ from the color code field took focus to the sheet. Where focus was going is visible
           on the blur capture (noteFieldMove — earlier than any handlers: on blur relatedTarget is still intact), and
           it is fixed by keepFieldMove on the focusout bubbling at window — after the delegate: it was going into the shell, and
           ended up outside it — the hold again and focus to where it was going (the second leave is already from #area_id, which the
           delegate skips). Without a hold (mouse) — nothing: all is stock.
           The field on leaving may give focus to the sheet later too: a typed font size is applied on blur
           (CompactToolbar.sizeCtrl), and after applying stock sends edit:complete — a deferred focus to the sheet
           (Main.onEditComplete → DocumentHolder.focus, _.defer). A key move into the shell (Shift+Tab to the
           menu bar row, ← and → at the field edge to "−" and "+", F10 entry) ended up at the sheet after the move: the hold
           was released, the next letter started cell editing. If during leaving the field stock
           asked for focus for the sheet this way (fieldAsk), the move replays it — keepFocus, like focusHeld: the checks
           after stock's deferred focus (its timer was queued earlier than ours). Without such a request
           there is no return: otherwise a quick Tab out of the shell right after the move would return back (the
           keyboard_reaches_every_control regression). One path for all moves from a field into the shell and for F10 entry from a field. */
        fieldMove: null,

        noteFieldMove: function (e) {
            this.fieldMove = null;
            if (!this.keysHeld || this.advanced || !e) return;
            var t = e.target, to = e.relatedTarget, area = document.getElementById('toolbar');
            if (!isField(t)) return;
            if (!to || to.nodeType !== 1 || !area || !area.contains(to) || FormulaBar.owns(to)) return;
            this.fieldMove = {from: t, to: to};
        },

        keepFieldMove: function (e) {
            var mv = this.fieldMove;
            if (!mv || !e || mv.from !== e.target) return;
            this.fieldMove = null;
            var to = mv.to, asked = this.fieldAsk === mv.from;
            if (asked) this.fieldAsk = null;
            /* The stock deferred sheet focus on this move is already not executed (holdSheetFocus) —
               there is nothing to insure: the keepFocus return would cancel the person's next move (a quick Tab out of
               the shell). */
            if (asked && this.sheetAskHeld === mv.from) asked = false;
            this.sheetAskHeld = null;
            if (!this.keysHeld) return;
            if (to.isConnected === false || !to.getClientRects().length) return;
            if (document.activeElement !== to) {
                this.holdKeys();
                to.focus();
            }
            if (asked) this.keepFocus(to);
        },

        /* The stock request for sheet focus (edit:complete) while the keyboard is held by the shell, from the field from
           which focus is leaving (fieldAsk). Leaving a field is from change to the bubbling of focusout: a changed
           field is first taken out of focus by Chrome and gets change, then blur and focusout (measured:
           on change activeElement is already body). Applying on change is for the stock ComboBox, on blur — for the
           right panel MetricSpinner (the focusout delegate) and for our own font size; so the field on leaving
           is remembered from change (fieldLeave), and from the blur capture — the move (fieldMove). Both records live until
           the end of the task: a move from a field is one task (a key or the F10 entry focus()); what the move
           did not take is removed on the next tick. */
        fieldAsk: null,
        fieldLeave: null,
        sheetAskHeld: null,

        noteFieldLeave: function (e) {
            if (!this.keysHeld || this.advanced || !e) return;
            var t = e.target;
            if (!isField(t) || document.activeElement === t) return;
            this.forTask('fieldLeave', t);
        },

        noteFieldAsk: function () {
            if (!this.keysHeld || this.advanced) return;
            var from = this.fieldMove ? this.fieldMove.from : this.fieldLeave;
            if (from) this.forTask('fieldAsk', from);
        },

        /* The record until the end of the task: removed on the next tick if it was not taken and not overwritten. */
        forTask: function (key, el) {
            var me = this;
            this[key] = el;
            setTimeout(guarded('shell: ' + key, function () { if (me[key] === el) me[key] = null; }), 0);
        },

        /* The menu bar row's Escape took focus out of it: the key came from the row, and focus is now outside it. */
        leftMenuBar: function (e) {
            var bar = this.menu && this.menu.el, t = e && e.target, a = document.activeElement;
            return !!bar && !!t && t.nodeType === 1 && bar.contains(t) && !(a && bar.contains(a));
        },

        leaveToSheet: function () {
            this.closeSurfaces();
            this.releaseKeys();
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* The stock deferred sheet focus when leaving a field by key into the shell. The field on
           leaving applies the value (a typed font size — on blur, CompactToolbar.sizeCtrl), stock sends
           edit:complete, and Main.onEditComplete calls DocumentHolder.focus — focus of #editor_sdk via
           _.defer. It arrived ~10 ms after focus had already landed on the move target (Shift+Tab to
           "File", → at the edge to "+", F10 entry), and until the keepFocus return (KEEP_FOCUS_MS) focus stood on
           #editor_sdk with the engine keyboard off: the next quick key was lost (→ did not
           move), Tab took it to the sheet, and the keepFocus return canceled the person's move (measured: a window of
           ~45–75 ms). When stock asks for sheet focus in the middle of a move from a field into the shell — the move is marked
           by the blur capture (noteFieldMove), the keyboard is held by the shell, — the request is not executed: focus
           stays on the move target, and the keepFocus return is not needed for this move (keepFieldMove does not set it
           — otherwise it would cancel a quick Tab of the person out of the shell). The other calls are stock: without
           a hold (mouse, a command — beforeCommand releases the hold before it), in Stock, from the sheet. The substitution
           is a property of the view instance, removed together with the shell subscriptions, if nobody has
           overridden it. */
        holdSheetFocus: function () {
            var me = this;
            var ctl = SSE.getController && SSE.getController('DocumentHolder');
            var view = ctl && typeof ctl.getView === 'function' ? ctl.getView('DocumentHolder') : null;
            if (!view || typeof view.focus !== 'function') return;
            var own = Object.prototype.hasOwnProperty.call(view, 'focus'), orig = view.focus;
            /* The decision without exceptions outward: the wrapper is called by the stock Main.onEditComplete, and a failure here
               would break it. Could not decide — the stock focus, as without the wrapper. */
            var wrapped = function () {
                var from = null;
                try {
                    if (me.fieldMoveAsksSheet()) from = me.fieldMove.from;
                } catch (e) {
                    from = null;
                }
                if (!from) return orig.apply(this, arguments);
                try {
                    me.forTask('sheetAskHeld', from);
                } catch (e) {
                    /* without the flag keepFieldMove will set the previous keepFocus return */
                }
            };
            view.focus = wrapped;
            this.subs.push(function () {
                if (view.focus !== wrapped) return;
                if (own) view.focus = orig;
                else delete view.focus;
            });
        },

        /* The sheet focus request came in the middle of a key move from a field into the shell (fieldMove of this task). */
        fieldMoveAsksSheet: function () {
            var mv = this.fieldMove, area = document.getElementById('toolbar');
            return !this.advanced && !this.startupFailed && this.keysHeld && !!mv && !!area && area.contains(mv.to) && !FormulaBar.owns(mv.to);
        },

        /* A stock command launched from the shell by keyboard (F10): the engine keyboard
           is returned to the sheet BEFORE the command — the way it happens on a mouse click, where the engine
           takes focus from the button before it (asc_enableKeyEvents(true) itself puts focus into its
           field — sdkjs text_input2.js, setInterfaceEnableKeyEvents). After that focus is set by stock itself,
           by the same path as after the mouse: into the search, chat or comment field (they have their own
           deferred focus), into a window (modal:show), and without a place of its own focus stays at the sheet.
           After the command the shell does not touch focus. One step for all shell commands: an item and
           submenu of the menu bar row (MenuBar: keys.beforeCommand → keysForMenu), a toolbar control and its list row, a palette,
           a typed font size — and the same in "⋯" (CompactToolbar.beforeCommand), the header buttons (history,
           access) and the "Download" rows. The shell's own layers (lists, "⋯", submenus, the mode switch
           and the "Download" list, the chevron, the title field) are not stock commands: focus stays
           in the shell.
           Without this step the command went while the keyboard was held by the shell, and it was given up by focus
           leaving #toolbar (onOut) — after stock had put focus into its field: the engine
           took it to the sheet ("Find and replace" and "Chat" of the menu bar row,
           "Comment", "Link", "Data validation" of the toolbar; a typed letter started cell
           editing). From the mouse (the keyboard is not with the shell) — nothing. */
        beforeCommand: function () {
            this.releaseKeys();
        },

        /* The stock gallery at a toolbar list row (and the same in "⋯"), opened from the keyboard (→, Enter
           or Space on a row with ▸, CompactToolbar.focusSub): focus moves into it — to where
           stock itself puts it when entering its submenu (StockBridge.popupEntry). DataView galleries and
           palettes with focusOnShow are focused by stock itself (show:after), while list galleries — "Border
           style", "Border color", SmartArt, "Equation" — are not, nor is a gallery that it builds
           on first opening ("Table"): focus stayed on our row, → and ↓ moved through our
           list under the open gallery, and it was impossible to choose in it from the keyboard.
           Stock has already put focus into the gallery — we do not touch it. The content is not ready yet — two more
           attempts after KEEP_FOCUS_MS. Focus is set by focusHeld: the hold is with the shell, and focus being taken away
           by stock (menu:hide, dataview:blur) is replayed. From the mouse (the keyboard is not with the shell) —
           nothing: focus is set by stock itself, as before. The gallery at a menu bar row is focused by its
           adapter (CompactMenuAdapter, focusRow) with the same focusHeld. */
        focusGallery: function () {
            if (!this.keysHeld) return;
            var me = this, tries = 0;
            var go = guarded('shell: gallery focus', function () {
                var a = document.activeElement;
                if (!me.keysHeld || !Bridge.popupOpen() || (a && Bridge.popupOwns(a))) return;
                var to = Bridge.popupEntry();
                if (to) { me.focusHeld(to); return; }
                if (++tries < 3) setTimeout(go, KEEP_FOCUS_MS);
            });
            go();
        },

        /* ← on an item of the list gallery itself — back to our row, like ← from our submenu
           (the menu bar row, CompactToolbar.popKey): the gallery closes, focus goes to the row that opened it
           (for a toolbar row — openerChain, refocus, as for Escape; for a menu bar row — the menu bar row itself,
           when the adapter reports to it that the gallery closed). Stock on this key would remove the class over from a nested
           gallery ("Border style", "Border color" — a submenu of the stock "Borders" menu) and
           put focus on its holder item in the hidden ribbon (Bootstrap.js, patchDropDownKeyDown:
           37): focus was lost, the menu closed entirely, the keyboard went to the sheet. The key is
           the stock ← (37) and in RTL too: inside the gallery the key layout is stock's (→ opens its
           submenu). Inside a DataView and a palette ← is their move over swatches, we do not touch it, except ← at the edge of
           a DataView, after which stock would go to the holder in the hidden ribbon (dataViewLeavesToHolder:
           histograms, color scales, icon sets), — it too goes to our row; in the
           submenu of gallery items ← closes the submenu by stock itself. With Shift, Ctrl, Alt or ⌘ — the same: stock
           does not distinguish modifiers on ← (DataView.onKeyDown — by keyCode, the Bootstrap delegate — by keyCode
           37) and with them would take focus to the holder in the hidden ribbon; inside
           the grid ← with a modifier is again the DataView's own move. */
        galleryKey: function (e) {
            if (!e || e.key !== 'ArrowLeft') return;
            if (this.advanced || !this.keysHeld) return;
            var st = Bridge.popupOpen() ? Bridge.shown : null, ul = st && st.ul, t = e.target;
            if (!ul || !t || t.nodeType !== 1 || !ul.contains(t)) return;
            var listItem = t.tagName === 'A' && !!t.parentNode && t.parentNode.parentNode === ul;
            if (!listItem && !dataViewLeavesToHolder(ul, t)) return;
            var chain = this.openerChain(t);
            Bridge.closePopup('escape');
            this.refocus(t, chain);
            e.preventDefault && e.preventDefault();
            e.stopPropagation && e.stopPropagation();
        },

        bindKeyboard: function () {
            var me = this;
            var onKey = guarded('shell: F10', function (e) {
                if (!e || e.key !== 'F10' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
                if (me.advanced || !document.getElementById(SHELL_ID)) return;
                var MW = window.Common && Common.Utils && Common.Utils.ModalWindow;
                if (MW && typeof MW.isVisible === 'function' && MW.isVisible()) return;
                if (me.api && me.api.isCellEdited) return;
                if (!me.enterMenu()) return;
                e.preventDefault && e.preventDefault();
                e.stopPropagation && e.stopPropagation();
            });
            window.addEventListener('keydown', onKey, true);
            this.subs.push(function () { window.removeEventListener('keydown', onKey, true); });
            /* ← in a list gallery — earlier than the Bootstrap delegate on document (galleryKey). */
            var onGallery = guarded('shell: gallery keys', function (e) { me.galleryKey(e); });
            window.addEventListener('keydown', onGallery, true);
            this.subs.push(function () { window.removeEventListener('keydown', onGallery, true); });
            /* A focus move from a field into the shell under a hold — the blur capture and the focusout bubbling at window
               (noteFieldMove, keepFieldMove); the stock request for sheet focus from a field on
               leaving — the change capture and edit:complete (noteFieldLeave, noteFieldAsk). */
            var onFieldChange = guarded('shell: field left', function (e) { me.noteFieldLeave(e); });
            var onFieldBlur = guarded('shell: field left', function (e) { me.noteFieldMove(e); });
            var onFieldOut = guarded('shell: field left', function (e) { me.keepFieldMove(e); });
            window.addEventListener('change', onFieldChange, true);
            window.addEventListener('blur', onFieldBlur, true);
            window.addEventListener('focusout', onFieldOut);
            this.subs.push(function () {
                window.removeEventListener('change', onFieldChange, true);
                window.removeEventListener('blur', onFieldBlur, true);
                window.removeEventListener('focusout', onFieldOut);
            });
            this.onNote('edit:complete', function () { me.noteFieldAsk(); });
            this.holdSheetFocus();
            var area = document.getElementById('toolbar');
            if (!area || typeof area.addEventListener !== 'function') return;
            var onOut = guarded('shell: focus left', function () {
                setTimeout(guarded('shell: focus left', function () {
                    if (me.keysHeld && !me.pendingFocus && !me.focusInShell()) me.releaseKeys();
                }), 0);
            });
            area.addEventListener('focusout', onOut);
            this.subs.push(function () { area.removeEventListener('focusout', onOut); });
        },

        /* A click elsewhere, a stock modal window (our layers lie below the modal
           scale) and the opening of a stock menu close our surfaces.
           A click elsewhere is a pointerdown on window in the capture phase, not mousedown:
           over the grid (the engine canvas, row and column headings) and over the sheet row
           buttons the engine cancels pointerdown, and the browser does not produce a compatible mousedown at
           all — the menu would stay hanging over the sheet (in
           documents it is the same — CompactToolbar). The capture on window is earlier than
           any engine handlers. Without pointer events — mousedown. */
        bindMenu: function () {
            var me = this;
            var outside = guarded('shell: menu outside click', function (e) {
                /* The same press capture ends the row transition — earlier than the engine. */
                me.pressDuringMotion(e);
                if (!me.hasOpenSurfaces()) return;
                var t = e && e.target;
                if (t && t.nodeType === 1 && me.menu && me.menu.el.contains(t)) return;
                /* Inside the stock gallery at our row: the choice in it is stock, and
                   it closes itself and us (StockBridge.popup, onClose). */
                if (t && Bridge.popupOwns(t)) return;
                /* Inside an open toolbar surface (its button, list, "⋯"):
                   the control itself toggles and closes it. */
                if (t && me.tb && me.tb.ownsTarget(t)) return;
                /* Inside the column header menu: the item chooses and closes it itself. */
                if (t && ColumnHeaderMenu.ownsTarget(t)) return;
                /* Inside the mode switch: the button and the mode row close it themselves. */
                if (t && me.modeUi && me.modeUi.wrap.contains(t)) return;
                /* Inside "Download": the button and the row close the list themselves. */
                if (t && me.downloadUi && me.downloadUi.wrap.contains(t)) return;
                me.closeSurfaces();
            });
            var DOWN = ('onpointerdown' in window) ? 'pointerdown' : 'mousedown';
            window.addEventListener(DOWN, outside, true);
            this.subs.push(function () { window.removeEventListener(DOWN, outside, true); });
            this.onNote('modal:show', function () { me.closeSurfaces(); });
            /* The stock gallery menu that we showed (StockBridge.popup) sends the same
               menu:show — this is our layer, we do not close the others. */
            this.onNote('menu:show', function () { if (!Bridge.popupOpen()) me.closeSurfaces(); });
            this.bindChromeEscape();
            this.bindKeyboard();
        },

        /* One Escape handler (independent listeners of each
           surface family swallowed each other). While our layer is open, Escape
           closes it alone and goes no further; in Stock the key is not ours.
           We listen on window in the capture phase, like the documents SlashMenu: during cell
           editing focus is at the engine input field, and its handler swallows the bubbling of
           Escape — the key did not reach document, but canceled the edit, and the menu
           stayed open. So when a layer is removed,
           the key is swallowed (preventDefault + stopPropagation): one press — one
           action, the cell edit is alive, the next Escape will cancel it — the stock
           ribbon dropdown menu behaves the same way. Without open layers we intercept
           nothing. Without open layers — the second action of the same handler:
           returning the header and the menu bar row from focus mode and the toolbar after "Hide
           toolbar", already without swallowing the key, as in documents. From the field
           of the stock left area panel — a tick later and only if the field did nothing
           with the key (chromeAfterField). */
        bindChromeEscape: function () {
            var me = this;
            var onKey = guarded('shell: Escape', function (e) {
                if (!e || (e.key !== 'Escape' && e.keyCode !== 27)) return;
                if (me.advanced) return;
                /* The menu bar row's Escape is its own, on the same window and earlier than ours: it removed
                   its layer or returned focus to whoever had it before entering it — the key has already been handled.
                   Left a row that was entered from the keyboard (F10) — to the sheet, as from the other rows: both when
                   focus left the shell and when the row returned it to the shell (entering the row by
                   Tab or Shift+Tab from a toolbar or header control). A removed layer leaves focus in the row. */
                if (e.defaultPrevented) {
                    if (me.keysHeld && me.menu && !me.menu.isOpen() && (!me.focusInShell() || me.leftMenuBar(e))) me.leaveToSheet();
                    return;
                }
                if (me.hasOpenSurfaces()) {
                    /* Focus was in the removed layer — it goes to whoever opened the layer:
                       otherwise it would fall onto body, and the keyboard would lose its place. */
                    var prev = document.activeElement, chain = me.openerChain(prev);
                    me.closeTopSurface();
                    me.refocus(prev, chain);
                    e.preventDefault && e.preventDefault();
                    e.stopPropagation && e.stopPropagation();
                    return;
                }
                /* Focus in the version history window — the same as its cross (historyEscape). */
                if (me.historyEscape(e)) {
                    e.preventDefault && e.preventDefault();
                    e.stopPropagation && e.stopPropagation();
                    return;
                }
                if (me.contextRibbon) {
                    if (!me.escapeContextTab(e)) return;
                    e.preventDefault && e.preventDefault();
                    e.stopPropagation && e.stopPropagation();
                    return;
                }
                /* Focus in the shell from the keyboard (F10), no layers — back to the sheet. Our
                   field (font size, color code) rolls back by Escape itself. */
                if (me.keysHeld && me.focusInShell() && !/^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) {
                    me.leaveToSheet();
                    e.preventDefault && e.preventDefault();
                    e.stopPropagation && e.stopPropagation();
                    return;
                }
                if (!me.focus && !me.tbHidden) return;
                if (me.escapeTakenElsewhere(e)) return;
                var field = me.leftPanelField(e && e.target);
                if (field) {
                    me.chromeAfterField(field);
                    return;
                }
                me.setChrome({focus: false, tbHidden: false});
            });
            window.addEventListener('keydown', onKey, true);
            this.subs.push(function () { window.removeEventListener('keydown', onKey, true); });
        },

        /* An Escape that has its own addressee does not return the chrome — one press,
           one action: cell editing (the engine cancels it), our field (font size, color
           code — it rolls back itself), the stock window, search bar and menu (the left
           area panel field — a tick later, by what the field did: chromeAfterField). And the engine
           modes that it removes with this key itself (sdkjs cell/view/EventsController.js,
           Esc: stopFormatPainter, stopAddShape): "Format Painter" — the twin
           Toolbar:btnCopyStyle is pressed (stock releases it by asc_onStopFormatPainter) — and shape
           insertion (the public asc_isAddAutoshape). The "marching ants" after copying
           are also removed by Escape, but the engine has no public flag (getCutRange — internals
           of the sheet view): there the key still does both things. */
        escapeTakenElsewhere: function (e) {
            var api = this.api;
            if (api && api.isCellEdited) return true;
            if (Bridge.state('Toolbar:btnCopyStyle').pressed) return true;
            if (api && typeof api.asc_isAddAutoshape === 'function' && api.asc_isAddAutoshape()) return true;
            var t = e && e.target;
            if (!t || t.nodeType !== 1 || typeof t.closest !== 'function') return false;
            if (/^(INPUT|TEXTAREA)$/.test(t.tagName) &&
                (t.closest('#' + SHELL_ID) || (this.contextRibbon && t.closest('#toolbar .toolbar')))) return true;
            return !!t.closest('.asc-window, .dropdown-menu');
        },

        /* The input field of the stock left area panel (#left-menu: search, comments, chat, spelling)
           or null. */
        leftPanelField: function (t) {
            if (!t || t.nodeType !== 1 || typeof t.closest !== 'function') return null;
            return /^(INPUT|TEXTAREA)$/.test(t.tagName) && t.closest('#left-menu') ? t : null;
        },

        /* Escape in a stock left area panel field — first to the field (in focus mode
           the key in the "Find" field would do two things — stock rolled back the typed text, the shell
           returned the chrome). The stock search field rolls Escape back to the accepted text (InputField.
           onKeyDown: setValue) and clears (type=search — the browser default), closes the field's open list.
           If the field did something with the key — the chrome stays, the next Escape will return it;
           if not (an empty search, a comment or chat field — stock has no Escape of its own there) —
           the key's action is one: the chrome, as before. What the field did is visible only after its
           handlers and the browser default — the decision is a tick later. */
        chromeAfterField: function (field) {
            var me = this, before = field.value;
            var list = field.closest('.open');
            if (list && list.closest('#left-menu')) return;
            setTimeout(guarded('shell: Escape in a left panel field', function () {
                if (field.value !== before) return;
                if (me.advanced || (!me.focus && !me.tbHidden)) return;
                me.setChrome({focus: false, tbHidden: false});
            }), 0);
        },

        /* The wheel over a menu list. The SDK wheel handler on bubbling cancels
           the plain wheel, and a long list would not scroll (in documents —
           CompactToolbar.bindPopoverScroll). We do not let the plain wheel go further than
           the list and leave the browser to scroll the nearest
           scrollable node, without passing it to the page at its edges
           (overscroll-behavior: contain); if there is nothing to scroll — we swallow it so that the
           document under the menu does not move. With modifiers — the stock path (zoom). */
        bindListScroll: function (el) {
            var contained = null, previous = [];
            var axes = ['overscroll-behavior-x', 'overscroll-behavior-y'];
            function restore() {
                if (!contained) return;
                axes.forEach(function (axis, i) {
                    if (previous[i].value) contained.style.setProperty(axis, previous[i].value, previous[i].priority);
                    else contained.style.removeProperty(axis);
                });
                contained = null;
            }
            var onWheel = guarded('shell: menu wheel', function (e) {
                restore();
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                e.stopPropagation();
                var node = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
                while (node && el.contains(node)) {
                    var style = window.getComputedStyle(node);
                    if ((/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight) ||
                        (/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth)) {
                        contained = node;
                        previous = axes.map(function (axis) {
                            return {value: node.style.getPropertyValue(axis), priority: node.style.getPropertyPriority(axis)};
                        });
                        axes.forEach(function (axis) { node.style.setProperty(axis, 'contain', 'important'); });
                        return;
                    }
                    if (node === el) break;
                    node = node.parentElement;
                }
                e.preventDefault();
            });
            ['wheel', 'mousewheel', 'DOMMouseScroll'].forEach(function (name) {
                el.addEventListener(name, onWheel, {passive: false});
            });
        },

        /* --- Header --------------------------------------------------------- */
        /* Title · save state · on the right history · "Download" · access · mode: the mode is
           the rightmost, at the window edge; the sizes and gaps are of the right corner of the document header. There are no
           ONLYOFFICE, user, burger, search, right panel and comments marks:
           the avatar is drawn by the portal around the editor, the menu bar row does not collapse at any
           width, search and adding a comment are on the toolbar, the comments panel is opened by
           "Collaboration → Comments" and Ctrl+Shift+H, the right panel opens by itself on
           object selection. The controls that the portal gives (history, access, rename) are only
           present when it really gives them: without the capability there is no control at all, no stubs;
           the title is then text. There is no mode switch without the edit right (buildModeSwitch),
           "Download" — without download and print (buildDownload). The look: history is flat, the mode —
           AIR filled primary, "Download" — an icon without a backing, access tinted. */
        buildHeader: function () {
            var hd = document.createElement('div');
            hd.className = 'vo-hd';

            var title = this.buildTitle();
            var state = this.buildSaveState();

            var right = document.createElement('div');
            right.className = 'vo-hd-right';
            this.collabBtns = {};
            if (this.canHistory()) right.appendChild(this.buildCollabButton('history'));
            var download = this.buildDownload();
            if (download) right.appendChild(download);
            if (this.canSharing()) right.appendChild(this.buildCollabButton('sharing'));
            var mode = this.buildModeSwitch();
            if (mode) right.appendChild(mode);

            /* The hidden twin of the title: the field is fitted to the text width by it (fitTitle).
               The font is the same as the title's, no tracking (compact-shell.less,
               .vo-hd-sizer). */
            var sizer = document.createElement('span');
            sizer.className = 'vo-hd-sizer';
            sizer.setAttribute('aria-hidden', 'true');
            this.sizerEl = sizer;

            hd.appendChild(title);
            hd.appendChild(state);
            hd.appendChild(right);
            hd.appendChild(sizer);
            this.rows.header = hd;
            this.fitTitle();
            return hd;
        },

        /* A mouse press on the header buttons and on the return-from-Stock button — the same flag as
           for the toolbar buttons (CompactToolbar.trackPress): on a press the engine takes focus into its field
           (#area_id), and Chrome removes :active from the button — it stayed in the hover look. The press
           look: "History" — a press tint, the return button — outline-act, the tinted "Access" —
           tinted-act; the filled mode switch has no press look of its own — held down, it
           stays in the hover look; "Download" has neither a hover backing nor a press backing.
           The document listens in the capture phase: the return button lives in the stock header and
           is recreated on every entry into Stock. The header list rows (.vo-pop-item) are not
           header buttons. */
        bindHeaderPress: function () {
            CompactToolbar.trackPress(document, HEADER_PRESS, this, true);
        },

        /* Header tooltips on hover: the same layer as for the toolbar (CompactToolbar.trackTips, the look is the stock
           tooltip), — for the buttons that exist in the header: "History" and "Access" (if the portal gives them), "Download", the mode
           switch (if there is an edit right) and the save icon; after 0.5 s, goes away with the cursor. The place is under the button; for the save icon —
           at the side, after the icon (under it the tooltip would cover the "Edit", "View" and "Insert" of the menu bar row). The text is the same as it
           used to be in title (setTip), for the icon — the save state, and a shown tooltip changes it in place. In
           focus mode there is no header — and no tooltips. */
        bindHeaderTips: function () {
            CompactToolbar.trackTips(this.rows.header, HEADER_TIP, this, function (el) {
                return el.classList.contains('vo-hd-state') ? {side: 'end'} : null;
            });
        },

        /* --- History and access ------------------------ */
        /* The capability is the stock condition for the buttons of the "Collaboration" tab (lib/view/
           ReviewChanges.js): access — the integration handler onRequestSharingSettings
           (canRequestSharingSettings) or the sharing settings address (sharingSettingsUrl),
           history — canUseHistory (the onRequestHistory handler with a license and
           co-authoring). It is read at build time — without the capability there is no control — and once more
           at the moment of the press. */
        stockOptions: function () {
            var main = SSE.getController('Main');
            return (main && main.appOptions) || {};
        },

        canHistory: function () {
            return !!this.stockOptions().canUseHistory;
        },

        canSharing: function () {
            var o = this.stockOptions();
            return !!((o.sharingSettingsUrl && o.sharingSettingsUrl.length) || o.canRequestSharingSettings);
        },

        buildCollabButton: function (kind) {
            var me = this, spec = COLLAB[kind];
            var btn = document.createElement('button');
            btn.setAttribute('type', 'button');
            btn.className = 'vo-ib' + (spec.cls ? ' ' + spec.cls : '') + ' vo-hd-' + kind;
            CompactToolbar.setTip(btn, this[spec.tip]);
            btn.setAttribute('aria-label', this[spec.tip]);
            btn.innerHTML = Icons.svg(spec.icon, 18);
            btn.addEventListener('click', guarded('shell: header ' + kind, function () { me.runCollab(kind); }));
            this.collabBtns[kind] = btn;
            return btn;
        },

        /* The second end of the gate — at the moment of the press: the portal capability and the stock lock. */
        runCollab: function (kind) {
            var spec = COLLAB[kind];
            var can = kind === 'history' ? this.canHistory() : this.canSharing();
            if (!can || this.collabLocked(kind)) { this.applyCollabLock(); return; }
            this.closeSurfaces();
            this.beforeCommand();
            Common.NotificationCenter.trigger(spec.note);
        },

        /* The lock is stock, from the button of the "Collaboration" tab: stock disables it itself
           (lostConnect for both, cantShare for access after losing rights — ReviewChanges.
           onCoAuthoringDisconnect / onLostEditRights). No stock button (the tab is not
           built) — by the stock lost-connection flag. */
        collabLocked: function (kind) {
            var st = Bridge.state(COLLAB[kind].twin);
            if (st.exists) return !!st.disabled;
            var main = SSE.getController('Main');
            return !!(main && main._state && main._state.isDisconnected);
        },

        /* The lock look — by class and aria-disabled, as for the mode switch: a
           disabled button gets no click from the browser, and the second end of the gate would not be checked. */
        applyCollabLock: function () {
            var me = this, btns = this.collabBtns || {};
            Object.keys(btns).forEach(function (kind) {
                var lock = me.collabLocked(kind);
                btns[kind].classList.toggle('vo-locked', lock);
                btns[kind].setAttribute('aria-disabled', lock ? 'true' : 'false');
            });
        },

        /* --- "Download" ------------------------------------------------------- */
        /* A button with a list: formats, a separator, print. The items are catalog entries
           (SheetActions.offered), the same as in "File": the caption (SheetActions.label), the right
           (when), availability and action (itemState, exec) are common to the two entries. Empty by
           rights — there is no button: a list without items would be a stub; one group — without a
           separator. The structure is as for the mode switch: the .vo-pop-wrap wrapper, the
           .vo-pop-list role=menu list, the .vo-pop-item rows; the list is a shell layer (closeSurfaces,
           hasOpenSurfaces, closeTopSurface, openerChain, a click elsewhere — bindMenu). The name and the tooltip
           on hover (CompactToolbar.setTip) — the caption of the "File → Download ▸" item (the same
           SheetActions.label): one command has one name in all places. */
        buildDownload: function () {
            var me = this;
            this.downloadUi = null;
            var groups = DOWNLOAD_GROUPS.map(function (g) {
                return g.map(function (d) {
                    var it = SheetActions.offered(d.k);
                    return it ? {it: it, i: d.i} : null;
                }).filter(Boolean);
            }).filter(function (g) { return g.length > 0; });
            if (!groups.length) return null;

            var tip = SheetActions.label(SheetActions.item('download'));

            var wrap = document.createElement('span');
            wrap.className = 'vo-pop-wrap vo-download';
            var btn = document.createElement('button');
            btn.setAttribute('type', 'button');
            btn.className = 'vo-ib vo-hd-download';
            CompactToolbar.setTip(btn, tip);
            btn.setAttribute('aria-label', tip);
            btn.setAttribute('aria-haspopup', 'menu');
            btn.setAttribute('aria-expanded', 'false');
            btn.setAttribute('aria-controls', DOWNLOAD_MENU_ID);
            btn.innerHTML = Icons.svg('download', 18);
            var pop = document.createElement('div');
            pop.className = 'vo-pop vo-pop-list';
            pop.id = DOWNLOAD_MENU_ID;
            pop.setAttribute('role', 'menu');
            pop.setAttribute('aria-label', tip);
            var rows = [];
            groups.forEach(function (g, n) {
                if (n) {
                    var sep = document.createElement('div');
                    sep.className = 'vo-pop-sep';
                    sep.setAttribute('role', 'separator');
                    pop.appendChild(sep);
                }
                g.forEach(function (d) { pop.appendChild(me.downloadRow(d.it, d.i, rows)); });
            });
            wrap.appendChild(btn);
            wrap.appendChild(pop);
            this.downloadUi = {wrap: wrap, btn: btn, pop: pop, rows: rows};
            btn.addEventListener('click', guarded('shell: download', function (e) {
                e && e.stopPropagation && e.stopPropagation();
                /* We read openness BEFORE closeSurfaces: it closes this list too. */
                var open = !me.downloadOpen();
                me.closeSurfaces();
                if (open) me.openDownload();
            }));
            wrap.addEventListener('keydown', guarded('shell: download keys', function (e) { me.downloadKey(e); }));
            return wrap;
        },

        /* A "Download" row — like a menu bar row item: a glyph and a caption, without a shortcut
           key; before the action — the second end of the gate (availability is re-read, a disabled
           row does nothing and does not close the list), then the list is closed, the keyboard goes to the sheet
           (beforeCommand), the command goes by the catalog item's path. Rows are not Tab stops: they
           are walked by arrows (downloadKey). */
        downloadRow: function (it, glyph, rows) {
            var me = this;
            var row = document.createElement('button');
            row.setAttribute('type', 'button');
            row.className = 'vo-pop-item';
            row.setAttribute('role', 'menuitem');
            row.setAttribute('tabindex', '-1');
            row.setAttribute('data-k', it.k);
            var i = document.createElement('span');
            i.className = 'vo-pop-i';
            i.innerHTML = Icons.svg(glyph, 18);
            var t = document.createElement('span');
            t.className = 'vo-pop-t';
            t.textContent = SheetActions.label(it);
            row.appendChild(i);
            row.appendChild(t);
            this.rowState(row, SheetActions.itemState(it, this));
            rows.push({row: row, it: it});
            row.addEventListener('click', guarded('shell: download item', function (e) {
                e && e.stopPropagation && e.stopPropagation();
                var now = SheetActions.itemState(it, me);
                me.rowState(row, now);
                if (now.disabled) return;
                me.closeSurfaces();
                me.beforeCommand();
                SheetActions.exec(it, me);
            }));
            return row;
        },

        /* Row availability — on opening the list and on ban events (applyEditingLock). */
        refreshDownloadRows: function () {
            var me = this, ui = this.downloadUi;
            if (!ui) return;
            ui.rows.forEach(function (rec) { me.rowState(rec.row, SheetActions.itemState(rec.it, me)); });
        },

        downloadOpen: function () {
            var ui = this.downloadUi;
            return !!(ui && ui.wrap.classList.contains('open'));
        },

        openDownload: function () {
            var ui = this.downloadUi;
            if (!ui) return;
            this.refreshDownloadRows();
            ui.wrap.classList.add('open');
            ui.btn.setAttribute('aria-expanded', 'true');
        },

        closeDownload: function () {
            var ui = this.downloadUi;
            if (!ui || !ui.wrap.classList.contains('open')) return;
            ui.wrap.classList.remove('open');
            ui.btn.setAttribute('aria-expanded', 'false');
        },

        /* The "Download" keyboard — as for the mode switch (modeKey): ↓, Enter and Space on
           the button open the list and put focus on the first row, ↑ — on the last; in the list
           ↑/↓ go around in a circle, Home/End — the extreme rows, Enter and Space — click on the row, as with the mouse;
           Tab closes the list and goes on as usual; Escape is common (bindChromeEscape,
           openerChain → the button). The list is role=menu: the stock Bootstrap delegate would swallow both
           the choice and Tab (the stock Bootstrap delegate on keydown in [role=menu]), so handled keys do not go
           further, Tab — without preventDefault. */
        downloadKey: function (e) {
            var ui = this.downloadUi;
            if (!ui || !e || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || this.advanced) return;
            var t = e.target, key = e.key;
            var items = ui.rows.map(function (rec) { return rec.row; });
            var n = items.length;
            if (!n) return;
            if (t === ui.btn) {
                if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter' && key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                if (!this.downloadOpen()) {
                    this.closeSurfaces();
                    this.openDownload();
                }
                items[key === 'ArrowUp' ? n - 1 : 0].focus();
                return;
            }
            var i = items.indexOf(t);
            if (i < 0) return;
            if (key === 'Tab') {
                this.closeDownload();
                ui.btn.focus();
                e.stopPropagation();
                return;
            }
            if (key === 'ArrowDown') items[(i + 1) % n].focus();
            else if (key === 'ArrowUp') items[(i - 1 + n) % n].focus();
            else if (key === 'Home') items[0].focus();
            else if (key === 'End') items[n - 1].focus();
            else if (key === 'Enter' || key === ' ') t.click();
            else return;
            e.preventDefault();
            e.stopPropagation();
        },

        documentTitle: function () {
            var main = SSE.getController('Main');
            var doc = main && main.appOptions && main.appOptions.spreadsheet;
            var t = doc && doc.title != null ? String(doc.title).trim() : '';
            return t || this.textDocument;
        },

        /* --- Title ------------------------------------------------ */
        /* We do not show the extension: it is about the file format, not the title — the same as
           for the name in the document shell and for the stock header (withoutExt, cutDocName).
           The portal gives renaming (the stock canRename — the onRequestRename handler) and the
           book has the edit right — the title is edited in place, by a field; otherwise — text, and the
           full name is in the tooltip. A field, not contenteditable: the engine holds the keyboard
           for itself, and the stock header for the same reason is a field (Header.js). */
        buildTitle: function () {
            var full = this.documentTitle();
            var dot = full.lastIndexOf('.');
            this.titleWas = dot > 0 ? full.slice(0, dot) : full;
            var o = this.stockOptions();
            var el;
            if (o.canRename && this.editRight === true) {
                el = document.createElement('input');
                el.setAttribute('type', 'text');
                el.setAttribute('spellcheck', 'false');
                el.setAttribute('autocomplete', 'off');
                el.className = 'vo-hd-title';
                el.value = this.titleWas;
                this.titleEl = el;
                this.bindTitle(el);
                this.applyRenameRight();
            } else {
                el = document.createElement('span');
                el.className = 'vo-hd-title';
                this.titleEl = el;
                this.syncTitle(full);
            }
            return el;
        },

        titleIsField: function () {
            return !!this.titleEl && this.titleEl.tagName === 'INPUT';
        },

        titleFocused: function () {
            var el = this.titleEl;
            return !!el && !!el.ownerDocument && el.ownerDocument.activeElement === el;
        },

        /* The rename right — on every access, not a snapshot at build: on
           a co-authoring disconnect stock removes canRename (Main.onCoAuthoringDisconnect) — the field
           closes together with the stock one; the reader and "Viewing" have no renaming;
           the stock condition for the "File → Rename" item — without the desktop (FileMenu). */
        canRename: function () {
            var o = this.stockOptions();
            return !!o.canRename && !o.isDesktopApp && this.editRight === true && this.sheetMode !== 'view';
        },

        /* The field is open or closed by the right of this moment. A closed one is text: read-only,
           outside Tab order, a press does not take focus from the sheet (bindTitle), the tooltip
           "renaming is unavailable". If the right left in the middle of editing — the typed text is rolled back
           and the field loses focus: the commit (on blur) will not find the right and will send nothing. */
        applyRenameRight: function () {
            var el = this.titleEl;
            if (!this.titleIsField()) return;
            var can = this.canRename();
            if (can) el.removeAttribute('readonly');
            else el.setAttribute('readonly', '');
            el.setAttribute('tabindex', can ? '0' : '-1');
            el.setAttribute('title', can ? this.tipRename : this.tipRenameDisabled);
            if (!can && this.titleFocused()) {
                this.revertTitle();
                if (typeof el.blur === 'function') el.blur();
            }
        },

        /* The keyboard goes to the field while it is edited (otherwise letters go to the sheet), on exit —
           to the engine; presses do not go beyond the field. Enter commits, Escape rolls back; both
           return focus to the sheet by the stock path (edit:complete), like the stock header.
           Leaving focus by mouse is also a commit: it is called by the engine itself, taking focus from the
           interface fields on a press into the sheet. */
        bindTitle: function (el) {
            var me = this;
            /* The right — on every access: the field's look is brought to the right of this moment. */
            el.addEventListener('mousedown', guarded('shell: title press', function (e) {
                me.applyRenameRight();
                if (!me.canRename()) {
                    e && e.preventDefault && e.preventDefault();
                    return;
                }
                me.closeSurfaces();
                me.titleKeys(false);
            }));
            el.addEventListener('focus', guarded('shell: title focus', function () {
                me.applyRenameRight();
                if (me.canRename()) me.titleKeys(false);
            }));
            el.addEventListener('keydown', guarded('shell: title key', function (e) {
                if (!e) return;
                e.stopPropagation && e.stopPropagation();
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
            ['keypress', 'keyup'].forEach(function (name) {
                el.addEventListener(name, function (e) { e && e.stopPropagation && e.stopPropagation(); });
            });
            el.addEventListener('input', guarded('shell: title input', function () { me.fitTitle(); }));
            el.addEventListener('blur', guarded('shell: title blur', function () {
                me.commitTitle();
                me.titleKeys(true);
            }));
        },

        /* "File → Rename": the same as a click on the title in the header, —
           the open surfaces are closed, the keyboard goes to the field (titleKeys: otherwise the engine would take focus to the sheet), the field is focused,
           the text selected. After that — the previous in-place edit: Enter sends the name by the stock path (commitTitle → requestRename),
           Escape rolls back; both return the keyboard to the sheet. The right is the same as for the field, at this moment (applyRenameRight):
           no right — we do nothing, the item is disabled anyway by the same rule (gate canRename). No field or it is not visible
           (the title is text, the header is hidden) — false: the item will open the previous stock rename window. */
        editTitle: function () {
            var el = this.titleEl;
            if (!this.titleIsField() || el.isConnected === false || typeof el.focus !== 'function' ||
                (typeof el.getClientRects === 'function' && !el.getClientRects().length)) return false;
            this.applyRenameRight();
            if (!this.canRename()) return true;
            this.closeSurfaces();
            this.titleKeys(false);
            el.focus();
            if (typeof el.select === 'function') el.select();
            return true;
        },

        titleKeys: function (on) {
            /* Focus moves around the shell from the keyboard (F10) — the engine keyboard is held by it. */
            if (on && this.keysHeld) return;
            var api = this.api;
            if (api && typeof api.asc_enableKeyEvents === 'function') api.asc_enableKeyEvents(on);
        },

        leaveTitle: function () {
            var el = this.titleEl;
            if (this.titleFocused() && typeof el.blur === 'function') el.blur();
            Common.NotificationCenter.trigger('edit:complete');
        },

        revertTitle: function () {
            if (!this.titleIsField()) return;
            this.titleEl.value = this.titleWas;
            this.fitTitle();
        },

        /* The commit. The right — here too (the second end of the gate): it could have left while the field was
           in focus. An empty name and invalid characters are rolled back silently — an error dialog
           would be heavier than the edit itself. The same name is not sent (nor one that came from outside —
           too: titleWas is already the new one). Outward — by the stock rename path of LeftMenu:
           the 'rename' event of the stock header, to which LeftMenu is subscribed (wopi —
           asc_wopi_renameFile, otherwise Common.Gateway.requestRename), the name without extension,
           as for the stock title. */
        commitTitle: function () {
            if (!this.titleIsField()) return;
            if (!this.canRename()) { this.revertTitle(); return; }
            var raw = this.titleEl.value;
            var v = (raw == null ? '' : String(raw)).trim();
            if (!v || BAD_NAME.test(v)) { this.revertTitle(); return; }
            if (this.titleEl.value !== v) this.titleEl.value = v;
            this.fitTitle();
            if (v === this.titleWas) return;
            this.titleWas = v;
            this.requestRename(v);
        },

        requestRename: function (name) {
            var vp = SSE.getController('Viewport');
            var header = vp && typeof vp.getView === 'function' ? vp.getView('Common.Views.Header') : null;
            if (header && typeof header.fireEvent === 'function') header.fireEvent('rename', [name]);
            else if (window.console && console.warn) console.warn('Compact shell: stock header is missing, rename is not sent.');
        },

        /* The measurement — when the header is in the document (before insertion the twin is not measured), and once more
           later: in the development build LESS is compiled in the browser asynchronously (the same retry as for the
           canvas skin, SKIN_RETRY), and the font might not be ready — after document.fonts.ready. */
        refitTitle: function () {
            var me = this;
            if (!this.titleIsField()) return;
            var fit = guarded('shell: title fit', function () { me.fitTitle(); });
            fit();
            setTimeout(fit, SKIN_RETRY);
            try {
                if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') document.fonts.ready.then(fit);
            } catch (e) { /* without the Font Loading API — a retry is enough */ }
        },

        /* The field by text width: an input does not shrink by itself. The margin is
           Math.ceil(measureText + 2): the width of
           the text without tracking (the canvas measureText does not take CSS letter-spacing into account) plus 2,
           rounded up to an integer. Hence its own gap between the name and the save checkmark, unlike
           documents (they have a twin with +1 tracking, within 40…520). There are no bounds in JS for
           spreadsheets either: the width is held by the field's max-width (40 % of the header, compact-shell.less). We measure
           with a hidden twin (.vo-hd-sizer: the field's font, letter-spacing normal — the same measurement
           as the canvas measureText) with a fractional width: offsetWidth rounds. The twin lives in
           the header, and while the header is hidden (focus mode — .vo-hd, Stock — the whole #vo-shell under
           display: none), it is not rendered and measures 0. Then we do not touch the width: a name that came
           at that time (asc_onMeta, asc_onDocumentName), the field will fit when the header returns
           (showsHeader: setChrome, toggleMode). */
        fitTitle: function () {
            var el = this.titleEl, sizer = this.sizerEl;
            if (!this.titleIsField() || !sizer) return;
            var text = el.value || '';
            sizer.textContent = text;
            var m = sizer.getBoundingClientRect().width || 0;
            if (!m && text) return;
            el.style.width = Math.ceil(m + 2) + 'px';
        },

        /* The header is visible again — the title field is remeasured (see fitTitle). */
        showsHeader: function () {
            if (!this.advanced && !this.focus) this.fitTitle();
        },

        /* The name changes bypassing us too: a rename by the portal comes as a meta command
           (asc_onMeta with title), a version restore and the like — asc_onDocumentName; stock
           updates the stock title from them (Main.onMeta, onDocumentName). Without the same
           subscription the field would not just show the old name — it would send it back
           on the very first focus leave. While a person is editing the name, we do not overwrite their typing:
           titleWas is already new, and the commit will go as an edit over the incoming name. */
        syncTitle: function (name) {
            var el = this.titleEl;
            if (!el) return;
            var full = (name == null ? '' : String(name)).trim() || this.documentTitle();
            var dot = full.lastIndexOf('.');
            var base = dot > 0 ? full.slice(0, dot) : full;
            this.titleWas = base;
            if (!this.titleIsField()) {
                el.textContent = base;
                el.setAttribute('title', full);
                return;
            }
            if (this.titleFocused() || el.value === base) return;
            el.value = base;
            this.fitTitle();
        },

        /* --- Save state ------------------------------------------- */
        /* The look — as in documents:
           "Not saved" and "Saving…" — a badge with a caption (AIR label md,
           tintedNoAccent), "Saved" — an accent checkmark without a caption; the caption is also in the
           tooltip and in the name for the screen reader. The states are the engine's truth, not a guess:
           "modified" — asc_isDocumentModified by asc_onDocumentModifiedChanged (we do not read the event
           argument), "saving in progress" — the long action Save /
           ForceSaveButton between asc_onStartAction and asc_onEndAction; by the same events stock
           writes "Saving…" and "All changes saved" in the status bar (Main.
           onLongActionBegin / End). The timer only holds "Saving…" on screen (otherwise
           it would flash for a single frame) and on expiry rereads the engine: "Saved"
           is not set without an engine event. */
        buildSaveState: function () {
            var el = document.createElement('span');
            el.className = 'vo-hd-state';
            el.setAttribute('role', 'status');
            this.stateEl = el;
            this.saveFlags = {modified: false, saving: false};
            this.saveKey = null;
            this.saveHoldUntil = 0;
            return el;
        },

        isSaveAction: function (id) {
            var A = window.Asc && Asc.c_oAscAsyncAction;
            return !!A && id !== undefined && id !== null && (id === A['Save'] || id === A['ForceSaveButton']);
        },

        engineModified: function () {
            var api = this.api;
            return !!(api && typeof api.asc_isDocumentModified === 'function' && api.asc_isDocumentModified());
        },

        syncSaveState: function () {
            if (!this.stateEl || !this.api) return;
            this.setSaveState({modified: this.engineModified()});
        },

        /* The flags come separately and in any order (the end of Save happens both before the removal of
           "modified" and after): we keep both, and derive the state from the pair. */
        setSaveState: function (flags) {
            var me = this, el = this.stateEl;
            if (!el || !this.saveFlags) return;
            _.extend(this.saveFlags, flags || {});
            var now = Date.now();
            if (flags && flags.saving) this.saveHoldUntil = now + SAVE_HOLD_MS;
            var held = now < this.saveHoldUntil;
            clearTimeout(this.saveHoldTimer);
            if (held && !this.saveFlags.saving) {
                this.saveHoldTimer = setTimeout(guarded('shell: save state hold', function () {
                    me.syncSaveState();
                }), this.saveHoldUntil - now);
            }
            var key = (this.saveFlags.saving || held) ? 'saving' : (this.saveFlags.modified ? 'dirty' : 'saved');
            if (key === this.saveKey) return;
            this.saveKey = key;
            var t = key === 'saving' ? this.textSaving : key === 'dirty' ? this.textUnsaved : this.textSaved;
            el.classList.remove('saved', 'saving', 'dirty');
            el.classList.add(key);
            if (key === 'saved') el.innerHTML = Icons.svg('accept', 18);
            else el.textContent = t;
            /* The hover tooltip is the save state; a shown one changes its text in place. */
            CompactToolbar.setTip(el, t);
            el.setAttribute('aria-label', t);
        },

        bindSaveState: function () {
            var me = this;
            this.onApi('asc_onDocumentModifiedChanged', function () { me.syncSaveState(); });
            this.onApi('asc_onStartAction', function (type, id) {
                if (me.isSaveAction(id)) me.setSaveState({saving: true});
            });
            this.onApi('asc_onEndAction', function (type, id) {
                if (me.isSaveAction(id)) me.setSaveState({saving: false, modified: me.engineModified()});
            });
        },

        /* --- The engine canvas: header colors ------------------------ */
        /* The row and column headers are drawn by the engine (drawHighlightedHeaders) in the theme colors, and
           it reads them only through asc_setSkin: the stock Themes gives the theme variables from the
           computed style of body (getThemeColors) at start and on a theme change. Our header
           colors (compact-shell.less, only under body.vo-compact) appear by changing the classes of
           body, of which the engine does not know, and LESS in the browser is compiled later than the stock
           call. So we reapply the theme to the engine ourselves, as documents do (applyCanvasSkin
           there): after create() and once more after 600 ms, after the stock uitheme:changed and in both
           directions Compact ↔ Stock — always already after the class change. We do not edit the engine. A failure
           here does not take the shell down: the headers stay the stock color.

           The Compact colors are our own variables (--vo-cell-title-*), substituted into the skin on top of the
           theme colors, not overridden theme variables: the stock Themes caches the
           computed theme colors in localStorage ('ui-theme' — check_launched_custom_theme,
           apply_theme) and on the next load lays them out with the theme class (themeinit.js).
           A theme variable overridden on body.vo-compact thus leaked into Stock and into a
           session without the shell on the same origin.

           In the same pass the engine gets the cell selection color (SELECTION_VAR →
           activeCellBorderColor of the sheet settings): in Compact — ours, outside Compact — the stock
           object remembered on the first pass. */
        skinTimer: null,
        stockSelection: null,

        applyCanvasSkin: function () {
            var me = this;
            if (this.startupFailed) return;
            var apply = guarded('shell: canvas skin', function () { me.pushSkin(); });
            apply();
            clearTimeout(this.skinTimer);
            this.skinTimer = setTimeout(apply, SKIN_RETRY);
        },

        pushSkin: function () {
            var api = this.api || this.stockApi();
            var themes = window.Common && Common.UI && Common.UI.Themes;
            if (!api || typeof api.asc_setSkin !== 'function' || !themes || typeof themes.getThemeColors !== 'function') return;
            var colors = themes.getThemeColors();
            var compact = document.body.classList.contains('vo-compact');
            var st = compact && typeof window.getComputedStyle === 'function' ? window.getComputedStyle(document.body) : null;
            if (colors && st) {
                TITLE_SKIN.forEach(function (pair) {
                    var v = String(st.getPropertyValue(pair[1]) || '').trim();
                    if (v) colors[pair[0]] = v;
                });
            }
            /* The selection color — into the sheet settings before asc_setSkin: that one redraws the sheet. The color
               object is of the same type as the stock one; outside Compact — the stock object itself. No engine
               settings, the variable does not parse as #rgb / #rrggbb or the constructor of the stock
               object does not give a color with the same r, g, b — we do not touch the color. */
            var view = api.wb && api.wb.defaults && api.wb.defaults.worksheetView;
            var cur = view && view.activeCellBorderColor;
            if (cur && typeof cur === 'object') {
                var stock = this.stockSelection || (this.stockSelection = cur);
                var hex = st && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(st.getPropertyValue(SELECTION_VAR) || '').trim());
                if (!compact) view.activeCellBorderColor = stock;
                else if (hex && typeof stock.constructor === 'function') {
                    var h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
                    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
                    var next = new stock.constructor(r, g, b, 1);
                    if (next && next.r === r && next.g === g && next.b === b) view.activeCellBorderColor = next;
                }
            }
            api.asc_setSkin(colors);
        },

        /* --- Layout ------------------------------------------------------ */
        /* The vertical layout of spreadsheets: title (#app-title, the stock two-level
           header), toolbar (#toolbar — #vo-shell lives here), the middle and
           statusbar (the sheet row). In Compact: title — 0, toolbar — the sum of our
           rows; statusbar is stock. The nodes are not removed: the height is in the layout
           model, the rest is done by styles. */

        layout: function () {
            var vp = SSE.getController('Viewport');
            var view = vp && vp.viewport;
            var v = view && view.vlayout;
            if (!v) return null;
            return {v: v, h: view.hlayout, ce: view.celayout,
                    title: v.getItem('title'), toolbar: v.getItem('toolbar')};
        },

        /* The sum of the built and visible rows. A row hidden by the user (the class
           vo-row-hidden is put by whoever hides it) holds no space; focus mode
           removes the header and the menu bar row (in focus the plate remains — 92). The plate — by its own
           visible rows (plateHeight). */
        shellHeight: function () {
            var me = this, rows = this.rows || {}, sum = 0;
            ROWS.forEach(function (r) {
                if (r.name === 'plate') { sum += me.plateHeight(); return; }
                var el = rows[r.name];
                if (!el || !el.parentNode || el.classList.contains('vo-row-hidden')) return;
                if (me.focus && (r.name === 'header' || r.name === 'menu')) return;
                sum += r.height;
            });
            var controls = this.contextRibbon && document.querySelector('#toolbar .toolbar .box-controls');
            return sum + (controls ? controls.offsetHeight : 0);
        },

        /* The rows inside the plate: the toolbar — built, not hidden and not removed by a mode
           ("Hide toolbar", "Viewing": there is nothing to format, the grid takes its
           height); the formula bar — its current height in the plate (expanded is taller, hidden by the
           stock "View → Formula bar" — 0). */
        plateInner: function () {
            var p = this.plateParts();
            return p.tb + p.fx;
        },

        plateParts: function () {
            var rows = this.rows || {}, plate = rows.plate, tb = rows.toolbar;
            if (!plate || !plate.parentNode) return {tb: 0, fx: 0};
            var shown = tb && tb.parentNode && !tb.classList.contains('vo-row-hidden') && !this.tbHidden && this.sheetMode !== 'view';
            return {tb: shown ? H_TOOLBAR : 0, fx: FormulaBar.plateRowHeight()};
        },

        /* The plate with margins: on top the spreadsheets' own gap, at the bottom common with documents. There is no
           empty plate at all — neither margins nor space. */
        plateHeight: function () {
            var inner = this.plateInner();
            return inner ? H_TB_GAP_TOP + inner + H_TB_GAP : 0;
        },

        /* The plate look for the layout: empty — hidden; both rows — a line between them; the formula
           bar in the plate — its edge (compact-shell.less, "Formula bar"). The plate bottom from
           the window top — on body (the search card goes under it). Without a plate — the bottom of the rows. */
        syncPlate: function (compact) {
            var plate = this.rows && this.rows.plate, st = document.body && document.body.style;
            var p = compact ? this.plateParts() : {tb: 0, fx: 0}, inner = p.tb + p.fx;
            if (plate && plate.classList) {
                plate.classList.toggle(PLATE_OFF, !inner);
                plate.classList.toggle(PLATE_SPLIT, !!(p.tb && p.fx));
                plate.classList.toggle(PLATE_FX, !!p.fx);
            }
            if (!st || typeof st.setProperty !== 'function') return;
            if (!compact) { st.removeProperty(PLATE_BOTTOM_VAR); return; }
            var bottom = this.shellHeight() - (inner ? H_TB_GAP : 0);
            st.setProperty(PLATE_BOTTOM_VAR, bottom + 'px');
        },

        /* The formula bar in the plate changed height or visibility: its expand button
           (moving — by motion, the same as for focus mode, FormulaBar drives the row itself), its own
           edge, stock collapse by styles and "View → Formula bar" (at once). The height did not
           change — there is nothing to lay out. */
        formulaRowChanged: function (moving) {
            if (this.advanced || !this.ours || !this.applied || !document.getElementById(SHELL_ID)) return;
            if (this.shellHeight() === this.applied.toolbar) { this.syncPlate(true); return; }
            this.applyLayout(true, !!moving && this.canMove());
        },

        /* The snapshot of the stock heights is taken every time the heights are not yet ours, —
           this is the only moment when they are stock: in Stock they are driven by stock
           (ribbon collapse, theme change), and a snapshot from start would go stale. */
        /* moving — a row change by a person's action (focus mode, "Hide toolbar",
           "Viewing"): the height changes by motion (moveRows). Without it — at once:
           launch, Stock, reassertion after stock. A transition in progress ends before
           any new layout: its shift was computed for the previous one. */
        applyLayout: function (compact, moving) {
            var L = this.layout();
            if (!L) return;
            var from = moving ? this.rowsOnScreen(L) : null;
            this.finishMotion();
            if (from) from.base = this.rowsLaidOut(L);
            if (!this.ours) {
                this.base = {title: L.title ? L.title.height : null,
                             toolbar: L.toolbar ? L.toolbar.height : null};
            }
            this.ours = !!compact;
            this.applied = compact ? {title: 0, toolbar: this.shellHeight()} : null;
            if (L.title) L.title.height = compact ? this.applied.title : this.base.title;
            if (L.toolbar) L.toolbar.height = compact ? this.applied.toolbar : this.base.toolbar;
            this.syncPlate(!!compact);
            if (compact && from && from.base !== null) this.moveRows(L, from.h0, from.base);
            else this.relayout();
        },

        /* Reasserting our heights after a stock writer. We compare with
           what we put ourselves, not with shellHeight(): a row could have appeared or
           hidden, and that is no reason to take our own previous height for the stock one. */
        reassertLayout: function () {
            if (this.advanced || !this.ours || !this.applied) return;
            var L = this.layout();
            if (!L) return;
            var drift = false;
            if (L.toolbar && L.toolbar.height !== this.applied.toolbar) {
                this.base.toolbar = L.toolbar.height;
                drift = true;
            }
            if (L.title && L.title.height !== this.applied.title) {
                this.base.title = L.title.height;
                drift = true;
            }
            if (drift) this.applyLayout(true);
        },

        /* The recalculation after the heights change. layout:changed 'toolbar' — the stock path
           (Viewport.onLayoutChanged: vlayout, celayout, asc_Resize); the window resize
           additionally recalculates the ribbon (Mixtbar.onResize by
           window:resize) — it needs this after being shown in Stock. */
        relayout: function () {
            var L = this.layout();
            if (L) {
                L.v.doLayout();
                L.ce && L.ce.doLayout();
            }
            Common.NotificationCenter.trigger('layout:changed', 'toolbar');
            this.resync();
        },

        resync: function () {
            try { window.dispatchEvent(new Event('resize')); } catch (e) { /* without a window recalculation */ }
        },

        /* --- Motion ---------------------------------------------- */
        /* As in documents: a 0.3 s transition with the @vo-ease curve — the leaving of
           the toolbar in "Viewing", focus mode, "Hide toolbar" and the sliding out of the side columns,
           the chevrons — 0.15 s (compact-shell.less); the formula bar is driven by FormulaBar.
           The grid is recalculated once per transition, not on every frame (
           a heavy sheet redraws for a long time): the #toolbar height is changed by the style transition,
           the grid area moves by a shift (transform) with the same transition — at the bottom of the rows in every
           frame, — while the layout and asc_Resize by the stock path (layout:changed 'toolbar' →
           Viewport.onLayoutChanged) once: for the rows growing — at the end of the transition
           (transitionend; the grid keeps the previous, larger height until the end and slides down), for
           the rows leaving — at the start (the grid immediately gets the larger height and slides from the bottom
           up) — so there is no empty strip at the bottom edge of the grid, the same calculation as for the formula
           bar (FormulaBar.animate). A person's action calls the stock subscribers, and
           each sends its own layout:changed (for "Viewing" — the right and left panels and the rows:
           six asc_Resize in a row) — the grid recalculation is held back for the duration of the action
           (holdResize) and released as one. "Reduce motion" and Stock —
           instant, in one recalculation. */

        reducedMotion: function () {
            try {
                return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            } catch (e) {
                return false;
            }
        },

        canMove: function () {
            return !this.advanced && document.body.classList.contains('vo-compact') && !this.reducedMotion() &&
                   document.visibilityState !== 'hidden';
        },

        /* The grid area is the stretchable area of the vertical layout (view/Viewport.js:
           the left and right columns, the formula bar and the canvas). */
        middle: function (L) {
            var list = (L && L.v && L.v.panels) || [];
            for (var i = 0; i < list.length; i++) {
                if (list[i].stretch && list[i].el && list[i].el[0]) return list[i].el[0];
            }
            return null;
        },

        /* The row height on screen (in the middle of a transition — intermediate). */
        rowsOnScreen: function (L) {
            var el = L && L.toolbar && L.toolbar.el && L.toolbar.el[0];
            if (!el || !this.middle(L) || typeof el.getBoundingClientRect !== 'function') return null;
            return {h0: el.getBoundingClientRect().height, base: null};
        },

        /* The row height that the grid area is laid out for now: its top by the layout
           (offsetTop without the shift) from the top of #toolbar. */
        rowsLaidOut: function (L) {
            var el = L && L.toolbar && L.toolbar.el && L.toolbar.el[0], mid = this.middle(L);
            if (!el || !mid) return null;
            return mid.offsetTop - el.offsetTop;
        },

        /* FLIP: the initial state without a transition, a forced read, the final one — under
           the transition. #toolbar — from h0 (where the rows are on screen) to its model height; the grid
           area is laid out for the height base and moves by a shift from h0 − base to h1 − base: for growth
           base is the previous height (the layout is deferred until the end), for leaving the layout is at once
           (base = h1, the shift ends at zero). */
        moveRows: function (L, h0, base) {
            var me = this;
            var el = L.toolbar.el[0], mid = this.middle(L), h1 = L.toolbar.height;
            if (!mid || !this.canMove() || Math.abs(h1 - h0) < 0.5) { this.relayout(); return; }
            var grow = h1 > h0;
            var shift = function (px) { return Math.abs(px) >= 0.01 ? 'translateY(' + px + 'px)' : ''; };
            var m = {el: el, mid: mid, deferred: grow, timer: null, onEnd: null,
                     transform: mid.style.transform || '', transition: el.style.transition || ''};
            el.style.transition = 'none';
            var lay = base;
            if (grow) {
                /* The layout and the grid recalculation — at the end of the transition. */
                this.holdResize();
            } else {
                this.relayout();
                lay = h1;
            }
            el.style.height = h0 + 'px';
            mid.style.transform = shift(h0 - lay);
            void el.offsetHeight;
            el.style.transition = m.transition;
            mid.classList.add(ROWS_FOLLOW);
            el.style.height = h1 + 'px';
            mid.style.transform = shift(h1 - lay);
            this.motion = m;
            m.onEnd = guarded('shell: rows transition end', function (e) {
                if (e && (e.target !== el || e.propertyName !== 'height')) return;
                /* The abort of the previous transition (finishMotion before the new one) is dispatched by the browser as an
                   event later, in a frame — already to this one. While the rows are moving, it is not it. */
                if (e && e.type === 'transitioncancel' && me.heightRunning(el)) return;
                if (me.motion === m) me.finishMotion();
            });
            el.addEventListener('transitionend', m.onEnd);
            el.addEventListener('transitioncancel', m.onEnd);
            var dur = (parseFloat(window.getComputedStyle(el).transitionDuration) || 0) * 1000;
            m.timer = setTimeout(m.onEnd, dur + MOTION_SLACK);
        },

        /* The end of a transition or its abort (a press, a new action, a foreign layout): the shift
           is removed with the same motion in which the layout is released — there is no frame between them.
           Removing the class does not abort a running transition, transition: none inline does
           for a single style read (as in FormulaBar.finish). */
        finishMotion: function () {
            var m = this.motion;
            if (!m) return;
            this.motion = null;
            clearTimeout(m.timer);
            m.el.removeEventListener('transitionend', m.onEnd);
            m.el.removeEventListener('transitioncancel', m.onEnd);
            var midTransition = m.mid.style.transition || '';
            m.el.style.transition = 'none';
            m.mid.style.transition = 'none';
            m.mid.classList.remove(ROWS_FOLLOW);
            m.mid.style.transform = m.transform;
            void m.el.offsetHeight;
            m.el.style.transition = m.transition;
            m.mid.style.transition = midTransition;
            if (!m.deferred) return;
            try {
                this.relayout();
            } finally {
                this.releaseResize();
            }
        },

        heightRunning: function (el) {
            if (!el || typeof el.getAnimations !== 'function') return false;
            try {
                return el.getAnimations().some(function (x) { return x.transitionProperty === 'height'; });
            } catch (e) {
                return false;
            }
        },

        /* The grid recalculation held back for the duration of an action: the stock calls of api.asc_Resize
           (layout:changed subscribers, window resize) are only noted, on release —
           one real one. Nested: the action holds, the deferred growth layout holds
           until the end of the transition. The substitution is a property of the instance's own, removed only if
           nobody overrode it; the HOLD_CAP ceiling releases a forgotten one. The ceiling is a timer, it is
           called by the browser, so it is under guarded: an exception of the stock
           asc_Resize on release is one warning, it does not escape to the caller; the substitution by that
           moment is already removed (releaseResize returns asc_Resize before the call). */
        holdResize: function () {
            var h = this.resizeHold;
            if (h) { h.depth++; return; }
            var api = this.api, me = this;
            if (!api || typeof api.asc_Resize !== 'function') return;
            h = this.resizeHold = {depth: 1, own: Object.prototype.hasOwnProperty.call(api, 'asc_Resize'),
                                   orig: api.asc_Resize, wanted: 0, stub: null, timer: null};
            h.stub = function () { h.wanted++; };
            api.asc_Resize = h.stub;
            h.timer = setTimeout(guarded('shell: resize hold cap', function () {
                if (me.resizeHold === h) me.releaseResize(true);
            }), HOLD_CAP);
        },

        releaseResize: function (all) {
            var h = this.resizeHold;
            if (!h) return;
            if (!all && --h.depth > 0) return;
            this.resizeHold = null;
            clearTimeout(h.timer);
            var api = this.api;
            if (!api) return;
            if (api.asc_Resize === h.stub) {
                if (h.own) api.asc_Resize = h.orig;
                else delete api.asc_Resize;
            }
            if (h.wanted && typeof api.asc_Resize === 'function') api.asc_Resize();
        },

        /* An action in one grid recalculation. */
        batch: function (fn) {
            this.holdResize();
            try {
                return fn.call(this);
            } finally {
                this.releaseResize();
            }
        },

        /* A press in the middle of a transition (grid, edge, field) ends it at once: the engine and
           the stock drag read the layout, while for growth it does not exist until the end of the transition.
           pointerdown in capture — the engine swallows mousedown over the grid.
           A foreign row layout in the middle of a transition (window resize, theme change) is also an end:
           the shift was computed for the previous one. The columns (leftmenu, rightmenu) and the formula bar
           (celleditor) do not touch the rows. */
        bindMotion: function () {
            var me = this;
            /* A press — in the shell's common press listener (bindMenu, pressDuringMotion). */
            /* Stock lays out a window resize by a direct call (Viewport.onWindowResize), bypassing
               layout:changed. */
            var onResize = guarded('shell: window resize during rows transition', function () {
                if (me.motion) me.finishMotion();
            });
            window.addEventListener('resize', onResize);
            this.subs.push(function () { window.removeEventListener('resize', onResize); });
            this.onNote('layout:changed', function (area) {
                if (!me.motion || area === 'leftmenu' || area === 'rightmenu' || area === 'history' || area === 'celleditor') return;
                me.finishMotion();
            });
        },

        /* A press in the middle of a row transition. A press in the shell itself (a second click on the
           chevron) does not end the transition: the new action will start the reverse one from where the
           rows are now. */
        pressDuringMotion: function (e) {
            if (!this.motion) return;
            var t = e && e.target;
            if (t && t.nodeType === 1 && typeof t.closest === 'function' && t.closest('#' + SHELL_ID)) return;
            this.finishMotion();
        },

        /* --- Left area --------------------------------------------------- */
        /* The left menu icon column in Compact is hidden, and with it the whole area:
           the styles show it only under vo-left-open. The panels inside are stock
           components with their own controllers; they are opened by the stock paths
           (hotkeys, the context menu, later our header buttons), and we
           only give the area room. The single source of truth is the pressed state
           of the stock buttons: a panel is closed both by the cross inside and by a key. */
        leftButtons: function () {
            var lm = SSE.getController('LeftMenu');
            var view = lm && lm.leftMenu;
            if (!view) return [];
            var list = LEFT_PANELS.map(function (name) { return view[name]; });
            (view.buttons || []).forEach(function (btn) {
                if (btn && btn.options && btn.options.type === 'plugin') list.push(btn);
            });
            return list.filter(Boolean);
        },

        /* Show the area before the stock button of its panel is pressed (a menu bar row item):
           the stock handler measures the area width, deciding whether to expand the panel,
           and a hidden one has zero width. After that syncLeftState brings the state.
           Until the end of the task an area shown for opening is not closed by the
           room check (leftReveal, see leftRoom): the stock onBtnMenuClick sends the first
           layout:changed before it expands the menu, and expands it only if it
           reads the width of a shown area. On the next tick — a check without leniency:
           if stock did not expand the menu — the area is hidden. */
        revealLeft: function () {
            document.body.classList.add('vo-left-open');
            if (this.leftReveal) return;
            var me = this;
            this.leftReveal = true;
            setTimeout(guarded('shell: left reveal', function () {
                me.leftReveal = false;
                if (!me.advanced && document.getElementById(SHELL_ID)) me.syncLeftState();
            }), 0);
        },

        /* The room for a panel at the stock menu after disconnecting from the server (the integration took away
           the edit right — api:disconnect; Main.onCoAuthoringDisconnect sets its own
           _state.isDisconnected earlier than the stock LeftMenu). Its close() shrinks the menu to
           the icon column (SCALE_MIN), and the comments button is released only with
           canCoAuthoring, which Main has already removed by this time — the button stays pressed
           and disabled. In stock in these 40 px is its icon column, the panel is hidden; Compact has no
           column, and the area by the pressed button showed a strip of the panel with a shift of
           the sheet. Then the sign of an open panel is the stock one: the menu is wider than
           the icon column (this is how stock's onBtnMenuClick decides too). In a normal session — only
           the pressed state: opening (onBtnMenuClick) sends layout:changed via btnAbout.toggle(false)
           before it expands the menu, and a width check would close the area in the middle of
           opening; after a disconnect the same opening (the "Find and replace" item) goes with
           the leniency of revealLeft.
           The width is the inline one written by stock (border-box), not $el.width(): a
           shown area has the Compact divider border (LEFT_DIVIDER_W), a hidden one does not,
           and jQuery would read the same menu as 40 and then 41 — the check would depend on whether
           the area itself is visible (the strip would return on the next
           layout:changed). The icon column in the stock record is 40 (written into a hidden
           area) or 41 (into a shown one), a menu with a panel — from 300 (MENU_SCALE_PART and
           the divider's lower limit). Without the menu view or without a record — as before, by
           the buttons. */
        leftRoom: function () {
            var main = SSE.getController('Main');
            if (!(main && main._state && main._state.isDisconnected === true)) return true;
            if (this.leftReveal) return true;
            var el = this.leftMenuEl();
            var outer = el ? parseFloat(el.style.width) : NaN;
            if (isNaN(outer)) return true;
            return outer > LEFT_ICONS_W + LEFT_DIVIDER_W;
        },

        /* The #left-menu node of the stock left menu view (its $el). */
        leftMenuEl: function () {
            var lm = SSE.getController('LeftMenu');
            var $el = lm && lm.leftMenu && lm.leftMenu.$el;
            var el = $el && $el[0];
            return el && el.style ? el : null;
        },

        /* A hidden area: the icon column written by stock into a shown area (41 —
           SCALE_MIN with the Compact divider), the stock readers of the hidden menu width —
           jQuery without a border — would take for a menu with a panel: Viewport.onLayoutChanged
           ('leftmenu') showed the layout divider and the sheet border (the sheet 4 px
           to the right), and onBtnMenuClick did not expand the menu for a panel. The record
           is brought to the form it would have in a hidden area — SCALE_MIN. */
        settleLeftWidth: function () {
            var el = this.leftMenuEl();
            if (el && parseFloat(el.style.width) === LEFT_ICONS_W + LEFT_DIVIDER_W) el.style.width = LEFT_ICONS_W + 'px';
        },

        syncLeftState: function () {
            var open = this.leftButtons().some(function (btn) { return !!btn.pressed; }) && this.leftRoom();
            var cl = document.body.classList;
            if (!open) this.settleLeftWidth();
            if (cl.contains('vo-left-open') === open) return;
            cl.toggle('vo-left-open', open);
            /* The area visibility changed after the stock doLayout — recalculation.
               doLayout directly: layout:changed would bring us back into this same method. */
            var L = this.layout();
            L && L.h && L.h.doLayout();
            this.resync();
        },

        /* The stock calls of the left area panels — showMenu of the left menu view. 'advancedsearch' —
           onShowHideSearch of the controller: Ctrl+H (onShortcut('replace') — with the floating search
           bar and without it) and the "Open panel" button of the floating bar (Ctrl+F). 'comments' —
           Ctrl+Shift+H (onShortcut('comments')) and a comment on the document (onAppAddComment:
           "Comment" when a non-range of cells is selected). Stock opens
           the panel only if its button in the icon column is visible, and Compact has no column:
           showMenu refused. Ctrl+H pressed the search button without an event — no panel, no room;
           the next layout:changed 'leftmenu' showed an empty 40 px area, "Edit → Find and
           replace" after that only set focus (the button is already pressed), and the floating
           bar's button hid the bar and opened nothing. Ctrl+Shift+H, Alt+Q and
           a comment on the document did nothing. In Compact the call goes by
           the path of the menu bar row item (SheetActions.exec: the area is shown in advance, the stock button
           of the panel, the area check): "Edit → Find and replace", "Collaboration → Comments".
           The stock continuation
           of the call is its own: for search — onShowHideSearch and onShortcut (the text for search, focus in the
           search or replace field), for comments — onAfterShow and the new comment field. 'chat'
           (Alt+Q, on macOS Ctrl+Alt+Q — onShortcut('chat'); "Chat" of the "Collaboration" tab —
           onShowHideChat) is not driven by the shell: there is no built-in chat in Compact (there is no "Chat" item in the menu
           bar row), and the stock showMenu('chat') refuses, as
           in stock without the icon column; in Stock — stock. For documents search was fixed by
           editing stock, for spreadsheets — here, without editing stock files. A refusal is
           stock's: the panel button is disabled, the integrator hid the left menu (the condition of the stock
           tryToShowLeftMenu), no right (no item in the menu bar row: canViewComments).
           The substitution is a property of the view instance and only in Compact: switching to Stock removes it (there the
           icon column exists and showMenu is stock), the return sets it again; it is also removed with
           the shell subscriptions, if nobody overrode it. */
        bindStockPanels: function () {
            if (this.stockPanelsOff) return;
            var me = this;
            var lm = SSE.getController('LeftMenu');
            var view = lm && lm.leftMenu;
            if (!view || typeof view.showMenu !== 'function') return;
            var own = Object.prototype.hasOwnProperty.call(view, 'showMenu'), orig = view.showMenu;
            var open = guarded('shell: stock left panel', function (menu) { return me.openLeftPanel(menu); });
            /* The decision without exceptions outward: the wrapper is called by the stock onShowHideSearch, onShortcut and
               onAppAddComment. Could not open — the stock showMenu, as without the wrapper (in Compact it
               will refuse, as before). */
            var wrapped = function (menu) {
                var mine = false;
                try {
                    mine = me.leftInShell(this, menu);
                } catch (e) {
                    mine = false;
                }
                if (!mine || open(menu) !== true) return orig.apply(this, arguments);
            };
            view.showMenu = wrapped;
            this.stockPanelsOff = function () {
                me.stockPanelsOff = null;
                if (view.showMenu !== wrapped) return;
                if (own) view.showMenu = orig;
                else delete view.showMenu;
            };
        },

        unbindStockPanels: function () {
            if (this.stockPanelsOff) this.stockPanelsOff();
        },

        /* The panel is opened by the shell: Compact is built (not Stock), the panel button is alive, the left
           menu was not hidden by the integrator — the same conditions as for the stock tryToShowLeftMenu
           (customization.leftMenu, LayoutManager). Already open comments the stock
           showMenu does not touch — neither close nor focus — and neither does the shell; an open search
           "Find and replace" is not closed but gets focus back (SheetActions.leftPanel). */
        leftInShell: function (view, menu) {
            var p = STOCK_PANELS.hasOwnProperty(menu) ? STOCK_PANELS[menu] : null;
            if (!p || this.advanced || this.startupFailed || !document.getElementById(SHELL_ID)) return false;
            var btn = view && view[p.btn];
            if (!btn || (typeof btn.isDisabled === 'function' && btn.isDisabled())) return false;
            if (p.keepOpen && btn.pressed) return false;
            var m = view.mode || {};
            if (m.canBrandingExt && m.customization && m.customization.leftMenu === false) return false;
            var LM = window.Common && Common.UI && Common.UI.LayoutManager;
            return !(LM && typeof LM.isElementVisible === 'function' && LM.isElementVisible('leftMenu') === false);
        },

        /* The same path as the menu bar row item. Search — openSearch.
           Comments — the item, if the menu bar row offers it now (the right, stock did not
           remove the button), like its click: the shell surfaces are closed, the keyboard is with the sheet
           (beforeCommand), the panel slides out in one grid recalculation. Focus is stock: into the field
           of a new comment — the stock continuation (onAfterShow, onAppAddComment). The comments button of its own, onto which the stock showMenu puts focus,
           stock keeps in the icon column — Compact has none, and focus stays at the sheet, as after a
           menu item: an ordinary button is not given focus by the engine over the sheet
           (sdkjs text_input2.js, the focus capture on document), only the stock ones with canfocused hold it. */
        openLeftPanel: function (menu) {
            if (menu === 'advancedsearch') return this.openSearch();
            var it = SheetActions.offered(STOCK_PANELS[menu].item);
            if (!it) return false;
            this.closeSurfaces();
            this.beforeCommand();
            return this.batch(function () { return SheetActions.exec(it, this) === true; }) === true;
        },

        /* The same path as the "Edit → Find and replace" item. */
        openSearch: function () {
            var it = SheetActions.item('findReplace');
            return !!it && SheetActions.exec(it, this) === true;
        },

        /* --- Right panel --------------------------------------------------- */
        /* The right properties panel is stock (8 tabs of 9.4): the DOM,
           the tabs and their content are stock's, ours is only whether it is visible and on which
           tab it opened. In Compact #right-menu is visible only under body.vo-right-open
           (compact-shell.less). The decision is kept by rightOpen and is maintained in both modes,
           it is applied by applyRightPanel — only in Compact: in Stock the right panel
           is managed by stock with its own tab column, and on return the decision
           is applied anew (toggleMode), as in documents.

           It opens by itself: on selecting an image, a shape (TextArt
           comes as a shape) and a slicer and when the cursor enters a pivot — on the TRANSITION into
           such a selection, not on every asc_onSelectionChanged: the engine repeats the
           event for the same selection (an object shift, a property edit from the panel
           itself), and a panel closed by a person would be opened again by the repeat. It is also opened by
           the stock commands that open it in stock: "Format →
           Format cells" sends rightmenu:open to the ribbon view, while the context menu
           "Format cells" and the "Options" of borders and orientation call the right panel
           controller directly — on all paths stock shows the panel through
           tryToShowRightMenu, and the right panel view sends 'view:hide' [controller, false].
           We listen to this show, not the rightmenu:open request itself: with a selected object
           or chart the cell tab in stock is disabled, onRightMenuOpen exits before
           showing and the command does nothing in stock — a class opened on request would show
           the stock tab column without a tab, and on cells it would stay.
           On a chart — neither open nor close: there is no "Chart" tab in 9.4 (the same for
           documents). It does not close itself: a click on a
           cell does not remove the panel. Manually in both directions — the shell command toggleRightPanel
           (there is no "View → Object properties" item: a closed panel is opened again by selecting
           an object).

           A visible panel is expanded: the collapsed stock one is a single tab column
           (the stock default). The expand is the stock SetActivePane on the object's tab, as
           pressing this tab (expandRight); we choose the tab after all selection
           subscribers (scheduleRight): the stock right panel subscriber is created on
           style readiness and may stand after ours, and the tab availability is set by
           it. A closed one — the stock one is collapsed (collapseRight): for an expanded hidden panel
           the stock "Format cells" with the cell tab already active would exit
           before showing (onRightMenuOpen: "the tab is already active"), and ours would not open.
           Stock expands a hidden panel itself too — by the remembered "not collapsed"
           (sse-hide-right-settings; '0' is also written by the stock "Format cells" itself), including
           without an engine event: on load createDelayedElements →
           onChangeProtectSheet → onSelectionChanged calls SetActivePane directly, already
           after the shell launch. So we collapse a closed one by the expand itself —
           the stock layout:changed 'rightmenu' (bindRight), with the same deferred step as
           after a selection. */

        rightView: function () {
            var c = SSE.getController('RightMenu');
            var v = c && (c.rightmenu || (typeof c.getView === 'function' ? c.getView('RightMenu') : null));
            return v || null;
        },

        /* Nothing to show — the same conditions as for the stock tryToShowRightMenu: the panel
           is not drawn (the reader — stock draws it in applyEditorMode only for editing),
           the integrator hid it (customization.rightMenu, LayoutManager) or the editor is
           embedded (mail merge, chart, OLE). */
        rightAvailable: function () {
            var v = this.rightView();
            if (!v || !v.cellSettings || typeof v.SetActivePane !== 'function') return false;
            var m = v.mode || {};
            if (m.isEditMailMerge || m.isEditDiagram || m.isEditOle) return false;
            if (m.canBrandingExt && m.customization && m.customization.rightMenu === false) return false;
            var lm = window.Common && Common.UI && Common.UI.LayoutManager;
            return !(lm && typeof lm.isElementVisible === 'function' && lm.isElementVisible('rightMenu') === false);
        },

        /* The selection kind for transitions: an object (an image, a shape together with editing its
           text, a slicer), a chart, a pivot (the sheet and name — entering another pivot is also a
           transition) or cells. */
        rightKind: function (info) {
            var T = window.Asc && Asc.c_oAscSelectionType;
            if (!T || !info || typeof info.asc_getSelectionType !== 'function') return null;
            var t = info.asc_getSelectionType();
            if (t === T.RangeChart || t === T.RangeChartText) return 'chart';
            if (t === T.RangeImage) return 'object:image';
            if (t === T.RangeShape || t === T.RangeShapeText) return 'object:shape';
            if (t === T.RangeSlicer) return 'object:slicer';
            var pivot = typeof info.asc_getPivotTableInfo === 'function' ? info.asc_getPivotTableInfo() : null;
            if (!pivot) return 'cells';
            var name = typeof pivot.asc_getName === 'function' ? pivot.asc_getName() : '';
            var api = this.api;
            var sheet = api && typeof api.asc_getActiveWorksheetIndex === 'function' ? api.asc_getActiveWorksheetIndex() : '';
            return 'pivot:' + sheet + ':' + name;
        },

        bindRight: function () {
            var me = this;
            this.onApi('asc_onSelectionChanged', function (info) { me.onRightSelection(info); });
            /* Showing the panel by a stock command (tryToShowRightMenu → onRightMenuHide(null, true)):
               both the ribbon's rightmenu:open and direct controller calls — only when stock
               really shows it. fireEvent of the view: the handler gets an array of
               stock arguments; [controller, true] — hiding, not a reason. */
            this.onView(this.rightView(), 'view:hide', function (args) {
                if (args && args[1] === false) me.stockOpensRight();
            });
            /* Stock expanded the stock panel while ours is closed (the expand sends layout:changed
               'rightmenu': onBtnMenuClick and onRightMenuClick) — we collapse by a deferred step.
               Our own collapse sends the same signal but finds the stock one collapsed: no loop.
               Showing by a stock command expands it even before 'view:hide' — the step reads
               the decision when it runs, and does not turn off a panel opened by a command. In Stock
               the panel is managed by stock. */
            this.onNote('layout:changed', function (area) {
                if (area !== 'rightmenu' || me.advanced || me.rightOpen) return;
                var v = me.rightView();
                if (v && v.minimizedMode === false) me.scheduleRight();
            });
            /* The selection at start is the reference point of transitions, not a reason to open:
               the book could have opened with the cursor in a pivot. The engine did not answer — the reference
               is from the first event, the shell launch does not fall because of this. */
            var api = this.api;
            try {
                this.rightLast = api && typeof api.asc_getCellInfo === 'function' ? this.rightKind(api.asc_getCellInfo()) : null;
            } catch (e) {
                this.rightLast = null;
            }
        },

        /* A subscription to a stock view event under protection; the rollback removes it. */
        onView: function (view, name, fn) {
            if (!view || typeof view.on !== 'function') return;
            var cb = guarded('shell: ' + name, fn);
            view.on(name, cb);
            this.subs.push(function () { view.off && view.off(name, cb); });
        },

        onRightSelection: function (info) {
            var kind = this.rightKind(info);
            if (kind === null) return;
            var prev = this.rightLast;
            this.rightLast = kind;
            if (kind !== prev && /^(object|pivot):/.test(kind)) {
                this.rightOpen = true;
                this.rightExpand = true;
            }
            this.scheduleRight();
        },

        scheduleRight: function () {
            if (this.rightPending) return;
            var me = this;
            this.rightPending = true;
            setTimeout(guarded('shell: right panel', function () {
                me.rightPending = false;
                var expand = me.rightExpand;
                me.rightExpand = false;
                me.applyRightPanel(expand ? 'expand' : 'keep');
            }), 0);
        },

        /* A stock command showed the right panel — it will also expand it on its own tab. */
        stockOpensRight: function () {
            this.rightOpen = true;
            this.applyRightPanel('stock');
        },

        /* A manual entry is a shell command (there is no "View → Object properties" item in the menu bar row). In
           Stock a call from outside does not change the decision. */
        toggleRightPanel: function () {
            if (this.startupFailed || this.advanced || !document.getElementById(SHELL_ID)) return;
            this.rightOpen = !this.rightOpen;
            this.applyRightPanel('expand');
        },

        /* how: 'expand' — expand on the object's tab if the stock one is collapsed (a new
           decision to open); 'keep' — do not touch the expansion of an open one (a person could have
           collapsed it with a tab); 'stock' — the stock command expands it itself.
           In "Viewing" the panel is not visible: stock disables it (SetDisabled as part of the ban),
           there is nothing to edit in it; the rightOpen decision lives on and returns with "Editing". */
        applyRightPanel: function (how) {
            if (this.advanced || this.startupFailed || !document.getElementById(SHELL_ID)) return;
            var open = !!this.rightOpen && this.rightAvailable() && this.sheetMode !== 'view';
            var cl = document.body.classList;
            var changed = cl.contains('vo-right-open') !== open;
            /* The column slide-out is the appearance animation (compact-shell.less); the stock expand
               (SetActivePane sends layout:changed 'rightmenu') and our own layout — in one
               grid recalculation. */
            this.batch(function () {
                if (changed) cl.toggle('vo-right-open', open);
                if (open && how !== 'stock' && (how === 'expand' || changed)) this.expandRight();
                if (!open) this.collapseRight();
                if (!changed) return;
                /* The column visibility changed after the stock doLayout — a recalculation, as for the left
                   area: doLayout directly and the window resize (asc_Resize in stock). */
                var L = this.layout();
                L && L.h && L.h.doLayout();
                this.resync();
            });
        },

        /* The opening tab is the object's tab, the same that stock itself would choose for
           an expanded panel (the highest available one): for an image "Image", for a shape
           and TextArt — "Shape" (the TextArt tab in stock is available for an ordinary shape with
           text too, so TextArt cannot be distinguished by it), for a slicer — "Slicer", in
           a pivot — "Pivot table", on cells — "Cell". Whether a tab is available was decided by
           stock with its selection subscriber (its button is not disabled); unavailable —
           the next in the list; none — the panel stays a tab column, as in stock. */
        rightPane: function () {
            var D = window.Common && Common.Utils && Common.Utils.documentSettingsType;
            var T = window.Asc && Asc.c_oAscSelectionType;
            var v = this.rightView(), api = this.api;
            if (!D || !T || !v || !api || typeof api.asc_getCellInfo !== 'function') return null;
            var info = api.asc_getCellInfo();
            var t = info && typeof info.asc_getSelectionType === 'function' ? info.asc_getSelectionType() : null;
            var list;
            if (t === T.RangeImage) list = ['Image', 'Shape'];
            else if (t === T.RangeShape || t === T.RangeShapeText) list = ['Shape', 'TextArt', 'Paragraph'];
            else if (t === T.RangeSlicer) list = ['Slicer'];
            else if (t === T.RangeChart || t === T.RangeChartText) list = ['Paragraph'];
            else if (info && typeof info.asc_getPivotTableInfo === 'function' && info.asc_getPivotTableInfo()) list = ['Pivot', 'Cell'];
            else list = ['Cell'];
            for (var i = 0; i < list.length; i++) {
                var btn = v[RIGHT_TABS[list[i]]];
                if (btn && typeof btn.isDisabled === 'function' && !btn.isDisabled() && D[list[i]] !== undefined) return D[list[i]];
            }
            return null;
        },

        /* The expand is a press of a stock tab (SetActivePane on a collapsed one: the tab button,
           onBtnMenuClick, the tab content by the selection properties). Our own opening does not
           become the stock remembering "the panel is not collapsed": the Compact automation does not
           change the look of stock sessions on the same origin (as for the formula bar). A press of
           a tab by a person is remembered by stock. */
        expandRight: function () {
            var v = this.rightView();
            if (!v || v.minimizedMode !== true) return;
            var type = this.rightPane();
            if (type === null) return;
            var ls = window.Common && Common.localStorage;
            var was = ls && typeof ls.getItem === 'function' ? ls.getItem(RIGHT_COLLAPSED_KEY) : null;
            try {
                v.SetActivePane(type, true);
            } finally {
                if (ls && typeof ls.setItem === 'function') {
                    if (was === null || was === undefined) ls.removeItem(RIGHT_COLLAPSED_KEY);
                    else ls.setItem(RIGHT_COLLAPSED_KEY, was);
                }
            }
        },

        collapseRight: function () {
            var v = this.rightView();
            if (!v || v.minimizedMode !== false || typeof v.clearSelection !== 'function') return;
            v.clearSelection();
        },

        /* --- Focus mode and hidden toolbar ---------------------------------- */
        /* As in documents: focus hides the header and the menu bar row (the body class
           vo-focus), "View → Hide toolbar" — the toolbar itself
           (vo-tb-hidden). Mutually exclusive: together they would remove all chrome, and
           the return chevron lives in the toolbar. Only the shell height changes;
           the exit is the chevron, the "View" item and Escape (bindChromeEscape). In Stock
           we do not touch the layout: the modes are mutually exclusive, the focus state
           survives the round trip and returns together with Compact. */

        toggleFocus: function () {
            this.setChrome({focus: !this.focus, tbHidden: false});
        },

        toggleToolbar: function () {
            this.setChrome({focus: false, tbHidden: !this.tbHidden});
        },

        /* A row change — by motion and in one grid recalculation. */
        setChrome: function (state) {
            if (this.startupFailed || !document.getElementById(SHELL_ID)) return;
            this.batch(function () {
                this.closeSurfaces();
                this.focus = !!(state && state.focus);
                this.tbHidden = !!(state && state.tbHidden);
                if (this.tbHidden) this.closeContextTab(true);
                var cl = document.body.classList;
                cl.toggle('vo-focus', this.focus);
                cl.toggle('vo-tb-hidden', this.tbHidden);
                this.tb && this.tb.setFocusState(this.focus);
                if (!this.advanced) this.applyLayout(true, true);
                /* The name could have changed while the header was hidden by focus. */
                this.showsHeader();
            });
        },

        /* --- Book mode: "Editing" and "Viewing" ------------ */
        /* The switch in the header, the rightmost, the look is the document mode button: AIR filled
           primary in all modes, a chevron, a list of two modes with an explanation and a checkmark.
           "Viewing" is the path by which the stock
           of documents makes its own: a real input lock by the engine
           (asc_addRestriction(View)) plus the stock editing:disable with its own
           reason type and the composition of the spreadsheet Main.disableEditing (viewOptions) — the ribbon,
           the context menu, the right panel, the sheet row and the left menu are disabled by stock itself, and
           the reason stack (Main.stackDisableActions) puts and removes them by type. The return is
           removing the same reason and the same restriction bit: other reasons of the stack and
           other engine restrictions stay, the stock stack will restore its own.

           The right is a snapshot at start (readEditRight): in "Viewing" stock disables
           appOptions.isEdit too (LeftMenu.SetDisabled), and by the live field returning would
           not be possible. The snapshot is reset by the stock loss of rights (collaboration:sharingdeny).
           Without the right there is no switch at all, as in documents: the book is at once in "Viewing"
           (body.vo-view), we do not offer editing. A click rechecks the right and the lock (setSheetMode):
           while a foreign reason is on top of the stack (lost connection, background open,
           file update) or the connection is lost, switching is not allowed — the lock look
           is driven by applyModeLock by the same events. */

        /* The edit right at start. Stock disables appOptions.isEdit for the duration of its ban
           reason (LeftMenu.SetDisabled puts the previous value into previsEdit), and a shell launch
           during such a reason (a background open) would take the editor for a reader —
           then we take the right from what stock saved. */
        readEditRight: function () {
            var o = ((SSE.getController('Main') || {}).appOptions) || {};
            var lm = SSE.getController('LeftMenu');
            var held = lm && lm.leftMenu && lm.leftMenu._state && lm.leftMenu._state.disabled === true;
            if (held && typeof lm.previsEdit === 'boolean') return lm.previsEdit;
            return o.isEdit === true;
        },

        canSwitchMode: function () {
            return this.editRight === true;
        },

        /* The composition of the "Viewing" ban — a copy of the spreadsheet Main.disableEditing payload (the same
           set of keys, viewMode follows disable, as in stock: on removal stock waits for
           viewMode false, otherwise DisableToolbar would leave the ribbon under the mask). Our own
           values are two, and both are about what does not interfere with reading (the test checks the composition against
           stock and keeps this list explicit): comments are read (the panel is not disabled,
           previewMode — as in documents "Viewing": without adding and replies) and chat
           is alive. Search, download and print are alive by the stock composition: header.search
           and shortcuts — false, the file menu is disabled only by protection. */
        viewOptions: function (disable) {
            disable = !!disable;
            return {
                viewMode: disable,
                allowSignature: false,
                allowProtect: false,
                rightMenu: {clear: true, disable: true},
                statusBar: true,
                leftMenu: {disable: true, previewMode: true},
                fileMenu: {protect: true, history: false},
                comments: {disable: false, previewMode: true},
                chat: false,
                review: true,
                viewport: true,
                documentHolder: {clear: true, disable: true},
                toolbar: true,
                celleditor: {previewMode: true},
                header: {search: false},
                shortcuts: false
            };
        },

        /* The top of the stock ban reason stack: {on, options, type}; null — there is no stack. */
        lockTop: function () {
            var main = SSE.getController('Main');
            var stack = main && main.stackDisableActions;
            if (!stack || typeof stack.length !== 'function') return null;
            var n = stack.length();
            var top = n > 0 ? stack.get(n - 1) : null;
            return (top && top.disable)
                ? {on: true, options: top.options || {}, type: top.type}
                : {on: false, options: {}};
        },

        /* --- Roles and bans ----------------------------------------- */
        /* The answer for all consumers — the toolbar, the menu bar row, the switch: {on, options,
           type}. As in documents: the stock stack event lies ON TOP of the right — while a reason is in
           the stack, the surfaces are driven by its options (stock has already decided what to disable), and on an empty stack
           — the right. The right is constant for the whole session: for a reader the ban has type 'rights' and no
           surfaces — stock does not build the editing ribbon for a reader at all, and the items of its twins are
           inactive by themselves (there is no twin); restoring the connection does not give a reader the editing
           that they did not have before the disconnect either. There is no classification of reasons of our own, we do not keep a stack —
           we compute anew on every question. There is no shell yet (the rights are not taken) — no ban:
           the catalog is queried before the build too. */
        lockState: function () {
            if (this.editRight === null) return {on: false, options: {}};
            var top = this.lockTop();
            if (top && top.on) return top;
            if (this.editRight !== true) return {on: true, options: {}, type: 'rights'};
            return top || {on: false, options: {}};
        },

        /* A reason that can be named to a person: our own "Viewing" and the right. The others
           (lost connection, background open) — without a hint: stock itself speaks about them. The reason code
           (SheetActions.REASONS) is modeCode, its text is SheetActions.reasonText. */
        modeCode: function (st) {
            st = st || this.lockState();
            if (!st || !st.on) return null;
            if (st.type === VIEW_TYPE) return 'view';
            if (st.type === 'rights') return this.canRequestEdit() ? 'rightsRequest' : 'rights';
            return null;
        },

        /* A reader who can ask for editing: next to it "File →
           Edit spreadsheet" is alive, and "no right" would be untrue — the reason says how to
           start editing. The condition is stock's, the same as for the item (SheetActions, miEdit). */
        canRequestEdit: function () {
            var o = ((SSE.getController('Main') || {}).appOptions) || {};
            return !o.isEdit && !!o.canEdit && !!o.canRequestEditRights;
        },

        /* Shell commands that need a row: "Hide toolbar" — the toolbar row, the right panel (there is no "Object
           properties" item in the menu bar row, the flag stays for a catalog item). In "Viewing" and for a reader they are absent. */
        canUse: function (name) {
            if (name === 'toolbar' || name === 'rightPanel') return this.sheetMode !== 'view';
            return true;
        },

        /* The ban look: the toolbar mask — by the toolbar key of the stack reason (lost connection: stock
           puts a mask on the ribbon, DisableToolbar), the menu bar row — a snapshot anew (refresh),
           the switch — by the lock; the header — "History" and "Access" by the stock
           lock of their buttons, the "Download" rows — anew by the catalog, the title field — by the right
           to rename (lost connection and rights close it). There is no gate by advanced: we touch only our own nodes, and
           the return to Compact produces no events. */
        applyEditingLock: function () {
            var st = this.lockState();
            var mask = !!(st.on && st.options && st.options.toolbar);
            if (mask) this.closeContextTab(true);
            if (this.tb && typeof this.tb.setLocked === 'function' && !!this.tb.locked !== mask) this.tb.setLocked(mask);
            if (this.menu) this.menu.refresh();
            this.applyModeLock();
            this.applyCollabLock();
            this.refreshDownloadRows();
            this.applyRenameRight();
        },

        /* Switching is not allowed: the connection is lost or a foreign reason is on top of the stack. */
        modeLocked: function () {
            var main = SSE.getController('Main');
            if (main && main._state && main._state.isDisconnected) return true;
            var top = this.lockTop();
            return !!(top && top.on && top.type !== VIEW_TYPE);
        },

        setSheetMode: function (mode) {
            if (this.startupFailed || !document.getElementById(SHELL_ID)) return false;
            if (mode !== 'edit' && mode !== 'view') return false;
            /* The second end of the gate: the right and the lock — at the moment of the action. */
            if (!this.canSwitchMode() || this.modeLocked()) { this.applyModeLock(); return false; }
            if (mode === this.sheetMode) return false;
            var api = this.api, R = window.Asc && Asc.c_oAscRestrictionType;
            if (!api || !R || typeof api.asc_addRestriction !== 'function' || typeof api.asc_removeRestriction !== 'function') return false;
            var view = mode === 'view';
            /* An open comments panel in "Viewing" stays: the stock ban closes
               the left panel (LeftMenu.SetDisabled →
               close), but comments can be read — the composition of "Viewing" does not disable the panel button. */
            var keepComments = view && Bridge.state(COMMENTS_TWIN).pressed;
            /* The stock ban disables and shows the right and left panels, the rows change —
               each subscriber with its own layout:changed; the grid — in one recalculation. */
            this.batch(function () {
                this.setEngineView(view);
                Common.NotificationCenter.trigger('editing:disable', view, this.viewOptions(view), VIEW_TYPE);
                if (keepComments) this.reopenComments();
                this.applySheetModeLook(mode);
            });
            return true;
        },

        /* The comments panel again — by the stock button, already in the stock comment "preview"
           (comments.previewMode from the ban composition: without adding and replies). Stock could have not
           closed it or disabled the button (then there is nothing to read with) — we do not touch it. */
        reopenComments: function () {
            var st = Bridge.state(COMMENTS_TWIN);
            if (!st.exists || st.pressed || st.disabled) return;
            SheetActions.leftPanel({k: 'comments', twin: COMMENTS_TWIN, left: 'toggle'}, this);
        },

        /* Our own "Viewing" bit in the engine restrictions. While the engine has an action of its own with a
           restriction — a disconnect, a background open (sdkjs apiBase: sync_StartAction with
           actionRestriction), — the current restrictions are its: the previous ones, with our bit, it saved
           (IsActionRestrictionPrev) and will return at sync_EndAction. Then the bit is set and removed in
           the saved ones: removed from the current ones, it would come back with the restoration, and the interface
           would show editing while input would silently go nowhere.
           The current ones are the engine's own ban for the duration of the action, we do not touch them. */
        setEngineView: function (on) {
            var api = this.api, view = Asc.c_oAscRestrictionType.View;
            if (typeof api.isActionWithRestriction === 'function' && api.isActionWithRestriction() &&
                typeof api.IsActionRestrictionPrev === 'number') {
                api.IsActionRestrictionPrev = on ? (api.IsActionRestrictionPrev | view) : (api.IsActionRestrictionPrev & ~view);
                return;
            }
            if (on) api.asc_addRestriction(view);
            else api.asc_removeRestriction(view);
        },

        /* Remove our own "Viewing" without the switch gates: the switch to Stock. Its
           ribbon is under the mask of our reason, and there is nothing to remove it with — there is no switch in Stock.
           The path is the same as for "Editing" (setSheetMode): our own bit of the engine restriction and
           our own stack reason. Under a foreign reason (lost connection, background open) ours
           is removed from under it: stock takes it out of the stack and returns the surfaces of the top one
           (prev_options), and the bit — from the restrictions that the engine will return at the end of its
           action (setEngineView); the foreign ban stays, and when it is lifted — editing, not
           "Viewing". The look — after the mode change: in Stock applySheetModeLook drives only
           the caption, the class and the title field. */
        dropOwnView: function () {
            if (this.sheetMode !== 'view' || this.editRight !== true) return false;
            var api = this.api, R = window.Asc && Asc.c_oAscRestrictionType;
            if (!api || !R || typeof api.asc_removeRestriction !== 'function') return false;
            this.batch(function () {
                this.setEngineView(false);
                Common.NotificationCenter.trigger('editing:disable', false, this.viewOptions(false), VIEW_TYPE);
                this.applySheetModeLook('edit');
            });
            return true;
        },

        /* The mode look: the switch caption and mark, the body class (in "Viewing" there is no toolbar
           row — compact-shell.less), the shell height and the right panel. */
        applySheetModeLook: function (mode) {
            var me = this;
            this.sheetMode = mode === 'view' ? 'view' : 'edit';
            var ui = this.modeUi;
            if (ui && ui.label) ui.label.textContent = this[this.sheetMode === 'view' ? 'textModeView' : 'textModeEdit'];
            if (ui && ui.items) {
                Object.keys(ui.items).forEach(function (k) {
                    var on = k === me.sheetMode;
                    ui.items[k].classList.toggle('on', on);
                    ui.items[k].setAttribute('aria-checked', on ? 'true' : 'false');
                });
            }
            document.body.classList.toggle('vo-view', this.sheetMode === 'view');
            /* In "Viewing" there is no renaming: the field is closed, "Editing" opens it. */
            this.applyRenameRight();
            if (this.advanced) return;
            this.closeSurfaces();
            /* The right panel — before the rows: its layout (a window resize) in the middle of a row transition
               would end it (bindMotion). */
            this.applyRightPanel(this.sheetMode === 'view' ? 'keep' : 'expand');
            this.applyLayout(true, true);
        },

        /* Without the edit right there is no switch: null, and modeUi — null (all accesses to it
           survive this). */
        buildModeSwitch: function () {
            var me = this;
            this.modeUi = null;
            if (!this.canSwitchMode()) return null;
            var wrap = document.createElement('span');
            wrap.className = 'vo-pop-wrap vo-docmode';
            var btn = document.createElement('button');
            btn.setAttribute('type', 'button');
            btn.className = 'vo-mode accent';
            wrap.appendChild(btn);
            this.modeUi = {wrap: wrap, btn: btn, label: null, pop: null, items: {}};
            var label = document.createElement('span');
            label.textContent = this[this.sheetMode === 'view' ? 'textModeView' : 'textModeEdit'];
            var caret = document.createElement('span');
            caret.className = 'vo-heading-caret';
            caret.innerHTML = Icons.svg('chevron', 16);
            btn.appendChild(label);
            btn.appendChild(caret);
            CompactToolbar.setTip(btn, this.textModeSwitch);
            btn.setAttribute('aria-haspopup', 'menu');
            btn.setAttribute('aria-expanded', 'false');

            var pop = document.createElement('div');
            pop.className = 'vo-pop vo-pop-list vo-pop-rich';
            pop.setAttribute('role', 'menu');
            MODES.forEach(function (m) {
                var item = document.createElement('button');
                item.setAttribute('type', 'button');
                item.className = 'vo-pop-item';
                item.setAttribute('role', 'menuitemradio');
                item.setAttribute('data-mode', m.v);
                /* The rows are not Tab stops: arrows move between them (modeKey). */
                item.setAttribute('tabindex', '-1');
                var on = m.v === me.sheetMode;
                item.classList.toggle('on', on);
                item.setAttribute('aria-checked', on ? 'true' : 'false');
                var i = document.createElement('span');
                i.className = 'vo-pop-i';
                i.innerHTML = Icons.svg(m.i, 18);
                var text = document.createElement('span');
                text.className = 'vo-pop-text';
                var t = document.createElement('span');
                t.className = 'vo-pop-t';
                t.textContent = me[m.t];
                var d = document.createElement('span');
                d.className = 'vo-pop-d';
                d.textContent = me[m.d];
                text.appendChild(t);
                text.appendChild(d);
                var chk = document.createElement('span');
                chk.className = 'vo-pop-check';
                chk.innerHTML = Icons.svg('checkMenu', 18);
                item.appendChild(i);
                item.appendChild(text);
                item.appendChild(chk);
                item.addEventListener('click', guarded('shell: mode item', function (e) {
                    e && e.stopPropagation && e.stopPropagation();
                    me.closeModePopover();
                    me.setSheetMode(m.v);
                }));
                pop.appendChild(item);
                me.modeUi.items[m.v] = item;
            });
            wrap.appendChild(pop);
            this.modeUi.label = label;
            this.modeUi.pop = pop;
            btn.addEventListener('click', guarded('shell: mode switch', function (e) {
                e && e.stopPropagation && e.stopPropagation();
                /* We reread the lock on the click: the look is driven by applyModeLock, and the decision is made by
                   the stock truth at this moment. */
                if (me.modeLocked()) { me.applyModeLock(); return; }
                var open = !me.modeOpen();
                me.closeSurfaces();
                if (open) me.openModePopover();
            }));
            wrap.addEventListener('keydown', guarded('shell: mode keys', function (e) { me.modeKey(e); }));
            return wrap;
        },

        /* The mode switch keyboard — as for the toolbar lists: ↓, ↑, Enter and Space
           on the button open the list, focus on the marked row (↑ — on the last); in the list
           ↑/↓ go around in a circle, Home/End, Enter and Space choose the row (its click, as with the mouse), and focus
           returns to the button; Tab closes the list and goes on as usual; Escape is common
           (bindChromeEscape, openerChain → the button). The list is role=menu: the stock Bootstrap delegate
           would swallow both the choice and Tab (the stock Bootstrap delegate on keydown in [role=menu]), so handled
           keys do not go further, Tab — without preventDefault. */
        modeKey: function (e) {
            var ui = this.modeUi;
            if (!ui || !ui.pop || !e || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || this.advanced) return;
            var t = e.target, key = e.key;
            var items = MODES.map(function (m) { return ui.items[m.v]; }).filter(Boolean);
            var n = items.length;
            if (!n) return;
            if (t === ui.btn) {
                if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter' && key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                if (this.modeLocked()) { this.applyModeLock(); return; }
                if (!this.modeOpen()) {
                    this.closeSurfaces();
                    this.openModePopover();
                }
                var on = items.filter(function (el) { return el.classList.contains('on'); })[0];
                (key === 'ArrowUp' ? items[n - 1] : (on || items[0])).focus();
                return;
            }
            var i = items.indexOf(t);
            if (i < 0) return;
            if (key === 'Tab') {
                this.closeModePopover();
                ui.btn.focus();
                e.stopPropagation();
                return;
            }
            if (key === 'ArrowDown') items[(i + 1) % n].focus();
            else if (key === 'ArrowUp') items[(i - 1 + n) % n].focus();
            else if (key === 'Home') items[0].focus();
            else if (key === 'End') items[n - 1].focus();
            else if (key === 'Enter' || key === ' ') {
                t.click();
                /* The row is hidden together with the list — focus to the button (the switch might
                   be gone: loseEditRight removes it). */
                var btn = this.modeUi && this.modeUi.btn;
                if (btn && btn.isConnected !== false && btn.getClientRects().length) this.focusHeld(btn);
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        },

        modeOpen: function () {
            var ui = this.modeUi;
            return !!(ui && ui.pop && ui.wrap.classList.contains('open'));
        },

        openModePopover: function () {
            var ui = this.modeUi;
            if (!ui || !ui.pop) return;
            ui.wrap.classList.add('open');
            ui.btn.setAttribute('aria-expanded', 'true');
        },

        closeModePopover: function () {
            var ui = this.modeUi;
            if (!ui || !ui.pop || !ui.wrap.classList.contains('open')) return;
            ui.wrap.classList.remove('open');
            ui.btn.setAttribute('aria-expanded', 'false');
        },

        /* The switch lock look — by class and aria-disabled, not by the
           disabled attribute: a disabled button gets no click from the browser, and the second end of the gate
           would stop being checked. */
        applyModeLock: function () {
            var ui = this.modeUi;
            if (!ui || !ui.pop) return;
            var lock = this.modeLocked();
            ui.btn.classList.toggle('vo-locked', lock);
            ui.btn.setAttribute('aria-disabled', lock ? 'true' : 'false');
            if (lock) this.closeModePopover();
        },

        /* Stock on a ban and disconnect does not send a separate "shell — disable your own": the look
           is recalculated after its subscribers on the same events — editing:disable (the stack
           is already final: Main is subscribed earlier, and restoring the other reasons inside
           Main is a direct call, not a repeated event), api:disconnect and the disconnect from
           the engine (Main updates the state in the same delivery — we wait for its end). The stock
           loss of rights resets the right snapshot. */
        bindEditingLock: function () {
            var me = this;
            this.onNote('editing:disable', function () { me.applyEditingLock(); });
            this.onNote('api:disconnect', function () { me.applyEditingLock(); });
            this.onApi('asc_onCoAuthoringDisconnect', function () {
                setTimeout(guarded('shell: lock after disconnect', function () { me.applyEditingLock(); }), 0);
            });
            this.onNote('collaboration:sharingdeny', function () {
                me.loseEditRight();
                me.applyEditingLock();
            });
            /* The start and end of cell editing: stock disables and returns its buttons and the items of their menus in the same event (they are read by
               items with a twin and with the byRows flag), for an item with the cellEditOff flag (SheetActions) the editing flag is
               api.isCellEdited, set by the formula bar controller. The rows of the open section are recalculated after all
               subscribers: the availability of items during cell editing is the same as for the stock commands at that moment. */
            this.onApi('asc_onEditCell', function () {
                setTimeout(guarded('shell: relock after cell edit', function () { if (me.menu) me.menu.refresh(); }), 0);
            });
            this.applyEditingLock();
        },

        /* The right is gone: there is no switch, as for a reader. We do not touch the mode and layout:
           stock puts the lost-connection ban itself, and a height jump in the middle of
           work is not needed. */
        loseEditRight: function () {
            if (this.editRight !== true) return;
            this.editRight = false;
            var ui = this.modeUi;
            if (!ui) return;
            this.closeModePopover();
            this.modeUi = null;
            if (ui.wrap.parentNode) ui.wrap.parentNode.removeChild(ui.wrap);
        },

        /* --- Version history window ------------------------------------------- */
        /* The stock history column (Common.Views.History in #left-panel-history) in Compact is
           a non-modal window over the sheet; the look is compact-shell.less, the "Version history window" section.
           The markup, stock handlers, layout and the stock check panelHistory.isVisible()
           are not changed, the nodes are not moved. Here is what styles cannot say: the window role and
           the caption for the reader, the AIR glyphs on the stock "Close history" and "More" buttons, focus in
           the window, Escape and the vo-history class on body (by it the sheet stays without the left line
           that stock returns on 'history'). Stock sends layout:changed 'history' also
           repeatedly (a handle, a resize), a mode change goes by the same notification with another section —
           syncHistory is idempotent: in Stock the window is removed, on return to Compact
           it is put on again. */
        historyDressed: false,   // the window attributes and glyphs are in place
        historyFocused: false,   // the first-show focus has been set
        historyClaim: false,     // focus belongs to the window (keepHistoryFocus)

        bindHistoryWindow: function () {
            var me = this;
            this.onNote('layout:changed', function (area) { me.syncHistory(area === 'history'); });
            /* Focus belongs to the window from the first show and after a mouse press in the window (a click on
               a version); a press outside the window and Tab give it back to the person. The capture on document is earlier than
               the engine handlers on the canvas, which swallow a press over the grid. */
            var DOWN = ('onpointerdown' in window) ? 'pointerdown' : 'mousedown';
            var press = guarded('shell: history focus', function (e) {
                var box = me.historyBox(), t = e && e.target;
                me.historyClaim = !!box && !!t && t.nodeType === 1 && box.contains(t);
            });
            var tab = guarded('shell: history focus', function (e) {
                if (e && (e.key === 'Tab' || e.keyCode === 9)) me.historyClaim = false;
            });
            var keep = guarded('shell: history focus', function (e) { me.keepHistoryFocus(e); });
            document.addEventListener(DOWN, press, true);
            document.addEventListener('keydown', tab, true);
            document.addEventListener('focusin', keep, true);
            this.subs.push(function () {
                document.removeEventListener(DOWN, press, true);
                document.removeEventListener('keydown', tab, true);
                document.removeEventListener('focusin', keep, true);
                me.undressHistory();
            });
        },

        historyBox: function () {
            var col = document.getElementById('left-panel-history');
            var box = document.getElementById('history-box');
            return col && box && col.getClientRects().length > 0 ? box : null;
        },

        /* first — the notification came with the 'history' section (showing the column or its repeat). */
        syncHistory: function (first) {
            var box = this.advanced ? null : this.historyBox();
            document.body.classList.toggle('vo-history', !!box);
            if (!box) {
                this.undressHistory();
                return;
            }
            this.dressHistory(box);
            /* Focus — once, on the first show: a repeat of 'history' does not move it. */
            if (first && !this.historyFocused) {
                this.historyFocused = true;
                this.historyClaim = true;
                box.focus();
            }
        },

        dressHistory: function (box) {
            var label = box.querySelector('#history-header > label');
            if (label && !label.id) label.id = HISTORY_TITLE_ID;
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'false');
            if (label && label.id) box.setAttribute('aria-labelledby', label.id);
            box.setAttribute('tabindex', '-1');
            /* Focus in the window is not the sheet's input: with this mark the engine gives up the keyboard and does not
               take focus back into its field, as for the stock dropdown menus (sdkjs
               text_input2.js, oo_editor_input). Without it focus does not stay on the box. */
            box.setAttribute('oo_editor_input', 'true');
            /* Without canHistoryClose there is no exit from history in the editor (stock hides the header,
               controller/History.js setMode): the window keeps its caption, there is no cross. */
            box.classList.toggle('vo-history-noclose', !this.stockOptions().canHistoryClose);
            [['#history-btn-back button', 'close'], ['#history-btn-menu button', 'more']].forEach(function (g) {
                var btn = box.querySelector(g[0]);
                if (btn && !btn.querySelector('.vo-air')) btn.insertAdjacentHTML('beforeend', Icons.svg(g[1], HISTORY_GLYPH));
            });
            this.historyDressed = true;
        },

        /* The stock column look: in Stock and after a shell rollback — neither window attributes nor
           glyphs (the .vo-air rule does not depend on the mode, and the glyph would stand next to the sprite). */
        undressHistory: function () {
            if (!this.historyDressed) return;
            this.historyDressed = false;
            document.body.classList.remove('vo-history');
            var box = document.getElementById('history-box');
            if (!box) return;
            HISTORY_ATTRS.forEach(function (a) { box.removeAttribute(a); });
            box.classList.remove('vo-history-noclose');
            var label = document.getElementById(HISTORY_TITLE_ID);
            if (label && box.contains(label)) label.removeAttribute('id');
            Array.prototype.forEach.call(box.querySelectorAll('#history-btn-back .vo-air, #history-btn-menu .vo-air'),
                function (n) { n.parentNode.removeChild(n); });
        },

        /* While focus belongs to the window, stock does not take it away. Stock itself gives focus to the sheet — both in
           the column show chain (LeftMenu.aboutShowHide → asc_enableKeyEvents(true)), and on
           loading a version to the sheet (the end of a long action → Main.onEditComplete →
           DocumentHolder.focus, deferred). Focus that left this way returns on the next tick,
           after the stock chain, — to the box: the engine accepts it (oo_editor_input), and
           the return does not argue with it in a circle. Focus in the shell, in a stock window and in
           a dropdown menu we do not touch: a person or a window leads it there. */
        keepHistoryFocus: function (e) {
            if (!this.historyClaim || this.advanced) return;
            var box = this.historyBox(), t = e && e.target;
            if (!box || !t || box.contains(t) || this.historyFocusElsewhere(t)) return;
            var me = this;
            setTimeout(guarded('shell: history focus', function () {
                var now = me.historyBox(), a = document.activeElement;
                if (!me.historyClaim || me.advanced || now !== box) return;
                if (a && (box.contains(a) || me.historyFocusElsewhere(a))) return;
                box.focus();
            }), 0);
        },

        historyFocusElsewhere: function (el) {
            return !!el && el.nodeType === 1 && typeof el.closest === 'function' &&
                   !!el.closest('#toolbar, .asc-window, .dropdown-menu');
        },

        /* Escape with focus in the window is its cross: the stock "Close history" button with the same
           click, one close request to the portal. An open "More" list is closed by Escape itself
           (the stock dropdown). Without canHistoryClose there is no cross, and the key is not ours. */
        historyEscape: function (e) {
            if (!this.historyDressed) return false;
            var box = this.historyBox(), t = e && e.target;
            if (!box || !t || t.nodeType !== 1 || !box.contains(t)) return false;
            if (t.closest('.dropdown-menu') || box.querySelector('.btn-group.open')) return false;
            if (!this.stockOptions().canHistoryClose) return false;
            var btn = box.querySelector('#history-btn-back button');
            if (!btn || btn.disabled || !btn.getClientRects().length) return false;
            btn.click();
            return true;
        },

        contextTab: function (tab, info) {
            if (!Object.prototype.hasOwnProperty.call(SheetActions.CONTEXT_TABS, tab)) return null;
            var ctl = SSE.getController('Toolbar'), view = ctl && ctl.toolbar;
            var link = document.querySelector('#toolbar .toolbar a[data-tab="' + tab + '"]');
            // The ribbon is hidden in compact mode. Read the tab's own visibility instead of :visible.
            var manager = Common.UI.LayoutManager;
            if (manager && typeof manager.isElementVisible === 'function' &&
                manager.isElementVisible('toolbar-' + tab) === false) return null;
            if (!view || typeof view.getTab !== 'function' || !view.getTab(tab) || !link ||
                link.parentNode.style.display === 'none') return null;
            info = info || (this.api && this.api.asc_getCellInfo());
            return info && this.selectionHasContext(tab, info) ? view : null;
        },

        selectionHasContext: function (tab, info) {
            var type = info.asc_getSelectionType();
            var types = Asc.c_oAscSelectionType;
            if (tab === 'charttab') return type === types.RangeChart || type === types.RangeChartText;
            if (type !== types.RangeCells && type !== types.RangeCol && type !== types.RangeRow && type !== types.RangeMax)
                return false;
            if (tab === 'pivot') return !!info.asc_getPivotTableInfo();
            if (tab === 'tabledesign') return !!info.asc_getFormatTableInfo();
            return !!info.asc_getSparklineInfo();
        },

        canOpenContextTab: function () {
            var lock = this.lockState();
            return this.editRight === true && this.sheetMode === 'edit' && !this.advanced && !this.tbHidden &&
                !(lock.on && lock.options.toolbar) && !SheetActions.cellEdited() && SheetActions.engineEdits();
        },

        toggleContextTab: function (tab) {
            var view = this.contextTab(tab);
            if (!view || !this.canOpenContextTab()) return false;
            if (this.contextRibbon === tab) return this.closeContextTab(true);
            this.contextRibbon = tab;
            document.body.classList.add(CONTEXT_RIBBON);
            view.setTab(tab);
            if (tab === 'pivot') {
                var pivot = SSE.getController('PivotTable');
                if (pivot && typeof pivot.onPivotOpen === 'function') pivot.onPivotOpen();
            }
            this.applyLayout(true);
            var panel = view.getTab(tab)[0];
            var more = typeof view.getMorePanel === 'function' && view.getMorePanel(tab);
            this.prepareContextKeyboard(tab, panel, more && more[0]);
            panel.setAttribute('tabindex', '-1');
            this.holdKeys();
            this.focusHeld(panel);
            return true;
        },

        prepareContextKeyboard: function (tab, panel, more) {
            // Bootstrap's ribbon handler otherwise swallows Tab, Enter and Space on these buttons.
            [panel, more].forEach(function (root) {
                if (!root) return;
                Array.prototype.forEach.call(root.querySelectorAll('button[data-toggle="dropdown"]'), function (button) {
                    button.classList.add('move-focus');
                });
            });
            var names = {pivot: 'PivotTable', tabledesign: 'TableDesignTab', charttab: 'ChartTab', sparklinetab: 'SparklineTab'};
            var controller = SSE.getController(names[tab]);
            var stock = controller && controller.view;
            var CheckBox = Common.UI.CheckBox;
            if (!stock || !CheckBox) return;
            stock.getButtons().forEach(function (control) {
                if (control instanceof CheckBox) control.setTabIndex(0, true);
            });
        },

        escapeContextTab: function (e) {
            var target = e.target;
            if (this.leftPanelField(target)) return false;
            var withinRibbon = target && typeof target.closest === 'function' && target.closest('#toolbar .toolbar');
            var popup = withinRibbon && target.closest('.open');
            if (popup) {
                var opener = popup.querySelector('button[data-toggle="dropdown"]');
                if (opener && this.keysHeld) this.keepFocus(opener);
                return false;
            }

            var controller = SSE.getController('Toolbar');
            var view = controller && controller.toolbar;
            var more = view && typeof view.getMorePanel === 'function' && view.getMorePanel(this.contextRibbon);
            var overflow = more && more[0].parentNode;
            var trigger = view && view.getTab(this.contextRibbon)[0].querySelector('.more-box button');
            var inOverflow = overflow && overflow.contains(target);
            if (inOverflow && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return false;
            if (this.escapeTakenElsewhere(e) && !inOverflow) return false;
            if (trigger && overflow && overflow.getClientRects().length && (inOverflow || trigger === target)) {
                view.closeVisibleMoreDropdown();
                this.holdKeys();
                this.focusHeld(trigger);
                return true;
            }
            this.closeContextTab(true);
            this.leaveToSheet();
            return true;
        },

        closeContextTab: function (resetTab) {
            if (!this.contextRibbon) return false;
            var ctl = SSE.getController('Toolbar'), view = ctl && ctl.toolbar;
            this.contextRibbon = null;
            document.body.classList.remove(CONTEXT_RIBBON);
            if (resetTab && view) {
                if (view.isFolded) view.setTab();
                else view.setTab('home');
            }
            this.applyLayout(true);
            if (!this.focusInShell()) this.releaseKeys();
            return true;
        },

        /* --- Modes -------------------------------------------------------- */
        /* We remove the side area classes in Stock: there they are
           managed by the stock icon and tab columns. On return the state
           is read anew: of the left area — from the pressed state of the stock buttons (a mode
           change does not produce layout:changed 'leftmenu', and an open panel would otherwise
           have vanished with the stock button pressed), of the right — from the rightOpen decision
           (a mode change does not produce a new selection either, and with a selected object
           the panel would have stayed closed). The stock right panel, collapsed or
           expanded in Stock, is brought to its look by the decision. */
        toggleMode: function () {
            /* Without a built shell there is nothing to switch: there is no snapshot of the stock heights,
               and applyLayout(false) would zero the ribbon's height. */
            if (this.startupFailed || !document.getElementById(SHELL_ID)) return;
            this.closeContextTab(true);
            this.closeSurfaces();
            this.advanced = !this.advanced;
            /* "Viewing" is a Compact mode: to Stock — with editing. After the flag
               change: the look of the Compact mode (rows, right panel) is not applied here. */
            if (this.advanced) this.dropOwnView();
            var cl = document.body.classList;
            cl.toggle('vo-compact', !this.advanced);
            cl.toggle('vo-advanced', this.advanced);
            cl.remove('vo-left-open');
            cl.remove('vo-right-open');
            this.applyAreaRole();
            /* The column header menu — only in Compact: in Stock the layer is removed and a right
               click on a header is stock. The same for the substitution of the stock showMenu of the left menu
               (bindStockPanels): in Stock the view has its own method. */
            if (this.advanced) {
                ColumnHeaderMenu.detach();
                this.unbindStockPanels();
            }
            /* The classes are already switched: the snapping is computed by the styles of the new mode. Before the
               layout: into Stock the formula bar returns to the stock place, into Compact —
               goes into the plate, and the row height is already with it. */
            if (this.advanced) FormulaBar.release();
            else FormulaBar.apply(this.rows && this.rows.plate);
            this.applyLayout(!this.advanced);
            /* The engine gets the header colors of the new mode. */
            this.applyCanvasSkin();
            this.ensureBackButton();
            if (!this.advanced) {
                this.syncLeftState();
                this.applyRightPanel('expand');
                ColumnHeaderMenu.attach(this);
                this.bindStockPanels();
                /* The name could have changed in Stock (the stock title, the portal, a co-author). */
                this.showsHeader();
            }
        },

        ensureBackButton: function () {
            var me = this;
            var btn = document.getElementById(BACK_ID);
            if (!this.advanced) {
                btn && btn.parentNode && btn.parentNode.removeChild(btn);
                return;
            }
            if (btn) return;

            btn = document.createElement('button');
            btn.setAttribute('type', 'button');
            btn.id = BACK_ID;
            btn.className = 'vo-mode';
            btn.textContent = this.textCompact;
            btn.setAttribute('title', this.tipBackToCompact);
            btn.addEventListener('click', guarded('shell: back to compact', function () {
                if (me.advanced) me.toggleMode();
            }));

            /* The right group of the stock header (common/main/lib/view/Header.js). With
               compactHeader it lives in the ribbon's extra slot, otherwise — in #app-title. */
            var host = document.querySelector('#box-right-btn-group') || document.querySelector('#toolbar .extra');
            if (host) {
                host.appendChild(btn);
            } else {
                btn.classList.add('vo-back-float');
                document.body.appendChild(btn);
            }
        },

        /* --- Texts ------------------------------------------------------------ */
        /* The defaults are English: the locale overrides them from locale/<language>.json
           (the keys SSE.Views.CompactShell.*), and for languages without a translation they are what is seen. */

        textCompact: 'Switch to compact view',
        textDocument: 'Spreadsheet',
        textMenuBar_ARIA: 'Menu',
        textModeEdit: 'Editing',
        textModeEditHint: 'Changes are applied immediately',
        textModeLockedRequest: 'Viewing only — to edit, choose File → Edit spreadsheet',
        textModeLockedRights: 'No permission to edit',
        textModeLockedView: 'Unavailable in viewing mode',
        textModeSwitch: 'Mode',
        textModeView: 'Viewing',
        textModeViewHint: 'The spreadsheet is open for reading',
        textSaved: 'Saved',
        textSaving: 'Saving…',
        textStepDown_ARIA: 'Decrease',
        textStepUp_ARIA: 'Increase',
        textUnsaved: 'Unsaved',
        tipBackToCompact: 'Back to compact view',
        tipHistory: 'Version history',
        tipRename: 'Spreadsheet name can be changed',
        tipRenameDisabled: 'Renaming is not available',
        tipSharing: 'Sharing settings'

    }, SSE.Views.CompactShell || {});

    /* Shared controllers (ReviewChanges) ask the shared layer registry about the chosen shell, not
       the editor. Whether the spreadsheet shell is chosen — wanted; the personal tracking mode of spreadsheets is stock:
       it does not follow the shared document flag. */
    var shells = window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.Shells;
    if (shells && typeof shells.register === 'function') {
        shells.register({
            wanted: function (config) { return SSE.Views.CompactShell.wanted(config); },
            personalReviewFollowsShared: false
        });
    }

    return SSE.Views.CompactShell;
});
