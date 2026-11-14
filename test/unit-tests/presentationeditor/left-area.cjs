/* Run: node test/unit-tests/presentationeditor/left-area.cjs [path to CompactLeft.js [path to compact-areas.less]]
 * Left area of the presentation shell: the stock comments, search and chat panels
 * open in their stock place (#left-menu before the thumbnail strip) while the icon
 * column is hidden; the thumbnail strip stays next to the open panel; the comments
 * panel is toggled by the stock left-menu button; adding a comment is the stock command
 * gated by the commenting right, including without the edit right, and the panel is open
 * while doing so; the panel follows canViewComments; in the "Stock interface" the stock
 * showMenu is restored; the version history column, like the left menu, ends above the
 * status bar; the panel magnifier toggles the stock search bar, the bar sits under the
 * magnifier and closes on a click outside it;
 * AIR icon addresses for the stock area nodes are on the document root, in compact only.
 *
 * The module is loaded in node via vm on top of a fake stock code; the left menu
 * mechanics come from the real sources: the LeftMenu view (onBtnMenuClick, onCoauthOptions,
 * showMenu), the LeftMenu controller (menuExpand, onShowTumbnails, onShowHideSearch,
 * onShowHideChat, tryToShowLeftMenu, onLeftMenuHide), the button (Button.toggle, click,
 * doToggle, isDisabled, isActive) and the button group (ToggleManager toggleGroup).
 * The bridge to the stock controls is the real StockBridge.js.
 * The optional argument is a corrupted copy of the module for a negative control:
 * a copy without the showMenu override must fail comments_panel_left_of_thumbnails.
 * The second optional argument is a copy of the area styles: a copy in which the history
 * column is missing from the rule above the status bar must fail history_panel_ends_above_status_bar.
 * The styles are compiled by the less package from build/node_modules (of the tree or the main web-apps copy).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const PE_APP = path.join(ROOT, 'apps/presentationeditor/main/app');
const PE_LESS = path.join(ROOT, 'apps/presentationeditor/main/resources/less');
/* Paths from the arguments go in order, skipping --only <test name>. */
const ARGS = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--only').map(a => path.resolve(a));
const FILE = ARGS[0] || path.join(PE_APP, 'view/CompactLeft.js');
const BRIDGE = path.join(PE_APP, 'view/StockBridge.js');
const LESS = ARGS[1] || path.join(PE_LESS, 'compact-areas.less');
const SHELL_LESS = path.join(PE_LESS, 'compact-shell.less');
const COMPONENTS = path.join(ROOT, 'apps/common/main/lib/component');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

/* --- Area styles ------------------------------------------------------------------- */

function lessCompiler() {
    const roots = [path.join(ROOT, 'build')];
    try {
        const common = cp.execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
            {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
        roots.push(path.join(path.dirname(common), 'build'));
    } catch (e) { /* without git, only the tree */ }
    for (const r of roots) {
        try { return require(require.resolve('less', {paths: [r]})); } catch (e) { /* next */ }
    }
    throw new Error('the less compiler is not found (npm install in build/ of the web-apps copy)');
}

/* compact-shell.less with the area styles from LESS (tokens and rows come from there), as flat rules:
   [{sels: [string], decls: [[property, value]]}]. */
async function areaRules() {
    const src = fs.readFileSync(SHELL_LESS, 'utf8');
    assert.ok(/@import\s+"compact-areas\.less";/.test(src), 'compact-shell.less does not import compact-areas.less');
    const out = await lessCompiler().render(src.replace(/@import\s+"compact-areas\.less";/, () => '@import ' + JSON.stringify(LESS) + ';'),
        {filename: SHELL_LESS, javascriptEnabled: true});
    const css = out.css.replace(/\/\*[\s\S]*?\*\//g, '');
    const list = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
        const prelude = m[1].trim();
        if (prelude.startsWith('@')) continue;
        const decls = [];
        for (const d of m[2].split(';')) {
            const i = d.indexOf(':');
            if (i > 0) decls.push([d.slice(0, i).trim(), d.slice(i + 1).trim()]);
        }
        list.push({sels: prelude.replace(/^.*\{/, '').split(',').map(s => s.trim().replace(/\s+/g, ' ')), decls});
    }
    return list;
}

/* --- Real stock code methods ---------------------------------------------------- */

/* Function text from the source: `name: function (…) {…}` or `function name(…) {…}`
   (first occurrence after anchor); brackets are counted over the code without strings and comments. */
function source(file, name, anchor) {
    const src = fs.readFileSync(file, 'utf8');
    const from = anchor ? src.indexOf(anchor) : 0;
    assert.ok(from >= 0, path.basename(file) + ': anchor ' + anchor + ' not found');
    const re = new RegExp('(?:\\b' + name + '\\s*:\\s*function\\s*\\(|\\bfunction\\s+' + name + '\\s*\\()');
    const head = re.exec(src.slice(from));
    assert.ok(head, path.basename(file) + ': ' + name + ' not found');
    const start = from + head.index + head[0].lastIndexOf('function');
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
        if (c === '"' || c === "'") { const q = c; i++; while (src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
    }
    let text = src.slice(start, i + 1);
    if (/^function\s+\w/.test(text)) text = text.replace(/^function\s+\w+/, 'function');
    return text;
}

/* --- Environment -------------------------------------------------------------------- */

function makeEnv(options) {
    const mode = Object.assign({isEdit: true, canEdit: true, canCoAuthoring: true, canComments: true,
        canViewComments: true, canChat: true}, options || {});
    const calls = [];
    const log = (name, args) => calls.push({name, args: Array.from(args || [])});

    function events(target) {
        const handlers = {};
        target.on = function (names, fn, ctx) {
            if (names && typeof names === 'object') { Object.keys(names).forEach(k => target.on(k, names[k])); return target; }
            String(names).split(/\s+/).forEach(n => (handlers[n] = handlers[n] || []).push([fn, ctx]));
            return target;
        };
        target.off = function (names, fn) {
            String(names).split(/\s+/).forEach(n => { handlers[n] = (handlers[n] || []).filter(h => fn && h[0] !== fn); });
            return target;
        };
        target.trigger = function (name, ...args) {
            (handlers[name] || []).slice().forEach(([fn, ctx]) => fn.apply(ctx || target, args));
            return target;
        };
        return target;
    }

    /* A small DOM: body classes, inline properties, rectangles and nodes by id. */
    function node(id, rect) {
        const set = new Set(), props = {};
        return {id, rect: rect || null, classList: {
            add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
            toggle: (c, on) => { const v = on === undefined ? !set.has(c) : !!on; v ? set.add(c) : set.delete(c); return v; }
        }, style: {
            props, setProperty: (k, v) => { props[k] = String(v); }, removeProperty: k => { delete props[k]; },
            getPropertyValue: k => (k in props ? props[k] : '')
        },
        getBoundingClientRect() { const r = this.rect || {left: 0, top: 0, width: 0, height: 0}; return Object.assign({right: r.left + r.width, bottom: r.top + r.height}, r); },
        closest(sel) { return (this.parents || []).find(p => p.matches(sel)) || null; },
        matches(sel) { return sel === '#' + this.id; }};
    }
    const nodes = {};
    const lupas = [];
    const document = {body: node('body'), documentElement: node('html'), baseURI: 'http://stand.test/web-apps/apps/presentationeditor/main/index.html',
        getElementById: id => nodes[id] || null,
        querySelectorAll: sel => (sel === '#vo-tb [data-vo="search"]' ? lupas.slice() : [])};
    ['vo-shell', 'left-menu', 'editor-container'].forEach(id => { nodes[id] = node(id); });
    nodes['vo-shell'].rect = {left: 0, top: 0, width: 1440, height: 132};
    nodes['vo-toolbar'] = node('vo-toolbar', {left: 20, top: 80, width: 1400, height: 44});
    lupas.push(node('lupa', {left: 102, top: 86, width: 32, height: 32}));
    document.body.classList.add('vo-compact');

    const store = {};
    const NC = events({});
    const Common = {
        NotificationCenter: NC,
        localStorage: {
            getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
            setBool: (k, v) => { store[k] = v ? '1' : '0'; }
        },
        UI: {LayoutManager: {isElementVisible: () => true}, Menu: {Manager: {hideAll() {}}}},
        Controllers: {LaunchController: {isScriptLoaded: () => true}}
    };
    /* window listeners: [type, function, capture]. */
    const winListeners = [];
    const ctx = {_, Common, document, console, URL, SCALE_MIN: 40, MENU_SCALE_PART: 300, groups: {},
        $: () => ({toggleClass() { return this; }}),
        addEventListener: (type, fn, capture) => winListeners.push([type, fn, !!capture])};
    ctx.window = ctx;
    vm.createContext(ctx);
    const compile = (file, name, anchor) => vm.runInContext('(' + source(file, name, anchor) + ')', ctx, {filename: path.basename(file) + ':' + name});

    const BTN = path.join(COMPONENTS, 'Button.js');
    const btnProto = {
        toggle: compile(BTN, 'toggle', 'doToggle: function'),
        click: compile(BTN, 'click', 'doToggle: function'),
        doToggle: compile(BTN, 'doToggle'),
        isDisabled: compile(BTN, 'isDisabled'),
        isActive: compile(BTN, 'isActive')
    };
    const toggleGroup = compile(path.join(COMPONENTS, 'ToggleManager.js'), 'toggleGroup');

    /* Icon column button: real methods, the group works like ToggleManager.register.
       The column is not visible in the shell, so isVisible() is false, like for a hidden node. */
    function button(name, opts) {
        const el = {attr() { return this; }, trigger() { return this; }, hasClass: () => false, removeClass() { return this; }};
        const b = events(Object.assign(Object.create(btnProto), {
            name, disabled: false, pressed: false, enableToggle: true, allowDepress: true,
            toggleGroup: 'leftMenuGroup', options: Object.assign({}, opts), cmpEl: el, $el: el,
            isVisible: () => false
        }));
        (ctx.groups.leftMenuGroup = ctx.groups.leftMenuGroup || []).push(b);
        b.on('toggle', toggleGroup);
        return b;
    }

    const api = {
        callbacks: {},
        asc_registerCallback(name, fn) { (this.callbacks[name] = this.callbacks[name] || []).push(fn); },
        ShowThumbnails(show) { log('api.ShowThumbnails', [show]); }
    };
    const fire = (name, ...args) => (api.callbacks[name] || []).slice().forEach(fn => fn(...args));

    /* Left menu view: the real onBtnMenuClick, onCoauthOptions, showMenu. */
    const VIEW = path.join(PE_APP, 'view/LeftMenu.js');
    const viewProto = {
        onBtnMenuClick: compile(VIEW, 'onBtnMenuClick'),
        onCoauthOptions: compile(VIEW, 'onCoauthOptions'),
        showMenu: compile(VIEW, 'showMenu'),
        isButtonInMoreMenu: () => false,
        isVisible: () => true
    };
    const view = events(Object.create(viewProto));
    let width = 40;
    const panel = name => ({open: false, show() { this.open = true; log(name + '.show'); }, hide() { this.open = false; log(name + '.hide'); },
        isVisible() { return this.open; }, focus() { log(name + '.focus'); }});
    Object.assign(view, {
        mode, _state: {disabled: false},
        $el: {width(v) { if (v === undefined) return width; width = v; return this; }},
        btnSearchBar: button('btnSearchBar', {action: 'advancedsearch'}),
        btnThumbs: button('btnThumbs', {action: 'thumbs'}),
        btnAbout: button('btnAbout', {action: 'about'}),
        btnComments: button('btnComments'),
        btnChat: button('btnChat'),
        panelComments: panel('panelComments'),
        panelChat: panel('panelChat'),
        panelSearch: panel('panelSearch'),
        show() { log('LeftMenu.show'); }
    });
    view.fireEvent = function (name, args) { log('fireEvent', [name]); view.trigger.apply(view, [name].concat(Array.isArray(args) ? args : [args])); };
    const viewOnBtnMenuClick = view.onBtnMenuClick;
    view.onBtnMenuClick = function (btn) { log('LeftMenu.onBtnMenuClick', [btn.name]); return viewOnBtnMenuClick.apply(this, arguments); };
    /* Stock button markup (view/LeftMenu.js render). */
    view.btnSearchBar.on('click', () => { view.onBtnMenuClick(view.btnSearchBar); view.btnSearchBar.pressed && view.fireEvent('search:aftershow'); });
    view.btnThumbs.on('click', b => view.onBtnMenuClick(b));
    view.btnComments.on('click', b => view.onBtnMenuClick(b));
    view.btnChat.on('click', b => view.onBtnMenuClick(b));
    view.btnThumbs.pressed = true;
    view.btnComments.hidden = !(mode.canViewComments && !mode.isLightVersion);
    view.btnChat.hidden = !(mode.canChat && !mode.isLightVersion);

    /* Left menu controller: real methods. */
    const CTL = path.join(PE_APP, 'controller/LeftMenu.js');
    const leftCtl = {leftMenu: view, mode, api, isThumbsShown: true};
    ['menuExpand', 'onShowTumbnails', 'onShowHideSearch', 'onShowHideChat', 'tryToShowLeftMenu', 'onLeftMenuHide']
        .forEach(m => { leftCtl[m] = compile(CTL, m); });
    view.btnThumbs.on('toggle', (b, show) => leftCtl.onShowTumbnails(b, show));
    view.on('panel:show', (v, p, show) => leftCtl.menuExpand(v, p, show));

    /* Comments and the strip. */
    const commentsCtl = {
        addDummyComment() { log('Comments.addDummyComment'); },
        onAppAddComment(sender, toDoc) { log('Comments.onAppAddComment', [sender]); if (!toDoc) this.addDummyComment(); }
    };
    NC.on('app:comment:add', (...a) => commentsCtl.onAppAddComment(...a));
    const toolbarCtl = {btnsComment: []};
    if (mode.isEdit && mode.canCoAuthoring && mode.canComments) {
        const b = events({disabled: false, isDisabled() { return this.disabled; }, click() { log('ToolbarCtl.btnsComment.click'); this.trigger('click', this); }});
        b.on('click', () => NC.trigger('app:comment:add', 'toolbar'));
        toolbarCtl.btnsComment.push(b);
    }
    const hlayout = {doLayout() { log('hlayout.doLayout'); }};
    /* Viewport controller: the search bar is created lazily on the first search:show and
       shown (onSearchShow → onSearchToggle); while the left search panel is open
       stock gives focus to the panel instead of the bar. Subscribed before the shell zones. */
    const viewportCtl = {viewport: {hlayout}, searchBar: null,
        isSearchBarVisible() { return !!this.searchBar && this.searchBar.isVisible(); }};
    NC.on('search:show', () => {
        if (view.panelSearch.open) { log('panelSearch.focus'); return; }
        if (!viewportCtl.searchBar) {
            const bar = events({shown: false, isVisible() { return this.shown; },
                show() { this.shown = true; log('searchBar.show'); this.trigger('show', this); },
                hide() { this.shown = false; log('searchBar.hide'); this.trigger('hide', this); }});
            viewportCtl.searchBar = bar;
        }
        viewportCtl.searchBar.show();
    });
    const controllers = {
        Main: {appOptions: mode, api},
        LeftMenu: leftCtl,
        Toolbar: toolbarCtl,
        Viewport: viewportCtl,
        'Common.Controllers.Comments': commentsCtl
    };
    ctx.PE = {Views: {}, getController: n => controllers[n] || null};

    /* Scaffold: guard, command registry, engine callbacks, "Stock interface". */
    const errors = [];
    const shell = {
        advanced: false, startupFailed: false, commands: {},
        guarded: (label, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { errors.push(label + ': ' + (e && e.stack || e)); }
        },
        command(name, fn) { if (typeof fn === 'function') { this.commands[name] = fn; return fn; } const me = this; return function () { const f = me.commands[name]; return f ? f.apply(this, arguments) : undefined; }; },
        hasCommand(name) { return typeof this.commands[name] === 'function'; },
        onApi(name, fn) { api.asc_registerCallback(name, this.guarded('api: ' + name, fn)); },
        resync() { log('shell.resync'); },
        toggleMode() {
            this.advanced = !this.advanced;
            document.body.classList.toggle('vo-compact', !this.advanced);
            document.body.classList.toggle('vo-advanced', this.advanced);
            NC.trigger('shell:advanced', this.advanced);
        }
    };
    ctx.PE.Views.CompactShell = shell;

    vm.runInContext(fs.readFileSync(BRIDGE, 'utf8').replace(/^define\(\[[^\]]*\],\s*/m, '(').replace(/\);\s*$/, ')()'), ctx, {filename: BRIDGE});
    vm.runInContext(fs.readFileSync(FILE, 'utf8').replace(/^define\(\[[^\]]*\],\s*/m, '(').replace(/\);\s*$/, ')()'), ctx, {filename: FILE});
    const Left = ctx.PE.Views.CompactLeft;
    assert.ok(Left && typeof Left.install === 'function', 'нет PE.Views.CompactLeft.install');

    const env = {ctx, mode, view, leftCtl, commentsCtl, toolbarCtl, viewportCtl, shell, api, fire, NC, calls, errors, document, Left, store,
        nodes, lupas, winListeners,
        pointerdown(target) { winListeners.filter(l => l[0] === 'pointerdown').forEach(l => l[1]({target})); },
        width: () => width,
        count: name => calls.filter(c => c.name === name).length,
        reset() { calls.length = 0; },
        start() { Left.install(shell); return env; },
        open: () => view.btnComments.pressed === true && view.panelComments.open === true,
        leftOpen: () => document.body.classList.contains('vo-left-open'),
        bridge: () => ctx.PE.Views.StockBridge
    };
    return env;
}

function layoutChanged(env) {
    env.NC.trigger('layout:changed');
}

function noErrors(env) {
    assert.deepEqual(env.errors, [], 'исключения в обработчиках оболочки');
}

/* --- Tests ----------------------------------------------------------------------------- */

const tests = [
    {
        name: 'comments_panel_left_of_thumbnails',
        run() {
            /* Styles: the area is the stock #left-menu in its own place, visible under vo-left-open,
               the nodes and the column order do not change. */
            const less = fs.readFileSync(LESS, 'utf8');
            assert.ok(/&\.vo-left-open #left-menu\s*\{[^}]*display:\s*block/.test(less), 'нет показа #left-menu под body.vo-left-open');
            assert.ok(/&:not\(\.vo-left-open\) #left-menu\s*\{\s*display:\s*none !important/.test(less), 'закрытая область не спрятана против инлайнового show()');
            const columns = less.match(/(#left-menu|#editor-container|#editor_sdk|#viewport-hbox-layout)[^{};]*\{[^}]*\}/g) || [];
            assert.deepEqual(columns.filter(r => /(^|[\s;{])order\s*:|flex-direction:\s*\w+-reverse|float:\s*right/.test(r)), [],
                'стили переставляют колонки раскладки');

            const env = makeEnv().start();
            const {view} = env;
            env.reset();
            /* Stock panel call (Ctrl+Shift+H): there is no icon column, but the panel is open. */
            view.showMenu('comments');
            noErrors(env);
            assert.ok(env.open(), 'showMenu(\'comments\') не открыл штатную панель комментариев');
            assert.ok(env.calls.some(c => c.name === 'LeftMenu.onBtnMenuClick' && c.args[0] === 'btnComments'), 'панель открыта мимо штатного onBtnMenuClick');
            assert.ok(env.leftOpen(), 'левая область не показана (нет body.vo-left-open)');
            assert.ok(env.width() > 40, 'левое меню осталось шириной колонки значков: ' + env.width());
            /* The thumbnail strip stays next to the panel. */
            assert.equal(view.btnThumbs.pressed, true, 'кнопка ленты миниатюр отжата открытием панели');
            assert.equal(env.count('api.ShowThumbnails'), 0, 'открытие панели спрятало ленту миниатюр');

            /* The strip is hidden and shown again with the panel open: the panel stays. */
            view.btnThumbs.click();
            assert.ok(env.calls.some(c => c.name === 'api.ShowThumbnails' && c.args[0] === false), 'лента миниатюр не скрылась штатно');
            view.btnThumbs.click();
            assert.ok(env.open() && env.leftOpen(), 'показ ленты миниатюр закрыл панель комментариев');
            assert.ok(env.width() > 40, 'ширина панели не восстановлена после ленты: ' + env.width());

            /* Closed with the stock button: the area is hidden, the strip is in place. */
            env.reset();
            view.btnComments.click();
            noErrors(env);
            assert.equal(env.open(), false, 'штатная кнопка не закрыла панель');
            assert.equal(env.leftOpen(), false, 'область осталась показана после закрытия панели');
            assert.equal(view.btnThumbs.pressed, true, 'лента миниатюр отжата после закрытия панели');
            assert.equal(env.calls.filter(c => c.name === 'api.ShowThumbnails' && c.args[0] === false).length, 0, 'закрытие панели спрятало ленту');
        }
    },
    {
        name: 'comments_toggle_through_stock_button',
        run() {
            const env = makeEnv().start();
            const {view} = env, B = env.bridge();
            env.reset();
            /* The panel's "Comment" and "Review → Comments" are twins of the stock button. */
            assert.equal(B.run('LeftMenu:btnComments'), true, 'двойник LeftMenu:btnComments не сработал');
            assert.ok(env.open() && env.leftOpen(), 'двойник не открыл панель комментариев');
            assert.equal(B.state('LeftMenu:btnComments').pressed, true, 'нажатость не штатная: кнопка панели не нажата');
            assert.equal(B.run('LeftMenu:btnComments'), true);
            assert.ok(!env.open() && !env.leftOpen(), 'повторный двойник не закрыл панель');
            assert.equal(B.state('LeftMenu:btnComments').pressed, false, 'кнопка панели осталась нажатой');
            assert.equal(env.calls.filter(c => c.name === 'LeftMenu.onBtnMenuClick' && c.args[0] === 'btnComments').length, 2,
                'переключение мимо штатного onBtnMenuClick');
            /* No own state: the stock reason opened the panel, so the area is visible. */
            view.btnComments.toggle(true);
            view.onBtnMenuClick(view.btnComments);
            assert.ok(env.leftOpen(), 'область не следует штатной кнопке панели');
            /* The comment icon on a slide opens the panel. */
            view.btnComments.click();
            env.fire('asc_onShowComment', ['c1'], 10, 10);
            assert.ok(env.open(), 'значок комментария на слайде не открыл панель');
            /* Repeating on an already open panel does not close it. */
            env.fire('asc_onShowComment', ['c1'], 10, 10);
            assert.ok(env.open(), 'повторный показ комментария закрыл панель');
            noErrors(env);
        }
    },
    {
        name: 'add_comment_by_comment_right_without_edit_right',
        run() {
            for (const [who, opts] of [['с правом правки', {}], ['без права правки', {isEdit: false, canEdit: false}]]) {
                const env = makeEnv(opts).start();
                env.reset();
                const r = env.shell.command('addComment')();
                noErrors(env);
                assert.notEqual(r, false, who + ': addComment отказал при праве комментирования');
                assert.equal(env.count('Comments.addDummyComment'), 1, who + ': нет штатного добавления комментария');
                assert.equal(env.count('Comments.onAppAddComment'), 1, who + ': добавление мимо app:comment:add');
                assert.equal(env.count('ToolbarCtl.btnsComment.click'), opts.isEdit === false ? 0 : 1, who + ': двойник «Комментария» ленты');
                assert.ok(env.open(), who + ': панель комментариев не открыта после добавления');

                /* The stock context menu ("Add comment") also opens the panel. */
                env.view.btnComments.click();
                assert.ok(!env.open());
                env.commentsCtl.addDummyComment();
                assert.ok(env.open(), who + ': после «Добавить комментарий» правого щелчка панель не открыта');
            }
            /* Without the commenting right there is no adding. */
            const env = makeEnv({isEdit: false, canEdit: false, canComments: false}).start();
            env.reset();
            assert.equal(env.shell.command('addComment')(), false, 'addComment без права комментирования');
            assert.equal(env.count('Comments.addDummyComment'), 0, 'комментарий добавлен без права комментирования');
            /* A disabled twin (no slides, slide master): refusal without a bypass. */
            const env2 = makeEnv().start();
            env2.toolbarCtl.btnsComment[0].disabled = true;
            env2.reset();
            assert.equal(env2.shell.command('addComment')(), false, 'погашенный «Комментарий» ленты обойдён');
            assert.equal(env2.count('Comments.addDummyComment'), 0);
        }
    },
    {
        name: 'panel_requires_can_view_comments',
        run() {
            const env = makeEnv({canViewComments: false}).start();
            env.reset();
            env.view.showMenu('comments');
            env.fire('asc_onShowComment', ['c1'], 10, 10);
            assert.equal(env.shell.command('addComment')() !== false, true, 'добавление по праву комментирования отказало');
            noErrors(env);
            assert.equal(env.count('Comments.addDummyComment'), 1, 'нет штатного добавления комментария');
            assert.equal(env.view.btnComments.pressed, false, 'панель комментариев открыта без canViewComments');
            assert.equal(env.count('panelComments.show'), 0, 'панель комментариев показана без canViewComments');
            assert.equal(env.leftOpen(), false);

            /* The integrator hid the left menu: the area does not open. */
            const env2 = makeEnv().start();
            env2.ctx.Common.UI.LayoutManager.isElementVisible = name => name !== 'leftMenu';
            env2.view.showMenu('comments');
            assert.equal(env2.view.btnComments.pressed, false, 'панель открыта при спрятанном интегратором левом меню');
            /* A disabled stock button: not either. */
            const env3 = makeEnv().start();
            env3.view.btnComments.disabled = true;
            env3.view.showMenu('comments');
            assert.equal(env3.view.btnComments.pressed, false, 'панель открыта при погашенной штатной кнопке');
        }
    },
    {
        name: 'search_and_chat_commands_open_stock_panels',
        run() {
            const env = makeEnv().start();
            const {view, shell} = env;
            env.reset();
            shell.command('search')();
            noErrors(env);
            assert.equal(view.btnSearchBar.pressed, true, '«Поиск» не открыл штатную панель поиска');
            assert.equal(view.panelSearch.open, true, 'панель поиска не показана');
            assert.ok(env.calls.some(c => c.name === 'fireEvent' && c.args[0] === 'search:aftershow'), 'нет штатного search:aftershow');
            assert.ok(env.leftOpen(), 'область не показана для поиска');
            assert.equal(view.btnThumbs.pressed, true, 'поиск отжал ленту миниатюр');
            shell.command('search')();
            assert.equal(view.btnSearchBar.pressed, false, 'повторный «Поиск» не закрыл панель');
            assert.equal(env.leftOpen(), false);

            shell.command('chat')();
            assert.equal(view.btnChat.pressed, true, 'чат не открыт');
            assert.equal(view.panelChat.open, true, 'панель чата не показана');
            assert.ok(env.count('panelChat.focus') >= 1, 'фокус не в поле чата');
            /* Panels of one column exclude each other, as in stock. */
            shell.command('search')();
            assert.equal(view.btnChat.pressed, false, 'чат остался нажат при открытом поиске');
            assert.equal(view.btnSearchBar.pressed, true);
            shell.command('search')();
            assert.equal(env.leftOpen(), false);
            noErrors(env);
        }
    },
    {
        name: 'search_bar_toggles_from_the_search_button',
        run() {
            const env = makeEnv().start();
            const {shell, NC, viewportCtl, document} = env;
            const notes = [];
            NC.on('vo:search-bar', on => notes.push(on));
            env.reset();
            /* Magnifier: no bar, stock search:show, bar shown, magnifier pressed. */
            assert.equal(shell.command('searchBar')(), true);
            noErrors(env);
            assert.ok(viewportCtl.isSearchBarVisible(), 'лупа не показала штатную строку поиска');
            assert.equal(env.count('searchBar.show'), 1, 'строка показана не штатным путём');
            assert.equal(notes[notes.length - 1], true, 'нет уведомления о видимой строке (лупа не нажата)');
            /* Position: under the magnifier and 8 below the panel card. */
            const st = document.body.style;
            assert.equal(st.getPropertyValue('--vo-search-left'), '102px', 'строка не под лупой');
            assert.equal(st.getPropertyValue('--vo-search-top'), '132px', 'строка не на 8 ниже карточки панели');
            /* Repeat: close, magnifier released. */
            shell.command('searchBar')();
            assert.equal(viewportCtl.isSearchBarVisible(), false, 'повторная лупа не закрыла строку');
            assert.equal(notes[notes.length - 1], false, 'нет уведомления о скрытой строке (лупа осталась нажатой)');
            /* Closed with its own cross or Esc: also a notification. */
            shell.command('searchBar')();
            viewportCtl.searchBar.hide();
            assert.equal(notes[notes.length - 1], false, 'строка закрыта штатно, а лупа нажата');
            /* A click outside the bar closes it; a click on the bar or on the magnifier does not. */
            shell.command('searchBar')();
            const inside = {closest: sel => (sel === '.asc-window.search-bar' ? {} : null)};
            env.pointerdown(inside);
            assert.ok(viewportCtl.isSearchBarVisible(), 'щелчок по строке её закрыл');
            const onLupa = {closest: sel => (sel === '#vo-tb [data-vo="search"]' ? {} : null)};
            env.pointerdown(onLupa);
            assert.ok(viewportCtl.isSearchBarVisible(), 'нажатие на лупу закрыло строку раньше её команды');
            env.pointerdown({closest: () => null});
            assert.equal(viewportCtl.isSearchBarVisible(), false, 'щелчок мимо строки её не закрыл');
            /* Without a magnifier and a card: at the left margin under the shell rows. */
            env.lupas.length = 0;
            env.nodes['vo-toolbar'].rect = null;
            env.nodes['vo-shell'].rect = {left: 0, top: 0, width: 1440, height: 76};
            shell.command('searchBar')();
            assert.equal(st.getPropertyValue('--vo-search-left'), '', 'без лупы осталось её место');
            assert.equal(st.getPropertyValue('--vo-search-top'), '84px', 'без карточки строка не под рядами оболочки');
            /* The left search panel is open: stock gives focus to it, there is no bar. */
            viewportCtl.searchBar.hide();
            shell.command('search')();
            env.reset();
            shell.command('searchBar')();
            assert.equal(viewportCtl.isSearchBarVisible(), false, 'при открытой панели поиска показана и строка');
            assert.equal(env.count('panelSearch.focus'), 1, 'фокус не отдан панели поиска');
            noErrors(env);
        }
    },
    {
        name: 'search_bar_and_icons_off_in_stock_interface',
        run() {
            const env = makeEnv().start();
            const {shell, viewportCtl, document} = env;
            const root = document.documentElement.style;
            assert.equal(root.getPropertyValue('--vo-ar-ico-chevron'),
                'url(http://stand.test/web-apps/apps/common/main/resources/img/air/chevron.svg)', 'нет адреса значка общего набора от документа');
            shell.command('searchBar')();
            shell.toggleMode();
            noErrors(env);
            assert.equal(Object.keys(root.props).filter(k => k.indexOf('--vo-ar-ico-') === 0).length, 0, 'значки областей остались в «Штатном интерфейсе»');
            /* In the "Stock interface" a click outside is stock: the bar stays. */
            env.pointerdown({closest: () => null});
            assert.ok(viewportCtl.isSearchBarVisible(), 'в «Штатном интерфейсе» оболочка закрыла строку поиска');
            layoutChanged(env);
            assert.equal(document.body.style.getPropertyValue('--vo-search-left'), '', 'место строки осталось в «Штатном интерфейсе»');
            shell.toggleMode();
            assert.ok(root.getPropertyValue('--vo-ar-ico-close'), 'после возврата значков нет');
            noErrors(env);
        }
    },
    {
        name: 'show_menu_restored_on_advanced',
        run() {
            const env = makeEnv().start();
            const {view, shell, commentsCtl} = env;
            assert.ok(Object.prototype.hasOwnProperty.call(view, 'showMenu'), 'showMenu вида не подменён в компакте');
            view.showMenu('comments');
            assert.ok(env.leftOpen());

            shell.toggleMode();
            noErrors(env);
            assert.equal(Object.prototype.hasOwnProperty.call(view, 'showMenu'), false, 'в «Штатном интерфейсе» осталась подмена showMenu');
            for (const b of ['btnThumbs', 'btnComments', 'btnChat', 'btnSearchBar'])
                assert.equal(Object.prototype.hasOwnProperty.call(view[b], 'toggle'), false, 'в «Штатном интерфейсе» осталась подмена ' + b + '.toggle');
            assert.equal(Object.prototype.hasOwnProperty.call(commentsCtl, 'addDummyComment'), true);
            assert.equal(commentsCtl.addDummyComment.toString().indexOf('log(') >= 0, true, 'addDummyComment не вернулся штатным');
            assert.equal(env.leftOpen(), false, 'класс левой области остался в «Штатном интерфейсе»');

            /* Stock showMenu: the icon column is visible, stock decides on its own. */
            view.btnComments.click();
            env.reset();
            view.showMenu('comments');
            assert.equal(env.count('LeftMenu.onBtnMenuClick'), 0, 'в «Штатном интерфейсе» оболочка открывает панель сама');

            shell.toggleMode();
            assert.ok(Object.prototype.hasOwnProperty.call(view, 'showMenu'), 'после возврата подмена showMenu не встала');
            view.showMenu('comments');
            assert.ok(env.open() && env.leftOpen(), 'после возврата панель не открывается');
            noErrors(env);
        }
    },
    {
        name: 'comment_cards_on_the_window_kit',
        async run() {
            /* The comment card is one in the panel list and in the popup card on a slide:
               radius 12 without the stock border and shadow, avatar 28, AIR edit icons, the reply field is
               the kit's multi-line input field, the main button is the kit's filled one. The popup
               card is a shell surface (radius 12, shadow). */
            const rules = await areaRules();
            const val = (sel, prop) => {
                let v = null;
                for (const r of rules) if (r.sels.includes(sel)) for (const [p, x] of r.decls) if (p === prop) v = x;
                return v;
            };
            for (const root of ['body.vo-compact #comments-box .dataview-ct', 'body.vo-compact .asc-window:has(#id-popover) #id-popover .dataview-ct']) {
                assert.equal(val(root + ' .color', 'width'), '28px', root + ': the avatar is not 28');
                assert.equal(val(root + ' .btn-edit-common::after', 'mask-image').indexOf('--vo-ar-ico-pencil') >= 0, true, root + ': edit is not an AIR icon');
                assert.ok((val(root + ' .btn-delete::after', 'mask-image') || '').indexOf('--vo-ar-ico-trash') >= 0, root + ': delete is not an AIR icon');
                assert.equal(val(root + ' .reply-ct textarea', 'border-radius'), '8px', root + ': the reply field is not the kit field');
                assert.equal(val(root + ' .reply-ct .btn.dlg-btn.primary', 'background'), 'var(--vo-accent)', root + ': the reply button is not filled');
                assert.equal(val(root + ' .user-reply', 'border'), 'none', root + ': «Add reply» keeps the dotted line');
            }
            assert.equal(val('body.vo-compact #comments-box .dataview-ct .user-comment-item', 'border-radius'), '12px', 'the list card radius is not 12');
            assert.equal(val('body.vo-compact .asc-window:has(#id-popover)', 'border-radius'), '12px', 'the card on the slide is not an AIR popup');
            assert.equal(val('body.vo-compact .asc-window:has(#id-popover)', 'box-shadow'), 'var(--vo-shadow)', 'the card on the slide has no popup shadow');
        }
    },
    {
        name: 'show_controls_are_an_air_card',
        async run() {
            /* The slideshow control panel is an AIR card in the bottom left corner (margin 16, radius 12,
               shadow), 32 icon buttons with AIR icons by the stock icon classes. */
            const rules = await areaRules();
            const val = (sel, prop) => {
                let v = null;
                for (const r of rules) if (r.sels.includes(sel)) for (const [p, x] of r.decls) if (p === prop) v = x;
                return v;
            };
            const P = 'body.vo-compact #pe-preview .preview-controls';
            assert.equal(val(P, 'border-radius'), '12px', 'the show controls are not an AIR card');
            assert.equal(val(P, 'left'), '16px');
            assert.equal(val(P, 'bottom'), '16px');
            assert.equal(val(P, 'box-shadow'), 'var(--vo-shadow)', 'the show controls have no card shadow');
            assert.equal(val(P + ' .btn-toolbar', 'width'), '32px', 'the show buttons are not 32');
            for (const [cls, ico] of [['btn-previtem', 'chevronL'], ['btn-nextitem', 'chevronR'], ['btn-play', 'play'],
                                      ['btn-preview-pause', 'pause'], ['btn-pen-tool', 'pencil'], ['btn-fullscreen', 'focus'], ['btn-close', 'close']]) {
                assert.ok((val(P + ' .btn-toolbar .icon.' + cls, 'mask-image') || '').indexOf('--vo-ar-ico-' + ico) >= 0, cls + ' is not the AIR ' + ico);
            }
            assert.ok(/system-ui/.test(val(P + ' #preview-label-slides', 'font-family') || ''), 'the slide counter is not in the shell font');
        }
    },
    {
        name: 'slide_buttons_and_tips_on_the_kit',
        async run() {
            /* "Paste options" and the chart elements button are a 28 button on a white plate with
               radius 8, AIR icons, the arrow is an AIR chevron; their menu is a 12 card in the shell
               font. The co-author label is a badge in the shell font; the hint at a link is
               a white 8 card with a shadow, other stock hints are untouched. */
            const rules = await areaRules();
            const val = (sel, prop) => {
                let v = null;
                for (const r of rules) if (r.sels.includes(sel)) for (const [p, x] of r.decls) if (p === prop) v = x;
                return v;
            };
            for (const id of ['#special-paste-container', '#chart-element-container']) {
                const C = 'body.vo-compact ' + id;
                assert.equal(val(C, 'border-radius'), '8px', id + ' is not rounded 8');
                assert.equal(val(C + ' .btn-toolbar', 'height'), '28px', id + ': the button is not 28');
                assert.ok((val(C + ' .btn-toolbar .caret', 'mask-image') || '').indexOf('--vo-ar-ico-chevron') >= 0, id + ': the caret is not the AIR chevron');
                assert.equal(val(C + ' .dropdown-menu', 'border-radius'), '12px', id + ': the menu is not an AIR card');
                assert.ok(/system-ui/.test(val(C + ' .dropdown-menu', 'font-family') || ''), id + ': the menu is not in the shell font');
            }
            assert.ok((val('body.vo-compact #special-paste-container .btn-toolbar .icon.btn-paste', 'mask-image') || '').indexOf('--vo-ar-ico-paste') >= 0,
                'the paste options icon is not the AIR paste');
            assert.ok((val('body.vo-compact #chart-element-container .btn-toolbar .icon.btn-chart-elements', 'mask-image') || '').indexOf('--vo-ar-ico-chart') >= 0,
                'the chart elements icon is not the AIR chart');
            assert.ok(/system-ui/.test(val('body.vo-compact .username-tip', 'font-family') || ''), 'the co-author tip is not in the shell font');
            const tip = 'body.vo-compact .tooltip:has(> .tooltip-inner > b) .tooltip-inner';
            assert.equal(val(tip, 'border-radius'), '8px', 'the link tip is not an AIR popup');
            assert.equal(val(tip, 'box-shadow'), 'var(--vo-shadow)');
            assert.deepEqual(rules.filter(r => r.sels.some(s => /\.tooltip\b/.test(s) && s.indexOf('.tooltip:has(> .tooltip-inner > b)') < 0))
                .map(r => r.sels.join()), [], 'the area styles restyle stock tooltips other than the link tip');
        }
    },
    {
        name: 'area_icons_are_painted_by_the_module',
        async run() {
            /* Every icon that the area styles take from --vo-ar-ico-<name> is set by the module
               (otherwise the mask is empty and the icon is not visible), and each is a file of the editors' shared AIR set. */
            const css = (await areaRules()).map(r => r.decls.map(d => d[1]).join(';')).join(';');
            const used = [...new Set((css.match(/--vo-ar-ico-[A-Za-z]+/g) || []).map(v => v.slice('--vo-ar-ico-'.length)))];
            const env = makeEnv();
            const icons = Array.from(env.Left.ICONS || []);
            assert.ok(used.length > 0, 'no AIR icons in the area styles');
            assert.deepEqual(used.filter(n => icons.indexOf(n) < 0), [], 'icons used by the styles but not painted by CompactLeft');
            const dir = path.join(ROOT, 'apps/common/main/resources/img/air');
            assert.deepEqual(icons.filter(n => !fs.existsSync(path.join(dir, n + '.svg'))), [], 'painted icons without an AIR file');
        }
    },
    {
        name: 'history_panel_ends_above_status_bar',
        async run() {
            /* Version history is a stock layout column (#left-panel-history with its own
               divider), stock height 100%. The shell status bar lies over the
               workspace, so every condition under which the left menu ends above
               it must also raise the history column, otherwise the bottom of the version list is under the
               status bar. */
            const rules = await areaRules();
            const last = (sel, prop) => {
                let v = null;
                for (const r of rules) if (r.sels.includes(sel)) for (const [p, x] of r.decls) if (p === prop) v = x;
                return v;
            };
            const menus = [];
            for (const r of rules) for (const s of r.sels) {
                const m = /^(.*\bvo-compact\b.*) #left-menu$/.exec(s);
                if (m && last(s, 'bottom') !== null && !menus.includes(m[1])) menus.push(m[1]);
            }
            assert.ok(menus.length > 0, 'the left menu does not end above the status bar in the shell');
            for (const pre of menus) {
                const bottom = last(pre + ' #left-menu', 'bottom');
                assert.ok(!/^0(px)?$/.test(bottom), 'zero bottom of the left menu under ' + pre);
                for (const col of ['#left-panel-history', '#left-panel-history + .layout-resizer']) {
                    assert.equal(last(pre + ' ' + col, 'bottom'), bottom, col + ' does not end above the status bar like #left-menu under ' + pre);
                    assert.equal(last(pre + ' ' + col, 'height'), 'auto', col + ' keeps the stock height under ' + pre);
                }
            }
        }
    }
];

(async () => {
    let failed = 0;
    const only = process.argv.indexOf('--only') >= 0 ? process.argv[process.argv.indexOf('--only') + 1] : null;
    for (const t of tests) {
        if (only && t.name !== only) continue;
        try {
            await t.run();
            console.log('ok ' + t.name);
        } catch (e) {
            failed++;
            console.log('FAIL ' + t.name + ': ' + (e && e.message || e));
        }
    }
    console.log((tests.length - failed) + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
