/* Spreadsheet editor behind the shared compact menu contract, for the shared layer tests.
 * The catalog (SheetActions.js), the bridge to the stock controls (StockBridge.js), the adapter
 * (CompactMenuAdapter.js) and the shared adapter kit it reads the stock parts with (AdapterKit.js)
 * are the real ones; around them stands a small stock editor: Main with its options, stack of
 * editing locks and license state, the stock controls the catalog items are twins of (ribbon
 * tabs, the left menu, the sheet tabs row, the review tab) with their disabled state, press and
 * lock causes, the stock shortcut registry, an api that records every call and a shell that
 * records what it is asked to do.
 * The same file runs in Node (it loads the modules into a vm context itself) and in the menu
 * bar test page, where lib/menu-bar-page.cjs calls install(window) and loads `scripts` after it.
 *
 * context(overrides) gives the editor state the stock parts read at every call:
 *  - reasons  — common reasons in force: 'limit' (the license limit, the session is closed),
 *               'offline' (a lost connection), 'view' (own view of the shell) — each an entry of
 *               the stock lock stack with the options the stock gives it, the ribbon mask among
 *               them — and 'protected' (the sheet is protected: the controls of a protected sheet
 *               are disabled with the stock lock cause);
 *  - rights   — 'edit' or 'view': a reader has no editing ribbon (only copy, paste, undo and
 *               redo), no data, formula, protection and pivot tabs and the engine is in view mode;
 *  - requestEdit — the reader may ask for editing (canRequestEditRights);
 *  - cellEdit — a cell is being edited: the stock disables the controls it keeps for the edit
 *               with the cell editing cause, and F10 is left to the cell;
 *  - download, print, history, share, coauth, comments — rights and integration behind the items;
 *  - rtl, filter, sheetView ('normal' | 'layout') — what the pressed twins of the sheet direction,
 *               the filter and the sheet view show;
 *  - modal    — a stock window is open (Common.Utils.ModalWindow).
 * Every command an item runs is recorded in context().log as {k, args}; every click of a stock
 * control as {stock: ref}; every call to the api, the shell and the notification center as
 * {api | shell | event}; every engine keys call as {keys}; every item state read through the
 * adapter counts in context().reads.
 */
const ROOT_PARTS = ['..', '..', '..', '..', '..'];

/* Modules the page loads after install(), in this order. Paths from the repository root. */
const SCRIPTS = [
    'apps/common/main/lib/view/compact/AdapterKit.js',
    'apps/spreadsheeteditor/main/app/view/StockBridge.js',
    'apps/spreadsheeteditor/main/app/view/SheetActions.js',
    'apps/spreadsheeteditor/main/app/view/CompactMenuAdapter.js'
];

/* Stock shortcuts of the commands the menu shows, as the registry gives their keys. */
const SHORTCUTS = {
    Save: ['Ctrl', 'S'], PrintPreviewAndPrint: ['Ctrl', 'P'], EditUndo: ['Ctrl', 'Z'], EditRedo: ['Ctrl', 'Y'],
    EditSelectAll: ['Ctrl', 'A'], OpenFindDialog: ['Ctrl', 'F']
};

/* Ribbon of a reader: the stock builds it without editing commands. */
const READER_RIBBON = ['btnCopy', 'btnPaste', 'btnUndo', 'btnRedo'];

/* Stock controls a protected sheet disables, with the lock cause the stock records
   (controller/WBProtection.js), and those the stock keeps disabled while a cell is edited
   (controller/Toolbar.js onEditCell). */
const PROTECTED = ['Toolbar:btnMerge', 'Toolbar:btnBorders', 'Toolbar:btnWrap'];
const CELL_EDIT = ['Toolbar:btnBold', 'Toolbar:btnMerge', 'Toolbar:btnInsertImage', 'Toolbar:btnClearStyle'];

/* Pressed twins and the state field behind each. */
const PRESSED = {
    'Toolbar:btnRtlSheet': w => !!w.rtl,
    'DataTab:btnsSetAutofilter.0': w => !!w.filter,
    'ViewTab:btnViewNormal': w => w.sheetView !== 'layout',
    'ViewTab:btnViewPageBreak': w => w.sheetView === 'layout'
};

/* Stock lock stack entries behind each common reason, as Main.disableEditing and the own view
   of the shell (CompactShell.viewOptions) push them. */
const LOCK_OPTIONS = {
    viewMode: true, rightMenu: {disable: true}, statusBar: true, leftMenu: {disable: true, previewMode: true},
    fileMenu: {protect: true}, review: true, viewport: true, documentHolder: {disable: true}, toolbar: true,
    celleditor: {previewMode: true}
};
const STACK = {
    view: {type: 'vo-view', options: Object.assign({}, LOCK_OPTIONS, {comments: {disable: false, previewMode: true}})},
    offline: {type: 'reconnect', options: Object.assign({}, LOCK_OPTIONS, {comments: {disable: false, previewMode: true}})},
    limit: {type: 'disconnect', options: Object.assign({}, LOCK_OPTIONS, {comments: {disable: true, previewMode: true}})}
};
const STACK_ORDER = ['view', 'offline', 'limit'];

/* Values engine calls return; any other api method records the call and returns nothing. */
const RETURNS = {
    canEdit: w => w.rights === 'edit' && w.entries().length === 0,
    asc_isProtectedSheet: w => (w.reasons || []).includes('protected'),
    asc_isWorkbookLocked: () => false,
    asc_isProtectedWorkbook: () => false,
    asc_isDocumentModified: () => false,
    asc_getActiveWorksheetIndex: () => 0
};

const DEFAULTS = {
    reasons: [], rights: 'edit', requestEdit: false, cellEdit: false, download: true, print: true, history: true,
    share: true, coauth: true, comments: true, rtl: false, filter: false, sheetView: 'normal', modal: false
};

function install(G) {
    const world = () => G.__world;
    const record = entry => { const w = world(); if (w) w.log.push(entry); };
    G.window = G.window || G;
    G._ = G._ || {extend: Object.assign};
    G.Common = G.Common || {};
    const handlers = {};
    Object.assign(G.Common, {
        NotificationCenter: {
            on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
            off() {},
            trigger(name, ...args) {
                record({event: name});
                (handlers[name] || []).slice().forEach(fn => fn(...args));
            }
        },
        Utils: {ModalWindow: {isVisible: () => !!(world() && world().modal)}},
        localStorage: {getItem: () => null, setItem() {}, removeItem() {}, getBool: (k, d) => !!d, setBool() {}}
    });
    G.Common.UI = G.Common.UI || {};
    G.Common.UI.LayoutManager = {isElementVisible: () => true};
    G.Common.UI.Menu = {Manager: {hideAll() {}}};
    G.Common.Gateway = {requestEditRights: () => record({shell: 'requestEditRights'})};
    G.Common.UI.Compact = G.Common.UI.Compact || {};
    /* The shared About window: the catalogue builds it itself. */
    G.Common.UI.Compact.AboutWindow = function () {
        this.on = () => this;
        this.show = () => record({shell: 'about'});
    };
    G.Asc = Object.assign(G.Asc || {}, {
        c_oLicenseResult: {Connections: 1, UsersCount: 2, ConnectionsOS: 3, UsersCountOS: 4, Success: 5},
        c_oAscFileType: {XLSX: 257, PDF: 513, CSV: 260, ODS: 259},
        c_oAscCleanOptions: {All: 0, Text: 1, Format: 2, Comments: 5, Hyperlinks: 6},
        c_oAscRestrictionType: {None: 0, OnlyForms: 1, OnlyComments: 2, OnlySignatures: 4, View: 0x80}
    });

    /* Stock controls by address (StockBridge.ROOTS form, 'Root:path'), made once: the same
       object at every read, its state read from the editor state at every call. */
    const made = {};
    const disabledOf = ref => {
        const w = world();
        if (!w) return false;
        return (w.reasons.includes('protected') && PROTECTED.includes(ref)) || (!!w.cellEdit && CELL_EDIT.includes(ref)) ||
            (w.lockedLeft() && ['LeftMenu:btnSpellcheck'].includes(ref)) ||
            (w.lockedComments() && ref === 'LeftMenu:btnComments') ||
            (w.entries().length > 0 && ['Review:btnCommentResolve', 'Review:btnCommentRemove'].includes(ref));
    };
    const causesOf = ref => {
        const w = world(), out = [];
        if (!w) return out;
        if (w.reasons.includes('protected') && PROTECTED.includes(ref)) out.push('worksheet-lock');
        if (w.cellEdit && CELL_EDIT.includes(ref)) out.push('cell-editing');
        return out;
    };
    const control = ref => {
        if (made[ref]) return made[ref];
        const c = {
            visible: true, hidden: false, rendered: true, options: {lock: []},
            get disabled() { return disabledOf(ref); },
            get pressed() { return !!(PRESSED[ref] && world() && PRESSED[ref](world())); },
            get keepState() { return causesOf(ref); },
            isDisabled() { return disabledOf(ref); },
            setDisabled() {},
            on() {}, off() {},
            trigger(...args) { record({stock: ref, args: args.slice(0, 1)}); },
            click() { if (!disabledOf(ref)) record({stock: ref}); }
        };
        return (made[ref] = c);
    };
    /* A stock check box of the View tab (Common.UI.CheckBox). */
    const checkbox = ref => {
        if (made[ref]) return made[ref];
        let checked = false;
        return (made[ref] = {
            rendered: true, visible: true, hidden: false, options: {},
            get keepState() { return causesOf(ref); },
            isChecked: () => checked, isDisabled: () => disabledOf(ref), setDisabled() {},
            setValue(v) { checked = !!v; record({stock: ref}); },
            onItemCheck() { if (!disabledOf(ref)) this.setValue(!checked); }
        });
    };
    /* A root of stock controls where any btn… exists (a reader has only the listed ones). */
    const root = (name, own = {}, only) => new Proxy(own, {
        get(t, k) {
            if (typeof k !== 'string') return t[k];
            if (k in t) return t[k];
            if (!/^btn/.test(k)) return undefined;
            const list = typeof only === 'function' ? only() : null;
            if (list && !list.includes(k)) return undefined;
            return /^btns/.test(k) ? [control(name + ':' + k + '.0')] : control(name + ':' + k);
        }
    });
    const editor = () => !!(world() && world().rights === 'edit');
    /* The number format and cell style lists of the editing ribbon are not buttons. */
    const toolbar = root('Toolbar', {
        get cmbNumberFormat() { return editor() ? control('Toolbar:cmbNumberFormat') : undefined; },
        get listStyles() { return editor() ? control('Toolbar:listStyles') : undefined; }
    }, () => (editor() ? null : READER_RIBBON));
    const toolbarCtl = root('ToolbarCtl', {toolbar, get api() { return world() && world().api; }});
    const tabs = {
        DataTab: root('DataTab'), Formula: root('Formula'), PivotTable: root('PivotTable'),
        WBProtection: root('WBProtection', {
            get chHiddenFormula() { return editor() ? checkbox('WBProtection:chHiddenFormula') : undefined; },
            get chLockedShape() { return editor() ? checkbox('WBProtection:chLockedShape') : undefined; },
            get chLockedText() { return editor() ? checkbox('WBProtection:chLockedText') : undefined; }
        })
    };
    const viewTab = root('ViewTab', {
        get chGridlines() { return editor() ? checkbox('ViewTab:chGridlines') : undefined; },
        get chHeadings() { return editor() ? checkbox('ViewTab:chHeadings') : undefined; },
        get chZeros() { return editor() ? checkbox('ViewTab:chZeros') : undefined; },
        get btnMacros() { return editor() ? control('ViewTab:btnMacros') : undefined; },
        get btnRecMacro() { return editor() ? control('ViewTab:btnRecMacro') : undefined; },
        get btnPauseMacro() { return editor() ? control('ViewTab:btnPauseMacro') : undefined; }
    });
    const review = root('Review');
    const fileMenu = {
        getButton: k => (k === 'protect' || k === 'rename' ? {isDisabled: () => !!(world() && world().lockedLeft())} : null),
        applyMode() {}
    };
    const leftMenu = Object.assign(root('LeftMenu', {menuFile: fileMenu, _state: {}, buttons: []}), {});
    const leftView = new Proxy(leftMenu, {
        get(t, k) {
            if (k === 'showMenu') return (...args) => record({shell: 'showMenu', args});
            if (k === 'getMenu') return () => fileMenu;
            if (k === 'close' || k === 'setDisabledPluginButtons') return () => {};
            return t[k];
        }
    });
    const statusbar = {
        mode: {},
        get btnZoomUp() { return control('Statusbar:btnZoomUp'); },
        get btnZoomDown() { return control('Statusbar:btnZoomDown'); },
        get btnAddWorksheet() { return control('Statusbar:btnAddWorksheet'); },
        tabMenu: {items: [0, 1, 2, 3, 4, 5].map(i => control('Statusbar:tabMenu.items.' + i))}
    };
    const controllers = {
        Main: () => world() && world().main,
        Viewport: () => ({getApi: () => world() && world().api}),
        Toolbar: () => toolbarCtl,
        DataTab: () => (editor() ? {view: tabs.DataTab} : null),
        FormulaDialog: () => (editor() ? {formulaTab: tabs.Formula} : null),
        WBProtection: () => (editor() ? {view: tabs.WBProtection} : null),
        PivotTable: () => (editor() ? {view: tabs.PivotTable} : null),
        ViewTab: () => ({view: viewTab, onClickMacros: () => record({shell: 'macros'})}),
        'Common.Controllers.ReviewChanges': () => ({view: review}),
        LeftMenu: () => ({
            leftMenu: leftView,
            clickSaveAsFormat: (menu, type) => record({shell: 'saveAs', args: [type]}),
            clickMenuFileItem: (menu, name) => record({shell: 'fileItem', args: [name]})
        }),
        Statusbar: () => ({statusbar}),
        DocumentHolder: () => ({onCopyPaste: item => record({shell: 'copyPaste', args: [item && item.value]})}),
        /* Comments in their preview mode: the right is out of the options while a lock is in force,
           the value before it is kept here. */
        'Common.Controllers.Comments': () => {
            const w = world();
            return w ? {get viewmode() { return w.entries().length > 0; }, mode: w.main.appOptions, prevcanComments: !!w.comments} : null;
        },
        'Common.Controllers.Shortcuts': () => ({
            getShortcutsByActionType: sc => (SHORTCUTS[sc] ? [{keys: SHORTCUTS[sc]}] : null)
        })
    };
    G.SSE = G.SSE || {};
    G.SSE.Views = G.SSE.Views || {};
    G.SSE.getController = name => (controllers[name] ? controllers[name]() : null);
    G.window.SSE = G.SSE;
    /* Modules of the spreadsheet editor take their spreadsheet dependencies by name from
       SSE.Views, the shared ones from Common.UI.Compact. */
    G.define = (deps, factory) => factory.apply(null, deps.map(d => {
        const name = d.split('/').pop();
        if (/^spreadsheeteditor\//.test(d)) return G.SSE.Views[name];
        const shared = G.Common && G.Common.UI && G.Common.UI.Compact;
        return shared ? shared[name] : undefined;
    }));
}

/* In Node: a vm context with the stock stand-ins and the modules, made once. */
let nodeGlobal = null;
function host() {
    if (typeof window !== 'undefined' && window.SSE && window.SSE.Views && window.SSE.Views.CompactMenuAdapter) return window;
    if (nodeGlobal) return nodeGlobal;
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const root = path.resolve(__dirname, ...ROOT_PARTS);
    const G = {console, setTimeout, clearTimeout};
    vm.createContext(G);
    install(G);
    for (const file of ['apps/common/main/lib/view/compact/MenuModel.js'].concat(SCRIPTS))
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), G, {filename: path.join(root, file)});
    nodeGlobal = G;
    return G;
}

function context(overrides) {
    const G = host();
    const w = Object.assign({}, DEFAULTS, {log: [], reads: 0}, overrides || {});
    const record = entry => w.log.push(entry);
    w.entries = () => STACK_ORDER.filter(code => (w.reasons || []).includes(code))
        .map(code => ({type: STACK[code].type, disable: true, options: STACK[code].options}));
    w.lockedLeft = () => w.entries().some(e => !!(e.options.leftMenu && e.options.leftMenu.disable));
    w.lockedComments = () => w.entries().some(e => !!(e.options.comments && e.options.comments.disable));
    /* The options of Main; while a lock takes the left menu away, LeftMenu.SetDisabled turns isEdit
       and canEdit off, and the comments preview mode turns canComments off. */
    const options = {};
    const option = (name, read) => Object.defineProperty(options, name, {get: read, enumerable: true});
    option('isEdit', () => w.rights === 'edit' && !w.lockedLeft());
    option('canEdit', () => (w.rights === 'edit' || !!w.requestEdit) && !w.lockedLeft());
    option('canRequestEditRights', () => !!w.requestEdit);
    option('canDownload', () => !!w.download);
    option('canPrint', () => !!w.print);
    option('canUseHistory', () => !!w.history);
    option('canRequestSharingSettings', () => !!w.share);
    option('canChangeCoAuthoring', () => !!w.coauth);
    option('canViewComments', () => !!w.comments);
    option('canComments', () => !!w.comments && w.entries().length === 0);
    option('isDisconnected', () => (w.reasons || []).includes('limit'));
    Object.assign(options, {canCoAuthoring: true, canHelp: true, canRename: false, canCopy: true, isOffline: false,
        isDesktopApp: false, customization: {}, lang: 'en'});
    w.main = {
        appOptions: options,
        stackDisableActions: {length: () => w.entries().length, get: i => w.entries()[i]},
        _state: {
            get licenseType() { return (w.reasons || []).includes('limit') ? G.Asc.c_oLicenseResult.Connections : undefined; },
            get isDisconnected() { return (w.reasons || []).includes('limit'); }
        }
    };
    w.api = new Proxy({}, {
        get(t, name) {
            if (typeof name !== 'string' || name === 'then') return undefined;
            if (name === 'isCellEdited') return !!w.cellEdit;
            if (name === 'isViewMode') return w.rights !== 'edit';
            if (name === 'asc_registerCallback' || name === 'asc_unregisterCallback') return () => {};
            return (...args) => {
                if (!RETURNS[name]) record({api: name, args});
                return RETURNS[name] ? RETURNS[name](w) : undefined;
            };
        }
    });
    const call = name => (...args) => { record({shell: name, args}); };
    /* The shell the catalog asks: the lock in force over the edit right (CompactShell.lockState), the
       reason it can name (modeCode), the rows it has (canUse), the title field (canRename). */
    w.shell = {
        get editRight() { return w.rights === 'edit'; },
        lockState() {
            const list = w.entries(), top = list[list.length - 1];
            if (top) return {on: true, options: top.options, type: top.type};
            if (w.rights !== 'edit') return {on: true, options: {}, type: 'rights'};
            return {on: false, options: {}};
        },
        modeCode(st) {
            st = st || this.lockState();
            if (!st || !st.on) return null;
            if (st.type === 'vo-view') return 'view';
            if (st.type === 'rights') return w.requestEdit ? 'rightsRequest' : 'rights';
            return null;
        },
        canUse: name => (name === 'toolbar' || name === 'rightPanel' ? w.rights === 'edit' && !(w.reasons || []).includes('view') : true),
        canRename: () => w.rights === 'edit' && w.entries().length === 0,
        batch: fn => fn(),
        toggleToolbar: call('toggleToolbar'), toggleFocus: call('toggleFocus'), toggleMode: call('toggleMode'),
        revealLeft: call('revealLeft'), syncLeftState: call('syncLeftState'), editTitle: () => false
    };
    G.__world = w;
    w.real = G.SSE.Views.CompactMenuAdapter.create(w.shell, w.api);
    /* The context the items read: the adapter's own, over this state. */
    Object.assign(w, w.real.context());
    return w;
}

/* Sections in the shape of the shared model: the adapter sections with their items. */
function sections(ctx) {
    const real = (ctx || context()).real;
    return real.sections().map(s => ({k: s.k, t: s.t, items: real.groups(s.k)}));
}

function reasonText(code) {
    return host().SSE.Views.SheetActions.reasonText(code);
}

/* The adapter the menu bar gets: the real one, with the log and the read counter of the tests. */
function adapter(ctx) {
    const real = ctx.real;
    const keys = name => () => { ctx.log.push({keys: name}); real.keys[name](); };
    return Object.assign({}, real, {
        itemState: it => { ctx.reads++; return real.itemState(it); },
        exec: (it, args) => {
            const ran = real.exec(it, args);
            if (ran) ctx.log.push({k: it.k, args});
            return ran;
        },
        keys: {hold: keys('hold'), release: keys('release'), beforeCommand: keys('beforeCommand')}
    });
}

/* Rows and state changes the shared menu bar tests use with this editor. */
const roles = {
    order: ['file', 'edit', 'view', 'insert', 'format', 'data', 'collab', 'help'],
    first: {k: 'file', label: 'File', firstItem: 'save', lastItem: 'advancedSettings'},
    second: {label: 'Edit', firstLocked: {reasons: ['view']}},
    scanFrom: 720,
    submenu: {section: 'file', row: 'download', index: 2, plain: 'save',
        rows: ['downloadXlsx', 'downloadPdf', 'downloadCsv', 'downloadOds']},
    check: {section: 'data', row: 'filter', on: {filter: true}, off: {filter: false}},
    radio: {section: 'view', context: {sheetView: 'normal'}, rows: ['viewNormal', 'viewPageLayout'], checked: 'viewNormal',
        header: null},
    widget: null,
    /* A lost connection and the license limit grey the rows without a reason: the stock names them
       itself. The common reason the spreadsheet menu names is its own view and the protected sheet. */
    locked: {context: {reasons: ['view']}, section: 'edit', row: 'undo', title: 'The document is open for viewing'},
    greyLater: {section: 'edit', row: 'redo', lock: {reasons: ['view']}, title: 'The document is open for viewing'},
    /* «Show ▸» goes grey with its rows when the engine takes no edits. */
    subLock: {section: 'view', row: 'show', item: 'gridlines', before: {}, after: {reasons: ['view']},
        title: 'The document is open for viewing'},
    reasons: {net: {section: 'file', row: 'save'}, edit: {section: 'format', row: 'wrap'}, context: {}, own: null,
        common: {reasons: ['view'], key: 'textReasonView', title: 'The document is open for viewing'}},
    /* A cell edit is a reason the spreadsheet adapter declares. */
    ownReason: {section: 'format', row: 'merge', context: {cellEdit: true}, code: 'cellEdit', title: 'Finish editing the cell first'},
    shortcut: {section: 'file', row: 'save', text: 'Ctrl+S', mac: '⌘S', plain: 'import'},
    tail: {k: 'data', index: 5, label: 'Data', click: 'sortAZ',
        rows: ['sortAZ', 'sortZA', 'customSort', 'filter', 'clearFilter', 'slicer', 'validation', 'textToColumns',
            'removeDuplicatesData', 'externalLinks', 'group', 'ungroup', 'namedRanges', 'formulas', 'analysis']},
    about: 'about',
    /* Every section keeps items for a reader: the items it may not run stay in place, disabled. */
    viewer: null,
    /* The toggle is the fourth row of Data: arrows reach it from the first one. */
    refresh: {index: 5, label: 'Data', downs: 4, nextFirst: 'sharing', lockLabel: 'Format', lockRow: 'wrap',
        lock: {reasons: ['offline']}, unlock: {reasons: []}},
    /* The last row of every section stays whatever the rights and the integration give. */
    hide: {section: 'collab', index: 6, middle: 'history', middleOff: {history: false}, next: 'comments',
        last: null, restore: {history: true},
        rows: ['sharing', 'coauthMode', 'history', 'comments', 'resolveComments', 'deleteComments', 'protect']},
    emptied: null,
    anySection: 'edit',
    /* A stock window over the editor; a visible loading mask (.asc-loadmask) covers it as well. */
    modal: {on: {modal: true}, off: {modal: false}, mask: true}
};

module.exports = {
    name: 'spreadsheeteditor',
    /* The global the modules run in (Node: the vm context; page: window), to load more modules into it. */
    host,
    pinned: 'help',
    depth: 2,
    scripts: SCRIPTS,
    install,
    context,
    sections,
    reasonText,
    adapter,
    roles
};
