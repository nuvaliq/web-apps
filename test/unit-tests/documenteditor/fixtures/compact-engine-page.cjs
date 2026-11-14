/* Browser page with the document engine of sdkjs, for the tests of the compact document scripts.
 * Headless Chrome through Playwright (NODE_PATH or PLAYWRIGHT_MODULE points to the package).
 * The engine is sdkjs itself, read from source: the argument of the test, then SDKJS_DIR, then ../sdkjs
 * next to web-apps. The page loads the word scripts in the order of sdkjs configs/word.json (the files the
 * build concatenates), then the document test harness of sdkjs (tests/word/common): a logic document with
 * a stand-in drawing document and text measurer, and the editor object. Then the guarded script runner of
 * the shell (view/CompactScript.js) over the plugins manager of the engine, as Document Server runs it:
 * the commands go through api.callCommand, its eval and the action of the document.
 * Files come from disk through page.route; nothing goes to the network.
 * In the page: T.doc — the logic document, T.editor — the editor object, T.run(source, scope) — runs the
 * command body given as source text, as callCommand would get it, and resolves with {ok}; T.reset(texts) —
 * a new one-section document of these paragraphs without headers, footers and history; T.caret(p, offset,
 * count) — the caret in a paragraph, count > 0 selects; T.text(p), T.texts(content); T.undo(); T.idle() —
 * the action is closed and no command waits; T.points() — undo steps in the history.
 * bridge(session) gives the guarded script runner the catalog calls (DE.Views.CompactScript in a vm of
 * Node) that runs the bodies in this page.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const ORIGIN = 'http://engine.test';

function sdkjsDir(arg) {
    const explicit = arg || process.env.SDKJS_DIR;
    if (explicit) return explicit;
    const sibling = path.join(ROOT, '../sdkjs');
    return fs.existsSync(path.join(sibling, 'configs/word.json')) ? sibling : null;
}

function playwright() {
    try {
        return require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    } catch (e) {
        return null;
    }
}

/* Why the engine checks cannot run here, or null. */
function unavailable(sdkjs) {
    if (!sdkjs) return 'sdkjs not found: pass its folder as the argument or set SDKJS_DIR';
    if (!fs.existsSync(path.join(sdkjs, 'configs/word.json'))) return 'no configs/word.json in ' + sdkjs;
    if (!fs.existsSync(path.join(sdkjs, 'tests/word/common/document.js'))) return 'no tests/word/common in ' + sdkjs;
    if (!playwright()) return 'Playwright not found: set PLAYWRIGHT_MODULE or NODE_PATH';
    return null;
}

/* The editor around the harness document: the methods of the word api the builder script path calls,
   and the plugins manager that queues commands. */
const SETUP = `(function () {
    var editor = AscTest.Editor;
    /* As the word api says of itself: contents made later (headers, footers, shapes) find the document. */
    editor.isDocumentEditor = true;
    editor.editorId = AscCommon.c_oEditorId.Word;
    var doc = AscTest.CreateLogicDocument();
    var W = AscCommon.DocumentEditorApi.prototype;
    ['canRunBuilderScript', '_onEndBuilderScript', 'isLongAction', 'getJsApi', 'getLogicDocument'].forEach(function (n) {
        if (W[n]) editor[n] = W[n];
    });
    if (!editor.getLogicDocument) editor.getLogicDocument = function () { return this.WordControl.m_oLogicDocument; };
    Asc.createPluginsManager(editor);
    var CS = DE.Views.CompactScript.init(editor);
    var HDR = ['Header_Default', 'Header_First', 'Header_Even', 'Footer_Default', 'Footer_First', 'Footer_Even'];
    window.T = {
        doc: doc,
        editor: editor,
        script: CS,
        run: function (source, scope) {
            var body = (0, eval)('(' + source + ')');
            return CS.run(body, scope);
        },
        /* A new document: one section without headers and footers, the given paragraphs, no history. */
        reset: function (texts) {
            AscTest.ClearDocument();
            var last = doc.GetFinalSectPr();
            HDR.forEach(function (k) { last['Set_' + k](null); });
            last.Set_TitlePage(false);
            doc.Set_DocumentEvenAndOddHeaders(false);
            var paras = (texts || ['']).map(function (text) {
                var p = AscTest.CreateParagraph();
                doc.PushToContent(p);
                if (text) AscTest.AddTextToParagraph(p, text);
                return p;
            });
            doc.RemoveSelection();
            AscTest.MoveCursorToParagraph(paras[0], true);
            AscCommon.History.Clear();
            return paras;
        },
        /* Text of a paragraph (tabs as tabs, no numbering) or of every top paragraph. */
        text: function (p) {
            return p.GetText({Numbering: false, TabSymbol: '\t'});
        },
        texts: function (content) {
            return (content || doc).Content.map(function (el) { return el.IsParagraph() ? T.text(el) : '[table]'; });
        },
        /* The caret at offset of a paragraph; count > 0 selects that many characters from there. */
        caret: function (p, offset, count) {
            doc.RemoveSelection();
            AscTest.MoveCursorToParagraph(p, true);
            if (offset) AscTest.MoveCursorRight(false, false, offset);
            if (count) AscTest.MoveCursorRight(true, false, count);
        },
        undo: function () {
            doc.Document_Undo();
        },
        /* The action of the document is closed and the command queue is empty. */
        idle: function () {
            return !doc.Action.Start && doc.Action.Depth === 0 && !doc.Action.CancelAction
                && window.g_asc_plugins.queueCommands.length === 0;
        },
        points: function () {
            return AscCommon.History.Index + 1;
        }
    };
})();`;

function pageHtml(sdkjs) {
    const cfg = JSON.parse(fs.readFileSync(path.join(sdkjs, 'configs/word.json'), 'utf8')).sdk;
    const files = cfg.min.concat(cfg.common);
    const tag = src => `<script src="${src}"></script>`;
    return ['<!DOCTYPE html><html><head><meta charset="utf-8">',
        tag('/web-apps/vendor/xregexp/xregexp-all-min.js')]
        .concat(files.map(f => tag('/sdkjs/' + f)))
        .concat([
            /* The harness reads QUnit only for its assertions. */
            '<script>window.QUnit = {assert: {close: function () {}, equalRgb: function () {}, equalRgba: function () {}}};</script>',
            tag('/sdkjs/tests/word/common/common.js'), tag('/sdkjs/tests/word/common/editor.js'),
            tag('/sdkjs/tests/word/common/document.js'), tag('/sdkjs/tests/word/common/measurer.js'),
            '<script>window.define = function (deps, factory) { return factory(); };</script>',
            tag('/web-apps/apps/documenteditor/main/app/view/CompactScript.js'),
            '<script>' + SETUP + '</script>',
            '</head><body></body></html>'])
        .join('\n');
}

/* A browser with one engine page; close() closes both. Page errors are collected in errors. */
async function open(sdkjs) {
    const browser = await playwright().chromium.launch({channel: 'chrome', headless: true});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    const html = pageHtml(sdkjs);
    const roots = {'/sdkjs/': sdkjs, '/web-apps/': ROOT};
    await page.route(ORIGIN + '/**', route => {
        const p = decodeURIComponent(new URL(route.request().url()).pathname);
        if (p === '/page.html')
            return route.fulfill({status: 200, headers: {'content-type': 'text/html'}, body: html});
        for (const [prefix, dir] of Object.entries(roots)) {
            if (!p.startsWith(prefix)) continue;
            const file = path.join(dir, p.slice(prefix.length));
            if (file.startsWith(dir) && fs.existsSync(file))
                return route.fulfill({status: 200, headers: {'content-type': 'application/javascript'},
                    body: fs.readFileSync(file)});
        }
        return route.fulfill({status: 404, body: ''});
    });
    await page.goto(ORIGIN + '/page.html');
    await page.waitForFunction(() => !!window.T, null, {timeout: 60000});
    return {browser, page, errors, close: () => browser.close()};
}

/* A CompactScript for the catalog running in Node: run(body, scope) goes to the engine page. */
function bridge(session) {
    return {
        calls: [],
        init() { return this; },
        run(body, scope) {
            this.calls.push({body, scope});
            return session.page.evaluate(([source, data]) => T.run(source, data), [body.toString(), scope]);
        }
    };
}

module.exports = {sdkjsDir, unavailable, open, bridge};
