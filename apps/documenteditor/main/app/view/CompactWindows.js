/*
 * CompactWindows — editor windows in the compact shell on the Air template.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The mechanics and the template are shared by the editors
 * (common/main/lib/view/compact/Windows.js, less/compact/windows.less): a recipe
 * is put onto an INSTANCE of a stock window — the template and window mark (vo-win
 * vo-win--<id> on .asc-window), the width, the "Apply" caption of the main button
 * and the behavior. A window that is not in the registry and any window in Advanced
 * stay stock. Here is the document registry: four windows of its own. Shared windows
 * (symbol, table, language and others) are not in the registry and stay stock.
 *
 * The module does not import the shell: it is its dependency, that would make a loop. The shell
 * comes as the bind(shell) argument from its own create().
 */
define([
    'common/main/lib/view/compact/Windows'
], function () {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    var LABEL = Common.UI.Compact.Windows.LABEL;

    DE.Views.CompactWindows = Common.UI.Compact.Windows.create(_.extend({

        RECIPES: [
            /* "Page size". No behavior of its own — the look is entirely by styles
               (.vo-win--pagesize), hence no apply. The same class opens
               the print "Custom size" as well (controller/Print.js:345). */
            {
                id: 'pagesize',
                match: function (win) {
                    return !!DE.Views.PageSizeDialog && win instanceof DE.Views.PageSizeDialog;
                },
                width: 420
            },
            /* "Columns". The table, disabled rows, limits and the width calculation are
               stock, the look is by styles (.vo-win--columns). The same class is
               opened by the compact "Layout → Columns" (DocumentActions.columns) and
               the context menu (DocumentHolderExt, type == 'columns'). */
            {
                id: 'columns',
                match: function (win) {
                    return !!DE.Views.CustomColumnsDialog && win instanceof DE.Views.CustomColumnsDialog;
                },
                width: 420,
                /* The table height in the template is by rows, and the rows come from
                   setSettings already after show(): both entry points call it right after
                   (DocumentActions.dialog, DocumentHolderExt). By that time the stock code
                   had centered the window on an empty list (_centre in
                   show), and with one to three rows it sat below the middle.
                   So right after setSettings the window is centered once more —
                   with the stock setPosition() without coordinates. This is the same task as
                   show(), before the first frame of its animation, and the window does not jump.
                   We do not center on later changes of the count: a window
                   under the hand must not move. The wrapper is on the instance, a failure of
                   centering is silenced by the shell's guarded, the stock setSettings
                   runs in any case. */
                apply: function (win) {
                    var M = DE.Views.CompactWindows, set = win.setSettings;
                    if (typeof set !== 'function') return;

                    var centre = function (w) { w.setPosition(); };
                    if (M.shell) centre = M.shell.guarded('окна компакта: columns, центр окна', centre);

                    win.setSettings = function () {
                        var res = set.apply(this, arguments);
                        if (this.$window && this.isVisible()) centre(this);
                        return res;
                    };
                }
            },
            /* "Delete cells". The same stock OptionsDialog also opens
               "Update table of contents" (Links.js:561) — that one stays stock,
               so the window is recognized by its items: exactly left, row, col and in
               this order, as at the entry from the table context menu
               (DocumentHolderExt.js:2337). The items are from initConfig, which is the
               instance's own: options of OptionsDialog is a prototype object
               (OptionsDialog.js:54), and it keeps the values of the previous window.
               The behavior is stock, the recipe only adds the 3 × 3 pictures. */
            (function () {
                var KINDS = ['left', 'row', 'col'];

                /* Nine cells in rows from top to bottom; the deleted ones have their own
                   class, the color and the shift arrow are drawn by the styles (.vo-win-cells).
                   The cells are not svg: the template and stock styles treat an svg inside the
                   switch as its box (.radiobox > svg, .radiobox svg). */
                function picture(kind) {
                    var html = '';
                    for (var r = 0; r < 3; r++) {
                        for (var c = 0; c < 3; c++) {
                            var del = (kind === 'left' && r === 1 && c === 1) ||
                                      (kind === 'row' && r === 1) || (kind === 'col' && c === 1);
                            html += del ? '<i class="vo-win-cells-del"></i>' : '<i></i>';
                        }
                    }
                    return '<span class="vo-win-cells vo-win-cells--' + kind + '" aria-hidden="true">' + html + '</span>';
                }

                return {
                    id: 'cells',
                    match: function (win) {
                        var items = win && win.initConfig && win.initConfig.items;
                        return !!(Common.Views && Common.Views.OptionsDialog) && win instanceof Common.Views.OptionsDialog &&
                            _.isArray(items) && items.length === KINDS.length &&
                            _.every(KINDS, function (kind, i) { return !!items[i] && items[i].value === kind; });
                    },
                    width: 420,
                    /* The picture goes inside div.radiobox between the box (the stock
                       svg) and the caption: a click on it is
                       a click on the switch, and the RadioBox caption was remembered at
                       construction (RadioBox.js:125), so the insertion does not interfere with it.
                       All three switches are checked first, then the
                       insertion: rolling back the recipe does not remove the pictures, and a window
                       that stays stock must not get them. */
                    apply: function (win) {
                        var radios = win.radio, found = [], i;
                        if (!_.isArray(radios) || radios.length !== KINDS.length)
                            throw new Error('нет трёх переключателей left / row / col');

                        for (i = 0; i < radios.length; i++) {
                            var radio = radios[i],
                                kind = radio && radio.options && radio.options.value,
                                $label = radio && radio.$label,
                                $box = $label && $label.length ? $label.children('svg').first() : null;
                            if (kind !== KINDS[i] || !$box || !$box.length)
                                throw new Error('переключатель ' + (i + 1) + ': не «' + KINDS[i] + '» или без коробки');
                            /* We do not put a second picture into the same switch. */
                            if (!$label.children('.vo-win-cells').length) found.push({$box: $box, kind: kind});
                        }

                        for (i = 0; i < found.length; i++) found[i].$box.after(picture(found[i].kind));
                    }
                };
            }()),
            /* "Create new style". The field and the list are stock, the look is by styles
               (.vo-win--style); the recipe disables "Apply" while there is no title.
               A click on a disabled button does not reach onBtnClick
               (StyleTitleDialog.js:97): setDisabled sets the node's
               disabled attribute (Button.js:709–725). Enter is suppressed by guardEnter. So
               the stock empty-title error (StyleTitleDialog.js:143) does not
               appear. The window is opened only by "Format as style →
               Create new style" (Toolbar.js:2835 ← DocumentHolderExt.js:1248,
               :2131). */
            {
                id: 'style',
                match: function (win) {
                    return !!DE.Views.StyleTitleDialog && win instanceof DE.Views.StyleTitleDialog;
                },
                width: 420,
                /* We read the title from the field node, not via getValue(): that returns
                   the value of the last blur or Enter (InputField.js:198, :320),
                   and the window has no validateOnChange that would update it on input.
                   Whitespace also means "no title", as in the stock check
                   (StyleTitleDialog.js:85–94). Recalculation — immediately (the window
                   opens with an empty field) and on every input of the node: typing,
                   paste, cut, undo. The check first, then the
                   changes: rolling back the recipe does not remove the handler, and a window
                   that stays stock must not get a disabled
                   "OK". The first recalculation is without the wrapper: its failure is a recipe failure,
                   and the window rolls back to stock. The later ones go after
                   the render wrapper — their failure is silenced by the shell's guarded, like the window
                   centering for 'columns'. */
                apply: function (win) {
                    var M = DE.Views.CompactWindows,
                        $input = win.inputTitle && win.inputTitle._input,
                        btn = M.primary(win);
                    if (!$input || !$input.length) throw new Error('нет поля названия');
                    if (!btn || typeof btn.setDisabled !== 'function') throw new Error('нет главной кнопки');

                    var sync = function () {
                        btn.setDisabled(!String($input.val() || '').trim());
                    };
                    sync();
                    $input.on('input.' + LABEL, M.shell ? M.shell.guarded('окна компакта: style, гашение «Применить»', sync) : sync);
                }
            }
        ],

        /* The main button of a window on the template is "Apply". okButtonText is not
           touched: the edit would change "OK" outside compact as well. */
        primaryCaption: function () { return this.textApply; },

        /* --- Texts ------------------------------------------------------------ */
        /* The default is English, the locale overrides it with the key
           DE.Views.CompactWindows.textApply. */

        textApply: 'Apply'

    }, DE.Views.CompactWindows || {}));

    return DE.Views.CompactWindows;
});
