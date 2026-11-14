/* Run: node test/unit-tests/presentationeditor/acceptance/area-canvas.cjs [--only <name>] [--app <directory>]
 * The presentation shell workspace: the thumbnail strip, "View → Slides" and "View → Notes",
 * the notes field. The strip, slide and notes stay engine nodes: the shell colors them,
 * shows and hides them with stock commands and attaches no handlers of its own to them.
 */
'use strict';

const assert = require('node:assert/strict');
const h = require('./area-harness.cjs');

const THUMBS = /#id_panel_thumbnails\b|#id_thumbnails_background\b|#id_thumbnails\b|#id_panel_thumbnails_split\b/;
const NOTES = /#id_panel_notes\b|#id_notes\b|#id_notes_overlay\b/;
const SLIDE_COMMANDS = /slide|asc_hideslides|asc_moveselectedslides|changelayout|changetheme/i;

h.run([
    {
        name: 'thumbnails_stay_stock_in_shell_palette_and_slide_commands_cover_selection',
        run() {
            /* The white strip card is a rule on the engine node under body.vo-compact; the strip is not hidden
               or disabled by shell rules. */
            const rules = h.shellLessRules();
            const thumbs = rules.filter(r => THUMBS.test(r.selector));
            assert.ok(thumbs.some(r => /\.vo-compact\b/.test(r.selector) && r.decls.length),
                'нет правила оформления ленты миниатюр (#id_panel_thumbnails) под body.vo-compact');
            const hidden = thumbs.filter(h.hides);
            assert.deepEqual(hidden.map(r => r.selector), [], 'стили оболочки прячут или отключают ленту миниатюр');

            const env = h.createEnv();
            const shell = env.start();

            /* The engine takes the strip colors from the skin: the values are from #editor_sdk under the shell, not from the body theme. */
            assert.equal(typeof shell.applyCanvasSkin, 'function', 'нет CompactShell.applyCanvasSkin()');
            shell.applyCanvasSkin();
            env.drain();
            const skins = env.apiCalls.filter(c => c.name === 'asc_setSkin');
            assert.ok(skins.length, 'оболочка не передала движку скин холста (asc_setSkin)');
            const skin = skins[skins.length - 1].args[0] || {};
            for (const key of ['background-toolbar', 'border-preview-select', 'border-preview-hover', 'text-normal']) {
                assert.equal(String(skin[key] || '').trim(), {
                    'background-toolbar': '#ffffff', 'border-preview-select': '#3a83db',
                    'border-preview-hover': '#c9d6e8', 'text-normal': '#1f2329'
                }[key], 'цвет ленты ' + key + ' не взят с #editor_sdk оболочки');
            }

            /* There are no mouse handlers of its own on the strip: dragging and selection belong to the engine. */
            for (const id of ['id_panel_thumbnails', 'id_thumbnails', 'id_thumbnails_background', 'id_panel_thumbnails_split'])
                assert.equal(env.listenersOn(id), 0, 'оболочка повесила обработчики на #' + id);

            /* "Slide" commands go via stock handlers that take the whole strip selection. */
            const cases = [
                ['Дублировать слайд', ['DocumentHolder.onDuplicateSlide', 'Toolbar.onDuplicateSlide']],
                ['Удалить слайд', ['DocumentHolder.onDeleteSlide']],
                ['Скрыть слайд', ['DocumentHolder.onSlideHide']]
            ];
            for (const [caption, stock] of cases) {
                const it = env.findItem('Слайд', caption);
                env.stockCalls.length = 0;
                env.apiCalls.length = 0;
                env.runItem(it);
                const hits = env.stockCalls.filter(c => stock.indexOf(c.name) >= 0).length;
                assert.equal(hits, 1, '«Слайд → ' + caption + '»: штатный обработчик вызван ' + hits + ' раз');
                assert.deepEqual(env.ownApi(SLIDE_COMMANDS).map(c => c.name), [],
                    '«Слайд → ' + caption + '»: оболочка сама правит слайды через api');
            }
        }
    },
    {
        name: 'view_slides_and_notes_toggle_stock_controls_and_marks_follow_state',
        run() {
            const env = h.createEnv();
            env.start();
            const slides = env.findItem('Вид', 'Слайды');
            const notes = env.findItem('Вид', 'Заметки');

            /* "Slides": the stock left menu strip button and its controller; the mark is by the engine. */
            assert.equal(env.checked(slides), true, 'лента показана, а отметка «Вид → Слайды» снята');
            env.runItem(slides);
            let calls = env.stockCalls.filter(c => c.name === 'LeftMenu.onShowTumbnails');
            assert.equal(calls.length, 1, '«Вид → Слайды» не прошёл через штатный LeftMenu.onShowTumbnails');
            assert.equal(calls[0].args[1], false, '«Вид → Слайды» не прячет показанную ленту');
            env.fire('asc_onThumbnailsShow', false);
            env.drain();
            assert.equal(env.checked(slides), false, 'лента спрятана, а отметка «Вид → Слайды» стоит');
            env.runItem(slides);
            calls = env.stockCalls.filter(c => c.name === 'LeftMenu.onShowTumbnails');
            assert.equal(calls.length, 2, 'повторный «Вид → Слайды» не прошёл через штатный обработчик');
            assert.equal(calls[1].args[1], true, 'повторный «Вид → Слайды» не возвращает ленту');
            env.fire('asc_onThumbnailsShow', true);
            env.drain();
            assert.equal(env.checked(slides), true, 'лента возвращена, а отметка «Вид → Слайды» снята');

            /* "Notes": the stock "View" tab checkbox and its handler. */
            assert.equal(env.checked(notes), true, 'заметки показаны, а отметка «Вид → Заметки» снята');
            env.runItem(notes);
            const n = env.stockCalls.filter(c => c.name === 'ViewTab.onNotesChange');
            assert.equal(n.length, 1, '«Вид → Заметки» не прошёл через штатный флажок заметок');
            assert.equal(n[0].args[1], false, '«Вид → Заметки» не прячет показанные заметки');
            assert.equal(env.checked(notes), false, 'заметки спрятаны, а отметка «Вид → Заметки» стоит');
            /* The stock state changed without the shell (a setting, another path): the mark follows it. */
            env.viewTab.chNotes.setValue(true, true);
            assert.equal(env.checked(notes), true, 'отметка «Вид → Заметки» не следует штатному состоянию');

            assert.deepEqual(env.ownApi(/ShowThumbnails|ShowNotes/).map(c => c.name), [],
                'оболочка сама зовёт движок, минуя штатные обработчики «Слайдов» и «Заметок»');
        }
    },
    {
        name: 'notes_stay_stock_field_with_stock_hint_and_draggable_border',
        run() {
            /* The field hint is the editor stock string, the shell has none of its own. */
            assert.equal(h.ru()['PE.Controllers.Main.txtAddNotes'], 'Нажмите, чтобы добавить заметки',
                'штатной подсказки заметок нет в ru.json');
            h.shellSource('CompactShell');
            for (const src of h.existingShellSources())
                assert.ok(!/txtAddNotes|Click to add notes/.test(src.text), src.file + ' подменяет штатную подсказку заметок');

            /* A white notes card over the engine built-in style; the rules do not hold the height. */
            const rules = h.shellLessRules();
            const notes = rules.filter(r => NOTES.test(r.selector));
            assert.ok(notes.some(r => /\.vo-compact\b/.test(r.selector) &&
                r.decls.some(d => /^background(-color)?$/.test(d.prop) && d.important)),
            'нет белой карточки заметок под body.vo-compact с фоном !important поверх встроенного стиля');
            assert.deepEqual(notes.filter(h.hides).map(r => r.selector), [], 'стили оболочки прячут или отключают заметки');
            const fixed = rules.filter(r => /#id_panel_notes\b|#id_main_parent\b|#id_main\b/.test(r.selector) &&
                r.decls.some(d => /^(height|max-height)$/.test(d.prop) && d.important));
            assert.deepEqual(fixed.map(r => r.selector), [], 'стили оболочки закрепляют высоту заметок — граница не тянется');
            const blocked = rules.filter(r => /#id_main_parent\b|#id_main\b|#editor_sdk\b/.test(r.selector) && h.hides(r));
            assert.deepEqual(blocked.map(r => r.selector), [], 'стили оболочки отключают холст с границей заметок');

            /* At start the shell does not hide the notes and attaches no handlers of its own to their nodes and border. */
            const env = h.createEnv();
            env.start();
            assert.deepEqual(env.boot.apiCalls.filter(c => !c.stock && /Notes/.test(c.name)).map(c => c.name), [],
                'оболочка на старте сама переключает заметки через api');
            for (const id of ['id_panel_notes', 'id_notes', 'id_notes_overlay', 'id_main_parent', 'id_main'])
                assert.equal(env.listenersOn(id), 0, 'оболочка повесила обработчики на #' + id);
        }
    }
]);
