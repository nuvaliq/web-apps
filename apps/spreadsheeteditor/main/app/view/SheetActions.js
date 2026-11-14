/*
 * SheetActions — the catalog of the menu bar row of the "Compact" spreadsheet shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Eight sections in menu bar order: File · Edit · View ·
 * Insert · Format · Data · Collaboration · Help ("Collaboration" — the same as
 * in the document editor, DE.Views.DocumentActions.textCollaboration). The item captions are in
 * the locale; the submenus are translated by stock. An item is {k, t, i, twin | run, sub?, pick?, left?,
 * lockLike?, sameCommand?, fileLock?, needs?, check?, sc?, when?, also?}, a composite one
 * {k, t, i?, items, when?} or {sep: true}:
 *  - twin — the twin address in the stock ribbon (view/StockBridge.js): the command goes by its
 *    stock path, availability and pressed state are read from it;
 *  - run — a command without a twin; such places are on a short list and each is covered by a spy:
 *    download (LeftMenu.clickSaveAsFormat), print (the 'print' notification), the screens of the
 *    file menu (LeftMenu.showMenu, for "Function list" — with the help page address),
 *    the keyboard shortcuts window (Common.Views.ShortcutsDialog), the "About" window (Common.UI.Compact.AboutWindow),
 *    rename (the title field in the
 *    header, CompactShell.editTitle; without the field — LeftMenu.clickMenuFileItem) and entering editing
 *    (LeftMenu.clickMenuFileItem), cell indent (api.asc_setCellIndent — in stock it is
 *    only the right panel's stepper), copy (the handler of the "Copy" item of the
 *    context menu, DocumentHolder.onCopyPaste) and the shell items;
 *  - sub — a submenu: a mirror of the twin's stock menu, taken on opening;
 *  - gallery — the twin's stock gallery: a row with ▸
 *    opens the stock gallery menu at the row itself (StockBridge.popup), the choice is made in
 *    the gallery by the stock path; where it cannot be shown — the stock command dialog
 *    (StockBridge.dialog);
 *  - pick — an item of the twin's stock menu that the item performs (for "Symbol"
 *    the stock submenu is a gallery of recent symbols and "More symbols"): an index path
 *    ('2') or the item's value ({value: v | function () { return v; }} — the Asc constants
 *    are read at call time, StockBridge.locate). The found item enters the state:
 *    disabled if the button or the item itself is disabled (stock menu items have their own locks
 *    that the button lacks), the mark is from the item. An item by value without t takes the caption
 *    of the stock item (label); if stock has no such item — we have none either;
 *  - items — a composite submenu (one level, groups with headings separated by
 *    a separator): the children are ordinary catalog items with their own twin | run | pick, check, sc,
 *    when, lockLike, edit, gate, as well as {sep: true}, a group heading {head: text} and
 *    stock menu rows in place {mirror: '<twin>', edit?, mask?, also?}. The children
 *    are filtered by the same rule 1 (groups); a holder without children is not drawn, a heading and
 *    a separator without items are removed. The holder is disabled when all its visible
 *    children are disabled, the reason is from the first; it does not execute a command itself;
 *  - left — the item opens the stock left area panel: 'open' — open if
 *    closed, 'toggle' — open or close (its place is given by the shell);
 *  - lockLike / fileLock — for a command without a twin, availability is read from the stock
 *    control of the same lock: a ribbon button or a file menu item. This is a source of
 *    availability, not a command address: cell indent is disabled together with "Align left", but
 *    it is not the same command;
 *  - sameCommand — lockLike has the same stock command as the item (print — the ribbon "Print" button):
 *    for coverage checking the item is its address;
 *  - needs — a shell command that may be missing: without it the item
 *    stays in place, disabled;
 *  - check — the mark of a toggle item by the twin's pressed state; 'radio' — an item of a single-choice
 *    group (mutually exclusive modes between separators): for the screen reader menuitemradio, not a checkbox;
 *    an already chosen one (the twin is pressed) is not executed again — the choice is made (exec);
 *  - on — for a choice item without a twin of its own, the mark is read by a function rather than from the control of the same
 *    lock: "View → Zoom ▸ 75 %" is marked when the sheet zoom is 75 % right now (the zoom buttons of the
 *    bottom row have no pressed state); a non-standard zoom (110 %) — no mark on any;
 *  - also — for coverage checking: {stock control: submenu row} — the
 *    control has the same stock command as the mirror row of this item (address
 *    "menu <section> > <item> > <row>");
 *  - sc — the name of the stock keyboard shortcut action (Asc.c_oAscSpreadsheetShortcutType):
 *    the hint on the right of the item is the shortcut from the stock registry (shortcut) in the
 *    shell; the set of items with a shortcut is the catalog's own;
 *  - rowSc — for a mirror submenu (sub): [{value, sc}] — for the stock menu row with this value
 *    (value — a value or a function, read on opening) the shortcut of action sc on the right, when
 *    the row has no explanation of its own: the same command as the key (mirrorRows);
 *  - when — the integration lacks the capability or the document lacks the right — there is no
 *    item. The conditions are stock (view/FileMenu.js applyMode,
 *    lib/view/ReviewChanges.js, controller/LeftMenu.js), asked on every
 *    section build;
 *  - use — the shell command needs a row that is absent in "Viewing" and for the reader: the toolbar
 *    ('toolbar') or the right panel ('rightPanel') — CompactShell.canUse;
 *  - gate — the command has a shell control with its own availability rule, and the item follows the
 *    same rule: the name of a shell predicate, false — the item is inactive with a reason. "Rename"
 *    — the title field in the header (CompactShell.canRename: closed in "Viewing");
 *  - edit — a "View" command that the engine executes only while editing: freezing
 *    areas and the sheet view (asc_freezePane, asc_SetSheetViewType — the canEdit() check),
 *    showing formulas and the sheet direction (asc_setShowFormulas, asc_setRightToLeft —
 *    WorksheetView.changeSheetViewSettings, the canEdit() check), recording
 *    a macro (on stop it writes the macro into the workbook, asc_setMacros). The stock ribbon mask does not disable the "View" tab
 *    in the catalog (its reading is alive), so the verdict is the engine's: api.canEdit()
 *    is false ("Viewing", the reader, lost connection) — the item is inactive.
 *    For twins from the editing ribbon (showing formulas — the "Formula" tab, the sheet direction —
 *    "Layout") the stock mask disables the item itself too, but it is not what decides: the engine refuses the edit
 *    even without a reason in the stack;
 *  - mask: false — the twin is in the ribbon, but the stock path of the command is not the ribbon (print —
 *    the file menu, select all and copy — reading): the stock ribbon mask does not disable the item;
 *  - right / denied — the document's right to a command that all roles have: false — the item is
 *    in place inactive ("Copy", if copying is allowed by the rights), the reason is the stock
 *    phrase about the ban (denied), if there is one;
 *  - cellEditOff — the item is wholly inactive while a cell is being edited (api.isCellEdited), with
 *    the cell editing reason: the item's stock command is unavailable during editing, and its twin stock
 *    does not disable during editing (the twin is not the ribbon: the sheet tab menu);
 *  - byRows — for a mirror submenu (sub) the holder is disabled also when the twin is alive but all
 *    rows of its stock menu are disabled, the reason is from their locks: stock disables not the button but the items of its menu, and
 *    sets their availability itself, without preparing for showing ("Clear": while a cell is edited "All" stays alive,
 *    the rest are disabled — controller/Toolbar.js onEditCell; "All" is also disabled without the right to change a filter);
 *  - keep / own — an item for which stock hides and disables the twin not the way the shell needs: keep — the item
 *    is visible even when stock hid the twin, and is then inactive (stock hides an empty submenu — "Hidden"
 *    of the sheet tab menu without hidden sheets, while the shell shows the item as unavailable); own(shell) — its own
 *    availability rule instead of the twin's mark: a reason code (reasonText) or true — inactive (stock computes
 *    the item availability only in the show handler of its own menu, and leaves the mark until the next
 *    show: view/Statusbar.js onTabMenu);
 *  - soft / fallback — the twin (or the control of the same lock) does not exist for every role:
 *    for the reader stock builds a ribbon without print, "Select all" and the macro buttons, while their commands are
 *    alive by another path (the file menu, Ctrl+A, the click handler of the "Macros" button). Without a twin
 *    the item is alive: print goes by its own run, for
 *    an item with a twin — fallback, the same call as the stock button; there is no warning about
 *    a missing one.
 * Other: if a command is unavailable now — the item is visible and inactive, the reason is in the
 * tooltip where it can be named (itemState). The editing ban is by stock: while the
 * stock ban reason puts a mask on the ribbon (editing:disable with toolbar — lost
 * connection, "Viewing"), the ribbon twins are unreachable for a person, and their items are inactive;
 * the items of the file menu, the left area, the "View" and "Collaboration" tabs — by their own
 * state in stock (they have their own lock reasons), for "View" commands with the edit flag — also
 * by the engine's verdict. A ban is not an absence of the right: for the duration of the stock ban reason stock
 * disables the right to comment in the shared appOptions (comment "preview"), while the comment
 * items stay in place inactive (commentRight).
 *
 * Gallery items: Chart, Sparkline, Shape, Format as table, Cell
 * styles — the twins' stock galleries ("Tables", SmartArt, TextArt and "Equations" are not in
 * "Insert"). "Sparkline" in stock
 * is also a gallery (three kinds), hence with an arrow. Galleries inside submenus (border style and color, histograms,
 * color scales and icon sets, tab color) are gallery rows of the mirror, sheet
 * views are rows of the stock inner menu, the stock stepper in a menu (it was for the print scale,
 * now it is in the print window) is a stepper row (StockBridge).
 * "Document language ▸" — stock spreadsheets have no such command, the spell check language is chosen in
 * the "Spelling" panel. "Sheet direction" in stock is a button without a menu, hence without ▸.
 */
define([
    'spreadsheeteditor/main/app/view/StockBridge'
], function (Bridge) {
    'use strict';

    if (window.SSE === undefined) window.SSE = {};
    if (SSE.Views === undefined) SSE.Views = {};

    function ctl(name) {
        try { return SSE.getController(name) || null; } catch (e) { return null; }
    }

    function options() {
        var main = ctl('Main');
        return (main && main.appOptions) || {};
    }

    function leftMenu() {
        var lm = ctl('LeftMenu');
        return (lm && lm.leftMenu) || null;
    }

    function fileMenu() {
        var view = leftMenu();
        return (view && view.menuFile) || null;
    }

    /* An element hidden by the integrator via customization (Common.UI.LayoutManager). */
    function layout(name) {
        var lm = window.Common && Common.UI && Common.UI.LayoutManager;
        return !lm || typeof lm.isElementVisible !== 'function' || lm.isElementVisible(name) !== false;
    }

    /* The edit right — the shell's snapshot at start (CompactShell.editRight): for the duration of the stock
       ban reason stock turns off appOptions.isEdit (LeftMenu.SetDisabled puts the previous value into
       previsEdit), while the right stays. If there is no shell yet — the same reading as theirs
       (readEditRight). One reading for the switch, the menu bar row and the toolbar. */
    function editRight(shell) {
        shell = shell || SSE.Views.CompactShell;
        if (shell && typeof shell.editRight === 'boolean') return shell.editRight;
        if (shell && typeof shell.readEditRight === 'function') return shell.readEditRight() === true;
        return options().isEdit === true;
    }

    /* The comment right. For the duration of the stock ban reason ("Viewing", lost connection —
       comments.previewMode as part of editing:disable) stock turns off canComments in the shared
       appOptions, and keeps the previous value in prevcanComments of the comments controller
       (lib/controller/Comments.js updatePreviewMode) and returns it when the reason is lifted.
       This is a ban, not an absence of the right: while stock "preview"
       is on, the right is the one saved by stock, and the item stays in place, disabled. The same right
       is read by the toolbar comment button (CompactToolbar.canComment). */
    function commentRight(o) {
        var c = ctl('Common.Controllers.Comments');
        if (c && c.viewmode === true && c.mode === o && typeof c.prevcanComments === 'boolean') return c.prevcanComments;
        return !!o.canComments;
    }

    /* Stock conditions, not our own. Exposed (SheetActions.CAN): the same condition for the toolbar button with the same command
       ("Print" of the toolbar) — one rule, not a copy. */
    var CAN = {
        /* view/FileMenu.js applyMode: miDownload. */
        download: function (o) { return !!o.canDownload && (!o.isDesktopApp || !o.isOffline); },
        print:    function (o) { return !!o.canPrint; },
        save:     function () { return layout('toolbar-file-save'); },
        /* miEdit: entering editing from a read-only document. */
        edit:     function (o) { return !o.isEdit && !!o.canEdit && !!o.canRequestEditRights; },
        /* Rename — for whoever edits the workbook (the reader has no "Rename"),
           as for the title field in the header (CompactShell.canRename). */
        rename:   function (o) { return !!o.canRename && !o.isDesktopApp && editRight(); },
        info:     function () { return layout('toolbar-file-info'); },
        settings: function () { return layout('toolbar-file-settings'); },
        help:     function (o) { return !!o.canHelp; },
        /* lib/view/ReviewChanges.js: btnSharing, btnCoAuthMode, btnHistory. */
        sharing:  function (o) { return !!((o.sharingSettingsUrl && o.sharingSettingsUrl.length) || o.canRequestSharingSettings); },
        coauth:   function (o) { return !o.isOffline && !!o.canCoAuthoring && !!o.canChangeCoAuthoring; },
        history:  function (o) { return !!o.canUseHistory && !o.isDisconnected; },
        /* Add comment — the canComments right, the panel — canViewComments (as in stock). */
        comment:  function (o) { return !!o.canCoAuthoring && commentRight(o); },
        comments: function (o) { return !!(o.canCoAuthoring && o.canViewComments); },
        /* Copy — the document right (controller/Main.js: canCopy = permissions.copy !== false). */
        copy:     function (o) { return o.canCopy !== false; },
        /* Macros — the conditions of the "Macros" buttons of the "View" tab (view/ViewTab.js), except the edit right: the integration did not turn them off,
           not the Windows XP of the desktop client. */
        macros:   function (o) {
            var D = window.Common && Common.Controllers && Common.Controllers.Desktop;
            return !(o.customization && o.customization.macros === false) && !(D && typeof D.isWinXp === 'function' && D.isWinXp());
        }
    };

    /* The reason for the copy ban — a stock phrase (the same one stock shows as a tooltip on opening). */
    function copyDenied() {
        var main = ctl('Main');
        return (main && main.errorCopyDisabled) || null;
    }

    /* The reasons for stock locking (the twin's keepState, Common.enumLock) that can be
       named. Sheet protection: the cells, formats, structure and permissions
       of a protected sheet (controller/WBProtection.js wsLockOptions). */
    var PROTECT_CAUSES = ['worksheet-lock', 'worksheet-lock-text', 'worksheet-lock-shape', 'worksheet-lock-format',
        'worksheet-lock-format-fill', 'cell-user-protected', 'SelectLockedCells', 'SelectUnlockedCells', 'FormatCells',
        'FormatColumns', 'FormatRows', 'InsertColumns', 'InsertRows', 'InsertHyperlinks', 'DeleteColumns', 'DeleteRows',
        'Sort', 'AutoFilter', 'PivotTables', 'Objects', 'Scenarios'];
    var EDIT_CAUSES = ['cell-editing'];
    /* The reasons put by the editing ban itself (lib/view/ReviewChanges.js: viewMode,
       previewReviewMode, viewFormMode; lost connection — lostConnect): only for them, or when
       stock disabled the twin without a recorded reason (SetDisabled directly), a disabled item
       states the ban reason (modeCode). Stock's own reason is not a ban: a dark sheet
       is disabled by stock in the light interface theme (controller/ViewTab.js, lockControls by
       enumLock.inLightTheme — spreadsheets have no key, undefined lands in keepState), and the "Viewing"
       caption must not appear for it; stock does not name this reason either. */
    var MODE_CAUSES = ['view-mode', 'preview-review-mode', 'view-form-mode', 'disconnect'];

    /* The bridge roots in the stock ribbon that the stock mask (controller/Toolbar.js
       DisableToolbar: a transparent layer over the tab panels) makes unreachable.
       "View" and "Collaboration" are not included: their buttons are disabled by stock with its own reasons
       one by one (viewMode, lostConnect in ReviewChanges.SetDisabled), and the "View" commands are
       reading (theme, dark sheet, macros). The "View" commands
       that the engine rejects without editing or that write into the workbook are marked in the catalog
       edit and are disabled by the engine's verdict (engineEdits). */
    var RIBBON = {Toolbar: 1, ToolbarCtl: 1, DataTab: 1, Formula: 1, WBProtection: 1, PivotTable: 1};

    function rootOf(ref) {
        var at = typeof ref === 'string' ? ref.indexOf(':') : -1;
        return at > 0 ? ref.slice(0, at) : '';
    }

    /* A missing twin (an entry in StockBridge.gaps and the log):
       a shell warning once per address and only for whoever has the edit right —
       a reader has no edit twins in stock, and there is nothing to make noise about.
       While stock is still finishing the ribbon (CompactShell.stockBuilding), the twin does not exist yet, but it is not
       lost: the shell is built on app:ready earlier than the stock subscribers of the same notification
       (the "Add comment" buttons are inserted by controller/Toolbar.js onAppReady), and the menu bar
       row takes the sections already at build. Such a twin is not recorded; when stock
       has finished, the shell takes the menu bar row again, and this snapshot records the loss. */
    var warnedTwins = {};

    function missingTwin(ref, it, shell) {
        if (shell && shell.stockBuilding === true) return;
        Bridge.gap(ref, 'missing', it.k);
        warnMissing(ref, it, shell);
    }

    function warnMissing(ref, it, shell) {
        if (!shell || shell.editRight !== true || warnedTwins[ref]) return;
        warnedTwins[ref] = true;
        if (window.console && console.warn)
            console.warn('Compact shell: stock control "' + ref + '" is missing, menu item "' + it.k + '" stays inactive.');
    }

    /* A menu not bound to the file one: the stock clickSaveAsFormat calls menu.hide() after the action
       without checking, while our menu closes itself. */
    var SAVE_AS_MENU = {hide: function () {}};

    var SEP = {sep: true};

    /* "Clear format": one command in the menu and on the toolbar — the stock "Formatting" item of the ribbon "Clear" button by value
       Asc.c_oAscCleanOptions.Format (read at call time). The helper is shared (SheetActions.CLEAR_FORMAT): it is chosen by the item
       of "Format", and the same choice is made by the "Clear format" toolbar button. */
    var CLEAR_FORMAT = {value: function () { return Asc.c_oAscCleanOptions.Format; }};

    /* The shell glyph for a row of the stock menu mirror — by the class of the stock icon of the item (StockBridge.mirror, the icon field:
       the btn-* class from iconCls). One table for the list of the toolbar "Borders" button and "Format → Borders ▸" of the menu bar row
       (the stockGlyph helper): two identical lists do not diverge. The table has only border menu items: other mirrors get
       no glyphs and are not changed. "Border color" (a non-btn-* class) and "More borders" (no icon) — without a glyph. */
    var STOCK_GLYPHS = [
        {stock: 'btn-border-bottom', glyph: 'borderBottom'},
        {stock: 'btn-border-top', glyph: 'borderTop'},
        {stock: 'btn-border-left', glyph: 'borderLeft'},
        {stock: 'btn-border-right', glyph: 'borderRight'},
        {stock: 'btn-border-no', glyph: 'borderNone'},
        {stock: 'btn-border-all', glyph: 'borderAll'},
        {stock: 'btn-border-out', glyph: 'borderOuter'},
        {stock: 'btn-border-inside', glyph: 'borderInner'},
        {stock: 'btn-border-insidehor', glyph: 'borderInnerH'},
        {stock: 'btn-border-insidevert', glyph: 'borderInnerV'},
        {stock: 'btn-border-style', glyph: 'borderStyle'}
    ];

    /* The glyph by the class of the stock icon; the class is not in the table — null. */
    function stockGlyph(icon) {
        if (!icon) return null;
        for (var i = 0; i < STOCK_GLYPHS.length; i++) {
            if (STOCK_GLYPHS[i].stock === icon) return STOCK_GLYPHS[i].glyph;
        }
        return null;
    }

    /* The sides of the border of the active cell (or its merged area) by the engine selection data: info.asc_getBorders()
       gives the sides and both diagonals, an empty side — from the neighbor; for a selected object and for an engine that gives no borders —
       null. A side is set if it exists and its style is not None (Asc.c_oAscBorderStyles is read at call time) —
       the same rule as for the border sample of the right cell panel. No data or the read failed — null: we do not know. */
    function borderSides(info) {
        try {
            var b = info && typeof info.asc_getBorders === 'function' ? info.asc_getBorders() : null;
            if (!b) return null;
            var none = Asc.c_oAscBorderStyles.None;
            var has = function (m) {
                var side = typeof b[m] === 'function' ? b[m]() : null;
                return !!side && typeof side.asc_getStyle === 'function' && side.asc_getStyle() !== none;
            };
            return {left: has('asc_getLeft'), top: has('asc_getTop'), right: has('asc_getRight'), bottom: has('asc_getBottom'),
                    diagDown: has('asc_getDiagDown'), diagUp: has('asc_getDiagUp')};
        } catch (e) {
            return null;
        }
    }

    /* Whether the cell has at least one of the six sides (with diagonals); no data — no. */
    function hasBorder(sides) {
        return !!sides && !!(sides.left || sides.top || sides.right || sides.bottom || sides.diagDown || sides.diagUp);
    }

    /* The mark of a border menu mirror row — by the sides of the active cell (borderSides), the key is the class of the stock icon of the item,
       as in STOCK_GLYPHS. The value is what the cell must have: a side; 'none' — none of the six sides; 'box' — all
       four sides (for a single cell "All" and "Outside" coincide). Inner lines cannot be determined from a single cell —
       "Inside" has no mark, like "Style", "Color" and "More borders". */
    var BORDER_MARKS = {
        'btn-border-bottom': 'bottom',
        'btn-border-top': 'top',
        'btn-border-left': 'left',
        'btn-border-right': 'right',
        'btn-border-no': 'none',
        'btn-border-out': 'box',
        'btn-border-all': 'box'
    };

    /* A mirror row with a mark by the cell borders (a list checkbox): its stock icon is in BORDER_MARKS. */
    function borderMarkable(icon) {
        return !!icon && Object.prototype.hasOwnProperty.call(BORDER_MARKS, icon);
    }

    /* One cell or exactly one merged area is selected (the engine's asc_getOneCell): only then the sides of the active cell are
       the borders of the whole selection. For a range "Bottom" by single active cells would lie about the rest, and "Outside" means a frame around
       the whole range. The engine does not report this — not one. */
    function oneCell(info) {
        return !!info && typeof info.asc_getOneCell === 'function' && info.asc_getOneCell() === true;
    }

    /* The marks of the rows of one mirror snapshot: a function "class of the stock icon → whether the item is marked". The selection data (read())
       is read at most once and only for an item from BORDER_MARKS: mirrors without border items do not query the engine.
       No data or more than one cell selected (oneCell) — no item is marked, and "No borders" neither: we do not know — we do not
       mark. The "Borders" button is pressed for a range too by the active cell, like "Bold": its rule is hasBorder, without oneCell. */
    function borderMarker(read) {
        var done = false, sides = null;
        return function (icon) {
            var mark = borderMarkable(icon) ? BORDER_MARKS[icon] : null;
            if (!mark) return false;
            if (!done) {
                done = true;
                try {
                    var info = read();
                    sides = oneCell(info) ? borderSides(info) : null;
                } catch (e) {
                    sides = null;
                }
            }
            if (!sides) return false;
            if (mark === 'none') return !hasBorder(sides);
            if (mark === 'box') return sides.left && sides.top && sides.right && sides.bottom;
            return sides[mark];
        };
    }

    /* The help page with the list of spreadsheet functions (resources/help/<language>/…, present for every help language). */
    var HELP_FUNCTION_LIST = 'UsageInstructions/InsertFunction.htm';

    /* --- Coverage checking ------------------------- */
    /* The stock ribbon controls of our build (9.4) by tab: the live list was taken by the probe
       inventory_matches_live_ribbon in the browser and is kept by it consistent with the ribbon — a new
       or lost stock button fails the probe. The list has the filled places of the ribbon; without
       captions for numeric fields, without the "more" button of the ribbon itself and without the plugin and AI tabs
       (they come from the portal). The address is the twin name, as the shell catalogs write it:
       sort and filter of "Home" are the same objects as in the "Data" tab
       (DataTab:btnsSortDown.0 — "Home", .1 — "Data"). The reference is this list:
       a divergence from the earlier count (191, LISTED_COUNT) is recorded, not adjusted. */
    var STOCK = {
        'static': ['Toolbar:btnSave', 'Toolbar:btnPrint', 'Toolbar:btnCopy', 'Toolbar:btnPaste', 'Toolbar:btnUndo',
            'Toolbar:btnRedo', 'Toolbar:btnCut', 'Toolbar:btnCopyStyle'],
        home: ['Toolbar:cmbFontName', 'Toolbar:cmbFontSize', 'Toolbar:btnIncFontSize', 'Toolbar:btnDecFontSize',
            'Toolbar:btnChangeCase', 'Toolbar:btnBold', 'Toolbar:btnItalic', 'Toolbar:btnUnderline', 'Toolbar:btnStrikeout',
            'Toolbar:btnSubscript', 'Toolbar:btnTextColor', 'Toolbar:btnBackColor', 'Toolbar:btnBorders', 'Toolbar:btnAlignTop',
            'Toolbar:btnAlignMiddle', 'Toolbar:btnAlignBottom', 'Toolbar:btnWrap', 'Toolbar:btnTextOrient', 'Toolbar:btnAlignLeft',
            'Toolbar:btnAlignCenter', 'Toolbar:btnAlignRight', 'Toolbar:btnAlignJust', 'Toolbar:btnMerge', 'Toolbar:btnTextDir',
            'Toolbar:btnInsertFormula', 'Toolbar:btnFillNumbers', 'Toolbar:btnNamedRange', 'Toolbar:btnClearStyle',
            'DataTab:btnsSortDown.0', 'DataTab:btnsSortUp.0', 'DataTab:btnsSetAutofilter.0', 'DataTab:btnsClearAutofilter.0',
            'Toolbar:cmbNumberFormat', 'Toolbar:btnCurrencyStyle', 'Toolbar:btnPercentStyle', 'Toolbar:btnCommaStyle',
            'Toolbar:btnDecDecimal', 'Toolbar:btnIncDecimal', 'Toolbar:btnAddCell', 'Toolbar:btnDeleteCell', 'Toolbar:btnFormatCell',
            'Toolbar:btnCondFormat', 'Toolbar:btnTableTemplate', 'Toolbar:listStyles', 'Toolbar:btnReplace', 'Toolbar:btnSelectAll'],
        ins: ['PivotTable:btnsAddPivot.0', 'Toolbar:btnInsertTable', 'Toolbar:btnInsertImage', 'Toolbar:btnInsertShape',
            'Toolbar:btnInsertSmartArt', 'Toolbar:btnInsertChartRecommend', 'Toolbar:btnInsertChart', 'Toolbar:btnInsertSparkline',
            'ToolbarCtl:btnsComment.0', 'Toolbar:btnInsertHyperlink', 'Toolbar:btnInsertSlicer', 'Toolbar:btnInsertText',
            'Toolbar:btnInsertTextArt', 'Toolbar:btnsEditHeader.0', 'Toolbar:btnInsertEquation', 'Toolbar:btnInsertSymbol'],
        draw: ['Draw:btnSelect', 'Draw:btnsPen.0', 'Draw:btnsPen.1', 'Draw:btnsPen.2', 'Draw:btnEraser'],
        layout: ['Toolbar:btnPageMargins', 'Toolbar:btnPageOrient', 'Toolbar:btnPageSize', 'Toolbar:btnPrintArea',
            'Toolbar:btnPageBreak', 'Toolbar:btnsEditHeader.1', 'Toolbar:btnScale', 'Toolbar:btnPrintTitles', 'Toolbar:btnRtlSheet',
            'Toolbar:chPrintGridlines', 'Toolbar:chPrintHeadings', 'Toolbar:btnImgForward', 'Toolbar:btnImgBackward',
            'Toolbar:btnImgAlign', 'Toolbar:btnImgGroup', 'Toolbar:btnShapesMerge', 'Toolbar:btnColorSchemas'],
        formula: ['Formula:btnFormula', 'Formula:btnAutosum', 'Formula:btnRecent', 'Formula:btnFinancial', 'Formula:btnLogical',
            'Formula:btnTextData', 'Formula:btnDateTime', 'Formula:btnReference', 'Formula:btnMath', 'Formula:btnMore',
            'Formula:btnNamedRange', 'Formula:btnTracePrec', 'Formula:btnTraceDep', 'Formula:btnRemArrows', 'Formula:btnShowFormulas',
            'Formula:btnWatch', 'Formula:btnCalculate'],
        data: ['DataTab:btnDataFromText', 'DataTab:btnExternalLinks', 'DataTab:btnsSetAutofilter.1', 'DataTab:btnsSortDown.1',
            'DataTab:btnsClearAutofilter.1', 'DataTab:btnsSortUp.1', 'DataTab:btnCustomSort', 'DataTab:btnTextToColumns',
            'DataTab:btnRemoveDuplicates', 'DataTab:btnDataValidation', 'DataTab:btnGoalSeek', 'DataTab:btnSolver', 'DataTab:btnGroup',
            'DataTab:btnUngroup'],
        review: ['Review:btnCoAuthMode', 'ToolbarCtl:btnsComment.1', 'Review:btnCommentRemove', 'Review:btnCommentResolve',
            'Review:btnChat'],
        protect: ['Protection:btnAddPwd', 'Protection:btnPwd', 'WBProtection:btnProtectWB', 'WBProtection:btnProtectSheet',
            'WBProtection:chLockedCell', 'WBProtection:chHiddenFormula', 'WBProtection:chLockedShape', 'WBProtection:chLockedText',
            'WBProtection:btnProtectRange'],
        view: ['ViewTab:btnSheetView', 'ViewTab:btnCreateView', 'ViewTab:btnCloseView', 'ViewTab:btnViewNormal',
            'ViewTab:btnViewPageBreak', 'ViewTab:cmbZoom', 'ViewTab:btnInterfaceTheme', 'ViewTab:btnDarkDocument',
            'ViewTab:btnFreezePanes', 'ViewTab:chFormula', 'ViewTab:chHeadings', 'ViewTab:chGridlines', 'ViewTab:chZeros',
            'ViewTab:chToolbar', 'ViewTab:chStatusbar', 'ViewTab:chLeftMenu', 'ViewTab:chRightMenu', 'ViewTab:btnMacros',
            'ViewTab:btnRecMacro', 'ViewTab:btnPauseMacro'],
        pivot: ['PivotTable:btnPivotLayout', 'PivotTable:btnPivotBlankRows', 'PivotTable:btnPivotSubtotals',
            'PivotTable:btnPivotGrandTotals', 'PivotTable:btnRefreshPivot', 'PivotTable:btnSelectPivot', 'PivotTable:btnCalculatedItems',
            'PivotTable:btnExpandField', 'PivotTable:btnCollapseField', 'PivotTable:chRowHeader', 'PivotTable:chColHeader',
            'PivotTable:chRowBanded', 'PivotTable:chColBanded', 'PivotTable:pivotStyles'],
        tabledesign: ['TableDesign:btnResizeTable', 'TableDesign:btnEdit', 'TableDesign:btnRemDuplicates', 'TableDesign:btnConvertRange',
            'TableDesign:btnInsertSlicer', 'TableDesign:btnInsertPivot', 'TableDesign:chHeaderRow', 'TableDesign:chTotalRow',
            'TableDesign:chFirstColumn', 'TableDesign:chLastColumn', 'TableDesign:chBandedRows', 'TableDesign:chBandedColumns',
            'TableDesign:chFilterButton', 'TableDesign:btnAltText', 'TableDesign:tableStyles'],
        charttab: ['Chart:btnChartElements', 'Chart:btnSelectData', 'Chart:btnSwitchRowsCols', 'Chart:chartStyles', 'Chart:btnChartType',
            'Chart:btnAdvancedSettings', 'Chart:spnWidth', 'Chart:spnHeight', 'Chart:chRatio', 'Chart:btn3DSettings'],
        sparklinetab: ['Sparkline:btnLineType', 'Sparkline:btnColumnType', 'Sparkline:btnWinLossType', 'Sparkline:chHighPoint',
            'Sparkline:chLowPoint', 'Sparkline:chFirstPoint', 'Sparkline:chLastPoint', 'Sparkline:chNegativePoint', 'Sparkline:chMarkers',
            'Sparkline:btnMarkerColor', 'Sparkline:btnSparklineColor', 'Sparkline:cmbBorderSize', 'Sparkline:btnAdvancedSettings',
            'Sparkline:btnClear']
    };

    /* The item with key k in the catalog group list ({label, items}), and among the children of composite
       items; null — there is none. */
    function find(groups, k) {
        var found = null;
        var look = function (list) {
            return list.some(function (it) {
                if (!it) return false;
                if (it.k === k) { found = it; return true; }
                return Array.isArray(it.items) && look(it.items);
            });
        };
        groups.some(function (g) { return look(g.items); });
        return found;
    }

    /* The item chooses an item of the twin's stock menu by value (pick: {value}). */
    function byValuePick(it) {
        return !!it && !!it.twin && !!it.pick && typeof it.pick === 'object' && !Array.isArray(it.pick);
    }

    /* A list item with a command (not a separator and not a group heading). */
    function isEntry(it) {
        return !!it && !it.sep && it.head == null;
    }

    /* Cleaning the list after filtering: a group heading without items up to the next separator or
       heading — out; separators at the edges and in a row — traces of what was removed. */
    function tidy(list) {
        var out = [];
        list.forEach(function (it, i) {
            if (it.head != null) {
                for (var j = i + 1; j < list.length && !list[j].sep && list[j].head == null; j++) {
                    if (isEntry(list[j])) { out.push(it); return; }
                }
                return;
            }
            if (it.sep && (!out.length || out[out.length - 1].sep)) return;
            out.push(it);
        });
        while (out.length && out[out.length - 1].sep) out.pop();
        return out;
    }

    /* The list items for now (stock conditions): the integration and rights condition (when) and the twins
       hidden by stock — out; for a composite item the same is done with the children, and a holder without
       children is not drawn (its copy carries the filtered children — the catalog is not changed). */
    function offeredItems(list, o) {
        var out = [];
        list.forEach(function (it) {
            if (!it) return;
            if (it.sep) { out.push(SEP); return; }
            if (it.head != null) { out.push(it); return; }
            if (it.when && !it.when(o)) return;
            var ref = it.twin || it.mirror;
            if (ref) {
                var st = Bridge.state(ref);
                if (st.exists && !st.visible && !it.keep) return;      // stock itself removed the control: the capability is absent
                /* An item by value: stock did not build such an item in the twin's menu — the capability is absent. */
                if (st.exists && byValuePick(it) && !Bridge.locate(it.twin, it.pick)) return;
            }
            if (Array.isArray(it.items)) {
                var kids = offeredItems(it.items, o);
                if (!kids.some(isEntry)) return;
                it = _.extend({}, it, {items: kids});
            }
            out.push(it);
        });
        return tidy(out);
    }

    /* Stock menu rows in place in a composite submenu ({mirror}): their root is an item with
       a twin submenu, with which the menu row adapter checks the row's availability and chooses it. */
    function mirrorRoot(holder, child) {
        return {k: (holder && holder.k || '') + '>' + child.mirror, t: holder && holder.t, twin: child.mirror, sub: true,
                edit: child.edit, mask: child.mask, soft: child.soft};
    }

    var CONTEXT_TABS = {
        pivot: {fallback: 'Pivot table'},
        tabledesign: {key: 'textTabTableDesign', fallback: 'Table Design'},
        charttab: {key: 'textTabChart', fallback: 'Chart Design'},
        sparklinetab: {key: 'textTabSparkline', fallback: 'Sparkline'}
    };

    /* Exceptions — tabs given by the portal. The AI tab comes as a plugin with its own
       guid; the probe recognizes it by the tab caption. */
    var EXCLUDED_TABS = {plugins: 'plugins come from the portal', ai: 'AI comes from the portal'};

    /* The same stock command on another copy of the button (one more ribbon tab): the address is as for the copy
       held by the shell catalog. */
    var SAME = {
        'DataTab:btnsSortDown.1': 'DataTab:btnsSortDown.0', 'DataTab:btnsSortUp.1': 'DataTab:btnsSortUp.0',
        'DataTab:btnsSetAutofilter.1': 'DataTab:btnsSetAutofilter.0', 'DataTab:btnsClearAutofilter.1': 'DataTab:btnsClearAutofilter.0',
        'ToolbarCtl:btnsComment.1': 'ToolbarCtl:btnsComment.0', 'Toolbar:btnsEditHeader.1': 'Toolbar:btnsEditHeader.0',
        'Toolbar:btnNamedRange': 'Formula:btnNamedRange', 'Toolbar:btnReplace': 'LeftMenu:btnSearchBar',
        'Toolbar:btnInsertTable': 'Toolbar:btnTableTemplate', 'Review:btnChat': 'LeftMenu:btnChat',
        'Formula:btnFormula': 'Toolbar:btnInsertFormula', 'Formula:btnAutosum': 'Toolbar:btnInsertFormula',
        'TableDesign:btnRemDuplicates': 'DataTab:btnRemoveDuplicates', 'TableDesign:btnInsertSlicer': 'Toolbar:btnInsertSlicer',
        'TableDesign:btnInsertPivot': 'PivotTable:btnsAddPivot.0'
    };

    /* Addresses outside the toolbar and the menu bar row: the context menu and the column header menu, stock
       windows and panels, the sheet row. Service coverage rows, not interface. */
    var FUNCTION_DIALOG = 'menu insert > function > more functions (insert function dialog: category)';
    var OBJECT_MENU = 'object context menu: ';
    var PRINT_DIALOG = 'menu file > print; menu file > download > downloadPdf (the stock print settings dialog: ';
    var ELSEWHERE = {
        'Toolbar:btnCopy': 'context menu, column header menu: copy; Ctrl+C',
        'Toolbar:btnPaste': 'context menu, column header menu: paste; Ctrl+V',
        'Toolbar:btnCut': 'context menu, column header menu: cut; Ctrl+X',
        'Toolbar:btnCommaStyle': 'menu format > numberFormat > more formats (number format dialog: thousands separator)',
        /* The toolbar font size is a field with a list without "−" and "+", as in documents: a font size step is a stock shortcut, any size is the list
           and typing in the font size field. */
        'Toolbar:btnIncFontSize': 'Ctrl+] (the stock shortcut); toolbar size: a size from the list or typed',
        'Toolbar:btnDecFontSize': 'Ctrl+[ (the stock shortcut); toolbar size: a size from the list or typed',
        'Toolbar:chPrintGridlines': 'menu file > print (print panel: print gridlines)',
        'Toolbar:chPrintHeadings': 'menu file > print (print panel: print headings)',
        /* Print titles, margins, orientation, size and scale — in the stock print window (the same window for "Download ▸ PDF" —
           PDF parameters). */
        'Toolbar:btnPrintTitles': PRINT_DIALOG + 'print titles)',
        'Toolbar:btnPageMargins': PRINT_DIALOG + 'margins)',
        'Toolbar:btnPageOrient': PRINT_DIALOG + 'page orientation)',
        'Toolbar:btnPageSize': PRINT_DIALOG + 'page size)',
        'Toolbar:btnScale': PRINT_DIALOG + 'scaling)',
        'Toolbar:btnImgForward': OBJECT_MENU + 'arrange', 'Toolbar:btnImgBackward': OBJECT_MENU + 'arrange',
        'Toolbar:btnImgAlign': OBJECT_MENU + 'align', 'Toolbar:btnImgGroup': OBJECT_MENU + 'arrange > group',
        'Toolbar:btnShapesMerge': OBJECT_MENU + 'merge shapes',
        'Formula:btnRecent': FUNCTION_DIALOG, 'Formula:btnFinancial': FUNCTION_DIALOG, 'Formula:btnLogical': FUNCTION_DIALOG,
        'Formula:btnTextData': FUNCTION_DIALOG, 'Formula:btnDateTime': FUNCTION_DIALOG, 'Formula:btnReference': FUNCTION_DIALOG,
        'Formula:btnMath': FUNCTION_DIALOG, 'Formula:btnMore': FUNCTION_DIALOG,
        /* "✓ Locked cell" — in "Format → Rows, columns and sheet ▸". */
        'WBProtection:chLockedCell': 'menu format > rowsColsSheet > locked cell',
        'Protection:btnAddPwd': 'stock File screen > Protect > add workbook password',
        'Protection:btnPwd': 'stock File screen > Protect > change or remove workbook password',
        /* "View → Zoom ▸" and the toolbar zoom — the CompactToolbar zoom helpers, the items and the toolbar list have no twin —
           the address is here. */
        'ViewTab:cmbZoom': 'menu view > zoom; toolbar zoom; sheet tabs row: zoom',
        'ViewTab:chToolbar': 'menu view > hideToolbar (the shell toolbar row)',
        /* There is no "View → Object properties" item: the right panel opens by itself. */
        'ViewTab:chRightMenu': 'the stock right panel opens by itself on selecting an image, shape, text box or slicer and on entering a pivot table; for cells — context menu: format cells',
        'ViewTab:chLeftMenu': 'left area panels: menu collaboration > comments (also Ctrl+Shift+H), menu edit > findReplace, menu edit > spelling'
    };

    /* Controls intentionally omitted from the compact interface. */
    var REMOVED = 'Not in the compact shell: ';
    var ADVANCED = {
        'Draw:btnSelect': REMOVED + 'the menu bar has no Draw tab, and the documents compact has no pens',
        'Draw:btnsPen.0': REMOVED + 'the menu bar has no Draw tab, and the documents compact has no pens',
        'Draw:btnsPen.1': REMOVED + 'the menu bar has no Draw tab, and the documents compact has no pens',
        'Draw:btnsPen.2': REMOVED + 'the menu bar has no Draw tab, and the documents compact has no pens',
        'Draw:btnEraser': REMOVED + 'the menu bar has no Draw tab, and the documents compact has no pens',
        'ViewTab:chFormula': REMOVED + 'the shell always shows the formula bar, its View menu has no toggle',
        'ViewTab:chStatusbar': REMOVED + 'the shell always shows the sheet tabs row, its View menu has no toggle',
        /* Commands that are not in Compact and are also absent from the menus of common spreadsheet editors — by name, with a reason
           (coverage.cjs keeps the list). */
        'Review:btnChat': REMOVED + 'the built-in chat; discussion happens in the portal messenger, and common spreadsheet editors have no chat in their menus',
        /* There is no "Dark sheet" or "Interface theme ▸": the look is set by the portal. */
        'ViewTab:btnDarkDocument': REMOVED + 'the dark sheet; the look is set by the portal',
        'ViewTab:btnInterfaceTheme': REMOVED + 'the interface theme; the look is set by the portal',
        /* SmartArt, TextArt and "Equations" are not in "Insert" (almost not needed in spreadsheets); already inserted objects are edited
           by stock. "Table" is a duplicate of "Format as table"
           (SAME), not here. */
        'Toolbar:btnInsertSmartArt': REMOVED + 'SmartArt is not in Insert (rarely needed in spreadsheets); inserted ones stay editable',
        'Toolbar:btnInsertTextArt': REMOVED + 'TextArt is not in Insert (rarely needed in spreadsheets); inserted ones stay editable',
        'Toolbar:btnInsertEquation': REMOVED + 'the equation is not in Insert (rarely needed in spreadsheets); inserted ones stay editable'
    };

    /* "View → Hide toolbar" — there is no toolbar, its commands are in the menu bar row. Service coverage rows (toolbarReach),
       the interface is not changed. WITHOUT_TOOLBAR — the row commands
       that have a different place in the menu bar row than the item with the same twin: ₽ and % — "Format → Number format ▸" ("Financial",
       "Percent"), decimals −/+ — the "More formats" window (the "Decimal places" field), fill — "Format → Format cells" (the cell tab of
       the right panel, "Background color"), the row's "Chart" (recommended) — "Insert → Chart ▸", "Search" (a command without a twin) —
       "Edit → Find and replace", "Zoom" (a command without a twin) — "View → Zoom ▸". TOOLBAR_ONLY — the row commands that are not in the
       menu bar row and will not be ("Format Painter", "Font", "Font size", "Text color"), — by name, with a reason: with a hidden toolbar they are only
       on the toolbar, and the toolbar is brought back by the repeated "View → Hide toolbar" — with one click or from the keyboard. The list does not
       silently grow or shrink (coverage.cjs). */
    var TOOLBAR_ONLY_WHY = 'toolbar only, not in the menu bar — View > Hide toolbar again brings the toolbar back';
    var WITHOUT_TOOLBAR = {
        'Toolbar:btnCurrencyStyle': 'menu format > numberFormat (accounting)',
        'Toolbar:btnPercentStyle': 'menu format > numberFormat (percentage)',
        'Toolbar:btnDecDecimal': 'menu format > numberFormat > more formats (number format dialog: decimal places)',
        'Toolbar:btnIncDecimal': 'menu format > numberFormat > more formats (number format dialog: decimal places)',
        'Toolbar:btnBackColor': 'menu format > formatCells (the cell tab of the right panel: background color)',
        'Toolbar:btnInsertChartRecommend': 'menu insert > chart',
        'toolbar search': 'menu edit > findReplace (the search panel)',
        'toolbar zoom': 'menu view > zoom (the same list and command)'
    };
    var TOOLBAR_ONLY = {
        'Toolbar:btnCopyStyle': TOOLBAR_ONLY_WHY + ' (format painter)',
        'Toolbar:cmbFontName': TOOLBAR_ONLY_WHY + ' (font)',
        'Toolbar:cmbFontSize': TOOLBAR_ONLY_WHY + ' (font size: the field with the list)',
        'Toolbar:btnTextColor': TOOLBAR_ONLY_WHY + ' (text color)'
    };

    SSE.Views.SheetActions = _.extend({

        editRight: editRight,
        commentRight: commentRight,
        CAN: CAN,

        api: function () {
            var vp = ctl('Viewport');
            return (vp && vp.getApi && vp.getApi()) || null;
        },

        /* The section captions in their order — the menu bar row is built from them once. */
        sections: function () {
            return [this.textFile, this.textEdit, this.textView, this.textInsert,
                    this.textFormat, this.textData, this.textCollaboration, this.textHelp];
        },

        /* The catalog for the current moment: the when conditions and twins hidden by stock
           are filtered out (also for the children of composite items), separators at the edges and in a row and
           group headings without items are removed. Called on every opening of a section —
           rights and integration are asked from stock on every access. */
        groups: function () {
            var o = options();
            return this.catalog().map(function (g) {
                return {label: g.label, items: offeredItems(g.items, o)};
            });
        },

        /* The children of a composite item that the menu bar row offers now (groups). */
        children: function (it) {
            return it && Array.isArray(it.items) ? offeredItems(it.items, options()) : [];
        },

        /* The root of stock menu rows in place ({mirror}) in a composite submenu. */
        mirrorRoot: mirrorRoot,

        catalog: function () {
            var me = this;
            var panel = function (name) { return function () { me.fileMenu(name); }; };
            var dl = function (type) { return function () { me.download(type); }; };
            var contextTabs = Object.keys(CONTEXT_TABS).map(function (tab) {
                var caption = CONTEXT_TABS[tab];
                return {
                    k: 'context-' + tab,
                    t: tab === 'pivot' ? me.textPivot : Bridge.phrase('Toolbar', caption.key, caption.fallback),
                    stockTab: tab,
                    check: true,
                    on: function () {
                        var shell = SSE.Views.CompactShell;
                        return !!shell && shell.contextRibbon === tab;
                    },
                    cellEditOff: true,
                    when: function () {
                        var shell = SSE.Views.CompactShell;
                        return !!(shell && typeof shell.contextTab === 'function' && shell.contextTab(tab));
                    },
                    needs: 'toggleContextTab',
                    gate: 'canOpenContextTab',
                    run: function (shell) { return shell.toggleContextTab(tab); }
                };
            });
            var protectionFlag = function (key, control, text, fallback) {
                var twin = 'WBProtection:' + control;
                return {
                    k: key, t: Bridge.phrase('WBProtection', text, fallback), twin: twin, check: true, edit: true,
                    when: function () { return layout('toolbar-protect') && !!Bridge.twin(twin); }
                };
            };
            /* The caption of a toolbar command (CompactToolbar: tooltips and list rows) — one command, one name. The toolbar is loaded by the shell after the catalog — the phrase is taken at build time. */
            var tb = function (key, fallback) { return Bridge.phrase('CompactToolbar', key, fallback); };
            return [
                {label: me.textFile, items: [
                    /* Entering editing — by the stock condition (miEdit) and without the "Viewing" ban: the edit request goes to the integration, it does not
                       change the workbook. There is no "Access rights": they led to the same portal access window as "Collaboration → Document
                       access". */
                    {k: 'editDoc', t: me.textEditDoc, i: 'rename', run: function () { me.requestEditRights(); }, when: CAN.edit},
                    {k: 'save', t: me.textSave, i: 'save', twin: 'Toolbar:btnSave', when: CAN.save, sc: 'Save'},
                    /* "Download ▸": the formats XLSX · PDF · CSV · ODS in one submenu — actions (the stock file menu handler, for CSV, PDF and
                       ODS — its warnings and the parameters window), captions — the format names. Without the download right there is no
                       submenu either; the editing ban does not disable download — it is alive in "Viewing" and for the reader. */
                    {k: 'download', t: me.textDownload, i: 'download', when: CAN.download, items: [
                        {k: 'downloadXlsx', t: 'XLSX', run: dl('XLSX')},
                        {k: 'downloadPdf', t: 'PDF', run: dl('PDF')},
                        {k: 'downloadCsv', t: 'CSV', run: dl('CSV')},
                        {k: 'downloadOds', t: 'ODS', run: dl('ODS')}
                    ]},
                    /* "Import ▸" (formerly "Data → Get data from text ▸"): import is a file action.
                       The same three items with the same names: the submenu is a mirror of the stock menu of the "From text/CSV" button of the
                       "Data" tab (choosing a file on the computer, entering an address, choosing an XML file — then the stock import window). In
                       "Viewing" it is disabled by the ribbon mask; the reader has no button — the item stays in place, disabled. */
                    {k: 'import', t: me.textImport, twin: 'DataTab:btnDataFromText', sub: true},
                    SEP,
                    {k: 'print', t: me.textPrint, i: 'print', run: function () { me.print(); }, when: CAN.print, lockLike: 'Toolbar:btnPrint',
                        sameCommand: true, mask: false, soft: true, sc: 'PrintPreviewAndPrint'},
                    /* "Print titles · Margins ▸ · Orientation ▸ · Page size ▸ · Print scale ▸" are not in "File": all
                       of this is in the stock "Print" window — print titles, margins, orientation, size, scale (the coverage addresses are
                       ELSEWHERE). Print area, page breaks and headers/footers — as items, while Compact has no print
                       window of its own. */
                    {k: 'printArea', t: me.textPrintArea, twin: 'Toolbar:btnPrintArea', sub: true},
                    {k: 'pageBreaks', t: me.textPageBreaks, twin: 'Toolbar:btnPageBreak', sub: true},
                    {k: 'headerFooter', t: me.textHeaderFooter, i: 'header', twin: 'Toolbar:btnsEditHeader.0'},
                    SEP,
                    /* "Rename" — like a click on the title in the header:
                       in-place title editing (rename). The right, the place and the availability are as before: the header field and the file
                       menu item of stock. */
                    {k: 'rename', t: me.textRename, i: 'rename', run: function (shell) { me.rename(shell); }, when: CAN.rename, fileLock: 'rename',
                        gate: 'canRename'},
                    {k: 'docInfo', t: me.textDocInfo, i: 'info', run: panel('info'), when: CAN.info},
                    {k: 'advancedSettings', t: me.textAdvancedSettings, i: 'settings', run: panel('opts'), when: CAN.settings}
                ]},
                {label: me.textEdit, items: [
                    {k: 'undo', t: me.textUndo, i: 'undo', twin: 'Toolbar:btnUndo', sc: 'EditUndo'},
                    {k: 'redo', t: me.textRedo, i: 'redo', twin: 'Toolbar:btnRedo', sc: 'EditRedo'},
                    SEP,
                    /* "Cut · Copy · Paste": the same
                       actions as the keyboard shortcuts and the same-named items of the context menu; the captions and glyphs are as theirs
                       (the column letter menu has the same glyphs). Cut and paste are ribbon buttons: their stock handler, their
                       locks (co-author, protection, lost connection), and the engine does not accept editing without the right (edit:
                       "Viewing" and the reader). Copy is reading: alive in "Viewing" and for the reader (mask: false), if
                       copying is allowed by the rights (right). Its command is the handler of the "Copy" item of the context menu,
                       not a button click: for the reader the ribbon button is built but not subscribed (Toolbar.attachUIEvents — only
                       for the editor), and the availability is from the same button (sameCommand: the same command). The browser does not give the menu the clipboard
                       of other applications — the stock "Copy, cut and paste actions" window with "Don't
                       show again" is opened by both handlers themselves. */
                    {k: 'cut', t: me.textCut, i: 'cut', twin: 'Toolbar:btnCut', edit: true, sc: 'Cut'},
                    {k: 'copy', t: me.textCopy, i: 'copy', run: function () { me.copyPaste('copy'); }, lockLike: 'Toolbar:btnCopy',
                        sameCommand: true, mask: false, soft: true, right: CAN.copy, denied: copyDenied, sc: 'Copy'},
                    {k: 'paste', t: me.textPaste, i: 'paste', twin: 'Toolbar:btnPaste', edit: true, sc: 'Paste'},
                    SEP,
                    /* "Delete cells ▸" — in "Edit" (deletion is editing), the composition and name as before: a mirror of the stock menu
                       of the "Delete cells" button; while a cell is edited stock disables the button itself. In a group with "Fill ▸". */
                    {k: 'deleteCells', t: me.textDeleteCells, twin: 'Toolbar:btnDeleteCell', sub: true},
                    /* "Clear ▸": the same five actions as "Clear ▸" of the context menu — a mirror of the stock menu of the ribbon
                       "Clear" button; the "Contents" caption is the stock key, the same as in the context menu. The rows and their availability are stock: while a cell is edited the button and "All" are alive
                       ("All" deletes the text selected in the editor), "Contents", "Formatting", "Comments" and "Links"
                       are disabled (controller/Toolbar.js onEditCell). The holder is disabled when the button or all rows of
                       its menu are disabled (byRows). */
                    /* "Contents" — the same as the Delete key (WorkbookView._onEmpty: emptySelection(Text)): on the right is its shortcut. */
                    {k: 'clear', t: me.textClear, i: 'clear', twin: 'Toolbar:btnClearStyle', sub: true, byRows: true,
                        rowSc: [{value: function () { return Asc.c_oAscCleanOptions.Text; }, sc: 'ClearSelectedCellsContent'}]},
                    {k: 'fill', t: me.textFill, twin: 'Toolbar:btnFillNumbers', sub: true},
                    SEP,
                    {k: 'selectAll', t: me.textSelectAll, i: 'selectAll', twin: 'Toolbar:btnSelectAll', mask: false,
                        fallback: function () { me.selectAll(); }, sc: 'EditSelectAll'},
                    /* The twin is the search panel button, not Toolbar:btnReplace: that one goes through
                       LeftMenu.onShortcut('replace') → showMenu('advancedsearch'), and the stock
                       showMenu refuses when the panel button is not visible — in Compact the column of
                       icons is always hidden.
                       The stock call itself (Ctrl+H) is routed by the shell in Compact through the path of this item
                       (CompactShell.bindStockPanels). */
                    {k: 'findReplace', t: me.textFindReplace, i: 'search', twin: 'LeftMenu:btnSearchBar', left: 'open', sc: 'OpenFindDialog'},
                    /* "Spelling" — the spell check panel of the left area. */
                    {k: 'spelling', t: me.textSpelling, i: 'spell', twin: 'LeftMenu:btnSpellcheck', left: 'toggle'}
                    /* "Remove duplicates" is not in "Edit" — the command is in "Data". "Edit": Undo · Redo — Cut ·
                       Copy · Paste — Delete cells ▸ · Clear ▸ · Fill ▸ — Select all · Find and replace ·
                       Spelling. */
                ]},
                {label: me.textView, items: [
                    {k: 'freeze', t: me.textFreeze, i: 'freeze', twin: 'ViewTab:btnFreezePanes', sub: true, edit: true},
                    /* "Zoom ▸": the same list as for the toolbar zoom — CompactToolbar.ZOOMS, 50 · 75 · 100 · 125 · 150 · 200 %, —
                       and the same command (CompactToolbar.setZoom: asc_setZoom, like the stock
                       zoom list of the bottom row). A checkmark at
                       the current one (zoomNow — the rounding of the sheet row zoom caption); at a non-standard zoom — at
                       none. Availability — from the sheet row zoom button (stock disables it while a cell is edited): the row is not the ribbon,
                       the ban mask does not disable it, there is no edit — zoom is alive in "Viewing" and for the reader. At "100 %"
                       on the right is the stock zoom reset shortcut. */
                    {k: 'zoom', t: me.textZoom, items: me.zooms().map(function (z) {
                        var kid = {k: 'zoom' + z, t: z + '%', run: function () { me.zoomTo(z); }, check: 'radio',
                                   on: function () { return me.zoomNow() === z; }, lockLike: 'Statusbar:btnZoomUp', soft: true};
                        if (z === 100) kid.sc = 'Zoom100';
                        return kid;
                    })},
                    /* "Show ▸ (✓ Gridlines · ✓ Headings · ✓ Zeros · ✓ Show formulas)": gridlines, row and
                       column headings and showing zeros used to be switched only in the Stock interface. These are the
                       stock checkboxes of the "View" tab (the bridge: Common.UI.CheckBox), the checkmark follows the checkbox, they act on the current sheet (stock
                       rereads them on a sheet change), availability is stock (sheet lock, co-author, cell editing). The names are
                       stock phrases of the "View" tab, without copies in the shell locale (for zeros — the stock "Show zeros"). Without
                       editing the engine does not change the sheet view (changeSheetViewSettings) — edit: in "Viewing" the submenu is disabled entirely, like
                       "Show formulas". */
                    {k: 'show', t: me.textShow, items: [
                        {k: 'gridlines', t: Bridge.phrase('ViewTab', 'textGridlines', 'Gridlines'), twin: 'ViewTab:chGridlines', check: true, edit: true},
                        {k: 'headings', t: Bridge.phrase('ViewTab', 'textHeadings', 'Headings'), twin: 'ViewTab:chHeadings', check: true, edit: true},
                        {k: 'zeros', t: Bridge.phrase('ViewTab', 'textZeros', 'Show Zeros'), twin: 'ViewTab:chZeros', check: true, edit: true},
                        /* Showing formulas and the sheet direction are not executed by the engine without editing: both go into
                           changeSheetViewSettings (sdkjs cell/view/WorksheetView.js), and with !canEdit() it
                           exits without changing anything — a live item would silently do nothing. Hence edit,
                           as for freezing areas. */
                        {k: 'showFormulas', t: me.textShowFormulas, twin: 'Formula:btnShowFormulas', check: true, sc: 'ShowFormulas', edit: true}
                    ]},
                    SEP,
                    /* "Normal · Page layout", a checkmark at the current one, — right in the section, without a submenu: the word "Mode" is taken
                       by the "Editing / Viewing" switch in the header and by "Focus mode". One choice of two (stock view buttons
                       without depressing, allowDepress: false): a radio group opens the section group. The twins, captions (for the second —
                       the shell caption "Page layout") and the edit rule are on each item; in "Viewing" both are disabled. */
                    {k: 'viewNormal', t: me.textViewNormal, twin: 'ViewTab:btnViewNormal', check: 'radio', edit: true},
                    {k: 'viewPageLayout', t: me.textViewPageLayout, twin: 'ViewTab:btnViewPageBreak', check: 'radio', edit: true},
                    /* Named views write into the workbook, and the engine does not reject them without editing:
                       creating, deleting and renaming (asc_addNamedSheetView,
                       asc_deleteNamedSheetViews, CT_NamedSheetView.asc_setName) take a lock without
                       canEdit(). Stock builds these buttons only with isEdit (view/ViewTab.js), while
                       "Viewing" leaves the editor an editor — hence edit. The stock submenu is
                       "Default" and the workbook views (its inner menu — the mirror
                       rows, StockBridge.read) and "View manager", where they are created and
                       deleted. "Default" is the same command as the stock "Close
                       view" (viewtab:openview 'default', view/ViewTab.js), — also.
                       "Views ▸ (Named views: Default · workbook views — View manager ·
                       Create view)": rows on one layer — a group heading, under it the stock menu rows in place
                       (the stock separator closes the group), after them "Create view"; in "Viewing" all are disabled — and
                       the holder. */
                    {k: 'views', t: me.textViews, items: [
                        {head: me.textSheetViews},
                        {mirror: 'ViewTab:btnSheetView', edit: true, also: {'ViewTab:btnCloseView': 'default'}},
                        {k: 'createView', t: me.textCreateView, twin: 'ViewTab:btnCreateView', edit: true}
                    ]},
                    /* "Hidden sheets ▸": the list of the workbook's hidden sheets in workbook
                       order — a mirror of the stock "Hidden" submenu of the tab menu (its rows are exactly the stock list of hidden ones, stock
                       builds it on every update of the sheet row); the choice is a stock item: show:hidden → asc_showWorksheet,
                       the sheet is shown and becomes current. Stock hides an empty submenu — for us the item stays in place inactive (keep);
                       stock disables it only on a right click on a tab — for us the same condition of the stock command on every opening
                       of the section (own: hiddenSheetsLock). While a cell is edited — inactive with a reason (cellEditOff): in
                       stock a sheet cannot be shown during editing — the ribbon "Format" button ("Show → Hidden sheets") is disabled while a cell is
                       edited, the tab menu does not open while a formula is edited, and while text is edited it first closes the editor; the menu bar
                       row does not finish editing. Showing a sheet changes the workbook: in "Viewing" and for the reader
                       it is inactive (edit). */
                    {k: 'hiddenSheets', t: me.textHiddenSheets, twin: 'Statusbar:tabMenu.items.5', sub: true, edit: true, keep: true,
                        cellEditOff: true, own: function () { return me.hiddenSheetsLock(); }},
                    /* "✓ Sheet direction" (the checkmark — when right-to-left direction is on): a toggle by the pressed state of the stock "Sheet direction" button (enableToggle, stock drives it by
                       the sheet — controller/Toolbar.js onApiRtlSheet), in a group with "Mode ▸" and the views. */
                    {k: 'sheetDirection', t: me.textSheetDirection, twin: 'Toolbar:btnRtlSheet', check: true, edit: true},
                    SEP
                ].concat(contextTabs, [
                    SEP,
                    /* "Dark sheet" and "Interface theme" are absent (the look is set by the portal) — only in the Stock
                       interface (ADVANCED). "Object properties" is absent: the right panel opens by itself on
                       selecting an image, shape, text box, slicer, on entering a pivot and by the "Format cells" command
                       (CompactShell: onRightSelection, stockOpensRight); a closed one will open again if the selection is removed and
                       an object is selected. The shell command CompactShell.toggleRightPanel remains. */
                    /* Shell commands: the panel and focus mode. */
                    {k: 'hideToolbar', t: me.textHideToolbar, i: 'toolbar', needs: 'toggleToolbar', use: 'toolbar',
                        run: function (shell) { shell.toggleToolbar(); }},
                    {k: 'focus', t: me.textFocus, i: 'focus', needs: 'toggleFocus',
                        run: function (shell) { shell.toggleFocus(); }},
                    SEP,
                    /* "Macros ▸ (Macros · Record macro · Pause recording)": the items are as before, with the same flags. In
                       "Viewing" "Macros" is alive (the window does not change the workbook, without the edit right the engine refuses to save macros),
                       "Record" and "Pause" are disabled (recording writes into the workbook) — the holder is alive. "Run macros" is in
                       "Advanced settings".
                       For the reader stock does not build the macro buttons (only with the edit right), while the macros window is the same for them and likewise
                       does not change the workbook: the engine without the edit right rejects "Run" and "Save". So without the button the window is
                       opened by its click handler (fallback: macrosDialog); "Record" and "Pause" are disabled. Without
                       the macros capability in the integration (customization.macros: false) there is no item. */
                    {k: 'macrosMenu', t: me.textMacros, when: CAN.macros, items: [
                        {k: 'macros', t: me.textMacros, twin: 'ViewTab:btnMacros', fallback: function () { me.macrosDialog(); }},
                        {k: 'recordMacro', t: me.textRecordMacro, twin: 'ViewTab:btnRecMacro', liveCaption: true, edit: true},
                        {k: 'pauseMacro', t: me.textPauseMacro, twin: 'ViewTab:btnPauseMacro', liveCaption: true, edit: true}
                    ]}
                ])},
                {label: me.textInsert, items: [
                    {k: 'insertCells', t: me.textInsertCells, twin: 'Toolbar:btnAddCell', sub: true},
                    /* "Delete cells ▸" — in "Edit".
                       "Sheet" — a click on the "+" button of the sheet row (controller/Statusbar.js onAddWorksheetClick): a new sheet with the stock
                       name goes right after the current one (asc_addWorksheet: position — current + 1) and becomes current; for CSV —
                       a stock warning. Availability — from the same button: stock disables it while a cell is edited, on a lock and on
                       workbook structure protection, while a range is chosen by a window. The sheet row is not the ribbon, the ban mask does not disable it, and a sheet
                       changes the workbook: edit — in "Viewing" and for the reader it is inactive (for the reader the button's box is hidden, the button itself
                       may be alive). */
                    {k: 'sheet', t: me.textSheet, twin: 'Statusbar:btnAddWorksheet', edit: true},
                    SEP,
                    {k: 'function', t: me.textFunction, i: 'sum', twin: 'Toolbar:btnInsertFormula', sub: true},
                    {k: 'chart', t: me.textChart, i: 'chart', twin: 'Toolbar:btnInsertChart', gallery: true},
                    {k: 'sparkline', t: me.textSparkline, twin: 'Toolbar:btnInsertSparkline', gallery: true},
                    {k: 'pivot', t: me.textPivot, twin: 'PivotTable:btnsAddPivot.0'},
                    /* "Slicer" — in "Data" (a filtering tool). There is no "Tables" —
                       a duplicate of "Format → Format as table" (the same stock table style gallery btnTableTemplate). */
                    SEP,
                    {k: 'image', t: me.textImage, i: 'image', twin: 'Toolbar:btnInsertImage', sub: true},
                    {k: 'shape', t: me.textShape, i: 'shape', twin: 'Toolbar:btnInsertShape', gallery: true},
                    /* SmartArt, TextArt and "Equations" are absent (almost not needed in spreadsheets): they can be inserted only in the Stock
                       interface (ADVANCED); already
                       inserted objects remain and are edited by stock — selecting them opens their right panel. */
                    {k: 'textBox', t: me.textTextBox, i: 'textbox', twin: 'Toolbar:btnInsertText'},
                    /* An item of the stock "More symbols" menu (controller/Toolbar.js: menu.items[2]). */
                    {k: 'symbol', t: me.textSymbol, i: 'symbol', twin: 'Toolbar:btnInsertSymbol', pick: '2'},
                    SEP,
                    {k: 'link', t: me.textLink, i: 'link', twin: 'Toolbar:btnInsertHyperlink', sc: 'InsertHyperlink'},
                    /* "Add comment" — in "Insert": adding is inserting. There is one item (the same twin that the
                       former "Comment" here had), one name for all places of the command. */
                    {k: 'comment', t: me.textAddComment, i: 'comment', twin: 'ToolbarCtl:btnsComment.0', when: CAN.comment}
                ]},
                {label: me.textFormat, items: [
                    {k: 'numberFormat', t: me.textNumberFormat, twin: 'Toolbar:cmbNumberFormat', sub: true},
                    /* "Rows, columns and sheet ▸" (the former "Format cells… ▸" promised a window but opened a list about rows,
                       columns and the sheet; the stock "Format" inside the "Format" menu does not fit): the same mirror of the stock menu of the ribbon
                       "Format" button — the same items, the second level ("Row height ▸", "Column width ▸", "Hide ▸",
                       "Show ▸") and "✓ Locked cell" with the mark of the stock item. */
                    {k: 'rowsColsSheet', t: me.textRowsColsSheet, twin: 'Toolbar:btnFormatCell', sub: true},
                    /* "Format cells" — a separate item (it was the last row of "Format cells… ▸"), the name is as for the context menu
                       item: the same stock item of the "Format" button menu by value
                       ('formatCells': controller/Toolbar.js onCellFormatMenu → rightmenu:open → the right panel on the cell tab — the
                       same one that the context "Format cells" opens). It is removed from the mirror of "Rows, columns and sheet ▸"
                       (StockBridge.OMIT). Stock builds the item only with a visible right panel (customization.rightMenu, layout
                       rightMenu) — no stock item, no ours either. Availability — of the button and the item: cell editing,
                       co-author, range chosen by a window; in "Viewing" — the ribbon mask. */
                    {k: 'formatCells', t: me.textCellFormat, twin: 'Toolbar:btnFormatCell', pick: {value: 'formatCells'}},
                    SEP,
                    /* "Text ▸" (was "Superscript and subscript ▸"): six font style toggles, the first four used to be
                       only on the toolbar; the checkmark at the one enabled for the current cell — the pressed state of the stock button
                       ("Bold", "Italic", "Underline", "Strikethrough" — ribbon toggle buttons) or the mark of the stock item of the
                       "Superscript/subscript" button by value ('super', 'sub': stock sets it by the selection); the command is the same
                       stock one. The names are as in the toolbar tooltips (CompactToolbar) and the stock "Superscript", "Subscript"
                       (the caption of the stock item does not fit: a shortcut is written into it), the shortcuts are on the right; the glyphs — of the toolbar buttons and, for
                       superscript and subscript, the sup and sub of the set. Availability —
                       of the stock buttons: while cell text is edited the font style is alive, as in stock (it applies to the text selected in the cell;
                       superscript and subscript inside a cell cannot otherwise be set in Compact), while a formula is edited and on an
                       image it is disabled; in "Viewing" — the ribbon mask, the holder is disabled entirely. */
                    {k: 'text', t: me.textText, items: [
                        {k: 'bold', t: tb('tipBold', 'Bold'), i: 'bold', twin: 'Toolbar:btnBold', check: true, sc: 'Bold'},
                        {k: 'italic', t: tb('tipItalic', 'Italic'), i: 'italic', twin: 'Toolbar:btnItalic', check: true, sc: 'Italic'},
                        {k: 'underline', t: tb('tipUnderline', 'Underline'), i: 'underline', twin: 'Toolbar:btnUnderline', check: true, sc: 'Underline'},
                        {k: 'strikeout', t: tb('tipStrikeout', 'Strikethrough'), i: 'strike', twin: 'Toolbar:btnStrikeout', check: true, sc: 'Strikeout'},
                        {k: 'superscript', t: Bridge.phrase('Toolbar', 'textSuperscript', 'Superscript'), i: 'sup', twin: 'Toolbar:btnSubscript',
                            pick: {value: 'super'}, check: true, sc: 'Superscript'},
                        {k: 'subscript', t: Bridge.phrase('Toolbar', 'textSubscript', 'Subscript'), i: 'sub', twin: 'Toolbar:btnSubscript',
                            pick: {value: 'sub'}, check: true, sc: 'Subscript'}
                    ]},
                    {k: 'changeCase', t: me.textChangeCase, i: 'case', twin: 'Toolbar:btnChangeCase', sub: true},
                    /* "Alignment ▸" — seven variants, used to be only on the toolbar: horizontal
                       Align left · Center · Align right · Justify — a separator — vertical Align top · Align middle · Align
                       bottom. Two choices (by the separator — for the screen reader two radio groups), the checkmark at the current one — the pressed stock button
                       of the ribbon alignment group; an already chosen variant changes nothing again (as in the toolbar lists). The names and
                       glyphs are as in the toolbar lists (CompactToolbar.textAlign*, alignL…caption). "Justify" — here: in the
                       toolbar "Horizontal" list it is absent. Availability — of the buttons: cell editing, object, protection, co-author;
                       in "Viewing" — the ribbon mask. */
                    {k: 'align', t: me.textAlign, items: [
                        {k: 'alignLeft', t: tb('textAlignLeft', 'Align left'), i: 'alignL', twin: 'Toolbar:btnAlignLeft', check: 'radio'},
                        {k: 'alignCenter', t: tb('textAlignCenter', 'Align center'), i: 'alignC', twin: 'Toolbar:btnAlignCenter', check: 'radio'},
                        {k: 'alignRight', t: tb('textAlignRight', 'Align right'), i: 'alignR', twin: 'Toolbar:btnAlignRight', check: 'radio'},
                        {k: 'alignJust', t: tb('textAlignJust', 'Justified'), i: 'alignJ', twin: 'Toolbar:btnAlignJust', check: 'radio'},
                        SEP,
                        {k: 'alignTop', t: tb('textAlignTop', 'Align top'), i: 'valignT', twin: 'Toolbar:btnAlignTop', check: 'radio'},
                        {k: 'alignMiddle', t: tb('textAlignMiddle', 'Align middle'), i: 'alignC', twin: 'Toolbar:btnAlignMiddle', check: 'radio'},
                        {k: 'alignBottom', t: tb('textAlignBottom', 'Align bottom'), i: 'caption', twin: 'Toolbar:btnAlignBottom', check: 'radio'}
                    ]},
                    /* "✓ Wrap text" turns wrapping on and off (before — only from the toolbar):
                       the toggle is the stock "Wrap text" ribbon button (the pressed state — the checkmark, the click — its stock handler);
                       the name is as the toolbar button tooltip (CompactToolbar.tipWrap), the glyph is the same. Availability — of the button:
                       cell editing, object, protection, co-author; in "Viewing" — the ribbon mask. */
                    {k: 'wrap', t: tb('tipWrap', 'Wrap text'), i: 'hyphen', twin: 'Toolbar:btnWrap', check: true},
                    {k: 'textRotation', t: me.textTextRotation, i: 'rotate', twin: 'Toolbar:btnTextOrient', sub: true},
                    {k: 'textDirection', t: me.textTextDirection, twin: 'Toolbar:btnTextDir', sub: true},
                    /* "Indent ▸ (Increase indent · Decrease indent)": the items are as before — the engine's cell indent (indent: step 1, like the
                       right panel stepper), the glyphs indentIn and indentOut, availability — from the ribbon "Align left" (cell editing,
                       object, protection, co-author); in "Viewing" — the ribbon mask, the holder is disabled entirely. */
                    {k: 'indent', t: me.textIndent, items: [
                        {k: 'indentInc', t: me.textIndentInc, i: 'indentIn', run: function () { me.indent(1); }, lockLike: 'Toolbar:btnAlignLeft'},
                        {k: 'indentDec', t: me.textIndentDec, i: 'indentOut', run: function () { me.indent(-1); }, lockLike: 'Toolbar:btnAlignLeft'}
                    ]},
                    SEP,
                    {k: 'borders', t: me.textBorders, i: 'borders', twin: 'Toolbar:btnBorders', sub: true},
                    /* The glyph is merge of the shared set (the "Merge cells" picture). The same glyph on the toolbar
                       button. */
                    {k: 'merge', t: me.textMerge, i: 'merge', twin: 'Toolbar:btnMerge', sub: true},
                    SEP,
                    {k: 'conditional', t: me.textConditional, i: 'condfmt', twin: 'Toolbar:btnCondFormat', sub: true},
                    {k: 'formatAsTable', t: me.textFormatAsTable, twin: 'Toolbar:btnTableTemplate', gallery: true},
                    /* The ribbon styles combo (ComboDataView): the gallery is the menu of its dropdown button. */
                    {k: 'cellStyles', t: me.textCellStyles, twin: 'Toolbar:listStyles', gallery: true},
                    {k: 'colorScheme', t: me.textColorScheme, twin: 'Toolbar:btnColorSchemas', sub: true},
                    SEP,
                    /* "Clear format" — without a submenu (the former "Clear format ▸ (All · Text · Formatting · Comments ·
                       Links)" did not match the name): it resets only formatting — the stock
                       "Formatting" item of the "Clear" button (CLEAR_FORMAT; values, formulas, comments and links stay). The other
                       variants are "Edit → Clear ▸" and the context menu. Available when the button and the item are available: on a chart, shape
                       and image the stock item is disabled, while a cell is edited too; in "Viewing" — the ribbon mask. */
                    {k: 'clearFormat', t: me.textClearFormat, i: 'clear', twin: 'Toolbar:btnClearStyle', pick: CLEAR_FORMAT}
                ]},
                {label: me.textData, items: [
                    /* btnsSortDown stock sorts in ascending order (view/DataTab.js), btnsSortUp — in descending order. */
                    {k: 'sortAZ', t: me.textSortAZ, i: 'sort', twin: 'DataTab:btnsSortDown.0'},
                    {k: 'sortZA', t: me.textSortZA, twin: 'DataTab:btnsSortUp.0'},
                    {k: 'customSort', t: me.textCustomSort, twin: 'DataTab:btnCustomSort'},
                    SEP,
                    {k: 'filter', t: me.textFilter, i: 'filter', twin: 'DataTab:btnsSetAutofilter.0', check: true, sc: 'ToggleAutoFilter'},
                    {k: 'clearFilter', t: me.textClearFilter, twin: 'DataTab:btnsClearAutofilter.0'},
                    /* "Slicer" — in "Data" (a filtering tool), after "Clear filter": the stock
                       "Slicer" button (the field choice window), without a source (a formatted or pivot table) it is inactive, as in stock. */
                    {k: 'slicer', t: me.textSlicer, twin: 'Toolbar:btnInsertSlicer'},
                    {k: 'validation', t: me.textValidation, i: 'validate', twin: 'DataTab:btnDataValidation'},
                    SEP,
                    {k: 'textToColumns', t: me.textTextToColumns, twin: 'DataTab:btnTextToColumns'},
                    {k: 'removeDuplicatesData', t: me.textRemoveDuplicates, twin: 'DataTab:btnRemoveDuplicates'},
                    {k: 'externalLinks', t: me.textExternalLinks, twin: 'DataTab:btnExternalLinks'},
                    SEP,
                    {k: 'group', t: me.textGroup, twin: 'DataTab:btnGroup', sub: true},
                    {k: 'ungroup', t: me.textUngroup, twin: 'DataTab:btnUngroup', sub: true},
                    {k: 'namedRanges', t: me.textNamedRanges, twin: 'Formula:btnNamedRange', sub: true},
                    SEP,
                    /* "Formulas ▸ (Calculation options ▸ · Trace precedents · Trace dependents · Remove arrows ▸ · Watch
                       window)" — one level, two groups with headings. The same actions and names: the recalculation and arrow rows are items
                       of the stock menus of the "Recalculate" and "Remove arrows" buttons of the "Formula" tab by value (the caption is stock, stock
                       builds the menu on app:ready), on the right are the stock recalculation shortcuts (F9, ⇧+F9); "Trace precedents", "Trace dependents" and
                       "✓ Watch window" are the old items (the checkmark — by the button's pressed state). Availability — of the stock buttons
                       of the tab (cell editing, co-author, selected object); in "Viewing" they are disabled by the ribbon mask — the holder is unavailable
                       entirely. There is no "Formula and number options…" here. */
                    {k: 'formulas', t: me.textFormulas, items: [
                        {head: me.textCalcOptions},
                        {k: 'recalcWorkbook', twin: 'Formula:btnCalculate', pick: {value: function () { return Asc.c_oAscCalculateType.All; }},
                            sc: 'RecalculateAll'},
                        {k: 'recalcSheet', twin: 'Formula:btnCalculate', pick: {value: function () { return Asc.c_oAscCalculateType.ActiveSheet; }},
                            sc: 'RecalculateActiveSheet'},
                        SEP,
                        {head: me.textFormulaAuditing},
                        {k: 'tracePrecedents', t: me.textTracePrecedents, twin: 'Formula:btnTracePrec'},
                        {k: 'traceDependents', t: me.textTraceDependents, twin: 'Formula:btnTraceDep'},
                        {k: 'removeArrows', twin: 'Formula:btnRemArrows', pick: {value: function () { return Asc.c_oAscRemoveArrowsType.all; }}},
                        {k: 'removePrecedentArrows', twin: 'Formula:btnRemArrows',
                            pick: {value: function () { return Asc.c_oAscRemoveArrowsType.precedent; }}},
                        {k: 'removeDependentArrows', twin: 'Formula:btnRemArrows',
                            pick: {value: function () { return Asc.c_oAscRemoveArrowsType.dependent; }}},
                        {k: 'watchWindow', t: me.textWatchWindow, twin: 'Formula:btnWatch', check: true}
                    ]},
                    /* "Analysis ▸ (Goal seek · Solver)". The items are as before — the buttons of the "Data" tab with their stock windows and
                       availability (cell editing, co-author; in "Viewing" — the ribbon mask, the holder is unavailable). The name "Solver"
                       is the stock command name (key textSolver, DataTab.capSolver). */
                    {k: 'analysis', t: me.textAnalysis, items: [
                        {k: 'goalSeek', t: me.textGoalSeek, twin: 'DataTab:btnGoalSeek'},
                        {k: 'solver', t: me.textSolver, twin: 'DataTab:btnSolver'}
                    ]}
                ]},
                {label: me.textCollaboration, items: [
                    {k: 'sharing', t: me.textSharing, i: 'share', twin: 'Review:btnSharing', when: CAN.sharing},
                    {k: 'coauthMode', t: me.textCoauthMode, i: 'coauth', twin: 'Review:btnCoAuthMode', sub: true, when: CAN.coauth},
                    {k: 'history', t: me.textHistory, i: 'history', twin: 'Review:btnHistory', when: CAN.history},
                    SEP,
                    {k: 'comments', t: me.textComments, twin: 'LeftMenu:btnComments', left: 'toggle', when: CAN.comments},
                    {k: 'resolveComments', t: me.textResolveComments, twin: 'Review:btnCommentResolve', sub: true, when: CAN.comment},
                    {k: 'deleteComments', t: me.textDeleteComments, twin: 'Review:btnCommentRemove', sub: true, when: CAN.comment},
                    /* There is no "Chat": there is no built-in chat in Compact (discussion is in the portal messenger). Alt+Q
                       (Ctrl+Alt+Q) opens nothing in Compact, as in stock without the icon column; in Stock the chat is stock. */
                    SEP,
                    /* Workbook passwords are managed on the stock File screen. */
                    {k: 'protect', t: me.textProtection, items: [
                        {k: 'protectWorkbook', t: me.textProtectWorkbook, twin: 'WBProtection:btnProtectWB', check: true},
                        {k: 'protectSheet', t: me.textProtectSheet, twin: 'WBProtection:btnProtectSheet', check: true},
                        {k: 'allowRanges', t: me.textAllowRanges, twin: 'WBProtection:btnAllowRanges'},
                        {k: 'protectRange', t: me.textProtectRange, twin: 'WBProtection:btnProtectRange'},
                        SEP,
                        protectionFlag('hiddenFormula', 'chHiddenFormula', 'txtHiddenFormula', 'Hidden Formulas'),
                        protectionFlag('lockedShape', 'chLockedShape', 'txtLockedShape', 'Shape Locked'),
                        protectionFlag('lockedText', 'chLockedText', 'txtLockedText', 'Lock Text')
                    ]}
                ]},
                {label: me.textHelp, items: [
                    {k: 'help', t: me.textHelpItem, i: 'help', run: panel('help'), when: CAN.help, sc: 'OpenHelpMenu'},
                    /* "Keyboard shortcuts": the stock window with the list of keyboard shortcuts. No condition: the window changes nothing in
                       the workbook, the item is alive in "Viewing" and for the reader. */
                    {k: 'shortcuts', t: me.textShortcuts, run: function () { me.shortcutsDialog(); }},
                    /* "Function list": a reference of spreadsheet functions, not a function
                       insert. There is no separate reference window in the editor — the stock help on the "Insert
                       function" page, where there is a table of all functions by category (it has no anchors in ru and de), — so the item
                       is visible only with help connected, like "Help". */
                    {k: 'functionList', t: me.textFunctionList, run: function () { me.fileMenu('help', HELP_FUNCTION_LIST); }, when: CAN.help},
                    /* "About": a window with a close cross, as in documents (about), not the stock panel of the left menu button. */
                    {k: 'about', t: me.textAbout, i: 'info', run: function () { me.about(); }}
                ]}
            ];
        },

        /* --- Coverage checking ------------------------------------------- */

        STOCK: STOCK,
        CLEAR_FORMAT: CLEAR_FORMAT,
        STOCK_GLYPHS: STOCK_GLYPHS,
        stockGlyph: stockGlyph,
        BORDER_MARKS: BORDER_MARKS,
        borderMarkable: borderMarkable,
        oneCell: oneCell,
        borderSides: borderSides,
        hasBorder: hasBorder,
        borderMarker: borderMarker,
        CONTEXT_TABS: CONTEXT_TABS,
        EXCLUDED_TABS: EXCLUDED_TABS,
        ADVANCED: ADVANCED,
        SAME: SAME,
        ELSEWHERE: ELSEWHERE,
        WITHOUT_TOOLBAR: WITHOUT_TOOLBAR,
        TOOLBAR_ONLY: TOOLBAR_ONLY,

        /* Service section keys — for the coverage addresses, in the order of sections(). */
        SECTION_KEYS: ['file', 'edit', 'view', 'insert', 'format', 'data', 'collaboration', 'help'],

        /* The shell address book: twin → where the command is. The toolbar and "⋯" — the toolbar catalog
           (CompactToolbar.catalog: the twin, the choice variants, the list items),
           the menu bar row — the section catalog (the twin, and a control of the same lock — only when
           it is the same command, sameCommand: print; the cell indent does not serve as an
           address for "Align left"). Rights and integration are not asked: it is checked whether the
           command has a place, not whether it is available now. */
        addressBook: function () {
            var book = {}, me = this;
            var put = function (ref, where) {
                if (!ref) return;
                (book[ref] = book[ref] || []).push(where);
            };
            var tb = SSE.Views.CompactToolbar;
            if (tb && typeof tb.catalog === 'function') {
                tb.catalog().forEach(function (g) {
                    g.items.forEach(function (it) {
                        var at = 'toolbar ' + it.k;
                        put(it.twin, at);
                        (it.choices || []).concat(it.entries || []).forEach(function (x) { if (x && x.twin) put(x.twin, at); });
                    });
                });
            }
            /* List items with their address; for a composite item — the children: "menu <section> >
               <holder> > <child>", for stock menu rows in place ({mirror}) — the address of
               the holder itself (the rows stand in its submenu). */
            var walk = function (list, base) {
                list.forEach(function (it) {
                    if (!isEntry(it)) return;
                    var at = it.mirror ? base : base + ' > ' + it.k;
                    put(it.twin || it.mirror, at);
                    if (it.sameCommand && it.lockLike !== it.twin) put(it.lockLike, at);
                    /* also — a stock control with the same command as the item's submenu row. */
                    Object.keys(it.also || {}).forEach(function (ref) { put(ref, at + ' > ' + it.also[ref]); });
                    if (it.stockTab) (STOCK[it.stockTab] || []).forEach(function (ref) {
                        if (!SAME[ref]) put(ref, at);
                    });
                    if (Array.isArray(it.items)) walk(it.items, at);
                });
            };
            this.catalog().forEach(function (g, i) {
                walk(g.items, 'menu ' + (me.SECTION_KEYS[i] || String(i)));
            });
            return book;
        },

        /* Where the stock control is: the shell addresses (its own or copies with the same command), otherwise
           other addresses. Empty — there is no address in Compact. */
        addressOf: function (ref, book) {
            book = book || this.addressBook();
            var twin = SAME[ref];
            var out = (book[ref] || (twin && book[twin]) || []).slice();
            var other = ELSEWHERE[ref] || (twin && ELSEWHERE[twin]);
            if (other) out.push(other);
            return out;
        },

        /* The toolbar row commands with a hidden toolbar — where they are in the menu bar row. Each twin of the row (the button, the choice variants, the list
           rows; for a command without a twin — "toolbar <key>") — the addresses in the menu bar row: catalog items ("menu …" of the address book)
           and another place of the same command in the menu (WITHOUT_TOOLBAR); without them — only in the "Stock interface" (TOOLBAR_ONLY) or a hole
           (missing). The context menu and windows do not count here: this is about the menu bar row. */
        toolbarReach: function () {
            var book = this.addressBook(), tb = SSE.Views.CompactToolbar;
            var r = {byRef: {}, reachable: [], toolbarOnly: [], missing: []};
            if (!tb || typeof tb.catalog !== 'function') return r;
            var refs = [];
            var add = function (ref) { if (ref && refs.indexOf(ref) < 0) refs.push(ref); };
            tb.catalog().forEach(function (g) {
                g.items.forEach(function (it) {
                    if (!it.twin && !it.choices && !it.entries) add('toolbar ' + it.k);
                    add(it.twin);
                    (it.choices || []).concat(it.entries || []).forEach(function (x) { if (x && !x.sep) add(x.twin); });
                });
            });
            refs.forEach(function (ref) {
                var where = (book[ref] || []).filter(function (w) { return w.indexOf('menu ') === 0; });
                if (WITHOUT_TOOLBAR[ref]) where.push(WITHOUT_TOOLBAR[ref]);
                r.byRef[ref] = where;
                if (where.length) r.reachable.push(ref);
                else if (TOOLBAR_ONLY[ref]) r.toolbarOnly.push(ref);
                else r.missing.push(ref);
            });
            return r;
        },

        /* Stock controls with an address, intentionally omitted controls, and missing controls. */
        coverage: function (stock) {
            stock = stock || STOCK;
            var me = this, book = this.addressBook();
            var r = {total: 0, covered: [], advanced: [], missing: [], byRef: {}, byTab: {}};
            Object.keys(stock).forEach(function (tab) {
                var t = r.byTab[tab] = {total: 0, covered: 0, advanced: 0, missing: 0};
                stock[tab].forEach(function (ref) {
                    var where = me.addressOf(ref, book);
                    var why = where.length ? null : (ADVANCED[ref] || null);
                    var rec = {ref: ref, tab: tab, where: where, why: why};
                    r.byRef[ref] = rec;
                    r.total++;
                    t.total++;
                    if (where.length) { r.covered.push(rec); t.covered++; }
                    else if (why) { r.advanced.push(rec); t.advanced++; }
                    else { r.missing.push(ref); t.missing++; }
                });
            });
            return r;
        },

        /* The command exists but is unavailable now — the item is inactive. Availability
           — from the twin (or from the stock control of the same lock for a command without a
           twin); the reason — from the stock lock reasons, where it can be named.
           No twin — the item is inactive, and the place is marked in StockBridge.gaps.
           checked — the twin's pressed state for toggle items.
           Editing ban — CompactShell.lockState: under the stock ribbon mask the ribbon
           twins are inactive; the reason — "Viewing" or the right, where the shell can name it
           (modeCode). A command with the edit flag is inactive while the engine does not
           accept editing (engineEdits), — otherwise the item is alive, and the click is silently rejected by the engine.
           The reason is a code (REASONS): it is given by the adapter of the shared menu bar row (CompactMenuAdapter, itemCode),
           the code text is reasonText; itemState — the same state with the reason as text (the "Download" rows of the header). */
        itemState: function (it, shell) {
            var st = this.stateOf(it, shell);
            return {disabled: st.disabled, reason: st.reason ? this.reasonText(st.reason) : null, checked: st.checked};
        },

        itemCode: function (it, shell) {
            return this.stateOf(it, shell);
        },

        /* The item availability rule; the reason is a code. The editing ban reason is a shell code
           (CompactShell.modeCode). */
        stateOf: function (it, shell) {
            var free = {disabled: false, reason: null, checked: false};
            if (!it || it.sep) return free;
            shell = shell || SSE.Views.CompactShell;
            var lock = shell && typeof shell.lockState === 'function' ? shell.lockState() : null;
            var why = function () {
                if (!lock || !lock.on) return null;
                return typeof shell.modeCode === 'function' ? shell.modeCode(lock) : null;
            };
            if (it.needs) {
                if (!shell || typeof shell[it.needs] !== 'function') return {disabled: true, reason: null, checked: false};
            }
            if (it.use && shell && typeof shell.canUse === 'function' && !shell.canUse(it.use))
                return {disabled: true, reason: why(), checked: false};
            if (it.gate && shell && typeof shell[it.gate] === 'function' && !shell[it.gate]())
                return {disabled: true, reason: why(), checked: false};
            if (it.right && !it.right(options())) {
                var denied = typeof it.denied === 'function' ? it.denied() : null;
                return {disabled: true, reason: denied ? 'denied' : null, checked: false};
            }
            if (it.cellEditOff && this.cellEdited()) return {disabled: true, reason: 'cellEdit', checked: false};
            if (it.fileLock) {
                var fm = fileMenu();
                var btn = fm && typeof fm.getButton === 'function' ? fm.getButton(it.fileLock) : null;
                if (btn && typeof btn.isDisabled === 'function' && btn.isDisabled()) return {disabled: true, reason: why(), checked: false};
            }
            /* A composite item: disabled when all its visible children are disabled, —
               it has no classification of its own, the children's twins decide; the reason is from the first of them. */
            if (Array.isArray(it.items)) return this.holderState(it, shell);
            var ref = it.twin || it.lockLike;
            var own = typeof it.on === 'function' && it.check ? {checked: this.isOn(it)} : null;
            if (!ref) return own ? {disabled: false, reason: null, checked: own.checked} : free;
            var st = Bridge.state(ref);
            if (own) st.pressed = own.checked;
            if (!st.exists && (it.soft || it.fallback)) return {disabled: false, reason: null, checked: !!own && own.checked};
            if (!st.exists) {
                missingTwin(ref, it, shell);
                return {disabled: true, reason: why(), checked: false};
            }
            /* pick — the command of a twin's stock menu item: available when both the button and
               the item itself are available (items have their own locks — cell editing disables the "Clear" items, not
               the button); the mark is from the item. No item by value — no command; an index path
               without an item (the menu is not built yet) — the button decides. */
            if (it.pick != null && it.twin) {
                var pk = Bridge.itemState(it.twin, it.pick);
                if (pk.exists) {
                    st = {exists: true, visible: st.visible, pressed: pk.pressed, disabled: st.disabled || pk.disabled,
                          causes: (st.disabled ? st.causes : []).concat(pk.disabled ? pk.causes : [])};
                } else if (byValuePick(it)) {
                    return {disabled: true, reason: why(), checked: false};
                }
            }
            var checked = it.check === true && st.mixed ? 'mixed' : !!it.check && st.pressed;
            if (it.edit && !this.engineEdits()) return {disabled: true, reason: why(), checked: checked};
            if (lock && lock.on && lock.options && lock.options.toolbar && it.mask !== false && RIBBON[rootOf(ref)])
                return {disabled: true, reason: why(), checked: checked};
            /* keep: stock hid the twin (an empty submenu) — the item stays in place inactive; own — its own rule instead of the twin's mark. */
            if (it.keep && !st.visible) return {disabled: true, reason: null, checked: checked};
            if (typeof it.own === 'function') {
                var off;
                try { off = it.own.call(this, shell); } catch (e) { off = true; }
                return off ? {disabled: true, reason: typeof off === 'string' ? off : null, checked: checked}
                           : {disabled: false, reason: null, checked: checked};
            }
            if (!st.disabled && it.byRows && it.sub) {
                var rows = Bridge.rows(ref);
                if (rows.exists && !rows.live) return {disabled: true, reason: this.lockCode(rows.causes), checked: checked};
            }
            if (!st.disabled) return {disabled: false, reason: null, checked: checked};
            return {disabled: true, reason: this.lockCode(st.causes) || (this.modeCaused(st.causes) ? why() : null), checked: checked};
        },

        /* The mark of a choice item by its own function (on); a function failure — no mark. */
        isOn: function (it) {
            try { return !!it.on(); } catch (e) { return false; }
        },

        holderState: function (it, shell) {
            var me = this, first = null, live = false;
            this.children(it).forEach(function (child) {
                if (live || !isEntry(child)) return;
                var st = me.stateOf(child.mirror ? mirrorRoot(it, child) : child, shell);
                if (!st.disabled) { live = true; return; }
                if (!first) first = st;
            });
            if (live) return {disabled: false, reason: null, checked: false};
            return {disabled: true, reason: first ? first.reason : null, checked: false};
        },

        /* Whether the twin was disabled by the editing ban: there are no reasons in stock (disabled directly) or among them
           there is a ban reason (MODE_CAUSES). Otherwise the reason is stock's own, and the ban caption would be
           foreign to it. */
        modeCaused: function (causes) {
            var list = causes || [];
            return !list.length || list.some(function (c) { return MODE_CAUSES.indexOf(c) >= 0; });
        },

        /* The item's keyboard shortcut — from the stock registry (common/main/lib/controller/
           Shortcuts.js): the first visible shortcut of the action, written the same way as stock
           writes it in the button tooltips (updateShortcutHints: keys joined by "+", on
           macOS — ⌘ ⌥ ⇧). The registry takes into account shortcuts reassigned by the user,
           so it is asked on every section build. No registry or action —
           no hint. */
        shortcut: function (it) {
            if (!it || !it.sc) return '';
            var reg = ctl('Common.Controllers.Shortcuts');
            if (!reg || typeof reg.getShortcutsByActionType !== 'function') return '';
            try {
                var list = reg.getShortcutsByActionType(it.sc);
                var first = list && list[0];
                return first && first.keys && first.keys.length ? first.keys.join('+') : '';
            } catch (e) {
                return '';
            }
        },

        /* A cell is being edited: the stock flag api.isCellEdited (controller/CellEditor.js onApiEditCell, from asc_onEditCell). */
        cellEdited: function () {
            var api = this.api();
            return !!(api && api.isCellEdited);
        },

        /* The engine's verdict: it accepts editing when api.canEdit() (common/apiBase.js:
           !isViewMode && restrictions === None). No engine or method — we do not disable: the
           twin decides. */
        engineEdits: function () {
            var api = this.api();
            if (!api || typeof api.canEdit !== 'function') return true;
            try { return api.canEdit() !== false; } catch (e) { return true; }
        },

        /* The named reason for a stock lock — as text (lockReason) or a code (lockCode): sheet protection —
           'protected', cell editing — 'cellEdit', others are not named (null). */
        lockReason: function (causes) {
            return this.reasonText(this.lockCode(causes));
        },

        lockCode: function (causes) {
            var has = function (list) {
                return (causes || []).some(function (c) { return list.indexOf(c) >= 0; });
            };
            if (has(PROTECT_CAUSES)) {
                var api = this.api();
                try {
                    if (!api || typeof api.asc_isProtectedSheet !== 'function' || api.asc_isProtectedSheet()) return 'protected';
                } catch (e) { /* no reason */ }
            }
            if (has(EDIT_CAUSES)) return 'cellEdit';
            return null;
        },

        /* The reasons for disabling menu bar row items — codes (itemCode) and their texts:
            - view — the shell's own "Viewing" (CompactShell.textModeLockedView);
            - rights, rightsRequest — no edit right; for whoever can request it — how to start editing
              (CompactShell.textModeLockedRights, textModeLockedRequest);
            - protected — sheet protection (textProtected);
            - cellEdit — a cell is being edited (textEditing);
            - denied — a ban by the document rights: the stock copy ban phrase (Main.errorCopyDisabled).
           view and protected are the common reasons of the menu bar row (Common.UI.Compact.MenuModel.COMMON_REASONS): there their
           text is on the menu bar row's side, the same words in the spreadsheets locale. No code or text — null. */
        REASONS: ['view', 'rights', 'rightsRequest', 'protected', 'cellEdit', 'denied'],

        reasonText: function (code) {
            if (typeof code !== 'string' || !code) return null;
            var shell = SSE.Views.CompactShell || {};
            var text = {
                view: shell.textModeLockedView,
                rights: shell.textModeLockedRights,
                rightsRequest: shell.textModeLockedRequest,
                'protected': this.textProtected,
                cellEdit: this.textEditing,
                denied: code === 'denied' ? copyDenied() : null
            }[code];
            return typeof text === 'string' && text ? text : null;
        },

        /* The menu bar row item caption; for an item by value without a caption of its own — the caption of the stock
           item as stock shows it (one command, one name). */
        label: function (it) {
            if (it && it.liveCaption) {
                var caption = Bridge.controlCaption(it.twin);
                if (caption) return caption;
            }
            if (it && it.t != null) return String(it.t);
            return byValuePick(it) ? Bridge.itemCaption(it.twin, it.pick) : '';
        },

        /* The rows of the item's mirror submenu (sub): the twin's stock menu at the moment of opening (StockBridge.mirror) and, for rows from rowSc,
           on the right — the shortcut of the same command from the stock registry, if the row has no explanation of its own. */
        mirrorRows: function (it) {
            var me = this, list = Bridge.mirror(it && it.twin);
            (it && it.rowSc || []).forEach(function (r) {
                var v;
                try { v = typeof r.value === 'function' ? r.value() : r.value; } catch (e) { v = undefined; }
                if (v === undefined) return;
                var sc = me.shortcut({sc: r.sc});
                if (!sc) return;
                list.forEach(function (entry) { if (!entry.sep && entry.value === v && !entry.hint && !entry.example) entry.hint = sc; });
            });
            return list;
        },

        /* A catalog item by key (null — there is none). A stock call that has no
           path of its own in Compact goes by the item's path: the stock search panel (Ctrl+H) — "Edit → Find and
           replace" (CompactShell.bindStockPanels). */
        item: function (k) {
            return find(this.catalog(), k);
        },

        /* The item by key, if the menu bar row offers it now (groups: the right exists, stock did not
           remove the twin), otherwise null: the stock comments panel call (Ctrl+Shift+H) in Compact
           goes by the item's path and with its refusals (CompactShell.bindStockPanels). */
        offered: function (k) {
            return find(this.groups(), k);
        },

        /* Executing an item. Availability is checked here too — the second end of the gate:
           the item could have gone inactive after the section was opened. Submenus (mirror and composite) and
           a group heading do not execute a command. */
        exec: function (it, shell) {
            shell = shell || SSE.Views.CompactShell;
            if (!isEntry(it) || it.sub || it.items || it.mirror || this.itemState(it, shell).disabled) return false;
            /* The gallery is shown by the menu bar row at itself (CompactShell.openGallery); without a row
               there is nowhere to show it — the stock command dialog, if there is one. */
            if (it.gallery) return Bridge.dialog(it.twin);
            if (it.left) return this.leftPanel(it, shell);
            /* A choice from a group (check: 'radio') with its own stock button that is already pressed — the choice is already made, nothing to change (as in
               the toolbar choice list, CompactToolbar source 'choice'): for alignment buttons a repeated press would release the button and reset
               alignment to normal (allowDepress), and that is not choosing a variant. */
            if (it.check === 'radio' && it.twin && it.pick == null && Bridge.state(it.twin).pressed) return true;
            if (it.pick != null) {
                /* The menu is prepared the same way as on a stock opening (without reading: next to
                   the item of "Symbol" there is a gallery of recent ones), then — the stock click on the item. */
                Bridge.prime(it.twin);
                return Bridge.pick(it.twin, it.pick);
            }
            if (it.twin && it.fallback && !Bridge.twin(it.twin)) { it.fallback(shell); return true; }
            if (it.twin) return Bridge.run(it.twin);
            return it.run(shell) !== false;
        },

        /* The stock left area panel opens with its own button: its handler
           shows the panel, sets the width and sends layout:changed. The shell only
           shows the area in advance — for a hidden one the stock handler would measure
           zero width — and then reconciles its state with the buttons. "Find and
           replace" does not close an already open search but returns focus to it. */
        leftPanel: function (it, shell) {
            var o = Bridge.twin(it.twin);
            if (!o) return false;
            if (it.left === 'open' && o.pressed) {
                var view = leftMenu(), p = view && view.panelSearch;
                p && typeof p.focus === 'function' && p.focus();
                return true;
            }
            shell && typeof shell.revealLeft === 'function' && shell.revealLeft();
            var done = Bridge.run(it.twin);
            shell && typeof shell.syncLeftState === 'function' && shell.syncLeftState();
            return done;
        },

        /* --- Commands without a twin -------------------------------------------- */

        /* Download — the stock file menu handler: CSV, PDF and ODS have their own
           warnings and parameters (controller/LeftMenu.js clickSaveAsFormat). */
        download: function (type) {
            var lm = ctl('LeftMenu');
            var types = window.Asc && Asc.c_oAscFileType;
            if (!lm || typeof lm.clickSaveAsFormat !== 'function' || !types || types[type] === undefined) return;
            lm.clickSaveAsFormat(SAVE_AS_MENU, types[type]);
        },

        /* The same path as the "Print" item of the stock "File" menu
           (LeftMenu.clickMenuFileItem: the 'print' notification with the left menu view). */
        print: function () {
            Common.NotificationCenter.trigger('print', leftMenu());
        },

        /* The file menu screens — stock panels: showMenu('file:<section>'). opts — what the stock screen
           accepts on showing: for help — the page address (as controller/Main.js: showMenu('file:help', url)). */
        fileMenu: function (panel, opts) {
            var view = leftMenu();
            if (!view || typeof view.showMenu !== 'function') return;
            if (opts === undefined) view.showMenu('file:' + panel);
            else view.showMenu('file:' + panel, opts);
        },

        /* "Rename" — like a click on the title in the header: the title field
           is focused, the text selected (CompactShell.editTitle); the name goes by the previous path — the 'rename' event of the stock header. If there is no title
           field — the previous stock file menu window: its handler expects a menu object and calls hide() on it
           after the action (for spreadsheets — `close_menu && menu`), our menu closes itself, hence null. */
        rename: function (shell) {
            shell = shell || SSE.Views.CompactShell;
            if (shell && typeof shell.editTitle === 'function' && shell.editTitle()) return;
            var lm = ctl('LeftMenu');
            lm && typeof lm.clickMenuFileItem === 'function' && lm.clickMenuFileItem(null, 'rename');
        },

        /* "Select all" without a ribbon button (for the reader) — the same call as the stock button's
           (controller/Toolbar.js onSelectAll). */
        selectAll: function () {
            var api = this.api();
            if (!api || typeof api.asc_EditSelectAll !== 'function') return;
            api.asc_EditSelectAll();
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* The macros window without the "Macros" button of the "View" tab (for the reader) — the handler of its click (controller/ViewTab.js
           onClickMacros: the stock macros window). */
        macrosDialog: function () {
            var vt = ctl('ViewTab');
            if (vt && typeof vt.onClickMacros === 'function') vt.onClickMacros();
        },

        /* The keyboard shortcuts window — like the "Keyboard shortcuts" item of the advanced settings (view/FileMenuPanels.js
           onClickKeyboardShortcut): the stock window and a mark that the new feature hint need not be shown. */
        shortcutsDialog: function () {
            var V = window.Common && Common.Views;
            if (!V || typeof V.ShortcutsDialog !== 'function') return;
            new V.ShortcutsDialog({api: this.api()}).show();
            Common.localStorage && typeof Common.localStorage.setItem === 'function' &&
                Common.localStorage.setItem('help-tip-customize-shortcuts', 1);
        },

        /* "About" — a modal window with legal information on the mechanics of the stock window (the shared
           Common.UI.Compact.AboutWindow), as in documents; its content is the same as the "About" panel of the advanced interface.
           The stock panel (#about-menu-panel, the "About" button of the left menu) in Compact covered the whole
           editor, and Compact has no left menu button that closes it. When the window is closed — focus goes to the sheet, as after
           other catalog commands. The window is pulled in by the define of the Viewport controller together with the shell: it is not in the stock
           preload lists. */
        about: function () {
            var Ctor = Common.UI.Compact && Common.UI.Compact.AboutWindow;
            if (typeof Ctor !== 'function') return null;
            var win = new Ctor({title: this.textAbout});
            win.on('close', function () { Common.NotificationCenter.trigger('edit:complete'); });
            win.show();
            return win;
        },

        /* "Edit → Copy" — the stock handler of the "Copy" item of the context menu (controller/DocumentHolderExt.js
           onCopyPaste: asc_Copy, if the browser refuses — the stock "Copy, cut and paste actions" window).
           It exists for both roles; the ribbon button handler (controller/Toolbar.js onCopyPaste) is not subscribed for the reader, and on a
           browser refusal it would reach for toolbar.mode, which the reader's ribbon does not have. */
        copyPaste: function (type) {
            var dh = ctl('DocumentHolder');
            if (!dh || typeof dh.onCopyPaste !== 'function') return;
            dh.onCopyPaste({value: type});
        },

        /* "View → Zoom ▸": the list, the command and the current value — the toolbar zoom helpers (CompactToolbar.ZOOMS,
           setZoom, zoomPercent): one value and one command in two places. The toolbar is loaded by the shell, not by the catalog (it depends on the catalog itself), so
           the helpers are taken at call time; without the toolbar — an empty list, and no submenu. After the choice the keyboard goes to
           the sheet, as in the stock zoom list of the bottom row (controller/Statusbar.js menuZoomClick: edit:complete). */
        zooms: function () {
            var tb = SSE.Views.CompactToolbar;
            return tb && Array.isArray(tb.ZOOMS) ? tb.ZOOMS.slice() : [];
        },

        zoomNow: function () {
            var tb = SSE.Views.CompactToolbar;
            return tb && typeof tb.zoomPercent === 'function' ? tb.zoomPercent() : null;
        },

        zoomTo: function (percent) {
            var tb = SSE.Views.CompactToolbar;
            if (!tb || typeof tb.setZoom !== 'function') return;
            tb.setZoom(percent);
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* "View → Hidden sheets ▸": the item behaves like the stock "Show" command
           for sheets — the conditions of the stock tab menu (view/Statusbar.js onTabMenu; the same for the "Format cells → Show → Hidden
           sheets" of the ribbon, controller/Toolbar.js): the workbook structure is locked by a co-author or protected — inactive; also while
           a range is being chosen by a stock window (chart, formatted table, print titles), on a lost connection, a background open
           and an external chart. No engine or sheet row — inactive. */
        hiddenSheetsLock: function () {
            var api = this.api(), c = ctl('Statusbar'), sb = c && c.statusbar;
            if (!api || !sb) return true;
            var mode = sb.mode || {}, R = window.Asc && Asc.c_oAscSelectionDialogType, range = sb.rangeSelectionMode;
            if (mode.isDisconnected || mode.isBackgroundOpen || mode.isExternalChart) return true;
            if (R && (range === R.Chart || range === R.FormatTable || range === R.PrintTitles)) return true;
            try {
                return !!(api.asc_isWorkbookLocked() || api.asc_isProtectedWorkbook());
            } catch (e) {
                return true;
            }
        },

        requestEditRights: function () {
            var lm = ctl('LeftMenu');
            lm && typeof lm.clickMenuFileItem === 'function' && lm.clickMenuFileItem(null, 'edit');
        },

        /* The indent in stock is only the right cell panel stepper (view/CellSettings.js:
           api.asc_setCellIndent, step 1, from 0 to 250). The value is from the engine. */
        indent: function (delta) {
            var api = this.api();
            if (!api || typeof api.asc_setCellIndent !== 'function') return;
            var info = typeof api.asc_getCellInfo === 'function' ? api.asc_getCellInfo() : null;
            var xfs = info && typeof info.asc_getXfs === 'function' ? info.asc_getXfs() : null;
            var cur = (xfs && typeof xfs.asc_getIndent === 'function' && xfs.asc_getIndent()) || 0;
            api.asc_setCellIndent(Math.max(0, Math.min(250, cur + delta)));
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* --- Texts ------------------------------------------------------------ */
        /* The defaults are English: the locale overrides them from locale/<language>.json (the keys
           SSE.Views.SheetActions.*). */

        textAbout: 'About',
        textAddComment: 'Add comment',
        textAdvancedSettings: 'Advanced settings',
        textAlign: 'Align',
        textAllowRanges: 'Allow edit ranges',
        textAnalysis: 'Analysis',
        textBorders: 'Borders',
        textCalcOptions: 'Calculation options',
        textCellFormat: 'Format cells',
        textCellStyles: 'Cell styles',
        textChangeCase: 'Change case',
        textChart: 'Chart',
        textClear: 'Clear',
        textClearFilter: 'Clear filter',
        textClearFormat: 'Clear format',
        textCoauthMode: 'Co-editing mode',
        textCollaboration: 'Collaboration',
        textColorScheme: 'Color scheme',
        textComments: 'Comments',
        textConditional: 'Conditional formatting',
        textCopy: 'Copy',
        textCreateView: 'Create view',
        textCustomSort: 'Custom sort',
        textCut: 'Cut',
        textData: 'Data',
        textDeleteCells: 'Delete cells',
        textDeleteComments: 'Delete comments',
        textDocInfo: 'Document info',
        textDownload: 'Download as',
        textEdit: 'Edit',
        textEditDoc: 'Edit spreadsheet',
        textEditing: 'Finish editing the cell first',
        textExternalLinks: 'External links',
        textFile: 'File',
        textFill: 'Fill',
        textFilter: 'Filter',
        textFindReplace: 'Find and replace',
        textFocus: 'Focus mode',
        textFormat: 'Format',
        textFormatAsTable: 'Format as table',
        textFormulaAuditing: 'Formula auditing',
        textFormulas: 'Formulas',
        textFreeze: 'Freeze panes',
        textFunction: 'Function',
        textFunctionList: 'Function list',
        textGoalSeek: 'Goal Seek',
        textGroup: 'Group',
        textHeaderFooter: 'Header & footer',
        textHelp: 'Help',
        textHelpItem: 'Help',
        textHiddenSheets: 'Hidden sheets',
        textHideToolbar: 'Hide toolbar',
        textHistory: 'Version history',
        textImage: 'Image',
        textImport: 'Import',
        textIndent: 'Indent',
        textIndentDec: 'Decrease indent',
        textIndentInc: 'Increase indent',
        textInsert: 'Insert',
        textInsertCells: 'Insert cells',
        textLink: 'Link',
        textMacros: 'Macros',
        textMerge: 'Merge cells',
        textNamedRanges: 'Named ranges',
        textNumberFormat: 'Number format',
        textPageBreaks: 'Page breaks',
        textPaste: 'Paste',
        textPauseMacro: 'Pause recording',
        textPivot: 'Pivot table',
        textPrint: 'Print',
        textPrintArea: 'Print area',
        textProtectRange: 'Protect range',
        textProtectSheet: 'Protect sheet',
        textProtectWorkbook: 'Protect workbook',
        textProtected: 'The sheet is protected',
        textProtection: 'Protection',
        textRecordMacro: 'Record macro',
        textRedo: 'Redo',
        textRemoveDuplicates: 'Remove duplicates',
        textRename: 'Rename',
        textResolveComments: 'Resolve comments',
        textRowsColsSheet: 'Rows, columns and sheet',
        textSave: 'Save',
        textSelectAll: 'Select all',
        textShape: 'Shape',
        textSharing: 'Sharing settings',
        textSheet: 'Sheet',
        textSheetDirection: 'Sheet direction',
        textSheetViews: 'Named views',
        textShortcuts: 'Keyboard Shortcuts',
        textShow: 'Show',
        textShowFormulas: 'Show formulas',
        textSlicer: 'Slicer',
        textSolver: 'Solver',
        textSortAZ: 'Sort A to Z',
        textSortZA: 'Sort Z to A',
        textSparkline: 'Sparkline',
        textSpelling: 'Spelling',
        textSymbol: 'Symbol',
        textText: 'Text',
        textTextBox: 'Text box',
        textTextDirection: 'Text direction',
        textTextRotation: 'Text rotation',
        textTextToColumns: 'Text to columns',
        textTraceDependents: 'Trace dependents',
        textTracePrecedents: 'Trace precedents',
        textUndo: 'Undo',
        textUngroup: 'Ungroup',
        textValidation: 'Data validation',
        textView: 'View',
        textViewNormal: 'Normal',
        textViewPageLayout: 'Page layout',
        textViews: 'Sheet View',
        textWatchWindow: 'Watch window',
        textZoom: 'Zoom'

    }, SSE.Views.SheetActions || {});

    return SSE.Views.SheetActions;
});
