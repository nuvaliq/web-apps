/* PDF editor behind the shared compact menu contract, for the shared layer tests.
 * The catalog (PdfActions.js), the bridge to the stock controls (StockBridge.js), the adapter
 * (CompactMenuAdapter.js) and the shared adapter kit it reads the stock parts with (AdapterKit.js)
 * are the real ones; around them stands a small stock editor: Main with its options and stack of
 * editing locks, the stock controls the catalog items are twins of (the toolbar and the left menu)
 * with their disabled and pressed state, the bookmarks of the navigation panel, the search bar of
 * the viewport, the stock shortcut registry, an api that records every call and a shell that
 * records what it is asked to do.
 * The same file runs in Node (it loads the modules into a vm context itself) and in the menu
 * bar test page, where lib/menu-bar-page.cjs calls install(window) and loads `scripts` after it.
 *
 * context(overrides) gives the editor state the stock parts read at every call:
 *  - reasons  — common reasons in force. The viewer edits nothing, so of the common reasons it
 *               meets only 'offline' (a lost connection: the 'reconnect' entry of the stock lock
 *               stack with the options Main.disableEditing gives it); other codes have no stock
 *               cause in the viewer and change nothing;
 *  - download, print, rename, history, comments — rights behind the items;
 *  - selection — there is text to copy (the stock copy lock);
 *  - page, pages — the current page and the page count (the first and last page locks);
 *  - bookmarks — number of bookmarks of the document (what the stock navigation keeps);
 *  - notes    — number of comments of the PDF in the stock comments collection (Comments is
 *               there only with some);
 *  - thumbnails, outline, commentsOpen — the panels of the stock left menu are open;
 *  - zoom     — the percent the engine reports (asc_getZoom);
 *  - searchBar — the stock search bar is shown;
 *  - commands — commands the shell has an owner for (shell.command);
 *  - modal    — a stock window is open (Common.Utils.ModalWindow);
 *  - missing  — names of api methods the editor lacks.
 * Every command an item runs is recorded in context().log as {k, args}; every click of a stock
 * control as {stock: ref}; every call to the api, the shell and the notification center as
 * {api | shell | event}; every engine keys call as {keys}; every item state read through the
 * adapter counts in context().reads. Callbacks the modules register on the api are kept by name;
 * context().fire(name, ...args) calls them.
 */
const ROOT_PARTS = ['..', '..', '..', '..', '..'];

/* Modules the page loads after install(), in this order. Paths from the repository root. */
const SCRIPTS = [
    'apps/common/main/lib/view/compact/AdapterKit.js',
    'apps/pdfeditor/main/app/view/StockBridge.js',
    'apps/pdfeditor/main/app/view/PdfActions.js',
    'apps/pdfeditor/main/app/view/CompactMenuAdapter.js'
];

/* Stock shortcuts of the commands the menu shows, as the registry gives their keys. */
const SHORTCUTS = {
    PrintPreviewAndPrint: ['Ctrl', 'P'], Copy: ['Ctrl', 'C'], EditSelectAll: ['Ctrl', 'A'], OpenFindDialog: ['Ctrl', 'F']
};

/* Captions of the stock views the catalog takes its labels from (locale/en.json). */
const CAPTIONS = {
    FileMenu: {textDownload: 'Download', btnDownloadCaption: 'Download As', btnPrintCaption: 'Print',
        btnRenameCaption: 'Rename', btnHistoryCaption: 'Version History', btnHelpCaption: 'Help'},
    DocumentHolder: {textCopy: 'Copy', txtSelectAll: 'Select all'},
    ViewTab: {textZoom: 'Zoom', textFitToWidth: 'Fit To Width', textFitToPage: 'Fit To Page'},
    Statusbar: {tipZoomIn: 'Zoom in', tipZoomOut: 'Zoom out', goToPageText: 'Go to Page'},
    HyperlinkSettingsDialog: {txtFirst: 'First page', txtLast: 'Last page'},
    LeftMenu: {tipComments: 'Comments', tipAbout: 'About', tipPageThumbnails: 'Page Thumbnails', tipOutline: 'Headings'},
    Toolbar: {capBtnHand: 'Hand'}
};

/* Stock lock causes of the twins (view/Toolbar.js lock lists, controller/Toolbar.js): copy without
   text to copy (copyLock), the first and the last page at the edges of the document (firstPage,
   lastPage), printing without the right (cantPrint). */
const DISABLED = {
    'Toolbar:btnCopy': w => !w.selection,
    'Toolbar:btnFirstPage': w => w.page < 1,
    'Toolbar:btnLastPage': w => w.page >= w.pages - 1,
    'Toolbar:btnPrint': w => !w.print
};

/* Pressed twins and the state field behind each. */
const PRESSED = {
    'LeftMenu:btnThumbnails': w => !!w.thumbnails,
    'LeftMenu:btnNavigation': w => !!w.outline,
    'LeftMenu:btnComments': w => !!w.commentsOpen
};

/* The stock lock stack entry of a lost connection, as Main.disableEditing pushes it for 'reconnect':
   the left menu is taken away, its panels stay. */
const RECONNECT = {
    type: 'reconnect', disable: true,
    options: {viewMode: true, statusBar: true, rightMenu: {clear: false, disable: true}, leftMenu: {disable: true, previewMode: true},
        fileMenu: {protect: true, history: true}, navigation: {disable: false, previewMode: true}, thumbnails: {disable: false},
        comments: {disable: false, previewMode: true}, chat: true, review: true, viewport: true,
        documentHolder: {clear: false, disable: true}, toolbar: true, plugins: false, header: {docmode: true, search: false}}
};

/* Values engine calls return; any other api method records the call and returns nothing. */
const RETURNS = {
    asc_getZoom: w => w.zoom / 100
};

const DEFAULTS = {
    reasons: [], download: true, print: true, rename: true, history: true, comments: true, selection: true,
    page: 0, pages: 3, bookmarks: 2, notes: 1, thumbnails: false, outline: false, commentsOpen: false,
    zoom: 100, searchBar: false,
    commands: ['rename', 'goToPage', 'leftPanel'], modal: false, missing: []
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
                record({event: name, args});
                (handlers[name] || []).slice().forEach(fn => fn(...args));
            }
        },
        Utils: {ModalWindow: {isVisible: () => !!(world() && world().modal)}}
    });
    /* The stock shortcuts window: the catalogue builds it itself once the deferred scripts are in. */
    G.Common.Views = G.Common.Views || {};
    function ShortcutsDialog() {}
    ShortcutsDialog.prototype.txtTitle = 'Keyboard Shortcuts';
    ShortcutsDialog.prototype.show = () => record({shell: 'shortcuts'});
    G.Common.Views.ShortcutsDialog = ShortcutsDialog;
    /* The shared About and document info windows: the catalogue builds them itself. */
    G.Common.UI = G.Common.UI || {};
    G.Common.UI.Compact = G.Common.UI.Compact || {};
    G.Common.UI.Compact.AboutWindow = function (options) {
        this.show = () => record({shell: 'about', args: [options && options.title]});
    };
    G.Common.UI.Compact.DocInfoWindow = {open: options => { record({shell: 'docInfo', args: [options.title]}); return {}; }};
    G.Asc = Object.assign(G.Asc || {}, {
        c_oLicenseResult: {Connections: 1, UsersCount: 2, ConnectionsOS: 3, UsersCountOS: 4, Success: 5},
        c_oAscFileType: {PDF: 513, DOCX: 65, JPG: 1025, PNG: 1029}
    });

    /* Stock controls by address (StockBridge.ROOTS form, 'Root:path'), made once: the same
       object at every read, its state read from the editor state at every call. */
    const made = {};
    const disabledOf = ref => !!(DISABLED[ref] && world() && DISABLED[ref](world()));
    const control = ref => {
        if (made[ref]) return made[ref];
        return (made[ref] = {
            visible: true, hidden: false, rendered: true, options: {lock: []},
            get disabled() { return disabledOf(ref); },
            get pressed() { return !!(PRESSED[ref] && world() && PRESSED[ref](world())); },
            isDisabled() { return disabledOf(ref); },
            setDisabled() {},
            on() {}, off() {},
            click() { if (!disabledOf(ref)) record({stock: ref}); }
        });
    };
    /* A root of stock controls where any btn… exists, with own fields. */
    const root = (name, own = {}) => new Proxy(own, {
        get(t, k) {
            if (typeof k !== 'string' || k in t) return t[k];
            return /^btn/.test(k) ? control(name + ':' + k) : undefined;
        }
    });
    const toolbar = root('Toolbar');
    /* The «File» screen with its panels built (FileMenu.render has run). */
    const fileMenu = {rendered: true, mode: {}, panels: {info: {$el: [{}]}, saveas: {$el: [{}]}}};
    const leftView = root('LeftMenu', {
        menuFile: fileMenu,
        getMenu: name => (name === 'file' ? fileMenu : null),
        showMenu: (...args) => record({shell: 'showMenu', args})
    });
    const controllers = {
        Main: () => world() && world().main,
        Toolbar: () => ({toolbar}),
        LeftMenu: () => ({
            leftMenu: leftView,
            clickSaveAsFormat: (menu, type) => record({shell: 'saveAs', args: [type]})
        }),
        /* Bookmarks the stock asc_onViewerBookmarksUpdate handler keeps (null without bookmarks). */
        Navigation: () => {
            const w = world(), count = w ? w.bookmarks : 0;
            return {_viewerNavigationObject: count ? Array.from({length: count}, (x, i) => ({name: 'Bookmark ' + (i + 1)})) : null};
        },
        Viewport: () => ({
            isSearchBarVisible: () => !!(world() && world().searchBar),
            searchBar: {hide: () => record({shell: 'hideSearchBar'})}
        }),
        'Common.Controllers.Shortcuts': () => ({
            getShortcutsByActionType: sc => (SHORTCUTS[sc] ? [{keys: SHORTCUTS[sc]}] : null)
        })
    };
    G.PDFE = G.PDFE || {};
    G.PDFE.Views = G.PDFE.Views || {};
    for (const name of Object.keys(CAPTIONS)) G.PDFE.Views[name] = {prototype: Object.assign({}, CAPTIONS[name])};
    G.PDFE.Views.FileMenuPanels = {DocumentInfo: {prototype: {txtDocumentInfo: 'Document Info'}}};
    G.PDFE.getController = name => (controllers[name] ? controllers[name]() : null);
    /* The stock comments collection: as many comments as the state has. */
    G.PDFE.getCollection = name => {
        if (name !== 'Common.Collections.Comments') return null;
        const n = world() ? world().notes : 0;
        return {length: n, some: fn => Array.from({length: n}, () => ({get: () => false})).some(fn)};
    };
    G.window.PDFE = G.PDFE;
    /* Modules of the PDF editor take their PDF dependencies by name from PDFE.Views, the shared
       ones from Common.UI.Compact. */
    G.define = (deps, factory) => factory.apply(null, deps.map(d => {
        const name = d.split('/').pop();
        if (/^pdfeditor\//.test(d)) return G.PDFE.Views[name];
        const shared = G.Common && G.Common.UI && G.Common.UI.Compact;
        return shared ? shared[name] : undefined;
    }));
}

/* In Node: a vm context with the stock stand-ins and the modules, made once. */
let nodeGlobal = null;
function host() {
    if (typeof window !== 'undefined' && window.PDFE && window.PDFE.Views && window.PDFE.Views.CompactMenuAdapter) return window;
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
    const w = Object.assign({}, DEFAULTS, {log: [], reads: 0, callbacks: {}}, overrides || {});
    const record = entry => w.log.push(entry);
    const entries = () => ((w.reasons || []).includes('offline') ? [RECONNECT] : []);
    /* The options of Main the catalog reads. */
    const options = {};
    const option = (name, read) => Object.defineProperty(options, name, {get: read, enumerable: true});
    option('canDownload', () => !!w.download);
    option('canPrint', () => !!w.print);
    option('canRename', () => !!w.rename);
    option('canUseHistory', () => !!w.history);
    option('canViewComments', () => !!w.comments);
    Object.assign(options, {isEdit: false, canEdit: false, canUseThumbnails: true, canHelp: true, isDesktopApp: false,
        isLightVersion: false, isOffline: false, lang: 'en'});
    w.main = {
        appOptions: options,
        stackDisableActions: {length: () => entries().length, get: i => entries()[i]},
        _state: {isDisconnected: false}
    };
    w.api = new Proxy({}, {
        get(t, name) {
            if (typeof name !== 'string' || name === 'then' || (w.missing || []).includes(name)) return undefined;
            if (name === 'asc_registerCallback')
                return (event, fn) => { (w.callbacks[event] = w.callbacks[event] || []).push(fn); };
            if (name === 'asc_unregisterCallback') return () => {};
            return (...args) => {
                if (RETURNS[name]) return RETURNS[name](w);
                record({api: name, args});
                return undefined;
            };
        }
    });
    /* The shell the catalog asks: its command registry (an item of a command without an owner is
       greyed) and the layout of its bar. */
    const owned = name => (w.commands || []).includes(name);
    w.shell = {
        command: name => (...args) => { if (owned(name)) record({shell: name, args}); },
        hasCommand: owned,
        layout: 'bar'
    };
    G.__world = w;
    w.real = G.PDFE.Views.CompactMenuAdapter.create(w.shell, w.api);
    /* The context the items read: the adapter's own, over this state. */
    Object.assign(w, w.real.context());
    /* Fires an engine callback, as the api does for the modules that registered it. */
    w.fire = (name, ...args) => (w.callbacks[name] || []).slice().forEach(fn => fn(...args));
    return w;
}

/* Sections in the shape of the shared model: the adapter sections with their items. */
function sections(ctx) {
    const real = (ctx || context()).real;
    return real.sections().map(s => ({k: s.k, t: s.t, items: real.groups(s.k)}));
}

/* The PDF editor declares no reason of its own: the texts of the common codes are the menu bar's. */
function reasonText() {
    return null;
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

/* The viewer shows the shared menu bar as one pinned section, the ⋮ button at the end of its bar:
   the checks of a row of sections (lib/editors.cjs, menuRow: false) do not run with it. */
const roles = {
    order: ['more']
};

module.exports = {
    name: 'pdfeditor',
    /* The global the modules run in (Node: the vm context; page: window), to load more modules into it. */
    host,
    pinned: 'more',
    depth: 1,
    scripts: SCRIPTS,
    install,
    context,
    sections,
    reasonText,
    adapter,
    roles
};
