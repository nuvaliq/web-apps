/* Run: node test/unit-tests/documenteditor/compact-doc-bottom-gap.cjs
 * The optional argument is the path to an AMD file for checking the baseline.
 * The reserve under the compact bottom row: CompactShell.syncDocGaps adds
 * it to the document height in the engine's CalculateDocumentSize. The scroll range
 * is published by the engine inside the same recalculation (UpdateScrolls), so after
 * a zoom change and any recalculation the published height must already
 * contain the reserve, and repeated and nested recalculations must not accumulate it.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const file = process.argv[2] || path.resolve(__dirname,
    '../../../apps/documenteditor/main/app/view/CompactShell.js');
const DE = {Views: {}, getController: () => ({})};
const context = {
    window: {DE}, DE,
    setTimeout: () => {},
    _: {extend: Object.assign},
    Common: {NotificationCenter: {trigger: () => {}}},
    define: (dependencies, factory) => factory({})
};
vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
const shell = DE.Views.CompactShell;

const GAP = 30, BETWEEN = 20, PAGE = 1123;

/* Size recalculation modeled on WordControl (sdkjs/word/Drawing/HtmlPage.js:
   3099–3219): an instance method; the height anew from zero: the pages, the gaps
   between them and after the last one; when fitting to width the new zoom is
   recalculated by the same method from inside (zoom_FitToWidth → zoom_Fire →
   CalculateDocumentSize, :859–963) and the outer call exits without publishing;
   otherwise the scroll range is published (UpdateScrolls, :1546–1625). */
function WordControl(pages) {
    this.pages = pages;
    this.m_nZoomValue = 100;
    this.m_nZoomType = 0;
    this.fitValue = 100;
    this.m_dDocumentHeight = 0;
    this.published = [];
    this.CalculateDocumentSize = function () {
        this.m_dDocumentHeight = 0;
        for (let i = 0; i < this.pages; i++)
            this.m_dDocumentHeight += BETWEEN + Math.round(PAGE * this.m_nZoomValue / 100);
        this.m_dDocumentHeight += BETWEEN;
        if (this.m_nZoomType === 1 && this.zoom_FitToWidth()) return;
        this.UpdateScrolls();
    };
    this.zoom_FitToWidth = function () {
        if (this.fitValue === this.m_nZoomValue) return false;
        this.m_nZoomValue = this.fitValue;
        this.CalculateDocumentSize();
        return true;
    };
    this.UpdateScrolls = function () { this.published.push(this.m_dDocumentHeight); };
    this.setOffsetTop = function () {};
    this.OnScroll = function () {};
}
const height = (pages, zoom) => pages * (BETWEEN + Math.round(PAGE * zoom / 100)) + BETWEEN;
const last = wc => wc.published[wc.published.length - 1];

let passed = 0, failed = 0;
function check(name, run) {
    try {
        run();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
        failed++;
    }
}
function compact(pages) {
    const wc = new WordControl(pages);
    shell.api = {WordControl: wc};
    shell.tbHidden = false;
    shell.docMode = 'edit';
    shell.syncDocGaps(true);
    return wc;
}

check('gap is published when the shell turns on', () => {
    const wc = compact(3);
    assert.equal(wc.m_dDocumentHeight, height(3, 100) + GAP);
    assert.equal(last(wc), height(3, 100) + GAP);
});

check('gap is published after a zoom change recalculates the document', () => {
    const wc = compact(3);
    wc.m_nZoomValue = 150;
    wc.CalculateDocumentSize();
    assert.equal(wc.m_dDocumentHeight, height(3, 150) + GAP);
    assert.equal(last(wc), height(3, 150) + GAP);
});

check('repeated recalculations keep a single gap', () => {
    const wc = compact(3);
    for (let i = 0; i < 4; i++) wc.CalculateDocumentSize();
    assert.equal(wc.m_dDocumentHeight, height(3, 100) + GAP);
    assert.equal(last(wc), height(3, 100) + GAP);
});

check('fit-to-width recalculation from inside a recalculation adds the gap once', () => {
    const wc = compact(3);
    wc.m_nZoomType = 1;
    wc.fitValue = 144;
    wc.CalculateDocumentSize();
    assert.equal(wc.m_dDocumentHeight, height(3, 144) + GAP);
    assert.equal(last(wc), height(3, 144) + GAP);
});

check('turning the shell on twice keeps a single gap', () => {
    const wc = compact(2);
    shell.syncDocGaps(true);
    wc.CalculateDocumentSize();
    assert.equal(wc.m_dDocumentHeight, height(2, 100) + GAP);
    assert.equal(last(wc), height(2, 100) + GAP);
});

check('without the shell no gap is added or published', () => {
    const wc = compact(2);
    shell.syncDocGaps(false);
    assert.equal(wc.m_dDocumentHeight, height(2, 100));
    assert.equal(last(wc), height(2, 100));
    wc.m_nZoomValue = 120;
    wc.CalculateDocumentSize();
    assert.equal(last(wc), height(2, 120));
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
