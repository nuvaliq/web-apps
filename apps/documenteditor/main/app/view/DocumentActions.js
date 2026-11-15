/*
 * DocumentActions — the catalog of editor actions in the compact shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * A single list of what the product can do and a single way to call it. From here
 * the menu bar and the "/" menu (SLASH) are built, and from here the toolbar
 * and bubble buttons call their commands (runCommand): one command — one behavior.
 * The catalog does not call the toolbar.
 *
 * The actions are stock, except three scripts (see below). The heavy lifting lives
 * in ready-made dialogs that are preloaded by the list in app_dev.js and
 * app_pack.js and constructed directly: they need only the api and a handler.
 * The ribbon is not needed for this — it is the same launch pad as this menu.
 *
 * The items are described in the form of the shared menu bar model (Common.UI.Compact.
 * MenuModel): an item without a right is absent (when), an item without a stock call is shown
 * disabled (needs), a temporarily unavailable item is disabled with a reason
 * (disabled). How an item looks and executes is decided by the shared menu bar
 * through the Documents adapter (CompactMenuAdapter).
 *
 * The "About" window is not a stock dialog but the shared compact window
 * (common/main/lib/view/compact/AboutWindow.js): it is not in the stock preload
 * lists, so it is pulled in by the define below.
 *
 * Three items are not done by a stock call — paste without formatting, a shape
 * and a text box at the caret, the page number in all headers and footers. They edit
 * the document with a script (SCRIPTS) through CompactScript: as one engine action,
 * which is either applied entirely or changes nothing.
 */
define([
    'common/main/lib/view/compact/AboutWindow',
    'documenteditor/main/app/view/CompactScript',
    'documenteditor/main/app/view/CompactBookmarks',
    'documenteditor/main/app/view/CompactWatermark'
], function () {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    DE.Views.DocumentActions = _.extend({

        api: null,
        shell: null,
        /* The last thing the engine reported about the selection (init). */
        sel: {},

        init: function (api, shell) {
            var me = this;
            /* The engine reports zoom only by an event (the api has no getter of the percent and mode),
               so we keep the last event ourselves — anew with a new api:
               the former one does not relate to it.

               The same for style marks, style, alignment and line spacing
               of the current selection: the engine broadcasts them by events on every
               caret movement, and with them the toolbar (CompactToolbar.bindApi)
               and the ribbon (controller/Toolbar.js,
               onApiBold … onApiLineSpacing) drive their marks. The api has no separate
               getter of the paragraph style at all. */
            if (api !== this.api) {
                this.zoomNow = null;
                this.sel = {};
                if (api && typeof api.asc_registerCallback === 'function') {
                    var on = function (name, fn) {
                        try { api.asc_registerCallback(name, fn); } catch (e) { /* no callback */ }
                    };
                    var sel = this.sel;
                    on('asc_onZoomChange', function (percent, type) {
                        me.zoomNow = {percent: percent, type: type};
                    });
                    on('asc_onBold',          function (v) { sel.bold = !!v; });
                    on('asc_onItalic',        function (v) { sel.italic = !!v; });
                    on('asc_onUnderline',     function (v) { sel.underline = !!v; });
                    on('asc_onStrikeout',     function (v) { sel.strikeout = !!v; });
                    on('asc_onVerticalAlign', function (v) { sel.baseline = v; });
                    on('asc_onParaStyleName', function (name) { sel.style = name; });
                    on('asc_onPrAlign',       function (v) { sel.align = v; });
                    /* The spacing value is meaningful only with the "multiple" rule
                       (controller/Toolbar.js, onApiLineSpacing); otherwise — none
                       of the list values. */
                    on('asc_onParaSpacingLine', function (sp) {
                        var auto = (window.Asc && Asc.linerule_Auto !== undefined) ? Asc.linerule_Auto : 1;
                        sel.line = (sp && typeof sp.get_Line === 'function' && sp.get_Line() !== null &&
                                    sp.get_LineRule() === auto) ? sp.get_Line() : null;
                    });
                    /* The protection is edited by a co-author — "Remove protection…" is held like the stock
                       protection button (view/DocProtection.js, protectLock). A wrong
                       password is reported by the engine as an error — it is needed by the password window. */
                    this.protectLock = false;
                    on('asc_onLockDocumentProtection', function (state) { me.protectLock = !!state; });
                    on('asc_onError', function (id) { me.onUnprotectError(id); });
                }
            }
            /* The password window closes when there is no protection anymore: the stock protection
               controller sends protect:doclock on every change of it — and after
               a wrong password too (the engine repeats the previous protection), so
               it is decided not by the event itself but by the protection in the api. The subscription is one per module,
               the event goes to the open window. */
            if (!this.doclockBound && window.Common && Common.NotificationCenter) {
                this.doclockBound = true;
                Common.NotificationCenter.on('protect:doclock', function () { me.onProtectionChange(); });
            }
            this.api = api;
            this.shell = shell;
            /* The item scripts go through the same api. */
            if (DE.Views.CompactScript) DE.Views.CompactScript.init(api);
            return this;
        },

        /* --- Helper ------------------------------------------------ */

        has: function (method) {
            return typeof this.api[method] === 'function';
        },

        /* The engine's answer to a question without arguments (whether there is anything to undo, whether
           paragraph marks are on): true or false, and without such a call — undefined,
           and then the item is neither disabled nor marked by a guess. */
        ask: function (method) {
            var api = this.api;
            if (!api || typeof api[method] !== 'function') return undefined;
            try { return !!api[method](); } catch (e) { return undefined; }
        },

        /* Editing is hindered by a content control: a content editing prohibition,
           a checkbox, a picture, a dropdown list, a form field outside form filling —
           the same cases in which the engine does not allow pasting. whole — look at the whole
           selection that the paste will replace, otherwise — the elements at the caret. The answer
           is given by the engine document (sdtLocked); without it — the properties of the element nearest to the
           caret, as in the stock ribbon (controller/Toolbar.js). */
        controlLocked: function (whole) {
            var api = this.api, doc = null;
            try {
                doc = typeof api.getLogicDocument === 'function' ? api.getLogicDocument() : null;
            } catch (e) {
                doc = null;
            }
            if (doc && typeof doc.GetSelectedElementsInfo === 'function') {
                try { return this.sdtLocked(doc, !!whole); } catch (e) { /* the element properties will answer */ }
            }
            if (this.ask('asc_IsContentControl') !== true || typeof api.asc_GetContentControlProperties !== 'function')
                return false;
            var props;
            try { props = api.asc_GetContentControlProperties(); } catch (e) { return false; }
            if (!props) return false;
            var L = Asc.c_oAscSdtLockType, T = Asc.c_oAscContentControlSpecificType;
            var lock = typeof props.get_Lock === 'function' ? props.get_Lock() : undefined;
            if (L && (lock === L.SdtContentLocked || lock === L.ContentLocked)) return true;
            var type = typeof props.get_SpecificType === 'function' ? props.get_SpecificType() : undefined;
            return !!T && (type === T.CheckBox || type === T.Picture || type === T.DropDownList);
        },

        /* The rule by which the engine checks the selection's content controls
           before pasting (Document_Is_SelectionLocked in sdkjs
           word/Editor/StructuredDocumentTags/InlineLevel.js and BlockLevel.js):
           an element touched partially or with the caret inside, and also one selected
           entirely alone, must allow editing (CanBeEdited); one selected
           entirely together with other text will be deleted by the paste — it must allow
           deletion (CanBeDeleted). whole — all selection elements
           (CheckAllSelection), otherwise — at the caret; enclosing ones are included in the answer.
           The engine's own check (IsSelectionLocked) is not called from here: in co-editing
           it requests locks from the server. Without closures: tests
           execute the function in the engine, and the pastePlain script repeats it. */
        sdtLocked: function (doc, whole) {
            var sel = doc.IsSelectionUse(), info = doc.GetSelectedElementsInfo();
            var sdts = whole ? doc.GetSelectedElementsInfo({CheckAllSelection: true}).GetAllSdts() : info.GetAllSdts();
            for (var n = 0; n < sdts.length; n++) {
                var sdt = sdts[n];
                var gone = whole && sel && sdt.IsSelectedAll()
                    && info.GetInlineLevelSdt() !== sdt && info.GetBlockLevelSdt() !== sdt;
                if (gone ? !sdt.CanBeDeleted() : !sdt.CanBeEdited()) return true;
            }
            return false;
        },

        options: function () {
            var main = DE.getController('Main');
            return (main && main.appOptions) || {};
        },

        /* The session rights: editing (isEdit, canEdit), review (canReview) and
           commenting (canComments). While a prohibition is in effect, the stock code removes them from the
           shared appOptions, and keeps the previous values for itself until the prohibition is lifted:
           isEdit and canEdit — the left menu, when the prohibition disables it (its own "Viewing",
           loss of connection; controller/LeftMenu.js, SetDisabled); canReview and
           canComments — the review and comment controllers in their own
           preview mode (any prohibition and some kinds of protection; lib/controller/
           ReviewChanges.js and Comments.js, updatePreviewMode). The right does not change
           with the prohibition: the menu is not rebuilt by it, items are disabled by the reason. */
        rights: function () {
            var o = this.options(), lm = DE.getController('LeftMenu');
            var held = !!(lm && lm.leftMenu && lm.leftMenu._state && lm.leftMenu._state.disabled === true &&
                lm.previsEdit !== undefined && lm.prevcanEdit !== undefined);
            function kept(ctl, name) {
                var prev = ctl && ctl.viewmode === true ? ctl['prev' + name] : undefined;
                return prev !== undefined ? !!prev : !!o[name];
            }
            return {
                isEdit: held ? !!lm.previsEdit : !!o.isEdit,
                canEdit: held ? !!lm.prevcanEdit : !!o.canEdit,
                canReview: kept(DE.getController('Common.Controllers.ReviewChanges'), 'canReview'),
                canComments: kept(DE.getController('Common.Controllers.Comments'), 'canComments')
            };
        },

        /* The document information lives not in appOptions but in editorConfig.document —
           the file menu takes it from the same place (FileMenu.js:647). */
        doc: function () {
            var main = DE.getController('Main');
            return (main && main.document) || null;
        },

        done: function () {
            Common.NotificationCenter.trigger('edit:complete');
        },

        /* The product help by the interface language: ru and ru-* lead to .ru, any
           other language — to .com. The help address rule in the desktop bundle
           (the same as About.helpUrl of the mobile one): it is opened by "File → Help"
           and F1. */
        helpUrl: function (lang) {
            return /^ru(?:[-_]|$)/i.test(lang || '') ?
                'https://helpdesk.bitrix24.ru/' : 'https://helpdesk.bitrix24.com/';
        },

        /* The help article about working with documents for the item "Editor
           help": the Russian one — for the Russian interface, the English one — for
           any other language, by the same language rule as helpUrl.
           The help home page is not suitable here — it is a list of sections.
           The address is changed here, and only here: when an article about the compact
           editor appears — this pair is edited. */
        HELP_URL: {
            ru: 'https://helpdesk.bitrix24.ru/open/19629424/',
            en: 'https://helpdesk.bitrix24.com/open/20606316/'
        },

        editorHelpUrl: function (lang) {
            return /^ru(?:[-_]|$)/i.test(lang || '') ? this.HELP_URL.ru : this.HELP_URL.en;
        },

        /* The languages of the built-in help that ships with the editor
           (resources/help/<language>/, copied by the build, build/documenteditor.json).
           The tab opens at once on click, and it is impossible to ask the server whether
           a page exists beforehand — hence the list; it is checked against the help catalog
           by help-url.cjs. */
        HELP_LANGS: ['de', 'en', 'es', 'fr', 'it', 'pt', 'ru', 'sr-Latn', 'tr'],

        /* The "Keyboard shortcuts" page of the built-in help in the interface language:
           the help language fits if it matches the whole language or
           its part before the hyphen (pt-BR → pt, sr-Latn-RS → sr-Latn); if there is no help
           in this language — the English one. The address is relative, from the editor
           page, as in the stock help panel (FileMenuPanels.js). */
        shortcutsUrl: function (lang) {
            var code = String(lang || '').replace(/_/g, '-').toLowerCase(), pick = 'en', size = 0;
            this.HELP_LANGS.forEach(function (name) {
                var l = name.toLowerCase();
                if ((code === l || code.indexOf(l + '-') === 0) && l.length > size) { pick = name; size = l.length; }
            });
            return 'resources/help/' + pick + '/HelpfulHints/KeyboardShortcuts.htm';
        },

        /* The dialogs are arranged the same way: a constructor with api and handler, show,
           then setSettings with the current document properties. The order matters —
           the stock code calls setSettings everywhere after show. */
        dialog: function (name, config, settings) {
            var Ctor = DE.Views[name] || (window.Common && Common.Views && Common.Views[name]);
            if (!Ctor) return null;
            var win = new Ctor(config);
            win.show();
            if (settings !== undefined && win.setSettings) win.setSettings(settings);
            return win;
        },

        download: function (type) {
            this.api.asc_DownloadAs(new Asc.asc_CDownloadOptions(type));
        },

        /* Main rechecks the rights and manages the protected web print.
           The original UA option is kept for the stock Desktop path. */
        print: function () {
            var U = Common.Utils;
            return DE.getController('Main').requestPrint(new Asc.asc_CDownloadOptions(null,
                U.isChrome || U.isOpera || U.isGecko && U.firefoxVersion > 86), this.api);
        },

        /* Download and print for the "Download" button in the header
           (CompactShell.buildDownload). The rights are the same as for the items "File →
           Download as" and "File → Print" in sections().

           These are file menu screens, and the stock code under a prohibition touches it only
           with three keys (FileMenu.SetDisabled: protect, history, info). Print
           also has its own twin in the ribbon: btnPrint,
           `lock: [cantPrint, disableOnStart]` — not one of our reasons.
           So `lock:` is empty for all four.

           The rights are an axis separate from `lock:`, and static: the stock code derives them
           once from the document permissions (controller/Main.js:1734 canPrint,
           :1764 canDownload) and does not recompute them. The presence of the method in the api
           is not enough for them: without these gates the items stayed alive at
           permissions.download === false, and "Print" gave the PDF bypassing
           the download prohibition.

           An item disabled by rights is false, not a skip: the header removes
           such ones with a filter. We take the file type at the moment of
           the click, not of the build: Asc.c_oAscFileType is needed only by the
           download itself. */
        exportItems: function () {
            var me = this, opts = this.options();
            var dl = !!(opts.canDownload && me.has('asc_DownloadAs'));
            function down(t, type) {
                return dl && {t: t, i: 'download', lock: me.LOCK_SAFE,
                    run: function () { me.download(Asc.c_oAscFileType[type]); }};
            }
            return {
                docx:  down(me.textDownloadDocx, 'DOCX'),
                pdf:   down(me.textDownloadPdf, 'PDF'),
                odt:   down(me.textDownloadOdt, 'ODT'),
                print: !!(opts.canPrint && me.has('asc_Print')) &&
                    {t: me.textPrint, i: 'print', lock: me.LOCK_SAFE, run: function () { me.print(); }}
            };
        },

        /* --- The editing prohibition ---------------------------------------------------- */
        /* The menu bar items are disabled by reason codes (sections(), disabled). The shell surfaces
           outside the menu bar — the "Download" button in the header, opening the properties
           panel — ask the prohibition by the `lock:` arrays below.

           The reasons for the prohibition are not ours: they are distributed by the stock code with the notification
           `editing:disable`, and the state is held by CompactShell (see lockState there).
           Here is only which surface is disabled by which reason.
           The storage method is the same as in the stock code: a `lock:` array next to the command
           itself, like buttons in app/view/Toolbar.js.

           The names in the array are keys of the very payload that arrives
           with the event, not a list of ours:
             viewMode      — loss of connection (controller/Main.js, disableEditing);
             viewDocMode   — the "Viewing" mode (Main.onDocModeApply with force);
             reviewMode    — review preview
                             (lib/controller/ReviewChanges.js, disableEditing);
             fillFormMode  — form filling (app/controller/FormsTab.js);
             navigation, comments, chat, rightMenu — surfaces: the stock code disables them
                             BY ITS OWN keys, and an item leading to a stock panel
                             must be disabled together with the panel, not by the mode
                             (in "Viewing" navigation is alive in the stock code, on loss of
                             connection — it is not).

           An item with no array edits the document and is disabled by any of the
           four reasons (LOCK_EDIT). Four is enough: each of the five
           senders, prohibiting editing, raises exactly one of these flags
           (Main.disableEditing, MailMergeSettings and SignatureSettings — viewMode;
           Main.onDocModeApply — viewDocMode; ReviewChanges — reviewMode;
           FormsTab — fillFormMode), that is, there is no event without a single flag.
           LOCK_SAFE is an empty array: the item lives always, and there are exactly
           as many such items as found a live twin in the stock code. */

        /* Document protection adds three more to the four mode flags:
           docLockView, docLockComments and docLockForms. They come from
           CompactShell.lockByProtection under the same names by which the stock code disables
           its controls (controller/Toolbar.js, onChangeProtectDocument), and
           mean the same — there is no free editing in the document anymore.
           docLockReview is NOT in this set: under the "tracked
           changes only" protection editing is allowed, and it must disable
           exactly the review controls, not the whole catalog. */

        LOCK_EDIT: ['viewMode', 'viewDocMode', 'reviewMode', 'fillFormMode',
                    'docLockView', 'docLockComments', 'docLockForms'],
        LOCK_SAFE: [],
        /* Review: its own protection plus all editing prohibition reasons. */
        LOCK_REVIEW: ['viewMode', 'viewDocMode', 'reviewMode', 'fillFormMode',
                      'docLockView', 'docLockComments', 'docLockForms', 'docLockReview'],
        /* A comment is not a document edit, and its set is the stock one: in
           btnsComment `lock:` there are docLockView and docLockForms, but
           docLockComments is NOT there (controller/Toolbar.js:4084-4088) — the
           "comments only" protection allows commenting. */
        LOCK_COMMENT: ['viewMode', 'viewDocMode', 'reviewMode', 'fillFormMode',
                       'docLockView', 'docLockForms'],
        /* The class of prohibitions with the viewMode flag: loss of connection, merge preview,
           signature. What they have in common is that the stock code puts a mask on the whole ribbon
           (controller/Toolbar.js, DisableToolbar), and even a control
           without its own reason in `lock:` turns out dead. */
        LOCK_VIEW_MODE: ['viewMode'],

        lockActive: function (name, opts) {
            opts = opts || {};
            if (name === 'navigation') return !!(opts.navigation && opts.navigation.disable);
            if (name === 'comments')   return !!(opts.comments && opts.comments.disable);
            if (name === 'chat')       return !!opts.chat;
            if (name === 'rightMenu')  return !!(opts.rightMenu && opts.rightMenu.disable);
            return !!opts[name];
        },

        /* The second end of the gate is located in the surface click handler: the look is led by
           an observer of the event, and an event can pass between its firing and the click —
           the same rule as for setDocMode. */
        itemLocked: function (it) {
            var me = this;
            var shell = this.shell || DE.Views.CompactShell;
            var st = (shell && shell.lockState) ? shell.lockState() : null;
            /* Before, there was an exit by `!st.on` here. It is right for the editing
               prohibition, but the "tracked changes only" protection does not declare an editing
               prohibition — it gives one flag docLockReview at
               `on === false` (CompactShell.lockByProtection). So
               we ask the keys themselves: with empty options none is raised,
               and the loop below likewise gives false. */
            if (!st) return false;
            var lock = it && it.lock;
            if (typeof lock === 'function') lock = lock();
            lock = lock || this.LOCK_EDIT;
            for (var i = 0; i < lock.length; i++) {
                if (me.lockActive(lock[i], st.options)) return true;
            }
            return false;
        },

        /* --- The menu bar sections ---------------------------------------------- */
        /* The catalog is the menu bar sections in order, the items in the shared model form
           (Common.UI.Compact.MenuModel): k — the key, unique across the whole menu; when —
           whether there is the right and capability (no — no item); needs — the stock call without
           which the item stays in place disabled; disabled — the reason codes by which
           the item is unavailable now; sc — the name of the shortcut in the stock registry;
           run — execution. Separators, empty sections and submenus are removed by the model.

           The item functions read ctx, which is assembled by the menu bar adapter
           (CompactMenuAdapter.context): the document rights and settings — canEdit() and
           options(); the common disable reasons — edit(kind) for editing items and net(kind)
           for items that need only a connection; on(code) — whether one
           common reason is in effect; has(name) — whether a stock call exists. */

        sections: function () {
            var me = this;
            var api = function () { return me.api; };
            var shell = function () { return me.shell; };
            var opts = function (c) { return c.options(); };
            var edit = function (c) { return c.canEdit(); };
            var lockEdit = function (c) { return c.edit(); };
            /* Insert at the caret: also a content control that cannot be edited
               (controlLocked). Insert with replacement of the selection looks at the whole selection. */
            var lockInsert = function (c) {
                return [].concat(c.edit() || [], me.controlLocked() ? 'controlLocked' : []);
            };
            var lockReplace = function (c) {
                return [].concat(c.edit() || [], me.controlLocked(true) ? 'controlLocked' : []);
            };

            /* The format caption is its name, except those where the name is not enough: "HTML (ZIP archive)". */
            function download(k, type, t) {
                return {k: 'file.download.' + k, t: t || type, i: 'download', needs: 'asc_DownloadAs',
                    disabled: function (c) { return c.net('download'); },
                    run: function () { me.download(Asc.c_oAscFileType[type]); }};
            }

            /* Zoom: fixed values and two fit modes — options of one
               group. The active one is marked: a mode while it is in effect (the zoom event
               type is 1 or 2), a value — only outside a mode and on an exact
               match. Leaving a mode is choosing another option. */
            function zoomTo(percent) {
                return {k: 'view.zoom.' + percent, t: me.textMenuZoomPercent.replace('{0}', percent), kind: 'radio',
                    needs: 'zoom',
                    checked: function () { var z = me.zoomState(); return z.type === 0 && z.percent === percent; },
                    run: function () { api().zoom(percent); me.done(); }};
            }
            function zoomFit(k, t, type, method) {
                return {k: 'view.zoom.' + k, t: t, kind: 'radio', needs: method,
                    checked: function () { return me.zoomState().type === type; },
                    run: function () { api()[method](); me.done(); }};
            }

            /* The table size grid is a row of its own in the "Table" submenu: it is drawn by tableGrid,
               when the menu bar builds the submenu (adapter, openRow). Execution — run with
               the chosen size, it is called by the grid itself. */
            var tableGrid = {k: 'insert.table.grid', t: me.txtTableGrid_ARIA, kind: 'widget', needs: 'put_Table',
                disabled: lockEdit,
                render: function (row) { me.tableGrid(row, tableGrid); },
                run: function (size) {
                    if (!size || !(size.columns > 0 && size.rows > 0)) return;
                    api().put_Table(size.columns, size.rows);
                    me.done();
                }};

            /* The page number position — right in all headers and footers of the document
               (pageNumberAt). */
            function pageNumberAt(pos, t) {
                return {k: 'insert.pageNumber.' + pos, t: t, needs: 'callCommand', disabled: lockEdit,
                    run: function () { me.pageNumberAt(pos); }};
            }

            function noToc(c) {
                return [].concat(c.edit() || [], me.hasToc() === false ? 'noToc' : []);
            }

            function inControl(c) {
                return [].concat(c.edit() || [], me.ask('asc_IsContentControl') === false ? 'notInField' : []);
            }

            function control(kind, t, method, add) {
                return {k: 'insert.control.' + kind, t: t, needs: method, disabled: lockEdit,
                    run: function () { add(api()); me.done(); }};
            }

            function shape(type, t) {
                return {k: 'insert.shape.' + type, t: t, needs: 'callCommand', disabled: lockInsert,
                    run: function () { me.insertShape(type); }};
            }

            /* --- Format ---------------------------------------------------------- */
            /* Style marks — toggles by selection: the mark is the last engine event
               (sel), the choice sends the opposite, like the toolbar buttons.
               Superscript and subscript are one engine property
               (put_TextPrBaseline): removing the marked one returns the normal line. */
            function textToggle(name, t, method, sc) {
                return {k: 'format.text.' + name, t: t, i: name === 'strikeout' ? 'strike' : name, kind: 'check',
                    sc: sc, needs: method, disabled: lockEdit,
                    checked: function () { return !!me.sel[name]; },
                    run: function () { api()[method](!me.sel[name]); me.done(); }};
            }
            function baseline(name, t, value, i) {
                var on = function () { return window.Asc && me.sel.baseline === Asc[value]; };
                return {k: 'format.text.' + name, t: t, i: i, kind: 'check', needs: 'put_TextPrBaseline',
                    disabled: lockEdit, checked: on,
                    run: function () {
                        api().put_TextPrBaseline(on() ? Asc.vertalign_Baseline : Asc[value]);
                        me.done();
                    }};
            }

            function changeCase(name, t, type) {
                return {k: 'format.case.' + name, t: t, needs: 'asc_ChangeTextCase', disabled: lockEdit,
                    run: function () { me.changeCase(type); }};
            }

            /* The style names are internal, English: put_Style expects them, and the same ones are
               sent by asc_onParaStyleName. */
            function paraStyle(name, t, style, i) {
                return {k: 'format.style.' + name, t: t, i: i, kind: 'radio', needs: 'put_Style',
                    disabled: lockEdit,
                    checked: function () { return me.sel.style === style; },
                    run: function () { api().put_Style(style); me.done(); }};
            }

            /* The engine numbers: 1 — left, 2 — center, 0 — right, 3 —
               justified (controller/Toolbar.js, onHorizontalAlign). The visible alignment is
               marked — as for the toolbar button (alignNow). */
            function align(name, t, value, sc, i) {
                return {k: 'format.align.' + name, t: t, i: i, kind: 'radio', sc: sc, needs: 'put_PrAlign',
                    disabled: lockEdit,
                    checked: function () { return me.alignNow() === value; },
                    run: function () { api().put_PrAlign(value); me.done(); }};
            }

            /* The values are the same as for the line spacing of the toolbar and
               the ribbon; the comparison is with a tolerance, like theirs: the engine sends a fraction with
               the binary fraction error. */
            function lineSpacing(value) {
                var t = value.toFixed(value === 1.15 ? 2 : 1).replace('.', me.textMenuDecimalSeparator);
                return {k: 'format.spacing.' + Math.round(value * 100), t: t, kind: 'radio', needs: 'put_PrLineSpacing',
                    disabled: lockEdit,
                    checked: function () {
                        return typeof me.sel.line === 'number' && Math.abs(me.sel.line - value) < 0.0001;
                    },
                    run: function () {
                        var auto = (window.Asc && Asc.linerule_Auto !== undefined) ? Asc.linerule_Auto : 1;
                        api().put_PrLineSpacing(auto, value);
                        me.done();
                    }};
            }
            /* Spacing before and after a paragraph: the caption and the command depend on whether
               it exists now, as in the ribbon (controller/Toolbar.js, onLineSpaceShow). */
            function spaceAround(side, add, remove) {
                var Side = side === 'before' ? 'Before' : 'After';
                var have = function () { return me.ask('asc_haveSpace' + Side + 'Paragraph') === true; };
                return {k: 'format.spacing.' + side, needs: 'asc_addSpace' + Side + 'Paragraph', disabled: lockEdit,
                    t: function () { return have() ? remove : add; },
                    run: function () {
                        api()[(have() ? 'asc_removeSpace' : 'asc_addSpace') + Side + 'Paragraph']();
                        me.done();
                    }};
            }

            /* The list kind — like the toolbar lists button: subtype 0 is
               "just a kind", a multilevel list has no zero one, the first one is taken
               (1) a) i)). A repeated choice of the marked one removes the list (subtype -1). */
            function listType(name, t, type, sub, i) {
                return {k: 'format.lists.' + name, t: t, i: i, kind: 'radio', needs: 'put_ListType',
                    disabled: lockEdit,
                    checked: function () { return me.listType() === type; },
                    run: function () {
                        api().put_ListType(type, me.listType() === type ? -1 : sub);
                        me.done();
                    }};
            }
            function numbering(name, t, preset) {
                return {k: 'format.numbering.' + name, t: t, kind: 'radio', needs: 'put_ListTypeCustom',
                    disabled: lockEdit,
                    checked: function () { return me.isListPreset(preset); },
                    run: function () { api().put_ListTypeCustom(preset.json); me.done(); }};
            }
            function inList(c) {
                return [].concat(c.edit() || [], me.inList() === false ? 'notInList' : []);
            }

            function inTable(c) {
                return [].concat(c.edit() || [], me.ask('asc_IsTable') === false ? 'notInTable' : []);
            }
            function tableCmd(name, t, method, i) {
                return {k: 'format.table.' + name, t: t, i: i, needs: method, disabled: inTable,
                    run: function () { api()[method](); me.done(); }};
            }

            function hasObject(c) {
                return [].concat(c.edit() || [], me.imageProps() === null ? 'noObject' : []);
            }
            function wrap(name, t, style, i) {
                return {k: 'format.image.' + name, t: t, i: i, kind: 'radio', needs: 'ImgApply', disabled: hasObject,
                    checked: function () {
                        var props = me.imageProps(), W = window.Asc && Asc.c_oAscWrapStyle2;
                        return !!(props && W && typeof props.get_WrappingStyle === 'function' &&
                                  props.get_WrappingStyle() === W[style]);
                    },
                    run: function () { me.wrap(style); }};
            }
            function arrange(name, t, level, i) {
                return {k: 'format.image.' + name, t: t, i: i, needs: 'ImgApply', disabled: hasObject,
                    run: function () { me.arrange(level); }};
            }

            function orientation(name, t, portrait, i) {
                return {k: 'format.orientation.' + name, t: t, i: i, kind: 'radio', needs: 'change_PageOrient',
                    disabled: lockEdit,
                    checked: function () { return me.isPortrait() === portrait; },
                    run: function () { api().change_PageOrient(portrait); me.done(); }};
            }
            /* The ready-made sizes are in portrait orientation, as in the ribbon: change_DocSize
               itself rotates them for landscape (sdkjs word/api.js, change_DocSize). */
            function pageSize(name, t, size) {
                return {k: 'format.pageSize.' + name, t: t, kind: 'radio', needs: 'change_DocSize',
                    disabled: lockEdit,
                    checked: function () { return me.pageSizeIs(size); },
                    run: function () { me.applyPageSize(size); }};
            }
            function margins(name, t, values) {
                return {k: 'format.margins.' + name, t: t, kind: 'radio', needs: 'asc_SetSectionProps',
                    disabled: lockEdit,
                    checked: function () { return me.marginsAre(values()); },
                    run: function () { me.applyMargins(values()); }};
            }
            function columns(count) {
                return {k: 'format.columns.' + count, t: String(count), kind: 'radio', needs: 'asc_SetColumnsProps',
                    disabled: lockEdit,
                    checked: function () { return me.columnsNow() === count; },
                    run: function () { me.applyColumns(count); }};
            }
            function direction(name, t, rtl, i) {
                return {k: 'format.direction.' + name, t: t, i: i, kind: 'radio', needs: 'asc_setRtlTextDirection',
                    disabled: lockEdit,
                    checked: function () {
                        var now = me.ask('asc_isRtlTextDirection');
                        return now !== undefined && now === rtl;
                    },
                    run: function () { api().asc_setRtlTextDirection(rtl); me.done(); }};
            }

            return [
                {k: 'file', t: me.textFile, items: [
                    /* The entry into editing from a read-only document. The stock code keeps it in
                       two places — the item "Edit document" in the "File" menu
                       (view/FileMenu.js:433, miEdit) and the button in the header
                       (lib/view/Header.js:945, btnEdit). The condition is stock entirely,
                       both halves: editing is either not ours at all (!isEdit && canEdit),
                       or it is a PDF form in filling mode.
                       canRequestEditRights is the host having the
                       onRequestEditRights handler (api.js:411), without it the request would go into
                       the void. A read-only document is itself the "view" reason, so
                       the item is disabled only without a connection — and also for the first 5 seconds
                       after choosing, while the indicator of waiting for the host's answer is visible
                       (without a hint: the reason is visible in the menu bar row itself). */
                    {k: 'file.edit', t: me.textEditDoc, i: 'rename',
                        when: function (c) {
                            var o = opts(c);
                            return !!(o.canRequestEditRights &&
                                (!o.isEdit && o.canEdit || o.isPDFForm && o.canFillForms && o.isRestrictedEdit));
                        },
                        disabled: function (c) { return c.net() || (me.editRequestWaiting() ? true : null); },
                        run: function () { me.requestEditRights(); }},
                    {sep: true},
                    {k: 'file.save', t: me.textSave, i: 'save', sc: 'Save', when: edit, needs: 'asc_Save',
                        disabled: lockEdit, run: function () { api().asc_Save(); }},
                    /* Download and print are disabled only by the connection: their twins in the stock code
                       have no reasons of their own in `lock:` (see exportItems). The rights are
                       static, from the document permissions. The formats are two groups:
                       the main and the others, the same as in the stock "Download as"
                       (view/FileMenuPanels.js), except FB2. For HTML we use
                       HTML_IN_CONTAINER: the server packs HTML and images into a ZIP,
                       while the stock HTML can download a single .html right from the browser. */
                    {k: 'file.download', t: me.textMenuDownloadAs, i: 'download', kind: 'submenu',
                        when: function (c) { return !!opts(c).canDownload; },
                        disabled: function (c) { return c.net('download'); },
                        items: [download('docx', 'DOCX'), download('pdf', 'PDF'), download('odt', 'ODT'),
                            {sep: true},
                            download('rtf', 'RTF'), download('txt', 'TXT'), download('md', 'MD', 'Markdown (MD)'),
                            download('epub', 'EPUB'), download('html', 'HTML_IN_CONTAINER', me.textMenuDownloadHtml)]},
                    /* Print is also a file delivery: the download prohibition removes it too. */
                    {k: 'file.print', t: me.textMenuPrint, i: 'print', sc: 'PrintPreviewAndPrint', needs: 'asc_Print',
                        when: function (c) { var o = opts(c); return !!(o.canPrint && o.canDownload); },
                        disabled: function (c) { return c.net('download'); },
                        run: function () { me.print(); }},
                    {sep: true},
                    {k: 'file.rename', t: me.textRename, i: 'rename',
                        when: function (c) { return !!opts(c).canRename; },
                        disabled: function (c) { return c.net(); },
                        run: function () { me.rename(); }}
                ]},

                {k: 'edit', t: me.textEdit, items: [
                    /* There is nothing to undo or redo — the item is disabled without a reason of its own:
                       we ask the engine for the state at the moment of the snapshot, with the same thing
                       it uses to send asc_onCanUndo and asc_onCanRedo. */
                    {k: 'edit.undo', t: me.textMenuUndo, i: 'undo', sc: 'EditUndo', when: edit,
                        disabled: function (c) {
                            return [].concat(c.edit() || [], me.ask('asc_getCanUndo') === false ? true : []);
                        },
                        run: function () { api().Undo(); }},
                    {k: 'edit.redo', t: me.textMenuRedo, i: 'redo', sc: 'EditRedo', when: edit,
                        disabled: function (c) {
                            return [].concat(c.edit() || [], me.ask('asc_getCanRedo') === false ? true : []);
                        },
                        run: function () { api().Redo(); }},
                    {sep: true},
                    /* There is nothing to cut and copy without a selection (can_CopyCut —
                       the same criterion as in the stock context menu,
                       DocumentHolderExt). Copying is available to someone who only reads, too. */
                    {k: 'edit.cut', t: me.textMenuCut, sc: 'Cut', when: edit, needs: 'Cut',
                        disabled: function (c) {
                            return [].concat(c.edit() || [], me.ask('can_CopyCut') === false ? 'noSelection' : []);
                        },
                        run: function () { api().Cut(); }},
                    {k: 'edit.copy', t: me.textMenuCopy, sc: 'Copy', needs: 'Copy',
                        disabled: function () { return me.ask('can_CopyCut') === false ? 'noSelection' : null; },
                        run: function () { api().Copy(); }},
                    {k: 'edit.paste', t: me.textMenuPaste, sc: 'Paste', when: edit, needs: 'Paste',
                        disabled: lockEdit, run: function () { me.paste(); }},
                    /* Only text from the clipboard, the formatting is at the paste location
                       (pastePlain). The shortcut is the stock editor shortcut. */
                    {k: 'edit.pastePlain', t: me.textMenuPastePlain, i: 'pastePlain', sc: 'PasteTextWithoutFormat',
                        when: edit, needs: 'callCommand', disabled: lockReplace, run: function () { me.pastePlain(); }},
                    /* The btnSelectAll twin is locked only in form filling
                       (`lock: [viewFormMode, disableOnStart]`); the loss of connection
                       is added by the shared ribbon mask. In "Viewing" and in
                       review preview the stock code allows selecting text. */
                    {k: 'edit.selectAll', t: me.textSelectAll, i: 'selectAll', sc: 'EditSelectAll',
                        needs: 'asc_EditSelectAll',
                        disabled: function (c) { return [c.net(), c.on('form') ? 'form' : null]; },
                        run: function () {
                            Common.NotificationCenter.trigger('selection:manual');
                            api().asc_EditSelectAll();
                        }},
                    {sep: true},
                    /* Search is not disabled by the stock code under a prohibition: `leftMenu.previewMode`
                       switches the panel to a mode without replace
                       (controller/LeftMenu.js, updatePreviewMode). */
                    {k: 'edit.find', t: me.textFindReplace, i: 'search', sc: 'OpenFindDialog', run: function () {
                        DE.getController('LeftMenu').onFindReplace(function () { shell().ensureLeftPanel('search'); });
                    }},
                    /* The autocorrect rules are a stock window, the same as in the advanced
                       settings (view/FileMenuPanels.js, autoCorrect). The rules themselves
                       live in the user's browser, they do not change the document. */
                    {k: 'edit.autocorrect', t: me.textMenuAutoCorrect, i: 'autoCorrect', when: edit,
                        disabled: function (c) { return c.net(); }, run: function () { me.autoCorrect(); }}
                ]},

                {k: 'view', t: me.textView, items: [
                    /* The compact structure is the rail to the left of the page, the item does not open the stock
                       navigation panel: two structures at once are a duplicate.
                       The mark is whether the rail is expanded, it remembers this state itself. The item is
                       disabled, like the stock code does with its navigation, only by loss of connection. */
                    {k: 'view.outline', t: me.textOutline, i: 'outline', kind: 'check',
                        when: function () { return !!shell().outlineRail(); },
                        checked: function () { return !!shell().outlineOpen(); },
                        disabled: function (c) { return c.net(); },
                        run: function () { shell().toggleOutline(); }},
                    /* The stock code does not touch zoom under a prohibition anywhere: the zoom buttons
                       in app/view/Statusbar.js have no `lock:` array at all. */
                    {k: 'view.zoom', t: me.textMenuZoom, i: 'zoom', kind: 'submenu', items: [
                        zoomTo(50), zoomTo(75), zoomTo(100), zoomTo(125), zoomTo(150), zoomTo(200),
                        zoomFit('fitWidth', me.textFitWidth, 1, 'zoomFitToWidth'),
                        zoomFit('fitPage', me.textFitPage, 2, 'zoomFitToPage'),
                        {sep: true},
                        {k: 'view.multipage', t: me.textMultipage, i: 'multipage', kind: 'check',
                            needs: 'SetMultipageViewMode', checked: function () { return me.isMultipage(); },
                            run: function () { me.multipage(); }}
                    ]},
                    {sep: true},
                    /* The rulers, non-printing characters and table gridlines are disabled by the stock code only on
                       loss of connection (`lock: [lostConnect]` at "View → Rulers"): this is a view,
                       they do not change the document. The mark is the engine state. */
                    {k: 'view.rulers', t: me.textRulers, i: 'ruler', kind: 'check', needs: 'asc_SetViewRulers',
                        checked: function () { return me.rulersWanted(); },
                        disabled: function (c) { return c.net(); },
                        run: function () { me.toggleRulers(); }},
                    {k: 'view.marks', t: me.textMenuFormattingMarks, i: 'marks', kind: 'check', needs: 'put_ShowParaMarks',
                        checked: function () { return me.ask('get_ShowParaMarks') === true; },
                        disabled: function (c) { return c.net(); },
                        run: function () { me.toggleParaMarks(); }},
                    {k: 'view.tableGrid', t: me.textMenuTableGridlines, i: 'table', kind: 'check',
                        needs: 'put_ShowTableEmptyLine',
                        checked: function () { return me.ask('get_ShowTableEmptyLine') === true; },
                        disabled: function (c) { return c.net(); },
                        run: function () { me.toggleTableGrid(); }},
                    {sep: true},
                    /* The only visible way to bring back the collapsed
                       toolbar row: the collapse button itself lives in it. The editing prohibition
                       does not touch its own chrome: it is about the document. */
                    {k: 'view.toolbar', t: me.textToolbar, i: 'toolbar', kind: 'check',
                        checked: function () { return !shell().tbHidden; },
                        run: function () { shell().toggleToolbar(); }},
                    /* Collapses the header and the menu row; the same toggle is the chevron
                       on the right of the toolbar row. ✓ — only for manual collapsing:
                       a top that went away on scroll gets no mark, and the command
                       brings it back (CompactShell.toggleFocus). */
                    {k: 'view.focus', t: me.textFocus, i: 'focus', kind: 'check',
                        checked: function () { return !!shell().focus; },
                        run: function () { shell().toggleFocus(); }},
                    {sep: true},
                    {k: 'view.screenReader', t: me.textMenuScreenReader, i: 'access', kind: 'check', needs: 'setSpeechEnabled',
                        checked: function () { return me.isScreenReaderOn(); },
                        run: function () { me.toggleScreenReader(); }}
                ]},

                /* Insert and Format — only for whoever can edit: a user
                   with the view right does not see these sections at all. */
                {k: 'insert', t: me.textInsert, items: [
                    {k: 'insert.image', t: me.textMenuImage, i: 'image', when: edit, needs: 'asc_addImage',
                        disabled: lockEdit, run: function () { api().asc_addImage(); }},
                    /* Table: the size grid is a submenu row of its own (drawn by tableGrid),
                       the conversion is the same stock window as in the ribbon; without selected
                       text there is nothing to convert (controller/Toolbar.js, onInsertTableShow).
                       run(size) — inserting a table of a ready size {cols, rows} without
                       the grid: this is how it is called by "/" (3 × 3) and the toolbar grid.
                       The menu bar does not execute the submenu, the size there is chosen by the grid. */
                    {k: 'insert.table', t: me.textMenuTable, i: 'table', kind: 'submenu', when: edit,
                        disabled: lockEdit,
                        run: function (size) {
                            if (size) tableGrid.run({columns: size.cols, rows: size.rows});
                        },
                        items: [
                            tableGrid,
                            {sep: true},
                            {k: 'insert.table.convert', t: me.textMenuTextToTable, i: 'textToTable',
                                needs: 'asc_ConvertTextToTable',
                                disabled: function (c) {
                                    return [].concat(c.edit() || [], me.hasSelectedText() === false ? 'noSelection' : []);
                                },
                                run: function () { me.textToTable(); }}
                        ]},
                    {k: 'insert.link', t: me.textMenuLink, i: 'link', sc: 'InsertHyperlink', when: edit,
                        disabled: lockEdit, run: function () { me.insertLink(); }},
                    /* ADDING a comment is a right of its own (canComments), and the
                       "comments only" protection allows exactly it (see
                       LOCK_COMMENT). It is visible by the session right, like CompactShell.
                       canAddComment, but without the prohibition: in its own "Viewing" the item is
                       disabled by a reason, and does not disappear. It executes — only with
                       the right in effect (addComment). */
                    {k: 'insert.comment', t: me.textMenuComment, i: 'comment', needs: 'asc_addComment',
                        when: function (c) { var o = opts(c); return c.canEdit() && !!(o.canCoAuthoring && o.canComments); },
                        disabled: function (c) { return c.edit('comment'); },
                        run: function () { me.addComment(); }},
                    {sep: true},
                    /* A shape and a text box appear right at the caret and selected, without
                       a drawing mode (insertShape); in a text box — the caret. */
                    {k: 'insert.shape', t: me.textMenuShape, i: 'shape', kind: 'submenu', when: edit,
                        disabled: lockInsert, items: [
                            shape('rect', me.textMenuShapeRect), shape('roundRect', me.textMenuShapeRoundRect),
                            shape('ellipse', me.textMenuShapeEllipse), shape('rightArrow', me.textMenuShapeArrow),
                            shape('line', me.textMenuShapeLine)
                        ]},
                    {k: 'insert.textBox', t: me.textMenuTextBox, i: 'textbox', when: edit, needs: 'callCommand',
                        disabled: lockInsert, run: function () { me.insertShape(null); }},
                    /* The chart type is a numeric constant, as in the stock code
                       (Toolbar.js:2611): a series set is not assembled by a string.
                       A chart in focus does not change the visibility of the right
                       panel (CompactShell, watchSelection). */
                    {k: 'insert.chart', t: me.textMenuChart, i: 'chart', when: edit, needs: 'asc_addChartDrawingObject',
                        disabled: function (c) {
                            return c.edit() || me.selected('Math') != null;
                        }, run: function () {
                            // Data editing starts from the explicit Edit data action.
                            api().asc_addChartDrawingObject(Asc.c_oAscChartTypeSettings.barNormal, undefined, false);
                        }},
                    {k: 'insert.equation', t: me.textMenuEquation, i: 'formula', when: edit, needs: 'asc_AddMath',
                        disabled: lockEdit, run: function () { api().asc_AddMath(); }},
                    {k: 'insert.symbol', t: me.textMenuSymbol, i: 'symbol', when: edit, disabled: lockEdit,
                        run: function () { me.insertSymbol(); }},
                    /* A line across the whole text width under a paragraph — the same call as for
                       "Borders ▸ Horizontal line" of the ribbon (controller/Toolbar.js,
                       onHorizontalLine). */
                    {k: 'insert.horizontalLine', t: me.textMenuHorizontalLine, i: 'horizontalLine', when: edit, needs: 'asc_addHorizontalRule',
                        disabled: lockEdit, run: function () { api().asc_addHorizontalRule(); me.done(); }},
                    {sep: true},
                    /* Breaks — the same calls as for the ribbon "Breaks" (controller/Toolbar.js,
                       onClickPageBreak, onBtnBlankPageClick): a section starts from
                       the next page. */
                    {k: 'insert.break', t: me.textMenuBreak, i: 'pageBreak', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            {k: 'insert.break.page', t: me.textMenuPageBreak, i: 'pageBreak', sc: 'InsertPageBreak', needs: 'put_AddPageBreak',
                                disabled: lockEdit, run: function () { api().put_AddPageBreak(); me.done(); }},
                            {k: 'insert.break.section', t: me.textMenuSectionBreak, i: 'sectionBreak', needs: 'add_SectionBreak',
                                disabled: lockEdit, run: function () {
                                    api().add_SectionBreak(Asc.c_oAscSectionBreakType.NextPage);
                                    me.done();
                                }},
                            {k: 'insert.break.blank', t: me.textMenuBlankPage, i: 'blankPage', needs: 'asc_AddBlankPage',
                                disabled: lockEdit, run: function () { api().asc_AddBlankPage(); me.done(); }}
                        ]},
                    /* Headers and footers: there is no stock dialog, the entry is moving the caret into
                       the header/footer area of the current page (like the stock "Edit header/footer",
                       controller/HeaderFooterTab.js). The page number position
                       is a command of its own (pageNumberAt): the stock put_PageNum puts the
                       number into one header/footer and erases what was in it. The number
                       format is the stock window of the header/footer controller. */
                    {k: 'insert.headerFooter', t: me.textMenuHeaderFooter, i: 'header', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            {k: 'insert.header', t: me.textMenuHeader, needs: 'GoToHeader', disabled: lockEdit,
                                run: function () { api().GoToHeader(api().getCurrentPage()); me.done(); }},
                            {k: 'insert.footer', t: me.textMenuFooter, needs: 'GoToFooter', disabled: lockEdit,
                                run: function () { api().GoToFooter(api().getCurrentPage()); me.done(); }},
                            {sep: true},
                            {k: 'insert.pageNumber', t: me.textMenuPageNumber, kind: 'group'},
                            pageNumberAt('bottomCenter', me.textMenuPageNumberBottomCenter),
                            pageNumberAt('bottomRight', me.textMenuPageNumberBottomRight),
                            pageNumberAt('topRight', me.textMenuPageNumberTopRight),
                            {k: 'insert.pageNumber.format', t: me.textMenuPageNumberFormat, i: 'pageNumber',
                                needs: 'asc_SetSectionPageNumProps', disabled: lockEdit,
                                run: function () { me.pageNumbering(); }},
                            {sep: true},
                            {k: 'insert.pageCount', t: me.textMenuPageCount, i: 'pageCount', needs: 'asc_AddPageCount',
                                disabled: lockEdit, run: function () { api().asc_AddPageCount(); me.done(); }}
                        ]},
                    {sep: true},
                    /* Only a table of contents that already exists in the
                       document can be updated and configured (asc_GetTableOfContentsPr without a current one — any). */
                    {k: 'insert.toc', t: me.textMenuToc, i: 'toc', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            {k: 'insert.toc.add', t: me.textMenuTocInsert, needs: 'asc_AddTableOfContents',
                                disabled: lockEdit, run: function () { me.tableOfContents(); }},
                            {k: 'insert.toc.refresh', t: me.textMenuTocRefresh, needs: 'asc_UpdateTableOfContents',
                                disabled: noToc, run: function () { me.updateTableOfContents(); }},
                            {k: 'insert.toc.settings', t: me.textMenuTocSettings, needs: 'asc_SetTableOfContentsPr',
                                disabled: noToc, run: function () { me.tableOfContentsSettings(); }}
                        ]},
                    {k: 'insert.footnote', t: me.textMenuFootnote, i: 'footnote', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            {k: 'insert.footnote.regular', t: me.textMenuFootnoteRegular, needs: 'asc_AddFootnote',
                                disabled: lockEdit, run: function () { api().asc_AddFootnote(); me.done(); }},
                            {k: 'insert.footnote.end', t: me.textMenuEndnote, needs: 'asc_AddEndnote',
                                disabled: lockEdit, run: function () { api().asc_AddEndnote(); me.done(); }}
                        ]},
                    {k: 'insert.bookmark', t: me.textMenuBookmark, i: 'bookmark', when: edit,
                        needs: 'asc_GetBookmarksManager', disabled: lockEdit, run: function () { me.bookmarks(); }},
                    {sep: true},
                    /* A field is the stock field code window of the header/footer controller
                       (controller/HeaderFooterTab.js, onInsFieldClick). */
                    {k: 'insert.field', t: me.textMenuField, i: 'field', when: edit, needs: 'asc_AddComplexFieldWithInstruction',
                        disabled: lockEdit, run: function () { me.field(); }},
                    /* Content controls — the same calls as for the stock menu
                       "Content controls" (controller/Toolbar.js,
                       onControlsSelect); parameters and deletion — for the element under the cursor. */
                    {k: 'insert.control', t: me.textMenuControl, i: 'contentControl', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            control('plain', me.textMenuControlPlain, 'asc_AddContentControl', function (a) {
                                a.asc_AddContentControl(Asc.c_oAscSdtLevelType.Inline);
                            }),
                            control('rich', me.textMenuControlRich, 'asc_AddContentControl', function (a) {
                                a.asc_AddContentControl(Asc.c_oAscSdtLevelType.Block);
                            }),
                            control('picture', me.textMenuControlPicture, 'asc_AddContentControlPicture', function (a) {
                                a.asc_AddContentControlPicture();
                            }),
                            control('comboBox', me.textMenuControlComboBox, 'asc_AddContentControlList', function (a) {
                                a.asc_AddContentControlList(true);
                            }),
                            control('dropDown', me.textMenuControlDropDown, 'asc_AddContentControlList', function (a) {
                                a.asc_AddContentControlList(false);
                            }),
                            control('date', me.textMenuControlDate, 'asc_AddContentControlDatePicker', function (a) {
                                a.asc_AddContentControlDatePicker();
                            }),
                            control('checkBox', me.textMenuControlCheckBox, 'asc_AddContentControlCheckBox', function (a) {
                                a.asc_AddContentControlCheckBox();
                            }),
                            {sep: true},
                            {k: 'insert.control.settings', t: me.textMenuControlSettings,
                                needs: 'asc_GetContentControlProperties', disabled: inControl,
                                run: function () { me.controlSettings(); }},
                            {k: 'insert.control.remove', t: me.textMenuControlRemove,
                                needs: 'asc_RemoveContentControlWrapper', disabled: inControl,
                                run: function () { me.removeControl(); }}
                        ]}
                ]},

                /* Format — by the product table: text and paragraph, lists, table and
                   object, page and section, clearing. The ✓ and ● marks are the engine
                   state at the moment of the snapshot, the calls are the same as in the ribbon and the
                   toolbar. */
                {k: 'format', t: me.textFormat, items: [
                    {k: 'format.text', t: me.textMenuText, i: 'bold', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            textToggle('bold', me.textMenuBold, 'put_TextPrBold', 'Bold'),
                            textToggle('italic', me.textMenuItalic, 'put_TextPrItalic', 'Italic'),
                            textToggle('underline', me.textMenuUnderline, 'put_TextPrUnderline', 'Underline'),
                            textToggle('strikeout', me.textMenuStrikeout, 'put_TextPrStrikeout'),
                            baseline('superscript', me.textMenuSuperscript, 'vertalign_SuperScript', 'sup'),
                            baseline('subscript', me.textMenuSubscript, 'vertalign_SubScript', 'sub')
                        ]},
                    {k: 'format.case', t: me.textMenuCase, i: 'case', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            changeCase('sentence', me.textMenuCaseSentence, 'SentenceCase'),
                            changeCase('lower', me.textMenuCaseLower, 'LowerCase'),
                            changeCase('upper', me.textMenuCaseUpper, 'UpperCase'),
                            changeCase('words', me.textMenuCaseWords, 'CapitalizeWords'),
                            changeCase('toggle', me.textMenuCaseToggle, 'ToggleCase')
                        ]},
                    {k: 'format.style', t: me.textMenuParaStyles, i: 'text', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            paraStyle('normal', me.textMenuStyleNormal, 'Normal', 'text'),
                            paraStyle('heading1', me.textMenuStyleHeading1, 'Heading 1', 'h1'),
                            paraStyle('heading2', me.textMenuStyleHeading2, 'Heading 2', 'h2'),
                            paraStyle('heading3', me.textMenuStyleHeading3, 'Heading 3', 'h3')
                        ]},
                    {k: 'format.align', t: me.textMenuAlign, i: 'alignL', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            align('left', me.textMenuAlignLeft, 1, 'LeftPara', 'alignL'),
                            align('center', me.textMenuAlignCenter, 2, 'CenterPara', 'alignC'),
                            align('right', me.textMenuAlignRight, 0, 'RightPara', 'alignR'),
                            align('justify', me.textMenuAlignJustify, 3, 'JustifyPara', 'alignJ')
                        ]},
                    /* "Other spacing and indents…" is the stock paragraph options window,
                       the same that the right panel and the context menu open. */
                    {k: 'format.spacing', t: me.textMenuSpacing, i: 'lineh', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            lineSpacing(1), lineSpacing(1.15), lineSpacing(1.5),
                            lineSpacing(2), lineSpacing(2.5), lineSpacing(3),
                            {sep: true},
                            spaceAround('before', me.textMenuAddSpaceBefore, me.textMenuRemoveSpaceBefore),
                            spaceAround('after', me.textMenuAddSpaceAfter, me.textMenuRemoveSpaceAfter),
                            {sep: true},
                            {k: 'format.spacing.more', t: me.textMenuSpacingMore, needs: 'paraApply',
                                disabled: lockEdit, run: function () { me.paragraphAdvanced(); }}
                        ]},
                    /* Lists: kind, numbering format and indent — the same as for the
                       toolbar lists button and the ribbon; "List options…" is the
                       stock ribbon window. An indent without a list moves the paragraph, not
                       the level, so outside a list it is disabled. */
                    {k: 'format.lists', t: me.textMenuLists, i: 'bullet', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            listType('bullet', me.textMenuListBullet, 0, 0, 'bullet'),
                            listType('numbered', me.textMenuListNumbered, 1, 0),
                            listType('multilevel', me.textMenuListMultilevel, 2, 1, 'multilevel'),
                            {sep: true},
                            {k: 'format.numbering', t: me.textMenuNumberingFormat, kind: 'group'},
                            numbering('decimal', '1.', me.NUMBERING.decimal),
                            numbering('decimalParen', '1)', me.NUMBERING.decimalParen),
                            numbering('letterParen', me.textMenuNumberingLetter, me.NUMBERING.letterParen),
                            numbering('roman', 'I.', me.NUMBERING.roman),
                            numbering('outline', '1. / 1.1. / 1.1.1.', me.NUMBERING.outline),
                            numbering('outlineParen', me.textMenuNumberingOutlineParen, me.NUMBERING.outlineParen),
                            {sep: true},
                            {k: 'format.lists.indentIn', t: me.textMenuIndentIn, i: 'indentIn', needs: 'IncreaseIndent',
                                disabled: inList, run: function () { api().IncreaseIndent(); me.done(); }},
                            {k: 'format.lists.indentOut', t: me.textMenuIndentOut, i: 'indentOut', needs: 'DecreaseIndent',
                                disabled: inList, run: function () { api().DecreaseIndent(); me.done(); }},
                            {sep: true},
                            {k: 'format.lists.settings', t: me.textMenuListSettings, disabled: lockEdit,
                                run: function () { me.listSettings(); }}
                        ]},
                    {sep: true},
                    /* Table and object — always visible, without a table under the cursor or without
                       a selected object the submenu is disabled with its own reason. The state
                       is read on every snapshot, so an open menu revives by itself
                       when the cursor comes into a table. "Merge" — only when
                       the engine can merge the selected cells, without a reason of its own. */
                    {k: 'format.table', t: me.textMenuTable, i: 'table', kind: 'submenu', when: edit,
                        disabled: inTable, items: [
                            tableCmd('rowAbove', me.textMenuRowAbove, 'addRowAbove', 'rowAbove'),
                            tableCmd('rowBelow', me.textMenuRowBelow, 'addRowBelow', 'rowBelow'),
                            tableCmd('colLeft', me.textMenuColumnLeft, 'addColumnLeft', 'colLeft'),
                            tableCmd('colRight', me.textMenuColumnRight, 'addColumnRight', 'colRight'),
                            {sep: true},
                            {k: 'format.table.merge', t: me.textMenuMergeCells, i: 'merge', needs: 'MergeCells',
                                disabled: function (c) {
                                    return [].concat(inTable(c), me.ask('CheckBeforeMergeCells') === false ? true : []);
                                },
                                run: function () { api().MergeCells(); me.done(); }},
                            {sep: true},
                            tableCmd('rowDel', me.textMenuDeleteRow, 'remRow', 'rowDel'),
                            tableCmd('colDel', me.textMenuDeleteColumn, 'remColumn', 'colDel'),
                            tableCmd('tableDel', me.textMenuDeleteTable, 'remTable', 'trash'),
                            {sep: true},
                            {k: 'format.table.props', t: me.textMenuTableProps, disabled: inTable,
                                run: function () { shell().openTableProperties(); }}
                        ]},
                    {k: 'format.image', t: me.textMenuImage, i: 'image', kind: 'submenu', when: edit,
                        disabled: hasObject, items: [
                            {k: 'format.image.wrap', t: me.textMenuWrapping, kind: 'group'},
                            wrap('wrapInline', me.textMenuWrapInline, 'Inline', 'wrapInline'),
                            wrap('wrapSquare', me.textMenuWrapSquare, 'Square', 'wrapSquare'),
                            wrap('wrapTopBottom', me.textMenuWrapTopBottom, 'TopAndBottom', 'wrapTop'),
                            {sep: true},
                            arrange('toFront', me.textMenuBringToFront, 'BringToFront', 'toFront'),
                            arrange('toBack', me.textMenuSendToBack, 'SendToBack', 'toBack'),
                            {sep: true},
                            {k: 'format.image.props', t: me.textMenuObjectProps, disabled: hasObject,
                                run: function () { shell().openRightPanel(); }}
                        ]},
                    {sep: true},
                    {k: 'format.orientation', t: me.textMenuOrientation, i: 'portrait', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            orientation('portrait', me.textMenuPortrait, true, 'portrait'),
                            orientation('landscape', me.textMenuLandscape, false, 'landscape')
                        ]},
                    /* The ready sizes and margins are checked by the stock ribbon check: if they do not
                       fit — a stock warning, the document does not change.
                       "Custom…" and "Custom margins…" are stock windows with their own check. */
                    {k: 'format.pageSize', t: me.textPageSize, i: 'pageSize', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            pageSize('a4', 'A4', [210, 297]),
                            pageSize('a5', 'A5', [148, 210]),
                            pageSize('letter', 'Letter', [215.9, 279.4]),
                            pageSize('legal', 'Legal', [215.9, 355.6]),
                            {sep: true},
                            {k: 'format.pageSize.custom', t: me.textMenuPageSizeCustom, needs: 'change_DocSize',
                                disabled: lockEdit, run: function () { me.pageSize(); }}
                        ]},
                    {k: 'format.margins', t: me.textMargins, i: 'margins', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            margins('normal', me.textMenuMarginsNormal, function () { return me.normalMargins(); }),
                            margins('narrow', me.textMenuMarginsNarrow, function () { return [12.7, 12.7, 12.7, 12.7]; }),
                            margins('moderate', me.textMenuMarginsModerate, function () { return [25.4, 19.1, 25.4, 19.1]; }),
                            margins('wide', me.textMenuMarginsWide, function () { return [25.4, 50.8, 25.4, 50.8]; }),
                            {sep: true},
                            {k: 'format.margins.custom', t: me.textMenuMarginsCustom, needs: 'asc_SetSectionProps',
                                disabled: lockEdit, run: function () { me.pageMargins(); }}
                        ]},
                    {k: 'format.columns', t: me.textColumns, i: 'columns', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            columns(1), columns(2), columns(3),
                            {sep: true},
                            {k: 'format.columns.custom', t: me.textMenuColumnsCustom, needs: 'asc_SetColumnsProps',
                                disabled: lockEdit, run: function () { me.columns(); }}
                        ]},
                    {k: 'format.watermark', t: me.textMenuWatermark, i: 'watermark', when: edit,
                        needs: 'asc_SetWatermarkProps', disabled: lockEdit, run: function () { me.watermark(); }},
                    {k: 'format.hyphenation', t: me.textMenuHyphenation, i: 'hyphen', when: edit,
                        needs: 'asc_setAutoHyphenationSettings', disabled: lockEdit,
                        run: function () { me.hyphenation(); }},
                    {k: 'format.direction', t: me.textMenuTextDirection, i: 'ltr', kind: 'submenu', when: edit,
                        disabled: lockEdit, items: [
                            direction('ltr', me.textMenuLtr, false, 'ltr'),
                            direction('rtl', me.textMenuRtl, true, 'rtl')
                        ]},
                    {sep: true},
                    /* Removes character formatting from the selection: without selected text
                       there is nothing to remove from. */
                    {k: 'format.clear', t: me.textMenuClearFormatting, i: 'clear', when: edit, needs: 'ClearFormating',
                        disabled: function (c) {
                            return [].concat(c.edit() || [], me.hasSelectedText() === false ? 'noSelection' : []);
                        },
                        run: function () { api().ClearFormating(); me.done(); }}
                ]},

                {k: 'collab', t: me.textCollaboration, items: [
                    /* Review. The state is held by the engine, we only
                       toggle — see toggleReview below. The "tracked
                       changes only" protection disables the review controls (edit('review')).
                       The personal mode is marked also under "Track changes for everyone": edits
                       are recorded as tracked changes anyway, and there is nothing to turn it off with while the shared one
                       is on — the item is disabled with forAll. For someone who is given
                       only review, there is nothing to turn off at all. */
                    {k: 'collab.track', t: me.textMenuTrackMine, i: 'rename', kind: 'check',
                        needs: 'asc_GetLocalTrackRevisions',
                        when: function (c) { return c.canEdit() && !!opts(c).canReview; },
                        checked: function (c) { return c.has('asc_GetLocalTrackRevisions') && me.isReviewOn(); },
                        disabled: function (c) {
                            return [].concat(c.edit('review') || [], me.isTrackAll() ? 'forAll' : [],
                                opts(c).isReviewOnly ? true : []);
                        },
                        run: function () { me.toggleReview(); }},
                    /* The shared document flag: written to the file, acts on all
                       co-authors and is visible to everyone who can edit. As with the
                       stock "ON for me and for everyone", for someone who is given only
                       review the item does not exist. */
                    {k: 'collab.trackAll', t: me.textMenuTrackAll, i: 'trackAll', kind: 'check',
                        needs: 'asc_SetGlobalTrackRevisions',
                        when: function (c) { var o = opts(c); return c.canEdit() && !!o.canReview && !o.isReviewOnly; },
                        checked: function () { return me.isTrackAll(); },
                        disabled: function (c) { return c.edit('review'); },
                        run: function () { me.toggleTrackAll(); }},
                    /* How to show tracked changes — one choice of three, the engine mode
                       is marked. Under a prohibition these items live in review
                       preview: the btnReviewView twin has no previewReviewMode in `lock:`
                       — the preview itself is turned on by choosing
                       "final" or "original", and by disabling the items we would lock the
                       user in it with no exit. */
                    {k: 'collab.show', t: me.textMenuShow, i: 'rename', kind: 'submenu', when: reviewer, items: [
                        display('markup', me.textMenuShowMarkup, 'Edit'),
                        display('final', me.textMenuShowFinal, 'Final'),
                        display('original', me.textMenuShowOriginal, 'Original')
                    ]},
                    /* There are no tracked changes in the document — all six are disabled with a reason.
                       Navigating through changes does not require editing; a decision on
                       a change is editing, and outside a change "Accept" and
                       "Reject" are disabled without a hint: they have nothing to execute on. */
                    {k: 'collab.changes', t: me.textMenuChanges, i: 'accept', kind: 'submenu', when: reviewer, items: [
                        {k: 'collab.prev', t: me.textMenuPrevChange, i: 'undo', when: edit,
                            needs: 'asc_GetPrevRevisionsChange', disabled: noChanges,
                            run: function () { api().asc_GetPrevRevisionsChange(); }},
                        {k: 'collab.next', t: me.textMenuNextChange, i: 'redo', when: edit,
                            needs: 'asc_GetNextRevisionsChange', disabled: noChanges,
                            run: function () { api().asc_GetNextRevisionsChange(); }},
                        {sep: true},
                        /* Accept and reject are a decision on SOMEONE ELSE'S edit, so the gate is
                           rights, as for the stock btnAccept and btnReject (isReviewOnly in
                           their `lock:`, lib/view/ReviewChanges.js:292). */
                        decide('accept', me.textMenuAcceptChange, 'accept', 'asc_AcceptChanges', true),
                        decide('reject', me.textMenuRejectChange, 'reject', 'asc_RejectChanges', true),
                        {sep: true},
                        decide('acceptAll', me.textMenuAcceptAll, 'accept', 'asc_AcceptAllChanges'),
                        decide('rejectAll', me.textMenuRejectAll, 'reject', 'asc_RejectAllChanges')
                    ]},
                    {sep: true},
                    /* Comments are disabled together with the stock panel button: the stock code disables
                       it with the `comments.disable` key only on loss of connection. Reading
                       comments is also allowed to a user with the view right.
                       The highlight and resolved ones are the same saved settings as
                       in the stock "Advanced Settings" (setCommentsView). */
                    {k: 'collab.comments', t: me.textComments, i: 'comment', kind: 'submenu',
                        when: function () { return !!shell().canUse('comments'); },
                        disabled: function (c) { return c.net(); }, items: [
                            {k: 'collab.comments.panel', t: me.textMenuCommentsPanel, kind: 'check',
                                checked: function () { return me.isCommentsOpen(); },
                                disabled: function (c) { return c.net(); },
                                run: function () { shell().toggleLeftPanel('comments'); }},
                            {k: 'collab.comments.highlight', t: me.textMenuCommentsHighlight, kind: 'check',
                                needs: 'asc_showComments',
                                checked: function () { return me.commentsView().live; },
                                disabled: function (c) { return c.net(); },
                                run: function () { var v = me.commentsView(); me.setCommentsView(!v.live, v.resolved); }},
                            {k: 'collab.comments.resolved', t: me.textMenuCommentsResolved, kind: 'check',
                                needs: 'asc_showComments',
                                checked: function () { return me.commentsView().resolved; },
                                disabled: function (c) { return c.net(); },
                                run: function () { var v = me.commentsView(); me.setCommentsView(v.live, !v.resolved); }}
                        ]},
                    {sep: true},
                    /* Access and history are not our screens: access is given out
                       by the portal integration, history is shown by the stock panel. */
                    {k: 'collab.share', t: me.textMenuShare, i: 'share',
                        when: function (c) { var o = opts(c); return !!(o.canRequestSharingSettings || o.sharingSettingsUrl); },
                        disabled: function (c) { return c.net(); },
                        run: function () { Common.NotificationCenter.trigger('collaboration:sharing'); }},
                    {k: 'collab.history', t: me.textHistory, i: 'history',
                        when: function (c) { return !!opts(c).canUseHistory; },
                        disabled: function (c) { return c.net(); },
                        run: function () { Common.NotificationCenter.trigger('collaboration:history'); }},
                    /* Compare exists only when there is somewhere to take the second document from:
                       a portal file choice — the same condition as the stock "From
                       Storage" (lib/view/ReviewChanges.js, btnCompare). */
                    {k: 'collab.compare', t: me.textMenuCompare, i: 'compare', needs: 'asc_CompareDocumentUrl',
                        when: function (c) { return c.canEdit() && !!opts(c).canReview && me.canPickCompareFile(); },
                        disabled: lockEdit, run: function () { me.compare(); }},
                    {sep: true},
                    /* Remove the protection set in the document itself. The item exists only
                       while there is protection. Disabled under any editing prohibition, except
                       the protection itself: removal changes the document for everyone and requires an editing session
                       (the stock protection button is disabled the same way — view/DocProtection.js,
                       `lock:` without docLock*), and while the protection is being edited by a co-author. */
                    {k: 'collab.unprotect', t: me.textMenuUnprotect, i: 'unlock', needs: 'asc_setDocumentProtection',
                        when: function (c) { return c.canEdit() && me.isProtected(); },
                        disabled: function (c) {
                            var codes = [].concat(c.edit() || []).filter(function (code) { return code !== 'protected'; });
                            return codes.concat(me.protectLock ? true : []);
                        },
                        run: function () { me.unprotect(); }},
                    /* Fast — co-author edits are visible at once, strict — after
                       saving. This does not change the document, only a connection is needed. */
                    {k: 'collab.coedit', t: me.textMenuCoedit, i: 'coauth', kind: 'submenu',
                        when: function (c) { return c.canEdit() && me.canChangeCoAuthMode(); }, items: [
                            coedit('coeditFast', me.textMenuCoeditFast, true),
                            coedit('coeditStrict', me.textMenuCoeditStrict, false)
                        ]}
                ]},

                /* Help is pinned in the menu bar on the right: it does not go into the narrow-window "…",
                   and "About" is always in view. The editing prohibition does not disable its items:
                   they have nothing to do with the document. Both help pages
                   open in a new tab. */
                {k: 'help', t: me.textHelp, items: [
                    {k: 'help.help', t: me.textMenuEditorHelp, i: 'help', run: function () {
                        window.open(me.editorHelpUrl(Common.Locale.getCurrentLanguage()), '_blank');
                    }},
                    {k: 'help.shortcuts', t: me.textMenuShortcuts, i: 'keyboard', run: function () {
                        window.open(me.shortcutsUrl(Common.Locale.getCurrentLanguage()), '_blank');
                    }},
                    {k: 'help.about', t: me.textAbout, i: 'info', run: function () { me.about(); }}
                ]}
            ];

            function reviewer(c) {
                return c.canEdit() && !!opts(c).canReview;
            }

            /* The engine display mode is marked. Simple markup (Simple) is not among the
               options — then nothing is marked. */
            function display(mode, t, value) {
                return {k: 'collab.' + mode, t: t, kind: 'radio', when: reviewer,
                    checked: function () {
                        var modes = window.Asc && Asc.c_oAscDisplayModeInReview, a = api();
                        if (!modes || !a || typeof a.asc_GetDisplayModeInReview !== 'function') return false;
                        return a.asc_GetDisplayModeInReview() === modes[value];
                    },
                    disabled: function (c) { return [c.net(), c.on('view') ? 'view' : null, c.on('form') ? 'form' : null]; },
                    run: function () { me.displayMode(mode); }};
            }

            function noChanges() {
                return me.hasChanges() ? null : 'noChanges';
            }

            function decide(k, t, i, method, current) {
                return {k: 'collab.' + k, t: t, i: i, needs: method,
                    when: function (c) { var o = opts(c); return c.canEdit() && !!o.canReview && !o.isReviewOnly; },
                    disabled: function (c) {
                        return [].concat(c.edit('review') || [], noChanges() || [],
                            current && !me.isAtChange() ? true : []);
                    },
                    run: function () { api()[method](); }};
            }

            function coedit(k, t, fast) {
                return {k: 'collab.' + k, t: t, kind: 'radio',
                    checked: function () { return me.isFastCoAuth() === fast; },
                    disabled: function (c) { return c.net(); },
                    run: function () { me.coAuthMode(fast); }};
            }
        },

        /* A catalog item by key — for the "/" menu, the toolbar and the bubble:
           one command — one behavior. */
        command: function (k) {
            var found = null;
            (function walk(items) {
                (items || []).forEach(function (it) {
                    if (found || !it) return;
                    if (it.k === k) found = it;
                    else if (it.items) walk(it.items);
                });
            })(this.sections());
            return found;
        },

        /* Execute a catalog command by key — for the toolbar and
           bubble buttons that have a counterpart in the menu. Such buttons are disabled by their own prohibition
           mask (CompactToolbar.setLocked), so here is only the call.
           false — there is no such command. */
        runCommand: function (k, args) {
            var it = this.command(k);
            if (!it || typeof it.run !== 'function') return false;
            it.run(args);
            return true;
        },

        /* The composition of the "/" menu in order: the catalog item key and the arguments of its run.
           Everything that is in "/" is also in the menu: rights, disabling with a reason and
           execution belong to the item. */
        SLASH: [
            {k: 'format.style.heading1'},
            {k: 'format.style.heading2'},
            {k: 'format.style.heading3'},
            {k: 'format.style.normal'},
            {k: 'format.lists.bullet'},
            {k: 'format.lists.numbered'},
            {k: 'insert.table', args: {cols: 3, rows: 3}},
            {k: 'insert.image'},
            {k: 'insert.break.page'},
            {k: 'insert.comment'},
            {k: 'insert.link'},
            {k: 'insert.toc.add'},
            {k: 'insert.footnote.regular'},
            {k: 'insert.equation'},
            {k: 'insert.break.section'},
            {k: 'insert.break.blank'},
            {k: 'insert.horizontalLine'}
        ],

        /* --- Link and comment ------------------------------------------- */

        /* The link window is a toolbar popover: it is measured from its button.
           The catalog does not call it, but asks by a notification — so the row depends on
           the catalog, and the catalog does not depend on the row. A repeated call closes the window. */
        insertLink: function () {
            Common.NotificationCenter.trigger('compact:link');
        },

        /* A comment is added by the stock controller: it opens an editor with
           mentions and formatting and decides itself where to show it.
           The right is its own (CompactShell.canAddComment).

           We call the stock notification, not addDummyComment directly: a direct
           call bypasses the can_AddQuotedComment check (lib/controller/
           Comments.js:654-657) and the whole set of locks around it, including
           lostConnect. The notification is listened to by both the comments controller and
           LeftMenu, which handles the "cannot quote" case by its own way
           (controller/LeftMenu.js:753).

           We open the panel ourselves and before the notification: the stock path shows it
           through showMenu, while our left area without the vo-left-open class takes
           no space. */
        addComment: function () {
            var shell = this.shell;
            if (!shell || !shell.canAddComment()) return;
            shell.ensureLeftPanel('comments');
            Common.NotificationCenter.trigger('app:comment:add', 'toolbar');
        },

        /* --- Help --------------------------------------------------------- */

        /* "About" is a modal window with legal information on the mechanics of the
           stock window (the shared Common.UI.Compact.AboutWindow); its content is
           the same as that of the "About" panel of the extended interface.
           We build it here: dialog() looks for windows only in DE.Views and
           Common.Views. */
        about: function () {
            var Ctor = Common.UI.Compact && Common.UI.Compact.AboutWindow;
            if (!Ctor) return null;
            var win = new Ctor({title: this.textAbout});
            win.show();
            return win;
        },

        /* --- Layout ----------------------------------------------------------- */

        pageMargins: function () {
            var me = this, api = this.api;
            this.dialog('PageMarginsDialog', {
                api: api,
                handler: function (dlg, result) {
                    if (result !== 'ok') return;
                    var props = dlg.getSettings();
                    Common.NotificationCenter.trigger('margins:update', props);
                    api.asc_SetSectionProps(props);
                    me.done();
                }
            }, api.asc_GetSectionProps());
        },

        /* The page size window checks the entered value with the same stock check as
           the ready sizes (controller/Toolbar.js, onPageSizeClick). */
        pageSize: function () {
            var me = this, api = this.api, tb = DE.getController('Toolbar');
            this.dialog('PageSizeDialog', {
                checkPageSize: tb && typeof tb.checkPageSize === 'function' ? tb.checkPageSize.bind(tb) : undefined,
                handler: function (dlg, result) {
                    if (result !== 'ok') return;
                    var props = dlg.getSettings();
                    api.change_DocSize(props[0], props[1]);
                    me.done();
                }
            }, api.asc_GetSectionProps());
        },

        columns: function () {
            var me = this, api = this.api;
            this.dialog('CustomColumnsDialog', {
                handler: function (dlg, result) {
                    if (result !== 'ok') return;
                    api.asc_SetColumnsProps(dlg.getSettings());
                    me.done();
                }
            }, api.asc_GetColumnsProps());
        },

        /* --- Format: state ---------------------------------------------- */
        /* What the engine did not say (no call, no event) is not marked and
           does not disable the item by a guess: undefined. */

        /* A selected element of the needed type — by the same poll as the right panel
           and the context menu (getSelectedElements, the last suitable one):
           its properties or null if there is none in the selection. */
        selected: function (type) {
            var api = this.api, T = window.Asc && Asc.c_oAscTypeSelectElement;
            if (!api || typeof api.getSelectedElements !== 'function' || !T || T[type] === undefined) return undefined;
            var list;
            try { list = api.getSelectedElements(); } catch (e) { return undefined; }
            if (!list || typeof list.length !== 'number') return undefined;
            for (var i = list.length - 1; i >= 0; i--) {
                var el = list[i];
                if (el && typeof el.get_ObjectType === 'function' && el.get_ObjectType() === T[type])
                    return el.get_ObjectValue();
            }
            return null;
        },

        /* The selected object is a picture, shape or chart: in the engine all of them
           come as an Image element (controller/PageLayout.js, onApiFocusObject). */
        imageProps: function () {
            return this.selected('Image');
        },

        /* The visible alignment: in a right-to-left paragraph the engine stores left and
           right as is, but draws mirrored — the toolbar button reads it the same way
           (CompactToolbar.visualAlign) and the ribbon. */
        alignNow: function () {
            var v = this.sel && this.sel.align;
            if (v === null || v === undefined) return undefined;
            return this.ask('asc_isRtlTextDirection') === true && (v === 0 || v === 1) ? 1 - v : v;
        },

        /* The numbering format presets are the same JSON as in the ribbon (view/Toolbar.js,
           _numbersArr and _multilevelArr) and in the engine (sdkjs NumberingCommon.js,
           GetNumberingObjectByDeprecatedTypes): the format is both applied
           and compared by the same value. Single-level ones are compared by the level under the
           cursor, multilevel — entirely. */
        NUMBERING: (function () {
            function single(fmt, text, jc) {
                return {single: true, json: JSON.stringify({Type: 'number',
                    Lvl: [{lvlJc: jc, suff: 'tab', numFmt: {val: fmt}, lvlText: text}]})};
            }
            function multi(level) {
                var lvl = [];
                for (var i = 0; i < 9; i++) lvl.push(level(i));
                return {single: false, json: JSON.stringify({Type: 'number', Lvl: lvl})};
            }
            var LEFT = [360, 792, 1224, 1728, 2232, 2736, 3240, 3744, 4320];
            var FIRST = [-360, -432, -504, -648, -792, -936, -1080, -1224, -1440];
            var CYCLE = ['decimal', 'lowerLetter', 'lowerRoman'];
            return {
                decimal: single('decimal', '%1.', 'right'),
                decimalParen: single('decimal', '%1)', 'right'),
                letterParen: single('lowerLetter', '%1)', 'left'),
                roman: single('upperRoman', '%1.', 'right'),
                outline: multi(function (i) {
                    var text = '';
                    for (var j = 1; j <= i + 1; j++) text += '%' + j + '.';
                    return {lvlJc: 'left', suff: 'tab', numFmt: {val: 'decimal'}, lvlText: text,
                        pPr: {ind: {left: LEFT[i], firstLine: FIRST[i]}}};
                }),
                outlineParen: multi(function (i) {
                    return {lvlJc: 'left', suff: 'tab', numFmt: {val: CYCLE[i % 3]}, lvlText: '%' + (i + 1) + ')',
                        pPr: {ind: {left: 360 * (i + 1), firstLine: -360}}};
                })
            };
        })(),

        isListPreset: function (preset) {
            var api = this.api;
            if (!api || typeof api.asc_IsCurrentNumberingPreset !== 'function') return false;
            try { return !!api.asc_IsCurrentNumberingPreset(preset.json, preset.single); } catch (e) { return false; }
        },

        /* The cursor is in a list: true, false or undefined if the engine does not answer. */
        inList: function () {
            var api = this.api;
            if (!api || typeof api.asc_GetCurrentNumberingId !== 'function') return undefined;
            var id;
            try { id = api.asc_GetCurrentNumberingId(); } catch (e) { return undefined; }
            return id !== null && id !== undefined;
        },

        /* The current list kind: 0 — bulleted, 1 — numbered, 2 —
           multilevel, -1 — no list. Bulleted and numbered — by the
           level format under the cursor, as in the ribbon and the toolbar
           (CompactToolbar.currentListType); multilevel — a match with one
           of the multilevel menu presets, the engine cannot tell it apart otherwise. */
        listType: function () {
            var api = this.api, F = window.Asc && Asc.c_oAscNumberingFormat;
            var on = this.inList();
            if (on === undefined) return undefined;
            if (!on) return -1;
            if (this.isListPreset(this.NUMBERING.outline) || this.isListPreset(this.NUMBERING.outlineParen)) return 2;
            var fmt;
            try {
                fmt = api.asc_GetNumberingPr(api.asc_GetCurrentNumberingId())
                    .get_Lvl(api.asc_GetCurrentNumberingLvl()).get_Format();
            } catch (e) { return undefined; }
            return F && (fmt === F.Bullet || fmt === F.None) ? 0 : 1;
        },

        sectionProps: function () {
            var api = this.api;
            if (!api || typeof api.asc_GetSectionProps !== 'function') return null;
            try { return api.asc_GetSectionProps() || null; } catch (e) { return null; }
        },

        isPortrait: function () {
            var props = this.sectionProps(), O = window.Asc && Asc.c_oAscPageOrientation;
            if (!props || !O || typeof props.get_Orientation !== 'function') return undefined;
            return props.get_Orientation() === O.PagePortrait;
        },

        /* A ready size matches the section under the cursor in any orientation,
           with the ribbon tolerance (controller/Toolbar.js, onApiPageSize). */
        pageSizeIs: function (size) {
            var props = this.sectionProps();
            if (!props || typeof props.get_W !== 'function') return false;
            var w = props.get_W(), h = props.get_H();
            var short = Math.min(w, h), long = Math.max(w, h);
            return Math.abs(short - size[0]) < 0.1 && Math.abs(long - size[1]) < 0.1;
        },

        /* Normal margins — as in the ribbon: for the US and Canada an inch on all sides
           (view/Toolbar.js, textMarginsNormal). The order is top, left, bottom, right. */
        normalMargins: function () {
            var settings = window.Common && Common.Utils && Common.Utils.InternalSettings;
            var region = settings ? settings.get('de-config-region') : '';
            return /^(ca|us)$/i.test(region || '') ? [25.4, 25.4, 25.4, 25.4] : [20, 30, 20, 15];
        },

        marginsAre: function (m) {
            var props = this.sectionProps();
            if (!props || typeof props.get_TopMargin !== 'function') return false;
            var now = [props.get_TopMargin(), props.get_LeftMargin(), props.get_BottomMargin(), props.get_RightMargin()];
            return now.every(function (v, i) { return Math.abs(v - m[i]) < 0.1; });
        },

        /* The number of equal columns with the ribbon's default gap — the way the
           ribbon marks it (controller/Toolbar.js, onColumnsProps). */
        columnsNow: function () {
            var api = this.api, props;
            if (!api || typeof api.asc_GetColumnsProps !== 'function') return undefined;
            try { props = api.asc_GetColumnsProps(); } catch (e) { return undefined; }
            if (!props || typeof props.get_EqualWidth !== 'function' || !props.get_EqualWidth()) return undefined;
            var num = props.get_Num();
            return num === 1 || Math.abs(props.get_Space() - this.COLUMN_SPACE) < 0.1 ? num : undefined;
        },

        COLUMN_SPACE: 12.5,

        /* --- Format: commands ------------------------------------------------ */

        /* Whether the page fits: the stock ribbon check (controller/Toolbar.js,
           checkPageSize) — on "does not fit" it shows the warning itself.
           Without the ribbon controller there is no check, as in the page size window without
           checkPageSize (view/PageSizeDialog.js). */
        pageFits: function (width, height, left, right, top, bottom) {
            var tb = DE.getController('Toolbar');
            if (!tb || typeof tb.checkPageSize !== 'function') return true;
            return !tb.checkPageSize(width, height, left, right, top, bottom);
        },

        applyPageSize: function (size) {
            if (!this.pageFits(size[0], size[1])) return;
            this.api.change_DocSize(size[0], size[1]);
            this.done();
        },

        applyMargins: function (m) {
            if (!window.Asc || !Asc.CDocumentSectionProps) return;
            if (!this.pageFits(undefined, undefined, m[1], m[3], m[0], m[2])) return;
            var props = new Asc.CDocumentSectionProps();
            props.put_TopMargin(m[0]);
            props.put_LeftMargin(m[1]);
            props.put_BottomMargin(m[2]);
            props.put_RightMargin(m[3]);
            this.api.asc_SetSectionProps(props);
            this.done();
        },

        applyColumns: function (count) {
            if (!window.Asc || !Asc.CDocumentColumnsProps) return;
            var props = new Asc.CDocumentColumnsProps();
            props.put_EqualWidth(true);
            props.put_Num(count);
            props.put_Space(this.COLUMN_SPACE);
            this.api.asc_SetColumnsProps(props);
            this.done();
        },

        /* The paragraph options are a stock window, opened the same way as from the right
           panel and the context menu (view/ParagraphSettings.js,
           openAdvancedSettings): the properties of the paragraph under the cursor, applying —
           paraApply. */
        paragraphAdvanced: function () {
            var me = this, api = this.api, para = this.selected('Paragraph');
            if (!para) return;
            this.dialog('ParagraphSettingsAdvanced', {
                tableStylerRows: 2,
                tableStylerColumns: 1,
                paragraphProps: para,
                api: api,
                handler: function (result, value) {
                    if (result === 'ok') api.paraApply(value.paragraphProps);
                    me.done();
                }
            });
        },

        /* The list options are the stock ribbon window with all its logic for a new and
           existing list (controller/Toolbar.js, onMarkerSettingsClick):
           the kind — of the current list, outside a list — numbered. */
        listSettings: function () {
            var tb = DE.getController('Toolbar'), type = this.listType();
            if (tb && typeof tb.onMarkerSettingsClick === 'function')
                tb.onMarkerSettingsClick(type === 0 || type === 2 ? type : 1);
        },

        /* Wrapping and order — through asc_CImgProperty, by the same path as the right
           panel and the context menu; the bubble calls the same catalog items.
           Constants by name, not numbers: in c_oAscWrapStyle2 Inline 0, Square 1,
           Tight 2, TopAndBottom 4, in c_oAscChangeLevel BringToFront 0,
           BringForward 1, SendToBack 2 — bare numbers have already diverged from
           the captions. A check by type, not truthiness: Inline and BringToFront are 0.

           From "in line with text" to any other wrapping the current position
           of the object is carried over. Otherwise the engine turns the picture into drawing_Anchor with a zero
           position (sdkjs word/Editor/Paragraph/ParaDrawing.js:985-992), and it
           goes off to the column edge and the paragraph start. All three stock
           entry points do this: the right panel (view/ImageSettings.js, onSelectWrap),
           the context menu (controller/DocumentHolderExt.js, onImgWrap) and
           "Layout" (controller/PageLayout.js, onClickMenuWrapping). */
        wrap: function (name) {
            var W = window.Asc && Asc.c_oAscWrapStyle2;
            if (!W || !Asc.asc_CImgProperty || typeof W[name] !== 'number') return;
            var style = W[name], prev = this.imageProps();
            var props = new Asc.asc_CImgProperty();
            props.put_WrappingStyle(style);
            var H = Asc.c_oAscRelativeFromH, V = Asc.c_oAscRelativeFromV;
            if (prev && typeof prev.get_WrappingStyle === 'function' && prev.get_WrappingStyle() === W.Inline &&
                style !== W.Inline && H && V && Asc.CImagePositionH && Asc.CImagePositionV) {
                props.put_PositionH(new Asc.CImagePositionH());
                props.get_PositionH().put_UseAlign(false);
                props.get_PositionH().put_RelativeFrom(H.Column);
                props.get_PositionH().put_Value(prev.get_Value_X(H.Column));
                props.put_PositionV(new Asc.CImagePositionV());
                props.get_PositionV().put_UseAlign(false);
                props.get_PositionV().put_RelativeFrom(V.Paragraph);
                props.get_PositionV().put_Value(prev.get_Value_Y(V.Paragraph));
            }
            this.api.ImgApply(props);
            this.done();
        },

        arrange: function (name) {
            var L = window.Asc && Asc.c_oAscChangeLevel;
            if (!L || !Asc.asc_CImgProperty || typeof L[name] !== 'number') return;
            var props = new Asc.asc_CImgProperty();
            props.put_ChangeLevel(L[name]);
            this.api.ImgApply(props);
            this.done();
        },

        /* The font list for dialogs that need it. We assemble it the same way as the
           stock code (controller/Toolbar.js:2672): from the store of the stock fonts
           combobox, without clones. Our own FONTS in CompactToolbar does not suit this —
           there is a fixed list of names, while the dialog needs the collection
           Common.Collections.Fonts: WatermarkSettingsDialog reads it as
           options.fontStore and fills the dropdown from it (:94, :397).
           We keep the assembled one ourselves — the stock code builds its own fontstore once too. */
        fontStore: function () {
            if (this._fontStore) return this._fontStore;
            var tb = DE.getController('Toolbar');
            var cmb = tb && tb.toolbar && tb.toolbar.cmbFontName;
            if (!cmb || !cmb.store || !window.Common || !Common.Collections || !Common.Collections.Fonts) return undefined;
            var store = new Common.Collections.Fonts(), arr = [];
            _.each(cmb.store.toJSON(), function (font) {
                if (!font.cloneid) arr.push(_.clone(font));
            });
            store.add(arr);
            this._fontStore = store;
            return store;
        },

        /* In compact — its own "Watermark" window (CompactWatermark): the same
           watermark properties and the same asc_SetWatermarkProps, the look and behavior are
           its own. No class or a build failure — the stock window, as
           before: a menu item must not stop working because of our layer. */
        watermark: function () {
            var me = this, api = this.api, opts = this.options(),
                M = DE.Views.CompactWatermark, win = null, err = null;
            var config = {
                api: api,
                props: api.asc_GetWatermarkProps(),
                lang: opts.lang,
                disableNetworkFunctionality: opts.disableNetworkFunctionality,
                storage: opts.canRequestInsertImage,
                /* Without it the dialog fails on a text watermark: it builds the font list
                   from this collection and does not survive its absence. */
                fontStore: me.fontStore(),
                handler: function (result, value) {
                    if (result === 'ok') api.asc_SetWatermarkProps(value);
                    me.done();
                }
            };
            try {
                if (M && M.ensure()) win = this.dialog('CompactWatermarkDialog', config);
            } catch (e) {
                err = e;
                win = null;
                M && M.abort && M.abort();
            }
            if (win) return;

            if (!this.watermarkWarned) {
                this.watermarkWarned = true;
                if (window.console && console.warn)
                    console.warn('Компактная оболочка: сбой в «Подложка компакта», открыто стоковое окно.',
                                 err || 'нет класса WatermarkSettingsDialog');
            }
            this.dialog('WatermarkSettingsDialog', config);
        },

        hyphenation: function () {
            var me = this, api = this.api;
            this.dialog('HyphenationDialog', {
                handler: function (dlg, result) {
                    if (result !== 'ok') return;
                    api.asc_setAutoHyphenationSettings(dlg.getSettings());
                    me.done();
                }
            }, api.asc_getAutoHyphenationSettings());
        },

        lineNumbers: function () {
            var me = this, api = this.api;
            this.dialog('LineNumbersDialog', {
                applyTo: Asc.c_oAscSectionApplyType.All,
                handler: function (dlg, result) {
                    if (result !== 'ok') return;
                    var s = dlg.getSettings();
                    api.asc_SetLineNumbersProps(s.type, s.props);
                    me.done();
                }
            }, api.asc_GetLineNumbersProps());
        },

        /* --- Links ---------------------------------------------------------- */

        /* A table of contents with pages and a dot leader — the variant that the
           stock ribbon offers first. The settings are a separate item. */
        tableOfContents: function () {
            var api = this.api;
            var current = api.asc_GetTableOfContentsPr(false);
            var props = current || new Asc.CTableOfContentsPr();
            if (!current) props.put_OutlineRange(1, 9);
            props.put_Hyperlink(true);
            props.put_ShowPageNumbers(true);
            props.put_RightAlignTab(true);
            props.put_TabLeader(Asc.c_oAscTabLeader.Dot);
            current ? api.asc_SetTableOfContentsPr(props) : api.asc_AddTableOfContents(null, props);
            this.done();
        },

        /* Whether the document has a table of contents; without a call at the engine — undefined, and the items
           are not disabled by a guess. */
        hasToc: function () {
            var api = this.api;
            if (!api || typeof api.asc_GetTableOfContentsPr !== 'function') return undefined;
            try { return !!api.asc_GetTableOfContentsPr(false); } catch (e) { return undefined; }
        },

        tableOfContentsSettings: function () {
            var me = this, api = this.api;
            var props = api.asc_GetTableOfContentsPr(false);
            this.dialog('TableOfContentsSettings', {
                api: api,
                props: props,
                type: 0,
                handler: function (result, value) {
                    if (result !== 'ok') return;
                    props ? api.asc_SetTableOfContentsPr(value) : api.asc_AddTableOfContents(null, value);
                    me.done();
                }
            });
        },

        /* In compact — its own "Bookmarks" window (CompactBookmarks): the same
           bookmark manager, the look and behavior are its own. No class or
           a build failure — the stock window, as before: a menu item must not
           stop working because of our layer. */
        bookmarks: function () {
            var me = this, api = this.api, M = DE.Views.CompactBookmarks, win = null, err = null;
            var config = {
                api: api,
                appOptions: this.options(),
                props: api.asc_GetBookmarksManager(),
                handler: function () { me.done(); }
            };
            try {
                if (M && M.ensure()) win = this.dialog('CompactBookmarksDialog', config);
            } catch (e) {
                err = e;
                win = null;
                M && M.abort && M.abort();
            }
            if (win) return;

            if (!this.bookmarksWarned) {
                this.bookmarksWarned = true;
                if (window.console && console.warn)
                    console.warn('Компактная оболочка: сбой в «Закладки компакта», открыто стоковое окно.',
                                 err || 'нет класса BookmarksDialog');
            }
            this.dialog('BookmarksDialog', config);
        },

        /* --- Insert --------------------------------------------------------- */

        /* The number format and the field code are stock windows of the header/footer controller: it also
           knows the current numbering of the section (controller/HeaderFooterTab.js,
           onInsertPageNumberMenuClick and onInsFieldClick). */
        pageNumbering: function () {
            var ctl = DE.getController('HeaderFooterTab');
            if (ctl && typeof ctl.onInsertPageNumberMenuClick === 'function') ctl.onInsertPageNumberMenuClick({value: 'format'});
        },

        field: function () {
            var ctl = DE.getController('HeaderFooterTab');
            if (ctl && typeof ctl.onInsFieldClick === 'function') ctl.onInsFieldClick('add');
        },

        /* --- The header/footer under the caret ---------------------------------------- */
        /* The header/footer hint buttons (CompactShell.buildHeaderHint) get
           the header/footer properties from asc_onFocusObject (the engine's CHeaderProp): the type —
           header or footer, special first and even pages, the link to the
           previous section and the distances from the edge. */
        isFooter: function (props) {
            var footer = (window.AscCommon && AscCommon.hdrftr_Footer) || 2;
            return !!(props && typeof props.get_Type === 'function' && props.get_Type() === footer);
        },

        /* Deletes the header/footer of the current page entirely, together with its space,
           — the same as "Remove …" of the stock tab (controller/HeaderFooterTab.js,
           onHeaderFooterEditRemove). While change tracking is on it does not delete:
           see removeHeaderFooterLocked. */
        removeHeaderFooter: function (props) {
            var api = this.api;
            if (!api || !props || this.removeHeaderFooterLocked()) return;
            var page = api.getCurrentPage();
            if (this.isFooter(props)) api.asc_RemoveFooter(page);
            else api.asc_RemoveHeader(page);
            this.done();
        },

        /* The deletion of a header/footer (the engine's RemoveHdrFtr) is not recorded as
           a tracked change: "Reject all" will not bring the header/footer back. So while
           change tracking is on — personal or for everyone, by the flag that
           is in effect in the engine (isReviewOn), — deletion is closed. */
        removeHeaderFooterLocked: function () {
            var api = this.api;
            if (!api || typeof api.asc_GetLocalTrackRevisions !== 'function' ||
                typeof api.asc_GetGlobalTrackRevisions !== 'function') return false;
            return this.isReviewOn();
        },

        /* The "Options" window on the compact window template: a special first-page
           header/footer, different for even and odd, the link to the previous section and
           the distance from the edge — commands of the stock header/footer tab
           (HeadersAndFooters_*, put_HeadersAndFootersDistance). Only the changed
           is applied. The first section has no link (null) — the field is disabled. */
        headerFooterSettings: function (props) {
            var me = this, api = this.api;
            var Win = window.Common && Common.Views && Common.Views.AdvancedSettingsWindow;
            var UI = window.Common && Common.UI;
            var Metric = window.Common && Common.Utils && Common.Utils.Metric;
            if (!api || !props || !Win || !UI || !UI.CheckBox || !UI.MetricSpinner || !Metric) return null;

            var footer = this.isFooter(props);
            var start = {
                first: props.get_DifferentFirst() === true,
                odd: props.get_DifferentEvenOdd() === true,
                link: props.get_LinkToPrevious(),
                distance: footer ? props.get_FooterMargin() : props.get_HeaderMargin()
            };
            var enc = function (s) {
                var U = Common.Utils && Common.Utils.String;
                return U && U.htmlEncode ? U.htmlEncode(s) : String(s);
            };
            var CW = DE.Views.CompactWindows;
            var win = new Win({
                title: me.textHfSettingsTitle,
                cls: 'vo-win vo-win--hf',
                width: 420,
                contentWidth: 372,
                separator: false,
                contentStyle: '',
                contentTemplate: '<div class="vo-hf-settings">' +
                        '<div class="vo-hf-first"></div><div class="vo-hf-odd"></div><div class="vo-hf-link"></div>' +
                        '<label class="input-label">' + enc(me.textHfDistance) + '</label>' +
                        '<div class="vo-hf-distance"></div>' +
                    '</div>',
                buttons: [{value: 'ok', caption: (CW && CW.textApply) || 'OK', primary: true}, 'cancel'],
                handler: function (result) {
                    if (result === 'ok') me.applyHeaderFooterSettings(win, start, footer);
                }
            });

            var render = win.render;
            win.render = function () {
                var res = render.apply(this, arguments);
                var $w = this.$window;
                var check = function (cls, text, value) {
                    var box = new UI.CheckBox({el: $w.find(cls), labelText: text});
                    box.setValue(value, true);
                    return box;
                };
                win.first = check('.vo-hf-first', me.textHfDiffFirst, start.first);
                win.odd = check('.vo-hf-odd', me.textHfDiffOdd, start.odd);
                win.link = check('.vo-hf-link', me.textHfLink, start.link === true);
                win.link.setDisabled(start.link === null || start.link === undefined);
                var pt = Metric.getCurrentMetric() === Metric.c_MetricUnits.pt;
                win.distance = new UI.MetricSpinner({
                    el: $w.find('.vo-hf-distance'),
                    step: pt ? 1 : 0.1,
                    width: 100,
                    defaultUnit: Metric.getCurrentMetricName(),
                    value: '0',
                    maxValue: Metric.fnRecalcFromMM(558.8),   // as in the stock tab: 55.88 cm
                    minValue: 0,
                    ariaLabel: me.textHfDistance
                });
                win.distance.setValue(Metric.fnRecalcFromMM(start.distance || 0), true);
                return res;
            };
            win.getFocusedComponents = function () {
                return [win.first, win.odd, win.link, win.distance].concat(win.getFooterButtons());
            };
            win.getDefaultFocusableComponent = function () { return win.first; };
            win.on('close', function () { me.done(); });
            win.show();
            return win;
        },

        applyHeaderFooterSettings: function (win, start, footer) {
            var api = this.api;
            var on = function (box) { return box.getValue() === 'checked'; };
            if (on(win.first) !== start.first) api.HeadersAndFooters_DifferentFirstPage(on(win.first));
            if (on(win.odd) !== start.odd) api.HeadersAndFooters_DifferentOddandEvenPage(on(win.odd));
            if (start.link === true || start.link === false) {
                if (on(win.link) !== start.link) api.HeadersAndFooters_LinkToPrevious(on(win.link));
            }
            var mm = Common.Utils.Metric.fnRecalcToMM(win.distance.getNumberValue());
            if (typeof mm === 'number' && isFinite(mm) && Math.abs(mm - (start.distance || 0)) > 0.001)
                api.put_HeadersAndFootersDistance(mm, !footer);
        },

        /* The options and deletion of the content control under the cursor — as in the stock menu
           (controller/Toolbar.js, onControlsSelect): the options window gets the properties
           of the element and applies them by its id. */
        controlProps: function () {
            var api = this.api;
            if (!api.asc_IsContentControl()) return null;
            return api.asc_GetContentControlProperties() || null;
        },

        controlSettings: function () {
            var me = this, api = this.api, props = this.controlProps();
            if (!props) return;
            var id = props.get_InternalId();
            var tb = DE.getController('Toolbar');
            this.dialog('ControlSettingsDialog', {
                props: props,
                api: api,
                controlLang: tb && tb._state ? tb._state.lang : undefined,
                interfaceLang: this.options().lang,
                handler: function (result, value) {
                    if (result === 'ok') api.asc_SetContentControlProperties(value, id);
                    me.done();
                }
            });
        },

        /* An ordinary element goes away, leaving its content in the text, a form field —
           entirely: the context menu deletes the same way (controller/DocumentHolderExt.js). */
        removeControl: function () {
            var api = this.api, props = this.controlProps();
            if (!props) return;
            var id = props.get_InternalId();
            if (props.get_FormPr && props.get_FormPr()) api.asc_RemoveContentControl(id);
            else api.asc_RemoveContentControlWrapper(id);
            this.done();
        },

        insertSymbol: function () {
            var me = this, api = this.api;
            this.dialog('SymbolTableDialog', {
                api: api,
                lang: this.options().lang,
                modal: false,
                type: 1,
                special: true,
                showShortcutKey: true,
                buttons: [{value: 'ok', caption: me.textInsertBtn}, 'close'],
                handler: function (dlg, result, settings) {
                    if (result === 'ok') {
                        api.asc_insertSymbol(settings.font, settings.code, settings.special);
                    } else {
                        me.done();
                    }
                }
            });
        },

        /* Whether there is selected text — by the same question the stock code asks before
           "Convert text to table" (controller/Toolbar.js, onInsertTableShow).
           Without such a call — undefined: the item is not disabled by a guess. */
        hasSelectedText: function () {
            var api = this.api;
            if (!api || typeof api.asc_GetSelectedText !== 'function') return undefined;
            try { return !!api.asc_GetSelectedText(); } catch (e) { return undefined; }
        },

        /* The table size picker grid in the "Table" submenu: 10 columns by 8 rows,
           like the toolbar grid. The grid itself is stock (DimensionPicker) — it
           draws the size and responds to the mouse; the keys are our own: arrows change the size,
           Enter and Space insert. At the grid edge an arrow goes to the menu bar: ← at the
           first column closes the submenu and returns focus to the "Table" item, ↓ at the
           last row leads to the next item. Esc removes the submenu by the menu bar
           itself. The size is announced by the bar's live region.

           The menu bar focus moves through the list buttons, so the grid stop is
           a button; DimensionPicker lives inside it. Without DimensionPicker the grid
           works from the keyboard, and on the button there is its caption. */
        tableGrid: function (row, item) {
            var me = this, doc = row.ownerDocument || document;
            var COLS = 10, ROWS = 8;
            var cur = {c: 0, r: 0};

            var btn = doc.createElement('button');
            btn.setAttribute('type', 'button');
            btn.className = 'vo-mn-dim';
            btn.setAttribute('role', 'menuitem');
            btn.setAttribute('tabindex', '-1');
            btn.setAttribute('aria-label', item.t);
            /* The look of the button and the hidden live region — by classes (compact-shell.less). */
            var live = doc.createElement('span');
            live.className = 'vo-mn-dim-live';
            live.setAttribute('aria-live', 'polite');
            row.appendChild(btn);
            row.appendChild(live);

            function show(c, r) {
                cur = {c: c, r: r};
                live.textContent = c > 0 && r > 0 ?
                    me.txtTableSize_ARIA.replace('{0}', c).replace('{1}', r) : '';
            }

            var picker = null;
            var Picker = window.Common && Common.UI && Common.UI.DimensionPicker;
            if (Picker && window.$) {
                var host = doc.createElement('div');
                host.className = 'dimension-picker';
                btn.appendChild(host);
                try {
                    picker = new Picker({el: $(host), minRows: ROWS, minColumns: COLS, maxRows: ROWS, maxColumns: COLS});
                    picker.on('change', function (p, c, r) { show(c, r); });
                    picker.on('select', function (p, c, r) { insert(c, r); });
                } catch (e) {
                    picker = null;
                    host.parentNode && host.parentNode.removeChild(host);
                }
            }
            if (!picker) btn.textContent = item.t;

            function size(c, r) {
                c = Math.min(Math.max(c, 1), COLS);
                r = Math.min(Math.max(r, 1), ROWS);
                if (picker) picker.setTableSize(c, r);
                show(c, r);
            }

            /* A click outside the cells gives 0 × 0 (DimensionPicker sends the current value as
               is), and put_Table(0, 0) brings the engine down — such a choice does not insert. */
            function insert(c, r) {
                if (c > 0 && r > 0) me.runOwnRow(item, {columns: c, rows: r});
            }

            btn.addEventListener('focus', function () {
                if (!(cur.c > 0 && cur.r > 0)) size(1, 1);
            });
            btn.addEventListener('keydown', function (e) {
                if (e.altKey || e.ctrlKey || e.metaKey) return;
                /* The direction is as in the menu bar: by the rtl class on body. */
                var r2l = !!doc.body && doc.body.classList.contains('rtl');
                var grow = r2l ? 'ArrowLeft' : 'ArrowRight', shrink = r2l ? 'ArrowRight' : 'ArrowLeft';
                var c = Math.max(cur.c, 1), r = Math.max(cur.r, 1), key = e.key;
                if (key === 'Enter' || key === ' ') insert(c, r);
                else if (key === grow) size(c + 1, r);
                else if (key === shrink && c > 1) size(c - 1, r);
                else if (key === 'ArrowDown' && r < ROWS) size(c, r + 1);
                else if (key === 'ArrowUp' && r > 1) size(c, r - 1);
                else return;
                e.preventDefault();
                e.stopPropagation();
            });
        },

        /* The execution of an own menu row (the grid) — through the menu bar (exec): the item
           state is re-read (one disabled in the meantime is not executed), the menu
           closes, the keyboard returns to the document and the bar hold is released.
           Without the menu bar — the same here. */
        runOwnRow: function (item, args) {
            var shell = this.shell, adapter = shell && shell.menuAdapter, menu = shell && shell.menu;
            if (menu && typeof menu.exec === 'function') return !!menu.exec(item, args);
            if (adapter && typeof adapter.itemState === 'function') {
                var st = adapter.itemState(item) || {};
                if (st.visible === false || st.disabled) return false;
            }
            if (menu && typeof menu.close === 'function') menu.close();
            if (adapter && adapter.keys && typeof adapter.keys.beforeCommand === 'function') adapter.keys.beforeCommand();
            item.run(args);
            return true;
        },

        textToTable: function () {
            var me = this, api = this.api;
            /* The method names are as in the stock code (controller/Toolbar.js:1970): the parameters
               are given by asc_PreConvertTextToTable, applied by asc_ConvertTextToTable
               with a capital C. The former asc_GetTextToTableInfo and
               asc_convertTextToTable do not exist in the engine at all: because of the `&&` guard the dialog
               opened with props === undefined, and the application went nowhere. */
            this.dialog('TextToTableDialog', {
                api: api,
                props: api.asc_PreConvertTextToTable(),
                defaultAutoFitType: Asc.c_oAscTextToTableAutoFitType.Content,
                handler: function (result, settings) {
                    if (result === 'ok') api.asc_ConvertTextToTable(settings);
                    me.done();
                }
            });
        },

        /* --- Review --------------------------------------------------- */
        /* The state is held by the engine, not by us. There are two modes, and they are independent.
           The personal one is a local engine flag: on — true, off — null
           (the stock controller in "Compact" sets null instead of false,
           lib/controller/ReviewChanges.js, trackRevisionsOff), and null follows
           the shared one. The shared one is a document flag, "Track changes for everyone". Edits
           are recorded as tracked changes if the personal or the shared one is on.
           We toggle the personal one not by a call of our own, but by the stock notification: behind it
           there is a handler that also knows isReviewOnly, and the update of the
           button in the stock ribbon. The shared one — by an engine call: the stock notification
           with global resets the personal flag to null, and turning off the shared mode
           not turn off the personal one. The ribbon and co-authors are notified by the engine itself
           (asc_onOnTrackRevisionsChange). */

        isReviewOn: function () {
            var api = this.api;
            var local = api.asc_GetLocalTrackRevisions();
            return (local === null) ? !!api.asc_GetGlobalTrackRevisions() : !!local;
        },

        isTrackAll: function () {
            var api = this.api;
            return !!api && typeof api.asc_GetGlobalTrackRevisions === 'function' &&
                api.asc_GetGlobalTrackRevisions() === true;
        },

        toggleReview: function () {
            if (this.options().isReviewOnly) return;
            Common.NotificationCenter.trigger('reviewchanges:turn', this.api.asc_GetLocalTrackRevisions() !== true, false);
            this.done();
        },

        toggleTrackAll: function () {
            this.api.asc_SetGlobalTrackRevisions(!this.isTrackAll());
            this.done();
        },

        review: function () {
            return DE.getController('Common.Controllers.ReviewChanges');
        },

        /* A rename is not a panel but a dialog on top; the stock handler
           lives on the file menu itself (controller/LeftMenu.js:69). */
        /* The rights request is led by Main.markEditRequest: one open request,
           a waiting indicator and a general text if the host is silent for 5 seconds, while
           the host's refusal in response to it does not break the connection (controller/Main.js).
           There is no caption in the stock status line: its place is the indicator in the
           menu bar row, and the stock line after a refusal without a break would have
           stayed with "requesting rights" in Advanced.
           Without the Main controller — the stock handler of the "File" item
           (controller/LeftMenu.js, clickMenuFileItem). As the first argument it
           expects the file menu itself and after the action calls hide() on it; our
           menu closes itself, so we pass null: the row instead of the menu
           threw an exception on the click. */
        requestEditRights: function () {
            var main = DE.getController('Main');
            if (main && typeof main.markEditRequest === 'function') {
                main.markEditRequest();
                return;
            }
            var lm = DE.getController('LeftMenu');
            if (lm && lm.clickMenuFileItem) lm.clickMenuFileItem(null, 'edit');
        },

        editRequestWaiting: function () {
            var main = DE.getController('Main');
            return !!(main && typeof main.isEditRequestWaiting === 'function' && main.isEditRequestWaiting());
        },

        rename: function () {
            var lm = DE.getController('LeftMenu');
            if (lm && lm.clickMenuFileItem) lm.clickMenuFileItem(null, 'rename');
        },

        /* --- Registry ---------------------------------------------------------- */

        changeCase: function (name) {
            var types = window.Asc && Asc.c_oAscChangeTextCaseType;
            if (!types || types[name] === undefined) return;
            this.api.asc_ChangeTextCase(types[name]);
            this.done();
        },

        /* --- Table of contents ------------------------------------------------- */
        /* Inserting a table of contents is not enough — without an update it goes stale with the very first
           new heading. The logic is taken from the stock one (controller/Links.js:314):
           the internal class is taken from an existing table of contents, otherwise the engine does not
           understand which exactly to update. */

        updateTableOfContents: function () {
            var api = this.api;
            var props = api.asc_GetTableOfContentsPr(true);
            var current = (props && props.get_InternalClass) ? props.get_InternalClass() : null;
            api.asc_UpdateTableOfContents(false, current);
            this.done();
        },

        /* --- View -------------------------------------------------------------- */

        /* We ask the engine for the CURRENT state, and do not remember our own — the same
           rule as for the rulers below, and here it was not applied.

           The state changes bypassing the shell by at least three paths: the document
           start sets the multipage view by the saved setting
           `de-zoom-multipage` (controller/Main.js:1342-1344); our "Fit to
           width" and "Fit to page" make the stock asc_onZoomChange handler, alive in compact,
           turn it off (controller/Statusbar.js,
           controller/ViewTab.js); the stock checkmark "View → Multiple pages" and
           the status bar button change the mode themselves. With a flag of our own the first click
           went for nothing: the internal check oldValue !== pageViewMode
           (sdkjs/word/api.js:8651) did not fire, and only the second helped.

           The engine has a getter and it is exported: GetMultipageViewMode
           (sdkjs/word/api.js:8643, export :15371) — it is also used by the stock code
           (forms/app/controller/ApplicationController.js).

           And the second: on every toggle the stock code writes the setting and sends
           pages:multiplechanged (controller/ViewTab.js:302-309), so that
           the stock controls do not lie. Here there was neither one nor the other,
           so the choice did not survive a reload, and the checkmark and the button
           showed the opposite. We split exactly as in setRulers: the value
           to the engine, the setting to localStorage (this is the USER's decision — a click
           on the item), the "View" checkmark silently, and the status bar button — by the stock
           notification of its own owner. */

        isMultipage: function () {
            var api = this.api;
            return (api && typeof api.GetMultipageViewMode === 'function')
                   ? !!api.GetMultipageViewMode() : !!this.multi;
        },

        multipage: function () {
            var api = this.api;
            var next = !this.isMultipage();

            if (api.zoomCustomMode) api.zoomCustomMode();
            api.SetMultipageViewMode(next);
            this.multi = next;

            /* Only localStorage: InternalSettings does not keep this key for
               anyone — it is read straight from the storage by both the start and both stock
               controls (controller/Main.js:1342, view/ViewTab.js:318,
               view/Statusbar.js:226). */
            Common.localStorage.setBool('de-zoom-multipage', next);

            var vt = DE.getController('ViewTab');
            if (vt && vt.view) {
                /* We move the checkmark silently, otherwise we would enter onMultiplePages
                   a second time around and repeat the engine call. */
                vt.view.btnMultiplePages && vt.view.btnMultiplePages.toggle(next, true);
                /* And the status bar button is updated by its own subscriber to
                   this notification (controller/Statusbar.js:71). */
                vt.view.fireEvent && vt.view.fireEvent('pages:multiplechanged', [next]);
            }
            this.done();
        },

        /* A fallback answer for an engine build without the getter — it stores no state,
           like the rulers field below. */
        multi: false,

        /* The tracked changes display mode. We call the stock turnDisplayMode, and not
           asc_SetDisplayModeInReview: the handler also knows how to forbid editing
           in the "final" and "original" modes (ReviewChanges.js:855), otherwise
           the user would edit the document without seeing others' tracked changes. */
        displayMode: function (mode) {
            var ctrl = this.review();
            if (ctrl && ctrl.turnDisplayMode) ctrl.turnDisplayMode(mode);
            this.done();
        },

        /* There is somewhere to take the second document for comparison from — the portal gives
           a file choice: the same condition as the stock item "From Storage"
           (lib/view/ReviewChanges.js, the btnCompare menu). The choice from the computer
           is opened by the stock handler with a timer (lib/controller/ReviewChanges.js,
           onCompareClick 'file'), already outside the user's click, and the browser does not show the
           file choice window: the item looked available and did
           nothing. */
        canPickCompareFile: function () {
            var o = this.options();
            return !!(o.canFeatureComparison && (o.canRequestSelectDocument || o.canRequestCompareFile ||
                      o.fileChoiceUrl && o.fileChoiceUrl.indexOf('{documentType}') > -1));
        },

        /* Comparison opens the choice of a second portal file — the stock scenario with
           its own request and loading (storage:document-load), there is no need to reproduce it
           by hand. */
        compare: function () {
            var ctrl = this.review();
            /* The argument is a string, not a menu item: the stock handler compares
               `item` itself (lib/controller/ReviewChanges.js, onCompareClick), not
               its field. */
            if (ctrl && ctrl.onCompareClick) ctrl.onCompareClick('storage');
        },

        /* Whether the document has tracked changes — anyone's, one's own too (true:
           without it the engine counts only others', word/Editor/Document.js,
           HaveRevisionChanges). */
        hasChanges: function () {
            var api = this.api;
            return !!(api && typeof api.asc_HaveRevisionsChanges === 'function' && api.asc_HaveRevisionsChanges(true));
        },

        /* The cursor or selection is on a tracked change: the engine collects them on every
           caret movement (word/api.js, sync_EndCatchRevisionsChanges), and "Accept"
           and "Reject" without an argument work exactly with them. */
        isAtChange: function () {
            var api = this.api;
            if (!api || typeof api.asc_GetRevisionsChangesStack !== 'function') return false;
            var stack = api.asc_GetRevisionsChangesStack();
            return !!(stack && stack.length);
        },

        /* --- Comments ------------------------------------------------------- */

        isCommentsOpen: function () {
            var shell = this.shell;
            var btn = shell && typeof shell.stockLeftBtn === 'function' ? shell.stockLeftBtn('comments') : null;
            return !!(btn && btn.pressed);
        },

        /* The highlight in text and resolved ones are stock settings: the start reads them
           from localStorage into InternalSettings (controller/Main.js), before that —
           straight from the storage with the same defaults. */
        commentsView: function () {
            var L = window.Common && Common.localStorage;
            var stored = function (name, def) { return L && typeof L.getBool === 'function' ? L.getBool(name, def) : def; };
            var live = this.setting('de-settings-livecomment'), resolved = this.setting('de-settings-resolvedcomment');
            if (live === undefined || live === null) live = stored('de-settings-livecomment', true);
            if (resolved === undefined || resolved === null) resolved = stored('de-settings-resolvedcomment', false);
            return {live: !!live, resolved: !!resolved};
        },

        /* The value of a stock session setting (InternalSettings) — for item
           marks: a menu snapshot must not fail where the settings do not exist yet. */
        setting: function (name) {
            var S = window.Common && Common.Utils && Common.Utils.InternalSettings;
            return S && typeof S.get === 'function' ? S.get(name) : undefined;
        },

        /* How the stock "Advanced Settings" apply the settings
           (controller/LeftMenu.js, applySettings): the choice — to the storage and
           InternalSettings, the display — to the engine. While the comments panel is open,
           the stock code shows all of them (LeftMenu.commentsShowHide), and the choice will take effect
           when it is closed. */
        setCommentsView: function (live, resolved) {
            var api = this.api;
            Common.localStorage.setItem('de-settings-livecomment', live ? 1 : 0);
            Common.localStorage.setItem('de-settings-resolvedcomment', resolved ? 1 : 0);
            Common.Utils.InternalSettings.set('de-settings-livecomment', !!live);
            Common.Utils.InternalSettings.set('de-settings-resolvedcomment', !!resolved);
            if (!this.isCommentsOpen()) {
                if (live) api.asc_showComments(!!resolved);
                else if (typeof api.asc_hideComments === 'function') api.asc_hideComments();
            }
            var ctrl = this.review();
            if (ctrl && ctrl.commentsShowHide) ctrl.commentsShowHide(live ? 'show' : 'hide');
            this.done();
        },

        /* --- Document protection -------------------------------------------------- */
        /* The protection set in the document itself (for example, in Word) is in the api:
           asc_getDocumentProtection (word/api.js). Its "none" is type None or
           protection without enforcement (then the engine gives type None). */

        protectionProps: function () {
            var api = this.api;
            if (!api || typeof api.asc_getDocumentProtection !== 'function') return null;
            return api.asc_getDocumentProtection() || null;
        },

        isProtected: function () {
            var props = this.protectionProps(), types = window.Asc && Asc.c_oAscEDocProtect;
            if (!props || !types || typeof props.asc_getEditType !== 'function') return false;
            var type = props.asc_getEditType();
            return type === types.ReadOnly || type === types.Comments ||
                   type === types.TrackedChanges || type === types.Forms;
        },

        /* Without a password the protection is removed at once, as with the stock button
           (controller/DocProtection.js, onProtectDocClick). With a password — a window. */
        unprotect: function () {
            var props = this.protectionProps();
            if (!props || !this.isProtected()) return;
            if (props.asc_getIsPassword()) {
                this.unprotectWindow();
                return;
            }
            props.asc_setEditType(Asc.c_oAscEDocProtect.None);
            this.api.asc_setDocumentProtection(props);
            this.done();
        },

        /* The password window on the compact window template (CompactWindows: the vo-win mark,
           "Apply" as the main button). The stock password window (OpenDialog)
           closes on any answer, while a wrong password must keep the window
           open: so ours, on the stock AdvancedSettingsWindow, whose
           button handler can hold the window.
           The window is open while there is protection: it is closed by onProtectionChange.
           A wrong password is reported by the engine as an error, the text of which is shown by
           Main.onError; the window only has to clear the field (onUnprotectError).
           The password is always sent, an empty one too: without a password the engine removes
           the protection without checking it (word/api.js, asc_setDocumentProtection). */
        unprotectWindow: function () {
            var me = this;
            var Win = window.Common && Common.Views && Common.Views.AdvancedSettingsWindow;
            var Field = window.Common && Common.UI && Common.UI.InputFieldBtnPassword;
            if (this.unprotectWin) return this.unprotectWin;
            if (!Win || !Field) return null;

            var enc = function (s) {
                var U = Common.Utils && Common.Utils.String;
                return U && U.htmlEncode ? U.htmlEncode(s) : String(s);
            };
            var CW = DE.Views.CompactWindows;
            var win = new Win({
                title: me.textUnprotectTitle,
                cls: 'vo-win vo-win--unprotect',
                width: 420,
                contentWidth: 372,      // 420 − body margins 2 × 24, as for the template windows
                separator: false,
                contentStyle: '',
                contentTemplate: '<div class="vo-unprotect">' +
                        '<label class="input-label">' + enc(me.textUnprotectPassword) + '</label>' +
                        '<div class="vo-unprotect-pwd"></div>' +
                    '</div>',
                buttons: [{value: 'ok', caption: (CW && CW.textApply) || 'OK', primary: true}, 'cancel'],
                /* true — the window stays open until the engine's answer. */
                handler: function (result) {
                    if (result !== 'ok') return false;
                    me.submitUnprotect(win);
                    return true;
                }
            });

            /* The field is built right after rendering: the stock focus manager
               collects the window fields at its show (FocusManager, window:show). */
            var render = win.render;
            win.render = function () {
                var res = render.apply(this, arguments);
                win.field = new Field({
                    el: this.$window.find('.vo-unprotect-pwd'),
                    type: 'password',
                    allowBlank: true,
                    validateOnBlur: false,
                    maxLength: 15,      // as in the stock protection removal window (controller/DocProtection.js)
                    ariaLabel: me.textUnprotectPassword
                });
                return res;
            };
            win.getFocusedComponents = function () {
                return [win.field].concat(win.getFooterButtons());
            };
            win.getDefaultFocusableComponent = function () { return win.field; };
            win.on('close', function () {
                if (me.unprotectWin === win) me.unprotectWin = null;
                me.done();
            });

            this.unprotectWin = win;
            win.show();
            return win;
        },

        /* The value is from the field node: getValue of the stock field gives the value of
           the last blur or Enter (InputField.js), while the window's Enter arrives
           earlier. */
        submitUnprotect: function (win) {
            var props = this.protectionProps();
            if (!props || !this.isProtected()) { win.close(); return; }
            var field = win.field, $input = field && field._input;
            var value = $input && typeof $input.val === 'function' ? $input.val() : (field ? field.getValue() : '');
            props.asc_setEditType(Asc.c_oAscEDocProtect.None);
            props.asc_setPassword(value == null ? '' : String(value));
            this.api.asc_setDocumentProtection(props);
        },

        onUnprotectError: function (id) {
            var win = this.unprotectWin, err = window.Asc && Asc.c_oAscError;
            if (!win || !err || id !== err.ID.PasswordIsNotCorrect) return;
            var field = win.field;
            if (!field) return;
            field.setValue('');
            if (field._input && typeof field._input.val === 'function') field._input.val('');
            field.focus();
        },

        onProtectionChange: function () {
            var win = this.unprotectWin;
            if (win && !this.isProtected()) win.close();
        },

        /* --- Co-editing ----------------------------------------- */

        /* The mode is held by a stock setting: the engine has no getter, and the start puts the
           mode into InternalSettings (controller/LeftMenu.js, applySettings). */
        isFastCoAuth: function () {
            return !!this.setting('de-settings-coauthmode');
        },

        /* The same gate as for the stock co-editing settings. The handler
           checks it again: the permission could have changed after the menu was built. */
        canChangeCoAuthMode: function () {
            var opts = this.options();
            return !!(this.rights().isEdit && !opts.isOffline && opts.canCoAuthoring &&
                      opts.canChangeCoAuthoring && this.has('asc_SetFastCollaborative') &&
                      this.has('asc_setAutoSaveGap'));
        },

        /* Fast mode — co-author edits are visible at once; strict — only
           after saving. The setting lives in localStorage the stock way, so
           we write there too, otherwise the stock interface will show a different value. */
        coAuthMode: function (fast) {
            if (!this.canChangeCoAuthMode()) return;
            /* Fast in FileMenuPanels turns on autosave. Without a nonzero
               gap the SDK does not start synchronization; Strict keeps the value of autosave
               chosen by the user. */
            if (fast) {
                this.api.asc_setAutoSaveGap(1);
                Common.localStorage.setItem('de-settings-autosave', 1);
                Common.Utils.InternalSettings.set('de-settings-autosave', 1);
            }
            this.api.asc_SetFastCollaborative(!!fast);
            Common.localStorage.setItem('de-settings-coauthmode', fast ? 1 : 0);
            Common.Utils.InternalSettings.set('de-settings-coauthmode', !!fast);
            this.done();
        },

        /* The zoom at the moment of the menu snapshot: {percent, type}, type 0 — own value,
           1 — fit to width, 2 — whole page (sdkjs word/api.js,
           sync_zoomChangeCallback). If the event came before the shell
           was built — then what the stock code has already shown: the fit buttons of the
           status bar (controller/Statusbar.js, _onZoomChange) and the last
           value of the "View" tab (controller/ViewTab.js, onZoomChange). */
        zoomState: function () {
            if (this.zoomNow) return this.zoomNow;
            var sb = DE.getController('Statusbar'), bar = sb && sb.statusbar;
            var vt = DE.getController('ViewTab'), st = vt && vt._state;
            var pressed = function (btn) { return !!(btn && btn.pressed); };
            var type = pressed(bar && bar.btnZoomToPage) ? 2 : pressed(bar && bar.btnZoomToWidth) ? 1 : 0;
            var percent = st && typeof st.zoomValue === 'number' ? st.zoomValue : null;
            return {percent: percent, type: type};
        },

        /* Paragraph marks and the table grid are the same saved settings as in the
           stock "Nonprinting characters ▸" (controller/Toolbar.js,
           onMenuNonPrintingToggle): the value to the engine, the choice to localStorage, it is
           read by the start (controller/Main.js). We move the ribbon button silently: put_ShowParaMarks
           sends no events about paragraph marks. */
        toggleParaMarks: function () {
            var next = this.ask('get_ShowParaMarks') !== true;
            this.api.put_ShowParaMarks(next);
            Common.localStorage.setItem('de-show-hiddenchars', next);
            var tb = DE.getController('Toolbar'), view = tb && tb.toolbar;
            view && view.btnShowHidenChars && view.btnShowHidenChars.toggle(next, true);
            this.done();
        },

        toggleTableGrid: function () {
            var next = this.ask('get_ShowTableEmptyLine') !== true;
            this.api.put_ShowTableEmptyLine(next);
            Common.localStorage.setItem('de-show-tableline', next);
            this.done();
        },

        /* Screen reader support is a user setting in this browser,
           like the checkbox of the advanced settings (view/FileMenuPanels.js): the choice in
           localStorage, the current value in InternalSettings, turning on — to the engine
           (controller/Main.js reads it at start by the same key). */
        isScreenReaderOn: function () {
            var settings = window.Common && Common.Utils && Common.Utils.InternalSettings;
            return !!(settings && settings.get('app-settings-screen-reader'));
        },

        toggleScreenReader: function () {
            var next = !this.isScreenReaderOn();
            Common.localStorage.setItem('app-settings-screen-reader', next ? 1 : 0);
            Common.Utils.InternalSettings.set('app-settings-screen-reader', next);
            this.api.setSpeechEnabled(next);
            this.done();
        },

        /* --- Edit ------------------------------------------------------------ */

        /* Paste from the menu. The browser almost always refuses the page to read the
           clipboard on command (execCommand('paste') — false), and then the engine itself
           pastes what was copied in this editor, from its internal
           buffer; Paste() still returns false (sdkjs
           common/clipboard_base.js, Button_Paste). So the result is decided not
           only by the answer of Paste(), but by the path the engine took — we read its
           state BEFORE the call:
             - the buffer is busy (IsWorking) — Paste() exits without an attempt, the paste
               is led by the operation already in progress; no hint;
             - the internal buffer is not empty — the engine pasted from it or refused by
               a lock; a hint is not needed in either case;
             - otherwise false means that there was no paste, — a hint with
               the key shortcut.
           Without access to the engine buffer state (another sdkjs build) — as in the
           stock code: a hint on any false. There is no "Pasted" message. */
        paste: function () {
            var cb = window.AscCommon && AscCommon.g_clipboardBase;
            var known = !!(cb && typeof cb.IsWorking === 'function');
            var busy = known && !!cb.IsWorking();
            var buffered = known && !!(cb.LastCopyBinary && cb.LastCopyBinary.length);
            if (this.api.Paste() || busy || buffered) return;
            this.pasteHint();
        },

        /* --- The message place in the menu bar ---------------------------- */
        /* The place is one (the menu bar live region, it is announced by the screen
           reader), and two write into it: the request to move to editing
           (a waiting indicator, then the host's answer or the general text) and the hint of
           a failed paste. The rule:
             - the request message holds until it is replaced by the next
               request message; an empty one removes it;
             - the paste hint is shown on top for 5 seconds and goes away by itself, and
               under it the current request message is visible again, if there is one;
             - a new request message removes the paste hint at once: it is
               newer.
           The text — only as text (textContent): the host's string is shown as
           is, it does not become markup. */
        requestStatus: '',
        pasteHintText: '',

        statusPlace: function () {
            var menu = this.shell && this.shell.menu;
            return menu && typeof menu.status === 'function' ? menu.status() : null;
        },

        renderStatus: function () {
            var el = this.statusPlace();
            if (!el) return;
            el.textContent = this.pasteHintText || this.requestStatus || '';
            /* While the request waits for an answer (the first 5 seconds) — a waiting icon before
               the indicator text; the paste hint shown on top — without it. */
            var main = DE.getController && DE.getController('Main');
            var busy = !this.pasteHintText && !!this.requestStatus &&
                !!(main && typeof main.isEditRequestWaiting === 'function' && main.isEditRequestWaiting());
            if (el.classList) el.classList.toggle('vo-busy', busy);
        },

        showRequestStatus: function (text) {
            clearTimeout(this.pasteHintTimer);
            this.pasteHintTimer = null;
            this.pasteHintText = '';
            this.requestStatus = typeof text === 'string' ? text : '';
            this.renderStatus();
        },

        /* The paste hint goes out by itself after 5 seconds. The text is its own for paste
           (textMenuPasteHint), and its own for paste without formatting, with two steps. */
        pasteHint: function (text) {
            var me = this;
            if (!this.statusPlace()) return;
            var keys = Common.Utils && Common.Utils.isMac ? '\u2318V' : 'Ctrl+V';
            this.pasteHintText = (text || this.textMenuPasteHint).replace('{0}', keys);
            this.renderStatus();
            clearTimeout(this.pasteHintTimer);
            this.pasteHintTimer = setTimeout(function () {
                me.pasteHintTimer = null;
                me.pasteHintText = '';
                me.renderStatus();
            }, 5000);
        },

        /* Paste without formatting. Text from other programs the page
           gets only this way — by reading the clipboard on click (navigator.clipboard);
           it is pasted by the pastePlain script. The browser refused, it has no clipboard
           reading or the script was not applied — a hint with two steps:
           paste with the shortcut, then "Keep text only" on the pasted one.
           An empty buffer does not change the document. The answer is Promise<boolean>: whether pasted. */
        pastePlain: function () {
            var me = this, hint = function () { me.pasteHint(me.textMenuPastePlainHint); return false; };
            var clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
            var read = null;
            try {
                read = clip && typeof clip.readText === 'function' ? clip.readText() : null;
            } catch (e) {
                read = null;
            }
            if (!read || typeof read.then !== 'function') return Promise.resolve(hint());
            return read.then(function (text) {
                var lines = me.plainLines(text);
                if (!lines) return false;
                return me.script('pastePlain', {lines: lines}).then(function (res) {
                    me.done();
                    return res.ok || hint();
                });
            }, hint);
        },

        /* The buffer lines: Windows and old Mac line breaks — as \n, empty
           lines stay empty paragraphs. An empty buffer — null. */
        plainLines: function (text) {
            if (typeof text !== 'string' || text === '') return null;
            return text.replace(/\r\n?/g, '\n').split('\n');
        },

        /* --- Insert: shape, text box, page number ------------------------ */

        /* A shape of type type or, without a type, a text box — at the caret, immediately selected
           (the shape script). The answer is Promise<boolean>: whether placed. */
        insertShape: function (type) {
            var me = this;
            return this.script('shape', type ? {type: type} : {box: true}).then(function (res) {
                me.done();
                return res.ok;
            });
        },

        /* The page number positions: which header/footer and alignment. */
        PAGE_NUMBER_AT: {
            bottomCenter: {header: false, jc: 'center'},
            bottomRight:  {header: false, jc: 'right'},
            topRight:     {header: true,  jc: 'right'}
        },

        /* The page number at position pos in all headers and footers of the document (the
           pageNumber script). The answer is Promise<boolean>: whether placed. */
        pageNumberAt: function (pos) {
            var me = this, at = this.PAGE_NUMBER_AT[pos];
            if (!at) return Promise.resolve(false);
            return this.script('pageNumber', at).then(function (res) {
                me.done();
                return res.ok;
            });
        },

        /* A script from SCRIPTS through CompactScript: Promise<{ok}>. */
        script: function (name, scope) {
            var runner = DE.Views.CompactScript;
            if (!runner || typeof runner.run !== 'function') return Promise.resolve({ok: false});
            return runner.run(this.SCRIPTS[name], scope);
        },

        autoCorrect: function () {
            if (this.autoCorrectWin && this.autoCorrectWin.isVisible && this.autoCorrectWin.isVisible()) return;
            this.autoCorrectWin = this.dialog('AutoCorrectDialog', {api: this.api});
        },

        /* --- View -------------------------------------------------------------- */
        /* The rulers in Compact are turned off by the shell, and it also manages them on
           a mode change, without asking us. So the CURRENT state we ask
           the engine (asc_GetViewRulers), and do not remember our own: our own flag diverged
           from the canvas after a trip to Advanced and back, and the first click on the item
           went for nothing — asc_SetViewRulers silently exits when the value
           is already such.

           But the CHOICE is remembered by the stock code, and not for itself alone. The rulers there are
           a saved setting `de-hidden-rulers`: localStorage plus
           InternalSettings, written by ViewTab.onChangeRulers, read at start in Main.
           Besides the start it is read by two more: the "View → Rulers" checkmark
           (view/ViewTab.js, the value is taken when the control is created) and
           the positioning of the formula settings popover (DocumentHolderExt,
           a shift of 19/26 px). The shell called only asc_SetViewRulers and did not touch the
           setting at all: the popover computed the shift by an outdated flag,
           the checkmark lied, and a hard true in restoreStockLook returned the rulers
           over the cleared checkmark after every Compact → Advanced circle.

           We split exactly as the stock code itself splits: InternalSettings — always, it is
           "what is now" (that is what the start in Main does, without writing to localStorage);
           localStorage — only when the decision was made by the USER (that is what
           ViewTab.onChangeRulers does). Turning the rulers off in compact is not
           a user decision — the shell calls setRulers with remember = false.

           We move the "View" checkmark ourselves: the stock code does not update it after creation
           anywhere (grep for chRulers — only creation, render and a subscription to
           change), because there the rulers do not change bypassing it.
           suspendchange — so as not to enter onChangeRulers a second time around.

           The rulers field stores no state: it is a fallback answer for an engine build
           without a getter (we disable the menu item by the presence of
           asc_SetViewRulers, not of the getter). The window "the sdk has not finished loading yet", where
           asc_SetViewRulers puts the value into tmpViewRulers, is not closed by the field —
           and must not be: the menu is built by CompactShell.create on app:ready, and it is sent by
           Main.onDocumentContentReady, when the sdk is already loaded. There is no sign of that window
           in the public api: the engine exposes only asc_* methods outward. */

        setRulers: function (show, remember) {
            var api = this.api;
            if (!api || typeof api.asc_SetViewRulers !== 'function') return;

            show = !!show;
            api.asc_SetViewRulers(show);
            this.rulers = show;

            Common.Utils.InternalSettings.set('de-hidden-rulers', !show);
            if (remember) Common.localStorage.setBool('de-hidden-rulers', !show);

            var vt = DE.getController('ViewTab');
            if (vt && vt.view && vt.view.chRulers) vt.view.chRulers.setValue(show, true);

            if (this.shell && this.shell.syncRulers) this.shell.syncRulers(show);
        },

        // Mode changes preserve the current SDK state, not a previous document's preference.
        rulersWanted: function () {
            var api = this.api;
            return api && typeof api.asc_GetViewRulers === 'function'
                ? !!api.asc_GetViewRulers() : !!this.rulers;
        },

        toggleRulers: function () {
            var api = this.api;
            var on = (typeof api.asc_GetViewRulers === 'function') ? !!api.asc_GetViewRulers() : !!this.rulers;
            /* A click on a menu item is the user's decision, and we remember it. */
            this.setRulers(!on, true);
            this.done();
        },

        rulers: false,

        /* --- Item scripts -------------------------------------------------- */
        /* The command bodies for CompactScript (its header has the rules): each is source
           text without closures, executed by the engine inside one action.
           s.Api — the Builder API, s.document — the engine document, s.scope — the data.
           true — apply; any other outcome cancels the whole command, the document
           stays as it was. */
        SCRIPTS: {

            /* The buffer lines (s.scope.lines) — as paragraphs at the caret, the formatting is
               at the paste location (KeepTextOnly). The selection is first deleted by the same
               path as in the stock paste (RemoveBeforePaste): the paragraphs at the edges of the
               selection merge. The first k − 1 lines — as paragraphs, the last
               — into a line with the remainder of the caret paragraph, as when pasting with the shortcut.
               InsertContent does not report a refusal, so the result is measured:
               the caret paragraph before the paste and k paragraphs in its place after, the neighbors
               are the same; the text after — the previous one with the pasted fragment inside. */
            pastePlain: function (s) {
                var api = s.Api, doc = api.GetDocument(), logic = s.document;
                var lines = s.scope && s.scope.lines;
                if (!lines || !lines.length || typeof logic.RemoveBeforePaste !== 'function') return false;
                var run = doc.GetCurrentRun();
                if (!run || !run.Run || run.Run.IsMathRun()) return false;
                /* Inside an action the engine does not check the content control prohibition:
                   the sdtLocked rule for the whole selection, before deleting the selection and
                   at the caret after it. */
                var locked = function () {
                    var sel = logic.IsSelectionUse(), info = logic.GetSelectedElementsInfo();
                    var sdts = logic.GetSelectedElementsInfo({CheckAllSelection: true}).GetAllSdts();
                    for (var n = 0; n < sdts.length; n++) {
                        var sdt = sdts[n];
                        var gone = sel && sdt.IsSelectedAll()
                            && info.GetInlineLevelSdt() !== sdt && info.GetBlockLevelSdt() !== sdt;
                        if (gone ? !sdt.CanBeDeleted() : !sdt.CanBeEdited()) return true;
                    }
                    return false;
                };
                if (locked()) return false;
                if (logic.IsSelectionUse()) logic.RemoveBeforePaste();
                if (logic.IsSelectionUse() || locked()) return false;

                var cur = doc.GetCurrentParagraph();
                var para = cur && cur.Paragraph;
                var box = para && para.GetParent();
                var at = para ? para.GetIndex() : -1;
                if (!box || at < 0 || box.GetElement(at) !== para) return false;
                var count = box.GetElementsCount();
                var prev = at > 0 ? box.GetElement(at - 1) : null;
                var next = at + 1 < count ? box.GetElement(at + 1) : null;
                /* The paragraph text the way the Builder API gives it (ApiParagraph.GetText), without numbering. */
                var read = function (p) {
                    return p.GetText({Numbering: false, Math: true, TabSymbol: '\t', NewLineSeparator: '\r'});
                };
                var before = read(para);

                var k = lines.length, i;
                var make = function (line) {
                    var p = api.CreateParagraph();
                    if (line) p.AddText(line);
                    return p;
                };
                var first = [];
                for (i = 0; i < k - 1; i++) first.push(make(lines[i]));
                if (first.length) doc.InsertContent(first, false, {KeepTextOnly: true});
                if (lines[k - 1]) doc.InsertContent([make(lines[k - 1])], true, {KeepTextOnly: true});

                if (box.GetElementsCount() !== count + k - 1) return false;
                if ((at > 0 ? box.GetElement(at - 1) : null) !== prev) return false;
                if ((at + k < box.GetElementsCount() ? box.GetElement(at + k) : null) !== next) return false;
                var parts = [];
                for (i = 0; i < k; i++) {
                    var got = box.GetElement(at + i);
                    if (!got || !got.IsParagraph()) return false;
                    parts.push(read(got));
                }
                var added = lines.join('\r\n'), after = parts.join('');
                if (after.length - before.length !== added.length) return false;
                var fits = function (pos) {
                    return after.slice(pos, pos + added.length) === added
                        && after.slice(0, pos) + after.slice(pos + added.length) === before;
                };
                if (k === 1) {
                    for (i = 0; i < before.length; i++) if (fits(i)) return true;
                    return false;
                }
                var pos = parts[0].length - lines[0].length - 2;
                if (pos < 0 || parts[0].slice(pos) !== lines[0] + '\r\n' || !fits(pos)) return false;
                for (i = 1; i < k - 1; i++) if (parts[i] !== lines[i] + '\r\n') return false;
                return parts[k - 1].slice(0, lines[k - 1].length) === lines[k - 1];
            },

            /* A shape s.scope.type or a text box (s.scope.box) — as a paragraph with it into
               the caret position (InsertContent): before the text, anchored to the character and
               line of the caret, the size — as in the stock insertion by click. The selection
               is not deleted but cleared. The shape gets into the document as a copy, and
               InsertContent hides an insertion refusal, so exactly one new
               shape of the document is considered placed. Then it is selected,
               and for a text box the caret is inside, to type right away. */
            shape: function (s) {
                var api = s.Api, doc = api.GetDocument(), logic = s.document, sc = s.scope || {};
                var run = doc.GetCurrentRun();
                if (!run || !run.Run || run.Run.IsMathRun()) return false;
                if (logic.IsSelectionUse()) logic.RemoveSelection();
                /* Inside an action the engine does not check the content control prohibition. */
                var sdts = logic.GetSelectedElementsInfo().GetAllSdts();
                for (var n = 0; n < sdts.length; n++) if (!sdts[n].CanBeEdited()) return false;
                var preset = sc.box ? 'textRect' : sc.type;
                var size = typeof AscFormat !== 'undefined' && typeof AscFormat.fGetDefaultShapeExtents === 'function'
                    ? AscFormat.fGetDefaultShapeExtents(preset) : null;
                var w = Math.round((size ? size.x : 25.4) * 36000), h = Math.round((size ? size.y : 25.4) * 36000);
                var shape;
                if (sc.box) {
                    /* A text box — as the stock one: a white fill, a thin black frame. */
                    shape = api.CreateShape('rect', w, h, api.CreateSolidFill(api.CreateSchemeColor('bg1')),
                        api.CreateStroke(6350, api.CreateSolidFill(api.CreateRGBColor(0, 0, 0))));
                } else {
                    /* CreateShape gives a shape an empty fill and outline; the reset
                       returns the theme styling, as for the stock shape. */
                    shape = api.CreateShape(sc.type, w, h);
                    shape.Shape.spPr.setFill(null);
                    shape.Shape.spPr.setLn(null);
                }
                shape.SetWrappingStyle('inFront');
                /* From a character the engine, like Word, counts from the start of the previous
                   character of the line: a shift by its width puts the object exactly at the caret,
                   not covering this character. At the line start there is no shift. */
                var para = run.Run.GetParagraph();
                var layout = para && typeof para.GetLayout === 'function'
                    ? para.GetLayout(para.Get_ParaContentPos(false, false), false) : null;
                var lead = layout && layout.ParagraphLayout ? layout.ParagraphLayout.LastItemW || 0 : 0;
                shape.SetHorPosition('character', Math.round(lead * 36000));
                shape.SetVerPosition('line', 0);
                var holder = api.CreateParagraph();
                holder.AddDrawing(shape);
                var known = doc.GetAllShapes().map(function (x) { return x.Shape; });
                doc.InsertContent([holder], true);
                var placed = doc.GetAllShapes().filter(function (x) { return known.indexOf(x.Shape) < 0; });
                if (placed.length !== 1) return false;
                var drawing = placed[0].getParaDrawing();
                if (!drawing || !drawing.IsUseInDocument()) return false;
                if (sc.box) {
                    placed[0].Shape.setTxBox(true);
                    placed[0].GetDocContent().GetElement(0).Select();
                } else {
                    placed[0].Select(true);
                }
                return true;
            },

            /* The page number into all headers and footers that show pages:
               the default, title (for sections with a special first page) and even
               (with different even and odd) views along the section chain — a section has
               its own header/footer or one inherited from the previous ones. s.scope.header —
               headers or footers, s.scope.jc — alignment.
               The previous number is carried over: PAGE fields (complex and simple) and page
               number marks are removed from all shown headers and footers without
               neighboring text; paragraphs are not deleted entirely. A missing view
               is created in the first section — the following ones inherit it and stay
               linked. The number is put as a new paragraph (in headers — first, in
               footers — last) or into the empty paragraph where the previous number was, or
               into the single empty paragraph of the header/footer. */
            pageNumber: function (s) {
                var api = s.Api, logic = s.document, sc = s.scope || {};
                var W = typeof AscWord !== 'undefined' ? AscWord : null;
                var has = function (o, name) { return !!o && typeof o[name] === 'function'; };
                if (!W || !has(W, 'CRunPageNum') || !has(W, 'CComplexField') || !has(W, 'CSimpleField')
                    || !has(W, 'ParaRun') || W.fieldtype_PAGE === undefined
                    || !has(W.CComplexField.prototype, 'GetInstruction') || !has(W.CComplexField.prototype, 'RemoveField')
                    || !has(W.CSimpleField.prototype, 'GetFieldType') || !has(W.CSimpleField.prototype, 'RemoveThisFromParent')
                    || !has(W.ParaRun.prototype, 'RemoveFromContent') || !has(logic, 'GetStyles')
                    || !has(logic, 'SaveDocumentState') || !has(logic, 'LoadDocumentState'))
                    return false;
                /* Removing a complex field selects it (RemoveField → SelectField) and moves the
                   caret into the header/footer. The caret and the document selection are returned to their place
                   in any outcome. */
                var kept = logic.SaveDocumentState(false);
                try {
                    return place();
                } finally {
                    logic.LoadDocumentState(kept);
                }

                function place() {
                    var sections = api.GetDocument().GetSections();
                    if (!sections || !sections.length) return false;
                    var even = sections[0].Section.IsEvenAndOdd() === true;
                    var shownTypes = function (sect) {
                        return ['default', 'title', 'even'].filter(function (t) {
                            return t === 'default' || (t === 'title' ? sect.IsTitlePage() === true : even);
                        });
                    };
                    /* The header/footer of kind t that section i shows: its own or that of the first
                       previous section that has one; at — the owner section. */
                    var shown = function (i, header, t) {
                        for (var j = i; j >= 0; j--) {
                            var hf = sections[j].Section.GetHdrFtr(header, t === 'title', t === 'even');
                            if (hf) return {hf: hf, at: j, type: t};
                        }
                        return null;
                    };
                    var collect = function (header) {
                        var found = [], missing = [];
                        sections.forEach(function (sect, i) {
                            shownTypes(sect.Section).forEach(function (t) {
                                var r = shown(i, header, t);
                                if (!r) {
                                    if (missing.indexOf(t) < 0) missing.push(t);
                                } else if (!found.some(function (f) { return f.hf === r.hf; })) {
                                    found.push(r);
                                }
                            });
                        });
                        return {found: found, missing: missing};
                    };

                    /* The previous numbers — first collect and check, then remove. */
                    var all = collect(true).found.concat(collect(false).found);
                    var complex = [], simple = [], marks = [], i;
                    for (i = 0; i < all.length; i++) {
                        var content = all[i].hf.GetContent();
                        if (!has(content, 'GetAllFields') || !has(content, 'GetAllParagraphs')) return false;
                        content.GetAllFields(false, []).forEach(function (f) {
                            if (f instanceof W.CComplexField) {
                                var ins = f.GetInstruction();
                                if (ins && ins.GetType() === W.fieldtype_PAGE && complex.indexOf(f) < 0) complex.push(f);
                            } else if (f instanceof W.CSimpleField) {
                                if (f.GetFieldType() === W.fieldtype_PAGE && simple.indexOf(f) < 0) simple.push(f);
                            }
                        });
                        content.GetAllParagraphs().forEach(function (p) {
                            p.CheckRunContent(function (r) {
                                for (var n = 0; n < r.Content.length; n++)
                                    if (r.Content[n] instanceof W.CRunPageNum)
                                        marks.push({run: r, item: r.Content[n], para: p});
                            });
                        });
                    }
                    var emptied = [];
                    var note = function (p) { if (p && emptied.indexOf(p) < 0) emptied.push(p); };
                    complex.forEach(function (f) {
                        var r = f.BeginChar && f.BeginChar.GetRun();
                        var p = r ? r.GetParagraph() : null;
                        f.RemoveField();
                        note(p);
                    });
                    simple.forEach(function (f) {
                        var p = typeof f.GetParagraph === 'function' ? f.GetParagraph() : null;
                        f.RemoveThisFromParent(false);
                        note(p);
                    });
                    marks.forEach(function (m) {
                        var n = m.run.Content.indexOf(m.item);
                        if (n < 0) return;
                        m.run.RemoveFromContent(n, 1);
                        note(m.para);
                    });

                    var header = !!sc.header;
                    collect(header).missing.forEach(function (t) {
                        if (header) sections[0].GetHeader(t, true);
                        else sections[0].GetFooter(t, true);
                    });
                    var places = collect(header);
                    if (places.missing.length || !places.found.length) return false;
                    var styles = logic.GetStyles();
                    var style = header ? styles.Get_Default_Header() : styles.Get_Default_Footer();
                    places.found.forEach(function (f) {
                        var box = header ? sections[f.at].GetHeader(f.type) : sections[f.at].GetFooter(f.type);
                        var count = box.GetElementsCount(), para = null;
                        for (var n = 0; n < count && !para; n++) {
                            var el = box.GetElement(n);
                            if (el && el.Paragraph && el.Paragraph.IsEmpty()
                                && (count === 1 || emptied.indexOf(el.Paragraph) >= 0))
                                para = el;
                        }
                        if (!para) {
                            para = api.CreateParagraph();
                            para.Paragraph.SetParagraphStyleById(style);
                            if (header) box.AddElement(0, para);
                            else box.Push(para);
                        }
                        para.SetJc(sc.jc);
                        para.AddPageNumber();
                    });
                    return true;
                }
            }
        },

        /* --- Texts ------------------------------------------------------------ */
        /* Defaults are English: the locale overrides them with a translation from
           `locale/<language>.json`, and the editor has 44 languages without
           a translation — this is what is shown there. The wording is checked against the stock one, where
           such a phrase already exists in the editor. */

        textAbout: 'About',
        textCollaboration: 'Collaboration',
        textColumns: 'Columns',
        textComments: 'Comments',
        textDownloadDocx: 'Download DOCX',
        textDownloadOdt: 'Download ODT',
        textDownloadPdf: 'Download PDF',
        textEdit: 'Edit',
        textEditDoc: 'Edit document',
        textFile: 'File',
        textFindReplace: 'Find and replace',
        textFitPage: 'Fit to page',
        textFitWidth: 'Fit to width',
        textFocus: 'Focus mode',
        textFormat: 'Format',
        textHelp: 'Help',
        textHfDiffFirst: 'Different first page',
        textHfDiffOdd: 'Different odd and even pages',
        textHfDistance: 'Distance from the edge',
        textHfLink: 'Link to previous section',
        textHfSettingsTitle: 'Header and footer settings',
        textHistory: 'Version history',
        textInsert: 'Insert',
        textInsertBtn: 'Insert',
        textMargins: 'Margins',
        textMenuAcceptAll: 'Accept all',
        textMenuAcceptChange: 'Accept',
        textMenuAddSpaceAfter: 'Add space after paragraph',
        textMenuAddSpaceBefore: 'Add space before paragraph',
        textMenuAlign: 'Align',
        textMenuAlignCenter: 'Center',
        textMenuAlignJustify: 'Justify',
        textMenuAlignLeft: 'Align left',
        textMenuAlignRight: 'Align right',
        textMenuAutoCorrect: 'AutoCorrect',
        textMenuBlankPage: 'Blank page',
        textMenuBold: 'Bold',
        textMenuBookmark: 'Bookmark',
        textMenuBreak: 'Break',
        textMenuBringToFront: 'Bring to front',
        textMenuCase: 'Change case',
        textMenuCaseLower: 'lowercase',
        textMenuCaseSentence: 'Sentence case',
        textMenuCaseToggle: 'tOGGLE cASE',
        textMenuCaseUpper: 'UPPERCASE',
        textMenuCaseWords: 'Capitalize Each Word',
        textMenuChanges: 'Changes',
        textMenuChart: 'Chart',
        textMenuClearFormatting: 'Clear formatting',
        textMenuCoedit: 'Co-editing',
        textMenuCoeditFast: 'Fast',
        textMenuCoeditStrict: 'Strict',
        textMenuColumnLeft: 'Column left',
        textMenuColumnRight: 'Column right',
        textMenuColumnsCustom: 'More columns',
        textMenuComment: 'Comment',
        textMenuCommentsHighlight: 'Highlight in text',
        textMenuCommentsPanel: 'Comments panel',
        textMenuCommentsResolved: 'Resolved comments',
        textMenuCompare: 'Compare',
        textMenuControl: 'Content control',
        textMenuControlCheckBox: 'Check box',
        textMenuControlComboBox: 'Combo box',
        textMenuControlDate: 'Date picker',
        textMenuControlDropDown: 'Drop-down list',
        textMenuControlPicture: 'Picture',
        textMenuControlPlain: 'Plain text',
        textMenuControlRemove: 'Remove content control',
        textMenuControlRich: 'Rich text',
        textMenuControlSettings: 'Control settings',
        textMenuCopy: 'Copy',
        textMenuCut: 'Cut',
        textMenuDecimalSeparator: '.',
        textMenuDeleteColumn: 'Delete column',
        textMenuDeleteRow: 'Delete row',
        textMenuDeleteTable: 'Delete table',
        textMenuDownloadAs: 'Download as',
        textMenuDownloadHtml: 'HTML (Zipped)',
        textMenuEditorHelp: 'Editor help',
        textMenuEndnote: 'Endnote',
        textMenuEquation: 'Equation',
        textMenuField: 'Field',
        textMenuFooter: 'Footer',
        textMenuFootnote: 'Footnote',
        textMenuFootnoteRegular: 'Footnote',
        textMenuFormattingMarks: 'Formatting marks',
        textMenuHeader: 'Header',
        textMenuHeaderFooter: 'Headers and page numbers',
        textMenuHorizontalLine: 'Horizontal line',
        textMenuHyphenation: 'Hyphenation',
        textMenuImage: 'Image',
        textMenuIndentIn: 'Increase indent',
        textMenuIndentOut: 'Decrease indent',
        textMenuItalic: 'Italic',
        textMenuLandscape: 'Landscape',
        textMenuLink: 'Link',
        textMenuListBullet: 'Bulleted',
        textMenuListMultilevel: 'Multilevel',
        textMenuListNumbered: 'Numbered',
        textMenuLists: 'Lists',
        textMenuListSettings: 'List settings',
        textMenuLtr: 'Left to right',
        textMenuMarginsCustom: 'Custom margins',
        textMenuMarginsModerate: 'Moderate',
        textMenuMarginsNarrow: 'Narrow',
        textMenuMarginsNormal: 'Normal',
        textMenuMarginsWide: 'Wide',
        textMenuMergeCells: 'Merge cells',
        textMenuNextChange: 'Next',
        textMenuNumberingFormat: 'Numbering format',
        textMenuNumberingLetter: 'a)',
        textMenuNumberingOutlineParen: '1) / a) / i)',
        textMenuObjectProps: 'Properties',
        textMenuOrientation: 'Orientation',
        textMenuPageBreak: 'Page break',
        textMenuPageCount: 'Page count',
        textMenuPageNumber: 'Page number',
        textMenuPageNumberBottomCenter: 'Bottom center',
        textMenuPageNumberBottomRight: 'Bottom right',
        textMenuPageNumberFormat: 'Format page numbers',
        textMenuPageNumberTopRight: 'Top right',
        textMenuPageSizeCustom: 'Custom size',
        textMenuParaStyles: 'Paragraph styles',
        textMenuPaste: 'Paste',
        textMenuPasteHint: 'Paste with {0}',
        textMenuPastePlain: 'Paste without formatting',
        textMenuPastePlainHint: 'Paste with {0}, then choose Paste options \u2192 Keep text only for the pasted text',
        textMenuPortrait: 'Portrait',
        textMenuPrevChange: 'Previous',
        textMenuPrint: 'Print',
        textMenuRedo: 'Redo',
        textMenuRejectAll: 'Reject all',
        textMenuRejectChange: 'Reject',
        textMenuRemoveSpaceAfter: 'Remove space after paragraph',
        textMenuRemoveSpaceBefore: 'Remove space before paragraph',
        textMenuRowAbove: 'Row above',
        textMenuRowBelow: 'Row below',
        textMenuRtl: 'Right to left',
        textMenuScreenReader: 'Screen reader support',
        textMenuSectionBreak: 'Section break',
        textMenuSendToBack: 'Send to back',
        textMenuShape: 'Shape',
        textMenuShapeArrow: 'Right arrow',
        textMenuShapeEllipse: 'Ellipse',
        textMenuShapeLine: 'Line',
        textMenuShapeRect: 'Rectangle',
        textMenuShapeRoundRect: 'Rounded rectangle',
        textMenuShare: 'Share',
        textMenuShortcuts: 'Keyboard shortcuts',
        textMenuShow: 'Show',
        textMenuShowFinal: 'Final version',
        textMenuShowMarkup: 'With changes',
        textMenuShowOriginal: 'Original version',
        textMenuSpacing: 'Spacing',
        textMenuSpacingMore: 'More spacing and indents',
        textMenuStrikeout: 'Strikethrough',
        textMenuStyleHeading1: 'Heading 1',
        textMenuStyleHeading2: 'Heading 2',
        textMenuStyleHeading3: 'Heading 3',
        textMenuStyleNormal: 'Normal text',
        textMenuSubscript: 'Subscript',
        textMenuSuperscript: 'Superscript',
        textMenuSymbol: 'Symbol',
        textMenuTable: 'Table',
        textMenuTableGridlines: 'Table gridlines',
        textMenuTableProps: 'Table properties',
        textMenuText: 'Text',
        textMenuTextBox: 'Text box',
        textMenuTextDirection: 'Text direction',
        textMenuTextToTable: 'Convert text to table',
        textMenuToc: 'Table of contents',
        textMenuTocInsert: 'Insert',
        textMenuTocRefresh: 'Refresh',
        textMenuTocSettings: 'Settings',
        textMenuTrackAll: 'Track changes for everyone',
        textMenuTrackMine: 'Track my changes',
        textMenuUnderline: 'Underline',
        textMenuUndo: 'Undo',
        textMenuUnprotect: 'Unprotect document',
        textMenuWatermark: 'Watermark',
        textMenuWrapInline: 'In line with text',
        textMenuWrapping: 'Wrapping',
        textMenuWrapSquare: 'Square',
        textMenuWrapTopBottom: 'Top and bottom',
        textMenuZoom: 'Zoom',
        textMenuZoomPercent: '{0}%',
        textMultipage: 'Multiple pages',
        textOutline: 'Document outline',
        textPageSize: 'Page size',
        textPrint: 'Print',
        textReasonControlLocked: 'The content control cannot be edited',
        textReasonFinal: 'Showing the final version',
        textReasonForAll: 'Turned on for everyone',
        textReasonForm: 'The document is open for filling in forms',
        textReasonNoChanges: 'No tracked changes',
        textReasonNoObject: 'No object selected',
        textReasonNoSelection: 'No text selected',
        textReasonNotInField: 'The cursor is not in a content control',
        textReasonNotInList: 'The cursor is not in a list',
        textReasonNotInTable: 'The cursor is not in a table',
        textReasonNoToc: 'The document has no table of contents',
        textReasonOriginal: 'Showing the original version',
        textReasonTracking: 'Unavailable while tracking changes',
        textRename: 'Rename',
        textRulers: 'Rulers',
        textSave: 'Save',
        textSelectAll: 'Select all',
        textToolbar: 'Toolbar',
        textUnprotectPassword: 'Enter the password to unprotect the document',
        textUnprotectTitle: 'Unprotect document',
        textView: 'View',
        txtTableGrid_ARIA: 'Insert table',
        txtTableSize_ARIA: '{0} × {1}'

    }, DE.Views.DocumentActions || {});

    return DE.Views.DocumentActions;
});
