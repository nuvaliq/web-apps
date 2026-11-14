/*
 * CompactLeft — the left area: comments, search, chat.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The panels are stock (Common.Views.Comments, search, chat) and stay in their stock
 * place: #left-menu comes in the layout before #editor-container, that is, to the left
 * of the thumbnail strip. Nodes are neither moved nor replaced. The icon column is
 * hidden in the shell, while the area itself is visible as long as the stock button of one of
 * its panels is pressed (body.vo-left-open, compact-areas.less).
 *
 * What changes for the time of Compact (in the "Stock interface" everything is undone):
 *  — showMenu of the left menu view (STOCK_PANELS): the stock one opens a panel only
 *    if its button in the icon column is visible, and there is no column;
 *  — toggling of the left menu group buttons: the stock thumbnail strip and the panels
 *    exclude each other (one group of buttons), while in the shell the panel stands next
 *    to the strip — pressing one does not release the other;
 *  — adding a comment (Comments.addDummyComment): the comments panel
 *    opens together with it — from any path, including the stock
 *    context menu.
 *
 * Shell commands: search, chat — the stock search and chat panels (they toggle),
 * searchBar — the stock floating search bar (toggles; its look is a card
 * under the panel magnifier, compact-areas.less), addComment — the counterpart of the ribbon
 * "Comment" (app:comment:add), the right is the stock one (canCoAuthoring && canComments), including
 * without edit rights.
 *
 * Icons of the stock nodes that the area styles repaint (the search bar and panel,
 * comments, the show panel, buttons on a slide) are AIR masks: the addresses
 * are set by this module as variables on the document root (paintIcons).
 *
 * The frame (CompactShell) installs the zone by calling install(shell) in the order of
 * CompactShell.ZONES.
 */
define([], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    /* Panels of the left area that the stock code opens with its showMenu(<name>)
       (view/LeftMenu.js): the button of the left menu view and the right to the panel — the same
       condition under which the stock controller shows the button
       (controller/LeftMenu.js, setMode). after — the view event after opening,
       as in the stock showMenu. */
    var STOCK_PANELS = {
        comments: {
            btn: 'btnComments',
            right: function (m) { return !!m.canCoAuthoring && !!m.canViewComments && !m.isLightVersion; }
        },
        chat: {
            btn: 'btnChat',
            right: function (m) { return !!m.canCoAuthoring && !!m.canChat && !m.isLightVersion; },
            focus: 'panelChat'
        },
        advancedsearch: {
            btn: 'btnSearchBar',
            right: function () { return true; },
            after: 'search:aftershow'
        }
    };

    /* Buttons of the left menu group by kind: the thumbnail strip and the area panels. */
    var THUMBS = 'btnThumbs';
    var PANEL_BUTTONS = ['btnComments', 'btnChat', 'btnSearchBar'];

    var OPEN_CLASS = 'vo-left-open';

    /* Widths of the left menu of the stock view (view/LeftMenu.js): the icon column
       (SCALE_MIN) and the open panel by default (MENU_SCALE_PART). */
    var MIN_WIDTH = 40, PANEL_WIDTH = 300;

    /* Search bar: notification of its visibility (by it the panel magnifier is pressed —
       CompactToolbar, the control's toggle field), the panel magnifier at which the bar
       stands, and the gap between the bottom of the panel card and the bar — as in documents. */
    var SEARCH_BAR_NOTE = 'vo:search-bar';
    var SEARCH_ANCHOR = '#vo-tb [data-vo="search"]';
    var SEARCH_GAP = 8;

    /* Icons of the stock area nodes. The names are files of the shared set of editors
       (apps/common/main/resources/img/air), the variables are --vo-ar-ico-<name>. The address is
       absolute from the document, as in Common.UI.Compact.Icons: a relative url()
       inside var() would be resolved from the consumer's stylesheet. */
    var ICONS = ['chevron', 'chevronL', 'chevronR', 'more', 'close', 'check', 'accept', 'pencil', 'trash',
                 'play', 'pause', 'focus', 'paste', 'chart'];
    var ICON_VAR = '--vo-ar-ico-';
    var AIR_BASE = '../../common/main/resources/img/air/';

    function ctl(name) {
        try { return (PE.getController && PE.getController(name)) || null; } catch (e) { return null; }
    }

    function leftView() {
        var c = ctl('LeftMenu');
        return (c && c.leftMenu) || null;
    }

    function disabled(btn) {
        return typeof btn.isDisabled === 'function' ? !!btn.isDisabled() : !!btn.disabled;
    }

    PE.Views.CompactLeft = _.extend({

        STOCK_PANELS: STOCK_PANELS,
        OPEN_CLASS: OPEN_CLASS,
        ICONS: ICONS,

        shell: null,
        undo: null,          // undoing the stock overrides; null — no overrides
        hold: null,          // kind of the button being pressed now: 'thumbs' | 'panel'

        install: function (shell) {
            var me = this, nc = Common.NotificationCenter;
            var guarded = shell.guarded;
            this.shell = shell;

            shell.command('search', guarded('left: search', function () { return me.toggleSearch(); }));
            shell.command('searchBar', guarded('left: search bar', function () { return me.toggleSearchBar(); }));
            shell.command('chat', guarded('left: chat', function () { return me.toggleChat(); }));
            shell.command('addComment', guarded('left: add comment', function () { return me.addComment(); }));

            /* Comment icon at the anchor point on a slide: the stock handler
               shows the comment, the shell opens the panel. */
            shell.onApi('asc_onShowComment', function () {
                if (me.active()) me.openPanel('comments');
            });

            nc.on('layout:changed', guarded('left: layout', function () {
                me.sync(true);
                me.placeSearchBar();
            }));
            nc.on('shell:advanced', guarded('left: advanced', function (advanced) {
                if (advanced) me.unbind(); else me.bind();
                me.paintIcons(!advanced);
                me.sync(true);
            }));
            this.bindSearchBar(guarded);

            this.bind();
            this.paintIcons(!shell.advanced);
            this.sync(false);
        },

        /* The shell is built and not in the "Stock interface". */
        active: function () {
            var s = this.shell;
            return !!s && !s.advanced && !s.startupFailed && !!document.getElementById('vo-shell') &&
                document.body.classList.contains('vo-compact');
        },

        /* --- Panels ------------------------------------------------------------ */

        /* The panel can be opened: there is the right, the stock code did not hide the button,
           the integrator did not remove the left menu (the condition of the stock tryToShowLeftMenu). */
        allowed: function (view, name) {
            var p = STOCK_PANELS[name], btn = p && view && view[p.btn];
            if (!btn) return false;
            var m = view.mode || {};
            if (!p.right(m) || btn.hidden === true) return false;
            if (m.canBrandingExt && m.customization && m.customization.leftMenu === false) return false;
            var LM = Common.UI && Common.UI.LayoutManager;
            return !(LM && typeof LM.isElementVisible === 'function' && LM.isElementVisible('leftMenu') === false);
        },

        /* The same condition for entries into the panel outside the left area (the toolbar
           button, the menu row item): without the right the entry is not drawn, instead of
           opening an empty panel. The stock code hands out the rights after app:ready
           (LeftMenu.setMode), so the condition is read on every recount. */
        can: function (name) {
            return this.allowed(leftView(), name);
        },

        isOpen: function (name) {
            var p = STOCK_PANELS[name], view = leftView(), btn = p && view && view[p.btn];
            return !!btn && btn.pressed === true;
        },

        /* Open a panel the same way as the stock showMenu: press the panel
           button and hand it to the stock onBtnMenuClick. The stock showMenu does not touch
           an already open panel — and here it is the same. */
        openPanel: function (name) {
            var p = STOCK_PANELS[name], view = leftView();
            if (!p || !view || !this.allowed(view, name)) return false;
            var btn = view[p.btn];
            if (btn.pressed) return true;
            if (disabled(btn)) return false;
            btn.toggle(true);
            view.onBtnMenuClick(btn);
            var focus = p.focus && view[p.focus];
            focus && typeof focus.focus === 'function' && focus.focus();
            return true;
        },

        /* Close — like the stock onShowHideSearch(false) and onShowHideChat(false). */
        closePanel: function (name) {
            var p = STOCK_PANELS[name], view = leftView(), btn = p && view && view[p.btn];
            if (!btn || !btn.pressed) return false;
            btn.toggle(false, true);
            view.onBtnMenuClick(btn);
            return true;
        },

        /* Search: the controller's stock onShowHideSearch (the same as for Ctrl+H) — the panel
           is shown by the overridden showMenu. */
        toggleSearch: function () {
            var lm = ctl('LeftMenu');
            var open = this.isOpen('advancedsearch');
            if (lm && typeof lm.onShowHideSearch === 'function') {
                lm.onShowHideSearch(!open);
                return true;
            }
            return open ? this.closePanel('advancedsearch') : this.showMenu('advancedsearch');
        },

        /* Chat: the stock onShowHideChat ("Chat" of the "Collaboration" tab). */
        toggleChat: function () {
            var lm = ctl('LeftMenu');
            var open = this.isOpen('chat');
            if (lm && typeof lm.onShowHideChat === 'function') {
                lm.onShowHideChat(!open);
                return true;
            }
            return open ? this.closePanel('chat') : this.showMenu('chat');
        },

        showMenu: function (name) {
            var view = leftView();
            if (!view || typeof view.showMenu !== 'function') return false;
            view.showMenu(name);
            return this.isOpen(name);
        },

        /* --- Search bar --------------------------------------------------------- */
        /* The stock window Common.UI.SearchBar (Ctrl+F, the panel magnifier): the Viewport controller
           creates it lazily on the first search:show and keeps it in searchBar. The look is
           a card under the panel magnifier (compact-areas.less), the behavior is stock. While
           the bar is visible, the magnifier is pressed; a click outside the bar closes it. The left panel
           "Search and Replace" is a separate command search ("Edit → Find and
           Replace", Ctrl+H, the bar's "⋮"). */

        searchBarView: function () {
            var vp = ctl('Viewport');
            return (vp && vp.searchBar) || null;
        },

        searchBarShown: function () {
            var bar = this.searchBarView();
            return !!bar && typeof bar.isVisible === 'function' && !!bar.isVisible();
        },

        /* Magnifier: the bar is visible — close it, otherwise the stock search:show (with the open
           left search panel the stock gives focus to the panel instead of the bar). */
        toggleSearchBar: function () {
            if (this.searchBarShown()) {
                this.searchBarView().hide();
                return true;
            }
            Common.NotificationCenter.trigger('search:show');
            return true;
        },

        bindSearchBar: function (guarded) {
            var me = this, nc = Common.NotificationCenter;
            /* The stock search:show handler is subscribed earlier than the shell zones: by our
               call the bar is already created and shown. */
            nc.on('search:show', guarded('left: search bar shown', function () {
                me.watchSearchBar();
                me.placeSearchBar();
                me.noteSearchBar();
            }));
            if (typeof window.addEventListener !== 'function') return;
            window.addEventListener('resize', guarded('left: search bar resize', function () { me.placeSearchBar(); }));
            /* Capture on window: the engine canvas stops the press from bubbling. A press on the
               magnifier itself is handled by its command. */
            window.addEventListener('pointerdown', guarded('left: search bar outside', function (e) {
                if (!me.active() || !me.searchBarShown()) return;
                var t = e && e.target;
                if (t && typeof t.closest === 'function' && (t.closest('.asc-window.search-bar') || t.closest(SEARCH_ANCHOR))) return;
                me.searchBarView().hide();
            }), true);
        },

        /* Showing and hiding the bar (including by its cross, Esc and "⋮") — the pressed state of the magnifier. */
        watchSearchBar: function () {
            var bar = this.searchBarView(), me = this;
            if (!bar || bar._voWatched || typeof bar.on !== 'function') return;
            bar._voWatched = true;
            var note = this.shell && typeof this.shell.guarded === 'function'
                ? this.shell.guarded('left: search bar state', function () { me.noteSearchBar(); })
                : function () { me.noteSearchBar(); };
            bar.on('show', note);
            bar.on('hide', note);
        },

        noteSearchBar: function () {
            Common.NotificationCenter.trigger(SEARCH_BAR_NOTE, this.active() && this.searchBarShown());
        },

        /* Place of the card — variables on body: the left edge of the magnifier (--vo-search-left) and
           the top (--vo-search-top) SEARCH_GAP below the panel card, and without it — below the
           shell rows. The magnifier is not visible (the panel is hidden, the magnifier is in "⋯") — there is no
           left variable, the card is at the left margin. */
        placeSearchBar: function () {
            var st = document.body && document.body.style;
            if (!st || typeof st.setProperty !== 'function') return;
            if (!this.active()) {
                st.removeProperty('--vo-search-left');
                st.removeProperty('--vo-search-top');
                return;
            }
            var lupa = this.searchAnchor();
            if (lupa) st.setProperty('--vo-search-left', Math.round(lupa.left) + 'px');
            else st.removeProperty('--vo-search-left');
            var top = this.searchTop();
            if (top) st.setProperty('--vo-search-top', top + 'px');
            else st.removeProperty('--vo-search-top');
        },

        searchAnchor: function () {
            if (typeof document.querySelectorAll !== 'function') return null;
            var list = document.querySelectorAll(SEARCH_ANCHOR);
            for (var i = 0; i < list.length; i++) {
                var b = list[i];
                if (typeof b.closest === 'function' && (b.closest('[hidden]') || b.closest('.vo-more-wrap'))) continue;
                var r = b.getBoundingClientRect();
                if (r && r.width > 0 && r.height > 0) return r;
            }
            return null;
        },

        searchTop: function () {
            var card = document.getElementById('vo-toolbar'), rows = document.getElementById('vo-shell');
            var r = card && typeof card.getBoundingClientRect === 'function' ? card.getBoundingClientRect() : null;
            if (r && r.height > 0) return Math.round(r.bottom) + SEARCH_GAP;
            r = rows && typeof rows.getBoundingClientRect === 'function' ? rows.getBoundingClientRect() : null;
            return r ? Math.round(Math.max(0, r.bottom)) + SEARCH_GAP : 0;
        },

        /* --- Icons -------------------------------------------------------------- */
        /* Turning off removes everything that was set: the "Stock interface" and a startup rollback. */
        paintIcons: function (on) {
            var root = document.documentElement, style = root && root.style;
            if (!style || typeof style.setProperty !== 'function') return;
            var base = '';
            try { base = on && document.baseURI ? new URL(AIR_BASE, document.baseURI).href : ''; } catch (e) { base = ''; }
            for (var i = 0; i < ICONS.length; i++) {
                if (base) style.setProperty(ICON_VAR + ICONS[i], 'url(' + base + ICONS[i] + '.svg)');
                else style.removeProperty(ICON_VAR + ICONS[i]);
            }
        },

        /* Add a comment — the counterpart of the ribbon "Comment": the stock
           app:comment:add. The stock code does not create the button when the ribbon has no
           place for it (without edit rights) — then the same event, if the right
           to comment exists. A disabled counterpart (no slides, connection lost,
           slide master) — refusal. The panel is opened by the addDummyComment wrapper. */
        addComment: function () {
            var bridge = PE.Views.StockBridge, ref = 'ToolbarCtl:btnsComment.0';
            if (bridge && bridge.twin(ref)) return bridge.run(ref);
            var m = (ctl('Main') || {}).appOptions || (leftView() || {}).mode || {};
            if (!m.canCoAuthoring || !m.canComments) return false;
            Common.NotificationCenter.trigger('app:comment:add', 'toolbar');
            return true;
        },

        /* --- Stock overrides ----------------------------------------------------- */

        bind: function () {
            if (this.undo) return;
            var me = this, undo = [];
            var view = leftView();
            if (!view) return;

            var replace = function (obj, name, fn) {
                if (!obj || typeof obj[name] !== 'function') return;
                var own = Object.prototype.hasOwnProperty.call(obj, name), orig = obj[name];
                var wrapped = fn(orig);
                obj[name] = wrapped;
                undo.push(function () {
                    if (obj[name] !== wrapped) return;
                    if (own) obj[name] = orig; else delete obj[name];
                });
            };

            /* showMenu: area panels — their own way, the rest (file) and refusal —
               the stock way. The wrapper is called by the stock onShortcut, onShowHideSearch,
               onShowHideChat, so an exception does not go outward. */
            replace(view, 'showMenu', function (orig) {
                return function (menu, opts, suspendAfter) {
                    var done = false;
                    try {
                        if (me.active() && STOCK_PANELS.hasOwnProperty(menu)) {
                            var was = me.isOpen(menu);
                            done = me.openPanel(menu);
                            var after = STOCK_PANELS[menu].after;
                            if (done && !was && after && !suspendAfter) this.fireEvent(after);
                        }
                    } catch (e) {
                        done = false;
                    }
                    if (!done) return orig.apply(this, arguments);
                };
            });

            /* Left menu group buttons: while a button of one kind is being pressed,
               the group does not release a button of the other kind. */
            var kind = function (name) { return name === THUMBS ? 'thumbs' : 'panel'; };
            [THUMBS].concat(PANEL_BUTTONS).forEach(function (name) {
                replace(view[name], 'toggle', function (orig) {
                    return function (state) {
                        var on = state === undefined ? !this.pressed : !!state;
                        if (!on && me.hold && me.hold !== kind(name) && me.active()) return;
                        var prev = me.hold;
                        if (on) me.hold = kind(name);
                        try {
                            return orig.apply(this, arguments);
                        } finally {
                            me.hold = prev;
                            if (!prev) me.sync(false);
                        }
                    };
                });
            });

            /* A comment is added by any path — the comments panel is open. */
            replace(ctl('Common.Controllers.Comments'), 'addDummyComment', function (orig) {
                return function () {
                    try {
                        if (me.active()) me.openPanel('comments');
                    } catch (e) { /* adding matters more than the panel */ }
                    return orig.apply(this, arguments);
                };
            });

            this.undo = undo;
        },

        unbind: function () {
            var undo = this.undo;
            this.undo = null;
            this.hold = null;
            (undo || []).forEach(function (f) { f(); });
        },

        /* --- Area visibility ------------------------------------------------- */
        /* The area is visible while a button of one of its panels is pressed. The class is set
           immediately on press — before the stock layout:changed, which lays out the
           columns and calls api.Resize. relayout — recompute the layout if the
           class changed later (layout:changed has already passed). */
        sync: function (relayout) {
            var view = leftView();
            var open = this.active() && !!view && PANEL_BUTTONS.some(function (name) {
                return !!view[name] && view[name].pressed === true;
            });
            var changed = open && this.ensureWidth(view);
            var cl = document.body.classList;
            if (cl.contains(OPEN_CLASS) !== open) {
                cl.toggle(OPEN_CLASS, open);
                changed = true;
            }
            if (changed && relayout) this.relayout();
        },

        /* Width of the open area. The stock onBtnMenuClick of the thumbnail strip narrows
           the left menu to the icon column (40), while in the shell the panel stays
           open next to the strip: the width is the same as the stock opening of the
           panel sets (the remembered one or 300). */
        ensureWidth: function (view) {
            var $el = view.$el;
            if (!$el || typeof $el.width !== 'function') return false;
            var w = $el.width();
            if (typeof w !== 'number' || w > MIN_WIDTH) return false;
            var saved = parseInt(Common.localStorage && Common.localStorage.getItem && Common.localStorage.getItem('pe-mainmenu-width'), 10);
            $el.width(saved > MIN_WIDTH ? saved : PANEL_WIDTH);
            return true;
        },

        relayout: function () {
            var vp = ctl('Viewport');
            var v = vp && vp.viewport;
            v && v.hlayout && typeof v.hlayout.doLayout === 'function' && v.hlayout.doLayout();
            this.shell && typeof this.shell.resync === 'function' && this.shell.resync();
        }

    }, PE.Views.CompactLeft || {});

    return PE.Views.CompactLeft;
});
