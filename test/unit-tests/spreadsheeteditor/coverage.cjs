/* Run: node test/unit-tests/spreadsheeteditor/coverage.cjs [path to SheetActions.js] [path to CompactToolbar.js]
 * A check of the standard command coverage by the spreadsheet editor "Compact" shell. The inventory of the standard controls
 * of the ribbon of our build (SheetActions.STOCK, captured by the probe
 * inventory_matches_live_ribbon from the live ribbon) is compared with the shell addresses: the panel and
 * "⋯" (CompactToolbar.catalog), the menu row (SheetActions.catalog: a double and a control of the same
 * lock), the table of other addresses (the context menu, the column header menu, the right
 * panel, the sheet row, the standard windows) and "the same command at another copy of the button". The exceptions are
 * plugins and AI; the commands removed from the compact are listed separately. The contextual tabs are opened from "View".
 * The modules are loaded in node via vm,
 * the stock is not needed: catalogs are compared, not rights. The arguments are broken copies for the
 * negative control: a menu catalog without one item must fail
 * every_stock_control_has_address.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW = path.join(ROOT, 'apps/spreadsheeteditor/main/app/view');
const ACTIONS = process.argv[2] ? path.resolve(process.argv[2]) : path.join(VIEW, 'SheetActions.js');
const TOOLBAR = process.argv[3] ? path.resolve(process.argv[3]) : path.join(VIEW, 'CompactToolbar.js');
const LISTED_COUNT = 191;

function load() {
    const mods = {};
    const ctx = {console};
    ctx.window = ctx;
    ctx._ = require(path.join(ROOT, 'vendor/underscore/underscore.js'));
    ctx.SSE = {Views: {}, getController: () => null};
    ctx.Common = {NotificationCenter: {on() {}, off() {}, trigger() {}}, UI: {}};
    ctx.document = {baseURI: 'file:///', getElementById: () => null, body: {classList: {contains: () => false}}};
    let current = null;
    ctx.define = (deps, factory) => { mods[current] = factory(...deps.map(d => mods[d])); };
    vm.createContext(ctx);
    for (const [name, file] of [['common/main/lib/view/compact/Icons', path.join(ROOT, 'apps/common/main/lib/view/compact/Icons.js')],
                                ['spreadsheeteditor/main/app/view/StockBridge', path.join(VIEW, 'StockBridge.js')],
                                ['spreadsheeteditor/main/app/view/SheetActions', ACTIONS],
                                ['spreadsheeteditor/main/app/view/CompactToolbar', TOOLBAR]]) {
        current = name;
        vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: path.basename(file)});
    }
    return ctx.SSE.Views;
}

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('every_stock_control_has_address', () => {
    const V = load(), A = V.SheetActions;
    assert.equal(typeof A.coverage, 'function', 'SheetActions.coverage is missing');
    const r = A.coverage();
    const stock = A.STOCK;
    const tabs = Object.keys(stock);
    assert.ok(tabs.length >= 10 && tabs.every(t => stock[t].length > 0), 'stock inventory by ribbon tab: ' + tabs);
    const all = [].concat(...tabs.map(t => stock[t]));
    assert.equal(new Set(all).size, all.length, 'a stock control is listed twice');
    assert.equal(r.total, all.length);
    assert.deepEqual(Array.from(r.missing), [], 'stock controls without an address in the shell: ' + r.missing.join(', '));
    assert.equal(r.covered.length + r.advanced.length, r.total, 'every control is addressed or intentionally omitted');
    /* The address is real: the panel and the menu are from the catalogs, not from the table. */
    const where = ref => (r.byRef[ref] || {}).where || [];
    assert.ok(where('Toolbar:btnBold').some(w => /^toolbar /.test(w)), 'Bold is on the toolbar: ' + where('Toolbar:btnBold'));
    assert.ok(where('DataTab:btnGoalSeek').some(w => /^menu data /.test(w)), 'Goal seek is in Data: ' + where('DataTab:btnGoalSeek'));
    /* "Goal Seek · Solver" → "Data → Analysis ▸ Goal Seek · Solver". */
    [['DataTab:btnGoalSeek', 'goalSeek'], ['DataTab:btnSolver', 'solver']].forEach(([ref, k]) =>
        assert.deepEqual(Array.from(where(ref)), ['menu data > analysis > ' + k], ref + ' is not in Data → Analysis: ' + where(ref)));
    assert.ok(where('Toolbar:btnPrint').some(w => /^menu file /.test(w)), 'Print is in File (same lock as the stock button)');
    assert.ok(where('Formula:btnAutosum').some(w => /^(menu|toolbar) /.test(w)), 'AutoSum — the same stock path as Function: ' + where('Formula:btnAutosum'));
    assert.ok(where('Toolbar:btnCopy').some(w => /context menu/.test(w)), 'Copy — the context menu');
    /* The ribbon font size "−" and "+" have no address on the panel (the font size is a combo box, as in Documents): the standard shortcut and the font size list. */
    [['Toolbar:btnIncFontSize', 'Ctrl+]'], ['Toolbar:btnDecFontSize', 'Ctrl+[']].forEach(([ref, keys]) => {
        assert.ok(!where(ref).some(w => /^toolbar /.test(w)), ref + ' is still addressed by the toolbar: ' + where(ref));
        assert.ok(where(ref).length === 1 && where(ref)[0].indexOf(keys + ' (the stock shortcut); toolbar size') === 0, ref + ': ' + where(ref));
    });
    /* "Edit → Cut · Copy · Paste" - the "menu edit > …" addresses from the
       menu catalog (for "Copy" - by the button of the same command, sameCommand), not only from the table of other addresses. */
    [['Toolbar:btnCut', 'cut'], ['Toolbar:btnCopy', 'copy'], ['Toolbar:btnPaste', 'paste']].forEach(([ref, k]) => {
        assert.ok(where(ref).includes('menu edit > ' + k), ref + ' is not in Edit: ' + where(ref));
    });
    /* "Insert → Delete cells ▸" → "Edit → Delete cells ▸" - the address is only in "Edit". */
    assert.deepEqual(Array.from(where('Toolbar:btnDeleteCell')), ['menu edit > deleteCells'], 'Delete cells is not Edit → Delete cells: ' + where('Toolbar:btnDeleteCell'));
    /* "Calculation options ▸ · Trace precedents · Trace dependents · Remove arrows ▸ ·
       Watch window" → "Formulas ▸" - the child addresses "menu data > formulas > …" (for the "Calculate" and "Remove arrows" buttons - one
       row per item of their standard menu), there are no former top-level "Data" addresses. */
    assert.deepEqual(Array.from(where('Formula:btnCalculate')), ['menu data > formulas > recalcWorkbook', 'menu data > formulas > recalcSheet'],
        'Calculation is not Data → Formulas: ' + where('Formula:btnCalculate'));
    assert.deepEqual(Array.from(where('Formula:btnRemArrows')), ['menu data > formulas > removeArrows', 'menu data > formulas > removePrecedentArrows',
        'menu data > formulas > removeDependentArrows'], 'Remove arrows is not Data → Formulas: ' + where('Formula:btnRemArrows'));
    [['Formula:btnTracePrec', 'tracePrecedents'], ['Formula:btnTraceDep', 'traceDependents'], ['Formula:btnWatch', 'watchWindow']].forEach(([ref, k]) =>
        assert.deepEqual(Array.from(where(ref)), ['menu data > formulas > ' + k], ref + ' is not in Data → Formulas: ' + where(ref)));
    /* The "Collaboration" section - the "menu collaboration > …" addresses,
       there is no "menu review" address either in the catalog or in the table of other addresses. */
    assert.ok(where('Review:btnCoAuthMode').some(w => /^menu collaboration > coauthMode$/.test(w)),
        'Co-editing mode is in Collaboration: ' + where('Review:btnCoAuthMode'));
    const review = Object.keys(r.byRef).filter(ref => where(ref).some(w => /menu review/.test(w)));
    assert.deepEqual(review, [], 'addresses of the «Review» section');
    /* There is no comments button in the header: the address of the left area comments panel is "Collaboration → Comments" (and
       Ctrl+Shift+H), not the header. */
    const left = Array.from(where('ViewTab:chLeftMenu')).join('; ');
    assert.ok(/menu collaboration > comments/.test(left) && !/header/.test(left), 'the comments panel is not addressed by Collaboration → Comments: ' + left);
    /* "Collaboration": protection - "Protection ▸"; there is no workbook password in the menu row (workbook_password_is_covered_as_removed). */
    [['WBProtection:btnProtectWB', 'protectWorkbook'], ['WBProtection:btnProtectSheet', 'protectSheet'],
     ['WBProtection:btnProtectRange', 'protectRange']].forEach(([ref, k]) => {
        assert.deepEqual(Array.from(where(ref)), ['menu collaboration > protect > ' + k], ref + ' is not in Collaboration → Protection: ' + where(ref));
    });
    /* "Data → Get data from text ▸" → "File → Import ▸". */
    assert.deepEqual(Array.from(where('DataTab:btnDataFromText')), ['menu file > import'], 'Get data from text is not File → Import: ' + where('DataTab:btnDataFromText'));
    /* "Print titles · Margins ▸ · Orientation ▸ · Page size ▸ ·
       Print scale ▸" were removed from "File" - five "print window" addresses (and the PDF options window), not a single "menu file > …" item. */
    ['Toolbar:btnPrintTitles', 'Toolbar:btnPageMargins', 'Toolbar:btnPageOrient', 'Toolbar:btnPageSize', 'Toolbar:btnScale'].forEach(ref => {
        const at = Array.from(where(ref));
        assert.ok(at.length === 1 && /^menu file > print; menu file > download > downloadPdf \(the stock print settings dialog: /.test(at[0]),
            ref + ' is not addressed by the print window: ' + at);
        assert.ok(!A.ADVANCED[ref], ref + ' is advanced-only');
    });
    /* "Close view" - "View → Named views ▸ Default"
       ("Default · View manager"): the address is from the menu catalog, not
       from the table of other addresses. */
    /* "Named views ▸ · New view" → "Views ▸"
       with the same items - the address of the stock menu rows in place - the holder is "views". */
    assert.ok(where('ViewTab:btnCloseView').some(w => w === 'menu view > views > default'),
        'Close view — View → Views ▸ Default: ' + where('ViewTab:btnCloseView'));
    assert.deepEqual(Array.from(where('ViewTab:btnSheetView')), ['menu view > views'], 'Named views are not in View → Views: ' + where('ViewTab:btnSheetView'));
    assert.deepEqual(Array.from(where('ViewTab:btnCreateView')), ['menu view > views > createView'], 'Create view is not in View → Views: ' + where('ViewTab:btnCreateView'));
    assert.ok(!A.ELSEWHERE['ViewTab:btnCloseView'] && !A.ADVANCED['ViewTab:btnCloseView'], 'Close view is addressed by the menu catalog');
    /* "Format cells… ▸" → "Rows, columns and sheet ▸" with the same items - the address of the
       ribbon "Format" button and of the "✓ Locked cell" of the "Protection" tab is there; there are no addresses inside the former "formatCells ▸". */
    assert.ok(where('Toolbar:btnFormatCell').includes('menu format > rowsColsSheet'), 'Format is not Format → Rows, columns and sheet: ' + where('Toolbar:btnFormatCell'));
    /* "Format cells" is a separate "Format" item (an item of the same button by value). */
    assert.ok(where('Toolbar:btnFormatCell').includes('menu format > formatCells'), 'Format cells is not Format → Format cells: ' + where('Toolbar:btnFormatCell'));
    assert.deepEqual(Array.from(where('WBProtection:chLockedCell')), ['menu format > rowsColsSheet > locked cell'], 'Locked cell: ' + where('WBProtection:chLockedCell'));
    /* "Superscript and subscript ▸" → "Text ▸": the items of the superscript/subscript button are rows of "Text ▸",
       the font style is both there and on the panel. */
    assert.deepEqual(Array.from(where('Toolbar:btnSubscript')), ['menu format > text > superscript', 'menu format > text > subscript'],
        'Superscript/subscript are not in Format → Text: ' + where('Toolbar:btnSubscript'));
    [['Toolbar:btnBold', 'bold'], ['Toolbar:btnItalic', 'italic'], ['Toolbar:btnUnderline', 'underline'], ['Toolbar:btnStrikeout', 'strikeout']].forEach(([ref, k]) =>
        assert.ok(where(ref).includes('menu format > text > ' + k) && where(ref).some(w => /^toolbar /.test(w)), ref + ' is not in Format → Text and on the toolbar: ' + where(ref)));
    /* "Format → Alignment ▸" has 7 variants; "Justify" moved out of the panel "Horizontal" list into "Format →
       Alignment ▸" (in one delivery): "Justify" has an address only in the menu, the others have both the panel and the menu. */
    assert.deepEqual(Array.from(where('Toolbar:btnAlignJust')), ['menu format > align > alignJust'], 'Justified is not only in Format → Alignment: ' + where('Toolbar:btnAlignJust'));
    [['Toolbar:btnAlignLeft', 'alignLeft'], ['Toolbar:btnAlignCenter', 'alignCenter'], ['Toolbar:btnAlignRight', 'alignRight'], ['Toolbar:btnAlignTop', 'alignTop'],
     ['Toolbar:btnAlignMiddle', 'alignMiddle'], ['Toolbar:btnAlignBottom', 'alignBottom']].forEach(([ref, k]) =>
        assert.ok(where(ref).includes('menu format > align > ' + k) && where(ref).some(w => /^toolbar [hv]align$/.test(w)), ref + ': ' + where(ref)));
    /* "Format → ✓ Wrap text" - the wrap button is both on the panel and in "Format". */
    assert.ok(where('Toolbar:btnWrap').includes('menu format > wrap') && where('Toolbar:btnWrap').includes('toolbar wrap'), 'Wrap: ' + where('Toolbar:btnWrap'));
    /* "Format → Clear format" has no submenu, the "Formatting" item of the "Clear" button; the other variants are "Edit → Clear ▸". */
    ['menu format > clearFormat', 'menu edit > clear'].forEach(w => assert.ok(where('Toolbar:btnClearStyle').includes(w), 'Clear: ' + w + ' is missing: ' + where('Toolbar:btnClearStyle')));
    const oldFormatCells = Object.keys(r.byRef).filter(ref => where(ref).some(w => /menu format > formatCells >/.test(w)) ||
        /format > formatCells/.test(A.ADVANCED[ref] || ''));
    assert.deepEqual(oldFormatCells, [], 'addresses or reasons inside the former «Format cells… ▸»');
    /* "Dark sheet", "Interface theme" and "Object properties" were removed from "View" - there are no addresses
       for these items; the right panel (ViewTab:chRightMenu) opens by itself - the address is "other places". */
    const gone = Object.keys(r.byRef).filter(ref => where(ref).some(w => /menu view > (darkSheet|uiTheme|objectProps)/.test(w)));
    assert.deepEqual(gone, [], 'addresses of the removed View items');
    assert.ok(where('ViewTab:chRightMenu').length === 1 && /opens by itself/.test(where('ViewTab:chRightMenu')[0]),
        'the right panel is not addressed by its own opening: ' + where('ViewTab:chRightMenu'));
    /* Not a single "burger" address (there is no burger). */
    const burger = Object.keys(r.byRef).filter(ref => where(ref).some(w => /burger|бургер/i.test(w)));
    assert.deepEqual(burger, [], 'a burger address');
    console.log('   stock controls on our build: ' + r.total + ' (listed: ' + LISTED_COUNT + '); addressed ' + r.covered.length +
        ', omitted ' + r.advanced.length + ', excluded tabs: ' +
        Object.keys(A.EXCLUDED_TABS).join(', ') + ', missing ' + r.missing.length);
});

/* A control of the same lock (lockLike) is the source of an item's availability without a
   double, not the address of its command. "Increase/Decrease indent" get disabled together with "Align
   left", but it is a different command: Toolbar:btnAlignLeft has no "menu format > indent*" addresses.
   An address by lockLike is only for the same command (sameCommand): "Print" is the only address of the
   ribbon "Print" button. The result of the check is the same: no holes. */
test('lock_source_is_not_an_address', () => {
    const V = load(), A = V.SheetActions;
    const r = A.coverage();
    const where = ref => Array.from((r.byRef[ref] || {}).where || []);
    const align = where('Toolbar:btnAlignLeft');
    assert.deepEqual(align.filter(w => /^menu format > indent/.test(w)), [], 'Align left got the indent items as its addresses: ' + align);
    assert.ok(align.some(w => /^toolbar /.test(w)), 'Align left lost its own toolbar address: ' + align);
    const lockOnly = [];
    /* And for the children of composite items: their address is
       "menu <section> > <holder> > <child>". */
    const walk = (list, base) => list.forEach(it => {
        if (it.sep || it.head != null || it.mirror) return;
        const at = base + ' > ' + it.k;
        if (it.items) { walk(it.items, at); return; }
        if (!it.lockLike || it.lockLike === it.twin) return;
        const has = where(it.lockLike).includes(at);
        if (it.sameCommand) assert.ok(has, it.k + ': the same command lost its address «' + at + '»');
        else { assert.ok(!has, it.k + ': a lock source became an address «' + at + '»'); lockOnly.push(it.k); }
    });
    A.catalog().forEach((g, i) => walk(g.items, 'menu ' + A.SECTION_KEYS[i]));
    /* "View → Zoom ▸ 50 % … 200 %" - availability comes from the sheet row zoom button
       (Statusbar:btnZoomUp, the stock disables it during a cell edit), while the command is the panel zoom helper, not this button (a +10 % step). */
    const ZOOM_KIDS = [50, 75, 100, 125, 150, 200].map(z => 'zoom' + z);
    assert.deepEqual(lockOnly.sort(), ['indentDec', 'indentInc'].concat(ZOOM_KIDS).sort(), 'items with a lock source only');
    assert.equal(where('ViewTab:cmbZoom').filter(w => /^menu view > zoom/.test(w)).length, 1,
        'the stock zoom is not addressed by View → Zoom: ' + where('ViewTab:cmbZoom'));
    /* Zoom is on the panel too, as in Documents: the standard zoom has the addresses "View → Zoom ▸", the panel zoom and the sheet row. */
    assert.deepEqual(where('ViewTab:cmbZoom'), ['menu view > zoom; toolbar zoom; sheet tabs row: zoom'],
        'the stock zoom is not addressed by View → Zoom, the toolbar zoom and the sheet tabs row: ' + where('ViewTab:cmbZoom'));
    /* The panel "Print" button is the same command as "File → Print". */
    assert.deepEqual(where('Toolbar:btnPrint'), ['toolbar print', 'menu file > print'], 'Print — the stock print button is the toolbar Print and File → Print');
    assert.deepEqual(Array.from(r.missing), [], 'coverage changed: stock controls without an address ' + r.missing.join(', '));
});

/* A composite submenu: the check sees
   the children. The address of a child with a double is "menu <section> > <holder> > <child>", of a pick child - its
   double button, of stock menu rows in place ({mirror}) - the holder itself, and also for them - the row of its
   submenu; a child without a right (when) is also an address: the place of the command is checked, not the availability right now.
   The catalog items with such submenus are checked at their sections - here are the case items at the end of "View";
   a catalog that does not walk the children fails the case. */
test('children_have_their_own_addresses', () => {
    const V = load(), A = V.SheetActions, orig = A.catalog;
    A.catalog = function () {
        const c = orig.call(this);
        c[2].items.push({sep: true}, {k: 'tstShow', t: 'Show', items: [
            {k: 'gridlines', t: 'Gridlines', twin: 'ViewTab:chGridlines', check: true, edit: true},
            {k: 'headings', t: 'Headings', twin: 'ViewTab:chHeadings', check: true, when: () => false},
            {k: 'clearContents', t: 'Contents', twin: 'Toolbar:btnClearStyle', pick: '1'}
        ]}, {k: 'tstViews', t: 'Views', items: [
            {head: 'Named views'},
            {mirror: 'ViewTab:btnSheetView', also: {'ViewTab:btnCloseView': 'default'}},
            {k: 'createViewKid', t: 'Create view', twin: 'ViewTab:btnCreateView'}
        ]});
        return c;
    };
    const book = A.addressBook();
    const at = ref => Array.from(book[ref] || []);
    assert.ok(at('ViewTab:chGridlines').includes('menu view > tstShow > gridlines'), 'a child twin address: ' + at('ViewTab:chGridlines'));
    assert.ok(at('ViewTab:chHeadings').includes('menu view > tstShow > headings'), 'a child without the right now is still the place of its command');
    assert.ok(at('Toolbar:btnClearStyle').includes('menu view > tstShow > clearContents'), 'a pick child is addressed by its twin button');
    assert.ok(at('ViewTab:btnSheetView').includes('menu view > tstViews'), 'stock rows in place are addressed by their holder: ' + at('ViewTab:btnSheetView'));
    assert.ok(at('ViewTab:btnCloseView').includes('menu view > tstViews > default'), 'also of stock rows in place: ' + at('ViewTab:btnCloseView'));
    assert.ok(at('ViewTab:btnCreateView').includes('menu view > tstViews > createViewKid'));
    assert.ok(!Object.keys(book).some(ref => book[ref].some(w => /undefined|Named views/.test(w))), 'a header or a hole became an address');
    const r = A.coverage();
    ['ViewTab:chGridlines', 'ViewTab:chHeadings'].forEach(ref => {
        assert.equal(r.byRef[ref].why, null, ref + ': addressed by a child, but still advanced-only');
        assert.ok(!r.advanced.some(x => x.ref === ref), ref + ' is on the advanced-only row');
    });
    assert.deepEqual(Array.from(r.missing), [], 'coverage changed: ' + r.missing.join(', '));
});

/* "View → Hide toolbar": there is no toolbar, but its commands are available from the
   menu row. Every double of the panel row - buttons, the "Horizontal" and "Vertical" variants, the sort rows; a
   command without a double - "toolbar <key>" ("Search", "Zoom") - has an address in the menu row: a menu catalog item ("menu …") or another
   place of the same command in the menu (WITHOUT_TOOLBAR: ₽, %, decimals −/+, fill, "Chart", "Search", "Zoom" - a menu catalog item
   without a double, "View → Zoom ▸"). The exception is exactly four commands without a place
   in the menu row (TOOLBAR_ONLY: "Format painter", "Font", "Font size" - a combo box, "Font color"): they are brought back by choosing
   "View → Hide toolbar" again, these four are not in the menu. The reason for each is "only from
   the toolbar", and there is a way back in the menu row: "View → Hide toolbar" is a catalog item. The list neither grows nor shrinks silently. No holes.
   The negative control is a menu catalog without "Format → Text ▸ Bold" (argument 1, or the same catalog here, in place): the hole is
   "Bold". */
const TOOLBAR_ONLY_LIST = ['Toolbar:btnCopyStyle', 'Toolbar:cmbFontName', 'Toolbar:cmbFontSize', 'Toolbar:btnTextColor'];
const WITHOUT_TOOLBAR_LIST = ['Toolbar:btnCurrencyStyle', 'Toolbar:btnPercentStyle', 'Toolbar:btnDecDecimal', 'Toolbar:btnIncDecimal', 'Toolbar:btnBackColor',
    'Toolbar:btnInsertChartRecommend', 'toolbar search', 'toolbar zoom'];
test('toolbar_commands_reachable_without_toolbar', () => {
    const V = load(), A = V.SheetActions;
    assert.equal(typeof A.toolbarReach, 'function', 'SheetActions.toolbarReach is missing');
    const r = A.toolbarReach();
    const all = Object.keys(r.byRef);
    assert.ok(all.length >= 40, 'suspiciously few toolbar twins: ' + all.length);
    ['Toolbar:btnBold', 'Toolbar:btnAlignCenter', 'Toolbar:btnAlignTop', 'DataTab:btnsSortUp.0', 'Toolbar:cmbFontSize', 'Toolbar:btnPrint', 'toolbar search',
     'toolbar zoom']
        .forEach(ref => assert.ok(all.includes(ref), ref + ' is not checked as a toolbar command'));
    /* Font size is a combo box, as in Documents: the ribbon "−" and "+" are not row commands. */
    assert.deepEqual(['Toolbar:btnDecFontSize', 'Toolbar:btnIncFontSize'].filter(ref => all.includes(ref)), [], 'font size − and + are still toolbar commands');
    assert.deepEqual(Array.from(r.missing), [], 'toolbar commands without a place in the menu bar: ' + r.missing.join(', '));
    assert.deepEqual(Array.from(r.toolbarOnly).sort(), TOOLBAR_ONLY_LIST.slice().sort(), 'toolbar-only commands');
    assert.deepEqual(Object.keys(A.TOOLBAR_ONLY).sort(), TOOLBAR_ONLY_LIST.slice().sort(), 'TOOLBAR_ONLY grew or shrank silently (four commands)');
    Object.keys(A.TOOLBAR_ONLY).forEach(ref => assert.ok(/^toolbar only, not in the menu bar — View > Hide toolbar again brings the toolbar back \(\S/.test(A.TOOLBAR_ONLY[ref]),
        ref + ': no reason: ' + A.TOOLBAR_ONLY[ref]));
    /* The way back to the toolbar is the menu row item "View → Hide toolbar" (the shell command toggleToolbar). */
    const back = A.catalog()[A.SECTION_KEYS.indexOf('view')].items.find(x => x && x.k === 'hideToolbar');
    assert.ok(back && typeof back.run === 'function' && back.needs === 'toggleToolbar', '«View → Hide toolbar» is not in the View section of the menu bar');
    /* WITHOUT_TOOLBAR is exactly the commands without their own menu item, and each place is an existing menu item (its start is a catalog address). */
    assert.deepEqual(Object.keys(A.WITHOUT_TOOLBAR).sort(), WITHOUT_TOOLBAR_LIST.slice().sort(), 'WITHOUT_TOOLBAR changed');
    const book = A.addressBook(), places = new Set([].concat(...Object.values(book)));
    /* A menu catalog item without a double ("View → Zoom ▸") is also a place: it has no address in the book, the path is by the catalog. */
    const walk = (list, base) => list.forEach(it => {
        if (!it || it.sep || it.head != null || it.mirror || !it.k) return;
        places.add(base + ' > ' + it.k);
        if (Array.isArray(it.items)) walk(it.items, base + ' > ' + it.k);
    });
    A.catalog().forEach((g, i) => walk(g.items, 'menu ' + A.SECTION_KEYS[i]));
    Object.keys(A.WITHOUT_TOOLBAR).forEach(ref => {
        const at = A.WITHOUT_TOOLBAR[ref], item = at.replace(/ \(.*$/, '').split(' > ').slice(0, 3).join(' > ');
        assert.ok([item, item.split(' > ').slice(0, 2).join(' > ')].some(x => places.has(x)), ref + ': «' + at + '» is not a menu item of the catalog');
        assert.ok(!(book[ref] || []).some(w => w.indexOf('menu ') === 0), ref + ' has its own menu item — the WITHOUT_TOOLBAR entry is stale');
    });
    TOOLBAR_ONLY_LIST.forEach(ref => assert.ok(!(book[ref] || []).some(w => w.indexOf('menu ') === 0), ref + ' got a menu item — shorten TOOLBAR_ONLY'));
    /* The addresses are from the menu catalog, not from the table: the font style is "Format → Text ▸", the alignment is "Format → Alignment ▸". */
    assert.ok(r.byRef['Toolbar:btnBold'].includes('menu format > text > bold'), 'Bold: ' + r.byRef['Toolbar:btnBold']);
    assert.ok(r.byRef['Toolbar:btnAlignCenter'].includes('menu format > align > alignCenter'), 'Center: ' + r.byRef['Toolbar:btnAlignCenter']);
    assert.ok(r.byRef['Toolbar:btnPrint'].includes('menu file > print'), 'Print: ' + r.byRef['Toolbar:btnPrint']);
    /* Sensitivity of the check: without "Format → Text ▸ Bold" - the hole "Bold". */
    const orig = A.catalog;
    A.catalog = function () {
        const c = orig.call(this), f = c[4].items, i = f.findIndex(x => x && x.k === 'text');
        f[i] = Object.assign({}, f[i], {items: f[i].items.filter(x => x.k !== 'bold')});
        return c;
    };
    try {
        assert.deepEqual(Array.from(A.toolbarReach().missing), ['Toolbar:btnBold'], 'a toolbar command without a menu place is not found');
    } finally {
        A.catalog = orig;
    }
});

test('contextual_controls_have_a_route_from_view', () => {
    const V = load(), A = V.SheetActions;
    const r = A.coverage();
    for (const [tab, ref] of [
        ['pivot', 'PivotTable:btnCalculatedItems'], ['tabledesign', 'TableDesign:btnResizeTable'],
        ['charttab', 'Chart:spnWidth'], ['sparklinetab', 'Sparkline:cmbBorderSize']
    ]) {
        assert.deepEqual(Array.from(r.byRef[ref].where), ['menu view > context-' + tab]);
    }
    assert.equal(A.item('advancedUI'), null);
    const catalog = A.catalog;
    A.catalog = function () {
        return catalog.call(this).map(group => ({
            ...group, items: group.items.filter(item => item.k !== 'context-charttab')
        }));
    };
    try {
        assert.ok(A.coverage().missing.includes('Chart:spnWidth'), 'a removed route must count as missing');
    } finally {
        A.catalog = catalog;
    }
});

test('intentionally_omitted_controls_are_listed_with_reasons', () => {
    const A = load().SheetActions;
    const r = A.coverage();
    ['HiddenFormula', 'LockedShape', 'LockedText'].forEach((name, index) => {
        const ref = 'WBProtection:ch' + name;
        const item = ['hiddenFormula', 'lockedShape', 'lockedText'][index];
        assert.deepEqual(Array.from(r.byRef[ref].where), ['menu collaboration > protect > ' + item]);
    });
    const NOT_IN_SHELL = ['Draw:btnSelect', 'Draw:btnsPen.0', 'Draw:btnsPen.1', 'Draw:btnsPen.2', 'Draw:btnEraser',
        'ViewTab:chFormula', 'ViewTab:chStatusbar'];
    [['ViewTab:chGridlines', 'gridlines'], ['ViewTab:chHeadings', 'headings'], ['ViewTab:chZeros', 'zeros'], ['Formula:btnShowFormulas', 'showFormulas']]
        .forEach(([ref, k]) => assert.ok(r.byRef[ref].where.includes('menu view > show > ' + k), ref + ' is not in View → Show: ' + r.byRef[ref].where));
    /* The commands that the compact does not have and the menus of common spreadsheet editors do not have either - by name,
       also a "Standard only" line, with a reason: the built-in chat
       ("Collaboration" without "Chat"). */
    /* And "View" without "Dark sheet · Interface theme ▸" (the look is set by the portal) - Standard only. */
    /* And "Insert" without "SmartArt · TextArt · Equations" - Standard only; the "Table" of Insert is
       a duplicate of "Format as table" (an address of the same command, SAME), not here. */
    const REMOVED_FROM_MENU = ['Review:btnChat', 'ViewTab:btnDarkDocument', 'ViewTab:btnInterfaceTheme',
        'Toolbar:btnInsertSmartArt', 'Toolbar:btnInsertTextArt', 'Toolbar:btnInsertEquation'].sort();
    const found = Array.from(r.advanced, x => x.ref).sort();
    assert.deepEqual(found, NOT_IN_SHELL.concat(REMOVED_FROM_MENU).sort(),
        'only the listed controls are omitted');
    assert.deepEqual(Object.keys(A.ADVANCED).sort(), NOT_IN_SHELL.concat(REMOVED_FROM_MENU).sort(),
        'ADVANCED holds exactly the list not in the shell');
    /* The reason is its own for each command, after "Not in the compact shell: ". */
    const bad = found.filter(ref => !/^Not in the compact shell: \S/
        .test(A.ADVANCED[ref]));
    assert.deepEqual(bad, [], 'a reason for every advanced-only control outside the context tabs');
    /* The exceptions are plugins and AI. */
    assert.deepEqual(Object.keys(A.EXCLUDED_TABS).sort(), ['ai', 'plugins']);
});

test('workbook_password_is_reachable_from_the_stock_file_screen', () => {
    const V = load(), A = V.SheetActions;
    const r = A.coverage();
    [
        ['Protection:btnAddPwd', 'stock File screen > Protect > add workbook password'],
        ['Protection:btnPwd', 'stock File screen > Protect > change or remove workbook password']
    ].forEach(([ref, address]) => {
        assert.deepEqual(Array.from(r.byRef[ref].where), [address], ref + ' is reachable through the stock File screen');
        assert.ok(r.covered.some(item => item.ref === ref), ref + ' is not marked as covered');
    });
});

(() => {
    for (const [name, fn] of tests) {
        try {
            fn();
            console.log('PASS', name);
            passed++;
        } catch (error) {
            console.error('FAIL', name, '—', error && error.message);
            failed++;
        }
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})();
