/* Run: node test/unit-tests/presentationeditor/compact-parity.cjs [compact-shell.less [CompactShell.js]]
 * Parity of the presentation shell with the document compact: row heights (JS and LESS),
 * --vo-* tokens under body.vo-compact and body.vo-boot (and under the dark theme), the header look
 * (its resulting numbers in documents are also the prototype look) at rest, on hover,
 * press and focus, a locked mode switch (the stock editing ban) like the
 * disabled document mode button, zone styles are imported only by
 * compact-shell.less, exactly once, and app.less imports it last.
 * Documents are read without changes. The optional arguments are paths to copies of the presentation
 * files for checking on a corrupted copy.
 * LESS is compiled by the less package from build/node_modules (of the tree or the main web-apps copy).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const PE_LESS_DIR = path.join(ROOT, 'apps/presentationeditor/main/resources/less');
const PE_LESS = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PE_LESS_DIR, 'compact-shell.less');
const PE_JS = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'apps/presentationeditor/main/app/view/CompactShell.js');
const DE_LESS = path.join(ROOT, 'apps/documenteditor/main/resources/less/compact-shell.less');
const DE_JS = path.join(ROOT, 'apps/documenteditor/main/app/view/CompactShell.js');
const ZONE_STYLES = ['compact-menu.less', 'compact-toolbar.less', 'compact-panel.less', 'compact-areas.less',
    'compact-galleries.less', 'compact-windows.less'];

const read = f => fs.readFileSync(f, 'utf8');

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

/* Documents together with the shared compact layer (apps/common/.../compact), as app.less includes them. */
async function compile(file) {
    if (file === DE_LESS) return require('./acceptance/shell-harness.cjs').compileDocumentsLess();
    /* Presentations — like documents: with the shared compact layer, in the order of their app.less. */
    if (file === path.join(PE_LESS_DIR, 'compact-shell.less')) return require('./acceptance/shell-harness.cjs').compilePresentationLess();
    const out = await lessCompiler().render(read(file), {filename: file, javascriptEnabled: true});
    return out.css;
}

/* Flat CSS rules: [{sels: [string], decls: [[property, value]]}], @media and other blocks go inside. */
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
            if (i > 0) decls.push([d.slice(0, i).trim(), d.slice(i + 1).trim()]);
        }
        out.push({sels: prelude.replace(/^.*\{/, '').split(',').map(s => s.trim().replace(/\s+/g, ' ')), decls});
    }
    return out;
}

/* --vo-* values on body with the given classes by the cascade: only rules of the form
   body.a.b, which both compacts write; the weight is the number of classes, on a tie the order. */
function tokensFor(list, classes) {
    const won = {};
    list.forEach((r, order) => {
        let spec = -1;
        for (const s of r.sels) {
            const m = /^body((?:\.[\w-]+)+)$/.exec(s);
            if (!m) continue;
            const need = m[1].split('.').filter(Boolean);
            if (need.every(c => classes.includes(c))) spec = Math.max(spec, need.length);
        }
        if (spec < 0) return;
        for (const [p, v] of r.decls) {
            if (!p.startsWith('--vo-')) continue;
            const cur = won[p];
            if (!cur || spec > cur.spec || (spec === cur.spec && order >= cur.order)) won[p] = {spec, order, value: v.toLowerCase().replace(/\s+/g, '')};
        }
    });
    const flat = {};
    for (const k of Object.keys(won).sort()) flat[k] = won[k].value;
    return flat;
}

/* Row heights of the current header of the documents and spreadsheets compact: name 46, menu 30, the panel
   card 44 with a gap of 4 above and 8 below (the card top at 80). The documents editor copy
   in this tree is the former one, heights are no longer compared with it. */
const SHELL_HEIGHTS = {H_HEADER: 46, H_MENU: 30, H_TB_GAP_TOP: 4, H_TOOLBAR: 44, H_TB_GAP: 8, H_STATUS: 0};
const LESS_HEIGHTS = {'@vo-h-header': 46, '@vo-h-menu': 30, '@vo-tb-gap-top': 4, '@vo-h-toolbar': 44, '@vo-tb-gap': 8, '@vo-h-status': 30};

function jsHeights(src, where) {
    const out = {};
    for (const k of Object.keys(SHELL_HEIGHTS)) {
        const m = new RegExp('\\b' + k + '\\s*=\\s*(\\d+)').exec(src);
        assert.ok(m, where + ': ' + k + ' is not declared');
        out[k] = +m[1];
    }
    return out;
}

/* A LESS variable takes effect by the last declaration in scope. */
function lessHeights(src, where) {
    const out = {};
    for (const k of Object.keys(LESS_HEIGHTS)) {
        const all = Array.from(src.matchAll(new RegExp('^' + k + '\\s*:\\s*(\\d+)px', 'gm')));
        assert.ok(all.length, where + ': ' + k + ' is not declared');
        out[k] = +all[all.length - 1][1];
    }
    return out;
}

const checks = [];
const check = (name, fn) => checks.push({name, fn});

check('parity_heights_match_documents_and_sheets', async () => {
    const js = jsHeights(read(PE_JS), 'presentations');
    assert.deepEqual(js, SHELL_HEIGHTS, 'row heights differ from the documents and sheets header');
    const pe = lessHeights(read(PE_LESS), 'presentations');
    assert.deepEqual(pe, LESS_HEIGHTS, 'LESS row heights differ from the documents and sheets header');
    assert.deepEqual([js.H_HEADER, js.H_MENU, js.H_TB_GAP_TOP, js.H_TOOLBAR, js.H_TB_GAP],
        [pe['@vo-h-header'], pe['@vo-h-menu'], pe['@vo-tb-gap-top'], pe['@vo-h-toolbar'], pe['@vo-tb-gap']], 'JS heights and their LESS pairs differ');
});

check('parity_tokens_match_documents_incl_boot', async () => {
    const pe = rules(await compile(PE_LESS));
    const de = rules(await compile(DE_LESS));
    /* Both have the shared menu bar of the compact layer: its --vo-menu-* tokens are compared with the rest. */
    for (const classes of [['vo-compact'], ['vo-boot'], ['vo-compact', 'theme-type-dark'], ['vo-boot', 'theme-type-dark']]) {
        const want = tokensFor(de, classes);
        assert.ok(Object.keys(want).length > 40, 'documents tokens are not found for ' + classes.join('.'));
        assert.deepEqual(tokensFor(pe, classes), want, 'tokens differ for body.' + classes.join('.'));
    }
});

/* --- Header look ----------------------------------------------------------
   The cascade over the compiled styles is of the acceptance fixtures (acceptance/
   shell-harness.cjs). The cascade does not see dynamic states, so
   :hover, :active, :focus and :focus-visible are replaced by classes, and a node
   in a state gets that class. The nodes are a model of each compact's header
   markup: only what the cascade reads. */
const STATE_CLASS = {hover: 'vo-st-hover', active: 'vo-st-active', focus: 'vo-st-focus', fv: 'vo-st-fv'};

function stateCss(css) {
    return css.replace(/:focus-visible/g, '.' + STATE_CLASS.fv)
        .replace(/:focus(?![-\w])/g, '.' + STATE_CLASS.focus)
        .replace(/:hover/g, '.' + STATE_CLASS.hover)
        .replace(/:active/g, '.' + STATE_CLASS.active);
}

function makeNode(spec, parent) {
    const m = /^(\w+)((?:[#.][\w-]+)*)$/.exec(spec);
    assert.ok(m, 'bad node spec ' + spec);
    const attrs = {};
    const classes = [];
    m[2].replace(/([#.])([\w-]+)/g, (all, k, v) => { if (k === '#') attrs.id = v; else classes.push(v); return all; });
    if (classes.length) attrs.class = classes.join(' ');
    const el = {
        nodeType: 1, localName: m[1], childNodes: [], parentNode: parent || null, style: null,
        ownerDocument: {activeElement: null, documentElement: null},
        getAttribute: k => (k in attrs ? attrs[k] : null),
        hasAttribute: k => k in attrs,
        setAttribute: (k, v) => { attrs[k] = String(v); },
        contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; },
        get previousElementSibling() { const s = this.parentNode ? this.parentNode.childNodes : []; return s[s.indexOf(this) - 1] || null; }
    };
    if (parent) parent.childNodes.push(el);
    return el;
}

/* A header with the edit right: a title field, "Saved", history, "Download ▾" with
   an open list, access, a mode switch with an open list. The classes are
   the ones buildHeader sets in presentations and in documents. */
function headerModel(pe) {
    const n = makeNode;
    const body = n('body.vo-compact');
    const shell = n('div#vo-shell', body);
    const hd = n('div.vo-hd', pe ? n('div#vo-header.vo-row', shell) : shell);
    const title = n('input.vo-hd-title', hd);
    const state = n('span.vo-hd-state.saved', hd);
    const stateIcon = n('span.vo-air', state);
    const right = n('div.vo-hd-right', hd);
    if (pe) n('span#vo-hdr-show.vo-hdr-show', right);
    const history = n(pe ? 'button.vo-ib.vo-hd-history' : 'button.vo-ib', right);
    n('span.vo-air', history);
    const dlWrap = n('span.vo-pop-wrap.vo-download', right);
    const dl = n('button.vo-ib.vo-outlined', dlWrap);
    n('span.vo-air', dl);
    const dlPop = n('div.vo-pop.vo-pop-list', dlWrap);
    const dlItem = n('button.vo-pop-item', dlPop);
    const dlIcon = n('span.vo-pop-i', dlItem);
    n('span.vo-air', dlIcon);
    n(pe ? 'span.vo-pop-t' : 'span', dlItem);
    const dlSep = n('div.vo-pop-sep', dlPop);
    n('button.vo-pop-item', dlPop);
    const share = n(pe ? 'button.vo-ib.vo-hd-sharing.vo-tinted' : 'button.vo-ib.vo-tinted', right);
    n('span.vo-air', share);
    const modeWrap = n('span.vo-pop-wrap.vo-docmode', right);
    const mode = n('button.vo-mode.accent', modeWrap);
    n(pe ? 'span.vo-mode-label' : 'span', mode);
    const caret = n('span.vo-heading-caret', mode);
    const caretIcon = n('span.vo-air', caret);
    const modePop = n('div.vo-pop.vo-pop-list.vo-pop-rich', modeWrap);
    const modeItem = n('button.vo-pop-item.on', modePop);
    const modeIcon = n('span.vo-pop-i', modeItem);
    n('span.vo-air', modeIcon);
    const modeText = n('span.vo-pop-text', modeItem);
    const modeT = n('span.vo-pop-t', modeText);
    const modeD = n('span.vo-pop-d', modeText);
    const modeCheck = n('span.vo-pop-check', modeItem);
    n('span.vo-air', modeCheck);
    return {hd, title, state, stateIcon, right, history, dl, dlPop, dlItem, dlIcon, dlSep, share, mode, caret, caretIcon,
        modePop, modeItem, modeText, modeT, modeD, modeCheck};
}

/* A property value after the cascade, with shorthand parsing (padding,
   margin, border, background), variables and inheritance. */
const SIDES = ['top', 'right', 'bottom', 'left'];
function boxSide(value, side) {
    const v = value.trim().split(/\s+/);
    const i = SIDES.indexOf(side);
    return v.length === 1 ? v[0] : v.length === 2 ? v[i % 2] : v.length === 3 ? v[i === 3 ? 1 : i] : v[i];
}
function borderPart(value, part) {
    const t = value.trim().split(/\s+(?![^(]*\))/);
    if (t.length === 1 && t[0] === 'none') return part === 'style' ? 'none' : part === 'width' ? '0' : '';
    if (part === 'style') return t.find(x => /^(none|solid|dashed|dotted|double|hidden)$/.test(x)) || 'none';
    if (part === 'width') return t.find(x => /^[\d.]+(px|em)?$|^0$/.test(x)) || 'medium';
    return t.find(x => !/^(none|solid|dashed|dotted|double|hidden)$/.test(x) && !/^[\d.]+(px|em)?$/.test(x)) || 'currentcolor';
}
function sources(prop) {
    let m = /^(padding|margin)-(top|right|bottom|left)$/.exec(prop);
    if (m) return {[m[1]]: v => boxSide(v, m[2]), [prop]: v => v};
    m = /^border-top-(width|style|color)$/.exec(prop);
    if (m) return {border: v => borderPart(v, m[1]), 'border-top': v => borderPart(v, m[1]),
        ['border-' + m[1]]: v => boxSide(v, 'top'), [prop]: v => v};
    return null;
}
function bySpec(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
}
function look(cascade, el, prop) {
    const src = sources(prop);
    if (!src) return cascade.value(el, prop);
    let best = null;
    for (const e of cascade.candidates(el)) {
        e.rule.decls.forEach((d, di) => {
            if (!(d.prop in src)) return;
            const c = {value: src[d.prop](d.value), important: d.important, spec: e.sel.cx.spec, order: e.rule.order * 1000 + di};
            const better = !best || (c.important !== best.important ? c.important
                : (bySpec(c.spec, best.spec) || c.order - best.order) > 0);
            if (better) best = c;
        });
    }
    return best ? cascade.resolveVars(el, best.value, 1) : '';
}

function normLook(v) {
    const H = harness();
    let s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/,\s*/g, ',');
    s = s.replace(/(^|[\s(,-])\.(\d)/g, '$10.$2').replace(/\b0px\b/g, '0');
    if (s === 'transparent') s = 'rgba(0,0,0,0)';
    const c = H.parseColor(s);
    if (c) s = 'rgba(' + [c.r, c.g, c.b, Math.round(c.a * 1000) / 1000].join(',') + ')';
    return s;
}

let harnessCache = null;
function harness() { return harnessCache || (harnessCache = require('./acceptance/shell-harness.cjs')); }

/* What is compared: a model node, a state, properties. Outside the comparison (decisions outside
   parity): the font family (the shared @vo-font token, in documents Inter goes first),
   truncation of a long title (with an ellipsis in presentations), line height (in
   documents it is inherited from the editor body, in presentations it is normal, as in the prototype). */
const HEADER_LOOK = [
    ['hd', null, ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap', 'height', 'font-size']],
    ['title', null, ['font-size', 'font-weight', 'letter-spacing', 'color', 'padding-top', 'padding-left', 'margin-left', 'border-radius', 'max-width']],
    ['title', 'hover', ['background-color']],
    ['title', 'focus', ['background-color', 'box-shadow']],
    ['state', null, ['height', 'color', 'background-color', 'padding-left']],
    ['stateIcon', null, ['width', 'height']],
    ['right', null, ['gap', 'position', 'top', 'margin-left']],
    ['history', null, ['height', 'min-width', 'padding-left', 'padding-right', 'border-top-width', 'border-radius', 'background-color', 'color']],
    ['history', 'hover', ['background-color', 'color']],
    ['history', 'active', ['background-color']],
    ['history', 'fv', ['box-shadow']],
    ['dl', null, ['width', 'min-width', 'height', 'padding-left', 'padding-right', 'border-top-width', 'border-top-style',
        'background-color', 'color', 'box-shadow']],
    ['dl', 'hover', ['border-top-style', 'background-color', 'color', 'box-shadow']],
    ['dl', 'active', ['border-top-style', 'background-color', 'color']],
    ['dl', 'fv', ['box-shadow']],
    ['share', null, ['background-color', 'color']],
    ['share', 'hover', ['background-color', 'color']],
    ['share', 'active', ['background-color']],
    ['mode', null, ['height', 'padding-left', 'padding-right', 'border-top-width', 'border-top-color', 'border-radius', 'font-size',
        'font-weight', 'letter-spacing', 'background-color', 'color']],
    ['mode', 'hover', ['background-color', 'border-top-color']],
    ['mode', 'fv', ['box-shadow']],
    ['caret', null, ['color']],
    ['caretIcon', null, ['width', 'height']],
    ['dlPop', null, ['min-width', 'padding-top', 'padding-bottom', 'border-radius', 'box-shadow', 'background-color', 'top', 'right']],
    ['dlItem', null, ['min-height', 'padding-left', 'padding-right', 'gap', 'font-size', 'letter-spacing', 'color', 'position']],
    ['dlItem', 'hover', ['background-color']],
    ['dlIcon', null, ['color']],
    ['dlSep', null, ['height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'background-color']],
    ['modePop', null, ['min-width', 'padding-top', 'padding-bottom']],
    ['modeItem', null, ['min-height', 'padding-left', 'padding-right']],
    ['modeText', null, ['gap']],
    ['modeT', null, ['font-weight']],
    ['modeD', null, ['color', 'font-size']],
    ['modeCheck', null, ['position', 'top', 'right', 'transform', 'color']]
];

function readLook(cascade, model, list) {
    const out = {};
    for (const [name, state, props] of list || HEADER_LOOK) {
        const el = model[name];
        const cls = (el.getAttribute('class') || '');
        if (state) el.setAttribute('class', cls + ' ' + STATE_CLASS[state]);
        for (const p of props) out[name + (state ? ':' + state : '') + ' ' + p] = normLook(look(cascade, el, p));
        el.setAttribute('class', cls);
    }
    return out;
}

check('parity_header_look_matches_documents_and_sheets', async () => {
    const H = harness();
    const pe = readLook(new H.Cascade(stateCss(await compile(PE_LESS))), headerModel(true));
    const de = readLook(new H.Cascade(stateCss(await compile(DE_LESS))), headerModel(false));
    /* Documents give values: the comparison is not empty. */
    for (const k of ['dl border-top-style', 'right gap', 'mode height', 'dlPop min-width', 'dlSep background-color'])
        assert.ok(de[k], 'documents give no value for ' + k);
    /* What the header was brought back for: "Download" is a bare 24 icon without a border and backing
       at rest, on hover and on press; the cluster has step 19, centered on the name (25), as in the
       current documents and spreadsheets header. The documents copy in this tree still keeps the
       cluster 3 below center, so these two values are not compared with it. */
    assert.deepEqual([pe['dl border-top-style'], pe['dl:hover border-top-style'], pe['dl:active border-top-style']], ['none', 'none', 'none'],
        '"Download" has a frame');
    assert.deepEqual([pe['dl background-color'], pe['dl:hover background-color'], pe['dl:active background-color']],
        ['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)'], '"Download" has a fill');
    assert.deepEqual([pe['dl width'], pe['dl height'], pe['right gap'], pe['right top'] || '0px'], ['24px', '24px', '19px', '0px'], 'download box or cluster step');
    const LIFT = ['right position', 'right top'];
    /* The current documents and spreadsheets header has grown compared to the documents copy in this tree: padding
       10 / 6 and 20 on the left, row 46, name 18 with spacing −0.01em, "Saved" 18, list captions
       without spacing. These values are compared with it, the rest with the copy. */
    const NOW = {'hd padding-top': '10px', 'hd padding-bottom': '6px', 'hd padding-left': '20px', 'hd height': '46px',
        'hd font-size': '18px', 'title font-size': '18px', 'title letter-spacing': '-0.01em', 'state height': '18px',
        'stateIcon width': '18px', 'stateIcon height': '18px', 'dlItem letter-spacing': 'normal'};
    Object.keys(NOW).forEach(k => assert.ok(k in de, 'documents give no value for ' + k));
    const want = Object.assign({}, de, NOW);
    const diff = Object.keys(want).filter(k => !LIFT.includes(k) && pe[k] !== want[k]).map(k => k + ': ' + pe[k] + ' != ' + want[k]);
    assert.deepEqual(diff, [], 'the header differs from the documents');
});

/* A mode switch under the stock editing ban (version history, connection loss) looks like the
   disabled document mode button: the accent is removed, the caption and chevron are gray, hover and
   press do not change the look. */
const LOCKED_MODE_LOOK = [
    ['mode', null, ['background-color', 'border-top-color', 'color', 'font-weight', 'cursor']],
    ['mode', 'hover', ['background-color', 'border-top-color', 'color']],
    ['mode', 'active', ['background-color', 'color']],
    ['caret', null, ['color']]
];

check('parity_locked_mode_switch_matches_documents', async () => {
    const H = harness();
    const locked = async (file, pe) => {
        const model = headerModel(pe);
        model.mode.setAttribute('class', model.mode.getAttribute('class') + ' vo-locked');
        return readLook(new H.Cascade(stateCss(await compile(file))), model, LOCKED_MODE_LOOK);
    };
    const pe = await locked(PE_LESS, true);
    const de = await locked(DE_LESS, false);
    const open = readLook(new H.Cascade(stateCss(await compile(PE_LESS))), headerModel(true), LOCKED_MODE_LOOK);
    assert.ok(de['mode background-color'] && de['mode color'], 'documents give no locked look');
    assert.notEqual(pe['mode background-color'], open['mode background-color'], 'the locked switch keeps the accent fill');
    const diff = Object.keys(de).filter(k => pe[k] !== de[k]).map(k => k + ': ' + pe[k] + ' != ' + de[k]);
    assert.deepEqual(diff, [], 'the locked mode switch differs from the documents');
});

check('zone_styles_imported_once', async () => {
    const imports = src => Array.from(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        .matchAll(/@import\s+(?:\([^)]*\)\s*)?["']([^"']+)["']/g), m => path.basename(m[1]));
    const shell = imports(read(PE_LESS));
    for (const z of ZONE_STYLES) {
        assert.equal(shell.filter(f => f === z).length, 1, z + ' is not imported exactly once by compact-shell.less');
        assert.ok(fs.existsSync(path.join(path.dirname(PE_LESS), z)), z + ' is missing');
    }
    const app = read(path.join(PE_LESS_DIR, 'app.less'));
    const appImports = imports(app);
    assert.equal(appImports.filter(f => f === 'compact-shell.less').length, 1, 'app.less imports compact-shell.less not once');
    assert.deepEqual(appImports.filter(f => ZONE_STYLES.includes(f)), [], 'app.less imports zone styles itself');
    const lines = app.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    assert.equal(lines[lines.length - 1], '@import "compact-shell.less";', 'compact-shell.less is not the last import of app.less');
    for (const z of ZONE_STYLES) {
        const own = imports(read(path.join(PE_LESS_DIR, z)));
        assert.deepEqual(own.filter(f => f === 'compact-shell.less' || ZONE_STYLES.includes(f)), [], z + ' imports shell styles');
    }
});

(async () => {
    let passed = 0, failed = 0;
    for (const c of checks) {
        try { await c.fn(); console.log('ok ' + c.name); passed++; }
        catch (e) { console.log('FAIL ' + c.name + ': ' + String(e.message).replace(/\s+/g, ' ').slice(0, 1200)); failed++; }
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})();
