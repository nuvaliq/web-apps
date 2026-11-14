/*
 * CompactBookmarks — the "Bookmarks" window in the compact shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Its own window on the Air template: a subclass of the stock BookmarksDialog. The data and
 * the bookmark manager calls are the same, the markup and rendering are its own: a row
 * "Bookmark name" + "Add", below it a list with a trash button in the row, a footer
 * "Go to" and "Get link". The look is drawn by the template (compact-windows.less,
 * the vo-win mark) and compact-bookmarks.less under the vo-win--bookmarks mark.
 *
 * The differences from the stock code are intentional:
 * the window does not close after "Add" and closes after "Go to"; after
 * "Add" the name field is cleared (the stock code leaves the name in it), the new bookmark
 * stays selected; the list is always by position, service and hidden
 * bookmarks are not shown;
 * deletion is by the trash button of its own row; "Get link" copies the portal's answer.
 * The session settings of the stock window (sorting, "Hidden") are not
 * written here: the Advanced window after work in compact opens as it was before.
 *
 * The window is opened by DocumentActions.bookmarks() — only in compact. In Advanced
 * the ribbon and menu open the untouched stock class.
 *
 * The class is built lazily: the stock BookmarksDialog arrives through
 * postLaunchScripts (app_dev.js:268), later than this module. The module does not import
 * the shell and DocumentActions — it is their dependency, that would make a
 * loop; CompactWindows, Icons and CompactToolbar are already loaded by the shell's define
 * by the first call.
 */
define([], function () {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    var LABEL = 'vo-win vo-win--bookmarks';

    var Dialog = null;      // the built class, one per session
    var linkBound = false;  // the subscription to the portal's link answer
    var current = null;     // the open compact window: the portal's answer goes to it
    var opening = null;     // the window whose rendering has not finished yet (abort)

    function enc(s) {
        return Common.Utils.String.htmlEncode(s == null ? '' : String(s));
    }

    /* The portal's answer to the link request arrives asynchronously, as a Gateway event.
       The subscription cannot be removed — Gateway has no off (Gateway.js:455), so it is
       one per module and passes the answer to the window that is open now.
       No window — the answer is not ours, we ignore it. */
    function bindLink() {
        if (linkBound || !window.Common || !Common.Gateway) return;
        linkBound = true;

        var M = DE.Views.CompactWindows, shell = M && M.shell;
        var onLink = function (url) {
            if (current) current.onActionLink(url);
        };
        Common.Gateway.on('setactionlink', shell && shell.guarded
            ? shell.guarded('закладки компакта: ссылка', onLink) : onLink);
    }

    function build(Base) {
        return Base.extend({

            /* Our own options object, not the stock one from the BookmarksDialog prototype:
               the stock initialize appends to this.options (BookmarksDialog.js:58),
               and without our own object the write would go into the stock Advanced window.
               The instance also gets a copy (initialize), so nothing is carried over
               between openings of compact either. */
            options: {
                width: 520,             // a window with a row of buttons, per the template; centering takes it too (Window.js:274)
                contentWidth: 472,      // 520 − body margins 2 × 24
                id: 'vo-window-bookmarks',
                cls: LABEL,
                separator: false,
                buttons: []             // assembled in initialize: "Get link" depends on the instance's rights
            },

            initialize: function (options) {
                var me = this;
                options = options || {};
                var app = options.appOptions || {};

                this.options = _.extend({}, this.options);

                /* Footer: "Go to" is the main one, "Get
                   link" — only with the right to links, there is no "Close" —
                   there are the X button and Esc. */
                var buttons = [{value: 'goto', caption: this.textGoto, primary: true}];
                if (app.canMakeActionLink) buttons.push({value: 'link', caption: this.textGetLink});

                /* What is passed last wins over the stock values
                   (BookmarksDialog.js:58–123): our own markup without the padding
                   of the stock panel and our own key handling. */
                Base.prototype.initialize.call(this, _.extend({}, options, {
                    buttons: buttons,
                    contentStyle: '',
                    contentTemplate: this.markup(),
                    keydowncallback: function (e) { return me.onKeys(e); }
                }));

                /* The stock code calls onPrimary on Enter, regardless of whether "Go to"
                   is disabled. guardEnter wraps keydowncallback, which
                   Window reads at the moment of the press (Window.js:209). */
                DE.Views.CompactWindows.guardEnter(this);
            },

            markup: function () {
                return '<div class="vo-bm">' +
                        '<div class="vo-bm-head">' +
                            '<div class="vo-bm-field">' +
                                '<label class="input-label">' + enc(this.textBookmarkName) + '</label>' +
                                '<div id="vo-bm-name"></div>' +
                            '</div>' +
                            '<div id="vo-bm-add" class="vo-bm-add"></div>' +
                        '</div>' +
                        '<div id="vo-bm-list" class="vo-bm-list"></div>' +
                    '</div>';
            },

            /* We do not call the stock render: it builds the controls of the stock window by
               global ids (sorting, "Hidden", the "Delete" buttons and the "Add"
               menu). The box, header and footer are rendered by the base. */
            render: function () {
                Common.Views.AdvancedSettingsWindow.prototype.render.call(this);

                var me = this, $w = this.$window, M = DE.Views.CompactBookmarks;
                current = opening = this;

                this.txtName = new Common.UI.InputField({
                    el: $w.find('#vo-bm-name'),
                    allowBlank: true,
                    validateOnChange: true,
                    validateOnBlur: true,
                    value: '',
                    maxLength: 40,
                    ariaLabel: this.textBookmarkName,
                    /* The stock check as is (BookmarksDialog.js:144–149):
                       "Add" is disabled for an empty and for an invalid name, the name
                       of an existing bookmark is not an error. */
                    validation: function (value) {
                        var check = me.props.asc_CheckNewBookmarkName(value),
                            exist = me.props.asc_HaveBookmark(value);
                        me.btnAdd.setDisabled(!check && !exist);
                        return (check || _.isEmpty(value) || exist) ? true : me.txtInvalidName;
                    }
                }).on('changing', function (input, value) {
                    /* As in the stock code: the name of an existing bookmark selects its row. */
                    var list = me.bookmarksList,
                        rec = me.props.asc_HaveBookmark(value) ? list.store.findWhere({value: value}) : null;
                    if (rec) {
                        list.selectRecord(rec);
                        list.scrollToRecord(rec);
                    } else
                        list.deselectAll();
                    me.syncFooter();
                });
                /* The error is text on the bottom edge of the field. */
                DE.Views.CompactWindows.edgeError(this.txtName);

                /* A button inside the window, without the dlg-btn class: getFooterButtons and
                   the footer handler take all .dlg-btn of the window. */
                this.btnAdd = new Common.UI.Button({
                    parentEl: $w.find('#vo-bm-add'),
                    cls: 'normal',
                    caption: this.textAdd,
                    disabled: true
                });
                this.btnAdd.on('click', _.bind(this.addBookmark, this));

                var trash = (DE.Views.Icons && DE.Views.Icons.svg('trash', 20)) || '',
                    title = enc(this.textDelete),
                    aria = enc(M.textDeleteName_ARIA),
                    empty = (DE.Views.CompactToolbar && DE.Views.CompactToolbar.textNoBookmarks) || '';

                this.bookmarksList = new Common.UI.ListView({
                    el: $w.find('#vo-bm-list'),
                    store: new Common.UI.DataViewStore(),
                    tabindex: 1,
                    emptyText: enc(empty),
                    /* The trash button is in the row itself. tabindex -1: from the keyboard
                       Delete on the row deletes. */
                    itemTemplate: function (data) {
                        var name = enc(data.value);
                        return '<span class="vo-bm-name">' + name + '</span>' +
                            '<button type="button" class="vo-bm-del" tabindex="-1" title="' + title + '"' +
                            ' aria-label="' + Common.Utils.String.format(aria, name) + '">' + trash + '</button>';
                    }
                });
                /* The list is always by position: the manager index is the order in
                   the text, the stock code sorts that way by "Location" (BookmarksDialog.js:186). */
                this.bookmarksList.store.comparator = function (rec) { return rec.get('location'); };
                this.bookmarksList.on('item:select', _.bind(this.onSelectBookmark, this));
                this.bookmarksList.on('item:deselect', _.bind(this.syncFooter, this));
                this.bookmarksList.on('item:dblclick', _.bind(this.onDblClickBookmark, this));
                this.bookmarksList.on('entervalue', _.bind(this.onPrimary, this));
                this.bookmarksList.on('item:keydown', _.bind(this.onListKey, this));
                this.bindTrash();

                var btns = this.getFooterButtons();
                for (var i = 0; i < btns.length; i++) {
                    var result = btns[i].cmpEl.attr('result');
                    if (result === 'goto') this.btnGoto = btns[i];
                    else if (result === 'link') this.btnLink = btns[i];
                }

                this.afterRender();
                this.syncFooter();
                opening = null;
            },

            /* The trash button deletes the bookmark of ITS OWN row and does not select the row. The row
               is selected by a click on the row itself (a handler on the row node),
               so a click on the trash button is intercepted on the list in the capture
               phase — before the selection. The rows are recreated on every
               list update, the list itself is not, so the listener is on it. */
            bindTrash: function () {
                var me = this, listEl = this.bookmarksList.$el[0];
                var hit = function (e) {
                    var del = $(e.target).closest('.vo-bm-del', listEl);
                    if (!del.length) return null;
                    e.stopPropagation();
                    e.preventDefault();
                    return del;
                };
                listEl.addEventListener('click', function (e) {
                    var del = hit(e);
                    /* The second click of a double click: the row under the pointer is already
                       the neighbor, and its trash button would delete a second bookmark.
                       The row was not found — we delete nothing: the selected one is not the right one. */
                    var rec = del && e.detail < 2 ? me.recordOf(del[0]) : null;
                    if (rec) me.deleteBookmark(rec);
                }, true);
                /* A double click on the trash button is not a go to the row's bookmark. */
                listEl.addEventListener('dblclick', hit, true);
            },

            recordOf: function (node) {
                var list = this.bookmarksList,
                    item = $(node).closest('.item', list.$el[0])[0],
                    views = list.dataViewItems || [];
                for (var i = 0; i < views.length; i++) {
                    if (views[i] && views[i].el === item) return views[i].model;
                }
                return null;
            },

            /* Delete on a row with focus. The list focus is on the list itself, the row
               under it is the selected one (the stock code moves the selection with arrows); a row
               that received focus by a click or after deletion is its own. ⌫ deletes
               too: on a Mac keyboard that is the Delete. */
            onListKey: function (list, rec, e) {
                var K = Common.UI.Keys;
                if (!e || (e.keyCode !== K.DELETE && e.keyCode !== K.BACKSPACE)) return;
                e.preventDefault();
                var item = $(e.target).closest('.item', list.$el[0]),
                    target = item.length ? this.recordOf(item[0]) : list.getSelectedRec();
                if (target) this.deleteBookmark(target);
            },

            /* Without an argument — the selected one, like the stock "Delete" button. */
            deleteBookmark: function (rec) {
                var list = this.bookmarksList;
                if (!rec || typeof rec.get !== 'function') rec = list.getSelectedRec();
                if (!rec) return;

                var store = list.store,
                    idx = store.indexOf(rec),
                    wasSel = !!rec.get('selected');

                this.props.asc_RemoveBookmark(rec.get('value'));
                store.remove(rec);

                if (wasSel) {
                    /* As in the stock code (BookmarksDialog.js:452): the name in the field was the name
                       of the deleted one, "Add" is disabled together with it. */
                    this.txtName.setValue('');
                    this.txtName.checkValidate();
                }
                this.syncFooter();

                /* Focus goes to the neighboring row:
                   the next one took the place of the deleted one, otherwise the previous one. If the list
                   became empty — focus stays on it. */
                var views = list.dataViewItems || [];
                if (views.length) {
                    var next = views[Math.min(Math.max(idx, 0), views.length - 1)];
                    next && next.$el && next.$el.focus();
                } else
                    list.focus();
            },

            refreshBookmarks: function () {
                if (!this.props || !this.bookmarksList) return;
                var props = this.props, arr = [], count = props.asc_GetCount();
                for (var i = 0; i < count; i++) {
                    var name = props.asc_GetName(i);
                    if (props.asc_IsInternalUseBookmark(name) || props.asc_IsHiddenBookmark(name)) continue;
                    var rec = new Common.UI.DataViewModel();
                    /* skipRenderOnChange: selecting a row changes only its classes and
                       does not redraw the node — a double click lands on the same
                       row, the trash button under the pointer does not vanish. */
                    rec.set({value: name, location: i, skipRenderOnChange: true});
                    arr.push(rec);
                }
                this.bookmarksList.store.reset(arr);
            },

            /* The stock afterRender disables in a closure the "Delete" button, which
               is absent here. The subscription to bookmark updates from co-authors and its removal
               on close are as in the stock code (BookmarksDialog.js:265–285). */
            afterRender: function () {
                var me = this;
                this.refreshBookmarks();

                var onUpdate = function () {
                    var list = me.bookmarksList,
                        sel = list.getSelectedRec(),
                        name = sel && sel.get('value');
                    me.refreshBookmarks();
                    if (name) {
                        var rec = list.store.findWhere({value: name});
                        if (rec) {
                            list.selectRecord(rec);
                            list.scrollToRecord(rec);
                        } else {
                            me.txtName.setValue('');
                            me.txtName.checkValidate();
                        }
                    }
                    me.syncFooter();
                };
                this.api.asc_registerCallback('asc_onBookmarksUpdate', onUpdate);
                this.on('close', function () {
                    me.api.asc_unregisterCallback('asc_onBookmarksUpdate', onUpdate);
                });
            },

            /* "Go to" and "Get link" are disabled until a bookmark is selected. */
            syncFooter: function () {
                var off = !(this.bookmarksList && this.bookmarksList.getSelectedRec());
                this.btnGoto && this.btnGoto.setDisabled(off);
                this.btnLink && this.btnLink.setDisabled(off);
            },

            onSelectBookmark: function (listView, itemView, record) {
                if (record) {
                    this.txtName.setValue(record.get('value'));
                    /* setValue does not call the check: without it the error of the previous input
                       would stay on the field edge with a valid name. */
                    this.txtName.checkValidate();
                }
                this.syncFooter();
            },

            /* The window stays open, the new bookmark is selected
               and visible in the list, and the name field is cleared. In the stock code the name after
               "Add" stays in the field.
               The clearing goes AFTER selectRecord: the selection synchronously reaches
               onSelectBookmark, and that puts the selected row's name into the field —
               had we cleared earlier, the name would come back. setValue does not call the check,
               hence checkValidate: an empty name disables "Add" via the stock
               validation (there is no error, empty is not an error) and removes the text of the previous error
               from the edge. "Go to" and "Get link" stay
               active: a bookmark is selected. Focus goes to the name field.
               Not found in the list (the engine did not place the bookmark) — we do not
               touch the field: the person sees what they typed. onUpdate does not arrive after its own
               "Add" (asc_onBookmarksUpdate is sent only by
               co-editing), so we update the list ourselves. */
            addBookmark: function () {
                var name = this.txtName.getValue();
                if (!name || this.btnAdd.isDisabled()) return;

                this.props.asc_AddBookmark(name);
                this.refreshBookmarks();
                var rec = this.bookmarksList.store.findWhere({value: name});
                if (rec) {
                    this.bookmarksList.selectRecord(rec);
                    this.bookmarksList.scrollToRecord(rec);
                    this.txtName.setValue('');
                    this.txtName.checkValidate();
                }
                this.syncFooter();
                this.txtName.focus();
            },

            /* "Go to" moves the cursor to the bookmark and closes the window; in the stock code
               the window stays. */
            gotoBookmark: function () {
                var rec = this.bookmarksList.getSelectedRec();
                if (!rec) return;
                this.props.asc_SelectBookmark(rec.get('value'));
                this.close();
            },

            /* The stock onPrimary does nothing (BookmarksDialog.js:316). Here
               Enter is "Go to"; false suppresses the press in Window. */
            onPrimary: function () {
                if (this.btnGoto && !this.btnGoto.isDisabled()) this.gotoBookmark();
                return false;
            },

            /* The footer is Window buttons, their click arrives here
               (AdvancedSettingsWindow.js:91). */
            onDlgBtnClick: function (event) {
                var $btn = $(event.currentTarget);
                if ($btn.hasClass('disabled') || $btn.is(':disabled')) return;
                var result = $btn.attr('result');
                if (result === 'goto') this.gotoBookmark();
                else if (result === 'link') this.getBookmarkLink();
            },

            /* Keys before the stock code (Window.js:209). true — the press is handled. */
            onKeys: function (e) {
                var K = Common.UI.Keys, $t = $(e.target), drop = this.copyDropdown;

                /* Esc with the link field open closes the field, not the window — like
                   the stock code (BookmarksDialog.js:60–72). */
                if (e.keyCode === K.ESC) {
                    var $p = drop && drop.box.parent();
                    if ($p && $p.hasClass('open')) {
                        $p.removeClass('open');
                        drop.parentBtn.focus();
                        return true;
                    }
                    return false;
                }
                if (e.keyCode !== K.RETURN) return false;

                /* Enter in the name field is "Add", it has its own button next to it. */
                if (this.txtName && $t.is(this.txtName._input)) {
                    if (this.btnAdd && !this.btnAdd.isDisabled()) this.addBookmark();
                    return true;
                }
                /* Enter on a button inside the window ("Add", "Copy") is its
                   action. Otherwise Window would call onPrimary, and with "Go to"
                   disabled guardEnter would suppress the press together with the button. */
                if ($t.is('button') && !$t.hasClass('dlg-btn')) {
                    if (!e.target.disabled) e.target.click();
                    return true;
                }
                /* In the field with the link Enter does nothing, as in the stock code. */
                if (drop && $t.closest(drop.box).length) return true;
                return false;
            },

            /* The request is the same as in the stock code (BookmarksDialog.js:460–469). There is no button
               without the right to links — so one cannot get here then. */
            getBookmarkLink: function () {
                var rec = this.bookmarksList.getSelectedRec();
                if (!rec || !this.btnLink) return;
                Common.Gateway.requestMakeActionLink({
                    action: {type: 'bookmark', data: rec.get('value')}
                });
            },

            /* The portal's answer. The link goes to the clipboard at once, the result is "Link
               copied" in the same button for 2.5 s. The clipboard is
               unavailable or refused (this happens inside a portal frame) — the stock
               field with the link and "Copy". */
            onActionLink: function (url) {
                var me = this;
                if (current !== this || !this.btnLink || !url) return;
                var fail = function () { me.showLinkField(url); };
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText)
                        navigator.clipboard.writeText(url).then(function () { me.showCopied(); }, fail);
                    else
                        fail();
                } catch (e) {
                    fail();
                }
            },

            showCopied: function () {
                if (current !== this || !this.btnLink) return;
                var me = this, M = DE.Views.CompactBookmarks;
                clearTimeout(this.copiedTimer);
                this.btnLink.setCaption(M.textCopied);
                this.copiedTimer = setTimeout(function () {
                    me.copiedTimer = null;
                    me.btnLink.setCaption(me.textGetLink);
                }, 2500);
            },

            showLinkField: function (url) {
                if (current !== this || !this.btnLink) return;
                if (!this.copyDropdown) {
                    /* The hidden toggle is needed by the logic of the bootstrap dropdown
                       menus: with it they close the field on a click outside, as in
                       the stock code (BookmarksDialog.js:89). */
                    var $wrap = $('<div class="vo-bm-copy">' +
                            '<button type="button" class="dropdown-toggle" data-toggle="dropdown" style="display: none"></button>' +
                        '</div>').appendTo(this.$window.find('.body > .footer'));
                    this.copyDropdown = this.createCopyDropdown(this.btnLink, $wrap, {left: 0});
                    /* The field and "Copy" appeared after the window was shown — we put them into the Tab
                       order ourselves, as the stock code does for its own (BookmarksDialog.js:255). */
                    if (Common.UI.FocusManager)
                        Common.UI.FocusManager.add(this, [this.copyDropdown.input, this.copyDropdown.button]);
                }
                /* The field's own subscription (BookmarksDialog.js:363) to this answer is already
                   too late — we set the value ourselves. */
                this.copyDropdown.input.setValue(url);
                var $p = this.copyDropdown.box.parent();
                if (!$p.hasClass('open')) $p.addClass('open').trigger('shown.bs.dropdown');
            },

            getFocusedComponents: function () {
                return [this.txtName, this.btnAdd, this.bookmarksList].concat(this.getFooterButtons());
            },

            /* Only the base's close: the stock one writes the window's session settings
               (BookmarksDialog.js:299–300), compact has none. */
            close: function () {
                if (current === this) current = null;
                if (this.copiedTimer) {
                    clearTimeout(this.copiedTimer);
                    this.copiedTimer = null;
                }
                return Common.Views.AdvancedSettingsWindow.prototype.close.apply(this, arguments);
            }
        });
    }

    DE.Views.CompactBookmarks = _.extend({

        /* The compact window class or null if the stock class does not exist yet. */
        ensure: function () {
            if (Dialog) return Dialog;
            if (!DE.Views.BookmarksDialog || !DE.Views.CompactWindows ||
                !(window.Common && Common.Views && Common.Views.AdvancedSettingsWindow)) return null;

            bindLink();
            Dialog = DE.Views.CompactBookmarksDialog = build(DE.Views.BookmarksDialog);
            return Dialog;
        },

        /* A show failure: a window whose rendering broke off is closed so that a second mask
           does not remain under the stock one. An already open window is not touched —
           the failure is not its. Best effort. */
        abort: function () {
            var win = opening;
            opening = null;
            if (win && win.$window) {
                try { win.close(); } catch (ignore) {}
            }
        },

        /* --- Texts ------------------------------------------------------------ */
        /* The default is English, the locale overrides it with the keys
           DE.Views.CompactBookmarks.*. The other window captions are the stock
           texts of BookmarksDialog, inherited. */

        textCopied: 'Link copied',
        textDeleteName_ARIA: 'Delete “{0}”'

    }, DE.Views.CompactBookmarks || {});

    return DE.Views.CompactBookmarks;
});
