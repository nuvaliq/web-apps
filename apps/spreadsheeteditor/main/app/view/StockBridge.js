/*
 * StockBridge — the bridge of the "Compact" spreadsheet shell to the stock ribbon.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The only shell module that knows how the ribbon is built
 * ("The boundary with stock — twins"). Our controls are
 * twins of the stock ones: a command goes by the stock path of the ribbon object, availability
 * and pressed state are read from it too, a submenu is a mirror of the stock menu, taken at the
 * moment of opening. Ribbon nodes are not moved or re-parented:
 * the ribbon stays in the DOM under the shell, hidden by a style.
 *
 * A twin address is '<root>:<path>': the root is a row of the ROOTS table, the path is
 * dot-separated properties, a number is an index ('ToolbarCtl:btnsComment.0',
 * 'Toolbar:btnInsertSymbol.menu.items.2'). The names are stock internals, not
 * an API: a missing twin gives null, not an exception, the bridge marks
 * it in gaps, and the catalog shows the item as inactive.
 *
 * Galleries: the stock menu gallery of the twin
 * is shown by a stock popup at our control (popup) — the ribbon nodes stay in
 * their places, and for the duration of the display the path from the menu to the rendered ancestor is expanded with classes
 * (compact-shell.less, "Galleries"); where it cannot be shown — the stock command dialog
 * (dialog). The choice is made by the gallery's own stock path.
 */
define([], function () {
    'use strict';

    if (window.SSE === undefined) window.SSE = {};
    if (SSE.Views === undefined) SSE.Views = {};

    function ctl(name) {
        try { return SSE.getController(name) || null; } catch (e) { return null; }
    }

    /* The shell guard (CompactShell.guarded) for listeners that the bridge sets itself on stock
       nodes: a failure is one shell warning, after a failed start — silence (everything is under
       guarded). The bridge loads before the shell — the guard is taken when the
       listener is set, like FormulaBar.guard; without a shell (bridge tests) — the function as is. */
    function guard(label, fn) {
        var shell = SSE.Views.CompactShell;
        return shell && typeof shell.guarded === 'function' ? shell.guarded(label, fn) : fn;
    }

    /* The bridge table. The ribbon tabs are the views of their controllers; "Formulas" is the view
       FormulaTab of the FormulaDialog controller; "Collaboration" is the shared view
       Common.Views.ReviewChanges; ToolbarCtl is the ribbon controller itself: it creates the
       "Comment" buttons itself (controller/Toolbar.js, btnsComment). */
    var ROOTS = {
        Toolbar:      function () { var c = ctl('Toolbar'); return c && c.toolbar; },
        ToolbarCtl:   function () { return ctl('Toolbar'); },
        DataTab:      function () { var c = ctl('DataTab'); return c && c.view; },
        Formula:      function () { var c = ctl('FormulaDialog'); return c && c.formulaTab; },
        ViewTab:      function () { var c = ctl('ViewTab'); return c && c.view; },
        WBProtection: function () { var c = ctl('WBProtection'); return c && c.view; },
        PivotTable:   function () { var c = ctl('PivotTable'); return c && c.view; },
        Review:       function () { var c = ctl('Common.Controllers.ReviewChanges'); return c && c.view; },
        LeftMenu:     function () { var c = ctl('LeftMenu'); return c && c.leftMenu; },
        CellEditor:   function () { var c = ctl('CellEditor'); return c && c.editor; },
        /* Views of the grid context menu (the column header menu): the stock cell menus
           ssMenu and the view-mode menu viewModeMenu (view/DocumentHolderExt.js). */
        DocHolder:    function () { var c = ctl('DocumentHolder'); return c && c.documentHolder; },
        /* The bottom bar (the sheet row, view/Statusbar.js): the sheet "+" (btnAddWorksheet), zoom
           (btnZoomUp/btnZoomDown), the tab menu (tabMenu). Availability is driven by stock — cell editing,
           workbook locking and protection (controller/Statusbar.js onApiEditCell). */
        Statusbar:    function () { var c = ctl('Statusbar'); return c && c.statusbar; }
    };

    /* Grid context menus that have a mirror (contextMenu): the menu of cells, rows and
       columns — editing, and the view menu — without edit rights. */
    var CONTEXT_MENUS = ['ssMenu', 'viewModeMenu'];

    /* A stock item's icon is its btn-* class (iconCls): by it the shell sets its own glyph
       for the same items as stock. */
    function iconOf(item) {
        var cls = item.iconCls !== undefined ? item.iconCls : (item.options && item.options.iconCls);
        var m = /(?:^|\s)(btn-[\w-]+)/.exec(cls == null ? '' : String(cls));
        return m ? m[1] : '';
    }

    /* Mirror nesting: the twin's menu items and their submenus (for example,
       "conditional formatting, sorting"). We do not draw a third level. */
    var MAX_DEPTH = 2;

    /* Menus that stock prepares not on opening but AFTER showing: the visibility,
       availability and mark of their items are recalculated by the 'show:after' handler
       from the engine (controller/Toolbar.js: onPrintAreaMenuOpen,
       onPageBreakMenuOpen, onColorSchemaShow, onNamedRangeMenuOpen;
       view/Toolbar.js onAfterShowMenuScale; view/FormulaTab.js
       'function:namedrange-open'). Without this step the mirror would show
       the state of the previous opening. The list is closed: only menus whose
       'show:after' does nothing with focus and layout — for "Sheet views",
       for example, it moves focus into the inner menu of the hidden ribbon. */
    var AFTER = {
        'Toolbar:btnPrintArea': 1,
        'Toolbar:btnPageBreak': 1,
        'Toolbar:btnScale': 1,
        'Toolbar:btnColorSchemas': 1,
        'Toolbar:btnNamedRange': 1,
        'Formula:btnNamedRange': 1
    };

    function noop() {}

    function isSep(item) {
        return !!item && (item.caption === '--' || (item.options && item.options.caption === '--'));
    }

    function caption(item) {
        var c = item.caption !== undefined ? item.caption : (item.options && item.options.caption);
        return c == null ? '' : String(c);
    }

    /* A menu item is hidden by the view's show()/hide() (the hidden flag), a button — by the
       visible flag (Button.setVisible) or the same hide(). Visibility in the DOM does not
       work here: in Compact the ribbon is hidden entirely, and a closed menu is display:none.
       An item created with visible:false and not yet rendered will be hidden by stock
       on rendering (MenuItem.render). */
    function isMenuItem(o) {
        return typeof o.onItemClick === 'function' && typeof o.click !== 'function';
    }

    function shown(o) {
        if (!o || o.hidden === true) return false;
        if (o.visible === false) return isMenuItem(o) && o.rendered === true && o.hidden === false;
        return true;
    }

    function disabled(o) {
        return typeof o.isDisabled === 'function' ? !!o.isDisabled() : !!o.disabled;
    }

    /* The stock ribbon checkbox (Common.UI.CheckBox: "Gridlines", "Headings", "Zeros" of the "View" tab,
       view/ViewTab.js): it has neither a button click nor an item onItemClick — the pressed state is in isChecked(),
       and a click on its field goes to onItemCheck (common/main/lib/component/CheckBox.js). */
    function isCheckBox(o) {
        return !!o && typeof o.onItemCheck === 'function' && typeof o.isChecked === 'function' && typeof o.setValue === 'function';
    }

    function pressed(o) {
        if (isMenuItem(o)) return !!o.checkable && !!(typeof o.isChecked === 'function' ? o.isChecked() : o.checked);
        if (isCheckBox(o)) return !!o.isChecked();
        return o.pressed === true;
    }

    /* The value of a stock menu item (Asc.c_oAscCleanOptions.Format, 'manage'…). */
    function valueOf(item) {
        return item.value !== undefined ? item.value : (item.options && item.options.value);
    }

    /* Choosing an item by value — {value: v} or {value: function () { return v; }}: the Asc constants
       are read at call time, not at module load. */
    function byValue(ids) {
        return !!ids && typeof ids === 'object' && !Array.isArray(ids) && 'value' in ids;
    }

    function wanted(sel) {
        try { return typeof sel.value === 'function' ? sel.value() : sel.value; } catch (e) { return undefined; }
    }

    /* Mirror exceptions (the panel button's list and the same-named menu bar submenu show
       the same thing — both are bridge mirrors, as is the menu of
       the column header). A twin address → a predicate on the stock item (item.options, item):
       true — no row. It acts at any mirror depth (a submenu, the stock inner menu);
       the ids of the other rows stay the same — the index path of the stock menu; a separator after a removed row
       is collapsed by the read cleanup; it is not written to gaps — the row was removed on purpose, it is not an omission.
       The predicate takes the Asc constants at call time. The table — "Rows, columns and sheet ▸",
       conditional formatting and borders; the right panel and Stock are not changed — they are not
       a mirror. A predicate failure leaves the row. */
    var OMIT = {
        /* "Rows, columns and sheet ▸" — the items of the ribbon "Format" button menu, except the last one: "Format
           cells" (value 'formatCells') — a separate "Format" item (SheetActions: pick by value, locate finds it). The dangling
           separator before it is removed by the read cleanup. A Compact mirror only: the Stock ribbon menu is not changed. */
        'Toolbar:btnFormatCell': function (o, item) { return valueOf(item) === 'formatCells'; },
        /* Conditional formatting: without "Formula" (a rule of the expression type) and the six "Average ▸" items with standard
           deviation (aboveAverage, values 4…9: "1/2/3 standard deviations above/below"); "Average ▸" keeps Above · Below ·
           Equal or above · Equal or below (0…3). A formula rule and deviation rules are created in the "New rule" window.
           The dangling separator after "Formula" is removed by the read cleanup. A Compact mirror only (the panel button list and "Format → Conditional
           formatting ▸"): the Stock ribbon menu and the right cell panel are not changed. */
        'Toolbar:btnCondFormat': function (o) {
            var T = Asc.c_oAscCFType;
            return o.type === T.expression || (o.type === T.aboveAverage && typeof o.value === 'number' && o.value >= 4);
        },
        /* Borders: without "Diagonal border top to bottom" and "… bottom to top" (borderId DiagD, DiagU). The diagonals stay in
           "More borders" — the right cell panel. A Compact mirror only (the panel button list and "Format → Borders ▸"): the
           Stock ribbon menu is not changed. */
        'Toolbar:btnBorders': function (o) {
            var B = Asc.c_oAscBorderOptions;
            return o.borderId === B.DiagD || o.borderId === B.DiagU;
        }
    };

    function omitted(ref, item) {
        var fn = Object.prototype.hasOwnProperty.call(OMIT, ref) ? OMIT[ref] : null;
        if (typeof fn !== 'function') return false;
        try { return !!fn(item.options || {}, item); } catch (e) { return false; }
    }

    function isCombo(o) {
        return !!o && !!o.store && typeof o.itemClicked === 'function';
    }

    /* The twin's menu: a button and an item have a menu property, the Menu itself is in items. */
    function menuOf(o) {
        if (!o) return null;
        if (o.menu && typeof o.menu === 'object' && Array.isArray(o.menu.items)) return o.menu;
        if (Array.isArray(o.items) && typeof o.trigger === 'function') return o;
        return null;
    }

    function nodeOf(o) {
        if (!o) return null;
        return (o.cmpEl && o.cmpEl[0]) || (o.$el && o.$el[0]) || (o.el && o.el.nodeType ? o.el : null);
    }

    /* An explanation that stock draws with its template under the item caption. Three kinds, and
       all are the stock text in the form in which stock shows it now:
       subtitle — a value (sizes for "Page size"): taken from the rendered
       item, where it is in the current units (Common.Utils.Metric), and before rendering —
       the subtitle itself; description — a description (the co-editing modes,
       lib/view/ReviewChanges.js); exampleval — a sample value of the selection in this format
       ("Number format" of the context menu: it is prepared by the stock show handler,
       see contextMenu). The "Margins" values in stock are only in the template, without a subtitle, — the
       shell does not show them either. */
    function notes(item) {
        var o = item.options || {}, out = {};
        if (o.description != null && String(o.description).trim()) out.desc = String(o.description).trim();
        if (o.subtitle != null) {
            var el = nodeOf(item), a = el && el.querySelector ? el.querySelector('a') : null;
            var rest = a && a.children ? Array.prototype.slice.call(a.children, 1) : [];
            var text = rest.map(function (n) { return String(n.textContent || '').replace(/\s+/g, ' ').trim(); })
                .filter(Boolean).join(' ');
            out.hint = text || String(o.subtitle);
        } else if (o.exampleval != null && String(o.exampleval).trim()) {
            out.hint = String(o.exampleval).trim();
        }
        return out;
    }

    /* The show event as the stock handlers see it: Menu.onBeforeShowMenu
       gets a dropdown event on the menu's parent, and some handlers work
       only for showing the menu itself, not one that bubbled up from a submenu
       (`e.target === e.currentTarget`, controller/Toolbar.js
       onShowBeforeCellFormat). */
    function showEvent(m) {
        var node = (m.parentEl && m.parentEl[0]) || nodeOf(m) || {};
        return {type: 'show', target: node, currentTarget: node,
                preventDefault: noop, stopPropagation: noop,
                isDefaultPrevented: function () { return false; }};
    }

    /* A left-button click on an item — what MenuItem.onItemClick gets from
       jQuery (which = 1). */
    function clickEvent(o) {
        var node = nodeOf(o) || {};
        return {type: 'click', which: 1, button: 0, target: node, currentTarget: node,
                preventDefault: noop, stopPropagation: noop};
    }

    /* --- Galleries inside the mirror ----------------------------------------- */

    /* A stock inner menu: an item without a caption in which stock has drawn its own menu
       (Menu.setInnerMenu — {menu, index}; for "Sheet views" these are "Default" and
       the workbook views, view/ViewTab.js setButtonMenu). Only a menu with
       items qualifies — "Symbol" has a DataView inside, which is a gallery. */
    function innerOf(m, index) {
        var list = m && m.options && m.options.innerMenus;
        if (!Array.isArray(list)) return null;
        for (var i = 0; i < list.length; i++) {
            var x = list[i];
            if (x && x.index === index && x.menu && Array.isArray(x.menu.items)) return x.menu;
        }
        return null;
    }

    function text(n) {
        return n ? String(n.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }

    function offBtn(b) {
        return !!b && (b.disabled === true || /(?:^|\s)disabled(?:\s|$)/.test(String(b.className || '')));
    }

    /* A stock UpDownPicker stepper in an item without a caption (print scale: view/Toolbar.js
       mnuCustomScale): the caption, value and buttons are in the item markup; the handlers
       hang on the buttons (Common.UI.Button), a click on the button node is their stock entry. */
    function stepperOf(item) {
        var el = nodeOf(item);
        if (!el || typeof el.querySelector !== 'function') return null;
        var up = el.querySelector('.updown-picker-button-up'), down = el.querySelector('.updown-picker-button-down');
        if (!up || !down) return null;
        return {up: up, down: down, caption: text(el.querySelector('.title')), value: text(el.querySelector('.updown-picker-value')),
                disabled: offBtn(up) && offBtn(down)};
    }

    /* A submenu is a gallery if it has a shown item without a caption (a palette,
       DataView, line style pictures), except for the inner menu holder. */
    function holdsGallery(m) {
        return !!m && Array.isArray(m.items) && m.items.some(function (it, i) {
            return !!it && !isSep(it) && shown(it) && !caption(it) && !innerOf(m, i);
        });
    }

    /* --- Showing a stock gallery ------------------------------------------- */

    var PATH_CLS = 'vo-gallery-path', ROOT_CLS = 'vo-gallery-root', TARGET_CLS = 'vo-gallery-target',
        BODY_CLS = 'vo-gallery', ANCHOR_CLS = 'vo-gallery-anchor';

    /* The twin's gallery menu: for a button and an item — their menu, for a combo with a gallery
       (ComboDataView: cell styles) — the menu of its dropdown button. */
    function galleryOf(o) {
        if (!o) return null;
        if (o.openButton && o.openButton.menu && typeof o.openButton.menu === 'object') return o.openButton.menu;
        return menuOf(o);
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

    /* Gallery height ceilings: the stock menu parts that stock squeezes to fit the window —
       the .inner of the gallery's DataView (DataView.alignPosition on show:after; a DataView with
       restoreHeight > 0 and parentMenu is a menu; it puts the menu itself into restoreHeight:
       true, and Menu.alignPosition neither presses nor squeezes such a menu). A menu with a numeric
       ceiling on the list itself does not exist among the galleries. The DataView is looked up where stock
       keeps it: inner menus (setInnerMenu — chart, shape) and the twin's own fields
       (the styles combo: menuPicker) and the twin's owner (the ribbon: table templates). The result is
       [{el, cap, owner}], owner is who has the scrollbar (scroller). */
    function ceilings(m, owners) {
        var out = [], seen = [];
        var add = function (v) {
            if (!v || typeof v !== 'object' || v.parentMenu !== m || seen.indexOf(v) >= 0) return;
            seen.push(v);
            /* The node is the same as in DataView.alignPosition itself: $(this.el).find('.inner').addBack()
               (the cmpEl of a re-rendered DataView may be outside the document — the styles combo). */
            var h = v.options && v.options.restoreHeight;
            var el = (v.el && v.el.nodeType === 1 ? v.el : null) || (v.$el && v.$el[0]) || nodeOf(v);
            if (typeof h !== 'number' || !(h > 0) || !el) return;
            var inner = hasCls(el, 'inner') ? el : (typeof el.querySelector === 'function' ? el.querySelector('.inner') : null);
            inner && out.push({el: inner, cap: h, owner: v});
        };
        var list = m.options && m.options.innerMenus;
        Array.isArray(list) && list.forEach(function (x) { x && add(x.menu); });
        (owners || []).forEach(function (o) {
            if (!o || typeof o !== 'object') return;
            Object.keys(o).forEach(function (k) {
                try { add(o[k]); } catch (e) { /* field without a getter */ }
            });
        });
        return out;
    }

    /* Stock gallery command dialogs (a fallback path): the twin of a dialog button
       or a stock menu item by value. For a submenu — by the address root. */
    var DIALOGS = {
        'Toolbar:btnInsertChart':    {run: 'Toolbar:btnInsertChartRecommend'},   // chart wizard
        'Toolbar:btnTableTemplate':  {run: 'Toolbar:btnInsertTable'},            // table with the stock style
        'Toolbar:btnInsertEquation': {run: 'Toolbar:btnInsertEquation'},         // empty equation (split button)
        'Toolbar:btnCondFormat':     {value: 'manage'},                          // rules manager
        'Toolbar:btnBorders':        {value: 'options'}                          // "More borders"
    };

    SSE.Views.StockBridge = {

        ROOTS: ROOTS,
        AFTER: AFTER,
        CONTEXT_MENUS: CONTEXT_MENUS,
        OMIT: OMIT,

        /* What the mirror did not show and why: gallery — a bare item without a caption right
           in the menu (a palette, DataView) that is neither an inner menu nor a stepper, or
           a submenu with nothing left; depth — the third level; missing — there is no
           twin; prepare — the stock menu preparation threw; plugin — a plugin item. Not
           errors, but a list for coverage checking. A gallery submenu is
           a mirror row with the gallery flag (shown by popup), an inner menu is
           its rows, an UpDownPicker stepper is a stepper row: they do not
           go to gaps. */
        gaps: [],

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

        /* State — from the twin itself, on every access: availability
           (isDisabled), pressed state (the button's pressed, the item's mark), visibility
           (stock flags) and the reasons of stock locking — keepState, which
           is driven by Common.Utils.lockControls. */
        state: function (ref) {
            var o = this.twin(ref);
            if (!o) return {exists: false, disabled: true, pressed: false, visible: false, causes: []};
            var state = {
                exists: true,
                disabled: disabled(o),
                pressed: pressed(o),
                visible: shown(o),
                causes: Array.isArray(o.keepState) ? o.keepState.slice() : []
            };
            if (isCheckBox(o) && o.indeterminate) state.mixed = true;
            return state;
        },

        /* A command by the stock path of the object. Without an event — the button's own
           click() (Button.click: toggling and 'click' for stock subscribers),
           for a menu item — its onItemClick (group mark, the item's 'click' and
           the menu's 'item:click'), for a ribbon checkbox — its onItemCheck, the same path as
           a click on the checkbox (clear the indeterminate state or setValue(!checked) → 'change'
           → the stock tab handler). With an event — the twin's event trigger with
           the stock arguments, the object itself goes first, as stock does it
           ('color:select', 'selected', 'changed:after'). A refusal — there is no twin
           or it is disabled: the check here is the second end of the gate, between
           opening the menu and the click stock could have disabled the control. */
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
            if (isCheckBox(o)) {
                /* An unrendered checkbox would only remember the value, without an event — a refusal. */
                if (o.rendered === false) return false;
                o.onItemCheck();
                return true;
            }
            if (isMenuItem(o)) {
                if (o.menu || !shown(o)) return false;
                o.onItemClick(clickEvent(o));
                return true;
            }
            return false;
        },

        /* Watching the twin's node: the stock lockControls disables a button
           with a class and the disabled attribute, the pressed state is reflected by aria-pressed and
           a class. cb receives the fresh state. Returns an unsubscriber. */
        watch: function (ref, cb) {
            var me = this;
            var el = nodeOf(this.twin(ref));
            if (!el || typeof MutationObserver !== 'function' || typeof cb !== 'function') return noop;
            var obs = new MutationObserver(function () { cb(me.state(ref)); });
            obs.observe(el, {attributes: true, attributeFilter: ['class', 'aria-pressed', 'disabled']});
            return function () { obs.disconnect(); };
        },

        /* A mirror of the twin's stock menu at the moment of opening. First the menu
           is asked to prepare — 'show:before', as on a stock opening: stock
           uses it to fill in the format examples (onNumberFormatOpenBefore),
           the availability of items by selection (onShowBeforeCellFormat,
           onShowBeforeFillNumMenu) and even to attach the choice handlers
           (onShowBeforeCondFormat sets up 'item:click' only on the first
           opening). For a menu from AFTER — 'show:after' as well. Then only
           the items shown by stock are read, up to two levels. id is the index path in
           the stock menu: by it pick() will find the same item. The record form is {id,
           caption, disabled, checked, hint?, desc?, icon?, sub?, gallery?, stepper?,
           value?} or {sep: true}: value is the value of the stock item, if it is a number, string
           or flag (it is used to recognize and choose the item — pick by value, OMIT; for a stepper
           value is its displayed value); items from the twin's OMIT do not go into the mirror;
           hint and desc are the stock explanation of the item (notes),
           icon is the btn-* class of the stock icon; for a combo list also example — a sample
           value. Galleries: an item whose submenu is a gallery is a row with
           gallery: true without sub (shown by popup via itemRef); the holder of the stock
           inner menu — the rows of this menu with id '<item>/<row>'; an UpDownPicker
           stepper — a stepper row with a caption and the stock value (a step — step).
           A bare item without a caption, a third level — an omission recorded in gaps. */
        mirror: function (ref, opts) {
            var o = this.twin(ref);
            if (!o) { this.gap(ref, 'missing', ref); return []; }
            if (isCombo(o)) return this.mirrorCombo(ref, o);
            var m = menuOf(o);
            if (!m) return [];
            this.prepare(ref, m, !!AFTER[ref]);
            var list = this.read(ref, m, 1, '', opts);
            if (!list.length) this.gap(ref, 'gallery', caption(o) || ref);
            return list;
        },

        prepare: function (ref, m, after) {
            var ev = showEvent(m);
            try {
                m.trigger('show:before', m, ev);
                if (after) m.trigger('show:after', m, ev);
            } catch (e) {
                /* The stock preparation handler did not survive showing without a DOM —
                   we read what there is and mark the place for coverage checking. */
                this.gap(ref, 'prepare', String(e && e.message || e));
            }
        },

        /* opts.seps === 'structure' — separators by the menu structure, not by their flag: for
           the grid context menu stock decides some separators by the visibility of an item in the DOM of an already
           shown menu (pmiFreezeSeparator — pmiFreezePanes.isVisible()), and a snapshot without
           showing would not see them. The extra ones are squeezed by the cleanup below — as the stock display squeezes them.
           Plugin items (isCustomItem) are added by stock when the menu is shown and removed on hiding
           (onPluginContextMenuShow, clearCustomItems) — they do not go into the mirror, the place is in gaps. */
        read: function (ref, m, depth, prefix, opts) {
            var me = this, out = [];
            var structural = !!opts && opts.seps === 'structure';
            m.items.forEach(function (item, index) {
                if (!item) return;
                if (isSep(item)) {
                    if (structural || shown(item)) out.push({sep: true});
                    return;
                }
                if (!shown(item)) return;
                if (omitted(ref, item)) return;
                if (item.isCustomItem) { me.gap(ref, 'plugin', caption(item) || prefix + index); return; }
                var cap = caption(item);
                if (!cap) {
                    /* An inner menu — its rows in place of the holder; a stepper — a
                       stepper row; anything else without a caption — a bare gallery, an omission. */
                    var inner = innerOf(m, index);
                    if (inner) {
                        var rows = me.read(ref, inner, depth, prefix + index + '/', opts);
                        if (!rows.length) me.gap(ref, 'gallery', prefix + index);
                        rows.forEach(function (r) { out.push(r); });
                        return;
                    }
                    var sp = stepperOf(item);
                    if (sp) {
                        out.push({id: prefix + index, caption: sp.caption, disabled: sp.disabled, checked: false,
                                  stepper: true, value: sp.value});
                        return;
                    }
                    me.gap(ref, 'gallery', prefix + index);
                    return;
                }
                var entry = {
                    id: prefix + index,
                    caption: cap,
                    disabled: disabled(item),
                    checked: pressed(item)
                };
                var val = valueOf(item);
                if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') entry.value = val;
                var note = notes(item);
                if (note.hint) entry.hint = note.hint;
                if (note.desc) entry.desc = note.desc;
                var icon = iconOf(item);
                if (icon) entry.icon = icon;
                var sub = menuOf(item);
                if (sub || item.menu) {
                    if (!sub) { me.gap(ref, 'gallery', cap); return; }
                    me.prepare(ref, sub, false);
                    /* A gallery submenu is one row: it is shown by the stock popup
                       (popup by itemRef), depth is no obstacle to it. */
                    if (holdsGallery(sub)) { entry.gallery = true; out.push(entry); return; }
                    if (depth >= MAX_DEPTH) { me.gap(ref, 'depth', cap); return; }
                    entry.sub = me.read(ref, sub, depth + 1, entry.id + '.', opts);
                    if (!entry.sub.length) { me.gap(ref, 'gallery', cap); return; }
                }
                out.push(entry);
            });
            /* Separators at the edges and in a row are traces of an omission. */
            var clean = [];
            out.forEach(function (e) {
                if (e.sep && (!clean.length || clean[clean.length - 1].sep)) return;
                clean.push(e);
            });
            while (clean.length && clean[clean.length - 1].sep) clean.pop();
            return clean;
        },

        /* A ribbon combo (number format): the list is a store, the preparation for showing
           is done by the same 'show:before' (stock puts in the sample values and the current
           value). What the combo shows in its field is marked. List items
           outside the store (for the number format — "More formats") are taken from its
           markup, their id is 'dom:<node id>'. */
        mirrorCombo: function (ref, c) {
            try {
                c.trigger('show:before', c, showEvent(c));
            } catch (e) {
                this.gap(ref, 'prepare', String(e && e.message || e));
            }
            var field = c.displayField || 'displayValue';
            var current = typeof c.getValue === 'function' ? c.getValue() : null;
            var out = [], ids = {};
            for (var i = 0; i < c.store.length; i++) {
                var r = c.store.at(i);
                var cap = r.get(field);
                var id = String(r.get('id') != null ? r.get('id') : r.id);
                ids[id] = true;
                out.push({id: id, caption: cap == null ? '' : String(cap),
                          example: r.get('exampleval') == null ? '' : String(r.get('exampleval')),
                          disabled: false, checked: cap != null && cap === current});
            }
            var el = nodeOf(c);
            var lis = el && el.querySelectorAll ? el.querySelectorAll('li') : [];
            var divider = false;
            Array.prototype.forEach.call(lis, function (li) {
                if (/\bdivider\b/.test(li.className || '')) { divider = true; return; }
                if (!li.id || ids[li.id]) return;
                var a = li.querySelector && li.querySelector('a');
                var text = a ? String(a.textContent || '').trim() : '';
                if (!text) return;
                if (divider) out.push({sep: true});
                divider = false;
                out.push({id: 'dom:' + li.id, caption: text, example: '', disabled: false, checked: false});
            });
            return out;
        },

        /* A snapshot of the stock grid context menu — the one that stock would show now
           (the column header menu). show is the stock
           showObjectMenu of the DocumentHolder controller, not intercepted: without an event it
           fills the menu by the selection and the edit right (fillMenuProps — ssMenu; without the edit
           right or when forbidden — fillViewMenuProps, viewModeMenu), and it skips showing without an event
           (showPopupMenu: "menu && event"). Which menu stock chose — by its own
           showPopupMenu call, intercepted for the duration of the snapshot: the decision "edit or
           view", the held mouse button and the range selection for the window stay with stock.
           The "Number format" submenu is prepared by stock on showing — the sample values of the selection
           (onNumberFormatOpenAfter on 'show:after'); its stock handler is called here
           directly: the 'show:after' event would put the menu into the active Common.UI.Menu.Manager.
           The mirror separators are by the menu structure (read, seps: 'structure').
           Returns {ref, items} — the menu address for pick() and its mirror; {ref: null} — stock would not
           show a menu now; {ref: null, other} — stock would show a menu that has no
           mirror (headers/footers, an object); null — there is no controller. */
        contextMenu: function (show) {
            var c = ctl('DocumentHolder'), view = c && c.documentHolder;
            var fn = show || (c && c.showObjectMenu);
            if (!c || !view || typeof fn !== 'function') { this.gap('DocHolder', 'missing', 'DocumentHolder'); return null; }
            var chosen = null, own = Object.prototype.hasOwnProperty.call(c, 'showPopupMenu'), prev = c.showPopupMenu;
            c.showPopupMenu = function (menu) { chosen = menu || null; };
            try {
                fn.call(c);
            } finally {
                if (own) c.showPopupMenu = prev; else delete c.showPopupMenu;
            }
            if (!chosen) return {ref: null};
            var name = null;
            CONTEXT_MENUS.forEach(function (n) { if (view[n] && view[n] === chosen) name = n; });
            if (!name) return {ref: null, other: String(chosen.id || 'menu')};
            var ref = 'DocHolder:' + name;
            if (name === 'ssMenu') this.prepareNumberFormat(ref, c, view);
            return {ref: ref, items: this.mirror(ref, {seps: 'structure'})};
        },

        prepareNumberFormat: function (ref, c, view) {
            var nf = view.pmiNumFormat;
            if (!nf || !shown(nf) || !nf.menu || typeof c.onNumberFormatOpenAfter !== 'function') return;
            try {
                c.onNumberFormatOpenAfter(nf.menu);
            } catch (e) {
                this.gap(ref, 'prepare', String(e && e.message || e));
            }
        },

        gap: function (ref, kind, what) {
            var exists = this.gaps.some(function (g) { return g.ref === ref && g.kind === kind && g.what === what; });
            if (!exists) this.gaps.push({ref: ref, kind: kind, what: what});
        },

        /* Choosing by the stock click on an item: MenuItem.onItemClick (a refusal on a
           disabled item and on a submenu holder, the group mark) → its 'click' →
           Menu.onItemClick → the menu's 'item:click', which stock is subscribed to. For a
           combo — a click on the link of an item of its own list: ComboBox
           .itemClicked ('selected') and the delegated stock handlers
           ("More formats"). ids — an index path from mirror(): '15', '0.3',
           '0/1' (a row of an inner menu) or an array — or an item value
           ({value}, locate). A refusal — there is no item, it is hidden, disabled, holds a
           submenu or it is not an item but a gallery without a caption (a stepper steps via step). */
        pick: function (ref, ids) {
            var o = this.twin(ref);
            if (!o || ids == null) return false;
            if (isCombo(o)) return byValue(ids) ? false : this.pickCombo(o, String(ids));
            var item = this.locate(ref, ids);
            if (!item || isSep(item) || item.menu || disabled(item) || !caption(item)) return false;
            if (typeof item.onItemClick !== 'function') return false;
            item.onItemClick(clickEvent(item));
            return true;
        },

        /* A stock menu item of the twin by a path from mirror(): a segment is an item index,
           'i/k' — row k of the inner menu of item i. Every item of the path is shown by stock.
           Or by value ({value: v | function}; "Clear format" — the "Formatting" item
           of the "Clear" button by Asc.c_oAscCleanOptions.Format):
           the first item of the twin's menu shown by stock with this value; the item index in stock
           is conditional (the menu is assembled by mode), the value is not. */
        locate: function (ref, ids) {
            var o = this.twin(ref);
            if (!o || ids == null) return null;
            if (byValue(ids)) {
                var menu = menuOf(o), v = wanted(ids), found = null;
                if (!menu || v === undefined) return null;
                menu.items.some(function (it) {
                    if (!it || isSep(it) || !shown(it) || valueOf(it) !== v) return false;
                    found = it;
                    return true;
                });
                return found;
            }
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
            return item;
        },

        /* The state of a stock menu item (locate) — of the same form as state(): items have their own
           locks that the button does not (in the stock "Clear", when a cell is edited the items are disabled, not
           the button: controller/Toolbar.js lockToolbar(editCell) by menu items), and their own mark. */
        itemState: function (ref, ids) {
            var it = this.locate(ref, ids);
            if (!it) return {exists: false, disabled: true, pressed: false, visible: false, causes: []};
            return {exists: true, disabled: disabled(it), pressed: pressed(it), visible: true,
                    causes: Array.isArray(it.keepState) ? it.keepState.slice() : []};
        },

        /* The rows of the twin's stock menu now, without preparing for showing: whether among the shown top-level items there is
           a live one and the reasons for locking the disabled ones (causes — without repeats). No menu — exists: false. */
        rows: function (ref) {
            var m = menuOf(this.twin(ref)), out = {exists: false, live: false, causes: []};
            if (!m) return out;
            out.exists = true;
            m.items.some(function (it) {
                if (!it || isSep(it) || !shown(it)) return false;
                if (!disabled(it)) { out.live = true; return true; }
                (Array.isArray(it.keepState) ? it.keepState : []).forEach(function (c) { if (out.causes.indexOf(c) < 0) out.causes.push(c); });
                return false;
            });
            if (out.live) out.causes = [];
            return out;
        },

        controlCaption: function (ref) {
            var control = this.twin(ref);
            return control ? caption(control) : '';
        },

        /* The caption of a stock menu item (locate) — as stock shows it now; no item — ''. */
        itemCaption: function (ref, ids) {
            var it = this.locate(ref, ids);
            return it ? caption(it) : '';
        },

        /* A stock ribbon view phrase in the interface language — the caption of a command that has none of its own in the shell
           (for example, the "View → Show ▸" items — with stock names, without copies in the shell locale).
           Stock localization puts phrases into SSE.Views.<view> before the class is declared, and they land in its prototype; the phrase
           is available to the reader as well, for which stock does not build controls. No view or phrase — fallback (the English stock default). */
        phrase: function (view, key, fallback) {
            var V = SSE.Views[view], v;
            try { v = V ? (V.prototype && typeof V.prototype[key] === 'string' ? V.prototype[key] : V[key]) : undefined; } catch (e) { v = undefined; }
            return typeof v === 'string' && v ? v : (fallback == null ? '' : String(fallback));
        },

        /* The twin's menu is prepared as on a stock opening (show:before, for a menu from
           AFTER also show:after), without reading: before choosing an item that holds a gallery
           (for "Symbol" — "More symbols"), so that its empty places do not go into gaps. */
        prime: function (ref) {
            var m = menuOf(this.twin(ref));
            if (!m) return false;
            this.prepare(ref, m, !!AFTER[ref]);
            return true;
        },

        /* The twin address of a mirror row (it is shown by popup): the path of menu items.
           Rows of an inner menu have no address of their own — null. */
        itemRef: function (ref, id) {
            var o = this.twin(ref);
            if (!o || id == null) return null;
            var path = String(id).split('.');
            if (!path.every(function (s) { return /^\d+$/.test(s); })) return null;
            var base = menuOf(o) === o ? ref + '.items.' : ref + '.menu.items.';
            return base + path.join('.menu.items.');
        },

        /* --- Galleries ------------------------------------------------------
           A stock gallery — the twin's menu — is shown at our control
           by a stock popup. In Compact the ribbon is hidden
           by a style (display: none), and a menu cannot be drawn in it: for the duration of the display the nodes on
           the path from the menu to the first rendered ancestor (#toolbar) get expansion classes —
           the path becomes part of the layout but stays invisible (the root is
           taken out of the flow and has no size, the path's neighbors are hidden), only the gallery
           menu is visible (compact-shell.less, "Galleries"). The nodes are not moved. The menu is
           position: fixed (Menu.render), its place is given by the stock alignment
           (alignPosition) against our anchor: menuAlignEl for the duration of the display is an invisible
           node in the place of the control; next to it on the right (at the window edge — on the left), the top is
           padY above the control, as for our submenus. Vertically the place is set by the bridge
           through the stock alignment hook (options.additionalAlign, for the duration of the display):
           the bottom is not below window − 4, the top is not above 4, as for our submenus (placeFly), and not
           stock's pressing to window − 10; the height that stock took away to fit the window
           from a gallery with a ceiling is returned by the bridge (fit, unclip). The display is stock: a button menu —
           Menu.show() (bootstrap: show:before and show:after, stock builds the gallery
           lazily), an item submenu — by the path by which hovering shows it
           (MenuItem._doHover: 'show.bs.dropdown', the over class, 'shown.bs.dropdown').
           The choice is made by the gallery's own stock path: a click that reached the menu (not
           stopped by stock) is a choice, the popup closes (onClose('pick')); an item
           with stopPropagation (palettes) does not close the menu — as in stock. Stock removed
           the menu itself (open or over cleared) — the bridge cleans up (onClose('hide')).
           opts — {align: 'tl-tr', padY, onClose(how)}; how: pick, hide, close,
           replace, error. A refusal (false) — there is no twin, it is disabled, the menu is not
           rendered or does not exist: then — dialog(). */
        shown: null,

        popup: function (ref, anchorEl, opts) {
            opts = opts || {};
            var o = this.twin(ref);
            if (!o || disabled(o) || !anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return false;
            var m = galleryOf(o);
            var ul = m && m.rendered && m.menuRoot && m.menuRoot[0];
            var host = m && m.parentEl && m.parentEl[0];
            if (!ul || !host || typeof m.alignPosition !== 'function' || !m.options || typeof m.options !== 'object') return false;
            var nested = hasCls(host, 'dropdown-submenu');
            if (!nested && typeof m.show !== 'function') return false;
            var doc = ul.ownerDocument || document;
            this.closePopup('replace');
            var anchor = doc.createElement('div');
            anchor.className = ANCHOR_CLS;
            var $anchor = jq(anchor);
            if (!$anchor) return false;
            var me = this;
            var st = {ref: ref, m: m, ul: ul, host: host, nested: nested, anchor: anchor, $anchor: $anchor,
                      align: opts.align || 'tl-tr', dx: 0, opts: opts, path: [], doc: doc, owners: [o, this.owner(ref)],
                      saved: {alignEl: m.menuAlignEl, align: m.menuAlign, offset: Array.isArray(m.offset) ? m.offset.slice() : m.offset,
                              additionalAlign: m.options.additionalAlign}};
            this.place(st, anchorEl);
            doc.body.appendChild(anchor);
            this.reveal(st);
            /* A combo gallery (cell styles, ComboDataView) measures itself with the stock checkSize —
               another 5 s on a timer after window:resize, uitheme:changed, tab:active — and when
               its size changes it hides the menu (onResize → openButton.menu.hide()). In the hidden
               ribbon the combo is not measured (0×0) or measured in another theme, and the first measurement in the
               expanded path closed the gallery that had just been shown. The measurement is done in advance, while the
               menu is closed (Menu.hide of a closed menu does nothing), by the same stock
               method: after that the size does not change. */
            if (o.openButton && o.openButton.menu === m && typeof o.checkSize === 'function') {
                try { o.checkSize(); } catch (e) { /* no measurement — as before */ }
            }
            /* A stock hook: Menu.alignPosition calls it instead of css({left, top}) with its own
               left and top — both on showing and on hovering over a submenu (MenuItem: mouseenter →
               alignPosition), so the vertical place holds the whole time of the display. */
            m.options.additionalAlign = function (menuRoot, left, top) { me.settle(st, menuRoot, left, top); };
            /* Open before showing: the stock menu:show notification that showing dispatches
               is recognized by the shell as its own (popupOpen) and it does not close its own surfaces. */
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
                this.fit(st, anchor.getBoundingClientRect());
            } catch (e) {
                if (this.shown === st) this.closePopup('error');
                return false;
            }
            this.follow(st);
            return true;
        },

        /* An invisible anchor in the place of our control. */
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

        /* The path from the menu to the first rendered ancestor: show it for the layout while keeping
           it invisible. Rendered ancestors (#toolbar and above) are not touched. */
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
            st.m.offset = [st.dx, 0];
            st.m.alignPosition();
        },

        /* The twin's owner is the address root (the ribbon): there stock keeps the gallery DataViews
           that are neither in the inner menus nor at the twin (table templates). */
        owner: function (ref) {
            var at = typeof ref === 'string' ? ref.indexOf(':') : -1;
            var root = at > 0 ? ROOTS[ref.slice(0, at)] : null;
            try { return root ? root() || null : null; } catch (e) { return null; }
        },

        /* The gallery's vertical top: padY above the control; the bottom is not below window − 4, the top is
           not above 4 (like our submenus, placeFly). h is the menu height. */
        galleryTop: function (st, h) {
            var a = st.anchor.getBoundingClientRect(), vh = window.innerHeight || 0;
            var t = a.top - (st.opts.padY || 0);
            if (vh && t + h > vh - 4) t = vh - 4 - h;
            if (t < 4) t = 4;
            return t;
        },

        /* The alignment hook (options.additionalAlign): stock's left and top as they are, then
           a vertical shift to our place. For a menu without a height ceiling stock presses the bottom to
           window − 10 (for a submenu also its own margin of −6: the bottom 8–22 px from the edge) — on top of this
           pressing the offset does not act, only this shift removes it. The menu margins
           (margin-top) are accounted for: the shift is measured on the rendered menu. While the display is in progress (before fit)
           the place is stock's as is: its DataView on show:after measures the list from this place and
           squeezes what is below window − 10 (from css top, without the menu margin), and a DataView without a ceiling
           (restoreHeight 0: icon sets) does not return the height afterwards. */
        settle: function (st, menuRoot, left, top) {
            menuRoot.css({left: left, top: top});
            if (!st.fitted || !rendered(st.ul)) return;
            var r = st.ul.getBoundingClientRect();
            var fix = this.galleryTop(st, r.height) - r.top;
            if (Math.abs(fix) > 0.25) menuRoot.css({left: left, top: top + fix});
        },

        /* The height taken away to fit the window. A gallery with a height ceiling (restoreHeight) stock
           squeezes in place when showing — to window − 10 from the top at the row — and does not raise it:
           "Shape ▸" at 1280×800 scrolled inside with free room above. Like our
           submenus: first raise (the top — to 4 px from the window edge) and return the
           height to stock's ceiling (the content, but not above restoreHeight), squeeze — only
           if it still does not fit (then the bottom is window − 4). The scrollbars — by the stock update. */
        unclip: function (st) {
            var vh = window.innerHeight || 0;
            if (!vh) return;
            var parts = [];
            ceilings(st.m, st.owners).forEach(function (c) {
                if (c.el !== st.ul && !(typeof st.ul.contains === 'function' && st.ul.contains(c.el))) return;
                var max = parseFloat(c.el.style && c.el.style.maxHeight);
                var hidden = (c.el.scrollHeight || 0) - (c.el.clientHeight || 0);
                if (!(max > 0) || hidden <= 1) return;
                var want = Math.min(max + hidden, c.cap);
                if (want > max) parts.push({c: c, max: max, want: want});
            });
            if (!parts.length) return;
            var h = st.ul.getBoundingClientRect().height;
            parts.forEach(function (p) { h += p.want - p.max; });
            var cut = h - (vh - 8);
            for (var i = parts.length - 1; i >= 0 && cut > 0; i--) {
                var take = Math.min(cut, parts[i].want - parts[i].max);
                parts[i].want -= take;
                cut -= take;
            }
            parts.forEach(function (p) {
                if (p.want <= p.max) return;
                p.c.el.style.maxHeight = p.want + 'px';
                var sc = p.c.owner && p.c.owner.scroller;
                try { sc && typeof sc.update === 'function' && sc.update(); } catch (e) { /* scrollbar — as it was */ }
            });
        },

        /* The height — back to the ceiling (unclip), the vertical place — by the hook (settle) on
           alignment. No room on the right — stock pressed the menu to the window edge over the control:
           then to the left of the control. Horizontally — overlapping the control by 2 px, as for our
           submenus (placeFly). */
        fit: function (st, a) {
            st.fitted = true;
            this.unclip(st);
            this.aim(st);
            var r = st.ul.getBoundingClientRect();
            if (st.align === 'tl-tr' && r.left < a.right - 1) { st.align = 'tr-tl'; this.aim(st); r = st.ul.getBoundingClientRect(); }
            var dx = Math.round((st.align === 'tr-tl' ? a.left + 2 - r.width : a.right - 2) - r.left);
            if (dx) { st.dx += dx; this.aim(st); }
        },

        stockShows: function (st) {
            return hasCls(st.host, st.nested ? 'over' : 'open');
        },

        /* The choice and closing by stock. A click that reached the gallery menu is a choice (the scrollbar
           does not count). open/over cleared by stock — the menu is removed: after a press
           or a key inside the gallery this is also a choice (the equation choice handler, for example,
           hides the menu itself, and the click no longer reaches the menu), otherwise — just hidden. Hovering inside
           the gallery does not bubble beyond its menu: otherwise a hidden ribbon button in whose
           holder the menu lies caught mouseenter and showed its tooltip over
           the gallery (for a submenu — the holder item too). Submenus inside the gallery (equation
           groups, SmartArt sections) do get hovering — they are deeper than the menu. Closing on
           a choice and on hiding by stock calls the shell's onClose (closeSurfaces) from a listener
           on the stock node and from a MutationObserver — under the shell's guard. */
        follow: function (st) {
            var me = this;
            st.onHover = function (e) { e && e.stopPropagation && e.stopPropagation(); };
            st.ul.addEventListener('mouseover', st.onHover);
            st.ul.addEventListener('mouseout', st.onHover);
            st.onPress = function () { st.armed = true; };
            st.ul.addEventListener('mousedown', st.onPress, true);
            st.ul.addEventListener('keydown', st.onPress, true);
            st.onClick = guard('bridge: gallery pick', function (e) {
                if (me.shown !== st) return;
                var t = e && e.target;
                if (t && typeof t.closest === 'function' &&
                    t.closest('.ps-scrollbar-y-rail, .ps-scrollbar-x-rail, .ps__rail-y, .ps__rail-x')) return;
                me.closePopup('pick');
            });
            st.ul.addEventListener('click', st.onClick);
            if (typeof MutationObserver === 'function') {
                st.obs = new MutationObserver(guard('bridge: gallery hidden', function () {
                    if (me.shown === st && !me.stockShows(st)) me.closePopup(st.armed ? 'pick' : 'hide');
                }));
                st.obs.observe(st.host, {attributes: true, attributeFilter: ['class']});
            }
        },

        /* Close the shown gallery: the stock Menu.hide (for a submenu it clears over),
           the stock alignment — as it was, the classes and the anchor — away. */
        closePopup: function (how) {
            var st = this.shown;
            if (!st) return false;
            this.shown = null;
            st.obs && st.obs.disconnect();
            st.onClick && st.ul.removeEventListener('click', st.onClick);
            if (st.onHover) {
                st.ul.removeEventListener('mouseover', st.onHover);
                st.ul.removeEventListener('mouseout', st.onHover);
                st.ul.removeEventListener('mousedown', st.onPress, true);
                st.ul.removeEventListener('keydown', st.onPress, true);
            }
            try {
                if (this.stockShows(st)) st.m.hide();
            } catch (e) { /* we close our own in any case */ }
            st.m.menuAlignEl = st.saved.alignEl;
            st.m.menuAlign = st.saved.align;
            st.m.offset = st.saved.offset;
            if (st.m.options) st.m.options.additionalAlign = st.saved.additionalAlign;
            this.unreveal(st);
            st.anchor.parentNode && st.anchor.parentNode.removeChild(st.anchor);
            /* Hovering over a stock submenu (MenuItem._doHover) sets over with a delay of 200
               ms: a late class is removed so that the submenu in Stock is not left open. */
            if (st.nested) {
                var me = this;
                setTimeout(function () {
                    if (me.shown && me.shown.host === st.host) return;
                    try { st.m.parentEl.removeClass('over'); } catch (e) { /* the node is already gone */ }
                }, 250);
            }
            var cb = st.opts.onClose;
            if (typeof cb === 'function') cb(how || 'close');
            return true;
        },

        popupOpen: function () {
            return !!this.shown;
        },

        /* A node inside the shown gallery (its stock submenus lie inside it). */
        popupOwns: function (node) {
            var st = this.shown;
            return !!(st && node && typeof st.ul.contains === 'function' && st.ul.contains(node));
        },

        /* Where to put focus in a shown gallery when entering it from the keyboard — where stock itself puts it
           on entering its submenu: the swatch grid (DataView) or the palette of the gallery itself, otherwise the first
           available list row. The gallery is not built yet (stock builds it lazily) or does not exist — null. */
        popupEntry: function () {
            var st = this.shown, ul = st && st.ul;
            if (!ul || typeof ul.querySelectorAll !== 'function') return null;
            var visible = function (n) {
                return rendered(n) && (!window.getComputedStyle || window.getComputedStyle(n).visibility !== 'hidden');
            };
            var own = function (sel) {
                return Array.prototype.filter.call(ul.querySelectorAll(sel), function (n) {
                    return typeof n.closest === 'function' && n.closest('.dropdown-menu') === ul && visible(n);
                })[0] || null;
            };
            var hit = own('.dataview.canfocused') || own('.theme-colorpalette.focused');
            if (hit) return hit;
            var items = Array.prototype.filter.call(ul.children || [], function (li) {
                return li.tagName === 'LI' && !hasCls(li, 'divider') && !hasCls(li, 'disabled');
            });
            for (var i = 0; i < items.length; i++) {
                var a = items[i].firstElementChild;
                if (a && a.tagName === 'A' && visible(a)) return a;
            }
            return null;
        },

        /* A stock gallery command dialog — a fallback path where it cannot be shown:
           the twin of a dialog button or a stock menu item by value; for a submenu —
           by the address root. */
        dialog: function (ref) {
            if (typeof ref !== 'string') return false;
            var base = ref.split('.')[0];
            var d = DIALOGS[ref] || DIALOGS[base];
            if (!d) return false;
            if (d.run) return this.run(d.run);
            var m = menuOf(this.twin(base));
            if (!m) return false;
            var idx = -1;
            m.items.forEach(function (it, i) {
                var v = it && (it.value !== undefined ? it.value : (it.options && it.options.value));
                if (idx < 0 && v === d.value) idx = i;
            });
            if (idx < 0) return false;
            this.prime(base);
            return this.pick(base, String(idx));
        },

        /* A mirror stepper row: a step is a click on the node of the stock stepper button (its
           handler Common.UI.Button → the stepper's 'click' → the stock handler). */
        step: function (ref, id, dir) {
            var sp = stepperOf(this.locate(ref, id));
            var btn = sp && (dir === 'down' ? sp.down : sp.up);
            if (!btn || offBtn(btn) || typeof btn.click !== 'function') return false;
            btn.click();
            return true;
        },

        stepper: function (ref, id) {
            var sp = stepperOf(this.locate(ref, id));
            return sp ? {caption: sp.caption, value: sp.value, disabled: sp.disabled} : null;
        },

        pickCombo: function (c, id) {
            if (disabled(c)) return false;
            var el = nodeOf(c);
            if (!el || !el.querySelectorAll) return false;
            var want = id.indexOf('dom:') === 0 ? id.slice(4) : id;
            var li = null;
            Array.prototype.some.call(el.querySelectorAll('li'), function (node) {
                if (node.id === want) { li = node; return true; }
                return false;
            });
            var a = li && li.querySelector && li.querySelector('a');
            if (!a || typeof a.click !== 'function') return false;
            a.click();
            return true;
        }
    };

    return SSE.Views.StockBridge;
});
