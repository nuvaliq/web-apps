/*
 * CompactMenuAdapter — the PDF viewer behind the shared menu bar of the "Compact" shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The shared menu bar (Common.UI.Compact.MenuBar) knows neither the catalog nor the engine:
 * sections and items are handed to it by this adapter from the PdfActions catalog, the state of
 * an item — by the shared model (Common.UI.Compact.MenuModel) over a ctx that is assembled
 * here from the stock editor state.
 *
 * Disable reasons are only the common ones (limit, offline, view, protected; the texts are in
 * the menu bar). The viewer edits nothing, so only one of them applies:
 * offline — no connection (the Main.stackDisableActions prohibition stack or a broken
 * session). It is given to the items that need the connection: download and print
 * (net('download') — after an edit error they remain available, as in the stock
 * interface), rename and version history.
 *
 * ctx:
 *  - has(name) — whether a stock api call exists;
 *  - options() — the editor's appOptions;
 *  - net(kind) — 'offline' when there is no connection, otherwise null.
 *
 * The connection by the prohibition stack, the shortcut from the stock registry, the engine
 * keyboard and "the editor is covered" are read by the shared adapter helper
 * (Common.UI.Compact.AdapterKit).
 */
define([
    'common/main/lib/view/compact/MenuModel',
    'common/main/lib/view/compact/AdapterKit',
    'pdfeditor/main/app/view/PdfActions'
], function (Model, Kit) {
    'use strict';

    if (window.PDFE === undefined) window.PDFE = {};
    if (PDFE.Views === undefined) PDFE.Views = {};

    function model() {
        if (Model && typeof Model.state === 'function') return Model;
        return window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.MenuModel;
    }

    function kit() {
        if (Kit && typeof Kit.create === 'function') return Kit;
        return window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact.AdapterKit;
    }

    /* The order of disable reasons: the common MenuModel codes, the viewer has none of its own. */
    var REASONS = ['limit', 'offline', 'view', 'protected'];

    /* Edit error: Main breaks the edit session but keeps download and print (api:disconnect
       with true). The flag and the subscription are the session's, not the menu's: the menu
       is rebuilt (CompactShell.buildMenu), and every rebuild must see the flag and add no
       subscription. */
    var downloadKept = false, subscribed = false;

    function watchDisconnect(shell) {
        if (subscribed || !window.Common || !Common.NotificationCenter || !Common.NotificationCenter.on) return;
        subscribed = true;
        var onDisconnect = function (enableDownload) {
            if (enableDownload) downloadKept = true;
        };
        Common.NotificationCenter.on('api:disconnect',
            shell && typeof shell.guarded === 'function' ? shell.guarded('menu: api:disconnect', onDisconnect) : onDisconnect);
    }

    PDFE.Views.CompactMenuAdapter = {

        REASONS: REASONS,

        create: function (shell, api) {
            var actions = PDFE.Views.PdfActions;
            if (typeof actions.init === 'function') actions.init(shell, api);
            var list = actions.sections();
            watchDisconnect(shell);
            var stock = kit().create({
                controller: function (name) { return PDFE.getController(name); },
                api: api,
                downloadKept: function () { return downloadKept; }
            });

            function context() {
                return {
                    has: function (name) { return !!api && typeof api[name] === 'function'; },
                    options: function () { return actions.options(); },
                    net: function (kind) { return stock.offline(kind) ? 'offline' : null; }
                };
            }

            function state(it) {
                return model().state(it, context(), REASONS);
            }

            function find(k) {
                for (var i = 0; i < list.length; i++) if (list[i].k === k) return list[i];
                return null;
            }

            function label(s) {
                return typeof s.t === 'function' ? s.t() : s.t;
            }

            return {
                sections: function () {
                    return list.map(function (s) { return {k: s.k, t: label(s)}; });
                },
                groups: function (k) {
                    var s = find(k);
                    return s ? s.items : [];
                },
                itemState: state,
                /* An item disabled by this moment is not executed: the state is read
                   again right before the command. */
                exec: function (it, args) {
                    var st = state(it);
                    if (!model().actionable(it, st) || typeof it.run !== 'function') return false;
                    it.run(args);
                    return true;
                },
                shortcut: stock.shortcut,
                /* The viewer catalog has no rows of its own. */
                openRow: function () { return false; },
                reasons: REASONS.slice(),
                /* No reasons of its own: the texts of the common ones are in the menu bar. */
                reasonText: function () { return null; },
                blocked: stock.blocked,
                keys: stock.keys,
                context: context
            };
        }
    };

    return PDFE.Views.CompactMenuAdapter;
});
