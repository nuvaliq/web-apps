/* Run after the editor LESS build:
 *   COMPACT_CSS_DOCUMENTEDITOR=<deploy>/apps/documenteditor/main/resources/css/app.css \
 *   COMPACT_CSS_SPREADSHEETEDITOR=<deploy>/apps/spreadsheeteditor/main/resources/css/app.css \
 *     node test/unit-tests/common/compact/compact-layer-css.cjs
 * Shared compact styles (apps/common/main/resources/less/compact/): tokens.less gives the defaults,
 * menu.less the menu bar rules on them; an editor imports both before its own compact-shell.less
 * and declares its values there. Checked for every editor of lib/editors.cjs: the built app.css of
 * an editor comes from its cssEnv variable (no variable — the run fails and names it), the test
 * editor is compiled here from lib/fixture-shell.less with the less package of build/node_modules
 * (cd build && npm install). Browser checks run the shared menu bar over the test editor adapter in
 * headless Chrome through Playwright (NODE_PATH or PLAYWRIGHT_MODULE), styled by each editor css.
 */
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const EDITORS = require('./lib/editors.cjs');
const fixture = require('./lib/fixture-editor.cjs');
const {ROOT, MODEL, BAR, launch, settle, checker} = require('./lib/menu-bar-page.cjs');

const SHARED = path.join(ROOT, 'apps/common/main/resources/less/compact');
const TOKENS = path.join(SHARED, 'tokens.less');
const MENU = path.join(SHARED, 'menu.less');
const FIXTURE_SHELL = path.join(__dirname, 'lib/fixture-shell.less');
const AIR = 'apps/common/main/resources/img/air/';

const read = file => fs.readFileSync(file, 'utf8');

/* --- Styles of an editor ----------------------------------------------------------------- */

/* Built css of an editor from its environment variable; the message names the variable. */
function builtCss(editor, env) {
    const file = env[editor.cssEnv];
    if (!file) {
        throw new Error('set ' + editor.cssEnv + ' to the built app.css of ' + editor.name +
            ' (cd build && npm install && grunt, then deploy/web-apps/' + editor.app + '/resources/css/app.css)');
    }
    if (!fs.existsSync(file)) throw new Error(editor.cssEnv + ' points to a missing file: ' + file);
    return read(file);
}

function lessPackage() {
    try { return require(path.join(ROOT, 'build/node_modules/less')); }
    catch (e) { throw new Error('the less package is missing: cd build && npm install (' + e.message + ')'); }
}

async function compile(source, filename) {
    return (await lessPackage().render(source, {filename, compress: true})).css;
}

/* The editor shell file: its values of the shared variables. */
const shellFile = editor => (editor.app ? path.join(ROOT, editor.app, 'resources/less/compact-shell.less') : FIXTURE_SHELL);

/* The test editor has no build: its styles are the shared layer and its shell file. */
async function editorCss(editor) {
    return editor.cssEnv ? builtCss(editor, process.env) : compile(read(FIXTURE_SHELL), FIXTURE_SHELL);
}

/* The stock path to the shared images the layer reads (@vo-air-url), as the stock variables.less that
   every editor app.less imports before the layer declares it. */
function stockImagePath() {
    const m = /^@common-image-const-path:[^;\n]*;/m.exec(read(path.join(ROOT, 'apps/common/main/resources/less/variables.less')));
    if (!m) throw new Error('variables.less: @common-image-const-path not found');
    return m[0];
}

/* The shared layer alone, with its defaults. */
const sharedCss = () => compile(stockImagePath() + '\n@import "tokens.less";\n@import "menu.less";\n', path.join(SHARED, 'layer.less'));

/* --- LESS sources --------------------------------------------------------------------------- */

const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/(^|[^:"'])\/\/.*$/, '$1')).join('\n');

/* Top-level LESS variables, the last declaration wins as in LESS. */
function lessVars(text) {
    const vars = {};
    for (const m of stripComments(text).matchAll(/^@(vo-[\w-]+)\s*:\s*([^;]+);/gm)) vars[m[1]] = m[2].replace(/\s+/g, ' ').trim();
    return vars;
}

/* Value of a variable; a value that names another variable takes that variable's value, as LESS does. */
function resolveVar(vars, name) {
    let v = vars[name];
    for (let i = 0; i < 10 && /^@[\w-]+$/.test(v || ''); i++) v = vars[v.slice(1)];
    return v;
}

/* Names of runtime tokens a LESS file declares. */
const runtimeNames = text => new Set(Array.from(stripComments(text).matchAll(/(--vo-[\w-]+)\s*:/g), m => m[1]));

/* --- CSS --------------------------------------------------------------------------------------- */

/* Splits at the separator outside parentheses and quotes. */
function splitTop(text, sep) {
    const out = [];
    let depth = 0, quote = null, buf = '';
    for (const ch of text) {
        if (quote) { if (ch === quote) quote = null; buf += ch; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === sep && !depth) { out.push(buf); buf = ''; continue; }
        buf += ch;
    }
    out.push(buf);
    return out.map(s => s.trim()).filter(Boolean);
}

/* Rules in source order: {selectors, decls: [[prop, value]], media}. Rules of @media keep the
   condition, frames of @keyframes keep the name in media, at-rules without a block are skipped. */
function parseCss(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    let i = 0;
    /* Next brace outside parentheses and quotes: url() and strings may hold anything. */
    function nextBrace() {
        let depth = 0, quote = null;
        for (let j = i; j < css.length; j++) {
            const ch = css[j];
            if (quote) { if (ch === quote) quote = null; continue; }
            if (ch === '"' || ch === "'") quote = ch;
            else if (ch === '(') depth++;
            else if (ch === ')') depth--;
            else if (!depth && (ch === '{' || ch === '}')) return j;
        }
        return -1;
    }
    function block(media) {
        for (;;) {
            const at = nextBrace();
            if (at < 0) { i = css.length; return; }
            let head = css.slice(i, at);
            i = at + 1;
            if (css[at] === '}') return;
            head = head.slice(head.lastIndexOf(';') + 1).trim();
            if (/^@(media|supports|-webkit-keyframes|keyframes|layer|document)\b/.test(head)) { block(head); continue; }
            const end = nextBrace();
            const body = css.slice(i, end);
            i = end + 1;
            rules.push({
                selectors: splitTop(head, ',').map(s => s.replace(/\s+/g, ' ')),
                decls: splitTop(body, ';').map(d => {
                    const k = d.indexOf(':');
                    return [d.slice(0, k).trim(), d.slice(k + 1).trim()];
                }),
                media
            });
        }
    }
    block(null);
    return rules;
}

const value = (rule, prop) => {
    const d = rule && rule.decls.filter(x => x[0] === prop).pop();
    return d ? d[1] : undefined;
};

/* Rules outside @media and @keyframes that list the selector. */
const rulesOf = (rules, selector, media = null) =>
    rules.filter(r => r.media === media && r.selectors.includes(selector));

/* Normalised token value: no spaces, no leading zero. */
const norm = v => String(v).replace(/\s+/g, '').replace(/(^|[^\d.])0\./g, '$1.').toLowerCase();

/* Shared base selectors: rules of the shared layer itself, not an editor look over it. */
const isBase = sel => /^(\.rtl )?\.vo-mn(?![\w-])/.test(sel) || /^\.vo-mn-(item|sub)$/.test(sel);

/* Every editor with its css, rules, shell values and the shared defaults. */
async function loadAll() {
    const defaults = lessVars(read(TOKENS));
    const shared = parseCss(await sharedCss());
    const list = [];
    for (const editor of EDITORS) {
        const css = await editorCss(editor);
        list.push({editor, css, rules: parseCss(css), vars: Object.assign({}, defaults, lessVars(read(shellFile(editor))))});
    }
    return {defaults, shared, list};
}

/* --- Browser ------------------------------------------------------------------------------------ */

/* The shared menu bar over the test editor adapter, styled by the given css.
   options: width of the host, context of the test editor, icons — glyphs as named spans,
   motion — keep the appearance animations (by default the page asks for reduced motion). */
async function styledMenu(browser, css, {width = 900, context = {}, icons = false, motion = false} = {}) {
    const page = await browser.newPage({viewport: {width: 1000, height: 700}});
    await page.emulateMedia({reducedMotion: motion ? 'no-preference' : 'reduce'});
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head>
        <body class="vo-compact"><div id="host" style="width:${width}px"></div><button id="aside">aside</button></body></html>`);
    await page.addScriptTag({content: `window.define = function (deps, factory) {
        var shared = function () { return (window.Common && Common.UI && Common.UI.Compact) || {}; };
        return factory.apply(null, deps.map(function (d) { return shared()[d.split('/').pop()]; }));
    };`});
    await page.addScriptTag({content: read(MODEL)});
    await page.addScriptTag({content: read(BAR)});
    const adapter = EDITORS.find(e => e.name === 'fixture').adapter;
    await page.addScriptTag({content: `(function (module) {\n${read(adapter)}\n;window.editorModule = module.exports;})({exports: {}});`});
    await page.evaluate(({pinned, context, icons}) => {
        window.ctx = editorModule.context(context);
        const opts = {pinned};
        if (icons) opts.icons = {svg: name => '<span class="vo-air" data-i="' + name + '"></span>'};
        window.menu = Common.UI.Compact.MenuBar.create(editorModule.adapter(ctx, Common.UI.Compact.MenuModel), opts);
        document.getElementById('host').appendChild(menu.el);
    }, {pinned: fixture.pinned, context, icons});
    await settle(page);
    return page;
}

const rowSelector = k => `.vo-mn-drop.open [data-k="${k}"]`;

async function hovered(page, k) {
    await page.hover(rowSelector(k));
    return page.evaluate(sel => {
        const row = document.querySelector(sel), cs = getComputedStyle(row);
        return {cursor: cs.cursor, background: cs.backgroundColor, color: cs.color, locked: row.classList.contains('vo-locked'),
                height: row.getBoundingClientRect().height};
    }, rowSelector(k));
}

/* Computed geometry of an open list: the list box, a row with a glyph, a row without one, the
   glyph place and its drawing, a separator. sel — selectors of these parts on the page. */
const listGeometry = (page, sel) => page.evaluate(sel => {
    const cs = s => {
        const el = document.querySelector(s);
        if (!el) throw new Error('no ' + s);
        return getComputedStyle(el);
    };
    const n = parseFloat;
    const list = cs(sel.list), row = cs(sel.row), plain = cs(sel.plain), glyph = cs(sel.glyph), art = cs(sel.art), sep = cs(sel.sep);
    return {minWidth: n(list.minWidth), padTop: n(list.paddingTop), padBottom: n(list.paddingBottom),
        radius: n(list.borderTopLeftRadius), rowH: n(row.minHeight), padLeft: n(row.paddingLeft),
        padRight: n(row.paddingRight), gap: n(row.columnGap), plainLeft: n(plain.paddingLeft),
        glyphW: n(glyph.width), glyphH: n(glyph.height), artW: n(art.width), artH: n(art.height),
        sepLeft: n(sep.marginLeft), sepRight: n(sep.marginRight)};
}, sel);

/* Opens the first section of the test editor and gives its first row a glyph of the set. */
async function menuWithGlyph(page) {
    await page.evaluate(() => menu.open('drawing'));
    await page.evaluate(sel => {
        const row = document.querySelector(sel);
        let i = row.querySelector('.vo-mn-i');
        if (!i) {
            i = document.createElement('span');
            i.className = 'vo-mn-i';
            row.insertBefore(i, row.firstChild);
        }
        i.innerHTML = '<span class="vo-air"></span>';
    }, rowSelector('drawing.new'));
    return {list: '.vo-mn-drop.open', row: rowSelector('drawing.new'), plain: rowSelector('drawing.history'),
        glyph: rowSelector('drawing.new') + ' .vo-mn-i', art: rowSelector('drawing.new') + ' .vo-mn-i .vo-air',
        sep: '.vo-mn-drop.open .vo-mn-sep'};
}

/* --- Checks ------------------------------------------------------------------------------------- */

(async () => {
    /* No built css — the run fails at once and names the variable to set. */
    const missing = EDITORS.filter(e => e.cssEnv && !process.env[e.cssEnv]);
    if (missing.length) {
        missing.forEach(e => console.error('FAIL', e.name + ':', 'set ' + e.cssEnv +
            ' to the built app.css of the editor (cd build && npm install && grunt)'));
        process.exitCode = 1;
        return;
    }

    const {check, done} = checker();
    const {defaults, shared, list} = await loadAll();
    const px = name => {
        const v = defaults[name];
        assert.ok(/^\d+px$/.test(v), 'tokens.less: @' + name + ' is a size: ' + v);
        return v;
    };

    await check('shared rule takes the editor value of a variable', () => {
        list.forEach(({editor, rules, vars}) => {
            const where = editor.name + ': ';
            const bar = rulesOf(rules, '.vo-mn');
            assert.equal(bar.length, 1, where + 'one shared .vo-mn rule');
            assert.equal(value(bar[0], 'height'), vars['vo-h-menu'], where + '.vo-mn height');
            const padX = parseInt(vars['vo-pad-x'], 10) - parseInt(vars['vo-menu-item-pad-x'], 10);
            assert.equal(value(bar[0], 'padding'), '0 ' + padX + 'px ' + vars['vo-menu-pad-bottom'], where + '.vo-mn padding');
            assert.equal(value(rulesOf(rules, '.vo-mn .vo-mn-sub')[0], 'min-height'), vars['vo-row-h'], where + 'list row');
            assert.equal(value(rulesOf(rules, '.vo-mn .vo-mn-item')[0], 'font-size'), vars['vo-fs-menu'], where + 'section label');
        });
        /* The editors declare these values themselves: the values above are theirs, not the layer's.
           An editor may keep the default size; another one differs from it, so a shared rule that
           kept the default fails above. */
        list.forEach(({editor}) => {
            const own = lessVars(read(shellFile(editor)));
            assert.ok('vo-h-menu' in own, editor.name + ' declares its own menu row');
            assert.ok('vo-row-h' in own, editor.name + ' declares its own list row');
        });
        ['vo-h-menu', 'vo-row-h'].forEach(name =>
            assert.ok(list.some(({vars}) => vars[name] !== px(name)), 'an editor differs from the default @' + name));
    });

    await check('fixture editor values reach the shared rules', () => {
        const {rules, vars} = list.find(x => x.editor.name === 'fixture');
        ['vo-h-header', 'vo-h-menu', 'vo-h-toolbar'].forEach(name =>
            assert.equal(vars[name], fixture.vars[name], 'fixture-shell.less and fixture-editor.cjs agree on @' + name));
        assert.equal(value(rulesOf(rules, '.vo-mn')[0], 'height'), fixture.vars['vo-h-menu']);
        assert.equal(value(rulesOf(rules, '.vo-mn .vo-mn-drop')[0], 'max-height'),
            'calc(100vh - ' + fixture.vars['vo-h-header'] + ' - ' + fixture.vars['vo-h-menu'] + ' - ' + vars['vo-menu-drop-margin'] + ')');
        assert.equal(value(rulesOf(rules, '.vo-mn .vo-mn-drop')[0], 'border-radius'), vars['vo-r-pop']);
        /* The test editor declares only the pair: the separate sides follow it. */
        assert.equal(value(rulesOf(rules, '.vo-mn .vo-mn-drop')[0], 'padding'), vars['vo-pop-pad-y'] + ' 0 ' + vars['vo-pop-pad-y']);
        assert.equal(value(rulesOf(rules, '.vo-mn .vo-mn-sub')[0], 'padding'), '0 ' + vars['vo-row-pad-x'] + ' 0 ' + vars['vo-row-pad-x']);
        assert.equal(norm(value(rulesOf(rules, '.vo-mn .vo-mn-item')[0], 'font-family')), norm(vars['vo-font']));
        assert.equal(norm(value(rulesOf(rules, '.vo-mn .vo-mn-item')[0], 'font-family')), 'georgia,serif');
    });

    await check('documents built css keeps 50, 33 and 46 while the fixture uses its own values', () => {
        const de = list.find(x => x.editor.name === 'documenteditor').rules;
        const height = (rules, sel) => rulesOf(rules, sel).map(r => value(r, 'height')).filter(Boolean).pop();
        assert.equal(height(de, '.vo-hd'), '50px', 'documents header row');
        assert.equal(height(de, '.vo-mn'), '33px', 'documents menu row');
        assert.equal(height(de, '#vo-tb'), '46px', 'documents toolbar row');
        assert.ok(/100vh - 50px - 33px - /.test(value(rulesOf(de, '.vo-mn .vo-mn-drop')[0], 'max-height')),
            'documents menu list ceiling counts its own rows');
        const fx = list.find(x => x.editor.name === 'fixture').rules;
        assert.equal(height(fx, '.vo-mn'), fixture.vars['vo-h-menu'], 'fixture menu row');
        const fixtureMenu = fx.filter(r => r.selectors.some(isBase)).map(r => r.decls.map(d => d[1]).join(';')).join('\n');
        ['50px', '33px', '46px'].forEach(v => assert.ok(fixtureMenu.indexOf(v) < 0, 'documents value ' + v + ' leaked into the fixture'));
    });

    await check('editor runtime token is declared after the shared one under the same selector', () => {
        const sharedTokens = new Map();
        rulesOf(shared, 'body.vo-compact').forEach(r => r.decls.forEach(([p, v]) => { if (/^--vo-menu-/.test(p)) sharedTokens.set(p, v); }));
        assert.ok(sharedTokens.size >= 5, 'shared runtime tokens: ' + Array.from(sharedTokens.keys()));
        /* An editor may take every default token; another one declares its own over them. */
        let overriding = 0;
        list.forEach(({editor, rules}) => {
            const where = editor.name + ': ';
            const own = Array.from(runtimeNames(read(shellFile(editor)))).filter(n => sharedTokens.has(n));
            if (own.length) overriding++;
            const shell = stripComments(read(shellFile(editor)));
            sharedTokens.forEach((def, name) => {
                const seen = rulesOf(rules, 'body.vo-compact').map(r => value(r, name)).filter(v => v !== undefined);
                assert.ok(seen.length, where + name + ' is declared under body.vo-compact');
                assert.equal(norm(seen[0]), norm(def), where + name + ': the shared declaration comes first');
                if (!own.includes(name)) { assert.equal(seen.length, 1, where + name + ' declared once'); return; }
                const mine = new RegExp(name + '\\s*:\\s*([^;]+);').exec(shell)[1];
                assert.ok(seen.length >= 2, where + name + ': the editor declaration follows the shared one');
                assert.equal(norm(seen[seen.length - 1]), norm(mine), where + name + ': the editor value is the last one');
            });
        });
        assert.ok(overriding > 0, 'an editor declares its own menu tokens');
    });

    await check('shared tokens use names absent from the documents shell file except the ones it already declares', () => {
        const tokens = read(TOKENS);
        const de = read(path.join(ROOT, 'apps/documenteditor/main/resources/less/compact-shell.less'));
        const deVars = lessVars(de);
        const deText = stripComments(de);
        const same = [], fresh = [];
        Object.keys(lessVars(tokens)).forEach(name => {
            if (name in deVars) { same.push(name); return; }
            assert.ok(/^vo-menu-[\w-]+$|^vo-air-url$/.test(name), '@' + name + ': a new shared name is @vo-menu-* or @vo-air-url');
            assert.ok(!new RegExp('@' + name + '\\s*:').test(deText), '@' + name + ' is declared by the documents shell');
            fresh.push(name);
        });
        const runtime = Array.from(runtimeNames(tokens));
        runtime.forEach(name => assert.ok(/^--vo-menu-[\w-]+$/.test(name),
            name + ': the shared layer declares only --vo-menu-* runtime tokens, the editor palette stays the editor\'s'));
        assert.ok(same.length >= 10 && fresh.length >= 5 && runtime.length >= 5,
            'names shared with documents, new names, runtime tokens: ' + [same.length, fresh.length, runtime.length]);
        /* The documents names the shared rules read are still declared by the documents shell. */
        ['vo-h-menu', 'vo-h-header', 'vo-fs-menu', 'vo-pad-x', 'vo-row-h', 'vo-r-pop', 'vo-text', 'vo-hover']
            .forEach(name => assert.ok(name in deVars, '@' + name + ' stays declared in the documents shell'));
    });

    await check('icon path resolves to the shared folder from the editor css', () => {
        list.forEach(({editor, css}) => {
            const cssDir = path.posix.join(editor.app || 'apps/fixture/main', 'resources/css');
            const urls = Array.from(css.matchAll(/url\(\s*["']?([^"')]*img\/air\/[^"')]*)["']?\s*\)/g), m => m[1]);
            assert.ok(urls.length > 0, editor.name + ': the css draws icons of the set');
            urls.forEach(u => {
                const target = path.posix.normalize(path.posix.join(cssDir, u));
                assert.ok(target.startsWith(AIR), editor.name + ': ' + u + ' resolves to ' + target);
                assert.ok(fs.existsSync(path.join(ROOT, target)), editor.name + ': ' + target + ' exists');
            });
        });
    });

    await check('missing built css fails with a message naming the variable', () => {
        const editor = EDITORS.find(e => e.cssEnv);
        assert.throws(() => builtCss(editor, {}), new RegExp(editor.cssEnv));
        const env = Object.assign({}, process.env);
        delete env[editor.cssEnv];
        const run = spawnSync(process.execPath, [__filename], {env, encoding: 'utf8', timeout: 60000});
        assert.notEqual(run.status, 0, 'the run without built css fails');
        assert.ok((run.stderr + run.stdout).indexOf(editor.cssEnv) >= 0, 'the message names ' + editor.cssEnv + ': ' + run.stderr);
        assert.ok(!/^PASS/m.test(run.stdout), 'nothing passes without built css');
    });

    await check('menu rules come from the shared layer once in the built css', () => {
        const count = (rules, media, sel) => rules.filter(r => r.media === media && r.selectors.includes(sel)).length;
        const base = new Map();
        shared.forEach(r => r.selectors.filter(isBase).forEach(sel => {
            const key = (r.media || '') + '|' + sel;
            base.set(key, (base.get(key) || 0) + 1);
        }));
        assert.ok(base.size > 25, 'shared menu selectors: ' + base.size);
        const frames = rules => rules.filter(r => /^@(-webkit-)?keyframes vo-pop$/.test(r.media || '') && r.selectors[0] === 'from').length;
        list.forEach(({editor, rules}) => {
            base.forEach((n, key) => {
                const [media, sel] = key.split('|');
                assert.equal(count(rules, media || null, sel), n, editor.name + ': ' + sel + (media ? ' in ' + media : ''));
            });
            /* The editor adds no menu rules of its own next to the shared ones: only its look over them. */
            const extra = [];
            rules.forEach(r => r.selectors.filter(isBase).forEach(sel => {
                if (!base.has((r.media || '') + '|' + sel)) extra.push(sel);
            }));
            assert.deepEqual(extra, [], editor.name + ': unprefixed menu rules outside the shared layer');
            assert.equal(frames(rules), 1, editor.name + ': the vo-pop frames are declared once');
        });
    });

    await check('menu.less has no literal colours or sizes', () => {
        const text = stripComments(read(MENU));
        const hits = [];
        text.split('\n').forEach((line, i) => {
            const at = 'menu.less:' + (i + 1) + ': ' + line.trim();
            if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|color-mix)\(/i.test(line)) hits.push(at);
            if (/(^|[^\w-])(white|black|red|blue|gray|grey|silver)(?![\w-])/i.test(line)) hits.push(at);
            /* Lengths other than 0, a whole parent (100%) and the window (100vh) are tokens. */
            for (const m of line.matchAll(/(^|[^\w@-])(-?\d*\.?\d+)(px|em|rem|pt|ch|ex|vh|vw|%)\b/g)) {
                const n = m[2] + m[3];
                if (Number(m[2]) !== 0 && n !== '100%' && n !== '100vh') hits.push(at);
            }
            if (/\bz-index:\s*-?\d/.test(line)) hits.push(at);
        });
        assert.deepEqual(hits, []);
        /* The probe sees what it is meant to see. */
        assert.ok(/\d+px/.test(read(TOKENS)) && /rgba\(/.test(read(TOKENS)), 'tokens.less holds the literals');
    });

    await check('shared menu rules read only variables for the list geometry', () => {
        /* Separate sides default to the pair, so an editor that declares only the pair keeps it. */
        const tokens = lessVars(read(TOKENS));
        assert.equal(tokens['vo-pop-pad-top'], '@vo-pop-pad-y', 'top padding of a list defaults to the pair');
        assert.equal(tokens['vo-pop-pad-bottom'], '@vo-pop-pad-y', 'bottom padding of a list defaults to the pair');
        assert.equal(tokens['vo-row-pad-l'], '@vo-row-pad-x', 'left padding of a row defaults to the pair');
        assert.equal(tokens['vo-row-pad-r'], '@vo-row-pad-x', 'right padding of a row defaults to the pair');
        list.forEach(({editor, rules, vars}) => {
            const where = editor.name + ': ';
            const v = name => {
                const got = resolveVar(vars, name);
                assert.ok(/^\d+px$/.test(got || ''), where + '@' + name + ' is a size: ' + got);
                return got;
            };
            const drop = rulesOf(rules, '.vo-mn .vo-mn-drop')[0];
            const row = rulesOf(rules, '.vo-mn .vo-mn-sub')[0];
            const glyph = rulesOf(rules, '.vo-mn .vo-mn-i')[0];
            assert.equal(value(drop, 'min-width'), v('vo-menu-drop-min-w'), where + 'list width');
            assert.equal(value(drop, 'padding'), v('vo-pop-pad-top') + ' 0 ' + v('vo-pop-pad-bottom'), where + 'list paddings');
            assert.equal(value(drop, 'border-radius'), v('vo-r-pop'), where + 'list corners');
            assert.equal(value(row, 'min-height'), v('vo-row-h'), where + 'row height');
            assert.equal(value(row, 'padding'), '0 ' + v('vo-row-pad-r') + ' 0 ' + v('vo-row-pad-l'), where + 'row paddings');
            assert.equal(value(row, 'gap'), v('vo-row-gap'), where + 'glyph to label');
            assert.equal(value(glyph, 'width'), v('vo-menu-glyph'), where + 'glyph width');
            assert.equal(value(glyph, 'height'), v('vo-menu-glyph'), where + 'glyph height');
        });
        /* The documents look over the shared rules gives values, not a second copy of this geometry. */
        const own = {
            '.vo-mn .vo-mn-drop': ['min-width', 'padding', 'padding-top', 'padding-bottom', 'border-radius'],
            '.vo-mn .vo-mn-sub': ['min-height', 'padding', 'gap'],
            '.vo-mn .vo-mn-i': ['width', 'height']
        };
        const repeated = [];
        list.find(x => x.editor.name === 'documenteditor').rules.forEach(rule => rule.selectors.forEach(sel => {
            const props = own[sel.replace(/^body\.vo-compact /, '')];
            if (props && sel !== sel.replace(/^body\.vo-compact /, '')) {
                rule.decls.forEach(([p]) => { if (props.includes(p)) repeated.push(sel + ' { ' + p + ' }'); });
            }
        }));
        assert.deepEqual(repeated, [], 'documents list geometry over the shared rules');
    });

    let browser;
    try {
        browser = await launch();
        const pages = {};
        for (const x of list) pages[x.editor.name] = await styledMenu(browser, x.css);

        await check('documents menu row keeps its height', async () => {
            for (const {editor, vars} of list) {
                const page = pages[editor.name];
                const bar = await page.evaluate(() => menu.el.getBoundingClientRect().height);
                assert.equal(bar + 'px', vars['vo-h-menu'], editor.name + ': menu bar height');
                await page.evaluate(() => menu.open('drawing'));
                const row = await hovered(page, 'drawing.new');
                assert.equal(row.height + 'px', vars['vo-row-h'], editor.name + ': list row height');
                if (editor.name === 'documenteditor') {
                    assert.equal(bar, 33, 'documents menu row is 33');
                    assert.equal(row.height, 38, 'documents list row is 38');
                }
                await page.evaluate(() => menu.close());
            }
        });

        await check('documents menu list keeps width, paddings, row height and glyph after the move', async () => {
            const {css} = list.find(x => x.editor.name === 'documenteditor');
            const p = await styledMenu(browser, css, {icons: true});
            const got = await listGeometry(p, await menuWithGlyph(p));
            /* Width from 266, 13 above and 17 below the rows, corners 12; a row of 38 with the glyph
               at 14, the right column of the mark ending at 18 (18 + 24), 11 from glyph to label;
               a row without a glyph starts its label at 18; glyph 24; separator from 14. */
            assert.deepEqual(got, {minWidth: 266, padTop: 13, padBottom: 17, radius: 12, rowH: 38, padLeft: 14,
                padRight: 42, gap: 11, plainLeft: 18, glyphW: 24, glyphH: 24, artW: 24, artH: 24, sepLeft: 14, sepRight: 23});
            await p.close();
        });

        await check('documents toolbar popup lists keep the same values as the menu lists', async () => {
            const {css} = list.find(x => x.editor.name === 'documenteditor');
            const p = await styledMenu(browser, css, {icons: true});
            const menuSel = await menuWithGlyph(p);
            /* A toolbar list as the documents toolbar builds it (CompactToolbar.popItem). */
            await p.evaluate(() => document.body.insertAdjacentHTML('beforeend',
                '<div class="vo-pop-wrap open" id="probe"><div class="vo-pop vo-pop-list">' +
                '<button type="button" class="vo-pop-item" id="probe-row"><span class="vo-pop-i"><span class="vo-air"></span></span>' +
                '<span>Row</span><span class="vo-pop-check"></span></button>' +
                '<div class="vo-pop-sep"></div>' +
                '<button type="button" class="vo-pop-item" id="probe-plain"><span>Plain</span><span class="vo-pop-check"></span></button>' +
                '</div></div>'));
            const pop = await listGeometry(p, {list: '#probe .vo-pop', row: '#probe-row', plain: '#probe-plain',
                glyph: '#probe-row .vo-pop-i', art: '#probe-row .vo-pop-i .vo-air', sep: '#probe .vo-pop-sep'});
            assert.deepEqual(pop, await listGeometry(p, menuSel));
            await p.close();
        });

        await check('disabled row differs from enabled beyond colour', async () => {
            for (const {editor} of list) {
                const page = pages[editor.name];
                await page.evaluate(() => menu.open('shape'));
                const on = await hovered(page, 'shape.snapGrid');
                const off = await hovered(page, 'shape.duplicate');
                const where = editor.name + ': ';
                assert.equal(on.locked, false, where + 'enabled row');
                assert.equal(off.locked, true, where + 'greyed row');
                assert.equal(on.cursor, 'pointer', where + 'enabled row invites a click');
                assert.equal(off.cursor, 'default', where + 'greyed row does not invite a click');
                assert.notEqual(on.background, 'rgba(0, 0, 0, 0)', where + 'enabled row lights up under the pointer');
                assert.equal(off.background, 'rgba(0, 0, 0, 0)', where + 'greyed row stays unlit under the pointer');
                assert.notEqual(on.color, off.color, where + 'greyed row is muted as well');
                await page.evaluate(() => menu.close());
            }
        });

        /* --- Look of the rows, marks, "…" and the status place -------------------------------------- */

        const box = (page, sel) => page.evaluate(sel => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
            return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height,
                color: cs.color, background: cs.backgroundColor, cursor: cs.cursor};
        }, sel);

        await check('built css of every editor on the layer keeps its own row heights', async () => {
            for (const {editor, css, vars} of list) {
                const p = await styledMenu(browser, css, {icons: true, context: {layers: 2}});
                const where = editor.name + ': ';
                const rowH = parseFloat(resolveVar(vars, 'vo-row-h')), grpH = parseFloat(resolveVar(vars, 'vo-menu-grp-h'));
                /* A row with a mark, with a dot, with ▸ and a plain one: one height; the header of a
                   group of choices — its own. */
                await p.evaluate(() => menu.open('shape'));
                assert.equal((await box(p, rowSelector('shape.snapGrid'))).height, rowH, where + 'choice row with a dot');
                assert.equal((await box(p, rowSelector('shape.duplicate'))).height, rowH, where + 'plain row');
                assert.equal((await box(p, rowSelector('shape.snapHead') + ' > .vo-mn-grp-t')).height, grpH, where + 'group title');
                await p.evaluate(() => menu.open('layout'));
                assert.equal((await box(p, rowSelector('layout.grid'))).height, rowH, where + 'switch row with a mark');
                assert.equal((await box(p, rowSelector('layout.layers'))).height, rowH, where + 'submenu row');
                /* A long status does not grow the menu bar. */
                await p.evaluate(() => { menu.close(); menu.status().textContent = 'x'.repeat(400); });
                await settle(p);
                assert.equal((await box(p, '.vo-mn')).height + 'px', vars['vo-h-menu'], where + 'menu bar with a status');
                await p.close();
            }
        });

        await check('options of a group line up with the rows outside it in every editor', async () => {
            for (const {editor, css} of list) {
                const where = editor.name + ': ';
                const p = await styledMenu(browser, css, {icons: true});
                await p.evaluate(() => menu.open('shape'));
                const got = await p.evaluate(({inside, outside, group}) => {
                    const r = sel => document.querySelector(sel).getBoundingClientRect();
                    const a = r(inside), b = r(outside), g = r(group), t = r(group + ' > .vo-mn-grp-t');
                    return {left: a.left - b.left, right: a.right - b.right, height: a.height - b.height,
                        group: [g.left - b.left, g.right - b.right], titleTop: t.top - g.top};
                }, {inside: rowSelector('shape.snapGrid'), outside: rowSelector('shape.duplicate'), group: rowSelector('shape.snapHead')});
                assert.deepEqual(got, {left: 0, right: 0, height: 0, group: [0, 0], titleTop: 0}, where + JSON.stringify(got));
                await p.close();
            }
        });

        await check('a description stands under the label without widening the list in every editor', async () => {
            for (const {editor, css, rules} of list) {
                const where = editor.name + ': ';
                /* An editor may cap the description with its own width over the shared rule: then a
                   long description widens the list only up to that width and wraps inside it. */
                const cap = rules.filter(r => r.media === null && r.selectors.some(s => !isBase(s) && /\.vo-mn \.vo-mn-d$/.test(s)))
                    .map(r => parseFloat(value(r, 'max-width'))).filter(n => !Number.isNaN(n)).pop();
                const p = await styledMenu(browser, css, {icons: true});
                const probe = () => p.evaluate(sel => {
                    const row = document.querySelector(sel), t = row.querySelector('.vo-mn-t'), d = row.querySelector('.vo-mn-d');
                    const rt = t.getBoundingClientRect(), rd = d.getBoundingClientRect();
                    const fly = row.closest('.vo-mn-drop').getBoundingClientRect();
                    return {below: rd.top >= rt.bottom - 0.5, under: Math.abs(rd.left - rt.left) <= 0.5,
                        inside: rd.right <= row.getBoundingClientRect().right + 0.5, width: fly.width, lines: rd.height,
                        desc: rd.width, column: row.querySelector('.vo-mn-tc').getBoundingClientRect().width,
                        muted: getComputedStyle(d).color !== getComputedStyle(t).color};
                }, rowSelector('info.guides.Shapes'));
                await p.evaluate(() => menu.open('info'));
                await p.click(rowSelector('info.guides'));
                const short = await probe();
                assert.deepEqual([short.below, short.under, short.inside, short.muted], [true, true, true, true], where + JSON.stringify(short));
                /* A long description wraps inside the list instead of widening it: the same menu with
                   a long text in this row. */
                await p.evaluate(() => {
                    menu.destroy();
                    const adapter = editorModule.adapter(ctx, Common.UI.Compact.MenuModel);
                    const state = adapter.itemState;
                    adapter.itemState = it => {
                        const st = state(it);
                        return it.k === 'info.guides.Shapes' ? Object.assign({}, st, {desc: 'A long description '.repeat(12)}) : st;
                    };
                    window.menu = Common.UI.Compact.MenuBar.create(adapter, {pinned: 'info'});
                    document.getElementById('host').appendChild(menu.el);
                    menu.open('info');
                });
                await p.click(rowSelector('info.guides'));
                const long = await probe();
                if (cap === undefined) assert.equal(long.width, short.width, where + 'the list keeps its width');
                else {
                    assert.ok(long.desc <= cap + 0.5, where + 'the description keeps its own width ' + cap + ': ' + long.desc);
                    /* Everything of the list but the label column stays: only the column grows, to the cap. */
                    const wanted = Math.max(short.width, short.width - short.column + cap);
                    assert.ok(Math.abs(long.width - wanted) <= 0.5, where + 'the list grows only to the description width: ' +
                        long.width + ' / ' + wanted);
                }
                assert.ok(long.lines > short.lines && long.inside, where + 'the text wraps: ' + JSON.stringify(long));
                await p.close();
            }
        });

        await check('first row of a submenu is level with its parent row in every editor', async () => {
            for (const {editor, css} of list) {
                const where = editor.name + ': ';
                const p = await styledMenu(browser, css, {icons: true, context: {layers: 2}});
                await p.evaluate(() => menu.open('layout'));
                await p.hover(rowSelector('layout.layers'));
                await p.waitForSelector('.vo-mn-fly');
                const got = await p.evaluate(sel => {
                    const fly = document.querySelector('.vo-mn-fly');
                    const first = fly.querySelector('.vo-mn-sub');
                    return {parent: document.querySelector(sel).getBoundingClientRect().top,
                        first: first.getBoundingClientRect().top, pad: parseFloat(getComputedStyle(fly).paddingTop)};
                }, rowSelector('layout.layers'));
                assert.ok(got.pad > 0, where + 'the submenu list has its own top padding');
                assert.ok(Math.abs(got.first - got.parent) <= 0.5, where + 'first submenu row at ' + got.first +
                    ', parent row at ' + got.parent + ' (list padding ' + got.pad + ')');
                await p.close();
            }
        });

        /* The submenu is placed as soon as it opens, on the first frame of its appearance:
           the list is still scaled down then, so the place does not come from its scaled box.
           A wide top padding of the list makes any scaled measure miss by a whole pixel. */
        await check('first row of a submenu is level with its parent row while the submenu appears', async () => {
            for (const {editor, css} of list) {
                for (const pad of [null, 30]) {
                    const where = editor.name + (pad ? ' with a ' + pad + 'px list padding' : '') + ': ';
                    const extra = pad ? '.vo-mn .vo-mn-drop.vo-mn-fly { padding-top: ' + pad + 'px !important; }' : '';
                    const p = await styledMenu(browser, css + extra, {icons: true, motion: true, context: {layers: 2}});
                    await p.evaluate(() => menu.open('layout'));
                    await p.hover(rowSelector('layout.layers'));
                    await p.waitForSelector('.vo-mn-fly');
                    const got = await p.evaluate(async sel => {
                        const fly = document.querySelector('.vo-mn-fly');
                        const animation = getComputedStyle(fly).animationName;
                        await Promise.all(fly.getAnimations().map(a => a.finished));
                        const first = fly.querySelector('.vo-mn-sub');
                        return {animation, parent: document.querySelector(sel).getBoundingClientRect().top,
                            first: first.getBoundingClientRect().top, pad: parseFloat(getComputedStyle(fly).paddingTop)};
                    }, rowSelector('layout.layers'));
                    assert.equal(got.animation, 'vo-pop', where + 'the submenu appears with its animation');
                    if (pad) assert.equal(got.pad, pad, where + 'list padding');
                    assert.ok(Math.abs(got.first - got.parent) <= 0.5, where + 'first submenu row at ' + got.first +
                        ', parent row at ' + got.parent + ' (list padding ' + got.pad + ')');
                    await p.close();
                }
            }
        });

        await check('disabled item differs from enabled beyond colour', async () => {
            for (const {editor, css} of list) {
                const where = editor.name + ': ';
                /* No layers: the submenu row is greyed with its reason. */
                const p = await styledMenu(browser, css, {icons: true, context: {layers: 0}});
                await p.evaluate(() => menu.open('layout'));
                await p.hover(rowSelector('layout.layers'));
                const off = await p.evaluate(sel => {
                    const row = document.querySelector(sel), cs = getComputedStyle(row);
                    return {background: cs.backgroundColor, cursor: cs.cursor, title: row.getAttribute('title'),
                        disabled: row.getAttribute('aria-disabled'), arrow: getComputedStyle(row.querySelector('.vo-mn-arrow')).color,
                        label: cs.color};
                }, rowSelector('layout.layers'));
                await p.waitForTimeout(400);
                assert.equal(await p.evaluate(() => document.querySelectorAll('.vo-mn-fly').length), 0, where + 'a greyed submenu does not open');
                assert.equal(off.background, 'rgba(0, 0, 0, 0)', where + 'no fill under the pointer');
                assert.equal(off.cursor, 'default', where + 'no click invited');
                assert.equal(off.disabled, 'true');
                assert.equal(off.title, 'The drawing has no layers', where + 'the reason on hover');
                assert.equal(off.arrow, off.label, where + 'the arrow is muted with the label');
                await p.hover(rowSelector('layout.grid'));
                const on = await box(p, rowSelector('layout.grid'));
                assert.notEqual(on.background, 'rgba(0, 0, 0, 0)', where + 'an enabled row lights up');
                await p.close();
                /* Read-only: the chosen variant keeps its dot, muted. */
                const q = await styledMenu(browser, css, {icons: true, context: {reasons: ['view']}});
                await q.evaluate(() => menu.open('shape'));
                const dot = await q.evaluate(sel => {
                    const row = document.querySelector(sel);
                    const mark = row.querySelector('.vo-mn-dot');
                    return {locked: row.classList.contains('vo-locked'), mark: !!mark,
                        color: mark && getComputedStyle(mark, '::before').backgroundColor, label: getComputedStyle(row).color};
                }, rowSelector('shape.snapGrid'));
                assert.deepEqual([dot.locked, dot.mark], [true, true], where + 'greyed choice keeps its dot');
                assert.equal(dot.color, dot.label, where + 'the dot is muted with the label');
                await q.close();
            }
        });

        await check('overflow button follows the menu bar look', async () => {
            for (const {editor, css} of list) {
                const where = editor.name + ': ';
                const p = await styledMenu(browser, css, {width: 150});
                const look = sel => p.evaluate(sel => {
                    const el = Array.from(document.querySelectorAll(sel)).filter(e => e.getClientRects().length)[0];
                    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
                    const props = ['height', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'fontFamily',
                        'fontSize', 'letterSpacing', 'lineHeight', 'color', 'borderRadius', 'borderTopWidth', 'whiteSpace'];
                    const out = {top: Math.round(r.top), height: Math.round(r.height)};
                    props.forEach(k => { out[k] = cs[k]; });
                    return out;
                }, sel);
                const more = await look('.vo-mn-more > .vo-mn-item');
                assert.ok(more && (await box(p, '.vo-mn-more')).width > 0, where + '"…" is shown on a narrow bar');
                const first = await look('.vo-mn-wrap:not(.vo-mn-more) > .vo-mn-item');
                assert.deepEqual(more, first, where + '"…" looks like a section label');
                await p.hover('.vo-mn-more > .vo-mn-item');
                const hoverMore = (await box(p, '.vo-mn-more > .vo-mn-item')).background;
                const shownSection = '.vo-mn-wrap:not(.vo-mn-more):not([style*="none"]) > .vo-mn-item';
                await p.hover(shownSection);
                assert.equal(hoverMore, (await box(p, shownSection)).background, where + 'the same fill under the pointer');
                await p.click('.vo-mn-more > .vo-mn-item');
                const list = await box(p, '.vo-mn-more > .vo-mn-drop.open');
                const btn = await box(p, '.vo-mn-more > .vo-mn-item');
                assert.ok(list && list.top >= btn.bottom, where + 'the "…" list opens under it like a section list');
                await p.close();
            }
        });

        await check('menu bar leaves its layout to the stylesheet', async () => {
            for (const {editor, css} of list) {
                const p = await styledMenu(browser, css, {width: 230});
                const st = await p.evaluate(() => {
                    const inline = Array.from(menu.el.querySelectorAll('.vo-mn-wrap, .vo-mn-item'))
                        .map(el => (el.style.flex || '') + (el.style.whiteSpace || '')).filter(Boolean);
                    const wrap = getComputedStyle(menu.el.querySelector('.vo-mn-wrap'));
                    const item = getComputedStyle(menu.el.querySelector('.vo-mn-item'));
                    return {inline, shrink: wrap.flexShrink, wrapSpace: item.whiteSpace};
                });
                assert.deepEqual(st, {inline: [], shrink: '0', wrapSpace: 'nowrap'}, editor.name);
                await p.close();
            }
        });

        await check('long status is cut with the full text in its title and keeps the sections', async () => {
            const long = 'Недостаточно прав, чтобы редактировать документ. Возможно, права доступа изменились. ' +
                'Сейчас перейти к редактированию нельзя, попробуйте ещё раз немного позже.';
            for (const {editor, css} of list) {
                const where = editor.name + ': ';
                const p = await styledMenu(browser, css);
                const tops = () => p.evaluate(() => Array.from(menu.el.querySelectorAll('.vo-mn-wrap'))
                    .filter(w => w.getClientRects().length).map(w => w.classList.contains('vo-mn-more') ? 'more' : w.firstChild.getAttribute('data-k')));
                const before = await tops();
                await p.evaluate(text => { menu.status().textContent = text; }, long);
                await settle(p);
                await settle(p);
                const st = await p.evaluate(() => {
                    const el = menu.status(), r = el.getBoundingClientRect(), b = menu.el.getBoundingClientRect();
                    return {right: r.right, barRight: b.right - parseFloat(getComputedStyle(menu.el).paddingRight),
                        cut: el.scrollWidth > el.clientWidth, title: el.getAttribute('title'),
                        overflow: getComputedStyle(el).textOverflow, width: r.width};
                });
                assert.deepEqual(await tops(), before, where + 'every section stays in the bar');
                assert.ok(st.right <= st.barRight + 0.5, where + 'the status stays inside the bar: ' + JSON.stringify(st));
                assert.equal(st.cut, true, where + 'the long text is cut');
                assert.equal(st.overflow, 'ellipsis', where + 'with an ellipsis');
                assert.equal(st.title, long, where + 'the full text on hover');
                /* A short text has no title, an empty place takes no room. */
                await p.evaluate(() => { menu.status().textContent = 'Wait'; });
                await settle(p);
                assert.equal(await p.evaluate(() => menu.status().getAttribute('title')), null, where + 'no title for a whole text');
                await p.evaluate(() => { menu.status().textContent = ''; });
                await settle(p);
                assert.equal((await box(p, '.vo-mn-status')).width, 0, where + 'an empty status takes no room');
                await p.close();
            }
        });

        await check('marks of switches and choices are drawn', async () => {
            for (const {editor, css} of list) {
                const where = editor.name + ': ';
                const p = await styledMenu(browser, css, {icons: true});
                await p.evaluate(() => menu.open('layout'));
                const check = await p.evaluate(sel => {
                    const mark = document.querySelector(sel + ' .vo-mn-chk');
                    return mark && {glyph: (mark.querySelector('[data-i]') || {}).getAttribute && mark.querySelector('[data-i]').getAttribute('data-i'),
                        text: mark.textContent};
                }, rowSelector('layout.grid'));
                assert.deepEqual(check, {glyph: 'checkMenu', text: ''}, where + 'the switch mark is the menu check of the set');
                await p.evaluate(() => menu.open('shape'));
                const dot = await p.evaluate(sel => {
                    const row = document.querySelector(sel), mark = row.querySelector('.vo-mn-chk');
                    const before = mark && getComputedStyle(mark, '::before');
                    const r = mark && mark.getBoundingClientRect(), rr = row.getBoundingClientRect();
                    return mark && {dot: mark.classList.contains('vo-mn-dot'), text: mark.textContent,
                        w: parseFloat(before.width), h: parseFloat(before.height), radius: before.borderRadius,
                        color: before.backgroundColor, centred: Math.abs((r.top + r.height / 2) - (rr.top + rr.height / 2)) <= 1};
                }, rowSelector('shape.snapGrid'));
                const accent = await p.evaluate(() => getComputedStyle(document.body).getPropertyValue('--vo-menu-mark').trim());
                assert.ok(dot && dot.dot && dot.text === '', where + 'the choice mark is a drawn dot: ' + JSON.stringify(dot));
                assert.ok(dot.w > 0 && dot.w === dot.h && dot.radius === '50%', where + 'a round dot: ' + JSON.stringify(dot));
                assert.ok(dot.centred, where + 'the dot sits on the middle of the row');
                const probe = await p.evaluate(c => { const s = document.createElement('span'); s.style.color = c; document.body.appendChild(s);
                    const v = getComputedStyle(s).color; s.remove(); return v; }, accent);
                assert.equal(dot.color, probe, where + 'the dot has the mark colour');
                await p.close();
            }
        });
    } finally {
        if (browser) await browser.close();
    }

    done();
})().catch(error => {
    console.error('FAIL', error && error.stack || error);
    process.exitCode = 1;
});
