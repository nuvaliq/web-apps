/*
 * SlashMenu — commands on "/" in the compact shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The "/" listener hangs on window in the capture phase — otherwise the event does not
 * reach us — but the character itself is not intercepted: preventDefault is not
 * called on it, "/" and the query typed after it are printed in the document, and when
 * a command is chosen they are erased (eraseTyped). The filtering input while the menu is
 * open likewise goes into the document: the menu only remembers what was typed.
 *
 * The composition is DocumentActions.SLASH: menu bar catalog items by key. Rights,
 * disabling with a reason and execution belong to the item, the state is by the shared model
 * (Common.UI.Compact.MenuModel) over the same ctx as the menu bar: no right —
 * no command, a disabled one is visible gray with a reason and is not executed. Its own here
 * is only the caption, the icon and the group hint.
 *
 * The caret position is taken from the stock asc_GetSelectionBounds(), as with
 * the floating panel.
 */
define([
    'documenteditor/main/app/view/Icons',
    'common/main/lib/view/compact/MenuModel'
], function (Icons, Model) {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    var ID = 'vo-slash';

    function model() {
        if (Model && typeof Model.state === 'function') return Model;
        return window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.MenuModel;
    }

    /* Icons — from the shared catalog Icons.js. A table of our own here has already managed to
       diverge from the catalog: `text` and `h1` were drawn with different outlines
       than the same names in the panel. */
    function svg(name) {
        return Icons && typeof Icons.svg === 'function' ? Icons.svg(Icons.has(name) ? name : 'text') : '';
    }

    /* The caption, icon and hint of a "/" command by the catalog item key. The captions
       are our own, with a verb ("Insert image"): in the menu an item has a short name in
       its section ("Insert → Image"), and "/" has no section. */
    var LOOK = {
        'format.style.heading1':   {t: 'textHeading1',       ic: 'h1',        hint: 'hintStyle'},
        'format.style.heading2':   {t: 'textHeading2',       ic: 'h2',        hint: 'hintStyle'},
        'format.style.heading3':   {t: 'textHeading3',       ic: 'h3',        hint: 'hintStyle'},
        'format.style.normal':     {t: 'textNormal',         ic: 'text',      hint: 'hintStyle'},
        'format.lists.bullet':     {t: 'textBulletList',     ic: 'bullet',    hint: 'hintList'},
        'format.lists.numbered':   {t: 'textNumberedList',   ic: 'numbered',  hint: 'hintList'},
        'insert.table':            {t: 'textTable',          ic: 'table',     hint: 'hintInsert'},
        'insert.image':            {t: 'textImage',          ic: 'image',     hint: 'hintInsert'},
        'insert.break.page':       {t: 'textPageBreak',      ic: 'pageBreak', hint: 'hintInsert'},
        'insert.comment':          {t: 'textComment',        ic: 'comment',   hint: 'hintCoauth'},
        'insert.link':             {t: 'textLink',           ic: 'link',      hint: 'hintInsert'},
        'insert.toc.add':          {t: 'textToc',            ic: 'toc',       hint: 'hintInsert'},
        'insert.footnote.regular': {t: 'textFootnote',       ic: 'footnote',  hint: 'hintInsert'},
        'insert.equation':         {t: 'textEquation',       ic: 'formula',   hint: 'hintInsert'},
        'insert.break.section':    {t: 'textSectionBreak',   ic: 'sectionBreak', hint: 'hintInsert'},
        'insert.break.blank':      {t: 'textBlankPage',      ic: 'blankPage', hint: 'hintInsert'},
        'insert.horizontalLine':   {t: 'textHorizontalLine', ic: 'horizontalLine', hint: 'hintInsert'}
    };

    DE.Views.SlashMenu = _.extend({

        api: null,
        $el: null,
        open: false,
        filter: '',
        index: 0,
        items: [],

        create: function (api) {
            if (!api || document.getElementById(ID)) return this;

            this.api = api;
            this.items = [];

            this.$el = $('<div id="' + ID + '"></div>').appendTo('body');
            this.bind();
            return this;
        },

        /* The Documents adapter of the menu bar: its ctx — rights, disable reasons and
           stock calls — is the same by which menu items are disabled. The menu bar
           may be absent (the shell is not fully built) — then an adapter of its own, a single one. */
        adapter: function () {
            var shell = DE.Views.CompactShell;
            if (shell && shell.menuAdapter) return shell.menuAdapter;
            if (!this._adapter && DE.Views.CompactMenuAdapter)
                this._adapter = DE.Views.CompactMenuAdapter.create(shell, this.api);
            return this._adapter || null;
        },

        /* The "/" commands now: catalog items from SLASH in its order, with
           the state by the model. Those invisible by right are skipped, disabled ones — with
           disabled and the reason text. Read at every show: rights and
           availability are taken at that moment. */
        buildItems: function () {
            var me = this, da = DE.Views.DocumentActions, M = model(), ad = this.adapter();
            if (!da || !M || !ad || typeof ad.context !== 'function') return [];
            var ctx = ad.context(), byKey = {};
            /* The section is the first level, its items and submenus — the second, the items of
               a submenu — the third; for a submenu item we remember the submenu itself. */
            da.sections().forEach(function (section) {
                (section.items || []).forEach(function (it) {
                    if (!it) return;
                    if (it.k) byKey[it.k] = {it: it};
                    (it.items || []).forEach(function (sub) {
                        if (sub && sub.k) byKey[sub.k] = {it: sub, parent: it};
                    });
                });
            });

            var out = [];
            (da.SLASH || []).forEach(function (cmd) {
                var rec = byKey[cmd.k], it = rec && rec.it;
                if (!it || typeof it.run !== 'function') return;
                var st = me.stateOf(rec, ctx);
                if (!st.visible) return;
                var look = LOOK[cmd.k] || {};
                var reason = st.disabled ? me.reasonText(st.reason) : null;
                out.push({
                    k: cmd.k, it: it, parent: rec.parent, args: cmd.args,
                    t: (look.t && me[look.t]) || st.label,
                    ic: look.ic || it.i,
                    hint: look.hint ? me[look.hint] : '',
                    disabled: !!st.disabled,
                    reason: reason
                });
            });
            return out;
        },

        /* The reason text is the same as in the menu bar (MenuBar.reasonText): the common reasons
           are told by it itself, the reasons of Documents and items — by the adapter. */
        reasonText: function (code) {
            if (typeof code !== 'string' || !code) return null;
            var C = window.Common && Common.UI && Common.UI.Compact, ad = this.adapter();
            if (C && C.MenuBar && typeof C.MenuBar.reasonText === 'function') return C.MenuBar.reasonText(ad, code);
            return ad && typeof ad.reasonText === 'function' ? ad.reasonText(code) : null;
        },

        /* The order of the adapter's disable reasons: the visible reason is the same as in the menu bar. */
        reasons: function () {
            var ad = this.adapter();
            return ad ? ad.reasons : undefined;
        },

        /* The command state the way the menu bar sees it: a submenu item is visible
           only while the submenu is visible (its right is the submenu's), and is disabled while
           the submenu is disabled, — with the item's reason, and without one — with the submenu's reason. */
        stateOf: function (rec, ctx) {
            var M = model(), order = this.reasons(), st = M.state(rec.it, ctx, order);
            if (!rec.parent || !st.visible) return st;
            var up = M.state(rec.parent, ctx, order);
            if (!up.visible) return up;
            if (up.disabled && !st.disabled)
                return {visible: true, disabled: true, reason: up.reason, checked: st.checked, label: st.label};
            return st;
        },

        /* Whether the command can be executed now: the state is re-read right before
           execution — a prohibition could have arrived while the list hung on the screen. */
        ready: function (item) {
            var ad = this.adapter();
            if (!item || !model() || !ad || typeof ad.context !== 'function') return false;
            var st = this.stateOf(item, ad.context());
            return !!st.visible && !st.disabled;
        },

        /* --- Keyboard interception -------------------------------------------- */

        bind: function () {
            var me = this;

            /* We listen on window in the capture phase: the editor sets its own
               handlers earlier than document, and the event did not reach us. */
            window.addEventListener('keydown', function (e) {
                /* In Advanced the menu is not our business: commands there are handled by
                   the stock ribbon, and the --vo-* tokens are declared only under
                   body.vo-compact — a popped-up list would be drawn without a background
                   over it. The modes are mutually exclusive, so
                   in the capture phase we intercept nothing here.
                   We close an open menu on the transition ourselves: otherwise it would pop up
                   again together with the compact view. */
                if (me.advanced()) { if (me.open) me.hide(); return; }

                /* The edit prohibition — the same rule and for the same reason: all
                   menu commands edit the document, there are no safe ones among them.
                   We close an already open one too: the prohibition could have arrived while the list hung
                   on the screen. */
                if (me.locked()) { if (me.open) me.hide(); return; }

                /* We check an open menu too: focus could have moved to search,
                   a comment or a dialog without a mouse click. */
                if (!me.inEditor(e.target)) { if (me.open) me.hide(); return; }

                if (me.open) return me.onKeyOpen(e);

                /* We recognize the key by the TYPED character and only by it.
                   e.code and e.keyCode speak of the physical key, not of the
                   character: on the Russian layout the same Slash key gives ".",
                   and the menu opened on every period — in "3.14", in abbreviations,
                   at the end of any sentence. The reverse half of the same
                   miss: "/" on the Russian layout is on a DIFFERENT key
                   (Shift+Backslash, code === 'Backslash'), and by code it could
                   not be caught at all — only the fallback keypress below worked.
                   e.key is the character per the UI Events specification, so it
                   is correct on both layouts at once.
                   Layouts whose keydown arrives without the needed key
                   are covered by the keypress subscription: there the character is seen as
                   charCode, and it is also about the character, not about the key. */
                if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;

                /* We intentionally do NOT intercept the character: "/"
                   and the query text are printed in the document, and are deleted when
                   a command is chosen. */
                me.show();
            }, true);

            /* Safety net: some layouts do not give a keydown with the needed key. */
            window.addEventListener('keypress', function (e) {
                if (!me.inEditor(e.target)) { if (me.open) me.hide(); return; }
                if (!me.open && !e.ctrlKey && !e.metaKey && !e.altKey &&
                    (e.key === '/' || e.charCode === 47)) {
                    me.show();
                }
            }, true);

            window.addEventListener('focusin', function (e) {
                if (me.open && !me.inEditor(e.target)) me.hide();
            }, true);

            /* Some SDK builds suppress mousedown after pointerdown; handle both before the SDK. */
            var dismiss = function (e) {
                if (me.open && !$(e.target).closest('#' + ID).length) me.hide();
            };
            window.addEventListener('pointerdown', dismiss, true);
            window.addEventListener('mousedown', dismiss, true);
        },

        /* The shell mode. The field is public, but the shell itself may not yet
           exist: the menu is created on the same app:ready and does not have to wait for it. */
        advanced: function () {
            var shell = DE.Views.CompactShell;
            return !!(shell && shell.advanced);
        },

        /* The stock edit prohibition. We ask the shell — it reads the stack of
           stock reasons (CompactShell.lockState), we have no answer of our own.
           The shell may not exist yet for the same reason as in advanced(). */
        locked: function () {
            var shell = DE.Views.CompactShell;
            return !!(shell && shell.editingLocked && shell.editingLocked());
        },

        /* Engine targets only. The SDK moves the HtmlArea outside #editor_sdk:
           it is #area_id, a textarea or contentEditable with child nodes.
           The other fields, including those inside the SDK area, are the interface. */
        inEditor: function (target) {
            if (!target) return false;
            var context = window.AscCommon && window.AscCommon.g_inputContext;
            var area = context && context.HtmlArea || document.getElementById('area_id');
            if (area && (target === area || area.contains(target))) return true;
            return $(target).is('#editor_sdk, #editor_sdk canvas');
        },

        onKeyOpen: function (e) {
            var k = e.key || '';   // without key the key is unknown to us — below it will close the menu

            if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); return this.hide(); }
            /* The general rule for an empty result — for arrows and for Enter/Tab below:
               we check the result BEFORE preventDefault. An empty result stayed
               reachable even with the gate: after a space the menu will legitimately open, and
               then one more "/" gets into the typed text — it comes here already,
               as the filter. That is how "01 /02/2026" hangs with filter = "02/2026" and
               the row "Nothing found". Interception in this
               state makes the key dead in the middle of typing a date: there is nothing to step through
               and apply, the caret stays in place, the paragraph is not inserted, and the menu does not
               close — the only exit is Escape or Backspace down to an empty filter.
               So with an empty result the menu no longer belongs to us: we close
               and give the key to the document untouched, exactly like the branch of an
               unhandled key at the end of the handler.
               A result of only disabled commands is the same empty one: there is nothing to execute in it,
               the arrows skip the disabled ones. */
            if (k === 'ArrowDown' || k === 'ArrowUp') {
                var next = this.step(k === 'ArrowDown' ? 1 : -1);
                if (next < 0) return this.hide();
                e.preventDefault(); e.stopPropagation();
                this.index = next;
                return this.render();
            }
            if (k === 'Enter' || k === 'Tab') {
                /* The same empty-result rule as for the arrows above. */
                if (this.first() < 0) return this.hide();
                e.preventDefault(); e.stopPropagation();
                return this.apply(this.index);
            }
            /* We do not intercept input — it goes into the document.
               The menu only tracks what was typed, to erase as much later. */
            if (k === 'Backspace') {
                if (e.altKey || e.ctrlKey || e.metaKey) return this.hide();
                if (!this.filter) { setTimeout(this.hide.bind(this), 0); return; }
                this.filter = this.filter.slice(0, -1);
                this.index = this.first();
                return setTimeout(this.render.bind(this), 0);
            }
            if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                this.filter += k;
                this.index = this.first();
                return setTimeout(this.render.bind(this), 0);
            }
            /* The modifier itself arrives as a separate keydown (Shift before a capital
               letter) — the menu does not react to it at all, otherwise typing starting with a capital
               letter would close the list. */
            if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' ||
                k === 'CapsLock' || k === 'AltGraph') return;
            /* Everything else — arrows sideways, Home/End, PageUp/PageDown, Delete,
               Ctrl combinations — moves the caret or edits the document bypassing the menu.
               These keys must not be intercepted, they are editor commands, but the menu
               must not be kept open either: filter would stay from the previous
               place, and eraseTyped() in apply() hits Backspace on the CURRENT
               caret and would eat someone else's text. So an unhandled key
               is treated as closing — exactly like a click outside the menu in bind(). The event
               goes to the document untouched: we do not call preventDefault here. */
            this.hide();
        },

        /* --- Rendering ------------------------------------------------------ */

        visible: function () {
            var f = this.filter.toLowerCase();
            if (!f) return this.items;
            return this.items.filter(function (i) {
                return i.t.toLowerCase().indexOf(f) >= 0;
            });
        },

        /* The first available command of the result or -1: the selection starts from it. */
        first: function () {
            var list = this.visible();
            for (var i = 0; i < list.length; i++) if (!list[i].disabled) return i;
            return -1;
        },

        /* The next available command in a circle toward dir (1 or -1), -1 — none at all. */
        step: function (dir) {
            var list = this.visible(), n = list.length;
            for (var d = 1; d <= n; d++) {
                var i = ((this.index + dir * d) % n + n) % n;
                if (!list[i].disabled) return i;
            }
            return -1;
        },

        /* --- A clear place to the left of the caret ---------------------------------- */
        /* Without this check "/" would open the menu at any
           place in a line: the list popped up in the middle of "01/02/2026", "and/or",
           "C:/temp" — over the typing of a date or a path.

           We ask the engine, not remember our own. asc_GetCurrentWord(-1) gives
           the word to the LEFT of the caret; it is a public export of sdkjs
           (asc_docs_api.prototype['asc_GetCurrentWord']), 0.017 ms per call, and
           the answer is correct regardless of how the caret got there — typing,
           arrows or a click. Our own keystroke history does not give that: after
           a mouse click it knows nothing about the character on the left.

           What the method returns was measured in a browser run:

             start of a paragraph, after a space, after a tab  → ""        we open
             inside the word "abc", caret after "ab"           → "ab"      we stay silent
             after a letter, after a digit                      → the word  we stay silent
             a Cyrillic letter + non-breaking space  → the letter + "\u00a0"  we stay silent
             after a period, comma, colon                      → the mark itself  we stay silent

           The last two rows are why the gate rests on this method,
           and not on a table of our own "letter or digit". The engine counts a non-breaking space
           as part of a word, and a punctuation mark as a separate word, and both
           answers are non-empty, that is, both close the menu. Enumerating
           characters ourselves cannot guess this: the engine has its own set of classes, and diverging
           from it we would get a gate that in some places is silent needlessly, and in
           others lets through.

           A non-empty selection is closed by a separate check: "/" will REPLACE it,
           and the command would apply not to what the user selected.
           We ask the selection TYPE, not its text: the answer does not depend on
           size (asc_GetSelectedText on a selected document collects the whole
           string) and it also covers a selected picture, which "/" would also
           wipe out. The text is a fallback path for builds without the plugin API.

           For a missing or failed method — we open. The gate here is
           a convenience, and the menu is the feature itself: staying silent costs more than
           letting the list through in the middle of a date. */
        atCleanSpot: function () {
            var api = this.api;
            if (!api) return false;

            try {
                if (typeof api.pluginMethod_GetSelectionType === 'function') {
                    if (api.pluginMethod_GetSelectionType() !== 'none') return false;
                } else if (typeof api.asc_GetSelectedText === 'function') {
                    if (api.asc_GetSelectedText()) return false;
                }
            } catch (e) { /* did not answer — we do not judge by the selection */ }

            try {
                if (typeof api.asc_GetCurrentWord === 'function') return !api.asc_GetCurrentWord(-1);
            } catch (e) { /* below: if absent — we open */ }

            return true;
        },

        show: function () {
            /* All three rules are located here, in the single funnel of showing, and not
               at the keydown handler. This is essential for the gate: the keyboard-layout
               keypress calls show() directly, bypassing keydown, and a gate at keydown
               would not have covered it — exactly the case of a
               synthetic keypress with charCode 47 without a
               preceding keydown. */
            if (this.advanced()) return;
            if (this.locked()) return;
            if (!this.atCleanSpot()) return;
            /* There is not a single command by right (view mode) — there is no menu. */
            this.items = this.buildItems();
            if (!this.items.length) return;
            this.open = true;
            this.filter = '';
            this.index = this.first();
            this.$el.addClass('open');
            this.render();
            this.position();
        },

        hide: function () {
            this.open = false;
            this.$el.removeClass('open');
        },

        render: function () {
            var me = this;
            var list = this.visible();
            this.$el.empty();

            if (!list.length) {
                this.$el.append($('<div class="vo-slash-empty"></div>').text(this.textEmpty));
                return;
            }

            /* A disabled command is gray, its reason is in place of the group hint
               (as for a menu bar item), and it is not executed. The class and aria-disabled,
               not disabled: the click is suppressed by apply. The look of a disabled one is by the vo-locked class
               (compact-shell.less). */
            list.forEach(function (item, i) {
                var $b = $('<button type="button" class="vo-slash-item"></button>')
                    .toggleClass('on', i === me.index)
                    .toggleClass('vo-locked', item.disabled)
                    .attr('aria-disabled', item.disabled ? 'true' : null)
                    .attr('title', item.disabled && item.reason ? item.reason : null)
                    .append($('<span class="vo-slash-i"></span>').html(svg(item.ic)))
                    .append($('<span class="vo-slash-t"></span>').text(item.t))
                    .append($('<span class="vo-slash-h"></span>').text(item.disabled && item.reason ? item.reason : item.hint))
                    .on('mousedown', function (e) { e.preventDefault(); })
                    .on('click', function () { me.apply(i); });
                $b.appendTo(me.$el);
            });
        },

        position: function () {
            var p = this.api.asc_GetSelectionBounds && this.api.asc_GetSelectionBounds();
            var off = $('#editor_sdk').offset() || {left: 0, top: 0};
            var x = off.left + 40, y = off.top + 40;

            if (p && p.length && p[0] && p[0].length >= 2) {
                x = p[0][0] + off.left;
                y = p[0][1] + off.top + 18;
            }

            var w = this.$el.outerWidth(), h = this.$el.outerHeight();
            x = Math.max(8, Math.min(x, $(window).width() - w - 8));
            if (y + h > $(window).height() - 8) y = Math.max(8, y - h - 26);

            this.$el.css({left: Math.round(x) + 'px', top: Math.round(y) + 'px'});
        },

        apply: function (i) {
            if (!this.open) return;
            var list = this.visible();
            /* Safety net: from the keyboard an empty result no longer gets here —
               onKeyOpen on Enter/Tab closes the menu and gives the key to the document
               BEFORE preventDefault, — and a click happens only on a rendered
               item (render draws buttons only for a non-empty list). If
               apply() is called otherwise, we exit before hide()/eraseTyped(): there is nothing to apply,
               and erasing would remove "/" and the query from the document without
               executing the command. */
            if (!list.length) return;
            /* The third end of the same gate, and it is not superfluous: a prohibition could have arrived
               between showing the list and choosing an item. We exit BEFORE eraseTyped —
               erasing would remove "/" and the query from the document without executing
               the command; we close because a menu under a prohibition is no longer ours
               by right. */
            if (this.locked()) return this.hide();
            var item = list[i];
            /* A disabled command is not executed, and the typed text stays: erasing
               "/" for the sake of a command that will not happen is not allowed. We re-read the state
               right here — it could have been disabled while the list hung. */
            if (!item || item.disabled || !this.ready(item)) {
                if (item && !item.disabled) {
                    this.items = this.buildItems();
                    this.index = this.first();
                    this.render();
                }
                return;
            }
            var typed = '/' + this.filter;   // "/" itself and the typed query
            this.hide();
            this.eraseTyped(typed);
            item.it.run(item.args);
        },

        /* We erase the typed text with the stock exported method.

           pluginMethod_InputText(text, textReplace) (apiBase_plugins.js:300-312)
           inside does exactly the same loop of emulated Backspace as the
           fallback path below: emulateKeyDownApi(8) → api.onKeyDown/onKeyUp
           (text_input2.js:1643-1649). It does NOT wrap it in a single history step —
           there is no executeGroupActions in this method.

           We take it not for history, but because the path is public and the event
           is built by the engine itself: it is marked emulated: true, and without this mark
           onKeyDown takes an early exit when focus is not in the editor
           (HtmlPage.js:2669-2673 — only Ctrl+P and Ctrl+S pass there).
           Plus the method's own gates: canEdit(), isPdfEditor(), the presence of
           g_inputContext. Our hand-made event object gives none of this,
           so the loop below is precisely the fallback path. */
        eraseTyped: function (typed) {
            var api = this.api;
            if (typeof api.pluginMethod_InputText === 'function') {
                try { return api.pluginMethod_InputText('', typed); } catch (e) { /* the fallback path is below */ }
            }
            /* The fallback path for builds without the plugin API. */
            if (typeof api.onKeyDown !== 'function') return;
            for (var i = 0; i < typed.length; i++) {
                try {
                    api.onKeyDown({
                        keyCode: 8, which: 8, key: 'Backspace',
                        ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
                        preventDefault: function () {}, stopPropagation: function () {}
                    });
                } catch (e) { return; }
            }
        },

        /* --- Texts ------------------------------------------------------------ */
        /* Defaults are English: the locale overrides them with a translation from
           `locale/<language>.json`, and the editor has 44 languages without
           a translation — this is what is shown there. */

        hintCoauth: 'Collaboration',
        hintInsert: 'Insert',
        hintList: 'List',
        hintStyle: 'Paragraph style',
        textBlankPage: 'Insert blank page',
        textBulletList: 'Apply bulleted list',
        textComment: 'Add comment',
        textEmpty: 'Nothing found',
        textEquation: 'Insert equation',
        textFootnote: 'Insert footnote',
        textHeading1: 'Heading 1',
        textHeading2: 'Heading 2',
        textHeading3: 'Heading 3',
        textHorizontalLine: 'Insert horizontal line',
        textImage: 'Insert image',
        textLink: 'Add or edit link',
        textNormal: 'Normal text',
        textNumberedList: 'Apply numbered list',
        textPageBreak: 'Insert page break',
        textSectionBreak: 'Insert section break',
        textTable: 'Insert 3×3 table',
        textToc: 'Insert table of contents'

    }, DE.Views.SlashMenu || {});

    return DE.Views.SlashMenu;
});
