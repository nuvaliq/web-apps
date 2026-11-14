/*
 * CompactWindows — editor windows in the compact shell on the Air template.
 * Part of the web-apps fork, AGPL-3.0.
 *
 * The module puts a recipe onto an INSTANCE of a stock window: the template and window
 * mark (vo-win vo-win--<id> on .asc-window), the width, the "Apply" caption of the main
 * button and the behavior. The look is drawn by the compact-windows.less styles under
 * body.vo-compact and the mark. A window that is not in the registry and any window in Advanced
 * stay stock.
 *
 * The stock code is not changed. The class prototypes, okButtonText, buttonsParsed and options
 * are shared — by all instances and by Advanced, so writing there would leak past
 * the gate. Only initConfig is the instance's own (Window.js:684), so before the
 * first render the recipe writes only into it, and the rest is done by a render
 * wrapper on the instance itself: right after rendering and before centering
 * (show(), Window.js:826).
 *
 * The module does not import the shell: it is its dependency, that would make a loop. The shell
 * comes as the bind(shell) argument from its own create().
 */
define([], function () {
    'use strict';

    if (window.DE === undefined) window.DE = {};
    if (DE.Views === undefined) DE.Views = {};

    var LABEL = 'vo-win';

    /* Template icons: the checkbox tick, the header X button, the list chevron and
       the tick in a circle for the selected menu item.
       Names are files of the shared set apps/common/main/resources/img/air,
       variables are --vo-win-ico-<name>. */
    var ICONS = ['check', 'close', 'chevron', 'accept'];

    /* A recipe failure of one window would repeat on every opening of it with the same
       cause — we report once per window, like the shell's guarded. */
    var warned = {};

    function labels(recipe) {
        return LABEL + ' ' + LABEL + '--' + recipe.id;
    }

    function pick(win) {
        var list = DE.Views.CompactWindows.RECIPES || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].match(win)) return list[i];
        }
        return null;
    }

    /* Disabled state is read from the node, not from isDisabled(): a window may disable
       the main button through another Button instance on the same node (a fallback path,
       WatermarkSettingsDialog.js:355), and the flag of our object does not know about it. */
    function isOff(btn) {
        return !!btn && (btn.cmpEl.hasClass('disabled') || btn.cmpEl.is(':disabled'));
    }

    function dress(win, recipe) {
        var cfg = win.initConfig;
        var saved = {cls: cfg.cls, width: cfg.width, keydown: cfg.keydowncallback, btn: null, caption: null};

        cfg.cls = (cfg.cls ? cfg.cls + ' ' : '') + labels(recipe);
        if (recipe.width) cfg.width = recipe.width;
        win._voWin = recipe.id;

        var render = win.render;
        win.render = function () {
            /* An exception from the rendering itself is not ours — we do not swallow it: the window
               without it would be broken in the stock code too. */
            var res = render.apply(this, arguments);
            try {
                finish(this, recipe, saved);
            } catch (e) {
                /* Rollback is best effort: the original cause goes outward,
                   not a failure of the rollback itself. */
                try { undress(this, recipe, saved); } catch (ignore) {}
                if (!warned[recipe.id]) {
                    warned[recipe.id] = true;
                    if (window.console && console.warn)
                        console.warn('Компактная оболочка: сбой в «окна компакта: ' + recipe.id + '», ' +
                                     'окно остаётся стоковым.', e);
                }
            }
            return res;
        };
    }

    function finish(win, recipe, saved) {
        var M = DE.Views.CompactWindows;
        var btn = M.primary(win);
        if (btn) {
            saved.btn = btn;
            saved.caption = btn.cmpEl.html();
            btn.setCaption(M.textApply);
        }
        M.guardEnter(win);
        if (typeof recipe.apply === 'function') recipe.apply(win);
    }

    /* "The window stays stock" means to return everything the recipe managed to
       put on: marks, width, caption and the key handler. */
    function undress(win, recipe, saved) {
        var cfg = win.initConfig, $w = win.$window;
        cfg.cls = saved.cls;
        cfg.width = saved.width;
        cfg.keydowncallback = saved.keydown;
        if ($w) {
            $w.removeClass(labels(recipe));
            /* We return the width in the markup only if it is still ours, from the
               template: AdvancedSettingsWindow.render sets its own by
               content (AdvancedSettingsWindow.js:105), and overwriting it with
               the value from the config would break the stock one. */
            if (recipe.width && $w[0].style.width === recipe.width + 'px')
                $w.css('width', typeof saved.width === 'number' ? saved.width + 'px' : '');
        }
        if (saved.btn) saved.btn.setCaption(saved.caption);
    }

    function paintError(field, errors) {
        var $el = field.cmpEl;
        var node = $el && $el.find('.input-error').first();
        if (!node || !node.length) return;

        var id = node.attr('id');
        if (!id) {
            id = 'vo-err-' + field.cid;
            node.attr('id', id);
        }
        var input = field._input && field._input.length ? field._input : $el.find('input').first();
        var by = _.compact((input.attr('aria-describedby') || '').split(/\s+/));
        if (_.indexOf(by, id) < 0) input.attr('aria-describedby', by.concat(id).join(' '));

        node.text(errors.join(' '));
    }

    DE.Views.CompactWindows = _.extend({

        shell: null,

        /* The registry of windows on the template: {id, match(win) → bool, width, apply(win)?}.
           The first recipe with a true match is taken.
           The window class in match is checked for presence: stock windows arrive
           through postLaunchScripts (app_dev.js:209), later than this module. */
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

        bind: function (shell) {
            if (this.shell) return this;
            this.shell = shell;

            Common.NotificationCenter.on('modal:show', shell.guarded('окна компакта: modal:show', function (win) {
                if (!win || !win.initConfig) return;
                if (shell.advanced || !document.body.classList.contains('vo-compact')) return;
                /* The recipe is written only before the first render. A window already
                   rendered earlier (for example, first opened in
                   Advanced) stays as it was: repainting finished
                   markup is a different mechanism, it is not here. */
                if (win._voWin || win.$window) return;

                var recipe = pick(win);
                if (recipe) dress(win, recipe);
            }));
            return this;
        },

        /* Dimming and template icons are variables on the document root.
           The mask opacity is read by the stock code from :root BEFORE modal:show (Window.js:811,
           :822), so it cannot be set from a handler — only beforehand,
           together with vo-compact. The icon addresses are absolute from the document, like
           airBase in Icons.js: a relative url() inside var() would be resolved
           against the consumer's stylesheet. Turning off removes everything that
           was set, and the stock code reads its own values from :root again. */
        setActive: function (on) {
            var style = document.documentElement.style;
            var i;
            if (on) {
                var base = new URL('../../common/main/resources/img/air/', document.baseURI).href;
                style.setProperty('--modal-window-mask-opacity', '0.5');
                for (i = 0; i < ICONS.length; i++)
                    style.setProperty('--vo-win-ico-' + ICONS[i], 'url(' + base + ICONS[i] + '.svg)');
            } else {
                style.removeProperty('--modal-window-mask-opacity');
                for (i = 0; i < ICONS.length; i++)
                    style.removeProperty('--vo-win-ico-' + ICONS[i]);
            }
        },

        primary: function (win) {
            if (!win || !win.$window || typeof win.getFooterButtons !== 'function') return null;
            var btns = win.getFooterButtons() || [];
            for (var i = 0; i < btns.length; i++) {
                if (btns[i] && btns[i].cmpEl && btns[i].cmpEl.hasClass('primary')) return btns[i];
            }
            return null;
        },

        /* The stock code calls onPrimary on Enter, regardless of whether the main button is disabled
           (Window.js:230). The stock code turns true from keydowncallback into
           return false (:209) — the keypress is suppressed entirely. So Enter on
           "Cancel" is let through, like the stock code does (:228): otherwise with "Apply"
           disabled "Cancel" would not work either. */
        guardEnter: function (win) {
            var me = this, cfg = win.initConfig, prev = cfg.keydowncallback;
            if (prev && prev._voEnter) return;

            var guard = function (e) {
                if (prev && prev.apply(this, arguments)) return true;
                if (!e || e.keyCode !== Common.UI.Keys.RETURN) return false;
                var target = $(e.target);
                if (target.hasClass('dlg-btn') && !target.hasClass('primary')) return false;
                return isOff(me.primary(win));
            };
            guard._voEnter = true;
            cfg.keydowncallback = guard;
        },

        /* The template shows a field error as text on the bottom edge, while the stock code
           keeps it only in the icon tooltip (InputField.js:328–418).
           We do not touch the tooltip — on hover it gives the full text — and
           put the text of the same check into .input-error itself and tie it to the
           field via aria-describedby. InputField is not changed: the instance
           methods are wrapped. */
        edgeError: function (field) {
            if (!field || field._voEdge) return field;
            field._voEdge = true;

            var paint = this.shell ? this.shell.guarded('окна компакта: ошибка поля', paintError) : paintError;
            var check = field.checkValidate, show = field.showError;

            field.checkValidate = function () {
                var res = check.apply(this, arguments);
                paint(this, _.isArray(res) ? res : []);
                return res;
            };
            /* showWarning and the reset on input (hideErrorOnInput) go through
               this.showError — the wrapper catches them too. */
            field.showError = function (errors) {
                var res = show.apply(this, arguments);
                paint(this, _.isEmpty(errors) ? [] : errors);
                return res;
            };
            return field;
        },

        /* --- Texts ------------------------------------------------------------ */
        /* The default is English, the locale overrides it with the key
           DE.Views.CompactWindows.textApply. okButtonText is not touched: the edit
           would change "OK" outside compact as well. */

        textApply: 'Apply'

    }, DE.Views.CompactWindows || {});

    return DE.Views.CompactWindows;
});
