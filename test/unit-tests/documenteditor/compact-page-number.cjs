/* Run: node test/unit-tests/documenteditor/compact-page-number.cjs [<sdkjs dir>]
 * Page number positions of the compact Insert menu (DocumentActions.pageNumberAt and its document
 * script): the number goes to every header or footer the pages show — default, first page and even
 * pages along the chain of sections — and the missing ones are made in the first section; a number that
 * was there before moves, the text around it stays. The command either applies as one undo step or
 * leaves the document as it was.
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

const POSITIONS = ['bottomCenter', 'bottomRight', 'topRight'];

let session = null;
let runner = null;
const page = (fn, arg) => session.page.evaluate(fn, arg);

/* Helpers of the engine page: headers and footers, the three kinds of page number and what a header or
   footer holds. A paragraph reads as "<text>|<alignment>" with "#" where a page number stands: a page
   number mark of the engine or a PAGE field, complex or simple; the text of a field result is left out. */
const HELPERS = `window.H = {
    make: function (header, sectPr, type, text) {
        var hf = new AscCommonWord.CHeaderFooter(T.doc.HdrFtr, T.doc, T.doc.DrawingDocument,
            header ? AscCommon.hdrftr_Header : AscCommon.hdrftr_Footer);
        sectPr[(header ? 'Set_Header_' : 'Set_Footer_') + type](hf);
        if (text) AscTest.AddTextToParagraph(hf.GetContent().GetElement(0), text);
        return hf.GetContent().GetElement(0);
    },
    complex: function (p) {
        var doc = T.doc;
        var b = new ParaFieldChar(fldchartype_Begin, doc), sep = new ParaFieldChar(fldchartype_Separate, doc),
            e = new ParaFieldChar(fldchartype_End, doc);
        var add = function (fill) { var run = new AscWord.Run(); fill(run); p.MoveCursorToEndPos(); p.Add(run); };
        add(function (run) { run.AddToContent(-1, b); b.SetRun(run); });
        add(function (run) { run.AddInstrText(' PAGE '); });
        add(function (run) { run.AddToContent(-1, sep); sep.SetRun(run); });
        add(function (run) { run.AddText('7'); });
        add(function (run) { run.AddToContent(-1, e); e.SetRun(run); });
        var field = b.GetComplexField();
        field.SetBeginChar(b); field.SetInstructionLine(' PAGE '); field.SetSeparateChar(sep); field.SetEndChar(e);
        return field;
    },
    simple: function (p) {
        var field = new AscWord.CSimpleField(AscWord.fieldtype_PAGE, [], []);
        var run = new AscWord.Run();
        run.AddText('7');
        field.AddToContent(0, run);
        p.AddToContent(p.Content.length - 1, field);
        return field;
    },
    mark: function (p) {
        var run = new AscWord.Run();
        run.AddToContent(0, new AscWord.CRunPageNum());
        p.AddToContent(p.Content.length - 1, run);
    },
    text: function (p) {
        var out = '', field = 0;
        var walk = function (items) {
            items.forEach(function (it) {
                if (it instanceof AscWord.CSimpleField) {
                    if (it.GetFieldType() === AscWord.fieldtype_PAGE) { out += '#'; return; }
                    walk(it.Content);
                } else if (it instanceof AscWord.ParaRun) {
                    it.Content.forEach(function (c) {
                        if (c instanceof AscWord.CRunPageNum) out += '#';
                        else if (c.Type === para_FieldChar) {
                            var cf = c.GetComplexField();
                            var page = cf && cf.GetInstruction() && cf.GetInstruction().GetType() === AscWord.fieldtype_PAGE;
                            if (c.IsBegin()) { if (page) out += '#'; field++; }
                            else if (c.IsEnd()) field--;
                        } else if (!field && c.IsText && c.IsText()) out += String.fromCodePoint(c.GetCodePoint());
                        else if (!field && c.IsSpace && c.IsSpace()) out += ' ';
                    });
                } else if (it.Content) walk(it.Content);
            });
        };
        walk(p.Content);
        var jc = p.GetParagraphAlign();
        var name = jc === AscCommon.align_Right ? 'right' : jc === AscCommon.align_Center ? 'center' : 'left';
        return out + '|' + name;
    },
    /* Every section: its own headers and footers by type, null where it has none. */
    snap: function () {
        var out = [];
        for (var i = 0; i < T.doc.SectionsInfo.GetCount(); i++) {
            var sp = T.doc.SectionsInfo.GetSectPrByIndex(i), own = {};
            [['header', true], ['footer', false]].forEach(function (k) {
                own[k[0]] = {};
                [['default', false, false], ['title', true, false], ['even', false, true]].forEach(function (t) {
                    var hf = sp.GetHdrFtr(k[1], t[1], t[2]);
                    own[k[0]][t[0]] = hf ? hf.GetContent().Content.map(H.text) : null;
                });
            });
            out.push(own);
        }
        return out;
    },
    sections: function (count) {
        var paras = T.reset(Array.from({length: count}, function (x, i) { return 'Body ' + i; }));
        for (var i = 0; i < count - 1; i++) paras[i].SetSectionPr(new AscWord.SectPr(T.doc));
        AscTest.Recalculate();
        return paras;
    }
};`;

const none = {default: null, title: null, even: null};

/* --- Checks ---------------------------------------------------------------------------------- */

const queue = [];
function check(name, fn, needsEngine = true) { queue.push({name, fn, needsEngine}); }

check('page number positions run the page number script', async () => {
    const ctx = docs.context();
    const saved = G.DE.Views.CompactScript;
    const runs = [];
    G.DE.Views.CompactScript = {init() { return this; }, run: (body, scope) => { runs.push({body, scope}); return Promise.resolve({ok: true}); }};
    try {
        const adapter = docs.adapter(ctx);
        for (const pos of POSITIONS) assert.equal(adapter.exec(command('insert.pageNumber.' + pos)), true, pos);
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(runs.every(r => r.body === actions.SCRIPTS.pageNumber));
        assert.deepEqual(plain(runs.map(r => r.scope)), [
            {header: false, jc: 'center'}, {header: false, jc: 'right'}, {header: true, jc: 'right'}]);
        /* The stock call puts the number into one header and clears what was there. */
        assert.deepEqual(calls(ctx, 'put_PageNum'), []);
        assert.ok(ctx.log.some(e => e.event === 'edit:complete'), 'focus goes back to the document');
        assert.equal(await actions.pageNumberAt('nowhere'), false, 'an unknown position does nothing');
    } finally {
        G.DE.Views.CompactScript = saved;
    }
    for (const pos of POSITIONS) {
        const it = command('insert.pageNumber.' + pos);
        assert.equal(Model.state(it, ctx).disabled, false, pos + ' is available');
        for (const reason of ['view', 'offline', 'protected'])
            assert.equal(Model.state(it, docs.context({reasons: [reason]})).reason, reason, pos + ': ' + reason);
        assert.equal(Model.state(it, docs.context({missing: ['callCommand']})).disabled, true, pos + ' without callCommand');
    }
}, false);

/* --- In the engine --------------------------------------------------------------------------- */

check('number is added to every effective footer type', async () => {
    await page(() => {
        H.sections(1);
        const sp = T.doc.GetFinalSectPr();
        sp.Set_TitlePage(true);
        T.doc.Set_DocumentEvenAndOddHeaders(true);
        H.make(false, sp, 'Default', 'Company');
        H.make(false, sp, 'First', '');
        H.make(false, sp, 'Even', 'Even pages');
        AscCommon.History.Clear();
    });
    assert.equal(await actions.pageNumberAt('bottomCenter'), true);
    const [s] = await page(() => H.snap());
    assert.deepEqual(s.footer, {
        default: ['Company|left', '#|center'],
        title: ['#|center'],
        even: ['Even pages|left', '#|center']
    });
    assert.deepEqual(s.header, none, 'headers are not touched');
    assert.equal(await page(() => T.idle() && T.points()), 1);
});

check('missing title and even footers are created in the first section', async () => {
    const out = await page(() => {
        const paras = H.sections(2);
        const first = T.doc.SectionsInfo.GetSectPrByIndex(0), last = T.doc.SectionsInfo.GetSectPrByIndex(1);
        last.Set_TitlePage(true);
        T.doc.Set_DocumentEvenAndOddHeaders(true);
        H.make(false, first, 'Default', 'Footer');
        AscCommon.History.Clear();
        return paras.length;
    });
    assert.equal(out, 2);
    assert.equal(await actions.pageNumberAt('bottomRight'), true);
    const [first, last] = await page(() => H.snap());
    assert.deepEqual(first.footer, {default: ['Footer|left', '#|right'], title: ['#|right'], even: ['#|right']});
    assert.deepEqual(last.footer, none, 'the second section inherits them');
});

check('inherited footers of later sections stay linked', async () => {
    await page(() => {
        H.sections(3);
        const second = T.doc.SectionsInfo.GetSectPrByIndex(1);
        H.make(false, T.doc.SectionsInfo.GetSectPrByIndex(0), 'Default', 'First section');
        H.make(false, second, 'Default', 'Own footer');
        AscCommon.History.Clear();
    });
    assert.equal(await actions.pageNumberAt('bottomCenter'), true);
    const snap = await page(() => H.snap());
    assert.deepEqual(snap[0].footer.default, ['First section|left', '#|center']);
    assert.deepEqual(snap[1].footer.default, ['Own footer|left', '#|center'], 'a section with its own footer gets it too');
    assert.equal(snap[2].footer.default, null, 'the third section still shows the footer of the second');
    for (const s of snap) assert.deepEqual(s.header, none);
});

check('number inside contract text moves and the text stays', async () => {
    await page(() => {
        H.sections(1);
        const p = H.make(false, T.doc.GetFinalSectPr(), 'Default', 'Contract No 5, page ');
        H.complex(p);
        AscTest.AddTextToParagraph(p, ' of 3');
        AscCommon.History.Clear();
    });
    assert.deepEqual((await page(() => H.snap()))[0].footer.default, ['Contract No 5, page # of 3|left']);
    assert.equal(await actions.pageNumberAt('topRight'), true);
    const [s] = await page(() => H.snap());
    assert.deepEqual(s.footer.default, ['Contract No 5, page  of 3|left'], 'the text of the footer stays');
    assert.deepEqual(s.header.default, ['#|right'], 'the number is at the top right');
});

check('multi-run complex page field is moved', async () => {
    const runs = await page(() => {
        H.sections(1);
        const p = H.make(false, T.doc.GetFinalSectPr(), 'Default', '');
        p.SetParagraphAlign(AscCommon.align_Center);
        H.complex(p);
        AscCommon.History.Clear();
        return p.Content.filter(x => x instanceof AscWord.ParaRun && x.Content.length).length;
    });
    assert.ok(runs >= 5, 'the field takes several runs: ' + runs);
    assert.equal(await actions.pageNumberAt('bottomRight'), true);
    const [s] = await page(() => H.snap());
    assert.deepEqual(s.footer.default, ['#|right'], 'one number, in the place of the old one, at the right');
    /* Moving it again does not add a second number. */
    assert.equal(await actions.pageNumberAt('bottomCenter'), true);
    assert.deepEqual((await page(() => H.snap()))[0].footer.default, ['#|center']);
});

check('caret stays in the text after an old page field is moved', async () => {
    for (const selected of [0, 2]) {
        await page(selected => {
            const paras = H.sections(1);
            const sp = T.doc.GetFinalSectPr();
            H.complex(H.make(false, sp, 'Default', 'Page '));
            H.simple(H.make(true, sp, 'Default', 'Page '));
            AscCommon.History.Clear();
            T.caret(paras[0], 2, selected);
        }, selected);
        assert.equal(await actions.pageNumberAt('bottomRight'), true);
        const out = await page(() => ({
            inText: T.doc.GetDocPosType() === AscCommonWord.docpostype_Content,
            selected: T.doc.GetSelectedText(), idle: T.idle()
        }));
        assert.deepEqual(out, {inText: true, selected: selected ? 'dy' : '', idle: true}, 'selected: ' + selected);
        /* Typing goes on in the text, not in a footer. */
        await page(() => AscTest.EnterText('|'));
        const after = await page(() => ({texts: T.texts(), snap: H.snap()[0]}));
        assert.deepEqual(after.texts, [selected ? 'Bo| 0\r\n' : 'Bo|dy 0\r\n'], 'selected: ' + selected);
        assert.deepEqual(after.snap.footer.default, ['Page |left', '#|right']);
        assert.deepEqual(after.snap.header.default, ['Page |left']);
    }
});

check('simple page field is moved', async () => {
    await page(() => {
        H.sections(1);
        const p = H.make(true, T.doc.GetFinalSectPr(), 'Default', 'Page ');
        H.simple(p);
        AscCommon.History.Clear();
    });
    assert.deepEqual((await page(() => H.snap()))[0].header.default, ['Page #|left']);
    assert.equal(await actions.pageNumberAt('bottomCenter'), true);
    const [s] = await page(() => H.snap());
    assert.deepEqual(s.header.default, ['Page |left']);
    assert.deepEqual(s.footer, {default: ['#|center'], title: null, even: null}, 'a new footer with the number');
    /* A page number mark of the engine moves the same way. */
    await page(() => {
        H.sections(1);
        const p = H.make(false, T.doc.GetFinalSectPr(), 'Default', 'Page ');
        H.mark(p);
        AscCommon.History.Clear();
    });
    assert.equal(await actions.pageNumberAt('topRight'), true);
    const [m] = await page(() => H.snap());
    assert.deepEqual(m.footer.default, ['Page |left']);
    assert.deepEqual(m.header.default, ['#|right']);
});

check('missing internal method refuses without changes', async () => {
    for (const [owner, name] of [['CComplexField', 'RemoveField'], ['CSimpleField', 'GetFieldType'],
        ['ParaRun', 'RemoveFromContent'], ['CComplexField', 'GetInstruction']]) {
        await page(() => {
            H.sections(1);
            H.complex(H.make(false, T.doc.GetFinalSectPr(), 'Default', 'Page '));
            AscCommon.History.Clear();
        });
        const before = await page(() => H.snap());
        await page(([owner, name]) => {
            const proto = AscWord[owner].prototype;
            window.saved = {proto, name, fn: proto[name], own: Object.prototype.hasOwnProperty.call(proto, name)};
            proto[name] = undefined;
        }, [owner, name]);
        try {
            assert.equal(await actions.pageNumberAt('topRight'), false, owner + '.' + name);
        } finally {
            await page(() => { window.saved.proto[window.saved.name] = window.saved.fn; });
        }
        assert.deepEqual(await page(() => H.snap()), before, owner + '.' + name + ': nothing changed');
        assert.equal(await page(() => T.idle() && T.points() === 0), true);
    }
});

check('error while removing an old number leaves no changes and the action closed', async () => {
    await page(() => {
        H.sections(1);
        const sp = T.doc.GetFinalSectPr();
        H.complex(H.make(false, sp, 'Default', 'Page '));
        H.make(true, sp, 'Default', 'Title');
        AscCommon.History.Clear();
        /* The field goes away and then the engine fails. */
        const proto = AscWord.CComplexField.prototype;
        window.removeField = proto.RemoveField;
        proto.RemoveField = function () {
            window.removeField.apply(this, arguments);
            throw new Error('failure after the field is removed');
        };
    });
    const before = [{header: {default: ['Title|left'], title: null, even: null},
        footer: {default: ['Page #|left'], title: null, even: null}}];
    try {
        assert.equal(await actions.pageNumberAt('topRight'), false);
    } finally {
        await page(() => { AscWord.CComplexField.prototype.RemoveField = window.removeField; });
    }
    assert.deepEqual(await page(() => H.snap()), before, 'the old number is back, nothing added');
    assert.equal(await page(() => T.idle()), true, 'the action is closed');
    assert.equal(await page(() => T.points()), 0);
    /* The next command works. */
    assert.equal(await actions.pageNumberAt('topRight'), true);
    const [s] = await page(() => H.snap());
    assert.deepEqual(s.header.default, ['#|right', 'Title|left'], 'a header gets the number above its text');
    assert.deepEqual(s.footer.default, ['Page |left']);
});

check('one undo step reverts the change', async () => {
    await page(() => {
        H.sections(2);
        const first = T.doc.SectionsInfo.GetSectPrByIndex(0);
        first.Set_TitlePage(true);
        H.complex(H.make(false, first, 'Default', 'Page '));
        H.make(true, first, 'Default', 'Title');
        AscCommon.History.Clear();
    });
    const before = await page(() => H.snap());
    assert.equal(await actions.pageNumberAt('topRight'), true);
    const after = await page(() => ({snap: H.snap(), points: T.points()}));
    assert.notDeepEqual(after.snap, before);
    assert.equal(after.points, 1, 'one step in the history');
    await page(() => T.undo());
    assert.deepEqual(await page(() => H.snap()), before, 'one undo gives the document back');
});

/* --- Runner ------------------------------------------------------------------------------------ */

(async () => {
    let passed = 0, failed = 0, skipped = 0;
    if (!WHY && queue.some(c => c.needsEngine)) {
        try {
            session = await engine.open(SDKJS);
            await session.page.addScriptTag({content: HELPERS});
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
