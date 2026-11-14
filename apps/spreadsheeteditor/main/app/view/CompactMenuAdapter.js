/*
 * CompactMenuAdapter — the spreadsheets behind the shared menu bar of the "Compact" shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The shared menu bar (Common.UI.Compact.MenuBar) knows neither the catalog nor stock: the sections and
 * items are given to it by this adapter from the SheetActions catalog, and the item state comes from the same
 * SheetActions (itemCode), which decides which items are disabled and when. There are no
 * availability rules of its own here.
 *
 * Sections — the catalog sections in its order, keys — SECTIONS. A catalog item is an item of the shared
 * model (Common.UI.Compact.MenuModel) with the same key k, the source catalog item is in src:
 *  - twin, run, pick — an action ('action'); check: true — a toggle ('check'),
 *    check: 'radio' — a variant of a group ('radio');
 *  - a composite item (items) — a submenu ('submenu'), its children are the catalog items right now
 *    (SheetActions.children); a group heading {head} — a group ('group'), {sep} — a separator;
 *  - stock menu rows in place ({mirror}) — before the submenu opens, one empty stub row
 *    (pending): the stock menu is read only on opening, as before.
 *
 * A mirror submenu (sub) — the items(ctx) items from the stock menu of the twin (SheetActions.mirrorRows,
 * StockBridge.mirror), the row key is <k>.<the item path in the stock menu>, unique across the whole menu.
 * The stock menu is read once per submenu opening: on opening (openRow) a snapshot is taken and
 * held while the submenu is open — the menu row's refresh() does not re-read it. Before opening, a stub
 * stands in place of the rows (pending): the submenu is visible, the stock menu is not prepared. A mirror row:
 *  - caption, mark and availability from stock (the root is disabled — the row is disabled with its reason);
 *    for border items the mark is also by the sides of the active cell in the engine, in the same snapshot
 *    (SheetActions.borderMarker);
 *    a sample value or explanation — on the right (hint), a description — as a second line (desc);
 *  - the stock's own submenu — a second-level submenu from the same snapshot;
 *  - a gallery (gallery) — a ▸ item whose openRow shows the stock gallery at the row (StockBridge.popup):
 *    this is a surface of the submenu's own — owns answers for its nodes, focusRow puts focus into it, closeRow
 *    closes it; a choice in the gallery closes the menu (ownClosed('chosen')), if stock removed it itself — the menu
 *    stays alive, focus on the item (ownClosed('dismissed')). If it cannot be shown — the stock command dialog
 *    (StockBridge.dialog), which replaces the menu. The same for a catalog gallery item (gallery);
 *  - a stepper (stepper) — its own row ('widget'): a caption, the stock value and step buttons; a step is
 *    exec(it, {dir: 'up' | 'down'}) by the stock stepper button (StockBridge.step), the menu stays
 *    open, as in stock.
 *
 * Reasons for disabling — SheetActions.REASONS codes. view and protected are the menu bar's common reasons
 * (their text is on its side, in the spreadsheets locale the same words as the catalog's; the adapter's reasonText does not name them),
 * rights, rightsRequest, cellEdit and denied are our own: the text is given by reasonText
 * (SheetActions.reasonText). The order of reasons is REASONS; a catalog item carries one reason, the order
 * is needed by the menu bar for the contract.
 *
 * A submenu comes in two levels (depth: 2): a composite item and a mirror row with a submenu inside.
 *
 * The shortcut from the stock registry, the engine keyboard and "the editor is covered" — a common helper
 * of the adapters (Common.UI.Compact.AdapterKit) over the spreadsheet controllers. The editor is covered also
 * when a cell is being edited: F10 stays with the cell field and does not enter the menu bar. The engine
 * keyboard is held by the shell (CompactShell.keysForMenu), if it can do that: one hold for the menu
 * bar, the panel and the header — a Tab move from the menu bar to the panel does not give the keyboard to the sheet.
 */
define([
    'common/main/lib/view/compact/MenuModel',
    'common/main/lib/view/compact/AdapterKit',
    'spreadsheeteditor/main/app/view/StockBridge',
    'spreadsheeteditor/main/app/view/SheetActions',
    'common/main/lib/view/compact/Icons'
], function (Model, Kit, Bridge, Actions, Icons) {
    'use strict';

    if (window.SSE === undefined) window.SSE = {};
    if (SSE.Views === undefined) SSE.Views = {};

    function model() {
        if (Model && typeof Model.state === 'function') return Model;
        return window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.MenuModel;
    }

    function kit() {
        if (Kit && typeof Kit.create === 'function') return Kit;
        return window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.AdapterKit;
    }

    function actions() {
        return Actions && typeof Actions.itemCode === 'function' ? Actions : SSE.Views.SheetActions;
    }

    function bridge() {
        return Bridge && typeof Bridge.mirror === 'function' ? Bridge : SSE.Views.StockBridge;
    }

    function icons() {
        return Icons && typeof Icons.svg === 'function' ? Icons : window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.Icons;
    }

    /* Menu bar section keys in catalog order (SheetActions.sections). */
    var SECTIONS = ['file', 'edit', 'view', 'insert', 'format', 'data', 'collab', 'help'];

    /* The order of disabling reasons from highest to lowest priority: the MenuModel common codes and the spreadsheet codes. */
    var REASONS = ['limit', 'offline', 'view', 'rights', 'rightsRequest', 'protected', 'cellEdit', 'denied'];

    var DEPTH = 2;

    /* The stock gallery at the row: the top is this much above the row, as for the shell's submenu. */
    var POP_PAD_Y = 10;

    /* Stock builds the list gallery lazily: focus into it — two more attempts after this many ms. */
    var FOCUS_RETRY_MS = 80;

    function sectionKey(index) {
        return SECTIONS[index] || 'section' + index;
    }

    SSE.Views.CompactMenuAdapter = {

        SECTIONS: SECTIONS,
        REASONS: REASONS,

        create: function (shell, api) {
            var SA = actions();
            var stock = kit().create({
                controller: function (name) {
                    try { return SSE.getController(name) || null; } catch (e) { return null; }
                },
                api: api
            });

            function kindOf(it) {
                if (it.items || it.sub || it.gallery) return 'submenu';
                if (it.check === 'radio') return 'radio';
                return it.check ? 'check' : 'action';
            }

            /* An empty row in place of the stock menu rows while the submenu is not open: a submenu with it
               is visible, and the stock menu has not yet been read. */
            function pending(k) {
                return {k: k + '.pending', t: '', kind: 'action', pending: true};
            }

            /* Snapshots of the submenus open right now: item key → {row, rows, opening}. The snapshot is taken by openRow;
               it is valid while the submenu is open (the row is expanded), and for the snapshot of the menu row right after
               openRow (opening). */
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

            /* A shared model item from a catalog item; owner is the holder key for group keys. */
            function entry(it, owner, index) {
                if (!it || it.sep) return {sep: true};
                if (it.head != null) return {k: owner + '.group' + index, t: String(it.head), kind: 'group'};
                var out = {k: it.k, t: SA.label(it), i: it.i, sc: it.sc, kind: kindOf(it), src: it};
                if (Array.isArray(it.items)) out.items = function () { return heldRows(it.k) || children(it, false); };
                else if (it.sub || it.gallery) out.items = function () { return heldRows(it.k) || [pending(it.k)]; };
                return out;
            }

            /* The children of a composite item right now; read — the stock menu rows in place are read (opening),
               otherwise a stub stands in their place. */
            function children(holder, read) {
                var out = [];
                SA.children(holder).forEach(function (kid, i) {
                    if (kid && kid.mirror) {
                        var root = SA.mirrorRoot(holder, kid);
                        if (!read) { out.push(pending(root.k)); return; }
                        mirrored(root, bridge().mirror(kid.mirror)).forEach(function (x) { out.push(x); });
                        return;
                    }
                    out.push(entry(kid, holder.k, i));
                });
                return out;
            }

            /* The engine's selection data right now (for the marks of the border mirror rows). */
            function cellInfo() {
                return api && typeof api.asc_getCellInfo === 'function' ? api.asc_getCellInfo() : null;
            }

            /* Rows of the stock menu mirror of the root (an item with a twin submenu). The glyph i — by the class of the stock icon
               of the item, the same table as for the panel list (SheetActions.stockGlyph); the space for a glyph in rows without one
               is held by the menu row. The mark of a border item — by the sides of the active cell in the engine, the same data and the same
               rule as for the panel list (SheetActions.borderMarker, marked — one per snapshot): a marked row is
               a toggle ('check', marked on the row), like a marked stock item; its choice is the same stock click. */
            function mirrored(root, list, marked) {
                marked = marked || SA.borderMarker(cellInfo);
                return (list || []).map(function (e) {
                    if (!e || e.sep) return {sep: true};
                    var k = root.k + '.' + e.id;
                    var row = {root: root, entry: e};
                    if (e.stepper) return {k: k, t: e.caption, kind: 'widget', row: row};
                    var out;
                    if (e.gallery) {
                        row.gallery = true;
                        out = {k: k, t: e.caption, kind: 'submenu', row: row, items: function () { return [pending(k)]; }};
                    } else if (e.sub) {
                        out = {k: k, t: e.caption, kind: 'submenu', row: row, items: mirrored(root, e.sub, marked)};
                    } else {
                        if (!e.checked && marked(e.icon)) row.marked = true;
                        out = {k: k, t: e.caption, kind: e.checked || row.marked ? 'check' : 'action', row: row,
                               hint: e.example || e.hint || null, desc: e.desc || null};
                    }
                    var glyph = SA.stockGlyph(e.icon);
                    if (glyph) out.i = glyph;
                    return out;
                });
            }

            /* The submenu snapshot on opening: the mirror rows (sub) or the children of a composite item with the
               stock menu rows in place. */
            function readRows(it) {
                if (it.src && Array.isArray(it.src.items)) return children(it.src, true);
                if (it.src && it.src.sub) return mirrored(it.src, SA.mirrorRows(it.src));
                return null;
            }

            function list() {
                return SA.groups();
            }

            function blank(label) {
                return {visible: true, disabled: true, reason: null, checked: false, label: label || '', hint: null, desc: null};
            }

            /* A mirror row: the root is disabled — it is disabled too, with its reason; otherwise — as stock
               read it on submenu opening (the mark — also by the borders of the cell of the same snapshot). A stepper — the value and
               availability from stock right now. */
            function rowState(it) {
                var kind = model().kindOf(it), e = it.row.entry;
                var root = SA.itemCode(it.row.root, shell);
                var st = {visible: true, disabled: !!e.disabled, reason: null, checked: kind === 'check' && !!(e.checked || it.row.marked),
                          label: e.caption || '', hint: it.hint || null, desc: it.desc || null};
                if (e.stepper) {
                    var now = bridge().stepper(it.row.root.twin, e.id);
                    st.disabled = !now || !!now.disabled;
                }
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
                return {visible: true, disabled: off, reason: off ? (st.reason || null) : null,
                        checked: (kind === 'check' || kind === 'radio') && st.checked,
                        label: SA.label(it.src), hint: null, desc: null};
            }

            /* The item is executed via the catalog path (SheetActions.exec), availability is re-read right
               here. The left area panel slides out with one recalculation of the shell grid (batch). */
            function exec(it, args) {
                if (it && it.row) return execRow(it, args);
                if (!it || !it.src) return false;
                if (!model().actionable(it, state(it))) return false;
                var src = it.src;
                var run = function () { return SA.exec(src, shell) !== false; };
                if (src.left && shell && typeof shell.batch === 'function') {
                    var done = false;
                    shell.batch(function () { done = run(); });
                    return done;
                }
                return run();
            }

            /* A mirror row — the stock click on its item (StockBridge.pick); a stepper — a step by the stock button. */
            function execRow(it, args) {
                var st = state(it), e = it.row.entry, twin = it.row.root.twin;
                if (e.stepper) {
                    var dir = args && args.dir;
                    if (st.disabled || (dir !== 'up' && dir !== 'down')) return false;
                    return bridge().step(twin, e.id, dir);
                }
                if (!model().actionable(it, st)) return false;
                return bridge().pick(twin, e.id);
            }

            /* The menu bar the adapter is embedded in (the shell holds it in menu). */
            function bar() {
                var m = shell && shell.menu;
                return m && typeof m.ownClosed === 'function' ? m : null;
            }

            function report(how) {
                var b = bar();
                if (b) b.ownClosed(how);
            }

            /* --- The stock gallery at the row ------------------------------------------------- */
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
                var ok = !!ref && B.popup(ref, row, {align: 'tl-tr', padY: POP_PAD_Y, onClose: function (how) {
                    if (gallery !== mine) return;
                    gallery = null;
                    if (closing || how === 'replace') return;
                    report(how === 'pick' ? 'chosen' : 'dismissed');
                }});
                if (ok) {
                    gallery = mine;
                    return true;
                }
                /* There is nowhere to show it: the stock command dialog replaces the menu; if there is none either — the item is closed again.
                   The menu bar marks its surface after openRow, so the result comes on the next tick. */
                var dialog = !!ref && B.dialog(ref);
                setTimeout(function () { report(dialog ? 'chosen' : 'dismissed'); }, 0);
                return true;
            }

            function closeGallery() {
                if (!gallery) return;
                closing = true;
                try { bridge().closePopup('close'); } finally { closing = false; gallery = null; }
            }

            function focusGallery() {
                if (!gallery) return false;
                var mine = gallery, tries = 0;
                var go = function () {
                    if (gallery !== mine) return false;
                    /* Stock has already put focus into the gallery (it focuses grids and palettes itself) — we do not touch it. */
                    var a = document.activeElement;
                    if (a && a !== document.body && bridge().popupOwns(a)) return true;
                    var to = typeof bridge().popupEntry === 'function' ? bridge().popupEntry() : null;
                    /* The shell holds focus against stock's deferred focus (menu:hide, dataview:blur). */
                    if (to && shell && typeof shell.focusHeld === 'function') { shell.focusHeld(to); return true; }
                    if (to) { to.focus(); return true; }
                    if (++tries < 3) setTimeout(go, FOCUS_RETRY_MS);
                    return false;
                };
                return go();
            }

            /* --- Stepper ------------------------------------------------------------------- */
            function drawStepper(row, it) {
                var e = it.row.entry, twin = it.row.root.twin;
                var S = shell || {};
                row.classList.add('vo-mn-step');
                var t = document.createElement('span');
                t.className = 'vo-mn-t';
                t.textContent = e.caption || '';
                var value = document.createElement('span');
                value.className = 'vo-mn-step-v';
                value.textContent = e.value == null ? '' : String(e.value);
                var button = function (dir, glyph, label) {
                    var b = document.createElement('button');
                    b.setAttribute('type', 'button');
                    b.className = 'vo-mn-step-btn';
                    b.setAttribute('aria-label', label || '');
                    b.setAttribute('tabindex', '-1');
                    var set = icons();
                    b.innerHTML = set && typeof set.svg === 'function' ? set.svg(glyph, 16) : '';
                    b.addEventListener('click', function (ev) {
                        ev && ev.stopPropagation && ev.stopPropagation();
                        if (!exec(it, {dir: dir})) return;
                        var now = bridge().stepper(twin, e.id);
                        if (now) value.textContent = now.value;
                        var b2 = bar();
                        if (b2 && typeof b2.refresh === 'function') b2.refresh();
                    });
                    return b;
                };
                row.appendChild(t);
                row.appendChild(button('down', 'minus', S.textStepDown_ARIA));
                row.appendChild(value);
                row.appendChild(button('up', 'plus', S.textStepUp_ARIA));
            }

            /* Its own row and its own submenu surface: the stepper is drawn in the row; the gallery is shown
               at the row; for a mirror submenu and a composite item — a snapshot of the stock menu for the duration of opening,
               the list is drawn by the menu row (false). */
            function openRow(row, it) {
                if (!it) return false;
                var kind = model().kindOf(it);
                if (kind === 'widget') {
                    if (!it.row || !it.row.entry.stepper) return false;
                    drawStepper(row, it);
                    return true;
                }
                if (kind !== 'submenu') return false;
                if ((it.src && it.src.gallery) || (it.row && it.row.gallery)) return openGallery(row, it);
                var rows = readRows(it);
                if (rows) held[it.k] = {row: row, rows: rows, opening: true};
                return false;
            }

            /* Engine keyboard: the shell's hold, if there is one, otherwise the common helper. */
            var keys = shell && typeof shell.keysForMenu === 'function' ? shell.keysForMenu() : stock.keys;

            function cellEdited() {
                return typeof SA.cellEdited === 'function' && SA.cellEdited();
            }

            return {
                sections: function () {
                    return SA.sections().map(function (t, i) { return {k: sectionKey(i), t: t}; });
                },
                /* The catalog is assembled once per menu bar pass: all sections of one snapshot (build,
                   refresh) take it from the pass object snap. */
                groups: function (k, snap) {
                    var at = -1;
                    SA.sections().forEach(function (t, i) { if (sectionKey(i) === k) at = i; });
                    if (at < 0) return [];
                    var all = snap && typeof snap === 'object' ? (snap.catalog || (snap.catalog = list())) : list();
                    var g = all[at];
                    if (!g) return [];
                    return g.items.map(function (it, i) { return entry(it, k, i); });
                },
                context: function () { return {}; },
                itemState: state,
                exec: exec,
                shortcut: stock.shortcut,
                openRow: openRow,
                closeRow: function () { closeGallery(); },
                owns: function (el) { return !!gallery && bridge().popupOwns(el); },
                focusRow: function () { return focusGallery(); },
                reasons: REASONS.slice(),
                reasonText: function (code) {
                    return model().COMMON_REASONS.indexOf(code) >= 0 ? null : SA.reasonText(code);
                },
                depth: DEPTH,
                blocked: function () { return cellEdited() || stock.blocked(); },
                keys: keys
            };
        }
    };

    return SSE.Views.CompactMenuAdapter;
});
