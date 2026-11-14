/* Browser page of the quick entries of the compact shell of the document editor: the toolbar, the
 * selection toolbar and the slash menu over the menu catalog, for the toolbar, slash and command tests.
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH; CHROMIUM_PATH optional).
 * Loaded as they are: jQuery, underscore, MenuModel.js and MenuBar.js of the shared layer, the catalog
 * (DocumentActions.js) and the adapter (CompactMenuAdapter.js) over the stock stand-ins of
 * common/compact/lib/documents-editor.cjs, CompactToolbar.js, SelectionBubble.js and SlashMenu.js. The shell
 * is the stand-in of documents-editor.cjs with the menu adapter, the editing lock and the surfaces the
 * toolbar asks it to close; glyphs are spans named by data-i; the toolbar has plain flex styles.
 * In the page: ctx (editor state of documents-editor.cjs; ctx.fire(name, ...args) fires an engine callback),
 * actions, tb, bubble, slash, shell, commands (keys run through DocumentActions.runCommand, with args),
 * lock(on) (the editing lock the shell reports), build() (rebuilds the toolbar in #toolbar).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const DOCS = path.join(ROOT, 'test/unit-tests/common/compact/lib/documents-editor.cjs');
const VIEW = path.join(ROOT, 'apps/documenteditor/main/app/view');

function launch() {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    return chromium.launch(process.env.CHROMIUM_PATH ?
        {headless: true, executablePath: process.env.CHROMIUM_PATH} : {headless: true, channel: 'chrome'});
}

const HTML = `<!doctype html><style>
    body {margin: 0; font: 13px sans-serif}
    #toolbar {width: 1600px}
    #vo-tb {display: flex; gap: 12px; padding: 8px; align-items: center}
    .vo-g, .vo-of, .vo-tb-end {display: flex; gap: 4px; align-items: center}
    .vo-ib {height: 32px; min-width: 32px; padding: 0 4px; display: inline-flex; align-items: center}
    .vo-air {display: inline-block; width: 18px; height: 18px}
    .vo-pop-wrap, .vo-cb, .vo-more-wrap {position: relative; display: inline-flex}
    .vo-w-zoom, .vo-w-font {width: 70px} .vo-w-size {width: 56px} .vo-heading {width: 98px}
    .vo-size-box {display: inline-flex; align-items: center; height: 100%}
    .vo-size-input {border: 0; padding: 0; width: 100%; min-width: 0; font: inherit}
    .vo-size-caret {min-width: 0; width: auto; padding: 0; height: auto}
    .vo-pop, .vo-cb-pop, .vo-of-pop {display: none}
    .open > .vo-pop, .open > .vo-cb-pop {display: block; position: absolute; top: 100%; left: 0; background: white; z-index: 5}
    .vo-of-open .vo-of-pop {display: flex; position: absolute; right: 0; top: 100%; background: white}
    .vo-pop-item {display: flex; width: 220px}
    .vo-collapsed {display: none !important}
    #vo-slash {display: none; position: absolute} #vo-slash.open {display: block; background: white}
    .vo-slash-item {display: flex; width: 320px}
    #vo-bubble {position: absolute; display: flex}
    *, *::before, *::after {transition: none !important; animation: none !important}
</style><body class="vo-compact"><div id="toolbar"></div><input id="outside">
<div id="editor_sdk"><textarea id="area_id"></textarea></div></body>`;

/* A new page with the quick entries built. context — overrides of the editor state (documents-editor.cjs). */
async function open(browser, {context = {}, width = 1700, height = 800} = {}) {
    const page = await browser.newPage({viewport: {width, height}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(HTML);
    for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js'])
        await page.addScriptTag({path: path.join(ROOT, file)});
    await page.addScriptTag({content: `window.Icons = {
            svg: function (name) { return '<span class="vo-air" data-i="' + name + '"></span>'; },
            has: function () { return true; }
        };
        window.ToolbarHintsStub = function () { this.hide = function () {}; this.destroy = function () {}; };
        window.define = function (deps, factory) {
            return factory.apply(null, deps.map(function (d) {
                if (/\\/Icons$/.test(d)) return window.Icons;
                if (/\\/ToolbarHints$/.test(d)) return window.ToolbarHintsStub;
                var shared = window.Common && Common.UI && Common.UI.Compact;
                return shared ? shared[d.split('/').pop()] : undefined;
            }));
        };`});
    const source = fs.readFileSync(DOCS, 'utf8');
    await page.addScriptTag({content: `(function (module) {\n${source}\n;window.editorModule = module.exports;})({exports: {}});`});
    await page.evaluate(() => editorModule.install(window));
    for (const file of ['apps/common/main/lib/view/compact/MenuModel.js', 'apps/common/main/lib/view/compact/MenuBar.js']
        .concat(require(DOCS).scripts))
        await page.addScriptTag({content: fs.readFileSync(path.join(ROOT, file), 'utf8')});
    for (const file of ['CompactToolbar.js', 'SelectionBubble.js', 'SlashMenu.js'])
        await page.addScriptTag({content: fs.readFileSync(path.join(VIEW, file), 'utf8')});
    await page.evaluate(context => {
        Asc.c_oAscTypeSelectElement = {Paragraph: 0, Table: 1, Image: 2, Header: 3, Shape: 6, Chart: 8, Math: 9};
        Asc.vertalign_Baseline = 0; Asc.vertalign_SubScript = 1; Asc.vertalign_SuperScript = 2;
        Asc.CHyperlinkProperty = function () {
            this.put_Text = text => { this.text = text; };
            this.get_Text = () => this.text;
            this.get_Value = () => '';
            this.get_Bookmark = () => null;
            this.get_ToolTip = () => '';
        };
        Asc.CTableOfContentsPr = function () {
            ['put_OutlineRange', 'put_Hyperlink', 'put_ShowPageNumbers', 'put_RightAlignTab', 'put_TabLeader']
                .forEach(name => { this[name] = () => {}; });
        };
        Asc.c_oAscTabLeader = {Dot: 1};
        /* Wrapping and order of an object by name (sdkjs word/apiDefines.js). */
        Asc.c_oAscWrapStyle2 = {Inline: 0, Square: 1, Tight: 2, Through: 3, TopAndBottom: 4, Behind: 5, InFront: 6};
        Asc.c_oAscChangeLevel = {BringToFront: 0, BringForward: 1, SendToBack: 2, BringBackward: 3};
        Asc.asc_CImgProperty = function () {
            this.put_WrappingStyle = v => { this.wrap = v; };
            this.put_ChangeLevel = v => { this.level = v; };
        };
        Asc.c_oAscSectionBreakType = {NextPage: 0, OddPage: 1, EvenPage: 2, Continuous: 3, Column: 4};
        /* The caret stands at a clean spot with nothing selected: the slash may open. */
        window.ctx = editorModule.context(Object.assign({}, context, {engine: {
            pluginMethod_GetSelectionType: () => 'none',
            asc_GetCurrentWord: () => ''
        }}));
        window.actions = DE.Views.DocumentActions;
        window.commands = [];
        const run = actions.runCommand;
        actions.runCommand = function (k, args) {
            commands.push(args === undefined ? k : {k, args: JSON.parse(JSON.stringify(args))});
            return run.call(this, k, args);
        };
        let locked = false;
        window.lock = on => { locked = !!on; };
        const shell = window.shell = DE.Views.CompactShell = Object.assign(ctx.shell, {
            advanced: false,
            editingLocked: () => locked,
            menuAdapter: DE.Views.CompactMenuAdapter.create(ctx.shell, ctx.api),
            closeSurfaces() { tb.closeOverflow(); tb.closePopovers(); },
            openTableProperties() { ctx.log.push({shell: 'openTableProperties'}); },
            openRightPanel() { ctx.log.push({shell: 'openRightPanel'}); }
        });
        /* Stock size grid of the editor: the toolbar builds it on the first opening of its table button. */
        Common.UI.DimensionPicker = function (opts) {
            const handlers = {};
            this.on = (name, fn) => { handlers[name] = fn; };
            window.pickTable = (columns, rows) => handlers.select && handlers.select(this, columns, rows);
            opts.el.append('<div class="grid"></div>');
        };
        const tb = window.tb = DE.Views.CompactToolbar;
        window.build = () => {
            tb.api = ctx.api;
            const old = tb.el;
            const next = tb.build();
            if (old) old.remove();
            next.appendTo('#toolbar');
            tb.relayout();
        };
        build();
        tb.bindApi();
        window.bubble = DE.Views.SelectionBubble.create(ctx.api);
        window.slash = DE.Views.SlashMenu.create(ctx.api);
    }, context);
    page.errors = errors;
    return page;
}

/* Check list of one test file; the file exits non-zero on any failure or without a pass. */
function checker() {
    let passed = 0, failed = 0;
    return {
        async check(name, fn) {
            try { await fn(); console.log('PASS', name); passed++; }
            catch (error) { console.error('FAIL', name, error.message); failed++; }
        },
        done() {
            console.log(`${passed} passed, ${failed} failed`);
            process.exitCode = failed || !passed ? 1 : 0;
        }
    };
}

module.exports = {ROOT, launch, open, checker};
