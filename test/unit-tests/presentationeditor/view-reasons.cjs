/* Run: node test/unit-tests/presentationeditor/view-reasons.cjs [path to CompactModes.js]
 * Unavailability reasons of the presentation shell in "View" and without the edit right:
 * in "View" the items that edit the presentation and the right panel sections are gray with
 * the mode reason: the stock ribbon mask does not gray the buttons, and availability from
 * the twin is taken only outside "View"; other items live by the twin;
 * without the edit right the zone does not name the mode reason: "No right to
 * edit" is left to the catalog (SlideActions.itemState).
 *
 * The world is a fake stock editor from the shared shell check fixtures
 * (acceptance/mode-harness.cjs); the catalog, the right panel and the show button are
 * the real shell modules. The optional argument is a corrupted copy of the module
 * for a negative control: a copy in which reason() answers only by the edit
 * flag must fail panel_sections_grey_in_view.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./acceptance/mode-harness.cjs');

const VIEW = path.join(h.PE_APP, 'view');
const FILE = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.join(VIEW, 'CompactModes.js');

function viewDir() {
    if (FILE === path.join(VIEW, 'CompactModes.js')) return VIEW;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'view-reasons-'));
    for (const name of h.SHELL_MODULES) if (!h.SHARED_MODULES[name]) fs.copyFileSync(path.join(VIEW, name + '.js'), path.join(dir, name + '.js'));
    fs.copyFileSync(FILE, path.join(dir, 'CompactModes.js'));
    return dir;
}
const DIR = viewDir();

/* Reasons are as the ru locale gives them. */
const VIEW_REASON = 'Недоступно в режиме просмотра';
const RIGHT_REASON = 'Нет права на редактирование';
const SECTIONS = ['slide', 'theme', 'transition', 'animation', 'object'];

function world(opts) {
    const w = h.createWorld(Object.assign({edit: true, comment: true}, opts || {}), {viewDir: DIR});
    const M = w.modules.CompactModes;
    assert.ok(M, 'PE.Views.CompactModes is not loaded: ' + JSON.stringify(w.loadErrors));
    M.textModeLockedView = VIEW_REASON;
    w.modules.SlideActions.textNoEditRight = RIGHT_REASON;
    h.boot(w);
    w.M = M;
    return w;
}

function setMode(w, mode) {
    w.M.setMode(mode);
    w.flush();
}

function editItems(w) {
    const list = h.allItems(h.catalog(w)).filter(x => x.it.edit === true);
    assert.ok(list.length >= 30, 'editing items of the catalog: ' + list.length);
    return list;
}

function states(w, list) {
    return list.map(x => {
        const st = h.itemState(w, x.it);
        return x.section + ' → ' + x.it.t + ': ' + (st.disabled ? '«' + (st.reason || '') + '»' : 'live');
    });
}

const tests = [
    {name: 'edit_items_grey_with_view_reason', fn() {
        const w = world();
        const list = editItems(w);
        /* Twins are alive: the ribbon mask in "View" does not gray them. */
        list.forEach(x => { const t = h.twinOf(w, x.it); if (t) t.setDisabled(false); });
        setMode(w, 'view');
        assert.equal(w.M.mode(), 'view');
        const wrong = states(w, list).filter(s => !s.endsWith('«' + VIEW_REASON + '»'));
        assert.deepEqual(wrong, [], 'every editing item is grey with the mode reason');
        assert.equal(w.M.reason({edit: true}), VIEW_REASON);
        assert.equal(w.M.reason({}), null, 'not an editing item');
        assert.equal(w.M.reason({needRight: true}), null, 'needs the right but does not edit');
        assert.equal(w.M.reason(null), null);
        /* "Show settings" at the show button has the same mode reason. */
        assert.equal(w.shell.showSettingsReason(), VIEW_REASON);
        setMode(w, 'edit');
        assert.deepEqual(states(w, list).filter(s => s.endsWith('«' + VIEW_REASON + '»')), [], 'back to editing: no mode reason');
        assert.equal(w.M.reason({edit: true}), null);
        assert.equal(w.shell.showSettingsReason(), null);
    }},

    {name: 'panel_sections_grey_in_view', fn() {
        const w = world();
        const S = w.modules.SlideSections;
        assert.equal(w.M.reason({k: 'section:theme', section: 'theme', panel: true}), null, 'editing: sections live');
        /* A popup panel open in "Editing" closes on going to "View". */
        assert.equal(S.open('theme'), true, 'editing: the theme section opens');
        assert.equal(S.isOpen(), true);
        setMode(w, 'view');
        for (const k of SECTIONS) {
            assert.equal(w.M.reason({k: 'section:' + k, section: k, panel: true}), VIEW_REASON, 'section ' + k);
            assert.equal(S.reasons[k], VIEW_REASON, 'the right panel reads the reason of ' + k + ' on vo:mode');
        }
        assert.equal(S.isOpen(), false, 'the popup panel stays open in «Просмотр»');
        assert.equal(h.byId(w, 'vo-rp-strip'), null, 'the section strip is back');
        for (const k of SECTIONS) assert.equal(S.open(k), false, 'section ' + k + ' opens in «Просмотр»');
        assert.equal(S.isOpen(), false);
        /* Items that open a right panel section have the same reason, and the panel does not open. */
        const opening = [['Формат', 'Свойства объекта'], ['Вставка', 'Анимация'],
            ['Слайд', 'Фон'], ['Слайд', 'Изменить тему'], ['Слайд', 'Переход']];
        const wrong = [];
        for (const [section, label] of opening) {
            const it = h.findItem(w, section, label);
            const st = h.itemState(w, it);
            if (st.disabled !== true || st.reason !== VIEW_REASON) wrong.push(section + ' → ' + label + ': ' + (st.disabled ? '«' + (st.reason || '') + '»' : 'live'));
            assert.equal(w.modules.SlideActions.exec(it, w.shell), false, section + ' → ' + label + ' does not run');
        }
        assert.deepEqual(wrong, [], 'items opening the right panel are grey in «Просмотр»');
        assert.equal(S.isOpen(), false, 'the right panel stays closed');
        setMode(w, 'edit');
        assert.deepEqual(Object.keys(S.reasons), [], 'editing: no section reasons');
        const props = h.itemState(w, h.findItem(w, 'Формат', 'Свойства объекта'));
        assert.equal(props.disabled, false, 'editing: «Формат → Свойства объекта» is live again');
    }},

    {name: 'non_edit_items_keep_twin_state', fn() {
        const w = world();
        const copy = h.findItem(w, 'Правка', 'Копировать');
        assert.notEqual(copy.edit, true);
        const twin = h.twinOf(w, copy);
        assert.ok(twin, '«Копировать» is bound to a stock control');
        setMode(w, 'view');
        twin.setDisabled(false);
        w.flush();
        const live = h.itemState(w, copy);
        assert.deepEqual([live.disabled, live.reason], [false, null], 'live by its twin');
        twin.setDisabled(true);
        w.flush();
        const st = h.itemState(w, copy);
        assert.equal(st.disabled, true, 'grey by its twin');
        assert.notEqual(st.reason, VIEW_REASON, 'not the mode reason');
        /* Comments follow the commenting right. */
        for (const [section, label] of [['Вставка', 'Комментарий'], ['Совместная работа', 'Комментарии']]) {
            const it = h.findItem(w, section, label);
            assert.notEqual(h.itemState(w, it).reason, VIEW_REASON, section + ' → ' + label);
        }
    }},

    {name: 'reader_reasons_no_right', fn() {
        const r = world({edit: false, comment: false});
        r.M.setMode('view');
        r.flush();
        assert.equal(r.M.mode(), 'edit', 'a reader has nothing to switch');
        assert.equal(r.M.reason({edit: true}), null, 'the mode zone names no reason for a reader');
        assert.equal(r.M.reason({panel: true, edit: true, needRight: true}), null);
        const wrong = states(r, editItems(r)).filter(s => !s.endsWith('«' + RIGHT_REASON + '»'));
        assert.deepEqual(wrong, [], 'reader: editing items are grey with the right reason');
        /* The right is revoked in "View": the reason is the right, not the mode. */
        const w = world();
        setMode(w, 'view');
        w.NC.trigger('collaboration:sharingdeny');
        w.flush();
        assert.equal(w.M.reason({edit: true}), null);
        assert.equal(h.itemState(w, h.findItem(w, 'Правка', 'Вставить')).reason, RIGHT_REASON);
    }}
];

h.run(tests);
