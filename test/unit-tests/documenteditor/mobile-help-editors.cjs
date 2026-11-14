/* Run: node test/unit-tests/documenteditor/mobile-help-editors.cjs
 * "Help" in the mobile "Settings" of the spreadsheet, presentation and Visio editors: the item opens the helpdesk
 * of the interface language by the rule of the document editor (mobile-about.cjs) — About.helpUrl of the common
 * mobile About — and the address is the same on every device. Before, showHelp appended the ONLYOFFICE helpcenter
 * path of the device to __HELP_URL__; with the product helpdesk as the build default that address is a 404.
 * JSX does not load in vm: showHelp and About.helpUrl have no JSX, they are cut out of the sources and run in vm
 * with the build default of __HELP_URL__ (mobile webpack config); the rest is checked as text.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const util = require('node:util');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../../..');
const ABOUT = path.join(ROOT, 'apps/common/mobile/lib/view/About.jsx');
const WEBPACK = path.join(ROOT, 'vendor/framework7-react/build/webpack.config.js');
const EDITORS = ['spreadsheeteditor', 'presentationeditor', 'visioeditor'];
const controllerOf = editor => path.join(ROOT, 'apps', editor, 'mobile/src/controller/settings/Settings.jsx');
const pageOf = editor => path.join(ROOT, 'apps', editor, 'mobile/src/view/settings/SettingsPage.jsx');

const RU_HELP = 'https://helpdesk.bitrix24.ru/';
const COM_HELP = 'https://helpdesk.bitrix24.com/';
/* Interface languages and the helpdesk of each. */
const LANGS = [['ru', RU_HELP], ['ru-RU', RU_HELP], ['en', COM_HELP], ['de', COM_HELP], ['kk', COM_HELP], ['', COM_HELP]];
/* One device at a time, the other getters of common/mobile/utils/device.jsx are false: the old showHelp chose
 * the android or the ios page of the helpcenter by them. */
const DEVICES = ['android', 'ios', 'sailfish'];
const DEVICE_FIELDS = ['phone', 'tablet', 'sailfish', 'android', 'ios'];

/* One top-level statement of `text`: from the match of `start` to its `;` at bracket depth 0. Strings and
 * comments are skipped, so brackets and semicolons in them do not count. */
function cut(text, start) {
    const m = start.exec(text);
    assert.ok(m, 'source has ' + start);
    let depth = 0;
    for (let i = m.index; i < text.length; i++) {
        const c = text[i];
        if (c === '\'' || c === '"' || c === '`') {
            for (i++; i < text.length && text[i] !== c; i++)
                if (text[i] === '\\') i++;
        } else if (c === '/' && text[i + 1] === '/') {
            i = text.indexOf('\n', i);
            if (i < 0) break;
        } else if (c === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i + 2) + 1;
        } else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === ';' && depth === 0) return text.slice(m.index, i + 1);
    }
    assert.fail('statement ' + start + ' has no end');
}

/* About.helpUrl has no JSX: it runs in vm as it is in About.jsx. */
function loadAbout() {
    const code = ['const About = {};', cut(fs.readFileSync(ABOUT, 'utf8'), /^About\.helpUrl = /m), 'this.About = About;'].join('\n');
    const context = {};
    vm.runInNewContext(code, context, {filename: ABOUT});
    return context.About;
}

/* __HELP_URL__ as the mobile build defines it without HELP_URL in the environment (DefinePlugin). */
function helpUrlDefault() {
    const m = /^\s*__HELP_URL__:\s*JSON\.stringify\(process\.env\.HELP_URL\s*\|\|\s*('(?:[^'\\]|\\.)*')\)/m
        .exec(fs.readFileSync(WEBPACK, 'utf8'));
    assert.ok(m, 'webpack.config.js defines __HELP_URL__ with a default');
    return vm.runInNewContext(m[1]);
}

/* The first device and language on which showHelp of the editor does not close the settings and then open the
 * helpdesk of the language once in a new tab; null if there is none. */
function firstWrongHelp(editor, About, helpUrl) {
    const file = controllerOf(editor);
    const showHelp = cut(fs.readFileSync(file, 'utf8'), /const showHelp = /);
    const steps = log => log.map(entry => entry.join(' ')).join(', ') || 'nothing';
    for (const device of DEVICES)
        for (const [lang, url] of LANGS) {
            const log = [];
            const context = {
                About,
                Common: {Locale: {currentLang: lang}},
                Device: Object.fromEntries(DEVICE_FIELDS.map(field => [field, field === device])),
                __HELP_URL__: helpUrl,
                closeModal: () => log.push(['close']),
                setTimeout: (fn, delay) => { log.push(['timeout', delay]); fn(); },
                window: {open: (...args) => log.push(['open', ...args])}
            };
            const where = `${editor}, ${device}, lang '${lang}': `;
            try { vm.runInNewContext(showHelp + '\nshowHelp();', context, {filename: file}); }
            catch (error) { return where + 'showHelp throws ' + error.message; }
            const expected = [['close'], ['open', url, '_blank']];
            if (!util.isDeepStrictEqual(log, expected))
                return where + steps(log) + ' — expected ' + steps(expected);
        }
    return null;
}

/* assert.match on a whole source file prints the file; report the pattern instead. */
function has(text, pattern, message) {
    assert.ok(pattern.test(text), message || 'source matches ' + pattern);
}

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log('PASS', name); passed++; }
    catch (error) { console.error('FAIL', name, error.message); failed++; }
}

test('test_mobile_help_editors_go_to_helpdesk', () => {
    const About = loadAbout();
    const helpUrl = helpUrlDefault();
    const failures = EDITORS.map(editor => firstWrongHelp(editor, About, helpUrl)).filter(Boolean);
    assert.ok(!failures.length, failures.join('; '));
});

test('test_mobile_help_editors_source', () => {
    for (const editor of EDITORS) {
        const controller = fs.readFileSync(controllerOf(editor), 'utf8');
        const code = controller.replace(/^\/\*[\s\S]*?\*\//, '');    // the copyright header stays as it is
        for (const token of ['__HELP_URL__', 'mobile-applications', 'index.aspx', 'helpcenter'])
            assert.ok(!code.toLowerCase().includes(token.toLowerCase()), editor + ' Settings.jsx still has ' + token);
        has(controller, /^import About from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/common\/mobile\/lib\/view\/About';$/m,
            editor + ' Settings.jsx imports the common mobile About');
        has(controller, /^import \{ Device \} from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/common\/mobile\/utils\/device';$/m,
            editor + ' Settings.jsx keeps Device (closeModal, the rename dialog)');
        const provider = /<SettingsContext\.Provider value=\{\{([^}]*)\}\}>/.exec(controller);
        assert.ok(provider, editor + ' SettingsContext.Provider value');
        assert.ok(provider[1].split(',').map(s => s.trim()).includes('showHelp'), editor + ': showHelp is in the settings context');

        /* The item stays where it was: shown unless customization.help === false, runs showHelp of the context. */
        const page = fs.readFileSync(pageOf(editor), 'utf8');
        has(page, /_canHelp = appOptions\.customization\.help !== false;/, editor + ': customization.help gate is kept');
        has(page.replace(/\s+/g, ' '), /\{_canHelp && <ListItem title=\{_t\.textHelp\} link="#" className='no-indicator' onClick=\{settingsContext\.showHelp\}>/,
            editor + ': Help item runs showHelp');
    }
});

test('test_no_mobile_source_reads_help_url', () => {
    const scanned = [], readers = [];
    const scan = dir => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) scan(file);
            else if (/\.(?:js|jsx|mjs)$/.test(entry.name)) {
                scanned.push(file);
                if (fs.readFileSync(file, 'utf8').includes('__HELP_URL__')) readers.push(path.relative(ROOT, file));
            }
        }
    };
    for (const app of fs.readdirSync(path.join(ROOT, 'apps'))) {
        const dir = path.join(ROOT, 'apps', app, 'mobile/src');
        if (fs.existsSync(dir)) scan(dir);
    }
    scan(path.join(ROOT, 'apps/common/mobile'));    // the part every mobile bundle shares
    /* The scan reaches the settings controllers of all four editors, the place that read it before. */
    for (const editor of ['documenteditor', ...EDITORS])
        assert.ok(scanned.includes(controllerOf(editor)), 'scanned ' + path.relative(ROOT, controllerOf(editor)));
    assert.ok(!readers.length, 'mobile sources read __HELP_URL__: ' + readers.join(', '));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
