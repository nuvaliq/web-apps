/* Browser page of the compact shell of the document editor: the shell rows, the side panels, the outline
 * rail, the chevron of the focus mode and the header hint, for the focus mode and outline tests.
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH; CHROMIUM_PATH optional).
 * The page is drawn with the compiled document editor styles: COMPACT_CSS_DOCUMENTEDITOR or COMPACT_CSS names
 * app.css of a LESS build, otherwise the deploy folder of this tree is read; without any of them the page is
 * not built and the test fails saying which variable to set.
 * Loaded as they are: jQuery, underscore, MenuModel.js and MenuBar.js of the shared layer, the catalog
 * (DocumentActions.js) and the adapter (CompactMenuAdapter.js) over the stock stand-ins of
 * common/compact/lib/documents-editor.cjs, OutlineRail.js and CompactShell.js. Around them stand the stock
 * left menu (comments, navigation and search buttons that show their panels), the layout, the selection
 * toolbar, the slash menu and the engine's own Escape: on the text area of the engine it leaves a selected
 * object or the header and does not stop the key, as the engine does.
 * The engine scrolls as the engine does: docScroll keeps the position and the range of the vertical scroll
 * (WordControl.m_oScrollVerApi, read by the frame loop of the outline rail), the range follows the area on
 * api.Resize() and on a window resize, and the position is clamped to it; the wheel over the document and
 * Page Up/Down in the text move it. edit:complete gives the keyboard back to the text, as DocumentHolder does.
 * In the page: shell, actions, rail, ctx (editor state of documents-editor.cjs; ctx.fire(name, ...args)
 * fires an engine callback), engine (what the engine stand-in has: header, shape), stock (the left menu
 * buttons), bubble and slash (stand-ins), log (calls of the stand-ins), docScroll, focusText(), select(kind).
 * open(browser, {motion: true}) keeps the transitions of the styles; by default they are off, so that
 * layout is read right after a change.
 * open(browser, {stockLayout: true}) lays the page out by the stock vertical layout (Common.UI.VBoxLayout of
 * Layout.js over the rows of Viewport.template, the items as Viewport.js gives them) instead of the stand-in
 * whose doLayout does nothing; the rows inside the middle area stay a flex row.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const DOCS = path.join(ROOT, 'test/unit-tests/common/compact/lib/documents-editor.cjs');

function stylesheet() {
    const file = process.env.COMPACT_CSS_DOCUMENTEDITOR || process.env.COMPACT_CSS ||
        path.join(ROOT, 'deploy/web-apps/apps/documenteditor/main/resources/css/app.css');
    if (!fs.existsSync(file))
        throw new Error('compiled styles not found: set COMPACT_CSS_DOCUMENTEDITOR to app.css of the document ' +
            'editor LESS build (' + file + ')');
    return fs.readFileSync(file, 'utf8');
}

function launch() {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    return chromium.launch(process.env.CHROMIUM_PATH ?
        {headless: true, executablePath: process.env.CHROMIUM_PATH} : {headless: true, channel: 'chrome'});
}

const SHELL = `<div id="vo-shell"><div class="vo-hd"><span>Title</span></div><div id="menu-host"></div>
        <div id="vo-tb"><div class="vo-of"><button type="button" class="vo-ib" id="tb-bold">B</button>
        <span class="vo-pop-wrap" id="tb-pop"><button type="button" class="vo-ib" id="tb-pop-btn">Size</button></span>
        </div><div class="vo-more-wrap"></div><div class="vo-tb-end"><button type="button" class="vo-ib vo-focus-btn"
        id="tb-focus" title="Focus mode" aria-pressed="false"><span class="vo-air" data-i="chevron"></span></button>
        </div></div></div>`;

const MIDDLE = `<div id="left-menu"><div id="panel-comments" class="panel">Comments</div>
            <div id="left-panel-search" class="panel"><input id="search-field"></div>
            <div id="panel-navigation" class="panel">Navigation</div></div>
        <div id="editor-container"><div id="editor_sdk"><textarea id="area_id"></textarea></div></div>
        <div id="right-menu"><button type="button" id="first-property">Width</button></div>`;

const STATUS = '<div id="vo-status">Page 1 of 1</div>';

/* The rows of the page: laid out by flex, or the rows of Viewport.template for the stock vertical layout. */
const BODY = stock => (stock ? `<div id="viewport"><div id="viewport-vbox-layout" class="layout-ct vbox">
    <section id="app-title" class="layout-item"></section>
    <div id="toolbar" class="layout-item">${SHELL}</div>
    <div class="layout-item middle"><div id="viewport-hbox-layout">${MIDDLE}</div></div>
    <div id="statusbar" class="layout-item">${STATUS}</div>
</div></div>` : `<div id="viewport">
    <div id="toolbar">${SHELL}</div>
    <div id="viewport-hbox-layout">${MIDDLE}</div>
    <div id="statusbar">${STATUS}</div>
</div>`);

const HTML = (css, motion, stock) => `<!doctype html><style>${css}</style><style>
    html, body {margin: 0; height: 100%}
    ${stock ? `#viewport {position: relative; height: 100%}
    #viewport-hbox-layout {height: 100%; display: flex}` : `#viewport {display: flex; flex-direction: column; height: 100%}
    #toolbar {position: relative; flex: 0 0 auto}
    #viewport-hbox-layout {position: relative; flex: 1 1 auto; display: flex}`}
    #left-menu {width: 300px; position: relative}
    #editor-container {flex: 1 1 auto; position: relative}
    #editor_sdk {position: absolute; inset: 0}
    #area_id {position: absolute; left: 400px; top: 200px; width: 40px; height: 20px}
    #right-menu {width: 260px}
    .panel {display: none} .panel.shown {display: block}
    ${motion ? '' : `/* Layout is read right after a change: no animated height. */
    *, *::before, *::after {transition: none !important; animation: none !important}`}
</style><body class="vo-compact">${BODY(stock)}</body>`;

/* A new page with the shell built. context — overrides of the editor state (documents-editor.cjs). */
async function open(browser, {context = {}, width = 1280, height = 720, motion = false, docHeight = 3000,
    reducedMotion = 'no-preference', stockLayout = false} = {}) {
    const page = await browser.newPage({viewport: {width, height}, reducedMotion});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'warning') errors.push(msg.text()); });
    await page.setContent(HTML(stylesheet(), motion, stockLayout));
    for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js']
        .concat(stockLayout ? ['vendor/backbone/backbone.js'] : []))
        await page.addScriptTag({path: path.join(ROOT, file)});
    await page.addScriptTag({content: `window.Icons = {
            svg: function (name) { return '<span class="vo-air" data-i="' + name + '"></span>'; },
            has: function () { return true; }
        };
        window.define = function (deps, factory) {
            return factory.apply(null, deps.map(function (d) {
                if (/\\/Icons$/.test(d)) return window.Icons;
                var shared = window.Common && Common.UI && Common.UI.Compact;
                return shared ? shared[d.split('/').pop()] : undefined;
            }));
        };`});
    const source = fs.readFileSync(DOCS, 'utf8');
    await page.addScriptTag({content: `(function (module) {\n${source}\n;window.editorModule = module.exports;})({exports: {}});`});
    await page.evaluate(() => editorModule.install(window));
    for (const file of ['apps/common/main/lib/view/compact/MenuModel.js', 'apps/common/main/lib/view/compact/MenuBar.js']
        .concat(require(DOCS).scripts)
        .concat(stockLayout ? ['apps/common/main/lib/component/Layout.js'] : [])
        .concat(['apps/documenteditor/main/app/view/OutlineRail.js', 'apps/documenteditor/main/app/view/CompactTopScroll.js',
            'apps/documenteditor/main/app/view/CompactShell.js']))
        await page.addScriptTag({content: fs.readFileSync(path.join(ROOT, file), 'utf8')});
    await page.evaluate(({context, docHeight, stockLayout}) => {
        window.log = [];

        /* Vertical scroll of the engine: the range is the document height less the area, taken on a resize. */
        const area = () => document.getElementById('editor-container').getBoundingClientRect().height;
        window.docScroll = {
            height: docHeight, pos: 0, max: 0,
            resize() {
                this.max = Math.max(0, Math.round(this.height - area()));
                if (this.pos > this.max) this.pos = this.max;
            },
            to(y) { this.pos = Math.max(0, Math.min(this.max, Math.round(y))); }
        };
        window.addEventListener('resize', () => docScroll.resize());
        const wordControl = {m_oScrollVerApi: {
            get scrollVCurrentY() { return docScroll.pos; },
            get maxScrollY() { return docScroll.max; }
        }};
        const T = {Paragraph: 0, Table: 1, Image: 2, Header: 3, Hyperlink: 4, Shape: 6, Chart: 8, ContentControl: 11};
        Asc.c_oAscTypeSelectElement = T;
        window.AscCommon = {hdrftr_Header: 1, hdrftr_Footer: 2};
        Common.Utils.String = {htmlEncode: s => String(s)};

        /* The engine: what is under the caret now and what Escape leaves. */
        window.engine = {header: null, shape: false};
        window.ctx = editorModule.context(Object.assign({engine: {
            Resize: () => docScroll.resize(),
            getCurrentPage: () => 2,
            asc_GetDocumentOutlineManager: () => ({
                get_ElementsCount: () => 2, get_Level: () => 0, get_Text: i => 'Heading ' + (i + 1),
                isEmptyItem: () => false, goto: () => {}
            })
        }}, context));
        const element = (type, value) => ({get_ObjectType: () => type, get_ObjectValue: () => value || {}});
        window.focusObjects = () => {
            const list = [element(T.Paragraph)];
            if (engine.header) list.push(element(T.Header, engine.header));
            if (engine.shape) list.push(element(T.Shape, {get_ShapeProperties: () => ({get_FromChart: () => false})}));
            return list;
        };
        window.select = kind => {
            engine.shape = kind === 'shape';
            if (kind === 'header' || kind === 'footer') {
                const type = kind === 'header' ? AscCommon.hdrftr_Header : AscCommon.hdrftr_Footer;
                engine.header = {get_Type: () => type, get_Locked: () => false, get_DifferentFirst: () => false,
                    get_DifferentEvenOdd: () => false, get_LinkToPrevious: () => null,
                    get_HeaderMargin: () => 12.5, get_FooterMargin: () => 12.5};
            } else if (kind !== 'shape') engine.header = null;
            ctx.fire('asc_onFocusObject', focusObjects());
        };
        /* Escape of the engine (sdkjs word/Editor/Document.js): a selected object first, then the header. */
        document.getElementById('area_id').addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            if (engine.shape) { engine.shape = false; log.push('engine: leave object'); }
            else if (engine.header) { engine.header = null; log.push('engine: leave header'); }
            else return;
            ctx.fire('asc_onFocusObject', focusObjects());
        });
        window.focusText = () => document.getElementById('area_id').focus();
        /* The wheel over the document and Page Up/Down in the text scroll it. */
        document.getElementById('editor_sdk').addEventListener('wheel', e => {
            if (e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            docScroll.to(docScroll.pos + e.deltaY);
        }, {passive: false});
        document.getElementById('area_id').addEventListener('keydown', e => {
            if (e.key === 'PageDown') docScroll.to(docScroll.pos + area());
            else if (e.key === 'PageUp') docScroll.to(docScroll.pos - area());
        });
        Common.NotificationCenter.on('edit:complete', () => focusText());

        /* The stock left menu: one panel at a time, a button shows its panel. */
        const panels = {btnComments: 'panel-comments', btnSearchBar: 'left-panel-search', btnNavigation: 'panel-navigation'};
        window.stock = {};
        Object.keys(panels).forEach(name => {
            stock[name] = {
                pressed: false,
                isDisabled: () => false,
                toggle(on) {
                    if (on) Object.keys(stock).forEach(other => { if (other !== name) stock[other].toggle(false); });
                    this.pressed = !!on;
                    document.getElementById(panels[name]).classList.toggle('shown', this.pressed);
                },
                click() { log.push('stock: ' + name); this.toggle(!this.pressed); }
            };
        });
        const layout = name => ({el: $('#' + name), height: null});
        /* The stock layout: the items of Viewport.js, the title hidden, the stock heights of the toolbar and
           the status bar (the shell sets its own on the start). */
        const box = $('#viewport-vbox-layout');
        const vlayout = stockLayout ? new Common.UI.VBoxLayout({box, items: [
            {el: box.find('> #app-title').hide(), alias: 'title', height: 28},
            {el: box.find('> #toolbar'), alias: 'toolbar', height: 104},
            {el: box.find('> .middle'), stretch: true},
            {el: box.find('> #statusbar'), alias: 'statusbar', height: 25}
        ]}) : {items: {toolbar: layout('toolbar'), statusbar: layout('statusbar')},
            getItem(name) { return this.items[name]; }, doLayout() {}};
        const viewport = {viewport: {vlayout, hlayout: {panels: [], doLayout() {}, changeLayout() {}}}};
        const stockController = DE.getController;
        DE.getController = name => {
            if (name === 'Viewport') return viewport;
            const c = stockController(name);
            if (name === 'LeftMenu') {
                /* The panel buttons of the page; the state of the stand-in (SetDisabled) stays with them,
                   out of the list of buttons. */
                if (c && c.leftMenu && c.leftMenu._state)
                    Object.defineProperty(stock, '_state', {value: c.leftMenu._state, configurable: true, writable: true});
                return Object.assign(c || {}, {leftMenu: stock});
            }
            return c;
        };

        window.bubble = DE.Views.SelectionBubble = {
            shown: false,
            isOpen() { return this.shown; },
            dismiss() { this.shown = false; log.push('bubble: dismiss'); },
            hide() { this.shown = false; }
        };
        window.slash = DE.Views.SlashMenu = {open: false, hide() { this.open = false; }};

        const shell = window.shell = DE.Views.CompactShell;
        window.actions = DE.Views.DocumentActions;
        window.rail = DE.Views.OutlineRail;
        /* The api of the stand-in with the scroll of the engine. */
        const api = new Proxy(ctx.api, {get: (target, name) => (name === 'WordControl' ? wordControl : target[name])});
        shell.api = api;
        shell.tb = {
            el: $('#vo-tb'), ctrl: {focus: $('#tb-focus')},
            closeOverflow() { $('#vo-tb').removeClass('vo-of-open'); },
            closePopovers() { $('.vo-pop-wrap.open, .vo-cb.open').removeClass('open'); },
            setCommentsOpen() {}, relayout() {}
        };
        actions.init(api, shell);
        shell.menuAdapter = DE.Views.CompactMenuAdapter.create(shell, api);
        shell.menu = Common.UI.Compact.MenuBar.create(shell.menuAdapter, {pinned: 'help', icons: Icons});
        $('#menu-host').replaceWith(shell.menu.el);
        shell.bindTopScroll();
        rail.create(api);
        shell.reserveLeft = () => true;
        shell.buildHeaderHint();
        shell.watchSelection();
        shell.bindChromeEscape();
        shell.applyLayout(true);
    }, {context, docHeight, stockLayout});
    page.errors = errors;
    return page;
}

/* Two frames: layout and transitions of class changes have run. */
function settle(page) {
    return page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/* What is on the screen: each shell part, the side panels and the shell state (topHidden and cause of the
 * header and menu, focus — collapsed by hand). */
function screen(page) {
    return page.evaluate(() => {
        const visible = el => {
            if (!el) return false;
            const style = getComputedStyle(el);
            if (style.visibility === 'hidden' || !el.getClientRects().length) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const q = s => document.querySelector(s);
        return {
            header: visible(q('.vo-hd')), menu: visible(q('.vo-mn')), toolbar: visible(q('#vo-tb')),
            status: visible(q('#vo-status')), rail: visible(q('#vo-outline .vo-outline-toggle')),
            railOpen: !!rail.open, left: visible(q('#left-menu')), right: visible(q('#right-menu')),
            hint: visible(q('#vo-hf-hint')),
            toolbarArea: q('#toolbar').getBoundingClientRect().height,
            topHidden: shell.topHidden(), cause: shell.top.cause,
            focus: shell.focus, tbHidden: shell.tbHidden, rightOpen: shell.rightOpen,
            panels: Object.keys(stock).filter(k => stock[k].pressed),
            active: document.activeElement && document.activeElement.id
        };
    });
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

module.exports = {ROOT, launch, open, settle, screen, checker};
