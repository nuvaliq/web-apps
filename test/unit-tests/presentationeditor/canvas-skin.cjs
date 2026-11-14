/* Run: node test/unit-tests/presentationeditor/canvas-skin.cjs [CompactShell.js [compact-shell.less]]
 * The presentation shell canvas palette: the colors of the thumbnail strip, the margin around the slide and the
 * notes are passed to the engine via asc_setSkin from the variables on #editor_sdk, not from body;
 * the skin is re-sent after a theme change and with the "Stock interface"; under the dark theme
 * the values and the skin type are light; stock panels and menus do not lose the theme variables.
 * The optional arguments are paths to file copies for checking on a corrupted copy.
 * LESS is compiled by the less package from build/node_modules (of the tree or the main web-apps copy).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const PE_LESS_DIR = path.join(ROOT, 'apps/presentationeditor/main/resources/less');
const SHELL_FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'apps/presentationeditor/main/app/view/CompactShell.js');
const LESS_FILE = process.argv[3] ? path.resolve(process.argv[3]) : path.join(PE_LESS_DIR, 'compact-shell.less');
const THEMES_FILE = path.join(ROOT, 'apps/common/main/lib/controller/Themes.js');
const _ = require(path.join(ROOT, 'vendor/underscore/underscore-node.cjs'));

const read = f => fs.readFileSync(f, 'utf8');

/* --- styles ------------------------------------------------------------- */
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

/* Flat rules: [{sels: [string], decls: [{prop, value, important}]}]; @-blocks go inside. */
function rules(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
        const prelude = m[1].trim();
        if (prelude.startsWith('@')) continue;
        const decls = [];
        for (const d of m[2].split(';')) {
            const i = d.indexOf(':');
            if (i <= 0) continue;
            let value = d.slice(i + 1).trim();
            const important = /!important$/i.test(value);
            value = value.replace(/\s*!important$/i, '');
            decls.push({prop: d.slice(0, i).trim(), value, important});
        }
        out.push({sels: prelude.replace(/^.*\{/, '').split(',').map(s => s.trim().replace(/\s+/g, ' ')), decls});
    }
    return out;
}

/* Theme color keys that the stock code takes from body and gives to the engine. */
function themeTokens() {
    const m = /themeColorTokens\s*=\s*\[([\s\S]*?)\]/.exec(read(THEMES_FILE));
    assert.ok(m, 'Themes.js: themeColorTokens is not found');
    const list = Array.from(m[1].matchAll(/["']([\w-]+)["']/g), x => x[1]);
    assert.ok(list.includes('canvas-background') && list.includes('background-toolbar'), 'Themes.js: unexpected token list');
    return list;
}

const SDK_SEL = 'body.vo-compact #editor_sdk';
const SKIN = '--vo-skin-';

/* --- a small DOM --------------------------------------------------------- */
class El {
    constructor(tag) {
        this.localName = tag;
        this.attrs = {};
        this.childNodes = [];
        this.parentNode = null;
        this.listeners = {};
        this.textContent = '';
        const self = this;
        this.classList = {
            list: () => (self.attrs.class || '').split(/\s+/).filter(Boolean),
            add(...c) { self.attrs.class = Array.from(new Set(this.list().concat(c))).join(' '); },
            remove(...c) { self.attrs.class = this.list().filter(x => !c.includes(x)).join(' '); },
            contains(c) { return this.list().includes(c); },
            toggle(c, on) { const v = on === undefined ? !this.contains(c) : !!on; v ? this.add(c) : this.remove(c); return v; }
        };
    }
    get id() { return this.attrs.id || ''; }
    get firstChild() { return this.childNodes[0] || null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(c) { return this.insertBefore(c, null); }
    insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c);
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
        c.parentNode = this;
        return c;
    }
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null; return c; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    click() { (this.listeners.click || []).forEach(f => f({})); }
    all() { return this.childNodes.reduce((a, c) => a.concat([c], c.all()), []); }
}

/* The theme on body (what Themes.getThemeColors takes): light and dark, values of the stock tables. */
const THEMES = {
    light: {'canvas-background': '#eeeeee', 'canvas-page-border': '#cccccc', 'background-toolbar': '#f7f7f7',
        'background-normal': '#ffffff', 'border-toolbar': '#cbcbcb', 'border-preview-select': '#888888',
        'border-preview-hover': '#bababa', 'text-normal': 'rgba(0, 0, 0, 0.8)', 'text-link': '#445799',
        'canvas-scroll-thumb': '#f7f7f7', 'canvas-ruler-mark': '#555555'},
    dark: {'canvas-background': '#555555', 'canvas-page-border': '#555555', 'background-toolbar': '#404040',
        'background-normal': '#333333', 'border-toolbar': '#2a2a2a', 'border-preview-select': '#cccccc',
        'border-preview-hover': '#999999', 'text-normal': 'rgba(255, 255, 255, 0.8)', 'text-link': '#b5c3ff',
        'canvas-scroll-thumb': '#404040', 'canvas-ruler-mark': '#cccccc'}
};

let doc, main, viewport, handlers, timers, warnings, skins, theme, styleReads, sdkVars;

const context = {
    PE: {Views: {}, getController(name) {
        if (name === 'Main') return main;
        if (name === 'Viewport') return viewport;
        return null;
    }},
    _,
    setTimeout: f => { timers.push(f); return timers.length; },
    clearTimeout: () => {},
    console: {warn: (...a) => warnings.push(a.map(String).join(' ')), log: console.log},
    $: () => ({trigger() {}}),
    /* Computed style: on #editor_sdk under body.vo-compact it is the declarations of the shell rule,
       higher up the tree it is the body theme variables (as the browser inherits). */
    getComputedStyle: el => {
        styleReads.push(el.id || el.localName);
        const compact = doc.body.classList.contains('vo-compact');
        return {getPropertyValue(name) {
            if (el.id === 'editor_sdk' && compact && sdkVars[name] !== undefined) return ' ' + sdkVars[name];
            const key = name.replace(/^--/, '');
            return THEMES[theme][key] !== undefined ? ' ' + THEMES[theme][key] : '';
        }};
    },
    Common: {
        NotificationCenter: {
            on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
            trigger: (ev, ...a) => (handlers[ev] || []).slice().forEach(f => f(...a))
        },
        UI: {Themes: {
            available: () => true,
            /* The stock snapshot is from body, the type and name are from the theme. */
            getThemeColors: () => Object.assign({}, THEMES[theme], {type: theme, name: 'theme-' + theme})
        }}
    }
};
context.window = context;
Object.defineProperty(context, 'document', {get: () => doc});
vm.createContext(context);
context.define = (deps, factory) => factory();
vm.runInContext(read(SHELL_FILE), context, {filename: SHELL_FILE});
const shell = context.PE.Views.CompactShell;
const pristine = Object.assign({}, shell);

function makeDoc(dark) {
    const root = new El('html');
    const body = new El('body');
    body.setAttribute('class', dark ? 'theme-dark theme-type-dark' : 'theme-light');
    root.appendChild(body);
    for (const id of ['toolbar', 'statusbar', 'editor_sdk']) {
        const e = new El('div'); e.setAttribute('id', id); e.appendChild(new El('section')); body.appendChild(e);
    }
    return {
        body,
        createElement: tag => new El(tag),
        getElementById: id => root.all().find(e => e.getAttribute('id') === id) || null,
        querySelectorAll: () => root.all().filter(e => (e.getAttribute('id') || '').startsWith('vo-'))
    };
}

function boot(opts) {
    opts = opts || {};
    Object.keys(shell).forEach(k => { if (!(k in pristine)) delete shell[k]; });
    Object.assign(shell, pristine, {boot: null, booted: false, startupFailed: false, advanced: false, api: null,
        base: null, ours: false, rows: null, commands: null, rightSnapshot: null, skinTimer: null});
    theme = opts.dark ? 'dark' : 'light';
    doc = makeDoc(opts.dark);
    handlers = {}; timers = []; warnings = []; skins = []; styleReads = [];
    main = {editorConfig: {ui: {shell: opts.shell === undefined ? 'modern' : opts.shell}}, appOptions: {isEdit: true},
        api: {Resize() {}, asc_setSkin: s => skins.push(JSON.parse(JSON.stringify(s)))}};
    const panel = h => ({height: h, el: {css() {}}});
    const tb = panel(88), st = panel(25);
    viewport = {viewport: {
        vlayout: {panels: [tb, st], getItem: a => (a === 'toolbar' ? tb : a === 'statusbar' ? st : null), doLayout() {}},
        hlayout: {doLayout() {}}
    }, api: main.api};
    shell.start();
    drain();
}
const drain = () => { let n = 0; while (timers.length && n < 100) { timers.shift()(); n++; } };
const last = () => skins[skins.length - 1];

let css, list, tokens;
let passed = 0, failed = 0;
async function check(name, fn) {
    try { await fn(); console.log('ok ' + name); passed++; }
    catch (e) { console.log('FAIL ' + name + ': ' + e.message); failed++; }
}

/* The shell palette on #editor_sdk comes from the compiled compact-shell.less. */
function shellSdkVars() {
    const out = {};
    for (const r of list) {
        if (!r.sels.includes(SDK_SEL)) continue;
        for (const d of r.decls) if (d.prop.startsWith('--')) out[d.prop] = d.value.toLowerCase();
    }
    return out;
}

/* What the engine will get for a key under the shell: the shell palette value on #editor_sdk. */
function expectedSkin() {
    const out = {};
    for (const [prop, value] of Object.entries(sdkVars)) if (prop.startsWith(SKIN)) out[prop.slice(SKIN.length)] = value;
    return out;
}

(async () => {
    try {
        css = (await lessCompiler().render(read(LESS_FILE), {filename: LESS_FILE, paths: [PE_LESS_DIR], javascriptEnabled: true})).css;
        list = rules(css);
        tokens = themeTokens();
        sdkVars = shellSdkVars();
    } catch (e) {
        console.log('FAIL setup: ' + e.message);
        process.exitCode = 1;
        return;
    }

    await check('skin_from_editor_sdk_vars_not_body', () => {
        const own = expectedSkin();
        for (const key of ['canvas-background', 'background-toolbar', 'border-preview-select', 'border-preview-hover', 'text-normal', 'border-toolbar'])
            assert.ok(own[key], 'the shell palette on #editor_sdk has no ' + SKIN + key);
        assert.equal(own['canvas-background'], '#eef2f4', 'the field is not the shell grey');
        assert.equal(own['background-toolbar'], '#ffffff', 'the thumbnails ribbon is not white');

        boot();
        assert.ok(doc.getElementById('vo-shell'), 'the shell is not built' + (warnings.length ? ': ' + warnings[0] : ''));
        assert.ok(skins.length > 0, 'the shell never passes its palette to the engine (asc_setSkin)');
        const skin = last();
        for (const key of Object.keys(THEMES.light)) {
            const want = own[key] !== undefined ? own[key] : THEMES.light[key];
            assert.equal(String(skin[key]).trim().toLowerCase(), want, 'skin key ' + key);
        }
        assert.equal(skin['text-link'], THEMES.light['text-link'], 'a key the shell does not paint keeps the theme value');
        assert.equal(skin.type, 'light');
        assert.ok(styleReads.includes('editor_sdk'), 'values are not read from #editor_sdk');
        assert.ok(!styleReads.includes('body'), 'values are read from body');

        /* A key without its own --vo-skin-*: what the canvas sees on #editor_sdk under its own name. */
        const saved = sdkVars;
        sdkVars = Object.assign({}, saved, {'--canvas-high-contrast': '#123456'});
        delete sdkVars[SKIN + 'canvas-high-contrast'];
        THEMES.light['canvas-high-contrast'] = '#000000';
        try {
            shell.applyCanvasSkin();
            assert.equal(last()['canvas-high-contrast'], '#123456', 'the canvas name on #editor_sdk is the fallback');
        } finally {
            sdkVars = saved;
            delete THEMES.light['canvas-high-contrast'];
        }
    });

    await check('skin_reapplied_on_theme_change', () => {
        boot();
        const own = expectedSkin();
        /* The stock theme handler already gave the engine the theme colors from body: the shell recolors anew. */
        skins.push(Object.assign({}, THEMES.light));
        let n = skins.length;
        (handlers['uitheme:changed'] || []).forEach(f => f('theme-light'));
        assert.ok(skins.length > n, 'no asc_setSkin after uitheme:changed');
        assert.equal(last()['canvas-background'], own['canvas-background']);
        assert.equal(last()['background-toolbar'], own['background-toolbar']);
        n = skins.length;
        drain();
        assert.ok(skins.length > n, 'no repeat after the styles are compiled');
        assert.equal(last()['background-toolbar'], own['background-toolbar']);

        /* "Stock interface": theme colors as they are; returning gives the shell palette again. */
        shell.command('stockInterface')();
        drain();
        assert.equal(last()['canvas-background'], THEMES.light['canvas-background'], 'the stock interface keeps the shell palette');
        assert.equal(last()['background-toolbar'], THEMES.light['background-toolbar']);
        shell.command('stockInterface')();
        drain();
        assert.equal(last()['background-toolbar'], own['background-toolbar'], 'the palette is not back after the stock interface');

        /* Without the shell field, not a single skin of its own. */
        boot({shell: ''});
        assert.equal(doc.getElementById('vo-shell'), null);
        assert.equal(skins.length, 0, 'the stock editor gets a skin from the shell');
    });

    await check('dark_theme_keeps_light_values', () => {
        /* No rule under the dark theme overrides the palette. */
        const skinRules = list.filter(r => r.decls.some(d => d.prop.startsWith(SKIN)));
        assert.ok(skinRules.length > 0);
        for (const r of skinRules) assert.deepEqual(r.sels, [SDK_SEL], 'the palette is declared outside ' + SDK_SEL + ': ' + r.sels.join(', '));

        boot();
        const light = last();
        boot({dark: true});
        const dark = last();
        assert.ok(dark, 'no skin under the dark theme');
        for (const key of Object.keys(expectedSkin()).filter(k => k in THEMES.dark))
            assert.equal(dark[key], light[key], 'under the dark theme ' + key + ' differs');
        assert.equal(dark.type, 'light', 'the engine skin type stays dark: notes and thumbnails are drawn in the dark mode');
        assert.equal(dark.name, 'theme-light');

        (handlers['uitheme:changed'] || []).forEach(f => f('theme-dark'));
        assert.equal(last().type, 'light');
        assert.equal(last()['background-toolbar'], light['background-toolbar']);

        /* "Stock interface" under the dark theme is the stock dark skin. */
        shell.command('stockInterface')();
        assert.equal(last().type, 'dark');
        assert.equal(last()['background-toolbar'], THEMES.dark['background-toolbar']);
    });

    await check('stock_panels_unaffected', () => {
        /* The shell overrides the theme variables nowhere: inside #editor_sdk live the stock
           context menus and hints, outside it, the stock panels. */
        const declared = new Set();
        for (const r of list) for (const d of r.decls) if (d.prop.startsWith('--')) declared.add(d.prop.slice(2));
        const theirs = tokens.filter(t => declared.has(t));
        assert.deepEqual(theirs, [], 'the shell styles redeclare theme colours');

        /* Cards only under body.vo-compact and only background and rounding: no hiding, heights or margins. */
        const SDK_NODE = /#id_panel_thumbnails\b|#id_thumbnails\b|#id_panel_notes\b|#id_notes\b|#id_bottom_pannels_container\b|#id_main_parent\b|#id_main\b|#id_viewer\b/;
        const cards = list.filter(r => r.sels.some(s => SDK_NODE.test(s)));
        assert.ok(cards.length > 0, 'no card rules on the engine nodes');
        for (const r of cards) {
            for (const s of r.sels) assert.match(s, /^body\.vo-compact /, 'a card rule outside body.vo-compact: ' + s);
            for (const d of r.decls) {
                assert.ok(/^(background(-color)?|border(-top|-bottom)?(-left|-right)?-radius|overflow)$/.test(d.prop),
                    'a card rule changes ' + d.prop + ' of ' + r.sels.join(', '));
            }
        }
        const notes = cards.filter(r => r.sels.some(s => /#id_panel_notes\b|#id_notes\b/.test(s)));
        assert.ok(notes.some(r => r.decls.some(d => /^background(-color)?$/.test(d.prop) && d.important && /^#fff(fff)?$/i.test(d.value))),
            'the notes card is not white over the inline style');
        const thumbs = cards.filter(r => r.sels.some(s => /#id_panel_thumbnails\b/.test(s)));
        assert.ok(thumbs.some(r => r.decls.some(d => /^background(-color)?$/.test(d.prop) && /^#fff(fff)?$/i.test(d.value))),
            'the thumbnails card is not white');

        /* Outside the shell and in the "Stock interface" canvasSkin is the stock theme snapshot without changes. */
        boot();
        shell.command('stockInterface')();
        const stock = shell.canvasSkin();
        assert.deepEqual(_.omit(stock, 'type', 'name'), THEMES.light);
    });

    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})();
