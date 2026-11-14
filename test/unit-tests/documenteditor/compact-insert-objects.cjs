/* Run: node test/unit-tests/documenteditor/compact-insert-objects.cjs [<sdkjs dir>]
 * "Shape ▸" and "Text box" of the compact Insert menu (DocumentActions.insertShape and its document
 * script): the object stands at once at the caret, in front of the text and tied to the character and
 * the line of the caret, selected; a text box takes the caret inside. There is no drawing mode, and a
 * refused insertion changes nothing.
 * The catalog and the adapter run in vm over the stand-ins of lib/documents-editor.cjs. The document
 * script runs in the engine of sdkjs itself in headless Chrome (fixtures/compact-engine-page.cjs): sdkjs
 * is taken from the argument, then SDKJS_DIR, then ../sdkjs next to web-apps; without it or without
 * Playwright the engine checks are skipped.
 */
const assert = require('node:assert/strict');

const docs = require('../common/compact/lib/documents-editor.cjs');
const engine = require('./fixtures/compact-engine-page.cjs');

const G = docs.host();
const Model = G.Common.UI.Compact.MenuModel;
const actions = G.DE.Views.DocumentActions;
const command = k => actions.command(k);
const plain = value => JSON.parse(JSON.stringify(value));
const calls = (ctx, name) => ctx.log.filter(e => e.api === name).map(e => e.args);

const SDKJS = engine.sdkjsDir(process.argv[2]);
const WHY = engine.unavailable(SDKJS);

const SHAPES = ['rect', 'roundRect', 'ellipse', 'rightArrow', 'line'];

let session = null;
let runner = null;
const page = (fn, arg) => session.page.evaluate(fn, arg);

/* What the engine has after a command: the drawings of the document with their kind, place and look,
   the selection and the state of the action. */
function placed() {
    return page(() => {
        const doc = T.doc;
        const drawings = doc.GetAllDrawingObjects().map(d => {
            const shape = d.GraphicObj, run = d.GetRun(), para = run && run.GetParagraph();
            /* Text of the paragraph before the drawing. */
            let before = '', found = false;
            if (para) para.CheckRunContent(r => {
                if (found) return true;
                for (let i = 0; i < r.Content.length; i++) {
                    const item = r.Content[i];
                    if (item === d) { found = true; return true; }
                    if (item.IsText && item.IsText()) before += String.fromCodePoint(item.GetCodePoint());
                    else if (item.IsSpace && item.IsSpace()) before += ' ';
                }
                return false;
            });
            return {
                preset: shape.getPresetGeom(), inline: d.IsInline(), wrap: d.wrappingType, behind: d.behindDoc,
                h: [d.PositionH.RelativeFrom, d.PositionH.Value], v: [d.PositionV.RelativeFrom, d.PositionV.Value],
                para: para ? para.GetIndex() : -1, before, inDoc: d.IsUseInDocument(),
                themeLook: shape.spPr.Fill === null && shape.spPr.ln === null && !!shape.style,
                txBox: !!shape.getTxBox(), content: !!shape.textBoxContent,
                size: [Math.round(d.Extent.W * 10) / 10, Math.round(d.Extent.H * 10) / 10]
            };
        });
        const selected = doc.DrawingObjects.getSelectedObjects();
        const content = doc.GetCurrentParagraph() && doc.GetCurrentParagraph().GetParent();
        return {
            drawings, texts: T.texts(), idle: T.idle(), points: T.points(),
            selected: selected.length, selectedIsNew: selected.length === 1 && drawings.length > 0
                && selected[0] === doc.GetAllDrawingObjects()[0].GraphicObj,
            caretInBox: !!content && doc.GetAllDrawingObjects().some(d => d.GraphicObj.textBoxContent === content),
            drawingMode: T.editor.isStartAddShape === true
                || (doc.DrawingObjects.curState && doc.DrawingObjects.curState.constructor.name === 'StartAddNewShape'),
            consts: {character: Asc.c_oAscRelativeFromH.Character, line: Asc.c_oAscRelativeFromV.Line,
                none: WRAPPING_TYPE_NONE}
        };
    });
}

/* --- Checks ---------------------------------------------------------------------------------- */

const queue = [];
function check(name, fn, needsEngine = true) { queue.push({name, fn, needsEngine}); }

check('shape and text box items run the placing script', async () => {
    const ctx = docs.context();
    const saved = G.DE.Views.CompactScript;
    const runs = [];
    G.DE.Views.CompactScript = {init() { return this; }, run: (body, scope) => { runs.push({body, scope}); return Promise.resolve({ok: true}); }};
    try {
        const adapter = docs.adapter(ctx);
        for (const it of command('insert.shape').items) assert.equal(adapter.exec(it), true, it.k);
        assert.equal(adapter.exec(command('insert.textBox')), true);
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(runs.every(r => r.body === actions.SCRIPTS.shape), 'one script places them all');
        assert.deepEqual(plain(runs.map(r => r.scope)), SHAPES.map(type => ({type})).concat([{box: true}]));
        assert.deepEqual(calls(ctx, 'StartAddShape'), [], 'no drawing mode');
        assert.ok(ctx.log.some(e => e.event === 'edit:complete'), 'focus goes back to the document');
    } finally {
        G.DE.Views.CompactScript = saved;
    }
    /* Greyed with the editing reasons and without the script call. */
    for (const k of SHAPES.map(t => 'insert.shape.' + t).concat(['insert.textBox'])) {
        assert.equal(Model.state(command(k), docs.context({reasons: ['view']})).reason, 'view', k);
        assert.equal(Model.state(command(k), docs.context({missing: ['callCommand']})).disabled, true, k);
        assert.equal(Model.state(command(k), ctx).disabled, false, k);
    }
}, false);

check('shape and text box are greyed in a content control that cannot be edited', () => {
    for (const k of SHAPES.map(t => 'insert.shape.' + t).concat(['insert.textBox'])) {
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

/* --- In the engine --------------------------------------------------------------------------- */

check('shape is placed without drawing mode', async () => {
    for (const type of SHAPES) {
        await page(() => { const p = T.reset(['Hello world']); T.caret(p[0], 5); });
        assert.equal(await actions.insertShape(type), true, type);
        const out = await placed();
        assert.equal(out.drawings.length, 1, type + ': one shape');
        const d = out.drawings[0];
        assert.equal(d.preset, type, type + ': its kind');
        assert.equal(d.inline, false, type + ': floats');
        assert.equal(d.wrap, out.consts.none, type + ': text is not wrapped around');
        assert.equal(d.behind, false, type + ': in front of the text');
        assert.equal(d.themeLook, true, type + ': looks as a stock shape, by the theme');
        assert.equal(d.inDoc, true);
        assert.equal(out.drawingMode, false, type + ': no drawing mode');
        assert.equal(out.selected, 1, type + ': selected');
        assert.equal(out.selectedIsNew, true, type + ': the new shape is selected');
        assert.deepEqual(out.texts, ['Hello world\r\n'], type + ': the text stays');
        assert.equal(out.idle, true);
        assert.equal(out.points, 1, type + ': one undo step');
        await page(() => T.undo());
        assert.equal((await placed()).drawings.length, 0, type + ': one undo removes it');
    }
});

check('shape is inserted at the caret position', async () => {
    await page(() => { const p = T.reset(['First', 'Hello world', 'Last']); T.caret(p[1], 5); });
    assert.equal(await actions.insertShape('ellipse'), true);
    const out = await placed();
    assert.equal(out.drawings[0].para, 1, 'in the paragraph of the caret');
    assert.equal(out.drawings[0].before, 'Hello', 'right after the character before the caret');
    assert.deepEqual(out.texts, ['First\r\n', 'Hello world\r\n', 'Last\r\n']);
    /* The size of a shape put by a click of the stock drawing tool. */
    assert.deepEqual(out.drawings[0].size, [25.4, 25.4]);
});

check('refused insertion cancels and keeps the selected text', async () => {
    await page(() => {
        const p = T.reset(['Keep this text']);
        T.caret(p[0], 5, 4);
        const proto = Object.getPrototypeOf(AscBuilder.Word.Api.GetDocument());
        window.insertContent = proto.InsertContent;
        /* The engine refuses quietly, as InsertContent does: true and nothing inserted. */
        proto.InsertContent = function () { return true; };
    });
    try {
        assert.equal(await actions.insertShape('rect'), false);
        const out = await placed();
        assert.equal(out.drawings.length, 0);
        assert.deepEqual(out.texts, ['Keep this text\r\n']);
        assert.equal(await page(() => T.doc.GetSelectedText()), 'this', 'the selection is back');
        assert.equal(out.idle, true);
        assert.equal(out.points, 0, 'nothing left in the history');
    } finally {
        await page(() => { Object.getPrototypeOf(AscBuilder.Word.Api.GetDocument()).InsertContent = window.insertContent; });
    }
    /* With the engine as it is, a selection is not replaced: the shape stands and the text stays. */
    await page(() => { const p = T.reset(['Keep this text']); T.caret(p[0], 5, 4); });
    assert.equal(await actions.insertShape('rect'), true);
    const out = await placed();
    assert.equal(out.drawings.length, 1);
    assert.deepEqual(out.texts, ['Keep this text\r\n'], 'the selected text is not removed');
});

check('shape is positioned from the caret character and line', async () => {
    await page(() => { const p = T.reset(['Hello world']); T.caret(p[0], 6); });
    assert.equal(await actions.insertShape('rect'), true);
    const out = await placed();
    assert.deepEqual(out.drawings[0].h, [out.consts.character, 0], 'from the character');
    assert.deepEqual(out.drawings[0].v, [out.consts.line, 0], 'from the line');
    assert.equal(out.drawings[0].before, 'Hello ');
});

/* Left edge of the new drawing on the page against the caret before the insertion, both in mm after a
   layout of the document. */
async function standsAtCaret(offset, box) {
    const caret = await page(offset => {
        const p = T.reset(['Hello world']);
        AscTest.Recalculate();
        T.caret(p[0], offset);
        return T.doc.GetCursorPosXY().X;
    }, offset);
    assert.equal(await actions.insertShape(box ? null : 'rect'), true);
    const left = await page(() => {
        AscTest.Recalculate();
        return T.doc.GetAllDrawingObjects()[0].X;
    });
    return {caret, left};
}

check('shape and text box stand at the caret without covering the character before it', async () => {
    for (const [offset, box] of [[5, false], [1, false], [6, false], [0, false], [5, true]]) {
        const where = (box ? 'text box' : 'shape') + ' after ' + offset + ' characters: ';
        const {caret, left} = await standsAtCaret(offset, box);
        assert.ok(Math.abs(left - caret) < 0.01, where + 'left edge at ' + left + ' mm, caret at ' + caret + ' mm');
    }
});

check('text box puts the caret inside', async () => {
    await page(() => { const p = T.reset(['Hello world']); T.caret(p[0], 5); });
    assert.equal(await actions.insertShape(null), true);
    const out = await placed();
    assert.equal(out.drawings.length, 1);
    const d = out.drawings[0];
    assert.equal(d.txBox, true, 'a text box');
    assert.equal(d.content, true);
    assert.equal(d.inline, false);
    assert.deepEqual(d.h, [out.consts.character, 0]);
    assert.equal(out.caretInBox, true, 'the caret is in the text box');
    assert.equal(out.points, 1);
    /* Typing goes into the box at once. */
    const typed = await page(() => {
        AscTest.EnterText('abc');
        const box = T.doc.GetAllDrawingObjects()[0].GraphicObj.textBoxContent;
        return {box: T.texts(box), body: T.texts()};
    });
    assert.deepEqual(typed.box, ['abc\r\n']);
    assert.deepEqual(typed.body, ['Hello world\r\n']);
    /* The look of the stock text box: white fill, thin black line. */
    const look = await page(() => {
        const sp = T.doc.GetAllDrawingObjects()[0].GraphicObj.spPr;
        return {fill: sp.Fill && sp.Fill.fill && sp.Fill.fill.type, line: sp.ln && sp.ln.w,
            solid: Asc.c_oAscFill.FILL_TYPE_SOLID};
    });
    assert.equal(look.fill, look.solid);
    assert.equal(look.line, 6350);
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

check('shape and text box are refused in a content control that cannot be edited', async () => {
    for (const kind of ['SdtContentLocked', 'ContentLocked', 'checkBox', 'block']) {
        for (const type of ['rect', null]) {
            assert.deepEqual(await intoControl(kind), {inControl: true}, kind);
            const before = await wholeText();
            assert.equal(await actions.insertShape(type), false, kind + ', ' + type);
            assert.deepEqual(await wholeText(), before, kind + ', ' + type + ': the document is the same');
            assert.equal(before.drawings, 0);
        }
    }
    /* A control that only keeps itself from deletion takes the shape. */
    await intoControl('SdtLocked');
    assert.equal(await actions.insertShape('rect'), true);
    assert.equal((await wholeText()).drawings, 1);
});

/* "Hello" + an inline content control with the text "inside" and the given lock (or a text form outside
   form filling) + " world", with count characters selected from start as the caret moves. Gives the
   selected text and the answer of the menu rule (DocumentActions.sdtLocked) at the caret. */
function across(kind, start, count) {
    return page(([kind, start, count, rule]) => {
        const locked = (0, eval)('(' + rule + ')');
        const p = T.reset(['Hello world']);
        T.caret(p[0], 5);
        if (kind === 'form') {
            T.doc.AddContentControlTextForm().SetFormPr(new AscWord.CSdtFormPr());
        } else {
            const cc = T.doc.AddContentControl(Asc.c_oAscSdtLevelType.Inline);
            AscTest.EnterText('inside');
            cc.SetContentControlLock(Asc.c_oAscSdtLockType[kind]);
        }
        T.caret(p[0], start, count);
        AscCommon.History.Clear();
        return {selected: T.doc.GetSelectedText(), near: locked(T.doc, false)};
    }, [kind, start, count, actions.sdtLocked.toString()]);
}

check('a selection across a locked content control keeps its text', async () => {
    /* The shape does not replace the selection: the selection goes, and the shape stands at the caret
       outside the control or is refused inside it. */
    for (const kind of ['SdtContentLocked', 'ContentLocked'])
        for (const [start, count, selected] of [[2, 4, 'llo'], [6, 8, 'inside ']]) {
            for (const type of ['rect', null]) {
                const name = kind + ' ' + JSON.stringify(selected) + ', ' + type;
                assert.equal((await across(kind, start, count)).selected, selected, name);
                const done = await actions.insertShape(type);
                assert.deepEqual(await page(() => T.texts()), ['Helloinside world\r\n'], name + ': the text is the same');
                assert.equal((await wholeText()).drawings, done ? 1 : 0, name);
            }
        }
});

check('shape and text box are refused in a form field outside form filling', async () => {
    for (const type of ['rect', null]) {
        assert.equal((await across('form', 6, 0)).near, true, 'the menu greys the items');
        const before = await wholeText();
        assert.equal(await actions.insertShape(type), false, String(type));
        assert.deepEqual(await wholeText(), before, type + ': the document is the same');
    }
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
    docs.context();
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
