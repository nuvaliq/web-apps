/*
 * CompactScript — editing the document from the compact shell with a single engine action.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Items for which the stock api calls are not enough (the page number in all headers and footers,
 * a shape at the caret, paste without formatting) edit the document with a script via
 * api.callCommand — the same path as plugin and macro scripts, without changing
 * the engine. This module is the only door there: it wraps the command body so that
 * the command is either applied entirely as one undo step, or changes
 * nothing, and honestly reports what happened.
 *
 * How the engine executes a script (sdkjs):
 *
 *     api.callCommand(text, true, cb)          common/apiBase.js callCommand
 *       → plugin command queue                 common/plugins.js callCommand
 *       → text check via eval                  common/apiCommon.js isValidJs
 *       → not during a long operation,         common/plugins.js callCommandInternal
 *         then StartAction + CheckActionLock   word/api.js canRunBuilderScript
 *       → eval in strict mode                  common/macros.js _safePluginEval
 *       → FinalizeAction, reply in cb          word/api.js _onEndBuilderScript
 *
 * Hence the rules by which the script is written:
 *  - the body is source text: there are no closures, data arrives through scope (JSON);
 *    Asc inside the script is its own, empty one, so the document is obtained through
 *    Api.GetDocument().Document, and api — through its GetApi();
 *  - the engine does not roll back an exception in the script, and FinalizeAction with an open
 *    nested action only decreases the depth. So the body goes into try, and on
 *    a failure or refusal after edits have started the wrapper itself closes the nested
 *    actions down to the original Action.Depth and calls CancelAction: the engine rolls back
 *    the whole action, the user's previous edit stays;
 *  - the body has only the Builder API and internal methods without their own StartAction,
 *    asc_* are not called; api.Undo() is not used;
 *  - success is only {ok: true} in cb. The engine answers undefined if it did not
 *    execute the script (a long operation, the text failed the check) or canceled the
 *    action on FinalizeAction (a co-author lock, view mode, protection).
 *
 * The command body: function (s) { …; return true; }, where s.Api is the Builder API,
 * s.document is the engine document, s.editor is its api, s.scope is the command data.
 * A command is considered applied only if its body returned true and closed
 * all of its nested actions; any other outcome cancels it entirely.
 */
define([], function () {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    /* Internal engine names that the wrapper relies on; their presence is checked by
       a test against the sdkjs sources. The Builder API (Api.GetDocument, ApiDocument.Document)
       is public and is not on the list. */
    var ENGINE = ['GetApi', 'Action', 'Action.Depth', 'FinalizeAction', 'CancelAction'];

    /* The wrapper that the engine executes around the body. Text only: the free names
       here are the engine script's Api and the arguments. */
    var guard = function (body, scope) {
        var doc = null, depth = 0, ready = false;
        var undo = function () {
            var guardSteps = 0;
            try {
                while (doc.Action.Depth > depth && guardSteps++ < 64) doc.FinalizeAction();
            } catch (e) { /* cancel follows anyway */ }
            try { doc.CancelAction(); } catch (e) { /* nothing to cancel */ }
            return {ok: false};
        };
        try {
            var api = (typeof Api !== 'undefined' && Api && typeof Api.GetDocument === 'function') ? Api.GetDocument() : null;
            doc = api ? api.Document : null;
            if (!doc || typeof doc.GetApi !== 'function' || !doc.GetApi() || !doc.Action
                || typeof doc.Action.Depth !== 'number' || typeof doc.FinalizeAction !== 'function'
                || typeof doc.CancelAction !== 'function')
                return {ok: false};
            depth = doc.Action.Depth;
            ready = true;
            if (body({Api: Api, document: doc, editor: doc.GetApi(), scope: scope}) !== true) return undo();
            if (doc.Action.Depth !== depth) return undo();
            return {ok: true};
        } catch (e) {
            return ready ? undo() : {ok: false};
        }
    };

    /* The script text for callCommand: the same prologue that the engine puts before the function
       (Asc.scope, scope), then the wrapper with the body. */
    function script(body, scope) {
        var data = JSON.stringify(scope === undefined ? {} : scope);
        return 'var Asc = {}; Asc.scope = ' + data + '; var scope = Asc.scope; ('
            + guard.toString() + ')(' + body.toString() + ', scope);';
    }

    DE.Views.CompactScript = {
        ENGINE: ENGINE,
        api: null,

        init: function (api) {
            this.api = api || null;
            return this;
        },

        script: script,

        /* body is the body function (see the header), scope is the data for it. The reply is always
           {ok: boolean}; a refusal throws no exceptions. */
        run: function (body, scope) {
            var api = this.api;
            return new Promise(function (resolve) {
                var settled = false;
                var finish = function (value) {
                    if (settled) return;
                    settled = true;
                    resolve({ok: !!value && value.ok === true});
                };
                /* Without the plugin manager callCommand silently returns and does not call cb. */
                if (!api || typeof api.callCommand !== 'function' || typeof body !== 'function' || !window.g_asc_plugins) {
                    finish();
                    return;
                }
                var text;
                try { text = script(body, scope); } catch (e) { finish(); return; }
                try { api.callCommand(text, true, finish); } catch (e) { finish(); }
            });
        }
    };

    return DE.Views.CompactScript;
});
