/*
 * StockBridge — the bridge to the stock controls of the presentation editor.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The only shell module that knows how the ribbon is built. The shell
 * controls are counterparts of the stock ones: a command goes the stock way of the
 * ribbon object or view, availability and pressed state are read from it too, a submenu is
 * a snapshot of the stock menu at the moment of opening. Ribbon nodes are not moved: the ribbon
 * stays in the DOM under the shell, hidden by style.
 *
 * A counterpart address is '<root>:<path>': the root is a row of the ROOTS table, the path is
 * properties separated by dots, a number is an index ('ToolbarCtl:btnsComment.0',
 * 'Toolbar:btnPreview.menu.items.4'). The names are internals of the stock code, not
 * an API: a missing counterpart gives null, not an exception, the bridge notes it in
 * gaps, and the shell shows the item as inactive.
 *
 * A call of the engine or of a stock controller method (engine) is only for
 * the items that the menu row catalog (SlideActions) marked with the engine field:
 * where there is no counterpart or it is disabled by a reason of the shell itself.
 *
 * The frame (CompactShell) installs the zone by calling install(shell) in the order of
 * CompactShell.ZONES.
 */
define([], function () {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    function ctl(name) {
        try { return (PE.getController && PE.getController(name)) || null; } catch (e) { return null; }
    }

    function field(c, name) {
        return c ? c[name] : undefined;
    }

    /* Shell guard (CompactShell.guarded) for the listeners that the bridge
       puts itself on the nodes of the stock code. The bridge loads before the shell —
       the guard is taken when a listener is set; without the shell — the function as is. */
    function guard(label, fn) {
        var shell = PE.Views.CompactShell;
        return shell && typeof shell.guarded === 'function' ? shell.guarded(label, fn) : fn;
    }

    /* The "File" items (miDownload, miPrint, miProtect…) are created by the stock code in
       FileMenu.render(), and it is called only by the first show of the panel (FileMenu.show:
       with a mode set and scripts loaded — otherwise there is no show). Until then
       there are no "File" counterparts. The bridge makes the same step under the same conditions,
       without showing the panel: the markup goes into its hidden node, as on the first
       opening. */
    function renderFileMenu(menu) {
        if (!menu || menu.rendered !== false || !menu.mode || typeof menu.render !== 'function') return;
        var lc = window.Common && Common.Controllers && Common.Controllers.LaunchController;
        if (!lc || typeof lc.isScriptLoaded !== 'function' || !lc.isScriptLoaded()) return;
        try { menu.render(); } catch (e) { /* no "File" counterparts — as before the first show */ }
    }

    /* Address roots. Ribbon tabs are views of their controllers (view/Toolbar.js
       of the Toolbar controller — the toolbar field); ToolbarCtl is the ribbon
       controller itself: it creates the "Comment" buttons in itself (btnsComment); "File" is
       the left panel menu (LeftMenu.getMenu('file')); "Collaboration" and
       "Chart" are the shared views Common.Views.ReviewChanges and Common.Views.ChartTab
       of their controllers. */
    var ROOTS = {
        Toolbar:        function () { return field(ctl('Toolbar'), 'toolbar'); },
        ToolbarCtl:     function () { return ctl('Toolbar'); },
        ViewTab:        function () { return field(ctl('ViewTab'), 'view'); },
        Transitions:    function () { return field(ctl('Transitions'), 'view'); },
        Animation:      function () { return field(ctl('Animation'), 'view'); },
        LeftMenu:       function () { return field(ctl('LeftMenu'), 'leftMenu'); },
        Statusbar:      function () { return field(ctl('Statusbar'), 'statusbar'); },
        RightMenu:      function () { return field(ctl('RightMenu'), 'rightmenu'); },
        FileMenu:       function () {
            var left = field(ctl('LeftMenu'), 'leftMenu');
            if (!left) return null;
            var menu = (typeof left.getMenu === 'function' && left.getMenu('file')) || left.menuFile || null;
            renderFileMenu(menu);
            return menu;
        },
        Review:         function () { return field(ctl('Common.Controllers.ReviewChanges'), 'view'); },
        ChartTab:       function () { return field(ctl('Common.Controllers.ChartTab'), 'view'); },
        DocumentHolder: function () { return field(ctl('DocumentHolder'), 'documentHolder'); }
    };

    /* Menus that the stock code prepares not on opening but after the show:
       the mark and availability of their items are recomputed by the 'show:after' handler
       from the engine (controller/Toolbar.js onColorSchemaShow; controller/ViewTab.js
       onGuidesAfterShow, onGridlinesAfterShow). Without this step the snapshot would show
       the state of the previous opening. */
    var AFTER = {
        'Toolbar:btnColorSchemas': 1,
        'ViewTab:btnGuides': 1,
        'ViewTab:btnGridlines': 1
    };

    /* Snapshot nesting: the items of the counterpart menu and their submenus. The third level is not drawn. */
    var MAX_DEPTH = 2;

    function noop() {}

    function isSep(item) {
        return !!item && (item.caption === '--' || (item.options && item.options.caption === '--'));
    }

    /* A plugin item is Common.UI.MenuItemCustom: the stock code sets
       isCustomItem = true on it (other items have no such field); Menu uses it as well
       to tell 'item:custom-click' from 'item:click'. Only the flag itself:
       a foreign value of the field is not a sign of a plugin. */
    function isPlugin(item) {
        return item.isCustomItem === true;
    }

    function caption(item) {
        var c = item.caption !== undefined ? item.caption : (item.options && item.options.caption);
        return c == null ? '' : String(c);
    }

    /* A menu item is hidden by show()/hide() (the hidden flag), a button by the visible flag
       (Button.setVisible) or by the same hide(). Visibility in the DOM does not fit here:
       the ribbon in Compact is hidden entirely, and a closed menu is display:none. An item
       created with visible:false and not yet drawn is hidden by the stock code
       at render (MenuItem.render). The menu itself has onItemClick too — it is
       told apart from items by (items). */
    function isMenuItem(o) {
        return typeof o.onItemClick === 'function' && typeof o.click !== 'function' && !Array.isArray(o.items);
    }

    function shown(o) {
        if (!o || o.hidden === true) return false;
        if (o.visible === false) return isMenuItem(o) && o.rendered === true && o.hidden === false;
        return true;
    }

    function disabled(o) {
        return typeof o.isDisabled === 'function' ? !!o.isDisabled() : !!o.disabled;
    }

    /* Pressed state: for a menu item it is the mark, for a checkbox (Common.UI.CheckBox) its
       value, for a button — pressed. */
    function pressed(o) {
        if (isMenuItem(o)) return !!o.checkable && !!(typeof o.isChecked === 'function' ? o.isChecked() : o.checked);
        if (o.$chk && typeof o.isChecked === 'function') return !!o.isChecked();
        return o.pressed === true;
    }

    /* Submenu holder: for a stock item, menu is a Common.UI.Menu object, for
       an item without a submenu — false or absent. */
    function holdsMenu(o) {
        return !!o.menu && typeof o.menu === 'object';
    }

    /* Counterpart menu: for a button and an item it is the menu property, the Menu itself — by items. */
    function menuOf(o) {
        if (!o) return null;
        if (holdsMenu(o) && Array.isArray(o.menu.items)) return o.menu;
        if (Array.isArray(o.items) && typeof o.trigger === 'function') return o;
        return null;
    }

    function nodeOf(o) {
        if (!o) return null;
        return (o.cmpEl && o.cmpEl[0]) || (o.$el && o.$el[0]) || (o.el && o.el.nodeType ? o.el : null);
    }

    /* Icon of a stock item — its btn-* class (iconCls). */
    function iconOf(item) {
        var cls = item.iconCls !== undefined ? item.iconCls : (item.options && item.options.iconCls);
        var m = /(?:^|\s)(btn-[\w-]+)/.exec(cls == null ? '' : String(cls));
        return m ? m[1] : '';
    }

    /* Show event as the stock handlers see it: Menu.onBeforeShowMenu
       receives the dropdown event on the menu parent, and some handlers work
       only for showing the menu itself, not one bubbled up from a submenu
       (`e.target === e.currentTarget`). */
    function showEvent(m) {
        var node = (m.parentEl && m.parentEl[0]) || nodeOf(m) || {};
        return {type: 'show', target: node, currentTarget: node,
                preventDefault: noop, stopPropagation: noop,
                isDefaultPrevented: function () { return false; }};
    }

    /* Left-button click on an item — what MenuItem.onItemClick receives from jQuery. */
    function clickEvent(o) {
        var node = nodeOf(o) || {};
        return {type: 'click', which: 1, button: 0, target: node, currentTarget: node,
                preventDefault: noop, stopPropagation: noop};
    }

    /* Inner menu: an item without a caption in which the stock code drew its own
       menu (Menu.setInnerMenu — {menu, index}). Only a menu with items fits —
       a DataView inside is a gallery. */
    function innerOf(m, index) {
        var list = m && m.options && m.options.innerMenus;
        if (!Array.isArray(list)) return null;
        for (var i = 0; i < list.length; i++) {
            var x = list[i];
            if (x && x.index === index && x.menu && Array.isArray(x.menu.items)) return x.menu;
        }
        return null;
    }

    /* A submenu is a gallery if it has a shown item without a caption (palette,
       DataView of layouts or shapes), except the holder of an inner menu. */
    function holdsGallery(m) {
        return !!m && Array.isArray(m.items) && m.items.some(function (it, i) {
            return !!it && !isSep(it) && shown(it) && !caption(it) && !innerOf(m, i);
        });
    }

    /* Gallery menu of a counterpart: for a button and an item it is their menu, for a combo with a gallery
       (ComboDataView) — the menu of its expand button. */
    function galleryOf(o) {
        if (!o) return null;
        if (o.openButton && o.openButton.menu && typeof o.openButton.menu === 'object') return o.openButton.menu;
        return menuOf(o);
    }

    /* Tile store: for ComboDataView its store (the same as menuPicker's), for DataView — store. */
    function storeOf(o) {
        var s = o && (o.store || (o.menuPicker && o.menuPicker.store));
        return s && typeof s.at === 'function' ? s : null;
    }

    function rec(r, key) {
        return r && typeof r.get === 'function' ? r.get(key) : (r ? r[key] : undefined);
    }

    function jq(el) {
        var $ = window.jQuery || window.$;
        return typeof $ === 'function' ? $(el) : null;
    }

    function rendered(n) {
        return !!n && typeof n.getClientRects === 'function' && n.getClientRects().length > 0;
    }

    function hasCls(n, c) {
        return !!n && !!n.classList && n.classList.contains(c);
    }

    /* Items of the menu row catalog with the engine field — the call name (a string or {name}). */
    function engineNames(items, out) {
        (items || []).forEach(function (it) {
            if (!it || typeof it !== 'object') return;
            var e = it.engine;
            if (typeof e === 'string') out[e] = 1;
            else if (e && typeof e.name === 'string') out[e.name] = 1;
            if (Array.isArray(it.items)) engineNames(it.items, out);
            if (Array.isArray(it.sub)) engineNames(it.sub, out);
        });
        return out;
    }

    /* Showing a stock gallery: expansion classes for the path of the hidden ribbon. The styles are
       in the menu row and the shell panel: vo-gallery-path — the path node in the layout,
       but invisible; vo-gallery-root — the outer path node is taken out of the flow and has no
       size; vo-gallery-target — the menu itself, visible; vo-gallery on body —
       a gallery is open. */
    var PATH_CLS = 'vo-gallery-path', ROOT_CLS = 'vo-gallery-root', TARGET_CLS = 'vo-gallery-target',
        BODY_CLS = 'vo-gallery', ANCHOR_CLS = 'vo-gallery-anchor';

    PE.Views.StockBridge = _.extend({

        ROOTS: ROOTS,
        AFTER: AFTER,

        /* What a snapshot or a call did not do and why: missing — no counterpart;
           prepare — the stock menu preparation threw; gallery — an item without a caption
           directly in the menu or an empty submenu; depth — the third level; plugin — a plugin
           item; engine — an engine call not marked in the catalog. Not errors but a
           list for checking coverage. */
        gaps: [],

        install: function () {},

        twin: function (ref) {
            if (typeof ref !== 'string') return null;
            var at = ref.indexOf(':');
            if (at < 1) return null;
            var root = ROOTS[ref.slice(0, at)];
            var path = ref.slice(at + 1);
            if (!root || !path) return null;
            var o;
            try {
                o = root();
                var parts = path.split('.');
                for (var i = 0; i < parts.length; i++) {
                    if (!o || typeof o !== 'object') return null;
                    o = o[parts[i]];
                }
            } catch (e) {
                return null;
            }
            return o && typeof o === 'object' ? o : null;
        },

        /* State — from the counterpart itself, on every access: availability
           (isDisabled), pressed state, visibility (flags of the stock code). */
        state: function (ref) {
            var o = this.twin(ref);
            if (!o) return {exists: false, disabled: true, pressed: false, visible: false};
            return {exists: true, disabled: disabled(o), pressed: pressed(o), visible: shown(o)};
        },

        /* Current caption of a counterpart. No counterpart or caption — an empty string:
           the menu row then keeps its own phrase. */
        controlCaption: function (ref) {
            var o = this.twin(ref);
            return o ? caption(o) : '';
        },

        /* A command the stock way of the object. Without an event — the button's own click()
           (Button.click: toggling and 'click' for subscribers), for a menu
           item — its onItemClick (group mark, the item's 'click' and the menu's
           'item:click'). With an event — trigger of the counterpart's event with the stock
           code arguments, the object itself first ('change', 'changed:after', 'select').
           Refusal — no counterpart or it is disabled: between the menu opening and the click
           the stock code could have disabled the control. */
        run: function (ref, opts) {
            var o = this.twin(ref);
            if (!o || disabled(o)) return false;
            if (opts && opts.event) {
                if (typeof o.trigger !== 'function') return false;
                o.trigger.apply(o, [opts.event, o].concat(opts.args || []));
                return true;
            }
            if (typeof o.click === 'function') {
                o.click();
                return true;
            }
            if (isMenuItem(o)) {
                if (holdsMenu(o) || !shown(o)) return false;
                o.onItemClick(clickEvent(o));
                return true;
            }
            return false;
        },

        /* Watching a counterpart: the stock lockControls disables a button with a class and
           the disabled attribute, the pressed state is reflected by aria-pressed and a class. cb
           receives the fresh state — only when it changes. Returns the unsubscribe. */
        watch: function (ref, cb) {
            var me = this, o = this.twin(ref);
            if (!o || typeof cb !== 'function') return noop;
            var last = JSON.stringify(this.state(ref));
            var check = guard('bridge: watch ' + ref, function () {
                var st = me.state(ref), now = JSON.stringify(st);
                if (now === last) return;
                last = now;
                cb(st);
            });
            var off = [];
            var el = nodeOf(o);
            if (el && typeof MutationObserver === 'function') {
                var obs = new MutationObserver(check);
                obs.observe(el, {attributes: true, attributeFilter: ['class', 'aria-pressed', 'disabled', 'style']});
                off.push(function () { obs.disconnect(); });
            }
            if (typeof o.on === 'function') {
                var onEvent = function () { check(); };
                o.on('disabled toggle', onEvent);
                off.push(function () { typeof o.off === 'function' && o.off('disabled toggle', onEvent); });
            }
            return function () { off.forEach(function (f) { f(); }); off = []; };
        },

        /* Snapshot of the counterpart's stock menu at the moment of opening. First the menu is asked
           to prepare — 'show:before', as on the stock opening: the stock code sets on
           it the availability and marks of the items from the selection and the engine; for
           menus from AFTER — also 'show:after'. Then only shown items are read,
           up to two levels. id is the index path in the stock menu: pick()
           finds the same item by it. A record is {id, caption, disabled, checked,
           icon?, sub?, gallery?} or {sep: true}; gallery — an item whose submenu is
           a gallery (it is shown by gallery() by itemRef). */
        mirror: function (ref) {
            var o = this.twin(ref);
            if (!o) { this.gap(ref, 'missing', ref); return []; }
            var m = menuOf(o);
            if (!m) return [];
            this.prepare(ref, m, !!AFTER[ref]);
            var list = this.read(ref, m, 1, '');
            if (!list.length) this.gap(ref, 'gallery', caption(o) || ref);
            return list;
        },

        prepare: function (ref, m, after) {
            var ev = showEvent(m);
            try {
                m.trigger('show:before', m, ev);
                if (after) m.trigger('show:after', m, ev);
            } catch (e) {
                /* The stock preparation did not survive a show without DOM — read what there is. */
                this.gap(ref, 'prepare', String(e && e.message || e));
            }
        },

        read: function (ref, m, depth, prefix) {
            var me = this, out = [];
            m.items.forEach(function (item, index) {
                if (!item) return;
                if (isSep(item)) {
                    if (shown(item)) out.push({sep: true});
                    return;
                }
                if (!shown(item)) return;
                if (isPlugin(item)) { me.gap(ref, 'plugin', caption(item) || prefix + index); return; }
                var cap = caption(item);
                if (!cap) {
                    var inner = innerOf(m, index);
                    if (inner) {
                        var rows = me.read(ref, inner, depth, prefix + index + '/');
                        if (!rows.length) me.gap(ref, 'gallery', prefix + index);
                        rows.forEach(function (r) { out.push(r); });
                        return;
                    }
                    me.gap(ref, 'gallery', prefix + index);
                    return;
                }
                var entry = {id: prefix + index, caption: cap, disabled: disabled(item), checked: pressed(item)};
                var icon = iconOf(item);
                if (icon) entry.icon = icon;
                var sub = menuOf(item);
                if (sub || holdsMenu(item)) {
                    if (!sub) { me.gap(ref, 'gallery', cap); return; }
                    me.prepare(ref, sub, false);
                    if (holdsGallery(sub)) { entry.gallery = true; out.push(entry); return; }
                    if (depth >= MAX_DEPTH) { me.gap(ref, 'depth', cap); return; }
                    entry.sub = me.read(ref, sub, depth + 1, entry.id + '.');
                    if (!entry.sub.length) { me.gap(ref, 'gallery', cap); return; }
                }
                out.push(entry);
            });
            /* Separators at the edges and in a row — traces of what was skipped. */
            var clean = [];
            out.forEach(function (e) {
                if (e.sep && (!clean.length || clean[clean.length - 1].sep)) return;
                clean.push(e);
            });
            while (clean.length && clean[clean.length - 1].sep) clean.pop();
            return clean;
        },

        gap: function (ref, kind, what) {
            var g = {ref: ref, kind: kind, what: what};
            var dup = this.gaps.some(function (x) { return x.ref === g.ref && x.kind === g.kind && x.what === g.what; });
            if (!dup) this.gaps.push(g);
        },

        /* Choosing a snapshot item — the stock click of the item itself: MenuItem.onItemClick
           (refusal on a disabled one and on a submenu holder, group mark) → its
           'click' → Menu.onItemClick → the menu's 'item:click', which the
           stock code subscribes to. id is the index path from mirror(): '3', '0.2', '0/1' (a row
           of an inner menu) or an array. Refusal — no such item, it is hidden, disabled,
           holds a submenu or is an item without a caption. */
        pick: function (ref, id) {
            var at = this.find(ref, id), item = at && at.item;
            if (!item || isSep(item) || holdsMenu(item) || disabled(item) || !caption(item)) return false;
            if (typeof item.onItemClick === 'function') {
                item.onItemClick(clickEvent(item));
                return true;
            }
            return this.clickItem(at.menu, item);
        },

        /* The same path for an item without MenuItem.onItemClick — by the steps of the stock
           code: mark (MenuItem.onItemClick: a togglable item, except the one
           pressed in a group without allowDepress), the item's 'click', then the menu
           event. The stock Menu itself answers the item's 'click' with its own 'item:click'
           ('item:custom-click' for a plugin item) — the bridge does not repeat it; a menu
           that did not answer the item click receives the event from the bridge. */
        clickItem: function (m, item) {
            if (typeof item.trigger !== 'function') return false;
            var e = clickEvent(item);
            if (item.checkable && typeof item.setChecked === 'function' &&
                (item.allowDepress || !(item.checked && item.toggleGroup))) item.setChecked(!item.checked);
            var name = isPlugin(item) ? 'item:custom-click' : 'item:click';
            var heard = false, hear = function () { heard = true; };
            var listens = !!m && typeof m.on === 'function' && typeof m.off === 'function';
            if (listens) m.on(name, hear);
            try {
                item.trigger('click', item, e);
            } finally {
                if (listens) m.off(name, hear);
            }
            if (!heard && m && typeof m.trigger === 'function') m.trigger(name, m, item, e);
            return true;
        },

        locate: function (ref, ids) {
            var at = this.find(ref, ids);
            return at ? at.item : null;
        },

        /* An item by index path and the menu it lies in. */
        find: function (ref, ids) {
            var o = this.twin(ref);
            if (!o || ids == null) return null;
            var path = Array.isArray(ids) ? ids : String(ids).split('.');
            var m = menuOf(o), item = null;
            for (var i = 0; i < path.length; i++) {
                var seg = String(path[i]).split('/');
                if (!m || seg.length > 2 || !seg.every(function (s) { return /^\d+$/.test(s); })) return null;
                var idx = parseInt(seg[0], 10);
                if (seg.length === 2) {
                    var inner = innerOf(m, idx);
                    if (!inner || !shown(m.items[idx])) return null;
                    item = inner.items[parseInt(seg[1], 10)];
                } else {
                    item = m.items[idx];
                }
                if (!item || !shown(item)) return null;
                if (i < path.length - 1) m = menuOf(item);
            }
            if (!item) return null;
            return {item: item, menu: seg.length === 2 ? inner : m};
        },

        /* Counterpart address of a snapshot row: the path of menu items (for gallery() of a gallery item). */
        itemRef: function (ref, id) {
            var o = this.twin(ref);
            if (!o || id == null) return null;
            var path = String(id).split('.');
            if (!path.every(function (s) { return /^\d+$/.test(s); })) return null;
            var base = menuOf(o) === o ? ref + '.items.' : ref + '.menu.items.';
            return base + path.join('.menu.items.');
        },

        /* --- Galleries ---------------------------------------------------------
           The stock popup list of a counterpart (layouts, shapes, color themes)
           is shown at the shell control the stock way: a button menu —
           Menu.show() (show:before and show:after, the gallery is built lazily), an item
           submenu — the way hover shows it (MenuItem: 'show.bs.dropdown',
           class over, 'shown.bs.dropdown'). The ribbon is hidden by style, so for the time of
           the show the nodes on the path from the menu to the first drawn ancestor get
           expansion classes; nodes are not moved. The place is given by the stock alignment
           (alignPosition) to an invisible anchor at the control's place (menuAlignEl).
           The choice goes the way of the gallery itself: a click that reached the menu is a choice,
           the popup closes (onClose('pick')). The stock code removed the menu itself —
           onClose('hide'). opts is {align: 'tl-bl', onClose(how)}. Refusal (false) —
           no counterpart, it is disabled, no menu, or it is not drawn. */
        shown: null,

        gallery: function (ref, anchorEl, opts) {
            opts = opts || {};
            var o = this.twin(ref);
            if (!o || disabled(o) || !anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return false;
            var m = galleryOf(o);
            var ul = m && m.rendered && m.menuRoot && m.menuRoot[0];
            var host = m && m.parentEl && m.parentEl[0];
            if (!ul || !host || typeof m.alignPosition !== 'function') return false;
            var nested = hasCls(host, 'dropdown-submenu');
            if (!nested && typeof m.show !== 'function') return false;
            var doc = ul.ownerDocument || document;
            this.closeGallery('replace');
            var anchor = doc.createElement('div');
            anchor.className = ANCHOR_CLS;
            var $anchor = jq(anchor);
            if (!$anchor) return false;
            var st = {ref: ref, m: m, ul: ul, host: host, nested: nested, anchor: anchor, $anchor: $anchor,
                      align: opts.align || 'tl-bl', opts: opts, path: [], doc: doc,
                      saved: {alignEl: m.menuAlignEl, align: m.menuAlign}};
            this.place(st, anchorEl);
            doc.body.appendChild(anchor);
            this.reveal(st);
            this.shown = st;
            try {
                this.aim(st);
                if (nested) {
                    m.parentEl.trigger('show.bs.dropdown');
                    m.parentEl.addClass('over');
                    m.parentEl.trigger('shown.bs.dropdown');
                } else {
                    m.show();
                }
                if (!this.stockShows(st)) throw new Error('the stock did not show the gallery');
                this.aim(st);
            } catch (e) {
                if (this.shown === st) this.closeGallery('error');
                return false;
            }
            this.follow(st);
            return true;
        },

        /* Invisible anchor at the place of the shell control. */
        place: function (st, anchorEl) {
            var r = anchorEl.getBoundingClientRect(), s = st.anchor.style;
            s.position = 'fixed';
            s.left = Math.round(r.left) + 'px';
            s.top = Math.round(r.top) + 'px';
            s.width = Math.round(r.width) + 'px';
            s.height = Math.round(r.height) + 'px';
            s.visibility = 'hidden';
            s.pointerEvents = 'none';
        },

        reveal: function (st) {
            for (var n = st.ul.parentNode; n && n.nodeType === 1 && n !== st.doc.body && !rendered(n); n = n.parentNode) {
                st.path.push(n);
                n.classList.add(PATH_CLS);
            }
            if (st.path.length) st.path[st.path.length - 1].classList.add(ROOT_CLS);
            st.ul.classList.add(TARGET_CLS);
            st.doc.body.classList.add(BODY_CLS);
        },

        unreveal: function (st) {
            st.path.forEach(function (n) { n.classList.remove(PATH_CLS, ROOT_CLS); });
            st.ul.classList.remove(TARGET_CLS);
            st.doc.body.classList.remove(BODY_CLS);
        },

        aim: function (st) {
            st.m.menuAlignEl = st.$anchor;
            st.m.menuAlign = st.align;
            st.m.alignPosition();
        },

        stockShows: function (st) {
            return hasCls(st.host, st.nested ? 'over' : 'open');
        },

        follow: function (st) {
            var me = this;
            st.onClick = guard('bridge: gallery pick', function (e) {
                if (me.shown !== st) return;
                var t = e && e.target;
                if (t && typeof t.closest === 'function' &&
                    t.closest('.ps-scrollbar-y-rail, .ps-scrollbar-x-rail, .ps__rail-y, .ps__rail-x')) return;
                me.closeGallery('pick');
            });
            st.ul.addEventListener('click', st.onClick);
            if (typeof MutationObserver === 'function') {
                st.obs = new MutationObserver(guard('bridge: gallery hidden', function () {
                    if (me.shown === st && !me.stockShows(st)) me.closeGallery('hide');
                }));
                st.obs.observe(st.host, {attributes: true, attributeFilter: ['class']});
            }
        },

        /* Close the shown gallery: the stock Menu.hide (for a submenu it removes
           over), alignment as it was, classes and anchor — away. */
        closeGallery: function (how) {
            var st = this.shown;
            if (!st) return false;
            this.shown = null;
            st.obs && st.obs.disconnect();
            st.onClick && st.ul.removeEventListener('click', st.onClick);
            try {
                if (this.stockShows(st)) st.m.hide();
            } catch (e) { /* close our own in any case */ }
            st.m.menuAlignEl = st.saved.alignEl;
            st.m.menuAlign = st.saved.align;
            this.unreveal(st);
            st.anchor.parentNode && st.anchor.parentNode.removeChild(st.anchor);
            var cb = st.opts.onClose;
            if (typeof cb === 'function') cb(how || 'close');
            return true;
        },

        galleryOpen: function () {
            return !!this.shown;
        },

        /* A node inside the shown gallery (its submenus lie inside it). */
        galleryOwns: function (node) {
            var st = this.shown;
            return !!(st && node && typeof st.ul.contains === 'function' && st.ul.contains(node));
        },

        /* --- Tiles --------------------------------------------------------------
           The right panel gallery (themes, transitions, animation) is drawn by the shell from
           the records of the stock gallery store (ComboDataView, DataView). A record is
           {id, caption, image, group, value, selected, disabled}; id is the index in the
           store. */
        tiles: function (ref) {
            var o = this.twin(ref), store = storeOf(o);
            if (!store) { this.gap(ref, 'missing', ref); return []; }
            var out = [];
            for (var i = 0; i < store.length; i++) {
                var r = store.at(i);
                if (!r) continue;
                out.push({
                    id: String(i),
                    caption: String(rec(r, 'tip') || rec(r, 'caption') || rec(r, 'name') || ''),
                    image: rec(r, 'imageUrl') || rec(r, 'image') || '',
                    group: rec(r, 'group') == null ? '' : rec(r, 'group'),
                    value: rec(r, 'value'),
                    selected: !!rec(r, 'selected'),
                    disabled: !!rec(r, 'disabled')
                });
            }
            return out;
        },

        /* Choosing a tile — the stock way of the gallery: the record is selected in its list
           (DataView.selectRecord, as on a click), then the gallery sends its
           'click' event with the record — through the same handler as on a click on a tile
           (ComboDataView.onMenuPickerClick; for DataView — 'item:click'). */
        pickTile: function (ref, id) {
            var o = this.twin(ref), store = storeOf(o);
            if (!store || disabled(o) || id == null || !/^\d+$/.test(String(id))) return false;
            var r = store.at(parseInt(id, 10));
            if (!r || rec(r, 'disabled')) return false;
            var picker = o.menuPicker || o;
            try {
                if (typeof picker.selectRecord === 'function') picker.selectRecord(r);
            } catch (e) { /* the choice goes out by the event anyway */ }
            if (typeof o.onMenuPickerClick === 'function') {
                o.onMenuPickerClick(o.menuPicker, null, r);
                return true;
            }
            if (typeof o.trigger !== 'function') return false;
            if (o.menuPicker) o.trigger('click', o, r);
            else o.trigger('item:click', o, null, r);
            return true;
        },

        /* --- Engine --------------------------------------------------------------
           A call of the engine or of a stock controller method — only by the name that the
           menu row catalog marked on the item with the engine field: 'asc_…' (or
           'api.asc_…') — an api method, '<Controller>.<method>' — a stock
           controller method (LeftMenu.onShowTumbnails). An unmarked name is refused
           (undefined) with a record in gaps. Returns the call result. */
        engineMarked: function (name) {
            var acts = PE.Views.SlideActions, groups = [];
            try { groups = acts && typeof acts.groups === 'function' ? acts.groups() || [] : []; } catch (e) { groups = []; }
            return engineNames(groups, {})[name] === 1;
        },

        engine: function (name) {
            if (typeof name !== 'string' || !this.engineMarked(name)) { this.gap(name, 'engine', 'not marked'); return undefined; }
            var args = Array.prototype.slice.call(arguments, 1);
            var at = name.indexOf('.'), target, method;
            if (at > 0 && name.slice(0, at) !== 'api') {
                target = ctl(name.slice(0, at));
                method = name.slice(at + 1);
            } else {
                var main = ctl('Main');
                target = main && main.api;
                method = at > 0 ? name.slice(at + 1) : name;
            }
            if (!target || typeof target[method] !== 'function') { this.gap(name, 'missing', name); return undefined; }
            return target[method].apply(target, args);
        }

    }, PE.Views.StockBridge || {});

    return PE.Views.StockBridge;
});
