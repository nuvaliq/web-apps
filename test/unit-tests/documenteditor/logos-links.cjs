/* Run: node test/unit-tests/documenteditor/logos-links.cjs
 * The optional arguments are paths to Header.js and header.less for checking the baseline.
 * The extended header does not draw the ONLYOFFICE logo and does not lead to the publisher's address on click;
 * accesses to the logo from branding and theme change are safe on an empty selection.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../../..');
const headerFile = process.argv[2] || path.join(root, 'apps/common/main/lib/view/Header.js');
const lessFile = process.argv[3] || path.join(root, 'apps/common/main/resources/less/header.less');
const headerSource = fs.readFileSync(headerFile, 'utf8');
const lessSource = fs.readFileSync(lessFile, 'utf8');

// A selection as in jQuery: on an empty one all methods do nothing and return itself.
function selection(nodes, calls) {
    const target = {length: nodes};
    const proxy = new Proxy(target, {
        get(obj, key) {
            if (key in obj) return obj[key];
            if (typeof key === 'symbol') return undefined;
            return (...args) => {
                calls.push([key, args]);
                return proxy;
            };
        }
    });
    return proxy;
}

const htmlPassed = [];
const logoCalls = [];
function $(arg) {
    if (typeof arg === 'string' && arg.trim().startsWith('<')) {
        htmlPassed.push(arg);
        return {
            html: arg,
            find(selector) {
                const id = selector.replace(/^#/, '');
                return selection(arg.includes('id="' + id + '"') ? 1 : 0, logoCalls);
            }
        };
    }
    // On a page assembled from the header templates there is no logo node.
    return selection(0, logoCalls);
}

const Common = {
    Views: {},
    Utils: {
        isIE: false,
        InternalSettings: {get: () => undefined},
        RGBColor: function () { this.isDark = () => true; }
    },
    UI: {Themes: {currentThemeColor: () => '#ffffff'}}
};
const context = {
    window: {DE: {}},
    Common,
    $,
    jQuery: $,
    _: {extend: Object.assign, template: () => () => ''},
    define: (dependencies, factory) => factory({View: {extend: proto => proto}})
};

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

test('test_header_has_no_logo_or_publisher_link', () => {
    assert.ok(!headerSource.includes('{{PUBLISHER_URL}}'),
        'Header.js still opens {{PUBLISHER_URL}}');
    const leftBox = headerSource.match(/var templateLeftBox = ([\s\S]*?);\n/);
    assert.ok(leftBox, 'templateLeftBox is not found');
    assert.ok(!leftBox[1].includes('header-logo'), 'templateLeftBox still renders #header-logo');

    vm.runInNewContext(headerSource, context, {filename: headerFile});
    const header = Object.create(Common.Views.Header);
    header.branding = {logo: {image: 'custom.svg', url: 'https://example.test'}};
    const config = {twoLevelHeader: true};

    const panel = header.getPanel('left', config);
    assert.equal(htmlPassed.length, 1);
    assert.ok(!htmlPassed[0].includes('header-logo'), 'left panel html contains the logo');
    assert.equal(panel.find('#header-logo').length, 0);
    assert.equal(header.logo.length, 0, 'this.logo must be an empty selection');

    // Branding and theme change access the logo: on an empty selection without errors.
    header.setBranding({logo: {image: 'custom.svg', url: 'https://example.test'}}, config);
    header.setBranding({logo: {visible: false}}, config);
    header.changeLogo();

    for (const rule of ['header-logo_s.svg', 'dark-logo_s.svg'])
        assert.ok(!lessSource.includes(rule), 'header.less still uses ' + rule);
    const activeRules = lessSource.split('\n').filter(line => !line.trim().startsWith('//'));
    assert.ok(!activeRules.some(line => line.includes('#header-logo')),
        'header.less still has #header-logo rules');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
