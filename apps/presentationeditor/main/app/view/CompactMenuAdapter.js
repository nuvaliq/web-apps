/*
 * CompactMenuAdapter — presentations behind the shared menu row of the Compact shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The shared menu row (Common.UI.Compact.MenuBar) knows neither the catalog nor the stock: sections and
 * items are handed to it by this adapter from the SlideActions catalog, the item state — by the same
 * SlideActions (itemCode) that decides which items are disabled and when. There are no availability
 * rules of its own here.
 *
 * Sections are the catalog sections in its order, keys — SECTIONS. A catalog item is an item of the shared
 * model (Common.UI.Compact.MenuModel) with the same key k, the source catalog item is in src:
 *  - twin, cmd, engine, window — an action ('action'); check — a toggle ('check');
 *  - a catalog submenu (sub — a list) — a submenu ('submenu'), its rows are the catalog items
 *    that the stock does not hide (SlideActions.visibleItems); an inline item — the rows of the stock
 *    menu of its counterpart right inside this submenu;
 *  - a counterpart submenu (sub: true) and a gallery (gallery) — a submenu with one empty
 *    placeholder row (pending) until it opens: the stock menu is read only on opening, as before.
 *
 * A mirror submenu is a snapshot of the counterpart's stock menu (SlideActions.mirrorList, StockBridge.mirror),
 * the row key is <k>.<item path in the stock menu>. The snapshot is taken on opening (openRow) and
 * kept while the submenu is open: refresh() of the menu row does not reread it. A mirror row:
 *  - the stock caption, mark and availability; a disabled root disables the row with its reason;
 *    the icon is by the stock item icon class (the icons table of the catalog item);
 *  - its own stock submenu — a second-level submenu from the same snapshot;
 *  - a gallery — a ▸ item whose openRow shows the stock gallery at the row
 *    (StockBridge.gallery): this is the submenu's own surface — owns answers for its nodes,
 *    focusRow puts focus into it, closeRow closes it. A choice in the gallery closes the menu
 *    (ownClosed('chosen')); if the stock removed it itself, the menu stays alive, focus on the item
 *    (ownClosed('dismissed')). The same applies to a catalog gallery item.
 *
 * Disable reasons are SlideActions.itemCode codes, the text is SlideActions.reasonText. The order is
 * REASONS; a catalog item carries one reason, the menu row needs the order for its contract.
 *
 * Before a section opens, the stock context menus are rebuilt from the current selection
 * (SlideActions.primeStockMenus): section counterparts read their items. The rebuild happens once per
 * pass of the menu row (the snap object).
 *
 * The shortcut from the stock registry, the engine keyboard and "editor covered" are a shared helper
 * of adapters (Common.UI.Compact.AdapterKit) over the presentation controllers.
 */
define([
    'common/main/lib/view/compact/MenuModel',
    'common/main/lib/view/compact/AdapterKit',
    'presentationeditor/main/app/view/StockBridge',
    'presentationeditor/main/app/view/SlideActions'
], function (Model, Kit, Bridge, Actions) {
    'use strict';

    if (window.PE === undefined) window.PE = {};
    if (PE.Views === undefined) PE.Views = {};

    function model() {
        if (Model && typeof Model.state === 'function') return Model;
        return window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.MenuModel;
    }

    function kit() {
        if (Kit && typeof Kit.create === 'function') return Kit;
        return window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.AdapterKit;
    }

    function actions() {
        return Actions && typeof Actions.itemCode === 'function' ? Actions : PE.Views.SlideActions;
    }

    function bridge() {
        return Bridge && typeof Bridge.mirror === 'function' ? Bridge : PE.Views.StockBridge;
    }

    /* Keys of the menu row sections in the catalog order (SlideActions.catalog). */
    var SECTIONS = ['file', 'edit', 'view', 'insert', 'format', 'slide', 'arrange', 'collab', 'help'];

    /* The order of disable reasons from the highest to the lowest: shared MenuModel codes and presentation codes
       (SlideActions.itemCode). Reasons for the selection and for a disabled counterpart are names of catalog
       texts (text…): an item has only one, they need no place in the order. */
    var REASONS = ['limit', 'offline', 'view', 'viewMode', 'rights', 'rightsRequest', 'protected'];

    var DEPTH = 2;

    /* The stock builds a list gallery lazily: focusing it gets two more attempts this many ms apart. */
    var FOCUS_RETRY_MS = 80;

    function sectionKey(index) {
        return SECTIONS[index] || 'section' + index;
    }

    PE.Views.CompactMenuAdapter = {

        SECTIONS: SECTIONS,
        REASONS: REASONS,

        create: function (shell, api) {
            var SA = actions();
            var stock = kit().create({
                controller: function (name) {
                    try { return PE.getController(name) || null; } catch (e) { return null; }
                },
                api: api
            });

            function kindOf(it) {
                if (Array.isArray(it.sub) || it.sub === true || it.gallery) return 'submenu';
                return it.check ? 'check' : 'action';
            }

            /* An empty row in place of the stock menu rows until the submenu is open: the submenu
               is visible with it, while the stock menu is not read yet. */
            function pending(k) {
                return {k: k + '.pending', t: '', kind: 'action', pending: true};
            }

            /* Snapshots of the submenus open now: item key → {row, rows, opening}. The snapshot is taken by
               openRow; it is valid while the submenu is open (the row is expanded), and for the menu row
               snapshot right after openRow (opening). */
            var held = {};

            function expanded(row) {
                return !!row && row.isConnected !== false && row.getAttribute('aria-expanded') === 'true';
            }

            function heldRows(k) {
                var h = held[k];
                if (!h) return null;
                if (h.opening) { h.opening = false; return h.rows; }
                return expanded(h.row) ? h.rows : null;
            }

            /* A shared model item for a catalog item. */
            function entry(it) {
                if (!it || it.sep) return {sep: true};
                var out = {k: it.k, t: it.t, i: it.i, sc: it.sc, hint: it.hint || null, kind: kindOf(it), src: it};
                if (Array.isArray(it.sub)) out.items = function () { return heldRows(it.k) || children(it, false); };
                else if (it.sub === true || it.gallery) out.items = function () { return heldRows(it.k) || [pending(it.k)]; };
                return out;
            }

            /* The catalog submenu rows now; read — the stock menu rows in place (inline)
               are read (opening), otherwise a placeholder stands in their place. A disabled inline item gives
               no rows: the stock menu of a disabled control cannot be opened. */
            function children(holder, read) {
                var out = [];
                SA.visibleItems(holder.sub).forEach(function (x) {
                    if (!x || x.sep) { out.push({sep: true}); return; }
                    if (!x.inline) { out.push(entry(x)); return; }
                    if (!read) { out.push(pending(x.k)); return; }
                    if (SA.itemCode(x, shell).disabled) return;
                    mirrored(x, SA.mirrorList(x)).forEach(function (r) { out.push(r); });
                });
                return out;
            }

            /* Mirror row icon: the glyph name by the stock item icon class (icons of the root). */
            function mirrorIcon(root, e) {
                var list = root && root.icons;
                if (!Array.isArray(list) || !e || !e.icon) return null;
                for (var n = 0; n < list.length; n++) {
                    if (list[n] && list[n].cls === e.icon) return list[n].i;
                }
                return null;
            }

            /* Mirror rows of the stock menu of the root (an item whose counterpart is a submenu). A checked
               stock item is a toggle ('check'); choosing a row is a stock click of the item. */
            function mirrored(root, list) {
                return (list || []).map(function (e) {
                    if (!e || e.sep) return {sep: true};
                    var k = root.k + '.' + e.id;
                    var row = {root: root, entry: e};
                    var out;
                    if (e.gallery) {
                        row.gallery = true;
                        out = {k: k, t: e.caption, kind: 'submenu', row: row, items: function () { return [pending(k)]; }};
                    } else if (e.sub) {
                        out = {k: k, t: e.caption, kind: 'submenu', row: row, items: mirrored(root, e.sub)};
                    } else {
                        out = {k: k, t: e.caption, kind: e.checked ? 'check' : 'action', row: row};
                    }
                    var glyph = mirrorIcon(root, e);
                    if (glyph) out.i = glyph;
                    return out;
                });
            }

            /* Submenu snapshot on opening: mirror rows (sub: true) or catalog submenu rows
               with the stock menu rows in place. */
            function readRows(it) {
                if (it.src && Array.isArray(it.src.sub)) return children(it.src, true);
                if (it.src && it.src.sub === true) return mirrored(it.src, SA.mirrorList(it.src));
                return null;
            }

            function blank(label) {
                return {visible: true, disabled: true, reason: null, checked: false, label: label || '', hint: null, desc: null};
            }

            /* Mirror row: if the root is disabled, so is the row, with its reason; otherwise — as
               the stock read it when the submenu opened. */
            function rowState(it) {
                var kind = model().kindOf(it), e = it.row.entry;
                var root = SA.itemCode(it.row.root, shell);
                var st = {visible: true, disabled: !!e.disabled, reason: null, checked: kind === 'check' && !!e.checked,
                          label: e.caption || '', hint: null, desc: null};
                if (root.disabled) {
                    st.disabled = true;
                    st.reason = root.reason || null;
                }
                return st;
            }

            function state(it) {
                var kind = model().kindOf(it);
                if (kind === 'sep') return blank('');
                if (kind === 'group') return blank(it.t);
                if (it.pending) return blank('');
                if (it.row) return rowState(it);
                if (!it.src) return blank(it.t);
                var st = SA.itemCode(it.src, shell);
                var off = !!st.disabled;
                return {visible: !st.hidden, disabled: off, reason: off ? (st.reason || null) : null,
                        checked: kind === 'check' && !!st.checked,
                        label: SA.label(it.src), hint: it.hint || null, desc: null};
            }

            /* The item runs by the catalog path (SlideActions.exec), availability is reread
               right here. */
            function exec(it) {
                if (it && it.row) return execRow(it);
                if (!it || !it.src) return false;
                if (!model().actionable(it, state(it))) return false;
                return SA.exec(it.src, shell) !== false;
            }

            /* Mirror row — a stock click of its item (StockBridge.pick). */
            function execRow(it) {
                if (!model().actionable(it, state(it))) return false;
                return bridge().pick(it.row.root.twin, it.row.entry.id) !== false;
            }

            /* The menu row the adapter is plugged into (held by SlideActions.menu). */
            function bar() {
                var m = SA.menu;
                return m && typeof m.ownClosed === 'function' ? m : null;
            }

            function report(how) {
                var b = bar();
                if (b) b.ownClosed(how);
            }

            /* --- Stock gallery at the row ------------------------------------------------- */
            var gallery = null, closing = false;

            function galleryRef(it) {
                if (it.src && it.src.gallery) return it.src.twin;
                if (it.row && it.row.gallery) return bridge().itemRef(it.row.root.twin, it.row.entry.id);
                return null;
            }

            function openGallery(row, it) {
                var B = bridge(), ref = galleryRef(it);
                closeGallery();
                var mine = {row: row, ref: ref};
                var ok = !!ref && B.gallery(ref, row, {align: 'tl-tr', onClose: function (how) {
                    if (gallery !== mine) return;
                    gallery = null;
                    if (closing || how === 'replace' || how === 'close') return;
                    report(how === 'pick' ? 'chosen' : 'dismissed');
                }});
                if (ok) {
                    gallery = mine;
                    return true;
                }
                /* Nowhere to show it: a stock click of the catalog item's counterpart; without one the item
                   is closed again. The menu row marks its own surface after openRow, so the result
                   comes on the next tick. */
                var ran = !!(it.src && it.src.gallery && ref && B.run(ref));
                setTimeout(function () { report(ran ? 'chosen' : 'dismissed'); }, 0);
                return true;
            }

            function closeGallery() {
                if (!gallery) return;
                closing = true;
                try { bridge().closeGallery('close'); } finally { closing = false; gallery = null; }
            }

            function focusGallery() {
                if (!gallery) return false;
                var mine = gallery, tries = 0;
                var go = function () {
                    if (gallery !== mine) return false;
                    /* The stock has already put focus into the gallery (it focuses grids itself) — leave it. */
                    var a = document.activeElement;
                    if (a && a !== document.body && bridge().galleryOwns(a)) return true;
                    var to = typeof bridge().galleryEntry === 'function' ? bridge().galleryEntry() : null;
                    if (to) { to.focus(); return true; }
                    if (++tries < 3) setTimeout(go, FOCUS_RETRY_MS);
                    return false;
                };
                return go();
            }

            /* The submenu's own surface is the gallery at the row; for a mirror submenu and a catalog submenu —
               a snapshot of the stock menu while open, the list is drawn by the menu row (false). */
            function openRow(row, it) {
                if (!it || model().kindOf(it) !== 'submenu') return false;
                if ((it.src && it.src.gallery) || (it.row && it.row.gallery)) return openGallery(row, it);
                var rows = readRows(it);
                if (rows) held[it.k] = {row: row, rows: rows, opening: true};
                return false;
            }

            return {
                sections: function () {
                    return SA.groups().map(function (g, i) { return {k: sectionKey(i), t: g.label}; });
                },
                /* The catalog is built once per pass of the menu row: all sections of one snapshot
                   (build, refresh, opening) take it from the pass object snap. In the same
                   pass the stock context menus are rebuilt from the selection. */
                groups: function (k, snap) {
                    var at = SECTIONS.indexOf(k);
                    if (at < 0) return [];
                    var pass = snap && typeof snap === 'object' ? snap : {};
                    if (!pass.primed) {
                        pass.primed = true;
                        SA.primeStockMenus();
                    }
                    var all = pass.catalog || (pass.catalog = SA.groups());
                    var g = all[at];
                    if (!g) return [];
                    return g.items.map(entry);
                },
                context: function () { return {}; },
                itemState: state,
                exec: exec,
                shortcut: stock.shortcut,
                openRow: openRow,
                closeRow: function () { closeGallery(); },
                owns: function (el) { return !!gallery && bridge().galleryOwns(el); },
                focusRow: function () { return focusGallery(); },
                reasons: REASONS.slice(),
                reasonText: function (code) {
                    return model().COMMON_REASONS.indexOf(code) >= 0 ? null : SA.reasonText(code);
                },
                depth: DEPTH,
                blocked: stock.blocked,
                keys: stock.keys
            };
        }
    };

    return PE.Views.CompactMenuAdapter;
});
