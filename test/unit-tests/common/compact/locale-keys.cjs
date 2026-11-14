/* Run: node test/unit-tests/common/compact/locale-keys.cjs [folder with the shared compact modules]
 * Strings of the shared compact layer live in the locale of every editor that uses it: the
 * shared modules declare English defaults (text…, txt…, tip… properties of
 * Common.UI.Compact.*), and each editor of lib/editors.cjs with an application folder has every
 * such key in its ru and en locale, not empty, the Russian one in Russian, and no shared key the
 * shared layer does not declare (a string that moved to an editor leaves the shared keys). The optional argument
 * points to another folder of shared modules for a negative control.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const editors = require('./lib/editors.cjs');

const ROOT = path.resolve(__dirname, '../../../..');
const SHARED = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'apps/common/main/lib/view/compact');

/* Keys of the shared strings: every module of the folder loaded in vm, the model first. */
function sharedKeys(folder) {
    const context = {navigator: {platform: 'Linux'}};
    context.window = context;
    /* Stock modules a shared module builds on (the stock window under the About window): stand-ins
       that only let the module load; they declare no strings of the shared layer. */
    context._ = {extend: Object.assign};
    context.Common = {UI: {Window: {extend: proto => Object.assign(function () {}, {prototype: proto})}}};
    context.define = (deps, factory) => factory.apply(null, deps.map(d => {
        const shared = context.Common && context.Common.UI && context.Common.UI.Compact;
        return shared && shared[d.split('/').pop()];
    }));
    vm.createContext(context);
    const files = fs.readdirSync(folder).filter(f => f.endsWith('.js'))
        .sort((a, b) => (b === 'MenuModel.js') - (a === 'MenuModel.js') || a.localeCompare(b));
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(folder, file), 'utf8'), context, {filename: file});
    const compact = (context.Common && context.Common.UI && context.Common.UI.Compact) || {};
    const keys = [];
    for (const [name, value] of Object.entries(compact)) {
        if (!value || typeof value !== 'object') continue;
        for (const [prop, text] of Object.entries(value))
            if (/^(text|txt|tip)[A-Z]/.test(prop) && typeof text === 'string') keys.push(`Common.UI.Compact.${name}.${prop}`);
    }
    return keys.sort();
}

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

check('each editor locale has every shared key in ru and en', () => {
    const keys = sharedKeys(SHARED);
    assert.ok(keys.length, 'the shared layer declares its strings');
    const withLocale = editors.filter(e => e.app);
    assert.ok(withLocale.length, 'lib/editors.cjs lists an editor with a locale');
    const problems = [];
    for (const editor of withLocale) {
        for (const lang of ['en', 'ru']) {
            const file = path.join(ROOT, editor.app, 'locale', lang + '.json');
            const locale = JSON.parse(fs.readFileSync(file, 'utf8'));
            for (const key of keys) {
                const value = locale[key];
                if (typeof value !== 'string' || !value.trim()) problems.push(`${editor.name} ${lang}: no ${key}`);
                else if (lang === 'ru' && !/[А-Яа-яЁё]/.test(value)) problems.push(`${editor.name} ru: ${key} is not in Russian`);
            }
        }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
});

check('no editor locale keeps a shared key the shared layer does not declare', () => {
    const keys = new Set(sharedKeys(SHARED));
    const problems = [];
    for (const editor of editors.filter(e => e.app)) {
        for (const lang of ['en', 'ru']) {
            const file = path.join(ROOT, editor.app, 'locale', lang + '.json');
            const locale = JSON.parse(fs.readFileSync(file, 'utf8'));
            for (const key of Object.keys(locale))
                if (/^Common\.UI\.Compact\.[A-Za-z]+\.(text|txt|tip)[A-Z]/.test(key) && !keys.has(key))
                    problems.push(`${editor.name} ${lang}: ${key} is not declared by the shared layer`);
        }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
