/*
 * Shells — "Compact" shells registered by the editors.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * Shared controllers (lib/controller) work in all editors and do not know whether
 * an editor has its own compact shell and whether it is selected. The editor's shell
 * registers itself here, and the shared controller asks this registry rather than the
 * editor's namespace.
 *
 * register(shell) -> shell. A shell entry:
 *  - wanted(config) -> boolean — the shell is selected in the editor config; without an argument
 *    the shell reads its own editor's config itself;
 *  - personalReviewFollowsShared — the personal review mode, turned off in the shell,
 *    follows the document's shared flag: the engine's local flag is null, not false;
 *  - forAllText() -> string — why the "turn off for myself" option is disabled while
 *    review is turned on for everyone.
 *
 * current() -> entry or null — the first registered shell that is selected now.
 * A failure in wanted() means "not selected": the stock interface stays.
 */
define([], function () {
    'use strict';

    if (window.Common === undefined) window.Common = {};
    if (Common.UI === undefined) Common.UI = {};
    if (Common.UI.Compact === undefined) Common.UI.Compact = {};

    if (Common.UI.Compact.Shells) return Common.UI.Compact.Shells;

    var list = [];

    var Shells = {
        register: function (shell) {
            if (shell && typeof shell.wanted === 'function' && list.indexOf(shell) < 0) list.push(shell);
            return shell;
        },

        current: function () {
            for (var i = 0; i < list.length; i++) {
                var picked = false;
                try { picked = !!list[i].wanted(); } catch (e) { picked = false; }
                if (picked) return list[i];
            }
            return null;
        }
    };

    Common.UI.Compact.Shells = Shells;
    return Shells;
});
