/*
 * MenuBar — the menu bar of the "Compact" shell, shared by the editors.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Here is the menu mechanics: sections, their lists, submenus ▸, the keyboard, the narrow-window "…",
 * the reason for a disabled item and a place for the status. The menu composition, commands and state of
 * the editor are not here — they are provided by the editor adapter:
 *  - sections() -> [{k, t}] — the sections of the bar in order;
 *  - groups(k, snap) -> [items] — the section items in the MenuModel form; snap is the pass object:
 *    the same for all sections of one build or one refresh(), new when
 *    a section is opened. The adapter may keep in it what the sections share (the catalog),
 *    so as not to assemble it anew for every section;
 *  - optional context() -> ctx — the editor state from which the bar reads
 *    function submenus (items: (ctx) -> [items], MenuModel.itemsOf); without it the function
 *    receives undefined;
 *  - itemState(it) -> {visible, disabled, reason, checked, label} — a snapshot of the item now;
 *  - exec(it, args) — execution of the item;
 *  - shortcut(it) -> string or null — the command's key combination, keys joined with "+"; the item
 *    explanation (hint of the snapshot) is on the right instead of it;
 *  - openRow(row, it, level) -> boolean — the editor's own row: for a 'widget' item —
 *    the row content when it is built, for a submenu — its own surface instead of the menu
 *    bar list (true — the editor opened it); level — the row's list level;
 *    optional closeRow(row, it) — the menu closed the layer of this own surface;
 *  - optional owns(el) -> boolean — a node outside the bar belongs to an open own
 *    submenu surface: a click in it does not close the menu, focus that went into it does not release
 *    the keyboard hold;
 *  - optional focusRow(row, it) -> boolean — →, Enter or Space on a ▸ item with its own
 *    surface: put focus into it (true — put, otherwise focus stays on the item);
 *  - reasons -> [code…] — the order of the editor's disable reasons from highest to lowest priority: the common codes
 *    MenuModel.COMMON_REASONS in their order and the editor codes among them. By it the adapter
 *    chooses the visible reason of an item in itemState (MenuModel.state(it, ctx, reasons));
 *  - reasonText(code) -> string or null — the editor's reason text: for all codes except the common ones,
 *    whose texts are in the menu bar (MenuBar.reasonText);
 *  - keys: {hold(), release(), beforeCommand()} — the engine keyboard: hold it for the menu,
 *    return it to the document, hand it over before a command. The keyboard taken by F10 returns to
 *    the document as soon as focus leaves the bar: Tab, a click elsewhere, Escape, a command;
 *  - optional blocked() -> boolean — the editor is covered by a modal layer (a window, the loading
 *    mask): F10 stays with it, it does not enter the menu bar.
 *
 * create(adapter, opts) -> {el, enter(), open(k), close(), isOpen(), refresh(), status(),
 * exec(it, args), ownClosed(how), destroy()}. exec — execution of an item of the editor's own row
 * (a grid, a value): by the same path as choosing an action item — availability is re-read,
 * the menu closes, the keyboard returns to the document, then adapter.exec(it, args); a disabled
 * item is not executed (false). ownClosed(how) — the own submenu surface closed itself:
 * 'chosen' — by a choice (the menu closes, the keyboard goes to the document, as after a command),
 * 'dismissed' — without a choice (focus goes to its ▸ item, the menu stays open); closeRow is not called then.
 * opts:
 *  - pinned — the key of the section pinned on the right: it does not go into "…", "…" is placed before it;
 *  - icons — {svg(name, size)} — glyph markup; without it — Common.UI.Compact.Icons,
 *    if present, otherwise the glyph places are empty, and the ✓ mark and ▸ are symbols. The ● dot of the selected
 *    option is drawn by styles (.vo-mn-dot), by a symbol — only without a glyph set;
 *  - mac — shortcuts in the macOS form (⌘ ⌥ ⇧); by default — by platform;
 *  - f10 — false: the bar does not listen to the F10 key, entry is by calling enter().
 *
 * The composition of a section and a submenu is read at every opening and at refresh(): rights, integration,
 * availability and function submenus are taken at that moment. Visibility, trimming of separators and the mark
 * in a group of options follow the MenuModel.section rules over the adapter snapshots: a section
 * without visible items is not drawn by the bar, the decision is not the adapter's.
 *
 * A group heading (kind 'group') is a role=group container with the group name around the items up to
 * the next separator or heading: the screen reader announces the group on entering it, the visible heading
 * is hidden from it. An item description (desc of the snapshot) is the second line under the caption and the item description
 * for the screen reader (aria-describedby). The reason for a disabled item is heard by the screen reader as the item description
 * (aria-description); for an item with a description aria-describedby would override it, so there the reason
 * comes first in aria-describedby, before the description.
 *
 * The bar layout (captions on one line, sections without shrinking, status with an ellipsis) is set by
 * the styles of the shared layer (menu.less); the bar itself sets only the visibility of sections and the submenu place.
 *
 * An inactive item gets the vo-locked class and aria-disabled, not the disabled attribute: on a
 * disabled button the browser does not send click, and the re-check of availability on choosing would stop
 * working. Submenus live in the menu bar itself, not inside the scrollable list of
 * the section: its overflow would clip them.
 */
define([
    'common/main/lib/view/compact/MenuModel'
], function (Model) {
    'use strict';

    if (window.Common === undefined) window.Common = {};
    if (Common.UI === undefined) Common.UI = {};
    if (Common.UI.Compact === undefined) Common.UI.Compact = {};

    Model = Model || Common.UI.Compact.MenuModel;

    /* A submenu (▸) opens on hover with this delay. */
    var HOVER_DELAY = 150;

    /* The common disable reason text — the bar's key by the MenuModel.COMMON_REASONS code. */
    var REASON_TEXT = {
        limit: 'textReasonLimit',
        offline: 'textReasonOffline',
        view: 'textReasonView',
        'protected': 'textReasonProtected'
    };

    /* Default strings. The editor locale puts its values into the same object
       (Common.UI.Compact.MenuBar.<key>) before or after the module loads, so
       the defaults do not override what is already put, and the strings are read at the time of showing. */
    var TEXTS = {
        txtMenuBar_ARIA: 'Main menu',
        txtMore_ARIA: 'More sections',
        textReasonLimit: 'The maximum number of people are editing the document',
        textReasonOffline: 'No connection',
        textReasonView: 'The document is open for viewing',
        textReasonProtected: 'The document is protected'
    };

    var MenuBar = Common.UI.Compact.MenuBar || {};
    Common.UI.Compact.MenuBar = MenuBar;
    Object.keys(TEXTS).forEach(function (key) {
        if (typeof MenuBar[key] !== 'string') MenuBar[key] = TEXTS[key];
    });

    /* The disable reason text: for a common code — the menu bar's, for others — the editor adapter's
       (reasonText). The same text is taken by other editor surfaces with catalog items. */
    MenuBar.reasonText = function (adapter, code) {
        if (typeof code !== 'string' || !code) return null;
        if (REASON_TEXT.hasOwnProperty(code)) return MenuBar[REASON_TEXT[code]] || TEXTS[REASON_TEXT[code]] || null;
        return adapter && typeof adapter.reasonText === 'function' ? (adapter.reasonText(code) || null) : null;
    };

    var warned = {};

    /* The number of an item's description or reason for aria-describedby: unique on the page. */
    var descSeq = 0;

    function warnOnce(label, e) {
        if (warned[label]) return;
        warned[label] = true;
        if (window.console && console.warn)
            console.warn('Compact menu: "' + label + '" failed, the editor keeps working without it.', e);
    }

    /* The menu event handler: a failure in it does not go into the editor. */
    function guarded(label, fn) {
        return function () {
            try {
                return fn.apply(this, arguments);
            } catch (e) {
                warnOnce(label, e);
            }
        };
    }

    function shown(el) {
        return !!el && el.nodeType === 1 && el.isConnected !== false && el.getClientRects().length > 0;
    }

    function platformMac() {
        var U = Common.Utils;
        if (U && typeof U.isMac === 'boolean') return U.isMac;
        var nav = window.navigator || {};
        return /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent || '');
    }

    /* A shortcut the way the stock code writes it in button hints: on macOS — ⌘ ⌥ ⇧ without "+",
       on others — as given by the adapter. */
    function keyHint(text, mac) {
        if (!text) return '';
        text = String(text);
        if (!mac) return text;
        return text.replace(/\+(?=\S)/g, '').replace(/Ctrl|ctrl/g, '⌘').replace(/Alt|alt/g, '⌥')
            .replace(/Shift|shift/g, '⇧');
    }

    function create(adapter, opts) {
        opts = opts || {};
        var mac = typeof opts.mac === 'boolean' ? opts.mac : platformMac();
        var subs = [];
        var frame = 0;
        var layoutFrame = 0;
        var destroyed = false;
        var observedClips = [];

        var m = {
            bar: null,
            sections: [],   // {k, t, wrap, btn, drop, visible, over, list}
            more: null,     // {wrap, btn, drop, open}
            status: null,
            open: -1,       // the section whose list is open
            flies: [],      // submenus: {level, el, row, k}
            owned: null,    // the adapter's own surface at the row: {row, level}
            timer: null,
            cur: null,      // the Tab stop button of the bar
            held: false,    // the engine keyboard is held by the menu (F10 entry)
            opener: null    // who had focus before entering the bar
        };

        function icons() {
            return opts.icons || Common.UI.Compact.Icons || null;
        }

        function glyph(name, size) {
            var set = icons();
            if (!name || !set || typeof set.svg !== 'function') return '';
            try { return set.svg(name, size) || ''; } catch (e) { return ''; }
        }

        function text(key) {
            return MenuBar[key] || TEXTS[key] || '';
        }

        function reasonText(code) {
            return MenuBar.reasonText(adapter, code);
        }

        function keys(name) {
            var k = adapter.keys;
            if (k && typeof k[name] === 'function') k[name]();
        }

        function rtl() {
            return !!document.body && document.body.classList.contains('rtl');
        }

        /* --- Snapshot ------------------------------------------------------------- */
        /* A list snapshot: the state of each item — once from the adapter, then the rules of
           MenuModel.section (visibility, separators, groups, one selected option).
           A snapshot row carries a catalog item (it), for a submenu — the submenu rows (rows). */

        /* The editor state for function submenus: from the adapter, read at the moment of the snapshot. */
        function context() {
            return typeof adapter.context === 'function' ? adapter.context() : undefined;
        }

        function snapshot(items) {
            var ctx = context();
            function proxy(it) {
                var kind = Model.kindOf(it);
                if (kind === 'sep') return {kind: 'sep', src: it};
                var st = adapter.itemState(it) || {};
                var p = {
                    k: it.k, kind: kind, src: it, sc: it.sc, i: it.i,
                    t: st.label !== undefined ? st.label : it.t,
                    hint: st.hint, desc: st.desc,
                    when: function () { return st.visible !== false; },
                    disabled: function () { return st.disabled ? (st.reason || true) : null; },
                    checked: function () { return st.checked; }
                };
                if (kind === 'submenu') p.items = Model.itemsOf(it, ctx).map(proxy);
                return p;
            }
            function back(rows) {
                return rows.map(function (row) {
                    var out = {it: row.it ? row.it.src : row.it, kind: row.kind, k: row.k,
                               disabled: !!row.disabled, reason: row.reason || null,
                               checked: row.checked, label: row.label,
                               hint: row.hint || null, desc: row.desc || null};
                    if (row.rows) out.rows = back(row.rows);
                    return out;
                });
            }
            var snap = Model.section((items || []).map(proxy), {});
            return {visible: snap.visible, rows: back(snap.rows)};
        }

        function sectionSnapshot(s, snap) {
            return snapshot(adapter.groups(s.k, snap || {}) || []);
        }

        /* --- Markup ------------------------------------------------------------ */

        function build() {
            var bar = document.createElement('div');
            bar.className = 'vo-mn';
            bar.setAttribute('role', 'menubar');
            bar.setAttribute('aria-label', text('txtMenuBar_ARIA'));
            m.bar = bar;

            var pinnedWrap = null;
            (adapter.sections() || []).forEach(function (sec, index) {
                var s = {k: sec.k, t: sec.t, visible: true, over: false, list: null};
                s.wrap = document.createElement('div');
                s.wrap.className = 'vo-mn-wrap';
                /* The wrapper has no role: the menu bar owns its items (menubar → menuitem). */
                s.wrap.setAttribute('role', 'none');
                s.btn = topButton(sec.t);
                s.btn.setAttribute('data-k', sec.k);
                s.drop = document.createElement('div');
                s.drop.className = 'vo-mn-drop';
                s.drop.setAttribute('role', 'menu');
                s.drop.setAttribute('aria-label', sec.t);
                s.drop.setAttribute('data-level', '0');
                bindListScroll(s.drop);
                s.btn.addEventListener('click', guarded('menu section', function (e) {
                    e && e.stopPropagation && e.stopPropagation();
                    var i = m.sections.indexOf(s);
                    /* Openness is taken before closing: a repeated click closes the section. */
                    var open = m.open !== i;
                    closeAll();
                    if (open) openSection(i);
                }));
                /* The section is already open — hovering a neighbor switches the section. */
                s.btn.addEventListener('mouseenter', guarded('menu section hover', function () {
                    var i = m.sections.indexOf(s);
                    if (!isOpen() || m.open === i) return;
                    closeAll();
                    openSection(i);
                }));
                s.wrap.appendChild(s.btn);
                s.wrap.appendChild(s.drop);
                m.sections.push(s);
                if (opts.pinned !== undefined && sec.k === opts.pinned) pinnedWrap = s.wrap;
                else bar.appendChild(s.wrap);
            });

            m.more = buildMore();
            bar.appendChild(m.more.wrap);
            if (pinnedWrap) bar.appendChild(pinnedWrap);

            /* A place for the editor's indicator and hint: in the bar itself, outside the lists and "…".
               No role: a live region inside the menu bar does not become its item. */
            m.status = document.createElement('div');
            m.status.className = 'vo-mn-status';
            m.status.setAttribute('aria-live', 'polite');
            bar.appendChild(m.status);

            bar.addEventListener('keydown', guarded('menu keys', menuKey));
            bar.addEventListener('focusin', guarded('menu focus', function (e) {
                var from = e && e.relatedTarget;
                if (from && from.nodeType === 1 && from !== document.body && !bar.contains(from)) m.opener = from;
                var t = e && e.target;
                if (tops().indexOf(t) >= 0) rove(t);
            }));
            /* Focus left the bar (Tab, a click on the page) — the F10 hold is released. Where it
               went is not always known: without relatedTarget we look after the event — the node could
               have simply been rebuilt (refresh, closing a submenu), and focus has already returned to the bar;
               when leaving the browser window focus stays in place, and so does the hold. */
            bar.addEventListener('focusout', guarded('menu focus out', function (e) {
                if (!m.held) return;
                var to = e && e.relatedTarget;
                if (to && to.nodeType === 1) {
                    if (!bar.contains(to) && !inOwned(to)) giveBack();
                    return;
                }
                setTimeout(guarded('menu focus out', function () {
                    var now = document.activeElement;
                    if (m.held && !bar.contains(now) && !inOwned(now)) giveBack();
                }), 0);
            }));
            var pass = {};
            sections().forEach(function (s) { s.visible = sectionSnapshot(s, pass).visible; });
            applyVisible();
            rove(tops()[0] || null);
            return bar;
        }

        function topButton(label) {
            var btn = document.createElement('button');
            btn.setAttribute('type', 'button');
            btn.className = 'vo-mn-item';
            btn.setAttribute('role', 'menuitem');
            btn.setAttribute('aria-haspopup', 'menu');
            btn.setAttribute('aria-expanded', 'false');
            btn.setAttribute('tabindex', '-1');
            btn.textContent = label;
            return btn;
        }

        /* The narrow-window "…": a list of the names of sections that left the end of the bar. */
        function buildMore() {
            var more = {open: false};
            more.wrap = document.createElement('div');
            more.wrap.className = 'vo-mn-wrap vo-mn-more';
            more.wrap.setAttribute('role', 'none');
            more.wrap.style.display = 'none';
            more.btn = topButton('…');
            more.btn.setAttribute('aria-label', text('txtMore_ARIA'));
            more.drop = document.createElement('div');
            more.drop.className = 'vo-mn-drop';
            more.drop.setAttribute('role', 'menu');
            more.drop.setAttribute('aria-label', text('txtMore_ARIA'));
            more.drop.setAttribute('data-level', '0');
            more.btn.addEventListener('click', guarded('menu more', function (e) {
                e && e.stopPropagation && e.stopPropagation();
                var open = !moreOpen();
                closeAll();
                if (open) openMore();
            }));
            more.btn.addEventListener('mouseenter', guarded('menu more hover', function () {
                if (!isOpen() || moreOpen()) return;
                closeAll();
                openMore();
            }));
            more.wrap.appendChild(more.btn);
            more.wrap.appendChild(more.drop);
            return more;
        }

        function sections() {
            return m.sections;
        }

        /* The bar stops in order on the screen: visible section buttons and "…". */
        function tops() {
            if (!m.bar) return [];
            var out = [];
            Array.prototype.forEach.call(m.bar.children, function (child) {
                if (!child.classList.contains('vo-mn-wrap') || child.style.display === 'none') return;
                var btn = child.firstChild;
                if (btn && btn.classList.contains('vo-mn-item')) out.push(btn);
            });
            return out;
        }

        /* The menu bar is one Tab stop: tabindex 0 only on the current button. */
        function rove(btn) {
            var list = tops();
            if (list.indexOf(btn) < 0) btn = list[0] || null;
            m.cur = btn;
            sections().forEach(function (s) { s.btn.setAttribute('tabindex', s.btn === btn ? '0' : '-1'); });
            m.more.btn.setAttribute('tabindex', m.more.btn === btn ? '0' : '-1');
        }

        /* The button at which the section list is shown: its own or "…" if the section went there. */
        function hostOf(i) {
            var s = m.sections[i];
            return s && s.over ? m.more.btn : (s && s.btn);
        }

        function moreOpen() {
            return !!m.more && m.more.open;
        }

        function isOpen() {
            return m.open >= 0 || moreOpen() || m.flies.length > 0 || !!m.owned;
        }

        /* The node of an open own submenu surface (outside the bar): so says the adapter. */
        function inOwned(el) {
            return !!m.owned && !!el && el.nodeType === 1 && typeof adapter.owns === 'function' && !!adapter.owns(el);
        }

        /* The own surface closed itself: by a choice — the menu closes, the keyboard goes to the document,
           as after a command; without a choice — focus goes to its ▸ item, the menu stays open.
           closeRow is not called: the surface is already closed. */
        function ownClosed(how) {
            var own = m.owned;
            if (!own) return false;
            m.owned = null;
            own.row.classList.remove('vo-sub-open');
            own.row.setAttribute('aria-expanded', 'false');
            if (how === 'chosen') {
                closeAll();
                beforeCommand();
            } else if (own.row.isConnected && isOpen()) {
                focusNode(own.row);
            }
            return true;
        }

        /* --- Lists --------------------------------------------------------------- */

        function openSection(i) {
            var s = m.sections[i];
            if (!s || !s.visible) return false;
            /* Open stock dropdown menus are closed, as when opening any stock one. */
            var mm = Common.UI.Menu && Common.UI.Menu.Manager, held = m.held;
            mm && typeof mm.hideAll === 'function' && mm.hideAll();
            /* A hidden stock menu could have given the keyboard to the document, and the document took focus from
               the bar (its focus loss released the hold): the hold returns before focus goes to the section item. */
            if (held) {
                m.held = true;
                keys('hold');
            }
            var snap = sectionSnapshot(s);
            s.visible = snap.visible;
            if (!snap.visible) { applyVisible(); return false; }
            s.drop.textContent = '';
            s.list = {nodes: {}};
            renderList(s.drop, s.list, snap.rows, 0);
            s.drop.scrollTop = 0;
            s.drop.classList.add('open');
            m.open = i;
            syncExpanded();
            placeOpenLists();
            return true;
        }

        function openMore() {
            var hidden = sections().filter(function (s) { return s.visible && s.over; });
            if (!hidden.length) return false;
            fillMore(hidden);
            m.more.drop.classList.add('open');
            m.more.open = true;
            syncExpanded();
            placeOpenLists();
            return true;
        }

        function fillMore(hidden) {
            var drop = m.more.drop;
            var existing = {}, rows = [], scroll = drop.scrollTop;
            Array.prototype.forEach.call(drop.children, function (row) {
                existing[row.getAttribute('data-k')] = row;
            });
            hidden.forEach(function (s) {
                var row = existing[s.k];
                if (row) { rows.push(row); return; }
                row = document.createElement('button');
                row.setAttribute('type', 'button');
                row.className = 'vo-mn-sub vo-has-sub vo-mn-more-row';
                row.setAttribute('role', 'menuitem');
                row.setAttribute('tabindex', '-1');
                row.setAttribute('aria-haspopup', 'menu');
                row.setAttribute('data-k', s.k);
                var t = document.createElement('span');
                t.className = 'vo-mn-t';
                t.textContent = s.t;
                row.appendChild(t);
                row.addEventListener('click', guarded('menu more item', function (e) {
                    e && e.stopPropagation && e.stopPropagation();
                    /* The section list takes the place of "…": the level does not grow. */
                    var i = m.sections.indexOf(s);
                    closeAll();
                    openSection(i);
                }));
                row.addEventListener('mouseenter', guarded('menu hover', function () { hoverRow(row, 0, null); }));
                rows.push(row);
            });
            place(drop, rows);
            drop.scrollTop = scroll;
        }

        function syncExpanded() {
            sections().forEach(function (s, i) {
                var on = m.open === i;
                s.drop.classList.toggle('open', on);
                s.btn.classList.toggle('vo-open', on);
                s.btn.setAttribute('aria-expanded', on ? 'true' : 'false');
            });
            var openOver = m.open >= 0 && m.sections[m.open].over;
            var moreOn = moreOpen() || openOver;
            m.more.drop.classList.toggle('open', moreOpen());
            m.more.btn.classList.toggle('vo-open', moreOn);
            m.more.btn.setAttribute('aria-expanded', moreOn ? 'true' : 'false');
        }

        /* A list by the snapshot: rows with the same keys stay the same nodes (focus and
           hover on them are not lost), departed ones are removed, new ones take their places.
           Items after a group heading up to the next separator or heading are inside
           the group container. */
        function renderList(drop, list, rows, level) {
            var keep = {}, glyphs = level === 0 || rows.some(function (r) { return !!(r.it && r.it.i); });
            rows.forEach(function (r) { if (r.kind !== 'sep' && r.k !== undefined) keep[r.k] = r.kind; });
            Object.keys(list.nodes).forEach(function (k) {
                var node = list.nodes[k];
                if (node._vo && keep[k] === node._vo.kind) return;
                node.parentNode && node.parentNode.removeChild(node);
                delete list.nodes[k];
            });
            var top = [], groups = [], inGroup = null;
            rows.forEach(function (r) {
                var node;
                if (r.kind === 'sep') node = sepNode();
                else if (r.k === undefined) node = rowNode(r, level, glyphs);
                else node = list.nodes[r.k] || (list.nodes[r.k] = rowNode(r, level, glyphs));
                if (r.kind !== 'sep') applyRow(node, r);
                if (r.kind === 'sep' || r.kind === 'group') inGroup = null;
                if (inGroup) { inGroup.push(node); return; }
                top.push(node);
                if (r.kind === 'group') {
                    inGroup = [node._vo.title];
                    groups.push({node: node, kids: inGroup});
                }
            });
            place(drop, top);
            groups.forEach(function (g) { place(g.node, g.kids); });
            list.rows = rows;
        }

        /* The node's children in the given order: extra ones are removed first, so those remaining in their
           places are not rearranged (focus on them is not lost), the others take their places. */
        function place(parent, nodes) {
            Array.prototype.slice.call(parent.childNodes).forEach(function (child) {
                if (nodes.indexOf(child) < 0) parent.removeChild(child);
            });
            var cur = parent.firstChild;
            nodes.forEach(function (node) {
                if (node === cur) cur = cur.nextSibling;
                else parent.insertBefore(node, cur);
            });
        }

        function sepNode() {
            var sep = document.createElement('div');
            sep.className = 'vo-mn-sep';
            sep.setAttribute('role', 'separator');
            return sep;
        }

        /* A list row: a glyph (in a section the place for it is always kept — otherwise captions
           drift apart), a caption, an explanation or shortcut on the right (applyRow), a mark, ▸.
           A group heading is a group container with a visible name, without an action; the group items
           are put into it by renderList. The editor's own row is content from the adapter. */
        function rowNode(r, level, glyphs) {
            var it = r.it, kind = r.kind, row, sc, title;
            if (kind === 'group') {
                /* The group name is on the container (the screen reader announces it), the visible heading is hidden from
                   the screen reader: otherwise the name would sound twice. */
                row = document.createElement('div');
                row.className = 'vo-mn-grp';
                row.setAttribute('role', 'group');
                title = span('vo-mn-grp-t', r.label);
                title.setAttribute('aria-hidden', 'true');
                row.appendChild(title);
            } else if (kind === 'widget') {
                row = document.createElement('div');
                row.className = 'vo-mn-sub vo-mn-widget';
                row.setAttribute('role', 'group');
                row.setAttribute('aria-label', r.label || '');
            } else {
                row = document.createElement('button');
                row.setAttribute('type', 'button');
                row.className = 'vo-mn-sub' + (kind === 'submenu' ? ' vo-has-sub' : '');
                row.setAttribute('role', 'menuitem');
                /* Items are not Tab stops: arrows move among them. */
                row.setAttribute('tabindex', '-1');
                if (kind === 'check' || kind === 'radio') row.setAttribute('data-check', kind);
                if (kind === 'submenu') {
                    row.setAttribute('aria-haspopup', 'menu');
                    row.setAttribute('aria-expanded', 'false');
                }
                if (glyphs) {
                    var i = span('vo-mn-i');
                    i.innerHTML = glyph(it.i, 16);
                    row.appendChild(i);
                }
                row.appendChild(span('vo-mn-t', r.label));
                sc = typeof adapter.shortcut === 'function' ? keyHint(adapter.shortcut(it), mac) : '';
                if (kind === 'submenu') {
                    var a = span('vo-mn-arrow');
                    var arrow = glyph('chevronL', 14);
                    if (arrow) a.innerHTML = arrow;
                    else a.textContent = '▸';
                    row.appendChild(a);
                }
            }
            row._vo = {k: r.k, kind: kind, it: it, level: level, sc: sc || '', title: title || null};
            row.setAttribute('data-k', r.k);
            row.setAttribute('data-level', String(level));
            if (kind === 'widget') {
                var took = typeof adapter.openRow === 'function' && adapter.openRow(row, it, level);
                if (!took) row.appendChild(span('vo-mn-t', r.label));
            }
            if (kind === 'group') return row;
            var act = guarded('menu item', function (e) {
                e && e.stopPropagation && e.stopPropagation();
                activate(row);
            });
            if (kind !== 'widget') row.addEventListener('click', act);
            row.addEventListener('mouseenter', guarded('menu hover', function () {
                hoverRow(row, level, kind === 'submenu' ? act : null);
            }));
            return row;
        }

        function span(cls, value) {
            var s = document.createElement('span');
            s.className = cls;
            if (value !== undefined) s.textContent = value;
            return s;
        }

        /* A row by the snapshot: a caption, an explanation on the right (otherwise a shortcut), a description, the disabled state
           and the reason, a mark; for a group — its name. */
        function applyRow(row, r) {
            var info = row._vo;
            if (info) info.it = r.it;
            if (r.kind === 'group') {
                if (row.getAttribute('aria-label') !== r.label) row.setAttribute('aria-label', r.label || '');
                var gt = info && info.title;
                if (gt && gt.textContent !== r.label) gt.textContent = r.label;
                return;
            }
            if (r.kind === 'widget') row.setAttribute('aria-label', r.label || '');
            else {
                var t = row.querySelector('.vo-mn-t');
                if (t && t.textContent !== r.label) t.textContent = r.label;
                rowHint(row, r.hint || (info && info.sc) || '');
                rowDesc(row, r.desc || '');
            }
            rowState(row, r);
        }

        /* On the right — the item explanation or the key shortcut; neither — empty. */
        function rowHint(row, text) {
            var h = row.querySelector('.vo-mn-h');
            if (!text) {
                h && h.parentNode.removeChild(h);
                return;
            }
            if (!h) {
                h = span('vo-mn-h');
                row.insertBefore(h, row.querySelector('.vo-mn-chk, .vo-mn-arrow'));
            }
            if (h.textContent !== text) h.textContent = text;
        }

        /* The description is the second line under the caption (the caption and description are in a shared column) and
           the item description for the screen reader; it is not part of the item name. */
        function rowDesc(row, text) {
            var d = row.querySelector('.vo-mn-d'), t = row.querySelector('.vo-mn-t');
            if (!text) {
                if (d) {
                    var box = d.parentNode;
                    box.parentNode.insertBefore(t, box);
                    box.parentNode.removeChild(box);
                    row.classList.remove('vo-has-desc');
                    describe(row);
                }
                return;
            }
            if (!d) {
                var col = span('vo-mn-tc');
                row.insertBefore(col, t);
                col.appendChild(t);
                d = span('vo-mn-d');
                d.id = 'vo-mn-d-' + (++descSeq);
                d.setAttribute('aria-hidden', 'true');
                col.appendChild(d);
                row.classList.add('vo-has-desc');
                describe(row);
            }
            if (d.textContent !== text) d.textContent = text;
        }

        /* The reason of a disabled item with a description — a hidden node for aria-describedby: that one
           overrides aria-description, and without the node the screen reader would announce only the description. An item
           without a description has no node, the reason is carried by aria-description. */
        function rowWhy(row, text) {
            var w = row.querySelector('.vo-mn-why');
            if (!text || !row.querySelector('.vo-mn-d')) {
                if (w) {
                    w.parentNode.removeChild(w);
                    describe(row);
                }
                return;
            }
            if (!w) {
                w = span('vo-mn-why');
                w.id = 'vo-mn-w-' + (++descSeq);
                w.hidden = true;
                row.appendChild(w);
                describe(row);
            }
            if (w.textContent !== text) w.textContent = text;
        }

        /* The item description for the screen reader: the disable reason (if there is a node), then the description. */
        function describe(row) {
            var ids = [], w = row.querySelector('.vo-mn-why'), d = row.querySelector('.vo-mn-d');
            if (w) ids.push(w.id);
            if (d) ids.push(d.id);
            if (ids.length) row.setAttribute('aria-describedby', ids.join(' '));
            else row.removeAttribute('aria-describedby');
        }

        function rowState(row, st) {
            var off = !!(st && st.disabled);
            row.classList.toggle('vo-locked', off);
            row.setAttribute('aria-disabled', off ? 'true' : 'false');
            var why = off ? reasonText(st.reason) : null;
            if (why) {
                row.setAttribute('title', why);
                row.setAttribute('aria-description', why);
            } else {
                row.removeAttribute('title');
                row.removeAttribute('aria-description');
            }
            rowWhy(row, why);
            if (row.hasAttribute('data-check')) rowCheck(row, st && st.checked);
        }

        function rowCheck(row, checked) {
            var radio = row.getAttribute('data-check') === 'radio';
            var state = !radio && checked === 'mixed' ? 'mixed' : checked ? 'true' : 'false';
            var previous = row.getAttribute('aria-checked');
            row.setAttribute('role', radio ? 'menuitemradio' : 'menuitemcheckbox');
            row.setAttribute('aria-checked', state);
            var mark = row.querySelector('.vo-mn-chk');
            if (mark && state !== previous) {
                mark.parentNode.removeChild(mark);
                mark = null;
            }
            if (state !== 'false' && !mark) {
                mark = span('vo-mn-chk');
                mark.setAttribute('aria-hidden', 'true');
                if (radio) {
                    /* The dot is by styles; by a symbol — only without a glyph set. */
                    mark.className += ' vo-mn-dot';
                    if (!icons()) mark.textContent = '●';
                } else if (state === 'mixed') {
                    mark.textContent = '−';
                } else {
                    var g = glyph('checkMenu', 16);
                    if (g) mark.innerHTML = g;
                    else mark.textContent = '✓';
                }
                row.insertBefore(mark, row.querySelector('.vo-mn-arrow'));
            }
        }

        /* Choosing a row. Before the action availability is re-read — for a submenu row and its
           parent item: an item disabled in the meantime is not executed and does not close the menu. */
        function activate(row) {
            var info = row._vo;
            if (!info || !info.it) return;
            var it = info.it;
            var fly = flyOf(row.closest('.vo-mn-fly'));
            if (fly && fly.row._vo) {
                var parent = adapter.itemState(fly.row._vo.it) || {};
                if (parent.visible === false || parent.disabled) {
                    rowState(fly.row, parent);
                    closeFlies(fly.level);
                    fly.row.isConnected && focusNode(fly.row);
                    return;
                }
            }
            var now = adapter.itemState(it) || {};
            rowState(row, now);
            if (now.visible === false || now.disabled) return;
            if (info.kind === 'submenu') { openSub(row, it, info.level); return; }
            if (!Model.actionable(it, now)) return;
            closeAll();
            beforeCommand();
            adapter.exec(it);
        }

        function beforeCommand() {
            m.held = false;
            keys('beforeCommand');
        }

        /* The editor's own row executes the command itself (its press is not a click of the menu row):
           availability is re-read, the menu closes, the hold is released — as with choosing
           an action item; without this the F10 hold would remain and would return at the next
           opening of a section with the mouse. */
        function execOwn(it, args) {
            if (!it) return false;
            var now = adapter.itemState(it) || {};
            if (now.visible === false || now.disabled) return false;
            closeAll();
            beforeCommand();
            adapter.exec(it, args);
            return true;
        }

        function openSub(row, it, level) {
            closeFlies(level + 1);
            if (typeof adapter.openRow === 'function' && adapter.openRow(row, it, level)) {
                m.owned = {row: row, level: level + 1};
                row.classList.add('vo-sub-open');
                row.setAttribute('aria-expanded', 'true');
                return;
            }
            var rows = snapshot(Model.itemsOf(it, context())).rows;
            if (!rows.length) return;
            var fly = document.createElement('div');
            fly.className = 'vo-mn-drop vo-mn-fly open';
            fly.setAttribute('role', 'menu');
            var cap = row.querySelector('.vo-mn-t');
            if (cap) fly.setAttribute('aria-label', cap.textContent);
            fly.setAttribute('data-level', String(level + 1));
            bindListScroll(fly);
            var rec = {level: level + 1, el: fly, row: row, k: it.k, list: {nodes: {}}};
            renderList(fly, rec.list, rows, level + 1);
            m.bar.appendChild(fly);
            m.flies.push(rec);
            row.classList.add('vo-sub-open');
            row.setAttribute('aria-expanded', 'true');
            placeFly(fly, row);
        }

        /* Hover: on an item with a submenu — open it after a delay, on the others — close
           the submenus deeper than this level. */
        function hoverRow(row, level, open) {
            clearTimeout(m.timer);
            m.timer = setTimeout(guarded('menu hover', function () {
                if (open) {
                    if (!row.classList.contains('vo-sub-open') && row.isConnected) open();
                } else {
                    closeFlies(level + 1);
                }
            }), HOVER_DELAY);
        }

        /* Keep rectangles in layout coordinates, like offset/client sizes, including SDK application scale. */
        function layoutRect(node) {
            var utils = Common.Utils;
            return utils && typeof utils.getBoundingClientRect === 'function' ?
                utils.getBoundingClientRect(node) : node.getBoundingClientRect();
        }

        /* The root stays in the editor window and in the client area of each clipping ancestor. */
        function rootBounds(drop) {
            var left = 0, right = document.documentElement.clientWidth || window.innerWidth || 0;
            var clips = [];
            for (var node = drop.parentElement; node; node = node.parentElement) {
                var style = window.getComputedStyle(node);
                if (!/^(hidden|clip|auto|scroll)$/.test(style.overflowX)) continue;
                var rect = layoutRect(node);
                var start = rect.left + (node.clientLeft || 0);
                left = Math.max(left, start);
                right = Math.min(right, start + node.clientWidth);
                clips.push(node);
            }
            return {left: left + 4, right: right - 4, clips: clips};
        }

        function placeRoot(drop, keepFocusVisible) {
            var bounds = rootBounds(drop), available = bounds.right - bounds.left;
            watchClips(bounds.clips);
            if (!shown(drop) || !drop.offsetWidth || available <= 0) return;
            var parent = drop.offsetParent || drop.parentElement;
            var rect = layoutRect(parent);
            var signature = function () {
                return [bounds.left, bounds.right, rect.left, rect.top,
                    parent.clientWidth, parent.scrollLeft, drop.offsetWidth, drop.offsetHeight, drop.innerHTML].join('|');
            };
            var saved = drop._voPlacement;
            if (saved && saved.signature === signature()) return;
            if (keepFocusVisible === undefined) keepFocusVisible = focusedRowVisible();
            if (!saved) {
                saved = drop._voPlacement = {};
                ['left', 'right', 'width', 'minWidth', 'maxWidth', 'boxSizing'].forEach(function (key) {
                    saved[key] = drop.style[key];
                });
            }
            var scroll = drop.scrollTop;
            ['left', 'right', 'width', 'minWidth', 'maxWidth', 'boxSizing'].forEach(function (key) {
                drop.style[key] = saved[key];
            });
            drop.classList.remove('vo-mn-constrained');
            if (drop.offsetWidth > available) {
                drop.style.boxSizing = 'border-box';
                drop.style.minWidth = '0';
                drop.style.width = available + 'px';
                drop.style.maxWidth = available + 'px';
                drop.classList.add('vo-mn-constrained');
            }
            /* offsetLeft/offsetWidth describe the final layout, unaffected by the opening animation. */
            var preferred = rect.left + (parent.clientLeft || 0) + drop.offsetLeft - (parent.scrollLeft || 0);
            var left = Math.min(Math.max(preferred, bounds.left), bounds.right - drop.offsetWidth);
            if (Math.abs(left - preferred) > 0.01) {
                drop.style.left = (drop.offsetLeft + left - preferred) + 'px';
                drop.style.right = 'auto';
            }
            drop.scrollTop = scroll;
            if (keepFocusVisible) revealFocusedRow(drop);
            saved.signature = signature();
        }

        function focusedRowBounds(drop) {
            var active = document.activeElement;
            if (!active || !drop.contains(active)) return null;
            var row = active.closest('.vo-mn-sub') || active;
            var node = row, top = 0;
            /* Layout offsets do not depend on the popup's opening animation. */
            while (node && node !== drop) {
                top += node.offsetTop;
                node = node.offsetParent;
                if (node && node !== drop) top += node.clientTop - node.scrollTop;
            }
            return node === drop ? {top: top, bottom: top + row.offsetHeight} : null;
        }

        function focusedRowVisible() {
            var active = document.activeElement;
            var drop = active && active.closest('.vo-mn-drop');
            var bounds = drop && focusedRowBounds(drop);
            return !!bounds && bounds.top >= drop.scrollTop && bounds.bottom <= drop.scrollTop + drop.clientHeight;
        }

        function revealFocusedRow(drop) {
            var bounds = focusedRowBounds(drop);
            if (!bounds) return;
            if (bounds.top < drop.scrollTop) drop.scrollTop = bounds.top;
            else if (bounds.bottom > drop.scrollTop + drop.clientHeight) {
                drop.scrollTop = Math.min(bounds.top, bounds.bottom - drop.clientHeight);
            }
        }

        function watchClips(clips) {
            if (!ro) return;
            observedClips.forEach(function (node) {
                if (clips.indexOf(node) < 0) {
                    if (node !== m.bar && node !== m.status) ro.unobserve(node);
                    borderRo.unobserve(node);
                }
            });
            clips.forEach(function (node) {
                if (observedClips.indexOf(node) < 0) {
                    ro.observe(node);
                    borderRo.observe(node, {box: 'border-box'});
                }
            });
            observedClips = clips;
        }

        function placeOpenLists(keepFocusVisible) {
            if (m.open >= 0) placeRoot(m.sections[m.open].drop, keepFocusVisible);
            else if (moreOpen()) placeRoot(m.more.drop, keepFocusVisible);
            m.flies.forEach(function (f) { placeFly(f.el, f.row); });
        }

        /* A submenu to the right of the item (right to left — on the left), its first row level with it;
           if it does not fit at the window edge — on the other side; vertically — within the window. */
        function placeFly(fly, row) {
            var bar = m.bar;
            var br = layoutRect(bar), rr = layoutRect(row);
            var utils = Common.Utils;
            var vh = utils && typeof utils.innerHeight === 'function' ? utils.innerHeight() : window.innerHeight || 0;
            var bounds = rootBounds(fly);
            var w = fly.offsetWidth || 0, h = fly.offsetHeight || 0;
            var after = rr.right - br.left - 2, before = rr.left - br.left - w + 2;
            var r2l = rtl();
            var left = r2l ? before : after;
            if (!r2l && br.left + left + w > bounds.right) left = before;
            if (r2l && br.left + left < bounds.left) left = after;
            if (bounds.right - bounds.left >= w) {
                left = Math.min(Math.max(left, bounds.left - br.left), bounds.right - br.left - w);
            }
            /* Level — a shift by the actual top margin of the list (border and padding): each
               editor has its own. The margin is taken from the layout, not from the borders on
               the screen: the list is measured on the first frame of its appearance, still compressed. */
            fly.style.position = 'absolute';
            var first = fly.firstElementChild;
            var lead = first ? fly.clientTop + first.offsetTop : 0;
            var top = rr.top - br.top - lead;
            if (vh && br.top + top + h > vh - 4) top = vh - 4 - h - br.top;
            if (br.top + top < 4) top = 4 - br.top;
            fly.style.left = Math.round(left) + 'px';
            fly.style.top = Math.round(top) + 'px';
        }

        function closeFlies(fromLevel) {
            if (m.owned && m.owned.level >= fromLevel) {
                var own = m.owned;
                m.owned = null;
                own.row.classList.remove('vo-sub-open');
                own.row.setAttribute('aria-expanded', 'false');
                if (typeof adapter.closeRow === 'function') adapter.closeRow(own.row, own.row._vo && own.row._vo.it);
            }
            var keep = [];
            m.flies.forEach(function (f) {
                if (f.level < fromLevel) { keep.push(f); return; }
                f.el.parentNode && f.el.parentNode.removeChild(f.el);
                f.row.classList.remove('vo-sub-open');
                f.row.setAttribute('aria-expanded', 'false');
            });
            m.flies = keep;
        }

        function closeAll() {
            clearTimeout(m.timer);
            closeFlies(1);
            m.open = -1;
            m.more.open = false;
            syncExpanded();
        }

        /* Escape removes one top layer: the deepest submenu, then the section or "…". */
        function closeTop() {
            clearTimeout(m.timer);
            if (m.owned || m.flies.length) {
                var deepest = m.owned ? m.owned.level : 0;
                m.flies.forEach(function (f) { deepest = Math.max(deepest, f.level); });
                closeFlies(deepest);
                return true;
            }
            if (m.open >= 0 || moreOpen()) { closeAll(); return true; }
            return false;
        }

        /* --- Keyboard ------------------------------------------------------------ */
        /* WAI-ARIA APG "Menubar": the menu bar is one Tab stop, ←/→ (reversed in RTL),
           Home/End — through the sections in a circle; an open section moves along. ↓, Enter, Space
           open the section and put focus on the first item, ↑ — on the last one. In a list ↑/↓,
           Home/End — through the items in a circle; disabled items are in the traversal (the screen reader announces them
           as unavailable and the reason). → on an item with ▸ opens the submenu and leads to its first
           item, on others — to the neighboring section; ← in a submenu closes it and returns to the item,
           in a section — to the neighboring section. Enter and Space execute the item (its click). Tab
           closes the menu and moves on in the stock way; Escape removes a layer (onEscape).
           Submenus of any level open, are placed and close the same way: ← and Escape
           remove only the deepest. The buttons and the field of the editor's own row sit in the traversal
           of the list on a par with the items; in the field ↑/↓ and Tab are the same, other keys go to the field (text,
           caret, Enter — its command).
           The Bootstrap delegate on document suppresses any key inside [role=menu]
           (common/main/lib/extend/Bootstrap.js), so the keys that the bar handles itself
           do not go beyond it: Enter and Space — click of the item, Tab — stopPropagation without
           preventDefault; the field keys also stop at the bar, but without preventDefault. */

        function menuItems(box) {
            return Array.prototype.filter.call(box ? box.querySelectorAll('button, input, select, textarea') : [], function (el) {
                return el.getClientRects().length > 0 && el.closest('.vo-mn-drop') === box;
            });
        }

        /* The input field of the own row: the editing keys are its. */
        function field(el) {
            if (!el || !el.tagName) return false;
            var tag = el.tagName.toLowerCase();
            if (tag === 'textarea' || tag === 'select') return true;
            return tag === 'input' && !/^(button|checkbox|radio|submit|reset|image|file|color|range)$/i.test(el.type || '');
        }

        function focusFirst(box, last) {
            var list = menuItems(box);
            if (!list.length) return false;
            list[last ? list.length - 1 : 0].focus();
            return true;
        }

        /* The list opened by a bar button: a section or "…" (for "…" — the list of the open section that went
           there, if it is open). */
        function dropOf(btn) {
            if (btn === m.more.btn) {
                if (m.open >= 0 && m.sections[m.open].over) return m.sections[m.open].drop;
                return m.more.drop;
            }
            var s = sectionByBtn(btn);
            return s ? s.drop : null;
        }

        function sectionByBtn(btn) {
            for (var i = 0; i < m.sections.length; i++) if (m.sections[i].btn === btn) return m.sections[i];
            return null;
        }

        function openTop(btn) {
            if (btn === m.more.btn) {
                if (m.open >= 0 && m.sections[m.open].over) return true;
                closeAll();
                return openMore();
            }
            var s = sectionByBtn(btn);
            if (!s) return false;
            var i = m.sections.indexOf(s);
            if (m.open === i) return true;
            closeAll();
            return openSection(i);
        }

        function focusTop(index, open) {
            var list = tops(), n = list.length;
            if (!n) return null;
            var btn = list[((index % n) + n) % n];
            rove(btn);
            if (open) {
                closeAll();
                openTop(btn);
            }
            btn.focus();
            return btn;
        }

        function flyOf(box) {
            return m.flies.filter(function (f) { return f.el === box; })[0] || null;
        }

        function menuKey(e) {
            if (!e || e.defaultPrevented) return;
            var t = e.target, key = e.key;
            /* A field of the own row in a list: its editing keys do not go beyond the bar, but are not
               suppressed either; ↑/↓ without modifiers and Tab are handled by the bar. */
            if (field(t) && t.closest('.vo-mn-drop') && m.bar.contains(t) &&
                (e.altKey || e.ctrlKey || e.metaKey || (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Tab'))) {
                e.stopPropagation();
                return;
            }
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            var r2l = rtl();
            var next = r2l ? 'ArrowLeft' : 'ArrowRight', prev = r2l ? 'ArrowRight' : 'ArrowLeft';
            var list = tops(), ti = list.indexOf(t);
            if (ti >= 0) {
                var wasOpen = m.open >= 0 || moreOpen();
                if (key === 'Tab') {
                    if (isOpen()) closeAll();
                    e.stopPropagation();
                    return;
                }
                if (key === next) focusTop(ti + 1, wasOpen);
                else if (key === prev) focusTop(ti - 1, wasOpen);
                else if (key === 'Home') focusTop(0, wasOpen);
                else if (key === 'End') focusTop(list.length - 1, wasOpen);
                else if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
                    if (openTop(t)) focusFirst(dropOf(t), key === 'ArrowUp');
                } else {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            var box = t && t.closest ? t.closest('.vo-mn-drop') : null;
            if (!box || !m.bar.contains(box)) return;
            var items = menuItems(box), i = items.indexOf(t);
            if (i < 0) return;
            var len = items.length, fly = flyOf(box);
            var level = fly ? fly.level : 0;
            var hasSub = t.classList.contains('vo-has-sub');
            var host = currentHost();
            if (key === 'Tab') {
                /* The menu is closed, focus is on the section button; Tab moves on in the stock way. */
                closeAll();
                host && host.focus();
                e.stopPropagation();
                return;
            }
            if (key === 'ArrowDown') items[(i + 1) % len].focus();
            else if (key === 'ArrowUp') items[(i - 1 + len) % len].focus();
            else if (key === 'Home') items[0].focus();
            else if (key === 'End') items[len - 1].focus();
            else if ((key === next || key === 'Enter' || key === ' ') && hasSub &&
                     !(key === next && t.getAttribute('aria-disabled') === 'true')) openSubKey(t);
            /* The final item — its same click, as with the mouse; a disabled one refuses itself. */
            else if (key === 'Enter' || key === ' ') t.click();
            else if (key === prev && level > 0) {
                var row = fly.row;
                closeFlies(level);
                row && row.focus();
            } else if (key === next || key === prev) {
                var at = tops().indexOf(host);
                var to = focusTop(at + (key === next ? 1 : -1), true);
                to && focusFirst(dropOf(to));
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        }

        function openSubKey(t) {
            t.click();
            var deeper = m.flies.filter(function (f) { return f.row === t; })[0];
            if (deeper) { focusFirst(deeper.el); return; }
            /* The editor's own surface: focus is put into it by the adapter. */
            if (m.owned && m.owned.row === t) {
                if (typeof adapter.focusRow === 'function') adapter.focusRow(t, t._vo && t._vo.it);
                return;
            }
            /* The "…" row: the section list opened in its place. */
            if (t.classList.contains('vo-mn-more-row') && m.open >= 0) focusFirst(m.sections[m.open].drop);
        }

        /* The bar button under which a list is open now: of a section, "…" or the current one. */
        function currentHost() {
            if (m.open >= 0) return hostOf(m.open);
            if (moreOpen()) return m.more.btn;
            return m.cur;
        }

        /* Whom to return focus to when a layer is closed: the parent item of a submenu, the section button
           or "…" — the first visible one. */
        function openerChain(el) {
            var out = [];
            if (inOwned(el)) {
                out.push(m.owned.row);
                el = m.owned.row;
            }
            if (!el || el.nodeType !== 1 || !m.bar.contains(el)) return out;
            var box = el.closest('.vo-mn-drop'), f = box && flyOf(box);
            while (f) {
                out.push(f.row);
                var up = f.row.closest('.vo-mn-drop');
                f = up ? flyOf(up) : null;
            }
            if (m.owned) out.push(m.owned.row);
            var host = currentHost();
            if (host && el !== host) out.push(host);
            return out;
        }

        function focusNode(el) {
            if (m.held) keys('hold');
            el.focus();
        }

        function refocus(prev, chain) {
            if (!prev || prev.nodeType !== 1) return;
            if (shown(prev) && document.activeElement === prev) return;
            var list = [prev].concat(chain || []);
            for (var i = 0; i < list.length; i++) {
                if (shown(list[i])) { focusNode(list[i]); return; }
            }
        }

        /* Escape: while a menu layer is open — removes it, one, and goes no further. If there are no layers and focus
           is in the bar — the keyboard returns to the document (keys.release) and focus — to whoever had
           it before entering: a comment field, search, font size; we do not touch the field value. */
        function onEscape(e) {
            if (!e || (e.key !== 'Escape' && e.keyCode !== 27)) return;
            if (!shown(m.bar)) return;
            if (isOpen()) {
                var prev = document.activeElement, chain = openerChain(prev);
                closeTop();
                refocus(prev, chain);
                e.preventDefault && e.preventDefault();
                e.stopPropagation && e.stopPropagation();
                return;
            }
            if (!m.bar.contains(document.activeElement)) return;
            leave();
            e.preventDefault && e.preventDefault();
            e.stopPropagation && e.stopPropagation();
        }

        /* The keyboard taken by F10 — back to the document. */
        function giveBack() {
            if (!m.held) return;
            m.held = false;
            keys('release');
        }

        function leave() {
            var to = m.opener;
            giveBack();
            m.opener = null;
            if (to && to !== document.body && shown(to) && typeof to.focus === 'function') to.focus();
            else if (m.bar.contains(document.activeElement)) document.activeElement.blur();
        }

        /* Keyboard entry (F10, as into the menu bar of desktop programs): the engine keyboard
           is held by the menu, focus goes to the bar stop. Did not land — there is no hold. Under a window
           and the loading mask we do not enter: the keys are theirs (like the stock Alt hints). */
        function enter() {
            if (!shown(m.bar)) return false;
            if (typeof adapter.blocked === 'function' && adapter.blocked()) return false;
            var stop = (m.cur && tops().indexOf(m.cur) >= 0) ? m.cur : tops()[0];
            if (!stop) return false;
            var prev = document.activeElement, held = m.held;
            if (prev && prev !== document.body && !m.bar.contains(prev)) m.opener = prev;
            closeAll();
            keys('hold');
            m.held = true;
            rove(stop);
            stop.focus();
            if (document.activeElement === stop) return true;
            if (!held) { m.held = false; keys('release'); }
            return false;
        }

        function onF10(e) {
            if (!e || e.key !== 'F10' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
            if (!enter()) return;
            e.preventDefault && e.preventDefault();
            e.stopPropagation && e.stopPropagation();
        }

        /* A click outside the menu closes it and returns to the document the keyboard taken by F10 —
           also when the menu is closed. The press is pointerdown on window in the capture phase: over the canvas the
           engine cancels pointerdown, the browser does not generate the compatible mousedown, and focus
           stays in the bar. */
        function onOutside(e) {
            if (!isOpen() && !m.held) return;
            var t = e && e.target;
            if (t && t.nodeType === 1 && (m.bar.contains(t) || inOwned(t))) return;
            closeAll();
            giveBack();
        }

        /* The wheel over a menu list: the SDK wheel handler on bubbling cancels the ordinary wheel,
           and a long list would not scroll. The ordinary wheel goes no further than the list, the browser
           scrolls the nearest scrollable node, not passing scroll to the page at its edges
           (overscroll-behavior: contain); nothing to scroll — the wheel is suppressed.
           With modifiers — the stock path (zoom). */
        function bindListScroll(el) {
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
            var onWheel = guarded('menu wheel', function (e) {
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
        }

        /* --- Width: "…" ---------------------------------------------------------- */
        /* Not enough width — sections from the end go one by one into "…", the pinned section
           stays on the right, "…" is before it. The list of the open section that went there takes the place of
           "…" and stays open; when the section returns to the bar — the list returns to it. */

        function applyVisible(keepFocusVisible) {
            sections().forEach(function (s) {
                s.wrap.style.display = s.visible ? '' : 'none';
            });
            layout(keepFocusVisible);
        }

        /* The status is no wider than the rest of the bar: long text is clipped with an ellipsis (styles), the full one is
           in the hint; the screen reader reads it entirely from the live region. */
        function statusTitle() {
            var el = m.status;
            if (!el) return;
            if (el.textContent && el.scrollWidth > el.clientWidth) el.setAttribute('title', el.textContent);
            else el.removeAttribute('title');
        }

        function fits() {
            var bar = m.bar, br = bar.getBoundingClientRect(), cs = window.getComputedStyle(bar);
            var r2l = cs.direction === 'rtl';
            var padL = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
            var padR = (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderRightWidth) || 0);
            var ok = true;
            Array.prototype.forEach.call(bar.children, function (child) {
                if (!ok || child.classList.contains('vo-mn-fly') || !child.getClientRects().length) return;
                var rc = child.getBoundingClientRect();
                if (r2l ? rc.left < br.left + padL - 0.5 : rc.right > br.right - padR + 0.5) ok = false;
            });
            return ok;
        }

        function layout(keepFocusVisible) {
            var bar = m.bar;
            watchClips(rootBounds(m.more.drop).clips);
            if (!bar || !shown(bar) || !bar.clientWidth) return;
            if (keepFocusVisible === undefined) keepFocusVisible = focusedRowVisible();
            var active = document.activeElement;
            var moreRows = Array.prototype.slice.call(m.more.drop.children);
            var moreRow = active && m.more.drop.contains(active) ? active.getAttribute('data-k') : null;
            var moreButton = active === m.more.btn;
            sections().forEach(function (s) {
                s.over = false;
                s.wrap.style.display = s.visible ? '' : 'none';
            });
            m.more.wrap.style.display = 'none';
            if (!fits()) {
                m.more.wrap.style.display = '';
                for (var i = m.sections.length - 1; i >= 0 && !fits(); i--) {
                    var s = m.sections[i];
                    if (!s.visible || s.k === opts.pinned) continue;
                    s.over = true;
                    s.wrap.style.display = 'none';
                }
                if (!sections().some(function (x) { return x.over; })) m.more.wrap.style.display = 'none';
            }
            /* The section list lives at the button that is in view: its own or "…". */
            sections().forEach(function (s) {
                var host = s.over ? m.more.wrap : s.wrap;
                if (s.drop.parentNode !== host) host.appendChild(s.drop);
            });
            if (moreOpen()) {
                var hidden = sections().filter(function (x) { return x.visible && x.over; });
                if (hidden.length) fillMore(hidden);
                else m.more.open = false;
            }
            syncExpanded();
            rove(tops().indexOf(m.cur) >= 0 ? m.cur : null);
            if (active && active !== document.activeElement && bar.contains(active) && shown(active)) active.focus();
            /* The focused button went into "…" — focus goes to "…". */
            var gone = active && bar.contains(active) && !shown(active) ? sectionByBtn(active) : null;
            if (gone && gone.visible && gone.over) {
                rove(m.more.btn);
                focusNode(m.more.btn);
            }
            if (moreRow) {
                var section = sections().filter(function (s) { return s.k === moreRow && s.visible; })[0];
                if (section && !section.over) {
                    rove(section.btn);
                    focusNode(section.btn);
                } else if (section && document.activeElement !== active) {
                    var row = Array.prototype.filter.call(m.more.drop.children, function (el) {
                        return el.getAttribute('data-k') === moreRow;
                    })[0];
                    if (row) focusNode(row);
                } else if (!section) {
                    var at = moreRows.indexOf(active);
                    var candidates = moreRows.slice(at + 1).concat(moreRows.slice(0, at).reverse());
                    var target = candidates.filter(function (row) { return shown(row); })[0];
                    if (target) focusNode(target);
                    else {
                        var index = sections().map(function (s) { return s.k; }).indexOf(moreRow);
                        target = nearestTop(index);
                        if (target) focusNode(target);
                        else leave();
                    }
                }
            } else if (moreButton && !shown(m.more.btn)) {
                var visible = tops(), next = visible[visible.length - 1];
                if (next) { rove(next); focusNode(next); }
                else leave();
            }
            placeOpenLists(keepFocusVisible);
        }

        /* --- Refreshing the open menu ------------------------------------------ */
        /* No more than once per frame: snapshots of all sections, visibility of the buttons and "…", rows of the open
           list and submenu — without closing. A focused row vanished — focus goes to the next
           visible one, otherwise to the previous; an item with an open submenu or its own
           editor surface became disabled or vanished — the submenu or surface closes, focus goes to the item; a section
           became empty — it closes and disappears together with its button, focus goes to the nearest visible section
           (went into "…" — to "…"), no sections — to whoever opened the menu. Focus is not put
           on a removed node. All sections of one pass are read with one pass object (groups). */

        function refresh() {
            if (frame) return;
            var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
            frame = raf(guarded('menu refresh', function () {
                frame = 0;
                update();
            }));
        }

        function update() {
            if (!m.bar) return;
            var active = document.activeElement;
            var keepFocusVisible = focusedRowVisible();
            var inMenu = !!active && m.bar.contains(active);
            var pass = {};
            var snaps = sections().map(function (s) {
                var snap = sectionSnapshot(s, pass);
                s.visible = snap.visible;
                return snap;
            });
            var openIdx = m.open;
            var focusLost = null;
            /* Where focus was before the rebuild: in the open section list, in a submenu, on a button. */
            var openS = openIdx >= 0 ? m.sections[openIdx] : null;
            var wasInOpen = inMenu && !!openS && (openS.drop.contains(active) || hostOf(openIdx) === active ||
                m.flies.some(function (f) { return f.el.contains(active); }));

            if (openS && !openS.visible) {
                closeAll();
                applyVisible(keepFocusVisible);
                if (wasInOpen) focusLost = nearestTop(openIdx);
            } else {
                applyVisible(keepFocusVisible);
                if (openS) {
                    var rows = snaps[openIdx].rows;
                    var target = lostFocusTarget(openS.drop, openS.list, rows, active);
                    renderList(openS.drop, openS.list, rows, 0);
                    updateFlies(rows, active);
                    updateOwned(rows, active);
                    if (target && target.isConnected && document.activeElement !== target) focusNode(target);
                }
                /* The focused button vanished (its section became empty). */
                var s = inMenu && active && !shown(active) ? sectionByBtn(active) : null;
                if (s && !s.visible) focusLost = nearestTop(m.sections.indexOf(s));
            }
            if (focusLost) focusNode(focusLost);
            placeOpenLists(keepFocusVisible);
        }

        /* Where to move focus if the focused row disappears: the next remaining row of the
           list, otherwise the previous one. null — focus is not in this list or the row stays. */
        function lostFocusTarget(drop, list, rows, active) {
            if (!active || !drop.contains(active) || !list) return null;
            var row = active.closest('.vo-mn-sub, .vo-mn-widget') || active;
            var info = row._vo;
            if (!info) return null;
            var keep = {};
            rows.forEach(function (r) { if (r.kind !== 'sep' && r.kind !== 'group') keep[r.k] = r.kind; });
            if (keep[info.k] === info.kind) return null;
            var old = (list.rows || []).filter(function (r) { return r.kind !== 'sep' && r.kind !== 'group'; })
                .map(function (r) { return r.k; });
            var at = old.indexOf(info.k);
            var pick = function (k) { return keep[k] && keep[k] !== 'widget' && keep[k] === kindIn(list, k) ? k : null; };
            for (var i = at + 1; i < old.length; i++) if (pick(old[i])) return list.nodes[old[i]];
            for (var j = at - 1; j >= 0; j--) if (pick(old[j])) return list.nodes[old[j]];
            return null;
        }

        function kindIn(list, k) {
            var node = list.nodes[k];
            return node && node._vo ? node._vo.kind : null;
        }

        /* A submenu of any level — by its item in the section snapshot tree (item keys
           are unique across the whole menu). One closed along the way (an item a level higher became disabled) is not updated. */
        function updateFlies(rows, active) {
            m.flies.slice().forEach(function (f) {
                if (m.flies.indexOf(f) < 0) return;
                var parent = subRow(rows, f.k);
                var inside = !!active && f.el.contains(active);
                if (!parent || parent.disabled || !parent.rows || !parent.rows.length) {
                    closeFlies(f.level);
                    if (inside && parent && f.row.isConnected) focusNode(f.row);
                    return;
                }
                var target = lostFocusTarget(f.el, f.list, parent.rows, active);
                renderList(f.el, f.list, parent.rows, f.level);
                if (target && target.isConnected && document.activeElement !== target) focusNode(target);
            });
        }

        /* The own submenu surface — by its item, like a menu bar submenu: the item became disabled or vanished
           (including together with a submenu a level higher) — the surface closes (closeRow); if focus
           was in it — goes to the item, if it remains. */
        function updateOwned(rows, active) {
            var own = m.owned;
            if (!own) return;
            var info = own.row._vo;
            var parent = info ? ownedRow(rows, info.k, info.kind) : null;
            if (parent && !parent.disabled && own.row.isConnected) return;
            var inside = inOwned(active);
            closeFlies(own.level);
            if (inside && own.row.isConnected) focusNode(own.row);
        }

        function ownedRow(rows, k, kind) {
            for (var i = 0; i < (rows || []).length; i++) {
                var r = rows[i];
                if (r.k === k && r.kind === kind) return r;
                var deeper = r.rows && ownedRow(r.rows, k, kind);
                if (deeper) return deeper;
            }
            return null;
        }

        function subRow(rows, k) {
            for (var i = 0; i < (rows || []).length; i++) {
                var r = rows[i];
                if (r.k === k && r.kind === 'submenu') return r;
                var deeper = r.rows && subRow(r.rows, k);
                if (deeper) return deeper;
            }
            return null;
        }

        /* The nearest visible section to i: first the next one, then the previous one at the same
           distance; went into "…" — the "…" button; no sections — whoever opened the menu. */
        function nearestTop(i) {
            var list = m.sections;
            for (var d = 1; d <= list.length; d++) {
                var cand = [list[i + d], list[i - d]];
                for (var c = 0; c < cand.length; c++) {
                    var s = cand[c];
                    if (s && s.visible) {
                        var btn = s.over ? m.more.btn : s.btn;
                        if (shown(btn)) { rove(btn); return btn; }
                    }
                }
            }
            var to = m.opener;
            giveBack();
            if (to && shown(to)) return to;
            return false;
        }

        /* --- Assembly ------------------------------------------------------------- */

        build();

        var listeners = [];
        function listen(target, type, fn, capture) {
            target.addEventListener(type, fn, capture);
            listeners.push(function () { target.removeEventListener(type, fn, capture); });
        }
        listen(window, 'keydown', guarded('menu Escape', onEscape), true);
        if (opts.f10 !== false) listen(window, 'keydown', guarded('menu F10', onF10), true);
        listen(window, ('onpointerdown' in window) ? 'pointerdown' : 'mousedown', guarded('menu outside click', onOutside), true);
        /* Focus left the own submenu surface bypassing it and the bar — the hold is released, as
           when focus leaves the bar (the bar's focusout does not see this: focus was not in it). */
        listen(window, 'focusin', guarded('menu focus', function (e) {
            if (!m.held || !m.owned) return;
            var t = e && e.target;
            if (t && t.nodeType === 1 && !m.bar.contains(t) && !inOwned(t)) giveBack();
        }), true);
        var relayout = guarded('menu width', function () {
            if (destroyed || layoutFrame) return;
            var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
            layoutFrame = raf(guarded('menu layout', function () {
                layoutFrame = 0;
                if (destroyed) return;
                layout();
                statusTitle();
            }));
        });
        listen(window, 'resize', relayout);
        if (typeof window.ResizeObserver === 'function') {
            var ro = new window.ResizeObserver(relayout);
            var borderRo = new window.ResizeObserver(relayout);
            ro.observe(m.bar);
            ro.observe(m.status);
            watchClips(rootBounds(m.more.drop).clips);
            subs.push(function () { ro.disconnect(); borderRo.disconnect(); });
        }
        /* The new status text of the same width does not change the size: the hint is updated by it too. */
        if (typeof window.MutationObserver === 'function') {
            var mo = new window.MutationObserver(relayout);
            mo.observe(m.status, {childList: true, characterData: true, subtree: true});
            subs.push(function () { mo.disconnect(); });
        }

        return {
            el: m.bar,
            enter: guarded('menu enter', enter),
            open: function (k) {
                for (var i = 0; i < m.sections.length; i++) {
                    if (m.sections[i].k !== k) continue;
                    closeAll();
                    return openSection(i);
                }
                return false;
            },
            close: function () { closeAll(); },
            isOpen: isOpen,
            refresh: refresh,
            status: function () { return m.status; },
            exec: guarded('menu own row', execOwn),
            ownClosed: guarded('menu own surface', ownClosed),
            destroy: function () {
                destroyed = true;
                closeAll();
                clearTimeout(m.timer);
                if (frame) {
                    (window.cancelAnimationFrame || clearTimeout)(frame);
                    frame = 0;
                }
                if (layoutFrame) {
                    (window.cancelAnimationFrame || clearTimeout)(layoutFrame);
                    layoutFrame = 0;
                }
                listeners.concat(subs).forEach(function (off) { off(); });
                listeners = [];
                subs = [];
                m.bar.parentNode && m.bar.parentNode.removeChild(m.bar);
            }
        };
    }

    MenuBar.HOVER_DELAY = HOVER_DELAY;
    MenuBar.keyHint = keyHint;
    MenuBar.create = create;

    return MenuBar;
});
