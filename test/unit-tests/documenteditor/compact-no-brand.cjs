/* Run: node test/unit-tests/documenteditor/compact-no-brand.cjs
 * Our compact files do not name the engine brand, neither in comments nor in names:
 * instead of it, "stock editor"
 * or "engine" by meaning. The modules are read as text, not loaded in vm.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const BRAND = /onlyoffice/i;

let passed = 0, failed = 0;
function test(name, body) {
    try {
        body();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
        failed++;
    }
}

function brandLines(files) {
    const hits = [];
    files.forEach(file => {
        fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
            if (BRAND.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    });
    return hits;
}

const VIEW = 'apps/documenteditor/main/app/view/';
const SHELL_FILES = [
    VIEW + 'CompactShell.js',
    VIEW + 'CompactToolbar.js'
];

const COMPACT_FILES = SHELL_FILES.concat([
    VIEW + 'SelectionBubble.js',
    VIEW + 'SlashMenu.js',
    VIEW + 'OutlineRail.js',
    VIEW + 'Icons.js',
    'apps/common/main/lib/view/compact/Icons.js',
    'apps/documenteditor/main/resources/less/compact-shell.less'
]);

test('test_compact_shell_sources_have_no_brand_word', () => {
    assert.deepEqual(brandLines(SHELL_FILES), []);
});

test('test_compact_sources_have_no_brand_word', () => {
    assert.deepEqual(brandLines(COMPACT_FILES), []);
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
