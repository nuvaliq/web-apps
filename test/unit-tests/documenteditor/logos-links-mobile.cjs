/* Run: node test/unit-tests/documenteditor/logos-links-mobile.cjs
 * The optional argument is the path to main.jsx for checking the baseline.
 * The documents editor mobile header does not draw the ONLYOFFICE logo and does not lead
 * to the publisher's address; JSX is not loaded in vm, so the source is checked.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const file = process.argv[2] || path.resolve(__dirname,
    '../../../apps/documenteditor/mobile/src/page/main.jsx');
const source = fs.readFileSync(file, 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('PASS', name);
        passed++;
    } catch (error) {
        console.error('FAIL', name, error.message);
        failed++;
    }
}

test('test_mobile_header_has_no_logo', () => {
    for (const token of ['__PUBLISHER_URL__', 'icon-logo', 'main-logo', 'custom-logo-image',
                         'page-with-logo', 'navbar-with-logo'])
        assert.ok(!source.includes(token), 'main.jsx still contains ' + token);
    // The logo is not drawn under any branding: there is no show branch.
    assert.ok(!/isHideLogo\s*=\s*false/.test(source), 'logo can still be shown');
    assert.ok(!/!\s*isHideLogo\s*&&/.test(source), 'logo branch is still rendered');
    // The branding flag for the page context is computed as before.
    assert.match(source, /isBranding\s*=\s*appOptions\.canBranding\s*\|\|\s*appOptions\.canBrandingExt/);
    assert.match(source, /<MainContext\.Provider[\s\S]*?isBranding,/);
    // Icon from framework7-react was needed only by the logo: the import does not hang around unused.
    const f7Import = source.match(/import\s*\{([^}]*)\}\s*from\s*'framework7-react'/);
    assert.ok(f7Import, 'framework7-react import is not found');
    const imported = f7Import[1].split(',').map(name => name.trim());
    if (imported.includes('Icon'))
        assert.ok(/<Icon[\s>]/.test(source), 'Icon is imported but not used');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
