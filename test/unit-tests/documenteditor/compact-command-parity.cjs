/* Run after the document editor LESS build: node test/unit-tests/documenteditor/compact-command-parity.cjs
 * COMPACT_CSS_DOCUMENTEDITOR (or COMPACT_CSS) names the compiled app.css (the shell page of the lock check).
 * One command, one behaviour: the buttons of the compact toolbar and of the selection toolbar that have a pair
 * in the menu run the item of the menu catalog (DocumentActions.runCommand), a paired toolbar button is locked
 * whenever its menu item is greyed by a lock of the document, and the catalog never calls the toolbar.
 * The catalog runs in vm over the stand-ins of common/compact/lib/documents-editor.cjs; the buttons run in
 * headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH; CHROMIUM_PATH optional) over
 * fixtures/compact-quick-page.cjs, the lock over fixtures/compact-shell-page.cjs with the real shell and toolbar.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const docs = require('../common/compact/lib/documents-editor.cjs');
const quick = require('./fixtures/compact-quick-page.cjs');
const shellPage = require('./fixtures/compact-shell-page.cjs');

const ROOT = quick.ROOT;
const ACTIONS = path.join(ROOT, 'apps/documenteditor/main/app/view/DocumentActions.js');

/* Stock payload of a lost connection (controller/Main.js, disableEditing with the type reconnect). */
const RECONNECT = {
    viewMode: true, reviewMode: false, fillFormMode: false, viewDocMode: false, allowMerge: false,
    allowSignature: false, allowProtect: false, rightMenu: {clear: false, disable: true}, statusBar: true,
    leftMenu: {disable: true, previewMode: true}, fileMenu: {protect: true, history: true},
    navigation: {disable: false, previewMode: true}, comments: {disable: false, previewMode: true}, chat: true,
    review: true, viewport: true, documentHolder: {clear: false, disable: true}, toolbar: true, plugins: false,
    protect: false, header: {docmode: true, search: false, startfill: false}, shortcuts: false
};

(async () => {
    const {check, done} = quick.checker();

    await check('catalog does not call toolbar methods', async () => {
        /* In the source, comments aside: no toolbar of the shell and no toolbar view. */
        const code = fs.readFileSync(ACTIONS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        assert.equal(/CompactToolbar/.test(code), false, 'no CompactToolbar in the catalog code');
        assert.equal(/\.tb\b/.test(code), false, 'no shell toolbar in the catalog code');
        /* Running every command: a toolbar that throws on any touch is never touched. */
        const G = docs.host();
        const touched = [];
        const trap = name => new Proxy({}, {get(t, key) { touched.push(name + '.' + String(key)); return undefined; }});
        const ctx = docs.context();
        ctx.shell.tb = trap('shell.tb');
        G.DE.Views.CompactToolbar = trap('CompactToolbar');
        const warn = console.warn;
        console.warn = () => {};
        try {
            (function walk(items) {
                (items || []).forEach(it => {
                    if (!it) return;
                    if (typeof it.run === 'function') { try { it.run(); } catch (e) { /* stand-in windows */ } }
                    if (it.items) walk(it.items);
                });
            })(docs.sections());
        } finally {
            console.warn = warn;
            delete G.DE.Views.CompactToolbar;
        }
        assert.deepEqual(touched, []);
        /* Link and comment, which the menu used to borrow from the toolbar, are the catalog's own. */
        ctx.log.length = 0;
        G.DE.Views.DocumentActions.runCommand('insert.comment');
        G.DE.Views.DocumentActions.runCommand('insert.link');
        assert.deepEqual(JSON.parse(JSON.stringify(ctx.log)), [
            {shell: 'ensureLeftPanel', args: ['comments']},
            {event: 'app:comment:add', args: ['toolbar']},
            {event: 'compact:link', args: []}
        ]);
    });

    const browser = await quick.launch();
    try {
        await check('toolbar and bubble run the catalog command for each paired button', async () => {
            const page = await quick.open(browser);
            const titled = title => page.locator(`#vo-tb button.vo-ib[title="${title}"]`);
            const row = (wrap, text) => page.locator(`${wrap} .vo-pop-item`, {hasText: text});
            for (const title of ['Comment', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Superscript', 'Subscript',
                'Clear formatting', 'Image']) await titled(title).click();
            await titled('Link').click();
            await page.evaluate(() => tb.closePopovers());
            await page.click('.vo-w-zoom .vo-value-btn');
            await row('.vo-w-zoom', '75%').click();
            await page.click('.vo-heading-btn');
            await row('.vo-heading', 'Heading 2').click();
            await titled('Alignment').click();
            await row('.vo-align', 'Align center').click();
            await titled('Line spacing').click();
            await page.click('[data-k="format.spacing.115"]');
            await titled('Line spacing').click();
            await page.click('[data-k="format.spacing.before"]');
            await titled('Lists and indents').click();
            await row('.vo-lists', 'Bulleted').click();
            await titled('Lists and indents').click();
            await row('.vo-lists', 'Increase indent').click();
            await titled('Table').click();
            await page.evaluate(() => pickTable(4, 2));
            await page.locator('#vo-tb .vo-tb-end button').click();
            assert.deepEqual(await page.evaluate(() => commands), [
                'insert.comment', 'format.text.bold', 'format.text.italic', 'format.text.underline',
                'format.text.strikeout', 'format.text.superscript', 'format.text.subscript', 'format.clear',
                'insert.image', 'insert.link', 'view.zoom.75', 'format.style.heading2', 'format.align.center',
                'format.spacing.115', 'format.spacing.before', 'format.lists.bullet', 'format.lists.indentIn',
                {k: 'insert.table', args: {cols: 4, rows: 2}}, 'view.focus']);
            /* The table of the grid is the one the menu inserts. */
            assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.api === 'put_Table').map(e => e.args)), [[4, 2]]);

            /* The selection toolbar: text, table and object sets. */
            const keys = await page.evaluate(() => {
                const out = {};
                for (const kind of ['text', 'table', 'image']) {
                    commands.length = 0;
                    bubble.renderSet(kind);
                    document.querySelectorAll('#vo-bubble button').forEach(b => b.click());
                    out[kind] = commands.slice();
                    tb.closePopovers();
                }
                return out;
            });
            assert.deepEqual(keys, {
                text: ['format.text.bold', 'format.text.italic', 'format.text.underline', 'format.text.strikeout',
                    'format.clear', 'insert.link', 'insert.comment'],
                table: ['format.table.rowAbove', 'format.table.rowBelow', 'format.table.colLeft', 'format.table.colRight',
                    'format.table.merge', 'format.table.rowDel', 'format.table.colDel', 'format.table.props'],
                image: ['format.image.wrapInline', 'format.image.wrapSquare', 'format.image.wrapTopBottom',
                    'format.image.toFront', 'format.image.toBack', 'format.image.props']
            });
            /* Wrapping by name: «in line» is the engine's 0, «top and bottom» its 4 — the numbers once mixed up. */
            assert.deepEqual(await page.evaluate(() => ctx.log.filter(e => e.api === 'ImgApply')
                .map(e => e.args[0].wrap !== undefined ? 'wrap ' + e.args[0].wrap : 'level ' + e.args[0].level)),
                ['wrap 0', 'wrap 1', 'wrap 4', 'level 0', 'level 2']);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('bubble bold toggles like the menu text toggle', async () => {
            const page = await quick.open(browser);
            const bold = () => page.evaluate(() => ctx.log.filter(e => e.api === 'put_TextPrBold').map(e => e.args[0]));
            const press = () => page.evaluate(() => {
                bubble.renderSet('text');
                const b = document.querySelector('#vo-bubble button');
                b.click();
                return b.classList.contains('on');
            });
            const menu = () => page.evaluate(() => shell.menuAdapter.exec(actions.command('format.text.bold')));
            const checked = () => page.evaluate(() => shell.menuAdapter.itemState(actions.command('format.text.bold')).checked);
            const toolbar = () => page.locator('#vo-tb button.vo-ib[title="Bold"]').click();

            /* Bold text: all three take bold off. */
            await page.evaluate(() => ctx.fire('asc_onBold', true));
            assert.equal(await press(), true, 'the bubble shows bold');
            assert.equal(await checked(), true, 'the menu shows bold');
            await menu();
            await toolbar();
            assert.deepEqual(await bold(), [false, false, false]);
            /* Plain text: all three put bold on. */
            await page.evaluate(() => { ctx.log.length = 0; ctx.fire('asc_onBold', false); });
            assert.equal(await press(), false);
            assert.equal(await checked(), false);
            await menu();
            await toolbar();
            assert.deepEqual(await bold(), [true, true, true]);
            assert.deepEqual(page.errors, []);
            await page.close();
        });

        await check('paired toolbar button and menu item agree on locked state while disconnected, in view and under protection', async () => {
            const page = await shellPage.open(browser);
            const VIEW = path.join(ROOT, 'apps/documenteditor/main/app/view');
            await page.evaluate(() => {
                window.define = (deps, factory) => factory.apply(null, deps.map(d => (/\/Icons$/.test(d) ? window.Icons :
                    /\/ToolbarHints$/.test(d) ? function () { this.hide = () => {}; this.destroy = () => {}; } : undefined)));
            });
            await page.addScriptTag({content: fs.readFileSync(path.join(VIEW, 'CompactToolbar.js'), 'utf8')});
            await page.evaluate(() => {
                Common.UI.DimensionPicker = function () { this.on = () => {}; };
                Asc.CHyperlinkProperty = function () {};
                ctx.engine.asc_GetSelectedText = () => 'selected words';
                const tb = window.tb = DE.Views.CompactToolbar;
                tb.api = ctx.api;
                const el = tb.build();
                $('#vo-tb').replaceWith(el);
                shell.tb = tb;
                tb.bindApi();
                tb.relayout();
                window.commands = [];
                const run = actions.runCommand;
                actions.runCommand = function (k, args) { commands.push(k); return run.call(this, k, args); };
            });
            /* Each paired button of the toolbar with the item of the menu it runs. */
            const PAIRS = {
                bold: 'format.text.bold', italic: 'format.text.italic', underline: 'format.text.underline',
                strike: 'format.text.strikeout', sup: 'format.text.superscript', sub: 'format.text.subscript',
                clear: 'format.clear', headingBtn: 'format.style.normal', alignBtn: 'format.align.left',
                spacingBtn: 'format.spacing.100', listsBtn: 'format.lists.bullet', link: 'insert.link',
                comment: 'insert.comment', table: 'insert.table', image: 'insert.image'
            };
            const read = () => page.evaluate(PAIRS => {
                const node = name => (name === 'table' ? $('#vo-tb button[title="Table"]') :
                    name === 'image' ? $('#vo-tb button[title="Image"]') : tb.ctrl[name]);
                const out = {masked: tb.el.hasClass('vo-masked') && tb.el.children('.vo-tb-mask').length === 1, rows: {}};
                Object.keys(PAIRS).forEach(name => {
                    const st = shell.menuAdapter.itemState(actions.command(PAIRS[name]));
                    const $b = node(name);
                    out.rows[name] = {menu: st.disabled ? (st.reason || 'greyed') : 'live',
                        tab: $b && $b.length ? $b.attr('tabindex') || null : 'none'};
                });
                return out;
            }, PAIRS);
            const apply = state => page.evaluate(state => {
                ctx.stack = state.stack === 'view' ? [{type: 'view', options: shell.RIGHTS_OPTIONS}] : state.stack || [];
                ctx.protection = state.protection || null;
                shell.applyEditingLock();
            }, state);

            /* Without a lock both are live. */
            await apply({});
            let now = await read();
            assert.equal(now.masked, false);
            for (const [name, row] of Object.entries(now.rows)) assert.deepEqual(row, {menu: 'live', tab: null}, name);

            for (const [label, state, reason] of [
                ['disconnected', {stack: [{type: 'reconnect', options: RECONNECT}]}, 'offline'],
                ['in view', {stack: 'view'}, 'view'],
                ['under protection', {protection: {isReadOnly: true}}, 'protected']
            ]) {
                await apply(state);
                now = await read();
                assert.equal(now.masked, true, label + ': the toolbar is masked');
                for (const [name, row] of Object.entries(now.rows))
                    assert.deepEqual(row, {menu: reason, tab: '-1'}, label + ': ' + name);
                /* A real click on a paired button reaches no command. */
                const box = await page.locator('#vo-tb button[title="Bold"]').boundingBox();
                if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                assert.deepEqual(await page.evaluate(() => commands), [], label + ': no command from the toolbar');
                await apply({});
                assert.equal((await read()).masked, false, label + ': the lock goes away with its reason');
            }
            assert.deepEqual(page.errors, []);
            await page.close();
        });
    } finally {
        await browser.close();
        done();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
