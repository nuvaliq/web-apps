/* Run: node test/unit-tests/documenteditor/build-legal.cjs
 * Delivery and provenance: the build copies the repository
 * LICENSE unchanged to the common resources of the delivery, where the "About" links point; build defaults
 * (Gruntfile, mobile webpack) give the product name, send help and support to the product helpdesk and carry no
 * publisher contacts, environment variables still win; the source address and the release number of the "About"
 * window come from SOURCE_URL and RELEASE_VERSION of the build environment only; NOTICE in the root and a line in
 * Readme.md name the modified version (Additional Terms, item 2).
 * The build is not run: Gruntfile.js executes in vm with stub grunt and require — tasks are registered and
 * called one by one, nothing is copied or written; the build JSON is read as data; of webpack.config.js only
 * the DefinePlugin object is evaluated.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const BUILD = path.join(ROOT, 'build');
const GRUNTFILE = path.join(BUILD, 'Gruntfile.js');
const LICENSE = path.join(ROOT, 'LICENSE');
/* LICENSE as in ONLYOFFICE v9.4.0.129, the base of b24/9.4.0: it is never edited (Additional Terms, item 1). */
const LICENSE_SHA256 = '3a9b4b6ab698d668dcedcda1c2da598f4ca9789a0d8b4aefb90e00e2cb425040';
const LICENSE_COPY = {src: '../LICENSE', dest: '../deploy/web-apps/apps/common/LICENSE.txt'};
const ABOUT_VIEWS = ['apps/common/main/lib/view/About.js', 'apps/common/mobile/lib/view/About.jsx'];
const WEBPACK = path.join(ROOT, 'vendor/framework7-react/build/webpack.config.js');

/* Build defaults without environment variables: the product name, the helpdesk for every
   address, no publisher contacts. DEFAULT_LANG is not a brand value and stays as it was. */
const NAME = 'VibeOffice';
const HELPDESK = 'https://helpdesk.bitrix24.com/';
const GRUNT_DEFAULTS = {
    SUPPORT_EMAIL: '', SUPPORT_URL: HELPDESK, SALES_EMAIL: '', PUBLISHER_URL: HELPDESK, PUBLISHER_PHONE: '',
    PUBLISHER_NAME: NAME, PUBLISHER_ADDRESS: '', API_URL_EDITING_CALLBACK: '', COMPANY_NAME: NAME,
    APP_TITLE_TEXT: NAME, HELP_URL: HELPDESK, HELP_CENTER_WEB_DE: HELPDESK, HELP_CENTER_WEB_SSE: HELPDESK,
    HELP_CENTER_WEB_PE: HELPDESK, DEFAULT_LANG: 'en', SUGGEST_URL: HELPDESK, SOURCE_URL: '', RELEASE_VERSION: ''
};
const WEBPACK_DEFAULTS = {
    __PUBLISHER_ADDRESS__: '', __SUPPORT_EMAIL__: '', __SUPPORT_URL__: HELPDESK, __PUBLISHER_PHONE__: '',
    __PUBLISHER_URL__: HELPDESK, __PUBLISHER_NAME__: NAME, __APP_TITLE_TEXT__: NAME, __COMPANY_NAME__: NAME,
    __HELP_URL__: HELPDESK, __SALES_EMAIL__: ''
};
/* Name, addresses and phone of the upstream publisher. */
const PUBLISHER = /onlyoffice|ascensio|birznieka|\briga\b|\+371/i;

/* NOTICE, line by line, in the words of the "About" window. */
const NOTICE_LINES = [
    'VibeOffice — modified version of ONLYOFFICE Docs web-apps v9.4.0.129,',
    'changes since 27 August 2026.',
    'Based on ONLYOFFICE Docs software developed by Ascensio System SIA.',
    '© 2026 Bitrix LLC, with respect to modifications.',
    'License: GNU Affero General Public License v3.0 (AGPLv3) + Additional Terms, see LICENSE.'
];
/* Build environments of two releases: the source address and the release number differ. */
const RELEASES = [
    {SOURCE_URL: 'https://git.example.test/example/overlay/-/tree/v9.4.0.129-b24.5', RELEASE_VERSION: '9.4.0.129-b24.5'},
    {SOURCE_URL: 'https://code.example.test/example/overlay/tree/v9.4.0.129-b24.6', RELEASE_VERSION: '9.4.0.129-b24.6'}
];
/* Readme.md as in ONLYOFFICE v9.4.0.129, the base of b24/9.4.0: CRLF, no newline at the end. */
const README_SHA256 = 'b1d20dfa78f6418b7ab0c0d883327431bebd3fcb8cf97be255950b545f742453';
const LICENSE_BADGE = '[![License](https://img.shields.io/badge/License-GNU%20AGPL%20V3-green.svg?style=flat)]'
    + '(https://www.gnu.org/licenses/agpl-3.0.en.html)';

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
/* Values built in the vm realm: copied to this realm for deepStrictEqual. */
const plain = value => JSON.parse(JSON.stringify(value));

/* Gruntfile.js in vm. The stub grunt records registered tasks and initConfig calls; require gives the lodash
   functions the Gruntfile uses, path and the build JSON from build/. `env` is the whole process.env of the build. */
function loadGruntfile(env) {
    const tasks = {};
    const configs = [];
    const grunt = {
        log: {writeln() {}, ok() {}, error() { return grunt.log; }},
        option: () => undefined,
        file: {isDir: () => false, exists: () => false},
        loadNpmTasks() {},
        initConfig: config => configs.push(config),
        registerTask: (name, ...rest) => { tasks[name] = rest[rest.length - 1]; },
        task: {run() {}},
        config: {get: key => configs[configs.length - 1][key], set() {}}
    };
    const lodash = {
        isFunction: value => typeof value === 'function',
        isUndefined: value => value === undefined,
        isObject: value => value !== null && (typeof value === 'object' || typeof value === 'function'),
        isArray: Array.isArray,
        assign: Object.assign
    };
    const modules = {lodash, path, './appforms': () => {}, 'less-plugin-clean-css': function () {}};
    const sandbox = {
        module: {},
        process: {env, platform: 'linux'},
        require: name => {
            if (name in modules) return modules[name];
            if (/^\.\/[\w-]+\.json$/.test(name)) return JSON.parse(fs.readFileSync(path.join(BUILD, name), 'utf8'));
            throw new Error('unexpected require: ' + name);
        }
    };
    sandbox.global = sandbox;
    vm.runInNewContext(fs.readFileSync(GRUNTFILE, 'utf8'), sandbox, {filename: GRUNTFILE});
    sandbox.module.exports(grunt);
    return {
        tasks,
        jsreplacements: sandbox.jsreplacements,
        copyright: sandbox.copyright,
        /* A function task as grunt calls it; returns the config it passed to initConfig. */
        run(name) {
            assert.equal(typeof tasks[name], 'function', name + ' is a function task');
            configs.length = 0;
            tasks[name].call({});
            return configs[configs.length - 1];
        }
    };
}

/* {{NAME}} replacements of the Gruntfile as {NAME: value}. */
function replacementValues(replacements) {
    const values = {};
    replacements.forEach(({from, to}) => {
        const name = (from.source.match(/^\\\{\\\{(\w+)\\\}\\\}$/) || [])[1];
        assert.ok(name, 'not a {{NAME}} placeholder: ' + from);
        values[name] = to;
    });
    return values;
}

/* APP_CUSTOMER_NAME (the loader name in the editor URL) is replaced in api.js by the api task. */
function customerName(grunt) {
    grunt.run('init-build-common');
    const replacements = grunt.run('api-init').replace.writeVersion.replacements;
    return replacementValues(replacements.filter(({from}) => /APP_CUSTOMER_NAME/.test(from.source)))
        .APP_CUSTOMER_NAME;
}

/* The DefinePlugin object of the mobile webpack config evaluated with this process.env; the config itself is
   not loaded (it needs webpack and reads the editor sources). */
function definePluginValues(processEnv) {
    const source = fs.readFileSync(WEBPACK, 'utf8');
    const call = source.indexOf('new webpack.DefinePlugin(');
    assert.notEqual(call, -1, 'DefinePlugin is not found');
    const start = source.indexOf('{', call);
    let end = start;
    for (let depth = 0; end < source.length; end++) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}' && --depth === 0) break;
    }
    return vm.runInNewContext('(' + source.slice(start, end + 1) + ')',
        {process: {env: processEnv}, env: 'production', target: 'web'});
}

/* A build path (relative to build/) inside the delivery as a URL: deploy/ is the web root of the server. */
const deliveryUrl = file => new URL(path.relative(path.join(ROOT, 'deploy'), path.resolve(BUILD, file))
    .split(path.sep).join('/'), 'https://docs.example.test/').href;

/* Files under dir with exactly these bytes. */
function filesWithBytes(dir, bytes, found = []) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) filesWithBytes(file, bytes, found);
        else if (entry.isFile() && fs.statSync(file).size === bytes.length && fs.readFileSync(file).equals(bytes))
            found.push(path.relative(ROOT, file));
    }
    return found;
}

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

test('test_license_copied_to_common_resources', () => {
    const grunt = loadGruntfile({});
    grunt.run('init-build-common');
    const config = grunt.run('apps-common-init');

    /* A plain file target, no expand and no process: grunt copies the bytes as they are. */
    assert.deepEqual(config.copy.license, LICENSE_COPY);
    assert.equal(path.resolve(BUILD, LICENSE_COPY.src), LICENSE, 'the source is the repository LICENSE');
    assert.equal(sha256(fs.readFileSync(LICENSE)), LICENSE_SHA256, 'LICENSE is not edited');

    /* Default grunt: deploy-common-component -> init-build-common, deploy-app -> tasks.deploy of common.json ->
       deploy-apps-common: the clean of apps/common first, then every copy target of apps-common. */
    assert.ok(plain(grunt.tasks.default).includes('deploy-common-component'));
    assert.deepEqual(plain(grunt.tasks['deploy-common-component']), ['init-build-common', 'deploy-app']);
    assert.ok(JSON.parse(read('build/common.json')).tasks.deploy.includes('deploy-apps-common'));
    const steps = plain(grunt.tasks['deploy-apps-common']);
    assert.ok(steps.includes('copy'), 'deploy-apps-common runs every copy target');
    assert.ok(steps.indexOf('clean') < steps.indexOf('copy'), 'the copy is made after the clean');
    assert.ok(plain(config.clean.files).every(dir => !path.relative(path.resolve(BUILD, dir),
        path.resolve(BUILD, LICENSE_COPY.dest)).startsWith('..')), 'the copy is inside the cleaned resources');

    /* The "About" links (desktop P1, mobile P2) lead from the editor pages of the delivery to the copy. */
    const editor = JSON.parse(read('build/documenteditor.json'));
    const pages = [
        editor.main.copy.indexhtml[0].dest + '/index.html',
        Object.keys(editor.mobile.copy['index-page']).find(page => /\/index\.html$/.test(page))
    ];
    ABOUT_VIEWS.forEach((file, i) => {
        const href = (read(file).match(/\bLICENSE_URL = '([^']+)'/) || [])[1];
        assert.ok(href, file + ': LICENSE_URL');
        assert.equal(new URL(href, deliveryUrl(pages[i])).href, deliveryUrl(LICENSE_COPY.dest), file);
    });

    /* One source: no copy of LICENSE in apps/. */
    assert.deepEqual(filesWithBytes(path.join(ROOT, 'apps'), fs.readFileSync(LICENSE)), []);
});

test('test_grunt_defaults_have_no_onlyoffice_contacts', () => {
    const defaults = loadGruntfile({});
    const values = replacementValues(defaults.jsreplacements);
    assert.deepEqual(values, GRUNT_DEFAULTS);
    Object.entries(values).forEach(([name, value]) => assert.doesNotMatch(value, PUBLISHER, name));
    assert.equal(customerName(defaults), NAME);

    /* Environment variables still win over every default. */
    const env = {};
    Object.keys(GRUNT_DEFAULTS).concat('APP_CUSTOMER_NAME').forEach(name => { env[name] = 'env-' + name; });
    const custom = loadGruntfile(env);
    const customValues = replacementValues(custom.jsreplacements);
    Object.keys(GRUNT_DEFAULTS).forEach(name => assert.equal(customValues[name], env[name], name));
    assert.equal(customerName(custom), env.APP_CUSTOMER_NAME);
    const editors = replacementValues(loadGruntfile({HELP_CENTER_WEB_EDITORS: 'env-editors'}).jsreplacements);
    ['HELP_CENTER_WEB_DE', 'HELP_CENTER_WEB_SSE', 'HELP_CENTER_WEB_PE'].forEach(name =>
        assert.equal(editors[name], 'env-editors', name + ' falls back to HELP_CENTER_WEB_EDITORS'));

    /* The document editor build applies them to its scripts; the replacements of the guide are untouched. */
    defaults.run('init-build-documenteditor');
    const replace = defaults.run('main-app-init').replace;
    const applied = replacementValues(replace.writeVersion.replacements);
    delete applied.PRODUCT_VERSION;
    assert.deepEqual(applied, GRUNT_DEFAULTS);
    assert.deepEqual(replacementValues(replace.prepareHelp.replacements), {
        COEDITING_DESKTOP: 'Connect to cloud',
        PLUGIN_LINK: 'https://api.onlyoffice.com/plugin/basic',
        PLUGIN_LINK_MACROS: 'https://api.onlyoffice.com/plugin/macros'
    });

    /* Copyrights stay: the file header as in the other build scripts, the banner of the built files. */
    const header = file => read(file).match(/^\/\*[\s\S]*?\*\//)[0];
    assert.equal(header('build/Gruntfile.js'), header('build/appforms.js'));
    assert.match(defaults.copyright, /^\/\*!\n \* Copyright \(c\) Ascensio System SIA 2009-/);
});

test('test_webpack_defaults_have_no_onlyoffice_contacts', () => {
    const defaults = definePluginValues({});
    Object.entries(WEBPACK_DEFAULTS).forEach(([name, value]) =>
        assert.equal(defaults[name], JSON.stringify(value), name));
    Object.entries(defaults).forEach(([name, value]) => assert.doesNotMatch(value, PUBLISHER, name));

    /* Environment variables still win over every default. */
    const variable = name => name.replace(/^__|__$/g, '');
    const env = {};
    Object.keys(WEBPACK_DEFAULTS).forEach(name => { env[variable(name)] = 'env-' + variable(name); });
    const custom = definePluginValues(env);
    Object.keys(WEBPACK_DEFAULTS).forEach(name =>
        assert.equal(custom[name], JSON.stringify(env[variable(name)]), name));

    assert.doesNotMatch(fs.readFileSync(WEBPACK, 'utf8'), PUBLISHER, 'webpack.config.js has no publisher values');
});

test('test_build_takes_source_address_and_release_from_environment', () => {
    const about = read(ABOUT_VIEWS[0]);
    const built = RELEASES.map(env => {
        const grunt = loadGruntfile(env);
        const values = replacementValues(grunt.jsreplacements);
        assert.equal(values.SOURCE_URL, env.SOURCE_URL, '{{SOURCE_URL}} is SOURCE_URL of the build environment');
        assert.equal(values.RELEASE_VERSION, env.RELEASE_VERSION, '{{RELEASE_VERSION}} is RELEASE_VERSION of the build environment');

        /* The desktop editor scripts get them with the product version: replace:writeVersion of main-app-init. */
        grunt.run('init-build-documenteditor');
        const replacements = grunt.run('main-app-init').replace.writeVersion.replacements;
        const applied = replacementValues(replacements);
        assert.equal(applied.SOURCE_URL, env.SOURCE_URL, 'replace:writeVersion puts SOURCE_URL into the scripts');
        assert.equal(applied.RELEASE_VERSION, env.RELEASE_VERSION, 'replace:writeVersion puts RELEASE_VERSION into the scripts');
        const text = replacements.reduce((result, {from, to}) => result.replace(from, to), about);
        assert.ok(text.includes(env.SOURCE_URL), 'About.js after replace:writeVersion has ' + env.SOURCE_URL);
        assert.ok(text.includes(env.RELEASE_VERSION), 'About.js after replace:writeVersion has ' + env.RELEASE_VERSION);
        assert.doesNotMatch(text, /\{\{(SOURCE_URL|RELEASE_VERSION)\}\}/, 'no placeholder is left in About.js');

        /* The mobile bundle gets them as the webpack constants. */
        const define = definePluginValues(env);
        assert.equal(define.__SOURCE_URL__, JSON.stringify(env.SOURCE_URL), '__SOURCE_URL__ is SOURCE_URL');
        assert.equal(define.__RELEASE_VERSION__, JSON.stringify(env.RELEASE_VERSION), '__RELEASE_VERSION__ is RELEASE_VERSION');
        return {text, define};
    });
    /* Two releases, two addresses: only the value of the variable changes, not the code. */
    assert.ok(!built[0].text.includes(RELEASES[1].SOURCE_URL) && !built[1].text.includes(RELEASES[0].SOURCE_URL),
        'each build has its own address only');
    assert.notEqual(built[0].define.__SOURCE_URL__, built[1].define.__SOURCE_URL__, 'the mobile constants differ');

    /* Without the variables: empty values, no address of its own in the build scripts. */
    const values = replacementValues(loadGruntfile({}).jsreplacements);
    assert.equal(values.SOURCE_URL, '', '{{SOURCE_URL}} without SOURCE_URL');
    assert.equal(values.RELEASE_VERSION, '', '{{RELEASE_VERSION}} without RELEASE_VERSION');
    const define = definePluginValues({});
    assert.equal(define.__SOURCE_URL__, '""', '__SOURCE_URL__ without SOURCE_URL');
    assert.equal(define.__RELEASE_VERSION__, '""', '__RELEASE_VERSION__ without RELEASE_VERSION');
});

test('test_notice_names_version_origin_and_date', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'NOTICE')), 'NOTICE is in the repository root');
    const notice = read('NOTICE');
    assert.doesNotMatch(notice, /\r/, 'LF line endings, as LICENSE');
    assert.ok(notice.endsWith('\n'), 'NOTICE ends with a line break');
    assert.deepEqual(notice.slice(0, -1).split('\n'), NOTICE_LINES, 'NOTICE in the words of the "About" window');
    assert.equal(sha256(fs.readFileSync(LICENSE)), LICENSE_SHA256, 'LICENSE is not edited');
});

test('test_readme_points_to_notice', () => {
    const readme = read('Readme.md');
    assert.doesNotMatch(readme, /(^|[^\r])\n/, 'Readme.md keeps CRLF line endings');
    const lines = readme.split('\r\n');
    assert.equal(lines[0], LICENSE_BADGE, 'the license badge stays first');
    /* Right under the badge, as a paragraph of its own: the modified version and the link to NOTICE. */
    assert.deepEqual([lines[1], lines[3]], ['', ''], 'the line is a paragraph of its own');
    assert.match(lines[2], /\bmodified version\b/);
    assert.match(lines[2], /\[NOTICE\]\(NOTICE\)/);
    assert.equal(lines.filter(line => line.includes('NOTICE')).length, 1, 'one line about NOTICE');
    /* The rest is as before: without the line and its blank line the file is the base one, byte for byte. */
    assert.equal(sha256(lines.slice(0, 2).concat(lines.slice(4)).join('\r\n')), README_SHA256,
        'the rest of Readme.md is unchanged');
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
