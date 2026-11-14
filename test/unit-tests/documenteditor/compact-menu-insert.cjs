/* Run: node test/unit-tests/documenteditor/compact-menu-insert.cjs
 * Insert section of the compact menu of the document editor (DocumentActions.sections): the table
 * submenu with the size grid and the conversion of text, the chart with its data editor, the break
 * submenu and the horizontal line.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs. The size grid
 * runs in headless Chrome through Playwright (NODE_PATH or PLAYWRIGHT_MODULE): the shared menu bar
 * over the same stand-ins (lib/menu-bar-page.cjs) with the stock size picker of the editor
 * (common/main/lib/component/DimensionPicker.js) on jQuery, underscore and Backbone.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const docs = require('../common/compact/lib/documents-editor.cjs');
const page = require('../common/compact/lib/menu-bar-page.cjs');

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const actions = G.DE.Views.DocumentActions;
const command = k => actions.command(k);
const plain = value => JSON.parse(JSON.stringify(value));
const calls = (ctx, name) => ctx.log.filter(e => e.api === name).map(e => e.args);
const rows = (items, ctx) => plain(Model.section(items, ctx).rows.map(r => (r.kind === 'sep' ? '—' : r.k)));

/* Section break kinds of the engine (sdkjs common/commonDefines.js). */
G.Asc.c_oAscSectionBreakType = {NextPage: 0, OddPage: 1, EvenPage: 2, Continuous: 3, Column: 4};

const {check, skip, done} = page.checker();

/* --- Catalog --------------------------------------------------------------------------------- */

check('convert is greyed without selection', () => {
    const it = command('insert.table.convert');
    assert.ok(it, 'the conversion is an item of the table submenu');
    assert.ok(command('insert.table').items.some(x => x && x.k === it.k));
    const none = docs.context({engine: {asc_GetSelectedText: () => ''}});
    const st = Model.state(it, none);
    assert.equal(st.disabled, true);
    assert.equal(st.reason, 'noSelection');
    assert.equal(docs.reasonText(st.reason), 'No text selected');
    const some = docs.context({engine: {asc_GetSelectedText: () => 'first cell\tsecond cell'}});
    assert.equal(Model.state(it, some).disabled, false, 'selected text can be converted');
    /* A common reason outranks the reason of the item. */
    const view = docs.context({reasons: ['view'], engine: {asc_GetSelectedText: () => ''}});
    assert.equal(Model.state(it, view).reason, 'view');
    /* The conversion opens the stock window with what the engine proposes for the selection. */
    const dialogs = [];
    G.DE.Views.TextToTableDialog = function (config) {
        dialogs.push(config);
        this.show = () => {};
    };
    try {
        const selected = docs.context({engine: {asc_GetSelectedText: () => 'first cell\tsecond cell'}});
        const ran = docs.adapter(selected).exec(it);
        assert.equal(ran, true);
        assert.equal(dialogs.length, 1);
        assert.deepEqual(plain(calls(selected, 'asc_PreConvertTextToTable')), [[]]);
        /* The menu offers the same default width as the stock toolbar: fit to contents. */
        assert.equal(dialogs[0].defaultAutoFitType, G.Asc.c_oAscTextToTableAutoFitType.Content);
    } finally {
        delete G.DE.Views.TextToTableDialog;
    }
});

check('chart insertion opens the data editor', () => {
    const ctx = docs.context();
    const it = command('insert.chart');
    assert.equal(Model.kindOf(it), 'action');
    assert.equal(docs.adapter(ctx).exec(it), true);
    /* The third argument asks the engine to open the chart data editor right after the insertion
       (sdkjs word/api.js asc_addChartDrawingObject). */
    assert.deepEqual(plain(calls(ctx, 'asc_addChartDrawingObject')), [[10, null, true]]);
});

check('break submenu has three kinds', () => {
    const ctx = docs.context();
    const brk = command('insert.break');
    assert.equal(Model.kindOf(brk), 'submenu');
    assert.equal(brk.t, 'Break');
    assert.deepEqual(rows(brk.items, ctx), ['insert.break.page', 'insert.break.section', 'insert.break.blank']);
    assert.deepEqual(plain(brk.items.map(it => it.t)), ['Page break', 'Section break', 'Blank page']);
    assert.equal(command('insert.break.page').sc, 'InsertPageBreak', 'page break shows its stock shortcut');
    const adapter = docs.adapter(ctx);
    for (const it of brk.items) assert.equal(adapter.exec(it), true, it.k + ' runs');
    assert.deepEqual(plain(calls(ctx, 'put_AddPageBreak')), [[]]);
    /* A section break starts the next section on the next page. */
    assert.deepEqual(plain(calls(ctx, 'add_SectionBreak')), [[G.Asc.c_oAscSectionBreakType.NextPage]]);
    assert.deepEqual(plain(calls(ctx, 'asc_AddBlankPage')), [[]]);
    /* The submenu and its items are greyed with the editing reasons. */
    const view = docs.context({reasons: ['view']});
    assert.equal(Model.state(brk, view).reason, 'view');
    for (const it of brk.items) assert.equal(Model.state(it, view).reason, 'view', it.k);
    assert.equal(command('insert.pageBreak'), null, 'the page break is no longer a row of Insert itself');
});

check('horizontal line uses the stock call', () => {
    const ctx = docs.context();
    const it = command('insert.horizontalLine');
    assert.equal(it.t, 'Horizontal line');
    assert.equal(docs.adapter(ctx).exec(it), true);
    assert.deepEqual(plain(calls(ctx, 'asc_addHorizontalRule')), [[]]);
    assert.ok(ctx.log.some(e => e.event === 'edit:complete'), 'focus goes back to the document');
    assert.equal(Model.state(it, docs.context({reasons: ['protected']})).reason, 'protected');
    assert.equal(Model.state(it, docs.context({missing: ['asc_addHorizontalRule']})).disabled, true,
        'greyed without the engine call');
});

check('insert section has its items in order', () => {
    const ctx = docs.context();
    const insert = docs.sections().find(s => s.k === 'insert');
    assert.deepEqual(rows(insert.items, ctx), ['insert.image', 'insert.table', 'insert.link', 'insert.comment', '—',
        'insert.shape', 'insert.textBox', 'insert.chart', 'insert.equation', 'insert.symbol', 'insert.horizontalLine', '—',
        'insert.break', 'insert.headerFooter', '—', 'insert.toc', 'insert.footnote', 'insert.bookmark', '—',
        'insert.field', 'insert.control']);
    /* Every submenu of the section is greyed with the editing reasons as a whole. */
    const view = docs.context({reasons: ['view']});
    for (const k of ['insert.table', 'insert.shape', 'insert.break', 'insert.headerFooter', 'insert.toc', 'insert.footnote',
        'insert.control'])
        assert.equal(Model.state(command(k), view).reason, 'view', k);
    /* Shapes and the text box are placed at the caret by a document script, one per kind, without the
       drawing mode of the stock call (compact-insert-objects.cjs runs the script in the engine). */
    const run = docs.context();
    assert.deepEqual(rows(command('insert.shape').items, run), ['insert.shape.rect', 'insert.shape.roundRect',
        'insert.shape.ellipse', 'insert.shape.rightArrow', 'insert.shape.line']);
    const adapter = docs.adapter(run);
    for (const it of command('insert.shape').items) assert.equal(adapter.exec(it), true, it.k);
    assert.equal(adapter.exec(command('insert.textBox')), true);
    assert.deepEqual(plain(calls(run, 'StartAddShape')), [], 'no drawing mode');
});

/* --- The size grid in the menu bar ------------------------------------------------------------ */

const editor = {name: 'documenteditor', adapter: path.join(__dirname, '../common/compact/lib/documents-editor.cjs')};

/* The stock size picker needs the layout of its own styles (common/main/resources/less/dimension-picker.less):
   20 px per cell, the mouse catcher over the grid. */
const PICKER_CSS = `.dimension-picker {font-size: 20px}
.dimension-picker div {position: relative}
.dimension-picker div.dimension-picker-mousecatcher {left: 0; top: 0; position: absolute !important}
.vo-mn-sub.vo-mn-widget {height: auto}`;

/* The menu bar page of the document editor with the stock size picker loaded and the shell knowing
   its menu bar, as CompactShell keeps it (menu and menuAdapter). */
async function gridPage(browser, context = {}) {
    const p = await page.openMenu(browser, editor, {context});
    await p.addStyleTag({content: PICKER_CSS});
    for (const name of ['jquery', 'underscore', 'backbone'])
        await p.addScriptTag({path: path.join(ROOT, 'vendor', name, name + '.js')});
    await p.evaluate(() => {
        Object.assign(Common.Utils, {applicationPixelRatio: () => 1, isIE: false, zoom: () => 1});
        Common.UI = Common.UI || {};
        Common.UI.Themes = {currentThemeColor: () => '#888'};
        Common.UI.isRTL = () => false;
        window.define = (deps, factory) => factory(Backbone);
    });
    for (const file of ['apps/common/main/lib/component/BaseView.js', 'apps/common/main/lib/component/DimensionPicker.js'])
        await p.addScriptTag({content: fs.readFileSync(path.join(ROOT, file), 'utf8')});
    await p.evaluate(() => {
        ctx.shell.menu = menu;
        ctx.shell.menuAdapter = adapter;
    });
    return p;
}

/* Opens Insert ▸ Table with the keyboard and leaves the focus on the size grid. */
async function toGrid(p) {
    await p.evaluate(() => { menu.open('insert'); });
    await page.focusRow(p, 'insert.table');
    await p.keyboard.press('ArrowRight');
}

function gridState(p) {
    return p.evaluate(() => {
        const grid = menu.el.querySelector('[data-k="insert.table.grid"]');
        const live = grid && grid.querySelector('[aria-live]');
        const active = document.activeElement;
        return {
            grid: !!grid,
            focused: !!grid && grid.contains(active) && active.tagName === 'BUTTON',
            active: active && (active.getAttribute('data-k') || active.className),
            live: live ? live.textContent : null,
            picker: grid ? grid.querySelector('.dimension-picker-status') && grid.querySelector('.dimension-picker-status').textContent : null,
            tables: ctx.log.filter(e => e.api === 'put_Table').map(e => e.args),
            keys: ctx.log.filter(e => e.keys).map(e => e.keys),
            isOpen: menu.isOpen()
        };
    });
}

(async () => {
    let browser;
    try {
        browser = await page.launch();
    } catch (error) {
        skip('size grid checks', 'no headless browser: ' + error.message);
    }
    if (browser) {
        try {
            await check('table submenu inserts the picked size', async () => {
                const p = await gridPage(browser);
                await p.click('[data-k="insert"]');
                await p.click('[data-k="insert.table"]');
                const before = await gridState(p);
                assert.equal(before.grid, true, 'the grid is a row of the table submenu');
                assert.deepEqual(await p.evaluate(() => Array.from(menu.el.querySelectorAll('.vo-mn-fly [data-k]'))
                    .map(el => el.getAttribute('data-k'))), ['insert.table.grid', 'insert.table.convert']);
                const box = await p.evaluate(() => {
                    const r = menu.el.querySelector('[data-k="insert.table.grid"] .dimension-picker-mousecatcher')
                        .getBoundingClientRect();
                    return {x: r.left, y: r.top};
                });
                /* The third column and the second row. */
                await p.mouse.move(box.x + 50, box.y + 30);
                await p.mouse.move(box.x + 51, box.y + 31);
                const hover = await gridState(p);
                assert.equal(hover.live, '3 × 2', 'the size is said as it changes');
                await p.mouse.click(box.x + 51, box.y + 31);
                const after = await gridState(p);
                assert.deepEqual(after.tables, [[3, 2]]);
                assert.equal(after.isOpen, false, 'the menu closes on the insertion');
                assert.ok(after.keys.includes('beforeCommand'), 'the keyboard goes back to the document');
                assert.deepEqual(p.errors, []);
                await p.close();
            });

            await check('arrows grow the table size and enter inserts it', async () => {
                const p = await gridPage(browser);
                await toGrid(p);
                let st = await gridState(p);
                assert.equal(st.focused, true, 'the grid is the first stop of the table submenu');
                assert.equal(st.live, '1 × 1', 'the grid starts at one cell');
                await p.keyboard.press('ArrowRight');
                await p.keyboard.press('ArrowRight');
                await p.keyboard.press('ArrowDown');
                st = await gridState(p);
                assert.equal(st.live, '3 × 2');
                assert.equal(st.picker, '3 x 2', 'the stock picker shows the same size');
                assert.equal(st.focused, true, 'the arrows stay in the grid');
                /* The grid stops at 10 × 8. */
                for (let i = 0; i < 12; i++) await p.keyboard.press('ArrowRight');
                for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowDown');
                st = await gridState(p);
                assert.equal(st.live, '10 × 8');
                /* Down from the last row goes on to the next item of the submenu. */
                await p.keyboard.press('ArrowDown');
                st = await gridState(p);
                assert.equal(st.active, 'insert.table.convert');
                await p.keyboard.press('ArrowUp');
                st = await gridState(p);
                assert.equal(st.focused, true);
                await p.keyboard.press('ArrowLeft');
                await p.keyboard.press('ArrowUp');
                st = await gridState(p);
                assert.equal(st.live, '9 × 7');
                await p.keyboard.press('Enter');
                st = await gridState(p);
                assert.deepEqual(st.tables, [[9, 7]]);
                assert.equal(st.isOpen, false);
                assert.deepEqual(p.errors, []);
                await p.close();
            });

            await check('escape returns focus to the table item', async () => {
                const p = await gridPage(browser);
                await toGrid(p);
                await p.keyboard.press('ArrowRight');
                await p.keyboard.press('Escape');
                let st = await gridState(p);
                assert.equal(st.grid, false, 'the submenu is closed');
                assert.equal(st.active, 'insert.table');
                assert.equal(st.isOpen, true, 'Insert stays open');
                assert.deepEqual(st.tables, []);
                /* Left from the first column does the same. */
                await p.keyboard.press('ArrowRight');
                st = await gridState(p);
                assert.equal(st.focused, true);
                await p.keyboard.press('ArrowLeft');
                st = await gridState(p);
                assert.equal(st.grid, false);
                assert.equal(st.active, 'insert.table');
                assert.deepEqual(st.tables, []);
                assert.deepEqual(p.errors, []);
                await p.close();
            });

            await check('grid insert after F10 gives the keys back for good', async () => {
                const p = await gridPage(browser);
                await p.focus('#field');
                await p.keyboard.press('F10');
                await toGrid(p);
                await p.keyboard.press('Enter');
                let st = await gridState(p);
                assert.deepEqual(st.tables, [[1, 1]]);
                assert.equal(st.isOpen, false);
                const before = st.keys.length;
                assert.equal(st.keys[before - 1], 'beforeCommand', 'the keys go back before the insertion');
                /* A section opened later with the mouse and closed by a click aside: the document
                   keeps its keys. */
                await p.click('[data-k="insert"]');
                await p.click('#next');
                st = await gridState(p);
                assert.equal(st.isOpen, false);
                assert.deepEqual(st.keys.slice(before).filter(k => k === 'hold'), [], 'no hold after the insertion');
                assert.deepEqual(p.errors, []);
                await p.close();
            });

            await check('locked grid does not insert', async () => {
                const p = await gridPage(browser);
                await toGrid(p);
                /* The document turns read-only while the grid is open. */
                await page.patch(p, {reasons: ['view']});
                await p.keyboard.press('Enter');
                const st = await gridState(p);
                assert.deepEqual(st.tables, []);
                assert.deepEqual(p.errors, []);
                await p.close();
            });
        } finally {
            await browser.close();
        }
    }
    done();
})();
