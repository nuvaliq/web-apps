/* Document editor behind the shared compact menu contract, for the shared layer tests.
 * The catalog (DocumentActions.js), the adapter (CompactMenuAdapter.js) and the shared adapter kit it
 * reads the stock parts with (AdapterKit.js) are the real ones; around them stands a small stock editor: Main with its options, stack of editing locks and
 * state, the document protection, the stock shortcut registry, an api that records every call
 * and a shell that records what it is asked to do.
 * The same file runs in Node (it loads the modules into a vm context itself) and in the menu
 * bar test page, where lib/menu-bar-page.cjs calls install(window) and loads `scripts` after it.
 *
 * context(overrides) gives the editor state the stock parts read at every call:
 *  - reasons  — reasons of the editor state in force: the common limit, offline, view, protected and
 *               the review shown (final, original) and form filling the documents adapter declares;
 *  - rights   — 'edit' or 'view'; editMode, editRight — options isEdit and canEdit apart (a view
 *               session of a user with the edit right: {editMode: false, editRight: true}). While a
 *               lock of the stack takes the left menu away (leftMenu.disable: own view, a lost
 *               connection), the options read isEdit and canEdit false and the stock LeftMenu keeps
 *               these values, as LeftMenu.SetDisabled does. Any lock of the stack (every stock caller
 *               of editing:disable passes review and comments.previewMode) and some protections put the
 *               stock ReviewChanges and Comments into their preview mode: the options read canReview
 *               (under any lock, read-only, forms-only and comments-only protection) and canComments
 *               (under any lock, read-only and forms-only protection) false, and these controllers
 *               keep the values before it (prevcanReview, prevcanComments), as their
 *               updatePreviewMode does;
 *  - stack    — extra entries of the stock lock stack ({type, options});
 *  - license  — name of Asc.c_oLicenseResult set as Main._state.licenseType;
 *  - disconnected — the session is closed for good (Main._state.isDisconnected);
 *  - protection — the stock protection snapshot ({isReadOnly | isCommentsOnly | isFormsOnly | isReviewOnly}); the
 *               engine gives the same protection with asc_getDocumentProtection, with a password when
 *               `password` is set in it;
 *  - display  — 'final' or 'original' shown by the engine;
 *  - download, print, rename, share, history, review, coauth, comments, requestEdit, track, compare — rights,
 *               integration and engine flags behind the items;
 *  - changes, atChange — the document has tracked changes; the cursor stands on one of them;
 *  - commentsOpen — the comments panel of the stock left menu is open;
 *  - undo, redo, selection — what the engine says it can undo, redo, cut and copy (on by default);
 *  - rulers, marks, tableGrid, multipage — view settings the engine reports;
 *  - zoom     — {percent, type} the engine reports with asc_onZoomChange once the editor is set up;
 *  - outline, toolbarHidden, focusMode — the outline rail open, the folded toolbar and the header and
 *               menu collapsed by hand (focus mode) in the shell;
 *  - modal    — a stock window is open (Common.Utils.ModalWindow);
 *  - control  — the caret is in a content control {lock, type}: names of Asc.c_oAscSdtLockType and
 *               Asc.c_oAscContentControlSpecificType (Unlocked and None by default);
 *  - engine   — api methods the test gives itself ({name: fn}), called after the call is recorded;
 *  - missing  — names of api methods the editor lacks.
 * Every command an item runs is recorded in context().log as {k, args}; every call to the api,
 * the shell and the notification center as {api | shell | event}; every engine keys call as
 * {keys}; every item state read through the adapter counts in context().reads. Callbacks the
 * modules register on the api are kept by name; context().fire(name, ...args) calls them.
 */
const ROOT_PARTS = ['..', '..', '..', '..', '..'];

/* Modules the page loads after install(), in this order. Paths from the repository root. */
const SCRIPTS = [
    'apps/common/main/lib/view/compact/AdapterKit.js',
    'apps/documenteditor/main/app/view/DocumentActions.js',
    'apps/documenteditor/main/app/view/CompactMenuAdapter.js'
];

/* Stock shortcuts of the commands the menu shows, as the registry gives their keys. */
const SHORTCUTS = {
    Save: ['Ctrl', 'S'], PrintPreviewAndPrint: ['Ctrl', 'P'], EditUndo: ['Ctrl', 'Z'], EditRedo: ['Ctrl', 'Y'],
    EditSelectAll: ['Ctrl', 'A'], OpenFindDialog: ['Ctrl', 'F'], InsertHyperlink: ['Ctrl', 'K']
};

/* Values engine calls return; any other api method records the call and returns nothing. */
const RETURNS = {
    get_ShowParaMarks: w => !!w.marks,
    get_ShowTableEmptyLine: w => !!w.tableGrid,
    getCurrentPage: () => 0,
    asc_GetViewRulers: w => !!w.rulers,
    GetMultipageViewMode: w => !!w.multipage,
    asc_getCanUndo: w => w.undo !== false,
    asc_getCanRedo: w => w.redo !== false,
    can_CopyCut: w => w.selection !== false,
    asc_GetLocalTrackRevisions: w => (w.track ? true : false),
    asc_GetGlobalTrackRevisions: () => false,
    asc_HaveRevisionsChanges: w => !!w.changes,
    asc_GetRevisionsChangesStack: w => (w.atChange ? [{}] : []),
    asc_getDocumentProtection: w => docProtect(w),
    asc_IsContentControl: w => !!w.control,
    asc_GetContentControlProperties: w => {
        if (!w.control) return null;
        const lock = w.control.lock || 'Unlocked', type = w.control.type || 'None';
        return {get_Lock: () => SDT_LOCK[lock], get_SpecificType: () => SDT_TYPE[type]};
    },
    asc_GetDisplayModeInReview: w => {
        const reasons = w.reasons || [];
        if (w.display === 'original' || reasons.includes('original')) return 2;
        if (w.display === 'final' || reasons.includes('final')) return 1;
        return 0;
    }
};

/* Lock and kind of a content control as the engine gives them (sdkjs common/commonDefines.js). */
const SDT_LOCK = {ContentLocked: 0, SdtContentLocked: 1, SdtLocked: 2, Unlocked: 3};
const SDT_TYPE = {None: 0, CheckBox: 1, Picture: 2, ComboBox: 3, DropDownList: 4, DateTime: 5};

/* Stock lock stack entries behind each common reason. A lost connection (Main.disableEditing) and
   own view (Main.onDocModeApply) take the left menu away. */
const LEFT_MENU_OFF = {disable: true, previewMode: true};
const STACK = {
    offline: [{type: 'reconnect', options: {viewMode: true, leftMenu: LEFT_MENU_OFF}}],
    limit: [{type: 'disconnect', options: {viewMode: true, leftMenu: LEFT_MENU_OFF}}],
    view: [{type: 'view', options: {viewDocMode: true, leftMenu: LEFT_MENU_OFF}}],
    final: [{type: 'review', options: {reviewMode: true}}],
    original: [{type: 'review', options: {reviewMode: true}}],
    form: [{type: 'forms', options: {fillFormMode: true}}]
};

/* Protection of the document as the engine gives it (sdkjs word/Editor/DocumentProtection.js): the edit
   type and the password flag; what the caller sets is kept on the object. */
const PROTECT_TYPES = {isCommentsOnly: 0, isFormsOnly: 1, isReadOnly: 3, isReviewOnly: 4};
function docProtect(w) {
    const p = w.protectionProps();
    const name = p && Object.keys(PROTECT_TYPES).find(k => p[k]);
    if (!name) return null;
    const props = {edit: PROTECT_TYPES[name], password: null};
    return Object.assign(props, {
        asc_getEditType: () => props.edit,
        asc_getIsPassword: () => !!p.password,
        asc_setEditType: v => { props.edit = v; },
        asc_setPassword: v => { props.password = v; }
    });
}

const DEFAULTS = {
    reasons: [], rights: 'edit', stack: [], license: null, disconnected: false, protection: null, display: null,
    download: true, print: true, rename: true, share: true, history: true, review: true, coauth: true,
    comments: true, requestEdit: false, track: false, compare: true, changes: false, atChange: false,
    commentsOpen: false, undo: true, redo: true, selection: true, rulers: false,
    marks: false, tableGrid: false, multipage: false, zoom: null, outline: false, toolbarHidden: false,
    focusMode: false, modal: false, control: null, missing: []
};

function install(G) {
    const handlers = G.__handlers = {};
    const world = () => G.__world;
    const record = entry => { const w = world(); if (w) w.log.push(entry); };
    G.window = G.window || G;
    G._ = G._ || {extend: Object.assign};
    G.Common = G.Common || {};
    Object.assign(G.Common, {
        NotificationCenter: {
            on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
            trigger(name, ...args) {
                record({event: name, args});
                (handlers[name] || []).slice().forEach(fn => fn(...args));
            }
        },
        Locale: {getCurrentLanguage: () => 'en'},
        Utils: {InternalSettings: {set() {}, get() {}}, ModalWindow: {isVisible: () => !!(world() && world().modal)}},
        localStorage: {setBool() {}, getBool: () => false, setItem() {}, getItem: () => null, itemExists: () => false}
    });
    G.Asc = Object.assign(G.Asc || {}, {
        c_oLicenseResult: {Connections: 1, UsersCount: 2, ConnectionsOS: 3, UsersCountOS: 4, Success: 5},
        c_oAscDisplayModeInReview: {Edit: 0, Final: 1, Original: 2, Simple: 3},
        c_oAscEDocProtect: {Comments: 0, Forms: 1, None: 2, ReadOnly: 3, TrackedChanges: 4},
        c_oAscFileType: {DOCX: 65, PDF: 513, ODT: 67, RTF: 68, TXT: 69, HTML: 70, HTML_IN_CONTAINER: 82, EPUB: 72, MD: 92},
        c_oAscChartTypeSettings: {barNormal: 10},
        c_oAscSdtLockType: SDT_LOCK,
        c_oAscContentControlSpecificType: SDT_TYPE,
        c_oAscChangeTextCaseType: {SentenceCase: 0, LowerCase: 1, UpperCase: 2, CapitalizeWords: 3, ToggleCase: 4},
        /* Width kinds of a table made from text (sdkjs word/apiDefines.js). */
        c_oAscTextToTableAutoFitType: {Fixed: 1, Content: 2, Window: 3},
        asc_CDownloadOptions: function (type) { this.type = type; }
    });
    G.open = (...args) => { record({shell: 'open', args}); return null; };
    const controllers = {
        Main: () => world() && world().main,
        DocProtection: () => ({getDocProps: () => world() && world().protectionProps()}),
        LeftMenu: () => {
            const held = !!(world() && world().leftMenuHeld());
            const rights = held ? world().editRights() : {};
            return {
                clickMenuFileItem: (menu, name) => record({shell: 'fileItem', args: [name]}),
                onFindReplace: () => record({shell: 'find'}),
                /* LeftMenu.SetDisabled: the panel is off, the options before it are kept here. */
                leftMenu: {_state: {disabled: held}},
                previsEdit: rights.isEdit,
                prevcanEdit: rights.canEdit
            };
        },
        /* ReviewChanges and Comments in their preview mode: the right is out of the options, the
           value before it is kept here. */
        'Common.Controllers.ReviewChanges': () => {
            const w = world();
            return w ? {viewmode: w.reviewHeld(), prevcanReview: w.review} : null;
        },
        'Common.Controllers.Comments': () => {
            const w = world();
            return w ? {viewmode: w.commentsHeld(), prevcanComments: w.comments} : null;
        },
        'Common.Controllers.Shortcuts': () => ({
            getShortcutsByActionType: sc => (SHORTCUTS[sc] ? [{keys: SHORTCUTS[sc]}] : null)
        })
    };
    G.DE = G.DE || {};
    G.DE.Views = G.DE.Views || {};
    G.DE.Controllers = G.DE.Controllers || {};
    G.DE.getController = name => (controllers[name] ? controllers[name]() : null);
    /* The shared About window: the catalogue builds it itself. */
    G.Common.UI = G.Common.UI || {};
    G.Common.UI.Compact = G.Common.UI.Compact || {};
    G.Common.UI.Compact.AboutWindow = function () { this.show = () => record({shell: 'about'}); };
    G.window.DE = G.DE;
}

/* In Node: a vm context with the stock stand-ins and the modules, made once. */
let nodeGlobal = null;
function host() {
    if (typeof window !== 'undefined' && window.DE && window.DE.Views && window.DE.Views.CompactMenuAdapter) return window;
    if (nodeGlobal) return nodeGlobal;
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const root = path.resolve(__dirname, ...ROOT_PARTS);
    const G = {console, setTimeout, clearTimeout};
    vm.createContext(G);
    G.define = (deps, factory) => factory.apply(null, deps.map(d => {
        const shared = G.Common && G.Common.UI && G.Common.UI.Compact;
        return shared ? shared[d.split('/').pop()] : undefined;
    }));
    install(G);
    for (const file of ['apps/common/main/lib/view/compact/MenuModel.js'].concat(SCRIPTS))
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), G, {filename: path.join(root, file)});
    nodeGlobal = G;
    return G;
}

function context(overrides) {
    const G = host();
    const w = Object.assign({}, DEFAULTS, {log: [], reads: 0, callbacks: {}}, overrides || {});
    const record = entry => w.log.push(entry);
    w.editRights = () => {
        const edit = w.rights === 'edit';
        return {isEdit: w.editMode !== undefined ? w.editMode : edit, canEdit: w.editRight !== undefined ? w.editRight : edit};
    };
    w.leftMenuHeld = () => entries().some(e => !!(e.options && e.options.leftMenu && e.options.leftMenu.disable));
    const protectedAs = names => { const p = w.protectionProps(); return !!p && names.some(n => !!p[n]); };
    w.reviewHeld = () => entries().length > 0 || protectedAs(['isReadOnly', 'isFormsOnly', 'isCommentsOnly']);
    w.commentsHeld = () => entries().length > 0 || protectedAs(['isReadOnly', 'isFormsOnly']);
    const options = () => {
        const rights = w.leftMenuHeld() ? {isEdit: false, canEdit: false} : w.editRights();
        return {
            isEdit: rights.isEdit,
            canEdit: rights.canEdit,
            canDownload: w.download, canPrint: w.print, canRename: w.rename,
            canRequestSharingSettings: w.share, canUseHistory: w.history, canReview: w.reviewHeld() ? false : w.review,
            isReviewOnly: false, canCoAuthoring: true, canChangeCoAuthoring: w.coauth, isOffline: false,
            canViewComments: w.comments, canComments: w.commentsHeld() ? false : w.comments, canRequestEditRights: w.requestEdit, lang: 'en',
            canFeatureComparison: w.compare, canRequestSelectDocument: w.compare
        };
    };
    const entries = () => (w.reasons || []).reduce((list, code) => list.concat(STACK[code] || []), [])
        .concat(w.stack || []).map(e => Object.assign({disable: true}, e));
    w.main = {
        get appOptions() { return options(); },
        stackDisableActions: {length: () => entries().length, get: i => entries()[i]},
        _state: {
            get licenseType() {
                const name = w.license || ((w.reasons || []).includes('limit') ? 'Connections' : null);
                return name ? G.Asc.c_oLicenseResult[name] : undefined;
            },
            get isDisconnected() { return !!(w.disconnected || (w.reasons || []).includes('limit')); }
        },
        requestPrint: () => record({api: 'requestPrint'})
    };
    w.protectionProps = () => w.protection || ((w.reasons || []).includes('protected') ? {isReadOnly: true} : null);
    w.api = new Proxy({}, {
        get(t, name) {
            if (typeof name !== 'string' || name === 'then' || (w.missing || []).includes(name)) return undefined;
            if (name === 'asc_registerCallback')
                return (event, fn) => { (w.callbacks[event] = w.callbacks[event] || []).push(fn); };
            return (...args) => {
                if (name !== 'asc_GetLocalTrackRevisions' && name !== 'asc_GetGlobalTrackRevisions' &&
                    name !== 'asc_GetDisplayModeInReview' && !/^get|^Get|^asc_Get|^asc_get|^asc_Have|^can_/.test(name))
                    record({api: name, args});
                if (w.engine && typeof w.engine[name] === 'function') return w.engine[name](...args);
                return RETURNS[name] ? RETURNS[name](w) : undefined;
            };
        }
    });
    const call = name => (...args) => { record({shell: name, args}); };
    w.shell = {
        get tbHidden() { return !!w.toolbarHidden; },
        get focus() { return !!w.focusMode; },
        get top() { return {hidden: !!w.focusMode, cause: w.focusMode ? 'manual' : null}; },
        topHidden: () => !!w.focusMode,
        stockLeftBtn: name => (name === 'navigation' ? {pressed: !!w.outline} :
            name === 'comments' ? {pressed: !!w.commentsOpen} : null),
        canUse: name => (name === 'comments' ? !!w.comments : name === 'navigation'),
        outlineRail: () => ({open: !!w.outline}), outlineOpen: () => !!w.outline, toggleOutline: call('toggleOutline'),
        /* As CompactShell.canAddComment: the comment right the options give now. */
        canAddComment: () => { const o = w.main.appOptions; return !!(o.canCoAuthoring && o.canComments); },
        toggleLeftPanel: call('toggleLeftPanel'), ensureLeftPanel: call('ensureLeftPanel'),
        toggleToolbar: call('toggleToolbar'), toggleFocus: call('toggleFocus'),
        tb: {insertLink: call('insertLink'), addComment: call('addComment')}
    };
    G.__world = w;
    G.DE.Views.DocumentActions.init(w.api, w.shell);
    w.real = G.DE.Views.CompactMenuAdapter.create(w.shell, w.api);
    /* The context the items read: the adapter's own, over this state. */
    Object.assign(w, w.real.context());
    /* Fires a notification of the stock editor, as Common.NotificationCenter.trigger. */
    w.trigger = (name, ...args) => G.Common.NotificationCenter.trigger(name, ...args);
    /* Fires an engine callback, as the api does for the modules that registered it. */
    w.fire = (name, ...args) => (w.callbacks[name] || []).slice().forEach(fn => fn(...args));
    if (w.zoom) w.fire('asc_onZoomChange', w.zoom.percent, w.zoom.type);
    return w;
}

function sections() {
    return host().DE.Views.DocumentActions.sections();
}

function reasonText(code) {
    const da = host().DE.Views.DocumentActions;
    const text = typeof code === 'string' && code ? da['textReason' + code[0].toUpperCase() + code.slice(1)] : null;
    return typeof text === 'string' ? text : null;
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
    order: ['file', 'edit', 'view', 'insert', 'format', 'collab', 'help'],
    first: {k: 'file', label: 'File', firstItem: 'file.save', lastItem: 'file.rename'},
    second: {label: 'Edit', firstLocked: {reasons: ['view']}},
    scanFrom: 700,
    submenu: {section: 'file', row: 'file.download', index: 2, plain: 'file.save',
        rows: ['file.download.docx', 'file.download.pdf', 'file.download.odt', 'file.download.rtf',
            'file.download.txt', 'file.download.md', 'file.download.epub', 'file.download.html']},
    check: {section: 'collab', row: 'collab.track', on: {track: true}, off: {track: false}},
    radio: {section: 'view', submenu: 'view.zoom', context: {zoom: {percent: 75, type: 0}},
        rows: ['view.zoom.50', 'view.zoom.75'], checked: 'view.zoom.75', header: null},
    widget: null,
    locked: {context: {reasons: ['view']}, section: 'edit', row: 'edit.undo', title: 'The document is open for viewing'},
    greyLater: {section: 'edit', row: 'edit.redo', lock: {reasons: ['offline']}, title: 'No connection'},
    subLock: {section: 'file', row: 'file.download', item: 'file.download.docx', before: {}, after: {reasons: ['offline']},
        title: 'No connection'},
    reasons: {net: {section: 'file', row: 'file.print'}, edit: {section: 'edit', row: 'edit.undo'},
        context: {}, own: null},
    /* The review shown is a reason the documents adapter declares and ranks above the protection. */
    ownReason: {section: 'edit', row: 'edit.undo', context: {reasons: ['final', 'protected']}, code: 'final',
        title: 'Showing the final version'},
    shortcut: {section: 'file', row: 'file.save', text: 'Ctrl+S', mac: '⌘S', plain: 'file.rename'},
    tail: {k: 'format', index: 4, label: 'Format', click: 'format.hyphenation',
        rows: ['format.text', 'format.case', 'format.style', 'format.align', 'format.spacing', 'format.lists',
            'format.table', 'format.image', 'format.orientation', 'format.pageSize', 'format.margins', 'format.columns',
            'format.watermark', 'format.hyphenation', 'format.direction', 'format.clear']},
    about: 'help.about',
    viewer: {tops: ['file', 'edit', 'view', 'collab'], editOnly: 'insert', editTops: ['file', 'edit', 'view', 'insert', 'format', 'collab']},
    refresh: {index: 5, label: 'Collaboration', nextFirst: 'help.help', lockLabel: 'Format', lockRow: 'format.watermark',
        lock: {reasons: ['offline']}, unlock: {reasons: []}},
    hide: {section: 'collab', index: 5, middle: 'collab.history', middleOff: {history: false}, next: 'collab.compare',
        last: 'collab.coedit', lastOff: {coauth: false},
        lastGone: ['collab.coedit'], prev: 'collab.compare', restore: {history: true, coauth: true},
        rows: ['collab.track', 'collab.trackAll', 'collab.show', 'collab.changes', 'collab.comments', 'collab.share', 'collab.history',
            'collab.compare', 'collab.coedit']},
    emptied: {index: 3, label: 'Insert', focus: 'view'},
    anySection: 'file',
    /* A stock window over the editor; a visible loading mask (.asc-loadmask) covers it as well. */
    modal: {on: {modal: true}, off: {modal: false}, mask: true}
};

module.exports = {
    name: 'documenteditor',
    /* The global the modules run in (Node: the vm context; page: window), to load more modules into it. */
    host,
    pinned: 'help',
    scripts: SCRIPTS,
    install,
    context,
    sections,
    reasonText,
    adapter,
    roles
};
