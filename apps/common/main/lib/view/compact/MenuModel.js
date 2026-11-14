/*
 * MenuModel — the model of an item of the "Compact" shell menu bar, shared by the editors.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * It has no markup, no menu composition and no editor commands: only how to
 * describe an item and how to get a snapshot of a section from the description and the current state.
 * The composition and commands come from the editor's catalog, the markup from the menu bar.
 *
 * An item is {k, t, i, kind, sc, hint, desc, when, needs, disabled, checked, run, items}:
 *  - k — the item key, unique across the whole menu;
 *  - t — the caption: a string or a function (ctx) -> string, read at every snapshot;
 *  - i — the icon name; sc — the name of the stock keyboard shortcut action. The model does not read them;
 *  - hint — an explanation on the right instead of the shortcut, desc — a description on the second line (for the screen reader —
 *    the item description): a string or a function (ctx) -> string, read at every snapshot;
 *  - kind — the row kind:
 *      'action'  — a command, executed and closes the menu;
 *      'check'   — a toggle with a checkmark;
 *      'radio'   — an option of a single-choice group: a group is consecutive options
 *                  between separators and headings, at most one is selected;
 *      'submenu' — a submenu ▸ with items: a list or a function (ctx) -> list,
 *                  it is read at every snapshot. The submenu nesting depth is set by
 *                  the editor (validate, depth), by default there is no other inside a submenu;
 *      'group'   — a heading of a group of options ("Wrapping"), never executed;
 *      'sep'     — a separator;
 *      'widget'  — a row with its own content (a counter, a field), drawn by the editor.
 *    Without kind: 'sep' for {sep: true}, 'submenu' for an item with items, otherwise 'action';
 *  - when(ctx) — false: the capability is absent (integration, right), there is no item at all;
 *  - needs — the name of a command that may be missing (ctx.has(needs) is false): the item stays
 *    in place inactive without a reason;
 *  - disabled(ctx) — the command exists but is unavailable now: a reason code, a list of codes,
 *    true (disabled without a reason) or null. Of several codes one is visible — pickReason
 *    by the editor's order of reasons;
 *  - checked(ctx) — the mark of 'check' and 'radio';
 *  - run(args) — execution; it is called by the menu bar, the model only says whether it is allowed.
 *
 * ctx — the editor state at the moment of the snapshot, assembled by the editor adapter. The model
 * needs from it only has(name) for needs, the rest is read by the item functions.
 *
 * Disable reasons. The model knows only the common codes COMMON_REASONS and their precedence. The editor's own codes
 * (the final review variant, no selection…) and their place among the common ones are declared by the
 * editor — an order of reasons from highest to lowest priority; it is received by state, section and pickReason
 * (reasonOrder). Without the editor's order the common codes outrank any others.
 */
define([], function () {
    'use strict';

    if (window.Common === undefined) window.Common = {};
    if (Common.UI === undefined) Common.UI = {};
    if (Common.UI.Compact === undefined) Common.UI.Compact = {};

    var KINDS = ['action', 'check', 'radio', 'submenu', 'group', 'sep', 'widget'];

    /* Common disable reasons, from highest to lowest priority: the limit of simultaneous editing,
       no connection, opened for viewing, document protection. */
    var COMMON_REASONS = ['limit', 'offline', 'view', 'protected'];

    function kindOf(it) {
        if (!it) return 'sep';
        if (it.kind) return it.kind;
        if (it.sep) return 'sep';
        return it.items ? 'submenu' : 'action';
    }

    function labelOf(it, ctx) {
        return typeof it.t === 'function' ? it.t(ctx) : (it.t || '');
    }

    /* The item hint and description: a string, a function of ctx, or null if there are none. */
    function textOf(value, ctx) {
        var text = typeof value === 'function' ? value(ctx) : value;
        return text === undefined || text === null || text === '' ? null : String(text);
    }

    /* The submenu items now: the list as is or the result of a function of ctx. */
    function itemsOf(it, ctx) {
        var items = it && (typeof it.items === 'function' ? it.items(ctx) : it.items);
        return items || [];
    }

    function hasCommand(ctx, name) {
        return !!ctx && typeof ctx.has === 'function' && !!ctx.has(name);
    }

    function codesOf(list) {
        return [].concat(list === undefined || list === null ? [] : list).filter(function (c) {
            return typeof c === 'string' && c !== '';
        });
    }

    /* The full order of reasons by the editor's order: its codes keep their places, the common ones —
       in the places of the common ones in their precedence, however much the editor reorders them. A common code
       that the editor did not name goes right after the preceding common one by precedence, and without
       it — first. Duplicates and non-codes are dropped. */
    function reasonOrder(order) {
        var seen = {}, list = [];
        codesOf(order).forEach(function (c) {
            if (!seen[c]) { seen[c] = true; list.push(c); }
        });
        var present = COMMON_REASONS.filter(function (c) { return seen[c]; }), n = 0;
        list = list.map(function (c) { return COMMON_REASONS.indexOf(c) >= 0 ? present[n++] : c; });
        COMMON_REASONS.forEach(function (c, i) {
            if (seen[c]) return;
            var at = i ? list.indexOf(COMMON_REASONS[i - 1]) + 1 : 0;
            list.splice(at, 0, c);
            seen[c] = true;
        });
        return list;
    }

    /* The highest-priority reason from a list of codes: the first by the editor's order of reasons (reasonOrder),
       otherwise the first code that is not in the order. Non-codes (null, true) are skipped. */
    function pickReason(codes, order) {
        var list = codesOf(codes), ranks = reasonOrder(order);
        var best = null, rank = ranks.length;
        list.forEach(function (c) {
            var i = ranks.indexOf(c);
            if (i >= 0 && i < rank) { best = c; rank = i; }
        });
        return best || list[0] || null;
    }

    /* A snapshot of one item: whether it is visible, whether it is disabled and why, whether it is checked, the caption, the hint
       and the description. It reads the item functions now: the snapshot is plain values, it does not change later.
       order — the editor's order of reasons (pickReason). */
    function state(it, ctx, order) {
        var kind = kindOf(it);
        var off = {visible: false, disabled: true, reason: null, checked: false, label: '', hint: null, desc: null};
        if (kind === 'sep') return {visible: true, disabled: true, reason: null, checked: false, label: '', hint: null, desc: null};
        if (it.when && !it.when(ctx)) return off;
        var label = labelOf(it, ctx);
        if (kind === 'submenu' && !section(itemsOf(it, ctx), ctx, order).visible) return off;
        if (kind === 'group') return {visible: true, disabled: true, reason: null, checked: false, label: label, hint: null, desc: null};
        var hint = textOf(it.hint, ctx), desc = textOf(it.desc, ctx);
        var checked = (kind === 'check' || kind === 'radio') && typeof it.checked === 'function' && it.checked(ctx);
        if (kind !== 'check' || checked !== 'mixed') checked = !!checked;
        if (it.needs && !hasCommand(ctx, it.needs))
            return {visible: true, disabled: true, reason: null, checked: checked, label: label, hint: hint, desc: desc};
        var codes = typeof it.disabled === 'function' ? it.disabled(ctx) : null;
        codes = codes === undefined || codes === null || codes === false ? [] : [].concat(codes);
        var disabled = codes.some(function (c) { return !!c; });
        return {visible: true, disabled: disabled, reason: disabled ? pickReason(codes, order) : null,
                checked: checked, label: label, hint: hint, desc: desc};
    }

    /* Whether an item can be executed by its snapshot: only a visible and not disabled action,
       toggle or option. A group heading, a separator, a submenu and the editor's own row
       are not executed. */
    function actionable(it, st) {
        var kind = kindOf(it);
        return (kind === 'action' || kind === 'check' || kind === 'radio') &&
            !!st && st.visible && !st.disabled;
    }

    /* A snapshot of a section or submenu: visible rows in the catalog order. Separators at the edges
       and in a row are removed, a group heading with no options after it too. In a group of options
       only the first checked one is marked. A section without a single row, except separators
       and headings, is visible: false. A submenu row has its rows (rows). order — the order of
       the editor's reasons (pickReason). */
    function section(items, ctx, order) {
        var rows = [];
        (items || []).forEach(function (it) {
            var kind = kindOf(it);
            if (kind === 'sep') { rows.push({it: it, kind: kind}); return; }
            var st = state(it, ctx, order);
            if (!st.visible) return;
            var row = {it: it, kind: kind, k: it.k, visible: true, disabled: st.disabled,
                       reason: st.reason, checked: st.checked, label: st.label, hint: st.hint, desc: st.desc};
            if (kind === 'submenu') row.rows = section(itemsOf(it, ctx), ctx, order).rows;
            rows.push(row);
        });

        /* A group heading without a visible item before the next separator or heading. */
        rows = rows.filter(function (row, i) {
            if (row.kind !== 'group') return true;
            var next = rows[i + 1];
            return !!next && next.kind !== 'sep' && next.kind !== 'group';
        });

        var out = [];
        rows.forEach(function (row) {
            if (row.kind === 'sep' && (!out.length || out[out.length - 1].kind === 'sep')) return;
            out.push(row);
        });
        while (out.length && out[out.length - 1].kind === 'sep') out.pop();

        var marked = false;
        out.forEach(function (row) {
            if (row.kind !== 'radio') { marked = false; return; }
            if (row.checked && marked) row.checked = false;
            else if (row.checked) marked = true;
        });

        return {
            visible: out.some(function (row) { return row.kind !== 'sep' && row.kind !== 'group'; }),
            rows: out
        };
    }

    /* Menu description errors [{k, t, items}]: a submenu deeper than allowed, a repeated section key
       or item key, an unknown kind. Empty — the description is valid. opts:
        - depth — how many submenu levels the editor allows, one by default;
        - ctx — the state from which function submenus are read; without it their items
          are not checked: the composition of such submenus is known only at a snapshot. */
    function validate(sections, opts) {
        var problems = [], seenSections = {}, seenItems = {};
        var limit = opts && opts.depth > 0 ? opts.depth : 1;
        var hasCtx = !!opts && opts.ctx !== undefined;

        function walk(items, path, level) {
            (items || []).forEach(function (it, i) {
                var kind = kindOf(it);
                var at = path + ' > ' + (it && it.k !== undefined ? it.k : '#' + i);
                if (KINDS.indexOf(kind) < 0) problems.push('unknown kind "' + kind + '" at ' + at);
                if (it && it.k !== undefined) {
                    if (seenItems[it.k]) problems.push('duplicate item key "' + it.k + '" at ' + at + ', first at ' + seenItems[it.k]);
                    else seenItems[it.k] = at;
                }
                if (kind === 'submenu' || (it && it.items)) {
                    if (level >= limit) problems.push('submenu deeper than ' + limit + ' at ' + at);
                    if (typeof it.items !== 'function' || hasCtx) walk(itemsOf(it, opts && opts.ctx), at, level + 1);
                }
            });
        }

        (sections || []).forEach(function (s, i) {
            var key = s && s.k !== undefined ? s.k : '#' + i;
            if (seenSections[key]) problems.push('duplicate section key "' + key + '"');
            seenSections[key] = true;
            walk(s && s.items, key, 0);
        });
        return problems;
    }

    Common.UI.Compact.MenuModel = {
        KINDS: KINDS,
        COMMON_REASONS: COMMON_REASONS,
        kindOf: kindOf,
        itemsOf: itemsOf,
        reasonOrder: reasonOrder,
        pickReason: pickReason,
        state: state,
        actionable: actionable,
        section: section,
        validate: validate
    };

    return Common.UI.Compact.MenuModel;
});
