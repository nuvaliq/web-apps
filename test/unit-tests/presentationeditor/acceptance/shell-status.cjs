/* Run: node test/unit-tests/presentationeditor/acceptance/shell-status.cjs [--only <name>]
 * Status bar of the presentation shell for a user with the edit right: slide
 * counter, language, spell check and the two fit buttons, all on the stock controls.
 */
'use strict';

const assert = require('node:assert/strict');
const H = require('./shell-harness.cjs');

const ROLES = {
    language: /^Statusbar\.btnLanguage/,
    spelling: /^Statusbar\.btnSpelling|^Review\.btnsSpelling/,
    fitWidth: /^Statusbar\.btnZoomToWidth/,
    fitSlide: /^Statusbar\.btnZoomToPage/
};
const FORBIDDEN = [
    /^Statusbar\.btnZoom(Up|Down)/, /^ViewTab\.cmbZoom/, /btnPreview/, /^ToolbarCtl$/,
    /^api$/
];
const FORBIDDEN_API = /zoom|Zoom|Demonstration|StartDemo|asc_setSpellCheck|asc_setDefaultLanguage|put_TextPrLang|asc_setTextPrLang/;

function leaf(root, text) {
    const all = [root].concat(root.querySelectorAll('*'));
    return all.filter(e => H.norm(e.textContent).includes(text)).pop() || null;
}

async function statusBarForEditorHasCounterLanguageSpellingAndFitOnly() {
    const w = await H.makeWorld();
    w.bootOrExplain();
    w.requireCss();
    const st = w.must('vo-status');
    assert.ok(!w.hidden(st), '#vo-status is hidden');

    const counter = leaf(st, 'Слайд 2 из 5');
    assert.ok(counter && !w.hidden(counter), 'status bar does not show "Слайд 2 из 5" (shows: ' + H.norm(st.textContent) + ')');
    w.fire('asc_onCurrentPage', 3);
    w.drain(500);
    assert.ok(leaf(st, 'Слайд 4 из 5'), 'slide counter does not follow the engine (shows: ' + H.norm(st.textContent) + ')');
    assert.ok(!/\d+\s?%/.test(st.textContent), 'status bar shows a zoom value');

    const found = {};
    const stray = [];
    for (const ctl of H.controlsIn(w, st)) {
        const start = w.calls.length;
        w.click(ctl);
        w.doc.dispatchEvent(new H.DomEvent('keydown', {bubbles: true, key: 'Escape', keyCode: 27, which: 27}));
        w.drain(300);
        const calls = w.calls.slice(start);
        const bad = calls.filter(c => FORBIDDEN.some(re => re.test(c.who)) && (c.who !== 'api' || FORBIDDEN_API.test(c.what)));
        if (bad.length) stray.push(H.describe(ctl) + ' -> ' + bad.map(c => c.who + ' ' + c.what).join(', '));
        for (const [role, re] of Object.entries(ROLES)) if (calls.some(c => re.test(c.who)) && !found[role]) found[role] = ctl;
    }
    assert.deepEqual(stray, [], 'status bar controls reach zoom or the slide show');
    for (const role of Object.keys(ROLES)) assert.ok(found[role], 'no status bar control works through the stock ' + role + ' control');

    const text = el => H.norm(el.textContent) || el.getAttribute('title') || el.getAttribute('aria-label') || '';
    assert.equal(text(found.spelling), 'Проверка орфографии', 'spell check toggle caption');
    assert.equal(text(found.fitWidth), 'По ширине', '"fit to width" caption');
    assert.equal(text(found.fitSlide), 'По размеру слайда', '"fit to slide" caption');

    const seq = [leaf(st, 'Слайд 4 из 5'), found.language, found.spelling, found.fitWidth, found.fitSlide];
    for (let i = 1; i < seq.length; i++) {
        assert.ok(seq[i - 1].compareDocumentPosition(seq[i]) & 4, 'status bar order is not: counter, language, spell check, fit width, fit slide');
    }
}

H.run([
    {name: 'status_bar_for_editor_has_counter_language_spelling_and_fit_only', fn: statusBarForEditorHasCounterLanguageSpellingAndFitOnly}
]);
