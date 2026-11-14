/* Run: node test/unit-tests/documenteditor/compact-script-contract.cjs [<sdkjs dir>]
 * Guarded document scripts of the compact shell (view/CompactScript.js): a command either applies
 * as one undo step or changes nothing, and reports {ok: true} only when it applied.
 * The engine side is the code of sdkjs itself, taken from the argument, then SDKJS_DIR, then
 * ../sdkjs next to web-apps: the command queue and the script check of the plugins manager
 * (common/plugins.js), callCommand, the end of a builder script and the long action counter
 * (common/apiBase.js, word/api.js), the strict-mode eval of scripts (common/macros.js), the return
 * check and isValidJs (common/apiCommon.js) and the action lifecycle of the document
 * (word/Editor/Document.js: StartAction, FinalizeAction, CancelAction, the lock check). Around them
 * stand a small document with a text and an undo history, a co-author lock and the Builder Api
 * entry Api.GetDocument().Document. Without sdkjs the engine checks are skipped.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'apps/documenteditor/main/app/view/CompactScript.js');

let passed = 0, failed = 0, skipped = 0;
const queue = [];
function check(name, fn, needsEngine = true) { queue.push({name, fn, needsEngine}); }

function sdkjsDir() {
    const explicit = process.argv[2] || process.env.SDKJS_DIR;
    if (explicit) return explicit;
    const sibling = path.join(ROOT, '../sdkjs');
    return fs.existsSync(path.join(sibling, 'common/plugins.js')) ? sibling : null;
}
const SDKJS = sdkjsDir();
const read = file => fs.readFileSync(path.join(SDKJS, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

/* Text of one function of an sdkjs file: from the first `function` after the marker to the closing
   brace at the indentation of the marker's line. */
function source(text, marker) {
    const at = text.indexOf(marker);
    assert.ok(at >= 0, 'sdkjs has ' + marker);
    const line = text.lastIndexOf('\n', at) + 1;
    const indent = text.slice(line, at).match(/^\s*/)[0];
    const start = text.indexOf('function', at);
    const end = text.indexOf('\n' + indent + '}', start);
    assert.ok(start > 0 && end > start, 'sdkjs function ends: ' + marker);
    return text.slice(start, end + indent.length + 2);
}

/* --- The engine ------------------------------------------------------------------------------ */

function engine({locked = false, canEdit = true} = {}) {
    const files = {
        base: read('common/apiBase.js'), common: read('common/apiCommon.js'), macros: read('common/macros.js'),
        plugins: read('common/plugins.js'), word: read('word/api.js'), doc: read('word/Editor/Document.js')
    };
    const G = vm.createContext({console, setTimeout, setImmediate});
    vm.runInContext('var window = globalThis;', G);
    const fn = (file, marker) => vm.runInContext('(' + source(files[file], marker) + ')', G);

    G.AscDFH = {historydescription_BuilderScript: 1, historydescription_Document_RemoveComplexField: 2,
        historydescription_Document_AddText: 3, historyitem_type_Unknown: 0};
    G.AscFonts = {IsCheckSymbols: false};
    G.Asc = {checkReturnCommand: fn('common', 'window["Asc"].checkReturnCommand = function')};
    G.AscCommon = {
        c_oEditorId: {Word: 0, Spreadsheet: 1, Presentation: 2},
        parseJSDoc: () => [],
        isValidJs: fn('common', 'function isValidJs(str)'),
        /* Fonts of a builder script load asynchronously: the end of a script waits for them. */
        g_font_loader: {LoadFonts(fonts, cb) { setImmediate(cb); }}
    };
    G.customXMLHttpRequest = function () {};
    G._safePluginEval = fn('macros', 'function _safePluginEval(value)');
    G.AscCommon.safePluginEval = fn('macros', "window['AscCommon'].safePluginEval = function");

    /* History: one point per action; undo reverts the last point. */
    const history = {
        points: [], index: -1,
        Create_NewPoint(description) {
            this.points.length = this.index + 1;
            this.points.push({description, items: []});
            this.index++;
            return true;
        },
        Add(item) { this.points[this.index].items.push(item); },
        Is_LastPointEmpty() { return this.index < 0 || this.points[this.index].items.length === 0; },
        Remove_LastPoint() { this.points.splice(this.index, 1); this.index--; },
        Undo() {
            const point = this.points[this.index--];
            for (const item of point.items.slice().reverse()) item.undo();
            return point.items;
        },
        ClearRedo() { this.points.length = this.index + 1; },
        checkLock() {}
    };
    G.AscCommon.History = history;

    const world = {locked, canEdit, history};
    const doc = {
        Action: {Start: false, Depth: 0, PointsCount: 0, Description: 0, Recalculate: false, CancelAction: false,
            CheckLock: false, UpdateSelection: false, UpdateInterface: false, UpdateRulers: false,
            UpdateUndoRedo: false, UpdateStates: false, ScrollToTarget: true, Redraw: {}, UndoRedo: false,
            Additional: {}},
        History: history,
        text: '',
        CollaborativeEditing: {
            Clear_DocumentPositions() {}, Get_GlobalLock: () => false, OnStart_CheckLock() {},
            OnEnd_CheckLock: () => world.locked
        },
        CanEdit: () => world.canEdit,
        /* An internal change without its own action, as the Builder API makes them. */
        Write(text) {
            const before = this.text;
            this.History.Add({undo: () => { this.text = before; }});
            this.text += text;
        },
        /* An internal operation with its own nested action that fails half way. */
        Nested(text) {
            this.StartAction(AscDFHRemove);
            this.Write(text);
            throw new Error('failure inside the nested operation, before its FinalizeAction');
        },
        sendEvent() {}, PauseRecalculate() {}, ResumeRecalculate() {}, private_CheckAdditionalOnFinalize() {},
        RecalculateByChanges() {}, private_Recalculate() { return 0; }, private_Redraw() {},
        IsFillingFormMode: () => false, GetCurrentParagraph: () => null, private_CheckCursorPosInFillingFormMode() {},
        Recalculate() {}, UpdateSelection() {}, UpdateInterface() {},
        Document_UpdateSelectionState() {}, Document_UpdateInterfaceState() {}
    };
    const AscDFHRemove = G.AscDFH.historydescription_Document_RemoveComplexField;
    for (const name of ['StartAction', 'IsActionStarted', 'IsMultiplePointAction', 'FinalizeAction', 'CancelAction',
        'CheckActionLock', 'private_CheckEmptyPointsInAction', 'private_CheckActionLock', 'StartSelectionLockCheck',
        'EndSelectionLockCheck', 'GetApi'])
        doc[name] = fn('doc', 'CDocument.prototype.' + name + ' = function');

    const editor = {
        editorId: 0, WordControl: {m_oLogicDocument: doc}, IsLongActionCurrent: 0,
        LongActionCallbacks: [], LongActionCallbacksParams: [], builderFonts: {}, builderEndActions: [],
        isLogPluginCommands: () => false, getLogicDocument: () => doc,
        executeGroupActionsStart() {}, executeGroupActionsEnd() {}, checkChangesSize() {},
        getMacroRecorder: () => ({addStepData() {}}),
        /* Stock: panel styles are locked for the script, and its end waits for fonts and images. */
        _beforeEvalCommand() { this.evalCommand = true; },
        _afterEvalCommand(end) { this.evalCommand = false; setImmediate(end); }
    };
    doc.Api = editor;
    for (const [file, name] of [['base', 'callCommand'], ['base', 'onEndBuilderScript'], ['base', 'loadBuilderFonts'],
        ['base', '_executeBuilderEndActions'], ['base', 'isLongActionBase'], ['base', 'incrementCounterLongAction'],
        ['base', 'decrementCounterLongAction'], ['word', 'canRunBuilderScript'], ['word', '_onEndBuilderScript'],
        ['word', 'isLongAction'], ['word', 'getJsApi']]) {
        const owner = file === 'base' ? 'baseEditorsApi' : 'asc_docs_api';
        editor[name] = fn(file, owner + '.prototype.' + name + ' ');
    }

    const tasks = files.plugins.indexOf('var CommandTaskType = {');
    assert.ok(tasks > 0, 'sdkjs has CommandTaskType');
    G.CommandTaskType = vm.runInContext('(' + files.plugins.slice(tasks + 'var CommandTaskType = '.length,
        files.plugins.indexOf('};', tasks) + 1) + ')', G);
    G.CCommandTask = fn('plugins', 'function CCommandTask(type, guid)');
    G.g_asc_plugins = {
        api: editor, queueCommands: [], internalGuid: 'onlyoffice_internal_guid', internalCallbacks: [],
        internalCommandAsync: false, runnedPluginsMap: {},
        shiftCommand: fn('plugins', 'shiftCommand : function'),
        callCommand: fn('plugins', 'callCommand : function'),
        callCommandInternal: fn('plugins', 'callCommandInternal : function')
    };

    /* The Builder API entry the script uses. */
    G.AscBuilder = {Word: {Api: {GetDocument: () => ({Document: world.document})}}};
    world.document = doc;

    G.define = (deps, factory) => factory();
    vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), G, {filename: SCRIPT});
    world.G = G;
    world.doc = doc;
    world.editor = editor;
    world.script = G.DE.Views.CompactScript.init(editor);
    /* A change of the user before the command: its own action and history point. */
    world.userTypes = text => {
        doc.StartAction(G.AscDFH.historydescription_Document_AddText);
        doc.Write(text);
        doc.FinalizeAction();
    };
    world.undo = () => { history.Undo(); };
    /* Results come from the engine context: compare them as plain data. */
    world.run = async (body, scope) => plain(await world.script.run(body, scope));
    return world;
}

/* After any command the action is closed and nothing is left to cancel. */
function closed(world) {
    const a = world.doc.Action;
    assert.equal(a.Start, false, 'the action is closed');
    assert.equal(a.Depth, 0, 'the depth is back');
    assert.equal(a.CancelAction, false, 'no pending cancel');
    assert.equal(world.G.g_asc_plugins.queueCommands.length, 0, 'the command queue is empty');
}

/* --- Checks ---------------------------------------------------------------------------------- */

check('a successful command changes the document and one undo reverts it', async () => {
    const w = engine();
    w.userTypes('user ');
    const result = await w.run(function (s) {
        s.document.Write(s.scope.text);
        s.document.Write('!');
        return s.editor === s.document.GetApi() && typeof s.Api.GetDocument === 'function';
    }, {text: 'added'});
    assert.deepEqual(result, {ok: true});
    assert.equal(w.doc.text, 'user added!');
    closed(w);
    assert.equal(w.history.points.length, 2, 'the command is one history point');
    w.undo();
    assert.equal(w.doc.text, 'user ', 'one undo reverts the command and keeps the user change');
});

check('failed check leaves the document untouched', async () => {
    for (const missing of ['GetApi', 'FinalizeAction', 'CancelAction', 'Action']) {
        const w = engine();
        w.userTypes('user');
        const stripped = Object.create(w.doc);
        stripped[missing] = undefined;
        w.document = stripped;
        const result = await w.run(function (s) { s.document.Write('x'); return true; });
        assert.deepEqual(result, {ok: false}, missing);
        assert.equal(w.doc.text, 'user', missing + ': the document is untouched');
        closed(w);
        assert.equal(w.history.points.length, 1, missing + ': no history point is left');
    }
    /* No Builder API document at all. */
    const w = engine();
    w.G.AscBuilder.Word.Api.GetDocument = () => null;
    assert.deepEqual(await w.run(function (s) { s.document.Write('x'); return true; }), {ok: false});
    assert.equal(w.doc.text, '');
    closed(w);
});

check('error after the first change cancels the whole action', async () => {
    const w = engine();
    w.userTypes('user');
    const result = await w.run(function (s) {
        s.document.Write(' one');
        s.document.Write(' two');
        throw new Error('fails after two changes');
    });
    assert.deepEqual(result, {ok: false});
    assert.equal(w.doc.text, 'user', 'both changes are rolled back');
    closed(w);
    assert.equal(w.history.points.length, 1, 'no point of the command is left, the user point stays');
});

check('error before any change leaves the previous user change', async () => {
    const w = engine();
    w.userTypes('user');
    const result = await w.run(function () { throw new Error('fails before any change'); });
    assert.deepEqual(result, {ok: false});
    assert.equal(w.doc.text, 'user');
    closed(w);
    assert.equal(w.history.points.length, 1);
    assert.equal(w.history.index, 0, 'the user change is still the last undo step');
    w.undo();
    assert.equal(w.doc.text, '', 'the user change is undone by its own step');
});

check('lock refusal reports a failure', async () => {
    /* A co-author holds the place: the engine cancels the action on FinalizeAction. */
    const locked = engine({locked: true});
    locked.userTypes('user');
    assert.deepEqual(await locked.run(function (s) { s.document.Write(' x'); return true; }), {ok: false});
    assert.equal(locked.doc.text, 'user');
    closed(locked);
    assert.equal(locked.history.points.length, 1);
    /* View and protection: the document cannot be edited, the same check refuses. */
    const view = engine({canEdit: false});
    assert.deepEqual(await view.run(function (s) { s.document.Write('x'); return true; }), {ok: false});
    assert.equal(view.doc.text, '');
    closed(view);
});

check('two queued commands do not undo each other', async () => {
    const w = engine();
    w.userTypes('user');
    const add = function (s) { s.document.Write(s.scope.text); return true; };
    const fail = function (s) { s.document.Write(s.scope.text); throw new Error('second fails'); };
    /* Started together: the second waits in the queue while the first waits for its fonts. */
    const [a, b, c] = await Promise.all([w.run(add, {text: ' a'}), w.run(fail, {text: ' b'}), w.run(add, {text: ' c'})]);
    assert.deepEqual([a, b, c], [{ok: true}, {ok: false}, {ok: true}]);
    assert.equal(w.doc.text, 'user a c', 'the failed command rolls back only itself');
    closed(w);
    assert.equal(w.history.points.length, 3, 'user, first and third command — one point each');
    w.undo();
    assert.equal(w.doc.text, 'user a');
    w.undo();
    assert.equal(w.doc.text, 'user');
});

check('undefined result is reported as not applied', async () => {
    /* A body that does not say true is cancelled, even when it changed something. */
    const w = engine();
    assert.deepEqual(await w.run(function (s) { s.document.Write('x'); }), {ok: false});
    assert.equal(w.doc.text, '');
    closed(w);
    assert.deepEqual(await w.run(function (s) { s.document.Write('x'); return 1; }), {ok: false});
    assert.equal(w.doc.text, '');
});

check('callback values other than {ok: true} are not applied', async () => {
    const G = vm.createContext({console});
    vm.runInContext('var window = globalThis;', G);
    G.define = (deps, factory) => factory();
    vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), G, {filename: SCRIPT});
    const original = G.DE.Views.CompactScript;
    const script = {
        init: api => original.init(api),
        run: async (body, scope) => plain(await original.run(body, scope))
    };
    G.g_asc_plugins = {};
    for (const value of [undefined, null, true, {}, {ok: 'yes'}, {ok: 1}, 'ok']) {
        let text = null;
        script.init({callCommand(t, recalc, cb) { text = t; assert.equal(recalc, true); cb(value); }});
        assert.deepEqual(await script.run(function () { return true; }), {ok: false}, JSON.stringify(value));
        assert.equal(typeof text, 'string', 'the command is sent as script text');
    }
    script.init({callCommand(t, recalc, cb) { cb({ok: true}); }});
    assert.deepEqual(await script.run(function () { return true; }), {ok: true});
    /* Without the plugins manager callCommand returns without its callback: not sent at all. */
    delete G.g_asc_plugins;
    let sent = 0;
    script.init({callCommand() { sent++; }});
    assert.deepEqual(await script.run(function () { return true; }), {ok: false});
    assert.equal(sent, 0);
    /* No editor, no body, a throwing editor, data that are not JSON. */
    G.g_asc_plugins = {};
    script.init(null);
    assert.deepEqual(await script.run(function () { return true; }), {ok: false});
    script.init({callCommand() { throw new Error('engine failure'); }});
    assert.deepEqual(await script.run(function () { return true; }), {ok: false});
    assert.deepEqual(await script.run(null), {ok: false});
    const cyclic = {};
    cyclic.self = cyclic;
    assert.deepEqual(await script.run(function () { return true; }, cyclic), {ok: false});
}, false);

check('error inside a nested operation leaves no changes and the action closed before the next command', async () => {
    const w = engine();
    w.userTypes('user');
    const result = await w.run(function (s) {
        s.document.Write(' before');
        s.document.Nested(' inside');
        return true;
    });
    assert.deepEqual(result, {ok: false});
    assert.equal(w.doc.text, 'user', 'changes before and inside the nested action are rolled back');
    closed(w);
    assert.equal(w.history.points.length, 1);
    /* A body that leaves its nested action open without an error is not applied either. */
    assert.deepEqual(await w.run(function (s) {
        s.document.StartAction(2);
        s.document.Write(' open');
        return true;
    }), {ok: false});
    assert.equal(w.doc.text, 'user');
    closed(w);
    /* The next command works and is its own undo step. */
    assert.deepEqual(await w.run(function (s) { s.document.Write(' next'); return true; }), {ok: true});
    assert.equal(w.doc.text, 'user next');
    w.undo();
    assert.equal(w.doc.text, 'user');
});

check('long action reports not applied', async () => {
    const w = engine();
    w.userTypes('user');
    w.editor.incrementCounterLongAction();
    assert.deepEqual(await w.run(function (s) { s.document.Write(' x'); return true; }), {ok: false});
    assert.equal(w.doc.text, 'user', 'the script did not run');
    closed(w);
    assert.equal(w.history.points.length, 1, 'no action was started');
    w.editor.decrementCounterLongAction();
    assert.deepEqual(await w.run(function (s) { s.document.Write(' x'); return true; }), {ok: true});
    assert.equal(w.doc.text, 'user x');
});

check('the script passes the engine code check and runs in strict mode without the host editor', async () => {
    const w = engine();
    const text = w.script.script(function () { return true; }, {a: 1});
    assert.equal(w.G.AscCommon.isValidJs(text), true);
    assert.doesNotMatch(text, /\bimport\b/, 'the engine refuses scripts with import');
    /* Inside the script Asc is its own empty object, the host editor is not reachable. */
    w.G.Asc.editor = {host: true};
    const result = await w.run(function (s) {
        s.document.Write(typeof Asc.editor + ' ' + s.scope.a + ' ' + (this === undefined));
        return true;
    }, {a: 7});
    assert.deepEqual(result, {ok: true});
    assert.equal(w.doc.text, 'undefined 7 true');
});

check('internal names match the engine sources', () => {
    const doc = read('word/Editor/Document.js');
    const builder = read('word/apiBuilder.js');
    const word = read('word/api.js');
    const macros = read('common/macros.js');
    const base = read('common/apiBase.js');
    const G = vm.createContext({});
    vm.runInContext('var window = globalThis;', G);
    G.define = (deps, factory) => factory();
    vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), G, {filename: SCRIPT});
    const names = G.DE.Views.CompactScript.ENGINE;
    const action = doc.slice(doc.indexOf('\tthis.Action = {'), doc.indexOf('\tthis.Action = {') + 800);
    for (const name of names) {
        if (name === 'Action') assert.ok(action.startsWith('\tthis.Action = {'), 'CDocument has Action');
        else if (name === 'Action.Depth') assert.match(action, /\n\t\tDepth\s*:\s*0,/, 'Action has Depth');
        else assert.ok(doc.includes('\nCDocument.prototype.' + name + ' = function'), 'CDocument.prototype.' + name);
    }
    /* Builder entry: the script reaches the document through Api.GetDocument().Document. */
    assert.ok(builder.includes('Api.GetDocument = function'), 'Api.GetDocument');
    assert.match(builder, /function ApiDocument\(Document\)\s*\{\s*ApiDocumentContent\.call\(this, Document\);/);
    assert.match(builder, /function ApiDocumentContent\(Document\)\s*\{\s*this\.Document = Document;/);
    assert.match(word, /asc_docs_api\.prototype\.getJsApi = function\(\)\s*\{\s*return AscBuilder\.Word\.Api;/);
    assert.match(macros, /"Api":\s*Api,/, 'the script gets Api');
    /* callCommand takes a text as it is and the end of the script answers with FinalizeAction. */
    assert.match(source(base, 'baseEditorsApi.prototype.callCommand '), /typeof value === "string"/);
    assert.match(source(word, 'asc_docs_api.prototype._onEndBuilderScript '), /let result = logicDocument\.FinalizeAction\(\);/);
    /* Internal methods the compact commands use inside their scripts. */
    const owners = {
        GetAllFields: ['word/Editor/DocumentContent.js', 'CDocumentContent'],
        RemoveField: ['word/Editor/Paragraph/ComplexField.js', 'CComplexField'],
        RemoveFromContent: ['word/Editor/Run.js', 'ParaRun'],
        RemoveThisFromParent: ['word/Editor/ParagraphContentBase.js', 'CParagraphContentBase'],
        IsUseInDocument: ['word/Editor/Paragraph/ParaDrawing.js', 'ParaDrawing']
    };
    for (const [name, [file, owner]] of Object.entries(owners))
        assert.ok(read(file).includes(owner + '.prototype.' + name + ' = function'), owner + '.prototype.' + name);
});

/* --- Run ------------------------------------------------------------------------------------- */

(async () => {
    if (SDKJS) console.log('sdkjs:', SDKJS);
    for (const {name, fn, needsEngine} of queue) {
        if (needsEngine && !SDKJS) {
            console.log('SKIP', name, '— sdkjs not found next to web-apps (pass its path or set SDKJS_DIR)');
            skipped++;
            continue;
        }
        /* A command that never answers would end the process quietly: each check has a deadline. */
        let timer;
        const deadline = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('did not settle in 5 s')), 5000);
        });
        try { await Promise.race([fn(), deadline]); console.log('PASS', name); passed++; }
        catch (error) { console.error('FAIL', name, error.stack || error.message); failed++; }
        finally { clearTimeout(timer); }
    }
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
    process.exit(failed ? 1 : 0);
})();
