/* Run: node test/unit-tests/spreadsheeteditor/compact-shell-gate.cjs [CompactShell.js] [index.html.deploy]
 * The gate of the spreadsheet editor "Compact" shell and the early start (modeled on
 * test/unit-tests/documenteditor/compact-shell-gate.cjs): enabling strictly by
 * editorConfig.ui.shell === 'modern', the vo-boot claim class with Gateway init, the height
 * skeleton on app:face, a start with retries and a fail-safe, the loading skeleton of
 * index.html.deploy (the shell skeleton for every spreadsheet but nested editors). The
 * module is loaded in node via vm on top of a fake stock, anew for each case (the
 * guarded journal writes each place once per module life). In the start
 * cases create() is replaced: the start() cycle is checked, not the build - the build and the hand-over
 * of the skeleton by the real create() are covered by compact-shell-core.cjs.
 * The arguments are broken copies for the negative control: a copy with wanted() by
 * ui.mode must fail the first case, the index.html.deploy of the base (the neutral stock
 * skeleton) - the skeleton case.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const MAIN_DIR = path.join(ROOT, 'apps/spreadsheeteditor/main');
const SHELL_FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(MAIN_DIR, 'app/view/CompactShell.js');
const DEPLOY_FILE = process.argv[3] ? path.resolve(process.argv[3]) : path.join(MAIN_DIR, 'index.html.deploy');
const SHELL_SRC = fs.readFileSync(SHELL_FILE, 'utf8');

/* --- Fake stock ------------------------------------------------------------ */
/* The spreadsheet editor vertical layout: title (#app-title), toolbar (#toolbar), the middle,
   statusbar (the sheet row). The area has two heights: height is the model, dom is what
   the last doLayout wrote to the node (as VBoxLayout.doLayout: el.css from the model). */
const STOCK = {title: 28, toolbar: 92, statusbar: 25};

let env = null;

function fresh(editorConfig, appOptions = {isEdit: true}, opt = {}) {
    const classes = new Set();
    const handlers = {};
    const timers = [];
    const warnings = [];
    const items = [
        {alias: 'title', height: STOCK.title, dom: STOCK.title},
        {alias: 'toolbar', height: STOCK.toolbar, dom: STOCK.toolbar},
        {stretch: true},
        {alias: 'statusbar', height: STOCK.statusbar, dom: STOCK.statusbar}
    ];
    const vlayout = {
        layouts: 0,
        getItem(alias) { return items.find(p => p.alias === alias); },
        doLayout() { this.layouts++; items.forEach(p => { if (p.alias) p.dom = p.height; }); }
    };
    const state = {main: {editorConfig, appOptions}, shellNode: null, controllerThrows: false, mask: null, api: null};
    const SSE = {
        Views: {},
        getController(name) {
            if (state.controllerThrows) throw new Error('controller is not built yet');
            if (name === 'Main') return state.main;
            if (name === 'Viewport') return {viewport: {vlayout, hlayout: {doLayout() {}}, celayout: {doLayout() {}}}, getApi: () => state.api};
            return null;
        }
    };
    const context = {
        SSE,
        document: {
            body: {classList: {
                add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
                toggle: (c, on) => ((on === undefined ? !classes.has(c) : on) ? classes.add(c) : classes.delete(c))
            }},
            getElementById: id => (id === 'vo-shell' ? state.shellNode : state.mask && state.mask.id === id ? state.mask : null)
        },
        setTimeout: (fn, ms) => { timers.push({fn, ms}); return timers.length; },
        clearTimeout() {},
        console: {warn: (...a) => warnings.push(a), log() {}, error() {}},
        Event: class { constructor(type) { this.type = type; } },
        dispatchEvent: () => true,
        _: {extend: Object.assign},
        Common: {NotificationCenter: {
            on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); },
            off: () => {},
            trigger: () => {}
        },
        /* The stock "View → Formula bar" key of the Standard: true - the bar is hidden. */
        localStorage: {getBool: key => key === 'sse-hidden-formula' && !!opt.formulaHidden}},
        /* The module dependencies (Icons, FormulaBar) are not needed by the build: create() is replaced. The formula
           bar in the built card is collapsed, 36 (the shell asks FormulaBar for its height). */
        define: (deps, factory) => factory({svg: () => ''}, {apply() {}, release() {}, dispose() {}, giveBack() {},
                                                             owns: () => false, plateRowHeight: () => 36})
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(SHELL_SRC, context, {filename: SHELL_FILE});
    if (opt.controllerThrows) state.controllerThrows = true;
    env = {shell: SSE.Views.CompactShell, classes, handlers, timers, warnings, vlayout, state,
           item: alias => items.find(p => p.alias === alias)};
    return env.shell;
}

/* The loading skeleton from index.html: the #loading-mask node the stock code removes by id. */
function mask() {
    const node = {id: 'loading-mask', removed: false};
    node.parentNode = {removeChild: n => { n.removed = true; if (env.state.mask === n) env.state.mask = null; }};
    return env.state.mask = node;
}
/* The engine api of Viewport.getApi: only the error subscription is needed. */
function engine() {
    const errors = [];
    env.state.api = {asc_registerCallback: (name, fn) => { if (name === 'asc_onError') errors.push(fn); }};
    return (...args) => errors.slice().forEach(f => f(...args));
}

const heights = () => ({title: env.item('title').height, toolbar: env.item('toolbar').height,
                        statusbar: env.item('statusbar').height});
const boot = () => env.classes.has('vo-boot');
/* app:face as in the stock: the argument is the Main appOptions (onEditorPermissions / onApplyEditRights). */
const face = (...args) => (env.handlers['app:face'] || []).forEach(fn => fn(...args));
function drain() { let n = 0; while (env.timers.length && n++ < 100) env.timers.shift().fn(); }
/* The start as controller/Viewport.js does it on app:ready, with a replaced build. */
function run(create) {
    let calls = 0;
    env.shell.create = function () { calls++; return create.call(this, calls); };
    env.shell.start();
    drain();
    return calls;
}

/* The full shell height is the sum of its rows, as shellHeight() will count it when
   the rows are built (header, menu row and the card with the panel and the collapsed formula bar): the skeleton
   must take exactly that much, otherwise the skeleton hand-over ("#toolbar 168 without a jump") will shift the
   canvas. The number of rows is held by compact-parity.cjs. */
function fullShellHeight(shell) {
    const saved = shell.rows;
    const row = () => ({parentNode: {}, classList: {contains: () => false}});
    shell.rows = {header: row(), menu: row(), plate: row(), toolbar: row()};
    try { return shell.shellHeight(); } finally { shell.rows = saved; }
}

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, '—', error && error.message);
        failed++;
    }
}

const SHELL = {ui: {shell: 'modern'}};

/* --- Gate -------------------------------------------------------------------- */

test('gate_ui_shell_enables_ui_mode_alone_does_not', () => {
    assert.equal(fresh(SHELL).wanted(), true, 'ui.shell = modern');
    assert.equal(fresh({ui: {shell: 'modern', mode: 'compact'}}).wanted(), true, 'ui.shell together with ui.mode');
    assert.equal(fresh({ui: {mode: 'compact'}}).wanted(), false, 'ui.mode = compact alone');
    assert.equal(fresh({ui: {mode: 'compact'}, customization: {compactToolbar: true, compactHeader: true}}).wanted(),
        false, 'ui.mode with the stock compact flags');
    assert.equal(fresh({}).wanted(), false, 'no ui');
    assert.equal(fresh(undefined).wanted(), false, 'no editorConfig');
});

test('gate_foreign_values_keep_stock', () => {
    ['Modern', 'MODERN', ' modern', 'modern ', 'compact', 'standard', '', null, undefined, true, 1, {}]
        .forEach(v => assert.equal(fresh({ui: {shell: v}}).wanted(), false, 'ui.shell ' + JSON.stringify(v)));
    assert.equal(fresh({ui: 'modern'}).wanted(), false, 'ui as a string');
    assert.equal(fresh({shell: 'modern'}).wanted(), false, 'shell outside ui');
    assert.equal(fresh({get ui() { throw new Error('broken config'); }}).wanted(), false, 'reading ui throws');
    assert.equal(fresh(SHELL, undefined, {controllerThrows: true}).wanted(), false, 'getController throws');
    const shell = fresh(SHELL);
    env.state.main = undefined;
    assert.equal(shell.wanted(), false, 'no Main controller');
    env.state.main = {editorConfig: SHELL};
    shell.startupFailed = true;
    assert.equal(shell.wanted(), false, 'gate is open after a startup failure');
});

test('gate_reads_init_config_before_main', () => {
    /* On Gateway init Main has not yet moved the config into editorConfig. */
    const shell = fresh({});
    assert.equal(shell.wanted(SHELL), true, 'init config with ui.shell');
    assert.equal(shell.wanted({ui: {mode: 'compact'}}), false, 'init config with ui.mode only');
    assert.equal(shell.wanted(null), false, 'empty init config');
    fresh(SHELL);
    assert.equal(env.shell.wanted({}), false, 'an explicit config is the answer, Main is not asked');
    assert.equal(env.shell.wanted(), true, 'without an argument Main.editorConfig is read');
});

/* --- Claim and skeleton ------------------------------------------------------- */

test('announce_sets_boot_class_once', () => {
    const shell = fresh({});
    shell.announce({ui: {mode: 'compact'}});
    assert.equal(boot(), false, 'request class for ui.mode alone');
    assert.equal((env.handlers['app:face'] || []).length, 0, 'app:face subscription without ui.shell');
    shell.announce(undefined);
    assert.equal(boot(), false, 'request class without a config');
    shell.announce(SHELL);
    shell.announce(SHELL);
    assert.equal(boot(), true, 'no request class for ui.shell');
    assert.equal(env.handlers['app:face'].length, 1, 'repeated init doubled the app:face subscription');
    assert.deepEqual(heights(), STOCK, 'heights changed before app:face');

    /* A repeated init after the shell is built does not set the claim. */
    fresh(SHELL);
    env.state.shellNode = {};
    env.shell.announce(SHELL);
    assert.equal(boot(), false, 'request class over a built shell');
});

test('skeleton_heights_on_app_face_stock_back_on_end_boot', () => {
    const shell = fresh(SHELL);
    shell.announce(SHELL);
    const layouts = env.vlayout.layouts;
    face({isEdit: true});
    const full = fullShellHeight(shell);
    assert.equal(full, 168, 'full shell height: header, menu and the plate with the toolbar and the formula row');
    assert.equal(heights().toolbar, full, 'skeleton is not the full shell height');
    assert.equal(env.item('toolbar').dom, full, 'skeleton height is not laid out');
    assert.equal(heights().title, STOCK.title, 'title model touched: the request class hides it');
    assert.equal(heights().statusbar, STOCK.statusbar, 'sheet tabs row touched: it stays stock');
    assert.ok(env.vlayout.layouts > layouts, 'no relayout after the skeleton heights');

    /* A repeated app:face (the stock calls it from onApplyEditRights too) does not re-capture the skeleton. */
    face({isEdit: true});
    shell.endBoot(true);
    assert.equal(boot(), false, 'request class left after endBoot');
    assert.deepEqual(heights(), STOCK, 'stock heights are not back');
    assert.equal(env.item('toolbar').dom, STOCK.toolbar, 'stock height is not laid out');
});

/* The formula bar was hidden in the Standard (sse-hidden-formula): for an editor the skeleton card is one panel,
   46 + 30 + 4 + 44 + 8 = 132; for a reader the stock does not read the key - the bar is there. */
test('skeleton_without_formula_row_hidden_in_advanced', () => {
    fresh(SHELL, {isEdit: true}, {formulaHidden: true});
    env.shell.announce(SHELL);
    face({isEdit: true});
    assert.equal(heights().toolbar, 132, 'editor skeleton without the hidden formula row');
    assert.equal(env.classes.has('vo-boot-no-fx'), true, 'skeleton plate draws the hidden formula row');
    assert.equal(env.classes.has('vo-boot-no-tb'), false, 'editor skeleton plate lost the toolbar row');
    env.shell.endBoot(true);
    assert.equal(env.classes.has('vo-boot-no-fx'), false, 'skeleton plate class left after endBoot');
    fresh(SHELL, {isEdit: false}, {formulaHidden: true});
    env.shell.announce(SHELL);
    face({isEdit: false});
    assert.equal(heights().toolbar, 124, 'reader skeleton follows the key the stock reads only for the editor');
});

/* A reader: there is no panel - the skeleton card has one formula bar, 46 + 30 + 4 + 36 + 8 = 124; the class
   of the skeleton without the panel row (compact-shell.less cuts the skeleton card down to the formula bar). */
test('skeleton_reader_gets_header_menu_and_formula_row', () => {
    fresh(SHELL, {isEdit: false});
    env.shell.announce(SHELL);
    face({isEdit: false});
    assert.equal(heights().toolbar, 124, 'reader skeleton is header + menu + the plate with the formula row');
    assert.equal(env.classes.has('vo-boot-no-tb'), true, 'reader skeleton plate has no toolbar row');
    assert.equal(env.classes.has('vo-boot-no-fx'), false, 'reader skeleton plate lost the formula row');
    env.shell.endBoot(true);
    assert.equal(env.classes.has('vo-boot-no-tb'), false, 'skeleton plate class left after endBoot');
    /* Without an app:face argument - the appOptions of the standard Main. */
    fresh(SHELL, {isEdit: false});
    env.shell.announce(SHELL);
    face();
    assert.equal(heights().toolbar, 124, 'reader skeleton from Main.appOptions');
    fresh(SHELL, {isEdit: true});
    env.shell.announce(SHELL);
    face();
    assert.equal(heights().toolbar, fullShellHeight(env.shell), 'editor skeleton from Main.appOptions');
});

test('skeleton_fresher_stock_height_kept', () => {
    const shell = fresh(SHELL);
    shell.announce(SHELL);
    face({isEdit: true});
    env.item('toolbar').height = 64;       // the stock managed to relocate the area: theme change, view:compact
    shell.endBoot(true);
    assert.equal(heights().toolbar, 64, 'fresher stock height overwritten by the snapshot');
    assert.equal(env.item('toolbar').dom, 64);
    assert.equal(boot(), false);
});

test('handover_restores_model_only', () => {
    const shell = fresh(SHELL);
    shell.announce(SHELL);
    face({isEdit: true});
    const skeleton = env.item('toolbar').dom;
    const layouts = env.vlayout.layouts;
    shell.endBoot(false);
    assert.equal(boot(), false, 'request class left after the hand-over');
    assert.deepEqual(heights(), STOCK, 'model is not stock after the hand-over');
    assert.equal(env.item('toolbar').dom, skeleton, 'DOM left the skeleton height before applyLayout');
    assert.equal(env.vlayout.layouts, layouts, 'hand-over relaid the layout');
    shell.endBoot(true);                  // the claim is gone - a repeat does nothing
    assert.equal(env.vlayout.layouts, layouts, 'second endBoot relaid the layout');
});

test('loading_skeleton_kept_under_another_id_until_end_boot', () => {
    fresh({ui: {mode: 'compact'}});
    const stock = mask();
    env.shell.announce({ui: {mode: 'compact'}});
    assert.equal(stock.id, 'loading-mask', 'without the shell the stock removes it as before');

    fresh(SHELL);
    const held = mask();
    env.shell.announce(SHELL);
    assert.equal(held.id, 'vo-loading', 'the skeleton keeps the stock id');
    face({isEdit: true});
    assert.equal(held.removed, false, 'app:face took the skeleton');
    env.shell.endBoot(false);
    assert.equal(held.removed, true, 'the hand-over frame left the skeleton');

    fresh(SHELL);
    const failed = mask();
    env.shell.announce(SHELL);
    env.shell.endBoot(true);
    assert.equal(failed.removed, true, 'the fail-safe left the skeleton');

    fresh(SHELL);
    env.shell.announce(SHELL);
    assert.doesNotThrow(() => env.shell.endBoot(true), 'no skeleton on the page');
});

/* An opening error arrives before app:ready, and no app:ready follows it: the error itself
   has to remove the skeleton and the claim, otherwise the stock window hangs over the
   skeleton and the loading band keeps running after OK. */
test('loading_skeleton_opening_error_before_the_shell_takes_it_and_the_claim', () => {
    fresh(SHELL);
    const fire = engine();
    const late = mask();
    env.shell.announce(SHELL);
    face({isEdit: true});
    assert.notEqual(heights().toolbar, STOCK.toolbar, 'the skeleton heights are not on');
    fire(-4, 2);
    assert.equal(late.removed, true, 'the skeleton stays under the error window');
    assert.equal(boot(), false, 'the claim stays under the error window');
    assert.deepEqual(heights(), STOCK, 'stock heights are not back');
    assert.doesNotThrow(() => fire(-4, 2), 'a second error throws');

    fresh(SHELL);
    const fireEarly = engine();
    const early = mask();
    env.shell.announce(SHELL);
    fireEarly(-4, 2);
    assert.equal(early.removed, true, 'an error before app:face left the skeleton');
    face({isEdit: true});
    assert.deepEqual(heights(), STOCK, 'a late app:face laid out the skeleton again');

    fresh(SHELL);
    const fireAfter = engine();
    env.shell.announce(SHELL);
    face({isEdit: true});
    env.shell.endBoot(false);
    env.classes.add('vo-compact');
    fireAfter(-4, 2);
    assert.equal(env.classes.has('vo-compact'), true, 'after the build errors are the stock business');

    fresh(SHELL);
    env.state.api = {Resize() {}};
    assert.doesNotThrow(() => env.shell.announce(SHELL), 'an engine without callbacks');
    assert.equal(boot(), true);
});

/* --- Start --------------------------------------------------------------------- */

test('start_without_ui_shell_never_creates', () => {
    const shell = fresh({ui: {mode: 'compact'}});
    shell.announce({ui: {mode: 'compact'}});
    face({isEdit: true});
    assert.equal(run(() => shell), 0, 'create() called without ui.shell');
    assert.equal(boot(), false, 'request class without ui.shell');
    assert.deepEqual(heights(), STOCK);
    assert.deepEqual(env.warnings, [], 'warnings without ui.shell');
    fresh({});
    assert.equal(run(() => env.shell), 0, 'create() called without ui');
});

test('start_twenty_attempts_then_stock', () => {
    const shell = fresh(SHELL);
    shell.announce(SHELL);
    face({isEdit: true});
    const steps = [];
    const timers = env.timers;
    const push = timers.push.bind(timers);
    timers.push = t => { steps.push(t.ms); return push(t); };
    assert.equal(run(() => shell), 20, 'attempts');
    assert.ok(steps.every(ms => ms === 150), 'attempt step is not 150 ms: ' + steps.join(','));
    assert.equal(boot(), false, 'request class left after the attempts ran out');
    assert.deepEqual(heights(), STOCK, 'stock heights are not back');
    assert.equal(env.item('toolbar').dom, STOCK.toolbar, 'stock height is not laid out');
    assert.deepEqual(env.warnings, [], 'running out of attempts is not a failure');
});

test('start_failure_contained_not_retried', () => {
    let shell = fresh(SHELL);
    shell.announce(SHELL);
    face({isEdit: true});
    let calls;
    assert.doesNotThrow(() => { calls = run(() => { throw new Error('create failed'); }); }, 'failure escaped to app:ready');
    assert.equal(calls, 1, 'a failed create() was retried');
    assert.equal(boot(), false, 'request class left after the failure');
    assert.deepEqual(heights(), STOCK, 'stock heights are not back');
    assert.equal(env.item('toolbar').dom, STOCK.toolbar);
    assert.equal(env.warnings.length, 1, 'the failure is reported once');

    /* A failure after the skeleton hand-over (endBoot(false) already happened): the model is standard, the DOM has
       the skeleton, and start() must lay out the standard model again. */
    shell = fresh(SHELL);
    shell.announce(SHELL);
    face({isEdit: true});
    const layouts = env.vlayout.layouts;
    assert.equal(run(function () { this.endBoot(false); throw new Error('snapshot failed'); }), 1);
    assert.ok(env.vlayout.layouts > layouts, 'stock layout not laid out after a failure past the hand-over');
    assert.equal(env.item('toolbar').dom, STOCK.toolbar, 'DOM kept the skeleton after the failure');

    /* The gate is protected too: its exception does not go to app:ready, and the claim
       is removed - the standard interface does not stay hidden. */
    shell = fresh(SHELL);
    shell.announce(SHELL);
    face({isEdit: true});
    shell.wanted = () => { throw new Error('gate failed'); };
    assert.doesNotThrow(() => { calls = run(() => shell); }, 'gate failure escaped to app:ready');
    assert.equal(calls, 0, 'create() called after a gate failure');
    assert.equal(env.warnings.length, 1, 'gate failure is not reported');
    assert.equal(boot(), false, 'request class left after a gate failure');
    assert.deepEqual(heights(), STOCK, 'stock heights are not back after a gate failure');
});

test('start_success_on_third_attempt', () => {
    const shell = fresh(SHELL);
    shell.announce(SHELL);
    face({isEdit: true});
    const calls = run(function (n) {
        if (n < 3) return shell;                      // the ribbon is not drawn yet
        this.endBoot(false);
        env.state.shellNode = {};
        return shell;
    });
    assert.equal(calls, 3, 'attempts');
    assert.equal(boot(), false, 'request class left after the shell is built');
    assert.equal(env.timers.length, 0, 'attempts go on after success');
    assert.deepEqual(env.warnings, []);
});

/* --- Loading skeleton of index.html.deploy --------------------------------------- */
/* The inline script of the built page lays out the loading mask by the URL. There is
   no config (and so no ui.shell) at this step yet, so every spreadsheet starts with the
   shell skeleton (class sk-shell in the markup), and the stock silhouettes under it are
   hidden by the sk-shell rules; nested editors (internal=true) get the stock skeleton.
   The script itself is taken from the file and runs as is; the DOM is mask node stubs.
   The parity with index.html is held by compact-loading-skeleton.cjs. */
function skeletonScript(file) {
    const html = fs.readFileSync(file, 'utf8');
    const found = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
        .filter(s => s.indexOf("document.querySelector('.placeholder').style.display = 'block'") >= 0);
    assert.equal(found.length, 1, 'skeleton script not found once in ' + path.basename(file));
    return {html, src: found[0]};
}

function runSkeleton(src, params) {
    const classes = new Set(['loadmask', 'sk-shell']);
    const node = () => ({style: {display: 'none'}, classList: {add() {}}, parentNode: {removeChild() {}}});
    const mask = {style: {}, classList: {add: c => classes.add(c), remove: c => classes.delete(c)}};
    const sandbox = {
        getUrlParams: () => Object.assign({}, params),
        checkLocalStorage: false,
        localStorage: {getItem: () => null},
        stopLoading: false,
        document: {
            querySelector: node,
            querySelectorAll: () => [],
            getElementById: id => (id === 'loading-mask' ? mask : node()),
            body: {classList: {contains: () => false, add() {}}, removeChild() {}}
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, {filename: path.basename(DEPLOY_FILE)});
    return classes;
}

test('deploy_skeleton_is_the_shell_skeleton_but_for_nested_editors', () => {
    const {html, src} = skeletonScript(DEPLOY_FILE);
    assert.match(html, /<div id="loading-mask" class="loadmask sk-shell">/, 'the mask does not start with the shell skeleton');
    ['.brendpanel', '.sktoolbar', '.skformula', '.placeholder'].forEach(sel =>
        assert.ok(html.indexOf('.loadmask.sk-shell > ' + sel) >= 0, sel + ' silhouette is not hidden under the shell skeleton'));
    [{}, {mode: 'view'}, {mode: 'view', toolbar: 'true'}, {compact: 'true'}, {toolbar: 'false'},
     {compact: 'true', toolbar: 'false'}, {mode: 'view', toolbar: 'false'}].forEach(params => {
        assert.equal(runSkeleton(src, params).has('sk-shell'), true, 'no shell skeleton for ' + JSON.stringify(params));
    });
    assert.equal(runSkeleton(src, {internal: 'true'}).has('sk-shell'), false, 'a nested editor got the shell skeleton');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
