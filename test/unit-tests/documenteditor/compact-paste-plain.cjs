/* Run: node test/unit-tests/documenteditor/compact-paste-plain.cjs [<sdkjs dir>]
 * "Paste without formatting" of the compact Edit menu (DocumentActions.pastePlain and its document
 * script): the clipboard text goes in as paragraphs at the caret, the formatting comes from the place of
 * the caret, a selection is replaced, and the command either applies as one undo step or leaves the
 * document as it was. When the browser does not give the clipboard, the menu shows the two-step hint.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs; the clipboard of
 * the browser is the test's own. The document script runs in the engine of sdkjs itself in headless
 * Chrome (fixtures/compact-engine-page.cjs): sdkjs is taken from the argument, then SDKJS_DIR, then
 * ../sdkjs next to web-apps; without it or without Playwright the engine checks are skipped.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const docs = require('../common/compact/lib/documents-editor.cjs');
const engine = require('./fixtures/compact-engine-page.cjs');

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const actions = G.DE.Views.DocumentActions;
const command = k => actions.command(k);
const plain = value => JSON.parse(JSON.stringify(value));
const rows = (items, ctx) => plain(Model.section(items, ctx).rows.map(r => (r.kind === 'sep' ? '—' : r.k)));

const SDKJS = engine.sdkjsDir(process.argv[2]);
const WHY = engine.unavailable(SDKJS);

const HINT = 'Paste with Ctrl+V, then choose Paste options → Keep text only for the pasted text';
const HINT_MAC = 'Paste with ⌘V, then choose Paste options → Keep text only for the pasted text';

/* The hint goes away by a timer of 5 s: the timers of the editor are the test's own. */
const timers = [];
G.setTimeout = (fn, ms) => { timers.push({fn, ms}); return timers.length; };
G.clearTimeout = () => {};

let session = null;
let runner = null;

/* The editor with the menu bar status place, a clipboard that gives `clip` (a string), refuses
   (`denied`) or is absent (`clip` undefined), and the platform. */
function world({clip, denied = false, mac = false} = {}) {
    const ctx = docs.context();
    const status = {textContent: ''};
    ctx.shell.menu = {status: () => status};
    G.Common.Utils.isMac = mac;
    const reads = [];
    G.navigator = clip === undefined && !denied ? {} : {
        clipboard: {
            readText() {
                reads.push(1);
                return denied ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(clip);
            }
        }
    };
    if (runner) runner.calls.length = 0;
    return {ctx, status, reads};
}

const page = (fn, arg) => session.page.evaluate(fn, arg);

/* --- Checks ---------------------------------------------------------------------------------- */

const queue = [];
function check(name, fn, needsEngine = true) { queue.push({name, fn, needsEngine}); }

check('paste without formatting stands after paste with its shortcut', () => {
    const ctx = docs.context();
    const edit = docs.sections().find(s => s.k === 'edit');
    const keys = rows(edit.items, ctx);
    assert.equal(keys[keys.indexOf('edit.paste') + 1], 'edit.pastePlain', 'right after Paste');
    const it = command('edit.pastePlain');
    assert.equal(it.t, 'Paste without formatting');
    assert.equal(it.i, 'pastePlain', 'has its own icon');
    assert.equal(Model.kindOf(it), 'action');
    /* The stock shortcut of the editor for the same action (sdkjs word/apiDefines.js). */
    assert.equal(it.sc, 'PasteTextWithoutFormat');
    const definesFile = SDKJS && path.join(SDKJS, 'word/apiDefines.js');
    if (definesFile && fs.existsSync(definesFile)) {
        const defines = fs.readFileSync(definesFile, 'utf8');
        assert.match(defines, /\bPasteTextWithoutFormat\s*:\s*\d+/, 'the engine knows the shortcut action');
    }
    /* Only for those who edit; greyed with the editing reasons and without the script call. */
    assert.equal(Model.state(it, docs.context({rights: 'view'})).visible, false, 'not shown to a viewer');
    for (const reason of ['view', 'offline', 'protected', 'form'])
        assert.equal(Model.state(it, docs.context({reasons: [reason]})).reason, reason, reason);
    assert.equal(Model.state(it, docs.context({missing: ['callCommand']})).disabled, true, 'greyed without callCommand');
    assert.equal(Model.state(it, ctx).disabled, false);
}, false);

check('the text comes from the clipboard as it is when the menu item runs', async () => {
    const w = world({clip: 'a\r\nb\rc\n\nd'});
    const calls = [];
    const saved = G.DE.Views.CompactScript;
    G.DE.Views.CompactScript = {init() { return this; }, run: (body, scope) => { calls.push({body, scope}); return Promise.resolve({ok: true}); }};
    try {
        assert.equal(docs.adapter(w.ctx).exec(command('edit.pastePlain')), true);
        assert.equal(w.reads.length, 1, 'the clipboard is read at the click');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls.length, 1);
        assert.equal(calls[0].body, actions.SCRIPTS.pastePlain, 'the paste script runs');
        assert.deepEqual(plain(calls[0].scope), {lines: ['a', 'b', 'c', '', 'd']}, 'CRLF and CR become line ends');
        assert.equal(w.status.textContent, '', 'no hint after a paste');
    } finally {
        G.DE.Views.CompactScript = saved;
    }
}, false);

check('denied clipboard shows the two-step hint', async () => {
    for (const mac of [false, true]) {
        const w = world({denied: true, mac});
        timers.length = 0;
        assert.equal(await actions.pastePlain(), false);
        assert.equal(w.reads.length, 1);
        assert.equal(w.status.textContent, mac ? HINT_MAC : HINT);
        assert.equal(runner ? runner.calls.length : 0, 0, 'nothing goes to the document');
        assert.deepEqual(timers.map(t => t.ms), [5000], 'the hint goes away after 5 s');
        timers[0].fn();
        assert.equal(w.status.textContent, '');
    }
}, false);

check('missing clipboard API shows the same hint', async () => {
    const w = world({});
    assert.equal(await actions.pastePlain(), false);
    assert.equal(w.status.textContent, HINT);
    /* A browser whose readText throws at once. */
    const w2 = world({clip: 'x'});
    G.navigator.clipboard.readText = () => { throw new Error('not allowed'); };
    assert.equal(await actions.pastePlain(), false);
    assert.equal(w2.status.textContent, HINT);
}, false);

check('the hint of plain paste is in the locales', () => {
    const read = lang => JSON.parse(fs.readFileSync(path.join(__dirname, '../../../apps/documenteditor/main/locale',
        lang + '.json'), 'utf8'));
    const en = read('en'), ru = read('ru');
    const key = 'DE.Views.DocumentActions.textMenuPastePlainHint';
    assert.equal(en[key], actions.textMenuPastePlainHint);
    assert.equal(ru[key], 'Вставьте сочетанием {0}, затем у вставленного текста выберите ' +
        '„Параметры вставки → Сохранить только текст“');
    assert.equal(ru['DE.Views.DocumentActions.textMenuPastePlain'], 'Вставить без форматирования');
}, false);

check('paste without formatting is greyed in a content control that cannot be edited', () => {
    for (const k of ['edit.pastePlain']) {
        const it = command(k);
        for (const control of [{lock: 'SdtContentLocked'}, {lock: 'ContentLocked'}, {type: 'CheckBox'},
            {type: 'Picture'}, {type: 'DropDownList'}]) {
            const state = Model.state(it, docs.context({control}));
            assert.equal(state.reason, 'controlLocked', k + ': ' + JSON.stringify(control));
            assert.equal(state.title || docs.reasonText(state.reason), 'The content control cannot be edited');
        }
        for (const control of [{}, {lock: 'SdtLocked'}, {type: 'ComboBox'}, {type: 'DateTime'}])
            assert.equal(Model.state(it, docs.context({control})).disabled, false, k + ': ' + JSON.stringify(control));
        /* A common reason stays the senior one. */
        assert.equal(Model.state(it, docs.context({control: {lock: 'SdtContentLocked'}, reasons: ['view']})).reason, 'view');
    }
}, false);

/* The document of the engine as the menu asks it: what the whole selection holds (CheckAllSelection)
   and what stands at the caret, each a list of content controls that cannot be edited. */
function engineDoc({whole = [], near = []} = {}) {
    const sdt = () => ({IsSelectedAll: () => false, CanBeEdited: () => false, CanBeDeleted: () => true});
    const info = list => ({GetAllSdts: () => list.map(sdt), GetInlineLevelSdt: () => null, GetBlockLevelSdt: () => null});
    return {
        IsSelectionUse: () => true,
        GetSelectedElementsInfo: pr => info(pr && pr.CheckAllSelection ? whole : near)
    };
}

check('paste without formatting asks the engine about the whole selection, shape about the caret', () => {
    const at = (k, doc, extra) => Model.state(command(k), docs.context(Object.assign(
        {engine: {getLogicDocument: () => doc}}, extra)));
    /* The selection runs from the text into a locked control: only the whole selection shows it. */
    const across = engineDoc({whole: ['locked']});
    assert.equal(at('edit.pastePlain', across).reason, 'controlLocked');
    assert.equal(at('insert.textBox', across).disabled, false, 'a shape does not replace the selection');
    const inside = engineDoc({whole: ['locked'], near: ['locked']});
    for (const k of ['edit.pastePlain', 'insert.textBox', 'insert.shape'])
        assert.equal(at(k, inside).reason, 'controlLocked', k);
    /* The engine answers for the control at the caret too. */
    for (const k of ['edit.pastePlain', 'insert.textBox'])
        assert.equal(at(k, engineDoc(), {control: {lock: 'SdtContentLocked'}}).disabled, false, k);
}, false);

/* --- In the engine --------------------------------------------------------------------------- */

check('plain paste inserts clipboard text as paragraphs', async () => {
    await page(() => { const p = T.reset(['Hello world', 'Next']); T.caret(p[0], 5); });
    const w = world({clip: 'first line\nsecond line'});
    assert.equal(await actions.pastePlain(), true);
    assert.equal(runner.calls.length, 1);
    const after = await page(() => ({texts: T.texts(), idle: T.idle(), points: T.points()}));
    assert.deepEqual(after.texts, ['Hellofirst line\r\n', 'second line world\r\n', 'Next\r\n']);
    assert.equal(after.idle, true, 'the action is closed');
    assert.equal(after.points, 1, 'one undo step');
    assert.equal(w.status.textContent, '');
    /* The caret stands after the pasted text. */
    await page(() => AscTest.EnterText('|'));
    assert.equal((await page(() => T.texts()))[1], 'second line| world\r\n');
    await page(() => { T.undo(); T.undo(); });
    assert.deepEqual(await page(() => T.texts()), ['Hello world\r\n', 'Next\r\n'], 'one undo reverts the paste');
});

check('plain paste passes keep-text-only', async () => {
    /* The caret stands in bold text: the pasted text takes the formatting of that place. */
    await page(() => {
        const p = T.reset(['']);
        const run = AscTest.AddTextToParagraph(p[0], 'Bold');
        run.SetBold(true);
        T.caret(p[0], 4);
        const proto = Object.getPrototypeOf(AscBuilder.Word.Api.GetDocument());
        window.inserted = [];
        window.insertContent = proto.InsertContent;
        proto.InsertContent = function (content, inline, pr) {
            window.inserted.push(pr ? JSON.parse(JSON.stringify(pr)) : null);
            return window.insertContent.apply(this, arguments);
        };
    });
    try {
        world({clip: 'plain\nmore'});
        assert.equal(await actions.pastePlain(), true);
        const out = await page(() => {
            const bold = [];
            T.doc.Content.forEach(p => p.CheckRunContent(r => {
                const text = r.GetText().replace(/\r\n$/, '');
                if (text) bold.push([text, r.Get_Bold()]);
            }));
            return {inserted: window.inserted, bold, texts: T.texts()};
        });
        assert.ok(out.inserted.length > 0);
        for (const pr of out.inserted) assert.deepEqual(pr, {KeepTextOnly: true}, 'every insertion keeps text only');
        assert.deepEqual(out.texts, ['Boldplain\r\n', 'more\r\n']);
        assert.deepEqual(out.bold, [['Bold', true], ['plain', true], ['more', true]], 'formatting of the caret place');
    } finally {
        await page(() => { Object.getPrototypeOf(AscBuilder.Word.Api.GetDocument()).InsertContent = window.insertContent; });
    }
});

check('refused insertion cancels and restores the selected text', async () => {
    await page(() => {
        const p = T.reset(['Keep this text']);
        T.caret(p[0], 5, 4);
        const proto = Object.getPrototypeOf(AscBuilder.Word.Api.GetDocument());
        window.insertContent = proto.InsertContent;
        /* The engine refuses quietly, as InsertContent does: true and nothing inserted. */
        proto.InsertContent = function () { return true; };
    });
    try {
        const w = world({clip: 'new'});
        assert.equal(await actions.pastePlain(), false);
        const out = await page(() => ({texts: T.texts(), idle: T.idle(), points: T.points(), selected: T.doc.GetSelectedText()}));
        assert.deepEqual(out.texts, ['Keep this text\r\n'], 'the selected text is back');
        assert.equal(out.selected, 'this');
        assert.equal(out.idle, true);
        assert.equal(out.points, 0, 'nothing left in the history');
        assert.equal(w.status.textContent, HINT, 'the menu says how to paste instead');
    } finally {
        await page(() => { Object.getPrototypeOf(AscBuilder.Word.Api.GetDocument()).InsertContent = window.insertContent; });
    }
});

check('lf, crlf and empty-line text pass the length check', async () => {
    for (const [clip, texts] of [
        ['one\ntwo', ['Aone\r\n', 'twoZ\r\n']],
        ['one\r\ntwo', ['Aone\r\n', 'twoZ\r\n']],
        ['one\rtwo', ['Aone\r\n', 'twoZ\r\n']],
        ['one\n\ntwo', ['Aone\r\n', '\r\n', 'twoZ\r\n']],
        ['one\n', ['Aone\r\n', 'Z\r\n']],
        ['\none', ['A\r\n', 'oneZ\r\n']],
        ['tab\there', ['Atab\there' + 'Z\r\n']]
    ]) {
        await page(() => { const p = T.reset(['AZ']); T.caret(p[0], 1); });
        world({clip});
        assert.equal(await actions.pastePlain(), true, JSON.stringify(clip));
        assert.deepEqual(await page(() => T.texts()), texts, JSON.stringify(clip));
        assert.equal(await page(() => T.points()), 1);
    }
});

check('paste in the middle of a paragraph followed by a non-empty paragraph passes the check', async () => {
    await page(() => { const p = T.reset(['Before', 'Left right', 'After text']); T.caret(p[1], 4); });
    world({clip: 'x\ny\nz'});
    assert.equal(await actions.pastePlain(), true);
    assert.deepEqual(await page(() => T.texts()),
        ['Before\r\n', 'Leftx\r\n', 'y\r\n', 'z right\r\n', 'After text\r\n'], 'the neighbours stay apart');
});

check('replacing a selection across paragraphs passes the check', async () => {
    await page(() => { const p = T.reset(['First para', 'Second para', 'Third']); T.caret(p[0], 5, 9); });
    assert.equal(await page(() => T.doc.GetSelectedText()), ' para\r\nSec');
    world({clip: 'X\nY'});
    assert.equal(await actions.pastePlain(), true);
    /* The paragraphs at the ends of the selection join, as with a paste by the keys. */
    assert.deepEqual(await page(() => T.texts()), ['FirstX\r\n', 'Yond para\r\n', 'Third\r\n']);
    await page(() => T.undo());
    assert.deepEqual(await page(() => T.texts()), ['First para\r\n', 'Second para\r\n', 'Third\r\n'], 'one undo');
});

check('inserted text must match the clipboard', async () => {
    await page(() => {
        const p = T.reset(['Hello world']);
        T.caret(p[0], 5);
        const proto = Object.getPrototypeOf(AscBuilder.Word.Api.GetDocument());
        window.insertContent = proto.InsertContent;
        /* The engine inserts, but not the text it was given. */
        proto.InsertContent = function (content) {
            content.forEach(p => p.AddText('?'));
            return window.insertContent.apply(this, arguments);
        };
    });
    try {
        for (const clip of ['one', 'one\ntwo']) {
            await page(() => { const p = T.reset(['Hello world']); T.caret(p[0], 5); });
            const w = world({clip});
            assert.equal(await actions.pastePlain(), false, clip);
            assert.deepEqual(await page(() => T.texts()), ['Hello world\r\n'], clip + ': nothing changed');
            assert.equal(await page(() => T.idle() && T.points() === 0), true);
            assert.equal(w.status.textContent, HINT);
        }
    } finally {
        await page(() => { Object.getPrototypeOf(AscBuilder.Word.Api.GetDocument()).InsertContent = window.insertContent; });
    }
});

check('empty clipboard leaves the document unchanged', async () => {
    await page(() => { const p = T.reset(['Hello world']); T.caret(p[0], 5, 3); });
    const w = world({clip: ''});
    assert.equal(await actions.pastePlain(), false);
    assert.equal(runner.calls.length, 0, 'no script runs');
    const out = await page(() => ({texts: T.texts(), points: T.points(), selected: T.doc.GetSelectedText()}));
    assert.deepEqual(out.texts, ['Hello world\r\n']);
    assert.equal(out.selected, ' wo', 'the selection stays');
    assert.equal(out.points, 0);
    assert.equal(w.status.textContent, '', 'and no hint');
});

check('paste into a list item ignores numbering', async () => {
    await page(() => {
        const p = T.reset(['Item one']);
        T.caret(p[0], 8);
        AscTest.AddNumbering(1, 1);
        AscCommon.History.Clear();
        T.caret(p[0], 4);
    });
    assert.match(await page(() => T.doc.Content[0].GetText()), /^1\.\tItem one/, 'the item is numbered');
    world({clip: 'x\ny'});
    assert.equal(await actions.pastePlain(), true);
    const out = await page(() => ({texts: T.texts(), numbered: T.doc.Content.map(p => !!p.GetNumPr())}));
    assert.deepEqual(out.texts, ['Itemx\r\n', 'y one\r\n']);
    assert.deepEqual(out.numbered, [true, true], 'both lines stay in the list');
});

check('paste into the last paragraph of a table cell passes the length check', async () => {
    const out = await page(async () => {
        T.reset(['Before']);
        const table = AscTest.CreateTable(1, 2);
        T.doc.PushToContent(table);
        T.doc.PushToContent(AscTest.CreateParagraph());
        const cell = table.GetRow(0).GetCell(0).GetContent();
        AscTest.AddTextToParagraph(cell.GetElement(0), 'cell');
        AscCommon.History.Clear();
        T.caret(cell.GetElement(0), 2);
        /* The end of the last paragraph of a cell reads as a tab, not as a paragraph end. */
        return {before: T.text(cell.GetElement(0))};
    });
    assert.equal(out.before, 'cell\t');
    world({clip: 'a\nb'});
    assert.equal(await actions.pastePlain(), true);
    const cell = await page(() => T.texts(T.doc.Content[1].GetRow(0).GetCell(0).GetContent()));
    assert.deepEqual(cell, ['cea\r\n', 'bll\t']);
});

/* A document of one paragraph whose caret stands inside a content control: an inline one with the text
   "inside" and the given lock, a check box, or a block-level one around a paragraph. */
function intoControl(kind) {
    return page(kind => {
        const p = T.reset(['Hello world']);
        T.caret(p[0], 5);
        let cc;
        if (kind === 'checkBox') {
            cc = T.doc.AddContentControlCheckBox();
        } else if (kind === 'block') {
            cc = T.doc.AddContentControl(Asc.c_oAscSdtLevelType.Block);
            AscTest.EnterText('inside');
            cc.SetContentControlLock(Asc.c_oAscSdtLockType.SdtContentLocked);
        } else {
            cc = T.doc.AddContentControl(Asc.c_oAscSdtLevelType.Inline);
            AscTest.EnterText('inside');
            cc.SetContentControlLock(Asc.c_oAscSdtLockType[kind]);
        }
        T.doc.RemoveSelection();
        cc.MoveCursorToStartPos();
        AscTest.MoveCursorRight(false, false, 1);
        AscCommon.History.Clear();
        return {inControl: T.doc.GetSelectedElementsInfo().GetAllSdts().indexOf(cc) >= 0};
    }, kind);
}

/* Every paragraph of the document with its text and the drawings in it. */
function wholeText() {
    return page(() => ({
        texts: T.doc.GetAllParagraphs().map(p => T.text(p)),
        drawings: T.doc.GetAllDrawingObjects().length, idle: T.idle(), points: T.points()
    }));
}

check('paste into a content control that cannot be edited is refused', async () => {
    for (const kind of ['SdtContentLocked', 'ContentLocked', 'checkBox', 'block']) {
        assert.deepEqual(await intoControl(kind), {inControl: true}, kind);
        const before = await wholeText();
        world({clip: 'pasted'});
        assert.equal(await actions.pastePlain(), false, kind);
        assert.deepEqual(await wholeText(), before, kind + ': the document is the same');
        assert.equal(before.idle && before.points === 0, true);
    }
    /* A control that only keeps itself from deletion takes the text. */
    await intoControl('SdtLocked');
    world({clip: 'pasted'});
    assert.equal(await actions.pastePlain(), true);
    assert.ok((await wholeText()).texts.some(t => /pasted/.test(t)));
});

/* A document of the paragraph "Hello" + a content control + " world" (or of the paragraphs "Before", a
   block-level control around the paragraph "inside" and "After") with the selection of count characters
   from start, counted as the caret moves. The control is an inline one with the text "inside" and the
   given lock, a check box, a text form, or a block-level one with the lock after "block". Gives the
   selected text, the answer of the menu rule (DocumentActions.sdtLocked) for the whole selection and at
   the caret, and the answer of the engine itself before a paste (IsSelectionLocked).
   The form is outside form filling, as in the editor. */
function across(kind, start, count) {
    return page(([kind, start, count, rule]) => {
        const locked = (0, eval)('(' + rule + ')');
        let p, cc;
        if (kind.startsWith('block')) {
            p = T.reset(['Before', 'After']);
            T.caret(p[1], 0);
            cc = T.doc.AddContentControl(Asc.c_oAscSdtLevelType.Block);
            AscTest.EnterText('inside');
            cc.SetContentControlLock(Asc.c_oAscSdtLockType[kind.slice(5)]);
        } else {
            p = T.reset(['Hello world']);
            T.caret(p[0], 5);
            if (kind === 'checkBox') {
                cc = T.doc.AddContentControlCheckBox();
            } else if (kind === 'form') {
                cc = T.doc.AddContentControlTextForm();
                cc.SetFormPr(new AscWord.CSdtFormPr());
            } else {
                cc = T.doc.AddContentControl(Asc.c_oAscSdtLevelType.Inline);
                AscTest.EnterText('inside');
                cc.SetContentControlLock(Asc.c_oAscSdtLockType[kind]);
            }
        }
        T.caret(p[0], start, count);
        AscCommon.History.Clear();
        return {
            selected: T.doc.GetSelectedText(), whole: locked(T.doc, true), near: locked(T.doc, false),
            engine: T.doc.IsSelectionLocked(AscCommon.changestype_Paragraph_Content), filling: T.doc.IsFillingFormMode()
        };
    }, [kind, start, count, actions.sdtLocked.toString()]);
}

check('a selection that runs into a content control that cannot be edited is refused', async () => {
    for (const [kind, start, count, selected, locked] of [
        ['ContentLocked', 2, 4, 'llo', true],
        ['SdtContentLocked', 2, 4, 'llo', true],
        ['checkBox', 2, 4, 'llo', true],
        ['SdtContentLocked', 6, 8, 'inside ', true],
        ['SdtContentLocked', 4, 9, 'oinside', true],
        ['ContentLocked', 6, 6, 'inside', true],
        ['SdtLocked', 4, 9, 'oinside', true],
        ['blockSdtContentLocked', 2, 6, 'fore\r\ni', true],
        ['blockContentLocked', 2, 6, 'fore\r\ni', true],
        /* A paste may remove a whole control that can be deleted, and fill one that can be edited. */
        ['ContentLocked', 4, 9, 'oinside', false],
        ['SdtLocked', 6, 6, 'inside', false],
        ['blockContentLocked', 2, 12, 'fore\r\ninside\r\nA', false],
        ['ContentLocked', 2, 3, 'llo', false]
    ]) {
        const name = kind + ' ' + JSON.stringify(selected);
        const at = await across(kind, start, count);
        assert.equal(at.selected, selected, name);
        assert.equal(at.whole, locked, name + ': the menu rule');
        assert.equal(at.engine, locked, name + ': the engine before a paste by the keys');
        const before = await wholeText();
        world({clip: 'PASTED'});
        assert.equal(await actions.pastePlain(), !locked, name + ': the paste');
        const after = await wholeText();
        if (locked) assert.deepEqual(after, before, name + ': the document is the same');
        else assert.ok(after.texts.some(t => /PASTED/.test(t)) && after.points === 1, name + ': pasted');
    }
});

check('paste without formatting is refused in a form field outside form filling', async () => {
    const at = await across('form', 6, 0);
    assert.equal(at.filling, false);
    assert.equal(at.engine, true, 'the engine refuses a paste by the keys');
    assert.deepEqual([at.whole, at.near], [true, true], 'the menu greys the item');
    const before = await wholeText();
    world({clip: 'PASTED'});
    assert.equal(await actions.pastePlain(), false);
    assert.deepEqual(await wholeText(), before, 'the document is the same');
});

/* --- Runner ------------------------------------------------------------------------------------ */

(async () => {
    let passed = 0, failed = 0, skipped = 0;
    if (!WHY && queue.some(c => c.needsEngine)) {
        try {
            session = await engine.open(SDKJS);
            runner = engine.bridge(session);
        } catch (e) {
            console.error('FAIL the engine page opens', e.message);
            failed++;
        }
    }
    const saved = G.DE.Views.CompactScript;
    G.DE.Views.CompactScript = runner || saved;
    for (const c of queue) {
        if (c.needsEngine && !session) {
            console.log('SKIP', c.name, '—', WHY || 'the engine page did not open');
            skipped++;
            continue;
        }
        try {
            await c.fn();
            console.log('PASS', c.name);
            passed++;
        } catch (error) {
            console.error('FAIL', c.name, error.message);
            failed++;
        }
    }
    G.DE.Views.CompactScript = saved;
    if (session) {
        if (session.errors.length) {
            console.error('FAIL no page errors', session.errors.join('; '));
            failed++;
        }
        await session.close();
    }
    console.log(`${passed} passed, ${failed} failed` + (skipped ? `, ${skipped} skipped` : ''));
    process.exitCode = failed || !passed ? 1 : 0;
})();
