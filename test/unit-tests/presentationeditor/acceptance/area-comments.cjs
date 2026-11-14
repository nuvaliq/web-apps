/* Run: node test/unit-tests/presentationeditor/acceptance/area-comments.cjs [--only <name>] [--app <directory>]
 * Comments in the presentation shell: the stock comments panel on the left, before the thumbnail
 * strip, opens with the stock panel button; adding is the stock command gated by the commenting
 * right, including without the edit right, and the panel is open while doing so.
 */
'use strict';

const assert = require('node:assert/strict');
const h = require('./area-harness.cjs');

const LEFT = /#left-menu\b|\.left-panel\b|#left-panel-comments\b/;

function panelOpen(env) {
    return env.leftView.btnComments.pressed === true && env.leftView.panelComments.open === true;
}

function closePanel(env) {
    if (env.leftView.btnComments.pressed) {
        env.leftView.btnComments.toggle(false, true);
        env.leftView.onBtnMenuClick(env.leftView.btnComments);
    }
    env.stockCalls.length = 0;
    env.notes.length = 0;
    assert.equal(panelOpen(env), false, 'панель комментариев не закрылась штатной кнопкой');
}

h.run([
    {
        name: 'comments_panel_opens_on_the_left_through_stock_panel',
        run() {
            /* The left area is stock, in its place before #editor_sdk: styles neither hide it
               nor rearrange it. */
            h.lessFile('compact-areas.less');
            const rules = h.shellLessRules();
            const left = rules.filter(r => LEFT.test(r.selector));
            assert.ok(left.some(r => /\.vo-compact\b/.test(r.selector) && r.decls.length), 'нет стилей левой области (#left-menu) под body.vo-compact');
            assert.deepEqual(left.filter(r => /\.left-panel\b|#left-panel-comments\b/.test(r.selector) && h.hides(r)).map(r => r.selector), [],
                'стили оболочки прячут штатную панель комментариев');
            const moved = rules.filter(r => /#left-menu\b|#editor-container\b|#editor_sdk\b|#viewport-hbox-layout\b/.test(r.selector) &&
                r.decls.some(d => d.prop === 'order' || (d.prop === 'flex-direction' && /reverse/.test(d.value)) || (d.prop === 'float' && /right/.test(d.value))));
            assert.deepEqual(moved.map(r => r.selector), [], 'стили оболочки ставят левую область не перед лентой миниатюр');

            const Left = h.createEnv().module('CompactLeft');
            const panels = Left.STOCK_PANELS;
            const names = Array.isArray(panels) ? panels.map(p => (typeof p === 'string' ? p : p && (p.name || p.key || p.menu))) : Object.keys(panels || {});
            assert.ok(names.indexOf('comments') >= 0, 'в CompactLeft.STOCK_PANELS нет панели комментариев');

            /* A stock panel call (showMenu): there is no icon column in the shell, and the shell opens it
               with the same stock panel button. */
            const env = h.createEnv();
            env.start();
            closePanel(env);
            env.leftView.showMenu('comments');
            env.drain();
            assert.ok(panelOpen(env), 'штатный вызов showMenu(\'comments\') не открыл панель комментариев');
            assert.ok(env.stockCalls.some(c => c.name === 'LeftMenu.onBtnMenuClick' && c.args[0] === env.leftView.btnComments),
                'панель открыта мимо штатной кнопки панели комментариев');
            assert.equal(env.count('Common.Views.Comments:new'), 0, 'оболочка построила свою панель комментариев');
            assert.equal(env.document.getElementById('left-panel-comments').parentNode.parentNode.id, 'left-menu',
                'оболочка перенесла узел штатной панели комментариев');
        }
    },
    {
        name: 'comments_toggle_from_toolbar_and_review_and_open_on_slide_marker',
        run() {
            const env = h.createEnv();
            env.start();

            /* "Collaboration → Comments": open, repeat to close. */
            const review = env.findItem('Совместная работа', 'Комментарии');
            closePanel(env);
            env.runItem(review);
            assert.ok(panelOpen(env), '«Совместная работа → Комментарии» не открыл панель');
            env.runItem(review);
            assert.equal(panelOpen(env), false, 'повторный «Совместная работа → Комментарии» не закрыл панель');
            assert.equal(env.stockCalls.filter(c => c.name === 'LeftMenu.onBtnMenuClick').length, 2,
                '«Совместная работа → Комментарии» переключает панель мимо штатной кнопки');

            /* "Comment" on the toolbar is the same toggle. */
            const button = () => {
                const bar = env.document.getElementById('vo-toolbar');
                assert.ok(bar, 'нет ряда панели инструментов #vo-toolbar');
                const found = env.byLabel(/^комментари[йи]$/).filter(el => bar.contains(el));
                assert.ok(found.length, 'на панели инструментов нет кнопки «Комментарий»');
                return found[0];
            };
            closePanel(env);
            button().click();
            env.drain();
            assert.ok(panelOpen(env), '«Комментарий» на панели не открыл панель комментариев');
            button().click();
            env.drain();
            assert.equal(panelOpen(env), false, 'повторный «Комментарий» на панели не закрыл панель');

            /* The comment icon on a slide at the anchor point opens the panel. */
            closePanel(env);
            env.fire('asc_onShowComment', ['c1'], 120, 80, 100, {}, true);
            env.drain();
            assert.equal(env.count('Comments.onApiShowComment'), 1, 'щелчок по значку не дошёл до штатного обработчика комментариев');
            assert.ok(panelOpen(env), 'щелчок по значку комментария на слайде не открыл панель');

            /* A click on a comment in the panel is a stock jump to the slide, the shell does not intercept it. */
            env.stockCalls.length = 0;
            env.apiCalls.length = 0;
            env.commentsView.trigger('comment:show', 'c1', false);
            env.drain();
            assert.equal(env.count('Comments.onShowComment'), 1, 'щелчок по комментарию не дошёл до штатного обработчика');
            assert.deepEqual(env.ownApi(/selectComment|showComment|GoToPage|goToSlide/i).map(c => c.name), [],
                'переход к слайду комментария идёт не штатным путём');
        }
    },
    {
        name: 'add_comment_by_comment_right_without_edit_right_opens_panel',
        run() {
            const rights = [
                ['с правом правки', {}],
                ['без права правки', {isEdit: false, canEdit: false}]
            ];
            for (const [who, options] of rights) {
                const env = h.createEnv({options});
                env.start();
                env.select('shape');
                const reader = options.isEdit === false;
                const paths = [
                    ['«Вставка → Комментарий»', env.findItem('Вставка', 'Комментарий')],
                    ['«Добавить комментарий» правого щелчка', reader ? env.dh.menuViewAddComment : env.dh.menuAddCommentPara]
                ];
                for (const [label, target] of paths) {
                    const stockItem = typeof target.click === 'function' && /^DocumentHolder:/.test(target._tag || '');
                    if (!stockItem) assert.equal(!!env.itemState(target).disabled, false, who + ': ' + label + ' недоступен при праве комментирования');
                    closePanel(env);
                    if (stockItem) target.click();
                    else env.runItem(target);
                    env.drain();
                    assert.equal(env.count('Comments.addDummyComment'), 1, who + ': ' + label + ' не вызвал штатное добавление комментария');
                    assert.deepEqual(env.ownApi(/comment/i).map(c => c.name), [], who + ': ' + label + ' добавляет комментарий мимо штатной команды');
                    assert.ok(panelOpen(env), who + ': после ' + label + ' панель комментариев не открыта');
                }
            }

            /* Without the commenting right adding is not performed. */
            const env = h.createEnv({options: {canComments: false, isEdit: false, canEdit: false}});
            env.start();
            env.select('shape');
            for (const [section, caption] of [['Вставка', 'Комментарий']]) {
                const it = env.findItem(section, caption, {optional: true});
                if (!it) continue;
                const st = env.itemState(it);
                if (!st.disabled) env.runItem(it);
                assert.equal(env.count('Comments.addDummyComment'), 0, 'без права комментирования «' + section + ' → ' + caption + '» добавляет комментарий');
            }
        }
    }
]);
