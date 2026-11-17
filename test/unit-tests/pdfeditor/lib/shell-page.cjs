/* Browser page of the compact shell of the PDF viewer, shared by the checks of this folder.
 * Running it directly does nothing and exits with code 0.
 *
 * Headless Chrome through Playwright (PLAYWRIGHT_MODULE or NODE_PATH; CHROMIUM_PATH optional).
 * The page is served at a stand address (BASE), so the shared AIR icons resolve against the
 * document as they do in the editor; files under /web-apps/ come from this tree.
 *
 * Styles: the shared compact layer (tokens, menu, about), compact-shell.less and compact-windows.less
 * of the viewer, in the order app.less imports them, compiled in the page by vendor/less once per
 * run. The page compiles one text, so the files a style file imports (the shared window template,
 * the set for the stock windows and the Document Info window of compact-windows.less) are put in
 * place of their @import lines.
 *
 * Loaded as they are: jQuery, underscore, Backbone, the stock NotificationCenter, the English
 * locale (en.json, applied the stock way before the views load), the shared compact modules,
 * the shell modules of the viewer and the shell wiring of controller/Viewport.js, taken from its
 * source (Gateway init → announce, app:ready → start or endBoot).
 *
 * Around them stand stand-ins of the stock editor: the controllers Main, Viewport, LeftMenu,
 * Toolbar, Navigation and Print; the stock "File" screen (FileMenu: shown, hidden, its events on the
 * view and on the event bus by its name) with its panels of print, advanced settings and Download
 * as — their markup is the stock template, taken from FileMenuPanels.js; the stock showMenu of the
 * left menu and the stock ways into the "File" screen (file:print, the engine Ctrl+P through
 * asc_onPrint, F1, Alt+F, Ctrl+Shift+S); the stock buttons the shell bridges to (with the click, toggle, toggle
 * group and disabled semantics of Common.UI.Button); the comments collection; the engine api
 * with its viewer (the canvas of the pages in #editor_sdk, painted by asc_setSkin, and the page
 * geometry of getDocumentRenderer); the theme (its variables on body through the body class, as
 * the stock :root .theme-… rules put them, and Common.UI.Themes.getThemeColors reading them there);
 * Gateway (with the internalcommand of the integration); the stock window
 * (Common.UI.Window: its footer buttons, Enter for the primary one, Escape); the stock layout (VBoxLayout.doLayout writes the item heights) and the stock
 * mode switch (pdf:mode-apply → pdf:mode-changed, as Main.onPdfModeApply does); the loading skeleton
 * (#loading-mask, outside #viewport), which the stock start removes by its id on app:face.
 *
 * In the page: stock — the stand-ins, their log (stock.log), the notifications sent
 * (stock.events) and the skins the engine got (stock.skins); shell — PDFE.Views.CompactShell.
 *
 * Module copies for a negative control: any command-line argument ending in .js replaces the module
 * of the same file name (CompactShell.js, PdfActions.js, CompactMenuAdapter.js, MenuBar.js…); one
 * ending in .less replaces the style file of the same name (compact-shell.less, tokens.less…).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const BASE = 'http://stand.test/web-apps/apps/pdfeditor/main/index.html';
const COMPACT = path.join(ROOT, 'apps/common/main/lib/view/compact');
const VIEW = path.join(ROOT, 'apps/pdfeditor/main/app/view');
const VIEWPORT = path.join(ROOT, 'apps/pdfeditor/main/app/controller/Viewport.js');
const LOCALE = path.join(ROOT, 'apps/pdfeditor/main/locale/en.json');
const LESS_JS = path.join(ROOT, 'vendor/less/dist/less.js');
const LESS = ['tokens', 'menu', 'about'].map(n => path.join(ROOT, 'apps/common/main/resources/less/compact', n + '.less'))
    .concat(['compact-shell', 'compact-windows'].map(n => path.join(ROOT, 'apps/pdfeditor/main/resources/less', n + '.less')));

/* Shared modules in load order (a module after the ones it takes as an AMD dependency). */
const SHARED = ['Icons', 'Shells', 'MenuModel', 'AdapterKit', 'MenuBar', 'DocInfoWindow', 'Windows', 'AboutWindow'];
/* Shell modules of the viewer in load order. */
const SHELL = ['StockBridge', 'FileWindows', 'CompactWindows', 'PdfActions', 'CompactMenuAdapter', 'NavigationPanel', 'CompactToolbar', 'CompactShell'];
const PANELS = path.join(ROOT, 'apps/pdfeditor/main/app/view/FileMenuPanels.js');

/* Copies of modules named on the command line: file name → path. A module by its name without .js,
   a style file by its full file name. */
function overrides(argv) {
    const out = {};
    (argv || process.argv.slice(2)).filter(a => /\.(js|less)$/.test(a)).forEach(a => {
        out[/\.less$/.test(a) ? path.basename(a) : path.basename(a, '.js')] = path.resolve(a);
    });
    return out;
}
const OVERRIDES = overrides();

function styleFile(file) {
    return OVERRIDES[path.basename(file)] || file;
}

/* A style file with the files it imports put in place of their @import lines (paths from the file
   itself, as LESS resolves them; a copy named on the command line replaces a file of its name). */
function styleText(file) {
    return fs.readFileSync(styleFile(file), 'utf8').replace(/^@import\s+"([^"]+)";[ \t]*$/gm,
        (line, rel) => styleText(path.resolve(path.dirname(file), rel)));
}

function moduleFile(name) {
    if (OVERRIDES[name]) return OVERRIDES[name];
    return SHARED.includes(name) ? path.join(COMPACT, name + '.js') : path.join(VIEW, name + '.js');
}

/* The shell wiring of the stock viewport controller, as it stands in its source. */
function viewportWiring() {
    const src = fs.readFileSync(OVERRIDES.Viewport || VIEWPORT, 'utf8');
    const m = /var shell = PDFE\.Views\.CompactShell;[\s\S]*?Common\.NotificationCenter\.on\('app:ready'[\s\S]*?\}\)\);/.exec(src);
    if (!m) throw new Error('controller/Viewport.js: the shell wiring (Gateway init and app:ready) is not found');
    return m[0];
}

/* Markup templates of the stock panels of the "File" screen, as FileMenuPanels.js has them: the
   array of strings of `template: _.template([…].join(''))` after the view declaration. */
function stockTemplates() {
    const vm = require('node:vm');
    const src = fs.readFileSync(PANELS, 'utf8');
    const take = decl => {
        const at = src.indexOf(decl);
        if (at < 0) throw new Error('FileMenuPanels.js: ' + decl + ' is not found');
        const from = src.indexOf('template: _.template([', at) + 'template: _.template('.length;
        const to = src.indexOf("].join(''))", from);
        return vm.runInNewContext(src.slice(from, to + 1)).join('');
    };
    return {
        print: take('PDFE.Views.PrintWithPreview = '),
        settings: take('PDFE.Views.FileMenuPanels.Settings = '),
        saveas: take('PDFE.Views.FileMenuPanels.ViewSaveAs = ')
    };
}

function launch() {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    return chromium.launch(process.env.CHROMIUM_PATH ?
        {headless: true, executablePath: process.env.CHROMIUM_PATH} : {headless: true, channel: 'chrome'});
}

/* --- Styles ------------------------------------------------------------------------------ */

let compiled = null;

/* The stock path to the shared images (@common-image-const-path), as variables.less gives it
   before app.less imports the compact layer. */
function stockImagePath() {
    const text = fs.readFileSync(path.join(ROOT, 'apps/common/main/resources/less/variables.less'), 'utf8');
    const m = /^@common-image-const-path:[^;\n]*;/m.exec(text);
    if (!m) throw new Error('variables.less: @common-image-const-path not found');
    return m[0];
}

async function styles(browser) {
    if (compiled) return compiled;
    const page = await browser.newPage();
    try {
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({path: LESS_JS});
        const source = stockImagePath() + '\n' + LESS.map(styleText).join('\n');
        const out = await page.evaluate(async src => {
            try { return {css: (await less.render(src)).css}; } catch (e) { return {error: e.message + ' (line ' + e.line + ')'}; }
        }, source);
        if (out.error) throw new Error('compact styles do not compile: ' + out.error);
        compiled = out.css;
        return compiled;
    } finally {
        await page.close();
    }
}

/* The stand: stock rows of the viewer (title, toolbar with the ribbon and the header right group,
   the middle area with the left menu and the document, the status bar) and the hidden panels of
   the stock "File" screen. */
const STAND_CSS = `
html, body {margin: 0; height: 100%; font: 13px sans-serif}
#viewport {position: relative; height: 100%}
#toolbar, #statusbar {position: relative; overflow: hidden}
.stock-ribbon {height: 88px; background: #f1f1f1}
.stock-status {height: 25px; background: #e8e8e8}
#middle {display: flex; height: 400px}
#left-menu {width: 40px; display: flex}
#left-menu .left-panel {padding-left: 40px}
#editor-container {flex: 1 1 auto; position: relative; background-color: var(--canvas-background)}
#editor_sdk {position: absolute; inset: 0}
#stand-viewer {position: absolute; inset: 0; width: 100%; height: 100%}
:root .theme-stand {--canvas-background: #f3f3f3}
#area_id {position: absolute; left: 100px; top: 100px; width: 40px; height: 20px}
#file-panels {display: none}
.combobox {display: block}
#stock-search {display: none}
`;

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>PDF viewer stand</title></head><body class="theme-stand">
<div id="viewport">
  <section id="app-title">Stock title</section>
  <div id="toolbar"><section class="stock-ribbon" id="stock-ribbon">Stock ribbon<div id="box-right-btn-group"></div></section></div>
  <div id="middle"><div id="left-menu"><div class="tool-menu-btns" id="left-rail"></div><div class="left-panel" id="left-panel"><div id="left-panel-thumbnails" style="height: 100%"><div id="thumbnails-header">Page thumbnails</div><div class="stock-list">thumbnails</div></div><div id="left-panel-navigation" style="height: 100%"><div id="navigation-header">Headings</div><div class="stock-list">bookmarks</div></div></div></div><div id="editor-container"><div id="editor_sdk"><canvas id="stand-viewer"></canvas><textarea id="area_id"></textarea></div></div></div>
  <div id="statusbar"><div class="stock-status" id="stock-status">Page 1 of 3</div></div>
</div>
<div id="loading-mask" class="loadmask"><div class="sk-stand"></div></div>
<div id="stock-search"><input id="stock-search-field"></div>
<div id="file-panels"><div id="panel-info" class="stock-info"><table><tr><td class="header">Document Info</td></tr>
  <tr><td>Title</td><td><input id="info-title" value="Report"></td></tr></table></div>
  <div id="panel-saveas" class="content-box"></div><div id="panel-settings" class="content-box"></div><div id="panel-print" class="content-box"></div></div>
</body></html>`;

/* --- Stock stand-ins (run in the page) ------------------------------------------------------ */

function installStock(o) {
    var log = [], events = [];
    function note(who, what, args) { log.push({who: who, what: what, args: Array.prototype.slice.call(args || [])}); }

    var nc = Common.NotificationCenter;
    var trigger = nc.trigger;
    nc.trigger = function (name) {
        events.push({name: name, args: Array.prototype.slice.call(arguments, 1)});
        return trigger.apply(this, arguments);
    };

    /* Gateway: jQuery events, the handler gets the message data (Gateway.js). */
    var $gw = $({});
    Common.Gateway = {
        on: function (event, handler) { $gw.on(event, function (e, data) { handler.call(Common.Gateway, data); }); },
        fire: function (event, data) { $gw.trigger(event, [data]); },
        requestRename: function (name) { note('gateway', 'requestRename', [name]); }
    };

    /* Engine api. */
    var callbacks = {}, skins = [];
    var api = {
        asc_registerCallback: function (name, fn) { (callbacks[name] = callbacks[name] || []).push(fn); },
        Resize: function () { note('api', 'Resize'); },
        zoom: function (p) { note('api', 'zoom', [p]); },
        zoomIn: function () { note('api', 'zoomIn'); },
        zoomOut: function () { note('api', 'zoomOut'); },
        zoomFitToWidth: function () { note('api', 'zoomFitToWidth'); },
        zoomFitToPage: function () { note('api', 'zoomFitToPage'); },
        asc_getZoom: function () { return o.zoom / 100; },
        asc_enableKeyEvents: function (on) { note('api', 'asc_enableKeyEvents', [on]); },
        asc_getDocumentName: function () { return main.document.title; },
        asc_setRestriction: function (r) { note('api', 'asc_setRestriction', [r]); },
        getCurrentPage: function () { return o.page; },
        getCountPages: function () { return o.pages; },
        goToPage: function (n) { note('api', 'goToPage', [n]); },
        asc_viewerNavigateTo: function (i) { note('api', 'asc_viewerNavigateTo', [i]); },
        /* CViewer.updateSkin: the canvas of the pages takes the background of the skin. The skins
           sent are kept apart from the log (stock.skins): the shell sends one more after a pause. */
        asc_setSkin: function (skin) {
            skins.push(skin);
            document.getElementById('stand-viewer').style.backgroundColor = skin['canvas-background'];
        },
        /* CViewer: width — the area of the pages (the width of its parent, #editor_sdk, unless
           given), documentWidth — the widest page, CSS pixels; the pages stand at the centre of the
           area, which starts at the canvas. */
        getDocumentRenderer: function () { return o.renderer; }
    };
    if (o.renderer) {
        var viewer = document.getElementById('stand-viewer');
        o.renderer.canvas = viewer;
        if (!('width' in o.renderer)) {
            Object.defineProperty(o.renderer, 'width', {enumerable: true, get: function () {
                return document.getElementById('editor_sdk').offsetWidth;
            }});
        }
    }
    /* The stock theme: its colours read from the variables on body (Themes.getThemeColors, a few
       of them); available() false keeps the stock theme handler out of the layout. */
    Common.UI = Common.UI || {};
    Common.UI.Themes = {
        available: function () { return false; },
        getThemeColors: function () {
            var style = getComputedStyle(document.body), out = {type: 'light', name: 'theme-stand'};
            ['canvas-background', 'canvas-page-border', 'canvas-scroll-thumb'].forEach(function (k) {
                out[k] = style.getPropertyValue('--' + k).trim();
            });
            return out;
        }
    };
    /* The stock start (Themes.init): the engine takes the colours of the theme. */
    api.asc_setSkin(Common.UI.Themes.getThemeColors());
    /* CFile of the viewer: a page drawn into a new canvas of the asked size (white, the page number
       written in), page sizes in points (US Letter). A page listed in o.unloaded is not loaded yet:
       getPage gives null, as the engine does. onRepaintPages is the handler the stock viewer puts
       on the file when it is ready (CViewer.onDocumentReady) and the engine calls with the pages
       it repaints after their fonts load. The log names the file by `who`: a file that replaces
       it (the engine opens the document again) is made by stock.newFile(who). */
    function standFile(who) {
        return {
            onRepaintPages: function (pages) { note(who, 'onRepaintPages', [pages]); },
            getPage: function (i, w, h, noCache, bg) {
                note(who, 'getPage', [i, w, h, noCache, bg]);
                if ((o.unloaded || []).indexOf(i) >= 0) return null;
                var c = document.createElement('canvas');
                c.width = w;
                c.height = h;
                var x = c.getContext('2d');
                x.fillStyle = '#ffffff';
                x.fillRect(0, 0, w, h);
                x.fillStyle = '#000000';
                x.fillText(String(i + 1), 2, 12);
                return c;
            },
            getPageWidth: function () { return 612; },
            getPageHeight: function () { return 792; }
        };
    }
    if (o.renderer && !o.renderer.file) o.renderer.file = standFile('file');

    /* A stock button: click, toggle, toggle group and disabled as Common.UI.Button does them (a
       pressed button of a group releases the others, Common.UI.ToggleManager). */
    var groups = {};
    function button(name, host, opts) {
        opts = opts || {};
        var node = document.createElement('button');
        node.type = 'button';
        node.id = 'stock-' + name;
        node.textContent = name;
        document.getElementById(host).appendChild(node);
        var b = _.extend({}, Backbone.Events, {
            name: name, cmpEl: $(node), el: node,
            enableToggle: !!opts.toggle, allowDepress: opts.allowDepress !== false,
            pressed: !!opts.pressed, disabled: false,
            isDisabled: function () { return this.disabled; },
            setDisabled: function (v) {
                v = !!v;
                if (v === this.disabled) return;
                this.disabled = v;
                node.classList.toggle('disabled', v);
                if (v) node.setAttribute('disabled', 'disabled'); else node.removeAttribute('disabled');
                this.trigger('disabled', this, v);
            },
            toggle: function (v, suppress) {
                var s = v === undefined ? !this.pressed : !!v, me = this;
                this.pressed = s;
                node.setAttribute('aria-pressed', String(s));
                node.classList.toggle('active', s);
                if (s && opts.group) (groups[opts.group] || []).forEach(function (o) { if (o !== me && o.pressed) o.toggle(false); });
                if (!suppress) this.trigger('toggle', this, s);
            },
            click: function () {
                if (this.disabled) return;
                if (this.enableToggle && (this.allowDepress || !this.pressed)) this.toggle();
                note('stock', 'click', [name]);
                this.trigger('click', this);
            }
        });
        node.setAttribute('aria-pressed', String(b.pressed));
        if (opts.disabled) b.setDisabled(true);
        if (opts.group) (groups[opts.group] = groups[opts.group] || []).push(b);
        return b;
    }

    var ribbon = 'stock-ribbon', left = 'left-rail';
    var toolbarView = {
        btnPrint: button('btnPrint', ribbon),
        btnCopy: button('btnCopy', ribbon),
        btnSelectAll: button('btnSelectAll', ribbon),
        btnFirstPage: button('btnFirstPage', ribbon),
        btnLastPage: button('btnLastPage', ribbon),
        btnPrevPage: button('btnPrevPage', ribbon, {disabled: true}),
        btnNextPage: button('btnNextPage', ribbon),
        btnSelectTool: button('btnSelectTool', ribbon, {toggle: true, allowDepress: false, pressed: true}),
        btnHandTool: button('btnHandTool', ribbon, {toggle: true, allowDepress: false})
    };
    /* The select and hand tools are one toggle group. */
    toolbarView.btnSelectTool.on('toggle', function (b, on) { if (on) toolbarView.btnHandTool.toggle(false, true); });
    toolbarView.btnHandTool.on('toggle', function (b, on) { if (on) toolbarView.btnSelectTool.toggle(false, true); });

    /* The stock "File" screen (FileMenu): shown — the box of its panels shown and the panel shown;
       its events go to the view (trigger with the arguments as one array) and to the event bus by the
       name of the view, which calls the controller listeners with the arguments spread
       (application.js, fireEvent). */
    var bus = {};
    var fileMenu = _.extend({}, Backbone.Events, {
        rendered: true, mode: {}, visible: false, panels: {},
        render: function () {},
        isVisible: function () { return this.visible; },
        fireEvent: function (name, args) {
            this.trigger(name, args);
            (bus[name] || []).forEach(function (fn) { fn.apply(null, args || []); });
        },
        show: function (panel) {
            this.visible = true;
            document.getElementById('file-panels').style.display = 'block';
            note('fileMenu', 'show', [panel || null]);
            var p = this.panels[panel || 'saveas'];
            if (p) p.show();
            this.fireEvent('menu:show', [this]);
        },
        hide: function () {
            this.visible = false;
            document.getElementById('file-panels').style.display = '';
            note('fileMenu', 'hide');
            this.fireEvent('menu:hide', [this]);
        }
    });
    /* A stock panel of the screen: the view with its node, hidden flag and screen (menu). */
    function filePanel(id, html, extra) {
        var $el = $('#' + id);
        if (html !== undefined) $el.html(html);
        return _.extend({$el: $el, el: $el[0], hidden: true, menu: fileMenu,
            show: function () { this.hidden = false; this.$el.show(); note('stock', id + ' shown'); },
            isVisible: function () { return this.$el.is(':visible'); }}, extra || {});
    }
    /* What the stock components put into their nodes, enough for the window template: a list
       (ComboBox), a field (InputField), a check (CheckBox). */
    function combo(el, value, text) {
        if (el) el.innerHTML = '<span class="input-group combobox input-group-nr"><input type="text" class="form-control" readonly data-value="' +
            value + '" value="' + text + '"><button type="button" class="btn btn-default dropdown-toggle"><span class="caret"></span></button></span>';
    }
    function field(el) {
        if (el) el.innerHTML = '<div class="input-field"><input type="text" class="form-control"></div>';
    }
    function check(el, text) {
        if (el) el.innerHTML = '<label class="checkbox-indeterminate"><input type="checkbox" class="checkbox__native"><span>' + text + '</span></label>';
    }

    var infoPanel = filePanel('panel-info', undefined, {
        show: function () { this.hidden = false; this.$el.show(); note('stock', 'info panel shown'); }
    });

    /* Print (PrintWithPreview): the stock template, the lists and fields in their nodes; the rows of
       the desktop app hidden (applyMode). Shown — the preview of the controller is on
       (Print.onShowMainSettingsPrint). */
    var T = o.templates;
    var printPanel = filePanel('panel-print', _.template(T.print)({scope: PDFE.Views.PrintWithPreview, isRTL: false}), {
        show: function () {
            this.hidden = false; this.$el.show(); note('stock', 'print panel shown');
            printCtl.preview = true;
        }
    });
    combo(printPanel.el.querySelector('#print-combo-range'), 'all', 'All pages');
    field(printPanel.el.querySelector('#print-txt-pages'));
    combo(printPanel.el.querySelector('#print-combo-pages'), '2', 'A4');
    combo(printPanel.el.querySelector('#print-combo-orient'), '0', 'Portrait');
    combo(printPanel.el.querySelector('#print-combo-margins'), '', '');
    combo(printPanel.el.querySelector('#print-combo-content'), '1', 'Document and markup');
    printPanel.$el.find('.desktop-settings').hide();
    /* Print controller: Print and Print to PDF check the range, close the screen (menu.hide), then
       print or download (onBtnPrint); the screen closed — the preview off (onHidePrintMenu, on
       'menu:hide' of the screen it was given at render). */
    var printCtl = {
        preview: false,
        onHidePrintMenu: function () {
            if (!this.preview) return;
            this.preview = false;
            note('print', 'closePrintPreview');
        },
        onBtnPrint: function (print) {
            var range = printPanel.$el.find('#print-combo-range input').attr('data-value'),
                $pages = printPanel.$el.find('#print-txt-pages input'), pages = $pages.val();
            if (range === 'custom' && !/^[0-9,\-]+$/.test(pages)) { $pages.focus(); note('print', 'invalid range'); return; }
            printPanel.menu.hide();
            note('api', print ? 'asc_Print' : 'asc_DownloadAs', [range === 'custom' ? pages : range]);
        }
    };
    fileMenu.on('menu:hide', function () { printCtl.onHidePrintMenu(); });
    printPanel.$el.find('#print-btn-print').on('click', function () { printCtl.onBtnPrint(true); });
    printPanel.$el.find('#print-btn-print-pdf').on('click', function () { printCtl.onBtnPrint(false); });

    /* Advanced settings (FileMenuPanels.Settings): the stock template; rows by the stock setMode of a
       viewer with every right — the live viewer on too. Apply — the stock applySettings: the event
       settings:apply of the screen. */
    var settingsScope = _.extend({}, PDFE.Views.FileMenuPanels.Settings);
    var settingsPanel = filePanel('panel-settings', _.template(T.settings)({scope: settingsScope}), {
        show: function () { this.hidden = false; this.$el.show(); note('stock', 'settings panel shown'); }
    });
    ['theme', 'tab-style', 'unit', 'zoom', 'font-render'].forEach(function (k) { combo(settingsPanel.el.querySelector('#fms-cmb-' + k), k, k); });
    Array.prototype.forEach.call(settingsPanel.el.querySelectorAll('[id^="fms-chb-"], [id^="fms-rb-"]'), function (el) { check(el, el.id); });
    settingsPanel.$el.find('tr.editsave, tr.autosave, tr.forcesave, tr.coauth, tr.edit-pdf').hide();
    settingsPanel.$el.find('.btn.primary').on('click', function () {
        note('stock', 'settings apply');
        settingsPanel.menu.fireEvent('settings:apply', [settingsPanel.menu]);
    });

    /* Download as (FileMenuPanels.ViewSaveAs): the stock template with the formats of a PDF, a tile —
       the event saveas:format of the screen. */
    var formats = [[{name: 'DOCX', imgCls: 'docx', type: 65}, {name: 'PDF', imgCls: 'pdf', type: ''}, {name: 'ODT', imgCls: 'odt', type: 67}],
        [{name: 'RTF', imgCls: 'rtf', type: 68}, {name: 'TXT', imgCls: 'txt', type: 69}], [{name: 'JPG', imgCls: 'jpg', type: 1025}, {name: 'PNG', imgCls: 'png', type: 1029}]];
    var saveasPanel = filePanel('panel-saveas', _.template(T.saveas)({rows: formats, fileType: 'pdf', header: 'Download as'}), {
        show: function () { this.hidden = false; this.$el.show(); note('stock', 'saveas panel shown'); }
    });
    saveasPanel.$el.find('.btn-doc-format').on('click', function (e) {
        var type = e.currentTarget.getAttribute('format');
        saveasPanel.menu.fireEvent('saveas:format', [saveasPanel.menu, type ? parseInt(type, 10) : undefined]);
    });

    fileMenu.panels = {info: infoPanel, printpreview: printPanel, opts: settingsPanel, saveas: saveasPanel};
    var leftMenuView = {
        btnComments: button('btnComments', left, {toggle: true, group: 'left'}),
        btnThumbnails: button('btnThumbnails', left, {toggle: true, group: 'left'}),
        btnNavigation: button('btnNavigation', left, {toggle: true, group: 'left'}),
        btnSearchBar: button('btnSearchBar', left, {toggle: true, group: 'left'}),
        btnChat: button('btnChat', left, {toggle: true, group: 'left'}),
        getMenu: function (name) { return name === 'file' ? fileMenu : null; },
        /* LeftMenu.showMenu: 'file[:<panel>]' — the "File" screen on that panel. */
        showMenu: function (name) {
            note('leftMenu', 'showMenu', [name]);
            var m = /^file(?::(\w*))?$/.exec(name);
            if (m) fileMenu.show(m[1] || undefined);
        }
    };
    leftMenuView.menuFile = fileMenu;
    /* Stock LeftMenu: the panel of a pressed button is shown, the others hidden (onCoauthOptions), and
       the left menu is as wide as its panel while one is pressed (onBtnMenuClick, 300 by default). */
    var PANELS = {btnThumbnails: 'left-panel-thumbnails', btnNavigation: 'left-panel-navigation'};
    function leftLayout() {
        var any = false;
        ['btnComments', 'btnThumbnails', 'btnNavigation', 'btnSearchBar', 'btnChat'].forEach(function (k) {
            var on = !!leftMenuView[k].pressed;
            any = any || on;
            if (PANELS[k]) document.getElementById(PANELS[k]).style.display = on ? '' : 'none';
        });
        document.getElementById('left-menu').style.width = any ? '300px' : '';
    }
    ['btnComments', 'btnThumbnails', 'btnNavigation', 'btnSearchBar', 'btnChat'].forEach(function (k) {
        leftMenuView[k].on('toggle', leftLayout);
        /* LeftMenu.onBtnMenuClick: after a click on its button the layout is announced. */
        leftMenuView[k].on('click', function () { nc.trigger('layout:changed', 'leftmenu'); });
    });
    leftLayout();
    var leftMenuCtl = {
        leftMenu: leftMenuView,
        clickSaveAsFormat: function (menu, format) {
            note('leftMenu', 'clickSaveAsFormat', [format]);
            if (menu && typeof menu.hide === 'function') menu.hide();
        }
    };
    /* Listeners of the LeftMenu controller on the screen (by the bus): Apply of the settings and a
       format of Download as end with menu.hide() (applySettings, clickSaveAsFormat). */
    bus['settings:apply'] = [function (menu) { note('leftMenu', 'applySettings'); menu.hide(); }];
    bus['saveas:format'] = [function (menu, format) { leftMenuCtl.clickSaveAsFormat(menu, format); }];
    /* LeftMenu.clickToolbarPrint: file:print shows the print panel of the screen. */
    nc.on('file:print', function () { leftMenuView.showMenu('file:printpreview'); });
    /* LeftMenu shortcuts (keymaster on the document): F1 — Help, Alt+F — the screen, Ctrl+Shift+S —
       Download as. The engine takes Ctrl+P in its field and sends asc_onPrint. */
    document.addEventListener('keydown', function (e) {
        var key = String(e.key || '').toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
        if (key === 'p' && ctrl && !e.shiftKey && !e.altKey && e.target && e.target.id === 'area_id') {
            e.preventDefault();
            stock.fire('asc_onPrint');
        } else if (e.key === 'F1') {
            e.preventDefault();
            if (main.appOptions.canHelp) leftMenuView.showMenu('file:help');
        } else if (key === 'f' && e.altKey && !ctrl) {
            e.preventDefault();
            leftMenuView.showMenu('file');
        } else if (key === 's' && ctrl && e.shiftKey) {
            e.preventDefault();
            if (main.appOptions.canDownload) leftMenuView.showMenu('file:saveas');
        }
    });

    /* Stock layout: the vertical layout writes the item heights (VBoxLayout.doLayout). */
    function item(id, h) { return {height: h, el: $('#' + id)}; }
    var tb = item('toolbar', 88), st = item('statusbar', 25);
    var vlayout = {
        panels: [tb, st],
        getItem: function (name) { return name === 'toolbar' ? tb : name === 'statusbar' ? st : null; },
        doLayout: function () {
            this.panels.forEach(function (p) { if (p.el.is(':visible')) p.el.css({height: p.height}); });
            note('layout', 'doLayout');
        }
    };
    var searchBar = _.extend({}, Backbone.Events, {
        visible: false,
        show: function () { this.visible = true; $('#stock-search').show(); this.trigger('show', this); },
        hide: function () { this.visible = false; $('#stock-search').hide(); this.trigger('hide', this); }
    });
    var viewportCtl = {
        viewport: {vlayout: vlayout, hlayout: {doLayout: function () {}}},
        api: api,
        getApi: function () { return api; },
        getView: function (name) { return name === 'Common.Views.Header' ? stock.header : null; },
        isSearchBarVisible: function () { return searchBar.visible; },
        searchBar: searchBar
    };
    /* Stock Viewport.onSearchShow: the search bar is shown before later subscribers run. */
    nc.on('search:show', function () { searchBar.show(); });

    var main = {
        editorConfig: o.config,
        appOptions: _.extend({
            canDownload: true, canPrint: true, canRename: true, canUseHistory: true,
            canRequestSharingSettings: true, canViewComments: true, isLightVersion: false,
            isDesktopApp: false, canSwitchMode: false, canPDFEdit: true, canPDFAnnotate: true,
            isPDFEdit: false, isPDFAnnotate: false, canHelp: true
        }, o.rights || {}),
        api: api,
        document: {title: o.title},
        _state: {}
    };
    /* Stock Main.onPdfModeApply: the mode flags, then pdf:mode-changed. */
    nc.on('pdf:mode-apply', function (mode) {
        var a = main.appOptions;
        note('stock', 'pdf:mode-apply', [mode]);
        if (!a.canSwitchMode) return;
        if (mode === 'edit' && a.canPDFEdit) { a.isPDFEdit = true; a.isPDFAnnotate = false; }
        else if (mode === 'comment' && a.canPDFAnnotate) { a.isPDFEdit = false; a.isPDFAnnotate = true; }
        else if (mode === 'view') { a.isPDFEdit = a.isPDFAnnotate = false; }
        nc.trigger('pdf:mode-changed', a);
    });

    var navigation = {_viewerNavigationObject: o.bookmarks || null};
    /* The stock comments collection (Backbone): comments of the PDF, hidden ones marked hide. */
    var comments = new Backbone.Collection((o.comments || []).map(function (c, i) {
        return _.extend({uid: 'c' + i, hide: false}, c);
    }));
    PDFE.getCollection = function (name) { return name === 'Common.Collections.Comments' ? comments : null; };
    /* Main.onPrint: Ctrl+P of the engine — file:print, with the right and without a modal window. */
    api.asc_registerCallback('asc_onPrint', function () {
        if (!main.appOptions.canPrint || Common.Utils.ModalWindow.isVisible()) return;
        nc.trigger('file:print');
    });
    var controllers = {Main: main, Viewport: viewportCtl, LeftMenu: leftMenuCtl, Toolbar: {toolbar: toolbarView}, Navigation: navigation, Print: printCtl};
    PDFE.getController = function (name) {
        if (stock.missing.indexOf(name) >= 0) return null;
        return controllers[name] || null;
    };

    /* Common.localStorage: getItem gives null for a key that is not there. */
    var kept = {};
    Common.localStorage = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(kept, k) ? kept[k] : null; },
        setItem: function (k, v) { kept[k] = String(v); }
    };

    Common.Utils = Common.Utils || {};
    Common.Utils.ModalWindow = {isVisible: function () { return !!stock.modal; }};
    Common.UI.Menu = {Manager: {hideAll: function () { note('stock', 'menu hideAll'); }}};
    Common.Controllers = Common.Controllers || {};
    Common.Controllers.LaunchController = {isScriptLoaded: function () { return true; }};
    window.Asc = window.Asc || {};
    Asc.c_oAscFileType = {PDF: 513, DOCX: 65, PNG: 1029, JPG: 1025};

    /* Stock window: modal:show before the first render, window:show after the window is placed. The
       footer — buttons of the config as Window.initialize parses them (a predefined name or
       {value, caption, primary, cls}); Enter — onprimary while there is a primary button, Escape —
       close (the keydown of the window on the document). */
    var winText = {ok: Common.UI.Window && Common.UI.Window.okButtonText || 'OK',
        cancel: Common.UI.Window && Common.UI.Window.cancelButtonText || 'Cancel'};
    function Win() { this.initialize.apply(this, arguments); }
    Win.prototype.initialize = function (options) { this.initConfig = _.extend({}, options); };
    Win.prototype.render = function () {
        var c = this.initConfig, primary = c.primary === undefined ? 'ok' : c.primary;
        var footer = (c.buttons || []).map(function (b) {
            var item = typeof b === 'object' ?
                {value: b.value, text: b.caption, cls: 'auto' + ((b.primary || primary === b.value) ? ' primary' : '') + (b.cls ? ' ' + b.cls : '')} :
                {value: b, text: winText[b], cls: primary === b ? 'primary' : ''};
            return '<button class="btn normal dlg-btn ' + item.cls + '" result="' + item.value + '">' + _.escape(item.text) + '</button>';
        }).join('');
        this.$window = $('<div class="asc-window modal"><div class="header"><span class="title"></span>' +
            '<div class="tool close"></div></div><div class="body">' + (c.tpl || '') +
            (footer ? '<div class="footer center">' + footer + '</div>' : '') + '</div></div>');
        this.$window.addClass(c.cls || '');
        this.$window.find('.title').text(c.title || '');
        /* Window.render: the width of the config inline. */
        if (typeof c.width === 'number') this.$window.css('width', c.width + 'px');
        $(document.body).append(this.$window);
        return this;
    };
    Win.prototype.show = function () {
        var me = this;
        nc.trigger('modal:show', this);
        if (!this.$window) this.render();
        stock.windows.push(this);
        stock.modal = (stock.modal || 0) + 1;
        this.keys = function (e) {
            if (!me.$window) return;
            if (e.keyCode === 27) { me.close(); return; }
            if (e.keyCode === 13 && me.$window.find('.btn.primary').length) {
                var t = $(e.target);
                if (t.hasClass('dlg-btn') && !t.hasClass('primary')) return;
                if ((me.initConfig.onprimary || function () {}).call(me) === false) e.preventDefault();
            }
        };
        document.addEventListener('keydown', this.keys);
        note('window', 'show', [this.initConfig.cls, this.initConfig.title]);
        nc.trigger('window:show', this);
    };
    Win.prototype.close = function () {
        if (this.keys) document.removeEventListener('keydown', this.keys);
        if (this.$window) {
            this.$window.remove();
            stock.modal = Math.max(0, (stock.modal || 0) - 1);
        }
        this.$window = null;
        note('window', 'close', [this.initConfig.cls]);
    };
    Win.extend = Backbone.Model.extend;
    Common.UI.Window = Win;
    Common.Views = Common.Views || {};
    Common.Views.About = Common.Views.About || {};
    Common.Views.About.prototype = {contentHtml: function () { return '<div class="stock-about">About the viewer</div>'; }};
    /* The stock error window: the call is recorded; the test closes it by hand, which runs the callback. */
    var errorWindows = [];
    Common.UI.error = function (config) { errorWindows.push(config); note('error', 'open', [config.msg]); };
    Common.Views.RenameDialog = Common.Views.RenameDialog || {};
    Common.Views.RenameDialog.prototype = {txtInvalidName: Common.Views.RenameDialog.txtInvalidName};

    var stock = window.stock = {
        log: log, events: events, note: note, api: api, main: main, viewport: viewportCtl, leftMenu: leftMenuCtl,
        toolbar: toolbarView, navigation: navigation, comments: comments, fileMenu: fileMenu, infoPanel: infoPanel, searchBar: searchBar,
        printPanel: printPanel, settingsPanel: settingsPanel, saveasPanel: saveasPanel, print: printCtl, bus: bus,
        errorWindows: errorWindows, newFile: standFile,
        closeError: function () { var c = errorWindows.shift(); c && c.callback && c.callback(); return !!c; },
        layout: {toolbar: tb, statusbar: st}, kept: kept, skins: skins, header: null, modal: false, windows: [], missing: [],
        fire: function (name) {
            var args = Array.prototype.slice.call(arguments, 1);
            (callbacks[name] || []).forEach(function (f) { f.apply(null, args); });
        },
        /* The stock start: config from Gateway init, the face, then app:ready. */
        init: function () { Common.Gateway.fire('init', {config: o.config}); },
        /* The stock start removes the loading skeleton by its id on app:face. */
        face: function () { $('#loading-mask').hide().remove(); nc.trigger('app:face', main.appOptions); },
        ready: function () { nc.trigger('app:ready'); },
        boot: function () { this.init(); this.face(); this.ready(); },
        heights: function () {
            return {toolbar: document.getElementById('toolbar').getBoundingClientRect().height,
                statusbar: document.getElementById('statusbar').getBoundingClientRect().height,
                model: [tb.height, st.height]};
        },
        sent: function (name) { return events.filter(function (e) { return e.name === name; }).map(function (e) { return e.args; }); },
        calls: function (who, what) { return log.filter(function (e) { return e.who === who && (!what || e.what === what); }).map(function (e) { return e.args; }); }
    };
    vlayout.doLayout();
}

/* --- Page --------------------------------------------------------------------------------- */

/* A new page of the viewer.
 *  - config   — editorConfig (default {ui: {shell: 'modern'}});
 *  - rights   — appOptions overrides;
 *  - title    — document title (default 'Report.pdf');
 *  - bookmarks — what the stock navigation keeps for a PDF with bookmarks, as the engine gives them:
 *               [{page, level, description}] (null: none);
 *  - comments — comments of the PDF in the stock collection, e.g. [{text: 'Hi'}] (default none);
 *  - zoom     — the engine zoom before the first event, percent (default 100);
 *  - page, pages — the current page (from 0) and the page count of the engine (default 0 and 3);
 *  - renderer — what api.getDocumentRenderer() gives: {documentWidth} (default 600; width — the
 *               width of #editor_sdk unless given, canvas — the canvas of the pages) and its file
 *               (CFile: getPage draws a page into a canvas, the sizes are US Letter); null — no
 *               renderer;
 *  - unloaded — pages the file does not give yet (getPage → null), e.g. [1];
 *  - boot     — run the stock start (Gateway init, app:face, app:ready) and wait for the shell
 *               (default true); 'none' — load only;
 *  - before   — a function run in the page after the modules load and before the start;
 *  - css      — compact styles (default true);
 *  - width, height — viewport;
 *  - scale    — device pixels per CSS pixel (default 1), for shots read pixel by pixel.
 */
async function open(browser, opts = {}) {
    const page = await browser.newPage({viewport: {width: opts.width || 1280, height: opts.height || 800},
        deviceScaleFactor: opts.scale || 1});
    page.setDefaultTimeout(5000);
    const errors = [], warnings = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
    page.errors = errors;
    page.warnings = warnings;
    await page.route('http://stand.test/**', route => {
        const url = new URL(route.request().url());
        if (url.href === BASE) return route.fulfill({status: 200, contentType: 'text/html', body: HTML});
        const file = path.join(ROOT, decodeURIComponent(url.pathname.replace(/^\/web-apps\//, '')));
        if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            const type = file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
            return route.fulfill({status: 200, contentType: type, body: fs.readFileSync(file)});
        }
        return route.fulfill({status: 404, body: ''});
    });
    await page.goto(BASE);
    await page.addStyleTag({content: STAND_CSS});
    if (opts.css !== false) await page.addStyleTag({content: await styles(browser)});
    for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js', 'vendor/backbone/backbone.js'])
        await page.addScriptTag({path: path.join(ROOT, file)});
    /* AMD: dependencies by name — shared modules from Common.UI.Compact, viewer modules from PDFE.Views. */
    await page.addScriptTag({content: `window.define = function (deps, factory) {
        return factory.apply(null, (deps || []).map(function (d) {
            var name = d.split('/').pop();
            if (d === 'backbone') return window.Backbone;
            if (d === 'underscore') return window._;
            if (/^common\\/main\\/lib\\/view\\/compact\\//.test(d)) return window.Common && Common.UI && Common.UI.Compact && Common.UI.Compact[name];
            if (/^pdfeditor\\/main\\/app\\/view\\//.test(d)) return window.PDFE && PDFE.Views && PDFE.Views[name];
            return undefined;
        }));
    };
    window.Common = window.Common || {};`});
    await page.addScriptTag({path: path.join(ROOT, 'apps/common/main/lib/core/NotificationCenter.js')});
    /* The stock locale: plain objects at the key paths before the views load (common/locale.js). */
    await page.evaluate(l10n => {
        for (const prop in l10n) {
            const p = prop.split('.');
            if (p.length <= 2) continue;
            let obj = window;
            for (let i = 0; i < p.length - 1; i++) {
                if (obj[p[i]] === undefined) obj[p[i]] = {};
                obj = obj[p[i]];
            }
            obj[p[p.length - 1]] = l10n[prop];
        }
        window.PDFE = window.PDFE || {};
        PDFE.Views = PDFE.Views || {};
        Common.UI = Common.UI || {};
    }, JSON.parse(fs.readFileSync(LOCALE, 'utf8')));
    await page.evaluate(installStock, {
        config: opts.config === undefined ? {ui: {shell: 'modern'}} : opts.config,
        rights: opts.rights || {},
        title: opts.title === undefined ? 'Report.pdf' : opts.title,
        bookmarks: opts.bookmarks || null,
        comments: opts.comments || [],
        zoom: opts.zoom || 100,
        page: opts.page || 0,
        pages: opts.pages === undefined ? 3 : opts.pages,
        renderer: opts.renderer === undefined ? {documentWidth: 600} : opts.renderer,
        unloaded: opts.unloaded || [],
        templates: stockTemplates()
    });
    for (const name of SHARED.concat(SHELL)) await page.addScriptTag({content: fs.readFileSync(moduleFile(name), 'utf8')});
    await page.addScriptTag({content: 'window.shell = PDFE.Views.CompactShell;\n(function () {\n' + viewportWiring() + '\n})();'});
    if (opts.before) await page.evaluate(opts.before);
    if (opts.boot !== 'none' && opts.boot !== false) {
        await page.evaluate(() => stock.boot());
        await page.waitForFunction(() => !!document.getElementById('vo-shell'), null, {timeout: 5000})
            .catch(() => { throw new Error('the shell is not built' + (warnings.length ? ': ' + warnings[0] : '')); });
        await settle(page);
    }
    return page;
}

/* Two frames and a timer turn: deferred handlers (setTimeout 0) and resize observers have run. */
function settle(page) {
    return page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0)))));
}

/* Check list of one test file: PASS/FAIL lines, a summary, exit code 1 on any failure. */
function checker() {
    let passed = 0, failed = 0;
    return {
        async check(name, fn) {
            try {
                await fn();
                console.log('PASS', name);
                passed++;
            } catch (error) {
                console.log('FAIL', name, '—', String(error && error.message || error).replace(/\s+/g, ' ').trim());
                failed++;
            }
        },
        done() {
            console.log(`${passed} passed, ${failed} failed`);
            process.exitCode = failed || !passed ? 1 : 0;
        }
    };
}

module.exports = {ROOT, BASE, VIEW, COMPACT, VIEWPORT, LOCALE, SHARED, SHELL, OVERRIDES, moduleFile, styleFile, viewportWiring,
    stockTemplates, launch, styles, open, settle, checker};
