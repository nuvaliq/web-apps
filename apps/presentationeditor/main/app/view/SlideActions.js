/*
 * SlideActions — the catalog of the menu row sections.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Nine sections: File · Edit · View · Insert · Format · Slide ·
 * Arrange · Collaboration · Help. A command has one place and one name:
 * the item caption matches the tooltip of the same button on the panel
 * (CompactToolbar). Every item is bound to exactly
 * one path:
 *   twin   — the address of a stock control in StockBridge ('<root>:<path>'): the command
 *            goes the stock way of the control, availability, visibility and the mark
 *            are read from it too;
 *   cmd    — a shell command (CompactShell.command), args are its arguments;
 *   engine — a call of the engine or of a stock controller method, only where there is
 *            no counterpart or it is disabled by a reason of the shell itself; the bridge
 *            executes only the names marked here.
 * Submenu: sub — an array of catalog items or true (a snapshot of the stock menu
 * of the counterpart at the moment of opening); gallery — the stock popup list of the counterpart;
 * icons — icons of the snapshot rows by the stock item icon class ({cls, i}).
 *
 * ref — the address from which availability and visibility are read when the command
 * goes another way (engine; a menu item of a stock button is the twin, while
 * the button itself is what gets disabled).
 *
 * window — the shell's own window instead of the counterpart's stock surface (the name
 * of the CompactShell.command command): visibility and availability — by the counterpart,
 * the window opens; without a command owner — the stock path.
 *
 * Flags: edit — the item edits the presentation; needRight — does not edit, but
 * the stock editor without edit rights does not create it; when — a capability
 * (download, print, portal): without it the item is not drawn; sel — selection
 * kinds (SlideSelection.kind()) for which the item is alive; why — the reason
 * for an unsuitable selection; idle — the reason when the counterpart is disabled; check —
 * an item with a mark.
 *
 * The composition is rebuilt on every groups() call: rights, capabilities and
 * the mode are read at that moment. Captions of stock commands come from the stock objects
 * (translated by the stock locale), our own are the text… defaults below.
 *
 * The frame (CompactShell) installs the zone by calling install(shell) in the order of
 * CompactShell.ZONES.
 */
define([], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    /* Selection kinds: any object; text — an object with text (a text box,
       placeholder, shape or group with text) or a table; shape text —
       without a table. Text typing (typing) — inside a text box or shape. A shape
       or group without text ('shape') does not get the text items. */
    var OBJ = ['text', 'shape', 'image', 'table', 'chart', 'line', 'typing'];
    var TXT = ['text', 'table', 'typing'];
    var TXT_SHAPE = ['text', 'typing'];

    /* Shell commands that open a right-panel section (SlideSections). */
    var PANEL_CMDS = ['slideSection', 'objectProperties'];

    /* Default reason for an unsuitable selection — by the set of kinds. */
    function selectionWhy(sel) {
        if (sel === OBJ) return 'textSelectObject';
        if (sel === TXT || sel === TXT_SHAPE) return 'textSelectText';
        if (sel.length === 1 && sel[0] === 'table') return 'textSelectTable';
        if (sel.length === 1 && sel[0] === 'image') return 'textSelectImage';
        return 'textSelectObject';
    }

    /* Capabilities: without them the item is not drawn (not disabled). */
    var CAN = {
        /* Entering editing from a read-only presentation — the condition of the stock "File"
           item (view/FileMenu.js, miEdit). canRequestEditRights is the
           handler of the request to the host: without it the request would go nowhere. */
        requestEdit: function (o) { return !o.isEdit && !!o.canEdit && !!o.canRequestEditRights; },
        download: function (o) { return !!o.canDownload && (!o.isDesktopApp || !o.isOffline); },
        print:    function (o) { return !!o.canPrint; },
        rename:   function (o) { return !!o.canRename && !o.isDesktopApp; },
        sharing:  function (o) { return !!((o.sharingSettingsUrl && o.sharingSettingsUrl.length) || o.canRequestSharingSettings); },
        history:  function (o) { return !!o.canUseHistory; },
        comment:  function (o) { return !!(o.canCoAuthoring && o.canComments); },
        /* The comments panel — the condition of the left area (CompactLeft.can): the stock
           code shows its button only with collaboration and not in the
           lightweight version. */
        comments: function (o) {
            var left = PE.Views.CompactLeft;
            if (left && typeof left.can === 'function') return left.can('comments');
            return !!(o.canCoAuthoring && o.canViewComments && !o.isLightVersion);
        },
        chat:     function (o) { return !!(o.canCoAuthoring && o.canChat); }
    };

    /* Menu object for the stock download handler: after the call it hides
       the "File" menu (LeftMenu.clickSaveAsFormat), while the menu row has its own closing. */
    var SAVE_AS_MENU = {hide: function () {}};

    /* Hovering an item with a submenu does not open it at once — as in the menus
       of documents and spreadsheets. */
    var HOVER_DELAY = 150;
    /* The submenu stands with its first row level with the item: the menu window padding on top. */
    var POP_PAD_Y = 13;
    /* Wheel step in lines (deltaMode 1) — in pixels. */
    var WHEEL_LINE = 33;

    function bridge() { return PE.Views.StockBridge; }

    /* Shell guard (CompactShell.guarded) for own DOM handlers. */
    function guard(label, fn) {
        var shell = PE.Views.CompactShell;
        return shell && typeof shell.guarded === 'function' ? shell.guarded(label, fn) : fn;
    }

    function glyph(name) {
        var C = window.Common && Common.UI && Common.UI.Compact, icons = C && C.Icons;
        try { return name && icons && typeof icons.svg === 'function' ? icons.svg(name, 24) : ''; } catch (e) { return ''; }
    }

    /* Icon of a snapshot row: the stock item icon class (iconCls, btn-*) by
       the icons table of the catalog item — {cls, i}. No entry — a row without an icon. */
    function mirrorGlyph(root, entry) {
        var list = root && root.icons;
        if (!Array.isArray(list) || !entry || !entry.icon) return '';
        for (var n = 0; n < list.length; n++) {
            if (list[n] && list[n].cls === entry.icon) return glyph(list[n].i);
        }
        return '';
    }

    function ctl(name) {
        try { return (PE.getController && PE.getController(name)) || null; } catch (e) { return null; }
    }

    function options() {
        var main = ctl('Main');
        return (main && main.appOptions) || {};
    }

    /* Caption of a stock object: 'Toolbar.textTabFile' — PE.Views.Toolbar,
       'Common.Views.ReviewChanges.txtCoAuthMode' — from window. The stock locale
       puts the translation into the view prototype. */
    function stock(path) {
        var parts = String(path).split('.'), key = parts.pop();
        var o = parts[0] === 'Common' ? window : PE.Views;
        for (var i = 0; i < parts.length && o; i++) o = o[parts[i]];
        if (!o) return '';
        var v = o.prototype && typeof o.prototype[key] === 'string' ? o.prototype[key] : o[key];
        return typeof v === 'string' ? v : '';
    }

    /* Keyboard shortcut in a caption — as in stock tooltips (⌘ on Mac), without the brackets
       of the tooltip template. */
    function keys(s) {
        var str = window.Common && Common.Utils && Common.Utils.String;
        try {
            return str && typeof str.platformKey === 'function' ? str.platformKey(s, '{0}') : s;
        } catch (e) {
            return s;
        }
    }

    /* A shortcut with the Control key itself: the stock ctrl+h is Control on Mac too, and
       not ⌘ (Cmd+H has its own job there), so the caption has ⌃. */
    function ctrlKeys(s) {
        var mac = !!(window.Common && Common.Utils && Common.Utils.isMac);
        return mac ? s.replace(/Ctrl\+/g, '\u2303') : keys(s);
    }

    function kind() {
        var sel = PE.Views.SlideSelection;
        try { return sel && typeof sel.kind === 'function' ? sel.kind() || 'none' : 'none'; } catch (e) { return 'none'; }
    }

    function mode() {
        var m = PE.Views.CompactModes;
        try { return m && typeof m.mode === 'function' ? m.mode() : 'edit'; } catch (e) { return 'edit'; }
    }

    function node(tag, cls) {
        var el = document.createElement(tag);
        if (cls) el.setAttribute('class', cls);
        return el;
    }

    function stop(e) {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    }

    /* Separators at the edges and in a row — traces of skipped items. */
    function cleanSeps(list) {
        var out = [];
        list.forEach(function (it) {
            if (it.sep && (!out.length || out[out.length - 1].sep)) return;
            out.push(it);
        });
        while (out.length && out[out.length - 1].sep) out.pop();
        return out;
    }

    PE.Views.SlideActions = _.extend({

        OBJ: OBJ,
        TXT: TXT,

        shell: null,
        thumbsShown: null,  // thumbnail strip by asc_onThumbnailsShow; null — no signal yet
        slideHidden: false, // the current slide is hidden (asc_onFocusObject)

        install: function (shell) {
            var me = this;
            this.shell = shell;
            if (shell && typeof shell.onApi === 'function') {
                shell.onApi('asc_onThumbnailsShow', function (show) { me.thumbsShown = !!show; });
                shell.onApi('asc_onFocusObject', function (objs) { me.readSlide(objs); });
            }
            /* Item states are recomputed on a mode change and on the stock
               editing lock; leaving for the "Stock interface" closes the menu. */
            var nc = Common.NotificationCenter;
            var modes = PE.Views.CompactModes;
            nc.on((modes && modes.MODE_EVENT) || 'vo:mode', guard('menu: mode', function () { me.refreshMenu(); }));
            nc.on('editing:disable', guard('menu: editing lock', function () { me.refreshMenu(); }));
            nc.on('shell:advanced', guard('menu: stock interface', function () { me.closeMenu(); }));
            var host = shell && typeof shell.rowEl === 'function' ? shell.rowEl('menubar') : null;
            if (host) this.renderMenuBar(host);
        },

        /* Whether the current slide is hidden — from the slide properties in the engine selection. */
        readSlide: function (objs) {
            var types = window.Asc && Asc.c_oAscTypeSelectElement;
            var slideType = types && types.Slide !== undefined ? types.Slide : 7;
            (objs || []).forEach(function (o) {
                if (!o || typeof o.get_ObjectType !== 'function' || o.get_ObjectType() !== slideType) return;
                var v = o.get_ObjectValue && o.get_ObjectValue();
                if (v && typeof v.get_IsHidden === 'function') this.slideHidden = !!v.get_IsHidden();
            }, this);
        },

        /* --- Catalog ------------------------------------------------------------ */

        /* Sections with items that have the capability; separators cleaned. */
        groups: function () {
            var me = this, o = options();
            return this.catalog().map(function (g) {
                return {label: g.label, items: me.offered(g.items, o)};
            });
        },

        offered: function (items, o) {
            var me = this;
            var list = items.filter(function (it) {
                return it.sep || !it.when || (CAN[it.when] && CAN[it.when](o));
            }).map(function (it) {
                if (!Array.isArray(it.sub)) return it;
                return _.extend({}, it, {sub: me.offered(it.sub, o)});
            });
            return cleanSeps(list);
        },

        /* The full catalog. The counterpart of "Start Slideshow", "Copy", "Select
           All" and "Slides" depends on the right and the mode: without edit rights and in
           "Viewing" the stock ribbon has no button or it is disabled. */
        catalog: function () {
            var SEP = {sep: true};
            var shell = this.shell || PE.Views.CompactShell;
            var right = !shell || typeof shell.editRight !== 'function' || shell.editRight();
            var full = right && mode() !== 'view';
            /* A "Download" submenu row — the format name, as in the stock panel
               "Download as" (FileMenuPanels.ViewSaveAs). */
            var dl = function (format) {
                return {k: 'download' + format, t: format, engine: 'LeftMenu.clickSaveAsFormat',
                        format: format, ref: 'FileMenu:miDownload', when: 'download'};
            };
            /* Submenu items inherit the flags and the selection of the parent section. */
            var inherit = function (parent, list) {
                return list.map(function (x) {
                    if (x.sep) return x;
                    var y = _.extend({}, x);
                    if (parent.edit && y.edit === undefined) y.edit = true;
                    if (parent.sel && !y.sel) { y.sel = parent.sel; y.why = y.why || parent.why; }
                    return y;
                });
            };
            var sub = function (parent, list) { parent.sub = inherit(parent, list); return parent; };

            return [
                {label: stock('Toolbar.textTabFile'), items: [
                    /* Request of the edit right from the host — the stock handler of the "File"
                       item (LeftMenu.clickMenuFileItem, 'edit'). */
                    {k: 'requestEdit', t: stock('FileMenu.btnToEditCaption'), i: 'rename', engine: 'LeftMenu.clickMenuFileItem', action: 'edit', when: 'requestEdit'},
                    SEP,
                    {k: 'save', t: stock('FileMenu.btnSaveCaption'), i: 'save', h: keys('Ctrl+S'), engine: 'LeftMenu.clickMenuFileItem', action: 'save', ref: 'FileMenu:miSave', edit: true, idle: 'textNoUnsavedChanges'},
                    /* Without the download right the whole item disappears, not only
                       the submenu rows. */
                    sub({k: 'download', t: this.textDownload, i: 'download', ref: 'FileMenu:miDownload', when: 'download'},
                        ['PPTX', 'PDF', 'ODP', 'PNG'].map(dl)),
                    {k: 'print', t: stock('FileMenu.btnPrintCaption'), i: 'print', h: keys('Ctrl+P'), engine: 'LeftMenu.clickToolbarPrint', ref: 'FileMenu:miPrint', when: 'print'},
                    SEP,
                    {k: 'rename', t: stock('FileMenu.btnRenameCaption'), i: 'rename', engine: 'LeftMenu.clickMenuFileItem', action: 'rename', ref: 'FileMenu:miRename', when: 'rename', edit: true},
                    {k: 'info', t: this.textDocInfo, i: 'info', twin: 'FileMenu:miInfo', file: 'info', window: 'docInfo'},
                    {k: 'settings', t: this.textAdvancedSettings, i: 'settings', twin: 'FileMenu:miSettings', file: 'opts'}
                ]},
                {label: this.textEdit, items: [
                    {k: 'undo', t: stock('Toolbar.tipUndo'), i: 'undo', h: keys('Ctrl+Z'), twin: 'Toolbar:btnUndo', edit: true, idle: 'textNothingToUndo'},
                    {k: 'redo', t: stock('Toolbar.tipRedo'), i: 'redo', h: keys('Ctrl+Y'), twin: 'Toolbar:btnRedo', edit: true, idle: 'textNothingToRedo'},
                    SEP,
                    {k: 'cut', t: stock('Toolbar.tipCut'), i: 'cut', h: keys('Ctrl+X'), twin: 'Toolbar:btnCut', edit: true, sel: OBJ},
                    full ? {k: 'copy', t: stock('Toolbar.tipCopy'), i: 'copy', h: keys('Ctrl+C'), twin: 'Toolbar:btnCopy', idle: 'textSelectObjectOrText'}
                         : {k: 'copy', t: stock('Toolbar.tipCopy'), i: 'copy', h: keys('Ctrl+C'), twin: 'DocumentHolder:menuViewCopy', idle: 'textSelectObjectOrText'},
                    {k: 'paste', t: stock('Toolbar.tipPaste'), i: 'paste', h: keys('Ctrl+V'), twin: 'Toolbar:btnPaste', edit: true},
                    SEP,
                    full ? {k: 'selectAll', t: stock('Toolbar.tipSelectAll'), i: 'selectAll', h: keys('Ctrl+A'), twin: 'Toolbar:btnSelectAll'}
                         : {k: 'selectAll', t: stock('Toolbar.tipSelectAll'), i: 'selectAll', h: keys('Ctrl+A'), engine: 'asc_EditSelectAll'},
                    {k: 'search', t: this.textFindReplace, i: 'search', h: ctrlKeys('Ctrl+H'), cmd: 'search'},
                    {k: 'delete', t: stock('DocumentHolder.deleteText'), i: 'trash', h: 'Del', engine: 'asc_Remove', edit: true, sel: OBJ},
                    SEP,
                    sub({k: 'spelling', t: this.textSpelling, i: 'spell', needRight: true}, [
                        {k: 'spellCheck', t: stock('Common.Views.ReviewChanges.txtSpelling'), twin: 'Review:btnsSpelling.0', check: 'twin'},
                        {k: 'ignoreAll', t: this.textIgnoreAll, twin: 'DocumentHolder:menuIgnoreAllSpellPara'}
                    ]),
                    {k: 'docLang', t: this.textDocLanguage, i: 'language', twin: 'Review:btnsDocLang.0', edit: true}
                ]},
                {label: stock('Toolbar.textTabView'), items: [
                    {k: 'show', t: stock('Toolbar.tipPreview'), i: 'play', twin: full ? 'Toolbar:btnPreview' : 'Statusbar:btnPreview', sub: true},
                    SEP,
                    {k: 'normal', t: stock('ViewTab.textNormal'), twin: 'ViewTab:btnNormal', needRight: true, check: 'twin'},
                    {k: 'slideMaster', t: stock('ViewTab.textSlideMaster'), i: 'layout', twin: 'ViewTab:btnSlideMaster', edit: true, check: 'twin'},
                    SEP,
                    /* Zoom levels — the same set as in the zoom list on the panel
                       (CompactToolbar). */
                    sub({k: 'zoom', t: stock('ViewTab.textZoom'), i: 'zoom'}, [
                        {k: 'fitSlide', t: stock('ViewTab.textFitToSlide'), i: 'fitPage', twin: 'ViewTab:btnFitToSlide', check: 'twin'},
                        {k: 'fitWidth', t: stock('ViewTab.textFitToWidth'), i: 'fitWidth', twin: 'ViewTab:btnFitToWidth', check: 'twin'},
                        SEP
                    ].concat([50, 75, 90, 100, 125, 150, 175, 200].map(function (v) {
                        return {k: 'zoom' + v, t: v + '%', twin: 'ViewTab:cmbZoom', event: 'selected',
                                args: [{value: v, displayValue: v + '%'}]};
                    }))),
                    {k: 'rulers', t: stock('ViewTab.textRulers'), i: 'ruler', twin: 'ViewTab:chRulers', needRight: true, check: 'twin'},
                    {k: 'guides', t: stock('ViewTab.textGuides'), twin: 'ViewTab:btnGuides', sub: true, needRight: true},
                    {k: 'gridlines', t: stock('ViewTab.textGridlines'), twin: 'ViewTab:btnGridlines', sub: true, needRight: true},
                    {k: 'notes', t: stock('ViewTab.textNotes'), i: 'notes', twin: 'ViewTab:chNotes', check: 'twin'},
                    full ? {k: 'thumbs', t: stock('LeftMenu.tipSlides'), i: 'filmstrip', twin: 'LeftMenu:btnThumbs', check: 'thumbs'}
                         : {k: 'thumbs', t: stock('LeftMenu.tipSlides'), i: 'filmstrip', engine: 'LeftMenu.onShowTumbnails', check: 'thumbs'},
                    SEP,
                    {k: 'hideToolbar', t: this.textHideToolbar, i: 'toolbar', cmd: 'hideToolbar', edit: true},
                    {k: 'focus', t: this.textFocusMode, i: 'focus', cmd: 'focus'},
                    SEP,
                    sub({k: 'macroMenu', t: stock('ViewTab.textMacros'), needRight: true}, [
                        {k: 'macros', t: stock('ViewTab.textMacros'), twin: 'ViewTab:btnMacros', needRight: true},
                        {k: 'recMacro', t: stock('ViewTab.textRecMacro'), twin: 'ViewTab:btnRecMacro', liveCaption: true, edit: true},
                        {k: 'pauseMacro', t: stock('ViewTab.textPauseMacro'), i: 'pause', twin: 'ViewTab:btnPauseMacro', liveCaption: true, edit: true, idle: 'textNoMacroRecording'}
                    ])
                ]},
                {label: stock('Toolbar.textTabInsert'), items: [
                    {k: 'image', t: stock('Toolbar.capInsertImage'), i: 'image', twin: 'Toolbar:btnsInsertImage.0', sub: true, edit: true},
                    {k: 'textbox', t: stock('Toolbar.capInsertText'), i: 'textAdd', twin: 'Toolbar:btnsInsertText.0', edit: true},
                    {k: 'shape', t: stock('Toolbar.capInsertShape'), i: 'shape', twin: 'Toolbar:cmbsInsertShape.0', gallery: true, edit: true},
                    {k: 'table', t: stock('Toolbar.capInsertTable'), i: 'table', twin: 'Toolbar:btnInsertTable', gallery: true, edit: true},
                    {k: 'chart', t: stock('Toolbar.capInsertChart'), i: 'chart', twin: 'Toolbar:btnInsertChart', gallery: true, edit: true},
                    {k: 'smartArt', t: stock('Toolbar.capBtnInsSmartArt'), i: 'smartart', twin: 'Toolbar:btnInsertSmartArt', gallery: true, edit: true},
                    {k: 'textArt', t: stock('Toolbar.capInsertTextArt'), i: 'textart', twin: 'Toolbar:btnInsertTextArt', gallery: true, edit: true},
                    {k: 'equation', t: stock('Toolbar.capInsertEquation'), i: 'formula', twin: 'Toolbar:btnInsertEquation', edit: true},
                    /* The stock "Symbol" button has its own menu (recent symbols and
                       "More Symbols"): the item is "More Symbols", that is, the window
                       "Symbol"; availability — from the button itself. */
                    {k: 'symbol', t: stock('Toolbar.capBtnInsSymbol'), i: 'symbol', twin: 'Toolbar:btnInsertSymbol.menu.items.2', ref: 'Toolbar:btnInsertSymbol', edit: true, idle: 'textPlaceCursor'},
                    SEP,
                    {k: 'animation', t: stock('Toolbar.textTabAnimation'), i: 'autoCorrect', cmd: 'slideSection', args: ['animation'], edit: true},
                    {k: 'link', t: stock('Toolbar.capInsertHyperlink'), i: 'link', h: keys('Ctrl+K'), twin: 'Toolbar:btnInsertHyperlink', edit: true, idle: 'textPlaceCursor'},
                    {k: 'comment', t: stock('Toolbar.capBtnComment'), i: 'comment', cmd: 'addComment', when: 'comment'},
                    SEP,
                    {k: 'newSlide', t: stock('DocumentHolder.txtNewSlide'), i: 'newSlide', h: keys('Ctrl+M'), twin: 'Toolbar:btnAddSlide', edit: true},
                    {k: 'slideNum', t: stock('Toolbar.capBtnSlideNum'), i: 'pageNumber', twin: 'Toolbar:btnInsSlideNum', edit: true},
                    {k: 'dateTime', t: stock('Toolbar.capBtnDateTime'), i: 'dateTime', twin: 'Toolbar:btnInsDateTime', edit: true},
                    {k: 'headerFooter', t: stock('Toolbar.capBtnInsHeaderFooter'), i: 'header', twin: 'Toolbar:btnEditHeader', edit: true}
                ]},
                {label: this.textFormat, items: [
                    sub({k: 'text', t: this.textText, i: 'bold', edit: true, sel: TXT}, [
                        {k: 'bold', t: stock('Toolbar.textBold'), i: 'bold', h: keys('Ctrl+B'), twin: 'Toolbar:btnBold', check: 'twin'},
                        {k: 'italic', t: stock('Toolbar.textItalic'), i: 'italic', h: keys('Ctrl+I'), twin: 'Toolbar:btnItalic', check: 'twin'},
                        /* Underline, superscript, subscript — the same names
                           as in the tooltips of these buttons on the panel. */
                        {k: 'underline', t: this.textUnderline, i: 'underline', h: keys('Ctrl+U'), twin: 'Toolbar:btnUnderline', check: 'twin'},
                        {k: 'strikeout', t: stock('Toolbar.textStrikeout'), i: 'strike', twin: 'Toolbar:btnStrikeout', check: 'twin'},
                        SEP,
                        {k: 'superscript', t: this.textSuperscript, i: 'sup', twin: 'Toolbar:btnSuperscript', check: 'twin'},
                        {k: 'subscript', t: this.textSubscript, i: 'sub', twin: 'Toolbar:btnSubscript', check: 'twin'}
                    ]),
                    {k: 'changeCase', t: this.textCase, i: 'case', twin: 'Toolbar:btnChangeCase', sub: true, edit: true, sel: TXT},
                    sub({k: 'align', t: stock('DocumentHolder.alignmentText'), i: 'alignL', edit: true, sel: TXT}, [
                        {k: 'alignH', t: stock('Toolbar.tipHAligh'), twin: 'Toolbar:btnHorizontalAlign', sub: true, inline: true},
                        SEP,
                        {k: 'alignV', t: stock('Toolbar.tipVAligh'), twin: 'Toolbar:btnVerticalAlign', sub: true, inline: true}
                    ]),
                    {k: 'lineSpace', t: stock('Toolbar.tipLineSpace'), i: 'lineh', twin: 'Toolbar:btnLineSpace', sub: true, edit: true, sel: TXT},
                    sub({k: 'lists', t: this.textBulletsNumbering, i: 'bullet', edit: true, sel: TXT}, [
                        {k: 'markers', t: stock('Toolbar.tipMarkers'), i: 'bullet', twin: 'Toolbar:btnMarkers', gallery: true},
                        {k: 'numbers', t: stock('Toolbar.tipNumbers'), i: 'numbered', twin: 'Toolbar:btnNumbers', gallery: true}
                    ]),
                    {k: 'columns', t: stock('ShapeSettingsAdvanced.strColumns'), i: 'columns', twin: 'Toolbar:btnColumns', sub: true, edit: true, sel: TXT_SHAPE},
                    {k: 'textDir', t: stock('DocumentHolder.directionText'), twin: 'Toolbar:btnTextDir', sub: true, edit: true, sel: TXT},
                    SEP,
                    sub({k: 'tableMenu', t: stock('Toolbar.capInsertTable'), i: 'table', edit: true, sel: ['table']}, [
                        {k: 'tableInsert', t: stock('DocumentHolder.insertText'), twin: 'DocumentHolder:menuTableInsertText', sub: true},
                        {k: 'tableDelete', t: stock('DocumentHolder.deleteText'), twin: 'DocumentHolder:menuTableDeleteText', sub: true},
                        SEP,
                        {k: 'tableMerge', t: stock('DocumentHolder.mergeCellsText'), twin: 'DocumentHolder:mnuTableMerge'},
                        {k: 'tableSplit', t: stock('DocumentHolder.splitCellsText'), twin: 'DocumentHolder:mnuTableSplit'},
                        SEP,
                        {k: 'tableDistRows', t: stock('DocumentHolder.textDistributeRows'), twin: 'DocumentHolder:menuTableDistRows'},
                        {k: 'tableDistCols', t: stock('DocumentHolder.textDistributeCols'), twin: 'DocumentHolder:menuTableDistCols'}
                    ]),
                    sub({k: 'imageMenu', t: stock('Toolbar.capInsertImage'), i: 'image', edit: true, sel: ['image']}, [
                        {k: 'crop', t: stock('DocumentHolder.textCrop'), i: 'cut', twin: 'DocumentHolder:menuImgCrop', sub: true},
                        {k: 'replaceImage', t: stock('DocumentHolder.textReplace'), i: 'replaceImg', twin: 'DocumentHolder:menuImgReplace', sub: true},
                        {k: 'originalSize', t: stock('DocumentHolder.originalSizeText'), twin: 'DocumentHolder:menuImgOriginalSize'},
                        {k: 'resetCrop', t: stock('DocumentHolder.textResetCrop'), i: 'resetImg', twin: 'DocumentHolder:menuImgResetCrop'}
                    ]),
                    SEP,
                    {k: 'clearStyle', t: this.textClearFormatting, i: 'clear', twin: 'Toolbar:btnClearStyle', edit: true, sel: TXT},
                    {k: 'objectProperties', t: this.textObjectProperties, i: 'settings', cmd: 'objectProperties', needRight: true, check: 'rightPanel'}
                ]},
                {label: this.textSlide, items: [
                    {k: 'newSlideSlide', t: stock('DocumentHolder.txtNewSlide'), i: 'newSlide', h: keys('Ctrl+M'), twin: 'Toolbar:btnAddSlide', edit: true},
                    {k: 'duplicateSlide', t: stock('DocumentHolder.txtDuplicateSlide'), i: 'duplicate', twin: 'DocumentHolder:mnuDuplicateSlide', edit: true},
                    {k: 'deleteSlide', t: stock('DocumentHolder.txtDeleteSlide'), i: 'trash', twin: 'DocumentHolder:mnuDeleteSlide', edit: true},
                    {k: 'hideSlide', t: stock('DocumentHolder.txtSlideHide'), i: 'eyeOff', twin: 'DocumentHolder:mnuSlideHide', edit: true, check: 'slideHidden'},
                    sub({k: 'moveSlide', t: this.textMoveSlide, edit: true}, [
                        {k: 'moveSlideStart', t: stock('DocumentHolder.txtMoveSlidesToStart'), twin: 'DocumentHolder:mnuMoveSlideToStart'},
                        {k: 'moveSlideEnd', t: stock('DocumentHolder.txtMoveSlidesToEnd'), twin: 'DocumentHolder:mnuMoveSlideToEnd'}
                    ]),
                    SEP,
                    {k: 'background', t: this.textBackground, i: 'background', cmd: 'slideSection', args: ['slide'], edit: true},
                    {k: 'changeLayout', t: stock('DocumentHolder.txtChangeLayout'), i: 'layout', twin: 'Toolbar:btnChangeSlide', gallery: true, edit: true},
                    {k: 'resetLayout', t: stock('DocumentHolder.txtResetLayout'), twin: 'DocumentHolder:mnuResetSlide', edit: true},
                    {k: 'changeTheme', t: stock('DocumentHolder.txtChangeTheme'), i: 'theme', cmd: 'slideSection', args: ['theme'], edit: true},
                    {k: 'colorSchemas', t: this.textColorScheme, i: 'color', twin: 'Toolbar:btnColorSchemas', gallery: true, edit: true},
                    {k: 'slideSize', t: stock('Toolbar.txtSlideSize'), i: 'pageSize', twin: 'Toolbar:btnSlideSize', gallery: true, edit: true},
                    SEP,
                    {k: 'transition', t: this.textTransition, i: 'transition', cmd: 'slideSection', args: ['transition'], edit: true}
                ]},
                {label: this.textArrange, items: [
                    {k: 'arrange', t: stock('DocumentHolder.txtArrange'), i: 'toFront', twin: 'Toolbar:btnShapeArrange', sub: true, ids: ['0', '1', '2', '3'], edit: true, sel: OBJ},
                    /* Stock button name: "Align ▸" in "Format" — text. */
                    {k: 'alignObjects', t: stock('Toolbar.tipShapeAlign'), i: 'alignC', twin: 'Toolbar:btnShapeAlign', sub: true, edit: true, sel: OBJ},
                    {k: 'rotate', t: stock('DocumentHolder.textRotate'), i: 'rotateCw', twin: 'DocumentHolder:menuImgShapeRotate', sub: true, edit: true, sel: OBJ,
                        icons: [{cls: 'btn-rotate-90', i: 'rotateCw'}, {cls: 'btn-rotate-270', i: 'rotateCcw'},
                            {cls: 'btn-flip-hor', i: 'compare'}, {cls: 'btn-flip-vert', i: 'flipV'}]},
                    SEP,
                    {k: 'group', t: stock('DocumentHolder.txtGroup'), i: 'group', twin: 'Toolbar:mnuGroupShapes', edit: true, sel: OBJ,
                        why: 'textSelectTwoObjects', idle: 'textSelectTwoObjects'},
                    {k: 'ungroup', t: stock('DocumentHolder.txtUngroup'), i: 'ungroup', twin: 'Toolbar:mnuUnGroupShapes', edit: true, idle: 'textNotGroup'},
                    {k: 'shapesMerge', t: stock('DocumentHolder.textShapesMerge'), i: 'merge', twin: 'Toolbar:btnShapesMerge', sub: true, edit: true,
                        sel: ['shape'], why: 'textSelectTwoShapes', idle: 'textSelectTwoShapes'}
                ]},
                {label: stock('Toolbar.textTabCollaboration'), items: [
                    {k: 'sharing', t: this.textSharing, i: 'share', twin: 'Review:btnSharing', when: 'sharing'},
                    {k: 'coAuthMode', t: stock('Common.Views.ReviewChanges.txtCoAuthMode'), i: 'coauth', twin: 'Review:btnCoAuthMode', sub: true, edit: true},
                    {k: 'history', t: stock('Common.Views.ReviewChanges.txtHistory'), i: 'history', twin: 'Review:btnHistory', when: 'history'},
                    SEP,
                    {k: 'comments', t: stock('LeftMenu.tipComments'), twin: 'LeftMenu:btnComments', when: 'comments', check: 'twin'},
                    {k: 'commentResolve', t: stock('Common.Views.ReviewChanges.tipCommentResolve'), i: 'accept', twin: 'Review:btnCommentResolve', sub: true, edit: true},
                    {k: 'commentRemove', t: stock('Common.Views.ReviewChanges.tipCommentRem'), i: 'trash', twin: 'Review:btnCommentRemove', sub: true, edit: true}
                ]},
                {label: stock('FileMenu.btnHelpCaption'), items: [
                    {k: 'help', t: stock('FileMenu.btnHelpCaption'), i: 'help', h: 'F1', twin: 'FileMenu:miHelp', file: 'help'},
                    {k: 'about', t: stock('LeftMenu.tipAbout'), i: 'info', twin: 'LeftMenu:btnAbout', window: 'about'}
                ]}
            ];
        },

        /* An item by key (k) — for zones that call a catalog item. */
        item: function (k) {
            var found = null;
            var walk = function (list) {
                (list || []).some(function (it) {
                    if (!it || it.sep) return false;
                    if (it.k === k) { found = it; return true; }
                    return Array.isArray(it.sub) && walk(it.sub);
                });
                return !!found;
            };
            this.groups().some(function (g) { return walk(g.items); });
            return found;
        },

        /* --- Item state ----------------------------------------------------- */
        /* {disabled, reason, checked?, hidden?}. The order of reasons: the shell mode
           (CompactModes.reason), the edit right, the stock editing lock
           (itemLocked — without a reason), the selection, then the counterpart: its
           availability and visibility are stock. A command without an owner is inactive.
           An editing item without the right and in "Viewing" is not hidden by the stock hiding:
           it is visible but disabled, with a reason. */
        itemState: function (it, shell) {
            var st = {disabled: false, reason: null};
            if (!it || it.sep) return st;
            shell = shell || this.shell || PE.Views.CompactShell;
            if (it.check) st.checked = this.checked(it);

            var modes = PE.Views.CompactModes, why = null;
            try { why = modes && typeof modes.reason === 'function' ? modes.reason(it) : null; } catch (e) { why = null; }
            if (!why && (it.edit || it.needRight) && shell && typeof shell.editRight === 'function' && !shell.editRight())
                why = this.textNoEditRight;
            if (!why && this.itemLocked(it, shell)) {
                st.disabled = true;
                return st;
            }
            if (!why && it.sel && it.sel.indexOf(kind()) < 0)
                why = this[it.why || selectionWhy(it.sel)];
            if (why) {
                st.disabled = true;
                st.reason = why;
                return st;
            }

            if (it.cmd) {
                if (!shell || typeof shell.hasCommand !== 'function' || !shell.hasCommand(it.cmd)) st.disabled = true;
                return st;
            }
            var ref = it.ref || it.twin;
            if (!ref) return st;
            var s = bridge() ? bridge().state(ref) : {exists: false};
            if (!s.exists) {
                st.disabled = true;
            } else if (!s.visible) {
                st.disabled = true;
                st.hidden = true;
            } else if (s.disabled) {
                st.disabled = true;
                if (it.idle) st.reason = this[it.idle];
            }
            return st;
        },

        /* An item under the stock editing lock (CompactShell.lockState: version
           history, connection loss, signing). As in the documents catalog
           (DocumentActions.itemLocked), it is decided by the options set that the stock
           handed out: an item that edits the presentation is disabled by viewMode; one that opens
           a right-panel section — together with the stock right panel
           (rightMenu.disable); comments and chat — together with the stock panels
           (comments.disable, chat). The other shell commands — search, focus,
           "Hide Toolbar" — are alive: the lock is about the presentation, not
           about the shell chrome, and without them there is no way out of focus. The item has no reason — the stock disables silently, as in documents. */
        itemLocked: function (it, shell) {
            shell = shell || this.shell || PE.Views.CompactShell;
            var st = shell && typeof shell.lockState === 'function' ? shell.lockState() : null;
            if (!it || it.sep || !st || !st.on) return false;
            var o = st.options || {};
            if (it.cmd) {
                if (PANEL_CMDS.indexOf(it.cmd) >= 0) return !!(o.rightMenu && o.rightMenu.disable);
                if (it.cmd === 'addComment') return !!(o.comments && o.comments.disable);
                if (it.cmd === 'chat') return !!o.chat;
                return false;
            }
            return it.edit === true && !!o.viewMode;
        },

        /* Item mark: twin — the pressed state of the counterpart; thumbs — the thumbnail strip by
           the engine; slideHidden — the current slide is hidden; rightPanel — the right
           panel is open (driven by the SlideSections zone). */
        checked: function (it) {
            var B = bridge();
            switch (it.check) {
            case 'thumbs':
                if (this.thumbsShown !== null) return this.thumbsShown;
                var t = B && B.state('LeftMenu:btnThumbs');
                return t && t.exists ? !!t.pressed : true;
            case 'slideHidden':
                return !!this.slideHidden;
            case 'rightPanel':
                var sections = PE.Views.SlideSections;
                try { return !!(sections && typeof sections.isOpen === 'function' && sections.isOpen()); } catch (e) { return false; }
            default:
                return !!(B && it.twin && B.state(it.twin).pressed);
            }
        },

        /* --- Execution ------------------------------------------------------------ */
        /* One stock call by the item binding, with a repeated availability check:
           between showing the item and choosing it the stock code could have disabled it. Items with
           a submenu are not executed here, except a gallery: it is shown at anchor
           (the menu row), and if it cannot be shown — by a stock click of the counterpart. */
        exec: function (it, shell, anchor) {
            shell = shell || this.shell || PE.Views.CompactShell;
            if (!it || it.sep || Array.isArray(it.sub) || it.sub === true) return false;
            if (this.itemState(it, shell).disabled) return false;
            /* Thumbnail strip: the engine's ShowThumbnails does not send asc_onThumbnailsShow —
               the mark after the choice is driven by the choice itself. */
            if (it.check === 'thumbs') {
                var show = !this.checked(it);
                var done = this.run(it, shell, anchor);
                if (done) this.thumbsShown = show;
                return done;
            }
            return this.run(it, shell, anchor);
        },

        /* Stock call of an item without an availability check (it is done by exec). */
        run: function (it, shell, anchor) {
            var B = bridge();
            if (it.cmd) {
                var fn = shell.command(it.cmd);
                fn.apply(null, it.args || []);
                return true;
            }
            if (it.engine) {
                B.engine.apply(B, [it.engine].concat(this.engineArgs(it)));
                return true;
            }
            if (it.window && shell && typeof shell.hasCommand === 'function' && shell.hasCommand(it.window)) {
                shell.command(it.window)();
                return true;
            }
            if (!it.twin) return false;
            if (it.gallery) {
                var at = anchor || (shell && typeof shell.rowEl === 'function' && shell.rowEl('menubar'));
                return (!!at && B.gallery(it.twin, at, {align: 'tl-tr'})) || B.run(it.twin);
            }
            if (it.file) return this.fileItem(it);
            if (it.event) return B.run(it.twin, {event: it.event, args: it.args || []});
            var o = B.twin(it.twin);
            /* Item of the stock thumbnail menu with a mark: the stock menu
               sets the mark when it opens, from the slide, and we do the same, from the engine. */
            if (it.check === 'slideHidden' && o && typeof o.setChecked === 'function') o.setChecked(!!this.slideHidden, true);
            if (B.run(it.twin)) return true;
            /* Tab checkbox (Common.UI.CheckBox): its stock click is onItemCheck. */
            if (o && typeof o.onItemCheck === 'function' && !B.state(it.twin).disabled) {
                o.onItemCheck({});
                return true;
            }
            return false;
        },

        /* Arguments of the marked calls. */
        engineArgs: function (it) {
            switch (it.engine) {
            case 'LeftMenu.clickSaveAsFormat':
                var types = window.Asc && Asc.c_oAscFileType;
                return [SAVE_AS_MENU, types ? types[it.format] : it.format];
            case 'LeftMenu.clickMenuFileItem':
                /* Without a menu object: the stock handler after the action hides
                   the passed menu, while the menu row has its own closing. */
                return [null, it.action];
            case 'LeftMenu.onShowTumbnails':
                var B = bridge();
                return [B.twin('LeftMenu:btnThumbs'), !this.checked(it)];
            default:
                return [];
            }
        },

        /* A stock "File" item with a panel (info, rights, settings, help,
           protection): the panel opens the same way as the "File" tab and F1 —
           LeftMenu.showMenu('file:<panel>'). A click on the item itself does not
           fit here: the "File" items are caught by the menu markup ('click .fm-btn'), their
           onItemClick does not reach the stock 'item:click'. Actions without a panel
           (save, print, rename, download) are marked calls of the
           stock LeftMenu handlers, the counterpart has only visibility. */
        fileItem: function (it) {
            var B = bridge();
            var menu = B.ROOTS && B.ROOTS.FileMenu ? B.ROOTS.FileMenu() : null;
            var left = B.ROOTS && B.ROOTS.LeftMenu ? B.ROOTS.LeftMenu() : null;
            if (!menu || !menu.panels || !menu.panels[it.file] || !left || typeof left.showMenu !== 'function') return false;
            left.showMenu('file:' + it.file);
            return true;
        },

        /* --- Menu row ---------------------------------------------------------- */
        /* Section buttons are built once, the section composition — on every
           opening: rights, mode, selection and counterpart availability are read at
           that moment. A submenu (▸) from catalog items — the same rows, a counterpart
           submenu — a snapshot of its stock menu (StockBridge.mirror) at the moment of
           opening, a choice in it is a stock item click (StockBridge.pick).
           A gallery is the stock popup list of the counterpart at the row
           (StockBridge.gallery). A disabled item — the class vo-locked and
           aria-disabled, not the disabled attribute: the browser does not send click on a
           disabled button, and on the click the availability is rechecked. The reason is in the
           row tooltip before the press. Submenus live in the menu row itself, not
           inside the scrollable section list: its overflow would clip them. */

        menu: null,

        renderMenuBar: function (host) {
            if (!host) return null;
            var me = this;
            this.closeMenu();
            var prev = host.querySelector && host.querySelector('.vo-mn');
            if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

            var bar = node('div', 'vo-mn');
            bar.setAttribute('role', 'menubar');
            bar.setAttribute('aria-label', this.textMenuBar_ARIA);
            this.menu = {bar: bar, sections: [], open: -1, flies: [], gallery: null, timer: null};

            this.groups().forEach(function (g, index) {
                var wrap = node('div', 'vo-mn-wrap');
                wrap.setAttribute('role', 'none');
                var btn = node('button', 'vo-mn-item');
                btn.setAttribute('type', 'button');
                btn.setAttribute('role', 'menuitem');
                btn.setAttribute('aria-haspopup', 'menu');
                btn.setAttribute('aria-expanded', 'false');
                btn.setAttribute('tabindex', index === 0 ? '0' : '-1');
                btn.textContent = g.label;
                var drop = node('div', 'vo-mn-drop');
                drop.setAttribute('role', 'menu');
                drop.setAttribute('aria-label', g.label);
                drop.setAttribute('data-level', '0');
                me.bindWheel(drop);
                btn.addEventListener('click', guard('menu: section', function (e) {
                    stop(e);
                    /* Openness is read before closing: a repeated click on the same
                       button closes the section instead of blinking it. */
                    var open = me.menu.open !== index;
                    me.closeMenu();
                    if (open) me.openSection(index);
                }));
                /* A section is already open — hovering a neighbor switches the section. */
                btn.addEventListener('mouseenter', guard('menu: section hover', function () {
                    if (!me.menu || me.menu.open < 0 || me.menu.open === index) return;
                    me.closeMenu();
                    me.openSection(index);
                }));
                wrap.appendChild(btn);
                wrap.appendChild(drop);
                bar.appendChild(wrap);
                me.menu.sections.push({btn: btn, drop: drop});
            });
            host.appendChild(bar);
            this.bindDocument();
            return bar;
        },

        isMenuOpen: function () {
            return !!this.menu && this.menu.open >= 0;
        },

        openSection: function (index) {
            var me = this, s = this.menu && this.menu.sections[index];
            var g = s && this.groups()[index];
            if (!g) return;
            /* Open stock dropdown menus are closed, as on the opening
               of any stock menu. */
            var mm = Common.UI && Common.UI.Menu && Common.UI.Menu.Manager;
            if (mm && typeof mm.hideAll === 'function') mm.hideAll();
            this.primeStockMenus();
            /* The "File" screen lies under the menu row but above it on the stock layer
               scale: the section would open invisible under it. Opening a section
               closes the screen with the same call as the stock Esc
               (controller/LeftMenu.js). */
            var B = bridge();
            var left = B.ROOTS && B.ROOTS.LeftMenu ? B.ROOTS.LeftMenu() : null;
            var screen = left && left.menuFile;
            if (screen && typeof screen.isVisible === 'function' && screen.isVisible() && typeof screen.hide === 'function') screen.hide();
            s.drop.textContent = '';
            this.visibleItems(g.items).forEach(function (it) {
                s.drop.appendChild(it.sep ? me.sepNode() : me.menuRow(it, 0));
            });
            s.drop.scrollTop = 0;
            s.drop.classList.add('open');
            s.btn.classList.add('vo-open');
            s.btn.setAttribute('aria-expanded', 'true');
            this.menu.open = index;
        },

        /* The stock context menus of a slide, table and image set the visibility
           and availability of their items only in initMenu — on their own opening,
           from the selection and co-author locks at that moment. Section items
           taken by counterparts from these menus would, without a rebuild, read the state
           of the last context menu: "Duplicate", "Delete", "Hide"
           would disappear, locks would lag. The rebuild goes the same way as the
           stock onFocusObject (controller/DocumentHolder.js): the engine selection
           properties through fillMenuProps and initMenu of the menu. The slide menu —
           as from the thumbnail strip: the "Slide" section is about the current slide. The image
           menu is built only when there is an object in the selection: its initMenu
           reads the object properties without a check. A rebuild failure does not prevent
           opening the section. */
        primeStockMenus: function () {
            var dh = ctl('DocumentHolder'), view = dh && dh.documentHolder, api = dh && dh.api;
            if (!view || !api || typeof api.getSelectedElements !== 'function') return;
            var elements = api.getSelectedElements() || [];
            var init = function (menu, value) {
                if (!menu || !menu.options || typeof menu.options.initMenu !== 'function') return;
                try { menu.options.initMenu(value); } catch (e) { /* items stay as they were */ }
            };
            var types = window.Asc && Asc.c_oAscTypeSelectElement;
            var slideType = types && types.Slide !== undefined ? types.Slide : 7;
            var hidden = !!this.slideHidden;
            elements.forEach(function (el) {
                if (!el || typeof el.get_ObjectType !== 'function' || el.get_ObjectType() !== slideType) return;
                var v = el.get_ObjectValue && el.get_ObjectValue();
                if (v && typeof v.get_IsHidden === 'function') hidden = !!v.get_IsHidden();
            });
            /* The menu row always has a current slide while the presentation has slides. */
            var count = typeof api.getCountPages === 'function' ? api.getCountPages() : view.slidesCount;
            init(view.slideMenu, {isSlideSelect: count > 0, isSlideHidden: hidden, fromThumbs: true});
            var props = typeof dh.fillMenuProps === 'function' ? dh.fillMenuProps(elements) : null;
            var p = props && props.menu_props;
            if (!p) return;
            if (p.tableProps) init(view.tableMenu, p);
            if (p.imgProps || p.shapeProps || p.chartProps) init(view.pictureMenu, p);
        },

        /* Close the section, the submenu and the gallery at the row. */
        closeMenu: function () {
            var m = this.menu;
            if (!m) return;
            clearTimeout(m.timer);
            this.closeFlies(1);
            m.sections.forEach(function (s) {
                s.drop.classList.remove('open');
                s.btn.classList.remove('vo-open');
                s.btn.setAttribute('aria-expanded', 'false');
            });
            m.open = -1;
        },

        /* Recompute the states of the open section (mode change). */
        refreshMenu: function () {
            if (!this.isMenuOpen()) return;
            var index = this.menu.open;
            this.closeMenu();
            this.openSection(index);
        },

        /* Items that the stock editor does not hide; separators cleaned. */
        visibleItems: function (items) {
            var me = this;
            return cleanSeps((items || []).filter(function (it) {
                return it.sep || !me.itemState(it).hidden;
            }));
        },

        /* Row caption at the moment of opening. An item with liveCaption takes the current
           caption of the counterpart: the macro record button changes it itself. An empty
           caption or a missing counterpart — the t field. An already open row does not
           reread this caption. */
        label: function (it) {
            if (it && it.liveCaption) {
                var B = bridge();
                var text = B && typeof B.controlCaption === 'function' ? B.controlCaption(it.twin) : '';
                if (text) return text;
            }
            return it && it.t != null ? String(it.t) : '';
        },

        /* Catalog item row. On click — the other end of the check: the state
           is reread, and an item disabled in the meantime does not close the menu (in
           the stock menu a click on a disabled item does not close it either). */
        menuRow: function (it, level) {
            var me = this, st = this.itemState(it);
            var hasSub = !!(it.sub || it.gallery);
            var row = this.rowNode(this.label(it), glyph(it.i), hasSub, it.h, it.check ? !!st.checked : null);
            row.setAttribute('data-k', it.k || '');
            row.setAttribute('data-level', String(level));
            this.rowState(row, st);
            var act = guard('menu: item', function (e) {
                stop(e);
                var now = me.itemState(it);
                me.rowState(row, now);
                if (now.disabled) return;
                if (Array.isArray(it.sub)) { me.openFly(row, me.catalogRows(it, level + 1), level + 1); return; }
                if (it.sub) { me.openFly(row, me.mirrorRows(it, me.mirrorList(it), level + 1), level + 1); return; }
                if (it.gallery) { me.openGallery(row, it.twin, level + 1); return; }
                me.closeMenu();
                me.exec(it, me.shell);
            });
            row.addEventListener('click', act);
            row.addEventListener('mouseenter', guard('menu: hover', function () {
                me.hoverRow(row, level, hasSub ? act : null);
            }));
            return row;
        },

        /* Submenu rows from catalog items; an inline item — a snapshot of the menu of its
           counterpart right in this submenu (two stock alignment menus — as one). */
        catalogRows: function (it, level) {
            var me = this, out = [];
            this.visibleItems(it.sub).forEach(function (x) {
                if (x.sep) { out.push({sep: true}); return; }
                if (!x.inline) { out.push({row: me.menuRow(x, level)}); return; }
                if (me.itemState(x).disabled) return;
                me.mirrorRows(x, me.mirrorList(x), level).forEach(function (r) { out.push(r); });
            });
            return cleanSeps(out);
        },

        /* Snapshot of the stock menu of the counterpart; ids — only these items of the stock menu. */
        mirrorList: function (it) {
            var list = bridge().mirror(it.twin) || [];
            if (it.ids) list = list.filter(function (e) { return e.sep || it.ids.indexOf(String(e.id)) >= 0; });
            return cleanSeps(list);
        },

        mirrorRows: function (root, list, level) {
            var me = this;
            return (list || []).map(function (e) {
                return e.sep ? {sep: true} : {row: me.mirrorRow(e, root, level)};
            });
        },

        /* Snapshot row: icon by the icons table of the catalog item, caption,
           availability and mark of the stock item. Before the choice the availability
           of the parent item is reread: the stock menu of a disabled control
           cannot be opened. */
        mirrorRow: function (entry, root, level) {
            var me = this;
            var hasSub = !!(entry.sub || entry.gallery);
            var row = this.rowNode(entry.caption, mirrorGlyph(root, entry), hasSub, '', entry.checked ? true : null);
            row.setAttribute('data-id', entry.id);
            row.setAttribute('data-level', String(level));
            this.rowState(row, {disabled: entry.disabled});
            var act = guard('menu: submenu item', function (e) {
                stop(e);
                if (entry.disabled) return;
                var parent = me.itemState(root);
                if (parent.disabled) { me.rowState(row, parent); return; }
                if (entry.sub) { me.openFly(row, me.mirrorRows(root, entry.sub, level + 1), level + 1); return; }
                if (entry.gallery) { me.openGallery(row, bridge().itemRef(root.twin, entry.id), level + 1); return; }
                me.closeMenu();
                bridge().pick(root.twin, entry.id);
            });
            row.addEventListener('click', act);
            row.addEventListener('mouseenter', guard('menu: submenu hover', function () {
                me.hoverRow(row, level, hasSub && !entry.disabled ? act : null);
            }));
            return row;
        },

        /* Submenu to the right of the row, its first row level with it; if it does not fit at
           the window edge — to the left; vertically — within the window. */
        openFly: function (row, rows, level) {
            this.closeFlies(level);
            if (!rows || !rows.length) return;
            var me = this;
            var fly = node('div', 'vo-mn-drop vo-mn-fly open');
            fly.setAttribute('role', 'menu');
            fly.setAttribute('data-level', String(level));
            var cap = row.querySelector && row.querySelector('.vo-mn-t');
            if (cap) fly.setAttribute('aria-label', cap.textContent);
            this.bindWheel(fly);
            rows.forEach(function (r) { fly.appendChild(r.sep ? me.sepNode() : r.row); });
            this.menu.bar.appendChild(fly);
            this.menu.flies.push({level: level, el: fly, row: row});
            row.classList.add('vo-sub-open');
            row.setAttribute('aria-expanded', 'true');
            this.placeFly(fly, row);
        },

        placeFly: function (fly, row) {
            var br = this.menu.bar.getBoundingClientRect(), rr = row.getBoundingClientRect();
            var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
            var w = fly.offsetWidth || 0, h = fly.offsetHeight || 0;
            var left = rr.right - br.left - 2;
            if (vw && br.left + left + w > vw - 4) left = rr.left - br.left - w + 2;
            var top = rr.top - br.top - POP_PAD_Y;
            if (vh && br.top + top + h > vh - 4) top = vh - 4 - h - br.top;
            if (br.top + top < 4) top = 4 - br.top;
            fly.style.left = Math.round(left) + 'px';
            fly.style.top = Math.round(top) + 'px';
        },

        /* Stock gallery of the counterpart at the row, to the right of it. A choice in the gallery
           closes the menu; the stock code removed the gallery itself — the row is closed again. */
        openGallery: function (row, ref, level) {
            var me = this;
            this.closeFlies(level);
            var ok = !!ref && bridge().gallery(ref, row, {align: 'tl-tr', onClose: function (how) {
                row.classList.remove('vo-sub-open');
                row.setAttribute('aria-expanded', 'false');
                if (me.menu && me.menu.gallery && me.menu.gallery.row === row) me.menu.gallery = null;
                if (how === 'pick') me.closeMenu();
            }});
            if (!ok) return false;
            this.menu.gallery = {level: level, row: row};
            row.classList.add('vo-sub-open');
            row.setAttribute('aria-expanded', 'true');
            return true;
        },

        closeFlies: function (fromLevel) {
            var m = this.menu;
            if (!m) return;
            if (m.gallery && m.gallery.level >= fromLevel) bridge().closeGallery('close');
            var keep = [];
            m.flies.forEach(function (f) {
                if (f.level < fromLevel) { keep.push(f); return; }
                if (f.el.parentNode) f.el.parentNode.removeChild(f.el);
                f.row.classList.remove('vo-sub-open');
                f.row.setAttribute('aria-expanded', 'false');
            });
            m.flies = keep;
        },

        /* Hover: on an item with a submenu — open it after a delay, on the others —
           close the submenus deeper than this level. */
        hoverRow: function (row, level, open) {
            var me = this;
            clearTimeout(this.menu.timer);
            this.menu.timer = setTimeout(guard('menu: hover delay', function () {
                if (!me.menu) return;
                if (open) {
                    if (!row.classList.contains('vo-sub-open')) open();
                } else {
                    me.closeFlies(level + 1);
                }
            }), HOVER_DELAY);
        },

        /* List row: icon (no column if there is no icon), caption,
           keyboard shortcut on the right, mark, ▸. */
        rowNode: function (text, icon, hasSub, hint, checked) {
            var row = node('button', 'vo-mn-sub' + (hasSub ? ' vo-has-sub' : ''));
            row.setAttribute('type', 'button');
            row.setAttribute('tabindex', '-1');
            row.setAttribute('role', checked === null || checked === undefined ? 'menuitem' : 'menuitemcheckbox');
            if (checked !== null && checked !== undefined) row.setAttribute('aria-checked', checked ? 'true' : 'false');
            if (hasSub) {
                row.setAttribute('aria-haspopup', 'menu');
                row.setAttribute('aria-expanded', 'false');
            }
            var i = node('span', icon ? 'vo-mn-i' : 'vo-mn-i vo-mn-i-none');
            if (icon) i.innerHTML = icon;
            row.appendChild(i);
            var t = node('span', 'vo-mn-t');
            t.textContent = text || '';
            row.appendChild(t);
            if (hint) {
                var h = node('span', 'vo-mn-h');
                h.textContent = hint;
                row.appendChild(h);
            }
            if (checked) {
                var c = node('span', 'vo-mn-chk');
                c.innerHTML = glyph('checkMenu');
                row.appendChild(c);
            }
            if (hasSub) {
                var a = node('span', 'vo-mn-arrow');
                a.innerHTML = glyph('chevronR');
                row.appendChild(a);
            }
            return row;
        },

        sepNode: function () {
            var sep = node('div', 'vo-mn-sep');
            sep.setAttribute('role', 'separator');
            return sep;
        },

        /* Disabled row and its reason — before the press, as the row tooltip. */
        rowState: function (row, st) {
            var off = !!(st && st.disabled);
            if (off) row.classList.add('vo-locked'); else row.classList.remove('vo-locked');
            row.setAttribute('aria-disabled', off ? 'true' : 'false');
            if (st && st.reason) {
                row.setAttribute('title', st.reason);
                row.setAttribute('aria-description', st.reason);
            } else {
                row.removeAttribute('title');
                row.removeAttribute('aria-description');
            }
        },

        /* Wheel over the list: the stock editor suppresses wheel scrolling on
           the page, so a long list is scrolled by its own handler. */
        bindWheel: function (el) {
            el.addEventListener('wheel', guard('menu: wheel', function (e) {
                var max = (el.scrollHeight || 0) - (el.clientHeight || 0);
                if (!e || !(max > 0)) return;
                var dy = (e.deltaMode === 1 ? WHEEL_LINE : 1) * (e.deltaY || 0);
                el.scrollTop = Math.max(0, Math.min(max, (el.scrollTop || 0) + dy));
                if (e.preventDefault) e.preventDefault();
                stop(e);
            }), {passive: false});
        },

        /* A click outside the menu and its gallery and Esc close the menu; once per
           page. Esc with an open menu — only closes the menu. */
        docBound: false,

        bindDocument: function () {
            if (this.docBound || typeof document.addEventListener !== 'function') return;
            this.docBound = true;
            var me = this;
            document.addEventListener('mousedown', guard('menu: outside', function (e) {
                if (!me.isMenuOpen()) return;
                var t = e && e.target;
                if (t && me.menu.bar.contains(t)) return;
                var B = bridge();
                if (t && B && typeof B.galleryOwns === 'function' && B.galleryOwns(t)) return;
                me.closeMenu();
            }), true);
            document.addEventListener('keydown', guard('menu: escape', function (e) {
                if (!e || !me.isMenuOpen() || (e.key !== 'Escape' && e.keyCode !== 27)) return;
                if (e.preventDefault) e.preventDefault();
                stop(e);
                me.closeMenu();
            }), true);
            Common.NotificationCenter.on('shell:toolbar', guard('menu: rows', function () { me.closeMenu(); }));
        },

        /* --- Texts ------------------------------------------------------------- */
        /* The defaults are English, the translation overlays them from locale/<language>.json.
           Captions of stock commands are taken from stock objects (stock()). */

        textMenuBar_ARIA: 'Menu',

        textAdvancedSettings: 'Advanced settings',
        textArrange: 'Arrange',
        textBackground: 'Background',
        textBulletsNumbering: 'Bullets and numbering',
        textCase: 'Case',
        textClearFormatting: 'Clear formatting',
        textColorScheme: 'Color scheme',
        textDocInfo: 'Document info',
        textDocLanguage: 'Document language',
        textDownload: 'Download',
        textEdit: 'Edit',
        textFindReplace: 'Find and replace',
        textFocusMode: 'Focus mode',
        textFormat: 'Format',
        textHideToolbar: 'Hide toolbar',
        textIgnoreAll: 'Ignore all',
        textMoveSlide: 'Move slide',
        textNoEditRight: 'No permission to edit',
        textNoMacroRecording: 'No macro is being recorded',
        textNotGroup: 'The selection is not a group',
        textNothingToRedo: 'Nothing to redo',
        textNothingToUndo: 'Nothing to undo',
        textNoUnsavedChanges: 'No unsaved changes',
        textObjectProperties: 'Object settings',
        textPlaceCursor: 'Place the cursor in text',
        textSelectImage: 'Select an image',
        textSelectObject: 'Select an object on the slide',
        textSelectObjectOrText: 'Select an object or text',
        textSelectTable: 'Select a table',
        textSelectText: 'Select text',
        textSelectTwoObjects: 'Select two or more objects',
        textSelectTwoShapes: 'Select two or more shapes',
        textSharing: 'Sharing settings',
        textSlide: 'Slide',
        textSpelling: 'Spelling',
        textSubscript: 'Subscript',
        textSuperscript: 'Superscript',
        textText: 'Text',
        textTransition: 'Transition',
        textUnderline: 'Underline'

    }, PE.Views.SlideActions || {});

    return PE.Views.SlideActions;
});
