/*
 * CompactMenuAdapter — Documents behind the shared menu bar of the "Compact" shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The shared menu bar (Common.UI.Compact.MenuBar) knows neither the catalog nor the engine:
 * sections and items are handed to it by this adapter from the DocumentActions catalog, the state of an
 * item — by the shared model (Common.UI.Compact.MenuModel) over a ctx that is assembled
 * here from the stock editor state.
 *
 * Disable reasons from highest to lowest priority — the REASONS order, the adapter declares it to the menu bar
 * (reasons) and by it chooses the visible reason of an item. limit, offline, view and protected are common
 * reasons (the texts are in the menu bar), final, original, form and forAll are Documents reasons
 * (the texts are DocumentActions.textReason*):
 *  - limit    — the limit of simultaneous editing is reached: Main._state.licenseType;
 *  - offline  — no connection: the Main.stackDisableActions prohibition stack has a reason
 *               reconnect, refresh-file, disconnect or not-loaded, or the session is broken
 *               for good (Main._state.isDisconnected, until reload);
 *  - view     — the document is opened for viewing: view-only rights or its own
 *               "Viewing" (the view reason in the stack). The viewMode flag of the disconnect event
 *               does not count as the view reason;
 *  - final, original — the final or original variant is shown (the review reason in the stack
 *               and the engine display mode);
 *  - form     — form filling (the stock fillFormMode);
 *  - protected — protection set in the document (DocProtection.getDocProps);
 *  - forAll   — review is turned on for everyone (DocumentActions.isTrackAll).
 * Stack reasons that are not in this list (merge preview, signature) disable
 * the edit items without a reason text.
 *
 * ctx:
 *  - has(name) — whether a stock api call exists;
 *  - options() — the editor's appOptions with the session rights (DocumentActions.rights); canEdit() —
 *    the edit right;
 *  - edit(kind) — the reason codes why editing is unavailable now, or null. kind:
 *    without it — document editing; 'comment' — a comment (the "comments
 *    only" protection allows it); 'review' — review (it is disabled also by the "tracked
 *    changes only" protection);
 *  - net(kind) — 'offline' when there is no connection, otherwise null: for items that need only
 *    the connection, the edit right is not needed, and the limit for them is also "no connection". kind 'download' —
 *    download and print: after an edit error (api:disconnect with permission to download)
 *    they remain available, as in the stock code;
 *  - on(code) — whether a common reason is in effect.
 *
 * The limit, the connection by the prohibition stack, the shortcut from the stock registry, the engine keyboard and
 * "the editor is covered" are read by the shared adapter helper (Common.UI.Compact.AdapterKit)
 * over the Documents controllers; rights, review, forms and protection are here.
 */
define([
    'common/main/lib/view/compact/MenuModel',
    'common/main/lib/view/compact/AdapterKit'
], function (Model, Kit) {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    function model() {
        if (Model && typeof Model.state === 'function') return Model;
        return window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.MenuModel;
    }

    function kit() {
        if (Kit && typeof Kit.create === 'function') return Kit;
        return window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.AdapterKit;
    }

    function main() {
        return DE.getController('Main') || null;
    }

    /* The order of Documents disable reasons from highest to lowest priority: the common MenuModel codes and its own. */
    var REASONS = ['limit', 'offline', 'view', 'final', 'original', 'form', 'protected', 'forAll'];

    function protection() {
        var ctl = DE.getController('DocProtection');
        return (ctl && ctl.getDocProps && ctl.getDocProps()) || null;
    }

    DE.Views.CompactMenuAdapter = {

        create: function (shell, api) {
            var actions = DE.Views.DocumentActions;
            var list = actions.sections();
            /* Edit error: Main breaks the edit session but keeps download and print
               (api:disconnect with true, controller/Main.js onError → EditingError). */
            var downloadKept = false;
            var stock = kit().create({
                controller: function (name) { return DE.getController(name); },
                api: api,
                downloadKept: function () { return downloadKept; }
            });
            var OFFLINE_TYPES = kit().OFFLINE_TYPES;

            if (window.Common && Common.NotificationCenter && Common.NotificationCenter.on) {
                Common.NotificationCenter.on('api:disconnect', function (enableDownload) {
                    if (enableDownload) downloadKept = true;
                });
            }

            /* The editor's appOptions, but the edit, review and comment rights are
               the session's (DocumentActions.rights): for the duration of its own "Viewing", connection loss
               or preview the stock code removes them from appOptions, and the menu is not
               rebuilt because of it. */
            function options() {
                var m = main(), o = (m && m.appOptions) || {};
                var r = actions.rights();
                var same = Object.keys(r).every(function (k) { return !!o[k] === r[k]; });
                return same ? o : _.extend({}, o, r);
            }

            function offline(kind) {
                return stock.offline(kind);
            }

            function displayReason() {
                var modes = window.Asc && Asc.c_oAscDisplayModeInReview;
                var mode = api && typeof api.asc_GetDisplayModeInReview === 'function' ?
                    api.asc_GetDisplayModeInReview() : undefined;
                if (modes && mode === modes.Original) return 'original';
                if (modes && mode === modes.Final) return 'final';
                return true;
            }

            /* Edit reason codes by precedence; the model will choose the highest-priority one itself. */
            function editCodes(kind) {
                var codes = [], entries = stock.stackEntries();
                var has = function (test) { return entries.some(test); };
                if (stock.limitReached()) codes.push('limit');
                if (offline()) codes.push('offline');
                if (!options().isEdit || has(function (e) { return e.type === 'view'; })) codes.push('view');
                if (has(function (e) { return e.type === 'review'; })) codes.push(displayReason());
                if (has(function (e) { return !!(e.options && e.options.fillFormMode); })) codes.push('form');
                var p = protection();
                if (p && (p.isReadOnly || p.isFormsOnly || p.isCommentsOnly && kind !== 'comment' ||
                          p.isReviewOnly && kind === 'review'))
                    codes.push('protected');
                /* Other stack reasons (merge, signature) disable editing without their own text. */
                if (has(function (e) {
                    return OFFLINE_TYPES.indexOf(e.type) < 0 &&
                        ['view', 'review', 'forms'].indexOf(e.type) < 0 &&
                        !(e.options && e.options.fillFormMode);
                })) codes.push(true);
                return codes.length ? codes : null;
            }

            function context() {
                return {
                    has: function (name) { return !!api && typeof api[name] === 'function'; },
                    options: options,
                    canEdit: function () { var o = options(); return !!(o.canEdit || o.isEdit); },
                    edit: editCodes,
                    net: function (kind) { return offline(kind) ? 'offline' : null; },
                    on: function (code) { return (editCodes() || []).indexOf(code) >= 0; }
                };
            }

            function state(it) {
                return model().state(it, context(), REASONS);
            }

            function find(k) {
                for (var i = 0; i < list.length; i++) if (list[i].k === k) return list[i];
                return null;
            }

            /* The Documents reason text: its own state reasons and the reasons of the items themselves. */
            function reasonText(code) {
                if (typeof code !== 'string' || !code) return null;
                var text = actions['textReason' + code.charAt(0).toUpperCase() + code.slice(1)];
                return typeof text === 'string' ? text : null;
            }

            return {
                sections: function () {
                    return list.map(function (s) { return {k: s.k, t: s.t}; });
                },
                groups: function (k) {
                    var s = find(k);
                    return s ? s.items : [];
                },
                itemState: state,
                /* An item disabled by this moment is not executed: the state is read
                   again right before the command. The row's own (the table grid)
                   is executed by the same path, via exec of the menu row. */
                exec: function (it, args) {
                    var st = state(it);
                    var own = model().kindOf(it) === 'widget' && st.visible && !st.disabled;
                    if (!(own || model().actionable(it, st)) || typeof it.run !== 'function') return false;
                    it.run(args);
                    return true;
                },
                shortcut: stock.shortcut,
                /* An item's own row (the table grid, a gallery) draws itself. */
                openRow: function (row, it, level) {
                    if (!it || model().kindOf(it) !== 'widget' || typeof it.render !== 'function') return false;
                    it.render(row, level);
                    return true;
                },
                reasons: REASONS.slice(),
                reasonText: reasonText,
                blocked: stock.blocked,
                keys: stock.keys,
                context: context
            };
        }
    };

    return DE.Views.CompactMenuAdapter;
});
