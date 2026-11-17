/* Run: node test/unit-tests/presentationeditor/slide-actions.cjs [path to SlideActions.js]
 * Menu bar catalog of the presentation shell: nine sections, the composition and order of items,
 * the "edits the presentation" flag, capabilities (not drawn without the right), the order of the
 * unavailability reasons (mode, right, selection, twin) and their texts, recalculation by mode,
 * the stock editing ban (version history, connection loss): editing items, right panel
 * sections, comments and chat items are gray without a reason, the shell chrome is alive,
 * marked engine calls, "View → Slides" and "View → Notes",
 * "View → Macros" captions by the current caption of the stock recording buttons.
 *
 * The world is a fake stock editor from the shared shell check fixtures
 * (acceptance/mode-harness.cjs): stock controls with a call log, the engine, the ru locale.
 * The optional argument is a corrupted copy of the catalog for a negative control:
 * a copy without the edit flag on "Delete slide" must fail edit_flag_on_every_editing_item,
 * a copy with a shape without text in TXT must fail text_items_only_with_text_in_selection.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const h = require('./acceptance/mode-harness.cjs');

const VIEW = path.join(h.PE_APP, 'view');
const FILE = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.join(VIEW, 'SlideActions.js');

/* Shell module catalog: stock or a copy in which SlideActions.js is the file under test. */
function viewDir() {
    if (FILE === path.join(VIEW, 'SlideActions.js')) return VIEW;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slide-actions-'));
    for (const name of h.SHELL_MODULES) if (!h.SHARED_MODULES[name]) fs.copyFileSync(path.join(VIEW, name + '.js'), path.join(dir, name + '.js'));
    fs.copyFileSync(FILE, path.join(dir, 'SlideActions.js'));
    return dir;
}
const DIR = viewDir();

/* Captions of its own items and the reasons are as the ru locale gives them. */
const RU = {
    textEdit: 'Правка', textSlide: 'Слайд', textArrange: 'Упорядочить', textFormat: 'Формат',
    textNoEditRight: 'Нет права на редактирование',
    textNoEditRightRequest: 'Только просмотр — чтобы править, выберите «Файл → Редактировать»',
    textSelectObject: 'Выделите объект на слайде', textSelectText: 'Выделите текст',
    textSelectTable: 'Выделите таблицу', textSelectImage: 'Выделите изображение',
    textSelectTwoObjects: 'Выделите два объекта и больше', textSelectTwoShapes: 'Выделите две фигуры и больше',
    textNotGroup: 'Выделенное — не группа', textNothingToUndo: 'Нечего отменять', textNothingToRedo: 'Нечего повторить',
    textNoMacroRecording: 'Запись макроса не идёт', textSelectObjectOrText: 'Выделите объект или текст',
    textPlaceCursor: 'Поставьте курсор в текст', textNoUnsavedChanges: 'Нет несохранённых изменений'
};

function world(opts, setup) {
    const w = h.createWorld(opts, {viewDir: DIR});
    const SA = w.modules.SlideActions;
    assert.ok(SA, 'PE.Views.SlideActions is not loaded: ' + JSON.stringify(w.loadErrors));
    Object.assign(SA, RU);
    if (setup) setup(w);
    h.boot(w);
    w.SA = SA;
    return w;
}

/* All catalog items with a submenu, with the section. */
function walk(groups) {
    const out = [];
    const rec = (list, section) => (list || []).forEach(it => {
        if (!it || it.sep) return;
        out.push({it, section});
        if (Array.isArray(it.sub)) rec(it.sub, section);
    });
    groups.forEach(g => rec(g.items, g.label));
    return out;
}
const keysOf = list => Array.from(list, it => (it.sep ? '-' : it.k));
const find = (w, k) => w.SA.item(k);
const setKind = (w, k) => { w.modules.SlideSelection.kind = () => k; };

/* The composition of the stock ban is the real Main.disableEditing (version history and connection loss
   call it with the 'disconnect' type). */
function stockOptions(disable, type) {
    const src = fs.readFileSync(path.join(h.PE_APP, 'controller/Main.js'), 'utf8');
    const head = 'disableEditing: function(';
    const start = src.indexOf(head);
    assert.ok(start >= 0, 'Main.disableEditing not found');
    let depth = 0, end = src.indexOf('{', start);
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    const sent = [];
    const ctx = {Common: {NotificationCenter: {trigger: (...a) => sent.push(a)}}};
    vm.createContext(ctx);
    vm.runInContext('(function(' + src.slice(start + head.length, end + 1) + ')', ctx).call({}, disable, type);
    assert.equal(sent.length, 1);
    return sent[0][2];
}

const NINE = ['Файл', 'Правка', 'Вид', 'Вставка', 'Формат', 'Слайд', 'Упорядочить', 'Совместная работа', 'Справка'];

const ORDER = {
    'Файл': ['save', 'download', 'print', '-', 'rename', 'info', 'settings'],
    'Правка': ['undo', 'redo', '-', 'cut', 'copy', 'paste', '-', 'selectAll', 'search', 'delete', '-', 'spelling', 'docLang'],
    'Вид': ['show', '-', 'normal', 'slideMaster', '-', 'zoom', 'rulers', 'guides', 'gridlines', 'notes', 'thumbs', '-',
        'hideToolbar', 'focus', '-', 'macroMenu'],
    'Вставка': ['image', 'textbox', 'shape', 'table', 'chart', 'smartArt', 'textArt', 'equation', 'symbol', '-',
        'animation', 'link', 'comment', '-', 'newSlide', 'slideNum', 'dateTime', 'headerFooter'],
    'Формат': ['text', 'changeCase', 'align', 'lineSpace', 'lists', 'columns', 'textDir', '-', 'tableMenu', 'imageMenu', '-',
        'clearStyle', 'objectProperties'],
    'Слайд': ['newSlideSlide', 'duplicateSlide', 'deleteSlide', 'hideSlide', 'moveSlide', '-', 'background', 'changeLayout',
        'resetLayout', 'changeTheme', 'colorSchemas', 'slideSize', '-', 'transition'],
    'Упорядочить': ['arrange', 'alignObjects', 'rotate', '-', 'group', 'ungroup', 'shapesMerge'],
    'Совместная работа': ['sharing', 'coAuthMode', 'history', '-', 'comments', 'commentResolve', 'commentRemove'],
    'Справка': ['help', 'about']
};

/* Bindings: a stock control (bridge address), a shell command or an engine call. */
const BINDING = {
    save: {engine: 'LeftMenu.clickMenuFileItem', action: 'save', ref: 'FileMenu:miSave'}, downloadPDF: {engine: 'LeftMenu.clickSaveAsFormat', format: 'PDF', ref: 'FileMenu:miDownload'},
    print: {engine: 'LeftMenu.clickToolbarPrint', ref: 'FileMenu:miPrint'}, info: {twin: 'FileMenu:miInfo', file: 'info', window: 'docInfo'}, download: {ref: 'FileMenu:miDownload', when: 'download'},
    undo: {twin: 'Toolbar:btnUndo'}, cut: {twin: 'Toolbar:btnCut'},
    delete: {engine: 'asc_Remove'}, search: {cmd: 'search'}, normal: {twin: 'ViewTab:btnNormal'},
    notes: {twin: 'ViewTab:chNotes'}, thumbs: {twin: 'LeftMenu:btnThumbs'}, focus: {cmd: 'focus'}, hideToolbar: {cmd: 'hideToolbar'},
    objectProperties: {cmd: 'objectProperties', check: 'rightPanel'}, symbol: {twin: 'Toolbar:btnInsertSymbol.menu.items.2', ref: 'Toolbar:btnInsertSymbol'}, image: {twin: 'Toolbar:btnsInsertImage.0'}, shape: {twin: 'Toolbar:cmbsInsertShape.0'},
    animation: {cmd: 'slideSection', args: ['animation']}, comment: {cmd: 'addComment'}, newSlide: {twin: 'Toolbar:btnAddSlide'},
    changeCase: {twin: 'Toolbar:btnChangeCase'}, duplicateSlide: {twin: 'DocumentHolder:mnuDuplicateSlide'},
    deleteSlide: {twin: 'DocumentHolder:mnuDeleteSlide'}, hideSlide: {twin: 'DocumentHolder:mnuSlideHide'},
    background: {cmd: 'slideSection', args: ['slide']}, changeLayout: {twin: 'Toolbar:btnChangeSlide'},
    changeTheme: {cmd: 'slideSection', args: ['theme']}, colorSchemas: {twin: 'Toolbar:btnColorSchemas'},
    transition: {cmd: 'slideSection', args: ['transition']}, slideMaster: {twin: 'ViewTab:btnSlideMaster', check: 'twin'},
    alignObjects: {twin: 'Toolbar:btnShapeAlign'},
    arrange: {twin: 'Toolbar:btnShapeArrange'}, group: {twin: 'Toolbar:mnuGroupShapes'}, ungroup: {twin: 'Toolbar:mnuUnGroupShapes'},
    shapesMerge: {twin: 'Toolbar:btnShapesMerge'}, coAuthMode: {twin: 'Review:btnCoAuthMode'}, comments: {twin: 'LeftMenu:btnComments'},
    docLang: {twin: 'Review:btnsDocLang.0'}, help: {twin: 'FileMenu:miHelp'}, about: {twin: 'LeftMenu:btnAbout', window: 'about'}
};

/* Items that edit the presentation ("Format", "Slide" except "Slide
   settings", "Arrange" as a whole, with submenus). */
const EDIT = new Set(['save', 'rename', 'undo', 'redo', 'cut', 'paste', 'delete', 'slideMaster',
    'hideToolbar', 'recMacro', 'pauseMacro', 'image', 'textbox', 'shape', 'table', 'chart', 'smartArt', 'textArt', 'equation',
    'symbol', 'animation', 'link', 'newSlide', 'slideNum', 'dateTime', 'headerFooter',
    'text', 'bold', 'italic', 'underline', 'strikeout', 'superscript', 'subscript', 'changeCase', 'align', 'alignH', 'alignV',
    'lineSpace', 'lists', 'markers', 'numbers', 'columns', 'textDir', 'tableMenu', 'tableInsert', 'tableDelete', 'tableMerge',
    'tableSplit', 'tableDistRows', 'tableDistCols', 'imageMenu', 'crop', 'replaceImage', 'originalSize', 'resetCrop', 'clearStyle',
    'newSlideSlide', 'duplicateSlide', 'deleteSlide', 'hideSlide', 'moveSlide', 'moveSlideStart', 'moveSlideEnd', 'background',
    'changeLayout', 'resetLayout', 'changeTheme', 'colorSchemas', 'slideSize', 'transition',
    'arrange', 'alignObjects', 'rotate', 'group', 'ungroup', 'shapesMerge', 'coAuthMode', 'commentResolve', 'commentRemove', 'docLang']);
/* They do not edit, but the stock editor without the edit right does not create them. */
const NEED_RIGHT = new Set(['normal', 'rulers', 'guides', 'gridlines', 'objectProperties', 'macroMenu', 'macros', 'spelling']);

const tests = [
    {name: 'nine_sections_in_order', fn() {
        const w = world();
        assert.deepEqual(Array.from(w.SA.groups(), g => g.label), NINE);
    }},

    {name: 'items_and_order_per_section', fn() {
        const w = world();
        const groups = w.SA.groups();
        for (const g of groups) assert.deepEqual(keysOf(g.items), ORDER[g.label], 'section ' + g.label);
        assert.deepEqual(keysOf(find(w, 'text').sub), ['bold', 'italic', 'underline', 'strikeout', '-', 'superscript', 'subscript'], 'Формат → Текст');
        assert.deepEqual(keysOf(find(w, 'zoom').sub), ['fitSlide', 'fitWidth', '-', 'zoom50', 'zoom75', 'zoom90', 'zoom100', 'zoom125',
            'zoom150', 'zoom175', 'zoom200'], 'Вид → Масштаб: набор списка масштаба на панели');
        assert.deepEqual(keysOf(find(w, 'download').sub), ['downloadPPTX', 'downloadPDF', 'downloadODP', 'downloadPNG'], 'Файл → Скачать');
        assert.deepEqual(Array.from(find(w, 'download').sub, x => x.t), ['PPTX', 'PDF', 'ODP', 'PNG'], 'Файл → Скачать: only format names');
        assert.deepEqual(keysOf(find(w, 'spelling').sub), ['spellCheck', 'ignoreAll'], 'Правка → Орфография');
        assert.deepEqual(keysOf(find(w, 'macroMenu').sub), ['macros', 'recMacro', 'pauseMacro'], 'Вид → Макросы');
        assert.deepEqual(keysOf(find(w, 'moveSlide').sub), ['moveSlideStart', 'moveSlideEnd'], 'Слайд → Переместить слайд');
        const wrong = [];
        for (const [k, want] of Object.entries(BINDING)) {
            const it = find(w, k);
            for (const [f, v] of Object.entries(want)) if (JSON.stringify(it[f]) !== JSON.stringify(v)) wrong.push(k + '.' + f + ' = ' + JSON.stringify(it[f]));
        }
        assert.deepEqual(wrong, [], 'bindings');
        /* An item has exactly one binding; a submenu without a binding consists only of catalog items. */
        const bad = walk(groups).filter(({it}) => {
            const ways = ['twin', 'cmd', 'engine'].filter(f => it[f]).length;
            return ways > 1 || (ways === 0 && !(Array.isArray(it.sub) && it.sub.length));
        }).map(x => x.it.k);
        assert.deepEqual(bad, [], 'items without exactly one binding');
        /* Captions of stock commands come from the stock objects, translated by the stock locale. */
        assert.equal(find(w, 'undo').t, h.ruText('PE.Views.Toolbar.tipUndo'));
        assert.equal(find(w, 'duplicateSlide').t, h.ruText('PE.Views.DocumentHolder.txtDuplicateSlide'));
        assert.equal(find(w, 'coAuthMode').t, h.ruText('Common.Views.ReviewChanges.txtCoAuthMode'));
    }},

    {name: 'no_stock_interface_in_any_mode', fn() {
        const view = world();
        assert.equal(view.modules.CompactModes.setMode('view'), true);
        view.flush();
        const scenarios = [
            ['editor', world()],
            ['reader', world({edit: false})],
            ['view mode', view]
        ];
        for (const [name, w] of scenarios) {
            h.openSection(w, 'Файл');
            const menu = w.doc.querySelector('.vo-mn-drop.open');
            assert.ok(menu && menu.querySelector('[data-k="settings"]'), name + ': File menu is open');
            assert.ok(!menu.querySelector('[data-k="stockInterface"]'), name + ': File menu shows the stock interface');
            assert.equal(find(w, 'stockInterface'), null, name + ': catalog offers the stock interface');
        }
    }},

    {name: 'info_and_about_open_the_shell_windows', fn() {
        const w = world();
        const calls = [];
        w.shell.command('docInfo', () => calls.push('docInfo'));
        w.shell.command('about', () => calls.push('about'));
        const m = h.mark(w);
        assert.equal(w.SA.exec(find(w, 'info'), w.shell), true, 'File → Document info runs');
        assert.equal(w.SA.exec(find(w, 'about'), w.shell), true, 'Help → About runs');
        assert.deepEqual(calls, ['docInfo', 'about'], 'the shell windows open');
        const s = h.since(w, m);
        assert.deepEqual(s.act.map(a => a.label + '.' + a.event), [], 'the stock File screen and About panel stay closed');
    }},

    {name: 'edit_flag_on_every_editing_item', fn() {
        const w = world();
        const wrong = [];
        for (const {it} of walk(w.SA.groups())) {
            if (/^(download|zoom|fit)/.test(it.k) || ['show', 'notes', 'thumbs', 'focus', 'copy',
                'selectAll', 'search', 'print', 'info', 'settings', 'comment', 'sharing', 'history', 'comments',
                'spellCheck', 'ignoreAll', 'help', 'about'].includes(it.k)) {
                if (it.edit || it.needRight) wrong.push(it.k + ' must not be marked');
                continue;
            }
            if (EDIT.has(it.k) !== (it.edit === true)) wrong.push(it.k + ': edit ' + it.edit);
            if (NEED_RIGHT.has(it.k) !== (it.needRight === true)) wrong.push(it.k + ': needRight ' + it.needRight);
            if (!EDIT.has(it.k) && !NEED_RIGHT.has(it.k)) wrong.push(it.k + ': not classified');
        }
        assert.deepEqual(wrong, []);
    }},

    {name: 'rights_and_portal_items_not_drawn', fn() {
        const all = walk(world().SA.groups()).map(x => x.it.k);
        for (const k of ['download', 'downloadPPTX', 'print', 'rename', 'sharing', 'history', 'comment', 'comments']) assert.ok(all.includes(k), k + ' is offered');
        const none = world({download: false, print: false, rename: false, sharing: false, history: false, comment: false,
            viewComments: false, chat: false});
        const left = walk(none.SA.groups()).map(x => x.it.k);
        const drawn = ['download', 'downloadPPTX', 'downloadPDF', 'downloadODP', 'downloadPNG', 'print', 'rename', 'sharing', 'history',
            'comment', 'comments'].filter(k => left.includes(k));
        assert.deepEqual(drawn, [], 'items without the right are not drawn: no «Скачать ▸», no empty submenu');
        /* Empty edges and double separators do not remain. */
        const file = none.SA.groups()[0].items;
        assert.ok(!file[0].sep && !file[file.length - 1].sep && !file.some((x, i) => x.sep && file[i + 1] && file[i + 1].sep), 'separators');
        /* The stock editor hides the "Download as" item: "Download ▸" is hidden entirely, as in stock. */
        const w = world();
        w.modules.StockBridge.twin('FileMenu:miDownload').setVisible(false);
        assert.equal(w.SA.itemState(find(w, 'download')).hidden, true, 'stock hides «Скачать как»');
    }},

    /* Entering editing is for a reader whose host accepts a rights request: the first item
       of "File", with the stock caption and the stock handler. Without a handler there is no
       item in the editor either, as in the stock "File". */
    {name: 'reader_with_edit_request_gets_edit_item_first', fn() {
        assert.ok(!walk(world().SA.groups()).some(x => x.it.k === 'requestEdit'), 'an editor is offered the edit request');
        assert.ok(!walk(world({edit: false}).SA.groups()).some(x => x.it.k === 'requestEdit'), 'a reader without a request handler is offered it');
        const w = world({edit: false, requestEdit: true});
        const file = w.SA.groups()[0].items;
        assert.equal(file[0].k, 'requestEdit', 'the edit request is not the first File item: ' + keysOf(file));
        assert.ok(file[1].sep, 'no separator after the edit request: ' + keysOf(file));
        assert.equal(file[0].t, h.ruText('PE.Views.FileMenu.btnToEditCaption'), 'not the stock caption');
        const st = w.SA.itemState(file[0]);
        assert.ok(!st.disabled, 'the edit request is grey for a reader: ' + JSON.stringify(st));
        const m = h.mark(w);
        assert.equal(w.SA.exec(file[0], w.shell), true, 'the edit request does not run');
        /* The request is handled by Main.markEditRequest: one request to the host, the stock "File" item handler is not called. */
        const sent = h.since(w, m).calls;
        assert.equal(sent.filter(c => c.target === 'Gateway' && c.name === 'requestEditRights').length, 1, 'Gateway.requestEditRights once');
        assert.deepEqual(sent.filter(c => c.name === 'clickMenuFileItem').map(c => c.args[1]), [], 'the stock File handler runs too');
    }},

    /* A reader who can request editing sees, on disabled editing items, how to start it
       rather than "no permission". "Edit" is disabled without a connection with the connection reason, and after
       the choice — while the request is on its way (5 s): a second request is not sent. */
    {name: 'reader_who_can_request_edit_is_told_how_to_start_editing', fn() {
        const w = world({edit: false, requestEdit: true});
        for (const k of ['cut', 'paste', 'normal'])
            assert.equal(w.SA.itemState(find(w, k)).reason, RU.textNoEditRightRequest, k + ': not the edit request hint');
        const plain = world({edit: false});
        assert.equal(plain.SA.itemState(find(plain, 'cut')).reason, RU.textNoEditRight, 'a reader without a request handler');
        assert.ok(w.modules.CompactMenuAdapter.REASONS.includes('rightsRequest'), 'the adapter does not order rightsRequest');

        const item = find(w, 'requestEdit');
        const main = w.controllers.Main;
        main._state.isDisconnected = true;
        const off = w.SA.itemState(item);
        /* The reason text comes from the editor locale, not the English default of the shared menu bar. */
        assert.deepEqual([off.disabled, off.reason], [true, h.ruText('Common.UI.Compact.MenuBar.textReasonOffline')], 'offline: ' + JSON.stringify(off));
        assert.equal(w.SA.exec(item, w.shell), false, 'the request runs offline');
        main._state.isDisconnected = false;

        const m = h.mark(w);
        assert.equal(w.SA.exec(item, w.shell), true, 'the request does not run');
        const wait = w.SA.itemState(item);
        assert.deepEqual([wait.disabled, wait.reason], [true, null], 'while the request is on its way: ' + JSON.stringify(wait));
        assert.equal(w.SA.exec(item, w.shell), false, 'a second request runs while the first is on its way');
        assert.equal(h.since(w, m).calls.filter(c => c.target === 'Gateway' && c.name === 'requestEditRights').length, 1, 'one request');
        const timer = w.timers.find(t => t.ms === 5000 && !t.cancelled);
        assert.ok(timer, 'no five second wait');
        w.flush();
        assert.equal(w.SA.itemState(item).disabled, false, 'the item is back after the wait');
    }},

    {name: 'reason_order_mode_right_selection', fn() {
        /* The shell mode comes first, even without the edit right. */
        const r = world({edit: false}, w => { w.modules.CompactModes.reason = it => (it.edit ? 'MODE' : null); });
        assert.equal(r.SA.itemState(find(r, 'cut')).reason, 'MODE', 'the shell mode goes first');
        /* Then the right: for a reader the reason is the right, not the selection. */
        const reader = world({edit: false});
        assert.equal(reader.SA.itemState(find(reader, 'cut')).reason, RU.textNoEditRight);
        assert.equal(reader.SA.itemState(find(reader, 'normal')).reason, RU.textNoEditRight, 'needRight item');
        assert.equal(reader.SA.itemState(find(reader, 'paste')).hidden, undefined, 'an editing item stays visible grey for a reader');
        assert.notEqual(reader.SA.itemState(find(reader, 'copy')).reason, RU.textNoEditRight, '«Копировать» is not an editing item');
        /* Then the selection, then the twin. */
        const w = world({edit: true});
        setKind(w, 'none');
        assert.equal(w.SA.itemState(find(w, 'cut')).reason, RU.textSelectObject);
        setKind(w, 'shape');
        assert.equal(w.SA.itemState(find(w, 'cut')).disabled, false, 'live with an object');
        h.twinOf(w, find(w, 'cut')).setDisabled(true);
        const st = w.SA.itemState(find(w, 'cut'));
        assert.deepEqual([st.disabled, st.reason], [true, null], 'a locked twin greys the item without a selection reason');
    }},

    {name: 'states_recomputed_on_vo_mode', fn() {
        const w = world({edit: true});
        const modes = w.modules.CompactModes;
        assert.equal(w.SA.itemState(find(w, 'paste')).disabled, false);
        assert.equal(find(w, 'show').twin, 'Toolbar:btnPreview');
        modes.mode = () => 'view';
        modes.reason = it => (it.edit ? 'VIEW' : null);
        w.NC.trigger(modes.MODE_EVENT || 'vo:mode', {mode: 'view'});
        assert.equal(w.SA.itemState(find(w, 'paste')).reason, 'VIEW', 'an editing item greys in «Просмотр»');
        assert.equal(find(w, 'show').twin, 'Statusbar:btnPreview', 'the show runs from the status bar twin in «Просмотр»');
        assert.equal(find(w, 'thumbs').engine, 'LeftMenu.onShowTumbnails', '«Слайды» go through the stock handler in «Просмотр»');
        modes.mode = () => 'edit';
        modes.reason = () => null;
        w.NC.trigger(modes.MODE_EVENT || 'vo:mode', {mode: 'edit'});
        assert.equal(w.SA.itemState(find(w, 'paste')).disabled, false, 'back to live');
        assert.equal(find(w, 'thumbs').twin, 'LeftMenu:btnThumbs');
    }},

    {name: 'stock_lock_greys_editing_items', fn() {
        const w = world({edit: true});
        setKind(w, 'shape');
        const all = walk(w.SA.groups());
        /* Twins are alive: the stock ribbon mask does not gray them while buttons are banned. */
        all.forEach(x => { const t = h.twinOf(w, x.it); if (t) t.setDisabled(false); });
        const editing = all.filter(x => x.it.edit === true && !x.it.cmd);
        assert.ok(editing.length >= 30, 'editing items of the catalog: ' + editing.length);
        const PANEL = ['background', 'changeTheme', 'transition', 'animation', 'objectProperties'];
        const COLLAB = ['comment'];
        const LIVE = ['search', 'focus', 'hideToolbar', 'downloadPPTX', 'print', 'info', 'copy', 'notes', 'help'];
        const greyed = keys => keys.filter(k => w.SA.itemState(find(w, k)).disabled);
        assert.deepEqual(greyed(PANEL.concat(COLLAB, LIVE, ['delete', 'textbox'])), [], 'items are grey before the stock lock');
        h.openSection(w, 'Вставка');
        const row = k => w.doc.querySelector('.vo-mn-drop.open [data-k="' + k + '"]');
        assert.equal(row('textbox').getAttribute('aria-disabled'), 'false');

        /* Version history and connection loss: Main.disableEditing(true), the 'disconnect' type. */
        w.NC.trigger('editing:disable', true, stockOptions(true, 'disconnect'), 'disconnect');
        w.flush();
        const wrong = editing.map(x => ({x, st: w.SA.itemState(x.it)}))
            .filter(r => r.st.disabled !== true || r.st.reason)
            .map(r => r.x.section + ' → ' + r.x.it.k + ': ' + (r.st.disabled ? '«' + r.st.reason + '»' : 'live'));
        assert.deepEqual(wrong, [], 'editing items under the stock lock: grey, without a reason');
        const panel = PANEL.concat(COLLAB).filter(k => { const st = w.SA.itemState(find(w, k)); return st.disabled !== true || st.reason; });
        assert.deepEqual(panel, [], 'items opening the right panel, comments and chat stay live under the stock lock');
        assert.deepEqual(greyed(LIVE), [], 'the shell chrome, downloads and reading items are greyed by the stock lock');
        assert.equal(row('textbox').getAttribute('aria-disabled'), 'true', 'the open section is not recomputed on the stock lock');
        assert.equal(row('textbox').hasAttribute('title'), false, 'the locked item names a reason');
        const m = h.mark(w);
        for (const k of ['delete', 'textbox', 'background', 'comment']) assert.equal(w.SA.exec(find(w, k), w.shell), false, k + ' runs under the stock lock');
        const s = h.since(w, m);
        assert.deepEqual(s.act.map(a => a.label + '.' + a.event).concat(h.shellEdits(s.api).map(c => c.name)), [], 'a locked item reached the stock code or the engine');

        /* The ban is lifted: the items are alive again. */
        w.NC.trigger('editing:disable', false, stockOptions(false, 'disconnect'), 'disconnect');
        w.flush();
        assert.deepEqual(greyed(PANEL.concat(COLLAB, LIVE, ['delete', 'textbox', 'paste'])), [], 'items stay grey after the stock lock');

        /* Its own "View" reason is not the stock one: a comment in "View" is alive. */
        w.modules.CompactModes.setMode('view');
        w.flush();
        assert.equal(w.SA.itemState(find(w, 'comment')).disabled, false, '«Просмотр» is taken for a stock lock');
        assert.equal(w.SA.itemLocked(find(w, 'paste'), w.shell), false, '«Просмотр» is taken for a stock lock');
    }},

    {name: 'selection_reason_texts_exact', fn() {
        const w = world({edit: true});
        setKind(w, 'none');
        for (const k of ['undo', 'redo', 'pauseMacro', 'ungroup', 'copy', 'link']) h.twinOf(w, find(w, k)).setDisabled(true);
        for (const ref of ['Toolbar:btnInsertSymbol', 'FileMenu:miSave']) w.modules.StockBridge.twin(ref).setDisabled(true);
        const want = [
            ['undo', 'Нечего отменять'], ['redo', 'Нечего повторить'], ['cut', 'Выделите объект на слайде'],
            ['delete', 'Выделите объект на слайде'], ['arrange', 'Выделите объект на слайде'], ['text', 'Выделите текст'],
            ['columns', 'Выделите текст'], ['tableMenu', 'Выделите таблицу'], ['imageMenu', 'Выделите изображение'],
            ['pauseMacro', 'Запись макроса не идёт'], ['group', 'Выделите два объекта и больше'],
            ['ungroup', 'Выделенное — не группа'], ['shapesMerge', 'Выделите две фигуры и больше'],
            ['copy', 'Выделите объект или текст'], ['symbol', 'Поставьте курсор в текст'], ['link', 'Поставьте курсор в текст'],
            ['save', 'Нет несохранённых изменений']
        ];
        const got = want.map(([k]) => [k, w.SA.itemState(find(w, k)).reason]);
        assert.deepEqual(got, want);
        /* Texts are module keys: without a translation, English defaults, not literals in the code. */
        const src = fs.readFileSync(FILE, 'utf8');
        assert.ok(!/[А-Яа-яЁё]/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no Cyrillic literals in the module');
    }},

    /* Text items are alive only when the selection contains text: for a shape or a group
       without text they are gray with the reason "Select text", while the object items are alive. */
    {name: 'text_items_only_with_text_in_selection', fn() {
        const w = world({edit: true});
        const TEXT_ITEMS = ['text', 'changeCase', 'align', 'lineSpace', 'lists', 'columns', 'textDir', 'clearStyle'];
        const reasons = () => TEXT_ITEMS.map(k => [k, w.SA.itemState(find(w, k)).reason || null]);
        setKind(w, 'shape');
        assert.deepEqual(reasons(), TEXT_ITEMS.map(k => [k, 'Выделите текст']), 'text items live without text in the selection');
        for (const k of ['cut', 'arrange', 'alignObjects', 'rotate', 'objectProperties']) {
            assert.notEqual(w.SA.itemState(find(w, k)).reason, 'Выделите объект на слайде', k + ' needs another object than a shape without text');
        }
        for (const kind of ['image', 'chart', 'line']) {
            setKind(w, kind);
            assert.deepEqual(reasons().filter(r => r[1] !== 'Выделите текст'), [], kind + ': text items live without text');
        }
        for (const kind of ['text', 'typing']) {
            setKind(w, kind);
            assert.deepEqual(reasons().filter(r => r[1] === 'Выделите текст'), [], kind + ': text items grey with text in the selection');
        }
        setKind(w, 'table');
        assert.deepEqual(reasons().filter(r => r[1] === 'Выделите текст' && r[0] !== 'columns'), [], 'table: text items grey in a table');
        assert.equal(w.SA.itemState(find(w, 'columns')).reason, 'Выделите текст', 'table: text columns are a shape setting');
    }},

    {name: 'no_audio_video_items', fn() {
        const w = world();
        const av = walk(w.SA.groups()).filter(({it}) => /audio|video|аудио|видео/i.test(JSON.stringify(it)));
        assert.deepEqual(av.map(x => x.it.k), []);
        const code = fs.readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        assert.ok(!/btnInsAudio|btnInsVideo|AddAudio|AddVideo/i.test(code), 'the module wires audio or video');
    }},

    {name: 'engine_items_marked_and_spied', fn() {
        const w = world({edit: true});
        const bridge = w.modules.StockBridge;
        const names = walk(w.SA.groups()).filter(x => x.it.engine).map(x => x.it.engine);
        assert.ok(names.length >= 2, 'engine items: ' + names.join(', '));
        assert.deepEqual(names.filter(n => !bridge.engineMarked(n)), [], 'every engine call is marked for the bridge');
        /* "Delete" is the stock deletion of the selection by the engine, one call. */
        setKind(w, 'shape');
        let m = h.mark(w);
        assert.equal(w.SA.exec(find(w, 'delete'), w.shell), true);
        assert.deepEqual(h.since(w, m).api.filter(c => c.name === 'asc_Remove').length, 1, 'asc_Remove once');
        /* "Download PDF" is the stock left menu download handler, one call. */
        m = h.mark(w);
        w.SA.exec(find(w, 'downloadPDF'), w.shell);
        const dl = h.since(w, m).calls.filter(c => c.name === 'clickSaveAsFormat');
        assert.equal(dl.length, 1, 'LeftMenu.clickSaveAsFormat once');
        assert.equal(typeof dl[0].args[0].hide, 'function', 'the stock handler gets a menu it can hide');
        /* "Print" and "Save" are the stock left menu handlers, not a click on the "File" item:
           that one is caught by the menu markup, not by onItemClick. */
        m = h.mark(w);
        w.SA.exec(find(w, 'print'), w.shell);
        assert.equal(h.since(w, m).calls.filter(c => c.name === 'clickToolbarPrint').length, 1, 'LeftMenu.clickToolbarPrint once');
        m = h.mark(w);
        w.SA.exec(find(w, 'save'), w.shell);
        const save = h.since(w, m).calls.filter(c => c.name === 'clickMenuFileItem');
        assert.deepEqual(save.map(c => c.args[1]), ['save'], 'LeftMenu.clickMenuFileItem(save) once');
        /* The bridge does not execute an unmarked call. */
        m = h.mark(w);
        assert.equal(bridge.engine('asc_AddSlide'), undefined);
        assert.equal(h.since(w, m).api.length, 0, 'unmarked engine call refused');
        /* Without a selection "Delete" does not call the engine. */
        setKind(w, 'none');
        m = h.mark(w);
        assert.equal(w.SA.exec(find(w, 'delete'), w.shell), false);
        assert.equal(h.since(w, m).api.filter(c => c.name === 'asc_Remove').length, 0);
    }},

    {name: 'thumbs_via_stock_handler_when_twin_disabled_by_shell', fn() {
        const w = world({edit: true});
        let m = h.mark(w);
        w.SA.exec(find(w, 'thumbs'), w.shell);
        assert.equal(h.since(w, m).act.filter(a => a.label === 'LeftMenu:btnThumbs').length, 1, '«Вид → Слайды» clicks the stock button');
        /* "View": the shell ban grayed the button; the stock handler is LeftMenu.onShowTumbnails. */
        const modes = w.modules.CompactModes;
        modes.mode = () => 'view';
        h.twinOf(w, {twin: 'LeftMenu:btnThumbs'}).setDisabled(true);
        w.fire('asc_onThumbnailsShow', true);
        m = h.mark(w);
        assert.equal(w.SA.exec(find(w, 'thumbs'), w.shell), true);
        const calls = h.since(w, m).calls.filter(c => c.name === 'onShowTumbnails');
        assert.equal(calls.length, 1, 'the stock handler once');
        assert.equal(calls[0].args[1], false, 'hides the shown thumbnails');
    }},

    {name: 'thumbs_mark_follows_choice_without_engine_signal', fn() {
        /* An engine that hides the strip does not send asc_onThumbnailsShow: the choice itself keeps the mark. */
        const w = world({edit: true});
        w.fire('asc_onThumbnailsShow', true);
        assert.equal(w.SA.exec(find(w, 'thumbs'), w.shell), true);
        assert.equal(w.SA.itemState(find(w, 'thumbs')).checked, false, 'the mark stays after the thumbnails are hidden');
        const modes = w.modules.CompactModes;
        modes.mode = () => 'view';
        h.twinOf(w, {twin: 'LeftMenu:btnThumbs'}).setDisabled(true);
        w.NC.trigger(modes.MODE_EVENT || 'vo:mode', {mode: 'view'});
        const shown = [];
        for (let i = 0; i < 2; i++) {
            const m = h.mark(w);
            assert.equal(w.SA.exec(find(w, 'thumbs'), w.shell), true);
            shown.push(h.since(w, m).calls.filter(c => c.name === 'onShowTumbnails').map(c => c.args[1])[0]);
            shown.push(w.SA.itemState(find(w, 'thumbs')).checked);
        }
        assert.deepEqual(shown, [true, true, false, false], 'in «Просмотр» each choice flips the thumbnails and the mark');
        /* The engine signal, if there is one, stays the main one. */
        w.fire('asc_onThumbnailsShow', true);
        assert.equal(w.SA.itemState(find(w, 'thumbs')).checked, true);
    }},

    {name: 'thumbs_and_notes_checks_follow_engine', fn() {
        const w = world({edit: true});
        w.fire('asc_onThumbnailsShow', false);
        assert.equal(w.SA.itemState(find(w, 'thumbs')).checked, false);
        w.fire('asc_onThumbnailsShow', true);
        assert.equal(w.SA.itemState(find(w, 'thumbs')).checked, true);
        const notes = h.twinOf(w, find(w, 'notes'));
        notes.setValue(true, true);
        assert.equal(w.SA.itemState(find(w, 'notes')).checked, true);
        /* The configuration hid the notes: the stock checkbox is cleared, the mark is cleared. */
        notes.setValue(false, true);
        assert.equal(w.SA.itemState(find(w, 'notes')).checked, false);
        /* "Hide slide" works by the slide property in the engine selection. */
        w.selection = [{type: 7, props: {get_IsHidden: () => true}}];
        w.fire('asc_onFocusObject', w.api.getSelectedElements());
        assert.equal(w.SA.itemState(find(w, 'hideSlide')).checked, true);
    }},

    {name: 'menu_section_closes_the_file_screen', fn() {
        const w = world({edit: true});
        let open = true, hides = 0;
        w.views.LeftMenu.menuFile = {isVisible: () => open, hide() { hides++; open = false; }};
        h.openSection(w, 'Правка');
        assert.equal(hides, 1, 'a section opened over the File screen closes the screen');
        assert.ok(w.doc.querySelector('.vo-mn-drop.open'), 'the section opens');
        w.SA.closeMenu();
        h.openSection(w, 'Вставка');
        assert.equal(hides, 1, 'a closed File screen is not hidden again');
    }},

    /* Items from the stock context menus (slide, table, image) are set by stock
       only in initMenu when its own menu opens. The menu bar section rebuilds
       these menus from the current selection and does not read the trace of the last context menu. */
    {name: 'context_menu_items_follow_the_selection_not_the_last_context_menu', fn() {
        const w = world({edit: true});
        const dh = w.controllers.DocumentHolder, view = dh.documentHolder;
        const twin = n => w.modules.StockBridge.twin('DocumentHolder:' + n);
        const SLIDE_ITEMS = ['mnuDuplicateSlide', 'mnuDeleteSlide', 'mnuSlideHide'];
        const inits = [];
        let slideLock = false;
        dh.api = w.api;
        view.slideMenu = {options: {initMenu(v) {
            inits.push('slide ' + JSON.stringify(v));
            SLIDE_ITEMS.forEach(n => twin(n).setVisible(v.isSlideSelect === true));
            twin('mnuDeleteSlide').setDisabled(slideLock);
        }}};
        view.tableMenu = {options: {initMenu(v) { inits.push('table'); twin('mnuTableMerge').setDisabled(!!v.tableProps.locked); }}};
        view.pictureMenu = {options: {initMenu(v) { inits.push('picture'); twin('menuImgCrop').setDisabled(!!v.imgProps.locked); }}};
        dh.fillMenuProps = els => {
            const p = {};
            els.forEach(el => {
                const v = el.get_ObjectValue(), locked = typeof v.get_Locked === 'function' && !!v.get_Locked();
                if (el.get_ObjectType() === 1) p.tableProps = {value: v, locked};
                if (el.get_ObjectType() === 2) p.imgProps = {value: v, locked};
            });
            return {menu_to_show: null, menu_props: p};
        };
        const shown = label => keysOf(w.SA.visibleItems(w.SA.groups().find(g => g.label === label).items));
        const objectInits = () => inits.filter(s => !s.startsWith('slide '));

        /* The last context menu was opened on an empty place of the thumbnail strip: the slide
           items are hidden there, "Delete" is still grayed by the co-author lock. */
        SLIDE_ITEMS.forEach(n => twin(n).setVisible(false));
        twin('mnuDeleteSlide').setDisabled(true);
        h.openSection(w, 'Слайд');
        assert.ok(inits.some(s => /"isSlideSelect":true/.test(s) && /"fromThumbs":true/.test(s)),
            'the slide menu is not rebuilt for the current slide: ' + inits.join('; '));
        for (const k of ['duplicateSlide', 'deleteSlide', 'hideSlide']) assert.ok(shown('Слайд').includes(k), k + ' is missing: ' + shown('Слайд'));
        assert.equal(w.SA.itemState(find(w, 'deleteSlide')).disabled, false, 'a stale co-author lock stays on «Удалить слайд»');
        w.SA.closeMenu();
        slideLock = true;
        h.openSection(w, 'Слайд');
        assert.equal(w.SA.itemState(find(w, 'deleteSlide')).disabled, true, 'a fresh co-author lock is not read');
        w.SA.closeMenu();

        /* The table and image menu appear only when their own object is in the selection. */
        inits.length = 0;
        h.openSection(w, 'Формат');
        assert.deepEqual(objectInits(), [], 'object menus rebuilt without an object in the selection');
        w.SA.closeMenu();
        w.selection = [{type: 7, props: {}}, {type: 1, props: {get_Locked: () => true}}];
        setKind(w, 'table');
        inits.length = 0;
        h.openSection(w, 'Формат');
        assert.deepEqual(objectInits(), ['table'], 'table selection');
        assert.equal(w.SA.itemState(find(w, 'tableMerge')).disabled, true, 'the lock of the selected table is not read');
        w.SA.closeMenu();
        w.selection = [{type: 7, props: {}}, {type: 2, props: {get_Locked: () => false}}];
        setKind(w, 'image');
        twin('menuImgCrop').setDisabled(true);
        inits.length = 0;
        h.openSection(w, 'Формат');
        assert.deepEqual(objectInits(), ['picture'], 'image selection');
        assert.equal(w.SA.itemState(find(w, 'crop')).disabled, false, 'a stale lock stays on «Обрезать»');
    }},

    {name: 'flip_items_get_air_icons', fn() {
        const w = world({edit: true});
        const rotate = find(w, 'rotate');
        assert.ok(rotate && Array.isArray(rotate.icons), '«Упорядочить → Поворот ▸» has no icon table for its stock items');
        const table = {};
        rotate.icons.forEach(x => { table[x.cls] = x.i; });
        assert.equal(table['btn-flip-hor'], 'compare', '«Отразить слева направо» — рисунок общего набора под его именем');
        assert.equal(table['btn-flip-vert'], 'flipV', '«Отразить сверху вниз»');
        /* The classes are those the stock rotate menu gives its items. */
        const src = h.stockSource('view/DocumentHolderExt.js');
        const menu = src.slice(src.indexOf('me.menuImgShapeRotate = new'), src.indexOf('me.menuImgCrop = new'));
        Object.keys(table).forEach(cls => assert.ok(menu.includes("'menu__icon " + cls + "'"), cls + ' is not a stock icon class of the rotate menu'));
        const icons = w.modules.Icons;
        Object.values(table).forEach(name => {
            assert.ok(icons.has(name), name + ' is not a shell icon');
            assert.ok(icons.svg(name).indexOf('/common/main/resources/img/air/' + name + '.svg)') > 0, name + ' is not a shared AIR mask');
        });
    }},

    /* "View → Macros": the record and pause caption is the current caption of the stock button
       at the moment of opening. The catalog's t field stays a locale phrase. An already open
       submenu does not rewrite the caption. An empty caption and a vanished button are
       the phrase from t again. A click still calls the same button. */
    {name: 'macro_menu_captions_follow_stock_button', fn() {
        const w = world({edit: true});
        const REC = h.ruText('PE.Views.ViewTab.textRecMacro');
        const STOP = h.ruText('PE.Views.ViewTab.textStopMacro');
        const PAUSE = h.ruText('PE.Views.ViewTab.textPauseMacro');
        const RESUME = h.ruText('PE.Views.ViewTab.textResumeMacro');
        const recBtn = h.twinOf(w, find(w, 'recMacro'));
        const pauseBtn = h.twinOf(w, find(w, 'pauseMacro'));
        const setState = (record, pause, pauseOff) => {
            recBtn.setCaption(record);
            pauseBtn.setCaption(pause);
            pauseBtn.setDisabled(pauseOff);
        };
        const rowIn = (fly, k) => {
            const row = fly.querySelector('[data-k="' + k + '"]');
            assert.ok(row, k + ' is not in the macros submenu');
            return row;
        };
        const shown = (fly, k) => {
            const row = rowIn(fly, k);
            return [row.querySelector('.vo-mn-t').textContent, row.getAttribute('aria-disabled')];
        };
        const openMacros = () => {
            w.SA.closeMenu();
            h.openSection(w, 'Вид');
            const holder = w.doc.querySelector('.vo-mn-drop.open [data-k="macroMenu"]');
            assert.ok(holder, '«Вид → Макросы» is not shown');
            h.click(w, holder);
            const fly = w.doc.querySelector('.vo-mn-fly.open');
            assert.ok(fly, 'the macros submenu did not open');
            return fly;
        };
        const clicksSince = m => h.since(w, m).act.filter(a => a.event === 'click').map(a => a.label);

        assert.equal(find(w, 'recMacro').t, REC, 'the catalog phrase of record changed');
        assert.equal(find(w, 'pauseMacro').t, PAUSE, 'the catalog phrase of pause changed');
        assert.equal(find(w, 'recMacro').liveCaption, true, 'record does not read the stock caption');
        assert.equal(find(w, 'pauseMacro').liveCaption, true, 'pause does not read the stock caption');

        setState(REC, PAUSE, true);
        let fly = openMacros();
        assert.deepEqual(shown(fly, 'recMacro'), [REC, 'false'], 'idle record caption');
        assert.deepEqual(shown(fly, 'pauseMacro'), [PAUSE, 'true'], 'idle pause stays inactive');
        let mark = h.mark(w);
        h.click(w, rowIn(fly, 'pauseMacro'));
        assert.deepEqual(clicksSince(mark), [], 'an inactive pause click reached the stock button');
        mark = h.mark(w);
        h.click(w, rowIn(fly, 'recMacro'));
        assert.deepEqual(clicksSince(mark), ['ViewTab:btnRecMacro'], 'record click');

        setState(STOP, PAUSE, false);
        fly = openMacros();
        assert.deepEqual(shown(fly, 'recMacro'), [STOP, 'false'], 'recording caption');
        assert.deepEqual(shown(fly, 'pauseMacro'), [PAUSE, 'false'], 'pause while recording');
        mark = h.mark(w);
        h.click(w, rowIn(fly, 'pauseMacro'));
        assert.deepEqual(clicksSince(mark), ['ViewTab:btnPauseMacro'], 'pause click');

        setState(STOP, RESUME, false);
        fly = openMacros();
        assert.deepEqual(shown(fly, 'recMacro'), [STOP, 'false'], 'record stays stop while paused');
        assert.deepEqual(shown(fly, 'pauseMacro'), [RESUME, 'false'], 'paused caption');
        mark = h.mark(w);
        h.click(w, rowIn(fly, 'recMacro'));
        assert.deepEqual(clicksSince(mark), ['ViewTab:btnRecMacro'], 'stop click');
        fly = openMacros();
        mark = h.mark(w);
        h.click(w, rowIn(fly, 'pauseMacro'));
        assert.deepEqual(clicksSince(mark), ['ViewTab:btnPauseMacro'], 'resume click');

        /* An already open submenu keeps the caption from opening time. */
        setState(STOP, PAUSE, false);
        fly = openMacros();
        recBtn.setCaption(REC);
        pauseBtn.setCaption(RESUME);
        assert.deepEqual(shown(fly, 'recMacro'), [STOP, 'false'], 'an open submenu rewrote the record caption');
        assert.deepEqual(shown(fly, 'pauseMacro'), [PAUSE, 'false'], 'an open submenu rewrote the pause caption');
        fly = openMacros();
        assert.deepEqual(shown(fly, 'recMacro'), [REC, 'false'], 'reopen did not read the new record caption');
        assert.deepEqual(shown(fly, 'pauseMacro'), [RESUME, 'false'], 'reopen did not read the new pause caption');

        setState('', '', true);
        fly = openMacros();
        assert.deepEqual(shown(fly, 'recMacro'), [REC, 'false'], 'an empty record caption did not fall back to the catalog phrase');
        assert.deepEqual(shown(fly, 'pauseMacro'), [PAUSE, 'true'], 'an empty pause caption did not fall back to the catalog phrase');

        w.views.ViewTab.btnRecMacro = null;
        w.views.ViewTab.btnPauseMacro = null;
        fly = openMacros();
        assert.deepEqual(shown(fly, 'recMacro'), [REC, 'true'], 'a missing record button did not fall back to the catalog phrase');
        assert.deepEqual(shown(fly, 'pauseMacro'), [PAUSE, 'true'], 'a missing pause button did not fall back to the catalog phrase');
        assert.equal(find(w, 'recMacro').t, REC, 'the catalog phrase of record changed');
        assert.equal(find(w, 'pauseMacro').t, PAUSE, 'the catalog phrase of pause changed');
    }}
];

h.run(tests);
