/* Run: node test/unit-tests/common/compact/layer-isolation.cjs [folder]
 * Shared compact files (every compact/ folder under apps/common) do not reach into an
 * editor: no editor application namespace and no key of the document or PDF editor menu
 * catalog.
 * The editor builds its menu through its own adapter; the shared layer only knows the
 * contract. The optional argument scans another folder instead, for a negative control.
 * Nor do they know the disabled reasons of the document editor: the shared layer knows four
 * common reason codes, the codes and texts of the review shown, form filling and «for everyone»
 * are declared by the documents adapter.
 * Common controllers (apps/common/main/lib/controller) run in every editor and do not reach
 * into the compact view of one: they ask the shared layer (the shell registry) instead.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../../..');
const COMMON = path.join(ROOT, 'apps/common');
const CONTROLLERS = path.join(COMMON, 'main/lib/controller');
const CONTROLLER_FORBIDDEN = [
    {what: 'document editor compact view', re: /(^|[^\w.$])DE\s*\.\s*Views\s*\.\s*Compact/},
    {what: 'spreadsheet editor compact view', re: /(^|[^\w.$])SSE\s*\.\s*Views\s*\.\s*Compact/}
];
const FORBIDDEN = [
    {what: 'document editor namespace', re: /(^|[^\w.$])DE\s*\./},
    {what: 'spreadsheet editor namespace', re: /(^|[^\w.$])SSE\s*\./},
    {what: 'document editor menu catalog', re: /DocumentActions/},
    {what: 'PDF editor namespace', re: /(^|[^\w.$])PDFE\s*\./},
    {what: 'PDF editor menu catalog', re: /PdfActions/}
];

/* Disabled reasons the document editor declares on top of the common ones: their codes as string
   literals and their text keys. */
const REASON_FORBIDDEN = [
    {what: 'documents reason code', re: /(['"`])(final|original|form|forAll)\1/},
    {what: 'documents reason key', re: /textReason(Final|Original|Form|ForAll)\b/}
];

/* Files of every compact/ folder below base, at any depth. */
function compactFiles(base) {
    const out = [];
    (function walk(dir, inside) {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, inside || entry.name === 'compact');
            else if (inside) out.push(full);
        }
    })(base, false);
    return out;
}

/* Scripts right in a folder of controllers. */
function controllerFiles(dir) {
    return fs.readdirSync(dir, {withFileTypes: true}).filter(e => e.isFile() && e.name.endsWith('.js'))
        .map(e => path.join(dir, e.name));
}

/* Findings: file, line and what was found. Comments count: a shared file explains the contract,
   not the catalog of one editor. */
function scan(files, rules) {
    const found = [];
    for (const file of files) {
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
            for (const rule of rules || FORBIDDEN)
                if (rule.re.test(line)) found.push(`${path.relative(ROOT, file)}:${i + 1}: ${rule.what}`);
        });
    }
    return found;
}

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

check('shared compact files mention no editor namespace or menu catalog key', () => {
    const files = process.argv[2] ? compactFiles(path.resolve(process.argv[2])) : compactFiles(COMMON);
    assert.ok(files.length, 'shared compact files exist');
    if (!process.argv[2])
        assert.ok(files.some(f => f.endsWith(path.join('lib', 'view', 'compact', 'MenuModel.js'))), 'the menu model is scanned');
    const found = scan(files);
    assert.deepEqual(found, [], found.join('\n'));
});

check('shared compact files mention no documents reason code or key', () => {
    const files = process.argv[2] ? compactFiles(path.resolve(process.argv[2])) : compactFiles(COMMON);
    assert.ok(files.length, 'shared compact files exist');
    if (!process.argv[2])
        assert.ok(files.some(f => f.endsWith(path.join('lib', 'view', 'compact', 'MenuBar.js'))), 'the menu bar is scanned');
    const found = scan(files, REASON_FORBIDDEN);
    assert.deepEqual(found, [], found.join('\n'));
});

check('the scan reports editor references', () => {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'compact-isolation-'));
    try {
        const file = path.join(dir, 'compact', 'Probe.js');
        fs.mkdirSync(path.dirname(file));
        fs.writeFileSync(file, [
            'var a = DE.Views.CompactShell;',
            'if (window.SSE) SSE.getController("Main");',
            "var key = 'DE.Views.DocumentActions.textFile';",
            'var ok = Common.UI.Compact.MenuModel; // MODE.x, SIDE.y',
            'var b = obj.DE.x;',
            'if (window.PDFE) PDFE.getController("Main");',
            "var pdfKey = 'PDFE.Views.PdfActions.textFile';",
            'var c = obj.PDFE.x; // PDFEX.y, MYPDFE.z'
        ].join('\n'));
        const found = scan(compactFiles(dir));
        assert.equal(found.length, 7, found.join('\n'));
        assert.ok(found.every(f => !/:4:|:5:|:8:/.test(f)), found.join('\n'));
        assert.deepEqual(found.filter(f => /PDF editor/.test(f)).map(f => f.replace(/^.*Probe\.js:/, '')),
            ['6: PDF editor namespace', '7: PDF editor namespace', '7: PDF editor menu catalog'], found.join('\n'));

        const reasons = path.join(dir, 'compact', 'Reasons.js');
        fs.writeFileSync(reasons, [
            "var order = ['limit', 'final', \"original\", 'form', 'forAll'];",
            'var t = MenuBar.textReasonForAll || MenuBar.textReasonFinal;',
            "var common = ['limit', 'offline', 'view', 'protected']; // final, the form of the row",
            "var key = MenuBar.textReasonFormat; var name = 'formula';"
        ].join('\n'));
        const inReasons = scan([reasons], REASON_FORBIDDEN);
        assert.deepEqual(inReasons.map(f => f.replace(/^.*Reasons\.js:/, '')),
            ['1: documents reason code', '2: documents reason key'], inReasons.join('\n'));

        const controller = path.join(dir, 'Probe.js');
        fs.writeFileSync(controller, [
            'var shell = window.DE && DE.Views && DE.Views.CompactShell;',
            'var bar = SSE.Views.CompactMenu;',
            'var shells = Common.UI.Compact.Shells;',
            'var view = DE.Views.Toolbar;'
        ].join('\n'));
        const inControllers = scan(controllerFiles(dir), CONTROLLER_FORBIDDEN);
        assert.deepEqual(inControllers.map(f => f.replace(/^.*Probe\.js:/, '')),
            ['1: document editor compact view', '2: spreadsheet editor compact view'], inControllers.join('\n'));
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

check('common controllers mention no editor compact view', () => {
    const files = controllerFiles(CONTROLLERS);
    assert.ok(files.some(f => f.endsWith('ReviewChanges.js')), 'the review controller is scanned');
    const found = scan(files, CONTROLLER_FORBIDDEN);
    assert.deepEqual(found, [], found.join('\n'));
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
