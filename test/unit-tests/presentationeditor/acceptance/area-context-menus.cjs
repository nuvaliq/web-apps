/* Run: node test/unit-tests/presentationeditor/acceptance/area-context-menus.cjs [--only <name>] [--app <directory>]
 * Context menus in the presentation shell are the stock editor menus (DocumentHolderExt)
 * in the shell menu styling: the composition and order are untouched, "Advanced settings …"
 * open stock dialogs and do not touch the right panel.
 */
'use strict';

const assert = require('node:assert/strict');
const h = require('./area-harness.cjs');

const MENU = /\.dropdown-menu\b/;
const ITEM = /(\bli\b|\.menu-item\b|>\s*a\b|\ba\b)[^ ]*$/;
const GALLERY = /#id-docholder-menu-changeslide\b|#id-docholder-menu-changetheme\b|\.menu-layouts\b/;

h.run([
    {
        name: 'context_menus_stay_stock_in_compact_look_with_tile_galleries',
        run() {
            /* The styling is only under body.vo-compact: in the stock interface the menus are as before. */
            h.lessFile('compact-menu.less');
            const rules = h.shellLessRules();
            const menus = rules.filter(r => MENU.test(r.selector));
            assert.ok(menus.some(r => /\.vo-compact\b/.test(r.selector) && r.decls.length),
                'нет оформления штатных меню (.dropdown-menu) под body.vo-compact');
            assert.deepEqual(menus.filter(r => !/\.vo-compact\b/.test(r.selector)).map(r => r.selector), [],
                'правила меню действуют вне оболочки');

            /* The composition and order are stock: items are neither hidden nor rearranged by styles. */
            const items = menus.filter(r => ITEM.test(r.selector));
            assert.deepEqual(items.filter(h.hides).map(r => r.selector), [], 'стили оболочки прячут пункты штатных меню');
            const reorder = menus.filter(r => r.decls.some(d => d.prop === 'order' ||
                (d.prop === 'flex-direction' && /reverse/.test(d.value))));
            assert.deepEqual(reorder.map(r => r.selector), [], 'стили оболочки переставляют пункты штатных меню');

            /* "Change layout ▸" and "Change theme ▸" are stock galleries with tiles. */
            const galleries = rules.filter(r => GALLERY.test(r.selector));
            assert.deepEqual(galleries.filter(h.hides).map(r => r.selector), [], 'стили оболочки прячут галереи макетов или тем');
            const listed = galleries.filter(r => /\.item\b|\.layout\b|\.style\b/.test(r.selector) &&
                r.decls.some(d => d.prop === 'width' && /^100%/.test(d.value)));
            assert.deepEqual(listed.map(r => r.selector), [], 'стили оболочки превращают плитки галереи в список');

            /* A right click is handled by the stock editor: the shell does not replace its menu,
               nor change the composition, order and visibility of items. */
            const env = h.createEnv();
            env.start();
            for (const {name, menu, items} of env.stockMenus) {
                assert.equal(env.dh[name], menu, 'оболочка подменила штатное меню ' + name);
                assert.deepEqual(menu.items.map(i => i._tag), items.map(i => i._tag), 'оболочка изменила состав или порядок ' + name);
            }
            const where = [['none', 'slideMenu'], ['text', 'textMenu'], ['shape', 'pictureMenu'], ['image', 'pictureMenu'],
                ['chart', 'pictureMenu'], ['table', 'tableMenu']];
            for (const [kind, name] of where) {
                env.select(kind);
                env.stockCalls.length = 0;
                env.opened.length = 0;
                env.touches.length = 0;
                env.fire('asc_onContextMenu', {menu: name, type: 1});
                env.drain();
                assert.equal(env.count('DocumentHolder.onContextMenu'), 1, 'правый щелчок (' + kind + ') не дошёл до штатного обработчика');
                assert.deepEqual(env.opened, ['DocumentHolder:' + name], 'правый щелчок (' + kind + ') открыл не штатное ' + name);
                assert.deepEqual(env.touches.filter(t => /^DocumentHolder:/.test(t.tag)).map(t => t.tag + ' ' + t.op), [],
                    'оболочка меняет видимость или доступность пунктов штатного меню ' + name);
            }
        }
    },
    {
        name: 'advanced_items_open_stock_dialogs_and_leave_right_panel_alone',
        run() {
            const env = h.createEnv();
            env.start();
            const cases = [
                ['shape', 'menuShapeAdvanced', 'DocumentHolder.onShapeAdvanced'],
                ['image', 'menuImageAdvanced', 'DocumentHolder.onImageAdvanced'],
                ['table', 'menuTableAdvanced', 'DocumentHolder.onTableAdvanced'],
                ['chart', 'menuChartAdvanced', 'DocumentHolder.onChartAdvanced'],
                ['text', 'menuParagraphAdvanced', 'DocumentHolder.onParagraphAdvanced']
            ];
            const pass = label => {
                for (const [kind, item, handler] of cases) {
                    env.select(kind);
                    const before = env.current();
                    env.stockCalls.length = 0;
                    env.panes.length = 0;
                    env.dh[item].click();
                    env.drain();
                    assert.equal(env.count(handler), 1, label + ': «' + env.dh[item].caption + '» не открыл штатный диалог');
                    assert.equal(env.current(), before, label + ': «' + env.dh[item].caption + '» сменил раздел правой панели');
                    assert.deepEqual(env.panes.map(p => p.via), [], label + ': «' + env.dh[item].caption + '» открыл вкладку правой панели');
                    assert.equal(env.count('RightMenu.onDoubleClickOnObject') + env.count('RightMenu.SetActivePane'), 0,
                        label + ': «' + env.dh[item].caption + '» дёрнул правую панель');
                }
            };
            env.select('none');
            const closed = env.current();
            pass(closed ? 'панель на разделе ' + closed : 'панель закрыта');

            /* The panel is open on "Slide settings": its items neither switch nor close it. */
            env.select('none');
            const settings = env.findItem('Слайд', 'Фон');
            env.runItem(settings);
            assert.equal(env.current(), 'slide', '«Слайд → Фон» не открыл раздел «Параметры слайда»');
            pass('панель на «Параметрах слайда»');
        }
    }
]);
