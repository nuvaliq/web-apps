/*
 * AdapterKit — the shared part of the editor adapters behind the menu bar of the "Compact" shell.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * An editor adapter (the contract is in MenuBar.js) reads the stock editor. Part of this
 * reading is the same across editors, because they have the same stock parts:
 * the Main controller with its stack of prohibitions and the license result, the stock registry of
 * key combinations, stock windows and the loading mask, the engine keyboard. That part is here;
 * the rights, modes and reasons of its own editor are read by the adapter itself.
 *
 * create(opts) -> {limitReached(), offline(kind), stackEntries(), shortcut(it),
 * keys: {hold, release, beforeCommand}, blocked()}. opts:
 *  - controller(name) — the editor's controller by name (Main, Common.Controllers.Shortcuts)
 *    or null;
 *  - api — the editor's api;
 *  - optional downloadKept() -> boolean — after an edit error Main breaks the edit
 *    session but keeps download and print (api:disconnect with true). The flag is maintained by
 *    the editor adapter, here it is only read.
 *
 * Methods:
 *  - stackEntries() — the active reasons of the Main prohibition stack, each separately
 *    (not only the top one), from bottom to top;
 *  - limitReached() — the limit of simultaneous editing is reached
 *    (Main._state.licenseType — one of LIMIT_TYPES of the license result);
 *  - offline(kind) — no connection: the stack has a reason from OFFLINE_TYPES or the session is broken
 *    for good (Main._state.isDisconnected). kind 'download' — download and print:
 *    after an edit error (downloadKept) the disconnect reason does not interfere with them;
 *  - shortcut(it) — the key combination of the item's command (it.sc) with keys via "+": the first visible one
 *    from the stock registry, as for button hints (Shortcuts.updateShortcutHints), or null;
 *  - keys — the engine keyboard for the menu through the same asc_enableKeyEvents as the stock
 *    Alt hints. While a stock window is open, holding is only released: the window returns the keyboard
 *    itself when it closes. beforeCommand — the same as release;
 *  - blocked() — the editor is covered: a stock window is open or the loading mask is visible. The same
 *    window criterion by which the stock code does not show Alt hints (HintManager).
 */
define([], function () {
    'use strict';

    if (window.Common === undefined) window.Common = {};
    if (Common.UI === undefined) Common.UI = {};
    if (Common.UI.Compact === undefined) Common.UI.Compact = {};

    /* Stack reasons that mean loss of connection. */
    var OFFLINE_TYPES = ['reconnect', 'refresh-file', 'disconnect', 'not-loaded'];
    /* License results that mean the limit of simultaneous editing. */
    var LIMIT_TYPES = ['Connections', 'UsersCount', 'ConnectionsOS', 'UsersCountOS'];

    function modalOpen() {
        var MW = window.Common && Common.Utils && Common.Utils.ModalWindow;
        return !!(MW && typeof MW.isVisible === 'function' && MW.isVisible());
    }

    function create(opts) {
        var o = opts || {};
        var api = o.api || null;
        var keysHeld = false;

        function controller(name) {
            return typeof o.controller === 'function' ? (o.controller(name) || null) : null;
        }

        function main() {
            return controller('Main');
        }

        function stackEntries() {
            var m = main(), stack = m && m.stackDisableActions, out = [];
            if (!stack || typeof stack.length !== 'function') return out;
            for (var i = 0, n = stack.length(); i < n; i++) {
                var e = stack.get(i);
                if (e && e.disable) out.push(e);
            }
            return out;
        }

        function limitReached() {
            var m = main(), state = m && m._state, codes = window.Asc && Asc.c_oLicenseResult;
            if (!state || state.licenseType === undefined || !codes) return false;
            return LIMIT_TYPES.some(function (name) {
                return codes[name] !== undefined && state.licenseType === codes[name];
            });
        }

        function disconnected() {
            var m = main();
            return !!(m && m._state && m._state.isDisconnected);
        }

        function offline(kind) {
            if (disconnected()) return true;
            var kept = kind === 'download' && typeof o.downloadKept === 'function' && !!o.downloadKept();
            return stackEntries().some(function (e) {
                if (OFFLINE_TYPES.indexOf(e.type) < 0) return false;
                return !(kept && e.type === 'disconnect');
            });
        }

        function shortcut(it) {
            if (!it || !it.sc) return null;
            var ctl = controller('Common.Controllers.Shortcuts');
            if (!ctl || typeof ctl.getShortcutsByActionType !== 'function') return null;
            var list;
            try { list = ctl.getShortcutsByActionType(it.sc); } catch (e) { return null; }
            var first = (list || [])[0];
            return first && first.keys && first.keys.length ? first.keys.join('+') : null;
        }

        function hold() {
            if (api && typeof api.asc_enableKeyEvents === 'function') api.asc_enableKeyEvents(false);
            keysHeld = true;
        }

        function release() {
            if (!keysHeld) return;
            keysHeld = false;
            if (modalOpen()) return;
            if (api && typeof api.asc_enableKeyEvents === 'function') api.asc_enableKeyEvents(true);
        }

        function blocked() {
            if (modalOpen()) return true;
            var masks = document.querySelectorAll('.asc-loadmask');
            for (var i = 0; i < masks.length; i++) if (masks[i].getClientRects().length) return true;
            return false;
        }

        return {
            stackEntries: stackEntries,
            limitReached: limitReached,
            offline: offline,
            shortcut: shortcut,
            keys: {hold: hold, release: release, beforeCommand: release},
            blocked: blocked
        };
    }

    var AdapterKit = {
        OFFLINE_TYPES: OFFLINE_TYPES,
        LIMIT_TYPES: LIMIT_TYPES,
        create: create
    };

    Common.UI.Compact.AdapterKit = AdapterKit;
    return AdapterKit;
});
